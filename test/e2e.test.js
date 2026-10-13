'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const { seed } = require('../scripts/seed');
const { missing } = require('../src/i18n');

const localNow = (offsetMin = 0) => new Date(Date.now() + 3600000 + offsetMin * 60000).toISOString().slice(0, 16); // UTC+1 user

test('full journey: signup → match → pact → session → check-in → outcome', async (t) => {
  const app = await boot();
  t.after(app.close);
  const { db, base } = app;

  // Public pages
  const anon = client(base);
  for (const p of ['/', '/pact', '/leaderboard', '/signup?role=mentor', '/login']) {
    assert.equal((await anon.get(p)).status, 200, p);
  }

  // Mentor signs up and onboards (auto-approved in dev)
  const mentor = client(base);
  let r = await mentor.post('/signup', { role: 'mentor', name: 'Test Mentor', country: 'Germany', email: 'm@test.io', password: 'password123', pact: '1' });
  assert.equal(r.location, '/onboarding');
  r = await mentor.post('/profile', { name: 'Test Mentor', country: 'Germany', languages: ['fr', 'en'], tz_offset: '1', job_title: 'Engineer', company: 'ACME', years_experience: '10', expertise: ['embedded', 'software'], offers: ['internship'], modes: ['mentoring'], capacity: '2', hours_per_month: '4' });
  assert.equal(r.location, '/dashboard');
  assert.equal(db.get("SELECT status FROM users WHERE email='m@test.io'").status, 'approved');

  // Strong student is auto-approved, weak one waits for review
  const student = client(base);
  await student.post('/signup', { role: 'student', name: 'Test Student', country: 'Tunisia', email: 's@test.io', password: 'password123', pact: '1' });
  await student.post('/profile', { name: 'Test Student', country: 'Tunisia', languages: ['ar', 'fr'], tz_offset: '1', university: 'ENIT', degree: 'engineering', year: '2', gpa: '16.5', gpa_scale: '20', interests: ['embedded'], aspirations: ['internship'], preferred_mode: 'mentoring', skills: 'C, Python, KiCad, Git, Linux, MATLAB', goals: 'Get an embedded internship', motivation: 'x'.repeat(650), achievements: 'y'.repeat(420), portfolio_url: 'https://github.com/test' });
  assert.equal(db.get("SELECT status FROM users WHERE email='s@test.io'").status, 'approved');

  const weak = client(base);
  await weak.post('/signup', { role: 'student', name: 'Weak', country: 'Tunisia', email: 'w@test.io', password: 'password123', pact: '1' });
  await weak.post('/profile', { name: 'Weak', country: 'Tunisia', languages: ['ar'], gpa: '10', gpa_scale: '20' });
  assert.equal(db.get("SELECT status FROM users WHERE email='w@test.io'").status, 'pending');
  assert.equal((await weak.get('/discover')).location, '/dashboard');

  // Student finds the mentor and requests mentorship
  const mentorId = db.get("SELECT id FROM users WHERE email='m@test.io'").id;
  r = await student.get('/discover');
  assert.match(r.text, /Test Mentor/);
  r = await student.post('/requests', { target: String(mentorId), message: 'Hello <script>alert(1)</script>' });
  assert.equal(r.location, '/requests');

  // Mentor accepts; XSS in the message is escaped
  r = await mentor.get('/requests');
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.ok(r.text.includes('&lt;script&gt;'));
  const reqId = db.get("SELECT id FROM match_requests WHERE status='pending'").id;
  r = await mentor.post(`/requests/${reqId}/accept`);
  const msId = db.get('SELECT id FROM mentorships').id;
  assert.equal(r.location, `/m/${msId}?tab=pact`);

  // Both sign the pact
  await student.post(`/m/${msId}/pact`);
  await mentor.post(`/m/${msId}/pact`);
  const ms = db.get('SELECT * FROM mentorships WHERE id = ?', msId);
  assert.ok(ms.pact_student_at && ms.pact_mentor_at);

  // Goal with key results; reaching a KR awards points to both
  await student.post(`/m/${msId}/goals`, { title: 'Internship', category: 'career', kr_title: ['Applications', 'Interviews', ''], kr_target: ['5', '2', '1'], kr_unit: ['apps', 'int', ''] });
  const krs = db.all('SELECT * FROM key_results');
  assert.equal(krs.length, 2);
  await student.post(`/m/${msId}/kr/${krs[0].id}`, { current: '5' });

  // Mentor schedules a session that started 30 minutes ago, logs it, both rate
  await mentor.post(`/m/${msId}/sessions`, { topic: 'Kick-off', scheduled_at: localNow(-30), duration_min: '45' });
  const sess = db.get('SELECT * FROM sessions');
  r = await mentor.post(`/m/${msId}/sessions/${sess.id}/complete`, { notes: 'Great start', duration_min: '50', student_attended: '1' });
  assert.equal(db.get('SELECT status FROM sessions').status, 'completed');
  await student.post(`/m/${msId}/sessions/${sess.id}/rate`, { rating: '5', feedback: 'Great' });
  await mentor.post(`/m/${msId}/sessions/${sess.id}/rate`, { rating: '4' });

  // Check-in and acknowledgement
  await student.post(`/m/${msId}/checkins`, { wins: 'Did things', next_steps: 'More things', mood: '4' });
  const ci = db.get('SELECT * FROM checkins');
  await mentor.post(`/m/${msId}/checkins/${ci.id}/ack`, { reply: 'Nice!' });
  assert.ok(db.get('SELECT acked_at FROM checkins').acked_at);

  // Messages and outcomes
  await student.post(`/m/${msId}/messages`, { body: 'Thanks!' });
  await student.post(`/m/${msId}/outcomes`, { type: 'internship', title: 'Got the internship', achieved_on: '2026-09-01' });
  const out = db.get('SELECT * FROM outcomes');
  assert.equal(out.verified_at, null);
  await mentor.post(`/m/${msId}/outcomes/${out.id}/verify`);
  assert.ok(db.get('SELECT verified_at FROM outcomes').verified_at);

  // Points: pact 20 + kr 25 + session 20 + rating 5 + checkin 15 + outcome 150
  const sp = db.get("SELECT points FROM users WHERE email='s@test.io'").points;
  assert.equal(sp, 20 + 25 + 20 + 5 + 15 + 150);
  const mp = db.get("SELECT points FROM users WHERE email='m@test.io'").points;
  assert.equal(mp, 20 + 10 + 30 + 5 + 10 + 100);

  // Every workspace tab renders for both sides
  for (const tab of ['overview', 'pact', 'goals', 'sessions', 'checkins', 'messages', 'outcomes']) {
    assert.equal((await student.get(`/m/${msId}?tab=${tab}`)).status, 200, tab);
    assert.equal((await mentor.get(`/m/${msId}?tab=${tab}`)).status, 200, tab);
  }
  assert.equal((await student.get('/dashboard')).status, 200);
  assert.equal((await mentor.get('/dashboard')).status, 200);

  // Access control & CSRF
  assert.equal((await weak.get(`/m/${msId}`)).status, 403);
  const bad = await fetch(`${base}/m/${msId}/messages`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: Object.entries(student.jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: 'body=hi&_csrf=nope' });
  assert.equal(bad.status, 403);
  assert.equal((await student.post('/admin/users/1/approve')).status, 403);

  // Opportunities are gated on pair health (new pair → no score yet)
  const oppId = db.insert("INSERT INTO opportunities (posted_by, type, title, min_level, created_at) VALUES (?, 'internship', 'X', 1, ?)", mentorId, new Date().toISOString());
  assert.equal((await student.post(`/opportunities/${oppId}/apply`, { note: 'me' })).status, 403);

  // Login/logout
  await student.post('/logout');
  assert.equal((await student.get('/dashboard')).location, '/login?next=%2Fdashboard');
  r = await student.post('/login', { email: 's@test.io', password: 'wrong' });
  assert.match(r.text, /Wrong email or password/);
  r = await student.post('/login', { email: 's@test.io', password: 'password123' });
  assert.equal(r.location, '/dashboard');
});

