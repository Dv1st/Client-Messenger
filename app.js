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

// Состояние прокрутки
let unreadMessagesCount = 0;
let isUserAtBottom = true;

// Контекстное меню сообщений
let messageContextMenuTarget = null;
let replyToMessage = null;

// 👥 Групповые чаты
let groups = []; // Список групп текущего пользователя
let selectedGroup = null; // Текущая выбранная группа

// 👤 Система профилей
let userProfile = null; // Объект с данными профиля текущего пользователя
let userBadges = []; // Массив значков с состоянием visibility
let viewedProfileUserId = null; // ID пользователя, чей профиль сейчас просматривается

// 🔐 Система шифрования (E2EE)
let masterKey = null; // Master Key пользователя (в памяти, не сохраняется)
let userSalt = null; // Соль пользователя для деривации ключа
let masterKeyTimeout = null; // Таймер очистки ключа
const MASTER_KEY_TIMEOUT = 5 * 60 * 1000; // 5 минут неактивности
let pendingPassword = null; // Временное хранение пароля для инициализации шифрования

// ============================================================================
// 🔹 Константы
// ============================================================================
const WS_URL = 'wss://client-messenger-production.up.railway.app';
const DEBOUNCE_DELAY = 300;
const MESSAGE_MAX_LENGTH = 10000;
const MAX_MESSAGES_IN_STORAGE = 100;
const DEFAULT_MESSAGE_COLOR = '#7B2CBF'; // 🔹 Цвет сообщений по умолчанию (фиолетовый)

