const Database = require('better-sqlite3');

let db;

// Инициализация базы данных
function initializeDatabase() {
  try {
    db = new Database('database.db', { verbose: console.log });

    // Таблица users: хранит информацию о пользователях
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        stars INTEGER DEFAULT 0,
        last_farm INTEGER DEFAULT 0,
        last_bonus TEXT,
        referred_by INTEGER,
        FOREIGN KEY (referred_by) REFERENCES users(id)
      )
    `).run();

    // Таблица promo_codes: хранит промокоды
    db.prepare(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER,
        activations_left INTEGER,
        used_by TEXT DEFAULT '[]'
      )
    `).run();

    // Таблица tickets: хранит тикеты поддержки и заявки на задания
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        description TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT,
        file_id TEXT,
        channel_message_id INTEGER,
        task_type TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `).run();

    // Таблица tasks: хранит задания
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        description TEXT,
        goal INTEGER,
        reward INTEGER
      )
    `).run();

    // Таблица user_tasks: хранит прогресс пользователей по заданиям
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        user_id INTEGER,
        task_id INTEGER,
        progress INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, task_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
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
  run: (query, params) => db.prepare(query).run(params),
  get: (query, params) => db.prepare(query).get(params),
  all: (query, params) => db.prepare(query).all(params),
};

// Инициализация при загрузке модуля
initializeDatabase();