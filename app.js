/**
 * Client Messenger - Клиентская часть
 * @version 3.0.0
 * @description Безопасная и оптимизированная версия с защитой от XSS
 */

'use strict';

// ============================================================================
// 🔹 Глобальные переменные
// ============================================================================
let socket = null;
let currentUser = null;
let selectedUser = null;
let users = [];
let soundEnabled = true;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Ключ сессии для авто-входа
const AUTH_SESSION_KEY = 'messenger_auth_session';

// Расширенный функционал
let isVisibleInDirectory = false;
let searchRateLimit = false;
const RATE_LIMIT_DELAY = 500;

// Кэш видимости пользователей (для производительности)
const userVisibilityCache = new Map();

// Состояние прокрутки
let unreadMessagesCount = 0;
let isUserAtBottom = true;

// Контекстное меню сообщений
let messageContextMenuTarget = null;
let replyToMessage = null;

// ✨ Реакции на сообщения
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🎉', '🔥', '💯'];
let userReactionFrequency = {}; // Хранение частоты использования реакций для текущего пользователя

// ============================================================================
// 🔹 Константы
// ============================================================================
const WS_URL = 'wss://client-messenger-production.up.railway.app';
const DEBOUNCE_DELAY = 300;
const MESSAGE_MAX_LENGTH = 10000;
const MAX_MESSAGES_IN_STORAGE = 100;

const STORAGE_KEYS = {
    USERS: 'messenger_users',
    SETTINGS: 'messenger_settings'
};

// ============================================================================
// 🔹 DOM Cache (кэширование элементов для производительности)
// ============================================================================
const DOM = {
    // Окна
    loginWindow: null,
    chatWindow: null,
    settingsModal: null,
    
    // Sidebar
    sidebar: null,
    sidebarToggle: null,
    sidebarTrigger: null,
    searchBox: null,
    usersList: null,
    activeChatsList: null,
    
    // Чат
    messagesList: null,
    inputPanel: null,
    chatPlaceholder: null,
    chatTitle: null,
    chatUserStatus: null,
    backBtn: null,
    scrollToBottomBtn: null,
    unreadCount: null,
    
    // Ввод
    messageBox: null,
    sendBtn: null,
    encryptCheckBox: null,
    encryptKeyBox: null,
    decryptPanel: null,
    decryptKeyBox: null,
    decryptBtn: null,

    // Настройки
    themeSelect: null,
    accentColorSelect: null,
    messageColorSelect: null,
    fontSizeSelect: null,
    showInDirectory: null,
    soundNotify: null,
    pushNotify: null,
    notificationSound: null,
    currentUserLabel: null
};

/**
 * Инициализация DOM кэша
 * Безопасное получение элементов с проверкой
 */
function initDOM() {
    const ids = [
        'loginWindow', 'chatWindow', 'settingsModal', 'sidebar', 'sidebarToggle',
        'sidebarTrigger', 'searchBox', 'usersList', 'activeChatsList', 'messagesList',
        'inputPanel', 'chatPlaceholder', 'chatTitle', 'chatUserStatus', 'backBtn',
        'scrollToBottomBtn', 'unreadCount', 'messageBox', 'sendBtn', 'encryptCheckBox',
        'encryptKeyBox', 'decryptPanel', 'decryptKeyBox', 'decryptBtn', 'themeSelect',
        'accentColorSelect', 'messageColorSelect', 'fontSizeSelect', 'showInDirectory',
        'soundNotify', 'pushNotify', 'notificationSound', 'currentUserLabel'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) {
            console.warn('⚠️ DOM element not found:', id);
        }
        DOM[id] = el;
    });
}

// ============================================================================
// 🔹 Утилиты безопасности
// ============================================================================

/**
 * Безопасное экранирование HTML-символов
 * Защита от XSS атак
 * @param {string} str - Строка для экранирования
 * @returns {string} - Экранированная строка
 */
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

/**
 * Валидация имени пользователя
 * @param {string} username - Имя для проверки
 * @returns {boolean} - Валидно ли имя
 */
function isValidUsername(username) {
    if (typeof username !== 'string') return false;
    const trimmed = username.trim();
    return trimmed.length >= 3 && trimmed.length <= 20 && /^[A-Za-z0-9_]+$/.test(trimmed);
}

/**
 * Валидация пароля
 * @param {string} password - Пароль для проверки
 * @returns {boolean} - Валиден ли пароль
 */
function isValidPassword(password) {
    return typeof password === 'string' && password.length >= 4 && password.length <= 100;
}

/**
 * Санитизация текста сообщения
 * @param {string} text - Текст сообщения
 * @returns {string} - Очищенный текст
 */
function sanitizeMessageText(text) {
    if (typeof text !== 'string') return '';
    // Удаляем потенциально опасные теги
    return text.substring(0, MESSAGE_MAX_LENGTH);
}

// ============================================================================
// 🔹 Инициализация
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    autoLogin();
    initTabs();
    initLogin();
    initChat();
    initSettings();
    initSidebar();
    initScrollTracking();
    loadSavedUsers();
    loadSettings();
    initHotkeys();
});

// ============================================================================
// 🔹 Вкладки (авторизация/регистрация)
// ============================================================================
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const tabsContainer = document.querySelector('.tabs');

    if (!tabBtns.length || !loginTab || !registerTab || !tabsContainer) return;

    // Делегирование событий для вкладок
    tabsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;

        tabBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const isLogin = btn.dataset.tab === 'login';
        loginTab.classList.toggle('active', isLogin);
        registerTab.classList.toggle('active', !isLogin);
    });
}

// ============================================================================
// 🔹 Авторизация
// ============================================================================
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');

    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (registerBtn) registerBtn.addEventListener('click', handleRegister);
}

/**
 * Показ сообщения о статусе
 * @param {string} message - Сообщение
 * @param {boolean} isError - Ошибка ли это
 */
function showStatus(message, isError = true) {
    const statusEl = document.getElementById('loginStatus');
    if (!statusEl) {
        console.warn('⚠️ showStatus: loginStatus element not found');
        return;
    }

    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--error)' : 'var(--success)';
    statusEl.setAttribute('role', 'alert');
    statusEl.setAttribute('aria-live', 'polite');
    
    setTimeout(() => { 
        statusEl.textContent = ''; 
    }, 5000);
}

/**
 * Обработка входа
 */
function handleLogin() {
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showStatus('Введите имя пользователя и пароль');
        return;
    }

    if (!isValidUsername(username)) {
        showStatus('Имя должно содержать 3-20 символов (латиница, цифры, _)');
        return;
    }

    // Защита от XSS: проверка на опасные символы
    if (/[<>\"'&]/.test(username)) {
        showStatus('Недопустимые символы в имени');
        return;
    }

    currentUser = username;
    window.currentUserPassword = password;

    // Небольшая задержка для защиты от перебора
    setTimeout(() => {
        connectToServer({ type: 'login', username, password });
    }, 300);
}

/**
 * Обработка регистрации
 */
function handleRegister() {
    const usernameInput = document.getElementById('regUsername');
    const passwordInput = document.getElementById('regPassword');
    const confirmInput = document.getElementById('regConfirmPassword');

    if (!usernameInput || !passwordInput || !confirmInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    if (!username || !password) {
        showStatus('Введите имя пользователя и пароль');
        return;
    }

    if (!isValidUsername(username)) {
        showStatus('Имя должно содержать 3-20 символов (латиница, цифры, _)');
        return;
    }

    if (!isValidPassword(password)) {
        showStatus('Пароль должен содержать 4-100 символов');
        return;
    }

    // Защита от XSS: проверка на опасные символы
    if (/[<>\"'&]/.test(username)) {
        showStatus('Недопустимые символы в имени');
        return;
    }

    if (password !== confirm) {
        showStatus('Пароли не совпадают');
        return;
    }

    currentUser = username;
    window.currentUserPassword = password;

    // Небольшая задержка для защиты от перебора
    setTimeout(() => {
        connectToServer({ type: 'register', username, password });
    }, 300);
}

// ============================================================================
// 🔹 WebSocket
// ============================================================================
/**
 * Подключение к серверу
 * @param {Object} authMessage - Сообщение авторизации
 */
function connectToServer(authMessage) {
    // Проверяем текущее состояние сокета
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        if (authMessage && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(authMessage));
        }
        return;
    }

    try {
        // Очищаем старый сокет
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close(1000, 'Reconnecting');
            }
            socket = null;
        }

        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            console.log('✅ Connected');
            reconnectAttempts = 0;
            if (authMessage) socket.send(JSON.stringify(authMessage));
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Валидация данных перед обработкой
                if (!data || typeof data !== 'object') {
                    console.warn('⚠️ Invalid message format from server');
                    return;
                }
                handleServerMessage(data);
            } catch (e) {
                console.error('❌ Parse error:', e, 'Raw data:', event.data?.substring(0, 100));
            }
        };

        socket.onerror = () => {
            console.warn('⚠️ WebSocket error');
        };

        socket.onclose = (event) => {
            console.log('🔌 Disconnected:', event.code);

            if (currentUser && event.code !== 1000 && event.code !== 1001) {
                reconnectAttempts++;
                if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(2000 * reconnectAttempts, 10000);
                    setTimeout(() => {
                        connectToServer({
                            type: 'login',
                            username: currentUser,
                            password: window.currentUserPassword || '***'
                        });
                    }, delay);
                }
            }
        };
    } catch (error) {
        showStatus('Ошибка подключения: ' + error.message);
    }
}

/**
 * Отправка сообщения серверу
 * @param {Object} message - Сообщение
 * @returns {boolean} - Успешно ли отправлено
 */
function sendToServer(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
    }
    console.warn('⚠️ WebSocket not ready');
    return false;
}