const STORAGE_KEYS = {
    USERS: 'messenger_users'
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
    profileStatusMessage: null,

    // 🔧 FIX: ЗАДАЧА 1, 2 - Новые элементы для статуса и аватарки
    customStatusSelect: null,
    customStatusText: null,
    editAvatarPreview: null,
    editAvatarFileInput: null,
    changeAvatarBtn: null,
    removeAvatarBtn: null,

    // 🔧 FIX: Элементы footer sidebar
    footerUserName: null,
    footerUserStatusIndicator: null,
    footerUserInitials: null,
    footerUserAvatar: null,
    footerProfileCard: null
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
        'scrollToBottomBtn', 'unreadCount', 'messageBox', 'sendBtn', 'themeSelect',
        'accentColorSelect', 'messageColorSelect', 'fontSizeSelect', 'showInDirectory',
        'allowGroupInvite', 'soundNotify', 'pushNotify', 'notificationSound',
        'createGroupModal', 'closeCreateGroup',
        'groupNameInput', 'groupMembersSelect', 'createGroupConfirmBtn', 'createGroupStatus',
        // 📎 Элементы для работы с файлами
        'attachFileBtn', 'fileInput', 'filePreviewContainer',
        // 👤 Элементы профиля
        'profileModal', 'editProfileBtn', 'closeProfile', 'profileAvatar',
        'profileUserName', 'profileUserStatus', 'avatarContainer', 'avatarFileInput',
        'badgesGrid', 'editPanel', 'saveProfileBtn', 'cancelProfileBtn', 'avatarUrlInput',
        'applyAvatarUrlBtn', 'badgeVisibilityList', 'profileActionsSection', 'sendMessageBtn',
        'profileStatusMessage',
        // 🔧 FIX: ЗАДАЧА 1, 2 - Новые элементы для статуса и аватарки
        'customStatusSelect', 'customStatusText', 'editAvatarPreview', 'editAvatarFileInput',
        'changeAvatarBtn', 'removeAvatarBtn',
        // ⋮ Меню чата
        'chatMenuBtn', 'chatMenuDropdown', 'deleteChatBtn',
        // 🔧 FIX: Элементы footer sidebar
        'footerUserName', 'footerUserStatusIndicator', 'footerUserInitials', 'footerUserAvatar', 'footerProfileCard'
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
 * Санитизация текста сообщения
 * @param {string} text - Текст сообщения
 * @returns {string} - Очищенный текст
 */
function sanitizeMessageText(text) {
    if (typeof text !== 'string') return '';
    return text.substring(0, MESSAGE_MAX_LENGTH);
}

// ============================================================================
// 🔐 ФУНКЦИИ ШИФРОВАНИЯ (E2EE)
// ============================================================================

/**
 * Инициализация системы шифрования при входе
 * @param {string} password - Пароль пользователя
 * @param {string} salt - Соль пользователя из сервера
 */
async function initializeEncryption(password, salt) {
    try {
        if (!window.CryptoUtils) {
            console.error('❌ CryptoUtils not loaded');
            return false;
        }
        
        userSalt = salt;
        masterKey = await CryptoUtils.deriveMasterKey(password, salt);
        
        // Устанавливаем таймер очистки ключа
        resetMasterKeyTimeout();
        
        console.log('✅ Encryption initialized');
        return true;
    } catch (error) {
        console.error('❌ Initialize encryption error:', error);
        return false;
    }
}

/**
 * Сброс таймера очистки ключа
 */
function resetMasterKeyTimeout() {
    if (masterKeyTimeout) {
        clearTimeout(masterKeyTimeout);
    }
    
    masterKeyTimeout = setTimeout(() => {
        clearMasterKey();
    }, MASTER_KEY_TIMEOUT);
}

/**
 * Очистка мастер-ключа из памяти
 */
function clearMasterKey() {
    if (masterKey) {
        masterKey = null;
        console.log('🔒 Master key cleared from memory');
    }
}

/**
 * Шифрование сообщения перед отправкой
 * @param {string} text - Текст сообщения
 * @param {string} messageId - ID сообщения
 * @returns {Promise<{encryptedContent: string, encryptionHint: string}>}
 */
async function encryptOutgoingMessage(text, messageId) {
    if (!masterKey) {
        throw new Error('Master key not initialized');
    }
    
    // Сбрасываем таймер при активности
    resetMasterKeyTimeout();
    
    return await CryptoUtils.encryptFullMessage(text, masterKey, messageId);
}

/**
 * Расшифровка входящего сообщения
 * @param {string} encryptedContent - Зашифрованный контент
 * @param {string} encryptionHint - Подсказка для расшифровки
 * @param {string} messageId - ID сообщения
 * @returns {Promise<string>} - Расшифрованный текст
 */
async function decryptIncomingMessage(encryptedContent, encryptionHint, messageId) {
    if (!masterKey) {
        throw new Error('Master key not initialized');
    }
    
    // Сбрасываем таймер при активности
    resetMasterKeyTimeout();
    
    return await CryptoUtils.decryptFullMessage(
        encryptedContent, 
        encryptionHint, 
        masterKey, 
        messageId
    );
}

/**
 * Пакетная расшифровка истории сообщений
 * @param {Array} messages - Массив зашифрованных сообщений
 * @returns {Promise<Array>} - Массив расшифрованных сообщений
 */
async function decryptMessageHistory(messages) {
    if (!masterKey) {
        console.warn('⚠️ Cannot decrypt history: master key not available');
        return messages;
    }
    
    const decryptedMessages = [];
    
    for (const msg of messages) {
        try {
            if (msg.encrypted && msg.encryptedContent && msg.encryptionHint) {
                const messageId = msg.id || msg.timestamp.toString();
                const decryptedText = await decryptIncomingMessage(
                    msg.encryptedContent,
                    msg.encryptionHint,
                    messageId
                );
                
                decryptedMessages.push({
                    ...msg,
                    text: decryptedText,
                    decrypted: true
                });
            } else {
                // Сообщение не зашифровано или уже расшифровано
                decryptedMessages.push(msg);
            }
        } catch (error) {
            console.error('❌ Failed to decrypt message:', msg.id || msg.timestamp, error);
            decryptedMessages.push({
                ...msg,
                text: '❌ Ошибка расшифровки',
                decryptionError: true
            });
        }
    }
    
    return decryptedMessages;
}

// ============================================================================
// 🔹 Инициализация
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initDOM();
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
        // 🔒 Первоначальная валидация при загрузке (кнопка остаётся disabled)
        validateRegistrationForm();
    }

    // 🔒 Валидация в реальном времени для формы входа
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');
    if (loginUsernameInput && loginPasswordInput) {
        [loginUsernameInput, loginPasswordInput].forEach(input => {
            input.addEventListener('input', () => {
                validateLoginForm();
            });
        });
        // 🔒 Первоначальная валидация при загрузке (кнопка остаётся disabled)
        validateLoginForm();
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
 * Валидация формы входа в реальном времени
 * Кнопка "Войти" активна только когда заполнены оба поля
 */
function validateLoginForm() {
    const loginBtn = document.getElementById('loginBtn');
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');

    if (!loginBtn || !loginUsernameInput || !loginPasswordInput) {
        if (loginBtn) loginBtn.disabled = true;
        return;
    }

    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    // Кнопка активна только если оба поля заполнены
    const isUsernameFilled = username.length > 0;
    const isPasswordFilled = password.length > 0;

    // Визуальная индикация для полей (опционально)
    loginUsernameInput.classList.toggle('valid', isUsernameFilled);
    loginUsernameInput.classList.toggle('invalid', !isUsernameFilled && username.length > 0);

    loginPasswordInput.classList.toggle('valid', isPasswordFilled);
    loginPasswordInput.classList.toggle('invalid', !isPasswordFilled && password.length > 0);

    // Кнопка активна только если оба поля заполнены
    loginBtn.disabled = !(isUsernameFilled && isPasswordFilled);
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
 * Показ всплывающего уведомления (toast)
 * @param {string} message - Сообщение
 * @param {boolean} isError - Ошибка ли это
 */
function showToast(message, isError = false) {
    // Удаляем существующие toast уведомления
    const existingToast = document.getElementById('toastNotification');
    if (existingToast) {
        existingToast.remove();
    }

    // Создаём элемент уведомления
    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = 'toast-notification';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${isError ? 'var(--error)' : 'var(--success)'};
        color: white;
        padding: 14px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        max-width: 350px;
        word-wrap: break-word;
    `;

    document.body.appendChild(toast);

    // Автозакрытие через 3 секунды
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
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
    pendingPassword = password; // 🔐 Сохраняем пароль для инициализации шифрования

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
    if (!username || !password || password.length < 8) {
        showStatus('Введите имя пользователя и пароль (мин. 8 символов)');
        return;
    }

    if (!isValidUsername(username)) {
        showStatus('Имя должно содержать 3-20 символов (латиница, цифры, _)');
        return;
    }

    if (password.length < 8 || password.length > 100) {
        showStatus('Пароль должен содержать 8-100 символов');
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
            // 🔧 FIX: Расширенное логирование подключения
            console.log('✅ Connected to', WS_URL);
            console.log('🔌 WebSocket state:', socket.readyState === WebSocket.OPEN ? 'OPEN' : socket.readyState);
            reconnectAttempts = 0;
            if (authMessage) socket.send(JSON.stringify(authMessage));
            
            // 🔧 FIX: Отправляем сообщения из очереди после переподключения
            if (isReconnecting) {
                isReconnecting = false;
                flushMessageQueue();
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Валидация данных перед обработкой
                if (!data || typeof data !== 'object') {
                    console.warn('⚠️ Invalid message format from server');
                    return;
                }
                // 🔧 FIX: Логирование входящих сообщений (кратко)
                if (data.type === 'receive_message') {
                    console.log('📩 Received message from:', data.sender, 'at:', new Date(data.timestamp).toLocaleTimeString());
                }
                handleServerMessage(data);
            } catch (e) {
                console.error('❌ Parse error:', e, 'Raw data:', event.data?.substring(0, 100));
            }
        };

        socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            console.log('💡 Проверь: 1) сервер запущен 2) порт 3) CORS 4) wss/ssl');
        };

        socket.onclose = (event) => {
            console.log('🔌 Disconnected:', event.code, event.reason || '');
            
            // 🔧 FIX: Устанавливаем флаг переподключения
            if (event.code !== 1000 && event.code !== 1001) {
                isReconnecting = true;
            }

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
                } else {
                    // 🔧 FIX: Превышено количество попыток - показываем ошибку
                    showToast('❌ Не удалось подключиться к серверу', true);
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
    
    // 🔧 FIX: Если соединение закрыто и это сообщение - добавляем в очередь
    if (message.type === 'send_message' || message.type === 'send_group_message') {
        console.warn('⚠️ WebSocket not ready, queueing message');
        queueMessage(message);
        return false;
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
    // Разрешаем буквы (верхний/нижний регистр), цифры и подчёркивания
    if (data.type.length > 50 || !/^[a-zA-Z0-9_]+$/.test(data.type)) {
        console.warn('⚠️ handleServerMessage: invalid type format', data.type);
        console.warn('   Full data:', JSON.stringify(data).substring(0, 200));
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
                    currentUser = data.username;

                    if (typeof data.isVisibleInDirectory === 'boolean') {
                        isVisibleInDirectory = data.isVisibleInDirectory;
                    }

                    // Показываем чат
                    DOM.loginWindow?.classList.add('hidden');
                    DOM.chatWindow?.classList.remove('hidden');

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
            // 🔴 НОВЫЕ: Обработка начала чата и данных профиля
            case 'chat_started':
                if (data.withUser) {
                    handleChatStarted(data.withUser, data.timestamp, data.success);
                }
                break;
            case 'profile_data':
                if (data.profile) {
                    handleProfileData(data.profile);
                }
                break;
            case 'user_found':
                if (data.user) {
                    handleUserFound(data.user);
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
                    loadMessageHistory(data.messages, data.chatName, data.groupId);
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
            case 'update_group_invite_permission_success':
                if (typeof data.allow === 'boolean') {
                    allowGroupInvite = data.allow;
                    // Визуальная обратная связь об успешном сохранении
                    showToast('🔒 Настройка приватности сохранена', false);
                }
                break;
            // ✅ Обработка успешного обновления видимости в каталоге
            case 'update_visibility_success':
                if (typeof data.isVisible === 'boolean') {
                    isVisibleInDirectory = data.isVisible;
                    // Визуальная обратная связь об успешном сохранении
                    showToast(
                        isVisibleInDirectory 
                            ? '✅ Вы отображаетесь в списке пользователей' 
                            : '🔒 Вы скрыты из списка пользователей',
                        false
                    );
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
            // 🏅 Каталог значков получен с сервера
            case 'badge_catalog':
                if (Array.isArray(data.catalog)) {
                    // Обновляем локальный каталог на основе серверного
                    updateBadgeCatalogFromServer(data.catalog);
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
async function handleLoginSuccess(data) {
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

    // 🔐 Инициализация шифрования
    if (pendingPassword && data.salt) {
        try {
            await initializeEncryption(pendingPassword, data.salt);
            pendingPassword = null; // Очищаем пароль после инициализации
        } catch (error) {
            console.error('❌ Failed to initialize encryption:', error);
        }
    }

    DOM.loginWindow?.classList.add('hidden');
    DOM.chatWindow?.classList.remove('hidden');

    // 📥 Обновляем UI настроек конфиденциальности из сервера
    if (DOM.showInDirectory) {
        DOM.showInDirectory.checked = isVisibleInDirectory;
    }
    if (DOM.allowGroupInvite) {
        DOM.allowGroupInvite.checked = allowGroupInvite;
    }

    // 🔧 FIX: Обновляем footer sidebar с информацией о пользователе
    updateFooterProfile();

    console.log('✅ Connected:', currentUser);
    sendToServer({ type: 'get_users' });
    sendToServer({ type: 'get_groups' }); // 👥 Запрашиваем список групп
    requestBadgeCatalog(); // 🏅 Запрашиваем каталог значков
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
// 🔴 НОВЫЕ: Обработчики для начала чата и профиля
// ============================================================================

/**
 * Обработка уведомления о начале чата
 * @param {string} withUser - Имя пользователя с которым начался чат
 * @param {number} timestamp - Временная метка
 * @param {boolean} success - Успешно ли
 */
function handleChatStarted(withUser, timestamp, success = true) {
    console.log(`💬 Chat started with: ${withUser}`, { success, timestamp });
    
    // Добавляем пользователя в активные чаты если это успешно
    if (success && withUser) {
        // Проверяем есть ли уже чат
        if (!window.hasChatWithUser(withUser)) {
            // Создаём пустой чат в localStorage если его нет
            const key = `chat_messages_${currentUser}_${withUser}`;
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, JSON.stringify([]));
            }
        }
        
        // Добавляем в активные чаты
        addChatToActive(withUser);
        
        // Обновляем sidebar
        if (window.sidebarComponent) {
            window.sidebarComponent.renderChatsList();
        }
        
        // Если чат ещё не открыт, можно предложить открыть его
        if (selectedUser !== withUser) {
            console.log(`💡 Предложение открыть чат с ${withUser}`);
            // Опционально: можно показать уведомление
            showBrowserNotification({
                sender: withUser,
                text: 'Новый чат начался!',
                encrypted: false
            });
        }
    }
}

/**
 * Обработка данных профиля пользователя
 * @param {Object} profile - Данные профиля
 */
function handleProfileData(profile) {
    console.log('👤 Profile data received:', profile);
    
    // Сохраняем данные профиля в localStorage для кэширования
    try {
        const profileKey = `profile_${profile.username}`;
        const cachedProfile = {
            username: profile.username,
            userId: profile.userId,
            statusMessage: profile.customStatus || 'Нет статуса',
            avatarUrl: profile.avatar || '',
            badges: profile.badges || [],
            createdAt: profile.createdAt,
            lastLogin: profile.lastLogin,
            isVisibleInDirectory: profile.isVisibleInDirectory,
            allowGroupInvite: profile.allowGroupInvite
        };
        localStorage.setItem(profileKey, JSON.stringify(cachedProfile));
    } catch (e) {
        console.error('❌ Failed to cache profile:', e);
    }
    
    // Если профиль открыт, обновляем отображение
    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden')) {
        // Обновляем отображение профиля
        renderProfileData(profile);
    }
}

/**
 * Начать чат с пользователем
 * @param {string} username - Имя пользователя
 */
function startChatWithUser(username) {
    if (!username || username === currentUser) {
        console.warn('⚠️ Cannot start chat with self or invalid username');
        return;
    }
    
    console.log(`💬 Starting chat with: ${username}`);
    
    // Отправляем запрос серверу
    sendToServer({
        type: 'start_chat',
        targetUsername: username
    });
    
    // Добавляем в активные чаты локально (до подтверждения сервера)
    addChatToActive(username);
    
    // Обновляем sidebar
    if (window.sidebarComponent) {
        window.sidebarComponent.renderChatsList();
    }
    
    // Открываем чат
    selectUser(username);
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
function loadMessageHistory(messages, chatName, groupId) {
    if (!messages || !Array.isArray(messages)) return;

    console.log(`📜 Loaded ${messages.length} messages for ${chatName || groupId}`);

    if (!DOM.messagesList) return;

    // Очищаем список
    DOM.messagesList.innerHTML = '';

    if (messages.length > 0) {
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => {
            const isOwn = msg.sender === currentUser;
            
            // Исправляем статус доставки для загруженных сообщений
            if (!isOwn && msg.deliveryStatus === 'pending') {
                msg.deliveryStatus = 'delivered';
            }
            if (isOwn && msg.deliveryStatus === 'pending') {
                const msgAge = Date.now() - msg.timestamp;
                if (msgAge > 5000) {
                    msg.deliveryStatus = 'sent';
                }
            }

            const msgEl = createMessageElement(msg, isOwn);
            if (msgEl) fragment.appendChild(msgEl);
        });
        DOM.messagesList.appendChild(fragment);
        DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
        console.log(`📜 ${messages.length} messages rendered`);
    }
}

/**
 * Удаление чата
 * @param {string} chatName - Имя пользователя, чат с которым удалён
 */
function handleChatDeleted(chatName) {
    if (!chatName) {
        console.warn('⚠️ handleChatDeleted: invalid chatName');
        return;
    }
    
    console.log(`🗑️ Chat deleted: ${chatName}`);
    
    // 🔹 Удаляем чат из списка у текущего пользователя
    removeChatFromList(chatName);
    
    // 🔹 Если чат с текущим собеседником - закрываем его
    if (selectedUser === chatName) {
        showGeneralChat();
    }
    
    // 🔹 Сбрасываем activeChat у пользователя
    const user = users.find(u => u.name === chatName);
    if (user) {
        user.activeChat = null;
        saveUsersToStorage();
        renderAll();
    }
}

/**
 * Удалить чат из списка
 * @param {string} username - Имя пользователя
 */
function removeChatFromList(username) {
    if (!window.sidebarComponent) {
        console.warn('⚠️ removeChatFromList: sidebarComponent not initialized');
        return;
    }
    
    // 🔹 Удаляем из активных чатов в localStorage
    const activeChatsKey = `active_chats_${currentUser}`;
    const activeChats = JSON.parse(localStorage.getItem(activeChatsKey) || '[]');
    const updatedChats = activeChats.filter(chat => chat.userId !== username);
    localStorage.setItem(activeChatsKey, JSON.stringify(updatedChats));
    
    // 🔹 Удаляем сообщения чата из localStorage
    const messagesKey = `chat_messages_${currentUser}_${username}`;
    localStorage.removeItem(messagesKey);
    
    // 🔹 Обновляем sidebar
    window.sidebarComponent.renderChatsList();
    
    console.log(`✅ Chat with ${username} removed from list`);
}

/**
 * Подтверждение доставки сообщения
 * @param {number} timestamp - Временная метка сообщения
 */
function confirmMessageDelivery(timestamp) {
    if (!timestamp) {
        console.warn('⚠️ confirmMessageDelivery: invalid timestamp');
        return;
    }
    
    // 🔧 FIX: Логирование подтверждения
    console.log('✅ Message confirmed:', timestamp);
    
    // Обновляем статус доставки
    updateMessageDeliveryStatus(timestamp, 'sent');
    
    // 🔧 FIX: Также обновляем в localStorage
    if (selectedUser) {
        try {
            const messages = loadMessagesFromStorage(selectedUser);
            const msg = messages.find(m => m.timestamp === timestamp);
            if (msg) {
                msg.deliveryStatus = 'sent';
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
            }
        } catch (e) {
            console.error('❌ confirmMessageDelivery error:', e);
        }
    }
}

/**
 * 🔧 FIX: Отмена отправки сообщения по таймауту
 * @param {number} timestamp - Временная метка сообщения
 */
function cancelMessageDelivery(timestamp) {
    if (!timestamp) return;
    
    console.warn('⚠️ Message delivery timeout:', timestamp);
    
    // Обновляем статус на ошибку
    if (DOM.messagesList) {
        const messages = DOM.messagesList.querySelectorAll('.message.own');
        messages.forEach(msg => {
            if (msg.dataset.timestamp == timestamp) {
                const checksEl = msg.querySelector('.checks');
                if (checksEl) {
                    checksEl.className = 'checks';
                    checksEl.textContent = '⚠️';
                    checksEl.title = 'Ошибка доставки';
                    msg.style.opacity = '0.6';
                }
            }
        });
    }
    
    // Показываем уведомление
    showToast('⚠️ Сообщение не было доставлено', true);
}

/**
 * 🔧 FIX: Очередь сообщений на случай разрыва соединения
 */
let messageQueue = [];
let isReconnecting = false;

/**
 * Добавить сообщение в очередь
 */
function queueMessage(message) {
    messageQueue.push({
        ...message,
        queuedAt: Date.now()
    });
    console.log('📭 Message queued:', messageQueue.length);
}

/**
 * Отправить все сообщения из очереди
 */
async function flushMessageQueue() {
    if (messageQueue.length === 0 || !socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }
    
    console.log('📤 Flushing message queue:', messageQueue.length);
    
    const queue = [...messageQueue];
    messageQueue = [];
    
    for (const msg of queue) {
        sendToServer(msg);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
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
async function handleMessageReceive(data) {
    // 🔒 Строгая валидация входящих данных
    if (!data.sender || typeof data.sender !== 'string' || data.sender.length > USERNAME_MAX_LENGTH) {
        console.warn('⚠️ handleMessageReceive: invalid sender');
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

    // 🔐 Расшифровка сообщения если оно зашифровано
    let messageText = data.text;
    let isDecrypted = false;
    
    if (data.isEncrypted && data.encryptedContent && data.encryptionHint && masterKey) {
        try {
            const messageId = data.id || data.timestamp.toString();
            messageText = await decryptIncomingMessage(
                data.encryptedContent,
                data.encryptionHint,
                messageId
            );
            isDecrypted = true;
            console.log('🔓 Message decrypted:', messageId);
        } catch (error) {
            console.error('❌ Failed to decrypt message:', error);
            messageText = '❌ Ошибка расшифровки';
        }
    }

    const messageData = {
        sender: data.sender,
        text: sanitizeMessageText(messageText),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null,
        files: data.files || null,
        encrypted: data.isEncrypted || false,
        encryptedContent: data.encryptedContent || null,
        encryptionHint: data.encryptionHint || null,
        decrypted: isDecrypted
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
    // 🔧 FIX: ЗАДАЧА 10 - Автоматическое отображение входящих сообщений без перезагрузки чата
    if (selectedUser === data.sender || (data.sender === currentUser && data.privateTo === selectedUser)) {
        // Чат открыт - добавляем сообщение сразу
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
        
        // 🔧 FIX: Прокрутка к новому сообщению
        setTimeout(() => {
            scrollToBottom();
        }, 50);
    } else if (data.privateTo === currentUser) {
        // 🔧 FIX: Чат не открыт - увеличиваем счётчик непрочитанных и обновляем sidebar
        addUnreadMessage();
        addMessage(messageData, false, false);
        incrementUnreadCount(data.sender);
        
        // 🔧 FIX: Обновляем sidebar чтобы показать новое последнее сообщение
        if (window.sidebarComponent) {
            window.sidebarComponent.renderChatsList();
        }
    } else if (data.groupId) {
        // 🔧 FIX: Групповое сообщение
        if (selectedGroup === data.groupId) {
            const isAdded = addUnreadMessage();
            if (isAdded) {
                addMessage(messageData);
            } else {
                addMessage(messageData, false, false);
            }
            setTimeout(() => {
                scrollToBottom();
            }, 50);
        } else {
            addUnreadMessage();
            incrementUnreadCount('group_' + data.groupId);
            if (window.sidebarComponent) {
                window.sidebarComponent.renderChatsList();
            }
        }
    }

    if (data.sender !== currentUser) {
        playNotificationSound();
        showBrowserNotification({
            sender: data.sender,
            text: data.text
        });
    }
}

// ============================================================================
// 🔹 Чат
// ============================================================================
function initChat() {
    selectedUser = null;

    // Скрываем заголовок и кнопку меню при инициализации
    if (DOM.chatTitle) {
        DOM.chatTitle.classList.add('hidden');
    }
    if (DOM.chatMenuBtn) {
        DOM.chatMenuBtn.classList.add('hidden');
    }

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

/**
 * 🔧 FIX: Обновление информации о профиле в footer sidebar
 */
function updateFooterProfile() {
    if (!currentUser) return;

    if (DOM.footerUserName) {
        DOM.footerUserName.textContent = currentUser;
    }
    if (DOM.footerUserInitials) {
        DOM.footerUserInitials.textContent = currentUser.slice(0, 2).toUpperCase();
    }
    if (DOM.footerUserStatusIndicator) {
        DOM.footerUserStatusIndicator.className = 'status-indicator online';
    }
    
    // Проверяем аватар из профиля
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        if (profile.avatarUrl && DOM.footerUserAvatar) {
            DOM.footerUserAvatar.innerHTML = `<img src="${escapeHtml(profile.avatarUrl)}" alt="Аватар"><span class="status-indicator online"></span>`;
        }
    } catch (e) {
        console.warn('⚠️ Failed to load profile avatar:', e);
    }
}

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
            // 🔹 Логика начала чата с новым пользователем
            const username = user.username || user.id;
            if (username) {
                // 🔴 НОВОЕ: Используем функцию startChatWithUser которая отправляет запрос серверу
                startChatWithUser(username);
            }
        },

        onSettingsClick: () => {
            // 🔧 FIX: Открытие настроек
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal) {
                settingsModal.classList.remove('hidden');
                syncSettingsUI();
            }
        },

        onProfileClick: () => {
            // 🔧 FIX: Открытие профиля текущего пользователя
            if (currentUser) {
                openProfile(currentUser);
            }
        },

        onCreateGroup: () => {
            // Открытие модального окна создания группы
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

        // 🔐 УДАЛЯЕМ пользователей, которых нет на сервере
        users = users.filter(user => {
            if (!serverUserNames.has(user.name)) {
                console.log(`🗑️ Removing user "${user.name}" - not on server`);
                return false;
            }
            return true;
        });

        // Обновляем существующих пользователей
        users.forEach(user => {
            if (serverUserNames.has(user.name)) {
                const serverUser = serverUsers.find(u => (u.username || u.name) === user.name);
                if (serverUser) {
                    user.status = serverUser.status || (serverUser.online ? 'online' : 'offline');
                    // ✨ Не перезаписываем activeChat с сервера, сохраняем локальн����й
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
            // Находим всех пользователей, у кого activeChat === username и сбрасываем
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
 * Рендеринг всех списков
 */
function renderAll() {
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

        // Получаем последнее сообщение
        const key = `chat_messages_${currentUser}_${user.name}`;
        const saved = localStorage.getItem(key);
        
        // 🔹 ПОКАЗЫВАЕМ ТОЛЬКО пользователей, с которыми есть переписка
        // (отправлено или получено хотя бы одно сообщение)
        if (!saved) return; // Нет сообщений в localStorage
        
        let lastMessage = 'Нет сообщений';
        let timestamp = Date.now();

        try {
            const messages = JSON.parse(saved);
            if (messages.length === 0) return; // Нет сообщений - не показываем в списке
            
            const lastMsg = messages[messages.length - 1];
            lastMessage = lastMsg.text || (lastMsg.fileData ? '📎 Файл' : 'Сообщение');
            timestamp = lastMsg.timestamp || Date.now();
        } catch (e) {
            console.error('❌ renderChatsListData: failed to parse messages:', e);
            return; // Ошибка парсинга - не показываем
        }

        // Добавляем только пользователей с активной перепиской
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
            activeChat: user.activeChat,
            // 🔹 Данные профиля для всплывающей подсказки
            profileData: getUserProfileData(user.name)
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
            } catch (e) {
                console.warn('⚠️ Failed to parse group messages:', e);
            }
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
 * @returns {Array} - Массив пользователей с allowPublicView, исключая тех с кем уже есть чат
 */
window.getPublicUsersData = function() {
    return users
        .filter(user => {
            // 🔧 FIX: Исключаем текущего пользователя
            if (user.name === currentUser) return false;
            
            // Показываем только пользователей, которые разрешили показ в каталоге
            if (user.isVisibleInDirectory === false) return false;
            
            // 🔧 FIX: Исключаем пользователей, с которыми уже есть активный чат (переписка)
            const key = `chat_messages_${currentUser}_${user.name}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const messages = JSON.parse(saved);
                    if (messages && messages.length > 0) {
                        return false; // Уже есть чат - не показывать в поиске
                    }
                } catch (e) {
                    // Ошибка парсинга - показываем пользователя
                }
            }
            
            return true;
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
 * 🔧 FIX: ЗАДАЧА 12 - Получить аватарку пользователя (единый источник для всего приложения)
 * @param {string} username - Имя пользователя
 * @returns {string} - URL аватарки или пустая строка для заглушки
 */
function getUserAvatar(username) {
    try {
        // 🔹 Единый источник: localStorage профиль (profile_${username})
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
    // Заглушка - пустая строка (отображается градиент с инициалами в CSS)
    return '';
}

/**
 * Получить данные профиля пользователя для всплывающей подсказки
 * @param {string} username - Имя пользователя
 * @returns {Object} - Данные профиля
 */
function getUserProfileData(username) {
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${username}`) || '{}');
        const user = users.find(u => u.name === username);
        
        return {
            username: username,
            status: user?.status || 'offline',
            customStatus: profile.statusMessage || 'Нет статуса',
            avatar: profile.avatarUrl || '',
            badges: profile.badges || []
        };
    } catch (e) {
        console.error('❌ getUserProfileData error:', e);
        return {
            username: username,
            status: 'offline',
            customStatus: 'Нет статуса',
            avatar: '',
            badges: []
        };
    }
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
 * 🔹 Проверка, есть ли уже чат с пользователем
 * @param {string} username - Имя пользователя
 * @returns {boolean} - Есть ли уже чат (переписка)
 */
window.hasChatWithUser = function(username) {
    if (!username) return false;
    
    const key = `chat_messages_${currentUser}_${username}`;
    const saved = localStorage.getItem(key);
    
    if (!saved) return false;
    
    try {
        const messages = JSON.parse(saved);
        return messages && messages.length > 0;
    } catch (e) {
        return false;
    }
};

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
    } catch (e) {
        console.error('Mark as read error:', e);
    }
}

/**
 * Обновление выделения выбранного пользователя
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
 * Обновление статуса пользователя в заголовке
 * @param {string} username - Имя пользователя (собеседника!)
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

    // Показываем кнопку меню чата
    if (DOM.chatMenuBtn) {
        DOM.chatMenuBtn.classList.remove('hidden');
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
        DOM.chatTitle.classList.remove('hidden');
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

        // 🔐 Загружаем сообщения с сервера
        sendToServer({
            type: 'get_history',
            chatName: username,
            limit: 100
        });
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
        DOM.chatTitle.textContent = 'Чат';
        DOM.chatTitle.classList.add('hidden');
    }

    updateUserItemSelection(null);

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';
    }

    DOM.chatUserStatus?.classList.add('hidden');

    // Скрываем кнопку меню чата
    if (DOM.chatMenuBtn) {
        DOM.chatMenuBtn.classList.add('hidden');
    }
    closeChatMenu();

    checkMobileView();

    sendToServer({ type: 'chat_open', chatWith: null });
    setInputPanelVisible(false);
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
        DOM.chatTitle.classList.remove('hidden');
    }

    updateUserItemSelection(null);
    unreadMessagesCount = 0;
    isUserAtBottom = true;

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';

        // 🔐 Загружаем сообщения группы с сервера
        sendToServer({
            type: 'get_history',
            groupId: groupId,
            limit: 100
        });
    }

    setInputPanelVisible(true);
    DOM.chatUserStatus?.classList.add('hidden');
    
    // Показываем кнопку меню чата для групп
    if (DOM.chatMenuBtn) {
        DOM.chatMenuBtn.classList.remove('hidden');
    }
    
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
 * Рендеринг выбора участников группы
 * 🔧 FIX: ЗАДАЧА 13 - Показываем только пользователей с активными чатами
 */
function renderGroupMembersSelect() {
    if (!DOM.groupMembersSelect) return;

    DOM.groupMembersSelect.innerHTML = '';

    const fragment = document.createDocumentFragment();

    users.forEach(user => {
        if (user.name === currentUser) return; // Не показываем текущего пользователя

        // 🔧 FIX: ЗАДАЧА 13 - Показываем ТОЛЬКО пользователей с активными чатами
        const hasActiveChat = user.activeChat === currentUser;
        
        // 🔧 FIX: Также проверяем наличие переписки в localStorage
        const hasChatHistory = (() => {
            const key = `chat_messages_${currentUser}_${user.name}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const messages = JSON.parse(saved);
                    return messages && messages.length > 0;
                } catch (e) {
                    console.warn('⚠️ Failed to parse messages:', e);
                }
            }
            return false;
        })();

        // Показываем только если есть активный чат ИЛИ история переписки
        if (!hasActiveChat && !hasChatHistory) {
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
        } else if (hasActiveChat) {
            statusEl.textContent = '✓ В чате';
        } else if (hasChatHistory) {
            statusEl.textContent = '✓ Был чат';
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

    // 🔧 FIX: ЗАДАЧА 13 - Если нет доступных пользователей, показываем сообщение
    if (fragment.children.length === 0) {
        DOM.groupMembersSelect.innerHTML = `
            <div class="search-no-results">
                <span aria-hidden="true">👥</span>
                <span>Нет доступных пользователей</span>
                <small>Показываются только пользователи с которыми есть активный чат</small>
            </div>
        `;
    }

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
async function handleGroupMessageReceive(data) {
    const groupId = data.groupId;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // 🔐 Расшифровка сообщения если оно зашифровано
    let messageText = data.text;
    let isDecrypted = false;
    
    if (data.isEncrypted && data.encryptedContent && data.encryptionHint && masterKey) {
        try {
            const messageId = data.id || data.timestamp.toString();
            messageText = await decryptIncomingMessage(
                data.encryptedContent,
                data.encryptionHint,
                messageId
            );
            isDecrypted = true;
            console.log('🔓 Group message decrypted:', messageId);
        } catch (error) {
            console.error('❌ Failed to decrypt group message:', error);
            messageText = '❌ Ошибка расшифровки';
        }
    }

    const messageData = {
        sender: data.sender,
        text: sanitizeMessageText(messageText),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null,
        groupId: groupId,
        groupName: group.name,
        files: data.files || null,
        encrypted: data.isEncrypted || false,
        encryptedContent: data.encryptedContent || null,
        encryptionHint: data.encryptionHint || null,
        decrypted: isDecrypted
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
            text: messageText,
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

    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    let messageText = text;
    let encryptedContent = null;
    let encryptionHint = null;

    // 🔐 Шифрование сообщения если ключ доступен
    if (masterKey) {
        try {
            const messageId = CryptoUtils.generateMessageId();
            const encrypted = await encryptOutgoingMessage(text, messageId);
            encryptedContent = encrypted.encryptedContent;
            encryptionHint = encrypted.encryptionHint;
            messageText = '[🔒 Зашифровано]'; // Заменяем текст для отображения
        } catch (error) {
            console.error('❌ Encryption error:', error);
            showStatus('⚠️ Ошибка шифрования, отправляем как есть', true);
        }
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
            showStatus('Ошибка обработки файлов', true);
        }
    }

    // 👥 Отправка сообщения в группу
    if (selectedGroup) {
        const groupMessage = {
            type: 'send_group_message',
            groupId: selectedGroup,
            text: messageText,
            timestamp: Date.now(),
            encryptedContent: encryptedContent,
            encryptionHint: encryptionHint,
            isEncrypted: !!encryptedContent,
            replyTo: replyToMessage ? {
                timestamp: replyToMessage.timestamp,
                sender: replyToMessage.sender,
                text: replyToMessage.text
            } : null,
            files: filesData.length > 0 ? filesData : null
        };

        // 🔧 FIX: Логирование отправки
        console.log('📤 Sending group message:', {
            groupId: selectedGroup,
            encrypted: !!encryptedContent,
            timestamp: groupMessage.timestamp
        });

        if (sendToServer(groupMessage)) {
            const msgTimestamp = Date.now();

            addMessage({
                sender: currentUser,
                text: messageText,
                time,
                timestamp: msgTimestamp,
                deliveryStatus: 'pending',
                replyTo: groupMessage.replyTo,
                groupId: selectedGroup,
                files: filesData,
                encrypted: !!encryptedContent,
                encryptedContent: encryptedContent,
                encryptionHint: encryptionHint
            }, true);

            const group = groups.find(g => g.id === selectedGroup);
            if (group) {
                saveGroupMessageToStorage(selectedGroup, {
                    sender: currentUser,
                    text: messageText,
                    time,
                    timestamp: msgTimestamp,
                    deliveryStatus: 'pending',
                    replyTo: groupMessage.replyTo,
                    groupId: selectedGroup,
                    groupName: group.name,
                    files: filesData,
                    encrypted: !!encryptedContent,
                    encryptedContent: encryptedContent,
                    encryptionHint: encryptionHint
                });
            }

            // 🔧 FIX: Таймаут подтверждения доставки (5 секунд)
            setTimeout(() => {
                // Если сообщение всё ещё в статусе pending - показываем ошибку
                const msgEl = document.querySelector(`.message[data-timestamp="${msgTimestamp}"]`);
                if (msgEl && msgEl.querySelector('.checks.pending')) {
                    cancelMessageDelivery(msgTimestamp);
                }
            }, 5000);

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
        encryptedContent: encryptedContent,
        encryptionHint: encryptionHint,
        isEncrypted: !!encryptedContent,
        // Ответ на сообщение
        replyTo: replyToMessage ? {
            timestamp: replyToMessage.timestamp,
            sender: replyToMessage.sender,
            text: replyToMessage.text
        } : null,
        files: filesData.length > 0 ? filesData : null
    };

    // 🔧 FIX: Логирование отправки
    console.log('📤 Sending message:', {
        to: selectedUser,
        encrypted: !!encryptedContent,
        timestamp: message.timestamp
    });

    if (sendToServer(message)) {
        const msgTimestamp = Date.now();

        addMessage({
            sender: currentUser,
            text: messageText,
            time,
            timestamp: msgTimestamp,
            deliveryStatus: 'pending',
            replyTo: message.replyTo,
            files: filesData,
            encrypted: !!encryptedContent,
            encryptedContent: encryptedContent,
            encryptionHint: encryptionHint
        }, true);

        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser,
                text: messageText,
                time,
                timestamp: msgTimestamp,
                deliveryStatus: 'pending',
                replyTo: message.replyTo,
                files: filesData,
                encrypted: !!encryptedContent,
                encryptedContent: encryptedContent,
                encryptionHint: encryptionHint
            });

            // ✨ Добавляем чат в активные
            addChatToActive(selectedUser);
        }

        // 🔧 FIX: Таймаут подтверждения доставки (5 секунд)
        setTimeout(() => {
            // Если сообщение всё ещё в статусе pending - показываем ошибку
            const msgEl = document.querySelector(`.message[data-timestamp="${msgTimestamp}"]`);
            if (msgEl && msgEl.querySelector('.checks.pending')) {
                cancelMessageDelivery(msgTimestamp);
            }
        }, 5000);

        DOM.messageBox.value = '';

        // Сбрасываем ответ
        if (replyToMessage) {
            replyToMessage = null;
            const replyIndicator = document.getElementById('replyIndicator');
            if (replyIndicator) replyIndicator.remove();
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

    const displayText = escapeHtml(data.text);

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

    // Контекстное меню для сообщений (правый клик)
    message.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, message, data, isCurrentUser);
    });

    // Клик по сообщению для ответа (двойной клик)
    message.addEventListener('dblclick', () => {
        if (!isCurrentUser) {
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

    // Реакции (показываем всегда)
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
            // Получаем текущие реакции в формате {emoji: [{userId, timestamp}]}
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
                // Добавляем реакцию
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
 * Обновить каталог значков из сервера
 * @param {Array} catalog - Массив значков с сервера
 */
function updateBadgeCatalogFromServer(catalog) {
    if (!Array.isArray(catalog)) return;

    // Обновляем BADGES_CATALOG на основе серверных данных
    catalog.forEach(item => {
        if (item && item.id && item.icon && item.name) {
            BADGES_CATALOG[item.id] = {
                icon: item.icon,
                name: item.name,
                description: item.description || ''
            };
        }
    });

    console.log(`🏅 Badge catalog updated from server: ${catalog.length} items`);

    // Если открыт профиль - перерисовываем значки
    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden')) {
        renderBadges(userBadges, viewedProfileUserId === currentUser);
    }
}

/**
 * Запросить каталог значков с сервера
 */
function requestBadgeCatalog() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'get_badge_catalog'
        }));
    }
}

