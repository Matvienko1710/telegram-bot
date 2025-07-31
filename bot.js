import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const FARM_COOLDOWN = 60;      // секунд
const BONUS_COOLDOWN = 3600;   // 1 час
const REFERRAL_BONUS = 10;     // Бонус за приглашённого

function getUser(id, username) {
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    db.prepare('INSERT INTO users (id, username, stars, last_farm, last_bonus, referrer_id) VALUES (?, ?, 0, 0, 0, NULL)').run(id, username || '');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return user;
}

function mainMenu() {
  return Markup.keyboard([
    ['⭐ Фарм звёзд', '🎁 Бонус'],
    ['👤 Профиль', '🏆 Лидеры'],
    ['📊 Статистика', '🔗 Реферальная ссылка']
  ]).resize();
}

bot.start((ctx) => {
  const args = ctx.message.text.split(' ');
  const referrerId = args.length > 1 && args[1].startsWith('referral_') 
    ? parseInt(args[1].split('_')[1]) 
    : null;

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  if (!user) {
    db.prepare('INSERT INTO users (id, username, stars, last_farm, last_bonus, referrer_id) VALUES (?, ?, 0, 0, 0, ?)').run(
      ctx.from.id,
      ctx.from.username || '',
      referrerId
    );

    // Начисляем бонус за реферала
    if (referrerId) {
      db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(REFERRAL_BONUS, referrerId);
      ctx.telegram.sendMessage(referrerId, `🎉 Вы получили ${REFERRAL_BONUS} звёзд за приглашение нового пользователя!`);
    }
  }

  ctx.reply(`👋 Привет, ${ctx.from.first_name}! Добро пожаловать в бот 🌟`, mainMenu());
});

bot.hears('⭐ Фарм звёзд', (ctx) => {
  const user = getUser(ctx.from.id, ctx.from.username);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - user.last_farm;

  if (elapsed < FARM_COOLDOWN) {
    const wait = FARM_COOLDOWN - elapsed;
    return ctx.reply(`⏳ Подожди ${wait} сек перед следующим фармом`);
  }

  db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, user.id);
  ctx.reply(`⭐ Вы получили 1 звезду!`);
});

bot.hears('🎁 Бонус', (ctx) => {
  const user = getUser(ctx.from.id, ctx.from.username);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - user.last_bonus;

  if (elapsed < BONUS_COOLDOWN) {
    const wait = Math.ceil((BONUS_COOLDOWN - elapsed) / 60);
    return ctx.reply(`🎁 Бонус доступен через ${wait} мин`);
  }

  db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(now, user.id);
  ctx.reply(`🎉 Вы получили 5 бонусных звёзд!`);
});

bot.hears('👤 Профиль', (ctx) => {
  const user = getUser(ctx.from.id, ctx.from.username);
  ctx.reply(`👤 Профиль:\n\n🆔 ID: ${user.id}\n💫 Звёзд: ${user.stars}`);
});

bot.hears('🏆 Лидеры', (ctx) => {
  const leaders = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
  const leaderboard = leaders.map((u, i) => `${i + 1}. ${u.username || 'Аноним'} - ${u.stars} ⭐`).join('\n');
  ctx.reply(`🏆 Топ 10 игроков:\n\n${leaderboard}`);
});

bot.hears('📊 Статистика', (ctx) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalStars = db.prepare('SELECT SUM(stars) as total FROM users').get().total || 0;
  ctx.reply(`📊 Общая статистика:\n\n👥 Пользователей: ${totalUsers}\n⭐ Всего звёзд: ${totalStars}`);
});

bot.hears('🔗 Реферальная ссылка', (ctx) => {
  const userId = ctx.from.id;
  const link = `https://t.me/your_bot?start=referral_${userId}`;
  ctx.reply(`🔗 Ваша реферальная ссылка:\n${link}`);
});

bot.command('referrals', (ctx) => {
  const userId = ctx.from.id;
  const referrals = db.prepare('SELECT * FROM users WHERE referrer_id = ?').all(userId);

  if (referrals.length > 0) {
    const referralsList = referrals
      .map(user => `${user.username || 'Аноним'} - ${user.stars} ⭐`)
      .join('\n');
    ctx.reply(`👥 Ваши приглашённые:\n\n${referralsList}`);
  } else {
    ctx.reply('❌ Вы ещё никого не пригласили.');
  }
});

bot.launch();
console.log('🤖 Бот запущен');