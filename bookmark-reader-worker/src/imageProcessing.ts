import type {
  ArticleImageFailure,
  ArticleImageReference,
  BookmarkEntry,
  BookmarkManifest,
  Env,
  StoredBookmark,
} from './types';

const MANIFEST_KEY = 'bookmark/manifest.json';
const IMAGE_MIGRATION_VERSION = 1;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BACKFILL_CONCURRENCY = 2;

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

const IMAGE_METADATA_FIELDS = [
  'ogImage',
  'og:image',
  'image',
  'twitterImage',
  'twitter:image',
];

export interface PersistArticleImageOptions {
  maxBytes?: number;
  fetchFn?: typeof fetch;
  now?: () => string;
}

export interface PersistArticleImageResult {
  sourceUrl: string;
  mediaUrl: string;
  objectKey: string;
  status: 'uploaded' | 'already-present';
  contentType?: string;
  byteLength?: number;
}

export interface NormalizeArticleImagesOptions extends PersistArticleImageOptions {
  dryRun?: boolean;
}

export interface ImageNormalizationReport {
  articleKey: string;
  imagesDiscovered: number;
  imagesUploaded: number;
  imagesAlreadyPresent: number;
  imagesSkipped: number;
  imagesFailed: number;
  changed: boolean;
  images: ArticleImageReference[];
  failures: ArticleImageFailure[];
}

export interface NormalizeArticleImagesResult {
  bookmark: StoredBookmark;
  report: ImageNormalizationReport;
}

export interface BackfillArticleImagesOptions extends NormalizeArticleImagesOptions {
  execute?: boolean;
  limit?: number;
  concurrency?: number;
}

export interface BackfillArticleImagesReport {
  dryRun: boolean;
  articlesScanned: number;
  articlesUpdated: number;
  articlesNeedingUpdate: number;
  articlesMissingContent: number;
  imagesDiscovered: number;
  imagesUploaded: number;
  imagesAlreadyPresent: number;
  imagesSkipped: number;
  imagesFailed: number;
  failures: Array<ArticleImageFailure & { articleKey: string }>;
}

type UrlNormalizer = (value: string) => Promise<string | null>;