// ============================================================================
// 🔹 Обработка сообщений сервера
// ============================================================================
function handleServerMessage(data) {
    // Строгая валидация входящих данных
    if (!data || typeof data !== 'object') {
        console.warn('⚠️ handleServerMessage: invalid data format');
        return;
    }
    if (typeof data.type !== 'string') {
        console.warn('⚠️ handleServerMessage: invalid type');
        return;
    }

    // Защита от потенциально опасных данных
    if (data.type.length > 50) {
        console.warn('⚠️ handleServerMessage: type too long');
        return;
    }

    try {
        switch (data.type) {
            case 'register_success':
                showStatus('✅ Регистрация успешна! Теперь войдите', false);
                break;
            case 'register_error':
            case 'login_error':
            case 'error':
                showStatus(sanitizeMessageText(data.message || 'Произошла ошибка'), true);
                break;
            case 'login_success':
                handleLoginSuccess(data);
                break;
            case 'user_list':
                if (Array.isArray(data.users)) {
                    updateUsersList(data.users);
                }
                break;
            case 'user_online':
                if (data.username && typeof data.username === 'string') {
                    updateUserStatus(data.username, 'online', data.activeChat || null);
                }
                break;
            case 'user_offline':
                if (data.username && typeof data.username === 'string') {
                    updateUserStatus(data.username, 'offline', null);
                }
                break;
            case 'user_status_update':
                if (data.username && typeof data.username === 'string') {
                    updateUserStatus(data.username, data.status, data.activeChat || null);
                }
                break;
            case 'user_visibility_update':
                if (data.username && typeof data.isVisible === 'boolean') {
                    updateUserVisibility(data.username, data.isVisible);
                }
                break;
            case 'receive_message':
                if (data.sender && data.text && data.timestamp) {
                    handleMessageReceive(data);
                }
                break;
            case 'message_confirmed':
                if (data.timestamp) {
                    updateMessageDeliveryStatus(data.timestamp, 'sent');
                }
                break;
            case 'message_read_receipt':
                if (data.timestamp) {
                    updateMessageDeliveryStatus(data.timestamp, 'delivered');
                }
                break;
            // Обработка удаления сообщения
            case 'message_deleted':
                if (data.timestamp && data.deletedBy) {
                    handleRemoteMessageDelete(data.timestamp, data.deletedBy);
                }
                break;
            // ✨ Обработка реакции на сообщение
            case 'message_reaction':
                if (data.timestamp && data.reactions) {
                    handleRemoteMessageReaction(data.timestamp, data.reactions);
                }
                break;
            default:
                // Игнорируем неизвестные типы сообщений
                if (typeof data.type === 'string' && data.type.length <= 50) {
                    console.warn('⚠️ Unknown message type:', data.type.substring(0, 50));
                }
        }
    } catch (e) {
        console.error('❌ handleServerMessage error:', e, 'Data:', data);
    }
}

/**
 * Обработка успешного входа
 * @param {Object} data - Данные ответа
 */
function handleLoginSuccess(data) {
    // Валидация данных входа
    if (!data.username || typeof data.username !== 'string') {
        console.error('❌ Invalid login data');
        showStatus('❌ Ошибка авторизации', true);
        return;
    }

    const sanitizedUsername = data.username.trim();
    if (sanitizedUsername.length < 3 || sanitizedUsername.length > 20) {
        console.error('❌ Invalid username length');
        showStatus('❌ Неверное имя пользователя', true);
        return;
    }

    currentUser = sanitizedUsername;

    if (typeof data.isVisibleInDirectory === 'boolean') {
        isVisibleInDirectory = data.isVisibleInDirectory;
    }

    if (window.currentUserPassword) {
        saveAuthSession(currentUser, window.currentUserPassword);
    }

    DOM.loginWindow?.classList.add('hidden');
    DOM.chatWindow?.classList.remove('hidden');

    if (DOM.currentUserLabel) {
        DOM.currentUserLabel.textContent = currentUser;
    }

    console.log('✅ Connected:', currentUser);
    sendToServer({ type: 'get_users' });
    requestAudioPermission();
}

/**
 * Обновление статуса доставки сообщения
 * @param {number} timestamp - Временная метка
 * @param {string} status - Статус ('sent', 'delivered')
 */
function updateMessageDeliveryStatus(timestamp, status) {
    if (!DOM.messagesList || !timestamp) return;

    const messages = DOM.messagesList.querySelectorAll('.message.own');
    messages.forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            const checksEl = msg.querySelector('.checks');
            if (checksEl) {
                checksEl.className = `checks ${status}`;
                checksEl.textContent = status === 'sent' ? '✓' : '✓✓';
                checksEl.title = status === 'sent' ? 'Отправлено' : 'Прочитано';
            }
        }
    });

    if (selectedUser) {
        try {
            const messages = loadMessagesFromStorage(selectedUser);
            const msg = messages.find(m => m.timestamp === timestamp);
            if (msg) {
                msg.deliveryStatus = status;
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
            }
        } catch (e) {
            console.error('❌ updateMessageDeliveryStatus error:', e);
        }
    }
}

// ============================================================================
// 🔹 Входящие сообщения
// ============================================================================
function handleMessageReceive(data) {
    // Валидация входящих данных
    if (!data.sender || typeof data.sender !== 'string') {
        console.warn('⚠️ handleMessageReceive: invalid sender');
        return;
    }
    
    if (!data.text || typeof data.text !== 'string') {
        console.warn('⚠️ handleMessageReceive: invalid text');
        return;
    }
    
    if (!data.timestamp || typeof data.timestamp !== 'number') {
        console.warn('⚠️ handleMessageReceive: invalid timestamp');
        return;
    }

    const messageData = {
        sender: data.sender,
        text: sanitizeMessageText(data.text),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        encrypted: data.encrypted || false,
        hint: data.hint || null,
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null
    };

    const chatName = data.privateTo || 'general';

    // Сохраняем сообщение
    try {
        if (data.privateTo && data.privateTo === currentUser) {
            saveMessageToStorage(data.sender, messageData);
            // ✨ Добавляем чат в активные
            addChatToActive(data.sender);
        } else if (data.sender === currentUser && data.privateTo) {
            saveMessageToStorage(data.privateTo, messageData);
            // ✨ Добавляем чат в активные
            addChatToActive(data.privateTo);
        } else {
            saveMessageToStorage(chatName, messageData);
        }
    } catch (e) {
        console.error('❌ Save message error in handleMessageReceive:', e);
    }

    // Показываем сообщение если чат открыт
    if (selectedUser === data.sender || (data.sender === currentUser && data.privateTo === selectedUser)) {
        const isAdded = addUnreadMessage();
        if (isAdded) {
            addMessage(messageData);
        } else {
            addMessage(messageData, false, false);
        }

        if (data.privateTo && data.sender !== currentUser) {
            sendToServer({ type: 'message_read', from: data.sender, timestamp: data.timestamp });
        }
    } else if (data.privateTo === currentUser) {
        addUnreadMessage();
        addMessage(messageData, false, false);
        // ✨ Увеличиваем счётчик непрочитанных
        incrementUnreadCount(data.sender);
    }

    if (data.sender !== currentUser) {
        playNotificationSound();
        showBrowserNotification({
            sender: data.sender,
            text: data.encrypted ? '🔒 Зашифрованное сообщение' : data.text,
            encrypted: data.encrypted
        });
    }
}

// ============================================================================
// 🔹 Чат
// ============================================================================
function initChat() {
    selectedUser = null;

    if (DOM.sendBtn) DOM.sendBtn.addEventListener('click', sendMessage);

    if (DOM.messageBox) {
        DOM.messageBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        DOM.messageBox.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
    }

    if (DOM.encryptCheckBox) {
        DOM.encryptCheckBox.addEventListener('change', (e) => {
            if (DOM.encryptKeyBox) {
                DOM.encryptKeyBox.classList.toggle('hidden', !e.target.checked);
                if (!e.target.checked) DOM.encryptKeyBox.value = '';
            }
        });
    }

    if (DOM.decryptBtn) DOM.decryptBtn.addEventListener('click', decryptMessage);

    // Поиск с debounce
    if (DOM.searchBox) {
        let searchTimeout = null;
        DOM.searchBox.addEventListener('input', () => {
            if (searchRateLimit) return;
            searchRateLimit = true;
            setTimeout(() => { searchRateLimit = false; }, RATE_LIMIT_DELAY);

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(searchUsers, DEBOUNCE_DELAY);
        }, { passive: true });

        DOM.searchBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchEnter();
            }
        });
    }

    setInputPanelVisible(false);
}

// ============================================================================
// 🔹 Sidebar (Боковая панель)
// ============================================================================
function initSidebar() {
    if (DOM.sidebarToggle) {
        DOM.sidebarToggle.addEventListener('click', toggleSidebar);
    }

    if (DOM.backBtn) {
        DOM.backBtn.addEventListener('click', showMobileChatList);
    }

    // ✨ Кнопка сворачивания списка пользователей
    const collapseUsersBtn = document.getElementById('collapseUsersBtn');
    if (collapseUsersBtn) {
        collapseUsersBtn.addEventListener('click', () => {
            const usersSection = document.querySelector('.users-section');
            if (usersSection) {
                usersSection.classList.toggle('collapsed');
                collapseUsersBtn.classList.toggle('collapsed');
                
                // Сохраняем состояние
                localStorage.setItem('users_list_collapsed', usersSection.classList.contains('collapsed'));
            }
        });
        
        // Загружаем сохранённое состояние
        const usersCollapsed = localStorage.getItem('users_list_collapsed') === 'true';
        if (usersCollapsed) {
            const usersSection = document.querySelector('.users-section');
            if (usersSection) {
                usersSection.classList.add('collapsed');
                collapseUsersBtn.classList.add('collapsed');
            }
        }
    }

    // Кнопка вызова sidebar для мобильных
    if (DOM.sidebarTrigger) {
        DOM.sidebarTrigger.addEventListener('click', showSidebarOnMobile);
    }

    // Закрытие sidebar при клике вне его области (на мобильных)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && DOM.sidebar) {
            const isClickInsideSidebar = DOM.sidebar.contains(e.target);
            const isClickOnTrigger = DOM.sidebarTrigger?.contains(e.target);
            if (!isClickInsideSidebar && !isClickOnTrigger) {
                DOM.sidebar.classList.remove('mobile-visible');
            }
        }
    });

    // Загрузка состояния sidebar
    const sidebarCollapsed = localStorage.getItem('sidebar_collapsed');
    if (sidebarCollapsed === 'true' && window.innerWidth > 768) {
        DOM.sidebar?.classList.add('collapsed');
        updateSidebarToggleIcon();
    }

    // Делегирование событий для списков
    initUserListEvents();

    checkMobileView();
}

/**
 * Показать sidebar на мобильном устройстве
 */
function showSidebarOnMobile() {
    if (!DOM.sidebar) return;
    
    DOM.sidebar.classList.add('mobile-visible');
}

/**
 * Инициализация делегирования событий для списка пользователей
 */
