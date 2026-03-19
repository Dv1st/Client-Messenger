/**
 * Client Messenger - Оптимизированная клиентская часть
 * @version 4.0.0
 */
'use strict';

// ============================================================================
// Глобальные переменные и константы
// ============================================================================
let socket = null, currentUser = null, selectedUser = null, users = [],
    soundEnabled = true, reconnectAttempts = 0, isVisibleInDirectory = false,
    allowGroupInvite = false, searchRateLimit = false, unreadMessagesCount = 0,
    isUserAtBottom = true, replyToMessage = null, groups = [], selectedGroup = null,
    userProfile = null, userBadges = [], masterKey = null, masterKeyTimeout = null,
    pendingPassword = null, selectedFiles = [], messageQueue = [], isReconnecting = false,
    viewedProfileUserId = null, messageContextMenuTarget = null, userSalt = null;

const WS_URL = 'wss://client-messenger-production.up.railway.app',
    DEBOUNCE_DELAY = 300, MESSAGE_MAX_LENGTH = 10000, MAX_RECONNECT_ATTEMPTS = 5,
    RATE_LIMIT_DELAY = 500, MASTER_KEY_TIMEOUT = 300000, MAX_FILES_PER_MESSAGE = 10,
    MAX_FILE_SIZE = 10 * 1024 * 1024, MAX_MESSAGES_IN_STORAGE = 1000,
    AUTH_SESSION_KEY = 'messenger_auth_session',
    STORAGE_KEYS = { USERS: 'messenger_users', SETTINGS: 'messenger_settings' },
    DEFAULT_MESSAGE_COLOR = '#7B2CBF';

const BADGES_CATALOG = {
    'active': { icon: '🏆', name: 'Активный', description: 'За активность в чате' },
    'premium': { icon: '⭐', name: 'Премиум', description: 'Премиум подписка' },
    'moderator': { icon: '🛡️', name: 'Модератор', description: 'Модератор чата' },
    'vip': { icon: '💎', name: 'VIP', description: 'VIP статус' },
    'verified': { icon: '🎯', name: 'Верифицирован', description: 'Подтверждённый пользователь' },
    'designer': { icon: '🎨', name: 'Дизайнер', description: 'Дизайнер' },
    'developer': { icon: '💻', name: 'Разработчик', description: 'Разработчик' },
    'music': { icon: '🎵', name: 'Музыкальный', description: 'Любитель музыки' }
};

// ============================================================================
// DOM Cache
// ============================================================================
const DOM = {};
const DOM_IDS = [
    'loginWindow', 'chatWindow', 'settingsModal', 'sidebar', 'sidebarToggle',
    'sidebarTrigger', 'searchBox', 'chatsList', 'searchResultsList',
    'messagesList', 'inputPanel', 'chatPlaceholder', 'chatTitle', 'chatUserStatus', 'backBtn',
    'scrollToBottomBtn', 'unreadCount', 'messageBox', 'sendBtn', 'themeSelect',
    'accentColorSelect', 'messageColorSelect', 'fontSizeSelect', 'showInDirectory',
    'allowGroupInvite', 'soundNotify', 'pushNotify', 'notificationSound',
    'createGroupModal', 'closeCreateGroup', 'groupNameInput', 'groupMembersSelect',
    'createGroupConfirmBtn', 'createGroupStatus', 'attachFileBtn', 'fileInput',
    'filePreviewContainer', 'profileModal', 'editProfileBtn', 'closeProfile',
    'profileAvatar', 'profileUserName', 'profileUserStatus', 'avatarContainer',
    'avatarFileInput', 'badgesGrid', 'editPanel', 'saveProfileBtn', 'cancelProfileBtn',
    'avatarUrlInput', 'applyAvatarUrlBtn', 'badgeVisibilityList', 'profileActionsSection',
    'sendMessageBtn', 'profileStatusMessage', 'customStatusSelect', 'customStatusText',
    'editAvatarPreview', 'editAvatarFileInput', 'changeAvatarBtn', 'removeAvatarBtn',
    'chatMenuBtn', 'chatMenuDropdown', 'deleteChatBtn', 'footerUserName',
    'footerUserStatusIndicator', 'footerUserInitials', 'footerUserAvatar', 'footerProfileCard'
];

function initDOM() {
    DOM_IDS.forEach(id => { DOM[id] = document.getElementById(id); });
}

// ============================================================================
// Утилиты безопасности
// ============================================================================
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' };
    return str.replace(/[&<>"'`=\/]/g, c => map[c]);
}

function isValidUsername(username) {
    if (typeof username !== 'string') return false;
    const t = username.trim();
    return t.length >= 3 && t.length <= 20 && /^[A-Za-z0-9_]+$/.test(t);
}

function sanitizeMessageText(text) {
    if (typeof text !== 'string') return '';
    return text.substring(0, MESSAGE_MAX_LENGTH);
}

// ============================================================================
// Криптография (E2EE)
// ============================================================================
async function initializeEncryption(password, salt) {
    try {
        if (!window.CryptoUtils) return false;
        userSalt = salt;
        masterKey = await CryptoUtils.deriveMasterKey(password, salt);
        resetMasterKeyTimeout();
        return true;
    } catch (e) { console.error('Encryption init error:', e); return false; }
}

function resetMasterKeyTimeout() {
    if (masterKeyTimeout) clearTimeout(masterKeyTimeout);
    masterKeyTimeout = setTimeout(clearMasterKey, MASTER_KEY_TIMEOUT);
}

function clearMasterKey() {
    if (masterKey) { masterKey = null; console.log('Master key cleared'); }
}

async function encryptOutgoingMessage(text, messageId) {
    if (!masterKey) throw new Error('Master key not initialized');
    resetMasterKeyTimeout();
    return await CryptoUtils.encryptFullMessage(text, masterKey, messageId);
}

async function decryptIncomingMessage(encryptedContent, encryptionHint, messageId) {
    if (!masterKey) throw new Error('Master key not initialized');
    resetMasterKeyTimeout();
    return await CryptoUtils.decryptFullMessage(encryptedContent, encryptionHint, masterKey, messageId);
}

async function decryptMessageHistory(messages) {
    if (!masterKey) return messages;
    const decrypted = [];
    for (const msg of messages) {
        try {
            if (msg.encrypted && msg.encryptedContent && msg.encryptionHint) {
                const id = msg.id || msg.timestamp.toString();
                const text = await decryptIncomingMessage(msg.encryptedContent, msg.encryptionHint, id);
                decrypted.push({ ...msg, text, decrypted: true });
            } else { decrypted.push(msg); }
        } catch (e) {
            console.error('Decrypt error:', e);
            decrypted.push({ ...msg, text: '❌ Ошибка расшифровки', decryptionError: true });
        }
    }
    return decrypted;
}

// ============================================================================
// Инициализация
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    initTabs();
    initLogin();
    initChat();
    initSettings();
    initScrollTracking();
    loadSavedUsers();
    loadSettings();
    initHotkeys();
    initProfile();
    initSidebar();
    window.addEventListener('beforeunload', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            sendToServer({ type: 'logout' });
            socket.close(1000, 'User closed');
        }
    });
});

// ============================================================================
// Вкладки
// ============================================================================
function initTabs() {
    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;
    tabsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const isLogin = btn.dataset.tab === 'login';
        document.getElementById('loginTab')?.classList.toggle('active', isLogin);
        document.getElementById('registerTab')?.classList.toggle('active', !isLogin);
    });
}

// ============================================================================
// Авторизация
// ============================================================================
function initLogin() {
    document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
    document.getElementById('registerBtn')?.addEventListener('click', handleRegister);
    
    const aboutBtn = document.getElementById('aboutDeveloperBtn');
    const aboutModal = document.getElementById('aboutDeveloperModal');
    const closeAbout = document.getElementById('closeAboutDeveloper');
    
    if (aboutBtn && aboutModal) {
        aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
        closeAbout?.addEventListener('click', () => aboutModal.classList.add('hidden'));
        aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) aboutModal.classList.add('hidden'); });
    }
    
    ['regUsername', 'regPassword', 'regConfirmPassword'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', validateRegistrationForm);
    });
    
    ['loginUsername', 'loginPassword'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', validateLoginForm);
    });
    
    validateRegistrationForm();
    validateLoginForm();
}

function validateRegistrationForm() {
    const btn = document.getElementById('registerBtn');
    const username = document.getElementById('regUsername')?.value.trim() || '';
    const password = document.getElementById('regPassword')?.value || '';
    const confirm = document.getElementById('regConfirmPassword')?.value || '';
    
    const validUser = username.length >= 3 && username.length <= 20 && /^[A-Za-z0-9_]+$/.test(username);
    const validPass = password.length >= 8;
    const validConfirm = password === confirm && confirm.length > 0;
    
    document.getElementById('regUsername')?.classList.toggle('valid', validUser && username.length > 0);
    document.getElementById('regUsername')?.classList.toggle('invalid', !validUser && username.length > 0);
    document.getElementById('regPassword')?.classList.toggle('valid', validPass);
    document.getElementById('regPassword')?.classList.toggle('invalid', !validPass && password.length > 0);
    document.getElementById('regConfirmPassword')?.classList.toggle('valid', validConfirm);
    document.getElementById('regConfirmPassword')?.classList.toggle('invalid', !validConfirm && confirm.length > 0);
    
    if (btn) btn.disabled = !(validUser && validPass && validConfirm);
}

function validateLoginForm() {
    const btn = document.getElementById('loginBtn');
    const username = document.getElementById('loginUsername')?.value.trim() || '';
    const password = document.getElementById('loginPassword')?.value || '';
    const filledUser = username.length > 0;
    const filledPass = password.length > 0;
    
    document.getElementById('loginUsername')?.classList.toggle('valid', filledUser);
    document.getElementById('loginUsername')?.classList.toggle('invalid', !filledUser && username.length > 0);
    document.getElementById('loginPassword')?.classList.toggle('valid', filledPass);
    document.getElementById('loginPassword')?.classList.toggle('invalid', !filledPass && password.length > 0);
    
    if (btn) btn.disabled = !(filledUser && filledPass);
}

function showStatus(message, isError = true) {
    const el = document.getElementById('loginStatus');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? 'var(--error)' : 'var(--success)';
    el.setAttribute('role', 'alert');
    setTimeout(() => { el.textContent = ''; }, 5000);
}

