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

    it('should preserve isRead and isFavourite when saving scroll progress', async () => {
      // First set up progress with isRead and isFavourite
      const initialProgress = {
        bookmarkKey: testKey,
        scrollPosition: 0,
        scrollPercentage: 0,
        lastReadAt: '2024-01-01T00:00:00.000Z',
        isRead: true,
        isFavourite: true,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(initialProgress));

      // Save new scroll progress
      await SELF.fetch(`https://example.com/api/progress/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrollPosition: 1000,
          scrollPercentage: 50,
        }),
      });

      // Verify isRead and isFavourite are preserved
      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      const progress = JSON.parse(stored!);
      expect(progress.scrollPosition).toBe(1000);
      expect(progress.scrollPercentage).toBe(50);
      expect(progress.isRead).toBe(true);
      expect(progress.isFavourite).toBe(true);
    });

    it('should default isRead and isFavourite to false for new progress', async () => {
      await SELF.fetch(`https://example.com/api/progress/${testKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrollPosition: 500,
          scrollPercentage: 25,
        }),
      });

      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      const progress = JSON.parse(stored!);
      expect(progress.isRead).toBe(false);
      expect(progress.isFavourite).toBe(false);
    });
  });

  describe('POST /api/progress/:key/toggle-read', () => {
    it('should toggle read status from false to true', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-read`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.progress.isRead).toBe(true);
    });

    it('should toggle read status from true to false', async () => {
      // Set initial state to read
      const initialProgress = {
        bookmarkKey: testKey,
        scrollPosition: 0,
        scrollPercentage: 0,
        lastReadAt: '2024-01-01T00:00:00.000Z',
        isRead: true,
        isFavourite: false,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(initialProgress));

      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-read`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.progress.isRead).toBe(false);
    });

    it('should preserve other progress fields when toggling read', async () => {
      const initialProgress = {
        bookmarkKey: testKey,
        scrollPosition: 500,
        scrollPercentage: 25,
        lastReadAt: '2024-01-01T00:00:00.000Z',
        isRead: false,
        isFavourite: true,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(initialProgress));

      await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-read`,
        { method: 'POST' }
      );

      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      const progress = JSON.parse(stored!);
      expect(progress.scrollPosition).toBe(500);
      expect(progress.scrollPercentage).toBe(25);
      expect(progress.isFavourite).toBe(true);
      expect(progress.isRead).toBe(true);
    });

    it('should handle URL-encoded keys', async () => {
      const encodedKey = 'test%20bookmark%20key';
      const decodedKey = 'test bookmark key';

      const response = await SELF.fetch(
        `https://example.com/api/progress/${encodedKey}/toggle-read`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress.bookmarkKey).toBe(decodedKey);
      expect(data.progress.isRead).toBe(true);
    });
  });

  describe('POST /api/progress/:key/toggle-favourite', () => {
    it('should toggle favourite status from false to true', async () => {
      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-favourite`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.progress.isFavourite).toBe(true);
    });

    it('should toggle favourite status from true to false', async () => {
      // Set initial state to favourite
      const initialProgress = {
        bookmarkKey: testKey,
        scrollPosition: 0,
        scrollPercentage: 0,
        lastReadAt: '2024-01-01T00:00:00.000Z',
        isRead: false,
        isFavourite: true,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(initialProgress));

      const response = await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-favourite`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.progress.isFavourite).toBe(false);
    });

    it('should preserve other progress fields when toggling favourite', async () => {
      const initialProgress = {
        bookmarkKey: testKey,
        scrollPosition: 750,
        scrollPercentage: 50,
        lastReadAt: '2024-01-01T00:00:00.000Z',
        isRead: true,
        isFavourite: false,
      };
      await env.NIKK_BOOKMARK_PROGRESS.put(testKey, JSON.stringify(initialProgress));

      await SELF.fetch(
        `https://example.com/api/progress/${testKey}/toggle-favourite`,
        { method: 'POST' }
      );

      const stored = await env.NIKK_BOOKMARK_PROGRESS.get(testKey);
      const progress = JSON.parse(stored!);
      expect(progress.scrollPosition).toBe(750);
      expect(progress.scrollPercentage).toBe(50);
      expect(progress.isRead).toBe(true);
      expect(progress.isFavourite).toBe(true);
    });

    it('should handle URL-encoded keys', async () => {
      const encodedKey = 'test%20bookmark%20key';
      const decodedKey = 'test bookmark key';

      const response = await SELF.fetch(
        `https://example.com/api/progress/${encodedKey}/toggle-favourite`,
        { method: 'POST' }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.progress.bookmarkKey).toBe(decodedKey);
      expect(data.progress.isFavourite).toBe(true);
    });
  });
});
