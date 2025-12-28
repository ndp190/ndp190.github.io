import type { Env, ScrapeRequest, FirecrawlResponse, StoredResult } from './types';

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/scrape';

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Scraper</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    h1 { color: #00d9ff; margin-bottom: 1.5rem; }
    .input-group {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    input[type="url"] {
      flex: 1;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      border: 2px solid #333;
      border-radius: 6px;
      background: #16213e;
      color: #eee;
      outline: none;
    }
    input[type="url"]:focus { border-color: #00d9ff; }
    input[type="url"]:disabled { opacity: 0.5; cursor: not-allowed; }
    button {
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      border: none;
      border-radius: 6px;
      background: #00d9ff;
      color: #1a1a2e;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover:not(:disabled) { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .progress {
      display: none;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: #16213e;
      border-radius: 6px;
      margin-bottom: 1rem;
    }
    .progress.active { display: flex; }
    .spinner {
      width: 20px;
      height: 20px;
      border: 3px solid #333;
      border-top-color: #00d9ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .result {
      padding: 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      display: none;
    }
    .result.success { display: block; background: #0a3d2a; border: 1px solid #0f6; }
    .result.error { display: block; background: #3d0a0a; border: 1px solid #f44; }
    .result pre {
      margin: 0.5rem 0 0;
      padding: 0.75rem;
      background: rgba(0,0,0,0.3);
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85rem;
    }
    .result-key { color: #0f6; font-family: monospace; }
  </style>
</head>
<body>
  <h1>Web Scraper</h1>
  <form id="scrapeForm">
    <div class="input-group">
      <input type="url" id="urlInput" placeholder="https://example.com" required>
      <button type="submit" id="submitBtn">Scrape</button>
    </div>
  </form>
  <div class="progress" id="progress">
    <div class="spinner"></div>
    <span>Scraping content...</span>
  </div>
  <div class="result" id="result"></div>
  <script>
    const form = document.getElementById('scrapeForm');
    const urlInput = document.getElementById('urlInput');
    const submitBtn = document.getElementById('submitBtn');
    const progress = document.getElementById('progress');
    const result = document.getElementById('result');

    let isLoading = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isLoading) return;

      const url = urlInput.value.trim();
      if (!url) return;

      isLoading = true;
      urlInput.disabled = true;
      submitBtn.disabled = true;
      progress.classList.add('active');
      result.className = 'result';

      try {
        const res = await fetch(window.location.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, formats: ['markdown'] })
        });
        const data = await res.json();

        if (data.success) {
          result.className = 'result success';
          result.innerHTML = '<strong>Scraped successfully!</strong><br>' +
            'Stored at: <span class="result-key">' + data.key + '</span>' +
            '<pre>' + JSON.stringify(data.data?.metadata || {}, null, 2) + '</pre>';
        } else {
          throw new Error(data.error || 'Unknown error');
        }
      } catch (err) {
        result.className = 'result error';
        result.innerHTML = '<strong>Error:</strong> ' + err.message;
      } finally {
        isLoading = false;
        urlInput.disabled = false;
        submitBtn.disabled = false;
        progress.classList.remove('active');
      }
    });
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    if (request.method === 'GET') {
      return new Response(HTML_PAGE, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json() as ScrapeRequest;

      if (!body.url) {
        return jsonResponse({ error: 'Missing required field: url' }, 400);
      }

      if (!isValidUrl(body.url)) {
        return jsonResponse({ error: 'Invalid URL format' }, 400);
      }

      const firecrawlResult = await scrapeWithFirecrawl(body, env.FIRECRAWL_API_KEY);

      const storedResult: StoredResult = {
        url: body.url,
        scrapedAt: new Date().toISOString(),
        firecrawlResponse: firecrawlResult,
      };

      const title = firecrawlResult.data?.metadata?.title || new Date().toISOString();
      const key = generateKey(title);
      await env.SCRAPED_CONTENT.put(key, JSON.stringify(storedResult), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { sourceUrl: body.url },
      });

      return jsonResponse({
        success: true,
        key,
        storedAt: storedResult.scrapedAt,
        data: firecrawlResult.data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  },
};

async function scrapeWithFirecrawl(
  request: ScrapeRequest,
  apiKey: string
): Promise<FirecrawlResponse> {
  const response = await fetch(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: request.url,
      formats: request.formats || ['markdown'],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

function generateKey(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
  return `bookmark/${sanitized}.json`;
}

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function handleCors(): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
