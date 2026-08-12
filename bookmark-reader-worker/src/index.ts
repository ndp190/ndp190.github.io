import { jwtVerify, createRemoteJWKSet } from 'jose';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Schema } from 'hast-util-sanitize';
import type { Env, ReadingProgress, Annotation, AnnotationList, StoredBookmark, BookmarkEntry, BookmarkManifest } from './types';
import { backfillBookmarkedArticleImages, normalizeArticleImages } from './imageProcessing';
import { BOOKMARK_READER_PNG_ICONS } from './icons';

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

    if (request.method === 'GET' && path === '/manifest.webmanifest') {
      return new Response(JSON.stringify(getBookmarkReaderManifest()), {
        headers: {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (request.method === 'GET' && path === '/sw.js') {
      return new Response(getBookmarkReaderServiceWorker(), {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (request.method === 'GET' && path === '/bookmark-icon.svg') {
      return new Response(getBookmarkIconSvg(), {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    if (request.method === 'GET') {
      const pngIconResponse = getBookmarkPngIconResponse(path);
      if (pngIconResponse) {
        return pngIconResponse;
      }
    }

    if (path.startsWith('/media/') && request.method === 'GET') {
      return handleMediaRoute(env, path);
    }

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

    if (request.method === 'GET' && path === '/offline-read-shell') {
      return new Response(getReadingPageHtml('__bookmark_from_path__'), {
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
      const source = bookmark.firecrawlResponse?.data?.markdown
        || bookmark.firecrawlResponse?.data?.html
        || bookmark.firecrawlResponse?.data?.rawHtml
        || '';
      const renderedHtml = source ? await renderMarkdownContent(source) : '';
      return jsonResponse({ ...bookmark, renderedHtml });
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

      // Scrape the URL (with PDF parser if URL points to a PDF)
      const firecrawlResult = await scrapeWithFirecrawl(body.url, env.FIRECRAWL_API_KEY, {
        isPdf: isPdfUrl(body.url),
      });
      if (!firecrawlResult.success) {
        return jsonResponse({ error: firecrawlResult.error || 'Scraping failed' }, 500);
      }

      // Generate key from title
      const title = firecrawlResult.data?.metadata?.title || new Date().toISOString();
      const key = generateKey(title);

      // Store scraped content in R2
      let storedBookmark: StoredBookmark = {
        url: body.url,
        scrapedAt: new Date().toISOString(),
        firecrawlResponse: firecrawlResult,
      };
      const normalizationResult = await normalizeArticleImages(storedBookmark, key, env);
      storedBookmark = normalizationResult.bookmark;
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
        imageMigration: storedBookmark.imageMigration ?? null,
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

  // DELETE /api/bookmarks/:key - delete bookmark and all associated data
  if (path.match(/^\/api\/bookmarks\/[^/]+$/) && request.method === 'DELETE') {
    const key = decodeURIComponent(path.replace('/api/bookmarks/', ''));
    try {
      // 1. Update manifest (remove entry)
      const manifest = await getManifest(env);
      if (!manifest) {
        return jsonResponse({ error: 'Manifest not found' }, 404);
      }
      manifest.bookmarks = manifest.bookmarks.filter(b => b.key !== key);
      manifest.updatedAt = new Date().toISOString();
      await env.BOOKMARK_BUCKET.put('bookmark/manifest.json', JSON.stringify(manifest));

      // 2. Delete bookmark content from R2
      await env.BOOKMARK_BUCKET.delete(`bookmark/${key}.json`);

      // 3. Delete enriched data from R2 (ignore if not exists)
      await env.BOOKMARK_BUCKET.delete(`bookmark/enriched/${key}.json`);

      // 4. Delete progress from KV
      await env.NIKK_BOOKMARK_PROGRESS.delete(key);

      // 5. Delete annotations from KV
      await env.NIKK_BOOKMARK_ANNOTATION.delete(key);

      return jsonResponse({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/sync - sync progress and annotations from KV to R2
  if (path === '/api/sync' && request.method === 'POST') {
    try {
      const manifest = await getManifest(env);
      if (!manifest) {
        return jsonResponse({ error: 'Manifest not found' }, 404);
      }

      const syncedAt = new Date().toISOString();
      let syncedCount = 0;

      // Fetch all progress and annotations, then update manifest with enriched data
      const enrichedBookmarks = await Promise.all(
        manifest.bookmarks.map(async (bookmark: BookmarkEntry) => {
          const [progressData, annotationsData] = await Promise.all([
            env.NIKK_BOOKMARK_PROGRESS.get(bookmark.key),
            env.NIKK_BOOKMARK_ANNOTATION.get(bookmark.key),
          ]);

          const progress = progressData ? JSON.parse(progressData) as ReadingProgress : null;
          const annotationList = annotationsData ? JSON.parse(annotationsData) as AnnotationList : null;
          const annotations = annotationList?.annotations || [];

          // Also save individual enriched file for backward compatibility
          const enrichedBookmark = {
            progress,
            annotations,
            syncedAt,
          };

          await env.BOOKMARK_BUCKET.put(
            `bookmark/enriched/${bookmark.key}.json`,
            JSON.stringify(enrichedBookmark),
            { httpMetadata: { contentType: 'application/json' } }
          );
          syncedCount++;

          // Return bookmark with embedded progress and annotations
          return {
            ...bookmark,
            progress,
            annotations,
          };
        })
      );

      // Update manifest with enriched data
      const enrichedManifest = {
        bookmarks: enrichedBookmarks,
        updatedAt: syncedAt,
      };

      await env.BOOKMARK_BUCKET.put(
        MANIFEST_KEY,
        JSON.stringify(enrichedManifest),
        { httpMetadata: { contentType: 'application/json' } }
      );

      return jsonResponse({ success: true, syncedCount, syncedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/backfill/images - normalize images for existing bookmark records
  if (path === '/api/backfill/images' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({})) as {
        execute?: boolean;
        limit?: number;
        concurrency?: number;
      };
      const report = await backfillBookmarkedArticleImages(env, {
        execute: body.execute === true,
        limit: body.limit,
        concurrency: body.concurrency,
      });
      return jsonResponse(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: 'API endpoint not found' }, 404);
}

async function handleMediaRoute(env: Env, path: string): Promise<Response> {
  const key = decodeURIComponent(path.replace('/media/', ''));
  if (!key || key.includes('..') || key.startsWith('/')) {
    return jsonResponse({ error: 'Invalid media key' }, 400);
  }

  const object = await env.ARTICLE_IMAGES.get(key);
  if (!object) {
    return jsonResponse({ error: 'Media not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', isContentAddressedImageKey(key)
    ? 'public, max-age=31536000, immutable'
    : 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', object.customMetadata?.sourceContentType || 'application/octet-stream');
  }

  return new Response(object.body, { headers });
}

function isContentAddressedImageKey(key: string): boolean {
  return /^images\/[a-f0-9]{64}\.(?:jpg|png|gif|webp|avif|svg)$/.test(key);
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

const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'audio',
    'figcaption',
    'figure',
    'iframe',
    'picture',
    'source',
    'track',
    'video',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      'ariaLabel',
      'className',
      'dataAnnotationId',
      'dataLanguage',
    ],
    a: [
      ...(defaultSchema.attributes?.a || []),
      'target',
      'rel',
    ],
    audio: [
      'controls',
      'preload',
      'src',
    ],
    code: [
      ...(defaultSchema.attributes?.code || []),
      ['className', /^language-./],
    ],
    iframe: [
      'allow',
      'allowFullScreen',
      'height',
      'loading',
      'referrerPolicy',
      'src',
      'title',
      'width',
    ],
    img: [
      ...(defaultSchema.attributes?.img || []),
      'decoding',
      'loading',
      'referrerPolicy',
      'srcSet',
      'sizes',
    ],
    input: [
      'checked',
      'disabled',
      'type',
    ],
    source: [
      'media',
      'sizes',
      'src',
      'srcSet',
      'type',
    ],
    track: [
      'default',
      'kind',
      'label',
      'src',
      'srcLang',
    ],
    video: [
      'autoPlay',
      'controls',
      'height',
      'loop',
      'muted',
      'playsInline',
      'poster',
      'preload',
      'src',
      'width',
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'tel'],
    src: ['http', 'https', 'data'],
  },
};

async function renderMarkdownContent(content: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeKatex)
    .use(rehypeStringify)
    .process(content);

  return String(file);
}

interface ScrapeOptions {
  isPdf?: boolean;
}

async function scrapeWithFirecrawl(url: string, apiKey: string, options: ScrapeOptions = {}): Promise<FirecrawlResponse> {
  const requestBody: Record<string, unknown> = {
    url,
    formats: ['markdown'],
  };

  // Add PDF parser when URL points to a PDF file
  if (options.isPdf) {
    requestBody.parsers = ['pdf'];
  }

  const response = await fetch(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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

function isPdfUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Check if pathname ends with .pdf (case-insensitive)
    return url.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function getBookmarkReaderManifest() {
  return {
    name: 'Bookmark Reader',
    short_name: 'Bookmarks',
    description: 'Offline-capable private bookmark reader.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#282828',
    theme_color: '#282828',
    icons: [
      {
        src: '/bookmark-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/bookmark-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}

function getBookmarkReaderServiceWorker(): string {
  return `
const SHELL_CACHE = 'bookmark-reader-worker-shell-v2';
const DATA_CACHE = 'bookmark-reader-worker-data-v2';
const MEDIA_CACHE = 'bookmark-reader-worker-media-v1';
const SHELL_URLS = ['/', '/offline-read-shell', '/manifest.webmanifest', '/apple-touch-icon.png', '/bookmark-icon-192.png', '/bookmark-icon-512.png', '/bookmark-icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(cleanOldCaches());
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (isOfflineDataRequest(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (isOfflineMediaRequest(url, request)) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
  }
});

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(SHELL_URLS.map(async url => {
    const response = await fetch(url, { cache: 'reload' });
    if (response.ok) {
      await cache.put(url, response.clone());
    }
  }));
  if (!(await cache.match('/offline-read-shell'))) {
    await cache.put('/offline-read-shell', offlineHtml('Saved article shell is not ready yet.'));
  }
  if (!(await cache.match('/'))) {
    await cache.put('/', offlineHtml('Open Bookmark Reader once online to finish offline setup.'));
  }
}

async function cleanOldCaches() {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, MEDIA_CACHE]);
  const names = await caches.keys();
  await Promise.all(names.map(name => {
    if (name.startsWith('bookmark-reader-worker-') && !keep.has(name)) {
      return caches.delete(name);
    }
    return undefined;
  }));
}

async function handleNavigation(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
      if (url.pathname === '/') {
        await cache.put('/', response.clone());
      }
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    if (url.pathname.startsWith('/read/')) {
      return (await cache.match(request))
        || (await cache.match('/offline-read-shell'))
        || offlineHtml('Saved article shell is not ready yet.');
    }
    return (await cache.match(request))
      || (await cache.match('/'))
      || offlineHtml('Bookmark Reader is not ready offline yet.');
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || jsonError('Offline data is not available', 503);
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
  }
  return response;
}

function isOfflineDataRequest(url) {
  return url.origin === self.location.origin
    && (
      url.pathname === '/api/bookmarks'
      || url.pathname.startsWith('/api/bookmark/')
      || url.pathname.startsWith('/api/annotations/')
      || url.pathname.startsWith('/api/progress/')
    );
}

function isOfflineMediaRequest(url, request) {
  return request.destination === 'image'
    || (url.origin === self.location.origin && url.pathname.startsWith('/media/'));
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function offlineHtml(message) {
  return new Response('<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#282828"><title>Bookmark Reader</title><style>body{margin:0;background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}main{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}p{max-width:34rem;line-height:1.6}</style></head><body><main><p>' + message + '</p></main></body></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
`;
}

function getBookmarkIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="72" fill="#282828"/>
  <rect width="512" height="116" rx="72" fill="#3c3836"/>
  <rect y="68" width="512" height="48" fill="#3c3836"/>
  <circle cx="78" cy="58" r="22" fill="#cc241d"/>
  <circle cx="132" cy="58" r="22" fill="#d79921"/>
  <circle cx="186" cy="58" r="22" fill="#98971a"/>
  <path d="M112 242 214 196v44l-53 24 53 24v44l-102-46z" fill="#b8bb26"/>
  <path d="M278 160h116c22 0 40 18 40 40v184l-98-42-98 42V200c0-22 18-40 40-40z" fill="#fabd2f"/>
  <path d="M278 160h116c22 0 40 18 40 40v38H238v-38c0-22 18-40 40-40z" fill="#d79921"/>
  <path d="M288 280h96" stroke="#282828" stroke-width="24" stroke-linecap="round"/>
  <rect x="112" y="370" width="96" height="24" rx="12" fill="#b8bb26"/>
</svg>`;
}

function getBookmarkPngIconResponse(path: string): Response | null {
  const icon = BOOKMARK_READER_PNG_ICONS[path];
  if (!icon) return null;

  return new Response(base64ToBytes(icon), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getPwaHeadTags(): string {
  return `
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/bookmark-icon-192.png">
  <link rel="icon" type="image/svg+xml" href="/bookmark-icon.svg">
  <meta name="theme-color" content="#282828">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Bookmarks">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`;
}

function getBookmarkReaderOfflineClientScript(): string {
  return `
    const BOOKMARK_READER_DATA_CACHE = 'bookmark-reader-worker-data-v2';
    const BOOKMARK_READER_MEDIA_CACHE = 'bookmark-reader-worker-media-v1';

    function registerBookmarkReaderServiceWorker() {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
      navigator.serviceWorker.register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .catch(() => undefined);
    }

    async function cacheJsonForOffline(path, data) {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(BOOKMARK_READER_DATA_CACHE);
      await cache.put(path, new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    async function fetchAndCacheJson(path) {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Failed to fetch ' + path);
      const data = await response.clone().json();
      await cacheJsonForOffline(path, data);
      return data;
    }

    async function cacheBookmarkForOffline(bookmark) {
      if (!bookmark || !bookmark.key) return;
      const key = encodeURIComponent(bookmark.key);
      try {
        const article = await fetchAndCacheJson('/api/bookmark/' + key);
        await Promise.allSettled([
          fetchAndCacheJson('/api/annotations/' + key),
          fetchAndCacheJson('/api/progress/' + key),
          cacheArticleImagesForOffline(article)
        ]);
      } catch (error) {
        console.warn('Offline cache failed for bookmark:', bookmark.key, error);
      }
    }

    async function cacheBookmarksForOffline(bookmarks) {
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) return;
      const queue = bookmarks.slice();
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          await cacheBookmarkForOffline(next);
        }
      });
      await Promise.allSettled(workers);
    }

    async function cacheCurrentArticleForOffline(bookmarkKey, bookmark, annotationsData, progressData) {
      const key = encodeURIComponent(bookmarkKey);
      await Promise.allSettled([
        cacheJsonForOffline('/api/bookmark/' + key, bookmark),
        cacheJsonForOffline('/api/annotations/' + key, annotationsData),
        cacheJsonForOffline('/api/progress/' + key, progressData),
        cacheArticleImagesForOffline(bookmark)
      ]);
    }

    async function cacheArticleImagesForOffline(bookmark) {
      if (typeof caches === 'undefined') return;
      const urls = extractArticleImageUrls(bookmark);
      if (urls.length === 0) return;

      const cache = await caches.open(BOOKMARK_READER_MEDIA_CACHE);
      await Promise.allSettled(urls.map(async imageUrl => {
        const absoluteUrl = resolveArticleUrl(imageUrl, bookmark.url || location.href);
        if (!absoluteUrl) return;
        const request = new Request(absoluteUrl, { mode: 'no-cors', credentials: 'include' });
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
          await cache.put(request, response.clone());
        }
      }));
    }

    function extractArticleImageUrls(bookmark) {
      const urls = new Set();
      const data = bookmark?.firecrawlResponse?.data || {};
      const metadata = data.metadata || {};

      const markdown = data.markdown || '';
      const markdownPattern = /!\\[[^\\]]*\\]\\((<[^>]+>|[^)\\s]+)(?:\\s+(?:"[^"]*"|'[^']*'|\\([^)]+\\)))?\\)/g;
      for (const match of markdown.matchAll(markdownPattern)) {
        urls.add(stripMarkdownUrl(match[1]));
      }

      [data.html, data.rawHtml].forEach(html => {
        if (!html) return;
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('img').forEach(img => {
            ['src', 'data-src', 'data-original', 'data-lazy-src'].forEach(attr => {
              const value = img.getAttribute(attr);
              if (value) urls.add(value);
            });
            ['srcset', 'data-srcset'].forEach(attr => {
              splitSrcset(img.getAttribute(attr)).forEach(url => urls.add(url));
            });
          });
          doc.querySelectorAll('source').forEach(source => {
            ['srcset', 'data-srcset'].forEach(attr => {
              splitSrcset(source.getAttribute(attr)).forEach(url => urls.add(url));
            });
          });
        } catch {
          // Ignore malformed article HTML.
        }
      });

      ['ogImage', 'og:image', 'image', 'twitterImage', 'twitter:image'].forEach(field => {
        if (typeof metadata[field] === 'string') urls.add(metadata[field]);
      });

      return Array.from(urls).filter(Boolean);
    }

    function splitSrcset(value) {
      if (!value) return [];
      return value.split(',').map(part => part.trim().split(/\\s+/)[0]).filter(Boolean);
    }

    function stripMarkdownUrl(value) {
      if (!value) return '';
      const trimmed = value.trim();
      return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
    }

    function resolveArticleUrl(value, baseUrl) {
      const raw = stripMarkdownUrl(String(value || '').trim());
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('cid:')) return null;
      try {
        return new URL(raw, raw.startsWith('/media/') ? location.origin : baseUrl).toString();
      } catch {
        return null;
      }
    }

    registerBookmarkReaderServiceWorker();
  `;
}

function getListPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bookmark Reader</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fabd2f'><path d='M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'/></svg>">
  ${getPwaHeadTags()}
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
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }
    h1 { color: #fabd2f; font-size: 2rem; margin: 0; }
    .sync-btn {
      padding: 0.5rem 1rem;
      background: #504945;
      color: #ebdbb2;
      border: 2px solid #504945;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }
    .sync-btn:hover { border-color: #fabd2f; color: #fabd2f; }
    .sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .sync-btn.syncing .sync-icon { animation: spin 1s linear infinite; }
    .sync-btn.success { background: #3d5a3d; border-color: #b8bb26; color: #b8bb26; }
    .sync-btn.error { background: #5a3d3d; border-color: #fb4934; color: #fb4934; }
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
      transition: border-color 0.2s;
      border: 1px solid #504945;
    }
    .bookmark-card:hover {
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
    .bookmark-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
    }
    .source-url {
      color: #928374;
      font-size: 0.75rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
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
    .open-url-btn, .delete-btn {
      background: none;
      border: none;
      width: 24px;
      height: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #504945;
      transition: all 0.2s;
      margin-left: 0.5rem;
    }
    .open-url-btn:hover { color: #83a598; }
    .delete-btn:hover { color: #fb4934; }
  </style>
</head>
<body>
  <div class="container">
    <div class="page-header">
      <h1>Bookmark Reader</h1>
      <button class="sync-btn" id="syncBtn" title="Sync to R2 for terminal site">
        <svg class="sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        <span class="sync-text">Sync</span>
      </button>
    </div>
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
${getBookmarkReaderOfflineClientScript()}
  </script>
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
        cacheJsonForOffline('/api/bookmarks', data).catch(() => undefined);
        cacheBookmarksForOffline(allBookmarks).catch(() => undefined);
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
          <div class="bookmark-card" data-bookmark-key="\${bookmark.key}">
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
            <div class="bookmark-footer">
              <div class="source-url" onclick="window.location.href='/read/\${encodeURIComponent(bookmark.key)}'" style="cursor:pointer;">\${escapeHtml(bookmark.url)}</div>
              <button class="open-url-btn" onclick="event.stopPropagation(); window.open('\${escapeHtml(bookmark.url)}', '_blank')" title="Open original URL">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
              <button class="delete-btn" onclick="event.stopPropagation(); deleteBookmark('\${bookmark.key}')" title="Delete bookmark">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
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

    async function deleteBookmark(key) {
      if (!confirm('Delete this bookmark? This will also remove all annotations and reading progress.')) {
        return;
      }

      try {
        const res = await fetch('/api/bookmarks/' + encodeURIComponent(key), {
          method: 'DELETE'
        });

        if (!res.ok) throw new Error('Failed to delete');

        // Remove from local data
        allBookmarks = allBookmarks.filter(b => b.key !== key);

        // Remove card from DOM
        const card = document.querySelector('[data-bookmark-key="' + key + '"]');
        if (card) card.remove();

        // Update counts
        updateCounts();
      } catch (e) {
        alert('Failed to delete bookmark');
        console.error(e);
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

    // Sync button functionality
    const syncBtn = document.getElementById('syncBtn');
    const syncText = syncBtn.querySelector('.sync-text');

    async function syncToR2() {
      syncBtn.disabled = true;
      syncBtn.classList.add('syncing');
      syncBtn.classList.remove('success', 'error');
      syncText.textContent = 'Syncing...';

      try {
        const res = await fetch('/api/sync', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          syncBtn.classList.remove('syncing');
          syncBtn.classList.add('success');
          syncText.textContent = 'Synced ' + data.syncedCount;
          setTimeout(() => {
            syncBtn.classList.remove('success');
            syncText.textContent = 'Sync';
            syncBtn.disabled = false;
          }, 2000);
        } else {
          throw new Error(data.error || 'Sync failed');
        }
      } catch (error) {
        syncBtn.classList.remove('syncing');
        syncBtn.classList.add('error');
        syncText.textContent = 'Failed';
        setTimeout(() => {
          syncBtn.classList.remove('error');
          syncText.textContent = 'Sync';
          syncBtn.disabled = false;
        }, 2000);
      }
    }

    syncBtn.addEventListener('click', syncToR2);

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
  ${getPwaHeadTags()}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap&subset=vietnamese" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script>
    (function () {
      try {
        const prefs = JSON.parse(localStorage.getItem('bookmark-reader-preferences') || '{}');
        if (prefs.width) document.documentElement.style.setProperty('--content-width', prefs.width);
        if (prefs.fontSize) document.documentElement.style.setProperty('--reader-font-size', prefs.fontSize + 'px');
      } catch (_) {}
    })();
  </script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      color-scheme: dark;
      --bg: #282828;
      --surface: #3c3836;
      --surface-muted: #504945;
      --ink: #ebdbb2;
      --ink-soft: #d5c4a1;
      --muted: #928374;
      --line: #504945;
      --accent: #fabd2f;
      --accent-strong: #fabd2f;
      --accent-2: #83a598;
      --mark: rgba(131, 165, 152, 0.38);
      --danger: #fb4934;
      --code-bg: rgba(146, 131, 116, 0.13);
      --code-ink: #ebdbb2;
      --shadow: none;
      --content-width: 80ch;
      --reader-font-size: 1rem;
      --topbar-height: 64px;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: #282828;
      --surface: #3c3836;
      --surface-muted: #504945;
      --ink: #ebdbb2;
      --ink-soft: #d5c4a1;
      --muted: #928374;
      --line: #504945;
      --accent: #fabd2f;
      --accent-strong: #fabd2f;
      --accent-2: #83a598;
      --mark: rgba(131, 165, 152, 0.38);
      --danger: #fb4934;
      --code-bg: rgba(146, 131, 116, 0.13);
      --code-ink: #ebdbb2;
      --shadow: none;
    }
    html, body {
      overflow-x: hidden;
      max-width: 100vw;
      scroll-behavior: smooth;
    }
    body {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      font-weight: 500;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
      line-height: 1.75;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      min-height: var(--topbar-height);
      background: rgba(60, 56, 54, 0.94);
      border-bottom: 1px solid var(--line);
      padding: 0.65rem clamp(1rem, 3vw, 1.5rem);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      z-index: 100;
      backdrop-filter: blur(18px);
    }
    .back-btn {
      color: var(--accent-2);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
      min-width: fit-content;
    }
    .back-btn:hover { opacity: 0.8; }
    .reading-progress {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 700;
      min-width: 168px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: fit-content;
    }
    .header-btn, .setting-btn {
      background: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      width: 36px;
      height: 36px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      color: var(--muted);
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .header-btn:hover, .setting-btn:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--surface-muted); }
    .header-btn:focus-visible, .setting-btn:focus-visible, .back-btn:focus-visible, .annotation-toggle:focus-visible {
      outline: 3px solid rgba(250, 189, 47, 0.42);
      outline-offset: 3px;
    }
    .header-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--surface);
    }
    .header-btn.fav-btn.active {
      background: transparent;
      border-color: var(--accent);
      color: var(--accent);
    }
    .header-btn.open-url-btn:hover {
      border-color: var(--accent-2);
      color: var(--accent-2);
    }
    .reader-settings {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding-left: 0.5rem;
      margin-left: 0.25rem;
      border-left: 1px solid var(--line);
    }
    .progress-bar-header {
      width: 120px;
      height: 6px;
      background: var(--surface-muted);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill-header {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      border-radius: 3px;
      /* no transition for smooth scroll tracking */
    }
    .container {
      max-width: calc(var(--content-width) + 4rem);
      margin: 0 auto;
      padding: calc(var(--topbar-height) + 2.5rem) 2rem 5rem;
    }
    .loading, .error-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 4rem 2rem;
      text-align: center;
    }
    .error-state { color: var(--danger); }
    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid var(--line);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .reader-article {
      max-width: var(--content-width);
      margin: 0 auto;
    }
    .article-header {
      margin: 0.5rem auto 1.25rem;
      max-width: 80ch;
      color: var(--ink-soft);
    }
    .article-kicker {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem 0.8rem;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 500;
      letter-spacing: 0;
      margin-bottom: 0.5rem;
    }
    .article-source {
      color: var(--accent-2);
      text-decoration: none;
      max-width: 100%;
      overflow-wrap: anywhere;
      border-bottom: 1px dashed rgba(131, 165, 152, 0.5);
    }
    .article-source:hover { border-bottom-color: var(--accent-2); }
    .article-title {
      font-family: inherit;
      font-size: 1.75rem;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: 0;
      color: var(--accent);
      border-bottom: 1px solid var(--muted);
      padding-bottom: 0.5rem;
    }
    .article-description {
      margin-top: 0.75rem;
      color: var(--ink-soft);
      font-size: 0.95rem;
      line-height: 1.65;
    }

    .article-body {
      margin: 0.5rem auto 1rem;
      max-width: 80ch;
      font-family: inherit;
      font-size: var(--reader-font-size);
      line-height: 1.75;
      color: var(--ink);
      overflow-wrap: break-word;
    }
    .article-body h1,
    .article-body h2,
    .article-body h3,
    .article-body h4,
    .article-body h5,
    .article-body h6 {
      position: relative;
      color: var(--accent);
      margin: 1.5rem 0 0.75rem 0;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: 0;
      scroll-margin-top: calc(var(--topbar-height) + 1.25rem);
    }
    .article-body h1 {
      font-size: 1.75rem;
      border-bottom: 1px solid var(--muted);
      padding-bottom: 0.5rem;
    }
    .article-body h2 {
      font-size: 1.4rem;
      border-bottom: 1px solid rgba(146, 131, 116, 0.5);
      padding-bottom: 0.35rem;
    }
    .article-body h3 { font-size: 1.15rem; }
    .article-body h4,
    .article-body h5,
    .article-body h6 { font-size: 1rem; }
    .article-body h2::before,
    .article-body h3::before { display: none; }
    .heading-anchor {
      opacity: 0;
      color: var(--accent-2);
      text-decoration: none;
      margin-left: 0.45rem;
      font-size: 0.72em;
      transition: opacity 0.2s;
    }
    .article-body h1:hover .heading-anchor,
    .article-body h2:hover .heading-anchor,
    .article-body h3:hover .heading-anchor,
    .article-body h4:hover .heading-anchor,
    .article-body h5:hover .heading-anchor,
    .article-body h6:hover .heading-anchor,
    .heading-anchor:focus-visible { opacity: 1; }
    .article-body p {
      margin: 0.75rem 0;
      color: var(--ink);
    }
    .article-body strong { font-weight: 600; color: var(--accent); }
    .article-body em { color: var(--ink-soft); }
    .article-body a {
      color: var(--accent-2);
      text-decoration: none;
      border-bottom: 1px dashed rgba(131, 165, 152, 0.5);
      transition: border-bottom-color 0.2s ease;
    }
    .article-body a:hover { border-bottom-color: var(--accent-2); }
    .article-body ul,
    .article-body ol {
      margin: 0.75rem 0;
      padding-left: 1.75rem;
    }
    .article-body li {
      margin: 0.4rem 0;
      padding-left: 0.2em;
    }
    .article-body li::marker {
      color: var(--accent-2);
    }
    .article-body li > ul,
    .article-body li > ol { margin: 0.35em 0 0.55em; }
    .article-body blockquote {
      border-left: 4px solid var(--accent);
      margin: 1rem 0;
      padding: 0.5rem 0 0.5rem 1.25rem;
      color: var(--ink-soft);
      background: rgba(146, 131, 116, 0.08);
      border-radius: 0 4px 4px 0;
      font-style: italic;
    }
    .article-body blockquote > :first-child { margin-top: 0; }
    .article-body blockquote > :last-child { margin-bottom: 0; }
    .article-body pre {
      background: var(--code-bg);
      color: var(--code-ink);
      border-left: 3px solid var(--accent-2);
      border-radius: 0 4px 4px 0;
      padding: 1rem;
      overflow-x: auto;
      margin: 0;
      tab-size: 2;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .code-block { margin: 1rem 0; }
    .code-label {
      display: inline-flex;
      margin: 0 0 0.35rem 0.3rem;
      color: var(--muted);
      font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .article-body code,
    .article-body kbd,
    .article-body samp {
      font-family: inherit;
      font-size: 0.9em;
    }
    .article-body pre code { color: inherit; background: transparent; padding: 0; }
    .article-body :not(pre) > code,
    .article-body kbd {
      background: rgba(146, 131, 116, 0.19);
      color: var(--accent);
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      white-space: break-spaces;
    }
    .article-body img,
    .article-body video,
    .article-body audio,
    .article-body iframe,
    .article-body object {
      max-width: 100%;
    }
    .article-body img {
      display: block;
      height: auto;
      margin: 1rem 0;
      border-radius: 4px;
      border: 1px solid rgba(146, 131, 116, 0.25);
    }
    .article-body figure {
      margin: 1rem 0;
    }
    .article-body figure > img,
    .article-body figure > video,
    .article-body figure > iframe {
      width: 100%;
      background: rgba(146, 131, 116, 0.08);
      border: 1px solid rgba(146, 131, 116, 0.25);
      box-shadow: none;
    }
    .article-body video {
      width: min(100%, 600px);
      height: auto;
      margin: 1rem 0;
      border-radius: 4px;
      border: 1px solid rgba(146, 131, 116, 0.25);
    }
    .article-body audio {
      width: 100%;
      margin: 1rem 0;
    }
    .article-body figcaption {
      margin-top: 0.55rem;
      color: var(--muted);
      font-family: inherit;
      font-size: 0.86rem;
      line-height: 1.5;
      text-align: center;
    }
    .media-embed iframe {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      min-height: 260px;
      border: 1px solid rgba(146, 131, 116, 0.25);
      border-radius: 4px;
      background: rgba(146, 131, 116, 0.08);
      box-shadow: none;
    }
    .media-embed.pdf iframe {
      aspect-ratio: auto;
      height: min(76vh, 780px);
    }
    .table-scroll {
      width: 100%;
      overflow-x: auto;
      margin: 1.45em 0;
      border: 1px solid rgba(146, 131, 116, 0.38);
      border-radius: 4px;
      background: transparent;
    }
    .article-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
      min-width: 36rem;
      font-family: inherit;
      font-size: 0.9em;
      line-height: 1.5;
    }
    .article-body th,
    .article-body td {
      border: 1px solid rgba(146, 131, 116, 0.38);
      padding: 0.6rem 0.8rem;
      text-align: left;
      vertical-align: top;
    }
    .article-body th {
      background: rgba(146, 131, 116, 0.15);
      color: var(--accent);
      font-weight: 600;
    }
    .article-body tr:nth-child(even) {
      background: rgba(146, 131, 116, 0.06);
    }
    .article-body hr {
      border: none;
      border-top: 1px solid rgba(146, 131, 116, 0.5);
      margin: 1.5rem 0;
    }
    .article-body del { color: var(--muted); }
    .article-body mark:not(.annotation-highlight) {
      background: var(--mark);
      color: var(--ink);
      border-radius: 4px;
      padding: 0.03em 0.15em;
    }
    .article-body details {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      background: rgba(146, 131, 116, 0.08);
    }
    .article-body summary {
      cursor: pointer;
      color: var(--accent-strong);
      font-family: inherit;
      font-weight: 600;
    }
    .article-body dl { margin: 1.1em 0; }
    .article-body dt {
      color: var(--ink);
      font-family: inherit;
      font-weight: 600;
    }
    .article-body dd { margin: 0.25em 0 0.85em 1.25em; color: var(--ink-soft); }
    .article-body .contains-task-list {
      list-style: none;
      padding-left: 0;
    }
    .article-body .task-list-item {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      padding-left: 0;
    }
    .article-body .task-list-item input[type="checkbox"] {
      width: 1rem;
      height: 1rem;
      margin-top: 0.45em;
      accent-color: var(--accent);
      flex: 0 0 auto;
    }
    .article-body .footnotes,
    .article-body .footnote {
      margin-top: 2.5em;
      padding-top: 1em;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.86em;
    }
    .article-body .mermaid {
      margin: 1.6em 0;
      padding: 1rem;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(146, 131, 116, 0.08);
    }
    .empty-content {
      color: var(--muted);
      font-family: inherit;
      padding: 2rem 0;
    }

    /* Annotation styles */
    .annotation-highlight {
      background: var(--mark);
      cursor: pointer;
      border-radius: 3px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      padding: 0.02em 0.08em;
    }
    .annotation-highlight:hover {
      background: rgba(131, 165, 152, 0.55);
    }

    /* Annotation panel */
    .annotation-panel {
      position: fixed;
      right: 0;
      top: var(--topbar-height);
      bottom: 0;
      width: min(380px, 92vw);
      background: var(--surface);
      border-left: 1px solid var(--line);
      padding: 1rem;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s;
      z-index: 99;
      box-shadow: -18px 0 38px rgba(0, 0, 0, 0.16);
    }
    .annotation-panel.open { transform: translateX(0); }
    .annotation-panel h3 {
      color: var(--ink);
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 1rem;
    }
    .annotation-toggle {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      width: 48px;
      height: 48px;
      background: var(--accent);
      color: var(--surface);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.5rem;
      z-index: 101;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow);
    }
    .annotation-toggle:hover { opacity: 0.9; }
    .annotation-item {
      background: rgba(146, 131, 116, 0.12);
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      border: 1px solid var(--line);
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .annotation-item:hover {
      border-color: var(--accent);
    }
    .annotation-text {
      font-style: italic;
      color: var(--accent-strong);
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
      padding: 0.5rem;
      background: rgba(250, 189, 47, 0.1);
      border-radius: 4px;
    }
    .annotation-note {
      font-size: 0.9rem;
      color: var(--ink-soft);
    }
    .annotation-meta {
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .annotation-delete {
      color: var(--danger);
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.8rem;
      font-family: inherit;
    }
    .annotation-delete:hover { text-decoration: underline; }
    .no-annotations {
      color: var(--muted);
      text-align: center;
      padding: 2rem;
    }

    /* Selection popup */
    .selection-popup {
      position: absolute;
      background: var(--surface);
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 0.75rem;
      box-shadow: var(--shadow);
      z-index: 200;
      display: none;
      width: 280px;
    }
    .selection-popup.visible { display: block; }
    .selection-popup textarea {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 4px;
      color: var(--ink);
      padding: 0.5rem;
      font-family: inherit;
      font-size: 0.9rem;
      resize: vertical;
      min-height: 60px;
      margin-bottom: 0.5rem;
    }
    .selection-popup textarea:focus {
      outline: none;
      border-color: var(--accent);
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
      font-family: inherit;
    }
    .selection-popup .save-btn {
      background: var(--accent);
      color: var(--surface);
      font-weight: 500;
    }
    .selection-popup .cancel-btn {
      background: var(--surface-muted);
      color: var(--ink);
    }
    @media (max-width: 760px) {
      :root { --topbar-height: 104px; }
      .header {
        flex-wrap: wrap;
        align-items: center;
      }
      .reading-progress {
        order: 3;
        flex: 1 0 100%;
      }
      .progress-bar-header { flex: 1; width: auto; }
      .header-actions {
        margin-left: auto;
      }
      .reader-settings {
        display: none;
      }
      .container {
        padding: calc(var(--topbar-height) + 1.4rem) 1rem 5rem;
      }
      .article-title {
        font-size: clamp(2rem, 12vw, 3.1rem);
      }
      .article-body {
        line-height: 1.72;
      }
      .article-body h2::before,
      .article-body h3::before {
        left: -0.65rem;
        width: 0.22rem;
      }
      .media-embed iframe {
        min-height: 210px;
      }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
</head>
<body>
  <header class="header">
    <a href="/" class="back-btn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      <span>Library</span>
    </a>
    <div class="reading-progress">
      <div class="progress-bar-header">
        <div class="progress-fill-header" id="progressFill" style="width: 0%"></div>
      </div>
      <span id="progressText">0%</span>
    </div>
    <div class="header-actions">
      <button class="header-btn open-url-btn" id="openUrlBtn" title="Open original URL">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
      </button>
      <button class="header-btn fav-btn" id="favBtn" title="Add to favourites">★</button>
      <button class="header-btn read-btn" id="readBtn" title="Mark as read">✓</button>
      <div class="reader-settings" aria-label="Reader settings">
        <button class="setting-btn" id="fontDownBtn" title="Decrease text size" aria-label="Decrease text size">A-</button>
        <button class="setting-btn" id="fontUpBtn" title="Increase text size" aria-label="Increase text size">A+</button>
        <button class="setting-btn" id="widthBtn" title="Change line width" aria-label="Change line width">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 8h16M4 16h16M8 4L4 8l4 4M16 12l4 4-4 4"/>
          </svg>
        </button>
      </div>
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
      <button onclick="togglePanel()" style="background:none;border:none;color:var(--ink);cursor:pointer;font-size:1.2rem;">&times;</button>
    </h3>
    <div id="annotationList">
      <div class="no-annotations">No annotations yet</div>
    </div>
  </div>

  <div class="selection-popup" id="selectionPopup">
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">Add annotation</div>
    <textarea id="annotationInput" placeholder="Write your note..."></textarea>
    <div class="selection-popup-buttons">
      <button class="cancel-btn" onclick="hideSelectionPopup()">Cancel</button>
      <button class="save-btn" onclick="saveAnnotation()">Save</button>
    </div>
  </div>

  <script>
${getBookmarkReaderOfflineClientScript()}
  </script>
  <script>
    const embeddedBookmarkKey = ${JSON.stringify(key)};
    const bookmarkKey = embeddedBookmarkKey === '__bookmark_from_path__'
      ? decodeURIComponent(location.pathname.replace(/^\\/read\\//, ''))
      : embeddedBookmarkKey;
    let annotations = [];
    let selectedText = '';
    let selectionRange = null;
    let scrollTimeout = null;
    let lastSavedPosition = 0;
    let isRead = false;
    let isFavourite = false;
    let rawMarkdown = '';
    let rawHtml = '';
    let bookmarkUrl = '';
    const PREF_KEY = 'bookmark-reader-preferences';
    const widthSteps = ['72ch', '80ch', '92ch', '104ch'];
    let readerPrefs = {
      fontSize: 16,
      width: '80ch'
    };

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

        bookmarkUrl = bookmark.url || '';
        annotations = annotationsData.annotations || [];
        cacheCurrentArticleForOffline(bookmarkKey, bookmark, annotationsData, progressData).catch(() => undefined);

        const firecrawlData = bookmark.firecrawlResponse?.data || {};
        const metadata = firecrawlData.metadata || {};
        rawMarkdown = firecrawlData.markdown || '';
        rawHtml = firecrawlData.html || firecrawlData.rawHtml || '';
        bookmarkUrl = metadata.sourceURL || bookmark.url || '';
        const title = metadata.title || deriveTitleFromMarkdown(rawMarkdown) || 'Untitled';
        const description = metadata.description || '';
        const renderedHtml = bookmark.renderedHtml || '';

        document.title = title + ' - Bookmark Reader';

        content.innerHTML = renderArticleShell(title, description, bookmarkUrl, bookmark.scrapedAt);
        const articleBody = document.getElementById('articleBody');
        if (renderedHtml.trim()) {
          articleBody.innerHTML = renderedHtml;
        } else if (rawMarkdown.trim()) {
          articleBody.innerHTML = fallbackMarkdownToHtml(rawMarkdown);
        } else if (rawHtml.trim()) {
          articleBody.innerHTML = sanitizeRenderedHtml(rawHtml);
        } else {
          articleBody.innerHTML = '<div class="empty-content">No readable content was saved for this bookmark.</div>';
        }

        enhanceArticle(articleBody, bookmarkUrl, title);
        applyAnnotationHighlights();

        renderAnnotations();

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

    function renderArticleShell(title, description, sourceUrl, scrapedAt) {
      const domain = getDomain(sourceUrl);
      const dateLabel = scrapedAt ? new Date(scrapedAt).toLocaleDateString() : '';
      const sourceLink = sourceUrl
        ? '<a class="article-source" href="' + escapeAttribute(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(domain || sourceUrl) + '</a>'
        : '';
      const meta = [sourceLink, dateLabel ? '<span>' + escapeHtml(dateLabel) + '</span>' : ''].filter(Boolean).join('<span aria-hidden="true">/</span>');
      return '<article class="reader-article" id="markdownContent">' +
        '<header class="article-header">' +
          '<div class="article-kicker">' + meta + '<span id="readingTime"></span></div>' +
          '<h1 class="article-title">' + escapeHtml(title) + '</h1>' +
          (description ? '<p class="article-description">' + escapeHtml(description) + '</p>' : '') +
        '</header>' +
        '<div class="article-body" id="articleBody"></div>' +
      '</article>';
    }

    function fallbackMarkdownToHtml(md) {
      return md
        .split(/\\n{2,}/)
        .map(block => '<p>' + escapeHtml(block).replace(/\\n/g, '<br>') + '</p>')
        .join('');
    }

    function sanitizeRenderedHtml(html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      template.content.querySelectorAll('script, style, form, button, textarea, select, option').forEach(el => el.remove());
      template.content.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          if (name.startsWith('on') || name === 'style' || ((name === 'href' || name === 'src') && /^javascript:/i.test(value))) {
            el.removeAttribute(attr.name);
          }
        });
      });
      return template.innerHTML;
    }

    function enhanceArticle(body, baseUrl, title) {
      removeDuplicateTitle(body, title);
      normalizeLinks(body, baseUrl);
      enhanceStandaloneMediaLinks(body, baseUrl);
      normalizeImages(body, baseUrl);
      wrapTables(body);
      enhanceCodeBlocks(body);
      hardenTaskLists(body);
      addHeadingAnchors(body);
      updateReadingTime(body);
      renderMermaid(body);
    }

    function removeDuplicateTitle(body, title) {
      const first = Array.from(body.children).find(el => el.textContent.trim());
      if (!first || !/^H[12]$/.test(first.tagName)) return;
      if (normalizeText(first.textContent) === normalizeText(title)) first.remove();
    }

    function normalizeLinks(root, baseUrl) {
      root.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) return;
        const resolved = resolveUrl(href, baseUrl);
        if (!isSafeLink(resolved)) {
          link.removeAttribute('href');
          return;
        }
        link.href = resolved;
        if (/^https?:/i.test(resolved)) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      });
    }

    function normalizeImages(root, baseUrl) {
      root.querySelectorAll('img').forEach(img => {
        const src = resolveUrl(img.getAttribute('src') || '', baseUrl);
        if (!isSafeMediaUrl(src)) {
          img.remove();
          return;
        }
        img.src = src;
        img.loading = 'lazy';
        img.decoding = 'async';
        if (!img.hasAttribute('alt')) img.alt = '';

        const parent = img.parentElement;
        if (parent && parent.tagName === 'P' && isOnlyMeaningfulChild(parent, img)) {
          const figure = makeFigure(img, img.alt);
          parent.replaceWith(figure);
        }
      });
    }

    function enhanceStandaloneMediaLinks(root, baseUrl) {
      Array.from(root.querySelectorAll('a[href]')).forEach(link => {
        const parent = link.parentElement;
        if (!parent || parent.tagName !== 'P' || !isOnlyMeaningfulChild(parent, link)) return;
        const media = createMediaFromUrl(link.href, link.textContent.trim(), baseUrl);
        if (media) parent.replaceWith(media);
      });
    }

    function createMediaFromUrl(href, label, baseUrl) {
      const url = resolveUrl(href, baseUrl);
      if (!isSafeMediaUrl(url)) return null;

      const youtubeId = getYoutubeId(url);
      if (youtubeId) {
        return makeFrame('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(youtubeId), label || 'YouTube video', '');
      }

      const vimeoId = getVimeoId(url);
      if (vimeoId) {
        return makeFrame('https://player.vimeo.com/video/' + encodeURIComponent(vimeoId), label || 'Vimeo video', '');
      }

      if (isImageUrl(url)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = label || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        return makeFigure(img, label);
      }

      if (isVideoUrl(url)) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        return makeFigure(video, label);
      }

      if (isAudioUrl(url)) {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.preload = 'metadata';
        return makeFigure(audio, label);
      }

      if (isPdfUrl(url)) {
        return makeFrame(url, label || 'PDF document', 'pdf');
      }

      return null;
    }

    function makeFrame(src, title, variant) {
      const figure = document.createElement('figure');
      figure.className = 'media-embed' + (variant ? ' ' + variant : '');
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = title;
      iframe.loading = 'lazy';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      figure.appendChild(iframe);
      if (title) {
        const caption = document.createElement('figcaption');
        caption.textContent = title;
        figure.appendChild(caption);
      }
      return figure;
    }

    function makeFigure(element, captionText) {
      const figure = document.createElement('figure');
      figure.appendChild(element);
      const caption = cleanCaption(captionText);
      if (caption) {
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = caption;
        figure.appendChild(figcaption);
      }
      return figure;
    }

    function wrapTables(root) {
      root.querySelectorAll('table').forEach(table => {
        if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'table-scroll';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      });
    }

    function enhanceCodeBlocks(root) {
      root.querySelectorAll('pre > code').forEach(code => {
        const pre = code.parentElement;
        if (!pre || pre.parentElement?.classList.contains('code-block')) return;
        const lang = getCodeLanguage(code);

        if (lang === 'mermaid') {
          const diagram = document.createElement('div');
          diagram.className = 'mermaid';
          diagram.textContent = code.textContent || '';
          pre.replaceWith(diagram);
          return;
        }

        if (window.hljs) {
          try { window.hljs.highlightElement(code); } catch (e) { console.warn('Highlight failed:', e); }
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';
        if (lang) {
          const label = document.createElement('div');
          label.className = 'code-label';
          label.textContent = lang;
          wrapper.appendChild(label);
        }
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
      });
    }

    function hardenTaskLists(root) {
      root.querySelectorAll('li input[type="checkbox"]').forEach(input => {
        input.disabled = true;
        input.setAttribute('aria-label', input.checked ? 'Completed task' : 'Incomplete task');
        const li = input.closest('li');
        if (li) li.classList.add('task-list-item');
        const list = input.closest('ul, ol');
        if (list) list.classList.add('contains-task-list');
      });
      root.querySelectorAll('input:not([type="checkbox"])').forEach(input => input.remove());
    }

    function addHeadingAnchors(root) {
      const used = {};
      root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
        const base = slugify(heading.textContent || 'section') || 'section';
        used[base] = (used[base] || 0) + 1;
        heading.id = used[base] === 1 ? base : base + '-' + used[base];
        const anchor = document.createElement('a');
        anchor.className = 'heading-anchor';
        anchor.href = '#' + heading.id;
        anchor.setAttribute('aria-label', 'Link to section');
        anchor.textContent = '#';
        heading.appendChild(anchor);
      });
    }

    function updateReadingTime(root) {
      const target = document.getElementById('readingTime');
      if (!target) return;
      const words = (root.textContent || '').trim().split(/\\s+/).filter(Boolean).length;
      if (!words) {
        target.textContent = '';
        return;
      }
      target.textContent = Math.max(1, Math.round(words / 225)) + ' min read';
    }

    function renderMermaid(root) {
      if (!window.mermaid || !root.querySelector('.mermaid')) return;
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          themeVariables: {
            primaryColor: '#fabd2f',
            primaryTextColor: '#ebdbb2',
            primaryBorderColor: '#fabd2f',
            lineColor: '#ebdbb2',
            secondaryColor: '#3c3836',
            tertiaryColor: '#504945',
            background: '#282828',
            mainBkg: '#3c3836',
            secondBkg: '#504945',
            nodeBorder: '#fabd2f',
            clusterBkg: '#3c3836',
            clusterBorder: '#504945',
            titleColor: '#fabd2f',
            edgeLabelBackground: '#282828'
          },
          flowchart: {
            htmlLabels: true,
            curve: 'basis'
          }
        });
        const result = window.mermaid.run({ nodes: root.querySelectorAll('.mermaid') });
        if (result && typeof result.catch === 'function') {
          result.catch(e => console.warn('Mermaid render failed:', e));
        }
      } catch (e) {
        console.warn('Mermaid render failed:', e);
      }
    }

    function applyAnnotationHighlights() {
      const body = document.getElementById('articleBody');
      if (!body || !annotations.length) return;
      const usedRanges = [];
      const text = body.textContent || '';
      annotations
        .filter(a => a.selectedText)
        .slice()
        .sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0))
        .forEach(annotation => {
          const match = findAnnotationTextRange(text, annotation, usedRanges);
          if (!match) return;
          usedRanges.push(match);
          wrapTextRange(body, match.start, match.end, annotation.id);
        });
    }

    function findAnnotationTextRange(fullText, annotation, usedRanges) {
      const needle = annotation.selectedText;
      const preferred = Number.isFinite(annotation.startOffset) ? annotation.startOffset : -1;
      const candidates = [];

      function addCandidate(index) {
        if (index < 0) return;
        const range = { start: index, end: index + needle.length };
        if (!usedRanges.some(used => rangesOverlap(used, range))) candidates.push(range);
      }

      if (preferred >= 0 && fullText.slice(preferred, preferred + needle.length) === needle) {
        addCandidate(preferred);
      }

      let index = fullText.indexOf(needle, Math.max(0, preferred - 160));
      while (index !== -1) {
        addCandidate(index);
        index = fullText.indexOf(needle, index + Math.max(needle.length, 1));
      }

      if (!candidates.length) {
        const lowerText = fullText.toLowerCase();
        const lowerNeedle = needle.toLowerCase();
        index = lowerText.indexOf(lowerNeedle);
        while (index !== -1) {
          addCandidate(index);
          index = lowerText.indexOf(lowerNeedle, index + Math.max(lowerNeedle.length, 1));
        }
      }

      if (!candidates.length) return null;
      candidates.sort((a, b) => {
        if (preferred < 0) return a.start - b.start;
        return Math.abs(a.start - preferred) - Math.abs(b.start - preferred);
      });
      return candidates[0];
    }

    function wrapTextRange(root, start, end, annotationId) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest('script, style, pre, code, textarea')) return NodeFilter.FILTER_REJECT;
          return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const spans = [];
      let offset = 0;
      let node;
      while ((node = walker.nextNode())) {
        const length = node.textContent.length;
        const nodeStart = offset;
        const nodeEnd = offset + length;
        if (nodeEnd > start && nodeStart < end) {
          spans.push({
            node,
            start: Math.max(0, start - nodeStart),
            end: Math.min(length, end - nodeStart)
          });
        }
        offset = nodeEnd;
        if (offset >= end) break;
      }

      spans.reverse().forEach(span => {
        if (span.start >= span.end) return;
        const range = document.createRange();
        range.setStart(span.node, span.start);
        range.setEnd(span.node, span.end);
        const mark = document.createElement('mark');
        mark.className = 'annotation-highlight';
        mark.dataset.annotationId = annotationId;
        mark.onclick = () => scrollToAnnotationInPanel(annotationId);
        range.surroundContents(mark);
      });
    }

    function rangesOverlap(a, b) {
      return a.start < b.end && b.start < a.end;
    }

    function getTextOffset(root, range) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let node;
      while ((node = walker.nextNode())) {
        if (node === range.startContainer) return offset + range.startOffset;
        offset += node.textContent.length;
      }
      return Math.max(0, (root.textContent || '').indexOf(selectedText));
    }

    function isOnlyMeaningfulChild(parent, child) {
      return Array.from(parent.childNodes).every(node => {
        if (node === child) return true;
        return node.nodeType === Node.TEXT_NODE && !node.textContent.trim();
      });
    }

    function resolveUrl(value, baseUrl) {
      if (!value) return '';
      try {
        return new URL(value, baseUrl || window.location.href).href;
      } catch (_) {
        return value;
      }
    }

    function isSafeLink(value) {
      return /^(https?:|mailto:|tel:|#)/i.test(value);
    }

    function isSafeMediaUrl(value) {
      return /^(https?:|data:image\\/)/i.test(value);
    }

    function isImageUrl(value) {
      return /\\.(avif|gif|jpe?g|png|svg|webp)(\\?.*)?$/i.test(value);
    }

    function isVideoUrl(value) {
      return /\\.(mp4|m4v|mov|ogg|ogv|webm)(\\?.*)?$/i.test(value);
    }

    function isAudioUrl(value) {
      return /\\.(aac|flac|m4a|mp3|oga|ogg|opus|wav)(\\?.*)?$/i.test(value);
    }

    function isPdfUrl(value) {
      return /\\.pdf(\\?.*)?$/i.test(value);
    }

    function getYoutubeId(value) {
      try {
        const url = new URL(value);
        if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || '';
        if (!/(^|\\.)youtube\\.com$/i.test(url.hostname)) return '';
        if (url.pathname === '/watch') return url.searchParams.get('v') || '';
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'embed' || parts[0] === 'shorts') return parts[1] || '';
        return '';
      } catch (_) {
        return '';
      }
    }

    function getVimeoId(value) {
      try {
        const url = new URL(value);
        if (!/(^|\\.)vimeo\\.com$/i.test(url.hostname)) return '';
        const id = url.pathname.split('/').filter(part => /^\\d+$/.test(part)).pop();
        return id || '';
      } catch (_) {
        return '';
      }
    }

    function getCodeLanguage(code) {
      const match = Array.from(code.classList).map(name => name.match(/^language-(.+)$/)).find(Boolean);
      return match ? match[1] : '';
    }

    function cleanCaption(text) {
      const caption = (text || '').trim();
      if (!caption || /^(image|photo|graphic|video|audio|pdf)$/i.test(caption)) return '';
      return caption;
    }

    function getDomain(value) {
      try {
        return new URL(value).hostname.replace(/^www\\./, '');
      } catch (_) {
        return '';
      }
    }

    function deriveTitleFromMarkdown(markdown) {
      const match = (markdown || '').match(/^#\\s+(.+)$/m);
      return match ? match[1].trim() : '';
    }

    function normalizeText(value) {
      return (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    }

    function slugify(value) {
      return normalizeText(value)
        .replace(/[^a-z0-9\\s-]/g, '')
        .replace(/\\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
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
      const content = document.getElementById('articleBody');
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
      const content = document.getElementById('articleBody');
      const selection = window.getSelection();
      if (!selection || !selection.anchorNode || !selection.focusNode) return;
      const text = selection.toString().trim();

      if (text.length > 0) {
        if (!content || !content.contains(selection.anchorNode) || !content.contains(selection.focusNode)) return;
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
      const content = document.getElementById('articleBody');

      if (!content || !content.contains(rangeToHighlight.commonAncestorContainer)) {
        hideSelectionPopup();
        return;
      }
      const startOffset = getTextOffset(content, rangeToHighlight);
      const endOffset = startOffset + selectedText.length;

      try {
        const res = await fetch('/api/annotations/' + encodeURIComponent(bookmarkKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText,
            note,
            startOffset,
            endOffset
          })
        });

        const data = await res.json();
        if (data.annotation) {
          annotations.push(data.annotation);
          renderAnnotations();

          // Highlight the selected text with proper ID and click handler
          try {
            wrapTextRange(content, startOffset, endOffset, data.annotation.id);
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

        // Remove highlight mark from DOM
        const content = document.getElementById('articleBody');
        if (content) {
          const marks = content.querySelectorAll('[data-annotation-id="' + id + '"]');
          marks.forEach(mark => {
            while (mark.firstChild) {
              mark.parentNode.insertBefore(mark.firstChild, mark);
            }
            mark.remove();
          });
        }

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
      const content = document.getElementById('articleBody');
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

    function escapeAttribute(text) {
      return escapeHtml(text).replace(/"/g, '&quot;');
    }

    function loadPreferences() {
      try {
        const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        readerPrefs = {
          fontSize: clampNumber(saved.fontSize, 14, 22, 16),
          width: widthSteps.includes(saved.width) ? saved.width : '80ch'
        };
      } catch (_) {}
    }

    function savePreferences() {
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(readerPrefs));
      } catch (_) {}
    }

    function applyPreferences() {
      document.documentElement.style.setProperty('--reader-font-size', readerPrefs.fontSize + 'px');
      document.documentElement.style.setProperty('--content-width', readerPrefs.width);
      const widthBtn = document.getElementById('widthBtn');
      if (widthBtn) widthBtn.title = 'Line width ' + readerPrefs.width;
    }

    function clampNumber(value, min, max, fallback) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.min(max, Math.max(min, numeric));
    }

    function adjustFontSize(delta) {
      readerPrefs.fontSize = clampNumber(readerPrefs.fontSize + delta, 14, 22, 16);
      applyPreferences();
      savePreferences();
    }

    function cycleWidth() {
      const current = widthSteps.indexOf(readerPrefs.width);
      readerPrefs.width = widthSteps[(current + 1) % widthSteps.length];
      applyPreferences();
      savePreferences();
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

    document.getElementById('openUrlBtn').addEventListener('click', () => {
      if (bookmarkUrl) window.open(bookmarkUrl, '_blank');
    });
    document.getElementById('readBtn').addEventListener('click', toggleReadStatus);
    document.getElementById('favBtn').addEventListener('click', toggleFavouriteStatus);
    document.getElementById('fontDownBtn').addEventListener('click', () => adjustFontSize(-1));
    document.getElementById('fontUpBtn').addEventListener('click', () => adjustFontSize(1));
    document.getElementById('widthBtn').addEventListener('click', cycleWidth);

    loadPreferences();
    applyPreferences();
    loadContent();
  </script>
</body>
</html>`;
}
