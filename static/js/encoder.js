/**
 * encoder.js
 * Responsible for:
 *  - Reading an image File via FileReader → base64 data URL
 *  - Fetching an image from a URL via corsproxy.io
 *  - Exposing the encoded result by writing to the shared `state` object
 *
 * Depends on: state (ui.js), ui helpers: announce, showToast, setStep,
 *             formatBytes (ui.js), updateAdv (ui.js)
 */

// ── PNG canvas layout constants ───────────────────────────────────────────────
// All numbers that control how the "string PNG" looks live here.
// Change these and nothing else to adjust the output image layout.
const PNG_CANVAS = {
  WIDTH: 1200,           // canvas pixel width
  PADDING: 36,           // left / right / top padding in pixels
  FONT_SIZE: 13,         // monospace font size (px)
  LINE_HEIGHT_MUL: 1.65  // line height = FONT_SIZE × this multiplier
};
// Derived: characters that fit on one line
PNG_CANVAS.CHARS_PER_LINE = Math.floor(
  (PNG_CANVAS.WIDTH - PNG_CANVAS.PADDING * 2) / (PNG_CANVAS.FONT_SIZE * 0.605)
);
PNG_CANVAS.LINE_HEIGHT = PNG_CANVAS.FONT_SIZE * PNG_CANVAS.LINE_HEIGHT_MUL;

// ── URL fetch ─────────────────────────────────────────────────────────────────
/**
 * Loads an image from a URL through corsproxy.io, then hands it to handleFile().
 * Uses try/finally so the button is always re-enabled and the blob URL is
 * always revoked — no memory leak regardless of success or failure.
 */
async function fetchFromURL() {
  const url    = document.getElementById('urlInput').value.trim();
  const errEl  = document.getElementById('urlErr');
  const btn    = document.getElementById('urlBtn');
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

    // Create a File from the blob so handleFile() can read its name + type
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
    // Always revoke — prevents memory leak on both success and failure paths
    if (blobURL) URL.revokeObjectURL(blobURL);
    btn.disabled = false;
    btn.textContent = '↗ Load';
  }
}

// ── File handler ──────────────────────────────────────────────────────────────
/**
 * Reads an image File via FileReader, stores the resulting data URL in
 * state.encoded, and updates the UI to show the preview + save section.
 * @param {File} file
 */
