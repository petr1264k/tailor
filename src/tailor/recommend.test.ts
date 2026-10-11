import { describe, expect, it, vi } from 'vitest'
import type { Fact, PageContent, PageEdit, PageRegion } from '@/types'
import { completeJson } from '@/llm/client'
import {
  amountOf,
  budgetOf,
  buildBrief,
  buildRecommendUserPrompt,
  candidatesOf,
  candidateTokens,
  checkPicks,
  claimsNotOnCard,
  cleanPickText,
  factFitsCard,
  mergeRecommendations,
  NO_RECOMMENDATIONS,
  picksToEdits,
  recommend,
  tokenFrequency,
  type Candidate,
} from './recommend'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))

const fact = (id: string, category: Fact['category'], value: string, quote = ''): Fact => ({
  id,
  category,
  value,
  confidence: 0.8,
  source: 'chat',
  evidence: quote ? [{ origin: 'chatgpt', title: 't', date: '2026-08-01', quote }] : [],
})

const macbook = fact('f-mac', 'owns', 'owns a MacBook Pro', 'my macbook pro dies halfway through a flight')
const budget = fact('f-budget', 'constraint', 'budget under $100 for a charger')
const japan = fact('f-japan', 'question', 'asks which travel adapter works in Japan', 'which adapter do I need for japan?')
const reading = fact('f-read', 'reading', 'prefers short sentences')

const regions: PageRegion[] = [
  { id: 'r1', role: 'hero', title: 'Fall Savings', segmentIds: ['s1'] },
  {
    id: 'r2',
    role: 'products',
    title: 'Must-Have Anker Selections',
    segmentIds: [],
    items: [
      { id: 'i1', title: 'Anker Prime Charger (140W, 3 ports)', price: '$89.99', wasPrice: '$109.99', detail: 'Fast charging for laptops', segmentIds: [] },
      { id: 'i2', title: 'Anker Nano Charger (65W)', price: '$39.99', detail: 'Compact fast charger', segmentIds: [] },
      { id: 'i3', title: 'Anker Desktop USB-C Hub', price: '$199.99', detail: 'Hub with HDMI 2.1 for your laptop', segmentIds: [] },
      { id: 'i4', title: 'Anker Universal Travel Adapter', price: '$45.99', detail: 'Works in 200 countries', segmentIds: [] },
      { id: 'i5', title: 'Anker Car Charger', price: '$19.99', detail: 'Fast charger for the road', segmentIds: [] },
      { id: 'i6', title: 'Anker Power Bank 10K', price: '$29.99', detail: 'Slim power bank', segmentIds: [] },
      { id: 'i7', title: 'Anker USB-C Cable 6ft', price: '$12.99', detail: 'Braided cable', segmentIds: [] },
      { id: 'i8', title: 'Anker MagGo Wireless Charger (Qi2)', price: '$49.99', detail: 'Magnetic wireless charging', segmentIds: [] },
      { id: 'i9', title: 'Anker Power Strip', price: '$24.99', detail: 'Surge protection for the home', segmentIds: [] },
    ],
  },
  { id: 'r3', role: 'reviews', title: 'Straight From Our Fans', segmentIds: [], items: [{ id: 'i10', title: 'Levi S.', segmentIds: [] }] },
  { id: 'r4', role: 'membership', title: 'Become a member', segmentIds: [], items: [{ id: 'i11', title: 'Free delivery', segmentIds: [] }] },
]

const vocabulary = [
  ['macbook', 'laptop', 'notebook', '140w', '100w', '65w'],
  ['travel', 'trip', 'flight', 'airport', 'adapter', 'portable', 'journey'],
  ['charger', 'charging', 'gan', 'watt', 'fast'],
]

const content: PageContent = {
  url: 'https://www.anker.com/',
  title: 'Anker',
  text: '',
  visibleText: '',
  jsonLd: [],
  links: [],
  source: 'readability',
  segments: [{ id: 's1', tag: 'h1', text: 'Fall Savings' }],
  site: { host: 'anker.com', name: 'Anker', kind: 'storefront' },
  regions,
}

