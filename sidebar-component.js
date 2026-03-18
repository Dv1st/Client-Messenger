/**
 * SidebarComponent - Компонент боковой панели мессенджера
 * @version 1.0.0
 * @description Боковая панель с поиском, списком чатов и глобальным каталогом пользователей
 *
 * ИНТЕГРАЦИЯ С APP.JS:
 * - Использует реальные данные из app.js (users, groups, currentUser)
 */

'use strict';

// ============================================================================
// 🔹 SidebarComponent Class
// ============================================================================
class SidebarComponent {
    constructor(options = {}) {
        // DOM элементы
        this.dom = {
            sidebar: null,
            searchBox: null,
            searchClearBtn: null,
            searchResultsContainer: null,
            searchResultsList: null,
            chatsContainer: null,
            chatsList: null,
            footerUserName: null,
            footerUserStatusIndicator: null,
            footerUserInitials: null,
            footerUserAvatar: null,
            footerSettingsBtn: null,
            footerProfileCard: null,
            createGroupBtn: null
        };

        // Состояние
        this.state = {
            currentUser: options.currentUser || null,
            chats: [],
            isSearchFocused: false,
            searchQuery: '',
            selectedChatId: null
        };

        // Callbacks
        this.callbacks = {
            onChatSelect: options.onChatSelect || null,
            onUserStartChat: options.onUserStartChat || null,
            onSettingsClick: options.onSettingsClick || null,
            onProfileClick: options.onProfileClick || null,
            onCreateGroup: options.onCreateGroup || null
        };

        // Инициализация
        this.init();
    }

    // ============================================================================
    // 🔹 Инициализация
    // ============================================================================
    init() {
        this.cacheDOM();
        this.bindEvents();
        this.render();
    }

    /**
     * Кэширование DOM элементов
     */
    cacheDOM() {
        this.dom.sidebar = document.getElementById('sidebar');
        this.dom.searchBox = document.getElementById('searchBox');
        this.dom.searchClearBtn = document.getElementById('searchClearBtn');
        this.dom.searchResultsContainer = document.getElementById('searchResultsContainer');
        this.dom.searchResultsList = document.getElementById('searchResultsList');
        this.dom.chatsContainer = document.getElementById('chatsContainer');
        this.dom.chatsList = document.getElementById('chatsList');
        this.dom.footerUserName = document.getElementById('footerUserName');
        this.dom.footerUserStatusIndicator = document.getElementById('footerUserStatusIndicator');
        this.dom.footerUserInitials = document.getElementById('footerUserInitials');
        this.dom.footerUserAvatar = document.getElementById('footerUserAvatar');
        this.dom.footerSettingsBtn = document.getElementById('footerSettingsBtn');
        this.dom.footerProfileCard = document.getElementById('footerProfileCard');
        this.dom.createGroupBtn = document.getElementById('createGroupBtn');
    }

    /**
     * Привязка событий
     */
    bindEvents() {
        // Поиск
        if (this.dom.searchBox) {
            this.dom.searchBox.addEventListener('focus', () => this.handleSearchFocus());
            this.dom.searchBox.addEventListener('blur', () => this.handleSearchBlur());
            this.dom.searchBox.addEventListener('input', (e) => this.handleSearchInput(e));
            this.dom.searchBox.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
        }

        // Кнопка очистки поиска
        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.addEventListener('click', () => this.clearSearch());
        }

        // Кнопка настроек в футере
        if (this.dom.footerSettingsBtn) {
            this.dom.footerSettingsBtn.addEventListener('click', () => {
                this.callbacks.onSettingsClick?.();
            });
        }