test('every page renders in English and Arabic for every role with no missing translations', async (t) => {
  const app = await boot((db) => seed(db));
  t.after(app.close);
  const { db, base } = app;
  missing.clear();
  const msIds = db.all('SELECT id FROM mentorships').map((m) => m.id);
  const pages = {
    'admin@demo.mouhandis.org': ['/admin', '/admin/match', '/opportunities', '/leaderboard', '/notifications', ...msIds.map((id) => `/m/${id}`)],
    'karim.mentor@demo.mouhandis.org': ['/dashboard', '/discover', '/discover?sort=potential', '/requests', '/opportunities', '/profile', '/notifications'],
    'youssef.mentor@demo.mouhandis.org': ['/dashboard', '/discover'],
    'amel.mentor@demo.mouhandis.org': ['/dashboard'],
    'amina.student@demo.mouhandis.org': ['/dashboard', '/discover', '/requests', '/opportunities', '/profile'],
    'yasmine.student@demo.mouhandis.org': ['/dashboard'],
    'rania.student@demo.mouhandis.org': ['/dashboard', '/discover', '/discover?field=software', '/requests'],
    'oussama.student@demo.mouhandis.org': ['/requests', '/discover'],
    'new.applicant@demo.mouhandis.org': ['/dashboard'],
  };
  const tabs = ['overview', 'pact', 'goals', 'sessions', 'checkins', 'messages', 'outcomes'];
  for (const lang of ['en', 'ar']) {
    const anon = client(base);
    await anon.get(`/lang/${lang}`);
    const profiles = db.all("SELECT id FROM users WHERE role <> 'admin' AND status = 'approved'").map((u) => `/u/${u.id}`);
    for (const p of ['/', '/pact', '/leaderboard', '/signup', '/signup?role=mentor', '/login', ...profiles]) {
      const r = await anon.get(p);
      assert.equal(r.status, 200, `${lang} ${p}`);
    }
    for (const [email, list] of Object.entries(pages)) {
      const c = client(base);
      await c.get(`/lang/${lang}`);
      const r = await c.post('/login', { email, password: 'mouhandis2026' });
      assert.ok(r.location, `login ${email}`);
      for (const p of list) {
        const res = await c.get(p);
        assert.equal(res.status, 200, `${lang} ${email} ${p}`);
        assert.ok(!/undefined|NaN|\[object Object\]/.test(res.text.replace(/<script[\s\S]*?<\/script>/g, '')), `${lang} ${email} ${p} has a rendering glitch`);
      }
    }
    const k = client(base);
    await k.get(`/lang/${lang}`);
    await k.post('/login', { email: 'karim.mentor@demo.mouhandis.org', password: 'mouhandis2026' });
    const kid = db.get("SELECT m.id FROM mentorships m JOIN users u ON u.id = m.mentor_id WHERE u.email = 'karim.mentor@demo.mouhandis.org'").id;
    for (const tab of tabs) assert.equal((await k.get(`/m/${kid}?tab=${tab}`)).status, 200, `${lang} tab ${tab}`);
  }
  assert.deepEqual([...missing], []);
});

test('seeded pairs span every health band', async () => {
  const { openDb } = require('../src/db');
  const { pairKpis, loadPair } = require('../src/services/kpi');
  const db = openDb(':memory:');
  db.tx(() => seed(db));
  const bands = new Set(db.all("SELECT id FROM mentorships WHERE status='active'").map((m) => pairKpis(loadPair(db, m.id)).health.band?.key ?? 'new'));
  for (const b of ['thriving', 'steady', 'new']) assert.ok(bands.has(b), `missing ${b}: ${[...bands]}`);
  assert.ok(bands.has('at_risk') || bands.has('critical'), `no struggling pair: ${[...bands]}`);
});