function initUserListEvents() {
    // Делегирование для списка пользователей
    DOM.usersList?.addEventListener('click', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        const username = userItem.dataset.username;
        if (!username) return;

        // Клик по элементу пользователя
        selectUser(username);
    });
    
    // ✨ Двойной клик для быстрого открытия чата
    DOM.usersList?.addEventListener('dblclick', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        const username = userItem.dataset.username;
        if (username) {
            selectUser(username);
        }
    });

    // Контекстное меню (ПКМ) для доступа к функциям закрепить/удалить
    DOM.usersList?.addEventListener('contextmenu', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        e.preventDefault();
        const username = userItem.dataset.username;
        if (username) showFolderContextMenu(e, username);
    });

    // Делегирование для активных чатов
    DOM.activeChatsList?.addEventListener('click', (e) => {
        const chatItem = e.target.closest('.active-chat-item');
        if (!chatItem) return;

        const username = chatItem.dataset.username;
        if (!username) return;

        // Клик по кнопке закрепить
        if (e.target.closest('.pin-btn')) {
            e.stopPropagation();
            togglePin(username);
            return;
        }

        // Клик по кнопке удалить чат
        if (e.target.closest('.delete-btn')) {
            e.stopPropagation();
            deleteChat(username, chatItem);
            return;
        }

        // Клик по кнопке закрыть
        if (e.target.closest('.close-chat')) {
            e.stopPropagation();
            showGeneralChat();
            return;
        }

        // Клик по элементу чата
        selectUser(username);
    });
}

/**
 * Переключение sidebar (свернуть/развернуть)
 */
function toggleSidebar() {
    if (!DOM.sidebar) return;

    DOM.sidebar.classList.toggle('collapsed');
    const isCollapsed = DOM.sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebar_collapsed', isCollapsed);
    updateSidebarToggleIcon();
    
    // Обновляем aria-атрибут
    if (DOM.sidebarToggle) {
        DOM.sidebarToggle.setAttribute('aria-expanded', !isCollapsed);
    }
}

/**
 * Обновление иконки sidebar
 */
function updateSidebarToggleIcon() {
    if (!DOM.sidebarToggle) return;

    const icon = DOM.sidebarToggle.querySelector('.toggle-icon');
    if (!icon) return;
    
    if (DOM.sidebar?.classList.contains('collapsed')) {
        icon.textContent = '▶';
    } else {
        icon.textContent = '◀';
    }
}

/**
 * Проверка мобильного вида
 */
function checkMobileView() {
    if (!DOM.sidebar || !DOM.backBtn) return;

    const isMobile = window.innerWidth <= 768;
    const hasSelectedUser = selectedUser !== null;

    // На мобильных показываем кнопку "назад" только если выбран чат
    DOM.backBtn.classList.toggle('hidden', !(isMobile && hasSelectedUser));
    
    // На мобильных скрываем sidebar когда выбран чат (если только не открыто меню)
    if (isMobile && hasSelectedUser && !DOM.sidebar.classList.contains('mobile-visible')) {
        DOM.sidebar.classList.remove('mobile-visible');
    }
}

/**
 * Показать список чатов на мобильном
 */
function showMobileChatList() {
    if (!DOM.sidebar) return;

    DOM.sidebar.classList.remove('mobile-hidden', 'mobile-visible');
    DOM.backBtn?.classList.add('hidden');

    if (window.innerWidth > 768) {
        showGeneralChat();
    }
}

// ============================================================================
// 🔹 Отслеживание прокрутки
// ============================================================================
function initScrollTracking() {
    if (!DOM.messagesList || !DOM.scrollToBottomBtn) return;

    let scrollTimeout = null;
    DOM.messagesList.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            checkScrollPosition();
            scrollTimeout = null;
        }, 100);
    }, { passive: true });

    DOM.scrollToBottomBtn.addEventListener('click', scrollToBottom);
}

function checkScrollPosition() {
    if (!DOM.messagesList) return;

    const threshold = 100;
    const position = DOM.messagesList.scrollTop + DOM.messagesList.clientHeight;
    const height = DOM.messagesList.scrollHeight;

    isUserAtBottom = (height - position) < threshold;
    updateScrollButton();
}

function updateScrollButton() {
    if (!DOM.scrollToBottomBtn || !DOM.unreadCount) return;

    if (isUserAtBottom) {
        DOM.scrollToBottomBtn.classList.add('hidden');
        unreadMessagesCount = 0;
        DOM.unreadCount.textContent = '0';
    } else if (unreadMessagesCount > 0) {
        DOM.scrollToBottomBtn.classList.remove('hidden');
        DOM.unreadCount.textContent = unreadMessagesCount > 99 ? '99+' : unreadMessagesCount;
    }
}

function scrollToBottom() {
    if (!DOM.messagesList) return;

    DOM.messagesList.scrollTo({
        top: DOM.messagesList.scrollHeight,
        behavior: 'smooth'
    });

    unreadMessagesCount = 0;
    updateScrollButton();
}

function addUnreadMessage() {
    if (!isUserAtBottom) {
        unreadMessagesCount++;
        updateScrollButton();
        return false;
    }
    return true;
}

// ============================================================================
// 🔹 Пользователи
// ============================================================================
function updateUsersList(serverUsers) {
    try {
        if (!Array.isArray(serverUsers)) {
            console.warn('⚠️ updateUsersList: serverUsers is not an array');
            return;
        }
        
        const serverUserNames = new Set(serverUsers.map(u => u.username || u.name));

        users.forEach(user => {
            if (serverUserNames.has(user.name)) {
                const serverUser = serverUsers.find(u => (u.username || u.name) === user.name);
                if (serverUser) {
                    user.status = serverUser.status || (serverUser.online ? 'online' : 'offline');
                    user.activeChat = serverUser.activeChat || null;
                    user.isVisibleInDirectory = serverUser.isVisibleInDirectory !== false;
                }
            }
        });

        serverUsers.forEach(serverUser => {
            const name = serverUser.username || serverUser.name;
            if (!users.find(u => u.name === name)) {
                users.push({
                    name,
                    isPinned: false,
                    status: serverUser.status || (serverUser.online ? 'online' : 'offline'),
                    activeChat: serverUser.activeChat || null,
                    isVisibleInDirectory: serverUser.isVisibleInDirectory !== false
                });
            }
        });

        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        saveUsersToStorage();
        renderUsers();

        // Обновляем статус в заголовке если чат открыт
        if (selectedUser) {
            updateChatUserStatus(selectedUser);
        }
    } catch (e) {
        console.error('❌ updateUsersList error:', e);
    }
}

function updateUserStatus(username, status, activeChat = null) {
    if (!username || typeof username !== 'string') {
        console.warn('⚠️ updateUserStatus: invalid username');
        return;
    }
    
    const user = users.find(u => u.name === username);
    if (user) {
        user.status = status;
        user.activeChat = activeChat;
        saveUsersToStorage();
        renderUsers();

        // Обновляем статус в заголовке если это текущий выбранный пользователь
        if (selectedUser === username) {
            updateChatUserStatus(username);
        }
    }
}

function updateUserVisibility(username, isVisible) {
    if (!username || typeof username !== 'string' || typeof isVisible !== 'boolean') {
        console.warn('⚠️ updateUserVisibility: invalid params');
        return;
    }
    
    const user = users.find(u => u.name === username);
    if (user) {
        user.isVisibleInDirectory = isVisible;
        saveUsersToStorage();
        renderUsers();
    }
}

/**
 * Получить смайлик последнего сообщения пользователя
 * @param {string} username - Имя пользователя
 * @returns {string} - Смайлик сообщения
 */
function getLastMessageEmoji(username) {
    try {
        const messages = loadMessagesFromStorage(username);
        if (!messages || messages.length === 0) return '💬';

        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) return '💬';

        // Если сообщение зашифровано
        if (lastMessage.encrypted) {
            return '🔒';
        }

        // Если это наше сообщение
        if (lastMessage.sender === currentUser) {
            return '✉️';
        }

        // Если сообщение от пользователя
        return '💬';
    } catch (e) {
        console.error('❌ getLastMessageEmoji error:', e);
        return '💬';
    }
}

/**
 * Рендеринг списка пользователей
 * Безопасная вставка данных с использованием textContent
 */
function renderUsers() {
    if (!DOM.usersList) return;

    DOM.usersList.innerHTML = '';
    const searchQuery = DOM.searchBox ? DOM.searchBox.value.toLowerCase().trim() : '';
    const fragment = document.createDocumentFragment();

    users.forEach(userObj => {
        if (userObj.name === currentUser) return;

        // Показываем только пользователей с visibility: true или точное совпадение
        const isExactMatch = searchQuery === userObj.name.toLowerCase();
        if (!userObj.isVisibleInDirectory && !isExactMatch && !userVisibilityCache.get(userObj.name)) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.dataset.username = userObj.name;

        // Определяем класс статуса (для CSS)
        let statusClass = 'offline';
        if (selectedUser === userObj.name) {
            if (userObj.status === 'online') {
                statusClass = 'online';
            } else if (userObj.status === 'in_chat') {
                statusClass = 'in-chat';
            }
        }

        item.classList.add(statusClass);

        // Получаем смайлик последнего сообщения вместо индикатора статуса
        const messageEmoji = getLastMessageEmoji(userObj.name);

        // Создаём элементы безопасно (без innerHTML для пользовательских данных)
        const statusEl = document.createElement('span');
        statusEl.className = 'status';
        statusEl.textContent = messageEmoji; // Смайлик сообщения вместо статуса
        statusEl.setAttribute('aria-hidden', 'true');
        statusEl.title = 'Последнее сообщение';

        const nameEl = document.createElement('span');
        nameEl.className = 'name';
        nameEl.textContent = userObj.name; // Безопасная вставка через textContent

        item.appendChild(statusEl);
        item.appendChild(nameEl);

        fragment.appendChild(item);
    });

    DOM.usersList.appendChild(fragment);
    renderActiveChats();
}

/**
 * Рендеринг активных чатов
 */
