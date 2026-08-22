// Canopy — Supabase Edge Function: check-schedule-change-requests
//
// Same pattern as check-schedule-proposals / check-viewer-permission-proposals,
// applied to the third feature requiring Parent B's authorization that the
// original audit missed: ad-hoc "Request a change" schedule_changes rows.
// Runs hourly. For every pending row with an expires_at set:
//   - past its 7-day deadline -> auto-apply (status='accepted'), log a
//     system notice post, push-notify the requester
//   - 2 days or less remaining, reminder not yet sent -> email the parent
//     who hasn't responded
//   - 1 day or less remaining, reminder not yet sent  -> same, second email
//
// request_schedule_change() sets status='accepted' immediately (no expiry
// at all) when there's no Parent B yet, so this function has nothing to do
// for those rows -- same as the other two features.
//
// ── Mode ─────────────────────────────────────────────────────────────────────
//   Cron only: x-webhook-token header = SCHEDULE_CHANGE_REQUEST_WEBHOOK_TOKEN
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   SCHEDULE_CHANGE_REQUEST_WEBHOOK_TOKEN, RESEND_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy check-schedule-change-requests --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, serviceRoleKey)

const APP_ORIGIN = 'https://my.canopy-app.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const webhookToken  = Deno.env.get('SCHEDULE_CHANGE_REQUEST_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  if (!webhookToken || incomingToken !== webhookToken) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const { data: rows } = await supabase
    .from('schedule_changes')
    .select('*')
    .eq('status', 'pending')
    .not('expires_at', 'is', null)

  const results: any[] = []
  for (const row of rows ?? []) {
    try {
      const result = await processRow(row)
      if (result) results.push({ id: row.id, ...result })
    } catch (e: any) {
      console.error(`Schedule change request ${row.id} failed:`, e?.message)
      results.push({ id: row.id, error: e?.message })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function processRow(row: any) {
  const now = new Date()
  const expiresAt = new Date(row.expires_at)
  const msRemaining = expiresAt.getTime() - now.getTime()

  if (msRemaining <= 0) {
    await autoApply(row)
    return { action: 'auto_applied' }
  }

  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24)

  if (daysRemaining <= 1 && !row.reminder_1d_sent_at) {
    await sendReminder(row, 1)
    return { action: 'reminder_1d' }
  }
  if (daysRemaining <= 2 && !row.reminder_2d_sent_at) {
    await sendReminder(row, 2)
    return { action: 'reminder_2d' }
  }
  return null
}

async function autoApply(row: any) {
  await supabase
    .from('schedule_changes')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', row.id)

  const members = await getMembers(row.family_id)
  const requester = members.find((m) => m.user_id === row.requested_by)
  const requesterName = requester?.display_name ?? (row.requester_role === 'parent_a' ? 'Parent A' : 'A parent')
  const dateLabel = row.start_date === row.end_date ? row.start_date : `${row.start_date} to ${row.end_date}`

  await supabase.from('notice_posts').insert({
    family_id: row.family_id,
    author_id: null,
    tag:       'notification',
    content:   `⏰ ${requesterName}'s ${row.is_holiday ? 'holiday' : 'schedule change'} request (${dateLabel}) was automatically applied — no response within 7 days.`,
  })

  if (requester) {
    await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
      body: {
        family_id:      row.family_id,
        recipient_role: requester.role,
        title:          'Schedule change applied',
        body:           `Your ${row.is_holiday ? 'holiday' : 'schedule change'} request for ${dateLabel} was automatically applied after 7 days with no response.`,
        url:            '/calendar',
      },
    })
  }
}

async function sendReminder(row: any, daysLeft: 1 | 2) {
  const members = await getMembers(row.family_id)
  const requester = members.find((m) => m.user_id === row.requested_by)
  const recipient = members.find((m) => (m.role === 'parent_a' || m.role === 'parent_b') && m.user_id !== row.requested_by)
  if (!recipient) return

  const { data: userData } = await supabase.auth.admin.getUserById(recipient.user_id)
  const email = userData?.user?.email
  if (!email) return

  const requesterName = requester?.display_name ?? 'The other parent'
  const dayWord = daysLeft === 1 ? '1 day' : '2 days'
  const dateLabel = row.start_date === row.end_date ? row.start_date : `${row.start_date} to ${row.end_date}`
  const kind = row.is_holiday ? 'holiday request' : 'schedule change request'

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4fbf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4fbf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #d8f3dc;">

        <tr><td style="background:#ffffff;padding:32px 40px 20px;text-align:center;border-bottom:3px solid #1b4332;">
          <img src="${APP_ORIGIN}/logo.png" alt="Canopy" height="48" style="height:48px;width:auto;display:inline-block;" />
          <p style="margin:10px 0 0;color:#6b7280;font-size:13px;">Share what matters.</p>
        </td></tr>

        <tr><td style="padding:36px 40px 28px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${dayWord} left to respond</h1>
          <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">${requesterName} sent a ${kind} for ${dateLabel}.</p>
          ${row.note ? `<p style="margin:0 0 20px;color:#6b7280;font-size:13px;line-height:1.7;font-style:italic;">"${row.note}"</p>` : ''}
          <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.7;">If you don't respond within ${dayWord}, this request will be automatically accepted.</p>

          <div style="text-align:center;margin-bottom:8px;">
            <a href="${APP_ORIGIN}/requests" style="display:inline-block;background:#1b4332;color:#ffffff;font-weight:600;font-size:15px;padding:14px 40px;border-radius:12px;text-decoration:none;">Review the request</a>
          </div>
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
      from:    'Canopy <noreply@canopy-app.app>',
      to:      [email],
      subject: `${dayWord} left to respond to a ${kind}`,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
    return
  }

  const key = daysLeft === 1 ? 'reminder_1d_sent_at' : 'reminder_2d_sent_at'
  await supabase.from('schedule_changes').update({ [key]: new Date().toISOString() }).eq('id', row.id)
}

async function getMembers(familyId: string) {
  const { data } = await supabase
    .from('family_members')
    .select('user_id, role, display_name')
    .eq('family_id', familyId)
  return data ?? []
}
