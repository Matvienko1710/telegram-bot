import Database from 'better-sqlite3';

const db = new Database('/data/users.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    referred_by INTEGER,
    last_farm INTEGER DEFAULT 0,
    last_bonus TEXT
  )
`).run();

export default db;