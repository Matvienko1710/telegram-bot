if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не задан!');
  process.exit(1);
}

const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Ссылки и настройки из .env
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '@magnumtap';
const TASK_CHANNEL = process.env.TASK_CHANNEL || '@musice46';
const TASK_CHANNEL_KITTY = process.env.TASK_CHANNEL_KITTY || '@kittyyyyywwr';
const TASK_BOT_LINK = process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot?start=6587897295';
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [6587897295];
const SUPPORT_CHANNEL = process.env.SUPPORT_CHANNEL || '@magnumsupported';
const FARM_COOLDOWN_SECONDS = parseInt(process.env.FARM_COOLDOWN_SECONDS) || 60;
const MESSAGE_TTL = 15_000;

// Функция для проверки и обновления титула
function updateUserTitle(ctx, userId) {
  const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  const stars = user.stars || 0;
  const referrals = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [userId]).count || 0;
  const completedTasks = db.get('SELECT COUNT(*) as count FROM user_tasks WHERE user_id = ? AND completed = 1', [userId]).count || 0;
  const promoCodesUsed = db.get('SELECT COUNT(*) as count FROM promo_codes WHERE used_by LIKE ?', [`%${userId}%`]).count || 0;
  const dailyStreak = user.daily_streak || 0;

  const titles = db.all('SELECT * FROM titles ORDER BY condition_value DESC');
  let newTitle = null;

  for (const title of titles) {
    let achieved = false;
    switch (title.condition_type) {
      case 'stars':
        if (stars >= title.condition_value) achieved = true;
        break;
      case 'referrals':
        if (referrals >= title.condition_value) achieved = true;
        break;
      case 'tasks':
        if (completedTasks >= title.condition_value) achieved = true;
        break;
      case 'daily_streak':
        if (dailyStreak >= title.condition_value) achieved = true;
        break;
      case 'promo_codes':
        if (promoCodesUsed >= title.condition_value) achieved = true;
        break;
    }
    if (achieved && (!user.title_id || title.condition_value > db.get('SELECT condition_value FROM titles WHERE id = ?', [user.title_id])?.condition_value || 0)) {
      newTitle = title;
      break;
    }
  }

  if (newTitle && newTitle.id !== user.title_id) {
    db.run('UPDATE users SET title_id = ? WHERE id = ?', [newTitle.id, userId]);
    ctx.telegram.sendMessage(
      userId,
      `🎉 Поздравляем! Ты получил титул <b>${newTitle.name}</b>! 🌟\n\n<i>${newTitle.description}</i>`,
      { parse_mode: 'HTML' }
    );
    console.log(`Пользователь ${userId} получил титул "${newTitle.name}" (описание: "${newTitle.description}")`);
  }
}

// Функция для удаления уведомлений
async function deleteNotification(ctx, messageId) {
  if (messageId && Number.isInteger(messageId)) {
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
      } catch (err) {
        if (err.response?.error_code !== 400) {
          console.error('Ошибка удаления уведомления:', err);
        }
      }
    }, MESSAGE_TTL);
  }
}

// Проверка подписки на канал
async function isUserSubscribed(ctx, channel = REQUIRED_CHANNEL) {
  try {
    const status = await ctx.telegram.getChatMember(channel, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(status.status);
  } catch (err) {
    console.error(`Ошибка проверки подписки на ${channel}:`, err);
    return false;
  }
}

// Вспомогательная функция для получения топа пользователей
function getTopUsers(limit = 10) {
  return db.all(`
    SELECT 
      u.username, 
      u.stars, 
      (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals,
      t.name AS title_name
    FROM users u
    LEFT JOIN titles t ON u.title_id = t.id
    ORDER BY u.stars DESC 
    LIMIT ?
  `, [limit]);
}

// Главное меню с приветствием
async function sendMainMenu(ctx, edit = false) {
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  const stars = user ? user.stars : 0;
  const invited = user ? db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count : 0;
  const messageText =
    `👋 <b>Добро пожаловать в Magnum Stars!</b> 🌟\n\n` +
    `Ты в игре, где можно <i>зарабатывать звёзды</i> ✨, выполняя простые задания, приглашая друзей и собирая бонусы! 🚀\n\n` +
    `💫 <b>Твой баланс:</b> ${stars} звёзд\n` +
    `👥 <b>Приглашено друзей:</b> ${invited}\n\n` +
    `Выбери действие и стань звездой Magnum Stars! 🌟\n` +
    `<i>Подсказка: используй /help для справки по боту!</i>`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('⭐ Фарм звёзд', 'farm'),
      Markup.button.callback('🎁 Ежедневный бонус', 'bonus')
    ],
    [
      Markup.button.callback('👤 Мой профиль', 'profile'),
      Markup.button.callback('🏆 Топ игроков', 'leaders')
    ],
    [
      Markup.button.callback('📊 Статистика', 'stats'),
      Markup.button.callback('📩 Пригласить друзей', 'ref')
    ],
    [Markup.button.callback('📋 Задания', 'tasks')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    ADMIN_IDS.includes(ctx.from.id) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]);

  if (edit) {
    await ctx.editMessageText(messageText, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(messageText, { parse_mode: 'HTML', ...keyboard });
  }
}