function showToast(message, isError = false) {
    const existing = document.getElementById('toastNotification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = 'toast-notification';
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError?'var(--error)':'var(--success)'};color:white;padding:14px 20px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:10000;animation:slideInRight 0.3s ease;max-width:350px;word-wrap:break-word;`;
    
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function handleLogin() {
    const username = document.getElementById('loginUsername')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    
    if (!username || !password) { showStatus('Введите имя и пароль'); return; }
    if (!isValidUsername(username)) { showStatus('Имя: 3-20 символов (латиница, цифры, _)'); return; }
    if (/[<>\"'&]/.test(username)) { showStatus('Недопустимые символы'); return; }
    
    currentUser = username;
    pendingPassword = password;
    setTimeout(() => connectToServer({ type: 'login', username, password }), 300);
}

function handleRegister() {
    const btn = document.getElementById('registerBtn');
    const username = document.getElementById('regUsername')?.value.trim();
    const password = document.getElementById('regPassword')?.value;
    const confirm = document.getElementById('regConfirmPassword')?.value;
    
    if (!username || !password || password.length < 8) { showStatus('Имя и пароль (мин. 8 символов)'); return; }
    if (!isValidUsername(username)) { showStatus('Имя: 3-20 символов (латиница, цифры, _)'); return; }
    if (/[<>\"'&]/.test(username)) { showStatus('Недопустимые символы'); return; }
    if (password !== confirm) { showStatus('Пароли не совпадают'); return; }
    
    if (btn) btn.disabled = true;
    currentUser = username;
    setTimeout(() => {
        connectToServer({ type: 'register', username, password });
        setTimeout(() => { if (btn) btn.disabled = false; }, 2000);
    }, 300);
}

// ============================================================================
// WebSocket
// ============================================================================
function connectToServer(authMessage) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        if (authMessage && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(authMessage));
        return;
    }
    
    try {
        if (socket) {
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
                socket.close(1000, 'Reconnecting');
            socket = null;
        }
        
        socket = new WebSocket(WS_URL);
        console.log('Connecting to', WS_URL);
        
        socket.onopen = () => {
            console.log('Connected');
            reconnectAttempts = 0;
            if (authMessage) socket.send(JSON.stringify(authMessage));
            if (isReconnecting) { isReconnecting = false; flushMessageQueue(); }
        };
        
        socket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (!data || typeof data !== 'object') return;
                if (data.type === 'receive_message') console.log('Message from:', data.sender);
                handleServerMessage(data);
            } catch (err) { console.error('Parse error:', err); }
        };
        
        socket.onerror = (e) => console.error('WebSocket error:', e);
        
        socket.onclose = (e) => {
            console.log('Disconnected:', e.code);
            if (e.code !== 1000 && e.code !== 1001) isReconnecting = true;
            
            if (currentUser && e.code !== 1000 && e.code !== 1001) {
                reconnectAttempts++;
                if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(2000 * reconnectAttempts, 10000);
                    const session = localStorage.getItem(AUTH_SESSION_KEY);
                    let token = null;
                    if (session) {
                        try { token = JSON.parse(session).token; } catch (e) { console.error('Session parse error:', e); }
                    }
                    setTimeout(() => {
                        connectToServer(token ? { type: 'auto_login', username: currentUser, token } : { type: 'login', username: currentUser, password: '' });
                    }, delay);
                } else { showToast('Не удалось подключиться', true); }
            }
        };
    } catch (e) { showStatus('Ошибка подключения: ' + e.message); }
}

function sendToServer(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
    }
    if (message.type === 'send_message' || message.type === 'send_group_message') {
        queueMessage(message);
        return false;
    }
    console.warn('WebSocket not ready');
    return false;
}

// ============================================================================
// Обработка сообщений сервера
// ============================================================================
function handleServerMessage(data) {
    if (!data || typeof data !== 'object' || !data.type || typeof data.type !== 'string') return;
    if (data.type.length > 50 || !/^[a-zA-Z0-9_]+$/.test(data.type)) return;
    
    if (data.message && typeof data.message === 'string' && /[<>\"'&]/.test(data.message)) {
        console.warn('XSS in message');
        data.message = data.message.replace(/[<>\"'&]/g, '');
    }
    
    try {
        switch (data.type) {
            case 'register_success':
                if (data.username && data.token && data.deviceId) {
                    currentUser = data.username;
                    if (typeof data.isVisibleInDirectory === 'boolean') isVisibleInDirectory = data.isVisibleInDirectory;
                    DOM.loginWindow?.classList.add('hidden');
                    DOM.chatWindow?.classList.remove('hidden');
                    sendToServer({ type: 'get_users' });
                    sendToServer({ type: 'get_groups' });
                    requestAudioPermission();
                    setTimeout(() => { if (groups?.length) groups.forEach(g => loadGroupMessagesFromStorage(g.id)); }, 500);
                } else showStatus('Регистрация успешна! Войдите', false);
                break;
            case 'register_error':
            case 'login_error':
            case 'error':
                if (document.getElementById('login2FAForm')) handleLogin2FAError(sanitizeMessageText(data.message || 'Ошибка'));
                else showStatus(sanitizeMessageText(data.message || 'Ошибка'), true);
                break;
            case 'login_success':
                data.twoFactorVerified ? handleLogin2FASuccess(data) : handleLoginSuccess(data);
                break;
            case 'user_list':
                if (Array.isArray(data.users)) updateUsersList(data.users);
                break;
            case 'user_online':
            case 'user_offline':
            case 'user_status_update':
                if (data.username && typeof data.username === 'string')
                    updateUserStatus(data.username, data.type === 'user_offline' ? 'offline' : data.status || 'online', data.activeChat || null);
                break;
            case 'user_visibility_update':
                if (data.username && typeof data.isVisible === 'boolean') updateUserVisibility(data.username, data.isVisible);
                break;
            case 'chat_started':
                if (data.withUser) handleChatStarted(data.withUser, data.timestamp, data.success);
                break;
            case 'profile_data':
                if (data.profile) handleProfileData(data.profile);
                break;
            case 'user_found':
                if (data.user) handleUserFound(data.user);
                break;
            case 'receive_message':
                if (data.sender && data.text && data.timestamp) handleMessageReceive(data);
                break;
            case 'typing':
                if (data.from && typeof data.isTyping === 'boolean') handleTypingIndicator(data.from, data.isTyping);
                break;
            case 'history':
                if (data.messages && Array.isArray(data.messages)) loadMessageHistory(data.messages, data.chatName, data.groupId);
                break;
            case 'chat_deleted':
                if (data.chatName) handleChatDeleted(data.chatName);
                break;
            case 'message_read_receipt':
                if (data.from && data.timestamp) handleMessageReadReceipt(data.from, data.timestamp);
                break;
            case 'message_deleted':
                if (data.timestamp && data.deletedBy) handleMessageDeleted(data.timestamp, data.deletedBy);
                break;
            case 'message_reaction':
                if (data.timestamp && data.reaction) handleMessageReaction(data);
                break;
            case 'message_confirmed':
                if (data.timestamp && data.confirmed) confirmMessageDelivery(data.timestamp);
                break;
            case 'group_list':
            case 'group_list_update':
                if (Array.isArray(data.groups)) { groups = data.groups; renderGroups(); }
                break;
            case 'group_created':
                if (data.group?.id) {
                    const idx = groups.findIndex(g => g.id === data.group.id);
                    if (idx >= 0) groups[idx] = data.group; else groups.push(data.group);
                    renderGroups();
                }
                break;
            case 'group_member_added':
            case 'group_member_removed':
            case 'group_member_left':
                if (data.groupId) updateGroupMembers(data.groupId, data.member, data.type);
                break;
            case 'group_deleted':
                if (data.groupId) { groups = groups.filter(g => g.id !== data.groupId); renderGroups(); }
                break;
            case 'receive_group_message':
                if (data.groupId && data.sender && data.text && data.timestamp) handleGroupMessageReceive(data);
                break;
            case 'group_invite_permission_updated':
            case 'update_group_invite_permission_success':
                if (typeof data.allow === 'boolean') {
                    allowGroupInvite = data.allow;
                    showToast('Настройка приватности сохранена', false);
                }
                break;
            case 'update_visibility_success':
                if (typeof data.isVisible === 'boolean') {
                    isVisibleInDirectory = data.isVisible;
                    showToast(isVisibleInDirectory ? 'Вы отображаетесь в списке' : 'Вы скрыты из списка', false);
                }
                break;
            case 'badges_updated':
                if (Array.isArray(data.badges)) {
                    userBadges = data.badges;
                    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden'))
                        renderBadges(userBadges, viewedProfileUserId === currentUser);
                }
                break;
            case 'badge_catalog':
                if (Array.isArray(data.catalog)) updateBadgeCatalogFromServer(data.catalog);
                break;
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
        }
    } catch (e) { console.error('handleServerMessage error:', e); }
}

// ============================================================================
// Вход после авторизации
// ============================================================================
async function handleLoginSuccess(data) {
    if (!data.username || typeof data.username !== 'string') { showStatus('Ошибка авторизации', true); return; }
    const name = data.username.trim();
    if (name.length < 3 || name.length > 20) { showStatus('Неверное имя', true); return; }
    
    currentUser = name;
    if (typeof data.isVisibleInDirectory === 'boolean') isVisibleInDirectory = data.isVisibleInDirectory;
    if (typeof data.allowGroupInvite === 'boolean') allowGroupInvite = data.allowGroupInvite;
    if (Array.isArray(data.userBadges)) userBadges = data.userBadges;
    
    if (pendingPassword && data.salt) {
        try { await initializeEncryption(pendingPassword, data.salt); pendingPassword = null; }
        catch (e) { console.error('Encryption error:', e); }
    }
    
    DOM.loginWindow?.classList.add('hidden');
    DOM.chatWindow?.classList.remove('hidden');
    
    if (DOM.showInDirectory) DOM.showInDirectory.checked = isVisibleInDirectory;
    if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = allowGroupInvite;
    
    updateFooterProfile();
    if (window.sidebarComponent) {
        window.sidebarComponent.updateCurrentUser({ username: currentUser, displayName: currentUser, status: 'online' });
    }
    
    console.log('Connected:', currentUser);
    sendToServer({ type: 'get_users' });
    sendToServer({ type: 'get_groups' });
    requestBadgeCatalog();
    requestAudioPermission();
    
    setTimeout(() => { if (window.sidebarComponent) window.sidebarComponent.renderChatsList(); }, 500);
    setTimeout(() => { if (groups?.length) groups.forEach(g => loadGroupMessagesFromStorage(g.id)); }, 500);
}

function handleChatStarted(withUser, timestamp, success = true) {
    console.log('Chat started:', withUser);
    if (success && withUser) {
        if (!window.hasChatWithUser?.(withUser)) {
            const key = `chat_messages_${currentUser}_${withUser}`;
            if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([]));
        }
        addChatToActive(withUser);
        if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
        if (selectedUser !== withUser) {
            showBrowserNotification({ sender: withUser, text: 'Новый чат!', encrypted: false });
        }
    }
}

function handleProfileData(profile) {
    console.log('Profile data:', profile);
    try {
        localStorage.setItem(`profile_${profile.username}`, JSON.stringify({
            username: profile.username, userId: profile.userId,
            statusMessage: profile.customStatus || 'Нет статуса',
            avatarUrl: profile.avatar || '', badges: profile.badges || [],
            createdAt: profile.createdAt, lastLogin: profile.lastLogin,
            isVisibleInDirectory: profile.isVisibleInDirectory, allowGroupInvite: profile.allowGroupInvite
        }));
    } catch (e) { console.error('Cache profile error:', e); }
    
    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden')) renderProfileData(profile);
}

function startChatWithUser(username) {
    if (!username || username === currentUser) return;
    console.log('Starting chat:', username);
    sendToServer({ type: 'start_chat', targetUsername: username });
    addChatToActive(username);
    if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
    selectUser(username);
}

function requestAudioPermission() {
    if (!DOM.notificationSound) return;
    try {
        const audio = DOM.notificationSound;
        audio.muted = true;
        audio.play().then(() => { audio.muted = false; console.log('Audio OK'); })
            .catch(() => console.log('Audio pending'));
    } catch (e) { console.warn('Audio error:', e); }
}

// ============================================================================
// История сообщений
// ============================================================================
function loadMessageHistory(messages, chatName, groupId) {
    if (!messages?.length || !DOM.messagesList) return;
    console.log('Loaded', messages.length, 'messages');
    
    DOM.messagesList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    messages.forEach(msg => {
        const isOwn = msg.sender === currentUser;
        if (!isOwn && msg.deliveryStatus === 'pending') msg.deliveryStatus = 'delivered';
        if (isOwn && msg.deliveryStatus === 'pending' && Date.now() - msg.timestamp > 5000)
            msg.deliveryStatus = 'sent';
        
        const el = createMessageElement(msg, isOwn);
        if (el) fragment.appendChild(el);
    });
    
    DOM.messagesList.appendChild(fragment);
    DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
}

function handleChatDeleted(chatName) {
    if (!chatName) return;
    console.log('Chat deleted:', chatName);
    removeChatFromList(chatName);
    if (selectedUser === chatName) showGeneralChat();
    const user = users.find(u => u.name === chatName);
    if (user) { user.activeChat = null; saveUsersToStorage(); renderAll(); }
}

function removeChatFromList(username) {
    if (!window.sidebarComponent) return;
    const key = `active_chats_${currentUser}`;
    const active = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(active.filter(c => c.userId !== username)));
    localStorage.removeItem(`chat_messages_${currentUser}_${username}`);
    window.sidebarComponent.renderChatsList();
}

function confirmMessageDelivery(timestamp) {
    if (!timestamp) return;
    console.log('Message confirmed:', timestamp);
    updateMessageDeliveryStatus(timestamp, 'sent');
    
    if (selectedUser) {
        try {
            const msgs = loadMessagesFromStorage(selectedUser);
            const msg = msgs.find(m => m.timestamp === timestamp);
            if (msg) {
                msg.deliveryStatus = 'sent';
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(msgs));
            }
        } catch (e) { console.error('Confirm error:', e); }
    }
}

function cancelMessageDelivery(timestamp) {
    if (!timestamp) return;
    console.warn('Message timeout:', timestamp);
    
    DOM.messagesList?.querySelectorAll('.message.own').forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            const checks = msg.querySelector('.checks');
            if (checks) {
                checks.className = 'checks';
                checks.textContent = '⚠️';
                checks.title = 'Ошибка доставки';
                msg.style.opacity = '0.6';
            }
        }
    });
    showToast('Сообщение не доставлено', true);
}

function queueMessage(message) {
    messageQueue.push({ ...message, queuedAt: Date.now() });
    console.log('Message queued:', messageQueue.length);
}

async function flushMessageQueue() {
    if (!messageQueue.length || !socket || socket.readyState !== WebSocket.OPEN) return;
    console.log('Flushing queue:', messageQueue.length);
    const queue = [...messageQueue];
    messageQueue = [];
    for (const msg of queue) { sendToServer(msg); await new Promise(r => setTimeout(r, 100)); }
}

function updateMessageDeliveryStatus(timestamp, status) {
    if (!DOM.messagesList || !timestamp) return;
    
    DOM.messagesList.querySelectorAll('.message.own').forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            const checks = msg.querySelector('.checks');
            if (checks) {
                checks.className = `checks ${status}`;
                checks.textContent = status === 'sent' ? '✓' : '✓✓';
                checks.title = status === 'sent' ? 'Отправлено' : 'Прочитано';
            }
        }
    });
    
    if (selectedUser) {
        try {
            const msgs = loadMessagesFromStorage(selectedUser);
            const msg = msgs.find(m => m.timestamp === timestamp);
            if (msg) {
                msg.deliveryStatus = status;
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(msgs));
            }
        } catch (e) { console.error('Status update error:', e); }
    }
}

// ============================================================================
// Входящие сообщения
// ============================================================================
async function handleMessageReceive(data) {
    if (!data.sender || typeof data.sender !== 'string') return;
    if (/[<>\"'&]/.test(data.sender)) return;
    
    if (data.files) {
        if (!Array.isArray(data.files)) { data.files = null; }
        else {
            data.files = data.files.filter(f => f && typeof f === 'object' &&
                typeof f.name === 'string' && typeof f.type === 'string' &&
                typeof f.data === 'string' && typeof f.size === 'number');
            if (!data.files.length) data.files = null;
        }
    }
    
    let text = data.text;
    let isDecrypted = false;
    
    if (data.isEncrypted && data.encryptedContent && data.encryptionHint && masterKey) {
        try {
            text = await decryptIncomingMessage(data.encryptedContent, data.encryptionHint,
                data.id || data.timestamp.toString());
            isDecrypted = true;
        } catch (e) {
            console.error('Decrypt error:', e);
            text = '❌ Ошибка расшифровки';
        }
    }
    
    const msgData = {
        sender: data.sender, text: sanitizeMessageText(text),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp, deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null, files: data.files || null,
        encrypted: data.isEncrypted || false, encryptedContent: data.encryptedContent || null,
        encryptionHint: data.encryptionHint || null, decrypted: isDecrypted
    };
    
    const chatName = data.privateTo || 'general';
    
    try {
        if (data.privateTo && data.privateTo === currentUser) {
            saveMessageToStorage(data.sender, msgData);
            addChatToActive(data.sender);
        } else if (data.sender === currentUser && data.privateTo) {
            saveMessageToStorage(data.privateTo, msgData);
            addChatToActive(data.privateTo);
        } else {
            saveMessageToStorage(chatName, msgData);
        }
    } catch (e) { console.error('Save error:', e); }
    
    if (selectedUser === data.sender || (data.sender === currentUser && data.privateTo === selectedUser)) {
        const added = addUnreadMessage();
        addMessage(msgData);
        if (added) scrollToBottom();
        if (data.privateTo && data.sender !== currentUser)
            sendToServer({ type: 'message_read', from: data.sender, timestamp: data.timestamp });
        setTimeout(() => scrollToBottom(), 50);
    } else if (data.privateTo === currentUser) {
        addUnreadMessage();
        addMessage(msgData, false, false);
        incrementUnreadCount(data.sender);
        if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
    } else if (data.groupId) {
        if (selectedGroup === data.groupId) {
            const added = addUnreadMessage();
            addMessage(msgData);
            if (added) scrollToBottom();
        } else {
            addUnreadMessage();
            incrementUnreadCount('group_' + data.groupId);
            if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
        }
    }
    
    if (data.sender !== currentUser) {
        playNotificationSound();
        showBrowserNotification({ sender: data.sender, text: data.text });
    }
}

// ============================================================================
// Чат инициализация
// ============================================================================
function initChat() {
    selectedUser = null;
    DOM.chatTitle?.classList.add('hidden');
    DOM.chatMenuBtn?.classList.add('hidden');
    
    DOM.sendBtn?.addEventListener('click', sendMessage);
    
    if (DOM.messageBox) {
        DOM.messageBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        DOM.messageBox.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
    }
    
    DOM.attachFileBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        DOM.fileInput?.click();
    });
    DOM.fileInput?.addEventListener('change', handleFileSelect);
    
    if (DOM.searchBox) {
        let timeout;
        DOM.searchBox.addEventListener('input', () => {
            if (searchRateLimit) return;
            searchRateLimit = true;
            setTimeout(() => { searchRateLimit = false; }, RATE_LIMIT_DELAY);
            clearTimeout(timeout);
            timeout = setTimeout(searchUsers, DEBOUNCE_DELAY);
        }, { passive: true });
        DOM.searchBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSearchEnter(); }
        });
    }
    
    setInputPanelVisible(false);
}

// ============================================================================
// Sidebar
// ============================================================================
function updateFooterProfile() {
    if (!currentUser) {
        DOM.footerUserName && (DOM.footerUserName.textContent = '');
        DOM.footerUserInitials && (DOM.footerUserInitials.textContent = '');
        return;
    }
    
    DOM.footerUserName && (DOM.footerUserName.textContent = escapeHtml(currentUser));
    DOM.footerUserInitials && (DOM.footerUserInitials.textContent = currentUser.slice(0, 2).toUpperCase());
    DOM.footerUserStatusIndicator && (DOM.footerUserStatusIndicator.className = 'status-indicator online');
    
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        if (profile.avatarUrl && DOM.footerUserAvatar) {
            DOM.footerUserAvatar.innerHTML = '';
            const img = document.createElement('img');
            img.src = profile.avatarUrl;
            img.alt = 'Аватар';
            DOM.footerUserAvatar.appendChild(img);
            const status = document.createElement('span');
            status.className = 'status-indicator online';
            DOM.footerUserAvatar.appendChild(status);
        }
    } catch (e) { console.warn('Avatar load error:', e); }
}

function initSidebar() {
    DOM.sidebarToggle?.addEventListener('click', toggleSidebar);
    DOM.backBtn?.addEventListener('click', showMobileChatList);
    
    const collapseChats = document.getElementById('collapseActiveChatsBtn');
    if (collapseChats) {
        collapseChats.addEventListener('click', () => {
            const section = document.querySelector('.active-chats-section');
            if (section) {
                section.classList.toggle('collapsed');
                collapseChats.classList.toggle('collapsed');
                localStorage.setItem('active_chats_collapsed', section.classList.contains('collapsed'));
            }
        });
        if (localStorage.getItem('active_chats_collapsed') === 'true') {
            document.querySelector('.active-chats-section')?.classList.add('collapsed');
            collapseChats?.classList.add('collapsed');
        }
    }
    
    const collapseUsers = document.getElementById('collapseAllUsersBtn');
    if (collapseUsers) {
        collapseUsers.addEventListener('click', () => {
            const section = document.querySelector('.all-users-section');
            if (section) {
                section.classList.toggle('collapsed');
                collapseUsers.classList.toggle('collapsed');
                localStorage.setItem('all_users_collapsed', section.classList.contains('collapsed'));
            }
        });
        if (localStorage.getItem('all_users_collapsed') === 'true') {
            document.querySelector('.all-users-section')?.classList.add('collapsed');
            collapseUsers?.classList.add('collapsed');
        }
    }
    
    document.getElementById('createGroupBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openCreateGroupModal();
    });
    
    document.querySelector('.groups-section')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showGroupContextMenu(e);
    });
    
    DOM.sidebarTrigger?.addEventListener('click', showSidebarOnMobile);
    
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && DOM.sidebar) {
            const inside = DOM.sidebar.contains(e.target);
            const trigger = DOM.sidebarTrigger?.contains(e.target);
            if (!inside && !trigger) DOM.sidebar.classList.remove('mobile-visible');
        }
    });
    
    if (localStorage.getItem('sidebar_collapsed') === 'true' && window.innerWidth > 768) {
        DOM.sidebar?.classList.add('collapsed');
        updateSidebarToggleIcon();
    }
    
    initUserListEvents();
    checkMobileView();
    
    window.sidebarComponent = new SidebarComponent({
        currentUser: currentUser ? { id: 'current', username: currentUser, displayName: currentUser, avatar: null, status: 'online' } : null,
        onChatSelect: (chat) => {
            if (chat.type === 'personal' && chat.userId) selectUser(chat.userId);
            else if (chat.type === 'group' && chat.groupId) selectGroup(chat.groupId);
        },
        onUserStartChat: (user) => {
            const name = user.username || user.id;
            if (name) startChatWithUser(name);
        },
        onSettingsClick: () => {
            DOM.settingsModal?.classList.remove('hidden');
            syncSettingsUI();
        },
        onProfileClick: () => { if (currentUser) openProfile(currentUser); },
        onCreateGroup: () => { openCreateGroupModal(); }
    });
    
    setTimeout(() => { window.sidebarComponent?.renderChatsList(); }, 100);
}

function showSidebarOnMobile() { DOM.sidebar?.classList.add('mobile-visible'); }

function initUserListEvents() {
    DOM.searchResultsList?.addEventListener('click', (e) => {
        const item = e.target.closest('.user-item');
        if (item) selectUser(item.dataset.username);
    });
    
    DOM.searchResultsList?.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.user-item');
        if (item) selectUser(item.dataset.username);
    });
    
    DOM.searchResultsList?.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.user-item');
        if (item) { e.preventDefault(); showFolderContextMenu(e, item.dataset.username); }
    });
    
    DOM.chatsList?.addEventListener('click', (e) => {
        const group = e.target.closest('.group-item');
        if (!group) return;
        const groupId = group.dataset.groupId;
        if (!groupId) return;
        
        if (e.target.closest('.delete-group-btn')) {
            e.stopPropagation();
            deleteGroup(groupId, group.dataset.groupName);
            return;
        }
        selectGroup(groupId);
    });
}

function toggleSidebar() {
    if (!DOM.sidebar) return;
    DOM.sidebar.classList.toggle('collapsed');
    const collapsed = DOM.sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebar_collapsed', collapsed);
    updateSidebarToggleIcon();
    DOM.sidebarToggle?.setAttribute('aria-expanded', !collapsed);
}

function updateSidebarToggleIcon() {
    const icon = DOM.sidebarToggle?.querySelector('.toggle-icon');
    if (icon) icon.textContent = DOM.sidebar?.classList.contains('collapsed') ? '▶' : '◀';
}

function checkMobileView() {
    if (!DOM.sidebar || !DOM.backBtn) return;
    const mobile = window.innerWidth <= 768;
    const hasChat = selectedUser !== null;
    DOM.backBtn.classList.toggle('hidden', !(mobile && hasChat));
    if (mobile && hasChat && !DOM.sidebar.classList.contains('mobile-visible'))
        DOM.sidebar.classList.remove('mobile-visible');
}

function showMobileChatList() {
    DOM.sidebar?.classList.remove('mobile-hidden', 'mobile-visible');
    DOM.backBtn?.classList.add('hidden');
    if (window.innerWidth > 768) showGeneralChat();
}

// ============================================================================
// Прокрутка
// ============================================================================
function initScrollTracking() {
    if (!DOM.messagesList || !DOM.scrollToBottomBtn) return;
    let timeout;
    DOM.messagesList.addEventListener('scroll', () => {
        if (timeout) return;
        timeout = setTimeout(() => { checkScrollPosition(); timeout = null; }, 100);
    }, { passive: true });
    DOM.scrollToBottomBtn.addEventListener('click', scrollToBottom);
}

function checkScrollPosition() {
    if (!DOM.messagesList) return;
    const threshold = 100;
    const pos = DOM.messagesList.scrollTop + DOM.messagesList.clientHeight;
    const height = DOM.messagesList.scrollHeight;
    isUserAtBottom = (height - pos) < threshold;
    updateScrollButton();
}

function updateScrollButton() {
    if (!DOM.scrollToBottomBtn || !DOM.unreadCount) return;
    DOM.scrollToBottomBtn.classList.toggle('hidden', isUserAtBottom);
    DOM.unreadCount.textContent = unreadMessagesCount;
}

function scrollToBottom() {
    if (!DOM.messagesList) return;
    DOM.messagesList.scrollTo({ top: DOM.messagesList.scrollHeight, behavior: 'smooth' });
}

function addUnreadMessage() {
    if (!isUserAtBottom) { unreadMessagesCount++; updateScrollButton(); return false; }
    return true;
}

// ============================================================================
// Пользователи
// ============================================================================
function updateUsersList(serverUsers) {
    if (!Array.isArray(serverUsers)) return;
    const serverMap = new Map(serverUsers.map(u => [u.name, u]));
    
    users = users.filter(u => serverMap.has(u.name));
    serverUsers.forEach(serverUser => {
        const existing = users.find(u => u.name === serverUser.name);
        if (existing) Object.assign(existing, serverUser);
        else users.push({ ...serverUser });
    });
    
    renderAll();
    if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
}

function updateUserStatus(username, status, activeChat = null) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.status = status;
        user.activeChat = activeChat;
        saveUsersToStorage();
        renderAll();
        if (selectedUser === username) updateChatUserStatus(username);
        if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
    }
}

function updateUserVisibility(username, isVisible) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.isVisibleInDirectory = isVisible;
        saveUsersToStorage();
        renderAll();
    }
}

function renderAll() {
    if (window.sidebarComponent) window.sidebarComponent.renderChatsList();
}

window.renderChatsListData = function() {
    const chats = [];
    
    users.forEach(user => {
        if (user.name === currentUser) return;
        if (user.isVisibleInDirectory === false) return;
        
        const key = `chat_messages_${currentUser}_${user.name}`;
        const saved = localStorage.getItem(key);
        let lastMsg = 'Нет сообщений';
        let timestamp = user.createdAt || Date.now();
        let unread = 0;
        
        if (saved) {
            try {
                const messages = JSON.parse(saved);
                if (messages.length > 0) {
                    const last = messages[messages.length - 1];
                    lastMsg = last.text || (last.fileData ? '📎 Файл' : 'Сообщение');
                    timestamp = last.timestamp || Date.now();
                    unread = messages.filter(m => m.sender === user.name && !m.read).length;
                }
            } catch (e) { console.warn('Parse messages error:', e); }
        }
        
        const profile = JSON.parse(localStorage.getItem(`profile_${user.name}`) || '{}');
        
        chats.push({
            id: 'chat_' + user.name,
            type: 'personal',
            userId: user.name,
            name: user.name,
            avatar: getUserAvatar(user.name),
            lastMessage: lastMsg,
            timestamp: timestamp,
            unreadCount: unread,
            online: user.status === 'online',
            profileData: getUserProfileData(user.name)
        });
    });
    
    groups.forEach(group => {
        const key = `group_messages_${group.id}`;
        const saved = localStorage.getItem(key);
        let lastMsg = 'Нет сообщений';
        let timestamp = group.createdAt || Date.now();
        
        if (saved) {
            try {
                const messages = JSON.parse(saved);
                if (messages.length > 0) {
                    const last = messages[messages.length - 1];
                    lastMsg = last.text || (last.fileData ? '📎 Файл' : 'Сообщение');
                    timestamp = last.timestamp || Date.now();
                }
            } catch (e) { console.warn('Parse group messages error:', e); }
        }
        
        chats.push({
            id: 'group_' + group.id,
            type: 'group',
            groupId: group.id,
            name: group.name,
            avatar: null,
            lastMessage: lastMsg,
            timestamp: timestamp,
            unreadCount: 0,
            membersCount: group.members?.length || 0
        });
    });
    
    return chats.sort((a, b) => b.timestamp - a.timestamp);
};

window.getPublicUsersData = function() {
    return users
        .filter(user => {
            if (user.name === currentUser) return false;
            if (user.isVisibleInDirectory === false) return false;
            const key = `chat_messages_${currentUser}_${user.name}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const messages = JSON.parse(saved);
                    if (messages?.length > 0) return false;
                } catch (e) { }
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

