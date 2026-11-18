
import React, { useEffect, useState } from 'react';
import './seats-password.css';

const IDS = ['A', 'B', 'C', 'D', 'E'];
const money = n =>
  Number(n || 0).toLocaleString('vi-VN') + 'đ';

async function request(path, method = 'GET', body) {
  const response = await fetch('/api/upgrade' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Không thực hiện được.');
  }

  return data;
}

async function getAdminOrders() {
  const response = await fetch('/api/admin/bookings', {
    credentials: 'same-origin'
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Không tải được đơn.');
  return data;
}

// =====================================
// MAP DÙNG CHUNG CHO KHÁCH VÀ ADMIN
// =====================================

function ZoneMap({
  zones = [],
  selected = '',
  onSelect,
  disabled = false,
  allowFull = false
}) {
  return (
    <div className="zone-map-shell">
      <div className="zone-stage">
        ✦ SÂN KHẤU CONCERT ✦
      </div>

      <div className="zone-map">
        {IDS.map(id => {
          const zone = zones.find(z => z.id === id);
          if (!zone) return null;

          const full = zone.remaining <= 0;
          const active = selected === id;

          return (
            <button
              key={id}
              type="button"
              className={[
                'zone-block',
                `zone-${id.toLowerCase()}`,
                active ? 'is-selected' : '',
                full ? 'is-full' : ''
              ].join(' ')}
              disabled={
                disabled || !onSelect ||
                (full && !allowFull)
              }
              onClick={() => onSelect?.(id)}
              aria-pressed={active}
            >
              <span className="zone-code">KHU {id}</span>

              <span className="zone-range">
                {zone.range || `${id}1–${id}${zone.capacity}`}
              </span>

              <span className="zone-remaining">
                {full ? 'HẾT VÉ' : `Còn ${zone.remaining} chỗ`}
              </span>

              <span className="zone-capacity">
                {zone.booked}/{zone.capacity} đã đặt
              </span>
            </button>
          );
        })}
      </div>

      <div className="zone-map-bottom">
        <span>✦ Lối vào</span>
      </div>

      <div className="zone-legend">
        <span><i className="legend-available" /> Còn chỗ</span>
        <span><i className="legend-active" /> Đang chọn</span>
        <span><i className="legend-unavailable" /> Hết vé</span>
      </div>

      <p className="zone-hint">
        Dãy A1–A20 chỉ minh họa sức chứa khu.
        Vé không cấp số ghế cụ thể.
      </p>
    </div>
  );
}

// =====================================
// KHÔI PHỤC MẬT KHẨU
// =====================================

export function PasswordRecovery({ user, onDone }) {
  const token = new URLSearchParams(
    window.location.search
  ).get('reset');

  const mode = token ? 'reset' : user ? 'change' : 'forgot';

  const [identifier, setIdentifier] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    if (mode !== 'forgot' && password !== confirm) {
      setMessage('Hai mật khẩu không trùng nhau.');
      return;
    }

    setBusy(true);
    setMessage('');
    setSuccess(false);

    try {
      let data;

      if (mode === 'forgot') {
        data = await request('/password/forgot', 'POST', {
          identifier
        });
      } else if (mode === 'reset') {
        data = await request('/password/reset', 'POST', {
          token, password
        });
      } else {
        data = await request('/password/change', 'POST', {
          oldPassword,
          newPassword: password
        });
      }

      setMessage(data.message);
      setSuccess(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upgrade-auth">
      <div className="upgrade-auth-card">
        <span className="upgrade-kicker">
          ✦ VEONLINE ACCOUNT SECURITY
        </span>

        <h2>
          {mode === 'forgot'
            ? 'Quên mật khẩu?'
            : mode === 'reset'
              ? 'Mật khẩu mới'
              : 'Đổi mật khẩu'}
        </h2>

        <p>
          {mode === 'forgot'
            ? 'Nhập username hoặc email. Chúng tôi sẽ gửi liên kết khôi phục đến email đã liên kết.'
            : 'Bảo vệ tài khoản và những tấm vé của bạn.'}
        </p>

        <form onSubmit={submit}>
          {mode === 'forgot' && (
            <>
              <label>Username hoặc email</label>
              <input
                required
                type="text"
                value={identifier}
                placeholder="Nhập tên đăng nhập hoặc email"
                onChange={e => setIdentifier(e.target.value)}
              />
            </>
          )}

          {mode === 'change' && (
            <>
              <label>Mật khẩu hiện tại</label>
              <input
                required
                type="password"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
              />
            </>
          )}

          {mode !== 'forgot' && (
            <>
              <label>Mật khẩu mới</label>
              <input
                required
                type="password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />

              <label>Xác nhận mật khẩu</label>
              <input
                required
                type="password"
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </>
          )}

          <button type="submit" disabled={busy}>
            {busy
              ? 'Đang xử lý...'
              : mode === 'forgot'
                ? 'Gửi email khôi phục ↗'
                : 'Lưu mật khẩu mới ↗'}
          </button>
        </form>

        {message && (
          <div className="upgrade-notice" role="status">
            {message}
          </div>
        )}

        {success && mode !== 'forgot' && (
          <button
            type="button"
            className="upgrade-back"
            onClick={onDone}
          >
            Đăng nhập lại →
          </button>
        )}

        <button
          type="button"
          className="upgrade-back"
          onClick={onDone}
        >
          ← Quay lại
        </button>
      </div>
    </section>
  );
}

// =====================================
// KHÁCH HÀNG CHỌN KHU VỰC
// =====================================

export function SeatPicker({
  event, onModeChange, onSuccess, onError
}) {
  const [plan, setPlan] = useState(null);
  const [zoneId, setZoneId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');

    try {
      const data = await request(
        '/seats/' + encodeURIComponent(event._id)
      );

      setPlan(data);
      setZoneId('');
      setQuantity(1);
      onModeChange?.(data.enabled);
    } catch (err) {
      setError(err.message);
      onModeChange?.(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let live = true;

    setPlan(null);
    setZoneId('');
    setQuantity(1);
    setLoading(true);
    setError('');
    onModeChange?.(null);

    request('/seats/' + encodeURIComponent(event._id))
      .then(data => {
        if (!live) return;
        setPlan(data);
        onModeChange?.(data.enabled);
      })
      .catch(err => {
        if (!live) return;
        setError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => { live = false; };
  }, [event._id]);

  const zone = plan?.zones?.find(z => z.id === zoneId);
  const total = Number(event.price || 0) * quantity;

  async function book() {
    if (!zoneId || busy) return;

    setBusy(true);
    try {
      const order = await request('/seats/book', 'POST', {
        eventId: event._id,
        zoneId,
        quantity
      });

      await onSuccess?.(order);
    } catch (err) {
      onError?.(err.message);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="zone-loading">Đang tải bản đồ khu vực...</div>;
  }

  if (error) {
    return (
      <div className="zone-loading">
        <p>{error}</p>
        <button type="button" onClick={reload}>
          Thử lại
        </button>
      </div>
    );
  }

  if (!plan?.enabled) return null;

  return (
    <div className="zone-picker">
      <div className="zone-heading">
        <div>
          <span className="zone-kicker">
            CONCERT SEATING MAP
          </span>
          <h3>Chọn khu vực yêu thích</h3>
          <p>
            Chạm vào khu A, B, C, D hoặc E.
            Không cần chọn số ghế.
          </p>
        </div>

        <button
          type="button"
          className="zone-outline-button"
          onClick={reload}
        >
          ↻ Làm mới
        </button>
      </div>

      <ZoneMap
        zones={plan.zones}
        selected={zoneId}
        onSelect={setZoneId}
        disabled={busy}
      />

      <div className="zone-booking-summary">
        <div>
          <span>Khu vực</span>
          <strong>{zoneId ? `Khu ${zoneId}` : 'Chưa chọn'}</strong>
        </div>

        <div>
          <span>Số lượng vé</span>

          <div className="zone-stepper">
            <button
              type="button"
              disabled={busy || quantity <= 1}
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
            >
              −
            </button>
            <strong>{quantity}</strong>
            <button
              type="button"
              disabled={
                busy || quantity >= 8 ||
                (zone && quantity >= zone.remaining)
              }
              onClick={() =>
                setQuantity(q => Math.min(
                  8, zone?.remaining || 8, q + 1
                ))
              }
            >
              +
            </button>
          </div>
        </div>

        <div>
          <span>Tổng tiền</span>
          <strong className="zone-money">{money(total)}</strong>
        </div>
      </div>

      {zone && (
        <p className="zone-selection-note">
          Khu {zone.id} còn {zone.remaining} chỗ.
          Giá mỗi vé {money(event.price)}.
        </p>
      )}

      <button
        type="button"
        className="zone-primary-button"
        disabled={
          busy || !zone ||
          quantity < 1 || quantity > zone.remaining
        }
        onClick={book}
      >
        {busy
          ? 'Đang đặt vé...'
          : `Xác nhận đặt ${quantity} vé khu ${zoneId || '...'} ↗`}
      </button>
    </div>
  );
}

// =====================================
// ADMIN QUẢN LÝ 5 KHU VỰC
// =====================================

export function AdminSeats({ events, notify }) {
  const [eventId, setEventId] = useState('');
  const [plan, setPlan] = useState(null);
  const [orders, setOrders] = useState([]);

  const [capacities, setCapacities] = useState({
    A: 20, B: 20, C: 20, D: 20, E: 20
  });

  const [orderCode, setOrderCode] = useState('');
  const [newZone, setNewZone] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');

  const event = events.find(e => e._id === eventId);
  const order = orders.find(o => o.code === orderCode);

  const eventOrders = orders.filter(o =>
    o.eventId === eventId ||
    (!o.eventId && event && o.eventTitle === event.title)
  );

  useEffect(() => {
    if (!events.some(e => e._id === eventId)) {
      setEventId(events[0]?._id || '');
    }
  }, [events, eventId]);

  async function reload(id = eventId) {
    if (!id) return;

    const [zoneData, response] = await Promise.all([
      request('/seats/' + encodeURIComponent(id)),
      fetch('/api/admin/bookings', {
        credentials: 'same-origin'
      })
    ]);

    const orderData = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(orderData.message || 'Không tải được đơn.');
    }

    setPlan(zoneData);
    setOrders(orderData);

    if (zoneData.enabled) {
      const values = {};
      zoneData.zones.forEach(z => {
        values[z.id] = z.capacity;
      });
      setCapacities(values);
    }
  }

  useEffect(() => {
    if (!eventId) return;

    let active = true;
    setLoading(true);
    setPlan(null);
    setOrderCode('');
    setNewZone('');

    Promise.all([
      request('/seats/' + encodeURIComponent(eventId)),
      fetch('/api/admin/bookings', {
        credentials: 'same-origin'
      }).then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message || 'Lỗi đơn vé.');
        return d;
      })
    ]).then(([zoneData, orderData]) => {
      if (!active) return;

      setPlan(zoneData);
      setOrders(orderData);

      if (zoneData.enabled) {
        const values = {};
        zoneData.zones.forEach(z => {
          values[z.id] = z.capacity;
        });
        setCapacities(values);
      }
    }).catch(err => {
      if (active) notify?.(err.message);
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [eventId]);

  const totalCapacity = IDS.reduce(
    (sum, id) => sum + Number(capacities[id] || 0), 0
  );

  async function createPlan() {
    if (!eventId || busy) return;

    const zones = IDS.map(id => ({
      id,
      capacity: Number(capacities[id])
    }));

    if (zones.some(z =>
      !Number.isSafeInteger(z.capacity) || z.capacity < 1
    )) {
      notify?.('Sức chứa mỗi khu phải là số nguyên dương.');
      return;
    }

    setBusy(true);

    try {
      await request(
        '/admin/seats/' + encodeURIComponent(eventId),
        'PUT',
        { zones }
      );

      await reload();
      notify?.('Đã tạo thành công 5 khu A–E!');
    } catch (err) {
      notify?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveZoneChange() {
    if (!order || !newZone || busy) return;

    if (order.zoneId === newZone) {
      notify?.('Khu mới trùng với khu hiện tại.');
      return;
    }

    const yes = window.confirm(
      `Đổi vé của ${order.name} từ khu ${order.zoneId} ` +
      `sang khu ${newZone}?`
    );
    if (!yes) return;

    setBusy(true);
    try {
      await request(
        '/admin/bookings/change-seats',
        'PUT',
        { code: order.code, zoneId: newZone }
      );

      await reload();
      setOrderCode('');
      setNewZone('');
      notify?.('Đã đổi khu vực thành công!');
    } catch (err) {
      notify?.(err.message);
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-admin">
      <div className="zone-heading">
        <div>
          <span className="zone-kicker">
            VEONLINE • MANAGEMENT
          </span>
          <h2>Sơ đồ 5 khu vực</h2>
          <p>Quản lý concert theo khu A, B, C, D, E.</p>
        </div>

        <button
          type="button"
          className="zone-outline-button"
          onClick={() =>
            reload().catch(err => notify?.(err.message))
          }
        >
          ↻ Làm mới
        </button>
      </div>

      <div className="zone-admin-select">
        <label>Chọn concert / sự kiện</label>
        <select
          value={eventId}
          onChange={e => setEventId(e.target.value)}
        >
          {events.map(e => (
            <option value={e._id} key={e._id}>
              {e.title}
            </option>
          ))}
        </select>
      </div>

      {event && (
        <div className="zone-event-info">
          <strong>{event.title}</strong>
          <span>◷ {event.date}</span>
          <span>⌖ {event.venue}</span>
          <span>Giá vé: {money(event.price)}</span>
        </div>
      )}

      {loading && (
        <div className="zone-loading">
          Đang tải sơ đồ từ MongoDB...
        </div>
      )}

      {!loading && event && !plan?.enabled && (
        <div className="zone-plan-creator">
          <h3>✦ Thiết lập 5 khu vực</h3>
          <p>
            Nhập sức chứa từng khu. Hệ thống tự gán nhãn
            A1, A2…, B1, B2… để minh họa.
          </p>

          <div className="zone-capacity-grid">
            {IDS.map(id => (
              <label key={id}>
                Khu {id}
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={capacities[id]}
                  onChange={e => setCapacities(prev => ({
                    ...prev,
                    [id]: e.target.value
                  }))}
                />
              </label>
            ))}
          </div>

          <div className="zone-capacity-total">
            <span>Tổng sức chứa 5 khu</span>
            <strong>{totalCapacity}</strong>
            <span>Số vé còn lại: {event.remaining}</span>
          </div>

          <p className="zone-selection-note">
            Tổng sức chứa phải bằng số vé còn lại
            và concert chưa có đơn đặt vé.
          </p>

          <button
            type="button"
            className="zone-primary-button"
            disabled={busy}
            onClick={createPlan}
          >
            {busy ? 'Đang tạo...' : 'Tạo bản đồ 5 khu ↗'}
          </button>
        </div>
      )}

      {!loading && plan?.enabled && (
        <>
          <div className="zone-stat-grid">
            <div>
              <span>Tổng chỗ</span>
              <strong>
                {plan.zones.reduce((n, z) => n + z.capacity, 0)}
              </strong>
            </div>
            <div>
              <span>Còn trống</span>
              <strong>
                {plan.zones.reduce((n, z) => n + z.remaining, 0)}
              </strong>
            </div>
            <div>
              <span>Đã đặt</span>
              <strong>
                {plan.zones.reduce((n, z) => n + z.booked, 0)}
              </strong>
            </div>
          </div>

          <div className="zone-tabs">
            <button
              type="button"
              className={tab === 'overview' ? 'active' : ''}
              onClick={() => setTab('overview')}
            >
              Xem sơ đồ
            </button>
            <button
              type="button"
              className={tab === 'change' ? 'active' : ''}
              onClick={() => setTab('change')}
            >
              Đổi khu cho khách
            </button>
          </div>

          {tab === 'overview' && (
            <>
              <ZoneMap zones={plan.zones} />

              <div className="zone-details">
                {plan.zones.map(z => (
                  <div key={z.id}>
                    <strong>Khu {z.id}</strong>
                    <span>{z.range}</span>
                    <span>
                      Đã đặt {z.booked}/{z.capacity}
                    </span>
                    <span>Còn {z.remaining} chỗ</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'change' && (
            <div className="zone-change-panel">
              <h3>Đổi khu vực cho khách</h3>

              <label>Chọn đơn vé</label>
              <select
                value={orderCode}
                onChange={e => {
                  setOrderCode(e.target.value);
                  setNewZone('');
                }}
              >
                <option value="">-- Chọn đơn --</option>

                {eventOrders
                  .filter(o => o.zoneId)
                  .map(o => (
                    <option value={o.code} key={o.code}>
                      {o.name} — Khu {o.zoneId} —
                      {o.quantity} vé
                      {o.checkedInAt ? ' (Đã check-in)' : ''}
                    </option>
                  ))}
              </select>

              {order && (
                <>
                  <div className="zone-change-summary">
                    <div>
                      <small>Khách hàng</small>
                      <strong>{order.name}</strong>
                    </div>
                    <div>
                      <small>Khu hiện tại</small>
                      <strong>Khu {order.zoneId}</strong>
                    </div>
                    <div>
                      <small>Khu mới</small>
                      <strong>
                        {newZone ? `Khu ${newZone}` : 'Chưa chọn'}
                      </strong>
                    </div>
                  </div>

                  {order.checkedInAt ? (
                    <p className="zone-selection-note">
                      Vé đã check-in nên không thể đổi khu.
                    </p>
                  ) : (
                    <>
                      <p>Chạm vào khu mới trên bản đồ:</p>

                      <ZoneMap
                        zones={plan.zones}
                        selected={newZone}
                        onSelect={setNewZone}
                      />

                      <button
                        type="button"
                        className="zone-primary-button"
                        disabled={
                          busy || !newZone ||
                          newZone === order.zoneId ||
                          plan.zones.find(
                            z => z.id === newZone
                          )?.remaining < order.quantity
                        }
                        onClick={saveZoneChange}
                      >
                        {busy
                          ? 'Đang cập nhật...'
                          : 'Xác nhận đổi khu vực ↗'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
