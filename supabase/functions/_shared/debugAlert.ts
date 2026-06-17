// Sends a debug alert email to debug@canopy-app.app via Resend.
// Call from any edge function catch block — swallows its own errors.

const ALERT_TO   = 'debug@canopy-app.app'
const ALERT_FROM = 'Canopy Alerts <noreply@canopy-app.app>'

const REDACTED_KEYS = new Set([
  'password', 'token', 'secret', 'key', 'authorization',
  'supabase_service_role_key', 'anthropic_api_key', 'resend_api_key',
  'email_webhook_token',
])

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value
  if (typeof value === 'string' && value.length > 4000) return value.slice(0, 4000) + '…'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

export async function sendDebugAlert(opts: {
  functionName: string
  error: unknown
  input?: Record<string, unknown>
  context?: Record<string, unknown>
}): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return

  const { functionName, error, input, context } = opts

  const errorText = error instanceof Error
    ? `${error.message}\n\n${error.stack ?? ''}`
    : JSON.stringify(error, null, 2)

  const pre = (label: string, data: unknown) => `
    <h3 style="margin:16px 0 6px;font-size:13px;color:#374151;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${label}</h3>
    <pre style="background:#f3f4f6;border-radius:8px;padding:12px;font-size:12px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${JSON.stringify(data, null, 2)}</pre>`

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;max-width:700px;margin:0 auto;padding:20px;">
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
      <strong style="color:#dc2626;">Error in ${functionName}</strong>
      <span style="color:#6b7280;font-size:12px;margin-left:12px;">${new Date().toISOString()}</span>
    </div>
    ${pre('Error', errorText)}
    ${input  ? pre('Input',   redact(input))   : ''}
    ${context ? pre('Context', redact(context)) : ''}
  </body></html>`

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [ALERT_TO],
        subject: `[Canopy Error] ${functionName} — ${new Date().toISOString()}`,
        html,
      }),
    })
  } catch {
    // Never let alert failure propagate
  }
}
