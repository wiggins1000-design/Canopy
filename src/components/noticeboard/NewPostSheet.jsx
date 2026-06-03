import { useState, useRef } from 'react'
import { supabase, sendPushNotification, sendSmsNotification } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { NOTICE_TAGS } from '../../lib/noticeTags'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const IMAGE_EXTS  = ['jpg', 'jpeg', 'png', 'gif', 'webp']

function isImageFile(file) {
  if (IMAGE_TYPES.includes(file.type)) return true
  const ext = file.name.split('.').pop().toLowerCase()
  return IMAGE_EXTS.includes(ext)
}

export default function NewPostSheet({ open, onClose }) {
  const { family, userRole, parentA, parentB, member } = useFamily()
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [tag, setTag] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const recipientRole = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
  const recipientMember = recipientRole === 'parent_a' ? parentA : parentB

  function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (isImageFile(f)) {
      setPreview(URL.createObjectURL(f))
    } else {
      setPreview(null)
    }
  }

  function removeFile() {
    setFile(null)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (!content.trim()) { setError('Write something first.'); return }
    setSaving(true)
    setError(null)

    let imageUrl = null
    let fileUrl = null
    let fileName = null

    if (file) {
      const isImage = isImageFile(file)
      const uploadBlob = isImage ? await compressImage(file) : file
      const ext = isImage ? 'jpg' : file.name.split('.').pop()
      const path = `${family.id}/${crypto.randomUUID()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('notice-attachments')
        .upload(path, uploadBlob, { contentType: isImage ? 'image/jpeg' : file.type })

      if (uploadErr) { setError(uploadErr.message); setSaving(false); return }

      if (isImage) {
        imageUrl = path
      } else {
        fileUrl  = path
        fileName = file.name
      }
    }

    const { error: dbErr } = await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   content.trim(),
      p_image_url: imageUrl,
      p_file_url:  fileUrl,
      p_file_name: fileName,
      p_tag:       tag,
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    if (recipientMember) {
      await sendPushNotification({
        familyId:      family.id,
        recipientRole,
        title:         tag === 'urgent' ? '🚨 Urgent notice board post' : 'New notice board post',
        body:          content.trim().slice(0, 100),
        url:           '/board',
      })

      if (tag === 'urgent') {
        await sendSmsNotification({
          familyId:       family.id,
          recipientRole,
          authorName:     member?.display_name ?? 'Your co-parent',
          contentPreview: content.trim(),
        })
      }
    }

    setContent('')
    setTag(null)
    removeFile()
    setSaving(false)
    onClose()
  }

  function handleClose() {
    setContent('')
    setTag(null)
    removeFile()
    setError(null)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="New post">
      <div className="px-5 py-4 space-y-4">
        <textarea
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={5}
          placeholder="Write a note for the notice board…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />

        {/* Tag selector */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Topic <span className="font-normal text-gray-400">(optional)</span></p>
          <div className="flex flex-wrap gap-2">
            {NOTICE_TAGS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTag(tag === t.id ? null : t.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${tag === t.id ? t.active : t.chip}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* File preview */}
        {file && (
          <div className="relative">
            {preview ? (
              <img src={preview} alt="Preview" className="rounded-xl w-full max-h-48 object-cover" />
            ) : (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate">{file.name}</span>
              </div>
            )}
            <button
              onClick={removeFile}
              className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full text-white text-xs flex items-center justify-center"
            >
              ×
            </button>
          </div>
        )}

        {/* Attach button */}
        {!file && (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            Attach image or file
          </button>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full py-3" loading={saving} disabled={!content.trim()} onClick={submit}>
          Post
        </Button>
      </div>
    </BottomSheet>
  )
}
