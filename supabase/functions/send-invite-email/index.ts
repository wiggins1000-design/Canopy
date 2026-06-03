// Canopy — Supabase Edge Function: send-invite-email
// Sends a family invite email via Resend.
// Secrets required: RESEND_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!req.headers.get('Authorization')) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const { recipientEmail, inviteCode, inviteLink, role, senderName } = await req.json()

  if (!recipientEmail || !inviteCode || !inviteLink) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS })
  }

  const roleLabel = role === 'parent_b' ? 'the other parent' : 'a read-only member'

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;color:#111;background:#fff;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="display:inline-block;width:56px;height:56px;background:#2563eb;border-radius:16px;font-size:28px;line-height:56px;margin-bottom:16px;">🌿</div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">You've been invited to Canopy</h1>
    <p style="color:#666;margin:0;font-size:15px;">${senderName} has invited you to join as ${roleLabel}.</p>
  </div>

  <p style="color:#555;line-height:1.7;font-size:14px;">
    Canopy is a private co-parenting app for managing shared schedules, notices, and family events.
  </p>

  <div style="text-align:center;margin:32px 0;">
    <a href="${inviteLink}"
       style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
      Accept invitation
    </a>
  </div>

  <p style="color:#999;font-size:13px;text-align:center;margin-bottom:4px;">Or enter this code manually when prompted:</p>
  <p style="text-align:center;font-family:monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#111;margin:4px 0 32px;">
    ${inviteCode}
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin-bottom:24px;" />
  <p style="color:#bbb;font-size:12px;text-align:center;margin:0;">
    This invite expires in 7 days. If you weren't expecting this, you can safely ignore it.
  </p>
</body>
</html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Canopy <noreply@mycanopymail.com>',
      to: [recipientEmail],
      subject: `${senderName} invited you to join Canopy`,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 502, headers: CORS })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
})
