/**
 * Client Messenger - Модуль криптографии
 * @version 1.0.0
 * @description Сквозное шифрование сообщений (E2EE)
 * 
 * АРХИТЕКТУРА:
 * 1. Master Key выводится из пароля пользователя + соли (PBKDF2)
 * 2. Message Key выводится из Master Key + уникальной соли сообщения (HKDF)
 * 3. Каждое сообщение шифруется уникальным Message Key (AES-256-GCM)
 * 4. Сервер хранит только зашифрованные данные, ключи НЕ передаются
 */

'use strict';

// ============================================================================
// 🔐 КОНСТАНТЫ БЕЗОПАСНОСТИ
// ============================================================================
const CRYPTO_CONFIG = {
    // PBKDF2 параметры для вывода Master Key
    PBKDF2_ITERATIONS: 100000,        // Количество итераций (NIST рекомендация)
    PBKDF2_HASH: 'SHA-256',           // Хэш-функция
    PBKDF2_KEY_LENGTH: 256,           // Длина ключа в битах (256 бит = 32 байта)
    
    // HKDF параметры для вывода Message Key
    HKDF_HASH: 'SHA-256',             // Хэш-функция для HKDF
    HKDF_KEY_LENGTH: 256,             // Длина ключа в битах
    
    // AES параметры
    AES_ALGORITHM: 'AES-GCM',         // Режим шифрования
    AES_KEY_LENGTH: 256,              // Длина ключа в битах
    AES_IV_LENGTH: 12,                // Длина nonce/IV в байтах (96 бит для GCM)
    AES_TAG_LENGTH: 128,              // Длина authentication tag в битах
    
    // Соль
    SALT_LENGTH: 32                   // Длина соли в байтах (256 бит)
};

// ============================================================================
// 🔑 УПРАВЛЕНИЕ КЛЮЧАМИ
// ============================================================================

/**
 * Генерация криптографически безопасной случайной соли
 * @returns {Promise<Uint8Array>} - Случайная соль
 */
async function generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.SALT_LENGTH));
    return salt;
}

/**
 * Вывод Master Key из пароля пользователя
 * @param {string} password - Пароль пользователя
 * @param {Uint8Array|string} salt - Соль пользователя (из БД)
 * @returns {Promise<CryptoKey>} - Master Key для деривации
 */
async function deriveMasterKey(password, salt) {
    // Конвертируем соль в Uint8Array если это строка (base64)
    const saltBuffer = typeof salt === 'string' ? base64ToUint8Array(salt) : salt;
    
    // Кодируем пароль в байты
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    // Импортируем пароль как ключ для PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );
    
    // Выводим Master Key через PBKDF2
    const masterKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations: CRYPTO_CONFIG.PBKDF2_ITERATIONS,
            hash: CRYPTO_CONFIG.PBKDF2_HASH
        },
        keyMaterial,
        {
            name: 'HKDF',
            length: CRYPTO_CONFIG.AES_KEY_LENGTH
        },
        false,  // Не извлекаемый (нельзя экспортировать)
        ['deriveKey']  // Только для деривации других ключей
    );
    
    return masterKey;
}

/**
 * Вывод уникального Message Key для каждого сообщения
 * @param {CryptoKey} masterKey - Master Key пользователя
 * @param {string} messageId - Уникальный ID сообщения (timestamp + random)
 * @param {Uint8Array|string} derivationSalt - Соль деривации для сообщения
 * @returns {Promise<CryptoKey>} - Message Key для шифрования
 */
async function deriveMessageKey(masterKey, messageId, derivationSalt) {
    // Конвертируем соль в Uint8Array если это строка
    const saltBuffer = typeof derivationSalt === 'string' 
        ? base64ToUint8Array(derivationSalt) 
        : derivationSalt;
    
    // Создаём уникальный info для HKDF из messageId
    const encoder = new TextEncoder();
    const infoBuffer = encoder.encode(`message-key:${messageId}`);
    
    // Импортируем masterKey для HKDF
    // Для этого нам нужно получить raw bytes из masterKey через deriveBits
    const masterKeyBits = await crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: CRYPTO_CONFIG.HKDF_HASH,
            salt: saltBuffer,
            info: infoBuffer
        },
        masterKey,
        CRYPTO_CONFIG.HKDF_KEY_LENGTH
    );
    
    // Создаём Message Key из derived bits
    const messageKey = await crypto.subtle.importKey(
        'raw',
        masterKeyBits,
        CRYPTO_CONFIG.AES_ALGORITHM,
        false,  // Не извлекаемый
        ['encrypt', 'decrypt']
    );
    
    return messageKey;
}

// ============================================================================
// 🔒 ШИФРОВАНИЕ / РАСШИФРОВКА
// ============================================================================

/**
 * Шифрование текста сообщения (AES-256-GCM)
 * @param {string} text - Текст для шифрования
 * @param {CryptoKey} messageKey - Ключ шифрования
 * @returns {Promise<{encrypted: string, nonce: string}>} - Зашифрованные данные (base64)
 */
async function encryptMessageAES(text, messageKey) {
    // Генерируем уникальный nonce для каждого сообщения
    const nonce = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.AES_IV_LENGTH));
    
    // Кодируем текст в байты
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(text);
    
    // Шифруем
    const encryptedBuffer = await crypto.subtle.encrypt(
        {
            name: CRYPTO_CONFIG.AES_ALGORITHM,
            iv: nonce,
            tagLength: CRYPTO_CONFIG.AES_TAG_LENGTH
        },
        messageKey,
        dataBuffer
    );
    
    // Конвертируем в base64 для передачи/хранения
    return {
        encrypted: uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
        nonce: uint8ArrayToBase64(nonce)
    };
}

