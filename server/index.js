
import 'dotenv/config';

import express from 'express';

import {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash
} from 'node:crypto';

import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  client,
  db,
  events,
  admins,
  sessions,
  connectMongoDB
} from './mongodb.js';

import { installUpgrade } from './seats-password.js';
import { installTicketReceipts } from './ticket-receipt.js';
import { installPayments } from './payments.js';

// ========================================
// VEONLINE SERVER
// ========================================

const app = express();

const PORT = Number(process.env.PORT || 3000);

app.use(express.json({
  limit: '20kb'
}));

const customers = db.collection('customers');

const customerSessions = db.collection(
  'customer_sessions'
);

const derive = promisify(scrypt);

const ADMIN_COOKIE = 'vemo_admin_v2';
const CUSTOMER_COOKIE = 'vemo_customer_v1';

const SESSION_AGE = 8 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/'
};

const activeEvents = {
  archived: { $ne: true }
};

const publicEventFields = {
  orders: 0,
  archived: 0,
  zonePlan: 0
};

const categories = {
  'Âm nhạc': 'night',
  Workshop: 'clay',
  'Triển lãm': 'frame'
};

// ========================================
// VALIDATION
// ========================================

function clean(value, max = 200) {
  if (typeof value !== 'string') return '';

  const text = value.trim();

  return text.length <= max ? text : '';
}

function normalizeEmail(value) {
  const email = clean(value, 254).toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : '';
}

function normalizeUsername(value) {
  const username = clean(value, 60).toLowerCase();

  return /^[a-z0-9._-]{3,60}$/.test(username)
    ? username
    : '';
}

function validPassword(password) {
  return typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 128;
}

function validCode(code) {
  return typeof code === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
      .test(code);
}

function sha256(value) {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

// ========================================
// HASH PASSWORD
// ========================================

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');

  const hash = (
    await derive(password, salt, 64)
  ).toString('hex');

  return {
    salt,
    hash
  };
}

async function verifyPassword(password, account) {
  if (typeof password !== 'string') {
    return false;
  }

  const candidate = await derive(
    password,
    account?.salt || '0'.repeat(32),
    64
  );

  const stored = Buffer.from(
    account?.hash || '',
    'hex'
  );

  return Boolean(account) &&
    candidate.length === stored.length &&
    timingSafeEqual(candidate, stored);
}

// ========================================
// COOKIE
// ========================================

function readCookie(req, name) {
  const pieces = (req.headers.cookie || '')
    .split(';');

  const item = pieces
    .map(piece => piece.trim())
    .find(piece => piece.startsWith(name + '='));

  if (!item) return null;

  const token = item.slice(name.length + 1);

  return /^[a-f0-9]{64}$/i.test(token)
    ? token
    : null;
}

async function logoutAll(req, res) {
  const adminToken = readCookie(
    req,
    ADMIN_COOKIE
  );

  const customerToken = readCookie(
    req,
    CUSTOMER_COOKIE
  );

  if (adminToken) {
    await sessions.deleteOne({
      _id: sha256(adminToken)
    });
  }

  if (customerToken) {
    await customerSessions.deleteOne({
      _id: sha256(customerToken)
    });
  }

  res.clearCookie(
    ADMIN_COOKIE,
    cookieOptions
  );

  res.clearCookie(
    CUSTOMER_COOKIE,
    cookieOptions
  );
}

// ========================================
// CREATE SESSION
// ========================================

async function createSession(res, role, userId) {
  const token = randomBytes(32).toString('hex');

  const expiresAt = new Date(
    Date.now() + SESSION_AGE
  );

  if (role === 'admin') {
    await sessions.insertOne({
      _id: sha256(token),
      username: userId,
      expiresAt
    });

    res.cookie(ADMIN_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_AGE
    });
  } else {
    await customerSessions.insertOne({
      _id: sha256(token),
      customerId: userId,
      expiresAt
    });

    res.cookie(CUSTOMER_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_AGE
    });
  }
}

// ========================================
// CURRENT USER
// ========================================

