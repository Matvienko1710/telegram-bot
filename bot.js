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
const TASK_CHANNEL_KITTY = process.env.TASK_CHANNEL_KITTY || '@kittyyyyywwr'; // Новый канал
const TASK_BOT_LINK = process.env.TASK_BOT_LINK || 'https://t.me/firestars_rbot?start=6587897295';
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [6587897295];
const SUPPORT_CHANNEL = process.env.SUPPORT_CHANNEL || '@magnumsupported';
const FARM_COOLDOWN_SECONDS = parseInt(process.env.FARM_COOLDOWN_SECONDS) || 60;
const MESSAGE_TTL = 15_000;

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

// Проверка подписки на обязательный канал
async function isUserSubscribed(ctx) {
  try {
    const status = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(status.status);
  } catch (err) {
    console.error('Ошибка проверки подписки:', err);
    return false;
  }
}

// Вспомогательная функция для получения топа пользователей
function getTopUsers(limit = 10) {
  return db.all(`
    SELECT 
      u.username, 
      u.stars, 
      (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals 
    FROM users u 
    ORDER BY u.stars DESC 
    LIMIT ?
  `, [limit]);
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
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    [Markup.button.callback('📋 Задания', 'tasks')],
    ADMIN_IDS.includes(ctx.from.id) ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

// Инициализация заданий
function initTasks() {
  const initialTasks = [
    { type: 'subscribe_channel', description: 'Подписаться на канал', goal: 1, reward: 10 },
    { type: 'start_bot', description: 'Запустить бота', goal: 1, reward: 5 },
    { type: 'subscribe_channel_kittyyyyywwr', description: 'Подписаться на канал', goal: 1, reward: 10 }, // Новое задание
  ];

  initialTasks.forEach(task => {
    const exists = db.get('SELECT * FROM tasks WHERE type = ?', [task.type]);
    if (!exists) {
      db.run('INSERT INTO tasks (type, description, goal, reward) VALUES (?, ?, ?, ?)', [
        task.type,
        task.description,
        task.goal,
        task.reward
      ]);
      console.log(`Задание "${task.type}" создано с описанием "${task.description}"`);
    }
  });
}

initTasks();

// Middleware для проверки регистрации пользователя
bot.use(async (ctx, next) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user && ctx.updateType === 'message' && ctx.message?.text !== '/start') {
    return ctx.reply('❌ Пожалуйста, начните с команды /start.');
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
    const msg = await ctx.reply(`🔒 Подпишитесь на канал: ${REQUIRED_CHANNEL}`, Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
    return;
  }

  // Регистрация пользователя
  const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)', [id, username, referral]);
    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }

  await ctx.reply(
    `👋 Привет, <b>${ctx.from.first_name || 'друг'}</b>!\n\n` +
    `Добро пожаловать в <b>MagnumTap</b>!\n\n` +
    `✨ Здесь ты можешь:\n` +
    `• Зарабатывать звёзды (Фарм)\n` +
    `• Получать бонусы\n` +
    `• Приглашать друзей\n` +
    `• Выполнять задания\n\n` +
    `🎯 Успехов в фарме! 🚀`,
    { parse_mode: 'HTML' }
  );

  await sendMainMenu(ctx);
});

