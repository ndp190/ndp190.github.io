import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const MANIFEST_KEY = 'bookmark/manifest.json';
const KNOWLEDGE_PREFIX = 'bookmark/knowledge/';
const KNOWLEDGE_DOC_PREFIX = `${KNOWLEDGE_PREFIX}docs/`;
const KNOWLEDGE_SEARCH_KEY = `${KNOWLEDGE_PREFIX}search.json`;

interface FixtureBookmark {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
}

async function deleteR2Prefix(prefix: string) {
  let cursor: string | undefined;
  do {
    const listing = await env.BOOKMARK_BUCKET.list({ prefix, cursor });
    await Promise.all(listing.objects.map(object => env.BOOKMARK_BUCKET.delete(object.key)));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

async function seedStoredBookmark(bookmark: FixtureBookmark, markdown: string) {
  await env.BOOKMARK_BUCKET.put(`bookmark/${bookmark.key}.json`, JSON.stringify({
    url: bookmark.url,
    scrapedAt: '2026-08-12T00:00:00.000Z',
    firecrawlResponse: {
      success: true,
      data: {
        markdown,
        metadata: {
          title: bookmark.title,
          description: bookmark.description,
          sourceURL: bookmark.url,
        },
      },
    },
  }));
}

async function r2ObjectExists(key: string): Promise<boolean> {
  const object = await env.BOOKMARK_BUCKET.get(key);
  if (!object) return false;
  await object.text();
  return true;
}

async function seedKnowledgeFixture(options: { includeMissing?: boolean } = {}) {
  const suffix = crypto.randomUUID();
  const alpha = {
    id: 1,
    key: `knowledge-alpha-${suffix}`,
    title: 'Phoenix Testing Manual',
    description: 'Release checks and quality routines.',
    url: `https://example.com/${suffix}/alpha`,
  };
  const beta = {
    id: 2,
    key: `knowledge-beta-${suffix}`,
    title: 'Local Development Notebook',
    description: 'Worker tooling for saved articles.',
    url: `https://example.com/${suffix}/beta`,
  };
  const gamma = {
    id: 3,
    key: `knowledge-gamma-${suffix}`,
    title: 'Annotation Systems',
    description: 'Highlights and notes across the archive.',
    url: `https://example.com/${suffix}/gamma`,
  };
  const missing = {
    id: 4,
    key: `knowledge-missing-${suffix}`,
    title: 'Missing Bookmark',
    description: 'This entry intentionally has no stored JSON.',
    url: `https://example.com/${suffix}/missing`,
  };
  const bookmarks = options.includeMissing ? [alpha, beta, gamma, missing] : [alpha, beta, gamma];

  await env.BOOKMARK_BUCKET.put(MANIFEST_KEY, JSON.stringify({
    bookmarks,
    updatedAt: '2026-08-12T00:00:00.000Z',
  }));

  await seedStoredBookmark(
    alpha,
    '# Phoenix Testing Manual\n\nTitle matches should outrank body-only matches.',
  );
  await seedStoredBookmark(
    beta,
    '# Local Development Notebook\n\nA body-only phoenix reference appears here with local workflow details.',
  );
  await seedStoredBookmark(
    gamma,
    '# Annotation Systems\n\nGlobal notes should be searchable from one place.',
  );

  await env.NIKK_BOOKMARK_PROGRESS.put(alpha.key, JSON.stringify({
    bookmarkKey: alpha.key,
    scrollPosition: 10,
    scrollPercentage: 10,
    lastReadAt: '2026-08-12T00:00:00.000Z',
    isRead: false,
    isFavourite: true,
  }));
  await env.NIKK_BOOKMARK_PROGRESS.put(beta.key, JSON.stringify({
    bookmarkKey: beta.key,
    scrollPosition: 100,
    scrollPercentage: 100,
    lastReadAt: '2026-08-12T01:00:00.000Z',
    isRead: true,
    isFavourite: false,
  }));
  await env.NIKK_BOOKMARK_ANNOTATION.put(gamma.key, JSON.stringify({
    annotations: [
      {
        id: `note-${suffix}`,
        bookmarkKey: gamma.key,
        selectedText: 'Indexed highlight',
        note: 'Durable annotation note',
        startOffset: 0,
        endOffset: 17,
        createdAt: '2026-08-12T02:00:00.000Z',
      },
    ],
  }));

  return { alpha, beta, gamma, missing };
}

describe('Knowledge API', () => {
  beforeEach(async () => {
    await env.BOOKMARK_BUCKET.delete(MANIFEST_KEY);
    await deleteR2Prefix(KNOWLEDGE_PREFIX);
  });

  it('rebuilds the R2 index and tolerates missing bookmark JSON', async () => {
    const fixture = await seedKnowledgeFixture({ includeMissing: true });

    const response = await SELF.fetch('https://example.com/api/knowledge/rebuild', {
      method: 'POST',
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.index.bookmarkCount).toBe(4);
    expect(data.index.indexedCount).toBe(3);
    expect(data.index.failures).toEqual([
      expect.objectContaining({ key: fixture.missing.key }),
    ]);

    const statusResponse = await SELF.fetch('https://example.com/api/knowledge/status');
    const status = await statusResponse.json();
    expect(status.status).toBe('ready');
    expect(status.index.indexedCount).toBe(3);

    expect(await r2ObjectExists(
      `${KNOWLEDGE_DOC_PREFIX}${encodeURIComponent(fixture.alpha.key)}.json`,
    )).toBe(true);
    expect(await r2ObjectExists(KNOWLEDGE_SEARCH_KEY)).toBe(true);
  });

  it('scores title matches above body-only matches from the aggregate search index', async () => {
    const fixture = await seedKnowledgeFixture();
    await SELF.fetch('https://example.com/api/knowledge/rebuild', { method: 'POST' });
    await deleteR2Prefix(KNOWLEDGE_DOC_PREFIX);

    const response = await SELF.fetch('https://example.com/api/knowledge/search?q=phoenix');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results[0].key).toBe(fixture.alpha.key);
    expect(data.results.map((result: { key: string }) => result.key)).toContain(fixture.beta.key);
    expect(data.results[0].snippet.html).toContain('<mark>Phoenix</mark>');
  });

  it('filters by read state, favourites, and annotations using KV at request time', async () => {
    const fixture = await seedKnowledgeFixture();
    await SELF.fetch('https://example.com/api/knowledge/rebuild', { method: 'POST' });

    const readResponse = await SELF.fetch('https://example.com/api/knowledge/search?state=read');
    const readData = await readResponse.json();
    expect(readData.results.map((result: { key: string }) => result.key)).toEqual([fixture.beta.key]);

    const favouriteResponse = await SELF.fetch('https://example.com/api/knowledge/search?state=favourites');
    const favouriteData = await favouriteResponse.json();
    expect(favouriteData.results.map((result: { key: string }) => result.key)).toEqual([fixture.alpha.key]);

    const annotatedResponse = await SELF.fetch('https://example.com/api/knowledge/search?state=annotated');
    const annotatedData = await annotatedResponse.json();
    expect(annotatedData.results.map((result: { key: string }) => result.key)).toEqual([fixture.gamma.key]);
  });

  it('removes a knowledge document when a bookmark is deleted', async () => {
    const fixture = await seedKnowledgeFixture();
    await SELF.fetch('https://example.com/api/knowledge/rebuild', { method: 'POST' });

    const documentKey = `${KNOWLEDGE_DOC_PREFIX}${encodeURIComponent(fixture.alpha.key)}.json`;
    expect(await r2ObjectExists(documentKey)).toBe(true);

    const deleteResponse = await SELF.fetch(
      `https://example.com/api/bookmarks/${encodeURIComponent(fixture.alpha.key)}`,
      { method: 'DELETE' },
    );

    expect(deleteResponse.status).toBe(200);
    expect(await r2ObjectExists(documentKey)).toBe(false);

    const searchResponse = await SELF.fetch('https://example.com/api/knowledge/search?q=phoenix');
    const searchData = await searchResponse.json();
    expect(searchData.results.map((result: { key: string }) => result.key)).not.toContain(fixture.alpha.key);
  });
});

describe('Knowledge page', () => {
  it('serves the private dashboard shell', async () => {
    const response = await SELF.fetch('https://example.com/knowledge');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(html).toContain('knowledge-shell');
    expect(html).toContain('/api/knowledge/search');
    expect(html).toContain('Rebuild index');
  });
});
