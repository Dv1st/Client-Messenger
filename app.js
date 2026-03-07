// 🔹 Глобальные переменные
let socket = null;
let currentUser = null;
let selectedUser = null;
let users = [];
let soundEnabled = true;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// 🔹 URL WebSocket сервера
const WS_URL = 'wss://client-messenger-production.up.railway.app';

// 🔹 Ключи для localStorage
const STORAGE_KEYS = {
    USERS: 'messenger_users',
    SETTINGS: 'messenger_settings'
};

// 🔹 Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initLogin();
    initChat();
    initSettings();
    loadSavedUsers();
    loadSettings();
});

// ============================================================================
// 🔹 Вкладки входа / регистрации
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

            if (btn.dataset.tab === 'login') {
                loginTab.classList.add('active');
                registerTab.classList.remove('active');
            } else {
                loginTab.classList.remove('active');
                registerTab.classList.add('active');
            }
        });
    });
}

// ============================================================================
// 🔹 Логин и регистрация
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
// 🔹 Подключение к серверу
// ============================================================================
function connectToServer(authMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (authMessage) socket.send(JSON.stringify(authMessage));
        return;
    }

    try {
        if (socket) socket.close();
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            console.log('✅ WebSocket connected');
            reconnectAttempts = 0;
            updateStatus('connected');
            if (authMessage) socket.send(JSON.stringify(authMessage));
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (e) {
                console.error('❌ Ошибка парсинга:', e);
            }
        };

        socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            updateStatus('disconnected');
        };

        socket.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code, event.reason);
            updateStatus('disconnected');
            
            if (currentUser && event.code !== 1000 && event.code !== 1001) {
                reconnectAttempts++;
                if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    console.log(`🔄 Переподключение ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
                    setTimeout(() => {
                        connectToServer({ 
                            type: 'login', 
                            username: currentUser, 
                            password: window.currentUserPassword || '***' 
                        });
                    }, 2000 * reconnectAttempts);
                }
            }
        };
    } catch (error) {
        console.error('❌ Ошибка WebSocket:', error);
        showStatus('Ошибка: ' + error.message);
        updateStatus('disconnected');
    }
}

// ============================================================================
// 🔹 Обработка сообщений от сервера
// ============================================================================
function handleServerMessage(data) {
    switch (data.type) {
        case 'register_success':
            showStatus('✅ Регистрация успешна! Теперь войдите', false);
            break;
        case 'register_error':
            showStatus(data.message);
            break;
        case 'login_success':
            currentUser = data.username;
            document.getElementById('loginWindow').classList.add('hidden');
            document.getElementById('chatWindow').classList.remove('hidden');
            document.getElementById('currentUserLabel').textContent = currentUser;
            updateStatus('connected');
            sendToServer({ type: 'get_users' });
            requestAudioPermission();
            break;
        case 'login_error':
            showStatus(data.message);
            break;
        case 'user_list':
            updateUsersList(data.users || []);
            break;
        case 'user_online':
            updateUserStatus(data.username, true);
            break;
        case 'user_offline':
            updateUserStatus(data.username, false);
            break;
        case 'receive_message':
            handleMessageReceive(data);
            break;
        case 'error':
            showStatus(data.message);
            break;
        default:
            console.log('📨 Тип сообщения:', data.type);
    }
}

function sendToServer(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
    }
    console.warn('⚠️ WebSocket не готов');
    return false;
}

// ============================================================================
// 🔹 Обработка входящих сообщений
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
    
    // 💾 Сохраняем в localStorage
    const chatName = data.privateTo || 'general';
    saveMessageToStorage(chatName, messageData);
    
    // 📱 Показываем только если чат открыт
    if (selectedUser === data.sender) {
        addMessage(messageData);
    }
    
    // 🔔 Уведомление
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
// 🔹 Чат: инициализация
// ============================================================================
function initChat() {
    const sendBtn = document.getElementById('sendBtn');
    const messageBox = document.getElementById('messageBox');
    const encryptCheckBox = document.getElementById('encryptCheckBox');
    const decryptBtn = document.getElementById('decryptBtn');
    const searchBox = document.getElementById('searchBox');

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    
    if (messageBox) {
        messageBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    if (encryptCheckBox) {
        encryptCheckBox.addEventListener('change', (e) => {
            const keyBox = document.getElementById('encryptKeyBox');
            if (keyBox) {
                keyBox.classList.toggle('hidden', !e.target.checked);
                if (!e.target.checked) keyBox.value = '';
            }
        });
    }
    
    if (decryptBtn) decryptBtn.addEventListener('click', decryptMessage);
    if (searchBox) searchBox.addEventListener('input', searchUsers);
    
    setInputPanelVisible(false);
}

function setInputPanelVisible(isVisible) {
    const inputPanel = document.getElementById('inputPanel');
    const chatPlaceholder = document.getElementById('chatPlaceholder');
    const messagesList = document.getElementById('messagesList');
    
    if (!inputPanel || !chatPlaceholder || !messagesList) return;
    
    if (isVisible) {
        inputPanel.classList.remove('hidden');
        chatPlaceholder.classList.add('hidden');
        messagesList.classList.remove('hidden');
    } else {
        inputPanel.classList.add('hidden');
        chatPlaceholder.classList.remove('hidden');
        messagesList.classList.add('hidden');
    }
}

function updateStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    if (indicator) {
        indicator.className = 'status-indicator ' + status;
    }
}

// ============================================================================
// 🔹 Хранение данных в localStorage
// ============================================================================

function loadSavedUsers() {
    try {
        const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
        if (savedUsers) {
            users = JSON.parse(savedUsers);
        }
    } catch (e) {
        console.error('❌ Ошибка загрузки пользователей:', e);
        users = [];
    }
}

function saveUsersToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch (e) {
        console.error('❌ Ошибка сохранения пользователей:', e);
    }
}

function loadSettings() {
    try {
        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settings) {
            const data = JSON.parse(settings);
            soundEnabled = data.soundEnabled !== false;
            
            const soundNotify = document.getElementById('soundNotify');
            if (soundNotify) soundNotify.checked = soundEnabled;
            
            const fontSizeSelect = document.getElementById('fontSizeSelect');
            if (fontSizeSelect && data.fontSize) {
                fontSizeSelect.value = data.fontSize;
                document.body.style.fontSize = data.fontSize + 'px';
            }
        }
    } catch (e) {
        console.error('❌ Ошибка загрузки настроек:', e);
    }
}

function saveSettings() {
    try {
        const settings = {
            soundEnabled: soundEnabled,
            fontSize: document.getElementById('fontSizeSelect')?.value || '14'
        };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
        console.error('❌ Ошибка сохранения настроек:', e);
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
        
        // Проверка на дубликаты
        if (!messages.find(m => m.timestamp === messageData.timestamp)) {
            messages.push(messageData);
            if (messages.length > 100) messages.shift();
            localStorage.setItem(key, JSON.stringify(messages));
        }
    } catch (e) {
        console.error('❌ Ошибка сохранения сообщения:', e);
    }
}

function loadMessagesFromStorage(chatName) {
    if (!chatName) return [];
    
    const key = getChatStorageKey(chatName);
    if (!key) return [];
    
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {
        console.error('❌ Ошибка загрузки сообщений:', e);
        return [];
    }
}

function clearChatStorage(chatName) {
    if (!chatName) return;
    const key = getChatStorageKey(chatName);
    if (key) {
        localStorage.removeItem(key);
    }
}

// ============================================================================
// 🔹 Список пользователей
// ============================================================================

function updateUsersList(serverUsers) {
    const serverUserNames = new Set(serverUsers.map(u => u.username || u.name));
    
    // Обновляем статусы существующих пользователей
    users.forEach(user => {
        if (serverUserNames.has(user.name)) {
            user.status = 'online';
        }
    });
    
    // Добавляем новых пользователей
    serverUsers.forEach(serverUser => {
        const name = serverUser.username || serverUser.name;
        const exists = users.find(u => u.name === name);
        
        if (!exists) {
            users.push({
                name: name,
                isPinned: false,
                status: 'online'
            });
        }
    });
    
    // Сортировка: закреплённые сверху
    users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
    
    saveUsersToStorage();
    renderUsers();
}

function updateUserStatus(username, isOnline) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.status = isOnline ? 'online' : 'offline';
        saveUsersToStorage();
        renderUsers();
    }
}

function renderUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;
    
    list.innerHTML = '';

    users.forEach(userObj => {
        if (userObj.name === currentUser) return;

        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.dataset.username = userObj.name;
        
        if (userObj.status !== 'online') {
            item.classList.add('offline');
        }

        const statusIcon = userObj.status === 'online' ? '🟢' : '⚫';

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

        list.appendChild(item);
    });
}

function deleteChat(username, itemElement) {
    if (confirm(`Удалить чат с "${username}"?`)) {
        itemElement.style.opacity = '0';
        itemElement.style.pointerEvents = 'none';
        setTimeout(() => itemElement.remove(), 200);

        if (selectedUser === username) {
            showGeneralChat();
        }
        
        clearChatStorage(username);
        sendToServer({ type: 'delete_chat', chatName: username });
    }
}

function selectUser(username) {
    selectedUser = username;
    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) chatTitle.textContent = `💬 ${username}`;

    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.username === username);
    });

    const messagesList = document.getElementById('messagesList');
    if (messagesList) {
        messagesList.innerHTML = '';
        
        const savedMessages = loadMessagesFromStorage(username);
        savedMessages.forEach(msg => {
            addMessage({
                sender: msg.sender,
                text: msg.text,
                time: msg.time,
                encrypted: msg.encrypted,
                hint: msg.hint
            });
        });
    }
    
    setInputPanelVisible(true);
    
    setTimeout(() => {
        const messageBox = document.getElementById('messageBox');
        if (messageBox) messageBox.focus();
    }, 100);
}

function showGeneralChat() {
    selectedUser = null;
    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) chatTitle.textContent = '💬 Общий чат';
    
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const messagesList = document.getElementById('messagesList');
    if (messagesList) messagesList.innerHTML = '';
    
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

function searchUsers() {
    const searchBox = document.getElementById('searchBox');
    if (!searchBox) return;
    
    const query = searchBox.value.toLowerCase().trim();
    document.querySelectorAll('.user-item').forEach(item => {
        const nameEl = item.querySelector('.name');
        if (nameEl) {
            const name = nameEl.textContent.toLowerCase();
            item.style.display = name.includes(query) ? 'flex' : 'none';
        }
    });
}

// ============================================================================
// 🔹 Отправка сообщений
// ============================================================================
function sendMessage() {
    const messageBox = document.getElementById('messageBox');
    if (!messageBox) return;
    
    const text = messageBox.value.trim();
    if (!text) return;

    const encryptCheckBox = document.getElementById('encryptCheckBox');
    const encryptKeyBox = document.getElementById('encryptKeyBox');
    
    const encrypt = encryptCheckBox ? encryptCheckBox.checked : false;
    const key = encryptKeyBox ? encryptKeyBox.value.trim() : '';
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
            time: time,
            encrypted: encrypt,
            hint: hint
        }, true);
        
        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser,
                text: messageText,
                time: time,
                timestamp: Date.now(),
                encrypted: encrypt,
                hint: encrypt ? generateHint(key) : null
            });
        }
        
        messageBox.value = '';

        if (encrypt && encryptCheckBox && encryptKeyBox) {
            encryptCheckBox.checked = false;
            encryptKeyBox.classList.add('hidden');
        }
    } else {
        showStatus('❌ Не удалось отправить');
    }
}

// ============================================================================
// 🔹 Отображение сообщений
// ============================================================================
function addMessage(data, isOwn = false) {
    const list = document.getElementById('messagesList');
    if (!list) return;
    
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
            const decryptPanel = document.getElementById('decryptPanel');
            if (decryptPanel) {
                decryptPanel.classList.remove('hidden');
                decryptPanel.dataset.messageIndex = Array.from(list.children).indexOf(message);
                const decryptKeyBox = document.getElementById('decryptKeyBox');
                if (decryptKeyBox) decryptKeyBox.focus();
            }
        });
    }

    list.appendChild(message);
    list.scrollTop = list.scrollHeight;
}

// ============================================================================
// 🔹 Расшифровка
// ============================================================================
function decryptMessage() {
    const decryptPanel = document.getElementById('decryptPanel');
    const decryptKeyBox = document.getElementById('decryptKeyBox');
    const messagesList = document.getElementById('messagesList');
    
    if (!decryptPanel || !decryptKeyBox || !messagesList) return;
    
    const key = decryptKeyBox.value.trim();
    const messageIndex = decryptPanel.dataset.messageIndex;

    if (!key) {
        alert('⚠️ Введите ключ расшифровки');
        return;
    }

    const messageEl = messagesList.children[messageIndex];
    if (messageEl && messageEl.dataset.encrypted === 'true') {
        try {
            const encryptedText = messageEl.dataset.text;
            const decrypted = xorDecrypt(encryptedText, key);
            messageEl.querySelector('.text').textContent = decrypted;
            messageEl.dataset.encrypted = 'false';
            messageEl.style.cursor = 'default';
            messageEl.title = '';
            decryptPanel.classList.add('hidden');
            decryptKeyBox.value = '';
        } catch (e) {
            console.error('❌ Ошибка расшифровки:', e);
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
        const charCode = text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length);
        result += String.fromCharCode(charCode);
    }
    return btoa(encodeURIComponent(result));
}

function xorDecrypt(encryptedBase64, passphrase) {
    if (!encryptedBase64 || !passphrase) return encryptedBase64;
    const xored = decodeURIComponent(atob(encryptedBase64));
    let result = '';
    for (let i = 0; i < xored.length; i++) {
        const charCode = xored.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length);
        result += String.fromCharCode(charCode);
    }
    return result;
}

function generateHint(passphrase) {
    if (!passphrase || passphrase.length < 2) return '??';
    return passphrase.substring(0, 2) + '*'.repeat(Math.max(0, passphrase.length - 2));
}

// ============================================================================
// 🔔 Звук и уведомления
// ============================================================================
function playNotificationSound() {
    if (!soundEnabled) return;
    const audio = document.getElementById('notificationSound');
    if (audio) {
        audio.currentTime = 0;
        audio.volume = 0.5;
        audio.play().catch(err => console.warn('⚠️ Звук:', err.message));
    }
}

function requestAudioPermission() {
    const audio = document.getElementById('notificationSound');
    if (audio) {
        audio.play().then(() => {
            audio.pause();
            audio.currentTime = 0;
        }).catch(() => {});
    }
}

function showBrowserNotification(data) {
    const pushNotify = document.getElementById('pushNotify');
    if (!pushNotify || !pushNotify.checked) return;

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
// 🔹 Настройки и выход
// ============================================================================
function initSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    const logoutBtn = document.getElementById('logoutBtn');

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        if (settingsModal) settingsModal.classList.remove('hidden');
    });
    
    if (closeSettings) closeSettings.addEventListener('click', () => {
        if (settingsModal) settingsModal.classList.add('hidden');
    });
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.classList.add('hidden');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('🚪 Выйти из аккаунта?')) {
                performLogout();
            }
        });
    }

    const soundNotify = document.getElementById('soundNotify');
    if (soundNotify) {
        soundNotify.addEventListener('change', (e) => {
            soundEnabled = e.target.checked;
            saveSettings();
            if (soundEnabled) playNotificationSound();
        });
    }

    const pushNotify = document.getElementById('pushNotify');
    if (pushNotify) {
        pushNotify.addEventListener('change', (e) => {
            if (e.target.checked) {
                Notification.requestPermission().then(p => {
                    if (p !== 'granted') { 
                        pushNotify.checked = false; 
                        alert('⚠️ Разрешение не получено'); 
                    }
                });
            }
        });
    }

    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) {
        fontSizeSelect.addEventListener('change', (e) => {
            document.body.style.fontSize = e.target.value + 'px';
            saveSettings();
        });
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
    
    const chatWindow = document.getElementById('chatWindow');
    const settingsModal = document.getElementById('settingsModal');
    const loginWindow = document.getElementById('loginWindow');
    
    if (chatWindow) chatWindow.classList.add('hidden');
    if (settingsModal) settingsModal.classList.add('hidden');
    if (loginWindow) loginWindow.classList.remove('hidden');
    
    ['loginUsername','loginPassword','regUsername','regPassword','regConfirmPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    console.log('✅ Выход выполнен, данные сохранены в localStorage');
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
    const decryptPanel = document.getElementById('decryptPanel');
    if (decryptPanel && !decryptPanel.contains(e.target) && !e.target.closest('.message')) {
        decryptPanel.classList.add('hidden');
    }
});

window.addEventListener('resize', () => {
    const messagesList = document.getElementById('messagesList');
    if (messagesList) messagesList.scrollTop = messagesList.scrollHeight;
});
