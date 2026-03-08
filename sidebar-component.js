/**
 * SidebarComponent - Компонент боковой панели мессенджера
 * @version 1.0.0
 * @description Боковая панель с поиском, списком чатов и глобальным каталогом пользователей
 */

'use strict';

// ============================================================================
// 🔹 Моковые данные (для демонстрации)
// ============================================================================
const MOCK_DATA = {
    // Текущий пользователь
    currentUser: {
        id: 'user_1',
        username: 'alex_dev',
        displayName: 'Александр',
        avatar: null,
        status: 'online',
        allowPublicView: true
    },

    // Активные чаты (личные)
    activeChats: [
        {
            id: 'chat_1',
            type: 'personal',
            userId: 'user_2',
            name: 'Мария Иванова',
            avatar: null,
            lastMessage: 'Привет! Как дела с проектом?',
            timestamp: Date.now() - 60000, // 1 минуту назад
            unreadCount: 2,
            online: true,
            activeChat: null
        },
        {
            id: 'chat_2',
            type: 'personal',
            userId: 'user_3',
            name: 'Дмитрий Петров',
            avatar: null,
            lastMessage: 'Отправил файлы на почту',
            timestamp: Date.now() - 3600000, // 1 час назад
            unreadCount: 0,
            online: false,
            activeChat: null
        },
        {
            id: 'chat_3',
            type: 'group',
            groupId: 'group_1',
            name: 'Frontend Команда',
            avatar: null,
            lastMessage: 'Встреча в 15:00',
            timestamp: Date.now() - 7200000, // 2 часа назад
            unreadCount: 5,
            membersCount: 8
        },
        {
            id: 'chat_4',
            type: 'personal',
            userId: 'user_4',
            name: 'Елена Смирнова',
            avatar: null,
            lastMessage: 'Спасибо!',
            timestamp: Date.now() - 86400000, // 1 день назад
            unreadCount: 0,
            online: true,
            activeChat: 'user_5'
        },
        {
            id: 'chat_5',
            type: 'group',
            groupId: 'group_2',
            name: 'Дизайн чат',
            avatar: null,
            lastMessage: 'Новый макет готов',
            timestamp: Date.now() - 172800000, // 2 дня назад
            unreadCount: 0,
            membersCount: 5
        }
    ],

    // Пользователи для глобального поиска (с allow_public_view: true)
    publicUsers: [
        {
            id: 'user_5',
            username: 'john_doe',
            displayName: 'John Doe',
            avatar: null,
            status: 'online',
            allowPublicView: true
        },
        {
            id: 'user_6',
            username: 'jane_smith',
            displayName: 'Jane Smith',
            avatar: null,
            status: 'offline',
            allowPublicView: true,
            lastSeen: Date.now() - 3600000
        },
        {
            id: 'user_7',
            username: 'bob_wilson',
            displayName: 'Bob Wilson',
            avatar: null,
            status: 'online',
            allowPublicView: true
        },
        {
            id: 'user_8',
            username: 'alice_brown',
            displayName: 'Alice Brown',
            avatar: null,
            status: 'offline',
            allowPublicView: true,
            lastSeen: Date.now() - 86400000
        },
        {
            id: 'user_9',
            username: 'charlie_davis',
            displayName: 'Charlie Davis',
            avatar: null,
            status: 'online',
            allowPublicView: true
        }
    ]
};

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
            footerUserStatus: null,
            footerUserInitials: null,
            footerUserAvatar: null,
            footerSettingsBtn: null,
            footerProfileBtn: null,
            createGroupBtn: null
        };

        // Состояние
        this.state = {
            currentUser: options.currentUser || MOCK_DATA.currentUser,
            chats: [...options.activeChats || MOCK_DATA.activeChats],
            publicUsers: [...options.publicUsers || MOCK_DATA.publicUsers],
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
        this.dom.footerUserStatus = document.getElementById('footerUserStatus');
        this.dom.footerUserInitials = document.getElementById('footerUserInitials');
        this.dom.footerUserAvatar = document.getElementById('footerUserAvatar');
        this.dom.footerSettingsBtn = document.getElementById('footerSettingsBtn');
        this.dom.footerProfileBtn = document.getElementById('footerProfileBtn');
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

        // Кнопки в футере
        if (this.dom.footerSettingsBtn) {
            this.dom.footerSettingsBtn.addEventListener('click', () => {
                this.callbacks.onSettingsClick?.();
            });
        }

        if (this.dom.footerProfileBtn) {
            this.dom.footerProfileBtn.addEventListener('click', () => {
                this.callbacks.onProfileClick?.();
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
     * Рендер футера с информацией о пользователе
     */
    renderFooter() {
        const { currentUser } = this.state;

        if (this.dom.footerUserName) {
            this.dom.footerUserName.textContent = currentUser.displayName || currentUser.username;
        }

        if (this.dom.footerUserStatus) {
            this.dom.footerUserStatus.textContent = 'Онлайн';
        }

        if (this.dom.footerUserInitials) {
            this.dom.footerUserInitials.textContent = this.getInitials(currentUser.displayName || currentUser.username);
        }

        if (this.dom.footerUserAvatar && currentUser.avatar) {
            this.dom.footerUserAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar)}" alt="Аватар">`;
        }
    }

    /**
     * Рендер списка чатов
     */
    renderChatsList() {
        if (!this.dom.chatsList) return;

        // Сортировка по времени последнего сообщения (сверху — самые свежие)
        const sortedChats = [...this.state.chats].sort((a, b) => b.timestamp - a.timestamp);

        this.dom.chatsList.innerHTML = sortedChats.map(chat => this.renderChatItem(chat)).join('');
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

        return `
            <div class="chat-item ${isSelected ? 'selected' : ''}" 
                 data-chat-id="${escapeHtml(chat.id)}" 
                 data-chat-type="${escapeHtml(chat.type)}"
                 role="listitem"
                 tabindex="0"
                 aria-label="${escapeHtml(chat.name)}, ${chat.unreadCount} непрочитанных">
                <div class="chat-item-avatar ${isGroup ? '' : 'avatar-placeholder'}" aria-hidden="true">
                    ${chat.avatar ? `<img src="${escapeHtml(chat.avatar)}" alt="">` : avatarInitials}
                    ${!isGroup && chat.online ? `<span class="chat-item-status ${chat.online ? 'online' : 'offline'}"></span>` : ''}
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
                <button class="search-result-action-btn" type="button" aria-label="Начать чат с ${escapeHtml(user.displayName || user.username)}">
                    Начать чат
                </button>
            </div>
        `;
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

        // Рендерим всех пользователей для поиска
        this.renderSearchResults(this.state.publicUsers);
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

        // Фильтрация пользователей
        const filteredUsers = this.state.publicUsers.filter(user => {
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

        this.state.selectedChatId = chatId;

        // Обновляем выделение
        this.renderChatsList();

        // Вызываем callback
        this.callbacks.onChatSelect?.({ id: chatId, type: chatType });
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
                this.callbacks.onUserStartChat?.({ id: userId, username });
            }
        } else if (resultItem) {
            // Клик по самому элементу
            const userId = resultItem.dataset.userId;
            const username = resultItem.dataset.username;

            if (userId) {
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

        this.renderSearchResults(this.state.publicUsers);

        if (this.dom.searchClearBtn) {
            this.dom.searchClearBtn.classList.add('hidden');
        }
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
    module.exports = { SidebarComponent, MOCK_DATA };
}
