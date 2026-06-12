// Canopy — stripe-webhook
// Handles Stripe webhook events to keep subscription_status in sync.
// Deploy with --no-verify-jwt since Stripe does not send Supabase JWTs.
//
// Secrets required:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET  (from Stripe Dashboard → Webhooks → signing secret)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import Stripe from 'https://esm.sh/stripe@14'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const body = await req.text()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response('Invalid signature', { status: 400 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const familyId = session.metadata?.family_id
        if (!familyId) break
        await db.from('families').update({
          stripe_customer_id:     session.customer as string,
          stripe_subscription_id: session.subscription as string,
          subscription_status:    'active',
        }).eq('id', familyId)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const familyId = sub.metadata?.family_id
        if (!familyId) break
        const status =
          sub.status === 'active'   ? 'active'   :
          sub.status === 'trialing' ? 'trialing'  :
          sub.status === 'past_due' ? 'past_due'  : 'cancelled'
        await db.from('families').update({
          subscription_status:     status,
          subscription_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq('id', familyId)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const familyId = sub.metadata?.family_id
        if (!familyId) break
        await db.from('families').update({
          subscription_status: 'cancelled',
        }).eq('id', familyId)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        if (!invoice.subscription) break
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
        const familyId = sub.metadata?.family_id
        if (!familyId) break
        await db.from('families').update({
          subscription_status: 'past_due',
        }).eq('id', familyId)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        if (!invoice.subscription) break
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
        const familyId = sub.metadata?.family_id
        if (!familyId) break
        await db.from('families').update({
          subscription_status:     'active',
          subscription_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq('id', familyId)
        break
      }
    }
  } catch (err: any) {
    console.error('Webhook handler error:', err)
    return new Response('Handler error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
