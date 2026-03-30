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
 * The old code set img.src then waited for onerror — but some malformed
 * strings caused silent failures or wrong MIME detection that produced
 * the "could not decode" error even on valid data.
 */
function renderDecoded(raw) {
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';
  let src = '';

  if (raw.startsWith('data:')) {
    const ci = raw.indexOf(',');
    if (ci === -1) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ Invalid data URL — no comma separator found.';
      announce('Error: invalid data URL format.');
      return;
    }
    // Rebuild cleanly: header unchanged, base64 body with whitespace stripped
    const header  = raw.substring(0, ci + 1).trim();
    const b64body = raw.substring(ci + 1).replace(/\s/g, '');

    // Validate the base64 body is non-empty and valid characters only
    if (!b64body || !/^[A-Za-z0-9+/]+=*$/.test(b64body.substring(0, 32))) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ The pasted string appears to be incomplete or corrupted. Make sure you copied the full string.';
      announce('Error: base64 string appears corrupted.');
      return;
    }

    src = header + b64body;

  } else {
    // Raw base64 — strip whitespace and validate
    const clean = raw.replace(/\s/g, '');

    if (clean.length < 16) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ String is too short to be a valid encoded image.';
      announce('Error: string too short.');
      return;
    }

    if (!/^[A-Za-z0-9+/]+=*$/.test(clean.substring(0, 64))) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ This does not look like a valid base64 string. Make sure you copied the full encoded string.';
      announce('Error: not a valid base64 string.');
      return;
    }

    src = 'data:' + detectMime(clean) + ';base64,' + clean;
  }

  const img = document.getElementById('decodedImg');

  img.onload = () => {
    const m      = src.match(/^data:([^;,]+)/);
    const fmt    = m ? m[1].split('/').pop().toUpperCase() : 'IMG';
    const b64len = src.length - src.indexOf(',') - 1;
    const approxBytes = Math.ceil(b64len * 0.75);

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
    errEl.style.display = 'block';
    errEl.textContent =
      '⚠ Could not decode the image. The string may be incomplete — ' +
      'make sure you copied the entire base64 string from start to finish. ' +
      'The Download PNG method is more reliable for large images.';
    announce('Error: could not decode the image.');
    // Clear the broken src so it does not show a broken image icon
    img.src = '';
  };

  img.src = src;
}

// ── Download decoded image ────────────────────────────────────────────────────
/**
 * FIX 4: Append <a> to DOM before .click() — same fix as downloadStringImage.
 * Detached anchors silently fail to trigger downloads in most browsers.
 */
function downloadDecoded() {
  const img = document.getElementById('decodedImg');
  if (!img.src || img.src === window.location.href) return;

  const a    = document.createElement('a');
  a.href     = img.src;
  a.download = 'restored-image';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  announce('Download started: restored image.');
}

function clearDecode() {
  document.getElementById('pasteArea').value = '';
  document.getElementById('decodeErr').style.display   = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  const img = document.getElementById('decodedImg');
  img.src = '';
  announce('Cleared paste area.');
}