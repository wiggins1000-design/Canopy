import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

export function useMediaAttachments() {
  const { family } = useFamily()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('notice_posts')
      .select('id, author_id, content, image_url, file_url, file_name, tag, created_at')
      .eq('family_id', family.id)
      .eq('is_archived', false)
      .or('image_url.not.is.null,file_url.not.is.null')
      .order('created_at', { ascending: false })
    setItems(data ?? [])
    setLoading(false)
  }, [family?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`media-${family.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notice_posts',
        filter: `family_id=eq.${family.id}`,
      }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, load])

  const photos = items.filter((i) => i.image_url)
  const docs   = items.filter((i) => i.file_url && !i.image_url)

  return { items, photos, docs, loading }
}