// Middleware для проверки регистрации пользователя
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user && ctx.updateType === 'message' && ctx.message?.text !== '/start') {
    const msg = await ctx.reply('❌ Начни с команды /start, чтобы войти в Magnum Stars! 🚀');
    deleteNotification(ctx, msg.message_id);
    return;
  }
  return next();
});

// Обработчик команды /start
bot.start(async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.currentTaskIndex = 0;
  ctx.session.waitingForTaskScreenshot = null;
  ctx.session.waitingForSupport = false;
  ctx.session.waitingForCode = false;
  ctx.session.waitingForPromo = false;
  ctx.session.waitingForTicketReply = false;
  ctx.session.broadcast = false;

  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  // Проверка подписки на обязательный канал
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    const msg = await ctx.reply(
      `🔒 <b>Для начала подпишись на наш канал!</b>\n\n` +
      `📢 Это твой первый шаг к звёздам Magnum Stars! Подпишись на ${REQUIRED_CHANNEL} и возвращайся! 🌟`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
          [Markup.button.callback('✅ Я подписался', 'check_sub')]
        ])
      }
    );
    return;
  }

  // Регистрация пользователя
  const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, 0, 0)', [id, username, referral]);
    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
      ctx.telegram.sendMessage(
        referral,
        `🎉 Твой друг @${username || 'без ника'} присоединился к Magnum Stars! +10 звёзд! 🌟`,
        { parse_mode: 'HTML' }
      );
      updateUserTitle(ctx, referral); // Проверка титула для реферера
    }
  }

  await sendMainMenu(ctx);
});

// Обработчик команды /help
bot.command('help', async (ctx) => {
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    const msg = await ctx.reply('❌ Начни с команды /start, чтобы войти в Magnum Stars! 🚀');
    deleteNotification(ctx, msg.message_id);
    return;
  }
  const helpText =
    `🌟 <b>Справка по Magnum Stars</b> ✨\n\n` +
    `Добро пожаловать в бот, где ты зарабатываешь звёзды ✨ и соревнуешься с друзьями! Вот что ты можешь делать:\n\n` +
    `⭐ <b>Фарм звёзд</b>: Нажимай "Фарм" каждые ${FARM_COOLDOWN_SECONDS} секунд и получай +1 звезду!\n` +
    `🎁 <b>Ежедневный бонус</b>: Раз в 24 часа получай +5 звёзд бесплатно!\n` +
    `📋 <b>Задания</b>: Подписывайся на каналы или запускай ботов, отправляй скриншот и получай до 10 звёзд!\n` +
    `👥 <b>Приглашай друзей</b>: За каждого друга, который присоединится по твоей ссылке, +10 звёзд!\n` +
    `💡 <b>Промокоды</b>: Вводи секретные коды для дополнительных звёзд.\n` +
    `🏅 <b>Титулы</b>: Зарабатывай звёзды, приглашай друзей и выполняй задания, чтобы получить крутые титулы!\n` +
    `📞 <b>Поддержка</b>: Пиши в поддержку, если что-то неясно, — ответим быстро!\n\n` +
    `🏆 Смотри топ игроков и соревнуйся за первое место!\n` +
    `🔍 Используй главное меню, чтобы начать, или напиши /start для перезапуска.\n\n` +
    `<i>Подсказка: чаще проверяй задания — новые появляются регулярно!</i>`;
  const msg = await ctx.reply(helpText, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
  });
  deleteNotification(ctx, msg.message_id);
});

