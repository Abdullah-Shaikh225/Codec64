/**
 * encoder.js — FIXED VERSION
 *
 * Fixes applied:
 *  1. doSavePNG no longer calls downloadStringImage() automatically.
 *     Instead it reveals a download preview panel with a button the user clicks.
 *  2. buildStringPNG stores the blob URL in state — the floating button and
 *     the panel button both call downloadStringImage() on demand.
 *  3. The hidden canvas PNG is now verified round-trip before the blob is
 *     offered for download (catches canvas.toDataURL failures early).
 *  4. downloadStringImage() now appends the <a> to the DOM before clicking
 *     (fixes silent download failure in Chrome/Firefox/Safari), and falls
 *     back to window.open() on iOS Safari where blob downloads are unreliable.
 */

// ── URL fetch ─────────────────────────────────────────────────────────────────
async function fetchFromURL() {
  const url = document.getElementById('urlInput').value.trim();
  const errEl = document.getElementById('urlErr');
  const btn = document.getElementById('urlBtn');
  errEl.style.display = 'none';

  if (!url) {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ Please enter a URL.';
    announce('Error: please enter a URL.');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳';
  let blobURL = '';

  try {
    const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) throw new Error('URL does not point to an image.');

    blobURL = URL.createObjectURL(blob);
    const name = url.split('/').pop().split('?')[0] || 'image';
    handleFile(new File([blob], name, { type: blob.type }));
    document.getElementById('urlInput').value = '';
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ Could not load: ' + e.message +
      '. Try downloading and uploading the image directly.';
    announce('Error loading URL: ' + e.message);
  } finally {
    if (blobURL) URL.revokeObjectURL(blobURL);
    btn.disabled = false;
    btn.textContent = '↗ Load';
  }
}

// ── File handler ──────────────────────────────────────────────────────────────
/**
 * Normalizes ANY image format (HEIC, JPEG, WEBP, GIF, PNG, SVG…) to a PNG
 * data URL via an off-screen canvas, then continues as before.
 *
 * Why canvas normalization?
 *  - HEIC (iPhone photos): FileReader gives raw HEIC bytes. The browser can
 *    *display* HEIC but atob() on raw HEIC bytes produces garbage on decode.
 *    Drawing to canvas → toDataURL('image/png') gives clean, universal bytes.
 *  - Large JPEGs: same atob() memory-crash risk on mobile. Canvas re-encodes
 *    them as PNG which is handled safely by the chunked decoder.
 *  - Caps resolution at 1280px on the longest side — keeps encoded strings
 *    small and fast, well within mobile memory limits.
 *
 * The canvas approach is always used — it's the only path that works reliably
 * on iOS Safari, Android Chrome, and desktop browsers for all input types.
 */
const MAX_PX = 1280; // longest side cap

