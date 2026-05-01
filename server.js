require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

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

    await pool.query(`      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category TEXT,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Проверяем, есть ли товары
    const { rows } = await pool.query('SELECT COUNT(*) FROM menu_items');
    if (rows[0].count === '0') {
      await pool.query(`
        INSERT INTO menu_items (name, description, price, category, image_url) VALUES
        ('Чизбургер Классик', 'Сочная говядина, сыр чеддер, свежие овощи', 350, 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop'),
        ('Пицца Маргарита', 'Томатный соус, моцарелла, свежий базилик', 600, 'pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop'),
        ('Кола 0.5л', 'Классический освежающий вкус', 150, 'drink', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=300&fit=crop'),
        ('Картофель фри', 'Золотистый, хрустящий, с морской солью', 200, 'fry', 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400&h=300&fit=crop'),
        ('Двойной Бургер', 'Двойная котлета для самых голодных', 450, 'burger', 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=400&h=300&fit=crop')
      `);
      console.log('✅ Добавлены демо-товары в меню');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total_amount DECIMAL(10,2) NOT NULL,
        bonus_used DECIMAL(10,2) DEFAULT 0,
        bonus_accrued DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        address TEXT,
        comment TEXT,
        items TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try { await pool.query(`ALTER TABLE orders ADD COLUMN items TEXT;`); } catch {}

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Все таблицы готовы');
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

// === 🍔 МЕНЮ (ПУБЛИЧНОЕ) ===
app.get('/api/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, description, price, category, image_url FROM menu_items WHERE is_active = true ORDER BY id');
    res.json(result.rows);
  } catch { res.status(500).json([]); }
});

// === 👤 БАЛАНС ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/user/:userId/balance', async (req, res) => {
  try {
    const result = await pool.query('SELECT bonus_balance FROM users WHERE telegram_id = $1', [req.params.userId]);
    res.json({ balance: result.rows[0]?.bonus_balance || 0 });
  } catch { res.status(500).json({ balance: 0 }); }
});

// === 💰 НАЧИСЛЕНИЕ БОНУСОВ ===
app.post('/api/user/:userId/accrue', async (req, res) => {
  const { orderAmount } = req.body;
  const bonus = Math.floor(orderAmount * 0.05);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET bonus_balance = bonus_balance + $1 WHERE telegram_id = $2', [bonus, req.params.userId]);
    await client.query('INSERT INTO transactions (user_id, type, amount, description) VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4)', [req.params.userId, 'accrual', bonus, `Начислено за заказ ${orderAmount}₽`]);
    await client.query('COMMIT');
    res.json({ success: true, accrued: bonus });
  } catch { await client.query('ROLLBACK'); res.status(500).json({ error: 'Ошибка' }); }  finally { client.release(); }
});

// === 📦 СОЗДАНИЕ ЗАКАЗА (БЕЗ ОПЛАТЫ) ===
app.post('/api/order', async (req, res) => {
  const { items, total, address, comment, bonusUsed = 0, userId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO orders (user_id, total_amount, bonus_used, address, comment, status, items)
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [userId, total, bonusUsed, address, comment || '', JSON.stringify(items)]
    );
    await client.query('COMMIT');
    const orderId = result.rows[0].id;
    if (bonusUsed === 0) {
      fetch(`http://localhost:${PORT}/api/user/${userId}/accrue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderAmount: total })
      }).catch(() => {});
    }
    res.json({ success: true, orderId });
  } catch { await client.query('ROLLBACK'); res.status(500).json({ error: 'Ошибка' }); }
  finally { client.release(); }
});

