import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const paymentsEnabled = Deno.env.get('PAYMENTS_ENABLED') === 'true'
    if (!paymentsEnabled) {
      return new Response(
        JSON.stringify({ error: 'Payments not enabled. Set PAYMENTS_ENABLED=true in Supabase secrets.' }),
        { status: 403, headers: corsHeaders }
      )
    }

    const { plan_id } = await req.json()

    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const stripeKey      = Deno.env.get('STRIPE_SECRET_KEY')!
    const priceId        = Deno.env.get('STRIPE_PRICE_ID')!

    // Verify caller is a collaborator
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

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan_id, user_id: user.id },
      success_url: `https://parentingplan.help/plan?payment=success`,
      cancel_url:  `https://parentingplan.help/plan`,
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
