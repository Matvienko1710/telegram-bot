const { Telegraf, Markup, session } = require('telegraf');
const Database = require('better-sqlite3');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session()); // обязательно

const db = new Database('users.db');
const REQUIRED_CHANNEL = '@magnumtap'; // замените на свой канал
const ADMIN_ID = 6587897295; // ваш Telegram ID

// Таблицы
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  stars INTEGER DEFAULT 0,
  referred_by INTEGER,
  bonus_time INTEGER DEFAULT 0
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY,
  reward INTEGER
)`).run();

// Проверка подписки
async function isSubscribed(userId) {
  try {
    const res = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${REQUIRED_CHANNEL}&user_id=${userId}`);
    const status = res.data.result.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch {
    return false;
  }
}

// Главное меню
function getMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💫 Фарм', 'farm')],
    [Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile')],
    [Markup.button.callback('🏆 Топ', 'leaders')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('📨 Ввести промокод', 'promo')],
    [Markup.button.callback('📣 Пригласить', 'ref')]
  ]);
}

// Зарегистрировать пользователя
function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const ref_by = ctx.session?.ref || null;

  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!exists) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, ref_by);
  }
}

// Обработчик /start
bot.start(async (ctx) => {
  if (ctx.startPayload) ctx.session.ref = parseInt(ctx.startPayload);
  registerUser(ctx);

  const subscribed = await isSubscribed(ctx.from.id);
  if (!subscribed) {
    return ctx.reply('🔒 Для доступа подпишитесь на канал:', Markup.inlineKeyboard([
      [Markup.button.url('📢 Перейти в канал', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  return ctx.reply('👋 Добро пожаловать в MagnumTap!', getMainMenu());
});

// Проверка подписки
bot.action('check_sub', async (ctx) => {
  const subscribed = await isSubscribed(ctx.from.id);
  if (subscribed) {
    registerUser(ctx);
    return ctx.editMessageText('✅ Подписка подтверждена!', getMainMenu());
  } else {
    return ctx.answerCbQuery('❌ Подписка не найдена', { show_alert: true });
  }
});

// Callback действия
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const action = ctx.callbackQuery.data;

  if (!await isSubscribed(id)) {
    return ctx.editMessageText('🔒 Доступ запрещён. Подпишитесь на канал:', Markup.inlineKeyboard([
      [Markup.button.url('📢 Перейти в канал', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (action === 'farm') {
    db.prepare('UPDATE users SET stars = stars + 1 WHERE id = ?').run(id);
    return ctx.answerCbQuery('💫 +1 звезда!');
  }

  if (action === 'bonus') {
    const now = Math.floor(Date.now() / 1000);
    if (now - user.bonus_time < 3600) {
      const remaining = 3600 - (now - user.bonus_time);
      const minutes = Math.ceil(remaining / 60);
      return ctx.answerCbQuery(`⌛ Бонус через ${minutes} мин.`, { show_alert: true });
    } else {
      db.prepare('UPDATE users SET stars = stars + 10, bonus_time = ? WHERE id = ?').run(now, id);
      return ctx.answerCbQuery('🎁 +10 бонусных звёзд!');
    }
  }

  if (action === 'profile') {
    const invited = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(id).c;
    return ctx.editMessageText(`👤 Профиль:
🆔 ID: ${user.id}
💫 Звёзды: ${user.stars}
👥 Приглашено: ${invited}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'leaders') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const text = top.map((u, i) => `${i + 1}. @${u.username || 'anon'} — ${u.stars}⭐`).join('\n');
    return ctx.editMessageText(`🏆 Топ игроков:\n\n${text}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const sum = db.prepare('SELECT SUM(stars) as s FROM users').get().s || 0;
    return ctx.editMessageText(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${sum}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    return ctx.editMessageText(`📣 Приглашай друзей и получай звёзды!
Твоя ссылка: ${link}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'promo') {
    ctx.session.waitingPromo = true;
    return ctx.editMessageText('🎟 Введите промокод:');
  }

  if (action === 'back') {
    try { await ctx.deleteMessage(); } catch {}
    return ctx.reply('📍 Главное меню:', getMainMenu());
  }

  // Админ-панель
  if (id === ADMIN_ID && action === 'admin') {
    return ctx.editMessageText('🛠 Админ-панель', Markup.inlineKeyboard([
      [Markup.button.callback('📨 Рассылка', 'broadcast')],
      [Markup.button.callback('📋 Топ игроков', 'leaders')],
      [Markup.button.callback('📊 Статистика', 'stats')],
      [Markup.button.callback('➕ Добавить промокод', 'addpromo')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (id === ADMIN_ID && action === 'broadcast') {
    ctx.session.waitingBroadcast = true;
    return ctx.editMessageText('📨 Введите текст для рассылки:');
  }

  if (id === ADMIN_ID && action === 'addpromo') {
    ctx.session.waitingPromocode = true;
    return ctx.editMessageText('🆕 Введите промокод и награду через пробел (например: TAP2025 25)');
  }
});

// Ввод текста
bot.on('text', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session.waitingBroadcast && id === ADMIN_ID) {
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch {}
    }
    ctx.session.waitingBroadcast = false;
    return ctx.reply('✅ Рассылка завершена');
  }

  if (ctx.session.waitingPromocode && id === ADMIN_ID) {
    const [code, reward] = ctx.message.text.trim().split(' ');
    if (!code || isNaN(reward)) {
      return ctx.reply('⚠ Неверный формат. Пример: `TAP2025 25`');
    }
    try {
      db.prepare('INSERT INTO promocodes (code, reward) VALUES (?, ?)').run(code, parseInt(reward));
      ctx.reply('✅ Промокод добавлен!');
    } catch {
      ctx.reply('❌ Такой промокод уже существует!');
    }
    ctx.session.waitingPromocode = false;
    return;
  }

  if (ctx.session.waitingPromo) {
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(code);
    if (!promo) return ctx.reply('❌ Неверный промокод');

    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, id);
    db.prepare('DELETE FROM promocodes WHERE code = ?').run(code);
    ctx.session.waitingPromo = false;
    return ctx.reply(`🎉 Вы получили ${promo.reward} звёзд!`);
  }
});

bot.launch();
console.log('🤖 Бот запущен!');