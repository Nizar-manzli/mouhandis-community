'use strict';
const C = require('../config');
const { iso, addDays, tags } = require('../util');
const { notify } = require('./notify');
const { HttpError } = require('../http');

// Creates a mentorship after checking capacity and that the student is free.
function createMentorship(db, studentId, mentorId, at = new Date()) {
  const busy = db.get("SELECT 1 x FROM mentorships WHERE student_id = ? AND status = 'active'", studentId);
  if (busy) throw new HttpError(409, 'error.student_taken');
  const mp = db.get('SELECT capacity, modes FROM mentor_profiles WHERE user_id = ?', mentorId);
  const load = db.get("SELECT COUNT(*) n FROM mentorships WHERE mentor_id = ? AND status = 'active'", mentorId).n;
  if (!mp || load >= mp.capacity) throw new HttpError(409, 'error.mentor_full');
  const sp = db.get('SELECT preferred_mode FROM student_profiles WHERE user_id = ?', studentId);
  const mode = tags(mp.modes).includes(sp.preferred_mode) ? sp.preferred_mode : tags(mp.modes)[0] || 'mentoring';
  const id = db.insert(
    `INSERT INTO mentorships (student_id, mentor_id, mode, started_at, ends_at, sessions_per_month, checkin_interval_days)
     VALUES (?,?,?,?,?,?,?)`,
    studentId, mentorId, mode, iso(at), iso(addDays(at, C.PACT.durationMonths * 30.4)), C.PACT.sessionsPerMonth, C.PACT.checkinIntervalDays,
  );
  // The student is matched: close their other open requests.
  db.run("UPDATE match_requests SET status = 'withdrawn', responded_at = ? WHERE student_id = ? AND status = 'pending'", iso(at), studentId);
  notify(db, studentId, 'notif.matched', {}, `/m/${id}?tab=pact`);
  notify(db, mentorId, 'notif.matched', {}, `/m/${id}?tab=pact`);
  return id;
}

function expireRequests(db, now = new Date()) {
  db.run("UPDATE match_requests SET status = 'expired', responded_at = ? WHERE status = 'pending' AND created_at < ?",
    iso(now), iso(addDays(now, -C.PACT.requestExpiryDays)));
}

module.exports = { createMentorship, expireRequests };
