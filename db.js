const Database = require('better-sqlite3');

let db;

// Инициализация базы данных
function initializeDatabase() {
  try {
    db = new Database('database.db', { verbose: console.log });

    // Таблица users: хранит информацию о пользователях
    // Поля:
    // - id: уникальный ID пользователя (Telegram ID)
    // - username: имя пользователя в Telegram
    // - stars: количество звёзд
    // - last_farm: время последнего фарма (в миллисекундах)
    // - last_bonus: время последнего бонуса (ISO строка)
    // - referred_by: ID пользователя, пригласившего (если есть)
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
    // Поля:
    // - code: уникальный код промокода
    // - reward: награда в звёздах
    // - activations_left: оставшееся количество активаций
    // - used_by: JSON-массив ID пользователей, использовавших промокод
    db.prepare(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER,
        activations_left INTEGER,
        used_by TEXT DEFAULT '[]'
      )
    `).run();

    // Таблица tickets: хранит тикеты поддержки и заявки на задания
    // Поля:
    // - ticket_id: уникальный ID тикета
    // - user_id: ID пользователя
    // - username: имя пользователя
    // - description: описание тикета или заявки
    // - status: статус (open, in_progress, closed, approved, rejected)
    // - created_at: время создания (ISO строка)
    // - file_id: JSON-массив ID файлов
    // - channel_message_id: ID сообщения в канале поддержки
    // - task_type: тип задания для заявок (например, 'subscribe_channel', 'start_bot')
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
    // Поля:
    // - id: уникальный ID задания
    // - type: уникальный тип задания (например, 'subscribe_channel')
    // - description: описание задания для отображения
    // - goal: количество действий для выполнения
    // - reward: награда в звёздах
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
    // Поля:
    // - user_id: ID пользователя
    // - task_id: ID задания из таблицы tasks
    // - progress: текущий прогресс (например, 1 из 1 для подписки)
    // - completed: 1, если задание выполнено, иначе 0
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