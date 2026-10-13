'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pairKpis, responseSamples, responseScore, healthScore, goalProgress } = require('../src/services/kpi');
const { iso, addDays } = require('../src/util');

const now = new Date('2026-10-01T12:00:00Z');
const base = (days, extra = {}) => ({
  ms: { id: 1, student_id: 1, mentor_id: 2, status: 'active', started_at: iso(addDays(now, -days)), sessions_per_month: 2, checkin_interval_days: 14 },
  goals: [], sessions: [], checkins: [], actions: [], messages: [], outcomes: [], ...extra,
});
const session = (daysAgo, status = 'completed', extra = {}) => ({ scheduled_at: iso(addDays(now, -daysAgo)), status, duration_min: 60, student_attended: status === 'completed' ? 1 : 0, ...extra });

test('a brand-new pair has no health score yet', () => {
  const k = pairKpis(base(3), now);
  assert.equal(k.health.score, null);
  assert.equal(k.sessionsPerMonth, null);
});

test('a pair meeting the pact is thriving', () => {
  const sessions = [];
  for (let d = 85; d > 0; d -= 15) sessions.push(session(d, 'completed', { student_rating: 5, mentor_rating: 5 }));
  const checkins = [];
  const start = addDays(now, -90);
  for (let d = addDays(start, 14); d <= now; d = addDays(d, 14)) checkins.push({ due_at: iso(d), submitted_at: iso(addDays(d, -1)), acked_at: iso(addDays(d, -0.5)) });
  const goals = [{ status: 'active', krs: [{ current: 8, target: 10 }] }];
  const k = pairKpis(base(90, { sessions, checkins, goals }), now);
  assert.ok(k.health.score >= 75, `score ${k.health.score}`);
  assert.equal(k.health.band.key, 'thriving');
  assert.equal(k.checkinsOnTime, 1);
  assert.equal(k.ackRate, 1);
});

test('no session for 30+ days marks the pair dormant and caps health at 40', () => {
  const sessions = [session(80, 'completed', { student_rating: 5, mentor_rating: 5 }), session(60, 'completed', { student_rating: 5, mentor_rating: 5 })];
  const goals = [{ status: 'done', krs: [] }];
  const k = pairKpis(base(90, { sessions, goals }), now);
  assert.equal(k.health.dormant, true);
  assert.ok(k.health.score <= 40);
});

test('no goals after three weeks counts as zero goal progress', () => {
  assert.equal(pairKpis(base(30), now).goals, 0);
  assert.equal(pairKpis(base(10), now).goals, null);
});

test('missed sessions lower attendance', () => {
  const k = pairKpis(base(60, { sessions: [session(40), session(20, 'missed'), session(10), session(5, 'missed')] }), now);
  assert.equal(k.attendance, 0.5);
});

test('response samples measure the replier and penalise silence', () => {
  const t0 = addDays(now, -10);
  const msgs = [
    { sender_id: 1, created_at: iso(t0) },
    { sender_id: 1, created_at: iso(addDays(t0, 0.5)) },
    { sender_id: 2, created_at: iso(addDays(t0, 1)) }, // mentor replies 24h after first unanswered
    { sender_id: 1, created_at: iso(addDays(t0, 1.25)) }, // student replies in 6h
    { sender_id: 2, created_at: iso(addDays(now, -4)) }, // mentor replies after 114h; student then silent for 4 days
  ];
  const s = responseSamples(msgs, 1, 2, now);
  assert.deepEqual(s.mentor, [24, 114]);
  assert.equal(s.student.length, 2);
  assert.equal(s.student[0], 6);
  assert.equal(Math.round(s.student[1]), 96);
});

test('response score bands', () => {
  assert.equal(responseScore(10), 1);
  assert.equal(responseScore(40), 0.8);
  assert.equal(responseScore(70), 0.5);
  assert.equal(responseScore(500), 0.1);
  assert.equal(responseScore(null), null);
});

test('health re-normalises weights when signals are missing', () => {
  const h = healthScore({ cadence: 1, goals: null, satisfaction: null, checkins: null, responsiveness: null, actions: null }, { daysSinceSession: 1, ageDays: 40, active: true });
  assert.equal(h.score, 100);
});

test('goal progress: done goals count fully, dropped are ignored', () => {
  assert.equal(goalProgress([
    { status: 'done', krs: [] },
    { status: 'active', krs: [{ current: 1, target: 2 }, { current: 5, target: 5 }] },
    { status: 'dropped', krs: [{ current: 0, target: 1 }] },
  ]), (1 + 0.75) / 2);
});
