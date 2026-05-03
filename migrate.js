require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false
  });

  try {
    console.log('🔧 Изменяю тип user_id на BIGINT...');
    
    await pool.query(`
      ALTER TABLE orders 
      ALTER COLUMN user_id TYPE BIGINT
    `);
    
    console.log('✅ orders.user_id изменён на BIGINT');
    
    await pool.query(`
      ALTER TABLE users 
      ALTER COLUMN telegram_id TYPE BIGINT
    `);
    
    console.log('✅ users.telegram_id изменён на BIGINT');
    console.log('🎉 Миграция завершена! Оплата должна работать.');
    
  } catch (err) {
    console.error('❌ Ошибка миграции:', err.message);
    console.error('Код ошибки:', err.code);
  } finally {
    await pool.end();
    process.exit();
  }
}

migrate();
