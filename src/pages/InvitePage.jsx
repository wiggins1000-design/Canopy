import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import { useLocale } from '../hooks/useLocale'
import { supabase, APP_ORIGIN } from '../lib/supabase'
import { firstName } from '../lib/childUtils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'

export default function InvitePage() {
  const { family, members, userRole, isParent, parentA, parentB, generateInvite, updateFamilyConfig } = useFamily()
  const { signOut, user } = useAuth()
  const regionConfig = useLocale()
  const [inviteCode, setInviteCode] = useState(null)
  const [inviteRole, setInviteRole] = useState(null)
  const [generating, setGenerating] = useState(null) // 'parent_b' | 'third_party' | null
  const [copied, setCopied] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState(null)

  const navigate = useNavigate()
  const hasParentB = !!parentB
  const [togglingChildcare, setTogglingChildcare] = useState(null)
  const [rateInputs,  setRateInputs]  = useState({})
  const [rateSaving,  setRateSaving]  = useState(null)

  // Initialise rate inputs from family config
  useEffect(() => {
    const rates = family?.config?.childcare_rates ?? {}
    setRateInputs(
      Object.fromEntries(Object.entries(rates).map(([id, pence]) => [id, (pence / 100).toFixed(2)]))
    )
  }, [JSON.stringify(family?.config?.childcare_rates)]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleChildcare(userId) {
    setTogglingChildcare(userId)
    const current = family?.config?.childcare_members ?? []
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    await updateFamilyConfig({ childcare_members: next })
    setTogglingChildcare(null)
  }

  async function saveRate(userId) {
    setRateSaving(userId)
    const pence = Math.round(parseFloat(rateInputs[userId] || '0') * 100)
    const current = family?.config?.childcare_rates ?? {}
    await updateFamilyConfig({ childcare_rates: { ...current, [userId]: pence } })
    setRateSaving(null)
  }

  const inviteLink = inviteCode ? `${APP_ORIGIN}/join/${inviteCode}` : null
  const senderName = user?.user_metadata?.display_name ?? 'Someone'

  async function handleGenerateInvite(role) {
    setGenerating(role)
    setEmailSent(false)
    setEmailError(null)
    const { data, error } = await generateInvite(role)
    if (!error && data) {
      setInviteCode(data.code)
      setInviteRole(role)
      setCopied(false)

      if (inviteEmail.trim()) {
        const link = `${APP_ORIGIN}/join/${data.code}`
        const { error: emailErr } = await supabase.functions.invoke('send-invite-email', {
          body: {
            recipientEmail: inviteEmail.trim(),
            inviteCode:     data.code,
            inviteLink:     link,
            role,
            senderName,
          },
        })
        if (emailErr) {
          setEmailError('Invite generated but email failed to send. Share the link below instead.')
        } else {
          setEmailSent(true)
        }
      }
    }
    setGenerating(null)
  }

  function copyLink() {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className="px-4 py-5 space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500" aria-label="Back">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">People</h1>
      </div>

      {/* Children */}
      {family?.config?.children?.filter((c) => c.name).length > 0 && (
        <div className="bg-gray-50 rounded-2xl px-4 py-3 border border-gray-200">
          <p className="text-xs font-semibold text-canopy-mid uppercase tracking-wide">Children</p>
          <p className="font-bold text-gray-900 mt-0.5">
            {family.config.children.filter((c) => c.name).map((c) => firstName(c.name)).join(' & ')}
          </p>
        </div>
      )}

      {/* Members list */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Members</h2>
        {[...members].sort((a, b) => {
          const order = { parent_a: 0, parent_b: 1, third_party: 2 }
          return (order[a.role] ?? 2) - (order[b.role] ?? 2)
        }).map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                m.role === 'parent_a' ? 'bg-pa-400 text-white' :
                m.role === 'parent_b' ? 'bg-pb-400 text-white' :
                'bg-yellow-200 text-yellow-800'
              }`}>
                {m.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{m.display_name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <Badge
                    label={m.role === 'parent_a' ? 'Parent A' : m.role === 'parent_b' ? 'Parent B' : 'Read-only'}
                    type={m.role === 'parent_a' ? 'parent_a' : m.role === 'parent_b' ? 'parent_b' : 'read_only'}
                  />
                  {m.role === 'third_party' && (family?.config?.childcare_members ?? []).includes(m.user_id) && (
                    <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">Childcare</span>
                  )}
                </div>
              </div>
              {m.role === userRole && <span className="text-xs text-gray-400 shrink-0">You</span>}
            </div>

            {/* Childcare toggle — parents only, third_party members only */}
            {isParent && m.role === 'third_party' && (() => {
              const isCarerOn    = (family?.config?.childcare_members ?? []).includes(m.user_id)
              const rateVal      = rateInputs[m.user_id] ?? ''
              const storedPence  = family?.config?.childcare_rates?.[m.user_id] ?? 0
              const currentPence = Math.round(parseFloat(rateVal || '0') * 100)
              const isDirty      = currentPence !== storedPence
              return (
                <>
                  <button
                    onClick={() => toggleChildcare(m.user_id)}
                    disabled={togglingChildcare === m.user_id}
                    className={`w-full flex items-center justify-between py-2 px-1 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 ${togglingChildcare === m.user_id ? 'opacity-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 text-left">Childcare provider</p>
                      <p className="text-xs text-gray-400 text-left">Lets them log childcare hours</p>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${isCarerOn ? 'bg-canopy-mid' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isCarerOn ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                  </button>

                  {isCarerOn && (
                    <div className="px-1 pb-1 space-y-1.5">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Hourly rate</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">{regionConfig.currency.symbol}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.50"
                            value={rateVal}
                            onChange={(e) => setRateInputs((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                            placeholder="e.g. 12.50"
                            className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
                          />
                        </div>
                        <button
                          onClick={() => saveRate(m.user_id)}
                          disabled={rateSaving === m.user_id || !isDirty}
                          className="shrink-0 px-4 py-2 rounded-xl bg-canopy-mid text-white text-sm font-semibold hover:bg-canopy-deep disabled:opacity-40 transition-colors"
                        >
                          {rateSaving === m.user_id ? '…' : !isDirty ? '✓' : 'Save'}
                        </button>
                      </div>
                      <p className="text-xs text-gray-400">Used to calculate total wages in the childcare summary.</p>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        ))}
      </section>

      {/* Invite section — only parents */}
      {isParent && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Invite someone</h2>

          {!hasParentB && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
              <p className="text-sm text-yellow-800 font-medium">Parent B hasn't joined yet</p>
              <p className="text-xs text-yellow-600 mt-0.5">Generate an invite code below and share it.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500 block">
              Their email address <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="e.g. sarah@email.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
            <p className="text-xs text-gray-400">If entered, Canopy will send them an invite email directly.</p>
          </div>

          <div className="flex gap-2">
            {!hasParentB && (
              <Button className="flex-1 text-xs" loading={generating === 'parent_b'} onClick={() => handleGenerateInvite('parent_b')}>
                {inviteEmail.trim() ? 'Email invite to Parent B' : 'Invite Parent B'}
              </Button>
            )}
            <Button className="flex-1 text-xs" loading={generating === 'third_party'} onClick={() => handleGenerateInvite('third_party')}>
              {inviteEmail.trim() ? 'Email read-only invite' : 'Invite read-only'}
            </Button>
          </div>

          {emailSent && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
              Invite email sent to {inviteEmail}
            </div>
          )}
          {emailError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              {emailError}
            </div>
          )}

          {inviteCode && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Invite for {inviteRole === 'parent_b' ? 'Parent B' : 'read-only access'} — expires in 7 days
              </p>

              {/* Shareable link (primary) */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Share this link — they tap it to join directly:</p>
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <span className="text-xs text-gray-600 flex-1 truncate font-mono">{inviteLink}</span>
                  <Button variant="secondary" className="text-xs py-1.5 shrink-0" onClick={copyLink}>
                    {copied ? '✓ Copied' : 'Copy link'}
                  </Button>
                </div>
              </div>

              {/* Code fallback */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Or share the code manually:</p>
                <span className="font-mono text-2xl font-bold tracking-widest text-gray-900">{inviteCode}</span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
