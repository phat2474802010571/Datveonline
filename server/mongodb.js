
import 'dotenv/config';
import { MongoClient } from 'mongodb';

// Danh sách tài khoản MongoDB Atlas
const mongoAccounts = {
  PHAT: process.env.MONGODB_URI_PHAT,
  DUC: process.env.MONGODB_URI_DUC,
};

// Lựa chọn tài khoản
const selectedAccount = (
  process.env.MONGODB_ACCOUNT || 'PHAT'
).trim().toUpperCase();

if (!Object.hasOwn(mongoAccounts, selectedAccount)) {
  throw new Error(
    `Tài khoản ${selectedAccount} không hợp lệ. Chọn PHAT hoặc DUC.`
  );
}

const mongoUri = mongoAccounts[selectedAccount];

if (!mongoUri || mongoUri.includes('MAT_KHAU_')) {
  throw new Error(
    `Chưa cấu hình đầy đủ MongoDB cho ${selectedAccount}`
  );
}

// Khởi tạo MongoDB Client
const client = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

// Chọn database chung
const databaseName = process.env.MONGODB_DB || 'veonline';
const db = client.db(databaseName);

// Các collections
const events = db.collection('events');
const admins = db.collection('admins');
const sessions = db.collection('admin_sessions');

// Kiểm tra kết nối
async function connectMongoDB() {
  await client.connect();
  await db.command({ ping: 1 });

  console.log('✅ MongoDB Atlas kết nối thành công!');
  console.log(`✅ Tài khoản: ${selectedAccount}`);
  console.log(`✅ Database: ${databaseName}`);

  return db;
}

export {
  client,
  db,
  events,
  admins,
  sessions,
  connectMongoDB,
};
