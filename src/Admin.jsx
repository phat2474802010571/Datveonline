
import React, {
  useEffect,
  useMemo,
  useState
} from 'react';

import { AdminSeats } from './upgrade.jsx';

// ========================================
// VEONLINE ADMIN
// ========================================

const money = value =>
  Number(value || 0).toLocaleString('vi-VN') + 'đ';

const emptyEvent = {
  title: '',
  category: 'Âm nhạc',
  date: '',
  venue: '',
  description: '',
  price: 100000,
  remaining: 100
};

function paymentStatus(order) {
  const status = order.payment?.status;

  if (status === 'paid') {
    return '✅ Đã thanh toán';
  }

  if (status === 'pending_review') {
    return '⏳ Chờ xác nhận';
  }

  return 'Chưa thanh toán';
}

function paymentMethod(order) {
  if (order.payment?.method === 'bank') {
    return 'Ngân hàng';
  }

  if (order.payment?.method === 'momo') {
    return 'MoMo';
  }

  return 'Chưa chọn';
}

function orderZone(order) {
  if (order.zoneId) {
    return `Khu ${order.zoneId}`;
  }

  if (order.seatIds?.length) {
    return order.seatIds.join(', ');
  }

  return 'Vé thường';
}

// ========================================
// ADMIN COMPONENT
// ========================================

