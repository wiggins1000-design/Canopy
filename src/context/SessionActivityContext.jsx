import { createContext, useContext, useCallback } from 'react'
import { supabase, sendPushNotification } from '../lib/supabase'
import { useFamily } from './FamilyContext'

const SessionActivityContext = createContext(null)

export function SessionActivityProvider({ children }) {
  const { family, member, userRole, parentA, parentB } = useFamily()

  const trackActivity = useCallback(async (description) => {
    if (!family?.id || !member) return
    try {
      const authorName = member.display_name ?? 'A parent'

      const { data } = await supabase.rpc('upsert_activity_notice', {
        p_family_id:   family.id,
        p_activity:    description,
        p_author_name: authorName,
      })

      if (data?.is_new) {
        const recipientRole   = userRole === 'parent_a' ? 'parent_b' : 'parent_a'
        const recipientMember = recipientRole === 'parent_a' ? parentA : parentB
        if (recipientMember) {
          await sendPushNotification({
            familyId:     family.id,
            recipientRole,
            title:        `${authorName} made some updates`,
            body:         description,
            url:          '/board',
          })
        }
      }
    } catch (e) {
      console.warn('trackActivity failed:', e)
    }
  }, [family?.id, member, userRole, parentA, parentB])

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
