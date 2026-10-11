import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fact, OwnMessage, Profile } from '@/types'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))
import { completeJson } from '@/llm/client'
import { CandidateFactsOutputSchema, MergedFactsOutputSchema, QuestionPatternsOutputSchema } from '@/schemas'
import {
  chunkMessages,
  estimateTokens,
  extractFacts,
  findVerbatim,
  mergeCandidates,
  mergeIntoProfile,
  mineQuestions,
  proposeCandidates,
  type VerifiedCandidate,
} from './index'

const mockComplete = vi.mocked(completeJson)
const reply = (value: unknown) => ({ value, model: 'test', ms: 1, usage: { input: 0, output: 0, cacheRead: 0 } })

let seq = 0
function msg(conversationId: string, date: string, text: string, extra: Partial<OwnMessage> = {}): OwnMessage {
  return { id: `id-${++seq}`, conversationId, origin: 'chatgpt', title: `Conv ${conversationId}`, date, text, ...extra }
}

beforeEach(() => {
  mockComplete.mockReset()
})

describe('chunkMessages', () => {
  const big = 'x'.repeat(1600) // ~420 tokens with the line prefix
  const A = [msg('A', '2026-01-01T10:00:00Z', 'oldest conversation, first'), msg('A', '2026-01-01T10:05:00Z', 'oldest conversation, second')]
  const C = [1, 2, 3, 4, 5].map((i) => msg('C', `2026-05-01T10:0${i}:00Z`, big))
  const B = [msg('B', '2026-09-01T10:01:00Z', 'newest conversation, second'), msg('B', '2026-09-01T10:00:00Z', 'newest conversation, first')]
  const all = [...A, ...C, ...B]
  const ids = (chunks: OwnMessage[][]) => chunks.map((c) => c.map((m) => m.id))

  it('puts the newest conversation first, keeps each conversation in order, and splits an oversized one', () => {
    const chunks = chunkMessages(all, 1000)
    expect(ids(chunks)).toEqual([
      [B[1].id, B[0].id, C[0].id, C[1].id], // B whole + C topped up
      [C[2].id, C[3].id],
      [C[4].id, A[0].id, A[1].id], // C's tail stays open for A
    ])
  })

  it('respects the token size and keeps every message exactly once', () => {
    const chunks = chunkMessages(all, 1000)
    for (const chunk of chunks) expect(chunk.reduce((n, m) => n + estimateTokens(m), 0)).toBeLessThanOrEqual(1000)
    expect(chunks.flat().map((m) => m.id).sort()).toEqual(all.map((m) => m.id).sort())
  })

  it('packs whole small conversations together and never splits one that fits', () => {
    expect(ids(chunkMessages([...A, ...B], 6000))).toEqual([[B[1].id, B[0].id, A[0].id, A[1].id]])
    const tight = chunkMessages([...A, ...B], estimateTokens(A[0]) + estimateTokens(A[1]) + 1)
    expect(ids(tight)).toEqual([[B[1].id, B[0].id], [A[0].id, A[1].id]])
    expect(chunkMessages([])).toEqual([])
  })
})

describe('findVerbatim', () => {
  const text = 'Just got a PS5,   which TV should I get?\nI don’t want anything over $800.'
  it('matches ignoring case, whitespace and curly quotes, and returns the original words', () => {
    expect(findVerbatim(text, 'just got a ps5, which tv')).toBe('Just got a PS5,   which TV')
    expect(findVerbatim(text, '"I don\'t want anything over $800"')).toBe('I don’t want anything over $800')
  })
  it('rejects text that is not in the message', () => {
    expect(findVerbatim(text, 'just got a PS5 Pro')).toBeNull()
    expect(findVerbatim(text, 'ok')).toBeNull()
  })
})

