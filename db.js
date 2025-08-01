const Database = require('better-sqlite3');
const db = new Database('database.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    last_farm INTEGER DEFAULT 0,
    last_bonus TEXT DEFAULT NULL,
    referred_by INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    reward INTEGER NOT NULL,
    used_by INTEGER DEFAULT NULL
  )
`).run();

module.exports = db;