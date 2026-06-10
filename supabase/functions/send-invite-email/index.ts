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
  const appOrigin = new URL(inviteLink).origin

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">

        <tr><td style="background:#1b4332;padding:28px 40px;text-align:center;">
          <img src="${appOrigin}/logo.png" alt="Canopy" height="44" style="height:44px;width:auto;display:inline-block;" />
        </td></tr>

        <tr><td style="padding:36px 40px 28px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">You've been invited to Canopy</h1>
          <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">${senderName} has invited you to join as ${roleLabel}.</p>
          <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.7;">Canopy is a private co-parenting app for managing shared schedules, notices, and family events.</p>

          <div style="text-align:center;margin-bottom:32px;">
            <a href="${inviteLink}" style="display:inline-block;background:#1b4332;color:#ffffff;font-weight:600;font-size:15px;padding:14px 40px;border-radius:12px;text-decoration:none;">Accept invitation</a>
          </div>

          <div style="background:#f4fbf4;border:1px solid #d8f3dc;border-radius:14px;padding:20px;text-align:center;">
            <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">Or enter this code manually when prompted:</p>
            <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#1b4332;">${inviteCode}</p>
          </div>
        </td></tr>

        <tr><td style="padding:20px 40px 28px;border-top:1px solid #d8f3dc;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">This invite expires in 7 days. If you weren't expecting this, you can safely ignore it.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
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
