import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env, ReadingProgress, Annotation, AnnotationList, StoredBookmark, BookmarkEntry, BookmarkManifest } from './types';

const MANIFEST_KEY = 'bookmark/manifest.json';
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/scrape';

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    screenshot?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
      [key: string]: unknown;
    };
  };
  error?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    // Verify Cloudflare Access JWT
    const authError = await verifyAccess(request, env);
    if (authError) {
      return authError;
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // API Routes
    if (path.startsWith('/api/')) {
      return handleApiRoute(request, env, path);
    }

    // Reading page
    if (path.startsWith('/read/')) {
      const key = decodeURIComponent(path.replace('/read/', ''));
      return new Response(getReadingPageHtml(key), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Main page - bookmark list
    if (request.method === 'GET' && (path === '/' || path === '')) {
      return new Response(getListPageHtml(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

async function handleApiRoute(request: Request, env: Env, path: string): Promise<Response> {
  // GET /api/bookmarks - fetch manifest and enrich with progress
  if (path === '/api/bookmarks' && request.method === 'GET') {
    try {
      const manifest = await getManifest(env);
      if (!manifest) {
        return jsonResponse({ error: 'Manifest not found' }, 404);
      }

      // Enrich with progress data
      const enrichedBookmarks = await Promise.all(
        manifest.bookmarks.map(async (bookmark: BookmarkEntry) => {
          const progress = await env.NIKK_BOOKMARK_PROGRESS.get(bookmark.key);
          return {
            ...bookmark,
            progress: progress ? JSON.parse(progress) as ReadingProgress : null,
          };
        })
      );

      return jsonResponse({ bookmarks: enrichedBookmarks });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // GET /api/bookmark/:key - fetch specific bookmark content
  if (path.startsWith('/api/bookmark/') && request.method === 'GET') {
    const key = decodeURIComponent(path.replace('/api/bookmark/', ''));
    try {
      const object = await env.BOOKMARK_BUCKET.get(`bookmark/${key}.json`);
      if (!object) {
        return jsonResponse({ error: 'Bookmark not found' }, 404);
      }
      const bookmark = await object.json() as StoredBookmark;
      return jsonResponse(bookmark);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/scrape - scrape URL and add to bookmarks
  if (path === '/api/scrape' && request.method === 'POST') {
    try {
      const body = await request.json() as { url: string };
      if (!body.url) {
        return jsonResponse({ error: 'Missing required field: url' }, 400);
      }
      if (!isValidUrl(body.url)) {
        return jsonResponse({ error: 'Invalid URL format' }, 400);
      }

      // Scrape the URL
      const firecrawlResult = await scrapeWithFirecrawl(body.url, env.FIRECRAWL_API_KEY);
      if (!firecrawlResult.success) {
        return jsonResponse({ error: firecrawlResult.error || 'Scraping failed' }, 500);
      }

      // Generate key from title
      const title = firecrawlResult.data?.metadata?.title || new Date().toISOString();
      const key = generateKey(title);

      // Store scraped content in R2
      const storedBookmark: StoredBookmark = {
        url: body.url,
        scrapedAt: new Date().toISOString(),
        firecrawlResponse: firecrawlResult,
      };
      await env.BOOKMARK_BUCKET.put(`bookmark/${key}.json`, JSON.stringify(storedBookmark), {
        httpMetadata: { contentType: 'application/json' },
      });

      // Update manifest
      const manifest = await getManifest(env) || { bookmarks: [], updatedAt: new Date().toISOString() };
      const nextId = manifest.bookmarks.length > 0
        ? Math.max(...manifest.bookmarks.map(b => b.id)) + 1
        : 1;

      const newEntry: BookmarkEntry = {
        id: nextId,
        key,
        title,
        description: firecrawlResult.data?.metadata?.description,
        url: body.url,
      };

      manifest.bookmarks.unshift(newEntry); // Add to beginning
      manifest.updatedAt = new Date().toISOString();

      await env.BOOKMARK_BUCKET.put(MANIFEST_KEY, JSON.stringify(manifest), {
        httpMetadata: { contentType: 'application/json' },
      });

      return jsonResponse({
        success: true,
        key,
        title,
        bookmark: newEntry,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // GET /api/progress/:key - get progress for a bookmark
  if (path.startsWith('/api/progress/') && request.method === 'GET') {
    const key = decodeURIComponent(path.replace('/api/progress/', ''));
    try {
      const progress = await env.NIKK_BOOKMARK_PROGRESS.get(key);
      return jsonResponse({ progress: progress ? JSON.parse(progress) : null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/progress/:key/toggle-read - toggle read status
  if (path.match(/^\/api\/progress\/[^/]+\/toggle-read$/) && request.method === 'POST') {
    const key = decodeURIComponent(path.replace('/api/progress/', '').replace('/toggle-read', ''));
    try {
      const existing = await env.NIKK_BOOKMARK_PROGRESS.get(key);
      const currentProgress: ReadingProgress = existing
        ? JSON.parse(existing)
        : { bookmarkKey: key, scrollPosition: 0, scrollPercentage: 0, lastReadAt: new Date().toISOString(), isRead: false, isFavourite: false };

      const progress: ReadingProgress = {
        ...currentProgress,
        isRead: !currentProgress.isRead,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(key, JSON.stringify(progress));
      return jsonResponse({ success: true, progress });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/progress/:key/toggle-favourite - toggle favourite status
  if (path.match(/^\/api\/progress\/[^/]+\/toggle-favourite$/) && request.method === 'POST') {
    const key = decodeURIComponent(path.replace('/api/progress/', '').replace('/toggle-favourite', ''));
    try {
      const existing = await env.NIKK_BOOKMARK_PROGRESS.get(key);
      const currentProgress: ReadingProgress = existing
        ? JSON.parse(existing)
        : { bookmarkKey: key, scrollPosition: 0, scrollPercentage: 0, lastReadAt: new Date().toISOString(), isRead: false, isFavourite: false };

      const progress: ReadingProgress = {
        ...currentProgress,
        isFavourite: !currentProgress.isFavourite,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(key, JSON.stringify(progress));
      return jsonResponse({ success: true, progress });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/progress/:key - save progress for a bookmark
  if (path.startsWith('/api/progress/') && !path.includes('/toggle-') && request.method === 'POST') {
    const key = decodeURIComponent(path.replace('/api/progress/', ''));
    try {
      const body = await request.json() as { scrollPosition: number; scrollPercentage: number };

      // Preserve existing isRead and isFavourite status
      const existing = await env.NIKK_BOOKMARK_PROGRESS.get(key);
      const existingProgress = existing ? JSON.parse(existing) as ReadingProgress : null;

      const progress: ReadingProgress = {
        bookmarkKey: key,
        scrollPosition: body.scrollPosition,
        scrollPercentage: body.scrollPercentage,
        lastReadAt: new Date().toISOString(),
        isRead: existingProgress?.isRead ?? false,
        isFavourite: existingProgress?.isFavourite ?? false,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(key, JSON.stringify(progress));
      return jsonResponse({ success: true, progress });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // GET /api/annotations/:key - get annotations for a bookmark
  if (path.startsWith('/api/annotations/') && request.method === 'GET') {
    const key = decodeURIComponent(path.replace('/api/annotations/', ''));
    try {
      const annotations = await env.NIKK_BOOKMARK_ANNOTATION.get(key);
      return jsonResponse({
        annotations: annotations ? (JSON.parse(annotations) as AnnotationList).annotations : []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/annotations/:key - add annotation for a bookmark
  if (path.startsWith('/api/annotations/') && request.method === 'POST') {
    const key = decodeURIComponent(path.replace('/api/annotations/', ''));
    try {
      const body = await request.json() as { selectedText: string; note: string; startOffset: number; endOffset: number };

      // Get existing annotations
      const existing = await env.NIKK_BOOKMARK_ANNOTATION.get(key);
      const annotationList: AnnotationList = existing
        ? JSON.parse(existing)
        : { annotations: [] };

      const newAnnotation: Annotation = {
        id: crypto.randomUUID(),
        bookmarkKey: key,
        selectedText: body.selectedText,
        note: body.note,
        startOffset: body.startOffset,
        endOffset: body.endOffset,
        createdAt: new Date().toISOString(),
      };

      annotationList.annotations.push(newAnnotation);
      await env.NIKK_BOOKMARK_ANNOTATION.put(key, JSON.stringify(annotationList));

      return jsonResponse({ success: true, annotation: newAnnotation });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // DELETE /api/annotations/:key/:id - delete an annotation
  if (path.match(/^\/api\/annotations\/[^/]+\/[^/]+$/) && request.method === 'DELETE') {
    const parts = path.replace('/api/annotations/', '').split('/');
    const key = decodeURIComponent(parts[0]);
    const annotationId = parts[1];
    try {
      const existing = await env.NIKK_BOOKMARK_ANNOTATION.get(key);
      if (!existing) {
        return jsonResponse({ error: 'Annotation not found' }, 404);
      }

      const annotationList: AnnotationList = JSON.parse(existing);
      annotationList.annotations = annotationList.annotations.filter(a => a.id !== annotationId);
      await env.NIKK_BOOKMARK_ANNOTATION.put(key, JSON.stringify(annotationList));

      return jsonResponse({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: 'API endpoint not found' }, 404);
}

async function verifyAccess(request: Request, env: Env): Promise<Response | null> {
  // Skip auth for testing
  if (env.SKIP_AUTH === 'true') {
    return null;
  }

  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
    return new Response('Missing Cloudflare Access configuration', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return new Response('Missing CF Access JWT', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );
    await jwtVerify(token, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(`Invalid token: ${message}`, {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
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
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function getManifest(env: Env): Promise<BookmarkManifest | null> {
  const object = await env.BOOKMARK_BUCKET.get(MANIFEST_KEY);
  if (!object) {
    return null;
  }
  return object.json() as Promise<BookmarkManifest>;
}

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<FirecrawlResponse> {
  const response = await fetch(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

function generateKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getListPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bookmark Reader</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fabd2f'><path d='M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'/></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap&subset=vietnamese" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      background: #282828;
      color: #ebdbb2;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #fabd2f; margin-bottom: 2rem; font-size: 2rem; }
    .loading {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 2rem;
      justify-content: center;
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #504945;
      border-top-color: #fabd2f;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .bookmark-list { display: flex; flex-direction: column; gap: 1rem; }
    .bookmark-card {
      background: #3c3836;
      border-radius: 8px;
      padding: 1.25rem;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      border: 1px solid #504945;
    }
    .bookmark-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(250,189,47,0.2);
      border-color: #fabd2f;
    }
    .bookmark-title {
      color: #fabd2f;
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .bookmark-description {
      color: #d5c4a1;
      font-size: 0.9rem;
      margin-bottom: 0.75rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .bookmark-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      color: #928374;
    }
    .progress-bar {
      width: 100px;
      height: 6px;
      background: #504945;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #fabd2f, #b8bb26);
      border-radius: 3px;
      transition: width 0.3s;
    }
    .progress-text { color: #b8bb26; font-weight: 500; }
    .source-url {
      color: #928374;
      font-size: 0.75rem;
      margin-top: 0.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: #928374;
    }
    .error-state {
      text-align: center;
      padding: 2rem;
      color: #fb4934;
      background: #3c3836;
      border: 1px solid #fb4934;
      border-radius: 8px;
    }
    .add-btn {
      position: fixed;
      right: 1.5rem;
      bottom: 1.5rem;
      width: 56px;
      height: 56px;
      background: #fabd2f;
      color: #282828;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: transform 0.2s, opacity 0.2s;
      z-index: 100;
    }
    .add-btn:hover { transform: scale(1.1); }
    .add-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 200;
      padding: 1rem;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #3c3836;
      border-radius: 12px;
      padding: 1.5rem;
      width: 100%;
      max-width: 500px;
      border: 1px solid #504945;
    }
    .modal h2 {
      color: #fabd2f;
      margin-bottom: 1rem;
      font-size: 1.25rem;
    }
    .modal input[type="url"] {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      border: 2px solid #504945;
      border-radius: 6px;
      background: #282828;
      color: #ebdbb2;
      font-family: inherit;
      margin-bottom: 1rem;
    }
    .modal input[type="url"]:focus { outline: none; border-color: #fabd2f; }
    .modal input[type="url"]:disabled { opacity: 0.5; }
    .modal-buttons {
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
    }
    .modal-btn {
      padding: 0.6rem 1.25rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.95rem;
      font-family: inherit;
      transition: opacity 0.2s;
    }
    .modal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .modal-btn.primary { background: #fabd2f; color: #282828; font-weight: 600; }
    .modal-btn.secondary { background: #504945; color: #ebdbb2; }
    .modal-status {
      margin-bottom: 1rem;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.9rem;
      display: none;
    }
    .modal-status.loading { display: flex; align-items: center; gap: 0.5rem; background: #504945; }
    .modal-status.success { display: block; background: #3d5a3d; color: #b8bb26; }
    .modal-status.error { display: block; background: #5a3d3d; color: #fb4934; }
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .tab-btn {
      padding: 0.6rem 1.25rem;
      border: 2px solid #504945;
      border-radius: 6px;
      background: transparent;
      color: #928374;
      font-family: inherit;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover { border-color: #fabd2f; color: #ebdbb2; }
    .tab-btn.active {
      background: #fabd2f;
      border-color: #fabd2f;
      color: #282828;
      font-weight: 600;
    }
    .tab-count {
      margin-left: 0.25rem;
      opacity: 0.8;
    }
    .bookmark-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }
    .toggle-read-btn {
      background: none;
      border: 2px solid #504945;
      border-radius: 4px;
      width: 24px;
      height: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s;
      color: #928374;
    }
    .toggle-read-btn:hover { border-color: #b8bb26; color: #b8bb26; }
    .toggle-read-btn.read {
      background: #b8bb26;
      border-color: #b8bb26;
      color: #282828;
    }
    .toggle-fav-btn {
      background: none;
      border: none;
      width: 24px;
      height: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 1.1rem;
      color: #504945;
      transition: all 0.2s;
    }
    .toggle-fav-btn:hover { color: #fabd2f; }
    .toggle-fav-btn.favourite { color: #fabd2f; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bookmark Reader</h1>
    <div class="tabs" id="tabs" style="display:none;">
      <button class="tab-btn active" data-tab="unread" id="tabUnread">Unread<span class="tab-count" id="countUnread">(0)</span></button>
      <button class="tab-btn" data-tab="read" id="tabRead">Read<span class="tab-count" id="countRead">(0)</span></button>
      <button class="tab-btn" data-tab="favourites" id="tabFavourites">★<span class="tab-count" id="countFavourites">(0)</span></button>
    </div>
    <div id="content">
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading bookmarks...</span>
      </div>
    </div>
  </div>

  <button class="add-btn" id="addBtn" title="Add bookmark">+</button>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <h2>Add Bookmark</h2>
      <div class="modal-status" id="modalStatus">
        <div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>
        <span id="statusText">Scraping...</span>
      </div>
      <input type="url" id="urlInput" placeholder="https://example.com/article" required>
      <div class="modal-buttons">
        <button class="modal-btn secondary" id="cancelBtn">Cancel</button>
        <button class="modal-btn primary" id="scrapeBtn">Scrape</button>
      </div>
    </div>
  </div>

  <script>
    let allBookmarks = [];
    let currentTab = 'unread';

    async function loadBookmarks() {
      const content = document.getElementById('content');
      const tabs = document.getElementById('tabs');
      try {
        const res = await fetch('/api/bookmarks');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (!data.bookmarks || data.bookmarks.length === 0) {
          tabs.style.display = 'none';
          content.innerHTML = '<div class="empty-state">No bookmarks found.</div>';
          return;
        }

        allBookmarks = data.bookmarks;
        tabs.style.display = 'flex';
        updateCounts();
        renderBookmarks();
      } catch (error) {
        content.innerHTML = '<div class="error-state">Error: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function updateCounts() {
      const unread = allBookmarks.filter(b => !b.progress?.isRead).length;
      const read = allBookmarks.filter(b => b.progress?.isRead).length;
      const favourites = allBookmarks.filter(b => b.progress?.isFavourite).length;
      document.getElementById('countUnread').textContent = '(' + unread + ')';
      document.getElementById('countRead').textContent = '(' + read + ')';
      document.getElementById('countFavourites').textContent = '(' + favourites + ')';
    }

    function renderBookmarks() {
      const content = document.getElementById('content');
      let filtered;
      let emptyMessage;

      if (currentTab === 'favourites') {
        filtered = allBookmarks.filter(b => b.progress?.isFavourite);
        emptyMessage = 'No favourite bookmarks.';
      } else if (currentTab === 'read') {
        filtered = allBookmarks.filter(b => b.progress?.isRead);
        emptyMessage = 'No read bookmarks.';
      } else {
        filtered = allBookmarks.filter(b => !b.progress?.isRead);
        emptyMessage = 'No unread bookmarks.';
      }

      if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-state">' + emptyMessage + '</div>';
        return;
      }

      const html = filtered.map(bookmark => {
        const progress = bookmark.progress?.scrollPercentage || 0;
        const lastRead = bookmark.progress?.lastReadAt
          ? new Date(bookmark.progress.lastReadAt).toLocaleDateString()
          : 'Not started';
        const isRead = bookmark.progress?.isRead || false;
        const isFavourite = bookmark.progress?.isFavourite || false;

        return \`
          <div class="bookmark-card">
            <div class="bookmark-header">
              <div class="bookmark-title" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'" style="cursor:pointer;flex:1;">\${escapeHtml(bookmark.title)}</div>
              <button class="toggle-fav-btn \${isFavourite ? 'favourite' : ''}" onclick="event.stopPropagation(); toggleFavourite('\${bookmark.key}')" title="\${isFavourite ? 'Remove from favourites' : 'Add to favourites'}">★</button>
              <button class="toggle-read-btn \${isRead ? 'read' : ''}" onclick="event.stopPropagation(); toggleRead('\${bookmark.key}')" title="\${isRead ? 'Mark as unread' : 'Mark as read'}">
                \${isRead ? '✓' : ''}
              </button>
            </div>
            \${bookmark.description ? \`<div class="bookmark-description" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'" style="cursor:pointer;">\${escapeHtml(bookmark.description)}</div>\` : ''}
            <div class="bookmark-meta" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'" style="cursor:pointer;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="progress-bar">
                  <div class="progress-fill" style="width: \${progress}%"></div>
                </div>
                <span class="progress-text">\${Math.round(progress)}%</span>
              </div>
              <span>Last read: \${lastRead}</span>
            </div>
            <div class="source-url" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'" style="cursor:pointer;">\${escapeHtml(bookmark.url)}</div>
          </div>
        \`;
      }).join('');

      content.innerHTML = '<div class="bookmark-list">' + html + '</div>';
    }

    async function toggleRead(key) {
      try {
        await fetch('/api/progress/' + encodeURIComponent(key) + '/toggle-read', { method: 'POST' });
        const bookmark = allBookmarks.find(b => b.key === key);
        if (bookmark) {
          if (!bookmark.progress) {
            bookmark.progress = { bookmarkKey: key, scrollPosition: 0, scrollPercentage: 0, lastReadAt: new Date().toISOString(), isRead: true, isFavourite: false };
          } else {
            bookmark.progress.isRead = !bookmark.progress.isRead;
          }
        }
        updateCounts();
        renderBookmarks();
      } catch (error) {
        console.error('Failed to toggle read status:', error);
      }
    }

    async function toggleFavourite(key) {
      try {
        await fetch('/api/progress/' + encodeURIComponent(key) + '/toggle-favourite', { method: 'POST' });
        const bookmark = allBookmarks.find(b => b.key === key);
        if (bookmark) {
          if (!bookmark.progress) {
            bookmark.progress = { bookmarkKey: key, scrollPosition: 0, scrollPercentage: 0, lastReadAt: new Date().toISOString(), isRead: false, isFavourite: true };
          } else {
            bookmark.progress.isFavourite = !bookmark.progress.isFavourite;
          }
        }
        updateCounts();
        renderBookmarks();
      } catch (error) {
        console.error('Failed to toggle favourite status:', error);
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      renderBookmarks();
    }

    document.getElementById('tabUnread').addEventListener('click', () => switchTab('unread'));
    document.getElementById('tabRead').addEventListener('click', () => switchTab('read'));
    document.getElementById('tabFavourites').addEventListener('click', () => switchTab('favourites'));

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Modal functionality
    const addBtn = document.getElementById('addBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const urlInput = document.getElementById('urlInput');
    const cancelBtn = document.getElementById('cancelBtn');
    const scrapeBtn = document.getElementById('scrapeBtn');
    const modalStatus = document.getElementById('modalStatus');
    const statusText = document.getElementById('statusText');

    function openModal() {
      modalOverlay.classList.add('open');
      urlInput.value = '';
      resetStatus();
      urlInput.focus();
    }

    function closeModal() {
      modalOverlay.classList.remove('open');
      resetStatus();
    }

    function resetStatus() {
      modalStatus.className = 'modal-status';
      urlInput.disabled = false;
      scrapeBtn.disabled = false;
      cancelBtn.disabled = false;
    }

    function setStatus(type, message) {
      modalStatus.className = 'modal-status ' + type;
      statusText.textContent = message;
    }

    async function scrapeUrl() {
      const url = urlInput.value.trim();
      if (!url) return;

      urlInput.disabled = true;
      scrapeBtn.disabled = true;
      cancelBtn.disabled = true;
      setStatus('loading', 'Scraping content...');

      try {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
          setStatus('success', 'Added: ' + data.title);
          setTimeout(() => {
            closeModal();
            loadBookmarks();
          }, 1500);
        } else {
          throw new Error(data.error || 'Scraping failed');
        }
      } catch (error) {
        setStatus('error', 'Error: ' + error.message);
        urlInput.disabled = false;
        scrapeBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    }

    addBtn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    scrapeBtn.addEventListener('click', scrapeUrl);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') scrapeUrl();
    });

    loadBookmarks();

    // Refresh when navigating back (bfcache restoration)
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        loadBookmarks();
      }
    });
  </script>
</body>
</html>`;
}

function getReadingPageHtml(key: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reading - Bookmark Reader</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fabd2f'><path d='M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'/></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap&subset=vietnamese" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      overflow-x: hidden;
      max-width: 100vw;
    }
    body {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      background: #282828;
      color: #ebdbb2;
      min-height: 100vh;
      line-height: 1.7;
    }
    .header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #3c3836;
      border-bottom: 1px solid #504945;
      padding: 0.75rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
    }
    .back-btn {
      color: #83a598;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 500;
    }
    .back-btn:hover { opacity: 0.8; }
    .reading-progress {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.9rem;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .header-btn {
      background: none;
      border: 2px solid #504945;
      border-radius: 6px;
      width: 36px;
      height: 36px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      color: #928374;
      font-size: 1.1rem;
    }
    .header-btn:hover { border-color: #fabd2f; color: #ebdbb2; }
    .header-btn.active {
      background: #fabd2f;
      border-color: #fabd2f;
      color: #282828;
    }
    .header-btn.fav-btn.active {
      background: transparent;
      border-color: #fabd2f;
      color: #fabd2f;
    }
    .progress-bar-header {
      width: 120px;
      height: 6px;
      background: #504945;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill-header {
      height: 100%;
      background: linear-gradient(90deg, #fabd2f, #b8bb26);
      border-radius: 3px;
      /* no transition for smooth scroll tracking */
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 5rem 2rem 4rem;
    }
    .loading, .error-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 4rem 2rem;
      text-align: center;
    }
    .error-state { color: #fb4934; }
    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #504945;
      border-top-color: #fabd2f;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Markdown content styles */
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      color: #fabd2f;
      margin: 1.5em 0 0.75em;
      line-height: 1.3;
    }
    .content h1 { font-size: 2rem; margin-top: 0; }
    .content h2 { font-size: 1.5rem; }
    .content h3 { font-size: 1.25rem; }
    .content p { margin: 1em 0; }
    .content a { color: #83a598; }
    .content a:hover { text-decoration: none; }
    .content ul, .content ol { margin: 1em 0; padding-left: 2em; }
    .content li { margin: 0.5em 0; }
    .content blockquote {
      border-left: 4px solid #fabd2f;
      margin: 1em 0;
      padding: 0.5em 1em;
      background: #3c3836;
      border-radius: 0 4px 4px 0;
    }
    .content pre {
      background: #3c3836;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      margin: 1em 0;
    }
    .content code {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      font-size: 0.9em;
    }
    .content :not(pre) > code {
      background: #3c3836;
      padding: 0.2em 0.4em;
      border-radius: 4px;
    }
    .content img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      margin: 1em 0;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
    }
    .content th, .content td {
      border: 1px solid #504945;
      padding: 0.75em;
      text-align: left;
    }
    .content th { background: #3c3836; color: #fabd2f; }
    .content hr {
      border: none;
      border-top: 1px solid #504945;
      margin: 2em 0;
    }

    /* Annotation styles */
    .annotation-highlight {
      background: rgba(255, 230, 0, 0.3);
      cursor: pointer;
      border-radius: 2px;
    }
    .annotation-highlight:hover {
      background: rgba(255, 230, 0, 0.5);
    }

    /* Annotation panel */
    .annotation-panel {
      position: fixed;
      right: 0;
      top: 60px;
      bottom: 0;
      width: 320px;
      background: #3c3836;
      border-left: 1px solid #504945;
      padding: 1rem;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s;
      z-index: 99;
    }
    .annotation-panel.open { transform: translateX(0); }
    .annotation-panel h3 {
      color: #fabd2f;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .annotation-toggle {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      width: 48px;
      height: 48px;
      background: #fabd2f;
      color: #282828;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.5rem;
      z-index: 101;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .annotation-toggle:hover { opacity: 0.9; }
    .annotation-item {
      background: #282828;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      border: 1px solid #504945;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .annotation-item:hover {
      border-color: #fabd2f;
    }
    .annotation-text {
      font-style: italic;
      color: #fe8019;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
      padding: 0.5rem;
      background: rgba(254,128,25,0.1);
      border-radius: 4px;
    }
    .annotation-note {
      font-size: 0.9rem;
      color: #d5c4a1;
    }
    .annotation-meta {
      font-size: 0.75rem;
      color: #928374;
      margin-top: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .annotation-delete {
      color: #fb4934;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .annotation-delete:hover { text-decoration: underline; }
    .no-annotations {
      color: #928374;
      text-align: center;
      padding: 2rem;
    }

    /* Selection popup */
    .selection-popup {
      position: absolute;
      background: #3c3836;
      border: 1px solid #fabd2f;
      border-radius: 6px;
      padding: 0.75rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 200;
      display: none;
      width: 280px;
    }
    .selection-popup.visible { display: block; }
    .selection-popup textarea {
      width: 100%;
      background: #282828;
      border: 1px solid #504945;
      border-radius: 4px;
      color: #ebdbb2;
      padding: 0.5rem;
      font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
      font-size: 0.9rem;
      resize: vertical;
      min-height: 60px;
      margin-bottom: 0.5rem;
    }
    .selection-popup textarea:focus {
      outline: none;
      border-color: #fabd2f;
    }
    .selection-popup-buttons {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }
    .selection-popup button {
      padding: 0.4rem 0.75rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .selection-popup .save-btn {
      background: #fabd2f;
      color: #282828;
      font-weight: 500;
    }
    .selection-popup .cancel-btn {
      background: #504945;
      color: #ebdbb2;
    }
  </style>
</head>
<body>
  <header class="header">
    <a href="/" class="back-btn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Back to list
    </a>
    <div class="reading-progress">
      <div class="progress-bar-header">
        <div class="progress-fill-header" id="progressFill" style="width: 0%"></div>
      </div>
      <span id="progressText">0%</span>
    </div>
    <div class="header-actions">
      <button class="header-btn fav-btn" id="favBtn" title="Add to favourites">★</button>
      <button class="header-btn read-btn" id="readBtn" title="Mark as read">✓</button>
    </div>
  </header>

  <div class="container">
    <div id="content">
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading content...</span>
      </div>
    </div>
  </div>

  <button class="annotation-toggle" id="annotationToggle" title="Annotations">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  </button>

  <div class="annotation-panel" id="annotationPanel">
    <h3>
      Annotations
      <button onclick="togglePanel()" style="background:none;border:none;color:#eee;cursor:pointer;font-size:1.2rem;">&times;</button>
    </h3>
    <div id="annotationList">
      <div class="no-annotations">No annotations yet</div>
    </div>
  </div>

  <div class="selection-popup" id="selectionPopup">
    <div style="font-size:0.8rem;color:#666;margin-bottom:0.5rem;">Add annotation:</div>
    <textarea id="annotationInput" placeholder="Write your note..."></textarea>
    <div class="selection-popup-buttons">
      <button class="cancel-btn" onclick="hideSelectionPopup()">Cancel</button>
      <button class="save-btn" onclick="saveAnnotation()">Save</button>
    </div>
  </div>

  <script>
    const bookmarkKey = ${JSON.stringify(key)};
    let annotations = [];
    let selectedText = '';
    let selectionRange = null;
    let scrollTimeout = null;
    let lastSavedPosition = 0;
    let isRead = false;
    let isFavourite = false;

    async function loadContent() {
      const content = document.getElementById('content');
      try {
        const [bookmarkRes, annotationsRes, progressRes] = await Promise.all([
          fetch('/api/bookmark/' + encodeURIComponent(bookmarkKey)),
          fetch('/api/annotations/' + encodeURIComponent(bookmarkKey)),
          fetch('/api/progress/' + encodeURIComponent(bookmarkKey))
        ]);

        const bookmark = await bookmarkRes.json();
        const annotationsData = await annotationsRes.json();
        const progressData = await progressRes.json();

        if (bookmark.error) throw new Error(bookmark.error);

        annotations = annotationsData.annotations || [];

        const markdown = bookmark.firecrawlResponse?.data?.markdown || 'No content available';
        const title = bookmark.firecrawlResponse?.data?.metadata?.title || 'Untitled';

        document.title = title + ' - Bookmark Reader';

        // Simple markdown to HTML conversion
        let html = markdownToHtml(markdown);

        content.innerHTML = '<div class="content" id="markdownContent">' + html + '</div>';

        renderAnnotations();
        highlightAnnotationsInContent();

        // Load read/favourite state
        isRead = progressData.progress?.isRead || false;
        isFavourite = progressData.progress?.isFavourite || false;
        updateActionButtons();

        // Restore scroll position
        if (progressData.progress?.scrollPosition) {
          setTimeout(() => {
            window.scrollTo(0, progressData.progress.scrollPosition);
            updateProgressDisplay(progressData.progress.scrollPercentage);
          }, 100);
        }

        // Setup scroll tracking
        setupScrollTracking();

        // Setup text selection
        setupTextSelection();
      } catch (error) {
        content.innerHTML = '<div class="error-state">Error: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function markdownToHtml(md) {
      let html = md
        // Code blocks
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        // Inline code
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        // Headers
        .replace(/^###### (.*$)/gm, '<h6>$1</h6>')
        .replace(/^##### (.*$)/gm, '<h5>$1</h5>')
        .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\\*\\*\\*([^*]+)\\*\\*\\*/g, '<strong><em>$1</em></strong>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
        // Links
        .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        // Images
        .replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img src="$2" alt="$1">')
        // Blockquotes
        .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
        // Horizontal rule
        .replace(/^---$/gm, '<hr>')
        // Line breaks - convert double newlines to paragraphs
        .replace(/\\n\\n/g, '</p><p>')
        // Single line breaks
        .replace(/\\n/g, '<br>');

      return '<p>' + html + '</p>';
    }

    function setupScrollTracking() {
      window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const percentage = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

        updateProgressDisplay(percentage);

        // Debounce save (300ms)
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          if (Math.abs(scrollTop - lastSavedPosition) > 50) {
            saveProgress(scrollTop, percentage);
            lastSavedPosition = scrollTop;
          }
        }, 300);
      }, { passive: true });
    }

    function updateProgressDisplay(percentage) {
      document.getElementById('progressFill').style.width = percentage + '%';
      document.getElementById('progressText').textContent = Math.round(percentage) + '%';
    }

    async function saveProgress(scrollPosition, scrollPercentage) {
      try {
        await fetch('/api/progress/' + encodeURIComponent(bookmarkKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scrollPosition, scrollPercentage })
        });
      } catch (e) {
        console.error('Failed to save progress:', e);
      }
    }

    function setupTextSelection() {
      const content = document.getElementById('markdownContent');
      if (!content) return;

      // Desktop: mouseup
      content.addEventListener('mouseup', handleTextSelection);

      // Mobile: touchend with delay to let selection complete
      content.addEventListener('touchend', (e) => {
        setTimeout(() => handleTextSelection(e), 100);
      });

      // Hide popup when clicking/touching outside
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }

    function handleTextSelection(e) {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 0) {
        selectedText = text;
        try {
          selectionRange = selection.getRangeAt(0).cloneRange();
        } catch (err) {
          return;
        }

        // Get position for popup
        let x, y;
        if (e.type === 'touchend' && e.changedTouches?.length > 0) {
          x = e.changedTouches[0].clientX;
          y = e.changedTouches[0].clientY;
        } else if (e.clientX !== undefined) {
          x = e.clientX;
          y = e.clientY;
        } else {
          // Fallback: use selection rect
          const rect = selectionRange.getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.bottom;
        }

        showSelectionPopup(x, y);
      }
    }

    function handleOutsideClick(e) {
      const popup = document.getElementById('selectionPopup');
      if (!popup.contains(e.target) && popup.classList.contains('visible')) {
        hideSelectionPopup();
      }
    }

    function showSelectionPopup(x, y) {
      const popup = document.getElementById('selectionPopup');
      const popupWidth = 280;

      // Position popup, ensuring it stays within viewport
      let left = Math.max(10, Math.min(x - popupWidth / 2, window.innerWidth - popupWidth - 10));
      let top = y + window.scrollY + 10;

      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
      popup.classList.add('visible');

      // Don't auto-focus on mobile to prevent keyboard from immediately appearing
      if (window.innerWidth > 768) {
        document.getElementById('annotationInput').focus();
      }
    }

    function hideSelectionPopup() {
      document.getElementById('selectionPopup').classList.remove('visible');
      document.getElementById('annotationInput').value = '';
      selectedText = '';
      selectionRange = null;
    }

    async function saveAnnotation() {
      const note = document.getElementById('annotationInput').value.trim();
      if (!selectedText || !selectionRange) return;

      // Store range before async operation
      const rangeToHighlight = selectionRange.cloneRange();

      try {
        const res = await fetch('/api/annotations/' + encodeURIComponent(bookmarkKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText,
            note,
            startOffset: 0,
            endOffset: selectedText.length
          })
        });

        const data = await res.json();
        if (data.annotation) {
          annotations.push(data.annotation);
          renderAnnotations();

          // Highlight the selected text with proper ID and click handler
          try {
            const highlight = document.createElement('mark');
            highlight.className = 'annotation-highlight';
            highlight.setAttribute('data-annotation-id', data.annotation.id);
            highlight.onclick = () => scrollToAnnotationInPanel(data.annotation.id);
            rangeToHighlight.surroundContents(highlight);
          } catch (e) {
            console.warn('Could not highlight selection:', e);
          }
        }
        hideSelectionPopup();
      } catch (e) {
        console.error('Failed to save annotation:', e);
      }
    }

    async function deleteAnnotation(id) {
      if (!confirm('Delete this annotation?')) return;

      try {
        await fetch('/api/annotations/' + encodeURIComponent(bookmarkKey) + '/' + id, {
          method: 'DELETE'
        });
        annotations = annotations.filter(a => a.id !== id);
        renderAnnotations();
      } catch (e) {
        console.error('Failed to delete annotation:', e);
      }
    }

    function renderAnnotations() {
      const list = document.getElementById('annotationList');

      if (annotations.length === 0) {
        list.innerHTML = '<div class="no-annotations">No annotations yet</div>';
        return;
      }

      list.innerHTML = annotations.map(a => \`
        <div class="annotation-item" data-annotation-id="\${a.id}" onclick="scrollToHighlightedText('\${a.id}')">
          <div class="annotation-text">"\${escapeHtml(a.selectedText)}"</div>
          \${a.note ? \`<div class="annotation-note">\${escapeHtml(a.note)}</div>\` : ''}
          <div class="annotation-meta">
            <span>\${new Date(a.createdAt).toLocaleDateString()}</span>
            <button class="annotation-delete" onclick="event.stopPropagation(); deleteAnnotation('\${a.id}')">Delete</button>
          </div>
        </div>
      \`).join('');
    }

    function scrollToHighlightedText(annotationId) {
      const content = document.getElementById('markdownContent');
      if (!content) return;

      const highlight = content.querySelector(\`[data-annotation-id="\${annotationId}"]\`);
      if (highlight) {
        // Close panel on mobile for better view
        if (window.innerWidth <= 768) {
          document.getElementById('annotationPanel').classList.remove('open');
        }

        // Scroll to highlighted text
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Flash effect to draw attention
        highlight.style.outline = '2px solid #fabd2f';
        highlight.style.outlineOffset = '2px';
        setTimeout(() => {
          highlight.style.outline = '';
          highlight.style.outlineOffset = '';
        }, 2000);
      }
    }

    function highlightAnnotationsInContent() {
      const content = document.getElementById('markdownContent');
      if (!content || annotations.length === 0) return;

      annotations.forEach(annotation => {
        // Skip if already highlighted
        if (content.querySelector(\`[data-annotation-id="\${annotation.id}"]\`)) return;

        const textToFind = annotation.selectedText;
        highlightTextInNode(content, textToFind, annotation.id);
      });
    }

    function highlightTextInNode(node, text, annotationId) {
      if (node.nodeType === Node.TEXT_NODE) {
        const index = node.textContent.indexOf(text);
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + text.length);

          const highlight = document.createElement('mark');
          highlight.className = 'annotation-highlight';
          highlight.setAttribute('data-annotation-id', annotationId);
          highlight.onclick = () => scrollToAnnotationInPanel(annotationId);

          try {
            range.surroundContents(highlight);
            return true;
          } catch (e) {
            return false;
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('annotation-highlight')) {
        for (const child of Array.from(node.childNodes)) {
          if (highlightTextInNode(child, text, annotationId)) return true;
        }
      }
      return false;
    }

    function scrollToAnnotationInPanel(annotationId) {
      const panel = document.getElementById('annotationPanel');
      if (!panel.classList.contains('open')) {
        panel.classList.add('open');
      }
      const item = panel.querySelector(\`[data-annotation-id="\${annotationId}"]\`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.style.outline = '2px solid #fabd2f';
        setTimeout(() => item.style.outline = '', 2000);
      }
    }

    function togglePanel() {
      document.getElementById('annotationPanel').classList.toggle('open');
    }

    document.getElementById('annotationToggle').addEventListener('click', togglePanel);

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function updateActionButtons() {
      const readBtn = document.getElementById('readBtn');
      const favBtn = document.getElementById('favBtn');

      readBtn.classList.toggle('active', isRead);
      readBtn.title = isRead ? 'Mark as unread' : 'Mark as read';

      favBtn.classList.toggle('active', isFavourite);
      favBtn.title = isFavourite ? 'Remove from favourites' : 'Add to favourites';
    }

    async function toggleReadStatus() {
      try {
        const res = await fetch('/api/progress/' + encodeURIComponent(bookmarkKey) + '/toggle-read', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          isRead = data.progress.isRead;
          updateActionButtons();
        }
      } catch (error) {
        console.error('Failed to toggle read status:', error);
      }
    }

    async function toggleFavouriteStatus() {
      try {
        const res = await fetch('/api/progress/' + encodeURIComponent(bookmarkKey) + '/toggle-favourite', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          isFavourite = data.progress.isFavourite;
          updateActionButtons();
        }
      } catch (error) {
        console.error('Failed to toggle favourite status:', error);
      }
    }

    document.getElementById('readBtn').addEventListener('click', toggleReadStatus);
    document.getElementById('favBtn').addEventListener('click', toggleFavouriteStatus);

    loadContent();
  </script>
</body>
</html>`;
}
