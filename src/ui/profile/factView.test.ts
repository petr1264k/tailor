import { describe, expect, it } from 'vitest'
import { FACT_CATEGORIES, type Evidence, type Fact } from '@/types'
import { CATEGORY_ORDER, NO_FILTER, fullDate, groupForView, hasOwnWords, matchesFilter, quoteSource } from './factView'

const ev = (origin: string, title: string, quote = 'q', date = '2026-08-03'): Evidence => ({ origin, title, date, quote })

function fact(id: string, extra: Partial<Fact> = {}): Fact {
  return { id, category: 'owns', value: `value ${id}`, confidence: 0.5, source: 'chat', evidence: [ev('claude', 'Chat')], ...extra }
}

describe('groups', () => {
  it('puts every category in exactly one group', () => {
    expect([...CATEGORY_ORDER].sort()).toEqual([...FACT_CATEGORIES].sort())
  })

  it('orders live before deleted, then category order, then confidence', () => {
    const facts = [
      fact('interest', { category: 'interest', confidence: 0.9 }),
      fact('owns-low', { confidence: 0.3 }),
      fact('owns-deleted', { confidence: 1, userStatus: 'deleted' }),
      fact('owns-high', { confidence: 0.8 }),
    ]
    const own = groupForView(facts).find((g) => g.title === 'What you own and follow')!
    expect(own.facts.map((f) => f.id)).toEqual(['owns-high', 'owns-low', 'interest', 'owns-deleted'])
  })
})

describe('quoteSource', () => {
  it('labels chat quotes as the owner’s words with the origin and a full date', () => {
    expect(quoteSource(ev('chatgpt', 'TV'))).toEqual({ kind: 'own', label: '✎ Your words', name: 'TV', where: 'ChatGPT · Aug 3, 2026' })
  })

  it('recognizes Claude memory, project and artifact titles, and page evidence', () => {
    expect(quoteSource(ev('claude', 'Claude memory · hardware'))).toMatchObject({ kind: 'memory', label: 'Claude memory', name: 'hardware' })
    expect(quoteSource(ev('claude', 'Claude project · summary', 'q', '2024-12-24'))).toMatchObject({
      kind: 'project',
      label: 'Your project instructions',
      where: 'Dec 24, 2024',
    })
    expect(quoteSource(ev('claude', 'Claude artifact · Hybrid-V')).kind).toBe('artifact')
    expect(quoteSource(ev('https://www.bestbuy.com/tv', 'TVs'))).toMatchObject({ kind: 'clicks', where: 'bestbuy.com · Aug 3, 2026' })
  })

  it('drops an unparseable date', () => {
    expect(fullDate('soon')).toBe('')
    expect(quoteSource(ev('claude', 'Chat', 'q', 'soon')).where).toBe('Claude')
  })
})

describe('matchesFilter', () => {
  const memoryOnly = fact('m', { evidence: [ev('claude', 'Claude memory · x', 'runs LM Studio')] })
  const own = fact('o', { category: 'goal', value: 'building Tailor', evidence: [ev('claude', 'Hackathon', 'chrome extension or fork?')] })

  it('passes everything with no filter', () => {
    expect(matchesFilter(memoryOnly, NO_FILTER)).toBe(true)
  })

  it('filters by category, own words, and a case-insensitive search over value, quotes and titles', () => {
    expect(matchesFilter(own, { ...NO_FILTER, category: 'owns' })).toBe(false)
    expect(matchesFilter(own, { ...NO_FILTER, category: 'goal' })).toBe(true)
    expect(hasOwnWords(memoryOnly)).toBe(false)
    expect(matchesFilter(memoryOnly, { ...NO_FILTER, ownOnly: true })).toBe(false)
    expect(matchesFilter(own, { ...NO_FILTER, ownOnly: true })).toBe(true)
    expect(matchesFilter(own, { ...NO_FILTER, query: ' CHROME ' })).toBe(true)
    expect(matchesFilter(own, { ...NO_FILTER, query: 'hackathon' })).toBe(true)
    expect(matchesFilter(own, { ...NO_FILTER, query: 'synth' })).toBe(false)
    expect(matchesFilter(own, { ...NO_FILTER, query: 'layout' }, 'Layout: Specs first')).toBe(true)
  })
})
