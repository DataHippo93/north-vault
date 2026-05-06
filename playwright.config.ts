import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for NorthVault.
 *
 * Local dev (default): runs against npm run dev on http://localhost:3005.
 * CI / Microsoft Playwright Testing: when PLAYWRIGHT_SERVICE_URL is set,
 * use playwright.service.config.ts instead (see test:e2e:cloud script).
 *
 * Local: npm run test:e2e
 * Cloud: npm run test:e2e:cloud
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3005'
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? undefined : 4,
  reporter: isCI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'playwright-report/junit.xml' }],
      ]
    : 'list',

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Auto-start dev server locally; in CI we point at a deployed preview
  // via PLAYWRIGHT_BASE_URL + PLAYWRIGHT_SKIP_WEBSERVER=1.
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
})
