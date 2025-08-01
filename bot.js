const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database('users.db');

// Создание таблицы, если нет
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

// Регистрация пользователя
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

// Главное меню
function sendMainMenu(ctx) {
  ctx.reply('🚀 Главное меню', Markup.keyboard([
    ['⭐ Фарм', '🎁 Бонус'],
    ['👤 Профиль', '🏆 Лидеры'],
    ['📊 Статистика', '📩 Пригласить друзей']
  ]).resize());
}

// Обработка кнопок
bot.on('text', async (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const now = Date.now();

  if (!user) {
    ctx.reply('Сначала нажмите /start');
    return;
  }

  const text = ctx.message.text;

  if (text === '⭐ Фарм') {
    const cooldown = 60 * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery?.(`⏳ Подождите ${seconds} сек.`) || ctx.reply(`⏳ Подождите ${seconds} сек.`);
    }

    db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, user.id);
    return ctx.reply('⭐ Вы заработали 1 звезду!');
  }

  if (text === '🎁 Бонус') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.reply(`🎁 Бонус можно получить через ${hoursLeft} ч.`);
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), user.id);
    return ctx.reply('🎉 Вы получили ежедневный бонус: +5 звёзд!');
  }

  if (text === '👤 Профиль') {
    return ctx.reply(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
📣 Реф: ${user.referred_by || '—'}`);
  }

  if (text === '🏆 Лидеры') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    return ctx.reply(`🏆 Топ 10:\n\n${list}`);
  }

  if (text === '📊 Статистика') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    return ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`);
  }

  if (text === '📩 Пригласить друзей') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    return ctx.reply(`🔗 Твоя реф. ссылка:\n${link}`, Markup.keyboard([
      ['🔙 Назад']
    ]).resize());
  }

  if (text === '🔙 Назад') {
    return sendMainMenu(ctx);
  }
});

// /start
bot.start((ctx) => {
  registerUser(ctx);
  sendMainMenu(ctx);
});

bot.launch();