function getUserAvatar(username) {
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${username}`) || '{}');
        if (profile.avatarUrl) {
            const url = profile.avatarUrl.trim();
            if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))
                return url;
            console.warn('Blocked unsafe avatar:', url);
        }
    } catch (e) { console.error('Get avatar error:', e); }
    return '';
}

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
        return { username, status: 'offline', customStatus: 'Нет статуса', avatar: '', badges: [] };
    }
}

function addChatToActive(username) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.activeChat = currentUser;
        saveUsersToStorage();
        renderAll();
    }
}

window.hasChatWithUser = function(username) {
    if (!username) return false;
    const key = `chat_messages_${currentUser}_${username}`;
    const saved = localStorage.getItem(key);
    if (!saved) return false;
    try {
        const messages = JSON.parse(saved);
        return messages?.length > 0;
    } catch (e) { return false; }
};

function getUnreadMessagesCount(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return 0;
        const messages = JSON.parse(saved);
        return messages.filter(m => m.sender === username && !m.read).length;
    } catch (e) { return 0; }
}

function incrementUnreadCount(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return;
        const messages = JSON.parse(saved);
        messages.forEach(m => { if (m.sender === username && !m.read) m.read = false; });
        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) { console.error('Increment unread error:', e); }
}

function markMessagesAsRead(username) {
    try {
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return;
        const messages = JSON.parse(saved);
        let changed = false;
        messages.forEach(m => {
            if (m.sender === username && !m.read) {
                m.read = true;
                m.deliveryStatus = 'delivered';
                changed = true;
            }
        });
        if (changed) localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) { console.error('Mark read error:', e); }
}

function updateUserItemSelection(username) {
    if (window.sidebarComponent) window.sidebarComponent.selectChat('chat_' + username);
    DOM.chatsList?.querySelectorAll('.chat-item').forEach(item => {
        item.classList.toggle('selected', username ? item.dataset.username === username : false);
    });
}

function updateChatUserStatus(username) {
    if (!DOM.chatUserStatus) return;
    const user = users.find(u => u.name === username);
    const statusClass = user ? (user.status === 'in_chat' ? 'in-chat' : user.status) : 'offline';
    const labels = { 'online': 'Онлайн', 'in-chat': 'В чате', 'offline': 'Офлайн' };
    
    DOM.chatUserStatus.classList.remove('hidden', 'online', 'offline', 'in-chat');
    DOM.chatUserStatus.classList.add(statusClass);
    
    const text = DOM.chatUserStatus.querySelector('.status-text');
    if (text) text.textContent = labels[statusClass] || 'Офлайн';
    
    const dot = DOM.chatUserStatus.querySelector('.status-dot');
    const colors = { 'online': 'var(--status-online)', 'in-chat': 'var(--status-in-chat)', 'offline': 'var(--status-offline)' };
    if (dot) dot.style.background = colors[statusClass] || 'var(--status-offline)';
    
    DOM.chatMenuBtn?.classList.remove('hidden');
}

function selectUser(username) {
    console.log('selectUser:', username);
    if (!username || username === currentUser) return;
    
    selectedUser = username;
    
    if (DOM.chatTitle) {
        updateChatTitleWithBadges();
        updateChatHeaderAvatar(username);
        DOM.chatTitle.classList.remove('hidden');
    }
    
    updateUserItemSelection(username);
    unreadMessagesCount = 0;
    isUserAtBottom = true;
    
    addChatToActive(username);
    markMessagesAsRead(username);
    
    if (replyToMessage) {
        replyToMessage = null;
        document.getElementById('replyIndicator')?.remove();
    }
    
    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';
        sendToServer({ type: 'get_history', chatName: username, limit: 100 });
    }
    
    setInputPanelVisible(true);
    updateChatUserStatus(username);
    checkMobileView();
    updateScrollButton();
    
    if (window.innerWidth <= 768 && DOM.sidebar)
        DOM.sidebar.classList.remove('mobile-visible');
    
    sendToServer({ type: 'chat_open', chatWith: username });
    setTimeout(() => { DOM.messageBox?.focus(); }, 100);
}

function showGeneralChat() {
    selectedUser = null;
    DOM.chatTitle && (DOM.chatTitle.textContent = 'Чат');
    DOM.chatTitle?.classList.add('hidden');
    updateUserItemSelection(null);
    DOM.messagesList && (DOM.messagesList.innerHTML = '');
    DOM.chatUserStatus?.classList.add('hidden');
    DOM.chatMenuBtn?.classList.add('hidden');
    closeChatMenu();
    checkMobileView();
    sendToServer({ type: 'chat_open', chatWith: null });
    setInputPanelVisible(false);
}

// ============================================================================
// Группы
// ============================================================================
function renderGroups() { if (!DOM.chatsList) return; }

function selectGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) { console.warn('Group not found:', groupId); return; }
    
    selectedGroup = groupId;
    selectedUser = null;
    
    DOM.chatTitle && (DOM.chatTitle.textContent = '👥 ' + group.name);
    DOM.chatTitle?.classList.remove('hidden');
    
    updateUserItemSelection(null);
    unreadMessagesCount = 0;
    isUserAtBottom = true;
    
    if (DOM.messagesList) {
        DOM.messagesList.innerHTML = '';
        sendToServer({ type: 'get_history', groupId, limit: 100 });
    }
    
    setInputPanelVisible(true);
    DOM.chatUserStatus?.classList.add('hidden');
    DOM.chatMenuBtn?.classList.remove('hidden');
    checkMobileView();
    updateScrollButton();
    
    if (window.innerWidth <= 768 && DOM.sidebar)
        DOM.sidebar.classList.remove('mobile-visible');
    
    setTimeout(() => { DOM.messageBox?.focus(); }, 100);
}

function showGroupContextMenu(e) {
    const existing = document.querySelector('.groups-context-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu groups-context-menu';
    const w = 180, h = 100;
    menu.style.left = Math.min(e.pageX, window.innerWidth - w) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - h) + 'px';
    
    const createItem = document.createElement('div');
    createItem.className = 'context-menu-item';
    createItem.textContent = '➕ Создать группу';
    createItem.addEventListener('click', () => { showCreateGroupModal(); menu.remove(); });
    menu.appendChild(createItem);
    
    document.body.appendChild(menu);
    setTimeout(() => { document.addEventListener('click', () => menu.remove(), { once: true }); }, 100);
}

function renderGroupMembersSelect() {
    if (!DOM.groupMembersSelect) return;
    DOM.groupMembersSelect.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    users.forEach(user => {
        if (user.name === currentUser) return;
        
        const hasActiveChat = user.activeChat === currentUser;
        const hasHistory = (() => {
            const key = `chat_messages_${currentUser}_${user.name}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const messages = JSON.parse(saved);
                    return messages?.length > 0;
                } catch (e) { console.warn('Parse messages error:', e); }
            }
            return false;
        })();
        
        if (!hasActiveChat && !hasHistory) return;
        
        const item = document.createElement('div');
        item.className = 'group-member-item';
        item.dataset.username = user.name;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'member-checkbox';
        checkbox.dataset.username = user.name;
        if (!user.allowGroupInvite) checkbox.disabled = true;
        
        const nameEl = document.createElement('span');
        nameEl.className = 'member-name';
        nameEl.textContent = user.name;
        
        const statusEl = document.createElement('span');
        statusEl.className = 'member-status';
        if (!user.allowGroupInvite) statusEl.textContent = '✗ Запретил';
        else if (hasActiveChat) statusEl.textContent = '✓ В чате';
        else if (hasHistory) statusEl.textContent = '✓ Был чат';
        
        item.appendChild(checkbox);
        item.appendChild(nameEl);
        item.appendChild(statusEl);
        
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox && !checkbox.disabled) {
                checkbox.checked = !checkbox.checked;
                item.classList.toggle('selected', checkbox.checked);
            }
        });
        
        fragment.appendChild(item);
    });
    
    if (!fragment.children.length) {
        const div = document.createElement('div');
        div.className = 'search-no-results';
        div.innerHTML = '<span aria-hidden="true">👥</span><span>Нет доступных пользователей</span><small>Показываются только пользователи с активным чатом</small>';
        DOM.groupMembersSelect.innerHTML = '';
        DOM.groupMembersSelect.appendChild(div);
    }
    
    DOM.groupMembersSelect.appendChild(fragment);
}

