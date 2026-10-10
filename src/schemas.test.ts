import { describe, expect, it } from 'vitest'
import { BlockSchema, RewriteOutputSchema, SensitiveVerdictSchema } from './schemas'
import { BLOCK_TYPES, type Block } from './types'

const samples: Block[] = [
  { type: 'summary', text: 'A 65-inch TV.' },
  { type: 'for_you', text: 'Works with your PS5.', factIds: ['f1'] },
  { type: 'key_facts', rows: [{ label: 'Refresh rate', value: '120 Hz' }] },
  { type: 'compare', columns: ['Model', 'Price'], rows: [['A', '$999']] },
  { type: 'steps', items: ['Unbox', 'Plug in'] },
  { type: 'warning', text: 'Over your budget.', factIds: ['f2'] },
  { type: 'section', heading: 'Ports', text: 'Four HDMI.' },
  { type: 'hidden', label: 'Marketing', reason: 'You skip marketing copy.' },
  { type: 'cta', label: 'Buy', href: 'https://example.com/buy' },
  { type: 'from_site', text: 'We recommend the 55-inch.', siteUrl: 'https://www.coframe.com/' },
]

describe('BlockSchema (the model proposes, code decides)', () => {
  it('accepts one sample of every frozen block type', () => {
    expect(samples.map((b) => b.type).sort()).toEqual([...BLOCK_TYPES].sort())
    for (const block of samples) expect(BlockSchema.safeParse(block).success, block.type).toBe(true)
  })

  it('rejects block types outside the fixed list and free-form html', () => {
    expect(BlockSchema.safeParse({ type: 'html', html: '<b>x</b>' }).success).toBe(false)
    expect(BlockSchema.safeParse({ type: 'summary' }).success).toBe(false)
    expect(BlockSchema.safeParse({ type: 'cta', label: 'Buy' }).success).toBe(false)
  })

  it('requires at least one block in a rewrite', () => {
    expect(RewriteOutputSchema.safeParse({ blocks: [] }).success).toBe(false)
    expect(RewriteOutputSchema.safeParse({ blocks: samples }).success).toBe(true)
  })
})

describe('SensitiveVerdictSchema', () => {
  it('keeps a known category and degrades an unknown one to undefined instead of failing the reply', () => {
    const parsed = SensitiveVerdictSchema.parse({
      verdicts: [
        { index: 0, sensitive: true, category: 'health' },
        { index: 1, sensitive: true, category: 'astrology', reason: 'star sign' },
        { index: 2, sensitive: false },
      ],
    })
    expect(parsed.verdicts.map((v) => v.category)).toEqual(['health', undefined, undefined])
  })
})