export default function Admin({
  events = [],
  api,
  reloadEvents,
  notify
}) {
  const [tab, setTab] = useState('events');

  const [allEvents, setAllEvents] = useState([]);
  const [orders, setOrders] = useState([]);

  const [showArchived, setShowArchived] =
    useState(false);

  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    ...emptyEvent
  });

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [checkCode, setCheckCode] = useState('');

  const [selectedOrder, setSelectedOrder] =
    useState(null);

  // ======================================
  // LẤY DỮ LIỆU MỚI
  // ======================================

  async function refresh() {
    setRefreshing(true);

    try {
      const [eventData, orderData] =
        await Promise.all([
          api('/admin/events'),
          api('/admin/bookings')
        ]);

      setAllEvents(
        Array.isArray(eventData) ? eventData : []
      );

      setOrders(
        Array.isArray(orderData) ? orderData : []
      );

      await reloadEvents();
    } catch (error) {
      notify(error.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // ======================================
  // THỐNG KÊ
  // ======================================

  const stats = useMemo(() => {
    const activeCount = allEvents.filter(
      event => !event.archived
    ).length;

    const archivedCount = allEvents.filter(
      event => Boolean(event.archived)
    ).length;

    const totalTickets = orders.reduce(
      (sum, order) =>
        sum + Number(order.quantity || 0),
      0
    );

    // Doanh thu thực nhận được xác nhận.
    const revenue = orders.reduce(
      (sum, order) =>
        sum + (
          order.payment?.status === 'paid'
            ? Number(order.total || 0)
            : 0
        ),
      0
    );

    const pending = orders.filter(
      order =>
        order.payment?.status ===
        'pending_review'
    ).length;

    const checkedIn = orders.filter(
      order => Boolean(order.checkedInAt)
    ).length;

    return {
      activeCount,
      archivedCount,
      totalTickets,
      revenue,
      pending,
      checkedIn
    };
  }, [orders, allEvents]);

  // ======================================
  // LỌC CONCERT
  // ======================================

  const filteredEvents = useMemo(() => {
    const keyword = search.toLowerCase().trim();

    return allEvents.filter(event => {
      if (!showArchived && event.archived) {
        return false;
      }

      if (!keyword) return true;

      return [
        event.title,
        event.category,
        event.date,
        event.venue
      ].some(value =>
        String(value || '')
          .toLowerCase()
          .includes(keyword)
      );
    });
  }, [allEvents, showArchived, search]);

  // ======================================
  // LỌC ĐƠN HÀNG
  // ======================================

  const filteredOrders = useMemo(() => {
    const keyword = search.toLowerCase().trim();

    if (!keyword) return orders;

    return orders.filter(order =>
      [
        order.name,
        order.email,
        order.eventTitle,
        order.code,
        order.zoneId,
        order.payment?.method
      ].some(value =>
        String(value || '')
          .toLowerCase()
          .includes(keyword)
      )
    );
  }, [orders, search]);

  // ======================================
  // FORM TẠO CONCERT
  // ======================================

  function openCreate() {
    setForm({
      ...emptyEvent
    });

    setEditing('new');
  }

  // ======================================
  // FORM SỬA CONCERT
  // ======================================

  function openEdit(event) {
    setForm({
      title: event.title,
      category: event.category,
      date: event.date,
      venue: event.venue,
      description: event.description,
      price: event.price,
      remaining: event.remaining
    });

    setEditing(event);
  }

  function updateField(name, value) {
    setForm(previous => ({
      ...previous,
      [name]: value
    }));
  }

  async function saveEvent(e) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);

    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        date: form.date.trim(),
        venue: form.venue.trim(),
        description: form.description.trim(),
        price: Number(form.price),
        remaining: Number(form.remaining)
      };

      const creating = editing === 'new';

      const path = creating
        ? '/admin/events'
        : '/admin/events/' +
          encodeURIComponent(editing._id);

      await api(path, {
        method: creating ? 'POST' : 'PUT',
        body: JSON.stringify(payload)
      });

      setEditing(null);

      await refresh();

      notify(
        creating
          ? 'Đã tạo concert mới! 🎄'
          : 'Đã lưu thay đổi concert!'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // ẨN CONCERT
  // GIỮ TẤT CẢ ĐƠN VÉ VÀ QR
  // ======================================

  async function hideConcert(event) {
    const confirmed = window.confirm(
      `Bạn muốn ẨN concert "${event.title}"?\n\n` +
      'Concert sẽ không còn hiển thị cho khách mua vé.\n\n' +
      'Tất cả đơn đã mua, mã QR và lịch sử check-in vẫn được giữ.\n\n' +
      'Bạn có thể hiện lại concert bất cứ lúc nào.'
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const result = await api(
        '/admin/events/' +
          encodeURIComponent(event._id) +
          '/hide',
        {
          method: 'POST'
        }
      );

      await refresh();

      notify(
        result.message ||
        'Đã ẩn concert.'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // HIỆN LẠI CONCERT
  // ======================================

  async function restoreConcert(event) {
    const confirmed = window.confirm(
      `Hiển thị lại concert "${event.title}" cho khách hàng?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const result = await api(
        '/admin/events/' +
          encodeURIComponent(event._id) +
          '/restore',
        {
          method: 'POST'
        }
      );

      await refresh();

      notify(
        result.message ||
        'Đã hiện lại concert.'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // XÓA VĨNH VIỄN CONCERT
  // ======================================

  async function deleteConcert(event) {
    const warning =
      `⚠ XÓA VĨNH VIỄN "${event.title}"?\n\n` +
      'Thao tác này sẽ XÓA:\n' +
      '• Concert khỏi MongoDB.\n' +
      '• Tất cả đơn vé của concert.\n' +
      '• Mã QR và dữ liệu check-in của các đơn.\n' +
      '• Lịch sử thanh toán nằm trong concert.\n\n' +
      'Không thể hoàn tác!';

    const confirmed = window.confirm(warning);

    if (!confirmed) return;

    const typed = window.prompt(
      'Nhập XOA để xác nhận xóa vĩnh viễn:'
    );

    if (typed !== 'XOA') {
      notify(
        'Đã hủy thao tác xóa concert.'
      );

      return;
    }

    setLoading(true);

    try {
      const result = await api(
        '/admin/events/' +
          encodeURIComponent(event._id),
        {
          method: 'DELETE',
          body: JSON.stringify({
            confirmation: 'XOA'
          })
        }
      );

      await refresh();

      notify(
        result.message ||
        'Đã xóa vĩnh viễn concert.'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // ADMIN XÁC NHẬN THANH TOÁN
  // ======================================

  async function confirmPayment(order) {
    const confirmed = window.confirm(
      'Bạn đã kiểm tra tài khoản ngân hàng/MoMo ' +
      'và chắc chắn nhận đủ ' +
      money(order.total) +
      ` cho đơn ${order.code} chưa?\n\n` +
      'Chỉ chọn OK khi tiền đã thực sự về tài khoản.'
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const result = await api(
        '/admin/payments/' +
          encodeURIComponent(order.code) +
          '/confirm',
        {
          method: 'POST'
        }
      );

      await refresh();

      notify(
        result.message ||
        'Đã xác nhận thanh toán.'
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // ADMIN CHECK-IN
  // ======================================

  async function checkIn(e) {
    e.preventDefault();

    if (!checkCode.trim() || loading) {
      return;
    }

    setLoading(true);

    try {
      const order = await api(
        '/admin/check-in',
        {
          method: 'POST',
          body: JSON.stringify({
            code: checkCode.trim()
          })
        }
      );

      setCheckCode('');

      await refresh();

      notify(
        `Check-in thành công cho ${order.name}! ✅`
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setLoading(false);
    }
  }

  // ======================================
  // TABS
  // ======================================

  const tabs = [
    ['events', 'Quản lý sự kiện'],
    ['orders', 'Đơn & thanh toán'],
    ['seats', 'Sơ đồ 5 khu'],
    ['checkin', 'Check-in']
  ];

  // ======================================
  // GIAO DIỆN
  // ======================================

  return (
    <section className="content-section inner-page">

      {/* HEADER */}

      <div className="section-heading">
        <div>
          <span className="section-kicker">
            ✦ VEONLINE MANAGEMENT CENTER
          </span>

          <h2>
            Trung tâm <em>quản lý</em>
          </h2>

          <p>
            Quản lý concert, vé, thanh toán,
            sơ đồ A–E và check-in.
          </p>
        </div>

        <button
          type="button"
          className="primary-btn"
          onClick={openCreate}
        >
          + Tạo concert
        </button>
      </div>

      {/* THỐNG KÊ */}

      <div className="stats-grid">

        <div className="stat">
          <span>✦ Concert đang mở</span>

          <strong>
            {stats.activeCount}
          </strong>

          <small>
            Sự kiện đang hiển thị
          </small>
        </div>

        <div className="stat">
          <span>🎟 Vé đã đặt</span>

          <strong>
            {stats.totalTickets}
          </strong>

          <small>
            Số vé trong các đơn hiện có
          </small>
        </div>

        <div className="stat">
          <span>💰 Doanh thu đã xác nhận</span>

          <strong>
            {money(stats.revenue)}
          </strong>

          <small>
            Chỉ tính đơn đã xác nhận nhận tiền
          </small>
        </div>

        <div className="stat">
          <span>⏳ Chờ đối chiếu</span>

          <strong>
            {stats.pending}
          </strong>

          <small>
            Đơn chờ kiểm tra thanh toán
          </small>
        </div>

        <div className="stat">
          <span>✅ Đơn đã check-in</span>

          <strong>
            {stats.checkedIn}
          </strong>

          <small>
            Đơn đã được check-in
          </small>
        </div>

      </div>

      {/* THANH TABS */}

      <div
        className="filter-tabs"
        style={{
          margin: '25px 0',
          flexWrap: 'wrap'
        }}
      >
        {tabs.map(([key, title]) => (
          <button
            key={key}
            type="button"
            className={
              tab === key
                ? 'selected'
                : ''
            }
            onClick={() => {
              setTab(key);
              setSearch('');
              refresh();
            }}
          >
            {title}
          </button>
        ))}
      </div>

      {/* ================================
          QUẢN LÝ CONCERT
          ================================ */}

      {tab === 'events' && (
        <div className="admin-panel">

          <div className="panel-heading">
            <div>
              <h3>
                Danh sách concert
              </h3>

              <p>
                Thêm, sửa, ẩn, hiện lại
                hoặc xóa vĩnh viễn.
              </p>
            </div>

            <button
              type="button"
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing
                ? 'Đang tải...'
                : '↻ Làm mới'}
            </button>
          </div>

          {/* BỘ LỌC */}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 15,
              alignItems: 'center',
              margin: '20px 0'
            }}
          >
            <input
              className="search"
              value={search}
              placeholder="Tìm concert..."
              onChange={e =>
                setSearch(e.target.value)
              }
              style={{
                flex: 1,
                minWidth: 200,
                maxWidth: 420
              }}
            />

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e =>
                  setShowArchived(e.target.checked)
                }
              />

              Hiện cả concert đã ẩn
            </label>
          </div>

          {/* BẢNG CONCERT */}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Concert</th>
                  <th>Danh mục</th>
                  <th>Giá vé</th>
                  <th>Vé còn</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>

              <tbody>
                {filteredEvents.map(event => (
                  <tr key={event._id}>

                    <td>
                      <strong>
                        {event.title}
                      </strong>

                      <small>
                        {event.date}
                      </small>

                      <small>
                        {event.venue}
                      </small>
                    </td>

                    <td>
                      {event.category}
                    </td>

                    <td>
                      {money(event.price)}
                    </td>

                    <td>
                      <strong>
                        {event.remaining}
                      </strong>
                    </td>

                    <td>
                      <span
                        style={{
                          color: event.archived
                            ? '#a45e26'
                            : '#226746',
                          fontWeight: 700
                        }}
                      >
                        {event.archived
                          ? '● Đang ẩn'
                          : '● Đang mở'}
                      </span>
                    </td>

                    {/* NÚT RIÊNG BIỆT */}

                    <td>
                      <div
                        className="table-actions"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 7
                        }}
                      >

                        <button
                          type="button"
                          disabled={loading}
                          onClick={() =>
                            openEdit(event)
                          }
                        >
                          Sửa
                        </button>

                        <button
                          type="button"
                          disabled={loading || event.archived}
                          onClick={() =>
                            setTab('seats')
                          }
                        >
                          Sơ đồ
                        </button>

                        {event.archived ? (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              restoreConcert(event)
                            }
                            style={{
                              background: '#e1f2e5',
                              color: '#19633c',
                              border: 'none',
                              borderRadius: 7,
                              padding: '9px 13px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Hiện lại
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              hideConcert(event)
                            }
                            style={{
                              background: '#edece5',
                              color: '#6c603f',
                              border: 'none',
                              borderRadius: 7,
                              padding: '9px 13px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Ẩn
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={loading}
                          onClick={() =>
                            deleteConcert(event)
                          }
                          style={{
                            background: '#fbe4e6',
                            color: '#af2936',
                            border: 'none',
                            borderRadius: 7,
                            padding: '9px 13px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Xóa
                        </button>

                      </div>
                    </td>

                  </tr>
                ))}

                {filteredEvents.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: 30,
                        textAlign: 'center'
                      }}
                    >
                      Không có concert phù hợp.
                    </td>
                  </tr>
                )}

              </tbody>
            </table>
          </div>

          {/* GIẢI THÍCH */}

          <div
            style={{
              marginTop: 20,
              padding: 16,
              borderRadius: 10,
              background: '#f3f5ef',
              fontSize: 13,
              lineHeight: 1.8,
              color: '#526b59'
            }}
          >
            <strong>
              Hướng dẫn quản lý:
            </strong>

            <p>
              <strong>Ẩn:</strong> Tạm ngừng bán vé.
              Giữ nguyên QR, đơn hàng và dữ liệu.
            </p>

            <p>
              <strong>Hiện lại:</strong> Cho phép
              khách tiếp tục xem và đặt vé.
            </p>

            <p>
              <strong>Xóa:</strong> Xóa vĩnh viễn
              concert cùng các đơn vé được lưu trong
              concert đó. Không thể khôi phục bằng nút
              Hiện lại.
            </p>
          </div>
        </div>
      )}

      {/* ================================
          ĐƠN VÉ VÀ THANH TOÁN
          ================================ */}

      {tab === 'orders' && (
        <div className="admin-panel">

          <div className="panel-heading">
            <div>
              <h3>
                Đơn vé & thanh toán
              </h3>

              <p>
                Kiểm tra đơn, đối chiếu giao dịch
                và xác nhận tiền thực nhận.
              </p>
            </div>

            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
            >
              ↻ Làm mới
            </button>
          </div>

          <input
            className="search"
            value={search}
            placeholder="Tìm khách hàng, email, mã vé..."
            onChange={e =>
              setSearch(e.target.value)
            }
            style={{
              width: '100%',
              maxWidth: 450,
              margin: '18px 0'
            }}
          />

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Concert</th>
                  <th>Khu</th>
                  <th>SL</th>
                  <th>Tổng tiền</th>
                  <th>Thanh toán</th>
                  <th>Check-in</th>
                  <th>Thao tác</th>
                </tr>
              </thead>

              <tbody>

                {filteredOrders.map(order => (
                  <tr key={order.code}>

                    <td>
                      <strong>
                        {order.name}
                      </strong>

                      <small>
                        {order.email}
                      </small>

                      <small>
                        {order.code?.slice(0, 8)}...
                      </small>
                    </td>

                    <td>
                      <strong>
                        {order.eventTitle}
                      </strong>

                      <small>
                        {order.date}
                      </small>
                    </td>

                    <td>
                      {orderZone(order)}
                    </td>

                    <td>
                      {order.quantity}
                    </td>

                    <td>
                      {money(order.total)}
                    </td>

                    <td>
                      <strong>
                        {paymentStatus(order)}
                      </strong>

                      <small>
                        {paymentMethod(order)}
                      </small>
                    </td>

                    <td>
                      {order.checkedInAt
                        ? '✅ Đã check-in'
                        : 'Chưa check-in'}
                    </td>

                    <td>
                      <div
                        className="table-actions"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 7
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedOrder(order)
                          }
                        >
                          Xem đơn
                        </button>

                        {order.payment?.status ===
                          'pending_review' && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              confirmPayment(order)
                            }
                            style={{
                              background: '#dcefe1',
                              color: '#175b35',
                              fontWeight: 700
                            }}
                          >
                            Xác nhận tiền
                          </button>
                        )}
                      </div>
                    </td>

                  </tr>
                ))}

                {filteredOrders.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 30,
                        textAlign: 'center'
                      }}
                    >
                      Chưa có đơn đặt vé phù hợp.
                    </td>
                  </tr>
                )}

              </tbody>
            </table>
          </div>

          <p
            style={{
              fontSize: 13,
              color: '#738579',
              marginTop: 15
            }}
          >
            Chỉ xác nhận thanh toán sau khi tiền
            đã thực sự vào tài khoản ngân hàng hoặc
            ví MoMo của người nhận.
          </p>
        </div>
      )}

      {/* ================================
          SƠ ĐỒ 5 KHU A-E
          ================================ */}

      {tab === 'seats' && (
        <AdminSeats
          events={events}
          notify={notify}
        />
      )}

      {/* ================================
          CHECK-IN
          ================================ */}

      {tab === 'checkin' && (
        <div className="admin-panel">

          <div className="panel-heading">
            <div>
              <h3>
                Check-in vé QR
              </h3>

              <p>
                Xác minh mã đặt vé của khách hàng.
              </p>
            </div>

            <button
              type="button"
              onClick={refresh}
            >
              ↻ Làm mới
            </button>
          </div>

          <form
            onSubmit={checkIn}
            className="checkin-form"
          >
            <input
              required
              value={checkCode}
              placeholder="Nhập mã vé hoặc dán link QR..."
              onChange={e =>
                setCheckCode(e.target.value)
              }
            />

            <button
              className="primary-btn"
              type="submit"
              disabled={loading}
            >
              {loading
                ? 'Đang xác nhận...'
                : 'Xác nhận check-in'}
            </button>
          </form>
        </div>
      )}

      {/* ================================
          MODAL TẠO / SỬA CONCERT
          ================================ */}

      {editing && (
        <div
          className="overlay"
          onClick={() =>
            setEditing(null)
          }
        >
          <div
            className="modal event-modal"
            onClick={e =>
              e.stopPropagation()
            }
          >

            <button
              type="button"
              className="close-modal"
              onClick={() =>
                setEditing(null)
              }
            >
              ×
            </button>

            <span className="section-kicker">
              VEONLINE EVENT EDITOR
            </span>

            <h2>
              {editing === 'new'
                ? 'Tạo concert mới'
                : 'Chỉnh sửa concert'}
            </h2>

            <form
              className="event-form"
              onSubmit={saveEvent}
            >

              <label>
                Tên concert / sự kiện
              </label>

              <input
                required
                maxLength={100}
                value={form.title}
                placeholder="Christmas Music Night"
                onChange={e =>
                  updateField(
                    'title',
                    e.target.value
                  )
                }
              />

              <label>
                Danh mục
              </label>

              <select
                value={form.category}
                onChange={e =>
                  updateField(
                    'category',
                    e.target.value
                  )
                }
              >
                <option value="Âm nhạc">
                  Âm nhạc
                </option>

                <option value="Workshop">
                  Workshop
                </option>

                <option value="Triển lãm">
                  Triển lãm
                </option>
              </select>

              <label>
                Ngày / giờ diễn ra
              </label>

              <input
                required
                value={form.date}
                placeholder="24/12/2026 - 19:00"
                onChange={e =>
                  updateField(
                    'date',
                    e.target.value
                  )
                }
              />

              <label>
                Địa điểm
              </label>

              <input
                required
                maxLength={120}
                value={form.venue}
                placeholder="TP. Hồ Chí Minh"
                onChange={e =>
                  updateField(
                    'venue',
                    e.target.value
                  )
                }
              />

              <label>
                Mô tả concert
              </label>

              <textarea
                required
                rows={4}
                maxLength={1000}
                value={form.description}
                onChange={e =>
                  updateField(
                    'description',
                    e.target.value
                  )
                }
              />

              <div className="form-columns">

                <div>
                  <label>
                    Giá vé (VNĐ)
                  </label>

                  <input
                    required
                    type="number"
                    min={0}
                    max={100000000}
                    value={form.price}
                    onChange={e =>
                      updateField(
                        'price',
                        e.target.value
                      )
                    }
                  />
                </div>

                <div>
                  <label>
                    Số vé còn lại
                  </label>

                  <input
                    required
                    type="number"
                    min={0}
                    max={100000}
                    value={form.remaining}
                    onChange={e =>
                      updateField(
                        'remaining',
                        e.target.value
                      )
                    }
                  />
                </div>

              </div>

              <p
                style={{
                  fontSize: 12,
                  color: '#75867b',
                  lineHeight: 1.7
                }}
              >
                Nếu concert đã có sơ đồ A–E,
                số vé còn lại được quản lý
                tự động khi khách mua vé.
              </p>

              <button
                type="submit"
                className="primary-btn full"
                disabled={loading}
              >
                {loading
                  ? 'Đang lưu...'
                  : editing === 'new'
                    ? 'Tạo concert ↗'
                    : 'Lưu thay đổi ↗'}
              </button>

            </form>
          </div>
        </div>
      )}

      {/* ================================
          MODAL CHI TIẾT ĐƠN VÉ
          ================================ */}

      {selectedOrder && (
        <div
          className="overlay"
          onClick={() =>
            setSelectedOrder(null)
          }
        >
          <div
            className="modal"
            onClick={e =>
              e.stopPropagation()
            }
          >
            <button
              type="button"
              className="close-modal"
              onClick={() =>
                setSelectedOrder(null)
              }
            >
              ×
            </button>

            <span className="section-kicker">
              BOOKING DETAILS
            </span>

            <h2>
              Chi tiết đơn vé
            </h2>

            <div
              style={{
                display: 'grid',
                gap: 13,
                marginTop: 22,
                overflowWrap: 'anywhere'
              }}
            >

              <p>
                <strong>Khách:</strong>{' '}
                {selectedOrder.name}
              </p>

              <p>
                <strong>Email:</strong>{' '}
                {selectedOrder.email}
              </p>

              <p>
                <strong>Concert:</strong>{' '}
                {selectedOrder.eventTitle}
              </p>

              <p>
                <strong>Khu vực:</strong>{' '}
                {orderZone(selectedOrder)}
              </p>

              <p>
                <strong>Số vé:</strong>{' '}
                {selectedOrder.quantity}
              </p>

              <p>
                <strong>Tổng tiền:</strong>{' '}
                {money(selectedOrder.total)}
              </p>

              <p>
                <strong>Thanh toán:</strong>{' '}
                {paymentStatus(selectedOrder)}
              </p>

              <p>
                <strong>Phương thức:</strong>{' '}
                {paymentMethod(selectedOrder)}
              </p>

              <p>
                <strong>Check-in:</strong>{' '}
                {selectedOrder.checkedInAt
                  ? 'Đã check-in'
                  : 'Chưa check-in'}
              </p>

              <p>
                <strong>Mã vé:</strong>
              </p>

              <code>
                {selectedOrder.code}
              </code>

            </div>

            <button
              type="button"
              className="primary-btn full"
              style={{
                marginTop: 25
              }}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(
                    selectedOrder.code
                  )
                  .then(() =>
                    notify('Đã sao chép mã vé.')
                  )
                  .catch(() =>
                    notify('Không sao chép được mã vé.')
                  );
              }}
            >
              Sao chép mã vé
            </button>

          </div>
        </div>
      )}

    </section>
  );
}