function createGroup() {
    const name = DOM.groupNameInput?.value?.trim();
    if (!name) { showCreateGroupStatus('Введите название', true); return; }
    if (name.length < 2 || name.length > 50) { showCreateGroupStatus('Название 2-50 символов', true); return; }
    
    const members = [];
    DOM.groupMembersSelect?.querySelectorAll('.member-checkbox:checked').forEach(cb => {
        members.push(cb.dataset.username);
    });
    
    if (!members.length) { showCreateGroupStatus('Выберите участников', true); return; }
    
    sendToServer({ type: 'create_group', name, members });
    DOM.createGroupModal?.classList.add('hidden');
    DOM.groupNameInput && (DOM.groupNameInput.value = '');
    showCreateGroupStatus('');
}

function showCreateGroupStatus(message, isError = false) {
    if (!DOM.createGroupStatus) return;
    DOM.createGroupStatus.textContent = message;
    DOM.createGroupStatus.style.color = isError ? 'var(--error)' : 'var(--success)';
    if (message) setTimeout(() => { DOM.createGroupStatus.textContent = ''; }, 5000);
}

function deleteGroup(groupId, groupName) {
    if (confirm(`Удалить группу "${groupName}"?`))
        sendToServer({ type: 'delete_group', groupId });
}

function updateGroupMembers(groupId, member, actionType) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    if (actionType === 'group_member_added') {
        if (!group.members.includes(member)) group.members.push(member);
    } else if (actionType === 'group_member_removed' || actionType === 'group_member_left') {
        group.members = group.members.filter(m => m !== member);
    }
    
    renderGroups();
    if (selectedGroup === groupId && DOM.chatTitle)
        DOM.chatTitle.textContent = '👥 ' + group.name;
}

async function handleGroupMessageReceive(data) {
    const group = groups.find(g => g.id === data.groupId);
    if (!group) return;
    
    let text = data.text;
    let isDecrypted = false;
    
    if (data.isEncrypted && data.encryptedContent && data.encryptionHint && masterKey) {
        try {
            text = await decryptIncomingMessage(data.encryptedContent, data.encryptionHint,
                data.id || data.timestamp.toString());
            isDecrypted = true;
        } catch (e) {
            console.error('Decrypt group error:', e);
            text = '❌ Ошибка расшифровки';
        }
    }
    
    const msgData = {
        sender: data.sender, text: sanitizeMessageText(text),
        time: new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: data.timestamp, deliveryStatus: data.sender === currentUser ? 'sent' : 'delivered',
        replyTo: data.replyTo || null, groupId: data.groupId, groupName: group.name,
        files: data.files || null, encrypted: data.isEncrypted || false,
        encryptedContent: data.encryptedContent || null, encryptionHint: data.encryptionHint || null,
        decrypted: isDecrypted
    };
    
    try { saveGroupMessageToStorage(data.groupId, msgData); }
    catch (e) { console.error('Save group error:', e); }
    
    if (selectedGroup === data.groupId) {
        const added = addUnreadMessage();
        addMessage(msgData);
        if (added) scrollToBottom();
    }
    
    if (data.sender !== currentUser) {
        playNotificationSound();
        showBrowserNotification({ sender: data.sender, text, groupName: group.name });
    }
}

function saveGroupMessageToStorage(groupId, message) {
    try {
        if (!currentUser || !groupId) return;
        const key = `group_messages_${currentUser}_${groupId}`;
        let messages = loadGroupMessagesFromStorage(groupId);
        messages.push(message);
        if (messages.length > MAX_MESSAGES_IN_STORAGE) messages = messages.slice(-MAX_MESSAGES_IN_STORAGE);
        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) {
        console.error('Save group error:', e);
        if (e.name === 'QuotaExceededError') {
            console.warn('Quota exceeded, clearing...');
            try { localStorage.clear(); } catch (c) { console.error('Clear error:', c); }
        }
    }
}

function loadGroupMessagesFromStorage(groupId) {
    try {
        if (!groupId) return [];
        const key = `group_messages_${currentUser}_${groupId}`;
        const saved = localStorage.getItem(key);
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(m => m && typeof m === 'object' &&
            typeof m.sender === 'string' && typeof m.text === 'string' && typeof m.timestamp === 'number');
    } catch (e) { console.error('Load group error:', e); return []; }
}

// ============================================================================
// Поиск
// ============================================================================
function searchUsers() {
    if (!DOM.searchBox) return;
    const query = DOM.searchBox.value.trim().toLowerCase();
    
    if (!query) {
        if (DOM.searchResultsList) DOM.searchResultsList.innerHTML = '';
        return;
    }
    
    const results = users.filter(u => u.name !== currentUser && u.name.toLowerCase().includes(query));
    
    if (!DOM.searchResultsList) return;
    
    if (!results.length) {
        DOM.searchResultsList.innerHTML = '<div class="search-no-results"><span>🔍</span><span>Ничего не найдено</span></div>';
        return;
    }
    
    DOM.searchResultsList.innerHTML = results.map(user => {
        const isOnline = user.status === 'online';
        const hasChat = window.hasChatWithUser?.(user.name);
        return `
            <div class="search-result-item" data-user-id="${escapeHtml(user.name)}" data-username="${escapeHtml(user.name)}">
                <div class="search-result-avatar">${getUserAvatar(user.name) ? `<img src="${escapeHtml(getUserAvatar(user.name))}" alt="">` : escapeHtml(user.name.slice(0, 2).toUpperCase())}
                    <span class="search-result-status-dot ${isOnline ? 'online' : 'offline'}"></span>
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(user.name)}</div>
                    <div class="search-result-status-text ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Онлайн' : 'Офлайн'}</div>
                </div>
                <button class="search-result-action-btn ${hasChat ? 'existing-chat' : ''}">${hasChat ? 'Перейти в чат' : 'Начать чат'}</button>
            </div>`;
    }).join('');
}

function showSearchHint(text) {
    if (!DOM.searchResultsList) return;
    DOM.searchResultsList.innerHTML = `<div class="search-no-results"><span>🔍</span><span>${escapeHtml(text)}</span></div>`;
}

function handleSearchEnter() {
    if (!DOM.searchBox) return;
    const query = DOM.searchBox.value.trim();
    if (!query) return;
    
    const user = users.find(u => u.name.toLowerCase() === query.toLowerCase() && u.name !== currentUser);
    if (user) {
        selectUser(user.name);
        DOM.searchBox.value = '';
    } else {
        showSearchHint('Пользователь "' + escapeHtml(query) + '" не найден');
    }
}

function showFolderContextMenu(e, username) {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    const w = 200, h = 150;
    menu.style.left = Math.min(e.pageX, window.innerWidth - w) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - h) + 'px';
    
    menu.innerHTML = `
        <div class="context-menu-item" data-folder="inbox">📥 Входящие</div>
        <div class="context-menu-item" data-folder="archive">🗄️ Архив</div>
        <div class="context-menu-item" data-folder="spam">⚠️ Спам</div>`;
    
    document.body.appendChild(menu);
    
    const cleanup = () => { menu.remove(); document.removeEventListener('click', close); };
    const close = (ev) => { if (!menu.contains(ev.target)) cleanup(); };
    
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            setUserFolder(username, item.dataset.folder);
            cleanup();
        });
    });
    
    setTimeout(() => { document.addEventListener('click', close, { once: true }); }, 100);
}

function setUserFolder(username, folder) {
    const user = users.find(u => u.name === username);
    if (user) {
        user.folder = folder;
        saveUsersToStorage();
        renderAll();
        showToast(`Пользователь ${username} перемещён в ${folder}`, false);
    }
}