// Обработчик callback-запросов
bot.on('callback_query', async (ctx) => {
  ctx.session = ctx.session || {};
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.get('SELECT * FROM users WHERE id = ?', [id]);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка на канал не найдена!', { show_alert: true });
    }
    registerUser(ctx);
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'farm') {
    const cooldown = FARM_COOLDOWN_SECONDS * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }
    db.run('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?', [now, id]);
    return ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;
    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус через ${hoursLeft} ч.`, { show_alert: true });
    }
    db.run('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?', [nowDay.toISOString(), id]);
    return ctx.answerCbQuery('🎉 Бонус: +5 звёзд!', { show_alert: true });
  }

  if (action === 'tasks' || action === 'next_task') {
    ctx.session.currentTaskIndex = action === 'next_task' ? (ctx.session.currentTaskIndex || 0) + 1 : ctx.session.currentTaskIndex || 0;
    const tasks = db.all('SELECT * FROM tasks');
    if (tasks.length === 0) {
      await ctx.editMessageText('📋 Нет доступных заданий.', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'back')]])
      });
      return;
    }
    const taskIndex = ctx.session.currentTaskIndex % tasks.length;
    const task = tasks[taskIndex];
    const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
    const taskStatus = userTask.completed ? '✅ Завершено' : userTask.progress > 0 ? '⏳ На проверке' : '';
    const buttons = [
      [
        task.type === 'subscribe_channel'
          ? Markup.button.url('Подписаться', `https://t.me/${TASK_CHANNEL.replace('@', '')}`)
          : task.type === 'subscribe_channel_kittyyyyywwr'
          ? Markup.button.url('Подписаться', `https://t.me/${TASK_CHANNEL_KITTY.replace('@', '')}`)
          : Markup.button.url('Запустить бота', TASK_BOT_LINK),
        Markup.button.callback('✅ Проверить', `check_task_${task.id}`)
      ],
      [Markup.button.callback('➡️ Следующее задание', 'next_task')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ];
    const messageText = `📋 <b>Задание</b>\n\n${task.description} ${taskStatus}\nНаграда: ${task.reward} звёзд`;
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
      return ctx.answerCbQuery('❌ Задание не найдено', { show_alert: true });
    }
    const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', [id, task.id]) || { progress: 0, completed: 0 };
    if (userTask.completed) {
      return ctx.answerCbQuery('✅ Задание уже выполнено!', { show_alert: true });
    }
    if (userTask.progress > 0) {
      return ctx.answerCbQuery('⏳ Ваша заявка на это задание уже на проверке.', { show_alert: true });
    }
    ctx.session.waitingForTaskScreenshot = taskId;
    const msg = await ctx.reply('📸 Отправьте скриншот, подтверждающий выполнение задания.');
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
    const displayName = ctx.from.first_name || '—';
    const profileText =
      `🌟 Ваш профиль 🌟\n\n` +
      `👤 Имя: ${displayName}\n` +
      `🆔 ID: ${user.id}\n\n` +
      `💫 Звёзды: ${user.stars}\n` +
      `👥 Приглашено: ${invited}\n` +
      `📣 Пригласил: ${referrerName}\n\n` +
      `🔥 Используйте звёзды с умом!`;
    await ctx.reply(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('Вывести звёзды', 'withdraw_stars')],
      [Markup.button.callback('📞 Поддержка', 'support')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'support') {
    ctx.session.waitingForSupport = true;
    await ctx.reply('📞 Опишите проблему (можно прикрепить фото/документ).', {
      reply_markup: { inline_keyboard: [[Markup.button.callback('🚫 Отменить', 'cancel_support')]] }
    });
    return;
  }

  if (action === 'cancel_support') {
    ctx.session.waitingForSupport = false;
    await ctx.deleteMessage().catch(() => {});
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'withdraw_stars') {
    return ctx.answerCbQuery('⚙️ Функция в разработке.', { show_alert: true });
  }

  if (action === 'leaders') {
    const top = getTopUsers();
    const list = top.map((u, i) => 
      `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐ — приглашено: ${u.referrals}`
    ).join('\n');
    await ctx.reply(`🏆 Топ 10:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'stats') {
    const total = db.get('SELECT COUNT(*) as count FROM users').count;
    const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
    await ctx.reply(`📊 Статистика:\n👥 Пользователей: ${total}\n⭐ Звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    await ctx.reply(`📩 Реферальная ссылка:\n\n${link}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'enter_code') {
    ctx.session.waitingForCode = true;
    const msg = await ctx.reply('💬 Введите промокод:');
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin') {
    if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery('⛔ Доступ запрещён');
    await ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('📞 Тикеты и заявки', 'admin_tickets')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
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
      `👥 Юзеров: ${total}\n⭐ Звёзд: ${totalStars}\n📞 Тикетов: Открыто: ${openTickets}, В работе: ${inProgressTickets}, Закрыто: ${closedTickets}\n📋 Заявок на задания: Одобрено: ${approvedTasks}, Отклонено: ${rejectedTasks}`,
      { show_alert: true }
    );
  }

  if (action === 'admin_top') {
    const top = getTopUsers();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    await ctx.reply(`🏆 Топ 10:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'admin_broadcast') {
    ctx.session.broadcast = true;
    await ctx.reply('✏️ Введите текст рассылки:');
    return;
  }

  if (action === 'admin_addcode') {
    ctx.session.waitingForPromo = true;
    const msg = await ctx.reply('✏️ Введите промокод, звёзды и активации (пример: `CODE123 10 5`):', { parse_mode: 'Markdown' });
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_tickets') {
    const tickets = db.all('SELECT * FROM tickets WHERE status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 10', ['closed', 'rejected']);
    if (tickets.length === 0) {
      await ctx.reply('📞 Нет открытых тикетов или заявок.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
      return;
    }
    const buttons = tickets.map(ticket => {
      const type = ticket.task_type ? `Заявка (${ticket.task_type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота'})` : 'Тикет';
      return [
        Markup.button.callback(
          `${type} #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
          `ticket_${ticket.ticket_id}`
        )
      ];
    });
    buttons.push([Markup.button.callback('🔙 Назад', 'back')]);
    await ctx.reply('📞 Список тикетов и заявок:', Markup.inlineKeyboard(buttons));
    return;
  }

  if (action.startsWith('ticket_')) {
    const ticketId = parseInt(action.split('_')[1]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('Тикет или заявка не найдены', { show_alert: true });
    const fileIds = ticket.file_id ? JSON.parse(ticket.file_id) : [];
    let fileText = fileIds.length > 0 ? `📎 Файлы: ${fileIds.length} шт.` : '📎 Файлов нет';
    const type = ticket.task_type ? `Заявка на задание (${ticket.task_type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота'})` : 'Тикет поддержки';
    const ticketText =
      `${type} #${ticket.ticket_id}\n` +
      `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
      `🆔 ID: ${ticket.user_id}\n` +
      `📝 Описание: ${ticket.description || 'Без описания'}\n` +
      `${fileText}\n` +
      `📅 Создан: ${ticket.created_at}\n` +
      `📌 Статус: ${ticket.status === 'open' ? 'Открыт' : ticket.status === 'in_progress' ? 'В работе' : ticket.status === 'approved' ? 'Одобрено' : 'Отклонено'}`;
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
    buttons.push([Markup.button.callback('🔙 Назад', 'admin_tickets')]);
    await ctx.editMessageText(ticketText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    return;
  }

  if (action.startsWith('view_files_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket || !ticket.file_id) return ctx.answerCbQuery('Файлы не найдены', { show_alert: true });
    const fileIds = JSON.parse(ticket.file_id);
    for (const fileId of fileIds) {
      await ctx.telegram.sendPhoto(id, fileId, { caption: `Скриншот из ${ticket.task_type ? 'заявки' : 'тикета'} #${ticketId}` });
    }
    return ctx.answerCbQuery('Файлы отправлены', { show_alert: true });
  }

  if (action.startsWith('approve_task_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
    console.log(`Попытка одобрения заявки #${ticketId}, task_type: ${ticket.task_type}`);
    const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', [ticket.task_type]);
    if (!task) {
      console.log(`Задание с type "${ticket.task_type}" не найдено в таблице tasks`);
      return ctx.answerCbQuery('❌ Задание не найдено', { show_alert: true });
    }
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['approved', ticketId]);
    db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', [ticket.user_id, task.id, 1, 1]);
    db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [task.reward, ticket.user_id]);
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📋 Заявка #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 Описание: ${ticket.description || 'Без описания'}\n` +
          `📅 Создан: ${ticket.created_at}\n` +
          `📌 Статус: Одобрено\n` +
          `🎉 Награда: ${task.reward} звёзд`;
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
    const taskName = ticket.task_type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота';
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `📋 Заявка #${ticketId} на задание "${taskName}" одобрена! Вы получили ${task.reward} звёзд.`
    );
    await ctx.answerCbQuery(`✅ Заявка #${ticketId} одобрена`, { show_alert: true });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('📞 Список тикетов и заявок:', Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'admin_tickets')]
    ]));
    return;
  }

  if (action.startsWith('reject_task_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', ['rejected', ticketId]);
    const task = db.get('SELECT id FROM tasks WHERE type = ?', [ticket.task_type]);
    if (task) {
      db.run('DELETE FROM user_tasks WHERE user_id = ? AND task_id = ?', [ticket.user_id, task.id]);
    }
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📋 Заявка #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 Описание: ${ticket.description || 'Без описания'}\n` +
          `📅 Создан: ${ticket.created_at}\n` +
          `📌 Статус: Отклонено`;
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
    const taskName = ticket.task_type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : ticket.task_type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота';
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `📋 Заявка #${ticketId} на задание "${taskName}" отклонена. Попробуйте снова.`
    );
    await ctx.answerCbQuery(`❌ Заявка #${ticketId} отклонена`, { show_alert: true });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('📞 Список тикетов и заявок:', Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'admin_tickets')]
    ]));
    return;
  }

  if (action.startsWith('reply_ticket_')) {
    const ticketId = parseInt(action.split('_')[2]);
    ctx.session.waitingForTicketReply = ticketId;
    await ctx.reply(`✍️ Введите ответ для тикета #${ticketId}:`);
    return;
  }

  if (action.startsWith('set_ticket_status_')) {
    const parts = action.split('_');
    if (parts.length < 4) {
      return ctx.answerCbQuery('Ошибка: неверный формат действия', { show_alert: true });
    }
    const ticketId = parseInt(parts[3], 10);
    const status = parts.slice(4).join('_');
    if (isNaN(ticketId) || !['in_progress', 'closed'].includes(status)) {
      return ctx.answerCbQuery('Ошибка: неверный ID или статус', { show_alert: true });
    }
    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', [status, ticketId]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) return ctx.answerCbQuery('Тикет не найден', { show_alert: true });
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 Тикет #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 Описание: ${ticket.description}\n` +
          `📅 Создан: ${ticket.created_at}\n` +
          `📌 Статус: ${ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}`;
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
      `📞 Тикет #${ticketId} обновлён. Статус: ${status === 'in_progress' ? 'В работе' : 'Закрыт'}`
    );
    deleteNotification(ctx, userMsg.message_id);
    await ctx.answerCbQuery(`Статус тикета #${ticketId} изменён на "${status === 'in_progress' ? 'В работе' : 'Закрыт'}"`, { show_alert: true });
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
    const msg = await ctx.reply('❌ Начните с /start.');
    return;
  }

  if (ctx.session?.waitingForTaskScreenshot) {
    const taskId = ctx.session.waitingForTaskScreenshot;
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      ctx.session.waitingForTaskScreenshot = null;
      const msg = await ctx.reply('❌ Задание не найдено.');
      deleteNotification(ctx, msg.message_id);
      return;
    }
    if (!ctx.message.photo) {
      const msg = await ctx.reply('❌ Отправьте фото (скриншот) для подтверждения задания.');
      deleteNotification(ctx, msg.message_id);
      return;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const description = `Заявка на задание: ${task.type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : task.type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота'}`;
    let info;
    try {
      info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, 'Загрузка заявки...');
    } catch (error) {
      console.error('Ошибка отправки сообщения в SUPPORT_CHANNEL:', error);
      const msg = await ctx.reply('❌ Ошибка при создании заявки. Попробуйте позже.');
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
      `📋 Заявка #${ticketId}\n` +
      `👤 Пользователь: @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 Задание: ${description}\n` +
      `📎 Файл: 1 шт.\n` +
      `📅 Создан: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      `📌 Статус: Открыт`;
    try {
      await ctx.telegram.editMessageText(
        SUPPORT_CHANNEL,
        info.message_id,
        undefined,
        ticketText,
        { parse_mode: 'HTML' }
      );
      await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `Скриншот для заявки #${ticketId}` });
    } catch (error) {
      console.error('Ошибка отправки фото в SUPPORT_CHANNEL:', error);
      db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]); // Откат заявки
      const msg = await ctx.reply('❌ Ошибка при создании заявки. Попробуйте позже.');
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForTaskScreenshot = null;
      return;
    }
    await ctx.telegram.sendMessage(ADMIN_IDS[0], `📋 Новая заявка #${ticketId} на задание "${task.type === 'subscribe_channel' ? `Подписка на канал (${TASK_CHANNEL})` : task.type === 'subscribe_channel_kittyyyyywwr' ? `Подписка на канал (${TASK_CHANNEL_KITTY})` : 'Запуск бота'}" от @${user.username || 'без ника'}`);
    db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', [id, task.id, 1, 0]);
    const msg = await ctx.reply(`✅ Заявка #${ticketId} на задание отправлена на проверку. Ожидайте ответа администрации.`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
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
      info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, 'Загрузка тикета...');
    } catch (error) {
      console.error('Ошибка отправки сообщения в SUPPORT_CHANNEL:', error);
      const msg = await ctx.reply('❌ Ошибка при создании тикета. Попробуйте позже.');
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
      `📞 Тикет #${ticketId}\n` +
      `👤 Пользователь: @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 Описание: ${description}\n` +
      `📎 Файлы: ${fileIds.length > 0 ? fileIds.length + ' шт.' : 'Нет'}\n` +
      `📅 Создан: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      `📌 Статус: Открыт`;
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
          await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `Скриншот из тикета #${ticketId}` });
        }
      }
    } catch (error) {
      console.error('Ошибка отправки в SUPPORT_CHANNEL:', error);
      db.run('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]); // Откат тикета
      const msg = await ctx.reply('❌ Ошибка при создании тикета. Попробуйте позже.');
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForSupport = false;
      return;
    }
    await ctx.telegram.sendMessage(ADMIN_IDS[0], `📞 Новый тикет #${ticketId} от @${user.username || 'без ника'}`);
    const msg = await ctx.reply(`✅ Тикет #${ticketId} создан.`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForSupport = false;
    return;
  }

  if (ctx.session?.broadcast && ADMIN_IDS.includes(id)) {
    const users = db.all('SELECT id FROM users');
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch {}
    }
    const msg = await ctx.reply('✅ Рассылка завершена.');
    deleteNotification(ctx, msg.message_id);
    ctx.session.broadcast = false;
    return;
  }

  if (ctx.session?.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.get('SELECT * FROM promo_codes WHERE code = ?', [code]);
    if (!promo) {
      const msg = await ctx.reply('❌ Неверный промокод!');
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }
    if (promo.activations_left === 0) {
      const msg = await ctx.reply('⚠️ Промокод исчерпан.');
      deleteNotification(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }
    let usedBy = promo.used_by ? JSON.parse(promo.used_by) : [];
    if (usedBy.includes(id)) {
      const msg = await ctx.reply('⚠️ Вы уже использовали этот промокод.');
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
    const msg = await ctx.reply(`✅ Промокод активирован! +${promo.reward} звёзд`);
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForCode = false;
    return;
  }

  if (ctx.session?.waitingForPromo && ADMIN_IDS.includes(id)) {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 3) {
      const msg = await ctx.reply('⚠️ Формат: `КОД 10 5`', { parse_mode: 'Markdown' });
      deleteNotification(ctx, msg.message_id);
      return;
    }
    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);
    if (!code || isNaN(reward) || isNaN(activations)) {
      const msg = await ctx.reply('⚠️ Формат: `КОД 10 5`', { parse_mode: 'Markdown' });
      deleteNotification(ctx, msg.message_id);
      return;
    }
    db.run('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)', [
      code,
      reward,
      activations,
      JSON.stringify([])
    ]);
    const msg = await ctx.reply(`✅ Промокод "${code}" на ${reward} звёзд добавлен.`);
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForPromo = false;
    return;
  }

  if (ctx.session?.waitingForTicketReply && ADMIN_IDS.includes(id)) {
    const ticketId = ctx.session.waitingForTicketReply;
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    if (!ticket) {
      const msg = await ctx.reply('❌ Тикет не найден.');
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
          `📞 Тикет #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 ID: ${ticket.user_id}\n` +
          `📝 Описание: ${ticket.description}\n` +
          `📅 Создан: ${ticket.created_at}\n` +
          `📌 Статус: ${ticket.status}\n` +
          `\n✍️ Ответ: ${replyText}`;
        await ctx.telegram.editMessageText(
          SUPPORT_CHANNEL,
          ticket.channel_message_id,
          undefined,
          updatedText,
          { parse_mode: 'HTML' }
        );
        if (fileIds.length > 0) {
          for (const fileId of fileIds) {
            await ctx.telegram.sendPhoto(SUPPORT_CHANNEL, fileId, { caption: `Скриншот к ответу #${ticketId}` });
          }
        }
      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    }
    const userMsg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 Ответ на тикет #${ticketId}:\n${replyText}`
    );
    deleteNotification(ctx, userMsg.message_id);
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        await ctx.telegram.sendPhoto(ticket.user_id, fileId, { caption: `Скриншот к ответу #${ticketId}` });
      }
    }
    const replyMsg = await ctx.reply(`✅ Ответ на тикет #${ticketId} отправлен.`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 К тикетам', 'admin_tickets')]
    ]));
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
    db.run('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)', [id, username, referral]);
    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', [referral]);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }
}

// Запуск бота
bot.launch().then(() => console.log('🤖 Бот запущен!')).catch(err => console.error('Ошибка запуска:', err));