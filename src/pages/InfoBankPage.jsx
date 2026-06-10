import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import Button from '../components/ui/Button'
import VaultSection from '../components/infobank/VaultSection'
import AccountsSection from '../components/infobank/AccountsSection'

const SECTIONS = [
  { id: 'medical',   label: 'Medical'  },
  { id: 'school',    label: 'School'   },
  { id: 'personal',  label: 'Personal' },
  { id: 'accounts',  label: 'Accounts' },
  { id: 'docs',      label: 'Docs'     },
  { id: 'contacts',  label: 'Contacts' },
]

export default function InfoBankPage() {
  const { family, isParent } = useFamily()
  const navigate = useNavigate()
  const children = (family?.config?.children ?? []).filter((c) => c.name)
  const pets     = (family?.config?.pets ?? []).filter((p) => p.name)

  const petNames = new Set(pets.map((p) => p.name))
  const tabs = [...children.map((c) => c.name), ...pets.map((p) => p.name), 'Family']
  const [activeTab, setActiveTab]       = useState(null)
  const [activeSection, setActiveSection] = useState('medical')
  const [allData, setAllData]           = useState({})
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    if (tabs.length > 0 && activeTab === null) setActiveTab(tabs[0])
  }, [tabs.join(',')])

  const loadAll = useCallback(async () => {
    if (!family?.id) return
    const { data } = await supabase.from('info_bank').select('*').eq('family_id', family.id)
    const map = {}
    for (const row of data ?? []) {
      map[`${row.child_name}||${row.section}`] = row.data
    }
    setAllData(map)
    setLoading(false)
  }, [family?.id])

  useEffect(() => { loadAll() }, [loadAll])

  function getData(tab, section) {
    return allData[`${tab}||${section}`] ?? {}
  }

  async function saveSection(tab, section, data) {
    const { error } = await supabase.from('info_bank').upsert(
      { family_id: family.id, child_name: tab, section, data, updated_at: new Date().toISOString() },
      { onConflict: 'family_id,child_name,section' }
    )
    if (!error) {
      setAllData((prev) => ({ ...prev, [`${tab}||${section}`]: data }))

      const siblings = children.filter((c) => c.name !== tab)

      // School sync: propagate shared school fields to siblings at the same school
      if (section === 'school' && data.school_name) {
        const SHARED = ['school_name', 'school_address', 'school_phone', 'school_email', 'head_teacher', 'hours', 'school_url']
        const sharedPatch = Object.fromEntries(SHARED.map((k) => [k, data[k] ?? '']))
        for (const sibling of siblings) {
          const sibData = allData[`${sibling.name}||school`] ?? {}
          if (!sibData.school_name || sibData.school_name === data.school_name) {
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
            const defaultSection = petNames.has(tab) ? 'vet' : tab === 'Family' ? 'contacts' : 'medical'
            setActiveTab(tab)
            setActiveSection(defaultSection)
          }}
          className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-canopy-green pr-10"
        >
          {children.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
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
          />
        ) : activeSection === 'medical' ? (
          <PetMedicalSection
            data={sectionData}
            isParent={isParent}
            onSave={(data) => saveSection(activeTab, 'medical', data)}
          />
        ) : (
          <VaultSection childName={activeTab} />
        )
      ) : activeSection === 'medical' ? (
        <MedicalSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'medical', data)}
        />
      ) : activeSection === 'school' ? (
        <SchoolSection
          data={sectionData}
          isParent={isParent}
          familyId={family.id}
          childName={activeTab}
          onSave={(data) => saveSection(activeTab, 'school', data)}
          onExtracted={(data) => setAllData((prev) => ({ ...prev, [`${activeTab}||school`]: { ...prev[`${activeTab}||school`], ...data } }))}
        />
      ) : activeSection === 'contacts' ? (
        <ContactsSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'contacts', data)}
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
        />
      )}
    </div>
  )
}

// ── Shared field components ───────────────────────────────────

