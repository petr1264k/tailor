import { describe, expect, it } from 'vitest'
import { scrubForSharing } from './index'

describe('scrubForSharing', () => {
  it('removes an email and a phone and keeps the rest', () => {
    const r = scrubForSharing('Looking for a 65-inch TV for my PS5, budget $800. Reach me at petr@example.com or (415) 555-1234.')
    expect(r.text).not.toContain('petr@example.com')
    expect(r.text).not.toMatch(/555/)
    expect(r.text).toContain('Looking for a 65-inch TV for my PS5, budget $800.')
    expect(r.removed).toEqual(['contact'])
  })

  it('drops the name after "my <relation>" but keeps the relation', () => {
    const r = scrubForSharing('Choosing a laptop with my wife Anna for her design work.')
    expect(r.text).toBe('Choosing a laptop with my wife for her design work.')
    expect(r.removed).toEqual(['names'])
  })

  it('handles "+7 999 123 45 67" style numbers and "my boss, Dmitry"', () => {
    const r = scrubForSharing('Ask my boss, Dmitry, or text +7 999 123 45 67.')
    expect(r.text).not.toContain('Dmitry')
    expect(r.text).not.toMatch(/999/)
    expect(r.removed).toEqual(['names', 'contact'])
  })

  it('returns clean text untouched', () => {
    const text = 'CTO evaluating tools that fit an existing React stack; needs SOC 2.'
    expect(scrubForSharing(text)).toEqual({ text, removed: [] })
  })
})