function renderActiveChats() {
    if (!DOM.activeChatsList) return;

    DOM.activeChatsList.innerHTML = '';

    // ✨ Показываем пользователей, с которыми была переписка (activeChat) ИЛИ есть непрочитанные
    const activeChats = users.filter(u =>
        u.name !== currentUser &&
        (u.activeChat === currentUser || getUnreadMessagesCount(u.name) > 0) &&
        (u.status === 'online' || u.status === 'in_chat' || hasUnreadMessages(u.name))
    );

    if (activeChats.length === 0) {
        DOM.activeChatsList.style.display = 'none';
        return;
    }

    DOM.activeChatsList.style.display = 'block';
    const fragment = document.createDocumentFragment();

    activeChats.forEach(userObj => {
        const item = document.createElement('div');
        item.className = 'active-chat-item';
        item.dataset.username = userObj.name;

        // Отображаем статус вместо смайлика чата
        const chatIcon = document.createElement('span');
        chatIcon.className = 'chat-icon';
        chatIcon.setAttribute('aria-hidden', 'true');

        // Показываем статус пользователя
        if (userObj.status === 'online') {
            chatIcon.textContent = '🟢';
            chatIcon.title = 'Онлайн';
        } else if (userObj.status === 'in_chat') {
            chatIcon.textContent = '🔵';
            chatIcon.title = 'В чате';
        } else {
            chatIcon.textContent = '⚫';
            chatIcon.title = 'Офлайн';
        }

        const chatName = document.createElement('span');
        chatName.className = 'chat-name';
        chatName.textContent = userObj.name;

        // ✨ Счётчик непрочитанных
        const unreadCount = getUnreadMessagesCount(userObj.name);
        if (unreadCount > 0) {
            const unreadBadge = document.createElement('span');
            unreadBadge.className = 'unread-badge';
            unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            chatName.appendChild(unreadBadge);
        }

        // Кнопки действий
        const actionButtons = document.createElement('div');
        actionButtons.className = 'chat-actions';

        // Кнопка закрепить
        const pinBtn = document.createElement('button');
        pinBtn.className = 'chat-action-btn pin-btn' + (userObj.isPinned ? ' pinned' : '');
        pinBtn.type = 'button';
        pinBtn.textContent = '📌';
        pinBtn.title = 'Закрепить';
        pinBtn.setAttribute('aria-label', 'Закрепить чат');

        // Кнопка удалить чат
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'chat-action-btn delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Удалить чат';
        deleteBtn.setAttribute('aria-label', 'Удалить чат');

        actionButtons.appendChild(pinBtn);
        actionButtons.appendChild(deleteBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-chat';
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Закрыть';
        closeBtn.setAttribute('aria-label', 'Закрыть чат');

        item.appendChild(chatIcon);
        item.appendChild(chatName);
        item.appendChild(actionButtons);
        item.appendChild(closeBtn);

        fragment.appendChild(item);
    });

    DOM.activeChatsList.appendChild(fragment);
}

/**
 * ✨ Добавить чат в активные
 * @param {string} username - Имя пользователя
 */
function addChatToActive(username) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.activeChat = currentUser; // Показываем, что чат активен с текущим пользователем
        saveUsersToStorage();
        renderActiveChats();
    }
}

/**
 * ✨ Получить количество непрочитанных сообщений от пользователя
 * @param {string} username - Имя пользователя
 * @returns {number} - Количество непрочитанных
 */
function getUnreadMessagesCount(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return 0;
        
        const messages = JSON.parse(saved);
        return messages.filter(m => 
            m.sender === username && 
            !m.read && 
            m.deliveryStatus !== 'delivered'
        ).length;
    } catch (e) {
        return 0;
    }
}

/**
 * ✨ Проверить наличие непрочитанных сообщений
 * @param {string} username - Имя пользователя
 * @returns {boolean} - Есть ли непрочитанные
 */
function hasUnreadMessages(username) {
    return getUnreadMessagesCount(username) > 0;
}

/**
 * ✨ Увеличить счётчик непрочитанных
 * @param {string} username - Имя отправителя
 */
function incrementUnreadCount(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return;
        
        const messages = JSON.parse(saved);
        // Помечаем последние сообщения как непрочитанные
        messages.forEach(m => {
            if (m.sender === username && !m.read) {
                m.read = false;
            }
        });
        
        localStorage.setItem(key, JSON.stringify(messages));
        renderActiveChats();
    } catch (e) {
        console.error('❌ Increment unread count error:', e);
    }
}

/**
 * ✨ Пометить сообщения от пользователя как прочитанные
 * @param {string} username - Имя пользователя
 */
function markMessagesAsRead(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return;
        
        const messages = JSON.parse(saved);
        let hasChanges = false;
        
        messages.forEach(m => {
            if (m.sender === username && !m.read) {
                m.read = true;
                m.deliveryStatus = 'delivered';
                hasChanges = true;
            }
        });
        
        if (hasChanges) {
            localStorage.setItem(key, JSON.stringify(messages));
        }
        
        renderActiveChats();
    } catch (e) {
        console.error('❌ Mark as read error:', e);
    }
}

/**
 * Обновление выделения выбранного пользователя
 * @param {string|null} username - Имя пользователя или null
 */
function updateUserItemSelection(username) {
    const items = DOM.usersList?.querySelectorAll('.user-item');
    if (!items) return;
    
    items.forEach(item => {
        if (username) {
            item.classList.toggle('selected', item.dataset.username === username);
        } else {
            item.classList.remove('selected');
        }
    });
}

/**
 * Обновление статуса пользователя в заголовке
 * @param {string} username - Имя пользователя (собеседника!)
 */
function updateChatUserStatus(username) {
    if (!DOM.chatUserStatus) return;

    // Находим пользователя в списке
    const user = users.find(u => u.name === username);
    if (!user) {
        DOM.chatUserStatus.classList.add('hidden');
        return;
    }

    // Преобразуем статус
    const statusClass = user.status === 'in_chat' ? 'in-chat' : user.status;
    const statusLabels = {
        'online': 'Онлайн',
        'in-chat': 'В чате',
        'offline': 'Офлайн'
    };

    // Обновляем классы
    DOM.chatUserStatus.classList.remove('hidden', 'online', 'offline', 'in-chat');
    DOM.chatUserStatus.classList.add(statusClass);

    // Обновляем текст статуса
    const statusText = DOM.chatUserStatus.querySelector('.status-text');
    if (statusText) {
        statusText.textContent = statusLabels[statusClass] || 'Офлайн';
    }

    // Обновляем цвет точки статуса
    const statusDot = DOM.chatUserStatus.querySelector('.status-dot');
    if (statusDot) {
        const statusColors = {
            'online': 'var(--status-online)',
            'in-chat': 'var(--status-in-chat)',
            'offline': 'var(--status-offline)'
        };
        statusDot.style.background = statusColors[statusClass] || 'var(--status-offline)';
    }
}

/**
 * Выбор пользователя для чата
 * @param {string} username - Имя пользователя
 */
function selectUser(username) {
    if (!username) {
        console.warn('⚠️ selectUser: empty username');
        return;
    }
    
    // Не открываем чат с самим собой
    if (username === currentUser) {
        console.warn('⚠️ Cannot open chat with yourself');
        return;
    }
    
    selectedUser = username;

    if (DOM.chatTitle) {
        DOM.chatTitle.textContent = '💬 ' + username;
    }

    updateUserItemSelection(username);
    unreadMessagesCount = 0;
    isUserAtBottom = true;

    // ✨ Помечаем сообщения как прочитанные
    markMessagesAsRead(username);
    
    // ✨ Сбрасываем ответ на сообщение при смене чата
    if (replyToMessage) {
        replyToMessage = null;
        const replyIndicator = document.getElementById('replyIndicator');
        if (replyIndicator) replyIndicator.remove();
    }

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';

        const messages = loadMessagesFromStorage(username);
        if (messages && messages.length > 0) {
            const fragment = document.createDocumentFragment();
            messages.forEach(msg => {
                // Исправляем статус доставки для загруженных сообщений
                // Если сообщение не наше и статус pending, меняем на delivered
                if (msg.sender !== currentUser && msg.deliveryStatus === 'pending') {
                    msg.deliveryStatus = 'delivered';
                }
                // Если наше сообщение со статусом pending и прошло больше 5 секунд, меняем на sent
                if (msg.sender === currentUser && msg.deliveryStatus === 'pending') {
                    const msgAge = Date.now() - msg.timestamp;
                    if (msgAge > 5000) {
                        msg.deliveryStatus = 'sent';
                    }
                }

                const msgEl = createMessageElement(msg, msg.sender === currentUser);
                if (msgEl) fragment.appendChild(msgEl);
            });
            DOM.messagesList.appendChild(fragment);
            DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
        }
    }

    setInputPanelVisible(true);
    // Обновляем статус собеседника (не текущего пользователя!)
    updateChatUserStatus(username);
    checkMobileView();
    updateScrollButton();

    // Закрытие sidebar на мобильных после выбора пользователя
    if (window.innerWidth <= 768 && DOM.sidebar) {
        DOM.sidebar.classList.remove('mobile-visible');
    }

    sendToServer({ type: 'chat_open', chatWith: username });

    setTimeout(() => { if (DOM.messageBox) DOM.messageBox.focus(); }, 100);
}

/**
 * Показать общий чат
 */
function showGeneralChat() {
    selectedUser = null;
    
    if (DOM.chatTitle) {
        DOM.chatTitle.textContent = '💬 Общий чат';
    }

    updateUserItemSelection(null);

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';
    }

    DOM.chatUserStatus?.classList.add('hidden');
    checkMobileView();

    sendToServer({ type: 'chat_open', chatWith: null });
    setInputPanelVisible(false);
}

/**
 * Закрепление пользователя
 * @param {string} username - Имя пользователя
 */
function togglePin(username) {
    const userObj = users.find(u => u.name === username);
    if (userObj) {
        userObj.isPinned = !userObj.isPinned;
        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        saveUsersToStorage();
        renderUsers();
    }
}

/**
 * Удаление чата
 * @param {string} username - Имя пользователя
 * @param {HTMLElement} itemElement - Элемент списка
 */
function deleteChat(username, itemElement) {
    if (confirm('Удалить чат с "' + username + '"?')) {
        itemElement.style.opacity = '0';
        itemElement.style.pointerEvents = 'none';
        setTimeout(() => itemElement.remove(), 200);

        if (selectedUser === username) showGeneralChat();
        clearChatStorage(username);
        sendToServer({ type: 'delete_chat', chatName: username });
    }
}

// ============================================================================
// 🔹 Поиск
// ============================================================================
function searchUsers() {
    if (!DOM.searchBox) return;

    const query = DOM.searchBox.value.toLowerCase().trim();
    if (!query) {
        renderUsers();
        return;
    }

    // ✨ Ищем точное совпадение имени
    const exactMatch = users.find(u => u.name.toLowerCase() === query && u.name !== currentUser);

    const items = DOM.usersList?.querySelectorAll('.user-item');
    if (!items) return;

    items.forEach(item => {
        const nameEl = item.querySelector('.name');
        if (!nameEl) return;

        const name = nameEl.textContent.toLowerCase();
        let isVisible = false;

        // ✨ Упрощённый поиск: показываем все совпадения
        if (query.length >= 1) {
            isVisible = name.includes(query);
        }

        item.style.display = isVisible ? 'flex' : 'none';
    });
    
    // ✨ Если точное совпадение, показываем подсказку
    if (exactMatch) {
        showSearchHint('Нажмите Enter чтобы открыть чат с ' + exactMatch.name);
    }
}

