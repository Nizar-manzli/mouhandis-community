'use strict';
const crypto = require('node:crypto');
const { iso, addDays } = require('./util');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const token = () => crypto.randomBytes(24).toString('base64url');

function createSession(db, userId) {
  const t = token();
  db.run('INSERT INTO auth_sessions (token, user_id, csrf, expires_at) VALUES (?,?,?,?)',
    t, userId, token(), iso(addDays(new Date(), SESSION_DAYS)));
  return t;
}

function loadSession(db, t) {
  if (!t) return null;
  const s = db.get('SELECT * FROM auth_sessions WHERE token = ?', t);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) {
    db.run('DELETE FROM auth_sessions WHERE token = ?', t);
    return null;
  }
  const user = db.get('SELECT * FROM users WHERE id = ?', s.user_id);
  return user ? { user, csrf: s.csrf, token: t } : null;
}

const destroySession = (db, t) => db.run('DELETE FROM auth_sessions WHERE token = ?', t);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { hashPassword, verifyPassword, createSession, loadSession, destroySession, safeEqual, SESSION_DAYS, token };