// ============================================================================
// Отправка сообщений
// ============================================================================
async function sendMessage() {
    if (!DOM.messageBox) return;
    const text = DOM.messageBox.value.trim();
    const hasFiles = selectedFiles.length > 0;
    if (!text && !hasFiles) return;
    if (text.length > MESSAGE_MAX_LENGTH) { showToast('Сообщение слишком длинное', true); return; }
    
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    let messageText = text;
    let encryptedContent = null, encryptionHint = null;
    
    if (masterKey) {
        try {
            const messageId = CryptoUtils.generateMessageId();
            const encrypted = await encryptOutgoingMessage(text, messageId);
            encryptedContent = encrypted.encryptedContent;
            encryptionHint = encrypted.encryptionHint;
            messageText = '[🔒 Зашифровано]';
        } catch (e) { console.error('Encryption error:', e); }
    }
    
    let filesData = [];
    if (hasFiles) {
        try {
            filesData = await Promise.all(selectedFiles.map(async file => {
                let processed = file;
                if (file.type.startsWith('image/')) processed = await compressImage(file);
                else if (file.type.startsWith('video/')) processed = await compressVideo(file);
                return { name: processed.name, type: processed.type, size: processed.size, data: await readFileAsDataURL(processed) };
            }));
        } catch (e) { console.error('File processing error:', e); }
    }
    
    if (selectedGroup) {
        const groupMsg = {
            type: 'send_group_message', groupId: selectedGroup, text: messageText, timestamp: Date.now(),
            encryptedContent, encryptionHint, isEncrypted: !!encryptedContent,
            replyTo: replyToMessage ? { timestamp: replyToMessage.timestamp, sender: replyToMessage.sender, text: replyToMessage.text } : null,
            files: filesData.length ? filesData : null
        };
        
        console.log('Sending group message:', selectedGroup);
        
        if (sendToServer(groupMsg)) {
            const ts = Date.now();
            const group = groups.find(g => g.id === selectedGroup);
            if (group) {
                saveGroupMessageToStorage(selectedGroup, {
                    sender: currentUser, text: messageText, time, timestamp: ts, deliveryStatus: 'pending',
                    replyTo: groupMsg.replyTo, groupId: selectedGroup, groupName: group.name,
                    files: filesData, encrypted: !!encryptedContent, encryptedContent, encryptionHint
                });
            }
            setTimeout(() => {
                const el = document.querySelector(`.message[data-timestamp="${ts}"]`);
                if (el?.querySelector('.checks.pending')) cancelMessageDelivery(ts);
            }, 5000);
            
            DOM.messageBox.value = '';
            clearSelectedFiles();
            scrollToBottom();
        }
        return;
    }
    
    const msg = {
        type: 'send_message', text: messageText, timestamp: Date.now(), privateTo: selectedUser || null,
        encryptedContent, encryptionHint, isEncrypted: !!encryptedContent,
        replyTo: replyToMessage ? { timestamp: replyToMessage.timestamp, sender: replyToMessage.sender, text: replyToMessage.text } : null,
        files: filesData.length ? filesData : null
    };
    
    console.log('Sending message:', selectedUser);
    
    if (sendToServer(msg)) {
        const ts = Date.now();
        if (selectedUser) {
            saveMessageToStorage(selectedUser, {
                sender: currentUser, text: messageText, time, timestamp: ts, deliveryStatus: 'pending',
                replyTo: msg.replyTo, files: filesData, encrypted: !!encryptedContent, encryptedContent, encryptionHint
            });
            addChatToActive(selectedUser);
        }
        setTimeout(() => {
            const el = document.querySelector(`.message[data-timestamp="${ts}"]`);
            if (el?.querySelector('.checks.pending')) cancelMessageDelivery(ts);
        }, 5000);
        
        DOM.messageBox.value = '';
        if (replyToMessage) {
            replyToMessage = null;
            document.getElementById('replyIndicator')?.remove();
        }
        clearSelectedFiles();
    } else showToast('Не удалось отправить', true);
}

function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.7) {
    return new Promise(resolve => {
        if (file.size < 500 * 1024) { resolve(file); return; }
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; } }
                else { if (h > maxHeight) { w = Math.round(w * maxHeight / h); h = maxHeight; } }
                
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                
                canvas.toBlob(blob => {
                    if (blob) {
                        const compressed = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });
                        console.log('Image compressed:', file.size, '→', compressed.size);
                        resolve(compressed);
                    } else resolve(file);
                }, 'image/jpeg', quality);
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

function compressVideo(file, maxWidth = 1280, maxHeight = 720, videoBitsPerSecond = 2500000) {
    return new Promise(resolve => {
        if (typeof MediaRecorder === 'undefined') { resolve(file); return; }
        if (file.size < 5 * 1024 * 1024) { resolve(file); return; }
        
        const video = document.createElement('video');
        video.preload = 'metadata';
        
        video.onloadedmetadata = () => {
            let w = video.videoWidth, h = video.videoHeight;
            if (w > h) { if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; } }
            else { if (h > maxHeight) { w = Math.round(w * maxHeight / h); h = maxHeight; } }
            
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            const stream = canvas.captureStream(30);
            
            const options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond };
            let recordedChunks = [];
            let mediaRecorder;
            
            try { mediaRecorder = new MediaRecorder(stream, options); }
            catch (e) {
                try { options.mimeType = 'video/webm;codecs=vp8'; mediaRecorder = new MediaRecorder(stream, options); }
                catch (e2) {
                    try { options.mimeType = 'video/webm'; mediaRecorder = new MediaRecorder(stream, options); }
                    catch (e3) { console.warn('MediaRecorder not supported'); resolve(file); return; }
                }
            }
            
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const compressed = new File([blob], file.name.replace(/\.[^/.]+$/, '.webm'), { type: 'video/webm' });
                console.log('Video compressed:', file.size, '→', compressed.size);
                resolve(compressed);
            };
            
            mediaRecorder.start();
            video.currentTime = 0;
            video.play();
            
            const drawFrame = () => {
                if (video.ended) { mediaRecorder.stop(); return; }
                ctx.drawImage(video, 0, 0, w, h);
                requestAnimationFrame(drawFrame);
            };
            
            video.onplay = drawFrame;
            video.onerror = () => { URL.revokeObjectURL(video.src); resolve(file); };
        };
        
        video.src = URL.createObjectURL(file);
        video.load();
        video.onloadeddata = () => URL.revokeObjectURL(video.src);
    });
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================================================
// Отображение сообщений
// ============================================================================
function createMessageElement(data, isOwn = false) {
    if (!data) return null;
    const message = document.createElement('div');
    const isCurrentUser = data.sender === currentUser || isOwn;
    message.className = 'message ' + (isCurrentUser ? 'own' : 'other');
    message.dataset.timestamp = data.timestamp;
    
    const displayText = escapeHtml(data.text);
    const checksHtml = getDeliveryStatusHtml(data.deliveryStatus || 'sent');
    
    if (!isCurrentUser) {
        const senderEl = document.createElement('div');
        senderEl.className = 'sender';
        senderEl.textContent = escapeHtml(data.sender);
        senderEl.style.cursor = 'pointer';
        senderEl.title = 'Открыть профиль';
        senderEl.addEventListener('click', e => { e.stopPropagation(); openProfile(data.sender); });
        message.appendChild(senderEl);
    }
    
    if (data.replyTo) {
        const replyEl = document.createElement('div');
        replyEl.className = 'message-reply';
        const sender = document.createElement('span');
        sender.className = 'reply-sender';
        sender.textContent = escapeHtml(data.replyTo.sender || '');
        const preview = document.createElement('span');
        preview.className = 'reply-preview';
        preview.textContent = escapeHtml((data.replyTo.text || '').substring(0, 50));
        replyEl.appendChild(sender);
        replyEl.appendChild(preview);
        message.appendChild(replyEl);
    }
    
    if (data.text) {
        const textEl = document.createElement('div');
        textEl.className = 'text';
        textEl.textContent = displayText;
        message.appendChild(textEl);
    }
    
    if (data.files?.length) {
        const filesContainer = document.createElement('div');
        filesContainer.className = 'message-files';
        data.files.forEach(f => {
            const el = createFileHtml(f);
            if (el) filesContainer.appendChild(el);
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
    
    message.addEventListener('contextmenu', e => {
        e.preventDefault();
        showMessageContextMenu(e, message, data, isCurrentUser);
    });
    
    message.addEventListener('dblclick', () => {
        if (!isCurrentUser) {
            replyToMessage = data;
            showReplyIndicator();
            DOM.messageBox?.focus();
        }
    });
    
    if (data.reactions) {
        message._reactions = data.reactions;
        updateMessageReactions(message, data.reactions);
    }
    
    return message;
}

function getDeliveryStatusHtml(status) {
    switch (status) {
        case 'pending': return '<span class="checks pending" title="Отправка">⏳</span>';
        case 'sent': return '<span class="checks sent" title="Отправлено">✓</span>';
        case 'delivered':
        case 'read': return '<span class="checks delivered" title="Прочитано">✓✓</span>';
        default: return '<span class="checks">✓</span>';
    }
}

function addMessage(data, isOwn = false, scroll = true) {
    if (!DOM.messagesList) return;
    const message = createMessageElement(data, isOwn);
    if (!message) return;
    DOM.messagesList.appendChild(message);
    if (scroll) DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
}

// ============================================================================
// Контекстное меню сообщений
// ============================================================================
let messageContextMenuTarget = null;

function showMessageContextMenu(e, messageEl, messageData, isOwn) {
    closeMessageContextMenu();
    messageContextMenuTarget = { messageEl, messageData, isOwn };
    messageEl.classList.add('context-menu-active');
    
    const menu = document.createElement('div');
    menu.id = 'messageContextMenu';
    menu.className = 'message-context-menu';
    menu.style.left = Math.min(e.pageX, window.innerWidth - 210) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - 190) + 'px';
    
    const reactionsBtn = document.createElement('button');
    reactionsBtn.className = 'message-context-menu-item';
    reactionsBtn.textContent = '😊 Реакции';
    reactionsBtn.addEventListener('click', () => { showReactionPicker(e.pageX, e.pageY, messageData, messageEl); closeMessageContextMenu(); });
    menu.appendChild(reactionsBtn);
    
    const divider1 = document.createElement('div');
    divider1.className = 'message-context-menu-divider';
    menu.appendChild(divider1);
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-context-menu-item';
    copyBtn.textContent = '📋 Копировать';
    copyBtn.addEventListener('click', () => { copyMessageText(messageData.text); closeMessageContextMenu(); });
    menu.appendChild(copyBtn);
    
    const replyBtn = document.createElement('button');
    replyBtn.className = 'message-context-menu-item';
    replyBtn.textContent = '↩️ Ответить';
    replyBtn.addEventListener('click', () => {
        replyToMessage = messageData;
        showReplyIndicator();
        closeMessageContextMenu();
        DOM.messageBox?.focus();
    });
    menu.appendChild(replyBtn);
    
    const divider2 = document.createElement('div');
    divider2.className = 'message-context-menu-divider';
    menu.appendChild(divider2);
    
    if (isOwn) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'message-context-menu-item danger';
        deleteBtn.textContent = '🗑️ Удалить у всех';
        deleteBtn.addEventListener('click', () => { deleteMessage(messageData, messageEl); closeMessageContextMenu(); });
        menu.appendChild(deleteBtn);
    }
    
    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(ev) {
            const m = document.getElementById('messageContextMenu');
            if (m && !m.contains(ev.target)) { closeMessageContextMenu(); document.removeEventListener('click', closeMenu); }
        }, { once: true });
        document.addEventListener('scroll', closeMessageContextMenu, { once: true });
    }, 100);
}

function closeMessageContextMenu() {
    const menu = document.getElementById('messageContextMenu');
    if (menu) menu.remove();
    if (messageContextMenuTarget?.messageEl) messageContextMenuTarget.messageEl.classList.remove('context-menu-active');
    messageContextMenuTarget = null;
}

function showReactionPicker(x, y, messageData, messageEl) {
    const existing = document.getElementById('reactionPicker');
    if (existing) existing.remove();
    
    const picker = document.createElement('div');
    picker.id = 'reactionPicker';
    picker.className = 'reaction-picker';
    picker.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    picker.style.top = (y - 50) + 'px';
    
    const reactions = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    reactions.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-option';
        btn.textContent = emoji;
        btn.addEventListener('click', () => { addReaction(messageData, messageEl, emoji); picker.remove(); });
        picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);
    setTimeout(() => { document.addEventListener('click', function close(ev) {
        if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); }
    }, { once: true }); }, 100);
}

function addReaction(messageData, messageEl, emoji) {
    if (!messageData?.timestamp || !currentUser) return;
    
    const reactions = messageData.reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];
    
    const existing = reactions[emoji].find(r => r.userId === currentUser);
    if (existing) {
        reactions[emoji] = reactions[emoji].filter(r => r.userId !== currentUser);
        if (!reactions[emoji].length) delete reactions[emoji];
    } else {
        reactions[emoji].push({ userId: currentUser, timestamp: Date.now() });
    }
    
    messageData.reactions = reactions;
    updateMessageReactions(messageEl, reactions);
    
    sendToServer({
        type: 'message_reaction',
        timestamp: messageData.timestamp,
        reaction: emoji,
        add: !existing
    });
    
    if (selectedUser) {
        try {
            const msgs = loadMessagesFromStorage(selectedUser);
            const msg = msgs.find(m => m.timestamp === messageData.timestamp);
            if (msg) {
                msg.reactions = reactions;
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(msgs));
            }
        } catch (e) { console.error('Save reaction error:', e); }
    }
}

function updateMessageReactions(messageEl, reactions) {
    if (!messageEl) return;
    
    let reactionsContainer = messageEl.querySelector('.message-reactions');
    if (!reactionsContainer) {
        reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';
        messageEl.appendChild(reactionsContainer);
    }
    
    const userReactions = getUserReactionsForMessage(reactions, currentUser);
    if (!Object.keys(userReactions).length) {
        reactionsContainer.innerHTML = '';
        reactionsContainer.style.display = 'none';
        return;
    }
    
    reactionsContainer.style.display = 'flex';
    reactionsContainer.innerHTML = Object.entries(userReactions).map(([emoji, users]) =>
        `<span class="reaction-badge" title="${users.map(u => u.userId).join(', ')}">${emoji} ${users.length}</span>`
    ).join('');
}

function getUserReactionsForMessage(reactions, userId) {
    if (!reactions) return {};
    const result = {};
    for (const [emoji, users] of Object.entries(reactions)) {
        const userReactions = users.filter(u => u.userId === userId);
        if (userReactions.length) result[emoji] = userReactions;
    }
    return result;
}

function copyMessageText(text) {
    if (!text) return;
    try {
        navigator.clipboard.writeText(text).then(() => showToast('Скопировано', false))
            .catch(() => fallbackCopyText(text));
    } catch (e) { fallbackCopyText(text); }
}

function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('Скопировано', false);
    } catch (e) { console.error('Copy error:', e); }
    ta.remove();
}

