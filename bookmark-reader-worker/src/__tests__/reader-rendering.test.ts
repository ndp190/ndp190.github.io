import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

async function renderBookmarkMarkdown(markdown: string): Promise<string> {
  const key = `rendering-${crypto.randomUUID()}`;
  await env.BOOKMARK_BUCKET.put(`bookmark/${key}.json`, JSON.stringify({
    url: 'https://example.com/article',
    scrapedAt: '2026-08-04T00:00:00.000Z',
    firecrawlResponse: {
      success: true,
      data: {
        markdown,
        metadata: {
          title: 'Render Test',
          sourceURL: 'https://example.com/article',
        },
      },
    },
  }));

  const response = await SELF.fetch(`https://example.com/api/bookmark/${key}`);
  const data = await response.json() as { renderedHtml: string };

  await env.BOOKMARK_BUCKET.delete(`bookmark/${key}.json`);

  expect(response.status).toBe(200);
  return data.renderedHtml;
}

describe('bookmark reader markdown rendering', () => {
  it('renders markdown images as images instead of turning them into links first', async () => {
    const html = await renderBookmarkMarkdown('![Alt text](/media/images/example.png)\n\n[Source](https://example.com)');

    expect(html).toContain('<img src="/media/images/example.png" alt="Alt text">');
    expect(html).toContain('<a href="https://example.com">Source</a>');
    expect(html).not.toContain('!<a');
  });

  it('renders common GFM blocks used by the blog renderer', async () => {
    const html = await renderBookmarkMarkdown([
      '| Name | Value |',
      '| --- | --- |',
      '| **Status** | `ok` |',
      '',
      '- [x] cached',
      '- [ ] queued',
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td><strong>Status</strong></td>');
    expect(html).toContain('<td><code>ok</code></td>');
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked[^>]*disabled[^>]*> cached/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled[^>]*> queued/);
  });
});
