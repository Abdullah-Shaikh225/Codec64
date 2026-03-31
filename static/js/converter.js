/**
 * converter.js
 *
 * Standalone image format converter.
 * - Accepts any image the browser can render (JPEG, PNG, WEBP, GIF, SVG,
 *   HEIC on iOS Safari, BMP, AVIF…)
 * - HEIC/HEIF files are decoded via libheif-js (WASM) on all browsers,
 *   including Android Chrome and desktop — not just iOS Safari.
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

// ── Decode HEIC bytes → off-screen canvas via libheif-js (WASM) ──────────────
/**
 * Returns a Promise<HTMLCanvasElement> with the first image frame painted on it.
 * Throws a descriptive Error on failure.
 *
 * libheif-js exposes a synchronous C-style API wrapped in JS:
 *   LibHeif()  →  heif instance
 *   heif.heif_context_alloc()
 *   heif.heif_context_read_from_memory_without_copying(ctx, data, len)
 *   heif.heif_context_get_primary_image_handle(ctx)  → handle
 *   heif.heif_decode_image(handle, colorspace, chroma)  → image
 *   image.get_width() / image.get_height()
 *   image.get_plane(heif.heif_channel.interleaved)  → { data, stride }
 *
 * The pixel data is raw RGBA (4 bytes per pixel), stride = width * 4.
 */
async function decodeHEICToCanvas(file) {
    // 1. Make sure libheif is available (loaded via <script> in index.html)
    if (typeof LibHeif === 'undefined') {
        throw new Error(
            'libheif-js is not loaded. Make sure the script tag is in index.html.'
        );
    }

    // 2. Read the file into an ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // 3. Initialise the libheif decoder
    //    LibHeif() returns a Promise on first call (WASM init), then a plain
    //    object on subsequent calls. We always await to handle both cases.
    const heif = await Promise.resolve(LibHeif());

    // 4. Allocate a context and load the bytes
    const ctx = heif.heif_context_alloc();
    if (!ctx) throw new Error('libheif: could not allocate context.');

    const loadResult = heif.heif_context_read_from_memory_without_copying(
        ctx, uint8, uint8.length
    );
    if (loadResult.code !== heif.heif_error_code.heif_error_Ok) {
        heif.heif_context_free(ctx);
        throw new Error('libheif: failed to parse HEIC file — ' + (loadResult.message || 'unknown error'));
    }

    // 5. Get the primary image handle
    const handleResult = heif.heif_context_get_primary_image_handle(ctx);
    if (handleResult.code !== heif.heif_error_code.heif_error_Ok) {
        heif.heif_context_free(ctx);
        throw new Error('libheif: could not get primary image handle — ' + (handleResult.message || 'unknown error'));
    }
    const handle = handleResult.get_handle();

    // 6. Decode to RGBA
    const decodeResult = heif.heif_decode_image(
        handle,
        heif.heif_colorspace.heif_colorspace_RGB,
        heif.heif_chroma.heif_chroma_interleaved_RGBA
    );
    if (decodeResult.code !== heif.heif_error_code.heif_error_Ok) {
        heif.heif_context_free(ctx);
        throw new Error('libheif: decode failed — ' + (decodeResult.message || 'unknown error'));
    }
    const image = decodeResult.get_image();

    // 7. Extract pixel data
    const width = image.get_width();
    const height = image.get_height();
    const plane = image.get_plane(heif.heif_channel.interleaved);

    if (!plane || !plane.data) {
        heif.heif_context_free(ctx);
        throw new Error('libheif: could not get image plane data.');
    }

    // plane.data is a Uint8Array of RGBA bytes, stride = bytes per row
    const stride = plane.stride;          // bytes per row (may include padding)
    const rgba = plane.data;

    // 8. Paint onto an off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cctx = canvas.getContext('2d');

    // ImageData requires exactly width*4 bytes per row with no padding.
    // If stride === width * 4 we can use the buffer directly; otherwise copy row by row.
    let pixelData;
    if (stride === width * 4) {
        pixelData = rgba.slice(0, width * height * 4);
    } else {
        pixelData = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row++) {
            const src = row * stride;
            const dest = row * width * 4;
            pixelData.set(rgba.subarray(src, src + width * 4), dest);
        }
    }

    const imageData = new ImageData(new Uint8ClampedArray(pixelData), width, height);
    cctx.putImageData(imageData, 0, 0);

    // 9. Free the context (handles + images are GC'd by the WASM heap)
    heif.heif_context_free(ctx);

    return canvas;
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

    // ── HEIC / HEIF path ───────────────────────────────────────────────────
    if (isHEICFile(file)) {
        statusEl.textContent = '⏳ Decoding HEIC — this may take a moment…';
        announce('Decoding HEIC image…');

        decodeHEICToCanvas(file)
            .then(canvas => {
                converterState.canvas = canvas;
                statusEl.style.display = 'none';
                updateConverterPreview();
                announce('Converter: HEIC decoded. Choose a format and action.');
            })
            .catch(err => {
                statusEl.style.display = 'none';
                errEl.style.display = 'block';
                errEl.innerHTML =
                    '⚠ Could not decode HEIC file: ' + err.message +
                    '<br>On iPhone you can also: Photos app → Share → Save as JPEG, then upload that file.';
                announce('HEIC decode error: ' + err.message);
            });

        return; // async path handled above — skip the normal img.onload path
    }

    // ── Normal path (JPEG, PNG, WEBP, GIF, SVG, BMP, AVIF…) ──────────────
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

        // Draw onto an off-screen canvas (no size cap — converter keeps full res)
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

    // Pre-load the file
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
    document.getElementById('convDropSub').textContent = 'JPEG · PNG · WEBP · GIF · BMP · SVG · HEIC';
    announce('Converter cleared.');
}