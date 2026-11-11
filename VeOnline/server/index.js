import express from 'express';
import { MongoClient } from 'mongodb';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { sampleEvents } from './events.js';
import { installTicketReceipts } from './ticket-receipt.js';

const app = express();
app.use(express.json({ limit: '10kb' }));

const client = new MongoClient(
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  { serverSelectionTimeoutMS: 5000 },
);

const db = client.db(process.env.MONGODB_DB || 'veonline');
const events = db.collection('events');
const admins = db.collection('admins');
const sessions = db.collection('admin_sessions');

const derivePassword = promisify(scrypt);
const sessionAge = 8 * 60 * 60 * 1000;
const cookieName = 'vemo_admin_v2';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
};

const activeEvent = { archived: { $ne: true } };
const publicFields = { orders: 0, archived: 0 };

const categoryThemes = {
  'Âm nhạc': 'night',
  Workshop: 'clay',
  'Triển lãm': 'frame',
};

const loginPage = fileURLToPath(new URL('../admin/login.html', import.meta.url));
const adminPage = fileURLToPath(new URL('../admin/index.html', import.meta.url));
const scannerScript = fileURLToPath(
  new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url),
);
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const uuidPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const bookingCodePattern = new RegExp(`^${uuidPattern}$`, 'i');
const receiptPathPattern = new RegExp(`^/ticket/(${uuidPattern})/?$`, 'i');

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function normalizeEmail(value) {
  const email = cleanText(value, 254)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeCode(value) {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  const code = raw.replace(/^VEMO:/i, '');

  if (bookingCodePattern.test(code)) return code.toUpperCase();

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const match = receiptPathPattern.exec(url.pathname);
    return match ? match[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function getToken(req) {
  for (const cookie of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = cookie.trim().split('=');

    if (name === cookieName && /^[a-f0-9]{64}$/.test(value ?? '')) {
      return value;
    }
  }

  return null;
}

function clearLegacyCookies(res) {
  res.clearCookie('vemo_admin', cookieOptions);
  res.clearCookie('vemo_admin', { ...cookieOptions, path: '/api/admin' });
}

async function getAdmin(req) {
  const token = getToken(req);
  if (!token) return null;

  const session = await sessions.findOne({
    _id: hashToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session) return null;

  return admins.findOne(
    { _id: session.username },
    { projection: { _id: 1 } },
  );
}

async function requireAdmin(req, res, next) {
  const admin = await getAdmin(req);

  if (!admin) {
    return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn.' });
  }

  req.admin = admin._id;
  next();
}

async function createInitialAdmin() {
  const username = process.env.VEMO_ADMIN_USER?.trim().toLowerCase();
  const password = process.env.VEMO_ADMIN_PASSWORD;

  if (!username && !password) return;

  if (
    !/^[a-z0-9._-]{3,60}$/.test(username ?? '') ||
    !password || password.length < 8 || password.length > 128
  ) {
    throw new Error('Tên admin cần 3–60 ký tự, mật khẩu cần 8–128 ký tự.');
  }

  const salt = randomBytes(16).toString('hex');
  const hash = (await derivePassword(password, salt, 64)).toString('hex');

  const result = await admins.updateOne(
    { _id: username },
    { $setOnInsert: { salt, hash, createdAt: new Date() } },
    { upsert: true },
  );

  if (result.upsertedCount) console.log(`Đã tạo admin: ${username}`);
}

async function findOrder(match) {
  const event = await events.findOne(
    { orders: { $elemMatch: match } },
    { projection: { _id: 0, orders: { $elemMatch: match } } },
  );

  return event?.orders?.[0] ?? null;
}

function parseEvent(body) {
  const title = cleanText(body?.title, 100);
  const category = cleanText(body?.category, 30);
  const date = cleanText(body?.date, 60);
  const venue = cleanText(body?.venue, 120);
  const description = cleanText(body?.description, 1000);
  const price = body?.price;
  const remaining = body?.remaining;

  if (
    !title || !category || !Object.hasOwn(categoryThemes, category) ||
    !date || !venue || !description ||
    !Number.isSafeInteger(price) || price < 0 || price > 100_000_000 ||
    !Number.isInteger(remaining) || remaining < 0 || remaining > 100_000
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
    theme: categoryThemes[category],
  };
}

function listEvents() {
  return events.find(activeEvent, { projection: publicFields })
    .sort({ order: 1, title: 1 })
    .toArray();
}

// Hai trang quản trị riêng
app.get('/admin', (req, res) => res.redirect('/admin/index'));

app.get('/admin/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (await getAdmin(req)) return res.redirect('/admin/index');

  res.sendFile(loginPage);
});

app.get('/admin/index', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!await getAdmin(req)) return res.redirect('/admin/login');

  res.sendFile(adminPage);
});

app.get('/admin/jsQR.js', (req, res) => {
  res.sendFile(scannerScript);
});

// API bán vé
app.get('/api/events', async (req, res) => {
  res.json(await listEvents());
});

app.get('/api/events/:id', async (req, res) => {
  const event = await events.findOne(
    { _id: req.params.id, ...activeEvent },
    { projection: publicFields },
  );

  if (!event) return res.status(404).json({ message: 'Không tìm thấy sự kiện.' });

  res.json(event);
});

app.post('/api/bookings', async (req, res) => {
  const { eventId, quantity, name: rawName, email: rawEmail } = req.body ?? {};
  const name = cleanText(rawName, 100);
  const email = normalizeEmail(rawEmail);

  if (
    typeof eventId !== 'string' || !name || !email ||
    !Number.isInteger(quantity) || quantity < 1 || quantity > 8
  ) {
    return res.status(400).json({
      message: 'Kiểm tra họ tên, email và số vé (1–8).',
    });
  }

  const event = await events.findOne(
    { _id: eventId, ...activeEvent },
    { projection: publicFields },
  );

  if (!event) {
    return res.status(404).json({ message: 'Sự kiện không còn mở bán.' });
  }

  const order = {
    code: randomUUID().toUpperCase(),
    eventTitle: event.title,
    date: event.date,
    venue: event.venue,
    name,
    email,
    quantity,
    total: event.price * quantity,
    createdAt: new Date(),
  };

  const result = await events.updateOne(
    {
      _id: eventId,
      ...activeEvent,
      remaining: { $gte: quantity },
      title: event.title,
      date: event.date,
      venue: event.venue,
      price: event.price,
    },
    {
      $inc: { remaining: -quantity },
      $push: { orders: order },
    },
  );

  if (!result.modifiedCount) {
    return res.status(409).json({
      message: 'Thông tin sự kiện đã thay đổi hoặc số vé còn lại không đủ. Hãy tải lại.',
    });
  }

  res.set('Cache-Control', 'no-store').status(201).json(order);
});

app.post('/api/bookings/lookup', async (req, res) => {
  const code = normalizeCode(req.body?.code);
  const email = normalizeEmail(req.body?.email);

  if (!code || !email) {
    return res.status(400).json({ message: 'Nhập mã đặt vé và email hợp lệ.' });
  }

  const order = await findOrder({ code, email });

  if (!order) {
    return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
  }

  res.set('Cache-Control', 'no-store').json(order);
});

// Đăng nhập và đăng xuất Admin
app.use('/api/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.post('/api/admin/login', async (req, res) => {
  const username = cleanText(req.body?.username, 60)?.toLowerCase();
  const password = req.body?.password;

  if (!username || typeof password !== 'string' || !password || password.length > 128) {
    return res.status(400).json({ message: 'Nhập tài khoản và mật khẩu hợp lệ.' });
  }

  const admin = await admins.findOne({ _id: username });
  const supplied = await derivePassword(password, admin?.salt ?? '0'.repeat(32), 64);
  const stored = Buffer.from(admin?.hash ?? '', 'hex');

  if (!admin || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu.' });
  }

  const token = randomBytes(32).toString('hex');

  await sessions.insertOne({
    _id: hashToken(token),
    username,
    expiresAt: new Date(Date.now() + sessionAge),
  });

  const previous = getToken(req);
  if (previous) await sessions.deleteOne({ _id: hashToken(previous) });

  clearLegacyCookies(res);
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionAge });
  res.json({ username });
});

