
import QRCode from 'qrcode';

// ===========================================
// VEONLINE CHRISTMAS - TICKET RECEIPT
// ===========================================

const CODE_PATTERN =
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );
}

function money(value) {
  return Number(value || 0).toLocaleString('vi-VN') + 'đ';
}

function formatDate(value) {
  if (!value) return 'Chưa xác định';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHTML(value);
  }

  return escapeHTML(
    date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  );
}

function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;

  const value = raw.trim().toUpperCase();

  return CODE_PATTERN.test(value) ? value : null;
}

function safeUrl(value, fallback) {
  try {
    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return fallback;
    }

    return url.origin;
  } catch {
    return fallback;
  }
}

function getPublicBase(req) {
  const fallback = `${req.protocol}://${req.get('host')}`;

  return safeUrl(
    process.env.PUBLIC_BASE_URL || fallback,
    fallback
  );
}

async function findTicket(events, code) {
  const event = await events.findOne(
    {
      orders: {
        $elemMatch: { code }
      }
    },
    {
      projection: {
        _id: 1,
        title: 1,
        orders: {
          $elemMatch: { code }
        }
      }
    }
  );

  if (!event?.orders?.length) return null;

  return {
    event,
    order: event.orders[0]
  };
}

function errorPage(message) {
  return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport"
        content="width=device-width, initial-scale=1" />
      <title>VeOnline - Thông báo</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #faf7f1;
          color: #194638;
          font-family: Arial, sans-serif;
        }
        .card {
          max-width: 440px;
          margin: 20px;
          padding: 40px;
          border: 1px solid #e5dfd4;
          border-radius: 18px;
          background: #fff;
          text-align: center;
        }
        h1 { font-size: 27px; }
        a {
          display: inline-block;
          padding: 14px 23px;
          margin-top: 15px;
          border-radius: 9px;
          text-decoration: none;
          color: white;
          background: #194638;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Không thể mở vé</h1>
        <p>${escapeHTML(message)}</p>
        <a href="/">← Quay về trang chính</a>
      </div>
    </body>
    </html>
  `;
}

function renderReceipt(order, qrImage, homeUrl) {
  const statusUsed = Boolean(order.checkedInAt);

  const status = statusUsed
    ? 'Đã check-in'
    : 'Chưa check-in';

  const zoneText = order.zoneId
    ? `Khu ${order.zoneId}`
    : order.seatIds?.length
      ? order.seatIds.join(', ')
      : 'Vé thường';

  const code = escapeHTML(order.code);
  const title = escapeHTML(order.eventTitle);
  const customer = escapeHTML(order.name);
  const email = escapeHTML(order.email);
  const venue = escapeHTML(order.venue);
  const date = escapeHTML(order.date);
  const zone = escapeHTML(zoneText);
  const quantity = Number(order.quantity || 0);
  const total = money(order.total);
  const backUrl = escapeHTML(homeUrl);

  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <meta name="theme-color" content="#194638" />

  <title>Vé điện tử - ${title} | VeOnline</title>

  <link rel="preconnect"
    href="https://fonts.googleapis.com" />

  <link rel="preconnect"
    href="https://fonts.gstatic.com"
    crossorigin />

  <link
    href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Playfair+Display:wght@500;600;700;800&display=swap"
    rel="stylesheet"
  />

  <style>
    :root {
      --green: #194638;
      --deep: #12372d;
      --gold: #c7a269;
      --cream: #faf7f1;
      --red: #ab4550;
      --muted: #7c897f;
      --border: #e7e1d7;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background:
        radial-gradient(
          circle at 12% 15%,
          rgba(198,162,105,.12),
          transparent 30%
        ),
        radial-gradient(
          circle at 90% 80%,
          rgba(25,70,56,.09),
          transparent 32%
        ),
        var(--cream);
      color: var(--deep);
      font-family: 'DM Sans', Arial, sans-serif;
      min-height: 100vh;
    }

    .page {
      width: min(100% - 32px, 540px);
      margin: 42px auto 55px;
    }

    .ticket {
      background: #fffdfa;
      border-radius: 22px;
      border: 1px solid var(--border);
      overflow: hidden;
      box-shadow:
        0 18px 55px rgba(25,70,56,.09);
      animation: rise .45s ease both;
    }

    .ticket-header {
      padding: 34px 32px 28px;
      text-align: center;
      background: linear-gradient(
        125deg,
        #12372d 0%,
        #235e45 60%,
        #163e32 100%
      );
      position: relative;
      overflow: hidden;
      color: white;
    }

    .ticket-header::before {
      content: "✦";
      position: absolute;
      top: -32px;
      left: 12px;
      font-size: 105px;
      opacity: .08;
    }

    .ticket-header::after {
      content: "❄";
      position: absolute;
      right: 12px;
      bottom: -45px;
      font-size: 130px;
      opacity: .08;
    }

    .brand {
      color: #ebcb91;
      letter-spacing: 3px;
      font-weight: 800;
      font-size: 11px;
    }

    .ticket-header h1 {
      font-family: 'Playfair Display',
        Georgia, serif;
      font-size: clamp(29px, 5vw, 38px);
      line-height: 1.3;
      letter-spacing: -.6px;
      margin: 17px 0 12px;
      font-weight: 700;
    }

    .subtitle {
      color: #d8e2d9;
      font-size: 12px;
      letter-spacing: .4px;
    }

    .ticket-body {
      padding: 30px 32px 18px;
    }

    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 22px;
    }

    .status-pill {
      padding: 9px 16px;
      border-radius: 100px;
      background: #e9f3e7;
      color: #267449;
      font-weight: 800;
      font-size: 12px;
    }

    .status-pill.used {
      background: #f4e5e7;
      color: #a1434b;
    }

    .concert {
      text-align: center;
      margin-bottom: 25px;
    }

    .concert-label {
      color: #b68f54;
      letter-spacing: 2px;
      font-size: 10px;
      font-weight: 800;
    }

    .concert h2 {
      font-family: 'Playfair Display',
        Georgia, serif;
      color: var(--green);
      font-size: clamp(25px, 5vw, 32px);
      line-height: 1.35;
      overflow-wrap: anywhere;
      margin: 10px 0;
    }

    .details {
      border-top: 1px solid var(--border);
    }

    .detail {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }

    .detail-label {
      color: var(--muted);
      font-size: 12px;
      flex-shrink: 0;
    }

    .detail-value {
      color: var(--deep);
      font-size: 13px;
      font-weight: 700;
      text-align: right;
      overflow-wrap: anywhere;
    }

    .detail-value.highlight {
      color: var(--red);
      font-size: 17px;
      font-weight: 800;
    }

    .qr-divider {
      position: relative;
      border-top: 2px dashed #dedbd1;
      margin: 16px 0 0;
    }

    .qr-divider::before,
    .qr-divider::after {
      content: "";
      position: absolute;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--cream);
      border: 1px solid var(--border);
      top: -14px;
    }

    .qr-divider::before { left: -46px; }
    .qr-divider::after { right: -46px; }

    .qr-area {
      text-align: center;
      padding: 24px 0 17px;
    }

    .qr-label {
      font-size: 11px;
      font-weight: 800;
      color: #b38a4d;
      letter-spacing: 2px;
    }

    .qr-frame {
      width: max-content;
      max-width: 100%;
      margin: 15px auto;
      padding: 15px;
      border-radius: 14px;
      background: #fff;
      border: 1px solid #e6e6df;
    }

    .qr-frame img {
      display: block;
      width: 190px;
      max-width: 100%;
      height: auto;
      image-rendering: auto;
    }

    .qr-description {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.7;
      max-width: 315px;
      margin: 0 auto 16px;
    }

    .booking-code {
      padding: 13px;
      background: #f4f5ef;
      border-radius: 9px;
      color: var(--green);
      font-family: monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
      line-height: 1.7;
    }

    .booking-code strong {
      display: block;
      color: #768878;
      font-family: 'DM Sans', sans-serif;
      font-size: 11px;
      margin-bottom: 5px;
    }

    .ticket-footer {
      padding: 17px 25px;
      background: #f3f1e9;
      text-align: center;
      color: #79877a;
      font-size: 11px;
      line-height: 1.7;
    }

    .ticket-navigation {
      display: flex;
      flex-direction: column;
      gap: 11px;
      margin-top: 23px;
    }

    .ticket-home,
    .ticket-print {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      text-decoration: none;
      padding: 16px 20px;
      border-radius: 10px;
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      transition: .2s;
    }

    .ticket-home {
      background: var(--green);
      border: 1px solid var(--green);
      color: #fff;
    }

    .ticket-home:hover {
      background: #29684e;
      transform: translateY(-2px);
    }

    .ticket-print {
      background: #fffdfa;
      border: 1px solid #d7dfd6;
      color: var(--green);
    }

    .ticket-print:hover {
      background: #ecf1e9;
    }

    .bottom-note {
      text-align: center;
      margin: 20px 0;
      font-size: 11px;
      color: #8b968b;
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(15px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 480px) {
      .page {
        width: min(100% - 20px, 540px);
        margin: 15px auto 35px;
      }

      .ticket-header {
        padding: 27px 20px;
      }

      .ticket-body {
        padding: 23px 23px 15px;
      }

      .detail {
        gap: 12px;
      }

      .detail-label,
      .detail-value {
        font-size: 12px;
      }

      .qr-divider::before { left: -37px; }
      .qr-divider::after { right: -37px; }
    }

    @media print {
      body {
        background: white;
      }

      .page {
        margin: 0 auto;
        width: 100%;
        max-width: 540px;
      }

      .ticket {
        box-shadow: none;
      }

      .ticket-navigation,
      .bottom-note {
        display: none;
      }

      .ticket-header {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ticket {
        animation: none;
      }

      .ticket-home,
      .ticket-print {
        transition: none;
      }
    }
  </style>
</head>

<body>
  <main class="page">
    <article class="ticket">

      <header class="ticket-header">
        <div class="brand">
          ✦ VEONLINE CHRISTMAS ✦
        </div>

        <h1>Xác nhận đặt vé</h1>

        <div class="subtitle">
          Your memorable experience starts here
        </div>
      </header>

      <div class="ticket-body">

        <div class="status">
          <span class="status-pill ${statusUsed ? 'used' : ''}">
            ${escapeHTML(status)}
          </span>
        </div>

        <section class="concert">
          <span class="concert-label">
            ✦ EVENT EXPERIENCE ✦
          </span>

          <h2>${title}</h2>
        </section>

        <section class="details">
          <div class="detail">
            <span class="detail-label">
              Khách hàng
            </span>
            <span class="detail-value">
              ${customer}
            </span>
          </div>

          <div class="detail">
            <span class="detail-label">
              Ngày giờ
            </span>
            <span class="detail-value">
              ${date}
            </span>
          </div>

          <div class="detail">
            <span class="detail-label">
              Địa điểm
            </span>
            <span class="detail-value">
              ${venue}
            </span>
          </div>

          <div class="detail">
            <span class="detail-label">
              Khu vực
            </span>
            <span class="detail-value">
              ${zone}
            </span>
          </div>

          <div class="detail">
            <span class="detail-label">
              Số lượng
            </span>
            <span class="detail-value">
              ${quantity} vé
            </span>
          </div>

          <div class="detail">
            <span class="detail-label">
              Tổng tiền
            </span>
            <span class="detail-value highlight">
              ${total}
            </span>
          </div>
        </section>

        <div class="qr-divider"></div>

        <section class="qr-area">
          <span class="qr-label">
            YOUR E-TICKET QR
          </span>

          <div class="qr-frame">
            <img
              src="${qrImage}"
              width="190"
              height="190"
              alt="Mã QR xác nhận vé"
            />
          </div>

          <p class="qr-description">
            Xuất trình mã QR khi check-in tại sự kiện.
            Mỗi mã đặt vé chỉ được check-in một lần.
          </p>

          <div class="booking-code">
            <strong>MÃ ĐẶT VÉ</strong>
            ${code}
          </div>
        </section>
      </div>

      <footer class="ticket-footer">
        ✧ VEONLINE ✧
        <div>
          Collect moments, not things.
        </div>
      </footer>
    </article>

    <nav class="ticket-navigation">
      <a
        class="ticket-home"
        href="${backUrl}"
      >
        ← Quay về trang chính
      </a>

      <button
        type="button"
        class="ticket-print"
        onclick="window.print()"
      >
        ⎙ In / Lưu vé PDF
      </button>
    </nav>

    <p class="bottom-note">
      © 2026 VeOnline · Made with Christmas magic ✨
    </p>
  </main>
</body>
</html>
  `;
}

