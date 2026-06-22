import { useState } from 'react'
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

const APP_URL = 'https://my.canopy-app.app'
const ALL_TYPES = ['schedule', 'events', 'term_dates', 'schedule_changes']


export default function CalendarSyncSection() {
  const { isParent } = useFamily()
  const { user } = useAuth()

  const [icalToken,    setIcalToken]    = useState(null)
  const [icalTypes,    setIcalTypes]    = useState(ALL_TYPES)
  const [loadingToken, setLoadingToken] = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [tokenError,   setTokenError]   = useState(null)

  async function getIcalToken() {
    setLoadingToken(true)
    setTokenError(null)
    const { data, error } = await supabase.rpc('get_or_create_ical_token')
    if (error) {
      setTokenError(error.message)
    } else if (!data) {
      setTokenError('No token returned — you may not have a parent role in this family.')
    } else {
      setIcalToken(data)
    }
    setLoadingToken(false)
  }

  function icalUrl() {
    if (!icalToken) return null
    const allSelected = ALL_TYPES.every(t => icalTypes.includes(t)) && icalTypes.length === ALL_TYPES.length
    return allSelected
      ? `${APP_URL}/cal/${icalToken}`
      : `${APP_URL}/cal/${icalToken}?types=${icalTypes.join(',')}`
  }

  function copyUrl() {
    const url = icalUrl()
    if (!url) return
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isParent) return null

  return (
    <section className="space-y-4 pt-2">
      <div>
        <label className="text-sm font-semibold text-gray-700 block">Calendar sync</label>
        <p className="text-xs text-gray-400 mt-0.5">
          Subscribe to your Canopy calendar in Apple Calendar, Google Calendar, Outlook, or any other app.
        </p>
      </div>

      {/* iCal subscription */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-canopy-mid shrink-0" />
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
                className="accent-canopy-mid w-4 h-4 rounded"
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
                className="text-xs font-semibold text-canopy-mid hover:underline shrink-0"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Paste this URL into your calendar app's "Subscribe to calendar" or "Add calendar from URL" option.
            </p>
          </div>
        ) : (
          <>
            <Button variant="secondary" className="w-full" loading={loadingToken} onClick={getIcalToken}>
              Generate subscription link
            </Button>
            {tokenError && (
              <p className="text-xs text-red-600 mt-1">{tokenError}</p>
            )}
          </>
        )}
      </div>

    </section>
  )
}

function _OAuthTypeSelector_unused({ types, onChange }) {
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
            className="accent-canopy-mid w-4 h-4"
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

