require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const mysql = require('mysql2/promise');

// Создание пула подключений к MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000
});

// Проверка подключения
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Подключение к MySQL успешно!');
    connection.release();
    await createTables();
  } catch (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
  }
}

// Создание таблиц
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        name VARCHAR(255),
        username VARCHAR(255),
        bonus_balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        total_amount DECIMAL(10,2) NOT NULL,
        bonus_used DECIMAL(10,2) DEFAULT 0,        bonus_accrued DECIMAL(10,2) DEFAULT 0,
        status ENUM('pending', 'cooking', 'delivering', 'delivered', 'cancelled') DEFAULT 'pending',
        address TEXT,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        type VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    console.log('✅ Все таблицы созданы');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

testConnection();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== PUBLIC API ====================

app.get('/api/user/:userId/balance', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT bonus_balance FROM users WHERE telegram_id = ?',
      [req.params.userId]
    );
    res.json({ balance: rows[0]?.bonus_balance || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка БД' });  }
});

app.post('/api/user/:userId/accrue', async (req, res) => {
  const { orderAmount } = req.body;
  const bonus = Math.floor(orderAmount * 0.05);
  
  try {
    await pool.query('BEGIN');
    await pool.query(
      'UPDATE users SET bonus_balance = bonus_balance + ? WHERE telegram_id = ?',
      [bonus, req.params.userId]
    );
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ((SELECT id FROM users WHERE telegram_id = ?), "accrual", ?, ?)',
      [req.params.userId, bonus, `Начислено за заказ ${orderAmount}₽`]
    );
    await pool.query('COMMIT');
    res.json({ success: true, accrued: bonus });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/order', async (req, res) => {
  const { items, total, address, comment, bonusUsed = 0, userId } = req.body;
  
  try {
    const [result] = await pool.query(
      `INSERT INTO orders (user_id, total_amount, bonus_used, address, comment, status) 
       VALUES ((SELECT id FROM users WHERE telegram_id = ?), ?, ?, ?, ?, 'pending')`,
      [userId, total, bonusUsed, address, comment || '']
    );
    
    if (bonusUsed === 0) {
      fetch(`http://localhost:${PORT}/api/user/${userId}/accrue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderAmount: total })
      }).catch(() => {});
    }
    
    res.json({ success: true, orderId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ==================== ADMIN API ====================
// Получить все заказы
app.get('/api/admin/orders', async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT o.*, u.telegram_id,
        GROUP_CONCAT(CONCAT(i.name, ' x', i.qty) SEPARATOR ', ') as items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Получить один заказ
app.get('/api/admin/order/:id', async (req, res) => {
  try {
    const [order] = await pool.query(`
      SELECT o.*, u.telegram_id
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `, [req.params.id]);
    res.json(order[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Обновить статус
app.post('/api/admin/order/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'cooking', 'delivering', 'delivered', 'cancelled'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  
  try {
    await pool.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {    res.status(500).json({ error: 'Ошибка' });
  }
});

// Уведомить пользователя
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

// Страница админки
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== BOT COMMANDS ====================

bot.start(async (ctx) => {
  try {
    await pool.query(
      'INSERT IGNORE INTO users (telegram_id, name, username, bonus_balance) VALUES (?, ?, ?, 0)',
      [ctx.from.id, ctx.from.first_name, ctx.from.username]
    );
    
    // Админская кнопка
    const keyboard = {
      inline_keyboard: [[
        { text: '📱 Открыть Меню', web_app: { url: WEBAPP_URL } }
      ]]
    };
    
    // Добавляем кнопку админки для ADMIN_ID
    if (ctx.from.id === ADMIN_ID) {
      keyboard.inline_keyboard.push([
        { text: '🔧 Админ-панель', web_app: { url: `${WEBAPP_URL}/admin` } }      ]);
    }
    
    await ctx.reply('🍽️ Добро пожаловать в ЕдаТут!', { reply_markup: keyboard });
  } catch (err) {
    console.error('Ошибка /start:', err);
  }
});

// Команда /admin
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
      msg += `  • ${item.name} x${item.qty}\n`;
    });
    msg += `\n💰 Сумма: ${data.total} ₽`;
    if (data.bonusUsed > 0) msg += `\n💳 Бонусы: -${data.bonusUsed} ₽`;
    msg += `\n📍 Адрес: ${data.address}`;
    if (data.comment) msg += `\n💬 Комментарий: ${data.comment}`;
    
    await bot.telegram.sendMessage(process.env.ADMIN_ID, msg);
    await ctx.reply('✅ Заказ принят!');
  } catch (err) {
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

process.on('SIGINT', () => { pool.end(); bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { pool.end(); bot.stop('SIGTERM'); process.exit(); });
