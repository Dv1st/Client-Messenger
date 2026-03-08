/**
 * Client Messenger - Серверная часть
 * @version 2.0.0
 * @description Оптимизированная версия с улучшенной безопасностью и базой данных
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ============================================================================
// 🔹 Инициализация базы данных
// ============================================================================
const DB_PATH = path.join(__dirname, 'messenger.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Database error:', err);
    } else {
        console.log('💾 Connected to SQLite database');
    }
});

/**
 * Инициализация таблиц БД (асинхронная)
 * @returns {Promise<void>}
 */
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Таблица пользователей
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    passwordHash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    createdAt INTEGER,
                    lastLogin INTEGER,
                    isVisibleInDirectory INTEGER DEFAULT 0,
                    allowGroupInvite INTEGER DEFAULT 0,
                    twoFactorSecret TEXT,
                    twoFactorEnabled INTEGER DEFAULT 0,
                    twoFactorBackupCodes TEXT
                )
            `);

            // Таблица групп
            db.run(`
                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    creator TEXT NOT NULL,
                    createdAt INTEGER,
                    lastMessage INTEGER
                )
            `);

            // Таблица участников групп
            db.run(`
                CREATE TABLE IF NOT EXISTS group_members (
                    groupId TEXT NOT NULL,
                    username TEXT NOT NULL,
                    PRIMARY KEY (groupId, username),
                    FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
                    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                )
            `);

            console.log('✅ Database tables initialized');
            resolve();
        });

        db.once('error', (err) => {
            console.error('❌ Database initialization error:', err);
            reject(err);
        });
    });
}

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

// 🔒 2FA Константы
const TOTP_SECRET_LENGTH = 32; // 256 бит
const TOTP_CODE_LENGTH = 6;
const TOTP_PERIOD = 30; // 30 секунд
const TOTP_WINDOW = 1; // ±1 период для компенсации рассинхронизации
const BACKUP_CODES_COUNT = 10;
const BACKUP_CODES_LENGTH = 8;

// ============================================================================
// 🔒 Security Headers
// ============================================================================
const CSP_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
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
const users = new Map(); // username → {passwordHash, salt, createdAt, lastLogin, isVisibleInDirectory, allowGroupInvite, status, activeChat, devices}
const sessions = new Map(); // tokenId → {username, deviceId, ws, createdAt, lastActivity}
const wsToToken = new Map(); // WebSocket → tokenId
const rateLimitMap = new Map(); // ip → {count, resetTime}
const groups = new Map(); // groupId → {id, name, creator, members: Set, createdAt, lastMessage}

// ============================================================================
// 💾 Функции для работы с базой данных
// ============================================================================

/**
 * Загрузка пользователей из БД при старте сервера
 * @returns {Promise<number>}
 */
function loadUsersFromDatabase() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM users', [], (err, rows) => {
            if (err) {
                // Если таблица не существует - это нормально (первый запуск)
                if (err.message.includes('no such table')) {
                    console.warn('⚠️  Users table does not exist yet (first run)');
                    resolve(0);
                    return;
                }
                console.error('❌ Load users error:', err);
                reject(err);
                return;
            }

            rows.forEach(row => {
                users.set(row.username, {
                    passwordHash: row.passwordHash,
                    salt: row.salt,
                    createdAt: row.createdAt,
                    lastLogin: row.lastLogin,
                    isVisibleInDirectory: row.isVisibleInDirectory === 1,
                    allowGroupInvite: row.allowGroupInvite === 1,
                    twoFactorSecret: row.twoFactorSecret || null,
                    twoFactorEnabled: row.twoFactorEnabled === 1,
                    twoFactorBackupCodes: row.twoFactorBackupCodes || null,
                    status: 'offline',
                    activeChat: null,
                    devices: new Map()
                });
            });

            console.log(`✅ Loaded ${rows.length} users from database`);
            resolve(rows.length);
        });
    });
}

/**
 * Сохранение пользователя в БД
 */
function saveUserToDatabase(username, userData) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO users
             (username, passwordHash, salt, createdAt, lastLogin, isVisibleInDirectory, allowGroupInvite, twoFactorSecret, twoFactorEnabled, twoFactorBackupCodes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                username,
                userData.passwordHash,
                userData.salt,
                userData.createdAt,
                userData.lastLogin || null,
                userData.isVisibleInDirectory ? 1 : 0,
                userData.allowGroupInvite ? 1 : 0,
                userData.twoFactorSecret || null,
                userData.twoFactorEnabled ? 1 : 0,
                userData.twoFactorBackupCodes || null
            ],
            (err) => {
                if (err) {
                    console.error('❌ Save user error:', err);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

/**
 * Загрузка групп из БД
 * @returns {Promise<void>}
 */
function loadGroupsFromDatabase() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM groups', [], (err, rows) => {
            if (err) {
                // Если таблица не существует - это нормально (первый запуск)
                if (err.message.includes('no such table')) {
                    console.warn('⚠️  Groups table does not exist yet (first run)');
                    resolve();
                    return;
                }
                console.error('❌ Load groups error:', err);
                reject(err);
                return;
            }

            // Загружаем каждую группу и её участников
            let loaded = 0;
            rows.forEach(row => {
                // Загружаем участников группы
                db.all('SELECT username FROM group_members WHERE groupId = ?', [row.id], (err, members) => {
                    if (err) {
                        console.error('❌ Load group members error:', err);
                        return;
                    }

                    const memberSet = new Set(members.map(m => m.username));
                    groups.set(row.id, {
                        id: row.id,
                        name: row.name,
                        creator: row.creator,
                        members: memberSet,
                        createdAt: row.createdAt,
                        lastMessage: row.lastMessage
                    });

                    loaded++;
                    if (loaded === rows.length) {
                        console.log(`✅ Loaded ${rows.length} groups from database`);
                        resolve();
                    }
                });
            });

            if (rows.length === 0) {
                resolve();
            }
        });
    });
}

/**
 * Сохранение группы в БД
 */
function saveGroupToDatabase(group) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO groups (id, name, creator, createdAt, lastMessage) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                group.id,
                group.name,
                group.creator,
                group.createdAt,
                group.lastMessage || null
            ],
            (err) => {
                if (err) {
                    console.error('❌ Save group error:', err);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

/**
 * Сохранение участников группы в БД
 */
function saveGroupMembersToDatabase(groupId, members) {
    return new Promise((resolve, reject) => {
        // Сначала удаляем старых участников
        db.run('DELETE FROM group_members WHERE groupId = ?', [groupId], (err) => {
            if (err) {
                console.error('❌ Delete group members error:', err);
                reject(err);
                return;
            }
            
            // Вставляем новых участников
            if (members.length === 0) {
                resolve();
                return;
            }
            
            const stmt = db.prepare('INSERT OR IGNORE INTO group_members (groupId, username) VALUES (?, ?)');
            members.forEach(username => {
                stmt.run(groupId, username);
            });
            
            stmt.finalize((err) => {
                if (err) {
                    console.error('❌ Save group members error:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

/**
 * Удаление группы из БД
 */
function deleteGroupFromDatabase(groupId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
            if (err) {
                console.error('❌ Delete group error:', err);
                reject(err);
            } else {
                db.run('DELETE FROM group_members WHERE groupId = ?', [groupId], (err2) => {
                    if (err2) {
                        console.error('❌ Delete group members error:', err2);
                        reject(err2);
                    } else {
                        resolve();
                    }
                });
            }
        });
    });
}

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
            allowGroupInvite: user.allowGroupInvite || false, // 👥
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
// 🔒 2FA / TOTP Функции
// ============================================================================

/**
 * Генерация TOTP секрета
 * @returns {string} - Base32 encoded secret
 */
function generateTOTPSecret() {
    const secret = crypto.randomBytes(TOTP_SECRET_LENGTH);
    return base32Encode(secret);
}

/**
 * Генерация TOTP кода
 * @param {string} secret - Base32 секрет
 * @param {number} [timestamp] - Временная метка
 * @returns {string} - 6-значный код
 */
function generateTOTPCode(secret, timestamp = Date.now()) {
    try {
        const period = Math.floor(timestamp / 1000 / TOTP_PERIOD);
        const secretBytes = base32Decode(secret);
        
        // Создаем буфер для временной метки (8 байт, big-endian)
        const buffer = Buffer.alloc(8);
        buffer.writeUInt32BE(0, 0);
        buffer.writeUInt32BE(period, 4);
        
        // HMAC-SHA1
        const hmac = crypto.createHmac('sha1', secretBytes);
        hmac.update(buffer);
        const digest = hmac.digest();
        
        // Dynamic truncation
        const offset = digest[digest.length - 1] & 0x0f;
        const binary = ((digest[offset] & 0x7f) << 24) |
                       ((digest[offset + 1] & 0xff) << 16) |
                       ((digest[offset + 2] & 0xff) << 8) |
                       (digest[offset + 3] & 0xff);
        
        const otp = binary % Math.pow(10, TOTP_CODE_LENGTH);
        return otp.toString().padStart(TOTP_CODE_LENGTH, '0');
    } catch (e) {
        console.error('❌ generateTOTPCode error:', e);
        return '';
    }
}

/**
 * Верификация TOTP кода
 * @param {string} secret - Base32 секрет
 * @param {string} token - Код от пользователя
 * @returns {boolean}
 */
function verifyTOTP(secret, token) {
    if (!secret || !token || typeof token !== 'string') return false;
    
    const cleanToken = token.replace(/\s/g, '');
    if (!/^\d+$/.test(cleanToken) || cleanToken.length !== TOTP_CODE_LENGTH) return false;
    
    const now = Date.now();
    
    // Проверяем текущий и соседние периоды (для компенсации рассинхронизации)
    for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
        const checkTime = now + (i * TOTP_PERIOD * 1000);
        const expectedCode = generateTOTPCode(secret, checkTime);
        if (expectedCode === cleanToken) return true;
    }
    
    return false;
}

/**
 * Генерация резервных кодов
 * @returns {string[]} - Массив резервных кодов
 */
function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < BACKUP_CODES_COUNT; i++) {
        const code = crypto.randomBytes(BACKUP_CODES_LENGTH).toString('hex').substring(0, BACKUP_CODES_LENGTH * 2);
        codes.push(code);
    }
    return codes;
}

/**
 * Проверка резервного кода
 * @param {string[]} codes - Зашифрованные резервные коды
 * @param {string} token - Код от пользователя
 * @returns {boolean}
 */
function verifyBackupCode(encryptedCodes, token) {
    if (!encryptedCodes || !token) return false;
    
    try {
        const codes = JSON.parse(encryptedCodes);
        const cleanToken = token.replace(/\s/g, '').toLowerCase();
        return codes.includes(cleanToken);
    } catch (e) {
        return false;
    }
}

/**
 * Удаление использованного резервного кода
 * @param {string} encryptedCodes - Зашифрованные коды
 * @param {string} token - Использованный код
 * @returns {string} - Новые зашифрованные коды
 */
function removeBackupCode(encryptedCodes, token) {
    try {
        const codes = JSON.parse(encryptedCodes);
        const cleanToken = token.replace(/\s/g, '').toLowerCase();
        const newCodes = codes.filter(c => c !== cleanToken);
        return JSON.stringify(newCodes);
    } catch (e) {
        return encryptedCodes;
    }
}

/**
 * Base32 Encode
 * @param {Buffer} buffer
 * @returns {string}
 */
function base32Encode(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    let result = '';
    
    for (let i = 0; i < buffer.length; i++) {
        const bin = buffer[i].toString(2).padStart(8, '0');
        bits += bin;
    }
    
    // Pad to multiple of 5
    while (bits.length % 5 !== 0) {
        bits += '0';
    }
    
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.substr(i, 5);
        result += alphabet[parseInt(chunk, 2)];
    }
    
    return result;
}

/**
 * Base32 Decode
 * @param {string} str - Base32 строка
 * @returns {Buffer}
 */
function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    str = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    
    let bits = '';
    for (let i = 0; i < str.length; i++) {
        const idx = alphabet.indexOf(str[i]);
        if (idx === -1) continue;
        const bin = idx.toString(2).padStart(5, '0');
        bits += bin;
    }
    
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        const chunk = bits.substr(i, 8);
        if (chunk.length === 8) {
            bytes.push(parseInt(chunk, 2));
        }
    }
    
    return Buffer.from(bytes);
}

/**
 * Генерация QR кода для Google Authenticator (data URL)
 * @param {string} username
 * @param {string} secret
 * @returns {string} - SVG QR код
 */
function generateQRCodeSVG(username, secret) {
    const issuer = 'ClientMessenger';
    const uri = `otpauth://totp/${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
    
    // Простая генерация QR кода (используем внешний сервис для надежности)
    // В production лучше использовать библиотеку типа 'qrcode'
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
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
        const passwordHash = hashPassword(password, salt);
        
        const userData = {
            passwordHash: passwordHash,
            salt,
            createdAt: Date.now(),
            lastLogin: null,
            isVisibleInDirectory: false,
            allowGroupInvite: false, // ✨ По умолчанию запрет на приглашение в группы
            status: 'offline',
            activeChat: null,
            devices: new Map()
        };
        
        // Сохраняем в памяти
        users.set(username, userData);
        
        // 🔒 Сохраняем в базу данных
        saveUserToDatabase(username, userData).catch(err => {
            console.error('❌ Failed to save user to database:', err);
        });

        console.log(`✅ Registered: ${username} from ${clientIp}`);

        // 🔒 Автоматический вход после успешной регистрации
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

        const user = users.get(username);
        user.devices.set(deviceId, { ws, lastActivity: Date.now() });
        user.lastLogin = Date.now();
        user.status = 'online';
        
        // 🔒 Обновляем запись в БД с lastLogin
        saveUserToDatabase(username, user).catch(err => {
            console.error('❌ Failed to update user login:', err);
        });

        console.log(`✅ Auto-login after registration: ${username} (${deviceId})`);

        ws.send(JSON.stringify({
            type: 'register_success',
            username,
            deviceId,
            token: tokenId,
            isVisibleInDirectory: user.isVisibleInDirectory,
            message: 'Регистрация успешна! Выполнен вход в аккаунт.'
        }));

        broadcastUserList();
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
            lastActivity: Date.now(),
            twoFactorVerified: !user.twoFactorEnabled // Если 2FA выключен, считаем верифицированным
        };

        sessions.set(tokenId, session);
        wsToToken.set(ws, tokenId);
        user.devices.set(deviceId, { ws, lastActivity: Date.now() });
        user.lastLogin = Date.now();
        user.status = 'online';

        // 🔒 Сохраняем lastLogin в БД
        saveUserToDatabase(username, user).catch(err => {
            console.error('❌ Failed to save user login:', err);
        });

        console.log(`✅ Logged in: ${username} (${deviceId}) from ${clientIp}`);

        // 🔒 Если включен 2FA, отправляем запрос кода вместо полного входа
        if (user.twoFactorEnabled) {
            ws.send(JSON.stringify({
                type: 'login_2fa_required',
                username,
                deviceId,
                token: tokenId,
                message: 'Требуется код 2FA'
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'login_success',
                username,
                deviceId,
                token: tokenId,
                isVisibleInDirectory: user.isVisibleInDirectory,
                message: 'Вход выполнен успешно'
            }));
            broadcastUserList();
        }
    } catch (e) {
        console.error('❌ Login error:', e);
        ws.send(JSON.stringify({ type: 'login_error', message: 'Ошибка при входе' }));
    }
}

