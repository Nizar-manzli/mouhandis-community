'use strict';
const { html, iso } = require('../util');
const { avatar, csrfField } = require('../views/layout');
const { fmtDate, empty, select, healthBadge } = require('../views/components');
const { loadPair, pairKpis } = require('../services/kpi');
const { standing, award } = require('../services/points');
const { notify } = require('../services/notify');
const C = require('../config');
const { requireApproved, requireRole, int, str } = require('./guards');
const { HttpError } = require('../http');

// Students unlock the board by keeping their mentorship healthy.
function eligibility(db, user) {
  const level = standing('student', user.points).index;
  const ms = db.get("SELECT id FROM mentorships WHERE student_id = ? AND status = 'active'", user.id);
  const health = ms ? pairKpis(loadPair(db, ms.id)).health : null;
  const healthy = !!health && health.score !== null && health.score >= C.GATES.opportunityMinHealth;
  return { level, health, healthy, hasMentor: !!ms };
}

module.exports = (r, db) => {
  r.get('/opportunities', requireApproved, (req, res, ctx) => {
    const { t, user } = ctx;
    const list = db.all(`SELECT o.*, u.name poster, u.id poster_id,
        (SELECT COUNT(*) FROM applications a WHERE a.opportunity_id = o.id) apps
      FROM opportunities o JOIN users u ON u.id = o.posted_by WHERE o.status = 'open' AND (o.deadline IS NULL OR o.deadline >= ?)
      ORDER BY o.created_at DESC`, iso().slice(0, 10));
    let header = '';
    let actionFor = () => '';
    if (user.role === 'student') {
      const el = eligibility(db, user);
      const applied = new Set(db.all('SELECT opportunity_id FROM applications WHERE student_id = ?', user.id).map((x) => x.opportunity_id));
      header = html`<section class="card ${el.healthy ? '' : 'locked'}">
        <h2>${el.healthy ? '🔓' : '🔒'} ${t('opp.your_access')}</h2>
        <p>${t('opp.level_line', { level: t(`level.${standing('student', user.points).key}`) })} · ${el.hasMentor ? html`${t('opp.health_line')} ${healthBadge(t, el.health)}` : t('opp.no_mentor')}</p>
        <p class="small muted">${t('gate.opportunities', { n: C.GATES.opportunityMinHealth })}</p></section>`;
      actionFor = (o) => {
        if (applied.has(o.id)) return html`<span class="badge status-good">✓ ${t('opp.applied')}</span>`;
        if (!el.healthy) return html`<span class="small muted">🔒 ${t('opp.locked_health')}</span>`;
        if (el.level < o.min_level) return html`<span class="small muted">🔒 ${t('opp.locked_level', { level: t(`level.${C.STUDENT_LEVELS[o.min_level - 1].key}`) })}</span>`;
        return html`<details class="request"><summary class="btn btn-sm btn-primary">${t('opp.apply')}</summary>
          <form method="post" action="/opportunities/${o.id}/apply" class="form">${csrfField(ctx)}
            <label>${t('opp.note')}<textarea name="note" rows="3" maxlength="1500" required></textarea></label>
            <button class="btn btn-primary btn-sm">${t('opp.submit')}</button></form></details>`;
      };
    }
    let mine = '';
    if (user.role === 'mentor' || user.role === 'admin') {
      const posts = db.all('SELECT * FROM opportunities WHERE posted_by = ? ORDER BY created_at DESC', user.id);
      const appsFor = (oid) => db.all(`SELECT a.*, u.name, u.id uid, u.points FROM applications a JOIN users u ON u.id = a.student_id WHERE a.opportunity_id = ? ORDER BY a.created_at`, oid);
      header = html`<details class="card add"><summary>+ ${t('opp.post')}</summary>
        <form method="post" action="/opportunities" class="form">${csrfField(ctx)}
          <div class="row"><label>${t('opp.type')}${select(t, 'type', C.OPPORTUNITY_TYPES, 'internship', 'opptype')}</label>
            <label>${t('opp.title_label')}<input name="title" required maxlength="160"></label></div>
          <div class="row"><label>${t('opp.org')}<input name="organization" maxlength="120"></label>
            <label>${t('opp.location')}<input name="location" maxlength="120" placeholder="${t('ph.location')}"></label>
            <label>${t('opp.deadline')}<input type="date" name="deadline"></label>
            <label>${t('opp.min_level')}<select name="min_level">${C.STUDENT_LEVELS.map((l, i) => html`<option value="${i + 1}">${t(`level.${l.key}`)}</option>`)}</select></label></div>
          <label>${t('opp.description')}<textarea name="description" rows="3" maxlength="3000"></textarea></label>
          <p class="small muted">${t('opp.post_hint')}</p>
          <button class="btn btn-primary">${t('opp.publish')}</button></form></details>`;
      mine = posts.length ? html`<h2>${t('opp.mine')}</h2>${posts.map((o) => {
        const apps = appsFor(o.id);
        return html`<article class="card"><header class="row-between"><h3>${o.title}</h3><span class="tag">${t(`opp.status.${o.status}`)}</span></header>
          ${apps.length ? html`<ul class="apps">${apps.map((a) => html`<li>${avatar({ id: a.uid, name: a.name }, 'sm')}<a href="/u/${a.uid}">${a.name}</a> <span class="level-chip">${t(`level.${standing('student', a.points).key}`)}</span>
            <span class="tag">${t(`app.status.${a.status}`)}</span><p class="small">${a.note}</p>
            ${['submitted', 'shortlisted'].includes(a.status) ? html`<div class="actions">${['shortlisted', 'accepted', 'rejected'].filter((s) => s !== a.status).map((s) => html`<form method="post" action="/applications/${a.id}/${s}">${csrfField(ctx)}<button class="btn btn-sm ${s === 'accepted' ? 'btn-primary' : 'btn-ghost'}">${t(`app.set.${s}`)}</button></form>`)}</div>` : ''}</li>`)}</ul>`
            : html`<p class="small muted">${t('opp.no_apps')}</p>`}
          ${o.status === 'open' ? html`<form method="post" action="/opportunities/${o.id}/close">${csrfField(ctx)}<button class="btn btn-sm btn-ghost">${t('opp.close')}</button></form>` : ''}
        </article>`;
      })}` : '';
    }
    return ctx.page({
      title: t('nav.opportunities'),
      body: html`<header class="page-head"><h1>${t('opp.title')}</h1><p class="lead">${t(`opp.lead_${user.role === 'student' ? 'student' : 'mentor'}`)}</p></header>
        ${header}
        <h2>${t('opp.open')}</h2>
        ${list.length ? html`<div class="cards">${list.map((o) => html`<article class="card opp">
          <header><span class="tag">${t(`opptype.${o.type}`)}</span><h3>${o.title}</h3></header>
          <p class="small muted">${o.organization}${o.location ? ` · ${o.location}` : ''} · ${t('opp.by')} <a href="/u/${o.poster_id}">${o.poster}</a>${o.deadline ? ` · ${t('opp.until', { date: fmtDate(ctx, o.deadline) })}` : ''}</p>
          <p>${o.description}</p>
          <p class="small">${t('opp.min_level')}: <span class="level-chip">${t(`level.${C.STUDENT_LEVELS[o.min_level - 1].key}`)}</span> · ${t('opp.apps', { n: o.apps })}</p>
          ${actionFor(o)}
        </article>`)}</div>` : empty(t('opp.none'))}
        ${mine}`,
    });
  });

  r.post('/opportunities', requireRole('mentor', 'admin'), requireApproved, (req, res, ctx) => {
    const b = ctx.body;
    const title = str(b.title, 160);
    if (!title) throw new HttpError(400, 'error.bad_request');
    const id = db.insert(`INSERT INTO opportunities (posted_by, type, title, organization, location, description, min_level, deadline, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, ctx.user.id, C.OPPORTUNITY_TYPES.includes(b.type) ? b.type : 'internship', title, str(b.organization, 120),
      str(b.location, 120), str(b.description, 3000), Math.min(C.STUDENT_LEVELS.length, Math.max(1, Number.parseInt(b.min_level, 10) || 1)),
      /^\d{4}-\d{2}-\d{2}$/.test(b.deadline) ? b.deadline : null, iso());
    award(db, ctx.user, 'opportunity_posted', id);
    ctx.setFlash('success', 'flash.opp_posted');
    res.redirect('/opportunities');
  });

  r.post('/opportunities/:id/apply', requireRole('student'), requireApproved, (req, res, ctx) => {
    const o = db.get("SELECT * FROM opportunities WHERE id = ? AND status = 'open'", int(ctx.params.id));
    if (!o) throw new HttpError(404, 'error.not_found');
    const el = eligibility(db, ctx.user);
    if (!el.healthy || el.level < o.min_level) throw new HttpError(403, 'opp.locked_health');
    db.run('INSERT OR IGNORE INTO applications (opportunity_id, student_id, note, created_at) VALUES (?,?,?,?)', o.id, ctx.user.id, str(ctx.body.note, 1500), iso());
    notify(db, o.posted_by, 'notif.application', { name: ctx.user.name, title: o.title }, '/opportunities');
    ctx.setFlash('success', 'flash.applied');
    res.redirect('/opportunities');
  });

  r.post('/opportunities/:id/close', requireRole('mentor', 'admin'), (req, res, ctx) => {
    db.run("UPDATE opportunities SET status = 'closed' WHERE id = ? AND posted_by = ?", int(ctx.params.id), ctx.user.id);
    res.redirect('/opportunities');
  });

  r.post('/applications/:id/:status', requireRole('mentor', 'admin'), (req, res, ctx) => {
    const status = ctx.params.status;
    if (!['shortlisted', 'accepted', 'rejected'].includes(status)) throw new HttpError(400, 'error.bad_request');
    const a = db.get('SELECT a.*, o.posted_by, o.title FROM applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE a.id = ?', int(ctx.params.id));
    if (!a || a.posted_by !== ctx.user.id) throw new HttpError(404, 'error.not_found');
    db.run('UPDATE applications SET status = ? WHERE id = ?', status, a.id);
    if (status === 'accepted') {
      award(db, db.get('SELECT id, role FROM users WHERE id = ?', a.student_id), 'application_accepted', a.id);
      award(db, ctx.user, 'application_accepted', a.id);
    }
    notify(db, a.student_id, `notif.app_${status}`, { title: a.title }, '/opportunities');
    res.redirect('/opportunities');
  });
};
