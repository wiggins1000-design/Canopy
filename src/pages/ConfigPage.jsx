﻿import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { supabase, registerPushSubscription, unregisterPushSubscription, registerNativePush, unregisterNativePush, isNativePlatform, sendPushNotification } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import { buildPresetPattern, PATTERN_LABELS, parseDate, formatDate } from '../lib/scheduleEngine'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import CalendarSyncSection from '../components/calendar/CalendarSyncSection'
import TermDatesSection from '../components/settings/TermDatesSection'
import { useSubscription } from '../hooks/useSubscription'
import { useLocale } from '../hooks/useLocale'
import { SUPPORTED_LOCALES } from '../config/regions'
import { firstName } from '../lib/childUtils'

const PATTERNS = ['alternating_weeks', '2_2_5_5', '2_2_3', '3_4_4_3', 'custom']

export default function ConfigPage() {
  const { schedule, saveSchedule, proposePendingSchedule, respondToScheduleProposal, proposeViewerPermissions, respondToViewerPermissions, updateFamilyConfig, updateMemberFeatures, family, member, members, userRole, parentA, parentB, isParent, reload } = useFamily()
  const { user, signOut } = useAuth()
  const regionConfig = useLocale()
  const familyFeedAddress = 'familyfeed@canopy-app.app'
  const navigate    = useNavigate()
  const location    = useLocation()
  const targetTab   = new URLSearchParams(location.search).get('tab')

  useEffect(() => {
    if (!targetTab) return
    const el = document.getElementById(`config-section-${targetTab}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [targetTab])

  // versionName alone (e.g. "1.1.0") is deliberately kept fixed across many
  // internal test builds -- only the build/versionCode actually changes each
  // round, so it's the only reliable way to tell which exact build is
  // installed. App.getInfo() reads both directly from the native bundle at
  // runtime, so this can never drift out of sync with reality the way a
  // hardcoded string could. Not available on web (App plugin is native-only).
  const [appInfo, setAppInfo] = useState(null)
  useEffect(() => {
    if (!isNativePlatform()) return
    ;(async () => {
      const { App } = await import('@capacitor/app')
      const info = await App.getInfo()
      setAppInfo(info)
    })()
  }, [])

  const [patternType, setPatternType] = useState('alternating_weeks')
  const [startingParent, setStartingParent] = useState('parent_a')
  const [startDate, setStartDate] = useState(formatDate(new Date()))
  const [customCycle, setCustomCycle] = useState([])
  const [changeoverTime, setChangeoverTime] = useState('')
  const [changeoverLocation, setChangeoverLocation] = useState('')
  const [hasNewTermDates, setHasNewTermDates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [responding, setResponding] = useState(false)

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

  const [reminderTime, setReminderTime] = useState('20:00')
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderSaved, setReminderSaved] = useState(false)

  const [pushEnabled, setPushEnabled]   = useState(false)
  const [pushLoading, setPushLoading]   = useState(false)
  const [pushSupported, setPushSupported] = useState(true)
  const [pushBlocked, setPushBlocked]   = useState(false)
  const [pushError, setPushError]       = useState(null)
  const [testPushState, setTestPushState] = useState('idle') // idle | sending | sent | error

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

  const [twoFaGlobalEnabled, setTwoFaGlobalEnabled] = useState(false)
  const [twoFaUserEnabled, setTwoFaUserEnabled]     = useState(false)
  const [twoFaSaving, setTwoFaSaving]               = useState(false)

  const [downloadingData, setDownloadingData]       = useState(false)
  const [deleteConfirm, setDeleteConfirm]           = useState(false)
  const [deletingAccount, setDeletingAccount]       = useState(false)
  const [deleteError, setDeleteError]               = useState(null)
  const [childToDelete, setChildToDelete]           = useState(null)
  const [childDeleting, setChildDeleting]           = useState(false)
  const [manualTermDatesPrompt, setManualTermDatesPrompt] = useState(null) // { schoolName, count }
  const [manualTermDatesDeleting, setManualTermDatesDeleting] = useState(false)
  const [justConsentedFeed, setJustConsentedFeed]   = useState(false)
  const [consentingFeed, setConsentingFeed]         = useState(false)
  const [proposalSaving, setProposalSaving]         = useState(false)

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
    setChangeoverTime(family.config.changeover_time ?? '08:30')
    setChangeoverLocation(family.config.changeover_location ?? '')
    setChildren(family.config.children ?? [])
    setPets(family.config.pets ?? [])
    setReminderTime(family.config.evening_reminder_time ?? '20:00')
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
      if (schedule) {
        // Existing schedule: propose the change for the other parent to approve
        const { error: err } = await proposePendingSchedule({
          pattern_type:    patternType,
          pattern_data:    patternData,
          start_date:      startDate,
          starting_parent: startingParent,
        })
        if (err) { setError(err.message); setSaving(false); return }

        // Changeover settings save immediately (not subject to approval)
        await updateFamilyConfig({
          changeover_time: changeoverTime || null,
          changeover_location: changeoverLocation.trim() || null,
        })

        const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
        const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
        if (recipientMember && family?.id) {
          await sendPushNotification({
            familyId:      family.id,
            recipientRole,
            title:         'Schedule change proposed',
            body:          `${member?.display_name ?? 'A parent'} proposed a new parenting schedule — open Settings to review`,
            url:           '/config',
          })
        }

        setSaved(true)
        setSaving(false)
        setTimeout(() => setSaved(false), 3000)
      } else {
        // First-time setup: save directly, no approval needed
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
    } catch (e) {
      setError('Failed to save — check your connection and try again.')
      setSaving(false)
    }
  }

  // Check current push subscription state
  useEffect(() => {
    if (isNativePlatform()) {
      // On native iOS/Android: push is enabled if this device's platform-
      // specific token is stored (each platform has its own column now, so
      // registering on one device doesn't affect the other's status).
      setPushSupported(true)
      const column = Capacitor.getPlatform() === 'ios' ? 'push_token_ios' : 'push_token_android'
      setPushEnabled(!!member?.[column])
      return
    }
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
        setPushEnabled(!!sub && !!member?.push_token_web)
      })
    )
  }, [member?.push_token_ios, member?.push_token_android, member?.push_token_web])

  async function togglePush() {
    if (!member) {
      setPushError('no-member')
      return
    }
    setPushError(null)
    setPushLoading(true)
    try {
      if (isNativePlatform()) {
        if (pushEnabled) {
          await unregisterNativePush(member.user_id)
          setPushEnabled(false)
        } else {
          const result = await Promise.race([
            registerNativePush(member.user_id),
            new Promise(r => setTimeout(() => r({ granted: false, error: 'outer-timeout' }), 20000)),
          ])
          if (result.denied) setPushBlocked(true)
          else if (result.error) setPushError(result.error)
          else setPushEnabled(result.granted)
        }
        return
      }

      if (pushEnabled) {
        await unregisterPushSubscription(member.user_id)
        setPushEnabled(false)
      } else {
        if (Notification.permission === 'denied') {
          setPushBlocked(true)
          return
        }
        await registerPushSubscription(member.user_id)
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setPushEnabled(!!sub)
      }
    } catch (e) {
      setPushError(e?.message ?? 'unknown')
    } finally {
      setPushLoading(false)
    }
  }

  async function sendTestPush() {
    setTestPushState('sending')
    try {
      const { error } = await sendPushNotification({
        familyId:      family.id,
        recipientRole: userRole,
        title:         'Test notification',
        body:          'If you can see this, push notifications are working.',
        url:           '/calendar',
      })
      setTestPushState(error ? 'error' : 'sent')
    } catch (e) {
      setTestPushState('error')
    }
    setTimeout(() => setTestPushState('idle'), 4000)
  }

  async function saveReminderTime() {
    setReminderSaving(true)
    await updateFamilyConfig({ evening_reminder_time: reminderTime })
    setReminderSaved(true)
    setReminderSaving(false)
    setTimeout(() => setReminderSaved(false), 2500)
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

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('app_settings').select('two_fa_enabled').single(),
      supabase.from('family_members').select('two_fa_enabled').eq('user_id', user.id).maybeSingle(),
    ]).then(([{ data: settings }, { data: memberData }]) => {
      setTwoFaGlobalEnabled(!!settings?.two_fa_enabled)
      setTwoFaUserEnabled(!!memberData?.two_fa_enabled)
    })
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

  function removeChild(child) {
    setChildToDelete(child)
  }

  async function confirmDeleteChild() {
    if (!childToDelete) return
    setChildDeleting(true)
    const { data: result } = await supabase.rpc('delete_child_and_data', {
      p_family_id: family.id,
      p_child_name: childToDelete.name,
    })
    const updated = children.filter((c) => c.id !== childToDelete.id)
    setChildren(updated)
    await updateFamilyConfig({ children: updated })
    setChildToDelete(null)
    setChildDeleting(false)
    if (result?.manual_school_name) {
      setManualTermDatesPrompt({ schoolName: result.manual_school_name, count: result.manual_term_count })
    }
  }

  async function deleteManualTermDates() {
    if (!manualTermDatesPrompt) return
    setManualTermDatesDeleting(true)
    await supabase
      .from('family_events')
      .delete()
      .eq('family_id', family.id)
      .eq('source', 'term_dates')
      .eq('source_subject', manualTermDatesPrompt.schoolName)
      .is('school_calendar_id', null)
    setManualTermDatesDeleting(false)
    setManualTermDatesPrompt(null)
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

  async function toggleTwoFa() {
    setTwoFaSaving(true)
    const newVal = !twoFaUserEnabled
    await supabase.from('family_members').update({ two_fa_enabled: newVal }).eq('user_id', user.id)
    setTwoFaUserEnabled(newVal)
    setTwoFaSaving(false)
  }

  async function downloadData() {
    setDownloadingData(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-user-data`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
    })
    const json = await res.json()
    if (json.ok) {
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(json.html)
        win.document.close()
        setTimeout(() => win.print(), 500)
      } else {
        const blob = new Blob([json.html], { type: 'text/html' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href = url
        a.download = `canopy-data-${new Date().toISOString().slice(0, 10)}.html`
        a.click()
        URL.revokeObjectURL(url)
      }
    }
    setDownloadingData(false)
  }

  async function deleteAccount() {
    setDeletingAccount(true)
    setDeleteError(null)
    const { error } = await supabase.functions.invoke('delete-account')
    if (error) {
      setDeleteError('Something went wrong. Please try again.')
      setDeletingAccount(false)
      return
    }
    await signOut()
  }

  async function consentFamilyFeed() {
    setConsentingFeed(true)
    await supabase.rpc('record_consent', { p_type: 'familyfeed_ai' })
    setJustConsentedFeed(true)
    setConsentingFeed(false)
  }

  const pa = parentA?.display_name ?? 'Parent A'
  const pb = parentB?.display_name ?? 'Parent B'
  const feedConsented = !!member?.consents?.familyfeed_ai || justConsentedFeed

  // Pending schedule proposal state
  const hasPendingProposal = !!schedule?.pending_proposed_by
  const isMyProposal       = schedule?.pending_proposed_by === user?.id
  const proposerName       = members.find((m) => m.user_id === schedule?.pending_proposed_by)?.display_name ?? 'A parent'
  const otherParentName    = userRole === 'parent_a' ? pb : pa

  // Per-member feature preferences
  const otherParent    = userRole === 'parent_a' ? parentB : parentA
  const myFeatures     = member?.consents?.features ?? {}
  const otherFeatures  = otherParent?.consents?.features ?? {}
  const myNoticeboard  = myFeatures.noticeboard !== false
  const myMessaging    = !!myFeatures.messaging
  const myExpenses     = !!myFeatures.expenses
  const myChildcare    = !!myFeatures.childcare
  const otherNoticeboard = (otherFeatures.noticeboard ?? true) !== false
  const otherMessaging   = !!otherFeatures.messaging
  const otherExpenses    = !!otherFeatures.expenses
  const otherChildcare   = !!otherFeatures.childcare

  async function saveMyFeature(key, value) {
    await updateMemberFeatures({ ...myFeatures, [key]: value })
  }

  // Viewer permissions proposal state
  const VIEWER_DEFAULTS = { calendar: true, noticeboard: true, info_bank: false, schedule: false }
  const pendingPerms       = family?.config?.pending_viewer_permissions ?? null
  const permProposedBy     = family?.config?.viewer_permissions_proposed_by ?? null
  const isMyPermProposal   = permProposedBy === user?.id
  const hasPermProposal    = !!pendingPerms
  const permProposerName   = members.find((m) => m.user_id === permProposedBy)?.display_name ?? 'The other parent'
  const effectivePerms     = family?.config?.viewer_permissions ?? VIEWER_DEFAULTS
  const displayPerms       = hasPermProposal ? pendingPerms : effectivePerms

  async function toggleViewerPerm(key, defaultOn = false) {
    const base = hasPermProposal && isMyPermProposal ? pendingPerms : effectivePerms
    const current = key in base ? base[key] : defaultOn
    const newPerms = { ...VIEWER_DEFAULTS, ...base, [key]: !current }
    setProposalSaving(true)
    await proposeViewerPermissions(newPerms)
    setProposalSaving(false)
  }

  async function confirmViewerPerms() {
    setProposalSaving(true)
    await respondToViewerPermissions(true)
    setProposalSaving(false)
  }

  async function cancelViewerProposal() {
    await respondToViewerPermissions(false)
  }

  if (!isParent) {
    return (
      <div className="px-4 py-5 space-y-2">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Settings</h1>

        <AccordionGroup id="config-section-notifications" label="Notifications" defaultOpen={targetTab === 'notifications'}>
          <PushToggleRow
            pushSupported={pushSupported}
            pushBlocked={pushBlocked}
            pushEnabled={pushEnabled}
            pushLoading={pushLoading}
            onToggle={togglePush}
            isNative={isNativePlatform()}
            pushError={pushError}
          />
          {isNativePlatform() && pushEnabled && (
            <TestPushRow state={testPushState} onSend={sendTestPush} />
          )}
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
            {twoFaGlobalEnabled && (
              <button
                onClick={!twoFaSaving ? toggleTwoFa : undefined}
                disabled={twoFaSaving}
                className={`w-full flex items-center justify-between hover:bg-gray-50 transition-colors py-2 rounded-lg ${twoFaSaving ? 'opacity-50' : ''}`}
              >
                <div>
                  <p className="text-sm font-medium text-gray-800 text-left">Two-factor authentication</p>
                  <p className="text-xs text-gray-400 mt-0.5 text-left">Require an email code each time you sign in.</p>
                </div>
                <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${twoFaUserEnabled ? 'bg-canopy-mid' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${twoFaUserEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </button>
            )}
            <button onClick={signOut} className="w-full text-sm text-red-500 py-2 hover:underline">
              Sign out
            </button>
            <div className="border-t border-gray-100 pt-2 space-y-1">
              <button onClick={downloadData} disabled={downloadingData} className="w-full text-sm text-gray-400 py-2 hover:underline disabled:opacity-50">
                {downloadingData ? 'Preparing download...' : 'Download my data'}
              </button>
              {deleteConfirm ? (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-red-700">This will permanently delete your account and all associated data. This cannot be undone.</p>
                  {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setDeleteConfirm(false); setDeleteError(null) }} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button onClick={deleteAccount} disabled={deletingAccount} className="flex-1 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50">
                      {deletingAccount ? 'Deleting...' : 'Yes, delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setDeleteConfirm(true)} className="w-full text-sm text-red-400 py-2 hover:underline">
                  Delete my account
                </button>
              )}
            </div>
          </div>
        </AccordionGroup>

        <SettingsFooter appInfo={appInfo} />
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-2">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Settings</h1>

      {/* â"€â"€ Region â"€â"€ */}
      <AccordionGroup label="Region">
        <div className="px-4 pt-3 pb-4 space-y-2">
          <p className="text-xs text-gray-400 mb-3">Sets your currency, school term labels, and how Canopy reads school calendars.</p>
          {SUPPORTED_LOCALES.map(({ code, label, flag }) => (
            <button
              key={code}
              onClick={() => updateFamilyConfig({ locale: code })}
              className={[
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors',
                regionConfig.locale === code
                  ? 'border-canopy-green bg-canopy-green/5 text-canopy-dark'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              <span className="text-xl">{flag}</span>
              {label}
              {regionConfig.locale === code && (
                <span className="ml-auto text-canopy-green text-xs font-semibold">Current</span>
              )}
            </button>
          ))}
          <p className="text-xs text-gray-400 text-center pt-1">More countries coming soon</p>
        </div>
      </AccordionGroup>

      {/* â"€â"€ Family â"€â"€ */}
      <AccordionGroup id="config-section-children" label="Children" defaultOpen={targetTab === 'children'}>
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-400">Add each child's name. Add school details in Info Bank for better FamilyFeed results.</p>
          {manualTermDatesPrompt && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-900">Delete term dates for {manualTermDatesPrompt.schoolName}?</p>
              <p className="text-xs text-amber-800">{manualTermDatesPrompt.count} manually-added term date{manualTermDatesPrompt.count !== 1 ? 's' : ''} for this school are still in the calendar. No other child in your family attends this school.</p>
              <div className="flex gap-2">
                <button onClick={() => setManualTermDatesPrompt(null)} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 bg-white">Keep them</button>
                <button onClick={deleteManualTermDates} disabled={manualTermDatesDeleting} className="flex-1 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50">
                  {manualTermDatesDeleting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          )}
          {children.map((child, index) => (
            <div key={child.id}>
              {childToDelete?.id === child.id ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-red-900">Remove {firstName(child.name)}?</p>
                  <p className="text-xs text-red-700">This will delete all calendar events tagged to {firstName(child.name)} and their Info Bank entries. If no other child in your family attends the same school, their term dates will also be removed. This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setChildToDelete(null)} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 bg-white">Cancel</button>
                    <button onClick={confirmDeleteChild} disabled={childDeleting} className="flex-1 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50">
                      {childDeleting ? 'Removing…' : 'Yes, remove'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={child.name}
                    onChange={(e) => updateChild(child.id, 'name', e.target.value)}
                    placeholder={`Child ${index + 1} name`}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
                  />
                  <button onClick={() => removeChild(child)} className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">Remove</button>
                </div>
              )}
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
                className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
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

      {/* â"€â"€ Parenting Schedule â"€â"€ */}
      <AccordionGroup id="config-section-schedule" label="Parenting Schedule" defaultOpen={targetTab === 'schedule'}>
        <div className="px-4 py-3 space-y-4">

          {/* Pending proposal — shown to the OTHER parent */}
          {hasPendingProposal && !isMyProposal && (
            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
              <div>
                <p className="text-sm font-semibold text-canopy-deep">{proposerName} proposed a new schedule</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {PATTERN_LABELS[schedule.pending_pattern_type]} · from {schedule.pending_start_date}
                </p>
              </div>
              <SchedulePreview
                patternType={schedule.pending_pattern_type}
                startingParent={schedule.pending_starting_parent}
                customCycle={schedule.pending_pattern_data?.cycle ?? []}
                startDate={schedule.pending_start_date}
                pa={pa} pb={pb}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1 text-xs py-2 bg-green-600 hover:bg-green-700"
                  loading={responding}
                  onClick={async () => {
                    setResponding(true)
                    await respondToScheduleProposal(true)
                    const recipientRole = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
                    const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
                    if (recipientMember && family?.id) {
                      await sendPushNotification({
                        familyId:      family.id,
                        recipientRole,
                        title:         'Schedule change accepted',
                        body:          `${member?.display_name ?? 'A parent'} accepted your proposed schedule`,
                        url:           '/calendar',
                      })
                    }
                    setResponding(false)
                  }}
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1 text-xs py-2 text-red-600"
                  loading={responding}
                  onClick={async () => {
                    setResponding(true)
                    await respondToScheduleProposal(false)
                    const recipientRole = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
                    const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
                    if (recipientMember && family?.id) {
                      await sendPushNotification({
                        familyId:      family.id,
                        recipientRole,
                        title:         'Schedule change declined',
                        body:          `${member?.display_name ?? 'A parent'} declined your proposed schedule`,
                        url:           '/config',
                      })
                    }
                    setResponding(false)
                  }}
                >
                  Decline
                </Button>
              </div>
            </div>
          )}

          {/* Pending proposal — shown to the proposer */}
          {hasPendingProposal && isMyProposal && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">Waiting for {otherParentName} to approve</p>
              <p className="text-xs text-amber-700">
                {PATTERN_LABELS[schedule.pending_pattern_type]} · from {schedule.pending_start_date}
              </p>
              <Button
                variant="secondary"
                className="text-xs py-1.5 w-full text-amber-700 border-amber-300"
                loading={responding}
                onClick={async () => {
                  setResponding(true)
                  await respondToScheduleProposal(false)
                  setResponding(false)
                }}
              >
                Cancel proposal
              </Button>
            </div>
          )}

          {/* Edit form — hidden while a proposal is pending */}
          {!hasPendingProposal && (
            <>
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

              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full py-3" loading={saving} onClick={handleSave}>
                {saved
                  ? (schedule && parentB ? '✓ Proposal sent' : '✓ Saved')
                  : schedule && parentB ? `Propose change to ${otherParentName}` : 'Save schedule'}
              </Button>
            </>
          )}

          {/* Changeover — always editable, not subject to approval */}
          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Default changeover</label>
            <div className="flex gap-3">
              <div className="w-28 shrink-0">
                <label className="text-xs text-gray-400 block mb-1">Time</label>
                <input type="time" value={changeoverTime} onChange={(e) => setChangeoverTime(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs text-gray-400 block mb-1">Location (optional)</label>
                <input type="text" value={changeoverLocation} onChange={(e) => setChangeoverLocation(e.target.value)} placeholder="e.g. School gate" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green" />
              </div>
            </div>
            <p className="text-xs text-gray-400">Individual days can be overridden from the calendar.</p>
          </div>

        </div>
      </AccordionGroup>

      {/* â"€â"€ FamilyFeed â"€â"€ */}
      <AccordionGroup label="FamilyFeed">
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-gray-400">Forward school newsletters or appointment emails to this address — Canopy pulls out events and adds them to your calendar automatically.</p>
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
            <span className="text-sm text-gray-800 flex-1 font-mono truncate">{familyFeedAddress}</span>
            <button onClick={() => navigator.clipboard.writeText(familyFeedAddress)} className="text-xs text-canopy-mid font-medium shrink-0 hover:underline">Copy</button>
          </div>
          {!feedConsented ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-900">AI processing notice</p>
              <p className="text-xs text-amber-800">Emails you forward to FamilyFeed are processed by AI to extract events and notices. This feature is designed for school newsletters and similar communications — please do not forward emails containing medical or health information. For medical details, use the Info Bank instead. Data is never used for advertising or to train AI models.</p>
              <Button variant="secondary" className="w-full py-2 text-xs" loading={consentingFeed} onClick={consentFamilyFeed}>
                I understand — enable FamilyFeed
              </Button>
            </div>
          ) : (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500">Your forwarding addresses</p>
              <p className="text-xs text-gray-400">Add every email address you might forward from — your personal email, work email, or any other account. If we don't recognise the sender, the email won't be processed.</p>
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

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500">Which events to add</p>
                <p className="text-xs text-gray-400">School newsletters often cover several year groups. Choose whether FamilyFeed should add everything it finds, or only events relevant to your children.</p>
                <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                  <input
                    type="radio"
                    name="familyfeed_event_scope"
                    checked={(family?.config?.familyfeed_event_scope ?? 'relevant') === 'relevant'}
                    onChange={() => updateFamilyConfig({ familyfeed_event_scope: 'relevant' })}
                    className="mt-0.5"
                  />
                  <span>Only events relevant to my children <span className="text-gray-400">(recommended)</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                  <input
                    type="radio"
                    name="familyfeed_event_scope"
                    checked={family?.config?.familyfeed_event_scope === 'all'}
                    onChange={() => updateFamilyConfig({ familyfeed_event_scope: 'all' })}
                    className="mt-0.5"
                  />
                  <span>All events found in the email or attachment</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </AccordionGroup>

      {/* â"€â"€ Notifications â"€â"€ */}
      <AccordionGroup id="config-section-notifications" label="Notifications" defaultOpen={targetTab === 'notifications'}>
        <PushToggleRow
          pushSupported={pushSupported}
          pushBlocked={pushBlocked}
          pushEnabled={pushEnabled}
          pushLoading={pushLoading}
          onToggle={togglePush}
          isNative={isNativePlatform()}
        />
        {isNativePlatform() && pushEnabled && (
          <TestPushRow state={testPushState} onSend={sendTestPush} />
        )}
        <div className="border-t border-gray-100 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">Evening reminder</p>
          <p className="text-xs text-gray-400">Each evening, whichever parent has the children gets a reminder of tomorrow's events (including PE days).</p>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green bg-white"
            />
            <Button className="flex-1 py-2.5 text-sm" loading={reminderSaving} onClick={saveReminderTime}>
              {reminderSaved ? '✓ Saved' : 'Save time'}
            </Button>
          </div>
        </div>
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

      {/* ── School Term Dates ── */}
      <AccordionGroup label="School Term Dates" badge={hasNewTermDates}>
        <TermDatesSection onNewDates={setHasNewTermDates} />
      </AccordionGroup>

      {/* â"€â"€ Calendar sync â"€â"€ */}
      <AccordionGroup label="Calendar Sync">
        <CalendarSyncSection />
      </AccordionGroup>

      {/* â"€â"€ People â"€â"€ */}
      <AccordionGroup label="Family members">
        <NavRow label="Manage family" description="Invite parents or read-only members" onPress={() => navigate('/invite')} />
      </AccordionGroup>

      {/* â"€â"€ Subscription â"€â"€ */}
      <SubscriptionSection />

      {/* ── Features ── */}
      {isParent && (
        <AccordionGroup label="Features">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs text-gray-400">These settings only affect your view — {otherParentName} manages their own separately.</p>
          </div>
          <ToggleRow
            label="Notice Board"
            description={myNoticeboard !== otherNoticeboard ? (myNoticeboard ? `${otherParentName} has this turned off` : `${otherParentName} has this turned on`) : undefined}
            enabled={myNoticeboard}
            onToggle={() => saveMyFeature('noticeboard', !myNoticeboard)}
          />
          <ToggleRow
            label="Direct messaging"
            description={myMessaging !== otherMessaging ? (myMessaging ? `${otherParentName} has this turned off` : `${otherParentName} has this turned on`) : undefined}
            enabled={myMessaging}
            onToggle={() => saveMyFeature('messaging', !myMessaging)}
          />
          <ToggleRow
            label="Expenses"
            description={myExpenses !== otherExpenses ? (myExpenses ? `${otherParentName} has this turned off` : `${otherParentName} has this turned on`) : undefined}
            enabled={myExpenses}
            onToggle={() => saveMyFeature('expenses', !myExpenses)}
          />
          <ToggleRow
            label="Childcare hours"
            description={myChildcare !== otherChildcare ? (myChildcare ? `${otherParentName} has this turned off` : `${otherParentName} has this turned on`) : 'Let childcare members log hours and track who pays per day'}
            enabled={myChildcare}
            onToggle={() => saveMyFeature('childcare', !myChildcare)}
          />
          {myExpenses && (
            <ExpenseSplitRow
              userRole={userRole}
              splitPct={family?.config?.expense_split_pct ?? 50}
              onSave={(pct) => updateFamilyConfig({ expense_split_pct: pct })}
              pa={pa}
              pb={pb}
            />
          )}
        </AccordionGroup>
      )}

      {/* ── Read-only member access ── */}
      {isParent && (
        <AccordionGroup label="Read-only member access">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs text-gray-400">
              {parentB
                ? 'Choose what grandparents, carers, and other read-only members can see. Both parents must agree — changes are proposed to the other parent for confirmation.'
                : 'Choose what grandparents, carers, and other read-only members can see.'}
            </p>
          </div>

          {/* Pending proposal banner */}
          {hasPermProposal && (
            <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              {isMyPermProposal ? (
                <>
                  <p className="text-xs font-semibold text-amber-900">Waiting for {otherParentName} to confirm</p>
                  <p className="text-xs text-amber-800">Your proposed changes are shown below. They won't take effect until {otherParentName} confirms.</p>
                  <button onClick={cancelViewerProposal} className="text-xs text-amber-700 underline">Cancel proposal</button>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-amber-900">{permProposerName} has proposed changes</p>
                  <p className="text-xs text-amber-800">The changes below are waiting for your confirmation before taking effect.</p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="secondary"
                      className="flex-1 py-2 text-xs"
                      loading={proposalSaving}
                      onClick={async () => { await cancelViewerProposal() }}
                    >
                      Reject
                    </Button>
                    <Button
                      className="flex-1 py-2 text-xs"
                      loading={proposalSaving}
                      onClick={confirmViewerPerms}
                    >
                      Confirm
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className={hasPermProposal && !isMyPermProposal ? 'pointer-events-none opacity-60' : ''}>
            <ToggleRow
              label="Calendar"
              description="Family calendar and shared events"
              enabled={displayPerms.calendar ?? VIEWER_DEFAULTS.calendar}
              onToggle={() => toggleViewerPerm('calendar', true)}
            />
            <ToggleRow
              label="Notice Board"
              description="Family notice board posts and updates"
              enabled={displayPerms.noticeboard ?? VIEWER_DEFAULTS.noticeboard}
              onToggle={() => toggleViewerPerm('noticeboard', true)}
            />
            <ToggleRow
              label="Info Bank"
              description="Children's information, school contacts, and documents"
              enabled={displayPerms.info_bank ?? VIEWER_DEFAULTS.info_bank}
              onToggle={() => toggleViewerPerm('info_bank', false)}
            />
            <ToggleRow
              label="Parenting schedule"
              description="The parenting schedule and upcoming changeovers"
              enabled={displayPerms.schedule ?? VIEWER_DEFAULTS.schedule}
              onToggle={() => toggleViewerPerm('schedule', false)}
            />
            {(myMessaging || otherMessaging) && (
              <ToggleRow
                label="Messages"
                description="Allow read-only members to view message threads"
                enabled={displayPerms.messaging === true}
                onToggle={() => toggleViewerPerm('messaging', false)}
              />
            )}
            {(myExpenses || otherExpenses) && (
              <ToggleRow
                label="Expenses"
                description="Allow read-only members to view shared expenses"
                enabled={displayPerms.expenses === true}
                onToggle={() => toggleViewerPerm('expenses', false)}
              />
            )}
          </div>
        </AccordionGroup>
      )}

      {/* â"€â"€ Legal â"€â"€ */}
      <AccordionGroup label="Legal">
        <NavRow label="Export records" description="Download a Verified Family Record of messages and events" onPress={() => navigate('/export')} />
        <NavRow label="Privacy Policy" description="How we collect, use, and protect your data" onPress={() => window.open('https://canopy-app.app/privacy.html', '_blank')} />
        <NavRow label="Terms of Use" description="Your rights and responsibilities when using Canopy" onPress={() => window.open('https://canopy-app.app/terms.html', '_blank')} />
      </AccordionGroup>

      {/* â"€â"€ Account â"€â"€ */}
      <AccordionGroup label="Account">
        <div className="px-4 py-3 space-y-3">
          <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} placeholder="••••••••" required />
          <PasswordField label="New password" value={newPassword} onChange={setNewPassword} placeholder="••••••••" required />
          <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" required />
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <Button className="w-full py-3" loading={passwordSaving} onClick={changePassword}>
            {passwordSaved ? '✓ Password updated' : 'Update password'}
          </Button>
          {twoFaGlobalEnabled && (
            <button
              onClick={!twoFaSaving ? toggleTwoFa : undefined}
              disabled={twoFaSaving}
              className={`w-full flex items-center justify-between hover:bg-gray-50 transition-colors py-2 rounded-lg ${twoFaSaving ? 'opacity-50' : ''}`}
            >
              <div>
                <p className="text-sm font-medium text-gray-800 text-left">Two-factor authentication</p>
                <p className="text-xs text-gray-400 mt-0.5 text-left">Require an email code each time you sign in.</p>
              </div>
              <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${twoFaUserEnabled ? 'bg-canopy-mid' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${twoFaUserEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </button>
          )}
          <button
            onClick={signOut}
            className="w-full text-sm text-red-500 py-2 hover:underline"
          >
            Sign out
          </button>
          <div className="border-t border-gray-100 pt-2 space-y-1">
            <button onClick={downloadData} disabled={downloadingData} className="w-full text-sm text-gray-400 py-2 hover:underline disabled:opacity-50">
              {downloadingData ? 'Preparing download...' : 'Download my data'}
            </button>
            {deleteConfirm ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-red-700">This will permanently delete your account and all associated data. This cannot be undone.</p>
                {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setDeleteConfirm(false); setDeleteError(null) }} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button onClick={deleteAccount} disabled={deletingAccount} className="flex-1 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50">
                    {deletingAccount ? 'Deleting...' : 'Yes, delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(true)} className="w-full text-sm text-red-400 py-2 hover:underline">
                Delete my account
              </button>
            )}
          </div>
        </div>
      </AccordionGroup>

      <SettingsFooter appInfo={appInfo} />
    </div>
  )
}

// Shared by both the parent and carer Settings views below -- these two views
// render almost entirely different JSX (see the `if (!isParent)` branch
// above), which is exactly how this footer went missing from the carer view
// for a month (Help & FAQ) and would have happened again immediately with
// the new version display if it'd been added inline a second time. Anything
// that both views should always carry belongs here, not copy-pasted.
function SettingsFooter({ appInfo }) {
  return (
    <>
      <div className="mt-3 border-t border-gray-100 pt-3 pb-1 flex justify-center">
        <a
          href="https://canopy-app.app/faq.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-canopy-mid hover:text-canopy-deep transition-colors py-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          Help &amp; FAQ
        </a>
      </div>

      {appInfo && (
        <p className="text-center text-xs text-gray-300 pb-1">
          Version {appInfo.version} ({appInfo.build})
        </p>
      )}

      <div className="h-4" />
    </>
  )
}

// â"€â"€ Layout helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function AccordionGroup({ label, children, defaultOpen = false, badge = false, badgeColor = 'bg-green-500', id }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div id={id} className="mt-3 first:mt-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-1 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {label}
          {badge && <span className={`w-2 h-2 rounded-full ${badgeColor} shrink-0`} />}
        </span>
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

function PushToggleRow({ pushSupported, pushBlocked, pushEnabled, pushLoading, onToggle, isNative, pushError }) {
  if (!pushSupported) {
    return <p className="px-4 py-3 text-sm text-gray-400">Push notifications are not supported on this device or browser.</p>
  }
  if (pushBlocked) {
    const msg = isNative
      ? 'Notifications are blocked. Go to iPhone Settings > Canopy to enable them.'
      : 'Notifications are blocked in your browser settings. Enable them and reload.'
    return <p className="px-4 py-3 text-sm text-red-500">{msg}</p>
  }
  if (pushError) {
    return <p className="px-4 py-3 text-sm text-red-500">Could not enable notifications: {pushError}</p>
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

function TestPushRow({ state, onSend }) {
  const labels = {
    idle:    'Send test notification',
    sending: 'Sending…',
    sent:    'Sent — check your notifications',
    error:   'Failed to send — try again',
  }
  return (
    <button
      onClick={onSend}
      disabled={state === 'sending'}
      className="w-full flex items-center justify-between px-4 py-3 border-t border-gray-100 hover:bg-gray-50 transition-colors"
    >
      <p className={`text-sm text-left ${state === 'error' ? 'text-red-500' : 'text-canopy-mid'}`}>
        {labels[state]}
      </p>
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

function SubscriptionSection() {
  const { isTrialing, isActive, isPastDue, isCancelled, daysLeft, periodEnd, trialEndsAt } = useSubscription()
  const urgent = isTrialing && daysLeft <= 7

  return (
    <AccordionGroup label="Subscription" badge={urgent} badgeColor="bg-amber-400">
      <div className="px-4 py-3 space-y-3">

        {/* Active subscription */}
        {isActive && (
          <div className="rounded-xl p-3.5 bg-white border border-gray-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-canopy-deep">Family plan</span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">Active</span>
            </div>
            {periodEnd && (
              <p className="text-xs text-canopy-mid">
                Renews {periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            <p className="text-xs text-gray-400">Manage your subscription in the App Store or Google Play.</p>
          </div>
        )}

        {/* Trial — card with CTA */}
        {isTrialing && (
          <div className={`rounded-xl p-3.5 space-y-2.5 ${urgent ? 'bg-amber-50 border border-amber-200' : 'bg-canopy-frost border border-canopy-mist'}`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${urgent ? 'text-amber-800' : 'text-canopy-deep'}`}>
                {daysLeft} day{daysLeft !== 1 ? 's' : ''} left in your free trial
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${urgent ? 'bg-amber-200 text-amber-800' : 'bg-canopy-mist text-canopy-deep'}`}>
                Trial
              </span>
            </div>
            {trialEndsAt && (
              <p className={`text-xs ${urgent ? 'text-amber-700' : 'text-canopy-mid'}`}>
                Expires {trialEndsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            {/* Subscribe button — wired up when RevenueCat is integrated */}
            <button
              disabled
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-canopy-mid text-white opacity-50 cursor-not-allowed"
            >
              Subscribe — £6.99/mo or £69.99/yr
            </button>
            <p className="text-xs text-gray-400 text-center">Coming soon via the App Store</p>
          </div>
        )}

        {/* Past due */}
        {isPastDue && (
          <div className="rounded-xl p-3.5 space-y-2 bg-red-50 border border-red-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-red-800">Payment overdue</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-200 text-red-800">Action needed</span>
            </div>
            <p className="text-xs text-red-700">Please update your payment method in the App Store to keep access.</p>
          </div>
        )}

        {/* Cancelled */}
        {isCancelled && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Family plan</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Cancelled</span>
          </div>
        )}

        <p className="text-xs text-gray-400">Managed via the App Store or Google Play. Both parents included.</p>
      </div>
    </AccordionGroup>
  )
}

function ExpenseSplitRow({ userRole, splitPct, onSave, pa, pb }) {
  // splitPct = Parent A's share (0—100)
  const myShare    = userRole === 'parent_a' ? splitPct : (100 - splitPct)
  const otherShare = 100 - myShare
  const myName     = userRole === 'parent_a' ? pa : pb
  const otherName  = userRole === 'parent_a' ? pb : pa

  const [draft, setDraft]   = useState(myShare)
  const [saved, setSaved]   = useState(false)

  async function handleSave() {
    // Convert back to Parent A's share before saving
    const newPaShare = userRole === 'parent_a' ? draft : (100 - draft)
    await onSave(newPaShare)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="px-4 py-3 space-y-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Default expense split</p>
      <p className="text-xs text-gray-400">How shared expenses are split by default. You can change it per expense when logging.</p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-700">Your share ({myName})</span>
        <span className="text-sm font-bold text-gray-900">{draft}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        className="w-full accent-canopy-mid"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>0%</span>
        <span>100%</span>
      </div>
      <Button className="w-full py-2.5 text-sm" onClick={handleSave}>
        {saved ? '✓ Saved' : 'Save split'}
      </Button>
    </div>
  )
}

function ChevronRightIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

// â"€â"€ Schedule preview â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