describe('proposeCandidates (map step)', () => {
  it('keeps only quotes that appear in the cited message', async () => {
    const chunk = [
      msg('c1', '2026-08-03T09:00:00Z', 'Just got a PS5, which TV should I get?', { title: 'Best TV for PS5' }),
      msg('c1', '2026-08-03T09:05:00Z', 'I write TypeScript all day at work.', { title: 'Best TV for PS5' }),
    ]
    mockComplete.mockResolvedValueOnce(
      reply({
        facts: [
          { category: 'owns', value: 'owns a PS5', quote: 'JUST GOT a   PS5', messageId: 'm1' },
          { category: 'goal', value: 'buying an OLED', quote: 'I am buying a 77-inch OLED tomorrow', messageId: 'm1' }, // fabricated
          { category: 'expertise', value: 'TypeScript developer', quote: 'I write TypeScript all day', messageId: 'm1' }, // wrong message
          { category: 'interest', value: 'gaming', quote: 'which TV should I get', messageId: 'm9' }, // unknown id
        ],
      }),
    )
    const out = await proposeCandidates(chunk)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'owns', quote: 'Just got a PS5', messageId: chunk[0].id })
    expect(out[0].message).toBe(chunk[0])

    const call = mockComplete.mock.calls[0][0]
    expect(call.role).toBe('extract')
    expect(call.schema).toBe(CandidateFactsOutputSchema)
    expect(call.user).toContain('[m1] (chatgpt, Best TV for PS5, 2026-08-03): Just got a PS5, which TV should I get?')
    // Sensitive topics are never extracted (§3.3).
    expect(call.system).toMatch(/NEVER propose a fact about[^\n]*health[^\n]*religion[^\n]*politics[^\n]*finances/)
  })
})

