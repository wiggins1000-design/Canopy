import { describe, it, expect } from 'vitest'
import {
  classifyTermEvent,
  typePriority,
  buildTermDaysMap,
  validateManualEntry,
  resolveManualTitle,
} from '../../src/lib/termDatesUtils.js'

describe('classifyTermEvent', () => {
  it('returns inset for lowercase inset in title', () => {
    expect(classifyTermEvent('inset day', null)).toBe('inset')
  })
  it('returns inset for uppercase INSET', () => {
    expect(classifyTermEvent('INSET Day', null)).toBe('inset')
  })
  it('returns inset when embedded in a longer title', () => {
    expect(classifyTermEvent('School INSET training', null)).toBe('inset')
  })
  it('returns inset even when endDate is also set', () => {
    expect(classifyTermEvent('INSET Day', '2024-09-02')).toBe('inset')
  })
  it('returns holiday when title has no inset but endDate is set', () => {
    expect(classifyTermEvent('Half Term', '2024-10-25')).toBe('holiday')
  })
  it('returns null when title has no inset and endDate is null', () => {
    expect(classifyTermEvent('Term starts', null)).toBe(null)
  })
  it('handles null title with endDate → holiday', () => {
    expect(classifyTermEvent(null, '2024-12-20')).toBe('holiday')
  })
  it('handles null title with no endDate → null', () => {
    expect(classifyTermEvent(null, null)).toBe(null)
  })
})

describe('typePriority', () => {
  it('gives inset the highest priority (2)', () => {
    expect(typePriority('inset')).toBe(2)
  })
  it('gives holiday mid priority (1)', () => {
    expect(typePriority('holiday')).toBe(1)
  })
  it('gives null lowest priority (0)', () => {
    expect(typePriority(null)).toBe(0)
  })
  it('gives unknown type lowest priority (0)', () => {
    expect(typePriority('other')).toBe(0)
  })
})

describe('buildTermDaysMap', () => {
  it('returns empty Map for empty array', () => {
    expect(buildTermDaysMap([])).toEqual(new Map())
  })

  it('returns empty Map for null', () => {
    expect(buildTermDaysMap(null)).toEqual(new Map())
  })

  it('maps a single INSET day to its date', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-09-02', end_date: null, title: 'INSET Day', source_subject: "St Mary's" },
    ])
    expect(map.has('2024-09-02')).toBe(true)
    expect(map.get('2024-09-02')[0].type).toBe('inset')
    expect(map.get('2024-09-02')[0].schoolName).toBe("St Mary's")
  })

  it('maps a multi-day holiday to every date in the range', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: '2024-10-25', title: 'Half Term', source_subject: 'School' },
    ])
    expect(map.size).toBe(5)
    expect(map.has('2024-10-21')).toBe(true)
    expect(map.has('2024-10-23')).toBe(true)
    expect(map.has('2024-10-25')).toBe(true)
    expect(map.has('2024-10-26')).toBe(false)
    expect(map.get('2024-10-21')[0].type).toBe('holiday')
  })

  it('INSET overrides holiday for same school on same day (INSET added second)', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: '2024-10-25', title: 'Half Term', source_subject: 'School' },
      { event_date: '2024-10-21', end_date: null,         title: 'INSET Day',  source_subject: 'School' },
    ])
    expect(map.get('2024-10-21')[0].type).toBe('inset')
  })

  it('INSET overrides holiday regardless of event order (INSET added first)', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: null,         title: 'INSET Day',  source_subject: 'School' },
      { event_date: '2024-10-21', end_date: '2024-10-25', title: 'Half Term', source_subject: 'School' },
    ])
    expect(map.get('2024-10-21')[0].type).toBe('inset')
  })

  it('holiday does not override INSET for the same school', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: null,         title: 'INSET Day',  source_subject: 'School' },
      { event_date: '2024-10-21', end_date: '2024-10-25', title: 'Half Term', source_subject: 'School' },
    ])
    expect(map.get('2024-10-21')).toHaveLength(1)
    expect(map.get('2024-10-21')[0].type).toBe('inset')
  })

  it('two schools on same day each get independent entries', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: null, title: 'INSET Day', source_subject: 'School A' },
      { event_date: '2024-10-21', end_date: null, title: 'INSET Day', source_subject: 'School B' },
    ])
    expect(map.get('2024-10-21')).toHaveLength(2)
  })

  it('assigns school indices alphabetically (lower alpha = lower index)', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-09-02', end_date: null, title: 'INSET Day', source_subject: 'Zelda School' },
      { event_date: '2024-09-03', end_date: null, title: 'INSET Day', source_subject: 'Alpha School' },
    ])
    expect(map.get('2024-09-03')[0].schoolIndex).toBe(0) // Alpha
    expect(map.get('2024-09-02')[0].schoolIndex).toBe(1) // Zelda
  })

  it('defaults missing source_subject to "School"', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-09-02', end_date: null, title: 'INSET Day' },
    ])
    expect(map.get('2024-09-02')[0].schoolName).toBe('School')
  })

  it('skips events that classify as null (no inset keyword, no endDate)', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-09-02', end_date: null, title: 'Term starts', source_subject: 'School' },
    ])
    expect(map.size).toBe(0)
  })

  it('two schools sharing the same holiday dates each appear on every day', () => {
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: '2024-10-22', title: 'Half Term', source_subject: 'School A' },
      { event_date: '2024-10-21', end_date: '2024-10-22', title: 'Half Term', source_subject: 'School B' },
    ])
    expect(map.get('2024-10-21')).toHaveLength(2)
    expect(map.get('2024-10-22')).toHaveLength(2)
  })

  it('regression: name-variants of the same school (punctuation/suffix drift) collapse to one entry', () => {
    // Real bug: two siblings' Info Bank records for the identical school captured
    // as "St. Nicholas" vs "St Nicholas" (e.g. one rescraped with an official-name
    // suffix) showed up as two separately-coloured schools on the calendar.
    const map = buildTermDaysMap([
      { event_date: '2024-10-21', end_date: null, title: 'INSET Day', source_subject: 'St. Nicholas' },
      { event_date: '2024-10-21', end_date: null, title: 'INSET Day', source_subject: 'St Nicholas C of E Primary School' },
    ])
    expect(map.get('2024-10-21')).toHaveLength(1)
  })
})

