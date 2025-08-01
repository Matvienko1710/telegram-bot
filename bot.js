const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database('users.db');

// Создание таблицы
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    referred_by INTEGER,
    last_farm INTEGER DEFAULT 0,
    last_bonus TEXT
  )
`).run();

// Регистрация
function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);
    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(referral);
      ctx.reply('🎁 Вы получили 10 звёзд за приглашение!');
    }
  }
}

// Инлайн-кнопки
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⭐ Фарм', 'farm')],
  [Markup.button.callback('🎁 Бонус', 'bonus')],
  [Markup.button.callback('👤 Профиль', 'profile')],
  [Markup.button.callback('🏆 Лидеры', 'leaders')],
  [Markup.button.callback('📊 Статистика', 'stats')],
]);

// Старт
bot.start((ctx) => {
  registerUser(ctx);

  ctx.reply(
    '🚀 Добро пожаловать! Зарабатывай звёзды!',
    mainMenu
  );
});

// 👆 Обработка кнопок
bot.action('farm', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const now = Date.now();

  if (!user) return ctx.answerCbQuery('Сначала нажмите /start');

  const cooldown = 60 * 1000;
  if (now - user.last_farm < cooldown) {
    const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
    return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`);
  }

  db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, ctx.from.id);
  ctx.answerCbQuery('⭐ +1 звезда!');
});

bot.action('bonus', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const now = dayjs();
  const last = user.last_bonus ? dayjs(user.last_bonus) : null;

  if (last && now.diff(last, 'hour') < 24) {
    const hoursLeft = 24 - now.diff(last, 'hour');
    return ctx.answerCbQuery(`⏳ Через ${hoursLeft} ч.`);
  }

  db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(now.toISOString(), ctx.from.id);
  ctx.answerCbQuery('🎉 +5 звёзд (бонус)!');
});

bot.action('profile', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  if (!user) return ctx.answerCbQuery('Нажмите /start');

  ctx.reply(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
📣 Реф: ${user.referred_by || '—'}
`, mainMenu);
  ctx.answerCbQuery();
});

bot.action('leaders', (ctx) => {
  const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
  const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');

  ctx.reply(`🏆 Топ 10 лидеров:\n\n${list}`, mainMenu);
  ctx.answerCbQuery();
});

bot.action('stats', (ctx) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;

  ctx.reply(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${totalStars}`, mainMenu);
  ctx.answerCbQuery();
});

bot.launch();