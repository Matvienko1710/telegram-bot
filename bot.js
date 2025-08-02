const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
const db = require('./db');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Проверка структуры таблицы users
try {
  const tableInfo = db.prepare('PRAGMA table_info(users)').all();
  const expectedColumns = [
    { name: 'id', type: 'INTEGER', notnull: 0, pk: 1 },
    { name: 'username', type: 'TEXT', notnull: 0 },
    { name: 'stars', type: 'INTEGER', notnull: 0, dflt_value: '0' },
    { name: 'last_farm', type: 'INTEGER', notnull: 0, dflt_value: '0' },
    { name: 'last_bonus', type: 'TEXT', notnull: 0, dflt_value: 'NULL' },
    { name: 'referred_by', type: 'INTEGER', notnull: 0 },
    { name: 'daily_task_date', type: 'TEXT', notnull: 0, dflt_value: 'NULL' },
    { name: 'daily_task_type', type: 'TEXT', notnull: 0, dflt_value: 'NULL' },
    { name: 'daily_task_progress', type: 'INTEGER', notnull: 0, dflt_value: '0' },
    { name: 'daily_task_completed', type: 'INTEGER', notnull: 0, dflt_value: '0' }
  ];
  const isValid = expectedColumns.every(col => {
    const found = tableInfo.find(t => t.name === col.name);
    return found && found.type === col.type && found.notnull === col.notnull && (col.pk ? found.pk === col.pk : true);
  });
  if (!isValid) {
    console.error('Ошибка: структура таблицы users не соответствует ожиданиям', tableInfo);
  } else {
    console.log('Структура таблицы users корректна');
  }
} catch (e) {
  console.error('Ошибка проверки структуры таблицы users:', e);
}

// Проверка и создание таблицы support_tickets
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT,
      issue TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      channel_message_id INTEGER
    )
  `).run();
  console.log('Таблица support_tickets готова');
} catch (e) {
  console.error('Ошибка создания таблицы support_tickets:', e);
}

// Очистка старых сессий (старше 7 дней)
try {
  db.prepare('DELETE FROM sessions WHERE strftime("%s", "now") - json_extract(data, "$.last_access") > 604800').run();
  console.log('Устаревшие сессии удалены');
} catch (e) {
  console.error('Ошибка очистки сессий:', e);
}

// Настройка хранилища сессий
const sessionDB = {
  get: (key) => {
    const row = db.prepare('SELECT data FROM sessions WHERE id = ?').get(key);
    return row ? JSON.parse(row.data) : undefined;
  },
  set: (key, value) => {
    value.last_access = Math.floor(Date.now() / 1000);
    db.prepare('INSERT OR REPLACE INTO sessions (id, data) VALUES (?, ?)').run(key, JSON.stringify(value));
  },
  delete: (key) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(key);
  }
};

bot.use(session({
  store: sessionDB,
  getSessionKey: (ctx) => ctx.from && ctx.chat ? `${ctx.from.id}:${ctx.chat.id}` : undefined
}));

const REQUIRED_CHANNELS = ['@magnumtap', '@magnumwithdraw'];
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [6587897295];
const SUPPORT_USERNAME = '@magnumsupported'; // Юзернейм для отправки сообщений в канал
const SUPPORT_LINK = 'https://t.me/magnumsupported'; // Ссылка для отображения в сообщениях
const BOT_LINK = 'https://t.me/firestars_rbot';
const TASK_BOT_LINK = process.env.TASK_BOT_LINK || 'https://t.me/OtherBot';
const WITHDRAW_CHANNEL = '@magnumwithdraw';
const FARM_COOLDOWN_SECONDS = parseInt(process.env.FARM_COOLDOWN_SECONDS || '60');
const SCREENSHOT_LIMIT_SECONDS = 60;

function logAction(userId, action, category = 'GENERAL') {
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO logs (user_id, action, timestamp) VALUES (?, ?, ?)').run(userId, `${category}: ${action}`, Date.now());
  console.log(`[${timestamp}] [${category}] User ${userId}: ${action}`);
}

async function isUserSubscribed(ctx) {
  ctx.session = ctx.session || {};
  if (ctx.session.subscribed) {
    logAction(ctx.from.id, 'subscription_cached', 'SUBSCRIPTION');
    return true;
  }

  const memberStatuses = await Promise.all(
    REQUIRED_CHANNELS.map(async (channel) => {
      try {
        const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
        return ['member', 'administrator', 'creator'].includes(member.status);
      } catch (e) {
        console.error(`Ошибка проверки подписки на ${channel}:`, e);
        logAction(ctx.from.id, `subscription_check_error_${channel}`, 'SUBSCRIPTION');
        return false;
      }
    })
  );

  const subscribed = memberStatuses.every(status => status);
  if (subscribed) {
    ctx.session.subscribed = true;
    logAction(ctx.from.id, 'subscription_confirmed', 'SUBSCRIPTION');
  }
  return subscribed;
}

async function sendWithdrawRequest(ctx, userId, username, amount) {
  const transaction = db.transaction(() => {
    const insert = db.prepare('INSERT INTO withdraws (user_id, username, amount, status) VALUES (?, ?, ?, ?)');
    const result = insert.run(Number(userId), username || '', amount, 'pending');
    return result.lastInsertRowid;
  });

  try {
    const withdrawId = transaction();
    const message = await ctx.telegram.sendMessage(WITHDRAW_CHANNEL, `💸 Заявка на вывод
👤 Пользователь: @${username || 'без ника'} (ID: ${userId})
💫 Сумма: ${amount}⭐

