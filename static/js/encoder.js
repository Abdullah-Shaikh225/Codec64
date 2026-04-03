/**
 * encoder.js
 *
 * FIXES APPLIED:
 *  1. File size warning shown in handleFile() if file > 5 MB.
 *  2. Image note now draws a dark semi-transparent background behind text
 *     so it is readable on any image, positioned at the bottom with padding.
 *  3. Dead helpers strToBytes() and b64ToBytes() removed.
 *  4. state.previewBlobURL removed — blob URL revoked immediately after preview
 *     is set (the img element holds its own reference, so it stays visible).
 *  5. state.pngBlobURL removed — downloadStringImage() creates a fresh URL
 *     from state.pngBlob each time; storing a separate URL was redundant.
 *  6. wrapText() moved to module scope so it isn't re-created on every save.
 *  7. quickDecode() targets #pasteDetails by id, not a blind querySelector.
 */

state.encodePassword = null;

// ── Pre-Upload UI ─────────────────────────────────────────────────────────────
function startNormalEncode() {
  state.encodePassword = null;
  const badge = document.getElementById('encodeTypeBadge');
  badge.textContent = '🔓 Normal Image';
  badge.style.color = 'var(--muted)';
  badge.style.background = 'rgba(255,255,255,0.05)';
  badge.style.borderColor = 'rgba(255,255,255,0.1)';
  document.getElementById('encodePreSelect').style.display = 'none';
  document.getElementById('encodePasswordSetup').style.display = 'none';
  document.getElementById('encodeMainArea').style.display = 'block';
  announce('Selected normal image encoding. Please upload your image.');
}

function showPasswordInputForEncode() {
  // Guard: no crypto.subtle in non-HTTPS context
  if (typeof encryptData === 'function') {
    // Check if it's the stub that throws
    // We'll discover this at encryption time — just warn here if not HTTPS
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      showToast('Password protection requires HTTPS.', true);
      announce('Password protection requires a secure HTTPS connection.');
      return;
    }
  }
  document.getElementById('encodePreSelect').style.display = 'none';
  document.getElementById('encodePasswordSetup').style.display = 'block';
  setTimeout(() => document.getElementById('setupPasswordInput').focus(), 50);
  announce('Selected password protected encoding. Please enter a password.');
}

function submitPasswordForEncode() {
  const pw = document.getElementById('setupPasswordInput').value;
  const errEl = document.getElementById('setupPasswordErr');
  if (!pw || pw.trim() === '') {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ Password cannot be empty.';
    return;
  }
  errEl.style.display = 'none';
  state.encodePassword = pw;

  const badge = document.getElementById('encodeTypeBadge');
  badge.textContent = '🔒 Password Protected';
  badge.style.color = 'var(--teal)';
  badge.style.background = 'rgba(106, 255, 219, .1)';
  badge.style.borderColor = 'rgba(106, 255, 219, .25)';

  document.getElementById('encodePasswordSetup').style.display = 'none';
  document.getElementById('encodeMainArea').style.display = 'block';
  announce('Password set. Please upload your image.');
}

function cancelEncodeSetup() {
  document.getElementById('setupPasswordInput').value = '';
  document.getElementById('setupPasswordErr').style.display = 'none';
  document.getElementById('encodePasswordSetup').style.display = 'none';
  document.getElementById('encodePreSelect').style.display = 'block';
}

// ── Text wrap helper (module-scope, not recreated per-save) ───────────────────
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  if (line.trim()) lines.push(line.trim());
  lines.forEach((l, i) => {
    ctx.strokeText(l, x, y + i * lineHeight);
    ctx.fillText(l, x, y + i * lineHeight);
  });
  return lines.length; // return line count so callers can compute total height
}

// ── File handler ──────────────────────────────────────────────────────────────
let uploadedImage = null;
const MAX_PX = 1280;

