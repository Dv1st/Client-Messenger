-- ============================================================================
-- SQL Миграция для обновления базы данных Client Messenger
-- Версия: 2.0.0
-- Дата: 2026-03-09
-- Описание: Добавление user_id, бейджиков и дополнительных полей профиля
-- ============================================================================

-- 🔴 ВАЖНО: Сделайте бэкап базы данных перед применением миграции!
-- pg_dump -U your_user -d your_database > backup_$(date +%Y%m%d).sql

-- ============================================================================
-- 1. Добавление user_id SERIAL PRIMARY KEY
-- ============================================================================

-- Проверяем существует ли колонка user_id
DO $$
BEGIN
    -- Если колонка user_id не существует, добавляем её
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'user_id'
    ) THEN
        -- Добавляем временную последовательность для генерации ID
        ALTER TABLE users ADD COLUMN user_id SERIAL;
        
        -- Заполняем существующие записи последовательными ID
        WITH numbered_users AS (
            SELECT username, ROW_NUMBER() OVER (ORDER BY created_at ASC) as new_id
            FROM users
        )
        UPDATE users u
        SET user_id = nu.new_id
        FROM numbered_users nu
        WHERE u.username = nu.username;
        
        -- Устанавливаем user_id как PRIMARY KEY
        ALTER TABLE users ADD PRIMARY KEY (user_id);
        
        -- Делаем username UNIQUE
        ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
        
        RAISE NOTICE '✅ user_id added and populated successfully';
    ELSE
        RAISE NOTICE 'ℹ️ user_id already exists';
    END IF;
END $$;

-- ============================================================================
-- 2. Добавление полей для бейджиков и профиля
-- ============================================================================

-- user_badges для хранения бейджиков пользователя (JSONB)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS user_badges JSONB DEFAULT '[]'::jsonb;

-- custom_status для пользовательского статуса
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS custom_status TEXT;

-- avatar для URL аватарки
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS avatar TEXT;

-- ============================================================================
-- 3. Обновление существующих данных
-- ============================================================================

-- Устанавливаем пустой массив для всех существующих пользователей
-- (бейджики выдаются только через админ-команды)
UPDATE users 
SET user_badges = '[]'::jsonb 
WHERE user_badges IS NULL;

-- ============================================================================
-- 4. Создание индексов для производительности
-- ============================================================================

-- Индекс для поиска по user_id (если не создан автоматически)
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- Индекс для поиска по username
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Индекс для видимых пользователей в каталоге
CREATE INDEX IF NOT EXISTS idx_users_visible 
ON users(is_visible_in_directory) 
WHERE is_visible_in_directory = TRUE;

-- ============================================================================
-- 5. Проверка результатов
-- ============================================================================

-- Вывод информации о таблице
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Вывод количества пользователей
SELECT COUNT(*) as total_users FROM users;

-- Пример первых пользователей
SELECT user_id, username, created_at, user_badges 
FROM users 
ORDER BY user_id 
LIMIT 5;

-- ============================================================================
-- 6. Функции для администрирования бейджиков
-- ============================================================================

-- Функция для добавления бейджика пользователю по username
CREATE OR REPLACE FUNCTION add_badge_to_user(
    p_username TEXT,
    p_badge_id TEXT,
    p_visible BOOLEAN DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
    v_user_id INTEGER;
    v_current_badges JSONB;
    v_new_badges JSONB;
    v_existing_index INTEGER;
BEGIN
    -- Получаем user_id
    SELECT user_id, user_badges INTO v_user_id, v_current_badges
    FROM users
    WHERE username = p_username;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Пользователь "%" не найден', p_username;
    END IF;
    
    v_current_badges := COALESCE(v_current_badges, '[]'::jsonb);
    
    -- Проверяем существует ли уже такой бейджик
    SELECT (elem->>'id')::TEXT
    INTO v_existing_index
    FROM jsonb_array_elements(v_current_badges) WITH ORDINALITY AS t(elem, idx)
    WHERE elem->>'id' = p_badge_id;
    
    IF v_existing_index IS NOT NULL THEN
        -- Обновляем видимость существующего бейджика
        v_new_badges := (
            SELECT jsonb_agg(
                CASE 
                    WHEN elem->>'id' = p_badge_id THEN jsonb_set(elem, '{visible}', to_jsonb(p_visible))
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(v_current_badges) AS elem
        );
    ELSE
        -- Добавляем новый бейджик
        v_new_badges := v_current_badges || jsonb_build_array(
            jsonb_build_object('id', p_badge_id, 'visible', p_visible)
        );
    END IF;
    
    -- Обновляем запись
    UPDATE users
    SET user_badges = v_new_badges
    WHERE username = p_username;
    
    RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql;

-- Функция для удаления бейджика у пользователя
CREATE OR REPLACE FUNCTION remove_badge_from_user(
    p_username TEXT,
    p_badge_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_user_id INTEGER;
    v_current_badges JSONB;
    v_new_badges JSONB;
BEGIN
    -- Получаем user_id
    SELECT user_id, user_badges INTO v_user_id, v_current_badges
    FROM users
    WHERE username = p_username;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Пользователь "%" не найден', p_username;
    END IF;
    
    v_current_badges := COALESCE(v_current_badges, '[]'::jsonb);
    
    -- Удаляем бейджик
    SELECT jsonb_agg(elem)
    INTO v_new_badges
    FROM jsonb_array_elements(v_current_badges) AS elem
    WHERE elem->>'id' != p_badge_id;
    
    v_new_badges := COALESCE(v_new_badges, '[]'::jsonb);
    
    -- Обновляем запись
    UPDATE users
    SET user_badges = v_new_badges
    WHERE username = p_username;
    
    RETURN v_new_badges;
END;
$$ LANGUAGE plpgsql;

-- Функция для получения бейджиков пользователя
CREATE OR REPLACE FUNCTION get_user_badges(p_username TEXT)
RETURNS JSONB AS $$
DECLARE
    v_badges JSONB;
BEGIN
    SELECT user_badges INTO v_badges
    FROM users
    WHERE username = p_username;
    
    RETURN COALESCE(v_badges, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Примеры использования
-- ============================================================================

-- Пример 1: Добавить бейджик "premium" пользователю "alex"
-- SELECT add_badge_to_user('alex', 'premium', TRUE);

-- Пример 2: Добавить бейджик "moderator" пользователю "john"
-- SELECT add_badge_to_user('john', 'moderator', TRUE);

-- Пример 3: Удалить бейджик "premium" у пользователя "alex"
-- SELECT remove_badge_from_user('alex', 'premium');

-- Пример 4: Получить бейджики пользователя "alex"
-- SELECT get_user_badges('alex');

-- Пример 5: Посмотреть всех пользователей с их бейджиками
-- SELECT username, user_badges FROM users ORDER BY user_id;

-- ============================================================================
-- Конец миграции
-- ============================================================================
