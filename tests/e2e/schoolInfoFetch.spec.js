import { test, expect } from '@playwright/test'
import { injectSession, setupMocks, goToTermDates, SUPABASE_URL } from './helpers/mockApi.js'

// 1x1 transparent PNG — smallest valid image for testing file inputs
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('photo extraction flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectSession(page)
    await setupMocks(page)
    await goToTermDates(page)
    await page.getByText('Add from photos').click()
  })

  test('shows photo upload button', async ({ page }) => {
    await expect(page.getByText('Tap to choose photos')).toBeVisible()
  })

  test('uploading a photo calls extract-school-info and shows review step', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/functions/v1/extract-school-info`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: [
            { title: 'INSET Day', date: '2024-09-02', end_date: null },
            { title: 'Half Term', date: '2024-10-21', end_date: '2024-10-25' },
          ],
        }),
      }),
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'termcard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    await expect(page.getByText(/2 dates found/)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('INSET Day', { exact: true })).toBeVisible()
    await expect(page.getByText('Half Term', { exact: true })).toBeVisible()
  })

  test('review step has Save and Cancel buttons', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/functions/v1/extract-school-info`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: [{ title: 'INSET Day', date: '2024-09-02', end_date: null }],
        }),
      }),
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'termcard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    await expect(page.getByRole('button', { name: /Save/ })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('edge function error shows user-friendly message', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/functions/v1/extract-school-info`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Could not read the images.' }),
      }),
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'termcard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    await expect(page.getByText('Could not read the images.')).toBeVisible({ timeout: 5000 })
  })

  test('no dates found shows informational message', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/functions/v1/extract-school-info`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: [] }),
      }),
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'termcard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    await expect(page.getByText('No term dates found in these images')).toBeVisible({ timeout: 5000 })
  })

  test('Cancel in review step returns to upload button', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/functions/v1/extract-school-info`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: [{ title: 'INSET Day', date: '2024-09-02', end_date: null }],
        }),
      }),
    )

    await page.locator('input[type="file"]').setInputFiles({
      name: 'termcard.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Tap to choose photos')).toBeVisible()
  })
})
