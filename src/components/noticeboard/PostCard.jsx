import { useState, useEffect, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { supabase, toStoragePath } from '../../lib/supabase'
import { useFamily } from '../../context/FamilyContext'
import { tagById } from '../../lib/noticeTags'

const AUTHOR_STYLES = {
  parent_a:    { dot: 'bg-pa-400',   border: 'border-pa-200',   name: 'text-pa-700'  },
  parent_b:    { dot: 'bg-pb-400',   border: 'border-pb-200',   name: 'text-pb-700'  },
  third_party: { dot: 'bg-gray-300', border: 'border-gray-200', name: 'text-gray-500' },
}

const ROLE_DISC_COLOUR = {
  parent_a:    'bg-pa-400',
  parent_b:    'bg-pb-400',
  third_party: 'bg-gray-300',
}

export default function PostCard({ post, reads = new Set(), onVisible }) {
  const { members, isParent } = useFamily()
  const [signedImageUrl, setSignedImageUrl] = useState(null)
  const [signedFileUrl, setSignedFileUrl]   = useState(null)
  const cardRef = useRef(null)

  useEffect(() => {
    if (!post.image_url) return
    supabase.storage
      .from('notice-attachments')
      .createSignedUrl(toStoragePath(post.image_url), 3600)
      .then(({ data }) => { if (data?.signedUrl) setSignedImageUrl(data.signedUrl) })
  }, [post.image_url])

  useEffect(() => {
    if (!post.file_url || post.image_url) return
    supabase.storage
      .from('notice-attachments')
      .createSignedUrl(toStoragePath(post.file_url), 3600)
      .then(({ data }) => { if (data?.signedUrl) setSignedFileUrl(data.signedUrl) })
  }, [post.file_url, post.image_url])

  // Intersection observer — fires onVisible when card enters viewport
  useEffect(() => {
    if (!onVisible || !cardRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { onVisible(post.id); observer.disconnect() } },
      { threshold: 0.5 }
    )
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [post.id, onVisible])

  const author      = members.find((m) => m.user_id === post.author_id)
  const authorRole  = author?.role ?? 'third_party'
  const styles      = AUTHOR_STYLES[authorRole] ?? AUTHOR_STYLES.third_party

  async function togglePin() {
    await supabase.rpc('update_notice_post', { p_post_id: post.id, p_is_pinned: !post.is_pinned })
  }

  async function archive() {
    await supabase.rpc('update_notice_post', { p_post_id: post.id, p_is_archived: true })
  }

  // Build reader discs: all members who have read this post (excluding author)
  const readers = members.filter(
    (m) => reads.has(m.user_id) && m.user_id !== post.author_id
  )

  return (
    <div ref={cardRef} className={`bg-white rounded-2xl border ${styles.border} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${styles.dot}`} />
          <span className={`text-sm font-semibold ${styles.name}`}>
            {author?.display_name ?? 'External'}
          </span>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </span>
        </div>

        {isParent && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={togglePin}
              title={post.is_pinned ? 'Unpin' : 'Pin'}
              className={`p-1.5 rounded-lg transition-colors ${post.is_pinned ? 'bg-yellow-100 text-yellow-600' : 'hover:bg-gray-100 text-gray-400'}`}
            >
              <PinIcon className="w-4 h-4" />
            </button>
            <button
              onClick={archive}
              title="Archive"
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <ArchiveIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Tag */}
      {post.tag && (() => { const t = tagById(post.tag); return t ? (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${t.chip}`}>{t.label}</span>
      ) : null })()}

      {/* Content */}
      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{post.content}</p>

      {/* Image attachment */}
      {post.image_url && signedImageUrl && (
        <img src={signedImageUrl} alt="" className="rounded-xl w-full max-h-64 object-cover" />
      )}
      {post.image_url && !signedImageUrl && (
        <div className="rounded-xl w-full h-32 bg-gray-100 animate-pulse" />
      )}

      {/* File attachment */}
      {post.file_url && !post.image_url && (
        signedFileUrl ? (
          <a
            href={signedFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-canopy-mid hover:bg-gray-100 transition-colors"
          >
            <FileIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{post.file_name ?? 'Attachment'}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-400">
            <FileIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{post.file_name ?? 'Attachment'}</span>
          </div>
        )
      )}

      {/* Read receipts */}
      {readers.length > 0 && (
        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-xs text-gray-400">Seen by</span>
          {readers.map((m) => (
            <div
              key={m.user_id}
              title={m.display_name}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${ROLE_DISC_COLOUR[m.role] ?? 'bg-gray-300'}`}
            >
              {(m.display_name ?? '?')[0].toUpperCase()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PinIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  )
}

function ArchiveIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )
}

function FileIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}
