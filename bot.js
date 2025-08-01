const { Telegraf, Markup } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
function getMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm')],
    [Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile')],
    [Markup.button.callback('🏆 Лидеры', 'leaders')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('📩 Пригласить друзей', 'referral')],
  ]);
}

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
    }
  }
}

bot.start((ctx) => {
  registerUser(ctx);
  ctx.reply('🚀 Добро пожаловать! Вот меню:', getMainMenu());
});

bot.action('farm', async (ctx) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const now = Date.now();
  const cooldown = 60 * 1000;

  if (now - user.last_farm < cooldown) {
    const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
    const msg = await ctx.reply(`⏳ Подождите ${seconds} сек.`);
    setTimeout(() => ctx.deleteMessage(msg.message_id), 5000);
    return;
  }

  db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, id);
  const msg = await ctx.reply('⭐ Вы заработали 1 звезду!');
  setTimeout(() => ctx.deleteMessage(msg.message_id), 5000);
});

bot.action('bonus', async (ctx) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const now = dayjs();
  const last = user.last_bonus ? dayjs(user.last_bonus) : null;

  if (last && now.diff(last, 'hour') < 24) {
    const hoursLeft = 24 - now.diff(last, 'hour');
    const msg = await ctx.reply(`🎁 Бонус можно получить через ${hoursLeft} ч.`);
    setTimeout(() => ctx.deleteMessage(msg.message_id), 5000);
    return;
  }

  db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(now.toISOString(), id);
  const msg = await ctx.reply('🎉 Вы получили ежедневный бонус: +5 звёзд!');
  setTimeout(() => ctx.deleteMessage(msg.message_id), 5000);
});

bot.action('profile', async (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  await ctx.reply(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
📣 Реф: ${user.referred_by || '—'}`);
});

bot.action('leaders', async (ctx) => {
  const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
  const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
  await ctx.reply(`🏆 Топ 10:\n\n${list}`);
});

bot.action('stats', async (ctx) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
  await ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`);
});

bot.action('referral', async (ctx) => {
  const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
  await ctx.reply(`📩 Пригласи друзей и получи +10 звёзд за каждого!\n\n🔗 Ваша ссылка:\n${link}`);
});

// Запуск
bot.launch().then(() => {
  console.log('🤖 Бот успешно запущен!');
});