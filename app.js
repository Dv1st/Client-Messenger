/**
 * Client Messenger - Клиентская часть
 * @version 2.0.0
 * @description Оптимизированная версия с полным кэшированием DOM
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

// ✨ ИЗМЕНЕНО: Ключ сессии для авто-входа
const AUTH_SESSION_KEY = 'messenger_auth_session';

// Расширенный функционал
let currentFolder = 'all';
let isVisibleInDirectory = false; // ✨ ИЗМЕНЕНО: По умолчанию выключено
let searchRateLimit = false;
const userVisibilityCache = new Map();
let contextMenuTarget = null;

// ============================================================================
// 🔹 Константы
// ============================================================================
const WS_URL = 'wss://client-messenger-production.up.railway.app';
const DEBOUNCE_DELAY = 300;
const RATE_LIMIT_DELAY = 500;
const MESSAGE_MAX_LENGTH = 10000;
const MAX_MESSAGES_IN_STORAGE = 100;

const STORAGE_KEYS = {
    USERS: 'messenger_users',
    SETTINGS: 'messenger_settings',
    FOLDERS: 'messenger_folders'
};

// ============================================================================
// 🔹 DOM Cache
// ============================================================================
const DOM = {
    loginWindow: null,
    chatWindow: null,
    settingsModal: null,
    searchBox: null,
    usersList: null,
    activeChatsList: null, // ✨ ИЗМЕНЕНО: Список активных чатов
    messagesList: null,
    inputPanel: null,
    chatPlaceholder: null,
    statusIndicator: null,
    currentUserLabel: null,
    chatTitle: null,
    chatUserStatus: null, // ✨ ИЗМЕНЕНО: Статус пользователя в заголовке
    sidebar: null, // ✨ ИЗМЕНЕНО: Боковая панель
    sidebarToggle: null, // ✨ ИЗМЕНЕНО: Кнопка переключения sidebar
    backBtn: null, // ✨ ИЗМЕНЕНО: Кнопка назад
    scrollToBottomBtn: null, // ✨ ИЗМЕНЕНО: Кнопка прокрутки вниз
    unreadCount: null, // ✨ ИЗМЕНЕНО: Счётчик непрочитанных
    messageBox: null,
    sendBtn: null,
    encryptCheckBox: null,
    encryptKeyBox: null,
    decryptPanel: null,
    decryptKeyBox: null,
    decryptBtn: null,
    themeSelect: null,
    fontSizeSelect: null,
    showInDirectory: null,
    soundNotify: null,
    pushNotify: null,
    notificationSound: null
};

/**
 * Инициализация DOM кэша
 */
function initDOM() {
    const ids = [
        'loginWindow', 'chatWindow', 'settingsModal', 'searchBox', 'usersList',
        'activeChatsList', 'messagesList', 'inputPanel', 'chatPlaceholder', 'statusIndicator',
        'currentUserLabel', 'chatTitle', 'chatUserStatus', 'sidebar', 'sidebarToggle', 'backBtn',
        'scrollToBottomBtn', 'unreadCount',
        'messageBox', 'sendBtn', 'encryptCheckBox',
        'encryptKeyBox', 'decryptPanel', 'decryptKeyBox', 'decryptBtn',
        'themeSelect', 'fontSizeSelect', 'showInDirectory', 'soundNotify',
        'pushNotify', 'notificationSound'
    ];
    ids.forEach(id => {
        DOM[id] = document.getElementById(id);
    });
}

// ============================================================================
// 🔹 Инициализация
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    // ✨ ИЗМЕНЕНО: Сначала пробуем авто-вход, затем инициализируем остальное
    autoLogin();
    initTabs();
    initLogin();
    initChat();
    initSettings();
    initFolders();
    initSidebar(); // ✨ ИЗМЕНЕНО: Инициализация sidebar
    loadSavedUsers();
    loadSettings();
    loadFolderSettings();
    initHotkeys();
});

// ============================================================================
// 🔹 Вкладки
// ============================================================================
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    if (!tabBtns.length || !loginTab || !registerTab) return;

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const isLogin = btn.dataset.tab === 'login';
            loginTab.classList.toggle('active', isLogin);
            registerTab.classList.toggle('active', !isLogin);
        });
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

function showStatus(message, isError = true) {
    const statusEl = document.getElementById('loginStatus');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--error)' : 'var(--success)';
    setTimeout(() => { statusEl.textContent = ''; }, 5000);
}

function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showStatus('Введите имя пользователя и пароль');
        return;
    }

    currentUser = username;
    window.currentUserPassword = password;
    connectToServer({ type: 'login', username, password });
}

function handleRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;

    if (password.length < 4) {
        showStatus('Пароль должен содержать минимум 4 символа');
        return;
    }

    if (password !== confirm) {
        showStatus('Пароли не совпадают');
        return;
    }

    currentUser = username;
    window.currentUserPassword = password;
    connectToServer({ type: 'register', username, password });
}

// ============================================================================
// 🔹 WebSocket
// ============================================================================
function connectToServer(authMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (authMessage) socket.send(JSON.stringify(authMessage));
        return;
    }

    try {
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;
            socket.close();
        }

        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            console.log('✅ Connected');
            reconnectAttempts = 0;
            updateStatus('connected');
            if (authMessage) socket.send(JSON.stringify(authMessage));
        };

        socket.onmessage = (event) => {
            try {
                handleServerMessage(JSON.parse(event.data));
            } catch (e) {
                console.error('❌ Parse error:', e);
            }
        };

        socket.onerror = () => {
            updateStatus('disconnected');
        };

        socket.onclose = (event) => {
            updateStatus('disconnected');

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
        showStatus('Ошибка: ' + error.message);
        updateStatus('disconnected');
    }
}

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
    switch (data.type) {
        case 'register_success':
            showStatus('✅ Регистрация успешна! Теперь войдите', false);
            break;
        case 'register_error':
        case 'login_error':
        case 'error':
            showStatus(data.message);
            break;
        case 'login_success':
            currentUser = data.username;
            if (typeof data.isVisibleInDirectory === 'boolean') {
                isVisibleInDirectory = data.isVisibleInDirectory;
            }
            // ✨ ИЗМЕНЕНО: Сохраняем сессию для авто-входа
            if (window.currentUserPassword) {
                saveAuthSession(currentUser, window.currentUserPassword);
            }
            DOM.loginWindow.classList.add('hidden');
            DOM.chatWindow.classList.remove('hidden');
            DOM.currentUserLabel.textContent = currentUser;
            updateStatus('connected');
            sendToServer({ type: 'get_users' });
            requestAudioPermission();
            break;
        case 'user_list':
            updateUsersList(data.users || []);
            break;
        case 'user_online':
            updateUserStatus(data.username, 'online', data.activeChat || null);
            break;
        case 'user_offline':
            updateUserStatus(data.username, 'offline', null);
            break;
        case 'user_status_update':
            updateUserStatus(data.username, data.status, data.activeChat || null);
            break;
        case 'user_visibility_update':
            updateUserVisibility(data.username, data.isVisible);
            break;
        case 'receive_message':
            handleMessageReceive(data);
            break;
        // ✨ ИЗМЕНЕНО: Обработка подтверждения доставки сообщения
        case 'message_confirmed':
            updateMessageDeliveryStatus(data.timestamp, 'sent');
            break;
        // ✨ ИЗМЕНЕНО: Обработка подтверждения прочтения
        case 'message_read_receipt':
            updateMessageDeliveryStatus(data.timestamp, 'delivered');
            break;
    }
}

// ✨ ИЗМЕНЕНО: Обновление статуса доставки сообщения
function updateMessageDeliveryStatus(timestamp, status) {
    if (!DOM.messagesList || !timestamp) return;

    // Находим сообщение по timestamp
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

    // Обновляем в localStorage
    if (selectedUser) {
        const messages = loadMessagesFromStorage(selectedUser);
        const msg = messages.find(m => m.timestamp === timestamp);
        if (msg) {
            msg.deliveryStatus = status;
            localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(messages));
        }
    }
}

// ✨ ИЗМЕНЕНО: Обработка подтверждения прочтения сообщений
function handleReadReceipt(data) {
    console.log(`✅ Сообщение прочитано: ${data.from} в ${data.timestamp}`);
    // Можно добавить визуальную индикацию в сообщениях
}

