import { describe, expect, it, vi } from 'vitest'
import type { Fact, PageContent, PageEdit } from '@/types'
import { completeJson } from '@/llm/client'
import { buildEditUserPrompt, checkEdits, editsToBlocks, promptSegments, proposeEdits } from './edit'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))

const facts: Fact[] = [
  {
    id: 'f-ps5',
    category: 'owns',
    value: 'owns a PS5',
    confidence: 0.9,
    source: 'chat',
    evidence: [{ origin: 'chatgpt', title: 'TV', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
  },
  { id: 'f-simple', category: 'reading', value: 'prefers short plain sentences', confidence: 0.7, source: 'chat', evidence: [] },
]

const content: PageContent = {
  url: 'https://shop.example.com/tv?session=abc',
  title: 'Samsung 65" QN90D',
  text: 'ignored by the edit prompt',
  visibleText: 'ignored by the edit prompt',
  jsonLd: [{ '@type': 'Product', name: 'QN90D' }],
  links: [],
  source: 'readability',
  segments: [
    { id: 's1', tag: 'h1', text: 'Samsung 65" QN90D' },
    { id: 's2', tag: 'p', text: 'Four HDMI 2.1 ports support 4K at 120Hz.' },
    { id: 's3', tag: 'p', text: 'Loved by families everywhere.' },
  ],
  lang: 'en',
}

describe('buildEditUserPrompt', () => {
  it('lists segments as "id [tag] text" inside <page>, the facts, language and level, and drops the query string', () => {
    const user = buildEditUserPrompt(content, facts, { readingLevel: 'simple' })
    expect(user).toContain('Language: English (en)')
    expect(user).toContain('Reading level: simple:')
    expect(user).toContain('f-ps5 | owns | owns a PS5')
    expect(user).toContain('s1 [h1] Samsung 65" QN90D')
    expect(user).toContain('s2 [p] Four HDMI 2.1 ports support 4K at 120Hz.')
    expect(user).toContain('URL: https://shop.example.com/tv')
    expect(user).not.toContain('session=abc')
    expect(user).toContain('Structured data (JSON-LD)')
    expect(user.indexOf('<page>')).toBeLessThan(user.indexOf('s1 [h1]'))
  })

  it('promptSegments keeps the top of the page within the budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `s${i + 1}`, tag: 'p', text: 'x'.repeat(100) }))
    const kept = promptSegments(many, 1_200)
    expect(kept.length).toBeGreaterThan(5)
    expect(kept.length).toBeLessThan(50)
    expect(kept[0]!.id).toBe('s1')
  })
})

describe('checkEdits', () => {
  it('drops notes without a known fact, filters fact ids, and caps notes at 18 and warns at 4', () => {
    const note = (i: number): PageEdit => ({ op: 'note', after: 's1', text: `n${i}`, factIds: ['f-ps5', 'nope'] })
    const warn = (i: number): PageEdit => ({ op: 'warn', after: 's1', text: `w${i}`, factIds: ['f-ps5'] })
    const out = checkEdits(
      [
        { op: 'note', after: 's1', text: 'unbacked', factIds: ['nope'] },
        ...Array.from({ length: 20 }, (_, i) => note(i + 1)),
        ...[1, 2, 3, 4, 5, 6].map(warn),
        { op: 'rewrite', id: 's2', text: 'Short.', factIds: ['nope', 'f-simple'] },
        { op: 'rewrite', id: 's1', text: 'Plain.', factIds: ['nope'] },
        { op: 'hide', ids: ['s3'], label: 'Praise', reason: 'filler' },
      ],
      facts,
    )
    expect(out.filter((e) => e.op === 'note')).toHaveLength(18)
    expect(out.filter((e) => e.op === 'warn')).toHaveLength(4)
    expect(out.find((e) => e.op === 'note')).toEqual({ op: 'note', after: 's1', text: 'n1', factIds: ['f-ps5'] })
    expect(out.find((e) => e.op === 'rewrite' && e.id === 's2')).toEqual({ op: 'rewrite', id: 's2', text: 'Short.', factIds: ['f-simple'] })
    expect(out.find((e) => e.op === 'rewrite' && e.id === 's1')).toEqual({ op: 'rewrite', id: 's1', text: 'Plain.' })
    expect(out.at(-1)).toEqual({ op: 'hide', ids: ['s3'], label: 'Praise', reason: 'filler' })
  })

  it('drops notes, warns, badges and promote reasons that dismiss the page as not for this person (rule 5b)', () => {
    const out = checkEdits(
      [
        { op: 'note', after: 's1', text: "The rest of this page is about outdoor gear, which doesn't tie to your current work.", factIds: ['f-ps5'] },
        { op: 'note', after: 's1', text: 'Not for you: no PS5 here.', factIds: ['f-ps5'] },
        { op: 'warn', after: 's1', text: 'This section is unrelated to your setup.', factIds: ['f-ps5'] },
        { op: 'badge', id: 's1', label: 'Skip this', factIds: ['f-ps5'] },
        { op: 'promote', id: 's1', reason: 'The rest of the page is irrelevant to you', factIds: ['f-ps5'] },
        { op: 'note', after: 's1', text: '120 Hz: matches your PS5.', factIds: ['f-ps5'] },
        { op: 'warn', after: 's1', text: '$1,799: $300 over your budget.', factIds: ['f-ps5'] },
        { op: 'note', after: 's1', text: 'Fits runs outside your gym.', factIds: ['f-ps5'] },
      ],
      facts,
    )
    expect(out.map((e) => (e.op === 'note' || e.op === 'warn' ? e.text : e.op))).toEqual(['120 Hz: matches your PS5.', '$1,799: $300 over your budget.', 'Fits runs outside your gym.'])
  })
})

describe('editsToBlocks', () => {
  it('projects edits onto the frozen block vocabulary in order', () => {
    const blocks = editsToBlocks(
      [
        { op: 'note', after: 's2', text: 'Works with your PS5.', factIds: ['f-ps5'] },
        { op: 'rewrite', id: 's1', text: 'Samsung QN90D, 65"' },
        { op: 'rewrite', id: 's2', text: 'Four HDMI 2.1 ports. 4K at 120Hz.' },
        { op: 'hide', ids: ['s3'], label: 'Praise', reason: 'you skip hype' },
        { op: 'warn', after: 's1', text: 'Over budget.', factIds: ['f-ps5'] },
      ],
      content.segments,
    )
    expect(blocks).toEqual([
      { type: 'for_you', text: 'Works with your PS5.', factIds: ['f-ps5'] },
      { type: 'section', heading: 'Samsung QN90D, 65"', text: '' },
      { type: 'section', heading: 'Four HDMI 2.1 ports support 4K at 120Hz.', text: 'Four HDMI 2.1 ports. 4K at 120Hz.' },
      { type: 'hidden', label: 'Praise', reason: 'you skip hype' },
      { type: 'warning', text: 'Over budget.', factIds: ['f-ps5'] },
    ])
  })
})

describe('proposeEdits', () => {
  it('asks the rewrite model with the edit schema and returns checked edits', async () => {
    vi.mocked(completeJson).mockResolvedValue({
      value: { edits: [{ op: 'note', after: 's2', text: 'PS5 ready.', factIds: ['f-ps5', 'ghost'] }] },
      model: 'm',
      ms: 1,
      usage: { input: 0, output: 0, cacheRead: 0 },
    })
    const edits = await proposeEdits(content, facts)
    expect(edits).toEqual([{ op: 'note', after: 's2', text: 'PS5 ready.', factIds: ['f-ps5'] }])
    const call = vi.mocked(completeJson).mock.calls[0]![0]
    expect(call.role).toBe('rewrite')
    expect(call.system).toContain('"op":"rewrite"')
    expect(call.user).toContain('s2 [p]')
  })
})

describe('page map: prompt, checkEdits caps, editsToBlocks', () => {
  const regions = [
    { id: 'r1', role: 'hero' as const, title: 'Fall Savings Start Now', segmentIds: ['s1'] },
    {
      id: 'r2',
      role: 'products' as const,
      title: 'Must-Have Selections',
      segmentIds: ['s2'],
      items: [{ id: 'i1', title: 'Laptop Power Bank (25K, 165W)', price: '$129.99', wasPrice: '$149.99', detail: 'Charges a MacBook Pro', segmentIds: ['s2'] }],
    },
  ]
  const store: PageContent = { ...content, url: 'https://www.anker.com/', site: { host: 'anker.com', name: 'Anker', kind: 'storefront' }, regions }

  it('puts the page map in the prompt, with the site and the cards as the page shows them', () => {
    const prompt = buildEditUserPrompt(store, facts)
    expect(prompt).toContain('Page map of Anker (anker.com, a storefront) (region id | role | title | items):')
    expect(prompt).toContain('r1 | hero | Fall Savings Start Now | s1–s1')
    expect(prompt).toContain('r2 | products | Must-Have Selections | items: i1 Laptop Power Bank (25K, 165W) — $129.99 (was $149.99) — Charges a MacBook Pro')
    expect(buildEditUserPrompt(content, facts)).not.toContain('Page map')
  })

  it('checkEdits keeps promotes and badges only with known facts, one promote per target, within the caps', () => {
    const many: PageEdit[] = [
      { op: 'promote', id: 'r2', reason: 'first', factIds: ['f-ps5'] },
      { op: 'promote', id: 'r2', reason: 'again', factIds: ['f-ps5'] },
      { op: 'promote', id: 'i1', reason: 'no evidence', factIds: ['f-nope'] },
      ...Array.from({ length: 8 }, (_, i) => ({ op: 'badge' as const, id: `i${i + 1}`, label: `b${i}`, factIds: ['f-ps5'] })),
      { op: 'badge', id: 'i9', label: 'no evidence', factIds: [] },
    ]
    const out = checkEdits(many, facts)
    expect(out.filter((e) => e.op === 'promote')).toEqual([{ op: 'promote', id: 'r2', reason: 'first', factIds: ['f-ps5'] }])
    expect(out.filter((e) => e.op === 'badge')).toHaveLength(6)
  })

  it('editsToBlocks turns promotes and badges into for_you blocks named after the region or card', () => {
    const blocks = editsToBlocks(
      [
        { op: 'promote', id: 'r2', reason: 'Power banks first for your trips.', factIds: ['f-ps5'] },
        { op: 'badge', id: 'i1', label: '165W: enough for a MacBook Pro', factIds: ['f-ps5'] },
        { op: 'hide', ids: ['r1'], label: 'Sale banner', reason: 'not for you' },
      ],
      content.segments,
      regions,
    )
    expect(blocks).toEqual([
      { type: 'for_you', text: 'Moved up: Must-Have Selections. Power banks first for your trips.', factIds: ['f-ps5'] },
      { type: 'for_you', text: 'Laptop Power Bank (25K, 165W): 165W: enough for a MacBook Pro', factIds: ['f-ps5'] },
      { type: 'hidden', label: 'Sale banner', reason: 'not for you' },
    ])
  })
})
