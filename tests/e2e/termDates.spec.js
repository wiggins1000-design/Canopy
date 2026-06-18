import { test, expect } from '@playwright/test'
import { injectSession, setupMocks, goToTermDates } from './helpers/mockApi.js'

// ── Regression: opening accordion must not blank the page ────────────────────

test('term dates accordion opens without crashing', async ({ page }) => {
  await injectSession(page)
  await setupMocks(page)
  await goToTermDates(page)
  await expect(page.getByText('No term dates added yet.')).toBeVisible()
})

// ── Manual entry — validation ────────────────────────────────────────────────

test.describe('manual entry form', () => {
  test.beforeEach(async ({ page }) => {
    await injectSession(page)
    await setupMocks(page)
    await goToTermDates(page)
    await page.getByText('Add manually').click()
  })

  test('submit with no date shows "Enter a date."', async ({ page }) => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Enter a date.')).toBeVisible()
  })

  test('holiday with no end date shows "Enter an end date."', async ({ page }) => {
    // Holiday is the default type
    await page.locator('input[type="date"]').first().fill('2024-10-21')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Enter an end date.')).toBeVisible()
  })

  test('holiday with end before start shows date order error', async ({ page }) => {
    await page.locator('input[type="date"]').first().fill('2024-10-25')
    await page.locator('input[type="date"]').last().fill('2024-10-21')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('End date must be after start date.')).toBeVisible()
  })

  test('switching to INSET Day hides title selector and end date input', async ({ page }) => {
    await page.getByRole('button', { name: 'INSET Day', exact: true }).click()
    await expect(page.getByText('Title')).not.toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveCount(1)
  })

  test('valid INSET entry saves and resets the date input', async ({ page }) => {
    await page.getByRole('button', { name: 'INSET Day', exact: true }).click()
    await page.locator('input[type="date"]').fill('2024-09-02')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.locator('input[type="date"]')).toHaveValue('')
  })

  test('valid holiday entry saves and resets the start date input', async ({ page }) => {
    await page.locator('input[type="date"]').first().fill('2024-10-21')
    await page.locator('input[type="date"]').last().fill('2024-10-25')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.locator('input[type="date"]').first()).toHaveValue('')
  })
})

// ── Events list ──────────────────────────────────────────────────────────────

test('shows event count summary when events exist', async ({ page }) => {
  await injectSession(page)
  await setupMocks(page, {
    familyEvents: [
      { id: '1', title: 'INSET Day', event_date: '2024-09-02', end_date: null,         source_subject: "St Mary's", source: 'term_dates' },
      { id: '2', title: 'Half Term', event_date: '2024-10-21', end_date: '2024-10-25', source_subject: "St Mary's", source: 'term_dates' },
    ],
  })
  await goToTermDates(page)
  await expect(page.getByText(/2 term dates/)).toBeVisible()
})

test('Inspect button opens bottom sheet with event details', async ({ page }) => {
  await injectSession(page)
  await setupMocks(page, {
    familyEvents: [
      { id: '1', title: 'INSET Day', event_date: '2024-09-02', end_date: null, source_subject: "St Mary's", source: 'term_dates' },
    ],
  })
  await goToTermDates(page)
  await page.getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByText('INSET Day')).toBeVisible()
  await expect(page.getByText('2 Sep 2024')).toBeVisible()
})
