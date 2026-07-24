import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { firstName } from '../lib/childUtils'
import Button from '../components/ui/Button'
import { PENDING_SHARE_KEY } from '../native/canopyShare'

function newDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// A hung extraction call used to leave this page spinning forever with no
// way out and no signal of what stalled. Race against a timeout so a stall
// becomes a visible, retryable error instead.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function formatDraftLabel(d) {
  return d.date ? `${d.title.trim()} (${d.date})` : d.title.trim()
}

export default function AddFromSharePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { family } = useFamily()
  const children = (family?.config?.children ?? []).filter((c) => c.name)

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [drafts, setDrafts]     = useState([])
  const [saving, setSaving]     = useState(false)
  const [savedLabels, setSavedLabels] = useState([])
  // undefined = not read yet, null = read but nothing was there. Kept in state
  // (rather than only reading sessionStorage once inline) so "Try again" after
  // a timeout can re-run the same extraction instead of hitting the now-empty
  // sessionStorage key a second time. Always an array -- sharing several
  // things before the app is next opened queues them natively rather than
  // the last one overwriting the rest.
  const [sharePayloads, setSharePayloads] = useState(undefined)

  useEffect(() => {
    // Dev-only seam (see plan step 1): lets this page be tested from a normal
    // browser dev server via /add-from-share?debugText=... before any native
    // plugin exists. Real shares arrive via sessionStorage (see PENDING_SHARE_KEY).
    const debugText = searchParams.get('debugText')
    if (debugText) {
      setSharePayloads([{ type: 'text', text: debugText }])
      return
    }
    const raw = sessionStorage.getItem(PENDING_SHARE_KEY)
    sessionStorage.removeItem(PENDING_SHARE_KEY)
    if (!raw) { setSharePayloads(null); return }
    try {
      const parsed = JSON.parse(raw)
      const asArray = Array.isArray(parsed) ? parsed : [parsed] // tolerate an old single-object shape too
      setSharePayloads(asArray.length > 0 ? asArray : null)
    } catch { setSharePayloads(null) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sharePayloads === undefined) return
    if (sharePayloads === null) {
      setError('No shared content found.')
      setLoading(false)
      return
    }
    runExtraction(sharePayloads)
  }, [sharePayloads]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runExtraction(payloads) {
    setLoading(true)
    setError(null)

    const allEvents = []
    let anyFailure = false
    let lastMessage = null

    for (const payload of payloads) {
      const body =
        payload.type === 'text'  ? { type: 'text', text: payload.text } :
        payload.type === 'pdf'   ? { type: 'pdf', pdf_base64: payload.base64 } :
        payload.type === 'image' ? { type: 'image', image_base64: payload.base64, media_type: payload.mediaType } :
        null

      if (!body) { anyFailure = true; lastMessage = 'Unrecognised shared content.'; continue }

      let result
      try {
        result = await withTimeout(
          supabase.functions.invoke('extract-event-from-share', { body }),
          20000,
          'Finding dates'
        )
      } catch (timeoutErr) {
        anyFailure = true
        lastMessage = `${timeoutErr.message} — check your connection and try again.`
        continue
      }
      const { data, error: fnError } = result

      if (fnError || !data?.ok) {
        // On a non-2xx response, supabase-js routes the error into fnError
        // (a FunctionsHttpError whose own .message is just a generic "non-2xx
        // status code" string) rather than into data -- the actual JSON body
        // this edge function returned (with the real error message) is only
        // reachable via fnError.context, the raw Response object.
        let message = data?.error
        if (!message && fnError?.context) {
          try { message = (await fnError.context.json())?.error } catch { /* body already consumed or not JSON */ }
        }
        anyFailure = true
        lastMessage = message || 'Could not extract event details from what was shared.'
        continue
      }

      allEvents.push(...(data.events ?? []))
    }

    const parsed = allEvents.map((ev) => {
      // Only trust child names the extraction returned that actually match
      // a real child on file — same defensive filter NewEventSheet.jsx
      // applies to its own extraction results.
      const matchedChildren = Array.isArray(ev.tagged_children)
        ? ev.tagged_children.filter((n) => children.some((c) => c.name === n))
        : []
      return {
        id:             newDraftId(),
        included:       true,
        title:          ev.title ?? '',
        date:           ev.date ?? '',
        end_date:       ev.end_date ?? '',
        time:           ev.time ?? '',
        notes:          ev.notes ?? '',
        tagged_children: matchedChildren,
      }
    })

    // Anything with both a title and a date is unambiguous enough to add
    // straight away, no confirmation tap needed -- this is the common case
    // (WhatsApp shares are usually one clear event). Anything missing either
    // still goes through the editable review screen below rather than being
    // silently dropped or saved with garbage data.
    const complete = parsed.filter((d) => d.title.trim() && d.date)
    const incomplete = parsed.filter((d) => !(d.title.trim() && d.date))

    setLoading(false)
    if (parsed.length === 0 && anyFailure) setError(lastMessage)
    // Save the complete ones before deciding what stays on the review screen --
    // anything that fails to save (a real DB error, not just "incomplete") goes
    // back into drafts for retry instead of being silently lost.
    const failed = complete.length > 0 ? await saveEvents(complete) : []
    setDrafts([...incomplete, ...failed])
  }

  // Returns whichever of `toAdd` failed to save (empty array if all succeeded),
  // so the caller can decide whether to keep them around for the user to retry
  // rather than just disappearing without being added.
  async function saveEvents(toAdd) {
    setSaving(true)
    setError(null)
    const added = []
    const failed = []

    for (const d of toAdd) {
      const { error: dbErr } = await supabase.rpc('create_family_event', {
        p_family_id:       family.id,
        p_title:           d.title.trim(),
        p_event_date:      d.date,
        p_end_date:        d.end_date || null,
        p_event_time:      d.time || null,
        p_end_time:        null,
        p_notes:           d.notes.trim() || null,
        p_source:          'manual',
        p_recurrence:      null,
        p_recurrence_end:  null,
        p_tagged_children: d.tagged_children.length > 0 ? d.tagged_children : null,
      })
      if (dbErr) {
        console.error('create_family_event error:', dbErr)
        failed.push(d)
        continue
      }
      added.push(formatDraftLabel(d))
    }

    setSaving(false)
    setSavedLabels((prev) => [...prev, ...added])
    if (added.length === 0 && toAdd.length > 0) {
      setError('Could not add those events — please try again.')
    }
    return failed
  }

  function updateDraft(id, field, value) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)))
  }

  function toggleChild(id, childName) {
    setDrafts((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const has = d.tagged_children.includes(childName)
      return { ...d, tagged_children: has ? d.tagged_children.filter((n) => n !== childName) : [...d.tagged_children, childName] }
    }))
  }

  async function addSelected() {
    const toAdd = drafts.filter((d) => d.included && d.title.trim() && d.date)
    if (toAdd.length === 0) { setError('Nothing selected to add.'); return }
    const failed = await saveEvents(toAdd)
    // Drop whichever of toAdd actually saved -- keep anything that failed (for
    // retry) and anything not in toAdd at all (excluded, or still missing a
    // field) exactly as it was.
    const failedIds = new Set(failed.map((d) => d.id))
    const attemptedIds = new Set(toAdd.map((d) => d.id))
    setDrafts((prev) => prev.filter((d) => !attemptedIds.has(d.id) || failedIds.has(d.id)))
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Add from share</h1>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-canopy-mid bg-gray-50 rounded-xl px-3 py-2.5">
          <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin shrink-0" />
          Finding dates…
        </div>
      )}

      {!loading && saving && savedLabels.length === 0 && drafts.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-canopy-mid bg-gray-50 rounded-xl px-3 py-2.5">
          <div className="w-4 h-4 border-2 border-canopy-mid border-t-transparent rounded-full animate-spin shrink-0" />
          Adding to your calendar…
        </div>
      )}

      {!loading && error && drafts.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          {sharePayloads && (
            <Button className="w-full py-3" onClick={() => runExtraction(sharePayloads)}>
              Try again
            </Button>
          )}
          <Button variant="secondary" className="w-full py-3" onClick={() => navigate('/calendar')}>
            Back to calendar
          </Button>
        </div>
      )}

      {!loading && savedLabels.length > 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 space-y-1">
          <p className="text-sm text-green-700 font-medium">
            ✓ Added {savedLabels.length} event{savedLabels.length !== 1 ? 's' : ''}
            {drafts.length > 0 && ' — a few more need details below:'}
          </p>
          <ul className="text-sm text-green-700 list-disc list-inside">
            {savedLabels.map((label, i) => <li key={i}>{label}</li>)}
          </ul>
        </div>
      )}

      {!loading && !saving && savedLabels.length > 0 && drafts.length === 0 && (
        <Button className="w-full py-3" onClick={() => navigate('/calendar')}>
          Close
        </Button>
      )}

      {!loading && drafts.length > 0 && (
        <div className="space-y-4">
          {drafts.map((d) => (
            <div key={d.id} className={`bg-white border rounded-2xl p-4 space-y-3 ${d.included ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={d.included}
                    onChange={(e) => updateDraft(d.id, 'included', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-canopy-mid focus:ring-canopy-green"
                  />
                  Include this event
                </label>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
                <input
                  type="text"
                  value={d.title}
                  onChange={(e) => updateDraft(d.id, 'title', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date</label>
                  <input
                    type="date"
                    value={d.date}
                    onChange={(e) => updateDraft(d.id, 'date', e.target.value)}
                    className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                    Time <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="time"
                    value={d.time}
                    onChange={(e) => updateDraft(d.id, 'time', e.target.value)}
                    className="w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
                  />
                </div>
              </div>

              {children.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                    For <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <div className="flex gap-1.5 flex-wrap">
                    {children.map((c) => {
                      const selected = d.tagged_children.includes(c.name)
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => toggleChild(d.id, c.name)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                            selected
                              ? 'bg-canopy-mid text-white border-canopy-mid'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-canopy-green'
                          }`}
                        >
                          {firstName(c.name)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                  Notes <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={d.notes}
                  onChange={(e) => updateDraft(d.id, 'notes', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-canopy-green"
                />
              </div>
            </div>
          ))}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button className="w-full py-3" loading={saving} onClick={addSelected}>
            Add {drafts.filter((d) => d.included).length} event{drafts.filter((d) => d.included).length !== 1 ? 's' : ''}
          </Button>
        </div>
      )}

      {!loading && !saving && drafts.length === 0 && !error && savedLabels.length === 0 && (
        <div className="space-y-3 text-center py-8">
          <p className="text-sm text-gray-500">No dates found in what was shared.</p>
          <Button variant="secondary" className="mx-auto" onClick={() => navigate('/calendar')}>
            Add manually instead
          </Button>
        </div>
      )}
    </div>
  )
}