app.post('/api/admin/logout', async (req, res) => {
  const token = getToken(req);
  if (token) await sessions.deleteOne({ _id: hashToken(token) });

  clearLegacyCookies(res);
  res.clearCookie(cookieName, cookieOptions);
  res.json({ ok: true });
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/me', (req, res) => {
  res.json({ username: req.admin });
});

// Thêm, sửa và xóa sự kiện
app.get('/api/admin/events', async (req, res) => {
  res.json(await listEvents());
});

app.post('/api/admin/events', async (req, res) => {
  const event = parseEvent(req.body);

  if (!event) {
    return res.status(400).json({ message: 'Kiểm tra thông tin sự kiện và số vé.' });
  }

  const id = randomUUID();

  await events.insertOne({
    _id: id,
    ...event,
    order: Date.now(),
    orders: [],
  });

  res.status(201).json({ id });
});

app.put('/api/admin/events/:id', async (req, res) => {
  const event = parseEvent(req.body);
  const originalRemaining = req.body?.originalRemaining;

  if (!event || !Number.isInteger(originalRemaining) || originalRemaining < 0) {
    return res.status(400).json({ message: 'Kiểm tra lại thông tin sự kiện.' });
  }

  const filter = { _id: req.params.id, ...activeEvent };

  const result = await events.updateOne(
    { ...filter, remaining: originalRemaining },
    { $set: event },
  );

  if (!result.matchedCount) {
    const existing = await events.findOne(filter, { projection: { _id: 1 } });

    return existing
      ? res.status(409).json({ message: 'Số vé đã thay đổi. Bấm Tải lại rồi sửa lại.' })
      : res.status(404).json({ message: 'Không tìm thấy sự kiện.' });
  }

  res.json({ ok: true });
});

