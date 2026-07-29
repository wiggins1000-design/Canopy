import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useNavigate } from 'react-router-dom'
import { validateEmail, validateUrl, mergeExtractedSchoolInfo } from '../lib/validationUtils'
import { firstName } from '../lib/childUtils'
import { useSessionActivity } from '../context/SessionActivityContext'
import { useLocale } from '../hooks/useLocale'
import Button from '../components/ui/Button'
import VaultSection from '../components/infobank/VaultSection'
import AccountsSection from '../components/infobank/AccountsSection'

const SECTIONS = [
  { id: 'school',    label: 'School'   },
  { id: 'medical',   label: 'Medical'  },
  { id: 'personal',  label: 'Personal' },
  { id: 'accounts',  label: 'Accounts' },
  { id: 'docs',      label: 'Docs'     },
  { id: 'contacts',  label: 'Contacts' },
]

const SECTION_LABELS = {
  medical: 'medical details', school: 'school details', personal: 'personal details',
  contacts: 'contacts', accounts: 'account details', vet: 'vet details', docs: 'documents',
}
const SECTION_TAGS = {
  medical: 'health', school: 'school', vet: 'health',
}

export default function InfoBankPage() {
  const { family, isParent, member, members, userRole } = useFamily()
  const { trackActivity } = useSessionActivity()
  const navigate = useNavigate()
  const children = (family?.config?.children ?? []).filter((c) => c.name)
  const pets     = (family?.config?.pets ?? []).filter((p) => p.name)

  const petNames = new Set(pets.map((p) => p.name))
  const tabs = [...children.map((c) => c.name), ...pets.map((p) => p.name), 'Family']
  const [activeTab, setActiveTab]       = useState(null)
  const [activeSection, setActiveSection] = useState('school')
  const [allData, setAllData]           = useState({})
  const [allUpdatedAt, setAllUpdatedAt] = useState({})
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    if (tabs.length > 0 && activeTab === null) setActiveTab(tabs[0])
  }, [tabs.join(',')])

  useEffect(() => {
    if (!activeTab) return
    setActiveSection(petNames.has(activeTab) ? 'vet' : activeTab === 'Family' ? 'contacts' : 'school')
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = useCallback(async () => {
    if (!family?.id) return
    const { data } = await supabase.from('info_bank').select('*').eq('family_id', family.id)
    const map = {}
    const updatedAtMap = {}
    for (const row of data ?? []) {
      map[`${row.child_name}||${row.section}`] = row.data
      updatedAtMap[`${row.child_name}||${row.section}`] = row.updated_at
    }
    setAllData(map)
    setAllUpdatedAt(updatedAtMap)
    setLoading(false)
  }, [family?.id])

  useEffect(() => { loadAll() }, [loadAll])

  async function recordConsent(type) {
    await supabase.rpc('record_consent', { p_type: type })
  }

  function getData(tab, section) {
    return allData[`${tab}||${section}`] ?? {}
  }

  function getUpdatedAt(tab, section) {
    return allUpdatedAt[`${tab}||${section}`] ?? null
  }

  async function saveSection(tab, section, data) {
    const { error } = await supabase.from('info_bank').upsert(
      { family_id: family.id, child_name: tab, section, data, updated_at: new Date().toISOString() },
      { onConflict: 'family_id,child_name,section' }
    )
    if (!error) {
      const now = new Date().toISOString()
      setAllData((prev) => ({ ...prev, [`${tab}||${section}`]: data }))
      setAllUpdatedAt((prev) => ({ ...prev, [`${tab}||${section}`]: now }))

      const subjectLabel = tab === 'Family' ? 'family' : `${firstName(tab)}'s`
      const sectionLabel = SECTION_LABELS[section] ?? section
      trackActivity(`Updated ${subjectLabel} ${sectionLabel}`)

      const siblings = children.filter((c) => c.name !== tab)

      // School sync: keep shared fields (address/phone/etc) up to date for siblings
      // already confirmed to be at the same school. Does NOT populate an empty
      // sibling automatically — that assumed "empty = same school", which silently
      // overwrote children who actually attend a different school and just hadn't
      // opened their School tab yet. An explicit "same school as [child]?" prompt
      // in SchoolSection now handles that case instead.
      if (section === 'school' && data.school_name) {
        const SHARED = ['school_name', 'school_address', 'school_phone', 'school_email', 'head_teacher', 'hours', 'school_url']
        const sharedPatch = Object.fromEntries(SHARED.map((k) => [k, data[k] ?? '']))
        for (const sibling of siblings) {
          const sibData = allData[`${sibling.name}||school`] ?? {}
          if (sibData.school_name && sibData.school_name === data.school_name) {
            const merged = { ...sibData, ...sharedPatch }
            await supabase.from('info_bank').upsert(
              { family_id: family.id, child_name: sibling.name, section: 'school', data: merged, updated_at: new Date().toISOString() },
              { onConflict: 'family_id,child_name,section' }
            )
            setAllData((prev) => ({ ...prev, [`${sibling.name}||school`]: merged }))
          }
        }
      }

      // Medical sync: propagate GP and dentist details to siblings who share the same practice (or have none set)
      if (section === 'medical') {
        const GP_FIELDS      = ['gp_practice', 'gp_name', 'gp_phone', 'gp_email', 'gp_address']
        const DENTIST_FIELDS = ['dentist_practice', 'dentist_name', 'dentist_phone', 'dentist_email', 'dentist_address']
        for (const sibling of siblings) {
          const sibData = allData[`${sibling.name}||medical`] ?? {}
          let merged = { ...sibData }
          let changed = false
          if (data.gp_practice && (!sibData.gp_practice || sibData.gp_practice === data.gp_practice)) {
            GP_FIELDS.forEach((k) => { merged[k] = data[k] ?? '' })
            changed = true
          }
          if (data.dentist_practice && (!sibData.dentist_practice || sibData.dentist_practice === data.dentist_practice)) {
            DENTIST_FIELDS.forEach((k) => { merged[k] = data[k] ?? '' })
            changed = true
          }
          if (changed) {
            await supabase.from('info_bank').upsert(
              { family_id: family.id, child_name: sibling.name, section: 'medical', data: merged, updated_at: new Date().toISOString() },
              { onConflict: 'family_id,child_name,section' }
            )
            setAllData((prev) => ({ ...prev, [`${sibling.name}||medical`]: merged }))
          }
        }
      }
    }
    return { error }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (children.length === 0 && pets.length === 0) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <h1 className="text-xl font-bold text-gray-900">Info Bank</h1>
        <p className="text-sm text-gray-500">Add children or pets in Settings to start filling in the info bank.</p>
        <Button variant="secondary" className="mx-auto" onClick={() => navigate('/config')}>
          Go to Settings
        </Button>
      </div>
    )
  }

  const isPetTab = petNames.has(activeTab)
  const petSections = [{ id: 'vet', label: 'Vet' }, { id: 'medical', label: 'Medical' }, { id: 'docs', label: 'Docs' }]
  const activeSections = activeTab === 'Family'
    ? [{ id: 'accounts', label: 'Accounts' }, { id: 'docs', label: 'Docs' }, { id: 'contacts', label: 'Contacts' }]
    : isPetTab ? petSections : SECTIONS

  const sectionData = getData(activeTab, activeSection)

  return (
    <div className="px-4 py-5 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Info Bank</h1>

      {/* Subject dropdown */}
      <div className="relative">
        <select
          value={activeTab ?? ''}
          onChange={(e) => {
            const tab = e.target.value
            const defaultSection = petNames.has(tab) ? 'vet' : tab === 'Family' ? 'contacts' : 'school'
            setActiveTab(tab)
            setActiveSection(defaultSection)
          }}
          className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-canopy-green pr-10"
        >
          {children.map((c) => (
            <option key={c.name} value={c.name}>{firstName(c.name)}</option>
          ))}
          {pets.map((p) => (
            <option key={p.name} value={p.name}>🐾 {p.name}</option>
          ))}
          <option value="Family">Family</option>
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {activeSections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
              activeSection === s.id ? 'bg-canopy-mid text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeTab === 'Family' && activeSection === 'accounts' ? (
        <AccountsSection childName="Family" />
      ) : activeTab === 'Family' && activeSection === 'docs' ? (
        <VaultSection childName="Family" />
      ) : activeTab === 'Family' ? (
        <ContactsSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection('Family', 'contacts', data)}
        />
      ) : isPetTab ? (
        activeSection === 'vet' ? (
          <VetSection
            data={sectionData}
            isParent={isParent}
            onSave={(data) => saveSection(activeTab, 'vet', data)}
            updatedAt={getUpdatedAt(activeTab, 'vet')}
          />
        ) : activeSection === 'medical' ? (
          <PetMedicalSection
            data={sectionData}
            isParent={isParent}
            onSave={(data) => saveSection(activeTab, 'medical', data)}
            updatedAt={getUpdatedAt(activeTab, 'medical')}
          />
        ) : (
          <VaultSection childName={activeTab} />
        )
      ) : activeSection === 'medical' ? (
        <MedicalSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'medical', data)}
          memberConsents={member?.consents}
          onConsent={recordConsent}
          updatedAt={getUpdatedAt(activeTab, 'medical')}
        />
      ) : activeSection === 'school' ? (
        <SchoolSection
          data={sectionData}
          isParent={isParent}
          familyId={family.id}
          childName={activeTab}
          siblingSchools={children
            .filter((c) => c.name !== activeTab)
            .map((c) => ({ name: c.name, ...getData(c.name, 'school') }))
            .filter((s) => s.school_name)}
          onSave={(data) => saveSection(activeTab, 'school', data)}
          onExtracted={(data) => setAllData((prev) => ({ ...prev, [`${activeTab}||school`]: { ...prev[`${activeTab}||school`], ...data } }))}
          updatedAt={getUpdatedAt(activeTab, 'school')}
        />
      ) : activeSection === 'contacts' ? (
        <ContactsSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'contacts', data)}
          updatedAt={getUpdatedAt(activeTab, 'contacts')}
        />
      ) : activeSection === 'accounts' ? (
        <AccountsSection childName={activeTab} />
      ) : activeSection === 'docs' ? (
        <VaultSection childName={activeTab} />
      ) : (
        <PersonalSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'personal', data)}
          updatedAt={getUpdatedAt(activeTab, 'personal')}
        />
      )}
    </div>
  )
}