// ============================================================================
// 🔹 Входящие сообщения
// ============================================================================
function handleMessageReceive(data) {
    // ✨ ИЗМЕНЕНО: Исправлена доставка сообщений офлайн-пользователям
    const messageData = {
        sender: data.sender,
        text: data.text,
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        encrypted: data.encrypted || false,
        hint: data.hint || null,
        delivered: false, // ✨ ИЗМЕНЕНО: Флаг доставки
        deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered' // ✨ ИЗМЕНЕНО: Статус доставки
    };

    // ✨ ИЗМЕНЕНО: Сохраняем сообщение для получателя (privateTo) и для отправителя
    const chatName = data.privateTo || 'general';

    // Сохраняем сообщение в чат с собеседником (для получателя)
    if (data.privateTo && data.privateTo === currentUser) {
        saveMessageToStorage(data.sender, messageData);
    }
    // Сохраняем сообщение в чат с собеседником (для отправителя - подтверждение отправки)
    else if (data.sender === currentUser && data.privateTo) {
        saveMessageToStorage(data.privateTo, messageData);
    }
    // Общие сообщения
    else {
        saveMessageToStorage(chatName, messageData);
    }

    // ✨ ИЗМЕНЕНО: Показываем сообщение только если чат открыт с отправителем ИЛИ это наше отправленное сообщение
    if (selectedUser === data.sender || (data.sender === currentUser && data.privateTo === selectedUser)) {
        // Проверяем, нужно ли добавлять непрочитанное сообщение
        const isAdded = addUnreadMessage();
        if (isAdded) {
            addMessage(messageData);
        } else {
            // Сообщение добавлено в очередь, но не показано
            addMessage(messageData, false, false); // scrollToBottom = false
        }
        
        // ✨ ИЗМЕНЕНО: Отправляем подтверждение прочтения
        if (data.privateTo && data.sender !== currentUser) {
            sendToServer({ type: 'message_read', from: data.sender, timestamp: data.timestamp });
        }
    } else if (data.privateTo === currentUser) {
        // ✨ ИЗМЕНЕНО: Сообщение пришло в текущий открытый чат, но от другого пользователя
        addUnreadMessage();
        addMessage(messageData, false, false);
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
    // ✨ ИЗМЕНЕНО: По умолчанию ни один чат не открыт
    selectedUser = null;
    
    // ✨ ИЗМЕНЕНО: Инициализация отслеживания прокрутки
    initScrollTracking();

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

    if (DOM.searchBox) {
        let searchTimeout = null;
        DOM.searchBox.addEventListener('input', () => {
            if (searchRateLimit) return;
            searchRateLimit = true;
            setTimeout(() => { searchRateLimit = false; }, RATE_LIMIT_DELAY);

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(searchUsersEnhanced, DEBOUNCE_DELAY);
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

// ✨ ИЗМЕНЕНО: Инициализация sidebar
function initSidebar() {
    if (DOM.sidebarToggle) {
        DOM.sidebarToggle.addEventListener('click', toggleSidebar);
    }
    
    if (DOM.backBtn) {
        DOM.backBtn.addEventListener('click', showMobileChatList);
    }
    
    // Загрузка состояния sidebar из localStorage
    const sidebarCollapsed = localStorage.getItem('sidebar_collapsed');
    if (sidebarCollapsed === 'true' && window.innerWidth > 768) {
        DOM.sidebar?.classList.add('collapsed');
        updateSidebarToggleIcon();
    }
    
    // Проверка мобильного вида
    checkMobileView();
}

// ✨ ИЗМЕНЕНО: Инициализация отслеживания прокрутки
function initScrollTracking() {
    if (!DOM.messagesList || !DOM.scrollToBottomBtn) return;
    
    // Переменные для отслеживания
    window.unreadMessagesCount = 0;
    window.isUserAtBottom = true;
    
    // Отслеживание прокрутки с debounce для производительности
    let scrollTimeout = null;
    DOM.messagesList.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            checkScrollPosition();
            scrollTimeout = null;
        }, 100);
    }, { passive: true });
    
    // Обработчик кнопки
    DOM.scrollToBottomBtn.addEventListener('click', scrollToBottom);
}

// ✨ ИЗМЕНЕНО: Проверка позиции прокрутки
function checkScrollPosition() {
    if (!DOM.messagesList) return;
    
    const threshold = 100;
    const position = DOM.messagesList.scrollTop + DOM.messagesList.clientHeight;
    const height = DOM.messagesList.scrollHeight;
    
    window.isUserAtBottom = (height - position) < threshold;
    updateScrollButton();
}

// ✨ ИЗМЕНЕНО: Обновление кнопки прокрутки
function updateScrollButton() {
    if (!DOM.scrollToBottomBtn || !DOM.unreadCount) return;
    
    if (window.isUserAtBottom) {
        DOM.scrollToBottomBtn.classList.add('hidden');
        window.unreadMessagesCount = 0;
        DOM.unreadCount.textContent = '0';
    } else if (window.unreadMessagesCount > 0) {
        DOM.scrollToBottomBtn.classList.remove('hidden');
        DOM.unreadCount.textContent = window.unreadMessagesCount > 99 ? '99+' : window.unreadMessagesCount;
    }
}

// ✨ ИЗМЕНЕНО: Прокрутка вниз
function scrollToBottom() {
    if (!DOM.messagesList) return;
    
    DOM.messagesList.scrollTo({
        top: DOM.messagesList.scrollHeight,
        behavior: 'smooth'
    });
    
    window.unreadMessagesCount = 0;
    updateScrollButton();
}

// ✨ ИЗМЕНЕНО: Добавление непрочитанных сообщений
function addUnreadMessage() {
    if (!window.isUserAtBottom) {
        window.unreadMessagesCount++;
        updateScrollButton();
        return false; // Сообщение не показано автоматически
    }
    return true; // Сообщение показано автоматически
}

// ✨ ИЗМЕНЕНО: Переключение sidebar
function toggleSidebar() {
    if (!DOM.sidebar) return;
    
    DOM.sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', DOM.sidebar.classList.contains('collapsed'));
    updateSidebarToggleIcon();
}

// ✨ ИЗМЕНЕНО: Обновление иконки sidebar
function updateSidebarToggleIcon() {
    if (!DOM.sidebarToggle) return;
    
    const icon = DOM.sidebarToggle.querySelector('.toggle-icon');
    if (DOM.sidebar?.classList.contains('collapsed')) {
        icon.textContent = '▶';
    } else {
        icon.textContent = '◀';
    }
}

// ✨ ИЗМЕНЕНО: Проверка мобильного вида
function checkMobileView() {
    if (!DOM.sidebar || !DOM.backBtn) return;
    
    const isMobile = window.innerWidth <= 768;
    const hasSelectedUser = selectedUser !== null;
    
    // Определяем нужно ли скрывать sidebar
    const shouldHideSidebar = isMobile && hasSelectedUser;
    
    DOM.sidebar.classList.toggle('mobile-hidden', shouldHideSidebar);
    DOM.backBtn.classList.toggle('hidden', !shouldHideSidebar);
}

// ✨ ИЗМЕНЕНО: Показать список чатов на мобильном
function showMobileChatList() {
    if (!DOM.sidebar) return;
    
    DOM.sidebar.classList.remove('mobile-hidden');
    if (DOM.backBtn) DOM.backBtn.classList.add('hidden');
    
    // На ПК возвращаем к общему виду
    if (window.innerWidth > 768) {
        showGeneralChat();
    }
}

function setInputPanelVisible(isVisible) {
    if (!DOM.inputPanel || !DOM.chatPlaceholder || !DOM.messagesList) return;

    DOM.inputPanel.classList.toggle('hidden', !isVisible);
    DOM.chatPlaceholder.classList.toggle('hidden', isVisible);
    DOM.messagesList.classList.toggle('hidden', !isVisible);

    if (isVisible && DOM.messagesList) {
        DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
    }
}

function updateStatus(status) {
    if (DOM.statusIndicator) {
        DOM.statusIndicator.className = 'status-indicator ' + status;
    }
}

// ============================================================================
// 🔹 Пользователи
// ============================================================================
function updateUsersList(serverUsers) {
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
}

function updateUserStatus(username, status, activeChat = null) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.status = status;
        user.activeChat = activeChat;
        saveUsersToStorage();
        renderUsers();
        
        // ✨ ИЗМЕНЕНО: Обновляем статус в заголовке если чат открыт
        if (selectedUser === username) {
            updateChatUserStatus(username);
        }
    }
}

