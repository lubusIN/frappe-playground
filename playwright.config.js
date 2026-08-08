const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 600000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: './tests/results',
  reporter: [['html', { outputFolder: './tests/results' }]],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run test:serve',
    url: 'http://127.0.0.1:8002',
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8002',
    trace: 'on',
    screenshot: 'on',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