// ── Field validation ──────────────────────────────────────────
// validateEmail and validateUrl are imported from lib/validationUtils

// ── Shared field components ───────────────────────────────────

function Field({ label, value, onChange, placeholder, readOnly, type = 'text', updatedAt }) {
  const [copied, setCopied] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const actionHref = value
    ? type === 'tel'   ? `tel:${value.replace(/\s/g, '')}`
    : type === 'email' ? `mailto:${value}`
    : null : null

  function handleBlur() {
    if (type === 'email') setFieldError(validateEmail(value))
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const el = document.createElement('input')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-w-0">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <div className={actionHref ? 'flex items-center gap-2 w-full min-w-0' : ''}>
        <input
          type={type}
          value={value}
          onChange={(e) => { onChange(e.target.value); if (fieldError) setFieldError(null) }}
          onBlur={handleBlur}
          placeholder={readOnly ? '—' : placeholder}
          readOnly={readOnly}
          className={`border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green ${readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'} ${actionHref ? 'flex-1 min-w-0' : 'w-full'} ${fieldError ? 'border-red-400' : 'border-gray-200'}`}
        />
        {actionHref && (
          <a
            href={actionHref}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-canopy-frost hover:text-canopy-deep transition-colors"
          >
            {type === 'tel' ? <PhoneIcon className="w-4 h-4" /> : <MailIcon className="w-4 h-4" />}
          </a>
        )}
        {type === 'email' && value && (
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-canopy-frost hover:text-canopy-deep transition-colors"
          >
            {copied ? <CheckIcon className="w-4 h-4 text-canopy-deep" /> : <CopyIcon className="w-4 h-4" />}
          </button>
        )}
      </div>
      {fieldError && <p className="text-xs text-red-600 mt-1">{fieldError}</p>}
      {updatedLabel && <p className="text-xs text-gray-400 mt-0.5">Updated {updatedLabel}</p>}
    </div>
  )
}