🔄 Статус: Ожидает обработки ⚙️`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Одобрить', callback_data: `approve_withdraw_${withdrawId}` },
          { text: '❌ Отклонить', callback_data: `reject_withdraw_${withdrawId}` }
        ]]
      }
    });

    db.prepare('UPDATE withdraws SET channel_message_id = ? WHERE id = ?').run(message.message_id, withdrawId);
    logAction(userId, `withdraw_request_${amount}`, 'WITHDRAW');
  } catch (e) {
    console.error('Ошибка отправки заявки на вывод:', e);
    logAction(userId, `withdraw_request_error_${amount}`, 'WITHDRAW');
    throw new Error('Не удалось отправить заявку на вывод');
  }
}

async function sendSupportTicket(ctx, userId, username, issue, type) {
  const transaction = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO support_tickets (user_id, username, issue, type, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(Number(userId), username || '', issue, type, 'open', Math.floor(Date.now() / 1000));
    return result.lastInsertRowid;
  });

  try {
    const ticketId = transaction();
    const message = await ctx.telegram.sendMessage(
      SUPPORT_USERNAME,
      `📩 Новый тикет #${ticketId} (${type})\n👤 Пользователь: @${username || 'без ника'} (ID: ${userId})\n📜 Проблема: ${issue}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📝 Ответить', callback_data: `admin_reply_ticket_${ticketId}` },
            { text: '❌ Закрыть', callback_data: `admin_close_ticket_${ticketId}` }
          ]]
        }
      }
    );

    db.prepare('UPDATE support_tickets SET channel_message_id = ? WHERE id = ?').run(message.message_id, ticketId);
    logAction(userId, `create_ticket_${type}_${ticketId}`, 'SUPPORT');
    return ticketId;
  } catch (e) {
    console.error('Ошибка отправки тикета в поддержку:', e);
    logAction(userId, `ticket_error_${type}_${e.message}`, 'SUPPORT');
    throw new Error('Не удалось отправить тикет в поддержку');
  }
}

