require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
let USE_DB = false;

async function initDB() {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    console.log('⚠️ Режим: без БД');
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
    console.log('✅ PostgreSQL подключён!');
    client.release();
    USE_DB = true;
    await createTables();
  } catch (err) {
    console.error('❌ Ошибка БД:', err.message);
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
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),  -- 🔥 BIGINT вместо INTEGER!
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    address TEXT, 
    comment TEXT, 
    items TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

    // Добавляем товары если пусто
    const { rows } = await pool.query('SELECT COUNT(*) FROM menu_items');
    if (rows[0].count === '0') {
      await pool.query(`
        INSERT INTO menu_items (name, description, price, category, image_url) VALUES
        ('Чизбургер Классик', 'Сочная говядина, сыр чеддер, свежие овощи', 350, 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400'),
        ('Пицца Маргарита', 'Томатный соус, моцарелла, свежий базилик', 600, 'pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400'),
        ('Кола 0.5л', 'Классический освежающий вкус', 150, 'drink', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400'),
        ('Картофель фри', 'Золотистый, хрустящий, с морской солью', 200, 'fry', 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400')
      `);
      console.log('✅ Добавлено 4 товара');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
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

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// === 🍔 МЕНЮ ===
app.get('/api/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, description, price, category, image_url FROM menu_items ORDER BY id');
    res.json(result.rows);
  } catch (err) { 
    console.error('Menu error:', err);
    res.status(500).json([]); 
  }
});

// === 💳 ОПЛАТА ЧЕРЕЗ PAYMASTER ===
app.post('/api/payment/create', async (req, res) => {
  const { userId, items, total, address, comment } = req.body;
  
  try {
    // 1. Сохраняем заказ
    const orderRes = await pool.query(
      `INSERT INTO orders (user_id, total_amount, status, address, comment, items)
       VALUES ($1, $2, 'pending_payment', $3, $4, $5) RETURNING id`,
      [userId, total, address, comment || '', JSON.stringify(items)]
    );
    const orderId = orderRes.rows[0].id;

    // 2. Создаём ссылку на оплату через Telegram
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: `Заказ #${orderId}`,
      description: items.map(i => `${i.name} x${i.qty}`).join(', '),
      payload: JSON.stringify({ orderId, userId, total }),
      provider_token: process.env.PAYMENT_PROVIDER_TOKEN,
      currency: 'RUB',
      prices: items.map(i => ({ label: i.name, amount: Math.round(i.price * i.qty * 100) })),
      need_name: false,
      need_phone_number: false,
      need_email: false,
      need_shipping_address: false
    });

    res.json({ 
      success: true, 
      orderId, 
      invoice_url: `https://t.me/${bot.botInfo.username}?start=pay_${orderId}_${Buffer.from(invoiceLink).toString('base64')}` 
    });
    
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Ошибка создания платежа' });
  }
});
// === 🔹 PRE-CHECKOUT ===
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// === 🔹 УСПЕШНАЯ ОПЛАТА ===
bot.on('successful_payment', async (ctx) => {
  try {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const orderId = payload.orderId;
    
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
    
    await bot.telegram.sendMessage(ADMIN_ID, 
      `💰 **Оплата получена!**\n\n📦 Заказ #${orderId}\n💵 ${ctx.message.successful_payment.total_amount / 100} ₽`
    );
    
    console.log(`✅ Заказ #${orderId} оплачен!`);
  } catch (err) {
    console.error('Payment success error:', err);
  }
});

// === 📦 АДМИНКА ===
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id DESC');
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/menu', async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO menu_items (name, description, price, category, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, price, category, image_url || '']
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});
app.delete('/api/admin/menu/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/metrics', async (req, res) => {
  try {
    const revenue = await pool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders');
    const orders = await pool.query('SELECT COUNT(*) as count FROM orders');
    res.json({
      revenue: parseFloat(revenue.rows[0].total),
      totalOrders: parseInt(orders.rows[0].count)
    });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/order/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// === 🤖 БОТ ===
bot.start(async (ctx) => {
  try {
    await pool.query('INSERT INTO users (telegram_id, name, username) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING', 
      [ctx.from.id, ctx.from.first_name, ctx.from.username]);
    
    const kb = { 
      inline_keyboard: [[{ text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }]] 
    };
    if (ctx.from.id === ADMIN_ID) {
      kb.inline_keyboard.push([{ text: '🔧 Админка', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    }
    
    await ctx.reply('🍽️ Добро пожаловать в Foodhub!', { reply_markup: kb });
  } catch (err) { console.error(err); }
});

bot.catch(err => console.error('Bot error:', err));

// === ЗАПУСК ===
bot.launch();
app.listen(PORT, () => {  console.log(`🚀 Server: ${PORT}`);
  console.log(`🌐 URL: ${WEBAPP_URL}`);
  console.log(`💾 DB: ${USE_DB ? 'Connected' : 'OFF'}`);
});

process.on('SIGINT', () => { if(pool) pool.end(); bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { if(pool) pool.end(); bot.stop('SIGTERM'); process.exit(); });
