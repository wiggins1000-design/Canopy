import enGB from './en-GB'
import enUS from './en-US'
import enAU from './en-AU'
import enIE from './en-IE'

const CONFIGS = {
  'en-GB': enGB,
  'en-US': enUS,
  'en-AU': enAU,
  'en-IE': enIE,
}

export const SUPPORTED_LOCALES = [
  { code: 'en-GB', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'en-IE', label: 'Ireland',         flag: '🇮🇪' },
  { code: 'en-US', label: 'United States',   flag: '🇺🇸' },
  { code: 'en-AU', label: 'Australia',       flag: '🇦🇺' },
]

export function getRegionConfig(locale) {
  return CONFIGS[locale] ?? CONFIGS['en-GB']
}