// === 💳 ОПЛАТА ЧЕРЕЗ БАНК (PayMaster/Тинькофф/Сбер) ===
app.post('/api/payment/create', async (req, res) => {
  const { userId, items, total, address, comment } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Создаём заказ со статусом "ожидает оплаты"
    const orderRes = await client.query(
      `INSERT INTO orders (user_id, total_amount, status, address, comment, items)
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, 'pending_payment', $3, $4, $5)
       RETURNING id`,
      [userId, total, address, comment || '', JSON.stringify(items)]
    );
    const orderId = orderRes.rows[0].id;
    
    await client.query('COMMIT');
    
    // 2. Создаём платёж через Telegram Bot Payments (универсально)
    const invoiceLink = await bot.telegram.createInvoiceLink({      title: `Заказ #${orderId}`,
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
    await client.query('ROLLBACK');
    console.error('Payment Error:', err);
    res.status(500).json({ error: 'Ошибка создания платежа' });
  } finally {
    client.release();
  }
});

// === 🔹 PRE-CHECKOUT (ПРОВЕРКА ПЕРЕД ОПЛАТОЙ) ===
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// === 🔹 УСПЕШНАЯ ОПЛАТА ===
bot.on('successful_payment', async (ctx) => {
  try {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const orderId = payload.orderId;
    
    // 1. Обновляем статус
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
    
    // 2. Уведомляем админа
    await bot.telegram.sendMessage(ADMIN_ID, 
      `💰 **Оплата получена!**\n\n📦 Заказ #${orderId}\n💵 Сумма: ${ctx.message.successful_payment.total_amount / 100} ₽\n👤 Пользователь: ${ctx.from.first_name}`
    );
    
    // 🚀 ЗДЕСЬ БУДЕТ ОТПРАВКА В R-KEEPER (когда подключим)
    // await pushOrderToRK({ localOrderId: orderId });
    
    console.log(`✅ Заказ #${orderId} оплачен!`);  } catch (err) {
    console.error('Payment Error:', err);
  }
});

// === 📦 АДМИНКА: ЗАКАЗЫ ===
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.total_amount, o.bonus_used, o.status, o.address, o.comment, o.items, o.created_at, u.telegram_id
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/order/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT o.*, u.telegram_id FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/order/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/notify', async (req, res) => {
  const { userId, status, orderId } = req.body;
  const messages = { 'cooking': '👨‍🍳 Ваш заказ готовится!', 'delivering': '🚀 Заказ передан курьеру!', 'delivered': '✅ Доставлен!', 'cancelled': '❌ Отменён' };
  try {
    await bot.telegram.sendMessage(userId, `${messages[status]}\n\nЗаказ #${orderId}`);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

// === 🍔 АДМИНКА: МЕНЮ (CRUD) ===
app.get('/api/admin/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id DESC');
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/menu', async (req, res) => {  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO menu_items (name, description, price, category, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, price, category, image_url || '']
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка создания' }); }
});

app.put('/api/admin/menu/:id', async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query(
      'UPDATE menu_items SET name=$1, description=$2, price=$3, category=$4, image_url=$5 WHERE id=$6 RETURNING *',
      [name, description, price, category, image_url, req.params.id]
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка обновления' }); }
});

app.delete('/api/admin/menu/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка удаления' }); }
});

// === 📊 АДМИНКА: МЕТРИКИ ===
app.get('/api/admin/metrics', async (req, res) => {
  try {
    const revenue = await pool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != $1', ['cancelled']);
    const orders = await pool.query('SELECT COUNT(*) as count FROM orders WHERE status != $1', ['cancelled']);
    const avgCheck = await pool.query('SELECT COALESCE(AVG(total_amount), 0) as avg FROM orders WHERE status != $1', ['cancelled']);
    
    res.json({
      revenue: parseFloat(revenue.rows[0].total),
      totalOrders: parseInt(orders.rows[0].count),
      avgCheck: parseFloat(avgCheck.rows[0].avg)
    });
  } catch { res.status(500).json({ error: 'Ошибка метрик' }); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// === 🤖 БОТ ===
bot.start(async (ctx) => {
  try {
    await pool.query('INSERT INTO users (telegram_id, name, username, bonus_balance) VALUES ($1, $2, $3, 0) ON CONFLICT (telegram_id) DO NOTHING', [ctx.from.id, ctx.from.first_name, ctx.from.username]);
    const kb = { inline_keyboard: [[{ text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }]] };    if (ctx.from.id === ADMIN_ID) kb.inline_keyboard.push([{ text: '🔧 Админ-панель', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    await ctx.reply('🍽️ Добро пожаловать в Foodhub!', { reply_markup: kb });
  } catch (err) { console.error(err); }
});

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Доступ запрещён');
  await ctx.reply('🔧 Админка:', { reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: `${WEBAPP_URL}/admin` } }]] } });
});

bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    let msg = `🆕 Заказ!\n📦 ${data.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n💰 ${data.total} ₽\n📍 ${data.address}`;
    await bot.telegram.sendMessage(ADMIN_ID, msg);
    await ctx.reply('✅ Принят!');
  } catch { await ctx.reply('❌ Ошибка'); }
});

bot.catch(err => console.error('Bot error:', err));

// === ЗАПУСК ===
bot.launch();
app.listen(PORT, () => console.log(`🚀 Server: ${PORT} | DB: ${USE_DB ? 'PostgreSQL' : 'OFF'}`));

process.on('SIGINT', () => { if(pool) pool.end(); bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { if(pool) pool.end(); bot.stop('SIGTERM'); process.exit(); });
