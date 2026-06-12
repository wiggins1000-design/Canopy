import { useState } from 'react'
import { useSubscription } from '../../hooks/useSubscription'
import { useSubscribeAction } from './useSubscribeAction'

export default function TrialBanner() {
  const { isTrialing, daysLeft } = useSubscription()
  const { subscribe, loading } = useSubscribeAction()
  const [dismissed, setDismissed] = useState(false)

  if (!isTrialing || dismissed) return null

  const urgent = daysLeft <= 3

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
      urgent ? 'bg-amber-50 border-b border-amber-200' : 'bg-canopy-frost border-b border-canopy-light'
    }`}>
      <span className={urgent ? 'text-amber-800' : 'text-canopy-deep'}>
        <span className="font-semibold">{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
        {' '}in your free trial
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={subscribe}
          disabled={loading}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
            urgent
              ? 'bg-amber-600 hover:bg-amber-700 text-white'
              : 'bg-canopy-mid hover:bg-canopy-deep text-white'
          }`}
        >
          {loading ? '…' : 'Subscribe'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-gray-400 hover:text-gray-600 p-0.5"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
