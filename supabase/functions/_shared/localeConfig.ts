// Locale configs for use in Deno edge functions.
// Mirrors src/config/regions/ — keep in sync when adding new locales.

export interface LocaleConfig {
  termDateRegex:   RegExp
  contentKeywords: string[]
  urlKeywords:     string[]
  commonPaths:     string[]
  claudeVariant:   'uk' | 'us' | 'au' | 'ie'
  yearGroupSystem: 'uk' | 'us' | 'au' | 'ie'
}

export const LOCALE_CONFIGS: Record<string, LocaleConfig> = {
  'en-GB': {
    termDateRegex: /half.?term|inset\s+day|autumn\s+holid|spring\s+holid|summer\s+holid|christmas\s+holid|easter\s+holid|school\s+holiday|school\s+break|school\s+clos|end\s+of\s+term|first\s+day\s+of\s+term|last\s+day\s+of\s+term|term\s+start|term\s+end|term\s+begin|school\s+returns?/i,
    contentKeywords: ['term', 'holiday', 'inset', 'autumn', 'spring', 'summer'],
    urlKeywords: ['term-dates', 'term-times', 'academic-calendar', 'school-calendar', 'key-dates', 'holiday-dates'],
    commonPaths: [
      '/term-dates', '/term-dates/', '/term_dates', '/termdates',
      '/parents/term-dates', '/parents-and-carers/term-dates',
      '/key-information/term-dates', '/school-information/term-dates',
      '/calendar', '/school-calendar',
    ],
    claudeVariant: 'uk',
    yearGroupSystem: 'uk',
  },

  'en-US': {
    termDateRegex: /fall\s+break|spring\s+break|winter\s+break|summer\s+break|thanksgiving\s+break|pd\s+day|professional\s+development\s+day|teacher\s+work\s+day|no\s+school|early\s+release|semester\s+start|semester\s+end|fall\s+semester|spring\s+semester/i,
    contentKeywords: ['semester', 'break', 'vacation', 'academic', 'calendar', 'pd day', 'school year'],
    urlKeywords: ['academic-calendar', 'school-calendar', 'calendar', 'school-year', 'important-dates'],
    commonPaths: [
      '/calendar', '/academic-calendar', '/school-calendar',
      '/parents/calendar', '/important-dates', '/school-year',
      '/about/calendar', '/resources/calendar',
    ],
    claudeVariant: 'us',
    yearGroupSystem: 'us',
  },

  'en-AU': {
    termDateRegex: /term\s+[1-4]|pupil.?free\s+day|student.?free\s+day|school\s+holiday|school\s+term|end\s+of\s+term|start\s+of\s+term|term\s+dates/i,
    contentKeywords: ['term', 'holiday', 'pupil-free', 'school holiday', 'term dates'],
    urlKeywords: ['term-dates', 'school-calendar', 'calendar', 'key-dates', 'dates'],
    commonPaths: [
      '/term-dates', '/calendar', '/school-calendar',
      '/parents/term-dates', '/key-dates', '/school-terms',
    ],
    claudeVariant: 'au',
    yearGroupSystem: 'au',
  },

  'en-IE': {
    termDateRegex: /midterm\s+break|mid.?term|school\s+holiday|in.?service\s+day|term\s+start|term\s+end|christmas\s+holid|easter\s+holid|summer\s+holid|school\s+term/i,
    contentKeywords: ['term', 'holiday', 'midterm', 'in-service', 'school term'],
    urlKeywords: ['term-dates', 'school-calendar', 'calendar', 'key-dates'],
    commonPaths: [
      '/term-dates', '/calendar', '/parents/term-dates',
      '/school-calendar', '/key-dates',
    ],
    claudeVariant: 'ie',
    yearGroupSystem: 'ie',
  },
}

export function getLocaleConfig(locale: string): LocaleConfig {
  return LOCALE_CONFIGS[locale] ?? LOCALE_CONFIGS['en-GB']
}

/** Infer locale from the school website's domain TLD. Returns null if ambiguous. */
export function getLocaleFromUrl(url: string): string | null {
  if (/\.co\.uk|\.sch\.uk|\.ac\.uk|\.org\.uk|\.me\.uk/.test(url)) return 'en-GB'
  if (/\.com\.au|\.edu\.au|\.vic\.edu\.au|\.nsw\.edu\.au|\.qld\.edu\.au|\.sa\.edu\.au|\.wa\.edu\.au/.test(url)) return 'en-AU'
  if (/\.ie(\/|$)/.test(url)) return 'en-IE'
  return null
}

// ── Claude prompt variants ───────────────────────────────────────────────────

