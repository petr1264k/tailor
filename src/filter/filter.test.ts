import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fact } from '@/types'
import type { SensitiveCategory } from './index'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))
import { completeJson } from '@/llm/client'
import { filterSensitive, ruleCheck, scrubForSharing, SENSITIVE_CATEGORIES } from './index'

const mockComplete = vi.mocked(completeJson)
const reply = (value: unknown) => ({ value, model: 'test', ms: 1, usage: { input: 0, output: 0, cacheRead: 0 } })

const positives: Record<SensitiveCategory, string[]> = {
  health: ['was diagnosed with ADHD last year', 'my therapist says I should rest', 'pregnant with our second', 'which medication is safer'],
  religion: ['going to church every Sunday', 'fasting for Ramadan this month', 'reading the Bible daily'],
  politics: ['who should I vote for in the election', "I'm a Republican", 'donating to the Labour Party'],
  sexuality: ['as a gay man in tech', 'best dating apps for introverts', 'questions about my sexuality'],
  location: ['I live at 42 Eucalyptus Street', 'ship it to 123 Main St please', 'Hillsborough, CA 94010', 'my home address is on file'],
  finances: ['my salary is $180k', 'SSN 123-45-6789', 'I have $40,000 in debt', 'what is my net worth', 'paying off my mortgage'],
  names: ['my wife Anna loves this show', 'my boss, Dmitry, asked for it', 'we met with Sarah Connor yesterday', 'my son is called Max'],
  contact: ['email me at petr@example.com', 'call +1 415 555 1234', 'my number is (415) 555-1234', 'text +7 999 123 45 67'],
}

/** Near misses: each would be wrongly dropped by a naive rule for the category named. */
const negatives: Record<SensitiveCategory, string[]> = {
  health: ['debugging a memory leak in Node', 'prefers healthy breakfast recipes', 'vegetarian'],
  religion: ['the temperature in the room', 'praise for the design team'],
  politics: ['interviewing candidates for a CTO role', 'running an A/B test campaign on the landing page', 'a conservative estimate is fine'],
  sexuality: ['transfers files over SSH', 'sexy cars? no, sedans'],
  location: ['needs a 2 TB drive', 'lives in San Francisco', 'a 10 minute drive to work'],
  finances: ['TV budget under $800', 'wants a 65-inch TV for $1,299', 'resolution 1920x1080 at 120 Hz'],
  names: ['which Samsung Galaxy should I get for my iPhone?', 'uses Visual Studio Code daily', 'my friend recommended this TV', 'Owns a PS5 and an Apple Watch'],
  contact: ['release date 2026-10-10', 'model QN65S90D costs 1499.99', 'version 1.2.3'],
}

describe('ruleCheck', () => {
  for (const category of SENSITIVE_CATEGORIES) {
    it(`flags ${category}`, () => {
      for (const text of positives[category]) expect(ruleCheck(text), text).toBe(category)
    })
    it(`does not flag ${category} near misses`, () => {
      for (const text of negatives[category]) expect(ruleCheck(text), text).toBeNull()
    })
  }

  it('passes ordinary profile facts', () => {
    for (const text of ['prefers bullet points over prose', 'senior TypeScript developer using React', 'owns a PS5', 'just got a PS5, which TV should I get?'])
      expect(ruleCheck(text), text).toBeNull()
  })

  it('can skip the First Last heuristic for Title Case strings', () => {
    expect(ruleCheck('React State Management Help')).toBe('names')
    expect(ruleCheck('React State Management Help', { namePairs: false })).toBeNull()
  })
})

describe('scrubForSharing', () => {
  it('removes an email and a phone and keeps the rest', () => {
    const r = scrubForSharing('Looking for a 65-inch TV for my PS5, budget $800. Reach me at petr@example.com or (415) 555-1234.')
    expect(r.text).not.toContain('petr@example.com')
    expect(r.text).not.toMatch(/555/)
    expect(r.text).toContain('Looking for a 65-inch TV for my PS5, budget $800.')
    expect(r.removed).toEqual(['contact'])
  })

  it('drops the name after "my <relation>" but keeps the relation', () => {
    const r = scrubForSharing('Choosing a laptop with my wife Anna for her design work.')
    expect(r.text).toBe('Choosing a laptop with my wife for her design work.')
    expect(r.removed).toEqual(['names'])
  })

  it('returns clean text untouched', () => {
    const text = 'CTO evaluating tools that fit an existing React stack; needs SOC 2.'
    expect(scrubForSharing(text)).toEqual({ text, removed: [] })
  })
})

function fact(id: string, value: string, quotes: string[], title = 'Chat'): Fact {
  return {
    id,
    category: 'interest',
    value,
    confidence: 0.5,
    source: 'chat',
    evidence: quotes.map((quote) => ({ origin: 'chatgpt', title, date: '2026-08-03T10:00:00Z', quote })),
  }
}

describe('filterSensitive', () => {
  beforeEach(() => {
    mockComplete.mockReset()
  })

  it('runs rules first, then the classifier, and counts both', async () => {
    const facts = [
      fact('ok', 'owns a PS5', ['just got a PS5']),
      fact('health', 'takes medication for anxiety', ['my meds']),
      fact('mixed', 'into home espresso', ['my wife Anna loves espresso', 'dialing in espresso shots']),
      fact('onlyName', 'plays tennis', ['tennis with my friend Boris']),
      fact('badTitle', 'reads sci-fi', ['any sci-fi like Dune?'], 'Gift for my sister Olga'),
      fact('classified', 'volunteers every weekend', ['volunteering again this Saturday']),
    ]
    // Survivors reach the classifier in order: ok, mixed, classified → index 2 is "classified".
    mockComplete.mockResolvedValueOnce(
      reply({ verdicts: [{ index: 0, sensitive: false }, { index: 2, sensitive: true, reason: 'religion' }, { index: 99, sensitive: true, reason: 'health' }] }),
    )
    const r = await filterSensitive(facts)

    expect(r.kept.map((f) => f.id)).toEqual(['ok', 'mixed'])
    expect(r.kept[1].evidence.map((e) => e.quote)).toEqual(['dialing in espresso shots'])
    expect(r.removed.map((x) => [x.fact.id, x.category, x.by])).toEqual([
      ['health', 'health', 'rule'],
      ['onlyName', 'names', 'rule'],
      ['badTitle', 'names', 'rule'],
      ['classified', 'religion', 'classifier'],
    ])
    // names: Anna's quote + Boris's quote + Olga's title
    expect(r.counts).toMatchObject({ health: 1, names: 3, religion: 1, contact: 0 })

    const call = mockComplete.mock.calls[0][0]
    expect(call.role).toBe('classify')
    expect(call.user).toContain('[2] (interest) volunteers every weekend')
    expect(call.user).not.toContain('Anna')
  })

  it('keeps rule-filtered facts when the classifier call fails', async () => {
    mockComplete.mockRejectedValueOnce(new Error('network'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await filterSensitive([fact('ok', 'owns a PS5', ['just got a PS5']), fact('h', 'was diagnosed with ADHD', ['x y z'])])
    expect(r.kept.map((f) => f.id)).toEqual(['ok'])
    expect(r.counts.health).toBe(1)
    warn.mockRestore()
  })

  it('maps a free-text classifier reason to a category', async () => {
    mockComplete.mockResolvedValueOnce(reply({ verdicts: [{ index: 0, sensitive: true, reason: 'mentions a medical condition' }] }))
    const r = await filterSensitive([fact('a', 'avoids long walks', ['knee hurts after long walks'])])
    expect(r.removed[0]).toMatchObject({ category: 'health', by: 'classifier' })
  })
})
