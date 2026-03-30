/**
 * ui.js
 * Responsible for:
 *  - Centralised application state object
 *  - Step indicator updates + ARIA announcements
 *  - Advanced / developer panel (toggle, snippet tabs, copy feedback, stats)
 *  - Drag-and-drop wiring for both drop zones
 *  - Mobile-safe clipboard (3-tier: modern API → legacy execCommand → modal)
 *  - Toast notifications
 *  - Shared utility: formatBytes
 *
 * Must be loaded FIRST (before encoder.js, decoder.js) because it defines
 * `state`, `announce`, `showToast`, `setStep`, `formatBytes`, and
 * `mobileClipboard` — all of which other modules depend on.
 */

// ── Centralised state ─────────────────────────────────────────────────────────
// All mutable runtime state lives here. No module uses bare globals.
const state = {
  encoded:     '',     // full data URL of the currently encoded image
  pngBlobURL:  '',     // object URL for the downloadable string-PNG blob
  currentSnip: 'html'  // active snippet tab in the Advanced panel
};

// ── ARIA live region helper ───────────────────────────────────────────────────
/**
 * Pushes a message to the hidden aria-live region so screen readers
 * announce it without visual change. Uses a two-frame trick to reliably
 * trigger the announcement even if the same string is repeated.
 * @param {string} msg
 */
function announce(msg) {
  const r = document.getElementById('liveRegion');
  r.textContent = '';
  requestAnimationFrame(() => { r.textContent = msg; });
}

// ── Step indicator ────────────────────────────────────────────────────────────
/**
 * Advances the 3-step progress indicator to the given step number (1–3).
 * Steps before n are marked done (✓), step n is active, steps after are idle.
 * Updates ARIA labels on each step circle for screen reader context.
 * @param {number} n  Step to make active (1, 2, or 3)
 */
function setStep(n) {
  const labels = ['Upload', 'Save', 'Restore'];

  for (let i = 1; i <= 3; i++) {
    const num  = document.getElementById('sn' + i);
    const line = document.getElementById('sl' + i);

    if (i < n) {
      num.classList.add('done');
      num.classList.remove('active');
      num.textContent = '✓';
      num.setAttribute('aria-label', `Step ${i}: ${labels[i - 1]} — completed`);
      num.removeAttribute('aria-current');
    } else if (i === n) {
      num.classList.add('active');
      num.classList.remove('done');
      num.textContent = i;
      num.setAttribute('aria-label', `Step ${i}: ${labels[i - 1]} — current step`);
      num.setAttribute('aria-current', 'step');
    } else {
      num.classList.remove('done', 'active');
      num.textContent = i;
      num.setAttribute('aria-label', `Step ${i}: ${labels[i - 1]} — not yet reached`);
      num.removeAttribute('aria-current');
    }

    if (line) line.classList.toggle('done', i < n);
  }

  announce('Moved to step ' + n + ': ' + labels[n - 1]);
}

// ── Advanced / developer panel ────────────────────────────────────────────────
/** Toggles the Advanced panel open/closed and updates aria-expanded. */
function toggleAdv() {
  const panel  = document.getElementById('advPanel');
  const arr    = document.getElementById('advArr');
  const toggle = document.getElementById('advToggle');
  const open   = panel.classList.toggle('open');
  arr.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  announce(open ? 'Advanced tools expanded.' : 'Advanced tools collapsed.');
}

// Snippet templates — each function receives the full data URL and returns
// a ready-to-paste code string for the selected format.
const SNIPS = {
  html: d => `<img src="${d}" alt="image" />`,
  css:  d => `.element {\n  background-image: url('${d}');\n  background-size: cover;\n}`,
  md:   d => `![image](${d})`,
  json: d => `{\n  "image": "${d}"\n}`
};

/**
 * Switches the active snippet tab and updates the snippet preview box.
 * @param {string}      type  One of 'html' | 'css' | 'md' | 'json'
 * @param {HTMLElement} btn   The clicked tab button
 */
function setSnip(type, btn) {
  state.currentSnip = type;

  document.querySelectorAll('.snip-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');

  document.getElementById('snipContent').textContent =
    state.encoded
      ? SNIPS[type](state.encoded)
      : 'Upload an image above to generate snippets.';
}

