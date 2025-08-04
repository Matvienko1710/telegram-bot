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
const TASK_BOT_LINK = process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot';
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [6587897295];
const SUPPORT_CHANNEL = process.env.SUPPORT_CHANNEL || '@magnumsupported';
const FARM_COOLDOWN_SECONDS = parseInt(process.env.FARM_COOLDOWN_SECONDS) || 60;
const MESSAGE_TTL = 15000;
const BOT_NAME = process.env.BOT_NAME || 'MagnumTapBot';

// Утилита для отправки или редактирования сообщений
const utils = {
  async sendOrEditMessage(ctx, text, keyboard, userId) {
    const user = db.get('SELECT last_menu_message_id FROM users WHERE id = ?', [userId]);
    try {
      if (user?.last_menu_message_id && ctx.chat?.id) {
        await ctx.telegram.editMessageText(ctx.chat.id, user.last_menu_message_id, undefined, text, { parse_mode: 'HTML', ...keyboard });
        return user.last_menu_message_id;
      } else {
        const message = await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
        db.run('UPDATE users SET last_menu_message_id = ? WHERE id = ?', [message.message_id, userId]);
        return message.message_id;
      }
    } catch (err) {
      console.error(`Ошибка отправки/редактирования сообщения для ${userId}:`, err);
      const message = await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
      db.run('UPDATE users SET last_menu_message_id = ? WHERE id = ?', [message.message_id, userId]);
      return message.message_id;
    }
  },
  async sendMainMenu(ctx, userId) {
    const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      const msg = await ctx.reply(`❌ Пользователь не найден! Напиши /start, чтобы зарегистрироваться в ${BOT_NAME}.`);
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const stars = user.stars || 0;
    const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [userId]).count || 0;
    const messageText =
      `👋 <b>Добро пожаловать в ${BOT_NAME}!</b> 🌟\n\n` +
      `Ты в игре, где можно <i>зарабатывать звёзды</i> ✨, выполняя простые задания, приглашая друзей и собирая бонусы! 🚀\n\n` +
      `💫 <b>Твой баланс:</b> ${stars} звёзд\n` +
      `👥 <b>Приглашено друзей:</b> ${invited}\n\n` +
      `Выбери действие и стань звездой ${BOT_NAME}! 🌟\n` +
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
      [Markup.button.callback('❓ FAQ', 'faq')],
      [Markup.button.callback('🏅 Титулы', 'titles')],
      ADMIN_IDS.includes(userId) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
    ]);
    await utils.sendOrEditMessage(ctx, messageText, keyboard, userId);
  },
  async deleteNotification(ctx, messageId) {
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
  },
  updateUserTitle(ctx, userId) {
    const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      console.error(`Пользователь ${userId} не найден при обновлении титула`);
      return;
    }
    const stars = user.stars || 0;
    const referrals = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [userId]).count || 0;
    const completedTasks = db.get('SELECT COUNT(*) as count FROM user_tasks WHERE user_id = ? AND completed = 1', [userId]).count || 0;
    const promoCodesUsed = db.get('SELECT COUNT(*) as count FROM promo_codes WHERE used_by LIKE ?', [`%${userId}%`]).count || 0;
    const dailyStreak = user.daily_streak || 0;

    const titles = db.all('SELECT * FROM titles WHERE is_secret = 0 ORDER BY condition_value DESC', []);
    let newTitle = null;
    for (const title of titles) {
      let achieved = false;
      switch (title.condition_type) {
        case 'stars':
          if (stars >= parseInt(title.condition_value)) achieved = true;
          break;
        case 'referrals':
          if (referrals >= parseInt(title.condition_value)) achieved = true;
          break;
        case 'tasks':
          if (completedTasks >= parseInt(title.condition_value)) achieved = true;
          break;
        case 'daily_streak':
          if (dailyStreak >= parseInt(title.condition_value)) achieved = true;
          break;
        case 'promo_codes':
          if (promoCodesUsed >= parseInt(title.condition_value)) achieved = true;
          break;
      }
      if (achieved && (!user.title_id || parseInt(title.condition_value) > parseInt(db.get('SELECT condition_value FROM titles WHERE id = ?', [user.title_id])?.condition_value || 0))) {
        newTitle = title;
        break;
      }
    }

    if (newTitle && newTitle.id !== user.title_id) {
      db.run('UPDATE users SET title_id = ? WHERE id = ?', [newTitle.id, userId]);
      ctx.telegram.sendMessage(
        userId,
        `🎉 Поздравляем! Ты получил титул <b>${newTitle.name}</b>! 🌟\n\n<i>${newTitle.description}</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      ).catch(err => console.error(`Ошибка отправки сообщения о титуле для ${userId}:`, err));
      console.log(`Пользователь ${userId} получил титул "${newTitle.name}" (описание: "${newTitle.description}")`);
    }
  }
};

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

// Middleware для проверки регистрации пользователя
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  ctx.session.previousScreen = ctx.session.previousScreen || null;
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user && ctx.updateType === 'message' && ctx.message?.text !== '/start') {
    const msg = await ctx.reply(`❌ Начни с команды /start, чтобы войти в ${BOT_NAME}! 🚀`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]])
    });
    utils.deleteNotification(ctx, msg.message_id);
    return;
  }
  return next();
});

// Обработчик команды /start
bot.start(async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.currentTaskIndex = 0;
  ctx.session.waitingFor = {};
  ctx.session.previousScreen = null;

  const id = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'без ника';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  // Проверка подписки на обязательный канал
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    ctx.session.previousScreen = 'start';
    const msg = await ctx.reply(
      `🔒 <b>Для начала подпишись на наш канал!</b>\n\n` +
      `📢 Это твой первый шаг к звёздам ${BOT_NAME}! Подпишись на ${REQUIRED_CHANNEL} и возвращайся! 🌟`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
          [Markup.button.callback('✅ Я подписался', 'check_sub')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    return;
  }

  // Регистрация пользователя
  const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, ?, ?)', [id, username, referral, 0, 0]);
    if (referral && referral !== id) {
      const referrerExists = db.get('SELECT * FROM users WHERE id = ?', [referral]);
      if (referrerExists) {
        db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
        ctx.telegram.sendMessage(
          referral,
          `🎉 Твой друг @${username} присоединился к ${BOT_NAME}! +10 звёзд! 🌟`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
        ).catch(err => console.error(`Ошибка уведомления реферера ${referral}:`, err));
        utils.updateUserTitle(ctx, referral);
      }
    }
  }

  await utils.sendMainMenu(ctx, id);
});

// Обработчик команды /help
bot.command('help', async (ctx) => {
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    const msg = await ctx.reply(`❌ Начни с команды /start, чтобы войти в ${BOT_NAME}! 🚀`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]])
    });
    utils.deleteNotification(ctx, msg.message_id);
    return;
  }
  ctx.session.previousScreen = 'main';
  const helpText =
    `🌟 <b>Справка по ${BOT_NAME}</b> ✨\n\n` +
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
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
    ])
  });
  utils.deleteNotification(ctx, msg.message_id);
});

// Обработчик callback-запросов
bot.on('callback_query', async (ctx) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.get('SELECT * FROM users WHERE id = ?', [id]);

  if (!user && action !== 'check_sub') {
    await ctx.answerCbQuery(`❌ Пользователь не найден! Напиши /start в ${BOT_NAME}.`, { show_alert: true });
    return;
  }

  try {
    if (action === 'check_sub') {
      const subscribed = await isUserSubscribed(ctx);
      if (!subscribed) {
        await ctx.answerCbQuery(`❌ Подпишись на ${REQUIRED_CHANNEL} для доступа к ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
      if (!existing) {
        const username = ctx.from.username || ctx.from.first_name || 'без ника';
        const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;
        db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, ?, ?)', [id, username, referral, 0, 0]);
        if (referral && referral !== id) {
          const referrerExists = db.get('SELECT * FROM users WHERE id = ?', [referral]);
          if (referrerExists) {
            db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
            ctx.telegram.sendMessage(
              referral,
              `🎉 Твой друг @${username} присоединился к ${BOT_NAME}! +10 звёзд! 🌟`,
              { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
            ).catch(err => console.error(`Ошибка уведомления реферера ${referral}:`, err));
            utils.updateUserTitle(ctx, referral);
          }
        }
      }
      await utils.sendMainMenu(ctx, id);
      await ctx.answerCbQuery('✅ Подписка подтверждена! Добро пожаловать!', { show_alert: true });
      return;
    }

    if (action === 'farm') {
      const cooldown = FARM_COOLDOWN_SECONDS * 1000;
      if (now - user.last_farm < cooldown) {
        const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
        await ctx.answerCbQuery(`⏳ Подожди ${seconds} сек. для следующего фарма!`, { show_alert: true });
        return;
      }
      db.run('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?', [now, id]);
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
      utils.updateUserTitle(ctx, id);
      await utils.sendMainMenu(ctx, id);
      await ctx.answerCbQuery(`⭐ +1 звезда! Твой баланс: ${user.stars} звёзд.`, { show_alert: true });
      return;
    }

    if (action === 'bonus') {
      const nowDay = dayjs();
      const last = user.last_bonus ? dayjs(user.last_bonus) : null;
      if (last && nowDay.diff(last, 'hour') < 24) {
        const hoursLeft = 24 - nowDay.diff(last, 'hour');
        const minutesLeft = Math.ceil((24 * 60 - nowDay.diff(last, 'minute')) % 60);
        await ctx.answerCbQuery(`🎁 Бонус доступен через ${hoursLeft} ч. ${minutesLeft} мин.`, { show_alert: true });
        return;
      }
      const dailyStreak = last && nowDay.diff(last, 'day') === 1 ? user.daily_streak + 1 : 1;
      db.run('UPDATE users SET stars = stars + 5, last_bonus = ?, daily_streak = ? WHERE id = ?', [nowDay.toISOString(), dailyStreak, id]);
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
      utils.updateUserTitle(ctx, id);
      await utils.sendMainMenu(ctx, id);
      await ctx.answerCbQuery(`🎉 +5 звёзд! Твой баланс: ${user.stars} звёзд.`, { show_alert: true });
      return;
    }

    if (action === 'tasks' || action === 'next_task') {
      ctx.session.previousScreen = 'main';
      ctx.session.currentTaskIndex = action === 'next_task' ? (ctx.session.currentTaskIndex || 0) + 1 : ctx.session.currentTaskIndex || 0;
      const tasks = db.all('SELECT * FROM tasks', []);
      if (tasks.length === 0) {
        await utils.sendOrEditMessage(
          ctx,
          `📋 <b>Заданий пока нет!</b>\n\n<i>Новые задания скоро появятся, следи за обновлениями в ${BOT_NAME}!</i>`,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ]),
          id
        );
        await ctx.answerCbQuery();
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
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ];
      const messageText =
        `📋 <b>Задание #${taskIndex + 1}/${tasks.length}</b>\n\n` +
        `🎯 <b>${task.description}</b>\n` +
        `💰 <b>Награда:</b> ${task.reward} звёзд\n` +
        `📌 <b>Статус:</b> ${taskStatus}\n\n` +
        `<i>Выполни задание и отправь скриншот для проверки!</i>`;
      await utils.sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard(buttons), id);
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('check_task_')) {
      const taskId = parseInt(action.split('_')[2]);
      const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (!task) {
        await ctx.answerCbQuery('❌ Задание не найдено!', { show_alert: true });
        return;
      }
      const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
      if (userTask.completed) {
        await ctx.answerCbQuery(`✅ Задание уже выполнено! Перейди к следующему в ${BOT_NAME}! 🌟`, { show_alert: true });
        return;
      }
      if (userTask.progress > 0) {
        await ctx.answerCbQuery('⏳ Заявка уже на проверке. Ожидай решения админов! 🕒', { show_alert: true });
        return;
      }
      ctx.session.waitingFor = { type: 'task_screenshot', taskId };
      ctx.session.previousScreen = 'tasks';
      const msg = await ctx.reply(
        '📸 <b>Отправь скриншот</b>\n\n' +
        'Сделай скриншот, подтверждающий выполнение задания, и отправь его сюда! 📷',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'faq') {
      ctx.session.previousScreen = 'main';
      const faqText =
        `❓ <b>FAQ ${BOT_NAME}</b>\n\n` +
        `📌 <b>Как зарабатывать звёзды?</b>\n` +
        `- Нажимай "Фарм звёзд" каждые ${FARM_COOLDOWN_SECONDS} секунд (+1 звезда).\n` +
        `- Забирай ежедневный бонус раз в 24 часа (+5 звёзд).\n` +
        `- Выполняй задания (подписки, запуск ботов) и отправляй скриншоты.\n` +
        `- Приглашай друзей по реферальной ссылке (+10 звёзд за друга).\n` +
        `- Активируй промокоды для бонусов.\n\n` +
        `🏅 <b>Что дают титулы?</b>\n` +
        `Титулы показывают твой прогресс и статус в ${BOT_NAME}. Зарабатывай звёзды, приглашай друзей или выполняй задания, чтобы открыть новые!\n\n` +
        `📞 <b>Проблемы или вопросы?</b>\n` +
        `Пиши в поддержку через раздел "Поддержка" в профиле, мы ответим быстро!\n\n` +
        `<i>Есть ещё вопросы? Создай тикет, и мы поможем!</i>`;
      await utils.sendOrEditMessage(
        ctx,
        faqText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'titles') {
      ctx.session.previousScreen = 'main';
      const titles = db.all('SELECT * FROM titles WHERE is_secret = 0', []);
      const userTitle = user.title_id ? db.get('SELECT * FROM titles WHERE id = ?', [user.title_id]) : null;
      const titleList = titles.length > 0
        ? titles.map(t => `🏅 <b>${t.name}</b> (${t.description})${user.title_id === t.id ? ' ✅' : ''}`).join('\n')
        : '😔 Пока нет доступных титулов.';
      const messageText =
        `🏅 <b>Титулы ${BOT_NAME}</b>\n\n` +
        `Текущий титул: ${userTitle ? `<b>${userTitle.name}</b> (${userTitle.description})` : 'Нет титула'}\n\n` +
        `Доступные титулы:\n${titleList}\n\n` +
        `<i>Зарабатывай звёзды, приглашай друзей и выполняй задания, чтобы открыть новые титулы!</i>`;
      await utils.sendOrEditMessage(
        ctx,
        messageText,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'profile') {
      ctx.session.previousScreen = 'main';
      const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count || 0;
      const referredByUser = user.referred_by ? db.get('SELECT username FROM users WHERE id = ?', [user.referred_by]) : null;
      const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
      const displayName = ctx.from.first_name || 'Аноним';
      const title = user.title_id ? db.get('SELECT name, description FROM titles WHERE id = ?', [user.title_id]) : null;
      const titleText = title ? `${title.name} (${title.description})` : 'Нет титула';
      const completedTasks = db.all('SELECT t.description FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? AND ut.completed = 1', [id]);
      const nowDay = dayjs();
      const lastBonus = user.last_bonus ? dayjs(user.last_bonus) : null;
      const bonusStatus = lastBonus && nowDay.diff(lastBonus, 'hour') < 24
        ? `⏳ Доступно через ${24 - nowDay.diff(lastBonus, 'hour')} ч. ${Math.ceil((24 * 60 - nowDay.diff(lastBonus, 'minute')) % 60)} мин.`
        : '✅ Доступно!';
      const profileText =
        `🌟 <b>Твой профиль в ${BOT_NAME}</b> ✨\n\n` +
        `👤 <b>Имя:</b> ${displayName}\n` +
        `🏅 <b>Титул:</b> ${titleText}\n` +
        `🆔 <b>ID:</b> ${user.id}\n` +
        `💫 <b>Звёзды:</b> ${user.stars} ✨\n` +
        `👥 <b>Приглашено друзей:</b> ${invited}\n` +
        `📣 <b>Твой реферал:</b> ${referrerName}\n` +
        `🎁 <b>Ежедневный бонус:</b> ${bonusStatus}\n` +
        `📋 <b>Выполненные задания:</b> ${completedTasks.length > 0 ? completedTasks.map(t => t.description).join(', ') : 'Нет'}\n\n` +
        `<i>Зарабатывай больше звёзд и стань легендой ${BOT_NAME}!</i>`;
      await utils.sendOrEditMessage(
        ctx,
        profileText,
        Markup.inlineKeyboard([
          [Markup.button.callback('❓ FAQ', 'faq'), Markup.button.callback('📞 Поддержка', 'support')],
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'support') {
      ctx.session.previousScreen = 'profile';
      ctx.session.waitingFor = { type: 'support' };
      const msg = await ctx.reply(
        `📞 <b>Связаться с поддержкой ${BOT_NAME}</b>\n\n` +
        'Опиши свою проблему или вопрос, можно прикрепить фото или документ. Мы ответим максимально быстро! 🚀',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'cancel_input') {
      ctx.session.waitingFor = {};
      const previousScreen = ctx.session.previousScreen || 'main';
      ctx.session.previousScreen = null;
      if (previousScreen === 'main') {
        await utils.sendMainMenu(ctx, id);
      } else if (previousScreen === 'tasks') {
        ctx.session.currentTaskIndex = ctx.session.currentTaskIndex || 0;
        const tasks = db.all('SELECT * FROM tasks', []);
        if (tasks.length === 0) {
          await utils.sendOrEditMessage(
            ctx,
            `📋 <b>Заданий пока нет!</b>\n\n<i>Новые задания скоро появятся, следи за обновлениями в ${BOT_NAME}!</i>`,
            Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
            ]),
            id
          );
        } else {
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
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ];
          const messageText =
            `📋 <b>Задание #${taskIndex + 1}/${tasks.length}</b>\n\n` +
            `🎯 <b>${task.description}</b>\n` +
            `💰 <b>Награда:</b> ${task.reward} звёзд\n` +
            `📌 <b>Статус:</b> ${taskStatus}\n\n` +
            `<i>Выполни задание и отправь скриншот для проверки!</i>`;
          await utils.sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard(buttons), id);
        }
      } else if (previousScreen === 'profile') {
        const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count || 0;
        const referredByUser = user.referred_by ? db.get('SELECT username FROM users WHERE id = ?', [user.referred_by]) : null;
        const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
        const displayName = ctx.from.first_name || 'Аноним';
        const title = user.title_id ? db.get('SELECT name, description FROM titles WHERE id = ?', [user.title_id]) : null;
        const titleText = title ? `${title.name} (${title.description})` : 'Нет титула';
        const completedTasks = db.all('SELECT t.description FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? AND ut.completed = 1', [id]);
        const nowDay = dayjs();
        const lastBonus = user.last_bonus ? dayjs(user.last_bonus) : null;
        const bonusStatus = lastBonus && nowDay.diff(lastBonus, 'hour') < 24
          ? `⏳ Доступно через ${24 - nowDay.diff(lastBonus, 'hour')} ч. ${Math.ceil((24 * 60 - nowDay.diff(lastBonus, 'minute')) % 60)} мин.`
          : '✅ Доступно!';
        const profileText =
          `🌟 <b>Твой профиль в ${BOT_NAME}</b> ✨\n\n` +
          `👤 <b>Имя:</b> ${displayName}\n` +
          `🏅 <b>Титул:</b> ${titleText}\n` +
          `🆔 <b>ID:</b> ${user.id}\n` +
          `💫 <b>Звёзды:</b> ${user.stars} ✨\n` +
          `👥 <b>Приглашено друзей:</b> ${invited}\n` +
          `📣 <b>Твой реферал:</b> ${referrerName}\n` +
          `🎁 <b>Ежедневный бонус:</b> ${bonusStatus}\n` +
          `📋 <b>Выполненные задания:</b> ${completedTasks.length > 0 ? completedTasks.map(t => t.description).join(', ') : 'Нет'}\n\n` +
          `<i>Зарабатывай больше звёзд и стань легендой ${BOT_NAME}!</i>`;
        await utils.sendOrEditMessage(
          ctx,
          profileText,
          Markup.inlineKeyboard([
            [Markup.button.callback('❓ FAQ', 'faq'), Markup.button.callback('📞 Поддержка', 'support')],
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ]),
          id
        );
      } else if (previousScreen === 'admin') {
        await utils.sendOrEditMessage(
          ctx,
          `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
          Markup.inlineKeyboard([
            [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
            [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
            [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
            [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
            [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
            [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
            [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
            [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ]),
          id
        );
      } else if (previousScreen === 'admin_tickets') {
        const tickets = db.all('SELECT * FROM tickets WHERE status IN (?, ?) ORDER BY created_at DESC LIMIT 10', ['open', 'in_progress']);
        const buttons = tickets.length > 0
          ? tickets.map(ticket => {
              const type = ticket.task_type
                ? `📋 Заявка (${ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
                : '📞 Тикет';
              return [Markup.button.callback(
                `${type} #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
                `ticket_${ticket.ticket_id}`
              )];
            }).concat([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]])
          : [[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]];
        await utils.sendOrEditMessage(
          ctx,
          `📞 <b>Тикеты и заявки</b>\n\n` +
          (tickets.length > 0 ? `Выбери тикет или заявку для обработки: 🔍` : `😔 Нет открытых тикетов или заявок.`),
          Markup.inlineKeyboard(buttons),
          id
        );
      } else {
        await utils.sendMainMenu(ctx, id);
      }
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'leaders') {
      ctx.session.previousScreen = 'main';
      const top = getTopUsers();
      const list = top.length > 0
        ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐ — друзей: ${u.referrals}`).join('\n')
        : '😔 Пока нет лидеров. Будь первым! 🚀';
      await utils.sendOrEditMessage(
        ctx,
        `🏆 <b>Топ-10 игроков ${BOT_NAME}</b> 🌟\n\n${list}\n\n<i>Приглашай друзей и выполняй задания, чтобы попасть в топ!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'stats') {
      ctx.session.previousScreen = 'main';
      const total = db.get('SELECT COUNT(*) as count FROM users').count || 0;
      const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
      const completedTasks = db.get('SELECT COUNT(*) as count FROM user_tasks WHERE completed = 1').count || 0;
      await utils.sendOrEditMessage(
        ctx,
        `📊 <b>Статистика ${BOT_NAME}</b> ✨\n\n` +
        `👥 <b>Игроков:</b> ${total}\n` +
        `⭐ <b>Всего звёзд:</b> ${totalStars}\n` +
        `📋 <b>Выполнено заданий:</b> ${completedTasks}\n\n` +
        `<i>Присоединяйся к нашей звёздной команде!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'ref') {
      ctx.session.previousScreen = 'main';
      const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
      await utils.sendOrEditMessage(
        ctx,
        `📩 <b>Приглашай друзей в ${BOT_NAME}!</b> 👥\n\n` +
        `Твоя реферальная ссылка:\n<a href="${link}">${link}</a>\n\n` +
        `За каждого друга, который присоединится по ссылке, ты получишь <b>+10 звёзд</b>! 🌟\n` +
        `<i>Делись ссылкой и становись лидером!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'enter_code') {
      ctx.session.previousScreen = 'main';
      ctx.session.waitingFor = { type: 'promo_code' };
      const msg = await ctx.reply(
        `💡 <b>Введи промокод</b>\n\n` +
        `Отправь секретный код, чтобы получить бонусные звёзды в ${BOT_NAME}! ✨`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'main';
      await utils.sendOrEditMessage(
        ctx,
        `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
          [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
          [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
          [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
          [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
          [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
          [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
          [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_stats') {
      const total = db.get('SELECT COUNT(*) as count FROM users').count || 0;
      const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
      const openTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['open']).count || 0;
      const inProgressTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['in_progress']).count || 0;
      const closedTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['closed']).count || 0;
      const approvedTasks = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['approved']).count || 0;
      const rejectedTasks = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['rejected']).count || 0;
      await ctx.answerCbQuery(
        `📊 <b>Статистика ${BOT_NAME}</b>\n\n` +
        `👥 Игроков: ${total}\n` +
        `⭐ Всего звёзд: ${totalStars}\n` +
        `📞 Тикеты: Открыто: ${openTickets} | В работе: ${inProgressTickets} | Закрыто: ${closedTickets}\n` +
        `📋 Заявки: Одобрено: ${approvedTasks} | Отклонено: ${rejectedTasks}`,
        { show_alert: true }
      );
      return;
    }

    if (action === 'admin_top') {
      ctx.session.previousScreen = 'admin';
      const top = getTopUsers();
      const list = top.length > 0
        ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐`).join('\n')
        : '😔 Пока нет лидеров.';
      await utils.sendOrEditMessage(
        ctx,
        `🏆 <b>Топ-10 игроков ${BOT_NAME}</b> 🌟\n\n${list}\n\n<i>Это лучшие звёздные охотники!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_broadcast') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'admin';
      ctx.session.waitingFor = { type: 'broadcast' };
      const msg = await ctx.reply(
        `📢 <b>Рассылка</b>\n\n` +
        `Введи текст, который получат все пользователи ${BOT_NAME}. Будь осторожен, сообщение уйдёт всем! 🚨`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_addcode') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'admin';
      ctx.session.waitingFor = { type: 'add_promo' };
      const msg = await ctx.reply(
        `➕ <b>Добавить промокод</b>\n\n` +
        `Введи данные в формате: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\n` +
        `Пример: <code>STAR2025 10 5</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_addtask') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'admin';
      ctx.session.waitingFor = { type: 'add_task' };
      const msg = await ctx.reply(
        `➕ <b>Добавить задание</b>\n\n` +
        `Введи данные в формате: <code>ТИП ОПИСАНИЕ ЦЕЛЬ НАГРАДА</code>\n` +
        `Пример: <code>subscribe_channel Подпишись на ${TASK_CHANNEL} 1 5</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_stars') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'admin';
      ctx.session.waitingFor = { type: 'manage_stars' };
      const msg = await ctx.reply(
        `⭐ <b>Управление звёздами</b>\n\n` +
        `Введи данные в формате: <code>ID_ПОЛЬЗОВАТЕЛЯ КОЛИЧЕСТВО</code>\n` +
        `Пример: <code>123456789 50</code> для добавления или <code>123456789 -50</code> для снятия`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_titles') {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      ctx.session.previousScreen = 'admin';
      ctx.session.waitingFor = { type: 'manage_titles' };
      const titles = db.all('SELECT * FROM titles', []);
      const titleList = titles.length > 0
        ? titles.map(t => `ID ${t.id}: <b>${t.name}</b> (${t.description})${t.is_secret ? ' 🔒 Секретный' : ''}`).join('\n')
        : '😔 Титулы не найдены.';
      const msg = await ctx.reply(
        `🏅 <b>Управление титулами</b>\n\n` +
        `Введи данные в формате: <code>ID_ПОЛЬЗОВАТЕЛЯ ID_ТИТУЛА</code>\n` +
        `Пример: <code>123456789 10</code> для выдачи или <code>123456789 0</code> для снятия\n\n` +
        `Список титулов:\n${titleList}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'admin_tickets') {
      ctx.session.previousScreen = 'admin';
      const tickets = db.all('SELECT * FROM tickets WHERE status IN (?, ?) ORDER BY created_at DESC LIMIT 10', ['open', 'in_progress']);
      const buttons = tickets.length > 0
        ? tickets.map(ticket => {
            const type = ticket.task_type
              ? `📋 Заявка (${ticket.task_type === 'subscribe_channel' ? `Подписка на ${TASK_CHANNEL}` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на ${TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
              : '📞 Тикет';
            return [Markup.button.callback(
              `${type} #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
              `ticket_${ticket.ticket_id}`
            )];
          }).concat([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]])
        : [[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]];
      await utils.sendOrEditMessage(
        ctx,
        `📞 <b>Тикеты и заявки</b>\n\n` +
        (tickets.length > 0 ? `Выбери тикет или заявку для обработки: 🔍` : `😔 Нет открытых тикетов или заявок.`),
        Markup.inlineKeyboard(buttons),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('ticket_')) {
      ctx.session.previousScreen = 'admin_tickets';
      const ticketId = parseInt(action.split('_')[1]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        await ctx.answerCbQuery('❌ Тикет или заявка не найдены!', { show_alert: true });
        return;
      }
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
      buttons.push([Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]);
      await utils.sendOrEditMessage(ctx, ticketText, Markup.inlineKeyboard(buttons), id);
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('view_files_')) {
      const ticketId = parseInt(action.split('_')[2]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket || !ticket.file_id) {
        await ctx.answerCbQuery('❌ Файлы не найдены!', { show_alert: true });
        return;
      }
      const fileIds = JSON.parse(ticket.file_id);
      for (const fileId of fileIds) {
        await ctx.telegram.sendPhoto(id, fileId, { caption: `📷 Скриншот из ${ticket.task_type ? 'заявки' : 'тикета'} #${ticketId}` });
      }
      await ctx.answerCbQuery('📎 Файлы отправлены в чат!', { show_alert: true });
      return;
    }

    if (action.startsWith('approve_task_')) {
      const ticketId = parseInt(action.split('_')[2]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        await ctx.answerCbQuery('❌ Заявка не найдена!', { show_alert: true });
        return;
      }
      const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', [ticket.task_type]);
      if (!task) {
        await ctx.answerCbQuery('❌ Задание не найдено!', { show_alert: true });
        return;
      }
      db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['approved', ticketId]);
      db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', [ticket.user_id, task.id, 1, 1]);
      db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [task.reward, ticket.user_id]);
      utils.updateUserTitle(ctx, ticket.user_id);
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
      const userMsg = await ctx.telegram.sendMessage(
        ticket.user_id,
        `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>одобрена</b>! 🎉\n\n` +
        `Ты получил <b>${task.reward} звёзд</b>! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [ticket.user_id]).stars} ⭐`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      );
      utils.deleteNotification(ctx, userMsg.message_id);
      const msg = await ctx.reply(
        `✅ <b>Заявка #${ticketId} одобрена!</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await utils.sendOrEditMessage(
        ctx,
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('reject_task_')) {
      const ticketId = parseInt(action.split('_')[2]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        await ctx.answerCbQuery('❌ Заявка не найдена!', { show_alert: true });
        return;
      }
      const task = db.get('SELECT id FROM tasks WHERE type = ?', [ticket.task_type]);
      if (task) {
        db.run('DELETE FROM user_tasks WHERE user_id = ? AND task_id = ?', [ticket.user_id, task.id]);
      }
      db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['rejected', ticketId]);
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
      const userMsg = await ctx.telegram.sendMessage(
        ticket.user_id,
        `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>отклонена</b> ❌\n\n` +
        `Попробуй снова! Сделай скриншот и убедись, что выполнил задание правильно. 🛠`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      );
      utils.deleteNotification(ctx, userMsg.message_id);
      const msg = await ctx.reply(
        `❌ <b>Заявка #${ticketId} отклонена!</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await utils.sendOrEditMessage(
        ctx,
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('reply_ticket_')) {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      const ticketId = parseInt(action.split('_')[2]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        await ctx.answerCbQuery('❌ Тикет не найден!', { show_alert: true });
        return;
      }
      ctx.session.waitingFor = { type: 'reply_ticket', ticketId };
      ctx.session.previousScreen = 'admin_tickets';
      const msg = await ctx.reply(
        `✍️ <b>Ответ на тикет #${ticketId}</b>\n\n` +
        `Введи текст ответа для пользователя @${ticket.username || 'без ника'}:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await ctx.answerCbQuery();
      return;
    }

    if (action.startsWith('set_ticket_status_')) {
      if (!ADMIN_IDS.includes(id)) {
        await ctx.answerCbQuery(`⛔ Доступ только для админов ${BOT_NAME}!`, { show_alert: true });
        return;
      }
      const [_, ticketId, status] = action.split('_');
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        await ctx.answerCbQuery('❌ Тикет не найден!', { show_alert: true });
        return;
      }
      db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', [status, ticketId]);
      if (ticket.channel_message_id) {
        try {
          const updatedText =
            `📞 <b>Тикет #${ticket.ticket_id}</b>\n\n` +
            `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
            `🆔 ID: ${ticket.user_id}\n` +
            `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
            `📅 <b>Создан:</b> ${ticket.created_at}\n` +
            `📌 <b>Статус:</b> ${status === 'in_progress' ? 'В работе' : 'Закрыто'}`;
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
      const statusText = status === 'in_progress' ? 'в работе' : 'закрыт';
      const userMsg = await ctx.telegram.sendMessage(
        ticket.user_id,
        `📞 <b>Тикет #${ticketId}</b> теперь <b>${statusText}</b>.\n\n` +
        `Ожидай ответа от поддержки ${BOT_NAME}! 🚀`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      );
      utils.deleteNotification(ctx, userMsg.message_id);
      const msg = await ctx.reply(
        `✅ <b>Тикет #${ticketId} ${statusText}!</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      await utils.sendOrEditMessage(
        ctx,
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]]),
        id
      );
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'back_to_main') {
      ctx.session.previousScreen = null;
      await utils.sendMainMenu(ctx, id);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'back') {
      ctx.session.previousScreen = null;
      await utils.sendMainMenu(ctx, id);
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery('❓ Неизвестное действие.', { show_alert: true });
  } catch (err) {
    console.error(`Ошибка обработки callback ${action}:`, err);
    await ctx.answerCbQuery('❌ Произошла ошибка, попробуй снова!', { show_alert: true });
  }
});

// Обработчик текстовых сообщений и файлов
bot.on(['text', 'photo', 'document'], async (ctx) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    const msg = await ctx.reply(`❌ Начни с команды /start, чтобы войти в ${BOT_NAME}! 🚀`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]])
    });
    utils.deleteNotification(ctx, msg.message_id);
    return;
  }

  const waitingFor = ctx.session.waitingFor || {};
  const text = ctx.message.text;
  const photos = ctx.message.photo;
  const document = ctx.message.document;

  if (waitingFor.type === 'promo_code' && text) {
    const code = text.trim().toUpperCase();
    const promo = db.get('SELECT * FROM promo_codes WHERE code = ?', [code]);
    if (!promo) {
      const msg = await ctx.reply(
        `❌ Промокод <b>${code}</b> не найден! Попробуй другой.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendMainMenu(ctx, id);
      return;
    }
    if (promo.activations_left <= 0) {
      const msg = await ctx.reply(
        `❌ Промокод <b>${code}</b> исчерпал лимит активаций!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendMainMenu(ctx, id);
      return;
    }
    const usedBy = JSON.parse(promo.used_by || '[]');
    if (usedBy.includes(id)) {
      const msg = await ctx.reply(
        `❌ Ты уже использовал промокод <b>${code}</b>!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendMainMenu(ctx, id);
      return;
    }
    usedBy.push(id);
    db.run('UPDATE promo_codes SET activations_left = activations_left - 1, used_by = ? WHERE code = ?', [JSON.stringify(usedBy), code]);
    db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [promo.reward, id]);
    utils.updateUserTitle(ctx, id);
    const msg = await ctx.reply(
      `🎉 Промокод <b>${code}</b> активирован! +${promo.reward} звёзд! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [id]).stars} ⭐`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendMainMenu(ctx, id);
    return;
  }

  if (waitingFor.type === 'support' && (text || photos || document)) {
    const description = text || ctx.message.caption || 'Без описания';
    const fileIds = [];
    if (photos) {
      fileIds.push(photos[photos.length - 1].file_id);
    }
    if (document) {
      fileIds.push(document.file_id);
    }
    const ticketId = db.run(
      'INSERT INTO tickets (user_id, username, description, created_at, file_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, user.username || ctx.from.first_name || 'без ника', description, new Date().toISOString(), JSON.stringify(fileIds), 'open']
    ).lastInsertRowid;
    const channelMsg = await ctx.telegram.sendMessage(
      SUPPORT_CHANNEL,
      `📞 <b>Новый тикет #${ticketId}</b>\n\n` +
      `👤 <b>Пользователь:</b> @${user.username || 'без ника'}\n` +
      `�ID: ${id}\n` +
      `📝 <b>Описание:</b> ${description}\n` +
      `📎 <b>Файлы:</b> ${fileIds.length > 0 ? `${fileIds.length} шт.` : 'Нет'}\n` +
      `📅 <b>Создан:</b> ${new Date().toISOString()}\n` +
      `📌 <b>Статус:</b> Открыт`,
      { parse_mode: 'HTML' }
    );
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        if (photos) {
          await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `📷 Файл из тикета #${ticketId}` });
        } else {
          await ctx.telegram.sendDocument(SUPPORT_CHANNEL, fileId, { caption: `📎 Файл из тикета #${ticketId}` });
        }
      }
    }
    db.run('UPDATE tickets SET channel_message_id = ? WHERE ticket_id = ?', [channelMsg.message_id, ticketId]);
    const msg = await ctx.reply(
      `📞 <b>Тикет #${ticketId} создан!</b>\n\n` +
      `Мы получили твой запрос и скоро ответим. Спасибо за обращение в ${BOT_NAME}! 🚀`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'profile'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `🌟 <b>Твой профиль в ${BOT_NAME}</b> ✨\n\n` +
      `👤 <b>Имя:</b> ${ctx.from.first_name || 'Аноним'}\n` +
      `🏅 <b>Титул:</b> ${user.title_id ? db.get('SELECT name, description FROM titles WHERE id = ?', [user.title_id]).name : 'Нет титула'}\n` +
      `🆔 <b>ID:</b> ${user.id}\n` +
      `💫 <b>Звёзды:</b> ${user.stars} ✨\n` +
      `👥 <b>Приглашено друзей:</b> ${db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count || 0}\n` +
      `📣 <b>Твой реферал:</b> ${user.referred_by ? `@${db.get('SELECT username FROM users WHERE id = ?', [user.referred_by]).username || 'без ника'}` : '—'}\n` +
      `🎁 <b>Ежедневный бонус:</b> ${user.last_bonus && dayjs().diff(dayjs(user.last_bonus), 'hour') < 24 ? '⏳ Доступно позже' : '✅ Доступно!'}\n` +
      `📋 <b>Выполненные задания:</b> ${db.all('SELECT t.description FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? AND ut.completed = 1', [id]).length > 0 ? 'Есть' : 'Нет'}\n\n` +
      `<i>Зарабатывай больше звёзд и стань легендой ${BOT_NAME}!</i>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('❓ FAQ', 'faq'), Markup.button.callback('📞 Поддержка', 'support')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'task_screenshot' && (photos || document)) {
    const taskId = waitingFor.taskId;
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      const msg = await ctx.reply(
        `❌ Задание не найдено! Попробуй снова.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'tasks'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendMainMenu(ctx, id);
      return;
    }
    const fileIds = [];
    if (photos) {
      fileIds.push(photos[photos.length - 1].file_id);
    }
    if (document) {
      fileIds.push(document.file_id);
    }
    const description = ctx.message.caption || `Заявка на задание "${task.description}"`;
    const ticketId = db.run(
      'INSERT INTO tickets (user_id, username, description, created_at, file_id, status, task_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, user.username || ctx.from.first_name || 'без ника', description, new Date().toISOString(), JSON.stringify(fileIds), 'open', task.type]
    ).lastInsertRowid;
    const channelMsg = await ctx.telegram.sendMessage(
      SUPPORT_CHANNEL,
      `📋 <b>Новая заявка #${ticketId}</b>\n\n` +
      `👤 <b>Пользователь:</b> @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 <b>Описание:</b> ${description}\n` +
      `📎 <b>Файлы:</b> ${fileIds.length} шт.\n` +
      `📅 <b>Создан:</b> ${new Date().toISOString()}\n` +
      `📌 <b>Статус:</b> Открыт\n` +
      `🎯 <b>Задание:</b> ${task.description}\n` +
      `💰 <b>Награда:</b> ${task.reward} звёзд`,
      { parse_mode: 'HTML' }
    );
    for (const fileId of fileIds) {
      if (photos) {
        await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот из заявки #${ticketId}` });
      } else {
        await ctx.telegram.sendDocument(SUPPORT_CHANNEL, fileId, { caption: `📎 Файл из заявки #${ticketId}` });
      }
    }
    db.run('UPDATE tickets SET channel_message_id = ? WHERE ticket_id = ?', [channelMsg.message_id, ticketId]);
    db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', [id, taskId, 1, 0]);
    const msg = await ctx.reply(
      `📋 <b>Заявка #${ticketId} отправлена на проверку!</b>\n\n` +
      `Ожидай решения админов ${BOT_NAME}. Ты получишь уведомление! 🚀`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'tasks'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    const tasks = db.all('SELECT * FROM tasks', []);
    const taskIndex = ctx.session.currentTaskIndex || 0;
    if (tasks.length === 0) {
      await utils.sendOrEditMessage(
        ctx,
        `📋 <b>Заданий пока нет!</b>\n\n<i>Новые задания скоро появятся, следи за обновлениями в ${BOT_NAME}!</i>`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
    } else {
      const task = tasks[taskIndex % tasks.length];
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
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ];
      await utils.sendOrEditMessage(
        ctx,
        `📋 <b>Задание #${taskIndex + 1}/${tasks.length}</b>\n\n` +
        `🎯 <b>${task.description}</b>\n` +
        `💰 <b>Награда:</b> ${task.reward} звёзд\n` +
        `📌 <b>Статус:</b> ${taskStatus}\n\n` +
        `<i>Выполни задание и отправь скриншот для проверки!</i>`,
        Markup.inlineKeyboard(buttons),
        id
      );
    }
    return;
  }

  if (waitingFor.type === 'broadcast' && text && ADMIN_IDS.includes(id)) {
    const users = db.all('SELECT id FROM users', []);
    let success = 0;
    let failed = 0;
    for (const user of users) {
      try {
        const msg = await ctx.telegram.sendMessage(
          user.id,
          `📢 <b>Новость от ${BOT_NAME}</b>\n\n${text}`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
        );
        utils.deleteNotification(ctx, msg.message_id);
        success++;
      } catch (err) {
        console.error(`Ошибка отправки рассылки пользователю ${user.id}:`, err);
        failed++;
      }
    }
    const msg = await ctx.reply(
      `📢 <b>Рассылка завершена!</b>\n\n` +
      `✅ Успешно: ${success}\n` +
      `❌ Не доставлено: ${failed}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
        [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
        [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
        [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'add_promo' && text && ADMIN_IDS.includes(id)) {
    const parts = text.trim().split(' ');
    if (parts.length !== 3) {
      const msg = await ctx.reply(
        `❌ Неверный формат! Используй: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\nПример: <code>STAR2025 10 5</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const [code, reward, activations] = parts;
    const parsedReward = parseInt(reward);
    const parsedActivations = parseInt(activations);
    if (isNaN(parsedReward) || isNaN(parsedActivations) || parsedReward <= 0 || parsedActivations <= 0) {
      const msg = await ctx.reply(
        `❌ Неверные значения! Звёзды и активации должны быть числами > 0.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    db.run('INSERT OR REPLACE INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)', [code.toUpperCase(), parsedReward, parsedActivations, '[]']);
    const msg = await ctx.reply(
      `✅ Промокод <b>${code.toUpperCase()}</b> создан!\n` +
      `💰 Награда: ${parsedReward} звёзд\n` +
      `🔄 Активаций: ${parsedActivations}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
        [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
        [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
        [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'add_task' && text && ADMIN_IDS.includes(id)) {
    const parts = text.trim().split(' ', 4);
    if (parts.length !== 4) {
      const msg = await ctx.reply(
        `❌ Неверный формат! Используй: <code>ТИП ОПИСАНИЕ ЦЕЛЬ НАГРАДА</code>\n` +
        `Пример: <code>subscribe_channel Подпишись_на_${TASK_CHANNEL} 1 5</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const [type, ...rest] = parts;
    const description = rest[0].replace(/_/g, ' ');
    const goal = parseInt(rest[1]);
    const reward = parseInt(rest[2]);
    if (isNaN(goal) || isNaN(reward) || goal <= 0 || reward <= 0) {
      const msg = await ctx.reply(
        `❌ Неверные значения! Цель и награда должны быть числами > 0.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    db.run('INSERT OR REPLACE INTO tasks (type, description, goal, reward) VALUES (?, ?, ?, ?)', [type, description, goal, reward]);
    const msg = await ctx.reply(
      `✅ Задание создано!\n` +
      `🎯 Тип: ${type}\n` +
      `📝 Описание: ${description}\n` +
      `🏁 Цель: ${goal}\n` +
      `💰 Награда: ${reward} звёзд`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
        [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
        [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
        [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'manage_stars' && text && ADMIN_IDS.includes(id)) {
    const parts = text.trim().split(' ');
    if (parts.length !== 2) {
      const msg = await ctx.reply(
        `❌ Неверный формат! Используй: <code>ID_ПОЛЬЗОВАТЕЛЯ КОЛИЧЕСТВО</code>\n` +
        `Пример: <code>123456789 50</code> или <code>123456789 -50</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const [targetId, amount] = parts.map(Number);
    if (isNaN(targetId) || isNaN(amount)) {
      const msg = await ctx.reply(
        `❌ Неверные значения! ID и количество должны быть числами.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const targetUser = db.get('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!targetUser) {
      const msg = await ctx.reply(
        `❌ Пользователь с ID ${targetId} не найден!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendOrEditMessage(
        ctx,
        `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
          [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
          [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
          [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
          [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
          [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
          [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
          [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      return;
    }
    const newStars = Math.max(0, targetUser.stars + amount);
    db.run('UPDATE users SET stars = ? WHERE id = ?', [newStars, targetId]);
    utils.updateUserTitle(ctx, targetId);
    const actionText = amount > 0 ? `выдано ${amount} звёзд` : `снято ${-amount} звёзд`;
    const userMsg = await ctx.telegram.sendMessage(
      targetId,
      `⭐ <b>Обновление баланса!</b>\n\n` +
      `Администратор ${actionText}. Твой баланс: ${newStars} ⭐`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
    );
    utils.deleteNotification(ctx, userMsg.message_id);
    const msg = await ctx.reply(
      `✅ Пользователю ${targetId} ${actionText}. Новый баланс: ${newStars} ⭐`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
        [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
        [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
        [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'manage_titles' && text && ADMIN_IDS.includes(id)) {
    const parts = text.trim().split(' ');
    if (parts.length !== 2) {
      const msg = await ctx.reply(
        `❌ Неверный формат! Используй: <code>ID_ПОЛЬЗОВАТЕЛЯ ID_ТИТУЛА</code>\n` +
        `Пример: <code>123456789 10</code> или <code>123456789 0</code> для снятия`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const [targetId, titleId] = parts.map(Number);
    if (isNaN(targetId) || (titleId !== 0 && isNaN(titleId))) {
      const msg = await ctx.reply(
        `❌ Неверные значения! ID пользователя и титула должны быть числами.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_input')]])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      return;
    }
    const targetUser = db.get('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!targetUser) {
      const msg = await ctx.reply(
        `❌ Пользователь с ID ${targetId} не найден!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendOrEditMessage(
        ctx,
        `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
          [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
          [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
          [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
          [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
          [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
          [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
          [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
          [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
        ]),
        id
      );
      return;
    }
    if (titleId !== 0) {
      const title = db.get('SELECT * FROM titles WHERE id = ?', [titleId]);
      if (!title) {
        const msg = await ctx.reply(
          `❌ Титул с ID ${titleId} не найден!`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
            ])
          }
        );
        utils.deleteNotification(ctx, msg.message_id);
        ctx.session.waitingFor = {};
        await utils.sendOrEditMessage(
          ctx,
          `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
          Markup.inlineKeyboard([
            [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
            [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
            [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
            [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
            [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
            [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
            [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
            [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
            [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
          ]),
          id
        );
        return;
      }
      db.run('UPDATE users SET title_id = ? WHERE id = ?', [titleId, targetId]);
      const userMsg = await ctx.telegram.sendMessage(
        targetId,
        `🏅 <b>Новый титул!</b>\n\n` +
        `Администратор выдал тебе титул: <b>${title.name}</b> (${title.description})`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      );
      utils.deleteNotification(ctx, userMsg.message_id);
      const msg = await ctx.reply(
        `✅ Пользователю ${targetId} выдан титул <b>${title.name}</b>!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
    } else {
      db.run('UPDATE users SET title_id = NULL WHERE id = ?', [targetId]);
      const userMsg = await ctx.telegram.sendMessage(
        targetId,
        `🏅 <b>Титул снят!</b>\n\n` +
        `Администратор убрал твой титул. Продолжай зарабатывать звёзды! 🌟`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
      );
      utils.deleteNotification(ctx, userMsg.message_id);
      const msg = await ctx.reply(
        `✅ У пользователя ${targetId} снят титул!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
    }
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `⚙️ <b>Админ-панель ${BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
        [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
        [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
        [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
        [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
        [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
        [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
        [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
        [Markup.button.callback('🔙 Назад', 'back_to_main'), Markup.button.callback('🏠 В главное меню', 'back')]
      ]),
      id
    );
    return;
  }

  if (waitingFor.type === 'reply_ticket' && text && ADMIN_IDS.includes(id)) {
    const ticketId = waitingFor.ticketId;
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) {
      const msg = await ctx.reply(
        `❌ Тикет #${ticketId} не найден!`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]
          ])
        }
      );
      utils.deleteNotification(ctx, msg.message_id);
      ctx.session.waitingFor = {};
      await utils.sendOrEditMessage(
        ctx,
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]]),
        id
      );
      return;
    }
    const userMsg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 <b>Ответ на тикет #${ticketId}</b>\n\n` +
      `${text}\n\n` +
      `Если есть ещё вопросы, создай новый тикет через профиль! 🚀`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]]) }
    );
    utils.deleteNotification(ctx, userMsg.message_id);
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['in_progress', ticketId]);
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 <b>Тикет #${ticket.ticket_id}</b>\n\n` +
          `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
          `📎 <b>Файлы:</b> ${ticket.file_id ? `${JSON.parse(ticket.file_id).length} шт.` : 'Нет'}\n` +
          `📅 <b>Создан:</b> ${ticket.created_at}\n` +
          `📌 <b>Статус:</b> В работе\n` +
          `✍️ <b>Ответ админа:</b> ${text}`;
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
    const msg = await ctx.reply(
      `✅ Ответ на тикет #${ticketId} отправлен!`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад', 'admin_tickets'), Markup.button.callback('🏠 В главное меню', 'back')]
        ])
      }
    );
    utils.deleteNotification(ctx, msg.message_id);
    ctx.session.waitingFor = {};
    await utils.sendOrEditMessage(
      ctx,
      `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'admin'), Markup.button.callback('🏠 В главное меню', 'back')]]),
      id
    );
    return;
  }

  const msg = await ctx.reply(
    `❓ Не понял, что ты хочешь. Используй главное меню или напиши /help для справки!`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🏠 В главное меню', 'back')]])
    }
  );
  utils.deleteNotification(ctx, msg.message_id);
});

// Запуск бота
bot.launch().then(() => {
  console.log(`${BOT_NAME} запущен! 🚀`);
}).catch(err => {
  console.error('Ошибка запуска бота:', err);
});

// Обработка остановки
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));