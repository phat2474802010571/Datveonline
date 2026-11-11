import express from 'express';
import QRCode from 'qrcode';

const codePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const money = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

function normalizeCode(value) {
  return typeof value === 'string' && codePattern.test(value)
    ? value.toUpperCase()
    : null;
}

function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);
}

function getPhoneOrigin() {
  const value = process.env.VEMO_PHONE_URL?.trim();
  if (!value) return null;

  const url = new URL(value);

  if (
    url.protocol !== 'http:' ||
    url.port !== '3001' ||
    url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  ) {
    throw new Error('VEMO_PHONE_URL phải có dạng http://IP-MAY-TINH:3001');
  }

  return url.origin;
}

function setReceiptHeaders(res) {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
}

function receiptHtml(order, qrImage) {
  const status = order.checkedInAt ? 'Đã check-in' : 'Chưa check-in';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Xác nhận đặt vé · Vé Mở</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 16px;
      background: #faf7f2;
      color: #201c22;
      font: 16px/1.5 Arial, sans-serif;
    }
    main {
      max-width: 460px;
      margin: 24px auto;
      padding: 24px;
      border: 1px solid #ded5ca;
      border-radius: 16px;
      background: #fffdfa;
    }
    .brand { font-weight: 800; color: #903745; }
    h1 { margin: 12px 0 4px; font-size: 28px; line-height: 1.2; }
    h2 { margin: 20px 0 4px; font-size: 22px; }
    .status { color: #5c4350; }
    dl { margin: 18px 0; }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #ded5ca;
    }
    dd { margin: 0; text-align: right; }
    img { display: block; width: 176px; height: 176px; margin: 16px auto; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <span class="brand">Vé Mở.</span>
    <h1>Xác nhận đặt vé</h1>
    <p class="status">${escapeHtml(status)}</p>
    <h2>${escapeHtml(order.eventTitle)}</h2>

    <dl>
      <div><dt>Ngày giờ</dt><dd>${escapeHtml(order.date)}</dd></div>
      <div><dt>Địa điểm</dt><dd>${escapeHtml(order.venue)}</dd></div>
      <div><dt>Số lượng</dt><dd>${escapeHtml(order.quantity)} vé</dd></div>
      <div><dt>Tổng tiền</dt><dd>${escapeHtml(money.format(order.total))}</dd></div>
    </dl>

    <img src="${escapeHtml(qrImage)}" alt="Mã QR để nhân viên check-in"
      width="176" height="176">

    <p>Mã đặt vé <code>${escapeHtml(order.code)}</code></p>
  </main>
</body>
</html>`;
}

export function installTicketReceipts(app, events) {
  const phoneOrigin = getPhoneOrigin();
  const receiptOrigin = phoneOrigin ?? 'http://localhost:3000';
  const qrOptions = { errorCorrectionLevel: 'M', margin: 4 };

  async function findReceipt(code) {
    const match = { code };

    const event = await events.findOne(
      { orders: { $elemMatch: match } },
      { projection: { _id: 0, orders: { $elemMatch: match } } },
    );

    return event?.orders?.[0] ?? null;
  }

  function receiptUrl(code) {
    return `${receiptOrigin}/ticket/${code}`;
  }

  async function showReceipt(req, res) {
    setReceiptHeaders(res);

    const code = normalizeCode(req.params.code);
    const order = code && await findReceipt(code);

    if (!order) {
      return res.status(404).type('text').send('Không tìm thấy vé.');
    }

    const qrImage = await QRCode.toDataURL(receiptUrl(code), qrOptions);
    res.type('html').send(receiptHtml(order, qrImage));
  }

  app.get('/ticket/:code', showReceipt);

  app.get('/api/ticket-qr/:code', async (req, res) => {
    setReceiptHeaders(res);

    const code = normalizeCode(req.params.code);
    if (!code || !await findReceipt(code)) {
      return res.status(404).json({ message: 'Không tìm thấy vé.' });
    }

    const svg = await QRCode.toString(receiptUrl(code), {
      ...qrOptions,
      type: 'svg',
    });

    res.type('image/svg+xml').send(svg);
  });

  return function startPhoneReceipts() {
    if (!phoneOrigin) return;

    const phoneApp = express();
    phoneApp.disable('x-powered-by');
    phoneApp.get('/ticket/:code', showReceipt);

    phoneApp.use((error, req, res, next) => {
      console.error('Lỗi mở vé:', error.message);
      res.status(500).type('text').send('Không mở được vé. Hãy thử lại.');
    });

    const server = phoneApp.listen(3001, '0.0.0.0', () => {
      console.log('Trang xác nhận vé cho điện thoại:', phoneOrigin);
    });

    server.on('error', (error) => {
      console.error('Không mở được cổng 3001:', error.message);
    });
  };
}