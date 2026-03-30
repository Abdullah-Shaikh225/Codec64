/**
 * pngHandler.js  — FIXED VERSION
 *
 * Root-cause fixes:
 *  1. readPNGPayload now searches the ENTIRE file for the marker,
 *     not just from findIEND() offset — IEND detection was fragile and
 *     could return -1 on valid PNGs, making the tail search never run.
 *  2. TextDecoder latin1 replaced with manual charCodeAt loop for the
 *     payload decode — avoids browser inconsistencies with latin1 alias.
 *  3. appendPayloadToPNG now writes a 4-byte length prefix before the
 *     payload so readPNGPayload can verify it read the exact right amount.
 *  4. findIEND is more defensive and handles chunked iteration correctly.
 */

// ── PNG signature ─────────────────────────────────────────────────────────────
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function isPNG(bytes) {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  return true;
}

// ── Magic marker — 16 bytes, unique, can't appear in base64 ──────────────────
const MARKER_STR = 'B64CODEC::START\x00';

function markerBytes() {
  const b = new Uint8Array(MARKER_STR.length);
  for (let i = 0; i < MARKER_STR.length; i++) b[i] = MARKER_STR.charCodeAt(i) & 0xff;
  return b;
}

// ── Writer ────────────────────────────────────────────────────────────────────
/**
 * Appends [marker + 4-byte-length + payload] after the PNG IEND chunk.
 * The length prefix lets the reader verify it got everything.
 *
 * @param {Uint8Array} pngBytes
 * @param {string}     payload   ASCII base64 data URL
 * @returns {Uint8Array}
 */
function appendPayloadToPNG(pngBytes, payload) {
  const marker  = markerBytes();

  // Encode payload as bytes
  const payLen  = payload.length;
  const payBuf  = new Uint8Array(payLen);
  for (let i = 0; i < payLen; i++) payBuf[i] = payload.charCodeAt(i) & 0xff;

  // 4-byte big-endian length prefix
  const lenBuf = new Uint8Array(4);
  lenBuf[0] = (payLen >>> 24) & 0xff;
  lenBuf[1] = (payLen >>> 16) & 0xff;
  lenBuf[2] = (payLen >>>  8) & 0xff;
  lenBuf[3] =  payLen         & 0xff;

  const out = new Uint8Array(pngBytes.length + marker.length + 4 + payLen);
  out.set(pngBytes,           0);
  out.set(marker,             pngBytes.length);
  out.set(lenBuf,             pngBytes.length + marker.length);
  out.set(payBuf,             pngBytes.length + marker.length + 4);
  return out;
}

// ── Reader ────────────────────────────────────────────────────────────────────
/**
 * Searches the ENTIRE file for the marker (after PNG signature).
 * This is intentionally broad — IEND-detection failures won't block recovery.
 *
 * Falls back to legacy tEXt chunk for files made with the old method.
 *
 * @param  {Uint8Array} bytes
 * @returns {string|null}
 */
function readPNGPayload(bytes) {
  if (!isPNG(bytes)) return null;

  const marker = markerBytes();
  const mLen   = marker.length;

  // ── Strategy 1: scan whole file for marker ─────────────────────────────
  // Start at byte 8 (after PNG sig) to avoid false positives in the sig itself.
  const searchEnd = bytes.length - mLen;
  for (let i = 8; i <= searchEnd; i++) {
    // Quick first-byte check before full comparison
    if (bytes[i] !== marker[0]) continue;

    let match = true;
    for (let j = 1; j < mLen; j++) {
      if (bytes[i + j] !== marker[j]) { match = false; break; }
    }
    if (!match) continue;

    // Marker found at position i
    const afterMarker = i + mLen;

    // Read 4-byte length prefix if present
    if (afterMarker + 4 <= bytes.length) {
      const payLen = ((bytes[afterMarker]     << 24) |
                      (bytes[afterMarker + 1] << 16) |
                      (bytes[afterMarker + 2] <<  8) |
                       bytes[afterMarker + 3]) >>> 0;

      const payStart = afterMarker + 4;
      const payEnd   = payStart + payLen;

      if (payLen > 0 && payEnd <= bytes.length) {
        // Decode bytes → string without TextDecoder to avoid latin1 quirks
        const chars = new Array(payLen);
        for (let k = 0; k < payLen; k++) chars[k] = String.fromCharCode(bytes[payStart + k]);
        const result = chars.join('');
        if (result.startsWith('data:')) return result;
      }
    }

    // Fallback: no length prefix (old builds) — read until end of file
    const tail = bytes.slice(afterMarker);
    const chars = new Array(tail.length);
    for (let k = 0; k < tail.length; k++) chars[k] = String.fromCharCode(tail[k]);
    const result = chars.join('');
    if (result.startsWith('data:')) return result;
  }

  // ── Strategy 2: tEXt chunk (legacy fallback) ────────────────────────────
  return readPNGTextChunk(bytes, 'b64codec');
}

// ── IEND finder (kept, used by nothing critical now but kept for compat) ───────
function findIEND(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len  = readU32(bytes, offset);
    const type = readStr(bytes, offset + 4, 4);
    if (type === 'IEND') return offset;
    if (len > bytes.length) break;
    offset += 12 + len;
  }
  return -1;
}

// ── Legacy tEXt reader ────────────────────────────────────────────────────────
function readPNGTextChunk(bytes, keyword) {
  if (!isPNG(bytes)) return null;
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const len  = readU32(bytes, offset);
    const type = readStr(bytes, offset + 4, 4);
    const ds   = offset + 8;
    const de   = ds + len;

    if (de > bytes.length) break;

    if (type === 'tEXt') {
      let nullPos = -1;
      for (let i = ds; i < de; i++) {
        if (bytes[i] === 0) { nullPos = i; break; }
      }
      if (nullPos !== -1) {
        const kw = readStr(bytes, ds, nullPos - ds);
        if (kw === keyword) {
          const chars = new Array(de - nullPos - 1);
          for (let k = 0; k < chars.length; k++) chars[k] = String.fromCharCode(bytes[nullPos + 1 + k]);
          return chars.join('');
        }
      }
    }

    if (type === 'IEND') break;
    offset = de + 4;
  }
  return null;
}

// ── Chunk builder ─────────────────────────────────────────────────────────────
function buildPNGChunk(type, data) {
  const len = data.length;
  const c   = new Uint8Array(12 + len);
  c[0] = (len >>> 24) & 0xff; c[1] = (len >>> 16) & 0xff;
  c[2] = (len >>>  8) & 0xff; c[3] =  len         & 0xff;
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(data, 8);
  const crc = crc32(c.slice(4, 8 + len));
  c[8  + len] = (crc >>> 24) & 0xff; c[9  + len] = (crc >>> 16) & 0xff;
  c[10 + len] = (crc >>>  8) & 0xff; c[11 + len] =  crc         & 0xff;
  return c;
}

// ── CRC-32 ────────────────────────────────────────────────────────────────────
function crc32(buf) {
  if (!crc32._table) {
    crc32._table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32._table[i] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crc32._table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Byte helpers ──────────────────────────────────────────────────────────────
function readU32(b, o) {
  return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
}
function readStr(b, o, n) {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}