const candidates = candidatesOf(content)
const brief = buildBrief([macbook, budget, japan, reading])
const tokensByItem = new Map(candidates.map((c) => [c.item.id, candidateTokens(c, content.url, vocabulary)]))
const df = tokenFrequency(tokensByItem)
const card = (id: string): Candidate => candidates.find((c) => c.item.id === id)!

describe('candidatesOf / buildBrief', () => {
  it('lists the cards of product, collection and category regions, never reviews, perks or stats', () => {
    expect(candidates.map((c) => c.item.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9'])
    expect(candidates[0]!.regionTitle).toBe('Must-Have Anker Selections')
  })
  it('groups shopping facts and leaves style facts out', () => {
    expect(brief.owns).toEqual([macbook])
    expect(brief.constraints).toEqual([budget])
    expect(brief.needs).toEqual([japan])
    expect(brief.interests).toEqual([])
  })
})

describe('factFitsCard (the fit check)', () => {
  it('lets "MacBook" meet a 140W charger through the site vocabulary', () => {
    expect(factFitsCard(macbook, card('i1'), tokensByItem.get('i1')!, df, candidates.length)).toBe(true)
  })
  it('rejects a pairing that rests only on a word every card has ("charger")', () => {
    const generic = fact('f-chg', 'interest', 'likes chargers')
    expect(factFitsCard(generic, card('i5'), tokensByItem.get('i5')!, df, candidates.length)).toBe(false)
  })
  it('rejects a fact with nothing to do with the card', () => {
    expect(factFitsCard(japan, card('i2'), tokensByItem.get('i2')!, df, candidates.length)).toBe(false)
    expect(factFitsCard(japan, card('i4'), tokensByItem.get('i4')!, df, candidates.length)).toBe(true)
  })
  it('lets a budget fit any priced card', () => {
    expect(factFitsCard(budget, card('i5'), tokensByItem.get('i5')!, df, candidates.length)).toBe(true)
  })
})

describe('claimsNotOnCard / budgets / text', () => {
  it('passes numbers that are on the card or in a cited fact, rejects a price copied from the neighbouring card', () => {
    expect(claimsNotOnCard('Full-speed MacBook charging on trips: 140W, $89.99', card('i1'), [macbook])).toEqual([])
    expect(claimsNotOnCard('$89.99: under your $100 budget', card('i1'), [budget])).toEqual([])
    expect(claimsNotOnCard('Enough for your MacBook: 65W, $39.99', card('i1'), [macbook]).length).toBeGreaterThan(0)
  })
  it('reads a budget from a constraint fact only, and a price from a card', () => {
    expect(budgetOf(budget)).toBe(100)
    expect(budgetOf(macbook)).toBeNull()
    expect(amountOf('$1,299.00')).toBe(1299)
    expect(amountOf(undefined)).toBeNull()
  })
  it('drops filler, ranks and superlatives, keeps one line', () => {
    expect(cleanPickText('This charger is great for you')).toBe('')
    expect(cleanPickText('#1 for your MacBook: 140W')).toBe('')
    expect(cleanPickText('Best charger here for your MacBook')).toBe('')
    expect(cleanPickText('The rest of this page is not for you')).toBe('')
    expect(cleanPickText('Full-speed  MacBook charging\n on trips: 140W, $89.99')).toBe('Full-speed MacBook charging on trips: 140W, $89.99')
  })
})

describe('checkPicks (code decides)', () => {
  it('keeps fitting picks in rank order, drops unknown cards, unfounded pairings and wrong numbers, and counts them', () => {
    const checked = checkPicks(
      {
        picks: [
          { item: 'i1', need: 'f-mac', text: 'Full-speed MacBook charging on trips: 140W, $89.99', factIds: ['f-mac', 'f-budget'] },
          { item: 'i5', need: 'f-mac', text: 'Charges your MacBook in the car: $19.99', factIds: ['f-mac'] }, // car charger: no laptop word on the card
          { item: 'i99', need: 'f-mac', text: 'Ghost card: $9.99', factIds: ['f-mac'] },
          { item: 'i2', need: 'f-mac', text: 'Enough for your MacBook on trips: 65W, $89.99', factIds: ['f-mac'] }, // $89.99 is i1's price
        ],
        skips: [{ item: 'i3', text: '$199.99: over your $100 budget', factIds: ['f-budget'] }],
        answer: { item: 'i4', questionId: 'f-japan', text: 'You asked about Japan: works in 200 countries, $45.99' },
      },
      brief,
      candidates,
      content.url,
      vocabulary,
    )
    expect(checked.picks.map((p) => p.item)).toEqual(['i1'])
    expect(checked.picks[0]!.factIds).toEqual(['f-mac', 'f-budget'])
    expect(checked.skips).toEqual([{ item: 'i3', text: '$199.99: over your $100 budget', factIds: ['f-budget'] }])
    expect(checked.answer).toEqual({ item: 'i4', text: 'You asked about Japan: works in 200 countries, $45.99', factIds: ['f-japan'] })
    expect(checked.rejected).toBe(3)
  })
  it('turns a pick over the stated budget into a heads-up written by code', () => {
    const checked = checkPicks(
      { picks: [{ item: 'i3', need: 'f-mac', text: 'HDMI 2.1 hub for your laptop desk: $199.99', factIds: ['f-mac'] }], skips: [], answer: null },
      brief,
      candidates,
      content.url,
      vocabulary,
    )
    expect(checked.picks).toEqual([])
    expect(checked.skips).toEqual([{ item: 'i3', text: '$199.99: over the $100 you set', factIds: ['f-budget', 'f-mac'] }])
  })
  it('caps picks at 3 and skips at 2, one per card, and needs a question fact for the answer', () => {
    const pick = (item: string) => ({ item, need: 'f-mac', text: 'Fits your laptop', factIds: ['f-mac'] })
    const checked = checkPicks(
      {
        picks: [pick('i1'), pick('i1'), pick('i2'), pick('i3'), pick('i4')].map((p) => ({ ...p, text: `${p.text}: ${card(p.item).item.price}` })),
        skips: [],
        answer: { item: 'i4', questionId: 'f-mac', text: 'Not a question fact' },
      },
      buildBrief([macbook]),
      candidates,
      content.url,
      vocabulary,
    )
    expect(checked.picks.map((p) => p.item)).toEqual(['i1', 'i2', 'i3'])
    expect(checked.answer).toBeNull()
  })
})

describe('picksToEdits / mergeRecommendations', () => {
  const checked = {
    picks: [
      { item: 'i1', text: 'Full-speed MacBook charging on trips: 140W, $89.99', factIds: ['f-mac'] },
      { item: 'i2', text: 'Enough for your MacBook on short trips: 65W, $39.99', factIds: ['f-mac'] },
    ],
    skips: [{ item: 'i3', text: '$199.99: over your $100 budget', factIds: ['f-budget'] }],
    answer: { item: 'i4', text: 'You asked about Japan: works in 200 countries, $45.99', factIds: ['f-japan'] },
    rejected: 0,
  }
  it('moves each pick to the front of its own shelf in rank order, then notes, warns and the answer; never moves a section', () => {
    const edits = picksToEdits(checked)
    expect(edits.map((e) => `${e.op}:${'id' in e ? e.id : 'after' in e ? e.after : ''}`)).toEqual([
      'promote:i1',
      'promote:i2',
      'note:i1',
      'note:i2',
      'warn:i3',
      'note:i4',
    ])
    expect(edits.some((e) => e.op === 'promote' && e.id.startsWith('r'))).toBe(false)
    const first = edits[0] as Extract<PageEdit, { op: 'promote' }>
    expect(first.reason).not.toMatch(/\d/)
  })
  it('with picks, drops the edit model’s notes, promotes and badges on covered cards and all its promotes, keeps the rest; without picks, leaves its edits alone', () => {
    const model: PageEdit[] = [
      { op: 'rewrite', id: 's1', text: 'Savings for your MacBook' },
      { op: 'hide', ids: ['r4'], label: 'Membership', reason: 'perks' },
      { op: 'note', after: 'i1', text: 'Duplicate on a picked card: $89.99', factIds: ['f-mac'] },
      { op: 'note', after: 'i5', text: 'Car charger: $19.99', factIds: ['f-mac'] },
      { op: 'warn', after: 'i3', text: 'Duplicate heads-up on a skipped card', factIds: ['f-budget'] },
      { op: 'promote', id: 'i5', reason: 'fits', factIds: ['f-mac'] },
      { op: 'badge', id: 's1', label: 'For you', factIds: ['f-mac'] },
    ]
    const picks = picksToEdits(checked)
    const merged = mergeRecommendations(model, picks)
    expect(merged.slice(0, picks.length)).toEqual(picks)
    expect(merged.slice(picks.length)).toEqual([model[0], model[1], model[3], model[6]])
    expect(mergeRecommendations(model, [])).toBe(model)
  })
  it('with a page map, drops the edit model’s promotes only in the shelves the picks reorder, so every other list still moves', () => {
    const regions: PageRegion[] = [
      { id: 'r1', role: 'products', title: 'Must-Have', segmentIds: [], items: [{ id: 'i1', title: 'A', segmentIds: [] }, { id: 'i2', title: 'B', segmentIds: [] }, { id: 'i5', title: 'E', segmentIds: [] }] },
      { id: 'r2', role: 'categories', title: 'By category', segmentIds: [], items: [{ id: 'i7', title: 'G', segmentIds: [] }, { id: 'i8', title: 'H', segmentIds: [] }] },
    ]
    const model: PageEdit[] = [
      { op: 'promote', id: 'i5', reason: 'fits', factIds: ['f-mac'] }, // the picks' shelf: theirs is the one order
      { op: 'promote', id: 'i7', reason: 'fits', factIds: ['f-mac'] }, // another shelf: the edit model's move stays
      { op: 'promote', id: 'i8', reason: 'fits', factIds: ['f-mac'] },
      { op: 'note', after: 'i7', text: 'Hubs: for your desk', factIds: ['f-mac'] },
    ]
    const picks = picksToEdits(checked)
    const merged = mergeRecommendations(model, picks, regions)
    expect(merged.slice(0, picks.length)).toEqual(picks)
    expect(merged.slice(picks.length)).toEqual([model[1], model[2], model[3]])
    // No map: shelves cannot be told apart, so the picks' structure is the only one (as before).
    expect(mergeRecommendations(model, picks).filter((e) => e.op === 'promote')).toEqual(picks.filter((e) => e.op === 'promote'))
  })
})

describe('recommend', () => {
  it('asks the model once with the brief and the cards, and returns checked edits plus counts', async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({
      value: {
        picks: [{ item: 'i1', need: 'f-mac', text: 'Full-speed MacBook charging on trips: 140W, $89.99', factIds: ['f-mac'] }],
        skips: [],
        answer: null,
      },
      model: 'claude-haiku-5-5',
      ms: 1,
      usage: { input: 1, output: 1, cacheRead: 0 },
    })
    const recs = await recommend(content, [macbook, budget, japan, reading])
    expect(recs.candidates).toBe(9)
    expect(recs.picks).toBe(1)
    expect(recs.edits.map((e) => e.op)).toEqual(['promote', 'note'])
    const call = vi.mocked(completeJson).mock.calls.at(-1)![0]
    expect(call.user).toContain('f-mac | owns | owns a MacBook Pro')
    expect(call.user).toContain('i1 | products shelf "Must-Have Anker Selections" | Anker Prime Charger (140W, 3 ports) | $89.99 (was $109.99)')
    expect(call.user).not.toContain('Levi S.')
  })
  it('never throws: a model failure means no recommendations', async () => {
    vi.mocked(completeJson).mockRejectedValueOnce(new Error('boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await recommend(content, [macbook])).toEqual(NO_RECOMMENDATIONS)
    warn.mockRestore()
  })
  it('skips the model when the page has no cards or the person has no shopping facts', async () => {
    vi.mocked(completeJson).mockClear()
    expect(await recommend({ ...content, regions: [] }, [macbook])).toEqual(NO_RECOMMENDATIONS)
    expect(await recommend(content, [reading])).toEqual(NO_RECOMMENDATIONS)
    expect(completeJson).not.toHaveBeenCalled()
  })
  it('writes the user prompt in the requested language label and puts the cards inside <page>', () => {
    const user = buildRecommendUserPrompt(content, brief, candidates, { language: 'ru' })
    expect(user).toContain('Language: Russian (ru)')
    expect(user.indexOf('<page>')).toBeLessThan(user.indexOf('i1 | products shelf'))
  })
})
