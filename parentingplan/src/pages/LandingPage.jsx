import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

const DRAFTS = [
  { author: 'Alex',   avatar: 'A', draft: 1, date: '14 Jun', text: "I'd like alternating weeks, starting after the summer break." },
  { author: 'Jordan', avatar: 'J', draft: 2, date: '16 Jun', text: "Alternating weeks feels too long between visits. I've changed this to 2-2-5-5." },
  { author: 'Alex',   avatar: 'A', draft: 3, date: 'Today',  text: "2-2-5-5 accepted. I've updated the handover location to school gate.", current: true },
]

export default function LandingPage() {
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
            <img src="/CanopyWhiteLogo.gif" alt="Canopy" style={{ height: 28 }} />
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

            {/* Versioned drafts mock-up */}
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-[#d8f3dc] p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-900">The schedule</span>
                  <span className="text-xs font-semibold text-[#52b788]">3 drafts</span>
                </div>
                <div className="space-y-2">
                  {DRAFTS.map(({ author, avatar, draft, date, text, current }) => (
                    <div key={draft} className={`rounded-xl p-3 ${current ? 'bg-[#d8f3dc] border border-[#74c69d]' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${author === 'Alex' ? 'bg-[#1b4332] text-white' : 'bg-gray-300 text-gray-700'}`}>
                          {avatar}
                        </div>
                        <span className="text-xs font-semibold text-gray-900">{author}</span>
                        <span className="text-xs text-gray-400">· Draft {draft} · {date}</span>
                        {current && <span className="ml-auto text-xs font-semibold text-[#1b4332]">Awaiting Jordan</span>}
                      </div>
                      <p className="text-xs text-gray-700 leading-relaxed pl-8">"{text}"</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#d8f3dc] p-3 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 bg-[#1b4332] rounded-full flex items-center justify-center text-sm flex-shrink-0">🔔</div>
                <div>
                  <p className="text-xs font-semibold text-gray-900">Jordan submitted Draft 2</p>
                  <p className="text-xs text-gray-500">3 sections updated · 2 days ago</p>
                </div>
                <button className="ml-auto text-xs font-semibold text-[#1b4332] bg-[#d8f3dc] px-3 py-1.5 rounded-lg flex-shrink-0">Review</button>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* AI guidance */}
      <section className="py-20 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* AI mock-up */}
            <div className="bg-[#f4fbf4] rounded-2xl border border-[#d8f3dc] p-5 space-y-3 order-2 lg:order-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 bg-[#1b4332] rounded-lg flex items-center justify-center text-xs">🤖</div>
                <span className="text-xs font-semibold text-[#1b4332]">AI feedback</span>
              </div>
              {[
                { type: 'gap', text: 'Your handover section doesn\'t specify what happens if a handover is delayed. Adding a short clause here prevents disagreements later.' },
                { type: 'conflict', text: 'Section 3 says holidays are split equally, but section 4 sets a 7-day maximum per stay. These may conflict in school summer holidays — worth clarifying.' },
                { type: 'good', text: 'Your communication section is clear and specific. Naming a primary channel and an urgent-contact process is exactly what makes plans stick.' },
              ].map(({ type, text }, i) => (
                <div key={i} className={`rounded-xl p-3.5 text-xs leading-relaxed ${
                  type === 'gap'      ? 'bg-amber-50 border border-amber-200 text-amber-800' :
                  type === 'conflict' ? 'bg-red-50 border border-red-200 text-red-800' :
                                       'bg-[#d8f3dc] border border-[#74c69d] text-[#1b4332]'
                }`}>
                  <span className="font-semibold mr-1">
                    {type === 'gap' ? '⚠️ Gap:' : type === 'conflict' ? '🔴 Conflict:' : '✅ Strong:'}
                  </span>
                  {text}
                </div>
              ))}
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
          <p className="text-[#74c69d] text-xs mt-5">10 days free — then £12.99/month for the whole family.</p>
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
            <a href="https://canopy-app.app/privacy.html" className="hover:text-white transition-colors">Privacy</a>
            <a href="https://canopy-app.app/terms.html" className="hover:text-white transition-colors">Terms</a>
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
