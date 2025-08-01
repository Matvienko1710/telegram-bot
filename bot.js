const { Telegraf, Markup } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);

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

bot.on('text', async (ctx) => {
  const id = ctx.from.id;
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (!user) {
    registerUser(ctx);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    sendMainMenu(ctx);
    return;
  }

  const now = Date.now();
  const text = ctx.message.text;

  if (text === '⭐ Фарм') {
    const cooldown = 60 * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      const sent = await ctx.reply(`⏳ Подождите ${seconds} сек.`);
      setTimeout(() => ctx.deleteMessage(sent.message_id), 5000);
      return;
    }

    db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, user.id);
    const sent = await ctx.reply('⭐ Вы заработали 1 звезду!');
    setTimeout(() => ctx.deleteMessage(sent.message_id), 5000);
    return;
  }

  if (text === '🎁 Бонус') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      const sent = await ctx.reply(`🎁 Бонус можно получить через ${hoursLeft} ч.`);
      setTimeout(() => ctx.deleteMessage(sent.message_id), 5000);
      return;
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), user.id);
    const sent = await ctx.reply('🎉 Вы получили ежедневный бонус: +5 звёзд!');
    setTimeout(() => ctx.deleteMessage(sent.message_id), 5000);
    return;
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

bot.start((ctx) => {
  registerUser(ctx);
  sendMainMenu(ctx);
});

bot.launch().then(() => {
  console.log('🤖 Бот успешно запущен!');
});