const { fal } = require('@fal-ai/client');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const JSZip = require('jszip');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
const FAL_KEY = process.env.FAL_KEY || '';
const BLOTATO_API_KEY = process.env.BLOTATO_API_KEY || '';
const BLOTATO_INSTAGRAM_ACCOUNT_ID = process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID || '';

if (FAL_KEY) fal.config({ credentials: FAL_KEY });

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function binary(statusCode, bodyBuffer, headers) {
  return {
    statusCode,
    headers: Object.assign({
      'Cache-Control': 'no-store'
    }, headers || {}),
    body: bodyBuffer.toString('base64'),
    isBase64Encoded: true
  };
}

function textResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }, headers || {}),
    body
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (err) {
    return {};
  }
}

function dataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('Uploaded file was not sent as a base64 data URL.');
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  };
}

function normalizeExtractedText(text, maxChars = 60000) {
  return String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
}

const SUPPORTED_UPLOADED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

function uploadedImageInfo(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return { usable: false, reason: 'not a base64 data URL' };
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_UPLOADED_IMAGE_TYPES.has(mimeType)) {
    return { usable: false, mimeType, reason: `${mimeType} is not supported for AI vision` };
  }
  try {
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    const detectedType = detectImageContentType(buffer, '');
    if (!detectedType) return { usable: false, mimeType, reason: 'image bytes could not be recognized' };
    return { usable: true, mimeType: detectedType };
  } catch (err) {
    return { usable: false, mimeType, reason: 'image data could not be decoded' };
  }
}

function sanitizeUploadedPhotos(photos) {
  return (Array.isArray(photos) ? photos : []).map((photo) => {
    if (!photo || !photo.dataUrl) return photo;
    const info = uploadedImageInfo(photo.dataUrl);
    if (info.usable) return Object.assign({}, photo, { dataUrl: photo.dataUrl, hasUsableImage: true });
    console.warn(`[asset skipped] ${photo.label || photo.id || 'untitled'}: ${info.reason}`);
    return Object.assign({}, photo, { dataUrl: null, hasUsableImage: false, imageWarning: info.reason });
  });
}

function safeFilename(name, fallback) {
  return String(name || fallback || 'render-studio-image.png')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || fallback || 'render-studio-image.png';
}

function safeRemoteImageUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) image URLs can be downloaded.');
  return parsed.toString();
}

async function fetchImageBuffer(rawUrl) {
  const url = safeRemoteImageUrl(rawUrl);
  const resp = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      'User-Agent': 'RenderStudio/1.0'
    }
  });
  if (!resp.ok) throw new Error(`Image download failed (${resp.status}).`);
  const declaredType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const arr = await resp.arrayBuffer();
  const buffer = Buffer.from(arr);
  const contentType = detectImageContentType(buffer, declaredType);
  if (!contentType) throw new Error(`URL did not return a supported image (${declaredType || 'unknown content type'}).`);
  return { buffer, contentType };
}

function detectImageContentType(buffer, declaredType) {
  if (/^image\//i.test(declaredType)) return declaredType;
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  return '';
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(files) {
  const now = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name);
    const data = file.buffer;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(now.dosTime, 10);
    local.writeUInt16LE(now.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.dosTime, 12);
    central.writeUInt16LE(now.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(localParts.concat(centralParts, end));
}

function parseClaudeJson(content) {
  if (!content) throw new Error('OpenRouter returned an empty response.');

  let cleaned = String(content).trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const possibleJson = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(possibleJson);
      } catch (secondErr) {
        throw new Error(`Claude returned malformed JSON: ${secondErr.message}`);
      }
    }
    throw new Error(`Claude returned malformed JSON: ${firstErr.message}`);
  }
}

