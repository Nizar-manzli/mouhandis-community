'use strict';
const { html, iso, tags } = require('../util');
const { avatar, csrfField } = require('../views/layout');
const { tagList, empty, fmtDate, healthBadge } = require('../views/components');
const { scoreMatch, availableMentors, unmatchedStudents } = require('../services/matching');
const { createMentorship, expireRequests } = require('../services/pairs');
const { notify } = require('../services/notify');
const { standing } = require('../services/points');
const { loadPair, pairKpis } = require('../services/kpi');
const C = require('../config');
const { requireApproved, int, str } = require('./guards');
const { HttpError } = require('../http');

function reasons(t, match) {
  return html`<ul class="reasons">${match.reasons.map((r) => html`<li>✓ ${t(r.key, { list: r.list.map((x) => t(x)).join(', ') })}</li>`)}</ul>`;
}

function requestForm(ctx, target, isMentor) {
  const t = ctx.t;
  return html`<details class="request">
    <summary class="btn btn-primary btn-sm">${t(isMentor ? 'disc.offer' : 'disc.request')}</summary>
    <form method="post" action="/requests" class="form">
      ${csrfField(ctx)}<input type="hidden" name="target" value="${target}">
      <label>${t('disc.message')}<textarea name="message" rows="3" maxlength="1000" required placeholder="${t(isMentor ? 'ph.offer_msg' : 'ph.request_msg')}"></textarea></label>
      <button class="btn btn-primary btn-sm">${t('disc.send')}</button>
    </form>
  </details>`;
}

