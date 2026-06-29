import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function JoinPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [planId]          = useState(() => new URLSearchParams(window.location.search).get('plan_id'))
  const [status, setStatus] = useState('loading')
  const [email,  setEmail]  = useState('')
  const [sent,   setSent]   = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!planId) { setStatus('no_plan'); return }
    if (!user)   { setStatus('needs_login'); return }

    async function acceptAndLoad() {
      const { data: accepted, error } = await supabase.rpc('pp_accept_invite', { p_plan_id: planId })
      if (error) { setStatus('error'); return }

      const { data: planRow } = await supabase
        .from('pp_plans')
        .select('p1_name, p2_name, plan_data')
        .eq('id', planId)
        .single()

      if (planRow?.plan_data) {
        try {
          localStorage.setItem('pp_draft',   JSON.stringify(planRow.plan_data))
          localStorage.setItem('pp_plan_id', planId)
          localStorage.setItem('pp_role',    'collaborator')
          localStorage.setItem('pp_p1_name', planRow.p1_name || '')
        } catch {}
      }

      navigate('/plan')
    }

    acceptAndLoad()
  }, [user, loading, planId, navigate])

  async function sendMagicLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    })
    setSending(false)
    if (!error) setSent(true)
  }

  return (
    <div className="min-h-screen bg-[#f4fbf4]">
      <header className="bg-[#1b4332] px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#52b788] flex items-center justify-center text-[#1b4332] text-xs font-bold">C</div>
          <span className="text-white font-semibold text-sm">parentingplan.help</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-10">
        {status === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-4 border-[#52b788] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {status === 'no_plan' && (
          <div className="text-center space-y-2 py-20">
            <p className="text-lg font-semibold text-[#1b4332]">Invalid invite link</p>
            <p className="text-sm text-gray-500">This link doesn't look right. Check your email and try again.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center space-y-2 py-20">
            <p className="text-lg font-semibold text-[#1b4332]">Something went wrong</p>
            <p className="text-sm text-gray-500">Please try clicking the link in your email again.</p>
          </div>
        )}

        {status === 'needs_login' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-[#1b4332]">You've been invited to review a parenting plan</h1>
              <p className="text-sm text-gray-600">
                Enter your email to open it. We'll send you a magic link — no password needed.
              </p>
            </div>
            {sent ? (
              <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-1">
                <p className="text-sm font-semibold text-[#1b4332]">Check your email</p>
                <p className="text-sm text-[#2d6a4f]">We sent a link to <strong>{email}</strong>. Click it to open the plan.</p>
              </div>
            ) : (
              <form onSubmit={sendMagicLink} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Your email address"
                  className="w-full border border-[#d8f3dc] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#52b788] bg-white"
                />
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
                >
                  {sending ? 'Sending link…' : 'Open the plan →'}
                </button>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
