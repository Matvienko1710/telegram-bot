const Database = require('better-sqlite3');

let db;

// Инициализация базы данных
function initializeDatabase() {
  try {
    db = new Database('database.db', { verbose: console.log });

    // Создание таблицы users
    db.prepare(`
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
    `).run();

    // Создание таблицы promo_codes
    db.prepare(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER,
        activations_left INTEGER,
        used_by TEXT DEFAULT '[]'
      )
    `).run();

    // Создание таблицы tickets
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        description TEXT,
        status TEXT DEFAULT 'open', -- open, in_progress, closed
        created_at TEXT,
        file_id TEXT, -- JSON array of file IDs
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `).run();

    console.log('База данных инициализирована успешно.');
  } catch (error) {
    console.error('Ошибка инициализации базы данных:', error);
    process.exit(1);
  }
}

// Экспорт базы данных
module.exports = {
  prepare: (query) => db.prepare(query),
  run: (query, params) => db.run(query, params),
  get: (query, params) => db.prepare(query).get(params),
  all: (query, params) => db.prepare(query).all(params),
};

// Инициализация при загрузке модуля
initializeDatabase();