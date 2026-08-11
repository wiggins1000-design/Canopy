// Canopy — Supabase Edge Function: check-viewer-permission-proposals
//
// Same pattern as check-schedule-proposals, applied to the other feature
// requiring Parent B's authorization: read-only/third-party viewer
// permissions (stored in families.config, not a dedicated table). Runs
// hourly. For every family with a pending proposal
// (config.viewer_permissions_proposed_by is set):
//   - past its 7-day deadline (config.viewer_permissions_expires_at)  ->
//     auto-apply, log a system notice post, push-notify the proposer
//   - 2 days or less remaining, reminder not yet sent -> email the parent
//     who hasn't responded
//   - 1 day or less remaining, reminder not yet sent  -> same, second email
//
// propose_viewer_permissions() applies immediately (no pending state at
// all) when there's no Parent B yet, so this function has nothing to do
// for those families -- same as the schedule feature.
//
// ── Mode ─────────────────────────────────────────────────────────────────────
//   Cron only: x-webhook-token header = VIEWER_PERMISSIONS_WEBHOOK_TOKEN
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   VIEWER_PERMISSIONS_WEBHOOK_TOKEN, RESEND_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy check-viewer-permission-proposals --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
}

const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, serviceRoleKey)

const APP_ORIGIN = 'https://my.canopy-app.app'

const PERM_LABELS: Record<string, string> = {
  calendar:    'Calendar',
  noticeboard: 'Notice Board',
  info_bank:   'Info Bank',
  schedule:    'Parenting schedule',
  messaging:   'Messages',
  expenses:    'Expenses',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const webhookToken  = Deno.env.get('VIEWER_PERMISSIONS_WEBHOOK_TOKEN')
  const incomingToken = req.headers.get('x-webhook-token')
  if (!webhookToken || incomingToken !== webhookToken) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const { data: families } = await supabase
    .from('families')
    .select('id, config')
    .not('config->viewer_permissions_proposed_by', 'is', null)

  const results: any[] = []
  for (const family of families ?? []) {
    try {
      const result = await processFamily(family)
      if (result) results.push({ familyId: family.id, ...result })
    } catch (e: any) {
      console.error(`Family ${family.id} viewer-permission proposal failed:`, e?.message)
      results.push({ familyId: family.id, error: e?.message })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function processFamily(family: { id: string; config: any }) {
  const config = family.config ?? {}
  const expiresAtStr = config.viewer_permissions_expires_at
  if (!expiresAtStr) return null

  const now = new Date()
  const expiresAt = new Date(expiresAtStr)
  const msRemaining = expiresAt.getTime() - now.getTime()

  if (msRemaining <= 0) {
    await autoApply(family.id, config)
    return { action: 'auto_applied' }
  }

  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24)

  if (daysRemaining <= 1 && !config.viewer_permissions_reminder_1d_sent_at) {
    await sendReminder(family.id, config, 1)
    return { action: 'reminder_1d' }
  }
  if (daysRemaining <= 2 && !config.viewer_permissions_reminder_2d_sent_at) {
    await sendReminder(family.id, config, 2)
    return { action: 'reminder_2d' }
  }
  return null
}

async function autoApply(familyId: string, config: any) {
  const nextConfig = {
    ...config,
    viewer_permissions:                   config.pending_viewer_permissions,
    pending_viewer_permissions:           null,
    viewer_permissions_proposed_by:       null,
    viewer_permissions_proposed_at:       null,
    viewer_permissions_expires_at:        null,
    viewer_permissions_reminder_2d_sent_at: null,
    viewer_permissions_reminder_1d_sent_at: null,
  }
  await supabase.from('families').update({ config: nextConfig }).eq('id', familyId)

  const members = await getMembers(familyId)
  const proposer = members.find((m) => m.user_id === config.viewer_permissions_proposed_by)
  const proposerName = proposer?.display_name ?? 'A parent'

  await supabase.from('notice_posts').insert({
    family_id: familyId,
    author_id: null,
    tag:       'notification',
    content:   `⏰ ${proposerName}'s proposed changes to read-only member access were automatically applied — no response within 7 days.`,
  })

  if (proposer) {
    await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
      body: {
        family_id:      familyId,
        recipient_role: proposer.role,
        title:          'Access changes applied',
        body:           'Your proposed read-only member access changes were automatically applied after 7 days with no response.',
        url:            '/config',
      },
    })
  }
}

async function sendReminder(familyId: string, config: any, daysLeft: 1 | 2) {
  const members = await getMembers(familyId)
  const proposer  = members.find((m) => m.user_id === config.viewer_permissions_proposed_by)
  const recipient = members.find((m) => (m.role === 'parent_a' || m.role === 'parent_b') && m.user_id !== config.viewer_permissions_proposed_by)
  if (!recipient) return

  const { data: userData } = await supabase.auth.admin.getUserById(recipient.user_id)
  const email = userData?.user?.email
  if (!email) return

  const proposerName = proposer?.display_name ?? 'The other parent'
  const dayWord = daysLeft === 1 ? '1 day' : '2 days'
  const pending = config.pending_viewer_permissions ?? {}
  const changedLines = Object.entries(PERM_LABELS)
    .filter(([key]) => key in pending)
    .map(([key, label]) => `${label}: ${pending[key] ? 'visible' : 'hidden'}`)
    .join(', ')

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
          <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">${proposerName} proposed changes to what read-only members (grandparents, carers) can see.</p>
          ${changedLines ? `<p style="margin:0 0 20px;color:#6b7280;font-size:13px;line-height:1.7;">${changedLines}</p>` : ''}
          <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.7;">If you don't respond within ${dayWord}, this change will be applied automatically.</p>

          <div style="text-align:center;margin-bottom:8px;">
            <a href="${APP_ORIGIN}/config?tab=access" style="display:inline-block;background:#1b4332;color:#ffffff;font-weight:600;font-size:15px;padding:14px 40px;border-radius:12px;text-decoration:none;">Review the change</a>
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
      subject: `${dayWord} left to respond to a read-only access change`,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
    return
  }

  const key = daysLeft === 1 ? 'viewer_permissions_reminder_1d_sent_at' : 'viewer_permissions_reminder_2d_sent_at'
  const nextConfig = { ...config, [key]: new Date().toISOString() }
  await supabase.from('families').update({ config: nextConfig }).eq('id', familyId)
}

async function getMembers(familyId: string) {
  const { data } = await supabase
    .from('family_members')
    .select('user_id, role, display_name')
    .eq('family_id', familyId)
  return data ?? []
}
