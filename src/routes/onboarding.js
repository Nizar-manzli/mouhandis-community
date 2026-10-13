'use strict';
const { html, toTags, clamp } = require('../util');
const { csrfField } = require('../views/layout');
const { checkboxes, select } = require('../views/components');
const { potentialScore } = require('../services/potential');
const { notify } = require('../services/notify');
const C = require('../config');
const { requireUser, str } = require('./guards');

const DEGREES = ['prep', 'bachelor', 'engineering', 'master', 'phd'];
const TZ = Array.from({ length: 27 }, (_, i) => i - 12);

function form(ctx, firstTime, errorKey) {
  const { t, user, db } = ctx;
  const isStudent = user.role === 'student';
  const p = db.get(`SELECT * FROM ${user.role}_profiles WHERE user_id = ?`, user.id) || {};
  const roleFields = isStudent ? html`
    <fieldset><legend>${t('onb.academic')}</legend>
      <div class="row">
        <label>${t('field.university')}<input name="university" required maxlength="120" value="${p.university}" placeholder="${t('ph.university')}"></label>
        <label>${t('field.degree')}${select(t, 'degree', DEGREES, p.degree || 'engineering', 'degree')}</label>
        <label>${t('field.year')}<input type="number" name="year" min="1" max="8" value="${p.year || 1}"></label>
      </div>
      <div class="row">
        <label>${t('field.gpa')}<input type="number" name="gpa" step="0.01" min="0" max="100" required value="${p.gpa || ''}"></label>
        <label>${t('field.gpa_scale')}${select(t, 'gpa_scale', [20, 4, 100], p.gpa_scale || 20)}</label>
      </div>
    </fieldset>
    <fieldset><legend>${t('onb.direction')}</legend>
      <p class="hint">${t('field.interests')}</p>${checkboxes(t, 'interests', C.FIELDS, p.interests, 'field')}
      <p class="hint">${t('field.aspirations')}</p>${checkboxes(t, 'aspirations', C.ASPIRATIONS, p.aspirations, 'asp')}
      <label>${t('field.preferred_mode')}${select(t, 'preferred_mode', C.MODES, p.preferred_mode, 'mode')}</label>
      <p class="hint small">${t('mode.explain')}</p>
    </fieldset>
    <fieldset><legend>${t('onb.evidence')}</legend>
      <label>${t('field.skills')}<input name="skills" maxlength="300" value="${p.skills}" placeholder="${t('ph.skills')}"></label>
      <label>${t('field.goals')}<textarea name="goals" rows="3" maxlength="1500" placeholder="${t('ph.goals')}">${p.goals}</textarea></label>
      <label>${t('field.motivation')}<textarea name="motivation" rows="5" maxlength="3000" placeholder="${t('ph.motivation')}">${p.motivation}</textarea></label>
      <label>${t('field.achievements')}<textarea name="achievements" rows="4" maxlength="3000" placeholder="${t('ph.achievements')}">${p.achievements}</textarea></label>
      <label>${t('field.portfolio')}<input type="url" name="portfolio_url" maxlength="300" value="${p.portfolio_url}" placeholder="https://github.com/…"></label>
      <label class="check"><input type="checkbox" name="open_to_opportunities" value="1" ${p.open_to_opportunities !== 0 ? 'checked' : ''}> ${t('field.open_to_opps')}</label>
    </fieldset>` : html`
    <fieldset><legend>${t('onb.career')}</legend>
      <div class="row">
        <label>${t('field.job_title')}<input name="job_title" required maxlength="120" value="${p.job_title}"></label>
        <label>${t('field.company')}<input name="company" required maxlength="120" value="${p.company}"></label>
        <label>${t('field.years')}<input type="number" name="years_experience" min="0" max="60" value="${p.years_experience || 5}"></label>
      </div>
      <label>${t('field.linkedin')}<input type="url" name="linkedin_url" maxlength="300" value="${p.linkedin_url}" placeholder="https://linkedin.com/in/…"></label>
      <p class="hint">${t('field.expertise')}</p>${checkboxes(t, 'expertise', C.FIELDS, p.expertise, 'field')}
      <p class="hint">${t('field.offers')}</p>${checkboxes(t, 'offers', C.ASPIRATIONS, p.offers, 'asp')}
    </fieldset>
    <fieldset><legend>${t('onb.commitment')}</legend>
      <p class="hint">${t('field.modes')}</p>${checkboxes(t, 'modes', C.MODES, p.modes, 'mode')}
      <p class="hint small">${t('mode.explain')}</p>
      <div class="row">
        <label>${t('field.capacity')}${select(t, 'capacity', [1, 2, 3], p.capacity || 1)}</label>
        <label>${t('field.hours')}${select(t, 'hours_per_month', [2, 4, 6, 8], p.hours_per_month || 2)}</label>
      </div>
      <p class="hint small">${t('onb.capacity_hint')}</p>
    </fieldset>`;

  return ctx.page({
    title: t(firstTime ? 'onb.title' : 'nav.edit_profile'),
    body: html`<header class="page-head">
        <h1>${t(firstTime ? `onb.title_${user.role}` : 'nav.edit_profile')}</h1>
        ${firstTime ? html`<p class="lead">${t(`onb.lead_${user.role}`)}</p>` : ''}
      </header>
      ${errorKey ? html`<p class="error" role="alert">${t(errorKey)}</p>` : ''}
      <form method="post" action="/profile" class="form card">
        ${csrfField(ctx)}
        <fieldset><legend>${t('onb.about')}</legend>
          <div class="row">
            <label>${t('field.name')}<input name="name" required maxlength="80" value="${user.name}"></label>
            <label>${t('field.headline')}<input name="headline" maxlength="140" value="${user.headline}" placeholder="${t(isStudent ? 'ph.headline_student' : 'ph.headline_mentor')}"></label>
          </div>
          <div class="row">
            <label>${t('field.country')}<input name="country" required maxlength="60" value="${user.country}"></label>
            <label>${t('field.city')}<input name="city" maxlength="60" value="${user.city}"></label>
            <label>${t('field.tz')}${select(t, 'tz_offset', TZ, user.tz_offset)}</label>
          </div>
          <p class="hint">${t('field.languages')}</p>${checkboxes(t, 'languages', C.LANGUAGES, user.languages, 'lang')}
          <label>${t('field.bio')}<textarea name="bio" rows="3" maxlength="1500">${user.bio}</textarea></label>
          <label class="check"><input type="checkbox" name="public_profile" value="1" ${user.public_profile ? 'checked' : ''}> ${t('field.public_profile')}</label>
        </fieldset>
        ${roleFields}
        <button class="btn btn-primary">${t(firstTime ? 'onb.submit' : 'common.save')}</button>
      </form>`,
  });
}

