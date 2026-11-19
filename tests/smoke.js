/* ═══ smoke.js — headless browser integration test ═══
   Runs against the built docs/index.html via Playwright.
   Usage: npm run test:browser (requires: npx playwright install chromium) */

import { test, expect } from '@playwright/test';
const baseURL = 'http://127.0.0.1:8001';

test.describe('The Playground — Smoke Test', () => {
  test.beforeEach(async ({ page }) => {
    // Deterministic offline shell tests: no real provider keys or external traffic.
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      if (route.request().resourceType() === 'fetch') return route.fulfill({ json: { data: [] } });
      return route.fulfill({ status: 200, body: '' });
    });
    await page.addInitScript(() => localStorage.setItem('key_openrouter', 'test-only'));
  });

  test('loads without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(baseURL, { waitUntil: 'networkidle' });

    // Landing screen should appear
    await expect(page.locator('#landing')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.landing-title')).toContainText('playground');

    if (errors.length) {
      console.log('Console errors:', errors);
      expect(errors).toHaveLength(0);
    }
  });

  test('enters app on click', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');

    // App UI should appear
    await expect(page.locator('.app')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('#userInput')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();
  });

  test('opens model picker', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');
    await page.locator('[data-act="open-model-picker"]').first().click();

    await expect(page.locator('.mp-modal')).toBeVisible();
    await expect(page.locator('#mpBody')).toContainText('Nemotron');
    await expect(page.locator('#mpBody')).toContainText('GLM');

    // Close picker
    await page.locator('.mp-close').click();
    await expect(page.locator('.mp-modal')).toBeHidden();
  });

  test('opens settings', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');
    await page.click('[data-act="open-settings"]');

    await expect(page.locator('#stOverlay .st-modal')).toBeVisible();
    await expect(page.locator('#freeKeys')).toBeVisible();
    await expect(page.locator('#paidKeys')).toBeVisible();

    // Close settings
    await page.locator('#stOverlay .st-close').click();
    await expect(page.locator('#stOverlay .st-modal')).toBeHidden();
  });

  test('sidebar toggle works', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');

    // Sidebar should be open on desktop
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);

    // Collapse
    await page.click('[data-act="toggle-sidebar-desktop"]');
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);

    // Expand
    await page.click('[data-act="toggle-sidebar-desktop"]');
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
  });

  test('typing in input works', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');

    await page.fill('#userInput', 'hello world');
    await expect(page.locator('#userInput')).toHaveValue('hello world');
  });

  test('PWA manifest loads', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', 'manifest.webmanifest');

    const response = await page.request.get(`${baseURL}/manifest.webmanifest`);
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons).toBeTruthy();
  });

  test('service worker registers', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });

    // Wait for SW registration
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()), null, { timeout: 5000 });
    const reg = await page.evaluate(async () => !!(await navigator.serviceWorker.ready));
    expect(reg).toBeTruthy();
  });

  test('no CSP violations on load', async ({ page }) => {
    const cspViolations = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');
    await page.waitForTimeout(1000);

    expect(cspViolations).toHaveLength(0);
  });
  test('damaged history is preserved and recovery is accessible', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('chat_history', '{damaged'));
    await page.goto(baseURL);
    await page.click('#landing');
    await page.click('[data-act="open-settings"]');
    await expect(page.locator('[data-act="recover-chats"]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('chat_history'))).toBe('{damaged');
    expect(await page.evaluate(() => saveChats())).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('chat_history'))).toBe('{damaged');
  });

  test('configured provider origins are not blocked by CSP', async ({ page }) => {
    await page.goto(baseURL);
    const result = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', e => violations.push(e.blockedURI));
      for (const url of ['https://openrouter.ai/api/v1/models', 'https://api.z.ai/api/paas/v4/models']) {
        await fetch(url);
      }
      return violations;
    });
    expect(result).toEqual([]);
  });

});
