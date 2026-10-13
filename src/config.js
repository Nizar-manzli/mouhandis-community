'use strict';
// Product rules live here so the "Pact", the KPIs and the incentives are one
// auditable source of truth (also rendered on the public /pact page).

const FIELDS = [
  'software', 'ai_data', 'electrical', 'mechanical', 'civil', 'chemical',
  'industrial', 'telecom', 'embedded', 'energy', 'biomedical', 'aerospace',
];

// What a student is aiming for == what a mentor can offer. Same vocabulary so
// the matcher can compare them directly.
const ASPIRATIONS = [
  'industry_job', 'internship', 'phd_research', 'study_abroad', 'startup', 'skills',
];

const LANGUAGES = ['ar', 'fr', 'en', 'de', 'es', 'it'];

const MODES = ['mentoring', 'coaching'];

const GOAL_CATEGORIES = ['academic', 'technical', 'career', 'research', 'entrepreneurship'];

const OUTCOME_TYPES = [
  'internship', 'job', 'scholarship', 'admission', 'publication',
  'competition', 'certification', 'project', 'startup',
];

const OPPORTUNITY_TYPES = ['internship', 'job', 'scholarship', 'referral', 'research', 'project'];

// The Mentorship Pact: the commitments both sides sign. KPI targets derive from it.
const PACT = {
  durationMonths: 12,
  sessionsPerMonth: 2,
  checkinIntervalDays: 14,
  responseHours: 48,
  ackHours: 72,
  dormantDays: 30,
  maxPendingRequests: 3,
  requestExpiryDays: 7,
};

// Gamification: Impact Points (IP). Each key is awarded at most once per
// (user, reason, ref) so replays can't inflate scores.
const POINTS = {
  pact_signed: { student: 20, mentor: 20 },
  session_completed: { student: 20, mentor: 30 },
  session_rated: { student: 5, mentor: 5 },
  checkin_on_time: { student: 15 },
  checkin_late: { student: 5 },
  checkin_ack_fast: { mentor: 10 },
  action_done_on_time: { student: 5, mentor: 5 },
  key_result_reached: { student: 25, mentor: 10 },
  goal_done: { student: 50, mentor: 20 },
  outcome_verified: { student: 150, mentor: 100 },
  endorsement_written: { mentor: 40, student: 20 },
  opportunity_posted: { mentor: 30 },
  application_accepted: { student: 100, mentor: 50 },
  mentorship_completed: { student: 200, mentor: 250 },
};

const STUDENT_LEVELS = [
  { key: 'explorer', min: 0 },
  { key: 'builder', min: 250 },
  { key: 'achiever', min: 750 },
  { key: 'ambassador', min: 1500 },
];

const MENTOR_TIERS = [
  { key: 'supporter', min: 0 },
  { key: 'guide', min: 300 },
  { key: 'champion', min: 900 },
  { key: 'pillar', min: 2000 },
  { key: 'nation_builder', min: 4000 },
];

// KPI targets. `dir` = whether higher or lower is better.
const KPI_TARGETS = {
  mentor: {
    sessions_per_month: { target: 2, dir: 'up', unit: 'perMonth' },
    response_hours: { target: 48, dir: 'down', unit: 'hours' },
    ack_rate: { target: 0.9, dir: 'up', unit: 'pct' },
    satisfaction: { target: 4.2, dir: 'up', unit: 'outOf5' },
    mentee_progress: { target: 0.6, dir: 'up', unit: 'pct' },
    outcomes: { target: 1, dir: 'up', unit: 'count' },
  },
  student: {
    attendance: { target: 0.9, dir: 'up', unit: 'pct' },
    checkins_on_time: { target: 0.85, dir: 'up', unit: 'pct' },
    actions_on_time: { target: 0.8, dir: 'up', unit: 'pct' },
    kr_progress: { target: 0.6, dir: 'up', unit: 'pct' },
    engagement: { target: 4, dir: 'up', unit: 'outOf5' },
    outcomes: { target: 1, dir: 'up', unit: 'count' },
  },
};

// Relationship health score weights (sum = 1). Missing signals are dropped and
// the remaining weights re-normalised.
const HEALTH_WEIGHTS = {
  cadence: 0.25,
  goals: 0.2,
  satisfaction: 0.15,
  checkins: 0.15,
  responsiveness: 0.1,
  actions: 0.15,
};

const HEALTH_BANDS = [
  { key: 'thriving', min: 75, status: 'good', icon: '●' },
  { key: 'steady', min: 55, status: 'warning', icon: '◐' },
  { key: 'at_risk', min: 35, status: 'serious', icon: '▲' },
  { key: 'critical', min: 0, status: 'critical', icon: '✕' },
];

// Incentive gates — rewards unlock by keeping the relationship healthy.
const GATES = {
  opportunityMinHealth: 55,
  endorsementMinDays: 90,
  endorsementMinAttendance: 0.8,
  talentPoolTier: 'champion',
  autoApproveStudentPotential: 65,
};

module.exports = {
  FIELDS, ASPIRATIONS, LANGUAGES, MODES, GOAL_CATEGORIES, OUTCOME_TYPES,
  OPPORTUNITY_TYPES, PACT, POINTS, STUDENT_LEVELS, MENTOR_TIERS, KPI_TARGETS,
  HEALTH_WEIGHTS, HEALTH_BANDS, GATES,
  AUTO_APPROVE: process.env.AUTO_APPROVE !== '0',
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || 'data/mouhandis.db',
};
