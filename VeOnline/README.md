# Vé Mở — Hệ thống bán vé sự kiện online

Demo môn học bằng HTML, CSS, JavaScript, React, Node.js, Express và MongoDB.
Dữ liệu sự kiện là dữ liệu mẫu. Bước xác nhận ghi đơn demo, chưa thu tiền.

## Chạy trên Windows PowerShell

Cài Node.js 22 LTS hoặc mới hơn và bật dịch vụ MongoDB Community Server nếu chạy MongoDB trên máy. Có thể dùng MongoDB Atlas thay cho MongoDB cục bộ.

Giải nén, mở terminal tại thư mục VeOnline (chứa package.json), rồi chạy:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Mở http://localhost:3000. Terminal cần tiếp tục chạy. Nhấn Ctrl+C để dừng.
Trên macOS hoặc Linux, thay npm.cmd bằng npm.

Nếu dùng Atlas, đặt biến kết nối trong cùng terminal **trước khi chạy npm.cmd start**:

```powershell
$env:MONGODB_URI = 'mongodb+srv://USER:PASSWORD@HOST/'
npm.cmd start
```

Thay chuỗi mẫu bằng URI của bạn. Database user cần quyền đọc/ghi database
`veonline` và địa chỉ IP hiện tại cần có trong danh sách truy cập Atlas.
Nếu dùng MongoDB cục bộ, mặc định là `mongodb://127.0.0.1:27017`.
Có thể đổi tên database bằng biến `MONGODB_DB`.

Nếu đang có một server khác chiếm cổng 3000, dừng server đó trước.
Muốn sửa giao diện và tự tải lại, chạy `npm.cmd run api` ở terminal thứ nhất,
rồi chạy `npm.cmd run dev` ở terminal thứ hai. Mở địa chỉ Vite in ra, mặc định là
http://localhost:5173.

## Kịch bản trình bày

1. Lọc theo danh mục Âm nhạc và chọn **Sóng Đêm**.
2. Chọn 2 vé, nhập họ tên và email. Tổng tiền hiển thị **700.000 ₫**.
3. Xác nhận, sao chép mã đặt vé. Số vé còn lại giảm từ 40 xuống 38 nếu database mới.
4. Mở **Tra cứu vé**, dán mã và nhập lại cùng email.
5. Mở MongoDB Compass để xem database `veonline`, collection `events`.
   Đơn vừa đặt nằm trong mảng `orders` của sự kiện.

## Cấu trúc và API

- `src/main.jsx` hiển thị danh sách, bộ lọc, màn hình đặt vé và tra cứu.
- `src/style.css` định dạng giao diện và bố cục trên điện thoại.
- `server/events.js` chứa dữ liệu mẫu, được thêm khi sự kiện chưa tồn tại.
- `server/index.js` tính giá trên server, kiểm tra tồn và ghi đơn vào MongoDB.

| Phương thức | URL | Chức năng |
|---|---|---|
| GET | /api/events | Danh sách sự kiện |
| GET | /api/events/:id | Chi tiết sự kiện |
| POST | /api/bookings | Đặt vé với eventId, quantity, name, email |
| POST | /api/bookings/lookup | Tra cứu với code và email |

MongoDB trừ tồn và ghi đơn bằng một cập nhật có điều kiện trên cùng tài liệu,
giúp hai người đặt đồng thời không thể mua vượt số lượng còn lại.
