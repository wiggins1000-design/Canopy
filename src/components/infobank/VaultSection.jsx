import { useState, useEffect, useRef } from 'react'
import { supabase, sendPushNotification } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'
import { useFamily } from '../../context/FamilyContext'
import { useAuth } from '../../context/AuthContext'
import { formatDistanceToNow } from 'date-fns'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

const CATEGORIES = [
  { id: 'legal',     label: 'Legal'     },
  { id: 'medical',   label: 'Medical'   },
  { id: 'school',    label: 'School'    },
  { id: 'identity',  label: 'Identity'  },
  { id: 'financial', label: 'Financial' },
  { id: 'other',     label: 'Other'     },
]

const CAT_STYLES = {
  legal:     'bg-purple-100 text-purple-700',
  medical:   'bg-red-100 text-red-700',
  school:    'bg-blue-100 text-blue-700',
  identity:  'bg-yellow-100 text-yellow-700',
  financial: 'bg-green-100 text-green-700',
  other:     'bg-gray-100 text-gray-600',
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 20 * 1024 * 1024

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function VaultSection({ childName }) {
  const { family, member, isParent, userRole, parentA, parentB } = useFamily()
  const { user } = useAuth()
  const fileRef = useRef(null)

  const [docs, setDocs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [filterCat, setFilterCat] = useState('all')

  const [pendingFile, setPendingFile] = useState(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCat, setUploadCat]     = useState('other')
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const [deletingId, setDeletingId]   = useState(null)
  const [confirmId, setConfirmId]     = useState(null)

  useEffect(() => { loadDocs() }, [family?.id, childName])

  async function loadDocs() {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('vault_documents')
      .select('*')
      .eq('family_id', family.id)
      .eq('child_name', childName)
      .order('created_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_BYTES) {
      alert(`File is too large. Maximum size is 20 MB.`)
      e.target.value = ''
      return
    }
    setUploadTitle(file.name.replace(/\.[^.]+$/, ''))
    setUploadCat('other')
    setUploadError(null)
    setPendingFile(file)
    e.target.value = ''
  }

  async function confirmUpload() {
    if (!uploadTitle.trim()) { setUploadError('Add a title.'); return }
    setUploading(true)
    setUploadError(null)

    const isImage = IMAGE_TYPES.includes(pendingFile.type)
    const blob     = isImage ? await compressImage(pendingFile) : pendingFile
    const ext      = pendingFile.name.split('.').pop()
    const path     = `${family.id}/${crypto.randomUUID()}.${ext}`

    const { error: storageErr } = await supabase.storage.from('vault').upload(path, blob, {
      contentType: isImage ? 'image/jpeg' : pendingFile.type,
    })
    if (storageErr) { setUploadError(storageErr.message); setUploading(false); return }

    const { error: dbErr } = await supabase.from('vault_documents').insert({
      family_id:   family.id,
      child_name:  childName,
      title:       uploadTitle.trim(),
      category:    uploadCat,
      file_path:   path,
      file_name:   pendingFile.name,
      file_size:   blob.size ?? pendingFile.size,
      mime_type:   isImage ? 'image/jpeg' : pendingFile.type,
      uploaded_by: user.id,
    })
    if (dbErr) { setUploadError(dbErr.message); setUploading(false); return }

    {
      const categoryLabel = CATEGORIES.find((c) => c.id === uploadCat)?.label ?? uploadCat
      const childLabel    = childName === 'Family' ? 'family documents' : childName
      const uploaderName  = member?.display_name ?? 'A parent'
      const { error: noticeErr } = await supabase.rpc('create_notice_post', {
        p_family_id: family.id,
        p_content:   `📎 ${uploaderName} added a document to the vault\n${uploadTitle.trim()} · ${categoryLabel} · ${childLabel}`,
        p_image_url: null,
        p_file_url:  null,
        p_file_name: null,
        p_tag:       'notification',
      })
      if (noticeErr) console.error('Vault notice post error:', noticeErr)
      const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
      const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
      if (recipientMember) {
        await sendPushNotification({
          familyId:     family.id,
          recipientRole,
          title:        'New vault document',
          body:         `${uploaderName} added "${uploadTitle.trim()}" to the vault`,
          url:          '/info',
        })
      }
    }

    setUploading(false)
    setPendingFile(null)
    loadDocs()
  }

  async function download(doc) {
    const { data } = await supabase.storage
      .from('vault')
      .createSignedUrl(doc.file_path, 3600, { download: doc.file_name || doc.title })
    if (!data?.signedUrl) return
    const a = document.createElement('a')
    a.href = data.signedUrl
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function deleteDoc(doc) {
    setDeletingId(doc.id)
    await supabase.storage.from('vault').remove([doc.file_path])
    await supabase.from('vault_documents').delete().eq('id', doc.id)
    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    setConfirmId(null)
    setDeletingId(null)
  }

  const filtered = filterCat === 'all' ? docs : docs.filter((d) => d.category === filterCat)

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <FilterChip active={filterCat === 'all'} onClick={() => setFilterCat('all')}>All</FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c.id} active={filterCat === c.id} onClick={() => setFilterCat(c.id)}>{c.label}</FilterChip>
        ))}
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <FileIcon className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="text-sm">{docs.length === 0 ? 'No documents yet' : 'No documents in this category'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <div key={doc.id} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
              <DocTypeIcon mime={doc.mime_type} className="w-9 h-9 shrink-0 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CAT_STYLES[doc.category]}`}>
                    {CATEGORIES.find((c) => c.id === doc.category)?.label}
                  </span>
                  {doc.file_size && <span className="text-xs text-gray-400">{formatBytes(doc.file_size)}</span>}
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => download(doc)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                  title="Download"
                >
                  <DownloadIcon className="w-4 h-4" />
                </button>
                {isParent && (
                  confirmId === doc.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => deleteDoc(doc)}
                        disabled={deletingId === doc.id}
                        className="text-xs text-red-600 font-semibold hover:underline px-1"
                      >
                        {deletingId === doc.id ? '…' : 'Delete'}
                      </button>
                      <button onClick={() => setConfirmId(null)} className="text-xs text-gray-400 hover:underline px-1">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(doc.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {isParent && (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <UploadIcon className="w-4 h-4" />
            Upload document
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp" />
        </>
      )}

      {/* Upload metadata sheet */}
      <BottomSheet open={!!pendingFile} onClose={() => setPendingFile(null)} title="Upload document">
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setUploadCat(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    uploadCat === c.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400">A notice will be posted on the notice board to let the other parent know.</p>

          {pendingFile && (
            <p className="text-xs text-gray-400">{pendingFile.name} · {formatBytes(pendingFile.size)}</p>
          )}
          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
          <Button className="w-full py-3" loading={uploading} disabled={!uploadTitle.trim()} onClick={confirmUpload}>
            Upload
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
        active ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

function DocTypeIcon({ mime, className }) {
  if (mime?.startsWith('image/')) return <ImageIcon className={className} />
  if (mime === 'application/pdf') return <PdfIcon className={className} />
  return <FileIcon className={className} />
}

function FileIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function PdfIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function ImageIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
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

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function UploadIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}
