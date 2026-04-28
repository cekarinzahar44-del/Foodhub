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
bot.start(async (ctx) => {
  try {
    if (!WEBAPP_URL) {
      return ctx.reply('⚠️ Приложение настраивается. Попробуйте через минуту.');
    }
    await ctx.reply('🍔 Добро пожаловать в FoodHub!\nНажмите кнопку ниже:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
  } catch (err) {
    console.error('❌ Ошибка /start:', err.message);
  }
});

// Обработка заказа из Mini App
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    let msg = `🆕 Новый заказ!\n`;
    msg += `📦 ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n`;
    msg += `💰 ${data.total} ₽\n`;
    msg += `📍 ${data.address}`;
    if (data.comment) msg += `\n💬 ${data.comment}`;

    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят! Ожидайте подтверждения.');
  } catch (e) {
    console.error('❌ Ошибка заказа:', e);
    await ctx.reply('❌ Ошибка оформления. Попробуйте снова.');
  }
});

// API меню с фото и описанием
app.get('/api/menu', (req, res) => {
  res.json([
    {
      id: 1,
      name: 'Чизбургер Классик',
      desc: 'Сочная говядина, сыр чеддер, свежие овощи',
      price: 350,
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop'
    },
    {
      id: 2,
      name: 'Пицца Маргарита',
      desc: 'Томатный соус, моцарелла, свежий базилик',
      price: 600,
      image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop'
    },
    {
      id: 3,
      name: 'Кола 0.5л',
      desc: 'Классический освежающий вкус',
      price: 150,
      image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=300&fit=crop'
    },
    {
      id: 4,
      name: 'Картофель фри',
      desc: 'Золотистый, хрустящий, с морской солью',
      price: 200,
      image: 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400&h=300&fit=crop'
    }
  ]);
});

// Заглушка API для фронта
app.post('/api/order', (req, res) => {
  res.json({ success: true });
});

// Запуск
bot.catch((err) => console.error('🤖 Telegraf error:', err));
bot.launch();
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Mini App URL: ${WEBAPP_URL}`);
});
