import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@14'

Deno.serve(async (req: Request) => {
  const stripeKey      = Deno.env.get('STRIPE_SECRET_KEY')!
  const webhookSecret  = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  const sig    = req.headers.get('stripe-signature')
  const body   = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { plan_id, user_id } = session.metadata ?? {}

    if (!plan_id || !user_id) {
      return new Response('Missing metadata', { status: 400 })
    }

    if (session.payment_status !== 'paid') {
      return new Response('Not paid', { status: 200 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { error } = await supabase.rpc('pp_grant_analyses', {
      p_plan_id: plan_id,
      p_user_id: user_id,
      p_count:   3,
    })

    if (error) {
      console.error('pp_grant_analyses failed', error)
      return new Response('Grant failed', { status: 500 })
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
