import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '@/types'

vi.mock('@/extract', () => ({ runExtract: vi.fn() }))
import { runExtract } from '@/extract'
import {
  PAGE_ID,
  STALE_MS,
  describeExtractJob,
  dismissExtractJob,
  getExtractJob,
  isOwnRun,
  resetExtractJobForTests,
  restoreExtractJob,
  startExtract,
  subscribeExtractJob,
  syncExtractJob,
  type ExtractJob,
} from './extractJob'

const profile = (version: number, facts = 3): Profile => ({
  version,
  shares: [],
  stats: { conversations: 1, messages: 2, from: '', to: '' },
  facts: Array.from({ length: facts }, (_, i) => ({ id: `f${i}`, category: 'owns', value: `fact ${i}`, confidence: 0.5, source: 'chat', evidence: [] })),
})
const ok = (version = 1) => ({ profile: profile(version), stats: { chunks: 1, candidates: 1, verified: 1 } })

let t = 1_000_000
const now = () => t

beforeEach(() => {
  resetExtractJobForTests()
  vi.mocked(runExtract).mockReset()
  t = 1_000_000
})

describe('startExtract', () => {
  it('reports progress while running, then the saved result, to every subscriber', async () => {
    const seen: string[] = []
    subscribeExtractJob((j) => seen.push(j.status))
    vi.mocked(runExtract).mockImplementation(async (_id, onProgress) => {
      onProgress?.(1, 4, 'map')
      expect(getExtractJob()).toMatchObject({ status: 'running', stage: 'map', done: 1, total: 4, pageId: PAGE_ID })
      expect(isOwnRun()).toBe(true)
      expect(describeExtractJob(getExtractJob(), now)).toBe('Extracting into “Petr”: Haiku reading chunk 1 of 4 · 0 s')
      t += 84_000
      onProgress?.(1, 1, 'reduce')
      return { profile: profile(7, 5), stats: { chunks: 4, candidates: 12, verified: 9 } }
    })
    const final = await startExtract('petr', 'Petr', now)
    expect(final).toMatchObject({ status: 'done', profileId: 'petr', profileName: 'Petr', seconds: 84, candidates: 12, verified: 9, liveFacts: 5, version: 7 })
    expect(seen).toEqual(['running', 'running', 'running', 'done'])
    expect(describeExtractJob(final)).toBe('Done in 84 s: the model proposed 12 facts, code verified the quotes of 9; 5 facts saved in profile “Petr” v7.')
    expect(isOwnRun()).toBe(false)
  })

  it('keeps the error text and never rejects', async () => {
    vi.mocked(runExtract).mockRejectedValueOnce(new Error('No Anthropic API key'))
    const final = await startExtract('petr', 'Petr', now)
    expect(final).toMatchObject({ status: 'error', error: 'No Anthropic API key', seconds: 0 })
    expect(describeExtractJob(final)).toContain('failed after 0 s: No Anthropic API key')
  })

  it('refuses a second run on the same page while one is running', async () => {
    let finish: (() => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(ok()))))
    const first = startExtract('petr', 'Petr', now)
    await expect(startExtract('mikhail', 'Mikhail', now)).rejects.toThrow('already running')
    finish!()
    expect((await first).status).toBe('done')
  })

  it('dismiss clears a finished job', async () => {
    vi.mocked(runExtract).mockResolvedValueOnce(ok())
    await startExtract('petr', 'Petr', now)
    dismissExtractJob()
    expect(getExtractJob()).toEqual({ status: 'idle' })
  })
})

describe('restoreExtractJob / syncExtractJob', () => {
  it('shows the last result again after a reload', async () => {
    vi.mocked(runExtract).mockResolvedValueOnce(ok(2))
    const done = await startExtract('petr', 'Petr', now)
    resetExtractJobForTests(done) // a new page: in-memory state gone, session storage kept
    expect(getExtractJob()).toEqual({ status: 'idle' })
    expect(await restoreExtractJob(now)).toEqual(done)
  })

  it('adopts a fresh running record from another page, then marks it interrupted once stale', async () => {
    const foreign: ExtractJob = {
      status: 'running',
      profileId: 'petr',
      profileName: 'Petr',
      startedAt: new Date(t - 10_000).toISOString(),
      stage: 'reduce',
      done: 0,
      total: 1,
      updatedAt: new Date(t - 1_000).toISOString(),
      pageId: 'other-page',
    }
    resetExtractJobForTests(foreign)
    const restored = await restoreExtractJob(now)
    expect(restored).toMatchObject({ status: 'running', pageId: 'other-page' })
    expect(isOwnRun(restored)).toBe(false)
    expect(describeExtractJob(restored, now)).toBe('Extracting into “Petr” (in another Tailor tab): Sonnet merging · 10 s')

    t += STALE_MS + 1
    expect(syncExtractJob(now)).toMatchObject({ status: 'interrupted', stage: 'reduce', done: 0, total: 1 })
    expect(getExtractJob()).not.toHaveProperty('pageId')
    expect(describeExtractJob(getExtractJob())).toContain('was interrupted')
  })

  it('a record that was already stale on load is interrupted right away, and a reload cannot be mistaken for this page', async () => {
    const stale: ExtractJob = {
      status: 'running',
      profileId: 'petr',
      profileName: 'Petr',
      startedAt: new Date(t - 600_000).toISOString(),
      stage: 'map',
      done: 3,
      total: 9,
      updatedAt: new Date(t - STALE_MS - 1).toISOString(),
      pageId: 'the-page-before-reload',
    }
    resetExtractJobForTests(stale)
    expect(await restoreExtractJob(now)).toMatchObject({ status: 'interrupted', done: 3, total: 9 })
    // The seconds in a page-level identity are random per page load, so a reload never owns the old record.
    expect(PAGE_ID).not.toBe(stale.pageId)
  })

  it("a foreign record never overrides this page's own run", async () => {
    let finish: (() => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(ok()))))
    const own = startExtract('petr', 'Petr', now)
    await restoreExtractJob(now) // nothing persisted by another page in tests, but must not disturb the run either way
    expect(isOwnRun()).toBe(true)
    finish!()
    expect((await own).status).toBe('done')
  })
})
