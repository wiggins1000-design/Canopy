import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'pwa-install-dismissed'

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isIOS, setIsIOS]                 = useState(false)
  const [showBanner, setShowBanner]       = useState(false)

  useEffect(() => {
    // Already installed as a standalone app — nothing to do
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (localStorage.getItem(DISMISSED_KEY)) return

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone
    if (ios) {
      setIsIOS(true)
      setShowBanner(true)
      return
    }

    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      setShowBanner(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setInstallPrompt(null)
      setShowBanner(false)
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setShowBanner(false)
  }

  return { showBanner, isIOS, install, dismiss, canInstall: !!installPrompt }
}

export default function PWAInstallPrompt() {
  const { showBanner, isIOS, install, dismiss, canInstall } = usePWAInstall()
  const [showIOSSteps, setShowIOSSteps] = useState(false)

  if (!showBanner) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <img src="/icons/icon-192.png" alt="Canopy" className="w-8 h-8 rounded-lg" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Add Canopy to your home screen</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {isIOS
                  ? 'Install for quick access — works offline too'
                  : 'Install for a better experience and quick access'}
              </p>
            </div>
            <button
              onClick={dismiss}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isIOS ? (
            <div className="mt-3">
              {!showIOSSteps ? (
                <button
                  onClick={() => setShowIOSSteps(true)}
                  className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl"
                >
                  Show me how
                </button>
              ) : (
                <div className="space-y-2 mt-1">
                  <IOSStep num={1} icon="share">
                    Tap the <strong>Share</strong> button at the bottom of Safari
                  </IOSStep>
                  <IOSStep num={2} icon="plus-square">
                    Scroll down and tap <strong>Add to Home Screen</strong>
                  </IOSStep>
                  <IOSStep num={3} icon="check">
                    Tap <strong>Add</strong> in the top right
                  </IOSStep>
                </div>
              )}
            </div>
          ) : canInstall ? (
            <div className="mt-3 flex gap-2">
              <button
                onClick={install}
                className="flex-1 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl"
              >
                Install
              </button>
              <button
                onClick={dismiss}
                className="flex-1 bg-gray-100 text-gray-700 text-sm font-semibold py-2.5 rounded-xl"
              >
                Not now
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function IOSStep({ num, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {num}
      </span>
      <p className="text-sm text-gray-700">{children}</p>
    </div>
  )
}
