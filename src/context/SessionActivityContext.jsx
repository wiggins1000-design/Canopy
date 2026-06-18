import { createContext, useContext, useEffect, useRef, useCallback } from 'react'
import { supabase, sendPushNotification } from '../lib/supabase'
import { useFamily } from './FamilyContext'
import { registerFlush, unregisterFlush } from '../lib/sessionFlushRegistry'

const SessionActivityContext = createContext(null)

const IDLE_MS       = 30 * 60 * 1000 // flush after 30 min with no new activity
const STALE_MS      = 30 * 60 * 1000 // treat localStorage entries older than 30 min as a previous session
const STORAGE_KEY   = (id) => `canopy_activity_${id}`

export function SessionActivityProvider({ children }) {
  const { family, member, userRole, parentA, parentB } = useFamily()

  const activitiesRef  = useRef([])
  const idleTimerRef   = useRef(null)
  const flushRef       = useRef(null)  // always-current reference to flushDigest

  // Always-current snapshot of context values
  const ctxRef = useRef({})
  useEffect(() => {
    ctxRef.current = { family, member, userRole, parentA, parentB }
  })

  const flushDigest = useCallback(async () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }

    const activities = activitiesRef.current
    if (!activities.length) return

    const { family, member, userRole, parentA, parentB } = ctxRef.current
    if (!family?.id) return

    // Deduplicate, preserving first-occurrence order
    const unique     = [...new Set(activities)]
    const authorName = member?.display_name ?? 'A parent'
    const lines      = unique.map((a) => `• ${a}`).join('\n')
    const content    = `📋 ${authorName} made the following updates:\n\n${lines}`

    await supabase.rpc('create_notice_post', {
      p_family_id: family.id,
      p_content:   content,
      p_tag:       'notification',
    })

    const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
    const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
    if (recipientMember) {
      await sendPushNotification({
        familyId:     family.id,
        recipientRole,
        title:        `${authorName} made some updates`,
        body:         `${unique.length} update${unique.length !== 1 ? 's' : ''} — check the notice board`,
        url:          '/board',
      })
    }

    activitiesRef.current = []
    localStorage.removeItem(STORAGE_KEY(family.id))
  }, [])

  // Keep flushRef current so event listeners always call the latest version
  useEffect(() => { flushRef.current = flushDigest }, [flushDigest])

  // On family load: restore pending activities from localStorage.
  // If they are older than STALE_MS the previous session didn't flush cleanly —
  // post that digest now before starting a fresh one.
  useEffect(() => {
    if (!family?.id) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY(family.id))
      if (!raw) return
      const { activities, lastActivity } = JSON.parse(raw)
      if (!activities?.length) return

      const age = Date.now() - new Date(lastActivity).getTime()
      if (age >= STALE_MS) {
        // Previous session — flush immediately then start fresh
        activitiesRef.current = activities
        flushRef.current?.()
      } else {
        // Same session resumed (e.g. page refresh) — carry on
        activitiesRef.current = activities
      }
    } catch {}
  }, [family?.id])

  const trackActivity = useCallback((description) => {
    activitiesRef.current = [...activitiesRef.current, description]

    // Persist to localStorage (survives page refresh)
    const id = ctxRef.current.family?.id
    if (id) {
      try {
        localStorage.setItem(STORAGE_KEY(id), JSON.stringify({
          activities:   activitiesRef.current,
          lastActivity: new Date().toISOString(),
        }))
      } catch {}
    }

    // Reset idle timer — flush automatically after 30 min of inactivity
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      flushRef.current?.()
    }, IDLE_MS)
  }, [])

  // Register with flush registry so AuthContext.signOut() can trigger a flush
  useEffect(() => {
    registerFlush(flushDigest)
    return () => unregisterFlush()
  }, [flushDigest])

  // Best-effort flush when the app goes to background (tab switch, close, PWA minimise).
  // The Supabase call may not complete if the tab is killed, but localStorage is already
  // written, so the next session will catch any orphaned activities.
  useEffect(() => {
    const handle = () => {
      if (document.visibilityState === 'hidden' && activitiesRef.current.length) {
        flushRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handle)
    return () => {
      document.removeEventListener('visibilitychange', handle)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  return (
    <SessionActivityContext.Provider value={{ trackActivity }}>
      {children}
    </SessionActivityContext.Provider>
  )
}

export function useSessionActivity() {
  const ctx = useContext(SessionActivityContext)
  if (!ctx) throw new Error('useSessionActivity must be inside SessionActivityProvider')
  return ctx
}