function updateUserVisibility(username, isVisible) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.isVisibleInDirectory = isVisible;
        saveUsersToStorage();
        renderUsers();
    }
}

function renderUsers() {
    if (!DOM.usersList) return;

    DOM.usersList.innerHTML = '';
    const searchQuery = DOM.searchBox ? DOM.searchBox.value.toLowerCase().trim() : '';
    const fragment = document.createDocumentFragment();

    users.forEach(userObj => {
        if (userObj.name === currentUser) return;

        const isExactMatch = searchQuery === userObj.name.toLowerCase();
        if (!userObj.isVisibleInDirectory && !isExactMatch && !userVisibilityCache.get(userObj.name)) {
            return;
        }

        const userFolder = getUserFolder(userObj.name);
        if (currentFolder !== 'all' && userFolder !== currentFolder) return;

        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.dataset.username = userObj.name;

        // ✨ ИЗМЕНЕНО: Скрываем статус для неактивных чатов
        let statusClass = 'offline';
        let statusIcon = '⚫';

        // Показываем статус только для выбранного пользователя
        if (selectedUser === userObj.name) {
            if (userObj.status === 'online') {
                statusClass = 'online';
                statusIcon = '🟢';
            } else if (userObj.status === 'in_chat') {
                statusClass = 'in-chat';
                statusIcon = '🔵';
            }
        }
        // Для остальных - скрываем визуальные индикаторы
        else {
            statusClass = 'offline';
            statusIcon = '⚫';
        }

        item.classList.add(statusClass);
        item.innerHTML = `
            <span class="status">${statusIcon}</span>
            <span class="name">${escapeHtml(userObj.name)}</span>
            <div class="action-buttons">
                <button class="action-btn pin-btn ${userObj.isPinned ? 'pinned' : ''}" title="Закрепить">📌</button>
                <button class="action-btn delete-btn" title="Удалить чат">🗑️</button>
            </div>
        `;

        const nameEl = item.querySelector('.name');
        const pinBtn = item.querySelector('.pin-btn');
        const deleteBtn = item.querySelector('.delete-btn');

        if (nameEl) nameEl.addEventListener('click', () => selectUser(userObj.name));
        if (pinBtn) pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(userObj.name); });
        if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(userObj.name, item); });
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFolderContextMenu(e, userObj.name);
        });

        fragment.appendChild(item);
    });

    DOM.usersList.appendChild(fragment);
    
    // ✨ ИЗМЕНЕНО: Рендерим активные чаты
    renderActiveChats();
}

