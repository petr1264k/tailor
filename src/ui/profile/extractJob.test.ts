import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '@/types'

vi.mock('@/extract', () => ({ runExtract: vi.fn() }))
import { runExtract } from '@/extract'
import {
  EXTRACT_JOB_KEY,
  EXTRACT_LOCK,
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

/** A running record as another page (or this tab before a reload) would have written it. */
function foreignRunning(patch: Partial<Extract<ExtractJob, { status: 'running' }>> = {}): { writer: string; job: ExtractJob } {
  return {
    writer: 'other-page',
    job: {
      status: 'running',
      profileId: 'petr',
      profileName: 'Petr',
      startedAt: new Date(t - 10_000).toISOString(),
      stage: 'reduce',
      done: 0,
      total: 1,
      updatedAt: new Date(t - 1_000).toISOString(),
      pageId: 'other-page',
      ...patch,
    },
  }
}

// ── fakes: chrome.storage.session that echoes onChanged (on a later task, to the writer too) and the Web Locks API ──

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
function installFakeChrome() {
  const listeners: Listener[] = []
  let store: Record<string, unknown> = {}
  const session = {
    get: async (key: string) => ({ [key]: store[key] }),
    set: async (items: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { oldValue: store[k], newValue: v }]))
      store = { ...store, ...items }
      setTimeout(() => listeners.forEach((l) => l(changes, 'session')), 0)
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = { storage: { session, onChanged: { addListener: (l: Listener) => listeners.push(l) } } }
  return {
    stored: () => store[EXTRACT_JOB_KEY] as { writer: string; job: ExtractJob } | undefined,
    /** Written by another page: lands in the store and is echoed to every listener. */
    writeAsOtherPage: (record: { writer: string; job: ExtractJob }) => session.set({ [EXTRACT_JOB_KEY]: record }),
    flush: () => new Promise((r) => setTimeout(r, 10)),
  }
}

function installFakeLocks() {
  const held = new Set<string>()
  const locks = {
    query: async () => ({ held: [...held].map((name) => ({ name, mode: 'exclusive' as const })), pending: [] }),
    request: async (name: string, opts: { ifAvailable?: boolean }, cb: (lock: { name: string } | null) => Promise<unknown>) => {
      if (held.has(name)) {
        if (opts.ifAvailable) return cb(null)
        throw new Error('fake lock would block')
      }
      held.add(name)
      try {
        return await cb({ name })
      } finally {
        held.delete(name)
      }
    },
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
  return held
}

beforeEach(() => {
  resetExtractJobForTests()
  vi.mocked(runExtract).mockReset()
  t = 1_000_000
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
})

describe('startExtract (no chrome, no locks: vitest fallbacks)', () => {
  it('reports progress while running, then the saved result, to every subscriber', async () => {
    const seen: string[] = []
    subscribeExtractJob((j) => seen.push(j.status))
    const midRun: { job: ExtractJob; own: boolean; line: string }[] = []
    vi.mocked(runExtract).mockImplementation(async (_id, onProgress) => {
      onProgress?.(1, 4, 'map')
      midRun.push({ job: getExtractJob(), own: isOwnRun(), line: describeExtractJob(getExtractJob(), now) })
      t += 84_000
      onProgress?.(1, 1, 'reduce')
      return { profile: profile(7, 5), stats: { chunks: 4, candidates: 12, verified: 9 } }
    })
    const final = await startExtract('petr', 'Petr', now)
    expect(midRun[0]).toMatchObject({ own: true, line: 'Extracting into “Petr”: Haiku reading chunk 1 of 4 · 0 s' })
    expect(midRun[0]!.job).toMatchObject({ status: 'running', stage: 'map', done: 1, total: 4, pageId: PAGE_ID })
    expect(final).toMatchObject({ status: 'done', profileId: 'petr', profileName: 'Petr', seconds: 84, candidates: 12, verified: 9, liveFacts: 5, version: 7 })
    expect(seen).toEqual(['running', 'running', 'running', 'done'])
    expect(describeExtractJob(final)).toBe('Done in 84 s: the model proposed 12 facts, code verified the quotes of 9; profile “Petr” v7 now has 5 live facts.')
    expect(isOwnRun()).toBe(false)
  })

  it('shows "Reading your messages…" until the first chunk count arrives', async () => {
    const lines: string[] = []
    vi.mocked(runExtract).mockImplementation(async () => {
      lines.push(describeExtractJob(getExtractJob(), now))
      return ok()
    })
    await startExtract('petr', 'Petr', now)
    expect(lines).toEqual(['Extracting into “Petr”: Reading your messages… · 0 s'])
  })

  it('keeps the error text and never rejects', async () => {
    vi.mocked(runExtract).mockRejectedValueOnce(new Error('No Anthropic API key'))
    const final = await startExtract('petr', 'Petr', now)
    expect(final).toMatchObject({ status: 'error', error: 'No Anthropic API key', seconds: 0 })
    expect(describeExtractJob(final)).toContain('failed after 0 s: No Anthropic API key')
  })

  it('ignores progress that arrives after the run ended', async () => {
    let late: ((d: number, t: number, s: 'map') => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(async (_id, onProgress) => {
      late = onProgress as typeof late
      return ok()
    })
    await startExtract('petr', 'Petr', now)
    late!(9, 9, 'map')
    expect(getExtractJob().status).toBe('done')
  })

  it('refuses a second run on the same page while one is running', async () => {
    let finish: (() => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(ok()))))
    const first = startExtract('petr', 'Petr', now)
    await expect(startExtract('mikhail', 'Mikhail', now)).rejects.toThrow('already running on this page')
    finish!()
    expect((await first).status).toBe('done')
  })

  it('dismiss clears a finished job but not a running one', async () => {
    let finish: (() => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(ok()))))
    const run = startExtract('petr', 'Petr', now)
    dismissExtractJob()
    expect(getExtractJob().status).toBe('running')
    finish!()
    await run
    dismissExtractJob()
    expect(getExtractJob()).toEqual({ status: 'idle' })
  })

  it('shows the last result again after a reload', async () => {
    vi.mocked(runExtract).mockResolvedValueOnce(ok(2))
    const done = await startExtract('petr', 'Petr', now)
    resetExtractJobForTests({ writer: 'the-page-before-reload', job: done })
    expect(getExtractJob()).toEqual({ status: 'idle' })
    expect(await restoreExtractJob(now)).toEqual(done)
  })

  it('without the Lock API, a foreign running record is trusted while fresh and interrupted once stale', async () => {
    resetExtractJobForTests(foreignRunning())
    const restored = await restoreExtractJob(now)
    expect(restored).toMatchObject({ status: 'running', pageId: 'other-page' })
    expect(isOwnRun(restored)).toBe(false)
    expect(describeExtractJob(restored, now)).toBe('Extracting into “Petr” (in another tab): Sonnet merging · 10 s')

    t += STALE_MS + 1
    expect(await syncExtractJob(now)).toMatchObject({ status: 'interrupted', stage: 'reduce', done: 0, total: 1 })
    expect(getExtractJob()).not.toHaveProperty('pageId')
    expect(describeExtractJob(getExtractJob())).toBe(
      'Extraction into “Petr” was interrupted while Sonnet was merging (the page closed or reloaded). Nothing was saved; run it again.',
    )
  })

  it('wording for a run interrupted mid-map', () => {
    expect(describeExtractJob({ status: 'interrupted', profileId: 'p', profileName: 'Petr', startedAt: '', stage: 'map', done: 3, total: 9, updatedAt: '' })).toContain(
      'while Haiku was reading chunk 3 of 9',
    )
    expect(describeExtractJob({ status: 'interrupted', profileId: 'p', profileName: 'Petr', startedAt: '', stage: 'map', done: 0, total: 0, updatedAt: '' })).toContain(
      'while reading your messages',
    )
  })
})

