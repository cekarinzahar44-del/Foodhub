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

bot.start(async (ctx) => {
  try {
    await ctx.reply('🍽️ Добро пожаловать в ЕдаТут!', {
      reply_markup: { inline_keyboard: [[{ text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }]] }
    });
  } catch (err) {}
});

bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    let msg = `🆕 Заказ!\n📦 ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n💰 ${data.total} ₽\n📍 ${data.address}`;
    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Принят!');
  } catch (e) { await ctx.reply('❌ Ошибка.'); }
});

app.get('/api/menu', (req, res) => {
  res.json([
    { id: 1, name: 'Чизбургер', desc: 'Сочный и мощный', price: 350, category: 'burger', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop' },
    { id: 2, name: 'Пепперони', desc: 'Острая классика', price: 600, category: 'pizza', image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&h=300&fit=crop' },
    { id: 3, name: 'Кола', desc: 'Ледяная', price: 150, category: 'drink', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=300&fit=crop' },
    { id: 4, name: 'Картошка', desc: 'Хрустящая', price: 200, category: 'fry', image: 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400&h=300&fit=crop' }
  ]);
});

app.post('/api/order', (req, res) => res.json({ success: true }));
bot.launch();
app.listen(PORT, () => console.log(`🚀 Server: ${PORT}`));
