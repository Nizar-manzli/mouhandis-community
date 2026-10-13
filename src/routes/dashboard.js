'use strict';
const { html, iso, round } = require('../util');
const { avatar } = require('../views/layout');
const { healthBadge, healthRing, scorecard, levelCard, statTile, fmtDate, empty, fmt } = require('../views/components');
const { mentorScorecard, studentScorecard } = require('../services/kpi');
const { nudges } = require('../services/nudges');
const { scoreMatch, availableMentors } = require('../services/matching');
const C = require('../config');
const { requireUser, certCode } = require('./guards');

const ICON = { critical: '✕', serious: '▲', warning: '◐', info: '○' };

function nudgeList(t, msId, list) {
  if (!list.length) return html`<p class="ok-line"><span aria-hidden="true">✓</span> ${t('nudge.all_good')}</p>`;
  return html`<ul class="nudges">${list.map((n) => html`<li class="nudge status-${n.level === 'info' ? 'new' : n.level}">
    <span aria-hidden="true">${ICON[n.level]}</span><a href="/m/${msId}?tab=${n.tab}">${t(n.key, n.params)}</a></li>`)}</ul>`;
}

function nextSession(ctx, data) {
  const s = data.sessions.find((x) => x.status === 'scheduled' && new Date(x.scheduled_at) >= new Date());
  return s ? html`<p><strong>${t(ctx, 'dash.next_session')}</strong> ${fmtDate(ctx, s.scheduled_at, true)} — ${s.topic}</p>` : '';
}
const t = (ctx, k, p) => ctx.t(k, p);

function pendingStatus(ctx) {
  const { user, db } = ctx;
  const p = user.role === 'student' ? db.get('SELECT potential_score FROM student_profiles WHERE user_id = ?', user.id) : null;
  return html`<section class="card callout">
    <h2>${ctx.t('dash.pending_title')}</h2>
    <p>${ctx.t(`dash.pending_${user.role}`)}</p>
    ${p ? html`<p>${ctx.t('dash.potential', { n: p.potential_score, min: C.GATES.autoApproveStudentPotential })}</p>
      <p class="small muted">${ctx.t('dash.potential_tips')}</p>` : ''}
    <a class="btn" href="/profile">${ctx.t('nav.edit_profile')}</a>
  </section>`;
}