function handleFile(file) {
  if (!file) return;
  const warnEl = document.getElementById('sizeWarn');
  warnEl.style.display = 'none';

  // FIX: File size warning — clipboard is unreliable for strings > ~5 MB encoded
  if (file.size > 5_000_000) {
    warnEl.style.display = 'block';
    warnEl.innerHTML =
      '⚠ Large file (' + formatBytes(file.size) + ') — ' +
      '<strong>Download PNG</strong> is recommended. ' +
      'Copy to clipboard may be truncated by some apps.';
  }

  uploadedImage = file;

  const blobURL = URL.createObjectURL(file);
  const tempImg = new Image();

  tempImg.onerror = () => {
    URL.revokeObjectURL(blobURL);
    warnEl.style.display = 'block';
    warnEl.innerHTML =
      '⚠ This image format isn\'t supported directly. ' +
      '<strong>Scroll down to the Image Converter</strong> — ' +
      'convert it to JPEG or PNG first.';
    announce('Format not supported.');
    focusConverter(file);
  };

  tempImg.onload = () => {
    // FIX: Revoke immediately — the img element retains a reference; no need
    // to store it. Storing it in state was dead weight.
    URL.revokeObjectURL(blobURL);

    const previewImg = document.getElementById('previewImg');
    // Re-create a fresh URL just for the preview img src
    const previewURL = URL.createObjectURL(file);
    previewImg.onload = () => URL.revokeObjectURL(previewURL);
    previewImg.onerror = () => URL.revokeObjectURL(previewURL);
    previewImg.src = previewURL;
    previewImg.alt = 'Preview of ' + file.name;

    document.getElementById('imgName').textContent = file.name;
    document.getElementById('imgSize').textContent = formatBytes(file.size) + ' (preview)';
    document.getElementById('imgStrip').style.display = 'block';
    document.getElementById('saveSection').style.display = 'block';
    const copyAlertEl = document.getElementById('copyAlert');
    if (copyAlertEl) copyAlertEl.style.display = 'none';
    const copyBadgeEl = document.getElementById('copyBadge');
    if (copyBadgeEl) copyBadgeEl.textContent = 'Tap to copy';
    document.getElementById('pngBadge').textContent = 'Tap to build PNG';
    const copyCardEl = document.getElementById('copyCard');
    if (copyCardEl) copyCardEl.classList.remove('done');
    document.getElementById('pngCard').classList.remove('done');
    document.getElementById('pngDownloadPanel').style.display = 'none';

    // FIX: pngBlob/pngBlobURL cleanup — only pngBlob is kept now
    state.pngBlob = null;
    state.encoded = '';

    setStep(2);
    announce('Image loaded: ' + file.name + '. Choose how to save.');
    setTimeout(() => document.getElementById('saveSection')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  };

  tempImg.src = blobURL;
}

// ── Lazy encoding ─────────────────────────────────────────────────────────────
function performLazyEncoding(onSuccess, onError) {
  if (!uploadedImage) {
    if (onError) onError(new Error('No image uploaded'));
    return;
  }

  const blobURL = URL.createObjectURL(uploadedImage);
  const tempImg = new Image();

  tempImg.onerror = () => {
    URL.revokeObjectURL(blobURL);
    if (onError) onError(new Error('Could not load image to encode.'));
  };

  tempImg.onload = () => {
    URL.revokeObjectURL(blobURL);

    let w = tempImg.naturalWidth;
    let h = tempImg.naturalHeight;
    if (w > MAX_PX || h > MAX_PX) {
      if (w >= h) { h = Math.round(h * MAX_PX / w); w = MAX_PX; }
      else { w = Math.round(w * MAX_PX / h); h = MAX_PX; }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(tempImg, 0, 0, w, h);

    // FIX: Note rendering — dark background + bottom positioning so text is
    // readable on any image (was: white text dead-center, invisible on light images)
    const note = (document.getElementById('imageNote')?.value || '').trim();
    if (note !== '') {
      const fontSize = Math.max(16, Math.round(w * 0.025));
      const lineHeight = Math.round(fontSize * 1.4);
      const maxWidth = w * 0.85;
      const padding = Math.round(fontSize * 0.7);

      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = 'left';

      // Measure how many lines the text will take
      const words = note.split(' ');
      let line = '';
      const lines = [];
      for (let n = 0; n < words.length; n++) {
        const test = line + words[n] + ' ';
        if (ctx.measureText(test).width > maxWidth && n > 0) {
          lines.push(line.trim()); line = words[n] + ' ';
        } else {
          line = test;
        }
      }
      if (line.trim()) lines.push(line.trim());

      const blockH = lines.length * lineHeight + padding * 2;
      const blockY = h - blockH - Math.round(h * 0.02);
      const blockX = Math.round(w * 0.04);

      // Semi-transparent dark background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(blockX - padding, blockY, maxWidth + padding * 2, blockH, 6)
        : ctx.rect(blockX - padding, blockY, maxWidth + padding * 2, blockH);
      ctx.fill();

      // Text
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;

      lines.forEach((l, i) => {
        const ty = blockY + padding + fontSize + i * lineHeight;
        ctx.strokeText(l, blockX, ty);
        ctx.fillText(l, blockX, ty);
      });
    }

    let dataURL;
    try {
      dataURL = canvas.toDataURL('image/png');
    } catch (e) {
      if (onError) onError(e);
      return;
    }

    state.encoded = dataURL;
    updateAdv();
    if (onSuccess) onSuccess();
  };

  tempImg.src = blobURL;
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────
function doCopy(card) {
  if (!uploadedImage) return;
  const badge = document.getElementById('copyBadge');
  const alertEl = document.getElementById('copyAlert');
  badge.textContent = '⏳ Encoding…';

  performLazyEncoding(async () => {
    try {
      const password = state.encodePassword;
      let finalData = state.encoded;

      if (password) {
        badge.textContent = '⏳ Encrypting…';
        const encryptedPayload = await encryptData(state.encoded, password);
        finalData = JSON.stringify({ type: 'encrypted', payload: encryptedPayload });
      }

      const ok = () => {
        badge.textContent = '✓ Copied!';
        card.classList.add('done');
        alertEl.style.display = 'block';
        announce('Encoded string copied to clipboard.');
        setStep(3);
      };
      const fail = () => {
        badge.textContent = '⚠ Failed — use Download instead';
        announce('Clipboard copy failed. Use the Download PNG option instead.');
      };

      mobileClipboard(finalData, ok, fail);
    } catch (e) {
      badge.textContent = '⚠ Error';
      showToast('Error: ' + e.message, true);
    }
  }, (e) => {
    badge.textContent = '⚠ Encoding Error';
    showToast('Error encoding image', true);
  });
}

// ── Build PNG ─────────────────────────────────────────────────────────────────
function doSavePNG(card) {
  if (!uploadedImage) return;
  const badge = document.getElementById('pngBadge');
  badge.textContent = '⏳ Encoding…';
  announce('Encoding and building PNG file…');
  card.style.pointerEvents = 'none';

  performLazyEncoding(async () => {
    try {
      const password = state.encodePassword;
      let payloadForPNG = state.encoded;

      if (password) {
        badge.textContent = '⏳ Encrypting…';
        const encryptedPayload = await encryptData(state.encoded, password);
        payloadForPNG = JSON.stringify({ type: 'encrypted', payload: encryptedPayload });
      }

      setTimeout(() => {
        try {
          buildStringPNG(payloadForPNG);
          badge.textContent = '✓ Downloaded!';
          card.classList.add('done');
          announce('PNG built and downloading.');
          setStep(3);

          // Directly trigger download
          downloadStringImage();
        } catch (e) {
          badge.textContent = '⚠ Error — try again';
          announce('Error building PNG: ' + e.message);
        }
        card.style.pointerEvents = '';
      }, 30);
    } catch (e) {
      badge.textContent = '⚠ Encryption Error';
      card.style.pointerEvents = '';
    }
  }, (e) => {
    badge.textContent = '⚠ Error';
    card.style.pointerEvents = '';
  });
}

// ── PNG builder ───────────────────────────────────────────────────────────────
function buildStringPNG(text) {
  const pngBytes = makeMinimalPNG();
  const final = appendPayloadToPNG(pngBytes, text);
  const blob = new Blob([final], { type: 'image/png' });
  state.pngBlob = blob;
  // FIX: pngBlobURL removed — downloadStringImage creates a fresh URL each time
}

function makeMinimalPNG() {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  ihdrData[0] = 0; ihdrData[1] = 0; ihdrData[2] = 0; ihdrData[3] = 8;
  ihdrData[4] = 0; ihdrData[5] = 0; ihdrData[6] = 0; ihdrData[7] = 8;
  ihdrData[8] = 8; ihdrData[9] = 2; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = buildPNGChunk('IHDR', ihdrData);

  const ROW = 1 + 8 * 3;
  const raw = new Uint8Array(8 * ROW);
  for (let r = 0; r < 8; r++) {
    const base = r * ROW;
    raw[base] = 0;
    for (let p = 0; p < 8; p++) {
      raw[base + 1 + p * 3] = 0x0a;
      raw[base + 1 + p * 3 + 1] = 0x0a;
      raw[base + 1 + p * 3 + 2] = 0x0f;
    }
  }
  const compressed = deflateRaw(raw);
  const idat = buildPNGChunk('IDAT', compressed);
  const iend = buildPNGChunk('IEND', new Uint8Array(0));

  const total = sig.length + ihdr.length + idat.length + iend.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [sig, ihdr, idat, iend]) { out.set(part, pos); pos += part.length; }
  return out;
}

function deflateRaw(data) {
  const BLOCK = 65535;
  const blocks = Math.ceil(data.length / BLOCK) || 1;
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let pos = 0;
  out[pos++] = 0x78; out[pos++] = 0x01;

  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const end = Math.min(offset + BLOCK, data.length);
    const len = end - offset;
    const last = (b === blocks - 1) ? 1 : 0;
    const nlen = (~len) & 0xffff;
    out[pos++] = last;
    out[pos++] = len & 0xff; out[pos++] = (len >> 8) & 0xff;
    out[pos++] = nlen & 0xff; out[pos++] = (nlen >> 8) & 0xff;
    out.set(data.subarray(offset, end), pos);
    pos += len; offset = end;
  }

  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = (s2 << 16) | s1;
  out[pos++] = (adler >> 24) & 0xff; out[pos++] = (adler >> 16) & 0xff;
  out[pos++] = (adler >> 8) & 0xff; out[pos++] = adler & 0xff;
  return out.subarray(0, pos);
}

function downloadStringImage() {
  if (!state.pngBlob) {
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    const url = URL.createObjectURL(state.pngBlob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    announce('Opened PNG in new tab. Long-press to save.');
    return;
  }

  const url = URL.createObjectURL(state.pngBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'base64-string.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  announce('Download started: base64-string.png');
}

// FIX: quickDecode targets #pasteDetails by id — not a blind querySelector('details')
function quickDecode() {
  if (!state.encoded) return;
  document.getElementById('pasteArea').value = state.encoded;
  const details = document.getElementById('pasteDetails');
  if (details) details.open = true;
  decodeFromPaste();
  document.getElementById('decodeCard').scrollIntoView({ behavior: 'smooth' });
}

function clearAll() {
  uploadedImage = null;
  state.pngBlob = null;
  state.encoded = '';
  state.encodePassword = null;

  document.getElementById('fileInput').value = '';
  document.getElementById('setupPasswordInput').value = '';
  document.getElementById('setupPasswordErr').style.display = 'none';

  ['imgStrip', 'saveSection', 'sizeWarn', 'copyAlert', 'pngDownloadPanel',
    'encodeMainArea', 'encodePasswordSetup']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  document.getElementById('encodePreSelect').style.display = 'block';
  const copyCardEl = document.getElementById('copyCard');
  if (copyCardEl) copyCardEl.classList.remove('done');
  document.getElementById('pngCard').classList.remove('done');

  updateAdv();
  setStep(1);
  announce('Cleared. Ready to encode a new image.');
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