import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'smoke.js',
  workers: 1,
  use: { browserName: 'chromium', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] }, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'python3 -u -m http.server 8001 --bind 0.0.0.0 --directory docs',
    url: 'http://127.0.0.1:8001',
    reuseExistingServer: false,
  },
});