/**
 * Инициализация системы профилей
 */
function initProfile() {
    // Загрузка профиля из localStorage
    loadUserProfile();

    // Обработчики событий
    // 🔹 Обработчик перемещён в sidebar-component.js (клик по карточке пользователя)

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

    // 🔧 FIX: ЗАДАЧА 1 - Обработка изменения статуса
    if (DOM.customStatusSelect) {
        DOM.customStatusSelect.addEventListener('change', handleCustomStatusChange);
    }

    // 🔧 FIX: ЗАДАЧА 2 - Обработка изменения аватарки
    if (DOM.changeAvatarBtn) {
        DOM.changeAvatarBtn.addEventListener('click', () => {
            if (DOM.editAvatarFileInput) {
                DOM.editAvatarFileInput.click();
            }
        });
    }

    if (DOM.editAvatarFileInput) {
        DOM.editAvatarFileInput.addEventListener('change', handleEditAvatarFileSelect);
    }

    if (DOM.removeAvatarBtn) {
        DOM.removeAvatarBtn.addEventListener('click', handleRemoveAvatar);
    }

    // Закрытие по клику вне модального окна
    if (DOM.profileModal) {
        DOM.profileModal.addEventListener('click', (e) => {
            if (e.target === DOM.profileModal) {
                closeProfile();
            }
        });
    }

    // ⋮ Меню чата - открытие/закрытие
    if (DOM.chatMenuBtn) {
        DOM.chatMenuBtn.addEventListener('click', toggleChatMenu);
    }

    // Удаление чата
    if (DOM.deleteChatBtn) {
        DOM.deleteChatBtn.addEventListener('click', () => {
            deleteCurrentChat();
            closeChatMenu();
        });
    }

    // Закрытие меню при клике вне его
    document.addEventListener('click', (e) => {
        if (DOM.chatMenuDropdown && !DOM.chatMenuDropdown.classList.contains('hidden')) {
            const isClickInsideMenu = DOM.chatMenuDropdown.contains(e.target);
            const isClickOnButton = DOM.chatMenuBtn && DOM.chatMenuBtn.contains(e.target);
            if (!isClickInsideMenu && !isClickOnButton) {
                closeChatMenu();
            }
        }
    });
}

