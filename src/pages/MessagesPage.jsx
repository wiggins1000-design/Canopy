import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { useMessages } from '../hooks/useMessages'
import { useFamily } from '../context/FamilyContext'
import NewThreadSheet, { THREAD_PRESETS } from '../components/messages/NewThreadSheet'

export default function MessagesPage() {
  const navigate = useNavigate()
  const { threads, reads, loading, createThread, archiveThread } = useMessages()
  const { members } = useFamily()
  const [showNew, setShowNew] = useState(false)

  const existingPresets = threads.map((t) => t.topic_preset).filter(Boolean)

  function presetFor(thread) {
    return THREAD_PRESETS.find((p) => p.id === thread.topic_preset)
  }

  function isUnread(thread) {
    const lastRead = reads[thread.id]
    if (!lastRead) return true
    return new Date(thread.last_message_at) > new Date(lastRead)
  }

  function senderName(senderId) {
    return members.find((m) => m.user_id === senderId)?.display_name ?? 'Unknown'
  }

  async function handleCreate(topic, preset) {
    const { data: threadId, error } = await createThread(topic, preset)
    if (!error && threadId) {
      navigate(`/messages/${threadId}`)
    }
    return { error }
  }

  return (
    <div className="px-4 pt-5 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Messages</h1>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 bg-canopy-mid text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-canopy-deep active:scale-95 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="text-4xl">💬</div>
          <p className="text-sm font-medium text-gray-700">No conversations yet</p>
          <p className="text-xs text-gray-400">Start a topic thread to keep your discussions organised.</p>
          <button
            onClick={() => setShowNew(true)}
            className="mt-2 text-sm font-semibold text-canopy-mid hover:underline"
          >
            Start a conversation
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const preset = presetFor(thread)
            const unread = isUnread(thread)
            return (
              <button
                key={thread.id}
                onClick={() => navigate(`/messages/${thread.id}`)}
                className="w-full flex items-center gap-3 bg-canopy-frost border border-canopy-mist rounded-2xl px-4 py-3.5 text-left hover:border-canopy-light transition-colors"
              >
                {/* Emoji */}
                <div className="w-11 h-11 rounded-xl bg-white border border-canopy-mist flex items-center justify-center text-xl shrink-0 shadow-sm">
                  {preset?.emoji ?? '💬'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
                      {thread.topic}
                    </p>
                    {unread && <span className="w-2 h-2 rounded-full bg-canopy-mid shrink-0" />}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDistanceToNow(new Date(thread.last_message_at), { addSuffix: true })}
                  </p>
                </div>

                {/* Chevron */}
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            )
          })}
        </div>
      )}

      <NewThreadSheet
        open={showNew}
        onClose={() => setShowNew(false)}
        existingPresets={existingPresets}
        onCreate={handleCreate}
      />
    </div>
  )
}
