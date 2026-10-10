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
