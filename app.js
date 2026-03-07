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

// Расширенный функционал
let currentFolder = 'all';
let isVisibleInDirectory = true;
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
    messagesList: null,
    inputPanel: null,
    chatPlaceholder: null,
    statusIndicator: null,
    currentUserLabel: null,
    chatTitle: null,
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
        'messagesList', 'inputPanel', 'chatPlaceholder', 'statusIndicator',
        'currentUserLabel', 'chatTitle', 'messageBox', 'sendBtn', 'encryptCheckBox',
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
    initTabs();
    initLogin();
    initChat();
    initSettings();
    initFolders();
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
    }
}

// ============================================================================
// 🔹 Входящие сообщения
// ============================================================================
function handleMessageReceive(data) {
    const messageData = {
        sender: data.sender,
        text: data.text,
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp,
        encrypted: data.encrypted || false,
        hint: data.hint || null
    };

    const chatName = data.privateTo || 'general';
    saveMessageToStorage(chatName, messageData);

    if (selectedUser === data.sender) {
        addMessage(messageData);
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

        let statusClass = 'offline';
        let statusIcon = '⚫';

        if (userObj.status === 'online') {
            if (userObj.activeChat && userObj.activeChat !== selectedUser) {
                statusClass = 'in-chat';
                statusIcon = '🔵';
            } else {
                statusClass = 'online';
                statusIcon = '🟢';
            }
        } else if (userObj.status === 'in_chat') {
            statusClass = 'in-chat';
            statusIcon = '🔵';
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
}

function selectUser(username) {
    selectedUser = username;
    if (DOM.chatTitle) DOM.chatTitle.textContent = `💬 ${username}`;

    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.username === username);
    });

    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';
        loadMessagesFromStorage(username).forEach(msg => addMessage(msg));
    }

    setInputPanelVisible(true);
    setTimeout(() => { if (DOM.messageBox) DOM.messageBox.focus(); }, 100);
}

function showGeneralChat() {
    selectedUser = null;
    if (DOM.chatTitle) DOM.chatTitle.textContent = '💬 Общий чат';
    document.querySelectorAll('.user-item').forEach(item => item.classList.remove('selected'));
    if (DOM.messagesList) DOM.messagesList.innerHTML = '';
    sendToServer({ type: 'get_users' });
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
function initFolders() {
    document.querySelectorAll('.folder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.folder-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFolder = btn.dataset.folder;
            renderUsers();
        });
    });
}

function loadFolderSettings() {
    try {
        const folders = localStorage.getItem(STORAGE_KEYS.FOLDERS);
        if (folders) {
            const folderData = JSON.parse(folders);
            currentFolder = folderData.currentFolder || 'all';
            document.querySelectorAll('.folder-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.folder === currentFolder);
            });
        }
    } catch (e) {
        console.error('❌ Folder settings error:', e);
    }
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
        addMessage({
            sender: currentUser,
            text: messageText,
            time,
            encrypted: encrypt,
            hint
        }, true);

        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser,
                text: messageText,
                time,
                timestamp: Date.now(),
                encrypted: encrypt,
                hint: encrypt ? generateHint(key) : null
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
function addMessage(data, isOwn = false) {
    if (!DOM.messagesList) return;

    const message = document.createElement('div');
    const isCurrentUser = data.sender === currentUser || isOwn;
    message.className = `message ${isCurrentUser ? 'own' : 'other'}`;

    const displayText = data.encrypted
        ? `🔒 Зашифровано (подсказка: ${escapeHtml(data.hint || '???')})`
        : escapeHtml(data.text);

    message.innerHTML = `
        ${!isCurrentUser ? `<div class="sender">${escapeHtml(data.sender)}</div>` : ''}
        <div class="text">${displayText}</div>
        <div class="meta">
            <span class="time">${data.time || ''}</span>
            ${isCurrentUser ? '<span class="checks" title="Доставлено">✓✓</span>' : ''}
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

    DOM.messagesList.appendChild(message);
    DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
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
            document.body.style.fontSize = e.target.value + 'px';
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
    if (DOM.fontSizeSelect) {
        DOM.fontSizeSelect.value = (parseInt(document.body.style.fontSize) || 14).toString();
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

function performLogout() {
    if (socket) {
        socket.close();
        socket = null;
    }

    selectedUser = null;
    reconnectAttempts = 0;
    window.currentUserPassword = null;

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
            if (DOM.fontSizeSelect && data.fontSize) {
                DOM.fontSizeSelect.value = data.fontSize;
                document.body.style.fontSize = data.fontSize + 'px';
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

window.addEventListener('resize', () => {
    if (DOM.messagesList) DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
}, { passive: true });
