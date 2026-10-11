import { describe, expect, it } from 'vitest'
import type { PageEdit, PageSegment } from '@/types'
import { runEditGate } from './edits'

const segments: PageSegment[] = [
  { id: 's1', tag: 'h1', text: 'Samsung 65" QN90D Neo QLED' },
  { id: 's2', tag: 'p', text: 'Four HDMI 2.1 ports support 4K at 120Hz. Price $1,299.99.' },
  { id: 's3', tag: 'p', text: 'Loved by families everywhere. Best TV of the year!' },
  { id: 's4', tag: 'p', text: 'Thousands of five-star reviews.' },
]
const visibleText = segments.map((s) => s.text).join('\n')
const userFactValues = ['owns a PS5', 'budget around $800', 'I want to stay under $800']

const gate = (edits: PageEdit[]) => runEditGate({ edits, segments, visibleText, userFactValues })

describe('runEditGate', () => {
  it('keeps a rewrite whose numbers are on the page and strips the sentence with an invented one', () => {
    const out = gate([
      { op: 'rewrite', id: 's2', text: 'Four HDMI 2.1 ports run 4K at 120Hz. It costs $1,299.99. The panel hits 144Hz.' },
    ])
    expect(out.edits).toEqual([{ op: 'rewrite', id: 's2', text: 'Four HDMI 2.1 ports run 4K at 120Hz. It costs $1,299.99.' }])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'section', claim: '144Hz', reason: 'not_on_page' }])
    expect(out.gate.checked).toBeGreaterThanOrEqual(4)
  })

  it('a user fact passes in a note or warning but not in a rewrite', () => {
    const out = gate([
      { op: 'warn', after: 's2', text: 'At $1,299.99 this is over your $800 budget.', factIds: ['f-budget'] },
      { op: 'rewrite', id: 's2', text: 'Within an $800 budget this has four HDMI 2.1 ports.' },
    ])
    expect(out.edits).toHaveLength(1)
    expect(out.edits[0]!.op).toBe('warn')
    expect(out.gate.stripped).toEqual([{ blockIndex: 1, blockType: 'section', claim: '$800', reason: 'not_on_page' }])
  })

  it('drops unknown segments, no-op rewrites, ballooning rewrites and empty hides, each counted as invalid', () => {
    const out = gate([
      { op: 'rewrite', id: 's99', text: 'Nope' },
      { op: 'rewrite', id: 's1', text: 'Samsung 65" QN90D Neo QLED' },
      { op: 'rewrite', id: 's1', text: 'x'.repeat(400) },
      { op: 'hide', ids: ['s98'], label: 'Reviews', reason: 'filler' },
      { op: 'hide', ids: ['s3', 's4', 's97'], label: 'Marketing', reason: 'you skip hype' },
    ])
    expect(out.edits).toEqual([{ op: 'hide', ids: ['s3', 's4'], label: 'Marketing', reason: 'you skip hype' }])
    expect(out.gate.stripped.map((s) => s.reason)).toEqual(['invalid_block', 'invalid_block', 'invalid_block'])
    expect(out.gate.stripped.map((s) => s.blockType)).toEqual(['section', 'section', 'hidden'])
  })

  it('keeps a note to one line: a long note keeps its first sentence, a long sentence is cut at a word', () => {
    const long = 'Works with your PS5. ' + 'This paragraph goes on about the panel and the ports for far too long to be a sticky note. '.repeat(2)
    expect(gate([{ op: 'note', after: 's1', text: long, factIds: ['f-ps5'] }]).edits).toEqual([
      { op: 'note', after: 's1', text: 'Works with your PS5.', factIds: ['f-ps5'] },
    ])
    const sentence = 'Works with your PS5 and ' + 'word '.repeat(40) + 'end'
    const out = gate([{ op: 'warn', after: 's1', text: sentence, factIds: ['f-ps5'] }])
    expect(out.edits).toHaveLength(1)
    const text = (out.edits[0] as { text: string }).text
    expect(text.length).toBeLessThanOrEqual(120)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toMatch(/word…$/)
  })

  it('moves a note with an unknown anchor to the first segment instead of losing it', () => {
    const out = gate([{ op: 'note', after: 's42', text: 'Works with your PS5.', factIds: ['f-ps5'] }])
    expect(out.edits).toEqual([{ op: 'note', after: 's1', text: 'Works with your PS5.', factIds: ['f-ps5'] }])
  })

  it('rejects malformed input from an old cache without throwing', () => {
    const out = runEditGate({ edits: [{ op: 'explode' } as unknown as PageEdit], segments, visibleText, userFactValues })
    expect(out.edits).toEqual([])
    expect(out.gate.stripped[0]!.reason).toBe('invalid_block')
  })
})

