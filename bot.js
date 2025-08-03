const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db'); // Подключение обновленного db.js
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const REQUIRED_CHANNEL = '@magnumtap';
const ADMIN_ID = 6587897295; // 🔁 Замени на свой Telegram ID
const SUPPORT_CHANNEL = '@magnumsupported'; // Канал для тикетов
const MESSAGE_TTL = 15_000; // Время жизни уведомлений (15 секунд)

// Функция для удаления уведомлений
async function deleteNotification(ctx, messageId) {
  if (messageId) {
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch((err) => {
        console.error('Ошибка удаления уведомления:', err);
      });
    }, MESSAGE_TTL);
  }
}

// Middleware для проверки регистрации пользователя
bot.use(async (ctx, next) => {
  const id = ctx.from.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!user && ctx.updateType !== 'message' && ctx.message?.text !== '/start') {
    return ctx.reply('❌ Пожалуйста, начните с команды /start.');
  }
  return next();
});

// Проверка подписки на канал
async function isUserSubscribed(ctx) {
  try {
    const status = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(status.status);
  } catch {
    return false;
  }
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
    ctx.from.id === ADMIN_ID ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

// Инициализация начальных заданий
function initTasks() {
  const initialTasks = [
    { type: 'subscribe_channel', description: 'Подпишитесь на канал @magnumtap', goal: 1, reward: 10 },
    { type: 'start_bot', description: 'Запустите бота с помощью /start', goal: 1, reward: 5 },
    { type: 'use_promo', description: 'Активируйте промокод', goal: 1, reward: 15 },
  ];

  initialTasks.forEach(task => {
    const exists = db.get('SELECT * FROM tasks WHERE type = ?', task.type);
    if (!exists) {
      db.run('INSERT INTO tasks (type, description, goal, reward) VALUES (?, ?, ?, ?)',
        task.type, task.description, task.goal, task.reward);
    }
  });
}

initTasks();

bot.start(async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  // Проверка подписки
  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    const msg = await ctx.reply(`🔒 Подпишитесь на канал: ${REQUIRED_CHANNEL}`, Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
    return;
  }

  // Регистрация пользователя
  const existing = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)', id, username, referral);
    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }

    // Прогресс задания "start_bot"
    const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', 'start_bot');
    if (task) {
      db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', id, task.id, 1, 1);
      db.run('UPDATE users SET stars = stars + ? WHERE id = ?', task.reward, id);
      await ctx.reply(`🎉 Задание "Запустите бота" выполнено! +${task.reward} звёзд`);
    }
  }

  await ctx.reply(
    `👋 Привет, <b>${ctx.from.first_name || 'друг'}</b>!\n\n` +
    `Добро пожаловать в <b>MagnumTap</b>!\n\n` +
    `✨ Здесь ты можешь:\n` +
    `• Зарабатывать звёзды (Фарм)\n` +
    `• Получать бонусы\n` +
    `• Приглашать друзей\n` +
    `• Соревноваться в топах\n\n` +
    `🎯 Успехов в фарме! 🚀`,
    { parse_mode: 'HTML' }
  );

  await sendMainMenu(ctx);
});

bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.get('SELECT * FROM users WHERE id = ?', id);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }

    // Прогресс задания "subscribe_channel"
    const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', 'subscribe_channel');
    if (task) {
      const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', id, task.id);
      if (!userTask || !userTask.completed) {
        db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', id, task.id, 1, 1);
        db.run('UPDATE users SET stars = stars + ? WHERE id = ?', task.reward, id);
        await ctx.answerCbQuery(`🎉 Задание "Подпишитесь на канал" выполнено! +${task.reward} звёзд`, { show_alert: true });
      }
    }

    registerUser(ctx);
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'farm') {
    const cooldown = 60 * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }

    db.run('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?', now, id);
    return ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: true });
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус через ${hoursLeft} ч.`, { show_alert: true });
    }

    db.run('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?', nowDay.toISOString(), id);
    return ctx.answerCbQuery('🎉 Бонус: +5 звёзд!', { show_alert: true });
  }

  if (action === 'tasks') {
    const tasks = db.all('SELECT * FROM tasks');
    const userTasks = db.all('SELECT task_id, progress, completed FROM user_tasks WHERE user_id = ?', id);

    let text = `📋 <b>Задания</b> 📋\n\n`;
    tasks.forEach(task => {
      const userTask = userTasks.find(ut => ut.task_id === task.id) || { progress: 0, completed: 0 };
      text += `${task.description}\n`;
      text += `Прогресс: ${userTask.progress} / ${task.goal}\n`;
      text += userTask.completed ? `✅ Выполнено! +${task.reward} звёзд\n\n` : `🚀 Награда: +${task.reward} звёзд\n\n`;
    });

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'back')]])
    });
    return;
  }

  if (['profile', 'leaders', 'stats', 'ref'].includes(action)) {
    await ctx.deleteMessage();
  }

  if (action === 'profile') {
    const invited = db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', id).count;
    const referredByUser = user.referred_by ? db.get('SELECT username FROM users WHERE id = ?', user.referred_by) : null;
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
    ctx.session = ctx.session || {};
    ctx.session.waitingForSupport = true;
    await ctx.reply('📞 Опишите проблему (можно прикрепить фото/документ).', {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback('🚫 Отменить', 'cancel_support')]]
      }
    });
    return;
  }

  if (action === 'cancel_support') {
    ctx.session.waitingForSupport = false;
    await ctx.deleteMessage();
    await sendMainMenu(ctx);
    return;
  }

  if (action === 'withdraw_stars') {
    return ctx.answerCbQuery('⚙️ Функция в разработке.', { show_alert: true });
  }

  if (action === 'leaders') {
    const top = db.all(`
      SELECT 
        u.username, 
        u.stars, 
        (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals 
      FROM users u 
      ORDER BY u.stars DESC 
      LIMIT 10
    `);

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
    ctx.session = ctx.session || {};
    ctx.session.waitingForCode = true;
    const msg = await ctx.reply('💬 Введите промокод:');
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin') {
    if (id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Доступ запрещён');
    await ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('📋 Управление заданиями', 'admin_tasks')],
      [Markup.button.callback('📞 Тикеты', 'admin_tickets')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'admin_stats') {
    const total = db.get('SELECT COUNT(*) as count FROM users').count;
    const totalStars = db.get('SELECT SUM(stars) as stars FROM users').stars || 0;
    const openTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', 'open').count;
    const inProgressTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', 'in_progress').count;
    const closedTickets = db.get('SELECT COUNT(*) as count FROM tickets WHERE status = ?', 'closed').count;
    return ctx.answerCbQuery(
      `👥 Юзеров: ${total}\n⭐ Звёзд: ${totalStars}\n📞 Тикетов: Открыто: ${openTickets}, В работе: ${inProgressTickets}, Закрыто: ${closedTickets}`,
      { show_alert: true }
    );
  }

  if (action === 'admin_top') {
    const top = db.all('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10');
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    await ctx.reply(`🏆 Топ 10:\n\n${list}`);
    return;
  }

  if (action === 'admin_broadcast') {
    ctx.session = ctx.session || {};
    ctx.session.broadcast = true;
    await ctx.reply('✏️ Введите текст рассылки:');
    return;
  }

  if (action === 'admin_addcode') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForPromo = true;
    const msg = await ctx.reply('✏️ Введите промокод, звёзды и активации (пример: `CODE123 10 5`):', { parse_mode: 'Markdown' });
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_tasks') {
    const tasks = db.all('SELECT * FROM tasks');
    if (tasks.length === 0) {
      await ctx.reply('📋 Нет заданий.', Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить задание', 'admin_add_task')],
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
      return;
    }

    const buttons = tasks.map(task => [
      Markup.button.callback(
        `${task.description} (ID: ${task.id}, Награда: ${task.reward})`,
        `admin_view_task_${task.id}`
      )
    ]);
    buttons.push([Markup.button.callback('➕ Добавить задание', 'admin_add_task')]);
    buttons.push([Markup.button.callback('🔙 Назад', 'back')]);

    await ctx.reply('📋 Список заданий:', Markup.inlineKeyboard(buttons));
    return;
  }

  if (action.startsWith('admin_view_task_')) {
    const taskId = parseInt(action.split('_')[3]);
    const task = db.get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!task) return ctx.answerCbQuery('Задание не найдено', { show_alert: true });

    const text = `📋 Задание #${task.id}\n` +
                 `Тип: ${task.type}\n` +
                 `Описание: ${task.description}\n` +
                 `Цель: ${task.goal}\n` +
                 `Награда: ${task.reward} звёзд`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑 Удалить', `admin_delete_task_${task.id}`)],
        [Markup.button.callback('🔙 Назад', 'admin_tasks')]
      ])
    });
    return;
  }

  if (action === 'admin_add_task') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForTask = true;
    const msg = await ctx.reply(
      '✏️ Введите задание (формат: `тип описание цель награда`)\nПример: `join_group Присоединитесь к группе 1 10`',
      { parse_mode: 'Markdown' }
    );
    deleteNotification(ctx, msg.message_id);
    return;
  }

  if (action.startsWith('admin_delete_task_')) {
    const taskId = parseInt(action.split('_')[3]);
    db.run('DELETE FROM tasks WHERE id = ?', taskId);
    db.run('DELETE FROM user_tasks WHERE task_id = ?', taskId);
    await ctx.answerCbQuery('✅ Задание удалено', { show_alert: true });
    await ctx.deleteMessage();
    await ctx.reply('📋 Список заданий:', Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить задание', 'admin_add_task')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    return;
  }

  if (action === 'admin_tickets') {
    const tickets = db.all('SELECT * FROM tickets WHERE status != ? ORDER BY created_at DESC LIMIT 10', 'closed');
    if (tickets.length === 0) {
      await ctx.reply('📞 Нет открытых тикетов.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
      return;
    }

    const buttons = tickets.map(ticket => [
      Markup.button.callback(
        `Тикет #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
        `ticket_${ticket.ticket_id}`
      )
    ]);
    buttons.push([Markup.button.callback('🔙 Назад', 'back')]);

    await ctx.reply('📞 Список тикетов:', Markup.inlineKeyboard(buttons));
    return;
  }

  if (action.startsWith('ticket_')) {
    const ticketId = parseInt(action.split('_')[1]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', ticketId);
    if (!ticket) return ctx.answerCbQuery('Тикет не найден', { show_alert: true });

    const fileIds = ticket.file_id ? JSON.parse(ticket.file_id) : [];
    let fileText = fileIds.length > 0 ? `📎 Файлы: ${fileIds.length} шт.` : '📎 Файлов нет';

    const ticketText =
      `📞 Тикет #${ticket.ticket_id}\n` +
      `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
      `🆔 ID: ${ticket.user_id}\n` +
      `📝 Описание: ${ticket.description}\n` +
      `${fileText}\n` +
      `📅 Создан: ${ticket.created_at}\n` +
      `📌 Статус: ${ticket.status === 'open' ? 'Открыт' : ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}`;

    const buttons = [
      [Markup.button.callback('✍️ Ответить', `reply_ticket_${ticketId}`)],
      [Markup.button.callback('🔄 В работе', `set_ticket_status_${ticketId}_in_progress`)],
      [Markup.button.callback('✅ Закрыть', `set_ticket_status_${ticketId}_closed`)],
    ];
    if (fileIds.length > 0) {
      buttons.unshift([Markup.button.callback('📎 Просмотреть файлы', `view_files_${ticketId}`)]);
    }
    buttons.push([Markup.button.callback('🔙 Назад', 'admin_tickets')]);

    await ctx.editMessageText(ticketText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    return;
  }

  if (action.startsWith('view_files_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', ticketId);
    if (!ticket || !ticket.file_id) return ctx.answerCbQuery('Файлы не найдены', { show_alert: true });

    const fileIds = JSON.parse(ticket.file_id);
    for (const fileId of fileIds) {
      await ctx.telegram.sendDocument(id, fileId, { caption: `Файл из тикета #${ticketId}` });
    }
    return ctx.answerCbQuery('Файлы отправлены', { show_alert: true });
  }

  if (action.startsWith('reply_ticket_')) {
    const ticketId = parseInt(action.split('_')[2]);
    ctx.session = ctx.session || {};
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

    db.run('UPDATE tickets SET status = ? WHERE ticket_id = ?', status, ticketId);
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', ticketId);
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
    await ctx.deleteMessage();
    await sendMainMenu(ctx);
    return;
  }
});

bot.on('message', async (ctx) => {
  const id = ctx.from.id;
  let user = db.get('SELECT * FROM users WHERE id = ?', id);

  if (!user) {
    ctx.session.waitingForCode = false;
    ctx.session.broadcast = false;
    ctx.session.waitingForPromo = false;
    ctx.session.waitingForSupport = false;
    ctx.session.waitingForTask = false;
    const msg = await ctx.reply('❌ Начните с /start.');
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

    const info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, 'Загрузка тикета...');
    db.run(`
      INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify(fileIds), info.message_id);

    const ticketId = db.get('SELECT last_insert_rowid() as id').id;
    const ticketText =
      `📞 Тикет #${ticketId}\n` +
      `👤 Пользователь: @${user.username || 'без ника'}\n` +
      `🆔 ID: ${id}\n` +
      `📝 Описание: ${description}\n` +
      `📎 Файлы: ${fileIds.length > 0 ? fileIds.length + ' шт.' : 'Нет'}\n` +
      `📅 Создан: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      `📌 Статус: Открыт`;

    await ctx.telegram.editMessageText(
      SUPPORT_CHANNEL,
      info.message_id,
      undefined,
      ticketText,
      { parse_mode: 'HTML' }
    );
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        await ctx.telegram.sendDocument(SUPPORT_CHANNEL, fileId, { caption: `Файл из тикета #${ticketId}` });
      }
    }

    await ctx.telegram.sendMessage(ADMIN_ID, `📞 Новый тикет #${ticketId} от @${user.username || 'без ника'}`);
    const msg = await ctx.reply(`✅ Тикет #${ticketId} создан.`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForSupport = false;
    return;
  }

  if (ctx.session?.broadcast && id === ADMIN_ID) {
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
    const promo = db.get('SELECT * FROM promo_codes WHERE code = ?', code);

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

    db.run('UPDATE users SET stars = stars + ? WHERE id = ?', promo.reward, id);
    usedBy.push(id);
    db.run('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?',
      promo.activations_left - 1, JSON.stringify(usedBy), code);

    // Прогресс задания "use_promo"
    const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', 'use_promo');
    if (task) {
      const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', id, task.id);
      if (!userTask || !userTask.completed) {
        db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', id, task.id, 1, 1);
        db.run('UPDATE users SET stars = stars + ? WHERE id = ?', task.reward, id);
        const msg = await ctx.reply(`🎉 Задание "Активируйте промокод" выполнено! +${task.reward} звёзд`);
        deleteNotification(ctx, msg.message_id);
      }
    }

    const msg = await ctx.reply(`✅ Промокод активирован! +${promo.reward} звёзд`);
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForCode = false;
    return;
  }

  if (ctx.session?.waitingForPromo && id === ADMIN_ID) {
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

    db.run('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)',
      code, reward, activations, JSON.stringify([]));

    const msg = await ctx.reply(`✅ Промокод "${code}" на ${reward} звёзд добавлен.`);
    deleteNotification(ctx, msg.message_id);
    ctx.session.waitingForPromo = false;
    return;
  }

  if (ctx.session?.waitingForTask && id === ADMIN_ID) {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 4) {
      const msg = await ctx.reply('⚠️ Формат: `тип описание цель награда`\nПример: `join_group Присоединитесь к группе 1 10`', { parse_mode: 'Markdown' });
      deleteNotification(ctx, msg.message_id);
      return;
    }
    const [type, ...rest] = parts;
    const description = rest.slice(0, -2).join(' ');
    const goal = parseInt(rest[rest.length - 2]);
    const reward = parseInt(rest[rest.length - 1]);

    if (!type || isNaN(goal) || isNaN(reward)) {
      const msg = await ctx.reply('⚠️ Формат: `тип описание цель награда`', { parse_mode: 'Markdown' });
      deleteNotification(ctx, msg.message_id);
      return;
    }

    try {
      db.run('INSERT INTO tasks (type, description, goal, reward) VALUES (?, ?, ?, ?)', type, description, goal, reward);
      const msg = await ctx.reply(`✅ Задание "${description}" добавлено.`);
      deleteNotification(ctx, msg.message_id);
    } catch (error) {
      const msg = await ctx.reply('⚠️ Ошибка: тип задания должен быть уникальным.');
      deleteNotification(ctx, msg.message_id);
    }
    ctx.session.waitingForTask = false;
    return;
  }

  if (ctx.session?.waitingForTicketReply && id === ADMIN_ID) {
    const ticketId = ctx.session.waitingForTicketReply;
    const ticket = db.get('SELECT * FROM tickets WHERE ticket_id = ?', ticketId);
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
            await ctx.telegram.sendDocument(SUPPORT_CHANNEL, fileId, { caption: `Файл к ответу #${ticketId}` });
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
        await ctx.telegram.sendDocument(ticket.user_id, fileId, { caption: `Файл к ответу #${ticketId}` });
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

function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  const existing = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!existing) {
    db.run('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)', id, username, referral);

    if (referral && referral !== id) {
      db.run('UPDATE users SET stars = stars + 10 WHERE id = ?', referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }
}

// Инструкции для добавления новых заданий
/*
 * Как добавить новое задание:
 * 1. Через админ-панель:
 *    - Перейдите в "Управление заданиями" (кнопка "📋 Управление заданиями").
 *    - Нажмите "➕ Добавить задание" и введите: `тип описание цель награда`.
 *    - Пример: `join_group Присоединитесь к группе @example 1 10`.
 * 2. Логика проверки выполнения задания:
 *    - Добавьте обработку в соответствующий обработчик (например, в bot.on('callback_query') или bot.on('message')).
 *    - Пример для нового задания `join_group`:
 *      ```javascript
 *      if (action === 'check_group_sub') {
 *        const groupSubscribed = await ctx.telegram.getChatMember('@example', ctx.from.id);
 *        if (['member', 'creator', 'administrator'].includes(groupSubscribed.status)) {
 *          const task = db.get('SELECT id, reward FROM tasks WHERE type = ?', 'join_group');
 *          if (task) {
 *            const userTask = db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?', id, task.id);
 *            if (!userTask || !userTask.completed) {
 *              db.run('INSERT OR REPLACE INTO user_tasks (user_id, task_id, progress, completed) VALUES (?, ?, ?, ?)', id, task.id, 1, 1);
 *              db.run('UPDATE users SET stars = stars + ? WHERE id = ?', task.reward, id);
 *              await ctx.answerCbQuery(`🎉 Задание "${task.description}" выполнено! +${task.reward} звёзд`, { show_alert: true });
 *            }
 *          }
 *        }
 *      }
 *      ```
 * 3. Обновите отображение заданий:
 *    - Функция `tasks` в обработчике callback_query автоматически отображает все задания из таблицы tasks.
 * 4. Добавьте кнопку для проверки задания:
 *    - В функции `tasks` добавьте кнопку для нового действия, например:
 *      ```javascript
 *      buttons.push([Markup.button.callback('Проверить подписку на группу', 'check_group_sub')]);
 *      ```
 * 5. Тестирование:
 *    - Убедитесь, что тип задания уникален (поле type в таблице tasks).
 * 6. Удаление задания:
 *    - Через админ-панель выберите задание и нажмите "🗑 Удалить".
 */

if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не задан!');
  process.exit(1);
}

bot.launch().then(() => console.log('🤖 Бот запущен!')).catch(err => console.error('Ошибка запуска:', err));