function routePath(event) {
  const raw = event.path || '';
  const marker = '/.netlify/functions/api';
  if (raw.includes(marker)) return raw.slice(raw.indexOf(marker) + marker.length).replace(/^\//, '');
  if (raw.includes('/api/')) return raw.slice(raw.indexOf('/api/') + 5);
  return raw.replace(/^\//, '');
}

function normalizeUrl(rawUrl) {
  const withProtocol = /^https?:\/\//i.test(String(rawUrl || '')) ? String(rawUrl).trim() : `https://${String(rawUrl || '').trim()}`;
  const url = new URL(withProtocol);
  return url.toString();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const match = String(html || '').match(re);
  return match ? match[1].trim() : '';
}

function pickTitle(html) {
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripHtml(title[1]).slice(0, 120) : '';
}

function absolutizeUrl(src, baseUrl) {
  try {
    if (!src || /^(data:|blob:|javascript:)/i.test(src)) return '';
    return new URL(src, baseUrl).toString();
  } catch (err) {
    return '';
  }
}

function extractImageUrls(html, baseUrl) {
  const urls = [];
  [pickMeta(html, 'og:image'), pickMeta(html, 'twitter:image')].forEach((src) => {
    const url = absolutizeUrl(src, baseUrl);
    if (url && !urls.includes(url)) urls.push(url);
  });

  const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRe.exec(String(html || ''))) && urls.length < 8) {
    const url = absolutizeUrl(match[1], baseUrl);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 8);
}

function extractColors(html) {
  const colors = String(html || '').match(/#[0-9a-f]{6}\b/gi) || [];
  return Array.from(new Set(colors.map((c) => c.toUpperCase()))).slice(0, 6);
}

async function callOpenRouter(messages, model, useJsonMode) {
  const body = {
    model,
    messages,
    max_tokens: 1800
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://tggrenderstudio.netlify.app',
      'X-Title': 'RENDER Studio'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter ${model} request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return parseClaudeJson(content);
}

async function callClaude(messages) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it in Netlify Environment variables and redeploy.');
  }

  const models = [OPENROUTER_MODEL, 'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4.5', 'openrouter/auto']
    .filter((model, idx, arr) => model && arr.indexOf(model) === idx);
  const errors = [];

  for (const model of models) {
    for (const useJsonMode of [true, false]) {
      try {
        console.log(`[openrouter] -> ${model} jsonMode=${useJsonMode}`);
        const parsed = await callOpenRouter(messages, model, useJsonMode);
        console.log(`[openrouter] <- ${model} ok`);
        return parsed;
      } catch (err) {
        console.error(`[openrouter] ${model} jsonMode=${useJsonMode} failed:`, err.message);
        errors.push(err.message);
      }
    }
  }

  throw new Error(errors[0] || 'OpenRouter request failed.');
}

async function summarizeBrandKnowledge({ kind, fileName, fileType, text, imageDataUrl, zipEntries }) {
  if (kind === 'identity') {
    return {
      summary: normalizeExtractedText(text, 12000),
      guidance: normalizeExtractedText(text, 60000)
    };
  }

  const nameLine = `File: ${fileName || 'Untitled'} (${fileType || 'unknown type'})`;
  if (imageDataUrl) {
    const visionContent = [
      {
        type: 'text',
        text: `${nameLine}

This is campaign inspiration/reference material for an Instagram carousel generator. Summarize the useful creative guidance: visual style, layout, mood, typography, colors, composition, subject matter, and anything to avoid.

Return ONLY a JSON object of this exact shape:
{"summary":"short useful summary","guidance":"creative guidance extracted from this reference"}`
      },
      { type: 'image_url', image_url: { url: imageDataUrl } }
    ];
    return await callClaude([{ role: 'user', content: visionContent }]);
  }

  const source = zipEntries && zipEntries.length
    ? `ZIP entries:\n${zipEntries.join('\n')}\n\nExtracted text:\n${normalizeExtractedText(text, 16000)}`
    : normalizeExtractedText(text, 16000);
  if (!source) {
    return {
      summary: `${fileName || 'Campaign inspiration'} uploaded as ${fileType || 'a reference file'}.`,
      guidance: 'Use this campaign inspiration as optional reference material by filename only; no extractable text was found.'
    };
  }

  const prompt = `${nameLine}

This is campaign inspiration/reference material for an Instagram carousel generator.

Summarize the useful creative guidance for Claude idea generation. Focus on visual style, layout ideas, mood, typography, colors, composition, subject matter, references, and do/don't guidance. Keep it compact.

SOURCE MATERIAL:
${source}

Return ONLY a JSON object of this exact shape:
{"summary":"short useful summary","guidance":"creative guidance extracted from this reference"}`;
  return await callClaude([{ role: 'user', content: prompt }]);
}

