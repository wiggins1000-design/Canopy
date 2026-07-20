import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, isToday, isYesterday } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useThread } from '../hooks/useMessages'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'
import { sendPushNotification } from '../lib/supabase'
import { THREAD_PRESETS } from '../components/messages/NewThreadSheet'

export default function ThreadPage() {
  const { threadId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { members, member, userRole, isParent, parentA, parentB, family } = useFamily()
  const { messages, threadReads, loading, sendMessage, markRead } = useThread(threadId)
  const [thread, setThread] = useState(null)
  const [text, setText]     = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Load thread metadata
  useEffect(() => {
    if (!threadId) return
    supabase
      .from('message_threads')
      .select('*')
      .eq('id', threadId)
      .single()
      .then(({ data }) => setThread(data))
  }, [threadId])

  // Mark as read when page opens and when new messages arrive
  useEffect(() => {
    if (messages.length > 0) markRead()
  }, [messages.length])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setText('')
    const { error } = await sendMessage(content)
    if (error) { setText(content); setSending(false); return }

    // Push notification to the other parent
    const recipientRole = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
    const recipient = recipientRole === 'parent_a' ? parentA : parentB
    if (recipient && family?.id) {
      await sendPushNotification({
        familyId:      family.id,
        recipientRole,
        title:         `Message: ${thread?.topic ?? 'New message'}`,
        body:          content.slice(0, 100),
        url:           `/messages/${threadId}`,
      })
    }
    setSending(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const preset = THREAD_PRESETS.find((p) => p.id === thread?.topic_preset)

  function senderOf(msg) {
    return members.find((m) => m.user_id === msg.sender_id)
  }

  function isOwn(msg) {
    return msg.sender_id === user?.id
  }

  // ID of the last message the current user sent (for seen-by placement)
  const lastOwnMsgId = [...messages].reverse().find((m) => m.sender_id === user?.id)?.id

  // Members (excluding self) who have read up to a given message's sent_at
  function seenByFor(msg) {
    if (msg.id !== lastOwnMsgId) return []
    return members.filter((m) => {
      if (m.user_id === user?.id) return false
      const readAt = threadReads[m.user_id]
      return readAt && new Date(readAt) >= new Date(msg.sent_at)
    })
  }

  const ROLE_DISC = {
    parent_a: 'bg-pa-400',
    parent_b: 'bg-pb-400',
  }

  // Group messages by date
  function dayLabel(dateStr) {
    const d = new Date(dateStr)
    if (isToday(d))     return 'Today'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'd MMMM yyyy')
  }

  // Build grouped list with day separators
  const grouped = []
  let lastDay = null
  for (const msg of messages) {
    const day = format(new Date(msg.sent_at), 'yyyy-MM-dd')
    if (day !== lastDay) {
      grouped.push({ type: 'day', label: dayLabel(msg.sent_at), key: `day-${day}` })
      lastDay = day
    }
    grouped.push({ type: 'msg', msg })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white shrink-0">
        <button
          onClick={() => navigate('/messages')}
          className="p-1.5 -ml-1.5 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-lg">
          {preset?.emoji ?? '💬'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{thread?.topic ?? '…'}</p>
          <p className="text-xs text-gray-400">Parents only · permanent record</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">No messages yet.</p>
            <p className="text-xs mt-1">Start the conversation below.</p>
          </div>
        ) : (
          grouped.map((item) => {
            if (item.type === 'day') {
              return (
                <div key={item.key} className="flex items-center gap-3 py-3">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium shrink-0">{item.label}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )
            }

            const { msg } = item
            const own    = isOwn(msg)
            const sender = senderOf(msg)
            const seenBy = seenByFor(msg)

            return (
              <div key={msg.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'} mb-1`}>
                {!own && (
                  <p className="text-xs text-gray-400 ml-1 mb-0.5">{sender?.display_name ?? 'Unknown'}</p>
                )}
                <div
                  className={[
                    'max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
                    own
                      ? 'bg-canopy-deep text-white rounded-br-sm'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm',
                  ].join(' ')}
                >
                  {msg.content}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5 mx-1">
                  {format(new Date(msg.sent_at), 'HH:mm')}
                </p>
                {seenBy.length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5 mx-1">
                    <span className="text-[10px] text-gray-400">Seen by</span>
                    {seenBy.map((m) => (
                      <div
                        key={m.user_id}
                        title={m.display_name}
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold ${ROLE_DISC[m.role] ?? 'bg-gray-300'}`}
                      >
                        {(m.display_name ?? '?')[0].toUpperCase()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {isParent ? (
        <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message…"
            rows={1}
            className="flex-1 border border-gray-200 rounded-2xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green max-h-28 overflow-y-auto"
            style={{ lineHeight: '1.4' }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="w-10 h-10 rounded-full bg-canopy-mid text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-canopy-deep transition-colors"
          >
            <svg className="w-4 h-4 rotate-90" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
          <p className="text-xs text-center text-gray-400">You can read this conversation but not send messages.</p>
        </div>
      )}
    </div>
  )
}
