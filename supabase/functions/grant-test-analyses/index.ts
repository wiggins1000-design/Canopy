import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Hard block if payments are live — this endpoint must never exist in production
  if (Deno.env.get('PAYMENTS_ENABLED') === 'true') {
    return new Response(
      JSON.stringify({ error: 'Test endpoint disabled in production' }),
      { status: 403, headers: corsHeaders }
    )
  }

  try {
    const { plan_id } = await req.json()

    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Verify the caller is a collaborator on this plan
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
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

    const { error } = await supabaseAdmin.rpc('pp_grant_analyses', {
      p_plan_id: plan_id,
      p_user_id: user.id,
      p_count:   3,
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ ok: true, granted: 3 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
