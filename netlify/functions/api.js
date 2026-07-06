const { fal } = require('@fal-ai/client');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
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

  // Claude sometimes wraps valid JSON in Markdown fences despite JSON instructions.
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

async function callClaude(messages) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it in Netlify Environment variables and redeploy.');
  }

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://tggrenderstudio.netlify.app',
      'X-Title': 'RENDER Studio'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0.9,
      response_format: { type: 'json_object' }
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return parseClaudeJson(content);
}

// fal.subscribe() polls Fal's queue every 500ms with NO default ceiling.
// It only stops early if `timeout` is passed. Without that, a slow/stuck job
// can poll silently until Netlify kills the whole function at the platform limit.
const FAL_SUBSCRIBE_TIMEOUT_MS = 45000;

async function renderSlideImage(prompt, referenceDataUrl) {
  if (!FAL_KEY) {
    throw new Error('FAL_KEY is not set. Add it in Netlify Environment variables and redeploy.');
  }

  const endpoint = referenceDataUrl ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2';
  const input = referenceDataUrl
    ? { prompt, image_urls: [referenceDataUrl], quality: 'high', output_format: 'png' }
    : { prompt, image_size: 'portrait_4_3', quality: 'high', num_images: 1, output_format: 'png' };

  console.log(`[fal] -> ${endpoint} request:`, JSON.stringify({
    prompt: input.prompt,
    image_size: input.image_size,
    quality: input.quality,
    output_format: input.output_format,
    num_images: input.num_images,
    hasReferenceImage: !!referenceDataUrl
  }));

  const startedAt = Date.now();
  let result;
  try {
    result = await fal.subscribe(endpoint, {
      input,
      logs: true,
      timeout: FAL_SUBSCRIBE_TIMEOUT_MS,
      onEnqueue: (requestId) => {
        console.log(`[fal] ${endpoint} enqueued, request_id=${requestId}`);
      },
      onQueueUpdate: (update) => {
        const elapsedMs = Date.now() - startedAt;
        console.log(`[fal] ${endpoint} status=${update.status} elapsedMs=${elapsedMs}` + (update.queue_position != null ? ` queuePosition=${update.queue_position}` : ''));
        if (update.logs && update.logs.length) {
          update.logs.forEach((l) => console.log(`[fal:log] ${endpoint}`, l.message));
        }
      }
    });
  } catch (err) {
    console.error(`[fal] ${endpoint} failed after ${Date.now() - startedAt}ms:`, err.message);
    throw new Error(`Fal request to ${endpoint} failed: ${err.message}`);
  }

  console.log(`[fal] <- ${endpoint} completed requestId=${result && result.requestId} elapsedMs=${Date.now() - startedAt}`);

  const image = result && result.data && result.data.images && result.data.images[0];
  if (!image || !image.url) {
    console.error(`[fal] ${endpoint} completed but returned no image. Raw data:`, JSON.stringify(result && result.data));
    throw new Error('Fal did not return an image URL.');
  }
  return image.url;
}

async function configStatus() {
  return json(200, {
    openrouter: !!OPENROUTER_API_KEY,
    fal: !!FAL_KEY,
    blotato: !!BLOTATO_API_KEY && !!BLOTATO_INSTAGRAM_ACCOUNT_ID
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

async function renderCarousel(event) {
  const { idea, frameCount, brand } = parseBody(event);
  if (!idea || !frameCount || !brand) return json(400, { error: 'Missing idea, frameCount, or brand.' });

  const photos = Array.isArray(brand.photos) ? brand.photos : [];
  const photosForPrompt = photos.map((p) => ({ id: p.id, label: p.label }));

  const pickText = `You are art-directing a ${frameCount}-slide Instagram carousel for "${brand.name}".
Post title: "${idea.title}"
Concept: "${idea.concept}"
Available product photos: ${JSON.stringify(photosForPrompt)}

For each of the ${frameCount} slides, in story order, pick the single best-fitting photo id from the list above. Photos may repeat if needed. Also write a short, punchy 1-4 word uppercase hook line for that slide.

Return ONLY a JSON object of this exact shape, no prose:
{"slides": [{"n": 1, "photoId": null, "hook": "..."}]}`;

  const visionContent = [{ type: 'text', text: pickText }];
  photos.filter((p) => p.dataUrl).forEach((p) => {
    visionContent.push({ type: 'image_url', image_url: { url: p.dataUrl } });
  });

  const picked = await callClaude([{ role: 'user', content: visionContent }]);
  const slides = (Array.isArray(picked.slides) ? picked.slides : []).slice(0, Number(frameCount));
  if (!slides.length) throw new Error('Claude did not return any slide picks.');

  console.log(`[render-carousel] rendering ${slides.length} slide(s) in parallel`);

  // Netlify's synchronous function timeout can't absorb N sequential GPT Image calls.
  // Run them concurrently so total wall-clock time is roughly one slide, not N slides.
  const frames = await Promise.all(slides.map(async (slide) => {
    const photo = photos.find((p) => p.id === slide.photoId) || photos[0] || null;
    const imagePrompt = `Instagram carousel slide for the brand ${brand.name}. Bold uppercase headline text reading "${slide.hook}". ${photo ? `Featured product: ${photo.label}.` : ''} Brand color palette: ${(brand.colors || []).join(', ')}. Editorial studio lighting, high contrast, premium streetwear aesthetic, 4:5 portrait aspect ratio, no watermark, no border.`;
    const imageUrl = await renderSlideImage(imagePrompt, photo && photo.dataUrl);
    return { n: slide.n, hook: slide.hook, photoLabel: photo ? photo.label : '', imageUrl };
  }));

  frames.sort((a, b) => a.n - b.n);
  console.log(`[render-carousel] done, ${frames.length} image(s) returned`);

  return json(200, { frames });
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
    if (event.httpMethod === 'POST' && route === 'generate-ideas') return await generateIdeas(event);
    if (event.httpMethod === 'POST' && route === 'render-carousel') return await renderCarousel(event);
    if (event.httpMethod === 'POST' && route === 'schedule') return await schedulePost(event);
    if (event.httpMethod === 'GET' && route === 'blotato/accounts') return await blotatoAccounts();

    return json(404, { error: `No API route matched: ${event.httpMethod} ${route}` });
  } catch (err) {
    console.error(`[api/${route}]`, err);
    return json(500, { error: err.message || 'Server error.' });
  }
};
