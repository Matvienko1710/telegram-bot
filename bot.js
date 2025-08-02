const { Telegraf, Markup, session } = require('telegraf');
const dayjs = require('dayjs');
require('dotenv').config();

const db = require('./db');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const REQUIRED_CHANNEL = '@magnumtap';
const ADMIN_ID = 6587897295; // 🔁 Замени на свой Telegram ID
const SUPPORT_USERNAME = '@magnumsupports'; // <-- сюда ник поддержки
const BOT_LINK = 'https://t.me/firestars_rbot?start=6587897295'; // <-- сюда вставь ссылку на бота, который нужно запускать

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
    // Добавил кнопку Биржа
    [Markup.button.callback('📈 Биржа', 'exchange')],
    [Markup.button.callback('📩 Пригласить друзей', 'ref')],
    [Markup.button.callback('💡 Ввести промокод', 'enter_code')],

    // --- НАЧАЛО ИЗМЕНЕНИЯ: Заменяем кнопку "Задания" ---
    [Markup.button.callback('📋 Задания (подпишись и пришли скрин)', 'daily_tasks')],
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    ctx.from.id === ADMIN_ID ? [Markup.button.callback('⚙️ Админ-панель', 'admin')] : []
  ]));
}

// Функция генерации случайного задания (оставил, но она теперь не используется для daily_tasks)
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
    return ctx.reply(`🔒 Для доступа к функциям бота необходимо подписаться на канал: ${REQUIRED_CHANNEL}`, Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.callback('✅ Я подписался', 'check_sub')]
    ]));
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) {
    db.prepare('INSERT INTO users (id, username, referred_by) VALUES (?, ?, ?)').run(id, username, referral);
    if (referral && referral !== id) {
      db.prepare('UPDATE users SET stars = stars + 10 WHERE id = ?').run(referral);
      ctx.telegram.sendMessage(referral, `🎉 Твой реферал @${username || 'без ника'} зарегистрировался! +10 звёзд`);
    }
  }

  // НЕ выдаём ежедневное задание — теперь задание только "подпишись и пришли скрин"

  await ctx.reply(
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

  await sendMainMenu(ctx);
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
    // Регистрация пользователя (как в оригинале)
    const username = ctx.from.username || '';
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(id, username);
    }
    await sendMainMenu(ctx);
    return ctx.answerCbQuery('✅ Подписка подтверждена');
  }

  if (action === 'farm') {
  const cooldown = 60 * 1000;
  if (now - user.last_farm < cooldown) {
    const seconds = Math.ceil((cooldown - (now - user.last_farm)) / 1000);
    return ctx.answerCbQuery(`⏳ Подождите ${seconds} сек.`, { show_alert: true });
  }

  const reward = 0.1; // 0.1 звезды за фарм
  db.prepare('UPDATE users SET stars = stars + ?, last_farm = ? WHERE id = ?').run(reward, now, id);
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
    return ctx.answerCbQuery('🎉 Вы получили ежедневный бонус: +5 звёзд!', { show_alert: true });
  }

  // --- НАЧАЛО ИЗМЕНЕНИЯ: Новый обработчик "Задания" ---
  if (action === 'daily_tasks') {
  const text =
    `📋 <b>Задание дня</b> 📋\n\n` +
    `🔹 Подпишитесь на канал ${REQUIRED_CHANNEL}\n` +
    `🔹 Запустите бота по кнопке ниже\n` +
    `🔹 Сделайте скриншот подписки\n` +
    `🔹 Пришлите скриншот сюда в чат для проверки администратором\n\n` +
    `После проверки и одобрения вы получите награду — 1.5 ⭐️!`;

  return ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
      [Markup.button.url('🚀 Запустить бота', BOT_LINK)],
      [Markup.button.callback('🔙 Назад', 'back')]
    ])
  });
}
  // --- КОНЕЦ ИЗМЕНЕНИЯ ---

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

    return ctx.reply(`🏆 Топ 10 игроков:\n\n${list}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  if (action === 'stats') {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStars = db.prepare('SELECT SUM(stars) as stars FROM users').get().stars || 0;
    return ctx.reply(`📊 Статистика:
👥 Пользователей: ${total}
⭐ Всего звёзд: ${totalStars}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Назад', 'back')]
    ]));
  }

  // Внутри вашего обработчика, например, для action 'ref':

  if (action === 'ref') {
  const link = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
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
    if (id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Доступ запрещён');
    return ctx.editMessageText(`⚙️ Админ-панель`, Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('🏆 Топ', 'admin_top')],
      [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
      [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
      // --- НАЧАЛО ИЗМЕНЕНИЯ: Добавляем кнопку проверки скриншотов ---
      [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
      // --- КОНЕЦ ИЗМЕНЕНИЯ ---
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

  // --- НАЧАЛО ИЗМЕНЕНИЯ: Обработка кнопки проверки скриншотов ---
  if (action === 'admin_check_screens') {
    // Получаем список непросмотренных скриншотов
    const pending = db.prepare('SELECT * FROM screenshots WHERE approved IS NULL').all();

    if (pending.length === 0) {
      return ctx.answerCbQuery('Нет новых скриншотов для проверки.', { show_alert: true });
    }

    // Показываем первый скриншот из списка с кнопками "Одобрить" и "Отклонить"
    const scr = pending[0];
    const userWhoSent = db.prepare('SELECT username FROM users WHERE id = ?').get(scr.user_id);

    await ctx.editMessageMedia({
      type: 'photo',
      media: scr.file_id,
      caption: `📸 Скриншот от @${userWhoSent?.username || 'пользователь'} (ID: ${scr.user_id})\n\n` +
               `Нажмите кнопку, чтобы одобрить или отклонить.`,
    }, Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Одобрить', `approve_screen_${scr.id}`),
        Markup.button.callback('❌ Отклонить', `reject_screen_${scr.id}`)
      ],
      [Markup.button.callback('🔙 Назад', 'admin')]
    ]));
  }

  if (action.startsWith('approve_screen_') || action.startsWith('reject_screen_')) {
  if (id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Доступ запрещён');

  const screenId = parseInt(action.split('_')[2]);
  if (!screenId) return ctx.answerCbQuery('Ошибка');

  const screen = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(screenId);
  if (!screen || screen.approved !== null) {
    return ctx.answerCbQuery('Скриншот уже обработан');
  }

  if (action.startsWith('approve_screen_')) {
    db.prepare('UPDATE users SET stars = stars + 1.5 WHERE id = ?').run(screen.user_id);
    db.prepare('UPDATE screenshots SET approved = 1 WHERE id = ?').run(screenId);

    // Уведомление пользователю об одобрении
    try {
      await ctx.telegram.sendMessage(screen.user_id, '✅ Ваш скриншот был одобрен! +20 звёзд за выполнение задания 🎉');
    } catch (e) {}

    await ctx.editMessageCaption(`✅ Скриншот одобрен. Награда выдана пользователю.`);
  } else {
    db.prepare('UPDATE screenshots SET approved = 0 WHERE id = ?').run(screenId);

    // Уведомление пользователю об отклонении
    try {
      await ctx.telegram.sendMessage(screen.user_id, '❌ Ваш скриншот был отклонён. Пожалуйста, убедитесь, что вы действительно подписались и отправили корректный скриншот.');
    } catch (e) {}

    await ctx.editMessageCaption(`❌ Скриншот отклонён.`);
  }

  // Возврат в админ-панель
  return ctx.reply('🔙 Возврат в админ-панель', Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('🏆 Топ', 'admin_top')],
    [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
    [Markup.button.callback('➕ Добавить промокод', 'admin_addcode')],
    [Markup.button.callback('✅ Проверка скриншотов', 'admin_check_screens')],
    [Markup.button.callback('🔙 Назад', 'back')]
  ]));
}
  // --- КОНЕЦ ИЗМЕНЕНИЯ ---

  if (action === 'back') {
    await ctx.deleteMessage();
    return sendMainMenu(ctx);
  }
});

