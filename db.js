const Database = require('better-sqlite3');
const path = require('path');

console.log('Инициализация базы данных SQLite...');
const db = new Database(path.join(__dirname, 'bot.db'), { verbose: console.log });

// Инициализация таблиц и начальных данных
function initDb() {
  try {
    // Таблица пользователей с новым полем last_menu_message_id
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
        last_menu_message_id INTEGER,
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

    // Таблица выполненных заданий
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
        condition_value TEXT,
        is_secret INTEGER DEFAULT 0
      )
    `);

    // Начальные титулы
    const initialTitles = [
      { name: 'Новичок', description: 'Только начал свой путь к звёздам!', condition_type: 'stars', condition_value: '0', is_secret: 0 },
      { name: 'Звёздный Охотник', description: 'Собрал 50 звёзд!', condition_type: 'stars', condition_value: '50', is_secret: 0 },
      { name: 'Космический Лидер', description: 'Собрал 100 звёзд!', condition_type: 'stars', condition_value: '100', is_secret: 0 },
      { name: 'Галактический Герой', description: 'Собрал 500 звёзд!', condition_type: 'stars', condition_value: '500', is_secret: 0 },
      { name: 'Призыватель', description: 'Пригласил 3 друзей!', condition_type: 'referrals', condition_value: '3', is_secret: 0 },
      { name: 'Командующий', description: 'Пригласил 10 друзей!', condition_type: 'referrals', condition_value: '10', is_secret: 0 },
      { name: 'Мастер Заданий', description: 'Выполнил 5 заданий!', condition_type: 'tasks', condition_value: '5', is_secret: 0 },
      { name: 'Звёздный Странник', description: '10 дней подряд собирал бонусы!', condition_type: 'daily_streak', condition_value: '10', is_secret: 0 },
      { name: 'Кодовый Гений', description: 'Активировал 3 промокода!', condition_type: 'promo_codes', condition_value: '3', is_secret: 0 },
      {
        name: 'Легенда Вселенной',
        description: 'Собрал 1000 звёзд и пригласил 20 друзей!',
        condition_type: 'combined',
        condition_value: JSON.stringify({ stars: 1000, referrals: 20 }),
        is_secret: 1
      },
      {
        name: 'Звёздный Архитектор',
        description: 'Выполнил 15 заданий и 30 дней подряд собирал бонусы!',
        condition_type: 'combined',
        condition_value: JSON.stringify({ tasks: 15, daily_streak: 30 }),
        is_secret: 1
      },
      {
        name: 'Космический Властелин',
        description: 'Активировал 10 промокодов и попал в топ-3 по звёздам!',
        condition_type: 'combined',
        condition_value: JSON.stringify({ promo_codes: 10, top_stars: 3 }),
        is_secret: 1
      }
    ];

    const insertTitle = db.prepare(`
      INSERT OR IGNORE INTO titles (name, description, condition_type, condition_value, is_secret)
      VALUES (?, ?, ?, ?, ?)
    `);
    initialTitles.forEach(title => {
      insertTitle.run(title.name, title.description, title.condition_type, title.condition_value, title.is_secret);
    });

    // Начальные задания
    const initialTasks = [
      { type: 'subscribe_channel', description: `Подпишись на канал ${process.env.TASK_CHANNEL || '@musice46'}`, goal: 1, reward: 5 },
      { type: 'subscribe_channel_kittyyyyywwr', description: `Подпишись на канал ${process.env.TASK_CHANNEL_KITTY || '@kittyyyyywwr'}`, goal: 1, reward: 5 },
      { type: 'start_bot', description: `Запусти бота по ссылке ${process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot'}`, goal: 1, reward: 10 }
    ];

    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO tasks (type, description, goal, reward)
      VALUES (?, ?, ?, ?)
    `);
    initialTasks.forEach(task => {
      insertTask.run(task.type, task.description, task.goal, task.reward);
    });

    console.log('База данных инициализирована.');
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err);
    process.exit(1);
  }
}

initDb();

module.exports = {
  get: (query, params = []) => db.prepare(query).get(...params),
  all: (query, params = []) => db.prepare(query).all(...params),
  run: (query, params = []) => db.prepare(query).run(...params)
};