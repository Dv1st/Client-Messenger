/**
 * Client Messenger - Серверная часть
 * @version 2.0.0
 * @description Оптимизированная версия с улучшенной безопасностью
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

// ============================================================================
// 🔹 Константы
// ============================================================================
const PORT = process.env.PORT || 3000;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 минут
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 минута
const RATE_LIMIT_MAX = 10;
const MESSAGE_MAX_LENGTH = 10000;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;

// ============================================================================
// 🔒 Security Headers
// ============================================================================
const CSP_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

const ALLOWED_ORIGINS = [
    'http://localhost:8000',
    'http://localhost:3000',
    'http://localhost:5500',
    'https://dv1st.github.io',
    'https://client-messenger-production.up.railway.app'
];

// ============================================================================
// 🔹 Хранилища данных
// ============================================================================
const users = new Map(); // username → {passwordHash, salt, createdAt, lastLogin, isVisibleInDirectory, status, activeChat, devices}
const sessions = new Map(); // tokenId → {username, deviceId, ws, createdAt, lastActivity}
const wsToToken = new Map(); // WebSocket → tokenId
const rateLimitMap = new Map(); // ip → {count, resetTime}

// ============================================================================
// 🔹 HTTP Сервер
// ============================================================================
const server = http.createServer((req, res) => {
    // Security headers
    Object.entries(CSP_HEADERS).forEach(([key, value]) => {
        res.setHeader(key, value);
    });

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now(), version: '2.0.0' }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

// ============================================================================
// 🔹 WebSocket Сервер
// ============================================================================
const wss = new WebSocket.Server({
    server,
    verifyClient: (info, callback) => {
        const origin = info.origin || info.req.headers.origin;
        if (process.env.NODE_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
            console.warn(`🚫 Blocked origin: ${origin}`);
            return callback(false, 403);
        }
        callback(true);
    }
});

// ============================================================================
// 🔒 Rate Limiting
// ============================================================================
function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX) return false;
    record.count++;
    return true;
}

// ============================================================================
// 🔹 Утилиты
// ============================================================================
function getClientIp(ws) {
    return ws._socket?.remoteAddress || 'unknown';
}

function broadcast(msg, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
        }
    });
}

function broadcastUserList() {
    const userList = Array.from(users.entries())
        .filter(([_, user]) => user.devices.size > 0 && user.isVisibleInDirectory !== false)
        .map(([name, user]) => ({
            username: name,
            name: name,
            status: user.status,
            online: user.status === 'online',
            activeChat: user.activeChat,
            isVisibleInDirectory: user.isVisibleInDirectory !== false,
            lastLogin: user.lastLogin
        }));

    broadcast({ type: 'user_list', users: userList });
}

// ============================================================================
// 🔐 Криптография
// ============================================================================
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt() {
    return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ============================================================================
// 🕒 Очистка сессий
// ============================================================================
function cleanupSessions() {
    const now = Date.now();

    // Истёкшие сессии
    for (const [tokenId, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TIMEOUT) {
            console.log(`🕒 Session expired: ${session.username}`);
            
            // Сначала удаляем из wsToToken
            const ws = session.ws;
            wsToToken.delete(ws);
            
            sessions.delete(tokenId);

            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'session_expired', message: 'Сессия истекла' }));
                ws.close(4001, 'Session expired');
            }
        }
    }

    // Offline пользователи
    for (const [username, user] of users.entries()) {
        if (user.status !== 'offline' && user.devices.size === 0) {
            user.status = 'offline';
            user.activeChat = null;
            broadcast({
                type: 'user_status_update',
                username,
                status: 'offline',
                activeChat: null
            });
        }
    }
}

setInterval(cleanupSessions, 5 * 60 * 1000);

// ============================================================================
// 🔐 Авторизация
// ============================================================================
function handleRegister(ws, { username, password }, clientIp) {
    if (!checkRateLimit(clientIp)) {
        return ws.send(JSON.stringify({ type: 'register_error', message: 'Слишком много попыток. Подождите.' }));
    }

    // Валидация
    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
        return ws.send(JSON.stringify({ type: 'register_error', message: 'Неверные данные' }));
    }

    username = username.trim();

    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
        return ws.send(JSON.stringify({ type: 'register_error', message: `Имя: ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} символов` }));
    }

    if (password.length < 4 || password.length > 100) {
        return ws.send(JSON.stringify({ type: 'register_error', message: 'Пароль: 4-100 символов' }));
    }

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return ws.send(JSON.stringify({ type: 'register_error', message: 'Имя: только латиница, цифры, _' }));
    }

    if (users.has(username)) {
        return ws.send(JSON.stringify({ type: 'register_error', message: 'Пользователь уже существует' }));
    }

    // Создание пользователя
    try {
        const salt = generateSalt();
        users.set(username, {
            passwordHash: hashPassword(password, salt),
            salt,
            createdAt: Date.now(),
            lastLogin: null,
            isVisibleInDirectory: false,
            status: 'offline',
            activeChat: null,
            devices: new Map()
        });

        console.log(`✅ Registered: ${username} from ${clientIp}`);
        ws.send(JSON.stringify({ type: 'register_success', message: 'Регистрация успешна! Теперь войдите.' }));
    } catch (e) {
        console.error('❌ Register error:', e);
        ws.send(JSON.stringify({ type: 'register_error', message: 'Ошибка при регистрации' }));
    }
}

function handleLogin(ws, { username, password }, clientIp) {
    if (!checkRateLimit(clientIp)) {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Слишком много попыток. Подождите.' }));
    }

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверные данные' }));
    }

    username = username.trim();
    const user = users.get(username);

    // 🔒 Защита от перебора: одинаковое сообщение для несуществующего и неверного пароля
    if (!user) {
        console.log(`🚫 Login attempt for non-existent: ${username} from ${clientIp}`);
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный логин или пароль' }));
    }

    try {
        const passwordHash = hashPassword(password, user.salt);
        if (passwordHash !== user.passwordHash) {
            console.log(`🚫 Wrong password: ${username} from ${clientIp}`);
            return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный логин или пароль' }));
        }
    } catch (e) {
        console.error('❌ Hash error:', e);
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Ошибка авторизации' }));
    }

    // Создание сессии
    try {
        const tokenId = generateToken();
        const deviceId = 'device_' + crypto.randomBytes(8).toString('hex');

        const session = {
            username,
            deviceId,
            ws,
            createdAt: Date.now(),
            lastActivity: Date.now()
        };

        sessions.set(tokenId, session);
        wsToToken.set(ws, tokenId);
        user.devices.set(deviceId, { ws, lastActivity: Date.now() });
        user.lastLogin = Date.now();
        user.status = 'online';

        console.log(`✅ Logged in: ${username} (${deviceId}) from ${clientIp}`);

        ws.send(JSON.stringify({
            type: 'login_success',
            username,
            deviceId,
            token: tokenId,
            isVisibleInDirectory: user.isVisibleInDirectory,
            message: 'Вход выполнен успешно'
        }));

        broadcastUserList();
    } catch (e) {
        console.error('❌ Login error:', e);
        ws.send(JSON.stringify({ type: 'login_error', message: 'Ошибка при входе' }));
    }
}

function handleLogout(ws, tokenId, isDisconnect = false) {
    try {
        const session = sessions.get(tokenId);
        if (!session) return;

        const user = users.get(session.username);
        if (user) {
            user.devices.delete(session.deviceId);
            if (user.devices.size === 0) {
                user.status = 'offline';
                user.activeChat = null;
                broadcast({
                    type: 'user_status_update',
                    username: session.username,
                    status: 'offline',
                    activeChat: null
                });
            }
        }

        // Сначала удаляем из wsToToken
        wsToToken.delete(ws);
        sessions.delete(tokenId);

        console.log(`🚪 Logged out: ${session.username}${isDisconnect ? ' (disconnect)' : ''}`);
        broadcastUserList();
    } catch (e) {
        console.error('❌ Logout error:', e);
    }
}

// ============================================================================
// 💬 Сообщения
// ============================================================================
function handleMessage(ws, sender, { text, privateTo, timestamp, encrypted, hint, replyTo }) {
    if (!text || typeof text !== 'string') {
        return ws.send(JSON.stringify({ type: 'error', message: 'Неверное сообщение' }));
    }

    const trimmedText = text.substring(0, MESSAGE_MAX_LENGTH);

    // XSS защита - более строгая проверка
    if (trimmedText.includes('<script') || trimmedText.includes('javascript:') || trimmedText.includes('onerror=')) {
        console.warn(`🚫 XSS attempt from ${sender}`);
        return ws.send(JSON.stringify({ type: 'error', message: 'Недопустимое содержимое' }));
    }

    const user = users.get(sender);
    if (user) {
        const oldActiveChat = user.activeChat;
        user.activeChat = privateTo || null;
        user.status = 'online';

        // ✨ ИЗМЕНЕНО: Обновляем статус и рассылаем если чат изменился
        if (privateTo !== oldActiveChat) {
            broadcast({
                type: 'user_status_update',
                username: sender,
                status: privateTo ? 'in_chat' : 'online',
                activeChat: privateTo || null
            });
        }
    }

    const message = {
        type: 'receive_message',
        sender,
        text: trimmedText,
        timestamp: timestamp || Date.now(),
        encrypted: encrypted || false,
        hint: hint || null,
        replyTo: replyTo || null
    };

    try {
        if (privateTo && typeof privateTo === 'string') {
            if (privateTo.length > USERNAME_MAX_LENGTH) {
                return ws.send(JSON.stringify({ type: 'error', message: 'Неверное имя получателя' }));
            }

            message.privateTo = privateTo;
            const recipient = users.get(privateTo);

            if (recipient) {
                for (const [_, device] of recipient.devices.entries()) {
                    if (device.ws?.readyState === WebSocket.OPEN) {
                        device.ws.send(JSON.stringify(message));
                    }
                }
            }

            // ✨ ИЗМЕНЕНО: Отправляем подтверждение доставки отправителю
            ws.send(JSON.stringify({
                type: 'message_confirmed',
                timestamp: message.timestamp,
                confirmed: true
            }));
        } else {
            broadcast(message, ws);
        }
    } catch (e) {
        console.error('❌ SendMessage error:', e);
        ws.send(JSON.stringify({ type: 'error', message: 'Ошибка при отправке сообщения' }));
    }
}

function handleTyping(ws, from, { to, isTyping }) {
    if (!to || typeof to !== 'string') return;

    const recipient = users.get(to);
    if (recipient) {
        for (const [_, device] of recipient.devices.entries()) {
            if (device.ws?.readyState === WebSocket.OPEN) {
                device.ws.send(JSON.stringify({ type: 'typing', from, isTyping }));
            }
        }
    }
}

function handleGetHistory(ws, username, { chatName }) {
    ws.send(JSON.stringify({ type: 'history', messages: [], chatName: chatName || 'general' }));
}

function handleDeleteChat(ws, username, { chatName }) {
    ws.send(JSON.stringify({ type: 'chat_deleted', chatName, message: 'Чат удалён локально' }));
}

// ✨ ИЗМЕНЕНО: Обработка подтверждения прочтения сообщений
function handleMessageRead(ws, sender, { from, timestamp }) {
    const recipient = users.get(from);
    if (!recipient) return;

    // Отправляем подтверждение прочтения отправителю
    for (const [_, device] of recipient.devices.entries()) {
        if (device.ws?.readyState === WebSocket.OPEN) {
            device.ws.send(JSON.stringify({
                type: 'message_read_receipt',
                from: sender,
                timestamp: timestamp
            }));
        }
    }
}

// ✨ ИЗМЕНЕНО: Обработка удаления сообщения
function handleDeleteMessage(ws, sender, { timestamp, chatWith }) {
    if (!timestamp) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Неверный timestamp' }));
    }

    // Рассылаем всем пользователям в чате сообщение об удалении
    const deleteMessage = {
        type: 'message_deleted',
        timestamp: timestamp,
        deletedBy: sender
    };

    if (chatWith) {
        // Приватное сообщение - отправляем собеседнику
        const recipient = users.get(chatWith);
        if (recipient) {
            for (const [_, device] of recipient.devices.entries()) {
                if (device.ws?.readyState === WebSocket.OPEN) {
                    device.ws.send(JSON.stringify(deleteMessage));
                }
            }
        }
    } else {
        // Общее сообщение - рассылаем всем кроме отправителя
        broadcast(deleteMessage, ws);
    }

    console.log(`🗑️ Message deleted by ${sender}: ${timestamp}`);
}

/**
 * ✨ Обработка реакции на сообщение
 */
