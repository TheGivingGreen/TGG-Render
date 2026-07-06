const { fal } = require('@fal-ai/client');

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

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (err) {
    return {};
  }
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

  const queued = await fal.queue.submit(endpoint, { input });
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
  const { topic, count, brand } = parseBody(event);
  if (!topic || !count || !brand) return json(400, { error: 'Missing topic, count, or brand.' });

  const prompt = `You are the social media creative director for the brand "${brand.name}".
Brand voice/vibe: ${(brand.vibeTags || []).join(', ')}.
Brand colors (hex): ${(brand.colors || []).join(', ')}.

Write ${count} distinct Instagram carousel post ideas for this creative direction: "${topic}".
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

function assetSummary(photos) {
  return photos.map((p) => ({
    id: p.id,
    label: p.label || 'Untitled asset',
    role: p.role || 'reference'
  }));
}

function buildImagePrompt({ brand, idea, slide, photo }) {
  const basePrompt = (idea && idea.renderPrompt)
    ? String(idea.renderPrompt).trim()
    : `Instagram carousel slide for the brand ${brand.name}.`;
  const assetLine = photo
    ? `Use uploaded asset "${photo.label}" as a ${photo.role || 'reference'} reference.`
    : 'No uploaded asset was selected for this slide.';

  return `${basePrompt}

Slide ${slide.n}: bold uppercase headline text reading "${slide.hook}".
${assetLine}
Available uploaded assets: ${JSON.stringify(assetSummary(Array.isArray(brand.photos) ? brand.photos : []))}.
Brand color palette: ${(brand.colors || []).join(', ')}.
Editorial studio lighting, high contrast, premium social carousel composition, 4:5 portrait aspect ratio, no watermark, no border.`;
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

  const photos = Array.isArray(brand.photos) ? brand.photos : [];
  const photosForPrompt = assetSummary(photos);

  const pickText = `You are art-directing a ${frameCount}-slide Instagram carousel for "${brand.name}".
Post title: "${idea.title}"
Concept: "${idea.concept}"
Editable render prompt from the user: "${idea.renderPrompt || ''}"
Available uploaded assets: ${JSON.stringify(photosForPrompt)}

For each of the ${frameCount} slides, in story order, pick the single best-fitting uploaded asset id from the list above. Use each asset's role intentionally: product for hero/product shots, logo for brand marks, lifestyle for human/context imagery, texture for backgrounds, and reference for visual direction. Assets may repeat if needed. Also write a short, punchy 1-4 word uppercase hook line for that slide.

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

  const submitted = await Promise.all(slides.map((slide) => submitRenderedSlide({ brand, idea, slide })));

  submitted.sort((a, b) => a.n - b.n);
  console.log(`[render-carousel] renderJobId=${renderJobId} submitted ${submitted.length} job(s)`);

  return json(200, { renderJobId, slides: submitted });
}

async function renderSlide(event) {
  const { idea, brand, slide } = parseBody(event);
  if (!idea || !brand || !slide) return json(400, { error: 'Missing idea, brand, or slide.' });
  if (!slide.n || !slide.hook) return json(400, { error: 'Missing slide number or hook.' });

  const submitted = await submitRenderedSlide({ brand, idea, slide });
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
    if (event.httpMethod === 'POST' && route === 'generate-ideas') return await generateIdeas(event);
    if (event.httpMethod === 'POST' && route === 'render-carousel') return await renderCarousel(event);
    if (event.httpMethod === 'POST' && route === 'render-slide') return await renderSlide(event);
    if (event.httpMethod === 'POST' && route === 'render-status') return await renderStatus(event);
    if (event.httpMethod === 'POST' && route === 'schedule') return await schedulePost(event);
    if (event.httpMethod === 'GET' && route === 'blotato/accounts') return await blotatoAccounts();

    return json(404, { error: `No API route matched: ${event.httpMethod} ${route}` });
  } catch (err) {
    console.error(`[api/${route}]`, err);
    return json(500, { error: err.message || 'Server error.' });
  }
};
