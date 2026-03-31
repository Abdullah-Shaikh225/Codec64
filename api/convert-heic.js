/**
 * api/convert-heic.js
 *
 * Vercel serverless function.
 * Receives a HEIC/HEIF file via multipart POST,
 * converts it to JPEG using sharp, and returns the JPEG bytes.
 *
 * Endpoint: POST /api/convert-heic
 * Body:      multipart/form-data  →  field name: "file"
 * Response:  image/jpeg bytes
 */

import sharp from 'sharp';

export const config = {
    api: {
        bodyParser: false,   // we parse the raw multipart stream ourselves
        sizeLimit: '20mb',   // HEIC files from modern phones can be 10–15 MB
    },
};

// ── Simple multipart parser (no extra dependency) ─────────────────────────────
// Vercel gives us a Node.js IncomingMessage. We read the raw body,
// then extract the file bytes from the multipart envelope manually.
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', err => reject(err));
    });
}

/**
 * Extracts the binary file payload from a multipart/form-data body.
 * Handles the common case of a single file field named "file".
 *
 * @param {Buffer} body         raw request body
 * @param {string} contentType  value of Content-Type header (contains boundary)
 * @returns {Buffer}            raw bytes of the uploaded file
 */
function extractFileFromMultipart(body, contentType) {
    // Pull boundary from Content-Type header
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) throw new Error('No multipart boundary found in Content-Type.');
    const boundary = '--' + boundaryMatch[1];

    // Split body on boundary lines
    const boundaryBuf = Buffer.from(boundary);
    const parts = [];
    let start = 0;

    while (start < body.length) {
        const idx = body.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        parts.push(body.slice(start, idx));
        start = idx + boundaryBuf.length;
    }

    // Find the part that contains our file field
    for (const part of parts) {
        const str = part.toString('binary');
        if (!str.includes('name="file"')) continue;

        // Headers and body of a part are separated by \r\n\r\n
        const headerEnd = str.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        // Skip the header bytes + 4 bytes for \r\n\r\n, trim trailing \r\n
        const fileStart = headerEnd + 4;
        let fileEnd = part.length;
        // Strip trailing \r\n before the next boundary
        if (part[fileEnd - 2] === 0x0d && part[fileEnd - 1] === 0x0a) fileEnd -= 2;

        return part.slice(fileStart, fileEnd);
    }

    throw new Error('Could not find file field in multipart body.');
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // CORS headers — allow the page itself to call this function
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }

    try {
        // 1. Read the raw multipart body
        const rawBody = await readRawBody(req);
        const contentType = req.headers['content-type'] || '';

        // 2. Extract the file bytes from the multipart envelope
        const fileBytes = extractFileFromMultipart(rawBody, contentType);

        if (!fileBytes || fileBytes.length === 0) {
            res.status(400).json({ error: 'No file data received.' });
            return;
        }

        // 3. Convert HEIC → JPEG using sharp
        //    sharp uses libvips under the hood which supports HEIC natively.
        //    quality(90) gives a good balance of size vs quality for phone photos.
        const jpegBuffer = await sharp(fileBytes)
            .rotate()           // auto-rotate based on EXIF orientation (important for phone photos)
            .jpeg({ quality: 90 })
            .toBuffer();

        // 4. Return the JPEG bytes
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', jpegBuffer.length);
        res.status(200).send(jpegBuffer);

    } catch (err) {
        console.error('HEIC conversion error:', err);
        res.status(500).json({
            error: 'Conversion failed: ' + (err.message || 'unknown error'),
        });
    }
}