function sendMainMenu(ctx) {
  return ctx.reply('🚀 Главное меню', Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Фарм', 'farm'), Markup.button.callback('🎁 Бонус', 'bonus')],
    [
      Markup.button.callback('👤 Профиль', 'profile'),
      Markup.button.callback('🏆 Лидеры', 'leaders'),
      Markup.button.callback('📊 Статистика', 'stats')
    ],
    [Markup.button.callback('📈 Биржа', 'exchange')],
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    [Markup.button.callback('📋 Задания', 'daily_tasks')],
    [Markup.button.callback('💰 Купить премиум', 'buy_premium')],
    [Markup.button.callback('💸 Баланс Stars', 'stars_balance')],
    ADMIN_IDS.includes(ctx.from.id) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

// Команда /start
bot.command('start', async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  logAction(id, 'start_command', 'USER');
  ctx.session = ctx.session || {};

  try {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      logAction(id, 'start_not_subscribed', 'USER');
      return ctx.reply(
        '🔒 Для доступа к функциям бота необходимо подписаться на каналы:',
        Markup.inlineKeyboard([
          ...REQUIRED_CHANNELS.map(channel => [
            Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
          ]),
          [Markup.button.callback('✅ Я подписался', 'check_sub')]
        ])
      );
    }

    const transaction = db.transaction(() => {
      const existing = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
      if (!existing) {
        db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(Number(id), username, referral ? Number(referral) : null);
        if (referral && referral !== id) {
          db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(Number(referral));
          logAction(referral, `referral_reward_${id}`, 'REFERRAL');
        }
        logAction(id, 'register', 'USER');
      } else if (existing.username !== username) {
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, Number(id));
        logAction(id, 'update_username', 'USER');
      }
    });

    transaction();
    if (referral && referral !== id) {
      try {
        await ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +5 звёзд`);
      } catch (e) {
        console.error(`Ошибка уведомления реферала ${referral}:`, e);
        logAction(id, `referral_notify_error_${referral}`, 'REFERRAL');
      }
    }

    await sendMainMenu(ctx);
    logAction(id, 'start_success', 'USER');
  } catch (e) {
    console.error(`Ошибка в /start для пользователя ${id}:`, e);
    logAction(id, `start_error_${e.message}`, 'ERROR');
    await ctx.reply(`❌ Ошибка при запуске бота. Попробуйте снова или обратитесь в ${SUPPORT_LINK}.`);
  }
});

// Команда /backup
bot.command('backup', (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('⛔ Доступ запрещён');
  const fs = require('fs');
  const backupPath = 'backup_database.db';
  try {
    fs.copyFileSync('database.db', backupPath);
    ctx.replyWithDocument({ source: backupPath, filename: 'database.db' });
    logAction(ctx.from.id, 'backup_database', 'ADMIN');
  } catch (e) {
    console.error('Ошибка создания бэкапа:', e);
    ctx.reply('❌ Ошибка при создании бэкапа базы данных.');
  }
});

// Команда /support
bot.command('support', async (ctx) => {
  const id = ctx.from.id;
  ctx.session = ctx.session || {};
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      '🔒 Для обращения в поддержку подпишитесь на каналы:',
      Markup.inlineKeyboard([
        ...REQUIRED_CHANNELS.map(channel => [
          Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
        ]),
        [Markup.button.callback('✅ Я подписался', 'check_sub')]
      ])
    );
  }
  ctx.session.waitingForSupport = true;
  return ctx.reply(`📞 Опишите вашу проблему, и мы свяжемся с вами через ${SUPPORT_LINK}.`);
});

// Команда /paysupport
bot.command('paysupport', async (ctx) => {
  const id = ctx.from.id;
  ctx.session = ctx.session || {};
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      '🔒 Для обращения в поддержку подпишитесь на каналы:',
      Markup.inlineKeyboard([
        ...REQUIRED_CHANNELS.map(channel => [
          Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
        ]),
        [Markup.button.callback('✅ Я подписался', 'check_sub')]
      ])
    );
  }
  ctx.session.waitingForPaySupport = true;
  return ctx.reply(`📞 Опишите проблему с оплатой Telegram Stars, и мы свяжемся с вами через ${SUPPORT_LINK}.`);
});

// Команда /buy
bot.command('buy', async (ctx) => {
  const id = ctx.from.id;
  ctx.session = ctx.session || {};
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      '🔒 Для покупки подпишитесь на каналы:',
      Markup.inlineKeyboard([
        ...REQUIRED_CHANNELS.map(channel => [
          Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
        ]),
        [Markup.button.callback('✅ Я подписался', 'check_sub')]
      ])
    );
  }

  try {
    const invoice = await ctx.telegram.sendInvoice(id, {
      title: 'Premium Badge',
      description: 'Получите эксклюзивный премиум-значок для вашего профиля!',
      payload: `premium_badge_${id}_${Date.now()}`,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: 'Premium Badge', amount: 10 }],
      start_parameter: 'buy_premium'
    });
    logAction(id, 'send_invoice_premium_badge', 'STARS');
  } catch (e) {
    console.error('Ошибка отправки инвойса:', e);
    logAction(id, `buy_error_${e.message}`, 'STARS');
    ctx.reply(`❌ Ошибка при создании платежа. Попробуйте снова или обратитесь в ${SUPPORT_LINK} через /paysupport.`);
  }
});

// Команда /stars_balance
bot.command('stars_balance', async (ctx) => {
  const id = ctx.from.id;
  ctx.session = ctx.session || {};
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      '🔒 Для проверки баланса Stars подпишитесь на каналы:',
      Markup.inlineKeyboard([
        ...REQUIRED_CHANNELS.map(channel => [
          Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
        ]),
        [Markup.button.callback('✅ Я подписался', 'check_sub')]
      ])
    );
  }

  try {
    const transactions = db.prepare(`
      SELECT item, amount, status, created_at 
      FROM stars_transactions 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all(Number(id));

    const totalStars = db.prepare('SELECT SUM(amount) as total FROM stars_transactions WHERE user_id = ? AND status = "completed"').get(Number(id)).total || 0;

    let text = `💰 Ваш баланс Telegram Stars: ${totalStars} XTR\n\nПоследние транзакции:\n`;
    if (transactions.length === 0) {
      text += '📉 Нет транзакций.';
    } else {
      text += transactions.map(t => {
        const date = new Date(t.created_at * 1000).toLocaleString('ru-RU');
        return `🛒 ${t.item}: ${t.amount} XTR (${t.status}) — ${date}`;
      }).join('\n');
    }

    logAction(id, 'check_stars_balance', 'STARS');
    return ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  } catch (e) {
    console.error('Ошибка проверки баланса Stars:', e);
    logAction(id, `stars_balance_error_${e.message}`, 'STARS');
    return ctx.reply(`❌ Ошибка при проверке баланса. Попробуйте снова или обратитесь в ${SUPPORT_LINK} через /paysupport.`);
  }
});

// Обработка pre_checkout_query
bot.on('pre_checkout_query', async (ctx) => {
  const id = ctx.from.id;
  const query = ctx.preCheckoutQuery;
  try {
    if (query.currency !== 'XTR') {
      return ctx.answerPreCheckoutQuery(false, 'Неподдерживаемая валюта');
    }
    await ctx.answerPreCheckoutQuery(true);
    logAction(id, `pre_checkout_${query.id}`, 'STARS');
  } catch (e) {
    console.error('Ошибка обработки pre_checkout_query:', e);
    logAction(id, `pre_checkout_error_${e.message}`, 'STARS');
    await ctx.answerPreCheckoutQuery(false, 'Ошибка обработки платежа');
  }
});

// Обработка успешного платежа
bot.on('successful_payment', async (ctx) => {
  const id = ctx.from.id;
  const payment = ctx.message.successful_payment;
  const payload = payment.invoice_payload;
  const item = payload.split('_')[0];
  const amount = payment.total_amount;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO stars_transactions (user_id, telegram_payment_id, amount, item, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(id), payment.telegram_payment_charge_id, amount, item, 'completed', Math.floor(Date.now() / 1000));
  });

  try {
    transaction();
    logAction(id, `successful_payment_${item}_${amount}`, 'STARS');
    await ctx.reply('🎉 Платёж успешен! Вы получили Premium Badge.');
  } catch (e) {
    console.error('Ошибка сохранения платежа:', e);
    logAction(id, `successful_payment_error_${e.message}`, 'STARS');
    await ctx.reply(`❌ Ошибка при обработке платежа. Свяжитесь с ${SUPPORT_LINK} через /paysupport.`);
  }
});

