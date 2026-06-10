import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

const PLATFORM_SUGGESTIONS = [
  'Times Table Rock Stars', 'Mathletics', 'Education City', 'Spelling Shed',
  'Google', 'Microsoft', 'Apple ID', 'Email', 'YouTube Kids',
  'Nintendo', 'PlayStation', 'Roblox', 'Minecraft', 'Disney+', 'Netflix',
]

export default function AccountsSection({ childName }) {
  const { family, isParent } = useFamily()
  const [accounts, setAccounts]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [sheetOpen, setSheetOpen]     = useState(false)
  const [editing, setEditing]         = useState(null)

  useEffect(() => { loadAccounts() }, [family?.id, childName])

  async function loadAccounts() {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('child_accounts')
      .select('id, platform, username, url, notes, vault_secret_id')
      .eq('family_id', family.id)
      .eq('child_name', childName)
      .order('created_at', { ascending: true })
    setAccounts(data ?? [])
    setLoading(false)
  }

  function openAdd() { setEditing(null); setSheetOpen(true) }
  function openEdit(account) { setEditing(account); setSheetOpen(true) }

  async function handleDelete(id) {
    await supabase.rpc('delete_child_account', { p_id: id })
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleSave({ platform, username, password, url, notes }) {
    if (editing) {
      await supabase.rpc('update_child_account', {
        p_id:       editing.id,
        p_platform: platform,
        p_username: username,
        p_password: password || null,
        p_url:      url || null,
        p_notes:    notes || null,
      })
    } else {
      await supabase.rpc('add_child_account', {
        p_child_name: childName,
        p_platform:   platform,
        p_username:   username,
        p_password:   password || null,
        p_url:        url || null,
        p_notes:      notes || null,
      })
    }
    setSheetOpen(false)
    loadAccounts()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {accounts.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No accounts saved yet.</p>
      )}

      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          isParent={isParent}
          onEdit={() => openEdit(account)}
          onDelete={() => handleDelete(account.id)}
        />
      ))}

      {isParent && (
        <button
          onClick={openAdd}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-sm text-gray-500 hover:border-canopy-green hover:text-canopy-mid transition-colors"
        >
          + Add account
        </button>
      )}

      <AccountSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        account={editing}
        onSave={handleSave}
      />
    </div>
  )
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({ account, isParent, onEdit, onDelete }) {
  const [password, setPassword]     = useState(null) // null = not yet fetched
  const [revealed, setRevealed]     = useState(false)
  const [fetching, setFetching]     = useState(false)
  const [confirmDelete, setConfirm] = useState(false)
  const [copied, setCopied]         = useState(null) // 'username' | 'password'

  const hasPassword = !!account.vault_secret_id

  async function fetchPassword() {
    if (password !== null) return password
    setFetching(true)
    const { data } = await supabase.rpc('get_account_password', { p_id: account.id })
    setPassword(data ?? '')
    setFetching(false)
    return data ?? ''
  }

  async function toggleReveal() {
    if (revealed) { setRevealed(false); return }
    await fetchPassword()
    setRevealed(true)
  }

  async function copyText(type) {
    let text
    if (type === 'username') {
      text = account.username
    } else {
      text = password !== null ? password : await fetchPassword()
    }
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 space-y-2.5">
      {/* Header: platform + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{account.platform}</p>
          {account.url && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{account.url}</p>
          )}
        </div>
        {isParent && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <PencilIcon className="w-4 h-4" />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1 ml-1">
                <button onClick={onDelete} className="text-xs text-red-600 font-semibold hover:underline">Delete</button>
                <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirm(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Username */}
      {account.username && (
        <CredentialRow
          label="Username"
          value={account.username}
          revealed
          onCopy={() => copyText('username')}
          copied={copied === 'username'}
        />
      )}

      {/* Password */}
      {hasPassword && (
        <CredentialRow
          label="Password"
          value={revealed && password ? password : '••••••••'}
          revealed={revealed}
          loading={fetching}
          onReveal={toggleReveal}
          onCopy={() => copyText('password')}
          copied={copied === 'password'}
        />
      )}

      {account.notes && (
        <p className="text-xs text-gray-400 px-0.5">{account.notes}</p>
      )}
    </div>
  )
}

function CredentialRow({ label, value, revealed, loading, onReveal, onCopy, copied }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-800 flex-1 truncate font-mono">{value}</span>
        {onReveal && (
          <button
            onClick={onReveal}
            disabled={loading}
            className="shrink-0 p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {loading
              ? <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              : revealed ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />
            }
          </button>
        )}
        <button
          onClick={onCopy}
          className="shrink-0 p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        >
          {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

// ── Add / Edit sheet ──────────────────────────────────────────────────────────

function AccountSheet({ open, onClose, account, onSave }) {
  const [platform,     setPlatform]     = useState('')
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [url,          setUrl]          = useState('')
  const [notes,        setNotes]        = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    if (open) {
      setPlatform(account?.platform ?? '')
      setUsername(account?.username ?? '')
      setPassword('')
      setUrl(account?.url ?? '')
      setNotes(account?.notes ?? '')
      setShowPassword(false)
    }
  }, [open, account?.id])

  async function save() {
    if (!platform.trim()) return
    setSaving(true)
    await onSave({
      platform: platform.trim(),
      username: username.trim(),
      password,
      url:   url.trim(),
      notes: notes.trim(),
    })
    setSaving(false)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={account ? 'Edit account' : 'Add account'}>
      <div className="px-5 py-4 space-y-4">

        {/* Platform */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Platform</label>
          {!account && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PLATFORM_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setPlatform(s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    platform === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder={account ? '' : 'Or type a custom platform name…'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Username */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Username / Email</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. star_kid_2015"
            autoComplete="off"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Password */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            Password{account ? ' — leave blank to keep existing' : ''}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={account ? '••••••••' : 'Enter password'}
              autoComplete="new-password"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* URL */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Website (optional)</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ttrockstars.com"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. School login, not personal account"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Security notice */}
        <div className="flex items-start gap-2.5 bg-canopy-frost border border-canopy-mist rounded-xl px-3 py-2.5">
          <LockIcon className="w-4 h-4 text-canopy-deep shrink-0 mt-0.5" />
          <p className="text-xs text-canopy-deep">Passwords are encrypted at rest using Supabase Vault. They are never stored as plain text.</p>
        </div>

        <Button
          className="w-full py-3"
          loading={saving}
          disabled={!platform.trim()}
          onClick={save}
        >
          {account ? 'Save changes' : 'Add account'}
        </Button>
      </div>
    </BottomSheet>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function EyeIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function EyeOffIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

function CopyIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
    </svg>
  )
}

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function LockIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}
