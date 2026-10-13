'use strict';
const { PACT, KPI_TARGETS, HEALTH_WEIGHTS, HEALTH_BANDS } = require('../config');
const { clamp, avg, median, daysBetween, hoursBetween, addDays, iso } = require('../util');

const WINDOW_DAYS = 90;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function loadPair(db, msId) {
  const ms = db.get('SELECT * FROM mentorships WHERE id = ?', msId);
  if (!ms) return null;
  const goals = db.all('SELECT * FROM goals WHERE mentorship_id = ? ORDER BY id', msId);
  for (const g of goals) g.krs = db.all('SELECT * FROM key_results WHERE goal_id = ? ORDER BY id', g.id);
  return {
    ms,
    goals,
    sessions: db.all('SELECT * FROM sessions WHERE mentorship_id = ? ORDER BY scheduled_at', msId),
    checkins: db.all('SELECT * FROM checkins WHERE mentorship_id = ? ORDER BY submitted_at', msId),
    actions: db.all('SELECT * FROM action_items WHERE mentorship_id = ? ORDER BY due_date', msId),
    messages: db.all('SELECT * FROM messages WHERE mentorship_id = ? ORDER BY created_at, id', msId),
    outcomes: db.all('SELECT * FROM outcomes WHERE mentorship_id = ? ORDER BY achieved_on', msId),
  };
}

// ---------------------------------------------------------------------------
// Primitive metrics (pure)
// ---------------------------------------------------------------------------

// Response-time samples per side. A side "owes" a reply from the first
// unanswered message of the other side; still-unanswered messages count with
// their current age once they exceed the pact's response time, so silence
// can't improve the metric.
function responseSamples(messages, studentId, mentorId, now) {
  const out = { student: [], mentor: [] };
  let waiting = null; // { from, since }
  for (const m of messages) {
    const side = m.sender_id === studentId ? 'student' : m.sender_id === mentorId ? 'mentor' : null;
    if (!side) continue;
    if (waiting && waiting.from !== side) {
      out[side].push(hoursBetween(waiting.since, m.created_at));
      waiting = null;
    }
    if (!waiting) waiting = { from: side, since: m.created_at };
  }
  if (waiting) {
    const age = hoursBetween(waiting.since, now);
    if (age > PACT.responseHours) out[waiting.from === 'student' ? 'mentor' : 'student'].push(age);
  }
  return out;
}

const responseScore = (h) =>
  h === null ? null : h <= 24 ? 1 : h <= 48 ? 0.8 : h <= 72 ? 0.5 : h <= 120 ? 0.3 : 0.1;

const rating01 = (r) => (r === null ? null : clamp((r - 1) / 4));

// Due dates for check-ins fall every `interval` days from the start.
function checkinDueFor(startedAt, interval, at) {
  const k = Math.max(1, Math.ceil(daysBetween(startedAt, at) / interval));
  return addDays(startedAt, k * interval);
}

function goalProgress(goals) {
  const live = goals.filter((g) => g.status !== 'dropped');
  const vals = [];
  for (const g of live) {
    if (g.status === 'done') { vals.push(1); continue; }
    if (!g.krs.length) { vals.push(0); continue; }
    vals.push(avg(g.krs.map((k) => (k.target > 0 ? clamp(k.current / k.target) : 0))));
  }
  return avg(vals);
}

