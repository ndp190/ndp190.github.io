import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import type { Env, StoredBookmark } from '../types';
import {
  backfillBookmarkedArticleImages,
  normalizeArticleImages,
  persistArticleImage,
} from '../imageProcessing';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function imageResponse(): Response {
  return new Response(PNG_BYTES, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(PNG_BYTES.byteLength),
    },
  });
}

describe('article image processing', () => {
  it('uploads a valid image and skips duplicate downloads', async () => {
    const sourceUrl = `https://cdn.example.com/${crypto.randomUUID()}.png`;
    const fetchFn = vi.fn(async () => imageResponse());

    const first = await persistArticleImage(sourceUrl, 'article-one', env as Env, { fetchFn });
    const second = await persistArticleImage(sourceUrl, 'article-one', env as Env, { fetchFn });

    expect(first.status).toBe('uploaded');
    expect(second.status).toBe('already-present');
    expect(second.objectKey).toBe(first.objectKey);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const mediaResponse = await SELF.fetch(`https://example.com/media/${first.objectKey}`);
    expect(mediaResponse.status).toBe(200);
    expect((await mediaResponse.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);

    await env.ARTICLE_IMAGES.delete(first.objectKey);
  });

  it('rejects unsupported image MIME types', async () => {
    await expect(persistArticleImage(
      `https://cdn.example.com/${crypto.randomUUID()}.txt`,
      'article-one',
      env as Env,
      {
        fetchFn: async () => new Response('nope', {
          headers: { 'Content-Type': 'text/plain' },
        }),
      }
    )).rejects.toThrow(/Unsupported image content type/);
  });

  it('rejects unsafe source URLs', async () => {
    await expect(persistArticleImage(
      'http://127.0.0.1/private.png',
      'article-one',
      env as Env,
      { fetchFn: async () => imageResponse() }
    )).rejects.toThrow(/Unsafe/);
  });

  it('normalizes Markdown, HTML, srcset, and metadata image URLs', async () => {
    const sourceUrl = `https://cdn.example.com/${crypto.randomUUID()}.png`;
    const bookmark: StoredBookmark = {
      url: 'https://example.com/articles/one',
      scrapedAt: '2026-01-01T00:00:00.000Z',
      firecrawlResponse: {
        success: true,
        data: {
          markdown: `# Title\n\n![Alt text](${sourceUrl})`,
          html: `<picture><source srcset="${sourceUrl} 1x"><img src="${sourceUrl}" alt="Alt text"></picture>`,
          rawHtml: `<img data-src="${sourceUrl}">`,
          metadata: {
            title: 'Title',
            ogImage: sourceUrl,
          },
        },
      },
    };

    const result = await normalizeArticleImages(bookmark, 'article-one', env as Env, {
      fetchFn: async () => imageResponse(),
    });

    expect(result.report.imagesDiscovered).toBe(1);
    expect(result.report.imagesUploaded).toBe(1);
    expect(result.bookmark.firecrawlResponse.data?.markdown).toContain('/media/images/');
    expect(result.bookmark.firecrawlResponse.data?.html).toContain('/media/images/');
    expect(result.bookmark.firecrawlResponse.data?.rawHtml).toContain('/media/images/');
    expect(result.bookmark.firecrawlResponse.data?.metadata?.ogImage).toContain('/media/images/');
    expect(result.bookmark.imageMigration?.status).toBe('complete');

    const objectKey = result.bookmark.imageMigration?.images[0]?.objectKey;
    if (objectKey) {
      await env.ARTICLE_IMAGES.delete(objectKey);
    }
  });

  it('serves normalized media with cache headers', async () => {
    const objectKey = 'images/route-test.png';
    await env.ARTICLE_IMAGES.put(objectKey, PNG_BYTES, {
      httpMetadata: { contentType: 'image/png' },
    });

    const response = await SELF.fetch(`https://example.com/media/${objectKey}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect((await response.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);

    await env.ARTICLE_IMAGES.delete(objectKey);
  });

  it('can dry-run backfill without writing bookmark JSON', async () => {
    const key = `dry-run-${crypto.randomUUID()}`;
    const sourceUrl = `https://cdn.example.com/${crypto.randomUUID()}.png`;
    const manifestKey = 'bookmark/manifest.json';
    const articleKey = `bookmark/${key}.json`;
    const manifest = {
      bookmarks: [{ id: 1, key, title: 'Dry run', description: '', url: 'https://example.com/dry-run' }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const article: StoredBookmark = {
      url: 'https://example.com/dry-run',
      scrapedAt: '2026-01-01T00:00:00.000Z',
      firecrawlResponse: {
        success: true,
        data: {
          markdown: `![Alt](${sourceUrl})`,
          metadata: { title: 'Dry run' },
        },
      },
    };

    await env.BOOKMARK_BUCKET.put(manifestKey, JSON.stringify(manifest));
    await env.BOOKMARK_BUCKET.put(articleKey, JSON.stringify(article));

    const report = await backfillBookmarkedArticleImages(env as Env, { execute: false });
    const stored = await env.BOOKMARK_BUCKET.get(articleKey);
    const storedArticle = await stored?.json() as StoredBookmark;

    expect(report.dryRun).toBe(true);
    expect(report.articlesNeedingUpdate).toBeGreaterThanOrEqual(1);
    expect(storedArticle.imageMigration).toBeUndefined();

    await env.BOOKMARK_BUCKET.delete(articleKey);
    await env.BOOKMARK_BUCKET.delete(manifestKey);
  });
});
