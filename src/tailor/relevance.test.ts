import { describe, expect, it } from 'vitest'
import type { Fact, FactCategory, PageContent, Profile } from '@/types'
import { selectRelevantFacts, tokenize } from './relevance'

function fact(id: string, category: FactCategory, value: string, quote = '', extra: Partial<Fact> = {}): Fact {
  return {
    id,
    category,
    value,
    confidence: 0.8,
    source: 'chat',
    evidence: quote ? [{ origin: 'chatgpt', title: 't', date: '2026-08-03', quote }] : [],
    ...extra,
  }
}

function profile(facts: Fact[]): Profile {
  return { version: 3, facts, shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } }
}

const TV: PageContent = {
  url: 'https://shop.example.com/tv',
  title: 'Samsung 65" QN90D Neo QLED 4K TV',
  text: 'Four HDMI 2.1 ports support 4K at 120Hz, so a PS5 or Xbox Series X runs at full frame rate. Price $1,299.99. Wall mount sold separately.',
  visibleText: '',
  jsonLd: [],
  links: [],
  source: 'readability',
}

describe('tokenize', () => {
  it('lowercases, keeps letters/digits, drops stopwords and short tokens, folds plurals', () => {
    expect(tokenize('Just got a PS5, which TV should I get? HDMI ports!')).toEqual(['ps5', 'hdmi', 'port'])
    expect(tokenize('Купил PS5 для гостиной')).toEqual(['купил', 'ps5', 'гостиной'])
  })
})

describe('selectRelevantFacts', () => {
  const ps5 = fact('f-ps5', 'owns', 'owns a PS5', 'just got a PS5, which TV should I get?')
  const hiking = fact('f-hike', 'interest', 'likes hiking', 'planning a hiking trip to Yosemite in May')
  const bullets = fact('f-bullets', 'reading', 'prefers bullet points over prose')

  it('ranks an owns-PS5 fact above an unrelated hiking fact on a TV page', async () => {
    const got = await selectRelevantFacts(profile([hiking, ps5]), TV)
    const ids = got.map((f) => f.id)
    expect(ids).toContain('f-ps5')
    expect(ids.indexOf('f-ps5')).toBeLessThan(ids.includes('f-hike') ? ids.indexOf('f-hike') : Infinity)
    expect(ids).not.toContain('f-hike') // zero overlap: never sent to the model
  })

  it('always includes output-style facts and never deleted ones', async () => {
    const deletedPs5 = { ...ps5, id: 'f-del', userStatus: 'deleted' as const }
    const got = await selectRelevantFacts(profile([hiking, bullets, deletedPs5]), TV)
    expect(got.map((f) => f.id)).toEqual(['f-bullets'])
  })

  it('leaves learned layout facts out (they reach the rewrite as the Layout line)', async () => {
    const layout = fact('behavior-layout-specs_first', 'reading', 'layout:specs_first', 'expanded the specs table', { source: 'behavior' })
    const got = await selectRelevantFacts(profile([ps5, bullets, layout]), TV)
    expect(got.map((f) => f.id)).toEqual(expect.arrayContaining(['f-ps5', 'f-bullets']))
    expect(got.map((f) => f.id)).not.toContain('behavior-layout-specs_first')
  })

  it('respects max and orders by score', async () => {
    const wall = fact('f-wall', 'constraint', 'needs a wall mount for a 65 inch TV', 'is the wall mount included?')
    const gamer = fact('f-xbox', 'interest', 'plays games on Xbox Series X at 120Hz')
    const got = await selectRelevantFacts(profile([hiking, ps5, wall, gamer, bullets]), TV, 2)
    expect(got).toHaveLength(2)
    expect(got.map((f) => f.id)).not.toContain('f-hike')
  })
})
