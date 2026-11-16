
import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import {
  randomUUID, randomBytes, scrypt,
  createHash, timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  client, db, events, admins, sessions,
  connectMongoDB
} from './mongodb.js';
import { sampleEvents } from './events.js';
import { installTicketReceipts } from './ticket-receipt.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const scryptAsync = promisify(scrypt);

const customers = db.collection('customers');
const customerSessions = db.collection('customer_sessions');

const ADMIN_COOKIE = 'vemo_admin_v2';
const CUSTOMER_COOKIE = 'vemo_customer_v1';
const SESSION_MS = 8 * 60 * 60 * 1000;
const active = { archived: { $ne: true } };
const projection = { orders: 0, archived: 0 };

const themes = {
  'Âm nhạc': 'night',
  Workshop: 'clay',
  'Triển lãm': 'frame'
};

app.use(express.json({ limit: '20kb' }));

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/'
};

const adminLoginFile = fileURLToPath(
  new URL('../admin/login.html', import.meta.url)
);
const adminIndexFile = fileURLToPath(
  new URL('../admin/index.html', import.meta.url)
);
const scannerFile = fileURLToPath(
  new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url)
);
const dist = fileURLToPath(
  new URL('../dist/', import.meta.url)
);

function clean(value, max = 200) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s && s.length <= max ? s : null;
}

function emailOf(value) {
  const s = clean(value, 254)?.toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
    ? s : null;
}

function cookie(req, name) {
  const part = (req.headers.cookie || '')
    .split(';')
    .find(x => x.trim().startsWith(name + '='));
  return part ? part.trim().slice(name.length + 1) : null;
}

function tokenHash(token) {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function setAuthCookie(res, name, token) {
  res.cookie(name, token, {
    ...cookieOptions,
    maxAge: SESSION_MS
  });
}

function clearAuthCookies(res) {
  res.clearCookie(ADMIN_COOKIE, cookieOptions);
  res.clearCookie(CUSTOMER_COOKIE, cookieOptions);
}

async function passwordHash(password, salt) {
  return (await scryptAsync(password, salt, 64))
    .toString('hex');
}

async function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) {
    // Vẫn chạy hàm để hạn chế khác biệt thời gian.
    await passwordHash(password, '0'.repeat(32));
    return false;
  }

  const calculated = Buffer.from(
    await passwordHash(password, record.salt), 'hex'
  );
  const stored = Buffer.from(record.hash, 'hex');

  return stored.length === calculated.length &&
    timingSafeEqual(stored, calculated);
}

async function createInitialAdmin() {
  const username = process.env.VEMO_ADMIN_USER
    ?.trim().toLowerCase();
  const password = process.env.VEMO_ADMIN_PASSWORD;

  if (!username && !password) return;

  if (
    !/^[a-z0-9._-]{3,60}$/.test(username ?? '') ||
    !password || password.length < 8 ||
    password.length > 128
  ) {
    throw new Error('Cấu hình Admin không hợp lệ');
  }

  const salt = randomBytes(16).toString('hex');
  const hash = await passwordHash(password, salt);

  await admins.updateOne(
    { _id: username },
    {
      $setOnInsert: {
        salt, hash, createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

async function currentUser(req) {
  const adminToken = cookie(req, ADMIN_COOKIE);

  if (adminToken && /^[a-f0-9]{64}$/.test(adminToken)) {
    const session = await sessions.findOne({
      _id: tokenHash(adminToken),
      expiresAt: { $gt: new Date() }
    });

    if (session) {
      const admin = await admins.findOne({
        _id: session.username
      });

      if (admin) {
        return {
          id: admin._id,
          name: admin._id,
          role: 'admin'
        };
      }
    }
  }

  const customerToken = cookie(req, CUSTOMER_COOKIE);

  if (customerToken && /^[a-f0-9]{64}$/.test(customerToken)) {
    const session = await customerSessions.findOne({
      _id: tokenHash(customerToken),
      expiresAt: { $gt: new Date() }
    });

    if (session) {
      const customer = await customers.findOne({
        _id: session.customerId
      });

      if (customer) {
        return {
          id: customer._id,
          name: customer.name,
          email: customer.email,
          role: 'customer'
        };
      }
    }
  }

  return null;
}

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
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      message: 'Bạn không có quyền quản trị.'
    });
  }
  next();
}