        // 🔧 FIX: Клик по карточке пользователя для открытия профиля
        if (this.dom.footerProfileCard) {
            this.dom.footerProfileCard.addEventListener('click', () => {
                this.callbacks.onProfileClick?.();
            });

            // Поддержка клавиши Enter
            this.dom.footerProfileCard.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.callbacks.onProfileClick?.();
                }
            });
        }

        // Кнопка создания группы
        if (this.dom.createGroupBtn) {
            this.dom.createGroupBtn.addEventListener('click', () => {
                this.callbacks.onCreateGroup?.();
            });
        }

        // Делегирование событий для чатов
        if (this.dom.chatsList) {
            this.dom.chatsList.addEventListener('click', (e) => this.handleChatClick(e));
        }

        // Делегирование событий для результатов поиска
        if (this.dom.searchResultsList) {
            this.dom.searchResultsList.addEventListener('click', (e) => this.handleSearchResultClick(e));
        }
    }

    // ============================================================================
    // 🔹 Рендеринг
    // ============================================================================
    render() {
        this.renderFooter();
        this.renderChatsList();
    }

    /**
     * 🔧 FIX: Рендер футера с информацией о пользователе
     */
    renderFooter() {
        const { currentUser } = this.state;

        // Защита от null currentUser (до авторизации)
        if (!currentUser) {
            if (this.dom.footerUserName) {
                this.dom.footerUserName.textContent = 'Гость';
            }
            if (this.dom.footerUserStatusIndicator) {
                this.dom.footerUserStatusIndicator.className = 'status-indicator offline';
            }
            if (this.dom.footerUserInitials) {
                this.dom.footerUserInitials.textContent = 'G';
            }
            return;
        }

        if (this.dom.footerUserName) {
            this.dom.footerUserName.textContent = currentUser.displayName || currentUser.username;
        }

        if (this.dom.footerUserStatusIndicator) {
            this.dom.footerUserStatusIndicator.className = 'status-indicator online';
        }

        if (this.dom.footerUserInitials) {
            this.dom.footerUserInitials.textContent = this.getInitials(currentUser.displayName || currentUser.username);
        }

        if (this.dom.footerUserAvatar && currentUser.avatar) {
            this.dom.footerUserAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar)}" alt="Аватар"><span class="status-indicator online"></span>`;
        }
    }

    /**
     * Рендер списка чатов
     */
    renderChatsList() {
        if (!this.dom.chatsList) return;

        // Получаем реальные данные из app.js если они есть
        let chats = this.state.chats;

        // Если есть глобальные данные (из app.js), используем их
        if (typeof window.renderChatsListData === 'function') {
            chats = window.renderChatsListData();
        }

        // Сортировка по времени последнего сообщения (сверху — самые свежие)
        const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);

        this.dom.chatsList.innerHTML = sortedChats.map(chat => this.renderChatItem(chat)).join('');
        
        // 🔹 Обновляем результаты поиска (чтобы обновить кнопки "Начать чат" / "Перейти в чат")
        if (this.state.isSearchFocused && this.dom.searchBox) {
            const query = this.dom.searchBox.value.trim().toLowerCase();
            this.handleSearchInput({ target: { value: query } });
        }
    }

    /**
     * Рендер элемента чата
     */
    renderChatItem(chat) {
        const isSelected = chat.id === this.state.selectedChatId;
        const isGroup = chat.type === 'group';
        const timeStr = this.formatTime(chat.timestamp);
        const avatarInitials = this.getInitials(chat.name);
        const hasUnread = chat.unreadCount > 0;

        // 🔹 Всплывающая подсказка с профилем (только для личных чатов)
        const profileTooltip = !isGroup && chat.profileData ? `
            <div class="chat-item-profile-tooltip">
                <div class="tooltip-avatar">
                    ${chat.profileData.avatar ? `<img src="${escapeHtml(chat.profileData.avatar)}" alt="">` : avatarInitials}
                    <span class="tooltip-status-dot ${chat.profileData.status === 'online' ? 'online' : 'offline'}"></span>
                </div>
                <div class="tooltip-info">
                    <div class="tooltip-username">${escapeHtml(chat.profileData.username)}</div>
                    <div class="tooltip-status">${escapeHtml(chat.profileData.customStatus)}</div>
                </div>
            </div>
        ` : '';

        return `
            <div class="chat-item ${isSelected ? 'selected' : ''}"
                 data-chat-id="${escapeHtml(chat.id)}"
                 data-chat-type="${escapeHtml(chat.type)}"
                 ${chat.userId ? `data-user-id="${escapeHtml(chat.userId)}"` : ''}
                 ${chat.groupId ? `data-group-id="${escapeHtml(chat.groupId)}"` : ''}
                 role="listitem"
                 tabindex="0"
                 aria-label="${escapeHtml(chat.name)}, ${chat.unreadCount} непрочитанных">
                <div class="chat-item-avatar ${isGroup ? '' : 'avatar-placeholder'}" aria-hidden="true">
                    ${chat.avatar ? `<img src="${escapeHtml(chat.avatar)}" alt="">` : avatarInitials}
                    ${!isGroup && chat.online ? `<span class="chat-item-status ${chat.online ? 'online' : 'offline'}"></span>` : ''}
                    ${profileTooltip}
                </div>
                <div class="chat-item-info">
                    <div class="chat-item-name">
                        ${escapeHtml(chat.name)}
                        ${isGroup ? '<span class="group-badge" aria-hidden="true">👥</span>' : ''}
                    </div>
                    <div class="chat-item-last-message">${escapeHtml(chat.lastMessage)}</div>
                </div>
                <div class="chat-item-meta">
                    <span class="chat-item-time">${timeStr}</span>
                    ${hasUnread ? `<span class="chat-item-unread" aria-label="${chat.unreadCount} непрочитанных">${chat.unreadCount}</span>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Рендер результатов поиска
     */
    renderSearchResults(users) {
        if (!this.dom.searchResultsList) return;

        if (users.length === 0) {
            this.dom.searchResultsList.innerHTML = `
                <div class="search-no-results">
                    <span aria-hidden="true">🔍</span>
                    <span>Ничего не найдено</span>
                </div>
            `;
            return;
        }

        this.dom.searchResultsList.innerHTML = users.map(user => this.renderSearchResultItem(user)).join('');
    }

    /**
     * Рендер элемента результата поиска
     */
    renderSearchResultItem(user) {
        const isOnline = user.status === 'online';
        const avatarInitials = this.getInitials(user.displayName || user.username);
        
        // 🔹 Проверяем, есть ли уже чат с этим пользователем
        const hasExistingChat = this.hasChatWithUser(user.username || user.id);
        const buttonText = hasExistingChat ? 'Перейти в чат' : 'Начать чат';
        const buttonAriaLabel = hasExistingChat 
            ? `Перейти в чат с ${escapeHtml(user.displayName || user.username)}`
            : `Начать чат с ${escapeHtml(user.displayName || user.username)}`;

        return `
            <div class="search-result-item"
                 data-user-id="${escapeHtml(user.id)}"
                 data-username="${escapeHtml(user.username)}"
                 role="listitem"
                 tabindex="0">
                <div class="search-result-avatar" aria-hidden="true">
                    ${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : avatarInitials}
                    <span class="search-result-status-dot ${isOnline ? 'online' : 'offline'}"></span>
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(user.displayName || user.username)}</div>
                    <div class="search-result-status-text ${isOnline ? 'online' : 'offline'}">
                        ${isOnline ? 'Онлайн' : 'Офлайн'}
                    </div>
                </div>
                <button class="search-result-action-btn ${hasExistingChat ? 'existing-chat' : ''}" type="button" aria-label="${buttonAriaLabel}">
                    ${buttonText}
                </button>
            </div>
        `;
    }

    /**
     * Проверка, есть ли уже чат с пользователем
     * @param {string} username - Имя пользователя
     * @returns {boolean} - Есть ли уже чат
     */
    hasChatWithUser(username) {
        if (!username) return false;
        
        // Проверяем через глобальную функцию из app.js
        if (typeof window.hasChatWithUser === 'function') {
            return window.hasChatWithUser(username);
        }
        
        // Резервная проверка: ищем в localStorage сообщения
        const currentUser = typeof window.currentUser !== 'undefined' ? window.currentUser : null;
        if (!currentUser) return false;
        
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        return saved !== null;
    }

    // ============================================================================
    // 🔹 Обработчики событий
    // ============================================================================
    /**
     * Фокус на поле поиска
     */
    handleSearchFocus() {
        this.state.isSearchFocused = true;

        // Скрываем список чатов, показываем результаты поиска
        if (this.dom.chatsContainer) {
            this.dom.chatsContainer.classList.add('hidden');
        }

        if (this.dom.searchResultsContainer) {
            this.dom.searchResultsContainer.classList.remove('hidden');
        }

        // Показываем кнопку очистки
        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.classList.remove('hidden');
        }

        // Получаем реальных пользователей для поиска из app.js
        const users = typeof window.getPublicUsersData === 'function'
            ? window.getPublicUsersData()
            : [];

        // Рендерим всех пользователей для поиска
        this.renderSearchResults(users);
    }

    /**
     * Потеря фокуса полем поиска
     */
    handleSearchBlur() {
        // Не скрываем сразу, даём время на клик по результату
        setTimeout(() => {
            if (!this.state.searchQuery) {
                this.state.isSearchFocused = false;

                if (this.dom.chatsContainer) {
                    this.dom.chatsContainer.classList.remove('hidden');
                }

                if (this.dom.searchResultsContainer) {
                    this.dom.searchResultsContainer.classList.add('hidden');
                }

                if (this.dom.searchClearBtn) {
                    this.dom.searchClearBtn.classList.add('hidden');
                }
            }
        }, 200);
    }

    /**
     * Ввод в поле поиска
     */
    handleSearchInput(e) {
        const query = e.target.value.trim().toLowerCase();
        this.state.searchQuery = query;

        // Получаем реальных пользователей из app.js
        const allUsers = typeof window.getPublicUsersData === 'function'
            ? window.getPublicUsersData()
            : [];

        // Фильтрация пользователей
        const filteredUsers = allUsers.filter(user => {
            const name = (user.displayName || user.username).toLowerCase();
            return name.includes(query);
        });

        this.renderSearchResults(filteredUsers);

        // Показываем/скрываем кнопку очистки
        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.classList.toggle('hidden', !query);
        }
    }

    /**
     * Навигация клавиатурой в поиске
     */
    handleSearchKeydown(e) {
        if (e.key === 'Escape') {
            this.clearSearch();
            this.dom.searchBox?.blur();
        }
    }

    /**
     * Клик по чату
     */
    handleChatClick(e) {
        const chatItem = e.target.closest('.chat-item');
        if (!chatItem) return;

        const chatId = chatItem.dataset.chatId;
        const chatType = chatItem.dataset.chatType;
        const userId = chatItem.dataset.userId;
        const groupId = chatItem.dataset.groupId;

        this.state.selectedChatId = chatId;

        // 🔹 Скрываем поиск и показываем список чатов
        this.hideSearch();

        // Обновляем выделение
        this.renderChatsList();

        // Вызываем callback с полными данными
        this.callbacks.onChatSelect?.({
            id: chatId,
            type: chatType,
            userId: userId,
            groupId: groupId
        });
    }

    /**
     * Клик по результату поиска
     */
    handleSearchResultClick(e) {
        const resultItem = e.target.closest('.search-result-item');
        const actionBtn = e.target.closest('.search-result-action-btn');

        if (actionBtn) {
            // Кнопка "Начать чат"
            const userId = resultItem?.dataset.userId;
            const username = resultItem?.dataset.username;

            if (userId) {
                // 🔹 Скрываем поиск перед открытием чата
                this.hideSearch();
                this.callbacks.onUserStartChat?.({ id: userId, username });
            }
        } else if (resultItem) {
            // Клик по самому элементу
            const userId = resultItem.dataset.userId;
            const username = resultItem.dataset.username;

            if (userId) {
                // 🔹 Скрываем поиск перед открытием чата
                this.hideSearch();
                this.callbacks.onUserStartChat?.({ id: userId, username });
            }
        }
    }

    /**
     * Очистка поиска
     */
    clearSearch() {
        this.state.searchQuery = '';
        if (this.dom.searchBox) {
            this.dom.searchBox.value = '';
        }

        // Получаем реальных пользователей из app.js
        const users = typeof window.getPublicUsersData === 'function'
            ? window.getPublicUsersData()
            : [];

        this.renderSearchResults(users);

        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.classList.add('hidden');
        }
    }

    /**
     * 🔹 Скрыть поиск и показать список чатов
     * Вызывается при выборе чата
     */
    hideSearch() {
        this.state.isSearchFocused = false;
        this.state.searchQuery = '';

        if (this.dom.searchBox) {
            this.dom.searchBox.value = '';
        }

        // Показываем список чатов, скрываем результаты поиска
        if (this.dom.chatsContainer) {
            this.dom.chatsContainer.classList.remove('hidden');
        }

        if (this.dom.searchResultsContainer) {
            this.dom.searchResultsContainer.classList.add('hidden');
        }

        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.classList.add('hidden');
        }

        // Снимаем фокус с поля поиска
        if (this.dom.searchBox) {
            this.dom.searchBox.blur();
        }

        // 🔧 FIX: Обновляем результаты поиска чтобы скрыть пользователя с которым начался чат
        setTimeout(() => {
            if (typeof window.getPublicUsersData === 'function') {
                this.renderSearchResults(window.getPublicUsersData());
            }
        }, 100);
    }

    // ============================================================================
    // 🔹 Публичные методы
    // ============================================================================
    /**
     * Обновить список чатов
     */
    updateChats(chats) {
        this.state.chats = [...chats];
        this.renderChatsList();
    }

    /**
     * Обновить текущего пользователя
     */
    updateCurrentUser(user) {
        this.state.currentUser = { ...this.state.currentUser, ...user };
        this.renderFooter();
    }

    /**
     * Обновить статус непрочитанных
     */
    updateUnreadCount(chatId, count) {
        const chat = this.state.chats.find(c => c.id === chatId);
        if (chat) {
            chat.unreadCount = count;
            this.renderChatsList();
        }
    }

    /**
     * Выбрать чат
     */
    selectChat(chatId) {
        this.state.selectedChatId = chatId;
        this.renderChatsList();
    }

    // ============================================================================
    // 🔹 Утилиты
    // ============================================================================
    /**
     * Получить инициалы из имени
     */
    getInitials(name) {
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    }

    /**
     * Форматирование времени
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // Сегодня
        if (diff < 86400000 && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }

        // Вчера
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.getDate() === yesterday.getDate()) {
            return 'Вчера';
        }

        // На этой неделе
        if (diff < 604800000) {
            return date.toLocaleDateString('ru-RU', { weekday: 'short' });
        }

        // Старее
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    }
}

// ============================================================================
// 🔹 Утилита экранирования HTML
// ============================================================================
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    return str.replace(/[&<>"'/]/g, char => escapeMap[char]);
}

// ============================================================================
// 🔹 Экспорт (для использования в app.js)
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SidebarComponent };
}