function showReplyIndicator() {
    if (!replyToMessage) return;
    let existing = document.getElementById('replyIndicator');
    if (existing) existing.remove();
    
    const indicator = document.createElement('div');
    indicator.id = 'replyIndicator';
    indicator.className = 'reply-indicator';
    
    const textSpan = document.createElement('span');
    textSpan.className = 'reply-text';
    textSpan.innerHTML = 'Ответ на сообщение: <strong></strong>';
    const strong = textSpan.querySelector('strong');
    if (strong) strong.textContent = escapeHtml(replyToMessage.sender || '');
    indicator.appendChild(textSpan);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'reply-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '✕';
    cancelBtn.addEventListener('click', () => {
        replyToMessage = null;
        indicator.remove();
    });
    indicator.appendChild(cancelBtn);
    
    const inputPanel = document.getElementById('inputPanel');
    if (inputPanel) inputPanel.parentNode.insertBefore(indicator, inputPanel);
}

function deleteMessage(messageData, messageEl) {
    if (!messageData?.timestamp) return;
    if (!confirm('Удалить это сообщение у всех?')) return;
    
    sendToServer({ type: 'delete_message', timestamp: messageData.timestamp, chatWith: selectedUser });
    
    if (messageEl?.parentNode) {
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'scale(0.9)';
        setTimeout(() => messageEl?.remove(), 200);
    }
    
    if (selectedUser) {
        const msgs = loadMessagesFromStorage(selectedUser);
        const filtered = msgs.filter(m => m.timestamp !== messageData.timestamp);
        localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(filtered));
    }
}

function handleRemoteMessageDelete(timestamp, deletedBy) {
    if (!timestamp) return;
    
    DOM.messagesList?.querySelectorAll('.message').forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            msg.style.opacity = '0';
            msg.style.transform = 'scale(0.9)';
            setTimeout(() => msg?.remove(), 200);
        }
    });
    
    if (selectedUser) {
        const msgs = loadMessagesFromStorage(selectedUser);
        const filtered = msgs.filter(m => m.timestamp !== timestamp);
        localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(filtered));
    }
    
    showToast('🗑️ Сообщение удалено: ' + escapeHtml(deletedBy));
}

function handleRemoteMessageReaction(timestamp, data) {
    if (!timestamp || !data.reaction) return;
    const { reaction, user, add, reactionTimestamp } = data;
    
    DOM.messagesList?.querySelectorAll('.message').forEach(msg => {
        if (msg.dataset.timestamp == timestamp) {
            const current = msg._reactions || {};
            if (!current[reaction]) current[reaction] = [];
            const idx = current[reaction].findIndex(r => r.userId === user);
            if (add !== false) {
                if (idx === -1) current[reaction].push({ userId: user, timestamp: reactionTimestamp || Date.now() });
            } else {
                if (idx !== -1) current[reaction].splice(idx, 1);
                if (!current[reaction].length) delete current[reaction];
            }
            msg._reactions = current;
            updateMessageReactions(msg, current);
        }
    });
    
    if (selectedUser) {
        try {
            const msgs = loadMessagesFromStorage(selectedUser);
            const msg = msgs.find(m => m.timestamp === timestamp);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};
                const current = msg.reactions;
                if (!current[reaction]) current[reaction] = [];
                const idx = current[reaction].findIndex(r => r.userId === user);
                if (add !== false) {
                    if (idx === -1) current[reaction].push({ userId: user, timestamp: reactionTimestamp || Date.now() });
                } else {
                    if (idx !== -1) current[reaction].splice(idx, 1);
                    if (!current[reaction].length) delete current[reaction];
                }
                localStorage.setItem(`chat_messages_${currentUser}_${selectedUser}`, JSON.stringify(msgs));
            }
        } catch (e) { console.error('Update reaction error:', e); }
    }
}

// ============================================================================
// Файлы
// ============================================================================
function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    const remaining = MAX_FILES_PER_MESSAGE - selectedFiles.length;
    if (remaining <= 0) { showToast(`Максимум ${MAX_FILES_PER_MESSAGE} файлов`, true); return; }
    
    const toAdd = files.slice(0, remaining);
    toAdd.forEach(file => {
        if (file.size > MAX_FILE_SIZE) { showToast(`Файл "${file.name}" слишком большой (макс. 10MB)`, true); return; }
        const dup = selectedFiles.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
        if (!dup) selectedFiles.push(file);
    });
    
    renderFilePreview();
    if (DOM.fileInput) DOM.fileInput.value = '';
}

function renderFilePreview() {
    if (!DOM.filePreviewContainer) return;
    if (!selectedFiles.length) {
        DOM.filePreviewContainer.classList.add('hidden');
        DOM.filePreviewContainer.innerHTML = '';
        return;
    }
    
    DOM.filePreviewContainer.classList.remove('hidden');
    DOM.filePreviewContainer.innerHTML = '';
    
    selectedFiles.forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.className = 'file-preview-image';
            img.alt = file.name;
            const reader = new FileReader();
            reader.onload = e => { img.src = e.target.result; };
            reader.readAsDataURL(file);
            item.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = getFileIcon(file.type);
            item.appendChild(icon);
        }
        
        const info = document.createElement('div');
        info.className = 'file-info';
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatFileSize(file.size);
        info.appendChild(name);
        info.appendChild(size);
        item.appendChild(info);
        
        const remove = document.createElement('button');
        remove.className = 'remove-file-btn';
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Удалить';
        remove.addEventListener('click', () => { removeFile(i); });
        item.appendChild(remove);
        
        DOM.filePreviewContainer.appendChild(item);
    });
}

function removeFile(i) { selectedFiles.splice(i, 1); renderFilePreview(); }
function clearSelectedFiles() { selectedFiles = []; renderFilePreview(); }

function getFileIcon(type) {
    if (!type) return '📄';
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📕';
    if (type.includes('word')) return '📘';
    if (type.includes('zip') || type.includes('rar')) return '📦';
    return '📄';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function createFileHtml(f) {
    if (!f || typeof f !== 'object') return null;
    const { type, name, size, data } = f;
    if (typeof type !== 'string' || typeof name !== 'string' || typeof data !== 'string') return null;
    if (/[<>\"'&]/.test(name)) return null;
    if (!data.startsWith('data:') && !data.startsWith('blob:')) return null;
    
    const sizeStr = formatFileSize(size || 0);
    const container = document.createElement('div');
    container.className = 'message-file-wrapper';
    
    if (type.startsWith('image/')) {
        container.classList.add('message-file', 'message-file-image');
        const img = document.createElement('img');
        img.src = data;
        img.alt = escapeHtml(name);
        img.title = `${escapeHtml(name)} (${sizeStr})`;
        container.appendChild(img);
        return container;
    }
    
    if (type.startsWith('video/')) {
        container.classList.add('message-file', 'message-file-video');
        const video = document.createElement('video');
        video.controls = true;
        video.title = `${escapeHtml(name)} (${sizeStr})`;
        const source = document.createElement('source');
        source.src = data;
        source.type = escapeHtml(type);
        video.appendChild(source);
        container.appendChild(video);
        return container;
    }
    
    if (type.startsWith('audio/')) {
        container.classList.add('message-file', 'message-file-audio');
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.title = `${escapeHtml(name)} (${sizeStr})`;
        const source = document.createElement('source');
        source.src = data;
        source.type = escapeHtml(type);
        audio.appendChild(source);
        container.appendChild(audio);
        return container;
    }
    
    container.classList.add('message-file', 'message-file-generic');
    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-icon';
    iconSpan.textContent = getFileIcon(type);
    container.appendChild(iconSpan);
    
    const details = document.createElement('div');
    details.className = 'file-details';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = escapeHtml(name);
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = sizeStr;
    details.appendChild(nameSpan);
    details.appendChild(sizeSpan);
    container.appendChild(details);
    
    const link = document.createElement('a');
    link.href = data;
    link.download = escapeHtml(name);
    link.className = 'download-file-btn';
    link.textContent = '⬇️';
    container.appendChild(link);
    
    return container;
}

// ============================================================================
// Профиль
// ============================================================================
function getAvailableBadgeIds() { return Object.keys(BADGES_CATALOG); }
function getBadgeInfo(id) { return BADGES_CATALOG[id] || null; }

function updateBadgeCatalogFromServer(catalog) {
    if (!Array.isArray(catalog)) return;
    catalog.forEach(item => {
        if (item?.id && item.icon && item.name) {
            BADGES_CATALOG[item.id] = { icon: item.icon, name: item.name, description: item.description || '' };
        }
    });
    console.log('Badge catalog updated:', catalog.length);
    if (DOM.profileModal && !DOM.profileModal.classList.contains('hidden'))
        renderBadges(userBadges, viewedProfileUserId === currentUser);
}

function requestBadgeCatalog() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'get_badge_catalog' }));
}

function initProfile() {
    loadUserProfile();
    
    DOM.closeProfile?.addEventListener('click', closeProfile);
    DOM.editProfileBtn?.addEventListener('click', toggleEditMode);
    
    DOM.avatarContainer?.addEventListener('click', () => {
        if (viewedProfileUserId === currentUser) DOM.avatarFileInput?.click();
    });
    DOM.avatarFileInput?.addEventListener('change', handleAvatarFileSelect);
    DOM.applyAvatarUrlBtn?.addEventListener('click', applyAvatarUrl);
    DOM.saveProfileBtn?.addEventListener('click', saveProfileChanges);
    DOM.cancelProfileBtn?.addEventListener('click', cancelProfileChanges);
    DOM.sendMessageBtn?.addEventListener('click', () => {
        if (viewedProfileUserId && viewedProfileUserId !== currentUser) {
            selectUser(viewedProfileUserId);
            closeProfile();
        }
    });
    
    DOM.customStatusSelect?.addEventListener('change', handleCustomStatusChange);
    DOM.changeAvatarBtn?.addEventListener('click', () => { DOM.editAvatarFileInput?.click(); });
    DOM.editAvatarFileInput?.addEventListener('change', handleEditAvatarFileSelect);
    DOM.removeAvatarBtn?.addEventListener('click', handleRemoveAvatar);
    
    DOM.profileModal?.addEventListener('click', e => { if (e.target === DOM.profileModal) closeProfile(); });
    
    DOM.chatMenuBtn?.addEventListener('click', toggleChatMenu);
    DOM.deleteChatBtn?.addEventListener('click', () => { deleteCurrentChat(); closeChatMenu(); });
    
    document.addEventListener('click', e => {
        if (DOM.chatMenuDropdown && !DOM.chatMenuDropdown.classList.contains('hidden')) {
            if (!DOM.chatMenuDropdown.contains(e.target) && !DOM.chatMenuBtn?.contains(e.target)) closeChatMenu();
        }
    });
}

function toggleChatMenu() {
    if (!DOM.chatMenuDropdown) return;
    DOM.chatMenuDropdown.classList.toggle('hidden');
    DOM.chatMenuBtn?.setAttribute('aria-expanded', !DOM.chatMenuDropdown.classList.contains('hidden'));
}

function closeChatMenu() {
    DOM.chatMenuDropdown?.classList.add('hidden');
    DOM.chatMenuBtn?.setAttribute('aria-expanded', 'false');
}

function handleCustomStatusChange() {
    if (!DOM.customStatusSelect) return;
    const val = DOM.customStatusSelect.value;
    if (DOM.customStatusText) {
        if (val === 'custom') { DOM.customStatusText.classList.remove('hidden'); DOM.customStatusText.focus(); }
        else DOM.customStatusText.classList.add('hidden');
    }
}

function getStatusDisplay(status) {
    const map = {
        'online': { text: 'Онлайн', class: 'online', color: 'var(--status-online)', icon: '🟢' },
        'offline': { text: 'Офлайн', class: 'offline', color: 'var(--status-offline)', icon: '⚫' },
        'busy': { text: 'Не беспокоить', class: 'busy', color: 'var(--error)', icon: '🔴' },
        'away': { text: 'Отошёл', class: 'away', color: 'var(--warning)', icon: '🟡' },
        'custom': { text: 'Свой статус', class: 'custom', color: 'var(--text-secondary)', icon: '✏️' }
    };
    return map[status] || map['offline'];
}

function saveUserStatus(status) {
    if (!currentUser) return;
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        profile.customStatus = status;
        localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));
        updateProfileStatusDisplay(status);
        updateFooterStatusDisplay(status);
    } catch (e) { console.error('Save status error:', e); }
}

function updateProfileStatusDisplay(status) {
    if (!DOM.profileUserStatus) return;
    const d = getStatusDisplay(status);
    DOM.profileUserStatus.className = 'profile-user-status ' + d.class;
    const dot = DOM.profileUserStatus.querySelector('.status-dot');
    const text = DOM.profileUserStatus.querySelector('.status-text');
    if (dot) dot.style.background = d.color;
    if (text) text.textContent = d.text;
}

function updateFooterStatusDisplay(status) {
    if (!DOM.footerUserStatusIndicator) return;
    const d = getStatusDisplay(status);
    DOM.footerUserStatusIndicator.className = 'status-indicator ' + d.class;
}

function handleEditAvatarFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showProfileMessage('Выберите изображение', true); return; }
    if (file.size > 5 * 1024 * 1024) { showProfileMessage('Макс. размер 5MB', true); return; }
    
    const reader = new FileReader();
    reader.onload = ev => {
        if (ev.target?.result) {
            saveAvatar(ev.target.result);
            if (DOM.editAvatarPreview) DOM.editAvatarPreview.src = ev.target.result;
            showProfileMessage('Аватар загружен', false);
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function handleRemoveAvatar() {
    saveAvatar('');
    if (DOM.editAvatarPreview) DOM.editAvatarPreview.src = getDefaultAvatar(currentUser);
    showProfileMessage('Аватар удалён', false);
}

function saveAvatar(url) {
    if (!currentUser) return;
    try {
        const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`) || '{}');
        profile.avatarUrl = url;
        localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));
        updateAvatarDisplay(url);
    } catch (e) { console.error('Save avatar error:', e); }
}

function updateAvatarDisplay(url) {
    const avatar = url || getDefaultAvatar(currentUser);
    if (DOM.profileAvatar) DOM.profileAvatar.src = avatar;
    if (DOM.editAvatarPreview) DOM.editAvatarPreview.src = avatar;
}

function showProfileMessage(msg, isError = false) {
    const el = document.getElementById('profileMessage');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--error)' : 'var(--success)';
    setTimeout(() => { el.textContent = ''; }, 3000);
}

function deleteCurrentChat() {
    if (!selectedUser && !selectedGroup) return;
    const name = selectedUser || groups.find(g => g.id === selectedGroup)?.name;
    if (!name) return;
    
    if (!confirm(`Удалить чат "${name}"?`)) return;
    
    if (selectedUser) {
        sendToServer({ type: 'delete_chat', chatName: selectedUser });
        removeChatFromList(selectedUser);
    } else if (selectedGroup) {
        const group = groups.find(g => g.id === selectedGroup);
        if (group?.creator === currentUser) {
            localStorage.removeItem(`group_messages_${selectedGroup}`);
            groups = groups.filter(g => g.id !== selectedGroup);
            sendToServer({ type: 'delete_group', group_id: selectedGroup, user_id: currentUser });
        } else { alert('Только создатель может удалить группу'); return; }
    }
    
    selectedUser = null; selectedGroup = null;
    DOM.messagesList && (DOM.messagesList.innerHTML = '');
    DOM.messagesList?.classList.add('hidden');
    DOM.chatPlaceholder?.classList.remove('hidden');
    DOM.inputPanel?.classList.add('hidden');
    DOM.chatUserStatus?.classList.add('hidden');
    DOM.chatTitle && (DOM.chatTitle.textContent = 'Чат');
    window.sidebarComponent?.renderChatsList();
    closeChatMenu();
}

function loadUserProfile() {
    if (!currentUser) return;
    try {
        const profile = localStorage.getItem(`user_profile_${currentUser}`);
        userProfile = profile ? JSON.parse(profile) : { username: currentUser, avatar: null, status: 'online' };
        const badges = localStorage.getItem(`user_badges_${currentUser}`);
        userBadges = badges ? JSON.parse(badges) : [];
    } catch (e) {
        console.error('Load profile error:', e);
        userProfile = { username: currentUser, avatar: null, status: 'online' };
        userBadges = [];
    }
}

function saveUserProfile() {
    if (!currentUser || !userProfile) return;
    try {
        localStorage.setItem(`user_profile_${currentUser}`, JSON.stringify(userProfile));
        localStorage.setItem(`user_badges_${currentUser}`, JSON.stringify(userBadges));
    } catch (e) { console.error('Save profile error:', e); }
}

function openProfile(userId) {
    if (!userId || !DOM.profileModal) return;
    userId = escapeHtml(userId);
    viewedProfileUserId = userId;
    const isOwn = userId === currentUser;
    
    const title = document.getElementById('profileTitle');
    if (title) title.textContent = isOwn ? 'Ваш профиль' : 'Профиль';
    
    const profile = JSON.parse(localStorage.getItem(`profile_${userId}`) || '{}');
    const avatar = profile.avatarUrl || getDefaultAvatar(userId);
    
    let status = isOwn ? (profile.customStatus || 'online') : getUserStatus(userId);
    
    if (DOM.profileAvatar) {
        DOM.profileAvatar.src = avatar;
        DOM.profileAvatar.alt = `Аватар ${escapeHtml(userId)}`;
    }
    if (DOM.profileUserName) DOM.profileUserName.textContent = escapeHtml(userId);
    
    if (DOM.profileUserStatus) {
        const d = getStatusDisplay(status);
        DOM.profileUserStatus.className = 'profile-user-status ' + d.class;
        const dot = DOM.profileUserStatus.querySelector('.status-dot');
        const text = DOM.profileUserStatus.querySelector('.status-text');
        if (dot) dot.style.background = d.color;
        if (text) text.textContent = d.text;
    }
    
    if (isOwn && DOM.customStatusSelect) {
        DOM.customStatusSelect.value = profile.customStatus || 'online';
        if (DOM.customStatusText) {
            DOM.customStatusText.classList.toggle('hidden', profile.customStatus !== 'custom');
        }
    }
    
    if (isOwn && DOM.editAvatarPreview) DOM.editAvatarPreview.src = avatar;
    
    renderBadges(isOwn ? userBadges : userBadges.filter(b => b.visible), !isOwn);
    
    DOM.editProfileBtn?.classList.toggle('hidden', !isOwn);
    DOM.profileActionsSection?.classList.toggle('hidden', isOwn);
    
    const overlay = document.getElementById('avatarOverlay');
    if (overlay) overlay.classList.toggle('hidden', !isOwn);
    
    DOM.editPanel?.classList.add('hidden');
    DOM.profileModal.classList.remove('hidden');
}

function getUserStatus(userId) {
    const user = users.find(u => u.name === userId);
    return user?.status || 'offline';
}

function closeProfile() {
    DOM.profileModal?.classList.add('hidden');
    viewedProfileUserId = null;
}

function toggleEditMode() {
    if (!DOM.editPanel) return;
    const editing = !DOM.editPanel.classList.contains('hidden');
    if (editing) {
        DOM.editPanel.classList.add('hidden');
        DOM.editProfileBtn.textContent = '✏️';
    } else {
        DOM.editPanel.classList.remove('hidden');
        DOM.editProfileBtn.textContent = '✅';
        renderBadgeVisibilityList();
    }
}

function renderBadges(badges) {
    if (!DOM.badgesGrid) return;
    DOM.badgesGrid.innerHTML = '';
    
    const visible = badges?.filter(b => b.visible) || [];
    if (!visible.length) {
        DOM.badgesGrid.innerHTML = '<p class="no-badges-text">Значки отсутствуют</p>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    visible.forEach(badge => {
        const info = getBadgeInfo(badge.id);
        if (!info) return;
        const el = document.createElement('div');
        el.className = 'badge-item';
        el.title = info.description;
        const icon = document.createElement('span');
        icon.className = 'badge-icon';
        icon.textContent = info.icon;
        const name = document.createElement('span');
        name.className = 'badge-name';
        name.textContent = info.name;
        el.appendChild(icon);
        el.appendChild(name);
        fragment.appendChild(el);
    });
    DOM.badgesGrid.appendChild(fragment);
}

function renderBadgeVisibilityList() {
    if (!DOM.badgeVisibilityList) return;
    DOM.badgeVisibilityList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    getAvailableBadgeIds().forEach(id => {
        const info = getBadgeInfo(id);
        if (!info) return;
        const userBadge = userBadges.find(b => b.id === id);
        const has = !!userBadge;
        const visible = has && userBadge.visible;
        
        const el = document.createElement('div');
        el.className = 'badge-visibility-item';
        const icon = document.createElement('span');
        icon.className = 'badge-icon-small';
        icon.textContent = info.icon;
        const label = document.createElement('span');
        label.className = 'badge-label';
        label.textContent = info.name;
        const toggle = document.createElement('button');
        toggle.className = 'badge-toggle' + (visible ? ' active' : '');
        toggle.type = 'button';
        toggle.dataset.badgeId = id;
        toggle.textContent = visible ? '✓' : '○';
        toggle.addEventListener('click', () => toggleBadgeVisibility(id));
        el.appendChild(icon);
        el.appendChild(label);
        el.appendChild(toggle);
        fragment.appendChild(el);
    });
    
    DOM.badgeVisibilityList.appendChild(fragment);
}

function toggleBadgeVisibility(id) {
    const idx = userBadges.findIndex(b => b.id === id);
    if (idx >= 0) {
        userBadges[idx].visible = !userBadges[idx].visible;
        if (!userBadges[idx].visible) userBadges.splice(idx, 1);
    } else {
        userBadges.push({ id, visible: true });
    }
    renderBadgeVisibilityList();
    renderBadges(userBadges);
}

function handleAvatarFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showProfileMessage('Выберите изображение', true); return; }
    if (file.size > 5 * 1024 * 1024) { showProfileMessage('Макс. 5MB', true); return; }
    
    const reader = new FileReader();
    reader.onload = ev => {
        if (ev.target?.result) {
            userProfile.avatar = ev.target.result;
            saveUserProfile();
            if (DOM.profileAvatar) DOM.profileAvatar.src = ev.target.result;
            showProfileMessage('Аватар загружен', false);
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function applyAvatarUrl() {
    const url = DOM.avatarUrlInput?.value.trim();
    if (!url) { showProfileMessage('Введите URL', true); return; }
    try { new URL(url); } catch { showProfileMessage('Неверный URL', true); return; }
    
    userProfile.avatar = url;
    saveUserProfile();
    if (DOM.profileAvatar) DOM.profileAvatar.src = url;
    DOM.avatarUrlInput && (DOM.avatarUrlInput.value = '');
    showProfileMessage('Аватар обновлён', false);
}

function saveProfileChanges() {
    saveUserProfile();
    if (DOM.customStatusSelect) saveUserStatus(DOM.customStatusSelect.value);
    if (socket?.readyState === WebSocket.OPEN && userBadges) {
        sendToServer({ type: 'update_badges', badges: userBadges.map(b => ({ id: b.id, visible: b.visible })) });
    }
    toggleEditMode();
    showProfileMessage('Сохранено', false);
    if (selectedUser === currentUser) updateChatTitleWithBadges();
}

function cancelProfileChanges() {
    loadUserProfile();
    toggleEditMode();
}

function getDefaultAvatar(userId) {
    const colors = ['#7B2CBF', '#2563EB', '#059669', '#DC2626', '#EA580C', '#DB2777', '#0891B2', '#7C3AED'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    const color = colors[Math.abs(hash) % colors.length];
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(userId)}&background=${color.replace('#', '')}&color=fff&size=128`;
}

function updateChatTitleWithBadges() {
    if (!DOM.chatTitle || !selectedUser) return;
    const visible = userBadges.filter(b => b.visible);
    if (selectedUser === currentUser && visible.length) {
        const info = getBadgeInfo(visible[0].id);
        DOM.chatTitle.textContent = info ? `${info.icon} ${selectedUser}` : selectedUser;
    } else {
        DOM.chatTitle.textContent = `💬 ${selectedUser}`;
    }
}

function updateChatHeaderAvatar(username) {
    const status = document.getElementById('chatUserStatus');
    if (status) {
        const text = status.querySelector('.status-text');
        if (text) text.textContent = username;
    }
}

function renderProfileData(profile) {
    if (!profile) return;
    if (DOM.profileUserName) DOM.profileUserName.textContent = escapeHtml(profile.username || '');
    if (DOM.profileAvatar) DOM.profileAvatar.src = profile.avatar || getDefaultAvatar(profile.username);
    if (DOM.profileUserStatus) {
        const d = getStatusDisplay(profile.customStatus || 'online');
        DOM.profileUserStatus.className = 'profile-user-status ' + d.class;
        const text = DOM.profileUserStatus.querySelector('.status-text');
        if (text) text.textContent = d.text;
    }
}

function handleUserFound(user) {
    console.log('User found:', user);
}

function handleTypingIndicator(from, isTyping) {
    console.log('Typing:', from, isTyping);
}

function handleMessageReadReceipt(from, timestamp) {
    console.log('Read receipt:', from, timestamp);
}

function handleMessageDeleted(timestamp, deletedBy) {
    handleRemoteMessageDelete(timestamp, deletedBy);
}

function handleMessageReaction(data) {
    handleRemoteMessageReaction(data.timestamp, data);
}

function openCreateGroupModal() {
    if (!DOM.createGroupModal) return;
    renderGroupMembersSelect();
    DOM.createGroupModal.classList.remove('hidden');
}

function showCreateGroupModal() {
    openCreateGroupModal();
}

// ============================================================================
// Настройки
// ============================================================================
function syncSettingsUI() {
    if (DOM.themeSelect) DOM.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'dark';
    if (DOM.accentColorSelect) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (accent) DOM.accentColorSelect.value = accent;
    }
    if (DOM.messageColorSelect) {
        const color = getComputedStyle(document.documentElement).getPropertyValue('--own-message-bg').trim();
        if (color) DOM.messageColorSelect.value = color;
    }
    if (DOM.fontSizeSelect) {
        let size = '14';
        if (document.body.classList.contains('font-small')) size = '12';
        else if (document.body.classList.contains('font-large')) size = '16';
        DOM.fontSizeSelect.value = size;
    }
    if (DOM.showInDirectory) DOM.showInDirectory.checked = isVisibleInDirectory;
    if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = allowGroupInvite;
}

function adjustColorBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function initHotkeys() {
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'k') { e.preventDefault(); DOM.searchBox?.focus(); DOM.searchBox?.select(); }
        if (e.key === 'Escape') {
            DOM.settingsModal?.classList.add('hidden');
            if (selectedUser) showGeneralChat();
            document.querySelector('.context-menu')?.remove();
            closeMessageContextMenu();
            if (replyToMessage) { replyToMessage = null; document.getElementById('replyIndicator')?.remove(); }
        }
    });
}

function performLogout() {
    DOM.settingsModal?.classList.add('hidden');
    sendToServer({ type: 'logout' });
    if (socket) { try { socket.close(1000, 'User logout'); } catch (e) { console.warn('Socket close error:', e); } socket = null; }
    clearMasterKey(); userSalt = null; pendingPassword = null;
    if (masterKeyTimeout) { clearTimeout(masterKeyTimeout); masterKeyTimeout = null; }
    currentUser = null; selectedUser = null; users = []; replyToMessage = null; messageContextMenuTarget = null;
    DOM.chatWindow?.classList.add('hidden'); DOM.loginWindow?.classList.remove('hidden');
    document.getElementById('loginUsername') && (document.getElementById('loginUsername').value = '');
    document.getElementById('loginPassword') && (document.getElementById('loginPassword').value = '');
    document.getElementById('loginStatus') && (document.getElementById('loginStatus').textContent = '');
    updateFooterProfile(); DOM.profileModal?.classList.add('hidden'); console.log('User logged out');
}

// ============================================================================
// LocalStorage
// ============================================================================
function saveUsersToStorage() {
    try { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); }
    catch (e) {
        console.error('Save users error:', e);
        if (e.name === 'QuotaExceededError') {
            console.warn('Quota exceeded, clearing messages...');
            try { Object.keys(localStorage).filter(k => k.startsWith('chat_messages_')).forEach(k => localStorage.removeItem(k));
                localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); }
            catch (retry) { console.error('Retry save error:', retry); }
        }
    }
}

function loadSavedUsers() { try { const saved = localStorage.getItem(STORAGE_KEYS.USERS); if (saved) users = JSON.parse(saved); } catch (e) { users = []; } }

function saveMessageToStorage(username, message) {
    try {
        if (!currentUser || !username) return;
        const key = `chat_messages_${currentUser}_${username}`;
        let messages = loadMessagesFromStorage(username);
        messages.push(message);
        if (messages.length > MAX_MESSAGES_IN_STORAGE) messages = messages.slice(-MAX_MESSAGES_IN_STORAGE);
        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) {
        console.error('Save message error:', e);
        if (e.name === 'QuotaExceededError') { try { localStorage.clear(); } catch (c) { console.error('Clear error:', c); } }
    }
}