/**
 * 🔒 Автоматический вход по токену сессии
 */
function handleAutoLogin(ws, { username, token, deviceId }, clientIp) {
    if (!checkRateLimit(clientIp)) {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Слишком много попыток. Подождите.' }));
    }

    if (!username || typeof username !== 'string' || !token || typeof token !== 'string') {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверные данные' }));
    }

    username = username.trim();
    const user = users.get(username);

    // Проверяем существование пользователя
    if (!user) {
        console.log(`🚫 Auto-login attempt for non-existent: ${username} from ${clientIp}`);
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Пользователь не найден' }));
    }

    // 🔒 ПРОВЕРЯЕМ ТОКЕН СЕССИИ - только валидная сессия разрешает вход
    let validSession = null;
    for (const [tokenId, session] of sessions.entries()) {
        if (session.username === username && tokenId === token) {
            validSession = session;
            break;
        }
    }

    // 🔒 Если сессия не найдена - ОТКАЗЫВАЕМ в доступе
    // deviceId больше не используется для авто-входа без токена
    if (!validSession) {
        console.log(`🚫 Auto-login rejected: invalid token for ${username} from ${clientIp}`);
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный токен сессии' }));
    }

    // Создание новой сессии для авто-входа
    try {
        const tokenId = generateToken();
        const newDeviceId = deviceId || 'device_' + crypto.randomBytes(8).toString('hex');

        const session = {
            username,
            deviceId: newDeviceId,
            ws,
            createdAt: Date.now(),
            lastActivity: Date.now()
        };

        sessions.set(tokenId, session);
        wsToToken.set(ws, tokenId);
        user.devices.set(newDeviceId, { ws, lastActivity: Date.now() });
        user.lastLogin = Date.now();
        user.status = 'online';

        // 🔒 Сохраняем lastLogin в БД
        saveUserToDatabase(username, user).catch(err => {
            console.error('❌ Failed to save user login:', err);
        });

        console.log(`✅ Auto-logged in: ${username} (${newDeviceId}) from ${clientIp}`);

        ws.send(JSON.stringify({
            type: 'login_success',
            username,
            deviceId: newDeviceId,
            token: tokenId,
            isVisibleInDirectory: user.isVisibleInDirectory,
            message: 'Автоматический вход выполнен успешно'
        }));

        broadcastUserList();
    } catch (e) {
        console.error('❌ Auto-login error:', e);
        ws.send(JSON.stringify({ type: 'login_error', message: 'Ошибка при автоматическом входе' }));
    }
}

