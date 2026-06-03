import { useState } from 'react'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'

export default function InvitePage() {
  const { family, members, userRole, isParent, parentA, parentB, generateInvite } = useFamily()
  const { signOut } = useAuth()
  const [inviteCode, setInviteCode] = useState(null)
  const [inviteRole, setInviteRole] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const hasParentB = !!parentB
  const inviteLink = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null

  async function handleGenerateInvite(role) {
    setGenerating(true)
    const { data, error } = await generateInvite(role)
    if (!error && data) {
      setInviteCode(data.code)
      setInviteRole(role)
      setCopied(false)
    }
    setGenerating(false)
  }

  function copyLink() {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className="px-4 py-5 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">People</h1>
        <button onClick={signOut} className="text-xs text-gray-400 hover:underline">Sign out</button>
      </div>

      {/* Family info */}
      {family && (
        <div className="bg-blue-50 rounded-2xl px-4 py-3 border border-blue-100">
          <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Children</p>
          <p className="font-bold text-gray-900 mt-0.5">{family.name}</p>
        </div>
      )}

      {/* Members list */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Members</h2>
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm ${m.role === 'parent_a' ? 'bg-pa-400' : m.role === 'parent_b' ? 'bg-pb-400' : 'bg-gray-300'}`}>
              {m.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">{m.display_name}</p>
              <Badge
                label={m.role === 'parent_a' ? 'Parent A' : m.role === 'parent_b' ? 'Parent B' : 'Read-only'}
                type={m.role === 'parent_a' ? 'parent_a' : m.role === 'parent_b' ? 'parent_b' : 'expired'}
              />
            </div>
            {m.role === userRole && <span className="text-xs text-gray-400">You</span>}
          </div>
        ))}
      </section>

      {/* Invite section — only parents */}
      {isParent && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Invite someone</h2>

          {!hasParentB && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
              <p className="text-sm text-yellow-800 font-medium">Parent B hasn't joined yet</p>
              <p className="text-xs text-yellow-600 mt-0.5">Generate an invite code below and share it.</p>
            </div>
          )}

          <div className="flex gap-2">
            {!hasParentB && (
              <Button variant="secondary" className="flex-1 text-xs" loading={generating} onClick={() => handleGenerateInvite('parent_b')}>
                Invite Parent B
              </Button>
            )}
            <Button variant="secondary" className="flex-1 text-xs" loading={generating} onClick={() => handleGenerateInvite('third_party')}>
              Invite read-only
            </Button>
          </div>

          {inviteCode && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Invite for {inviteRole === 'parent_b' ? 'Parent B' : 'read-only access'} — expires in 7 days
              </p>

              {/* Shareable link (primary) */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Share this link — they tap it to join directly:</p>
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <span className="text-xs text-gray-600 flex-1 truncate font-mono">{inviteLink}</span>
                  <Button variant="secondary" className="text-xs py-1.5 shrink-0" onClick={copyLink}>
                    {copied ? '✓ Copied' : 'Copy link'}
                  </Button>
                </div>
              </div>

              {/* Code fallback */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Or share the code manually:</p>
                <span className="font-mono text-2xl font-bold tracking-widest text-gray-900">{inviteCode}</span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
