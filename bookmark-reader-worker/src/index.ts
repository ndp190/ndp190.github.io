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
import type { Env, ReadingProgress, ReaderConfig, ReaderFontStyle, ReaderTheme, ReaderWidth, Annotation, AnnotationList, StoredBookmark, BookmarkEntry, BookmarkManifest } from './types';
import { backfillBookmarkedArticleImages, normalizeArticleImages } from './imageProcessing';
import { BOOKMARK_READER_PNG_ICONS } from './icons';
import {
  deleteKnowledgeDocumentForKey,
  getKnowledgeIndexStatus,
  rebuildKnowledgeIndex,
  refreshKnowledgeDocument,
  refreshKnowledgeDocumentForKey,
  searchKnowledgeAnnotations,
  searchKnowledgeDocuments,
} from './knowledge';

const MANIFEST_KEY = 'bookmark/manifest.json';
const READER_CONFIG_KEY = '__reader_config_v1__';
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/scrape';

const READER_THEMES: ReaderTheme[] = [
  'gruvbox-dark',
  'solarized-light',
  'solarized-dark',
  'dracula',
  'nord',
  'tokyo-night',
  'catppuccin-latte',
  'catppuccin-mocha',
];
const READER_FONT_STYLES: ReaderFontStyle[] = [
  'source-serif',
  'merriweather',
  'literata',
  'inter',
  'atkinson',
  'jetbrains-mono',
  'ibm-plex-mono',
  'system-serif',
  'system-sans',
  'system-mono',
];
const READER_WIDTHS: ReaderWidth[] = ['72ch', '80ch', '92ch', '104ch'];

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

    if (request.method === 'GET' && path === '/knowledge') {
      return new Response(getKnowledgePageHtml(), {
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

function getDefaultReaderConfig(updatedAt = ''): ReaderConfig {
  return {
    theme: 'gruvbox-dark',
    fontStyle: 'jetbrains-mono',
    fontSize: 16,
    readerWidth: '80ch',
    updatedAt,
  };
}

function normalizeReaderConfig(value: unknown, updatedAtOverride?: string): ReaderConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const defaults = getDefaultReaderConfig();
  const theme = typeof source.theme === 'string' && READER_THEMES.includes(source.theme as ReaderTheme)
    ? source.theme as ReaderTheme
    : defaults.theme;
  const fontStyle = typeof source.fontStyle === 'string' && READER_FONT_STYLES.includes(source.fontStyle as ReaderFontStyle)
    ? source.fontStyle as ReaderFontStyle
    : defaults.fontStyle;
  const readerWidth = typeof source.readerWidth === 'string' && READER_WIDTHS.includes(source.readerWidth as ReaderWidth)
    ? source.readerWidth as ReaderWidth
    : typeof source.width === 'string' && READER_WIDTHS.includes(source.width as ReaderWidth)
      ? source.width as ReaderWidth
      : defaults.readerWidth;
  const updatedAt = updatedAtOverride
    ?? (typeof source.updatedAt === 'string' ? source.updatedAt : defaults.updatedAt);

  return {
    theme,
    fontStyle,
    fontSize: clampReaderNumber(source.fontSize, 14, 22, defaults.fontSize),
    readerWidth,
    updatedAt,
  };
}

function clampReaderNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

async function getReaderConfig(env: Env): Promise<ReaderConfig> {
  const saved = await env.NIKK_BOOKMARK_PROGRESS.get(READER_CONFIG_KEY);
  if (!saved) return getDefaultReaderConfig();

  try {
    return normalizeReaderConfig(JSON.parse(saved));
  } catch (_) {
    return getDefaultReaderConfig();
  }
}

async function handleApiRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/knowledge/search' && request.method === 'GET') {
    try {
      return jsonResponse(await searchKnowledgeDocuments(env, new URL(request.url).searchParams));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  if (path === '/api/knowledge/annotations' && request.method === 'GET') {
    try {
      return jsonResponse(await searchKnowledgeAnnotations(env, new URL(request.url).searchParams));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  if (path === '/api/knowledge/status' && request.method === 'GET') {
    try {
      return jsonResponse(await getKnowledgeIndexStatus(env));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  if (path === '/api/knowledge/rebuild' && request.method === 'POST') {
    try {
      const index = await rebuildKnowledgeIndex(env);
      if (!index) {
        return jsonResponse({ error: 'Manifest not found' }, 404);
      }
      return jsonResponse({ success: true, index });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

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

  // GET /api/config - get global reader preferences
  if (path === '/api/config' && request.method === 'GET') {
    try {
      const config = await getReaderConfig(env);
      return jsonResponse({ config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 500);
    }
  }

  // POST /api/config - save global reader preferences
  if (path === '/api/config' && request.method === 'POST') {
    try {
      const body = await request.json();
      const config = normalizeReaderConfig(body, new Date().toISOString());
      await env.NIKK_BOOKMARK_PROGRESS.put(READER_CONFIG_KEY, JSON.stringify(config));
      return jsonResponse({ success: true, config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return jsonResponse({ error: message }, 400);
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
      await refreshKnowledgeDocument(env, newEntry, storedBookmark);

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
      await refreshKnowledgeDocumentForKey(env, key).catch(() => undefined);

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
      await refreshKnowledgeDocumentForKey(env, key).catch(() => undefined);

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

      // 6. Delete private knowledge document from R2
      await deleteKnowledgeDocumentForKey(env, key);

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
      || url.pathname === '/api/config'
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
    .page-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .knowledge-link {
      padding: 0.5rem 1rem;
      color: #83a598;
      border: 2px solid #504945;
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .knowledge-link:hover { border-color: #83a598; color: #b8d2c9; }
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
      <div class="page-actions">
        <a class="knowledge-link" href="/knowledge">Knowledge</a>
        <button class="sync-btn" id="syncBtn" title="Sync to R2 for terminal site">
          <svg class="sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          <span class="sync-text">Sync</span>
        </button>
      </div>
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

function getKnowledgePageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge - Bookmark Reader</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2383a598'><path d='M4 4h16v3H4zm0 6h10v3H4zm0 6h16v3H4z'/></svg>">
  ${getPwaHeadTags()}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap&subset=vietnamese" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      color-scheme: dark;
      --bg: #282828;
      --surface: #34302f;
      --surface-2: #3c3836;
      --line: #504945;
      --ink: #ebdbb2;
      --soft: #d5c4a1;
      --muted: #928374;
      --yellow: #fabd2f;
      --aqua: #83a598;
      --green: #b8bb26;
      --red: #fb4934;
      --blue: #458588;
    }
    body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      font-weight: 500;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      padding: clamp(1rem, 3vw, 2rem);
    }
    a { color: inherit; }
    button, input {
      font: inherit;
    }
    .knowledge-shell {
      width: min(1180px, 100%);
      margin: 0 auto;
      display: grid;
      grid-template-columns: 250px minmax(0, 1fr);
      gap: clamp(1rem, 2vw, 1.5rem);
      align-items: start;
    }
    .rail {
      position: sticky;
      top: 1rem;
      border-left: 3px solid var(--aqua);
      padding-left: 1rem;
      min-width: 0;
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .back-link {
      color: var(--aqua);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 700;
    }
    h1 {
      color: var(--yellow);
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.1;
      margin-bottom: 0.5rem;
    }
    .lede {
      color: var(--soft);
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
    }
    .status {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0.8rem;
      margin-bottom: 1rem;
      background: var(--surface);
      color: var(--muted);
      font-size: 0.78rem;
    }
    .status strong {
      display: block;
      color: var(--ink);
      font-size: 0.92rem;
      margin-bottom: 0.25rem;
    }
    .rebuild-btn {
      width: 100%;
      min-height: 42px;
      border: 2px solid var(--aqua);
      border-radius: 6px;
      background: transparent;
      color: var(--aqua);
      cursor: pointer;
      font-weight: 700;
      transition: background 0.2s, color 0.2s, opacity 0.2s;
      margin-bottom: 1.25rem;
    }
    .rebuild-btn:hover {
      background: var(--aqua);
      color: var(--bg);
    }
    .rebuild-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .mode-tabs, .filters {
      display: grid;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }
    .mode-tabs {
      grid-template-columns: 1fr 1fr;
    }
    .filters {
      grid-template-columns: 1fr;
    }
    .mode-btn, .filter-btn {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--soft);
      cursor: pointer;
      text-align: left;
      padding: 0 0.75rem;
      transition: border-color 0.2s, color 0.2s, background 0.2s;
    }
    .mode-btn {
      text-align: center;
    }
    .mode-btn:hover, .filter-btn:hover {
      border-color: var(--aqua);
      color: var(--ink);
    }
    .mode-btn.active, .filter-btn.active {
      background: var(--yellow);
      border-color: var(--yellow);
      color: var(--bg);
      font-weight: 700;
    }
    .main {
      min-width: 0;
    }
    .search-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .search-input {
      width: 100%;
      min-height: 52px;
      border: 2px solid var(--line);
      border-radius: 8px;
      background: var(--surface-2);
      color: var(--ink);
      padding: 0 1rem;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--aqua);
    }
    .search-btn {
      min-width: 118px;
      border: none;
      border-radius: 8px;
      background: var(--aqua);
      color: var(--bg);
      font-weight: 800;
      cursor: pointer;
    }
    .summary-line {
      min-height: 28px;
      color: var(--muted);
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .result-list {
      display: grid;
      gap: 0.85rem;
    }
    .result-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 1rem;
    }
    .result-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 0.65rem;
    }
    .result-title {
      color: var(--yellow);
      font-weight: 800;
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    .result-title:hover {
      text-decoration: underline;
    }
    .score {
      color: var(--muted);
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .snippet {
      color: var(--soft);
      font-size: 0.9rem;
      margin-bottom: 0.85rem;
      overflow-wrap: anywhere;
    }
    mark {
      background: rgba(250, 189, 47, 0.24);
      color: var(--yellow);
      border-bottom: 1px solid var(--yellow);
      padding: 0 0.08rem;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: center;
      color: var(--muted);
      font-size: 0.78rem;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.15rem 0.45rem;
    }
    .pill.green { color: var(--green); border-color: rgba(184, 187, 38, 0.45); }
    .pill.aqua { color: var(--aqua); border-color: rgba(131, 165, 152, 0.45); }
    .source-link {
      color: var(--aqua);
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    .source-link:hover { text-decoration: underline; }
    .empty, .error {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 2rem;
      background: var(--surface);
      color: var(--muted);
      text-align: center;
    }
    .error {
      color: var(--red);
      border-color: rgba(251, 73, 52, 0.65);
    }
    @media (max-width: 760px) {
      body { padding: 1rem; }
      .knowledge-shell {
        grid-template-columns: 1fr;
      }
      .rail {
        position: static;
        border-left: 0;
        border-top: 3px solid var(--aqua);
        padding-left: 0;
        padding-top: 1rem;
      }
      .filters {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .search-bar {
        grid-template-columns: 1fr;
      }
      .search-btn {
        min-height: 46px;
      }
      .result-head {
        display: block;
      }
      .score {
        display: block;
        margin-top: 0.35rem;
      }
    }
  </style>
</head>
<body>
  <main class="knowledge-shell">
    <aside class="rail">
      <div class="brand-row">
        <a class="back-link" href="/">&larr; Reader</a>
      </div>
      <h1>Knowledge</h1>
      <p class="lede">Search saved articles, notes, read state, and favourites.</p>
      <div class="status" id="indexStatus"><strong>Index</strong><span>Checking...</span></div>
      <button class="rebuild-btn" id="rebuildBtn">Rebuild index</button>
      <div class="mode-tabs" aria-label="Knowledge mode">
        <button class="mode-btn active" data-mode="search">Search</button>
        <button class="mode-btn" data-mode="notes">Notes</button>
      </div>
      <div class="filters" id="filters" aria-label="Search filters">
        <button class="filter-btn active" data-state="all">All</button>
        <button class="filter-btn" data-state="unread">Unread</button>
        <button class="filter-btn" data-state="read">Read</button>
        <button class="filter-btn" data-state="favourites">Favourites</button>
        <button class="filter-btn" data-state="annotated">Annotated</button>
      </div>
    </aside>
    <section class="main">
      <form class="search-bar" id="searchForm">
        <input class="search-input" id="searchInput" type="search" autocomplete="off" placeholder="Search saved articles" autofocus>
        <button class="search-btn" type="submit">Search</button>
      </form>
      <div class="summary-line" id="summaryLine">Ready.</div>
      <div class="result-list" id="results"></div>
    </section>
  </main>

  <script>
    const searchInput = document.getElementById('searchInput');
    const searchForm = document.getElementById('searchForm');
    const summaryLine = document.getElementById('summaryLine');
    const results = document.getElementById('results');
    const rebuildBtn = document.getElementById('rebuildBtn');
    const indexStatus = document.getElementById('indexStatus');
    const filters = document.getElementById('filters');
    let activeMode = 'search';
    let activeState = 'all';
    let requestId = 0;
    let debounceTimer = 0;

    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function statusPills(item) {
      const pills = [];
      pills.push('<span class="pill">' + (item.isRead ? 'Read' : 'Unread') + '</span>');
      if (item.isFavourite) pills.push('<span class="pill green">Favourite</span>');
      if (item.annotationCount || item.note) {
        const count = item.annotationCount ? item.annotationCount + ' notes' : 'Note';
        pills.push('<span class="pill aqua">' + escapeHtml(count) + '</span>');
      }
      return pills.join('');
    }

    function renderSearch(data) {
      summaryLine.textContent = data.count + ' bookmark' + (data.count === 1 ? '' : 's');
      if (!data.results.length) {
        results.innerHTML = '<div class="empty">No matching bookmarks.</div>';
        return;
      }

      results.innerHTML = data.results.map(function(item) {
        const score = item.score ? 'score ' + item.score : 'indexed';
        const snippetHtml = item.snippet && item.snippet.html ? item.snippet.html : escapeHtml(item.description || item.url);
        return '<article class="result-row">' +
          '<div class="result-head">' +
            '<a class="result-title" href="' + escapeHtml(item.readUrl) + '">' + escapeHtml(item.title) + '</a>' +
            '<span class="score">' + escapeHtml(score) + '</span>' +
          '</div>' +
          '<div class="snippet">' + snippetHtml + '</div>' +
          '<div class="meta-row">' +
            statusPills(item) +
            '<a class="source-link" href="' + escapeHtml(item.sourceUrl || item.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.url) + '</a>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    function renderNotes(data) {
      summaryLine.textContent = data.count + ' note' + (data.count === 1 ? '' : 's');
      if (!data.annotations.length) {
        results.innerHTML = '<div class="empty">No matching notes.</div>';
        return;
      }

      results.innerHTML = data.annotations.map(function(item) {
        const noteText = item.note ? '<div class="snippet">' + escapeHtml(item.note) + '</div>' : '';
        const snippetHtml = item.snippet && item.snippet.html ? item.snippet.html : escapeHtml(item.selectedText || item.title);
        return '<article class="result-row">' +
          '<div class="result-head">' +
            '<a class="result-title" href="' + escapeHtml(item.readUrl) + '">' + escapeHtml(item.title) + '</a>' +
            '<span class="score">' + escapeHtml(new Date(item.createdAt).toLocaleDateString()) + '</span>' +
          '</div>' +
          '<div class="snippet">' + snippetHtml + '</div>' +
          noteText +
          '<div class="meta-row">' +
            statusPills({ isRead: item.isRead, isFavourite: item.isFavourite, note: true }) +
            '<a class="source-link" href="' + escapeHtml(item.sourceUrl || item.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.url) + '</a>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    async function loadStatus() {
      try {
        const response = await fetch('/api/knowledge/status');
        const data = await response.json();
        if (data.status === 'ready' && data.index) {
          indexStatus.innerHTML = '<strong>Index</strong><span>' + data.index.indexedCount + '/' + data.index.bookmarkCount + ' bookmarks &middot; ' + new Date(data.index.builtAt).toLocaleString() + '</span>';
        } else {
          indexStatus.innerHTML = '<strong>Index</strong><span>Missing</span>';
        }
      } catch (error) {
        indexStatus.innerHTML = '<strong>Index</strong><span>Unavailable</span>';
      }
    }

    async function runQuery() {
      const id = ++requestId;
      const params = new URLSearchParams();
      const query = searchInput.value.trim();
      if (query) params.set('q', query);
      params.set('limit', '50');
      if (activeMode === 'search') params.set('state', activeState);

      summaryLine.textContent = 'Searching...';
      const endpoint = activeMode === 'notes' ? '/api/knowledge/annotations' : '/api/knowledge/search';

      try {
        const response = await fetch(endpoint + '?' + params.toString());
        const data = await response.json();
        if (id !== requestId) return;
        if (!response.ok || data.error) throw new Error(data.error || 'Search failed');
        if (activeMode === 'notes') {
          renderNotes(data);
        } else {
          renderSearch(data);
        }
      } catch (error) {
        if (id !== requestId) return;
        summaryLine.textContent = 'Failed';
        results.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      }
    }

    function scheduleQuery() {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runQuery, 180);
    }

    async function rebuildIndex() {
      rebuildBtn.disabled = true;
      rebuildBtn.textContent = 'Rebuilding...';
      try {
        const response = await fetch('/api/knowledge/rebuild', { method: 'POST' });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Rebuild failed');
        await loadStatus();
        await runQuery();
      } catch (error) {
        results.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      } finally {
        rebuildBtn.disabled = false;
        rebuildBtn.textContent = 'Rebuild index';
      }
    }

    document.querySelectorAll('.mode-btn').forEach(function(button) {
      button.addEventListener('click', function() {
        activeMode = button.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(function(item) {
          item.classList.toggle('active', item === button);
        });
        filters.style.display = activeMode === 'search' ? 'grid' : 'none';
        searchInput.placeholder = activeMode === 'search' ? 'Search saved articles' : 'Search notes';
        runQuery();
      });
    });

    document.querySelectorAll('.filter-btn').forEach(function(button) {
      button.addEventListener('click', function() {
        activeState = button.dataset.state || 'all';
        document.querySelectorAll('.filter-btn').forEach(function(item) {
          item.classList.toggle('active', item === button);
        });
        runQuery();
      });
    });

    searchForm.addEventListener('submit', function(event) {
      event.preventDefault();
      runQuery();
    });
    searchInput.addEventListener('input', scheduleQuery);
    rebuildBtn.addEventListener('click', rebuildIndex);

    loadStatus();
    runQuery();
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
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700&family=Merriweather:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&display=swap&subset=vietnamese" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script>
    (function () {
      try {
        const prefs = JSON.parse(localStorage.getItem('bookmark-reader-preferences') || '{}');
        if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
        if (prefs.fontStyle) document.documentElement.dataset.fontStyle = prefs.fontStyle;
        if (prefs.readerWidth || prefs.width) document.documentElement.style.setProperty('--content-width', prefs.readerWidth || prefs.width);
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
      --ui-font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      --mono-font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      --reader-font-family: var(--mono-font-family);
      --content-width: 80ch;
      --reader-font-size: 1rem;
      --topbar-height: 64px;
    }
    html[data-theme="gruvbox-dark"] {
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
    html[data-theme="solarized-light"] {
      color-scheme: light;
      --bg: #fdf6e3;
      --surface: #eee8d5;
      --surface-muted: #e1d8bd;
      --ink: #073642;
      --ink-soft: #586e75;
      --muted: #657b83;
      --line: #d6cbb0;
      --accent: #b58900;
      --accent-strong: #cb4b16;
      --accent-2: #268bd2;
      --mark: rgba(42, 161, 152, 0.28);
      --danger: #dc322f;
      --code-bg: rgba(101, 123, 131, 0.13);
      --code-ink: #073642;
      --shadow: 0 18px 42px rgba(7, 54, 66, 0.16);
    }
    html[data-theme="solarized-dark"] {
      color-scheme: dark;
      --bg: #002b36;
      --surface: #073642;
      --surface-muted: #0f3a45;
      --ink: #eee8d5;
      --ink-soft: #93a1a1;
      --muted: #839496;
      --line: #164650;
      --accent: #b58900;
      --accent-strong: #cb4b16;
      --accent-2: #2aa198;
      --mark: rgba(42, 161, 152, 0.34);
      --danger: #dc322f;
      --code-bg: rgba(101, 123, 131, 0.14);
      --code-ink: #eee8d5;
      --shadow: 0 18px 42px rgba(0, 20, 26, 0.34);
    }
    html[data-theme="dracula"] {
      color-scheme: dark;
      --bg: #282a36;
      --surface: #343746;
      --surface-muted: #44475a;
      --ink: #f8f8f2;
      --ink-soft: #e6e6f0;
      --muted: #a4a7c0;
      --line: #44475a;
      --accent: #bd93f9;
      --accent-strong: #ff79c6;
      --accent-2: #8be9fd;
      --mark: rgba(80, 250, 123, 0.26);
      --danger: #ff5555;
      --code-bg: rgba(68, 71, 90, 0.55);
      --code-ink: #f8f8f2;
      --shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
    }
    html[data-theme="nord"] {
      color-scheme: dark;
      --bg: #2e3440;
      --surface: #3b4252;
      --surface-muted: #434c5e;
      --ink: #eceff4;
      --ink-soft: #d8dee9;
      --muted: #aeb9ca;
      --line: #4c566a;
      --accent: #88c0d0;
      --accent-strong: #b48ead;
      --accent-2: #a3be8c;
      --mark: rgba(163, 190, 140, 0.3);
      --danger: #bf616a;
      --code-bg: rgba(76, 86, 106, 0.4);
      --code-ink: #eceff4;
      --shadow: 0 18px 42px rgba(17, 24, 39, 0.3);
    }
    html[data-theme="tokyo-night"] {
      color-scheme: dark;
      --bg: #1a1b26;
      --surface: #24283b;
      --surface-muted: #2f3549;
      --ink: #c0caf5;
      --ink-soft: #a9b1d6;
      --muted: #787c99;
      --line: #414868;
      --accent: #7aa2f7;
      --accent-strong: #bb9af7;
      --accent-2: #2ac3de;
      --mark: rgba(42, 195, 222, 0.28);
      --danger: #f7768e;
      --code-bg: rgba(65, 72, 104, 0.38);
      --code-ink: #c0caf5;
      --shadow: 0 18px 42px rgba(5, 8, 20, 0.4);
    }
    html[data-theme="catppuccin-latte"] {
      color-scheme: light;
      --bg: #eff1f5;
      --surface: #e6e9ef;
      --surface-muted: #dce0e8;
      --ink: #4c4f69;
      --ink-soft: #5c5f77;
      --muted: #6c6f85;
      --line: #ccd0da;
      --accent: #8839ef;
      --accent-strong: #d20f39;
      --accent-2: #1e66f5;
      --mark: rgba(64, 160, 43, 0.24);
      --danger: #d20f39;
      --code-bg: rgba(204, 208, 218, 0.45);
      --code-ink: #4c4f69;
      --shadow: 0 18px 42px rgba(76, 79, 105, 0.16);
    }
    html[data-theme="catppuccin-mocha"] {
      color-scheme: dark;
      --bg: #1e1e2e;
      --surface: #313244;
      --surface-muted: #45475a;
      --ink: #cdd6f4;
      --ink-soft: #bac2de;
      --muted: #9399b2;
      --line: #585b70;
      --accent: #cba6f7;
      --accent-strong: #f38ba8;
      --accent-2: #89b4fa;
      --mark: rgba(166, 227, 161, 0.26);
      --danger: #f38ba8;
      --code-bg: rgba(69, 71, 90, 0.44);
      --code-ink: #cdd6f4;
      --shadow: 0 18px 42px rgba(12, 12, 22, 0.42);
    }
    html[data-font-style="source-serif"] { --reader-font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; }
    html[data-font-style="merriweather"] { --reader-font-family: 'Merriweather', Georgia, 'Times New Roman', serif; }
    html[data-font-style="literata"] { --reader-font-family: 'Literata', Georgia, 'Times New Roman', serif; }
    html[data-font-style="inter"] { --reader-font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    html[data-font-style="atkinson"] { --reader-font-family: 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    html[data-font-style="jetbrains-mono"] { --reader-font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', Menlo, monospace; }
    html[data-font-style="ibm-plex-mono"] { --reader-font-family: 'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', Menlo, monospace; }
    html[data-font-style="system-serif"] { --reader-font-family: Georgia, Cambria, 'Times New Roman', Times, serif; }
    html[data-font-style="system-sans"] { --reader-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    html[data-font-style="system-mono"] { --reader-font-family: 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', monospace; }
    html, body {
      overflow-x: hidden;
      max-width: 100vw;
      scroll-behavior: smooth;
    }
    body {
      font-family: var(--ui-font-family);
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
    .header-btn:focus-visible,
    .setting-btn:focus-visible,
    .back-btn:focus-visible,
    .annotation-toggle:focus-visible,
    .reader-config-toggle:focus-visible,
    .reader-config-close:focus-visible,
    .theme-option:focus-visible,
    .font-option:focus-visible,
    .config-step-btn:focus-visible {
      outline: 3px solid var(--accent);
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
      font-family: var(--reader-font-family);
    }
    .article-header {
      margin: 0.5rem auto 1.25rem;
      max-width: var(--content-width);
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
      max-width: var(--content-width);
      font-family: var(--reader-font-family);
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
      font-family: var(--mono-font-family);
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
      font-family: var(--mono-font-family);
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

    /* Reader settings */
    .reader-config-toggle {
      position: fixed;
      right: 1rem;
      bottom: 4.75rem;
      width: 48px;
      height: 48px;
      background: var(--surface);
      color: var(--accent);
      border: 1px solid var(--line);
      border-radius: 50%;
      cursor: pointer;
      font-family: var(--ui-font-family);
      font-size: 1rem;
      font-weight: 800;
      z-index: 101;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow);
    }
    .reader-config-toggle:hover,
    .reader-config-toggle.active {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--surface);
    }
    .reader-config-panel {
      position: fixed;
      right: 0;
      top: var(--topbar-height);
      bottom: 0;
      width: min(420px, 94vw);
      background: var(--surface);
      border-left: 1px solid var(--line);
      padding: 1rem;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s;
      z-index: 100;
      box-shadow: -18px 0 38px rgba(0, 0, 0, 0.16);
    }
    .reader-config-panel.open { transform: translateX(0); }
    .reader-config-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .reader-config-head h3 {
      color: var(--ink);
      font-size: 1rem;
      line-height: 1.2;
      margin: 0;
    }
    .reader-config-close {
      width: 32px;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-family: var(--ui-font-family);
      font-size: 1rem;
      font-weight: 800;
    }
    .reader-config-close:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--surface-muted);
    }
    .config-section {
      padding: 0.85rem 0;
      border-top: 1px solid var(--line);
    }
    .config-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      color: var(--ink-soft);
      font-size: 0.82rem;
      font-weight: 800;
      margin-bottom: 0.65rem;
    }
    .config-value {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 700;
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
    }
    .theme-option,
    .font-option {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(146, 131, 116, 0.08);
      color: var(--ink);
      cursor: pointer;
      font-family: var(--ui-font-family);
      text-align: left;
      transition: border-color 0.2s, background 0.2s, color 0.2s;
    }
    .theme-option {
      min-height: 54px;
      padding: 0.55rem;
      display: grid;
      grid-template-columns: 42px 1fr;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.78rem;
      font-weight: 800;
    }
    .theme-option:hover,
    .theme-option.active,
    .font-option:hover,
    .font-option.active {
      border-color: var(--accent);
      background: var(--surface-muted);
      color: var(--accent);
    }
    .theme-swatch {
      width: 42px;
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 5px;
      overflow: hidden;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
    }
    .theme-swatch span { display: block; }
    .font-groups {
      display: grid;
      gap: 0.7rem;
    }
    .font-group {
      display: grid;
      gap: 0.4rem;
    }
    .font-group-label {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
    }
    .font-options {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.45rem;
    }
    .font-option {
      min-height: 38px;
      padding: 0.45rem 0.55rem;
      font-size: 0.78rem;
      font-weight: 800;
    }
    .font-option[data-font-option="source-serif"] { font-family: 'Source Serif 4', Georgia, serif; }
    .font-option[data-font-option="merriweather"] { font-family: 'Merriweather', Georgia, serif; }
    .font-option[data-font-option="literata"] { font-family: 'Literata', Georgia, serif; }
    .font-option[data-font-option="inter"] { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    .font-option[data-font-option="atkinson"] { font-family: 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif; }
    .font-option[data-font-option="jetbrains-mono"] { font-family: 'JetBrains Mono', monospace; }
    .font-option[data-font-option="ibm-plex-mono"] { font-family: 'IBM Plex Mono', monospace; }
    .font-option[data-font-option^="system-"] { font-family: var(--ui-font-family); }
    .config-stepper {
      display: grid;
      grid-template-columns: 42px 1fr 42px;
      align-items: center;
      gap: 0.5rem;
    }
    .config-step-btn {
      width: 42px;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(146, 131, 116, 0.08);
      color: var(--ink);
      cursor: pointer;
      font-family: var(--ui-font-family);
      font-size: 1rem;
      font-weight: 800;
    }
    .config-step-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--surface-muted);
    }
    .config-step-value {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ink);
      font-size: 0.82rem;
      font-weight: 800;
      background: rgba(146, 131, 116, 0.08);
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

  <button class="reader-config-toggle" id="readerConfigToggle" title="Reader settings" aria-label="Reader settings" aria-expanded="false" aria-controls="readerConfigPanel">Aa</button>

  <button class="annotation-toggle" id="annotationToggle" title="Annotations">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  </button>

  <div class="reader-config-panel" id="readerConfigPanel" aria-label="Reader settings">
    <div class="reader-config-head">
      <h3>Reader settings</h3>
      <button class="reader-config-close" id="readerConfigClose" title="Close reader settings" aria-label="Close reader settings">x</button>
    </div>

    <section class="config-section">
      <div class="config-label">
        <span>Color theme</span>
        <span class="config-value" id="themeValue">Gruvbox</span>
      </div>
      <div class="theme-grid" id="themeOptions">
        <button class="theme-option" data-theme-option="gruvbox-dark" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#282828"></span><span style="background:#fabd2f"></span><span style="background:#83a598"></span></span>
          <span>Gruvbox</span>
        </button>
        <button class="theme-option" data-theme-option="solarized-light" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#fdf6e3"></span><span style="background:#b58900"></span><span style="background:#268bd2"></span></span>
          <span>Solarized light</span>
        </button>
        <button class="theme-option" data-theme-option="solarized-dark" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#002b36"></span><span style="background:#b58900"></span><span style="background:#2aa198"></span></span>
          <span>Solarized dark</span>
        </button>
        <button class="theme-option" data-theme-option="dracula" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#282a36"></span><span style="background:#bd93f9"></span><span style="background:#ff79c6"></span></span>
          <span>Dracula</span>
        </button>
        <button class="theme-option" data-theme-option="nord" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#2e3440"></span><span style="background:#88c0d0"></span><span style="background:#a3be8c"></span></span>
          <span>Nord</span>
        </button>
        <button class="theme-option" data-theme-option="tokyo-night" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#1a1b26"></span><span style="background:#7aa2f7"></span><span style="background:#bb9af7"></span></span>
          <span>Tokyo Night</span>
        </button>
        <button class="theme-option" data-theme-option="catppuccin-latte" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#eff1f5"></span><span style="background:#8839ef"></span><span style="background:#1e66f5"></span></span>
          <span>Catppuccin latte</span>
        </button>
        <button class="theme-option" data-theme-option="catppuccin-mocha" aria-pressed="false">
          <span class="theme-swatch"><span style="background:#1e1e2e"></span><span style="background:#cba6f7"></span><span style="background:#89b4fa"></span></span>
          <span>Catppuccin mocha</span>
        </button>
      </div>
    </section>

    <section class="config-section">
      <div class="config-label">
        <span>Typeface</span>
        <span class="config-value" id="fontValue">JetBrains Mono</span>
      </div>
      <div class="font-groups" id="fontOptions">
        <div class="font-group" data-font-group="Serif">
          <div class="font-group-label">Serif</div>
          <div class="font-options">
            <button class="font-option" data-font-option="source-serif" aria-pressed="false">Source Serif</button>
            <button class="font-option" data-font-option="merriweather" aria-pressed="false">Merriweather</button>
            <button class="font-option" data-font-option="literata" aria-pressed="false">Literata</button>
            <button class="font-option" data-font-option="system-serif" aria-pressed="false">System serif</button>
          </div>
        </div>
        <div class="font-group" data-font-group="Sans">
          <div class="font-group-label">Sans</div>
          <div class="font-options">
            <button class="font-option" data-font-option="inter" aria-pressed="false">Inter</button>
            <button class="font-option" data-font-option="atkinson" aria-pressed="false">Atkinson</button>
            <button class="font-option" data-font-option="system-sans" aria-pressed="false">System sans</button>
          </div>
        </div>
        <div class="font-group" data-font-group="Mono">
          <div class="font-group-label">Mono</div>
          <div class="font-options">
            <button class="font-option" data-font-option="jetbrains-mono" aria-pressed="false">JetBrains Mono</button>
            <button class="font-option" data-font-option="ibm-plex-mono" aria-pressed="false">IBM Plex Mono</button>
            <button class="font-option" data-font-option="system-mono" aria-pressed="false">System mono</button>
          </div>
        </div>
      </div>
    </section>

    <section class="config-section">
      <div class="config-label">
        <span>Text size</span>
        <span class="config-value" id="fontSizeValue">16px</span>
      </div>
      <div class="config-stepper">
        <button class="config-step-btn" id="fontSizeDownBtn" title="Decrease text size" aria-label="Decrease text size">-</button>
        <div class="config-step-value" id="fontSizeStepperValue">16px</div>
        <button class="config-step-btn" id="fontSizeUpBtn" title="Increase text size" aria-label="Increase text size">+</button>
      </div>
    </section>

    <section class="config-section">
      <div class="config-label">
        <span>Reader width</span>
        <span class="config-value" id="readerWidthValue">Medium</span>
      </div>
      <div class="config-stepper">
        <button class="config-step-btn" id="readerWidthDownBtn" title="Narrow reader width" aria-label="Narrow reader width">-</button>
        <div class="config-step-value" id="readerWidthStepperValue">80ch</div>
        <button class="config-step-btn" id="readerWidthUpBtn" title="Widen reader width" aria-label="Widen reader width">+</button>
      </div>
    </section>
  </div>

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
    const themeOptions = {
      'gruvbox-dark': 'Gruvbox',
      'solarized-light': 'Solarized light',
      'solarized-dark': 'Solarized dark',
      'dracula': 'Dracula',
      'nord': 'Nord',
      'tokyo-night': 'Tokyo Night',
      'catppuccin-latte': 'Catppuccin latte',
      'catppuccin-mocha': 'Catppuccin mocha'
    };
    const fontOptions = {
      'source-serif': 'Source Serif',
      'merriweather': 'Merriweather',
      'literata': 'Literata',
      'inter': 'Inter',
      'atkinson': 'Atkinson',
      'jetbrains-mono': 'JetBrains Mono',
      'ibm-plex-mono': 'IBM Plex Mono',
      'system-serif': 'System serif',
      'system-sans': 'System sans',
      'system-mono': 'System mono'
    };
    const readerWidthLabels = {
      '72ch': 'Compact',
      '80ch': 'Medium',
      '92ch': 'Wide',
      '104ch': 'Full'
    };
    const widthSteps = Object.keys(readerWidthLabels);
    const defaultReaderPrefs = {
      theme: 'gruvbox-dark',
      fontStyle: 'jetbrains-mono',
      fontSize: 16,
      readerWidth: '80ch'
    };
    let readerPrefs = { ...defaultReaderPrefs };

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
        const styles = getComputedStyle(document.documentElement);
        const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            primaryColor: token('--surface-muted', '#504945'),
            primaryTextColor: token('--ink', '#ebdbb2'),
            primaryBorderColor: token('--accent', '#fabd2f'),
            lineColor: token('--ink-soft', '#d5c4a1'),
            secondaryColor: token('--surface', '#3c3836'),
            tertiaryColor: token('--surface-muted', '#504945'),
            background: token('--bg', '#282828'),
            mainBkg: token('--surface', '#3c3836'),
            secondBkg: token('--surface-muted', '#504945'),
            nodeBorder: token('--accent', '#fabd2f'),
            clusterBkg: token('--surface', '#3c3836'),
            clusterBorder: token('--line', '#504945'),
            titleColor: token('--accent', '#fabd2f'),
            edgeLabelBackground: token('--bg', '#282828')
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
      closeReaderConfigPanel();
      const item = panel.querySelector(\`[data-annotation-id="\${annotationId}"]\`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.style.outline = '2px solid #fabd2f';
        setTimeout(() => item.style.outline = '', 2000);
      }
    }

    function togglePanel() {
      const panel = document.getElementById('annotationPanel');
      const isOpen = panel.classList.toggle('open');
      if (isOpen) closeReaderConfigPanel();
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

    function normalizeClientConfig(value) {
      const source = value && typeof value === 'object' ? value : {};
      const legacyWidth = source.readerWidth || source.width;
      return {
        theme: themeOptions[source.theme] ? source.theme : defaultReaderPrefs.theme,
        fontStyle: fontOptions[source.fontStyle] ? source.fontStyle : defaultReaderPrefs.fontStyle,
        fontSize: clampNumber(source.fontSize, 14, 22, defaultReaderPrefs.fontSize),
        readerWidth: widthSteps.includes(legacyWidth) ? legacyWidth : defaultReaderPrefs.readerWidth
      };
    }

    function loadLocalPreferences() {
      try {
        const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        readerPrefs = normalizeClientConfig({ ...readerPrefs, ...saved });
      } catch (_) {}
    }

    function saveLocalPreferences() {
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(readerPrefs));
      } catch (_) {}
    }

    async function loadServerPreferences() {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) return;
        const data = await response.json();
        if (!data.config) return;
        readerPrefs = normalizeClientConfig(data.config);
        applyPreferences();
        saveLocalPreferences();
      } catch (e) {
        console.warn('Failed to load reader config:', e);
      }
    }

    async function saveServerPreferences() {
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(readerPrefs)
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.config) {
          readerPrefs = normalizeClientConfig(data.config);
          applyPreferences();
          saveLocalPreferences();
        }
      } catch (e) {
        console.warn('Failed to save reader config:', e);
      }
    }

    function applyPreferences() {
      document.documentElement.dataset.theme = readerPrefs.theme;
      document.documentElement.dataset.fontStyle = readerPrefs.fontStyle;
      document.documentElement.style.setProperty('--reader-font-size', readerPrefs.fontSize + 'px');
      document.documentElement.style.setProperty('--content-width', readerPrefs.readerWidth);
      updateReaderConfigUi();
    }

    function commitPreferences() {
      applyPreferences();
      saveLocalPreferences();
      saveServerPreferences();
    }

    function updateReaderConfigUi() {
      document.querySelectorAll('[data-theme-option]').forEach(button => {
        const active = button.dataset.themeOption === readerPrefs.theme;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      document.querySelectorAll('[data-font-option]').forEach(button => {
        const active = button.dataset.fontOption === readerPrefs.fontStyle;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      setText('themeValue', themeOptions[readerPrefs.theme] || themeOptions[defaultReaderPrefs.theme]);
      setText('fontValue', fontOptions[readerPrefs.fontStyle] || fontOptions[defaultReaderPrefs.fontStyle]);
      setText('fontSizeValue', readerPrefs.fontSize + 'px');
      setText('fontSizeStepperValue', readerPrefs.fontSize + 'px');
      setText('readerWidthValue', readerWidthLabels[readerPrefs.readerWidth] || readerWidthLabels[defaultReaderPrefs.readerWidth]);
      setText('readerWidthStepperValue', readerPrefs.readerWidth);
    }

    function setText(id, value) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }

    function clampNumber(value, min, max, fallback) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.min(max, Math.max(min, Math.round(numeric)));
    }

    function adjustFontSize(delta) {
      readerPrefs.fontSize = clampNumber(readerPrefs.fontSize + delta, 14, 22, defaultReaderPrefs.fontSize);
      commitPreferences();
    }

    function adjustReaderWidth(delta) {
      const current = Math.max(0, widthSteps.indexOf(readerPrefs.readerWidth));
      const next = Math.min(widthSteps.length - 1, Math.max(0, current + delta));
      readerPrefs.readerWidth = widthSteps[next];
      commitPreferences();
    }

    function setReaderTheme(theme) {
      if (!themeOptions[theme]) return;
      readerPrefs.theme = theme;
      commitPreferences();
    }

    function setReaderFont(fontStyle) {
      if (!fontOptions[fontStyle]) return;
      readerPrefs.fontStyle = fontStyle;
      commitPreferences();
    }

    function closeReaderConfigPanel() {
      const panel = document.getElementById('readerConfigPanel');
      const toggle = document.getElementById('readerConfigToggle');
      panel.classList.remove('open');
      toggle.classList.remove('active');
      toggle.setAttribute('aria-expanded', 'false');
    }

    function toggleReaderConfigPanel() {
      const panel = document.getElementById('readerConfigPanel');
      const toggle = document.getElementById('readerConfigToggle');
      const isOpen = panel.classList.toggle('open');
      toggle.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        document.getElementById('annotationPanel').classList.remove('open');
      }
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
    document.getElementById('readerConfigToggle').addEventListener('click', toggleReaderConfigPanel);
    document.getElementById('readerConfigClose').addEventListener('click', closeReaderConfigPanel);
    document.getElementById('fontSizeDownBtn').addEventListener('click', () => adjustFontSize(-1));
    document.getElementById('fontSizeUpBtn').addEventListener('click', () => adjustFontSize(1));
    document.getElementById('readerWidthDownBtn').addEventListener('click', () => adjustReaderWidth(-1));
    document.getElementById('readerWidthUpBtn').addEventListener('click', () => adjustReaderWidth(1));
    document.querySelectorAll('[data-theme-option]').forEach(button => {
      button.addEventListener('click', () => setReaderTheme(button.dataset.themeOption));
    });
    document.querySelectorAll('[data-font-option]').forEach(button => {
      button.addEventListener('click', () => setReaderFont(button.dataset.fontOption));
    });

    loadLocalPreferences();
    applyPreferences();
    loadServerPreferences().finally(loadContent);
  </script>
</body>
</html>`;
}
