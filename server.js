require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const cors = require('cors');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;

// Защита: если URL нет, сервер не упадёт, а напишет в консоль
if (!WEBAPP_URL || WEBAPP_URL === 'undefined') {
  console.error('⚠️ ОШИБКА: Переменная WEBAPP_URL не задана или пуста!');
  console.error('Укажи её в настройках Bothost → Переменные окружения');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Команда /start (безопасная)
bot.start(async (ctx) => {
  try {
    if (!WEBAPP_URL) {
      return ctx.reply('⚠️ Мини-приложение ещё настраивается. Попробуй через 1 минуту.');
    }
    await ctx.reply('🍔 Добро пожаловать в FoodHub!\nНажмите кнопку ниже:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
  } catch (err) {
    console.error('❌ Ошибка отправки /start:', err.message);
  }
});

// Обработка заказа
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    let msg = `🆕 Новый заказ!\n📦 ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n💰 ${data.total}₽\n📍 ${data.address}`;
    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят!');
  } catch (e) {
    console.error('❌ Ошибка заказа:', e);
    await ctx.reply('❌ Ошибка оформления.');
  }
});

// API меню
app.get('/api/menu', (req, res) => {
  res.json([
    { id: 1, name: 'Чизбургер', price: 350, img: '🍔' },
    { id: 2, name: 'Пицца', price: 600, img: '🍕' },
    { id: 3, name: 'Кола', price: 150, img: '🥤' },
    { id: 4, name: 'Фри', price: 200, img: '🍟' }
  ]);
});

// Запуск с защитой от крашей
bot.catch((err) => console.error('🤖 Telegraf error:', err));
bot.launch();
app.listen(PORT, () => console.log(`🚀 Сервер запущен: ${PORT}`));
