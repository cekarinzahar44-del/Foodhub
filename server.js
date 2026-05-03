require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

async function initDB() {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    console.log('⚠️ Нет реквизитов БД — работаем без базы');
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        address TEXT,
        comment TEXT,
        items TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
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

    // Миграция: добавляем is_active если её нет
    await pool.query(`
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
    `);
    // Активируем все товары у которых is_active = NULL
    await pool.query(`
      UPDATE menu_items SET is_active = true WHERE is_active IS NULL
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM menu_items');
    console.log(`📊 Товаров в БД: ${rows[0].count}`);

    if (parseInt(rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO menu_items (name, description, price, category, image_url, is_active) VALUES
        ('Чизбургер Классик', 'Сочная говядина, сыр чеддер', 350, 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', true),
        ('Пицца Маргарита', 'Томаты, моцарелла, базилик', 600, 'pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400', true),
        ('Кола 0.5л', 'Освежающий напиток', 150, 'drink', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400', true),
        ('Картофель фри', 'Хрустящий, с солью', 200, 'fry', 'https://images.unsplash.com/photo-1585109649139-366815a0d713?w=400', true)
      `);
      console.log('✅ Добавлено 4 тестовых товара');
    } else {
      // Проверяем сколько активных товаров
      const active = await pool.query('SELECT COUNT(*) FROM menu_items WHERE is_active = true');
      console.log(`✅ Активных товаров: ${active.rows[0].count}`);

      // Если все товары неактивны — активируем
      if (parseInt(active.rows[0].count) === 0) {
        await pool.query('UPDATE menu_items SET is_active = true');
        console.log('🔧 Все товары активированы');
      }
    }

    console.log('✅ Таблицы готовы');
  } catch (err) {
    console.error('❌ Ошибка БД:', err.message);
    pool = null;
  }
}

// ── Middleware: защита от null pool ──
function requireDB(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'База данных недоступна' });
  next();
}