async function createSession(res, type, id) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MS);

  if (type === 'admin') {
    await sessions.insertOne({
      _id: tokenHash(token),
      username: id,
      expiresAt
    });
    setAuthCookie(res, ADMIN_COOKIE, token);
  } else {
    await customerSessions.insertOne({
      _id: tokenHash(token),
      customerId: id,
      expiresAt
    });
    setAuthCookie(res, CUSTOMER_COOKIE, token);
  }
}

async function logout(req, res) {
  const a = cookie(req, ADMIN_COOKIE);
  const c = cookie(req, CUSTOMER_COOKIE);

  if (a) {
    await sessions.deleteOne({ _id: tokenHash(a) });
  }
  if (c) {
    await customerSessions.deleteOne({
      _id: tokenHash(c)
    });
  }
  clearAuthCookies(res);
}

// =====================================
// ĐĂNG KÝ / ĐĂNG NHẬP CHUNG
// =====================================

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 100);
    const email = emailOf(req.body?.email);
    const password = req.body?.password;

    if (
      !name || !email ||
      typeof password !== 'string' ||
      password.length < 8 || password.length > 128
    ) {
      return res.status(400).json({
        message: 'Nhập tên, email và mật khẩu từ 8 ký tự.'
      });
    }

    const salt = randomBytes(16).toString('hex');
    const hash = await passwordHash(password, salt);

    const id = randomUUID();

    try {
      await customers.insertOne({
        _id: id, name, email, salt, hash,
        createdAt: new Date()
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: 'Email đã được đăng ký.'
        });
      }
      throw error;
    }

    await logout(req, res);
    await createSession(res, 'customer', id);

    res.status(201).json({
      user: { id, name, email, role: 'customer' }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const login = clean(req.body?.login, 254)
      ?.toLowerCase();
    const password = req.body?.password;

    if (
      !login || typeof password !== 'string' ||
      !password || password.length > 128
    ) {
      return res.status(400).json({
        message: 'Thông tin đăng nhập không hợp lệ.'
      });
    }

    // Kiểm tra tài khoản Admin hiện có trước.
    const admin = await admins.findOne({ _id: login });

    if (admin && await verifyPassword(password, admin)) {
      await logout(req, res);
      await createSession(res, 'admin', admin._id);

      return res.json({
        user: {
          id: admin._id,
          name: admin._id,
          role: 'admin'
        }
      });
    }

    const customer = await customers.findOne({
      email: login
    });

    if (
      !customer ||
      !await verifyPassword(password, customer)
    ) {
      return res.status(401).json({
        message: 'Sai tài khoản hoặc mật khẩu.'
      });
    }

    await logout(req, res);
    await createSession(res, 'customer', customer._id);

    res.json({
      user: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        role: 'customer'
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ user: await currentUser(req) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await logout(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// =====================================
// SỰ KIỆN CÔNG KHAI
// =====================================

app.get('/api/health', async (req, res, next) => {
  try {
    await db.command({ ping: 1 });
    res.json({
      ok: true,
      database: db.databaseName
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/events', async (req, res, next) => {
  try {
    const data = await events.find(active, {
      projection
    }).sort({ order: 1, title: 1 }).toArray();

    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/api/events/:id', async (req, res, next) => {
  try {
    const event = await events.findOne({
      _id: req.params.id,
      ...active
    }, { projection });

    if (!event) {
      return res.status(404).json({
        message: 'Không tìm thấy sự kiện.'
      });
    }
    res.json(event);
  } catch (error) {
    next(error);
  }
});

// =====================================
// ĐẶT VÉ
// =====================================

app.post(
  '/api/bookings',
  requireLogin,
  async (req, res, next) => {
    try {
      const eventId = clean(req.body?.eventId, 100);
      const quantity = Number(req.body?.quantity);
      const name = clean(
        req.body?.name || req.user.name, 100
      );
      const email = emailOf(
        req.body?.email || req.user.email
      );

      if (
        !eventId || !name || !email ||
        !Number.isInteger(quantity) ||
        quantity < 1 || quantity > 8
      ) {
        return res.status(400).json({
          message: 'Thông tin đặt vé không hợp lệ.'
        });
      }

      const event = await events.findOne({
        _id: eventId,
        ...active
      });

      if (!event) {
        return res.status(404).json({
          message: 'Sự kiện không tồn tại.'
        });
      }

      const order = {
        code: randomUUID().toUpperCase(),
        customerId: req.user.id,
        eventId,
        eventTitle: event.title,
        date: event.date,
        venue: event.venue,
        name,
        email,
        quantity,
        total: event.price * quantity,
        createdAt: new Date()
      };

      // Giảm số vé và lưu đơn trong cùng một update.
      const result = await events.updateOne(
        {
          _id: eventId,
          ...active,
          remaining: { $gte: quantity },
          title: event.title,
          price: event.price,
          date: event.date,
          venue: event.venue
        },
        {
          $inc: { remaining: -quantity },
          $push: { orders: order }
        }
      );

      if (!result.modifiedCount) {
        return res.status(409).json({
          message: 'Số vé không đủ hoặc sự kiện đã thay đổi.'
        });
      }

      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  }
);

// =====================================
// VÉ CỦA TÔI
// =====================================

app.get(
  '/api/my/bookings',
  requireLogin,
  async (req, res, next) => {
    try {
      const match = req.user.role === 'admin'
        ? {}
        : { 'orders.customerId': req.user.id };

      const pipeline = [
        { $unwind: '$orders' },
        ...(Object.keys(match).length
          ? [{ $match: match }]
          : []),
        { $replaceWith: '$orders' },
        { $sort: { createdAt: -1 } }
      ];

      const orders = await events.aggregate(
        pipeline
      ).toArray();

      res.json(orders);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/api/bookings/lookup',
  async (req, res, next) => {
    try {
      const code = clean(req.body?.code, 120)
        ?.replace(/^VEMO:/i, '')
        .toUpperCase();
      const email = emailOf(req.body?.email);

      if (
        !code || !email ||
        !/^[A-F0-9-]{36}$/.test(code)
      ) {
        return res.status(400).json({
          message: 'Mã vé hoặc email không hợp lệ.'
        });
      }

      const event = await events.findOne(
        {
          orders: {
            $elemMatch: { code, email }
          }
        },
        {
          projection: {
            _id: 0,
            orders: {
              $elemMatch: { code, email }
            }
          }
        }
      );

      const order = event?.orders?.[0];

      if (!order) {
        return res.status(404).json({
          message: 'Không tìm thấy vé.'
        });
      }

      res.json(order);
    } catch (error) {
      next(error);
    }
  }
);

// =====================================
// API ADMIN
// =====================================

app.use(
  '/api/admin',
  requireLogin,
  requireAdmin
);

app.get('/api/admin/me', (req, res) => {
  res.json({ username: req.user.name });
});

app.get('/api/admin/events', async (req, res, next) => {
  try {
    res.json(await events.find(active, {
      projection
    }).sort({ order: 1 }).toArray());
  } catch (error) {
    next(error);
  }
});

function parseEvent(body) {
  const title = clean(body?.title, 100);
  const category = clean(body?.category, 30);
  const date = clean(body?.date, 60);
  const venue = clean(body?.venue, 120);
  const description = clean(body?.description, 1000);
  const price = Number(body?.price);
  const remaining = Number(body?.remaining);

  if (
    !title || !category ||
    !Object.hasOwn(themes, category) ||
    !date || !venue || !description ||
    !Number.isSafeInteger(price) ||
    price < 0 || price > 100000000 ||
    !Number.isInteger(remaining) ||
    remaining < 0 || remaining > 100000
  ) return null;

  return {
    title,
    poster: title.toUpperCase(),
    category, date, venue, description,
    price, remaining,
    theme: themes[category]
  };
}

app.post(
  '/api/admin/events',
  async (req, res, next) => {
    try {
      const event = parseEvent(req.body);
      if (!event) {
        return res.status(400).json({
          message: 'Thông tin sự kiện không hợp lệ.'
        });
      }

      const id = randomUUID();
      await events.insertOne({
        _id: id,
        ...event,
        order: Date.now(),
        orders: []
      });

      res.status(201).json({ id });
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  '/api/admin/events/:id',
  async (req, res, next) => {
    try {
      const event = parseEvent(req.body);
      const originalRemaining =
        Number(req.body?.originalRemaining);

      if (
        !event ||
        !Number.isInteger(originalRemaining) ||
        originalRemaining < 0
      ) {
        return res.status(400).json({
          message: 'Dữ liệu sửa không hợp lệ.'
        });
      }

      const result = await events.updateOne(
        {
          _id: req.params.id,
          ...active,
          remaining: originalRemaining
        },
        { $set: event }
      );

      if (!result.matchedCount) {
        return res.status(409).json({
          message: 'Dữ liệu đã thay đổi. Hãy tải lại.'
        });
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  '/api/admin/events/:id',
  async (req, res, next) => {
    try {
      const result = await events.updateOne(
        {
          _id: req.params.id,
          ...active
        },
        {
          $set: {
            archived: true,
            archivedAt: new Date()
          }
        }
      );

      if (!result.matchedCount) {
        return res.status(404).json({
          message: 'Không tìm thấy sự kiện.'
        });
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  '/api/admin/bookings',
  async (req, res, next) => {
    try {
      const orders = await events.aggregate([
        { $unwind: '$orders' },
        { $replaceWith: '$orders' },
        { $sort: { createdAt: -1 } }
      ]).toArray();
      res.json(orders);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/api/admin/check-in',
  async (req, res, next) => {
    try {
      let code = clean(req.body?.code, 200)
        ?.replace(/^VEMO:/i, '');

      if (code) {
        try {
          const url = new URL(code);
          code = url.pathname.split('/').filter(Boolean)
            .pop();
        } catch {}
      }

      code = code?.toUpperCase();

      if (
        !code ||
        !/^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(code)
      ) {
        return res.status(400).json({
          message: 'Mã vé không hợp lệ.'
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
        { 'orders.code': code },
        {
          projection: {
            orders: { $elemMatch: { code } }
          }
        }
      );

      if (!event) {
        return res.status(404).json({
          message: 'Không tìm thấy vé.'
        });
      }

      if (!result.modifiedCount) {
        return res.status(409).json({
          message: 'Vé này đã check-in.'
        });
      }

      res.json(event.orders[0]);
    } catch (error) {
      next(error);
    }
  }
);

// =====================================
// QR / BIÊN NHẬN VÉ
// =====================================

const startPhoneReceipts =
  installTicketReceipts(app, events);

// Giữ tương thích với Admin cũ
app.get('/admin', (req, res) => {
  res.redirect('/admin/index');
});

app.get('/admin/login', (req, res) => {
  res.sendFile(adminLoginFile);
});

app.get('/admin/index', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (user?.role !== 'admin') {
      return res.redirect('/admin/login');
    }
    res.sendFile(adminIndexFile);
  } catch (error) {
    next(error);
  }
});

app.get('/admin/jsQR.js', (req, res) => {
  res.sendFile(scannerFile);
});

// API lỗi
app.use('/api', (req, res) => {
  res.status(404).json({
    message: 'API không tồn tại.'
  });
});

if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (req, res) => {
    res.sendFile(fileURLToPath(
      new URL('../dist/index.html', import.meta.url)
    ));
  });
}

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    message: error.status
      ? 'Yêu cầu không hợp lệ.'
      : 'Hệ thống gặp lỗi. Vui lòng thử lại.'
  });
});

// =====================================
// KHỞI ĐỘNG SERVER
// =====================================

try {
  await connectMongoDB();

  await sessions.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await customerSessions.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await customers.createIndex(
    { email: 1 },
    { unique: true }
  );

  await events.createIndex({
    'orders.code': 1
  });

  await createInitialAdmin();

  if (sampleEvents.length > 0) {
    await events.bulkWrite(
      sampleEvents.map((event, order) => ({
        updateOne: {
          filter: { _id: event._id },
          update: {
            $setOnInsert: {
              ...event, order, orders: []
            }
          },
          upsert: true
        }
      }))
    );
  }

  const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log('🎄 VEONLINE CHRISTMAS');
      console.log(`API: http://localhost:${PORT}`);
      console.log('MongoDB đã kết nối');
      startPhoneReceipts();
    }
  );

  server.on('error', error => {
    console.error('Lỗi mở cổng:', error.message);
    process.exitCode = 1;
  });

} catch (error) {
  console.error('Không khởi động API:', error.message);
  await client.close();
  process.exitCode = 1;
}
