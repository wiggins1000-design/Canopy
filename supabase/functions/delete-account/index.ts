// Canopy — delete-account edge function
//
// Permanently deletes the requesting user's account:
//   1. Removes user-specific DB rows via delete_account_data RPC
//   2. If they were the last parent, purges family storage files
//   3. Deletes the auth.users record
//
// Called from the client using supabase.functions.invoke('delete-account')
// with the user's JWT in the Authorization header.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return new Response('Unauthorized', { status: 401, headers: CORS })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: CORS })

  // DB cleanup — determine scope and remove rows
  const { data: result, error: rpcError } = await supabase.rpc('delete_account_data', { p_user_id: user.id })
  if (rpcError) {
    console.error('delete_account_data error:', rpcError.message)
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 500, headers: CORS })
  }

  // Notify remaining parent if only this user's membership was removed
  if (result?.deleted === 'member' && result?.family_id && result?.remaining_parent_role) {
    const name = result.deleted_display_name ?? 'Your co-parent'
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'apikey': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      },
      body: JSON.stringify({
        family_id:      result.family_id,
        recipient_role: result.remaining_parent_role,
        title:          'Co-parent removed their account',
        body:           `${name} has removed their Canopy account. Your family data remains safe and unchanged.`,
        url:            '/config',
      }),
    }).catch((e) => console.error('Push notification error:', e))
  }

  // Storage cleanup — only when the whole family was deleted
  if (result?.deleted === 'family' && result?.family_id) {
    const familyId: string = result.family_id
    for (const bucket of ['vault', 'notice-attachments']) {
      const { data: files } = await supabase.storage.from(bucket).list(familyId, { limit: 1000 })
      if (files?.length) {
        const paths = files.map((f: { name: string }) => `${familyId}/${f.name}`)
        const { error: storageErr } = await supabase.storage.from(bucket).remove(paths)
        if (storageErr) console.error(`Storage cleanup error (${bucket}):`, storageErr.message)
      }
    }
  }

  // Delete auth user — invalidates all sessions
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('deleteUser error:', deleteError.message)
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: CORS })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