// ✨ ИЗМЕНЕНО: Функция рендеринга активных чатов
function renderActiveChats() {
    if (!DOM.activeChatsList) return;

    DOM.activeChatsList.innerHTML = '';

    // Находим пользователей с активными чатами
    const activeChats = users.filter(u =>
        u.name !== currentUser &&
        u.activeChat &&
        (u.status === 'online' || u.status === 'in_chat')
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
        item.innerHTML = `
            <span class="chat-icon">💬</span>
            <span class="chat-name">${escapeHtml(userObj.name)}</span>
            <button class="close-chat" title="Закрыть">✕</button>
        `;

        const nameEl = item.querySelector('.chat-name');
        const closeBtn = item.querySelector('.close-chat');

        if (nameEl) nameEl.addEventListener('click', () => selectUser(userObj.name));
        if (closeBtn) closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showGeneralChat();
        });
        item.addEventListener('click', () => selectUser(userObj.name));

        fragment.appendChild(item);
    });

    DOM.activeChatsList.appendChild(fragment);
}

// ✨ ИЗМЕНЕНО: Оптимизация - кэширование selectAll
const USER_ITEM_SELECTOR = '.user-item';

function updateUserItemSelection(username) {
    document.querySelectorAll(USER_ITEM_SELECTOR).forEach(item => {
        if (username) {
            item.classList.toggle('selected', item.dataset.username === username);
        } else {
            item.classList.remove('selected');
        }
    });
}

// ✨ ИЗМЕНЕНО: Обновление статуса пользователя в заголовке чата
function updateChatUserStatus(username) {
    if (!DOM.chatUserStatus) return;
    
    const user = users.find(u => u.name === username);
    if (!user) {
        DOM.chatUserStatus.classList.add('hidden');
        return;
    }
    
    const statusClass = user.status === 'in_chat' ? 'in-chat' : user.status;
    const statusLabels = {
        'online': 'Онлайн',
        'in-chat': 'В чате',
        'offline': 'Офлайн'
    };
    
    DOM.chatUserStatus.classList.remove('hidden', 'online', 'offline', 'in-chat');
    DOM.chatUserStatus.classList.add(statusClass);
    
    const statusText = DOM.chatUserStatus.querySelector('.status-text');
    if (statusText) {
        statusText.textContent = statusLabels[statusClass] || 'Офлайн';
    }
}

function selectUser(username) {
    selectedUser = username;
    if (DOM.chatTitle) DOM.chatTitle.textContent = `💬 ${username}`;

    // ✨ ИЗМЕНЕНО: Оптимизация - используем кэшированную функцию
    updateUserItemSelection(username);
    
    // ✨ ИЗМЕНЕНО: Сбрасываем счётчик непрочитанных при переключении чата
    window.unreadMessagesCount = 0;
    window.isUserAtBottom = true;

    // ✨ ИЗМЕНЕНО: Очищаем сообщения перед загрузкой новых
    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';

        // Загружаем сообщения из localStorage
        const messages = loadMessagesFromStorage(username);
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

    // ✨ ИЗМЕНЕНО: Обновляем статус пользователя в заголовке
    updateChatUserStatus(username);

    // ✨ ИЗМЕНЕНО: Обновляем мобильный вид
    checkMobileView();
    
    // ✨ ИЗМЕНЕНО: Скрываем кнопку прокрутки
    updateScrollButton();

    // ✨ ИЗМЕНЕНО: Отправляем серверу что открыли чат
    sendToServer({ type: 'chat_open', chatWith: username });

    setTimeout(() => { if (DOM.messageBox) DOM.messageBox.focus(); }, 100);
}

