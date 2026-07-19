import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { initSentry, ErrorBoundary } from './lib/sentry'
import { PLAN_IMPORT_STORAGE_KEY } from './lib/planImport'
import { isNativePlatform } from './lib/supabase'

initSentry()

// Only the web/PWA build needs the service worker (offline caching, web push).
// The native Capacitor app runs on the https://localhost origin, where
// registration fails outright and serves no purpose anyway — native push goes
// through Capacitor's own plugin, not the web Push API.
if ('serviceWorker' in navigator && !isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
  })
}

// Capture a ?plan= handoff from the parenting plan tool into localStorage
// before any redirect (e.g. ProtectedRoute -> /login, or the email
// confirmation round-trip) can drop the query string. Runs at module load,
// not inside a React effect, since redirects can happen before effects fire.
;(function capturePlanImport() {
  const params = new URLSearchParams(window.location.search)
  const plan = params.get('plan')
  if (!plan) return
  localStorage.setItem(PLAN_IMPORT_STORAGE_KEY, plan)
  params.delete('plan')
  const rest = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
})()

function ErrorFallback() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6 bg-canopy-frost">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500">
          Canopy hit an unexpected error. Reloading usually fixes it — if this keeps happening, let us know at{' '}
          <a href="mailto:hello@canopy-app.app" className="text-canopy-mid hover:underline">hello@canopy-app.app</a>.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-canopy-mid text-white text-sm font-semibold hover:bg-canopy-deep transition-colors"
        >
          Reload Canopy
        </button>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
