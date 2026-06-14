import { useFamily } from '../context/FamilyContext'

export function useSubscription() {
  const { family } = useFamily()

  const status      = family?.subscription_status ?? 'active'
  const trialEndsAt = family?.trial_ends_at ? new Date(family.trial_ends_at) : null
  const periodEnd   = family?.subscription_period_end ? new Date(family.subscription_period_end) : null
  const now         = new Date()

  const isTrialing  = status === 'trialing' && !!trialEndsAt && trialEndsAt > now
  const isExpired   = status === 'trialing' && (!trialEndsAt || trialEndsAt <= now)
  const isActive    = status === 'active'
  const isPastDue   = status === 'past_due'
  const isCancelled = status === 'cancelled'

  const daysLeft = isTrialing
    ? Math.max(1, Math.ceil((trialEndsAt - now) / (1000 * 60 * 60 * 24)))
    : 0

  // Past-due gets a short grace period — still accessible but shows a warning
  const hasAccess   = true
  const needsPaywall = false // disabled until RevenueCat is integrated

  return {
    status,
    isTrialing,
    isExpired,
    isActive,
    isPastDue,
    isCancelled,
    daysLeft,
    hasAccess,
    needsPaywall,
    trialEndsAt,
    periodEnd,
  }
}
