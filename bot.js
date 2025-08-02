const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const REQUIRED_CHANNELS = ['@magnumtap', '@magnumwithdraw'];
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [6587897295];
const SUPPORT_USERNAME = '@magnumsupports';
const BOT_LINK = 'https://t.me/MagnumTapBot'; // Ссылка на твой бот
const TASK_BOT_LINK = process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot?start=6587897295'; // Ссылка на бота для задания
const WITHDRAW_CHANNEL = '@magnumwithdraw';
const FARM_COOLDOWN_SECONDS = parseInt(process.env.FARM_COOLDOWN_SECONDS || '60');

// Логирование действий
function logAction(userId, action) {
  db.prepare('INSERT INTO logs (user_id, action, timestamp) VALUES (?, ?, ?)').run(userId, action, Date.now());
}

// Функция отправки заявки на вывод
async function sendWithdrawRequest(ctx, userId, username, amount) {
  try {
    const insert = db.prepare('INSERT INTO withdraws (user_id, username, amount, status) VALUES (?, ?, ?, ?)');
    const result = insert.run(userId, username, amount, 'pending');
    const withdrawId = result.lastInsertRowid;

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
    console.log(`Заявка на вывод создана: ID=${withdrawId}, user=${userId}, amount=${amount}`);
    logAction(userId, `withdraw_request_${amount}`);
  } catch (e) {
    console.error('Ошибка при отправке заявки на вывод:', e);
    throw new Error('Не удалось отправить заявку на вывод');
  }
}

// Проверка подписки на каналы
async function isUserSubscribed(ctx) {
  const memberStatuses = await Promise.all(
    REQUIRED_CHANNELS.map(async (channel) => {
      try {
        const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
        return ['member', 'administrator', 'creator'].includes(member.status);
      } catch (e) {
        console.error(`Ошибка при проверке подписки на ${channel}:`, e);
        return false;
      }
    })
  );
  return memberStatuses.every((status) => status);
}

// Главное меню
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
    ADMIN_IDS.includes(ctx.from.id) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

bot.start(async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

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

  const existing = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);
    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 5 WHERE id = ?').run(referral); // 5 звёзд за реферала
      try {
        await ctx.telegram.sendMessage(
          referral,
          `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +5 звёзд`
        );
        logAction(referral, `referral_reward_${id}`);
      } catch (e) {
        console.error(`Ошибка отправки уведомления рефералу ${referral}:`, e);
      }
      console.log(`Новый пользователь зарегистрирован: ID=${id}, username=${username}`);
      logAction(id, 'register');
    }
  }

  await ctx.reply(
    `👋 Привет, <b>${ctx.from.first_name || 'друг'}!</b>\n\n` +
    `Добро пожаловать в <b>MagnumTap</b> — твоё космическое приключение по сбору звёзд и получению бонусов!\n\n` +
    `✨ Здесь ты можешь:\n` +
    `• Зарабатывать звёзды с помощью кнопки «Фарм»\n` +
    `• Получать ежедневные бонусы\n` +
    `• Следить за прогрессом, приглашать друзей и побеждать в топах!\n\n` +
    `🚀 Желаем успешного фарма!`,
    { parse_mode: 'HTML' }
  );

  await sendMainMenu(ctx);
});

bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.prepare('SELECT id, username, stars, last_farm, last_bonus, referred_by, daily_task_completed FROM users WHERE id = ?').get(id);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }
    const username = ctx.from.username || '';
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(id, username);
      console.log(`Пользователь зарегистрирован после проверки подписки: ID=${id}`);
      logAction(id, 'check_subscription');
    }
    await sendMainMenu(ctx);
    return ctx.answerCbQuery('✅ Подписка подтверждена');
  }

  // Обработка заявок на вывод
  if (action.startsWith('approve_withdraw_') || action.startsWith('reject_withdraw_')) {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.answerCbQuery('⛔ Доступ запрещён');
    }

    const withdrawId = parseInt(action.split('_')[2]);
    if (isNaN(withdrawId)) {
      return ctx.answerCbQuery('❌ Ошибка: некорректный ID заявки');
    }

    const withdraw = db.prepare('SELECT id, user_id, username, amount, channel_message_id FROM withdraws WHERE id = ?').get(withdrawId);
    if (!withdraw) {
      return ctx.answerCbQuery('❌ Заявка не найдена');
    }

    const isApprove = action.startsWith('approve_withdraw_');
    const newStatus = isApprove ? 'approved' : 'rejected';

    db.prepare('UPDATE withdraws SET status = ? WHERE id = ?').run(newStatus, withdrawId);

    const chatId = WITHDRAW_CHANNEL;
    const messageId = withdraw.channel_message_id;

    try {
      await ctx.telegram.editMessageText(
        chatId,
        messageId,
        null,
        `✅ Запрос на вывод №${withdrawId}\n\n` +
        `👤 Пользователь: @${withdraw.username || 'Без ника'} | ID ${withdraw.user_id}\n` +
        `💫 Количество: ${withdraw.amount}⭐️ [🧸]\n\n` +
        `🔄 Статус: ${newStatus}`,
        { reply_markup: { inline_keyboard: [] } }
      );

      const notifyText = isApprove
        ? `✅ Ваша заявка на вывод ${withdraw.amount} ⭐ одобрена!`
        : `❌ Ваша заявка на вывод ${withdraw.amount} ⭐ отклонена.`;

      if (!isApprove) {
        db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(withdraw.amount, withdraw.user_id);
      }

      await ctx.telegram.sendMessage(withdraw.user_id, notifyText);
      await ctx.answerCbQuery('Обработано.');
      console.log(`Заявка на вывод обработана: ID=${withdrawId}, status=${newStatus}`);
      logAction(withdraw.user_id, `withdraw_${newStatus}_${withdrawId}`);
    } catch (e) {
      console.error('Ошибка обработки заявки:', e);
      await ctx.answerCbQuery('❌ Ошибка при обработке заявки', { show_alert: true });
    }
  }

  if (action === 'farm') {
    const cooldown = FARM_COOLDOWN_SECONDS * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }

    const reward = 0.1;
    db.prepare('UPDATE users SET stars = stars + ?, last_farm = ? WHERE id = ?').run(reward, now, id);
    console.log(`Фарм: пользователь ${id} получил ${reward} звёзд`);
    logAction(id, `farm_${reward}`);
    return ctx.answerCbQuery(`⭐ Вы заработали ${reward} звезды!`, { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус можно получить через ${hoursLeft} ч.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), id);
    console.log(`Бонус выдан: пользователь ${id}, +5 звёзд`);
    logAction(id, 'bonus_5');
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
    });
  }

  if (action === 'daily_tasks_2') {
    // Проверка, не выполнено ли задание ранее
    const existing = db.prepare('SELECT id FROM screenshots WHERE user_id = ? AND task_type = ? AND approved = 1').get(id, 'launch_bot');
    if (existing) {
      return ctx.answerCbQuery('❌ Вы уже выполнили задание "Запусти бота".', { show_alert: true });
    }

    const text =
      `📋 <b>Задание 2 из 2: Запусти бота</b> 📋\n\n` +
      `🚀 Запустите бота по ссылке ниже и отправьте скриншот запуска:\n` +
      `${TASK_BOT_LINK}\n\n` +
      `После проверки администратором вы получите 1.5 звезды.`;

    ctx.session = ctx.session || {};
    ctx.session.waitingForTask = 'launch_bot';

    return ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('▶️ Запустить бота', TASK_BOT_LINK)],
        [Markup.button.callback('🔙 Назад', 'back')],
        [Markup.button.callback('⬅️ Предыдущее задание', 'daily_tasks')]
      ])
    });
  }

  if (action === 'exchange') {
    return ctx.editMessageText(
      `📈 <b>Биржа MagnumCoin</b>\n\n` +
      `💱 Здесь в будущем вы сможете покупать и продавать MagnumCoin за звёзды.\n` +
      `📊 Цена будет меняться в реальном времени, и вы сможете торговать, чтобы получать прибыль (или убыток!).\n\n` +
      `🚧 Функция находится в разработке. Следите за обновлениями!`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'back')]]) }
    );
  }

  if (['profile', 'leaders', 'stats', 'ref'].includes(action)) {
    await ctx.deleteMessage();
  }

  if (action === 'profile') {
    const invited = db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(id).count;
    const referredByUser = user.referred_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(user.referred_by) : null;
    const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
    const displayName = ctx.from.first_name || '—';

    const profileText =
      `🌟 Ваш профиль в MagnumTap 🌟\n\n` +
      `👤 Имя: ${displayName}\n` +
      `🆔 Telegram ID: ${user.id}\n\n` +
      `💫 Ваши звёзды: ${user.stars}\n` +
      `👥 Приглашено друзей: ${invited}\n` +
      `📣 Пригласил: ${referrerName}\n\n` +
      `🔥 Используйте звёзды для получения бонусов и участия в акциях!`;

    return ctx.reply(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('Вывести звёзды', 'withdraw_stars')],
      [Markup.button.url('📞 Связаться с поддержкой', `https://t.me/${SUPPORT_USERNAME.replace('@', '')}`)],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'withdraw_stars') {
    if (!user) {
      return ctx.answerCbQuery('❌ Пользователь не найден', { show_alert: true });
    }
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
    if (isNaN(amount)) {
      return ctx.answerCbQuery('❌ Неверная сумма вывода', { show_alert: true });
    }

    if (!user || user.stars < amount) {
      return ctx.answerCbQuery('Недостаточно звёзд для вывода.', { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars - ? WHERE id = ?').run(amount, ctx.from.id);

    try {
      await sendWithdrawRequest(ctx, ctx.from.id, ctx.from.username, amount);
      return ctx.editMessageText(`✅ Заявка на вывод ${amount} ⭐ отправлена на обработку.`, Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
    } catch (e) {
      db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(amount, ctx.from.id);
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
    const refText = `📩 Приглашайте друзей и получайте бонусные звёзды за каждого приглашённого!\n\n` +
                    `Чем больше друзей — тем больше наград и возможностей.\n\n` +
                    `Ваша реферальная ссылка:\n${link}`;
    return ctx.reply(refText, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'enter_code') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForCode = true;
    return ctx.reply('💬 Введите промокод:');
  }

  if (action === 'admin') {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    // Проверяем, является ли текущее сообщение фото
    if (ctx.callbackQuery.message.photo) {
      await ctx.deleteMessage();
      return ctx.reply(`⚙️ Админ-панель`, Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
    }
    return ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
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
    return ctx.reply('✏️ Введите промокод, количество звёзд и количество активаций через пробел:\nНапример: `CODE123 10 5`', { parse_mode: 'Markdown' });
  }

  if (action === 'admin_check_screens') {
    const pending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL').all();

    if (pending.length === 0) {
      await ctx.deleteMessage();
      return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin')]
      ]));
    }

    const scr = pending[0];
    const userWhoSent = db.prepare('SELECT username FROM users WHERE id = ?').get(scr.user_id);
    const taskDescription = scr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

    console.log(`Показ скриншота для проверки: ID=${scr.id}, user=${scr.user_id}, task=${scr.task_type}`);

    try {
      await ctx.editMessageMedia({
        type: 'photo',
        media: scr.file_id,
        caption: `📸 Скриншот от @${userWhoSent?.username || 'пользователь'} (ID: ${scr.user_id})\n` +
                 `Задание: ${taskDescription}\n\n` +
                 `Нажмите кнопку, чтобы одобрить или отклонить.`,
      }, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `approve_screen_${scr.id}` },
              { text: '❌ Отклонить', callback_data: `reject_screen_${scr.id}` }
            ],
            [Markup.button.callback('🔙 Назад', 'admin')]
          ]
        }
      });
    } catch (e) {
      console.error(`Ошибка при показе скриншота ID=${scr.id}:`, e);
      await ctx.answerCbQuery('❌ Ошибка при загрузке скриншота', { show_alert: true });
      await ctx.deleteMessage();
      return ctx.reply('⚙️ Админ-панель', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
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
      // Показываем следующий скриншот или админ-панель
      const nextPending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL').all();
      if (nextPending.length === 0) {
        await ctx.deleteMessage();
        return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin')]
        ]));
      }

      const nextScr = nextPending[0];
      const nextUser = db.prepare('SELECT username FROM users WHERE id = ?').get(nextScr.user_id);
      const nextTaskDescription = nextScr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

      console.log(`Показ следующего скриншота: ID=${nextScr.id}, user=${nextScr.user_id}, task=${nextScr.task_type}`);

      return ctx.editMessageMedia({
        type: 'photo',
        media: nextScr.file_id,
        caption: `📸 Скриншот от @${nextUser?.username || 'пользователь'} (ID: ${nextScr.user_id})\n` +
                 `Задание: ${nextTaskDescription}\n\n` +
                 `Нажмите кнопку, чтобы одобрить или отклонить.`,
      }, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `approve_screen_${nextScr.id}` },
              { text: '❌ Отклонить', callback_data: `reject_screen_${nextScr.id}` }
            ],
            [Markup.button.callback('🔙 Назад', 'admin')]
          ]
        }
      });
    }

    const taskDescription = screen.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

    if (action.startsWith('approve_screen_')) {
      db.prepare('UPDATE users SET stars = stars + 1.5, daily_task_completed = daily_task_completed + 1 WHERE id = ?').run(screen.user_id);
      db.prepare('UPDATE screenshots SET approved = 1 WHERE id = ?').run(screenId);

      try {
        await ctx.telegram.sendMessage(screen.user_id, `✅ Ваш скриншот для задания "${taskDescription}" одобрен! +1.5 звёзд 🎉`);
      } catch (e) {
        console.error(`Ошибка уведомления пользователя ${screen.user_id}:`, e);
      }

      await ctx.editMessageCaption(`✅ Скриншот для "${taskDescription}" одобрен. Награда выдана пользователю.`);
      console.log(`Скриншот одобрен: ID=${screenId}, user=${screen.user_id}, task=${screen.task_type}`);
      logAction(screen.user_id, `approve_screen_${screen.task_type}_${screenId}`);
    } else {
      db.prepare('UPDATE screenshots SET approved = 0 WHERE id = ?').run(screenId);

      try {
        await ctx.telegram.sendMessage(screen.user_id, `❌ Ваш скриншот для задания "${taskDescription}" отклонён. Пожалуйста, убедитесь, что вы отправили корректный скриншот.`);
      } catch (e) {
        console.error(`Ошибка уведомления пользователя ${screen.user_id}:`, e);
      }

      await ctx.editMessageCaption(`❌ Скриншот для "${taskDescription}" отклонён.`);
      console.log(`Скриншот отклонён: ID=${screenId}, user=${screen.user_id}, task=${screen.task_type}`);
      logAction(screen.user_id, `reject_screen_${screen.task_type}_${screenId}`);
    }

    // Показываем следующий скриншот или админ-панель
    const nextPending = db.prepare('SELECT id, user_id, file_id, task_type FROM screenshots WHERE approved IS NULL').all();
    if (nextPending.length === 0) {
      await ctx.deleteMessage();
      return ctx.reply('Нет новых скриншотов для проверки.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'admin')]
      ]));
    }

    const nextScr = nextPending[0];
    const nextUser = db.prepare('SELECT username FROM users WHERE id = ?').get(nextScr.user_id);
    const nextTaskDescription = nextScr.task_type === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал';

    console.log(`Показ следующего скриншота: ID=${nextScr.id}, user=${nextScr.user_id}, task=${nextScr.task_type}`);

    return ctx.editMessageMedia({
      type: 'photo',
      media: nextScr.file_id,
      caption: `📸 Скриншот от @${nextUser?.username || 'пользователь'} (ID: ${nextScr.user_id})\n` +
               `Задание: ${nextTaskDescription}\n\n` +
               `Нажмите кнопку, чтобы одобрить или отклонить.`,
    }, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Одобрить', callback_data: `approve_screen_${nextScr.id}` },
            { text: '❌ Отклонить', callback_data: `reject_screen_${nextScr.id}` }
          ],
          [Markup.button.callback('🔙 Назад', 'admin')]
        ]
      }
    });
  }

  if (action === 'back') {
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }
});

