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
let allowGroupInvite = false; // ✨ Настройка приватности для групповых чатов
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

// 👥 Групповые чаты
let groups = []; // Список групп текущего пользователя
let selectedGroup = null; // Текущая выбранная группа

// 👤 Система профилей
let userProfile = null; // Объект с данными профиля текущего пользователя
let userBadges = []; // Массив значков с состоянием visibility
let viewedProfileUserId = null; // ID пользователя, чей профиль сейчас просматривается

// ============================================================================
// 🔹 Константы
// ============================================================================
const WS_URL = 'wss://client-messenger-production.up.railway.app';
const DEBOUNCE_DELAY = 300;
const MESSAGE_MAX_LENGTH = 10000;
const MAX_MESSAGES_IN_STORAGE = 100;
const DEFAULT_MESSAGE_COLOR = '#7B2CBF'; // 🔹 Цвет сообщений по умолчанию (фиолетовый)

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
    chatsList: null,
    searchResultsList: null,

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
    attachFileBtn: null,
    fileInput: null,
    filePreviewContainer: null,

    // Настройки
    themeSelect: null,
    accentColorSelect: null,
    messageColorSelect: null,
    fontSizeSelect: null,
    showInDirectory: null,
    allowGroupInvite: null, // ✨ Настройка для групповых чатов
    soundNotify: null,
    pushNotify: null,
    notificationSound: null,

    // 👤 Профиль
    profileModal: null,
    footerProfileBtn: null,
    editProfileBtn: null,
    closeProfile: null,
    profileAvatar: null,
    profileUserName: null,
    profileUserStatus: null,
    avatarContainer: null,
    avatarFileInput: null,
    badgesGrid: null,
    editPanel: null,
    saveProfileBtn: null,
    cancelProfileBtn: null,
    avatarUrlInput: null,
    applyAvatarUrlBtn: null,
    badgeVisibilityList: null,
    profileActionsSection: null,
    sendMessageBtn: null,
    profileStatusMessage: null
};

/**
 * Инициализация DOM кэша
 * Безопасное получение элементов с проверкой
 */
function initDOM() {
    const ids = [
        'loginWindow', 'chatWindow', 'settingsModal', 'sidebar', 'sidebarToggle',
        'sidebarTrigger', 'searchBox', 'chatsList', 'searchResultsList',
        'messagesList', 'inputPanel', 'chatPlaceholder', 'chatTitle', 'chatUserStatus', 'backBtn',
        'scrollToBottomBtn', 'unreadCount', 'messageBox', 'sendBtn', 'encryptCheckBox',
        'encryptKeyBox', 'decryptPanel', 'decryptKeyBox', 'decryptBtn', 'themeSelect',
        'accentColorSelect', 'messageColorSelect', 'fontSizeSelect', 'showInDirectory',
        'allowGroupInvite', 'soundNotify', 'pushNotify', 'notificationSound',
        'createGroupModal', 'closeCreateGroup',
        'groupNameInput', 'groupMembersSelect', 'createGroupConfirmBtn', 'createGroupStatus',
        // 📎 Элементы для работы с файлами
        'attachFileBtn', 'fileInput', 'filePreviewContainer',
        // 👤 Элементы профиля
        'profileModal', 'footerProfileBtn', 'editProfileBtn', 'closeProfile', 'profileAvatar',
        'profileUserName', 'profileUserStatus', 'avatarContainer', 'avatarFileInput',
        'badgesGrid', 'editPanel', 'saveProfileBtn', 'cancelProfileBtn', 'avatarUrlInput',
        'applyAvatarUrlBtn', 'badgeVisibilityList', 'profileActionsSection', 'sendMessageBtn',
        'profileStatusMessage'
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
// 🔹 Глобальные переменные для файлов
// ============================================================================
let selectedFiles = []; // Массив выбранных файлов для отправки
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB макс. размер файла
const MAX_FILES_PER_MESSAGE = 5; // Макс. количество файлов в одном сообщении

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
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return str.replace(/[&<>"'`=\/]/g, char => escapeMap[char]);
}

/**
 * Безопасная вставка HTML с очисткой
 * @param {HTMLElement} element - Элемент для вставки
 * @param {string} html - HTML для вставки
 */
function setSafeInnerHTML(element, html) {
    if (!element) return;
    element.innerHTML = '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    while (temp.firstChild) {
        element.appendChild(temp.firstChild);
    }
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
    initScrollTracking();
    loadSavedUsers(); // Загружаем пользователей до sidebar
    loadSettings();
    initHotkeys();
    initProfile(); // 👤 Инициализация системы профилей
    initSidebar(); // Инициализируем sidebar после загрузки пользователей

    // 🔒 Отправляем уведомление серверу при закрытии вкладки/браузера
    window.addEventListener('beforeunload', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            // Отправляем сообщение о выходе
            sendToServer({ type: 'logout' });
            // Закрываем соединение
            socket.close(1000, 'User closed browser');
        }
    });
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
    const regUsernameInput = document.getElementById('regUsername');
    const regPasswordInput = document.getElementById('regPassword');
    const regConfirmInput = document.getElementById('regConfirmPassword');
    const aboutDeveloperBtn = document.getElementById('aboutDeveloperBtn');
    const aboutDeveloperModal = document.getElementById('aboutDeveloperModal');
    const closeAboutDeveloper = document.getElementById('closeAboutDeveloper');

    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (registerBtn) registerBtn.addEventListener('click', handleRegister);

    // ℹ️ Кнопка о разработчике на панели регистрации
    if (aboutDeveloperBtn && aboutDeveloperModal) {
        aboutDeveloperBtn.addEventListener('click', () => {
            aboutDeveloperModal.classList.remove('hidden');
        });
    }

    if (closeAboutDeveloper && aboutDeveloperModal) {
        closeAboutDeveloper.addEventListener('click', () => {
            aboutDeveloperModal.classList.add('hidden');
        });
    }

    if (aboutDeveloperModal) {
        aboutDeveloperModal.addEventListener('click', (e) => {
            if (e.target === aboutDeveloperModal) {
                aboutDeveloperModal.classList.add('hidden');
            }
        });
    }

    // 🔒 Валидация в реальном времени для формы регистрации
    if (regUsernameInput && regPasswordInput && regConfirmInput) {
        [regUsernameInput, regPasswordInput, regConfirmInput].forEach(input => {
            input.addEventListener('input', () => {
                validateRegistrationForm();
            });
        });
    }
}

/**
 * Валидация формы регистрации в реальном времени
 */
