import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Admin from './Admin.jsx';
import './style.css';

const categories = ['Tất cả', 'Âm nhạc', 'Workshop', 'Triển lãm'];
const ticketHistoryKey = 've-mo:booked-tickets';

function money(value) {
  return value.toLocaleString('vi-VN') + ' ₫';
}

function readTickets() {
  try {
    const tickets = JSON.parse(localStorage.getItem(ticketHistoryKey) || '[]');
    return Array.isArray(tickets) ? tickets : [];
  } catch {
    return [];
  }
}

async function request(path, data) {
  const response = await fetch('/api' + path, data === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) {
    throw new Error(result?.message || 'Không kết nối được với API.');
  }
  return result;
}

function Poster({ event }) {
  return (
    <div className={'poster ' + event.theme} aria-hidden="true">
      <span>{event.poster}</span>
    </div>
  );
}

function Receipt({ order, children }) {
  return (
    <section className="receipt">
      <p className="eyebrow">Đặt vé thành công</p>
      <h2>{order.eventTitle}</h2>
      <p>{order.date} · {order.venue}</p>
      <p>{order.name} · {order.quantity} vé · <strong>{money(order.total)}</strong></p>
      <p>Mã đặt vé <code>{order.code}</code></p>

      <img
        src={'/api/ticket-qr/' + encodeURIComponent(order.code)}
        alt="Mã QR dùng để check-in"
        width={144}
        height={144}
        style={{ display: 'block', marginBottom: 12 }}
      />

      {order.checkedInAt && <p>Đã check-in</p>}
      {children}
    </section>
  );
}