app.delete('/api/admin/events/:id', async (req, res) => {
  const result = await events.updateOne(
    { _id: req.params.id, ...activeEvent },
    { $set: { archived: true, archivedAt: new Date() } },
  );

  if (!result.matchedCount) {
    return res.status(404).json({ message: 'Không tìm thấy sự kiện.' });
  }

  res.json({ ok: true });
});

// Danh sách đơn và check-in
app.get('/api/admin/bookings', async (req, res) => {
  const orders = await events.aggregate([
    { $unwind: '$orders' },
    { $replaceWith: '$orders' },
    { $sort: { createdAt: -1 } },
  ]).toArray();

  res.json(orders);
});

app.post('/api/admin/check-in', async (req, res) => {
  const code = normalizeCode(req.body?.code);

  if (!code) {
    return res.status(400).json({ message: 'Mã QR hoặc mã đặt vé không hợp lệ.' });
  }

  // Chỉ một yêu cầu có thể đánh dấu check-in cho cùng một đơn.
  const result = await events.updateOne(
    { orders: { $elemMatch: { code, checkedInAt: null } } },
    {
      $set: {
        'orders.$.checkedInAt': new Date(),
        'orders.$.checkedInBy': req.admin,
      },
    },
  );

  const order = await findOrder({ code });

  if (!order) {
    return res.status(404).json({ message: 'Không tìm thấy mã đặt vé.' });
  }

  if (!result.modifiedCount) {
    return res.status(409).json({ message: 'Đơn này đã check-in.' });
  }

  res.json(order);
});

function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.status === 400 || error.status === 413) {
    return res.status(error.status).json({ message: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  console.error(error);

  if (error.status === 404) {
    return res.status(404).json({ message: 'Không tìm thấy file trang.' });
  }

  res.status(500).json({ message: 'Hệ thống đang gặp lỗi. Thử lại sau.' });
}

try {
  // Đăng ký /ticket/:code và /api/ticket-qr/:code trước route 404.
  const startPhoneReceipts = installTicketReceipts(app, events);

  app.use('/api', (req, res) => {
    res.status(404).json({ message: 'API không tồn tại.' });
  });

  if (existsSync(dist)) app.use(express.static(dist));
  app.use(handleError);

  await client.connect();
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await events.createIndex({ 'orders.code': 1 });
  await createInitialAdmin();

  await events.bulkWrite(sampleEvents.map((event, order) => ({
    updateOne: {
      filter: { _id: event._id },
      update: { $setOnInsert: { ...event, order, orders: [] } },
      upsert: true,
    },
  })));

  const server = app.listen(3000, '127.0.0.1', () => {
    console.log('Vé Mở: http://localhost:3000');
    console.log('Admin: http://localhost:3000/admin/login');
    startPhoneReceipts();
  });

  server.on('error', async (error) => {
    console.error('Không mở được cổng 3000:', error.message);
    await client.close();
    process.exitCode = 1;
  });
} catch (error) {
  console.error('Không khởi động được API:', error.message);
  await client.close();
  process.exitCode = 1;
}