// ---------------------------------------------------------------------------
// Pair KPIs + health score
// ---------------------------------------------------------------------------
function pairKpis(data, nowIn = new Date()) {
  const now = new Date(nowIn);
  const { ms } = data;
  const end = ms.status === 'active' ? now : new Date(ms.closed_at || now);
  const windowStart = new Date(Math.max(new Date(ms.started_at), addDays(end, -WINDOW_DAYS)));
  const windowDays = Math.max(0, daysBetween(windowStart, end));
  const ageDays = daysBetween(ms.started_at, end);
  const inWindow = (t) => t && new Date(t) >= windowStart && new Date(t) <= end;

  // Sessions
  const completed = data.sessions.filter((s) => s.status === 'completed');
  const completedInWin = completed.filter((s) => inWindow(s.scheduled_at));
  const heldOrMissed = data.sessions.filter((s) => ['completed', 'missed'].includes(s.status) && inWindow(s.scheduled_at));
  const sessionsPerMonth = windowDays >= 14 ? completedInWin.length / (windowDays / 30) : null;
  const cadence = sessionsPerMonth === null ? null : clamp(sessionsPerMonth / ms.sessions_per_month);
  const attendance = heldOrMissed.length
    ? heldOrMissed.filter((s) => s.status === 'completed' && s.student_attended !== 0).length / heldOrMissed.length
    : null;
  const lastSession = completed.length ? completed[completed.length - 1].scheduled_at : null;
  const daysSinceSession = daysBetween(lastSession || ms.started_at, end);
  const totalMinutes = completed.reduce((a, s) => a + s.duration_min, 0);

  // Ratings
  const studentRating = avg(completedInWin.filter((s) => s.student_rating).map((s) => s.student_rating));
  const mentorRating = avg(completedInWin.filter((s) => s.mentor_rating).map((s) => s.mentor_rating));
  const sat = [rating01(studentRating), rating01(mentorRating)].filter((x) => x !== null);
  const satisfaction = sat.length ? avg(sat) : null;

  // Check-ins: one expected per elapsed period inside the window.
  const interval = ms.checkin_interval_days;
  const dues = [];
  for (let d = addDays(ms.started_at, interval); d <= end; d = addDays(d, interval)) {
    if (d >= windowStart) dues.push(iso(d));
  }
  let ciPoints = 0;
  for (const due of dues) {
    const c = data.checkins.find((x) => x.due_at === due);
    if (c) ciPoints += new Date(c.submitted_at) <= new Date(due) ? 1 : 0.5;
  }
  const checkinsOnTime = dues.length ? ciPoints / dues.length : null;

  const ackable = data.checkins.filter((c) => inWindow(c.submitted_at) && (c.acked_at || hoursBetween(c.submitted_at, end) > PACT.ackHours));
  const ackRate = ackable.length
    ? ackable.filter((c) => c.acked_at && hoursBetween(c.submitted_at, c.acked_at) <= PACT.ackHours).length / ackable.length
    : null;

  // Responsiveness
  const samples = responseSamples(data.messages.filter((m) => new Date(m.created_at) >= windowStart), ms.student_id, ms.mentor_id, end);
  const studentResponseH = median(samples.student);
  const mentorResponseH = median(samples.mentor);
  const resp = [responseScore(studentResponseH), responseScore(mentorResponseH)].filter((x) => x !== null);
  const responsiveness = resp.length ? avg(resp) : null;

  // Action items
  const actionScore = (items) => {
    const due = items.filter((a) => new Date(a.due_date) <= end && new Date(a.due_date) >= windowStart);
    if (!due.length) return null;
    const pts = due.reduce((acc, a) => {
      if (!a.done_at) return acc;
      return acc + (a.done_at.slice(0, 10) <= a.due_date.slice(0, 10) ? 1 : 0.5);
    }, 0);
    return pts / due.length;
  };
  const actions = actionScore(data.actions);
  const studentActions = actionScore(data.actions.filter((a) => a.owner === 'student'));

  // Goals — a pair with no goals after three weeks is drifting.
  let goals = goalProgress(data.goals);
  if (goals === null && ageDays > 21) goals = 0;

  const outcomesVerified = data.outcomes.filter((o) => o.verified_at).length;

  const components = { cadence, goals, satisfaction, checkins: checkinsOnTime, responsiveness, actions };
  // Give new pairs two weeks to settle before scoring them.
  const health = ageDays < 14
    ? { score: null, band: null, dormant: false }
    : healthScore(components, { daysSinceSession, ageDays, active: ms.status === 'active' });

  return {
    windowDays: Math.round(windowDays),
    ageDays: Math.floor(ageDays),
    sessionsPerMonth,
    sessionsCompleted: completed.length,
    totalHours: totalMinutes / 60,
    attendance,
    studentRating,
    mentorRating,
    checkinsOnTime,
    ackRate,
    studentResponseH,
    mentorResponseH,
    actions,
    studentActions,
    goals,
    outcomesVerified,
    daysSinceSession: Math.floor(daysSinceSession),
    lastSession,
    components,
    health,
  };
}

