/**
 * Script to update the bookmark manifest file from R2 storage.
 *
 * Usage: npm run bookmark:manifest <r2-url>
 *
 * Example: npm run bookmark:manifest https://r2.nikkdev.com/bookmark/my-article.json
 *
 * This script fetches bookmark metadata from the provided R2 URL and adds it
 * to the manifest file that the frontend uses to list available bookmarks.
 */

import * as fs from 'fs';
import * as path from 'path';

interface BookmarkMetadata {
  title?: string;
  ogTitle?: string;
  description?: string;
  ogDescription?: string;
  url?: string;
  sourceURL?: string;
}

interface BookmarkData {
  markdown: string;
  metadata: BookmarkMetadata;
}

interface FirecrawlResponse {
  success: boolean;
  data: BookmarkData;
}

interface BookmarkJson {
  url: string;
  scrapedAt: string;
  firecrawlResponse: FirecrawlResponse;
}

interface ManifestBookmark {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
}

interface Manifest {
  bookmarks: ManifestBookmark[];
  updatedAt: string;
}

const MANIFEST_PATH = path.join(process.cwd(), 'public/bookmark/manifest.json');

function extractKeyFromUrl(url: string): string {
  const filename = url.split('/').pop() || '';
  return filename.replace(/\.json$/, '');
}

function loadManifest(): Manifest {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
      return JSON.parse(content) as Manifest;
    }
  } catch (error) {
    console.warn('Could not load existing manifest, creating new one');
  }
  return { bookmarks: [], updatedAt: '' };
}

function saveManifest(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function fetchBookmark(url: string): Promise<BookmarkJson | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json() as BookmarkJson;
  } catch (error) {
    console.error('Error fetching bookmark:', error);
    return null;
  }
}

async function addBookmark(url: string): Promise<void> {
  const key = extractKeyFromUrl(url);

  if (!key) {
    console.error('Could not extract key from URL');
    process.exit(1);
  }

  console.log(`Fetching: ${url}`);
  const data = await fetchBookmark(url);

  const firecrawl = data?.firecrawlResponse;
  if (!firecrawl || !firecrawl.success || !firecrawl.data) {
    console.error('Invalid bookmark data');
    process.exit(1);
  }

  const { metadata } = firecrawl.data;
  const manifest = loadManifest();

  // Check if bookmark already exists
  const existingIndex = manifest.bookmarks.findIndex(b => b.key === key);

  const bookmark: ManifestBookmark = {
    id: existingIndex >= 0 ? manifest.bookmarks[existingIndex].id : (manifest.bookmarks.length + 1),
    key,
    title: metadata.ogTitle || metadata.title || 'Untitled',
    description: metadata.ogDescription || metadata.description || '',
    url: metadata.sourceURL || metadata.url || '',
  };

  if (existingIndex >= 0) {
    manifest.bookmarks[existingIndex] = bookmark;
    console.log(`Updated existing bookmark: ${bookmark.title}`);
  } else {
    manifest.bookmarks.push(bookmark);
    console.log(`Added new bookmark: ${bookmark.title}`);
  }

  saveManifest(manifest);
  console.log(`\nManifest saved with ${manifest.bookmarks.length} bookmarks`);
  console.log(`Output: ${MANIFEST_PATH}`);
}

// Main
const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run bookmark:manifest <r2-url>');
  console.error('Example: npm run bookmark:manifest https://r2.nikkdev.com/bookmark/my-article.json');
  process.exit(1);
}

addBookmark(url).catch(console.error);
