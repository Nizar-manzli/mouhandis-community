'use strict';
const { POINTS, STUDENT_LEVELS, MENTOR_TIERS } = require('../config');
const { iso } = require('../util');

// Awards Impact Points idempotently: one award per (user, reason, ref).
function award(db, user, reason, ref, at = iso()) {
  const amount = POINTS[reason]?.[user.role];
  if (!amount) return 0;
  const r = db.run(
    'INSERT OR IGNORE INTO points_ledger (user_id, amount, reason, ref, created_at) VALUES (?,?,?,?,?)',
    user.id, amount, reason, String(ref), at,
  );
  if (!r.changes) return 0;
  db.run('UPDATE users SET points = points + ? WHERE id = ?', amount, user.id);
  return amount;
}

function awardPair(db, ms, reason, ref, at) {
  const s = db.get('SELECT id, role FROM users WHERE id = ?', ms.student_id);
  const m = db.get('SELECT id, role FROM users WHERE id = ?', ms.mentor_id);
  award(db, s, reason, ref, at);
  award(db, m, reason, ref, at);
}

// Returns { index (1-based), key, min, next, progress } for a points total.
function standing(role, points) {
  const ladder = role === 'mentor' ? MENTOR_TIERS : STUDENT_LEVELS;
  let i = 0;
  while (i + 1 < ladder.length && points >= ladder[i + 1].min) i++;
  const cur = ladder[i];
  const next = ladder[i + 1] || null;
  const progress = next ? (points - cur.min) / (next.min - cur.min) : 1;
  return { index: i + 1, key: cur.key, min: cur.min, next, progress };
}

module.exports = { award, awardPair, standing };
