import { test, expect } from '@playwright/test'

/**
 * Unauthenticated smoke tests — confirm the auth gate redirects work and
 * the public surface (login, error pages) renders without crashing.
 *
 * The full library/upload/people flows live in authenticated.spec.ts and
 * require a Supabase test user (see tests/e2e/README.md).
 */

test.describe('public smoke', () => {
  test('login page renders', async ({ page }) => {
    const res = await page.goto('/auth/login')
    expect(res?.status(), 'login page should be 2xx').toBeLessThan(400)
    await expect(page.getByRole('heading')).toBeVisible({ timeout: 10_000 })
  })

  test('library redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 })
  })

  test('admin redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 })
  })

  test('people page redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/people')
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 })
  })

  test('auth error page renders without throwing', async ({ page }) => {
    const res = await page.goto('/auth/error?error=test')
    expect(res?.status()).toBeLessThan(500)
  })
})
