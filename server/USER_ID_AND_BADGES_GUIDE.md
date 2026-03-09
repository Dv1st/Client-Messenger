# 🆔 Система персональных ID и хначков

## Обзор

Система предоставляет каждому пользователю мессенджера уникальный числовой `user_id`, который:
- Генерируется автоматически при регистрации
- Хранится в базе данных PostgreSQL
- Может использоваться для поиска пользователя
- Связан с системой хначков (achievements/badges)

## 🔐 Хначки (Achievements)

**Важно:** У новых пользователей по умолчанию **нет доступных хначков**. Хначки могут быть выданы только через прямое обновление базы данных.

## 📋 Структура базы данных

### Таблица `users`

```sql
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,           -- Уникальный ID (автоинкремент)
    username TEXT UNIQUE NOT NULL,        -- Имя пользователя
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at BIGINT,
    last_login BIGINT,
    is_visible_in_directory BOOLEAN DEFAULT FALSE,
    allow_group_invite BOOLEAN DEFAULT FALSE,
    two_factor_secret TEXT,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_backup_codes TEXT,
    user_badges JSONB DEFAULT '[]'::jsonb -- Массив выданных хначков
);
```

## 🚀 Использование

### WebSocket команды

#### 1. Поиск пользователя по ID

```javascript
ws.send(JSON.stringify({
    type: 'get_user_by_id',
    userId: 123  // Искомый user_id
}));
```

**Ответ:**
```javascript
{
    type: 'user_found',
    user: {
        userId: 123,
        username: "username",
        status: "online",
        isVisibleInDirectory: true,
        userBadges: ["active", "premium"]
    }
}
```

Или если не найден:
```javascript
{
    type: 'user_not_found',
    message: 'Пользователь с таким ID не найден'
}
```

#### 2. Получение информации о своём профиле

```javascript
ws.send(JSON.stringify({
    type: 'get_my_profile'
}));
```

**Ответ:**
```javascript
{
    type: 'my_profile',
    profile: {
        userId: 123,
        username: "username",
        status: "online",
        isVisibleInDirectory: true,
        allowGroupInvite: false,
        userBadges: ["active", "premium"],
        twoFactorEnabled: true
    }
}
```

#### 3. Информация о выдаче хначков

```javascript
ws.send(JSON.stringify({
    type: 'add_badge',
    targetUserId: 123,
    badgeId: "premium"
}));
```

**Ответ:**
```javascript
{
    type: 'badge_admin_info',
    message: 'Выдача хначков осуществляется только через прямое обновление базы данных',
    instructions: [
        'Используйте SQL запрос:',
        'UPDATE users SET user_badges = user_badges || \'"premium"\'::jsonb WHERE user_id = 123;',
        'Или через функцию addUserBadge в db.js'
    ]
}
```

## 🔧 Администрирование хначков

### Способ 1: Прямой SQL запрос

```sql
-- Выдать хначок пользователю
UPDATE users 
SET user_badges = user_badges || '"badge_id"'::jsonb 
WHERE user_id = 123;

-- Пример: выдать хначок "premium"
UPDATE users 
SET user_badges = user_badges || '"premium"'::jsonb 
WHERE user_id = 1;
```

### Способ 2: Через функцию в db.js

```javascript
const db = require('./db');

// Выдать хначок
await db.addUserBadge(123, 'premium');

// Удалить хначок
await db.removeUserBadge(123, 'premium');
```

### Способ 3: Массовая выдача

```sql
-- Установить конкретный набор хначков
UPDATE users 
SET user_badges = '["active", "premium", "verified"]'::jsonb 
WHERE user_id = 123;

-- Очистить все хначки
UPDATE users 
SET user_badges = '[]'::jsonb 
WHERE user_id = 123;
```

## 🏅 Каталог хначков

Доступные хначки определены в `server.js`:

| ID | Иконка | Название | Описание |
|----|--------|----------|----------|
| `active` | 🏆 | Активный | За активность в чате |
| `premium` | ⭐ | Премиум | Премиум подписка |
| `moderator` | 🛡️ | Модератор | Модератор чата |
| `vip` | 💎 | VIP | VIP статус |
| `verified` | 🎯 | Верифицирован | Подтверждённый пользователь |
| `designer` | 🎨 | Дизайнер | Дизайнер |
| `developer` | 💻 | Разработчик | Разработчик |
| `music` | 🎵 | Музыкальный | Любитель музыки |
| `fire` | 🔥 | Огонь | ПИРОМАНТ!!! |
| `diamond` | 💠 | Кристалл | Алмаз, как дела? |
| `crown` | 👑 | Корона | Queneeee |
| `heart` | ❤️ | Сердце | Любимчик |
| `star` | 🌟 | Звезда | Путеводная звезда |
| `trophy` | 🏅 | Трофей | Победитель |
| `medal` | 🎖️ | Медаль | Что-то сделал |
| `sparkles` | ✨ | Сияние | Спар-р-р-рки?! |
| `alien` | 👽 | Пришелец | Консультант ДНС |
| `robot` | 🤖 | Робот | Автоматизатор |
| `ghost` | 👻 | Призрак | Невидимка |
| `panda` | 🐼 | Панда | Няфка 👉 👈 |
| `tiger` | 🐯 | Тигр | ТЫГРЫЩЕ |
| `sun` | ☀️ | Солнце | Ослепительно |
| `moon` | 🌙 | Луна | Ночной житель |

## 📡 Ответы сервера

### При регистрации

```javascript
{
    type: 'register_success',
    username: "username",
    userId: 123,              // Новый уникальный ID
    deviceId: "device_xxx",
    token: "xxx",
    isVisibleInDirectory: false,
    message: 'Регистрация успешна! Выполнен вход в аккаунт.'
}
```

### При входе

```javascript
{
    type: 'login_success',
    username: "username",
    userId: 123,              // Ваш уникальный ID
    deviceId: "device_xxx",
    token: "xxx",
    isVisibleInDirectory: true,
    allowGroupInvite: false,
    userBadges: ["active", "premium"],  // Ваши хначки
    message: 'Вход выполнен успешно'
}
```

## 🔍 Примеры использования

### Пример 1: Поиск друга по ID

```javascript
// Отправка запроса
ws.send(JSON.stringify({
    type: 'get_user_by_id',
    userId: 42
}));

// Обработка ответа
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'user_found') {
        console.log(`Найден пользователь: ${msg.user.username}`);
        console.log(`ID: ${msg.user.userId}`);
        console.log(`Статус: ${msg.user.status}`);
        console.log(`Хначки: ${msg.user.userBadges.join(', ')}`);
    } else if (msg.type === 'user_not_found') {
        console.log('Пользователь не найден');
    }
};
```

### Пример 2: Отображение своего профиля

```javascript
// Запрос информации о профиле
ws.send(JSON.stringify({
    type: 'get_my_profile'
}));

// Обработка
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'my_profile') {
        const profile = msg.profile;
        console.log(`Мой ID: ${profile.userId}`);
        console.log(`Имя: ${profile.username}`);
        console.log(`Хначки: ${profile.userBadges.length}`);
        
        // Отображение хначков
        profile.userBadges.forEach(badgeId => {
            const badge = EMOJI_BADGES_CATALOG[badgeId];
            console.log(`  ${badge.icon} ${badge.name}`);
        });
    }
};
```

## 🛠️ Миграция существующей базы

Если у вас уже есть база данных с таблицей `users`, выполните миграцию:

```sql
-- 1. Добавить колонку user_id
ALTER TABLE users 
ADD COLUMN user_id SERIAL,
ADD COLUMN user_badges JSONB DEFAULT '[]'::jsonb;

-- 2. Установить user_id для существующих записей
-- (автоматически заполнится при первом обновлении)

-- 3. Сделать user_id PRIMARY KEY
-- Сначала нужно удалить старый PRIMARY KEY с username
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE users ADD PRIMARY KEY (user_id);

-- 4. Создать уникальный индекс на username
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 5. Создать индекс для поиска по user_id
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
```

## 🔒 Безопасность

- `user_id` является публичным идентификатором
- Хначки хранятся в базе данных и не могут быть изменены клиентом
- Выдача хначков требует прямого доступа к базе данных
- Все запросы параметризованы для защиты от SQL-инъекций

## 📝 Заметки

- `user_id` генерируется автоматически как `SERIAL` (автоинкремент)
- У новых пользователей пустой массив хначков: `userBadges: []`
- Хначки можно просматривать через каталог командой `get_badge_catalog`
- Для отображения хначков на клиенте используйте `EMOJI_BADGES_CATALOG`