function studentDashboard(ctx) {
  const { db, user } = ctx;
  const T = ctx.t;
  if (user.status !== 'approved') return [pendingStatus(ctx)];
  const parts = [];
  const active = db.get("SELECT * FROM mentorships WHERE student_id = ? AND status = 'active'", user.id);
  if (active) {
    const sc = studentScorecard(db, active.id);
    const k = sc.kpis;
    const mentor = db.get('SELECT u.*, mp.job_title, mp.company FROM users u JOIN mentor_profiles mp ON mp.user_id = u.id WHERE u.id = ?', active.mentor_id);
    parts.push(html`<section class="card pair-hero">
      ${healthRing(T, k.health)}
      <div class="pair-info">
        <p class="eyebrow">${T('dash.your_mentor')}</p>
        <h2>${avatar(mentor, 'sm')} <a href="/u/${mentor.id}">${mentor.name}</a></h2>
        <p class="muted">${mentor.job_title} @ ${mentor.company} · ${mentor.country}</p>
        <p class="small">${T('dash.month_of', { n: Math.min(12, Math.floor(k.ageDays / 30) + 1) })} · ${T(`mode.${active.mode}`)}</p>
        ${nextSession(ctx, sc.data)}
        <a class="btn btn-primary" href="/m/${active.id}">${T('dash.open_workspace')}</a>
      </div>
      <div class="pair-nudges"><h3>${T('dash.next_actions')}</h3>${nudgeList(T, active.id, nudges(sc.data, k, 'student'))}</div>
    </section>
    <section><h2>${T('dash.your_kpis')}</h2><p class="muted small">${T('dash.window', { n: k.windowDays })}</p>${scorecard(T, 'student', sc.items)}</section>`);
  } else {
    const pending = db.all("SELECT r.*, u.name FROM match_requests r JOIN users u ON u.id = r.mentor_id WHERE r.student_id = ? AND r.status = 'pending'", user.id);
    const me = { ...db.get('SELECT * FROM student_profiles WHERE user_id = ?', user.id), languages: user.languages, tz_offset: user.tz_offset };
    const mentors = availableMentors(db).map((m) => ({ ...m, match: scoreMatch(me, m) })).sort((a, b) => b.match.score - a.match.score).slice(0, 3);
    parts.push(html`<section class="card callout">
      <h2>${T('dash.find_title')}</h2><p>${T('dash.find_body')}</p>
      ${pending.length ? html`<p>${T('dash.pending_requests', { n: pending.length })}: ${pending.map((p) => p.name).join(', ')}</p>` : ''}
      <div class="mini-matches">${mentors.map((m) => html`<a class="mini" href="/discover#u${m.id}">${avatar(m, 'sm')}<span><strong>${m.name}</strong><br><span class="small muted">${m.job_title} · ${m.country}</span></span><span class="score">${m.match.score}%</span></a>`)}</div>
      <a class="btn btn-primary" href="/discover">${T('nav.find_mentor')}</a>
    </section>`);
  }
  const done = db.all("SELECT m.*, u.name FROM mentorships m JOIN users u ON u.id = m.mentor_id WHERE m.student_id = ? AND m.status = 'completed'", user.id);
  if (done.length) {
    parts.push(html`<section class="card"><h2>${T('dash.certificates')}</h2><ul>${done.map((m) => html`<li><a href="/certificate/student/${m.id}/${certCode('student', user.id, m.id)}">${T('dash.cert_with', { name: m.name })}</a></li>`)}</ul></section>`);
  }
  return parts;
}

function mentorDashboard(ctx) {
  const { db, user } = ctx;
  const T = ctx.t;
  if (user.status !== 'approved') return [pendingStatus(ctx)];
  const sc = mentorScorecard(db, user.id);
  const prof = db.get('SELECT * FROM mentor_profiles WHERE user_id = ?', user.id);
  const active = sc.pairs.filter((p) => p.data.ms.status === 'active');
  const incoming = db.get("SELECT COUNT(*) n FROM match_requests WHERE mentor_id = ? AND status = 'pending' AND initiated_by <> 'mentor'", user.id).n;
  const hours = db.get(`SELECT COALESCE(SUM(s.duration_min),0) n FROM sessions s JOIN mentorships m ON m.id = s.mentorship_id WHERE m.mentor_id = ? AND s.status='completed'`, user.id).n / 60;
  const parts = [];
  parts.push(html`<div class="stats compact">
    ${statTile(T('dash.mentees'), `${active.length}/${prof.capacity}`, active.length < prof.capacity ? T('dash.has_capacity') : T('dash.full'))}
    ${statTile(T('dash.cpd_hours'), round(hours, 1))}
    ${statTile(T('dash.incoming'), incoming)}
    ${statTile(T('dash.outcomes'), sc.pairs.reduce((a, p) => a + p.k.outcomesVerified, 0))}
  </div>`);
  if (incoming) parts.push(html`<p class="callout-line"><a class="btn btn-primary" href="/requests">${T('dash.review_requests', { n: incoming })}</a></p>`);

  if (active.length) {
    parts.push(html`<section><h2>${T('dash.your_mentees')}</h2><div class="pairs">
      ${active.map((p) => {
        const s = db.get('SELECT * FROM users WHERE id = ?', p.data.ms.student_id);
        return html`<article class="card pair-card">
          <header>${avatar(s, 'sm')}<div><h3><a href="/m/${p.id}">${s.name}</a></h3><p class="small muted">${T('dash.month_of', { n: Math.min(12, Math.floor(p.k.ageDays / 30) + 1) })} · ${T(`mode.${p.data.ms.mode}`)}</p></div>${healthBadge(T, p.k.health)}</header>
          <dl class="mini-kpis">
            <div><dt>${T('kpi.short.sessions')}</dt><dd>${fmt(T, p.k.sessionsPerMonth, 'perMonth')}</dd></div>
            <div><dt>${T('kpi.short.goals')}</dt><dd>${fmt(T, p.k.goals, 'pct')}</dd></div>
            <div><dt>${T('kpi.short.checkins')}</dt><dd>${fmt(T, p.k.checkinsOnTime, 'pct')}</dd></div>
            <div><dt>${T('kpi.short.last')}</dt><dd>${p.k.lastSession ? T('unit.days_ago', { n: p.k.daysSinceSession }) : '—'}</dd></div>
          </dl>
          ${nudgeList(T, p.id, nudges(p.data, p.k, 'mentor').slice(0, 3))}
          <a class="btn btn-sm" href="/m/${p.id}">${T('dash.open_workspace')}</a>
        </article>`;
      })}</div></section>`);
  } else {
    parts.push(html`<section class="card callout"><h2>${T('dash.no_mentees')}</h2><p>${T('dash.no_mentees_body')}</p><a class="btn btn-primary" href="/discover">${T('nav.talent')}</a></section>`);
  }
  parts.push(html`<section><h2>${T('dash.your_kpis')}</h2><p class="muted small">${T('dash.window', { n: 90 })}</p>${scorecard(T, 'mentor', sc.items)}</section>`);
  if (sc.pairs.length) {
    parts.push(html`<section class="card"><h2>${T('dash.cpd_title')}</h2><p class="small muted">${T('dash.cpd_body')}</p><ul>
      ${sc.pairs.map((p) => html`<li><a href="/certificate/mentor/${p.id}/${certCode('mentor', user.id, p.id)}">${T('dash.cpd_with', { name: db.get('SELECT name FROM users WHERE id = ?', p.data.ms.student_id).name, h: round(p.k.totalHours, 1) })}</a></li>`)}
    </ul></section>`);
  }
  return parts;
}

