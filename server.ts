import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import path from 'path';
import cors from 'cors';

// Интерфейсы для типизации
interface MenuItem {
  id: number;
  name: string;
  price: number;
  img: string;
}

interface OrderData {
  items: { name: string; price: number; qty: number }[];
  total: number;
  address: string;
}

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN!);
const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBAPP_URL = process.env.WEBAPP_URL!;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Команда /start
bot.start((ctx) => {
  ctx.reply('🍔 Добро пожаловать в FoodHub!', {
    reply_markup: {
      inline_keyboard: [[
        { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

// 2. Обработка заказа из Mini App
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data) as OrderData;
    
    // Формируем сообщение для админа
    let msg = `🆕 Новый заказ!\n`;
    msg += `📦 Товары: ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n`;
    msg += `💰 Сумма: ${data.total}₽\n`;
    msg += `📍 Адрес: ${data.address}`;

    // Отправляем админу
    await bot.telegram.sendMessage(process.env.ADMIN_ID!, msg);
    
    // Отвечаем пользователю
    await ctx.reply('✅ Заказ принят! Ждите звонка.');
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка оформления.');
  }
});

// 3. API для меню
app.get('/api/menu', (req: Request, res: Response) => {
  const menu: MenuItem[] = [
    { id: 1, name: 'Чизбургер', price: 350, img: '🍔' },
    { id: 2, name: 'Пицца', price: 600, img: '🍕' },
    { id: 3, name: 'Кола', price: 150, img: '🥤' },
    { id: 4, name: 'Фри', price: 200, img: '🍟' }
  ];
  res.json(menu);
});

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