/**
 * 🔒 Верификация 2FA при входе
 */
function handleLogin2FA(ws, { username, token, deviceId, twoFactorToken, useBackupCode }, clientIp) {
    if (!checkRateLimit(clientIp)) {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Слишком много попыток. Подождите.' }));
    }

    if (!username || typeof username !== 'string' || !token || typeof token !== 'string') {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверные данные' }));
    }

    if (!twoFactorToken || typeof twoFactorToken !== 'string') {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Требуется 2FA код' }));
    }

    username = username.trim();
    const user = users.get(username);

    if (!user) {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Пользователь не найден' }));
    }

    if (!user.twoFactorEnabled) {
        return ws.send(JSON.stringify({ type: 'login_error', message: '2FA не включён' }));
    }

    // Проверяем 2FA код
    let verified = false;
    if (useBackupCode) {
        verified = verifyBackupCode(user.twoFactorBackupCodes, twoFactorToken);
    } else {
        verified = verifyTOTP(user.twoFactorSecret, twoFactorToken);
    }

    if (!verified) {
        console.log(`🚫 2FA failed for ${username} from ${clientIp}`);
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Неверный 2FA код' }));
    }

    // Находим сессию и помечаем как верифицированную
    let session = null;
    for (const [tokenId, s] of sessions.entries()) {
        if (s.username === username && tokenId === token) {
            session = s;
            break;
        }
    }

    if (!session) {
        return ws.send(JSON.stringify({ type: 'login_error', message: 'Сессия не найдена' }));
    }

    // Помечаем сессию как верифицированную
    session.twoFactorVerified = true;
    session.lastActivity = Date.now();

    // Если использовали резервный код, удаляем его
    if (useBackupCode) {
        user.twoFactorBackupCodes = removeBackupCode(user.twoFactorBackupCodes, twoFactorToken);
        saveUserToDatabase(username, user).catch(err => {
            console.error('❌ Failed to update backup codes:', err);
        });
    }

    console.log(`✅ 2FA verified for ${username} from ${clientIp}`);

    ws.send(JSON.stringify({
        type: 'login_success',
        username,
        deviceId: session.deviceId,
        token,
        isVisibleInDirectory: user.isVisibleInDirectory,
        twoFactorVerified: true,
        remainingBackupCodes: user.twoFactorBackupCodes ? JSON.parse(user.twoFactorBackupCodes).length : 0,
        message: 'Вход выполнен успешно'
    }));

    broadcastUserList();
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
                // 🔒 Сбрасываем activeChat при полном отключении
                const oldActiveChat = user.activeChat;
                user.activeChat = null;
                
                // 🔒 Рассылаем обновление статуса всем
                broadcast({
                    type: 'user_status_update',
                    username: session.username,
                    status: 'offline',
                    activeChat: null
                });
                
                // 🔒 Если пользователь был в чате с кем-то, уведомляем того пользователя
                if (oldActiveChat) {
                    const otherUser = users.get(oldActiveChat);
                    if (otherUser) {
                        broadcast({
                            type: 'user_offline',
                            username: session.username,
                            activeChat: null
                        });
                    }
                }
            } else {
                // 🔒 Если остались другие устройства, обновляем activeChat
                user.activeChat = null;
                broadcast({
                    type: 'user_status_update',
                    username: session.username,
                    status: user.status,
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

// 🔒 Максимальный размер файла (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 5;

/**
 * Валидация файлов
 */
function validateFiles(files) {
    if (!Array.isArray(files)) return null;
    if (files.length === 0) return null;
    if (files.length > MAX_FILES_PER_MESSAGE) return null;

    const validFiles = [];
    for (const file of files) {
        if (!file || typeof file !== 'object') continue;
        if (!file.name || typeof file.name !== 'string') continue;
        if (!file.type || typeof file.type !== 'string') continue;
        if (!file.data || typeof file.data !== 'string') continue;
        if (!file.size || typeof file.size !== 'number') continue;

        // Проверка размера
        if (file.size > MAX_FILE_SIZE) continue;

        // 🔒 Проверка размера base64 данных (не более 4/3 от размера файла + overhead)
        const maxBase64Size = Math.ceil(file.size * 4 / 3) + 1000;
        if (file.data.length > maxBase64Size) {
            console.warn(`🚫 File data too large: ${file.data.length} > ${maxBase64Size}`);
            continue;
        }

        // Проверка data URL
        if (!file.data.startsWith('data:')) continue;

        // 🔒 Проверка на опасные MIME-типы
        const lowerType = file.type.toLowerCase();
        const dangerousTypes = ['text/html', 'application/javascript', 'application/x-javascript'];
        if (dangerousTypes.includes(lowerType)) {
            console.warn(`🚫 Dangerous file type blocked: ${file.type}`);
            continue;
        }

        // 🔒 Дополнительная проверка MIME-типа для изображений
        if (file.type.startsWith('image/')) {
            // Разрешаем только безопасные форматы изображений
            const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedImageTypes.includes(lowerType)) {
                console.warn(`🚫 Disallowed image type: ${file.type}`);
                continue;
            }
        }

        // 🔒 Дополнительная проверка MIME-типа для видео
        if (file.type.startsWith('video/')) {
            // Разрешаем только безопасные форматы видео
            const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
            if (!allowedVideoTypes.includes(lowerType)) {
                console.warn(`🚫 Disallowed video type: ${file.type}`);
                continue;
            }
        }

        validFiles.push({
            name: file.name.substring(0, 255),
            type: file.type.substring(0, 100),
            size: file.size,
            data: file.data.substring(0, MAX_FILE_SIZE * 2)
        });
    }

    return validFiles.length > 0 ? validFiles : null;
}

function handleMessage(ws, sender, { text, privateTo, timestamp, encrypted, hint, replyTo, files }) {
    // 🔒 Строгая валидация типа sender
    if (!sender || typeof sender !== 'string' || sender.length > USERNAME_MAX_LENGTH) {
        console.warn(`🚫 Invalid sender from ${getClientIp(ws)}`);
        return ws.send(JSON.stringify({ type: 'error', message: 'Неверный отправитель' }));
    }

    if (!text || typeof text !== 'string') {
        return ws.send(JSON.stringify({ type: 'error', message: 'Неверное сообщение' }));
    }

    const trimmedText = text.substring(0, MESSAGE_MAX_LENGTH);

    // 🔒 XSS защита - расширенная проверка
    const dangerousPatterns = [
        '<script',
        'javascript:',
        'onerror=',
        'onclick=',
        'onload=',
        'onmouseover=',
        '<img',
        '<iframe',
        '<object',
        '<embed',
        'data:text/html',
        'vbscript:'
    ];

    const lowerText = trimmedText.toLowerCase();
    for (const pattern of dangerousPatterns) {
        if (lowerText.includes(pattern)) {
            console.warn(`🚫 XSS attempt from ${sender}: ${pattern}`);
            return ws.send(JSON.stringify({ type: 'error', message: 'Недопустимое содержимое' }));
        }
    }

    // 📎 Валидация файлов
    const validFiles = validateFiles(files);

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
        replyTo: replyTo || null,
        files: validFiles
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

            // ✨ Отправляем отправителю его сообщение для добавления в активные чаты
            ws.send(JSON.stringify({
                type: 'receive_message',
                sender,
                text: trimmedText,
                timestamp: message.timestamp,
                privateTo,
                encrypted: encrypted || false,
                hint: hint || null,
                replyTo: replyTo || null,
                files: validFiles
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
    
    // 🔒 Сохраняем в БД
    saveUserToDatabase(username, user).catch(err => {
        console.error('❌ Failed to save user visibility:', err);
    });

    ws.send(JSON.stringify({
        type: 'visibility_updated',
        isVisible: user.isVisibleInDirectory
    }));

    broadcastUserList();
}

// ✨ Обработка обновления разрешения на приглашение в группы
function handleUpdateGroupInvitePermission(ws, username, { allow }) {
    const user = users.get(username);
    if (!user) return;

    user.allowGroupInvite = typeof allow === 'boolean' ? allow : false;
    
    // 🔒 Сохраняем в БД
    saveUserToDatabase(username, user).catch(err => {
        console.error('❌ Failed to save user group invite permission:', err);
    });

    ws.send(JSON.stringify({
        type: 'group_invite_permission_updated',
        allow: user.allowGroupInvite
    }));

    console.log(`🔒 ${username} updated group invite permission: ${user.allowGroupInvite}`);
}

// ============================================================================
// 🔒 2FA Обработчики
// ============================================================================

/**
 * Настройка 2FA - генерация секрета и QR кода
 */
function handle2FASetup(ws, username) {
    const user = users.get(username);
    if (!user) return ws.send(JSON.stringify({ type: '2fa_error', message: 'Пользователь не найден' }));

    // Генерируем новый секрет
    const secret = generateTOTPSecret();
    
    // Сохраняем временно (пока не подтверждено)
    user.tempTwoFactorSecret = secret;

    // Генерируем QR код
    const qrCodeUrl = generateQRCodeSVG(username, secret);

    ws.send(JSON.stringify({
        type: '2fa_setup_response',
        secret,
        qrCodeUrl,
        uri: `otpauth://totp/${encodeURIComponent(username)}?secret=${secret}&issuer=ClientMessenger`
    }));

    console.log(`🔒 2FA setup initiated for ${username}`);
}

/**
 * Включение 2FA - подтверждение кода
 */
function handle2FAEnable(ws, username, { token }) {
    const user = users.get(username);
    if (!user) return ws.send(JSON.stringify({ type: '2fa_error', message: 'Пользователь не найден' }));

    const secret = user.tempTwoFactorSecret || user.twoFactorSecret;
    if (!secret) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: 'Сначала настройте 2FA' }));
    }

    if (!verifyTOTP(secret, token)) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: 'Неверный код' }));
    }

    // Включаем 2FA
    user.twoFactorSecret = secret;
    user.twoFactorEnabled = true;
    user.twoFactorBackupCodes = JSON.stringify(generateBackupCodes());
    delete user.tempTwoFactorSecret;

    // Сохраняем в БД
    saveUserToDatabase(username, user).catch(err => {
        console.error('❌ Failed to save 2FA settings:', err);
    });

    // Отправляем резервные коды
    const backupCodes = JSON.parse(user.twoFactorBackupCodes);

    ws.send(JSON.stringify({
        type: '2fa_enabled',
        backupCodes,
        message: '2FA успешно включён'
    }));

    console.log(`🔒 2FA enabled for ${username}`);
}

