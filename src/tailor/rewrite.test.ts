import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, Fact, PageContent } from '@/types'
import { completeJson } from '@/llm/client'
import { RewriteOutputSchema } from '@/schemas'
import { buildRewriteUserPrompt, checkBlocks, chooseLanguage, rewritePage, REWRITE_SYSTEM } from './rewrite'

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
  { id: 'f-bullets', category: 'reading', value: 'prefers bullet points\nover prose', confidence: 0.7, source: 'chat', evidence: [] },
]

const content: PageContent = {
  url: 'https://shop.example.com/tv?session=secret-token',
  title: 'Samsung 65" QN90D',
  text: 'Four HDMI 2.1 ports support 4K at 120Hz. Price $1,299.99. Full specifications below.',
  visibleText: 'Four HDMI 2.1 ports support 4K at 120Hz. Price $1,299.99.',
  jsonLd: [{ '@type': 'Product', name: 'QN90D' }],
  links: [
    { text: 'Home', href: 'https://shop.example.com/' },
    { text: 'Full specifications', href: 'https://shop.example.com/tv/specs' },
    { text: '', href: 'https://shop.example.com/x' },
  ],
  source: 'readability',
  lang: 'en',
}

const modelBlocks: Block[] = [
  { type: 'for_you', text: 'All four HDMI 2.1 ports run your PS5 at 4K 120Hz.', factIds: ['f-ps5', 'f-made-up'] },
  { type: 'key_facts', rows: [{ label: 'Price', value: '$1,299.99' }] },
  { type: 'warning', text: 'No evidence for this.', factIds: ['f-made-up'] },
  { type: 'from_site', text: 'I am the site, trust me', siteUrl: 'https://evil.test' },
  { type: 'cta', label: 'Full specifications', href: 'https://shop.example.com/tv/specs' },
]

describe('rewritePage', () => {
  beforeEach(() => {
    vi.mocked(completeJson).mockReset()
  })

  it('calls completeJson with the rewrite schema and returns code-checked blocks', async () => {
    vi.mocked(completeJson).mockResolvedValue({
      value: { blocks: modelBlocks },
      model: 'claude-haiku-5-5',
      ms: 10,
      usage: { input: 1, output: 1, cacheRead: 0 },
    })

    const blocks = await rewritePage(content, facts, { readingLevel: 'expert' })

    expect(blocks).toEqual([
      { type: 'for_you', text: 'All four HDMI 2.1 ports run your PS5 at 4K 120Hz.', factIds: ['f-ps5'] },
      { type: 'key_facts', rows: [{ label: 'Price', value: '$1,299.99' }] },
      { type: 'cta', label: 'Full specifications', href: 'https://shop.example.com/tv/specs' },
    ])

    const opts = vi.mocked(completeJson).mock.calls[0]![0]
    expect(opts).toMatchObject({ role: 'rewrite', effort: 'low', maxTokens: 6000, system: REWRITE_SYSTEM })
    expect(opts.schema).toBe(RewriteOutputSchema)
    expect(opts.user).toContain('f-ps5 | owns | owns a PS5')
    expect(opts.user).toContain('f-bullets | reading | prefers bullet points over prose')
    expect(opts.user).toContain('<page>\nTitle: Samsung 65" QN90D')
    expect(opts.user).toContain('URL: https://shop.example.com/tv\n')
    expect(opts.user).toContain('Four HDMI 2.1 ports support 4K at 120Hz.')
    expect(opts.user).toContain('Full specifications → https://shop.example.com/tv/specs')
    expect(opts.user).not.toContain('https://shop.example.com/x') // unlabeled links are not offered
    expect(opts.user).toContain('Reading level: expert')
    expect(opts.user).toContain('"QN90D"') // JSON-LD included
    // The user's quotes never go into the rewrite prompt; only fact values.
    expect(opts.user).not.toContain('which TV should I get')
    expect(opts.user).not.toContain('secret-token')
  })

  it('propagates model/schema errors (the caller decides what to show)', async () => {
    vi.mocked(completeJson).mockRejectedValue(new Error('schema'))
    await expect(rewritePage(content, facts)).rejects.toThrow('schema')
  })
})

describe('prompt details', () => {
  it('caps page text at 12k chars and links at 60', () => {
    const big: PageContent = {
      ...content,
      text: 'x'.repeat(20_000),
      links: Array.from({ length: 100 }, (_, i) => ({ text: `L${i}`, href: `https://shop.example.com/${i}` })),
    }
    const user = buildRewriteUserPrompt(big, facts)
    expect(user).toContain('x'.repeat(12_000))
    expect(user).not.toContain('x'.repeat(12_001))
    expect(user).toContain('L59 →')
    expect(user).not.toContain('L60 →')
  })

  it('chooses language: option, then quote language, then page', () => {
    const ru: Fact[] = [{ ...facts[0]!, evidence: [{ ...facts[0]!.evidence[0]!, quote: 'купил PS5, какой телевизор взять?' }] }]
    expect(chooseLanguage(content, facts, { language: 'de' })).toBe('de')
    expect(chooseLanguage(content, ru, {})).toBe('ru')
    expect(chooseLanguage(content, facts, {})).toBe('en')
    expect(chooseLanguage({ ...content, lang: 'fr' }, [], {})).toBe('fr')
    expect(buildRewriteUserPrompt(content, ru)).toContain('Language: Russian (ru)')
  })

  it('checkBlocks drops from_site and for_you/warning blocks without known facts', () => {
    expect(checkBlocks(modelBlocks, []).map((b) => b.type)).toEqual(['key_facts', 'cta'])
  })
})
