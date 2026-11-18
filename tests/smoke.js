/* ═══ smoke.js — headless browser integration test ═══
   Runs against the built docs/index.html via Playwright.
   Usage: node tests/smoke.js (requires: npx playwright install chromium) */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS = join(ROOT, 'docs');

/* Serve docs/ on a random port */
let server;
let baseURL;

async function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-m', 'http.server', '0'], { cwd: DOCS });
    server.stdout.on('data', d => {
      const match = d.toString().match(/Serving HTTP on .*:(\d+)/);
      if (match) {
        baseURL = `http://localhost:${match[1]}`;
        resolve(baseURL);
      }
    });
    server.stderr.on('data', d => reject(new Error(d.toString())));
    setTimeout(() => reject(new Error('Server start timeout')), 5000);
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (server) server.kill();
    resolve();
  });
}

test.describe('The Playground — Smoke Test', () => {
  test.beforeAll(async () => {
    await startServer();
    console.log(`🌐 Serving at ${baseURL}`);
  });

  test.afterAll(async () => {
    await stopServer();
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
      // Filter out expected CSP reports from inline scripts in dev
      const realErrors = errors.filter(e => !e.includes('Content Security Policy'));
      expect(realErrors).toHaveLength(0);
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
    await page.click('[data-act="open-model-picker"]');

    await expect(page.locator('.mp-modal')).toBeVisible();
    await expect(page.locator('#mpBody')).toContainText('Nemotron');
    await expect(page.locator('#mpBody')).toContainText('GLM');

    // Close picker
    await page.click('[data-act="close-model-picker"]');
    await expect(page.locator('.mp-modal')).toBeHidden();
  });

  test('opens settings', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');
    await page.click('[data-act="open-settings"]');

    await expect(page.locator('.st-modal')).toBeVisible();
    await expect(page.locator('#freeKeys')).toBeVisible();
    await expect(page.locator('#paidKeys')).toBeVisible();

    // Close settings
    await page.click('[data-act="close-settings"]');
    await expect(page.locator('.st-modal')).toBeHidden();
  });

  test('sidebar toggle works', async ({ page }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.click('#landing');

    // Sidebar should be open on desktop
    await expect(page.locator('#sidebar')).toHaveClass(/open/);

    // Collapse
    await page.click('[data-act="toggle-sidebar-desktop"]');
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);

    // Expand
    await page.click('[data-act="toggle-sidebar-desktop"]');
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
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
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 5000 });
    const reg = await page.evaluate(() => navigator.serviceWorker.ready);
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
});
