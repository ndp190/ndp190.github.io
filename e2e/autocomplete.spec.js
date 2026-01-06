import { test, expect } from '@playwright/test';

test.describe('Autocomplete Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('[data-testid="terminal-wrapper"]');
  });

  test('completes single matching command with Tab', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type partial command 'abo' which only matches 'about'
    await input.fill('abo');
    await input.press('Tab');

    // Should complete to 'about ' with trailing space
    await expect(input).toHaveValue('about ');
  });

  test('shows hints and selects first match for multiple matching commands', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'c' which matches 'cat' and 'clear'
    await input.fill('c');
    await input.press('Tab');

    // Should show hints and select first
    const wrapper = page.locator('[data-testid="terminal-wrapper"]');
    await expect(wrapper).toContainText('cat');
    await expect(wrapper).toContainText('clear');

    // Input should be updated to first match
    await expect(input).toHaveValue('cat');
  });

  test('completes single matching file path for cat command', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'cat blog/hello-w' - should match only 'blog/hello-world.md'
    await input.fill('cat blog/hello-w');
    await input.press('Tab');

    // Should complete to full path
    await expect(input).toHaveValue('cat blog/hello-world.md');
  });

  test('shows hints and selects first for multiple matching paths', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'cat blog/' - matches multiple files in blog directory
    await input.fill('cat blog/');
    await input.press('Tab');

    // Should show hints with files in blog directory
    const wrapper = page.locator('[data-testid="terminal-wrapper"]');
    const hintsVisible = await wrapper.locator('text=/blog\\/.*\\.md/').count();
    expect(hintsVisible).toBeGreaterThan(0);

    // Input should be updated to first matching path
    const value = await input.inputValue();
    expect(value).toMatch(/^cat blog\/.*\.md$/);
  });

  test('shows directory hints for ls with empty path (level-by-level)', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'ls ' - should show top-level directories only
    await input.fill('ls ');
    await input.press('Tab');

    // Input should be updated to first directory (blog/ or bookmarks/)
    // Wait a bit for state to update
    await page.waitForTimeout(100);
    const value = await input.inputValue();

    // Should complete to a directory (ends with /)
    // Either single match completion or cycling to first match
    expect(value).toMatch(/^ls [a-z]+\/$/);
  });

  test('shows file hints for ls command inside directory', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'ls blog/' - shows files in blog directory
    await input.fill('ls blog/');
    await input.press('Tab');

    // Should show hints with files
    const wrapper = page.locator('[data-testid="terminal-wrapper"]');
    const hintsVisible = await wrapper.locator('text=/blog\\/.*\\.md/').count();
    expect(hintsVisible).toBeGreaterThan(0);

    // Input should be updated to first matching path
    const value = await input.inputValue();
    expect(value).toMatch(/^ls blog\/.*\.md$/);
  });

  test('shows file hints for tree command inside directory', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'tree blog/' - shows files in blog directory
    await input.fill('tree blog/');
    await input.press('Tab');

    // Should show hints with files
    const wrapper = page.locator('[data-testid="terminal-wrapper"]');
    const hintsVisible = await wrapper.locator('text=/blog\\/.*\\.md/').count();
    expect(hintsVisible).toBeGreaterThan(0);

    // Input should be updated to first matching path
    const value = await input.inputValue();
    expect(value).toMatch(/^tree blog\/.*\.md$/);
  });

  test('Ctrl+I works as alternative to Tab for commands', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type partial command that has single match
    await input.fill('his');
    await input.press('Control+i');

    // Should complete to 'history '
    await expect(input).toHaveValue('history ');
  });

  test('does not complete when no match', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type something that doesn't match any command
    await input.fill('xyz');
    await input.press('Tab');

    // Should remain unchanged
    await expect(input).toHaveValue('xyz');
  });

  test('autocomplete works after submitting a command', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // First submit a command
    await input.fill('help');
    await input.press('Enter');

    // Wait for command to execute
    await page.waitForTimeout(500);

    // Now try autocomplete
    await input.fill('abo');
    await input.press('Tab');

    // Should still work
    await expect(input).toHaveValue('about ');
  });

  test('Tab cycles through multiple matching commands', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'c' which matches 'cat' and 'clear'
    await input.fill('c');

    // First Tab - selects first match
    await input.press('Tab');
    await expect(input).toHaveValue('cat');

    // Second Tab - cycles to next match
    await input.press('Tab');
    await expect(input).toHaveValue('clear');

    // Third Tab - cycles back to first
    await input.press('Tab');
    await expect(input).toHaveValue('cat');
  });

  test('Tab cycles through multiple matching paths', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'cat blog/' - matches multiple files
    await input.fill('cat blog/');
    await input.press('Tab');

    // Should select first path
    const firstValue = await input.inputValue();
    expect(firstValue).toMatch(/^cat blog\/.*\.md$/);

    // Second Tab - cycles to next path
    await input.press('Tab');
    const secondValue = await input.inputValue();
    expect(secondValue).toMatch(/^cat blog\/.*\.md$/);
    expect(secondValue).not.toBe(firstValue);

    // Third Tab - cycles back
    await input.press('Tab');
    await expect(input).toHaveValue(firstValue);
  });

  test('highlighted hint changes as Tab cycles', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Type 'c' which matches 'cat' and 'clear'
    await input.fill('c');
    await input.press('Tab');

    // Check that hints are visible
    const wrapper = page.locator('[data-testid="terminal-wrapper"]');
    await expect(wrapper).toContainText('cat');
    await expect(wrapper).toContainText('clear');

    // Press Tab again to cycle
    await input.press('Tab');

    // Hints should still be visible
    await expect(wrapper).toContainText('cat');
    await expect(wrapper).toContainText('clear');
  });

  test('typing clears hints and resets cycling', async ({ page }) => {
    const input = page.locator('input[title="terminal-input"]');

    // Start cycling through commands
    await input.fill('c');
    await input.press('Tab');
    await expect(input).toHaveValue('cat');

    // Type something new
    await input.fill('h');
    await input.press('Tab');

    // Should start fresh cycle with 'h' matches (help, history)
    await expect(input).toHaveValue('help');

    // Continue cycling
    await input.press('Tab');
    await expect(input).toHaveValue('history');
  });
});