/**
 * Отключение 2FA
 */
function handle2FADisable(ws, username, { token, useBackupCode }) {
    const user = users.get(username);
    if (!user) return ws.send(JSON.stringify({ type: '2fa_error', message: 'Пользователь не найден' }));

    if (!user.twoFactorEnabled) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: '2FA уже отключён' }));
    }

    // Проверяем код
    let verified = false;
    if (useBackupCode) {
        verified = verifyBackupCode(user.twoFactorBackupCodes, token);
    } else {
        verified = verifyTOTP(user.twoFactorSecret, token);
    }

    if (!verified) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: 'Неверный код' }));
    }

    // Отключаем 2FA
    user.twoFactorSecret = null;
    user.twoFactorEnabled = false;
    user.twoFactorBackupCodes = null;
    delete user.tempTwoFactorSecret;

    // Сохраняем в БД
    saveUserToDatabase(username, user).catch(err => {
        console.error('❌ Failed to disable 2FA:', err);
    });

    ws.send(JSON.stringify({
        type: '2fa_disabled',
        message: '2FA отключён'
    }));

    console.log(`🔒 2FA disabled for ${username}`);
}

/**
 * Верификация 2FA кода (для входа)
 */
function handle2FAVerify(ws, username, { token, useBackupCode }) {
    const user = users.get(username);
    if (!user) return ws.send(JSON.stringify({ type: '2fa_error', message: 'Пользователь не найден' }));

    if (!user.twoFactorEnabled) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: '2FA не включён' }));
    }

    let verified = false;
    if (useBackupCode) {
        verified = verifyBackupCode(user.twoFactorBackupCodes, token);
        if (verified) {
            // Удаляем использованный код
            user.twoFactorBackupCodes = removeBackupCode(user.twoFactorBackupCodes, token);
            saveUserToDatabase(username, user).catch(err => {
                console.error('❌ Failed to update backup codes:', err);
            });
        }
    } else {
        verified = verifyTOTP(user.twoFactorSecret, token);
    }

    if (!verified) {
        return ws.send(JSON.stringify({ type: '2fa_verify_error', message: 'Неверный код' }));
    }

    ws.send(JSON.stringify({
        type: '2fa_verified',
        message: 'Код подтверждён',
        remainingBackupCodes: user.twoFactorBackupCodes ? JSON.parse(user.twoFactorBackupCodes).length : 0
    }));
}