export const CLAUDE_EXTRACTION_PROMPTS: Record<string, string> = {
  uk: `Extract all dated events from this UK school term calendar. Include everything: term start/end dates, half terms, holidays, INSET days, bank holidays.

Return JSON: { "events": [ { "title": string, "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null" } ] }

Rules:
- Include INSET days (Staff Training Days, Teacher Training Days, Professional Development Days, Occasional Days)
- Holiday inference: if two consecutive terms have no holiday listed between them, infer one:
  • Michaelmas/Autumn term ends → Lent/Spring term begins: infer "Christmas Holiday"
  • Lent/Spring term ends → Summer term begins: infer "Easter Holiday"
  • Summer term ends → Michaelmas/Autumn term begins: infer "Summer Holiday"
- Use "INSET Day" as the title for in-service days
- Dates must be YYYY-MM-DD
- Return ONLY valid JSON`,

  us: `Extract all dated events from this US school academic calendar. Include everything: semester start/end dates, breaks, professional development days, public holidays that affect school.

Return JSON: { "events": [ { "title": string, "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null" } ] }

Rules:
- Include Professional Development Days (PD Days), Teacher Work Days, No-School days
- Include Fall Break, Winter Break, Spring Break, Thanksgiving Break, Summer Break
- Use the school's own terminology for titles where available
- Dates must be YYYY-MM-DD
- Return ONLY valid JSON`,

  au: `Extract all dated events from this Australian school calendar. Include everything: term start/end dates, holidays between terms, pupil-free days, public holidays that affect school.

Return JSON: { "events": [ { "title": string, "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null" } ] }

Rules:
- Australian schools have 4 terms per year (Term 1–4)
- Include Pupil-Free Days and Student-Free Days
- Holiday titles: "Term 1 Holiday", "Term 2 Holiday", "Term 3 Holiday", "Summer Holiday" etc.
- Dates must be YYYY-MM-DD
- Return ONLY valid JSON`,

  ie: `Extract all dated events from this Irish school calendar. Include everything: term start/end dates, midterm breaks, holidays, in-service days, public holidays that affect school.

Return JSON: { "events": [ { "title": string, "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null" } ] }

Rules:
- Irish schools have 3 terms with midterm breaks (October midterm, February midterm)
- Include In-Service Days (school closed to students)
- Holiday inference between terms: Christmas Holiday, Easter Holiday, Summer Holiday
- Use "In-Service Day" as the title for staff training days
- Dates must be YYYY-MM-DD
- Return ONLY valid JSON`,
}

// ── Year group normalisation ─────────────────────────────────────────────────

export function deriveKeyStage(yearGroup: string | undefined, locale: string): string | null {
  if (!yearGroup) return null
  const lower = yearGroup.toLowerCase().trim()
  const system = getLocaleConfig(locale).yearGroupSystem

  if (system === 'uk') {
    if (/nursery|reception|eyfs|\bfs\b|\bfs1\b|\bfs2\b/.test(lower)) return 'EYFS'
    if (/sixth.?form|year\s*1[23]|y1[23]/.test(lower)) return 'KS5'
    const m = lower.match(/year\s*(\d+)|^y(\d+)$/)
    if (!m) return null
    const y = parseInt(m[1] ?? m[2])
    if (y <= 2)  return 'KS1'
    if (y <= 6)  return 'KS2'
    if (y <= 9)  return 'KS3'
    if (y <= 11) return 'KS4'
    return 'KS5'
  }

  if (system === 'us') {
    if (/kindergarten|^k$/.test(lower)) return 'K'
    const m = lower.match(/grade\s*(\d+)|^(\d+)(st|nd|rd|th)?\s*grade/i)
    if (!m) return null
    const g = parseInt(m[1] ?? m[2])
    if (g <= 5)  return 'Elementary'
    if (g <= 8)  return 'Middle School'
    return 'High School'
  }

  if (system === 'au') {
    if (/prep|kindergarten|foundation/.test(lower)) return 'Foundation'
    const m = lower.match(/year\s*(\d+)|^y(\d+)$/)
    if (!m) return null
    const y = parseInt(m[1] ?? m[2])
    if (y <= 6)  return 'Primary'
    return 'Secondary'
  }

  if (system === 'ie') {
    if (/junior\s+infants|senior\s+infants|[1-6](st|nd|rd|th)?\s+class/.test(lower)) return 'Primary'
    if (/[1-6](st|nd|rd|th)?\s+year/.test(lower)) return 'Secondary'
    return null
  }

  return null
}

/** Regex patterns for INSET / closed-day inference per locale */
export const CLOSED_DAY_PATTERNS: Record<string, RegExp[]> = {
  'en-GB': [
    /\binset\b/i,
    /\btraining\b/i,
    /occasional\s+day/i,
    /school\s+closed\s+to\s+(?:students?|pupils?)/i,
  ],
  'en-US': [
    /professional\s+development/i,
    /\bpd\s+day\b/i,
    /teacher\s+work\s+day/i,
    /school\s+closed/i,
  ],
  'en-AU': [
    /pupil.?free\s+day/i,
    /student.?free\s+day/i,
    /school\s+closed/i,
  ],
  'en-IE': [
    /in.?service\s+day/i,
    /school\s+closed/i,
  ],
}

export function getClosedDayPatterns(locale: string): RegExp[] {
  return CLOSED_DAY_PATTERNS[locale] ?? CLOSED_DAY_PATTERNS['en-GB']
}
