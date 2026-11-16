
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const money = n =>
  Number(n || 0).toLocaleString('vi-VN') + 'đ';

const categories = [
  'Tất cả', 'Âm nhạc', 'Workshop', 'Triển lãm'
];

const emptyEvent = {
  title: '',
  category: 'Âm nhạc',
  date: '',
  venue: '',
  description: '',
  price: 0,
  remaining: 100
};

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || 'Có lỗi xảy ra.'
    );
  }
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({
    name: '',
    login: '',
    email: '',
    password: ''
  });
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState(1);
  const [tickets, setTickets] = useState([]);
  const [adminOrders, setAdminOrders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyEvent);
  const [category, setCategory] = useState('Tất cả');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [snow, setSnow] = useState(true);
  const [checkCode, setCheckCode] = useState('');
  const [checking, setChecking] = useState(false);

  const isAdmin = user?.role === 'admin';

  function notify(text) {
    setMessage(text);
  }

  async function loadEvents() {
    const data = await api('/events');
    setEvents(data);
  }

  async function loadTickets() {
    if (!user) return;
    const data = await api('/my/bookings');
    setTickets(data);
  }

  async function loadOrders() {
    const data = await api('/admin/bookings');
    setAdminOrders(data);
  }

  useEffect(() => {
    async function init() {
      try {
        const session = await api('/auth/me');
        setUser(session.user);
        const data = await api('/events');
        setEvents(data);
      } catch (error) {
        notify(error.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (page === 'tickets' && user) {
      loadTickets().catch(e => notify(e.message));
    }
    if (page === 'admin' && isAdmin) {
      loadOrders().catch(e => notify(e.message));
    }
  }, [page, user]);

  function go(next) {
    setPage(next);
    setSelected(null);
    setEditing(null);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleAuth(e) {
    e.preventDefault();
    try {
      const data = await api(
        authMode === 'login'
          ? '/auth/login'
          : '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(
            authMode === 'login'
              ? {
                  login: auth.login,
                  password: auth.password
                }
              : {
                  name: auth.name,
                  email: auth.email,
                  password: auth.password
                }
          )
        }
      );

      setUser(data.user);
      setAuth({
        name: '', login: '', email: '', password: ''
      });

      go(data.user.role === 'admin' ? 'admin' : 'home');
      notify('Đăng nhập thành công! 🎄');
    } catch (error) {
      notify(error.message);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      setTickets([]);
      setAdminOrders([]);
      go('home');
      notify('Đã đăng xuất thành công.');
    } catch (error) {
      notify(error.message);
    }
  }

  async function book() {
    if (!user) {
      go('auth');
      notify('Đăng nhập để đặt vé nhé!');
      return;
    }

    if (!selected) return;

    try {
      const data = await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          eventId: selected._id,
          quantity: qty,
          name: user.name,
          email: user.email
        })
      });

      setSelected(null);
      await loadEvents();
      setTickets(current => [data, ...current]);
      go('tickets');
      notify('Đặt vé thành công! Vé đã được lưu. 🎟️');
    } catch (error) {
      notify(error.message);
    }
  }

  function editEvent(event = null) {
    if (event) {
      setEditing(event);
      setForm({
        title: event.title,
        category: event.category,
        date: event.date,
        venue: event.venue,
        description: event.description,
        price: event.price,
        remaining: event.remaining
      });
    } else {
      setEditing('new');
      setForm({ ...emptyEvent });
    }
  }

  async function saveEvent(e) {
    e.preventDefault();
    const payload = {
      ...form,
      price: Number(form.price),
      remaining: Number(form.remaining)
    };

    try {
      if (editing === 'new') {
        await api('/admin/events', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      } else {
        await api('/admin/events/' + editing._id, {
          method: 'PUT',
          body: JSON.stringify({
            ...payload,
            originalRemaining: editing.remaining
          })
        });
      }

      await loadEvents();
      setEditing(null);
      notify('Đã lưu sự kiện thành công.');
    } catch (error) {
      notify(error.message);
    }
  }

  async function removeEvent(event) {
    if (!confirm(`Ẩn sự kiện "${event.title}"?`)) return;

    try {
      await api('/admin/events/' + event._id, {
        method: 'DELETE'
      });
      await loadEvents();
      notify('Đã ẩn sự kiện.');
    } catch (error) {
      notify(error.message);
    }
  }

  async function checkIn(e) {
    e.preventDefault();
    if (checking || !checkCode.trim()) return;
    setChecking(true);

    try {
      const result = await api('/admin/check-in', {
        method: 'POST',
        body: JSON.stringify({ code: checkCode })
      });
      setCheckCode('');
      await loadOrders();
      notify(`Check-in thành công: ${result.name} ✅`);
    } catch (error) {
      notify(error.message);
    } finally {
      setChecking(false);
    }
  }

  const filtered = events.filter(event => {
    const matchesCategory =
      category === 'Tất cả' ||
      event.category === category;

    const matchesSearch = (
      event.title + ' ' + event.venue
    ).toLowerCase().includes(search.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const totalSold = adminOrders.reduce(
    (sum, order) => sum + Number(order.quantity || 0), 0
  );

  const totalRevenue = adminOrders.reduce(
    (sum, order) => sum + Number(order.total || 0), 0
  );

  return (
    <div className="app">
      {snow && (
        <div className="snow-layer" aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              style={{
                '--x': `${(i * 37 + 7) % 100}%`,
                '--delay': `${(i * 0.43) % -15}s`,
                '--duration': `${10 + (i % 8)}s`,
                '--size': `${3 + (i % 5)}px`
              }}
            />
          ))}
        </div>
      )}

      <div className="announcement">
        ✨ CHRISTMAS SPECIAL • MÙA LỄ HỘI ĐÃ ĐẾN • ✨
      </div>

      <header className="header">
        <div className="nav-container">
          <button className="logo" onClick={() => go('home')}>
            <span className="logo-icon">✦</span>
            ve<span>online</span>
            <small>EVENTS & EXPERIENCES</small>
          </button>

          <nav>
            <button
              className={page === 'home' ? 'active' : ''}
              onClick={() => go('home')}
            >
              Khám phá
            </button>

            {user && (
              <button
                className={page === 'tickets' ? 'active' : ''}
                onClick={() => go('tickets')}
              >
                Vé của tôi
              </button>
            )}

            {isAdmin && (
              <button
                className={page === 'admin' ? 'active' : ''}
                onClick={() => go('admin')}
              >
                Quản lý
              </button>
            )}
          </nav>

          <div className="nav-actions">
            <button
              className="snow-button"
              onClick={() => setSnow(!snow)}
              title="Bật hoặc tắt tuyết"
            >
              ❄
            </button>

            {user ? (
              <>
                <span className="user-name">
                  Xin chào, {user.name}
                </span>
                <button className="outline-btn" onClick={logout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <button
                className="primary-btn"
                onClick={() => go('auth')}
              >
                Đăng nhập
              </button>
            )}
          </div>
        </div>
      </header>

      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage('')}>×</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Đang chuẩn bị mùa lễ hội... ❄</div>
      ) : (
        <>
          {page === 'home' && (
            <>
              <section className="hero">
                <div className="hero-glow" />
                <div className="hero-copy">
                  <div className="eyebrow">
                    ✦ THE HOLIDAY COLLECTION 2026
                  </div>
                  <h1>
                    Những khoảnh khắc
                    <br />
                    <em>đáng nhớ</em> bắt đầu
                    <br />
                    từ đây.
                  </h1>
                  <p>
                    Từ những đêm nhạc lung linh đến workshop
                    đầy cảm hứng. Khám phá, đặt vé và tận hưởng
                    mùa lễ hội theo cách của riêng bạn.
                  </p>
                  <button
                    className="gold-btn"
                    onClick={() =>
                      document.getElementById('events')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    Khám phá sự kiện <span>↗</span>
                  </button>
                  <div className="hero-footer">
                    <span>✧ Trải nghiệm độc đáo</span>
                    <span>✧ Đặt vé dễ dàng</span>
                    <span>✧ Vé điện tử QR</span>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-star">✧</div>
                  <div className="art-circle">
                    <span>✦</span>
                    <strong>THE MOST</strong>
                    <strong>WONDERFUL</strong>
                    <strong>TIME</strong>
                    <i>OF THE YEAR</i>
                  </div>
                  <div className="art-ornament one">✳</div>
                  <div className="art-ornament two">✦</div>
                  <div className="art-ornament three">❅</div>
                  <div className="art-caption">
                    JOY • MUSIC • MEMORIES
                  </div>
                </div>
              </section>

              <section id="events" className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">
                      ✦ CURATED FOR YOU
                    </div>
                    <h2>Sự kiện <em>nổi bật</em></h2>
                    <p>Chọn một trải nghiệm đáng nhớ cho mùa này.</p>
                  </div>
                  <span className="event-count">
                    {filtered.length} sự kiện
                  </span>
                </div>

                <div className="filters">
                  <div className="filter-tabs">
                    {categories.map(c => (
                      <button
                        key={c}
                        className={category === c ? 'selected' : ''}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <input
                    className="search"
                    placeholder="⌕  Tìm sự kiện, địa điểm..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                <div className="event-grid">
                  {filtered.map((event, i) => (
                    <article className="event-card" key={event._id}>
                      <div className={`event-poster theme-${event.theme || 'night'}`}>
                        <div className="poster-top">
                          <span>VEONLINE PRESENTS</span>
                          <span>✦</span>
                        </div>
                        <div className="poster-art">
                          {event.category === 'Âm nhạc' ? '♫'
                            : event.category === 'Workshop' ? '✿'
                            : '✧'}
                        </div>
                        <div className="poster-bottom">
                          <span>{event.category}</span>
                          <strong>{event.poster || event.title}</strong>
                          <small>AN EXPERIENCE TO REMEMBER</small>
                        </div>
                        {event.remaining <= 0 && (
                          <div className="soldout">HẾT VÉ</div>
                        )}
                      </div>

                      <div className="event-info">
                        <span className="event-category">
                          {event.category}
                        </span>
                        <h3>{event.title}</h3>
                        <p>◷ {event.date}</p>
                        <p>⌖ {event.venue}</p>
                        <div className="card-bottom">
                          <div>
                            <small>Giá từ</small>
                            <strong>{money(event.price)}</strong>
                          </div>
                          <button
                            disabled={event.remaining <= 0}
                            onClick={() => {
                              setSelected(event);
                              setQty(1);
                            }}
                          >
                            {event.remaining > 0
                              ? 'Đặt vé ↗' : 'Hết vé'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {filtered.length === 0 && (
                  <div className="empty">
                    Chưa tìm thấy sự kiện phù hợp. ❄
                  </div>
                )}
              </section>

              <section className="feature-banner">
                <div>
                  <span className="section-kicker">THE GIFT OF EXPERIENCES</span>
                  <h2>Tặng nhau một <em>kỷ niệm.</em></h2>
                  <p>
                    Có những món quà không nằm trong hộp,
                    mà nằm trong những khoảnh khắc bên nhau.
                  </p>
                  <button onClick={() => go('home')}>
                    Khám phá ngay ↗
                  </button>
                </div>
                <div className="feature-symbol">✳</div>
              </section>
            </>
          )}

          {page === 'auth' && (
            <section className="auth-layout">
              <div className="auth-story">
                <span className="section-kicker">
                  ✦ YOUR NEXT EXPERIENCE AWAITS
                </span>
                <h2>
                  Mọi câu chuyện đẹp
                  <br />
                  đều có một <em>khởi đầu.</em>
                </h2>
                <p>
                  Một tài khoản, vô vàn trải nghiệm.
                  Đăng nhập để lưu giữ những tấm vé
                  và kỷ niệm của riêng bạn.
                </p>
                <div className="auth-decoration">✳</div>
              </div>

              <div className="auth-box">
                <span className="section-kicker">WELCOME TO VEONLINE</span>
                <h2>
                  {authMode === 'login'
                    ? 'Chào mừng trở lại'
                    : 'Tạo tài khoản'}
                </h2>
                <p className="auth-subtitle">
                  {authMode === 'login'
                    ? 'Đăng nhập để tiếp tục trải nghiệm.'
                    : 'Tham gia cộng đồng yêu trải nghiệm.'}
                </p>

                <form onSubmit={handleAuth}>
                  {authMode === 'register' && (
                    <>
                      <label>Họ và tên</label>
                      <input
                        required
                        value={auth.name}
                        placeholder="Tên của bạn"
                        onChange={e => setAuth({
                          ...auth, name: e.target.value
                        })}
                      />
                      <label>Email</label>
                      <input
                        required type="email"
                        value={auth.email}
                        placeholder="hello@example.com"
                        onChange={e => setAuth({
                          ...auth, email: e.target.value
                        })}
                      />
                    </>
                  )}

                  {authMode === 'login' && (
                    <>
                      <label>Email hoặc tên đăng nhập</label>
                      <input
                        required
                        value={auth.login}
                        placeholder="Nhập email hoặc tài khoản"
                        onChange={e => setAuth({
                          ...auth, login: e.target.value
                        })}
                      />
                    </>
                  )}

                  <label>Mật khẩu</label>
                  <input
                    required type="password"
                    minLength={authMode === 'register' ? 8 : 1}
                    value={auth.password}
                    placeholder="Nhập mật khẩu"
                    onChange={e => setAuth({
                      ...auth, password: e.target.value
                    })}
                  />

                  <button className="primary-btn full" type="submit">
                    {authMode === 'login'
                      ? 'Đăng nhập ↗'
                      : 'Tạo tài khoản ↗'}
                  </button>
                </form>

                <p className="switch-auth">
                  {authMode === 'login'
                    ? 'Chưa có tài khoản?'
                    : 'Đã có tài khoản?'}{' '}
                  <button onClick={() => {
                    setAuthMode(
                      authMode === 'login' ? 'register' : 'login'
                    );
                    setMessage('');
                  }}>
                    {authMode === 'login'
                      ? 'Đăng ký ngay'
                      : 'Đăng nhập'}
                  </button>
                </p>
              </div>
            </section>
          )}

          {page === 'tickets' && user && (
            <section className="content-section inner-page">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    MY EXPERIENCES
                  </span>
                  <h2>Vé <em>của tôi</em></h2>
                  <p>Những khoảnh khắc tuyệt vời đang chờ bạn.</p>
                </div>
                <button className="outline-btn" onClick={loadTickets}>
                  ↻ Làm mới
                </button>
              </div>

              <div className="ticket-list">
                {tickets.map(ticket => (
                  <article className="ticket" key={ticket.code}>
                    <div className="ticket-icon">✦</div>
                    <div className="ticket-main">
                      <span className="section-kicker">
                        VEONLINE E-TICKET
                      </span>
                      <h3>{ticket.eventTitle}</h3>
                      <p>◷ {ticket.date} · ⌖ {ticket.venue}</p>
                      <div className="ticket-meta">
                        <span>{ticket.quantity} vé</span>
                        <span>{money(ticket.total)}</span>
                        <span className={
                          ticket.checkedInAt
                            ? 'status-used' : 'status-valid'
                        }>
                          {ticket.checkedInAt
                            ? 'Đã check-in' : 'Chưa check-in'}
                        </span>
                      </div>
                      <code>{ticket.code}</code>
                    </div>
                    <div className="ticket-action">
                      <button onClick={() =>
                        window.open(
                          '/ticket/' + ticket.code,
                          '_blank'
                        )
                      }>
                        Xem vé & QR ↗
                      </button>
                    </div>
                  </article>
                ))}

                {tickets.length === 0 && (
                  <div className="empty">
                    <span>🎟️</span>
                    <h3>Chưa có tấm vé nào</h3>
                    <p>Chuyến phiêu lưu tiếp theo đang chờ bạn.</p>
                    <button className="primary-btn" onClick={() => go('home')}>
                      Khám phá sự kiện
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {page === 'admin' && isAdmin && (
            <section className="content-section inner-page">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    VEONLINE MANAGEMENT
                  </span>
                  <h2>Trung tâm <em>quản lý</em></h2>
                  <p>Xin chào, {user.name}. Chúc một ngày tốt lành!</p>
                </div>
                <button className="primary-btn" onClick={() => editEvent()}>
                  + Tạo sự kiện
                </button>
              </div>

              <div className="stats-grid">
                <div className="stat">
                  <span>✧ Tổng sự kiện</span>
                  <strong>{events.length}</strong>
                  <small>Đang hiển thị</small>
                </div>
                <div className="stat">
                  <span>🎟 Vé đã đặt</span>
                  <strong>{totalSold}</strong>
                  <small>Tổng số lượng vé</small>
                </div>
                <div className="stat">
                  <span>✦ Giá trị đơn hàng</span>
                  <strong>{money(totalRevenue)}</strong>
                  <small>Chưa xác nhận thanh toán</small>
                </div>
              </div>

              <div className="admin-panel">
                <div className="panel-heading">
                  <h3>Quản lý sự kiện</h3>
                  <span>{events.length} sự kiện</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Sự kiện</th>
                        <th>Giá vé</th>
                        <th>Còn lại</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map(event => (
                        <tr key={event._id}>
                          <td>
                            <strong>{event.title}</strong>
                            <small>{event.date} · {event.venue}</small>
                          </td>
                          <td>{money(event.price)}</td>
                          <td>{event.remaining}</td>
                          <td>
                            <div className="table-actions">
                              <button onClick={() => editEvent(event)}>
                                Sửa
                              </button>
                              <button className="danger" onClick={() =>
                                removeEvent(event)
                              }>
                                Ẩn
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="admin-panel">
                <div className="panel-heading">
                  <h3>Check-in vé</h3>
                  <span>Nhập hoặc dán mã từ QR</span>
                </div>
                <form className="checkin-form" onSubmit={checkIn}>
                  <input
                    placeholder="Nhập mã vé hoặc đường dẫn QR..."
                    value={checkCode}
                    onChange={e => setCheckCode(e.target.value)}
                  />
                  <button className="primary-btn" disabled={checking}>
                    {checking ? 'Đang xử lý...' : 'Xác nhận check-in'}
                  </button>
                </form>
              </div>

              <div className="admin-panel">
                <div className="panel-heading">
                  <h3>Đơn đặt vé</h3>
                  <button onClick={loadOrders}>↻ Tải lại</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Khách hàng</th>
                        <th>Sự kiện</th>
                        <th>Số vé</th>
                        <th>Tổng tiền</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminOrders.map(order => (
                        <tr key={order.code}>
                          <td>
                            <strong>{order.name}</strong>
                            <small>{order.email}</small>
                          </td>
                          <td>{order.eventTitle}</td>
                          <td>{order.quantity}</td>
                          <td>{money(order.total)}</td>
                          <td>
                            {order.checkedInAt
                              ? '✅ Đã check-in'
                              : '⏳ Chưa check-in'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setSelected(null)}>
              ×
            </button>
            <span className="section-kicker">
              YOUR NEXT EXPERIENCE
            </span>
            <h2>Đặt vé sự kiện</h2>
            <h3>{selected.title}</h3>
            <p>◷ {selected.date}</p>
            <p>⌖ {selected.venue}</p>
            <div className="quantity-row">
              <span>Số lượng vé</span>
              <div className="quantity">
                <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                <strong>{qty}</strong>
                <button onClick={() =>
                  setQty(Math.min(8, selected.remaining, qty + 1))
                }>+</button>
              </div>
            </div>
            <div className="modal-total">
              <span>Tổng cộng</span>
              <strong>{money(selected.price * qty)}</strong>
            </div>
            <button className="primary-btn full" onClick={book}>
              {user ? 'Xác nhận đặt vé ↗' : 'Đăng nhập để đặt vé ↗'}
            </button>
            <p className="modal-note">
              Đây là hệ thống đặt vé demo, chưa xử lý thanh toán trực tuyến.
            </p>
          </div>
        </div>
      )}

      {editing && isAdmin && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal event-modal" onClick={e => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setEditing(null)}>
              ×
            </button>
            <span className="section-kicker">EVENT EDITOR</span>
            <h2>{editing === 'new' ? 'Tạo sự kiện' : 'Chỉnh sửa sự kiện'}</h2>
            <form onSubmit={saveEvent} className="event-form">
              <label>Tên sự kiện</label>
              <input required maxLength="100"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
              />
              <label>Danh mục</label>
              <select value={form.category} onChange={e =>
                setForm({ ...form, category: e.target.value })
              }>
                <option>Âm nhạc</option>
                <option>Workshop</option>
                <option>Triển lãm</option>
              </select>
              <label>Thời gian</label>
              <input required value={form.date}
                placeholder="24/12/2026 · 19:00"
                onChange={e => setForm({ ...form, date: e.target.value })}
              />
              <label>Địa điểm</label>
              <input required value={form.venue}
                onChange={e => setForm({ ...form, venue: e.target.value })}
              />
              <label>Mô tả</label>
              <textarea required rows="3" value={form.description}
                onChange={e => setForm({
                  ...form, description: e.target.value
                })}
              />
              <div className="form-columns">
                <div>
                  <label>Giá vé (VND)</label>
                  <input type="number" min="0" required value={form.price}
                    onChange={e => setForm({
                      ...form, price: e.target.value
                    })}
                  />
                </div>
                <div>
                  <label>Số vé còn lại</label>
                  <input type="number" min="0" required
                    value={form.remaining}
                    onChange={e => setForm({
                      ...form, remaining: e.target.value
                    })}
                  />
                </div>
              </div>
              <button className="primary-btn full" type="submit">
                Lưu sự kiện ↗
              </button>
            </form>
          </div>
        </div>
      )}

      <footer className="footer">
        <div>
          <strong>✦ veonline</strong>
          <p>Collect moments, not things.</p>
        </div>
        <span>Made with love, magic & a little Christmas sparkle.</span>
        <span>© 2026 VeOnline</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