function healthScore(components, { daysSinceSession, ageDays, active }) {
  let wsum = 0;
  let acc = 0;
  for (const [k, w] of Object.entries(HEALTH_WEIGHTS)) {
    if (components[k] === null || components[k] === undefined) continue;
    wsum += w;
    acc += w * components[k];
  }
  if (!wsum) return { score: null, band: null, dormant: false };
  let score = Math.round((acc / wsum) * 100);
  const dormant = active && ageDays > PACT.dormantDays && daysSinceSession > PACT.dormantDays;
  if (dormant) score = Math.min(score, 40);
  return { score, band: band(score), dormant };
}

const band = (score) => (score === null ? null : HEALTH_BANDS.find((b) => score >= b.min));

// ---------------------------------------------------------------------------
// Personal scorecards
// ---------------------------------------------------------------------------
function item(role, key, value) {
  const t = KPI_TARGETS[role][key];
  const met = value === null || value === undefined ? null : t.dir === 'up' ? value >= t.target : value <= t.target;
  return { key, value, target: t.target, unit: t.unit, dir: t.dir, met };
}

function mentorScorecard(db, mentorId, now = new Date()) {
  const pairs = db.all(
    `SELECT id FROM mentorships WHERE mentor_id = ? AND (status = 'active' OR closed_at >= ?)`,
    mentorId, iso(addDays(now, -365)),
  ).map((r) => ({ id: r.id, data: loadPair(db, r.id) }));
  const ks = pairs.map((p) => ({ ...p, k: pairKpis(p.data, now) }));
  const vals = (f) => ks.map(f).filter((x) => x !== null && x !== undefined);
  const allMentorSamples = ks.flatMap((p) =>
    responseSamples(p.data.messages.filter((m) => daysBetween(m.created_at, now) <= WINDOW_DAYS), p.data.ms.student_id, mentorId, now).mentor);
  const sessionsRated = ks.flatMap((p) => p.data.sessions.filter((s) => s.student_rating && daysBetween(s.scheduled_at, now) <= WINDOW_DAYS).map((s) => s.student_rating));
  const outcomesYear = ks.reduce((a, p) => a + p.data.outcomes.filter((o) => o.verified_at && daysBetween(o.achieved_on, now) <= 365).length, 0);

  return {
    pairs: ks,
    items: [
      item('mentor', 'sessions_per_month', avg(vals((p) => p.k.sessionsPerMonth))),
      item('mentor', 'response_hours', median(allMentorSamples)),
      item('mentor', 'ack_rate', avg(vals((p) => p.k.ackRate))),
      item('mentor', 'satisfaction', avg(sessionsRated)),
      item('mentor', 'mentee_progress', avg(vals((p) => p.k.goals))),
      item('mentor', 'outcomes', ks.length ? outcomesYear / ks.length : null),
    ],
  };
}

function studentScorecard(db, msId, now = new Date()) {
  const data = loadPair(db, msId);
  const k = pairKpis(data, now);
  return {
    kpis: k,
    data,
    items: [
      item('student', 'attendance', k.attendance),
      item('student', 'checkins_on_time', k.checkinsOnTime),
      item('student', 'actions_on_time', k.studentActions),
      item('student', 'kr_progress', k.goals),
      item('student', 'engagement', k.mentorRating),
      item('student', 'outcomes', k.outcomesVerified),
    ],
  };
}

