require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

// Создание пула подключений к PostgreSQL
let pool = null;
let USE_DB = false;

try {
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Проверяем подключение
    pool.connect((err, client, release) => {
      if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
      } else {
        console.log('✅ Подключение к PostgreSQL успешно!');
        createTables();
        USE_DB = true;
      }
    });
  } else {
    console.log('⚠️ Режим: без БД (нет реквизитов)');
  }
} catch (err) {
  console.error('❌ Ошибка инициализации БД:', err.message);
}

// Создание таблиц
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        name TEXT,
        username TEXT,        bonus_balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    console.log('✅ Все таблицы созданы');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API ====================

app.get('/api/user/:userId/balance', async (req, res) => {
  try {    const result = await pool.query(
      'SELECT bonus_balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    res.json({ balance: result.rows[0]?.bonus_balance || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка БД' });
  }
});

app.post('/api/user/:userId/accrue', async (req, res) => {
  const { orderAmount } = req.body;
  const bonus = Math.floor(orderAmount * 0.05);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET bonus_balance = bonus_balance + $1 WHERE telegram_id = $2',
      [bonus, req.params.userId]
    );
    await client.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4)',
      [req.params.userId, 'accrual', bonus, `Начислено за заказ ${orderAmount}₽`]
    );
    await client.query('COMMIT');
    res.json({ success: true, accrued: bonus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка' });
  } finally {
    client.release();
  }
});

app.post('/api/order', async (req, res) => {
  const { items, total, address, comment, bonusUsed = 0, userId } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO orders (user_id, total_amount, bonus_used, address, comment, status) 
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4, $5, 'pending') 
       RETURNING id`,
      [userId, total, bonusUsed, address, comment || '']
    );
        await client.query('COMMIT');
    
    const orderId = result.rows[0].id;
    
    // Начисляем бонусы
    if (bonusUsed === 0) {
      fetch(`http://localhost:${PORT}/api/user/${userId}/accrue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderAmount: total })
      }).catch(() => {});
    }
    
    res.json({ success: true, orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка' });
  } finally {
    client.release();
  }
});

// ==================== ADMIN API ====================

app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.telegram_id,
        STRING_AGG(COALESCE(i.name, 'Товар'), ', ') as items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items i ON o.id = i.order_id
      GROUP BY o.id, u.telegram_id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/admin/order/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.telegram_id
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id      WHERE o.id = $1
    `, [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/admin/order/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'cooking', 'delivering', 'delivered', 'cancelled'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  
  try {
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/admin/notify', async (req, res) => {
  const { userId, status, orderId } = req.body;
  
  const statusMessages = {
    'cooking': '👨‍🍳 Ваш заказ готовится!',
    'delivering': '🚀 Заказ передан курьеру!',
    'delivered': '✅ Заказ доставлен! Приятного аппетита!',
    'cancelled': '❌ Заказ отменён'
  };
  
  try {
    await bot.telegram.sendMessage(userId, 
      `${statusMessages[status]}\n\nЗаказ #${orderId}`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка отправки' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// ==================== BOT ====================

bot.start(async (ctx) => {
  try {
    await pool.query(
      'INSERT INTO users (telegram_id, name, username, bonus_balance) VALUES ($1, $2, $3, 0) ON CONFLICT (telegram_id) DO NOTHING',
      [ctx.from.id, ctx.from.first_name, ctx.from.username]
    );
    
    const keyboard = {
      inline_keyboard: [[
        { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
      ]]
    };
    
    if (ctx.from.id === ADMIN_ID) {
      keyboard.inline_keyboard.push([
        { text: '🔧 Админ-панель', web_app: { url: `${WEBAPP_URL}/admin` } }
      ]);
    }
    
    await ctx.reply('🍽️ Добро пожаловать в ЕдаТут!', { reply_markup: keyboard });
  } catch (err) {
    console.error('Ошибка /start:', err);
  }
});

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('❌ Доступ запрещён');
  }
  
  await ctx.reply('🔧 Админ-панель:', {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Открыть админку', web_app: { url: `${WEBAPP_URL}/admin` } }
      ]]
    }
  });
});

bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    
    let msg = `🆕 Новый заказ!\n\n`;
    msg += `📦 Товары:\n`;
    data.items.forEach(item => {
      msg += `  • ${item.name} x${item.qty}\n`;    });
    msg += `\n💰 Сумма: ${data.total} ₽`;
    if (data.bonusUsed > 0) msg += `\n💳 Бонусы: -${data.bonusUsed} ₽`;
    msg += `\n📍 Адрес: ${data.address}`;
    if (data.comment) msg += `\n💬 Комментарий: ${data.comment}`;
    
    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят!');
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Ошибка');
  }
});

bot.catch((err) => console.error('🤖 Bot error:', err));

// ==================== START ====================

bot.launch();

app.listen(PORT, () => {
  console.log(`🚀 Сервер: ${PORT}`);
  console.log(`🌐 URL: ${WEBAPP_URL}`);
  console.log(`🔧 Админка: ${WEBAPP_URL}/admin`);
});

process.on('SIGINT', () => {
  if (pool) pool.end();
  bot.stop('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  if (pool) pool.end();
  bot.stop('SIGTERM');
  process.exit();
});
