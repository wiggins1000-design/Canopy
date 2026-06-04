import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import VaultSection from '../components/infobank/VaultSection'

const SECTIONS = [
  { id: 'medical',   label: 'Medical'   },
  { id: 'school',    label: 'School'    },
  { id: 'contacts',  label: 'Contacts'  },
  { id: 'personal',  label: 'Personal'  },
  { id: 'docs',      label: 'Docs'      },
]

export default function InfoBankPage() {
  const { family, isParent } = useFamily()
  const navigate = useNavigate()
  const children = (family?.config?.children ?? []).filter((c) => c.name)

  const tabs = [...children.map((c) => c.name), 'Family']
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
    }
    return { error }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <h1 className="text-xl font-bold text-gray-900">Info Bank</h1>
        <p className="text-sm text-gray-500">Add children in Settings first to start filling in the info bank.</p>
        <Button variant="secondary" className="mx-auto" onClick={() => navigate('/config')}>
          Go to Settings
        </Button>
      </div>
    )
  }

  const sectionData = getData(activeTab, activeSection)

  return (
    <div className="px-4 py-5 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Info Bank</h1>

      {/* Child / Family tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setActiveSection('medical') }}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors shrink-0 ${
              activeTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {(activeTab === 'Family' ? [{ id: 'contacts', label: 'Contacts' }, { id: 'docs', label: 'Docs' }] : SECTIONS).map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
              activeSection === s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeTab === 'Family' ? (
        <ContactsSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection('Family', 'contacts', data)}
        />
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
          onSave={(data) => saveSection(activeTab, 'school', data)}
        />
      ) : activeSection === 'contacts' ? (
        <ContactsSection
          data={sectionData}
          isParent={isParent}
          onSave={(data) => saveSection(activeTab, 'contacts', data)}
        />
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
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={readOnly ? '—' : placeholder}
        readOnly={readOnly}
        className={`w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}
      />
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
        className={`w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}
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
  const [d, setD] = useState({ gp_name: '', gp_phone: '', gp_address: '', dentist_name: '', dentist_phone: '', dentist_address: '', blood_type: '', allergies: '', medications: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ gp_name: '', gp_phone: '', gp_address: '', dentist_name: '', dentist_phone: '', dentist_address: '', blood_type: '', allergies: '', medications: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">GP / Doctor</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" placeholder="Dr Smith" {...f('gp_name')} />
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('gp_phone')} />
      </div>
      <Field label="Address" placeholder="1 High Street, London" {...f('gp_address')} />

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-1">Dentist</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" placeholder="Dr Jones" {...f('dentist_name')} />
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('dentist_phone')} />
      </div>
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

function SchoolSection({ data, isParent, onSave }) {
  const [d, setD] = useState({ school_name: '', school_address: '', school_phone: '', teacher: '', head_teacher: '', hours: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ school_name: '', school_address: '', school_phone: '', teacher: '', head_teacher: '', hours: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <Field label="School name" placeholder="St Mary's Primary School" {...f('school_name')} />
      <Field label="Address" placeholder="3 School Lane, London" {...f('school_address')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" placeholder="+44 20 1234 5678" type="tel" {...f('school_phone')} />
        <Field label="Hours" placeholder="e.g. 8:50 – 3:15" {...f('hours')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Class teacher" placeholder="Mrs Taylor" {...f('teacher')} />
        <Field label="Head teacher" placeholder="Mr Brown" {...f('head_teacher')} />
      </div>
      <TextArea label="Notes" placeholder="e.g. Gate code, parking notes…" rows={3} {...f('notes')} />
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
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
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

// ── Personal ──────────────────────────────────────────────────

function PersonalSection({ data, isParent, onSave }) {
  const [d, setD] = useState({ top_size: '', bottom_size: '', shoe_size: '', notes: '', ...data })
  const [saved, setSaved] = useState(false)

  useEffect(() => { setD({ top_size: '', bottom_size: '', shoe_size: '', notes: '', ...data }) }, [JSON.stringify(data)])

  const f = (k) => ({ value: d[k], onChange: (v) => { setD((p) => ({ ...p, [k]: v })); setSaved(false) }, readOnly: !isParent })

  async function save() {
    const { error } = await onSave(d)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <SectionWrapper isParent={isParent} onSave={save} saved={saved}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Top size" placeholder="Age 8 / 128cm" {...f('top_size')} />
        <Field label="Bottoms" placeholder="Age 8 / 128cm" {...f('bottom_size')} />
        <Field label="Shoe size" placeholder="2 / EU 34" {...f('shoe_size')} />
      </div>
      <TextArea label="Notes" placeholder="e.g. Prefers slim fit, sensitive skin…" rows={3} {...f('notes')} />
    </SectionWrapper>
  )
}
