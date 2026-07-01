import { useFamily } from '../context/FamilyContext'
import { getRegionConfig } from '../config/regions'

export function useLocale() {
  const { family } = useFamily()
  return getRegionConfig(family?.config?.locale ?? 'en-GB')
}