/**
 * ⋮ Меню чата - открыть/закрыть
 */
function toggleChatMenu() {
    if (!DOM.chatMenuDropdown) return;
    
    const isHidden = DOM.chatMenuDropdown.classList.contains('hidden');
    if (isHidden) {
        openChatMenu();
    } else {
        closeChatMenu();
    }
}

/**
 * ⋮ Открыть меню чата
 */
function openChatMenu() {
    if (!DOM.chatMenuDropdown || !DOM.chatMenuBtn) return;
    
    DOM.chatMenuDropdown.classList.remove('hidden');
    DOM.chatMenuBtn.setAttribute('aria-expanded', 'true');
}

/**
 * ⋮ Закрыть меню чата
 */
function closeChatMenu() {
    if (!DOM.chatMenuDropdown || !DOM.chatMenuBtn) return;
    
    DOM.chatMenuDropdown.classList.add('hidden');
    DOM.chatMenuBtn.setAttribute('aria-expanded', 'false');
}

// ============================================================================
// 🔧 FIX: ЗАДАЧА 1 - Обработка пользовательского статуса
// ============================================================================

/**
 * Обработка изменения статуса
 */
function handleCustomStatusChange() {
    if (!DOM.customStatusSelect) return;
    
    const selectedValue = DOM.customStatusSelect.value;
    
    // Показываем/скрываем поле для своего статуса
    if (DOM.customStatusText) {
        if (selectedValue === 'custom') {
            DOM.customStatusText.classList.remove('hidden');
            DOM.customStatusText.focus();
        } else {
            DOM.customStatusText.classList.add('hidden');
        }
    }
}

