'use strict';
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const C = require('./src/config');

const db = openDb(C.DB_PATH);
const app = createApp(db);
app.server().listen(C.PORT, () => {
  console.log(`Mouhandis running on http://localhost:${C.PORT}`);
  if (!db.get('SELECT 1 x FROM users LIMIT 1')) console.log('Database is empty — run `npm run seed` to load demo data.');
});