bot.on('photo', async (ctx) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return;

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    return ctx.reply('❌ Вы не подписаны на все необходимые каналы. Подпишитесь и попробуйте снова.');
  }

  const photoArray = ctx.message.photo;
  const fileId = photoArray[photoArray.length - 1].file_id;

  const taskType = ctx.session?.waitingForTask === 'launch_bot' ? 'launch_bot' : 'subscribe_channel';
  db.prepare('INSERT INTO screenshots (user_id, file_id, approved, task_type) VALUES (?, ?, NULL, ?)').run(id, fileId, taskType);

  await ctx.reply(`✅ Скриншот для задания "${taskType === 'launch_bot' ? 'Запуск бота' : 'Подписка на канал'}" получен и отправлен на проверку администратору. Ждите результат.`);
  console.log(`Скриншот получен: пользователь ${id}, task=${taskType}`);
  logAction(id, `submit_screen_${taskType}`);

  ctx.session.waitingForTask = null;

  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.error('Ошибка удаления сообщения с фото:', e);
  }
});

bot.on('message', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session?.broadcast && ADMIN_IDS.includes(id)) {
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch (e) {
        console.error(`Ошибка рассылки пользователю ${u.id}:`, e);
      }
    }
    ctx.session.broadcast = false;
    console.log(`Рассылка завершена админом ${id}`);
    logAction(id, 'broadcast');
    return ctx.reply('✅ Рассылка завершена.');
  }

  if (ctx.session?.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);

    if (!promo) {
      ctx.session.waitingForCode = false;
      return ctx.reply('❌ Неверный промокод!');
    }

    if (promo.activations_left === 0) {
      ctx.session.waitingForCode = false;
      return ctx.reply('⚠️ Промокод больше не активен (лимит активаций исчерпан).');
    }

    let usedBy = promo.used_by ? JSON.parse(promo.used_by) : [];

    if (usedBy.includes(id)) {
      ctx.session.waitingForCode = false;
      return ctx.reply('⚠️ Вы уже использовали этот промокод.');
    }

    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, id);

    usedBy.push(id);
    const newActivationsLeft = promo.activations_left - 1;

    db.prepare('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?')
      .run(newActivationsLeft, JSON.stringify(usedBy), code);

    ctx.session.waitingForCode = false;
    console.log(`Промокод активирован: код=${code}, пользователь=${id}, награда=${promo.reward}`);
    logAction(id, `promo_${code}_${promo.reward}`);
    return ctx.reply(`✅ Промокод успешно активирован! +${promo.reward} звёзд`);
  }

  if (ctx.session?.waitingForPromo && ADMIN_IDS.includes(id)) {
    const parts = ctx.message.text.trim().split(' ');
    if (parts.length !== 3) return ctx.reply('❌ Неверный формат. Попробуйте снова.');

    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);

    if (!code || isNaN(reward) || isNaN(activations)) return ctx.reply('❌ Неверные данные. Попробуйте снова.');

    const exists = db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(code);
    if (exists) return ctx.reply('❌ Промокод уже существует.');

    db.prepare('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)')
      .run(code, reward, activations, JSON.stringify([]));

    ctx.session.waitingForPromo = false;
    console.log(`Промокод добавлен: код=${code}, награда=${reward}, активаций=${activations}`);
    logAction(id, `add_promo_${code}`);
    return ctx.reply(`✅ Промокод ${code} добавлен:\nНаграда: ${reward} звёзд\nОсталось активаций: ${activations}`);
  }
});

bot.launch();
console.log('Бот запущен');