function handleMessageReaction(ws, sender, { timestamp, reaction, add, privateTo, reactionTimestamp }) {
    if (!timestamp || !reaction) return;

    // Рассылаем информацию о реакции всем в чате
    const reactionMessage = {
        type: 'message_reaction',
        timestamp: timestamp,
        reaction: reaction,
        user: sender,
        add: add !== false, // По умолчанию true
        reactionTimestamp: reactionTimestamp || Date.now()
    };

    if (privateTo) {
        // Приватное сообщение
        const recipient = users.get(privateTo);
        if (recipient) {
            for (const [_, device] of recipient.devices.entries()) {
                if (device.ws?.readyState === WebSocket.OPEN) {
                    device.ws.send(JSON.stringify(reactionMessage));
                }
            }
        }
        // Отправляем подтверждение отправителю реакции
        ws.send(JSON.stringify(reactionMessage));
    } else {
        // Общее сообщение - рассылаем всем
        broadcast(reactionMessage);
    }

    console.log(`😊 Reaction ${reaction} by ${sender} on ${timestamp}`);
}

function handleUpdateVisibility(ws, username, { isVisible }) {
    const user = users.get(username);
    if (!user) return;

    user.isVisibleInDirectory = typeof isVisible === 'boolean' ? isVisible : true;

    ws.send(JSON.stringify({
        type: 'visibility_updated',
        isVisible: user.isVisibleInDirectory
    }));

    broadcastUserList();
}