describe('with chrome.storage.session echoing onChanged', () => {
  it("this page's own echoes never bring a finished run back to 'running' (all chunks failed)", async () => {
    const fake = installFakeChrome()
    await restoreExtractJob(now)
    vi.mocked(runExtract).mockImplementationOnce(async (_id, onProgress) => {
      onProgress?.(2, 2, 'map')
      throw new Error('No Anthropic API key')
    })
    const final = await startExtract('petr', 'Petr', now)
    expect(final.status).toBe('error')
    await fake.flush() // the echoes of the running writes and of the error write arrive now
    expect(getExtractJob()).toMatchObject({ status: 'error', error: 'No Anthropic API key' })
    expect(isOwnRun()).toBe(false)
    expect(fake.stored()).toMatchObject({ writer: PAGE_ID, job: { status: 'error' } })
  })

  it("a foreign record delivered mid-run does not replace this page's own run", async () => {
    const fake = installFakeChrome()
    await restoreExtractJob(now)
    let finish: (() => void) | undefined
    vi.mocked(runExtract).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(ok()))))
    const run = startExtract('petr', 'Petr', now)
    await fake.writeAsOtherPage(foreignRunning())
    await fake.flush()
    expect(isOwnRun()).toBe(true)
    finish!()
    expect((await run).status).toBe('done')
  })

  it('a record from another page is adopted when this page is idle, and its dismiss clears it here too', async () => {
    const fake = installFakeChrome()
    await restoreExtractJob(now)
    const done: ExtractJob = { status: 'done', profileId: 'mikhail', profileName: 'Mikhail', startedAt: '', finishedAt: '', seconds: 3, chunks: 1, candidates: 2, verified: 2, liveFacts: 4, version: 2 }
    await fake.writeAsOtherPage({ writer: 'other-page', job: done })
    await fake.flush()
    expect(getExtractJob()).toEqual(done)
    await fake.writeAsOtherPage({ writer: 'other-page', job: { status: 'idle' } })
    await fake.flush()
    expect(getExtractJob()).toEqual({ status: 'idle' })
  })
})

describe('with the Web Locks API', () => {
  it('holds the lock while running and releases it after', async () => {
    const held = installFakeLocks()
    let duringRun = false
    vi.mocked(runExtract).mockImplementationOnce(async () => {
      duringRun = held.has(EXTRACT_LOCK)
      return ok()
    })
    await startExtract('petr', 'Petr', now)
    expect(duringRun).toBe(true)
    expect(held.has(EXTRACT_LOCK)).toBe(false)
  })

  it('after a reload, a fresh record whose page is gone shows as interrupted at once', async () => {
    installFakeLocks() // nobody holds the lock
    resetExtractJobForTests(foreignRunning({ pageId: 'the-page-before-reload' }))
    expect(await restoreExtractJob(now)).toMatchObject({ status: 'interrupted', stage: 'reduce' })
  })

  it('a live run in another tab stays running and blocks a second start here', async () => {
    const held = installFakeLocks()
    held.add(EXTRACT_LOCK)
    resetExtractJobForTests(foreignRunning())
    expect(await restoreExtractJob(now)).toMatchObject({ status: 'running', pageId: 'other-page' })
    expect(await syncExtractJob(now)).toMatchObject({ status: 'running' })
    await expect(startExtract('petr', 'Petr', now)).rejects.toThrow('another Tailor tab')
    expect(runExtract).not.toHaveBeenCalled()
  })
})
