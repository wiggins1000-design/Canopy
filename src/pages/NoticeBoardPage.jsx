import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startOfWeek, startOfMonth, subMonths } from 'date-fns'
import { useNoticeboard } from '../hooks/useNoticeboard'
import { useFamily } from '../context/FamilyContext'
import PostCard from '../components/noticeboard/PostCard'
import NewPostSheet from '../components/noticeboard/NewPostSheet'
import { NOTICE_TAGS } from '../lib/noticeTags'

const DATE_PRESETS = [
  { id: '',        label: 'All time' },
  { id: 'week',    label: 'This week' },
  { id: 'month',   label: 'This month' },
  { id: '3months', label: 'Last 3 months' },
]

function getDateCutoff(preset) {
  const now = new Date()
  if (preset === 'week')    return startOfWeek(now, { weekStartsOn: 1 })
  if (preset === 'month')   return startOfMonth(now)
  if (preset === '3months') return subMonths(now, 3)
  return null
}

export default function NoticeBoardPage() {
  const navigate = useNavigate()
  const { pinnedPosts, feedPosts, reads, loading, markRead } = useNoticeboard()
  const { isParent } = useFamily()
  const [showNewPost, setShowNewPost] = useState(false)
  const [hiddenTags, setHiddenTags]   = useState(new Set())
  const [datePreset, setDatePreset]   = useState('')

  function toggleHidden(tagId) {
    setHiddenTags((prev) => {
      const next = new Set(prev)
      next.has(tagId) ? next.delete(tagId) : next.add(tagId)
      return next
    })
  }

  function applyFilters(posts) {
    let out = posts
    if (hiddenTags.size > 0) out = out.filter((p) => !hiddenTags.has(p.tag))
    const cutoff = getDateCutoff(datePreset)
    if (cutoff) out = out.filter((p) => new Date(p.created_at) >= cutoff)
    return out
  }

  const filteredPinned = applyFilters(pinnedPosts)
  const filteredFeed   = applyFilters(feedPosts)

  return (
    <div className="px-4 pt-5 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Notice Board</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/board/media')}
            title="Media &amp; Files"
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>
          {isParent && (
            <button
              onClick={() => setShowNewPost(true)}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 active:scale-95 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New post
            </button>
          )}
        </div>
      </div>

      {/* Tag filter bar */}
      <div className="flex flex-wrap gap-2 pb-1">
        <button
          onClick={() => setHiddenTags(new Set())}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${hiddenTags.size === 0 ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          All
        </button>
        {NOTICE_TAGS.map((t) => {
          const hidden = hiddenTags.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggleHidden(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${hidden ? 'bg-gray-100 text-gray-300 line-through' : t.chip}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 pb-3">Tap a type to hide it from your feed</p>

      {/* Date filter */}
      <div className="relative mb-4">
        <select
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value)}
          className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 pr-9 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pinned section */}
          {filteredPinned.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Pinned</h2>
              </div>
              {filteredPinned.map((post) => (
                <PostCard key={post.id} post={post} reads={reads[post.id] ?? new Set()} onVisible={markRead} />
              ))}
            </section>
          )}

          {/* Feed */}
          <section className="space-y-3">
            {filteredPinned.length > 0 && filteredFeed.length > 0 && (
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Latest</h2>
            )}
            {filteredFeed.length === 0 && filteredPinned.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                {hiddenTags.size > 0 ? (
                  <p className="text-sm font-medium">No posts matching your current filter</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">No posts yet</p>
                    {isParent && <p className="text-xs mt-1">Tap "New post" to add something</p>}
                  </>
                )}
              </div>
            ) : (
              filteredFeed.map((post) => (
                <PostCard key={post.id} post={post} reads={reads[post.id] ?? new Set()} onVisible={markRead} />
              ))
            )}
          </section>
        </div>
      )}

      <NewPostSheet open={showNewPost} onClose={() => setShowNewPost(false)} />
    </div>
  )
}
