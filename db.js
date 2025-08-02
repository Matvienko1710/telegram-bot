const Database = require('better-sqlite3');
const db = new Database('database.db', { verbose: console.log });

// Создание таблицы users
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    last_farm INTEGER DEFAULT 0,
    last_bonus TEXT DEFAULT NULL,
    referred_by INTEGER,
    daily_task_date TEXT DEFAULT NULL,
    daily_task_type TEXT DEFAULT NULL,
    daily_task_progress INTEGER DEFAULT 0,
    daily_task_completed INTEGER DEFAULT 0
  )
`).run();

// Создание таблицы logs
db.prepare(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    timestamp INTEGER
  )
`).run();

// Создание таблицы sessions
db.prepare(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT
  )
`).run();

// Создание таблицы withdraws
db.prepare(`
  CREATE TABLE IF NOT EXISTS withdraws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    amount INTEGER,
    status TEXT,
    channel_message_id INTEGER
  )
`).run();

// Создание таблицы screenshots
db.prepare(`
  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    file_id TEXT,
    task_type TEXT,
    approved INTEGER,
    created_at INTEGER
  )
`).run();

// Создание таблицы promo_codes
db.prepare(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    reward INTEGER,
    activations_left INTEGER,
    used_by TEXT
  )
`).run();

// Создание таблицы stars_transactions
db.prepare(`
  CREATE TABLE IF NOT EXISTS stars_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    telegram_payment_id TEXT,
    amount INTEGER,
    item TEXT,
    status TEXT,
    created_at INTEGER
  )
`).run();

// Создание таблицы support_tickets
db.prepare(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT,
    issue TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    channel_message_id INTEGER
  )
`).run();

module.exports = db;