async function currentUser(req) {
  const adminToken = readCookie(
    req,
    ADMIN_COOKIE
  );

  if (adminToken) {
    const session = await sessions.findOne({
      _id: sha256(adminToken),
      expiresAt: {
        $gt: new Date()
      }
    });

    if (session) {
      const admin = await admins.findOne({
        _id: session.username
      });

      if (admin) {
        return {
          id: admin._id,
          username: admin._id,
          name: admin._id,
          role: 'admin'
        };
      }
    }
  }

  const customerToken = readCookie(
    req,
    CUSTOMER_COOKIE
  );

  if (customerToken) {
    const session = await customerSessions.findOne({
      _id: sha256(customerToken),
      expiresAt: {
        $gt: new Date()
      }
    });

    if (session) {
      const customer = await customers.findOne({
        _id: session.customerId
      });

      if (customer) {
        return {
          id: customer._id,
          name: customer.name,
          username: customer.username,
          email: customer.email,
          role: 'customer'
        };
      }
    }
  }

  return null;
}

// ========================================
// MIDDLEWARE
// ========================================

async function requireLogin(req, res, next) {
  try {
    const user = await currentUser(req);

    if (!user) {
      return res.status(401).json({
        message: 'Vui lòng đăng nhập.'
      });
    }

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      message: 'Chức năng chỉ dành cho Admin.'
    });
  }

  next();
}

function requireCustomer(req, res, next) {
  if (req.user?.role !== 'customer') {
    return res.status(403).json({
      message: 'Vui lòng dùng tài khoản khách hàng.'
    });
  }

  next();
}

// ========================================
// HEALTH CHECK
// ========================================

