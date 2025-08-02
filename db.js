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
    referred_by INTEGER
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

// --- НАЧАЛО ИЗМЕНЕНИЯ: Таблица скриншотов ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    approved INTEGER DEFAULT NULL
  )
`).run();
// --- КОНЕЦ ИЗМЕНЕНИЯ ---

// ✅ --- НАЧАЛО ИЗМЕНЕНИЯ: Таблица заявок на вывод ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS withdraws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();
// ✅ --- КОНЕЦ ИЗМЕНЕНИЯ ---

// Функция для проверки наличия колонки в таблице
function hasColumn(tableName, columnName) {
  const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return pragma.some(col => col.name === columnName);
}

// Добавляем колонки для ежедневных заданий, если их нет
function migrateDailyTasksColumns() {
  const columnsToAdd = [
    { name: 'daily_task_date', type: 'TEXT', defaultValue: 'NULL' },
    { name: 'daily_task_type', type: 'TEXT', defaultValue: 'NULL' },
    { name: 'daily_task_progress', type: 'INTEGER', defaultValue: 0 },
    { name: 'daily_task_completed', type: 'INTEGER', defaultValue: 0 },
  ];

  columnsToAdd.forEach(col => {
    if (!hasColumn('users', col.name)) {
      db.prepare(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`).run();
      console.log(`Добавлена колонка ${col.name} в таблицу users`);
    }
  });
}

// Миграция таблицы promo_codes
function migratePromoCodesTable() {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_codes'").get();
  if (!tableExists) {
    // Таблица не существует — создаём новую с нужными полями
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

  // Таблица существует, проверим нужные колонки
  const hasActivations = hasColumn('promo_codes', 'activations_left');
  const hasUsedBy = hasColumn('promo_codes', 'used_by');

  if (hasActivations && hasUsedBy) {
    console.log('Миграция promo_codes не нужна, поля уже есть');
    return;
  }

  // Создаём временную таблицу с нужными полями
  db.prepare(`
    CREATE TABLE promo_codes_new (
      code TEXT PRIMARY KEY,
      reward INTEGER NOT NULL,
      activations_left INTEGER NOT NULL DEFAULT 1,
      used_by TEXT DEFAULT '[]'
    )
  `).run();

  // Копируем данные из старой таблицы в новую (устанавливаем дефолтные значения)
  db.prepare(`
    INSERT OR IGNORE INTO promo_codes_new (code, reward, activations_left, used_by)
    SELECT code, reward, 1, '[]' FROM promo_codes
  `).run();

  // Удаляем старую таблицу
  db.prepare(`DROP TABLE promo_codes`).run();

  // Переименовываем новую таблицу в promo_codes
  db.prepare(`ALTER TABLE promo_codes_new RENAME TO promo_codes`).run();

  console.log('Миграция promo_codes выполнена');
}

migrateDailyTasksColumns();
migratePromoCodesTable();

module.exports = db;