async function extractTextFromUpload(fileName, fileType, dataUrl) {
  const lowerName = String(fileName || '').toLowerCase();
  const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
  const effectiveType = String(fileType || mimeType || '').toLowerCase();

  if (/\.(txt|md|markdown)$/i.test(lowerName) || /^text\//.test(effectiveType)) {
    return { text: normalizeExtractedText(buffer.toString('utf8'), 60000), mimeType };
  }

  if (/\.pdf$/i.test(lowerName) || effectiveType === 'application/pdf') {
    const parsed = await pdfParse(buffer);
    return { text: normalizeExtractedText(parsed.text, 60000), mimeType };
  }

  if (/\.docx$/i.test(lowerName) || effectiveType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const parsed = await mammoth.extractRawText({ buffer });
    return { text: normalizeExtractedText(parsed.value, 60000), mimeType };
  }

  if (/\.zip$/i.test(lowerName) || effectiveType === 'application/zip' || effectiveType === 'application/x-zip-compressed') {
    const zip = await JSZip.loadAsync(buffer);
    const entries = [];
    const textChunks = [];
    const files = Object.keys(zip.files).slice(0, 80);
    for (const path of files) {
      const entry = zip.files[path];
      if (entry.dir) continue;
      entries.push(path);
      if (/\.(txt|md|markdown|csv)$/i.test(path) && textChunks.join('\n').length < 40000) {
        textChunks.push(`--- ${path} ---\n${await entry.async('string')}`);
      }
    }
    return { text: normalizeExtractedText(textChunks.join('\n\n'), 60000), mimeType, zipEntries: entries };
  }

  return { text: '', mimeType };
}

async function extractBrandKnowledge(event) {
  const { kind, fileName, fileType, dataUrl } = parseBody(event);
  if (!kind || !fileName || !dataUrl) return json(400, { error: 'Missing kind, fileName, or file data.' });
  const normalizedKind = kind === 'identity' ? 'identity' : 'campaign';
  const lowerName = String(fileName || '').toLowerCase();
  const { mimeType } = dataUrlToBuffer(dataUrl);

  if (normalizedKind === 'identity' && !(/\.(pdf|docx|txt|md|markdown)$/i.test(lowerName))) {
    return json(400, { error: 'Brand Identity Kit must be a PDF, DOCX, TXT, or Markdown file.' });
  }

  const isCampaignImage = /^image\/(png|jpe?g|webp|gif)$/i.test(mimeType);
  if (normalizedKind === 'campaign' && !isCampaignImage && !(/\.(pdf|docx|txt|md|markdown|zip)$/i.test(lowerName))) {
    return json(400, { error: 'Campaign Inspiration must be a PDF, ZIP, image, TXT, or Markdown file.' });
  }

  let extracted = { text: '', mimeType, zipEntries: [] };
  if (!isCampaignImage) extracted = await extractTextFromUpload(fileName, fileType || mimeType, dataUrl);

  const summarized = await summarizeBrandKnowledge({
    kind: normalizedKind,
    fileName,
    fileType: fileType || extracted.mimeType || mimeType,
    text: extracted.text,
    imageDataUrl: isCampaignImage ? dataUrl : '',
    zipEntries: extracted.zipEntries || []
  });

  return json(200, {
    item: {
      id: Math.random().toString(36).slice(2, 10),
      kind: normalizedKind,
      fileName,
      fileType: fileType || extracted.mimeType || mimeType,
      text: normalizedKind === 'identity' ? (summarized.guidance || extracted.text || '') : '',
      summary: summarized.summary || '',
      guidance: summarized.guidance || summarized.summary || '',
      zipEntries: extracted.zipEntries || [],
      uploadedAt: new Date().toISOString()
    }
  });
}

