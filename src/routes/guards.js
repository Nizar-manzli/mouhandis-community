'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('../http');

const requireUser = (req, res, ctx) => {
  if (!ctx.user) return res.redirect(`/login?next=${encodeURIComponent(ctx.url)}`);
};

const requireRole = (...roles) => (req, res, ctx) => {
  if (!ctx.user) return res.redirect(`/login?next=${encodeURIComponent(ctx.url)}`);
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'error.forbidden');
};

// Mentors and students must finish onboarding and be approved before matching.
const requireApproved = (req, res, ctx) => {
  if (!ctx.user) return res.redirect(`/login?next=${encodeURIComponent(ctx.url)}`);
  if (ctx.user.role === 'admin') return;
  if (ctx.user.status === 'incomplete') return res.redirect('/onboarding');
  if (ctx.user.status !== 'approved') { ctx.setFlash('info', 'flash.pending_review'); return res.redirect('/dashboard'); }
};

const int = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new HttpError(400, 'error.bad_request');
  return n;
};

const str = (v, max = 2000) => String(Array.isArray(v) ? v[0] : v ?? '').trim().slice(0, max);

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : '/dashboard');

const SECRET = process.env.APP_SECRET || 'dev-only-secret-change-me';
const certCode = (kind, userId, msId) =>
  crypto.createHmac('sha256', SECRET).update(`${kind}:${userId}:${msId}`).digest('hex').slice(0, 16);

module.exports = { requireUser, requireRole, requireApproved, int, str, safeNext, certCode };
