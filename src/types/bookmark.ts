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
  // Added by sync - optional until synced
  progress?: ReadingProgress | null;
  annotations?: Annotation[];
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

// Reading progress stored in KV
export interface ReadingProgress {
  bookmarkKey: string;
  scrollPosition: number;
  scrollPercentage: number;
  lastReadAt: string;
  isRead: boolean;
  isFavourite: boolean;
}

// Annotation stored in KV
export interface Annotation {
  id: string;
  bookmarkKey: string;
  selectedText: string;
  note: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
}

export interface AnnotationList {
  annotations: Annotation[];
}

// Enriched bookmark with progress and annotations (from worker API)
export interface EnrichedBookmarkItem extends BookmarkManifestItem {
  progress: ReadingProgress | null;
  annotations?: Annotation[];
}
