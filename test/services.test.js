'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreMatch } = require('../src/services/matching');
const { potentialScore } = require('../src/services/potential');
const { award, standing } = require('../src/services/points');
const { nudges } = require('../src/services/nudges');
const { pairKpis } = require('../src/services/kpi');
const { openDb } = require('../src/db');
const { html, raw } = require('../src/util');
const { iso, addDays } = require('../src/util');

test('html template escapes interpolations', () => {
  assert.equal(String(html`<p>${'<script>"x"</script>'}</p>`), '<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>');
  assert.equal(String(html`<p>${raw('<b>ok</b>')}${[1, null, false, 'a']}</p>`), '<p><b>ok</b>1a</p>');
});

test('matching prefers shared fields, languages and close time zones', () => {
  const student = { interests: 'embedded,electrical', aspirations: 'internship', languages: 'ar,fr', tz_offset: 1, preferred_mode: 'mentoring' };
  const good = { expertise: 'embedded,electrical', offers: 'internship', languages: 'fr,en', tz_offset: 1, modes: 'mentoring', hours_per_month: 4 };
  const bad = { expertise: 'civil', offers: 'startup', languages: 'en', tz_offset: -8, modes: 'coaching', hours_per_month: 2 };
  const a = scoreMatch(student, good);
  const b = scoreMatch(student, bad);
  assert.ok(a.score >= 95, `good ${a.score}`);
  assert.ok(b.score < 20, `bad ${b.score}`);
  assert.ok(a.reasons.some((r) => r.key === 'reason.fields'));
});

test('potential score rewards evidence', () => {
  const weak = potentialScore({ gpa: 11, gpa_scale: 20 });
  const strong = potentialScore({ gpa: 17, gpa_scale: 20, portfolio_url: 'https://x', achievements: 'x'.repeat(400), motivation: 'y'.repeat(600), skills: 'a,b,c,d,e,f', university: 'U', degree: 'd', interests: 'i', aspirations: 'a', goals: 'g' });
  assert.ok(weak < 30);
  assert.equal(strong, 100);
});

test('points are idempotent per reason and ref', () => {
  const db = openDb(':memory:');
  const id = db.insert("INSERT INTO users (email, password_hash, role, name, created_at) VALUES ('a@b.c','x','student','A',?)", iso());
  const u = { id, role: 'student' };
  assert.equal(award(db, u, 'session_completed', 7), 20);
  assert.equal(award(db, u, 'session_completed', 7), 0);
  assert.equal(award(db, u, 'checkin_ack_fast', 1), 0); // mentor-only reason
  assert.equal(db.get('SELECT points FROM users WHERE id = ?', id).points, 20);
});

test('standing computes level and progress', () => {
  assert.equal(standing('student', 0).key, 'explorer');
  assert.equal(standing('student', 300).key, 'builder');
  assert.equal(standing('mentor', 950).key, 'champion');
  assert.equal(standing('mentor', 99999).next, null);
});

test('nudges surface the pact, goals and owed replies first', () => {
  const now = new Date();
  const data = {
    ms: { id: 1, student_id: 1, mentor_id: 2, status: 'active', started_at: iso(addDays(now, -20)), sessions_per_month: 2, checkin_interval_days: 14, pact_student_at: null, pact_mentor_at: iso(now) },
    goals: [], sessions: [], checkins: [{ id: 1, submitted_at: iso(addDays(now, -4)), acked_at: null, due_at: iso(addDays(now, -6)) }], actions: [], outcomes: [],
    messages: [{ sender_id: 1, created_at: iso(addDays(now, -3)) }],
  };
  const k = pairKpis(data, now);
  const s = nudges(data, k, 'student', now).map((n) => n.key);
  assert.ok(s.includes('nudge.sign_pact'));
  assert.ok(s.includes('nudge.set_goals_student'));
  const m = nudges(data, k, 'mentor', now);
  assert.ok(m.some((n) => n.key === 'nudge.ack_checkin' && n.level === 'serious'));
  assert.ok(m.some((n) => n.key === 'nudge.reply' && n.level === 'serious'));
});
