
import React, {
  useEffect,
  useState
} from 'react';

import { createRoot } from 'react-dom/client';
import Admin from './Admin.jsx';

import {
  PasswordRecovery,
  SeatPicker
} from './SeatsAndPassword.jsx';

import './style.css';
import './seats-password.css';

const money = value =>
  Number(value || 0).toLocaleString('vi-VN') + 'đ';

const initialAuth = {
  name: '',
  username: '',
  email: '',
  login: '',
  password: ''
};

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await response.json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || `Lỗi API ${response.status}`
    );
  }

  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState([]);

  const [page, setPage] = useState(
    new URLSearchParams(
      window.location.search
    ).has('reset')
      ? 'recovery'
      : 'home'
  );

  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ ...initialAuth });

  const [category, setCategory] = useState('Tất cả');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState(null);
  const [seatMode, setSeatMode] = useState(null);
  const [quantity, setQuantity] = useState(1);

  const [checkout, setCheckout] = useState(null);
  const [method, setMethod] = useState('bank');
  const [paymentInfo, setPaymentInfo] = useState(null);

  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snow, setSnow] = useState(true);

  const isAdmin = user?.role === 'admin';
  const isCustomer = user?.role === 'customer';

  function notify(message) {
    setNotice(String(message));
  }

  function go(where) {
    setPage(where);

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  async function refreshEvents() {
    const data = await api('/events');
    setEvents(data);
    return data;
  }

  async function refreshTickets() {
    if (user?.role !== 'customer') return;

    const data = await api('/my/bookings');
    setTickets(data);
    return data;
  }

  // ======================================
  // LOAD
  // ======================================

  useEffect(() => {
    let mounted = true;

    async function start() {
      try {
        const [session, eventData, payment] =
          await Promise.all([
            api('/auth/me'),
            api('/events'),
            api('/payments/config')
          ]);

        if (!mounted) return;

        setUser(session.user);
        setEvents(eventData);
        setPaymentInfo(payment);
      } catch (error) {
        if (mounted) notify(error.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    start();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (page === 'tickets' && isCustomer) {
      refreshTickets().catch(error =>
        notify(error.message)
      );
    }
  }, [page, user]);

  // ======================================
  // AUTHENTICATION
  // ======================================

  async function authenticate(e) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);

    try {
      const register = authMode === 'register';

      const body = register
        ? {
            name: auth.name,
            username: auth.username,
            email: auth.email,
            password: auth.password
          }
        : {
            login: auth.login,
            password: auth.password
          };

      const data = await api(
        register
          ? '/auth/register'
          : '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      );

      setUser(data.user);
      setAuth({ ...initialAuth });

      go(
        data.user.role === 'admin'
          ? 'admin'
          : 'home'
      );

      notify('Đăng nhập thành công.');
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', {
        method: 'POST'
      });

      setUser(null);
      setTickets([]);
      setCheckout(null);

      go('home');
    } catch (error) {
      notify(error.message);
    }
  }

  // ======================================
  // BOOKING
  // ======================================

  function openBooking(event) {
    setSelected(event);
    setSeatMode(null);
    setQuantity(1);
  }

  async function booked(order) {
    setSelected(null);
    setCheckout(order);
    setMethod('bank');

    await refreshEvents();
    await refreshTickets();

    notify(
      'Đã tạo đơn. Vui lòng chọn phương thức thanh toán.'
    );
  }

  async function bookNormal() {
    if (
      seatMode !== false ||
      busy ||
      !selected
    ) {
      return;
    }

    setBusy(true);

    try {
      const order = await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          eventId: selected._id,
          quantity
        })
      });

      await booked(order);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment() {
    if (!checkout) return;

    setBusy(true);

    try {
      await api(
        '/payments/' +
          encodeURIComponent(checkout.code) +
          '/submit',
        {
          method: 'POST',
          body: JSON.stringify({ method })
        }
      );

      setCheckout(null);
      go('tickets');

      await refreshTickets();

      notify(
        'Đã gửi yêu cầu đối chiếu thanh toán. ' +
        'Admin sẽ kiểm tra tiền thực nhận.'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  const paymentEnabled = method === 'bank'
    ? Boolean(
        paymentInfo?.bank?.name &&
        paymentInfo?.bank?.account &&
        paymentInfo?.bank?.owner
      )
    : Boolean(
        paymentInfo?.momo?.phone &&
        paymentInfo?.momo?.owner
      );

  const visible = events.filter(event =>
    (
      category === 'Tất cả' ||
      event.category === category
    ) &&
    [event.title, event.venue]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  function locationName(order) {
    return order.zoneId
      ? 'Khu ' + order.zoneId
      : order.seatIds?.length
        ? order.seatIds.join(', ')
        : 'Vé thường';
  }

  function paymentLabel(order) {
    if (order.payment?.status === 'paid') {
      return 'Đã xác nhận thanh toán';
    }

    if (order.payment?.status === 'pending_review') {
      return 'Chờ Admin đối chiếu';
    }

    return 'Chưa thanh toán';
  }

  // ======================================
  // RENDER
  // ======================================

  return (
    <div className="app">
      {snow && (
        <div className="snow-layer" aria-hidden="true">
          {Array.from({ length: 25 }, (_, i) => (
            <span
              key={i}
              style={{
                '--x': `${(i * 37 + 9) % 100}%`,
                '--delay': `${-i * 0.7}s`,
                '--duration': `${10 + i % 7}s`,
                '--size': `${3 + i % 5}px`
              }}
            />
          ))}
        </div>
      )}

      <div className="announcement">
        ✦ VEONLINE CHRISTMAS • COLLECT MOMENTS,
        NOT THINGS ✦
      </div>

      {/* HEADER */}

      <header className="header">
        <div className="nav-container">
          <button
            className="logo"
            type="button"
            onClick={() => go('home')}
          >
            <span className="logo-icon">✦</span>
            ve<span>online</span>
            <small>EVENTS & EXPERIENCES</small>
          </button>

          <nav>
            <button
              type="button"
              className={
                page === 'home' ? 'active' : ''
              }
              onClick={() => go('home')}
            >
              Khám phá
            </button>

            {isCustomer && (
              <button
                type="button"
                className={
                  page === 'tickets' ? 'active' : ''
                }
                onClick={() => go('tickets')}
              >
                Vé của tôi
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                className={
                  page === 'admin' ? 'active' : ''
                }
                onClick={() => go('admin')}
              >
                Quản lý
              </button>
            )}
          </nav>

          <div className="nav-actions">
            <button
              className="snow-button"
              type="button"
              onClick={() => setSnow(!snow)}
            >
              ❄
            </button>

            {user ? (
              <>
                <span className="user-name">
                  {user.name}
                </span>

                <button
                  className="outline-btn"
                  type="button"
                  onClick={() => go('recovery')}
                >
                  Đổi mật khẩu
                </button>

                <button
                  className="outline-btn"
                  type="button"
                  onClick={logout}
                >
                  Đăng xuất
                </button>
              </>
            ) : (
              <button
                className="primary-btn"
                type="button"
                onClick={() => go('auth')}
              >
                Đăng nhập
              </button>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="toast">
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice('')}
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading">
          Đang tải VeOnline...
        </div>
      ) : (
        <>
          {/* HOMEPAGE */}

          {page === 'home' && (
            <>
              <section className="hero">
                <div className="hero-glow" />

                <div className="hero-copy">
                  <span className="eyebrow">
                    ✦ THE HOLIDAY COLLECTION
                  </span>

                  <h1>
                    Khoảnh khắc đẹp
                    <br />
                    bắt đầu từ
                    <br />
                    <em>một tấm vé.</em>
                  </h1>

                  <p>
                    Khám phá những concert,
                    workshop và triển lãm đáng nhớ.
                    Chọn khu A–E, nhận vé QR điện tử
                    và lưu giữ kỷ niệm cùng VeOnline.
                  </p>

                  <button
                    className="gold-btn"
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('events')
                        ?.scrollIntoView({
                          behavior: 'smooth'
                        })
                    }
                  >
                    Khám phá sự kiện ↗
                  </button>

                  <div className="hero-footer">
                    <span>✧ Đặt vé trực tuyến</span>
                    <span>✧ Chọn khu vực</span>
                    <span>✧ QR điện tử</span>
                  </div>
                </div>

                <div className="hero-art">
                  <div className="art-star">✧</div>

                  <div className="art-circle">
                    <span>✦</span>
                    <strong>THE MOST</strong>
                    <strong>WONDERFUL</strong>
                    <strong>TIME</strong>
                    <i>OF THE YEAR</i>
                  </div>
                </div>
              </section>

              <section
                className="content-section"
                id="events"
              >
                <div className="section-heading">
                  <div>
                    <span className="section-kicker">
                      CURATED FOR YOU
                    </span>

                    <h2>
                      Sự kiện <em>nổi bật</em>
                    </h2>

                    <p>Chọn trải nghiệm của bạn</p>
                  </div>
                </div>

                <div className="filters">
                  <div className="filter-tabs">
                    {[
                      'Tất cả',
                      'Âm nhạc',
                      'Workshop',
                      'Triển lãm'
                    ].map(item => (
                      <button
                        key={item}
                        type="button"
                        className={
                          category === item
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setCategory(item)
                        }
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  <input
                    className="search"
                    placeholder="Tìm sự kiện..."
                    value={search}
                    onChange={e =>
                      setSearch(e.target.value)
                    }
                  />
                </div>

                <div className="event-grid">
                  {visible.map(event => (
                    <article
                      className="event-card"
                      key={event._id}
                    >
                      <div
                        className={
                          'event-poster theme-' +
                          (event.theme || 'night')
                        }
                      >
                        <div className="poster-top">
                          <span>VEONLINE PRESENTS</span>
                          <span>✦</span>
                        </div>

                        <div className="poster-art">
                          {event.category === 'Âm nhạc'
                            ? '♫'
                            : event.category === 'Workshop'
                              ? '✿'
                              : '✧'}
                        </div>

                        <div className="poster-bottom">
                          <span>{event.category}</span>
                          <strong>{event.title}</strong>
                          <small>
                            AN EXPERIENCE TO REMEMBER
                          </small>
                        </div>
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
                            <small>Giá vé từ</small>
                            <strong>
                              {money(event.price)}
                            </strong>
                          </div>

                          <button
                            type="button"
                            disabled={event.remaining <= 0}
                            onClick={() =>
                              openBooking(event)
                            }
                          >
                            {event.remaining > 0
                              ? 'Đặt vé ↗'
                              : 'Hết vé'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {!visible.length && (
                  <div className="empty">
                    Chưa có sự kiện phù hợp.
                  </div>
                )}
              </section>
            </>
          )}

          {/* LOGIN / REGISTER */}

          {page === 'auth' && (
            <section className="auth-layout">
              <div className="auth-story">
                <span className="section-kicker">
                  WELCOME TO VEONLINE
                </span>

                <h2>
                  Hẹn gặp bạn tại
                  <br />
                  <em>khoảnh khắc đẹp.</em>
                </h2>

                <p>
                  Một tài khoản, vô vàn trải nghiệm.
                </p>

                <div className="auth-decoration">
                  ✳
                </div>
              </div>

              <div className="auth-box">
                <h2>
                  {authMode === 'register'
                    ? 'Tạo tài khoản'
                    : 'Chào mừng trở lại'}
                </h2>

                <form onSubmit={authenticate}>
                  {(
                    authMode === 'register'
                      ? [
                          ['Họ tên', 'name', 'text'],
                          ['Username', 'username', 'text'],
                          ['Email', 'email', 'email'],
                          ['Mật khẩu', 'password', 'password']
                        ]
                      : [
                          [
                            'Username hoặc email',
                            'login',
                            'text'
                          ],
                          [
                            'Mật khẩu',
                            'password',
                            'password'
                          ]
                        ]
                  ).map(([label, key, type]) => (
                    <React.Fragment key={key}>
                      <label>{label}</label>

                      <input
                        required
                        type={type}
                        value={auth[key]}
                        onChange={e =>
                          setAuth(previous => ({
                            ...previous,
                            [key]: e.target.value
                          }))
                        }
                        minLength={
                          key === 'password' &&
                          authMode === 'register'
                            ? 8
                            : undefined
                        }
                      />
                    </React.Fragment>
                  ))}

                  {authMode === 'login' && (
                    <button
                      type="button"
                      className="upgrade-back"
                      onClick={() => go('recovery')}
                    >
                      Quên mật khẩu?
                    </button>
                  )}

                  <button
                    className="primary-btn full"
                    type="submit"
                    disabled={busy}
                  >
                    {busy
                      ? 'Đang xử lý...'
                      : authMode === 'register'
                        ? 'Đăng ký'
                        : 'Đăng nhập'}
                  </button>
                </form>

                <p className="switch-auth">
                  <button
                    type="button"
                    onClick={() =>
                      setAuthMode(
                        authMode === 'login'
                          ? 'register'
                          : 'login'
                      )
                    }
                  >
                    {authMode === 'login'
                      ? 'Chưa có tài khoản? Đăng ký'
                      : 'Đã có tài khoản? Đăng nhập'}
                  </button>
                </p>
              </div>
            </section>
          )}

          {/* PASSWORD RECOVERY */}

          {page === 'recovery' && (
            <PasswordRecovery
              user={user}
              onDone={() => {
                window.history.replaceState(
                  {},
                  '',
                  window.location.pathname
                );

                setUser(null);
                go('auth');
              }}
            />
          )}

          {/* ADMIN */}

          {page === 'admin' && isAdmin && (
            <Admin
              events={events}
              api={api}
              reloadEvents={refreshEvents}
              notify={notify}
            />
          )}

          {/* MY TICKETS */}

          {page === 'tickets' && isCustomer && (
            <section className="content-section inner-page">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    MY EXPERIENCES
                  </span>

                  <h2>
                    Vé <em>của tôi</em>
                  </h2>
                </div>

                <button
                  className="outline-btn"
                  type="button"
                  onClick={() =>
                    refreshTickets().catch(error =>
                      notify(error.message)
                    )
                  }
                >
                  ↻ Làm mới
                </button>
              </div>

              <div className="ticket-list">
                {tickets.map(order => (
                  <article
                    className="ticket"
                    key={order.code}
                  >
                    <div className="ticket-icon">
                      ✦
                    </div>

                    <div className="ticket-main">
                      <span className="section-kicker">
                        VEONLINE E-TICKET
                      </span>

                      <h3>{order.eventTitle}</h3>

                      <p>◷ {order.date}</p>
                      <p>⌖ {order.venue}</p>

                      <p>
                        <strong>Khu vực:</strong>{' '}
                        {locationName(order)}
                      </p>

                      <p>
                        <strong>
                          {order.quantity} vé —{' '}
                          {money(order.total)}
                        </strong>
                      </p>

                      <p>
                        <strong>Thanh toán:</strong>{' '}
                        {paymentLabel(order)}
                      </p>

                      <p>
                        {order.checkedInAt
                          ? 'Đã check-in'
                          : 'Chưa check-in'}
                      </p>

                      <code
                        style={{
                          overflowWrap: 'anywhere'
                        }}
                      >
                        {order.code}
                      </code>
                    </div>

                    <div className="ticket-action">
                      <button
                        type="button"
                        onClick={() =>
                          window.open(
                            '/ticket/' +
                              encodeURIComponent(order.code),
                            '_blank',
                            'noopener,noreferrer'
                          )
                        }
                      >
                        Xem vé & QR ↗
                      </button>

                      {order.payment?.status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => {
                            setCheckout(order);
                            setMethod(
                              order.payment?.method || 'bank'
                            );
                          }}
                        >
                          Thanh toán ↗
                        </button>
                      )}
                    </div>
                  </article>
                ))}

                {!tickets.length && (
                  <div className="empty">
                    <h3>Bạn chưa có vé nào.</h3>

                    <button
                      className="primary-btn"
                      type="button"
                      onClick={() => go('home')}
                    >
                      Khám phá concert
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* BOOKING MODAL */}

      {selected && (
        <div
          className="overlay"
          onClick={() => setSelected(null)}
        >
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="close-modal"
              type="button"
              onClick={() => setSelected(null)}
            >
              ×
            </button>

            <span className="section-kicker">
              VEONLINE BOOKING
            </span>

            <h2>Đặt vé</h2>
            <h3>{selected.title}</h3>

            <p>
              {selected.date} · {selected.venue}
            </p>

            <p>
              Giá vé: {money(selected.price)}
            </p>

            {!user ? (
              <button
                className="primary-btn full"
                type="button"
                onClick={() => {
                  setSelected(null);
                  go('auth');
                }}
              >
                Đăng nhập để mua vé
              </button>
            ) : isAdmin ? (
              <p>
                Admin không thể mua vé bằng tài khoản quản trị.
              </p>
            ) : (
              <>
                <SeatPicker
                  event={selected}
                  onModeChange={setSeatMode}
                  onSuccess={booked}
                  onError={notify}
                />

                {seatMode === false && (
                  <>
                    <div className="quantity-row">
                      <span>Số lượng vé</span>

                      <div className="quantity">
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(n =>
                              Math.max(1, n - 1)
                            )
                          }
                        >
                          −
                        </button>

                        <strong>{quantity}</strong>

                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(n =>
                              Math.min(
                                8,
                                selected.remaining,
                                n + 1
                              )
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="modal-total">
                      <span>Tổng tiền</span>
                      <strong>
                        {money(selected.price * quantity)}
                      </strong>
                    </div>

                    <button
                      className="primary-btn full"
                      type="button"
                      disabled={busy}
                      onClick={bookNormal}
                    >
                      Tiếp tục thanh toán ↗
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}

      {checkout && (
        <div
          className="overlay"
          onClick={() => {
            setCheckout(null);
            go('tickets');
          }}
        >
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="close-modal"
              onClick={() => {
                setCheckout(null);
                go('tickets');
              }}
            >
              ×
            </button>

            <span className="section-kicker">
              VEONLINE PAYMENT
            </span>

            <h2>Thanh toán vé</h2>
            <h3>{checkout.eventTitle}</h3>

            <p>
              {checkout.quantity} vé ·{' '}
              {locationName(checkout)}
            </p>

            <div className="modal-total">
              <span>Cần thanh toán</span>

              <strong>
                {money(checkout.total)}
              </strong>
            </div>

            <label
              style={{
                display: 'block',
                marginTop: 18,
                fontWeight: 700
              }}
            >
              Chọn phương thức
            </label>

            <div
              style={{
                display: 'flex',
                gap: 10,
                margin: '12px 0'
              }}
            >
              <button
                type="button"
                className={
                  method === 'bank'
                    ? 'primary-btn'
                    : 'outline-btn'
                }
                onClick={() => setMethod('bank')}
              >
                🏦 Ngân hàng
              </button>

              <button
                type="button"
                className={
                  method === 'momo'
                    ? 'primary-btn'
                    : 'outline-btn'
                }
                onClick={() => setMethod('momo')}
              >
                💗 MoMo
              </button>
            </div>

            {method === 'bank' ? (
              <div className="payment-instructions">
                <p>
                  <strong>Ngân hàng:</strong>{' '}
                  {paymentInfo?.bank?.name ||
                    'Chưa cấu hình'}
                </p>

                <p>
                  <strong>Số tài khoản:</strong>{' '}
                  {paymentInfo?.bank?.account ||
                    'Chưa cấu hình'}
                </p>

                <p>
                  <strong>Chủ tài khoản:</strong>{' '}
                  {paymentInfo?.bank?.owner ||
                    'Chưa cấu hình'}
                </p>
              </div>
            ) : (
              <div className="payment-instructions">
                <p>
                  <strong>Ví MoMo:</strong>{' '}
                  {paymentInfo?.momo?.phone ||
                    'Chưa cấu hình'}
                </p>

                <p>
                  <strong>Người nhận:</strong>{' '}
                  {paymentInfo?.momo?.owner ||
                    'Chưa cấu hình'}
                </p>
              </div>
            )}

            <p>
              <strong>
                Nội dung chuyển tiền:
              </strong>
            </p>

            <div
              style={{
                overflowWrap: 'anywhere',
                padding: 12,
                background: '#f1f4ef',
                borderRadius: 9,
                fontSize: 12
              }}
            >
              <code>{checkout.code}</code>

              <button
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(checkout.code)
                    .then(() =>
                      notify('Đã sao chép mã đơn.')
                    )
                    .catch(() =>
                      notify('Không sao chép được.')
                    )
                }
              >
                Sao chép
              </button>
            </div>

            <p
              style={{
                fontSize: 13,
                color: '#725d47',
                margin: '14px 0'
              }}
            >
              Chuyển đúng số tiền và ghi đúng mã đơn.
              Chỉ gửi yêu cầu xác nhận sau khi đã
              chuyển tiền. Admin sẽ kiểm tra giao dịch
              thực tế.
            </p>

            <button
              className="primary-btn full"
              type="button"
              disabled={!paymentEnabled || busy}
              onClick={submitPayment}
            >
              {!paymentEnabled
                ? 'Phương thức chưa cấu hình'
                : busy
                  ? 'Đang gửi...'
                  : 'Tôi đã chuyển tiền — yêu cầu xác nhận'}
            </button>

            <button
              className="outline-btn"
              type="button"
              style={{
                width: '100%',
                marginTop: 10
              }}
              onClick={() => {
                setCheckout(null);
                go('tickets');
              }}
            >
              Thanh toán sau · Xem vé của tôi
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}

      <footer className="footer">
        <div>
          <strong>✦ veonline</strong>
          <p>Collect moments, not things.</p>
        </div>

        <span>© 2026 VeOnline</span>
      </footer>
    </div>
  );
}

createRoot(
  document.getElementById('root')
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