function loadMessagesFromStorage(username) {
    try {
        if (!username) return [];
        const key = `chat_messages_${currentUser}_${username}`;
        const saved = localStorage.getItem(key);
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(m => m && typeof m === 'object' && typeof m.sender === 'string' && typeof m.text === 'string' && typeof m.timestamp === 'number');
    } catch (e) { console.error('Load messages error:', e); return []; }
}

function loadSettings() {
    try {
        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (!settings) {
            document.documentElement.style.setProperty('--own-message-bg', DEFAULT_MESSAGE_COLOR);
            document.documentElement.setAttribute('data-theme', 'dark');
            document.documentElement.style.setProperty('--accent', '#7B2CBF');
            document.documentElement.style.setProperty('--accent-hover', '#9D4EDD');
            document.body.classList.add('font-medium');
            isVisibleInDirectory = false; allowGroupInvite = false; soundEnabled = true;
            return;
        }
        const data = JSON.parse(settings);
        if (!data || typeof data !== 'object') return;
        if (data.theme) { document.documentElement.setAttribute('data-theme', data.theme); if (DOM.themeSelect) DOM.themeSelect.value = data.theme; }
        if (data.accentColor) {
            document.documentElement.style.setProperty('--accent', data.accentColor);
            document.documentElement.style.setProperty('--accent-hover', adjustColorBrightness(data.accentColor, 20));
            if (DOM.accentColorSelect) DOM.accentColorSelect.value = data.accentColor;
        }
        if (data.messageColor) { document.documentElement.style.setProperty('--own-message-bg', data.messageColor); if (DOM.messageColorSelect) DOM.messageColorSelect.value = data.messageColor; }
        else { document.documentElement.style.setProperty('--own-message-bg', DEFAULT_MESSAGE_COLOR); }
        if (data.fontSize) { document.body.classList.remove('font-small', 'font-medium', 'font-large'); document.body.classList.add('font-' + data.fontSize); if (DOM.fontSizeSelect) DOM.fontSizeSelect.value = data.fontSize; }
        if (typeof data.soundEnabled === 'boolean') { soundEnabled = data.soundEnabled; if (DOM.soundNotify) DOM.soundNotify.checked = data.soundEnabled; }
        isVisibleInDirectory = typeof data.isVisibleInDirectory === 'boolean' ? data.isVisibleInDirectory : false;
        allowGroupInvite = typeof data.allowGroupInvite === 'boolean' ? data.allowGroupInvite : false;
        if (DOM.showInDirectory) DOM.showInDirectory.checked = isVisibleInDirectory;
        if (DOM.allowGroupInvite) DOM.allowGroupInvite.checked = allowGroupInvite;
    } catch (e) { console.error('Load settings error:', e); }
}

function saveSettings() {
    try {
        const settings = { theme: DOM.themeSelect?.value || 'dark', accentColor: DOM.accentColorSelect?.value || '#7B2CBF',
            messageColor: DOM.messageColorSelect?.value || '#7B2CBF', fontSize: DOM.fontSizeSelect?.value || '14',
            soundEnabled: DOM.soundNotify?.checked ?? true, isVisibleInDirectory: DOM.showInDirectory?.checked ?? false,
            allowGroupInvite: DOM.allowGroupInvite?.checked ?? false };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) { console.error('Save settings error:', e); }
}

function setInputPanelVisible(visible) {
    if (!DOM.inputPanel || !DOM.chatPlaceholder || !DOM.messagesList) return;
    DOM.inputPanel.classList.toggle('hidden', !visible); DOM.chatPlaceholder.classList.toggle('hidden', visible);
    DOM.messagesList.classList.toggle('hidden', !visible);
    if (visible) DOM.messagesList.scrollTop = DOM.messagesList.scrollHeight;
}

// ============================================================================
// Уведомления
// ============================================================================
function playNotificationSound() {
    if (!soundEnabled || !DOM.notificationSound) return;
    try { DOM.notificationSound.currentTime = 0; DOM.notificationSound.play().catch(e => console.warn('Sound play error:', e)); }
    catch (e) { console.error('Play sound error:', e); }
}

function showBrowserNotification(data) {
    if (!data?.sender || !('Notification' in window) || (!window.isSecureContext && location.hostname !== 'localhost')) return;
    if (Notification.permission === 'granted') {
        try {
            const n = new Notification(data.groupName ? `👥 ${data.groupName}` : 'Новое сообщение', {
                body: `${data.sender}: ${data.text?.substring(0, 100) || ''}`,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💬</text></svg>',
                tag: `message-${data.sender}-${Date.now()}`, requireInteraction: false
            });
            setTimeout(() => n.close(), 5000); n.onclick = () => { window.focus(); n.close(); };
        } catch (e) { console.error('Notification error:', e); }
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => { if (p === 'granted') showBrowserNotification(data); }).catch(e => console.warn('Permission error:', e));
    }
}

function initSettings() {
    const settingsBtn = document.getElementById('footerSettingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const settingsModal = document.getElementById('settingsModal');
    const logoutBtn = document.getElementById('logoutBtn');
    
    settingsBtn?.addEventListener('click', () => { settingsModal?.classList.remove('hidden'); syncSettingsUI(); });
    closeSettings?.addEventListener('click', () => settingsModal?.classList.add('hidden'));
    settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
    logoutBtn?.addEventListener('click', performLogout);
    
    const aboutBtn = document.getElementById('aboutDeveloperSettingsBtn');
    const aboutModal = document.getElementById('aboutDeveloperModal');
    const closeAbout = document.getElementById('closeAboutDeveloper');
    if (aboutBtn && aboutModal) {
        aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
        closeAbout?.addEventListener('click', () => aboutModal.classList.add('hidden'));
        aboutModal.addEventListener('click', e => { if (e.target === aboutModal) aboutModal.classList.add('hidden'); });
    }
    
    DOM.fontSizeSelect?.addEventListener('change', e => {
        const size = e.target.value;
        document.body.classList.remove('font-small', 'font-medium', 'font-large');
        document.body.classList.add('font-' + (size === '12' ? 'small' : size === '16' ? 'large' : 'medium'));
        saveSettings();
    });
    DOM.themeSelect?.addEventListener('change', e => { document.documentElement.setAttribute('data-theme', e.target.value); saveSettings(); });
    DOM.accentColorSelect?.addEventListener('change', e => {
        const color = e.target.value;
        document.documentElement.style.setProperty('--accent', color);
        document.documentElement.style.setProperty('--accent-hover', adjustColorBrightness(color, 20));
        saveSettings();
    });
    DOM.messageColorSelect?.addEventListener('change', e => { document.documentElement.style.setProperty('--own-message-bg', e.target.value); saveSettings(); });
    
    DOM.showInDirectory?.addEventListener('change', e => {
        isVisibleInDirectory = e.target.checked; saveSettings();
        sendToServer({ type: 'update_visibility', isVisible: isVisibleInDirectory });
        showToast(isVisibleInDirectory ? 'Вы отображаетесь в списке' : 'Вы скрыты из списка', false);
    });
    DOM.allowGroupInvite?.addEventListener('change', e => {
        allowGroupInvite = e.target.checked; saveSettings();
        sendToServer({ type: 'update_group_invite_permission', allow: allowGroupInvite });
        showToast(allowGroupInvite ? 'Разрешено добавлять в группы' : 'Запрещено добавлять в группы', false);
    });
    
    document.getElementById('closeCreateGroup')?.addEventListener('click', () => DOM.createGroupModal?.classList.add('hidden'));
    DOM.createGroupModal?.addEventListener('click', e => { if (e.target === DOM.createGroupModal) DOM.createGroupModal.classList.add('hidden'); });
    DOM.createGroupConfirmBtn?.addEventListener('click', createGroup);
    
    initTwoFactor();
}

// ============================================================================
// 2FA
// ============================================================================
let twoFactorState = { enabled: false, secret: '', backupCodes: [], isSettingUp: false, sessionId: null };

function initTwoFactor() {
    const twoFactorBtn = document.getElementById('twoFactorBtn');
    const twoFactorModal = document.getElementById('twoFactorModal');
    const closeTwoFactor = document.getElementById('closeTwoFactor');
    const enableBtn = document.getElementById('enableTwoFactorBtn');
    const codeInput = document.getElementById('twoFactorCodeInput');
    const copyBtn = document.getElementById('copySecretBtn');
    const downloadBtn = document.getElementById('downloadBackupCodesBtn');
    const closeAfterSetup = document.getElementById('closeTwoFactorAfterSetup');
    const disableBtn = document.getElementById('disableTwoFactorBtn');
    const cancelDisable = document.getElementById('cancelDisableTwoFactor');
    const disableCodeInput = document.getElementById('disableTwoFactorCodeInput');
    
    twoFactorBtn?.addEventListener('click', () => {
        if (twoFactorState.enabled) showTwoFactorStep(3); else setupTwoFactor();
        twoFactorModal?.classList.remove('hidden');
    });
    closeTwoFactor?.addEventListener('click', () => { twoFactorModal?.classList.add('hidden'); showTwoFactorMessage(''); });
    twoFactorModal?.addEventListener('click', e => { if (e.target === twoFactorModal) twoFactorModal.classList.add('hidden'); });
    enableBtn?.addEventListener('click', enableTwoFactor);
    codeInput?.addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
    codeInput?.addEventListener('keydown', e => { if (e.key === 'Enter') enableTwoFactor(); });
    copyBtn?.addEventListener('click', () => {
        const secret = document.getElementById('twoFactorSecret')?.textContent;
        if (secret && secret !== '---') navigator.clipboard.writeText(secret).then(() => showTwoFactorMessage('Секрет скопирован', false));
    });
    downloadBtn?.addEventListener('click', downloadBackupCodes);
    closeAfterSetup?.addEventListener('click', () => { twoFactorModal?.classList.add('hidden'); updateTwoFactorUI(); });
    disableBtn?.addEventListener('click', disableTwoFactor);
    cancelDisable?.addEventListener('click', () => showTwoFactorStep(1));
    disableCodeInput?.addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
    disableCodeInput?.addEventListener('keydown', e => { if (e.key === 'Enter') disableTwoFactor(); });
}

function showTwoFactorStep(step) {
    [1, 2, 3].forEach(s => { const el = document.getElementById('twoFactorStep' + s); if (el) el.classList.toggle('hidden', s !== step); });
    showTwoFactorMessage('');
}

function showTwoFactorMessage(message, isError = true) {
    const el = document.getElementById('twoFactorMessage');
    if (!el) return;
    el.textContent = message; el.style.color = isError ? 'var(--error)' : 'var(--success)';
    if (message) setTimeout(() => { el.textContent = ''; }, 5000);
}

function setupTwoFactor() { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'setup_2fa' })); }
function enableTwoFactor() {
    const code = document.getElementById('twoFactorCodeInput')?.value;
    if (!code) { showTwoFactorMessage('Введите код', true); return; }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'enable_2fa', code }));
}
function disableTwoFactor() {
    const code = document.getElementById('disableTwoFactorCodeInput')?.value;
    if (!code) { showTwoFactorMessage('Введите код', true); return; }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'disable_2fa', code }));
}

function downloadBackupCodes() {
    if (!twoFactorState.backupCodes.length) return;
    const content = 'Резервные коды 2FA:\n\n' + twoFactorState.backupCodes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '2fa-backup-codes.txt'; a.click();
    URL.revokeObjectURL(url);
}

function updateTwoFactorUI() {
    const btn = document.getElementById('twoFactorBtn');
    const status = document.getElementById('twoFactorStatus');
    if (btn) btn.textContent = twoFactorState.enabled ? 'Отключить 2FA' : 'Включить 2FA';
    if (status) status.classList.toggle('hidden', !twoFactorState.enabled);
}

function handleTwoFAMessage(data) {
    switch (data.type) {
        case '2fa_setup_response':
            if (data.secret && data.backupCodes) {
                twoFactorState.secret = data.secret; twoFactorState.backupCodes = data.backupCodes;
                showTwoFactorStep(2);
                const secretEl = document.getElementById('twoFactorSecret');
                if (secretEl) secretEl.textContent = data.secret;
            } break;
        case '2fa_enabled':
            twoFactorState.enabled = true; showTwoFactorMessage('2FA включён', false);
            setTimeout(() => { document.getElementById('twoFactorModal')?.classList.add('hidden'); }, 2000); updateTwoFactorUI(); break;
        case '2fa_disabled':
            twoFactorState.enabled = false; twoFactorState.secret = ''; twoFactorState.backupCodes = [];
            showTwoFactorMessage('2FA отключён', false);
            setTimeout(() => { document.getElementById('twoFactorModal')?.classList.add('hidden'); }, 2000); updateTwoFactorUI(); break;
        case '2fa_error':
        case '2fa_verify_error':
            showTwoFactorMessage(data.message || 'Ошибка 2FA', true); break;
        case '2fa_backup_codes_response':
            if (data.backupCodes) { twoFactorState.backupCodes = data.backupCodes; downloadBackupCodes(); } break;
    }
}

function handleLogin2FARequired(data) { if (data.sessionId) { twoFactorState.sessionId = data.sessionId; showLogin2FAForm(); } }
function showLogin2FAForm() {
    const loginForm = document.getElementById('loginTab');
    const login2FAForm = document.getElementById('login2FAForm');
    if (loginForm && login2FAForm) { loginForm.classList.add('hidden'); login2FAForm.classList.remove('hidden'); }
}
function submitLogin2FA() {
    const code = document.getElementById('login2FACodeInput')?.value;
    const sessionId = twoFactorState.sessionId;
    if (!code || !sessionId) { showLogin2FAError('Введите код', true); return; }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'verify_2fa_login', code, sessionId }));
}
function cancelLogin2FA() {
    const loginForm = document.getElementById('loginTab');
    const login2FAForm = document.getElementById('login2FAForm');
    if (loginForm && login2FAForm) { loginForm.classList.remove('hidden'); login2FAForm.classList.add('hidden'); }
    document.getElementById('login2FACodeInput') && (document.getElementById('login2FACodeInput').value = '');
    twoFactorState.sessionId = null;
}
function handleLogin2FASuccess(data) { handleLoginSuccess(data); }
function handleLogin2FAError(message) {
    const el = document.getElementById('login2FAStatus');
    if (el) { el.textContent = message || 'Ошибка 2FA'; el.style.color = 'var(--error)'; setTimeout(() => { el.textContent = ''; }, 5000); }
}

// Экспорт для sidebar-component.js
window.updateFooterProfile = updateFooterProfile;
window.updateChatTitleWithBadges = updateChatTitleWithBadges;
