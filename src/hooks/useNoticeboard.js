import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'

export function useNoticeboard() {
  const { family } = useFamily()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  const loadPosts = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('notice_posts')
      .select('*')
      .eq('family_id', family.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    setPosts(data ?? [])
    setLoading(false)
  }, [family?.id])

  useEffect(() => { loadPosts() }, [loadPosts])

  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`noticeboard-${family.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notice_posts',
        filter: `family_id=eq.${family.id}`,
      }, loadPosts)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, loadPosts])

  const pinnedPosts = posts.filter((p) => p.is_pinned)
  const feedPosts   = posts.filter((p) => !p.is_pinned)

  return { pinnedPosts, feedPosts, loading, refetch: loadPosts }
}
