// Shared Playwright mock helpers for Supabase API calls.
// Every test that needs an authenticated app session calls setupMocks(page).

export const SUPABASE_URL = 'https://zhxuegizpmukynifstuu.supabase.co'
export const MOCK_USER_ID  = 'aaaaaaaa-0000-0000-0000-000000000001'
export const MOCK_FAMILY_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
export const MOCK_MEMBER_ID = 'cccccccc-0000-0000-0000-000000000001'

const MOCK_USER = {
  id: MOCK_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'test@canopy.test',
  email_confirmed_at: '2024-01-01T00:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
}

export const MOCK_FAMILY = {
  id: MOCK_FAMILY_ID,
  name: 'Test Family',
  config: {
    children: [
      { name: 'Alice', dob: '2018-03-15' },
      { name: 'Bob',   dob: '2020-07-22' },
    ],
  },
  subscription_status: 'active',
  trial_ends_at: null,
  current_period_end: null,
  ical_token: 'test-ical-token',
}

export const MOCK_MEMBER = {
  id: MOCK_MEMBER_ID,
  family_id: MOCK_FAMILY_ID,
  user_id: MOCK_USER_ID,
  role: 'parent_a',
  display_name: 'Test Parent',
  email: 'test@canopy.test',
  phone: null,
  color: null,
  push_token: null,
  two_fa_enabled: false,
}

// Injects a non-expired Supabase session into localStorage before the page
// scripts run. This is enough for Supabase JS v2 to consider the user
// authenticated without making any auth network calls.
export async function injectSession(page) {
  // The app registers a PWA service worker even in dev mode (devOptions.enabled in
  // vite.config.js). A live SW can intercept fetch() at a layer that competes with
  // page.route() mocking, causing intermittent hangs/timeouts unrelated to test logic.
  // Neutering registration before any page script runs avoids that entirely.
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve()
  })

  const expiresAt = Math.floor(Date.now() / 1000) + 86400 // 24h from now
  await page.addInitScript(({ userId, email, expiresAt }) => {
    // Supabase JS v2 stores the session object directly (not wrapped in currentSession)
    const session = {
      access_token:  'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in:    86400,
      expires_at:    expiresAt,
      token_type:    'bearer',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        email_confirmed_at: '2024-01-01T00:00:00.000Z',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
      },
    }
    localStorage.setItem('sb-zhxuegizpmukynifstuu-auth-token', JSON.stringify(session))
  }, { userId: MOCK_USER_ID, email: 'test@canopy.test', expiresAt })
}

// Sets up catch-all route mocks for the Supabase project URL.
// Individual tests can call page.route() AFTER this to override specific endpoints.
export async function setupMocks(page, overrides = {}) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url  = route.request().url()
    const method = route.request().method()
    const accept = route.request().headers()['accept'] ?? ''
    const wantsSingle = accept.includes('vnd.pgrst.object')

    // ── Auth ──────────────────────────────────────────────────────────────────
    if (url.includes('/auth/v1/user')) {
      return route.fulfill(json(MOCK_USER))
    }
    if (url.includes('/auth/v1/token')) {
      return route.fulfill(json({
        access_token: 'new-access-token', refresh_token: 'new-refresh-token',
        expires_in: 86400, token_type: 'bearer', user: MOCK_USER,
      }))
    }

    // ── App settings (2FA check) ──────────────────────────────────────────────
    if (url.includes('/rest/v1/app_settings')) {
      const row = { key: 'two_fa_enabled', value: { enabled: false } }
      return route.fulfill(json(wantsSingle ? row : [row]))
    }

    // ── Core family data ──────────────────────────────────────────────────────
    if (url.includes('/rest/v1/family_members')) {
      return route.fulfill(json(wantsSingle ? (overrides.member ?? MOCK_MEMBER) : (overrides.members ?? [MOCK_MEMBER])))
    }
    if (url.includes('/rest/v1/families')) {
      return route.fulfill(json(wantsSingle ? MOCK_FAMILY : [MOCK_FAMILY]))
    }
    if (url.includes('/rest/v1/baseline_schedules')) {
      const row = overrides.schedule ?? null
      return route.fulfill(json(wantsSingle ? row : (row ? [row] : [])))
    }

    // ── Term dates (family_events source=term_dates) ──────────────────────────
    if (url.includes('/rest/v1/family_events')) {
      if (method === 'GET')    return route.fulfill(json(overrides.familyEvents ?? []))
      if (method === 'DELETE') return route.fulfill({ status: 204, body: '' })
    }

    // ── Info bank ─────────────────────────────────────────────────────────────
    if (url.includes('/rest/v1/info_bank')) {
      return route.fulfill(json(overrides.infoBank ?? []))
    }

    // ── School calendars (KB) ─────────────────────────────────────────────────
    if (url.includes('/rest/v1/school_calendars')) {
      return route.fulfill(json(overrides.schoolCalendars ?? []))
    }

    // ── RPCs ──────────────────────────────────────────────────────────────────
    if (url.includes('/rest/v1/rpc/create_family_event')) {
      return route.fulfill(json('new-event-uuid'))
    }
    if (url.includes('/rest/v1/rpc/')) {
      return route.fulfill(json(null))
    }

    // ── Edge functions ────────────────────────────────────────────────────────
    if (url.includes('/functions/v1/extract-school-info')) {
      const resp = overrides.extractSchoolInfo ?? { ok: false, error: 'Test mode — no real fetch' }
      return route.fulfill(json(resp))
    }
    if (url.includes('/functions/v1/check-term-dates')) {
      const resp = overrides.checkTermDates ?? { ok: true, results: [] }
      return route.fulfill(json(resp))
    }
    if (url.includes('/functions/v1/')) {
      return route.fulfill(json({ ok: false }))
    }

    // ── Everything else: pass through (realtime WS etc.) ─────────────────────
    return route.continue()
  })
}

// Navigates to the Settings page with the School Term Dates accordion open.
export async function goToTermDates(page) {
  await page.goto('/config')
  await page.getByText('School Term Dates').click()
}

function json(body) {
  return {
    status: body === null ? 204 : 200,
    headers: { 'Content-Type': 'application/json' },
    body: body === null ? '' : JSON.stringify(body),
  }
}
