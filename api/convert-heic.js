/**
 * api/convert-heic.js — Vercel serverless function
 *
 * FIX: Access-Control-Allow-Origin was '*', allowing any website to use
 * this endpoint as a free HEIC converter and run up the bill.
 * Now restricted to ALLOWED_ORIGINS. Update this list to match your
 * deployed domain(s). localhost is included for local development.
 *
 * Also requires package.json with sharp declared as a dependency and
 * vercel.json with adequate memory (see project root).
 */

const sharp = require('sharp');

// ── Allowed origins — update to your production domain ───────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5500',  // VS Code Live Server default
  // 'https://your-production-domain.com',  ← uncomment and set your domain
];

module.exports.config = {
  api: {
    bodyParser: false,
    sizeLimit: '20mb',
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks)));
    req.on('error', err  => reject(err));
  });
}

function extractFileFromMultipart(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) throw new Error('No multipart boundary found in Content-Type.');

  const boundary    = '--' + boundaryMatch[1];
  const boundaryBuf = Buffer.from(boundary);
  const parts       = [];
  let start         = 0;

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
    let fileEnd     = part.length;
    if (part[fileEnd - 2] === 0x0d && part[fileEnd - 1] === 0x0a) fileEnd -= 2;

    return part.slice(fileStart, fileEnd);
  }

  throw new Error('Could not find file field in multipart body.');
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';

  // FIX: Only allow listed origins. Unknown origins get 403.
  // During development with no Origin header (e.g. direct curl), allow through.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }

  // Set CORS headers for the specific allowed origin (not wildcard)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin',  origin);
    res.setHeader('Vary', 'Origin');
  }
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
    const rawBody     = await readRawBody(req);
    const contentType = req.headers['content-type'] || '';
    const fileBytes   = extractFileFromMultipart(rawBody, contentType);

    if (!fileBytes || fileBytes.length === 0) {
      res.status(400).json({ error: 'No file data received.' });
      return;
    }

    const jpegBuffer = await sharp(fileBytes, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer();

    res.setHeader('Content-Type',   'image/jpeg');
    res.setHeader('Content-Length', jpegBuffer.length);
    res.status(200).send(jpegBuffer);

  } catch (err) {
    console.error('HEIC conversion error:', err);
    res.status(500).json({
      error: 'Conversion failed: ' + (err.message || 'unknown error'),
    });
  }
};