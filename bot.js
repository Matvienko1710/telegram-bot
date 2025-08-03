const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const REQUIRED_CHANNEL = '@magnumtap';
const ADMIN_ID = 6587897295; // 🔁 Замени на свой Telegram ID
const SUPPORT_CHANNEL = '@MagnumSupportTickets'; // Канал для тикетов
const MESSAGE_TTL = 30_000; // Время жизни сообщения в миллисекундах (30 секунд)

async function deleteMessage(ctx, messageId) {
  if (messageId) {
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch((err) => {
        console.error('Ошибка удаления сообщения:', err);
      });
    }, MESSAGE_TTL);
  }
}

// Middleware для проверки регистрации пользователя
bot.use(async (ctx, next) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user && ctx.updateType !== 'message' && ctx.message?.text !== '/start') {
    return ctx.reply('❌ Пожалуйста, начните с команды /start.');
  }
  return next();
});

async function isUserSubscribed(ctx) {
  try {
    const status = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'creator', 'administrator'].includes(status.status);
  } catch {
    return false;
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
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],
    [Markup.button.callback('📋 Задания', 'daily_tasks')],
    ctx.from.id === ADMIN_ID ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

// Функция генерации случайного задания
function getRandomDailyTask() {
  const tasks = [
    { type: 'farm_10', description: 'Соберите 10 звёзд фармом', goal: 10, reward: 10 },
    { type: 'invite_1', description: 'Пригласите 1 друга', goal: 1, reward: 15 },
    { type: 'promo_use', description: 'Активируйте промокод', goal: 1, reward: 20 },
  ];
  return tasks[Math.floor(Math.random() * tasks.length)];
}

bot.start(async (ctx) => {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  const subscribed = await isUserSubscribed(ctx);
  if (!subscribed) {
    const msg = await ctx.reply(`🔒 Для доступа к функциям бота необходимо подписаться на канал: ${REQUIRED_CHANNEL}`, Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);
    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }

  const day = dayjs().format('YYYY-MM-DD');
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (user.daily_task_date !== day) {
    const task = getRandomDailyTask();
    db.prepare(`
      UPDATE users SET daily_task_date = ?, daily_task_type = ?, daily_task_progress = 0, daily_task_completed = 0 WHERE id = ?
    `).run(day, task.type, id);
    user.daily_task_date = day;
    user.daily_task_type = task.type;
    user.daily_task_progress = 0;
    user.daily_task_completed = 0;
  }

  const welcomeMsg = await ctx.reply(
    `👋 Привет, <b>${ctx.from.first_name || 'друг'}</b>!\n\n` +
    `Добро пожаловать в <b>MagnumTap</b> — твоё космическое приключение по сбору звёзд и получению бонусов!\n\n` +
    `✨ Здесь ты можешь:\n` +
    `• Зарабатывать звёзды с помощью кнопки «Фарм»\n` +
    `• Получать ежедневные бонусы для ускорения роста\n` +
    `• Следить за своим прогрессом и приглашать друзей\n` +
    `• Соревноваться в топах и участвовать в акциях\n\n` +
    `🎯 Не забывай использовать звёзды с умом и получать максимум выгоды!\n\n` +
    `Желаем успешного фарма и новых рекордов! 🚀`,
    { parse_mode: 'HTML' }
  );
  deleteMessage(ctx, welcomeMsg.message_id);

  const menuMsg = await sendMainMenu(ctx);
  deleteMessage(ctx, menuMsg.message_id);
});

