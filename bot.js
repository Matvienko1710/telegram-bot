const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не задан!');
  process.exit(1);
}

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Конфигурация
const CONFIG = {
  REQUIRED_CHANNEL: process.env.REQUIRED_CHANNEL || '@magnumtap',
  TASK_CHANNEL: process.env.TASK_CHANNEL || '@musice46',
  TASK_CHANNEL_KITTY: process.env.TASK_CHANNEL_KITTY || '@kittyyyyywwr',
  TASK_BOT_LINK: process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot',
  ADMIN_IDS: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [6587897295],
  SUPPORT_CHANNEL: process.env.SUPPORT_CHANNEL || '@magnumsupported',
  FARM_COOLDOWN_SECONDS: parseInt(process.env.FARM_COOLDOWN_SECONDS) || 60,
  BOT_NAME: process.env.BOT_NAME || 'FireStars'
};

// Утилиты
const utils = {
  async isUserSubscribed(ctx, channel = CONFIG.REQUIRED_CHANNEL) {
    try {
      const status = await ctx.telegram.getChatMember(channel, ctx.from.id);
      return ['member', 'creator', 'administrator'].includes(status.status);
    } catch (err) {
      console.error(`Ошибка проверки подписки на ${channel}:`, err);
      return false;
    }
  },

  getTopUsers(limit = 10) {
    return db.all(`
      SELECT u.username, u.stars, (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals, t.name AS title_name
      FROM users u LEFT JOIN titles t ON u.title_id = t.id
      ORDER BY u.stars DESC LIMIT ?
    `, [limit]);
  },

  async sendMainMenu(ctx, edit = false) {
    const user = db.get('SELECT * FROM users WHERE id = ?', [ctx.from.id]);
    if (!user) {
      return ctx.reply(`❌ Пользователь не найден! Напиши /start, чтобы зарегистрироваться в ${CONFIG.BOT_NAME}.`, { parse_mode: 'HTML' });
    }
    const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [ctx.from.id]).count || 0;
    const messageText =
      `👋 <b>Добро пожаловать в ${CONFIG.BOT_NAME}!</b> 🌟\n\n` +
      `Ты в игре, где можно <i>зарабатывать звёзды</i> ✨, выполняя задания, приглашая друзей и собирая бонусы! 🚀\n\n` +
      `💫 <b>Твой баланс:</b> ${user.stars} звёзд\n` +
      `👥 <b>Приглашено друзей:</b> ${invited}\n\n` +
      `Выбери действие и стань звездой ${CONFIG.BOT_NAME}! 🌟`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⭐ Фарм звёзд', 'farm'), Markup.button.callback('🎁 Ежедневный бонус', 'bonus')],
      [Markup.button.callback('👤 Мой профиль', 'profile'), Markup.button.callback('🏆 Топ игроков', 'leaders')],
      [Markup.button.callback('📊 Статистика', 'stats'), Markup.button.callback('📩 Пригласить друзей', 'ref')],
      [Markup.button.callback('📋 Задания', 'tasks')],
      [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
      CONFIG.ADMIN_IDS.includes(ctx.from.id) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
    ]);
    return edit && ctx.callbackQuery?.message
      ? ctx.editMessageText(messageText, { parse_mode: 'HTML', ...keyboard })
      : ctx.reply(messageText, { parse_mode: 'HTML', ...keyboard });
  },

  updateUserTitle(ctx, userId) {
    const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return;
    const stats = {
      stars: user.stars || 0,
      referrals: db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [userId]).count || 0,
      tasks: db.get('SELECT COUNT(*) as count FROM user_tasks WHERE user_id = ? AND completed = 1', [userId]).count || 0,
      promo_codes: db.get('SELECT COUNT(*) as count FROM promo_codes WHERE used_by LIKE ?', [`%${userId}%`]).count || 0,
      daily_streak: user.daily_streak || 0,
      top_stars: db.all('SELECT id FROM users ORDER BY stars DESC LIMIT 3', []).map(u => u.id).indexOf(userId) + 1
    };

    const titles = db.all('SELECT * FROM titles ORDER BY is_secret ASC, id DESC', []);
    let newTitle = null;
    for (const title of titles) {
      let achieved = false;
      if (title.condition_type === 'combined') {
        const conditions = JSON.parse(title.condition_value);
        if (title.name === 'Легенда Вселенной') {
          achieved = stats.stars >= conditions.stars && stats.referrals >= conditions.referrals;
        } else if (title.name === 'Звёздный Архитектор') {
          achieved = stats.tasks >= conditions.tasks && stats.daily_streak >= conditions.daily_streak;
        } else if (title.name === 'Космический Властелин') {
          achieved = stats.promo_codes >= conditions.promo_codes && stats.top_stars > 0 && stats.top_stars <= conditions.top_stars;
        }
      } else {
        const value = parseInt(title.condition_value);
        achieved = stats[title.condition_type] >= value;
      }
      if (achieved && (!user.title_id || parseInt(db.get('SELECT id FROM titles WHERE id = ?', [user.title_id])?.id || 0) < title.id)) {
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
      ).catch(err => console.error(`Ошибка уведомления о титуле для ${userId}:`, err));
    }
  }
};

// Middleware для проверки регистрации
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  const user = db.get('SELECT * FROM users WHERE id = ?', [ctx.from.id]);
  if (!user && ctx.updateType === 'message' && ctx.message?.text !== '/start') {
    return ctx.reply(`❌ Начни с команды /start, чтобы войти в ${CONFIG.BOT_NAME}! 🚀`, { parse_mode: 'HTML' });
  }
  return next();
});

