'use strict';
const { html, iso, tags, round } = require('../util');
const { hashPassword, verifyPassword, createSession, destroySession } = require('../auth');
const { platformKpis } = require('../services/kpi');
const { standing } = require('../services/points');
const { csrfField, avatar } = require('../views/layout');
const { tagList, statTile, fmtDate, fmt } = require('../views/components');
const C = require('../config');
const { str, int, safeNext, certCode } = require('./guards');
const { HttpError } = require('../http');
const { LANGS } = require('../i18n');

module.exports = (r, db) => {
  // ---------------------------------------------------------------- Landing
  r.get('/', (req, res, ctx) => {
    const { t } = ctx;
    if (ctx.user && !ctx.query.home) return res.redirect('/dashboard');
    const k = platformKpis(db);
    const ar = ctx.lang === 'ar';

    const step = (n, key) => html`<li class="step"><span class="step-n">${n}</span><h3>${t(`how.${key}.title`)}</h3><p>${t(`how.${key}.body`)}</p></li>`;
    const perk = (side, key, icon) => html`<li class="perk"><span class="perk-icon" aria-hidden="true">${icon}</span><div><h4>${t(`why.${side}.${key}.title`)}</h4><p>${t(`why.${side}.${key}.body`)}</p></div></li>`;
    const kpiList = (role, keys) => html`<ul class="kpi-list">${keys.map((key) => {
      const tg = C.KPI_TARGETS[role][key];
      return html`<li><span>${t(`kpi.${role}.${key}`)}</span><strong>${tg.dir === 'down' ? '≤' : '≥'} ${fmt(t, tg.target, tg.unit)}</strong></li>`;
    })}</ul>`;

    return ctx.page({
      bare: true,
      body: html`
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${t('hero.eyebrow')}</p>
      <h1>${t('hero.title')}</h1>
      <p class="lead">${t('hero.lead')}</p>
      <div class="cta-row">
        <a class="btn btn-primary btn-lg" href="/signup?role=mentor">${t('hero.cta_mentor')}</a>
        <a class="btn btn-ghost btn-lg" href="/signup?role=student">${t('hero.cta_student')}</a>
      </div>
      <p class="small muted">${t('hero.commitment')}</p>
    </div>
    <figure class="quote-card">
      <blockquote lang="ar" dir="rtl">لو تكفل كل مهندس أو خبير أو عالم مقيم بالخارج بطالب واحد مقيم بأرض الوطن وأهله علميا وتابعه في مسيرته الأكاديمية والمهنية (Mentoring or Coaching) لكوننا جيشا لا يقهر من المبدعين والمخترعين .. نحتاج للتشبيك الحقيقي والفعال بين الخبرات على مستوى الاوطان والامة.</blockquote>
      ${ar ? '' : html`<p class="quote-en">${t('quote.translation')}</p>`}
      <figcaption>— ${t('quote.author')}, 2016</figcaption>
    </figure>
  </div>
</section>

<section class="band">
  <div class="wrap stats">
    ${statTile(t('stat.mentors'), k.mentors, t('stat.countries', { n: k.countries }))}
    ${statTile(t('stat.students'), k.students)}
    ${statTile(t('stat.pairs'), k.activePairs)}
    ${statTile(t('stat.hours'), k.mentoringHours)}
    ${statTile(t('stat.outcomes'), k.outcomes)}
    ${statTile(t('stat.health'), k.avgHealth === null ? '—' : Math.round(k.avgHealth), t('stat.health_sub'))}
  </div>
</section>

<section class="wrap section" id="how">
  <h2>${t('how.title')}</h2>
  <p class="section-lead">${t('how.lead')}</p>
  <ol class="steps">
    ${step(1, 'apply')}${step(2, 'match')}${step(3, 'pact')}${step(4, 'grow')}${step(5, 'outcomes')}
  </ol>
</section>

<section class="section alt">
  <div class="wrap two-col">
    <div>
      <p class="eyebrow">${t('why.mentor.eyebrow')}</p>
      <h2>${t('why.mentor.title')}</h2>
      <ul class="perks">
        ${perk('mentor', 'time', '⏱')}
        ${perk('mentor', 'cpd', '🎓')}
        ${perk('mentor', 'talent', '🧭')}
        ${perk('mentor', 'recognition', '🏅')}
        ${perk('mentor', 'legacy', '🌍')}
      </ul>
      <a class="btn btn-primary" href="/signup?role=mentor">${t('hero.cta_mentor')}</a>
    </div>
    <div>
      <p class="eyebrow">${t('why.student.eyebrow')}</p>
      <h2>${t('why.student.title')}</h2>
      <ul class="perks">
        ${perk('student', 'access', '🤝')}
        ${perk('student', 'opportunities', '🚪')}
        ${perk('student', 'proof', '📜')}
        ${perk('student', 'levels', '📈')}
        ${perk('student', 'free', '💚')}
      </ul>
      <a class="btn btn-primary" href="/signup?role=student">${t('hero.cta_student')}</a>
    </div>
  </div>
</section>

<section class="wrap section">
  <h2>${t('kpis.title')}</h2>
  <p class="section-lead">${t('kpis.lead')}</p>
  <div class="grid3">
    <div class="card"><h3>${t('kpis.mentor')}</h3>${kpiList('mentor', ['sessions_per_month', 'response_hours', 'ack_rate', 'satisfaction'])}</div>
    <div class="card"><h3>${t('kpis.student')}</h3>${kpiList('student', ['attendance', 'checkins_on_time', 'actions_on_time', 'kr_progress'])}</div>
    <div class="card"><h3>${t('kpis.pair')}</h3>
      <p class="small">${t('kpis.pair_body')}</p>
      <ul class="band-list">${C.HEALTH_BANDS.map((b) => html`<li><span class="badge status-${b.status}"><span aria-hidden="true">${b.icon}</span> ${t(`band.${b.key}`)}</span><span class="muted">≥ ${b.min}</span></li>`)}</ul>
    </div>
  </div>
  <p class="center"><a href="/pact" class="btn btn-ghost">${t('kpis.read_pact')}</a></p>
</section>

<section class="section alt">
  <div class="wrap two-col">
    <div>
      <h2>${t('loop.title')}</h2>
      <p>${t('loop.body')}</p>
    </div>
    <ol class="loop">
      <li>${t('loop.1')}</li><li>${t('loop.2')}</li><li>${t('loop.3')}</li><li>${t('loop.4')}</li>
    </ol>
  </div>
</section>

<section class="wrap section cta-final">
  <h2>${t('final.title')}</h2>
  <p class="section-lead">${t('final.lead')}</p>
  <div class="cta-row center">
    <a class="btn btn-primary btn-lg" href="/signup?role=mentor">${t('hero.cta_mentor')}</a>
    <a class="btn btn-ghost btn-lg" href="/signup?role=student">${t('hero.cta_student')}</a>
  </div>
</section>`,
    });
  });

  // ------------------------------------------------------------- The Pact
  r.get('/pact', (req, res, ctx) => {
    const { t } = ctx;
    const kpiTable = (role) => html`<table class="scorecard"><thead><tr><th>${t('kpi.metric')}</th><th>${t('kpi.target')}</th></tr></thead><tbody>
      ${Object.entries(C.KPI_TARGETS[role]).map(([key, tg]) => html`<tr><th scope="row"><span class="kpi-name">${t(`kpi.${role}.${key}`)}</span><span class="kpi-help">${t(`kpi.${role}.${key}.help`)}</span></th><td class="num">${tg.dir === 'down' ? '≤ ' : '≥ '}${fmt(t, tg.target, tg.unit)}</td></tr>`)}
    </tbody></table>`;
    const ladder = (list, prefix) => html`<ol class="ladder">${list.map((l) => html`<li><strong>${t(`${prefix}.${l.key}`)}</strong> <span class="muted">${t('points.from', { n: l.min })}</span><p class="small">${t(`${prefix}.${l.key}.perk`)}</p></li>`)}</ol>`;
    return ctx.page({
      title: t('pact.title'),
      body: html`
<header class="page-head"><h1>${t('pact.title')}</h1><p class="lead">${t('pact.lead')}</p></header>
<div class="grid2">
  <section class="card"><h2>${t('pact.mentor_commits')}</h2><ul class="checklist">
    <li>${t('pact.m1', { n: C.PACT.sessionsPerMonth })}</li><li>${t('pact.m2', { n: C.PACT.responseHours })}</li>
    <li>${t('pact.m3', { n: C.PACT.ackHours })}</li><li>${t('pact.m4')}</li><li>${t('pact.m5')}</li></ul></section>
  <section class="card"><h2>${t('pact.student_commits')}</h2><ul class="checklist">
    <li>${t('pact.s1')}</li><li>${t('pact.s2', { n: C.PACT.checkinIntervalDays })}</li><li>${t('pact.s3')}</li>
    <li>${t('pact.s4', { n: C.PACT.responseHours })}</li><li>${t('pact.s5')}</li></ul></section>
</div>
<h2>${t('pact.kpis')}</h2>
<div class="grid2">
  <section><h3>${t('kpis.mentor')}</h3>${kpiTable('mentor')}</section>
  <section><h3>${t('kpis.student')}</h3>${kpiTable('student')}</section>
</div>
<section class="card">
  <h2>${t('pact.health')}</h2>
  <p>${t('pact.health_body', { days: C.PACT.dormantDays })}</p>
  <table class="scorecard"><thead><tr><th>${t('pact.signal')}</th><th>${t('pact.weight')}</th></tr></thead><tbody>
    ${Object.entries(C.HEALTH_WEIGHTS).map(([k, w]) => html`<tr><th scope="row"><span class="kpi-name">${t(`health.${k}`)}</span><span class="kpi-help">${t(`health.${k}.help`)}</span></th><td class="num">${Math.round(w * 100)}%</td></tr>`)}
  </tbody></table>
  <ul class="band-list inline">${C.HEALTH_BANDS.map((b) => html`<li><span class="badge status-${b.status}"><span aria-hidden="true">${b.icon}</span> ${t(`band.${b.key}`)} ≥ ${b.min}</span> <span class="small muted">${t(`band.${b.key}.action`)}</span></li>`)}</ul>
</section>
<h2>${t('pact.rewards')}</h2>
<div class="grid2">
  <section class="card"><h3>${t('pact.mentor_tiers')}</h3>${ladder(C.MENTOR_TIERS, 'tier')}</section>
  <section class="card"><h3>${t('pact.student_levels')}</h3>${ladder(C.STUDENT_LEVELS, 'level')}</section>
</div>
<section class="card">
  <h3>${t('pact.points')}</h3>
  <table class="scorecard"><thead><tr><th>${t('pact.action')}</th><th>${t('role.student')}</th><th>${t('role.mentor')}</th></tr></thead><tbody>
  ${Object.entries(C.POINTS).map(([k, v]) => html`<tr><th scope="row">${t(`reason.${k}`)}</th><td class="num">${v.student ? `+${v.student}` : '—'}</td><td class="num">${v.mentor ? `+${v.mentor}` : '—'}</td></tr>`)}
  </tbody></table>
</section>
<section class="card">
  <h3>${t('pact.gates')}</h3>
  <ul class="checklist">
    <li>${t('gate.opportunities', { n: C.GATES.opportunityMinHealth })}</li>
    <li>${t('gate.endorsement', { days: C.GATES.endorsementMinDays, pct: Math.round(C.GATES.endorsementMinAttendance * 100) })}</li>
    <li>${t('gate.talent', { tier: t(`tier.${C.GATES.talentPoolTier}`) })}</li>
    <li>${t('gate.certificate')}</li>
  </ul>
</section>`,
    });
  });

  // ------------------------------------------------------------ Language
  r.get('/lang/:lang', (req, res, ctx) => {
    if (LANGS.includes(ctx.params.lang)) res.cookie('lang', ctx.params.lang, { maxAge: 60 * 60 * 24 * 365 });
    res.redirect(safeNext(ctx.query.next || '/'));
  });

  // ---------------------------------------------------------------- Auth
  const authForm = (ctx, mode, values = {}, errorKey = null) => {
    const { t } = ctx;
    const role = values.role === 'mentor' ? 'mentor' : 'student';
    return ctx.page({
      title: t(`auth.${mode}`),
      body: html`<section class="auth">
        <h1>${mode === 'signup' ? t(`auth.signup_${role}`) : t('auth.login')}</h1>
        ${mode === 'signup' ? html`<div class="role-switch">
          <a href="/signup?role=student" class="${role === 'student' ? 'on' : ''}">${t('role.student')}</a>
          <a href="/signup?role=mentor" class="${role === 'mentor' ? 'on' : ''}">${t('role.mentor')}</a></div>
          <p class="muted">${t(`auth.signup_${role}_lead`)}</p>` : ''}
        ${errorKey ? html`<p class="error" role="alert">${t(errorKey)}</p>` : ''}
        <form method="post" action="/${mode}" class="form">
          ${csrfField(ctx)}
          <input type="hidden" name="next" value="${values.next || ''}">
          ${mode === 'signup' ? html`<input type="hidden" name="role" value="${role}">
          <label>${t('field.name')}<input name="name" required maxlength="80" value="${values.name || ''}" autocomplete="name"></label>
          <label>${t('field.country')}<input name="country" required maxlength="60" value="${values.country || ''}" placeholder="${role === 'mentor' ? t('ph.country_mentor') : t('ph.country_student')}"></label>` : ''}
          <label>${t('field.email')}<input type="email" name="email" required maxlength="120" value="${values.email || ''}" autocomplete="email"></label>
          <label>${t('field.password')}<input type="password" name="password" required minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
          ${mode === 'signup' ? html`<label class="check"><input type="checkbox" name="pact" value="1" required> ${t('auth.agree_pact')} <a href="/pact" target="_blank">${t('nav.pact')}</a></label>` : ''}
          <button class="btn btn-primary btn-block">${mode === 'signup' ? t('auth.create') : t('auth.login')}</button>
        </form>
        <p class="muted center">${mode === 'signup' ? html`${t('auth.have_account')} <a href="/login">${t('auth.login')}</a>` : html`${t('auth.no_account')} <a href="/signup">${t('nav.join')}</a>`}</p>
        ${mode === 'login' ? html`<details class="demo"><summary>${t('auth.demo')}</summary><p class="small">${t('auth.demo_body')}</p>
          <ul class="small mono"><li>amina.student@demo.mouhandis.org</li><li>karim.mentor@demo.mouhandis.org</li><li>admin@demo.mouhandis.org</li></ul><p class="small">${t('auth.demo_pw')} <code>mouhandis2026</code></p></details>` : ''}
      </section>`,
    });
  };

  r.get('/signup', (req, res, ctx) => (ctx.user ? res.redirect('/dashboard') : authForm(ctx, 'signup', { role: ctx.query.role })));
  r.get('/login', (req, res, ctx) => (ctx.user ? res.redirect('/dashboard') : authForm(ctx, 'login', { next: ctx.query.next })));

  r.post('/signup', (req, res, ctx) => {
    const b = ctx.body;
    const role = b.role === 'mentor' ? 'mentor' : 'student';
    const email = str(b.email, 120).toLowerCase();
    const name = str(b.name, 80);
    const values = { role, email, name, country: str(b.country, 60) };
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authForm(ctx, 'signup', values, 'auth.err_invalid');
    if (String(b.password || '').length < 8) return authForm(ctx, 'signup', values, 'auth.err_password');
    if (b.pact !== '1') return authForm(ctx, 'signup', values, 'auth.err_pact');
    if (db.get('SELECT 1 x FROM users WHERE email = ?', email)) return authForm(ctx, 'signup', values, 'auth.err_exists');
    const id = db.insert(
      'INSERT INTO users (email, password_hash, role, name, country, languages, tz_offset, created_at) VALUES (?,?,?,?,?,?,?,?)',
      email, hashPassword(String(b.password)), role, name, values.country, ctx.lang === 'ar' ? 'ar' : 'en', 1, iso(),
    );
    db.run(`INSERT INTO ${role}_profiles (user_id) VALUES (?)`, id);
    res.cookie('sid', createSession(db, id), { maxAge: 60 * 60 * 24 * 30 });
    res.redirect('/onboarding');
  });

  r.post('/login', (req, res, ctx) => {
    const email = str(ctx.body.email, 120).toLowerCase();
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !verifyPassword(String(ctx.body.password || ''), u.password_hash)) {
      return authForm(ctx, 'login', { email, next: ctx.body.next }, 'auth.err_login');
    }
    res.cookie('sid', createSession(db, u.id), { maxAge: 60 * 60 * 24 * 30 });
    res.redirect(safeNext(ctx.body.next));
  });

  r.post('/logout', (req, res, ctx) => {
    if (ctx.session) destroySession(db, ctx.session.token);
    res.cookie('sid', '', { maxAge: 0 });
    res.redirect('/');
  });

  // ------------------------------------------------------ Public profile
  r.get('/u/:id', (req, res, ctx) => {
    const { t } = ctx;
    const u = db.get("SELECT * FROM users WHERE id = ? AND role <> 'admin'", int(ctx.params.id));
    if (!u || u.status !== 'approved' || (!u.public_profile && ctx.user?.id !== u.id && ctx.user?.role !== 'admin')) throw new HttpError(404, 'error.not_found');
    const s = standing(u.role, u.points);
    const ladder = u.role === 'mentor' ? 'tier' : 'level';
    let details;
    if (u.role === 'mentor') {
      const p = db.get('SELECT * FROM mentor_profiles WHERE user_id = ?', u.id);
      const stats = db.get(`SELECT COUNT(DISTINCT m.id) mentees, COALESCE(SUM(CASE WHEN s.status='completed' THEN s.duration_min END),0) mins
        FROM mentorships m LEFT JOIN sessions s ON s.mentorship_id = m.id WHERE m.mentor_id = ?`, u.id);
      const outcomes = db.all(`SELECT o.*, us.name student FROM outcomes o JOIN mentorships m ON m.id = o.mentorship_id JOIN users us ON us.id = m.student_id
        WHERE m.mentor_id = ? AND o.verified_at IS NOT NULL ORDER BY o.achieved_on DESC LIMIT 12`, u.id);
      details = html`
        <div class="stats compact">
          ${statTile(t('profile.mentees'), stats.mentees)}
          ${statTile(t('profile.hours'), round(stats.mins / 60, 1))}
          ${statTile(t('profile.outcomes'), outcomes.length)}
          ${statTile(t('profile.experience'), t('profile.years', { n: p.years_experience }))}
        </div>
        <section class="card"><h2>${t('profile.expertise')}</h2>${tagList(t, p.expertise, 'field')}
          <h3>${t('profile.offers')}</h3>${tagList(t, p.offers, 'asp')}</section>
        <section class="card"><h2>${t('profile.impact_ledger')}</h2>
          ${outcomes.length ? html`<ul class="timeline">${outcomes.map((o) => html`<li><span class="tag">${t(`outcome.${o.type}`)}</span> <strong>${o.title}</strong> <span class="muted small">· ${o.student.split(' ')[0]} · ${fmtDate(ctx, o.achieved_on)}</span></li>`)}</ul>`
            : html`<p class="muted">${t('profile.no_outcomes')}</p>`}
        </section>`;
    } else {
      const p = db.get('SELECT * FROM student_profiles WHERE user_id = ?', u.id);
      const outcomes = db.all(`SELECT o.* FROM outcomes o JOIN mentorships m ON m.id = o.mentorship_id WHERE m.student_id = ? AND o.verified_at IS NOT NULL ORDER BY o.achieved_on DESC`, u.id);
      const endorsements = db.all(`SELECT e.*, um.name mentor, um.id mentor_id, mp.job_title, mp.company FROM endorsements e JOIN mentorships m ON m.id = e.mentorship_id
        JOIN users um ON um.id = m.mentor_id JOIN mentor_profiles mp ON mp.user_id = um.id WHERE m.student_id = ? ORDER BY e.created_at DESC`, u.id);
      details = html`
        <section class="card"><h2>${t('profile.interests')}</h2>${tagList(t, p.interests, 'field')}
          <p class="small muted">${p.university}${p.degree ? ` · ${t(`degree.${p.degree}`)}` : ''}</p>
          ${tags(p.skills).length ? html`<h3>${t('field.skills')}</h3><span class="tags">${tags(p.skills).map((x) => html`<span class="tag">${x}</span>`)}</span>` : ''}</section>
        <section class="card"><h2>${t('profile.endorsements')}</h2>
          ${endorsements.length ? endorsements.map((e) => html`<blockquote class="endorse"><p>${e.body}</p><footer>— <a href="/u/${e.mentor_id}">${e.mentor}</a>, ${e.job_title} @ ${e.company}</footer>${tagList(t, e.skills, 'field')}</blockquote>`)
            : html`<p class="muted">${t('profile.no_endorsements')}</p>`}</section>
        <section class="card"><h2>${t('profile.verified_outcomes')}</h2>
          ${outcomes.length ? html`<ul class="timeline">${outcomes.map((o) => html`<li><span class="tag">${t(`outcome.${o.type}`)}</span> <strong>${o.title}</strong> <span class="muted small">· ${fmtDate(ctx, o.achieved_on)} · ✓ ${t('outcome.verified')}</span></li>`)}</ul>`
            : html`<p class="muted">${t('profile.no_outcomes')}</p>`}</section>`;
    }
    return ctx.page({
      title: u.name,
      body: html`<header class="profile-head">
          ${avatar(u, 'xl')}
          <div><h1>${u.name}</h1><p class="lead">${u.headline}</p>
          <p class="muted">${t(`role.${u.role}`)} · ${u.city ? `${u.city}, ` : ''}${u.country} · <span class="level-chip">${t(`${ladder}.${s.key}`)}</span> · ${t('points.total', { n: u.points })}</p></div>
        </header>
        ${u.bio ? html`<p class="bio">${u.bio}</p>` : ''}
        ${details}`,
    });
  });

  // --------------------------------------------------------- Leaderboard
  r.get('/leaderboard', (req, res, ctx) => {
    const { t } = ctx;
    const mentors = db.all("SELECT u.*, mp.company, mp.job_title FROM users u JOIN mentor_profiles mp ON mp.user_id = u.id WHERE role='mentor' AND status='approved' AND public_profile=1 ORDER BY points DESC LIMIT 10");
    const students = db.all("SELECT u.*, sp.university FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE role='student' AND status='approved' AND public_profile=1 ORDER BY points DESC LIMIT 10");
    const countries = db.all("SELECT country, COUNT(*) n FROM users WHERE role='mentor' AND status='approved' AND country<>'' GROUP BY country ORDER BY n DESC");
    const k = platformKpis(db);
    const row = (u, i, sub) => {
      const s = standing(u.role, u.points);
      return html`<li><span class="rank">${i + 1}</span>${avatar(u, 'sm')}<a href="/u/${u.id}">${u.name}</a><span class="muted small">${sub}</span><span class="level-chip">${t(`${u.role === 'mentor' ? 'tier' : 'level'}.${s.key}`)}</span><strong class="num">${u.points}</strong></li>`;
    };
    const maxC = Math.max(1, ...countries.map((c) => c.n));
    return ctx.page({
      title: t('lb.title'),
      body: html`<header class="page-head"><h1>${t('lb.title')}</h1><p class="lead">${t('lb.lead')}</p></header>
      <div class="stats">
        ${statTile(t('stat.hours'), k.mentoringHours)}
        ${statTile(t('stat.sessions'), k.sessionsHeld)}
        ${statTile(t('stat.outcomes'), k.outcomes)}
        ${statTile(t('stat.countries_label'), k.countries)}
      </div>
      <div class="grid2">
        <section class="card"><h2>${t('lb.mentors')}</h2><ol class="board">${mentors.map((u, i) => row(u, i, u.company))}</ol></section>
        <section class="card"><h2>${t('lb.students')}</h2><ol class="board">${students.map((u, i) => row(u, i, u.university))}</ol></section>
      </div>
      <div class="grid2">
        <section class="card"><h2>${t('lb.diaspora')}</h2>
          <ul class="hbars">${countries.map((c) => html`<li><span>${c.country}</span><span class="hbar"><span style="width:${(c.n / maxC * 100).toFixed(0)}%"></span></span><strong class="num">${c.n}</strong></li>`)}</ul></section>
        <section class="card"><h2>${t('lb.outcomes')}</h2>
          <ul class="hbars">${k.outcomesByType.map((o) => html`<li><span>${t(`outcome.${o.type}`)}</span><span class="hbar"><span style="width:${(o.n / Math.max(1, k.outcomesByType[0].n) * 100).toFixed(0)}%"></span></span><strong class="num">${o.n}</strong></li>`)}</ul></section>
      </div>`,
    });
  });

  // --------------------------------------------------------- Certificates
  r.get('/certificate/:kind/:ms/:code', (req, res, ctx) => {
    const { t } = ctx;
    const { kind, code } = ctx.params;
    const msId = int(ctx.params.ms);
    const ms = db.get('SELECT * FROM mentorships WHERE id = ?', msId);
    if (!ms || !['mentor', 'student'].includes(kind)) throw new HttpError(404, 'error.not_found');
    const userId = kind === 'mentor' ? ms.mentor_id : ms.student_id;
    if (certCode(kind, userId, msId) !== code) throw new HttpError(404, 'error.cert_invalid');
    if (kind === 'student' && ms.status !== 'completed') throw new HttpError(404, 'error.cert_invalid');
    const holder = db.get('SELECT * FROM users WHERE id = ?', userId);
    const other = db.get('SELECT * FROM users WHERE id = ?', kind === 'mentor' ? ms.student_id : ms.mentor_id);
    const mins = db.get("SELECT COALESCE(SUM(duration_min),0) n, COUNT(*) c FROM sessions WHERE mentorship_id = ? AND status='completed'", msId);
    const outcomes = db.get('SELECT COUNT(*) n FROM outcomes WHERE mentorship_id = ? AND verified_at IS NOT NULL', msId).n;
    return ctx.page({
      title: t('cert.title'),
      body: html`<article class="certificate">
        <p class="eyebrow">${t('brand')} · ${t('cert.verified')} ✓</p>
        <h1>${t(kind === 'mentor' ? 'cert.mentor_title' : 'cert.student_title')}</h1>
        <p class="cert-name">${holder.name}</p>
        <p>${t(kind === 'mentor' ? 'cert.mentor_body' : 'cert.student_body', { other: other.name, hours: round(mins.n / 60, 1), sessions: mins.c, outcomes })}</p>
        <p class="muted small">${fmtDate(ctx, ms.started_at)} → ${fmtDate(ctx, ms.closed_at || iso())} · ${t('cert.code')} <code>${code}</code></p>
        ${kind === 'mentor' ? html`<p class="small">${t('cert.cpd_note')}</p>` : ''}
        <button class="btn btn-ghost no-print" data-print>${t('cert.print')}</button>
      </article>`,
    });
  });
};
