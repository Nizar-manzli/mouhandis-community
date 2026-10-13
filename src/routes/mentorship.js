'use strict';
const { html, iso, dateOnly, hoursBetween, clamp, round, toTags } = require('../util');
const { avatar, csrfField } = require('../views/layout');
const { healthRing, healthBadge, meter, scorecard, fmtDate, fmt, empty, stars, select, localToUtc, tagList, checkboxes } = require('../views/components');
const { loadPair, pairKpis, studentScorecard, checkinDueFor } = require('../services/kpi');
const { nudges } = require('../services/nudges');
const { award, awardPair } = require('../services/points');
const { notify } = require('../services/notify');
const C = require('../config');
const { requireUser, int, str, certCode } = require('./guards');
const { HttpError } = require('../http');

const TABS = ['overview', 'pact', 'goals', 'sessions', 'checkins', 'messages', 'outcomes'];

// Loads the mentorship and the viewer's side ('student' | 'mentor' | 'admin').
function access(ctx) {
  const ms = ctx.db.get('SELECT * FROM mentorships WHERE id = ?', int(ctx.params.id));
  if (!ms) throw new HttpError(404, 'error.not_found');
  const u = ctx.user;
  const side = u.id === ms.student_id ? 'student' : u.id === ms.mentor_id ? 'mentor' : u.role === 'admin' ? 'admin' : null;
  if (!side) throw new HttpError(403, 'error.forbidden');
  return { ms, side };
}

const member = (ctx) => {
  const a = access(ctx);
  if (a.side === 'admin') throw new HttpError(403, 'error.forbidden');
  return a;
};
const activeMember = (ctx) => {
  const a = member(ctx);
  if (a.ms.status !== 'active') throw new HttpError(409, 'error.closed');
  return a;
};
const otherId = (ms, side) => (side === 'student' ? ms.mentor_id : ms.student_id);
const back = (res, ms, tab, hash = '') => res.redirect(`/m/${ms.id}?tab=${tab}${hash}`);

const HEALTH_ICON = { good: '✓', warning: '◐', serious: '▲', critical: '✕', new: '○' };
const compStatus = (v) => (v === null ? 'new' : v >= 0.75 ? 'good' : v >= 0.55 ? 'warning' : v >= 0.35 ? 'serious' : 'critical');