function Booking({ event, onBack, onBooked, onHistory, onRefresh }) {
  const [quantity, setQuantity] = useState(1);
  const [order, setOrder] = useState(null);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const maxQuantity = Math.min(event.remaining, 8);

  async function book(e) {
    e.preventDefault();
    if (busy) return;

    const form = new FormData(e.currentTarget);
    setError('');
    setBusy(true);

    try {
      const confirmed = await request('/bookings', {
        eventId: event._id,
        quantity,
        name: form.get('name'),
        email: form.get('email'),
      });

      setSaved(onBooked(confirmed));
      setOrder(confirmed);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onRefresh();
    }
  }

  return (
    <section>
      <button className="back" onClick={onBack}>← Tất cả sự kiện</button>

      {order ? (
        <Receipt order={order}>
          <p role="status">
            {saved
              ? 'Vé đã được lưu trong mục Vé đã đặt trên trình duyệt này.'
              : 'Trình duyệt không lưu được lịch sử. Hãy chép mã để tra cứu sau.'}
          </p>
          <button className="primary" onClick={onHistory}>Xem vé đã đặt</button>
        </Receipt>
      ) : (
        <div className="detail">
          <Poster event={event} />
          <div>
            <p className="eyebrow">{event.category}</p>
            <h1>{event.title}</h1>
            <p>{event.date} · {event.venue}</p>
            <p>{event.description}</p>
            <p><strong>{money(event.price)}</strong> / vé · Còn {event.remaining} vé</p>

            {maxQuantity > 0 ? (
              <form onSubmit={book}>
                <label>
                  Số lượng vé
                  <input
                    type="number"
                    min={1}
                    max={maxQuantity}
                    value={quantity}
                    onChange={(e) => {
                      const value = e.target.valueAsNumber;
                      setQuantity(Number.isNaN(value) ? '' : value);
                    }}
                    required
                  />
                </label>

                <label>
                  Họ và tên
                  <input name="name" autoComplete="name" maxLength={100} required />
                </label>

                <label>
                  Email
                  <input name="email" type="email" autoComplete="email" maxLength={254} required />
                </label>

                <strong>Tổng tiền {money(event.price * quantity)}</strong>

                <button className="primary" type="submit" disabled={busy}>
                  {busy ? 'Đang đặt vé…' : 'Xác nhận đặt vé demo'}
                </button>
              </form>
            ) : (
              <p role="status">Sự kiện đã hết vé.</p>
            )}

            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function TicketHistory({ tickets, onLookup }) {
  return (
    <section className="lookup">
      <h1>Vé đã đặt</h1>
      <p>Lịch sử đặt vé trên trình duyệt này.</p>
      {tickets.length === 0 && <p>Chưa có vé nào được lưu.</p>}

      {tickets.map((ticket) => <Receipt key={ticket.code} order={ticket} />)}

      <button style={{ marginTop: 18 }} onClick={onLookup}>
        Tra cứu bằng mã vé và email
      </button>
    </section>
  );
}

function Lookup() {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    if (busy) return;

    const form = new FormData(e.currentTarget);
    setOrder(null);
    setError('');
    setBusy(true);

    try {
      setOrder(await request('/bookings/lookup', {
        code: form.get('code'),
        email: form.get('email'),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lookup">
      <h1>Tra cứu vé</h1>

      <form onSubmit={lookup}>
        <label>Mã đặt vé <input name="code" required /></label>
        <label>Email đặt vé <input name="email" type="email" required /></label>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Đang tra cứu…' : 'Tra cứu'}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {order && <Receipt order={order} />}
    </section>
  );
}

function App() {
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState(readTickets);
  const [page, setPage] = useState('events');
  const [category, setCategory] = useState('Tất cả');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [slide, setSlide] = useState(0);

  async function refresh() {
    try {
      setEvents(await request('/events'));
      setError('');
    } catch (err) {
      setError(err.message === 'Failed to fetch'
        ? 'Không kết nối được với API.'
        : err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function rememberBooking(order) {
    const { email, ...ticket } = order;
    const latest = [ticket, ...readTickets().filter((item) => item.code !== ticket.code)];

    try {
      localStorage.setItem(ticketHistoryKey, JSON.stringify(latest));
      setTickets(latest);
      return true;
    } catch {
      setTickets((current) => [
        ticket, ...current.filter((item) => item.code !== ticket.code),
      ]);
      return false;
    }
  }

  const selected = events.find((event) => event._id === page);
  const keyword = search.trim().toLowerCase();
  const visible = events
    .filter((event) => category === 'Tất cả' || event.category === category)
    .filter((event) => !keyword || event.title.toLowerCase().includes(keyword)
      || event.venue.toLowerCase().includes(keyword))
    .filter((event) => tab === 'all' || (event.remaining > 0 && event.remaining <= 20))
    .sort((a, b) => (tab === 'all' ? 0 : a.remaining - b.remaining));
  const featured = events.length
    ? [events[slide % events.length], events[(slide + 1) % events.length]]
      .filter((event, i, list) => list.indexOf(event) === i)
    : [];

  function go(next) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <header>
        <div className="top">
          <button className="brand" onClick={() => go('events')}>
            vé<span>mở</span>
          </button>

          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Bạn muốn đi sự kiện nào?"
              aria-label="Tìm sự kiện"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage('events'); }}
            />
          </label>

          <nav aria-label="Điều hướng chính">
            <button onClick={() => go('events')}
              aria-current={page === 'events' || selected ? 'page' : undefined}>
              Sự kiện
            </button>
            <button onClick={() => go('history')}
              aria-current={page === 'history' ? 'page' : undefined}>
              Vé đã đặt
            </button>
            <button onClick={() => go('lookup')}
              aria-current={page === 'lookup' ? 'page' : undefined}>
              Tra cứu vé
            </button>
          </nav>

          <div className="account">
            <button onClick={() => go('admin')}>Đăng nhập</button>
            <span aria-hidden="true">|</span>
            <button onClick={() => go('admin')}>Đăng ký</button>
          </div>
        </div>
      </header>

      <main>
        {page === 'admin' ? <Admin /> : page === 'lookup' ? <Lookup /> : page === 'history' ? (
          <TicketHistory tickets={tickets} onLookup={() => go('lookup')} />
        ) : selected ? (
          <Booking
            key={selected._id}
            event={selected}
            onBack={() => go('events')}
            onBooked={rememberBooking}
            onHistory={() => go('history')}
            onRefresh={refresh}
          />
        ) : (
          <>
            <div className="pills" aria-label="Lọc theo loại sự kiện">
              {categories.map((item) => (
                <button
                  key={item}
                  aria-pressed={item === category}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            {featured.length > 0 && (
              <section className="hero" aria-label="Sự kiện nổi bật">
                <button className="arrow prev" aria-label="Sự kiện trước"
                  onClick={() => setSlide((slide - 1 + events.length) % events.length)}>‹</button>
                <div className="hero-track">
                  {featured.map((event) => (
                    <div className="hero-card" key={event._id}>
                      <Poster event={event} />
                      <div className="hero-info">
                        <p className="eyebrow">{event.category} · {event.date}</p>
                        <h2>{event.title}</h2>
                      </div>
                      <button className="light" onClick={() => go(event._id)}>Xem chi tiết</button>
                    </div>
                  ))}
                </div>
                <button className="arrow next" aria-label="Sự kiện sau"
                  onClick={() => setSlide((slide + 1) % events.length)}>›</button>
                <div className="dots">
                  {events.map((event, i) => (
                    <button key={event._id} aria-label={'Xem ' + event.title}
                      aria-current={i === slide % events.length ? 'true' : undefined}
                      onClick={() => setSlide(i)} />
                  ))}
                </div>
              </section>
            )}

            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>
                Đang mở bán
              </button>
              <button role="tab" aria-selected={tab === 'hot'} onClick={() => setTab('hot')}>
                Sắp hết vé
              </button>
            </div>

            {loading && <p role="status">Đang tải sự kiện…</p>}
            {error && (
              <p className="error" role="alert">
                {error} <button onClick={refresh}>Thử lại</button>
              </p>
            )}
            {!loading && !error && !visible.length && <p className="muted">Không có sự kiện phù hợp.</p>}

            <div className="cards">
              {visible.map((event) => (
                <article key={event._id} onClick={() => go(event._id)}>
                  <div className="cover">
                    <Poster event={event} />
                    <span className={'badge' + (event.remaining ? '' : ' sold')}>
                      {!event.remaining ? 'Hết vé'
                        : event.remaining <= 20 ? '✦ Sắp hết vé ✦' : '✦ Đang mở bán ✦'}
                    </span>
                  </div>
                  <div className="card-body">
                    <h3>{event.title}</h3>
                    <p className="price">Từ {money(event.price)}</p>
                    <p className="muted">📅 {event.date}</p>
                    <p className="muted">📍 {event.venue}</p>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

      <footer>
        <div className="top">
          <span className="brand">vé<span>mở</span></span>
          <small>Demo môn học · Dữ liệu sự kiện là dữ liệu mẫu</small>
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);