import { describe, it, expect } from 'vitest'
import { validateEmail, validateUrl, mergeExtractedSchoolInfo } from '../../src/lib/validationUtils.js'

describe('validateEmail', () => {
  it('returns null for empty string (field is optional)', () => {
    expect(validateEmail('')).toBeNull()
  })
  it('returns null for null', () => {
    expect(validateEmail(null)).toBeNull()
  })
  it('returns null for a standard valid email', () => {
    expect(validateEmail('user@example.com')).toBeNull()
  })
  it('returns null for email with subdomain', () => {
    expect(validateEmail('user@mail.example.co.uk')).toBeNull()
  })
  it('returns error string for missing @', () => {
    expect(validateEmail('notanemail')).toBeTruthy()
  })
  it('returns error string for missing TLD (no dot after @)', () => {
    expect(validateEmail('user@domain')).toBeTruthy()
  })
  it('returns error string for email with a space', () => {
    expect(validateEmail('user @example.com')).toBeTruthy()
  })
  it('returns error string for double @', () => {
    expect(validateEmail('a@@b.com')).toBeTruthy()
  })
})

describe('validateUrl', () => {
  it('returns null for empty string (field is optional)', () => {
    expect(validateUrl('')).toBeNull()
  })
  it('returns null for null', () => {
    expect(validateUrl(null)).toBeNull()
  })
  it('returns null for a valid https URL', () => {
    expect(validateUrl('https://stmarys.sch.uk')).toBeNull()
  })
  it('returns null for a valid http URL', () => {
    expect(validateUrl('http://stmarys.sch.uk')).toBeNull()
  })
  it('auto-adds https:// for a bare domain', () => {
    expect(validateUrl('stmarys.sch.uk')).toBeNull()
  })
  it('auto-adds https:// for a www domain', () => {
    expect(validateUrl('www.stmarys.sch.uk')).toBeNull()
  })
  it('returns error for hostname with no dot (e.g. localhost)', () => {
    expect(validateUrl('https://localhost')).toBeTruthy()
  })
  it('returns error for a completely invalid string', () => {
    expect(validateUrl('not a url!!')).toBeTruthy()
  })
})

describe('mergeExtractedSchoolInfo', () => {
  const prevWithOldSchool = {
    school_name: 'St Nicholas CE Primary School',
    school_address: '1 Old Rd',
    school_phone: '01234 000000',
    school_email: 'office@stnicholas.example',
    head_teacher: 'Mrs Old',
    hours: '8:45am-3:15pm',
  }

  it('same school (schoolChanged=false): only fills blanks, never clobbers existing values', () => {
    const info = { school_phone: '09999 999999', head_teacher: 'Mr New' }
    const result = mergeExtractedSchoolInfo(prevWithOldSchool, info, false)
    expect(result.school_phone).toBe('01234 000000') // kept, not overwritten
    expect(result.head_teacher).toBe('Mrs Old')       // kept, not overwritten
  })

  it('same school (schoolChanged=false): fills a field that was actually blank', () => {
    const prev = { ...prevWithOldSchool, hours: '' }
    const result = mergeExtractedSchoolInfo(prev, { school_hours: '9am-3pm' }, false)
    expect(result.hours).toBe('9am-3pm')
  })

  // Regression: switching a child's school to Reddam House, but Reddam's page didn't
  // list a phone number — the OLD school's phone must not survive under Reddam's name.
  it('school changed (schoolChanged=true): clears a field the new school extraction did not find', () => {
    const result = mergeExtractedSchoolInfo(prevWithOldSchool, { school_name: 'Reddam House' }, true)
    expect(result.school_name).toBe('Reddam House')
    expect(result.school_phone).toBe('')
    expect(result.school_email).toBe('')
    expect(result.head_teacher).toBe('')
    expect(result.hours).toBe('')
    expect(result.school_address).toBe('')
  })

  it('school changed (schoolChanged=true): still fills in whatever the new school extraction DID find', () => {
    const info = { school_name: 'Reddam House', school_phone: '01111 222333', head_teacher: 'Ms New' }
    const result = mergeExtractedSchoolInfo(prevWithOldSchool, info, true)
    expect(result.school_phone).toBe('01111 222333')
    expect(result.head_teacher).toBe('Ms New')
    expect(result.school_email).toBe('') // not found by this extraction, correctly cleared
  })

  it('school changed (schoolChanged=true): keeps the manually-typed school_name if extraction found none', () => {
    const result = mergeExtractedSchoolInfo(prevWithOldSchool, {}, true)
    expect(result.school_name).toBe('St Nicholas CE Primary School')
  })
})