/**
 * Показать резервные коды
 */
function handle2FABackupCodes(ws, username) {
    const user = users.get(username);
    if (!user) return ws.send(JSON.stringify({ type: '2fa_error', message: 'Пользователь не найден' }));

    if (!user.twoFactorEnabled) {
        return ws.send(JSON.stringify({ type: '2fa_error', message: '2FA не включён' }));
    }

    ws.send(JSON.stringify({
        type: '2fa_backup_codes_response',
        backupCodes: user.twoFactorBackupCodes ? JSON.parse(user.twoFactorBackupCodes) : [],
        message: 'Резервные коды'
    }));
}

// ✨ Обработка открытия чата
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
// 👥 Групповые чаты
// ============================================================================

/**
 * Создание группы
 */
function handleCreateGroup(ws, username, { name, members }) {
    const user = users.get(username);
    if (!user) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Требуется авторизация' }));
    }

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 50) {
        return ws.send(JSON.stringify({ type: 'create_group_error', message: 'Название группы должно быть от 2 до 50 символов' }));
    }

    if (!Array.isArray(members) || members.length === 0) {
        return ws.send(JSON.stringify({ type: 'create_group_error', message: 'Добавьте хотя бы одного участника' }));
    }

    // Проверяем, что все участники существуют и разрешили приглашения
    const validMembers = new Set([username]); // Создатель автоматически в группе
    for (const member of members) {
        const memberUser = users.get(member);
        if (!memberUser) {
            return ws.send(JSON.stringify({ type: 'create_group_error', message: `Пользователь "${member}" не найден` }));
        }
        if (member !== username && !memberUser.allowGroupInvite) {
            return ws.send(JSON.stringify({ 
                type: 'create_group_error', 
                message: `Пользователь "${member}" запретил добавлять себя в группы` 
            }));
        }
        validMembers.add(member);
    }

    // Создаём группу
    const groupId = 'group_' + crypto.randomBytes(16).toString('hex');
    const group = {
        id: groupId,
        name: name.trim(),
        creator: username,
        members: validMembers,
        createdAt: Date.now(),
        lastMessage: null
    };

    groups.set(groupId, group);
    
    // 🔒 Сохраняем группу в БД
    saveGroupToDatabase(group).catch(err => {
        console.error('❌ Failed to save group to database:', err);
    });
    
    // 🔒 Сохраняем участников группы в БД
    saveGroupMembersToDatabase(groupId, [...validMembers]).catch(err => {
        console.error('❌ Failed to save group members to database:', err);
    });

    console.log(`👥 Group created: ${groupId} by ${username}, members: ${[...validMembers].join(', ')}`);

    // Отправляем подтверждение создателю
    ws.send(JSON.stringify({
        type: 'group_created',
        group: {
            id: group.id,
            name: group.name,
            creator: group.creator,
            members: [...group.members],
            createdAt: group.createdAt
        }
    }));

    // Уведомляем участников группы
    notifyGroupMembers(group, 'group_created', {
        group: {
            id: group.id,
            name: group.name,
            creator: group.creator,
            members: [...group.members],
            createdAt: group.createdAt
        }
    }, ws);

    // Обновляем список пользователей для всех (чтобы показать группы)
    broadcastGroupList();
}

