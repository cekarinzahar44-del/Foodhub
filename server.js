require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
let lastOpenDate = '';
let lastCloseDate = '';

async function initDB() {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    console.log('⚠️ Нет реквизитов БД');
    return;
  }
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: false
    });

    const client = await pool.connect();
    console.log('✅ PostgreSQL подключён!');
    client.release();

    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, name TEXT, username TEXT, bonus_balance DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id BIGINT, total_amount DECIMAL(10,2) NOT NULL, status VARCHAR(50) DEFAULT 'pending_payment', address TEXT, comment TEXT, items TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, price DECIMAL(10,2) NOT NULL, category TEXT, image_url TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS shifts (id SERIAL PRIMARY KEY, opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closed_at TIMESTAMP, is_active BOOLEAN DEFAULT false)`);

    await pool.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    await pool.query(`UPDATE menu_items SET is_active = true WHERE is_active IS NULL`);

    const { rows } = await pool.query('SELECT COUNT(*) FROM menu_items');
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`INSERT INTO menu_items (name, description, price, category, image_url, is_active) VALUES ('Чизбургер Классик', 'Сочная говядина', 350, 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', true), ('Пицца Маргарита', 'Томаты, моцарелла', 600, 'pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400', true), ('Кола 0.5л', 'Напиток', 150, 'drink', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400', true), ('Картофель фри', 'Хрустящий', 200, 'fry', 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400', true)`);
    }
    console.log('✅ БД готова');
  } catch (err) {
    console.error('❌ Ошибка БД:', err.message);
    pool = null;
  }
}

function requireDB(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'База недоступна' });  next();
}

initDB();

// === 🔥 ПЛАНИРОВЩИК (10:00 - 22:00 МСК) ===
async function startShiftScheduler() {
  console.log('🕒 Планировщик запущен (10:00 - 22:00 МСК)');
  setInterval(async () => {
    try {
      if (!pool) return;
      const now = new Date();
      const moscow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
      const h = moscow.getHours();
      const m = moscow.getMinutes();
      const today = moscow.toISOString().split('T')[0];

      // 🔥 ОТКРЫТИЕ: 10:00 - 10:01 (окно 2 минуты)
      if (h === 10 && m < 2 && lastOpenDate !== today) {
        lastOpenDate = today;
        console.log(`🔔 ${h}:${m} - Открываю смену`);
        await openShift();
      }
      // 🔥 ЗАКРЫТИЕ: 22:00 - 22:01 (окно 2 минуты)
      if (h === 22 && m < 2 && lastCloseDate !== today) {
        lastCloseDate = today;
        console.log(`🔔 ${h}:${m} - Закрываю смену`);
        await closeShift();
      }
    } catch (err) { console.error('Scheduler error:', err.message); }
  }, 30000);
}

async function getActiveShift() {
  try {
    const res = await pool.query('SELECT * FROM shifts WHERE is_active = true ORDER BY id DESC LIMIT 1');
    return res.rows[0] || null;
  } catch { return null; }
}

async function openShift() {
  try {
    const active = await getActiveShift();
    if (active) { console.log('🟢 Смена уже открыта'); return; }
    await pool.query('INSERT INTO shifts (is_active) VALUES (true)');
    console.log('🟢 Смена открыта');
    if (bot && ADMIN_ID) await bot.telegram.sendMessage(ADMIN_ID, '🟢 *Смена открыта*\n⏰ Время работы: 10:00 - 22:00 МСК', { parse_mode: 'Markdown' });
  } catch (err) { console.error('Open error:', err.message); }
}
// === 🔥 ИСПРАВЛЕННАЯ ФУНКЦИЯ (РАЗДЕЛЁННЫЕ ЗАПРОСЫ - РАБОТАЕТ БЕЗ ОШИБОК) ===
async function closeShift() {
  try {
    const active = await getActiveShift();
    if (!active) { console.log('⚪ Нет активной смены'); return; }
    
    // 1. Закрываем смену в БД
    await pool.query('UPDATE shifts SET closed_at = NOW(), is_active = false WHERE id = $1', [active.id]);
    console.log('🔴 Смена закрыта');

    // 2. Запрос ТОЛЬКО для цифр (без items!)
    const stats = await pool.query(`
      SELECT
        COALESCE(SUM(total_amount), 0) as revenue,
        COUNT(*) FILTER (WHERE status != 'cancelled') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM orders
      WHERE created_at >= $1 AND created_at <= $2
    `, [active.opened_at, new Date()]);

    const revenue = parseFloat(stats.rows[0].revenue);
    const completed = parseInt(stats.rows[0].completed);
    const cancelled = parseInt(stats.rows[0].cancelled);
    const avg = completed > 0 ? Math.round(revenue / completed) : 0;

    // 3. ОТДЕЛЬНЫЙ запрос для товаров (items)
    const itemsRes = await pool.query(`
      SELECT items FROM orders 
      WHERE created_at >= $1 AND created_at <= $2 AND items IS NOT NULL
    `, [active.opened_at, new Date()]);

    // 4. Считаем продажи
    const itemCounts = {};
    for (const row of itemsRes.rows) {
      try {
        const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
        if (Array.isArray(items)) {
          items.forEach(i => { itemCounts[i.name] = (itemCounts[i.name] || 0) + (i.qty || 1); });
        }
      } catch {}
    }

    // 5. Формируем отчёт
    const openTime = active.opened_at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const closeTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const itemsList = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `• ${name} × ${count}`).join('\n');

    const report = `📊 *Отчёт за смену*\n⏰ ${openTime} - ${closeTime}\n\n` +
      `💰 Выручка: ${revenue.toLocaleString('ru-RU')} ₽\n` +
      `🧾 Средний чек: ${avg.toLocaleString('ru-RU')} ₽\n` +      `✅ Завершено: ${completed}\n` +
      `❌ Отменено: ${cancelled}\n\n` +
      `📦 *Продажи:*\n${itemsList || 'Нет продаж'}`;

    if (bot && ADMIN_ID) {
      await bot.telegram.sendMessage(ADMIN_ID, report, { parse_mode: 'Markdown' });
    }
    console.log('📧 Отчёт отправлен админу');
  } catch (err) { 
    console.error('Close error:', err.message); 
  }
}

