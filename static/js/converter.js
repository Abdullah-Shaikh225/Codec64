/**
 * converter.js
 *
 * Standalone image format converter.
 * - Accepts any image the browser can render (JPEG, PNG, WEBP, GIF, SVG, BMP, AVIF…)
 * - HEIC/HEIF files are sent to /api/convert-heic (Vercel serverless function)
 *   which converts them to JPEG server-side using sharp + libvips.
 *   This works on ALL browsers including Android Chrome — no WASM needed.
 * - Converts to JPEG / PNG / WEBP via canvas
 * - Two output options: Download  OR  Send straight to the Encoder
 *
 * State is kept in converterState (separate from encoder's `state`).
 */

const converterState = {
    sourceFile: null,   // original File object
    canvas: null,       // off-screen canvas with the decoded image drawn on it
    format: 'jpeg',     // 'jpeg' | 'png' | 'webp'
    quality: 0.85,      // used for jpeg + webp
};

// ── HEIC detection helper ─────────────────────────────────────────────────────
function isHEICFile(file) {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return (
        name.endsWith('.heic') ||
        name.endsWith('.heif') ||
        type.includes('heic') ||
        type.includes('heif')
    );
}

// ── Convert HEIC via server → returns a JPEG Blob ────────────────────────────
/**
 * Sends the HEIC file to /api/convert-heic and returns a Promise<Blob>
 * containing the JPEG bytes. Throws a descriptive Error on failure.
 */
async function convertHEICviaServer(file) {
    const formData = new FormData();
    formData.append('file', file);

    let response;
    try {
        response = await fetch('/api/convert-heic', {
            method: 'POST',
            body: formData,
        });
    } catch (networkErr) {
        throw new Error(
            'Network error — could not reach the conversion server. ' +
            'Please check your internet connection and try again.'
        );
    }

    if (!response.ok) {
        let serverMsg = '';
        try {
            const json = await response.json();
            serverMsg = json.error || '';
        } catch (_) { /* ignore parse errors */ }

        throw new Error(
            serverMsg ||
            'Server returned an error (' + response.status + '). Please try again.'
        );
    }

    return response.blob(); // JPEG bytes as a Blob
}

// ── Draw a Blob onto an off-screen canvas via a blob URL ──────────────────────
function blobToCanvas(blob, label) {
    return new Promise((resolve, reject) => {
        const blobURL = URL.createObjectURL(blob);
        const img = new Image();

        img.onerror = () => {
            URL.revokeObjectURL(blobURL);
            reject(new Error(
                'Could not render ' + (label || 'image') + ' — the file may be corrupt.'
            ));
        };

        img.onload = () => {
            URL.revokeObjectURL(blobURL);

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            resolve(canvas);
        };

        img.src = blobURL;
    });
}

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

    // ── HEIC / HEIF path (server-side conversion) ─────────────────────────
    if (isHEICFile(file)) {
        statusEl.textContent = '⏳ Converting HEIC — uploading to server…';
        announce('Converting HEIC image via server…');

        convertHEICviaServer(file)
            .then(jpegBlob => {
                statusEl.textContent = '⏳ Rendering image…';
                return blobToCanvas(jpegBlob, 'converted JPEG');
            })
            .then(canvas => {
                converterState.canvas = canvas;
                statusEl.style.display = 'none';
                updateConverterPreview();
                announce('Converter: HEIC converted. Choose a format and action.');
            })
            .catch(err => {
                statusEl.style.display = 'none';
                errEl.style.display = 'block';
                errEl.innerHTML =
                    '⚠ Could not convert HEIC: ' + err.message +
                    '<br>On iPhone you can also: Photos app → Share → Save as JPEG, then upload that file.';
                announce('HEIC conversion error: ' + err.message);
            });

        return; // async path — skip normal flow below
    }

    // ── Normal path (JPEG, PNG, WEBP, GIF, SVG, BMP, AVIF…) ─────────────
    const blobURL = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
        URL.revokeObjectURL(blobURL);
        statusEl.style.display = 'none';
        errEl.style.display = 'block';
        errEl.innerHTML = '⚠ Could not load this file as an image. Please try JPEG, PNG, WEBP, or GIF.';
        announce('Converter error: could not load image.');
    };

    img.onload = () => {
        URL.revokeObjectURL(blobURL);

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
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

    document.getElementById('convQualityRow').style.display =
        (fmt === 'png') ? 'none' : 'flex';

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
    converterState._lastDataURL = dataURL;

    const b64len = dataURL.length - dataURL.indexOf(',') - 1;
    const outBytes = Math.ceil(b64len * 0.75);
    const w = converterState.canvas.width;
    const h = converterState.canvas.height;
    infoEl.textContent =
        fmt.toUpperCase() + ' · ' + w + '×' + h + 'px · ~' + formatBytes(outBytes);

    resultEl.style.display = 'block';
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

    document.getElementById('encodeCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
        handleFile(file);
        showToast('Image sent to encoder!');
        announce('Converted image sent to encoder.');
    }, 400);
}

// ── focusConverter — called from encoder onerror to pre-load failed file ──────
function focusConverter(file) {
    document.getElementById('converterCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const hint = document.getElementById('convHint');
    if (hint) {
        hint.style.display = 'block';
        hint.innerHTML =
            '⬆ Your image needs converting first. ' +
            'Pick a format below then tap <strong>Use in Encoder</strong>.';
    }

    if (file) setTimeout(() => handleConverterFile(file), 500);
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
    document.getElementById('convDropSub').textContent = 'JPEG · PNG · WEBP · GIF · BMP · SVG · HEIC';
    announce('Converter cleared.');
}