module.exports = (r, db) => {
  r.get('/dashboard', requireUser, (req, res, ctx) => {
    const { user } = ctx;
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.status === 'incomplete') return res.redirect('/onboarding');
    const parts = user.role === 'student' ? studentDashboard(ctx) : mentorDashboard(ctx);
    return ctx.page({
      title: ctx.t('nav.dashboard'),
      body: html`<header class="page-head row-between">
          <div><h1>${ctx.t('dash.hello', { name: user.name.split(' ')[0] })}</h1><p class="muted">${ctx.t(`dash.sub_${user.role}`)}</p></div>
        </header>
        <div class="dash-grid">
          <div class="dash-main">${parts}</div>
          <aside class="dash-side">${levelCard(ctx.t, user)}${recentPoints(ctx)}</aside>
        </div>`,
    });
  });

  r.get('/notifications', requireUser, (req, res, ctx) => {
    const list = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', ctx.user.id);
    db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', iso(), ctx.user.id);
    ctx.unread = 0;
    return ctx.page({
      title: ctx.t('nav.notifications'),
      body: html`<header class="page-head"><h1>${ctx.t('nav.notifications')}</h1></header>
        ${list.length ? html`<ul class="notif-list">${list.map((n) => {
          const { key, params } = JSON.parse(n.body);
          return html`<li class="${n.read_at ? '' : 'unread'}"><a href="${n.link || '#'}">${ctx.t(key, params)}</a><span class="small muted">${fmtDate(ctx, n.created_at, true)}</span></li>`;
        })}</ul>` : empty(ctx.t('notif.empty'))}`,
    });
  });

  function recentPoints(ctx) {
    const rows = db.all('SELECT * FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 6', ctx.user.id);
    if (!rows.length) return '';
    return html`<div class="card"><h3>${ctx.t('points.recent')}</h3><ul class="ledger">${rows.map((p) => html`<li><span>${ctx.t(`reason.${p.reason}`)}</span><strong>+${p.amount}</strong></li>`)}</ul></div>`;
  }
};