// ✨ ИЗМЕНЕНО: Обработка открытия чата
function handleChatOpen(ws, username, { chatWith }) {
    const user = users.get(username);
    if (!user) return;
    
    const oldActiveChat = user.activeChat;
    user.activeChat = chatWith || null;
    
    // Рассылаем обновление только если чат изменился
    if (chatWith !== oldActiveChat) {
        broadcast({
            type: 'user_status_update',
            username,
            status: chatWith ? 'in_chat' : 'online',
            activeChat: chatWith || null
        });
    }
}

// ============================================================================
// 🔹 WebSocket Обработчики
// ============================================================================
wss.on('connection', (ws, req) => {
    const clientIp = getClientIp(ws);
    console.log(`🔗 New connection from ${clientIp}`);

    if (!checkRateLimit(clientIp)) {
        console.warn(`🚫 Rate limit exceeded: ${clientIp}`);
        ws.send(JSON.stringify({ type: 'error', message: 'Слишком много попыток. Подождите минуту.' }));
        ws.close(4029, 'Too many requests');
        return;
    }

    ws.isAlive = true;
    ws.pingInterval = setInterval(() => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        const tokenId = wsToToken.get(ws);
        if (tokenId) {
            const session = sessions.get(tokenId);
            if (session) session.lastActivity = Date.now();
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Неверный формат данных' }));
        }

        if (!data.type || typeof data.type !== 'string') {
            return ws.send(JSON.stringify({ type: 'error', message: 'Неверный тип сообщения' }));
        }

        const session = tokenId ? sessions.get(tokenId) : null;
        const username = session?.username;

        switch (data.type) {
            case 'register': handleRegister(ws, data, clientIp); break;
            case 'login': handleLogin(ws, data, clientIp); break;
            case 'logout':
                if (!session) return ws.send(JSON.stringify({ type: 'error', message: 'Не авторизован' }));
                handleLogout(ws, tokenId);
                break;
            case 'send_message':
                if (!session) return ws.send(JSON.stringify({ type: 'error', message: 'Требуется авторизация' }));
                handleMessage(ws, username, data);
                break;
            case 'typing':
                if (session) handleTyping(ws, username, data);
                break;
            case 'get_users':
                if (session) broadcastUserList();
                break;
            case 'update_visibility':
                if (session) handleUpdateVisibility(ws, username, data);
                break;
            case 'get_history':
                if (session) handleGetHistory(ws, username, data);
                break;
            case 'delete_chat':
                if (session) handleDeleteChat(ws, username, data);
                break;
            // ✨ ИЗМЕНЕНО: Обработка подтверждения прочтения
            case 'message_read':
                if (session) handleMessageRead(ws, username, data);
                break;
            // ✨ ИЗМЕНЕНО: Обработка удаления сообщения
            case 'delete_message':
                if (session) handleDeleteMessage(ws, username, data);
                break;
            // ✨ Обработка реакции на сообщение
            case 'message_reaction':
                if (session) handleMessageReaction(ws, username, data);
                break;
            // ✨ ИЗМЕНЕНО: Обработка открытия чата
            case 'chat_open':
                if (session) handleChatOpen(ws, username, data);
                break;
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
            default:
                console.warn('⚠️ Unknown type:', data.type);
                ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип сообщения' }));
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`🔌 Connection closed: ${code} ${reason || ''}`);
        if (ws.pingInterval) clearInterval(ws.pingInterval);
        
        // Сначала получаем tokenId и удаляем сессию
        const tokenId = wsToToken.get(ws);
        if (tokenId) {
            handleLogout(ws, tokenId, true);
        }
    });

    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
        if (ws.pingInterval) clearInterval(ws.pingInterval);
    });
});

// ============================================================================
// 🚀 Запуск сервера
// ============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server v2.0.0 running on port ${PORT}`);
    console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
    console.log(`🔒 Session timeout: ${SESSION_TIMEOUT / 60000} min`);
    console.log(`🔒 Rate limit: ${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW / 1000}s`);
    console.log(`\n⚠️  Production: Use WSS and configure allowedOrigins!\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');

    for (const ws of wss.clients) {
        ws.send(JSON.stringify({ type: 'server_shutdown', message: 'Сервер перезагружается' }));
        ws.close(1001, 'Server shutdown');
    }

    wss.close();
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received');
    process.exit(0);
});
