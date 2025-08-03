const Database = require('better-sqlite3');
const path = require('path');

// Инициализация базы данных
const db = new Database(path.join(__dirname, 'database.db'), { verbose: console.log });

// Создание таблицы users
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    last_farm INTEGER DEFAULT 0,
    last_bonus TEXT,
    referred_by INTEGER,
    daily_task_type TEXT,
    daily_task_progress INTEGER DEFAULT 0,
    daily_task_completed INTEGER DEFAULT 0,
    daily_task_date TEXT,
    FOREIGN KEY (referred_by) REFERENCES users(id)
  )
`);

// Создание таблицы promo_codes
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    reward INTEGER,
    activations_left INTEGER,
    used_by TEXT DEFAULT '[]'
  )
`);

// Экспорт объекта базы данных
module.exports = db;