// Public parenting plan builder — lives at /plan (no auth required)
// Used as the parentingplan.help marketing funnel

import { useState, useEffect, useRef } from 'react'
import { buildPresetPattern, PATTERN_LABELS } from '../lib/scheduleEngine'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import PlanVersionHistory from '../components/PlanVersionHistory'
import PlanPaywall from '../components/PlanPaywall'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

const STORAGE_KEY = 'pp_draft'
const TOTAL_STEPS = 9

const PATTERNS = ['alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom']

const PATTERN_DESCRIPTIONS = {
  alternating_weeks: 'One full week with each parent, alternating every 7 days.',
  '2_2_5_5':         '2 days, 2 days, then 5 days each — 14-day repeating cycle.',
  '2_2_3':           '2 days, 2 days, 3 days — provides more frequent contact for younger children.',
  '3_4_4_3':         '3 days, 4 days, 4 days, 3 days — regular time with both parents.',
  custom:            'Build your own cycle day by day.',
}

// ── Localisation ──────────────────────────────────────────────────────────────

const LOCALES = [
  { key: 'en-gb', label: 'England & Wales', flag: '🇬🇧' },
  { key: 'en-sc', label: 'Scotland',        flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { key: 'en-ie', label: 'Ireland',         flag: '🇮🇪' },
  { key: 'en-us', label: 'United States',   flag: '🇺🇸' },
  { key: 'en-au', label: 'Australia',       flag: '🇦🇺' },
  { key: 'en-ca', label: 'Canada',          flag: '🇨🇦' },
  { key: 'other', label: 'Other',           flag: '🌍' },
]

const TERMS = {
  'en-gb': {
    schoolHolidays: 'school holidays',
    schoolNursery:  'school or nursery',
    gp:             'GP',
    optician:       'optician',
    parentsEvening: "parents' evenings",
    abroad:         'abroad',
    termTimeOption: 'Follow the same pattern as term time',
    termTimeLabel:  'Follow term-time pattern',
    legalNote:      'This plan is not a legally binding document. For matters involving formal court orders, always seek independent legal advice.',
  },
  'en-sc': {
    schoolHolidays: 'school holidays',
    schoolNursery:  'school or nursery',
    gp:             'GP',
    optician:       'optician',
    parentsEvening: "parents' evenings",
    abroad:         'abroad',
    termTimeOption: 'Follow the same pattern as term time',
    termTimeLabel:  'Follow term-time pattern',
    legalNote:      'This plan is not a legally binding document. Scottish family law (Children (Scotland) Act 1995) differs from the rest of the UK — always seek independent Scottish legal advice.',
  },
  'en-ie': {
    schoolHolidays: 'school holidays',
    schoolNursery:  'school or crèche',
    gp:             'GP',
    optician:       'optician',
    parentsEvening: "parents' evenings",
    abroad:         'abroad',
    termTimeOption: 'Follow the same pattern as term time',
    termTimeLabel:  'Follow term-time pattern',
    legalNote:      'This plan is not a legally binding document. For matters involving formal court orders under Irish law, always seek independent legal advice.',
  },
  'en-us': {
    schoolHolidays: 'school breaks',
    schoolNursery:  'school or preschool',
    gp:             'pediatrician',
    optician:       'eye doctor',
    parentsEvening: 'parent-teacher conferences',
    abroad:         'out of the country',
    termTimeOption: 'Follow the same pattern during the school year',
    termTimeLabel:  'Follow school year pattern',
    legalNote:      'This plan is not a legally binding document. Custody and parenting laws vary by state — always seek independent legal advice for your jurisdiction.',
  },
  'en-au': {
    schoolHolidays: 'school holidays',
    schoolNursery:  'school or childcare',
    gp:             'GP',
    optician:       'optometrist',
    parentsEvening: 'parent-teacher interviews',
    abroad:         'overseas',
    termTimeOption: 'Follow the same pattern as term time',
    termTimeLabel:  'Follow term-time pattern',
    legalNote:      'This plan is not a legally binding document. You may wish to file it with the Family Court to give it the force of a parenting order. Always seek independent legal advice.',
  },
  'en-ca': {
    schoolHolidays: 'school breaks',
    schoolNursery:  'school or daycare',
    gp:             'family doctor',
    optician:       'optometrist',
    parentsEvening: 'parent-teacher interviews',
    abroad:         'out of the country',
    termTimeOption: 'Follow the same pattern during the school year',
    termTimeLabel:  'Follow school year pattern',
    legalNote:      'This plan is not a legally binding document. Family law varies by province — always seek independent legal advice for your jurisdiction.',
  },
  'other': {
    schoolHolidays: 'school holidays',
    schoolNursery:  'school or preschool',
    gp:             'family doctor',
    optician:       'optician',
    parentsEvening: 'parent-teacher meetings',
    abroad:         'abroad',
    termTimeOption: 'Follow the same pattern as term time',
    termTimeLabel:  'Follow term-time pattern',
    legalNote:      'This plan is not a legally binding document. Always seek independent legal advice relevant to your country.',
  },
}

function detectLocale() {
  try {
    const saved = localStorage.getItem('pp_locale')
    if (saved && TERMS[saved]) return saved
  } catch {}
  const lang = (navigator.language ?? 'en-GB').toLowerCase()
  if (lang.startsWith('en-us')) return 'en-us'
  if (lang.startsWith('en-au')) return 'en-au'
  if (lang.startsWith('en-ca')) return 'en-ca'
  if (lang.startsWith('en-ie')) return 'en-ie'
  return 'en-gb'
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

// ── Default form data ─────────────────────────────────────────────────────────

function blank() {
  return {
    parent1: '', parent2: '',
    children: [{ name: '', dob: '' }],
    patternType: 'alternating_weeks',
    startingParent: 'parent_a',
    customCycle: [],
    handoverLocation: 'school',
    handoverOther: '',
    handoverLate: '',
    holidaySplit: 'equal',
    holidaySplitOther: '',
    maxDays: '7',
    maxDaysOther: '',
    noticeWeeks: '4',
    noticeWeeksOther: '',
    christmas: 'split_a_morning',
    christmasTime: '14:00',
    christmasOther: '',
    birthdays: 'separate',
    birthdaysOther: '',
    fixedOccasions: '',
    abroad: 'required',
    abroadOther: '',
    abroadRequirements: '',
    abroadWeeks: '6',
    abroadInfo: ['destination', 'accommodation', 'emergency_contact', 'return_details'],
    passports: 'both',
    screenTime: '',
    socialMedia: '',
    restrictedApps: '',
    devicesPolicy: '',
    childContact: '',
    contactRestrictions: '',
    parentChannel: 'app',
    urgentProcess: '',
    documentSharing: '',
    firstRefusal: 'other_parent',
    carers: [{ name: '', relationship: '' }],
    extendedFamily: '',
    siblings: '',
    educationDisputes: '',
    schoolInfo: '',
    routineHealth: '',
    nonEmergency: '',
    medicalEmergency: '',
    newPartners: '',
    dayCosts: '',
    bigCosts: '',
    financialChange: '',
    jointDecisions: ['school', 'relocation', 'medical', 'travel', 'medication'],
    dailyRules: '',
    disputeProcess: 'mediation',
    reviewFrequency: 'annually',
  }
}

export default function PlanPage({ planId, planSaving }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : blank() }
    catch { return blank() }
  })
  const [locale, setLocale] = useState(detectLocale)
  const [localeOpen, setLocaleOpen] = useState(false)
  const topRef = useRef(null)

  const [isCollaborator] = useState(() => {
    try { return localStorage.getItem('pp_role') === 'collaborator' } catch { return false }
  })
  const [p1OriginalName] = useState(() => {
    try { return localStorage.getItem('pp_p1_name') || '' } catch { return '' }
  })

  const t = TERMS[locale] ?? TERMS['en-gb']

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }, [data])
  useEffect(() => { try { localStorage.setItem('pp_locale', locale) } catch {} }, [locale])

  function set(field, value) { setData(p => ({ ...p, [field]: value })) }

  function go(n) {
    setStep(n)
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const p1 = data.parent1 || 'Parent 1'
  const p2 = data.parent2 || 'Parent 2'

  const stepTitles = [
    'About your family',
    'The schedule',
    `Handovers & ${t.schoolHolidays}`,
    'Special occasions & travel',
    'Digital life & communication',
    'Childcare & family',
    'Education & health',
    'Decisions & money',
    'Your parenting plan',
  ]

  const currentLocaleItem = LOCALES.find(l => l.key === locale) ?? LOCALES[0]

  return (
    <div className="min-h-screen bg-[#f4fbf4]" ref={topRef}>
      {/* Header */}
      <header className="bg-[#1b4332] px-6 py-4 no-print">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#52b788] flex items-center justify-center text-[#1b4332] text-xs font-bold">C</div>
            <span className="text-white font-semibold text-sm">parentingplan.help</span>
          </div>
          <div className="flex items-center gap-3">
            {step < TOTAL_STEPS && (
              <span className="text-[#b7e4c7] text-xs">{step} of {TOTAL_STEPS - 1}</span>
            )}
            {/* Locale picker */}
            <div className="relative">
              <button
                onClick={() => setLocaleOpen(p => !p)}
                className="flex items-center gap-1 text-[#b7e4c7] hover:text-white text-sm transition-colors"
                aria-label="Change region"
              >
                <span>{currentLocaleItem.flag}</span>
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {localeOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setLocaleOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 min-w-[180px]">
                    {LOCALES.map(l => (
                      <button
                        key={l.key}
                        onClick={() => { setLocale(l.key); setLocaleOpen(false) }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-gray-50 transition-colors ${locale === l.key ? 'text-[#1b4332] font-semibold' : 'text-gray-700'}`}
                      >
                        <span className="text-base">{l.flag}</span>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Progress */}
      <div className="h-1 bg-[#1b4332]/20 no-print">
        <div
          className="h-full bg-[#52b788] transition-all duration-500"
          style={{ width: `${Math.min((step / (TOTAL_STEPS - 1)) * 100, 100)}%` }}
        />
      </div>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {step < TOTAL_STEPS && (
          <div>
            <p className="text-xs text-[#52b788] font-semibold uppercase tracking-wide">Step {step} of {TOTAL_STEPS - 1}</p>
            <h1 className="text-2xl font-bold text-[#1b4332] mt-1">{stepTitles[step - 1]}</h1>
          </div>
        )}

        {step < TOTAL_STEPS && isCollaborator && (
          <div className="bg-[#d8f3dc] rounded-xl px-4 py-3">
            <p className="text-xs text-[#1b4332]">
              You're reviewing {p1OriginalName || p1}'s proposals — work through each section and record your own position on anything you'd like to change.
            </p>
          </div>
        )}

        {step === 1 && <Step1 data={data} set={set} />}
        {step === 2 && <Step2 data={data} set={set} p1={p1} p2={p2} />}
        {step === 3 && <Step3 data={data} set={set} t={t} />}
        {step === 4 && <Step4 data={data} set={set} p1={p1} p2={p2} t={t} />}
        {step === 5 && <Step5 data={data} set={set} />}
        {step === 6 && <Step6 data={data} set={set} />}
        {step === 7 && <Step7 data={data} set={set} t={t} />}
        {step === 8 && <Step8 data={data} set={set} t={t} />}
        {step === 9 && <Step9 data={data} p1={p1} p2={p2} t={t} locale={locale} planId={planId} planSaving={planSaving} isCollaborator={isCollaborator} p1OriginalName={p1OriginalName} onRestart={() => { localStorage.removeItem(STORAGE_KEY); setData(blank()); go(1) }} />}

        {step < TOTAL_STEPS && (
          <div className="flex gap-3 pt-2">
            {step > 1 && (
              <button onClick={() => go(step - 1)} className="px-5 py-3 rounded-xl text-sm font-medium text-[#1b4332] border border-[#d8f3dc] hover:bg-[#d8f3dc] transition-colors">
                Back
              </button>
            )}
            <button
              onClick={() => go(step + 1)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] transition-colors"
            >
              {step === TOTAL_STEPS - 1 ? 'Generate my plan →' : 'Continue →'}
            </button>
          </div>
        )}

        {step < TOTAL_STEPS && (
          <p className="text-xs text-[#95d5b2] text-center">Your progress is saved automatically</p>
        )}
      </main>
    </div>
  )
}

// ── Step 1: About your family ──────────────────────────────────────────────

function Step1({ data, set }) {
  function setChild(i, field, value) {
    const next = [...data.children]
    next[i] = { ...next[i], [field]: value }
    set('children', next)
  }
  function addChild() { set('children', [...data.children, { name: '', dob: '' }]) }
  function removeChild(i) { set('children', data.children.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Your name" value={data.parent1} onChange={v => set('parent1', v)} placeholder="e.g. Chris" />
        <Field label="Other parent's name" value={data.parent2} onChange={v => set('parent2', v)} placeholder="e.g. Kate" />
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-semibold text-[#2d6a4f] uppercase tracking-wide">Children</label>
        {data.children.map((c, i) => (
          <div key={i} className="bg-white rounded-2xl border border-[#d8f3dc] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#1b4332]">Child {i + 1}</span>
              {data.children.length > 1 && (
                <button onClick={() => removeChild(i)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name" value={c.name} onChange={v => setChild(i, 'name', v)} placeholder="e.g. Isabelle" />
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date of birth</label>
                <input
                  type="date"
                  value={c.dob}
                  onChange={e => setChild(i, 'dob', e.target.value)}
                  className="w-full border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#52b788]"
                />
              </div>
            </div>
          </div>
        ))}
        <button onClick={addChild} className="w-full py-2.5 rounded-xl text-sm font-medium text-[#2d6a4f] border border-dashed border-[#95d5b2] hover:bg-[#d8f3dc]/40 transition-colors">
          + Add another child
        </button>
      </div>
    </div>
  )
}

// ── Step 2: The schedule ───────────────────────────────────────────────────

function Step2({ data, set, p1, p2 }) {
  const isCustom = data.patternType === 'custom'

  function addDay(parent) { set('customCycle', [...data.customCycle, parent]) }
  function removeDay(i) { set('customCycle', data.customCycle.filter((_, idx) => idx !== i)) }

  let cycle = []
  if (isCustom) {
    cycle = data.customCycle
  } else {
    const p = buildPresetPattern(data.patternType, data.startingParent)
    cycle = p?.cycle ?? []
  }

  const today = new Date()
  const preview = cycle.length
    ? Array.from({ length: 14 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
        return { date: d, owner: cycle[i % cycle.length] }
      })
    : []

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">Choose the pattern that best reflects how you'll share time with your children. You can customise this at any point.</p>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-[#2d6a4f] uppercase tracking-wide">Rotation pattern</label>
        {PATTERNS.map(p => (
          <label
            key={p}
            className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-all ${
              data.patternType === p ? 'border-[#2d6a4f] bg-[#d8f3dc]/40' : 'border-[#d8f3dc] bg-white hover:border-[#95d5b2]'
            }`}
          >
            <input
              type="radio"
              name="pattern"
              value={p}
              checked={data.patternType === p}
              onChange={() => set('patternType', p)}
              className="mt-0.5 accent-[#1b4332]"
            />
            <div>
              <p className="text-sm font-semibold text-[#1b4332]">{PATTERN_LABELS[p]}</p>
              <p className="text-xs text-gray-500 mt-0.5">{PATTERN_DESCRIPTIONS[p]}</p>
            </div>
          </label>
        ))}
      </div>

      {!isCustom && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#2d6a4f] uppercase tracking-wide">First period starts with</label>
          <div className="flex gap-2">
            {[{ key: 'parent_a', name: p1 }, { key: 'parent_b', name: p2 }].map(({ key, name }) => (
              <button
                key={key}
                onClick={() => set('startingParent', key)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                  data.startingParent === key
                    ? 'border-[#1b4332] bg-[#1b4332] text-white'
                    : 'border-[#d8f3dc] bg-white text-gray-600 hover:border-[#95d5b2]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {isCustom && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-[#2d6a4f] uppercase tracking-wide">
            Build your cycle ({data.customCycle.length} day{data.customCycle.length !== 1 ? 's' : ''})
          </label>
          <div className="min-h-14 bg-white rounded-xl border-2 border-dashed border-[#d8f3dc] p-3 flex flex-wrap gap-1.5">
            {data.customCycle.length === 0 && (
              <span className="text-xs text-gray-400 italic self-center">Use the buttons below to build your cycle — tap to add, tap a day to remove it</span>
            )}
            {data.customCycle.map((owner, i) => (
              <button
                key={i}
                onClick={() => removeDay(i)}
                title="Tap to remove"
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                  owner === 'parent_a' ? 'bg-[#d8f3dc] text-[#1b4332]' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {owner === 'parent_a' ? p1.charAt(0) : p2.charAt(0)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => addDay('parent_a')} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#d8f3dc] text-[#1b4332] hover:bg-[#b7e4c7] transition-colors">
              + {p1}
            </button>
            <button onClick={() => addDay('parent_b')} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
              + {p2}
            </button>
            {data.customCycle.length > 0 && (
              <button onClick={() => set('customCycle', [])} className="px-3 py-2.5 rounded-xl text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {preview.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#2d6a4f] uppercase tracking-wide">Preview — first 14 days</label>
          <div className="grid grid-cols-7 gap-1">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
              <div key={d} className="text-center text-[10px] text-gray-400 font-medium pb-1">{d}</div>
            ))}
            {preview.map(({ date, owner }, i) => (
              <div
                key={i}
                className={`rounded-xl aspect-square flex flex-col items-center justify-center text-xs font-semibold ${
                  owner === 'parent_a' ? 'bg-[#d8f3dc] text-[#1b4332]' : 'bg-gray-100 text-gray-700'
                }`}
              >
                <span className="text-[9px] font-normal opacity-60">{format(date, 'EEE')}</span>
                <span>{date.getDate()}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 pt-1">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-[#d8f3dc]" /><span className="text-xs text-gray-500">{p1}</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-gray-100" /><span className="text-xs text-gray-500">{p2}</span></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Handovers & school holidays ───────────────────────────────────

function Step3({ data, set, t }) {
  return (
    <div className="space-y-6">
      <Card title="Handovers">
        <RadioGroup
          label="Where do handovers normally take place?"
          name="handoverLocation"
          value={data.handoverLocation}
          onChange={v => set('handoverLocation', v)}
          options={[
            { value: 'school', label: 'At school — one parent drops off, the other collects' },
            { value: 'parent_a_home', label: "At one parent's home" },
            { value: 'neutral', label: 'A neutral location' },
            { value: 'other', label: 'Other' },
          ]}
        />
        {data.handoverLocation === 'other' && (
          <Prose label="Where?" value={data.handoverOther} onChange={v => set('handoverOther', v)} rows={2} />
        )}
        <Prose
          label="If a handover is delayed or needs to change at short notice, what is the agreed approach?"
          value={data.handoverLate}
          onChange={v => set('handoverLate', v)}
          rows={3}
          placeholder="e.g. Contact the other parent as soon as possible by phone, agree a new time within 2 hours"
        />
      </Card>

      <Card title={cap(t.schoolHolidays)}>
        <RadioGroup
          label={`How will ${t.schoolHolidays} be divided?`}
          name="holidaySplit"
          value={data.holidaySplit}
          onChange={v => set('holidaySplit', v)}
          options={[
            { value: 'equal', label: 'Split equally between both parents' },
            { value: 'term_pattern', label: t.termTimeOption },
            { value: 'agreed_annually', label: 'Agreed separately each school year' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {data.holidaySplit === 'other' && (
          <Prose label="Please describe the arrangement" value={data.holidaySplitOther} onChange={v => set('holidaySplitOther', v)} rows={2} />
        )}
        <RadioGroup
          label={`Maximum consecutive days with one parent during ${t.schoolHolidays} (without specific agreement)`}
          name="maxDays"
          value={data.maxDays}
          onChange={v => set('maxDays', v)}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: 'no_limit', label: 'No set limit — agreed case by case' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {data.maxDays === 'other' && (
          <Prose label="Please describe the arrangement" value={data.maxDaysOther} onChange={v => set('maxDaysOther', v)} rows={2} />
        )}
        <RadioGroup
          label="How far in advance do holiday plans need to be agreed?"
          name="noticeWeeks"
          value={data.noticeWeeks}
          onChange={v => set('noticeWeeks', v)}
          options={[
            { value: '2', label: '2 weeks' },
            { value: '4', label: '4 weeks' },
            { value: '6', label: '6 weeks' },
            { value: '8', label: '8 weeks or more' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {data.noticeWeeks === 'other' && (
          <Prose label="Please describe the arrangement" value={data.noticeWeeksOther} onChange={v => set('noticeWeeksOther', v)} rows={2} />
        )}
      </Card>
    </div>
  )
}

// ── Step 4: Special occasions & travel ────────────────────────────────────

function Step4({ data, set, p1, p2, t }) {
  const infoOptions = [
    { value: 'destination', label: 'Destination' },
    { value: 'itinerary', label: 'Itinerary' },
    { value: 'accommodation', label: 'Accommodation details' },
    { value: 'emergency_contact', label: 'Emergency contact' },
    { value: 'return_details', label: 'Return details' },
  ]

  return (
    <div className="space-y-6">
      <Card title="Special occasions">
        <RadioGroup
          label="How will Christmas Day be handled?"
          name="christmas"
          value={data.christmas}
          onChange={v => set('christmas', v)}
          options={[
            { value: 'split_a_morning', label: `Split on the day — ${p1} in the morning, ${p2} in the afternoon/evening` },
            { value: 'split_b_morning', label: `Split on the day — ${p2} in the morning, ${p1} in the afternoon/evening` },
            { value: 'alternates', label: 'Alternates each year between parents' },
            { value: 'agreed_annually', label: 'Agreed each year' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {(data.christmas === 'split_a_morning' || data.christmas === 'split_b_morning') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Handover time on Christmas Day</label>
            <input
              type="time"
              value={data.christmasTime}
              onChange={e => set('christmasTime', e.target.value)}
              className="border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#52b788]"
            />
          </div>
        )}
        {data.christmas === 'other' && (
          <Prose label="Please describe the arrangement" value={data.christmasOther} onChange={v => set('christmasOther', v)} rows={2} />
        )}
        <RadioGroup
          label="How are the children's birthdays handled?"
          name="birthdays"
          value={data.birthdays}
          onChange={v => set('birthdays', v)}
          options={[
            { value: 'separate', label: 'Each parent celebrates separately on or around the day' },
            { value: 'joint', label: 'One joint celebration with both parents' },
            { value: 'resident', label: "Whoever has the children that day celebrates; the other parent has a separate celebration" },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {data.birthdays === 'other' && (
          <Prose label="Please describe the arrangement" value={data.birthdaysOther} onChange={v => set('birthdaysOther', v)} rows={2} />
        )}
        <Prose
          label="Are there any other occasions — religious, cultural, or family — that should always be spent with a specific parent?"
          value={data.fixedOccasions}
          onChange={v => set('fixedOccasions', v)}
          rows={3}
          placeholder="e.g. Mother's Day with Kate, Father's Day with Chris, Eid with..."
        />
      </Card>

      <Card title={`Travel ${t.abroad}`}>
        <RadioGroup
          label={`Can either parent take the children ${t.abroad} without the other parent's prior written agreement?`}
          name="abroad"
          value={data.abroad}
          onChange={v => set('abroad', v)}
          options={[
            { value: 'required', label: 'No — written agreement is always required' },
            { value: 'notice_only', label: 'Yes — with reasonable notice and trip details shared' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        {data.abroad === 'other' && (
          <Prose label="Please describe the arrangement" value={data.abroadOther} onChange={v => set('abroadOther', v)} rows={2} />
        )}
        <RadioGroup
          label={`How much notice is required before a trip ${t.abroad}?`}
          name="abroadWeeks"
          value={data.abroadWeeks}
          onChange={v => set('abroadWeeks', v)}
          options={[
            { value: '4', label: '4 weeks' },
            { value: '6', label: '6 weeks' },
            { value: '8', label: '8 weeks' },
          ]}
        />
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">What information should be shared before travelling abroad?</label>
          {infoOptions.map(o => (
            <label key={o.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data.abroadInfo.includes(o.value)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...data.abroadInfo, o.value]
                    : data.abroadInfo.filter(v => v !== o.value)
                  set('abroadInfo', next)
                }}
                className="accent-[#1b4332] rounded"
              />
              <span className="text-sm text-gray-700">{o.label}</span>
            </label>
          ))}
        </div>
        <Prose
          label="Any other requirements around travel abroad?"
          value={data.abroadRequirements}
          onChange={v => set('abroadRequirements', v)}
          rows={2}
          placeholder="e.g. Written consent required for countries outside the EU. No travel during term time without agreement."
        />
        <RadioGroup
          label="Who holds the children's passports?"
          name="passports"
          value={data.passports}
          onChange={v => set('passports', v)}
          options={[
            { value: p1.toLowerCase().replace(' ', '_'), label: p1 },
            { value: p2.toLowerCase().replace(' ', '_'), label: p2 },
            { value: 'both', label: 'We each hold a passport / stored separately' },
            { value: 'last_used', label: 'Whoever last used them' },
          ]}
        />
      </Card>
    </div>
  )
}

// ── Step 5: Digital life & communication ──────────────────────────────────

function Step5({ data, set }) {
  return (
    <div className="space-y-6">
      <Card title="Digital life and social media">
        <Prose label="What boundaries, if any, have you agreed around screen time in each home?" value={data.screenTime} onChange={v => set('screenTime', v)} rows={3} placeholder="e.g. No screens within 30 minutes of bedtime. Devices off by 8pm on school nights." />
        <Prose label="What is your agreed approach to sharing photos or videos of the children on social media?" value={data.socialMedia} onChange={v => set('socialMedia', v)} rows={3} placeholder="e.g. Both parents to agree before posting any photos of the children publicly..." />
        <Prose label="Are there any apps or platforms the children are not permitted to use?" value={data.restrictedApps} onChange={v => set('restrictedApps', v)} rows={2} placeholder="e.g. TikTok, Snapchat until age 13..." />
        <Prose label="How will you handle the children's own devices and accounts as they get older?" value={data.devicesPolicy} onChange={v => set('devicesPolicy', v)} rows={3} placeholder="e.g. First phone at secondary school. Both parents to have access to accounts until age 16..." />
      </Card>

      <Card title="Staying in touch">
        <Prose label="If a child wants to speak to the other parent, how should this be handled?" value={data.childContact} onChange={v => set('childContact', v)} rows={3} placeholder="e.g. The resident parent should facilitate a call if the child asks. Children can contact the other parent freely once they have their own phone." />
        <Prose label="Are there any times when contact between children and the other parent should not take place?" value={data.contactRestrictions} onChange={v => set('contactRestrictions', v)} rows={2} placeholder="e.g. During bedtime routine (after 7:30pm), during school hours" />
      </Card>

      <Card title="Talking to each other">
        <RadioGroup
          label="What is your primary channel for day-to-day communication?"
          name="parentChannel"
          value={data.parentChannel}
          onChange={v => set('parentChannel', v)}
          options={[
            { value: 'app', label: 'A co-parenting app (e.g. Canopy)' },
            { value: 'whatsapp', label: 'WhatsApp or text' },
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone call' },
          ]}
        />
        <Prose label="For urgent matters — such as a child being unwell or injured — how should the other parent be contacted, and how quickly?" value={data.urgentProcess} onChange={v => set('urgentProcess', v)} rows={3} placeholder="e.g. Phone call immediately. If no answer, text and expect a response within 30 minutes." />
        <Prose label="How will you share school letters, medical updates and other important information?" value={data.documentSharing} onChange={v => set('documentSharing', v)} rows={2} placeholder="e.g. Via the co-parenting app on the day they are received." />
      </Card>
    </div>
  )
}

// ── Step 6: Childcare & family ────────────────────────────────────────────

function Step6({ data, set }) {
  function setCarer(i, field, value) {
    const next = [...data.carers]
    next[i] = { ...next[i], [field]: value }
    set('carers', next)
  }
  function addCarer() { set('carers', [...data.carers, { name: '', relationship: '' }]) }
  function removeCarer(i) { set('carers', data.carers.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-6">
      <Card title="Childcare">
        <RadioGroup
          label="If the parent who has the children cannot look after them, who should be asked first?"
          name="firstRefusal"
          value={data.firstRefusal}
          onChange={v => set('firstRefusal', v)}
          options={[
            { value: 'other_parent', label: 'The other parent (right of first refusal)' },
            { value: 'agreed_list', label: 'An agreed list of family members or carers' },
            { value: 'resident_decides', label: "Either option — at the resident parent's discretion" },
          ]}
        />
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">Agreed carers who can look after the children when neither parent is available</label>
          {data.carers.map((c, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={c.name}
                  onChange={e => setCarer(i, 'name', e.target.value)}
                  placeholder="Name"
                  className="border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#52b788]"
                />
                <input
                  type="text"
                  value={c.relationship}
                  onChange={e => setCarer(i, 'relationship', e.target.value)}
                  placeholder="Relationship"
                  className="border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#52b788]"
                />
              </div>
              {data.carers.length > 1 && (
                <button onClick={() => removeCarer(i)} className="text-red-400 text-xs pt-2.5 hover:text-red-600">✕</button>
              )}
            </div>
          ))}
          <button onClick={addCarer} className="text-xs text-[#2d6a4f] hover:underline">+ Add another carer</button>
        </div>
      </Card>

      <Card title="Extended family & siblings">
        <Prose label="How will the children maintain relationships with grandparents and other important family members on both sides?" value={data.extendedFamily} onChange={v => set('extendedFamily', v)} rows={3} placeholder="e.g. Regular contact via video call. Extended family can collect from school with prior agreement from the resident parent." />
        <Prose label="Should the children always be kept together when moving between homes, or can they occasionally spend time separately with each parent?" value={data.siblings} onChange={v => set('siblings', v)} rows={3} placeholder="e.g. The children should remain together unless either parent specifically requests individual time with advance notice and the other parent agrees." />
      </Card>
    </div>
  )
}

// ── Step 7: Education & health ─────────────────────────────────────────────

function Step7({ data, set, t }) {
  return (
    <div className="space-y-6">
      <Card title="Education">
        <Prose label="If parents disagree about an education decision, how will this be resolved?" value={data.educationDisputes} onChange={v => set('educationDisputes', v)} rows={3} placeholder="e.g. Direct conversation first, with a two-week deadline to reach agreement. If unresolved, attend mediation." />
        <Prose
          label={`How will both parents stay informed about school events, reports and ${t.parentsEvening}?`}
          value={data.schoolInfo}
          onChange={v => set('schoolInfo', v)}
          rows={2}
          placeholder="e.g. Both parents listed as contacts with the school. Information shared via the co-parenting app on the day it is received."
        />
      </Card>

      <Card title="Health and medical">
        <Prose
          label={`Who arranges routine health appointments — ${t.gp}, dentist, ${t.optician}?`}
          value={data.routineHealth}
          onChange={v => set('routineHealth', v)}
          rows={2}
          placeholder="e.g. Kate takes the lead on arranging appointments but Chris is happy to attend or cover during school holidays."
        />
        <Prose label="If a child needs non-emergency medical treatment during one parent's time, what must happen before proceeding?" value={data.nonEmergency} onChange={v => set('nonEmergency', v)} rows={3} placeholder="e.g. Inform the other parent and discuss before agreeing to treatment. If the other parent cannot be reached within 4 hours, the resident parent may proceed." />
        <Prose label="In a medical emergency, what is the process for informing the other parent?" value={data.medicalEmergency} onChange={v => set('medicalEmergency', v)} rows={2} placeholder="e.g. Call as soon as the child is in safe hands. Share hospital name, condition, and next steps." />
      </Card>
    </div>
  )
}

// ── Step 8: Decisions & money ─────────────────────────────────────────────

function Step8({ data, set, t }) {
  const jointOptions = [
    { value: 'school',      label: `Choice of ${t.schoolNursery}` },
    { value: 'relocation',  label: 'Moving to a different area or country' },
    { value: 'medical',     label: 'Non-emergency medical treatment or surgery' },
    { value: 'medication',  label: 'Starting or stopping prescribed medication' },
    { value: 'surname',     label: 'Change of surname' },
    { value: 'travel',      label: 'International travel' },
    { value: 'activities',  label: 'Significant new extracurricular commitments' },
  ]

  return (
    <div className="space-y-6">
      <Card title="Making decisions together">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">Which of the following require both parents to agree before a decision is made?</label>
          {jointOptions.map(o => (
            <label key={o.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data.jointDecisions.includes(o.value)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...data.jointDecisions, o.value]
                    : data.jointDecisions.filter(v => v !== o.value)
                  set('jointDecisions', next)
                }}
                className="accent-[#1b4332] rounded"
              />
              <span className="text-sm text-gray-700">{o.label}</span>
            </label>
          ))}
        </div>
        <Prose label="For day-to-day decisions — diet, bedtime, activities — does each parent set their own rules, or is there a joint approach?" value={data.dailyRules} onChange={v => set('dailyRules', v)} rows={3} placeholder="e.g. Each parent sets their own house rules. We aim to be broadly consistent on bedtime and diet but don't need to agree on everything." />
      </Card>

      <Card title="New partners">
        <Prose label="What is your agreed approach to introducing new partners to the children?" value={data.newPartners} onChange={v => set('newPartners', v)} rows={4} placeholder="e.g. Both parents to be informed before a new partner meets the children. Introduction should be gradual — initially as a friend. A new partner should not stay overnight until they have known the children for at least..." />
      </Card>

      <Card title="Money">
        <Prose label="How are day-to-day costs handled when the children are with each parent?" value={data.dayCosts} onChange={v => set('dayCosts', v)} rows={3} placeholder="e.g. Each parent covers food, activities and incidentals during their own time. Kate contributes a larger share of shared costs while her income is higher." />
        <Prose label="How are larger shared costs handled — school trips, sports equipment, medical costs?" value={data.bigCosts} onChange={v => set('bigCosts', v)} rows={3} placeholder="e.g. Agreed case by case, split proportionally based on income. Current split: Kate 66%, Chris 33%." />
        <Prose label="What happens if one parent's financial situation changes significantly?" value={data.financialChange} onChange={v => set('financialChange', v)} rows={2} placeholder="e.g. The contribution split should be reviewed and agreed between both parents." />
      </Card>

      <Card title="When you disagree">
        <RadioGroup
          label="If you cannot agree on something, what is the first step?"
          name="disputeProcess"
          value={data.disputeProcess}
          onChange={v => set('disputeProcess', v)}
          options={[
            { value: 'conversation', label: 'A direct conversation with a set deadline to reach agreement' },
            { value: 'mediation', label: 'Mediation' },
            { value: 'legal', label: 'Legal advice' },
          ]}
        />
        <RadioGroup
          label="How often will you review this plan together?"
          name="reviewFrequency"
          value={data.reviewFrequency}
          onChange={v => set('reviewFrequency', v)}
          options={[
            { value: 'every_6_months', label: 'Every 6 months' },
            { value: 'annually', label: 'Every year' },
            { value: 'on_change', label: "When the children's circumstances change significantly" },
          ]}
        />
      </Card>
    </div>
  )
}

// ── Step 9: Generated plan ─────────────────────────────────────────────────

function SaveAndShare({ data, p1, p2, locale, planId, planSaving }) {
  const { user } = useAuth()
  const [email,        setEmail]        = useState('')
  const [sent,         setSent]         = useState(false)
  const [sending,      setSending]      = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteSent,   setInviteSent]   = useState(false)
  const [inviteSending,setInviteSending]= useState(false)
  const [error,        setError]        = useState('')

  async function sendMagicLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    localStorage.setItem('pp_pending_save', 'true')
    setSending(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    })
    setSending(false)
    if (err) { setError('Something went wrong — please try again.'); return }
    setSent(true)
  }

  async function sendInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim() || !planId) return
    setInviteSending(true)
    setError('')

    const { error: rpcErr } = await supabase.rpc('pp_send_invite', {
      p_plan_id:      planId,
      p_invite_email: inviteEmail.trim(),
    })
    if (rpcErr) { setError('Something went wrong. Please try again.'); setInviteSending(false); return }

    const { error: emailErr } = await supabase.functions.invoke('send-plan-invite', {
      body: { plan_id: planId, invite_email: inviteEmail.trim(), p1_name: p1, p2_name: p2 },
    })
    setInviteSending(false)
    if (emailErr) { setError('Invite registered but email failed — please try again.'); return }
    setInviteSent(true)
  }

  // Logged in — show saving state or invite form
  if (user) {
    if (planSaving) {
      return (
        <div className="bg-[#d8f3dc] rounded-2xl p-5 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[#1b4332] border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-sm text-[#1b4332]">Saving your plan…</p>
        </div>
      )
    }
    return (
      <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-[#1b4332]">Share this plan with {p2}</p>
          <p className="text-xs text-[#2d6a4f] mt-1">They'll receive a secure link to open the plan, review your proposals, and submit their own version.</p>
        </div>
        {inviteSent ? (
          <div className="bg-white rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-sm font-medium text-[#1b4332]">Invitation sent to {inviteEmail}</p>
            <p className="text-xs text-gray-500">They'll receive a link to open and review this plan.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <form onSubmit={sendInvite} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder={`${p2}'s email address`}
                className="flex-1 border border-[#95d5b2] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#52b788] bg-white"
              />
              <button
                type="submit"
                disabled={inviteSending || !inviteEmail.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {inviteSending ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </div>
    )
  }

  // Logged out — sent magic link confirmation
  if (sent) {
    return (
      <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-2">
        <p className="text-sm font-semibold text-[#1b4332]">Check your email</p>
        <p className="text-sm text-[#2d6a4f]">We've sent a link to <strong>{email}</strong>. Click it to save your plan and invite {p2}.</p>
        <p className="text-xs text-[#52b788] mt-1">You can close this tab — your plan draft is saved in this browser.</p>
      </div>
    )
  }

  // Logged out — show magic link form
  return (
    <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-[#1b4332]">Save this plan and share it with {p2}</p>
        <p className="text-xs text-[#2d6a4f] mt-1">Enter your email to get a link. No password needed.</p>
      </div>
      <form onSubmit={sendMagicLink} className="space-y-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Your email address"
          className="w-full border border-[#95d5b2] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#52b788] bg-white"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={sending || !email.trim()}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
        >
          {sending ? 'Sending link…' : 'Save & share →'}
        </button>
      </form>
      <p className="text-xs text-[#52b788] text-center">Free · No password · Your plan stays private</p>
    </div>
  )
}

function Step9({ data, p1, p2, t, locale, planId, planSaving, isCollaborator, p1OriginalName, onRestart }) {
  const children = data.children.filter(c => c.name)

  const JOINT_LABELS = {
    school:     `Choice of ${t.schoolNursery}`,
    relocation: 'Moving to a different area or country',
    medical:    'Non-emergency medical treatment or surgery',
    medication: 'Starting or stopping prescribed medication',
    surname:    'Change of surname',
    travel:     'International travel',
    activities: 'Significant new extracurricular commitments',
  }

  const CHRISTMAS_LABELS = {
    split_a_morning: `${p1} in the morning, handover to ${p2} at ${data.christmasTime}`,
    split_b_morning: `${p2} in the morning, handover to ${p1} at ${data.christmasTime}`,
    alternates:      'Alternates each year between parents',
    agreed_annually: 'Agreed each year',
    other:           data.christmasOther,
  }

  const HOLIDAY_SPLIT_LABELS = {
    equal:           'Split equally between both parents',
    term_pattern:    t.termTimeLabel,
    agreed_annually: 'Agreed each school year',
  }

  let scheduleDesc = ''
  if (data.patternType === 'custom') {
    scheduleDesc = `Custom ${data.customCycle.length}-day cycle`
  } else {
    scheduleDesc = PATTERN_LABELS[data.patternType]
    if (data.startingParent === 'parent_a') scheduleDesc += `, starting with ${p1}`
    else scheduleDesc += `, starting with ${p2}`
  }

  function print() { window.print() }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 pb-4 border-b border-[#d8f3dc]">
        <h1 className="text-3xl font-bold text-[#1b4332]">Your Parenting Plan</h1>
        <p className="text-sm text-gray-500">
          {p1} & {p2} · {children.map(c => c.name).join(', ')}
        </p>
        <p className="text-xs text-gray-400">Created {format(new Date(), 'd MMMM yyyy')}</p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700 text-left mt-3">
          <strong>Advisory only.</strong> {t.legalNote}
        </div>
      </div>

      <PlanSection title="1. About this plan">
        <PlanRow label="Parents" value={`${p1} and ${p2}`} />
        {children.map((c, i) => (
          <PlanRow key={i} label={`Child ${i + 1}`} value={`${c.name}${c.dob ? ` (born ${c.dob})` : ''}`} />
        ))}
      </PlanSection>

      <PlanSection title="2. The schedule">
        <PlanRow label="Pattern" value={scheduleDesc} />
      </PlanSection>

      <PlanSection title={`3. Handovers and ${t.schoolHolidays}`}>
        {data.handoverLocation && <PlanRow label="Handover location" value={{
          school: 'At school', parent_a_home: "At one parent's home", neutral: 'Neutral location', other: data.handoverOther,
        }[data.handoverLocation]} />}
        {data.handoverLate && <PlanRow label="If a handover is delayed" value={data.handoverLate} />}
        {data.holidaySplit && <PlanRow label={`${cap(t.schoolHolidays)} split`} value={data.holidaySplit === 'other' ? data.holidaySplitOther : HOLIDAY_SPLIT_LABELS[data.holidaySplit]} />}
        {data.maxDays && <PlanRow label="Maximum consecutive days" value={data.maxDays === 'no_limit' ? 'No set limit — agreed case by case' : data.maxDays === 'other' ? data.maxDaysOther : `${data.maxDays} days`} />}
        {data.noticeWeeks && <PlanRow label="Holiday notice required" value={data.noticeWeeks === 'other' ? data.noticeWeeksOther : `${data.noticeWeeks} weeks`} />}
      </PlanSection>

      <PlanSection title="4. Special occasions and travel">
        {data.christmas && <PlanRow label="Christmas Day" value={CHRISTMAS_LABELS[data.christmas]} />}
        {data.birthdays && <PlanRow label="Children's birthdays" value={{
          separate: 'Each parent celebrates separately', joint: 'One joint celebration with both parents', resident: 'Resident parent celebrates; other parent has a separate celebration', other: data.birthdaysOther,
        }[data.birthdays]} />}
        {data.fixedOccasions && <PlanRow label="Other fixed occasions" value={data.fixedOccasions} />}
        {data.abroad && <PlanRow label={`Travel ${t.abroad}`} value={data.abroad === 'required' ? 'Written agreement from both parents required' : data.abroad === 'other' ? data.abroadOther : 'Permitted with notice and trip details shared'} />}
        {data.abroadWeeks && <PlanRow label="Notice for international trips" value={`${data.abroadWeeks} weeks`} />}
        {data.abroadInfo.length > 0 && <PlanRow label="Information to share" value={data.abroadInfo.map(v => ({
          destination: 'Destination', itinerary: 'Itinerary', accommodation: 'Accommodation details', emergency_contact: 'Emergency contact', return_details: 'Return details',
        }[v])).join(', ')} />}
        {data.abroadRequirements && <PlanRow label="Other travel requirements" value={data.abroadRequirements} />}
        {data.passports && <PlanRow label="Passports held by" value={{ both: 'Each parent holds their own / stored separately', last_used: 'Whoever last used them' }[data.passports] ?? data.passports} />}
      </PlanSection>

      {(data.screenTime || data.socialMedia || data.restrictedApps || data.devicesPolicy || data.childContact || data.contactRestrictions || data.parentChannel) && (
        <PlanSection title="5. Digital life and communication">
          {data.screenTime && <PlanRow label="Screen time" value={data.screenTime} />}
          {data.socialMedia && <PlanRow label="Social media" value={data.socialMedia} />}
          {data.restrictedApps && <PlanRow label="Restricted apps or platforms" value={data.restrictedApps} />}
          {data.devicesPolicy && <PlanRow label="Children's own devices" value={data.devicesPolicy} />}
          {data.childContact && <PlanRow label="Children contacting the other parent" value={data.childContact} />}
          {data.contactRestrictions && <PlanRow label="Contact restrictions" value={data.contactRestrictions} />}
          {data.parentChannel && <PlanRow label="Parent communication channel" value={{
            app: 'Co-parenting app', whatsapp: 'WhatsApp or text', email: 'Email', phone: 'Phone',
          }[data.parentChannel]} />}
          {data.urgentProcess && <PlanRow label="Urgent contact" value={data.urgentProcess} />}
          {data.documentSharing && <PlanRow label="Sharing information" value={data.documentSharing} />}
        </PlanSection>
      )}

      {(data.firstRefusal || data.carers.some(c => c.name) || data.extendedFamily || data.siblings) && (
        <PlanSection title="6. Childcare and family">
          {data.firstRefusal && <PlanRow label="If resident parent unavailable" value={{
            other_parent: 'Other parent has right of first refusal', agreed_list: 'Agreed list of carers', resident_decides: "Resident parent's discretion",
          }[data.firstRefusal]} />}
          {data.carers.filter(c => c.name).map((c, i) => (
            <PlanRow key={i} label={i === 0 ? 'Agreed carers' : ''} value={`${c.name}${c.relationship ? ` (${c.relationship})` : ''}`} />
          ))}
          {data.extendedFamily && <PlanRow label="Extended family" value={data.extendedFamily} />}
          {data.siblings && <PlanRow label="Siblings" value={data.siblings} />}
        </PlanSection>
      )}

      {(data.educationDisputes || data.schoolInfo || data.routineHealth || data.nonEmergency || data.medicalEmergency) && (
        <PlanSection title="7. Education and health">
          {data.educationDisputes && <PlanRow label="Education disagreements" value={data.educationDisputes} />}
          {data.schoolInfo && <PlanRow label="School communication" value={data.schoolInfo} />}
          {data.routineHealth && <PlanRow label="Routine health appointments" value={data.routineHealth} />}
          {data.nonEmergency && <PlanRow label="Non-emergency treatment" value={data.nonEmergency} />}
          {data.medicalEmergency && <PlanRow label="Medical emergencies" value={data.medicalEmergency} />}
        </PlanSection>
      )}

      {(data.jointDecisions.length > 0 || data.dailyRules || data.newPartners || data.dayCosts || data.bigCosts || data.financialChange || data.disputeProcess || data.reviewFrequency) && (
        <PlanSection title="8. Decisions, money and disagreements">
          {data.jointDecisions.length > 0 && <PlanRow label="Decisions requiring joint agreement" value={data.jointDecisions.map(v => JOINT_LABELS[v]).join(', ')} />}
          {data.dailyRules && <PlanRow label="Day-to-day decisions" value={data.dailyRules} />}
          {data.newPartners && <PlanRow label="New partners" value={data.newPartners} />}
          {data.dayCosts && <PlanRow label="Day-to-day costs" value={data.dayCosts} />}
          {data.bigCosts && <PlanRow label="Larger shared costs" value={data.bigCosts} />}
          {data.financialChange && <PlanRow label="Change in finances" value={data.financialChange} />}
          {data.disputeProcess && <PlanRow label="First step if we disagree" value={{
            conversation: 'Direct conversation with a set deadline', mediation: 'Mediation', legal: 'Legal advice',
          }[data.disputeProcess]} />}
          {data.reviewFrequency && <PlanRow label="Plan review" value={{
            every_6_months: 'Every 6 months', annually: 'Every year', on_change: "When the children's circumstances change",
          }[data.reviewFrequency]} />}
        </PlanSection>
      )}

      <PlanPaywall planId={planId} planData={data} />

      {/* Actions */}
      <div className="space-y-3 pt-4">
        <button
          onClick={print}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] transition-colors"
        >
          Print / save as PDF
        </button>

        {isCollaborator
          ? <SubmitDraft planId={planId} planData={data} p1Name={p1OriginalName || p1} p2Name={p2} />
          : <SaveAndShare data={data} p1={p1} p2={p2} locale={locale} planId={planId} planSaving={planSaving} />
        }

        {planId && <PlanVersionHistory planId={planId} currentPlanData={data} />}

        <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold text-[#1b4332]">Use this schedule in Canopy</p>
          <p className="text-sm text-[#2d6a4f]">Canopy is the private family app that keeps both parents in sync — shared calendar, schedule, notice board, and more. Your parenting schedule can be set up in minutes.</p>
          <a
            href="https://canopy-app.app"
            className="block w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white text-center hover:bg-[#2d6a4f] transition-colors"
          >
            Get started free →
          </a>
        </div>

        <button onClick={onRestart} className="w-full py-2.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Start a new plan
        </button>
      </div>
    </div>
  )
}

// ── Submit draft (collaborator flow) ─────────────────────────────────────

function SubmitDraft({ planId, planData, p1Name, p2Name }) {
  const [submitted,  setSubmitted]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [draftNum,   setDraftNum]   = useState(null)
  const [error,      setError]      = useState('')

  useEffect(() => {
    if (!planId) return
    supabase
      .from('pp_versions')
      .select('version_number')
      .eq('plan_id', planId)
      .order('version_number', { ascending: false })
      .limit(1)
      .then(({ data }) => setDraftNum((data?.[0]?.version_number ?? 1) + 1))
  }, [planId])

  async function submit() {
    if (!planId || !planData) return
    setSubmitting(true)
    setError('')
    const n    = draftNum ?? 2
    const note = `Draft ${n} — ${p2Name || 'Parent 2'}`
    const { error: err } = await supabase.rpc('pp_save_version', {
      p_plan_id:   planId,
      p_plan_data: planData,
      p_note:      note,
    })
    setSubmitting(false)
    if (err) { setError('Something went wrong — please try again.'); return }
    setSubmitted(true)
    // Fire-and-forget: notify the other parent by email
    supabase.functions.invoke('pp-draft-submitted', {
      body: { plan_id: planId, draft_num: n, submitter_name: p2Name || 'Parent 2' },
    })
  }

  if (!planId) return null

  if (submitted) {
    return (
      <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-1.5">
        <p className="text-sm font-semibold text-[#1b4332]">✓ Your version has been submitted</p>
        <p className="text-xs text-[#2d6a4f]">
          Draft {draftNum} is saved. {p1Name} will be able to review your proposals and respond with their own revision.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[#d8f3dc] rounded-2xl p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[#1b4332]">Submit your amended version</p>
        <p className="text-xs text-[#2d6a4f] mt-1">
          This records your proposals as Draft {draftNum ?? '…'} and notifies {p1Name} that your version is available to review.
          They can then set out their revised position and submit the next draft.
        </p>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-3 rounded-xl text-sm font-semibold bg-[#1b4332] text-white hover:bg-[#2d6a4f] disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Submitting…' : 'Submit amended version →'}
      </button>
    </div>
  )
}

// ── Shared UI components ──────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-[#d8f3dc] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#d8f3dc] bg-[#f4fbf4]">
        <h2 className="text-sm font-semibold text-[#1b4332]">{title}</h2>
      </div>
      <div className="px-4 py-4 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#52b788]"
      />
    </div>
  )
}

function Prose({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full border border-[#d8f3dc] rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#52b788] resize-none"
      />
    </div>
  )
}

function RadioGroup({ label, name, value, onChange, options }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-medium text-gray-500">{label}</label>}
      {options.map(o => (
        <label
          key={o.value}
          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
            value === o.value ? 'border-[#2d6a4f] bg-[#f4fbf4]' : 'border-[#e5e7eb] hover:border-[#95d5b2]'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[#1b4332] shrink-0"
          />
          <span className="text-sm text-gray-700">{o.label}</span>
        </label>
      ))}
    </div>
  )
}

function PlanSection({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-[#1b4332] border-b border-[#d8f3dc] pb-1">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function PlanRow({ label, value }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-5 gap-2 text-sm">
      {label ? <span className="col-span-2 text-gray-400 text-xs pt-0.5">{label}</span> : <span className="col-span-2" />}
      <span className="col-span-3 text-gray-800">{value}</span>
    </div>
  )
}
