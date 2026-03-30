/**
 * decoder.js — FIXED VERSION
 *
 * Fixes applied:
 *  1. handlePngUpload now calls readPNGPayload() (the full strategy-1+2 reader)
 *     instead of readPNGTextChunk() directly — this is why Error 1 occurred.
 *  2. renderDecoded validates the decoded string is a proper data URL before
 *     setting img.src — prevents the "could not decode" error from garbage data.
 *  3. Better error messages that distinguish between "no payload found" and
 *     "payload found but malformed".
 *  4. downloadDecoded now appends <a> to DOM before .click() — same fix as
 *     downloadStringImage in encoder.js (detached anchors silently fail).
 */

// ── PNG upload handler ────────────────────────────────────────────────────────
function handlePngUpload(file) {
  if (!file) return;

  const okEl  = document.getElementById('pngOk');
  const errEl = document.getElementById('pngErr');
  okEl.style.display  = 'none';
  errEl.style.display = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  document.getElementById('dropTitle').textContent = file.name;
  document.getElementById('dropSub').textContent   = 'Reading hidden data…';
  announce('Reading hidden data from ' + file.name + '…');

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const bytes = new Uint8Array(e.target.result);

      // ── FIX 1: use readPNGPayload (strategy-1 + strategy-2 fallback)
      //    NOT readPNGTextChunk which only does the legacy path.
      const str = readPNGPayload(bytes);

      if (!str) {
        throw new Error(
          'No hidden data found in this PNG. ' +
          'Make sure you are uploading the exact file as downloaded from this tool ' +
          '(do not open, screenshot, or re-save it — that strips the hidden data). ' +
          'If you only copied the string, use the paste box below instead.'
        );
      }

      // Validate it looks like a real data URL before proceeding
      if (!str.startsWith('data:image/')) {
        throw new Error(
          'Hidden data was found but appears corrupted. ' +
          'Please try uploading the file again, or use the paste box below.'
        );
      }

      okEl.style.display = 'block';
      okEl.textContent   = '⚡ Hidden data found — restoring your image…';
      showToast('⚡ Found it — restoring!');
      announce('Hidden data found. Restoring your image…');

      setTimeout(() => {
        okEl.style.display = 'none';
        renderDecoded(str);
        resetDropZone();
      }, 600);

    } catch (e2) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ ' + e2.message;
      announce('Error: ' + e2.message);
      resetDropZone();
    }
  };

  reader.onerror = () => {
    errEl.style.display = 'block';
    errEl.textContent   = '⚠ Could not read the file. Please try again.';
    announce('Error reading file.');
    resetDropZone();
  };

  reader.readAsArrayBuffer(file);
}

function resetDropZone() {
  document.getElementById('dropTitle').textContent = 'Upload the saved PNG file';
  document.getElementById('dropSub').textContent   =
    'The file downloaded from this tool — your image is hidden inside it';
  document.getElementById('pngInput').value = '';
}

// ── Paste decode ──────────────────────────────────────────────────────────────
function decodeFromPaste() {
  const raw   = document.getElementById('pasteArea').value.trim();
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';

  if (!raw) {
    errEl.style.display = 'block';
    errEl.textContent   = '⚠ Nothing pasted yet.';
    announce('Error: please paste a base64 string first.');
    return;
  }
  renderDecoded(raw);
}

// ── Core render ───────────────────────────────────────────────────────────────
/**
 * FIX 2: Validate the string BEFORE setting img.src.
 * FIX MOBILE: Mobile browsers (iOS Safari, Android Chrome) silently fail when
 * img.src is set to a data URL longer than ~2MB. The fix is to convert the
 * base64 data URL into a Blob and use URL.createObjectURL() instead — Blob
 * URLs have no length limit and work reliably on all mobile browsers.
 *
 * We also store the mime type and approx byte size on the img element so
 * downloadDecoded() can read them without re-parsing the (possibly huge) src.
 */
function renderDecoded(raw) {
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';

  let mime  = '';
  let b64   = '';

  if (raw.startsWith('data:')) {
    const ci = raw.indexOf(',');
    if (ci === -1) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ Invalid data URL — no comma separator found.';
      announce('Error: invalid data URL format.');
      return;
    }
    // Extract mime from header, e.g. "data:image/png;base64,"
    const header = raw.substring(0, ci);
    const mMatch = header.match(/^data:([^;,]+)/);
    mime  = mMatch ? mMatch[1] : 'image/jpeg';
    b64   = raw.substring(ci + 1).replace(/\s/g, '');
  } else {
    b64  = raw.replace(/\s/g, '');
    mime = detectMime(b64);
  }

  // Basic validation
  if (b64.length < 16) {
    errEl.style.display = 'block';
    errEl.textContent   = '⚠ String is too short to be a valid encoded image.';
    announce('Error: string too short.');
    return;
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64.substring(0, 64))) {
    errEl.style.display = 'block';
    errEl.textContent   = '⚠ This does not look like a valid base64 string. Make sure you copied the full encoded string.';
    announce('Error: not a valid base64 string.');
    return;
  }

  // ── Convert base64 → Blob → Object URL ───────────────────────────────────
  // This is the mobile fix: avoids the ~2MB data URL limit on iOS/Android.
  let blobURL = '';
  try {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    blobURL = URL.createObjectURL(blob);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent   = '⚠ Could not decode the image — the string may be corrupted or incomplete.';
    announce('Error: could not decode image.');
    return;
  }

  const img        = document.getElementById('decodedImg');
  const approxBytes = Math.ceil(b64.length * 0.75);

  // Clean up any previous blob URL to avoid memory leaks
  if (img._blobURL) URL.revokeObjectURL(img._blobURL);
  img._blobURL  = blobURL;
  img._mime     = mime;
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
    announce('Image restored successfully: ' + fmt + ', ' +
      img.naturalWidth + ' by ' + img.naturalHeight + ' pixels.');
    setStep(3);
  };

  img.onerror = () => {
    URL.revokeObjectURL(blobURL);
    img._blobURL = '';
    errEl.style.display = 'block';
    errEl.textContent   =
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

  // Derive a sensible file extension from the stored mime type
  const ext  = (img._mime || 'image/jpeg').split('/').pop().replace('jpeg', 'jpg');
  const name = 'restored-image.' + ext;

  const a    = document.createElement('a');
  a.href     = img._blobURL;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  announce('Download started: ' + name);
}

function clearDecode() {
  document.getElementById('pasteArea').value = '';
  document.getElementById('decodeErr').style.display    = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  const img = document.getElementById('decodedImg');
  if (img._blobURL) { URL.revokeObjectURL(img._blobURL); img._blobURL = ''; }
  img.src = '';
  announce('Cleared paste area.');
}