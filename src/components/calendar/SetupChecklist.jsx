import { useNavigate } from 'react-router-dom'
import { useFamily } from '../../context/FamilyContext'

export default function SetupChecklist() {
  const navigate = useNavigate()
  const { schedule, parentB, familyInvites, member, family, isParent, userRole } = useFamily()

  if (!isParent) return null

  const isSingleHousehold = family?.config?.care_type === 'living_together'
  // Once Parent A has sent a Parent B invite at all, this stays done -- even
  // after the invite's 7-day link expires without Parent B engaging. Don't
  // make Parent A keep re-inviting just to clear a checklist nag; resending
  // is still available from the Invite screen if they want to.
  const hasInvitedParentB = familyInvites.some((i) => i.role === 'parent_b')

  const items = [
    userRole === 'parent_a' && !isSingleHousehold && {
      id: 'schedule',
      label: 'Set up the parenting schedule',
      done: !!schedule,
      href: '/config?tab=schedule',
    },
    userRole === 'parent_a' && {
      id: 'invite',
      label: 'Invite Parent B',
      // Sending the invite is the action this checklist item asks for — waiting
      // for Parent B to actually accept isn't something Parent A can do
      // anything more about, so don't leave this nagging once it's sent,
      // even after that invite's own link later expires unused.
      done: !!parentB || hasInvitedParentB,
      href: '/invite',
    },
    {
      id: 'children',
      label: "Add children's school details",
      done: (family?.config?.children ?? []).some((c) => c.name),
      href: '/config?tab=children',
    },
    {
      id: 'phone',
      label: 'Add your mobile number for SMS alerts',
      done: !!member?.phone_number,
      href: '/config?tab=notifications',
    },
    {
      id: 'push',
      label: 'Enable push notifications',
      done: !!(member?.push_token_ios || member?.push_token_android || member?.push_token_web),
      href: '/config?tab=notifications',
    },
  ].filter(Boolean)

  if (items.every((i) => i.done)) return null

  return (
    <div className="mx-3 mb-3 bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <p className="text-xs font-semibold text-canopy-mid uppercase tracking-wide mb-2.5">Getting started</p>
      <div className="space-y-2.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => !item.done && navigate(item.href)}
            className={`flex items-center gap-3 w-full text-left ${item.done ? 'cursor-default' : ''}`}
          >
            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              item.done ? 'border-canopy-green bg-canopy-green' : 'border-gray-300 bg-white'
            }`}>
              {item.done && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <span className={`text-sm flex-1 ${item.done ? 'text-gray-400 line-through' : 'text-gray-700 font-medium'}`}>
              {item.label}
            </span>
            {!item.done && (
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
