# VeOnline — Hệ thống bán vé sự kiện online

Đồ án môn học dùng HTML, CSS, JavaScript, ReactJS, NodeJS, ExpressJS và MongoDB.

Chức năng chính:
- Khách hàng: đăng ký, đăng nhập, xem sự kiện, đặt vé (vé thường hoặc chọn khu A–E), xem vé của mình, tra cứu vé bằng mã + email, quên / đổi mật khẩu, báo đã chuyển khoản (ngân hàng / MoMo).
- Admin: thêm / sửa / ẩn / hiện lại / xóa sự kiện, cấu hình sơ đồ khu A–E, xem danh sách đơn, xác nhận thanh toán, check-in vé bằng mã hoặc QR.
- Mỗi vé có trang riêng `/ticket/<mã vé>` kèm mã QR.

> Thanh toán là thủ công: khách chuyển khoản rồi bấm báo, Admin kiểm tra tiền thực nhận rồi xác nhận. Hệ thống không tự thu tiền.

## 1. Yêu cầu

- Node.js 22 LTS trở lên
- Tài khoản MongoDB Atlas (hoặc MongoDB cài trên máy)
- Git

## 2. Cài đặt

```bash
git clone https://github.com/phat2474802010571/Datveonline.git
cd Datveonline
npm install
```

Trên Windows PowerShell, nếu `npm` bị chặn thì dùng `npm.cmd` thay cho `npm`.

## 3. Tạo file `.env`

Copy file mẫu rồi điền thông tin:

```bash
cp .env.example .env
```

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `MONGODB_ACCOUNT` | Có | Chọn tài khoản Atlas dùng: `PHAT` hoặc `DUC` |
| `MONGODB_URI_PHAT` | Có* | Chuỗi kết nối Atlas của Phát |
| `MONGODB_URI_DUC` | Có* | Chuỗi kết nối Atlas của Đức |
| `MONGODB_DB` | Không | Tên database, mặc định `veonline` |
| `VEMO_ADMIN_USER` | Có | Username Admin, tạo tự động lần chạy đầu |
| `VEMO_ADMIN_PASSWORD` | Có | Mật khẩu Admin, tối thiểu 8 ký tự |
| `VEMO_ADMIN_EMAIL` | Không | Email Admin, dùng cho quên mật khẩu |
| `FRONTEND_URL` | Không | Mặc định `http://127.0.0.1:5173` |
| `PORT` | Không | Cổng API, mặc định `3000` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Không | Gửi email quên mật khẩu |
| `BANK_NAME`, `BANK_ACCOUNT`, `BANK_OWNER` | Không | Thông tin nhận chuyển khoản |
| `MOMO_RECEIVER_PHONE`, `MOMO_RECEIVER_NAME` | Không | Thông tin nhận MoMo |

\* Chỉ cần điền URI của tài khoản được chọn trong `MONGODB_ACCOUNT`.

Lưu ý với Atlas: database user cần quyền đọc/ghi, và IP máy bạn phải có trong **Network Access**.

**Không commit file `.env` lên GitHub** (đã có trong `.gitignore`).

## 4. Chạy project

### Chế độ phát triển (2 terminal)

Terminal 1 — chạy API:
```bash
npm run api
```

Terminal 2 — chạy giao diện:
```bash
npm run dev
```

Mở http://127.0.0.1:5173

### Chế độ chạy thật (1 terminal)

```bash
npm run build
npm start
```

Mở http://127.0.0.1:3000

Nếu báo lỗi cổng, hãy tắt chương trình đang dùng cổng 3000 hoặc 5173.

### Quên mật khẩu Admin

```bash
NEW_ADMIN_PASSWORD="matkhaumoi123" node server/reset-admin.js
```

(PowerShell: `$env:NEW_ADMIN_PASSWORD='matkhaumoi123'; node server/reset-admin.js`)

## 5. Kịch bản demo

