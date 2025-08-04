const Database = require('better-sqlite3');
const db = new Database('bot.db', { verbose: console.log });

function initDb() {
  try {
    // Создание таблицы users
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        stars INTEGER DEFAULT 0,
        last_farm INTEGER DEFAULT 0,
        last_bonus TEXT,
        referred_by INTEGER,
        title_id INTEGER,
        daily_streak INTEGER DEFAULT 0,
        FOREIGN KEY (referred_by) REFERENCES users(id),
        FOREIGN KEY (title_id) REFERENCES titles(id)
      )
    `);

    // Создание таблицы tickets
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        description TEXT,
        created_at TEXT,
        file_id TEXT,
        channel_message_id INTEGER,
        task_type TEXT,
        status TEXT DEFAULT 'open',
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Создание таблицы tasks
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        description TEXT,
        goal INTEGER,
        reward INTEGER
      )
    `);

    // Создание таблицы user_tasks
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

    // Создание таблицы promo_codes
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER,
        activations_left INTEGER,
        used_by TEXT
      )
    `);

    // Создание таблицы titles
    db.exec(`
      CREATE TABLE IF NOT EXISTS titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        condition_type TEXT NOT NULL,
        condition_value INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Инициализация титулов
    const initialTitles = [
      { name: 'Звёздный Новичок', condition_type: 'stars', condition_value: 10, description: 'Первый шаг в мир Magnum Stars!' },
      { name: 'Звёздный Искры', condition_type: 'stars', condition_value: 50, description: 'Ты начинаешь сиять ярче!' },
      { name: 'Звёздный Герой', condition_type: 'stars', condition_value: 100, description: 'Настоящий герой звёздного неба!' },
      { name: 'Звёздный Мастер', condition_type: 'stars', condition_value: 500, description: 'Ты овладел искусством сбора звёзд!' },
      { name: 'Звёздная Легенда', condition_type: 'stars', condition_value: 1000, description: 'Ты вошёл в историю Magnum Stars!' },
      { name: 'Дружелюбный Охотник', condition_type: 'referrals', condition_value: 1, description: 'Ты привёл друга в звёздное приключение!' },
      { name: 'Звёздный Рекрутёр', condition_type: 'referrals', condition_value: 5, description: 'Твоя команда растёт!' },
      { name: 'Лидер Галактики', condition_type: 'referrals', condition_value: 20, description: 'Ты собираешь целую галактику друзей!' },
      { name: 'Исполнитель Миссий', condition_type: 'tasks', condition_value: 1, description: 'Ты успешно выполнил свою первую миссию!' },
      { name: 'Звёздный Исследователь', condition_type: 'tasks', condition_value: 5, description: 'Ты исследуешь все уголки Magnum Stars!' },
      { name: 'Ежедневный Чемпион', condition_type: 'daily_streak', condition_value: 7, description: 'Твоя регулярность впечатляет!' },
      { name: 'Промо-Охотник', condition_type: 'promo_codes', condition_value: 3, description: 'Ты находишь секретные коды как охотник!' },
    ];

    initialTitles.forEach(title => {
      const exists = db.prepare('SELECT * FROM titles WHERE name = ?').get(title.name);
      if (!exists) {
        db.prepare('INSERT INTO titles (name, condition_type, condition_value, description) VALUES (?, ?, ?, ?)').run(
          title.name,
          title.condition_type,
          title.condition_value,
          title.description
        );
        console.log(`Титул "${title.name}" создан с условием "${title.condition_type}: ${title.condition_value}"`);
      }
    });

    console.log('База данных инициализирована успешно.');
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err);
    process.exit(1);
  }
}

initDb();

module.exports = {
  get: query => db.prepare(query).get,
  run: query => db.prepare(query).run,
  all: query => db.prepare(query).all,
};