async function submitSlideJob(prompt, referenceDataUrl) {
  if (!FAL_KEY) {
    throw new Error('FAL_KEY is not set. Add it in Netlify Environment variables and redeploy.');
  }

  const endpoint = referenceDataUrl ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2';
  const input = referenceDataUrl
    ? { prompt, image_urls: [referenceDataUrl], quality: 'high', output_format: 'png' }
    : { prompt, image_size: 'portrait_4_3', quality: 'high', num_images: 1, output_format: 'png' };

  console.log(`[fal submit] -> ${endpoint}`, JSON.stringify({
    prompt: input.prompt,
    image_size: input.image_size,
    quality: input.quality,
    output_format: input.output_format,
    num_images: input.num_images,
    hasReferenceImage: !!referenceDataUrl
  }));

  let queued;
  try {
    queued = await fal.queue.submit(endpoint, { input });
  } catch (err) {
    console.error(`[fal submit] ${endpoint} failed:`, err);
    const status = err && (err.status || err.statusCode || err.code);
    const message = String((err && err.message) || '');
    if (status === 401 || status === 403 || /\b(401|403|forbidden|unauthorized)\b/i.test(message)) {
      throw new Error('Fal rejected the render request. Check FAL_KEY in Netlify and confirm this key has access to openai/gpt-image-2.');
    }
    throw err;
  }
  console.log(`[fal submit] <- ${endpoint} request_id=${queued.request_id}`);
  return { endpoint, requestId: queued.request_id };
}

async function checkSlideJob(endpoint, requestId) {
  const status = await fal.queue.status(endpoint, { requestId, logs: true });
  console.log(`[fal status] ${endpoint} request_id=${requestId} status=${status.status}` +
    (status.queue_position != null ? ` queuePosition=${status.queue_position}` : ''));

  const normalizedStatus = String(status.status || '').toUpperCase();
  if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(normalizedStatus)) {
    const logMessage = Array.isArray(status.logs) && status.logs.length
      ? status.logs.map((log) => log.message || log).filter(Boolean).slice(-2).join(' ')
      : '';
    return {
      status: 'failed',
      error: status.error || status.message || logMessage || `Fal job ended with status ${status.status}.`
    };
  }

  if (normalizedStatus !== 'COMPLETED') {
    return { status: 'pending' };
  }

  const result = await fal.queue.result(endpoint, { requestId });
  const image = result && result.data && result.data.images && result.data.images[0];
  if (!image || !image.url) {
    console.error(`[fal result] ${endpoint} request_id=${requestId} completed with no image:`, JSON.stringify(result && result.data));
    return { status: 'failed', error: 'Fal completed but returned no image.' };
  }
  return { status: 'complete', imageUrl: image.url };
}

async function configStatus() {
  return json(200, {
    openrouter: !!OPENROUTER_API_KEY,
    fal: !!FAL_KEY,
    blotato: !!BLOTATO_API_KEY && !!BLOTATO_INSTAGRAM_ACCOUNT_ID
  });
}

