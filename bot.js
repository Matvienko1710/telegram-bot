import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const FARM_COOLDOWN = 60;      // секунд
const BONUS_COOLDOWN = 3600;   // 1 час

function getUser(id, username) {
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    db.prepare('INSERT INTO users (id, username, stars, last_farm, last_bonus) VALUES (?, ?, 0, 0, 0)').run(id, username || '');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return user;
}

function mainMenu() {
  return Markup.keyboard([
    ['⭐ Фарм звёзд', '🎁 Бонус'],
    ['👤 Профиль', '🏆 Лидеры'],
    ['📊 Статистика']
  ]).resize();
}

bot.start((ctx) => {
  getUser(ctx.from.id, ctx.from.username);
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

bot.command('users', (ctx) => {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    if (users.length > 0) {
      const userList = users.map(user => `ID: ${user.id}, Username: ${user.username || 'Unknown'}, Stars: ${user.stars}`).join('\n');
      ctx.reply(`Список пользователей:\n${userList}`);
    } else {
      ctx.reply('В базе данных нет пользователей.');
    }
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    ctx.reply('Произошла ошибка при работе с базой данных.');
  }
});

bot.launch();
console.log('🤖 Бот запущен');
