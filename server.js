require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

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
      // 🔥 ИСПРАВЛЕНИЕ: отключаем SSL для Bothost
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
        name TEXT,
        username TEXT,
        bonus_balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`      CREATE TABLE IF NOT EXISTS orders (
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
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

// === МЕНЮ ===
app.get('/api/menu', (req, res) => {
  res.json([
    { id: 1, name: 'Чизбургер Классик', desc: 'Сочная говядина, сыр чеддер', price: 350, category: 'burger', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop' },
    { id: 2, name: 'Пицца Маргарита', desc: 'Томаты, моцарелла, базилик', price: 600, category: 'pizza', image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop' },
    { id: 3, name: 'Кола 0.5л', desc: 'Освежающий напиток', price: 150, category: 'drink', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=300&fit=crop' },
    { id: 4, name: 'Картофель фри', desc: 'Хрустящий, с солью', price: 200, category: 'fry', image: 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400&h=300&fit=crop' }  ]);
});

// === ПОЛЬЗОВАТЕЛЬ ===
app.get('/api/user/:userId/balance', async (req, res) => {
  try {
    const result = await pool.query('SELECT bonus_balance FROM users WHERE telegram_id = $1', [req.params.userId]);
    res.json({ balance: result.rows[0]?.bonus_balance || 0 });
  } catch { res.status(500).json({ balance: 0 }); }
});

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
  } catch { await client.query('ROLLBACK'); res.status(500).json({ error: 'Ошибка' }); }
  finally { client.release(); }
});

// === ЗАКАЗ ===
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
// === АДМИНКА (без order_items!) ===
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.total_amount, o.bonus_used, o.status, o.address, o.comment, o.items, o.created_at, u.telegram_id
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin API Error:', err);
    res.status(500).json({ error: 'Ошибка загрузки заказов' });
  }
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
  const messages = {
    'cooking': '👨‍🍳 Ваш заказ готовится!',
    'delivering': '🚀 Заказ передан курьеру!',
    'delivered': '✅ Доставлен!',
    'cancelled': '❌ Отменён'
  };
  try {
    await bot.telegram.sendMessage(userId, `${messages[status]}\n\nЗаказ #${orderId}`);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// === БОТ ===bot.start(async (ctx) => {
  try {
    await pool.query('INSERT INTO users (telegram_id, name, username, bonus_balance) VALUES ($1, $2, $3, 0) ON CONFLICT (telegram_id) DO NOTHING', [ctx.from.id, ctx.from.first_name, ctx.from.username]);
    const kb = { inline_keyboard: [[{ text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }]] };
    if (ctx.from.id === ADMIN_ID) kb.inline_keyboard.push([{ text: '🔧 Админ-панель', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    await ctx.reply('🍽️ Добро пожаловать в ЕдаТут!', { reply_markup: kb });
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
