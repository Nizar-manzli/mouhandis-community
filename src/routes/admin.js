'use strict';
const { html, iso, round } = require('../util');
const { avatar, csrfField } = require('../views/layout');
const { statTile, healthBadge, fmt, empty, fmtDate, tagList } = require('../views/components');
const { platformKpis } = require('../services/kpi');
const { scoreMatch, availableMentors, unmatchedStudents } = require('../services/matching');
const { createMentorship } = require('../services/pairs');
const { notify } = require('../services/notify');
const C = require('../config');
const { requireRole, int } = require('./guards');
const { HttpError } = require('../http');

module.exports = (r, db) => {
  const admin = requireRole('admin');

  r.get('/admin', admin, (req, res, ctx) => {
    const { t } = ctx;
    const k = platformKpis(db);
    const pending = db.all(`SELECT u.*, sp.potential_score, sp.university, sp.motivation, mp.company, mp.job_title, mp.years_experience
      FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN mentor_profiles mp ON mp.user_id = u.id
      WHERE u.status = 'pending' ORDER BY u.created_at`);
    const totalScored = Object.values(k.byBand).reduce((a, b) => a + b, 0) || 1;
    return ctx.page({
      title: t('nav.admin'),
      wide: true,
      body: html`<header class="page-head"><h1>${t('admin.title')}</h1><p class="muted">${t('admin.lead')}</p></header>
        <h2>${t('admin.growth')}</h2>
        <div class="stats">
          ${statTile(t('stat.mentors'), k.mentors, t('stat.countries', { n: k.countries }))}
          ${statTile(t('stat.students'), k.students, t('admin.waiting', { n: k.waitingStudents }))}
          ${statTile(t('stat.pairs'), k.activePairs)}
          ${statTile(t('admin.pending'), k.pendingApplications)}
        </div>
        <h2>${t('admin.quality')}</h2>
        <div class="stats">
          ${statTile(t('stat.health'), k.avgHealth === null ? '—' : Math.round(k.avgHealth), t('stat.health_sub'))}
          ${statTile(t('admin.accept_rate'), fmt(t, k.acceptRate, 'pct'), t('admin.accept_rate_sub'))}
          ${statTile(t('admin.time_to_match'), k.medianTimeToMatch === null ? '—' : t('unit.days', { n: round(k.medianTimeToMatch, 1) }))}
          ${statTile(t('admin.retention'), fmt(t, k.retention90, 'pct'), t('admin.retention_sub'))}
          ${statTile(t('admin.completion'), fmt(t, k.completionRate, 'pct'))}
          ${statTile(t('admin.mentor_sat'), fmt(t, k.mentorSatisfaction, 'outOf5'))}
        </div>
        <h2>${t('admin.impact')}</h2>
        <div class="stats">
          ${statTile(t('stat.sessions'), k.sessionsHeld)}
          ${statTile(t('stat.hours'), k.mentoringHours)}
          ${statTile(t('stat.outcomes'), k.outcomes)}
        </div>
        <div class="grid2">
          <section class="card"><h2>${t('admin.health_dist')}</h2>
            <ul class="hbars">${C.HEALTH_BANDS.map((b) => {
              const n = k.byBand[b.key] || 0;
              return html`<li><span class="badge status-${b.status}"><span aria-hidden="true">${b.icon}</span> ${t(`band.${b.key}`)}</span>
                <span class="hbar status-${b.status}"><span style="width:${((n / totalScored) * 100).toFixed(0)}%"></span></span><strong class="num">${n}</strong></li>`;
            })}</ul></section>
          <section class="card"><h2>${t('admin.at_risk')}</h2>
            ${k.atRisk.length ? html`<table class="scorecard"><thead><tr><th>${t('admin.pair')}</th><th>${t('health.title')}</th><th>${t('kpi.short.last')}</th><th></th></tr></thead><tbody>
              ${k.atRisk.map((p) => {
                const names = db.get('SELECT s.name sn, m.name mn FROM mentorships ms JOIN users s ON s.id = ms.student_id JOIN users m ON m.id = ms.mentor_id WHERE ms.id = ?', p.id);
                return html`<tr><td><a href="/m/${p.id}">${names.mn} × ${names.sn}</a></td><td>${healthBadge(t, p.k.health)}</td>
                  <td class="num">${t('unit.days_ago', { n: p.k.daysSinceSession })}</td>
                  <td><form method="post" action="/admin/nudge/${p.id}">${csrfField(ctx)}<button class="btn btn-sm">${t('admin.nudge')}</button></form></td></tr>`;
              })}</tbody></table>` : html`<p class="ok-line">✓ ${t('admin.no_risk')}</p>`}
          </section>
        </div>
        <section><h2>${t('admin.queue')}</h2>
          ${pending.length ? html`<div class="cards">${pending.map((u) => html`<article class="card person">
            <header>${avatar(u)}<div><h3>${u.name}</h3><p class="small muted">${t(`role.${u.role}`)} · ${u.country} · ${u.email} · ${fmtDate(ctx, u.created_at)}</p></div>
              ${u.role === 'student' ? html`<span class="score" title="${t('disc.potential_help')}">${u.potential_score}</span>` : ''}</header>
            <p class="small">${u.role === 'student' ? u.university : `${u.job_title} @ ${u.company} · ${t('profile.years', { n: u.years_experience })}`}</p>
            ${u.motivation ? html`<details><summary>${t('field.motivation')}</summary><p>${u.motivation}</p></details>` : ''}
            <div class="actions">
              <form method="post" action="/admin/users/${u.id}/approve">${csrfField(ctx)}<button class="btn btn-primary btn-sm">${t('admin.approve')}</button></form>
              <form method="post" action="/admin/users/${u.id}/reject">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" data-confirm="${t('admin.reject_confirm')}">${t('admin.reject')}</button></form>
            </div></article>`)}</div>` : empty(t('admin.queue_empty'))}
        </section>`,
    });
  });

  r.post('/admin/users/:id/:action', admin, (req, res, ctx) => {
    const action = ctx.params.action;
    if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'error.bad_request');
    const u = db.get("SELECT * FROM users WHERE id = ? AND role <> 'admin'", int(ctx.params.id));
    if (!u) throw new HttpError(404, 'error.not_found');
    db.run('UPDATE users SET status = ? WHERE id = ?', action === 'approve' ? 'approved' : 'rejected', u.id);
    notify(db, u.id, action === 'approve' ? 'notif.approved' : 'notif.rejected', {}, '/dashboard');
    res.redirect('/admin');
  });

  r.post('/admin/nudge/:id', admin, (req, res, ctx) => {
    const ms = db.get("SELECT * FROM mentorships WHERE id = ? AND status = 'active'", int(ctx.params.id));
    if (!ms) throw new HttpError(404, 'error.not_found');
    for (const uid of [ms.student_id, ms.mentor_id]) notify(db, uid, 'notif.nudge', {}, `/m/${ms.id}`);
    ctx.setFlash('success', 'flash.nudged');
    res.redirect('/admin');
  });

  r.get('/admin/match', admin, (req, res, ctx) => {
    const { t } = ctx;
    const mentors = availableMentors(db);
    const students = unmatchedStudents(db).sort((a, b) => b.potential_score - a.potential_score);
    return ctx.page({
      title: t('nav.match_desk'),
      wide: true,
      body: html`<header class="page-head"><h1>${t('admin.match_title')}</h1><p class="lead">${t('admin.match_lead')}</p></header>
        ${students.length ? html`<div class="cards">${students.map((s) => {
          const top = mentors.map((m) => ({ ...m, match: scoreMatch(s, m) })).sort((a, b) => b.match.score - a.match.score).slice(0, 3);
          return html`<article class="card person">
            <header>${avatar(s)}<div><h3><a href="/u/${s.id}">${s.name}</a></h3><p class="small muted">${s.university} · ${s.country} · ${t('disc.potential', { n: s.potential_score })}</p></div></header>
            ${tagList(t, s.interests, 'field')}
            <ol class="suggest">${top.map((m) => html`<li><span><strong>${m.name}</strong> <span class="small muted">${m.job_title} · ${m.country}</span></span><span class="score">${m.match.score}%</span>
              <form method="post" action="/admin/match">${csrfField(ctx)}<input type="hidden" name="student" value="${s.id}"><input type="hidden" name="mentor" value="${m.id}"><button class="btn btn-sm btn-primary">${t('admin.match')}</button></form></li>`)}</ol>
            ${top.length ? '' : html`<p class="small muted">${t('disc.no_mentors')}</p>`}
          </article>`;
        })}</div>` : empty(t('admin.all_matched'))}`,
    });
  });

  r.post('/admin/match', admin, (req, res, ctx) => {
    const sid = int(ctx.body.student);
    const mid = int(ctx.body.mentor);
    const s = db.get("SELECT * FROM users WHERE id = ? AND role = 'student' AND status = 'approved'", sid);
    const m = db.get("SELECT * FROM users WHERE id = ? AND role = 'mentor' AND status = 'approved'", mid);
    if (!s || !m) throw new HttpError(404, 'error.not_found');
    db.tx(() => {
      db.insert("INSERT INTO match_requests (student_id, mentor_id, initiated_by, status, created_at, responded_at) VALUES (?,?,'admin','accepted',?,?)", sid, mid, iso(), iso());
      createMentorship(db, sid, mid);
    });
    ctx.setFlash('success', 'flash.matched');
    res.redirect('/admin/match');
  });
};
