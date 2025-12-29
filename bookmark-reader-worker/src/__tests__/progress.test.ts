import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Reading Progress API', () => {
  const testKey = 'test-bookmark-key';

  beforeEach(async () => {
    // Clean up KV before each test
    await env.NIKK_BOOKMARK_PROGRESS.delete(testKey);
  });

  describe('GET /api/progress/:key', () => {
    it('should return null progress for new bookmark', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress).toBeNull();
    });

    it('should return saved progress for existing bookmark', async () => {
      // First save some progress
      const progress = {
        bookmarkKey: testKey,
        scrollPosition: 500,
        scrollPercentage: 25.5,
        lastReadAt: '2024-01-01T00:00:00.000Z',
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(progress));

      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress).toEqual(progress);
    });

    it('should handle URL-encoded keys', async () => {
      const encodedKey = 'test%20bookmark%20with%20spaces';
      const decodedKey = 'test bookmark with spaces';

      const progress = {
        bookmarkKey: decodedKey,
        scrollPosition: 100,
        scrollPercentage: 10,
        lastReadAt: '2024-01-01T00:00:00.000Z',
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(decodedKey, JSON.stringify(progress));

      const response = await SELF.fetch(
        `https://example.com/api/progress/${encodedKey}`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress.bookmarkKey).toBe(decodedKey);
    });
  });

  describe('POST /api/progress/:key', () => {
    it('should save reading progress', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scrollPosition: 1000,
            scrollPercentage: 50,
          }),
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.progress.bookmarkKey).toBe(testKey);
      expect(data.progress.scrollPosition).toBe(1000);
      expect(data.progress.scrollPercentage).toBe(50);
      expect(data.progress.lastReadAt).toBeDefined();
    });

    it('should update existing progress', async () => {
      // Save initial progress
      await SELF.fetch(`https://example.com/api/progress/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrollPosition: 500,
          scrollPercentage: 25,
        }),
      });

      // Update progress
      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scrollPosition: 2000,
            scrollPercentage: 100,
          }),
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress.scrollPosition).toBe(2000);
      expect(data.progress.scrollPercentage).toBe(100);

      // Verify it's persisted
      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      const storedProgress = JSON.parse(stored!);
      expect(storedProgress.scrollPosition).toBe(2000);
    });

    it('should store progress in KV', async () => {
      await SELF.fetch(`https://example.com/api/progress/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrollPosition: 750,
          scrollPercentage: 37.5,
        }),
      });

      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      expect(stored).not.toBeNull();

      const progress = JSON.parse(stored!);
      expect(progress.bookmarkKey).toBe(testKey);
      expect(progress.scrollPosition).toBe(750);
      expect(progress.scrollPercentage).toBe(37.5);
    });
  });
});
