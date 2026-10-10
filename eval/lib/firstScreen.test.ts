import { describe, expect, it } from 'vitest'
import type { Block, Fact } from '@/types'
import {
  FIRST_SCREEN_CHARS,
  containsAnswer,
  normalizeForMatch,
  originalFirstScreen,
  parseAnswersFile,
  questionsNewestFirst,
  scoreTrials,
  selectTrials,
  tailoredFirstScreen,
  tally,
  validateAnswers,
  type AnswerEntry,
} from './firstScreen'

// A stand-in for render's blockToPlainText: the counting code takes the function as a parameter.
const toText = (b: Block): string => {
  switch (b.type) {
    case 'key_facts':
      return b.rows.map((r) => `${r.label}: ${r.value}`).join('\n')
    case 'section':
      return `${b.heading}\n${b.text}`
    case 'summary':
    case 'for_you':
    case 'warning':
      return b.text
    default:
      return ''
  }
}

describe('first screen', () => {
  it('original = first 1,500 characters of visible text', () => {
    const text = 'a'.repeat(FIRST_SCREEN_CHARS) + 'ANSWER'
    expect(originalFirstScreen(text)).toHaveLength(FIRST_SCREEN_CHARS)
    expect(containsAnswer(originalFirstScreen(text), 'answer')).toBe(false)
    expect(containsAnswer(originalFirstScreen('Price: $1,299 ' + text), '$1,299')).toBe(true)
  })

  it('tailored = blocks as plain text, in order, until 1,500 characters', () => {
    const blocks: Block[] = [
      { type: 'summary', text: 'x'.repeat(1491) }, // + '\n' = 1,492; 8 more chars fit
      { type: 'key_facts', rows: [{ label: 'HDMI 2.1 ports', value: '4' }] },
      { type: 'summary', text: 'never reached' },
    ]
    const screen = tailoredFirstScreen(blocks, toText)
    expect(screen).toHaveLength(FIRST_SCREEN_CHARS)
    expect(screen.endsWith('\nHDMI 2.1')).toBe(true) // cut mid-block at 1,500
    expect(screen).not.toContain('never reached')
  })

  it('strict mode: a collapsed long section shows only its heading', () => {
    const blocks: Block[] = [{ type: 'section', heading: 'Ports', text: 'Has 4 HDMI 2.1 ports. ' + 'y'.repeat(700) }]
    expect(containsAnswer(tailoredFirstScreen(blocks, toText), '4 HDMI 2.1 ports')).toBe(true)
    const strict = tailoredFirstScreen(blocks, toText, { collapsedSectionsHidden: true, collapseAt: 600 })
    expect(strict).toBe('Ports')
  })

  it('matching ignores case, whitespace runs, curly quotes and dash styles, nothing else', () => {
    expect(normalizeForMatch('  “Dolby Vision”  –  IQ ')).toBe('"dolby vision" - iq')
    expect(containsAnswer('Supports DOLBY   vision IQ', 'dolby vision iq')).toBe(true)
    expect(containsAnswer('Supports Dolby Vision', 'Dolby Vision IQ')).toBe(false)
    expect(containsAnswer('anything', '   ')).toBe(false)
  })

  it('counts answers on each first screen and tallies a/n vs b/n', () => {
    const trials = scoreTrials([{ answer: '120 Hz' }, { answer: 'PS5' }, { answer: 'missing everywhere' }], {
      original: 'Big TV sale! 120 Hz panel',
      tailored: 'Works with your PS5 at 120 Hz',
      tailoredStrict: 'Works with your PS5',
    })
    expect(trials.map((t) => [t.inOriginal, t.inTailored, t.inTailoredStrict])).toEqual([
      [true, true, false],
      [false, true, true],
      [false, false, false],
    ])
    expect(tally(trials)).toEqual({ n: 3, original: 1, tailored: 2, tailoredStrict: 1 })
  })
})

