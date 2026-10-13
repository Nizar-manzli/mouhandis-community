'use strict';
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

// Boots the app on an ephemeral port with an in-memory database.
async function boot(seedFn) {
  const db = openDb(':memory:');
  if (seedFn) db.tx(() => seedFn(db));
  const server = createApp(db).server();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => new Promise((r) => server.close(r)) };
}

// Minimal cookie-aware client. Forms automatically get the CSRF token.
function client(base) {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v;
    }
  };
  async function get(path) {
    const res = await fetch(base + path, { headers: { cookie: cookieHeader() }, redirect: 'manual' });
    store(res);
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  async function post(path, data = {}) {
    if (!jar.csrf) await get('/login');
    const body = new URLSearchParams();
    body.append('_csrf', decodeURIComponent(jar.csrf));
    for (const [k, v] of Object.entries(data)) for (const x of [].concat(v)) body.append(k, x);
    const res = await fetch(base + path, {
      method: 'POST', body, redirect: 'manual',
      headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
    });
    store(res);
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  return { get, post, jar };
}

module.exports = { boot, client };
