import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { formatDate } from '../lib/scheduleEngine'
import Button from '../components/ui/Button'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

const SECTION_OPTIONS = [
  { id: 'changes', label: 'Schedule changes & holiday requests', desc: 'Full history of all requested and approved changes' },
  { id: 'posts',   label: 'Notice board posts',                  desc: 'All messages between parents in the notice board' },
  { id: 'events',  label: 'Calendar events',                     desc: 'All family and school events on the calendar' },
]

export default function ExportPage() {
  const navigate = useNavigate()
  const { isParent } = useFamily()
  const isIOS     = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent), [])
  const isAndroid = useMemo(() => /android/i.test(navigator.userAgent), [])
  const [sections, setSections] = useState(['changes', 'posts', 'events'])
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState(formatDate(new Date()))
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  function toggleSection(id) {
    setSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  async function generate() {
    if (sections.length === 0) { setError('Select at least one section.'); return }
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/export-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        SUPABASE_ANON,
        },
        body: JSON.stringify({
          sections,
          from_date: fromDate || null,
          to_date:   toDate   || null,
        }),
      })

      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Export failed')

      // Open HTML in a new window — user can File > Print > Save as PDF
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(json.html)
        win.document.close()
        setTimeout(() => win.print(), 500)
      } else {
        // Fallback: download as .html file
        const blob = new Blob([json.html], { type: 'text/html' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `canopy-export-${formatDate(new Date())}.html`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      setError(e.message ?? 'Export failed')
    }
    setLoading(false)
  }

  if (!isParent) {
    return (
      <div className="px-4 py-8 text-center text-gray-400">
        <p className="text-sm">Only parents can export records.</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900">Export records</h1>
        </div>
        <p className="text-sm text-gray-500 mt-1 ml-10">
          Generate a court-ready PDF of your family's communication and scheduling history.
        </p>
      </div>

      {/* Date range */}
      <section className="space-y-3">
        <label className="text-sm font-semibold text-gray-700 block">Date range</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">Leave "From" blank to include all records up to the "To" date.</p>
      </section>

      {/* Sections */}
      <section className="space-y-3">
        <label className="text-sm font-semibold text-gray-700 block">Include in export</label>
        {SECTION_OPTIONS.map((opt) => (
          <label key={opt.id} className={`flex items-start gap-3 border-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${sections.includes(opt.id) ? 'border-canopy-green bg-canopy-frost' : 'border-gray-200 bg-white'}`}>
            <input
              type="checkbox"
              checked={sections.includes(opt.id)}
              onChange={() => toggleSection(opt.id)}
              className="accent-canopy-mid w-4 h-4 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
            </div>
          </label>
        ))}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button className="w-full py-3" loading={loading} disabled={sections.length === 0} onClick={generate}>
        Generate PDF export
      </Button>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-xs text-amber-700">
          {isIOS
            ? <>The export opens in a new tab. Tap the <strong>Share button</strong> (the box with an arrow) then choose <strong>Print</strong> or <strong>Save to Files</strong> to keep a copy.</>
            : isAndroid
            ? <>The export opens in a new tab. Tap the <strong>menu (⋮)</strong> in your browser then choose <strong>Share</strong> or <strong>Print</strong> to save as PDF.</>
            : <>The export opens in a new tab. Use your browser's <strong>Print</strong> function (Ctrl+P / Cmd+P) and choose <strong>Save as PDF</strong>.</>
          }
        </p>
      </div>
    </div>
  )
}
