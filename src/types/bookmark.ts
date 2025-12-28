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

export interface BookmarkJson {
  success: boolean;
  data: BookmarkData;
}

export interface Bookmark {
  id: number;
  title: string;
  description: string;
  url: string;
  markdown: string;
}
