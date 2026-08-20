/**
 * Client Messenger - Хранилище ключевой идентичности E2EE
 * @version 1.0.0
 * @description Хранит пару ключей ECDH пользователя в IndexedDB.
 *
 * ВАЖНО: приватный ключ хранится как non-extractable CryptoKey объект —
 * IndexedDB умеет сохранять такие объекты напрямую (structured clone),
 * при этом сырые байты приватного ключа никогда не попадают в JS-код,
 * localStorage или куда-либо ещё. Это защищает ключ даже в случае XSS,
 * так как атакующий код не сможет "экспортировать" non-extractable ключ.
 *
 * ОГРАНИЧЕНИЕ: ключ привязан к конкретному браузеру/устройству. При входе
 * с нового устройства генерируется новая пара ключей и старые зашифрованные
 * переписки, ключ к которым был обёрнут под старый публичный ключ, станут
 * недоступны для чтения на новом устройстве (нет синхронизации ключей между
 * устройствами - это осознанный компромисс для базовой версии E2EE).
 */

'use strict';

const E2EE_DB_NAME = 'messenger_e2ee_identity';
const E2EE_DB_VERSION = 1;
const E2EE_STORE = 'identities';

function openIdentityDB() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            return reject(new Error('IndexedDB не поддерживается в этом браузере'));
        }
        const request = indexedDB.open(E2EE_DB_NAME, E2EE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(E2EE_STORE)) {
                db.createObjectStore(E2EE_STORE, { keyPath: 'username' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Получить сохранённую пару ключей для пользователя (если есть)
 * @param {string} username
 * @returns {Promise<{privateKey: CryptoKey, publicKeyBase64: string}|null>}
 */
async function getStoredIdentity(username) {
    try {
        const db = await openIdentityDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(E2EE_STORE, 'readonly');
            const store = tx.objectStore(E2EE_STORE);
            const req = store.get(username);
            req.onsuccess = () => {
                const record = req.result;
                if (!record) return resolve(null);
                resolve({ privateKey: record.privateKey, publicKeyBase64: record.publicKeyBase64 });
            };
            req.onerror = () => reject(req.error);
        });
    } catch (error) {
        console.error('❌ getStoredIdentity error:', error);
        return null;
    }
}

/**
 * Сохранить пару ключей для пользователя
 * @param {string} username
 * @param {CryptoKey} privateKey - non-extractable CryptoKey
 * @param {string} publicKeyBase64
 */
async function storeIdentity(username, privateKey, publicKeyBase64) {
    const db = await openIdentityDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(E2EE_STORE, 'readwrite');
        const store = tx.objectStore(E2EE_STORE);
        const req = store.put({ username, privateKey, publicKeyBase64 });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Удалить локальную ключевую пару пользователя (например, при выходе
 * "со всех устройств" или явном сбросе ключей шифрования)
 * @param {string} username
 */
async function clearIdentity(username) {
    try {
        const db = await openIdentityDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(E2EE_STORE, 'readwrite');
            const store = tx.objectStore(E2EE_STORE);
            const req = store.delete(username);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (error) {
        console.error('❌ clearIdentity error:', error);
        return false;
    }
}

if (typeof window !== 'undefined') {
    window.E2EEIdentityStore = {
        getStoredIdentity,
        storeIdentity,
        clearIdentity
    };
}
