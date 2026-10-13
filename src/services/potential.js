'use strict';
const { tags, clamp } = require('../util');

// High-potential screening score (0-100). Transparent heuristic used to rank the
// talent pool and to auto-approve strong applications; admins can still review.
function potentialScore(p) {
  const gpaNorm = p.gpa_scale > 0 ? clamp(p.gpa / p.gpa_scale) : 0;
  // On a /20 scale 10 is a pass and 16+ is excellent: map [0.5, 0.8] -> [0, 1].
  const academic = clamp((gpaNorm - 0.5) / 0.3) * 35;

  const achievementsLen = String(p.achievements || '').trim().length;
  const evidence = (p.portfolio_url ? 8 : 0) + clamp(achievementsLen / 400) * 12;

  const motivationLen = String(p.motivation || '').trim().length;
  const motivation = clamp(motivationLen / 600) * 20;

  const skills = clamp(tags(p.skills).length / 6) * 15;

  const fields = [p.university, p.degree, p.interests, p.aspirations, p.goals];
  const completeness = (fields.filter((f) => String(f || '').trim()).length / fields.length) * 10;

  return Math.round(academic + evidence + motivation + skills + completeness);
}

module.exports = { potentialScore };
