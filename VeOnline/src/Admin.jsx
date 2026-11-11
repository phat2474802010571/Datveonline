import React, { useEffect } from 'react';

export default function Admin() {
  useEffect(() => {
    window.location.assign('/admin/login');
  }, []);

  return (
    <section className="lookup">
      <h1>Quản trị vé</h1>
      <a href="/admin/login">Mở trang đăng nhập admin</a>
    </section>
  );
}