// Обработка callback_query
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.prepare('SELECT id, username, stars, last_farm, last_bonus, referred_by, daily_task_completed FROM users WHERE id = ?').get(Number(id));

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  ctx.session = ctx.session || {};

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }
    const username = ctx.from.username || '';
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(id));
    if (!existing) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(Number(id), username);
      logAction(id, 'check_subscription', 'USER');
    }
    await sendMainMenu(ctx);
    return ctx.answerCbQuery('✅ Подписка подтверждена');
  }

  if (action === 'support') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.editMessageText(
        '🔒 Для обращения в поддержку подпишитесь на каналы:',
        Markup.inlineKeyboard([
          ...REQUIRED_CHANNELS.map(channel => [
            Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
          ]),
          [Markup.button.callback('✅ Я подписался', 'check_sub')]
        ])
      );
    }
    ctx.session.waitingForSupport = true;
    return ctx.editMessageText(`📞 Опишите вашу проблему, и мы свяжемся с вами через ${SUPPORT_LINK}.`, {
      reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'back')]] }
    });
  }

  if (action === 'farm') {
    const cooldown = FARM_COOLDOWN_SECONDS * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }

    const reward = 0.1;
    db.prepare('UPDATE users SET stars = stars + ?, last_farm = ? WHERE id = ?').run(reward, now, Number(id));
    logAction(id, `farm_${reward}`, 'FARM');
    return ctx.answerCbQuery(`⭐ Вы заработали ${reward} звезды!`, { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус можно получить через ${hoursLeft} ч.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), Number(id));
    logAction(id, 'bonus_5', 'BONUS');
    return ctx.answerCbQuery('🎉 Вы получили ежедневный бонус: +5 звёзд!', { show_alert: true });
  }

  if (action === 'daily_tasks') {
    const text =
      `📋 <b>Задание 1 из 2: Подпишись на канал и пришли скриншот</b> 📋\n\n` +
      `🔹 Подпишитесь на канал ${REQUIRED_CHANNELS[0]}\n` +
      `🔹 Сделайте скриншот подписки\n` +
      `🔹 Пришлите скриншот сюда в чат для проверки администратором\n\n` +
      `После проверки и одобрения вы получите 1.5 звезды.`;

    return ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNELS[0].replace('@', '')}`)],
        [Markup.button.callback('▶️ Следующее задание', 'daily_tasks_2')],
        [Markup.button.callback('🔙 Назад', 'back')]
      ])
    );
  }

  if (action === 'daily_tasks_2') {
    const existing = db.prepare('SELECT id FROM screenshots WHERE user_id = ? AND task_type = ? AND approved = 1').get(Number(id), 'launch_bot');
    if (existing) {
      return ctx.answerCbQuery('❌ Вы уже выполнили задание "Запусти бота".', { show_alert: true });
    }

    const text =
      `📋 <b>Задание 2 из 2: Запусти бота</b> 📋\n\n` +
      `🚀 Запустите бота по ссылке ниже и отправьте скриншот запуска:\n` +
      `${TASK_BOT_LINK}\n\n` +
      `После проверки администратором вы получите 1.5 звезды.`;

    ctx.session.waitingForTask = 'launch_bot';
    return ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('▶️ Запустить бота', TASK_BOT_LINK)],
        [Markup.button.callback('🔙 Назад', 'back')],
        [Markup.button.callback('⬅️ Предыдущее задание', 'daily_tasks')]
      ])
    );
  }

  if (action === 'exchange') {
    return ctx.editMessageText(
      `📈 <b>Биржа MagnumCoin</b>\n\n` +
      `💱 Здесь в будущем вы сможете покупать и продавать MagnumCoin за звёзды.\n` +
      `📊 Цена будет меняться в реальном времени.\n\n` +
      `🚧 Функция в разработке. Следите за обновлениями!`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'back')]]) }
    );
  }

  if (['profile', 'leaders', 'stats', 'ref'].includes(action)) {
    await ctx.deleteMessage();
  }

  if (action === 'profile') {
    const invited = db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(Number(id)).count;
    const referredByUser = user.referred_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(Number(user.referred_by)) : null;
    const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
    const displayName = ctx.from.first_name || '—';

    const profileText =
      `🌟 Ваш профиль в MagnumTap 🌟\n\n` +
      `👤 Имя: ${displayName}\n` +
      `🆔 Telegram ID: ${user.id}\n\n` +
      `💫 Ваши звёзды: ${user.stars}\n` +
      `👥 Приглашено друзей: ${invited}\n` +
      `📣 Пригласил: ${referrerName}\n\n` +
      `🔥 Используйте звёзды для бонусов и акций!`;

    return ctx.reply(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('Вывести звёзды', 'withdraw_stars')],
      [Markup.button.callback('📞 Поддержка', 'support')],
      [Markup.button.callback('💸 Баланс Stars', 'stars_balance')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'withdraw_stars') {
    if (!user) return ctx.answerCbQuery('❌ Пользователь не найден', { show_alert: true });
    return ctx.editMessageText('Выберите сумму для вывода:', Markup.inlineKeyboard([
      [Markup.button.callback('15 ⭐', 'withdraw_15')],
      [Markup.button.callback('25 ⭐', 'withdraw_25')],
      [Markup.button.callback('50 ⭐', 'withdraw_50')],
      [Markup.button.callback('100 ⭐', 'withdraw_100')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action.startsWith('withdraw_') && action !== 'withdraw_stars') {
    const amount = parseInt(action.split('_')[1]);
    if (isNaN(amount)) return ctx.answerCbQuery('❌ Неверная сумма вывода', { show_alert: true });

    if (!user || user.stars < amount) return ctx.answerCbQuery('Недостаточно звёзд для вывода.', { show_alert: true });

    const transaction = db.transaction(() => {
      db.prepare('UPDATE users SET stars = stars - ? WHERE id = ?').run(amount, Number(ctx.from.id));
      sendWithdrawRequest(ctx, ctx.from.id, ctx.from.username || '', amount);
    });

    try {
      transaction();
      return ctx.editMessageText(`✅ Заявка на вывод ${amount} ⭐ отправлена на обработку.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
    } catch (e) {
      db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(amount, Number(ctx.from.id));
      logAction(id, `withdraw_error_${amount}_${e.message}`, 'WITHDRAW');
      return ctx.answerCbQuery('❌ Ошибка при отправке заявки', { show_alert: true });
    }
  }

  if (action === 'leaders') {
    const top = db.prepare(`
      SELECT username, stars, (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals 
      FROM users u 
      ORDER BY stars DESC 
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
    return ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'ref') {
    const link = `${BOT_LINK}?start=${ctx.from.id}`;
    const refText = `📩 Приглашайте друзей и получайте 5 звёзд за каждого!\n\n` +
                    `Ваша реферальная ссылка:\n${link}`;
    return ctx.reply(refText, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'enter_code') {
    ctx.session.waitingForCode = true;
    return ctx.reply('💬 Введите промокод:');
  }

  if (action === 'buy_premium') {
    try {
      const invoice = await ctx.telegram.sendInvoice(id, {
        title: 'Premium Badge',
        description: 'Получите эксклюзивный премиум-значок для вашего профиля!',
        payload: `premium_badge_${id}_${Date.now()}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'Premium Badge', amount: 10 }],
        start_parameter: 'buy_premium'
      });
      logAction(id, 'send_invoice_premium_badge', 'STARS');
    } catch (e) {
      console.error('Ошибка отправки инвойса:', e);
      ctx.editMessageText(`❌ Ошибка при создании платежа. Попробуйте снова или обратитесь в ${SUPPORT_LINK}.`, {
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'back')]] }
      });
    }
  }

  if (action === 'admin') {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    if (ctx.callbackQuery.message.photo) {
      await ctx.deleteMessage();
    }
    return ctx.reply(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
      [Markup.button.callback('📈 Статистика скриншотов', 'admin_screen_stats')],
      [Markup.button.callback('💰 Статистика Stars', 'admin_stars_stats')],
      [Markup.button.callback('📩 Тикеты поддержки', 'admin_support_tickets')],
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
    ctx.session.broadcast = true;
    return ctx.reply('✏️ Введите текст рассылки:');
  }

  if (action === 'admin_addcode') {
    ctx.session.waitingForPromo = true;
    return ctx.reply('✏️ Введите промокод, количество звёзд и количество активаций через пробел:\nНапример: `CODE123 10 5`', { parse_mode: 'Markdown' });
  }

  if (action === 'admin_stars_stats') {
    const stats = db.prepare(`
      SELECT 
        SUM(amount) as total_stars,
        COUNT(*) as total_transactions,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM stars_transactions
    `).get();

    const text = `💰 Статистика Telegram Stars:\n\n` +
                 `📈 Всего Stars: ${stats.total_stars || 0}\n` +
                 `📊 Всего транзакций: ${stats.total_transactions || 0}\n` +
                 `✅ Завершено: ${stats.completed || 0}\n` +
                 `⏳ Ожидает: ${stats.pending || 0}`;

    return ctx.reply(text, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'admin')]
    ]));
  }

  if (action === 'admin_support_tickets') {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    
    const tickets = db.prepare(`
      SELECT id, user_id, username, issue, type, created_at 
      FROM support_tickets 
      WHERE status = 'open' 
      ORDER BY created_at ASC 
      LIMIT 10
    `).all();

    if (tickets.length === 0) {
      return ctx.editMessageText('📩 Нет открытых тикетов поддержки.', {
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'admin')]] }
      });
    }

    const ticketList = tickets.map((t, i) => {
      const date = new Date(t.created_at * 1000).toLocaleString('ru-RU');
      return `${i + 1}. #${t.id} от @${t.username || 'без ника'} (ID: ${t.user_id})\nТип: ${t.type}\nДата: ${date}`;
    }).join('\n\n');

    return ctx.editMessageText(
      `📩 Открытые тикеты поддержки (${tickets.length}):\n\n${ticketList}`,
      {
        reply_markup: {
          inline_keyboard: [
            ...tickets.map(t => [
              Markup.button.callback(`#${t.id}`, `admin_view_ticket_${t.id}`)
            ]),
            [Markup.button.callback('🔙 Назад', 'admin')]
          ]
        }
      }
    );
  }

  if (action.startsWith('admin_view_ticket_')) {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    
    const ticketId = parseInt(action.split('_')[3]);
    const ticket = db.prepare('SELECT id, user_id, username, issue, type, created_at FROM support_tickets WHERE id = ?').get(ticketId);
    
    if (!ticket) {
      return ctx.editMessageText('❌ Тикет не найден.', {
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'admin_support_tickets')]] }
      });
    }

    const date = new Date(ticket.created_at * 1000).toLocaleString('ru-RU');
    const ticketText = `📩 Тикет #${ticket.id}\n` +
                       `👤 Пользователь: @${ticket.username || 'без ника'} (ID: ${ticket.user_id})\n` +
                       `📜 Тип: ${ticket.type}\n` +
                       `📅 Дата: ${date}\n` +
                       `💬 Проблема: ${ticket.issue}`;

    return ctx.editMessageText(ticketText, {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('📝 Ответить', `admin_reply_ticket_${ticketId}`)],
          [Markup.button.callback('✏️ Редактировать', `admin_edit_ticket_${ticketId}`)],
          [Markup.button.callback('❌ Закрыть', `admin_close_ticket_${ticketId}`)],
          [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
        ]
      }
    });
  }

  if (action.startsWith('admin_reply_ticket_')) {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    
    const ticketId = parseInt(action.split('_')[3]);
    ctx.session.waitingForTicketReply = ticketId;
    return ctx.editMessageText('📝 Введите ответ на тикет:', {
      reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Отмена', 'admin_support_tickets')]] }
    });
  }

  if (action.startsWith('admin_edit_ticket_')) {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    
    const ticketId = parseInt(action.split('_')[3]);
    ctx.session.waitingForTicketEdit = ticketId;
    return ctx.editMessageText('✏️ Введите новый текст тикета:', {
      reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Отмена', 'admin_support_tickets')]] }
    });
  }

  if (action.startsWith('admin_close_ticket_')) {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    
    const ticketId = parseInt(action.split('_')[3]);
    const ticket = db.prepare('SELECT user_id, username, type FROM support_tickets WHERE id = ?').get(ticketId);
    
    if (!ticket) {
      return ctx.answerCbQuery('❌ Тикет не найден', { show_alert: true });
    }

    try {
      db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run('closed', ticketId);
      await ctx.telegram.sendMessage(ticket.user_id, `✅ Тикет #${ticketId} (${ticket.type}) закрыт.`);
      logAction(id, `close_ticket_${ticketId}_${ticket.type}`, 'SUPPORT');
      return ctx.editMessageText(`✅ Тикет #${ticketId} закрыт.`, {
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'admin_support_tickets')]] }
      });
    } catch (e) {
      console.error(`Ошибка закрытия тикета ${ticketId}:`, e);
      logAction(id, `close_ticket_error_${ticketId}_${e.message}`, 'SUPPORT');
      return ctx.answerCbQuery(`❌ Ошибка при закрытии тикета`, { show_alert: true });
    }
  }

  if (action.startsWith('admin_check_screens')) {
    const currentIndex = action === 'admin_check_screens' ? 0 : parseInt(action.split('_')[3]) || 0;
    const pending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL ORDER BY created_at ASC').all();

    if (pending.length === 0) {
      await ctx.deleteMessage();
      return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin')]
      ]));
    }

    const index = Math.max(0, Math.min(currentIndex, pending.length - 1));
    const scr = pending[index];
    const userWhoSent = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(scr.user_id));
    const taskDescription = scr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

    logAction(id, `view_screenshot_${scr.id}_type_${scr.task_type}`, 'SCREENSHOT');

    const inlineKeyboard = [
      [
        { text: '✅ Одобрить', callback_data: `approve_screen_${scr.id}` },
        { text: '❌ Отклонить', callback_data: `reject_screen_${scr.id}` }
      ],
      [
        index > 0 ? Markup.button.callback('⬅️ Предыдущий', `admin_check_screens_${index - 1}`) : Markup.button.callback('', ''),
        index < pending.length - 1 ? Markup.button.callback('Следующий ➡️', `admin_check_screens_${index + 1}`) : Markup.button.callback('', '')
      ].filter(button => button.text),
      [Markup.button.callback('🔙 Назад', 'admin')]
    ];

    try {
      await ctx.editMessageMedia({
        type: 'photo',
        media: scr.file_id,
        caption: `📸 Скриншот ${index + 1}/${pending.length} от @${userWhoSent?.username || 'пользователь'} (ID: ${scr.user_id})\n` +
                 `Задание: ${taskDescription}\n\n` +
                 `Нажмите кнопку, чтобы одобрить или отклонить.`,
      }, { reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (e) {
      console.error(`Ошибка показа скриншота ID=${scr.id}:`, e);
      await ctx.answerCbQuery('❌ Ошибка при загрузке скриншота', { show_alert: true });
      await ctx.deleteMessage();
      return ctx.reply('⚙️ Админ-панель', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
        [Markup.button.callback('📈 Статистика скриншотов', 'admin_screen_stats')],
        [Markup.button.callback('💰 Статистика Stars', 'admin_stars_stats')],
        [Markup.button.callback('📩 Тикеты поддержки', 'admin_support_tickets')],
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
    }
  }

  if (action.startsWith('approve_screen_') || action.startsWith('reject_screen_')) {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');

    const screenId = parseInt(action.split('_')[2]);
    if (isNaN(screenId)) return ctx.answerCbQuery('❌ Неверный ID скриншота');

    const screen = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE id = ? AND approved IS NULL').get(screenId);
    if (!screen) {
      await ctx.answerCbQuery('❌ Скриншот не найден или уже обработан', { show_alert: true });
      const pending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL ORDER BY created_at ASC').all();
      if (pending.length === 0) {
        await ctx.deleteMessage();
        return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin')]
        ]));
      }

      const nextScr = pending[0];
      const nextUser = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(nextScr.user_id));
      const nextTaskDescription = nextScr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

      const inlineKeyboard = [
        [
          { text: '✅ Одобрить', callback_data: `approve_screen_${nextScr.id}` },
          { text: '❌ Отклонить', callback_data: `reject_screen_${nextScr.id}` }
        ],
        [
          Markup.button.callback('⬅️ Предыдущий', 'admin_check_screens_0'),
          pending.length > 1 ? Markup.button.callback('Следующий ➡️', `admin_check_screens_1`) : Markup.button.callback('', '')
        ].filter(button => button.text),
        [Markup.button.callback('🔙 Назад', 'admin')]
      ];

      return ctx.editMessageMedia({
        type: 'photo',
        media: nextScr.file_id,
        caption: `📸 Скриншот 1/${pending.length} от @${nextUser?.username || 'пользователь'} (ID: ${nextScr.user_id})\n` +
                 `Задание: ${nextTaskDescription}\n\n` +
                 `Нажмите кнопку, чтобы одобрить или отклонить.`,
      }, { reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    const taskDescription = screen.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';
    const isApprove = action.startsWith('approve_screen_');

    const transaction = db.transaction(() => {
      if (isApprove) {
        db.prepare('UPDATE users SET stars = stars + 1.5, daily_task_completed = daily_task_completed + 1 WHERE id = ?').run(Number(screen.user_id));
        db.prepare('UPDATE screenshots SET approved = 1 WHERE id = ?').run(screenId);
      } else {
        db.prepare('UPDATE screenshots SET approved = 0 WHERE id = ?').run(screenId);
      }
    });

    try {
      transaction();
      const notifyText = isApprove
        ? `✅ Ваш скриншот для задания "${taskDescription}" одобрен! +1.5 звёзд 🎉`
        : `❌ Ваш скриншот для задания "${taskDescription}" отклонён. Пожалуйста, отправьте корректный скриншот.`;

      await ctx.telegram.sendMessage(screen.user_id, notifyText);
      await ctx.editMessageCaption(`✅ Скриншот для "${taskDescription}" ${isApprove ? 'одобрен' : 'отклонён'}.`);
      logAction(screen.user_id, `${isApprove ? 'approve' : 'reject'}_screen_${screen.task_type}_${screenId}`, 'SCREENSHOT');

      const pending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL ORDER BY created_at ASC').all();
      if (pending.length === 0) {
        await ctx.deleteMessage();
        return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin')]
        ]));
      }

      const nextScr = pending[0];
      const nextUser = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(nextScr.user_id));
      const nextTaskDescription = nextScr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

      const inlineKeyboard = [
        [
          { text: '✅ Одобрить', callback_data: `approve_screen_${nextScr.id}` },
          { text: '❌ Отклонить', callback_data: `reject_screen_${nextScr.id}` }
        ],
        [
          Markup.button.callback('⬅️ Предыдущий', 'admin_check_screens_0'),
          pending.length > 1 ? Markup.button.callback('Следующий ➡️', `admin_check_screens_1`) : Markup.button.callback('', '')
        ].filter(button => button.text),
        [Markup.button.callback('🔙 Назад', 'admin')]
      ];

      await ctx.editMessageMedia({
        type: 'photo',
        media: nextScr.file_id,
        caption: `📸 Скриншот 1/${pending.length} от @${nextUser?.username || 'пользователь'} (ID: ${nextScr.user_id})\n` +
                 `Задание: ${nextTaskDescription}\n\n` +
                 `Нажмите кнопку, чтобы одобрить или отклонить.`,
      }, { reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (e) {
      console.error(`Ошибка обработки скриншота ID=${screenId}:`, e);
      await ctx.answerCbQuery('❌ Ошибка при загрузке скриншота', { show_alert: true });
      await ctx.deleteMessage();
      return ctx.reply('⚙️ Админ-панель', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
        [Markup.button.callback('📈 Статистика скриншотов', 'admin_screen_stats')],
        [Markup.button.callback('💰 Статистика Stars', 'admin_stars_stats')],
        [Markup.button.callback('📩 Тикеты поддержки', 'admin_support_tickets')],
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
    }
  }

  if (action === 'back') {
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }
});