describe('mergeCandidates (reduce step)', () => {
  const m1 = msg('c1', '2026-09-01T00:00:00Z', 'just got a PS5', { origin: 'claude', title: 'TV' })
  const m2 = msg('c2', '2026-08-01T00:00:00Z', 'my PS5 is in the living room')
  const cands: VerifiedCandidate[] = [
    { category: 'owns', value: 'owns a PS5', quote: 'just got a PS5', messageId: m1.id, message: m1 },
    { category: 'owns', value: 'has a PS5', quote: 'my PS5 is in the living room', messageId: m2.id, message: m2 },
    { category: 'owns', value: 'has a PS5', quote: 'My PS5 is in the living room', messageId: m2.id, message: m2 },
  ]

  it('rebuilds evidence from candidate indices and sets a weak prior', async () => {
    mockComplete.mockResolvedValueOnce(
      reply({
        facts: [
          { category: 'owns', value: 'owns a PS5', candidateIndices: [1, 0, 2, 99], confidence: 0.8 },
          { category: 'goal', value: 'invented by the model', candidateIndices: [42], confidence: 0.9 },
        ],
      }),
    )
    const facts = await mergeCandidates(cands)
    expect(facts).toHaveLength(1)
    const [f] = facts
    expect(f).toMatchObject({ category: 'owns', value: 'owns a PS5', confidence: 0.8, source: 'chat', prior: { alpha: 1.8, beta: 1 } })
    expect(f.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(f.evidence).toEqual([
      { origin: 'claude', title: 'TV', date: m1.date, quote: 'just got a PS5' },
      { origin: 'chatgpt', title: 'Conv c2', date: m2.date, quote: 'my PS5 is in the living room' },
    ])
    const call = mockComplete.mock.calls[0][0]
    expect(call).toMatchObject({ role: 'merge', effort: 'medium', schema: MergedFactsOutputSchema })
    // The merge drops sensitive topics too (§3.3).
    expect(call.system).toMatch(/Never output facts about health, religion, politics, sexuality, exact location, detailed finances/)
    expect(call.user).toContain('[0] owns | owns a PS5 | "just got a PS5" | 2026-09-01 | claude')
  })

  it('skips the model when there is nothing to merge', async () => {
    expect(await mergeCandidates([])).toEqual([])
    expect(mockComplete).not.toHaveBeenCalled()
  })
})

describe('mineQuestions', () => {
  it('clusters repeated questions and keeps the most recent phrasing', async () => {
    const messages = [
      msg('q1', '2026-03-01T00:00:00Z', 'Will it work with my PS5?'),
      msg('q2', '2026-06-01T00:00:00Z', 'Nice specs. Will it work with my ps5 though?'),
      msg('q3', '2026-09-01T00:00:00Z', 'will it work with my PS5??'),
      msg('q4', '2026-04-01T00:00:00Z', 'How do I set up HDR on this TV?'),
      msg('q5', '2026-05-01T00:00:00Z', 'how do I set up HDR on a Sony?'),
      msg('q6', '2026-07-01T00:00:00Z', 'Can you write a poem about cats?'),
      msg('q7', '2026-02-01T00:00:00Z', 'What is the capital of France?'),
      msg('q8', '2026-08-01T00:00:00Z', 'const label = isOn ? "yes" : "no";\nconst y = flag ? a : b;'),
    ]
    const qs = await mineQuestions(messages)
    // Asked in one conversation only, so not recurring: "What is the capital of France?".
    expect(qs.map((q) => q.value)).toEqual(['will it work with my PS5??', 'how do I set up HDR on a Sony?'])
    const [ps5] = qs
    expect(ps5).toMatchObject({ category: 'question', source: 'chat', confidence: 0.6 })
    // Asked in 3 conversations (confidence 0.6), but the 2026-03 wording repeats the 2026-09 one, so it is shown once.
    expect(ps5.evidence.map((e) => e.date)).toEqual(['2026-09-01T00:00:00Z', '2026-06-01T00:00:00Z'])
    expect(ps5.evidence[1].quote).toBe('Will it work with my ps5 though?')
    expect(qs.some((q) => /poem/.test(q.value))).toBe(false) // requests to the assistant are not questions
    expect(qs.some((q) => /const/.test(q.value))).toBe(false) // pasted code is not a question
  })

  it('adds model-proposed question patterns whose quotes verify in two or more conversations', async () => {
    mockComplete.mockResolvedValueOnce(
      reply({
        questions: [
          {
            value: 'how does it work?',
            quotes: [
              { messageId: 'm1', quote: 'explain how the winglet works' },
              { messageId: 'm2', quote: 'How does it work?' },
              { messageId: 'm3', quote: 'this quote is not in the message' }, // fabricated: dropped
            ],
          },
          { value: 'is it vegan?', quotes: [{ messageId: 'm3', quote: 'is it vegan' }] }, // one message only: dropped
        ],
      }),
    )
    const qs = await mineQuestions([
      msg('a', '2026-09-01T00:00:00Z', 'Please explain how the winglet works'),
      msg('b', '2026-08-01T00:00:00Z', 'Batteries. How does it work?'),
      msg('c', '2026-07-01T00:00:00Z', 'Pasta recipe, is it vegan'),
    ])
    expect(qs.map((q) => q.value)).toEqual(['how does it work?'])
    expect(qs[0]).toMatchObject({ category: 'question', confidence: 0.4 })
    expect(qs[0].evidence.map((e) => e.quote)).toEqual(['explain how the winglet works', 'How does it work?'])
    expect(mockComplete.mock.calls[0][0]).toMatchObject({ role: 'extract', schema: QuestionPatternsOutputSchema })
  })

  it('falls back to code-mined questions when the pattern pass fails', async () => {
    mockComplete.mockRejectedValueOnce(new Error('rate limited'))
    const qs = await mineQuestions([
      msg('a', '2026-09-01T00:00:00Z', 'Will it work with my PS5?'),
      msg('b', '2026-08-01T00:00:00Z', 'Will it work with my PS5?'),
    ])
    expect(qs.map((q) => q.value)).toEqual(['Will it work with my PS5?'])
  })

  it('ignores a line repeated within one conversation, like re-sent drafts', async () => {
    const qs = await mineQuestions([
      msg('d1', '2026-09-11T00:00:00Z', 'Draft one. So is this a scientific discovery?'),
      msg('d1', '2026-09-11T01:00:00Z', 'Draft two. So is this a scientific discovery?'),
      msg('d1', '2026-09-12T00:00:00Z', 'Final. So is this a scientific discovery?'),
    ])
    expect(qs).toEqual([])
  })

  it('mines only messages the person typed, not project instructions or memory notes', async () => {
    const qs = await mineQuestions([
      msg('p1', '2026-03-01T00:00:00Z', 'What genre should the story be?', { kind: 'project' }),
      msg('n1', '2026-03-01T00:00:00Z', 'Which TV does he own?', { kind: 'memory' }),
      msg('p2', '2026-03-01T00:00:00Z', 'What genre should the story be?', { kind: 'project' }),
      msg('c1', '2026-03-02T00:00:00Z', 'Will it work with my PS5?', { kind: 'chat' }),
      msg('c2', '2026-03-03T00:00:00Z', 'Will it work with my PS5?'),
    ])
    expect(qs.map((q) => q.value)).toEqual(['Will it work with my PS5?'])
  })
})

describe('extractFacts', () => {
  const messages = [
    msg('c1', '2026-09-01T00:00:00Z', 'Just got a PS5, which TV should I get?'),
    msg('c2', '2026-08-01T00:00:00Z', 'Will it work with my PS5?'),
    msg('c3', '2026-07-01T00:00:00Z', 'Will it work with my PS5 at 120 Hz?'),
  ]

  it('chunks, maps, reduces and mines questions, with stats and progress', async () => {
    mockComplete.mockImplementation(async (opts) => {
      if (opts.role === 'extract')
        return reply({
          facts: [
            { category: 'owns', value: 'owns a PS5', quote: 'got a PS5', messageId: 'm1' },
            { category: 'goal', value: 'made up', quote: 'not in any message', messageId: 'm1' },
          ],
        })
      return reply({ facts: [{ category: 'owns', value: 'owns a PS5', candidateIndices: [0], confidence: 0.7 }] })
    })
    const progress: string[] = []
    const r = await extractFacts(messages, { chunkTokens: 20, onProgress: (d, t, s) => progress.push(`${s}:${d}/${t}`) })
    expect(r.stats).toEqual({ chunks: 3, candidates: 6, verified: 1 }) // only m1 of chunk 1 says "got a PS5"
    expect(r.facts.map((f) => f.value)).toEqual(['owns a PS5'])
    expect(r.questions[0]).toMatchObject({ category: 'question', value: 'Will it work with my PS5?' })
    expect(progress).toContain('map:3/3')
    expect(progress.at(-1)).toBe('questions:1/1')
  })

  it('stops on abort: passes the signal to the model, makes no further calls, never merges, rejects with the reason', async () => {
    const stop = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    mockComplete.mockImplementation(async (opts) => {
      signals.push(opts.signal)
      stop.abort(new DOMException('Extraction stopped', 'AbortError')) // the user presses Stop during the first call
      throw opts.signal!.reason
    })
    await expect(extractFacts(messages, { chunkTokens: 20, signal: stop.signal })).rejects.toThrow('Extraction stopped')
    // MAP_CONCURRENCY workers may each have started one call before the abort; none came after, and no merge ran.
    expect(signals.every((s) => s === stop.signal)).toBe(true)
    expect(mockComplete.mock.calls.every(([o]) => o.role === 'extract')).toBe(true)
    expect(mockComplete.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('does not start at all with an already aborted signal', async () => {
    const stop = new AbortController()
    stop.abort(new DOMException('Extraction stopped', 'AbortError'))
    await expect(extractFacts(messages, { signal: stop.signal })).rejects.toThrow('Extraction stopped')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('throws when every chunk fails (e.g. no API key)', async () => {
    mockComplete.mockRejectedValue(new Error('No Anthropic API key'))
    await expect(extractFacts(messages)).rejects.toThrow('No Anthropic API key')
  })

  it('splits held-out questions from profile messages with `before`', async () => {
    mockComplete.mockResolvedValue(reply({ facts: [] }))
    const asked = [...messages, msg('c4', '2026-09-05T00:00:00Z', 'Just got a PS5, which TV should I get?')]
    const r = await extractFacts(asked, { before: '2026-08-15' })
    expect(r.stats.chunks).toBe(1) // c2 + c3 only
    // From c1 + c4 only (held out); "Will it work with my PS5?" (c2, c3) is in the profile period.
    expect(r.questions.map((q) => q.value)).toEqual(['Just got a PS5, which TV should I get?'])
  })
})

describe('mergeIntoProfile', () => {
  const base = (over: Partial<Fact>): Fact => ({ id: 'x', category: 'owns', value: 'v', confidence: 0.5, source: 'chat', evidence: [], ...over })

  it('keeps userStatus, prior and id of a fact that already exists; replaces untouched old chat facts', () => {
    const profile: Profile = {
      version: 3,
      shares: [],
      stats: { conversations: 0, messages: 0, from: '', to: '' },
      facts: [
        base({ id: 'old-ps5', value: 'Owns a PS5.', userStatus: 'kept', prior: { alpha: 5, beta: 2 } }),
        base({ id: 'old-untouched', value: 'likes jazz' }),
        base({ id: 'old-deleted', value: 'likes golf', userStatus: 'deleted' }),
        base({ id: 'beh', value: 'expands specs', source: 'behavior' }),
      ],
    }
    const next = mergeIntoProfile(profile, [
      base({ id: 'new-ps5', value: 'owns a PS5', prior: { alpha: 1.8, beta: 1 } }),
      base({ id: 'new-tv', value: 'wants a 65-inch TV' }),
    ])
    expect(next.facts.map((f) => f.id)).toEqual(['old-ps5', 'new-tv', 'old-deleted', 'beh'])
    expect(next.facts[0]).toMatchObject({ value: 'owns a PS5', userStatus: 'kept', prior: { alpha: 5, beta: 2 } })
    expect(next.version).toBe(3)
  })
})