/** Copies the current snippet to clipboard with in-panel flash feedback. */
function copySnip() {
  if (!state.encoded) return;
  copyText(SNIPS[state.currentSnip](state.encoded), 'Snippet copied!', 'snipFlash');
}

/** Copies the raw base64 string to clipboard with in-panel flash feedback. */
function copyRaw() {
  if (!state.encoded) return;
  copyText(state.encoded, 'Raw string copied!', 'rawFlash');
}

/**
 * Refreshes all dynamic content in the Advanced panel.
 * Called after any encoding operation or clearAll().
 */
function updateAdv() {
  if (!state.encoded) {
    document.getElementById('rawPreview').textContent  = 'Upload an image to see the raw string.';
    document.getElementById('snipContent').textContent = 'Upload an image above to generate snippets.';
    ['stChars', 'stSize', 'stFmt', 'stOh'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    return;
  }

  document.getElementById('rawPreview').textContent =
    state.encoded.substring(0, 100) + '… [' + state.encoded.length.toLocaleString() + ' chars total]';
  document.getElementById('snipContent').textContent =
    SNIPS[state.currentSnip](state.encoded);

  const m         = state.encoded.match(/^data:([^;,]+)/);
  const fmt       = m ? m[1].replace('image/', '').toUpperCase() : '?';
  const b64len    = state.encoded.length - state.encoded.indexOf(',') - 1;
  const origBytes = Math.ceil(b64len * 0.75);
  const overhead  = (((state.encoded.length / origBytes) - 1) * 100).toFixed(0);

  document.getElementById('stChars').textContent = state.encoded.length.toLocaleString();
  document.getElementById('stSize').textContent  = formatBytes(origBytes);
  document.getElementById('stFmt').textContent   = fmt;
  document.getElementById('stOh').textContent    = '+' + overhead + '%';
}

// ── In-panel copy flash ───────────────────────────────────────────────────────
/**
 * Briefly flashes a green overlay on a code box to confirm a copy action.
 * Works alongside the toast — gives visual feedback right at the source element.
 * @param {string} flashId  ID of the .copy-flash element to animate
 */
function flashPanel(flashId) {
  const el = document.getElementById(flashId);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 300);
}

// ── Drag-and-drop wiring ──────────────────────────────────────────────────────
// Wired here (not inline HTML) so drag state is centralised.
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('over'));
  dz.addEventListener('drop',      e  => {
    e.preventDefault(); dz.classList.remove('over');
    handleFile(e.dataTransfer.files[0]); // encoder.js
  });

  const dd = document.getElementById('decodeDrop');
  dd.addEventListener('dragover',  e => { e.preventDefault(); dd.classList.add('over'); });
  dd.addEventListener('dragleave', ()  => dd.classList.remove('over'));
  dd.addEventListener('drop',      e  => {
    e.preventDefault(); dd.classList.remove('over');
    handlePngUpload(e.dataTransfer.files[0]); // decoder.js
  });
});

// ── Mobile-safe clipboard ─────────────────────────────────────────────────────
/**
 * Three-tier clipboard strategy for maximum mobile compatibility:
 *
 *  Tier 1 — navigator.clipboard.writeText (modern async API)
 *    Requires HTTPS + an active user gesture. Fails silently on file:// URLs.
 *    If it fails, falls through to Tier 2.
 *
 *  Tier 2 — document.execCommand('copy') (legacy, synchronous)
 *    Works on Android Chrome and most desktop browsers.
 *    iOS Safari requires setSelectionRange() and the textarea must be
 *    inside the viewport (not off-screen at top:-9999px).
 *    If it fails, falls through to Tier 3.
 *
 *  Tier 3 — Manual copy modal
 *    Shown as a last resort. The text is pre-selected so the user only
 *    needs to long-press → Copy (or ⌘C on desktop).
 *
 * @param {string}   text   Text to copy
 * @param {Function} onOk   Called on success
 * @param {Function} onFail Called if all tiers fail (modal shown separately)
 */
function mobileClipboard(text, onOk, onFail) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(() => {
      legacyCopy(text, onOk, onFail);
    });
    return;
  }
  legacyCopy(text, onOk, onFail);
}

/**
 * Legacy execCommand path with iOS-specific selection handling.
 * @param {string}   text
 * @param {Function} onOk
 * @param {Function} onFail
 */
