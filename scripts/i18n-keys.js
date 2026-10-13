'use strict';
// Lists static i18n keys used in src/ (t('…')) — used by tests to verify that
// both dictionaries cover them.
const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

function staticKeys(root = path.join(__dirname, '..', 'src')) {
  const keys = new Set();
  const re = /\b(?:t|T|ctx\.t)\(\s*'([a-z0-9_.]+)'/g;
  const re2 = /(?:key|setFlash\([^,]+,|notify\(db, [^,]+,)\s*:?\s*'([a-z_]+\.[a-z0-9_.]+)'/g;
  for (const f of walk(root)) {
    if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) keys.add(m[1]);
    for (const m of src.matchAll(re2)) keys.add(m[1]);
  }
  return [...keys].sort();
}

module.exports = { staticKeys };
if (require.main === module) console.log(staticKeys().join('\n'));