// Команда /start
bot.start(async (ctx) => {
  ctx.session = { currentTaskIndex: 0, waitingFor: {} };
  const id = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'без ника';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  if (!(await utils.isUserSubscribed(ctx))) {
    return ctx.reply(
      `🔒 <b>Для начала подпишись на наш канал!</b>\n\n` +
      `📢 Это твой первый шаг к звёздам ${CONFIG.BOT_NAME}! Подпишись на ${CONFIG.REQUIRED_CHANNEL} и возвращайся! 🌟`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📢 Подписаться', `https://t.me/${CONFIG.REQUIRED_CHANNEL.replace('@', '')}`)],
          [Markup.button.callback('✅ Я подписался', 'check_sub')]
        ])
      }
    );
  }

  const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, ?, ?)', [id, username, referral, 0, 0]);
    if (referral && referral !== id) {
      const referrer = db.get('SELECT * FROM users WHERE id = ?', [referral]);
      if (referrer) {
        db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
        ctx.telegram.sendMessage(
          referral,
          `🎉 Твой друг @${username} присоединился к ${CONFIG.BOT_NAME}! +10 звёзд! 🌟`,
          { parse_mode: 'HTML' }
        ).catch(err => console.error(`Ошибка уведомления реферера ${referral}:`, err));
        utils.updateUserTitle(ctx, referral);
      }
    }
  }

  await utils.sendMainMenu(ctx);
});

