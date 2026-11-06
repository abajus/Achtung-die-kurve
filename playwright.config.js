import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'node server.js',
    env: { PORT: '3100' },
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
  },
});