function showGeneralChat() {
    selectedUser = null;
    if (DOM.chatTitle) DOM.chatTitle.textContent = '💬 Общий чат';
    
    // ✨ ИЗМЕНЕНО: Оптимизация - используем кэшированную функцию
    updateUserItemSelection(null);
    
    if (DOM.messagesList) DOM.messagesList.innerHTML = '';
    
    // ✨ ИЗМЕНЕНО: Скрываем статус пользователя
    if (DOM.chatUserStatus) DOM.chatUserStatus.classList.add('hidden');
    
    // ✨ ИЗМЕНЕНО: Обновляем мобильный вид
    checkMobileView();

    // ✨ ИЗМЕНЕНО: Отправляем серверу что закрыли чат
    sendToServer({ type: 'chat_open', chatWith: null });

    setInputPanelVisible(false);
}

function togglePin(username) {
    const userObj = users.find(u => u.name === username);
    if (userObj) {
        userObj.isPinned = !userObj.isPinned;
        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        saveUsersToStorage();
        renderUsers();
    }
}

function deleteChat(username, itemElement) {
    if (confirm(`Удалить чат с "${username}"?`)) {
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
function searchUsersEnhanced() {
    if (!DOM.searchBox) return;

    const query = DOM.searchBox.value.toLowerCase().trim();
    if (!query) {
        renderUsers();
        return;
    }

    const exactMatch = users.find(u => u.name.toLowerCase() === query);

    document.querySelectorAll('.user-item').forEach(item => {
        const nameEl = item.querySelector('.name');
        if (!nameEl) return;

        const name = nameEl.textContent.toLowerCase();
        let isVisible = false;

        if (query.length < 3) {
            isVisible = name.includes(query) &&
                       (item.classList.contains('online') || item.classList.contains('in-chat'));
        } else if (exactMatch && name === query) {
            isVisible = true;
        } else {
            isVisible = name.includes(query);
        }

        item.style.display = isVisible ? 'flex' : 'none';
    });
}

function handleSearchEnter() {
    if (!DOM.searchBox) return;

    const query = DOM.searchBox.value.toLowerCase().trim();
    if (!query) return;

    const exactMatch = users.find(u => u.name.toLowerCase() === query && u.name !== currentUser);

    if (exactMatch) {
        selectUser(exactMatch.name);
        DOM.searchBox.value = '';
    } else if (DOM.usersList) {
        const msg = document.createElement('div');
        msg.textContent = '🔍 Пользователь не найден';
        msg.style.cssText = 'padding: 10px; text-align: center; color: var(--text-secondary); font-size: 13px;';
        DOM.usersList.insertBefore(msg, DOM.usersList.firstChild);
        setTimeout(() => msg.remove(), 2000);
    }
}

// ============================================================================
// 🔹 Папки
// ============================================================================
// ✨ ИЗМЕНЕНО: Упрощённая функция - папки больше не нужны
function initFolders() {
    // Папки удалены, оставляем только "Список пользователей"
    currentFolder = 'all';
}

function loadFolderSettings() {
    // ✨ ИЗМЕНЕНО: Папки удалены, настройки не нужны
    currentFolder = 'all';
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

    menu.innerHTML = `
        <div class="context-menu-item" data-folder="all">${currentFolderUser === 'all' ? '✓ ' : ''}📁 Все</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-folder="personal">${currentFolderUser === 'personal' ? '✓ ' : ''}💕 Личное</div>
        <div class="context-menu-item" data-folder="work">${currentFolderUser === 'work' ? '✓ ' : ''}💼 Работа</div>
    `;

    document.body.appendChild(menu);

    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            setUserFolder(username, item.dataset.folder);
            cleanupMenu();
        });
    });

    const cleanupMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };

    const closeMenu = (clickEvent) => {
        if (!menu.contains(clickEvent.target)) cleanupMenu();
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu, { once: true });
    }, 100);
}

