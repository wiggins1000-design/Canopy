import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, startOfWeek, startOfMonth, startOfYear, subMonths } from 'date-fns'
import { supabase, toStoragePath } from '../lib/supabase'
import { useMediaAttachments } from '../hooks/useMediaAttachments'
import { NOTICE_TAGS, tagById } from '../lib/noticeTags'

const TYPE_FILTERS = [
  { id: 'all',   label: 'All' },
  { id: 'photo', label: 'Photos' },
  { id: 'doc',   label: 'Documents' },
]

const DATE_PRESETS = [
  { id: null,       label: 'All time' },
  { id: 'week',     label: 'This week' },
  { id: 'month',    label: 'This month' },
  { id: '3months',  label: 'Last 3 months' },
  { id: 'year',     label: 'This year' },
  { id: 'custom',   label: 'Custom…' },
]

function getPresetRange(preset) {
  const now = new Date()
  if (preset === 'week')    return { from: startOfWeek(now, { weekStartsOn: 1 }), to: null }
  if (preset === 'month')   return { from: startOfMonth(now), to: null }
  if (preset === '3months') return { from: subMonths(now, 3), to: null }
  if (preset === 'year')    return { from: startOfYear(now), to: null }
  return { from: null, to: null }
}

export default function MediaPage() {
  const navigate = useNavigate()
  const { photos, docs, loading } = useMediaAttachments()
  const [typeFilter, setTypeFilter] = useState('all')
  const [tagFilter, setTagFilter]   = useState(null)
  const [datePreset, setDatePreset] = useState(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [lightbox, setLightbox]     = useState(null)

  function applyDateFilter(arr) {
    let from = null
    let to   = null
    if (datePreset === 'custom') {
      from = customFrom ? new Date(customFrom) : null
      to   = customTo   ? new Date(customTo + 'T23:59:59') : null
    } else if (datePreset) {
      const range = getPresetRange(datePreset)
      from = range.from
    }
    if (!from && !to) return arr
    return arr.filter((i) => {
      const d = new Date(i.created_at)
      if (from && d < from) return false
      if (to   && d > to)   return false
      return true
    })
  }

  const applyFilters = (arr) => {
    let out = applyDateFilter(arr)
    if (tagFilter) out = out.filter((i) => i.tag === tagFilter)
    return out
  }

  const visiblePhotos = typeFilter !== 'doc'   ? applyFilters(photos) : []
  const visibleDocs   = typeFilter !== 'photo' ? applyFilters(docs)   : []
  const isEmpty = visiblePhotos.length === 0 && visibleDocs.length === 0

  return (
    <div className="px-4 pt-5 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/board')}
          className="p-1.5 -ml-1.5 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">Media &amp; Files</h1>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 mb-3">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setTypeFilter(f.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              typeFilter === f.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tag filter */}
      <div className="flex flex-wrap gap-2 pb-3">
        <button
          onClick={() => setTagFilter(null)}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            tagFilter === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          All topics
        </button>
        {NOTICE_TAGS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTagFilter(tagFilter === t.id ? null : t.id)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              tagFilter === t.id ? t.active : t.chip
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Date filter */}
      <div className="pb-4 space-y-2">
        <div className="relative">
          <select
            value={datePreset ?? ''}
            onChange={(e) => setDatePreset(e.target.value || null)}
            className="w-full appearance-none border border-gray-200 rounded-xl px-3 py-2.5 pr-9 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-canopy-green"
          >
            {DATE_PRESETS.map((p) => (
              <option key={String(p.id)} value={p.id ?? ''}>{p.label}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {datePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
              />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-canopy-mid border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isEmpty ? (
        <EmptyState typeFilter={typeFilter} tagFilter={tagFilter} />
      ) : (
        <div className="space-y-6">
          {/* Photo grid */}
          {visiblePhotos.length > 0 && (
            <section>
              {typeFilter === 'all' && (
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Photos</h2>
              )}
              <div className="grid grid-cols-2 gap-2">
                {visiblePhotos.map((post) => (
                  <PhotoThumb key={post.id} post={post} onOpen={setLightbox} />
                ))}
              </div>
            </section>
          )}

          {/* Document list */}
          {visibleDocs.length > 0 && (
            <section>
              {typeFilter === 'all' && (
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Documents</h2>
              )}
              <div className="space-y-2">
                {visibleDocs.map((post) => (
                  <DocRow key={post.id} post={post} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightbox}
            alt=""
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function PhotoThumb({ post, onOpen }) {
  const [url, setUrl] = useState(null)
  const tag = tagById(post.tag)

  useEffect(() => {
    supabase.storage
      .from('notice-attachments')
      .createSignedUrl(toStoragePath(post.image_url), 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [post.image_url])

  return (
    <button
      onClick={() => url && onOpen(url)}
      className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 active:scale-95 transition-transform"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full animate-pulse bg-gray-200" />
      )}
      {tag && (
        <span className={`absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${tag.active}`}>
          {tag.label}
        </span>
      )}
    </button>
  )
}

function DocRow({ post }) {
  const [url, setUrl] = useState(null)
  const tag = tagById(post.tag)

  useEffect(() => {
    supabase.storage
      .from('notice-attachments')
      .createSignedUrl(toStoragePath(post.file_url), 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [post.file_url])

  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <FileIcon className="w-5 h-5 text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{post.file_name ?? 'Attachment'}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {tag && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${tag.chip}`}>{tag.label}</span>
          )}
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <DownloadIcon className="w-4 h-4" />
        </a>
      ) : (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-gray-50 animate-pulse" />
      )}
    </div>
  )
}

function EmptyState({ typeFilter, tagFilter }) {
  const tag = tagById(tagFilter)
  const typeLabel = typeFilter === 'photo' ? 'photos' : typeFilter === 'doc' ? 'documents' : 'files'
  return (
    <div className="text-center py-16 text-gray-400">
      <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
      <p className="text-sm font-medium">
        No {tag ? `${tag.label} ` : ''}{typeLabel} yet
      </p>
    </div>
  )
}

function FileIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function DownloadIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}