bot.on('callback_query', async (ctx) => {
  const id = ctx.from.id;
  const now = Date.now();
  const action = ctx.callbackQuery.data;
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (!user && action !== 'check_sub') return ctx.answerCbQuery('Пользователь не найден');

  if (action === 'check_sub') {
    const subscribed = await isUserSubscribed(ctx);
    if (!subscribed) {
      return ctx.answerCbQuery('❌ Подписка не найдена!', { show_alert: true });
    }
    registerUser(ctx);
    const msg = await sendMainMenu(ctx);
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'farm') {
    const cooldown = 60 * 1000;
    if (now - user.last_farm < cooldown) {
      const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
      return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 1, last_farm = ? WHERE id = ?').run(now, id);

    if (user.daily_task_type === 'farm_10' && !user.daily_task_completed) {
      let progress = user.daily_task_progress + 1;
      let completed = 0;
      if (progress >= 10) {
        completed = 1;
        db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(id);
        ctx.answerCbQuery('🎉 Задание "Соберите 10 звёзд фармом" выполнено! +10 звёзд', { show_alert: true });
      } else {
        ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: false });
      }
      db.prepare('UPDATE users SET daily_task_progress = ?, daily_task_completed = ? WHERE id = ?').run(progress, completed, id);
    } else {
      return ctx.answerCbQuery('⭐ Вы заработали 1 звезду!', { show_alert: false });
    }
    return;
  }

  if (action === 'bonus') {
    const nowDay = dayjs();
    const last = user.last_bonus ? dayjs(user.last_bonus) : null;

    if (last && nowDay.diff(last, 'hour') < 24) {
      const hoursLeft = 24 - nowDay.diff(last, 'hour');
      return ctx.answerCbQuery(`🎁 Бонус можно получить через ${hoursLeft} ч.`, { show_alert: true });
    }

    db.prepare('UPDATE users SET stars = stars + 5, last_bonus = ? WHERE id = ?').run(nowDay.toISOString(), id);
    const msg = await ctx.answerCbQuery('🎉 Вы получили ежедневный бонус: +5 звёзд!', { show_alert: true });
    deleteMessage(ctx, msg.message_id); // Удаляем только если есть message_id
    return;
  }

  if (action === 'daily_tasks') {
    const tasks = {
      farm_10: { description: 'Соберите 10 звёзд фармом', goal: 10, reward: 10 },
      invite_1: { description: 'Пригласите 1 друга', goal: 1, reward: 15 },
      promo_use: { description: 'Активируйте промокод', goal: 1, reward: 20 },
    };
    const task = tasks[user.daily_task_type];
    if (!task) return ctx.answerCbQuery('Задание не найдено', { show_alert: true });

    const progress = user.daily_task_progress || 0;
    const completed = user.daily_task_completed ? true : false;

    let text = `📋 <b>Ежедневное задание</b> 📋\n\n` +
               `${task.description}\n` +
               `Прогресс: ${progress} / ${task.goal}\n\n`;

    if (completed) {
      text += `✅ Задание выполнено! Вы уже получили награду: +${task.reward} звёзд.`;
    } else {
      text += `🚀 Выполните задание, чтобы получить награду: +${task.reward} звёзд.`;
    }

    const msg = await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]) });
    deleteMessage(ctx, msg.message_id);
    return;
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

    const msg = await ctx.reply(profileText, Markup.inlineKeyboard([
      [Markup.button.callback('Вывести звёзды', 'withdraw_stars')],
      [Markup.button.callback('📞 Связаться с поддержкой', 'support')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'support') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForSupport = true;
    const msg = await ctx.reply('📞 Опишите вашу проблему. Вы можете прикрепить фото или документ для пояснения.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🚫 Отменить', 'cancel_support')]
        ]
      }
    });
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'cancel_support') {
    ctx.session.waitingForSupport = false;
    await ctx.deleteMessage();
    const msg = await sendMainMenu(ctx);
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'withdraw_stars') {
    return ctx.answerCbQuery('⚙️ Функция в разработке. Скоро!', { show_alert: true });
  }

  if (action === 'leaders') {
    const top = db.prepare(`
      SELECT 
        u.username, 
        u.stars, 
        (SELECT COUNT(*) FROM users WHERE referred_by = u.id) AS referrals 
      FROM users u 
      ORDER BY u.stars DESC 
      LIMIT 10
    `).all();

    const list = top.map((u, i) => 
      `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐ — приглашено: ${u.referrals}`
    ).join('\n');

    const msg = await ctx.reply(`🏆 Топ 10 игроков:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    const msg = await ctx.reply(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'ref') {
    const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
    const msg = await ctx.reply(`📩 Ваша реферальная ссылка:\n\n${link}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'enter_code') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForCode = true;
    const msg = await ctx.reply('💬 Введите промокод:');
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'admin') {
    if (id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Доступ запрещён');
    const msg = await ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      [Markup.button.callback('📞 Тикеты поддержки', 'admin_tickets')],
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    const openTickets = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status = ?').get('open').count;
    const inProgressTickets = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status = ?').get('in_progress').count;
    const closedTickets = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status = ?').get('closed').count;
    const msg = await ctx.answerCbQuery(
      `👥 Юзеров: ${total}\n⭐ Звёзд: ${totalStars}\n📞 Тикетов: Открыто: ${openTickets}, В работе: ${inProgressTickets}, Закрыто: ${closedTickets}`,
      { show_alert: true }
    );
    deleteMessage(ctx, msg.message_id); // Удаляем только если есть message_id
    return;
  }

  if (action === 'admin_top') {
    const top = db.prepare('SELECT username, stars FROM users ORDER BY stars DESC LIMIT 10').all();
    const list = top.map((u, i) => `${i + 1}. @${u.username || 'без ника'} — ${u.stars}⭐`).join('\n');
    const msg = await ctx.reply(`🏆 Топ 10:\n\n${list}`);
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_broadcast') {
    ctx.session = ctx.session || {};
    ctx.session.broadcast = true;
    const msg = await ctx.reply('✏️ Введите текст рассылки:');
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_addcode') {
    ctx.session = ctx.session || {};
    ctx.session.waitingForPromo = true;
    const msg = await ctx.reply('✏️ Введите промокод, количество звёзд и количество активаций через пробел:\nНапример: `CODE123 10 5`', { parse_mode: 'Markdown' });
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action === 'admin_tickets') {
    const tickets = db.prepare('SELECT * FROM tickets WHERE status != ? ORDER BY created_at DESC LIMIT 10').all('closed');
    if (tickets.length === 0) {
      const msg = await ctx.reply('📞 Нет открытых или в работе тикетов.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'back')]
      ]));
      deleteMessage(ctx, msg.message_id);
      return;
    }

    const buttons = tickets.map(ticket => [
      Markup.button.callback(
        `Тикет #${ticket.ticket_id} (@${ticket.username || 'без ника'}, ${ticket.status === 'open' ? 'Открыт' : 'В работе'})`,
        `ticket_${ticket.ticket_id}`
      )
    ]);
    buttons.push([Markup.button.callback('🔙 Назад', 'back')]);

    const msg = await ctx.reply('📞 Список тикетов:', Markup.inlineKeyboard(buttons));
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action.startsWith('ticket_')) {
    const ticketId = parseInt(action.split('_')[1]);
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId);
    if (!ticket) return ctx.answerCbQuery('Тикет не найден', { show_alert: true });

    const fileIds = ticket.file_id ? JSON.parse(ticket.file_id) : [];
    let fileText = fileIds.length > 0 ? `📎 Файлы: ${fileIds.length} шт.` : '📎 Файлов нет';

    const ticketText =
      `📞 Тикет #${ticket.ticket_id}\n` +
      `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
      `🆔 User ID: ${ticket.user_id}\n` +
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

    const msg = await ctx.editMessageText(ticketText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action.startsWith('view_files_')) {
    const ticketId = parseInt(action.split('_')[2]);
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId);
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
    const msg = await ctx.reply(`✍️ Введите ответ для тикета #${ticketId}:`);
    deleteMessage(ctx, msg.message_id);
    return;
  }

  if (action.startsWith('set_ticket_status_')) {
    console.log('Processing set_ticket_status action:', action); // Отладочный лог
    const parts = action.split('_');
    console.log('Split parts:', parts); // Отладочный лог для анализа массива
    if (parts.length < 4) {
      console.error('Invalid action format, too few parts:', parts.length, 'parts:', parts);
      return ctx.answerCbQuery('Ошибка: неверный формат действия', { show_alert: true });
    }
    const ticketIdStr = parts[3]; // ticketId теперь в parts[3], так как первые 3 части — префикс
    const ticketId = parseInt(ticketIdStr, 10); // Явное преобразование
    const statusParts = parts.slice(4); // Собираем status из оставшихся частей
    const status = statusParts.join('_'); // Объединяем с подчёркиваниями
    console.log('Parsed ticketIdStr:', ticketIdStr, 'ticketId:', ticketId, 'statusParts:', statusParts, 'status:', status); // Отладочный лог

    if (isNaN(ticketId) || !['in_progress', 'closed'].includes(status)) {
      console.error('Invalid ticketId or status:', ticketId, status, 'from parts:', parts);
      return ctx.answerCbQuery('Ошибка: неверный ID тикета или статус', { show_alert: true });
    }

    // Выполняем обновление статуса
    const updateStmt = db.prepare('UPDATE tickets SET status = ? WHERE ticket_id = ?');
    const updateResult = updateStmt.run(status, ticketId);
    console.log('Update result:', updateResult); // Отладочный лог

    if (updateResult.changes === 0) {
      console.error('No ticket found for ticketId:', ticketId);
      return ctx.answerCbQuery('Тикет не найден', { show_alert: true });
    }

    // Получаем обновлённый тикет
    const ticketStmt = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?');
    const ticket = ticketStmt.get(ticketId);
    if (!ticket) {
      console.error('Failed to retrieve ticket after update:', ticketId);
      return ctx.answerCbQuery('Ошибка при получении тикета', { show_alert: true });
    }

    // Обновляем сообщение в канале
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 Тикет #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 User ID: ${ticket.user_id}\n` +
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
        console.error('Error editing channel message:', error);
      }
    }

    // Отправляем уведомление пользователю
    const msg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 Ваш тикет #${ticketId} обновлён. Новый статус: ${status === 'in_progress' ? 'В работе' : 'Закрыт'}`
    );
    deleteMessage(ctx, msg.message_id);
    return ctx.answerCbQuery(`Статус тикета #${ticketId} изменён на "${status === 'in_progress' ? 'В работе' : 'Закрыт'}"`, { show_alert: true });
  }

  if (action === 'back') {
    await ctx.deleteMessage();
    const msg = await sendMainMenu(ctx);
    deleteMessage(ctx, msg.message_id);
    return;
  }
});