// ---------------------------------------------------------------------------
// Platform KPIs (admin + landing page)
// ---------------------------------------------------------------------------
function platformKpis(db, now = new Date()) {
  const count = (sql, ...p) => db.get(sql, ...p).n;
  const active = db.all("SELECT id FROM mentorships WHERE status = 'active'");
  const healths = active.map((r) => ({ id: r.id, k: pairKpis(loadPair(db, r.id), now) }));
  const scored = healths.filter((h) => h.k.health.score !== null);
  const byBand = {};
  for (const h of scored) byBand[h.k.health.band.key] = (byBand[h.k.health.band.key] || 0) + 1;

  const reqs = db.all("SELECT created_at, responded_at, status FROM match_requests WHERE status IN ('accepted','declined')");
  const accepted = reqs.filter((r) => r.status === 'accepted');
  const allMs = db.all('SELECT started_at, status, closed_at, closed_reason FROM mentorships');
  const matured = allMs.filter((m) => daysBetween(m.started_at, now) >= 90);
  const retained90 = matured.filter((m) => m.status !== 'ended' || daysBetween(m.started_at, m.closed_at) >= 90);
  const closed = allMs.filter((m) => m.status !== 'active');

  const approvedStudents = db.all("SELECT u.id, u.created_at FROM users u WHERE role='student' AND status='approved'");
  const timeToMatch = approvedStudents.map((s) => {
    const m = db.get('SELECT MIN(started_at) t FROM mentorships WHERE student_id = ?', s.id);
    return m.t ? daysBetween(s.created_at, m.t) : null;
  }).filter((x) => x !== null);
  const waiting = approvedStudents.filter((s) => !db.get("SELECT 1 x FROM mentorships WHERE student_id = ? AND status='active'", s.id)).length;

  return {
    mentors: count("SELECT COUNT(*) n FROM users WHERE role='mentor' AND status='approved'"),
    students: approvedStudents.length,
    countries: count("SELECT COUNT(DISTINCT country) n FROM users WHERE role='mentor' AND status='approved' AND country <> ''"),
    activePairs: active.length,
    waitingStudents: waiting,
    pendingApplications: count("SELECT COUNT(*) n FROM users WHERE status='pending'"),
    avgHealth: avg(scored.map((h) => h.k.health.score)),
    byBand,
    atRisk: healths.filter((h) => h.k.health.score !== null && h.k.health.score < 55)
      .sort((a, b) => a.k.health.score - b.k.health.score),
    acceptRate: reqs.length ? accepted.length / reqs.length : null,
    medianResponseDays: median(reqs.map((r) => daysBetween(r.created_at, r.responded_at))),
    medianTimeToMatch: median(timeToMatch),
    retention90: matured.length ? retained90.length / matured.length : null,
    completionRate: closed.length ? closed.filter((m) => m.status === 'completed').length / closed.length : null,
    sessionsHeld: count("SELECT COUNT(*) n FROM sessions WHERE status='completed'"),
    mentoringHours: Math.round(db.get("SELECT COALESCE(SUM(duration_min),0) n FROM sessions WHERE status='completed'").n / 60),
    outcomes: count('SELECT COUNT(*) n FROM outcomes WHERE verified_at IS NOT NULL'),
    outcomesByType: db.all('SELECT type, COUNT(*) n FROM outcomes WHERE verified_at IS NOT NULL GROUP BY type ORDER BY n DESC'),
    mentorSatisfaction: db.get("SELECT AVG(student_rating) n FROM sessions WHERE student_rating IS NOT NULL").n,
  };
}

module.exports = {
  loadPair, pairKpis, healthScore, band, responseSamples, responseScore, goalProgress,
  checkinDueFor, mentorScorecard, studentScorecard, platformKpis, WINDOW_DAYS,
};
