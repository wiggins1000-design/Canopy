import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PAYMENTS_ENABLED  = import.meta.env.VITE_PAYMENTS_ENABLED === 'true'
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export default function PlanPaywall({ planId, planData }) {
  const { user } = useAuth()
  const [remaining,       setRemaining]       = useState(null)   // null = loading
  const [hasTwoDrafts,    setHasTwoDrafts]    = useState(false)
  const [analysis,        setAnalysis]        = useState(null)
  const [versionContext,  setVersionContext]   = useState(null)   // { prevVersionNum, currentVersionNum }
  const [unlocking,       setUnlocking]       = useState(false)
  const [analysing,       setAnalysing]       = useState(false)
  const [error,           setError]           = useState('')

  // Load analyses_remaining and check how many drafts exist
  useEffect(() => {
    if (!planId || !user) return
    Promise.all([
      supabase
        .from('pp_collaborators')
        .select('analyses_remaining')
        .eq('plan_id', planId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('pp_versions')
        .select('version_number')
        .eq('plan_id', planId)
        .order('version_number', { ascending: false })
        .limit(2),
    ]).then(([{ data: collabData }, { data: vData }]) => {
      setRemaining(collabData?.analyses_remaining ?? 0)
      setHasTwoDrafts((vData?.length ?? 0) >= 2)
    })
  }, [planId, user])

  // After Stripe redirect, reload remaining count (webhook should have processed)
  useEffect(() => {
    if (!planId || !user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') !== 'success') return
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      const { data } = await supabase
        .from('pp_collaborators')
        .select('analyses_remaining')
        .eq('plan_id', planId)
        .eq('user_id', user.id)
        .single()
      if ((data?.analyses_remaining ?? 0) > 0 || attempts >= 5) {
        setRemaining(data?.analyses_remaining ?? 0)
        clearInterval(interval)
        window.history.replaceState({}, '', window.location.pathname)
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [planId, user])

  async function unlock() {
    if (!planId) return
    setUnlocking(true)
    setError('')
    if (PAYMENTS_ENABLED) {
      const { data, error: fnErr } = await supabase.functions.invoke('create-checkout-session', {
        body: { plan_id: planId },
      })
      setUnlocking(false)
      if (fnErr || !data?.url) { setError('Payment could not start. Please try again.'); return }
      window.location.href = data.url
    } else {
      const { error: fnErr } = await supabase.functions.invoke('grant-test-analyses', {
        body: { plan_id: planId },
      })
      setUnlocking(false)
      if (fnErr) { setError('Test grant failed — check edge function logs.'); return }
      setRemaining(3)
    }
  }

  async function runAnalysis() {
    if (!planId || !planData || !remaining) return
    setAnalysing(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()

      // Fetch the two most recent saved drafts
      const { data: versionRows } = await supabase
        .from('pp_versions')
        .select('version_number, plan_data')
        .eq('plan_id', planId)
        .order('version_number', { ascending: false })
        .limit(2)

      const currentVersionNum  = versionRows?.[0]?.version_number ?? 1
      const currentDraftData   = versionRows?.[0]?.plan_data ?? planData
      const prevVersionRow     = versionRows?.[1]
      const prevPlanData       = prevVersionRow?.plan_data ?? null
      const prevVersionNum     = prevVersionRow?.version_number ?? null

      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-plan`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          plan_data:      currentDraftData,
          prev_plan_data: prevPlanData,
        }),
      })
      const result = await res.json()
      if (!res.ok || result.error) throw new Error(result.error || 'Analysis failed')

      await supabase.rpc('pp_record_analysis', {
        p_plan_id:        planId,
        p_result:         result,
        p_version_number: currentVersionNum,
      })

      setVersionContext(prevPlanData ? { prevVersionNum, currentVersionNum } : null)
      setAnalysis(result)
      setRemaining(r => Math.max(0, (r ?? 0) - 1))
    } catch (err) {
      setError(err.message || 'Analysis failed. Please try again.')
    }
    setAnalysing(false)
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (!user || !planId) {
    return <Wrapper><LockedContent disabled hasTwoDrafts={false} error="" /></Wrapper>
  }

  if (remaining === null) {
    return (
      <Wrapper>
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-[#52b788] border-t-transparent rounded-full animate-spin" />
        </div>
      </Wrapper>
    )
  }

  if (analysis) {
    return (
      <Wrapper remaining={remaining}>
        <AnalysisResult
          analysis={analysis}
          versionContext={versionContext}
          remaining={remaining}
          onRunAgain={runAnalysis}
          analysing={analysing}
          error={error}
        />
      </Wrapper>
    )
  }

  if (remaining > 0) {
    return (
      <Wrapper remaining={remaining}>
        <p className="text-sm text-gray-600">
          {hasTwoDrafts
            ? 'Two drafts exist. The AI will compare them, identify where the two versions differ, and suggest compromise wording for each contested point.'
            : 'Run the AI review to check your plan for gaps, flag potential conflict points, and suggest what to add.'}
        </p>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={runAnalysis}
          disabled={analysing}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {analysing
            ? <><Spinner />{hasTwoDrafts ? 'Comparing drafts…' : 'Analysing your plan…'}</>
            : hasTwoDrafts ? 'Compare drafts with AI' : 'Run AI review'}
        </button>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <LockedContent disabled={false} hasTwoDrafts={hasTwoDrafts} error={error} loading={unlocking} onUnlock={unlock} />
    </Wrapper>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Wrapper({ children, remaining }) {
  return (
    <div className="bg-white border border-[#d8f3dc] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#d8f3dc] bg-[#f4fbf4] flex items-center gap-2">
        <StarIcon />
        <h2 className="text-sm font-semibold text-[#1b4332]">AI Plan Review</h2>
        {remaining > 0 && (
          <span className="ml-auto text-xs text-[#52b788]">{remaining} review{remaining !== 1 ? 's' : ''} remaining</span>
        )}
      </div>
      <div className="px-4 py-5 space-y-4">{children}</div>
    </div>
  )
}

function LockedContent({ disabled, hasTwoDrafts, error, loading, onUnlock }) {
  const bullets = hasTwoDrafts
    ? [
        'Where the two drafts differ, section by section',
        'AI-suggested compromise wording for each contested point',
        'Gaps in the current draft most likely to cause conflict',
        'Prioritised next steps',
      ]
    : [
        'Completeness score for your plan',
        'Up to 3 gaps most likely to cause future conflict',
        "What you've done well",
        'Prioritised next steps',
      ]

  return (
    <>
      <p className="text-sm text-gray-600">
        {hasTwoDrafts
          ? 'Two drafts exist. Unlock the AI review to see exactly where the two versions differ and get suggested compromise wording for each point.'
          : 'Get an AI review of your plan — identifying gaps, highlighting strengths, and telling you exactly what to address next.'}
      </p>
      <div className="space-y-2">
        {bullets.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#52b788] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs text-gray-600">{item}</span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={onUnlock}
        disabled={disabled || loading}
        className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-40 transition-colors"
      >
        {loading ? 'Please wait…' : 'Unlock AI review · £1.99'}
      </button>
      {disabled ? (
        <p className="text-xs text-gray-400 text-center">Preparing your plan…</p>
      ) : !PAYMENTS_ENABLED ? (
        <p className="text-xs text-amber-600 text-center bg-amber-50 rounded-lg px-3 py-2">
          Test mode — payment bypassed. Set <code className="font-mono">VITE_PAYMENTS_ENABLED=true</code> to enable Stripe.
        </p>
      ) : (
        <p className="text-xs text-gray-400 text-center">One-time payment · Use across all your plan revisions</p>
      )}
    </>
  )
}

function AnalysisResult({ analysis, versionContext, remaining, onRunAgain, analysing, error }) {
  return (
    <div className="space-y-4">
      {/* Draft comparison — only when two drafts were compared */}
      {analysis.differences?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Points of difference
            {versionContext && (
              <span className="ml-2 normal-case font-normal text-gray-400">
                Draft {versionContext.prevVersionNum} vs Draft {versionContext.currentVersionNum}
              </span>
            )}
          </p>
          {analysis.differences.map((d, i) => (
            <div key={i} className="rounded-xl border border-[#d8f3dc] overflow-hidden">
              <div className="px-3 py-2 bg-[#f4fbf4] border-b border-[#d8f3dc]">
                <p className="text-xs font-semibold text-[#1b4332]">{d.section}</p>
              </div>
              <div className="px-3 py-2.5 grid grid-cols-2 gap-3 border-b border-[#d8f3dc]">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Draft {versionContext?.prevVersionNum ?? 'A'}
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">{d.position_a}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Draft {versionContext?.currentVersionNum ?? 'B'}
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">{d.position_b}</p>
                </div>
              </div>
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold text-[#2d6a4f] uppercase tracking-wide mb-1">AI suggestion</p>
                <p className="text-xs text-gray-700 leading-relaxed">{d.suggested}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {analysis.gaps?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Gaps to address</p>
          {analysis.gaps.map((g, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className="text-amber-400 text-sm shrink-0 mt-0.5">⚠</span>
              <p className="text-sm text-gray-700"><span className="font-medium text-gray-800">{g.section}:</span> {g.suggestion}</p>
            </div>
          ))}
        </div>
      )}
      {analysis.strengths?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Strengths</p>
          {analysis.strengths.map((s, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className="text-[#52b788] text-sm shrink-0 mt-0.5">✓</span>
              <p className="text-sm text-gray-600">{s}</p>
            </div>
          ))}
        </div>
      )}
      {analysis.priorities?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Next steps</p>
          {analysis.priorities.map((p, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className="text-[#1b4332] text-sm font-bold shrink-0 mt-0.5">{i + 1}.</span>
              <p className="text-sm text-gray-600">{p}</p>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {remaining > 0 && (
        <button
          onClick={onRunAgain}
          disabled={analysing}
          className="w-full py-2.5 rounded-xl text-sm font-medium border border-[#d8f3dc] text-[#1b4332] hover:bg-[#f4fbf4] disabled:opacity-50 transition-colors"
        >
          {analysing ? <><Spinner />Analysing…</> : 'Run again with latest changes'}
        </button>
      )}
    </div>
  )
}

function StarIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-[#52b788] flex items-center justify-center shrink-0">
      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    </div>
  )
}

function Spinner() {
  return <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
}