async function analyzeBrand(event) {
  const { url } = parseBody(event);
  if (!url) return json(400, { error: 'Missing brand URL.' });

  const normalizedUrl = normalizeUrl(url);
  const parsedUrl = new URL(normalizedUrl);
  let html = '';
  let fetchError = '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const resp = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RenderStudio/1.0; +https://tggrenderstudio.netlify.app)'
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Website fetch failed (${resp.status})`);
    html = await resp.text();
  } catch (err) {
    fetchError = err.message || 'Website fetch failed.';
  }

  const title = pickTitle(html);
  const description = pickMeta(html, 'description') || pickMeta(html, 'og:description') || '';
  const siteName = pickMeta(html, 'og:site_name') || title || parsedUrl.hostname.replace(/^www\./, '');
  const text = stripHtml(html).slice(0, 4500);
  const imageUrls = extractImageUrls(html, normalizedUrl);
  const colors = extractColors(html);

  const prompt = `You are analyzing a brand website for RENDER Studio.
URL: ${normalizedUrl}
Hostname: ${parsedUrl.hostname}
Site name/title: ${siteName}
Meta description: ${description}
Colors found in HTML: ${colors.join(', ') || 'none'}
Image URLs found: ${JSON.stringify(imageUrls.slice(0, 6))}
Visible website text excerpt: ${text || '(site text unavailable; infer carefully from URL/title/description)'}

Return ONLY JSON in this exact shape:
{"brand":{"name":"brand display name, not the URL unless that is the brand","colors":["#000000","#FFFFFF","#FF5A5F","#173F35"],"vibeTags":["3-6 short brand voice tags"],"photos":[{"label":"short useful asset label","role":"logo|product|lifestyle|texture|reference","url":"matching image URL from the supplied list or empty string"}],"imagery":[{"url":"matching image URL from the supplied list or empty string"}]}}`;

  const parsed = await callClaude([{ role: 'user', content: prompt }]);
  const analyzed = parsed.brand || {};
  const safeColors = Array.isArray(analyzed.colors) && analyzed.colors.length
    ? analyzed.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6)
    : (colors.length ? colors.slice(0, 4) : ['#15130F', '#F4EFE6', '#FF5A5F', '#173F35']);
  const safeImages = Array.isArray(analyzed.photos) ? analyzed.photos.slice(0, 6) : [];
  const safeImagery = Array.isArray(analyzed.imagery) ? analyzed.imagery.slice(0, 4) : [];

  return json(200, {
    brand: {
      name: analyzed.name || siteName,
      colors: safeColors.length ? safeColors : ['#15130F', '#F4EFE6', '#FF5A5F', '#173F35'],
      vibeTags: Array.isArray(analyzed.vibeTags) && analyzed.vibeTags.length ? analyzed.vibeTags.slice(0, 8) : ['Clean', 'Editorial', 'Social'],
      photos: safeImages.map((p, i) => ({
        id: `web-photo-${i + 1}`,
        label: p.label || `Website asset ${i + 1}`,
        role: ['logo', 'product', 'lifestyle', 'texture', 'reference'].includes(p.role) ? p.role : 'reference',
        dataUrl: p.url && imageUrls.includes(p.url) ? p.url : ''
      })).filter((p) => p.dataUrl),
      imagery: safeImagery.map((im, i) => ({
        id: `web-image-${i + 1}`,
        dataUrl: im.url && imageUrls.includes(im.url) ? im.url : ''
      })).filter((im) => im.dataUrl)
    },
    source: {
      url: normalizedUrl,
      fetchError
    }
  });
}

async function generateIdeas(event) {
  const { topic, count, brand, brandVoice, brandKnowledge } = parseBody(event);
  if (!topic || !count || !brand) return json(400, { error: 'Missing topic, count, or brand.' });
  const creativeDirectionBlock = buildCreativeDirectionBlock(topic, brandVoice);
  const brandKnowledgeBlock = buildBrandKnowledgeBlock(brandKnowledge);

  const prompt = `You are the social media creative director for the brand "${brand.name}".
Brand voice/vibe: ${(brand.vibeTags || []).join(', ')}.
Brand colors (hex): ${(brand.colors || []).join(', ')}.
${brandKnowledgeBlock}

Write ${count} distinct Instagram carousel post ideas using this request:
${creativeDirectionBlock}

Each idea needs a different creative angle. Do not repeat the same concept.

Return ONLY a JSON object of this exact shape, no prose:
{"ideas": [
  {"tag": "a short 2-4 word concept label, e.g. Product Spotlight", "title": "a short post title", "concept": "one sentence describing the carousel's visual/creative concept", "caption": "a ready-to-post Instagram caption in the brand's voice, 2-4 sentences, natural, no hashtag spam"}
]}`;

  const parsed = await callClaude([{ role: 'user', content: prompt }]);
  const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, Number(count)) : [];
  if (!ideas.length) throw new Error('Claude did not return any ideas.');
  return json(200, { ideas });
}

function normalizeBrandVoice(brandVoice) {
  const voice = String(brandVoice || '');
  return voice.trim() ? voice : '';
}

function buildCreativeDirectionBlock(topic, brandVoice) {
  const voice = normalizeBrandVoice(brandVoice);
  if (!voice) return `CREATIVE DIRECTION:\n${topic}`;
  return `---
BRAND VOICE AND RULES:
${voice}
---
CREATIVE DIRECTION:
${topic}
---`;
}

function buildBrandKnowledgeBlock(brandKnowledge) {
  if (!brandKnowledge || typeof brandKnowledge !== 'object') return '';
  const identity = normalizeExtractedText(brandKnowledge.identityKitText || brandKnowledge.identityGuidance || '', 24000);
  const campaign = normalizeExtractedText(brandKnowledge.campaignInspirationSummary || brandKnowledge.campaignGuidance || '', 16000);
  if (!identity && !campaign) return '';
  return `
---
BRAND KNOWLEDGE:
${identity ? `Identity Kit Guidance:\n${identity}\n` : ''}
${campaign ? `Campaign Inspiration Summary:\n${campaign}\n` : ''}
---`;
}

function assetSummary(photos) {
  return photos.map((p) => ({
    id: p.id,
    label: p.label || 'Untitled asset',
    role: p.role || 'reference',
    hasUsableImage: !!p.dataUrl,
    imageWarning: p.imageWarning || ''
  }));
}

function buildImagePrompt({ brand, idea, slide, photo }) {
  const basePrompt = (idea && idea.renderPrompt)
    ? String(idea.renderPrompt).trim()
    : `Instagram carousel slide for the brand ${brand.name}.`;
  const assetLine = photo
    ? `Use uploaded asset "${photo.label}" as a ${photo.role || 'reference'} reference.`
    : 'No uploaded asset was selected for this slide.';

  const visualInstructions = `${basePrompt}

Slide ${slide.n}: bold uppercase headline text reading "${slide.hook}".
${assetLine}
Available uploaded assets: ${JSON.stringify(assetSummary(Array.isArray(brand.photos) ? brand.photos : []))}.
Brand color palette: ${(brand.colors || []).join(', ')}.
Editorial studio lighting, high contrast, premium social carousel composition, 4:5 portrait aspect ratio, no watermark, no border.`;
  const voice = normalizeBrandVoice(idea && idea.brandVoice);
  if (!voice) return visualInstructions;
  return `---
BRAND VOICE AND RULES (follow strictly):
${voice}
---
VISUAL INSTRUCTIONS:
${visualInstructions}
---`;
}

async function submitRenderedSlide({ brand, idea, slide }) {
  const photos = Array.isArray(brand.photos) ? brand.photos : [];
  const photo = photos.find((p) => p.id === slide.photoId) || photos[0] || null;
  const imagePrompt = buildImagePrompt({ brand, idea, slide, photo });
  const job = await submitSlideJob(imagePrompt, photo && photo.dataUrl);
  return {
    n: slide.n,
    hook: slide.hook,
    photoId: photo ? photo.id : null,
    photoLabel: photo ? photo.label : '',
    photoRole: photo ? (photo.role || 'reference') : '',
    prompt: imagePrompt,
    endpoint: job.endpoint,
    requestId: job.requestId
  };
}

async function renderCarousel(event) {
  const { idea, frameCount, brand } = parseBody(event);
  if (!idea || !frameCount || !brand) return json(400, { error: 'Missing idea, frameCount, or brand.' });

  const photos = sanitizeUploadedPhotos(brand.photos);
  const brandForRender = Object.assign({}, brand, { photos });
  const photosForPrompt = assetSummary(photos);

  const pickText = `You are art-directing a ${frameCount}-slide Instagram carousel for "${brand.name}".
Post title: "${idea.title}"
Concept: "${idea.concept}"
Editable render prompt from the user: "${idea.renderPrompt || ''}"
Available uploaded assets: ${JSON.stringify(photosForPrompt)}

For each of the ${frameCount} slides, in story order, pick the single best-fitting uploaded asset id from the list above. Prefer assets with hasUsableImage=true when visual fidelity matters. Assets with hasUsableImage=false can still inform the concept by label and role, but their image file was not sent to vision/rendering. Use each asset's role intentionally: product for hero/product shots, logo for brand marks, lifestyle for human/context imagery, texture for backgrounds, and reference for visual direction. Assets may repeat if needed. Also write a short, punchy 1-4 word uppercase hook line for that slide.

Return ONLY a JSON object of this exact shape, no prose:
{"slides": [{"n": 1, "photoId": null, "hook": "..."}]}`;

  const visionContent = [{ type: 'text', text: pickText }];
  photos.filter((p) => p.dataUrl).forEach((p) => {
    visionContent.push({ type: 'image_url', image_url: { url: p.dataUrl } });
  });

  const picked = await callClaude([{ role: 'user', content: visionContent }]);
  const slides = (Array.isArray(picked.slides) ? picked.slides : []).slice(0, Number(frameCount));
  if (!slides.length) throw new Error('Claude did not return any slide picks.');

  const renderJobId = Math.random().toString(36).slice(2, 10);
  console.log(`[render-carousel] renderJobId=${renderJobId} submitting ${slides.length} slide job(s)`);

  const submitted = await Promise.all(slides.map((slide) => submitRenderedSlide({ brand: brandForRender, idea, slide })));

  submitted.sort((a, b) => a.n - b.n);
  console.log(`[render-carousel] renderJobId=${renderJobId} submitted ${submitted.length} job(s)`);

  return json(200, { renderJobId, slides: submitted });
}

async function renderSlide(event) {
  const { idea, brand, slide } = parseBody(event);
  if (!idea || !brand || !slide) return json(400, { error: 'Missing idea, brand, or slide.' });
  if (!slide.n || !slide.hook) return json(400, { error: 'Missing slide number or hook.' });

  const brandForRender = Object.assign({}, brand, { photos: sanitizeUploadedPhotos(brand.photos) });
  const submitted = await submitRenderedSlide({ brand: brandForRender, idea, slide });
  return json(200, { slide: submitted });
}

async function renderStatus(event) {
  const { jobs } = parseBody(event);
  if (!Array.isArray(jobs) || !jobs.length) return json(400, { error: 'Missing jobs array.' });

  const slides = await Promise.all(jobs.map(async (job) => {
    try {
      const check = await checkSlideJob(job.endpoint, job.requestId);
      return Object.assign({ n: job.n }, check);
    } catch (err) {
      console.error(`[render-status] job n=${job.n} (${job.endpoint}/${job.requestId}) failed:`, err.message);
      return { n: job.n, status: 'failed', error: err.message };
    }
  }));

  return json(200, { slides });
}

async function downloadImage(event) {
  const params = event.httpMethod === 'POST' ? parseBody(event) : (event.queryStringParameters || {});
  const imageUrl = params.url || params.imageUrl;
  const filename = safeFilename(params.filename || 'render-studio-slide.png', 'render-studio-slide.png');
  if (!imageUrl) return json(400, { error: 'Missing image URL.' });

  const image = await fetchImageBuffer(imageUrl);
  return binary(200, image.buffer, {
    'Content-Type': image.contentType,
    'Content-Disposition': `attachment; filename="${filename}"`
  });
}

async function downloadCarousel(event) {
  const { slides, title } = parseBody(event);
  const finishedSlides = Array.isArray(slides) ? slides.filter((slide) => slide && slide.imageUrl) : [];
  if (!finishedSlides.length) return json(400, { error: 'No finished slides to download.' });

  const files = [];
  for (let i = 0; i < finishedSlides.length; i++) {
    const slide = finishedSlides[i];
    const image = await fetchImageBuffer(slide.imageUrl);
    const extension = image.contentType.includes('jpeg') || image.contentType.includes('jpg') ? 'jpg'
      : image.contentType.includes('webp') ? 'webp'
        : 'png';
    files.push({
      name: safeFilename(`slide-${String(slide.n || i + 1).padStart(2, '0')}-${slide.hook || 'render'}.${extension}`, `slide-${i + 1}.${extension}`),
      buffer: image.buffer
    });
  }

  const zip = createZip(files);
  const filename = safeFilename(`${title || 'render-studio-carousel'}.zip`, 'render-studio-carousel.zip');
  return binary(200, zip, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename.endsWith('.zip') ? filename : filename + '.zip'}"`
  });
}

