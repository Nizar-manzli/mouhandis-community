'use strict';
const en = require('./en');
const ar = require('./ar');

const DICTS = { en, ar };
const LANGS = Object.keys(DICTS);

// Keys requested at runtime but missing from a dictionary (checked by tests).
const missing = new Set();

function translator(lang) {
  const dict = DICTS[lang] || en;
  return function t(key, params) {
    let s = dict[key];
    if (s === undefined) {
      missing.add(`${lang}:${key}`);
      s = en[key];
      if (s === undefined) return key;
    }
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    return s;
  };
}

module.exports = { translator, LANGS, DICTS, missing };
