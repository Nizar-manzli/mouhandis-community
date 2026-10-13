'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','mentor','admin')),
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '',
  tz_offset INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete','pending','approved','rejected')),
  points INTEGER NOT NULL DEFAULT 0,
  public_profile INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  university TEXT NOT NULL DEFAULT '',
  degree TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 1,
  gpa REAL NOT NULL DEFAULT 0,
  gpa_scale REAL NOT NULL DEFAULT 20,
  interests TEXT NOT NULL DEFAULT '',
  aspirations TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  motivation TEXT NOT NULL DEFAULT '',
  achievements TEXT NOT NULL DEFAULT '',
  portfolio_url TEXT NOT NULL DEFAULT '',
  preferred_mode TEXT NOT NULL DEFAULT 'mentoring',
  potential_score INTEGER NOT NULL DEFAULT 0,
  open_to_opportunities INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mentor_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  years_experience INTEGER NOT NULL DEFAULT 0,
  expertise TEXT NOT NULL DEFAULT '',
  offers TEXT NOT NULL DEFAULT '',
  modes TEXT NOT NULL DEFAULT 'mentoring',
  capacity INTEGER NOT NULL DEFAULT 1,
  hours_per_month INTEGER NOT NULL DEFAULT 2,
  linkedin_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS match_requests (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  mentor_id INTEGER NOT NULL REFERENCES users(id),
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('student','mentor','admin')),
  message TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  created_at TEXT NOT NULL,
  responded_at TEXT
);

CREATE TABLE IF NOT EXISTS mentorships (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  mentor_id INTEGER NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'mentoring',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','ended')),
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  sessions_per_month INTEGER NOT NULL DEFAULT 2,
  checkin_interval_days INTEGER NOT NULL DEFAULT 14,
  pact_student_at TEXT,
  pact_mentor_at TEXT,
  closed_at TEXT,
  closed_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'technical',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','dropped')),
  created_at TEXT NOT NULL,
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS key_results (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target REAL NOT NULL DEFAULT 1,
  current REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 45,
  topic TEXT NOT NULL,
  agenda TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','missed')),
  notes TEXT NOT NULL DEFAULT '',
  student_attended INTEGER,
  completed_at TEXT,
  student_rating INTEGER,
  student_feedback TEXT NOT NULL DEFAULT '',
  mentor_rating INTEGER,
  mentor_feedback TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'student' CHECK (owner IN ('student','mentor')),
  due_date TEXT NOT NULL,
  done_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  wins TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  mood INTEGER NOT NULL DEFAULT 3,
  mentor_reply TEXT NOT NULL DEFAULT '',
  acked_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL REFERENCES mentorships(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  achieved_on TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS endorsements (
  id INTEGER PRIMARY KEY,
  mentorship_id INTEGER NOT NULL UNIQUE REFERENCES mentorships(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  posted_by INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  min_level INTEGER NOT NULL DEFAULT 1,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','shortlisted','accepted','rejected')),
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, student_id)
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, reason, ref)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ms_student ON mentorships(student_id);
CREATE INDEX IF NOT EXISTS idx_ms_mentor ON mentorships(mentor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ms ON sessions(mentorship_id);
CREATE INDEX IF NOT EXISTS idx_messages_ms ON messages(mentorship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_ms ON checkins(mentorship_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return wrap(db);
}

// Small convenience layer: rows come back as plain objects.
function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const plain = (r) => (r ? { ...r } : undefined);
  return {
    raw: db,
    get: (sql, ...p) => plain(stmt(sql).get(...p)),
    all: (sql, ...p) => stmt(sql).all(...p).map(plain),
    run: (sql, ...p) => stmt(sql).run(...p),
    insert: (sql, ...p) => Number(stmt(sql).run(...p).lastInsertRowid),
    exec: (sql) => db.exec(sql),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}

module.exports = { openDb };