bot.on('message', async (ctx) => {
  const id = ctx.from.id;
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  if (!user) {
    ctx.session.waitingForCode = false;
    ctx.session.broadcast = false;
    ctx.session.waitingForPromo = false;
    ctx.session.waitingForSupport = false;
    const msg = await ctx.reply('❌ Пользователь не найден. Пожалуйста, начните с команды /start.');
    deleteMessage(ctx, msg.message_id);
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

    const ticketStmt = db.prepare(`
      INSERT INTO tickets (user_id, username, description, created_at, file_id, channel_message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = await ctx.telegram.sendMessage(SUPPORT_CHANNEL, 'Загрузка тикета...'); // Временное сообщение
    const ticketId = ticketStmt.run(id, user.username || 'без ника', description, dayjs().toISOString(), JSON.stringify(fileIds), info.message_id).lastInsertRowid;

    const ticketText =
      `📞 Тикет #${ticketId}\n` +
      `👤 Пользователь: @${user.username || 'без ника'}\n` +
      `🆔 User ID: ${id}\n` +
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
    const msg = await ctx.reply(`✅ Тикет #${ticketId} создан. Мы ответим вам скоро!`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
    deleteMessage(ctx, msg.message_id);
    ctx.session.waitingForSupport = false;
    return;
  }

  if (ctx.session?.broadcast && id === ADMIN_ID) {
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch {}
    }
    const msg = await ctx.reply('✅ Рассылка завершена.');
    deleteMessage(ctx, msg.message_id);
    ctx.session.broadcast = false;
    return;
  }

  if (ctx.session?.waitingForCode) {
    const code = ctx.message.text.trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);

    if (!promo) {
      const msg = await ctx.reply('❌ Неверный промокод!');
      deleteMessage(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }

    if (promo.activations_left === 0) {
      const msg = await ctx.reply('⚠️ Промокод больше не активен (лимит активаций исчерпан).');
      deleteMessage(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }

    let usedBy = promo.used_by ? JSON.parse(promo.used_by) : [];

    if (usedBy.includes(id)) {
      const msg = await ctx.reply('⚠️ Вы уже использовали этот промокод.');
      deleteMessage(ctx, msg.message_id);
      ctx.session.waitingForCode = false;
      return;
    }

    db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?').run(promo.reward, id);

    usedBy.push(id);
    const newActivationsLeft = promo.activations_left - 1;

    db.prepare('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?')
      .run(newActivationsLeft, JSON.stringify(usedBy), code);

    if (user.daily_task_type === 'promo_use' && !user.daily_task_completed) {
      db.prepare('UPDATE users SET daily_task_progress = 1, daily_task_completed = 1, stars = stars + ? WHERE id = ?').run(20, id);
      const msg = await ctx.reply(`🎉 Задание "Активируйте промокод" выполнено! +20 звёзд`);
      deleteMessage(ctx, msg.message_id);
    }

    const msg = await ctx.reply(`✅ Промокод активирован! +${promo.reward} звёзд`);
    deleteMessage(ctx, msg.message_id);
    ctx.session.waitingForCode = false;
    return;
  }

  if (ctx.session?.waitingForPromo && id === ADMIN_ID) {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 3) {
      const msg = await ctx.reply('⚠️ Неверный формат. Используйте: `КОД 10 5` (где 10 — звёзды, 5 — количество активаций)', { parse_mode: 'Markdown' });
      deleteMessage(ctx, msg.message_id);
      return;
    }
    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);

    if (!code || isNaN(reward) || isNaN(activations)) {
      const msg = await ctx.reply('⚠️ Неверный формат. Используйте: `КОД 10 5` (где 10 — звёзды, 5 — количество активаций)', { parse_mode: 'Markdown' });
      deleteMessage(ctx, msg.message_id);
      return;
    }

    db.prepare('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)')
      .run(code, reward, activations, JSON.stringify([]));

    const msg = await ctx.reply(`✅ Промокод "${code}" на ${reward} звёзд с лимитом активаций ${activations} добавлен.`);
    deleteMessage(ctx, msg.message_id);
    ctx.session.waitingForPromo = false;
    return;
  }

  if (ctx.session?.waitingForTicketReply && id === ADMIN_ID) {
    const ticketId = ctx.session.waitingForTicketReply;
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId);
    if (!ticket) {
      const msg = await ctx.reply('❌ Тикет не найден.');
      deleteMessage(ctx, msg.message_id);
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

    // Обновляем сообщение в канале с ответом
    if (ticket.channel_message_id) {
      try {
        const updatedText =
          `📞 Тикет #${ticket.ticket_id}\n` +
          `👤 Пользователь: @${ticket.username || 'без ника'}\n` +
          `🆔 User ID: ${ticket.user_id}\n` +
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
            await ctx.telegram.sendDocument(SUPPORT_CHANNEL, fileId, { caption: `Файл к ответу на тикет #${ticketId}` });
          }
        }
      } catch (error) {
        console.error('Error editing channel message with reply:', error);
      }
    }

    // Отправляем уведомление пользователю
    const userMsg = await ctx.telegram.sendMessage(
      ticket.user_id,
      `📞 Ответ на тикет #${ticketId}:\n${replyText}`
    );
    deleteMessage(ctx, userMsg.message_id);
    if (fileIds.length > 0) {
      for (const fileId of fileIds) {
        await ctx.telegram.sendDocument(ticket.user_id, fileId, { caption: `Файл к ответу на тикет #${ticketId}` });
      }
    }

    const replyMsg = await ctx.reply(`✅ Ответ на тикет #${ticketId} отправлен.`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 К тикетам', 'admin_tickets')]
    ]));
    deleteMessage(ctx, replyMsg.message_id);
    ctx.session.waitingForTicketReply = false;
    return;
  }
});

function registerUser(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username || '';
  const referral = ctx.startPayload ? parseInt(ctx.startPayload) : null;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);

    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }
}

if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не задан в переменных окружения!');
  process.exit(1);
}

bot.launch().then(() => console.log('🤖 Бот запущен!')).catch(err => console.error('Ошибка запуска бота:', err));