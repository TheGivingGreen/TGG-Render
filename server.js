require('dotenv').config();

const path = require('path');
const express = require('express');
const { fal } = require('@fal-ai/client');

const PORT = process.env.PORT || 3000;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
const FAL_KEY = process.env.FAL_KEY || '';
const BLOTATO_API_KEY = process.env.BLOTATO_API_KEY || '';
const BLOTATO_INSTAGRAM_ACCOUNT_ID = process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID || '';

if (FAL_KEY) fal.config({ credentials: FAL_KEY });

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- shared helpers ----

async function callClaude(messages) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to .env and restart the server.');
  }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
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
  if (!content) throw new Error('OpenRouter returned an empty response.');
  return JSON.parse(content);
}

async function renderSlideImage(prompt, referenceDataUrl) {
  if (!FAL_KEY) {
    throw new Error('FAL_KEY is not set. Add it to .env and restart the server.');
  }
  const result = referenceDataUrl
    ? await fal.subscribe('openai/gpt-image-2/edit', {
        input: { prompt, image_urls: [referenceDataUrl], quality: 'high', output_format: 'png' }
      })
    : await fal.subscribe('openai/gpt-image-2', {
        input: { prompt, image_size: 'portrait_4_3', quality: 'high', num_images: 1, output_format: 'png' }
      });
  const image = result && result.data && result.data.images && result.data.images[0];
  if (!image || !image.url) throw new Error('Fal did not return an image URL.');
  return image.url;
}

// ---- config status (for the front-end banner) ----

app.get('/api/config-status', (req, res) => {
  res.json({
    openrouter: !!OPENROUTER_API_KEY,
    fal: !!FAL_KEY,
    blotato: !!BLOTATO_API_KEY && !!BLOTATO_INSTAGRAM_ACCOUNT_ID
  });
});

// ---- Claude: idea + caption generation ----

app.post('/api/generate-ideas', async (req, res) => {
  try {
    const { topic, count, brand } = req.body;
    if (!topic || !count || !brand) return res.status(400).json({ error: 'Missing topic, count, or brand.' });

    const prompt = `You are the social media creative director for the brand "${brand.name}".
Brand voice/vibe: ${brand.vibeTags.join(', ')}.
Brand colors (hex): ${brand.colors.join(', ')}.

Write ${count} distinct Instagram carousel post ideas for this creative direction: "${topic}".
Each idea needs a different creative angle (do not repeat the same concept).

Return ONLY a JSON object of this exact shape, no prose:
{"ideas": [
  {"tag": "a short 2-4 word concept label, e.g. Product Spotlight", "title": "a short post title", "concept": "one sentence describing the carousel's visual/creative concept", "caption": "a ready-to-post Instagram caption in the brand's voice, 2-4 sentences, natural, no hashtag spam"}
]}`;

    const parsed = await callClaude([{ role: 'user', content: prompt }]);
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, count) : [];
    if (!ideas.length) throw new Error('Claude did not return any ideas.');
    res.json({ ideas });
  } catch (err) {
    console.error('[generate-ideas]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Claude (vision, picks photo per slide) + Fal (renders each slide) ----

app.post('/api/render-carousel', async (req, res) => {
  try {
    const { idea, frameCount, brand } = req.body;
    if (!idea || !frameCount || !brand) return res.status(400).json({ error: 'Missing idea, frameCount, or brand.' });

    const photos = Array.isArray(brand.photos) ? brand.photos : [];
    const photosForPrompt = photos.map((p) => ({ id: p.id, label: p.label }));

    const pickText = `You are art-directing a ${frameCount}-slide Instagram carousel for "${brand.name}".
Post title: "${idea.title}"
Concept: "${idea.concept}"
Available product photos: ${JSON.stringify(photosForPrompt)}

For each of the ${frameCount} slides (in story order: opener, then supporting detail/styling/proof slides, then a closer), pick the single best-fitting photo id from the list above (photos may repeat across slides if needed) and write a short, punchy 1-4 word hook line for that slide, ad-copy style, uppercase.

Return ONLY a JSON object of this exact shape, no prose:
{"slides": [{"n": 1, "photoId": <id from the list, or null if the list is empty>, "hook": "..."}]}`;

    const visionContent = [{ type: 'text', text: pickText }];
    photos.filter((p) => p.dataUrl).forEach((p) => {
      visionContent.push({ type: 'image_url', image_url: { url: p.dataUrl } });
    });

    const picked = await callClaude([{ role: 'user', content: visionContent }]);
    const slides = (Array.isArray(picked.slides) ? picked.slides : []).slice(0, frameCount);
    if (!slides.length) throw new Error('Claude did not return any slide picks.');

    const frames = [];
    for (const slide of slides) {
      const photo = photos.find((p) => p.id === slide.photoId) || photos[0] || null;
      const imagePrompt = `Instagram carousel slide for the brand ${brand.name}. Bold uppercase headline text reading "${slide.hook}". ${photo ? `Featured product: ${photo.label}.` : ''} Brand color palette: ${brand.colors.join(', ')}. Editorial studio lighting, high contrast, premium streetwear aesthetic, 4:5 portrait aspect ratio, no watermark, no border.`;
      const imageUrl = await renderSlideImage(imagePrompt, photo && photo.dataUrl);
      frames.push({ n: slide.n, hook: slide.hook, photoLabel: photo ? photo.label : '', imageUrl });
    }

    res.json({ frames });
  } catch (err) {
    console.error('[render-carousel]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Blotato: schedule the finished carousel to Instagram ----

app.post('/api/schedule', async (req, res) => {
  try {
    if (!BLOTATO_API_KEY) throw new Error('BLOTATO_API_KEY is not set. Add it to .env and restart the server.');
    if (!BLOTATO_INSTAGRAM_ACCOUNT_ID) throw new Error('BLOTATO_INSTAGRAM_ACCOUNT_ID is not set. Add it to .env (see GET /api/blotato/accounts) and restart the server.');

    const { caption, imageUrls, scheduleDate, scheduleTime } = req.body;
    if (!caption || !Array.isArray(imageUrls) || !imageUrls.length || !scheduleDate || !scheduleTime) {
      return res.status(400).json({ error: 'Missing caption, imageUrls, scheduleDate, or scheduleTime.' });
    }

    const scheduledTime = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();

    const body = {
      post: {
        accountId: BLOTATO_INSTAGRAM_ACCOUNT_ID,
        content: {
          text: caption,
          mediaUrls: imageUrls,
          platform: 'instagram'
        },
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
    res.json(data);
  } catch (err) {
    console.error('[schedule]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Blotato: list connected accounts, to help find your Instagram accountId ----

app.get('/api/blotato/accounts', async (req, res) => {
  try {
    if (!BLOTATO_API_KEY) throw new Error('BLOTATO_API_KEY is not set. Add it to .env and restart the server.');
    const resp = await fetch('https://backend.blotato.com/v2/users/me/accounts?platform=instagram', {
      headers: { 'blotato-api-key': BLOTATO_API_KEY }
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Blotato request failed (${resp.status}): ${text.slice(0, 500)}`);
    }
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('[blotato/accounts]', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`RENDER Studio running at http://localhost:${PORT}`);
});
