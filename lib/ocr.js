const fs = require('fs');
  const path = require('path');
  const sharp = require('sharp');
  const { GoogleGenAI } = require('@google/genai');
  const { apiKeys } = require('../config');

  if (apiKeys.length === 0) {
    console.warn('😡 [OCR] WARNING: No API keys found. Set API_KEYS=key1,key2 in .env');
  }

  // Build one client per key so we can rotate instantly on quota exhaustion
  const clients = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));

  const MAX_DIMENSION = 1600; // px — crisp text without huge payloads

  // MIME types Gemini supports natively (inline data)
  const GEMINI_NATIVE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

  function isQuotaError(err) {
    const msg = (err.message || '').toLowerCase();
    return (
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('resource exhausted') ||
      msg.includes('429') ||
      err.status === 429
    );
  }

  /**
   * Normalises MIME type from filename when multer gives a generic/wrong type.
   * e.g. .ico files may arrive as application/octet-stream
   */
  function normaliseMime(filePath, mimeType) {
    const ext = path.extname(filePath).toLowerCase();
    const extMap = {
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.jfif': 'image/jpeg',
    };
    return extMap[ext] || mimeType || 'image/jpeg';
  }

  async function prepareImage(filePath, rawMime) {
    const mimeType = normaliseMime(filePath, rawMime);
    const stats = fs.statSync(filePath);
    const originalKB = Math.round(stats.size / 1024);
    const needsConversion = !GEMINI_NATIVE.has(mimeType.toLowerCase());

    // SVG: rasterise at high DPI so text is sharp
    if (mimeType === 'image/svg+xml') {
      console.log(`🔄 Converting SVG → PNG (density 300 dpi)`);
      const pngBuf = await sharp(filePath, { density: 300 })
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      console.log(`✅ SVG → PNG: ${Math.round(pngBuf.length / 1024)}KB`);
      return { base64: pngBuf.toString('base64'), mimeType: 'image/png' };
    }

    // ICO / favicon: convert to PNG
    if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon') {
      console.log(`🔄 Converting ICO → PNG`);
      const pngBuf = await sharp(filePath)
        .png()
        .toBuffer();
      console.log(`✅ ICO → PNG: ${Math.round(pngBuf.length / 1024)}KB`);
      return { base64: pngBuf.toString('base64'), mimeType: 'image/png' };
    }

    // Other non-native formats (TIFF, HEIC, HEIF, BMP, AVIF): convert to JPEG
    if (needsConversion) {
      console.log(`🔄 Converting ${mimeType} → JPEG`);
      const jpgBuf = await sharp(filePath)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      console.log(`✅ ${mimeType} → JPEG: ${originalKB}KB → ${Math.round(jpgBuf.length / 1024)}KB`);
      return { base64: jpgBuf.toString('base64'), mimeType: 'image/jpeg' };
    }

    // Native Gemini format + small enough — send as-is
    if (stats.size <= 500 * 1024) {
      const data = fs.readFileSync(filePath);
      return { base64: data.toString('base64'), mimeType };
    }

    // Native format but large — resize to JPEG
    const resized = await sharp(filePath)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    const resizedKB = Math.round(resized.length / 1024);
    console.log(`✅ Resized: ${originalKB}KB → ${resizedKB}KB`);
    return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
  }

  async function callGemini(base64, mimeType) {
    let lastErr;
    for (let i = 0; i < clients.length; i++) {
      try {
        console.log(`✅ Using key slot #${i + 1} of ${clients.length}`);
        const response = await clients[i].models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: 'Extract ALL text from this image exactly as written. Preserve the original structure and line breaks. Output only the extracted text, nothing else. Do not add any commentary or formatting.' },
            ],
          }],
        });
        return response.text?.trim() || '';
      } catch (err) {
        lastErr = err;
        if (isQuotaError(err) && i < clients.length - 1) {
          console.warn(`😡 Key slot #${i + 1} hit quota/rate-limit — trying next key...`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async function extractFromFiles(files) {
    const results = [];
    for (const file of files) {
      const t0 = Date.now();
      try {
        console.log(`🔥 OCR start: ${file.originalname} (${Math.round(file.size / 1024)}KB)`);
        const { base64, mimeType } = await prepareImage(file.path, file.mimetype || 'image/jpeg');
        console.log(`🔥 Prepared in ${Date.now() - t0}ms — sending to AI...`);
        const t1 = Date.now();
        const text = await callGemini(base64, mimeType);
        console.log(`🔥 Gemini responded in ${Date.now() - t1}ms — ${text.length} chars extracted`);
        results.push({ name: file.originalname, text, confidence: text.length > 0 ? 99 : 0, success: true });
      } catch (err) {
        console.error(`😡 OCR failed for ${file.originalname}:`, err.message);
        results.push({ name: file.originalname, text: '', confidence: 0, success: false, error: err.message });
      } finally {
        fs.unlink(file.path, () => {});
      }
    }
    return results;
  }

  module.exports = { extractFromFiles };
  