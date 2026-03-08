# 🏅 Система значков (Badges System)

## Как добавить новый значок

### 1. Откройте файл `app.js`

Найдите объект `BADGES_CATALOG` (примерно строка 4355):

```javascript
const BADGES_CATALOG = {
    'active':        { icon: '🏆', name: 'Активный', description: 'За активность в чате' },
    'premium':       { icon: '⭐', name: 'Премиум', description: 'Премиум подписка' },
    'moderator':     { icon: '🛡️', name: 'Модератор', description: 'Модератор чата' },
    // ... другие значки
};
```

### 2. Добавьте новый значок

Просто добавьте новую строку в формате:

```javascript
'уникальный_id': { icon: '🆕', name: 'Название', description: 'Описание значка' },
```

**Пример:**
```javascript
'early_adopter': { icon: '🚀', name: 'Первопроходец', description: 'Один из первых пользователей' },
'chat_master':   { icon: '💬', name: 'Мастер чата', description: 'За 1000 сообщений' },
'night_owl':     { icon: '🦉', name: 'Сова', description: 'Активен по ночам' },
```

### 3. Сохраните файл

Новый значок автоматически появится:
- ✅ В списке доступных значков в профиле
- ✅ В режиме редактирования профиля
- ✅ Будет сохраняться в базу данных при выборе

---

## Структура значка

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор (латиница, нижнее подчёркивание) |
| `icon` | string | Emoji или символ для отображения |
| `name` | string | Отображаемое название |
| `description` | string | Подсказка при наведении |

---

## Как это работает

### Хранение данных

**В базе данных (PostgreSQL):**
```json
{
  "username": "tester",
  "user_badges": [
    {"id": "active", "visible": true},
    {"id": "developer", "visible": true}
  ]
}
```

**В localStorage (клиент):**
```javascript
// Ключ: user_badges_tester
[
  {"id": "active", "visible": true},
  {"id": "developer", "visible": true}
]
```

### По умолчанию

- 🔹 **У новых пользователей НЕТ значков** (пустой массив)
- 🔹 Значки не выдаются автоматически
- 🔹 Администратор может выдать значки через панель управления (в разработке)

---

## API для работы со значками

### Получить все доступные ID
```javascript
const badgeIds = getAvailableBadgeIds();
// ['active', 'premium', 'moderator', ...]
```

### Получить информацию о значке
```javascript
const badge = getBadgeInfo('active');
// { icon: '🏆', name: 'Активный', description: 'За активность в чате' }
```

### Выдать значок пользователю (программно)
```javascript
// Добавить значок пользователю
userBadges.push({ id: 'early_adopter', visible: true });

// Сохранить в localStorage
saveUserProfile();

// Отправить на сервер
sendToServer({
    type: 'update_badges',
    badges: userBadges
});
```

---

## Примеры использования

### Выдать значок за достижение
```javascript
function awardBadge(username, badgeId) {
    // Проверка, нет ли уже значка
    const hasBadge = userBadges.some(b => b.id === badgeId);
    if (hasBadge) return;
    
    // Добавляем значок
    userBadges.push({ id: badgeId, visible: true });
    
    // Сохраняем
    saveUserProfile();
    sendToServer({ type: 'update_badges', badges: userBadges });
    
    // Показываем уведомление
    showNotification(`🎉 Вы получили значок "${getBadgeInfo(badgeId).name}"!`);
}
```

### Скрыть значок
```javascript
function hideBadge(badgeId) {
    const badge = userBadges.find(b => b.id === badgeId);
    if (badge) {
        badge.visible = false;
        saveUserProfile();
        sendToServer({ type: 'update_badges', badges: userBadges });
    }
}
```

---

## Советы

1. **Уникальные ID**: Убедитесь, что каждый значок имеет уникальный `id`
2. **Emoji**: Используйте стандартные emoji для кроссплатформенной совместимости
3. **Описания**: Пишите краткие описания (1-5 слов)
4. **Тестирование**: После добавления проверьте значок в профиле

---

## Будущие улучшения

- [ ] Панель администратора для выдачи значков
- [ ] Автоматическая выдача за достижения
- [ ] Ограничение на количество видимых значков (например, макс. 3)
- [ ] Анимация при получении нового значка
