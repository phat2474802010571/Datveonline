
import 'dotenv/config';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import {
  client,
  db,
  connectMongoDB
} from './mongodb.js';

const derivePassword = promisify(scrypt);

const username =
  process.env.VEMO_ADMIN_USER || 'admin';

async function main() {
  try {
    const password = process.env.NEW_ADMIN_PASSWORD;

    if (!password || password.length < 8 || password.length > 128) {
      throw new Error('Mật khẩu mới phải dài 8–128 ký tự.');
    }

    await connectMongoDB();

    const admins = db.collection('admins');
    const admin = await admins.findOne({
      _id: username
    });

    if (!admin) {
      throw new Error(
        `Không tìm thấy Admin "${username}" trong MongoDB.`
      );
    }

    const salt = randomBytes(16).toString('hex');

    const hash = (
      await derivePassword(password, salt, 64)
    ).toString('hex');

    await admins.updateOne(
      { _id: username },
      {
        $set: {
          salt,
          hash,
          passwordChangedAt: new Date()
        }
      }
    );

    await db.collection('admin_sessions').deleteMany({
      username
    });

    console.log(`✅ Đặt lại mật khẩu Admin "${username}" thành công!`);
  } catch (error) {
    console.error('❌ Lỗi reset:', error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