function legacyCopy(text, onOk, onFail) {
  const ta = document.createElement('textarea');
  ta.value = text;
  // Must be in the viewport on iOS — off-screen textareas can't be selected
  ta.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;' +
    'padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
  ta.setAttribute('readonly', ''); // prevents keyboard popup on mobile
  document.body.appendChild(ta);

  const isIOS = /ipad|iphone/i.test(navigator.userAgent);
  if (isIOS) {
    // iOS Safari: createRange + setSelectionRange (ta.select() alone doesn't work)
    ta.contentEditable = 'true';
    ta.readOnly = false;
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ta.setSelectionRange(0, text.length);
  } else {
    ta.select();
  }

  let success = false;
  try { success = document.execCommand('copy'); } catch (e) { success = false; }
  document.body.removeChild(ta);

  if (success) { onOk(); return; }

  // Both tiers failed — show manual copy modal
  showCopyModal(text);
  if (onFail) onFail();
}

/**
 * Last-resort modal. Pre-selects the text so the user can long-press → Copy.
 * Shows only the first 500 chars (the full string is always too long to display
 * usefully); suggests using Download PNG for the complete string.
 * @param {string} text
 */
function showCopyModal(text) {
  const existing = document.getElementById('copyModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'copyModal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Copy string manually');
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  modal.innerHTML = `
    <div style="background:#13131d;border:1px solid #3a3a55;border-radius:18px;
                padding:28px;max-width:480px;width:100%;">
      <div style="font-family:'Space Mono',monospace;font-size:11px;color:#6affdb;
                  letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">
        // Manual copy needed
      </div>
      <p style="font-size:.9rem;color:#eeeef5;margin-bottom:16px;line-height:1.6;">
        Your browser blocked automatic clipboard access.<br>
        <strong style="color:#6affdb;">Long-press the text below → select all → copy.</strong>
      </p>
      <textarea id="modalTextarea"
        style="width:100%;height:100px;background:#1c1c2a;border:1px solid #3a3a55;
               border-radius:10px;color:#9d8fff;font-family:'Space Mono',monospace;
               font-size:10px;padding:10px;resize:none;word-break:break-all;line-height:1.6;"
        readonly>${text.substring(0, 500)}…</textarea>
      <p style="font-family:'Space Mono',monospace;font-size:10px;
                color:#9898b8;margin:8px 0 16px;">
        Showing first 500 chars. Use
        <strong style="color:#ffb86a;">Download PNG</strong>
        to save the full string safely.
      </p>
      <button onclick="document.getElementById('copyModal').remove()"
        style="width:100%;padding:12px;background:linear-gradient(135deg,#7c6aff,#a08fff);
               color:#fff;border:none;border-radius:11px;font-size:.9rem;
               font-weight:700;cursor:pointer;">
        Close
      </button>
    </div>`;

  document.body.appendChild(modal);

  const ta = modal.querySelector('#modalTextarea');
  ta.addEventListener('focus', () => ta.select());
  setTimeout(() => { ta.focus(); ta.select(); }, 100);

  // Close on backdrop click
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  announce('Clipboard blocked. A dialog is open — long-press the text to copy manually.');
}

// ── Generic copy helper ───────────────────────────────────────────────────────
/**
 * Copies arbitrary text to clipboard with optional in-panel flash feedback.
 * Used by copyRaw() and copySnip() in the Advanced panel.
 * @param {string} text
 * @param {string} msg      Toast message on success
 * @param {string} flashId  ID of a .copy-flash element to animate (optional)
 */
function copyText(text, msg, flashId) {
  const ok = () => {
    if (flashId) flashPanel(flashId);
    showToast(msg);
    announce(msg);
  };
  mobileClipboard(
    text,
    ok,
    () => { if (flashId) flashPanel(flashId); showCopyModal(text); }
  );
}

// ── Toast notifications ───────────────────────────────────────────────────────
let _toastTimer;

/**
 * Shows a toast notification at the bottom-right of the screen.
 * @param {string}  msg      Message to display
 * @param {boolean} isError  If true, styles the toast in the error (pink) colour
 */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Utility ───────────────────────────────────────────────────────────────────
/**
 * Formats a byte count into a human-readable string (B / KB / MB).
 * @param {number} n  Byte count
 * @returns {string}
 */
function formatBytes(n) {
  if (n < 1024)    return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