// Обработчик callback-запросов
bot.on('callback_query', async (ctx) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.get('SELECT * FROM users WHERE id = ?', [id]);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('❌ Пользователь не найден! Напиши /start.', { show_alert: true });

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery(`❌ Подпишись на ${REQUIRED_CHANNEL} для доступа к Magnum Stars!`, { show_alert: true });
    }
    registerUser(ctx);
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'farm') {
    const cooldown = FARM_COOLDOWN_SECONDS * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подожди ${seconds} сек. для следующего фарма!`, { show_alert: true });
    }
    db.run('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?', [now, id]);
    user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    updateUserTitle(ctx, id); // Проверка титула
    await sendMainMenu(ctx, true);
    return ctx.answerCbQuery(`⭐ +1 звезда! Твой баланс: ${user.stars} звёзд.`, { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;
    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      const minutesLeft = Math.ceil((24 * 60 - nowDay.diff(last, 'minute')) % 60);
      return ctx.answerCbQuery(`🎁 Бонус доступен через ${hoursLeft} ч. ${minutesLeft} мин.`, { show_alert: true });
    }
    const dailyStreak = last && nowDay.diff(last, 'day') === 1 ? user.daily_streak + 1 : 1;
    db.run('UPDATE users SET stars = stars + 5, last_bonus = ?, daily_streak = ? WHERE id = ?', [nowDay.toISOString(), dailyStreak, id]);
    user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    updateUserTitle(ctx, id); // Проверка титула
    await sendMainMenu(ctx, true);
    return ctx.answerCbQuery(`🎉 +5 звёзд! Твой баланс: ${user.stars} звёзд.`, { show_alert: true });
  }

  if (action === 'tasks' || action === 'next_task') {
    ctx.session.currentTaskIndex = action === 'next_task' ? (ctx.session.currentTaskIndex || 0) + 1 : ctx.session.currentTaskIndex || 0;
    const tasks = db.all('SELECT * FROM tasks');
    if (tasks.length === 0) {
      await ctx.editMessageText(
        '📋 <b>Заданий пока нет!</b>\n\n<i>Новые задания скоро появятся, следи за обновлениями в Magnum Stars!</i>',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
        }
      );
      return;
    }
    const taskIndex = ctx.session.currentTaskIndex % tasks.length;
    const task = tasks[taskIndex];
    const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
    const taskStatus = userTask.completed ? '✅ <i>Выполнено</i>' : userTask.progress > 0 ? '⏳ <i>На проверке</i>' : '🔥 <i>Не начато</i>';
    const buttons = [
      [
        task.type === 'subscribe_channel' || task.type === 'subscribe_channel_kittyyyyywwr'
          ? Markup.button.url('📢 Подписаться', `https://t.me/${(task.type === 'subscribe_channel' ? TASK_CHANNEL : TASK_CHANNEL_KITTY).replace('@', '')}`)
          : Markup.button.url('🤖 Запустить бота', TASK_BOT_LINK),
        Markup.button.callback('✅ Отправить скриншот', `check_task_${task.id}`)
      ],
      [Markup.button.callback('➡️ Следующее задание', 'next_task')],
      [Markup.button.callback('🔙 В меню', 'back')]
    ];
    const messageText =
      `📋 <b>Задание #${taskIndex + 1}/${tasks.length}</b>\n\n` +
      `🎯 <b>${task.description}</b>\n` +
      `💰 <b>Награда:</b> ${task.reward} звёзд\n` +
      `📌 <b>Статус:</b> ${taskStatus}\n\n` +
      `<i>Выполни задание и отправь скриншот для проверки!</i>`;
    if (action === 'next_task') {
      await ctx.editMessageText(messageText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    } else {
      await ctx.reply(messageText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }
    return;
  }

  if (action.startsWith('check_task_')) {
    const taskId = parseInt(action.split('_')[2]);
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return ctx.answerCbQuery('❌ Задание не найдено!', { show_alert: true });
    }
    const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
    if (userTask.completed) {
      return ctx.answerCbQuery('✅ Задание уже выполнено! Перейди к следующему в Magnum Stars! 🌟', { show_alert: true });
    }
    if (userTask.progress > 0) {
      return ctx.answerCbQuery('⏳ Заявка уже на проверке. Ожидай решения админов! 🕒', { show_alert: true });
    }
    ctx.session.waitingForTaskScreenshot = taskId;
    const msg = await ctx.reply(
      '📸 <b>Отправь скриншот</b>\n\n' +
      'Сделай скриншот, подтверждающий выполнение задания, и отправь его сюда! 📷',
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (['profile', 'leaders', 'stats', 'ref'].includes(action)) {
    await ctx.deleteMessage().catch(() => {});
  }

  if (action === 'profile') {
    const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count;
    const referredByUser = user.referred_by ? db.get('SELECT username FROM users WHERE id = ?', [user.referred_by]) : null;
    const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
    const displayName = ctx.from.first_name || 'Аноним';
    const title = user.title_id ? db.get('SELECT name, description FROM titles WHERE id = ?', [user.title_id]) : null;
    const titleText = title ? `${title.name} (${title.description})` : 'Нет титула';
    const tasks = db.all('SELECT * FROM tasks');
    const completedTasks = db.all('SELECT t.description FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? AND ut.completed = 1', [id]);
    const nowDay = dayjs();
    const lastBonus = user.last_bonus ? dayjs(user.last_bonus) : null;
    const bonusStatus = lastBonus && nowDay.diff(lastBonus, 'hour') < 24
      ? `⏳ Доступно через ${24 - nowDay.diff(lastBonus, 'hour')} ч. ${Math.ceil((24 * 60 - nowDay.diff(lastBonus, 'minute')) % 60)} мин.`
      : '✅ Доступно!';
    const profileText =
      `🌟 <b>Твой профиль в Magnum Stars</b> ✨\n\n` +
      `👤 <b>Имя:</b> ${displayName}\n` +
      `🏅 <b>Титул:</b> ${titleText}\n` +
      `🆔 <b>ID:</b> ${user.id}\n` +
      `💫 <b>Звёзды:</b> ${user.stars} ✨\n` +
      `👥 <b>Приглашено друзей:</b> ${invited}\n` +
      `📣 <b>Твой реферал:</b> ${referrerName}\n` +
      `🎁 <b>Ежедневный бонус:</b> ${bonusStatus}\n` +
      `📋 <b>Выполненные задания:</b> ${completedTasks.length > 0 ? completedTasks.map(t => t.description).join(', ') : 'Нет'}\n\n` +
      `<i>Зарабатывай больше звёзд и стань легендой Magnum Stars!</i>`;
    await ctx.reply(profileText, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📞 Поддержка', 'support')],
        [Markup.button.callback('🔙 В меню', 'back')]
      ])
    });
    return;
  }

  if (action === 'support') {
    ctx.session.waitingForSupport = true;
    await ctx.reply(
      '📞 <b>Связаться с поддержкой Magnum Stars</b>\n\n' +
      'Опиши свою проблему или вопрос, можно прикрепить фото или документ. Мы ответим максимально быстро! 🚀',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_support')]])
      }
    );
    return;
  }

  if (action === 'cancel_support') {
    ctx.session.waitingForSupport = false;
    await ctx.deleteMessage().catch(() => {});
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'leaders') {
    const top = getTopUsers();
    const list = top.length > 0
      ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐ — друзей: ${u.referrals}`).join('\n')
      : '😔 Пока нет лидеров. Будь первым! 🚀';
    await ctx.reply(
      `🏆 <b>Топ-10 игроков Magnum Stars</b> 🌟\n\n${list}\n\n<i>Приглашай друзей и выполняй задания, чтобы попасть в топ!</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    return;
  }

  if (action === 'stats') {
    const total = db.get('SELECT COUNT(*) as count FROM users').count;
    const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
    const completedTasks = db.get('SELECT COUNT(*) as count FROM user_tasks WHERE completed = 1').count;
    await ctx.reply(
      `📊 <b>Статистика Magnum Stars</b> ✨\n\n` +
      `👥 <b>Игроков:</b> ${total}\n` +
      `⭐ <b>Всего звёзд:</b> ${totalStars}\n` +
      `📋 <b>Выполнено заданий:</b> ${completedTasks}\n\n` +
      `<i>Присоединяйся к нашей звёздной команде!</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    return;
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    await ctx.reply(
      `📩 <b>Приглашай друзей в Magnum Stars!</b> 👥\n\n` +
      `Твоя реферальная ссылка:\n<a href="${link}">${link}</a>\n\n` +
      `За каждого друга, который присоединится по ссылке, ты получишь <b>+10 звёзд</b>! 🌟\n` +
      `<i>Делись ссылкой и становись лидером!</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    return;
  }

  if (action === 'enter_code') {
    ctx.session.waitingForCode = true;
    const msg = await ctx.reply(
      '💡 <b>Введи промокод</b>\n\n' +
      'Отправь секретный код, чтобы получить бонусные звёзды в Magnum Stars! ✨',
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin') {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ только для админов Magnum Stars!', { show_alert: true });
    await ctx.editMessageText(
      `⚙️ <b>Админ-панель Magnum Stars</b> 🔒\n\n` +
      `Управляй ботом и следи за звёздами! 🌟`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
          [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
          [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
          [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
          [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
          [Markup.button.callback('🔙 В меню', 'back')]
        ])
      }
    );
    return;
  }

  if (action === 'admin_stats') {
    const total = db.get('SELECT COUNT(*) as count FROM users').count;
    const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
    const openTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['open']).count;
    const inProgressTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['in_progress']).count;
    const closedTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['closed']).count;
    const approvedTasks = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['approved']).count;
    const rejectedTasks = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['rejected']).count;
    return ctx.answerCbQuery(
      `📊 <b>Статистика Magnum Stars</b>\n\n` +
      `👥 Игроков: ${total}\n` +
      `⭐ Всего звёзд: ${totalStars}\n` +
      `📞 Тикеты: Открыто: ${openTickets} | В работе: ${inProgressTickets} | Закрыто: ${closedTickets}\n` +
      `📋 Заявки: Одобрено: ${approvedTasks} | Отклонено: ${rejectedTasks}`,
      { show_alert: true }
    );
  }

  if (action === 'admin_top') {
    const top = getTopUsers();
    const list = top.length > 0
      ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐`).join('\n')
      : '😔 Пока нет лидеров.';
    await ctx.reply(
      `🏆 <b>Топ-10 игроков Magnum Stars</b> 🌟\n\n${list}\n\n<i>Это лучшие звёздные охотники!</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    return;
  }

  if (action === 'admin_broadcast') {
    ctx.session.broadcast = true;
    await ctx.reply(
      '📢 <b>Рассылка</b>\n\n' +
      'Введи текст, который получат все пользователи Magnum Stars. Будь осторожен, сообщение уйдёт всем! 🚨',
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (action === 'admin_addcode') {
    ctx.session.waitingForPromo = true;
    const msg = await ctx.reply(
      '➕ <b>Добавить промокод</b>\n\n' +
      'Введи данные в формате: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\n' +
      'Пример: <code>STAR2023 10 5</code>',
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_tickets') {
    const tickets = db.all('SELECT * FROM tickets WHERE status IN (?, ?) ORDER BY created_at DESC LIMIT 10', ['open', 'in_progress']);
    if (tickets.length === 0) {
      await ctx.reply(
        '📞 <b>Тикеты и заявки</b>\n\n' +
        '😔 Нет открытых тикетов или заявок.\n\n<i>Проверь позже или напиши /help для справки.</i>',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
        }
      );
      return;
    }
    const buttons = tickets.map(ticket => {
      const type = ticket.task_type
        ? `📋 Заявка (${ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
        : '📞 Тикет';
      return [
        Markup.button.callback(
          `${type} #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
          `ticket_${ticket.ticket_id}`
        )
      ];
    });
    buttons.push([Markup.button.callback('🔙 В меню', 'back')]);
    await ctx.reply(
      '📞 <b>Тикеты и заявки</b>\n\n' +
      'Выбери тикет или заявку для просмотра и обработки: 🔍',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
    );
    return;
  }

  if (action.startsWith('ticket_')) {
    const ticketId = parseInt(action.split('_')[1]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('❌ Тикет или заявка не найдены!', { show_alert: true });
    const fileIds = ticket.file_id ? JSON.parse(ticket.file_id) : [];
    const fileText = fileIds.length > 0 ? `📎 <b>Файлы:</b> ${fileIds.length} шт.` : '📎 <b>Файлов нет</b>';
    const type = ticket.task_type
      ? `📋 Заявка на задание (${ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
      : '📞 Тикет поддержки';
    const ticketText =
      `${type} #${ticket.ticket_id}\n\n` +
      `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
      `🆔 ID: ${ticket.user_id}\n` +
      `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
      `${fileText}\n` +
      `📅 <b>Создан:</b> ${ticket.created_at}\n` +
      `📌 <b>Статус:</b> ${ticket.status === 'open' ? 'Открыт' : ticket.status === 'in_progress' ? 'В работе' : ticket.status === 'approved' ? 'Одобрено' : 'Отклонено'}\n\n` +
      `<i>Выбери действие ниже:</i>`;
    const buttons = [];
    if (ticket.task_type) {
      buttons.push([Markup.button.callback('✅ Одобрить', `approve_task_${ticket.ticket_id}`)]);
      buttons.push([Markup.button.callback('❌ Отклонить', `reject_task_${ticket.ticket_id}`)]);
    } else {
      buttons.push([Markup.button.callback('✍️ Ответить', `reply_ticket_${ticket.ticket_id}`)]);
      buttons.push([Markup.button.callback('🔄 В работе', `set_ticket_status_${ticket.ticket_id}_in_progress`)]);
      buttons.push([Markup.button.callback('✅ Закрыть', `set_ticket_status_${ticket.ticket_id}_closed`)]);
    }
    if (fileIds.length > 0) {
      buttons.unshift([Markup.button.callback('📎 Просмотреть файлы', `view_files_${ticket.ticket_id}`)]);
    }
    buttons.push([Markup.button.callback('🔙 К тикетам', 'admin_tickets')]);
    await ctx.editMessageText(ticketText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    return;
  }

  if (action.startsWith('view_files_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket || !ticket.file_id) return ctx.answerCbQuery('❌ Файлы не найдены!', { show_alert: true });
    const fileIds = JSON.parse(ticket.file_id);
    for (const fileId of fileIds) {
      await ctx.telegram.sendPhoto(id, fileId, { caption: `📷 Скриншот из ${ticket.task_type ? 'заявки' : 'тикета'} #${ticketId}` });
    }
    return ctx.answerCbQuery('📎 Файлы отправлены в чат!', { show_alert: true });
  }

  if (action.startsWith('approve_task_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('❌ Заявка не найдена!', { show_alert: true });
    const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', [ticket.task_type]);
    if (!task) return ctx.answerCbQuery('❌ Задание не найдено!', { show_alert: true });
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['approved', ticketId]);
    db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', [ticket.user_id, task.id, 1, 1]);
    db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [task.reward, ticket.user_id]);
    updateUserTitle(ctx, ticket.user_id); // Проверка титула
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📋 <b>Заявка #${ticket.ticket_id}</b>\n\n` +
          `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
          `📅 <b>Создан:</b> ${ticket.created_at}\n` +
          `📌 <b>Статус:</b> Одобрено ✅\n` +
          `🎉 <b>Награда:</b> ${task.reward} звёзд`;
        await ctx.telegram.editMessageText(
          SUPPORT_CHANNEL,
          ticket.channel_message_id,
          undefined,
          updatedText,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    }
    const taskName = ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота';
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>одобрена</b>! 🎉\n\n` +
      `Ты получил <b>${task.reward} звёзд</b>! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [ticket.user_id]).stars} ⭐`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery(`✅ Заявка #${ticketId} одобрена!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      '📞 <b>Тикеты и заявки</b>\n\n' +
      'Выбери тикет или заявку для обработки: 🔍',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]])
      }
    );
    return;
  }

  if (action.startsWith('reject_task_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('❌ Заявка не найдена!', { show_alert: true });
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['rejected', ticketId]);
    const task = db.get('SELECT id FROM tasks WHERE type = ?', [ticket.task_type]);
    if (task) {
      db.run('DELETE FROM user_tasks WHERE user_id = ? AND task_id = ?', [ticket.user_id, task.id]);
    }
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📋 <b>Заявка #${ticket.ticket_id}</b>\n\n` +
          `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
          `📅 <b>Создан:</b> ${ticket.created_at}\n` +
          `📌 <b>Статус:</b> Отклонено ❌`;
        await ctx.telegram.editMessageText(
          SUPPORT_CHANNEL,
          ticket.channel_message_id,
          undefined,
          updatedText,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    }
    const taskName = ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота';
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>отклонена</b> ❌\n\n` +
      `Попробуй снова! Сделай скриншот и убедись, что выполнил задание правильно. 🛠`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery(`❌ Заявка #${ticketId} отклонена!`, { show_alert: true });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      '📞 <b>Тикеты и заявки</b>\n\n' +
      'Выбери тикет или заявку для обработки: 🔍',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]])
      }
    );
    return;
  }

  if (action.startsWith('reply_ticket_')) {
    const ticketId = parseInt(action.split('_')[2]);
    ctx.session.waitingForTicketReply = ticketId;
    await ctx.reply(
      `✍️ <b>Ответ на тикет #${ticketId}</b>\n\n` +
      `Введи текст ответа для пользователя:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (action.startsWith('set_ticket_status_')) {
    const parts = action.split('_');
    if (parts.length < 4) {
      return ctx.answerCbQuery('❌ Неверный формат действия!', { show_alert: true });
    }
    const ticketId = parseInt(parts[3], 10);
    const status = parts.slice(4).join('_');
    if (isNaN(ticketId) || !['in_progress', 'closed'].includes(status)) {
      return ctx.answerCbQuery('❌ Неверный ID или статус!', { show_alert: true });
    }
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', [status, ticketId]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('❌ Тикет не найден!', { show_alert: true });
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 <b>Тикет #${ticket.ticket_id}</b>\n\n` +
          `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 <b>Описание:</b> ${ticket.description}\n` +
          `📅 <b>Создан:</b> ${ticket.created_at}\n` +
          `📌 <b>Статус:</b> ${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}`;
        await ctx.telegram.editMessageText(
          SUPPORT_CHANNEL,
          ticket.channel_message_id,
          undefined,
          updatedText,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    }
    const userMsg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 <b>Тикет #${ticketId}</b>\n\n` +
      `Статус обновлён: <b>${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}</b>`,
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, userMsg.message_id);
    await ctx.answerCbQuery(`✅ Статус тикета #${ticketId} изменён на "${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}"`, { show_alert: true });
    return;
  }

  if (action === 'back') {
    await ctx.deleteMessage().catch(() => {});
    await sendMainMenu(ctx);
    return;
  }
});

