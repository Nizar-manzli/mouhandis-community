'use strict';
const { PACT } = require('../config');
const { daysBetween, hoursBetween, iso } = require('../util');
const { checkinDueFor } = require('./kpi');

// Next actions for one side of a pair. Each nudge = { key, params, tab, level }
// where level is 'critical' | 'serious' | 'warning' | 'info'. These are what
// keep the KPIs green, so they're the first thing each person sees.
function nudges(data, k, role, nowIn = new Date()) {
  const now = new Date(nowIn);
  const { ms } = data;
  const out = [];
  if (ms.status !== 'active') return out;
  const mine = role === 'student' ? ms.pact_student_at : ms.pact_mentor_at;
  if (!mine) out.push({ key: 'nudge.sign_pact', tab: 'pact', level: 'serious' });

  if (!data.goals.filter((g) => g.status !== 'dropped').length) {
    out.push({ key: role === 'student' ? 'nudge.set_goals_student' : 'nudge.set_goals_mentor', tab: 'goals', level: k.ageDays > 14 ? 'serious' : 'warning' });
  }

  const upcoming = data.sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at) >= now);
  const pastScheduled = data.sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at) < now);
  if (pastScheduled.length) out.push({ key: 'nudge.close_session', params: { n: pastScheduled.length }, tab: 'sessions', level: 'warning' });
  if (!upcoming.length) {
    out.push({ key: 'nudge.schedule_session', tab: 'sessions', level: k.daysSinceSession > PACT.dormantDays ? 'critical' : k.daysSinceSession > 14 ? 'serious' : 'info' });
  }

  const ratingField = role === 'student' ? 'student_rating' : 'mentor_rating';
  const unrated = data.sessions.filter((s) => s.status === 'completed' && !s[ratingField]);
  if (unrated.length) out.push({ key: 'nudge.rate_session', params: { n: unrated.length }, tab: 'sessions', level: 'info' });

  if (role === 'student') {
    const due = checkinDueFor(ms.started_at, ms.checkin_interval_days, now);
    const done = data.checkins.some((c) => c.due_at === iso(due));
    const daysLeft = daysBetween(now, due);
    if (!done && daysLeft <= 4) out.push({ key: 'nudge.checkin_due', params: { n: Math.max(0, Math.ceil(daysLeft)) }, tab: 'checkins', level: daysLeft <= 1 ? 'serious' : 'warning' });
    const overdue = data.actions.filter((a) => a.owner === 'student' && !a.done_at && new Date(a.due_date) < now);
    if (overdue.length) out.push({ key: 'nudge.actions_overdue', params: { n: overdue.length }, tab: 'goals', level: 'serious' });
  } else {
    const pending = data.checkins.filter((c) => !c.acked_at);
    if (pending.length) {
      const oldest = Math.max(...pending.map((c) => hoursBetween(c.submitted_at, now)));
      out.push({ key: 'nudge.ack_checkin', params: { n: pending.length }, tab: 'checkins', level: oldest > PACT.ackHours ? 'serious' : 'warning' });
    }
    const unverified = data.outcomes.filter((o) => !o.verified_at);
    if (unverified.length) out.push({ key: 'nudge.verify_outcome', params: { n: unverified.length }, tab: 'outcomes', level: 'warning' });
    const overdue = data.actions.filter((a) => a.owner === 'mentor' && !a.done_at && new Date(a.due_date) < now);
    if (overdue.length) out.push({ key: 'nudge.actions_overdue', params: { n: overdue.length }, tab: 'goals', level: 'serious' });
  }

  // Unanswered message owed by this side.
  const last = data.messages[data.messages.length - 1];
  const myId = role === 'student' ? ms.student_id : ms.mentor_id;
  if (last && last.sender_id !== myId) {
    const h = hoursBetween(last.created_at, now);
    out.push({ key: 'nudge.reply', params: { n: Math.round(h) }, tab: 'messages', level: h > PACT.responseHours ? 'serious' : 'warning' });
  }

  const rank = { critical: 0, serious: 1, warning: 2, info: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

module.exports = { nudges };
