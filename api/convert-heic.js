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

const sharp = require('sharp');

module.exports.config = {
    api: {
        bodyParser: false,
        sizeLimit: '20mb',
    },
};

// ── Read raw body from request ────────────────────────────────────────────────
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', err => reject(err));
    });
}

// ── Extract file bytes from multipart body ────────────────────────────────────
function extractFileFromMultipart(body, contentType) {
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) throw new Error('No multipart boundary found in Content-Type.');

    const boundary = '--' + boundaryMatch[1];
    const boundaryBuf = Buffer.from(boundary);
    const parts = [];
    let start = 0;

    while (start < body.length) {
        const idx = body.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        parts.push(body.slice(start, idx));
        start = idx + boundaryBuf.length;
    }

    for (const part of parts) {
        const str = part.toString('binary');
        if (!str.includes('name="file"')) continue;

        const headerEnd = str.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const fileStart = headerEnd + 4;
        let fileEnd = part.length;
        if (part[fileEnd - 2] === 0x0d && part[fileEnd - 1] === 0x0a) fileEnd -= 2;

        return part.slice(fileStart, fileEnd);
    }

    throw new Error('Could not find file field in multipart body.');
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
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
        const rawBody = await readRawBody(req);
        const contentType = req.headers['content-type'] || '';
        const fileBytes = extractFileFromMultipart(rawBody, contentType);

        if (!fileBytes || fileBytes.length === 0) {
            res.status(400).json({ error: 'No file data received.' });
            return;
        }

        // Use sharp with heif input format explicitly specified
        const jpegBuffer = await sharp(fileBytes, { failOn: 'none' })
            .rotate()
            .jpeg({ quality: 90 })
            .toBuffer();

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', jpegBuffer.length);
        res.status(200).send(jpegBuffer);

    } catch (err) {
        console.error('HEIC conversion error:', err);
        res.status(500).json({
            error: 'Conversion failed: ' + (err.message || 'unknown error'),
        });
    }
};