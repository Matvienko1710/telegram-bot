const { Telegraf, Markup, session } = require('telegraf');
const Database = require('better-sqlite3');
const db = new Database('users.db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const ADMIN_ID = 6587897295; // Замени на свой ID
const CHANNEL_ID = '@magnumtap'; // Замени на свой канал

// Таблицы
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  stars INTEGER DEFAULT 0,
  referrer INTEGER,
  last_farm INTEGER DEFAULT 0
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY,
  stars INTEGER,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS used_promocodes (
  user_id INTEGER,
  code TEXT,
  PRIMARY KEY (user_id, code)
)`).run();

function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || null;
  const ref = ctx.session.ref;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    db.prepare('INSERT INTO users (id, username, referrer) VALUES (?, ?, ?)').run(id, username, ref || null);
    if (ref) {
      db.prepare('UPDATE users SET stars = stars + 1 WHERE id = ?').run(ref);
      bot.telegram.sendMessage(ref, `🎉 Новый реферал: @${ctx.from.username || 'пользователь'}! +1⭐`);
    }
  }
}

async function isUserSubscribed(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch {
    return false;
  }
}

function sendMainMenu(ctx) {
  return ctx.reply('🌌 Добро пожаловать в MagnumTap!', Markup.inlineKeyboard([
    [Markup.button.callback('⛏ Фарм', 'farm')],
    [Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('🏆 Топ', 'top'), Markup.button.callback('👤 Профиль', 'profile')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('🎁 Промокод', 'promo')]
  ]));
}

bot.start(async (ctx) => {
  const id = ctx.from.id;
  const ref = ctx.startPayload;
  if (ref && !isNaN(ref)) ctx.session.ref = Number(ref);

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply('🔒 Подпишись на канал и нажми "✅ Я подписался"', Markup.inlineKeyboard([
      [Markup.button.url('📢 Перейти в канал', `https://t.me/${CHANNEL_ID.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  registerUser(ctx);
  return sendMainMenu(ctx);
});

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.reply('👮 Админ-панель', Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('📤 Рассылка', 'admin_broadcast')],
    [Markup.button.callback('🏆 Топ-10', 'admin_top')],
    [Markup.button.callback('👥 Пользователи', 'admin_users')],
    [Markup.button.callback('➕ Создать промокод', 'admin_create_promo')]
  ]));
});

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
    return ctx.answerCbQuery('🔒 Подпишись и нажми "✅ Я подписался"', { show_alert: true });
  }

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.answerCbQuery('🔒 Без подписки бот недоступен', { show_alert: true });
  }

  // --- Основной функционал ---
  if (action === 'farm') {
    const now = Math.floor(Date.now() / 1000);
    if (now - user.last_farm < 60) {
      return ctx.answerCbQuery('⏳ Фарм доступен раз в 60 секунд!', { show_alert: true });
    }
    db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, id);
    return ctx.answerCbQuery('⭐ +1 звезда!', { show_alert: true });
  }

  if (action === 'bonus') {
    db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(id);
    return ctx.answerCbQuery('🎁 +5 бонусных звёзд!', { show_alert: true });
  }

  if (action === 'profile') {
    const refCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE referrer = ?').get(id).count;
    const text = `👤 Профиль\n\n⭐ Звёзды: ${user.stars}\n👥 Рефералов: ${refCount}\n🔗 Реф. ссылка: t.me/${ctx.me}?start=${id}`;
    const msg = await ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    ctx.session?.lastMessageId && ctx.deleteMessage(ctx.session.lastMessageId).catch(() => {});
    ctx.session.lastMessageId = msg.message_id;
    return;
  }

  if (action === 'top') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    const msg = await ctx.reply(`🏆 Топ 10:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    ctx.session?.lastMessageId && ctx.deleteMessage(ctx.session.lastMessageId).catch(() => {});
    ctx.session.lastMessageId = msg.message_id;
    return;
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as sum FROM users').get().sum || 0;
    const msg = await ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    ctx.session?.lastMessageId && ctx.deleteMessage(ctx.session.lastMessageId).catch(() => {});
    ctx.session.lastMessageId = msg.message_id;
    return;
  }

  if (action === 'promo') {
    ctx.session.waitingPromo = true;
    return ctx.reply('🎁 Введите промокод:');
  }

  if (action === 'back') {
    ctx.session?.lastMessageId && ctx.deleteMessage(ctx.session.lastMessageId).catch(() => {});
    return sendMainMenu(ctx);
  }

  // --- Админка ---
  if (ctx.from.id === ADMIN_ID) {
    if (action === 'admin_stats') {
      const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
      return ctx.answerCbQuery(`👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`, { show_alert: true });
    }

    if (action === 'admin_top') {
      const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
      const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
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

    if (action === 'admin_create_promo') {
      ctx.session.waitingForPromo = true;
      return ctx.reply('✍️ Введите промокод в формате:\n\n`КОД КОЛ-ВО_ЗВЕЗД МАКС_ИСПОЛЬЗОВАНИЙ`\n\nПример: `MAGIC50 50 100`', { parse_mode: 'Markdown' });
    }
  }
});

bot.on('message', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session?.waitingForBroadcast && ctx.from.id === ADMIN_ID) {
    ctx.session.waitingForBroadcast = false;
    const users = db.prepare('SELECT id FROM users').all();
    let sent = 0;
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id, ctx.message.text);
        sent++;
      } catch {}
    }
    return ctx.reply(`✅ Рассылка отправлена: ${sent}/${users.length}`);
  }

  if (ctx.session?.waitingForPromo && ctx.from.id === ADMIN_ID) {
    ctx.session.waitingForPromo = false;
    const [code, stars, max_uses] = ctx.message.text.trim().split(/\s+/);
    if (!code || isNaN(stars) || isNaN(max_uses)) {
      return ctx.reply('❌ Неверный формат');
    }
    db.prepare('INSERT OR REPLACE INTO promocodes (code, stars, max_uses) VALUES (?, ?, ?)').run(code, Number(stars), Number(max_uses));
    return ctx.reply(`✅ Промокод ${code} создан: ${stars}⭐, максимум использований: ${max_uses}`);
  }

  if (ctx.session?.waitingPromo) {
    ctx.session.waitingPromo = false;
    const code = ctx.message.text.trim();

    const promo = db.prepare('SELECT * FROM promocodes WHERE code = ?').get(code);
    if (!promo) return ctx.reply('❌ Промокод не найден');
    const used = db.prepare('SELECT * FROM used_promocodes WHERE user_id = ? AND code = ?').get(id, code);
    if (used) return ctx.reply('⚠️ Вы уже использовали этот промокод');
    if (promo.uses >= promo.max_uses) return ctx.reply('⚠️ Промокод уже израсходован');

    db.prepare('UPDATE promocodes SET uses = uses + 1 WHERE code = ?').run(code);
    db.prepare('INSERT INTO used_promocodes (user_id, code) VALUES (?, ?)').run(id, code);
    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.stars, id);

    return ctx.reply(`🎉 Промокод активирован! +${promo.stars}⭐`);
  }
});

bot.launch();