startShiftScheduler();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/menu', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, description, price, category, image_url FROM menu_items WHERE is_active = true ORDER BY id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/payment/create', async (req, res) => {
  const { userId, items, total, address, comment } = req.body;
  try {
    const orderRes = await pool.query(`INSERT INTO orders (user_id, total_amount, status, address, comment, items) VALUES ($1, $2, 'pending_payment', $3, $4, $5) RETURNING id`, [BigInt(userId), total, address, comment || '', JSON.stringify(items)]);
    const orderId = orderRes.rows[0].id;
    const invoiceLink = await bot.telegram.createInvoiceLink({ title: `Заказ #${orderId}`, description: items.map(i => `${i.name} x${i.qty}`).join(', '), payload: JSON.stringify({ orderId, userId, total }), provider_token: process.env.PAYMENT_PROVIDER_TOKEN, currency: 'RUB', prices: items.map(i => ({ label: i.name, amount: Math.round(i.price * i.qty * 100) })), need_name: false, need_phone_number: false, need_email: false, need_shipping_address: false });
    res.json({ success: true, orderId, invoice_url: invoiceLink });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

bot.on('pre_checkout_query', async (ctx) => { await ctx.answerPreCheckoutQuery(true); });
bot.on('successful_payment', async (ctx) => {
  try {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', payload.orderId]);
    await bot.telegram.sendMessage(ADMIN_ID, `💰 *Оплата!*\n📦 Заказ #${payload.orderId}\n💵 ${ctx.message.successful_payment.total_amount / 100} ₽`, { parse_mode: 'Markdown' });
  } catch (err) { console.error('Payment error:', err); }
});
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { date, from, to } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    let idx = 1;
    if (date) { query += ` AND DATE(created_at) = $${idx}`; params.push(date); idx++; }
    if (from) { query += ` AND DATE(created_at) >= $${idx}`; params.push(from); idx++; }
    if (to) { query += ` AND DATE(created_at) <= $${idx}`; params.push(to); idx++; }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/order/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    const order = orderRes.rows[0];
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    try { await bot.telegram.sendMessage(order.user_id, `📦 **Заказ #${order.id}**\nСтатус: **${getStatusText(status)}**`, { parse_mode: 'Markdown' }); } catch (e) {}
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/menu', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id DESC');
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/menu', requireDB, async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query('INSERT INTO menu_items (name, description, price, category, image_url, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING *', [name, description, price, category, image_url || '']);
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.put('/api/admin/menu/:id', requireDB, async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query('UPDATE menu_items SET name=$1, description=$2, price=$3, category=$4, image_url=$5 WHERE id=$6 RETURNING *', [name, description, price, category, image_url, req.params.id]);
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});
app.delete('/api/admin/menu/:id', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/metrics', requireDB, async (req, res) => {
  try {
    const revenue = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'");
    const orders = await pool.query("SELECT COUNT(*) as count FROM orders WHERE status != 'cancelled'");
    const totalOrders = parseInt(orders.rows[0].count);
    const totalRevenue = parseFloat(revenue.rows[0].total);
    const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    res.json({ revenue: totalRevenue, totalOrders, avgCheck, topItem: '—' });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/user/:userId/balance', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT bonus_balance FROM users WHERE telegram_id = $1', [req.params.userId]);
    res.json({ balance: result.rows[0]?.bonus_balance || 0 });
  } catch { res.status(500).json({ balance: 0 }); }
});

app.get('/api/user/:userId/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [BigInt(req.params.userId)]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.post('/api/admin/shift/open', async (req, res) => { await openShift(); res.json({ success: true }); });
app.post('/api/admin/shift/close', async (req, res) => { await closeShift(); res.json({ success: true }); });

function getStatusText(status) {
  const s = { 'pending_payment': '⏳ Ожидает', 'paid': '✅ Оплачен', 'cooking': '👨‍ Готовится', 'ready': '🎁 Готов', 'delivering': '🚚 В пути', 'delivered': '✅ Доставлен', 'cancelled': '❌ Отменён' };
  return s[status] || status;
}

bot.start(async (ctx) => {
  try {
    if (pool) await pool.query('INSERT INTO users (telegram_id, name, username) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING', [BigInt(ctx.from.id), ctx.from.first_name, ctx.from.username]);
    const kb = { inline_keyboard: [[{ text: '🍽 Меню', web_app: { url: WEBAPP_URL } }]] };
    if (ctx.from.id === ADMIN_ID) kb.inline_keyboard.push([{ text: '⚙️ Админка', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    await ctx.reply('FoodHub 🍔', { reply_markup: kb });
  } catch (err) { console.error('Bot error:', err); }
});
bot.catch(err => console.error('Bot error:', err));

bot.launch();
app.listen(PORT, () => {
  console.log(`🚀 Server: ${PORT}`);
  console.log(`🌐 URL: ${WEBAPP_URL}`);
});

process.on('SIGINT', () => { bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(); });
