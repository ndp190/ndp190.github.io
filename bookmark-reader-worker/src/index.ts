import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env, ReadingProgress, Annotation, AnnotationList, StoredBookmark, BookmarkEntry } from './types';

const MANIFEST_URL = 'https://ndp190.github.io/bookmark/manifest.json';
const R2_BASE_URL = 'https://r2.nikkdev.com/bookmark';

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
      const manifestRes = await fetch(MANIFEST_URL);
      if (!manifestRes.ok) {
        return jsonResponse({ error: 'Failed to fetch manifest' }, 500);
      }
      const manifest = await manifestRes.json() as { bookmarks: BookmarkEntry[] };

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
      const bookmarkRes = await fetch(`${R2_BASE_URL}/${key}.json`);
      if (!bookmarkRes.ok) {
        return jsonResponse({ error: 'Bookmark not found' }, 404);
      }
      const bookmark = await bookmarkRes.json() as StoredBookmark;
      return jsonResponse(bookmark);
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

  // POST /api/progress/:key - save progress for a bookmark
  if (path.startsWith('/api/progress/') && request.method === 'POST') {
    const key = decodeURIComponent(path.replace('/api/progress/', ''));
    try {
      const body = await request.json() as { scrollPosition: number; scrollPercentage: number };
      const progress: ReadingProgress = {
        bookmarkKey: key,
        scrollPosition: body.scrollPosition,
        scrollPercentage: body.scrollPercentage,
        lastReadAt: new Date().toISOString(),
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

function getListPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bookmark Reader</title>
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
  </style>
</head>
<body>
  <div class="container">
    <h1>Bookmark Reader</h1>
    <div id="content">
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading bookmarks...</span>
      </div>
    </div>
  </div>
  <script>
    async function loadBookmarks() {
      const content = document.getElementById('content');
      try {
        const res = await fetch('/api/bookmarks');
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (!data.bookmarks || data.bookmarks.length === 0) {
          content.innerHTML = '<div class="empty-state">No bookmarks found.</div>';
          return;
        }

        const html = data.bookmarks.map(bookmark => {
          const progress = bookmark.progress?.scrollPercentage || 0;
          const lastRead = bookmark.progress?.lastReadAt
            ? new Date(bookmark.progress.lastReadAt).toLocaleDateString()
            : 'Not started';

          return \`
            <div class="bookmark-card" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'">
              <div class="bookmark-title">\${escapeHtml(bookmark.title)}</div>
              \${bookmark.description ? \`<div class="bookmark-description">\${escapeHtml(bookmark.description)}</div>\` : ''}
              <div class="bookmark-meta">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: \${progress}%"></div>
                  </div>
                  <span class="progress-text">\${Math.round(progress)}%</span>
                </div>
                <span>Last read: \${lastRead}</span>
              </div>
              <div class="source-url">\${escapeHtml(bookmark.url)}</div>
            </div>
          \`;
        }).join('');

        content.innerHTML = '<div class="bookmark-list">' + html + '</div>';
      } catch (error) {
        content.innerHTML = '<div class="error-state">Error: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    loadBookmarks();
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
      transition: width 0.1s;
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

        // Debounce save (every 5 seconds)
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          if (Math.abs(scrollTop - lastSavedPosition) > 100) {
            saveProgress(scrollTop, percentage);
            lastSavedPosition = scrollTop;
          }
        }, 5000);
      });
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
      document.getElementById('markdownContent')?.addEventListener('mouseup', (e) => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text.length > 0) {
          selectedText = text;
          selectionRange = selection.getRangeAt(0).cloneRange();
          showSelectionPopup(e.clientX, e.clientY);
        }
      });

      document.addEventListener('mousedown', (e) => {
        const popup = document.getElementById('selectionPopup');
        if (!popup.contains(e.target) && popup.classList.contains('visible')) {
          hideSelectionPopup();
        }
      });
    }

    function showSelectionPopup(x, y) {
      const popup = document.getElementById('selectionPopup');
      popup.style.left = Math.min(x, window.innerWidth - 300) + 'px';
      popup.style.top = (y + window.scrollY + 10) + 'px';
      popup.classList.add('visible');
      document.getElementById('annotationInput').focus();
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

      // Highlight the selected text immediately
      try {
        const highlight = document.createElement('mark');
        highlight.className = 'annotation-highlight';
        highlight.setAttribute('data-annotation-text', selectedText);
        selectionRange.surroundContents(highlight);
      } catch (e) {
        console.warn('Could not highlight selection:', e);
      }

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
        <div class="annotation-item" data-annotation-id="\${a.id}">
          <div class="annotation-text">"\${escapeHtml(a.selectedText)}"</div>
          \${a.note ? \`<div class="annotation-note">\${escapeHtml(a.note)}</div>\` : ''}
          <div class="annotation-meta">
            <span>\${new Date(a.createdAt).toLocaleDateString()}</span>
            <button class="annotation-delete" onclick="deleteAnnotation('\${a.id}')">Delete</button>
          </div>
        </div>
      \`).join('');
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

    loadContent();
  </script>
</body>
</html>`;
}