describe('answers.json validation (code decides)', () => {
  const page = 'Samsung QN90D. 4 HDMI 2.1 ports. Price $1,299.99. Ships in 2 days.'
  const ctx = {
    visibleText: new Map([['product', page]]),
    questions: new Map([['petr', ['will it work with my PS5?', 'how many HDMI ports?', 'what does it cost?']]]),
  }
  const e = (over: Partial<AnswerEntry>): AnswerEntry => ({
    pageId: 'product',
    profileId: 'petr',
    question: 'how many HDMI ports?',
    answer: '4 HDMI 2.1 ports',
    ...over,
  })

  it('accepts exact substrings of the visible text (case/whitespace-insensitive) and ranks by question recency', () => {
    const check = validateAnswers([e({ answer: '4  hdmi 2.1 PORTS' }), e({ question: 'What does it cost?', answer: '$1,299.99' })], ctx)
    expect(check.refused).toEqual([])
    expect(check.valid.map((v) => v.rank)).toEqual([1, 2])
  })

  it('refuses answers that are not on the page, too short, unknown pages/profiles, unmined questions and duplicates, with reasons', () => {
    const check = validateAnswers(
      [
        e({ answer: '120 Hz on all four HDMI ports' }),
        e({ answer: '4' }),
        e({ pageId: 'recipe' }),
        e({ profileId: 'mikhail' }),
        e({ question: 'is it good?' }),
        e({ answer: 'x'.repeat(201) }),
        e({}),
        e({}),
      ],
      ctx,
    )
    expect(check.valid).toHaveLength(1)
    const reasons = check.refused.map((r) => r.reason)
    expect(reasons).toHaveLength(7)
    expect(reasons[0]).toMatch(/not an exact substring/)
    expect(reasons[1]).toMatch(/under 3 characters/)
    expect(reasons[2]).toMatch(/no saved copy/)
    expect(reasons[3]).toMatch(/no profile "mikhail"/)
    expect(reasons[4]).toMatch(/not one of petr's mined questions/)
    expect(reasons[5]).toMatch(/over 200 characters/)
    expect(reasons[6]).toMatch(/duplicate/)
  })

  it('skips blank answers (not answerable on this page) without refusing them', () => {
    const check = validateAnswers([e({ question: 'will it work with my PS5?', answer: '  ' })], ctx)
    expect(check.blank).toHaveLength(1)
    expect(check.refused).toHaveLength(0)
  })

  it('selectTrials keeps the newest 5 per (page, person): code picks, not the human', () => {
    const valid = [4, 0, 6, 2, 1, 5, 3].map((rank) => ({ ...e({}), question: `q${rank}`, rank }))
    expect(selectTrials(valid, 'product', 'petr').map((v) => v.rank)).toEqual([0, 1, 2, 3, 4])
    expect(selectTrials(valid, 'docs', 'petr')).toEqual([])
  })

  it('parseAnswersFile refuses the wrong shape with a readable reason', () => {
    expect(parseAnswersFile([])).toEqual([])
    expect(() => parseAnswersFile({ pageId: 'x' })).toThrow(/must be an array/)
    expect(() => parseAnswersFile([{ pageId: 'x', profileId: 'y', question: 'q' }])).toThrow(/0\.answer/)
  })
})

describe('questionsNewestFirst', () => {
  const q = (id: string, date: string, status?: Fact['userStatus']): Fact => ({
    id,
    category: 'question',
    value: id,
    confidence: 0.5,
    source: 'chat',
    evidence: [{ origin: 'chatgpt', title: 't', date, quote: 'q' }],
    ...(status ? { userStatus: status } : {}),
  })
  it('keeps active question facts, newest evidence first', () => {
    const facts = [q('old', '2026-08-01T00:00:00.000Z'), q('new', '2026-10-01T00:00:00.000Z'), q('gone', '2026-10-05T00:00:00.000Z', 'deleted')]
    expect(questionsNewestFirst(facts).map((f) => f.id)).toEqual(['new', 'old'])
  })
})