1. Đăng ký tài khoản khách hàng mới.
2. Chọn một sự kiện, đặt vé (chọn số lượng hoặc chọn khu A–E).
3. Chọn phương thức thanh toán và báo đã chuyển tiền.
4. Mở **Vé của tôi**, mở trang vé để xem mã QR.
5. Đăng xuất, đăng nhập bằng tài khoản Admin.
6. Xác nhận thanh toán cho đơn vừa đặt.
7. Check-in bằng mã vé / QR.
8. Mở MongoDB Compass hoặc Atlas, xem database `veonline`, collection `events` — đơn vé nằm trong mảng `orders`.

## 6. Cấu trúc thư mục

```
├── index.html            Trang gốc cho Vite
├── vite.config.js        Cấu hình Vite + proxy /api sang cổng 3000
├── src/
│   ├── main.jsx          Giao diện khách hàng
│   ├── Admin.jsx         Giao diện Admin
│   ├── upgrade.jsx       Sơ đồ khu A–E, quên / đổi mật khẩu
│   └── *.css             Định dạng giao diện
└── server/
    ├── index.js          Khởi động Express, đăng nhập, đặt vé, quản lý sự kiện, check-in
    ├── mongodb.js        Kết nối MongoDB
    ├── upgrade.js        API sơ đồ khu và mật khẩu
    ├── payments.js       API thanh toán thủ công
    ├── ticket-receipt.js Trang vé và mã QR
    ├── events.js         Dữ liệu sự kiện mẫu
    └── reset-admin.js    Script đặt lại mật khẩu Admin
```

## 7. Danh sách API

**Tài khoản**

| Phương thức | URL | Chức năng |
|---|---|---|
| POST | /api/auth/register | Đăng ký khách hàng |
| POST | /api/auth/login | Đăng nhập (Admin hoặc khách) |
| GET | /api/auth/me | Thông tin người đang đăng nhập |
| POST | /api/auth/logout | Đăng xuất |
| POST | /api/upgrade/password/forgot | Gửi email quên mật khẩu |
| POST | /api/upgrade/password/reset | Đặt lại mật khẩu bằng link email |
| POST | /api/upgrade/password/change | Đổi mật khẩu |

**Sự kiện và đặt vé**

| Phương thức | URL | Chức năng |
|---|---|---|
| GET | /api/events | Danh sách sự kiện đang bán |
| GET | /api/events/:id | Chi tiết sự kiện |
| POST | /api/bookings | Đặt vé thường (cần đăng nhập) |
| GET | /api/upgrade/seats/:eventId | Xem sơ đồ khu A–E |
| POST | /api/upgrade/seats/book | Đặt vé theo khu |
| GET | /api/my/bookings | Vé của tôi |
| POST | /api/bookings/lookup | Tra cứu vé bằng mã + email |
| GET | /ticket/:code | Trang vé có mã QR |
| GET | /api/ticket-qr/:code | Ảnh QR của vé |

**Thanh toán**

| Phương thức | URL | Chức năng |
|---|---|---|
| GET | /api/payments/config | Thông tin nhận tiền |
| POST | /api/payments/:code/submit | Khách báo đã chuyển tiền |

**Admin**

| Phương thức | URL | Chức năng |
|---|---|---|
| GET | /api/admin/events | Danh sách tất cả sự kiện |
| POST | /api/admin/events | Thêm sự kiện |
| PUT | /api/admin/events/:id | Sửa sự kiện |
| POST | /api/admin/events/:id/hide | Ẩn sự kiện |
| POST | /api/admin/events/:id/restore | Hiện lại sự kiện |
| DELETE | /api/admin/events/:id | Xóa vĩnh viễn sự kiện |
| PUT | /api/upgrade/admin/seats/:eventId | Cấu hình khu A–E |
| GET | /api/admin/bookings | Danh sách đơn |
| PUT | /api/upgrade/admin/bookings/change-seats | Đổi khu cho đơn |
| POST | /api/admin/payments/:code/confirm | Xác nhận đã nhận tiền |
| POST | /api/admin/check-in | Check-in vé |

Khi đặt vé, MongoDB trừ số vé còn lại và ghi đơn trong cùng một lệnh cập nhật có điều kiện, nên hai người đặt cùng lúc không thể mua vượt số vé còn lại.