/**
 * Получить отображение статуса
 * @param {string} status - Значение статуса
 * @returns {Object} - {text, class, color}
 */
function getStatusDisplay(status) {
    const statusMap = {
        'online': { text: 'Онлайн', class: 'online', color: 'var(--status-online)', icon: '🟢' },
        'offline': { text: 'Офлайн', class: 'offline', color: 'var(--status-offline)', icon: '⚫' },
        'busy': { text: 'Не беспокоить', class: 'busy', color: 'var(--error)', icon: '🔴' },
        'away': { text: 'Отошёл', class: 'away', color: 'var(--warning)', icon: '🟡' },
        'custom': { text: 'Свой статус', class: 'custom', color: 'var(--text-secondary)', icon: '✏️' }
    };
    
    return statusMap[status] || statusMap['offline'];
}

/**
 * Сохранить статус пользователя
 * @param {string} status - Статус
 */
function saveUserStatus(status) {
    if (!currentUser) return;
    
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        profile.customStatus = status;
        localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));
        
        // 🔧 FIX: Отправляем обновление статуса на сервер
        sendToServer({
            type: 'update_user_status',
            status: status,
            username: currentUser
        });
        
        // Обновляем отображение
        updateProfileStatusDisplay(status);
        updateFooterStatusDisplay(status);
        
        console.log('✅ Status saved:', status);
    } catch (e) {
        console.error('❌ Save status error:', e);
    }
}

