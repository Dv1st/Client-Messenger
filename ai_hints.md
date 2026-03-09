# AI Hints — Client Messenger

**Версия:** 3.0.0  
**Последнее обновление:** 2026-03-09  
**Стек:** Vanilla JavaScript, WebSocket, HTML5, CSS3, localStorage

---

## 📁 Структура проекта

```
MessangerWeb/
├── index.html              # Основная разметка
├── app.js                  # Основная логика (WebSocket, авторизация, сообщения)
├── sidebar-component.js    # Компонент боковой панели
├── style.css               # Стили
├── server/
│   ├── server.js           # Серверная часть (Node.js + WebSocket)
│   ├── db.js               # База данных (PostgreSQL)
│   └── .env                # Переменные окружения
└── ai_hints.md             # Этот файл (подсказки для AI)
```

---

## 🔑 Глобальные переменные (app.js)

### Основные
```javascript
let socket = null;                    // WebSocket соединение
let currentUser = null;               // Текущий пользователь
let selectedUser = null;              // Выбранный собеседник
let selectedGroup = null;             // Выбранная группа
let users = [];                       // Массив пользователей
let groups = [];                      // Массив групп
let userProfile = null;               // Профиль текущего пользователя
let userBadges = [];                  // Значки пользователя
```

### Настройки приватности
```javascript
let isVisibleInDirectory = false;     // Отображать в поиске (по умолчанию FALSE)
let allowGroupInvite = false;         // Разрешить приглашения в группы (по умолчанию FALSE)
```

### Настройки приложения
```javascript
const STORAGE_KEYS = {
    USERS: 'messenger_users',
    SETTINGS: 'messenger_settings'
};

const WS_URL = 'wss://client-messenger-production.up.railway.app';
```

---

## 🎨 Система темизации (CSS Variables)

```css
:root {
    --window-bg: #0F0F1A;           /* Фон окна */
    --panel-bg: #16162A;            /* Фон панелей */
    --element-bg: #1F1B36;          /* Фон элементов */
    --element-bg-hover: #2A2645;    /* Фон при наведении */
    --accent: #7B2CBF;              /* Акцентный цвет (фиолетовый) */
    --accent-hover: #9D4EDD;        /* Акцент при наведении */
    --text-primary: #E0E0E0;        /* Основной текст */
    --text-secondary: #9494A8;      /* Вторичный текст */
    --text-muted: #6B6B7B;          /* Приглушённый текст */
    --error: #FF4B4B;               /* Ошибки */
    --success: #00C853;             /* Успех */
    --status-online: #2ecc71;       /* Статус: онлайн */
    --status-offline: #95a5a6;      /* Статус: офлайн */
    --status-in-chat: #3498db;      /* Статус: в чате */
}
```

---

## 📊 Структура данных

### Пользователь (users[])
```javascript
{
    name: string,                   // Имя пользователя (ID)
    status: 'online' | 'offline' | 'in_chat',
    activeChat: string | null,      // С кем сейчас в чате
    isVisibleInDirectory: boolean,  // Видим в поиске
    allowGroupInvite: boolean,      // Можно приглашать в группы
    isPinned: boolean,              // Закреплён ли чат
    devices: Map                    // Устройства пользователя
}
```

### Профиль (localStorage: `profile_${username}`)
```javascript
{
    avatarUrl: string,              // URL аватарки (data URL или http)
    customStatus: string,           // 'online' | 'offline' | 'busy' | 'away' | 'custom'
    statusMessage: string,          // Текстовое сообщение статуса
    badges: array                   // Массив значков
}
```

### Сообщение
```javascript
{
    sender: string,                 // Отправитель
    text: string,                   // Текст
    timestamp: number,              // Время (Date.now())
    encrypted: boolean,             // Зашифровано ли
    hint: string | null,            // Подсказка для ключа
    deliveryStatus: 'pending' | 'sent' | 'delivered',
    replyTo: { timestamp, sender, text } | null,
    files: array | null,            // Прикреплённые файлы
    reactions: object               // Реакции {emoji: [{userId, timestamp}]}
}
```

