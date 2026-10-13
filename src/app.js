'use strict';
const http = require('node:http');
const path = require('node:path');
const { Router, parseCookies, parseForm, readBody, serveStatic, enhance, HttpError } = require('./http');
const { loadSession, safeEqual, token } = require('./auth');
const { translator, LANGS } = require('./i18n');
const { layout } = require('./views/layout');
const { html, iso } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(db) {
  const router = new Router();
  for (const mod of ['public', 'onboarding', 'dashboard', 'matching', 'mentorship', 'opportunities', 'admin']) {
    require(`./routes/${mod}`)(router, db);
  }

  async function handle(req, res) {
    enhance(res);
    const url = new URL(req.url, 'http://local');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname !== '/' && serveStatic(PUBLIC_DIR, pathname, res)) return;

    const cookies = parseCookies(req.headers.cookie);
    const lang = LANGS.includes(cookies.lang) ? cookies.lang : 'en';
    let csrf = cookies.csrf;
    if (!csrf || csrf.length < 20) { csrf = token(); res.cookie('csrf', csrf, { maxAge: 60 * 60 * 24 * 365 }); }

    const session = loadSession(db, cookies.sid);
    const user = session ? session.user : null;
    if (user && (!user.last_active_at || Date.now() - new Date(user.last_active_at) > 300000)) {
      db.run('UPDATE users SET last_active_at = ? WHERE id = ?', iso(), user.id);
    }

    let flash = null;
    if (cookies.flash) {
      const [type, key] = cookies.flash.split('|');
      if (key) flash = { type, key };
      res.cookie('flash', '', { maxAge: 0 });
    }

    const ctx = {
      db, user, lang, t: translator(lang), csrf, flash, cookies,
      path: pathname, url: pathname + url.search, query: Object.fromEntries(url.searchParams), body: {}, params: {},
      unread: user ? db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id).n : 0,
      session,
      setFlash: (type, key) => res.cookie('flash', `${type}|${key}`, { maxAge: 60 }),
      page: (opts) => res.html(layout(ctx, opts)),
    };

    try {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'error.not_found');
      ctx.params = m.params;
      if (req.method === 'POST') {
        const type = String(req.headers['content-type'] || '');
        if (!type.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'error.bad_request');
        ctx.body = parseForm(await readBody(req));
        if (!safeEqual(ctx.body._csrf, csrf)) throw new HttpError(403, 'error.csrf');
      }
      for (const h of m.handlers) {
        const out = await h(req, res, ctx);
        if (res.writableEnded || res.headersSent) return;
        if (out !== undefined) return res.html(out);
      }
      if (!res.writableEnded) throw new HttpError(500, 'error.generic');
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      const t = ctx.t;
      const key = err.status ? err.message : 'error.generic';
      res.html(layout(ctx, {
        title: t('error.title'),
        body: html`<section class="empty error-page"><h1>${status}</h1><p>${t(key)}</p><a class="btn" href="/">${t('error.home')}</a></section>`,
      }), status);
    }
  }

  return { handle, server: () => http.createServer((req, res) => { handle(req, res); }) };
}

module.exports = { createApp };