describe('validateManualEntry', () => {
  it('returns error when addDate is empty', () => {
    expect(validateManualEntry({ addType: 'inset', addDate: '', addEnd: '' })).toBe('Enter a date.')
  })

  it('returns null for valid INSET entry', () => {
    expect(validateManualEntry({ addType: 'inset', addDate: '2024-09-02', addEnd: '' })).toBeNull()
  })

  it('returns error for holiday with no end date', () => {
    expect(validateManualEntry({ addType: 'holiday', addDate: '2024-10-21', addEnd: '' })).toBe('Enter an end date.')
  })

  it('returns error for holiday where end date is before start date', () => {
    expect(validateManualEntry({ addType: 'holiday', addDate: '2024-10-25', addEnd: '2024-10-21' })).toBe('End date must be after start date.')
  })

  it('returns null for valid holiday (end after start)', () => {
    expect(validateManualEntry({ addType: 'holiday', addDate: '2024-10-21', addEnd: '2024-10-25' })).toBeNull()
  })

  it('returns null for single-day holiday (end equals start)', () => {
    expect(validateManualEntry({ addType: 'holiday', addDate: '2024-10-21', addEnd: '2024-10-21' })).toBeNull()
  })
})

describe('resolveManualTitle', () => {
  it('always returns "INSET Day" for inset type regardless of addTitle', () => {
    expect(resolveManualTitle({ addType: 'inset', addTitle: 'Summer Holiday', addCustom: '' })).toBe('INSET Day')
  })

  it('returns addTitle for a named holiday', () => {
    expect(resolveManualTitle({ addType: 'holiday', addTitle: 'Half Term', addCustom: '' })).toBe('Half Term')
  })

  it('returns trimmed addCustom when addTitle is "Other"', () => {
    expect(resolveManualTitle({ addType: 'holiday', addTitle: 'Other', addCustom: '  Snow Day  ' })).toBe('Snow Day')
  })

  it('returns empty string when addTitle is "Other" and addCustom is null', () => {
    expect(resolveManualTitle({ addType: 'holiday', addTitle: 'Other', addCustom: null })).toBe('')
  })
})