initDB();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === ВРЕМЕННЫЙ РОУТ: активировать все товары ===
app.get('/api/fix-menu', requireDB, async (req, res) => {
  try {
    await pool.query("UPDATE menu_items SET is_active = true");
    const result = await pool.query("SELECT id, name, is_active FROM menu_items");
    console.log('🔧 Все товары активированы');
    res.json({ fixed: true, items: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/menu', requireDB, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, price, category, image_url FROM menu_items WHERE is_active = true ORDER BY id'
    );
    console.log(`📋 /api/menu → ${result.rows.length} позиций`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ /api/menu error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === ОПЛАТА ===
// === 💳 ОПЛАТА ===
app.post('/api/payment/create', async (req, res) => {
  const { userId, items, total, address, comment } = req.body;
  
  try {
    // 1. Сохраняем заказ в БД
    const orderRes = await pool.query(
      `INSERT INTO orders (user_id, total_amount, status, address, comment, items)
       VALUES ($1, $2, 'pending_payment', $3, $4, $5) RETURNING id`,
      [BigInt(userId), total, address, comment || '', JSON.stringify(items)]
    );
    const orderId = orderRes.rows[0].id;

    // 2. Создаём прямую ссылку на оплату (Telegram сам вернёт https://t.me/invoice/...)
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: `Заказ #${orderId}`,
      description: items.map(i => `${i.name} x${i.qty}`).join(', '),
      payload: JSON.stringify({ orderId, userId, total }),
      provider_token: process.env.PAYMENT_PROVIDER_TOKEN, // 🔍 Проверь, что токен верный!
      currency: 'RUB',
      prices: items.map(i => ({ label: i.name, amount: Math.round(i.price * i.qty * 100) })),
      need_name: false,
      need_phone_number: false,
      need_email: false,
      need_shipping_address: false
    });

    // 3. Отдаём ссылку как есть, без обёрток
    res.json({ success: true, orderId, invoice_url: invoiceLink });
    
  } catch (err) {
    console.error('❌ Payment Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === PRE-CHECKOUT ===
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// === УСПЕШНАЯ ОПЛАТА ===
bot.on('successful_payment', async (ctx) => {
  try {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const orderId = payload.orderId;
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `💰 *Оплата получена!*\n\n📦 Заказ #${orderId}\n💵 ${ctx.message.successful_payment.total_amount / 100} ₽`,
      { parse_mode: 'Markdown' }
    );
    console.log(`✅ Заказ #${orderId} оплачен!`);
  } catch (err) {
    console.error('Payment success error:', err);
  }
});

// === АДМИНКА: ЗАКАЗЫ ===
app.get('/api/admin/orders', async (req, res) => {
  try {
    // 🔥 Добавили WHERE status = 'paid' — показываем только оплаченные
    const result = await pool.query(`
      SELECT * FROM orders 
      WHERE status = 'paid' 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { 
    console.error('Admin orders error:', err);
    res.status(500).json({ error: 'Ошибка загрузки заказов' }); 
  }
});

app.post('/api/admin/order/:id/status', requireDB, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

// === АДМИНКА: МЕНЮ (CRUD) ===
app.get('/api/admin/menu', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id DESC');
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/menu', requireDB, async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO menu_items (name, description, price, category, image_url, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING *',
      [name, description, price, category, image_url || '']
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка создания' }); }
});

app.put('/api/admin/menu/:id', requireDB, async (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  try {
    const result = await pool.query(
      'UPDATE menu_items SET name=$1, description=$2, price=$3, category=$4, image_url=$5 WHERE id=$6 RETURNING *',
      [name, description, price, category, image_url, req.params.id]
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Ошибка обновления' }); }
});

app.delete('/api/admin/menu/:id', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка удаления' }); }
});

// === АДМИНКА: МЕТРИКИ (ИСПРАВЛЕНО — avgCheck + topItem) ===
app.get('/api/admin/metrics', requireDB, async (req, res) => {
  try {
    const revenue = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'"
    );
    const orders = await pool.query(
      "SELECT COUNT(*) as count FROM orders WHERE status != 'cancelled'"
    );
    const totalOrders = parseInt(orders.rows[0].count);
    const totalRevenue = parseFloat(revenue.rows[0].total);
    const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // Топ-товар: считаем по items JSON в заказах
    let topItem = '—';
    try {
      const allOrders = await pool.query(
        "SELECT items FROM orders WHERE status != 'cancelled' AND items IS NOT NULL"
      );
      const counts = {};
      for (const row of allOrders.rows) {
        try {
          const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
          if (Array.isArray(items)) {
            for (const item of items) {
              counts[item.name] = (counts[item.name] || 0) + (item.qty || 1);
            }
          }
        } catch {}
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) topItem = sorted[0][0];
    } catch {}

    res.json({ revenue: totalRevenue, totalOrders, avgCheck, topItem });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

// === ПОЛЬЗОВАТЕЛЬ: БАЛАНС ===
app.get('/api/user/:userId/balance', requireDB, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT bonus_balance FROM users WHERE telegram_id = $1',
      [req.params.userId]
    );
    res.json({ balance: result.rows[0]?.bonus_balance || 0 });
  } catch { res.status(500).json({ balance: 0 }); }
});

// === БОТ ===
bot.start(async (ctx) => {
  try {
    if (pool) {
      await pool.query(
        'INSERT INTO users (telegram_id, name, username) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING',
        [BigInt(ctx.from.id), ctx.from.first_name, ctx.from.username]
      );
    }
    const kb = {
      inline_keyboard: [[{ text: '🍽 Открыть Меню', web_app: { url: WEBAPP_URL } }]]
    };
    if (ctx.from.id === ADMIN_ID) {
      kb.inline_keyboard.push([{ text: '⚙️ Админка', web_app: { url: `${WEBAPP_URL}/admin` } }]);
    }
    await ctx.reply('Добро пожаловать в FoodHub! 🍔\nВыберите действие:', { reply_markup: kb });
  } catch (err) {
    console.error('Bot start error:', err);
  }
});

bot.catch(err => console.error('Bot error:', err));

// === ЗАПУСК ===
bot.launch();
app.listen(PORT, () => {
  console.log(`🚀 Server запущен на порту ${PORT}`);
  console.log(`🌐 URL: ${WEBAPP_URL}`);
});

process.on('SIGINT', () => { bot.stop('SIGINT'); process.exit(); });
process.on('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(); });
