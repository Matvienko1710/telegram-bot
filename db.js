console.log('Попытка загрузки модуля better-sqlite3...');
const Database = require('better-sqlite3');
console.log('Модуль better-sqlite3 успешно загружен.');
const path = require('path');

// Инициализация базы данных
const db = new Database(path.join(__dirname, 'bot.db'), { verbose: console.log });
console.log('Подключение к базе данных SQLite успешно.');

// Функция для инициализации таблиц и начальных данных
function initDb() {
  try {
    // Таблица пользователей
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        stars INTEGER DEFAULT 0,
        last_farm INTEGER DEFAULT 0,
        last_bonus TEXT,
        daily_streak INTEGER DEFAULT 0,
        referred_by INTEGER,
        title_id INTEGER,
        FOREIGN KEY (title_id) REFERENCES titles(id)
      )
    `);

    // Таблица тикетов
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        description TEXT,
        created_at TEXT,
        file_id TEXT,
        channel_message_id INTEGER,
        status TEXT DEFAULT 'open',
        task_type TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Таблица заданий
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        description TEXT,
        goal INTEGER,
        reward INTEGER
      )
    `);

    // Таблица выполненных заданий пользователями
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        user_id INTEGER,
        task_id INTEGER,
        progress INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, task_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    // Таблица промокодов
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER,
        activations_left INTEGER,
        used_by TEXT DEFAULT '[]'
      )
    `);

    // Таблица титулов
    db.exec(`
      CREATE TABLE IF NOT EXISTS titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        condition_type TEXT,
        condition_value INTEGER
      )
    `);

    // Инициализация начальных титулов
    const initialTitles = [
      {
        name: 'Новичок',
        description: 'Только начал свой путь к звёздам!',
        condition_type: 'stars',
        condition_value: 0
      },
      {
        name: 'Звёздный Охотник',
        description: 'Собрал 50 звёзд!',
        condition_type: 'stars',
        condition_value: 50
      },
      {
        name: 'Космический Лидер',
        description: 'Собрал 100 звёзд!',
        condition_type: 'stars',
        condition_value: 100
      },
      {
        name: 'Галактический Герой',
        description: 'Собрал 500 звёзд!',
        condition_type: 'stars',
        condition_value: 500
      },
      {
        name: 'Призыватель',
        description: 'Пригласил 3 друзей!',
        condition_type: 'referrals',
        condition_value: 3
      },
      {
        name: 'Командующий',
        description: 'Пригласил 10 друзей!',
        condition_type: 'referrals',
        condition_value: 10
      },
      {
        name: 'Мастер Заданий',
        description: 'Выполнил 5 заданий!',
        condition_type: 'tasks',
        condition_value: 5
      },
      {
        name: 'Звёздный Странник',
        description: '10 дней подряд собирал бонусы!',
        condition_type: 'daily_streak',
        condition_value: 10
      },
      {
        name: 'Кодовый Гений',
        description: 'Активировал 3 промокода!',
        condition_type: 'promo_codes',
        condition_value: 3
      }
    ];

    const insertTitle = db.prepare(`
      INSERT OR IGNORE INTO titles (name, description, condition_type, condition_value)
      VALUES (?, ?, ?, ?)
    `);
    initialTitles.forEach(title => {
      const info = insertTitle.run(title.name, title.description, title.condition_type, title.condition_value);
      if (info.changes) {
        console.log(`Титул "${title.name}" создан с условием ${title.condition_type} >= ${title.condition_value}`);
      }
    });

    // Инициализация начальных заданий
    const initialTasks = [
      {
        type: 'subscribe_channel',
        description: `Подпишись на канал ${process.env.TASK_CHANNEL || '@musice46'}`,
        goal: 1,
        reward: 5
      },
      {
        type: 'subscribe_channel_kittyyyyywwr',
        description: `Подпишись на канал ${process.env.TASK_CHANNEL_KITTY || '@kittyyyyywwr'}`,
        goal: 1,
        reward: 5
      },
      {
        type: 'start_bot',
        description: `Запусти бота по ссылке ${process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot'}`,
        goal: 1,
        reward: 10
      }
    ];

    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO tasks (type, description, goal, reward)
      VALUES (?, ?, ?, ?)
    `);
    initialTasks.forEach(task => {
      const info = insertTask.run(task.type, task.description, task.goal, task.reward);
      if (info.changes) {
        console.log(`Задание "${task.description}" создано с наградой ${task.reward} звёзд`);
      }
    });

    console.log('База данных инициализирована успешно.');
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err);
    process.exit(1);
  }
}

// Инициализация базы данных
initDb();

// Экспорт методов для работы с базой данных
module.exports = {
  get: (query, params = []) => {
    try {
      return db.prepare(query).get(...params);
    } catch (err) {
      console.error(`Ошибка в db.get (${query}):`, err);
      throw err;
    }
  },
  all: (query, params = []) => {
    try {
      return db.prepare(query).all(...params);
    } catch (err) {
      console.error(`Ошибка в db.all (${query}):`, err);
      throw err;
    }
  },
  run: (query, params = []) => {
    try {
      return db.prepare(query).run(...params);
    } catch (err) {
      console.error(`Ошибка в db.run (${query}):`, err);
      throw err;
    }
  }
};