app.get('/api/health', async (req, res, next) => {
  try {
    await db.command({ ping: 1 });

    res.json({
      ok: true,
      message: 'VeOnline API hoạt động.',
      database: db.databaseName
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// ĐĂNG KÝ KHÁCH HÀNG
// ========================================

app.post(
  '/api/auth/register',
  async (req, res, next) => {
    try {
      const name = clean(
        req.body?.name,
        100
      );

      const username = normalizeUsername(
        req.body?.username
      );

      const email = normalizeEmail(
        req.body?.email
      );

      const password = req.body?.password;

      if (
        !name ||
        !username ||
        !email ||
        !validPassword(password)
      ) {
        return res.status(400).json({
          message:
            'Họ tên, username, email hoặc mật khẩu không hợp lệ. Mật khẩu phải có ít nhất 8 ký tự.'
        });
      }

      const existingAdmin = await admins.findOne({
        _id: username
      });

      if (existingAdmin) {
        return res.status(409).json({
          message: 'Username đã được sử dụng.'
        });
      }

      const customerId = randomUUID();

      try {
        await customers.insertOne({
          _id: customerId,
          name,
          username,
          email,
          ...await hashPassword(password),
          createdAt: new Date()
        });
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({
            message:
              'Tên đăng nhập hoặc email đã tồn tại.'
          });
        }

        throw error;
      }

      await logoutAll(req, res);

      await createSession(
        res,
        'customer',
        customerId
      );

      res.status(201).json({
        user: {
          id: customerId,
          name,
          username,
          email,
          role: 'customer'
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ĐĂNG NHẬP ADMIN / KHÁCH HÀNG
// ========================================

app.post(
  '/api/auth/login',
  async (req, res, next) => {
    try {
      const login = clean(
        req.body?.login,
        254
      ).toLowerCase();

      const password = req.body?.password;

      if (
        !login ||
        typeof password !== 'string' ||
        !password ||
        password.length > 128
      ) {
        return res.status(400).json({
          message: 'Thông tin đăng nhập không hợp lệ.'
        });
      }

      // Đăng nhập Admin
      const admin = await admins.findOne({
        _id: login
      });

      if (
        await verifyPassword(
          password,
          admin
        )
      ) {
        await logoutAll(req, res);

        await createSession(
          res,
          'admin',
          admin._id
        );

        return res.json({
          user: {
            id: admin._id,
            username: admin._id,
            name: admin._id,
            role: 'admin'
          }
        });
      }

      // Đăng nhập khách
      const customer = await customers.findOne({
        $or: [
          { username: login },
          { email: login }
        ]
      });

      if (
        !await verifyPassword(
          password,
          customer
        )
      ) {
        return res.status(401).json({
          message: 'Sai tài khoản hoặc mật khẩu.'
        });
      }

      await logoutAll(req, res);

      await createSession(
        res,
        'customer',
        customer._id
      );

      res.json({
        user: {
          id: customer._id,
          name: customer.name,
          username: customer.username,
          email: customer.email,
          role: 'customer'
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// THÔNG TIN TÀI KHOẢN
// ========================================

app.get(
  '/api/auth/me',
  async (req, res, next) => {
    try {
      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json({
        user: await currentUser(req)
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ĐĂNG XUẤT
// ========================================

app.post(
  '/api/auth/logout',
  async (req, res, next) => {
    try {
      await logoutAll(req, res);

      res.json({
        ok: true
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// PUBLIC CONCERT
// KHÔNG HIỂN THỊ CONCERT ĐÃ ẨN
// ========================================

app.get(
  '/api/events',
  async (req, res, next) => {
    try {
      const data = await events.find(
        activeEvents,
        {
          projection: publicEventFields
        }
      )
        .sort({
          order: 1
        })
        .toArray();

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  '/api/events/:id',
  async (req, res, next) => {
    try {
      const event = await events.findOne(
        {
          _id: req.params.id,
          ...activeEvents
        },
        {
          projection: publicEventFields
        }
      );

      if (!event) {
        return res.status(404).json({
          message: 'Concert không tồn tại.'
        });
      }

      res.json(event);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// KHÁCH ĐẶT VÉ THƯỜNG
// ========================================

app.post(
  '/api/bookings',
  requireLogin,
  requireCustomer,
  async (req, res, next) => {
    try {
      const eventId = clean(
        req.body?.eventId,
        100
      );

      const quantity = req.body?.quantity;

      if (
        !eventId ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 8
      ) {
        return res.status(400).json({
          message: 'Số lượng vé phải từ 1 đến 8.'
        });
      }

      const event = await events.findOne({
        _id: eventId,
        archived: { $ne: true },
        'zonePlan.enabled': {
          $ne: true
        }
      });

      if (!event) {
        return res.status(409).json({
          message:
            'Concert này cần chọn khu A–E hoặc đã ngừng bán.'
        });
      }

      const order = {
        code: randomUUID().toUpperCase(),
        eventId,
        customerId: req.user.id,
        eventTitle: event.title,
        date: event.date,
        venue: event.venue,
        name: req.user.name,
        email: req.user.email,
        quantity,
        total: event.price * quantity,

        payment: {
          method: null,
          status: 'unpaid'
        },

        createdAt: new Date()
      };

      const result = await events.updateOne(
        {
          _id: eventId,
          archived: { $ne: true },
          'zonePlan.enabled': {
            $ne: true
          },
          remaining: {
            $gte: quantity
          },
          title: event.title,
          date: event.date,
          venue: event.venue,
          price: event.price
        },
        {
          $inc: {
            remaining: -quantity
          },
          $push: {
            orders: order
          }
        }
      );

      if (!result.modifiedCount) {
        return res.status(409).json({
          message:
            'Concert không còn đủ vé hoặc dữ liệu đã thay đổi.'
        });
      }

      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// KHÁCH XEM VÉ CỦA MÌNH
// ========================================

app.get(
  '/api/my/bookings',
  requireLogin,
  requireCustomer,
  async (req, res, next) => {
    try {
      const data = await events.aggregate([
        {
          $unwind: '$orders'
        },
        {
          $match: {
            'orders.customerId': req.user.id
          }
        },
        {
          $replaceWith: '$orders'
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]).toArray();

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// TÌM VÉ BẰNG MÃ + EMAIL
// ========================================

app.post(
  '/api/bookings/lookup',
  async (req, res, next) => {
    try {
      const code = clean(
        req.body?.code,
        150
      ).replace(/^VEMO:/i, '').toUpperCase();

      const email = normalizeEmail(
        req.body?.email
      );

      if (!validCode(code) || !email) {
        return res.status(400).json({
          message: 'Mã vé hoặc email không hợp lệ.'
        });
      }

      const event = await events.findOne(
        {
          orders: {
            $elemMatch: {
              code,
              email
            }
          }
        },
        {
          projection: {
            orders: {
              $elemMatch: {
                code,
                email
              }
            }
          }
        }
      );

      if (!event?.orders?.[0]) {
        return res.status(404).json({
          message: 'Không tìm thấy đơn vé.'
        });
      }

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json(event.orders[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// HÀM KIỂM TRA FORM CONCERT
// ========================================

function parseEvent(body) {
  const title = clean(
    body?.title,
    100
  );

  const category = clean(
    body?.category,
    30
  );

  const date = clean(
    body?.date,
    60
  );

  const venue = clean(
    body?.venue,
    120
  );

  const description = clean(
    body?.description,
    1000
  );

  const price = body?.price;
  const remaining = body?.remaining;

  if (
    !title ||
    !Object.hasOwn(categories, category) ||
    !date ||
    !venue ||
    !description ||
    !Number.isSafeInteger(price) ||
    price < 0 ||
    price > 100000000 ||
    !Number.isInteger(remaining) ||
    remaining < 0 ||
    remaining > 100000
  ) {
    return null;
  }

  return {
    title,
    poster: title.toUpperCase(),
    category,
    date,
    venue,
    description,
    price,
    remaining,
    theme: categories[category]
  };
}

// ========================================
// ADMIN - DANH SÁCH CONCERT
// HIỂN THỊ CẢ CONCERT ĐANG ẨN
// ========================================

app.get(
  '/api/admin/events',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await events.find(
        {},
        {
          projection: {
            orders: 0,
            zonePlan: 0
          }
        }
      )
        .sort({ order: 1 })
        .toArray();

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - TẠO CONCERT
// ========================================

app.post(
  '/api/admin/events',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const event = parseEvent(
        req.body
      );

      if (!event) {
        return res.status(400).json({
          message:
            'Thông tin concert không hợp lệ.'
        });
      }

      const id = randomUUID();

      await events.insertOne({
        _id: id,
        ...event,
        order: Date.now(),
        archived: false,
        orders: [],
        createdAt: new Date()
      });

      res.status(201).json({
        ok: true,
        id,
        message: 'Tạo concert thành công.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - CHỈNH SỬA CONCERT
// ========================================

app.put(
  '/api/admin/events/:id',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const updated = parseEvent(
        req.body
      );

      const current = await events.findOne({
        _id: req.params.id
      });

      if (!current) {
        return res.status(404).json({
          message: 'Không tìm thấy concert.'
        });
      }

      if (!updated) {
        return res.status(400).json({
          message:
            'Thông tin chỉnh sửa không hợp lệ.'
        });
      }

      // Khi đã có sơ đồ 5 khu,
      // không cho sửa số vé từ form thường.
      if (
        current.zonePlan?.enabled &&
        updated.remaining !== current.remaining
      ) {
        return res.status(409).json({
          message:
            'Concert đã có sơ đồ A–E. Không được thay số vé còn lại từ form này.'
        });
      }

      // Đã có người đặt thì giữ nguyên
      // thông tin quan trọng trên vé cũ.
      if (current.orders?.length > 0) {
        if (
          current.title !== updated.title ||
          current.date !== updated.date ||
          current.venue !== updated.venue ||
          current.price !== updated.price
        ) {
          return res.status(409).json({
            message:
              'Concert đã có đơn vé. Không thể thay tên, ngày, địa điểm hoặc giá vé trực tiếp.'
          });
        }
      }

      const filter = {
        _id: current._id,
        remaining: current.remaining
      };

      if (current.zonePlan?.enabled) {
        filter['zonePlan.enabled'] = true;
      } else {
        filter['zonePlan.enabled'] = {
          $ne: true
        };
      }

      const result = await events.updateOne(
        filter,
        {
          $set: updated
        }
      );

      if (!result.matchedCount) {
        return res.status(409).json({
          message:
            'Concert vừa có thay đổi. Hãy làm mới và thử lại.'
        });
      }

      res.json({
        ok: true,
        message: 'Đã cập nhật concert.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - ẨN CONCERT
// GIỮ NGUYÊN ĐƠN VÉ VÀ QR
// ========================================

app.post(
  '/api/admin/events/:id/hide',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const result = await events.updateOne(
        {
          _id: req.params.id,
          archived: { $ne: true }
        },
        {
          $set: {
            archived: true,
            archivedAt: new Date(),
            archivedBy: req.user.id
          }
        }
      );

      if (!result.modifiedCount) {
        return res.status(404).json({
          message:
            'Concert không tồn tại hoặc đã được ẩn.'
        });
      }

      res.json({
        ok: true,
        archived: true,
        message:
          'Đã ẩn concert. Đơn vé, QR và lịch sử vẫn được giữ nguyên.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - HIỆN LẠI CONCERT
// ========================================

app.post(
  '/api/admin/events/:id/restore',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const result = await events.updateOne(
        {
          _id: req.params.id,
          archived: true
        },
        {
          $set: {
            archived: false
          },
          $unset: {
            archivedAt: '',
            archivedBy: ''
          }
        }
      );

      if (!result.modifiedCount) {
        return res.status(404).json({
          message:
            'Concert không tồn tại hoặc đang được hiển thị.'
        });
      }

      res.json({
        ok: true,
        archived: false,
        message:
          'Concert đã hiển thị trở lại cho khách hàng.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - XÓA VĨNH VIỄN CONCERT
//
// XÓA LUÔN:
// - SỰ KIỆN
// - ĐƠN VÉ LƯU TRONG EVENT
// - MÃ QR CỦA CÁC ĐƠN
// - LỊCH SỬ CHECK-IN
//
// KHÔNG TỰ ĐỘNG XÓA KHÁCH HÀNG
// ========================================

app.delete(
  '/api/admin/events/:id',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = req.params.id;

      const confirmText = req.body?.confirmation;

      if (confirmText !== 'XOA') {
        return res.status(400).json({
          message:
            'Cần nhập XOA để xác nhận xóa vĩnh viễn.'
        });
      }

      const event = await events.findOne({
        _id: id
      });

      if (!event) {
        return res.status(404).json({
          message: 'Không tìm thấy concert.'
        });
      }

      const orderCount = Array.isArray(event.orders)
        ? event.orders.length
        : 0;

      const result = await events.deleteOne({
        _id: id
      });

      if (!result.deletedCount) {
        return res.status(409).json({
          message:
            'Không xóa được concert. Hãy thử lại.'
        });
      }

      console.warn(
        `[ADMIN DELETE] ${req.user.id} xóa concert ${id}, ${orderCount} đơn vé`
      );

      res.json({
        ok: true,
        deleted: true,
        deletedOrders: orderCount,
        message:
          `Đã xóa vĩnh viễn concert và ${orderCount} đơn vé.`
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - DANH SÁCH ĐƠN
// BAO GỒM ĐƠN THUỘC CONCERT ĐÃ ẨN
// ========================================

app.get(
  '/api/admin/bookings',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await events.aggregate([
        {
          $unwind: '$orders'
        },
        {
          $replaceWith: '$orders'
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]).toArray();

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// ADMIN - CHECK-IN
// ========================================

app.post(
  '/api/admin/check-in',
  requireLogin,
  requireAdmin,
  async (req, res, next) => {
    try {
      let code = clean(
        req.body?.code,
        500
      ).replace(/^VEMO:/i, '');

      if (/^https?:\/\//i.test(code)) {
        try {
          const parsed = new URL(code);

          code = parsed.pathname.match(
            /^\/ticket\/([a-f0-9-]{36})\/?$/i
          )?.[1] || '';
        } catch {
          code = '';
        }
      }

      code = code.toUpperCase();

      if (!validCode(code)) {
        return res.status(400).json({
          message: 'Mã vé hoặc QR không hợp lệ.'
        });
      }

      const result = await events.updateOne(
        {
          orders: {
            $elemMatch: {
              code,
              checkedInAt: null
            }
          }
        },
        {
          $set: {
            'orders.$.checkedInAt': new Date(),
            'orders.$.checkedInBy': req.user.id
          }
        }
      );

      const event = await events.findOne(
        {
          'orders.code': code
        },
        {
          projection: {
            orders: {
              $elemMatch: { code }
            }
          }
        }
      );

      if (!event?.orders?.[0]) {
        return res.status(404).json({
          message: 'Không tìm thấy mã vé.'
        });
      }

      if (!result.modifiedCount) {
        return res.status(409).json({
          message:
            'Vé này đã được check-in trước đó.'
        });
      }

      res.json(event.orders[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// CONNECT MONGODB & START SERVER
// ========================================

try {
  await connectMongoDB();

  await customers.createIndex(
    { email: 1 },
    { unique: true }
  );

  await customers.createIndex(
    { username: 1 },
    {
      unique: true,
      sparse: true
    }
  );

  await sessions.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await customerSessions.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await events.createIndex({
    'orders.code': 1
  });

  // Tạo Admin lần đầu.
  // Không ghi đè mật khẩu Admin đã tồn tại.
  const adminUser = normalizeUsername(
    process.env.VEMO_ADMIN_USER
  );

  const adminPassword =
    process.env.VEMO_ADMIN_PASSWORD;

  if (
    adminUser &&
    validPassword(adminPassword)
  ) {
    await admins.updateOne(
      {
        _id: adminUser
      },
      {
        $setOnInsert: {
          ...await hashPassword(adminPassword),
          createdAt: new Date()
        }
      },
      {
        upsert: true
      }
    );
  }

  // Không tự thêm lại concert mẫu đã xóa.

  // Sơ đồ A-E + Quên/đổi mật khẩu
  await installUpgrade(app, {
    client,
    db,
    events,
    admins,
    sessions,
    customers,
    customerSessions,
    requireLogin,
    requireAdmin,
    requireCustomer
  });

  // Thanh toán ngân hàng/MoMo thủ công
  installPayments(app, {
    events,
    requireLogin,
    requireAdmin,
    requireCustomer
  });

  // Trang vé QR
  const startReceipts = installTicketReceipts(
    app,
    events
  );

  // Backend cổng 3000,
  // frontend ở 5173 khi phát triển.
  const frontendUrl =
    process.env.FRONTEND_URL ||
    'http://127.0.0.1:5173/';

  const dist = fileURLToPath(
    new URL('../dist/', import.meta.url)
  );

  if (existsSync(dist)) {
    app.use(express.static(dist));

    app.get(/.*/, (req, res) => {
      res.sendFile(
        fileURLToPath(
          new URL('../dist/index.html', import.meta.url)
        )
      );
    });
  } else {
    app.get('/', (req, res) => {
      res.redirect(frontendUrl);
    });

    app.get(
      ['/admin', '/admin/login', '/admin/index'],
      (req, res) => {
        res.redirect(frontendUrl);
      }
    );
  }

  app.use('/api', (req, res) => {
    res.status(404).json({
      message: 'API không tồn tại.'
    });
  });

  app.use((error, req, res, next) => {
    console.error('API ERROR:', error);

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      message:
        'Hệ thống gặp lỗi. Xem Terminal API.'
    });
  });

  const server = app.listen(
    PORT,
    '127.0.0.1',
    () => {
      console.log('');
      console.log('🎄 VEONLINE CHRISTMAS');
      console.log('======================');
      console.log(`API: http://127.0.0.1:${PORT}`);
      console.log(`Database: ${db.databaseName}`);
      console.log('✅ Sơ đồ 5 khu A-E');
      console.log('✅ Thanh toán thủ công');
      console.log('✅ Ẩn / Hiện lại / Xóa concert');
      console.log('======================');

      startReceipts?.();
    }
  );

  server.on('error', error => {
    console.error(
      'Lỗi cổng API:',
      error.message
    );

    process.exitCode = 1;
  });
} catch (error) {
  console.error(
    'Không khởi động được API:',
    error
  );

  await client.close();

  process.exitCode = 1;
}
