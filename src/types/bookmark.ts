// Raw JSON structure from R2 scraper
export interface BookmarkMetadata {
  title?: string;
  ogTitle?: string;
  description?: string;
  ogDescription?: string;
  url?: string;
  sourceURL?: string;
  ogImage?: string;
}

export interface BookmarkData {
  markdown: string;
  metadata: BookmarkMetadata;
}

export interface FirecrawlResponse {
  success: boolean;
  data: BookmarkData;
}

export interface BookmarkJson {
  url: string;
  scrapedAt: string;
  firecrawlResponse: FirecrawlResponse;
}

// Manifest types (for listing bookmarks)
export interface BookmarkManifestItem {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
}

export interface BookmarkManifest {
  bookmarks: BookmarkManifestItem[];
  updatedAt: string;
}

// Full bookmark with content (for cat command)
export interface Bookmark {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
  markdown: string;
}
