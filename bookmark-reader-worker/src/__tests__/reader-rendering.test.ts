import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function escapeHtml(text: string): string {
  if (!text) return '';

  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getReaderMarkdownRenderer(): Promise<(markdown: string) => string> {
  const response = await SELF.fetch('https://example.com/offline-read-shell');
  const html = await response.text();
  const start = html.indexOf('function markdownToHtml(md)');
  const end = html.indexOf('function insertAnnotationMarkers', start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const source = html.slice(start, end);
  return new Function('escapeHtml', `${source}\nreturn markdownToHtml;`)(escapeHtml);
}

describe('bookmark reader markdown rendering', () => {
  it('renders markdown images as images instead of turning them into links first', async () => {
    const renderMarkdown = await getReaderMarkdownRenderer();
    const html = renderMarkdown('![Alt text](/media/images/example.png)\n\n[Source](https://example.com)');

    expect(html).toContain('<img src="/media/images/example.png" alt="Alt text" loading="lazy">');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Source</a>');
    expect(html).not.toContain('!<a');
  });

  it('renders common GFM blocks used by the blog renderer', async () => {
    const renderMarkdown = await getReaderMarkdownRenderer();
    const html = renderMarkdown([
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
    expect(html).toContain('<ul>');
    expect(html).toContain('<input type="checkbox" disabled checked> cached');
    expect(html).toContain('<input type="checkbox" disabled> queued');
  });
});
