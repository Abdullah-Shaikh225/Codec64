/**
 * converter.js
 *
 * Standalone image format converter.
 * - Accepts any image the browser can render (JPEG, PNG, WEBP, GIF, SVG,
 *   HEIC on iOS Safari, BMP, AVIF…)
 * - Converts to JPEG / PNG / WEBP via canvas
 * - Two output options: Download  OR  Send straight to the Encoder
 *
 * State is kept in converterState (separate from encoder's `state`).
 */

const converterState = {
    sourceFile: null,   // original File object
    canvas: null,   // off-screen canvas with the decoded image drawn on it
    format: 'jpeg', // 'jpeg' | 'png' | 'webp'
    quality: 0.85,   // used for jpeg + webp
};

// ── Entry point — called when user picks a file in the converter drop zone ────
function handleConverterFile(file) {
    if (!file) return;

    const errEl = document.getElementById('convErr');
    const resultEl = document.getElementById('convResult');
    const statusEl = document.getElementById('convStatus');

    errEl.style.display = 'none';
    resultEl.style.display = 'none';
    statusEl.style.display = 'block';
    statusEl.textContent = '⏳ Loading image…';
    announce('Converter: loading image…');

    converterState.sourceFile = file;

    const blobURL = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
        URL.revokeObjectURL(blobURL);
        statusEl.style.display = 'none';
        const name = file.name.toLowerCase();
        const type = (file.type || '').toLowerCase();
        const isHEIC = name.endsWith('.heic') || name.endsWith('.heif') ||
            type.includes('heic') || type.includes('heif');
        errEl.style.display = 'block';
        errEl.innerHTML = isHEIC
            ? '⚠ HEIC cannot be decoded on this device\'s browser. ' +
            'On iPhone: Photos app → Share → Save as JPEG, then upload that file.'
            : '⚠ Could not load this file as an image. Please try JPEG, PNG, WEBP, or GIF.';
        announce('Converter error: ' + errEl.textContent);
    };

    img.onload = () => {
        URL.revokeObjectURL(blobURL);

        // Draw onto an off-screen canvas (no size cap here — converter keeps full res)
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // white bg for transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        converterState.canvas = canvas;

        statusEl.style.display = 'none';
        updateConverterPreview();
        announce('Converter: image loaded. Choose a format and action.');
    };

    img.src = blobURL;
}

// ── Called whenever format or quality changes ─────────────────────────────────
function updateConverterPreview() {
    if (!converterState.canvas) return;

    const resultEl = document.getElementById('convResult');
    const previewImg = document.getElementById('convPreviewImg');
    const infoEl = document.getElementById('convInfo');
    const fmt = converterState.format;
    const mime = 'image/' + fmt;
    const quality = (fmt === 'png') ? undefined : converterState.quality;

    // Show/hide quality slider
    document.getElementById('convQualityRow').style.display =
        (fmt === 'png') ? 'none' : 'flex';

    // Generate preview data URL
    let dataURL;
    try {
        dataURL = quality !== undefined
            ? converterState.canvas.toDataURL(mime, quality)
            : converterState.canvas.toDataURL(mime);
    } catch (e) {
        document.getElementById('convErr').style.display = 'block';
        document.getElementById('convErr').textContent = '⚠ Conversion failed: ' + e.message;
        return;
    }

    previewImg.src = dataURL;

    // Estimate output size
    const b64len = dataURL.length - dataURL.indexOf(',') - 1;
    const outBytes = Math.ceil(b64len * 0.75);
    const w = converterState.canvas.width;
    const h = converterState.canvas.height;
    infoEl.textContent =
        fmt.toUpperCase() + ' · ' + w + '×' + h + 'px · ~' + formatBytes(outBytes);

    resultEl.style.display = 'block';

    // Store dataURL for use by action buttons
    converterState._lastDataURL = dataURL;
}

