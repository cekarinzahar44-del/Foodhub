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
    await ctx.reply('🍽️ Добро пожаловать в ЕдаТут!', {
      reply_markup: {
        inline_keyboard: [[
          { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
        ]]
      }
    });
  } catch (err) {
    console.error('Ошибка /start:', err);
  }
});

// Обработка заказа
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    let msg = `🆕 Новый заказ!\n\n`;
    msg += `📦 Товары:\n`;
    data.items.forEach(item => {
      msg += `  • ${item.name} x${item.qty}\n`;
    });
    msg += `\n💰 Сумма: ${data.total} ₽`;
    msg += `\n📍 Адрес: ${data.address}`;
    if (data.comment) msg += `\n💬 Комментарий: ${data.comment}`;
    
    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят! Мы скоро свяжемся с вами.');
  } catch (e) {
    console.error('Ошибка заказа:', e);
    await ctx.reply('❌ Произошла ошибка. Попробуйте снова.');
  }
});
// API меню
app.get('/api/menu', (req, res) => {
  res.json([
    {
      id: 1,
      name: 'Чизбургер Классик',
      desc: 'Сочная говядина, сыр чеддер, свежие овощи',
      price: 350,
      category: 'burger',
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop'
    },
    {
      id: 2,
      name: 'Пицца Маргарита',
      desc: 'Томатный соус, моцарелла, свежий базилик',
      price: 600,
      category: 'pizza',
      image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop'
    },
    {
      id: 3,
      name: 'Кола 0.5л',
      desc: 'Классический освежающий вкус',
      price: 150,
      category: 'drink',
      image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=300&fit=crop'
    },
    {
      id: 4,
      name: 'Картофель фри',
      desc: 'Золотистый, хрустящий, с морской солью',
      price: 200,
      category: 'fry',
      image: 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400&h=300&fit=crop'
    },
    {
      id: 5,
      name: 'Двойной Бургер',
      desc: 'Двойная котлета для настоящих мужчин',
      price: 450,
      category: 'burger',
      image: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=400&h=300&fit=crop'
    }
  ]);
});

// API заказа
app.post('/api/order', (req, res) => {
  console.log('Новый заказ:', req.body);  res.json({ success: true });
});

// Обработка ошибок бота
bot.catch((err) => {
  console.error('🤖 Telegraf error:', err);
});

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Mini App URL: ${WEBAPP_URL}`);
});

// Корректная остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
