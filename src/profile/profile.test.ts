import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Evidence, Fact, Profile } from '@/types'
import { resetDbForTests } from '@/archive'
import { setSettings } from '@/settings'
import {
  activeFacts,
  deleteFact,
  formatEvidence,
  getProfile,
  listProfiles,
  loadProfileFile,
  parseProfileFile,
  saveProfile,
  sourceSplit,
  truncateQuote,
  updateFact,
} from '@/profile'

const ev = (origin: string, quote = 'q', date = '2026-08-03'): Evidence => ({ origin, title: 't', date, quote })

function fact(id: string, origins: string[], extra: Partial<Fact> = {}): Fact {
  return {
    id,
    category: 'owns',
    value: `value ${id}`,
    confidence: 0.8,
    source: 'chat',
    evidence: origins.map((o) => ev(o)),
    ...extra,
  }
}

beforeEach(async () => {
  indexedDB = new IDBFactory()
  resetDbForTests()
  await setSettings({ activeProfileId: 'default' })
})

describe('profile store', () => {
  it('creates an empty profile, then round-trips with a version bump on every save', async () => {
    const empty = await getProfile()
    expect(empty).toEqual({ version: 0, facts: [], shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } })

    const v1 = await saveProfile({ ...empty, facts: [fact('a', ['chatgpt'])] })
    expect(v1.version).toBe(1)
    const v2 = await saveProfile(v1)
    expect(v2.version).toBe(2)

    const loaded = await getProfile()
    expect(loaded.version).toBe(2)
    expect(loaded.facts.map((f) => f.id)).toEqual(['a'])
    expect(Object.keys(loaded).sort()).toEqual(['facts', 'shares', 'stats', 'version'])

    const [row] = await listProfiles()
    expect(row).toMatchObject({ id: 'default', name: 'Default', version: 2 })
    expect(Number.isNaN(Date.parse(row.updatedAt))).toBe(false)
  })

  it('never lets the version go backwards when a stale copy is saved', async () => {
    const stale = await getProfile()
    await saveProfile(stale)
    await saveProfile(stale)
    const third = await saveProfile(stale) // stale.version is still 0
    expect(third.version).toBe(3)
  })

  it('keeps two profiles side by side and follows the active profile setting', async () => {
    await saveProfile({ ...(await getProfile('mikhail')), facts: [fact('m1', ['claude'])] }, 'mikhail')
    await saveProfile({ ...(await getProfile('petr')), facts: [fact('p1', ['chatgpt']), fact('p2', ['chatgpt'])] }, 'petr')

    expect((await getProfile('mikhail')).facts.map((f) => f.id)).toEqual(['m1'])
    expect((await getProfile('petr')).facts.map((f) => f.id)).toEqual(['p1', 'p2'])

    const names = (await listProfiles()).map((p) => p.name).sort()
    expect(names).toEqual(['Mikhail', 'Petr'])

    await setSettings({ activeProfileId: 'petr' })
    expect((await getProfile()).facts).toHaveLength(2)
  })
})