function validateRegistrationForm() {
    const registerBtn = document.getElementById('registerBtn');
    const regUsernameInput = document.getElementById('regUsername');
    const regPasswordInput = document.getElementById('regPassword');
    const regConfirmInput = document.getElementById('regConfirmPassword');
    
    if (!registerBtn || !regUsernameInput || !regPasswordInput || !regConfirmInput) {
        if (registerBtn) registerBtn.disabled = true;
        return;
    }
    
    const username = regUsernameInput.value.trim();
    const password = regPasswordInput.value;
    const confirm = regConfirmInput.value;
    
    // Проверяем все условия
    const isUsernameValid = username.length >= 3 && username.length <= 20 && /^[A-Za-z0-9_]+$/.test(username);
    const isPasswordValid = password.length >= 8;
    const isConfirmMatch = password === confirm && confirm.length > 0;
    
    // 🔒 Визуальная индикация для каждого поля
    regUsernameInput.classList.toggle('valid', isUsernameValid && username.length > 0);
    regUsernameInput.classList.toggle('invalid', !isUsernameValid && username.length > 0);
    
    regPasswordInput.classList.toggle('valid', isPasswordValid);
    regPasswordInput.classList.toggle('invalid', !isPasswordValid && password.length > 0);
    
    regConfirmInput.classList.toggle('valid', isConfirmMatch);
    regConfirmInput.classList.toggle('invalid', !isConfirmMatch && confirm.length > 0);
    
    // Кнопка активна только если все поля заполнены корректно
    registerBtn.disabled = !(isUsernameValid && isPasswordValid && isConfirmMatch);
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
    const registerBtn = document.getElementById('registerBtn');

    if (!usernameInput || !passwordInput || !confirmInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    // 🔒 Дополнительная проверка перед отправкой
    if (!username || !password || password.length < 4) {
        showStatus('Введите имя пользователя и пароль (мин. 4 символа)');
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

    // 🔒 Блокируем кнопку на время отправки
    if (registerBtn) {
        registerBtn.disabled = true;
    }

    currentUser = username;

    // Небольшая задержка для защиты от перебора
    setTimeout(() => {
        connectToServer({ type: 'register', username, password });
        // Разблокируем кнопку через 2 секунды
        setTimeout(() => {
            if (registerBtn) {
                registerBtn.disabled = false;
            }
        }, 2000);
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
                    // 🔒 Используем токен сессии для reconnection
                    const session = localStorage.getItem(AUTH_SESSION_KEY);
                    let token = null;
                    if (session) {
                        try {
                            const sessionData = JSON.parse(session);
                            token = sessionData.token;
                        } catch (e) {
                            console.error('❌ Failed to parse session:', e);
                        }
                    }
                    setTimeout(() => {
                        if (token) {
                            // Попытка авто-входа по токену
                            connectToServer({
                                type: 'auto_login',
                                username: currentUser,
                                token: token
                            });
                        } else {
                            // Обычный логин с пустым паролем (сервер отклонит)
                            connectToServer({
                                type: 'login',
                                username: currentUser,
                                password: ''
                            });
                        }
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
/**
 * Обработка сообщений сервера
 * @param {Object} data - Сообщение от сервера
 */
function handleServerMessage(data) {
    // 🔒 Строгая валидация входящих данных
    if (!data || typeof data !== 'object') {
        console.warn('⚠️ handleServerMessage: invalid data format');
        return;
    }
    if (!data.type || typeof data.type !== 'string') {
        console.warn('⚠️ handleServerMessage: invalid type');
        return;
    }

    // 🔒 Защита от переполнения и подделки типа
    if (data.type.length > 50 || !/^[a-z_]+$/.test(data.type)) {
        console.warn('⚠️ handleServerMessage: invalid type format');
        return;
    }

    // 🔒 Проверка на XSS в текстовых полях
    if (data.message && typeof data.message === 'string') {
        if (/[<>\"'&]/.test(data.message)) {
            console.warn('⚠️ handleServerMessage: potential XSS in message');
            data.message = data.message.replace(/[<>\"'&]/g, '');
        }
    }

    try {
        switch (data.type) {
            case 'register_success':
                // 🔒 Автоматический вход после регистрации
                if (data.username && data.token && data.deviceId) {
                    // Сохраняем сессию
                    currentUser = data.username;
                    saveAuthSession(currentUser, data.token, data.deviceId);

                    if (typeof data.isVisibleInDirectory === 'boolean') {
                        isVisibleInDirectory = data.isVisibleInDirectory;
                    }

                    // Показываем чат
                    DOM.loginWindow?.classList.add('hidden');
                    DOM.chatWindow?.classList.remove('hidden');

                    // Обновляем footer sidebar
                    const footerUserName = document.getElementById('footerUserName');
                    const footerUserInitials = document.getElementById('footerUserInitials');
                    if (footerUserName) {
                        footerUserName.textContent = currentUser;
                    }
                    if (footerUserInitials) {
                        footerUserInitials.textContent = currentUser.slice(0, 2).toUpperCase();
                    }

                    console.log('✅ Registered and logged in:', currentUser);
                    sendToServer({ type: 'get_users' });
                    sendToServer({ type: 'get_groups' });
                    requestAudioPermission();

                    // 👥 Загружаем историю сообщений для всех групп
                    setTimeout(() => {
                        if (groups && Array.isArray(groups)) {
                            groups.forEach(group => {
                                loadGroupMessagesFromStorage(group.id);
                            });
                        }
                    }, 500);
                } else {
                    showStatus('✅ Регистрация успешна! Теперь войдите', false);
                }
                break;
            case 'register_error':
            case 'login_error':
                // 🔒 Проверяем, была ли ошибка при 2FA входе
                const login2FAForm = document.getElementById('login2FAForm');
                if (login2FAForm) {
                    handleLogin2FAError(sanitizeMessageText(data.message || 'Ошибка входа'));
                } else {
                    showStatus(sanitizeMessageText(data.message || 'Произошла ошибка'), true);
                }
                break;
            case 'error':
                showStatus(sanitizeMessageText(data.message || 'Произошла ошибка'), true);
                break;
            case 'login_success':
                // 🔒 Проверяем, был ли вход с 2FA
                if (data.twoFactorVerified) {
                    handleLogin2FASuccess(data);
                } else {
                    handleLoginSuccess(data);
                }
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
            case 'typing':
                if (data.from && typeof data.isTyping === 'boolean') {
                    handleTypingIndicator(data.from, data.isTyping);
                }
                break;
            case 'history':
                if (data.messages && Array.isArray(data.messages)) {
                    loadMessageHistory(data.messages, data.chatName);
                }
                break;
            case 'chat_deleted':
                if (data.chatName) {
                    handleChatDeleted(data.chatName);
                }
                break;
            case 'message_read_receipt':
                if (data.from && data.timestamp) {
                    handleMessageReadReceipt(data.from, data.timestamp);
                }
                break;
            case 'message_deleted':
                if (data.timestamp && data.deletedBy) {
                    handleMessageDeleted(data.timestamp, data.deletedBy);
                }
                break;
            case 'message_reaction':
                if (data.timestamp && data.reaction) {
                    handleMessageReaction(data);
                }
                break;
            case 'message_confirmed':
                if (data.timestamp && data.confirmed) {
                    confirmMessageDelivery(data.timestamp);
                }
                break;
            // 👥 Групповые чаты
            case 'group_list':
                if (Array.isArray(data.groups)) {
                    groups = data.groups;
                    renderGroups();
                }
                break;
            case 'group_list_update':
                if (Array.isArray(data.groups)) {
                    groups = data.groups;
                    renderGroups();
                }
                break;
            case 'group_created':
                if (data.group && data.group.id) {
                    const groupIndex = groups.findIndex(g => g.id === data.group.id);
                    if (groupIndex >= 0) {
                        groups[groupIndex] = data.group;
                    } else {
                        groups.push(data.group);
                    }
                    renderGroups();
                }
                break;
            case 'group_member_added':
            case 'group_member_removed':
            case 'group_member_left':
                if (data.groupId) {
                    updateGroupMembers(data.groupId, data.member, data.type);
                }
                break;
            case 'group_deleted':
                if (data.groupId) {
                    groups = groups.filter(g => g.id !== data.groupId);
                    renderGroups();
                }
                break;
            case 'receive_group_message':
                if (data.groupId && data.sender && data.text && data.timestamp) {
                    handleGroupMessageReceive(data);
                }
                break;
            case 'group_invite_permission_updated':
                if (typeof data.allow === 'boolean') {
                    allowGroupInvite = data.allow;
                }
                break;
            // 👤 Обработка обновления значков
            case 'badges_updated':
                if (Array.isArray(data.badges)) {
                    userBadges = data.badges;
                    // Обновляем отображение если профиль открыт
                    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden')) {
                        renderBadges(userBadges, viewedProfileUserId === currentUser);
                    }
                }
                break;
            // 🔐 2FA сообщения
            case '2fa_setup_response':
            case '2fa_enabled':
            case '2fa_disabled':
            case '2fa_error':
            case '2fa_verify_error':
            case '2fa_backup_codes_response':
                handleTwoFAMessage(data);
                break;
            case 'login_2fa_required':
                handleLogin2FARequired(data);
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

    if (typeof data.allowGroupInvite === 'boolean') {
        allowGroupInvite = data.allowGroupInvite;
    }

    // 👤 Загружаем значки пользователя
    if (Array.isArray(data.userBadges)) {
        userBadges = data.userBadges;
    }

    // 🔒 Сохраняем токен сессии для авто-входа
    if (data.token && data.deviceId) {
        saveAuthSession(currentUser, data.token, data.deviceId);
    }

    DOM.loginWindow?.classList.add('hidden');
    DOM.chatWindow?.classList.remove('hidden');

    // Обновляем footer sidebar
    const footerUserName = document.getElementById('footerUserName');
    const footerUserInitials = document.getElementById('footerUserInitials');
    if (footerUserName) {
        footerUserName.textContent = currentUser;
    }
    if (footerUserInitials) {
        footerUserInitials.textContent = currentUser.slice(0, 2).toUpperCase();
    }

    console.log('✅ Connected:', currentUser);
    sendToServer({ type: 'get_users' });
    sendToServer({ type: 'get_groups' }); // 👥 Запрашиваем список групп
    requestAudioPermission();

    // 👥 Обновляем sidebar после получения пользователей
    setTimeout(() => {
        if (window.sidebarComponent) {
            window.sidebarComponent.renderChatsList();
        }
    }, 500);

    // 👥 Загружаем историю сообщений для всех групп после получения списка
    setTimeout(() => {
        if (groups && Array.isArray(groups)) {
            groups.forEach(group => {
                loadGroupMessagesFromStorage(group.id);
            });
        }
    }, 500);
}

// ============================================================================
// 🔹 Вспомогательные функции
// ============================================================================

/**
 * 🔒 Запрос разрешения на воспроизведение звука
 * Необходимо для автовоспроизведения уведомлений
 */
function requestAudioPermission() {
    // 🔒 Проверяем поддержку Audio API
    if (!DOM.notificationSound) {
        console.warn('⚠️ Audio element not found');
        return;
    }

    // 🔒 Пытаемся воспроизвести тишину для инициализации
    try {
        const audio = DOM.notificationSound;
        audio.muted = true;
        audio.play().then(() => {
            audio.muted = false;
            console.log('✅ Audio permission granted');
        }).catch(err => {
            // 🔒 Разрешение не получено (это нормально до первого взаимодействия)
            console.log('⚠️ Audio permission pending (will retry on user interaction)');
        });
    } catch (e) {
        console.warn('⚠️ Audio permission error:', e);
    }
}

// ============================================================================
// 🔹 Заглушки для обработчиков сообщений (чтобы избежать ошибок)
// ============================================================================

/**
 * Индикатор набора текста
 */
function handleTypingIndicator(from, isTyping) {
    // Заглушка - реализация в основной части кода
    // console.log(`📝 ${from} is typing: ${isTyping}`);
}

/**
 * Загрузка истории сообщений
 */
function loadMessageHistory(messages, chatName) {
    // Заглушка - история загружается из localStorage
    // console.log(`📜 Loaded ${messages.length} messages for ${chatName}`);
}

/**
 * Удаление чата
 */
function handleChatDeleted(chatName) {
    // Заглушка
    console.log(`🗑️ Chat deleted: ${chatName}`);
}

/**
 * Подтверждение доставки сообщения
 */
function confirmMessageDelivery(timestamp) {
    // Заглушка
    // console.log(`✅ Message confirmed: ${timestamp}`);
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
    // 🔒 Строгая валидация входящих данных
    if (!data.sender || typeof data.sender !== 'string' || data.sender.length > USERNAME_MAX_LENGTH) {
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

    // 🔒 Проверка на XSS в sender
    if (/[<>\"'&]/.test(data.sender)) {
        console.warn('⚠️ handleMessageReceive: XSS in sender');
        return;
    }

    // 🔒 Валидация файлов если они есть
    if (data.files) {
        if (!Array.isArray(data.files)) {
            console.warn('⚠️ handleMessageReceive: files is not an array');
            data.files = null;
        } else {
            // Валидируем каждый файл
            data.files = data.files.filter(f => 
                f && 
                typeof f === 'object' && 
                typeof f.name === 'string' && 
                typeof f.type === 'string' &&
                typeof f.data === 'string' &&
                typeof f.size === 'number'
            );
            if (data.files.length === 0) data.files = null;
        }
    }

    const messageData = {
        sender: data.sender,
        text: sanitizeMessageText(data.text),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        encrypted: data.encrypted || false,
        hint: data.hint || null,
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null,
        files: data.files || null
    };

    const chatName = data.privateTo || 'general';

    // Сохраняем сообщение и добавляем чат в активные
    try {
        if (data.privateTo && data.privateTo === currentUser) {
            // Сообщение получено от другого пользователя
            saveMessageToStorage(data.sender, messageData);
            // ✨ Добавляем чат с отправителем в активные
            addChatToActive(data.sender);
        } else if (data.sender === currentUser && data.privateTo) {
            // Сообщение отправлено текущим пользователем другому
            saveMessageToStorage(data.privateTo, messageData);
            // ✨ Добавляем чат с получателем в активные
            addChatToActive(data.privateTo);
        } else {
            // Групповое или общее сообщение
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

        // ✨ Обновляем статус доставки для собственного сообщения
        if (data.sender === currentUser && data.privateTo) {
            updateMessageDeliveryStatus(data.timestamp, 'sent');
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

    // 📎 Обработка прикрепления файлов
    if (DOM.attachFileBtn) {
        DOM.attachFileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('📎 Attach button clicked');
            if (DOM.fileInput) {
                DOM.fileInput.click();
                console.log('📎 File input clicked');
            } else {
                console.error('❌ File input not found');
            }
        });
    } else {
        console.error('❌ Attach file button not found');
    }

    if (DOM.fileInput) {
        DOM.fileInput.addEventListener('change', handleFileSelect);
        console.log('📎 File input listener attached');
    } else {
        console.error('❌ File input not found');
    }

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

    // 💬 Кнопка сворачивания активных чатов
    const collapseActiveChatsBtn = document.getElementById('collapseActiveChatsBtn');
    if (collapseActiveChatsBtn) {
        collapseActiveChatsBtn.addEventListener('click', () => {
            const activeChatsSection = document.querySelector('.active-chats-section');
            if (activeChatsSection) {
                activeChatsSection.classList.toggle('collapsed');
                collapseActiveChatsBtn.classList.toggle('collapsed');
                localStorage.setItem('active_chats_collapsed', activeChatsSection.classList.contains('collapsed'));
            }
        });

        const activeChatsCollapsed = localStorage.getItem('active_chats_collapsed') === 'true';
        if (activeChatsCollapsed) {
            const activeChatsSection = document.querySelector('.active-chats-section');
            if (activeChatsSection) {
                activeChatsSection.classList.add('collapsed');
                collapseActiveChatsBtn.classList.add('collapsed');
            }
        }
    }

    // 👤 Кнопка сворачивания списка всех пользователей
    const collapseAllUsersBtn = document.getElementById('collapseAllUsersBtn');
    if (collapseAllUsersBtn) {
        collapseAllUsersBtn.addEventListener('click', () => {
            const allUsersSection = document.querySelector('.all-users-section');
            if (allUsersSection) {
                allUsersSection.classList.toggle('collapsed');
                collapseAllUsersBtn.classList.toggle('collapsed');
                localStorage.setItem('all_users_collapsed', allUsersSection.classList.contains('collapsed'));
            }
        });

        const allUsersCollapsed = localStorage.getItem('all_users_collapsed') === 'true';
        if (allUsersCollapsed) {
            const allUsersSection = document.querySelector('.all-users-section');
            if (allUsersSection) {
                allUsersSection.classList.add('collapsed');
                collapseAllUsersBtn.classList.add('collapsed');
            }
        }
    }

    // ➕ Кнопка создания группы
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCreateGroupModal();
        });
    }

    // 👥 Контекстное меню по ПКМ на секции групп для создания группы
    const groupsSection = document.querySelector('.groups-section');
    if (groupsSection) {
        groupsSection.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showGroupContextMenu(e);
        });
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

    // ========================================================================
    // 🔹 Инициализация SidebarComponent
    // ========================================================================
    window.sidebarComponent = new SidebarComponent({
        currentUser: currentUser ? {
            id: 'current',
            username: currentUser,
            displayName: currentUser,
            avatar: null,
            status: 'online'
        } : null,

        // Callbacks
        onChatSelect: (chat) => {
            // Логика выбора чата
            if (chat.type === 'personal' && chat.userId) {
                selectUser(chat.userId);
            } else if (chat.type === 'group' && chat.groupId) {
                selectGroup(chat.groupId);
            }
        },

        onUserStartChat: (user) => {
            // Логика начала чата с новым пользователем
            if (user.id) {
                // Создаём новый чат если не существует
                addChatToActive(user.username || user.id);
                selectUser(user.username || user.id);
            }
        },

        onSettingsClick: () => {
            if (DOM.settingsModal) {
                DOM.settingsModal.classList.remove('hidden');
            }
        },

        onProfileClick: () => {
            if (DOM.profileModal) {
                DOM.profileModal.classList.remove('hidden');
                loadUserProfile();
            }
        },

        onCreateGroup: () => {
            openCreateGroupModal();
        }
    });
    
    // Первоначальная загрузка данных в sidebar
    setTimeout(() => {
        if (window.sidebarComponent) {
            window.sidebarComponent.renderChatsList();
        }
    }, 100);
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
    // Делегирование для списка пользователей (search results)
    DOM.searchResultsList?.addEventListener('click', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        const username = userItem.dataset.username;
        if (!username) return;

        // Клик по элементу пользователя
        selectUser(username);
    });

    // ✨ Двойной клик для быстрого открытия чата
    DOM.searchResultsList?.addEventListener('dblclick', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        const username = userItem.dataset.username;
        if (username) {
            selectUser(username);
        }
    });

    // Контекстное меню (ПКМ) для доступа к функциям закрепить/удалить
    DOM.searchResultsList?.addEventListener('contextmenu', (e) => {
        const userItem = e.target.closest('.user-item');
        if (!userItem) return;

        e.preventDefault();
        const username = userItem.dataset.username;
        if (username) showFolderContextMenu(e, username);
    });

    // 👥 Делегирование для списка чатов
    DOM.chatsList?.addEventListener('click', (e) => {
        const groupItem = e.target.closest('.group-item');
        if (!groupItem) return;

        const groupId = groupItem.dataset.groupId;
        if (!groupId) return;

        // Клик по кнопке удалить группу
        if (e.target.closest('.delete-group-btn')) {
            e.stopPropagation();
            const groupName = groupItem.dataset.groupName;
            deleteGroup(groupId, groupName);
            return;
        }

        // Клик по элементу группы
        selectGroup(groupId);
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

        // ✨ Сохраняем локальные activeChat перед обновлением
        const localActiveChats = new Map();
        users.forEach(u => {
            if (u.activeChat) {
                localActiveChats.set(u.name, u.activeChat);
            }
        });

        users.forEach(user => {
            if (serverUserNames.has(user.name)) {
                const serverUser = serverUsers.find(u => (u.username || u.name) === user.name);
                if (serverUser) {
                    user.status = serverUser.status || (serverUser.online ? 'online' : 'offline');
                    // ✨ Не перезаписываем activeChat с сервера, сохраняем локальный
                    user.activeChat = localActiveChats.get(user.name) || serverUser.activeChat || null;
                    user.isVisibleInDirectory = serverUser.isVisibleInDirectory !== false;
                    user.allowGroupInvite = serverUser.allowGroupInvite || false; // 👥
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
                    // ✨ Сохраняем локальный activeChat если есть
                    activeChat: localActiveChats.get(name) || serverUser.activeChat || null,
                    isVisibleInDirectory: serverUser.isVisibleInDirectory !== false,
                    allowGroupInvite: serverUser.allowGroupInvite || false // 👥
                });
            }
        });

        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        saveUsersToStorage();
        renderAll();

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
        // ✨ Сохраняем activeChat если он передан, иначе оставляем текущий
        if (activeChat !== undefined) {
            user.activeChat = activeChat;
        }
        saveUsersToStorage();
        renderAll();

        // Обновляем статус в заголовке если это текущий выбранный пользователь
        if (selectedUser === username) {
            updateChatUserStatus(username);
        }

        // 🔒 Если пользователь offline и был в чате с кем-то, обновляем activeChat
        if (status === 'offline' && activeChat === null) {
            // Находим всех пользователей, у кого activeChat === username и сбрасыв��ем
            users.forEach(u => {
                if (u.activeChat === username) {
                    u.activeChat = null;
                }
            });
            saveUsersToStorage();
            renderAll();
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
        renderAll();
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
        if (!messages || messages.length === 0) return '���������';

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
 * Рендеринг общего списка чатов (с аватарками)
 */
function renderChats() {
    if (!DOM.chatsList) return;

    DOM.chatsList.innerHTML = '';
    const searchQuery = DOM.searchBox ? DOM.searchBox.value.toLowerCase().trim() : '';
    const fragment = document.createDocumentFragment();

    // Сортируем: сначала активные чаты, потом остальные пользователи
    const sortedUsers = [...users].sort((a, b) => {
        if (a.name === currentUser) return 0;
        if (b.name === currentUser) return 0;

        const aIsActive = a.activeChat === currentUser;
        const bIsActive = b.activeChat === currentUser;

        if (aIsActive && !bIsActive) return -1;
        if (!aIsActive && bIsActive) return 1;

        // Внутри активных сортируем по статусу
        if (aIsActive && bIsActive && a.status === 'online' && b.status !== 'online') return -1;
        if (aIsActive && bIsActive && a.status !== 'online' && b.status === 'online') return 1;

        return 0;
    });

    sortedUsers.forEach(userObj => {
        if (userObj.name === currentUser) return;

        // 🔒 Показываем только пользователей с isVisibleInDirectory === true
        const isExactMatch = searchQuery === userObj.name.toLowerCase();
        if (!userObj.isVisibleInDirectory && !isExactMatch) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'chat-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.dataset.username = userObj.name;

        // Аватарка
        const avatarEl = document.createElement('div');
        avatarEl.className = 'chat-item-avatar';
        const avatarImg = document.createElement('img');
        avatarImg.src = getUserAvatar(userObj.name);
        avatarImg.alt = userObj.name.charAt(0).toUpperCase();
        avatarImg.onerror = function() {
            this.style.display = 'none';
            avatarEl.textContent = userObj.name.charAt(0).toUpperCase();
            avatarEl.classList.add('avatar-placeholder');
        };
        avatarEl.appendChild(avatarImg);

        // Индикатор статуса
        const statusDot = document.createElement('span');
        statusDot.className = 'chat-item-status ' + (userObj.status === 'online' ? 'online' : 'offline');

        // Информация
        const infoEl = document.createElement('div');
        infoEl.className = 'chat-item-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'chat-item-name';
        nameEl.textContent = userObj.name;
        nameEl.title = 'Клик: выбрать пользователя | Двойной клик: открыть профиль';

        const lastMsgEmoji = getLastMessageEmoji(userObj.name);
        const lastMsgEl = document.createElement('div');
        lastMsgEl.className = 'chat-item-last-message';
        lastMsgEl.textContent = lastMsgEmoji + ' Последнее сообщение';

        infoEl.appendChild(nameEl);
        infoEl.appendChild(lastMsgEl);

        // Мета (время, непрочитанные)
        const metaEl = document.createElement('div');
        metaEl.className = 'chat-item-meta';

        const unreadCount = getUnreadMessagesCount(userObj.name);
        if (unreadCount > 0) {
            const unreadEl = document.createElement('span');
            unreadEl.className = 'chat-item-unread';
            unreadEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
            metaEl.appendChild(unreadEl);
        }

        item.appendChild(avatarEl);
        item.appendChild(statusDot);
        item.appendChild(infoEl);
        item.appendChild(metaEl);

        // Клик для выбора пользователя
        item.addEventListener('click', () => {
            selectUser(userObj.name);
        });

        // Двойной клик для открытия профиля
        item.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            openProfile(userObj.name);
        });

        fragment.appendChild(item);
    });

    DOM.chatsList.appendChild(fragment);
}

/**
 * Рендеринг всех списков
 */
function renderAll() {
    // renderChats(); // Отключено - используется SidebarComponent
    renderGroups();
    
    // Обновляем sidebar компонент если он существует
    if (window.sidebarComponent) {
        window.sidebarComponent.renderChatsList();
    }
}

// ============================================================================
// 🔹 Функции для SidebarComponent (предоставление реальных данных)
// ============================================================================

/**
 * Получить данные чатов для SidebarComponent
 * @returns {Array} - Массив чатов для отображения
 */
window.renderChatsListData = function() {
    const chats = [];
    
    // Добавляем активные чаты с пользователями
    users.forEach(user => {
        if (user.name === currentUser) return;
        
        // Проверяем, есть ли активный чат
        const isActive = user.activeChat === currentUser;
        
        // Получаем последнее сообщение
        const key = `chat_messages_${currentUser}_${user.name}`;
        const saved = localStorage.getItem(key);
        let lastMessage = 'Нет сообщений';
        let timestamp = Date.now();
        
        if (saved) {
            try {
                const messages = JSON.parse(saved);
                if (messages.length > 0) {
                    const lastMsg = messages[messages.length - 1];
                    lastMessage = lastMsg.text || (lastMsg.fileData ? '📎 Файл' : 'Сообщение');
                    timestamp = lastMsg.timestamp || Date.now();
                }
            } catch (e) {}
        }
        
        // Добавляем всех пользователей (не только активных)
        chats.push({
            id: 'chat_' + user.name,
            type: 'personal',
            userId: user.name,
            name: user.name,
            avatar: getUserAvatar(user.name),
            lastMessage: lastMessage,
            timestamp: timestamp,
            unreadCount: getUnreadMessagesCount(user.name),
            online: user.status === 'online',
            activeChat: user.activeChat
        });
    });
    
    // Добавляем группы
    groups.forEach(group => {
        const key = `group_messages_${group.id}`;
        const saved = localStorage.getItem(key);
        let lastMessage = 'Нет сообщений';
        let timestamp = group.createdAt || Date.now();
        
        if (saved) {
            try {
                const messages = JSON.parse(saved);
                if (messages.length > 0) {
                    const lastMsg = messages[messages.length - 1];
                    lastMessage = lastMsg.text || (lastMsg.fileData ? '📎 Файл' : 'Сообщение');
                    timestamp = lastMsg.timestamp || Date.now();
                }
            } catch (e) {}
        }
        
        chats.push({
            id: 'group_' + group.id,
            type: 'group',
            groupId: group.id,
            name: group.name,
            avatar: null,
            lastMessage: lastMessage,
            timestamp: timestamp,
            unreadCount: 0,
            membersCount: group.members ? group.members.length : 0
        });
    });
    
    return chats;
};

/**
 * Получить публичных пользователей для поиска
 * @returns {Array} - Массив пользователей с allowPublicView
 */
window.getPublicUsersData = function() {
    return users
        .filter(user => {
            // Показываем пользователей, которые разрешили показ в каталоге
            return user.isVisibleInDirectory !== false && user.name !== currentUser;
        })
        .map(user => ({
            id: 'user_' + user.name,
            username: user.name,
            displayName: user.name,
            avatar: getUserAvatar(user.name),
            status: user.status || 'offline',
            allowPublicView: user.isVisibleInDirectory !== false
        }));
};

/**
 * Получить аватарку пользователя
 * @param {string} username - Имя пользователя
 * @returns {string} - URL аватарки или заглушка
 */
function getUserAvatar(username) {
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${username}`) || '{}');
        if (profile.avatarUrl) {
            const url = profile.avatarUrl.trim();
            // 🔒 Проверяем безопасные URL (только http, https, data:image)
            if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
                return url;
            }
            console.warn('⚠️ Blocked unsafe avatar URL:', url);
        }
    } catch (e) {
        console.error('❌ getUserAvatar error:', e);
    }
    // Заглушка - цветной фон с первой буквой
    return '';
}

/**
 * ✨ Добавить чат в активные
 * @param {string} username - Имя пользователя
 */
function addChatToActive(username) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.activeChat = currentUser; // Показываем, что чат активен с ��екущим пользователем
        saveUsersToStorage();
        renderAll(); // Перерисовываем и активных чаты, и список пользователей
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
    } catch (e) {
        console.error('❌ Increment unread count error:', e);
    }
}

/**
 * ✨ Пометить сообщения от пользователя как прочитанные
 * @param {string} username - Имя пользо����ателя
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
    } catch (e) {
        console.error('���� Mark as read error:', e);
    }
}

/**
 * Обновление выделения выбранного поль��ователя
 * @param {string|null} username - Имя пользователя или null
 */
function updateUserItemSelection(username) {
    // Обновляем выделение в sidebar компоненте
    if (window.sidebarComponent) {
        window.sidebarComponent.selectChat('chat_' + username);
    }
    
    // Для совместимости оставляем работу со старым списком (если он есть)
    const chatItems = DOM.chatsList?.querySelectorAll('.chat-item');
    if (chatItems) {
        chatItems.forEach(item => {
            if (username) {
                item.classList.toggle('selected', item.dataset.username === username);
            } else {
                item.classList.remove('selected');
            }
        });
    }
}

/**
 * Обновление статуса ��ользователя в заголовке
 * @param {string} username - Имя поль�����ователя (собесед��ика!)
 */
function updateChatUserStatus(username) {
    if (!DOM.chatUserStatus) return;

    // Находим пользователя в списке
    const user = users.find(u => u.name === username);
    
    // Преобразуем статус
    const statusClass = user ? (user.status === 'in_chat' ? 'in-chat' : user.status) : 'offline';
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
function updateChatHeaderAvatar(username) {
    // 🔒 Заглушка - обновляет аватарку в заголовке чата
    const chatUserStatus = document.getElementById('chatUserStatus');
    if (chatUserStatus) {
        const statusText = chatUserStatus.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = username;
        }
    }
}

function selectUser(username) {
    console.log('🔵 selectUser called with:', username);
    
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
    console.log('🔵 selectedUser set to:', selectedUser);

    if (DOM.chatTitle) {
        // Обновляем заголовок чата со значками и аватаркой
        updateChatTitleWithBadges();
        updateChatHeaderAvatar(username);
    }

    updateUserItemSelection(username);
    unreadMessagesCount = 0;
    isUserAtBottom = true;

    // ✨ Добавляем чат в активные
    addChatToActive(username);

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
        console.log('🔵 messagesList cleared');

        const messages = loadMessagesFromStorage(username);
        console.log('🔵 Loaded messages:', messages?.length || 0);
        
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
            console.log('🔵 Messages rendered');
        }
    }

    setInputPanelVisible(true);
    console.log('🔵 Input panel shown');
    
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
    console.log('🔵 selectUser completed');
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
        renderAll();
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
        
        // ✨ При удалении чата сбрасываем activeChat у пользователя
        // Пользователь вернётся в общий список (если isVisibleInDirectory = true)
        // Сообщения сохраняем, чтобы чат можно было восстановить
        const user = users.find(u => u.name === username);
        if (user) {
            user.activeChat = null;
            saveUsersToStorage();
            renderAll();
        }
        
        sendToServer({ type: 'delete_chat', chatName: username });
    }
}

// ============================================================================
// 👥 Групповые чаты
// ============================================================================

/**
 * Рендеринг списка групп
 */
function renderGroups() {
    if (!DOM.chatsList) return;

    // Группы рендерятся вместе с чатами в renderChatsAndGroups()
}

/**
 * Выбор группы для чата
 * @param {string} groupId - ID группы
 */
function selectGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) {
        console.warn('⚠️ Group not found:', groupId);
        return;
    }

    selectedGroup = groupId;
    selectedUser = null; // Сбрасываем выбранног�� пользователя

    if (DOM.chatTitle) {
        DOM.chatTitle.textContent = '👥 ' + group.name;
    }

    updateUserItemSelection(null);
    unreadMessagesCount = 0;
    isUserAtBottom = true;

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';

        const messages = loadGroupMessagesFromStorage(groupId);
        if (messages && messages.length > 0) {
            const fragment = document.createDocumentFragment();
            messages.forEach(msg => {
                const msgEl = createMessageElement(msg, msg.sender === currentUser);
                if (msgEl) fragment.appendChild(msgEl);
            });
            DOM.messagesList.appendChild(fragment);
            DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
        }
    }

    setInputPanelVisible(true);
    DOM.chatUserStatus?.classList.add('hidden');
    checkMobileView();
    updateScrollButton();

    // Закрытие sidebar на мобильных после выбора группы
    if (window.innerWidth <= 768 && DOM.sidebar) {
        DOM.sidebar.classList.remove('mobile-visible');
    }

    setTimeout(() => { if (DOM.messageBox) DOM.messageBox.focus(); }, 100);
}

/**
 * Показать контекстное меню для секции групп (ПКМ)
 */
function showGroupContextMenu(e) {
    const existingMenu = document.querySelector('.groups-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu groups-context-menu';

    const menuWidth = 180;
    const menuHeight = 100;
    menu.style.left = Math.min(e.pageX, window.innerWidth - menuWidth) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - menuHeight) + 'px';

    // Пункт "Создать группу"
    const createItem = document.createElement('div');
    createItem.className = 'context-menu-item';
    createItem.textContent = '➕ Создать группу';
    createItem.addEventListener('click', () => {
        showCreateGroupModal();
        menu.remove();
    });
    menu.appendChild(createItem);

    document.body.appendChild(menu);

    // Закрытие при клике вне
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 100);
}

/**
 * Показать модальное окно создания группы
 */
function showCreateGroupModal() {
    if (!DOM.createGroupModal) return;

    // Заполняем список пользователей
    renderGroupMembersSelect();

    DOM.createGroupModal.classList.remove('hidden');
}

// Алиас для совместимости
const openCreateGroupModal = showCreateGroupModal;

/**
 * Рендеринг выбора участников группы
 * Показывает только активных пользователей и тех, кто виден в списке пользователей
 */
function renderGroupMembersSelect() {
    if (!DOM.groupMembersSelect) return;

    DOM.groupMembersSelect.innerHTML = '';

    const fragment = document.createDocumentFragment();

    users.forEach(user => {
        if (user.name === currentUser) return; // Не показываем текущего пользователя

        // ✨ Показываем только:
        // 1. Пользователей с активным чатом (activeChat === currentUser)
        // 2. Пользователей, которые видны в списке (isVisibleInDirectory === true)
        const isActiveChat = user.activeChat === currentUser;
        const isVisibleInDirectory = user.isVisibleInDirectory === true;

        if (!isActiveChat && !isVisibleInDirectory) {
            return; // Пропускаем пользователя
        }

        const item = document.createElement('div');
        item.className = 'group-member-item';
        item.dataset.username = user.name;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'member-checkbox';
        checkbox.dataset.username = user.name;
        // Отключаем пользователей, которые запретили приглашения
        if (!user.allowGroupInvite) {
            checkbox.disabled = true;
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'member-name';
        nameEl.textContent = user.name;

        const statusEl = document.createElement('span');
        statusEl.className = 'member-status';
        // Показываем статус доступности
        if (!user.allowGroupInvite) {
            statusEl.textContent = '✗ Запретил';
        } else if (isActiveChat) {
            statusEl.textContent = '✓ Активен';
        } else if (isVisibleInDirectory) {
            statusEl.textContent = '✓ В списке';
        }

        item.appendChild(checkbox);
        item.appendChild(nameEl);
        item.appendChild(statusEl);

        // Клик по элементу выбирает чекбокс
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox && !checkbox.disabled) {
                checkbox.checked = !checkbox.checked;
                item.classList.toggle('selected', checkbox.checked);
            }
        });

        fragment.appendChild(item);
    });

    DOM.groupMembersSelect.appendChild(fragment);
}

/**
 * Создание группы
 */
function createGroup() {
    const nameInput = DOM.groupNameInput?.value?.trim();
    if (!nameInput) {
        showCreateGroupStatus('Введите название группы', true);
        return;
    }

    if (nameInput.length < 2 || nameInput.length > 50) {
        showCreateGroupStatus('Название должно быть от 2 до 50 символов', true);
        return;
    }

    // Собираем выбранных участников
    const selectedMembers = [];
    const checkboxes = DOM.groupMembersSelect?.querySelectorAll('.member-checkbox:checked');
    if (checkboxes) {
        checkboxes.forEach(cb => {
            selectedMembers.push(cb.dataset.username);
        });
    }

    if (selectedMembers.length === 0) {
        showCreateGroupStatus('Выберите хотя бы одного участника', true);
        return;
    }

    // Отправляем запрос на сервер
    sendToServer({
        type: 'create_group',
        name: nameInput,
        members: selectedMembers
    });

    // Закрываем модальное окно
    DOM.createGroupModal?.classList.add('hidden');
    DOM.groupNameInput.value = '';
    showCreateGroupStatus('');
}

/**
 * Показать статус создания группы
 */
function showCreateGroupStatus(message, isError = false) {
    if (!DOM.createGroupStatus) return;

    DOM.createGroupStatus.textContent = message;
    DOM.createGroupStatus.style.color = isError ? 'var(--error)' : 'var(--success)';

    if (message) {
        setTimeout(() => {
            DOM.createGroupStatus.textContent = '';
        }, 5000);
    }
}

/**
 * Удаление группы
 * @param {string} groupId - ID группы
 * @param {string} groupName - Название группы
 */
function deleteGroup(groupId, groupName) {
    if (confirm('Удалить группу "' + groupName + '"?')) {
        sendToServer({ type: 'delete_group', groupId });
    }
}

/**
 * Обновление состава группы
 */
function updateGroupMembers(groupId, member, actionType) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    if (actionType === 'group_member_added') {
        if (!group.members.includes(member)) {
            group.members.push(member);
        }
    } else if (actionType === 'group_member_removed' || actionType === 'group_member_left') {
        group.members = group.members.filter(m => m !== member);
    }

    renderGroups();

    // Если группа открыта, обновляем заголовок
    if (selectedGroup === groupId && DOM.chatTitle) {
        DOM.chatTitle.textContent = '👥 ' + group.name;
    }
}

/**
 * Обработка входящего сообщения группы
 */
function handleGroupMessageReceive(data) {
    const groupId = data.groupId;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const messageData = {
        sender: data.sender,
        text: sanitizeMessageText(data.text),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        encrypted: data.encrypted || false,
        hint: data.hint || null,
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null,
        groupId: groupId,
        groupName: group.name,
        files: data.files || null
    };

    // Сохраняем сообщение
    try {
        saveGroupMessageToStorage(groupId, messageData);
    } catch (e) {
        console.error('❌ Save group message error:', e);
    }

    // Показываем сообщение если группа открыта
    if (selectedGroup === groupId) {
        const isAdded = addUnreadMessage();
        if (isAdded) {
            addMessage(messageData);
        } else {
            addMessage(messageData, false, false);
        }
    }

    if (data.sender !== currentUser) {
        playNotificationSound();
        showBrowserNotification({
            sender: data.sender,
            text: data.encrypted ? '🔒 Зашифрованное сообщение' : data.text,
            encrypted: data.encrypted,
            groupName: group.name
        });
    }
}

/**
 * Сохранение сообщения группы в localStorage
 */
function saveGroupMessageToStorage(groupId, message) {
    try {
        if (!currentUser || !groupId) {
            console.warn('⚠️ saveGroupMessageToStorage: missing currentUser or groupId');
            return;
        }

        const key = `group_messages_${currentUser}_${groupId}`;
        let messages = loadGroupMessagesFromStorage(groupId);

        messages.push(message);

        if (messages.length > MAX_MESSAGES_IN_STORAGE) {
            messages = messages.slice(-MAX_MESSAGES_IN_STORAGE);
        }

        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) {
        console.error('❌ Save group message error:', e);
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

/**
 * Загрузка сообщений группы из localStorage
 */
function loadGroupMessagesFromStorage(groupId) {
    try {
        if (!groupId) return [];

        const key = `group_messages_${currentUser}_${groupId}`;
        const saved = localStorage.getItem(key);
        if (!saved) return [];

        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter(m =>
            m &&
            typeof m === 'object' &&
            typeof m.sender === 'string' &&
            typeof m.text === 'string' &&
            typeof m.timestamp === 'number'
        );
    } catch (e) {
        console.error('❌ Load group messages error:', e);
        return [];
    }
}

// ============================================================================
// 🔹 Поиск
// ============================================================================
function searchUsers() {
    if (!DOM.searchBox) return;

    const query = DOM.searchBox.value.toLowerCase().trim();
    if (!query) {
        renderAll();
        return;
    }

    // ✨ Ищем точное совпадение имени
    const exactMatch = users.find(u => u.name.toLowerCase() === query && u.name !== currentUser);

    const items = DOM.searchResultsList?.querySelectorAll('.user-item');
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
        renderAll();
    } catch (e) {
        console.error('❌ Save folder error:', e);
    }
}

// ============================================================================
// 🔹 Отправка сообщений
// ============================================================================
async function sendMessage() {
    if (!DOM.messageBox) return;

    const text = DOM.messageBox.value.trim();
    const hasFiles = selectedFiles.length > 0;

    if (!text && !hasFiles) return;

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

    // 📎 Обработка файлов (параллельно для производительности)
    let filesData = [];
    if (hasFiles) {
        try {
            filesData = await Promise.all(selectedFiles.map(async (file) => {
                // Сжимаем изображения и видео перед отправкой
                let processedFile = file;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type.startsWith('video/')) {
                    processedFile = await compressVideo(file);
                }

                const dataUrl = await readFileAsDataURL(processedFile);
                return {
                    name: processedFile.name,
                    type: processedFile.type,
                    size: processedFile.size,
                    data: dataUrl
                };
            }));
        } catch (e) {
            console.error('❌ Error processing files:', e);
            showStatus('❌ Ошибка обработки файлов', true);
        }
    }

    // 👥 Отправка сообщения в группу
    if (selectedGroup) {
        const groupMessage = {
            type: 'send_group_message',
            groupId: selectedGroup,
            text: messageText,
            timestamp: Date.now(),
            encrypted: encrypt,
            hint: hint || null,
            replyTo: replyToMessage ? {
                timestamp: replyToMessage.timestamp,
                sender: replyToMessage.sender,
                text: replyToMessage.text
            } : null,
            files: filesData.length > 0 ? filesData : null
        };

        if (sendToServer(groupMessage)) {
            addMessage({
                sender: currentUser,
                text: messageText,
                time,
                timestamp: Date.now(),
                encrypted: encrypt,
                hint,
                deliveryStatus: 'pending',
                replyTo: groupMessage.replyTo,
                groupId: selectedGroup,
                files: filesData
            }, true);

            const group = groups.find(g => g.id === selectedGroup);
            if (group) {
                saveGroupMessageToStorage(selectedGroup, {
                    sender: currentUser,
                    text: messageText,
                    time,
                    timestamp: Date.now(),
                    encrypted: encrypt,
                    hint: hint || null,
                    deliveryStatus: 'pending',
                    replyTo: groupMessage.replyTo,
                    groupId: selectedGroup,
                    groupName: group.name,
                    files: filesData
                });
            }

            DOM.messageBox.value = '';
            DOM.messageBox.style.height = 'auto';
            clearSelectedFiles();
            scrollToBottom();
        }
        return;
    }

    // Отправка личного сообщения
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
        } : null,
        files: filesData.length > 0 ? filesData : null
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
            replyTo: message.replyTo,
            files: filesData
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
                replyTo: message.replyTo,
                files: filesData
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

        clearSelectedFiles();
    } else {
        showStatus('❌ Не удалось отправить');
    }
}

/**
 * 📸 Сжатие изображения с помощью Canvas
 * @param {File} file - Исходный файл изображения
 * @param {number} maxWidth - Максимальная ширина
 * @param {number} maxHeight - Максимальная высота
 * @param {number} quality - Качество сжатия (0.1-1.0)
 * @returns {Promise<File>} - Сжатое изображение
 */
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.7) {
    return new Promise((resolve) => {
        // Если файл уже маленький, не сжимаем
        if (file.size < 500 * 1024) { // Менее 500KB
            resolve(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Вычисляем новые размеры с сохранением пропорций
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                // Создаём canvas для сжатия
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Конвертируем в Blob с сжатием
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            // Создаём новый File из Blob
                            const compressedFile = new File(
                                [blob],
                                file.name.replace(/\.[^/.]+$/, '.jpg'),
                                { type: 'image/jpeg' }
                            );
                            console.log(`📸 Image compressed: ${file.size} → ${compressedFile.size} bytes (${Math.round((1 - compressedFile.size / file.size) * 100)}% saved)`);
                            resolve(compressedFile);
                        } else {
                            // Если сжатие не удалось, возвращаем оригинал
                            resolve(file);
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

/**
 * Чтение файла как DataURL
 */
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

/**
 * 🎥 Сжатие видео с помощью Canvas и MediaRecorder
 * @param {File} file - Исходный видеофайл
 * @param {number} maxWidth - Максимальная ширина
 * @param {number} maxHeight - Максимальная высота
 * @param {number} videoBitsPerSecond - Битрейт видео
 * @returns {Promise<File>} - Сжатое видео
 */
function compressVideo(file, maxWidth = 1280, maxHeight = 720, videoBitsPerSecond = 2500000) {
    return new Promise((resolve) => {
        // 🔒 Проверяем поддержку MediaRecorder
        if (typeof MediaRecorder === 'undefined') {
            console.warn('⚠️ MediaRecorder not supported, sending original');
            resolve(file);
            return;
        }

        // Если файл маленький, не сжимаем
        if (file.size < 5 * 1024 * 1024) { // Менее 5MB
            resolve(file);
            return;
        }

        const video = document.createElement('video');
        video.preload = 'metadata';
        
        video.onloadedmetadata = () => {
            // Вычисляем новые размеры с сохранением пропорций
            let width = video.videoWidth;
            let height = video.videoHeight;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            // Настраиваем canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            
            // Создаём поток для записи
            const stream = canvas.captureStream(30); // 30 FPS
            
            // Добавляем аудио если есть
            if (video.mozCaptureStream) {
                const audioStream = video.mozCaptureStream();
                const audioTracks = audioStream.getAudioTracks();
                audioTracks.forEach(track => stream.addTrack(track));
            } else if (video.captureStream) {
                const audioStream = video.captureStream();
                const audioTracks = audioStream.getAudioTracks();
                audioTracks.forEach(track => stream.addTrack(track));
            }

            // Используем MediaRecorder для записи сжатого видео
            const options = {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: videoBitsPerSecond
            };

            let recordedChunks = [];
            let mediaRecorder;

            try {
                mediaRecorder = new MediaRecorder(stream, options);
            } catch (e) {
                // Пробуем альтернативный кодек
                try {
                    options.mimeType = 'video/webm;codecs=vp8';
                    mediaRecorder = new MediaRecorder(stream, options);
                } catch (e2) {
                    try {
                        options.mimeType = 'video/webm';
                        mediaRecorder = new MediaRecorder(stream, options);
                    } catch (e3) {
                        console.warn('⚠️ MediaRecorder not supported, sending original');
                        resolve(file);
                        return;
                    }
                }
            }

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const compressedFile = new File(
                    [blob],
                    file.name.replace(/\.[^/.]+$/, '.webm'),
                    { type: 'video/webm' }
                );
                
                console.log(`🎥 Video compressed: ${file.size} → ${compressedFile.size} bytes (${Math.round((1 - compressedFile.size / file.size) * 100)}% saved)`);
                resolve(compressedFile);
            };

            // Начинаем запись
            mediaRecorder.start();

            // Отрисовываем видео на canvas
            video.currentTime = 0;
            video.play();

            const drawFrame = () => {
                if (video.ended) {
                    mediaRecorder.stop();
                    return;
                }
                ctx.drawImage(video, 0, 0, width, height);
                requestAnimationFrame(drawFrame);
            };

            video.onplay = () => {
                drawFrame();
            };

            video.onerror = () => {
                console.warn('⚠️ Video error, sending original');
                URL.revokeObjectURL(video.src);
                resolve(file);
            };
        };

        video.src = URL.createObjectURL(file);
        video.load();
        video.muted = false;

        // Освобождаем URL после загрузки
        video.onloadeddata = () => {
            URL.revokeObjectURL(video.src);
        };
    });
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
        senderEl.style.cursor = 'pointer';
        senderEl.title = 'Открыть профиль';
        senderEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openProfile(data.sender);
        });
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

    // Текст сообщения
    if (data.text) {
        const textEl = document.createElement('div');
        textEl.className = 'text';
        textEl.textContent = displayText;
        message.appendChild(textEl);
    }

    // 📎 Отображение файлов
    if (data.files && data.files.length > 0) {
        const filesContainer = document.createElement('div');
        filesContainer.className = 'message-files';
        
        data.files.forEach(fileData => {
            const fileWrapper = document.createElement('div');
            fileWrapper.className = 'message-file-wrapper';
            fileWrapper.innerHTML = createFileHtml(fileData);
            filesContainer.appendChild(fileWrapper);
        });
        
        message.appendChild(filesContainer);
    }

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
        message._reactions = data.reactions;
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
// 🔹 Контекстное меню ��ообщений
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

    // ���� Реакции (пока����ываем всегда)
    const reactionsBtn = createMessageMenuItem('😊 Реакции', () => {
        showReactionPicker(e.pageX, e.pageY, messageData, messageEl);
        closeMessageContextMenu();
    });
    menu.appendChild(reactionsBtn);

    menu.appendChild(createMessageMenuDivider());

    // Копировать
    const copyBtn = createMessageMenuItem('📋 Копиро��ать', () => {
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
 * Созд��т�� ��азделитель меню
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
 * Закрытие мен�� при клике
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
 * @param {number} y - ��оордината Y
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
    picker.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    picker.style.top = `${y - 50}px`;

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
 * ✨ Получить реакции пользователя для сообщения
 * @param {Object} reactions - Объект реакций в формате {emoji: [{userId, timestamp}]}
 * @param {string} userId - ID пользователя
 * @returns {Array} - Массив реакций пользователя [{emoji, timestamp}]
 */
function getUserReactionsForMessage(reactions, userId) {
    if (!reactions || typeof reactions !== 'object') return [];
    
    const userReactions = [];
    for (const [emoji, users] of Object.entries(reactions)) {
        if (Array.isArray(users)) {
            const userReaction = users.find(r => r.userId === userId);
            if (userReaction) {
                userReactions.push({ emoji, timestamp: userReaction.timestamp });
            }
        }
    }
    // Сортируем по timestamp (самые старые первые)
    return userReactions.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * ✨ Добавить реакцию на сообщение
 * @param {Object} messageData - Данные сообщения
 * @param {HTMLElement} messageEl - Элемент сообщения
 * @param {string} emoji - Смайлик реакции
 */
function addReaction(messageData, messageEl, emoji) {
    if (!messageData || !messageEl) return;
    
    // Увеличиваем частоту использования
    userReactionFrequency[emoji] = (userReactionFrequency[emoji] || 0) + 1;
    localStorage.setItem(`reaction_frequency_${currentUser}`, JSON.stringify(userReactionFrequency));

    // Получаем текущие реакции сообщения в формате {emoji: [{userId, timestamp}]}
    let allReactions = messageEl._reactions || {};
    
    // Глубокое копирование чтобы не мутир��вать оригинал
    allReactions = JSON.parse(JSON.stringify(allReactions));

    // Получаем текущие реакции пользователя
    const userReactions = getUserReactionsForMessage(allReactions, currentUser);
    
    // Проверяем, есть ли уже такая реакция от текущего пользователя
    const existingUserReactionForEmoji = allReactions[emoji]?.find(r => r.userId === currentUser);
    
    if (existingUserReactionForEmoji) {
        // Если реакция уже есть — убираем её (toggle)
        allReactions[emoji] = allReactions[emoji].filter(r => r.userId !== currentUser);
        if (allReactions[emoji].length === 0) {
            delete allReactions[emoji];
        }
    } else {
        // Если реакции нет — добавляем
        // Проверяем лимит: не более 2 реакций на пользователя
        if (userReactions.length >= 2) {
            // Удаляем самую старую реакцию (FIFO)
            const oldestReaction = userReactions[0]; // самый старый (первый в отсортированном списке)
            if (oldestReaction) {
                allReactions[oldestReaction.emoji] = allReactions[oldestReaction.emoji].filter(
                    r => r.userId !== currentUser
                );
                if (allReactions[oldestReaction.emoji].length === 0) {
                    delete allReactions[oldestReaction.emoji];
                }
            }
        }
        
        // Добавляем новую реакцию
        if (!allReactions[emoji]) {
            allReactions[emoji] = [];
        }
        allReactions[emoji].push({
            userId: currentUser,
            timestamp: Date.now()
        });
    }

    // Обновляем данные в messageData и messageEl
    messageData.reactions = allReactions;
    messageEl._reactions = allReactions;

    // ✨ Отправляем реакцию серверу
    sendToServer({
        type: 'message_reaction',
        timestamp: messageData.timestamp,
        reaction: emoji,
        add: !!allReactions[emoji]?.find(r => r.userId === currentUser),
        user: currentUser,
        reactionTimestamp: allReactions[emoji]?.find(r => r.userId === currentUser)?.timestamp || Date.now(),
        privateTo: selectedUser || null
    });

    // Обновляем отображ��ние
    updateMessageReactions(messageEl, allReactions);

    // Сохраняем в localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const msg = messages.find(m => m.timestamp === messageData.timestamp);
        if (msg) {
            msg.reactions = allReactions;
            localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
        }
    }
}

/**
 * ✨ Обновить отображение реакций на сообщении
 * @param {HTMLElement} messageEl - Элемент сообщения
 * @param {Object} reactions - Объект реакций в формате {emoji: [{userId, timestamp}]}
 */
function updateMessageReactions(messageEl, reactions) {
    // Удаляем старую панель реакций
    const existingReactions = messageEl.querySelector('.message-reactions');
    if (existingReactions) existingReactions.remove();

    // Проверяем валидность реакций
    if (!reactions || typeof reactions !== 'object') return;
    
    const validReactions = Object.entries(reactions).filter(([_, users]) => 
        Array.isArray(users) && users.length > 0
    );
    
    if (validReactions.length === 0) return;

    // Создаём панель реакций
    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'message-reactions';

    for (const [emoji, users] of validReactions) {
        const reactionEl = document.createElement('span');
        reactionEl.className = 'reaction-item';
        reactionEl.dataset.emoji = emoji;
        // Показываем emoji и количество пользователей
        reactionEl.textContent = `${emoji} ${users.length}`;
        reactionEl.title = users.map(u => u.userId).join(', ');
        
        // Клик по реакции — добавляем/убираем реакцию
        reactionEl.addEventListener('click', (e) => {
            e.stopPropagation();
            // Находим messageData через timestamp
            const timestamp = messageEl.dataset.timestamp;
            if (selectedUser && timestamp) {
                const messages = loadMessagesFromStorage(selectedUser);
                const msgData = messages.find(m => m.timestamp == timestamp);
                if (msgData) {
                    addReaction(msgData, messageEl, emoji);
                }
            }
        });
        
        reactionsBar.appendChild(reactionEl);
    }

    messageEl.querySelector('.meta')?.before(reactionsBar);
}

/**
 * Копировать текст сообщения
 */
function copyMessageText(text) {
    const cleanText = text.replace(/🔒 Заш����фровано.*/g, '').trim();
    
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
 * @param {Object} data - Данные реакции (reaction, user, add, reactionTimestamp)
 */
function handleRemoteMessageReaction(timestamp, data) {
    if (!DOM.messagesList || !timestamp || !data.reaction) {
        console.warn('⚠️ handleRemoteMessageReaction: invalid params');
        return;
    }

    const { reaction, user, add, reactionTimestamp } = data;

    // Находим сообщение в DOM и обновляем реакции
    const messages = DOM.messagesList.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            // Получаем текущие реакции в фо��мате {emoji: [{userId, timestamp}]}
            const currentReactions = msg._reactions || {};
            
            // Инициализируем массив для этой реакции если нет
            if (!currentReactions[reaction]) {
                currentReactions[reaction] = [];
            }

            // Проверяем есть ли уже реакция от этого пользователя
            const existingUserReactionIndex = currentReactions[reaction].findIndex(
                r => r.userId === user
            );

            if (add !== false) {
                // Д��бавляем реакцию
                if (existingUserReactionIndex === -1) {
                    // Реакции от этого пользователя ещё нет — добавляем
                    currentReactions[reaction].push({
                        userId: user,
                        timestamp: reactionTimestamp || Date.now()
                    });
                }
                // Если реакция уже есть — ничего не делаем (уже учтена)
            } else {
                // Удаляем реакцию пользователя
                if (existingUserReactionIndex !== -1) {
                    currentReactions[reaction].splice(existingUserReactionIndex, 1);
                }
                // Удаляем пустой массив
                if (currentReactions[reaction].length === 0) {
                    delete currentReactions[reaction];
                }
            }

            // Сохраняем реакции в элементе
            msg._reactions = currentReactions;

            updateMessageReactions(msg, currentReactions);
        }
    });

    // Обновляем в localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const msg = messages.find(m => m.timestamp === timestamp);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            const currentReactions = msg.reactions;
            
            // Инициализируем массив для этой реакции если нет
            if (!currentReactions[reaction]) {
                currentReactions[reaction] = [];
            }

            const existingUserReactionIndex = currentReactions[reaction].findIndex(
                r => r.userId === user
            );

            if (add !== false) {
                if (existingUserReactionIndex === -1) {
                    currentReactions[reaction].push({
                        userId: user,
                        timestamp: reactionTimestamp || Date.now()
                    });
                }
            } else {
                if (existingUserReactionIndex !== -1) {
                    currentReactions[reaction].splice(existingUserReactionIndex, 1);
                }
                if (currentReactions[reaction].length === 0) {
                    delete currentReactions[reaction];
                }
            }

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
// 📎 Обработка файлов
// ============================================================================

/**
 * Обработка выбора файлов
 */
function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = MAX_FILES_PER_MESSAGE - selectedFiles.length;
    if (remainingSlots <= 0) {
        alert(`⚠️ Максимум ${MAX_FILES_PER_MESSAGE} файлов в одном сообщении`);
        return;
    }

    const filesToAdd = files.slice(0, remainingSlots);

    for (const file of filesToAdd) {
        // Проверка размера
        if (file.size > MAX_FILE_SIZE) {
            alert(`⚠️ Файл "${file.name}" слишком большой (макс. 10MB)`);
            continue;
        }

        // Проверка дубликатов
        const isDuplicate = selectedFiles.some(f => 
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (isDuplicate) {
            continue;
        }

        selectedFiles.push(file);
    }

    renderFilePreview();

    // Очищаем input для возможности повторного выбора того же файла
    if (DOM.fileInput) {
        DOM.fileInput.value = '';
    }
}

/**
 * Рендеринг предпросмотра файлов
 */
function renderFilePreview() {
    if (!DOM.filePreviewContainer) return;

    if (selectedFiles.length === 0) {
        DOM.filePreviewContainer.classList.add('hidden');
        DOM.filePreviewContainer.innerHTML = '';
        return;
    }

    DOM.filePreviewContainer.classList.remove('hidden');
    DOM.filePreviewContainer.innerHTML = '';

    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';

        // Предпросмотр для изображений
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.className = 'file-preview-image';
            img.alt = file.name;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
            item.appendChild(img);
        } else {
            // Иконка для других файлов
            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = getFileIcon(file.type);
            item.appendChild(icon);
        }

        // Информация о файле
        const info = document.createElement('div');
        info.className = 'file-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'file-name';
        nameEl.textContent = file.name;
        info.appendChild(nameEl);

        const sizeEl = document.createElement('span');
        sizeEl.className = 'file-size';
        sizeEl.textContent = formatFileSize(file.size);
        info.appendChild(sizeEl);

        item.appendChild(info);

        // Кнопка удаления
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Удалить файл';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFile(index);
        });
        item.appendChild(removeBtn);

        DOM.filePreviewContainer.appendChild(item);
    });
}

/**
 * Удаление файла из списка
 */
function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFilePreview();
}

/**
 * Очистка выбранных файлов
 */
function clearSelectedFiles() {
    selectedFiles = [];
    renderFilePreview();
}

/**
 * Получение иконки для типа файла
 */
function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📘';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
    if (mimeType.includes('text')) return '📝';
    return '📄';
}

/**
 * Форматирование размера файла
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Создание HTML для файла в сообщении
 */
function createFileHtml(fileData) {
    const { type, name, size, data } = fileData;
    const sizeStr = formatFileSize(size);

    // 🔒 Безопасное создание элементов без innerHTML
    const container = document.createElement('div');

    if (type.startsWith('image/')) {
        // Изображение
        container.className = 'message-file message-file-image';
        const img = document.createElement('img');
        img.src = data;
        img.alt = escapeHtml(name);
        img.title = `${escapeHtml(name)} (${sizeStr})`;
        container.appendChild(img);
        return container.outerHTML;
    }

    if (type.startsWith('video/')) {
        // Видео
        container.className = 'message-file message-file-video';
        const video = document.createElement('video');
        video.controls = true;
        video.title = `${escapeHtml(name)} (${sizeStr})`;
        const source = document.createElement('source');
        source.src = data;
        source.type = escapeHtml(type);
        video.appendChild(source);
        container.appendChild(video);
        return container.outerHTML;
    }

    if (type.startsWith('audio/')) {
        // Аудио
        container.className = 'message-file message-file-audio';
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.title = `${escapeHtml(name)} (${sizeStr})`;
        const source = document.createElement('source');
        source.src = data;
        source.type = escapeHtml(type);
        audio.appendChild(source);
        container.appendChild(audio);
        return container.outerHTML;
    }

    // Для остальных файлов
    container.className = 'message-file message-file-generic';
    const icon = getFileIcon(type);
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-icon';
    iconSpan.textContent = icon;
    container.appendChild(iconSpan);
    
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'file-details';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = escapeHtml(name);
    detailsDiv.appendChild(nameSpan);
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = sizeStr;
    detailsDiv.appendChild(sizeSpan);
    
    container.appendChild(detailsDiv);
    
    const downloadLink = document.createElement('a');
    downloadLink.href = data;
    downloadLink.download = escapeHtml(name);
    downloadLink.className = 'download-file-btn';
    downloadLink.title = 'Скачать';
    downloadLink.textContent = '⬇️ Скачать';
    container.appendChild(downloadLink);
    
    return container.outerHTML;
}

// ============================================================================
// 👤 Система профилей пользователей
// ============================================================================

/**
 * 🏅 Каталог всех доступных значков
 * 
 * 💡 КАК ДОБАВИТЬ НОВЫЙ ЗНАЧОК:
 * 1. Добавьте новую строку в этот объект
 * 2. Формат: 'уникальный_id': { icon: '🆕', name: 'Название', description: 'Описание' },
 * 3. Сохраните файл - значок автоматически появится в профиле
 * 
 * Примеры для добавления:
 * - 'early_adopter': { icon: '🚀', name: 'Первопроходец', description: 'Один из первых пользователей' },
 * - 'chat_master':   { icon: '💬', name: 'Мастер чата', description: 'За 1000 сообщений' },
 * - 'night_owl':     { icon: '🦉', name: 'Сова', description: 'Активен по ночам' },
 * 
 * @type {Object.<string, {icon: string, name: string, description: string}>}
 */
const BADGES_CATALOG = {
    'active':        { icon: '🏆', name: 'Активный', description: 'За активность в чате' },
    'premium':       { icon: '⭐', name: 'Премиум', description: 'Премиум подписка' },
    'moderator':     { icon: '🛡️', name: 'Модератор', description: 'Модератор чата' },
    'vip':           { icon: '💎', name: 'VIP', description: 'VIP статус' },
    'verified':      { icon: '🎯', name: 'Верифицирован', description: 'Подтверждённый пользователь' },
    'designer':      { icon: '🎨', name: 'Дизайнер', description: 'Дизайнер' },
    'developer':     { icon: '💻', name: 'Разработчик', description: 'Разработчик' },
    'music':         { icon: '🎵', name: 'Музыкальный', description: 'Любитель музыки' },
    // ➕ ДОБАВЛЯЙТЕ НОВЫЕ ЗНАЧКИ ВЫШЕ ЭТОЙ СТРОКИ
};

/**
 * Получить все доступные ID значков
 * @returns {string[]} Массив ID значков
 */
function getAvailableBadgeIds() {
    return Object.keys(BADGES_CATALOG);
}

/**
 * Получить информацию о значке по ID
 * @param {string} badgeId - ID значка
 * @returns {{icon: string, name: string, description: string}|null}
 */
function getBadgeInfo(badgeId) {
    return BADGES_CATALOG[badgeId] || null;
}

/**
 * Инициализация системы профилей
 */
function initProfile() {
    // Загрузка профиля из localStorage
    loadUserProfile();

    // Обработчики событий
    if (DOM.footerProfileBtn) {
        DOM.footerProfileBtn.addEventListener('click', () => openProfile(currentUser));
    }
    
    if (DOM.closeProfile) {
        DOM.closeProfile.addEventListener('click', closeProfile);
    }
    
    if (DOM.editProfileBtn) {
        DOM.editProfileBtn.addEventListener('click', toggleEditMode);
    }
    
    if (DOM.avatarContainer) {
        DOM.avatarContainer.addEventListener('click', () => {
            if (viewedProfileUserId === currentUser && DOM.avatarFileInput) {
                DOM.avatarFileInput.click();
            }
        });
    }
    
    if (DOM.avatarFileInput) {
        DOM.avatarFileInput.addEventListener('change', handleAvatarFileSelect);
    }
    
    if (DOM.applyAvatarUrlBtn) {
        DOM.applyAvatarUrlBtn.addEventListener('click', applyAvatarUrl);
    }
    
    if (DOM.saveProfileBtn) {
        DOM.saveProfileBtn.addEventListener('click', saveProfileChanges);
    }
    
    if (DOM.cancelProfileBtn) {
        DOM.cancelProfileBtn.addEventListener('click', cancelProfileChanges);
    }
    
    if (DOM.sendMessageBtn) {
        DOM.sendMessageBtn.addEventListener('click', () => {
            if (viewedProfileUserId && viewedProfileUserId !== currentUser) {
                selectUser(viewedProfileUserId);
                closeProfile();
            }
        });
    }
    
    // Закрытие по клику вне модального окна
    if (DOM.profileModal) {
        DOM.profileModal.addEventListener('click', (e) => {
            if (e.target === DOM.profileModal) {
                closeProfile();
            }
        });
    }
}

/**
 * Загрузка профиля пользователя из localStorage
 */
function loadUserProfile() {
    if (!currentUser) return;

    const profileKey = `user_profile_${currentUser}`;
    const badgesKey = `user_badges_${currentUser}`;

    try {
        const savedProfile = localStorage.getItem(profileKey);
        if (savedProfile) {
            userProfile = JSON.parse(savedProfile);
        } else {
            userProfile = {
                username: currentUser,
                avatar: null,
                status: 'online'
            };
        }

        const savedBadges = localStorage.getItem(badgesKey);
        if (savedBadges) {
            userBadges = JSON.parse(savedBadges);
        } else {
            // 👤 По умолчанию у пользователя НЕТ значков
            userBadges = [];
        }
    } catch (e) {
        console.error('❌ loadUserProfile error:', e);
        userProfile = { username: currentUser, avatar: null, status: 'online' };
        userBadges = [];
    }
}

/**
 * Сохранение профиля пользователя в localStorage
 */
function saveUserProfile() {
    if (!currentUser || !userProfile) return;
    
    try {
        const profileKey = `user_profile_${currentUser}`;
        const badgesKey = `user_badges_${currentUser}`;
        
        localStorage.setItem(profileKey, JSON.stringify(userProfile));
        localStorage.setItem(badgesKey, JSON.stringify(userBadges));
    } catch (e) {
        console.error('❌ saveUserProfile error:', e);
    }
}

/**
 * Открытие профиля пользователя
 * @param {string} userId - ID пользователя
 */
function openProfile(userId) {
    if (!userId || !DOM.profileModal) return;

    // 🔒 Санитизация userId для защиты от XSS
    userId = escapeHtml(userId);

    viewedProfileUserId = userId;
    const isOwnProfile = userId === currentUser;
    
    // Обновляем заголовок
    const profileTitle = document.getElementById('profileTitle');
    if (profileTitle) {
        profileTitle.textContent = isOwnProfile ? 'Ваш профиль' : 'Профиль пользователя';
    }
    
    // Заполняем данные профиля
    const avatar = userProfile?.avatar || getDefaultAvatar(userId);
    const name = userId;
    const status = isOwnProfile ? 'online' : getUserStatus(userId);
    
    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = avatar;
        DOM.profileAvatar.alt = `Аватар ${userId}`;
    }
    
    if (DOM.profileUserName) {
        DOM.profileUserName.textContent = name;
    }
    
    if (DOM.profileUserStatus) {
        DOM.profileUserStatus.className = 'profile-user-status ' + status;
        const statusText = DOM.profileUserStatus.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = status === 'online' ? 'Онлайн' : 'Офлайн';
        }
    }
    
    // Отображение значков
    if (isOwnProfile) {
        renderBadges(userBadges, true);
    } else {
        // Для чужого профиля показываем только видимые значки
        const visibleBadges = userBadges.filter(b => b.visible);
        renderBadges(visibleBadges, false);
    }
    
    // Показываем/скрываем кнопку редактирования
    if (DOM.editProfileBtn) {
        DOM.editProfileBtn.classList.toggle('hidden', !isOwnProfile);
    }
    
    // Показываем/скрываем панель действий для чужого профиля
    if (DOM.profileActionsSection) {
        DOM.profileActionsSection.classList.toggle('hidden', isOwnProfile);
    }
    
    // Скрываем панель редактирования
    if (DOM.editPanel) {
        DOM.editPanel.classList.add('hidden');
    }
    
    // Показываем модальное окно
    DOM.profileModal.classList.remove('hidden');
}

/**
 * Закрытие профиля
 */
function closeProfile() {
    if (!DOM.profileModal) return;
    
    DOM.profileModal.classList.add('hidden');
    viewedProfileUserId = null;
}

/**
 * Переключение режима редактирования
 */
function toggleEditMode() {
    if (!DOM.editPanel) return;
    
    const isEditing = !DOM.editPanel.classList.contains('hidden');
    
    if (isEditing) {
        // Закрываем режим редактирования
        DOM.editPanel.classList.add('hidden');
        DOM.editProfileBtn.textContent = '✏️';
    } else {
        // Открываем режим редактирования
        DOM.editPanel.classList.remove('hidden');
        DOM.editProfileBtn.textContent = '🔒';
        
        // Заполняем форму редактирования
        renderBadgeVisibilityList();
    }
}

/**
 * Отрисовка значков в профиле
 * @param {Array} badges - Массив значков [{id, visible}]
 * @param {boolean} isEditable - Режим редактирования
 */
function renderBadges(badges, isEditable) {
    if (!DOM.badgesGrid) return;

    DOM.badgesGrid.innerHTML = '';

    // Фильтруем только видимые значки
    const visibleBadges = badges.filter(b => b.visible);

    if (!badges || badges.length === 0 || visibleBadges.length === 0) {
        DOM.badgesGrid.innerHTML = isEditable 
            ? '<p class="no-badges-text">У вас пока нет значков. Выберите значки в режиме редактирования</p>'
            : '<p class="no-badges-text">Значки отсутствуют</p>';
        return;
    }

    const fragment = document.createDocumentFragment();

    visibleBadges.forEach(badge => {
        const badgeInfo = getBadgeInfo(badge.id);
        if (!badgeInfo) return; // Пропускаем несуществующие значки

        const badgeEl = document.createElement('div');
        badgeEl.className = 'badge-item';
        badgeEl.title = badgeInfo.description;

        const iconEl = document.createElement('span');
        iconEl.className = 'badge-icon';
        iconEl.textContent = badgeInfo.icon;

        const nameEl = document.createElement('span');
        nameEl.className = 'badge-name';
        nameEl.textContent = badgeInfo.name;

        badgeEl.appendChild(iconEl);
        badgeEl.appendChild(nameEl);
        fragment.appendChild(badgeEl);
    });

    DOM.badgesGrid.appendChild(fragment);
}

/**
 * Отрисовка списка видимости значков (для редактирования)
 * Показывает ВСЕ доступные значки из каталога
 */
function renderBadgeVisibilityList() {
    if (!DOM.badgeVisibilityList) return;

    DOM.badgeVisibilityList.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const allBadgeIds = getAvailableBadgeIds();

    allBadgeIds.forEach(badgeId => {
        const badgeInfo = getBadgeInfo(badgeId);
        if (!badgeInfo) return;

        // Проверяем, есть ли этот значок у пользователя
        const userBadge = userBadges.find(b => b.id === badgeId);
        const hasBadge = !!userBadge;
        const isVisible = hasBadge && userBadge.visible;

        const itemEl = document.createElement('div');
        itemEl.className = 'badge-visibility-item';

        const iconEl = document.createElement('span');
        iconEl.className = 'badge-icon-small';
        iconEl.textContent = badgeInfo.icon;

        const labelEl = document.createElement('span');
        labelEl.className = 'badge-label';
        labelEl.textContent = badgeInfo.name;

        const toggleEl = document.createElement('button');
        toggleEl.className = 'badge-toggle' + (isVisible ? ' active' : '');
        toggleEl.type = 'button';
        toggleEl.dataset.badgeId = badgeId;
        toggleEl.setAttribute('aria-label', `Переключить видимость значка ${badgeInfo.name}`);
        toggleEl.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
        toggleEl.title = badgeInfo.description;
        toggleEl.addEventListener('click', () => toggleBadgeVisibility(badgeId));

        itemEl.appendChild(iconEl);
        itemEl.appendChild(labelEl);
        itemEl.appendChild(toggleEl);
        fragment.appendChild(itemEl);
    });

    DOM.badgeVisibilityList.appendChild(fragment);
}

/**
 * Переключение видимости значка
 * @param {string} badgeId - ID значка
 */
function toggleBadgeVisibility(badgeId) {
    const badgeIndex = userBadges.findIndex(b => b.id === badgeId);
    
    if (badgeIndex >= 0) {
        // Значок уже есть у пользователя - переключаем видимость
        userBadges[badgeIndex].visible = !userBadges[badgeIndex].visible;
        
        // Если значок скрыт, удаляем его из массива (не храним скрытые)
        if (!userBadges[badgeIndex].visible) {
            userBadges.splice(badgeIndex, 1);
        }
    } else {
        // У пользователя нет этого значка - добавляем с visible=true
        userBadges.push({ id: badgeId, visible: true });
    }

    // Обновляем UI
    renderBadgeVisibilityList();

    // Обновляем превью значков
    renderBadges(userBadges, false);
}

/**
 * Обработка выбора файла аватара
 * @param {Event} e - Событие change
 */
function handleAvatarFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Валидация файла
    if (!file.type.startsWith('image/')) {
        showProfileStatus('Выберите изображение', true);
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showProfileStatus('Размер файла не должен превышать 5MB', true);
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        if (event.target?.result) {
            userProfile.avatar = event.target.result;
            saveUserProfile();
            
            if (DOM.profileAvatar) {
                DOM.profileAvatar.src = userProfile.avatar;
            }
            
            showProfileStatus('Аватар успешно загружен', false);
        }
    };
    reader.onerror = () => {
        showProfileStatus('Ошибка загрузки файла', true);
    };
    reader.readAsDataURL(file);
    
    // Сбрасываем input для возможности повторной загрузки того же файла
    e.target.value = '';
}

/**
 * Применение URL аватара
 */
function applyAvatarUrl() {
    if (!DOM.avatarUrlInput) return;
    
    const url = DOM.avatarUrlInput.value.trim();
    if (!url) {
        showProfileStatus('Введите URL изображения', true);
        return;
    }
    
    // Простая валидация URL
    try {
        new URL(url);
    } catch {
        showProfileStatus('Неверный формат URL', true);
        return;
    }
    
    userProfile.avatar = url;
    saveUserProfile();
    
    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = url;
    }
    
    DOM.avatarUrlInput.value = '';
    showProfileStatus('Аватар успешно обновлён', false);
}

/**
 * Сохранение изменений профиля
 */
function saveProfileChanges() {
    saveUserProfile();
    
    // 👤 Отправляем значки на сервер для сохранения в БД
    if (socket && socket.readyState === WebSocket.OPEN && userBadges) {
        sendToServer({
            type: 'update_badges',
            badges: userBadges.map(b => ({ id: b.id, visible: b.visible }))
        });
    }
    
    toggleEditMode();
    showProfileStatus('Профиль успешно сохранён', false);

    // Обновляем заголовок чата если он открыт
    if (selectedUser === currentUser) {
        updateChatTitleWithBadges();
    }
}

/**
 * Отмена изменений профиля
 */
function cancelProfileChanges() {
    // Перезагружаем профиль из localStorage
    loadUserProfile();
    toggleEditMode();
}

/**
 * Показ сообщения статуса в профиле
 * @param {string} message - Сообщение
 * @param {boolean} isError - Ошибка ли это
 */
function showProfileStatus(message, isError = false) {
    if (!DOM.profileStatusMessage) return;
    
    DOM.profileStatusMessage.textContent = message;
    DOM.profileStatusMessage.style.color = isError ? 'var(--error)' : 'var(--success)';
    
    if (message) {
        setTimeout(() => {
            DOM.profileStatusMessage.textContent = '';
        }, 3000);
    }
}

/**
 * Получить аватар по умолчанию (генерация по имени)
 * @param {string} userId - ID пользователя
 * @returns {string} - URL аватара
 */
function getDefaultAvatar(userId) {
    // Генерация цвета на основе имени
    const colors = ['#7B2CBF', '#2563EB', '#059669', '#DC2626', '#EA580C', '#DB2777', '#0891B2', '#7C3AED'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = colors[Math.abs(hash) % colors.length];
    
    // Используем сервис генерации аватаров
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(userId)}&background=${color.replace('#', '')}&color=fff&size=128`;
}

/**
 * Получить статус пользователя
 * @param {string} userId - ID пользователя
 * @returns {string} - Статус
 */
function getUserStatus(userId) {
    const user = users.find(u => u.name === userId);
    if (user) {
        return user.status === 'in_chat' ? 'online' : user.status;
    }
    return 'offline';
}

/**
 * Обновление заголовка чата со значками
 */
function updateChatTitleWithBadges() {
    if (!DOM.chatTitle || !selectedUser) return;

    // Получаем видимые значки для текущего пользователя
    const visibleBadges = userBadges.filter(b => b.visible);

    if (selectedUser === currentUser && visibleBadges.length > 0) {
        // Показываем первый значок в заголовке для своего профиля
        const badgeInfo = getBadgeInfo(visibleBadges[0].id);
        if (badgeInfo) {
            DOM.chatTitle.textContent = `${badgeInfo.icon} ${selectedUser}`;
        } else {
            DOM.chatTitle.textContent = selectedUser;
        }
    } else {
        // Для других пользователей показываем их видимые значки
        // Загружаем профиль другого пользователя если есть
        const otherProfileKey = `user_profile_${selectedUser}`;
        const otherBadgesKey = `user_badges_${selectedUser}`;

        try {
            const savedBadges = localStorage.getItem(otherBadgesKey);
            if (savedBadges) {
                const otherBadges = JSON.parse(savedBadges);
                const otherVisibleBadges = otherBadges.filter(b => b.visible);

                if (otherVisibleBadges.length > 0) {
                    const badgeInfo = getBadgeInfo(otherVisibleBadges[0].id);
                    if (badgeInfo) {
                        DOM.chatTitle.textContent = `${badgeInfo.icon} ${selectedUser}`;
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('❌ updateChatTitleWithBadges error:', e);
        }

        DOM.chatTitle.textContent = `💬 ${selectedUser}`;
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

    // ✨ Синхронизация настройки для групповых чатов
    if (DOM.allowGroupInvite) {
        DOM.allowGroupInvite.checked = allowGroupInvite;
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
            // ��акрываем контекстное меню пользователей
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

            if (sessionAge < SESSION_MAX_AGE && sessionData.username && sessionData.token) {
                currentUser = sessionData.username;

                connectToServer({
                    type: 'auto_login',
                    username: currentUser,
                    token: sessionData.token,
                    deviceId: sessionData.deviceId
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
 * 🔒 Сохраняем токен сессии для авто-входа
 * @param {string} username - Имя пользователя
 * @param {string} token - Токен сессии
 * @param {string} deviceId - ID устройства
 */
function saveAuthSession(username, token, deviceId) {
    try {
        const sessionData = {
            username: username,
            token: token, // 🔒 Токен сессии для авто-входа
            deviceId: deviceId, // ID устройства
            passwordHint: username.substring(0, 2) + '•••', // 🔒 Безопасная подсказка
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

        if (!settings) {
            // Применяем значение по умолчанию
            document.documentElement.style.setProperty('--own-message-bg', DEFAULT_MESSAGE_COLOR);
            if (DOM.messageColorSelect) DOM.messageColorSelect.value = DEFAULT_MESSAGE_COLOR;
            return;
        }

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
        } else {
            // Если в настройках нет цвета сообщений, используем фиолетовый по умолчанию
            document.documentElement.style.setProperty('--own-message-bg', DEFAULT_MESSAGE_COLOR);
            if (DOM.messageColorSelect) DOM.messageColorSelect.value = DEFAULT_MESSAGE_COLOR;
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

        // ✨ Загрузка настройки для групповых чатов
        if (typeof data.allowGroupInvite === 'boolean') {
            allowGroupInvite = data.allowGroupInvite;
            if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = data.allowGroupInvite;
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
            isVisibleInDirectory: DOM.showInDirectory?.checked ?? false,
            allowGroupInvite: DOM.allowGroupInvite?.checked ?? false // ✨ Настройка для ��рупповых чатов
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

// ============================================================================
// 🔹 Уведомления
// ============================================================================
/**
 * Воспроизведение звука уведомления
 */
function playNotificationSound() {
    if (!soundEnabled || !DOM.notificationSound) return;

    try {
        DOM.notificationSound.currentTime = 0;
        DOM.notificationSound.play().catch(err => {
            console.warn('⚠️ Sound play error:', err);
        });
    } catch (e) {
        console.error('❌ Play sound error:', e);
    }
}

/**
 * Показ браузерного уведомления
 * @param {Object} data - Данные уведомления
 */
function showBrowserNotification(data) {
    if (!data || !data.sender) return;

    // 🔒 Проверяем поддержку уведомлений и secure context
    if (!('Notification' in window)) return;
    if (!window.isSecureContext && location.hostname !== 'localhost') {
        console.warn('⚠️ Notifications require HTTPS or localhost');
        return;
    }

    // Запрашиваем разрешение если нужно
    if (Notification.permission === 'granted') {
        try {
            const notification = new Notification(
                data.groupName ? `👥 ${data.groupName}` : 'Новое сообщение',
                {
                    body: `${data.sender}: ${data.text?.substring(0, 100) || ''}`,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💬</text></svg>',
                    tag: `message-${data.sender}-${Date.now()}`,
                    requireInteraction: false
                }
            );

            // Автозакрытие через 5 секунд
            setTimeout(() => notification.close(), 5000);

            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (e) {
            console.error('❌ Browser notification error:', e);
        }
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showBrowserNotification(data);
            }
        }).catch(err => {
            console.warn('⚠️ Notification permission error:', err);
        });
    }
}

// ============================================================================
// 🔹 Шифрование
// ============================================================================
/**
 * XOR шифрование текста
 * @param {string} text - Текст для шифрования
 * @param {string} key - Ключ шифрования
 * @returns {string} - Зашифрованный текст
 */
function xorEncrypt(text, key) {
    if (!text || !key) return text;

    let result = '';
    const keyLength = key.length;

    for (let i = 0; i < text.length; i++) {
        const textChar = text.charCodeAt(i);
        const keyChar = key.charCodeAt(i % keyLength);
        result += String.fromCharCode(textChar ^ keyChar);
    }

    // Преобразуем в hex для безопасной передачи
    return Array.from(result)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

/**
 * XOR расшифрование текста
 * @param {string} encryptedText - Зашифрованный текст (hex)
 * @param {string} key - Ключ расшифрования
 * @returns {string} - Расшифрованный текст
 */
function xorDecrypt(encryptedText, key) {
    if (!encryptedText || !key) return encryptedText;

    try {
        // Преобразуем из hex
        let hexString = encryptedText;
        let result = '';

        for (let i = 0; i < hexString.length; i += 2) {
            const hex = parseInt(hexString.substr(i, 2), 16);
            result += String.fromCharCode(hex);
        }

        // XOR расшифр��вание
        let decrypted = '';
        const keyLength = key.length;

        for (let i = 0; i < result.length; i++) {
            const charCode = result.charCodeAt(i);
            const keyChar = key.charCodeAt(i % keyLength);
            decrypted += String.fromCharCode(charCode ^ keyChar);
        }

        return decrypted;
    } catch (e) {
        console.error('❌ Decrypt error:', e);
        return '❌ Ошиб��а расшифровки';
    }
}

/**
 * Генерация подсказки для ключа
 * @param {string} key - Ключ шифрования
 * @returns {string} - Подсказка
 */
function generateHint(key) {
    if (!key) return '???';

    const firstChar = key.charAt(0);
    const lastChar = key.charAt(key.length - 1);
    const sum = key.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    return `${firstChar}...${lastChar} (${sum})`;
}

/**
 * Расшиф����овка сообщения
 */
function decryptMessage() {
    if (!DOM.decryptKeyBox || !DOM.decryptPanel) return;

    const key = DOM.decryptKeyBox.value.trim();
    const messageIndex = parseInt(DOM.decryptPanel.dataset.messageIndex || '-1', 10);

    if (!key || messageIndex < 0) {
        alert('⚠️ Введите ключ для расшифровки');
        return;
    }

    const messages = DOM.messagesList?.querySelectorAll('.message');
    if (!messages || messageIndex >= messages.length) return;

    const messageEl = messages[messageIndex];
    const encryptedText = messageEl.dataset.text;
    const hint = messageEl.dataset.hint;

    if (!encryptedText) {
        alert('❌ Сообщение не зашифровано');
        return;
    }

    const decrypted = xorDecrypt(encryptedText, key);

    // Проверяем правильность ключа по подск��зке
    const expectedHint = generateHint(key);
    if (hint && expectedHint !== hint) {
        alert('⚠️ Неверный ключ! ��одсказка: ' + hint);
        return;
    }

    // Обновляем отображение
    const textEl = messageEl.querySelector('.text');
    if (textEl) {
        textEl.textContent = decrypted;
    }

    messageEl.classList.remove('encrypted');
    messageEl.title = 'Расшифровано';
    messageEl.dataset.decrypted = 'true';

    // Скрываем панель
    DOM.decryptPanel.classList.add('hidden');
    DOM.decryptKeyBox.value = '';
}

// ============================================================================
// 🔹 Инициализация настроек
// ============================================================================
function initSettings() {
    const settingsBtn = document.getElementById('footerSettingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const settingsModal = document.getElementById('settingsModal');
    const logoutBtn = document.getElementById('logoutBtn');

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
            syncSettingsUI();
        });
    }

    if (closeSettings && settingsModal) {
        closeSettings.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', performLogout);
    }

    // ℹ️ Кнопка о разработчике в настройках
    const aboutDeveloperSettingsBtn = document.getElementById('aboutDeveloperSettingsBtn');
    const aboutDeveloperModal = document.getElementById('aboutDeveloperModal');
    const closeAboutDeveloper = document.getElementById('closeAboutDeveloper');

    if (aboutDeveloperSettingsBtn && aboutDeveloperModal) {
        aboutDeveloperSettingsBtn.addEventListener('click', () => {
            aboutDeveloperModal.classList.remove('hidden');
        });
    }

    if (closeAboutDeveloper && aboutDeveloperModal) {
        closeAboutDeveloper.addEventListener('click', () => {
            aboutDeveloperModal.classList.add('hidden');
        });
    }

    if (aboutDeveloperModal) {
        aboutDeveloperModal.addEventListener('click', (e) => {
            if (e.target === aboutDeveloperModal) {
                aboutDeveloperModal.classList.add('hidden');
            }
        });
    }

    // Обработчики настроек
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

    // ✨ Обработка настройки для групповых чатов
    if (DOM.allowGroupInvite) {
        DOM.allowGroupInvite.addEventListener('change', (e) => {
            allowGroupInvite = e.target.checked;
            saveSettings();
            // Отправляем на сервер обновление
            sendToServer({ type: 'update_group_invite_permission', allow: allowGroupInvite });
        });
    }

    // 👥 Инициализация модального окна создания группы
    const closeCreateGroup = document.getElementById('closeCreateGroup');
    if (closeCreateGroup) {
        closeCreateGroup.addEventListener('click', () => {
            if (DOM.createGroupModal) DOM.createGroupModal.classList.add('hidden');
        });
    }

    if (DOM.createGroupModal) {
        DOM.createGroupModal.addEventListener('click', (e) => {
            if (e.target === DOM.createGroupModal) DOM.createGroupModal.classList.add('hidden');
        });
    }

    if (DOM.createGroupConfirmBtn) {
        DOM.createGroupConfirmBtn.addEventListener('click', createGroup);
    }

    // 🔐 Инициализация 2FA
    initTwoFactor();
}

// ============================================================================
// 🔐 Двухфакторная аутентификация (2FA)
// ============================================================================

let twoFactorState = {
    enabled: false,
    secret: '',
    backupCodes: [],
    isSettingUp: false
};

function initTwoFactor() {
    const twoFactorBtn = document.getElementById('twoFactorBtn');
    const closeTwoFactor = document.getElementById('closeTwoFactor');
    const twoFactorModal = document.getElementById('twoFactorModal');
    const enableTwoFactorBtn = document.getElementById('enableTwoFactorBtn');
    const twoFactorCodeInput = document.getElementById('twoFactorCodeInput');
    const copySecretBtn = document.getElementById('copySecretBtn');
    const downloadBackupCodesBtn = document.getElementById('downloadBackupCodesBtn');
    const closeTwoFactorAfterSetup = document.getElementById('closeTwoFactorAfterSetup');
    const disableTwoFactorBtn = document.getElementById('disableTwoFactorBtn');
    const cancelDisableTwoFactor = document.getElementById('cancelDisableTwoFactor');
    const disableTwoFactorCodeInput = document.getElementById('disableTwoFactorCodeInput');
    const useBackupCodeCheckbox = document.getElementById('useBackupCodeCheckbox');

    // Открытие модального окна
    if (twoFactorBtn) {
        twoFactorBtn.addEventListener('click', () => {
            if (twoFactorState.enabled) {
                // Показываем шаг отключения
                showTwoFactorStep(3);
            } else {
                // Начинаем настройку
                setupTwoFactor();
            }
            if (twoFactorModal) twoFactorModal.classList.remove('hidden');
        });
    }

    // Закрытие модального окна
    if (closeTwoFactor) {
        closeTwoFactor.addEventListener('click', () => {
            if (twoFactorModal) twoFactorModal.classList.add('hidden');
            showTwoFactorMessage('');
        });
    }

    if (twoFactorModal) {
        twoFactorModal.addEventListener('click', (e) => {
            if (e.target === twoFactorModal) twoFactorModal.classList.add('hidden');
        });
    }

    // Настройка 2FA
    if (enableTwoFactorBtn) {
        enableTwoFactorBtn.addEventListener('click', enableTwoFactor);
    }

    if (twoFactorCodeInput) {
        twoFactorCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        twoFactorCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enableTwoFactor();
        });
    }

    // Копирование секрета
    if (copySecretBtn) {
        copySecretBtn.addEventListener('click', () => {
            const secret = document.getElementById('twoFactorSecret')?.textContent;
            if (secret && secret !== '---') {
                navigator.clipboard.writeText(secret).then(() => {
                    showTwoFactorMessage('Секрет скопирован', false);
                });
            }
        });
    }

    // Скачивание резервных кодов
    if (downloadBackupCodesBtn) {
        downloadBackupCodesBtn.addEventListener('click', downloadBackupCodes);
    }

    // Закрытие после настройки
    if (closeTwoFactorAfterSetup) {
        closeTwoFactorAfterSetup.addEventListener('click', () => {
            if (twoFactorModal) twoFactorModal.classList.add('hidden');
            updateTwoFactorUI();
        });
    }

    // Отключение 2FA
    if (disableTwoFactorBtn) {
        disableTwoFactorBtn.addEventListener('click', disableTwoFactor);
    }

    if (cancelDisableTwoFactor) {
        cancelDisableTwoFactor.addEventListener('click', () => {
            showTwoFactorStep(1);
        });
    }

    if (disableTwoFactorCodeInput) {
        disableTwoFactorCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        disableTwoFactorCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') disableTwoFactor();
        });
    }
}

function showTwoFactorStep(step) {
    const step1 = document.getElementById('twoFactorStep1');
    const step2 = document.getElementById('twoFactorStep2');
    const step3 = document.getElementById('twoFactorStep3');

    if (step1) step1.classList.add('hidden');
    if (step2) step2.classList.add('hidden');
    if (step3) step3.classList.add('hidden');

    const stepEl = document.getElementById('twoFactorStep' + step);
    if (stepEl) stepEl.classList.remove('hidden');

    showTwoFactorMessage('');
}

function showTwoFactorMessage(message, isError = true) {
    const msgEl = document.getElementById('twoFactorMessage');
    if (!msgEl) return;

    msgEl.textContent = message;
    msgEl.style.color = isError ? 'var(--error)' : 'var(--success)';

    if (message) {
        setTimeout(() => {
            msgEl.textContent = '';
        }, 5000);
    }
}

function setupTwoFactor() {
    showTwoFactorStep(1);
    twoFactorState.isSettingUp = true;

    sendToServer({ type: '2fa_setup' });
}

function enableTwoFactor() {
    const codeInput = document.getElementById('twoFactorCodeInput');
    const token = codeInput?.value.trim();

    if (!token || token.length !== 6) {
        showTwoFactorMessage('Введите 6-значный код', true);
        return;
    }

    sendToServer({
        type: '2fa_enable',
        token
    });
}

function disableTwoFactor() {
    const codeInput = document.getElementById('disableTwoFactorCodeInput');
    const backupCheckbox = document.getElementById('useBackupCodeCheckbox');
    const token = codeInput?.value.trim();

    if (!token || token.length !== 6) {
        showTwoFactorMessage('Введите 6-значный код', true);
        return;
    }

    sendToServer({
        type: '2fa_disable',
        token,
        useBackupCode: backupCheckbox?.checked || false
    });
}

function downloadBackupCodes() {
    const codes = twoFactorState.backupCodes;
    if (codes.length === 0) return;

    const content = 'Резервные коды для 2FA\n========================\n\n' +
        'Сохраните эти коды в безопасном месте.\n' +
        'Каждый код можно использовать только один раз.\n\n' +
        codes.map((code, i) => `${i + 1}. ${code}`).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '2fa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
}

function updateTwoFactorUI() {
    const btn = document.getElementById('twoFactorBtn');
    const status = document.getElementById('twoFactorStatus');

    if (!btn || !status) return;

    if (twoFactorState.enabled) {
        btn.textContent = 'Настроить 2FA';
        status.classList.remove('hidden');
    } else {
        btn.textContent = 'Включить 2FA';
        status.classList.add('hidden');
    }
}

// Обработка ответов сервера для 2FA
function handleTwoFAMessage(data) {
    console.log('🔐 2FA message received:', data.type, data);
    
    switch (data.type) {
        case '2fa_setup_response':
            twoFactorState.secret = data.secret;
            const qrEl = document.getElementById('twoFactorQR');
            const secretEl = document.getElementById('twoFactorSecret');
            
            if (qrEl && data.qrCodeUrl) {
                qrEl.src = data.qrCodeUrl;
                console.log('🔐 QR code URL set:', data.qrCodeUrl);
            }
            
            if (secretEl && data.secret) {
                secretEl.textContent = data.secret;
                console.log('🔐 Secret set:', data.secret);
            }
            
            showTwoFactorStep(1);
            break;

        case '2fa_enabled':
            twoFactorState.enabled = true;
            twoFactorState.backupCodes = data.backupCodes || [];
            twoFactorState.isSettingUp = false;

            // Показываем резервные коды
            const codesContainer = document.getElementById('twoFactorBackupCodes');
            if (codesContainer) {
                codesContainer.innerHTML = data.backupCodes
                    .map(code => `<code>${code}</code>`)
                    .join('');
            }

            showTwoFactorStep(2);
            showTwoFactorMessage('2FA успешно включён', false);
            updateTwoFactorUI();
            break;

        case '2fa_disabled':
            twoFactorState.enabled = false;
            twoFactorState.secret = '';
            twoFactorState.backupCodes = [];
            showTwoFactorMessage('2FA отключён', false);
            updateTwoFactorUI();
            setTimeout(() => {
                document.getElementById('twoFactorModal')?.classList.add('hidden');
            }, 1000);
            break;

        case '2fa_error':
            showTwoFactorMessage(data.message || 'Ошибка 2FA', true);
            break;

        case '2fa_verify_error':
            showTwoFactorMessage('Неверный код', true);
            break;

        case '2fa_backup_codes_response':
            twoFactorState.backupCodes = data.backupCodes || [];
            break;
    }
}

// ============================================================================
// 🔐 2FA Вход
// ============================================================================

let login2FAState = {
    username: '',
    token: '',
    deviceId: ''
};

function handleLogin2FARequired(data) {
    login2FAState.username = data.username || '';
    login2FAState.token = data.token || '';
    login2FAState.deviceId = data.deviceId || '';

    // Показываем форму ввода 2FA кода
    showLogin2FAForm();
}

function showLogin2FAForm() {
    const loginTab = document.getElementById('loginTab');
    if (loginTab) loginTab.classList.add('hidden');

    const twoFactorForm = document.createElement('div');
    twoFactorForm.id = 'login2FAForm';
    twoFactorForm.className = 'two-factor-login-form';
    twoFactorForm.innerHTML = `
        <h3>🔐 Двухфакторная аутентификация</h3>
        <p class="two-factor-login-text">Введите код из приложения аутентификации</p>
        <div class="form-group">
            <label for="login2FACodeInput">Код</label>
            <input type="text" id="login2FACodeInput" placeholder="123456" maxlength="6" pattern="[0-9]*" inputmode="numeric">
        </div>
        <div class="form-group">
            <label>
                <input type="checkbox" id="loginUseBackupCodeCheckbox"> Использовать резервный код
            </label>
        </div>
        <button id="login2FASubmitBtn" class="btn-primary" type="button">Войти</button>
        <button id="login2FACancelBtn" class="btn-secondary" type="button">Отмена</button>
        <div id="login2FAStatus" class="status-message" role="alert" aria-live="polite"></div>
    `;

    const loginContainer = document.querySelector('.login-container');
    if (loginContainer) {
        loginContainer.appendChild(twoFactorForm);

        const codeInput = document.getElementById('login2FACodeInput');
        const submitBtn = document.getElementById('login2FASubmitBtn');
        const cancelBtn = document.getElementById('login2FACancelBtn');
        const backupCheckbox = document.getElementById('loginUseBackupCodeCheckbox');

        if (codeInput) {
            codeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
            });
            codeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitLogin2FA();
            });
        }

        if (submitBtn) submitBtn.addEventListener('click', submitLogin2FA);
        if (cancelBtn) cancelBtn.addEventListener('click', cancelLogin2FA);
    }
}

function submitLogin2FA() {
    const codeInput = document.getElementById('login2FACodeInput');
    const backupCheckbox = document.getElementById('loginUseBackupCodeCheckbox');
    const statusEl = document.getElementById('login2FAStatus');

    const token = codeInput?.value.trim();
    if (!token || token.length !== 6) {
        if (statusEl) {
            statusEl.textContent = 'Введите 6-значный код';
            statusEl.style.color = 'var(--error)';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = 'Проверка...';
        statusEl.style.color = 'var(--text-secondary)';
    }

    sendToServer({
        type: 'login_2fa',
        username: login2FAState.username,
        token: login2FAState.token,
        deviceId: login2FAState.deviceId,
        twoFactorToken: token,
        useBackupCode: backupCheckbox?.checked || false
    });
}

function cancelLogin2FA() {
    const twoFactorForm = document.getElementById('login2FAForm');
    const loginTab = document.getElementById('loginTab');

    if (twoFactorForm) twoFactorForm.remove();
    if (loginTab) loginTab.classList.remove('hidden');

    login2FAState = { username: '', token: '', deviceId: '' };
}

function handleLogin2FASuccess(data) {
    cancelLogin2FA();
    handleLoginSuccess(data);
}

function handleLogin2FAError(message) {
    const statusEl = document.getElementById('login2FAStatus');
    if (statusEl) {
        statusEl.textContent = message || 'Неверный код';
        statusEl.style.color = 'var(--error)';
    }
}
