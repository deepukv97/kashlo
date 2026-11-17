const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
  ],
});
