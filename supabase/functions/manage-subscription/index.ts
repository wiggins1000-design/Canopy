// Canopy â€” manage-subscription
// Creates a Stripe Customer Portal session so the user can cancel, update
// payment details, or view invoices.

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
    .select('id, stripe_customer_id')
    .eq('id', member.family_id)
    .single()

  if (!family?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'No Stripe customer found' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const appUrl = body.app_url ?? 'https://my.canopy-app.app'

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   family.stripe_customer_id,
      return_url: `${appUrl}/config`,
    })
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('Stripe portal error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