/**
 * Добавление участника в группу
 */
function handleAddMemberToGroup(ws, username, { groupId, member }) {
    const user = users.get(username);
    if (!user) return;

    const group = groups.get(groupId);
    if (!group) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Группа не найдена' }));
    }

    // Только создатель может добавлять участников
    if (group.creator !== username) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Только создатель может добавлять участников' }));
    }

    const memberUser = users.get(member);
    if (!memberUser) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Пользователь не найден' }));
    }

    if (!memberUser.allowGroupInvite) {
        return ws.send(JSON.stringify({ type: 'error', message: `Пользователь "${member}" запретил добавлять себя в группы` }));
    }

    if (group.members.has(member)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Пользователь уже в группе' }));
    }

    group.members.add(member);

    console.log(`👥 ${member} added to group ${groupId} by ${username}`);

    // Уведомляем всех участников группы
    notifyGroupMembers(group, 'group_member_added', {
        groupId,
        member,
        addedBy: username
    });
}

/**
 * Удаление участника из группы
 */
function handleRemoveMemberFromGroup(ws, username, { groupId, member }) {
    const user = users.get(username);
    if (!user) return;

    const group = groups.get(groupId);
    if (!group) return;

    // Только создатель может удалять участников
    if (group.creator !== username) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Только создатель может удалять участников' }));
    }

    if (!group.members.has(member)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Пользователь не в группе' }));
    }

    group.members.delete(member);

    console.log(`👥 ${member} removed from group ${groupId} by ${username}`);

    // Уведомляем всех участников группы
    notifyGroupMembers(group, 'group_member_removed', {
        groupId,
        member,
        removedBy: username
    });
}

