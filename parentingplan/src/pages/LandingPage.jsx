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
  { icon: '🤝', title: 'Disputes & review',              desc: 'What happens when you disagree, and how often you review the plan together.' },
]

const AMENDMENTS = [
  { author: 'Alex', avatar: 'A', color: '#1b4332', bg: '#d8f3dc', section: 'The schedule', text: 'I\'d prefer alternating weeks rather than the 2-2-5-5 pattern — it\'s simpler for the kids to remember.' },
  { author: 'Jordan', avatar: 'J', color: '#4a5568', bg: '#f3f4f6', section: 'School holidays', text: 'Agreed on alternating weeks. Could we say school pick-up on Fridays rather than Sunday evenings?', accepted: true },
  { author: 'Alex', avatar: 'A', color: '#1b4332', bg: '#d8f3dc', section: 'Christmas', text: 'Happy with that. For Christmas — could we alternate years rather than splitting the day?', pending: true },
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
            <img src="/CanopyGreenLogo.gif" alt="Canopy" style={{ height: 32 }} />
            <span className="text-white font-semibold text-sm hidden sm:block">parentingplan.help</span>
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
            The parenting plan<br className="hidden sm:block" /> both parents agree on.
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed mb-8 max-w-2xl mx-auto">
            One parent starts the plan for free — no account, no signup. Share it with the other parent.
            Both suggest changes, discuss sections, and work toward a plan you're both happy with.
            AI guidance is there the whole time.
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
            { icon: '↔️', title: 'Built for two parents', body: 'Invite the other parent with a link. Both of you can suggest changes to any section and accept or reject each other\'s edits.' },
            { icon: '🤖', title: 'Instant AI guidance', body: 'Ask for feedback at any point. Our AI flags gaps, flags contradictions, and explains why sections matter — in plain English.' },
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
              From blank page to agreed plan — together.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            {[
              { n: '1', icon: '📝', title: 'One parent starts', desc: 'No account needed. Work through 8 sections covering schedule, holidays, communication, and more. Save as you go.' },
              { n: '2', icon: '📤', title: 'Share with a link', desc: "Create an account to send the other parent a secure link. They open the plan on any device — no account required to view or comment." },
              { n: '3', icon: '💬', title: 'Suggest changes', desc: "Either parent can suggest edits to any section. The other parent sees the suggestion and can accept, reject, or reply. All tracked." },
              { n: '4', icon: '✅', title: 'Agree and print', desc: 'When both parents are happy, print as PDF or save a signed version. Optional AI review before you finalise.' },
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
                The back-and-forth
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Both parents shape the plan
              </h2>
              <p className="text-gray-600 leading-relaxed mb-5">
                A parenting plan only works if both parents actually agree with it. That's why we built suggestion and review into every section — not as an afterthought, but as the core of the tool.
              </p>
              <ul className="space-y-3">
                {[
                  'Either parent can suggest a change to any section at any time',
                  'The other parent gets notified and can accept, reject, or counter-suggest',
                  'All suggestions are tracked — nothing gets lost',
                  'The plan only updates when both parents agree',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <span className="text-[#52b788] mt-0.5 flex-shrink-0">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Amendments mock-up */}
            <div className="space-y-3">
              {AMENDMENTS.map((a, i) => (
                <div key={i} className="bg-white rounded-2xl border border-[#d8f3dc] p-4 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: a.bg, color: a.color }}
                    >
                      {a.avatar}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-900">{a.author}</span>
                      <span className="text-xs text-gray-400 ml-1.5">· {a.section}</span>
                    </div>
                    {a.accepted && (
                      <span className="ml-auto text-xs font-semibold text-[#1b4332] bg-[#d8f3dc] px-2 py-0.5 rounded-full">Accepted ✓</span>
                    )}
                    {a.pending && (
                      <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Awaiting reply</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">"{a.text}"</p>
                  {a.pending && (
                    <div className="flex gap-2 mt-3">
                      <button className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-[#1b4332] text-white">Accept</button>
                      <button className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600">Suggest change</button>
                    </div>
                  )}
                </div>
              ))}
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
                Guidance when you need it
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                AI that explains, not just edits
              </h2>
              <p className="text-gray-600 leading-relaxed mb-5">
                Most parents don't know what a good parenting plan looks like — they've never written one before. Our AI checks your plan against the same criteria a family solicitor would apply and tells you, in plain English, what to fix and why.
              </p>
              <ul className="space-y-3">
                {[
                  'Spots sections that are vague or incomplete',
                  'Flags contradictions between different parts of the plan',
                  'Highlights what\'s working well, and why',
                  'Available any time — not just at the end',
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
              8 sections covering every topic a solicitor or mediator would expect to see — structured so both parents can work through them together.
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
          <h2 className="text-3xl font-bold text-white mb-4">Want to live the plan, not just write it?</h2>
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