function Field({ label, value, onChange, placeholder, readOnly, type = 'text' }) {
  const actionHref = value
    ? type === 'tel'   ? `tel:${value.replace(/\s/g, '')}`
    : type === 'email' ? `mailto:${value}`
    : null : null

  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <div className={actionHref ? 'flex items-center gap-2 w-full min-w-0' : ''}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={readOnly ? '—' : placeholder}
          readOnly={readOnly}
          className={`border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green ${readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'} ${actionHref ? 'flex-1 min-w-0' : 'w-full'}`}
        />
        {actionHref && (
          <a
            href={actionHref}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-canopy-frost hover:text-canopy-deep transition-colors"
          >
            {type === 'tel' ? <PhoneIcon className="w-4 h-4" /> : <MailIcon className="w-4 h-4" />}
          </a>
        )}
      </div>
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

function SectionWrapper({ children, isParent, onSave, saved }) {
  return (
    <div className="space-y-3">
      {children}
      {isParent && (
        <Button className="w-full py-3" onClick={onSave}>
          {saved ? '✓ Saved' : 'Save'}
        </Button>
      )}
    </div>
  )
}

// ── Medical ───────────────────────────────────────────────────

function MedicalSection({ data, isParent, onSave }) {
  const defaults = { gp_practice: '', gp_name: '', gp_phone: '', gp_email: '', gp_address: '', dentist_practice: '', dentist_name: '', dentist_phone: '', dentist_email: '', dentist_address: '', blood_type: '', allergies: '', medications: '', notes: '' }
  const [d, setD] = useState({ ...defaults, ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ ...defaults, ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
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
      <Field label="Blood type" placeholder="e.g. A+" {...f('blood_type')} />
      <TextArea label="Allergies" placeholder="e.g. Penicillin, peanuts" {...f('allergies')} />
      <TextArea label="Medications" placeholder="e.g. Ventolin 100mcg when needed" {...f('medications')} />
      <TextArea label="Notes" placeholder="Any other medical notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── School ────────────────────────────────────────────────────

function SchoolSection({ data, isParent, familyId, childName, onSave, onExtracted }) {
  const defaults = { year_group: '', class_name: '', school_name: '', school_address: '', school_phone: '', school_email: '', teacher: '', head_teacher: '', hours: '', notes: '', school_url: '' }
  const [d, setD] = useState({ ...defaults, ...data })
  const [saved, setSaved] = useState(false)
  const [lastFetched, setLastFetched] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState(null)

  useEffect(() => { setD({ ...defaults, ...data }); setCheckResult(null); setExtractResult(null) }, [JSON.stringify(data)])

  useEffect(() => {
    if (!d.school_url) { setLastFetched(null); return }
    try {
      const raw = d.school_url.startsWith('http') ? d.school_url : `https://${d.school_url}`
      const u = new URL(raw)
      if (!u.hostname.includes('.')) return  // not a valid hostname yet
      const key = (u.origin + u.pathname + u.search).toLowerCase().replace(/\/$/, '')
      supabase.from('school_calendars').select('last_fetched_at, school_name')
        .eq('homepage_url', key)
        .maybeSingle()
        .then(({ data }) => setLastFetched(data))
    } catch {
      setLastFetched(null)
    }
  }, [d.school_url])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    return { error }
  }

  async function extractSchoolInfo() {
    if (!d.school_url) return
    setExtracting(true)
    setExtractResult(null)
    // Save URL first so edge function can read it
    await save()
    const { data: res, error } = await supabase.functions.invoke('extract-school-info', {
      body: {
        family_id:  familyId,
        child_name: childName,
        school_url: d.school_url,
      },
    })
    setExtracting(false)
    if (error || res?.error) {
      setExtractResult({ type: 'error', message: res?.error ?? 'Could not extract school info. Check the URL is the school homepage.' })
      return
    }
    const info = res?.school_info ?? {}
    // Merge extracted fields into local state (only fill blanks)
    setD((prev) => ({
      ...prev,
      school_name:    prev.school_name    || info.school_name    || prev.school_name,
      school_address: prev.school_address || info.school_address || prev.school_address,
      school_phone:   prev.school_phone   || info.school_phone   || prev.school_phone,
      school_email:   prev.school_email   || info.school_email   || prev.school_email,
      head_teacher:   prev.head_teacher   || info.head_teacher   || prev.head_teacher,
      hours:          prev.hours          || info.school_hours   || prev.hours,
    }))
    onExtracted?.({
      school_name:    info.school_name,
      school_address: info.school_address,
      school_phone:   info.school_phone,
      school_email:   info.school_email,
      head_teacher:   info.head_teacher,
    })
    const termMsg = res.events_added > 0
      ? ` · ${res.events_added} term date${res.events_added === 1 ? '' : 's'} added to calendar.`
      : res.term_dates > 0 ? ' · Term dates already up to date.' : ''

    const fieldLabels = { school_name: 'school name', school_address: 'address', school_phone: 'phone', school_email: 'email', head_teacher: 'headteacher', school_hours: 'school hours' }
    const missing = Object.entries(fieldLabels)
      .filter(([k]) => {
        const prev = data?.[k === 'school_hours' ? 'hours' : k]
        const got  = info[k]
        return !prev && !got
      })
      .map(([, label]) => label)
    const missingMsg = missing.length ? ` Couldn't find: ${missing.join(', ')}.` : ''

    setExtractResult({ type: missing.length ? 'info' : 'success', message: `School info extracted.${termMsg}${missingMsg}` })
  }

  async function checkTermDates() {
    setChecking(true)
    setCheckResult(null)
    await save()
    const { data: res, error } = await supabase.functions.invoke('check-term-dates', { body: {} })
    setChecking(false)
    if (error) {
      setCheckResult({ type: 'error', message: 'Could not connect to the service. Try again.' })
      return
    }
    const results = res?.results ?? []
    if (results.length === 0) {
      setCheckResult({ type: 'error', message: 'Save the school website URL first, then try again.' })
      return
    }
    // Pick the best result: success > unchanged > no_dates > error
    const priority = { ok: 4, unchanged: 3, no_dates: 2, error: 1 }
    const r = results.reduce((best, cur) =>
      (priority[cur.status] ?? 0) > (priority[best.status] ?? 0) ? cur : best
    , results[0])

    if (r.status === 'error') {
      setCheckResult({ type: 'error', message: r.error ?? 'Something went wrong. Check the URL is a valid school website.' })
    } else if (r.status === 'unchanged') {
      setCheckResult({ type: 'info', message: 'School website checked — no changes found.' })
    } else if (r.status === 'no_dates') {
      setCheckResult({ type: 'info', message: "Couldn't find upcoming term dates on the page. Check the URL is correct." })
    } else if (r.eventsAdded > 0) {
      setCheckResult({ type: 'success', message: `${r.eventsAdded} term date event${r.eventsAdded === 1 ? '' : 's'} added to your calendar.` })
    } else {
      setCheckResult({ type: 'info', message: 'Calendar is already up to date.' })
    }
    // Refresh last fetched
    if (d.school_url) {
      try {
        const origin = new URL(d.school_url.startsWith('http') ? d.school_url : `https://${d.school_url}`).origin
        const { data: cal } = await supabase.from('school_calendars').select('last_fetched_at, school_name').eq('homepage_url', origin).maybeSingle()
        setLastFetched(cal)
      } catch {}
    }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      {/* School URL + auto-extract */}
      <div className="space-y-1.5 pb-1">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">School homepage URL</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={d.school_url}
            onChange={(v) => { f('school_url').onChange(v.target.value) }}
            placeholder="https://stmarys.sch.uk"
            readOnly={!isParent}
            className={`flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green ${!isParent ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}
          />
          {isParent && (
            <button
              onClick={extractSchoolInfo}
              disabled={extracting || !d.school_url}
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
        {extractResult && (
          <p className={`text-xs font-medium ${extractResult.type === 'error' ? 'text-red-600' : extractResult.type === 'info' ? 'text-amber-600' : 'text-green-600'}`}>
            {extractResult.message}
          </p>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-3">
        <Field label="School name" placeholder="St Mary's Primary School" {...f('school_name')} />
        <Field label="Address" placeholder="3 School Lane, London" {...f('school_address')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('school_phone')} />
          <Field label="Email" placeholder="office@stmarys.sch.uk" type="email" {...f('school_email')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours" placeholder="e.g. 8:50 – 3:15" {...f('hours')} />
          <Field label="Head teacher" placeholder="Mr Brown" {...f('head_teacher')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year group" placeholder="e.g. Year 4" {...f('year_group')} />
          <Field label="Class" placeholder="e.g. Maple" {...f('class_name')} />
        </div>
        <Field label="Class teacher" placeholder="Mrs Taylor" {...f('teacher')} />
        <TextArea label="Notes" placeholder="e.g. Gate code, parking notes…" rows={3} {...f('notes')} />
      </div>

      <div className="pt-1 border-t border-gray-100 space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block pt-1">Term Dates</label>
        {lastFetched?.last_fetched_at && (
          <p className="text-xs text-gray-400">
            Last checked {formatDistanceToNow(new Date(lastFetched.last_fetched_at), { addSuffix: true })}
            {lastFetched.school_name ? ` · ${lastFetched.school_name}` : ''}
          </p>
        )}
        {checkResult && (
          <p className={`text-xs font-medium ${checkResult.type === 'error' ? 'text-red-600' : checkResult.type === 'success' ? 'text-green-600' : 'text-gray-500'}`}>
            {checkResult.message}
          </p>
        )}
        {isParent && d.school_url && (
          <button
            onClick={checkTermDates}
            disabled={checking}
            className="w-full border border-canopy-mist bg-canopy-frost text-canopy-deep rounded-xl py-2.5 text-sm font-medium hover:bg-canopy-mist transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking website…' : 'Refresh term dates only'}
          </button>
        )}
      </div>
    </SectionWrapper>
  )
}

// ── Contacts ──────────────────────────────────────────────────

function ContactsSection({ data, isParent, onSave }) {
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
    </div>
  )
}

// ── Vet ───────────────────────────────────────────────────────

function VetSection({ data, isParent, onSave }) {
  const [d, setD] = useState({ dob: '', vet_name: '', vet_phone: '', vet_address: '', emergency_vet_name: '', emergency_vet_phone: '', emergency_vet_address: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ dob: '', vet_name: '', vet_phone: '', vet_address: '', emergency_vet_name: '', emergency_vet_phone: '', emergency_vet_address: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <Field label="Date of birth" type="date" {...f('dob')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Vet</p>
      <Field label="Practice name" placeholder="Riverside Vets" {...f('vet_name')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('vet_phone')} />
      </div>
      <Field label="Address" placeholder="1 High Street, London" {...f('vet_address')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Emergency vet</p>
      <Field label="Practice name" placeholder="24hr Animal Hospital" {...f('emergency_vet_name')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('emergency_vet_phone')} />
      </div>
      <Field label="Address" placeholder="2 High Street, London" {...f('emergency_vet_address')} />
      <TextArea label="Notes" placeholder="e.g. Preferred appointment day, parking notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── Pet Medical ───────────────────────────────────────────────

function PetMedicalSection({ data, isParent, onSave }) {
  const [d, setD] = useState({ microchip: '', insurance_provider: '', insurance_policy: '', vaccinations: '', medications: '', conditions: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ microchip: '', insurance_provider: '', insurance_policy: '', vaccinations: '', medications: '', conditions: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Identity</p>
      <Field label="Microchip number" placeholder="123456789012345" {...f('microchip')} />
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Insurance</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider" placeholder="Petplan" {...f('insurance_provider')} />
        <Field label="Policy number" placeholder="PP-123456" {...f('insurance_policy')} />
      </div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Health</p>
      <TextArea label="Vaccinations" placeholder="e.g. Annual booster due March" {...f('vaccinations')} />
      <TextArea label="Medications" placeholder="e.g. Flea treatment monthly" {...f('medications')} />
      <TextArea label="Conditions" placeholder="e.g. Hip dysplasia" {...f('conditions')} />
      <TextArea label="Notes" placeholder="Any other health notes…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}

// ── Personal ──────────────────────────────────────────────────

function PersonalSection({ data, isParent, onSave }) {
  const [d, setD] = useState({ dob: '', top_size: '', bottom_size: '', shoe_size: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ dob: '', top_size: '', bottom_size: '', shoe_size: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <Field label="Date of birth" type="date" {...f('dob')} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Top size" placeholder="Age 8 / 128cm" {...f('top_size')} />
        <Field label="Bottoms" placeholder="Age 8 / 128cm" {...f('bottom_size')} />
        <Field label="Shoe size" placeholder="2 / EU 34" {...f('shoe_size')} />
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
