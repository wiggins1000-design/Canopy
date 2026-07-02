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

// ── Sync from school website — failure handling ──────────────────────────────

test.describe('sync from school website', () => {
  const SCHOOL = { data: { school_url: 'https://www.example-school.test', school_name: 'Example School' } }

  test('scrape failure shows a clear message and opens the photos panel', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, {
      infoBank: [SCHOOL],
      checkTermDates: {
        ok: true,
        results: [{
          homepageUrl: 'https://www.example-school.test',
          status:      'error',
          error:       'Found the term dates page but could not extract dates. If dates are in an image or scanned PDF they cannot be read automatically.',
        }],
      },
    })
    await goToTermDates(page)
    await page.getByText('Add from Canopy Knowledge Base').click()
    await page.getByRole('button', { name: 'Sync from school website' }).click()

    // Standalone banner (outside the accordions, always visible regardless of which
    // panel is open) — same generic message regardless of *why* it failed, see finding below.
    await expect(page.getByText(/Couldn't read dates from Example School — add via photos or manually below/)).toBeVisible()
    // Photos panel auto-opens, pre-targeted at the failed school.
    await expect(page.getByText(/For Example School — upload a photo of the term dates/)).toBeVisible()
  })

  test('network/invoke error is also handled gracefully', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, { infoBank: [SCHOOL] })
    // Force the edge function call itself to fail at the network level (not just return an error body).
    await page.route('**/functions/v1/check-term-dates', route => route.abort())

    await goToTermDates(page)
    await page.getByText('Add from Canopy Knowledge Base').click()
    await page.getByRole('button', { name: 'Sync from school website' }).click()
    await expect(page.getByText('Could not reach school website.')).toBeVisible()
  })

  test('success reports how many dates were added', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, {
      infoBank: [SCHOOL],
      checkTermDates: {
        ok: true,
        results: [{ homepageUrl: 'https://www.example-school.test', status: 'ok', eventsAdded: 12 }],
      },
    })
    await goToTermDates(page)
    await page.getByText('Add from Canopy Knowledge Base').click()
    await page.getByRole('button', { name: 'Sync from school website' }).click()
    await expect(page.getByText('Example School: 12 new dates added')).toBeVisible()
  })
})

// ── Add term dates from photos ────────────────────────────────────────────────

test.describe('add term dates from photos', () => {
  function uploadFakePhoto(page) {
    return page.setInputFiles('input[type="file"]', {
      name: 'term-dates.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-image-bytes'),
    })
  }

  test('successful extraction shows a reviewable list of dates', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, {
      extractSchoolInfo: {
        ok: true,
        dates: [
          { date: '2024-10-21', end_date: '2024-10-25', title: 'Half Term' },
          { date: '2024-09-02', end_date: null,         title: 'INSET Day' },
        ],
      },
    })
    await goToTermDates(page)
    await page.getByText('Add from photos').click()
    await uploadFakePhoto(page)

    await expect(page.getByText(/2 dates found/)).toBeVisible()
    await expect(page.getByText('Half Term')).toBeVisible()
    // exact: true — "INSET Day" alone otherwise substring-matches the "Add manually"
    // panel's unrelated description text ("...a single INSET day or holiday period").
    await expect(page.getByText('INSET Day', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Save 2 dates/ }).click()
    await expect(page.getByText('2 dates saved.')).toBeVisible()
  })

  test('no dates found shows a helpful retry message, not a dead end', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, { extractSchoolInfo: { ok: true, dates: [] } })
    await goToTermDates(page)
    await page.getByText('Add from photos').click()
    await uploadFakePhoto(page)
    await expect(page.getByText('No term dates found in these images. Try a clearer photo of the term dates.')).toBeVisible()
  })

  test('extraction error from the edge function is surfaced, not swallowed', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page, {
      extractSchoolInfo: { error: 'Could not read text from any of the images. Please try clearer photos.' },
    })
    await goToTermDates(page)
    await page.getByText('Add from photos').click()
    await uploadFakePhoto(page)
    await expect(page.getByText('Could not read text from any of the images. Please try clearer photos.')).toBeVisible()
  })

  test('network/invoke error while uploading is handled gracefully', async ({ page }) => {
    await injectSession(page)
    await setupMocks(page)
    await page.route('**/functions/v1/extract-school-info', route => route.abort())
    await goToTermDates(page)
    await page.getByText('Add from photos').click()
    await uploadFakePhoto(page)
    await expect(page.getByText('Could not read the images.')).toBeVisible()
  })
})