/**
 * Расшифровка текста сообщения (AES-256-GCM)
 * @param {string} encryptedBase64 - Зашифрованные данные (base64)
 * @param {string} nonceBase64 - Nonce (base64)
 * @param {CryptoKey} messageKey - Ключ расшифрования
 * @returns {Promise<string>} - Расшифрованный текст
 */
async function decryptMessageAES(encryptedBase64, nonceBase64, messageKey) {
    try {
        // Конвертируем из base64
        const encryptedData = base64ToUint8Array(encryptedBase64);
        const nonce = base64ToUint8Array(nonceBase64);
        
        // Расшифровываем
        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: CRYPTO_CONFIG.AES_ALGORITHM,
                iv: nonce,
                tagLength: CRYPTO_CONFIG.AES_TAG_LENGTH
            },
            messageKey,
            encryptedData
        );
        
        // Декодируем в текст
        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch (error) {
        console.error('❌ Decryption error:', error);
        throw new Error('Невозможно расшифровать сообщение. Неверный ключ или повреждённые данные.');
    }
}

// ============================================================================
// 📦 ПОЛНЫЙ ЦИКЛ ШИФРОВАНИЯ СООБЩЕНИЯ
// ============================================================================

/**
 * Полный цикл шифрования сообщения
 * @param {string} text - Текст сообщения
 * @param {CryptoKey} masterKey - Master Key пользователя
 * @param {string} messageId - Уникальный ID сообщения
 * @returns {Promise<{encryptedContent: string, encryptionHint: string}>}
 */
async function encryptFullMessage(text, masterKey, messageId) {
    // Генерируем соль для этого сообщения
    const derivationSalt = await generateSalt();
    
    // Выводим Message Key
    const messageKey = await deriveMessageKey(masterKey, messageId, derivationSalt);
    
    // Шифруем сообщение
    const { encrypted, nonce } = await encryptMessageAES(text, messageKey);
    
    // Создаём hint для расшифровки (содержит только метаданные, НЕ ключи)
    const encryptionHint = JSON.stringify({
        version: '1.0',
        derivationSalt: uint8ArrayToBase64(derivationSalt),
        messageNonce: nonce,
        createdAt: Date.now()
    });
    
    return {
        encryptedContent: encrypted,
        encryptionHint: encryptionHint
    };
}

/**
 * Полный цикл расшифровки сообщения
 * @param {string} encryptedContent - Зашифрованный контент
 * @param {string} encryptionHint - Подсказка для расшифровки (JSON)
 * @param {CryptoKey} masterKey - Master Key пользователя
 * @param {string} messageId - ID сообщения
 * @returns {Promise<string>} - Расшифрованный текст
 */
async function decryptFullMessage(encryptedContent, encryptionHint, masterKey, messageId) {
    try {
        // Парсим hint
        const hint = JSON.parse(encryptionHint);
        
        // Валидируем версию
        if (hint.version !== '1.0') {
            throw new Error(`Неподдерживаемая версия шифрования: ${hint.version}`);
        }
        
        // Выводим Message Key используя сохранённую соль
        const messageKey = await deriveMessageKey(
            masterKey, 
            messageId, 
            hint.derivationSalt
        );
        
        // Расшифровываем сообщение
        const decryptedText = await decryptMessageAES(
            encryptedContent,
            hint.messageNonce,
            messageKey
        );
        
        return decryptedText;
    } catch (error) {
        console.error('❌ decryptFullMessage error:', error);
        throw error;
    }
}

// ============================================================================
// 🧰 УТИЛИТЫ
// ============================================================================

/**
 * Конвертация Uint8Array в base64
 * @param {Uint8Array} array - Байты
 * @returns {string} - Base64 строка
 */
function uint8ArrayToBase64(array) {
    let binary = '';
    for (let i = 0; i < array.byteLength; i++) {
        binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
}

/**
 * Конвертация base64 в Uint8Array
 * @param {string} base64 - Base64 строка
 * @returns {Uint8Array} - Байты
 */
function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return array;
}

/**
 * Генерация уникального ID сообщения
 * @returns {string} - Уникальный ID
 */
function generateMessageId() {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.getRandomValues(new Uint32Array(2))
        .reduce((acc, val) => acc + val.toString(36), '');
    return `${timestamp}_${randomPart}`;
}

/**
 * Проверка поддержки Web Crypto API
 * @returns {boolean}
 */
function isCryptoSupported() {
    return !!(crypto && crypto.subtle);
}

// ============================================================================
// ЭКСПОРТ
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CRYPTO_CONFIG,
        generateSalt,
        deriveMasterKey,
        deriveMessageKey,
        encryptMessageAES,
        decryptMessageAES,
        encryptFullMessage,
        decryptFullMessage,
        uint8ArrayToBase64,
        base64ToUint8Array,
        generateMessageId,
        isCryptoSupported
    };
}

// Для использования в браузере
if (typeof window !== 'undefined') {
    window.CryptoUtils = {
        CRYPTO_CONFIG,
        generateSalt,
        deriveMasterKey,
        deriveMessageKey,
        encryptMessageAES,
        decryptMessageAES,
        encryptFullMessage,
        decryptFullMessage,
        uint8ArrayToBase64,
        base64ToUint8Array,
        generateMessageId,
        isCryptoSupported
    };
}
