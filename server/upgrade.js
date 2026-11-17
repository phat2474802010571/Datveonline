
import nodemailer from 'nodemailer';

import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual
} from 'node:crypto';

import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const ZONE_IDS = ['A', 'B', 'C', 'D', 'E'];
const RESET_AGE = 15 * 60 * 1000;

const RESET_MESSAGE =
  'Nếu tài khoản tồn tại, hệ thống sẽ gửi liên kết khôi phục đến email đã liên kết.';

const sha256 = value =>
  createHash('sha256').update(value).digest('hex');

// =============================================
// HÀM KIỂM TRA DỮ LIỆU
// =============================================

function identifierOf(value) {
  if (typeof value !== 'string') return null;

  const result = value.trim().toLowerCase();

  return result.length > 0 && result.length <= 254
    ? result
    : null;
}

function validPassword(value) {
  return typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 128;
}

async function createPassword(password) {
  const salt = randomBytes(16).toString('hex');

  const hash = (
    await scryptAsync(password, salt, 64)
  ).toString('hex');

  return { salt, hash };
}

async function verifyPassword(password, record) {
  const candidate = await scryptAsync(
    password,
    record?.salt || '0'.repeat(32),
    64
  );

  const stored = Buffer.from(
    record?.hash || '',
    'hex'
  );

  return Boolean(record) &&
    stored.length === candidate.length &&
    timingSafeEqual(candidate, stored);
}

function validCode(code) {
  return typeof code === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
      .test(code);
}

function validZone(zoneId) {
  return typeof zoneId === 'string' &&
    ZONE_IDS.includes(zoneId);
}

function publicError(res, status, message) {
  return res.status(status).json({ message });
}

// =============================================
// CHUẨN HÓA 5 KHU A - B - C - D - E
// =============================================

function normalizeZones(input) {
  if (!Array.isArray(input) || input.length !== 5) {
    return null;
  }

  const ids = input.map(zone => zone?.id);

  if (new Set(ids).size !== 5) {
    return null;
  }

  const zones = [];

  for (const id of ZONE_IDS) {
    const source = input.find(
      zone => zone?.id === id
    );

    if (!source) return null;

    const capacity = source.capacity;

    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 100000
    ) {
      return null;
    }

    zones.push({
      id,
      name: `Khu ${id}`,
      capacity,
      booked: 0,
      remaining: capacity
    });
  }

  return zones;
}

// =============================================
// DỮ LIỆU SƠ ĐỒ TRẢ VỀ FRONTEND
// =============================================

function publicZonePlan(event) {
  const plan = event?.zonePlan;

  if (!plan?.enabled) {
    return {
      enabled: false,
      zones: []
    };
  }

  return {
    enabled: true,
    zones: plan.zones.map(zone => ({
      id: zone.id,
      name: zone.name,
      capacity: zone.capacity,
      booked: zone.booked,
      remaining: zone.remaining,

      // Chỉ minh họa dãy số, không chọn ghế lẻ.
      firstSeat: `${zone.id}1`,
      lastSeat: `${zone.id}${zone.capacity}`
    }))
  };
}

// =============================================
// KHỞI TẠO API NÂNG CẤP
// =============================================

