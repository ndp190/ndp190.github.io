import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const READER_CONFIG_KEY = '__reader_config_v1__';

describe('Reader page', () => {
  it('serves the enhanced markdown reader shell', async () => {
    const response = await SELF.fetch('https://example.com/read/example-article-one');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');

    const html = await response.text();
    expect(html).toContain('mermaid@10.9.1');
    expect(html).toContain('articleBody');
    expect(html).toContain('media-embed');
    expect(html).toContain('bookmark-reader-preferences');
    expect(html).toContain('/api/config');
    expect(html).toContain('readerConfigToggle');
    expect(html).toContain('readerConfigPanel');
    expect(html).toContain('data-theme-option="dracula"');
    expect(html).toContain('data-font-group="Serif"');
    expect(html).toContain('data-font-option="source-serif"');
    expect(html).toContain('--content-width: 80ch');
    expect(html).toContain('--accent: #fabd2f');
    expect(html).toContain('--reader-font-family');
  });

  it('returns bookmark content rendered by the server markdown pipeline', async () => {
    const key = 'rendered-markdown-test';
    await env.BOOKMARK_BUCKET.put(`bookmark/${key}.json`, JSON.stringify({
      url: 'https://example.com/rendered',
      scrapedAt: '2026-08-04T00:00:00.000Z',
      firecrawlResponse: {
        success: true,
        data: {
          markdown: [
            '# Render Test',
            '',
            '1. _Download the source_',
            '2. **More importantly**',
            '',
            '| Feature | Works |',
            '| --- | --- |',
            '| GFM | yes |',
            '',
            '<video controls><source src="https://example.com/demo.webm" type="video/webm"></video>',
          ].join('\n'),
          metadata: {
            title: 'Render Test',
            sourceURL: 'https://example.com/rendered',
          },
        },
      },
    }));

    const response = await SELF.fetch(`https://example.com/api/bookmark/${key}`);

    expect(response.status).toBe(200);
    const data = await response.json() as { renderedHtml: string };
    expect(data.renderedHtml).toContain('<ol>');
    expect(data.renderedHtml).toContain('<em>Download the source</em>');
    expect(data.renderedHtml).toContain('<strong>More importantly</strong>');
    expect(data.renderedHtml).toContain('<table>');
    expect(data.renderedHtml).toContain('<video controls>');
    expect(data.renderedHtml).toContain('type="video/webm"');
  });

  describe('reader config API', () => {
    beforeEach(async () => {
      await env.NIKK_BOOKMARK_PROGRESS.delete(READER_CONFIG_KEY);
    });

    it('returns the default global reader config', async () => {
      const response = await SELF.fetch('https://example.com/api/config');

      expect(response.status).toBe(200);
      const data = await response.json() as { config: Record<string, unknown> };
      expect(data.config).toMatchObject({
        theme: 'gruvbox-dark',
        fontStyle: 'jetbrains-mono',
        fontSize: 16,
        readerWidth: '80ch',
        updatedAt: '',
      });
    });

    it('persists valid global reader config', async () => {
      const response = await SELF.fetch('https://example.com/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: 'dracula',
          fontStyle: 'source-serif',
          fontSize: 19,
          readerWidth: '92ch',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean; config: Record<string, unknown> };
      expect(data.success).toBe(true);
      expect(data.config).toMatchObject({
        theme: 'dracula',
        fontStyle: 'source-serif',
        fontSize: 19,
        readerWidth: '92ch',
      });
      expect(typeof data.config.updatedAt).toBe('string');

      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(READER_CONFIG_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toMatchObject(data.config);
    });

    it('normalizes unsupported reader config values', async () => {
      const response = await SELF.fetch('https://example.com/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: 'unknown',
          fontStyle: 'comic-sans',
          fontSize: 99,
          readerWidth: 'full',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { config: Record<string, unknown> };
      expect(data.config).toMatchObject({
        theme: 'gruvbox-dark',
        fontStyle: 'jetbrains-mono',
        fontSize: 22,
        readerWidth: '80ch',
      });
    });
  });
});
