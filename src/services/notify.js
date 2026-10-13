'use strict';
const { iso } = require('../util');

// Notifications are stored as an i18n key + params so each reader sees them in
// their own language.
function notify(db, userId, key, params = {}, link = '') {
  db.run(
    'INSERT INTO notifications (user_id, body, link, created_at) VALUES (?,?,?,?)',
    userId, JSON.stringify({ key, params }), link, iso(),
  );
}

module.exports = { notify };