bot.on('photo', async (ctx) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(id));
  if (!user) return;

  ctx.session = ctx.session || {};

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply('❌ Вы не подписаны на все необходимые каналы. Подпишитесь и попробуйте снова.');
  }

  const taskType = ctx.session.waitingForTask === 'launch_bot' ? 'launch_bot' : 'subscribe_channel';
  const lastScreenshot = db.prepare('SELECT created_at FROM screenshots WHERE user_id = ? AND task_type = ? AND approved IS NULL ORDER BY created_at DESC LIMIT 1').get(Number(id), taskType);

  if (lastScreenshot && (Date.now() / 1000 - lastScreenshot.created_at) < SCREENSHOT_LIMIT_SECONDS) {
    const secondsLeft = Math.ceil(SCREENSHOT_LIMIT_SECONDS - (Date.now() / 1000 - lastScreenshot.created_at));
    return ctx.reply(`⏳ Пожалуйста, подождите ${secondsLeft} сек. перед отправкой нового скриншота.`);
  }

  const photoArray = ctx.message.photo;
  const fileId = photoArray[photoArray.length - 1].file_id;

  db.prepare('INSERT INTO screenshots (user_id, file_id, task_type, created_at) VALUES (?, ?, ?, ?)')
    .run(Number(id), fileId, taskType, Math.floor(Date.now() / 1000).toString());

  await ctx.reply(`✅ Скриншот для задания "${taskType === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал'}" отправлен на проверку.`);
  logAction(id, `submit_screen_${taskType}`, 'SCREENSHOT');

  ctx.session.waitingForTask = null;
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.error('Ошибка удаления сообщения с фото:', e);
  }
});

