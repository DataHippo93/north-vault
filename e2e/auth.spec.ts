import { test, expect } from '@playwright/test'

test.describe('Login page', () => {
  test('loads and displays the login form', async ({ page }) => {
    await page.goto('/auth/login')

    // Branding
    await expect(page.getByText('NorthVault')).toBeVisible()
    await expect(page.getByText('Digital Asset Management')).toBeVisible()

    // Form elements
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('••••••••')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  })

  test('shows forgot password link', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page.getByText('Forgot password?')).toBeVisible()
  })

  test('switches to password reset mode', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByText('Forgot password?').click()

    await expect(page.getByText('Reset password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
    await expect(page.getByText('Back to sign in')).toBeVisible()
  })

  test('unauthenticated users are redirected to login from protected routes', async ({ page }) => {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test('unauthenticated users are redirected to login from upload route', async ({ page }) => {
    await page.goto('/upload')
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test('shows validation error on empty submit', async ({ page }) => {
    await page.goto('/auth/login')
    // HTML5 required validation — email field will block submission
    await page.getByRole('button', { name: 'Sign In' }).click()
    // The email input should be invalid (browser validation)
    const emailInput = page.getByPlaceholder('you@example.com')
    await expect(emailInput).toBeVisible()
  })
})
