// Canopy â€” create-checkout-session
// Creates a Stripe Checkout session for the family subscription.
// Preserves any remaining trial days from the family's trial_ends_at.

import Stripe from 'https://esm.sh/stripe@14'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: member } = await userClient
    .from('family_members')
    .select('family_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return new Response('No family', { status: 400, headers: CORS })

  const { data: family } = await userClient
    .from('families')
    .select('id, stripe_customer_id, trial_ends_at, subscription_status')
    .eq('id', member.family_id)
    .single()

  if (!family) return new Response('Family not found', { status: 400, headers: CORS })

  // Already active â€” no need to create a new session
  if (family.subscription_status === 'active') {
    return new Response(JSON.stringify({ already_active: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const appUrl = body.app_url ?? 'https://my.canopy-app.app'

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

  // Preserve remaining trial days
  const trialEndsAt = new Date(family.trial_ends_at)
  const now = new Date()
  const trialEnd = trialEndsAt > now
    ? Math.floor(trialEndsAt.getTime() / 1000)
    : undefined

  const sessionParams: any = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
    success_url: `${appUrl}?subscription=success`,
    cancel_url:  appUrl,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { family_id: family.id },
    },
    metadata: { family_id: family.id },
  }

  if (family.stripe_customer_id) {
    sessionParams.customer = family.stripe_customer_id
  } else {
    sessionParams.customer_creation = 'always'
    sessionParams.customer_email = user.email
  }

  if (trialEnd) {
    sessionParams.subscription_data.trial_end = trialEnd
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams)
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('Stripe checkout error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
