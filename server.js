require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const cors = require('cors');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Команда /start
bot.start((ctx) => {
  ctx.reply('🍔 Добро пожаловать в FoodHub!\nНажмите кнопку ниже:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// Обработка заказа
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    
    let msg = `🆕 Новый заказ!\n`;
    msg += `📦 ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n`;
    msg += `💰 ${data.total}₽\n`;
    msg += `📍 ${data.address}`;

    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят!');
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка.');
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

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: ${PORT}`);
});
