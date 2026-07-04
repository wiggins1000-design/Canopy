import * as Sentry from '@sentry/capacitor'
import * as SentryReact from '@sentry/react'

// @sentry/capacitor doesn't re-export React-specific bits (ErrorBoundary, hooks) —
// those only exist in @sentry/react, so pull it separately for consumers of this module.
export { ErrorBoundary } from '@sentry/react'

// No-ops entirely if VITE_SENTRY_DSN isn't set (e.g. local dev) — no noise, no dependency
// on the DSN existing to run the app.
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init(
    {
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    },
    SentryReact.init,
  )
}

export function setSentryUser(userId) {
  Sentry.setUser(userId ? { id: userId } : null)
}

export function setSentryLocale(locale) {
  Sentry.setTag('locale', locale ?? 'en-GB')
}

export { Sentry }
