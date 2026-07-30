import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useSeo } from '../hooks/useSeo'

const SECTIONS = [
  { icon: '📅', title: 'The schedule',                   desc: 'Alternating weeks, 2-2-5-5, 2-2-3, or fully custom — with a visual 14-day preview.' },
  { icon: '🚗', title: 'Handovers & school holidays',    desc: 'Where handovers happen, how holidays are split, and how much notice is needed.' },
  { icon: '🎄', title: 'Special occasions & travel',     desc: 'Christmas, birthdays, international trips, and who holds the passports.' },
  { icon: '📱', title: 'Digital life & communication',   desc: 'Screen time, social media, staying in touch, and how parents talk to each other.' },
  { icon: '👨‍👩‍👧', title: 'Childcare & family',             desc: 'Right of first refusal, agreed carers, grandparents, and siblings.' },
  { icon: '🏫', title: 'Education & health',             desc: 'Disagreements, school communication, medical appointments, and emergencies.' },
  { icon: '💰', title: 'Decisions & money',              desc: 'Joint decisions, day-to-day costs, larger shared expenses, and new partners.' },
  { icon: '🤝', title: 'Disputes & review',              desc: 'What happens when positions differ, and the process for reviewing the plan over time.' },
]

// Mirrors the real "Draft history" widget in PlanVersionHistory.jsx — version
// number, date, and the note text exactly as it's actually stored (auto-notes
// read "Initial plan" for v1, then "Draft N — {name}" for each submission).
// There's no per-parent quote/chat view and no in-app "new draft" banner in
// the real product (only an email notification) — don't reintroduce either.
const DRAFTS = [
  { draft: 1, date: '14 Jun 2026, 09:12', note: 'Initial plan' },
  { draft: 2, date: '16 Jun 2026, 18:40', note: 'Draft 2 — Jordan' },
  { draft: 3, date: '7 Jul 2026, 21:05',  note: 'Draft 3 — Alex', latest: true },
]