module.exports = (r, db) => {
  // ------------------------------------------------------------- View
  r.get('/m/:id', requireUser, (req, res, ctx) => {
    const { t } = ctx;
    const { ms, side } = access(ctx);
    const tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : 'overview';
    const data = loadPair(db, ms.id);
    const k = pairKpis(data);
    const student = db.get('SELECT u.*, sp.* FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = ?', ms.student_id);
    const mentor = db.get('SELECT u.*, mp.* FROM users u JOIN mentor_profiles mp ON mp.user_id = u.id WHERE u.id = ?', ms.mentor_id);
    const v = { ctx, t, ms, side, data, k, student, mentor, active: ms.status === 'active' && side !== 'admin' };
    const view = { overview, pact, goals, sessions, checkins, messages, outcomes }[tab];
    return ctx.page({
      title: `${student.name} × ${mentor.name}`,
      wide: true,
      body: html`<header class="ws-head">
          <div class="ws-people">${avatar(mentor)}<span class="x">×</span>${avatar(student)}
            <div><h1>${mentor.name} <span class="muted">×</span> ${student.name}</h1>
            <p class="muted small">${t(`mode.${ms.mode}`)} · ${fmtDate(ctx, ms.started_at)} → ${fmtDate(ctx, ms.ends_at)} · ${t(`ms.status.${ms.status}`)}</p></div></div>
          ${healthBadge(t, k.health)}
        </header>
        <nav class="tabs" aria-label="${t('ws.sections')}">${TABS.map((x) => html`<a href="/m/${ms.id}?tab=${x}" ${x === tab ? html`aria-current="page"` : ''}>${t(`ws.tab.${x}`)}</a>`)}</nav>
        ${view(v)}`,
    });
  });

  // ---------------------------------------------------------- Overview
  function overview({ ctx, t, ms, side, data, k, student }) {
    const comps = Object.keys(C.HEALTH_WEIGHTS);
    const studentSc = studentScorecard(db, ms.id);
    const endorsement = db.get('SELECT * FROM endorsements WHERE mentorship_id = ?', ms.id);
    const canEndorse = side === 'mentor' && !endorsement && k.ageDays >= C.GATES.endorsementMinDays && (k.attendance ?? 0) >= C.GATES.endorsementMinAttendance;
    const myNudges = side === 'admin' ? [] : nudges(data, k, side);
    return html`<div class="ws-grid">
      <section class="card health-card">
        <h2>${t('health.title')}</h2>
        <div class="health-body">
          ${healthRing(t, k.health)}
          <ul class="components">${comps.map((c) => {
            const val = k.components[c];
            const st = compStatus(val);
            return html`<li><span class="comp-name">${t(`health.${c}`)} <span class="muted small">${Math.round(C.HEALTH_WEIGHTS[c] * 100)}%</span></span>
              ${meter(val ?? 0, null, st)}<span class="comp-val"><span aria-hidden="true">${HEALTH_ICON[st]}</span> ${val === null ? t('kpi.no_data') : `${Math.round(val * 100)}`}</span></li>`;
          })}</ul>
        </div>
        ${k.health.dormant ? html`<p class="badge status-critical"><span aria-hidden="true">✕</span> ${t('health.dormant', { n: C.PACT.dormantDays })}</p>` : ''}
        ${k.health.band ? html`<p class="small">${t(`band.${k.health.band.key}.action`)}</p>` : html`<p class="small muted">${t('health.new_body')}</p>`}
      </section>
      ${side !== 'admin' ? html`<section class="card"><h2>${t('dash.next_actions')}</h2>${myNudgeList(t, ms.id, myNudges)}</section>` : ''}
      <section class="card">
        <h2>${t('ws.journey')}</h2>
        <dl class="mini-kpis">
          <div><dt>${t('ws.month')}</dt><dd>${Math.min(12, Math.floor(k.ageDays / 30) + 1)}/12</dd></div>
          <div><dt>${t('ws.sessions_held')}</dt><dd>${k.sessionsCompleted}</dd></div>
          <div><dt>${t('ws.hours')}</dt><dd>${round(k.totalHours, 1)}</dd></div>
          <div><dt>${t('ws.outcomes')}</dt><dd>${k.outcomesVerified}</dd></div>
          <div><dt>${t('kpi.short.mentor_resp')}</dt><dd>${fmt(t, k.mentorResponseH, 'hours')}</dd></div>
          <div><dt>${t('kpi.short.student_resp')}</dt><dd>${fmt(t, k.studentResponseH, 'hours')}</dd></div>
        </dl>
        ${meter(clamp(k.ageDays / 365), null, 'brand')}
        <p class="small muted">${t('ws.phase', { phase: t(k.ageDays < 30 ? 'phase.onboard' : k.ageDays < 180 ? 'phase.build' : 'phase.launch') })}</p>
      </section>
      <section class="span2"><h2>${t('ws.student_kpis', { name: student.name.split(' ')[0] })}</h2>${scorecard(t, 'student', studentSc.items)}</section>
      <section class="card span2">
        <h2>${t('ws.endorsement')}</h2>
        ${endorsement ? html`<blockquote class="endorse"><p>${endorsement.body}</p>${tagList(t, endorsement.skills, 'field')}</blockquote>`
          : canEndorse ? html`<form method="post" action="/m/${ms.id}/endorse" class="form">${csrfField(ctx)}
              <label>${t('ws.endorse_body')}<textarea name="body" rows="4" required maxlength="2000"></textarea></label>
              <p class="hint">${t('ws.endorse_skills')}</p>${checkboxes(t, 'skills', C.FIELDS, student.interests, 'field')}
              <button class="btn btn-primary">${t('ws.endorse_submit')}</button></form>`
          : html`<p class="muted small">${t('gate.endorsement', { days: C.GATES.endorsementMinDays, pct: Math.round(C.GATES.endorsementMinAttendance * 100) })}</p>`}
      </section>
      ${closeSection({ ctx, t, ms, side, k })}
    </div>`;
  }

  function myNudgeList(t, msId, list) {
    if (!list.length) return html`<p class="ok-line"><span aria-hidden="true">✓</span> ${t('nudge.all_good')}</p>`;
    const icon = { critical: '✕', serious: '▲', warning: '◐', info: '○' };
    return html`<ul class="nudges">${list.map((n) => html`<li class="nudge status-${n.level === 'info' ? 'new' : n.level}"><span aria-hidden="true">${icon[n.level]}</span><a href="/m/${msId}?tab=${n.tab}">${t(n.key, n.params)}</a></li>`)}</ul>`;
  }

  function closeSection({ ctx, t, ms, side, k }) {
    if (ms.status !== 'active') {
      const code = side === 'mentor' || side === 'admin' ? certCode('mentor', ms.mentor_id, ms.id) : null;
      return html`<section class="card span2"><h2>${t(`ms.status.${ms.status}`)}</h2>
        ${ms.closed_reason ? html`<p class="muted">${ms.closed_reason}</p>` : ''}
        ${ms.status === 'completed' && side === 'student' ? html`<a class="btn btn-primary" href="/certificate/student/${ms.id}/${certCode('student', ms.student_id, ms.id)}">${t('ws.view_certificate')}</a>` : ''}
        ${code ? html`<a class="btn" href="/certificate/mentor/${ms.id}/${code}">${t('dash.cpd_title')}</a>` : ''}
      </section>`;
    }
    if (side === 'admin') return '';
    const canComplete = k.ageDays >= 330;
    return html`<section class="card span2 danger-zone"><h2>${t('ws.close')}</h2>
      <form method="post" action="/m/${ms.id}/close" class="form">${csrfField(ctx)}
        <label>${t('ws.close_reason')}<input name="reason" maxlength="300" required></label>
        <div class="actions">
          ${canComplete ? html`<button class="btn btn-primary" name="kind" value="completed">${t('ws.complete')}</button>` : html`<p class="small muted">${t('ws.complete_hint')}</p>`}
          <button class="btn btn-ghost" name="kind" value="ended" data-confirm="${t('ws.end_confirm')}">${t('ws.end')}</button>
        </div>
      </form></section>`;
  }

  // -------------------------------------------------------------- Pact
  function pact({ ctx, t, ms, side, student, mentor }) {
    const signed = (who, at) => (at ? html`<span class="badge status-good"><span aria-hidden="true">✓</span> ${t('pact.signed_on', { date: fmtDate(ctx, at) })}</span>` : html`<span class="badge status-serious"><span aria-hidden="true">▲</span> ${t('pact.not_signed')}</span>`);
    const mine = side === 'student' ? ms.pact_student_at : side === 'mentor' ? ms.pact_mentor_at : true;
    return html`<section class="card pact-doc">
      <h2>${t('pact.doc_title')}</h2>
      <p>${t('pact.doc_intro', { mentor: mentor.name, student: student.name, months: C.PACT.durationMonths, mode: t(`mode.${ms.mode}`) })}</p>
      <div class="grid2">
        <div><h3>${t('pact.mentor_commits')}</h3><ul class="checklist">
          <li>${t('pact.m1', { n: ms.sessions_per_month })}</li><li>${t('pact.m2', { n: C.PACT.responseHours })}</li>
          <li>${t('pact.m3', { n: C.PACT.ackHours })}</li><li>${t('pact.m4')}</li><li>${t('pact.m5')}</li></ul>
          <p>${mentor.name}: ${signed('mentor', ms.pact_mentor_at)}</p></div>
        <div><h3>${t('pact.student_commits')}</h3><ul class="checklist">
          <li>${t('pact.s1')}</li><li>${t('pact.s2', { n: ms.checkin_interval_days })}</li><li>${t('pact.s3')}</li>
          <li>${t('pact.s4', { n: C.PACT.responseHours })}</li><li>${t('pact.s5')}</li></ul>
          <p>${student.name}: ${signed('student', ms.pact_student_at)}</p></div>
      </div>
      <p class="small muted">${t('pact.doc_kpis')} <a href="/pact">${t('kpis.read_pact')}</a></p>
      ${!mine && ms.status === 'active' ? html`<form method="post" action="/m/${ms.id}/pact">${csrfField(ctx)}<button class="btn btn-primary">${t('pact.sign')}</button></form>` : ''}
    </section>`;
  }

  // ------------------------------------------------------------- Goals
  function goals({ ctx, t, ms, data, active }) {
    const live = data.goals.filter((g) => g.status !== 'dropped');
    const goalProg = (g) => (g.status === 'done' ? 1 : g.krs.length ? g.krs.reduce((a, k) => a + clamp(k.current / k.target), 0) / g.krs.length : 0);
    return html`<div class="ws-grid">
      <section class="span2">
        <h2>${t('goals.title')}</h2><p class="muted small">${t('goals.lead')}</p>
        ${live.length ? live.map((g) => html`<article class="card goal ${g.status}">
          <header><h3>${g.title}</h3><span class="tag">${t(`goalcat.${g.category}`)}</span>${g.due_date ? html`<span class="small muted">${t('goals.due', { date: fmtDate(ctx, g.due_date) })}</span>` : ''}
            ${g.status === 'done' ? html`<span class="badge status-good">✓ ${t('goals.done')}</span>` : ''}</header>
          ${meter(goalProg(g), null, g.status === 'done' ? 'good' : 'brand')}
          <ul class="krs">${g.krs.map((kr) => html`<li>
            <span>${kr.title}</span>
            ${meter(clamp(kr.current / kr.target), null, kr.current >= kr.target ? 'good' : 'brand')}
            ${active && g.status === 'active' ? html`<form method="post" action="/m/${ms.id}/kr/${kr.id}" class="inline">${csrfField(ctx)}
              <input type="number" name="current" step="any" min="0" value="${kr.current}" aria-label="${t('goals.current')}"><span class="muted small">/ ${kr.target} ${kr.unit}</span>
              <button class="btn btn-sm">${t('common.update')}</button></form>` : html`<span class="small">${kr.current}/${kr.target} ${kr.unit}</span>`}
          </li>`)}</ul>
          ${active && g.status === 'active' ? html`<div class="actions">
            <form method="post" action="/m/${ms.id}/goals/${g.id}/done">${csrfField(ctx)}<button class="btn btn-sm">${t('goals.mark_done')}</button></form>
            <form method="post" action="/m/${ms.id}/goals/${g.id}/drop">${csrfField(ctx)}<button class="btn btn-sm btn-ghost" data-confirm="${t('goals.drop_confirm')}">${t('goals.drop')}</button></form></div>` : ''}
        </article>`) : empty(t('goals.none'))}
        ${active ? html`<details class="card add"><summary>+ ${t('goals.add')}</summary>
          <form method="post" action="/m/${ms.id}/goals" class="form">${csrfField(ctx)}
            <div class="row"><label>${t('goals.goal')}<input name="title" required maxlength="160" placeholder="${t('ph.goal')}"></label>
              <label>${t('goals.category')}${select(t, 'category', C.GOAL_CATEGORIES, 'technical', 'goalcat')}</label>
              <label>${t('goals.due_label')}<input type="date" name="due_date"></label></div>
            <p class="hint">${t('goals.krs_hint')}</p>
            ${[1, 2, 3].map((i) => html`<div class="row kr-row"><label>${t('goals.kr', { n: i })}<input name="kr_title" ${i === 1 ? 'required' : ''} maxlength="160" placeholder="${i === 1 ? t('ph.kr') : ''}"></label>
              <label>${t('goals.target')}<input type="number" name="kr_target" step="any" min="0.01" value="1"></label>
              <label>${t('goals.unit')}<input name="kr_unit" maxlength="30" placeholder="${i === 1 ? t('ph.unit') : ''}"></label></div>`)}
            <button class="btn btn-primary">${t('goals.save')}</button></form></details>` : ''}
      </section>
      <section class="span2">
        <h2>${t('actions.title')}</h2>
        ${data.actions.length ? html`<ul class="action-list">${data.actions.map((a) => {
          const late = !a.done_at && new Date(a.due_date) < new Date();
          return html`<li class="${a.done_at ? 'done' : late ? 'late' : ''}">
            ${a.done_at ? html`<span aria-hidden="true">✓</span>` : active ? html`<form method="post" action="/m/${ms.id}/actions/${a.id}/done" class="inline">${csrfField(ctx)}<button class="tick" aria-label="${t('actions.mark_done')}">○</button></form>` : '○'}
            <span>${a.title}</span><span class="tag">${t(`role.${a.owner}`)}</span>
            <span class="small ${late ? 'text-critical' : 'muted'}">${late ? '▲ ' : ''}${fmtDate(ctx, a.due_date)}</span></li>`;
        })}</ul>` : empty(t('actions.none'))}
        ${active ? html`<form method="post" action="/m/${ms.id}/actions" class="form card row">${csrfField(ctx)}
          <label>${t('actions.new')}<input name="title" required maxlength="200"></label>
          <label>${t('actions.owner')}${select(t, 'owner', ['student', 'mentor'], 'student', 'role')}</label>
          <label>${t('actions.due')}<input type="date" name="due_date" required></label>
          <button class="btn">${t('common.add')}</button></form>` : ''}
      </section>
    </div>`;
  }

  // ---------------------------------------------------------- Sessions
  function sessions({ ctx, t, ms, side, data, active }) {
    const now = new Date();
    const upcoming = data.sessions.filter((s) => s.status === 'scheduled');
    const past = data.sessions.filter((s) => s.status !== 'scheduled').reverse();
    const ratingField = side === 'student' ? 'student_rating' : 'mentor_rating';
    return html`<div class="ws-grid">
      <section class="span2"><h2>${t('sess.upcoming')}</h2>
        ${upcoming.length ? html`<ul class="sess-list">${upcoming.map((s) => html`<li class="card">
          <header><strong>${s.topic}</strong><span class="muted">${fmtDate(ctx, s.scheduled_at, true)} · ${t('sess.minutes', { n: s.duration_min })}</span></header>
          ${s.agenda ? html`<p class="small">${s.agenda}</p>` : ''}
          ${active && new Date(s.scheduled_at) <= new Date(now.getTime() + 3600000) ? html`<form method="post" action="/m/${ms.id}/sessions/${s.id}/complete" class="form">${csrfField(ctx)}
            <label>${t('sess.notes')}<textarea name="notes" rows="3" maxlength="3000" placeholder="${t('ph.notes')}"></textarea></label>
            <div class="row"><label>${t('sess.duration')}<input type="number" name="duration_min" min="10" max="240" value="${s.duration_min}"></label>
            <label class="check"><input type="checkbox" name="student_attended" value="1" checked> ${t('sess.attended')}</label></div>
            <div class="actions"><button class="btn btn-primary btn-sm">${t('sess.complete')}</button></div></form>` : ''}
          ${active ? html`<form method="post" action="/m/${ms.id}/sessions/${s.id}/cancel" class="inline">${csrfField(ctx)}<button class="btn btn-sm btn-ghost" data-confirm="${t('sess.cancel_confirm')}">${t('sess.cancel')}</button></form>` : ''}
        </li>`)}</ul>` : empty(t('sess.none_upcoming'))}
        ${active ? html`<details class="card add" ${upcoming.length ? '' : 'open'}><summary>+ ${t('sess.schedule')}</summary>
          <form method="post" action="/m/${ms.id}/sessions" class="form">${csrfField(ctx)}
            <div class="row"><label>${t('sess.topic')}<input name="topic" required maxlength="160"></label>
            <label>${t('sess.when', { tz: `UTC${ctx.user.tz_offset >= 0 ? '+' : ''}${ctx.user.tz_offset}` })}<input type="datetime-local" name="scheduled_at" required></label>
            <label>${t('sess.duration')}<input type="number" name="duration_min" min="10" max="240" value="45"></label></div>
            <label>${t('sess.agenda')}<textarea name="agenda" rows="2" maxlength="1000"></textarea></label>
            <button class="btn btn-primary">${t('sess.schedule')}</button></form></details>` : ''}
      </section>
      <section class="span2"><h2>${t('sess.history')}</h2>
        ${past.length ? html`<ul class="sess-list">${past.map((s) => html`<li class="card ${s.status}">
          <header><strong>${s.topic}</strong><span class="tag">${t(`sess.status.${s.status}`)}</span><span class="muted small">${fmtDate(ctx, s.scheduled_at, true)} · ${t('sess.minutes', { n: s.duration_min })}</span></header>
          ${s.notes ? html`<p class="small">${s.notes}</p>` : ''}
          ${s.status === 'completed' ? html`<p class="small">${t('sess.student_rated')}: <span class="stars">${stars(s.student_rating)}</span> ${s.student_feedback ? html`<em>“${s.student_feedback}”</em>` : ''}
            · ${t('sess.mentor_rated')}: <span class="stars">${stars(s.mentor_rating)}</span> ${s.mentor_feedback ? html`<em>“${s.mentor_feedback}”</em>` : ''}</p>
            ${side !== 'admin' && !s[ratingField] ? html`<form method="post" action="/m/${ms.id}/sessions/${s.id}/rate" class="form row">${csrfField(ctx)}
              <label>${t(side === 'student' ? 'sess.rate_mentor' : 'sess.rate_student')}${select(t, 'rating', [5, 4, 3, 2, 1], 5)}</label>
              <label>${t('sess.feedback')}<input name="feedback" maxlength="500"></label>
              <button class="btn btn-sm btn-primary">${t('sess.rate')}</button></form>` : ''}` : ''}
        </li>`)}</ul>` : empty(t('sess.none_past'))}
      </section></div>`;
  }

  // ---------------------------------------------------------- Check-ins
  function checkins({ ctx, t, ms, side, data, active }) {
    const due = checkinDueFor(ms.started_at, ms.checkin_interval_days, new Date());
    const doneThisPeriod = data.checkins.some((c) => c.due_at === iso(due));
    const moods = ['😟', '😕', '😐', '🙂', '🤩'];
    return html`<div class="ws-grid">
      ${side === 'student' && active ? html`<section class="card span2">
        <h2>${t('ci.title')}</h2>
        ${doneThisPeriod ? html`<p class="ok-line">✓ ${t('ci.done_period', { date: fmtDate(ctx, due) })}</p>` : html`
        <p class="muted small">${t('ci.due', { date: fmtDate(ctx, due) })}</p>
        <form method="post" action="/m/${ms.id}/checkins" class="form">${csrfField(ctx)}
          <label>${t('ci.wins')}<textarea name="wins" rows="2" required maxlength="1500"></textarea></label>
          <label>${t('ci.blockers')}<textarea name="blockers" rows="2" maxlength="1500"></textarea></label>
          <label>${t('ci.next')}<textarea name="next_steps" rows="2" required maxlength="1500"></textarea></label>
          <fieldset class="moods"><legend>${t('ci.mood')}</legend>${moods.map((m, i) => html`<label><input type="radio" name="mood" value="${i + 1}" ${i === 3 ? 'checked' : ''}><span>${m}</span></label>`)}</fieldset>
          <button class="btn btn-primary">${t('ci.submit')}</button></form>`}
      </section>` : ''}
      <section class="span2"><h2>${t('ci.history')}</h2>
        ${data.checkins.length ? html`<ul class="ci-list">${[...data.checkins].reverse().map((c) => {
          const onTime = new Date(c.submitted_at) <= new Date(c.due_at);
          return html`<li class="card">
            <header><span class="mood" aria-label="${t('ci.mood')} ${c.mood}/5">${moods[c.mood - 1]}</span><strong>${fmtDate(ctx, c.submitted_at)}</strong>
              <span class="badge status-${onTime ? 'good' : 'warning'}"><span aria-hidden="true">${onTime ? '✓' : '◐'}</span> ${t(onTime ? 'ci.on_time' : 'ci.late')}</span></header>
            <dl><dt>${t('ci.wins')}</dt><dd>${c.wins}</dd>${c.blockers ? html`<dt>${t('ci.blockers')}</dt><dd>${c.blockers}</dd>` : ''}<dt>${t('ci.next')}</dt><dd>${c.next_steps}</dd></dl>
            ${c.acked_at ? html`<div class="reply"><strong>${t('ci.mentor_reply')}</strong> <span class="small muted">${fmtDate(ctx, c.acked_at)}</span><p>${c.mentor_reply}</p></div>`
              : side === 'mentor' && active ? html`<form method="post" action="/m/${ms.id}/checkins/${c.id}/ack" class="form">${csrfField(ctx)}
                <label>${t('ci.reply')}<textarea name="reply" rows="2" required maxlength="1500"></textarea></label>
                <button class="btn btn-sm btn-primary">${t('ci.ack')}</button> <span class="small muted">${t('ci.ack_hint', { n: C.PACT.ackHours })}</span></form>`
              : html`<p class="small muted">${t('ci.awaiting')}</p>`}
          </li>`;
        })}</ul>` : empty(t('ci.none'))}
      </section></div>`;
  }

  // ---------------------------------------------------------- Messages
  function messages({ ctx, t, ms, data, active }) {
    const names = { [ms.student_id]: db.get('SELECT name FROM users WHERE id = ?', ms.student_id).name, [ms.mentor_id]: db.get('SELECT name FROM users WHERE id = ?', ms.mentor_id).name };
    const recent = data.messages.slice(-100);
    return html`<section class="chat">
      <p class="muted small">${t('msg.lead', { n: C.PACT.responseHours })}</p>
      <ol class="thread" id="thread">${recent.map((m) => html`<li class="${m.sender_id === ctx.user.id ? 'me' : ''}">
        <div class="bubble"><p>${m.body}</p><span class="small muted">${names[m.sender_id]} · ${fmtDate(ctx, m.created_at, true)}</span></div></li>`)}</ol>
      ${recent.length ? '' : empty(t('msg.none'))}
      ${active ? html`<form method="post" action="/m/${ms.id}/messages" class="form chat-form">${csrfField(ctx)}
        <label class="sr-only" for="body">${t('msg.write')}</label><textarea id="body" name="body" rows="2" required maxlength="4000" placeholder="${t('msg.write')}"></textarea>
        <button class="btn btn-primary">${t('msg.send')}</button></form>` : ''}
    </section>`;
  }

  // ---------------------------------------------------------- Outcomes
  function outcomes({ ctx, t, ms, side, data, active }) {
    return html`<div class="ws-grid">
      <section class="span2"><h2>${t('out.title')}</h2><p class="muted small">${t('out.lead')}</p>
        ${data.outcomes.length ? html`<ul class="timeline">${[...data.outcomes].reverse().map((o) => html`<li>
          <span class="tag">${t(`outcome.${o.type}`)}</span> <strong>${o.title}</strong> <span class="small muted">${fmtDate(ctx, o.achieved_on)}</span>
          ${o.verified_at ? html`<span class="badge status-good">✓ ${t('outcome.verified')}</span>` : side === 'mentor' && active
            ? html`<form method="post" action="/m/${ms.id}/outcomes/${o.id}/verify" class="inline">${csrfField(ctx)}<button class="btn btn-sm btn-primary">${t('out.verify')}</button></form>`
            : html`<span class="badge status-new">○ ${t('out.unverified')}</span>`}
          ${o.description ? html`<p class="small">${o.description}</p>` : ''}</li>`)}</ul>` : empty(t('out.none'))}
        ${active ? html`<details class="card add"><summary>+ ${t('out.add')}</summary>
          <form method="post" action="/m/${ms.id}/outcomes" class="form">${csrfField(ctx)}
            <div class="row"><label>${t('out.type')}${select(t, 'type', C.OUTCOME_TYPES, 'internship', 'outcome')}</label>
            <label>${t('out.what')}<input name="title" required maxlength="160" placeholder="${t('ph.outcome')}"></label>
            <label>${t('out.date')}<input type="date" name="achieved_on" required></label></div>
            <label>${t('out.description')}<textarea name="description" rows="2" maxlength="1000"></textarea></label>
            <button class="btn btn-primary">${t('out.save')}</button></form></details>` : ''}
      </section></div>`;
  }

  // ======================================================== Mutations
  r.post('/m/:id/pact', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const col = side === 'student' ? 'pact_student_at' : 'pact_mentor_at';
    if (!ms[col]) {
      db.run(`UPDATE mentorships SET ${col} = ? WHERE id = ?`, iso(), ms.id);
      award(db, ctx.user, 'pact_signed', ms.id);
      notify(db, otherId(ms, side), 'notif.pact_signed', { name: ctx.user.name }, `/m/${ms.id}?tab=pact`);
    }
    ctx.setFlash('success', 'flash.pact_signed');
    back(res, ms, 'overview');
  });

  r.post('/m/:id/goals', requireUser, (req, res, ctx) => {
    const { ms } = activeMember(ctx);
    const b = ctx.body;
    const title = str(b.title, 160);
    if (!title) throw new HttpError(400, 'error.bad_request');
    const krTitles = [].concat(b.kr_title || []);
    const krTargets = [].concat(b.kr_target || []);
    const krUnits = [].concat(b.kr_unit || []);
    db.tx(() => {
      const gid = db.insert('INSERT INTO goals (mentorship_id, title, category, due_date, created_at) VALUES (?,?,?,?,?)',
        ms.id, title, C.GOAL_CATEGORIES.includes(b.category) ? b.category : 'technical', /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null, iso());
      krTitles.forEach((kt, i) => {
        const tt = str(kt, 160);
        if (!tt) return;
        const target = Number(krTargets[i]) > 0 ? Number(krTargets[i]) : 1;
        db.insert('INSERT INTO key_results (goal_id, title, target, unit, updated_at) VALUES (?,?,?,?,?)', gid, tt, target, str(krUnits[i], 30), iso());
      });
    });
    back(res, ms, 'goals');
  });

  r.post('/m/:id/kr/:kid', requireUser, (req, res, ctx) => {
    const { ms } = activeMember(ctx);
    const kr = db.get('SELECT kr.* FROM key_results kr JOIN goals g ON g.id = kr.goal_id WHERE kr.id = ? AND g.mentorship_id = ?', int(ctx.params.kid), ms.id);
    if (!kr) throw new HttpError(404, 'error.not_found');
    const current = Math.max(0, Number(ctx.body.current) || 0);
    db.run('UPDATE key_results SET current = ?, updated_at = ? WHERE id = ?', current, iso(), kr.id);
    if (current >= kr.target) awardPair(db, ms, 'key_result_reached', kr.id);
    back(res, ms, 'goals');
  });

  r.post('/m/:id/goals/:gid/:action', requireUser, (req, res, ctx) => {
    const { ms } = activeMember(ctx);
    const g = db.get('SELECT * FROM goals WHERE id = ? AND mentorship_id = ?', int(ctx.params.gid), ms.id);
    if (!g) throw new HttpError(404, 'error.not_found');
    if (ctx.params.action === 'done') {
      db.run("UPDATE goals SET status='done', done_at=? WHERE id=?", iso(), g.id);
      awardPair(db, ms, 'goal_done', g.id);
      ctx.setFlash('success', 'flash.goal_done');
    } else if (ctx.params.action === 'drop') {
      db.run("UPDATE goals SET status='dropped' WHERE id=?", g.id);
    } else throw new HttpError(400, 'error.bad_request');
    back(res, ms, 'goals');
  });

  r.post('/m/:id/actions', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const title = str(ctx.body.title, 200);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.body.due_date)) throw new HttpError(400, 'error.bad_request');
    const owner = ctx.body.owner === 'mentor' ? 'mentor' : 'student';
    db.insert('INSERT INTO action_items (mentorship_id, title, owner, due_date, created_at) VALUES (?,?,?,?,?)', ms.id, title, owner, ctx.body.due_date, iso());
    if (owner !== side) notify(db, otherId(ms, side), 'notif.action_assigned', { title }, `/m/${ms.id}?tab=goals`);
    back(res, ms, 'goals');
  });

  r.post('/m/:id/actions/:aid/done', requireUser, (req, res, ctx) => {
    const { ms } = activeMember(ctx);
    const a = db.get('SELECT * FROM action_items WHERE id = ? AND mentorship_id = ? AND done_at IS NULL', int(ctx.params.aid), ms.id);
    if (!a) throw new HttpError(404, 'error.not_found');
    const now = iso();
    db.run('UPDATE action_items SET done_at = ? WHERE id = ?', now, a.id);
    if (dateOnly(now) <= a.due_date) {
      const owner = db.get('SELECT id, role FROM users WHERE id = ?', a.owner === 'student' ? ms.student_id : ms.mentor_id);
      award(db, owner, 'action_done_on_time', a.id);
    }
    back(res, ms, 'goals');
  });

  r.post('/m/:id/sessions', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const at = localToUtc(ctx, str(ctx.body.scheduled_at, 20));
    const topic = str(ctx.body.topic, 160);
    if (!at || !topic) throw new HttpError(400, 'error.bad_request');
    db.insert('INSERT INTO sessions (mentorship_id, scheduled_at, duration_min, topic, agenda, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      ms.id, at, clamp(Number.parseInt(ctx.body.duration_min, 10) || 45, 10, 240), topic, str(ctx.body.agenda, 1000), ctx.user.id, iso());
    notify(db, otherId(ms, side), 'notif.session_scheduled', { name: ctx.user.name, topic }, `/m/${ms.id}?tab=sessions`);
    ctx.setFlash('success', 'flash.session_scheduled');
    back(res, ms, 'sessions');
  });

  r.post('/m/:id/sessions/:sid/:action', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const s = db.get('SELECT * FROM sessions WHERE id = ? AND mentorship_id = ?', int(ctx.params.sid), ms.id);
    if (!s) throw new HttpError(404, 'error.not_found');
    const b = ctx.body;
    const now = iso();
    switch (ctx.params.action) {
      case 'complete': {
        if (s.status !== 'scheduled') throw new HttpError(409, 'error.bad_request');
        if (new Date(s.scheduled_at) > new Date(Date.now() + 3600000)) throw new HttpError(409, 'error.future_session');
        const attended = b.student_attended === '1';
        db.run('UPDATE sessions SET status=?, notes=?, duration_min=?, student_attended=?, completed_at=? WHERE id=?',
          attended ? 'completed' : 'missed', str(b.notes, 3000), clamp(Number.parseInt(b.duration_min, 10) || s.duration_min, 10, 240), attended ? 1 : 0, now, s.id);
        if (attended) {
          awardPair(db, ms, 'session_completed', s.id);
          notify(db, otherId(ms, side), 'notif.rate_session', { topic: s.topic }, `/m/${ms.id}?tab=sessions`);
        }
        ctx.setFlash('success', 'flash.session_logged');
        break;
      }
      case 'cancel':
        if (s.status !== 'scheduled') throw new HttpError(409, 'error.bad_request');
        db.run("UPDATE sessions SET status='cancelled' WHERE id=?", s.id);
        notify(db, otherId(ms, side), 'notif.session_cancelled', { topic: s.topic }, `/m/${ms.id}?tab=sessions`);
        break;
      case 'rate': {
        if (s.status !== 'completed') throw new HttpError(409, 'error.bad_request');
        const field = side === 'student' ? 'student' : 'mentor';
        if (s[`${field}_rating`]) break;
        const rating = clamp(Number.parseInt(b.rating, 10) || 5, 1, 5);
        db.run(`UPDATE sessions SET ${field}_rating = ?, ${field}_feedback = ? WHERE id = ?`, rating, str(b.feedback, 500), s.id);
        award(db, ctx.user, 'session_rated', s.id);
        break;
      }
      default: throw new HttpError(400, 'error.bad_request');
    }
    back(res, ms, 'sessions');
  });

  r.post('/m/:id/checkins', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    if (side !== 'student') throw new HttpError(403, 'error.forbidden');
    const now = new Date();
    const due = iso(checkinDueFor(ms.started_at, ms.checkin_interval_days, now));
    if (db.get('SELECT 1 x FROM checkins WHERE mentorship_id = ? AND due_at = ?', ms.id, due)) return back(res, ms, 'checkins');
    const wins = str(ctx.body.wins, 1500);
    const next = str(ctx.body.next_steps, 1500);
    if (!wins || !next) throw new HttpError(400, 'error.bad_request');
    db.insert('INSERT INTO checkins (mentorship_id, due_at, submitted_at, wins, blockers, next_steps, mood) VALUES (?,?,?,?,?,?,?)',
      ms.id, due, iso(now), wins, str(ctx.body.blockers, 1500), next, clamp(Number.parseInt(ctx.body.mood, 10) || 3, 1, 5));
    // Check-ins are submitted within their own period, so they're on time by
    // construction; late ones only happen for periods that were skipped.
    award(db, ctx.user, 'checkin_on_time', due);
    notify(db, ms.mentor_id, 'notif.checkin', { name: ctx.user.name }, `/m/${ms.id}?tab=checkins`);
    ctx.setFlash('success', 'flash.checkin');
    back(res, ms, 'checkins');
  });

  r.post('/m/:id/checkins/:cid/ack', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    if (side !== 'mentor') throw new HttpError(403, 'error.forbidden');
    const c = db.get('SELECT * FROM checkins WHERE id = ? AND mentorship_id = ? AND acked_at IS NULL', int(ctx.params.cid), ms.id);
    if (!c) throw new HttpError(404, 'error.not_found');
    const reply = str(ctx.body.reply, 1500);
    if (!reply) throw new HttpError(400, 'error.bad_request');
    const now = iso();
    db.run('UPDATE checkins SET acked_at = ?, mentor_reply = ? WHERE id = ?', now, reply, c.id);
    if (hoursBetween(c.submitted_at, now) <= C.PACT.ackHours) award(db, ctx.user, 'checkin_ack_fast', c.id);
    notify(db, ms.student_id, 'notif.checkin_ack', { name: ctx.user.name }, `/m/${ms.id}?tab=checkins`);
    back(res, ms, 'checkins');
  });

  r.post('/m/:id/messages', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const body = str(ctx.body.body, 4000);
    if (!body) throw new HttpError(400, 'error.bad_request');
    db.insert('INSERT INTO messages (mentorship_id, sender_id, body, created_at) VALUES (?,?,?,?)', ms.id, ctx.user.id, body, iso());
    // One notification per unanswered streak, not per message.
    const prev = db.get('SELECT sender_id FROM messages WHERE mentorship_id = ? ORDER BY id DESC LIMIT 1 OFFSET 1', ms.id);
    if (!prev || prev.sender_id !== ctx.user.id) notify(db, otherId(ms, side), 'notif.message', { name: ctx.user.name }, `/m/${ms.id}?tab=messages`);
    back(res, ms, 'messages', '#thread');
  });

  r.post('/m/:id/outcomes', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const title = str(ctx.body.title, 160);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(ctx.body.achieved_on)) throw new HttpError(400, 'error.bad_request');
    const type = C.OUTCOME_TYPES.includes(ctx.body.type) ? ctx.body.type : 'project';
    const now = iso();
    const id = db.insert('INSERT INTO outcomes (mentorship_id, type, title, description, achieved_on, verified_at, created_at) VALUES (?,?,?,?,?,?,?)',
      ms.id, type, title, str(ctx.body.description, 1000), ctx.body.achieved_on, side === 'mentor' ? now : null, now);
    if (side === 'mentor') awardPair(db, ms, 'outcome_verified', id);
    else notify(db, ms.mentor_id, 'notif.outcome', { name: ctx.user.name, title }, `/m/${ms.id}?tab=outcomes`);
    ctx.setFlash('success', side === 'mentor' ? 'flash.outcome_verified' : 'flash.outcome_logged');
    back(res, ms, 'outcomes');
  });

  r.post('/m/:id/outcomes/:oid/verify', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    if (side !== 'mentor') throw new HttpError(403, 'error.forbidden');
    const o = db.get('SELECT * FROM outcomes WHERE id = ? AND mentorship_id = ? AND verified_at IS NULL', int(ctx.params.oid), ms.id);
    if (!o) throw new HttpError(404, 'error.not_found');
    db.run('UPDATE outcomes SET verified_at = ? WHERE id = ?', iso(), o.id);
    awardPair(db, ms, 'outcome_verified', o.id);
    notify(db, ms.student_id, 'notif.outcome_verified', { title: o.title }, `/m/${ms.id}?tab=outcomes`);
    ctx.setFlash('success', 'flash.outcome_verified');
    back(res, ms, 'outcomes');
  });

  r.post('/m/:id/endorse', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    if (side !== 'mentor') throw new HttpError(403, 'error.forbidden');
    const k = pairKpis(loadPair(db, ms.id));
    if (k.ageDays < C.GATES.endorsementMinDays || (k.attendance ?? 0) < C.GATES.endorsementMinAttendance) throw new HttpError(409, 'error.endorse_gate');
    const body = str(ctx.body.body, 2000);
    if (!body) throw new HttpError(400, 'error.bad_request');
    if (db.get('SELECT 1 x FROM endorsements WHERE mentorship_id = ?', ms.id)) return back(res, ms, 'overview');
    db.insert('INSERT INTO endorsements (mentorship_id, body, skills, created_at) VALUES (?,?,?,?)', ms.id, body, toTags(ctx.body.skills, C.FIELDS), iso());
    awardPair(db, ms, 'endorsement_written', ms.id);
    notify(db, ms.student_id, 'notif.endorsed', { name: ctx.user.name }, `/u/${ms.student_id}`);
    ctx.setFlash('success', 'flash.endorsed');
    back(res, ms, 'overview');
  });

  r.post('/m/:id/close', requireUser, (req, res, ctx) => {
    const { ms, side } = activeMember(ctx);
    const kind = ctx.body.kind === 'completed' ? 'completed' : 'ended';
    const ageDays = (Date.now() - new Date(ms.started_at)) / 86400000;
    if (kind === 'completed' && ageDays < 330) throw new HttpError(409, 'ws.complete_hint');
    const reason = str(ctx.body.reason, 300);
    db.run('UPDATE mentorships SET status = ?, closed_at = ?, closed_reason = ? WHERE id = ?', kind, iso(), reason, ms.id);
    if (kind === 'completed') awardPair(db, ms, 'mentorship_completed', ms.id);
    notify(db, otherId(ms, side), kind === 'completed' ? 'notif.completed' : 'notif.ended', { name: ctx.user.name }, `/m/${ms.id}`);
    for (const a of db.all("SELECT id FROM users WHERE role='admin'")) notify(db, a.id, 'notif.admin_closed', { id: ms.id, kind }, `/m/${ms.id}`);
    back(res, ms, 'overview');
  });

};
