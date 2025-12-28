# Scraper Worker

A Cloudflare Worker that scrapes web content using Firecrawl and stores results in R2.

## Setup

### 1. Install dependencies

```bash
cd scraper-worker
npm install
```

### 2. Set Firecrawl API key

```bash
wrangler secret put FIRECRAWL_API_KEY
# Enter your Firecrawl API key when prompted
```

Get your API key from [firecrawl.dev](https://firecrawl.dev).

### 3. Deploy

```bash
npm run deploy
```

## Usage

### Web UI

Visit the worker URL in your browser to access the web interface:
- Enter a URL to scrape
- Shows progress spinner while scraping
- Displays result or error when complete

### API

Send a POST request:

```bash
curl -X POST https://scraper-worker.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to scrape |
| `formats` | array | No | Output formats: `markdown`, `html`, `rawHtml`, `links`, `screenshot`. Default: `["markdown"]` |

#### Response

```json
{
  "success": true,
  "key": "bookmark/example-page-title.json",
  "storedAt": "2024-12-28T10:30:00.000Z",
  "data": {
    "markdown": "# Page content...",
    "metadata": {
      "title": "Example Page Title",
      "sourceURL": "https://example.com"
    }
  }
}
```

## Development

```bash
npm run dev
```

Then visit `http://localhost:8787` to use the web UI.

## R2 Storage

Scraped content is stored in the `nikk` R2 bucket with the key format:
```
bookmark/<page-title>.json
```

The page title is sanitized (lowercase, special chars removed, spaces to hyphens, max 100 chars).

If the page has no title, falls back to ISO datetime string to ensure uniqueness.