export async function installUpgrade(app, dependencies) {
  const {
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
  } = dependencies;

  const resetTokens = db.collection(
    'password_reset_tokens'
  );

  await resetTokens.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  await events.createIndex({
    'orders.code': 1
  });

  // =========================================
  // EMAIL SMTP
  // =========================================

  const smtpReady = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.SMTP_FROM
  );

  const mailer = smtpReady
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(
          process.env.SMTP_PORT || 465
        ),
        secure:
          Number(process.env.SMTP_PORT || 465) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      })
    : null;

  const attempts = new Map();

  // =========================================
  // 1. QUÊN MẬT KHẨU
  // =========================================

  app.post(
    '/api/upgrade/password/forgot',
    async (req, res, next) => {
      try {
        const identifier = identifierOf(
          req.body?.identifier
        );

        if (!identifier) {
          return publicError(
            res,
            400,
            'Nhập username hoặc email hợp lệ.'
          );
        }

        if (!mailer) {
          return publicError(
            res,
            503,
            'Hệ thống chưa cấu hình gửi email.'
          );
        }

        // Giới hạn 3 lần yêu cầu / 15 phút.
        const key = sha256(
          `${req.ip}:${identifier}`
        );

        const now = Date.now();
        const previous = attempts.get(key);

        const count = previous?.until > now
          ? previous.count + 1
          : 1;

        if (count > 3) {
          return publicError(
            res,
            429,
            'Quá nhiều yêu cầu. Hãy thử lại sau.'
          );
        }

        attempts.set(key, {
          count,
          until: previous?.until > now
            ? previous.until
            : now + RESET_AGE
        });

        for (const [k, value] of attempts) {
          if (value.until <= now) {
            attempts.delete(k);
          }
        }

        let account = null;

        const customer = await customers.findOne({
          $or: [
            { username: identifier },
            { email: identifier }
          ]
        });

        if (customer) {
          account = {
            type: 'customer',
            id: customer._id,
            email: customer.email
          };
        } else {
          const adminUsername =
            process.env.VEMO_ADMIN_USER
              ?.trim().toLowerCase();

          const adminEmail =
            process.env.VEMO_ADMIN_EMAIL
              ?.trim().toLowerCase();

          if (
            adminUsername &&
            adminEmail &&
            (
              identifier === adminUsername ||
              identifier === adminEmail
            )
          ) {
            const admin = await admins.findOne({
              _id: adminUsername
            });

            if (admin) {
              account = {
                type: 'admin',
                id: admin._id,
                email: adminEmail
              };
            }
          }
        }

        if (!account) {
          return res.json({
            message: RESET_MESSAGE
          });
        }

        const token = randomBytes(32).toString('hex');
        const tokenHash = sha256(token);

        await resetTokens.deleteMany({
          type: account.type,
          accountId: account.id
        });

        await resetTokens.insertOne({
          _id: tokenHash,
          type: account.type,
          accountId: account.id,
          expiresAt: new Date(
            Date.now() + RESET_AGE
          ),
          createdAt: new Date()
        });

        const frontend = (
          process.env.FRONTEND_URL ||
          'http://127.0.0.1:5173'
        ).replace(/\/$/, '');

        const resetUrl =
          `${frontend}/?reset=${encodeURIComponent(token)}`;

        try {
          await mailer.sendMail({
            from: process.env.SMTP_FROM,
            to: account.email,
            subject: 'VeOnline - Khôi phục mật khẩu',
            text: [
              'Bạn đã yêu cầu đặt lại mật khẩu VeOnline.',
              '',
              'Nhấn liên kết sau:',
              resetUrl,
              '',
              'Liên kết có hiệu lực 15 phút.',
              'Nếu không yêu cầu, hãy bỏ qua email này.'
            ].join('\n')
          });
        } catch (error) {
          await resetTokens.deleteOne({
            _id: tokenHash
          });

          console.error(
            'SMTP:',
            error.message
          );

          return publicError(
            res,
            503,
            'Không gửi được email. Kiểm tra SMTP.'
          );
        }

        res.json({
          message: RESET_MESSAGE
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // =========================================
  // 2. ĐẶT LẠI MẬT KHẨU BẰNG EMAIL
  // =========================================

  app.post(
    '/api/upgrade/password/reset',
    async (req, res, next) => {
      const token = req.body?.token;
      const password = req.body?.password;

      if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(token) ||
        !validPassword(password)
      ) {
        return publicError(
          res,
          400,
          'Liên kết hoặc mật khẩu không hợp lệ.'
        );
      }

      const session = client.startSession();

      try {
        const credentials = await createPassword(
          password
        );

        let changed = false;

        await session.withTransaction(async () => {
          const reset = await resetTokens.findOneAndDelete(
            {
              _id: sha256(token),
              expiresAt: { $gt: new Date() }
            },
            { session }
          );

          if (!reset) return;

          const target = reset.type === 'admin'
            ? admins
            : customers;

          const result = await target.updateOne(
            { _id: reset.accountId },
            { $set: credentials },
            { session }
          );

          if (!result.matchedCount) return;

          if (reset.type === 'admin') {
            await sessions.deleteMany(
              { username: reset.accountId },
              { session }
            );
          } else {
            await customerSessions.deleteMany(
              { customerId: reset.accountId },
              { session }
            );
          }

          changed = true;
        });

        if (!changed) {
          return publicError(
            res,
            400,
            'Liên kết đã hết hạn hoặc đã được sử dụng.'
          );
        }

        res.json({
          message:
            'Đặt lại mật khẩu thành công. Hãy đăng nhập lại.'
        });
      } catch (error) {
        next(error);
      } finally {
        await session.endSession();
      }
    }
  );

  // =========================================
  // 3. ĐỔI MẬT KHẨU KHI ĐĂNG NHẬP
  // =========================================

  app.post(
    '/api/upgrade/password/change',
    requireLogin,
    async (req, res, next) => {
      try {
        const oldPassword = req.body?.oldPassword;
        const newPassword = req.body?.newPassword;

        if (
          typeof oldPassword !== 'string' ||
          !validPassword(newPassword)
        ) {
          return publicError(
            res,
            400,
            'Mật khẩu mới phải có 8–128 ký tự.'
          );
        }

        const target = req.user.role === 'admin'
          ? admins
          : customers;

        const account = await target.findOne({
          _id: req.user.id
        });

        if (
          !await verifyPassword(
            oldPassword,
            account
          )
        ) {
          return publicError(
            res,
            401,
            'Mật khẩu hiện tại không chính xác.'
          );
        }

        const credentials = await createPassword(
          newPassword
        );

        await target.updateOne(
          { _id: req.user.id },
          { $set: credentials }
        );

        if (req.user.role === 'admin') {
          await sessions.deleteMany({
            username: req.user.id
          });
        } else {
          await customerSessions.deleteMany({
            customerId: req.user.id
          });
        }

        res.json({
          message:
            'Đã đổi mật khẩu. Hãy đăng nhập lại.'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // =========================================
  // 4. API XEM SƠ ĐỒ 5 KHU
  // =========================================

  app.get(
    '/api/upgrade/seats/:eventId',
    async (req, res, next) => {
      try {
        const event = await events.findOne({
          _id: req.params.eventId,
          archived: { $ne: true }
        });

        if (!event) {
          return publicError(
            res,
            404,
            'Không tìm thấy concert.'
          );
        }

        res.json(publicZonePlan(event));
      } catch (error) {
        next(error);
      }
    }
  );

  // =========================================
  // 5. ADMIN TẠO SƠ ĐỒ A-E
  //
  // MỚI: CHO PHÉP CONCERT CŨ ĐÃ CÓ ĐƠN
  // =========================================

  app.put(
    '/api/upgrade/admin/seats/:eventId',
    requireLogin,
    requireAdmin,
    async (req, res, next) => {
      try {
        const eventId = req.params.eventId;

        const zones = normalizeZones(
          req.body?.zones
        );

        if (!zones) {
          return publicError(
            res,
            400,
            'Phải có đúng 5 khu A–E và sức chứa nguyên dương.'
          );
        }

        const totalCapacity = zones.reduce(
          (sum, zone) => sum + zone.capacity,
          0
        );

        const event = await events.findOne({
          _id: eventId,
          archived: { $ne: true }
        });

        if (!event) {
          return publicError(
            res,
            404,
            'Không tìm thấy concert.'
          );
        }

        if (event.zonePlan?.enabled) {
          return publicError(
            res,
            409,
            'Concert đã có sơ đồ 5 khu vực.'
          );
        }

        // ==================================
        // PHẦN NÂNG CẤP CHO CONCERT CŨ
        // ==================================
        //
        // Không kiểm tra event.orders.length.
        //
        // Ví dụ:
        // Concert đã bán 67 vé,
        // số vé còn lại là 33.
        //
        // Admin chia:
        // A = 7, B = 7, C = 7,
        // D = 6, E = 6.
        //
        // Tổng sức chứa 5 khu = 33.
        //
        // 67 vé cũ được giữ nguyên.
        // Chỉ 33 vé chưa bán được chia khu.
        //
        // Không xóa đơn hàng, không sửa QR,
        // không tự gán khu cho các đơn cũ.

        if (totalCapacity !== event.remaining) {
          return publicError(
            res,
            400,
            `Tổng sức chứa ${totalCapacity} phải bằng số vé còn lại ${event.remaining}.`
          );
        }

        // Cập nhật nguyên tử, tránh trường hợp
        // có khách mua vé đồng thời lúc tạo map.
        const result = await events.updateOne(
          {
            _id: eventId,
            archived: { $ne: true },
            'zonePlan.enabled': { $ne: true },
            remaining: totalCapacity
          },
          {
            $set: {
              zonePlan: {
                enabled: true,
                zones,
                createdAt: new Date()
              }
            }
          }
        );

        if (!result.modifiedCount) {
          return publicError(
            res,
            409,
            'Dữ liệu concert vừa thay đổi. Hãy tải lại.'
          );
        }

        res.json({
          ok: true,
          enabled: true,
          zones
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // =========================================
  // 6. KHÁCH ĐẶT VÉ THEO KHU A-E
  // =========================================

  app.post(
    '/api/upgrade/seats/book',
    requireLogin,
    requireCustomer,
    async (req, res, next) => {
      try {
        const {
          eventId,
          zoneId,
          quantity
        } = req.body || {};

        if (
          typeof eventId !== 'string' ||
          !validZone(zoneId) ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 8
        ) {
          return publicError(
            res,
            400,
            'Chọn khu vực A–E và số vé từ 1–8.'
          );
        }

        const event = await events.findOne({
          _id: eventId,
          archived: { $ne: true },
          'zonePlan.enabled': true
        });

        if (!event) {
          return publicError(
            res,
            404,
            'Sự kiện không còn mở bán hoặc chưa có sơ đồ khu vực.'
          );
        }

        const zone = event.zonePlan.zones.find(
          item => item.id === zoneId
        );

        if (!zone) {
          return publicError(
            res,
            400,
            'Khu vực không tồn tại.'
          );
        }

        if (
          zone.remaining < quantity ||
          event.remaining < quantity
        ) {
          return publicError(
            res,
            409,
            `Khu ${zoneId} không còn đủ vé.`
          );
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
          zoneId,
          zoneName: zone.name,
          quantity,
          total: event.price * quantity,
          payment: {
  status: 'unpaid',
  method: null
},
          createdAt: new Date()
        };

        // Trừ chỗ trong khu và tổng concert
        // cùng với việc thêm đơn đặt vé.

        const result = await events.updateOne(
          {
            _id: eventId,
            archived: { $ne: true },
            'zonePlan.enabled': true,
            remaining: { $gte: quantity },

            title: event.title,
            date: event.date,
            venue: event.venue,
            price: event.price,

            'zonePlan.zones': {
              $elemMatch: {
                id: zoneId,
                remaining: { $gte: quantity }
              }
            }
          },
          {
            $inc: {
              remaining: -quantity,
              'zonePlan.zones.$.remaining': -quantity,
              'zonePlan.zones.$.booked': quantity
            },
            $push: {
              orders: order
            }
          }
        );

        if (!result.modifiedCount) {
          return publicError(
            res,
            409,
            'Khu vực vừa thay đổi hoặc không đủ vé. Hãy tải lại.'
          );
        }

        res.status(201).json(order);
      } catch (error) {
        next(error);
      }
    }
  );

  // =========================================
  // 7. ADMIN ĐỔI KHU VỰC CHO KHÁCH
  // =========================================

  app.put(
    '/api/upgrade/admin/bookings/change-seats',
    requireLogin,
    requireAdmin,
    async (req, res, next) => {
      const code =
        typeof req.body?.code === 'string'
          ? req.body.code.trim().toUpperCase()
          : '';

      const newZoneId = req.body?.zoneId;

      if (
        !validCode(code) ||
        !validZone(newZoneId)
      ) {
        return publicError(
          res,
          400,
          'Mã đơn hoặc khu vực mới không hợp lệ.'
        );
      }

      const session = client.startSession();

      try {
        let updatedOrder = null;

        await session.withTransaction(async () => {
          const event = await events.findOne(
            { 'orders.code': code },
            { session }
          );

          if (!event?.zonePlan?.enabled) {
            throw new Error(
              'Đơn này không có sơ đồ khu vực.'
            );
          }

          const order = event.orders?.find(
            item => item.code === code
          );

          if (
            !order ||
            !validZone(order.zoneId)
          ) {
            throw new Error(
              'Không tìm thấy đơn vé có khu vực.'
            );
          }

          if (order.checkedInAt) {
            throw new Error(
              'Vé đã check-in, không thể đổi khu.'
            );
          }

          const oldZoneId = order.zoneId;

          if (oldZoneId === newZoneId) {
            throw new Error(
              'Khách đang ở khu này rồi.'
            );
          }

          const oldZone = event.zonePlan.zones.find(
            zone => zone.id === oldZoneId
          );

          const newZone = event.zonePlan.zones.find(
            zone => zone.id === newZoneId
          );

          if (!oldZone || !newZone) {
            throw new Error(
              'Không tìm thấy khu vực.'
            );
          }

          const quantity = order.quantity;

          if (
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            newZone.remaining < quantity
          ) {
            throw new Error(
              'Khu vực mới không đủ chỗ trống.'
            );
          }

          // Chiếm chỗ trong khu mới.
          const occupy = await events.updateOne(
            {
              _id: event._id,
              'zonePlan.zones': {
                $elemMatch: {
                  id: newZoneId,
                  remaining: { $gte: quantity }
                }
              }
            },
            {
              $inc: {
                'zonePlan.zones.$.remaining': -quantity,
                'zonePlan.zones.$.booked': quantity
              }
            },
            { session }
          );

          if (!occupy.modifiedCount) {
            throw new Error(
              'Khu mới không còn đủ chỗ.'
            );
          }

          // Trả số chỗ về khu cũ.
          const release = await events.updateOne(
            {
              _id: event._id,
              'zonePlan.zones.id': oldZoneId
            },
            {
              $inc: {
                'zonePlan.zones.$.remaining': quantity,
                'zonePlan.zones.$.booked': -quantity
              }
            },
            { session }
          );

          if (!release.modifiedCount) {
            throw new Error(
              'Không giải phóng được khu cũ.'
            );
          }

          // Lưu khu mới trong đơn của khách.
          const change = await events.updateOne(
            {
              _id: event._id,
              orders: {
                $elemMatch: {
                  code,
                  checkedInAt: null
                }
              }
            },
            {
              $set: {
                'orders.$.zoneId': newZoneId,
                'orders.$.zoneName': newZone.name,
                'orders.$.zoneChangedAt': new Date(),
                'orders.$.zoneChangedBy': req.user.id
              }
            },
            { session }
          );

          if (!change.modifiedCount) {
            throw new Error(
              'Đơn vé vừa thay đổi. Hãy tải lại.'
            );
          }

          updatedOrder = {
            ...order,
            zoneId: newZoneId,
            zoneName: newZone.name
          };
        });

        res.json({
          ok: true,
          order: updatedOrder
        });
      } catch (error) {
        if (
          error.hasErrorLabel?.(
            'TransientTransactionError'
          )
        ) {
          return publicError(
            res,
            409,
            'Dữ liệu vừa thay đổi. Hãy tải lại và thử lần nữa.'
          );
        }

        return publicError(
          res,
          409,
          error.message ||
          'Không đổi được khu vực.'
        );
      } finally {
        await session.endSession();
      }
    }
  );

  console.log(
    '✅ VeOnline: Đã kích hoạt khôi phục mật khẩu và 5 khu vực A–E'
  );
}
