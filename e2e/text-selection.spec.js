import { test, expect } from '@playwright/test';

test.describe('Weather Feature', () => {
  test('should display weather for Bien Hoa, Vietnam', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for the about section to load
    await page.waitForSelector('[data-testid="about"]');

    // Wait for weather to load (check for location text)
    await page.waitForSelector('text=Bien Hoa, Vietnam', { timeout: 10000 });

    // Verify weather info is displayed
    const weatherLocation = await page.getByText('Bien Hoa, Vietnam');
    expect(await weatherLocation.isVisible()).toBe(true);

    // Check that temperature is displayed (should contain °C)
    const temperatureText = await page.locator('[data-testid="about"]').locator('text=/\\d+°C/');
    expect(await temperatureText.count()).toBeGreaterThan(0);

    // Check Day or Night is displayed
    const dayNightText = await page.locator('[data-testid="about"]').locator('text=/Day|Night/');
    expect(await dayNightText.count()).toBeGreaterThan(0);

    console.log('Weather displayed successfully!');
  });

  test('weather section should be centered and aligned on desktop', async ({ page }) => {
    // Set viewport to desktop size
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:3000');

    // Wait for weather section to load
    await page.waitForSelector('[data-testid="weather-section"]');
    await page.waitForSelector('[data-testid="weather-info"]');

    // Get the weather section and info elements
    const weatherSection = page.locator('[data-testid="weather-section"]');
    const weatherInfo = page.locator('[data-testid="weather-info"]');

    // Check that weather section has centered alignment (flexbox centering)
    const sectionStyles = await weatherSection.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        display: styles.display,
        flexDirection: styles.flexDirection,
        alignItems: styles.alignItems,
        textAlign: styles.textAlign,
      };
    });

    console.log('Weather section styles:', sectionStyles);

    expect(sectionStyles.display).toBe('flex');
    expect(sectionStyles.flexDirection).toBe('column');
    expect(sectionStyles.alignItems).toBe('center');
    expect(sectionStyles.textAlign).toBe('center');

    // Check weather info text alignment
    const infoStyles = await weatherInfo.evaluate((el) => {
      return window.getComputedStyle(el).textAlign;
    });

    console.log('Weather info text-align:', infoStyles);
    expect(infoStyles).toBe('center');

    // Verify the ASCII art (pre element) and info are vertically stacked
    const preBox = await page.locator('[data-testid="weather-section"] pre').boundingBox();
    const infoBox = await weatherInfo.boundingBox();

    if (preBox && infoBox) {
      // Info should be below the pre element
      expect(infoBox.y).toBeGreaterThan(preBox.y);

      // Both should be horizontally centered (their centers should be close)
      const preCenter = preBox.x + preBox.width / 2;
      const infoCenter = infoBox.x + infoBox.width / 2;
      const centerDiff = Math.abs(preCenter - infoCenter);

      console.log(`Pre center: ${preCenter}, Info center: ${infoCenter}, Diff: ${centerDiff}`);

      // Allow some tolerance for centering (within 50px)
      expect(centerDiff).toBeLessThan(50);
    }

    console.log('Weather alignment test passed!');
  });
});

test.describe('Social Links', () => {
  test('should display social links with icons', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for the about section to load
    await page.waitForSelector('[data-testid="about"]');

    // Check that social links are present with icons (SVG elements inside links)
    const githubLink = page.locator('a[href="https://github.com/ndp190"]');
    const linkedinLink = page.locator('a[href="https://www.linkedin.com/in/ndp190"]');
    const twitterLink = page.locator('a[href="https://twitter.com/ndp190"]');
    const emailLink = page.locator('a[href="mailto:ndp190@gmail.com"]');

    // Verify all links are visible
    expect(await githubLink.isVisible()).toBe(true);
    expect(await linkedinLink.isVisible()).toBe(true);
    expect(await twitterLink.isVisible()).toBe(true);
    expect(await emailLink.isVisible()).toBe(true);

    // Verify each link has an SVG icon
    expect(await githubLink.locator('svg').count()).toBe(1);
    expect(await linkedinLink.locator('svg').count()).toBe(1);
    expect(await twitterLink.locator('svg').count()).toBe(1);
    expect(await emailLink.locator('svg').count()).toBe(1);

    // Verify link text
    expect(await githubLink.textContent()).toContain('GitHub');
    expect(await linkedinLink.textContent()).toContain('LinkedIn');
    expect(await twitterLink.textContent()).toContain('Twitter');
    expect(await emailLink.textContent()).toContain('Email');

    console.log('Social links with icons displayed correctly!');
  });
});

test.describe('Text Selection', () => {
  test('should allow text selection without losing selection', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for the about section to load
    await page.waitForSelector('[data-testid="about"]');

    // Use triple-click to select a line of text (more reliable than drag)
    const textElement = await page.getByText("Projects:");
    await textElement.waitFor({ state: 'visible' });

    // Triple-click to select the entire line
    await textElement.click({ clickCount: 3 });

    // Wait a moment for any handlers to process
    await page.waitForTimeout(100);

    // Check if text is still selected
    const selectedText = await page.evaluate(() => window.getSelection()?.toString());
    console.log('Selected text:', selectedText);

    // The selection should not be empty
    expect(selectedText).toBeTruthy();
    expect(selectedText.length).toBeGreaterThan(0);
  });

  test('should focus input on simple click (no drag)', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for terminal to load
    await page.waitForSelector('[data-testid="terminal-wrapper"]');

    // Click somewhere on the page (not dragging)
    await page.click('[data-testid="terminal-wrapper"]');

    // Wait a moment
    await page.waitForTimeout(100);

    // Check if the input is focused
    const inputFocused = await page.evaluate(() => {
      const input = document.querySelector('input[title="terminal-input"]');
      return document.activeElement === input;
    });

    expect(inputFocused).toBe(true);
  });

  test('blog list font size should be 1rem (16px)', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for the about section to load
    await page.waitForSelector('[data-testid="about"]');

    // Check if blog list exists - look for the specific blog list by the file names
    const blogList = page.locator('[data-testid="about"]').getByText(/hello-world\.md/).locator('..');

    if (await blogList.count() > 0) {
      const fontSize = await blogList.first().evaluate((el) => window.getComputedStyle(el.parentElement).fontSize);
      console.log('Blog list font size:', fontSize);
      expect(fontSize).toBe('16px'); // 1rem = 16px
    }
  });
});