// ===========================================
// INSTALL ROUTES
// ===========================================

export function installTicketReceipts(app, events) {
  // Trả về callback để tương thích index.js cũ.
  // Các route được đăng ký ngay khi gọi hàm.

  app.get('/ticket/:code', async (req, res, next) => {
    try {
      const code = normalizeCode(req.params.code);

      if (!code) {
        return res.status(400).type('html').send(
          errorPage('Mã vé không hợp lệ.')
        );
      }

      const ticket = await findTicket(events, code);

      if (!ticket) {
        return res.status(404).type('html').send(
          errorPage('Không tìm thấy mã vé này.')
        );
      }

      const base = getPublicBase(req);

      const qrTarget =
        `${base}/ticket/${encodeURIComponent(code)}`;

      const qrImage = await QRCode.toDataURL(qrTarget, {
        errorCorrectionLevel: 'M',
        width: 300,
        margin: 2,
        color: {
          dark: '#142E24',
          light: '#FFFFFF'
        }
      });

      const homeUrl = safeUrl(
  process.env.FRONTEND_URL ||
    'http://127.0.0.1:5173/',
  'http://127.0.0.1:5173/'
);

      res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; " +
          "img-src data:; " +
          "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src https://fonts.gstatic.com; " +
          "script-src 'unsafe-inline'; " +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });

      res.type('html').send(
        renderReceipt(ticket.order, qrImage, homeUrl)
      );
    } catch (error) {
      next(error);
    }
  });

  // QR image riêng để frontend hoặc Admin dùng.
  app.get('/api/ticket-qr/:code', async (req, res, next) => {
    try {
      const code = normalizeCode(req.params.code);

      if (!code) {
        return res.status(400).json({
          message: 'Mã vé không hợp lệ.'
        });
      }

      const ticket = await findTicket(events, code);

      if (!ticket) {
        return res.status(404).json({
          message: 'Không tìm thấy vé.'
        });
      }

      const url =
        `${getPublicBase(req)}/ticket/${encodeURIComponent(code)}`;

      const image = await QRCode.toBuffer(url, {
        type: 'png',
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M'
      });

      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });

      res.send(image);
    } catch (error) {
      next(error);
    }
  });

  return () => {
    console.log('✅ VeOnline: Đã kích hoạt trang vé và mã QR.');
  };
}