/**
 * ✨ Показать подсказку поиска
 */
function showSearchHint(text) {
    // Удаляем предыдущую подсказку
    const existing = document.querySelector('.search-hint');
    if (existing) existing.remove();
    
    const hint = document.createElement('div');
    hint.className = 'search-hint';
    hint.textContent = text;
    hint.style.cssText = `
        padding: 8px 12px;
        background: var(--accent);
        color: white;
        font-size: 12px;
        text-align: center;
        cursor: pointer;
        animation: fadeIn 0.2s ease;
    `;
    hint.addEventListener('click', () => {
        const query = DOM.searchBox?.value.toLowerCase().trim();
        if (query) {
            const exactMatch = users.find(u => u.name.toLowerCase() === query && u.name !== currentUser);
            if (exactMatch) {
                selectUser(exactMatch.name);
                DOM.searchBox.value = '';
            }
        }
    });
    
    DOM.searchBox?.parentElement.appendChild(hint);
    setTimeout(() => hint.remove(), 3000);
}

function handleSearchEnter() {
    if (!DOM.searchBox) return;

    const query = DOM.searchBox.value.toLowerCase().trim();
    if (!query) return;

    // ✨ Ищем точное совпадение
    const exactMatch = users.find(u => u.name.toLowerCase() === query && u.name !== currentUser);

    if (exactMatch) {
        selectUser(exactMatch.name);
        DOM.searchBox.value = '';
        
        // ✨ Закрываем sidebar на мобильных после выбора
        if (window.innerWidth <= 768 && DOM.sidebar) {
            DOM.sidebar.classList.remove('mobile-visible');
        }
    } else {
        // ✨ Ищем частичное совпадение и открываем первого
        const partialMatch = users.find(u => u.name.toLowerCase().includes(query) && u.name !== currentUser);
        if (partialMatch) {
            selectUser(partialMatch.name);
            DOM.searchBox.value = '';
            
            // ✨ Закрываем sidebar на мобильных после выбора
            if (window.innerWidth <= 768 && DOM.sidebar) {
                DOM.sidebar.classList.remove('mobile-visible');
            }
        } else {
            showStatus('🔍 Пользователь не найден', true);
        }
    }
}

// ============================================================================
// 🔹 Контекстное меню
// ============================================================================
let contextMenuTarget = null;

function showFolderContextMenu(e, username) {
    contextMenuTarget = username;

    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const menuWidth = 180;
    const menuHeight = 150;
    menu.style.left = Math.min(e.pageX, window.innerWidth - menuWidth) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - menuHeight) + 'px';

    const currentFolderUser = getUserFolder(username);

    const items = [
        { folder: 'all', label: '📁 Все', active: currentFolderUser === 'all' },
        { divider: true },
        { folder: 'personal', label: '💕 Личное', active: currentFolderUser === 'personal' },
        { folder: 'work', label: '💼 Работа', active: currentFolderUser === 'work' }
    ];

    items.forEach(item => {
        if (item.divider) {
            const divider = document.createElement('div');
            divider.className = 'context-menu-divider';
            menu.appendChild(divider);
        } else {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item' + (item.active ? ' active' : '');
            menuItem.textContent = (item.active ? '✓ ' : '') + item.label;
            menuItem.dataset.folder = item.folder;
            menu.appendChild(menuItem);
        }
    });

    document.body.appendChild(menu);

    const cleanupMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };

    const closeMenu = (clickEvent) => {
        if (!menu.contains(clickEvent.target)) cleanupMenu();
    };

    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            setUserFolder(username, item.dataset.folder);
            cleanupMenu();
        });
    });

    setTimeout(() => {
        document.addEventListener('click', closeMenu, { once: true });
    }, 100);
}

function getUserFolder(username) {
    try {
        return localStorage.getItem(`chat_folder_${username}`) || 'all';
    } catch (e) {
        return 'all';
    }
}

function setUserFolder(username, folder) {
    try {
        localStorage.setItem(`chat_folder_${username}`, folder);
        renderUsers();
    } catch (e) {
        console.error('❌ Save folder error:', e);
    }
}

// ============================================================================
// 🔹 Отправка сообщений
// ============================================================================
function sendMessage() {
    if (!DOM.messageBox) return;

    const text = DOM.messageBox.value.trim();
    if (!text) return;

    // Проверка на максимальную длину
    if (text.length > MESSAGE_MAX_LENGTH) {
        showStatus('❌ Сообщение слишком длинное', true);
        return;
    }

    const encrypt = DOM.encryptCheckBox ? DOM.encryptCheckBox.checked : false;
    const key = DOM.encryptKeyBox ? DOM.encryptKeyBox.value.trim() : '';
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (encrypt && !key) {
        alert('⚠️ Введите ключ шифрования');
        return;
    }

    let messageText = text;
    let hint = '';

    if (encrypt) {
        messageText = xorEncrypt(text, key);
        hint = generateHint(key);
    }

    const message = {
        type: 'send_message',
        text: messageText,
        timestamp: Date.now(),
        privateTo: selectedUser || null,
        // Ответ на сообщение
        replyTo: replyToMessage ? {
            timestamp: replyToMessage.timestamp,
            sender: replyToMessage.sender,
            text: replyToMessage.text
        } : null
    };

    if (sendToServer(message)) {
        addMessage({
            sender: currentUser,
            text: messageText,
            time,
            timestamp: Date.now(),
            encrypted: encrypt,
            hint,
            deliveryStatus: 'pending',
            replyTo: message.replyTo
        }, true);

        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser,
                text: messageText,
                time,
                timestamp: Date.now(),
                encrypted: encrypt,
                hint: encrypt ? generateHint(key) : null,
                deliveryStatus: 'pending',
                replyTo: message.replyTo
            });

            // ✨ Добавляем чат в активные
            addChatToActive(selectedUser);
        }

        DOM.messageBox.value = '';

        // Сбрасываем ответ
        if (replyToMessage) {
            replyToMessage = null;
            const replyIndicator = document.getElementById('replyIndicator');
            if (replyIndicator) replyIndicator.remove();
        }

        if (encrypt && DOM.encryptCheckBox && DOM.encryptKeyBox) {
            DOM.encryptCheckBox.checked = false;
            DOM.encryptKeyBox.classList.add('hidden');
            DOM.encryptKeyBox.value = '';
        }
    } else {
        showStatus('❌ Не удалось отправить');
    }
}

// ============================================================================
// 🔹 Отображение сообщений
// ============================================================================
function createMessageElement(data, isOwn = false) {
    if (!data) return null;

    const message = document.createElement('div');
    const isCurrentUser = data.sender === currentUser || isOwn;
    message.className = 'message ' + (isCurrentUser ? 'own' : 'other');
    message.dataset.timestamp = data.timestamp;

    const displayText = data.encrypted
        ? '🔒 Зашифровано (подсказка: ' + escapeHtml(data.hint || '???') + ')'
        : escapeHtml(data.text);

    const deliveryStatus = data.deliveryStatus || 'sent';
    const checksHtml = getDeliveryStatusHtml(deliveryStatus);

    // Безопасное создание структуры
    if (!isCurrentUser) {
        const senderEl = document.createElement('div');
        senderEl.className = 'sender';
        senderEl.textContent = escapeHtml(data.sender);
        message.appendChild(senderEl);
    }

    // Ответ на сообщение (если есть) - безопасное создание без innerHTML
    if (data.replyTo) {
        const replyEl = document.createElement('div');
        replyEl.className = 'message-reply';
        
        const replySender = document.createElement('span');
        replySender.className = 'reply-sender';
        replySender.textContent = escapeHtml(data.replyTo.sender || '');
        replyEl.appendChild(replySender);
        
        const replyPreview = document.createElement('span');
        replyPreview.className = 'reply-preview';
        replyPreview.textContent = escapeHtml((data.replyTo.text || '').substring(0, 50));
        replyEl.appendChild(replyPreview);
        
        message.appendChild(replyEl);
    }

    const textEl = document.createElement('div');
    textEl.className = 'text';
    textEl.textContent = displayText;
    message.appendChild(textEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'meta';

    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = data.time || '';
    metaEl.appendChild(timeEl);

    if (isCurrentUser && checksHtml) {
        const checksEl = document.createElement('span');
        checksEl.innerHTML = checksHtml;
        metaEl.appendChild(checksEl);
    }

    message.appendChild(metaEl);

    if (data.encrypted) {
        message.dataset.encrypted = 'true';
        message.dataset.text = data.text;
        message.dataset.hint = data.hint;
        message.style.cursor = 'pointer';
        message.title = '🔓 Нажмите для расшифровки';
        message.addEventListener('click', () => {
            if (DOM.decryptPanel) {
                DOM.decryptPanel.classList.remove('hidden');
                DOM.decryptPanel.dataset.messageIndex = Array.from(DOM.messagesList.children).indexOf(message);
                if (DOM.decryptKeyBox) DOM.decryptKeyBox.focus();
            }
        });
    }

    // Контекстное меню для сообщений (правый клик)
    message.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, message, data, isCurrentUser);
    });

    // Клик по сообщению для ответа (двойной клик)
    message.addEventListener('dblclick', () => {
        if (!isCurrentUser && !data.encrypted) {
            replyToMessage = data;
            showReplyIndicator();
            if (DOM.messageBox) DOM.messageBox.focus();
        }
    });

    // ✨ Отображаем реакции если они есть
    if (data.reactions) {
        updateMessageReactions(message, data.reactions);
    }

    return message;
}

function getDeliveryStatusHtml(status) {
    switch (status) {
        case 'pending':
            return '<span class="checks pending" title="Отправка">⏳</span>';
        case 'sent':
            return '<span class="checks sent" title="Отправлено">✓</span>';
        case 'delivered':
        case 'read':
            return '<span class="checks delivered" title="Прочитано">✓✓</span>';
        default:
            return '<span class="checks">✓</span>';
    }
}

function addMessage(data, isOwn = false, scrollToBottom = true) {
    if (!DOM.messagesList) return;

    const message = createMessageElement(data, isOwn);
    if (!message) return;

    DOM.messagesList.appendChild(message);

    if (scrollToBottom) {
        DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
    }
}

// ============================================================================
// 🔹 Контекстное меню сообщений
// ============================================================================
/**
 * Показать контекстное меню для сообщения
 * @param {MouseEvent} e - Событие мыши
 * @param {HTMLElement} messageEl - Элемент сообщения
 * @param {Object} messageData - Данные сообщения
 * @param {boolean} isOwn - Своё ли сообщение
 */
