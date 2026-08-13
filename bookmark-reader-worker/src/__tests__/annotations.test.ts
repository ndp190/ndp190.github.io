import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Annotations API', () => {
  const testKey = 'test-bookmark-key';

  beforeEach(async () => {
    // Clean up KV before each test
    await env.NIKK_BOOKMARK_ANNOTATION.delete(testKey);
  });

  describe('GET /api/annotations/:key', () => {
    it('should return empty array for bookmark with no annotations', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.annotations).toEqual([]);
    });

    it('should return existing annotations', async () => {
      // Store some annotations
      const annotations = {
        annotations: [
          {
            id: 'test-id-1',
            bookmarkKey: testKey,
            selectedText: 'test text',
            note: 'test note',
            startOffset: 0,
            endOffset: 9,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
      await env.NIKK_BOOKMARK_ANNOTATION.put(testKey, JSON.stringify(annotations));

      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.annotations).toHaveLength(1);
      expect(data.annotations[0].selectedText).toBe('test text');
      expect(data.annotations[0].note).toBe('test note');
    });

    it('should return multiple annotations', async () => {
      const annotations = {
        annotations: [
          {
            id: 'test-id-1',
            bookmarkKey: testKey,
            selectedText: 'first text',
            note: 'first note',
            startOffset: 0,
            endOffset: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'test-id-2',
            bookmarkKey: testKey,
            selectedText: 'second text',
            note: 'second note',
            startOffset: 20,
            endOffset: 31,
            createdAt: '2024-01-01T01:00:00.000Z',
          },
        ],
      };
      await env.NIKK_BOOKMARK_ANNOTATION.put(testKey, JSON.stringify(annotations));

      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.annotations).toHaveLength(2);
    });
  });

  describe('POST /api/annotations/:key', () => {
    it('should create a new annotation', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText: 'highlighted text',
            note: 'my annotation note',
            startOffset: 100,
            endOffset: 116,
          }),
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.annotation.selectedText).toBe('highlighted text');
      expect(data.annotation.note).toBe('my annotation note');
      expect(data.annotation.bookmarkKey).toBe(testKey);
      expect(data.annotation.id).toBeDefined();
      expect(data.annotation.createdAt).toBeDefined();
    });

    it('should create annotation without note', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText: 'just highlighted',
            note: '',
            startOffset: 0,
            endOffset: 16,
          }),
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.annotation.selectedText).toBe('just highlighted');
      expect(data.annotation.note).toBe('');
    });

    it('should add annotation to existing list', async () => {
      // Create first annotation
      await SELF.fetch(`https://example.com/api/annotations/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: 'first',
          note: 'first note',
          startOffset: 0,
          endOffset: 5,
        }),
      });

      // Create second annotation
      await SELF.fetch(`https://example.com/api/annotations/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: 'second',
          note: 'second note',
          startOffset: 10,
          endOffset: 16,
        }),
      });

      // Verify both exist
      const response = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );
      const data = await response.json();
      expect(data.annotations).toHaveLength(2);
    });

    it('should store annotation in KV', async () => {
      await SELF.fetch(`https://example.com/api/annotations/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: 'stored text',
          note: 'stored note',
          startOffset: 0,
          endOffset: 11,
        }),
      });

      const stored = await env.NIKK_BOOKMARK_ANNOTATION.get(testKey);
      expect(stored).not.toBeNull();

      const annotations = JSON.parse(stored!);
      expect(annotations.annotations).toHaveLength(1);
      expect(annotations.annotations[0].selectedText).toBe('stored text');
    });
  });

  describe('DELETE /api/annotations/:key/:id', () => {
    it('should delete an annotation', async () => {
      // Create an annotation first
      const createResponse = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText: 'to delete',
            note: 'will be deleted',
            startOffset: 0,
            endOffset: 9,
          }),
        }
      );
      const createData = await createResponse.json();
      const annotationId = createData.annotation.id;

      // Delete the annotation
      const deleteResponse = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}/${annotationId}`,
        { method: 'DELETE' }
      );

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.success).toBe(true);

      // Verify it's gone
      const getResponse = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );
      const getData = await getResponse.json();
      expect(getData.annotations).toHaveLength(0);
    });

    it('should only delete specified annotation', async () => {
      // Create two annotations
      const create1 = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText: 'keep this',
            note: 'should remain',
            startOffset: 0,
            endOffset: 9,
          }),
        }
      );
      const data1 = await create1.json();

      const create2 = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedText: 'delete this',
            note: 'should be removed',
            startOffset: 20,
            endOffset: 31,
          }),
        }
      );
      const data2 = await create2.json();

      // Delete only the second one
      await SELF.fetch(
        `https://example.com/api/annotations/${testKey}/${data2.annotation.id}`,
        { method: 'DELETE' }
      );

      // Verify only first remains
      const getResponse = await SELF.fetch(
        `https://example.com/api/annotations/${testKey}`
      );
      const getData = await getResponse.json();
      expect(getData.annotations).toHaveLength(1);
      expect(getData.annotations[0].id).toBe(data1.annotation.id);
      expect(getData.annotations[0].selectedText).toBe('keep this');
    });

    it('should return 404 for non-existent bookmark', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/annotations/non-existent-key/some-id`,
        { method: 'DELETE' }
      );

      expect(response.status).toBe(404);
    });
  });
});

describe('Knowledge annotation refresh', () => {
  let knowledgeKey: string;

  beforeEach(async () => {
    knowledgeKey = `annotation-knowledge-${crypto.randomUUID()}`;
    await env.BOOKMARK_BUCKET.put('bookmark/manifest.json', JSON.stringify({
      bookmarks: [
        {
          id: 1,
          key: knowledgeKey,
          title: 'Global Annotation Search',
          description: 'A bookmark used to refresh the knowledge index.',
          url: 'https://example.com/global-annotation-search',
        },
      ],
      updatedAt: '2026-08-12T00:00:00.000Z',
    }));
    await env.BOOKMARK_BUCKET.put(`bookmark/${knowledgeKey}.json`, JSON.stringify({
      url: 'https://example.com/global-annotation-search',
      scrapedAt: '2026-08-12T00:00:00.000Z',
      firecrawlResponse: {
        success: true,
        data: {
          markdown: '# Global Annotation Search\n\nAnnotation updates should refresh search.',
          metadata: {
            title: 'Global Annotation Search',
            description: 'A bookmark used to refresh the knowledge index.',
            sourceURL: 'https://example.com/global-annotation-search',
          },
        },
      },
    }));
    await env.NIKK_BOOKMARK_ANNOTATION.delete(knowledgeKey);
    await env.BOOKMARK_BUCKET.delete(`bookmark/knowledge/docs/${encodeURIComponent(knowledgeKey)}.json`);
  });

  it('updates global annotation search after create and delete', async () => {
    const createResponse = await SELF.fetch(
      `https://example.com/api/annotations/${knowledgeKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: 'knowledge highlight',
          note: 'espresso searchable note',
          startOffset: 0,
          endOffset: 19,
        }),
      }
    );
    const createData = await createResponse.json();

    const searchResponse = await SELF.fetch('https://example.com/api/knowledge/annotations?q=espresso');
    const searchData = await searchResponse.json();
    expect(searchData.annotations).toHaveLength(1);
    expect(searchData.annotations[0].bookmarkKey).toBe(knowledgeKey);

    const deleteResponse = await SELF.fetch(
      `https://example.com/api/annotations/${knowledgeKey}/${createData.annotation.id}`,
      { method: 'DELETE' }
    );
    expect(deleteResponse.status).toBe(200);

    const afterDeleteResponse = await SELF.fetch('https://example.com/api/knowledge/annotations?q=espresso');
    const afterDeleteData = await afterDeleteResponse.json();
    expect(afterDeleteData.annotations).toHaveLength(0);
  });
});
