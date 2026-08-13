# Bookmark Reader Worker

A Cloudflare Worker that provides a reading interface for bookmarked content stored in R2, with reading progress tracking and annotation features.

## Features

- **Bookmark List**: Display all bookmarks from the manifest with reading progress
- **Reading Progress**: Automatically saves scroll position as you read
- **Annotations**: Select text to add annotations, view and delete existing annotations
- **Private Knowledge Search**: Search saved article text, notes, read state, and favourites at `/knowledge`
- **Offline Media Support**: Article images are copied to R2 and served from the Worker at stable `/media/...` URLs
- **PWA Offline Shell**: The Worker serves its own manifest and service worker for Home Screen installs
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

### 3. Create R2 Buckets

```bash
wrangler r2 bucket create nikk-article-images
```

The existing `BOOKMARK_BUCKET` continues to store article JSON and the manifest. `ARTICLE_IMAGES` stores normalized article media.

### 4. Install Dependencies

```bash
npm install
```

### 5. Development

Use the default development command for local browser testing. It seeds mock bookmark data, starts the `local` Wrangler environment, and bypasses Cloudflare Access via `SKIP_AUTH=true`.

```bash
npm run dev
```

Open the local reader:

```text
http://localhost:8787/
http://localhost:8787/knowledge
```

On `/knowledge`, click **Rebuild index** once to build the local search index. The API equivalent is:

```bash
curl -X POST http://localhost:8787/api/knowledge/rebuild
```

This uses Wrangler's current `--persist-to .wrangler/state` flag for local KV/R2 state. Use `npm run dev:remote` only when you intentionally want Wrangler's default Access-protected environment.

### 6. Deploy

```bash
npm run deploy
```

### Backfill Existing Article Images

Dry run:

```bash
BOOKMARK_READER_WORKER_URL=https://your-worker.example.com npm run backfill:images:dry-run
```

Execute:

```bash
BOOKMARK_READER_WORKER_URL=https://your-worker.example.com npm run backfill:images -- --execute
```

For Cloudflare Access-protected Workers, provide either `CF_ACCESS_JWT` or `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.

### iPhone Offline Use

1. Deploy the Worker.
2. Open the Worker bookmark reader URL online in Safari.
3. Wait for the bookmark list to load. The page caches the list, article JSON, progress, annotations, and article images in the background.
4. Add the Worker URL to the Home Screen.
5. Open the Home Screen app once while still online and wait a few seconds.
6. Enable airplane mode and reopen the Home Screen app.

If an old Home Screen shortcut was created before PWA support, delete that shortcut and add it again after the new Worker is deployed.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Bookmark list page |
| GET | `/read/:key` | Reading page for a specific bookmark |
| GET | `/manifest.webmanifest` | PWA manifest for the Worker app |
| GET | `/sw.js` | PWA service worker for offline bookmark reading |
| GET | `/offline-read-shell` | Cached generic reader shell for offline `/read/:key` launches |
| GET | `/media/:key` | Serve normalized article image media |
| GET | `/api/bookmarks` | Get all bookmarks with progress |
| GET | `/api/bookmark/:key` | Get specific bookmark content |
| GET | `/api/progress/:key` | Get reading progress for a bookmark |
| POST | `/api/progress/:key` | Save reading progress |
| GET | `/api/annotations/:key` | Get annotations for a bookmark |
| POST | `/api/annotations/:key` | Add an annotation |
| DELETE | `/api/annotations/:key/:id` | Delete an annotation |
| GET | `/knowledge` | Private knowledge search dashboard |
| GET | `/api/knowledge/search` | Search indexed bookmarks |
| GET | `/api/knowledge/annotations` | Search notes and highlights across bookmarks |
| GET | `/api/knowledge/status` | Get knowledge index metadata |
| POST | `/api/knowledge/rebuild` | Rebuild the R2-backed knowledge index |
| POST | `/api/backfill/images` | Dry-run or execute image normalization for existing bookmarks |

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