// Обработчик callback-запросов
bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const action = ctx.callbackQuery.data;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user && action !== 'check_sub') {
    return ctx.answerCbQuery(`❌ Пользователь не найден! Напиши /start в ${CONFIG.BOT_NAME}.`, { show_alert: true });
  }

  try {
    if (action === 'check_sub') {
      if (!(await utils.isUserSubscribed(ctx))) {
        return ctx.answerCbQuery(`❌ Подпишись на ${CONFIG.REQUIRED_CHANNEL} для доступа к ${CONFIG.BOT_NAME}!`, { show_alert: true });
      }
      const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
      if (!existing) {
        const username = ctx.from.username || ctx.from.first_name || 'без ника';
        const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;
        db.run('INSERT INTO users (id, username, referred_by, stars, daily_streak) VALUES (?, ?, ?, ?, ?)', [id, username, referral, 0, 0]);
        if (referral && referral !== id) {
          const referrer = db.get('SELECT * FROM users WHERE id = ?', [referral]);
          if (referrer) {
            db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
            ctx.telegram.sendMessage(
              referral,
              `🎉 Твой друг @${username} присоединился к ${CONFIG.BOT_NAME}! +10 звёзд! 🌟`,
              { parse_mode: 'HTML' }
            ).catch(err => console.error(`Ошибка уведомления реферера ${referral}:`, err));
            utils.updateUserTitle(ctx, referral);
          }
        }
      }
      await utils.sendMainMenu(ctx);
      return ctx.answerCbQuery('✅ Подписка подтверждена! Добро пожаловать!', { show_alert: true });
    }

    if (action === 'farm') {
      const now = Date.now();
      if (now - user.last_farm < CONFIG.FARM_COOLDOWN_SECONDS * 1000) {
        const seconds = Math.ceil((CONFIG.FARM_COOLDOWN_SECONDS * 1000 - (now - user.last_farm)) / 1000);
        return ctx.answerCbQuery(`⏳ Подожди ${seconds} сек. для следующего фарма!`, { show_alert: true });
      }
      db.run('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?', [now, id]);
      utils.updateUserTitle(ctx, id);
      await utils.sendMainMenu(ctx, true);
      return ctx.answerCbQuery(`⭐ +1 звезда! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [id]).stars} звёзд.`, { show_alert: true });
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
      utils.updateUserTitle(ctx, id);
      await utils.sendMainMenu(ctx, true);
      return ctx.answerCbQuery(`🎉 +5 звёзд! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [id]).stars} звёзд.`, { show_alert: true });
    }

    if (action === 'tasks' || action === 'next_task') {
      ctx.session.currentTaskIndex = action === 'next_task' ? (ctx.session.currentTaskIndex || 0) + 1 : ctx.session.currentTaskIndex || 0;
      const tasks = db.all('SELECT * FROM tasks', []);
      if (tasks.length === 0) {
        return ctx.editMessageText(
          `📋 <b>Заданий пока нет!</b>\n\n<i>Новые задания скоро появятся, следи за обновлениями в ${CONFIG.BOT_NAME}!</i>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
      const taskIndex = ctx.session.currentTaskIndex % tasks.length;
      const task = tasks[taskIndex];
      const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
      const taskStatus = userTask.completed ? '✅ <i>Выполнено</i>' : userTask.progress > 0 ? '⏳ <i>На проверке</i>' : '🔥 <i>Не начато</i>';
      const buttons = [
        [
          task.type.includes('subscribe_channel')
            ? Markup.button.url('📢 Подписаться', `https://t.me/${(task.type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY).replace('@', '')}`)
            : Markup.button.url('🤖 Запустить бота', CONFIG.TASK_BOT_LINK),
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
      return action === 'next_task'
        ? ctx.editMessageText(messageText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) })
        : ctx.reply(messageText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    if (action.startsWith('check_task_')) {
      const taskId = parseInt(action.split('_')[2]);
      const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (!task) return ctx.answerCbQuery('❌ Задание не найдено!', { show_alert: true });
      const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
      if (userTask.completed) return ctx.answerCbQuery(`✅ Задание уже выполнено! Перейди к следующему в ${CONFIG.BOT_NAME}! 🌟`, { show_alert: true });
      if (userTask.progress > 0) return ctx.answerCbQuery('⏳ Заявка уже на проверке. Ожидай решения админов! 🕒', { show_alert: true });
      ctx.session.waitingFor = { type: 'task_screenshot', taskId };
      return ctx.reply(
        '📸 <b>Отправь скриншот</b>\n\nСделай скриншот, подтверждающий выполнение задания, и отправь его сюда! 📷',
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'profile') {
      const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count || 0;
      const referredByUser = user.referred_by ? db.get('SELECT username FROM users WHERE id = ?', [user.referred_by]) : null;
      const referrerName = referredByUser ? `@${referredByUser.username || 'без ника'}` : '—';
      const title = user.title_id ? db.get('SELECT name, description FROM titles WHERE id = ?', [user.title_id]) : null;
      const titleText = title ? `${title.name} (${title.description})` : 'Нет титула';
      const completedTasks = db.all('SELECT t.description FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? AND ut.completed = 1', [id]);
      const nowDay = dayjs();
      const lastBonus = user.last_bonus ? dayjs(user.last_bonus) : null;
      const bonusStatus = lastBonus && nowDay.diff(lastBonus, 'hour') < 24
        ? `⏳ Доступно через ${24 - nowDay.diff(lastBonus, 'hour')} ч. ${Math.ceil((24 * 60 - nowDay.diff(lastBonus, 'minute')) % 60)} мин.`
        : '✅ Доступно!';
      const profileText =
        `🌟 <b>Твой профиль в ${CONFIG.BOT_NAME}</b> ✨\n\n` +
        `👤 <b>Имя:</b> ${ctx.from.first_name || 'Аноним'}\n` +
        `🏅 <b>Титул:</b> ${titleText}\n` +
        `🆔 <b>ID:</b> ${user.id}\n` +
        `💫 <b>Звёзды:</b> ${user.stars} ✨\n` +
        `👥 <b>Приглашено друзей:</b> ${invited}\n` +
        `📣 <b>Твой реферал:</b> ${referrerName}\n` +
        `🎁 <b>Ежедневный бонус:</b> ${bonusStatus}\n` +
        `📋 <b>Выполненные задания:</b> ${completedTasks.length > 0 ? completedTasks.map(t => t.description).join(', ') : 'Нет'}\n\n` +
        `<i>Зарабатывай больше звёзд и стань легендой ${CONFIG.BOT_NAME}!</i>`;
      return ctx.reply(profileText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Поддержка', 'support'), Markup.button.callback('❓ FAQ', 'faq')],
          [Markup.button.callback('🔙 В меню', 'back')]
        ])
      });
    }

    if (action === 'faq') {
      const faqText =
        `❓ <b>FAQ по ${CONFIG.BOT_NAME}</b> ✨\n\n` +
        `Добро пожаловать в бот, где ты зарабатываешь звёзды ✨ и соревнуешься с друзьями! Вот что ты можешь делать:\n\n` +
        `⭐ <b>Фарм звёзд</b>: Нажимай "Фарм" каждые ${CONFIG.FARM_COOLDOWN_SECONDS} секунд и получай +1 звезду!\n` +
        `🎁 <b>Ежедневный бонус</b>: Раз в 24 часа получай +5 звёзд бесплатно!\n` +
        `📋 <b>Задания</b>: Подписывайся на каналы или запускай ботов, отправляй скриншот и получай до 10 звёзд!\n` +
        `👥 <b>Приглашай друзей</b>: За каждого друга, который присоединится по твоей ссылке, +10 звёзд!\n` +
        `💡 <b>Промокоды</b>: Вводи секретные коды для дополнительных звёзд.\n` +
        `📞 <b>Поддержка</b>: Пиши в поддержку, если что-то неясно, — ответим быстро!\n\n` +
        `🏆 Смотри топ игроков и соревнуйся за первое место!\n` +
        `<i>Подсказка: чаще проверяй задания — новые появляются регулярно!</i>`;
      return ctx.reply(faqText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏅 Титулы', 'titles')],
          [Markup.button.callback('🔙 В профиль', 'profile'), Markup.button.callback('🔙 В меню', 'back')]
        ])
      });
    }

    if (action === 'titles') {
      const titles = db.all('SELECT * FROM titles WHERE is_secret = 0', []);
      const stats = {
        stars: user.stars || 0,
        referrals: db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [id]).count || 0,
        tasks: db.get('SELECT COUNT(*) as count FROM user_tasks WHERE user_id = ? AND completed = 1', [id]).count || 0,
        promo_codes: db.get('SELECT COUNT(*) as count FROM promo_codes WHERE used_by LIKE ?', [`%${id}%`]).count || 0,
        daily_streak: user.daily_streak || 0
      };
      const titleList = titles.map(title => {
        const value = parseInt(title.condition_value);
        const progress = stats[title.condition_type] || 0;
        const progressText = title.condition_type === 'stars' ? `${progress}/${value} звёзд` :
                            title.condition_type === 'referrals' ? `${progress}/${value} друзей` :
                            title.condition_type === 'tasks' ? `${progress}/${value} заданий` :
                            title.condition_type === 'daily_streak' ? `${progress}/${value} дней` :
                            title.condition_type === 'promo_codes' ? `${progress}/${value} промокодов` : '—';
        return `🏅 <b>${title.name}</b>: ${title.description}\n📈 Прогресс: ${progressText}`;
      }).join('\n\n');
      return ctx.reply(
        `🏅 <b>Титулы в ${CONFIG.BOT_NAME}</b> 🌟\n\n` +
        `${titleList || 'Нет доступных титулов.'}\n\n` +
        `<i>Секретные титулы спрятаны, но ты можешь их открыть! 😉</i>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 К FAQ', 'faq'), Markup.button.callback('🔙 В меню', 'back')]
          ])
        }
      );
    }

    if (action === 'support') {
      ctx.session.waitingFor = { type: 'support' };
      return ctx.reply(
        `📞 <b>Связаться с поддержкой ${CONFIG.BOT_NAME}</b>\n\n` +
        `Опиши свою проблему или вопрос, можно прикрепить фото или документ. Мы ответим быстро! 🚀`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Отменить', 'cancel_support')]]) }
      );
    }

    if (action === 'cancel_support') {
      ctx.session.waitingFor = {};
      return utils.sendMainMenu(ctx);
    }

    if (action === 'leaders') {
      const top = utils.getTopUsers();
      const list = top.length > 0
        ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐ — друзей: ${u.referrals}`).join('\n')
        : '😔 Пока нет лидеров. Будь первым! 🚀';
      return ctx.reply(
        `🏆 <b>Топ-10 игроков ${CONFIG.BOT_NAME}</b> 🌟\n\n${list}\n\n<i>Приглашай друзей и выполняй задания, чтобы попасть в топ!</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (action === 'stats') {
      const total = db.get('SELECT COUNT(*) as count FROM users').count || 0;
      const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
      const completedTasks = db.get('SELECT COUNT(*) as count FROM user_tasks WHERE completed = 1').count || 0;
      return ctx.reply(
        `📊 <b>Статистика ${CONFIG.BOT_NAME}</b> ✨\n\n` +
        `👥 <b>Игроков:</b> ${total}\n` +
        `⭐ <b>Всего звёзд:</b> ${totalStars}\n` +
        `📋 <b>Выполнено заданий:</b> ${completedTasks}\n\n` +
        `<i>Присоединяйся к нашей звёздной команде!</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (action === 'ref') {
      const link = `https://t.me/${ctx.me}?start=${id}`;
      return ctx.reply(
        `📩 <b>Приглашай друзей в ${CONFIG.BOT_NAME}!</b> 👥\n\n` +
        `Твоя реферальная ссылка:\n<a href="${link}">${link}</a>\n\n` +
        `За каждого друга, который присоединится по ссылке, ты получишь <b>+10 звёзд</b>! 🌟\n` +
        `<i>Делись ссылкой и становись лидером!</i>`,
        { parse_mode: 'HTML', disable_web_page_preview: true, ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (action === 'enter_code') {
      ctx.session.waitingFor = { type: 'promo_code' };
      return ctx.reply(
        `💡 <b>Введи промокод</b>\n\n` +
        `Отправь секретный код, чтобы получить бонусные звёзды в ${CONFIG.BOT_NAME}! ✨`,
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'admin') {
      if (!CONFIG.ADMIN_IDS.includes(id)) return ctx.answerCbQuery(`⛔ Доступ только для админов ${CONFIG.BOT_NAME}!`, { show_alert: true });
      return ctx.reply(
        `⚙️ <b>Админ-панель ${CONFIG.BOT_NAME}</b> 🔒\n\nУправляй ботом и следи за звёздами! 🌟`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Общая статистика', 'admin_stats')],
            [Markup.button.callback('🏆 Топ игроков', 'admin_top')],
            [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
            [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
            [Markup.button.callback('➕ Добавить задание', 'admin_addtask')],
            [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
            [Markup.button.callback('⭐ Управление звёздами', 'admin_stars')],
            [Markup.button.callback('🏅 Управление титулами', 'admin_titles')],
            [Markup.button.callback('🔙 В меню', 'back')]
          ])
        }
      );
    }

    if (action === 'admin_stats') {
      const stats = {
        total: db.get('SELECT COUNT(*) as count FROM users').count || 0,
        totalStars: db.get('SELECT SUM(stars) as stars FROM users').stars || 0,
        openTickets: db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['open']).count || 0,
        inProgressTickets: db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['in_progress']).count || 0,
        closedTickets: db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['closed']).count || 0,
        approvedTasks: db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['approved']).count || 0,
        rejectedTasks: db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', ['rejected']).count || 0
      };
      return ctx.answerCbQuery(
        `📊 <b>Статистика ${CONFIG.BOT_NAME}</b>\n\n` +
        `👥 Игроков: ${stats.total}\n` +
        `⭐ Всего звёзд: ${stats.totalStars}\n` +
        `📞 Тикеты: Открыто: ${stats.openTickets} | В работе: ${stats.inProgressTickets} | Закрыто: ${stats.closedTickets}\n` +
        `📋 Заявки: Одобрено: ${stats.approvedTasks} | Отклонено: ${stats.rejectedTasks}`,
        { show_alert: true }
      );
    }

    if (action === 'admin_top') {
      const top = utils.getTopUsers();
      const list = top.length > 0
        ? top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} ${u.title_name ? `(${u.title_name})` : ''} — ${u.stars} ⭐`).join('\n')
        : '😔 Пока нет лидеров.';
      return ctx.reply(
        `🏆 <b>Топ-10 игроков ${CONFIG.BOT_NAME}</b> 🌟\n\n${list}\n\n<i>Это лучшие звёздные охотники!</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (action === 'admin_broadcast') {
      ctx.session.waitingFor = { type: 'broadcast' };
      return ctx.reply(
        `📢 <b>Рассылка</b>\n\n` +
        `Введи текст, который получат все пользователи ${CONFIG.BOT_NAME}. Будь осторожен, сообщение уйдёт всем! 🚨`,
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'admin_addcode') {
      ctx.session.waitingFor = { type: 'add_promo' };
      return ctx.reply(
        `➕ <b>Добавить промокод</b>\n\n` +
        `Введи данные в формате: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\n` +
        `Пример: <code>STAR2025 10 5</code>`,
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'admin_addtask') {
      ctx.session.waitingFor = { type: 'add_task' };
      return ctx.reply(
        `➕ <b>Добавить задание</b>\n\n` +
        `Введи данные в формате: <code>ТИП ОПИСАНИЕ ЦЕЛЬ НАГРАДА</code>\n` +
        `Пример: <code>subscribe_channel Подпишись на ${CONFIG.TASK_CHANNEL} 1 5</code>`,
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'admin_stars') {
      ctx.session.waitingFor = { type: 'manage_stars' };
      return ctx.reply(
        `⭐ <b>Управление звёздами</b>\n\n` +
        `Введи данные в формате: <code>ID_ПОЛЬЗОВАТЕЛЯ КОЛИЧЕСТВО</code>\n` +
        `Пример: <code>123456789 50</code> для выдачи или <code>123456789 -50</code> для снятия`,
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'admin_titles') {
      ctx.session.waitingFor = { type: 'manage_titles' };
      const secretTitles = db.all('SELECT id, name FROM titles WHERE is_secret = 1', []);
      const titleList = secretTitles.length > 0
        ? secretTitles.map(t => `${t.id}. ${t.name}`).join('\n')
        : '😔 Нет секретных титулов.';
      return ctx.reply(
        `🏅 <b>Управление титулами</b>\n\n` +
        `Список секретных титулов:\n${titleList}\n\n` +
        `Введи данные в формате: <code>ID_ПОЛЬЗОВАТЕЛЯ ID_ТИТУЛА</code>\n` +
        `Пример: <code>123456789 10</code> или <code>123456789 0</code> для снятия`,
        { parse_mode: 'HTML' }
      );
    }

    if (action.startsWith('ticket_')) {
      const ticketId = parseInt(action.split('_')[1]);
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) return ctx.answerCbQuery('❌ Тикет или заявка не найдены!', { show_alert: true });
      const fileIds = ticket.file_id ? JSON.parse(ticket.file_id) : [];
      const fileText = fileIds.length > 0 ? `📎 <b>Файлы:</b> ${fileIds.length} шт.` : '📎 <b>Файлов нет</b>';
      const type = ticket.task_type
        ? `📋 Заявка на задание (${ticket.task_type.includes('subscribe_channel') ? `Подписка на ${ticket.task_type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
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
        buttons.push(
          [Markup.button.callback('✅ Одобрить', `approve_task_${ticket.ticket_id}`)],
          [Markup.button.callback('❌ Отклонить', `reject_task_${ticket.ticket_id}`)]
        );
      } else {
        buttons.push(
          [Markup.button.callback('✍️ Ответить', `reply_ticket_${ticket.ticket_id}`)],
          [Markup.button.callback('🔄 В работе', `set_ticket_status_${ticket.ticket_id}_in_progress`)],
          [Markup.button.callback('✅ Закрыть', `set_ticket_status_${ticket.ticket_id}_closed`)]
        );
      }
      if (fileIds.length > 0) {
        buttons.unshift([Markup.button.callback('📎 Просмотреть файлы', `view_files_${ticket.ticket_id}`)]);
      }
      buttons.push([Markup.button.callback('🔙 К тикетам', 'admin_tickets')]);
      return ctx.editMessageText(ticketText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
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
      utils.updateUserTitle(ctx, ticket.user_id);
      if (ticket.channel_message_id) {
        try {
          const updatedText =
            `📋 <b>Заявка #${ticket.ticket_id}</b>\n\n` +
            `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
            `�ID: ${ticket.user_id}\n` +
            `📝 <b>Описание:</b> ${ticket.description || 'Без описания'}\n` +
            `📅 <b>Создан:</b> ${ticket.created_at}\n` +
            `📌 <b>Статус:</b> Одобрено ✅\n` +
            `🎉 <b>Награда:</b> ${task.reward} звёзд`;
          await ctx.telegram.editMessageText(CONFIG.SUPPORT_CHANNEL, ticket.channel_message_id, undefined, updatedText, { parse_mode: 'HTML' });
        } catch (err) {
          console.error('Ошибка редактирования сообщения:', err);
        }
      }
      const taskName = ticket.task_type.includes('subscribe_channel')
        ? `Подписка на ${ticket.task_type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}`
        : 'Запуск бота';
      await ctx.telegram.sendMessage(
        ticket.user_id,
        `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>одобрена</b>! 🎉\n\n` +
        `Ты получил <b>${task.reward} звёзд</b>! Твой баланс: ${db.get('SELECT stars FROM users WHERE id = ?', [ticket.user_id]).stars} ⭐`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`Ошибка уведомления пользователя ${ticket.user_id}:`, err));
      await ctx.answerCbQuery(`✅ Заявка #${ticketId} одобрена!`, { show_alert: true });
      return ctx.reply(
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]]) }
      );
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
          await ctx.telegram.editMessageText(CONFIG.SUPPORT_CHANNEL, ticket.channel_message_id, undefined, updatedText, { parse_mode: 'HTML' });
        } catch (err) {
          console.error('Ошибка редактирования сообщения:', err);
        }
      }
      const taskName = ticket.task_type.includes('subscribe_channel')
        ? `Подписка на ${ticket.task_type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}`
        : 'Запуск бота';
      await ctx.telegram.sendMessage(
        ticket.user_id,
        `📋 <b>Заявка #${ticketId}</b> на задание "${taskName}" <b>отклонена</b> ❌\n\n` +
        `Попробуй снова! Сделай скриншот и убедись, что выполнил задание правильно. 🛠`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`Ошибка уведомления пользователя ${ticket.user_id}:`, err));
      await ctx.answerCbQuery(`❌ Заявка #${ticketId} отклонена!`, { show_alert: true });
      return ctx.reply(
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]]) }
      );
    }

    if (action.startsWith('reply_ticket_')) {
      const ticketId = parseInt(action.split('_')[2]);
      ctx.session.waitingFor = { type: 'ticket_reply', ticketId };
      return ctx.reply(`✍️ <b>Ответ на тикет #${ticketId}</b>\n\nВведи текст ответа для пользователя:`, { parse_mode: 'HTML' });
    }

    if (action.startsWith('set_ticket_status_')) {
      const parts = action.split('_');
      const ticketId = parseInt(parts[3]);
      const status = parts.slice(4).join('_');
      if (!['in_progress', 'closed'].includes(status)) return ctx.answerCbQuery('❌ Неверный статус!', { show_alert: true });
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
          await ctx.telegram.editMessageText(CONFIG.SUPPORT_CHANNEL, ticket.channel_message_id, undefined, updatedText, { parse_mode: 'HTML' });
        } catch (err) {
          console.error('Ошибка редактирования сообщения:', err);
        }
      }
      await ctx.telegram.sendMessage(
        ticket.user_id,
        `📞 <b>Тикет #${ticketId}</b>\n\nСтатус обновлён: <b>${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}</b>`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`Ошибка уведомления пользователя ${ticket.user_id}:`, err));
      await ctx.answerCbQuery(`✅ Статус тикета #${ticketId} изменён на "${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}"`, { show_alert: true });
      return ctx.reply(
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для обработки: 🔍`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]]) }
      );
    }

    if (action === 'back') {
      return utils.sendMainMenu(ctx);
    }

    if (action === 'admin_tickets') {
      const tickets = db.all('SELECT * FROM tickets WHERE status IN (?, ?) ORDER BY created_at DESC LIMIT 10', ['open', 'in_progress']);
      if (tickets.length === 0) {
        return ctx.reply(
          `📞 <b>Тикеты и заявки</b>\n\n😔 Нет открытых тикетов или заявок.\n\n<i>Проверь позже.</i>`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
      const buttons = tickets.map(ticket => {
        const type = ticket.task_type
          ? `📋 Заявка (${ticket.task_type.includes('subscribe_channel') ? `Подписка на ${ticket.task_type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}` : 'Запуск бота'})`
          : '📞 Тикет';
        return [Markup.button.callback(`${type} #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`, `ticket_${ticket.ticket_id}`)];
      });
      buttons.push([Markup.button.callback('🔙 К админ-панели', 'admin')]);
      return ctx.reply(
        `📞 <b>Тикеты и заявки</b>\n\nВыбери тикет или заявку для просмотра и обработки: 🔍`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
      );
    }
  } catch (err) {
    console.error('Ошибка в callback_query:', err);
    await ctx.answerCbQuery('❌ Произошла ошибка, попробуй снова!', { show_alert: true });
  } finally {
    if (!['admin', 'admin_stats', 'admin_top', 'admin_broadcast', 'admin_addcode', 'admin_addtask', 'admin_stars', 'admin_titles', 'ticket_', 'view_files_', 'approve_task_', 'reject_task_', 'reply_ticket_', 'set_ticket_status_'].some(prefix => action.startsWith(prefix))) {
      await ctx.answerCbQuery();
    }
  }
});
// Обработчик сообщений
bot.on('message', async (ctx) => {
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    ctx.session.waitingFor = {};
    return ctx.reply(`❌ Начни с команды /start, чтобы войти в ${CONFIG.BOT_NAME}! 🚀`, { parse_mode: 'HTML' });
  }

  try {
    if (ctx.session.waitingFor?.type === 'task_screenshot') {
      const taskId = ctx.session.waitingFor.taskId;
      const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (!task) {
        ctx.session.waitingFor = {};
        return ctx.reply('❌ Задание не найдено!', { parse_mode: 'HTML' });
      }
      if (!ctx.message.photo) {
        return ctx.reply(
          '❌ <b>Отправь фото!</b>\n\nНужен скриншот, подтверждающий выполнение задания. 📷',
          { parse_mode: 'HTML' }
        );
      }
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;
      const description = `Заявка на задание: ${task.type.includes('subscribe_channel') ? `Подписка на ${task.type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}` : 'Запуск бота'}`;
      let info;
      try {
        info = await ctx.telegram.sendMessage(CONFIG.SUPPORT_CHANNEL, '📋 Загрузка заявки...');
      } catch (err) {
        console.error('Ошибка отправки в SUPPORT_CHANNEL:', err);
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Ошибка при создании заявки. Попробуй позже! 🛠`, { parse_mode: 'HTML' });
      }
      db.run(
        `INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id, task_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify([fileId]), info.message_id, task.type]
      );
      const ticketId = db.get('SELECT last_insert_rowid() as id').id;
      const ticketText =
        `📋 <b>Заявка #${ticketId}</b>\n\n` +
        `👤 <b>Пользователь:</b> @${user.username || 'без ника'}\n` +
        `🆔 ID: ${id}\n` +
        `📝 <b>Описание:</b> ${description}\n` +
        `📎 <b>Файл:</b> 1 шт.\n` +
        `📅 <b>Создан:</b> ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
        `📌 <b>Статус:</b> Открыт`;
      try {
        await ctx.telegram.editMessageText(CONFIG.SUPPORT_CHANNEL, info.message_id, undefined, ticketText, { parse_mode: 'HTML' });
        await ctx.telegram.sendPhoto(CONFIG.SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот для заявки #${ticketId}` });
      } catch (err) {
        console.error('Ошибка отправки в SUPPORT_CHANNEL:', err);
        db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]);
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Ошибка при создании заявки. Попробуй позже! 🛠`, { parse_mode: 'HTML' });
      }
      for (const adminId of CONFIG.ADMIN_IDS) {
        await ctx.telegram.sendMessage(
          adminId,
          `📋 <b>Новая заявка #${ticketId}</b>\n\n` +
          `Задание: "${task.type.includes('subscribe_channel') ? `Подписка на ${task.type === 'subscribe_channel' ? CONFIG.TASK_CHANNEL : CONFIG.TASK_CHANNEL_KITTY}` : 'Запуск бота'}"\n` +
          `От: @${user.username || 'без ника'}`,
          { parse_mode: 'HTML' }
        ).catch(err => console.error(`Ошибка уведомления админа ${adminId}:`, err));
      }
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Заявка #${ticketId}</b> отправлена на проверку! ⏳\n\n` +
        `Ожидай ответа админов. Ты можешь проверить статус в разделе "Задания". 📋`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'support') {
      const description = ctx.message.text || 'Без описания';
      const fileIds = [];
      if (ctx.message.photo) fileIds.push(ctx.message.photo[ctx.message.photo.length - 1].file_id);
      if (ctx.message.document) fileIds.push(ctx.message.document.file_id);
      let info;
      try {
        info = await ctx.telegram.sendMessage(CONFIG.SUPPORT_CHANNEL, '📞 Загрузка тикета...');
      } catch (err) {
        console.error('Ошибка отправки в SUPPORT_CHANNEL:', err);
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Ошибка при создании тикета. Попробуй позже! 🛠`, { parse_mode: 'HTML' });
      }
      db.run(
        `INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify(fileIds), info.message_id]
      );
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
        await ctx.telegram.editMessageText(CONFIG.SUPPORT_CHANNEL, info.message_id, undefined, ticketText, { parse_mode: 'HTML' });
        if (fileIds.length > 0) {
          for (const fileId of fileIds) {
            await ctx.telegram.sendPhoto(CONFIG.SUPPORT_CHANNEL, fileId, { caption: `📷 Скриншот из тикета #${ticketId}` });
          }
        }
      } catch (err) {
        console.error('Ошибка отправки в SUPPORT_CHANNEL:', err);
        db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]);
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Ошибка при создании тикета. Попробуй позже! 🛠`, { parse_mode: 'HTML' });
      }
      for (const adminId of CONFIG.ADMIN_IDS) {
        await ctx.telegram.sendMessage(
          adminId,
          `📞 <b>Новый тикет #${ticketId}</b>\n\nОт: @${user.username || 'без ника'}`,
          { parse_mode: 'HTML' }
        ).catch(err => console.error(`Ошибка уведомления админа ${adminId}:`, err));
      }
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Тикет #${ticketId}</b> создан! 🚀\n\n` +
        `Мы ответим тебе в ближайшее время. Спасибо за обращение в ${CONFIG.BOT_NAME}! 😊`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'broadcast' && CONFIG.ADMIN_IDS.includes(id)) {
      const users = db.all('SELECT id FROM users', []);
      let successCount = 0;
      for (const u of users) {
        try {
          await bot.telegram.sendMessage(u.id, ctx.message.text, { parse_mode: 'HTML' });
          successCount++;
        } catch (err) {
          console.error(`Ошибка отправки рассылки пользователю ${u.id}:`, err);
        }
      }
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Рассылка завершена!</b>\n\nОтправлено ${successCount} из ${users.length} пользователям ${CONFIG.BOT_NAME}. 🚀`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'add_promo' && CONFIG.ADMIN_IDS.includes(id)) {
      const [code, reward, activations] = ctx.message.text.trim().split(' ');
      if (!code || isNaN(reward) || isNaN(activations)) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `❌ <b>Неверный формат!</b>\n\nИспользуй: <code>КОД ЗВЁЗДЫ АКТИВАЦИИ</code>\nПример: <code>STAR2025 10 5</code>`,
          { parse_mode: 'HTML' }
        );
      }
      db.run('INSERT OR REPLACE INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)', [code, parseInt(reward), parseInt(activations), JSON.stringify([])]);
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Промокод создан!</b>\n\nКод: ${code}\nНаграда: ${reward} звёзд\nАктиваций: ${activations}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'add_task' && CONFIG.ADMIN_IDS.includes(id)) {
      const [type, ...rest] = ctx.message.text.trim().split(' ');
      const description = rest.slice(0, -2).join(' ');
      const goal = parseInt(rest[rest.length - 2]);
      const reward = parseInt(rest[rest.length - 1]);
      if (!type || !description || isNaN(goal) || isNaN(reward)) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `❌ <b>Неверный формат!</b>\n\nИспользуй: <code>ТИП ОПИСАНИЕ ЦЕЛЬ НАГРАДА</code>\nПример: <code>subscribe_channel Подпишись на ${CONFIG.TASK_CHANNEL} 1 5</code>`,
          { parse_mode: 'HTML' }
        );
      }
      db.run('INSERT OR REPLACE INTO tasks (type, description, goal, reward) VALUES (?, ?, ?, ?)', [type, description, goal, reward]);
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Задание создано!</b>\n\nТип: ${type}\nОписание: ${description}\nЦель: ${goal}\nНаграда: ${reward} звёзд`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'manage_stars' && CONFIG.ADMIN_IDS.includes(id)) {
      const [userId, stars] = ctx.message.text.trim().split(' ').map(s => parseInt(s));
      if (isNaN(userId) || isNaN(stars)) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `❌ <b>Неверный формат!</b>\n\nИспользуй: <code>ID_ПОЛЬЗОВАТЕЛЯ КОЛИЧЕСТВО</code>\nПример: <code>123456789 50</code> или <code>123456789 -50</code>`,
          { parse_mode: 'HTML' }
        );
      }
      const targetUser = db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!targetUser) {
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Пользователь с ID ${userId} не найден!`, { parse_mode: 'HTML' });
      }
      const newStars = Math.max(0, targetUser.stars + stars);
      db.run('UPDATE users SET stars = ? WHERE id = ?', [newStars, userId]);
      utils.updateUserTitle(ctx, userId);
      const actionText = stars >= 0 ? `выдано ${stars} звёзд` : `снято ${Math.abs(stars)} звёзд`;
      await ctx.telegram.sendMessage(
        userId,
        `⭐ <b>Обновление баланса!</b>\n\nАдмин ${actionText}. Твой баланс: ${newStars} звёзд.`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`Ошибка уведомления пользователя ${userId}:`, err));
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Звёзды обновлены!</b>\n\nПользователь: ${userId}\nДействие: ${actionText}\nНовый баланс: ${newStars} звёзд`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
      );
    }

    if (ctx.session.waitingFor?.type === 'manage_titles' && CONFIG.ADMIN_IDS.includes(id)) {
      const [userId, titleId] = ctx.message.text.trim().split(' ').map(s => parseInt(s));
      if (isNaN(userId) || isNaN(titleId)) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `❌ <b>Неверный формат!</b>\n\nИспользуй: <code>ID_ПОЛЬЗОВАТЕЛЯ ID_ТИТУЛА</code>\nПример: <code>123456789 10</code> или <code>123456789 0</code>`,
          { parse_mode: 'HTML' }
        );
      }
      const targetUser = db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!targetUser) {
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Пользователь с ID ${userId} не найден!`, { parse_mode: 'HTML' });
      }
      if (titleId !== 0) {
        const title = db.get('SELECT * FROM titles WHERE id = ? AND is_secret = 1', [titleId]);
        if (!title) {
          ctx.session.waitingFor = {};
          return ctx.reply(`❌ Титул с ID ${titleId} не найден или не является секретным!`, { parse_mode: 'HTML' });
        }
        db.run('UPDATE users SET title_id = ? WHERE id = ?', [titleId, userId]);
        await ctx.telegram.sendMessage(
          userId,
          `🏅 <b>Новый титул!</b>\n\nАдмин присвоил тебе секретный титул: <b>${title.name}</b> (${title.description})`,
          { parse_mode: 'HTML' }
        ).catch(err => console.error(`Ошибка уведомления пользователя ${userId}:`, err));
        ctx.session.waitingFor = {};
        return ctx.reply(
          `✅ <b>Титул присвоен!</b>\n\nПользователь: ${userId}\nТитул: ${title.name}`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      } else {
        db.run('UPDATE users SET title_id = NULL WHERE id = ?', [userId]);
        await ctx.telegram.sendMessage(
          userId,
          `🏅 <b>Титул снят!</b>\n\nАдмин удалил твой титул. Продолжай зарабатывать звёзды! 🌟`,
          { parse_mode: 'HTML' }       
          ).catch(err => console.error(`Ошибка уведомления пользователя ${userId}:`, err));
        ctx.session.waitingFor = {};
        return ctx.reply(
          `✅ <b>Титул снят!</b>\n\nПользователь: ${userId}`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
    }

    if (ctx.session.waitingFor?.type === 'ticket_reply' && CONFIG.ADMIN_IDS.includes(id)) {
      const ticketId = ctx.session.waitingFor.ticketId;
      const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
      if (!ticket) {
        ctx.session.waitingFor = {};
        return ctx.reply(`❌ Тикет #${ticketId} не найден!`, { parse_mode: 'HTML' });
      }
      const replyText = ctx.message.text;
      await ctx.telegram.sendMessage(
        ticket.user_id,
        `📞 <b>Ответ на тикет #${ticketId}</b>\n\n` +
        `${replyText}\n\n` +
        `<i>Если есть вопросы, создай новый тикет через раздел "Поддержка" в ${CONFIG.BOT_NAME}!</i>`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`Ошибка отправки ответа пользователю ${ticket.user_id}:`, err));
      db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['closed', ticketId]);
      if (ticket.channel_message_id) {
        try {
          const updatedText =
            `📞 <b>Тикет #${ticket.ticket_id}</b>\n\n` +
            `👤 <b>Пользователь:</b> @${ticket.username || 'без ника'}\n` +
            `🆔 ID: ${ticket.user_id}\n` +
            `📝 <b>Описание:</b> ${ticket.description}\n` +
            `📎 <b>Файлы:</b> ${ticket.file_id && JSON.parse(ticket.file_id).length > 0 ? JSON.parse(ticket.file_id).length + ' шт.' : 'Нет'}\n` +
            `📅 <b>Создан:</b> ${ticket.created_at}\n` +
            `📌 <b>Статус:</b> Закрыт\n` +
            `✍️ <b>Ответ админа:</b> ${replyText}`;
          await ctx.telegram.editMessageText(
            CONFIG.SUPPORT_CHANNEL,
            ticket.channel_message_id,
            undefined,
            updatedText,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          console.error('Ошибка редактирования сообщения в SUPPORT_CHANNEL:', err);
        }
      }
      ctx.session.waitingFor = {};
      return ctx.reply(
        `✅ <b>Ответ на тикет #${ticketId} отправлен!</b>\n\n` +
        `Тикет закрыт. Пользователь уведомлён.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 К тикетам', 'admin_tickets')]])
        }
      );
    }

    if (ctx.session.waitingFor?.type === 'promo_code') {
      const code = ctx.message.text.trim();
      const promo = db.get('SELECT * FROM promo_codes WHERE code = ?', [code]);
      if (!promo) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `❌ <b>Промокод не найден!</b>\n\nИщи новые коды в наших каналах ${CONFIG.BOT_NAME}! 📢`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
      if (promo.activations_left === 0) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `⚠️ <b>Промокод исчерпан!</b>\n\nИщи новые коды в наших каналах ${CONFIG.BOT_NAME}! 📢`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
      const usedBy = JSON.parse(promo.used_by || '[]');
      if (usedBy.includes(id)) {
        ctx.session.waitingFor = {};
        return ctx.reply(
          `⚠️ <b>Ты уже использовал этот промокод!</b>\n\nПопробуй другой код в ${CONFIG.BOT_NAME}! 💡`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
        );
      }
      usedBy.push(id);
      db.run('UPDATE promo_codes SET activations_left = activations_left - 1, used_by = ? WHERE code = ?', [JSON.stringify(usedBy), code]);
      db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [promo.reward, id]);
      const updatedUser = db.get('SELECT * FROM users WHERE id = ?', [id]);
      utils.updateUserTitle(ctx, id);
      ctx.session.waitingFor = {};
      return ctx.reply(
        `🎉 <b>Промокод активирован!</b>\n\n` +
        `Ты получил <b>${promo.reward} звёзд</b>! Твой баланс: ${updatedUser.stars} ⭐`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
        }
      );
    }

    return ctx.reply(
      `🤔 <b>Не понял команду!</b>\n\n` +
      `Используй главное меню или нажми "FAQ" в профиле для справки по ${CONFIG.BOT_NAME}. 🌟`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]])
      }
    );
  } catch (err) {
    console.error('Ошибка в обработчике сообщений:', err);
    ctx.session.waitingFor = {};
    return ctx.reply(
      `❌ Произошла ошибка! Попробуй снова или напиши в поддержку ${CONFIG.BOT_NAME}. 🛠`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 В меню', 'back')]]) }
    );
  }
});

// Запуск бота
bot.launch().then(() => {
  console.log(`${CONFIG.BOT_NAME} запущен! 🚀`);
}).catch(err => {
  console.error('Ошибка запуска бота:', err);
  process.exit(1);
});

// Обработка graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));