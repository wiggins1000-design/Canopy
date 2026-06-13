import { useState, useEffect, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function TwoFAPage() {
  const { session, needsTwoFa, completeTwoFa, sendTwoFaCode, verifyTwoFaCode, signOut } = useAuth()
  const navigate = useNavigate()

  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [codeSent, setCodeSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef(null)

  // Send the first code on mount
  useEffect(() => {
    if (!needsTwoFa) return
    handleSendCode()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSendCode() {
    setSending(true)
    setError(null)
    const { error: err } = await sendTwoFaCode()
    setSending(false)
    if (err) {
      setError('Failed to send code. Please try again.')
      return
    }
    setCodeSent(true)
    startCooldown(30)
  }

  function startCooldown(seconds) {
    setResendCooldown(seconds)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleVerify(e) {
    e.preventDefault()
    if (code.length !== 6) return
    setLoading(true)
    setError(null)
    const { verified, error: err } = await verifyTwoFaCode(code)
    setLoading(false)
    if (err || !verified) {
      setError('Incorrect code. Please check and try again.')
      setCode('')
      return
    }
    completeTwoFa()
    navigate('/calendar', { replace: true })
  }

  if (!needsTwoFa) {
    return <Navigate to={session ? '/calendar' : '/login'} replace />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pa-50 via-white to-pb-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl shadow-sm px-6 py-4 mb-3">
            <img src="/CanopyWhiteLogo.gif" alt="Canopy" className="h-12" />
          </div>
          <p className="text-gray-500 text-sm">Share what matters.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Check your email</h2>
          <p className="text-xs text-gray-400 mb-6">
            {codeSent
              ? "We've sent a 6-digit code to your email address. Enter it below to continue."
              : 'Sending your sign-in code…'}
          </p>

          {sending && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {codeSent && (
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-center tracking-widest font-mono text-lg focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  autoFocus
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full py-3 rounded-xl bg-canopy-mid text-white font-semibold text-sm hover:bg-canopy-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify code'}
              </button>

              <div className="text-center">
                {resendCooldown > 0 ? (
                  <p className="text-xs text-gray-400">Resend code in {resendCooldown}s</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendCode}
                    className="text-xs text-canopy-mid hover:underline"
                  >
                    Send a new code
                  </button>
                )}
              </div>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <button
              type="button"
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Sign out and try a different account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
