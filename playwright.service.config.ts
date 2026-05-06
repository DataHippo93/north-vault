/**
 * Microsoft Playwright Testing (Azure) service config overlay.
 *
 * Used by `npm run test:e2e:cloud`. Requires:
 *   PLAYWRIGHT_SERVICE_URL              wss://<region>.api.playwright-test.io/...
 *   PLAYWRIGHT_SERVICE_ACCESS_TOKEN     access token from the workspace settings
 *
 * The MS Playwright Testing package is only required at cloud-test time,
 * so we use a dynamic require - tsc won't fail when the package isn't
 * installed in dev.
 */
import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

interface MptModule {
  getServiceConfig: (
    base: unknown,
    opts: {
      serviceAuthType: 'ACCESS_TOKEN' | 'ENTRA_ID'
      os: string
      runId?: string
      useCloudHostedBrowsers?: boolean
    },
  ) => ReturnType<typeof defineConfig>
  ServiceOS: { LINUX: string; WINDOWS: string }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mpt = require('@azure/microsoft-playwright-testing') as MptModule

export default defineConfig(
  baseConfig,
  mpt.getServiceConfig(baseConfig, {
    serviceAuthType: 'ACCESS_TOKEN',
    os: mpt.ServiceOS.LINUX,
    runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
    useCloudHostedBrowsers: true,
  }),
)