// ── Format pill click ─────────────────────────────────────────────────────────
function setConverterFormat(fmt, btn) {
    converterState.format = fmt;
    document.querySelectorAll('.conv-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateConverterPreview();
}

// ── Quality slider input ──────────────────────────────────────────────────────
function setConverterQuality(val) {
    converterState.quality = parseInt(val) / 100;
    document.getElementById('convQualityVal').textContent = val + '%';
    updateConverterPreview();
}

// ── Download converted image ──────────────────────────────────────────────────
function downloadConverted() {
    const dataURL = converterState._lastDataURL;
    if (!dataURL) return;

    const fmt = converterState.format;
    const mime = 'image/' + fmt;
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const base = (converterState.sourceFile?.name || 'image').replace(/\.[^.]+$/, '');
    const name = base + '-converted.' + ext;

    // Convert data URL → Blob → object URL for reliable mobile download
    const b64 = dataURL.split(',')[1];
    const CHUNK = 65536;
    const parts = [];
    let offset = 0;
    while (offset < b64.length) {
        const slice = b64.slice(offset, offset + CHUNK);
        const binary = atob(slice);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        parts.push(bytes);
        offset += CHUNK;
    }
    const blob = new Blob(parts, { type: mime });
    const blobURL = URL.createObjectURL(blob);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
        window.open(blobURL, '_blank');
        setTimeout(() => URL.revokeObjectURL(blobURL), 10000);
        showToast('Opened in new tab — long-press to save.');
        announce('Opened converted image in new tab.');
        return;
    }

    const a = document.createElement('a');
    a.href = blobURL;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobURL), 10000);

    showToast('Downloading ' + name + '…');
    announce('Download started: ' + name);
}

// ── Send converted image straight to the Encoder ─────────────────────────────
function sendConverterToEncoder() {
    const dataURL = converterState._lastDataURL;
    if (!dataURL) return;

    const fmt = converterState.format;
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const base = (converterState.sourceFile?.name || 'image').replace(/\.[^.]+$/, '');
    const name = base + '-converted.' + ext;
    const mime = 'image/' + fmt;

    // Build a File from the converted data URL and hand it to handleFile()
    const b64 = dataURL.split(',')[1];
    const CHUNK = 65536;
    const parts = [];
    let offset = 0;
    while (offset < b64.length) {
        const slice = b64.slice(offset, offset + CHUNK);
        const binary = atob(slice);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        parts.push(bytes);
        offset += CHUNK;
    }
    const blob = new Blob(parts, { type: mime });
    const file = new File([blob], name, { type: mime });

    // Scroll to encoder and load
    document.getElementById('encodeCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
        handleFile(file);
        showToast('Image sent to encoder!');
        announce('Converted image sent to encoder.');
    }, 400);
}

// ── focusConverter — called from encoder onerror to pre-load failed file ──────
function focusConverter(file) {
    // Scroll to converter card
    document.getElementById('converterCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Show a hint banner
    const hint = document.getElementById('convHint');
    if (hint) {
        hint.style.display = 'block';
        hint.innerHTML =
            '⬆ Your image needs converting first. ' +
            'Pick a format below then tap <strong>Use in Encoder</strong>.';
    }

    // Pre-load the file if the browser can handle it (non-HEIC will work fine)
    if (file) {
        setTimeout(() => handleConverterFile(file), 500);
    }
}

// ── Clear converter ───────────────────────────────────────────────────────────
function clearConverter() {
    converterState.sourceFile = null;
    converterState.canvas = null;
    converterState._lastDataURL = '';

    document.getElementById('convFileInput').value = '';
    document.getElementById('convErr').style.display = 'none';
    document.getElementById('convResult').style.display = 'none';
    document.getElementById('convStatus').style.display = 'none';
    document.getElementById('convHint').style.display = 'none';
    document.getElementById('convDropTitle').textContent = 'Drop any image here';
    document.getElementById('convDropSub').textContent = 'JPEG · PNG · WEBP · GIF · BMP · SVG';
    announce('Converter cleared.');
}