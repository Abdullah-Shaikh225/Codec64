/**
 * decoder.js
 * Responsible for:
 *  - Decoding a base64 string (pasted or recovered from PNG) back to an image
 *  - Handling the PNG file upload and delegating chunk reading to pngHandler.js
 *  - Rendering the decoded image into the result panel
 *
 * Depends on: state (ui.js), readPNGTextChunk (pngHandler.js),
 *             announce, showToast, setStep, formatBytes (ui.js),
 *             detectMime (encoder.js)
 */

// ── PNG upload handler ────────────────────────────────────────────────────────
/**
 * Reads the uploaded PNG file as an ArrayBuffer, then calls readPNGTextChunk()
 * from pngHandler.js to extract the hidden base64 string.
 * @param {File} file
 */
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
      const str   = readPNGTextChunk(bytes, 'b64codec'); // pngHandler.js

      if (!str) throw new Error(
        'No hidden data found in this PNG. ' +
        'On mobile, some browsers re-compress images when saving — this removes the hidden data. ' +
        'Make sure you are uploading the exact file as downloaded (do not open and re-save it). ' +
        'If the problem persists, use the "Copy to Clipboard" method and paste into the text box below.'
      );

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
  reader.readAsArrayBuffer(file);
}

/** Resets the decode drop zone to its idle state after processing. */
function resetDropZone() {
  document.getElementById('dropTitle').textContent = 'Upload the saved PNG file';
  document.getElementById('dropSub').textContent   =
    'The file downloaded from this tool — your image is hidden inside it';
  document.getElementById('pngInput').value = '';
}

// ── Paste decode ──────────────────────────────────────────────────────────────
/**
 * Reads the base64 string from the paste textarea and calls renderDecoded().
 */
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
 * Converts a raw base64 string (or full data URL) into an <img> src and
 * displays it in the decoded result panel.
 *
 * Handles two input formats:
 *  1. Full data URL:  data:image/png;base64,ABC123…
 *  2. Raw base64:     ABC123… (MIME is detected from magic bytes via detectMime)
 *
 * @param {string} raw  Raw base64 string or full data URL
 */
function renderDecoded(raw) {
  const errEl = document.getElementById('decodeErr');
  errEl.style.display = 'none';
  let src = '';

  if (raw.startsWith('data:')) {
    // Already a data URL — strip any whitespace that may have crept in
    const ci = raw.indexOf(',');
    if (ci === -1) {
      errEl.style.display = 'block';
      errEl.textContent   = '⚠ Invalid data URL.';
      announce('Error: invalid data URL format.');
      return;
    }
    src = raw.substring(0, ci + 1).trim() + raw.substring(ci + 1).replace(/\s/g, '');
  } else {
    // Raw base64 — detect MIME type from magic bytes
    const clean = raw.replace(/\s/g, '');
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
      '⚠ Could not decode. The string may be incomplete or corrupted. ' +
      'Try the Download PNG method instead.';
    announce('Error: could not decode the image. The string may be incomplete.');
  };

  img.src = src;
}

// ── Download decoded image ────────────────────────────────────────────────────
/** Triggers a download of the currently displayed decoded image. */
function downloadDecoded() {
  const a  = document.createElement('a');
  a.href   = document.getElementById('decodedImg').src;
  a.download = 'restored-image';
  a.click();
  announce('Download started: restored image.');
}

/** Clears the paste area and hides the decoded result panel. */
function clearDecode() {
  document.getElementById('pasteArea').value = '';
  document.getElementById('decodeErr').style.display   = 'none';
  document.getElementById('decodedResult').style.display = 'none';
  announce('Cleared paste area.');
}
