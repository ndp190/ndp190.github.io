# Bookmark Reader Worker

A Cloudflare Worker that provides a reading interface for bookmarked content stored in R2, with reading progress tracking and annotation features.

## Features

- **Bookmark List**: Display all bookmarks from the manifest with reading progress
- **Reading Progress**: Automatically saves scroll position as you read
- **Annotations**: Select text to add annotations, view and delete existing annotations
- **Cloudflare Access**: Protected by Cloudflare Access JWT authentication

## Setup

### 1. Create KV Namespaces

```bash
# Create KV namespaces for reading progress and annotations
wrangler kv:namespace create READING_PROGRESS
wrangler kv:namespace create ANNOTATIONS
```

Update `wrangler.toml` with the returned namespace IDs.

### 2. Set Secrets

```bash
wrangler secret put TEAM_DOMAIN
# Enter your Cloudflare Access team domain (e.g., https://yourteam.cloudflareaccess.com)

wrangler secret put POLICY_AUD
# Enter your Cloudflare Access policy audience tag
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Development

```bash
npm run dev
```

### 5. Deploy

```bash
npm run deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Bookmark list page |
| GET | `/read/:key` | Reading page for a specific bookmark |
| GET | `/api/bookmarks` | Get all bookmarks with progress |
| GET | `/api/bookmark/:key` | Get specific bookmark content |
| GET | `/api/progress/:key` | Get reading progress for a bookmark |
| POST | `/api/progress/:key` | Save reading progress |
| GET | `/api/annotations/:key` | Get annotations for a bookmark |
| POST | `/api/annotations/:key` | Add an annotation |
| DELETE | `/api/annotations/:key/:id` | Delete an annotation |

## Data Sources

- **Manifest**: `https://r2.nikkdev.com/bookmark/manifest.json`
- **Bookmarks**: `https://r2.nikkdev.com/bookmark/[key].json`

## Manifest Format

The manifest.json should contain:

```json
{
  "bookmarks": [
    {
      "key": "example-article",
      "title": "Example Article Title",
      "description": "Optional description",
      "sourceUrl": "https://original-source.com/article",
      "scrapedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```
