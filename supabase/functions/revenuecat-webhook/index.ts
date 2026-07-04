// Canopy — Supabase Edge Function: revenuecat-webhook
//
// Receives RevenueCat's server-to-server webhook events and syncs subscription
// state onto the families table — the single source of truth both parents'
// devices already read via FamilyContext/useSubscription, so neither parent's
// app needs to independently query RevenueCat's SDK for status.
//
// RevenueCat's App User ID is set to family.id at Purchases.configure() time
// (see src/lib/revenuecat.js) — "both parents included, one price" means
// whichever parent purchases unlocks the whole family, checked here by simply
// updating that family's row regardless of which parent's device triggered it.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// 1. RevenueCat dashboard → Project Settings → Webhooks → add this function's URL
// 2. Set an "Authorization header value" in that same RevenueCat webhook config —
//    any random secret string, matching REVENUECAT_WEBHOOK_SECRET below
// 3. Supabase secret: REVENUECAT_WEBHOOK_SECRET = <the same random string>
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy revenuecat-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendDebugAlert } from '../_shared/debugAlert.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Events that mean "the family currently has paid access" or a clear status change.
// CANCELLATION deliberately has no entry — it means auto-renew was turned off, not
// that access ended; access continues until EXPIRATION actually fires at period end.
const STATUS_BY_EVENT: Record<string, string> = {
  INITIAL_PURCHASE:       'active',
  RENEWAL:                'active',
  UNCANCELLATION:         'active',
  PRODUCT_CHANGE:         'active',
  NON_RENEWING_PURCHASE:  'active',
  SUBSCRIPTION_EXTENDED:  'active',
  BILLING_ISSUE:          'past_due',
  EXPIRATION:             'cancelled',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let rawPayload: unknown
  try {
    rawPayload = await req.clone().json()
  } catch { rawPayload = {} }

  try {
    return await handleRequest(req)
  } catch (err) {
    await sendDebugAlert({ functionName: 'revenuecat-webhook', error: err, input: { payload: rawPayload } })
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: CORS })
  }
})

async function handleRequest(req: Request): Promise<Response> {
  const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  if (!expectedAuth) {
    console.error('REVENUECAT_WEBHOOK_SECRET not set — rejecting request')
    return new Response('Service misconfigured', { status: 503, headers: CORS })
  }
  const incoming = req.headers.get('authorization')
  if (incoming !== expectedAuth) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const payload = await req.json()
  const event = payload?.event

  if (!event?.type || !event?.app_user_id) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no event' }), { status: 200, headers: CORS })
  }

  const newStatus = STATUS_BY_EVENT[event.type]
  if (!newStatus) {
    console.log(`revenuecat-webhook: no-op for event type ${event.type}`)
    return new Response(JSON.stringify({ ok: true, skipped: `no-op for ${event.type}` }), { status: 200, headers: CORS })
  }

  // app_user_id is family.id (a uuid) — only ever set for real purchases; RevenueCat's
  // own TEST events use non-family ids, which will simply match no row (no-op update).
  const updates: Record<string, unknown> = { subscription_status: newStatus }
  if (event.expiration_at_ms) updates.subscription_period_end = new Date(event.expiration_at_ms).toISOString()
  if (event.store) updates.subscription_platform = String(event.store).toLowerCase().includes('play') ? 'android' : 'ios'
  if (event.product_id) updates.subscription_product_id = event.product_id

  const { error, count } = await supabase
    .from('families')
    .update(updates, { count: 'exact' })
    .eq('id', event.app_user_id)

  if (error) console.error('revenuecat-webhook: family update failed:', error.message)
  else console.log(`revenuecat-webhook: ${event.type} → ${newStatus} for family ${event.app_user_id} (${count} row updated)`)

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
}
