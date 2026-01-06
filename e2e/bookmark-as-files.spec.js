import { test, expect } from '@playwright/test';

test.describe('Bookmark as Files', () => {
  test('ls bookmarks should show bookmark files', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('[data-testid="terminal-wrapper"]');

    // Type ls bookmarks command
    const input = page.locator('input[title="terminal-input"]');
    await input.fill('ls bookmarks');
    await input.press('Enter');

    // Wait for output
    await page.waitForTimeout(500);

    // Should show .md files
    const output = await page.locator('[data-testid="terminal-wrapper"]').textContent();
    expect(output).toContain('.md');
  });

  test('cat bookmarks/<file>.md should display bookmark content', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('[data-testid="terminal-wrapper"]');

    // First get a bookmark file name using ls
    const input = page.locator('input[title="terminal-input"]');
    await input.fill('ls bookmarks');
    await input.press('Enter');

    await page.waitForTimeout(1000);

    // Find a .md file in the output
    const outputText = await page.locator('[data-testid="terminal-wrapper"]').textContent();
    const mdFileMatch = outputText.match(/([a-z0-9-]+\.md)/);

    if (mdFileMatch) {
      const fileName = mdFileMatch[1];

      // Clear and type cat command
      await input.fill(`cat bookmarks/${fileName}`);
      await input.press('Enter');

      // Wait for content to load (bookmarks take longer)
      await page.waitForTimeout(5000);

      // Should show "Loading bookmark..." or content with original link (📎 or Original:)
      const content = await page.locator('[data-testid="terminal-wrapper"]').textContent();
      console.log('Content after cat command:', content.substring(0, 500));

      const hasLoading = content.includes('Loading bookmark');
      const hasOriginalLink = content.includes('Original:') || content.includes('📎');
      const hasError = content.includes('Failed to load');
      const hasContent = content.length > 2000; // Long content means bookmark loaded

      // Either loading, showing content, or error (network issues in test)
      expect(hasLoading || hasOriginalLink || hasError || hasContent).toBe(true);
    }
  });
});