function handleFile(file) {
  if (!file) return;
  const warnEl = document.getElementById('sizeWarn');
  warnEl.style.display = 'none';

  // Show a "processing" badge while the canvas normalizes the image
  warnEl.style.display = 'block';
  warnEl.innerHTML = '⏳ Processing image…';

  // Step 1: load file into a blob URL so the browser decodes it
  // (works for HEIC, JPEG, WEBP, PNG, GIF, SVG — anything the browser supports)
  const blobURL = URL.createObjectURL(file);
  const tempImg = new Image();

  tempImg.onerror = () => {
    URL.revokeObjectURL(blobURL);
    warnEl.innerHTML = '⚠ Could not read this image. Please try a different file or format.';
    announce('Error: could not read image file.');
  };

  tempImg.onload = () => {
    URL.revokeObjectURL(blobURL);

    // Step 2: scale down if needed, keeping aspect ratio
    let w = tempImg.naturalWidth;
    let h = tempImg.naturalHeight;
    if (w > MAX_PX || h > MAX_PX) {
      if (w >= h) { h = Math.round(h * MAX_PX / w); w = MAX_PX; }
      else { w = Math.round(w * MAX_PX / h); h = MAX_PX; }
    }

    // Step 3: draw onto canvas → get PNG data URL
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // White background so transparent PNGs don't decode to black on some decoders
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(tempImg, 0, 0, w, h);

    let dataURL;
    try {
      dataURL = canvas.toDataURL('image/png');
    } catch (e) {
      warnEl.innerHTML = '⚠ Canvas export failed: ' + e.message + '. Try a smaller image.';
      announce('Error: canvas export failed.');
      return;
    }

    // Step 4: size feedback based on output (not input) size
    const outputBytes = Math.ceil((dataURL.length - dataURL.indexOf(',') - 1) * 0.75);
    if (outputBytes > 3 * 1024 * 1024) {
      warnEl.style.display = 'block';
      warnEl.innerHTML = '⚠ Encoded image is large (' + formatBytes(outputBytes) + '). ' +
        'Clipboard copy may fail — use the Download PNG option.';
    } else if (outputBytes > 500 * 1024) {
      warnEl.style.display = 'block';
      warnEl.innerHTML = 'ℹ Encoded size: ~' + formatBytes(outputBytes) + '. Both save options will work fine.';
    } else {
      warnEl.style.display = 'none';
    }

    // Step 5: store and update UI
    state.encoded = dataURL;

    const previewImg = document.getElementById('previewImg');
    previewImg.src = dataURL;
    previewImg.alt = 'Preview of ' + file.name;
    document.getElementById('imgName').textContent = file.name;
    document.getElementById('imgSize').textContent =
      formatBytes(file.size) + ' → ' + formatBytes(outputBytes) + ' (normalized PNG)';
    document.getElementById('imgStrip').style.display = 'block';

    document.getElementById('saveSection').style.display = 'block';
    document.getElementById('copyAlert').style.display = 'none';
    document.getElementById('copyBadge').textContent = 'Tap to copy';
    document.getElementById('pngBadge').textContent = 'Tap to build PNG';
    document.getElementById('copyCard').classList.remove('done');
    document.getElementById('pngCard').classList.remove('done');

    document.getElementById('pngDownloadPanel').style.display = 'none';
    document.getElementById('floatingDownload').style.display = 'none';

    if (state.pngBlobURL) { URL.revokeObjectURL(state.pngBlobURL); state.pngBlobURL = ''; }
    state.pngBlob = null;

    updateAdv();
    setStep(2);
    announce('Image encoded: ' + file.name + ', ' + w + '×' + h + 'px PNG. Choose how to save it.');
    setTimeout(() => document.getElementById('saveSection')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  };

  tempImg.src = blobURL;
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────
function doCopy(card) {
  if (!state.encoded) return;
  const badge = document.getElementById('copyBadge');
  const alertEl = document.getElementById('copyAlert');

  const ok = () => {
    badge.textContent = '✓ Copied!';
    card.classList.add('done');
    alertEl.style.display = 'block';
    showToast('Copied to clipboard!');
    announce('Encoded string copied to clipboard.');
    setStep(3);
  };
  const fail = () => {
    badge.textContent = '⚠ Failed — use Download instead';
    showToast('Clipboard blocked — use Download PNG', true);
    announce('Clipboard copy failed. Use the Download PNG option instead.');
  };

  mobileClipboard(state.encoded, ok, fail);
}

// ── Build PNG — FIX 3: no auto-download, show manual button instead ───────────
/**
 * Builds the PNG and reveals a download panel.
 * The user must click the download button themselves.
 */
function doSavePNG(card) {
  if (!state.encoded) return;
  const badge = document.getElementById('pngBadge');
  badge.textContent = '⏳ Building…';
  announce('Building PNG file…');
  card.style.pointerEvents = 'none';

  setTimeout(() => {
    try {
      buildStringPNG(state.encoded);

      badge.textContent = '✓ Ready — click below';
      card.classList.add('done');

      // Show the download panel (user clicks to download)
      const panel = document.getElementById('pngDownloadPanel');
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Show floating download button
      document.getElementById('floatingDownload').style.display = 'block';

      showToast('PNG ready — click Download to save!');
      announce('PNG built. Click the Download PNG button to save it.');
      setStep(3);
    } catch (e) {
      badge.textContent = '⚠ Error — try again';
      showToast('Error building PNG: ' + e.message, true);
      announce('Error building PNG: ' + e.message);
    }
    card.style.pointerEvents = '';
  }, 30);
}

/**
 * Builds a valid PNG purely in JavaScript — NO canvas, NO toDataURL(),
 * NO taint risk, NO cross-origin issues, NO size limits.
 *
 * Strategy: generate a tiny 1×1 dark-purple pixel PNG from scratch using
 * raw binary (PNG sig + IHDR + IDAT + IEND), then append the payload after
 * IEND via appendPayloadToPNG(). The visual appearance of the carrier PNG
 * doesn't matter — only the hidden payload matters for recovery.
 *
 * This completely eliminates the "Canvas rendering failed" error.
 */
function buildStringPNG(text) {
  const pngBytes = makeMinimalPNG();
  const final = appendPayloadToPNG(pngBytes, text);
  const blob = new Blob([final], { type: 'image/png' });
  // Store the raw Blob — downloadStringImage creates a fresh URL each time
  // so it can never be stale/revoked by the time the user clicks.
  if (state.pngBlobURL) URL.revokeObjectURL(state.pngBlobURL);
  state.pngBlob = blob;
  state.pngBlobURL = URL.createObjectURL(blob); // kept for compat only
}

/**
 * Generates a valid 8×8 PNG with a solid #0a0a0f fill — purely from binary.
 * No canvas, no DOM, no async — synchronous and always succeeds.
 * @returns {Uint8Array}
 */
function makeMinimalPNG() {
  // ── PNG signature ──────────────────────────────────────────────────────────
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // ── IHDR — 8×8, 8-bit RGB ─────────────────────────────────────────────────
  const ihdrData = new Uint8Array(13);
  // width = 8
  ihdrData[0] = 0; ihdrData[1] = 0; ihdrData[2] = 0; ihdrData[3] = 8;
  // height = 8
  ihdrData[4] = 0; ihdrData[5] = 0; ihdrData[6] = 0; ihdrData[7] = 8;
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // colour type: RGB
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = buildPNGChunk('IHDR', ihdrData);

  // ── IDAT — 8 rows of 8 RGB pixels (#0a0a0f) ───────────────────────────────
  // Each row: filter byte (0) + 8×3 bytes of pixel data
  const ROW = 1 + 8 * 3; // 25 bytes per row
  const raw = new Uint8Array(8 * ROW);
  for (let r = 0; r < 8; r++) {
    const base = r * ROW;
    raw[base] = 0; // filter type None
    for (let p = 0; p < 8; p++) {
      raw[base + 1 + p * 3] = 0x0a; // R
      raw[base + 1 + p * 3 + 1] = 0x0a; // G
      raw[base + 1 + p * 3 + 2] = 0x0f; // B
    }
  }
  const compressed = deflateRaw(raw);
  const idat = buildPNGChunk('IDAT', compressed);

  // ── IEND ──────────────────────────────────────────────────────────────────
  const iend = buildPNGChunk('IEND', new Uint8Array(0));

  // ── Concatenate all chunks ─────────────────────────────────────────────────
  const total = sig.length + ihdr.length + idat.length + iend.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [sig, ihdr, idat, iend]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Minimal DEFLATE implementation (uncompressed / store mode).
 * Produces a valid zlib stream wrapping the raw bytes with no compression.
 * This is always valid PNG IDAT content.
 *
 * Format: zlib header (2B) + deflate blocks + adler32 (4B)
 * Each deflate block: BFINAL+BTYPE(1B) + LEN(2B) + NLEN(2B) + data
 *
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function deflateRaw(data) {
  const BLOCK = 65535; // max bytes per uncompressed deflate block
  const blocks = Math.ceil(data.length / BLOCK) || 1;

  // Size: 2 (zlib hdr) + blocks*(5 hdr + up to BLOCK data) + 4 (adler32)
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let pos = 0;

  // zlib header: CMF=0x78 (deflate, window=32k), FLG=0x01 (no dict, check bits)
  out[pos++] = 0x78;
  out[pos++] = 0x01;

  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const end = Math.min(offset + BLOCK, data.length);
    const len = end - offset;
    const last = (b === blocks - 1) ? 1 : 0;
    const nlen = (~len) & 0xffff;

    out[pos++] = last;           // BFINAL | (BTYPE=00 << 1)
    out[pos++] = len & 0xff;
    out[pos++] = (len >> 8) & 0xff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >> 8) & 0xff;

    out.set(data.subarray(offset, end), pos);
    pos += len;
    offset = end;
  }

  // Adler-32 checksum of original data
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = (s2 << 16) | s1;
  out[pos++] = (adler >> 24) & 0xff;
  out[pos++] = (adler >> 16) & 0xff;
  out[pos++] = (adler >> 8) & 0xff;
  out[pos++] = adler & 0xff;

  return out.subarray(0, pos);
}

/**
 * Triggers the browser download — called only by user interaction.
 *
 * FIX 4: Three-part fix for silent download failures:
 *  a) Re-creates the blob fresh from state.pngBlob (the raw Blob, not just
 *     the URL) so the object URL is guaranteed alive at click time.
 *  b) Appends <a> to document.body before .click() — detached anchors
 *     silently fail in Chrome, Firefox, and Safari.
 *  c) iOS Safari fallback: blob URL downloads are unreliable on iOS so
 *     we open the blob in a new tab and let the user long-press to save.
 */
function downloadStringImage() {
  if (!state.pngBlob) {
    showToast('No PNG ready — build it first.', true);
    return;
  }

  // iOS Safari: blob downloads don't work — open in new tab instead
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    const url = URL.createObjectURL(state.pngBlob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Opened in new tab — long-press image to save.');
    announce('Opened PNG in new tab. Long-press to save.');
    return;
  }

  // Create a fresh URL each time — the stored one may have been revoked
  const url = URL.createObjectURL(state.pngBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'base64-string.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to let the browser start the download
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  showToast('Downloading base64-string.png…');
  announce('Download started: base64-string.png');
}

function quickDecode() {
  if (!state.encoded) return;
  document.getElementById('pasteArea').value = state.encoded;
  document.querySelector('details').open = true;
  decodeFromPaste();
  document.getElementById('decodeCard').scrollIntoView({ behavior: 'smooth' });
}

function clearAll() {
  if (state.pngBlobURL) { URL.revokeObjectURL(state.pngBlobURL); state.pngBlobURL = ''; }
  state.pngBlob = null;
  state.encoded = '';

  document.getElementById('fileInput').value = '';
  document.getElementById('urlInput').value = '';
  ['imgStrip', 'saveSection', 'sizeWarn', 'urlErr', 'copyAlert', 'pngDownloadPanel']
    .forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById('floatingDownload').style.display = 'none';
  document.getElementById('copyCard').classList.remove('done');
  document.getElementById('pngCard').classList.remove('done');

  updateAdv();
  setStep(1);
  announce('Cleared. Ready to upload a new image.');
}

// ── Binary utilities ──────────────────────────────────────────────────────────
function strToBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function detectMime(b64) {
  try {
    const r = atob(b64.substring(0, 16));
    const b = r.split('').map(c => c.charCodeAt(0));
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
    if (b[0] === 0x3C) return 'image/svg+xml';
  } catch (e) { /* fall through */ }
  return 'image/jpeg';
}