function TextArea({ label, value, onChange, placeholder, readOnly, rows = 2 }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={readOnly ? '—' : placeholder}
        readOnly={readOnly}
        rows={rows}
        className={`w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green ${readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}
      />
    </div>
  )
}

function SectionWrapper({ children, isParent, onSave, saved, updatedAt }) {
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  return (
    <div className="space-y-3">
      {children}
      {isParent && (
        <Button className="w-full py-3" onClick={onSave}>
          {saved ? '✓ Saved' : 'Save'}
        </Button>
      )}
      {updatedLabel && (
        <p className="text-xs text-gray-400 text-center">Last updated {updatedLabel}</p>
      )}
    </div>
  )
}

// ── Medical ───────────────────────────────────────────────────

function MedicalSection({ data, isParent, onSave, memberConsents, onConsent, updatedAt }) {
  const defaults = { gp_practice: '', gp_name: '', gp_phone: '', gp_email: '', gp_address: '', dentist_practice: '', dentist_name: '', dentist_phone: '', dentist_email: '', dentist_address: '', nhs_number: '', blood_type: '', allergies: '', medications: '', notes: '' }
  const [d, setD] = useState({ ...defaults, ...data })
  const [saved, setSaved] = useState(false)
  const [localConsented, setLocalConsented] = useState(!!memberConsents?.medical_data)
  const [consenting, setConsenting] = useState(false)

  useEffect(() => { setD({ ...defaults, ...data }) }, [JSON.stringify(data)])
  useEffect(() => { if (memberConsents?.medical_data) setLocalConsented(true) }, [memberConsents?.medical_data])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  async function giveConsent() {
    setConsenting(true)
    await onConsent('medical_data')
    setLocalConsented(true)
    setConsenting(false)
  }

  if (isParent && !localConsented) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-900">Consent required</p>
          <p className="text-sm text-amber-800">Medical information — including GP details, allergies, and medications — is <strong>sensitive personal data</strong> and requires your explicit consent before it can be stored.</p>
          <p className="text-sm text-amber-800">This information is private to your family and is never shared with third parties or used for advertising.</p>
          <Button className="w-full py-3" loading={consenting} onClick={giveConsent}>
            I consent to storing medical information
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved} updatedAt={updatedAt}>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">GP / Doctor</p>
      <Field label="Practice name" placeholder="Riverside Medical Centre" {...f('gp_practice')} />
      <Field label="Doctor name" placeholder="Dr Smith" {...f('gp_name')} />
      <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('gp_phone')} />
      <Field label="Email" placeholder="reception@riverside.nhs.uk" type="email" {...f('gp_email')} />
      <Field label="Address" placeholder="1 High Street, London" {...f('gp_address')} />

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Dentist</p>
      <Field label="Practice name" placeholder="Smile Dental Practice" {...f('dentist_practice')} />
      <Field label="Dentist name" placeholder="Dr Jones" {...f('dentist_name')} />
      <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('dentist_phone')} />
      <Field label="Email" placeholder="hello@smiledental.co.uk" type="email" {...f('dentist_email')} />
      <Field label="Address" placeholder="2 High Street, London" {...f('dentist_address')} />

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Health</p>
      <Field label="NHS number" placeholder="e.g. 943 476 5919" {...f('nhs_number')} />
      <Field label="Blood type" placeholder="e.g. A+" {...f('blood_type')} />
      <TextArea label="Allergies" placeholder="e.g. Penicillin, peanuts" {...f('allergies')} />
      <TextArea label="Medications" placeholder="e.g. Ventolin 100mcg when needed" {...f('medications')} />
      <TextArea label="Notes" placeholder="Any other medical notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── School ────────────────────────────────────────────────────

function normaliseUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`)
    const base = `${u.protocol}//${u.hostname}`.toLowerCase()
    const hasPath = u.pathname.length > 1 || u.search.length > 0
    return hasPath ? (base + u.pathname + u.search).toLowerCase() : base
  } catch { return url.toLowerCase().trim() }
}

