require('dotenv').config();
const { Pool } = require('pg');

async function fixDatabase() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false
  });

  try {
    console.log('🔧 Изменяем тип user_id на BIGINT...');
    
    await pool.query(`
      ALTER TABLE orders 
      ALTER COLUMN user_id TYPE BIGINT;
    `);
    
    console.log('✅ Таблица orders успешно обновлена!');
    console.log('✅ Теперь user_id может хранить Telegram ID');
    
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
    process.exit();
  }
}

fixDatabase();
