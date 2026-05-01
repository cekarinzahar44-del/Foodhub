require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

// === ИНИЦИАЛИЗАЦИЯ БД ===
let pool = null;
let USE_DB = false;

async function initDB() {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    console.log('⚠️ Режим: без БД (нет реквизитов)');
    return;
  }
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: false,
      max: 20
    });

    const client = await pool.connect();
    console.log('✅ Подключение к PostgreSQL успешно!');
    client.release();
    USE_DB = true;
    await createTables();
  } catch (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
  }
}

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        name TEXT, username TEXT,
        bonus_balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category TEXT,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Добавляем демо-меню, если пусто
    const { rows } = await pool.query('SELECT COUNT(*) FROM menu_items');
    if (rows[0].count === '0') {
      await pool.query(`
        INSERT INTO menu_items (name, description, price, category, image_url) VALUES
        ('Чизбургер Классик', 'Сочная говядина, сыр чеддер, овощи', 350, 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400'),
        ('Пицца Маргарита', 'Томаты, моцарелла, базилик', 600, 'pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400'),
        ('Кола 0.5л', 'Освежающий напиток', 150, 'drink', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400'),
        ('Картофель фри', 'Хрустящий, с морской солью', 200, 'fry', 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400')
      `);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending', -- pending, pending_payment, paid, cooking, delivered, cancelled
        address TEXT, comment TEXT, items TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Таблицы готовы');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

initDB();

// === EXPRESS & BOT ===
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());app.use(express.static(path.join(__dirname, 'public')));

// === 🌐 API МЕНЮ (для пользователей) ===
app.get('/api/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, description, price, category, image_url FROM menu_items WHERE is_active = true ORDER BY id');
    res.json(result.rows);
  } catch { res.status(500).json([]); }
});

// === 💳 СОЗДАНИЕ ССЫЛКИ НА ОПЛАТУ ===
app.post('/api/payment/create', async (req, res) => {
  const { userId, items, total, address, comment } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Сохраняем заказ в БД со статусом "ожидает оплаты"
    const orderRes = await client.query(
      `INSERT INTO orders (user_id, total_amount, status, address, comment, items)
       VALUES ($1, $2, 'pending_payment', $3, $4, $5) RETURNING id`,
      [userId, total, address, comment || '', JSON.stringify(items)]
    );
    const orderId = orderRes.rows[0].id;

    await client.query('COMMIT');

    // 2. Создаём ссылку на оплату через Telegram
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: `Заказ #${orderId}`,
      description: items.map(i => `${i.name} x${i.qty}`).join(', '),
      payload: JSON.stringify({ orderId, userId }),
      provider_token: process.env.PAYMENT_PROVIDER_TOKEN, // Токен PayMaster из BotFather
      currency: 'RUB',
      prices: items.map(i => ({ label: i.name, amount: Math.round(i.price * i.qty * 100) })), // В копейках
      need_name: false,
      need_phone_number: false,
      need_email: false,
      need_shipping_address: false
    });

    res.json({ success: true, orderId, invoice_url: `https://t.me/${bot.botInfo.username}?start=pay_${invoiceLink}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Payment Create Error:', err);
    res.status(500).json({ error: 'Ошибка создания платежа' });
  } finally {
    client.release();
  }});

// ===  ОБРАБОТКА ПРЕДВАРИТЕЛЬНОЙ ПРОВЕРКИ (перед оплатой) ===
bot.on('pre_checkout_query', async (ctx) => {
  // Здесь можно проверить актуальность цен или наличие товара
  await ctx.answerPreCheckoutQuery(true);
});

// === 🔹 УСПЕШНАЯ ОПЛАТА ===
bot.on('successful_payment', async (ctx) => {
  try {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const orderId = payload.orderId;

    // 1. Обновляем статус заказа
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);

    // 2. Уведомляем админа
    await bot.telegram.sendMessage(ADMIN_ID, 
      ` **Оплата получена!**\n\n Заказ #${orderId}\n💵 Сумма: ${ctx.message.successful_payment.total_amount / 100} ₽\n Пользователь: ${ctx.from.first_name}`
    );

    // 🚀 ЗДЕСЬ БУДЕТ ОТПРАВКА В R-KEEPER (когда подключим)
    // await pushOrderToRK({ localOrderId: orderId });

    console.log(`✅ Заказ #${orderId} успешно оплачен!`);
  } catch (err) {
    console.error('Successful Payment Error:', err);
  }
});

// ===  БОТ ХЕНДЛЕРЫ ===
bot.start(async (ctx) => {
  try {
    await pool.query('INSERT INTO users (telegram_id, name, username, bonus_balance) VALUES ($1, $2, $3, 0) ON CONFLICT (telegram_id) DO NOTHING', 
      [ctx.from.id, ctx.from.first_name, ctx.from.username]);

    const kb = { inline_keyboard: [[{ text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }]] };
    if (ctx.from.id === ADMIN_ID) kb.inline_keyboard.push([{ text: ' Админ-панель', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    
    await ctx.reply('🍽️ Добро пожаловать в Foodhub! Нажми кнопку ниже, чтобы сделать заказ.', { reply_markup: kb });
  } catch (err) { console.error(err); }
});

bot.on('web_app_data', async (ctx) => {
  // Если пользователь отправил данные напрямую (fallback)
  await ctx.reply('✅ Данные получены! Но для оплаты используй кнопку "Оформить заказ" внутри приложения.');
});

bot.catch(err => console.error('Bot error:', err));
// === ЗАПУСК ===
bot.launch();
app.listen(PORT, () => console.log(`🚀 Server: ${PORT} | DB: ${USE_DB ? 'PostgreSQL' : 'OFF'}`));

process.on('SIGINT', () => { if(pool) pool.end(); bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { if(pool) pool.end(); bot.stop('SIGTERM'); process.exit(); });
