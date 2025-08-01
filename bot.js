const { Telegraf, Markup, session } = require('telegraf');
const Database = require('better-sqlite3');
const db = new Database('users.db');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const ADMIN_ID = 6587897295; // <-- ЗАМЕНИ НА СВОЙ TELEGRAM ID
const REQUIRED_CHANNEL = '@magnumtap'; // <-- ЗАМЕНИ НА @username ТВОЕГО КАНАЛА

// Создание таблиц
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    last_farm INTEGER DEFAULT 0,
    last_bonus INTEGER DEFAULT 0,
    ref_by INTEGER,
    total_refs INTEGER DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS promocodes (
    code TEXT PRIMARY KEY,
    stars INTEGER
  )
`).run();

// Проверка подписки
async function isUserSubscribed(ctx) {
  try {
    const res = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(res.status);
  } catch {
    return false;
  }
}

// Регистрируем пользователя
function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || null;
  const ref_by = ctx.session.ref;

  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!exists) {
    db.prepare('INSERT INTO users (id, username, ref_by) VALUES (?, ?, ?)').run(id, username, ref_by || null);

    // Увеличим счетчик у пригласившего
    if (ref_by) {
      db.prepare('UPDATE users SET total_refs = total_refs + 1 WHERE id = ?').run(ref_by);
    }
  }
}

// Главное меню
function sendMainMenu(ctx) {
  ctx.reply('🌌 Главное меню', Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm')],
    [Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('🏆 Топ', 'top')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('🎫 Ввести промокод', 'promo')]
  ]));
}

// Приветствие
bot.start(async (ctx) => {
  const sub = await isUserSubscribed(ctx);

  // Сохраняем реферала
  const ref = ctx.startPayload;
  if (ref && !isNaN(ref)) {
    ctx.session.ref = parseInt(ref);
  }

  if (!sub) {
    return ctx.reply(`📢 Подпишитесь на канал ${REQUIRED_CHANNEL} и нажмите кнопку ниже`, Markup.inlineKeyboard([
      [Markup.button.url('📲 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  registerUser(ctx);
  sendMainMenu(ctx);
});

// Проверка подписки
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const action = ctx.callbackQuery.data;

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }
    registerUser(ctx);
    return sendMainMenu(ctx);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return ctx.answerCbQuery('🔒 Сначала подпишитесь на канал и нажмите "✅ Я подписался"', { show_alert: true });
  }

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.answerCbQuery('🔒 Подпишитесь на канал!', { show_alert: true });
  }

  // Удалим старое сообщение
  try { await ctx.deleteMessage(); } catch {}

  if (action === 'farm') {
    const now = Date.now();
    if (now - user.last_farm < 60000) {
      return ctx.answerCbQuery('⏳ Фарм доступен раз в 60 сек.', { show_alert: true });
    }

    const stars = Math.floor(Math.random() * 3) + 1;
    db.prepare('UPDATE users SET stars = stars + ?, last_farm = ? WHERE id = ?').run(stars, now, id);
    return ctx.answerCbQuery(`⭐ Вы добыли ${stars} звезды!`, { show_alert: true });
  }

  if (action === 'bonus') {
    const now = Date.now();
    if (now - user.last_bonus < 86400000) {
      return ctx.answerCbQuery('🎁 Бонус можно раз в 24ч.', { show_alert: true });
    }

    const stars = 10;
    db.prepare('UPDATE users SET stars = stars + ?, last_bonus = ? WHERE id = ?').run(stars, now, id);
    return ctx.answerCbQuery(`🎉 Вы получили ${stars} звёзд!`, { show_alert: true });
  }

  if (action === 'profile') {
    await ctx.reply(`👤 Профиль\n\n🆔 ID: ${id}\n⭐ Звёзды: ${user.stars}\n👥 Рефералы: ${user.total_refs}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'top') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'нет ника'} — ${u.stars}⭐`).join('\n');
    await ctx.reply(`🏆 Топ 10:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const stars = db.prepare('SELECT SUM(stars) as total FROM users').get().total || 0;
    await ctx.reply(`📊 Статистика\n\n👥 Пользователи: ${total}\n⭐ Всего звёзд: ${stars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'promo') {
    ctx.session.waitingForPromo = true;
    return ctx.reply('🎫 Введите промокод:');
  }

  if (action === 'back') {
    return sendMainMenu(ctx);
  }

  // --- Админка ---
  if (ctx.from.id === ADMIN_ID) {
    if (action === 'admin') {
      return ctx.reply('👮 Админ-панель', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('📤 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('🏆 Топ-10', 'admin_top')],
        [Markup.button.callback('👥 Пользователи', 'admin_users')],
        [Markup.button.callback('🎫 Добавить промокод', 'admin_add_promo')]
      ]));
    }

    if (action === 'admin_stats') {
      const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
      return ctx.answerCbQuery(`👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`, { show_alert: true });
    }

    if (action === 'admin_top') {
      const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
      const list = top.map((u, i) => `${i + 1}. @${u.username || 'нет ника'} — ${u.stars}⭐`).join('\n');
      return ctx.reply(`🏆 Топ 10:\n\n${list}`);
    }

    if (action === 'admin_users') {
      const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      return ctx.answerCbQuery(`👥 Всего пользователей: ${total}`, { show_alert: true });
    }

    if (action === 'admin_broadcast') {
      ctx.session.waitingForBroadcast = true;
      return ctx.reply('✍️ Введите текст рассылки:');
    }

    if (action === 'admin_add_promo') {
      ctx.session.waitingForPromoCreation = true;
      return ctx.reply('🎫 Введите промокод и кол-во звёзд через пробел (пример: CODE123 50)');
    }
  }
});

// Обработка текстовых сообщений
bot.on('message', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session.waitingForPromo) {
    const input = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(input);

    if (!promo) {
      ctx.session.waitingForPromo = false;
      return ctx.reply('❌ Промокод не найден!');
    }

    db.prepare('DELETE FROM promocodes WHERE code = ?').run(input);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.stars, id);

    ctx.session.waitingForPromo = false;
    return ctx.reply(`✅ Промокод активирован!\nВы получили ${promo.stars}⭐`);
  }

  if (ctx.session.waitingForBroadcast && ctx.from.id === ADMIN_ID) {
    const text = ctx.message.text;
    const users = db.prepare('SELECT id FROM users').all();
    let sent = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id, text);
        sent++;
      } catch {}
    }

    ctx.session.waitingForBroadcast = false;
    return ctx.reply(`✅ Рассылка завершена. Отправлено: ${sent}/${users.length}`);
  }

  if (ctx.session.waitingForPromoCreation && ctx.from.id === ADMIN_ID) {
    const parts = ctx.message.text.trim().split(' ');
    const code = parts[0];
    const stars = parseInt(parts[1]);

    if (!code || isNaN(stars)) {
      ctx.session.waitingForPromoCreation = false;
      return ctx.reply('❌ Неверный формат. Пример: CODE123 50');
    }

    db.prepare('INSERT OR REPLACE INTO promocodes (code, stars) VALUES (?, ?)').run(code, stars);
    ctx.session.waitingForPromoCreation = false;
    return ctx.reply(`✅ Промокод "${code}" добавлен на ${stars}⭐`);
  }
});

// Команда для входа в админ-панель
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🔐 Вход в админ-панель...', Markup.inlineKeyboard([
    [Markup.button.callback('Открыть панель', 'admin')]
  ]));
});

bot.launch();
console.log('✅ Бот запущен');