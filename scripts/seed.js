'use strict';
// Demo data: fictional mentors, students and mentorships at different stages
// and health levels so every KPI, nudge and incentive is visible.
//   npm run seed            (wipes and re-creates the database at DB_PATH)
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { potentialScore } = require('../src/services/potential');
const { award, awardPair } = require('../src/services/points');
const C = require('../src/config');
const { iso, addDays, dateOnly, HOUR } = require('../src/util');

function seed(db, now = new Date()) {
  // Deterministic PRNG so the demo looks the same every time.
  let s = 42;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const PW = hashPassword('mouhandis2026');
  const ago = (d) => addDays(now, -d);

  const user = (u) => db.insert(
    `INSERT INTO users (email, password_hash, role, name, country, city, headline, bio, languages, tz_offset, status, created_at, last_active_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    u.email, PW, u.role, u.name, u.country || '', u.city || '', u.headline || '', u.bio || '', u.languages || 'ar,fr,en',
    u.tz ?? 1, u.status || 'approved', iso(u.created || ago(400)), iso(ago(rnd() * 3)),
  );

  user({ email: 'admin@demo.mouhandis.org', role: 'admin', name: 'Program Team', country: 'Tunisia', created: ago(500) });

  // ---- Mentors (fictional) ---------------------------------------------
  const mentors = [
    ['karim.mentor', 'Karim Ben Salah', 'Germany', 'Munich', 1, 'Staff Embedded Engineer', 'Bosch', 14, 'embedded,electrical,software', 'industry_job,internship,skills', 'mentoring,coaching', 3, 6, 'Embedded systems lead helping students break into automotive.'],
    ['leila.mentor', 'Leila Haddad', 'France', 'Toulouse', 1, 'Propulsion Engineer', 'Airbus', 11, 'aerospace,mechanical,energy', 'industry_job,study_abroad,internship', 'mentoring', 2, 4, 'From ENIT to Airbus — happy to show you the path.'],
    ['youssef.mentor', 'Youssef Trabelsi', 'Canada', 'Montréal', -5, 'Research Scientist (ML)', 'Mila', 9, 'ai_data,software', 'phd_research,study_abroad,skills', 'mentoring,coaching', 2, 4, 'ML researcher; I help students publish and apply to grad school.'],
    ['sana.mentor', 'Sana Gharbi', 'United States', 'Seattle', -8, 'Senior Software Engineer', 'Microsoft', 12, 'software,ai_data,telecom', 'industry_job,internship,skills', 'coaching', 2, 4, 'Interview prep, system design and landing your first big-tech internship.'],
    ['mehdi.mentor', 'Mehdi Jlassi', 'Qatar', 'Doha', 3, 'Structural Engineering Manager', 'Arup', 16, 'civil,industrial', 'industry_job,startup', 'mentoring', 1, 2, 'Big infrastructure projects and engineering leadership.'],
    ['amel.mentor', 'Amel Chaabane', 'Netherlands', 'Eindhoven', 1, 'Process Engineer', 'ASML', 8, 'chemical,industrial,mechanical', 'industry_job,internship', 'mentoring,coaching', 2, 4, 'Semiconductor manufacturing, lean and quality engineering.'],
    ['omar.mentor', 'Omar Mansouri', 'United Kingdom', 'Cambridge', 0, 'Biomedical Device Lead', 'Cambridge Consultants', 10, 'biomedical,electrical,embedded', 'phd_research,startup,study_abroad', 'mentoring', 2, 2, 'Medical devices, from research to regulatory approval.'],
    ['nour.mentor', 'Nour Ayari', 'Sweden', 'Stockholm', 1, 'Energy Systems Engineer', 'Vattenfall', 7, 'energy,electrical', 'industry_job,phd_research,skills', 'coaching', 2, 4, 'Grid integration of renewables and energy storage.'],
    ['hatem.mentor', 'Hatem Riahi', 'United Arab Emirates', 'Dubai', 4, 'Founder & CTO', 'Fleetlytics', 15, 'software,startup,ai_data', 'startup,industry_job', 'mentoring,coaching', 3, 8, 'Built and sold two startups; I coach student founders.'],
    ['rim.mentor', 'Rim Bouzid', 'Japan', 'Tokyo', 9, 'Robotics Engineer', 'Preferred Networks', 6, 'embedded,ai_data,mechanical', 'internship,study_abroad,skills', 'coaching', 1, 2, 'Robotics and computer vision, MEXT scholarship alumna.'],
  ];
  const M = {};
  for (const [h, name, country, city, tz, title, company, years, expertise, offers, modes, cap, hrs, headline] of mentors) {
    const id = user({ email: `${h}@demo.mouhandis.org`, role: 'mentor', name, country, city, tz, headline, languages: pick(['ar,fr,en', 'ar,fr,en,de', 'ar,en', 'fr,en,ar']), created: ago(380 + rnd() * 60) });
    db.run(`INSERT INTO mentor_profiles (user_id, company, job_title, years_experience, expertise, offers, modes, capacity, hours_per_month, linkedin_url)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, id, company, title, years, expertise.split(',').filter((x) => C.FIELDS.includes(x)).join(','), offers, modes, cap, hrs, '');
    M[h] = id;
  }

  // ---- Students (fictional) --------------------------------------------
  const unis = ['ENIT', 'INSAT', 'ENSI', 'ENIS', 'ENIM', 'SUP\'COM', 'ENSIT', 'ENIG'];
  const students = [
    ['amina.student', 'Amina Ferchichi', 'Tunis', 'embedded,electrical', 'internship,industry_job', 'mentoring', 16.2, 'C, STM32, FreeRTOS, KiCad, Python', 'Land an embedded internship in Germany and contribute to an automotive project.'],
    ['bilel.student', 'Bilel Hamdi', 'Sfax', 'aerospace,mechanical', 'study_abroad,internship', 'mentoring', 15.4, 'CATIA, ANSYS, MATLAB', 'Get admitted to a double-degree program in France.'],
    ['ines.student', 'Ines Kooli', 'Tunis', 'ai_data,software', 'phd_research,study_abroad', 'coaching', 17.1, 'Python, PyTorch, LaTeX, SQL', 'Publish my first paper and apply to a funded PhD.'],
    ['ahmed.student', 'Ahmed Zouari', 'Sousse', 'software,telecom', 'industry_job,internship,skills', 'coaching', 14.8, 'Java, React, Docker, algorithms', 'Pass big-tech interviews and secure a summer internship.'],
    ['mariem.student', 'Mariem Dridi', 'Monastir', 'chemical,industrial', 'industry_job,internship', 'mentoring', 15.9, 'Aspen, Six Sigma, Minitab', 'Build a career in semiconductor manufacturing.'],
    ['skander.student', 'Skander Belhaj', 'Bizerte', 'civil,industrial', 'industry_job,startup', 'mentoring', 14.2, 'Robot Structural, Revit, BIM', 'Join a major infrastructure project in the Gulf.'],
    ['yasmine.student', 'Yasmine Toumi', 'Tunis', 'biomedical,electrical', 'phd_research,startup', 'mentoring', 16.7, 'Signal processing, Arduino, MATLAB', 'Prototype a low-cost ECG device and win a competition.'],
    ['fares.student', 'Fares Saidi', 'Gabès', 'energy,electrical', 'skills,industry_job', 'coaching', 15.1, 'PVsyst, Python, power systems', 'Specialise in solar grid integration.'],
    ['hiba.student', 'Hiba Mabrouk', 'Ariana', 'software,ai_data', 'startup,skills', 'coaching', 16.0, 'Flutter, Firebase, product design', 'Launch my agri-tech startup MVP.'],
    ['walid.student', 'Walid Sassi', 'Kairouan', 'embedded,mechanical', 'internship,study_abroad', 'coaching', 15.6, 'ROS, C++, OpenCV', 'Win a robotics competition and apply for MEXT.'],
    ['rania.student', 'Rania Jaziri', 'Nabeul', 'software,ai_data', 'industry_job,internship', 'mentoring', 16.4, 'Python, scikit-learn, FastAPI', 'Get a data-engineering internship.'],
    ['oussama.student', 'Oussama Khelifi', 'Tunis', 'electrical,energy', 'phd_research,study_abroad', 'mentoring', 17.4, 'MATLAB, Simulink, power electronics', 'Research on battery management systems abroad.'],
    ['salma.student', 'Salma Rebai', 'Sfax', 'civil,energy', 'study_abroad,skills', 'mentoring', 15.0, 'AutoCAD, Python, GIS', 'Master in sustainable cities in Europe.'],
  ];
  const S = {};
  for (const [h, name, city, interests, aspirations, mode, gpa, skills, goals] of students) {
    const id = user({ email: `${h}@demo.mouhandis.org`, role: 'student', name, country: 'Tunisia', city, tz: 1, headline: `Engineering student · ${interests.split(',').map((x) => x.replace('_', ' ')).join(' & ')}`, created: ago(390 + rnd() * 30) });
    const p = {
      university: pick(unis), degree: 'engineering', year: 1 + Math.floor(rnd() * 3), gpa, gpa_scale: 20, interests, aspirations, skills, goals,
      motivation: 'I come from a family where nobody worked in engineering abroad. I want guidance from someone who walked the path so I can make the right choices early, build real projects and open doors for my younger siblings and classmates. I am disciplined and I want to be held accountable to clear goals.',
      achievements: 'Finalist at a national hackathon; built an open-source project used by my university club; tutor for first-year students; summer project at a local company.',
      portfolio_url: `https://github.com/${h.split('.')[0]}-demo`, preferred_mode: mode,
    };
    p.potential_score = potentialScore(p);
    db.run(`INSERT INTO student_profiles (user_id, university, degree, year, gpa, gpa_scale, interests, aspirations, skills, goals, motivation, achievements, portfolio_url, preferred_mode, potential_score)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, p.university, p.degree, p.year, p.gpa, p.gpa_scale, p.interests, p.aspirations, p.skills, p.goals, p.motivation, p.achievements, p.portfolio_url, p.preferred_mode, p.potential_score);
    S[h] = id;
  }
  // Pending application for the review queue.
  const pend = user({ email: 'new.applicant@demo.mouhandis.org', role: 'student', name: 'Nadia Hammami', country: 'Tunisia', city: 'Mahdia', status: 'pending', created: ago(2) });
  db.run(`INSERT INTO student_profiles (user_id, university, interests, aspirations, gpa, motivation, potential_score) VALUES (?,?,?,?,?,?,?)`,
    pend, 'ENIM', 'mechanical', 'internship', 12.5, 'I would like to learn more about mechanical design.', 38);

  // ---- Mentorships -----------------------------------------------------
  // quality drives every behaviour; dormantAfter stops sessions N days ago.
  const pairs = [
    { s: 'amina.student', m: 'karim.mentor', days: 240, q: 0.95, outcomes: [['internship', 'Summer internship at Bosch Car Multimedia', 40], ['competition', '2nd place, national embedded systems challenge', 120]], endorse: true },
    { s: 'ines.student', m: 'youssef.mentor', days: 200, q: 0.9, outcomes: [['publication', 'Workshop paper accepted at an ML conference', 30]], endorse: true },
    { s: 'ahmed.student', m: 'sana.mentor', days: 150, q: 0.75, outcomes: [['certification', 'AWS Cloud Practitioner', 50]] },
    { s: 'bilel.student', m: 'leila.mentor', days: 120, q: 0.62 },
    { s: 'mariem.student', m: 'amel.mentor', days: 95, q: 0.45 },
    { s: 'skander.student', m: 'mehdi.mentor', days: 110, q: 0.6, dormantAfter: 45 },
    { s: 'yasmine.student', m: 'omar.mentor', days: 380, q: 0.92, completed: 20, outcomes: [['competition', 'Winner, regional biomedical innovation award', 200], ['admission', 'Admitted to a funded MSc in biomedical engineering', 60]], endorse: true },
    { s: 'hiba.student', m: 'hatem.mentor', days: 60, q: 0.85, outcomes: [['startup', 'MVP launched with 120 farmer sign-ups', 10]] },
    { s: 'walid.student', m: 'rim.mentor', days: 8, q: 0.8 },
  ];

  const topics = ['Goal setting & roadmap', 'CV and LinkedIn review', 'Project deep-dive', 'Mock technical interview', 'Research paper reading', 'Career paths abroad', 'Portfolio review', 'Application strategy', 'Technical design review', 'Scholarship essays'];

  for (const p of pairs) {
    const sid = S[p.s];
    const mid = M[p.m];
    const ms = { student_id: sid, mentor_id: mid };
    const start = ago(p.days);
    const end = p.completed ? ago(p.completed) : now;
    const status = p.completed ? 'completed' : 'active';
    const msId = db.insert(`INSERT INTO mentorships (student_id, mentor_id, mode, status, started_at, ends_at, sessions_per_month, checkin_interval_days, pact_student_at, pact_mentor_at, closed_at, closed_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, sid, mid, db.get('SELECT preferred_mode m FROM student_profiles WHERE user_id = ?', sid).m, status,
      iso(start), iso(addDays(start, 365)), 2, 14, iso(addDays(start, 1)), iso(addDays(start, 2)), p.completed ? iso(end) : null, p.completed ? 'Completed the full 12-month journey.' : '');
    ms.id = msId;
    db.insert("INSERT INTO match_requests (student_id, mentor_id, initiated_by, message, score, status, created_at, responded_at) VALUES (?,?,?,?,?,?,?,?)",
      sid, mid, rnd() > 0.5 ? 'student' : 'mentor', 'Would love to work together!', 70 + Math.floor(rnd() * 25), 'accepted', iso(addDays(start, -3)), iso(addDays(start, -3 + rnd() * 2)));
    awardPair(db, ms, 'pact_signed', msId, iso(addDays(start, 2)));

    const lastActive = p.dormantAfter ? ago(p.dormantAfter) : end;

    // Sessions
    let t = addDays(start, 3);
    let i = 0;
    while (t < lastActive) {
      const held = rnd() < 0.55 + p.q * 0.45;
      const missed = !held && rnd() < 0.5;
      const status = held ? 'completed' : missed ? 'missed' : 'cancelled';
      const sr = held ? Math.min(5, Math.max(2, Math.round(3 + p.q * 2 - rnd() * 0.8))) : null;
      const mr = held ? Math.min(5, Math.max(2, Math.round(2.6 + p.q * 2.4 - rnd() * 0.8))) : null;
      const sessId = db.insert(`INSERT INTO sessions (mentorship_id, scheduled_at, duration_min, topic, status, notes, student_attended, completed_at, student_rating, mentor_rating, student_feedback, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, msId, iso(t), 45 + Math.floor(rnd() * 4) * 15, topics[i % topics.length], status,
        held ? 'Reviewed progress, agreed next steps.' : '', held ? 1 : missed ? 0 : null, held ? iso(addDays(t, 0.05)) : null, sr, mr, sr >= 5 ? 'Super helpful, very concrete advice.' : '', mid, iso(addDays(t, -5)));
      if (held) {
        awardPair(db, ms, 'session_completed', sessId, iso(t));
        award(db, { id: sid, role: 'student' }, 'session_rated', sessId, iso(t));
        award(db, { id: mid, role: 'mentor' }, 'session_rated', sessId, iso(t));
      }
      i++;
      t = addDays(t, 30 / (2 * Math.max(0.35, p.q)) * (0.8 + rnd() * 0.4));
    }
    // One upcoming session for healthy active pairs.
    if (status === 'active' && !p.dormantAfter && p.q > 0.55) {
      db.insert('INSERT INTO sessions (mentorship_id, scheduled_at, duration_min, topic, agenda, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
        msId, iso(addDays(now, 2 + rnd() * 6)), 60, topics[(i + 1) % topics.length], '1) Wins since last time 2) Blockers 3) Plan for next two weeks', mid, iso(ago(1)));
    }

    // Check-ins (one per period, skipped / late depending on quality)
    for (let d = addDays(start, 14); d <= end; d = addDays(d, 14)) {
      if (rnd() > 0.35 + p.q * 0.65) continue;
      if (p.dormantAfter && d > lastActive && rnd() > 0.2) continue;
      const late = rnd() > p.q;
      const sub = late ? addDays(d, 1 + rnd() * 3) : addDays(d, -(rnd() * 4));
      const due = iso(d);
      const ackH = 4 + (1 - p.q) * 140 * rnd();
      const ackAt = new Date(sub.getTime() + ackH * HOUR);
      const acked = ackAt < now && rnd() < 0.4 + p.q * 0.6;
      const cid = db.insert(`INSERT INTO checkins (mentorship_id, due_at, submitted_at, wins, blockers, next_steps, mood, mentor_reply, acked_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        msId, due, iso(sub), pick(['Finished the PCB layout and ordered parts.', 'Submitted 4 applications.', 'Completed the online course module.', 'Drafted the paper introduction.', 'Shipped a new feature to the prototype.']),
        pick(['', 'Struggling to find time with exams.', 'Not sure which offer to prioritise.']), pick(['Prepare questions for next session.', 'Iterate on feedback and resubmit.', 'Start the next milestone.']),
        Math.min(5, Math.max(1, Math.round(2 + p.q * 3 - rnd()))), acked ? pick(['Great progress — keep the momentum!', 'Good work. Let’s tackle the blocker in our next call.', 'Proud of you. Next: focus on one thing at a time.']) : '', acked ? iso(ackAt) : null);
      award(db, { id: sid, role: 'student' }, late ? 'checkin_late' : 'checkin_on_time', due, iso(sub));
      if (acked && ackH <= C.PACT.ackHours) award(db, { id: mid, role: 'mentor' }, 'checkin_ack_fast', cid, iso(ackAt));
    }

    // Messages: alternating, response time grows as quality drops.
    let mt = addDays(start, 1);
    let sender = sid;
    while (mt < lastActive) {
      db.insert('INSERT INTO messages (mentorship_id, sender_id, body, created_at) VALUES (?,?,?,?)', msId, sender,
        sender === sid ? pick(['Hi! I pushed the update, could you take a look?', 'Thank you for the session, the advice on my CV was gold.', 'I have an interview next week — any tips?', 'Quick question about the roadmap we discussed.'])
          : pick(['Nice work! Let’s go through it on Thursday.', 'Happy to help. Send me the job description.', 'Great question — short answer: focus on fundamentals first.', 'I’ll introduce you to a colleague on the team.']), iso(mt));
      sender = sender === sid ? mid : sid;
      mt = new Date(mt.getTime() + (2 + (1 - p.q) * 90 * rnd() + rnd() * 20) * HOUR);
      if (rnd() < 0.15) mt = addDays(mt, 3 + rnd() * 5);
    }
    if (p.q < 0.6 && status === 'active') {
      db.insert('INSERT INTO messages (mentorship_id, sender_id, body, created_at) VALUES (?,?,?,?)', msId, sid, 'Hi, are we still on for this month? I have a few questions.', iso(ago(4)));
    }

    // Goals & key results
    const elapsed = Math.min(1, p.days / 365);
    const goalDefs = [
      ['career', 'Secure a relevant internship', [['Applications sent', 10, 'applications'], ['Interviews passed', 2, 'interviews']]],
      ['technical', 'Build a portfolio-grade project', [['Milestones shipped', 4, 'milestones'], ['Code reviews with mentor', 3, 'reviews']]],
      ['academic', 'Raise my average and prepare for applications', [['Average (/20)', 16, 'pts'], ['Recommendation letters', 2, 'letters']]],
    ];
    if (p.days > 20) {
      for (const [cat, title, krs] of goalDefs.slice(0, p.q > 0.7 ? 3 : 2)) {
        const prog = Math.min(1, p.q * (0.4 + elapsed * 1.2) * (0.7 + rnd() * 0.5));
        const done = prog >= 0.98 && rnd() < 0.7;
        const gid = db.insert('INSERT INTO goals (mentorship_id, title, category, due_date, status, created_at, done_at) VALUES (?,?,?,?,?,?,?)',
          msId, title, cat, dateOnly(addDays(start, 300)), done ? 'done' : 'active', iso(addDays(start, 7)), done ? iso(addDays(start, p.days * 0.8)) : null);
        for (const [kt, target, unit] of krs) {
          const cur = Math.round(target * Math.min(1, prog * (0.8 + rnd() * 0.4)) * 10) / 10;
          const krId = db.insert('INSERT INTO key_results (goal_id, title, target, current, unit, updated_at) VALUES (?,?,?,?,?,?)', gid, kt, target, cur, unit, iso(ago(rnd() * 20)));
          if (cur >= target) awardPair(db, ms, 'key_result_reached', krId, iso(ago(rnd() * p.days * 0.5)));
        }
        if (done) awardPair(db, ms, 'goal_done', gid, iso(addDays(start, p.days * 0.8)));
      }
    }

    // Action items
    for (let a = 0; a < Math.min(8, Math.floor(p.days / 15)); a++) {
      const due = addDays(start, 14 + a * 15);
      if (due > addDays(now, 14)) break;
      const owner = rnd() < 0.75 ? 'student' : 'mentor';
      const doneOn = rnd() < p.q ? addDays(due, -rnd() * 3) : rnd() < 0.5 ? addDays(due, 2 + rnd() * 4) : null;
      const doneAt = doneOn && doneOn < now ? iso(doneOn) : null;
      const aid = db.insert('INSERT INTO action_items (mentorship_id, title, owner, due_date, done_at, created_at) VALUES (?,?,?,?,?,?)', msId,
        pick(['Update CV with latest project', 'Share 3 target companies', 'Read the paper and summarise', 'Send intro email to contact', 'Finish online course module', 'Draft motivation letter']),
        owner, dateOnly(due), doneAt, iso(addDays(due, -10)));
      if (doneAt && doneAt.slice(0, 10) <= dateOnly(due)) award(db, { id: owner === 'student' ? sid : mid, role: owner }, 'action_done_on_time', aid, doneAt);
    }

    // Outcomes
    for (const [type, title, daysAgo] of p.outcomes || []) {
      const at = ago(daysAgo);
      const oid = db.insert('INSERT INTO outcomes (mentorship_id, type, title, achieved_on, verified_at, created_at) VALUES (?,?,?,?,?,?)', msId, type, title, dateOnly(at), iso(addDays(at, 1)), iso(at));
      awardPair(db, ms, 'outcome_verified', oid, iso(addDays(at, 1)));
    }
    if (p.s === 'ahmed.student') {
      db.insert('INSERT INTO outcomes (mentorship_id, type, title, description, achieved_on, created_at) VALUES (?,?,?,?,?,?)', msId, 'project', 'Open-sourced a distributed cache library', '200+ GitHub stars.', dateOnly(ago(3)), iso(ago(3)));
    }
    if (p.endorse) {
      db.insert('INSERT INTO endorsements (mentorship_id, body, skills, created_at) VALUES (?,?,?,?)', msId,
        'One of the most driven students I have worked with. Consistently prepared, ships fast and takes feedback seriously. I recommend them without reservation.',
        db.get('SELECT interests FROM student_profiles WHERE user_id = ?', sid).interests, iso(ago(30)));
      awardPair(db, ms, 'endorsement_written', msId, iso(ago(30)));
    }
    if (p.completed) awardPair(db, ms, 'mentorship_completed', msId, iso(end));
  }

  // Students join shortly before they are matched; unmatched ones joined recently.
  for (const st of Object.values(S)) {
    const m = db.get('SELECT MIN(started_at) t FROM mentorships WHERE student_id = ?', st);
    const joined = m.t ? addDays(m.t, -(6 + rnd() * 20)) : ago(5 + rnd() * 30);
    db.run('UPDATE users SET created_at = ? WHERE id = ?', iso(joined), st);
  }

  // A pending request and a pending sponsorship offer.
  db.insert("INSERT INTO match_requests (student_id, mentor_id, initiated_by, message, score, created_at) VALUES (?,?,'student',?,?,?)",
    S['rania.student'], M['karim.mentor'], 'Your path from Tunisia to Bosch inspires me. I would love your guidance on data engineering in the automotive industry.', 71, iso(ago(1)));
  db.insert("INSERT INTO match_requests (student_id, mentor_id, initiated_by, message, score, created_at) VALUES (?,?,'mentor',?,?,?)",
    S['oussama.student'], M['nour.mentor'], 'Your BMS interest fits my work on storage. Let’s aim for a research internship in Sweden.', 84, iso(ago(2)));

  // Opportunities
  const opps = [
    [M['karim.mentor'], 'internship', 'Embedded software intern (6 months)', 'Bosch', 'Stuttgart, DE', 'Work on automotive ECU software. C/C++ and RTOS experience appreciated.', 2, 45],
    [M['sana.mentor'], 'referral', 'Referral for SWE internship 2027', 'Microsoft', 'Remote / Dublin', 'I will refer 2 students who complete the interview prep track.', 1, 30],
    [M['youssef.mentor'], 'research', 'Summer research assistant, ML for health', 'Mila', 'Montréal (remote first)', 'Assist on a dataset curation and benchmarking project.', 3, 60],
    [M['hatem.mentor'], 'project', 'Paid freelance: fleet analytics dashboard', 'Fleetlytics', 'Remote', 'A 6-week project for a student founder or builder.', 1, 20],
    [M['nour.mentor'], 'scholarship', 'Swedish Institute scholarship — application coaching', 'Vattenfall alumni network', 'Stockholm', 'Coaching for 3 students applying to SI scholarships.', 2, 75],
  ];
  for (const [by, type, title, org, loc, desc, lvl, dl] of opps) {
    const oid = db.insert('INSERT INTO opportunities (posted_by, type, title, organization, location, description, min_level, deadline, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      by, type, title, org, loc, desc, lvl, dateOnly(addDays(now, dl)), iso(ago(10 + rnd() * 20)));
    award(db, { id: by, role: 'mentor' }, 'opportunity_posted', oid, iso(ago(10)));
  }
  db.insert("INSERT INTO applications (opportunity_id, student_id, note, status, created_at) VALUES (1, ?, ?, 'shortlisted', ?)", S['amina.student'], 'I completed an STM32 project with FreeRTOS and would love to apply it at scale.', iso(ago(5)));

  db.insert("INSERT INTO notifications (user_id, body, link, created_at) VALUES (?,?,?,?)", M['karim.mentor'], JSON.stringify({ key: 'notif.request_in', params: { name: 'Rania Jaziri' } }), '/requests', iso(ago(1)));
}

if (require.main === module) {
  const file = C.DB_PATH;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = openDb(file);
  db.tx(() => seed(db));
  const n = (sql) => db.get(sql).n;
  console.log(`Seeded ${file}: ${n("SELECT COUNT(*) n FROM users WHERE role='mentor'")} mentors, ${n("SELECT COUNT(*) n FROM users WHERE role='student'")} students, ${n('SELECT COUNT(*) n FROM mentorships')} mentorships, ${n("SELECT COUNT(*) n FROM sessions WHERE status='completed'")} sessions.`);
  console.log('Log in with e.g. amina.student@demo.mouhandis.org / karim.mentor@demo.mouhandis.org / admin@demo.mouhandis.org — password: mouhandis2026');
  db.close();
}

module.exports = { seed };
