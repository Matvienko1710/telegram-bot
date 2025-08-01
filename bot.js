const { Telegraf, Markup } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
function sendMainMenu(ctx) {
  return ctx.reply('🚀 Главное меню', Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm'), Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('🏆 Лидеры', 'leaders')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('📩 Пригласить друзей', 'ref')]
  ]));
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
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }
}

// /start
bot.start(async (ctx) => {
  registerUser(ctx);
  await sendMainMenu(ctx);
});

// Callback кнопки
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'farm') {
    const cooldown = 60 * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, id);
    return ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус можно получить через ${hoursLeft} ч.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), id);
    return ctx.answerCbQuery('🎉 Вы получили ежедневный бонус: +5 звёзд!', { show_alert: true });
  }

  if (action === 'profile') {
    const invited = db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(id).count;
    return ctx.editMessageText(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
👥 Приглашено: ${invited}
📣 Реф: ${user.referred_by || '—'}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'leaders') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    return ctx.editMessageText(`🏆 Топ 10:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    return ctx.editMessageText(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    return ctx.editMessageText(`📩 Твоя реферальная ссылка:\n\n${link}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'back') {
    return ctx.editMessageText('🚀 Главное меню', Markup.inlineKeyboard([
      [Markup.button.callback('⭐ Фарм', 'farm'), Markup.button.callback('🎁 Бонус', 'bonus')],
      [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('🏆 Лидеры', 'leaders')],
      [Markup.button.callback('📊 Статистика', 'stats')],
      [Markup.button.callback('📩 Пригласить друзей', 'ref')]
    ]));
  }
});

bot.launch().then(() => {
  console.log('🤖 Бот запущен с инлайн-кнопками!');
});