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
// 🔐 E2EE: ECDH ИДЕНТИЧНОСТЬ И ОБМЕН КЛЮЧАМИ (v2.0)
// ============================================================================
// АРХИТЕКТУРА v2.0 (исправляет фундаментальную ошибку v1.0):
// Раньше ключ шифрования выводился из СОБСТВЕННОГО пароля отправителя —
// получатель не мог его расшифровать в принципе (у него другой пароль).
//
// Теперь:
// 1. У каждого пользователя есть постоянная пара ключей ECDH (P-256).
//    Приватный ключ хранится ТОЛЬКО на устройстве (IndexedDB, non-extractable),
//    публичный публикуется на сервере — сервер видит только публичные ключи.
// 2. Для переписки 1-на-1 ключ разговора — это ECDH shared secret между
//    приватным ключом одного человека и публичным ключом другого (симметрично).
// 3. Для группы генерируется случайный групповой секрет, который "оборачивается"
//    (шифруется) отдельно для каждого участника через ECDH-секрет с ним.
//    Сервер хранит только обёрнутые копии — расшифровать их не может.
// 4. Внутри разговора/группы для каждого сообщения выводится уникальный
//    Message Key через HKDF (как и раньше) — компрометация одного сообщения
//    не раскрывает остальные.

const ECDH_CURVE = 'P-256';

/**
 * Генерация новой пары ключей идентичности (ECDH P-256)
 * Приватный ключ переимпортируется как non-extractable сразу после генерации,
 * чтобы raw-байты приватного ключа не оставались в памяти/не могли быть
 * экспортированы кодом, если он вдруг это попробует (например, при XSS).
 * @returns {Promise<{privateKey: CryptoKey, publicKey: CryptoKey, publicKeyBase64: string}>}
 */
async function generateIdentityKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true, // extractable: нужно временно, чтобы экспортировать ключи ниже
        ['deriveKey', 'deriveBits']
    );

    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    // Переимпортируем приватный ключ как НЕизвлекаемый
    const nonExtractablePrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyPkcs8,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        false,
        ['deriveKey', 'deriveBits']
    );

    return {
        privateKey: nonExtractablePrivateKey,
        publicKey: keyPair.publicKey,
        publicKeyBase64: uint8ArrayToBase64(new Uint8Array(publicKeyRaw))
    };
}

/**
 * Импорт публичного ключа собеседника из base64
 * @param {string} base64 - Публичный ключ (raw, base64)
 * @returns {Promise<CryptoKey>}
 */
async function importPeerPublicKey(base64) {
    const raw = base64ToUint8Array(base64);
    return crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true,
        []
    );
}

/**
 * Вывод общего ключа разговора между двумя пользователями (ECDH -> HKDF)
 * ECDH(myPrivate, peerPublic) === ECDH(peerPrivate, myPublic), поэтому оба
 * участника независимо получают одинаковый ключ, не передавая его по сети.
 * Результат имеет тот же "тип", что и старый masterKey — им можно пользоваться
 * с существующими deriveMessageKey/encryptFullMessage/decryptFullMessage.
 * @param {CryptoKey} myPrivateKey
 * @param {CryptoKey} peerPublicKey
 * @returns {Promise<CryptoKey>}
 */
async function deriveConversationKey(myPrivateKey, peerPublicKey) {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerPublicKey },
        myPrivateKey,
        { name: 'HKDF', length: CRYPTO_CONFIG.AES_KEY_LENGTH },
        false,
        ['deriveKey']
    );
}

/**
 * Генерация случайного группового секрета (используется вместо ECDH-секрета
 * в групповых чатах, т.к. общего "пары" собеседников там нет)
 * @returns {Promise<Uint8Array>}
 */
async function generateGroupSecret() {
    return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Импорт "сырого" группового секрета как ключа, пригодного для deriveMessageKey
 * (аналог того, что возвращает deriveConversationKey/deriveMasterKey)
 * @param {Uint8Array} rawSecret
 * @returns {Promise<CryptoKey>}
 */
async function importGroupSecretKey(rawSecret) {
    return crypto.subtle.importKey('raw', rawSecret, 'HKDF', false, ['deriveKey']);
}

/**
 * "Обернуть" (зашифровать) групповой секрет для конкретного участника,
 * используя ECDH-секрет между тем, кто оборачивает, и получателем.
 * Сервер хранит только результат этой функции — расшифровать его не может.
 * @param {Uint8Array} groupSecretRaw - Сырой групповой секрет
 * @param {CryptoKey} conversationKey - ECDH-секрет (wrapper <-> получатель), из deriveConversationKey
 * @param {string} groupId - Для привязки обёртки к конкретной группе
 * @returns {Promise<{wrappedKey: string, nonce: string, salt: string}>}
 */
async function wrapGroupSecretForPeer(groupSecretRaw, conversationKey, groupId) {
    const salt = await generateSalt();
    const wrapKey = await deriveMessageKey(conversationKey, `group-key:${groupId}`, salt);
    const { encrypted, nonce } = await encryptMessageAES(uint8ArrayToBase64(groupSecretRaw), wrapKey);
    return {
        wrappedKey: encrypted,
        nonce,
        salt: uint8ArrayToBase64(salt)
    };
}

/**
 * Развернуть (расшифровать) полученную обёртку группового ключа
 * @param {{wrappedKey: string, nonce: string, salt: string}} wrapped
 * @param {CryptoKey} conversationKey - ECDH-секрет (я <-> тот, кто выдал ключ)
 * @param {string} groupId
 * @returns {Promise<Uint8Array>} - Сырой групповой секрет
 */
async function unwrapGroupSecretFromPeer(wrapped, conversationKey, groupId) {
    const salt = base64ToUint8Array(wrapped.salt);
    const wrapKey = await deriveMessageKey(conversationKey, `group-key:${groupId}`, salt);
    const base64Secret = await decryptMessageAES(wrapped.wrappedKey, wrapped.nonce, wrapKey);
    return base64ToUint8Array(base64Secret);
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
        isCryptoSupported,
        // 🔐 E2EE v2.0
        generateIdentityKeyPair,
        importPeerPublicKey,
        deriveConversationKey,
        generateGroupSecret,
        importGroupSecretKey,
        wrapGroupSecretForPeer,
        unwrapGroupSecretFromPeer
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
        isCryptoSupported,
        // 🔐 E2EE v2.0
        generateIdentityKeyPair,
        importPeerPublicKey,
        deriveConversationKey,
        generateGroupSecret,
        importGroupSecretKey,
        wrapGroupSecretForPeer,
        unwrapGroupSecretFromPeer
    };
}
