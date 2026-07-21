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

        // Same Notice Board audience as NewPostSheet.jsx -- carers were
        // never wired into any push trigger in the app (all of them only
        // ever targeted "the other parent"). Safe to call unconditionally;
        // the edge function no-ops gracefully if there's no third_party
        // member or no registered device.
        await sendPushNotification({
          familyId:      family.id,
          recipientRole: 'third_party',
          title:         `${authorName} made some updates`,
          body:          description,
          url:           '/board',
        })
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