const PE_WEEKDAYS = [
  { key: 'Monday',    short: 'Mon' },
  { key: 'Tuesday',   short: 'Tue' },
  { key: 'Wednesday', short: 'Wed' },
  { key: 'Thursday',  short: 'Thu' },
  { key: 'Friday',    short: 'Fri' },
]

function SchoolSection({ data, isParent, familyId, childName, siblingSchools = [], onSave, onExtracted, updatedAt }) {
  const regionConfig = useLocale()
  const defaults = { year_group: '', class_name: '', school_name: '', school_address: '', school_phone: '', school_email: '', teacher: '', head_teacher: '', hours: '', notes: '', school_url: '', pe_days: [] }
  const [d, setD] = useState({ ...defaults, ...data })
  const [saved, setSaved] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState(null)
  const [urlError, setUrlError] = useState(null)
  const [schoolChangePrompt, setSchoolChangePrompt] = useState(null)
  const [schoolChangeDeleting, setSchoolChangeDeleting] = useState(false)
  const originalSchoolUrl  = useRef(data?.school_url  ?? '')
  const originalSchoolName = useRef(data?.school_name ?? '')

  useEffect(() => { setD({ ...defaults, ...data }); setExtractResult(null) }, [JSON.stringify(data)])
  useEffect(() => {
    originalSchoolUrl.current  = data?.school_url  ?? ''
    originalSchoolName.current = data?.school_name ?? ''
  }, [data?.school_url, data?.school_name])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  // Group siblings who already share a school into a single offer, so two kids
  // both at "St Mary's" produce one button, not two.
  const siblingSchoolGroups = []
  for (const s of siblingSchools) {
    const group = siblingSchoolGroups.find((g) => g.school_name === s.school_name)
    if (group) group.names.push(s.name)
    else siblingSchoolGroups.push({ school_name: s.school_name, names: [s.name], source: s })
  }
  const showSameSchoolPrompt = isParent && !d.school_name && !d._school_prompt_dismissed && siblingSchoolGroups.length > 0

  async function applySameSchool(group) {
    // Capture BEFORE onSave — same reason as extractSchoolInfo's schoolChanged capture:
    // this is the only point we can tell "genuinely switched schools" apart from a no-op.
    const prevUrl  = originalSchoolUrl.current
    const prevName = originalSchoolName.current
    const SHARED = ['school_name', 'school_address', 'school_phone', 'school_email', 'head_teacher', 'hours', 'school_url']
    const patch = Object.fromEntries(SHARED.map((k) => [k, group.source[k] ?? '']))
    const next = { ...d, ...patch, _school_prompt_dismissed: true }
    setD(next)
    const { error } = await onSave(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    // Real bug this fixes: this "same school as sibling" shortcut used to call onSave
    // directly and skip straight past the stale-old-school-dates check entirely (unlike
    // the manual URL-edit path via save()) — so switching a child BACK to a school a
    // sibling is already at (the natural way to do it) never offered to clean up the
    // previous school's now-orphaned term dates.
    if (!error) await checkForStaleOldSchool(prevUrl, prevName, next.school_url, next.school_name)
  }

  function dismissSameSchoolPrompt() {
    const next = { ...d, _school_prompt_dismissed: true }
    setD(next)
    onSave(next)
  }

  async function checkSchoolChange(oldNorm, oldSchoolName) {
    const { data: siblingRows } = await supabase
      .from('info_bank')
      .select('data')
      .eq('family_id', familyId)
      .eq('section', 'school')
      .neq('child_name', childName)
    const siblingsAtOldSchool = (siblingRows ?? []).filter(
      r => normaliseUrl(r.data?.school_url) === oldNorm
    )
    if (siblingsAtOldSchool.length > 0) return

    const { data: oldCal } = await supabase
      .from('school_calendars')
      .select('id, school_name')
      .eq('homepage_url', oldNorm)
      .maybeSingle()

    const resolvedName = oldCal?.school_name ?? oldSchoolName ?? ''

    let count = 0
    if (oldCal?.id) {
      const { count: kbCount } = await supabase
        .from('family_events')
        .select('id', { count: 'exact', head: true })
        .eq('family_id', familyId)
        .eq('source', 'term_dates')
        .eq('school_calendar_id', oldCal.id)
      count += kbCount ?? 0
    }
    if (resolvedName) {
      const { count: manualCount } = await supabase
        .from('family_events')
        .select('id', { count: 'exact', head: true })
        .eq('family_id', familyId)
        .eq('source', 'term_dates')
        .is('school_calendar_id', null)
        .eq('source_subject', resolvedName)
      count += manualCount ?? 0
    }

    if (count > 0) {
      setSchoolChangePrompt({ schoolName: resolvedName, calId: oldCal?.id ?? null })
    }
  }

  async function checkNameChange(oldName) {
    // Skip if a sibling is also at the same URL (they share the school)
    const { data: siblingRows } = await supabase
      .from('info_bank')
      .select('data')
      .eq('family_id', familyId)
      .eq('section', 'school')
      .neq('child_name', childName)
    const currentNorm = normaliseUrl(d.school_url)
    const siblingsAtSameUrl = (siblingRows ?? []).filter(
      r => normaliseUrl(r.data?.school_url) === currentNorm
    )
    if (siblingsAtSameUrl.length > 0) return

    const { count } = await supabase
      .from('family_events')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId)
      .eq('source', 'term_dates')
      .is('school_calendar_id', null)
      .eq('source_subject', oldName)

    if ((count ?? 0) > 0) {
      setSchoolChangePrompt({ schoolName: oldName, calId: null })
    }
  }

  async function deleteOldTermDates() {
    if (!schoolChangePrompt) return
    setSchoolChangeDeleting(true)
    const { calId, schoolName } = schoolChangePrompt
    if (calId) {
      await supabase.from('family_events').delete()
        .eq('family_id', familyId)
        .eq('source', 'term_dates')
        .eq('school_calendar_id', calId)
    }
    if (schoolName) {
      await supabase.from('family_events').delete()
        .eq('family_id', familyId)
        .eq('source', 'term_dates')
        .is('school_calendar_id', null)
        .eq('source_subject', schoolName)
    }
    setSchoolChangeDeleting(false)
    setSchoolChangePrompt(null)
  }

  // Shared by save() and applySameSchool() — both are ways a school can genuinely
  // change, and both must offer to clean up the PREVIOUS school's now-stale dates.
  async function checkForStaleOldSchool(prevUrl, prevName, newUrl, newName) {
    const oldNorm = normaliseUrl(prevUrl)
    const newNorm = normaliseUrl(newUrl)
    if (oldNorm && newNorm && oldNorm !== newNorm) {
      await checkSchoolChange(oldNorm, prevName)
    } else if (prevName && newName && prevName !== newName) {
      await checkNameChange(prevName)
    }
  }

  async function save() {
    const prevUrl  = originalSchoolUrl.current
    const prevName = originalSchoolName.current
    const { error } = await onSave(d)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      const oldNorm = normaliseUrl(prevUrl)
      const newNorm = normaliseUrl(d.school_url)
      if (oldNorm && newNorm && oldNorm !== newNorm) {
        originalSchoolUrl.current  = d.school_url
        originalSchoolName.current = d.school_name ?? ''
      } else if (prevName && d.school_name && prevName !== d.school_name) {
        originalSchoolName.current = d.school_name
      }
      await checkForStaleOldSchool(prevUrl, prevName, d.school_url, d.school_name)
    }
    return { error }
  }

  async function extractSchoolInfo() {
    if (!d.school_url) return
    setExtracting(true)
    setExtractResult(null)
    // Capture BEFORE save() — save() advances originalSchoolUrl.current to the new
    // URL, so this is the only point we can tell "genuinely switched schools" apart
    // from "re-syncing the same school to fill in gaps."
    const schoolChanged = originalSchoolUrl.current && normaliseUrl(originalSchoolUrl.current) !== normaliseUrl(d.school_url)
    // Save URL first so edge function can read it
    await save()
    let invokeResult
    try {
      invokeResult = await Promise.race([
        supabase.functions.invoke('extract-school-info', {
          body: { family_id: familyId, child_name: childName, school_url: d.school_url },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 90000)),
      ])
    } catch {
      setExtracting(false)
      setExtractResult({ type: 'error', message: 'This is taking too long. Try entering the URL of the specific term dates page, or add details manually.' })
      return
    }
    const { data: res, error } = invokeResult
    setExtracting(false)
    if (error || res?.error) {
      // "Could not fetch school homepage" means the URL itself doesn't resolve to a real
      // page — not worth keeping saved. (Distinct from the bot-blocked case, where the URL
      // is correct but our scraper can't read it — that one should stay saved.) Without this,
      // a bad URL persisted in Info Bank from the pre-save above (needed so extract-school-info
      // can look it up) with only a transient error shown, then silently broke every future
      // term-dates sync with no indication of what was actually wrong.
      const badUrl = (res?.error ?? '').includes('Could not fetch school homepage')
      if (badUrl) {
        setD((prev) => ({ ...prev, school_url: originalSchoolUrl.current }))
        await onSave({ ...d, school_url: originalSchoolUrl.current })
        setExtractResult({ type: 'error', message: 'That doesn’t look like a valid school website address — double-check it and try again.' })
        return
      }
      setExtractResult({ type: 'error', message: res?.error ?? 'Could not extract school info. Check the URL is the school homepage.' })
      return
    }
    const info = res?.school_info ?? {}
    setD((prev) => mergeExtractedSchoolInfo(prev, info, schoolChanged))
    onExtracted?.({
      school_name:    info.school_name,
      school_address: info.school_address,
      school_phone:   info.school_phone,
      school_email:   info.school_email,
      head_teacher:   info.head_teacher,
    })
    const fieldLabels = { school_name: 'school name', school_address: 'address', school_phone: 'phone', school_email: 'email', head_teacher: 'headteacher', school_hours: 'school hours' }
    const missing = Object.entries(fieldLabels)
      .filter(([k]) => {
        // On a school change, the old value was just cleared above — don't let the
        // stale prop make an actually-missing field look "already known."
        const prev = schoolChanged ? null : data?.[k === 'school_hours' ? 'hours' : k]
        const got  = info[k]
        return !prev && !got
      })
      .map(([, label]) => label)
    const missingMsg = missing.length ? ` Couldn't find: ${missing.join(', ')}.` : ''

    const termMsg = (res?.term_dates > 0) ? ' Term dates also found.' : ''
    setExtractResult({ type: missing.length ? 'info' : 'success', message: `School info extracted.${termMsg}${missingMsg}` })
  }

  return (
    <>
    <SectionWrapper isParent={isParent} onSave={save} saved={saved} updatedAt={updatedAt}>
      {showSameSchoolPrompt && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2.5">
          <p className="text-sm font-medium text-canopy-deep">
            Is {firstName(childName)} at the same school as {siblingSchoolGroups.map((g) => g.names.map(firstName).join(' & ')).join(', or ')}?
          </p>
          <div className="space-y-2">
            {siblingSchoolGroups.map((g) => (
              <button
                key={g.school_name}
                onClick={() => applySameSchool(g)}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-canopy-deep hover:bg-canopy-mist/40 transition-colors"
              >
                Yes — same as {g.names.map(firstName).join(' & ')} ({g.school_name})
              </button>
            ))}
            <button
              onClick={dismissSameSchoolPrompt}
              className="w-full text-center px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              No, different school
            </button>
          </div>
        </div>
      )}

      {/* School URL + auto-extract */}
      <div className="space-y-1.5 pb-1">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">School homepage URL</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={d.school_url}
            onChange={(e) => {
              f('school_url').onChange(e.target.value)
              setUrlError(null)
            }}
            onBlur={(e) => setUrlError(validateUrl(e.target.value))}
            placeholder="https://stmarys.sch.uk"
            readOnly={!isParent}
            className={`flex-1 border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green ${!isParent ? 'bg-gray-50 text-gray-500' : 'bg-white'} ${urlError ? 'border-red-400' : 'border-gray-200'}`}
          />
          {isParent && (
            <button
              onClick={extractSchoolInfo}
              disabled={extracting || !d.school_url || !!urlError}
              title="Fetch school info & term dates"
              className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-canopy-mid text-white hover:bg-canopy-deep transition-colors disabled:opacity-40"
            >
              {extracting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <FetchIcon className="w-5 h-5" />
              )}
            </button>
          )}
        </div>
        {urlError && (
          <p className="text-xs text-red-600 font-medium">{urlError}</p>
        )}
        {extractResult && (
          <p className={`text-xs font-medium ${extractResult.type === 'error' ? 'text-red-600' : extractResult.type === 'info' ? 'text-amber-600' : 'text-green-600'}`}>
            {extractResult.message}
          </p>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-3">
        <Field label="School name" placeholder="St Mary's Primary School" {...f('school_name')} />
        <Field label="Address" placeholder="3 School Lane, London" {...f('school_address')} />
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('school_phone')} />
        <Field label="Email" placeholder="office@stmarys.sch.uk" type="email" {...f('school_email')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours" placeholder="e.g. 8:50 – 3:15" {...f('hours')} />
          <Field label="Head teacher" placeholder="Mr Brown" {...f('head_teacher')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year group" placeholder="e.g. Year 4" {...f('year_group')} />
          <Field label="Class / Tutor Group" placeholder="e.g. Maple" {...f('class_name')} />
        </div>
        <Field label="Class teacher" placeholder="Mrs Taylor" {...f('teacher')} />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">
            {regionConfig.pe.label} days
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {PE_WEEKDAYS.map(({ key, short }) => {
              const selected = (d.pe_days ?? []).includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!isParent}
                  onClick={() => {
                    if (!isParent) return
                    const current = d.pe_days ?? []
                    const next = selected ? current.filter((x) => x !== key) : [...current, key]
                    setD((p) => ({ ...p, pe_days: next }))
                    setSaved(false)
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selected
                      ? 'border-canopy-mid bg-canopy-frost text-canopy-deep'
                      : 'border-gray-200 bg-white text-gray-500'
                  } ${!isParent ? 'opacity-60' : ''}`}
                >
                  {short}
                </button>
              )
            })}
          </div>
          {(d.pe_days ?? []).length > 0 && (
            <p className="text-xs text-gray-400">
              Shows a reminder on the calendar to pack {regionConfig.pe.kit} on these days.
            </p>
          )}
        </div>

        <TextArea label="Notes" placeholder="e.g. Gate code, parking notes…" rows={3} {...f('notes')} />
      </div>

    </SectionWrapper>

    {schoolChangePrompt && (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-amber-900">
          Term dates for <span className="font-semibold">{schoolChangePrompt.schoolName}</span> are still in your calendar. Remove them?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setSchoolChangePrompt(null)}
            className="flex-1 py-2 rounded-xl border border-amber-300 text-amber-800 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            Keep
          </button>
          <button
            onClick={deleteOldTermDates}
            disabled={schoolChangeDeleting}
            className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            {schoolChangeDeleting ? 'Removing…' : 'Yes, remove'}
          </button>
        </div>
      </div>
    )}
    </>
  )
}

// ── Contacts ──────────────────────────────────────────────────

function ContactsSection({ data, isParent, onSave, updatedAt }) {
  const blank = () => ({ id: crypto.randomUUID(), name: '', relationship: '', phone: '', notes: '' })
  const [contacts, setContacts] = useState((data?.contacts?.length ? data.contacts : [blank()]))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setContacts(data?.contacts?.length ? data.contacts : [blank()])
  }, [JSON.stringify(data)])

  function update(id, field, value) {
    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c))
    setSaved(false)
  }

  async function save() {
    const { error } = await onSave({ contacts })
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <div className="space-y-4">
      {contacts.map((c, i) => (
        <div key={c.id} className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact {i + 1}</span>
            {isParent && contacts.length > 1 && (
              <button
                onClick={() => { setContacts((p) => p.filter((x) => x.id !== c.id)); setSaved(false) }}
                className="text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" placeholder="Jane Smith" value={c.name} onChange={(v) => update(c.id, 'name', v)} readOnly={!isParent} />
            <Field label="Relationship" placeholder="Grandmother" value={c.relationship} onChange={(v) => update(c.id, 'relationship', v)} readOnly={!isParent} />
          </div>
          <Field label="Phone" placeholder="+44 7911 123456" type="tel" value={c.phone} onChange={(v) => update(c.id, 'phone', v)} readOnly={!isParent} />
          <Field label="Notes" placeholder="Available after 6pm" value={c.notes} onChange={(v) => update(c.id, 'notes', v)} readOnly={!isParent} />
        </div>
      ))}

      {isParent && (
        <button
          onClick={() => { setContacts((p) => [...p, blank()]); setSaved(false) }}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
        >
          + Add contact
        </button>
      )}

      {isParent && (
        <Button className="w-full py-3" onClick={save}>
          {saved ? '✓ Saved' : 'Save'}
        </Button>
      )}
      {updatedAt && (
        <p className="text-xs text-gray-400 text-center">
          Last updated {new Date(updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      )}
    </div>
  )
}

// ── Vet ───────────────────────────────────────────────────────

function VetSection({ data, isParent, onSave, updatedAt }) {
  const [d, setD] = useState({ dob: '', species: '', breed: '', colour: '', neutered: '', vet_name: '', vet_phone: '', vet_email: '', vet_address: '', emergency_vet_name: '', emergency_vet_phone: '', emergency_vet_address: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ dob: '', species: '', breed: '', colour: '', neutered: '', vet_name: '', vet_phone: '', vet_email: '', vet_address: '', emergency_vet_name: '', emergency_vet_phone: '', emergency_vet_address: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved} updatedAt={updatedAt}>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Profile</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Species" placeholder="e.g. Dog, Cat, Rabbit" {...f('species')} />
        <Field label="Breed" placeholder="e.g. Labrador" {...f('breed')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Colour / markings" placeholder="e.g. Black with white chest" {...f('colour')} />
        <Field label="Neutered" placeholder="Yes / No" {...f('neutered')} />
      </div>
      <Field label="Date of birth" type="date" {...f('dob')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Vet</p>
      <Field label="Practice name" placeholder="Riverside Vets" {...f('vet_name')} />
      <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('vet_phone')} />
      <Field label="Email" placeholder="info@riversidevets.co.uk" type="email" {...f('vet_email')} />
      <Field label="Address" placeholder="1 High Street, London" {...f('vet_address')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Emergency vet</p>
      <Field label="Practice name" placeholder="24hr Animal Hospital" {...f('emergency_vet_name')} />
      <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('emergency_vet_phone')} />
      <Field label="Address" placeholder="2 High Street, London" {...f('emergency_vet_address')} />
      <TextArea label="Notes" placeholder="e.g. Preferred appointment day, parking notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── Pet Medical ───────────────────────────────────────────────

function PetMedicalSection({ data, isParent, onSave, updatedAt }) {
  const [d, setD] = useState({ microchip: '', insurance_provider: '', insurance_policy: '', insurance_renewal: '', vaccinations: '', flea_treatment: '', worming: '', diet: '', medications: '', conditions: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ microchip: '', insurance_provider: '', insurance_policy: '', insurance_renewal: '', vaccinations: '', flea_treatment: '', worming: '', diet: '', medications: '', conditions: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved} updatedAt={updatedAt}>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Identity</p>
      <Field label="Microchip number" placeholder="123456789012345" {...f('microchip')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Insurance</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider" placeholder="Petplan" {...f('insurance_provider')} />
        <Field label="Policy number" placeholder="PP-123456" {...f('insurance_policy')} />
      </div>
      <Field label="Renewal date" type="date" {...f('insurance_renewal')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Health</p>
      <TextArea label="Vaccinations" placeholder="e.g. Annual booster due March 2027" {...f('vaccinations')} />
      <TextArea label="Flea & tick treatment" placeholder="e.g. Frontline monthly, last done Jan 2026" {...f('flea_treatment')} />
      <TextArea label="Worming" placeholder="e.g. Drontal every 3 months, last done Feb 2026" {...f('worming')} />
      <TextArea label="Dietary requirements" placeholder="e.g. Grain-free, raw diet, 2 cups twice daily" {...f('diet')} />
      <TextArea label="Medications" placeholder="e.g. Apoquel 16mg daily" {...f('medications')} />
      <TextArea label="Conditions" placeholder="e.g. Hip dysplasia" {...f('conditions')} />
      <TextArea label="Notes" placeholder="Any other health notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── Personal ──────────────────────────────────────────────────

function PersonalSection({ data, isParent, onSave }) {
  const defaults = { dob: '', height: '', weight: '', top_size: '', bottom_size: '', shoe_size: '', notes: '' }
  const [d, setD] = useState({ ...defaults, ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ ...defaults, ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  const fu = data?._field_updated ?? {}

  async function save() {
    const now = new Date().toISOString()
    const prev = { ...defaults, ...data }
    const newFu = { ...fu }
    for (const k of Object.keys(defaults)) {
      if (d[k] !== prev[k]) newFu[k] = now
    }
    const { error } = await onSave({ ...d, _field_updated: newFu })
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved} updatedAt={null}>
      <Field label="Date of birth" type="date" {...f('dob')} updatedAt={fu.dob} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Height" placeholder="e.g. 128cm / 4ft 2in" {...f('height')} updatedAt={fu.height} />
        <Field label="Weight" placeholder="e.g. 26kg / 4st 1lb" {...f('weight')} updatedAt={fu.weight} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Top size" placeholder="Age 8 / 128cm" {...f('top_size')} updatedAt={fu.top_size} />
        <Field label="Bottoms" placeholder="Age 8 / 128cm" {...f('bottom_size')} updatedAt={fu.bottom_size} />
        <Field label="Shoe size" placeholder="2 / EU 34" {...f('shoe_size')} updatedAt={fu.shoe_size} />
      </div>
      <TextArea label="Notes" placeholder="e.g. Prefers slim fit, sensitive skin…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

function PhoneIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  )
}

function MailIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function CopyIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="9" y="9" width="13" height="13" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}


// Globe with down-arrow: "fetch from internet"
function FetchIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3.5 9h17M3.5 15h17" />
      <path strokeLinecap="round" d="M12 3c-2.5 3-3.5 5.5-3.5 9s1 6 3.5 9M12 3c2.5 3 3.5 5.5 3.5 9s-1 6-3.5 9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-5M10 14l2 2 2-2" />
    </svg>
  )
}