module.exports = (r, db) => {
  r.get('/discover', requireApproved, (req, res, ctx) => {
    const { t, user } = ctx;
    expireRequests(db);
    if (user.role === 'admin') return res.redirect('/admin/match');

    if (user.role === 'student') {
      const active = db.get("SELECT id FROM mentorships WHERE student_id = ? AND status='active'", user.id);
      const me = { ...db.get('SELECT * FROM student_profiles WHERE user_id = ?', user.id), languages: user.languages, tz_offset: user.tz_offset };
      const sent = new Set(db.all("SELECT mentor_id FROM match_requests WHERE student_id = ? AND status='pending'", user.id).map((x) => x.mentor_id));
      const offers = db.all("SELECT r.*, u.name FROM match_requests r JOIN users u ON u.id = r.mentor_id WHERE r.student_id = ? AND r.status='pending' AND r.initiated_by='mentor'", user.id);
      const list = availableMentors(db).map((m) => ({ ...m, match: scoreMatch(me, m) })).sort((a, b) => b.match.score - a.match.score);
      const field = C.FIELDS.includes(ctx.query.field) ? ctx.query.field : '';
      const shown = field ? list.filter((m) => tags(m.expertise).includes(field)) : list;
      return ctx.page({
        title: t('nav.find_mentor'),
        body: html`<header class="page-head"><h1>${t('disc.title_student')}</h1><p class="lead">${t('disc.lead_student', { n: C.PACT.maxPendingRequests })}</p></header>
          ${active ? html`<p class="callout-line">${t('disc.already_matched')} <a href="/m/${active.id}">${t('dash.open_workspace')}</a></p>` : ''}
          ${offers.length ? html`<p class="callout-line">${t('disc.offers_waiting', { n: offers.length })} <a class="btn btn-sm btn-primary" href="/requests">${t('nav.requests')}</a></p>` : ''}
          <form class="filters" method="get"><label>${t('disc.filter_field')} <select name="field" data-autosubmit><option value="">${t('disc.all_fields')}</option>${C.FIELDS.map((f) => html`<option value="${f}" ${f === field ? 'selected' : ''}>${t(`field.${f}`)}</option>`)}</select></label><noscript><button class="btn btn-sm">${t('common.filter')}</button></noscript></form>
          <div class="cards">
          ${shown.length ? shown.map((m) => html`<article class="card person" id="u${m.id}">
            <header>${avatar(m)}<div><h3><a href="/u/${m.id}">${m.name}</a></h3><p class="small muted">${m.job_title} @ ${m.company} · ${m.city ? `${m.city}, ` : ''}${m.country}</p>
              <p class="small"><span class="level-chip">${t(`tier.${standing('mentor', m.points).key}`)}</span> ${t('profile.years', { n: m.years_experience })} · ${t('disc.hours', { n: m.hours_per_month })}</p></div>
              <span class="score" title="${t('disc.match_score')}">${m.match.score}%</span></header>
            ${m.headline ? html`<p>${m.headline}</p>` : ''}
            ${tagList(t, m.expertise, 'field')}
            ${reasons(t, m.match)}
            ${active ? '' : sent.has(m.id) ? html`<p class="badge status-new">${t('disc.requested')}</p>` : sent.size >= C.PACT.maxPendingRequests ? html`<p class="small muted">${t('disc.limit')}</p>` : requestForm(ctx, m.id, false)}
          </article>`) : empty(t('disc.no_mentors'))}
          </div>`,
      });
    }

    // Mentor: talent pool.
    const prof = db.get('SELECT * FROM mentor_profiles WHERE user_id = ?', user.id);
    const me = { ...prof, languages: user.languages, tz_offset: user.tz_offset };
    const offered = new Set(db.all("SELECT student_id FROM match_requests WHERE mentor_id = ? AND status='pending'", user.id).map((x) => x.student_id));
    const load = db.get("SELECT COUNT(*) n FROM mentorships WHERE mentor_id = ? AND status='active'", user.id).n;
    const sort = ctx.query.sort === 'potential' ? 'potential' : 'match';
    const pool = unmatchedStudents(db).map((s) => ({ ...s, match: scoreMatch(s, me) }))
      .sort((a, b) => (sort === 'potential' ? b.potential_score - a.potential_score : b.match.score - a.match.score));
    const tierOk = standing('mentor', user.points).index >= C.MENTOR_TIERS.findIndex((x) => x.key === C.GATES.talentPoolTier) + 1;
    let pipeline = '';
    if (tierOk) {
      const top = db.all(`SELECT u.*, sp.university, sp.interests, m.id ms_id FROM users u JOIN student_profiles sp ON sp.user_id = u.id
        JOIN mentorships m ON m.student_id = u.id AND m.status = 'active' WHERE sp.open_to_opportunities = 1 AND m.mentor_id <> ? ORDER BY u.points DESC LIMIT 6`, user.id)
        .map((s) => ({ ...s, k: pairKpis(loadPair(db, s.ms_id)) }))
        .filter((s) => s.k.health.score !== null && s.k.health.score >= C.GATES.opportunityMinHealth);
      pipeline = html`<section class="card"><h2>${t('disc.pipeline')}</h2><p class="small muted">${t('disc.pipeline_body')}</p>
        <ul class="board">${top.map((s) => html`<li>${avatar(s, 'sm')}<a href="/u/${s.id}">${s.name}</a><span class="small muted">${s.university}</span><span class="level-chip">${t(`level.${standing('student', s.points).key}`)}</span>${healthBadge(t, s.k.health)}</li>`)}</ul></section>`;
    } else {
      pipeline = html`<section class="card locked"><h2>🔒 ${t('disc.pipeline')}</h2><p class="small">${t('gate.talent', { tier: t(`tier.${C.GATES.talentPoolTier}`) })}</p></section>`;
    }
    return ctx.page({
      title: t('nav.talent'),
      body: html`<header class="page-head"><h1>${t('disc.title_mentor')}</h1><p class="lead">${t('disc.lead_mentor')}</p>
        <p class="muted">${t('disc.capacity', { n: load, cap: prof.capacity })}</p></header>
        <form class="filters" method="get"><label>${t('disc.sort')} <select name="sort" data-autosubmit>
          <option value="match" ${sort === 'match' ? 'selected' : ''}>${t('disc.sort_match')}</option>
          <option value="potential" ${sort === 'potential' ? 'selected' : ''}>${t('disc.sort_potential')}</option></select></label><noscript><button class="btn btn-sm">${t('common.filter')}</button></noscript></form>
        <div class="cards">
        ${pool.length ? pool.map((s) => html`<article class="card person">
          <header>${avatar(s)}<div><h3>${s.public_profile ? html`<a href="/u/${s.id}">${s.name}</a>` : s.name}</h3><p class="small muted">${s.university} · ${t(`degree.${s.degree}`)} · ${t('disc.year', { n: s.year })} · ${s.city ? `${s.city}, ` : ''}${s.country}</p></div>
            <span class="score" title="${t('disc.match_score')}">${s.match.score}%</span></header>
          <p class="small"><span class="badge status-good" title="${t('disc.potential_help')}">★ ${t('disc.potential', { n: s.potential_score })}</span> <span class="muted">${t(`mode.${s.preferred_mode}`)}</span></p>
          ${s.goals ? html`<p><strong>${t('field.goals')}:</strong> ${s.goals}</p>` : ''}
          ${s.motivation ? html`<details><summary>${t('field.motivation')}</summary><p>${s.motivation}</p>${s.achievements ? html`<p><strong>${t('field.achievements')}:</strong> ${s.achievements}</p>` : ''}</details>` : ''}
          ${tagList(t, s.interests, 'field')} ${tagList(t, s.aspirations, 'asp')}
          ${reasons(t, s.match)}
          ${offered.has(s.id) ? html`<p class="badge status-new">${t('disc.offered')}</p>` : load >= prof.capacity ? html`<p class="small muted">${t('disc.full')}</p>` : requestForm(ctx, s.id, true)}
        </article>`) : empty(t('disc.no_students'))}
        </div>
        ${pipeline}`,
    });
  });

  r.post('/requests', requireApproved, (req, res, ctx) => {
    const { user } = ctx;
    const target = int(ctx.body.target);
    const message = str(ctx.body.message, 1000);
    if (!['student', 'mentor'].includes(user.role)) throw new HttpError(403, 'error.forbidden');
    const studentId = user.role === 'student' ? user.id : target;
    const mentorId = user.role === 'mentor' ? user.id : target;
    const other = db.get("SELECT * FROM users WHERE id = ? AND status = 'approved' AND role = ?", target, user.role === 'student' ? 'mentor' : 'student');
    if (!other) throw new HttpError(404, 'error.not_found');
    if (db.get("SELECT 1 x FROM match_requests WHERE student_id = ? AND mentor_id = ? AND status = 'pending'", studentId, mentorId)) {
      ctx.setFlash('info', 'flash.already_requested');
      return res.redirect('/discover');
    }
    if (db.get("SELECT 1 x FROM mentorships WHERE student_id = ? AND status = 'active'", studentId)) throw new HttpError(409, 'error.student_taken');
    if (user.role === 'student') {
      const n = db.get("SELECT COUNT(*) n FROM match_requests WHERE student_id = ? AND status = 'pending' AND initiated_by = 'student'", user.id).n;
      if (n >= C.PACT.maxPendingRequests) throw new HttpError(409, 'disc.limit');
    }
    const s = { ...db.get('SELECT * FROM student_profiles WHERE user_id = ?', studentId), ...db.get('SELECT languages, tz_offset FROM users WHERE id = ?', studentId) };
    const m = { ...db.get('SELECT * FROM mentor_profiles WHERE user_id = ?', mentorId), ...db.get('SELECT languages, tz_offset FROM users WHERE id = ?', mentorId) };
    db.insert('INSERT INTO match_requests (student_id, mentor_id, initiated_by, message, score, created_at) VALUES (?,?,?,?,?,?)',
      studentId, mentorId, user.role, message, scoreMatch(s, m).score, iso());
    notify(db, target, user.role === 'student' ? 'notif.request_in' : 'notif.offer_in', { name: user.name }, '/requests');
    ctx.setFlash('success', 'flash.request_sent');
    res.redirect('/requests');
  });

  r.get('/requests', requireApproved, (req, res, ctx) => {
    const { t, user } = ctx;
    expireRequests(db);
    const col = user.role === 'student' ? 'student_id' : 'mentor_id';
    const otherCol = user.role === 'student' ? 'mentor_id' : 'student_id';
    const rows = db.all(`SELECT r.*, u.name, u.id uid, u.country FROM match_requests r JOIN users u ON u.id = r.${otherCol} WHERE r.${col} = ? ORDER BY r.created_at DESC LIMIT 50`, user.id);
    const incoming = rows.filter((x) => x.status === 'pending' && x.initiated_by !== user.role);
    const outgoing = rows.filter((x) => x.status === 'pending' && x.initiated_by === user.role);
    const history = rows.filter((x) => x.status !== 'pending');
    const row = (x, actions) => html`<li class="card req">
      <header>${avatar({ id: x.uid, name: x.name }, 'sm')}<div><strong><a href="/u/${x.uid}">${x.name}</a></strong> <span class="muted small">· ${x.country} · ${fmtDate(ctx, x.created_at)}</span></div><span class="score">${x.score}%</span></header>
      ${x.message ? html`<p class="msg">“${x.message}”</p>` : ''}
      ${actions}</li>`;
    const act = (x, kinds) => html`<div class="actions">${kinds.map((k) => html`<form method="post" action="/requests/${x.id}/${k}">${csrfField(ctx)}<button class="btn btn-sm ${k === 'accept' ? 'btn-primary' : 'btn-ghost'}">${t(`req.${k}`)}</button></form>`)}</div>`;
    return ctx.page({
      title: t('nav.requests'),
      body: html`<header class="page-head"><h1>${t('nav.requests')}</h1><p class="muted">${t('req.lead', { n: C.PACT.requestExpiryDays })}</p></header>
        <h2>${t('req.incoming')}</h2>
        ${incoming.length ? html`<ul class="reqs">${incoming.map((x) => row(x, act(x, ['accept', 'decline'])))}</ul>` : empty(t('req.none'))}
        <h2>${t('req.outgoing')}</h2>
        ${outgoing.length ? html`<ul class="reqs">${outgoing.map((x) => row(x, act(x, ['withdraw'])))}</ul>` : empty(t('req.none'))}
        ${history.length ? html`<h2>${t('req.history')}</h2><ul class="history">${history.map((x) => html`<li>${x.name} — <span class="tag">${t(`req.status.${x.status}`)}</span> <span class="small muted">${fmtDate(ctx, x.responded_at || x.created_at)}</span></li>`)}</ul>` : ''}`,
    });
  });

  r.post('/requests/:id/:action', requireApproved, (req, res, ctx) => {
    const { user } = ctx;
    const x = db.get("SELECT * FROM match_requests WHERE id = ? AND status = 'pending'", int(ctx.params.id));
    if (!x) throw new HttpError(404, 'error.not_found');
    const mine = user.role === 'student' ? x.student_id === user.id : user.role === 'mentor' ? x.mentor_id === user.id : false;
    if (!mine) throw new HttpError(403, 'error.forbidden');
    const action = ctx.params.action;
    const isRecipient = x.initiated_by !== user.role;
    const now = iso();
    if (action === 'withdraw' && !isRecipient) {
      db.run("UPDATE match_requests SET status='withdrawn', responded_at=? WHERE id=?", now, x.id);
    } else if (action === 'decline' && isRecipient) {
      db.run("UPDATE match_requests SET status='declined', responded_at=? WHERE id=?", now, x.id);
      notify(db, user.role === 'student' ? x.mentor_id : x.student_id, 'notif.declined', { name: user.name }, '/discover');
    } else if (action === 'accept' && isRecipient) {
      const msId = db.tx(() => {
        db.run("UPDATE match_requests SET status='accepted', responded_at=? WHERE id=?", now, x.id);
        return createMentorship(db, x.student_id, x.mentor_id);
      });
      ctx.setFlash('success', 'flash.matched');
      return res.redirect(`/m/${msId}?tab=pact`);
    } else {
      throw new HttpError(400, 'error.bad_request');
    }
    res.redirect('/requests');
  });
};