/**
 * Отправка сообщения в группу
 */
function handleGroupMessage(ws, sender, { groupId, text, timestamp, encrypted, hint, replyTo, files }) {
    const user = users.get(sender);
    if (!user) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Требуется авторизация' }));
    }

    const group = groups.get(groupId);
    if (!group || !group.members.has(sender)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Вы не участник этой группы' }));
    }

    if (!text || typeof text !== 'string') {
        return ws.send(JSON.stringify({ type: 'error', message: 'Неверное сообщение' }));
    }

    const trimmedText = text.substring(0, MESSAGE_MAX_LENGTH);

    // XSS защита
    if (trimmedText.includes('<script') || trimmedText.includes('javascript:') || trimmedText.includes('onerror=')) {
        console.warn(`🚫 XSS attempt from ${sender} in group ${groupId}`);
        return ws.send(JSON.stringify({ type: 'error', message: 'Недопустимое содержимое' }));
    }

    // 📎 Валидация файлов
    const validFiles = validateFiles(files);

    const message = {
        type: 'receive_group_message',
        sender,
        groupId,
        groupName: group.name,
        text: trimmedText,
        timestamp: timestamp || Date.now(),
        encrypted: encrypted || false,
        hint: hint || null,
        replyTo: replyTo || null,
        files: validFiles
    };

    group.lastMessage = Date.now();

    // Отправляем всем участникам группы
    for (const memberName of group.members) {
        const memberUser = users.get(memberName);
        if (memberUser) {
            for (const [_, device] of memberUser.devices.entries()) {
                if (device.ws?.readyState === WebSocket.OPEN) {
                    device.ws.send(JSON.stringify(message));
                }
            }
        }
    }

    // Подтверждение доставки отправителю
    ws.send(JSON.stringify({
        type: 'message_confirmed',
        timestamp: message.timestamp,
        confirmed: true
    }));

    console.log(`💬 Group message in ${groupId} from ${sender}`);
}

/**
 * Выход из группы
 */
function handleLeaveGroup(ws, username, { groupId }) {
    const group = groups.get(groupId);
    if (!group) return;

    // Создатель не может выйти, он должен удалить группу
    if (group.creator === username) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Создатель не может выйти из группы. Удалите группу.' }));
    }

    if (!group.members.has(username)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Вы не в группе' }));
    }

    group.members.delete(username);

    console.log(`👥 ${username} left group ${groupId}`);

    // Уведомляем всех участников группы
    notifyGroupMembers(group, 'group_member_left', {
        groupId,
        member: username
    });
}

/**
 * Удаление группы
 */
