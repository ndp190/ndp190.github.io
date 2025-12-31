import type { BookmarkManifest, BookmarkManifestItem, BookmarkJson, Bookmark } from '../types/bookmark';

const R2_BASE_URL = 'https://r2.nikkdev.com/bookmark';
const MANIFEST_URL = 'https://r2.nikkdev.com/bookmark/manifest.json';

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
