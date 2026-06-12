import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'

export function useMessages() {
  const { family } = useFamily()
  const { user } = useAuth()
  const [threads, setThreads]   = useState([])
  const [reads, setReads]       = useState({})   // { [threadId]: last_read_at string }
  const [loading, setLoading]   = useState(true)

  const loadThreads = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)
    const [{ data: threadData }, { data: readsData }] = await Promise.all([
      supabase
        .from('message_threads')
        .select('*')
        .eq('family_id', family.id)
        .eq('is_archived', false)
        .order('last_message_at', { ascending: false }),
      supabase
        .from('message_reads')
        .select('thread_id, last_read_at')
        .eq('user_id', user?.id),
    ])
    setThreads(threadData ?? [])
    const readsMap = {}
    for (const r of readsData ?? []) readsMap[r.thread_id] = r.last_read_at
    setReads(readsMap)
    setLoading(false)
  }, [family?.id, user?.id])

  useEffect(() => { loadThreads() }, [loadThreads])

  // Realtime: thread list (new thread or last_message_at updated)
  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`msg-threads-${family.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'message_threads',
        filter: `family_id=eq.${family.id}`,
      }, loadThreads)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, loadThreads])

  // Realtime: reads (so unread badges update live)
  useEffect(() => {
    if (!user?.id) return
    const ch = supabase
      .channel(`msg-reads-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'message_reads',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const { thread_id, last_read_at } = payload.new
        setReads((prev) => ({ ...prev, [thread_id]: last_read_at }))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user?.id])

  async function createThread(topic, topicPreset = null) {
    const { data, error } = await supabase.rpc('create_message_thread', {
      p_topic: topic,
      p_topic_preset: topicPreset,
    })
    if (!error) await loadThreads()
    return { data, error }
  }

  async function archiveThread(threadId) {
    await supabase.rpc('archive_message_thread', { p_thread_id: threadId, p_archived: true })
  }

  return { threads, reads, loading, createThread, archiveThread, refetch: loadThreads }
}

export function useThread(threadId) {
  const { user } = useAuth()
  const [messages, setMessages]     = useState([])
  const [threadReads, setThreadReads] = useState({}) // { [userId]: last_read_at }
  const [loading, setLoading]       = useState(true)

  const loadMessages = useCallback(async () => {
    if (!threadId) return
    setLoading(true)
    const [{ data: msgData }, { data: readsData }] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('sent_at', { ascending: true }),
      supabase
        .from('message_reads')
        .select('user_id, last_read_at')
        .eq('thread_id', threadId),
    ])
    setMessages(msgData ?? [])
    const readsMap = {}
    for (const r of readsData ?? []) readsMap[r.user_id] = r.last_read_at
    setThreadReads(readsMap)
    setLoading(false)
  }, [threadId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Realtime: new messages + read receipts
  useEffect(() => {
    if (!threadId) return
    const ch = supabase
      .channel(`messages-${threadId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `thread_id=eq.${threadId}`,
      }, (payload) => {
        setMessages((prev) => [...prev, payload.new])
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'message_reads',
        filter: `thread_id=eq.${threadId}`,
      }, (payload) => {
        const { user_id, last_read_at } = payload.new
        setThreadReads((prev) => ({ ...prev, [user_id]: last_read_at }))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [threadId])

  async function sendMessage(content) {
    const { error } = await supabase.rpc('send_message', {
      p_thread_id: threadId,
      p_content: content.trim(),
    })
    return { error }
  }

  async function markRead() {
    if (!user?.id || !threadId) return
    await supabase.rpc('mark_thread_read', { p_thread_id: threadId })
  }

  return { messages, threadReads, loading, sendMessage, markRead }
}
