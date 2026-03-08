/**
 * PostgreSQL подключение для Railway
 * @see https://docs.railway.app/databases/postgresql
 * 
 * 🔒 SECURITY: Все запросы параметризованы для защиты от SQL-инъекций
 */

const { Pool } = require('pg');

// 🔒 Проверка наличия DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set!');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Ограничение количества соединений
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // SSL конфигурация для Railway
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Обработка ошибок пула
pool.on('error', (err) => {
  console.error('❌ Unexpected pool error:', err);
});

/**
 * Инициализация таблиц БД
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Таблица пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at BIGINT,
        last_login BIGINT,
        is_visible_in_directory BOOLEAN DEFAULT FALSE,
        allow_group_invite BOOLEAN DEFAULT FALSE,
        two_factor_secret TEXT,
        two_factor_enabled BOOLEAN DEFAULT FALSE,
        two_factor_backup_codes TEXT
      )
    `);

    // Таблица групп
    await client.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator TEXT NOT NULL,
        created_at BIGINT,
        last_message BIGINT
      )
    `);

    // Таблица участников групп
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        username TEXT NOT NULL,
        PRIMARY KEY (group_id, username),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      )
    `);

    // Индексы для производительности
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_group_members_group_id 
      ON group_members(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_group_members_username 
      ON group_members(username)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_visible 
      ON users(is_visible_in_directory) 
      WHERE is_visible_in_directory = TRUE
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Загрузка всех пользователей
 * @returns {Promise<Array>}
 */
async function getAllUsers() {
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}

/**
 * Сохранение пользователя
 * 🔒 Параметризованный запрос для защиты от SQL-инъекций
 */
async function saveUser(username, userData) {
  await pool.query(
    `INSERT INTO users 
     (username, password_hash, salt, created_at, last_login, 
      is_visible_in_directory, allow_group_invite, 
      two_factor_secret, two_factor_enabled, two_factor_backup_codes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       salt = EXCLUDED.salt,
       last_login = EXCLUDED.last_login,
       is_visible_in_directory = EXCLUDED.is_visible_in_directory,
       allow_group_invite = EXCLUDED.allow_group_invite,
       two_factor_secret = EXCLUDED.two_factor_secret,
       two_factor_enabled = EXCLUDED.two_factor_enabled,
       two_factor_backup_codes = EXCLUDED.two_factor_backup_codes`,
    [
      username,
      userData.passwordHash,
      userData.salt,
      userData.createdAt,
      userData.lastLogin || null,
      userData.isVisibleInDirectory || false,
      userData.allowGroupInvite || false,
      userData.twoFactorSecret || null,
      userData.twoFactorEnabled || false,
      userData.twoFactorBackupCodes || null
    ]
  );
}

/**
 * Загрузка всех групп
 * @returns {Promise<Array>}
 */
async function getAllGroups() {
  const result = await pool.query('SELECT * FROM groups ORDER BY last_message DESC NULLS LAST');
  return result.rows;
}

/**
 * Загрузка участников группы
 * @param {string} groupId
 * @returns {Promise<Array>}
 */
async function getGroupMembers(groupId) {
  const result = await pool.query(
    'SELECT username FROM group_members WHERE group_id = $1',
    [groupId]
  );
  return result.rows;
}

/**
 * Сохранение группы
 * 🔒 Параметризованный запрос
 */
async function saveGroup(group) {
  await pool.query(
    `INSERT INTO groups (id, name, creator, created_at, last_message)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       creator = EXCLUDED.creator,
       created_at = EXCLUDED.created_at,
       last_message = EXCLUDED.last_message`,
    [
      group.id,
      group.name,
      group.creator,
      group.createdAt,
      group.lastMessage || null
    ]
  );
}

/**
 * Сохранение участников группы
 * 🔒 Используем unnest для эффективной批量 вставки
 */
async function saveGroupMembers(groupId, members) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
    
    if (members.length > 0) {
      // Эффективная вставка через unnest
      await client.query(
        `INSERT INTO group_members (group_id, username)
         SELECT $1, unnest($2::text[])`,
        [groupId, members]
      );
    }
    
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Удаление группы
 */
async function deleteGroup(groupId) {
  await pool.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
  await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
}

/**
 * Проверка подключения к БД
 */
async function testConnection() {
  try {
    await pool.query('SELECT NOW()');
    return true;
  } catch (err) {
    console.error('❌ Database connection test failed:', err);
    return false;
  }
}

module.exports = {
  pool,
  initializeDatabase,
  getAllUsers,
  saveUser,
  getAllGroups,
  getGroupMembers,
  saveGroup,
  saveGroupMembers,
  deleteGroup,
  testConnection
};
