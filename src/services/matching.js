'use strict';
const { tags } = require('../util');

const overlap = (a, b) => tags(a).filter((x) => tags(b).includes(x));

// Compatibility between a student and a mentor (0-100) with human-readable
// reasons. Weights: field 40, aspirations 20, language 15, mode 10, timezone 10,
// availability 5.
function scoreMatch(student, mentor) {
  const reasons = [];
  let score = 0;

  const sInterests = tags(student.interests);
  const fields = overlap(student.interests, mentor.expertise);
  if (sInterests.length) score += 40 * Math.min(1, fields.length / Math.min(2, sInterests.length));
  if (fields.length) reasons.push({ key: 'reason.fields', list: fields.map((f) => `field.${f}`) });

  const sAsp = tags(student.aspirations);
  const asp = overlap(student.aspirations, mentor.offers);
  if (sAsp.length) score += 20 * Math.min(1, asp.length / Math.min(2, sAsp.length));
  if (asp.length) reasons.push({ key: 'reason.aspirations', list: asp.map((a) => `asp.${a}`) });

  const langs = overlap(student.languages, mentor.languages);
  if (langs.length) {
    score += 15;
    reasons.push({ key: 'reason.languages', list: langs.map((l) => `lang.${l}`) });
  }

  const mModes = tags(mentor.modes);
  if (mModes.includes(student.preferred_mode)) {
    score += 10;
    reasons.push({ key: 'reason.mode', list: [`mode.${student.preferred_mode}`] });
  }

  const tz = Math.abs((student.tz_offset || 0) - (mentor.tz_offset || 0));
  score += tz <= 2 ? 10 : tz <= 5 ? 6 : 3;
  if (tz <= 2) reasons.push({ key: 'reason.timezone', list: [] });

  score += Math.min(5, (mentor.hours_per_month || 0) * 1.25);

  return { score: Math.round(score), reasons };
}

function rank(subject, candidates, scorer) {
  return candidates
    .map((c) => ({ ...c, match: scorer(c) }))
    .sort((a, b) => b.match.score - a.match.score);
}

// Approved mentors that still have room for another mentee.
function availableMentors(db) {
  return db.all(`SELECT u.*, mp.* FROM users u JOIN mentor_profiles mp ON mp.user_id = u.id
    WHERE u.role = 'mentor' AND u.status = 'approved'
    AND mp.capacity > (SELECT COUNT(*) FROM mentorships m WHERE m.mentor_id = u.id AND m.status = 'active')`);
}

// Approved students without an active mentorship.
function unmatchedStudents(db) {
  return db.all(`SELECT u.*, sp.* FROM users u JOIN student_profiles sp ON sp.user_id = u.id
    WHERE u.role = 'student' AND u.status = 'approved'
    AND NOT EXISTS (SELECT 1 FROM mentorships m WHERE m.student_id = u.id AND m.status = 'active')`);
}

module.exports = { scoreMatch, rank, availableMentors, unmatchedStudents };
