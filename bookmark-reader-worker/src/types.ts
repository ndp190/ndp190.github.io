export interface Env {
  NIKK_BOOKMARK_PROGRESS: KVNamespace;
  NIKK_BOOKMARK_ANNOTATION: KVNamespace;
  POLICY_AUD: string;
  TEAM_DOMAIN: string;
  SKIP_AUTH?: string; // For testing only
}

export interface BookmarkManifest {
  bookmarks: BookmarkEntry[];
  updatedAt: string;
}

export interface BookmarkEntry {
  id: number;
  key: string;
  title: string;
  description?: string;
  url: string;
}

export interface StoredBookmark {
  url: string;
  scrapedAt: string;
  firecrawlResponse: {
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
  };
}

export interface ReadingProgress {
  bookmarkKey: string;
  scrollPosition: number;
  scrollPercentage: number;
  lastReadAt: string;
}

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
