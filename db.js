const Database = require('better-sqlite3');
const path = require('path');

let db;

// Инициализация базы данных
function initializeDatabase() {
  try {
    db = new Database(path.resolve(__dirname, 'database.db'), { verbose: (msg) => console.log(`[SQLite] ${msg}`) });

    // Проверка целостности базы данных
    db.prepare('PRAGMA integrity_check').run();

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

    // Таблица tickets: хранит тикеты и заявки на задания
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
        type TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        goal INTEGER NOT NULL,
        reward INTEGER NOT NULL
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

    // Создание индексов для оптимизации
    db.prepare('CREATE INDEX IF NOT EXISTS idx_user_tasks_user_id ON user_tasks(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_task_type ON tickets(task_type)').run();

    console.log('База данных инициализирована успешно.');
  } catch (error) {
    console.error('Ошибка инициализации базы данных:', error.message);
    process.exit(1);
  }
}

// Экспорт методов
module.exports = {
  prepare: (query) => {
    try {
      return db.prepare(query);
    } catch (error) {
      console.error(`Ошибка подготовки запроса: ${query}`, error.message);
      throw error;
    }
  },
  run: (query, params = []) => {
    try {
      return db.prepare(query).run(params);
    } catch (error) {
      console.error(`Ошибка выполнения запроса: ${query}`, { params, error: error.message });
      throw error;
    }
  },
  get: (query, params = []) => {
    try {
      return db.prepare(query).get(params);
    } catch (error) {
      console.error(`Ошибка получения записи: ${query}`, { params, error: error.message });
      throw error;
    }
  },
  all: (query, params = []) => {
    try {
      return db.prepare(query).all(params);
    } catch (error) {
      console.error(`Ошибка получения записей: ${query}`, { params, error: error.message });
      throw error;
    }
  },
};

// Инициализация при загрузке модуля
initializeDatabase();

// Закрытие базы данных при завершении процесса
process.on('SIGINT', () => {
  try {
    db.close();
    console.log('База данных закрыта.');
    process.exit(0);
  } catch (error) {
    console.error('Ошибка закрытия базы данных:', error.message);
    process.exit(1);
  }
});