function showMessageContextMenu(e, messageEl, messageData, isOwn) {
    // Закрываем предыдущее меню
    closeMessageContextMenu();

    messageContextMenuTarget = { messageEl, messageData, isOwn };
    messageEl.classList.add('context-menu-active');

    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.id = 'messageContextMenu';

    // Позиционирование меню
    const menuWidth = 200;
    const menuHeight = 180;
    const left = Math.min(e.pageX, window.innerWidth - menuWidth - 10);
    const top = Math.min(e.pageY, window.innerHeight - menuHeight - 10);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // ✨ Реакции (показываем всегда)
    const reactionsBtn = createMessageMenuItem('😊 Реакции', () => {
        showReactionPicker(e.pageX, e.pageY, messageData, messageEl);
        closeMessageContextMenu();
    });
    menu.appendChild(reactionsBtn);

    menu.appendChild(createMessageMenuDivider());

    // Копировать
    const copyBtn = createMessageMenuItem('📋 Копировать', () => {
        copyMessageText(messageData.text);
        closeMessageContextMenu();
    });
    menu.appendChild(copyBtn);

    // Ответить
    const replyBtn = createMessageMenuItem('↩️ Ответить', () => {
        replyToMessage = messageData;
        showReplyIndicator();
        closeMessageContextMenu();
        if (DOM.messageBox) DOM.messageBox.focus();
    });
    menu.appendChild(replyBtn);

    menu.appendChild(createMessageMenuDivider());

    // Удалить (только для своих сообщений)
    if (isOwn) {
        const deleteBtn = createMessageMenuItem('🗑️ Удалить у всех', () => {
            deleteMessage(messageData, messageEl);
            closeMessageContextMenu();
        }, 'danger');
        menu.appendChild(deleteBtn);
    }

    document.body.appendChild(menu);

    // Закрытие при клике вне меню
    setTimeout(() => {
        document.addEventListener('click', closeMenuOnClick, { once: true });
        document.addEventListener('scroll', closeMessageContextMenu, { once: true });
    }, 100);
}

/**
 * Создать элемент меню сообщения
 */
function createMessageMenuItem(text, onClick, isDanger = false) {
    const btn = document.createElement('button');
    btn.className = 'message-context-menu-item' + (isDanger ? ' danger' : '');
    btn.textContent = text;
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Создать разделитель меню
 */
function createMessageMenuDivider() {
    const divider = document.createElement('div');
    divider.className = 'message-context-menu-divider';
    return divider;
}

/**
 * Закрыть контекстное меню сообщений
 */
function closeMessageContextMenu() {
    const menu = document.getElementById('messageContextMenu');
    if (menu) menu.remove();

    if (messageContextMenuTarget?.messageEl) {
        messageContextMenuTarget.messageEl.classList.remove('context-menu-active');
    }
    messageContextMenuTarget = null;
}

/**
 * Закрытие меню при клике
 */
function closeMenuOnClick(e) {
    const menu = document.getElementById('messageContextMenu');
    if (menu && !menu.contains(e.target)) {
        closeMessageContextMenu();
    }
}

/**
 * ✨ Показать пикер реакций
 * @param {number} x - Координата X
 * @param {number} y - Координата Y
 * @param {Object} messageData - Данные сообщения
 * @param {HTMLElement} messageEl - Элемент сообщения
 */
function showReactionPicker(x, y, messageData, messageEl) {
    // Закрываем предыдущее меню
    const existingPicker = document.getElementById('reactionPicker');
    if (existingPicker) existingPicker.remove();

    const picker = document.createElement('div');
    picker.id = 'reactionPicker';
    picker.className = 'reaction-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Выберите реакцию');
    picker.style.cssText = `
        position: fixed;
        left: ${Math.min(x, window.innerWidth - 220)}px;
        top: ${y - 50}px;
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 8px;
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        width: 200px;
        z-index: 1003;
        box-shadow: 0 4px 20px var(--shadow-color);
        animation: fadeIn 0.2s ease;
    `;

    // ✨ Сортируем реакции по частоте использования
    const sortedReactions = getSortedReactions();
    
    // Обработчик закрытия
    const closePicker = (e) => {
        if (!picker.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closePicker);
            document.removeEventListener('keydown', handleEscKey);
        }
    };
    
    const handleEscKey = (e) => {
        if (e.key === 'Escape') {
            picker.remove();
            document.removeEventListener('click', closePicker);
            document.removeEventListener('keydown', handleEscKey);
        }
    };

    sortedReactions.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-btn';
        btn.textContent = emoji;
        btn.setAttribute('aria-label', `Реакция ${emoji}`);
        btn.setAttribute('type', 'button');
        btn.style.cssText = `
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 20px;
            padding: 4px 8px;
            border-radius: 6px;
            transition: background 0.2s;
        `;
        btn.addEventListener('mouseover', () => {
            btn.style.background = 'var(--element-bg)';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.background = 'transparent';
        });
        btn.addEventListener('click', () => {
            addReaction(messageData, messageEl, emoji);
            picker.remove();
            document.removeEventListener('click', closePicker);
            document.removeEventListener('keydown', handleEscKey);
        });
        picker.appendChild(btn);
    });

    document.body.appendChild(picker);

    // Закрытие при клике вне и по Esc
    setTimeout(() => {
        document.addEventListener('click', closePicker);
        document.addEventListener('keydown', handleEscKey);
    }, 100);
}

/**
 * ✨ Получить отсортированные по частоте реакции
 * @returns {string[]} - Массив смайликов
 */
function getSortedReactions() {
    // Получаем частоту из localStorage
    const saved = localStorage.getItem(`reaction_frequency_${currentUser}`);
    if (saved) {
        userReactionFrequency = JSON.parse(saved);
    }

    // Сортируем: сначала используемые, потом остальные
    const used = Object.keys(userReactionFrequency).sort((a, b) => 
        (userReactionFrequency[b] || 0) - (userReactionFrequency[a] || 0)
    );

    const unused = REACTION_EMOJIS.filter(e => !used.includes(e));

    return [...used, ...unused];
}

/**
 * ✨ Добавить реакцию на сообщение
 * @param {Object} messageData - Данные сообщения
 * @param {HTMLElement} messageEl - Элемент сообщения
 * @param {string} emoji - Смайлик реакции
 */
function addReaction(messageData, messageEl, emoji) {
    // Увеличиваем частоту использования
    userReactionFrequency[emoji] = (userReactionFrequency[emoji] || 0) + 1;
    localStorage.setItem(`reaction_frequency_${currentUser}`, JSON.stringify(userReactionFrequency));

    // Получаем текущие реакции сообщения
    const reactions = messageData.reactions || {};
    const userReactions = reactions[currentUser] || [];

    // Если уже есть такая реакция, убираем её (toggle)
    if (userReactions.includes(emoji)) {
        const index = userReactions.indexOf(emoji);
        userReactions.splice(index, 1);
    } else {
        userReactions.push(emoji);
    }

    reactions[currentUser] = userReactions;
    messageData.reactions = reactions;

    // ✨ Отправляем реакцию серверу
    sendToServer({
        type: 'message_reaction',
        timestamp: messageData.timestamp,
        reaction: emoji,
        add: userReactions.includes(emoji),
        privateTo: selectedUser || null
    });

    // Обновляем отображение
    updateMessageReactions(messageEl, reactions);

    // Сохраняем в localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const msg = messages.find(m => m.timestamp === messageData.timestamp);
        if (msg) {
            msg.reactions = reactions;
            localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
        }
    }
}

/**
 * ✨ Обновить отображение реакций на сообщении
 * @param {HTMLElement} messageEl - Элемент сообщения
 * @param {Object} reactions - Объект реакций
 */
function updateMessageReactions(messageEl, reactions) {
    // Удаляем старую панель реакций
    const existingReactions = messageEl.querySelector('.message-reactions');
    if (existingReactions) existingReactions.remove();

    // Собираем все реакции
    const allReactions = {};
    Object.values(reactions).forEach(userReacts => {
        userReacts.forEach(emoji => {
            allReactions[emoji] = (allReactions[emoji] || 0) + 1;
        });
    });

    if (Object.keys(allReactions).length === 0) return;

    // Создаём панель реакций
    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'message-reactions';
    reactionsBar.style.cssText = `
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,0.1);
    `;

    Object.entries(allReactions).forEach(([emoji, count]) => {
        const reactionEl = document.createElement('span');
        reactionEl.className = 'reaction-item';
        reactionEl.textContent = `${emoji}${count > 1 ? ` ${count}` : ''}`;
        reactionEl.style.cssText = `
            background: var(--element-bg);
            padding: 2px 6px;
            border-radius: 12px;
            font-size: 12px;
            cursor: pointer;
        `;
        reactionsBar.appendChild(reactionEl);
    });

    messageEl.querySelector('.meta')?.before(reactionsBar);
}

/**
 * Копировать текст сообщения
 */
function copyMessageText(text) {
    const cleanText = text.replace(/🔒 Зашифровано.*/g, '').trim();
    
    // Проверяем поддержку Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cleanText).then(() => {
            showTemporaryNotification('📋 Скопировано в буфер');
        }).catch(err => {
            console.warn('⚠️ Clipboard API error:', err);
            fallbackCopyText(cleanText);
        });
    } else {
        // Fallback для старых браузеров
        fallbackCopyText(cleanText);
    }
}

/**
 * Fallback метод копирования текста
 */
function fallbackCopyText(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (success) {
            showTemporaryNotification('📋 Скопировано в буфер');
        } else {
            showTemporaryNotification('❌ Ошибка копирования');
        }
    } catch (e) {
        console.error('❌ Fallback copy error:', e);
        showTemporaryNotification('❌ Ошибка копирования');
    }
}

/**
 * Показать индикатор ответа
 */
function showReplyIndicator() {
    if (!replyToMessage) return;

    // Удаляем предыдущий индикатор
    let existingIndicator = document.getElementById('replyIndicator');
    if (existingIndicator) existingIndicator.remove();

    const indicator = document.createElement('div');
    indicator.id = 'replyIndicator';
    indicator.className = 'reply-indicator';
    indicator.innerHTML = `
        <span class="reply-text">Ответ на сообщение: <strong>${escapeHtml(replyToMessage.sender)}</strong></span>
        <button class="reply-cancel" type="button" title="Отменить ответ">✕</button>
    `;

    // Вставляем перед панелью ввода
    const inputPanel = document.getElementById('inputPanel');
    if (inputPanel) {
        inputPanel.parentNode.insertBefore(indicator, inputPanel);
    }

    // Обработчик отмены
    const cancelBtn = indicator.querySelector('.reply-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            replyToMessage = null;
            indicator.remove();
        });
    }
}

