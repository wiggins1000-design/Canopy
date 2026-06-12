import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { supabase, registerPushSubscription, unregisterPushSubscription } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import { buildPresetPattern, PATTERN_LABELS, parseDate, formatDate } from '../lib/scheduleEngine'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import CalendarSyncSection from '../components/calendar/CalendarSyncSection'

const PATTERNS = ['alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom']

export default function ConfigPage() {
  const { schedule, saveSchedule, updateFamilyConfig, family, member, parentA, parentB, isParent, reload } = useFamily()
  const { user, signOut } = useAuth()
  const emailDomain = import.meta.env.VITE_EMAIL_DOMAIN ?? 'canopy.app'
  const familyEmail = family?.email_key ? `${family.email_key}@${emailDomain}` : null
  const navigate    = useNavigate()

  const [patternType, setPatternType] = useState('alternating_weeks')
  const [startingParent, setStartingParent] = useState('parent_a')
  const [startDate, setStartDate] = useState(formatDate(new Date()))
  const [customCycle, setCustomCycle] = useState([])
  const [changeoverTime, setChangeoverTime] = useState('')
  const [changeoverLocation, setChangeoverLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const [children, setChildren] = useState([])
  const [childrenSaving, setChildrenSaving] = useState(false)
  const [childrenSaved, setChildrenSaved] = useState(false)

  const [pets, setPets] = useState([])
  const [petsSaving, setPetsSaving] = useState(false)
  const [petsSaved, setPetsSaved] = useState(false)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)
  const [phoneError, setPhoneError] = useState(null)

  const [pushEnabled, setPushEnabled]   = useState(false)
  const [pushLoading, setPushLoading]   = useState(false)
  const [pushSupported, setPushSupported] = useState(true)
  const [pushBlocked, setPushBlocked]   = useState(false)

  const [additionalEmails, setAdditionalEmails] = useState([])
  const [newEmail, setNewEmail]               = useState('')
  const [emailAdding, setEmailAdding]         = useState(false)
  const [emailError, setEmailError]           = useState(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving]   = useState(false)
  const [passwordSaved, setPasswordSaved]     = useState(false)
  const [passwordError, setPasswordError]     = useState(null)

  useEffect(() => {
    if (!schedule) return
    setPatternType(schedule.pattern_type)
    setStartingParent(schedule.starting_parent)
    setStartDate(schedule.start_date)
    if (schedule.pattern_type === 'custom') {
      setCustomCycle(schedule.pattern_data?.cycle ?? [])
    }
  }, [schedule])

  useEffect(() => {
    if (!family?.config) return
    setChangeoverTime(family.config.changeover_time ?? '')
    setChangeoverLocation(family.config.changeover_location ?? '')
    setChildren(family.config.children ?? [])
    setPets(family.config.pets ?? [])
  }, [family?.config])

  useEffect(() => {
    setPhoneNumber(member?.phone_number ?? '')
  }, [member?.phone_number])

  async function handleSave() {
    setSaving(true)
    setError(null)

    if (!startDate) {
      setError('Enter the date this schedule takes effect from.')
      setSaving(false)
      return
    }

    const today = formatDate(new Date())
    if (schedule && startDate < today) {
      setError('The effective date must be today or in the future.')
      setSaving(false)
      return
    }

    let patternData
    if (patternType === 'custom') {
      if (customCycle.length === 0) {
        setError('Add at least one day to the custom cycle.')
        setSaving(false)
        return
      }
      patternData = { cycle: customCycle }
    } else {
      patternData = buildPresetPattern(patternType, startingParent)
    }

    try {
      const { error: err } = await saveSchedule({
        pattern_type:    patternType,
        pattern_data:    patternData,
        start_date:      startDate,
        starting_parent: startingParent,
      })

      if (err) { setError(err.message); setSaving(false); return }

      await updateFamilyConfig({
        changeover_time: changeoverTime || null,
        changeover_location: changeoverLocation.trim() || null,
      })

      setSaved(true)
      setTimeout(() => navigate('/calendar'), 1200)
    } catch (e) {
      setError('Failed to save — check your connection and try again.')
      setSaving(false)
    }
  }

  // Check current push subscription state
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushSupported(false)
      return
    }
    if (Notification.permission === 'denied') {
      setPushBlocked(true)
      return
    }
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        setPushEnabled(!!sub && !!member?.push_token)
      })
    )
  }, [member?.push_token])

  async function togglePush() {
    if (!member) return
    setPushLoading(true)
    if (pushEnabled) {
      await unregisterPushSubscription(member.user_id)
      setPushEnabled(false)
    } else {
      if (Notification.permission === 'denied') {
        setPushBlocked(true)
        setPushLoading(false)
        return
      }
      await registerPushSubscription(member.user_id)
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setPushEnabled(!!sub)
    }
    setPushLoading(false)
  }

  async function savePhone() {
    const cleaned = phoneNumber.trim()
    if (cleaned && !/^\+[1-9]\d{6,14}$/.test(cleaned)) {
      setPhoneError('Use international format, e.g. +44 7911 123456')
      return
    }
    setPhoneSaving(true)
    setPhoneError(null)
    const { error: err } = await supabase
      .from('family_members')
      .update({ phone_number: cleaned || null })
      .eq('user_id', member.user_id)
    if (err) { setPhoneError(err.message); setPhoneSaving(false); return }
    await reload()
    setPhoneSaved(true)
    setPhoneSaving(false)
    setTimeout(() => setPhoneSaved(false), 2500)
  }

  useEffect(() => {
    if (!user) return
    supabase.from('member_additional_emails').select('id, email').eq('user_id', user.id).order('created_at')
      .then(({ data }) => setAdditionalEmails(data ?? []))
  }, [user])

  async function addEmail() {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailError('Enter a valid email address.'); return }
    setEmailAdding(true)
    setEmailError(null)
    const { error: err } = await supabase.from('member_additional_emails').insert({ user_id: user.id, email: trimmed })
    if (err) { setEmailError(err.code === '23505' ? 'That email is already registered.' : err.message); setEmailAdding(false); return }
    setAdditionalEmails((prev) => [...prev, { id: crypto.randomUUID(), email: trimmed }])
    setNewEmail('')
    setEmailAdding(false)
  }

  async function removeEmail(id) {
    await supabase.from('member_additional_emails').delete().eq('id', id)
    setAdditionalEmails((prev) => prev.filter((e) => e.id !== id))
  }

  function addChild() {
    setChildren((prev) => [...prev, { id: crypto.randomUUID(), name: '' }])
  }

  function updateChild(id, field, value) {
    setChildren((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c))
  }

  function removeChild(id) {
    setChildren((prev) => prev.filter((c) => c.id !== id))
  }

  async function saveChildren() {
    setChildrenSaving(true)
    await updateFamilyConfig({ children })
    setChildrenSaved(true)
    setChildrenSaving(false)
    setTimeout(() => setChildrenSaved(false), 2500)
  }

  function addPet() {
    setPets((prev) => [...prev, { id: crypto.randomUUID(), name: '', type: '' }])
  }

  function updatePet(id, field, value) {
    setPets((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p))
  }

  function removePet(id) {
    setPets((prev) => prev.filter((p) => p.id !== id))
  }

  async function savePets() {
    setPetsSaving(true)
    await updateFamilyConfig({ pets })
    setPetsSaved(true)
    setPetsSaving(false)
    setTimeout(() => setPetsSaved(false), 2500)
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match.'); return }
    if (newPassword.length < 6) { setPasswordError('Password must be at least 6 characters.'); return }
    setPasswordSaving(true)
    setPasswordError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (authError) { setPasswordError('Current password is incorrect.'); setPasswordSaving(false); return }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setPasswordError(error.message); setPasswordSaving(false); return }
    setPasswordSaved(true)
    setPasswordSaving(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => setPasswordSaved(false), 2500)
  }

  const pa = parentA?.display_name ?? 'Parent A'
  const pb = parentB?.display_name ?? 'Parent B'

  if (!isParent) {
    return (
      <div className="px-4 py-5 space-y-2">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Settings</h1>

        <AccordionGroup label="Notifications">
          <PushToggleRow
            pushSupported={pushSupported}
            pushBlocked={pushBlocked}
            pushEnabled={pushEnabled}
            pushLoading={pushLoading}
            onToggle={togglePush}
          />
        </AccordionGroup>

        <AccordionGroup label="Account">
          <div className="px-4 py-3 space-y-3">
            <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} placeholder="••••••••" required />
            <PasswordField label="New password" value={newPassword} onChange={setNewPassword} placeholder="••••••••" required />
            <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" required />
            {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            <Button className="w-full py-3" loading={passwordSaving} onClick={changePassword}>
              {passwordSaved ? '✓ Password updated' : 'Update password'}
            </Button>
            <button onClick={signOut} className="w-full text-sm text-red-500 py-2 hover:underline">
              Sign out
            </button>
          </div>
        </AccordionGroup>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-2">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Settings</h1>

      {/* ── Family ── */}
      <AccordionGroup label="Children">
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-400">Add each child's name. Add school details in Info Bank for better FamilyFeed results.</p>
          {children.map((child, index) => (
            <div key={child.id} className="flex items-center gap-2">
              <input
                type="text"
                value={child.name}
                onChange={(e) => updateChild(child.id, 'name', e.target.value)}
                placeholder={`Child ${index + 1} name`}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
              />
              <button onClick={() => removeChild(child.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">Remove</button>
            </div>
          ))}
          <button
            onClick={addChild}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
          >
            + Add child
          </button>
          <Button className="w-full py-3" loading={childrenSaving} onClick={saveChildren}>
            {childrenSaved ? '✓ Saved' : 'Save children'}
          </Button>
        </div>
      </AccordionGroup>

      <AccordionGroup label="Pets">
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-400">Vet and medical details can be stored in the Info Bank.</p>
          {pets.map((pet, index) => (
            <div key={pet.id} className="flex items-center gap-2">
              <input
                type="text"
                value={pet.name}
                onChange={(e) => updatePet(pet.id, 'name', e.target.value)}
                placeholder="Name"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
              />
              <input
                type="text"
                value={pet.type}
                onChange={(e) => updatePet(pet.id, 'type', e.target.value)}
                placeholder="Dog, Cat…"
                className="w-28 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
              />
              <button onClick={() => removePet(pet.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">Remove</button>
            </div>
          ))}
          <button
            onClick={addPet}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
          >
            + Add pet
          </button>
          <Button className="w-full py-3" loading={petsSaving} onClick={savePets}>
            {petsSaved ? '✓ Saved' : 'Save pets'}
          </Button>
        </div>
      </AccordionGroup>

      {/* ── Parenting Schedule ── */}
      <AccordionGroup label="Parenting Schedule">
        <div className="px-4 py-3 space-y-4">
          {/* Pattern picker */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Rotation pattern</label>
            <div className="space-y-1.5">
              {PATTERNS.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-3 rounded-xl border px-4 py-2.5 cursor-pointer transition-colors"
                  style={{ borderColor: patternType === p ? '#3b82f6' : '#e5e7eb', background: patternType === p ? '#eff6ff' : '#f9fafb' }}
                >
                  <input type="radio" name="pattern" value={p} checked={patternType === p} onChange={() => setPatternType(p)} className="accent-canopy-mid" />
                  <span className="text-sm font-medium text-gray-800">{PATTERN_LABELS[p]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Starting parent */}
          {patternType !== 'custom' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">First period goes to</label>
              <div className="flex gap-2">
                {[{ role: 'parent_a', name: pa }, { role: 'parent_b', name: pb }].map(({ role, name }) => (
                  <button
                    key={role}
                    onClick={() => setStartingParent(role)}
                    className={['flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                      startingParent === role
                        ? role === 'parent_a' ? 'border-pa-700 bg-pa-100 text-pa-900' : 'border-pb-700 bg-pb-100 text-pb-900'
                        : 'border-gray-200 bg-gray-50 text-gray-600',
                    ].join(' ')}
                  >{name}</button>
                ))}
              </div>
            </div>
          )}

          {/* Custom cycle */}
          {patternType === 'custom' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">
                Custom cycle ({customCycle.length} day{customCycle.length !== 1 ? 's' : ''})
              </label>
              <div className="flex flex-wrap gap-1.5 min-h-12 bg-gray-50 rounded-xl p-3 border border-dashed border-gray-300">
                {customCycle.map((owner, i) => (
                  <button
                    key={i}
                    onClick={() => setCustomCycle((prev) => prev.filter((_, idx) => idx !== i))}
                    className={['px-2.5 py-1 rounded-lg text-xs font-semibold border',
                      owner === 'parent_a' ? 'bg-pa-100 border-pa-300 text-pa-800' : 'bg-pb-100 border-pb-300 text-pb-800',
                    ].join(' ')}
                  >{owner === 'parent_a' ? pa.charAt(0) : pb.charAt(0)}</button>
                ))}
                {customCycle.length === 0 && <span className="text-xs text-gray-400 italic">Use the buttons below to build your cycle</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1 text-xs" onClick={() => setCustomCycle((p) => [...p, 'parent_a'])}>+ {pa}</Button>
                <Button variant="secondary" className="flex-1 text-xs" onClick={() => setCustomCycle((p) => [...p, 'parent_b'])}>+ {pb}</Button>
                {customCycle.length > 0 && <Button variant="ghost" className="text-xs text-red-500" onClick={() => setCustomCycle([])}>Clear</Button>}
              </div>
            </div>
          )}

          {/* Start date */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">
              {schedule ? 'Change takes effect from' : 'Schedule start date'}
            </label>
            <input
              type="date"
              value={startDate}
              min={schedule ? formatDate(new Date()) : undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
            <p className="text-xs text-gray-400">
              {schedule ? 'Must be today or in the future.' : 'The pattern repeats from this date indefinitely.'}
            </p>
          </div>

          <SchedulePreview patternType={patternType} startingParent={startingParent} customCycle={customCycle} startDate={startDate} pa={pa} pb={pb} />

          {/* Changeover */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Default changeover</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Time</label>
                <input type="time" value={changeoverTime} onChange={(e) => setChangeoverTime(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Location (optional)</label>
                <input type="text" value={changeoverLocation} onChange={(e) => setChangeoverLocation(e.target.value)} placeholder="e.g. School gate" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green" />
              </div>
            </div>
            <p className="text-xs text-gray-400">Individual days can be overridden from the calendar.</p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full py-3" loading={saving} onClick={handleSave}>
            {saved ? '✓ Saved' : 'Save schedule'}
          </Button>
        </div>
      </AccordionGroup>

      {/* ── FamilyFeed ── */}
      {familyEmail && (
        <>
          <AccordionGroup label="FamilyFeed">
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-gray-400">Forward school newsletters or appointment emails to this address — Canopy pulls out events and adds them to your calendar.</p>
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                <span className="text-sm text-gray-800 flex-1 font-mono truncate">{familyEmail}</span>
                <button onClick={() => navigator.clipboard.writeText(familyEmail)} className="text-xs text-canopy-mid font-medium shrink-0 hover:underline">Copy</button>
              </div>
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500">Forwarding addresses</p>
                <p className="text-xs text-gray-400">Add other email addresses you forward from so Canopy can attribute them correctly.</p>
                {additionalEmails.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                    <span className="text-sm text-gray-800 flex-1 font-mono truncate">{e.email}</span>
                    <button onClick={() => removeEmail(e.id)} className="text-xs text-red-500 hover:underline shrink-0">Remove</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => { setNewEmail(e.target.value); setEmailError(null) }}
                    onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                    placeholder="e.g. chris@work.com"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                  <Button variant="secondary" loading={emailAdding} onClick={addEmail} className="shrink-0">Add</Button>
                </div>
                {emailError && <p className="text-sm text-red-600">{emailError}</p>}
              </div>
            </div>
          </AccordionGroup>
        </>
      )}

      {/* ── Notifications ── */}
      <AccordionGroup label="Notifications">
        <PushToggleRow
          pushSupported={pushSupported}
          pushBlocked={pushBlocked}
          pushEnabled={pushEnabled}
          pushLoading={pushLoading}
          onToggle={togglePush}
        />
        <div className="border-t border-gray-100 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">SMS — urgent notices</p>
          <p className="text-xs text-gray-400">Receive an SMS when an urgent notice is posted. Include country code, e.g. +44. Leave blank to opt out.</p>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+44 7911 123456"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
          {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
          <Button className="w-full py-3" loading={phoneSaving} onClick={savePhone}>
            {phoneSaved ? '✓ Saved' : 'Save number'}
          </Button>
        </div>
      </AccordionGroup>

      {/* ── Calendar sync ── */}
      <AccordionGroup label="Calendar Sync">
        <CalendarSyncSection />
      </AccordionGroup>

      {/* ── Features ── */}
      {isParent && (
        <AccordionGroup label="Features">
          <ToggleRow
            label="Direct messaging"
            description="Private topic threads between parents. Not visible to read-only members."
            enabled={!!family?.config?.messaging_enabled}
            onToggle={() => updateFamilyConfig({ messaging_enabled: !family?.config?.messaging_enabled })}
          />
        </AccordionGroup>
      )}

      {/* ── Legal ── */}
      <AccordionGroup label="Legal">
        <NavRow label="Export records" description="Download a court-ready PDF of messages and events" onPress={() => navigate('/export')} />
        <NavRow label="Court order" description="Upload and manage advisory compliance checks" onPress={() => navigate('/court-order')} />
      </AccordionGroup>

      {/* ── Account ── */}
      <AccordionGroup label="Account">
        <div className="px-4 py-3 space-y-3">
          <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} placeholder="••••••••" required />
          <PasswordField label="New password" value={newPassword} onChange={setNewPassword} placeholder="••••••••" required />
          <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" required />
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <Button className="w-full py-3" loading={passwordSaving} onClick={changePassword}>
            {passwordSaved ? '✓ Password updated' : 'Update password'}
          </Button>
          <button
            onClick={signOut}
            className="w-full text-sm text-red-500 py-2 hover:underline"
          >
            Sign out
          </button>
        </div>
      </AccordionGroup>

      <div className="h-4" />
    </div>
  )
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function AccordionGroup({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-3 first:mt-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-1 py-2 text-left"
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
      {open && (
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-100">
          {children}
        </div>
      )}
    </div>
  )
}

function NavRow({ label, description, onPress }) {
  return (
    <button
      onClick={onPress}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
    </button>
  )
}

function PushToggleRow({ pushSupported, pushBlocked, pushEnabled, pushLoading, onToggle }) {
  if (!pushSupported) {
    return <p className="px-4 py-3 text-sm text-gray-400">Push notifications are not supported on this device or browser.</p>
  }
  if (pushBlocked) {
    return <p className="px-4 py-3 text-sm text-red-500">Notifications are blocked in your browser settings. Enable them and reload.</p>
  }
  return (
    <button
      onClick={onToggle}
      disabled={pushLoading}
      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
    >
      <div>
        <p className="text-sm font-medium text-gray-800 text-left">Push notifications</p>
        <p className="text-xs text-gray-400 mt-0.5 text-left">Alerts when the other parent posts or makes changes</p>
      </div>
      <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${pushEnabled ? 'bg-canopy-mid' : 'bg-gray-300'} ${pushLoading ? 'opacity-50' : ''}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </button>
  )
}

function ToggleRow({ label, description, enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
    >
      <div>
        <p className="text-sm font-medium text-gray-800 text-left">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5 text-left">{description}</p>}
      </div>
      <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${enabled ? 'bg-canopy-mid' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </button>
  )
}

function ChevronRightIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

// ── Schedule preview ──────────────────────────────────────────────────────────

function SchedulePreview({ patternType, startingParent, customCycle, startDate, pa, pb }) {
  let cycle
  if (patternType === 'custom') {
    cycle = customCycle
  } else {
    const p = buildPresetPattern(patternType, startingParent)
    cycle = p?.cycle ?? []
  }

  if (!cycle.length || !startDate) return null

  const base = parseDate(startDate) ?? new Date()
  const preview = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    return { date: d, owner: cycle[i % cycle.length] }
  })

  return (
    <section>
      <label className="text-sm font-semibold text-gray-700 block mb-2">Preview — first 14 days</label>
      <div className="grid grid-cols-7 gap-1">
        {preview.map(({ date, owner }, i) => (
          <div
            key={i}
            className={[
              'rounded-lg aspect-square flex flex-col items-center justify-center text-xs font-semibold',
              owner === 'parent_a' ? 'bg-pa-100 text-pa-800' : 'bg-pb-100 text-pb-800',
            ].join(' ')}
          >
            <span className="text-[10px] font-normal opacity-70">{format(date, 'EEE')}</span>
            {date.getDate()}
          </div>
        ))}
      </div>
    </section>
  )
}