function handleFile(file) {
  if (!file) return;
  const warnEl = document.getElementById('sizeWarn');

  // Size warnings — clipboard is unreliable for large strings
  if (file.size > 5 * 1024 * 1024) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = '⚠ Large file (' + formatBytes(file.size) + '): encoded string will be ~' +
      formatBytes(Math.ceil(file.size * 1.37)) +
      '. Clipboard copy may fail — the Download PNG option is safer.';
  } else if (file.size > 500 * 1024) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = 'ℹ Medium file (' + formatBytes(file.size) + '): encoded string will be ~' +
      formatBytes(Math.ceil(file.size * 1.37)) + '. Both save options will work fine.';
  } else {
    warnEl.style.display = 'none';
  }

  const reader = new FileReader();
  reader.onload = e => {
    // Write to centralised state — never use a loose global
    state.encoded = e.target.result;

    // Update preview strip
    const img = document.getElementById('previewImg');
    img.src = state.encoded;
    img.alt = 'Preview of ' + file.name;
    document.getElementById('imgName').textContent = file.name;
    document.getElementById('imgSize').textContent = formatBytes(file.size);
    document.getElementById('imgStrip').style.display = 'block';

    // Show save section, reset previous state
    document.getElementById('saveSection').style.display = 'block';
    document.getElementById('copyAlert').style.display = 'none';
    document.getElementById('genPreview').style.display = 'none';
    document.getElementById('copyBadge').textContent = 'Tap to copy';
    document.getElementById('pngBadge').textContent = 'Tap to download';
    document.getElementById('copyCard').classList.remove('done');
    document.getElementById('pngCard').classList.remove('done');

    // Revoke old PNG blob URL to free memory before the next one is created
    if (state.pngBlobURL) { URL.revokeObjectURL(state.pngBlobURL); state.pngBlobURL = ''; }

    updateAdv();
    setStep(2);
    announce('Image encoded: ' + file.name + ', ' + formatBytes(file.size) + '. Choose how to save it.');
    setTimeout(() => document.getElementById('saveSection')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  };
  reader.readAsDataURL(file);
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────
/**
 * Copies the encoded data URL to the clipboard using the mobile-safe
 * mobileClipboard() helper defined in ui.js.
 * @param {HTMLElement} card  The action card element (receives .done class on success)
 */
function doCopy(card) {
  if (!state.encoded) return;
  const badge   = document.getElementById('copyBadge');
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

// ── Build + download the string-PNG ──────────────────────────────────────────
/**
 * Kicks off buildStringPNG() in a short setTimeout (keeps UI responsive),
 * then shows the download preview panel.
 * @param {HTMLElement} card  The action card element
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
      badge.textContent = '✓ Ready — download below';
      card.classList.add('done');
      document.getElementById('genPreview').style.display = 'block';
      document.getElementById('genPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      showToast('PNG ready — tap Download!');
      announce('PNG file is ready. Scroll down and tap Download PNG.');
      setStep(3);
    } catch (e) {
      badge.textContent = '⚠ Error';
      showToast('Error: ' + e.message, true);
      announce('Error building PNG: ' + e.message);
    }
    card.style.pointerEvents = '';
  }, 30);
}

/**
 * Renders the base64 string as a visible text image on a canvas, then injects
 * the raw string into a PNG tEXt metadata chunk so pngHandler.js can recover it.
 *
 * Encoding note — PNG tEXt chunks use latin1 (ISO 8859-1), not UTF-8.
 * Base64 output is pure ASCII (A–Z, a–z, 0–9, +, /, =) which is a strict
 * subset of latin1, so there is zero data loss. The writer (strToBytes, which
 * uses charCodeAt & 0xff) and the reader in pngHandler.js (TextDecoder 'latin1')
 * are intentionally matched. Do NOT change the reader to UTF-8 without also
 * changing this writer, or multi-byte characters will be silently corrupted.
 *
 * @param {string} text  Full data URL (data:image/...;base64,...)
 */
function buildStringPNG(text) {
  const { WIDTH: CW, PADDING: PAD, FONT_SIZE: FS, LINE_HEIGHT: LH, CHARS_PER_LINE: CPL } = PNG_CANVAS;

  // Break the string into fixed-width lines for the canvas display
  const lines = [];
  for (let i = 0; i < text.length; i += CPL) lines.push(text.slice(i, i + CPL));

  // Decorative header block shown inside the image
  const header = [
    '// BASE64 ENCODED STRING — Generated: ' + new Date().toISOString(),
    `// Characters: ${text.length.toLocaleString()} — Metadata key: b64codec`,
    '// ─────────────────────────────────────────────────────────────',
    ''
  ];

  const all = [...header, ...lines];
  // Canvas height: padding top + all lines × line height + padding bottom
  const CH = Math.ceil(PAD * 2 + all.length * LH + PAD);

  const canvas = document.getElementById('stringCanvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d');

  // Background fill
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, CW, CH);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(124,106,255,.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
  for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }

  // Three-colour top accent stripe
  ctx.fillStyle = '#7c6aff'; ctx.fillRect(0, 0, CW * 0.33, 2);
  ctx.fillStyle = '#ff6a9e'; ctx.fillRect(CW * 0.33, 0, CW * 0.33, 2);
  ctx.fillStyle = '#6affdb'; ctx.fillRect(CW * 0.66, 0, CW * 0.34, 2);

  // Render each text line
  ctx.font = `${FS}px "Courier New",monospace`;
  ctx.textBaseline = 'top';
  all.forEach((line, i) => {
    const y = PAD + i * LH;
    const isHeader = i < header.length - 1;
    const isSep    = i === header.length - 1;
    if (isHeader)     ctx.fillStyle = '#6affdb';
    else if (isSep)   ctx.fillStyle = 'transparent';
    else              ctx.fillStyle = (Math.floor((i - header.length) / 4) % 2 === 0) ? '#9d8fff' : '#7c6aff';
    ctx.fillText(line, PAD, y);
  });

  // Footer bar
  ctx.fillStyle = 'rgba(106,255,219,.15)';
  ctx.fillRect(0, CH - 28, CW, 28);
  ctx.fillStyle = '#6affdb';
  ctx.font = '12px "Courier New",monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(`base64-string · ${text.length.toLocaleString()} chars · metadata embedded`, PAD, CH - 14);

  // ── Inject the string into a PNG tEXt chunk ───────────────────────────────
  const pngDataURL = canvas.toDataURL('image/png');
  const pngBytes   = b64ToBytes(pngDataURL.split(',')[1]);

  // keyword + NUL separator + data (all latin1 — see encoding note above)
  const chunkData = strToBytes('b64codec\0' + text);
  const chunk     = buildPNGChunk('tEXt', chunkData);

  // Insert tEXt chunk immediately after the IHDR chunk (bytes 0–32)
  const IHDR_END = 33;
  const final = new Uint8Array(pngBytes.length + chunk.length);
  final.set(pngBytes.slice(0, IHDR_END));
  final.set(chunk, IHDR_END);
  final.set(pngBytes.slice(IHDR_END), IHDR_END + chunk.length);

  const blob = new Blob([final], { type: 'image/png' });

  // Revoke old URL before storing the new one — prevents memory leak
  if (state.pngBlobURL) URL.revokeObjectURL(state.pngBlobURL);
  state.pngBlobURL = URL.createObjectURL(blob);

  document.getElementById('genMeta').textContent = `${CW}×${CH}px · data hidden in file metadata`;
}

/** Triggers the browser download for the string-PNG blob. */
function downloadStringImage() {
  if (!state.pngBlobURL) return;
  const a = document.createElement('a');
  a.href = state.pngBlobURL;
  a.download = 'base64-string.png';
  a.click();
  showToast('Downloaded base64-string.png!');
  announce('Download started: base64-string.png');
}

/** Shortcuts: immediately restores the image in the decode section. */
function quickDecode() {
  if (!state.encoded) return;
  document.getElementById('pasteArea').value = state.encoded;
  document.querySelector('details').open = true;
  decodeFromPaste();
  document.getElementById('decodeCard').scrollIntoView({ behavior: 'smooth' });
}

/** Resets the encode section back to its initial state. */
function clearAll() {
  if (state.pngBlobURL) { URL.revokeObjectURL(state.pngBlobURL); state.pngBlobURL = ''; }
  state.encoded = '';

  document.getElementById('fileInput').value = '';
  document.getElementById('urlInput').value = '';
  ['imgStrip', 'saveSection', 'sizeWarn', 'urlErr', 'copyAlert', 'genPreview']
    .forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById('copyCard').classList.remove('done');
  document.getElementById('pngCard').classList.remove('done');

  updateAdv();
  setStep(1);
  announce('Cleared. Ready to upload a new image.');
}

// ── Binary utilities (used by buildStringPNG) ─────────────────────────────────
/**
 * Converts a latin1 string to a Uint8Array byte-by-byte.
 * Uses charCodeAt & 0xff — matches TextDecoder('latin1') in pngHandler.js.
 */
function strToBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** Decodes a base64 string to a Uint8Array. */
function b64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/** Auto-detects MIME type from the first bytes of a base64 string. */
function detectMime(b64) {
  try {
    const r = atob(b64.substring(0, 16));
    const b = r.split('').map(c => c.charCodeAt(0));
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
    if (b[0] === 0x3C)                  return 'image/svg+xml';
  } catch (e) { /* fall through */ }
  return 'image/jpeg';
}