/**
 * Обновить отображение статуса в профиле
 */
function updateProfileStatusDisplay(status) {
    if (!DOM.profileUserStatus) return;
    
    const statusDisplay = getStatusDisplay(status);
    DOM.profileUserStatus.className = 'profile-user-status ' + statusDisplay.class;
    
    const statusDot = DOM.profileUserStatus.querySelector('.status-dot');
    const statusText = DOM.profileUserStatus.querySelector('.status-text');
    
    if (statusDot) {
        statusDot.style.background = statusDisplay.color;
    }
    if (statusText) {
        statusText.textContent = statusDisplay.text;
    }
}

/**
 * Обновить отображение статуса в footer
 */
function updateFooterStatusDisplay(status) {
    if (!DOM.footerUserStatusIndicator) return;
    
    const statusDisplay = getStatusDisplay(status);
    DOM.footerUserStatusIndicator.className = 'status-indicator ' + statusDisplay.class;
    DOM.footerUserStatusIndicator.style.background = statusDisplay.color;
}

// ============================================================================
// 🔧 FIX: ЗАДАЧА 2 - Обработка аватарки
// ============================================================================

/**
 * Обработка выбора файла аватарки в режиме редактирования
 */
function handleEditAvatarFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // 🔧 FIX: Валидация размера (макс 2MB)
    if (file.size > 2 * 1024 * 1024) {
        showProfileMessage('❌ Размер файла не должен превышать 2MB', true);
        event.target.value = '';
        return;
    }
    
    // 🔧 FIX: Валидация формата
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
        showProfileMessage('❌ Допустимые форматы: PNG, JPG', true);
        event.target.value = '';
        return;
    }
    
    // Предпросмотр
    const reader = new FileReader();
    reader.onload = (e) => {
        if (DOM.editAvatarPreview) {
            DOM.editAvatarPreview.src = e.target.result;
        }
        
        // Сохраняем аватар
        saveAvatar(e.target.result);
    };
    reader.readAsDataURL(file);
    
    // Очищаем input
    event.target.value = '';
}