### Группа
```javascript
{
    id: string,                     // ID группы
    name: string,                   // Название
    creator: string,                // Создатель
    members: string[],              // Участники
    createdAt: number,              // Время создания
    lastMessage: string,            // Последнее сообщение
    lastMessageTime: number,        // Время последнего сообщения
    unreadCount: number             // Непрочитанные
}
```

---

## 🔧 Ключевые функции

### Авторизация
```javascript
initLogin()                       // Инициализация форм входа/регистрации
validateLoginForm()               // Валидация формы входа (real-time)
validateRegistrationForm()        // Валидация формы регистрации (real-time)
handleLogin()                     // Обработка входа
handleRegister()                  // Обработка регистрации
```

### WebSocket
```javascript
connectToServer(authMessage)      // Подключение к серверу
sendToServer(message)             // Отправка сообщения серверу
handleServerMessage(data)         // Обработка входящих сообщений
```

### Сообщения
```javascript
sendMessage()                     // Отправка сообщения
handleMessageReceive(data)        // Обработка входящего сообщения
addMessage(data, isOwn, scroll)   // Добавление сообщения в DOM
confirmMessageDelivery(timestamp) // Подтверждение доставки
cancelMessageDelivery(timestamp)  // Отмена по таймауту (5 сек)
queueMessage(message)             // Добавить в очередь
flushMessageQueue()               // Отправить очередь
```

### Профиль
```javascript
initProfile()                     // Инициализация системы профилей
openProfile(userId)               // Открыть профиль
saveProfileChanges()              // Сохранить изменения
saveUserStatus(status)            // Сохранить статус
saveAvatar(avatarUrl)             // Сохранить аватарку
updateAvatarDisplay(avatarUrl)    // Обновить отображение везде
```

### Значки (BADGES)
```javascript
const BADGES_CATALOG = {}         // Пустой, заполняется с сервера
getBadgeInfo(badgeId)             // Получить информацию о значке
getAvailableBadgeIds()            // Список всех ID
updateBadgeCatalogFromServer()    // Обновить с сервера
renderBadges(badges, isEditable)  // Отрисовка значков
```

### Настройки
```javascript
loadSettings()                    // Загрузка настроек (false по умолчанию)
saveSettings()                    // Сохранение настроек
initSettings()                    // Инициализация обработчиков
```

### Sidebar
```javascript
initSidebar()                     // Инициализация sidebar
updateFooterProfile()             // Обновить профиль в footer
window.renderChatsListData()      // Данные для списка чатов
window.getPublicUsersData()       // Данные для поиска (фильтр по чатам)
window.hasChatWithUser(username)  // Проверка наличия чата
```

---

## 🎯 Настройки приватности (ВАЖНО)

### По умолчанию ВСЕГДА FALSE
```javascript
// В loadSettings() при отсутствии сохранённых данных:
isVisibleInDirectory = false;     // Скрыт из поиска
allowGroupInvite = false;         // Запрет приглашений
```

### Влияние настроек
| Настройка | Влияет | НЕ влияет |
|-----------|--------|-----------|
| `isVisibleInDirectory` | Поиск для других пользователей | Существующие чаты |
| `allowGroupInvite` | Возможность добавить в группу | Личные сообщения |

---

## 🎨 Статусы пользователей

### Типы статусов
```javascript
const statusMap = {
    'online': { text: 'Онлайн', class: 'online', color: 'var(--status-online)', icon: '🟢' },
    'offline': { text: 'Офлайн', class: 'offline', color: 'var(--status-offline)', icon: '⚫' },
    'busy': { text: 'Не беспокоить', class: 'busy', color: 'var(--error)', icon: '🔴' },
    'away': { text: 'Отошёл', class: 'away', color: 'var(--warning)', icon: '🟡' },
    'custom': { text: 'Свой статус', class: 'custom', color: 'var(--text-secondary)', icon: '✏️' }
};
```

### Системный vs Пользовательский статус
| Тип | Поле | Кто устанавливает |
|-----|------|-------------------|
| Системный | `user.status` | Сервер (автоматически) |
| Пользовательский | `profile.customStatus` | Пользователь (вручную) |

---

## 🖼️ Аватарки

### Единый источник
```javascript
// localStorage: profile_${username}
{
    avatarUrl: string  // Data URL или http(s) URL
}

// Функция getUserAvatar(username) возвращает:
// 1. avatarUrl из localStorage
// 2. Пустую строку если нет (CSS показывает градиент с инициалами)
```

