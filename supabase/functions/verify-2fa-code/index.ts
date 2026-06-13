// Canopy — verify-2fa-code
// Verifies a submitted 6-digit code against the stored SHA-256 hash for the authenticated user.
// Secrets required: SUPABASE_SERVICE_ROLE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: CORS })

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { code } = await req.json()
  if (!code || typeof code !== 'string') {
    return new Response(JSON.stringify({ verified: false, error: 'Code required' }), { status: 400, headers: CORS })
  }

  // Hash the submitted code
  const encoded = new TextEncoder().encode(code.trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const submittedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const serviceClient = createClient(supabaseUrl, serviceRoleKey)

  // Find the most recent valid (unused, non-expired) code for this user
  const { data: codes } = await serviceClient
    .from('two_factor_codes')
    .select('id, code_hash, expires_at')
    .eq('user_id', user.id)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  if (!codes?.length || codes[0].code_hash !== submittedHash) {
    return new Response(
      JSON.stringify({ verified: false }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  // Mark code as used
  await serviceClient
    .from('two_factor_codes')
    .update({ used: true })
    .eq('id', codes[0].id)

  return new Response(
    JSON.stringify({ verified: true }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
