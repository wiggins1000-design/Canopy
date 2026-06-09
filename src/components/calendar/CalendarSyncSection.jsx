import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import Button from '../ui/Button'

const SYNC_TYPE_OPTIONS = [
  { id: 'schedule',         label: 'Custody schedule',      desc: 'Which parent has the children each day' },
  { id: 'events',           label: 'Calendar events',        desc: 'Family events added manually or via FamilyFeed' },
  { id: 'term_dates',       label: 'School term dates',      desc: 'Holidays and INSET days from your school' },
  { id: 'schedule_changes', label: 'Schedule changes',       desc: 'Approved swaps and holiday requests' },
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

function buildGoogleOAuthUrl(userId, syncTypes) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) return null
  const state    = `google|${userId}|${encodeURIComponent(JSON.stringify(syncTypes))}`
  const redirect = `${SUPABASE_URL}/functions/v1/calendar-oauth-callback`
  const params   = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirect,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

function buildOutlookOAuthUrl(userId, syncTypes) {
  const clientId = import.meta.env.VITE_OUTLOOK_CLIENT_ID
  if (!clientId) return null
  const state    = `outlook|${userId}|${encodeURIComponent(JSON.stringify(syncTypes))}`
  const redirect = `${SUPABASE_URL}/functions/v1/calendar-oauth-callback`
  const params   = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirect,
    response_type: 'code',
    // consumers = personal Microsoft accounts only (Outlook.com, Hotmail, Live.com)
    // Work/school accounts require Azure publisher verification — tracked for future
    scope:         'https://graph.microsoft.com/Calendars.ReadWrite offline_access',
    state,
  })
  return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`
}

export default function CalendarSyncSection() {
  const { family, isParent } = useFamily()
  const { user } = useAuth()

  const [icalToken,    setIcalToken]    = useState(null)
  const [icalTypes,    setIcalTypes]    = useState(['schedule', 'events', 'term_dates', 'schedule_changes'])
  const [connections,  setConnections]  = useState([])
  const [oauthTypes,   setOauthTypes]   = useState(['events', 'schedule_changes'])
  const [loadingToken, setLoadingToken] = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [disconnecting, setDisconnecting] = useState(null)

  // Load existing connections
  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('calendar_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .then(({ data }) => setConnections(data ?? []))
  }, [user?.id])

  // Check for OAuth callback result in URL params
  useEffect(() => {
    const params   = new URLSearchParams(window.location.search)
    const connected = params.get('calendar_connected')
    const error     = params.get('calendar_error')
    if (connected || error) {
      window.history.replaceState({}, '', window.location.pathname)
      if (connected) {
        supabase
          .from('calendar_connections')
          .select('*')
          .eq('user_id', user?.id)
          .eq('is_active', true)
          .then(({ data }) => setConnections(data ?? []))
      }
    }
  }, [user?.id])

  async function getIcalToken() {
    setLoadingToken(true)
    const { data, error } = await supabase.rpc('get_or_create_ical_token')
    if (!error && data) setIcalToken(data)
    setLoadingToken(false)
  }

  function icalUrl() {
    if (!icalToken) return null
    const types = icalTypes.join(',')
    return `${SUPABASE_URL}/functions/v1/calendar-feed?token=${icalToken}&types=${types}`
  }

  function copyUrl() {
    const url = icalUrl()
    if (!url) return
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function disconnect(provider) {
    setDisconnecting(provider)
    await supabase
      .from('calendar_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', provider)
    setConnections((prev) => prev.filter((c) => c.provider !== provider))
    setDisconnecting(null)
  }

  if (!isParent) return null

  const googleUrl  = buildGoogleOAuthUrl(user?.id, oauthTypes)
  const outlookUrl = buildOutlookOAuthUrl(user?.id, oauthTypes)
  const gcConn     = connections.find(c => c.provider === 'google')
  const outlookConn = connections.find(c => c.provider === 'outlook')

  return (
    <section className="space-y-4 pt-2">
      <div>
        <label className="text-sm font-semibold text-gray-700 block">Calendar sync</label>
        <p className="text-xs text-gray-400 mt-0.5">
          Subscribe to your Canopy calendar in any app, or connect Google or Outlook for instant sync.
        </p>
      </div>

      {/* iCal subscription */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Subscribe (iCal)</p>
            <p className="text-xs text-gray-400">Works with Apple Calendar, Google, Outlook, and any other app</p>
          </div>
        </div>

        {/* Event type selection */}
        <div className="space-y-2">
          {SYNC_TYPE_OPTIONS.map((opt) => (
            <label key={opt.id} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={icalTypes.includes(opt.id)}
                onChange={(e) => setIcalTypes(prev =>
                  e.target.checked ? [...prev, opt.id] : prev.filter(t => t !== opt.id)
                )}
                className="accent-blue-600 w-4 h-4 rounded"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                <p className="text-xs text-gray-400">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {icalToken ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
              <span className="text-xs text-gray-600 font-mono flex-1 truncate">{icalUrl()}</span>
              <button
                onClick={copyUrl}
                className="text-xs font-semibold text-blue-600 hover:underline shrink-0"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Paste this URL into your calendar app's "Subscribe to calendar" or "Add calendar from URL" option.
            </p>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" loading={loadingToken} onClick={getIcalToken}>
            Generate subscription link
          </Button>
        )}
      </div>

      {/* Google Calendar */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <GoogleIcon className="w-5 h-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Google Calendar</p>
            <p className="text-xs text-gray-400">Instant two-way sync</p>
          </div>
          {gcConn && (
            <span className="ml-auto text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              Connected
            </span>
          )}
        </div>

        {!gcConn && (
          <OAuthTypeSelector types={oauthTypes} onChange={setOauthTypes} />
        )}

        {gcConn ? (
          <Button
            variant="ghost"
            className="w-full text-red-500 text-sm"
            loading={disconnecting === 'google'}
            onClick={() => disconnect('google')}
          >
            Disconnect Google Calendar
          </Button>
        ) : googleUrl ? (
          <a
            href={googleUrl}
            className="flex items-center justify-center w-full bg-white border border-gray-300 text-gray-800 text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Connect Google Calendar
          </a>
        ) : (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
            Google OAuth not configured — add VITE_GOOGLE_CLIENT_ID to your environment.
          </p>
        )}
      </div>

      {/* Outlook Calendar */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <OutlookIcon className="w-5 h-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Outlook Calendar</p>
            <p className="text-xs text-gray-400">Instant sync with Outlook and Microsoft 365</p>
          </div>
          {outlookConn && (
            <span className="ml-auto text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              Connected
            </span>
          )}
        </div>

        {!outlookConn && (
          <OAuthTypeSelector types={oauthTypes} onChange={setOauthTypes} />
        )}

        {outlookConn ? (
          <Button
            variant="ghost"
            className="w-full text-red-500 text-sm"
            loading={disconnecting === 'outlook'}
            onClick={() => disconnect('outlook')}
          >
            Disconnect Outlook Calendar
          </Button>
        ) : outlookUrl ? (
          <a
            href={outlookUrl}
            className="flex items-center justify-center w-full bg-white border border-gray-300 text-gray-800 text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Connect Outlook Calendar
          </a>
        ) : (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
            Outlook OAuth not configured — add VITE_OUTLOOK_CLIENT_ID to your environment.
          </p>
        )}
      </div>
    </section>
  )
}

function OAuthTypeSelector({ types, onChange }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">What to sync</p>
      {SYNC_TYPE_OPTIONS.filter(o => o.id !== 'schedule').map((opt) => (
        <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={types.includes(opt.id)}
            onChange={(e) => onChange(prev =>
              e.target.checked ? [...prev, opt.id] : prev.filter(t => t !== opt.id)
            )}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm text-gray-700">{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

function CalendarIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
      <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
      <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
    </svg>
  )
}

function GoogleIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function OutlookIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0078D4" />
      <path d="M13 6h6v5h-6V6zm0 7h6v5h-6v-5zM5 6h7v5.5H5V6zm0 7h7v5.5H5V13z" fill="white" opacity="0.9"/>
    </svg>
  )
}
