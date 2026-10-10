import { describe, expect, it } from 'vitest'
import type { Fact } from '@/types'
import {
  attempt,
  confidencePct,
  factValues,
  groupFactsByCategory,
  isZipFile,
  monthRange,
  neverExtractedRows,
  originLabel,
  profileIdFromName,
  shortDate,
  siteLabel,
  totalCount,
  truncate,
} from './helpers'

const NOW = new Date('2026-10-10T19:00:00Z')

function fact(id: string, patch: Partial<Fact> = {}): Fact {
  return { id, category: 'interest', value: `fact ${id}`, confidence: 0.5, source: 'chat', evidence: [], ...patch }
}

describe('attempt', () => {
  it('returns the value, or the error text for sync and async throws', async () => {
    expect(await attempt(() => 3)).toEqual({ ok: true, value: 3 })
    expect(await attempt(async () => 'x')).toEqual({ ok: true, value: 'x' })
    expect(
      await attempt(() => {
        throw new Error('TODO(profile.getProfile)')
      }),
    ).toEqual({ ok: false, error: 'TODO(profile.getProfile)' })
    expect(await attempt(() => Promise.reject('boom'))).toEqual({ ok: false, error: 'boom' })
  })
})

describe('labels', () => {
  it('names origins and sites', () => {
    expect(originLabel('chatgpt')).toBe('ChatGPT')
    expect(originLabel('claude')).toBe('Claude')
    expect(originLabel('https://www.coframe.com/pricing')).toBe('coframe.com')
    expect(siteLabel('not a url')).toBe('not a url')
  })
})

describe('dates', () => {
  it('formats date-only strings as calendar dates, adds the year only when it differs', () => {
    expect(shortDate('2026-08-03', NOW)).toBe('Aug 3')
    expect(shortDate('2025-08-03', NOW)).toBe('Aug 3, 2025')
    expect(shortDate('2026-08-03T12:00:00Z', NOW)).toBe('Aug 3')
    expect(shortDate('', NOW)).toBe('')
    expect(shortDate('garbage', NOW)).toBe('')
  })

  it('formats a month range', () => {
    expect(monthRange('2025-11-02T00:00:00Z', '2026-10-09T00:00:00Z')).toBe('Nov 2025 – Oct 2026')
    expect(monthRange('2026-10-01', '2026-10-09')).toBe('Oct 2026')
    expect(monthRange('', '')).toBe('—')
  })
})

describe('groupFactsByCategory', () => {
  it('orders groups by FACT_CATEGORIES, facts by confidence, deleted last, skips empty groups', () => {
    const groups = groupFactsByCategory([
      fact('q', { category: 'question' }),
      fact('a', { confidence: 0.2 }),
      fact('b', { confidence: 0.9, userStatus: 'deleted' }),
      fact('c', { confidence: 0.7 }),
      fact('r', { category: 'reading' }),
    ])
    expect(groups.map((g) => g.category)).toEqual(['reading', 'interest', 'question'])
    expect(groups[1]!.facts.map((f) => f.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('small helpers', () => {
  it('truncate', () => {
    expect(truncate('  short  ', 10)).toBe('short')
    expect(truncate('abcdefghijkl', 6)).toBe('abcde…')
  })

  it('confidencePct clamps', () => {
    expect(confidencePct(0.734)).toBe(73)
    expect(confidencePct(2)).toBe(100)
    expect(confidencePct(-1)).toBe(0)
    expect(confidencePct(Number.NaN)).toBe(0)
  })

  it('factValues looks up ids and keeps unknown ones visible', () => {
    expect(factValues(['a', 'zz'], [fact('a')])).toEqual(['fact a', '(fact zz)'])
  })

  it('isZipFile', () => {
    expect(isZipFile('export.zip', '')).toBe(true)
    expect(isZipFile('data', 'application/zip')).toBe(true)
    expect(isZipFile('conversations.json', 'application/json')).toBe(false)
  })
})

describe('profileIdFromName', () => {
  it('slugifies and de-duplicates', () => {
    expect(profileIdFromName('Mikhail', [])).toBe('mikhail')
    expect(profileIdFromName('  Petr K. ', [])).toBe('petr-k')
    expect(profileIdFromName('Petr', ['petr', 'petr-2'])).toBe('petr-3')
    expect(profileIdFromName('!!!', [])).toBe('profile')
  })
})

describe('neverExtractedRows', () => {
  it('lists every sensitive category, then extra keys', () => {
    const rows = neverExtractedRows({ health: 3, names: 1, weird: 2 })
    expect(rows.find((r) => r.key === 'health')).toEqual({ key: 'health', label: 'Health', count: 3 })
    expect(rows.find((r) => r.key === 'religion')!.count).toBe(0)
    expect(rows.at(-1)).toEqual({ key: 'weird', label: 'weird', count: 2 })
    expect(totalCount({ health: 3, names: 1, weird: 2 })).toBe(6)
  })
})
