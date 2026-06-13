// Canopy — send-2fa-code
// Generates a 6-digit code, stores a SHA-256 hash, and emails the plaintext code to the authenticated user.
// Secrets required: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: CORS })

  const supabaseUrl      = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey          = Deno.env.get('SUPABASE_ANON_KEY')!
  const resendKey        = Deno.env.get('RESEND_API_KEY')!

  // Verify JWT and get user identity
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const serviceClient = createClient(supabaseUrl, serviceRoleKey)

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000))

  // SHA-256 hash
  const encoded = new TextEncoder().encode(code)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const codeHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Remove any existing unused codes for this user
  await serviceClient
    .from('two_factor_codes')
    .delete()
    .eq('user_id', user.id)
    .eq('used', false)

  // Store new code — expires in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { error: insertError } = await serviceClient.from('two_factor_codes').insert({
    user_id:    user.id,
    code_hash:  codeHash,
    expires_at: expiresAt,
  })
  if (insertError) {
    console.error('Insert error:', insertError)
    return new Response(JSON.stringify({ error: 'Failed to store code' }), { status: 500, headers: CORS })
  }

  // Send via Resend
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">
        <tr><td style="background:#ffffff;padding:28px 40px 20px;text-align:center;border-bottom:3px solid #1b4332;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1b4332;">Canopy</p>
          <p style="margin:6px 0 0;color:#6b7280;font-size:13px;">Share what matters.</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827;">Your sign-in code</h1>
          <p style="margin:0 0 28px;color:#555;font-size:15px;line-height:1.6;">Enter this code in the Canopy app to complete signing in.</p>
          <div style="background:#f4fbf4;border:2px solid #1b4332;border-radius:16px;padding:24px;text-align:center;margin-bottom:28px;">
            <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:42px;font-weight:700;letter-spacing:10px;color:#1b4332;">${code}</p>
          </div>
          <p style="margin:0;color:#9ca3af;font-size:13px;text-align:center;">This code expires in 10 minutes. If you didn't try to sign in, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Canopy <noreply@canopy-app.app>',
      to:      [user.email!],
      subject: 'Your Canopy sign-in code',
      html,
    }),
  })

  if (!emailRes.ok) {
    const err = await emailRes.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 502, headers: CORS })
  }

  return new Response(JSON.stringify({ sent: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