/**
 * Удалить сообщение
 */
function deleteMessage(messageData, messageEl) {
    if (!messageData || !messageData.timestamp) {
        console.error('❌ deleteMessage: invalid messageData');
        return;
    }
    
    if (!confirm('Удалить это сообщение у всех пользователей?')) return;

    // Отправляем запрос на сервер
    sendToServer({
        type: 'delete_message',
        timestamp: messageData.timestamp,
        chatWith: selectedUser
    });

    // Удаляем из DOM
    if (messageEl && messageEl.parentNode) {
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'scale(0.9)';
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 200);
    }

    // Удаляем из localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const filteredMessages = messages.filter(m => m.timestamp !== messageData.timestamp);
        localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(filteredMessages));
    }
}

/**
 * Обработка удаления сообщения от сервера (удаление у всех)
 * @param {number} timestamp - Временная метка удалённого сообщения
 * @param {string} deletedBy - Кто удалил сообщение
 */
function handleRemoteMessageDelete(timestamp, deletedBy) {
    if (!DOM.messagesList || !timestamp) {
        console.warn('⚠️ handleRemoteMessageDelete: invalid params');
        return;
    }

    // Находим и удаляем сообщение из DOM
    const messages = DOM.messagesList.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            msg.style.opacity = '0';
            msg.style.transform = 'scale(0.9)';
            setTimeout(() => {
                if (msg.parentNode) {
                    msg.remove();
                }
            }, 200);
        }
    });

    // Удаляем из localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const filteredMessages = messages.filter(m => m.timestamp !== timestamp);
        localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(filteredMessages));
    }

    showTemporaryNotification('🗑️ Сообщение удалено пользователем ' + escapeHtml(deletedBy));
}

/**
 * ✨ Обработка реакции от сервера
 * @param {number} timestamp - Временная метка сообщения
 * @param {Object} reactions - Объект реакций
 */
function handleRemoteMessageReaction(timestamp, reactions) {
    if (!DOM.messagesList || !timestamp) {
        console.warn('⚠️ handleRemoteMessageReaction: invalid params');
        return;
    }

    // Находим сообщение в DOM
    const messages = DOM.messagesList.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            updateMessageReactions(msg, reactions);
        }
    });

    // Обновляем в localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const msg = messages.find(m => m.timestamp === timestamp);
        if (msg) {
            msg.reactions = reactions;
            localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
        }
    }
}

/**
 * Показать временное уведомление
 */
function showTemporaryNotification(text, duration = 2000) {
    const notification = document.createElement('div');
    notification.className = 'temporary-notification';
    notification.textContent = text;
    notification.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--accent);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        z-index: 10000;
        animation: fadeInOut 2s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), duration);
}

// ============================================================================
// 🔹 Расшифровка
// ============================================================================
function decryptMessage() {
    if (!DOM.decryptPanel || !DOM.decryptKeyBox || !DOM.messagesList) return;

    const key = DOM.decryptKeyBox.value.trim();
    if (!key) {
        alert('⚠️ Введите ключ расшифровки');
        return;
    }

    const messageIndex = DOM.decryptPanel.dataset.messageIndex;
    if (!messageIndex) {
        alert('⚠️ Сообщение не выбрано');
        return;
    }
    
    const messageEl = DOM.messagesList.children[messageIndex];

    if (messageEl && messageEl.dataset.encrypted === 'true') {
        try {
            const decrypted = xorDecrypt(messageEl.dataset.text, key);
            const textEl = messageEl.querySelector('.text');
            if (textEl) {
                textEl.textContent = decrypted;
            }
            messageEl.dataset.encrypted = 'false';
            messageEl.style.cursor = 'default';
            messageEl.title = '';
            DOM.decryptPanel.classList.add('hidden');
            DOM.decryptKeyBox.value = '';
        } catch (e) {
            console.error('❌ Decrypt error:', e);
            alert('❌ Неверный ключ');
        }
    }
}

// ============================================================================
// 🔹 Шифрование XOR
// ============================================================================
function xorEncrypt(text, passphrase) {
    if (!text || !passphrase) return text;
    try {
        // Кодируем UTF-8 строку в байты
        const encoder = new TextEncoder();
        const textBytes = encoder.encode(text);
        const keyBytes = encoder.encode(passphrase);
        
        const result = new Uint8Array(textBytes.length);
        for (let i = 0; i < textBytes.length; i++) {
            result[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
        }
        
        // Преобразуем байты в base64
        let binary = '';
        for (let i = 0; i < result.length; i++) {
            binary += String.fromCharCode(result[i]);
        }
        return btoa(binary);
    } catch (e) {
        console.error('❌ Encrypt error:', e);
        return text;
    }
}

function xorDecrypt(encryptedBase64, passphrase) {
    if (!encryptedBase64 || !passphrase) return encryptedBase64;
    try {
        // Декодируем base64 в байты
        const binary = atob(encryptedBase64);
        const result = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            result[i] = binary.charCodeAt(i);
        }
        
        const keyBytes = new TextEncoder().encode(passphrase);
        const decrypted = new Uint8Array(result.length);
        
        for (let i = 0; i < result.length; i++) {
            decrypted[i] = result[i] ^ keyBytes[i % keyBytes.length];
        }
        
        // Декодируем UTF-8 байты в строку
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (e) {
        console.error('❌ Decrypt error:', e);
        return encryptedBase64;
    }
}

function generateHint(passphrase) {
    if (!passphrase || passphrase.length < 2) return '??';
    return passphrase.substring(0, 2) + '*'.repeat(Math.max(0, passphrase.length - 2));
}

// ============================================================================
// 🔹 Уведомления
// ============================================================================
function playNotificationSound() {
    if (!soundEnabled || !DOM.notificationSound) return;
    
    try {
        DOM.notificationSound.currentTime = 0;
        DOM.notificationSound.volume = 0.5;
        const playPromise = DOM.notificationSound.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                // Игнорируем ошибки автовоспроизведения
                if (err.name !== 'NotAllowedError') {
                    console.warn('⚠️ Sound play error:', err.message);
                }
            });
        }
    } catch (e) {
        console.warn('⚠️ Sound error:', e.message);
    }
}

function requestAudioPermission() {
    if (DOM.notificationSound) {
        DOM.notificationSound.play().then(() => {
            DOM.notificationSound.pause();
            DOM.notificationSound.currentTime = 0;
        }).catch(() => {});
    }
}

function showBrowserNotification(data) {
    if (!DOM.pushNotify || !DOM.pushNotify.checked) return;

    // Проверяем поддержку Notification API
    if (!('Notification' in window)) {
        console.warn('⚠️ Notifications not supported');
        return;
    }

    if (Notification.permission === 'granted') {
        try {
            new Notification('Client Messenger', {
                body: data.sender + ': ' + (data.encrypted ? '🔒 Зашифрованное' : data.text.substring(0, 50)),
                icon: '🔔',
                tag: data.sender, // Группировка уведомлений
                requireInteraction: false
            });
        } catch (e) {
            console.error('❌ Notification error:', e);
        }
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted' && DOM.pushNotify) {
                DOM.pushNotify.checked = true;
                saveSettings();
            } else if (permission === 'denied') {
                DOM.pushNotify.checked = false;
                saveSettings();
            }
        }).catch(err => console.warn('⚠️ Permission error:', err));
    }
}

// ============================================================================
// 🔹 Настройки
// ============================================================================
function initSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const logoutBtn = document.getElementById('logoutBtn');

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        if (DOM.settingsModal) {
            syncSettingsUI();
            DOM.settingsModal.classList.remove('hidden');
        }
    });

    if (closeSettings) closeSettings.addEventListener('click', () => {
        if (DOM.settingsModal) DOM.settingsModal.classList.add('hidden');
    });

    if (DOM.settingsModal) {
        DOM.settingsModal.addEventListener('click', (e) => {
            if (e.target === DOM.settingsModal) DOM.settingsModal.classList.add('hidden');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('🚪 Выйти из аккаунта?')) performLogout();
        });
    }

    if (DOM.soundNotify) {
        DOM.soundNotify.addEventListener('change', (e) => {
            soundEnabled = e.target.checked;
            saveSettings();
            if (soundEnabled) playNotificationSound();
        });
    }

    if (DOM.pushNotify) {
        DOM.pushNotify.addEventListener('change', (e) => {
            if (e.target.checked) {
                Notification.requestPermission().then(p => {
                    if (p !== 'granted') {
                        DOM.pushNotify.checked = false;
                        alert('⚠️ Разрешение не получено');
                    }
                });
            }
        });
    }

    if (DOM.fontSizeSelect) {
        DOM.fontSizeSelect.addEventListener('change', (e) => {
            const size = e.target.value;
            document.body.classList.remove('font-small', 'font-medium', 'font-large');
            document.body.classList.add('font-' + (size === '12' ? 'small' : size === '16' ? 'large' : 'medium'));
            saveSettings();
        });
    }

    if (DOM.themeSelect) {
        DOM.themeSelect.addEventListener('change', (e) => {
            document.documentElement.setAttribute('data-theme', e.target.value);
            saveSettings();
        });
    }

    if (DOM.accentColorSelect) {
        DOM.accentColorSelect.addEventListener('change', (e) => {
            const color = e.target.value;
            document.documentElement.style.setProperty('--accent', color);
            document.documentElement.style.setProperty('--accent-hover', adjustColorBrightness(color, 20));
            saveSettings();
        });
    }

    if (DOM.messageColorSelect) {
        DOM.messageColorSelect.addEventListener('change', (e) => {
            const color = e.target.value;
            document.documentElement.style.setProperty('--own-message-bg', color);
            saveSettings();
        });
    }

    if (DOM.showInDirectory) {
        DOM.showInDirectory.addEventListener('change', (e) => {
            isVisibleInDirectory = e.target.checked;
            saveSettings();
            sendToServer({ type: 'update_visibility', isVisible: isVisibleInDirectory });
        });
    }
}

function syncSettingsUI() {
    if (DOM.themeSelect) {
        DOM.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'dark';
    }

    if (DOM.accentColorSelect) {
        const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (currentAccent) {
            DOM.accentColorSelect.value = currentAccent;
        }
    }

    if (DOM.messageColorSelect) {
        const currentMessageColor = getComputedStyle(document.documentElement).getPropertyValue('--own-message-bg').trim();
        if (currentMessageColor) {
            DOM.messageColorSelect.value = currentMessageColor;
        }
    }

    if (DOM.fontSizeSelect) {
        let currentSize = '14';
        if (document.body.classList.contains('font-small')) currentSize = '12';
        else if (document.body.classList.contains('font-large')) currentSize = '16';
        DOM.fontSizeSelect.value = currentSize;
    }

    if (DOM.showInDirectory) {
        DOM.showInDirectory.checked = isVisibleInDirectory;
    }
}