bot.on('message', async (ctx) => {
  const id = ctx.from ? ctx.from.id : null;
  ctx.session = ctx.session || {};

  if (!id) {
    console.error('Ошибка: ctx.from отсутствует', JSON.stringify(ctx, null, 2));
    return ctx.reply('❌ Ошибка: не удалось определить пользователя. Попробуйте снова.');
  }

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply(
      '🔒 Для доступа к функциям бота необходимо подписаться на каналы:',
      Markup.inlineKeyboard([
        ...REQUIRED_CHANNELS.map(channel => [
          Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace('@', '')}`)
        ]),
        [Markup.button.callback('✅ Я подписался', 'check_sub')]
      ])
    );
  }

  if (ctx.session.waitingForSupport || ctx.session.waitingForPaySupport) {
    if (!ctx.message || !ctx.message.text || typeof ctx.message.text !== 'string') {
      console.error('Ошибка: сообщение не содержит текст', { message: ctx.message });
      return ctx.reply('❌ Пожалуйста, опишите проблему текстом (без стикеров, фото или других данных).');
    }

    const issue = ctx.message.text.trim();
    if (issue.length === 0) {
      console.error('Ошибка: пустое описание проблемы', { issue });
      return ctx.reply('❌ Описание проблемы не может быть пустым.');
    }

    if (issue.length > 500) {
      console.error('Ошибка: слишком длинное описание проблемы', { issueLength: issue.length });
      return ctx.reply('❌ Описание проблемы слишком длинное (максимум 500 символов).');
    }

    const type = ctx.session.waitingForPaySupport ? 'paysupport' : 'support';
    try {
      const ticketId = await sendSupportTicket(ctx, id, ctx.from.username || '', issue, type);
      ctx.session.waitingForSupport = false;
      ctx.session.waitingForPaySupport = false;
      await ctx.reply(`✅ Тикет #${ticketId} отправлен в ${SUPPORT_LINK}. Мы свяжемся с вами в ближайшее время!`);
    } catch (e) {
      console.error(`Ошибка отправки тикета (${type}):`, e);
      await ctx.reply(`❌ Ошибка при отправке тикета. Попробуйте снова или свяжитесь с ${SUPPORT_LINK}.`);
    }
    return;
  }

  if (ctx.session.waitingForTicketReply && ADMIN_IDS.includes(id)) {
    const ticketId = ctx.session.waitingForTicketReply;
    const ticket = db.prepare('SELECT user_id, type FROM support_tickets WHERE id = ? AND status = ?').get(ticketId, 'open');
    
    if (!ticket) {
      ctx.session.waitingForTicketReply = null;
      return ctx.reply('❌ Тикет не найден или уже закрыт.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    }

    const replyText = ctx.message.text.trim();
    if (replyText.length === 0) {
      return ctx.reply('❌ Ответ не может быть пустым.');
    }

    try {
      await ctx.telegram.sendMessage(
        ticket.user_id,
        `📩 Ответ на тикет #${ticketId} (${ticket.type}):\n${replyText}`
      );
      db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run('responded', ticketId);
      logAction(id, `reply_ticket_${ticketId}_${ticket.type}`, 'SUPPORT');
      ctx.session.waitingForTicketReply = null;
      return ctx.reply(`✅ Ответ на тикет #${ticketId} отправлен пользователю.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    } catch (e) {
      console.error(`Ошибка отправки ответа на тикет ${ticketId}:`, e);
      logAction(id, `reply_ticket_error_${ticketId}_${e.message}`, 'SUPPORT');
      return ctx.reply(`❌ Ошибка при отправке ответа. Попробуйте снова.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    }
  }

  if (ctx.session.waitingForTicketEdit && ADMIN_IDS.includes(id)) {
    const ticketId = ctx.session.waitingForTicketEdit;
    const ticket = db.prepare('SELECT user_id, type FROM support_tickets WHERE id = ? AND status = ?').get(ticketId, 'open');
    
    if (!ticket) {
      ctx.session.waitingForTicketEdit = null;
      return ctx.reply('❌ Тикет не найден или уже закрыт.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    }

    const newIssue = ctx.message.text.trim();
    if (newIssue.length === 0) {
      return ctx.reply('❌ Текст тикета не может быть пустым.');
    }

    if (newIssue.length > 500) {
      return ctx.reply('❌ Текст тикета слишком длинный (максимум 500 символов).');
    }

    try {
      db.prepare('UPDATE support_tickets SET issue = ? WHERE id = ?').run(newIssue, ticketId);
      logAction(id, `edit_ticket_${ticketId}_${ticket.type}`, 'SUPPORT');
      ctx.session.waitingForTicketEdit = null;
      return ctx.reply(`✅ Тикет #${ticketId} обновлён.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    } catch (e) {
      console.error(`Ошибка редактирования тикета ${ticketId}:`, e);
      logAction(id, `edit_ticket_error_${ticketId}_${e.message}`, 'SUPPORT');
      return ctx.reply(`❌ Ошибка при редактировании тикета. Попробуйте снова.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin_support_tickets')]
      ]));
    }
  }

  if (ctx.session.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);

    if (!promo) {
      ctx.session.waitingForCode = false;
      return ctx.reply('❌ Неверный промокод!');
    }

    if (promo.activations_left === 0) {
      ctx.session.waitingForCode = false;
      return ctx.reply('⚠️ Промокод больше не активен.');
    }

    let usedBy = promo.used_by ? JSON.parse(promo.used_by) : [];
    if (usedBy.includes(id)) {
      ctx.session.waitingForCode = false;
      return ctx.reply('⚠️ Вы уже использовали этот промокод.');
    }

    const transaction = db.transaction(() => {
      db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, Number(id));
      usedBy.push(id);
      db.prepare('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?')
        .run(promo.activations_left - 1, JSON.stringify(usedBy), code);
    });

    try {
      transaction();
      ctx.session.waitingForCode = false;
      logAction(id, `promo_${code}_${promo.reward}`, 'PROMO');
      return ctx.reply(`✅ Промокод успешно активирован! +${promo.reward} звёзд`);
    } catch (e) {
      console.error(`Ошибка активации промокода ${code}:`, e);
      return ctx.reply('❌ Ошибка при активации промокода.');
    }
  }

  if (ctx.session.broadcast && ADMIN_IDS.includes(id)) {
    const users = db.prepare('SELECT id FROM users').all();
    let successCount = 0;
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
        successCount++;
      } catch (e) {
        console.error(`Ошибка рассылки пользователю ${u.id}:`, e);
      }
    }
    ctx.session.broadcast = false;
    logAction(id, `broadcast_sent_${successCount}`, 'ADMIN');
    return ctx.reply(`✅ Рассылка завершена. Отправлено ${successCount} пользователям.`);
  }

  if (ctx.session.waitingForPromo && ADMIN_IDS.includes(id)) {
    const parts = ctx.message.text.trim().split(' ');
    if (parts.length !== 3) return ctx.reply('❌ Неверный формат. Попробуйте снова.');

    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);

    if (!code || isNaN(reward) || isNaN(activations)) return ctx.reply('❌ Неверные данные. Попробуйте снова.');

    const exists = db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(code);
    if (exists) return ctx.reply('❌ Промокод уже существует.');

    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)')
        .run(code, reward, activations, JSON.stringify([]));
    });

    try {
      transaction();
      ctx.session.waitingForPromo = false;
      logAction(id, `add_promo_${code}`, 'ADMIN');
      return ctx.reply(`✅ Промокод ${code} добавлен:\nНаграда: ${reward} звёзд\nОсталось активаций: ${activations}`);
    } catch (e) {
      console.error(`Ошибка добавления промокода ${code}:`, e);
      return ctx.reply('❌ Ошибка при добавлении промокода.');
    }
  }
});

bot.launch();
console.log('Бот запущен');