// ============================================================================
// 🔹 Отправка сообщений
// ============================================================================
function sendMessage() {
    if (!DOM.messageBox) return;

    const text = DOM.messageBox.value.trim();
    if (!text) return;

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
        privateTo: selectedUser || null
    };

    if (sendToServer(message)) {
        // ✨ ИЗМЕНЕНО: Добавляем сообщение со статусом 'pending' (ожидает отправки)
        addMessage({
            sender: currentUser,
            text: messageText,
            time,
            timestamp: Date.now(),
            encrypted: encrypt,
            hint,
            deliveryStatus: 'pending' // ✨ ИЗМЕНЕНО: Статус доставки
        }, true);

        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser,
                text: messageText,
                time,
                timestamp: Date.now(),
                encrypted: encrypt,
                hint: encrypt ? generateHint(key) : null,
                deliveryStatus: 'pending' // ✨ ИЗМЕНЕНО: Сохраняем статус
            });
        }

        DOM.messageBox.value = '';

        if (encrypt && DOM.encryptCheckBox && DOM.encryptKeyBox) {
            DOM.encryptCheckBox.checked = false;
            DOM.encryptKeyBox.classList.add('hidden');
        }
    } else {
        showStatus('❌ Не удалось отправить');
    }
}

// ============================================================================
// 🔹 Отображение сообщений
// ============================================================================

// ✨ ИЗМЕНЕНО: Создание элемента сообщения (без добавления в DOM)
function createMessageElement(data, isOwn = false) {
    if (!data) return null;

    const message = document.createElement('div');
    const isCurrentUser = data.sender === currentUser || isOwn;
    message.className = `message ${isCurrentUser ? 'own' : 'other'}`;
    
    // ✨ ИЗМЕНЕНО: Сохраняем timestamp для обновления статуса доставки
    message.dataset.timestamp = data.timestamp;

    const displayText = data.encrypted
        ? `🔒 Зашифровано (подсказка: ${escapeHtml(data.hint || '???')})`
        : escapeHtml(data.text);

    // ✨ ИЗМЕНЕНО: Добавляем статус доставки
    const deliveryStatus = data.deliveryStatus || 'sent'; // 'pending', 'sent', 'delivered', 'read'
    const checksHtml = isCurrentUser ? getDeliveryStatusHtml(deliveryStatus) : '';

    message.innerHTML = `
        ${!isCurrentUser ? `<div class="sender">${escapeHtml(data.sender)}</div>` : ''}
        <div class="text">${displayText}</div>
        <div class="meta">
            <span class="time">${data.time || ''}</span>
            ${checksHtml}
        </div>
    `;

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

    return message;
}

// ✨ ИЗМЕНЕНО: HTML для статуса доставки
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

// ✨ ИЗМЕНЕНО: Добавление сообщения в DOM
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
    const messageEl = DOM.messagesList.children[messageIndex];

    if (messageEl && messageEl.dataset.encrypted === 'true') {
        try {
            const decrypted = xorDecrypt(messageEl.dataset.text, key);
            messageEl.querySelector('.text').textContent = decrypted;
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
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
    }
    return btoa(encodeURIComponent(result));
}

function xorDecrypt(encryptedBase64, passphrase) {
    if (!encryptedBase64 || !passphrase) return encryptedBase64;
    const xored = decodeURIComponent(atob(encryptedBase64));
    let result = '';
    for (let i = 0; i < xored.length; i++) {
        result += String.fromCharCode(xored.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
    }
    return result;
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
    DOM.notificationSound.currentTime = 0;
    DOM.notificationSound.volume = 0.5;
    DOM.notificationSound.play().catch(err => console.warn('⚠️ Sound error:', err.message));
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

    if (Notification.permission === 'granted') {
        new Notification('Client Messenger', {
            body: `${data.sender}: ${data.encrypted ? '🔒 Зашифрованное' : data.text.substring(0, 50)}`,
            icon: '🔔'
        });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
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
            // ✨ ИЗМЕНЕНО: Применяем размер шрифта через CSS класс
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
    // ✨ ИЗМЕНЕНО: Синхронизируем размер шрифта из CSS класса
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
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu) contextMenu.remove();
        }
    });
}

// ✨ ИЗМЕНЕНО: Функции авто-входа и управления сессией
function autoLogin() {
    try {
        const session = localStorage.getItem(AUTH_SESSION_KEY);
        if (session) {
            const sessionData = JSON.parse(session);
            // Проверяем валидность сессии (не истекла ли)
            const now = Date.now();
            const sessionAge = now - (sessionData.timestamp || 0);
            const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 часа

            if (sessionAge < SESSION_MAX_AGE && sessionData.username) {
                currentUser = sessionData.username;
                window.currentUserPassword = sessionData.passwordHash || sessionData.password || '';
                // Подключаемся к серверу
                connectToServer({
                    type: 'login',
                    username: currentUser,
                    password: window.currentUserPassword
                });
                console.log('✅ Auto-login successful for:', currentUser);
                return true;
            } else {
                // Сессия истекла
                localStorage.removeItem(AUTH_SESSION_KEY);
            }
        }
    } catch (e) {
        console.error('❌ Auto-login error:', e);
        localStorage.removeItem(AUTH_SESSION_KEY);
    }
    return false;
}

