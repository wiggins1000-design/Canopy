import { describe, it, expect } from 'vitest'
import { validateEmail, validateUrl } from '../../src/lib/validationUtils.js'

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