// Обработчик сообщений
bot.on('message', async (ctx) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  let user = db.get('SELECT * FROM users WHERE id = ?', [id]);

  if (!user) {
    ctx.session.waitingForCode = false;
    ctx.session.broadcast = false;
    ctx.session.waitingForPromo = false;
    ctx.session.waitingForSupport = false;
    ctx.session.waitingForTaskScreenshot = null;
    const msg = await ctx.reply('❌ Начни с команды /start, чтобы войти в Magnum Stars! 🚀');
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (ctx.session?.waitingForTaskScreenshot) {
    const taskId = ctx.session.waitingForTaskScreenshot;
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      ctx.session.waitingForTaskScreenshot = null;
      const msg = await ctx.reply('❌ Задание не найдено!', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      return;
    }
    if (!ctx.message.photo) {
      const msg = await ctx.reply(
        '❌ <b>Отправь фото!</b>\n\n' +
        'Нужен скриншот, подтверждающий выполнение задания. 📷',
        { parse_mode: 'HTML' }
      );
      deleteNotification(ctx, msg.message_id);
      return;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const description = `Заявка на задание: ${task.type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : task.type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'}`;
    let info;
    try {
      info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, '📋 Загрузка заявки...');
    } catch (error) {
      console.error('Ошибка отправки сообщения в SUPPORT_CHANNEL:', error);
      const msg = await ctx.reply('❌ Ошибка при создании заявки. Попробуй позже! 🛠', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForTaskScreenshot = null;
      return;
    }
    db.run(`
      INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id, task_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify([fileId]), info.message_id, task.type]);
    const ticketId = db.get('SELECT last_insert_rowid() as id').id;
    const ticketText =
      `📋 <b>Заявка #${ticketId}</b>\n\n` +
      `👤 <b>Пользователь:</b> @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 <b>Задание:</b> ${description}\n` +
      `📎 <b>Файл:</b> 1 шт.\n` +
      `📅 <b>Создан:</b> ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      `📌 <b>Статус:</b> Открыт`;
    try {
      await ctx.telegram.editMessageText(
        SUPPORT_CHANNEL,
        info.message_id,
        undefined,
        ticketText,
        { parse_mode: 'HTML' }
      );
      await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот для заявки #${ticketId}` });
    } catch (error) {
      console.error('Ошибка отправки фото в SUPPORT_CHANNEL:', error);
      db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]);
      const msg = await ctx.reply('❌ Ошибка при создании заявки. Попробуй позже! 🛠', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForTaskScreenshot = null;
      return;
    }
    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `📋 <b>Новая заявка #${ticketId}</b>\n\n` +
        `Задание: "${task.type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : task.type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'}"\n` +
        `От: @${user.username || 'без ника'}`,
        { parse_mode: 'HTML' }
      );
    }
    const msg = await ctx.reply(
      `✅ <b>Заявка #${ticketId}</b> отправлена на проверку! ⏳\n\n` +
      `Ожидай ответа админов. Ты можешь проверить статус в разделе "Задания". 📋`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForTaskScreenshot = null;
    return;
  }

  if (ctx.session?.waitingForSupport) {
    const description = ctx.message.text || 'Без описания';
    const fileIds = [];
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      fileIds.push(photo.file_id);
    }
    if (ctx.message.document) {
      fileIds.push(ctx.message.document.file_id);
    }
    let info;
    try {
      info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, '📞 Загрузка тикета...');
    } catch (error) {
      console.error('Ошибка отправки сообщения в SUPPORT_CHANNEL:', error);
      const msg = await ctx.reply('❌ Ошибка при создании тикета. Попробуй позже! 🛠', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForSupport = false;
      return;
    }
    db.run(`
      INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify(fileIds), info.message_id]);
    const ticketId = db.get('SELECT last_insert_rowid() as id').id;
    const ticketText =
      `📞 <b>Тикет #${ticketId}</b>\n\n` +
      `👤 <b>Пользователь:</b> @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 <b>Описание:</b> ${description}\n` +
      `📎 <b>Файлы:</b> ${fileIds.length > 0 ? fileIds.length + ' шт.' : 'Нет'}\n` +
      `📅 <b>Создан:</b> ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      `📌 <b>Статус:</b> Открыт`;
    try {
      await ctx.telegram.editMessageText(
        SUPPORT_CHANNEL,
        info.message_id,
        undefined,
        ticketText,
        { parse_mode: 'HTML' }
      );
      if (fileIds.length > 0) {
        for (const fileId of fileIds) {
          await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот из тикета #${ticketId}` });
        }
      }
    } catch (error) {
      console.error('Ошибка отправки в SUPPORT_CHANNEL:', error);
      db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]);
      const msg = await ctx.reply('❌ Ошибка при создании тикета. Попробуй позже! 🛠', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForSupport = false;
      return;
    }
    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `📞 <b>Новый тикет #${ticketId}</b>\n\n` +
        `От: @${user.username || 'без ника'}`,
        { parse_mode: 'HTML' }
      );
    }
    const msg = await ctx.reply(
      `✅ <b>Тикет #${ticketId}</b> создан! 🚀\n\n` +
      `Мы ответим тебе в ближайшее время. Спасибо за обращение в Magnum Stars! 😊`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForSupport = false;
    return;
  }

  if (ctx.session?.broadcast && ADMIN_IDS.includes(id)) {
    const users = db.all('SELECT id FROM users');
    let successCount = 0;
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text, { parse_mode: 'HTML' });
        successCount++;
      } catch {}
    }
    const msg = await ctx.reply(
      `✅ <b>Рассылка завершена!</b>\n\n` +
      `Отправлено ${successCount} из ${users.length} пользователям Magnum Stars. 🚀`,
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, msg.message_id);
    ctx.session.broadcast = false;
    return;
  }

  if (ctx.session?.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.get('SELECT * FROM promo_codes WHERE code = ?', [code]);
    if (!promo) {
      const msg = await ctx.reply('❌ <b>Неверный промокод!</b>\n\nПопробуй другой код. 💡', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }
    if (promo.activations_left === 0) {
      const msg = await ctx.reply('⚠️ <b>Промокод исчерпан!</b>\n\nИщи новые коды в наших каналах! 📢', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }
    let usedBy = promo.used_by ? JSON.parse(promo.used_by) : [];
    if (usedBy.includes(id)) {
      const msg = await ctx.reply('⚠️ <b>Ты уже использовал этот промокод!</b>\n\nПопробуй другой. 💡', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }
    db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [promo.reward, id]);
    usedBy.push(id);
    db.run('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?', [
      promo.activations_left - 1,
      JSON.stringify(usedBy),
      code
    ]);
    user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    updateUserTitle(ctx, id); // Проверка титула
    const msg = await ctx.reply(
      `✅ <b>Промокод активирован!</b> 🎉\n\n` +
      `Ты получил <b>${promo.reward} звёзд</b>! Твой баланс: ${user.stars} ⭐`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForCode = false;
    return;
  }

  if (ctx.session?.waitingForPromo && ADMIN_IDS.includes(id)) {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 3) {
      const msg = await ctx.reply(
        '⚠️ <b>Неверный формат!</b>\n\n' +
        'Используй: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\n' +
        'Пример: <code>STAR2023 10 5</code>',
        { parse_mode: 'HTML' }
      );
      deleteNotification(ctx, msg.message_id);
      return;
    }
    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);
    if (!code || isNaN(reward) || isNaN(activations)) {
      const msg = await ctx.reply(
        '⚠️ <b>Неверный формат!</b>\n\n' +
        'Используй: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\n' +
        'Пример: <code>STAR2023 10 5</code>',
        { parse_mode: 'HTML' }
      );
      deleteNotification(ctx, msg.message_id);
      return;
    }
    db.run('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)', [
      code,
      reward,
      activations,
      JSON.stringify([])
    ]);
    const msg = await ctx.reply(
      `✅ <b>Промокод "${code}"</b> добавлен! 🎉\n\n` +
      `Награда: ${reward} звёзд, активаций: ${activations}.`,
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForPromo = false;
    return;
  }

  if (ctx.session?.waitingForTicketReply && ADMIN_IDS.includes(id)) {
    const ticketId = ctx.session.waitingForTicketReply;
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) {
      const msg = await ctx.reply('❌ <b>Тикет не найден!</b>', { parse_mode: 'HTML' });
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForTicketReply = false;
      return;
    }
    const replyText = ctx.message.text || 'Без текста';
    const fileIds = [];
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      fileIds.push(photo.file_id);
    }
    if (ctx.message.document) {
      fileIds.push(ctx.message.document.file_id);
    }
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 <b>Тикет #${ticket.ticket_id}</b>\n\n` +
          `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 <b>Описание:</b> ${ticket.description}\n` +
          `📅 <b>Создан:</b> ${ticket.created_at}\n` +
          `📌 <b>Статус:</b> ${ticket.status}\n` +
          `\n✍️ <b>Ответ:</b> ${replyText}`;
        await ctx.telegram.editMessageText(
          SUPPORT_CHANNEL,
          ticket.channel_message_id,
          undefined,
          updatedText,
          { parse_mode: 'HTML' }
        );
        if (fileIds.length > 0) {
          for (const fileId of fileIds) {
            await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот к ответу #${ticketId}` });
          }
        }
      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    }
    const userMsg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 <b>Ответ на тикет #${ticketId}</b>\n\n${replyText}`,
      { parse_mode: 'HTML' }
    );
    deleteNotification(ctx, userMsg.message_id);
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        await ctx.telegram.sendPhoto(ticket.user_id, fileId, { caption: `📷 Скриншот к ответу #${ticketId}` });
      }
    }
    const replyMsg = await ctx.reply(
      `✅ <b>Ответ на тикет #${ticketId}</b> отправлен! 🚀`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]])
      }
    );
    deleteNotification(ctx, replyMsg.message_id);
    ctx.session.waitingForTicketReply = false;
    return;
  }
});

// Функция регистрации пользователя
function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;
  const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, 0, 0)', [id, username, referral]);
    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
      ctx.telegram.sendMessage(
        referral,
        `🎉 Твой друг @${username || 'без ника'} присоединился к Magnum Stars! +10 звёзд! 🌟`,
        { parse_mode: 'HTML' }
      );
      updateUserTitle(ctx, referral);
    }
  }
}

// Запуск бота
bot.launch().then(() => console.log('🤖 Бот Magnum Stars запущен!')).catch(err => console.error('Ошибка запуска:', err));