// server/server.js
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 минут
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 минута
const RATE_LIMIT_MAX = 10; // 10 попыток в минуту

const server = http.createServer((req, res) => {
  // CORS headers
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
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocket.Server({ 
  server,
  // 🔒 Проверка origin в продакшене!
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    // В продакшене замените на ваш домен
    const allowedOrigins = [
      'http://localhost:8000',
      'http://localhost:3000',
      'https://dv1st.github.io',
      'https://client-messenger-production.up.railway.app'
    ];
    
    if (process.env.NODE_ENV === 'production' && !allowedOrigins.includes(origin)) {
      console.warn(`🚫 Blocked origin: ${origin}`);
      return callback(false, 403);
    }
    callback(true);
  }
});

// Хранилище пользователей: username → {passwordHash, salt, createdAt, lastLogin}
const users = new Map();
// Сессии: tokenId → {username, deviceId, ws, createdAt, lastActivity}
const sessions = new Map();
// WebSocket → tokenId
const wsToToken = new Map();
// Rate limiting: ip → {count, resetTime}
const rateLimitMap = new Map();

// 🔐 Хеширование пароля (PBKDF2)
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientIp(ws) {
  return ws._socket?.remoteAddress || 'unknown';
}

// 🔒 Rate limiting
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  record.count++;
  return true;
}

// 🔒 Очистка неактивных сессий
function cleanupSessions() {
  const now = Date.now();
  for (const [tokenId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      console.log(`🕒 Session expired: ${session.username}`);
      sessions.delete(tokenId);
      const ws = session.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'session_expired', message: 'Сессия истекла' }));
        ws.close(4001, 'Session expired');
      }
    }
  }
}

setInterval(cleanupSessions, 5 * 60 * 1000); // Каждые 5 минут