### Валидация при загрузке
- Максимальный размер: **2MB**
- Форматы: **PNG, JPG, JPEG**
- Проверка: `file.type in ['image/png', 'image/jpeg', 'image/jpg']`

### Отображение
Аватарка отображается в:
1. Профиле пользователя (`#profileAvatar`)
2. Списке чатов (`.chat-item-avatar`)
3. Поиске (`.search-result-avatar`)
4. Footer sidebar (`#footerUserAvatar`)

---

## 🔒 Безопасность

### XSS защита
```javascript
escapeHtml(str)           // Экранирование HTML-символов
sanitizeMessageText(text) // Очистка текста сообщения
```

### Валидация
```javascript
isValidUsername(username) // 3-20 символов, латиница/цифры/_
isValidPassword(password) // 8-100 символов
```

### Проверка прав
- Нельзя изменить чужой профиль (`isOwnProfile = userId === currentUser`)
- Нельзя загрузить аватарку другому пользователю
- Нельзя добавить в группу без `allowGroupInvite`

---

## 📡 WebSocket сообщения

### Клиент → Сервер
```javascript
{ type: 'login', username, password }
{ type: 'register', username, password }
{ type: 'send_message', text, privateTo, timestamp }
{ type: 'send_group_message', text, groupId, timestamp }
{ type: 'update_visibility', isVisible }
{ type: 'update_group_invite_permission', allow }
{ type: 'update_profile', avatar }
{ type: 'update_user_status', status }
{ type: 'update_badges', badges }
{ type: 'message_read', from, timestamp }
{ type: 'delete_message', timestamp }
{ type: 'message_reaction', timestamp, reaction }
```

### Сервер → Клиент
```javascript
{ type: 'login_success', username, token, deviceId }
{ type: 'register_success', username, token, deviceId }
{ type: 'user_list', users: [] }
{ type: 'user_online', username }
{ type: 'user_offline', username }
{ type: 'user_status_update', username, status }
{ type: 'receive_message', sender, text, timestamp }
{ type: 'message_confirmed', timestamp, confirmed }
{ type: 'group_list', groups: [] }
{ type: 'group_created', group }
```

---

## 🎯 Критические точки

### 1. Доставка сообщений
- Статус `pending` → показывается ⏳
- Таймаут 5 секунд → `cancelMessageDelivery()` → показывается ⚠️
- Подтверждение от сервера → `confirmMessageDelivery()` → показывается ✓

### 2. Очередь сообщений
```javascript
let messageQueue = [];
let isReconnecting = false;

// При разрыве соединения:
sendToServer() → queueMessage()  // Добавляет в очередь

// При переподключении:
socket.onopen → flushMessageQueue()  // Отправляет очередь
```

### 3. Поиск пользователей
```javascript
window.getPublicUsersData() {
    // Фильтры:
    1. Исключить текущего пользователя
    2. isVisibleInDirectory !== false
    3. Исключить пользователей с активным чатом (localStorage)
}
```

### 4. Создание группы
```javascript
renderGroupMembersSelect() {
    // Показывать только:
    1. activeChat === currentUser ИЛИ
    2. Есть история переписки в localStorage
}
```

---

## 📝 Шаблоны промтов для AI

### Добавление новой функции
```
ТЫ — ОПЫТНЫЙ FULL-STACK РАЗРАБОТЧИК. Добавь [функция] в проект Client-Messenger.

ТРЕБОВАНИЯ:
1. [требование 1]
2. [требование 2]

СТРУКТУРА:
- app.js — [что добавить]
- index.html — [что изменить]
- style.css — [что стилизовать]

СОХРАНЯЙ:
- Существующие имена переменных
- Стиль кода (JSDoc комментарии)
- Безопасность (escapeHtml, валидация)
```

### Исправление бага
```
ТЫ — ОПЫТНЫЙ FULL-STACK РАЗРАБОТЧИК. Исправь баг в Client-Messenger.

ПРОБЛЕМА: [описание]

ОЖИДАЕМОЕ ПОВЕДЕНИЕ: [что должно быть]

ФАЙЛЫ:
- [файл 1]
- [файл 2]

ПРОВЕРКИ:
- [ ] Синтаксис node --check
- [ ] Не ломает существующую функциональность
```

