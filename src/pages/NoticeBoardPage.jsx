import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { startOfWeek, startOfMonth, subMonths } from 'date-fns'
import { useNoticeboard } from '../hooks/useNoticeboard'
import { useFamily } from '../context/FamilyContext'
import PostCard from '../components/noticeboard/PostCard'
import NewPostSheet from '../components/noticeboard/NewPostSheet'
import { NOTICE_TAGS } from '../lib/noticeTags'

const PAGE_SIZE = 10

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
  const [activeTags,  setActiveTags]  = useState(new Set())
  const [datePreset,  setDatePreset]  = useState('')
  const [page,        setPage]        = useState(1)

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1) }, [activeTags, datePreset])

  function toggleTag(tagId) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      next.has(tagId) ? next.delete(tagId) : next.add(tagId)
      return next
    })
  }

  function applyFilters(posts) {
    let out = posts
    if (activeTags.size > 0) out = out.filter((p) => activeTags.has(p.tag))
    const cutoff = getDateCutoff(datePreset)
    if (cutoff) out = out.filter((p) => new Date(p.created_at) >= cutoff)
    return out
  }

  const filteredPinned = applyFilters(pinnedPosts)
  const filteredFeed   = applyFilters(feedPosts)
  const totalPages     = Math.max(1, Math.ceil(filteredFeed.length / PAGE_SIZE))
  const safePage       = Math.min(page, totalPages)
  const pagedFeed      = filteredFeed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="px-4 pt-5 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">Notices</h1>
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
              className="flex items-center gap-1.5 bg-canopy-mid text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-canopy-deep active:scale-95 transition-all"
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
      <div
        className="flex gap-2 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <button
          onClick={() => setActiveTags(new Set())}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors shrink-0 ${activeTags.size === 0 ? 'bg-canopy-deep text-white' : 'bg-gray-100 text-gray-500'}`}
        >
          All
        </button>
        {NOTICE_TAGS.map((t) => {
          const active = activeTags.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggleTag(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 ${active ? t.active : 'bg-gray-100 text-gray-500'}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Date filter */}
      <div className="flex items-center justify-end gap-1.5 mb-4 mt-1">
        <span className="text-xs text-gray-400">Show:</span>
        <select
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value)}
          className="text-xs font-medium text-canopy-deep bg-transparent border-0 focus:outline-none cursor-pointer appearance-none pr-4"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232d6a4f\' stroke-width=\'2\'%3E%3Cpath d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
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
                {activeTags.size > 0 || datePreset ? (
                  <p className="text-sm font-medium">No posts matching your current filter</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">No posts yet</p>
                    {isParent && <p className="text-xs mt-1">Tap "New post" to add something</p>}
                  </>
                )}
              </div>
            ) : (
              pagedFeed.map((post) => (
                <PostCard key={post.id} post={post} reads={reads[post.id] ?? new Set()} onVisible={markRead} />
              ))
            )}
          </section>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                .reduce((acc, n, idx, arr) => {
                  if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…')
                  acc.push(n)
                  return acc
                }, [])
                .map((item, idx) =>
                  item === '…' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item)}
                      className={`w-8 h-8 rounded-xl text-xs font-semibold transition-colors ${
                        item === safePage
                          ? 'bg-canopy-mid text-white'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      <NewPostSheet open={showNewPost} onClose={() => setShowNewPost(false)} />
    </div>
  )
}
