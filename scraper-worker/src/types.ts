export interface Env {
  SCRAPED_CONTENT: R2Bucket;
  FIRECRAWL_API_KEY: string;
}

export interface ScrapeRequest {
  url: string;
  formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
}

export interface FirecrawlResponse {
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
}

export interface StoredResult {
  url: string;
  scrapedAt: string;
  firecrawlResponse: FirecrawlResponse;
}
