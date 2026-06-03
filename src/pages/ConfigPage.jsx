import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { supabase, registerPushSubscription, unregisterPushSubscription } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { buildPresetPattern, PATTERN_LABELS, parseDate, formatDate } from '../lib/scheduleEngine'
import Button from '../components/ui/Button'

const PATTERNS = ['alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom']

export default function ConfigPage() {
  const { schedule, saveSchedule, updateFamilyConfig, family, member, parentA, parentB, isParent, reload } = useFamily()
  const emailDomain = import.meta.env.VITE_EMAIL_DOMAIN ?? 'canopy.app'
  const familyEmail = family?.email_key ? `${family.email_key}@${emailDomain}` : null
  const navigate = useNavigate()

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

  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)
  const [phoneError, setPhoneError] = useState(null)

  const [pushEnabled, setPushEnabled]   = useState(false)
  const [pushLoading, setPushLoading]   = useState(false)
  const [pushSupported, setPushSupported] = useState(true)
  const [pushBlocked, setPushBlocked]   = useState(false)

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
  }, [family?.config])

  useEffect(() => {
    setPhoneNumber(member?.phone_number ?? '')
  }, [member?.phone_number])

  async function handleSave() {
    setSaving(true)
    setError(null)

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

  function addChild() {
    setChildren((prev) => [...prev, { id: crypto.randomUUID(), name: '', year_group: '', class_name: '' }])
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

  const pa = parentA?.display_name ?? 'Parent A'
  const pb = parentB?.display_name ?? 'Parent B'

  if (!isParent) {
    return (
      <div className="px-5 py-8 text-center text-gray-500">
        <p className="font-medium">View-only access</p>
        <p className="text-sm mt-1">Only parents can edit the schedule.</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Parenting Schedule</h1>

      {/* Pattern picker */}
      <section className="space-y-2">
        <label className="text-sm font-semibold text-gray-700 block">Rotation pattern</label>
        <div className="space-y-2">
          {PATTERNS.map((p) => (
            <label
              key={p}
              className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer"
              style={{ borderColor: patternType === p ? '#3b82f6' : undefined, background: patternType === p ? '#eff6ff' : undefined }}
            >
              <input
                type="radio"
                name="pattern"
                value={p}
                checked={patternType === p}
                onChange={() => setPatternType(p)}
                className="accent-blue-600"
              />
              <span className="text-sm font-medium text-gray-800">{PATTERN_LABELS[p]}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Starting parent */}
      {patternType !== 'custom' && (
        <section className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 block">First period goes to</label>
          <div className="flex gap-2">
            {[{ role: 'parent_a', name: pa }, { role: 'parent_b', name: pb }].map(({ role, name }) => (
              <button
                key={role}
                onClick={() => setStartingParent(role)}
                className={[
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                  startingParent === role
                    ? role === 'parent_a'
                      ? 'border-pa-400 bg-pa-100 text-pa-900'
                      : 'border-pb-400 bg-pb-100 text-pb-900'
                    : 'border-gray-200 bg-gray-50 text-gray-600',
                ].join(' ')}
              >
                {name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Custom cycle builder */}
      {patternType === 'custom' && (
        <section className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 block">
            Custom cycle ({customCycle.length} day{customCycle.length !== 1 ? 's' : ''})
          </label>
          <div className="flex flex-wrap gap-1.5 min-h-12 bg-gray-50 rounded-xl p-3 border border-dashed border-gray-300">
            {customCycle.map((owner, i) => (
              <button
                key={i}
                onClick={() => setCustomCycle((prev) => prev.filter((_, idx) => idx !== i))}
                className={[
                  'px-2.5 py-1 rounded-lg text-xs font-semibold border',
                  owner === 'parent_a' ? 'bg-pa-100 border-pa-300 text-pa-800' : 'bg-pb-100 border-pb-300 text-pb-800',
                ].join(' ')}
                title="Click to remove"
              >
                {owner === 'parent_a' ? pa.charAt(0) : pb.charAt(0)}
              </button>
            ))}
            {customCycle.length === 0 && (
              <span className="text-xs text-gray-400 italic">Use the buttons below to build your cycle</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 text-xs" onClick={() => setCustomCycle((p) => [...p, 'parent_a'])}>
              + {pa}
            </Button>
            <Button variant="secondary" className="flex-1 text-xs" onClick={() => setCustomCycle((p) => [...p, 'parent_b'])}>
              + {pb}
            </Button>
            {customCycle.length > 0 && (
              <Button variant="ghost" className="text-xs text-red-500" onClick={() => setCustomCycle([])}>
                Clear
              </Button>
            )}
          </div>
        </section>
      )}

      {/* Start date */}
      <section className="space-y-2">
        <label className="text-sm font-semibold text-gray-700 block">Schedule start date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400">
          The pattern repeats from this date indefinitely. Changing it will recalculate the entire calendar.
        </p>
      </section>

      {/* Preview */}
      <SchedulePreview
        patternType={patternType}
        startingParent={startingParent}
        customCycle={customCycle}
        startDate={startDate}
        pa={pa}
        pb={pb}
      />

      {/* Changeover time */}
      <section className="space-y-2">
        <label className="text-sm font-semibold text-gray-700 block">Default changeover time</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Time</label>
            <input
              type="time"
              value={changeoverTime}
              onChange={(e) => setChangeoverTime(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Location (optional)</label>
            <input
              type="text"
              value={changeoverLocation}
              onChange={(e) => setChangeoverLocation(e.target.value)}
              placeholder="e.g. School gate"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">Applies to all handover days. Individual days can be edited from the calendar.</p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button className="w-full py-3" loading={saving} onClick={handleSave}>
        {saved ? '✓ Saved' : 'Save schedule'}
      </Button>

      {/* Family email address */}
      {familyEmail && (
        <section className="space-y-2 pt-2">
          <div>
            <label className="text-sm font-semibold text-gray-700 block">Family email address</label>
            <p className="text-xs text-gray-400 mt-0.5">
              Email anything to this address — school letters, appointment confirmations, links — and Canopy will automatically add events to your calendar. Events more than one month in the past are ignored.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <span className="text-sm text-gray-800 flex-1 font-mono">{familyEmail}</span>
            <button
              onClick={() => navigator.clipboard.writeText(familyEmail)}
              className="text-xs text-blue-600 font-medium shrink-0 hover:underline"
            >
              Copy
            </button>
          </div>
        </section>
      )}

      {/* Children */}
      <section className="space-y-3 pt-2">
        <div>
          <label className="text-sm font-semibold text-gray-700 block">Children</label>
          <p className="text-xs text-gray-400 mt-0.5">
            Add each child's school details so Canopy can better interpret emails from school.
          </p>
        </div>

        {children.map((child, index) => (
          <div key={child.id} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Child {index + 1}</span>
              <button onClick={() => removeChild(child.id)} className="text-xs text-red-500 hover:underline">Remove</button>
            </div>
            <input
              type="text"
              value={child.name}
              onChange={(e) => updateChild(child.id, 'name', e.target.value)}
              placeholder="Name"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={child.year_group}
                onChange={(e) => updateChild(child.id, 'year_group', e.target.value)}
                placeholder="Year group (e.g. Year 4)"
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <input
                type="text"
                value={child.class_name}
                onChange={(e) => updateChild(child.id, 'class_name', e.target.value)}
                placeholder="Class (e.g. Maple)"
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>
        ))}

        <button
          onClick={addChild}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add child
        </button>

        <Button className="w-full py-3" loading={childrenSaving} onClick={saveChildren}>
          {childrenSaved ? '✓ Saved' : 'Save children'}
        </Button>
      </section>

      {/* Phone number for urgent SMS alerts */}
      <section className="space-y-2 pt-2">
        <div>
          <label className="text-sm font-semibold text-gray-700 block">My mobile number</label>
          <p className="text-xs text-gray-400 mt-0.5">
            Used to send you an SMS when an urgent notice is posted. Leave blank to opt out.
          </p>
        </div>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+44 7911 123456"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400">Include country code, e.g. +44 for UK, +1 for US.</p>
        {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
        <Button
          className="w-full py-3"
          loading={phoneSaving}
          onClick={savePhone}
        >
          {phoneSaved ? '✓ Saved' : 'Save phone number'}
        </Button>
      </section>

      {/* Push notifications toggle */}
      <section className="space-y-2 pt-2">
        <div>
          <label className="text-sm font-semibold text-gray-700 block">Push notifications</label>
          <p className="text-xs text-gray-400 mt-0.5">
            Receive alerts on this device when the other parent posts or makes changes.
          </p>
        </div>
        {!pushSupported ? (
          <p className="text-sm text-gray-400">Push notifications are not supported on this device or browser.</p>
        ) : pushBlocked ? (
          <p className="text-sm text-red-500">Notifications are blocked in your browser settings. Enable them in your browser and reload.</p>
        ) : (
          <button
            onClick={togglePush}
            disabled={pushLoading}
            className="flex items-center justify-between w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
          >
            <span className="text-sm font-medium text-gray-700">
              {pushEnabled ? 'Notifications on' : 'Notifications off'}
            </span>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${pushEnabled ? 'bg-blue-600' : 'bg-gray-300'} ${pushLoading ? 'opacity-50' : ''}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </button>
        )}
      </section>
    </div>
  )
}

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
