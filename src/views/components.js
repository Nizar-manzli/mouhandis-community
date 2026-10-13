'use strict';
const { html, round, tags } = require('../util');
const { standing } = require('../services/points');

// Format a KPI value according to its unit.
function fmt(t, value, unit) {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'pct': return `${Math.round(value * 100)}%`;
    case 'hours': return value < 1 ? t('unit.lt1h') : t('unit.hours', { n: Math.round(value) });
    case 'outOf5': return `${round(value, 1)}/5`;
    case 'perMonth': return t('unit.per_month', { n: round(value, 1) });
    case 'count': return String(round(value, 1));
    default: return String(value);
  }
}

// Health badge: status color always paired with an icon + a label.
function healthBadge(t, health) {
  if (!health || health.score === null) {
    return html`<span class="badge status-new"><span aria-hidden="true">○</span> ${t('health.new')}</span>`;
  }
  const b = health.band;
  return html`<span class="badge status-${b.status}"><span aria-hidden="true">${b.icon}</span> ${t(`band.${b.key}`)} · ${health.score}</span>`;
}

// Big ring gauge for a health score (SVG, theme-aware via CSS vars).
function healthRing(t, health) {
  const score = health && health.score !== null ? health.score : null;
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = score === null ? 0 : (score / 100) * c;
  const status = score === null ? 'new' : health.band.status;
  return html`<figure class="ring status-${status}">
    <svg viewBox="0 0 120 120" role="img" aria-label="${t('health.title')}: ${score === null ? t('health.new') : score}">
      <circle cx="60" cy="60" r="${r}" class="ring-track"/>
      <circle cx="60" cy="60" r="${r}" class="ring-value" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
    </svg>
    <figcaption><strong>${score === null ? '—' : score}</strong><span>${score === null ? t('health.new') : t(`band.${health.band.key}`)}</span></figcaption>
  </figure>`;
}

// A meter: thin bar with a target tick. value/target normalised by caller.
function meter(fraction, targetFraction, status) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return html`<span class="meter status-${status}" role="presentation">
    <span class="meter-fill" style="width:${pct.toFixed(1)}%"></span>
    ${targetFraction !== null && targetFraction !== undefined ? html`<span class="meter-target" style="inset-inline-start:${(Math.min(1, targetFraction) * 100).toFixed(1)}%"></span>` : ''}
  </span>`;
}

// Scorecard table: KPI, value vs target, met / not met.
function scorecard(t, role, items) {
  return html`<table class="scorecard">
    <thead><tr><th>${t('kpi.metric')}</th><th>${t('kpi.you')}</th><th>${t('kpi.target')}</th><th>${t('kpi.status')}</th></tr></thead>
    <tbody>
    ${items.map((it) => {
      const status = it.met === null ? 'new' : it.met ? 'good' : 'serious';
      const label = it.met === null ? t('kpi.no_data') : it.met ? t('kpi.met') : t('kpi.below');
      const icon = it.met === null ? '○' : it.met ? '✓' : '▲';
      let frac = null;
      let tgt = null;
      if (it.value !== null && it.value !== undefined) {
        if (it.dir === 'up') {
          const max = it.unit === 'pct' ? 1 : it.unit === 'outOf5' ? 5 : Math.max(it.target * 1.5, it.value);
          frac = it.value / max; tgt = it.target / max;
        } else {
          const max = it.target * 2;
          frac = 1 - Math.min(it.value, max) / max; tgt = 0.5;
        }
      }
      return html`<tr>
        <th scope="row"><span class="kpi-name">${t(`kpi.${role}.${it.key}`)}</span><span class="kpi-help">${t(`kpi.${role}.${it.key}.help`)}</span></th>
        <td class="num">${fmt(t, it.value, it.unit)} ${frac !== null ? meter(frac, tgt, status) : ''}</td>
        <td class="num muted">${it.dir === 'down' ? '≤ ' : '≥ '}${fmt(t, it.target, it.unit)}</td>
        <td><span class="badge status-${status}"><span aria-hidden="true">${icon}</span> ${label}</span></td>
      </tr>`;
    })}
    </tbody>
  </table>`;
}

function statTile(label, value, sub) {
  return html`<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function levelCard(t, user) {
  const s = standing(user.role, user.points);
  const ladder = user.role === 'mentor' ? 'tier' : 'level';
  return html`<div class="card level-card">
    <div class="level-head">
      <span class="level-chip">${t(`${ladder}.${s.key}`)}</span>
      <span class="muted">${t('points.total', { n: user.points })}</span>
    </div>
    ${meter(s.progress, null, 'brand')}
    <p class="small muted">${s.next
      ? t('points.to_next', { n: s.next.min - user.points, name: t(`${ladder}.${s.next.key}`) })
      : t('points.top')}</p>
    <p class="small">${t(`${ladder}.${s.key}.perk`)}</p>
  </div>`;
}

const tagList = (t, csv, prefix) => html`<span class="tags">${tags(csv).map((x) => html`<span class="tag">${t(`${prefix}.${x}`)}</span>`)}</span>`;

const checkboxes = (t, name, options, selected, prefix) => {
  const sel = tags(selected);
  return html`<div class="checks">${options.map((o) => html`<label class="check"><input type="checkbox" name="${name}" value="${o}" ${sel.includes(o) ? 'checked' : ''}> ${t(`${prefix}.${o}`)}</label>`)}</div>`;
};

const select = (t, name, options, value, prefix) =>
  html`<select name="${name}" id="${name}">${options.map((o) => html`<option value="${o}" ${String(o) === String(value) ? 'selected' : ''}>${prefix ? t(`${prefix}.${o}`) : o}</option>`)}</select>`;

const fmtDate = (ctx, d, withTime = false) => {
  if (!d) return '—';
  const opts = withTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeZone: 'UTC' };
  // Times are stored in UTC and shown in the viewer's own UTC offset.
  const shift = withTime && ctx.user ? ctx.user.tz_offset * 3600000 : 0;
  return new Intl.DateTimeFormat(ctx.lang === 'ar' ? 'ar-TN' : 'en-GB', opts).format(new Date(new Date(d).getTime() + shift));
};

// <input type="datetime-local"> value (viewer's offset) -> ISO UTC string.
const localToUtc = (ctx, local) => {
  const d = new Date(`${local}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - (ctx.user ? ctx.user.tz_offset : 0) * 3600000).toISOString();
};

const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

const empty = (text, cta) => html`<div class="empty"><p>${text}</p>${cta || ''}</div>`;

module.exports = { localToUtc, fmt, healthBadge, healthRing, meter, scorecard, statTile, levelCard, tagList, checkboxes, select, fmtDate, stars, empty };
