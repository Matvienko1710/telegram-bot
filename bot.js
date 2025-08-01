const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const REQUIRED_CHANNEL = '@magnumtap';
const ADMIN_ID = 6587897295; // 🔁 Замени на свой Telegram ID

async function isUserSubscribed(ctx) {
  try {
    const status = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(status.status);
  } catch {
    return false;
  }
}

function sendMainMenu(ctx) {
  return ctx.reply('🚀 Главное меню', Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm'), Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('🏆 Лидеры', 'leaders')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    ctx.from.id === ADMIN_ID ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : [],
    [Markup.button.callback('🎮 Мини-игра', 'minigame')]  // <-- Добавлена кнопка мини-игры
  ]));
}

bot.start(async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(`🔒 Чтобы использовать бота, подпишись на канал: ${REQUIRED_CHANNEL}`, Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);
    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }

  await ctx.reply(
    `👋 Привет, *${ctx.from.first_name || 'друг'}*!\n\n` +
    `Добро пожаловать в *MagnumTap* — место, где ты фармишь звёзды, получаешь бонусы и соревнуешься с другими! 🌟\n\n` +
    `🎯 Приглашай друзей, зарабатывай награды и поднимайся в топ!\n\n` +
    `Желаем удачи и удачного фарма! 💫`,
    { parse_mode: 'Markdown' }
  );

  await sendMainMenu(ctx);
});

bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }
    registerUser(ctx);
    return sendMainMenu(ctx);
  }

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

  if (['profile', 'leaders', 'stats', 'ref'].includes(action)) {
    await ctx.deleteMessage();
  }

  if (action === 'profile') {
    const invited = db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(id).count;
    return ctx.reply(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
👥 Приглашено: ${invited}
📣 Реф: ${user.referred_by || '—'}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'leaders') {
    const top = db.prepare(`
      SELECT 
        u.username, 
        u.stars, 
        (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals 
      FROM users u 
      ORDER BY u.stars DESC 
      LIMIT 10
    `).all();

    const list = top.map((u, i) => 
      `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐ — приглашено: ${u.referrals}`
    ).join('\n');

    return ctx.reply(`🏆 Топ 10 игроков:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    return ctx.reply(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    return ctx.reply(`📩 Твоя реферальная ссылка:\n\n${link}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'enter_code') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForCode = true;
    return ctx.reply('💬 Введите промокод:');
  }

  if (action === 'admin') {
    if (id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Доступ запрещён');
    return ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'admin_stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    return ctx.answerCbQuery(`👥 Юзеров: ${total}, ⭐ Звёзд: ${totalStars}`, { show_alert: true });
  }

  if (action === 'admin_top') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    return ctx.reply(`🏆 Топ 10:\n\n${list}`);
  }

  if (action === 'admin_broadcast') {
    ctx.session = ctx.session || {};
    ctx.session.broadcast = true;
    return ctx.reply('✏️ Введите текст рассылки:');
  }

  if (action === 'admin_addcode') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForPromo = true;
    return ctx.reply('✏️ Введите промокод и количество звёзд через пробел:\nНапример: `CODE123 10`', { parse_mode: 'Markdown' });
  }

  // --- Новая логика мини-игры ---
  if (action === 'minigame') {
    // Запускаем игру - загадываем число от 1 до 3
    const number = Math.floor(Math.random() * 3) + 1;
    ctx.session = ctx.session || {};
    ctx.session.miniGameNumber = number;

    return ctx.reply('🎮 Угадай число от 1 до 3', Markup.inlineKeyboard([
      [Markup.button.callback('1', 'guess_1'), Markup.button.callback('2', 'guess_2'), Markup.button.callback('3', 'guess_3')]
    ]));
  }

  if (action.startsWith('guess_')) {
    const guess = parseInt(action.split('_')[1]);
    ctx.session = ctx.session || {};
    const correct = ctx.session.miniGameNumber;
    delete ctx.session.miniGameNumber;

    if (!correct) {
      return ctx.answerCbQuery('❗ Игра не запущена', { show_alert: true });
    }

    if (guess === correct) {
      db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(id);
      return ctx.answerCbQuery('🎉 Правильно! +5 звёзд', { show_alert: true });
    } else {
      return ctx.answerCbQuery(`❌ Неверно. Было: ${correct}`, { show_alert: true });
    }
  }

  if (action === 'back') {
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }
});

// Обработка промокодов и рассылки
bot.on('message', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session?.broadcast && id === ADMIN_ID) {
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch {}
    }
    ctx.session.broadcast = false;
    return ctx.reply('✅ Рассылка завершена.');
  }

  if (ctx.session?.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);

    if (!promo) {
      ctx.session.waitingForCode = false;
      return ctx.reply('❌ Неверный промокод!');
    }

    if (promo.used_by) {
      ctx.session.waitingForCode = false;
      return ctx.reply('⚠️ Этот промокод уже использован.');
    }

    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, id);
    db.prepare('UPDATE promo_codes SET used_by = ? WHERE code = ?').run(id, code);

    ctx.session.waitingForCode = false;
    return ctx.reply(`✅ Промокод активирован! +${promo.reward} звёзд`);
  }

  if (ctx.session?.waitingForPromo && id === ADMIN_ID) {
    const [code, rewardStr] = ctx.message.text.trim().split(/\s+/);
    const reward = parseInt(rewardStr);

    if (!code || isNaN(reward)) {
      return ctx.reply('⚠️ Неверный формат. Используйте: `КОД 10`', { parse_mode: 'Markdown' });
    }

    db.prepare('INSERT INTO promo_codes (code, reward) VALUES (?, ?)').run(code, reward);
    ctx.session.waitingForPromo = false;
    return ctx.reply(`✅ Промокод "${code}" на ${reward} звёзд добавлен.`);
  }
});

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

bot.launch().then(() => console.log('🤖 Бот запущен!'));