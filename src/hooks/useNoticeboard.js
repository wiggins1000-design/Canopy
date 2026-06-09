import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'

export function useNoticeboard() {
  const { family } = useFamily()
  const { user } = useAuth()
  const [posts, setPosts]   = useState([])
  const [reads, setReads]   = useState({})   // { [postId]: Set<userId> }
  const [loading, setLoading] = useState(true)

  const loadPosts = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)
    const [{ data: postsData }, { data: readsData }] = await Promise.all([
      supabase
        .from('notice_posts')
        .select('*')
        .eq('family_id', family.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('notice_post_reads')
        .select('post_id, user_id')
        .eq('family_id', family.id),
    ])

    setPosts(postsData ?? [])

    // Build a map: postId → Set of userIds
    const readsMap = {}
    for (const r of readsData ?? []) {
      if (!readsMap[r.post_id]) readsMap[r.post_id] = new Set()
      readsMap[r.post_id].add(r.user_id)
    }
    setReads(readsMap)
    setLoading(false)
  }, [family?.id])

  useEffect(() => { loadPosts() }, [loadPosts])

  // Realtime: posts
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

  // Realtime: reads
  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`noticeboard-reads-${family.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notice_post_reads',
        filter: `family_id=eq.${family.id}`,
      }, (payload) => {
        const { post_id, user_id } = payload.new
        setReads((prev) => {
          const next = { ...prev }
          if (!next[post_id]) next[post_id] = new Set()
          else next[post_id] = new Set(next[post_id])
          next[post_id].add(user_id)
          return next
        })
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id])

  async function markRead(postId) {
    if (!user?.id) return
    // Optimistic update
    setReads((prev) => {
      const next = { ...prev }
      if (!next[postId]) next[postId] = new Set()
      else next[postId] = new Set(next[postId])
      next[postId].add(user.id)
      return next
    })
    await supabase.rpc('mark_post_read', { p_post_id: postId })
  }

  const pinnedPosts = posts.filter((p) => p.is_pinned)
  const feedPosts   = posts.filter((p) => !p.is_pinned)

  return { pinnedPosts, feedPosts, reads, loading, markRead, refetch: loadPosts }
}
