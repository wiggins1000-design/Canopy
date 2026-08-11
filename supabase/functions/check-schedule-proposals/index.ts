// Canopy — Supabase Edge Function: check-schedule-proposals
//
// Runs hourly. For every family with a pending parenting-schedule proposal
// (baseline_schedules.pending_proposed_by is not null):
//   - past its 7-day deadline (pending_expires_at)  -> auto-apply, log a
//     system notice post, push-notify the proposer
//   - 2 days or less remaining, reminder not yet sent -> email the parent
//     who hasn't responded
//   - 1 day or less remaining, reminder not yet sent  -> same, second email
//
// See the "085_schedule_proposal_deadline" plan/migration for the full
// design — this only exists for families where Parent B has actually
// joined; propose_schedule_change() applies immediately (no pending state
// at all) when there's no Parent B yet, so this function has nothing to do
// for those families.
//
// ── Mode ─────────────────────────────────────────────────────────────────────
//   Cron only: x-webhook-token header = SCHEDULE_PROPOSAL_WEBHOOK_TOKEN
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   SCHEDULE_PROPOSAL_WEBHOOK_TOKEN, RESEND_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy check-schedule-proposals --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, serviceRoleKey)

const APP_ORIGIN = 'https://my.canopy-app.app'

// Ported from src/lib/scheduleEngine.js's PATTERN_LABELS -- Deno edge
// functions can't import the browser bundle. Keep in sync if that changes.
const PATTERN_LABELS: Record<string, string> = {
  alternating_weeks: 'Alternating weeks (7–7)',
  '2_2_5_5':         '2‑2‑5‑5',
  '2_2_3':           '2‑2‑3',
  '3_4_4_3':         '3‑4‑4‑3',
  custom:            'Custom',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const webhookToken  = Deno.env.get('SCHEDULE_PROPOSAL_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  if (!webhookToken || incomingToken !== webhookToken) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const { data: pending } = await supabase
    .from('baseline_schedules')
    .select('*')
    .not('pending_proposed_by', 'is', null)

  const results: any[] = []
  for (const row of pending ?? []) {
    try {
      const result = await processProposal(row)
      if (result) results.push({ familyId: row.family_id, ...result })
    } catch (e: any) {
      console.error(`Family ${row.family_id} schedule proposal failed:`, e?.message)
      results.push({ familyId: row.family_id, error: e?.message })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function processProposal(row: any) {
  const now = new Date()
  const expiresAt = new Date(row.pending_expires_at)
  const msRemaining = expiresAt.getTime() - now.getTime()

  if (msRemaining <= 0) {
    await autoApply(row)
    return { action: 'auto_applied' }
  }

  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24)

  if (daysRemaining <= 1 && !row.pending_reminder_1d_sent_at) {
    await sendReminder(row, 1)
    return { action: 'reminder_1d' }
  }
  if (daysRemaining <= 2 && !row.pending_reminder_2d_sent_at) {
    await sendReminder(row, 2)
    return { action: 'reminder_2d' }
  }
  return null
}

async function autoApply(row: any) {
  await supabase.from('baseline_schedules').update({
    pattern_type:    row.pending_pattern_type,
    pattern_data:    row.pending_pattern_data,
    start_date:      row.pending_start_date,
    starting_parent: row.pending_starting_parent,
    updated_at:      new Date().toISOString(),
    pending_pattern_type:        null,
    pending_pattern_data:        null,
    pending_start_date:          null,
    pending_starting_parent:     null,
    pending_proposed_by:         null,
    pending_proposed_at:         null,
    pending_expires_at:          null,
    pending_reminder_2d_sent_at: null,
    pending_reminder_1d_sent_at: null,
  }).eq('family_id', row.family_id)

  const members = await getMembers(row.family_id)
  const proposer = members.find((m) => m.user_id === row.pending_proposed_by)
  const proposerName = proposer?.display_name ?? 'A parent'
  const patternLabel = PATTERN_LABELS[row.pending_pattern_type] ?? row.pending_pattern_type

  // System log post -- author_id null, tag 'notification' (both already
  // valid per migrations 009/016), visible to both parents in Notices.
  await supabase.from('notice_posts').insert({
    family_id: row.family_id,
    author_id: null,
    tag:       'notification',
    content:   `⏰ ${proposerName}'s proposed parenting schedule (${patternLabel}, from ${row.pending_start_date}) was automatically applied — no response within 7 days.`,
  })

  if (proposer) {
    await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
      body: {
        family_id:      row.family_id,
        recipient_role: proposer.role,
        title:          'Schedule change applied',
        body:           'Your proposed parenting schedule was automatically applied after 7 days with no response.',
        url:            '/calendar',
      },
    })
  }
}

async function sendReminder(row: any, daysLeft: 1 | 2) {
  const members = await getMembers(row.family_id)
  const proposer  = members.find((m) => m.user_id === row.pending_proposed_by)
  const recipient = members.find((m) => (m.role === 'parent_a' || m.role === 'parent_b') && m.user_id !== row.pending_proposed_by)
  if (!recipient) return

  const { data: userData } = await supabase.auth.admin.getUserById(recipient.user_id)
  const email = userData?.user?.email
  if (!email) return

  const proposerName = proposer?.display_name ?? 'The other parent'
  const patternLabel = PATTERN_LABELS[row.pending_pattern_type] ?? row.pending_pattern_type
  const dayWord = daysLeft === 1 ? '1 day' : '2 days'

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
          <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">${proposerName} proposed a new parenting schedule (${patternLabel}, starting ${row.pending_start_date}).</p>
          <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.7;">If you don't respond within ${dayWord}, this change will be applied automatically.</p>

          <div style="text-align:center;margin-bottom:8px;">
            <a href="${APP_ORIGIN}/config?tab=schedule" style="display:inline-block;background:#1b4332;color:#ffffff;font-weight:600;font-size:15px;padding:14px 40px;border-radius:12px;text-decoration:none;">Review the change</a>
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
      subject: `${dayWord} left to respond to a parenting schedule change`,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
    return
  }

  const column = daysLeft === 1 ? 'pending_reminder_1d_sent_at' : 'pending_reminder_2d_sent_at'
  await supabase.from('baseline_schedules')
    .update({ [column]: new Date().toISOString() })
    .eq('family_id', row.family_id)
}

async function getMembers(familyId: string) {
  const { data } = await supabase
    .from('family_members')
    .select('user_id, role, display_name')
    .eq('family_id', familyId)
  return data ?? []
}
