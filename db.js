const Database = require('better-sqlite3');
const db = new Database('database.db');

// Таблица пользователей
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

// Таблица логов действий пользователей
db.prepare(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )
`).run();

// Таблица скриншотов
db.prepare(`
  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    approved INTEGER DEFAULT NULL,
    task_type TEXT DEFAULT 'subscribe_channel',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`).run();

// Добавляем task_type и created_at, если их нет
const hasTaskType = db.prepare("PRAGMA table_info(screenshots)").all().some(col => col.name === 'task_type');
if (!hasTaskType) {
  db.prepare(`ALTER TABLE screenshots ADD COLUMN task_type TEXT DEFAULT 'subscribe_channel'`).run();
  console.log('Добавлена колонка task_type в таблицу screenshots');
}

const hasCreatedAt = db.prepare("PRAGMA table_info(screenshots)").all().some(col => col.name === 'created_at');
if (!hasCreatedAt) {
  db.prepare(`ALTER TABLE screenshots ADD COLUMN created_at INTEGER DEFAULT (strftime('%s', 'now'))`).run();
  console.log('Добавлена колонка created_at в таблицу screenshots');
}

// Таблица заявок на вывод
db.prepare(`
  CREATE TABLE IF NOT EXISTS withdraws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    channel_message_id INTEGER
  )
`).run();

// Таблица промокодов
function migratePromoCodesTable() {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_codes'").get();
  if (!tableExists) {
    db.prepare(`
      CREATE TABLE promo_codes (
        code TEXT PRIMARY KEY,
        reward INTEGER NOT NULL,
        activations_left INTEGER NOT NULL DEFAULT 1,
        used_by TEXT DEFAULT '[]'
      )
    `).run();
    console.log('Создана новая таблица promo_codes');
    return;
  }

  const hasActivations = db.prepare("PRAGMA table_info(promo_codes)").all().some(col => col.name === 'activations_left');
  const hasUsedBy = db.prepare("PRAGMA table_info(promo_codes)").all().some(col => col.name === 'used_by');

  if (hasActivations && hasUsedBy) {
    console.log('Миграция promo_codes не нужна, поля уже есть');
    return;
  }

  db.prepare(`
    CREATE TABLE promo_codes_new (
      code TEXT PRIMARY KEY,
      reward INTEGER NOT NULL,
      activations_left INTEGER NOT NULL DEFAULT 1,
      used_by TEXT DEFAULT '[]'
    )
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO promo_codes_new (code, reward, activations_left, used_by)
    SELECT code, reward, 1, '[]' FROM promo_codes
  `).run();

  db.prepare(`DROP TABLE promo_codes`).run();
  db.prepare(`ALTER TABLE promo_codes_new RENAME TO promo_codes`).run();
  console.log('Миграция promo_codes выполнена');
}

migratePromoCodesTable();

// Очистка устаревших отклонённых скриншотов (старше 7 дней)
const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
db.prepare('DELETE FROM screenshots WHERE approved = 0 AND created_at < ?').run(sevenDaysAgo);
console.log('Очищены устаревшие отклонённые скриншоты');

module.exports = db;