describe('updateFact / deleteFact', () => {
  async function seed(): Promise<Profile> {
    return saveProfile({ ...(await getProfile()), facts: [fact('a', ['chatgpt']), fact('b', ['claude'])] })
  }

  it('marks a value change as edited and bumps the version', async () => {
    const before = await seed()
    const after = await updateFact('a', { value: 'owns a PS5 Pro' })
    expect(after.version).toBe(before.version + 1)
    expect(after.facts.find((f) => f.id === 'a')).toMatchObject({ value: 'owns a PS5 Pro', userStatus: 'edited' })
    expect(after.facts.find((f) => f.id === 'b')?.userStatus).toBeUndefined()
  })

  it('keeps an explicit status and leaves an unchanged value alone', async () => {
    await seed()
    const kept = await updateFact('a', { userStatus: 'kept' })
    expect(kept.facts.find((f) => f.id === 'a')?.userStatus).toBe('kept')
    const same = await updateFact('a', { value: 'value a' })
    expect(same.facts.find((f) => f.id === 'a')?.userStatus).toBe('kept')
  })

  it('deletes softly: the fact stays stored, marked deleted, and leaves activeFacts', async () => {
    await seed()
    const after = await deleteFact('b')
    expect(after.facts).toHaveLength(2)
    expect(after.facts.find((f) => f.id === 'b')?.userStatus).toBe('deleted')
    expect(activeFacts(after).map((f) => f.id)).toEqual(['a'])

    // Editing a deleted fact's text does not bring it back; only an explicit status does.
    const edited = await updateFact('b', { value: 'something else' })
    expect(edited.facts.find((f) => f.id === 'b')?.userStatus).toBe('deleted')
    const restored = await updateFact('b', { userStatus: 'kept' })
    expect(activeFacts(restored).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('throws on an unknown fact id', async () => {
    await seed()
    await expect(updateFact('nope', { value: 'x' })).rejects.toThrow(/no fact/)
  })

  it('serializes concurrent edits so none is lost', async () => {
    await seed()
    await Promise.all([updateFact('a', { value: 'A2' }), updateFact('b', { value: 'B2' })])
    const p = await getProfile()
    expect(p.facts.map((f) => f.value)).toEqual(['A2', 'B2'])
  })
})

describe('parseProfileFile / loadProfileFile', () => {
  const file = (): Profile => ({
    version: 1,
    facts: [fact('f1', ['claude'], { prior: { alpha: 1.95, beta: 1 } }), fact('f2', ['claude'])],
    shares: [],
    stats: { conversations: 42, messages: 103, from: '2026-07-14', to: '2026-10-10' },
  })

  it('accepts a §6 profile file as-is, or wrapped as { id, profile }', () => {
    expect(parseProfileFile(file())).toEqual(file())
    expect(parseProfileFile({ id: 'petr', profile: file() })).toEqual(file())
  })

  it('names the bad field by path, never its value', () => {
    const bad = { ...file(), facts: [{ ...fact('f1', ['claude']), category: 'secret-text' }] }
    expect(() => parseProfileFile(bad)).toThrow(/not a Tailor profile file \(facts\.0\.category: /)
    expect(() => parseProfileFile(bad)).not.toThrow(/secret-text/)
    expect(() => parseProfileFile([{ mapping: {} }])).toThrow(/not a Tailor profile file/)
  })

  it('rejects duplicate fact ids', () => {
    expect(() => parseProfileFile({ ...file(), facts: [fact('f1', ['claude']), fact('f1', ['claude'])] })).toThrow(/unique/)
  })

  it('replaces the facts of the target profile, keeps its name and bumps the version past both', async () => {
    await saveProfile({ ...(await getProfile('mikhail')), version: 5, facts: [fact('old', ['chatgpt'])] }, 'mikhail')
    const loaded = await loadProfileFile(file(), 'mikhail')
    expect(loaded.facts.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(loaded.stats.conversations).toBe(42)
    expect(loaded.version).toBe(7)
    expect((await listProfiles()).find((p) => p.id === 'mikhail')?.name).toBe('Mikhail')
  })
})

describe('sourceSplit', () => {
  it('splits active chat facts by origin and leaves behavior facts out', () => {
    const profile: Profile = {
      version: 1,
      shares: [],
      stats: { conversations: 0, messages: 0, from: '', to: '' },
      facts: [
        fact('g', ['chatgpt', 'chatgpt']),
        fact('c', ['claude']),
        fact('both', ['chatgpt', 'claude']),
        fact('gone', ['chatgpt'], { userStatus: 'deleted' }),
        fact('clicks', ['https://www.bestbuy.com/tv'], { source: 'behavior' }),
      ],
    }
    const split = sourceSplit(profile)
    expect(split.chatgptOnly.map((f) => f.id)).toEqual(['g'])
    expect(split.claudeOnly.map((f) => f.id)).toEqual(['c'])
    expect(split.both.map((f) => f.id)).toEqual(['both'])
  })
})

describe('formatEvidence', () => {
  it('matches the §3.4 example', () => {
    expect(formatEvidence(ev('chatgpt', 'just got a PS5, which TV should I get?', '2026-08-03'))).toBe(
      "ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'",
    )
  })

  it('labels Claude, formats local timestamps, and uses the hostname for page origins', () => {
    expect(formatEvidence(ev('claude', 'hi there', '2026-01-15T12:00:00'))).toBe("Claude, Jan 15: 'hi there'")
    expect(formatEvidence(ev('https://www.bestbuy.com/site/tv?id=1', 'expanded the specs table', '2026-10-10'))).toBe(
      "bestbuy.com, Oct 10: 'expanded the specs table'",
    )
  })

  it('drops an unparseable date and truncates long quotes with an ellipsis', () => {
    const long = 'I keep asking whether this soundbar will work with my PS5 and the LG TV in the living room because the manual is unclear'
    const out = formatEvidence(ev('chatgpt', long, 'not a date'))
    expect(out.startsWith("ChatGPT: 'I keep asking")).toBe(true)
    expect(out.endsWith("…'")).toBe(true)
    const quote = out.slice("ChatGPT: '".length, -1)
    expect(quote.length).toBeLessThanOrEqual(91)
    expect(long.startsWith(quote.slice(0, -1))).toBe(true)
  })

  it('truncateQuote collapses whitespace and leaves short quotes alone', () => {
    expect(truncateQuote('  short\n  quote ')).toBe('short quote')
    expect(truncateQuote('x'.repeat(200))).toBe('x'.repeat(90) + '…')
  })
})