/**
 * Удаление аватарки
 */
function handleRemoveAvatar() {
    if (!confirm('Вы уверены, что хотите удалить аватарку?')) return;
    
    saveAvatar('');
    
    if (DOM.editAvatarPreview) {
        DOM.editAvatarPreview.src = getDefaultAvatar(currentUser);
    }
    
    showProfileMessage('✅ Аватарка удалена', false);
}

/**
 * Сохранение аватарки
 * @param {string} avatarUrl - URL аватарки (data URL или пустая строка)
 */
function saveAvatar(avatarUrl) {
    if (!currentUser) return;
    
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        profile.avatarUrl = avatarUrl || '';
        localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));
        
        // 🔧 FIX: Отправляем обновление аватара на сервер
        sendToServer({
            type: 'update_profile',
            username: currentUser,
            avatar: avatarUrl || null
        });
        
        // Обновляем отображение везде
        updateAvatarDisplay(avatarUrl);
        
        console.log('✅ Avatar saved');
    } catch (e) {
        console.error('❌ Save avatar error:', e);
    }
}

/**
 * Обновление отображения аватарки во всём приложении
 * @param {string} avatarUrl - URL аватарки
 */
function updateAvatarDisplay(avatarUrl) {
    const url = avatarUrl || getDefaultAvatar(currentUser);
    
    // В профиле
    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = url;
    }
    
    // В режиме редактирования
    if (DOM.editAvatarPreview) {
        DOM.editAvatarPreview.src = url;
    }
    
    // В footer sidebar
    if (DOM.footerUserAvatar) {
        if (avatarUrl) {
            DOM.footerUserAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="Аватар"><span class="status-indicator online"></span>`;
        } else {
            DOM.footerUserAvatar.innerHTML = `<span class="avatar-initials">${currentUser.slice(0, 2).toUpperCase()}</span><span class="status-indicator online"></span>`;
        }
    }
    
    // Обновляем sidebar
    if (window.sidebarComponent) {
        window.sidebarComponent.updateCurrentUser({
            username: currentUser,
            avatar: avatarUrl || null
        });
        window.sidebarComponent.renderChatsList();
    }
}

/**
 * Показать сообщение в профиле
 * @param {string} message - Сообщение
 * @param {boolean} isError - Ошибка ли это
 */
function showProfileMessage(message, isError = false) {
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
 * 🗑️ Удалить текущий чат
 */
function deleteCurrentChat() {
    if (!selectedUser && !selectedGroup) {
        console.warn('⚠️ Нет активного чата для удаления');
        return;
    }

    const chatName = selectedUser || (selectedGroup ? groups.find(g => g.id === selectedGroup)?.name : '');
    const chatType = selectedUser ? 'personal' : 'group';

    if (!confirm(`Вы уверены, что хотите удалить ${chatType === 'personal' ? 'чат с пользователем' : 'группу'} "${chatName}"?\n\nЭто действие нельзя отменить.`)) {
        return;
    }

    try {
        if (selectedUser) {
            // 🔹 Отправляем запрос на сервер (сервер уведомит собеседника)
            sendToServer({ type: 'delete_chat', chatName: selectedUser });
            
            // 🔹 Локально удаляем чат из списка
            removeChatFromList(selectedUser);
            
            console.log(`✅ Личный чат с ${selectedUser} удалён`);
        } else if (selectedGroup) {
            // Удаление группы (только если пользователь создатель)
            const group = groups.find(g => g.id === selectedGroup);
            if (group && group.creator === currentUser) {
                const messagesKey = `group_messages_${selectedGroup}`;
                localStorage.removeItem(messagesKey);

                // Удаляем группу из списка
                groups = groups.filter(g => g.id !== selectedGroup);

                // Отправляем уведомление участникам
                sendToServer({
                    type: 'delete_group',
                    group_id: selectedGroup,
                    user_id: currentUser
                });

                console.log(`✅ Группа "${group.name}" удалена`);
            } else {
                alert('Только создатель может удалить группу');
                return;
            }
        }

        // Очищаем текущий чат
        selectedUser = null;
        selectedGroup = null;

        // Обновляем интерфейс
        if (DOM.messagesList) {
            DOM.messagesList.innerHTML = '';
            DOM.messagesList.classList.add('hidden');
        }
        if (DOM.chatPlaceholder) {
            DOM.chatPlaceholder.classList.remove('hidden');
        }
        if (DOM.inputPanel) {
            DOM.inputPanel.classList.add('hidden');
        }
        if (DOM.chatUserStatus) {
            DOM.chatUserStatus.classList.add('hidden');
        }
        if (DOM.chatTitle) {
            DOM.chatTitle.textContent = 'Чат';
        }

        // Обновляем sidebar
        if (window.sidebarComponent) {
            window.sidebarComponent.renderChatsList();
        }

        closeChatMenu();
    } catch (e) {
        console.error('❌ deleteCurrentChat error:', e);
        alert('Произошла ошибка при удалении чата');
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

    // 🔧 FIX: ЗАДАЧА 1, 2 - Загружаем профиль из localStorage
    const profile = JSON.parse(localStorage.getItem(`profile_${userId}`) || '{}');
    const avatar = profile.avatarUrl || getDefaultAvatar(userId);
    const name = userId;
    
    // Получаем статус (свой или чужой)
    let status;
    if (isOwnProfile) {
        status = profile.customStatus || 'online';
    } else {
        status = getUserStatus(userId);
    }

    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = avatar;
        DOM.profileAvatar.alt = `Аватар ${userId}`;
    }

    if (DOM.profileUserName) {
        DOM.profileUserName.textContent = name;
    }

    if (DOM.profileUserStatus) {
        const statusDisplay = getStatusDisplay(status);
        DOM.profileUserStatus.className = 'profile-user-status ' + statusDisplay.class;
        const statusDot = DOM.profileUserStatus.querySelector('.status-dot');
        const statusText = DOM.profileUserStatus.querySelector('.status-text');
        if (statusDot) {
            statusDot.style.background = statusDisplay.color;
        }
        if (statusText) {
            statusText.textContent = statusDisplay.text;
        }
    }

    // 🔧 FIX: ЗАДАЧА 1 - Заполняем статус в режиме редактирования
    if (isOwnProfile && DOM.customStatusSelect) {
        DOM.customStatusSelect.value = profile.customStatus || 'online';
        if (DOM.customStatusText) {
            if (profile.customStatus === 'custom') {
                DOM.customStatusText.classList.remove('hidden');
            } else {
                DOM.customStatusText.classList.add('hidden');
            }
        }
    }

    // 🔧 FIX: ЗАДАЧА 2 - Заполняем аватарку в режиме редактирования
    if (isOwnProfile && DOM.editAvatarPreview) {
        DOM.editAvatarPreview.src = avatar;
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

    // 🔧 FIX: ЗАДАЧА 11 - Скрываем элементы загрузки аватара для чужого профиля
    const avatarOverlay = document.getElementById('avatarOverlay');
    const avatarFileInput = document.getElementById('avatarFileInput');
    if (avatarOverlay && avatarFileInput) {
        if (isOwnProfile) {
            avatarOverlay.classList.remove('hidden');
            avatarOverlay.style.display = 'flex';
        } else {
            avatarOverlay.classList.add('hidden');
            avatarOverlay.style.display = 'none';
        }
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
        DOM.editProfileBtn.textContent = '✅';
        
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
        showProfileMessage('Выберите изображение', true);
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showProfileMessage('Размер файла не должен превышать 5MB', true);
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

            showProfileMessage('Аватар успешно загружен', false);
        }
    };
    reader.onerror = () => {
        showProfileMessage('Ошибка загрузки файла', true);
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
        showProfileMessage('Введите URL изображения', true);
        return;
    }

    // Простая валидация URL
    try {
        new URL(url);
    } catch {
        showProfileMessage('Неверный формат URL', true);
        return;
    }

    userProfile.avatar = url;
    saveUserProfile();

    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = url;
    }

    DOM.avatarUrlInput.value = '';
    showProfileMessage('Аватар успешно обновлён', false);
}

/**
 * Сохранение изменений профиля
 */
function saveProfileChanges() {
    saveUserProfile();

    // 🔧 FIX: ЗАДАЧА 1 - Сохраняем статус
    if (DOM.customStatusSelect) {
        const status = DOM.customStatusSelect.value;
        saveUserStatus(status);
    }

    // 👤 Отправляем значки на сервер для сохранения в БД
    if (socket && socket.readyState === WebSocket.OPEN && userBadges) {
        sendToServer({
            type: 'update_badges',
            badges: userBadges.map(b => ({ id: b.id, visible: b.visible }))
        });
    }

    toggleEditMode();
    showProfileMessage('Профиль успешно сохранён', false);

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

    // 🔐 Очищаем ключи шифрования
    clearMasterKey();
    userSalt = null;
    pendingPassword = null;
    if (masterKeyTimeout) {
        clearTimeout(masterKeyTimeout);
        masterKeyTimeout = null;
    }

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

// ============================================================================
// 🔹 Настройки (тема, шрифт, цвет)
// ============================================================================
function loadSettings() {
    try {
        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);

        if (!settings) {
            // Применяем значения по умолчанию
            document.documentElement.style.setProperty('--own-message-bg', DEFAULT_MESSAGE_COLOR);
            if (DOM.messageColorSelect) DOM.messageColorSelect.value = DEFAULT_MESSAGE_COLOR;
            
            // 🔒 Устанавливаем значения по умолчанию для настроек приватности
            isVisibleInDirectory = false; // По умолчанию скрыт из каталога
            allowGroupInvite = false; // По умолчанию запрещено добавлять в группы
            
            if (DOM.showInDirectory) DOM.showInDirectory.checked = false;
            if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = false;
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

        // 🔒 Настройки приватности с fallback на false по умолчанию
        if (typeof data.isVisibleInDirectory === 'boolean') {
            isVisibleInDirectory = data.isVisibleInDirectory;
        } else {
            isVisibleInDirectory = false;
        }
        if (DOM.showInDirectory) DOM.showInDirectory.checked = isVisibleInDirectory;

        // ✨ Настройка для групповых чатов с fallback на false по умолчанию
        if (typeof data.allowGroupInvite === 'boolean') {
            allowGroupInvite = data.allowGroupInvite;
        } else {
            allowGroupInvite = false;
        }
        if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = allowGroupInvite;
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
            allowGroupInvite: DOM.allowGroupInvite?.checked ?? false // ✨ Настройка для групповых чатов
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

    // 🔒 Настройка приватности: Отображать в списке пользователей
    if (DOM.showInDirectory) {
        DOM.showInDirectory.addEventListener('change', (e) => {
            isVisibleInDirectory = e.target.checked;
            saveSettings();
            // Отправляем на сервер обновление видимости
            sendToServer({ type: 'update_visibility', isVisible: isVisibleInDirectory });
            // Визуальная обратная связь об успешном сохранении
            showToast(
                isVisibleInDirectory 
                    ? '✅ Вы отображаетесь в списке пользователей' 
                    : '🔒 Вы скрыты из списка пользователей',
                false
            );
        });
    }

    // ✨ Настройка приватности: Разрешить добавлять в групповые чаты
    if (DOM.allowGroupInvite) {
        DOM.allowGroupInvite.addEventListener('change', (e) => {
            allowGroupInvite = e.target.checked;
            saveSettings();
            // Отправляем на сервер обновление разрешения
            sendToServer({ type: 'update_group_invite_permission', allow: allowGroupInvite });
            // Визуальная обратная связь об успешном сохранении
            showToast(
                allowGroupInvite 
                    ? '✅ Другие пользователи могут добавлять вас в группы' 
                    : '🔒 Запрещено добавлять вас в группы',
                false
            );
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

    // Открытие м��дального окна
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