// --- НАЧАЛО ИЗМЕНЕНИЯ: Обработка фото от пользователя для проверки скриншотов ---
bot.on('photo', async (ctx) => {
  const id = ctx.from.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return; // если нет в базе - игнорируем

  const photoArray = ctx.message.photo;
  const fileId = photoArray[photoArray.length - 1].file_id;

  db.prepare('INSERT INTO screenshots (user_id, file_id, approved) VALUES (?, ?, NULL)').run(id, fileId);

  await ctx.reply('✅ Скриншот получен и отправлен на проверку администратору. Ждите результат.');

  // Удаляем сообщение пользователя с фото
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Ошибка удаления сообщения с фото:', e.message);
  }
});
// --- КОНЕЦ ИЗМЕНЕНИЯ ---

// Обработка промокодов и рассылки
bot.on('message', async (ctx) => {
  const id = ctx.from.id;

  if (ctx.session?.broadcast && id === ADMIN_ID) {
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, ctx.message.text);
      } catch {}
    }
    ctx.session.broadcast = false;
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

    // Обновляем оставшиеся активации и список использовавших
    usedBy.push(id);
    const newActivationsLeft = promo.activations_left - 1;

    db.prepare('UPDATE promo_codes SET activations_left = ?, used_by = ? WHERE code = ?')
      .run(newActivationsLeft, JSON.stringify(usedBy), code);

    ctx.session.waitingForCode = false;
    return ctx.reply(`✅ Промокод успешно активирован! +${promo.reward} звёзд`);
  }

  if (ctx.session?.waitingForPromo && id === ADMIN_ID) {
    // Ожидаем ввод промокода в формате: CODE123 10 5
    const parts = ctx.message.text.trim().split(' ');
    if (parts.length !== 3) return ctx.reply('❌ Неверный формат. Попробуйте снова.');

    const [code, rewardStr, activationsStr] = parts;
    const reward = parseInt(rewardStr);
    const activations = parseInt(activationsStr);

    if (!code || isNaN(reward) || isNaN(activations)) return ctx.reply('❌ Неверные данные. Попробуйте снова.');

    const exists = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
    if (exists) return ctx.reply('❌ Промокод уже существует.');

    db.prepare('INSERT INTO promo_codes (code, reward, activations_left, used_by) VALUES (?, ?, ?, ?)')
      .run(code, reward, activations, JSON.stringify([]));

    ctx.session.waitingForPromo = false;
    return ctx.reply(`✅ Промокод ${code} добавлен:\nНаграда: ${reward} звёзд\nОсталось активаций: ${activations}`);
  }
});

bot.launch();