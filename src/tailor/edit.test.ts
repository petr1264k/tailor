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
  it('drops notes without a known fact, filters fact ids, and caps notes at 4 and warns at 2', () => {
    const note = (i: number): PageEdit => ({ op: 'note', after: 's1', text: `n${i}`, factIds: ['f-ps5', 'nope'] })
    const warn = (i: number): PageEdit => ({ op: 'warn', after: 's1', text: `w${i}`, factIds: ['f-ps5'] })
    const out = checkEdits(
      [
        { op: 'note', after: 's1', text: 'unbacked', factIds: ['nope'] },
        ...[1, 2, 3, 4, 5].map(note),
        ...[1, 2, 3].map(warn),
        { op: 'rewrite', id: 's2', text: 'Short.', factIds: ['nope', 'f-simple'] },
        { op: 'rewrite', id: 's1', text: 'Plain.', factIds: ['nope'] },
        { op: 'hide', ids: ['s3'], label: 'Praise', reason: 'filler' },
      ],
      facts,
    )
    expect(out.filter((e) => e.op === 'note')).toHaveLength(4)
    expect(out.filter((e) => e.op === 'warn')).toHaveLength(2)
    expect(out.find((e) => e.op === 'note')).toEqual({ op: 'note', after: 's1', text: 'n1', factIds: ['f-ps5'] })
    expect(out.find((e) => e.op === 'rewrite' && e.id === 's2')).toEqual({ op: 'rewrite', id: 's2', text: 'Short.', factIds: ['f-simple'] })
    expect(out.find((e) => e.op === 'rewrite' && e.id === 's1')).toEqual({ op: 'rewrite', id: 's1', text: 'Plain.' })
    expect(out.at(-1)).toEqual({ op: 'hide', ids: ['s3'], label: 'Praise', reason: 'filler' })
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
