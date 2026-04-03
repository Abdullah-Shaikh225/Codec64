/**
 * ui.js
 *
 * FIXES:
 *  1. state.pngBlobURL removed — encoder.js no longer uses it.
 *  2. Double DOMContentLoaded registration removed. Previously both
 *     `window.addEventListener('DOMContentLoaded', handleHash)` and a
 *     second identical call existed, causing showView() + announce() to
 *     fire twice on initial load. Now a single listener handles both
 *     hash-based routing and drag-drop setup.
 */

const state = {
  encoded: '',
  pngBlob: null,   // raw Blob; downloadStringImage creates a fresh URL each time
  currentSnip: 'html'
};

function announce(msg) {
  const r = document.getElementById('liveRegion');
  r.textContent = '';
  requestAnimationFrame(() => { r.textContent = msg; });
}

function setStep(n) {
  const labels = ['Upload', 'Save', 'Restore'];
  for (let i = 1; i <= 3; i++) {
    const num = document.getElementById('sn' + i);
    const line = document.getElementById('sl' + i);
    if (i < n) {
      num.classList.add('done'); num.classList.remove('active');
      num.textContent = '✓';
      num.setAttribute('aria-label', `Step ${i}: ${labels[i - 1]} — completed`);
      num.removeAttribute('aria-current');
    } else if (i === n) {
      num.classList.add('active'); num.classList.remove('done');
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

function toggleAdv() {
  const panel = document.getElementById('advPanel');
  const arr = document.getElementById('advArr');
  const toggle = document.getElementById('advToggle');
  const open = panel.classList.toggle('open');
  arr.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  announce(open ? 'Advanced tools expanded.' : 'Advanced tools collapsed.');
}

const SNIPS = {
  html: d => `<img src="${d}" alt="image" />`,
  css: d => `.element {\n  background-image: url('${d}');\n  background-size: cover;\n}`,
  md: d => `![image](${d})`,
  json: d => `{\n  "image": "${d}"\n}`
};

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

function copySnip() {
  if (!state.encoded) {
    showToast('Encode an image first.', true);
    return;
  }
  copyText(SNIPS[state.currentSnip](state.encoded), 'Snippet copied!', 'snipFlash');
}

function copyRaw() {
  if (!state.encoded) {
    showToast('Encode an image first.', true);
    return;
  }
  copyText(state.encoded, 'Raw string copied!', 'rawFlash');
}

function updateAdv() {
  if (!state.encoded) {
    document.getElementById('rawPreview').textContent = 'Upload an image to see the raw string.';
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

  const m = state.encoded.match(/^data:([^;,]+)/);
  const fmt = m ? m[1].replace('image/', '').toUpperCase() : '?';
  const b64len = state.encoded.length - state.encoded.indexOf(',') - 1;
  const origBytes = Math.ceil(b64len * 0.75);
  const overhead = (((state.encoded.length / origBytes) - 1) * 100).toFixed(0);

  document.getElementById('stChars').textContent = state.encoded.length.toLocaleString();
  document.getElementById('stSize').textContent = formatBytes(origBytes);
  document.getElementById('stFmt').textContent = fmt;
  document.getElementById('stOh').textContent = '+' + overhead + '%';
}

function flashPanel(flashId) {
  const el = document.getElementById(flashId);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 300);
}

// FIX: Single DOMContentLoaded listener — previously registered twice,
// causing showView() + announce() to fire twice on page load.
window.addEventListener('DOMContentLoaded', () => {
  // Drag-drop setup
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('over');
    handleFile(e.dataTransfer.files[0]);
  });

  const dd = document.getElementById('decodeDrop');
  dd.addEventListener('dragover', e => { e.preventDefault(); dd.classList.add('over'); });
  dd.addEventListener('dragleave', () => dd.classList.remove('over'));
  dd.addEventListener('drop', e => {
    e.preventDefault(); dd.classList.remove('over');
    handlePngUpload(e.dataTransfer.files[0]);
  });

  // Hash-based routing (single call)
  handleHash();
});

// Back button support
window.addEventListener('hashchange', handleHash);

function handleHash() {
  const hash = window.location.hash.substring(1);
  if (hash && document.getElementById(hash)) {
    showView(hash);
  } else {
    showView('onboardingView');
  }
}

function mobileClipboard(text, onOk, onFail) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(() => legacyCopy(text, onOk, onFail));
    return;
  }
  legacyCopy(text, onOk, onFail);
}

function legacyCopy(text, onOk, onFail) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;' +
    'padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);

  const isIOS = /ipad|iphone/i.test(navigator.userAgent);
  if (isIOS) {
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
  showCopyModal(text);
  if (onFail) onFail();
}

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
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  announce('Clipboard blocked. A dialog is open — long-press the text to copy manually.');
}

function copyText(text, msg, flashId) {
  const ok = () => {
    if (flashId) flashPanel(flashId);
    showToast(msg);
    announce(msg);
  };
  mobileClipboard(text, ok, () => {
    if (flashId) flashPanel(flashId);
    showCopyModal(text);
  });
}

let _toastTimer;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const floatingBtn = document.getElementById('floatingDownload');
  if (floatingBtn) floatingBtn.style.display = 'none';

  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  const homeBtn = document.getElementById('homeBtn');
  const mainTagline = document.getElementById('mainTagline');

  // Track feature selection
  if (viewId === 'encodeView') trackEvent("feature_selected", "Feature", "Encode");
  else if (viewId === 'decodeView') trackEvent("feature_selected", "Feature", "Decode");
  else if (viewId === 'convertView') trackEvent("feature_selected", "Feature", "Convert");

  if (viewId === 'onboardingView') {
    if (homeBtn) homeBtn.style.display = 'none';
    if (mainTagline) mainTagline.style.display = 'block';
    if (window.history.replaceState) {
      window.history.replaceState(null, null, window.location.pathname);
    }
  } else {
    if (homeBtn) homeBtn.style.display = 'block';
    if (mainTagline) mainTagline.style.display = 'none';
    window.location.hash = viewId;
  }
}

function scrollToStart() {
  document.getElementById('onboardingView').scrollIntoView({
    behavior: 'smooth', block: 'start'
  });
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

// Global Event Tracking
function trackEvent(name, category, label, extra = {}) {
  if (typeof gtag === "function") {
    gtag('event', name, {
      event_category: category,
      event_label: label,
      ...extra
    });
  }
}