describe('runEditGate with a page map (promote, badge, region hides)', () => {
  const regions = [
    { id: 'r1', role: 'hero' as const, title: 'Fall Savings', segmentIds: ['s1'] },
    {
      id: 'r2',
      role: 'products' as const,
      title: 'Must-Have Selections',
      segmentIds: ['s2'],
      items: [{ id: 'i1', title: 'Laptop Power Bank (25K, 165W)', price: '$129.99', segmentIds: ['s2'] }],
    },
    { id: 'r3', role: 'membership' as const, title: 'Become a member', segmentIds: ['s3', 's4'] },
  ]
  const mapGate = (edits: PageEdit[]) =>
    runEditGate({ edits, segments, regions, neverHide: ['products', 'hero'], visibleText: `${visibleText}\n165W $129.99`, userFactValues })

  it('keeps promotes and badges on known ids, drops them on unknown ones, and labels their claims as the user\'s', () => {
    const out = mapGate([
      { op: 'promote', id: 'r2', reason: 'Power banks for your PS5 trips come first.', factIds: ['f1'] },
      { op: 'promote', id: 'r9', reason: 'nope', factIds: ['f1'] },
      { op: 'badge', id: 'i1', label: '165W: under your $800 budget', factIds: ['f1'] },
      { op: 'badge', id: 'r2', label: 'badges go on items, not regions', factIds: ['f1'] },
      { op: 'badge', id: 'i1', label: '   ', factIds: ['f1'] },
    ])
    expect(out.edits).toEqual([
      { op: 'promote', id: 'r2', reason: 'Power banks for your PS5 trips come first.', factIds: ['f1'] },
      { op: 'badge', id: 'i1', label: '165W: under your $800 budget', factIds: ['f1'] },
    ])
    expect(out.gate.stripped.map((s) => s.claim)).toEqual(['promote of unknown r9', 'badge on unknown r2', 'empty badge on i1'])
    expect(out.gate.stripped.every((s) => s.reason === 'invalid_block' && s.blockType === 'for_you')).toBe(true)
  })

  it('strips a badge whose number is neither on the page nor the user\'s', () => {
    const out = mapGate([{ op: 'badge', id: 'i1', label: 'Runs at 240W', factIds: ['f1'] }])
    expect(out.edits).toEqual([])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'for_you', claim: '240W', reason: 'not_on_page' }])
  })

  it('hides regions and items whole, but never a protected region', () => {
    const out = mapGate([
      { op: 'hide', ids: ['r3'], label: 'Membership pitch', reason: 'You buy, you do not join.' },
      { op: 'hide', ids: ['r2', 'i1'], label: 'The shelf', reason: 'no' },
      { op: 'hide', ids: ['r1', 's3'], label: 'Hero and a line', reason: 'mixed' },
    ])
    expect(out.edits).toEqual([
      { op: 'hide', ids: ['r3'], label: 'Membership pitch', reason: 'You buy, you do not join.' },
      { op: 'hide', ids: ['i1'], label: 'The shelf', reason: 'no' },
      { op: 'hide', ids: ['s3'], label: 'Hero and a line', reason: 'mixed' },
    ])
    expect(out.gate.stripped.map((s) => s.claim)).toEqual(['hide of a protected region (r2)', 'hide of a protected region (r1)'])
  })

  it('accepts a region or item as a note anchor', () => {
    const out = mapGate([{ op: 'note', after: 'i1', text: 'This one fits the PS5 trips you mentioned.', factIds: ['f1'] }])
    expect(out.edits).toEqual([{ op: 'note', after: 'i1', text: 'This one fits the PS5 trips you mentioned.', factIds: ['f1'] }])
  })
})