function handleDeleteGroup(ws, username, { groupId }) {
    const group = groups.get(groupId);
    if (!group) return;

    if (group.creator !== username) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Только создатель может удалить группу' }));
    }

    console.log(`🗑️ Group deleted: ${groupId} by ${username}`);

    // Уведомляем всех участников
    notifyGroupMembers(group, 'group_deleted', { groupId });

    groups.delete(groupId);
    
    // 🔒 Удаляем группу из БД
    deleteGroupFromDatabase(groupId).catch(err => {
        console.error('❌ Failed to delete group from database:', err);
    });
    
    broadcastGroupList();
}

/**
 * Запрос списка групп
 */
function handleGetGroups(ws, username) {
    const userGroups = [];
    for (const group of groups.values()) {
        if (group.members.has(username)) {
            userGroups.push({
                id: group.id,
                name: group.name,
                creator: group.creator,
                members: [...group.members],
                createdAt: group.createdAt,
                lastMessage: group.lastMessage
            });
        }
    }

    ws.send(JSON.stringify({
        type: 'group_list',
        groups: userGroups
    }));
}

/**
 * Рассылка уведомления всем участникам группы
 */
function notifyGroupMembers(group, type, data, excludeWs = null) {
    for (const memberName of group.members) {
        const memberUser = users.get(memberName);
        if (memberUser) {
            for (const [_, device] of memberUser.devices.entries()) {
                if (device.ws?.readyState === WebSocket.OPEN && device.ws !== excludeWs) {
                    device.ws.send(JSON.stringify({ type, ...data }));
                }
            }
        }
    }
}

/**
 * Рассылка списка групп всем пользователям
 */
function broadcastGroupList() {
    // Для каждого пользователя формируем его список групп
    for (const [username, user] of users.entries()) {
        const userGroups = [];
        for (const group of groups.values()) {
            if (group.members.has(username)) {
                userGroups.push({
                    id: group.id,
                    name: group.name,
                    creator: group.creator,
                    members: [...group.members],
                    createdAt: group.createdAt,
                    lastMessage: group.lastMessage
                });
            }
        }

        // Отправляем список групп всем устройствам пользователя
        for (const [_, device] of user.devices.entries()) {
            if (device.ws?.readyState === WebSocket.OPEN) {
                device.ws.send(JSON.stringify({
                    type: 'group_list_update',
                    groups: userGroups
                }));
            }
        }
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

        // 🔒 Проверка 2FA верификации для всех команд кроме login/register/auto_login/logout/2fa_*
        const skip2FACheck = ['register', 'login', 'auto_login', 'logout', '2fa_setup', '2fa_enable', '2fa_disable', '2fa_verify', '2fa_backup_codes', 'login_2fa', 'ping', 'get_users'].includes(data.type);
        if (session && !session.twoFactorVerified && !skip2FACheck) {
            return ws.send(JSON.stringify({ 
                type: 'login_2fa_required', 
                message: 'Требуется верификация 2FA',
                username: session.username
            }));
        }

        switch (data.type) {
            case 'register': handleRegister(ws, data, clientIp); break;
            case 'login': handleLogin(ws, data, clientIp); break;
            case 'login_2fa': handleLogin2FA(ws, data, clientIp); break;
            case 'auto_login': handleAutoLogin(ws, data, clientIp); break;
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
            // ✨ Обработка обновления разрешения на приглашение в группы
            case 'update_group_invite_permission':
                if (session) handleUpdateGroupInvitePermission(ws, username, data);
                break;
            // 🔒 2FA команды
            case '2fa_setup':
                if (session) handle2FASetup(ws, username);
                break;
            case '2fa_enable':
                if (session) handle2FAEnable(ws, username, data);
                break;
            case '2fa_disable':
                if (session) handle2FADisable(ws, username, data);
                break;
            case '2fa_verify':
                if (session) handle2FAVerify(ws, username, data);
                break;
            case '2fa_backup_codes':
                if (session) handle2FABackupCodes(ws, username);
                break;
            // 👥 Групповые чаты
            case 'create_group':
                if (session) handleCreateGroup(ws, username, data);
                break;
            case 'add_member_to_group':
                if (session) handleAddMemberToGroup(ws, username, data);
                break;
            case 'remove_member_from_group':
                if (session) handleRemoveMemberFromGroup(ws, username, data);
                break;
            case 'send_group_message':
                if (session) handleGroupMessage(ws, username, data);
                break;
            case 'leave_group':
                if (session) handleLeaveGroup(ws, username, data);
                break;
            case 'delete_group':
                if (session) handleDeleteGroup(ws, username, data);
                break;
            case 'get_groups':
                if (session) handleGetGroups(ws, username);
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

/**
 * Асинхронная инициализация сервера
 */
async function startServer() {
    try {
        // Сначала инициализируем базу данных (создаём таблицы)
        console.log('📦 Initializing database...');
        await initializeDatabase();
        
        // Небольшая задержка чтобы убедиться что таблицы созданы
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Загружаем пользователей и группы из БД
        console.log('📦 Loading users from database...');
        await loadUsersFromDatabase();
        console.log('📦 Loading groups from database...');
        await loadGroupsFromDatabase();

        // Запускаем сервер
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Server v2.0.0 running on port ${PORT}`);
            console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
            console.log(`🔒 Session timeout: ${SESSION_TIMEOUT / 60000} min`);
            console.log(`🔒 Rate limit: ${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW / 1000}s`);
            console.log(`💾 Database: ${DB_PATH}`);
            console.log(`\n⚠️  Production: Use WSS and configure allowedOrigins!\n`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        console.error('💡 Try deleting the database file and restarting:', DB_PATH);
        process.exit(1);
    }
}

startServer();

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
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('💾 Database connection closed');
            }
        });
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received');
    process.exit(0);
});
