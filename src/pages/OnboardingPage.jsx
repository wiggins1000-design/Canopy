import { useState } from 'react'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'

export default function OnboardingPage() {
  const { createFamily, joinFamily } = useFamily()
  const { signOut } = useAuth()
  const [step, setStep] = useState('choose') // 'choose' | 'create' | 'join'
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    setLoading(true)
    setError(null)
    const { error } = await createFamily()
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleJoin() {
    if (!inviteCode.trim()) { setError('Enter the invite code.'); return }
    setLoading(true)
    setError(null)
    const { error } = await joinFamily(inviteCode.trim())
    if (error) setError(error.message)
    setLoading(false)
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

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          {step === 'choose' && (
            <>
              <Button className="w-full py-3" onClick={() => setStep('create')}>
                Create a new platform
              </Button>
              <Button variant="secondary" className="w-full py-3" onClick={() => setStep('join')}>
                Join with an invite code
              </Button>
              <button
                className="text-xs text-gray-400 w-full text-center mt-2 hover:underline"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          )}

          {step === 'create' && (
            <>
              <button onClick={() => setStep('choose')} className="text-sm text-canopy-mid flex items-center gap-1 mb-1">
                ← Back
              </button>
              <p className="text-xs text-gray-400">
                You'll be set up as Parent A. Share an invite code from the People tab for Parent B to join.
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full py-3" loading={loading} onClick={handleCreate}>
                Set up
              </Button>
            </>
          )}

          {step === 'join' && (
            <>
              <button onClick={() => setStep('choose')} className="text-sm text-canopy-mid flex items-center gap-1 mb-1">
                ← Back
              </button>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Invite code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD34"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-canopy-green"
                maxLength={8}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full py-3" loading={loading} onClick={handleJoin}>
                Join family
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
