import { NavLink } from 'react-router-dom'
import { useFamily } from '../../context/FamilyContext'
import { useSubscription } from '../../hooks/useSubscription'

const SETTINGS_NAV = {
  to: '/config',
  label: 'Settings',
  icon: (active) => (
    <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

const NAV = [
  {
    to: '/calendar',
    label: 'Calendar',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path strokeLinecap="round" d="M3 9h18M8 2v4M16 2v4" />
      </svg>
    ),
  },
  {
    to: '/board',
    label: 'Board',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    to: '/info',
    label: 'Info',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const { family, isParent } = useFamily()
  const { isTrialing, daysLeft } = useSubscription()
  const showTrialBadge = isTrialing && daysLeft <= 7
  if (!family) return null

  const vp = family?.config?.viewer_permissions ?? {}
  const noticeboardEnabled = family?.config?.noticeboard_enabled !== false
  const messagingEnabled   = !!family?.config?.messaging_enabled && (isParent || vp.messaging === true)
  const expensesEnabled    = !!family?.config?.expenses_enabled  && (isParent || vp.expenses  === true)

  const canSee = (key) => isParent || vp[key] !== false

  let visibleNav = NAV.filter((n) => {
    if (n.to === '/board')     return noticeboardEnabled && canSee('noticeboard')
    if (n.to === '/calendar')  return canSee('calendar')
    if (n.to === '/info')      return canSee('info_bank')
    return true
  })

  if (messagingEnabled) {
    visibleNav = [...visibleNav, {
      to: '/messages',
      label: 'Messages',
      icon: (active) => (
        <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    }]
  }

  if (expensesEnabled) {
    visibleNav = [...visibleNav, {
      to: '/expenses',
      label: 'Expenses',
      icon: (active) => (
        <svg className={`w-5 h-5 ${active ? 'text-canopy-mid' : 'text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    }]
  }

  visibleNav = [...visibleNav, SETTINGS_NAV]

  return (
    <nav className="relative bg-white border-t border-gray-200 pb-safe shrink-0 z-30">
      <div className="max-w-lg mx-auto flex">
        {visibleNav.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 min-w-0 flex flex-col items-center gap-0.5 py-3 text-xs font-medium overflow-hidden ${isActive ? 'text-canopy-mid' : 'text-gray-400'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  {icon(isActive)}
                  {to === '/config' && showTrialBadge && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-white" />
                  )}
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
