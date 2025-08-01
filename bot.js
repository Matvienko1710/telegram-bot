const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = 6587897295;
const REQUIRED_CHANNEL = '@magnumtap';

function sendMainMenu(ctx) {
  return ctx.reply('🚀 Главное меню', Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm'), Markup.button.callback('🎁 Бонус', 'bonus')],
    [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('🏆 Лидеры', 'leaders')],
    [Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    [Markup.button.callback('🎮 Мини-игра', 'mini_game')],
    ctx.from.id === ADMIN_ID ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

bot.start(async (ctx) => {
  const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
  if (['member', 'creator', 'administrator'].includes(member.status)) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    if (!user) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(ctx.from.id, ctx.from.username || '');
    }
    await ctx.reply(`👋 Добро пожаловать, ${ctx.from.first_name}!`);
    return sendMainMenu(ctx);
  } else {
    return ctx.reply('❗️Для использования бота подпишитесь на канал и нажмите "Готово"', Markup.inlineKeyboard([
      [Markup.button.url('🔗 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Готово', 'check_sub')]
    ]));
  }
});

bot.action('check_sub', async (ctx) => {
  const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
  if (['member', 'creator', 'administrator'].includes(member.status)) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    if (!user) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(ctx.from.id, ctx.from.username || '');
    }
    await ctx.deleteMessage();
    await ctx.reply(`👋 Добро пожаловать, ${ctx.from.first_name}!`);
    return sendMainMenu(ctx);
  } else {
    return ctx.answerCbQuery('❗️Сначала подпишитесь на канал!', { show_alert: true });
  }
});

bot.action(/.+/, async (ctx) => {
  const action = ctx.callbackQuery.data;

  if (action === 'farm') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    const now = Date.now();
    if (now - user.last_farm >= 60 * 1000) {
      db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, ctx.from.id);
      return ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: true });
    } else {
      const secondsLeft = Math.ceil((60 * 1000 - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⌛ Подождите ${secondsLeft} сек.`, { show_alert: true });
    }
  }

  if (action === 'bonus') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    const now = new Date();
    const lastBonus = user.last_bonus ? new Date(user.last_bonus) : null;
    if (!lastBonus || now - lastBonus >= 24 * 60 * 60 * 1000) {
      db.prepare('UPDATE users SET stars = stars + 10, last_bonus = ? WHERE id = ?').run(now.toISOString(), ctx.from.id);
      return ctx.answerCbQuery('🎁 Вы получили 10 звёзд!', { show_alert: true });
    } else {
      const hoursLeft = 24 - Math.floor((now - lastBonus) / (60 * 60 * 1000));
      return ctx.answerCbQuery(`⌛ Бонус будет доступен через ${hoursLeft} ч.`, { show_alert: true });
    }
  }

  if (action === 'profile') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    return ctx.answerCbQuery(`👤 Профиль\nЗвёзды: ${user.stars}`, { show_alert: true });
  }

  if (action === 'leaders') {
    const top = db.prepare('SELECT * FROM users ORDER BY stars DESC LIMIT 10').all();
    let text = '🏆 Топ 10 лидеров:\n\n';
    top.forEach((u, i) => {
      const refCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE referred_by = ?').get(u.id).count;
      text += `${i + 1}. @${u.username || 'без ника'} — ⭐ ${u.stars} звёзд, 👥 ${refCount} рефералов\n`;
    });
    await ctx.reply(text);
  }

  if (action === 'stats') {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    return ctx.answerCbQuery(`📊 Всего пользователей: ${count}`, { show_alert: true });
  }

  if (action === 'ref') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    return ctx.reply(`📩 Приглашайте друзей по ссылке:\nhttps://t.me/${bot.botInfo.username}?start=${ctx.from.id}`);
  }

  if (action === 'enter_code') {
    ctx.session = ctx.session || {};
    ctx.session.awaitingCode = true;
    return ctx.reply('💡 Введите промокод:');
  }

  if (action === 'mini_game') {
    return ctx.reply('🎮 Угадай число от 1 до 3', Markup.inlineKeyboard([
      [Markup.button.callback('1️⃣', 'guess_1')],
      [Markup.button.callback('2️⃣', 'guess_2')],
      [Markup.button.callback('3️⃣', 'guess_3')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action.startsWith('guess_')) {
    const correct = Math.floor(Math.random() * 3) + 1;
    const guess = parseInt(action.split('_')[1]);
    if (guess === correct) {
      db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(ctx.from.id);
      await ctx.answerCbQuery('🎉 Правильно! +5 звёзд!', { show_alert: true });
    } else {
      await ctx.answerCbQuery(`❌ Неверно! Было: ${correct}`, { show_alert: true });
    }
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }

  if (action === 'back') {
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }

  if (action === 'admin' && ctx.from.id === ADMIN_ID) {
    return ctx.reply('⚙️ Админ-панель', Markup.inlineKeyboard([
      [Markup.button.callback('📢 Рассылка', 'broadcast')],
      [Markup.button.callback('📈 Статистика', 'stats')],
    ]));
  }

  if (action === 'broadcast' && ctx.from.id === ADMIN_ID) {
    ctx.session = ctx.session || {};
    ctx.session.awaitingBroadcast = true;
    return ctx.reply('📢 Введите текст рассылки:');
  }
});

bot.on('text', async (ctx) => {
  ctx.session = ctx.session || {};

  if (ctx.session.awaitingCode) {
    ctx.session.awaitingCode = false;
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
    if (promo) {
      db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, ctx.from.id);
      db.prepare('DELETE FROM promo_codes WHERE code = ?').run(code);
      return ctx.reply(`✅ Промокод применён! +${promo.reward} звёзд`);
    } else {
      return ctx.reply('❌ Неверный или уже использованный промокод');
    }
  }

  if (ctx.session.awaitingBroadcast && ctx.from.id === ADMIN_ID) {
    ctx.session.awaitingBroadcast = false;
    const users = db.prepare('SELECT id FROM users').all();
    users.forEach(user => {
      bot.telegram.sendMessage(user.id, `📢 Рассылка:\n\n${ctx.message.text}`).catch(() => {});
    });
    return ctx.reply('✅ Рассылка отправлена.');
  }

  // Реферал
  if (ctx.message.text.startsWith('/start')) {
    const parts = ctx.message.text.split(' ');
    const refId = parts.length > 1 ? parseInt(parts[1]) : null;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    if (!user) {
      db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(
        ctx.from.id,
        ctx.from.username || '',
        refId || null
      );

      if (refId) {
        db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(refId);
        bot.telegram.sendMessage(refId, `🎉 Новый реферал: @${ctx.from.username || 'без ника'}! +5 звёзд`);
      }
    }

    return sendMainMenu(ctx);
  }
});

bot.launch();