module.exports = (r, db) => {
  r.get('/onboarding', requireUser, (req, res, ctx) => {
    if (ctx.user.role === 'admin') return res.redirect('/admin');
    return form(ctx, ctx.user.status === 'incomplete');
  });
  r.get('/profile', requireUser, (req, res, ctx) => {
    if (ctx.user.role === 'admin') return res.redirect('/admin');
    return form(ctx, ctx.user.status === 'incomplete');
  });

  r.post('/profile', requireUser, (req, res, ctx) => {
    const { user, body: b } = ctx;
    if (user.role === 'admin') return res.redirect('/admin');
    const name = str(b.name, 80);
    const country = str(b.country, 60);
    if (!name || !country) return form(ctx, user.status === 'incomplete', 'onb.err_required');
    const languages = toTags(b.languages, C.LANGUAGES);
    if (!languages) return form(ctx, user.status === 'incomplete', 'onb.err_languages');

    let approve = false;
    db.tx(() => {
      db.run(`UPDATE users SET name=?, headline=?, country=?, city=?, tz_offset=?, languages=?, bio=?, public_profile=? WHERE id=?`,
        name, str(b.headline, 140), country, str(b.city, 60), clamp(Number(b.tz_offset) || 0, -12, 14),
        languages, str(b.bio, 1500), b.public_profile === '1' ? 1 : 0, user.id);

      if (user.role === 'student') {
        const scale = [20, 4, 100].includes(Number(b.gpa_scale)) ? Number(b.gpa_scale) : 20;
        const p = {
          university: str(b.university, 120),
          degree: DEGREES.includes(b.degree) ? b.degree : 'engineering',
          year: clamp(Number.parseInt(b.year, 10) || 1, 1, 8),
          gpa: clamp(Number(b.gpa) || 0, 0, scale),
          gpa_scale: scale,
          interests: toTags(b.interests, C.FIELDS),
          aspirations: toTags(b.aspirations, C.ASPIRATIONS),
          skills: toTags(str(b.skills, 300)),
          goals: str(b.goals, 1500),
          motivation: str(b.motivation, 3000),
          achievements: str(b.achievements, 3000),
          portfolio_url: /^https?:\/\//.test(str(b.portfolio_url)) ? str(b.portfolio_url, 300) : '',
          preferred_mode: C.MODES.includes(b.preferred_mode) ? b.preferred_mode : 'mentoring',
          open_to_opportunities: b.open_to_opportunities === '1' ? 1 : 0,
        };
        p.potential_score = potentialScore(p);
        db.run(`UPDATE student_profiles SET university=?, degree=?, year=?, gpa=?, gpa_scale=?, interests=?, aspirations=?, skills=?, goals=?,
          motivation=?, achievements=?, portfolio_url=?, preferred_mode=?, potential_score=?, open_to_opportunities=? WHERE user_id=?`,
          p.university, p.degree, p.year, p.gpa, p.gpa_scale, p.interests, p.aspirations, p.skills, p.goals, p.motivation,
          p.achievements, p.portfolio_url, p.preferred_mode, p.potential_score, p.open_to_opportunities, user.id);
        approve = p.potential_score >= C.GATES.autoApproveStudentPotential;
      } else {
        db.run(`UPDATE mentor_profiles SET company=?, job_title=?, years_experience=?, expertise=?, offers=?, modes=?, capacity=?, hours_per_month=?, linkedin_url=? WHERE user_id=?`,
          str(b.company, 120), str(b.job_title, 120), clamp(Number.parseInt(b.years_experience, 10) || 0, 0, 60),
          toTags(b.expertise, C.FIELDS), toTags(b.offers, C.ASPIRATIONS), toTags(b.modes, C.MODES) || 'mentoring',
          clamp(Number.parseInt(b.capacity, 10) || 1, 1, 3), [2, 4, 6, 8].includes(Number(b.hours_per_month)) ? Number(b.hours_per_month) : 2,
          /^https?:\/\//.test(str(b.linkedin_url)) ? str(b.linkedin_url, 300) : '', user.id);
        approve = C.AUTO_APPROVE;
      }

      if (user.status === 'incomplete' || user.status === 'pending') {
        const status = approve ? 'approved' : 'pending';
        db.run('UPDATE users SET status = ? WHERE id = ?', status, user.id);
        if (status === 'pending' && user.status === 'incomplete') {
          for (const a of db.all("SELECT id FROM users WHERE role='admin'")) notify(db, a.id, 'notif.new_application', { name }, '/admin');
        }
        ctx.setFlash(approve ? 'success' : 'info', approve ? 'flash.approved' : 'flash.pending_review');
      } else {
        ctx.setFlash('success', 'flash.saved');
      }
    });
    res.redirect('/dashboard');
  });
};
