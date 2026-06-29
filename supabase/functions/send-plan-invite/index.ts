import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { plan_id, invite_email, p1_name, p2_name } = await req.json()

    const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey       = Deno.env.get('RESEND_API_KEY')!

    // Verify the calling user is a collaborator on this plan
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(jwt!)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: corsHeaders })
    }

    const { data: collab } = await supabaseAdmin
      .from('pp_collaborators')
      .select('id')
      .eq('plan_id', plan_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!collab) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
    }

    // Generate a magic link for the invited parent, redirecting to /join
    const redirectTo = `https://parentingplan.help/join?plan_id=${plan_id}`
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: invite_email,
      options: { redirectTo },
    })
    if (linkErr) throw linkErr

    const magicLink = linkData.properties.action_link

    // Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'parentingplan.help <noreply@canopy-app.app>',
        to: invite_email,
        subject: `${p1_name} has shared a parenting plan with you`,
        html: buildEmail(p1_name, p2_name, magicLink),
      }),
    })

    if (!emailRes.ok) {
      const body = await emailRes.text()
      throw new Error(`Resend error: ${body}`)
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

function buildEmail(p1: string, p2: string, link: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d8f3dc">
        <tr>
          <td style="background:#1b4332;padding:24px 32px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:28px;height:28px;background:#52b788;border-radius:8px;text-align:center;vertical-align:middle">
                  <span style="color:#1b4332;font-weight:700;font-size:12px">C</span>
                </td>
                <td style="padding-left:10px;color:#ffffff;font-weight:600;font-size:14px">parentingplan.help</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1b4332">${p1} has shared a parenting plan with you</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6">
              ${p1} has used parentingplan.help to create a parenting plan and would like you to review it.
              You can read the plan and suggest changes to any section — it's free for you to join.
            </p>
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="${link}"
                     style="display:inline-block;background:#1b4332;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 32px;border-radius:12px">
                    Open the parenting plan →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center">
              This link is personal to you and expires in 24 hours.<br>
              If you weren't expecting this, you can ignore it safely.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