wss.on('connection', (ws, req) => {
  const clientIp = getClientIp(ws);
  console.log(`🔗 New connection from ${clientIp}`);

  // 🔒 Проверка rate limit при подключении
  if (!checkRateLimit(clientIp)) {
    console.warn(`🚫 Rate limit exceeded for ${clientIp}`);
    ws.send(JSON.stringify({ type: 'error', message: 'Слишком много попыток. Подождите минуту.' }));
    ws.close(4029, 'Too many requests');
    return;
  }

  ws.isAlive = true;
  ws.pingInterval = setInterval(() => {
    if (!ws.isAlive) {
      console.log('🔌 Dead connection detected');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  }, 30000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    // Обновляем активность сессии
    const tokenId = wsToToken.get(ws);
    if (tokenId) {
      const session = sessions.get(tokenId);
      if (session) session.lastActivity = Date.now();
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('❌ JSON parse error:', e);
      return ws.send(JSON.stringify({ type: 'error', message: 'Неверный формат данных' }));
    }

    // 🔒 Валидация типа сообщения
    if (!data.type || typeof data.type !== 'string') {
      return ws.send(JSON.stringify({ type: 'error', message: 'Неверный тип сообщения' }));
    }

    const session = tokenId ? sessions.get(tokenId) : null;
    const username = session?.username;

    switch (data.type) {
      case 'register':
        // Регистрация не требует авторизации
        handleRegister(ws, data, clientIp);
        break;
      case 'login':
        // Вход не требует авторизации
        handleLogin(ws, data, clientIp);
        break;
      case 'logout':
        if (!session) return ws.send(JSON.stringify({ type: 'error', message: 'Не авторизован' }));
        handleLogout(ws, tokenId);
        break;
      case 'send_message':
        if (!session) return ws.send(JSON.stringify({ type: 'error', message: 'Требуется авторизация' }));
        handleMessage(ws, username, data);
        break;
      case 'typing':
        if (!session) return;
        handleTyping(ws, username, data);
        break;
      case 'get_users':
        if (!session) return;
        broadcastUserList();
        break;
      case 'get_history':
        if (!session) return;
        handleGetHistory(ws, username, data);
        break;
      case 'delete_chat':
        if (!session) return;
        handleDeleteChat(ws, username, data);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        console.warn('⚠️ Unknown message type:', data.type);
        ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип сообщения' }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 Connection closed: ${code} ${reason || ''}`);
    if (ws.pingInterval) clearInterval(ws.pingInterval);
    
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
// 🔐 Авторизация
// ============================================================================
function handleRegister(ws, { username, password }, clientIp) {
  // 🔒 Rate limit
  if (!checkRateLimit(clientIp)) {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Слишком много попыток. Подождите.' }));
  }

  // 🔒 Валидация
  const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
  
  if (!username || typeof username !== 'string') {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Неверное имя пользователя' }));
  }
  if (!password || typeof password !== 'string') {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Неверный пароль' }));
  }

  username = username.trim();
  
  if (!USERNAME_REGEX.test(username)) {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Имя: 3-20 символов, только латиница, цифры, _' }));
  }
  if (password.length < 4 || password.length > 100) {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Пароль: 4-100 символов' }));
  }
  if (users.has(username)) {
    return ws.send(JSON.stringify({ type: 'register_error', message: 'Пользователь уже существует' }));
  }

  // 🔐 Хеширование пароля
  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);

  users.set(username, {
    passwordHash,
    salt,
    createdAt: Date.now(),
    lastLogin: null,
    status: 'offline',
    devices: new Map() // deviceId → {ws, lastActivity}
  });

  console.log(`✅ Registered: ${username} from ${clientIp}`);
  ws.send(JSON.stringify({ 
    type: 'register_success', 
    message: 'Регистрация успешна! Теперь войдите.' 
  }));
}

function handleLogin(ws, { username, password, deviceId }, clientIp) {
  // 🔒 Rate limit
  if (!checkRateLimit(clientIp)) {
    return ws.send(JSON.stringify({ type: 'login_error', message: 'Слишком много попыток. Подождите.' }));
  }

  // 🔒 Валидация
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверные данные' }));
  }

  username = username.trim();
  const user = users.get(username);

  if (!user) {
    // 🔒 Не говорим, существует ли пользователь (защита от перебора)
    console.log(`🚫 Login attempt for non-existent user: ${username} from ${clientIp}`);
    return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный логин или пароль' }));
  }

  // 🔐 Проверка пароля
  const passwordHash = hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    console.log(`🚫 Wrong password for: ${username} from ${clientIp}`);
    return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный логин или пароль' }));
  }

  // 🔐 Создаём сессию
  const tokenId = generateToken();
  const deviceIdUnique = deviceId || 'device_' + crypto.randomBytes(8).toString('hex');

  const session = {
    username,
    deviceId: deviceIdUnique,
    ws,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  sessions.set(tokenId, session);
  wsToToken.set(ws, tokenId);

  // Обновляем устройство пользователя
  user.devices.set(deviceIdUnique, { ws, lastActivity: Date.now() });
  user.lastLogin = Date.now();
  user.status = 'online';

  console.log(`✅ Logged in: ${username} (${deviceIdUnique}) from ${clientIp}`);

  // 🔐 Отправляем токен (НЕ пароль!)
  ws.send(JSON.stringify({ 
    type: 'login_success', 
    username, 
    deviceId: deviceIdUnique,
    token: tokenId, // 🔑 Токен сессии
    message: 'Вход выполнен успешно'
  }));

  broadcastUserList();
}

function handleLogout(ws, tokenId, isDisconnect = false) {
  const session = sessions.get(tokenId);
  if (!session) return;

  const user = users.get(session.username);
  if (user) {
    user.devices.delete(session.deviceId);
    if (user.devices.size === 0) {
      user.status = 'offline';
    }
  }

  sessions.delete(tokenId);
  wsToToken.delete(ws);

  console.log(`🚪 Logged out: ${session.username}${isDisconnect ? ' (disconnect)' : ''}`);
  broadcastUserList();
}

// ============================================================================
// 💬 Сообщения
// ============================================================================
function handleMessage(ws, sender, { text, privateTo, timestamp, encrypted, hint }) {
  // 🔒 Валидация
  if (!text || typeof text !== 'string' || text.length > 10000) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Неверное сообщение' }));
  }

  const message = {
    type: 'receive_message',
    sender,
    text: text.substring(0, 10000), // 🔒 Обрезаем длинные сообщения
    timestamp: timestamp || Date.now(),
    encrypted: encrypted || false,
    hint: hint || null
  };

  if (privateTo && typeof privateTo === 'string') {
    message.privateTo = privateTo;
    const recipient = users.get(privateTo);
    
    if (recipient) {
      for (const [_, device] of recipient.devices.entries()) {
        if (device.ws?.readyState === WebSocket.OPEN) {
          device.ws.send(JSON.stringify(message));
        }
      }
    }
    // Подтверждение отправителю
    ws.send(JSON.stringify({ ...message, confirmed: true }));
  } else {
    broadcast(message, ws);
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
  // 🔒 В этой версии история не хранится на сервере
  ws.send(JSON.stringify({ type: 'history', messages: [], chatName: chatName || 'general' }));
}

function handleDeleteChat(ws, username, { chatName }) {
  ws.send(JSON.stringify({ type: 'chat_deleted', chatName, message: 'Чат удалён локально' }));
}

// ============================================================================
// 📡 Утилиты
// ============================================================================
function broadcast(msg, excludeWs = null) {
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

function broadcastUserList() {
  const userList = Array.from(users.entries())
    .filter(([_, user]) => user.devices.size > 0)
    .map(([name, user]) => ({
      username: name,
      name: name,
      status: user.status,
      online: user.status === 'online',
      lastLogin: user.lastLogin
    }));

  broadcast({ type: 'user_list', users: userList });
}

// ============================================================================
// 🚀 Запуск сервера
// ============================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
  console.log(`🔒 Session timeout: ${SESSION_TIMEOUT / 1000 / 60} minutes`);
  console.log(`🔒 Rate limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW / 1000} seconds`);
  console.log(`\n⚠️  В продакшене используйте WSS (HTTPS) и настройте allowedOrigins!`);
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
