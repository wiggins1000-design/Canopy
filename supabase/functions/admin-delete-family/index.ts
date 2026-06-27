// Canopy — admin-delete-family edge function
// Permanently deletes a family and all its data.
// Verifies the caller is an admin before proceeding.

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

  const { data: adminRow } = await supabase
    .from('admin_accounts')
    .select('user_id')
    .eq('user_id', user.id)
    .single()
  if (!adminRow) return new Response('Forbidden', { status: 403, headers: CORS })

  const { family_id } = await req.json()
  if (!family_id) {
    return new Response(JSON.stringify({ error: 'Missing family_id' }), { status: 400, headers: CORS })
  }

  // Collect member user IDs before deleting
  const { data: members } = await supabase
    .from('family_members')
    .select('user_id')
    .eq('family_id', family_id)

  const userIds: string[] = members?.map((m: { user_id: string }) => m.user_id) ?? []

  // Delete the family row — FK cascades remove all associated data
  const { error: deleteError } = await supabase
    .from('families')
    .delete()
    .eq('id', family_id)

  if (deleteError) {
    console.error('Family delete error:', deleteError.message)
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: CORS })
  }

  // Clean up storage buckets
  for (const bucket of ['vault', 'notice-attachments']) {
    const { data: files } = await supabase.storage.from(bucket).list(family_id, { limit: 1000 })
    if (files?.length) {
      const paths = files.map((f: { name: string }) => `${family_id}/${f.name}`)
      await supabase.storage.from(bucket).remove(paths).catch((e: Error) => console.error(`Storage cleanup (${bucket}):`, e))
    }
  }

  // Delete auth users
  let deletedCount = 0
  for (const userId of userIds) {
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(userId)
    if (!deleteUserError) deletedCount++
    else console.error('deleteUser error:', userId, deleteUserError.message)
  }

  return new Response(
    JSON.stringify({ ok: true, deleted_members: deletedCount }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