---

## 🔧 Отладка

### Консольные сообщения
```
✅  — Успех
❌  — Ошибка
⚠️  — Предупреждение
🔒  — Безопасность
🔧  — Исправление
📤  — Отправка
📩  — Получение
📭  — Очередь
🔌  — WebSocket
```

### Логирование
```javascript
console.log('✅ Connected to', WS_URL);
console.log('📤 Sending message:', { to, text, timestamp });
console.log('📩 Received message from:', sender);
console.log('⚠️ WebSocket not ready, queueing message');
```

---

## 📚 Полезные ссылки

### localStorage ключи
```
messenger_users               // Пользователи
messenger_settings            // Настройки
profile_${username}           // Профиль пользователя
chat_messages_${user1}_${user2}  // Переписка
group_messages_${groupId}     // Сообщения группы
active_chats_${username}      // Активные чаты
```

### DOM элементы (кэшируются в DOM объекте)
```javascript
// Авторизация
#loginWindow, #chatWindow, #loginBtn, #registerBtn

// Sidebar
#sidebar, #searchBox, #chatsList, #searchResultsList

// Чат
#messagesList, #messageBox, #sendBtn, #chatTitle

// Профиль
#profileModal, #profileAvatar, #editProfileBtn

// Настройки
#settingsModal, #showInDirectory, #allowGroupInvite

// Footer
#footerUserName, #footerUserAvatar, #footerSettingsBtn
```

---

## ✅ Чеклист перед коммитом

### 🔍 Базовые проверки
- [ ] Синтаксис: `node --check app.js`
- [ ] Валидация форм работает
- [ ] Настройки приватности = false по умолчанию
- [ ] Аватарки единые везде
- [ ] Поиск не дублирует чаты
- [ ] Сообщения доставляются (нет ⏳ более 5 сек)
- [ ] Статусы обновляются в реальном времени
- [ ] Нельзя изменить чужой профиль

### 🔒 Безопасность
- [ ] Все пользовательские данные экранированы (`escapeHtml()`)
- [ ] Валидация входных данных (`isValidUsername()`, `isValidPassword()`)
- [ ] Проверка прав доступа перед изменением данных
- [ ] Нет передачи чувствительных данных в localStorage
- [ ] CORS настроен корректно (сервер)
- [ ] Rate limiting для авторизации (сервер)
- [ ] Валидация типов файлов (аватарки ≤ 2MB, PNG/JPG)
- [ ] Санитизация сообщений (`sanitizeMessageText()`)
- [ ] Нет `eval()`, `innerHTML` с пользовательскими данными
- [ ] WebSocket сообщения валидируются на сервере

### ⚡ Оптимизация
- [ ] DOM элементы кэшированы (не искать каждый раз)
- [ ] Debounce для частых операций (поиск, ввод текста)
- [ ] Ленивая загрузка (сообщения чата при открытии)
- [ ] Очередь сообщений при разрыве соединения
- [ ] Нет утечек памяти (отписка от событий, очистка таймеров)
- [ ] Минимальное количество перерисовок DOM (batch updates)
- [ ] CSS-анимации вместо JS (transform, opacity)
- [ ] Изображения оптимизированы (сжатие, правильный формат)
- [ ] localStorage используется разумно (очистка старых данных)
- [ ] WebSocket переподключение с экспоненциальной задержкой

### 🧹 Качество кода
- [ ] Код соответствует существующему стилю проекта
- [ ] Имена переменных понятные, на английском
- [ ] JSDoc комментарии для ключевых функций
- [ ] Нет закомментированного мертвого кода
- [ ] Нет `console.log()` в продакшене (кроме отладки)
- [ ] Обработка ошибок (try/catch, graceful degradation)
- [ ] DRY: нет дублирования логики
- [ ] Функции делают одну вещь (Single Responsibility)
- [ ] Нет магических чисел (вынести в константы)

### 🧪 Тестирование
- [ ] Проверен основной сценарий использования
- [ ] Проверены граничные случаи (пустые данные, длинные строки)
- [ ] Проверена работа при отсутствии сети
- [ ] Проверена работа в разных браузерах
- [ ] Нет ошибок в консоли браузера
- [ ] Серверная логика проверена (если изменения)
