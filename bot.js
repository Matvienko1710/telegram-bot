import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const FARM_COOLDOWN = 60;      // секунд
const BONUS_COOLDOWN = 3600;   // 1 час
const REFERRAL_BONUS = 10;     // Бонус за приглашённого

// Администраторы
const ADMINS = new Set(); // Хранение ID администраторов

// Проверка и добавление недостающей колонки referrer_id
try {
  db.prepare("ALTER TABLE users ADD COLUMN referrer_id INTEGER").run();
  console.log("Колонка referrer_id успешно добавлена в таблицу users.");
} catch (error) {
  if (error.message.includes("duplicate column name")) {
    console.log("Колонка referrer_id уже существует в таблице users.");
  } else {
    console.error("Ошибка при добавлении колонки referrer_id:", error.message);
  }
}

// Инициализация пользователя
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

// Проверка на администратора
function isAdmin(userId) {
  return ADMINS.has(userId);
}

// Команда для добавления администратора
bot.command('add_admin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ У вас нет прав для выполнения этой команды.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Укажите ID пользователя, которого нужно сделать администратором.');
  }

  const newAdminId = parseInt(args[1]);
  ADMINS.add(newAdminId);
  ctx.reply(`✅ Пользователь с ID ${newAdminId} добавлен в администраторы.`);
});

// Команда для выдачи звёзд
bot.command('give_stars', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ У вас нет прав для выполнения этой команды.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('❌ Укажите ID пользователя и количество звёзд.');
  }

  const userId = parseInt(args[1]);
  const stars = parseInt(args[2]);

  db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(stars, userId);
  ctx.reply(`✅ Пользователю с ID ${userId} выдано ${stars} звёзд.`);
});

// Команда для блокировки пользователя
bot.command('block_user', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ У вас нет прав для выполнения этой команды.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Укажите ID пользователя для блокировки.');
  }

  const userId = parseInt(args[1]);
  db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(userId);
  ctx.reply(`✅ Пользователь с ID ${userId} заблокирован.`);
});

// Команда для просмотра всех пользователей
bot.command('list_users', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ У вас нет прав для выполнения этой команды.');
  }

  const users = db.prepare('SELECT id, username, stars FROM users').all();
  const userList = users
    .map(user => `ID: ${user.id}, Имя: ${user.username || 'Аноним'}, Звёзд: ${user.stars}`)
    .join('\n');

  ctx.reply(`👥 Список пользователей:\n\n${userList}`);
});

// Инициализация бота
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

bot.launch();
console.log('🤖 Бот запущен');