export default function LandingPage() {
  useSeo({
    title: 'Free Parenting Plan Builder | parentingplan.help',
    description: 'Create a clear, fair parenting plan in minutes — free, no login required. Covers schedule, holidays, health, education, money and more.',
    path: '/',
  })
  const navigate = useNavigate()
  const [hasDraft, setHasDraft] = useState(false)

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('pp_draft') || 'null')
      if (draft?.parent1 || draft?.children?.[0]?.name) setHasDraft(true)
    } catch {}
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }}>

      {/* Nav */}
      <nav className="bg-[#1b4332] sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/CanopyGreenLogo.gif" alt="Canopy" style={{ height: 28 }} />
            <span className="text-white font-bold text-xl tracking-tight">parentingplan.help</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://canopy-app.app" className="text-[#d8f3dc] hover:text-white text-sm transition-colors hidden sm:block">
              About Canopy
            </a>
            <a href="https://my.canopy-app.app" className="text-sm font-semibold bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-colors">
              Sign in
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-[#f4fbf4] pt-16 pb-20 px-5">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-block bg-[#d8f3dc] text-[#1b4332] text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-6">
            No account needed to start
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-5">
            Jointly author<br className="hidden sm:block" /> your parenting plan.
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed mb-8 max-w-2xl mx-auto">
            Each parent sets out their proposals across 8 sections. The other parent opens the plan and submits their own version. Revisions are saved as numbered drafts until an agreed version is reached. AI guidance is available throughout.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/plan')}
              className="bg-[#1b4332] hover:bg-[#2d6a4f] text-white font-semibold px-8 py-4 rounded-2xl text-base transition-colors"
              style={{ boxShadow: '0 8px 20px rgba(27,67,50,0.25)' }}
            >
              {hasDraft ? 'Continue your plan →' : 'Start drafting — it\'s free →'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-5">
            Advisory only — not a substitute for legal advice. Free to create, share, and print.
          </p>
        </div>
      </section>

      {/* Three pillars */}
      <div className="bg-[#1b4332] py-6 px-5">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-0 sm:divide-x sm:divide-white/10">
          {[
            { icon: '⚡', title: 'No account to start', body: 'Begin drafting immediately. Create an account only when you want to save, share, or revisit your plan.' },
            { icon: '🔄', title: 'Built for two parties', body: 'Each party sets out their proposals independently. Every version is saved as a numbered draft. Each party is notified when the other submits.' },
            { icon: '🤖', title: 'AI draft comparison', body: 'Once both parties have submitted a version, unlock the AI review — it compares the two drafts, identifies every point of difference, and suggests compromise wording for each.' },
          ].map(({ icon, title, body }) => (
            <div key={title} className="px-6 py-5 sm:py-2 text-center sm:text-left first:pl-0 last:pr-0">
              <div className="text-2xl mb-2">{icon}</div>
              <div className="text-white font-semibold text-sm mb-1">{title}</div>
              <div className="text-[#74c69d] text-xs leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <section className="py-20 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">How it works</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              From first draft to agreed plan.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            {[
              { n: '1', icon: '📝', title: 'Set out your proposals', desc: 'No account needed. Work through 8 sections and record your position — schedule, holidays, communication, and more.' },
              { n: '2', icon: '🔗', title: 'Share with the other party', desc: 'Send a secure link. They open the plan, review your proposals, and submit their own version — saved as Draft 2.' },
              { n: '3', icon: '🔄', title: 'Each party revises in turn', desc: 'Each submission is saved as a new numbered draft. Each party is notified when the other submits. Every version is preserved.' },
              { n: '4', icon: '✅', title: 'Reach an agreed version', desc: 'Unlock the AI review to compare both drafts and get suggested compromise wording. When both parties are satisfied, download as PDF.' },
            ].map(({ n, icon, title, desc }) => (
              <div key={n} className="relative">
                <div className="w-12 h-12 bg-[#1b4332] rounded-2xl flex items-center justify-center text-xl mb-4 shadow-sm">
                  {icon}
                </div>
                <div className="text-xs font-bold text-[#52b788] uppercase tracking-widest mb-2">Step {n}</div>
                <h3 className="font-bold text-gray-900 text-base mb-2">{title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Amendments mockup */}
      <section className="py-20 px-5 bg-[#f4fbf4]">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            <div>
              <span className="inline-block bg-[#d8f3dc] text-[#1b4332] text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-5">
                Joint authoring
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Each party authors their own version
              </h2>
              <p className="text-gray-600 leading-relaxed mb-5">
                One party drafts first. The other reviews those proposals, amends anything they disagree with, and submits their version. Each submission is saved as a numbered draft. The plan evolves until both parties are satisfied with the same version.
              </p>
              <ul className="space-y-3">
                {[
                  'One party works through all 8 sections and records their proposals',
                  'The other party reviews those proposals and submits an amended version — Draft 2',
                  'The first party is notified, reviews the changes, and can submit Draft 3',
                  'The process continues until both parties are satisfied with the same version',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <span className="text-[#52b788] mt-0.5 flex-shrink-0">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Draft history mock-up — matches the real widget's collapsed
                header + expanded row list exactly (see DRAFTS comment above) */}
            <div className="bg-white border border-[#d8f3dc] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-[#d8f3dc]">
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-[#52b788] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-[#1b4332]">Draft history</span>
                  <span className="text-xs text-gray-400">3 drafts</span>
                </div>
              </div>
              <div className="divide-y divide-[#d8f3dc]">
                {DRAFTS.map(({ draft, date, note, latest }) => (
                  <div key={draft} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#1b4332]">
                        v{draft}
                        {latest && (
                          <span className="ml-1.5 text-[10px] bg-[#d8f3dc] text-[#1b4332] px-1.5 py-0.5 rounded-full font-medium">latest</span>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{date}</p>
                    <p className="text-xs text-gray-500 italic">"{note}"</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* AI guidance */}
      <section className="py-20 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* AI mock-up — mirrors the real AI Plan Review card exactly: same
                section labels, same icon+plain-text style, no colour-coded
                boxes. Keep in sync with AnalysisResult in PlanPaywall.jsx. */}
            <div className="bg-white border border-[#d8f3dc] rounded-2xl overflow-hidden order-2 lg:order-1">
              <div className="px-4 py-3 border-b border-[#d8f3dc] bg-[#f4fbf4] flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[#52b788] flex items-center justify-center shrink-0">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-[#1b4332]">AI Plan Review</h2>
              </div>
              <div className="px-4 py-5 space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Gaps to address</p>
                  <div className="flex gap-2.5 items-start">
                    <span className="text-amber-400 text-sm shrink-0 mt-0.5">⚠</span>
                    <p className="text-sm text-gray-700"><span className="font-medium text-gray-800">Handovers:</span> Doesn't specify what happens if a handover is delayed — add a short fallback clause.</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Strengths</p>
                  <div className="flex gap-2.5 items-start">
                    <span className="text-[#52b788] text-sm shrink-0 mt-0.5">✓</span>
                    <p className="text-sm text-gray-600">Naming a primary communication channel and an urgent-contact process makes this plan easy to follow.</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Next steps</p>
                  <div className="flex gap-2.5 items-start">
                    <span className="text-[#1b4332] text-sm font-bold shrink-0 mt-0.5">1.</span>
                    <p className="text-sm text-gray-600">Add a fallback plan for delayed or missed handovers.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <span className="inline-block bg-[#d8f3dc] text-[#1b4332] text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-5">
                AI review · £1.99
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                AI that compares both versions
              </h2>
              <p className="text-gray-600 leading-relaxed mb-5">
                Once both parties have submitted a draft, unlock the AI review. It reads both versions side by side, identifies every section where the two positions differ, and suggests neutral compromise wording for each — giving both parties a concrete starting point for the next revision.
              </p>
              <ul className="space-y-3">
                {[
                  'Points of difference between the two drafts, section by section',
                  'AI-suggested compromise wording for each contested point',
                  'Gaps in the current draft most likely to cause future conflict',
                  'One-time payment — use across all revisions of your plan',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <span className="text-[#52b788] mt-0.5 flex-shrink-0">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* What's covered */}
      <section className="py-20 px-5 bg-[#f4fbf4]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">What's covered</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              8 sections covering every topic a solicitor or mediator would expect to see — structured so each party can set out their position on every point.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SECTIONS.map(({ icon, title, desc }) => (
              <div
                key={title}
                className="bg-white border border-[#d8f3dc] rounded-2xl p-5 hover:-translate-y-0.5 transition-transform"
              >
                <div className="text-2xl mb-3">{icon}</div>
                <h3 className="font-bold text-gray-900 text-sm mb-1.5">{title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <button
              onClick={() => navigate('/plan')}
              className="bg-[#1b4332] hover:bg-[#2d6a4f] text-white font-semibold px-8 py-4 rounded-2xl text-base transition-colors inline-block"
              style={{ boxShadow: '0 8px 20px rgba(27,67,50,0.20)' }}
            >
              {hasDraft ? 'Continue your plan →' : 'Start drafting →'}
            </button>
          </div>
        </div>
      </section>

      {/* Canopy CTA */}
      <section className="py-20 px-5 bg-[#1b4332]">
        <div className="max-w-3xl mx-auto text-center">
          <img src="/CanopyGreenLogo.gif" alt="Canopy" style={{ height: 40 }} className="mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-white mb-4">Want to implement the plan, not just write it?</h2>
          <p className="text-[#d8f3dc] leading-relaxed mb-8 max-w-xl mx-auto">
            Canopy is the private family app that puts your agreed plan into practice — shared calendar, parenting schedule, notice board, children's information, and more. Both parents. One place.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="https://my.canopy-app.app" className="bg-white text-[#1b4332] font-semibold px-8 py-4 rounded-2xl text-base hover:bg-[#d8f3dc] transition-colors">
              Start your free trial →
            </a>
            <a href="https://canopy-app.app" className="bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-4 rounded-2xl text-base transition-colors">
              Learn more
            </a>
          </div>
          <p className="text-[#74c69d] text-xs mt-5">10 days free — then £6.99/month for the whole family.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10 px-5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div>
            <span className="font-semibold text-white">parentingplan.help</span>
            {' '}— a free tool by{' '}
            <a href="https://canopy-app.app" className="text-[#74c69d] hover:text-[#52b788] transition-colors">Canopy</a>
            {' '}/ Chrysalis Works Ltd
          </div>
          <div className="flex gap-5">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <a href="https://canopy-app.app" className="hover:text-white transition-colors">canopy-app.app</a>
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-6 text-xs text-gray-600 text-center sm:text-left">
          This tool produces advisory documents only. Nothing on this site constitutes legal advice. For legally binding arrangements, consult a family solicitor or mediator.
        </div>
      </footer>
    </div>
  )
}
