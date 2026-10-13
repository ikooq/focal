import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:3107',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'output/playwright/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:3107',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
