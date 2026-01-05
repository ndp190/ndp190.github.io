import type { BookmarkManifest, BookmarkManifestItem, BookmarkJson, Bookmark, ReadingProgress, Annotation } from '../types/bookmark';

const R2_BASE_URL = 'https://r2.nikkdev.com/bookmark';
const MANIFEST_URL = 'https://r2.nikkdev.com/bookmark/manifest.json';

// Enriched bookmark data structure (from worker sync)
export interface EnrichedBookmark {
  progress: ReadingProgress | null;
  annotations: Annotation[];
  syncedAt: string;
}

/**
 * Fetch the bookmark manifest (list of all bookmarks with metadata)
 */
export async function fetchBookmarkManifest(): Promise<BookmarkManifest> {
  const response = await fetch(MANIFEST_URL);

  if (!response.ok) {
    throw new Error(`Failed to load bookmarks: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch full bookmark content from R2 by key
 */
export async function fetchBookmarkContent(key: string): Promise<string> {
  const url = `${R2_BASE_URL}/${key}.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load bookmark`);
  }

  const json: BookmarkJson = await response.json();
  const firecrawl = json.firecrawlResponse;

  if (!firecrawl?.success || !firecrawl?.data) {
    throw new Error(`Failed to load bookmark`);
  }

  return firecrawl.data.markdown;
}

/**
 * Fetch full bookmark by ID (combines manifest lookup + content fetch)
 */
export async function fetchBookmarkById(
  manifest: BookmarkManifest,
  id: number
): Promise<Bookmark | null> {
  const item = manifest.bookmarks.find(b => b.id === id);

  if (!item) {
    return null;
  }

  const markdown = await fetchBookmarkContent(item.key);

  return {
    ...item,
    markdown,
  };
}

/**
 * Get bookmark metadata from manifest by ID (no content fetch)
 */
export function getBookmarkMeta(
  manifest: BookmarkManifest,
  id: number
): BookmarkManifestItem | undefined {
  return manifest.bookmarks.find(b => b.id === id);
}

/**
 * Fetch enriched bookmark data (progress + annotations) from R2
 * Returns null if not synced yet
 */
export async function fetchEnrichedBookmark(key: string): Promise<EnrichedBookmark | null> {
  const url = `${R2_BASE_URL}/enriched/${key}.json`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch enriched data for all bookmarks in parallel
 * Returns a map of bookmark key -> enriched data
 */
export async function fetchAllEnrichedBookmarks(
  bookmarks: BookmarkManifestItem[]
): Promise<Map<string, EnrichedBookmark>> {
  const results = await Promise.allSettled(
    bookmarks.map(async (b) => ({
      key: b.key,
      data: await fetchEnrichedBookmark(b.key),
    }))
  );

  const enrichedMap = new Map<string, EnrichedBookmark>();

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.data) {
      enrichedMap.set(result.value.key, result.value.data);
    }
  }

  return enrichedMap;
}
