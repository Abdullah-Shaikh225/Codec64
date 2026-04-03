/**
 * decoder.js
 *
 * FIX: The chunked atob() loop now uses a chunk size that is always a
 * multiple of 4. base64 encodes every 3 bytes as exactly 4 characters.
 * Slicing at an arbitrary boundary (e.g. 65536) can split a 4-char group
 * mid-way, which causes atob() to throw "Invalid base64" on large images.
 *
 * 65536 is already divisible by 4 (65536 / 4 = 16384), so the constant
 * itself is fine. But we add the modulo guard explicitly to make the
 * invariant obvious and survive any future edits.
 *
 * The same fix is applied in renderDecoded(), which is the only place
 * in this file that does chunked atob(). converter.js has its own copies
 * of the same loop and is fixed there.
 */

// ── chunk size — must be a multiple of 4 ──────────────────────────────────────
const ATOB_CHUNK = 65536 - (65536 % 4); // = 65536 (already valid, guard is explicit)

// ── Password prompt modal ─────────────────────────────────────────────────────
function showPasswordPrompt() {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('passwordModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'passwordModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Enter decryption password');
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';

    modal.innerHTML = `
      <div style="background:#13131d;border:1px solid #3a3a55;border-radius:18px;
                  padding:28px;max-width:420px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.5);">
        <div style="font-family:'Space Mono',monospace;font-size:11px;color:#ffb86a;
                    letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">
          🔒 Encrypted image
        </div>
        <p style="font-size:.9rem;color:#eeeef5;margin-bottom:16px;line-height:1.6;">
          This image was encoded with a password.<br>
          <strong style="color:#6affdb;">Enter the password to restore your image.</strong>
        </p>
        <div style="position:relative;">
        <input type="password" id="decryptPasswordInput" class="url-inp password-inp"
          style="width:100%;background:#1c1c2a;border:1px solid #3a3a55;
                 border-radius:10px;color:#eeeef5;font-family:'Space Mono',monospace;
                 font-size:14px;padding:12px 44px 12px 14px;outline:none;margin-bottom:16px;
                 transition:border-color .2s;"
          placeholder="Enter password…" autocomplete="off">
        <button type="button" onclick="togglePasswordVisibility('decryptPasswordInput', this)"
          style="position:absolute;right:10px;top:12px;background:none;border:none;color:#9898b8;cursor:pointer;font-size:0.85rem;padding:2px 4px;font-family:'Space Mono',monospace;"
          aria-label="Toggle password visibility">Show</button>
        </div>
        <div id="decryptError"
          style="display:none;color:#ff6b6b;font-family:'Space Mono',monospace;
                 font-size:11px;margin-bottom:12px;padding:8px 12px;
                 background:rgba(255,107,107,.08);border-radius:8px;
                 border:1px solid rgba(255,107,107,.2);">
        </div>
        <div style="display:flex;gap:10px;">
          <button id="decryptSubmitBtn"
            style="flex:1;padding:12px;background:linear-gradient(135deg,#7c6aff,#a08fff);
                   color:#fff;border:none;border-radius:11px;font-size:.9rem;
                   font-weight:700;cursor:pointer;transition:opacity .2s;"
            onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            🔓 Decrypt
          </button>
          <button id="decryptCancelBtn"
            style="padding:12px 20px;background:transparent;border:1px solid #3a3a55;
                   color:#9898b8;border-radius:11px;font-size:.9rem;cursor:pointer;
                   transition:all .2s;"
            onmouseover="this.style.borderColor='#ff6b6b';this.style.color='#ff6b6b'"
            onmouseout="this.style.borderColor='#3a3a55';this.style.color='#9898b8'">
            Cancel
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const input = document.getElementById('decryptPasswordInput');
    const errorEl = document.getElementById('decryptError');
    const submitBtn = document.getElementById('decryptSubmitBtn');
    const cancelBtn = document.getElementById('decryptCancelBtn');

    setTimeout(() => input.focus(), 100);

    function submit() {
      const pw = input.value;
      if (!pw) {
        errorEl.style.display = 'block';
        errorEl.textContent = '⚠ Please enter a password.';
        input.focus();
        return;
      }
      modal.remove();
      resolve(pw);
    }
    function cancel() { modal.remove(); reject(new Error('Password entry cancelled.')); }

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });
    modal.addEventListener('click', e => { if (e.target === modal) cancel(); });
  });
}

// ── Encrypted payload detection ───────────────────────────────────────────────
function parseEncryptedPayload(str) {
  if (!str || !str.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(str);
    if (parsed && parsed.type === 'encrypted' && parsed.payload) return parsed;
  } catch (e) { /* not JSON */ }
  return null;
}

async function handleDecryption(str) {
  const encrypted = parseEncryptedPayload(str);
  if (!encrypted) return str;
  const password = await showPasswordPrompt();
  try {
    return await decryptData(encrypted.payload, password);
  } catch (e) {
    throw new Error(
      'Incorrect password. ' +
      'Please check your password and try again.'
    );
  }
}

// ── PNG upload handler ────────────────────────────────────────────────────────
function handlePngUpload(file) {
  if (!file) return;

  const okEl = document.getElementById('pngOk');
  const errEl = document.getElementById('pngErr');
  okEl.style.display = 'none';
  errEl.style.display = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  document.getElementById('dropTitle').textContent = file.name;
  document.getElementById('dropSub').textContent = 'Reading hidden data…';
  announce('Reading hidden data from ' + file.name + '…');

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const bytes = new Uint8Array(e.target.result);
      const str = readPNGPayload(bytes);

      if (!str) {
        throw new Error(
          'No hidden data found in this PNG. ' +
          'Make sure you are uploading the exact file as downloaded from this tool ' +
          '(do not open, screenshot, or re-save it — that strips the hidden data). ' +
          'If you only copied the string, use the paste box below instead.'
        );
      }

      let dataUrl;
      try {
        dataUrl = await handleDecryption(str);
      } catch (decryptErr) {
        throw decryptErr;
      }

      if (!dataUrl.startsWith('data:image/')) {
        throw new Error(
          'Hidden data was found but appears corrupted. ' +
          'Please try uploading the file again, or use the paste box below.'
        );
      }

      okEl.style.display = 'block';
      okEl.textContent = '⚡ Hidden data found — restoring your image…';
      showToast('⚡ Found it — restoring!');
      announce('Hidden data found. Restoring your image…');

      setTimeout(() => {
        okEl.style.display = 'none';
        renderDecoded(dataUrl);
        resetDropZone();
      }, 600);

    } catch (e2) {
      errEl.style.display = 'block';
      errEl.textContent = '⚠ ' + e2.message;
      announce('Error: ' + e2.message);
      resetDropZone();
    }
  };

  reader.onerror = () => {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ Could not read the file. Please try again.';
    announce('Error reading file.');
    resetDropZone();
  };

  reader.readAsArrayBuffer(file);
}

function resetDropZone() {
  document.getElementById('dropTitle').textContent = 'Upload the saved PNG file';
  document.getElementById('dropSub').textContent =
    'The file downloaded from this tool — your image is hidden inside it';
  document.getElementById('pngInput').value = '';
}

// ── Paste decode ──────────────────────────────────────────────────────────────
async function decodeFromPaste() {
  const raw = document.getElementById('pasteArea').value.trim();
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';

  if (!raw) {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ Nothing pasted yet.';
    announce('Error: please paste a base64 string first.');
    return;
  }

  try {
    const dataUrl = await handleDecryption(raw);
    renderDecoded(dataUrl);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ ' + e.message;
    announce('Error: ' + e.message);
  }
}

// ── Core render ───────────────────────────────────────────────────────────────
function renderDecoded(raw) {
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';

  let mime = '';
  let b64 = '';

  if (raw.startsWith('data:')) {
    const ci = raw.indexOf(',');
    if (ci === -1) {
      errEl.style.display = 'block';
      errEl.textContent = '⚠ Invalid data URL — no comma separator found.';
      announce('Error: invalid data URL format.');
      return;
    }
    const header = raw.substring(0, ci);
    const mMatch = header.match(/^data:([^;,]+)/);
    mime = mMatch ? mMatch[1] : 'image/jpeg';
    b64 = raw.substring(ci + 1).replace(/\s/g, '');
  } else {
    b64 = raw.replace(/\s/g, '');
    mime = detectMime(b64);
  }

  if (b64.length < 16) {
    errEl.style.display = 'block';
    errEl.textContent = '⚠ String is too short to be a valid encoded image.';
    announce('Error: string too short.');
    return;
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64.substring(0, 64))) {
    errEl.style.display = 'block';
    errEl.textContent =
      '⚠ This does not look like a valid base64 string. ' +
      'Make sure you copied the full encoded string.';
    announce('Error: not a valid base64 string.');
    return;
  }

  // FIX: chunk size is a multiple of 4 — avoids atob() "Invalid base64" errors
  // when the slice boundary falls mid-group on large images.
  let blobURL = '';
  try {
    const parts = [];
    let offset = 0;
    while (offset < b64.length) {
      const slice = b64.slice(offset, offset + ATOB_CHUNK);
      const binary = atob(slice);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
      offset += ATOB_CHUNK;
    }
    const blob = new Blob(parts, { type: mime });
    blobURL = URL.createObjectURL(blob);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent =
      '⚠ Could not decode the image — the string may be corrupted or incomplete.';
    announce('Error: could not decode image.');
    return;
  }

  const img = document.getElementById('decodedImg');
  const approxBytes = Math.ceil(b64.length * 0.75);

  if (img._blobURL) URL.revokeObjectURL(img._blobURL);
  img._blobURL = blobURL;
  img._mime = mime;
  img._approxBytes = approxBytes;

  img.onload = () => {
    const fmt = mime.split('/').pop().toUpperCase();
    document.getElementById('decodedMeta').textContent =
      fmt + ' · ~' + formatBytes(approxBytes) +
      ' · ' + img.naturalWidth + '×' + img.naturalHeight + 'px';

    document.getElementById('decodedResult').style.display = 'block';
    document.getElementById('decodedResult')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    showToast('Image restored!');
    announce('Image restored: ' + fmt + ', ' +
      img.naturalWidth + ' by ' + img.naturalHeight + ' pixels.');
    setStep(3);
  };

  img.onerror = () => {
    URL.revokeObjectURL(blobURL);
    img._blobURL = '';
    errEl.style.display = 'block';
    errEl.textContent =
      '⚠ Could not display the image. The encoded string may be incomplete — ' +
      'make sure you copied it in full. The Download PNG method is more reliable for large images.';
    announce('Error: could not display the decoded image.');
    img.src = '';
  };

  img.src = blobURL;
}

// ── Download decoded image ────────────────────────────────────────────────────
function downloadDecoded() {
  const img = document.getElementById('decodedImg');
  if (!img._blobURL) return;
  const ext = (img._mime || 'image/jpeg').split('/').pop().replace('jpeg', 'jpg');
  const name = 'restored-image.' + ext;
  const a = document.createElement('a');
  a.href = img._blobURL;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  announce('Download started: ' + name);
}

function clearDecode() {
  document.getElementById('pasteArea').value = '';
  document.getElementById('decodeErr').style.display = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  const img = document.getElementById('decodedImg');
  if (img._blobURL) { URL.revokeObjectURL(img._blobURL); img._blobURL = ''; }
  img.src = '';
  announce('Cleared paste area.');
}