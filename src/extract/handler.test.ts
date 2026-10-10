import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnMessage, Profile } from '@/types'
import type { CompleteJsonOptions } from '@/llm/client'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))
vi.mock('@/archive', () => ({ getOwnMessages: vi.fn(), getArchiveStats: vi.fn() }))
vi.mock('@/profile', () => ({
  emptyProfile: (): Profile => ({ version: 0, facts: [], shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } }),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
}))
import { completeJson } from '@/llm/client'
import { getArchiveStats, getOwnMessages } from '@/archive'
import { getProfile, saveProfile } from '@/profile'
import { handlers } from './index'

const reply = (value: unknown) => ({ value, model: 'test', ms: 1, usage: { input: 0, output: 0, cacheRead: 0 } })
const sender = {} as chrome.runtime.MessageSender
const run = (profileId?: string) => handlers['extract/run']!({ type: 'extract/run', profileId }, sender)

const messages: OwnMessage[] = [
  { id: 'a', conversationId: 'c1', origin: 'claude', title: 'TVs', date: '2026-09-02T00:00:00Z', text: 'Just got a PS5, which TV should I get?' },
  { id: 'b', conversationId: 'c2', origin: 'chatgpt', title: 'Meds', date: '2026-09-01T00:00:00Z', text: 'Is my medication safe with coffee?' },
]

beforeEach(() => {
  vi.mocked(completeJson).mockReset()
  vi.mocked(completeJson).mockImplementation(async (opts: CompleteJsonOptions<unknown>) => {
    if (opts.role === 'extract')
      return reply({
        facts: [
          { category: 'owns', value: 'owns a PS5', quote: 'just got a PS5', messageId: 'm1' },
          { category: 'interest', value: 'takes medication', quote: 'my medication', messageId: 'm2' },
        ],
      })
    if (opts.role === 'merge')
      return reply({
        facts: [
          { category: 'owns', value: 'owns a PS5', candidateIndices: [0], confidence: 0.7 },
          { category: 'interest', value: 'takes medication', candidateIndices: [1], confidence: 0.4 },
        ],
      })
    return reply({ verdicts: [] }) // classify
  })
  vi.mocked(getOwnMessages).mockResolvedValue(messages)
})

describe("handlers['extract/run']", () => {
  it('extracts, filters, merges into the stored profile and saves it', async () => {
    vi.mocked(getArchiveStats).mockResolvedValue({
      conversations: 2,
      messages: 2,
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-02T00:00:00Z',
      byOrigin: { chatgpt: { conversations: 1, messages: 1 }, claude: { conversations: 1, messages: 1 } },
    })
    vi.mocked(getProfile).mockResolvedValue({
      version: 4,
      shares: [],
      stats: { conversations: 0, messages: 0, from: '', to: '' },
      facts: [{ id: 'kept-ps5', category: 'owns', value: 'Owns a PS5', confidence: 0.9, source: 'chat', evidence: [], userStatus: 'kept', prior: { alpha: 4, beta: 1 } }],
    })
    vi.mocked(saveProfile).mockImplementation(async (p) => ({ ...p, version: p.version + 1 }))

    const { profile, neverExtracted } = await run('petr')

    expect(saveProfile).toHaveBeenCalledWith(expect.anything(), 'petr')
    expect(profile.version).toBe(5)
    expect(profile.stats).toEqual({ conversations: 2, messages: 2, from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' })
    const ps5 = profile.facts.find((f) => f.value === 'owns a PS5')
    expect(ps5).toMatchObject({ id: 'kept-ps5', userStatus: 'kept', prior: { alpha: 4, beta: 1 } })
    expect(ps5?.evidence[0]).toMatchObject({ origin: 'claude', quote: 'Just got a PS5' })
    expect(profile.facts.some((f) => /medication/i.test(f.value + f.evidence.map((e) => e.quote).join()))).toBe(false)
    expect(neverExtracted.health).toBeGreaterThanOrEqual(1)
  })

  it('degrades gracefully while profile/archive stats are still TODO stubs', async () => {
    const todo = (where: string) => async () => {
      throw new Error(`TODO(${where}) — see CONTEXT.txt`)
    }
    vi.mocked(getArchiveStats).mockImplementation(todo('archive.getArchiveStats'))
    vi.mocked(getProfile).mockImplementation(todo('profile.getProfile'))
    vi.mocked(saveProfile).mockImplementation(todo('profile.saveProfile'))

    const { profile } = await run()
    expect(profile.version).toBe(1)
    expect(profile.stats).toEqual({ conversations: 2, messages: 2, from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' })
    expect(profile.facts.map((f) => f.value)).toContain('owns a PS5')
  })

  it('surfaces real errors instead of hiding them', async () => {
    vi.mocked(getArchiveStats).mockRejectedValue(new Error('QuotaExceededError'))
    vi.mocked(getProfile).mockResolvedValue({ version: 0, facts: [], shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } })
    await expect(run()).rejects.toThrow('QuotaExceededError')
  })
})