/**
 * Изменение яркости цвета
 * @param {string} hex - HEX цвет (#RRGGBB)
 * @param {number} percent - Процент изменения (положительный = светлее, отрицательный = темнее)
 * @returns {string} - Новый цвет в HEX
 */
function adjustColorBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

/**
 * ✨ Изменение прозрачности цвета (смешивание с чёрным)
 * @param {string} hex - HEX цвет (#RRGGBB)
 * @param {number} opacity - Прозрачность (0-1)
 * @returns {string} - Новый цвет в HEX
 */
function adjustColorOpacity(hex, opacity) {
    const num = parseInt(hex.replace('#', ''), 16);
    const R = Math.round(((num >> 16) & 0xFF) * opacity);
    const G = Math.round(((num >> 8) & 0xFF) * opacity);
    const B = Math.round((num & 0xFF) * opacity);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// ============================================================================
// 🔹 Горячие клавиши
// ============================================================================
function initHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            if (DOM.searchBox) {
                DOM.searchBox.focus();
                DOM.searchBox.select();
            }
        }

        if (e.key === 'Escape') {
            if (DOM.settingsModal && !DOM.settingsModal.classList.contains('hidden')) {
                DOM.settingsModal.classList.add('hidden');
            } else if (selectedUser) {
                showGeneralChat();
            }
            // Закрываем контекстное меню пользователей
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu) contextMenu.remove();
            // Закрываем контекстное меню сообщений
            closeMessageContextMenu();
            // Сбрасываем ответ на сообщение
            if (replyToMessage) {
                replyToMessage = null;
                const replyIndicator = document.getElementById('replyIndicator');
                if (replyIndicator) replyIndicator.remove();
            }
        }
    });
}

// ============================================================================
// 🔹 Авто-вход и сессии
// ============================================================================

/**
 * Простое хеширование строки (не криптография, только для сессии!)
 * @param {string} str - Строка для хеширования
 * @returns {string} - Хеш
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * Автоматический вход по сохранённой сессии
 * @returns {boolean} - Успешно ли выполнен вход
 */
function autoLogin() {
    try {
        const session = localStorage.getItem(AUTH_SESSION_KEY);
        if (session) {
            const sessionData = JSON.parse(session);
            const now = Date.now();
            const sessionAge = now - (sessionData.timestamp || 0);
            const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 дней

            if (sessionAge < SESSION_MAX_AGE && sessionData.username && sessionData.passwordHash) {
                currentUser = sessionData.username;
                try {
                    window.currentUserPassword = atob(sessionData.passwordHash);
                } catch (decodeErr) {
                    console.error('❌ Password decode error:', decodeErr);
                    localStorage.removeItem(AUTH_SESSION_KEY);
                    return false;
                }
                
                connectToServer({
                    type: 'login',
                    username: currentUser,
                    password: window.currentUserPassword
                });
                console.log('✅ Auto-login successful for:', currentUser);
                return true;
            } else {
                localStorage.removeItem(AUTH_SESSION_KEY);
            }
        }
    } catch (e) {
        console.error('❌ Auto-login error:', e);
        localStorage.removeItem(AUTH_SESSION_KEY);
    }
    return false;
}

/**
 * Сохранение сессии пользователя
 * @param {string} username - Имя пользователя
 * @param {string} password - Пароль
 */
function saveAuthSession(username, password) {
    try {
        const sessionData = {
            username: username,
            passwordHash: btoa(password),
            passwordHint: password.substring(0, 2) + '*'.repeat(Math.max(0, password.length - 2)),
            timestamp: Date.now(),
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 дней
        };
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
        console.log('💾 Session saved for:', username);
    } catch (e) {
        console.error('❌ Save session error:', e);
        // Очищаем чувствительные данные при ошибке
        try {
            localStorage.removeItem(AUTH_SESSION_KEY);
        } catch (clearErr) {
            console.error('❌ Clear session error:', clearErr);
        }
    }
}

/**
 * Выход из аккаунта
 */
function performLogout() {
    // Закрываем модальное окно настроек
    if (DOM.settingsModal) {
        DOM.settingsModal.classList.add('hidden');
    }

    // Отправляем запрос на сервер
    sendToServer({ type: 'logout' });

    // Закрываем WebSocket соединение
    if (socket) {
        try {
            socket.close(1000, 'User logout');
        } catch (e) {
            console.warn('⚠️ Socket close error:', e);
        }
        socket = null;
    }

    // Очищаем сессию
    localStorage.removeItem(AUTH_SESSION_KEY);

    // Сбрасываем состояние
    currentUser = null;
    selectedUser = null;
    users = [];
    window.currentUserPassword = null;
    replyToMessage = null;
    messageContextMenuTarget = null;

    // Переключаем окна
    DOM.chatWindow?.classList.add('hidden');
    DOM.loginWindow?.classList.remove('hidden');

    // Очищаем поля ввода
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    if (loginUsername) loginUsername.value = '';
    if (loginPassword) loginPassword.value = '';

    // Очищаем статус
    const loginStatus = document.getElementById('loginStatus');
    if (loginStatus) loginStatus.textContent = '';

    console.log('🚪 User logged out');
}

// ============================================================================
// 🔹 LocalStorage
// ============================================================================
function saveUsersToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch (e) {
        console.error('❌ Save users error:', e);
        // Обработка переполнения хранилища
        if (e.name === 'QuotaExceededError') {
            console.warn('⚠️ LocalStorage quota exceeded for users');
            // Пытаемся освободить место, удаляя старые сообщения
            try {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith('chat_messages_')) {
                        localStorage.removeItem(key);
                    }
                });
                // Пробуем сохранить снова
                localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
            } catch (retryErr) {
                console.error('❌ Retry save users error:', retryErr);
            }
        }
    }
}

function loadSavedUsers() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.USERS);
        if (saved) {
            users = JSON.parse(saved);
        }
    } catch (e) {
        console.error('❌ Load users error:', e);
        users = [];
    }
}

function saveMessageToStorage(username, message) {
    try {
        if (!currentUser || !username) {
            console.warn('⚠️ saveMessageToStorage: missing currentUser or username');
            return;
        }
        
        const key = `chat_messages_${currentUser}_${username}`;
        let messages = loadMessagesFromStorage(username);

        messages.push(message);

        if (messages.length > MAX_MESSAGES_IN_STORAGE) {
            messages = messages.slice(-MAX_MESSAGES_IN_STORAGE);
        }

        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) {
        console.error('❌ Save message error:', e);
        // Обработка переполнения хранилища
        if (e.name === 'QuotaExceededError') {
            console.warn('⚠️ LocalStorage quota exceeded, clearing old messages...');
            try {
                localStorage.clear();
            } catch (clearErr) {
                console.error('❌ Clear storage error:', clearErr);
            }
        }
    }
}

function loadMessagesFromStorage(username) {
    try {
        if (!username) return [];
        
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return [];
        
        const parsed = JSON.parse(saved);
        // Валидация данных
        if (!Array.isArray(parsed)) return [];
        
        // Фильтруем невалидные сообщения
        return parsed.filter(m => 
            m && 
            typeof m === 'object' && 
            typeof m.sender === 'string' && 
            typeof m.text === 'string' && 
            typeof m.timestamp === 'number'
        );
    } catch (e) {
        console.error('❌ Load messages error:', e);
        return [];
    }
}

function clearChatStorage(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        localStorage.removeItem(key);
    } catch (e) {
        console.error('❌ Clear chat error:', e);
    }
}

// ============================================================================
// 🔹 Настройки (тема, шрифт, цвет)
// ============================================================================
function loadSettings() {
    try {
        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (!settings) return;
        
        const data = JSON.parse(settings);
        if (!data || typeof data !== 'object') {
            console.warn('⚠️ loadSettings: invalid data format');
            return;
        }

        if (data.theme) {
            document.documentElement.setAttribute('data-theme', data.theme);
            if (DOM.themeSelect) DOM.themeSelect.value = data.theme;
        }

        if (data.accentColor) {
            document.documentElement.style.setProperty('--accent', data.accentColor);
            document.documentElement.style.setProperty('--accent-hover', adjustColorBrightness(data.accentColor, 20));
            if (DOM.accentColorSelect) DOM.accentColorSelect.value = data.accentColor;
        }

        if (data.messageColor) {
            document.documentElement.style.setProperty('--own-message-bg', data.messageColor);
            if (DOM.messageColorSelect) DOM.messageColorSelect.value = data.messageColor;
        }

        if (data.fontSize) {
            document.body.classList.remove('font-small', 'font-medium', 'font-large');
            document.body.classList.add('font-' + data.fontSize);
            if (DOM.fontSizeSelect) DOM.fontSizeSelect.value = data.fontSize;
        }

        if (typeof data.soundEnabled === 'boolean') {
            soundEnabled = data.soundEnabled;
            if (DOM.soundNotify) DOM.soundNotify.checked = data.soundEnabled;
        }

        if (typeof data.isVisibleInDirectory === 'boolean') {
            isVisibleInDirectory = data.isVisibleInDirectory;
            if (DOM.showInDirectory) DOM.showInDirectory.checked = data.isVisibleInDirectory;
        }
    } catch (e) {
        console.error('❌ Load settings error:', e);
    }
}

function saveSettings() {
    try {
        const settings = {
            theme: DOM.themeSelect?.value || 'dark',
            accentColor: DOM.accentColorSelect?.value || '#7B2CBF',
            messageColor: DOM.messageColorSelect?.value || '#7B2CBF',
            fontSize: DOM.fontSizeSelect?.value || '14',
            soundEnabled: DOM.soundNotify?.checked ?? true,
            isVisibleInDirectory: DOM.showInDirectory?.checked ?? false
        };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
        console.error('❌ Save settings error:', e);
    }
}

// ============================================================================
// 🔹 Утилиты
// ============================================================================
function setInputPanelVisible(isVisible) {
    if (!DOM.inputPanel || !DOM.chatPlaceholder || !DOM.messagesList) return;

    DOM.inputPanel.classList.toggle('hidden', !isVisible);
    DOM.chatPlaceholder.classList.toggle('hidden', isVisible);
    DOM.messagesList.classList.toggle('hidden', !isVisible);

    if (isVisible && DOM.messagesList) {
        DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
    }
}
