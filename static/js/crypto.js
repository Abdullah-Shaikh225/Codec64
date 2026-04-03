/**
 * crypto.js — Client-side AES-GCM-256 encryption via Web Crypto API
 *
 * FIX: Added secure-context guard at module load time.
 * crypto.subtle is undefined on HTTP or in restricted iframes — calling
 * encryptData/decryptData without this check throws a cryptic TypeError.
 * We surface a clear message instead so the UI can catch and display it.
 */

if (!window.crypto?.subtle) {
    // Surface a readable error rather than a confusing "Cannot read properties of undefined"
    const msg = 'Encryption requires a secure context (HTTPS). ' +
      'Password-protected encoding is not available on this connection.';
    window.encryptData = async () => { throw new Error(msg); };
    window.decryptData = async () => { throw new Error(msg); };
  } else {
  
  // ── Key derivation ────────────────────────────────────────────────────────────
  async function getKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('codec64-secure-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  // ── Encrypt ───────────────────────────────────────────────────────────────────
  window.encryptData = async function encryptData(plaintext, password) {
    const key = await getKey(password);
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    return {
      iv:   Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };
  };
  
  // ── Decrypt ───────────────────────────────────────────────────────────────────
  window.decryptData = async function decryptData(encryptedObj, password) {
    const key  = await getKey(password);
    const iv   = new Uint8Array(encryptedObj.iv);
    const data = new Uint8Array(encryptedObj.data);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  };
  
  } // end secure-context else block