function saveAuthSession(username, password) {
    try {
        // ✨ ИЗМЕНЕНО: Сохраняем сессию с хешированным паролем (простая защита)
        const sessionData = {
            username: username,
            passwordHash: btoa(password), // Простое кодирование (не криптография!)
            timestamp: Date.now()
        };
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
        console.error('❌ Save session error:', e);
    }
}

function clearAuthSession() {
    try {
        localStorage.removeItem(AUTH_SESSION_KEY);
    } catch (e) {
        console.error('❌ Clear session error:', e);
    }
}

function performLogout() {
    if (socket) {
        socket.close();
        socket = null;
    }

    selectedUser = null;
    reconnectAttempts = 0;
    window.currentUserPassword = null;
    
    // ✨ ИЗМЕНЕНО: Очищаем сессию при выходе
    clearAuthSession();

    if (DOM.chatWindow) DOM.chatWindow.classList.add('hidden');
    if (DOM.settingsModal) DOM.settingsModal.classList.add('hidden');
    if (DOM.loginWindow) DOM.loginWindow.classList.remove('hidden');

    ['loginUsername','loginPassword','regUsername','regPassword','regConfirmPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    console.log('✅ Logout complete');
}

// ============================================================================
// 🔹 localStorage
// ============================================================================
function loadSavedUsers() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.USERS);
        if (saved) users = JSON.parse(saved);
    } catch (e) {
        console.error('❌ Load users error:', e);
        users = [];
    }
}

function saveUsersToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch (e) {
        console.error('❌ Save users error:', e);
    }
}

function loadSettings() {
    try {
        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settings) {
            const data = JSON.parse(settings);
            soundEnabled = data.soundEnabled !== false;

            if (DOM.soundNotify) DOM.soundNotify.checked = soundEnabled;
            
            // ✨ ИЗМЕНЕНО: Применяем размер шрифта через CSS класс
            if (DOM.fontSizeSelect && data.fontSize) {
                DOM.fontSizeSelect.value = data.fontSize;
                document.body.classList.remove('font-small', 'font-medium', 'font-large');
                document.body.classList.add('font-' + (data.fontSize === '12' ? 'small' : data.fontSize === '16' ? 'large' : 'medium'));
            }

            const theme = data.theme || 'dark';
            document.documentElement.setAttribute('data-theme', theme);

            if (typeof data.isVisibleInDirectory === 'boolean') {
                isVisibleInDirectory = data.isVisibleInDirectory;
            }
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    } catch (e) {
        console.error('❌ Load settings error:', e);
    }
}

function saveSettings() {
    try {
        const settings = {
            soundEnabled,
            fontSize: DOM.fontSizeSelect?.value || '14',
            theme: document.documentElement.getAttribute('data-theme') || 'dark',
            isVisibleInDirectory
        };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
        console.error('❌ Save settings error:', e);
    }
}

function getChatStorageKey(chatName) {
    if (!currentUser || !chatName) return null;
    return `chat_messages_${currentUser}_${chatName}`;
}

function saveMessageToStorage(chatName, messageData) {
    if (!chatName || !messageData) return;

    const key = getChatStorageKey(chatName);
    if (!key) return;

    try {
        const messages = JSON.parse(localStorage.getItem(key) || '[]');
        if (!messages.find(m => m.timestamp === messageData.timestamp)) {
            messages.push(messageData);
            if (messages.length > MAX_MESSAGES_IN_STORAGE) messages.shift();
            localStorage.setItem(key, JSON.stringify(messages));
        }
    } catch (e) {
        console.error('❌ Save message error:', e);
    }
}

function loadMessagesFromStorage(chatName) {
    if (!chatName) return [];
    const key = getChatStorageKey(chatName);
    if (!key) return [];
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {
        console.error('❌ Load messages error:', e);
        return [];
    }
}

function clearChatStorage(chatName) {
    if (!chatName) return;
    const key = getChatStorageKey(chatName);
    if (key) localStorage.removeItem(key);
}

// ============================================================================
// 🔹 Утилиты
// ============================================================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('click', (e) => {
    if (DOM.decryptPanel && !DOM.decryptPanel.contains(e.target) && !e.target.closest('.message')) {
        DOM.decryptPanel.classList.add('hidden');
    }
});

// ✨ ИЗМЕНЕНО: Обработка изменения размера окна
window.addEventListener('resize', () => {
    if (DOM.messagesList) DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
    checkMobileView(); // Обновляем мобильный вид при изменении размера
}, { passive: true });
