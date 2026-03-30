/**
 * pngHandler.js
 * Low-level PNG binary utilities.
 * Responsible for:
 *  - Reading tEXt metadata chunks from a PNG byte array
 *  - Building a valid tEXt chunk with CRC-32 checksum
 *  - CRC-32 implementation (required by the PNG spec for all chunks)
 *
 * Encoding contract (READ THIS before changing anything here):
 *  PNG tEXt chunks are defined by the spec to use latin1 (ISO 8859-1) encoding.
 *  Base64 output is pure ASCII (A–Z, a–z, 0–9, +, /, =) which is a strict
 *  subset of latin1, so there is no data loss.
 *  - WRITER (encoder.js → strToBytes): charCodeAt(i) & 0xff  →  latin1 bytes
 *  - READER (here → readPNGTextChunk): TextDecoder('latin1') →  latin1 string
 *  Both sides are intentionally matched. Do NOT change the reader to UTF-8
 *  without also changing the writer, or multi-byte characters will corrupt silently.
 *
 * Depends on: nothing (pure binary logic, no DOM, no state)
 */

// ── Chunk reader ──────────────────────────────────────────────────────────────
/**
 * Walks the PNG chunk list and returns the text value of the first tEXt chunk
 * whose keyword matches `keyword`, or null if not found / invalid PNG.
 *
 * Mobile safety: every array access is bounds-checked before use.
 * Without these checks, an unexpected chunk length (from a browser that
 * re-compresses the PNG on save) can send `de = ds + len` past bytes.length,
 * causing the "offset out of bounds" crash seen on mobile.
 *
 * @param  {Uint8Array} bytes    Raw PNG file bytes
 * @param  {string}     keyword  tEXt keyword to search for (e.g. 'b64codec')
 * @returns {string|null}
 */
function readPNGTextChunk(bytes, keyword) {
  // Verify the 8-byte PNG signature before doing anything else
  if (bytes.length < 8) return null;
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return null; // not a PNG
  }

  let offset = 8; // skip the 8-byte signature

  while (offset < bytes.length - 12) {
    // Guard: need at least 4 bytes for length + 4 bytes for type
    if (offset + 8 > bytes.length) break;

    const len  = readU32(bytes, offset);      // chunk data length (4 bytes)
    const type = readStr(bytes, offset + 4, 4); // chunk type  (4 bytes)
    const ds   = offset + 8;                  // chunk data start
    const de   = ds + len;                    // chunk data end

    // Guard: the declared chunk length must fit inside the file.
    // A corrupted or re-compressed PNG may report a len that overshoots
    // bytes.length — without this check we'd index out of bounds.
    if (len > bytes.length || de > bytes.length || de < ds) break;

    if (type === 'tEXt') {
      // Find the NUL byte (0x00) that separates keyword from text value
      let nullPos = -1;
      for (let i = ds; i < de; i++) {
        if (bytes[i] === 0) { nullPos = i; break; }
      }

      if (nullPos !== -1) {
        const kw = readStr(bytes, ds, nullPos - ds);
        if (kw === keyword) {
          // Decode as latin1 — matches the writer in encoder.js (see note above)
          return new TextDecoder('latin1').decode(bytes.slice(nullPos + 1, de));
        }
      }
    }

    if (type === 'IEND') break; // end of PNG — nothing more to read

    offset = de + 4; // advance: skip data + 4-byte CRC
  }

  return null;
}

// ── Chunk builder ─────────────────────────────────────────────────────────────
/**
 * Builds a complete, spec-compliant PNG chunk as a Uint8Array.
 * Structure: [length 4B][type 4B][data NB][CRC 4B]
 * The CRC covers the type + data bytes (not the length field).
 *
 * @param  {string}     type  4-character chunk type (e.g. 'tEXt')
 * @param  {Uint8Array} data  Chunk payload bytes
 * @returns {Uint8Array}
 */
function buildPNGChunk(type, data) {
  const len = data.length;
  const c   = new Uint8Array(4 + 4 + len + 4); // length + type + data + CRC

  // Length field (big-endian uint32)
  c[0] = (len >>> 24) & 0xff;
  c[1] = (len >>> 16) & 0xff;
  c[2] = (len >>>  8) & 0xff;
  c[3] =  len         & 0xff;

  // Type field (4 ASCII bytes)
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);

  // Data
  c.set(data, 8);

  // CRC-32 over type + data
  const crc = crc32(c.slice(4, 8 + len));
  c[8 + len]     = (crc >>> 24) & 0xff;
  c[9 + len]     = (crc >>> 16) & 0xff;
  c[10 + len]    = (crc >>>  8) & 0xff;
  c[11 + len]    =  crc         & 0xff;

  return c;
}

// ── CRC-32 ────────────────────────────────────────────────────────────────────
/**
 * Standard CRC-32 used by the PNG spec for chunk integrity verification.
 * Uses a lazily-built 256-entry lookup table (computed once on first call).
 *
 * @param  {Uint8Array} buf
 * @returns {number}  Unsigned 32-bit CRC
 */
function crc32(buf) {
  if (!crc32._table) {
    // Build the CRC lookup table (standard polynomial 0xEDB88320)
    crc32._table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32._table[i] = c;
    }
  }

  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crc32._table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Low-level byte helpers ────────────────────────────────────────────────────

/** Reads a big-endian unsigned 32-bit integer from bytes[offset..offset+3]. */
function readU32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Reads n bytes from bytes[offset] and returns them as a latin1 string. */
function readStr(b, o, n) {
  return Array.from(b.slice(o, o + n)).map(x => String.fromCharCode(x)).join('');
}
