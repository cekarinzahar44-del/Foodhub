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
    console.log('🔧 Проверяем тип user_id в orders...');
    
    // Проверяем текущий тип
    const check = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'orders' AND column_name = 'user_id'
    `);
    
    const currentType = check.rows[0]?.data_type;
    console.log(`📊 Текущий тип: ${currentType}`);
    
    if (currentType !== 'bigint') {
      console.log('🔄 Меняем на BIGINT...');
      await pool.query(`ALTER TABLE orders ALTER COLUMN user_id TYPE BIGINT`);
      console.log('✅ Тип изменён на BIGINT');
    } else {
      console.log('✅ Тип уже BIGINT, ничего менять не нужно');
    }
    
    // Проверяем users таблицу тоже
    const checkUsers = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'telegram_id'
    `);
    
    if (checkUsers.rows[0]?.data_type !== 'bigint') {
      console.log('🔄 Исправляем users.telegram_id...');
      await pool.query(`ALTER TABLE users ALTER COLUMN telegram_id TYPE BIGINT`);
      console.log('✅ users.telegram_id теперь BIGINT');
    }
    
    console.log('🎉 Миграция завершена!');
    
  } catch (err) {
    console.error('❌ Ошибка миграции:', err.message);
  } finally {
    await pool.end();
    process.exit();
  }
}

fixDatabase();
