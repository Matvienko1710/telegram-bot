const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database('users.db');

// Инициализация таблицы
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

// ➕ Регистрация пользователя
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

// 🪙 Фарм
bot.command('farm', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const now = Date.now();

  if (!user) return ctx.reply('Сначала нажмите /start');

  const cooldown = 60 * 1000;
  if (now - user.last_farm < cooldown) {
    const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
    return ctx.reply(`⏳ Подождите ${seconds} секунд до следующего фарма.`);
  }

  db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, ctx.from.id);
  ctx.reply('⭐ Вы заработали 1 звезду!');
});

// 🎁 Бонус
bot.command('bonus', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const now = dayjs();
  const last = user.last_bonus ? dayjs(user.last_bonus) : null;

  if (last && now.diff(last, 'hour') < 24) {
    const hoursLeft = 24 - now.diff(last, 'hour');
    return ctx.reply(`🎁 Бонус можно получить через ${hoursLeft} ч.`);
  }

  db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(now.toISOString(), ctx.from.id);
  ctx.reply('🎉 Вы получили ежедневный бонус: +5 звёзд!');
});

// 👤 Профиль
bot.command('profile', (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  if (!user) return ctx.reply('Вы ещё не зарегистрированы. Нажмите /start');

  ctx.reply(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
📣 Реф: ${user.referred_by || '—'}
`);
});

// 🏆 Лидеры
bot.command('leaders', (ctx) => {
  const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();

  const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');

  ctx.reply(`🏆 Топ 10 лидеров:\n\n${list}`);
});

// 📊 Статистика
bot.command('stats', (ctx) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;

  ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`);
});

// 📲 /start + регистрация
bot.start((ctx) => {
  registerUser(ctx);

  ctx.reply(
    '🚀 Добро пожаловать! Зарабатывай звёзды:\n\n' +
      '/farm – фармить звёзды (1/мин)\n' +
      '/bonus – ежедневный бонус\n' +
      '/profile – профиль\n' +
      '/leaders – топ 10\n' +
      '/stats – статистика\n\n' +
      '🔗 Твоя реф. ссылка:\n' +
      `https://t.me/${ctx.me}?start=${ctx.from.id}`
  );
});

bot.launch();