import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const SEGMENTS = [
  { id: 'all',          label: 'All users',          description: 'Every parent on Canopy' },
  { id: 'inactive_30',  label: 'Inactive 30+ days',  description: "Parents who haven't signed in for 30+ days" },
  { id: 'locale_en-GB', label: '🇬🇧 UK users',        description: 'Parents with region set to United Kingdom' },
  { id: 'locale_en-AU', label: '🇦🇺 Australia users', description: 'Parents with region set to Australia' },
  { id: 'locale_en-IE', label: '🇮🇪 Ireland users',   description: 'Parents with region set to Ireland' },
  { id: 'locale_en-US', label: '🇺🇸 US users',        description: 'Parents with region set to United States' },
  { id: 'locale_en-NZ', label: '🇳🇿 New Zealand users', description: 'Parents with region set to New Zealand' },
]

export default function AdminBroadcastPage() {
  const [segment, setSegment]               = useState('all')
  const [subject, setSubject]               = useState('')
  const [body, setBody]                     = useState('')
  const [recipientCount, setRecipientCount] = useState(null)
  const [countLoading, setCountLoading]     = useState(false)
  const [sending, setSending]               = useState(false)
  const [result, setResult]                 = useState(null)
  const [error, setError]                   = useState(null)
  const [showConfirm, setShowConfirm]       = useState(false)

  useEffect(() => { previewCount() }, [segment])

  async function previewCount() {
    setCountLoading(true)
    setRecipientCount(null)
    const { data } = await supabase.rpc('admin_get_broadcast_recipients', { p_segment: segment })
    setRecipientCount(data?.length ?? 0)
    setCountLoading(false)
  }

  async function send() {
    setSending(true)
    setError(null)
    setResult(null)
    setShowConfirm(false)

    const bodyHtml = plainTextToHtml(body)

    const { data, error: fnErr } = await supabase.functions.invoke('admin-broadcast', {
      body: { segment, subject, body_html: bodyHtml },
    })

    if (fnErr) { setError(fnErr.message); setSending(false); return }

    setResult(data)
    setSending(false)
    setSubject('')
    setBody('')
  }

  const canSend = subject.trim() && body.trim() && !sending

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Email Broadcast</h1>
        <p className="text-slate-400 text-sm mt-1">Send an email to a segment of Canopy users via Resend.</p>
      </div>

      {result && (
        <div className="bg-green-900/30 border border-green-700/50 rounded-2xl px-4 py-3 text-sm text-green-300">
          Sent to {result.sent} recipient{result.sent !== 1 ? 's' : ''}.
          {result.failed > 0 && <span className="text-red-400 ml-2">{result.failed} failed.</span>}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-2xl px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* Segment */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Segment</label>
          <div className="space-y-2">
            {SEGMENTS.map((s) => (
              <label
                key={s.id}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                  segment === s.id
                    ? 'border-canopy-green/50 bg-canopy-mid/10'
                    : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="segment"
                  value={s.id}
                  checked={segment === s.id}
                  onChange={() => setSegment(s.id)}
                  className="mt-0.5 accent-canopy-green"
                />
                <div>
                  <p className="text-sm font-medium text-white">{s.label}</p>
                  <p className="text-xs text-slate-400">{s.description}</p>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {countLoading
              ? 'Counting…'
              : recipientCount !== null
                ? `${recipientCount} recipient${recipientCount !== 1 ? 's' : ''} in this segment`
                : ''}
          </p>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. An update from Canopy"
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
            Message body
            <span className="normal-case font-normal text-slate-500 ml-2">(plain text — blank lines become paragraph breaks)</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder={"Hi there,\n\nWe've been working on something new…"}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-canopy-green resize-y font-mono"
          />
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          disabled={!canSend}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-canopy-mid text-white hover:bg-canopy-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : `Send to ${recipientCount ?? '…'} recipient${recipientCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-sm space-y-4">
            <h2 className="text-white font-bold text-lg">Confirm broadcast</h2>
            <p className="text-slate-400 text-sm">
              This will send <span className="text-white font-medium">"{subject}"</span> to{' '}
              <span className="text-white font-medium">{recipientCount} user{recipientCount !== 1 ? 's' : ''}</span>.
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={send}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-canopy-mid text-white hover:bg-canopy-deep transition-colors"
              >
                Send now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function plainTextToHtml(text) {
  const appOrigin = window.location.origin.replace('/admin/broadcast', '')
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const paragraphs = escaped
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">

        <tr><td style="background:#ffffff;padding:32px 40px 20px;text-align:center;border-bottom:3px solid #1b4332;">
          <img src="${appOrigin}/logo.png" alt="Canopy" height="48" style="height:48px;width:auto;display:inline-block;" />
          <p style="margin:10px 0 0;color:#6b7280;font-size:13px;">Share what matters.</p>
        </td></tr>

        <tr><td style="padding:36px 40px 28px;">
          ${paragraphs}
        </td></tr>

        <tr><td style="padding:20px 40px 28px;border-top:1px solid #d8f3dc;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
            You're receiving this because you have a Canopy account.<br>
            Canopy · <a href="https://canopy-app.app" style="color:#9ca3af;">canopy-app.app</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
