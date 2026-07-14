import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'

const ROLE_BADGE = {
  parent_a:    'bg-blue-900/50 text-blue-300',
  parent_b:    'bg-orange-900/50 text-orange-300',
  third_party: 'bg-slate-700 text-slate-300',
}

export default function AdminFamilyPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [showInviteModal, setShowInviteModal]   = useState(false)
  const [showDeleteModal, setShowDeleteModal]   = useState(false)
  const [deleteConfirm, setDeleteConfirm]       = useState('')
  const [deleteLoading, setDeleteLoading]       = useState(false)
  const [deleteError, setDeleteError]           = useState(null)

  useEffect(() => { loadFamily() }, [id])

  async function loadFamily() {
    setLoading(true)
    const { data: result, error: err } = await supabase.rpc('get_admin_family_detail', { p_family_id: id })
    if (err) { setError(err.message); setLoading(false); return }
    setData(result)
    setLoading(false)
  }

  async function handleDeleteFamily() {
    setDeleteLoading(true)
    setDeleteError(null)
    const { error: err } = await supabase.functions.invoke('admin-delete-family', {
      body: { family_id: id },
    })
    if (err) { setDeleteError(err.message); setDeleteLoading(false); return }
    navigate('/admin/dashboard')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-4 border-canopy-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1">
          ← Back
        </button>
        <p className="text-red-400">{error ?? 'Family not found'}</p>
      </div>
    )
  }

  const { family, members, schedule, recent_posts, recent_events, stats } = data

  const parentA   = members?.find((m) => m.role === 'parent_a')
  const parentB   = members?.find((m) => m.role === 'parent_b')
  const parentNames = members
    ?.filter((m) => ['parent_a', 'parent_b'].includes(m.role))
    .map((m) => m.display_name)
    .join(' & ') || 'Family'

  const CONFIRM_PHRASE = 'DELETE'

  return (
    <div className="space-y-8">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 mb-3">
            ← All families
          </button>
          <h1 className="text-2xl font-bold text-white">{parentNames}</h1>
          <p className="text-slate-500 text-xs mt-1">
            Created {format(new Date(family.created_at), 'd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-8 shrink-0">
          {!parentB && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="text-xs font-medium px-3 py-2 rounded-xl bg-canopy-mid/20 text-canopy-light hover:bg-canopy-mid/30 transition-colors"
            >
              Send invitation
            </button>
          )}
          <button
            onClick={() => setShowDeleteModal(true)}
            className="text-xs font-medium px-3 py-2 rounded-xl bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
          >
            Delete family
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Posts"     value={stats?.post_count} />
        <StatCard label="Events"    value={stats?.event_count} />
        <StatCard label="Changes"   value={stats?.change_count} />
        <StatCard label="Holidays"  value={stats?.holiday_count} highlight />
      </div>

      {/* Members */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Members ({members?.length ?? 0})</h2>
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                {['Name', 'Email', 'Role', 'Push', 'Joined'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.user_id} className="border-b border-slate-700/50">
                  <td className="px-4 py-3 text-white font-medium">{m.display_name}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{m.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role] ?? 'bg-slate-700 text-slate-400'}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${(m.push_token_ios || m.push_token_android || m.push_token_web) ? 'text-green-400' : 'text-slate-600'}`}>
                      {[m.push_token_ios && 'iOS', m.push_token_android && 'Android', m.push_token_web && 'Web'].filter(Boolean).join(', ') || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {format(new Date(m.created_at), 'd MMM yyyy')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Schedule */}
      {schedule && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Schedule</h2>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Pattern</p>
                <p className="text-white">{schedule.pattern_type}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Start date</p>
                <p className="text-white">{schedule.start_date}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent posts */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Recent posts</h2>
          <div className="space-y-2">
            {(recent_posts ?? []).length === 0 ? (
              <p className="text-slate-500 text-sm">No posts yet</p>
            ) : (recent_posts ?? []).map((p) => (
              <div key={p.id} className="bg-slate-800 rounded-xl border border-slate-700 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  {p.tag && <span className="text-xs bg-slate-700 text-slate-300 rounded-full px-2 py-0.5">{p.tag}</span>}
                  <span className="text-xs text-slate-500">{format(new Date(p.created_at), 'd MMM')}</span>
                </div>
                <p className="text-sm text-slate-300 line-clamp-2">{p.content}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Recent events */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Recent events</h2>
          <div className="space-y-2">
            {(recent_events ?? []).length === 0 ? (
              <p className="text-slate-500 text-sm">No events yet</p>
            ) : (recent_events ?? []).map((e) => (
              <div key={e.id} className="bg-slate-800 rounded-xl border border-slate-700 px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white font-medium">{e.title}</p>
                  <p className="text-xs text-slate-500">{e.event_date} · {e.source}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <InviteModal
          familyId={id}
          senderName={parentA?.display_name ?? 'Canopy'}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-red-900/60 p-6 w-full max-w-md space-y-5">
            <div>
              <h2 className="text-lg font-bold text-white">Delete family</h2>
              <p className="text-slate-400 text-sm mt-1">
                This permanently deletes <span className="text-white font-medium">{parentNames}</span> and all their data — posts, events, schedules, vault files, and auth accounts. This cannot be undone.
              </p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Type <span className="font-mono text-red-400">{CONFIRM_PHRASE}</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="DELETE"
              />
            </div>
            {deleteError && <p className="text-red-400 text-sm">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirm(''); setDeleteError(null) }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFamily}
                disabled={deleteConfirm !== CONFIRM_PHRASE || deleteLoading}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-700 text-white hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteLoading ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InviteModal({ familyId, senderName, onClose }) {
  const [email, setEmail]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState(null)

  async function send() {
    if (!email.trim()) return
    setLoading(true)
    setError(null)

    const { data: code, error: rpcErr } = await supabase.rpc('admin_generate_invite', {
      p_family_id: familyId,
      p_role: 'parent_b',
    })
    if (rpcErr || !code) { setError(rpcErr?.message ?? 'Failed to generate invite'); setLoading(false); return }

    const inviteLink = `${window.location.origin}/join/${code}`
    const { error: emailErr } = await supabase.functions.invoke('send-invite-email', {
      body: {
        recipientEmail: email.trim(),
        inviteCode:     code,
        inviteLink,
        role:           'parent_b',
        senderName,
      },
    })
    if (emailErr) { setError(emailErr.message); setLoading(false); return }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-md space-y-5">
        {sent ? (
          <>
            <p className="text-white font-semibold">Invitation sent</p>
            <p className="text-slate-400 text-sm">An invite email was sent to <span className="text-white">{email}</span>.</p>
            <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
              Close
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold text-white">Send invitation</h2>
              <p className="text-slate-400 text-sm mt-1">Generates a fresh invite code and emails it to the partner parent.</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Recipient email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="partner@example.com"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-canopy-green"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              <button
                onClick={send}
                disabled={!email.trim() || loading}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-canopy-mid text-white hover:bg-canopy-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 ${highlight ? 'bg-canopy-mid/10 border-canopy-green/30' : 'bg-slate-800 border-slate-700'}`}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${highlight ? 'text-canopy-light' : 'text-white'}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </p>
    </div>
  )
}
