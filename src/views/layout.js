'use strict';
const { html } = require('../util');

function nav(ctx) {
  const { t, user } = ctx;
  if (!user) {
    return html`
      <a href="/#how">${t('nav.how')}</a>
      <a href="/pact">${t('nav.pact')}</a>
      <a href="/leaderboard">${t('nav.impact')}</a>
      <a href="/login" class="btn btn-ghost">${t('nav.login')}</a>
      <a href="/signup" class="btn btn-primary">${t('nav.join')}</a>`;
  }
  const links = [[ '/dashboard', 'nav.dashboard' ]];
  if (user.role === 'student') links.push(['/discover', 'nav.find_mentor'], ['/requests', 'nav.requests'], ['/opportunities', 'nav.opportunities']);
  if (user.role === 'mentor') links.push(['/discover', 'nav.talent'], ['/requests', 'nav.requests'], ['/opportunities', 'nav.opportunities']);
  if (user.role === 'admin') links.push(['/admin', 'nav.admin'], ['/admin/match', 'nav.match_desk']);
  links.push(['/leaderboard', 'nav.impact']);
  const unread = ctx.unread || 0;
  return html`
    ${links.map(([href, k]) => html`<a href="${href}" ${(ctx.path === href || ctx.path.startsWith(`${href}/`)) ? html`aria-current="page"` : ''}>${t(k)}</a>`)}
    <a href="/notifications" class="bell" aria-label="${t('nav.notifications')}">🔔${unread ? html`<span class="dot">${unread}</span>` : ''}</a>
    <details class="menu">
      <summary>${avatar(user, 'sm')}</summary>
      <div class="menu-pop">
        <a href="/u/${user.id}">${t('nav.public_profile')}</a>
        <a href="/profile">${t('nav.edit_profile')}</a>
        <form method="post" action="/logout">${csrfField(ctx)}<button class="linklike">${t('nav.logout')}</button></form>
      </div>
    </details>`;
}

function layout(ctx, { title, body, wide = false, bare = false }) {
  const { t, lang } = ctx;
  const other = lang === 'ar' ? 'en' : 'ar';
  return html`<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · ` : ''}${t('brand')}</title>
<meta name="description" content="${t('meta.description')}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a href="/" class="logo"><span class="logo-mark" aria-hidden="true">م</span><span>${t('brand')}</span></a>
    <button class="nav-toggle" aria-label="${t('nav.menu')}" data-toggle="nav">☰</button>
    <nav id="nav" class="nav">
      ${nav(ctx)}
      <a href="/lang/${other}?next=${encodeURIComponent(ctx.url)}" class="lang" hreflang="${other}">${other === 'ar' ? 'العربية' : 'English'}</a>
    </nav>
  </div>
</header>
${ctx.flash ? html`<div class="flash flash-${ctx.flash.type}" role="status"><div class="wrap">${t(ctx.flash.key)}</div></div>` : ''}
<main class="${bare ? '' : wide ? 'wrap wide page' : 'wrap page'}">
${body}
</main>
<footer class="footer">
  <div class="wrap footer-inner">
    <div>
      <div class="logo"><span class="logo-mark" aria-hidden="true">م</span><span>${t('brand')}</span></div>
      <p class="muted small">${t('footer.tagline')}</p>
    </div>
    <div class="footer-links">
      <a href="/pact">${t('nav.pact')}</a>
      <a href="/leaderboard">${t('nav.impact')}</a>
      <a href="/signup?role=mentor">${t('footer.become_mentor')}</a>
      <a href="/signup?role=student">${t('footer.apply_student')}</a>
    </div>
  </div>
</footer>
</body>
</html>`;
}

const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

const PALETTE = ['#0b6e4f', '#1d4e89', '#7a3e9d', '#b5562b', '#2f6f73', '#8a5a00', '#5b5f97', '#a23b5a'];
function avatar(user, size = '') {
  const initials = String(user.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const color = PALETTE[user.id % PALETTE.length];
  return html`<span class="avatar ${size}" style="--av:${color}" aria-hidden="true">${initials}</span>`;
}

module.exports = { layout, csrfField, avatar };
