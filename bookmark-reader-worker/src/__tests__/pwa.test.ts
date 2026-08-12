import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Bookmark Reader PWA assets', () => {
  it('serves the web app manifest from the Worker', async () => {
    const response = await SELF.fetch('https://example.com/manifest.webmanifest');
    const manifest = await response.json();

    expect(response.status).toBe(200);
    expect(manifest.name).toBe('Bookmark Reader');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '/bookmark-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      }),
      expect.objectContaining({
        src: '/bookmark-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      }),
    ]));
  });

  it('serves PNG install icons for iOS Home Screen and manifest installs', async () => {
    const response = await SELF.fetch('https://example.com/apple-touch-icon.png');
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('serves a service worker with Worker app cache names', async () => {
    const response = await SELF.fetch('https://example.com/sw.js');
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/javascript');
    expect(script).toContain('bookmark-reader-worker-shell-v2');
    expect(script).toContain('/offline-read-shell');
    expect(script).toContain('/apple-touch-icon.png');
  });

  it('injects PWA metadata and service worker registration into the list page', async () => {
    const response = await SELF.fetch('https://example.com/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">');
    expect(html).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('serves an offline reader shell that derives the bookmark key from the URL path', async () => {
    const response = await SELF.fetch('https://example.com/offline-read-shell');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("embeddedBookmarkKey === '__bookmark_from_path__'");
    expect(html).toContain("location.pathname.replace(/^\\/read\\//, '')");
  });
});
