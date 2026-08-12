import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

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
    expect(html).toContain('--content-width: 80ch');
    expect(html).toContain('--accent: #fabd2f');
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
});