async function schedulePost(event) {
  if (!BLOTATO_API_KEY) throw new Error('BLOTATO_API_KEY is not set. Add it in Netlify Environment variables and redeploy.');
  if (!BLOTATO_INSTAGRAM_ACCOUNT_ID) throw new Error('BLOTATO_INSTAGRAM_ACCOUNT_ID is not set. Add it in Netlify Environment variables and redeploy.');

  const { caption, imageUrls, scheduleDate, scheduleTime } = parseBody(event);
  if (!caption || !Array.isArray(imageUrls) || !imageUrls.length || !scheduleDate || !scheduleTime) {
    return json(400, { error: 'Missing caption, imageUrls, scheduleDate, or scheduleTime.' });
  }

  const scheduledTime = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
  const body = {
    post: {
      accountId: BLOTATO_INSTAGRAM_ACCOUNT_ID,
      content: { text: caption, mediaUrls: imageUrls, platform: 'instagram' },
      target: { targetType: 'instagram' }
    },
    scheduledTime
  };

  const resp = await fetch('https://backend.blotato.com/v2/posts', {
    method: 'POST',
    headers: { 'blotato-api-key': BLOTATO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Blotato request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  return json(200, data);
}

async function blotatoAccounts() {
  if (!BLOTATO_API_KEY) throw new Error('BLOTATO_API_KEY is not set. Add it in Netlify Environment variables and redeploy.');

  const resp = await fetch('https://backend.blotato.com/v2/users/me/accounts?platform=instagram', {
    headers: { 'blotato-api-key': BLOTATO_API_KEY }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Blotato request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  return json(200, data);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

  const route = routePath(event);

  try {
    if (event.httpMethod === 'GET' && route === 'config-status') return await configStatus();
    if (event.httpMethod === 'POST' && route === 'analyze-brand') return await analyzeBrand(event);
    if (event.httpMethod === 'POST' && route === 'brand-knowledge/extract') return await extractBrandKnowledge(event);
    if (event.httpMethod === 'POST' && route === 'generate-ideas') return await generateIdeas(event);
    if (event.httpMethod === 'POST' && route === 'render-carousel') return await renderCarousel(event);
    if (event.httpMethod === 'POST' && route === 'render-slide') return await renderSlide(event);
    if (event.httpMethod === 'POST' && route === 'render-status') return await renderStatus(event);
    if ((event.httpMethod === 'GET' || event.httpMethod === 'POST') && route === 'download-image') return await downloadImage(event);
    if (event.httpMethod === 'POST' && route === 'download-carousel') return await downloadCarousel(event);
    if (event.httpMethod === 'POST' && route === 'schedule') return await schedulePost(event);
    if (event.httpMethod === 'GET' && route === 'blotato/accounts') return await blotatoAccounts();

    return json(404, { error: `No API route matched: ${event.httpMethod} ${route}` });
  } catch (err) {
    console.error(`[api/${route}]`, err);
    return json(500, { error: err.message || 'Server error.' });
  }
};