export async function persistArticleImage(
  sourceUrl: string,
  articleKey: string,
  env: Env,
  options: PersistArticleImageOptions = {}
): Promise<PersistArticleImageResult> {
  const source = normalizeRemoteImageUrl(sourceUrl);
  const unsafeReason = getUnsafeImageUrlReason(source);
  if (unsafeReason) {
    throw new Error(unsafeReason);
  }

  const normalizedUrl = normalizedUrlForHash(source);
  const hash = await sha256Hex(normalizedUrl);
  const existing = await findExistingImageObject(env.ARTICLE_IMAGES, hash);
  if (existing) {
    return {
      sourceUrl: normalizedUrl,
      mediaUrl: mediaUrlForKey(existing.key),
      objectKey: existing.key,
      status: 'already-present',
    };
  }

  const fetchImage = options.fetchFn ?? fetch;
  const response = await fetchImage(source.toString(), {
    redirect: 'follow',
    headers: {
      Accept: Object.keys(IMAGE_MIME_EXTENSIONS).join(', '),
    },
  });

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = trustedImageContentType(response.headers.get('Content-Type'));
  if (!contentType) {
    throw new Error(`Unsupported image content type: ${response.headers.get('Content-Type') || 'missing'}`);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} bytes`);
  }

  const bytes = await readResponseBytes(response, maxBytes);
  const objectKey = `images/${hash}.${IMAGE_MIME_EXTENSIONS[contentType]}`;
  const fetchedAt = options.now?.() ?? new Date().toISOString();

  await env.ARTICLE_IMAGES.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      sourceUrl: normalizedUrl,
      sourceContentType: contentType,
      fetchedAt,
      articleKey,
    },
  });

  return {
    sourceUrl: normalizedUrl,
    mediaUrl: mediaUrlForKey(objectKey),
    objectKey,
    status: 'uploaded',
    contentType,
    byteLength: bytes.byteLength,
  };
}

export async function normalizeArticleImages(
  bookmark: StoredBookmark,
  articleKey: string,
  env: Env,
  options: NormalizeArticleImagesOptions = {}
): Promise<NormalizeArticleImagesResult> {
  const report: ImageNormalizationReport = {
    articleKey,
    imagesDiscovered: 0,
    imagesUploaded: 0,
    imagesAlreadyPresent: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
    changed: false,
    images: [],
    failures: [],
  };

  const clonedBookmark = cloneStoredBookmark(bookmark);
  const data = clonedBookmark.firecrawlResponse.data;
  if (!data) {
    return { bookmark: clonedBookmark, report };
  }

  const normalizedBySource = new Map<string, Promise<string | null>>();
  const normalizeUrl: UrlNormalizer = async (rawValue: string) => {
    const sourceValue = stripWrapping(rawValue.trim());
    if (!sourceValue || shouldSkipImageValue(sourceValue)) {
      report.imagesSkipped++;
      return null;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(sourceValue, bookmark.url).toString();
    } catch {
      recordFailure(report, sourceValue, 'Invalid image URL');
      return null;
    }

    if (shouldSkipImageValue(absoluteUrl)) {
      report.imagesSkipped++;
      return null;
    }

    const existing = normalizedBySource.get(absoluteUrl);
    if (existing) {
      return existing;
    }

    const pending = normalizeOneImage(absoluteUrl, articleKey, env, options, report);
    normalizedBySource.set(absoluteUrl, pending);
    return pending;
  };

  if (data.markdown) {
    const nextMarkdown = await replaceMarkdownImageUrls(data.markdown, normalizeUrl, options.dryRun === true);
    if (nextMarkdown !== data.markdown) {
      data.markdown = nextMarkdown;
      report.changed = true;
    }
  }

  if (data.html) {
    const nextHtml = await replaceHtmlImageUrls(data.html, normalizeUrl, options.dryRun === true);
    if (nextHtml !== data.html) {
      data.html = nextHtml;
      report.changed = true;
    }
  }

  if (data.rawHtml) {
    const nextRawHtml = await replaceHtmlImageUrls(data.rawHtml, normalizeUrl, options.dryRun === true);
    if (nextRawHtml !== data.rawHtml) {
      data.rawHtml = nextRawHtml;
      report.changed = true;
    }
  }

  if (data.metadata) {
    for (const field of IMAGE_METADATA_FIELDS) {
      const value = data.metadata[field];
      if (typeof value !== 'string') {
        continue;
      }
      const mediaUrl = await normalizeUrl(value);
      if (!options.dryRun && mediaUrl && mediaUrl !== value) {
        data.metadata[field] = mediaUrl;
        report.changed = true;
      }
    }
  }

  if (!options.dryRun && (report.imagesDiscovered > 0 || report.changed)) {
    clonedBookmark.imageMigration = {
      version: IMAGE_MIGRATION_VERSION,
      normalizedAt: options.now?.() ?? new Date().toISOString(),
      status: report.imagesFailed > 0
        ? report.images.length > 0 ? 'partial' : 'failed'
        : 'complete',
      images: report.images,
      failures: report.failures,
    };
    report.changed = true;
  }

  return { bookmark: clonedBookmark, report };
}

export async function backfillBookmarkedArticleImages(
  env: Env,
  options: BackfillArticleImagesOptions = {}
): Promise<BackfillArticleImagesReport> {
  const execute = options.execute === true;
  const manifestObject = await env.BOOKMARK_BUCKET.get(MANIFEST_KEY);
  if (!manifestObject) {
    throw new Error('Manifest not found');
  }

  const manifest = await manifestObject.json() as BookmarkManifest;
  const bookmarks = typeof options.limit === 'number'
    ? manifest.bookmarks.slice(0, options.limit)
    : manifest.bookmarks;

  const report: BackfillArticleImagesReport = {
    dryRun: !execute,
    articlesScanned: 0,
    articlesUpdated: 0,
    articlesNeedingUpdate: 0,
    articlesMissingContent: 0,
    imagesDiscovered: 0,
    imagesUploaded: 0,
    imagesAlreadyPresent: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
    failures: [],
  };

  await mapWithConcurrency(
    bookmarks,
    options.concurrency ?? DEFAULT_BACKFILL_CONCURRENCY,
    async (entry) => {
      await processBackfillEntry(entry, env, execute, options, report);
    }
  );

  return report;
}

export function mediaUrlForKey(key: string): string {
  return `/media/${key}`;
}

async function processBackfillEntry(
  entry: BookmarkEntry,
  env: Env,
  execute: boolean,
  options: BackfillArticleImagesOptions,
  report: BackfillArticleImagesReport
): Promise<void> {
  report.articlesScanned++;
  const objectKey = `bookmark/${entry.key}.json`;
  const object = await env.BOOKMARK_BUCKET.get(objectKey);
  if (!object) {
    report.articlesMissingContent++;
    return;
  }

  const bookmark = await object.json() as StoredBookmark;
  const result = await normalizeArticleImages(bookmark, entry.key, env, {
    ...options,
    dryRun: !execute,
  });

  mergeBackfillReport(report, result.report, entry.key);

  if (!execute && result.report.imagesDiscovered > 0) {
    report.articlesNeedingUpdate++;
  }

  if (execute && result.report.changed) {
    await env.BOOKMARK_BUCKET.put(objectKey, JSON.stringify(result.bookmark), {
      httpMetadata: { contentType: 'application/json' },
    });
    report.articlesUpdated++;
  }
}

async function normalizeOneImage(
  sourceUrl: string,
  articleKey: string,
  env: Env,
  options: NormalizeArticleImagesOptions,
  report: ImageNormalizationReport
): Promise<string | null> {
  report.imagesDiscovered++;

  if (options.dryRun) {
    report.images.push({
      sourceUrl,
      mediaUrl: '',
      status: 'dry-run',
    });
    return null;
  }

  try {
    const result = await persistArticleImage(sourceUrl, articleKey, env, options);
    if (result.status === 'uploaded') {
      report.imagesUploaded++;
    } else {
      report.imagesAlreadyPresent++;
    }
    report.images.push({
      sourceUrl: result.sourceUrl,
      mediaUrl: result.mediaUrl,
      objectKey: result.objectKey,
      status: result.status,
    });
    return result.mediaUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown image error';
    recordFailure(report, sourceUrl, message);
    return null;
  }
}

function mergeBackfillReport(
  target: BackfillArticleImagesReport,
  source: ImageNormalizationReport,
  articleKey: string
): void {
  target.imagesDiscovered += source.imagesDiscovered;
  target.imagesUploaded += source.imagesUploaded;
  target.imagesAlreadyPresent += source.imagesAlreadyPresent;
  target.imagesSkipped += source.imagesSkipped;
  target.imagesFailed += source.imagesFailed;
  target.failures.push(...source.failures.map(failure => ({ ...failure, articleKey })));
}

function recordFailure(report: ImageNormalizationReport, sourceUrl: string, error: string): void {
  report.imagesFailed++;
  report.failures.push({ sourceUrl, error });
}

async function replaceMarkdownImageUrls(
  markdown: string,
  normalizeUrl: UrlNormalizer,
  dryRun: boolean
): Promise<string> {
  const markdownImagePattern = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]+\)))?\)/g;
  return replaceAsync(markdown, markdownImagePattern, async (match, alt, rawUrl, title = '') => {
    const nextUrl = await normalizeUrl(rawUrl);
    if (dryRun || !nextUrl) {
      return match;
    }
    return `![${alt}](${nextUrl}${title})`;
  });
}

async function replaceHtmlImageUrls(
  html: string,
  normalizeUrl: UrlNormalizer,
  dryRun: boolean
): Promise<string> {
  return replaceAsync(html, /<(img|source)\b[^>]*>/gi, async (tag) => {
    let nextTag = tag;
    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      nextTag = await replaceQuotedAttribute(nextTag, attr, async value => {
        const nextUrl = await normalizeUrl(value);
        return dryRun || !nextUrl ? value : nextUrl;
      });
    }
    for (const attr of ['srcset', 'data-srcset']) {
      nextTag = await replaceQuotedAttribute(nextTag, attr, async value => {
        const nextSrcset = await normalizeSrcset(value, normalizeUrl);
        return dryRun ? value : nextSrcset;
      });
    }
    return nextTag;
  });
}

async function replaceQuotedAttribute(
  tag: string,
  attr: string,
  replaceValue: (value: string) => Promise<string>
): Promise<string> {
  const attrPattern = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
  const match = attrPattern.exec(tag);
  if (!match) {
    return tag;
  }
  const nextValue = await replaceValue(match[3]);
  return tag.slice(0, match.index)
    + `${match[1]}${match[2]}${nextValue}${match[2]}`
    + tag.slice(match.index + match[0].length);
}

async function normalizeSrcset(srcset: string, normalizeUrl: UrlNormalizer): Promise<string> {
  const candidates = srcset.split(',');
  const normalizedCandidates = await Promise.all(candidates.map(async (candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return candidate;
    }
    const [urlPart, ...descriptorParts] = trimmed.split(/\s+/);
    const nextUrl = await normalizeUrl(urlPart);
    return [nextUrl ?? urlPart, ...descriptorParts].join(' ');
  }));
  return normalizedCandidates.join(', ');
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (...args: string[]) => Promise<string>
): Promise<string> {
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) {
    return value;
  }

  let output = '';
  let lastIndex = 0;
  for (const match of matches) {
    output += value.slice(lastIndex, match.index);
    output += await replacer(...match.map(part => part ?? ''));
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  output += value.slice(lastIndex);
  return output;
}

async function findExistingImageObject(bucket: R2Bucket, hash: string): Promise<R2Object | null> {
  const listed = await bucket.list({ prefix: `images/${hash}.`, limit: 1 });
  return listed.objects[0] ?? null;
}

function normalizeRemoteImageUrl(sourceUrl: string): URL {
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    throw new Error('Invalid image URL');
  }

  if (source.protocol !== 'http:' && source.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS image URLs are supported');
  }
  return source;
}

function normalizedUrlForHash(source: URL): string {
  const normalized = new URL(source.toString());
  normalized.protocol = normalized.protocol.toLowerCase();
  normalized.hostname = normalized.hostname.toLowerCase();
  normalized.hash = '';
  return normalized.toString();
}

function trustedImageContentType(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) {
    return null;
  }
  const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return IMAGE_MIME_EXTENSIONS[contentType] ? contentType : null;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Image exceeds ${maxBytes} bytes`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Image exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stripWrapping(value: string): string {
  if (value.startsWith('<') && value.endsWith('>')) {
    return value.slice(1, -1);
  }
  return value;
}

function shouldSkipImageValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('/media/')
    || trimmed.startsWith('data:')
    || trimmed.startsWith('blob:')
    || trimmed.startsWith('cid:')
    || trimmed.startsWith('#')) {
    return true;
  }

  try {
    return new URL(trimmed).pathname.startsWith('/media/');
  } catch {
    return false;
  }
}

function getUnsafeImageUrlReason(source: URL): string | null {
  const hostname = source.hostname.replace(/\.$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return 'Unsafe image host';
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    return 'Unsafe non-global IPv4 host';
  }

  if (hostname.includes(':') && isPrivateIpv6(hostname)) {
    return 'Unsafe non-global IPv6 host';
  }

  if (!ipv4 && !hostname.includes('.') && !hostname.includes(':')) {
    return 'Unsafe single-label image host';
  }

  return null;
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map(part => Number(part));
  if (numbers.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return numbers;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.');
}

function cloneStoredBookmark(bookmark: StoredBookmark): StoredBookmark {
  return JSON.parse(JSON.stringify(bookmark)) as StoredBookmark;
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, values.length || 1));
  let index = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      index++;
      await worker(values[currentIndex]);
    }
  }));
}
