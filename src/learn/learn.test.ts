import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Fact, Interaction, Profile } from '@/types'
import { getDb, resetDbForTests } from '@/archive'
import { setSettings } from '@/settings'
import { emptyProfile, getProfile, saveProfile } from '@/profile'
import {
  applyInteraction,
  bestLayout,
  chatPriorFor,
  handlers,
  layoutPrior,
  rememberLayout,
  resetLearnStateForTests,
  sampleBeta,
  sampleLayout,
  seededRng,
  seedPriorFromChats,
  updatePrior,
  type LayoutChoice,
} from '@/learn'

const URL_A = 'https://www.bestbuy.com/site/lg-c4-oled'

function interaction(kind: Interaction['kind'], blockType: Interaction['blockType'], extra: Partial<Interaction> = {}): Interaction {
  return { url: URL_A, profileVersion: 1, kind, blockType, at: '2026-10-10T21:30:00.000Z', ...extra }
}

function chatFact(id: string, value: string, extra: Partial<Fact> = {}): Fact {
  return {
    id,
    category: 'reading',
    value,
    confidence: 0.6,
    source: 'chat',
    evidence: [{ origin: 'chatgpt', title: 'TVs', date: '2026-08-03', quote: 'just got a PS5' }],
    ...extra,
  }
}

function layoutFact(choice: LayoutChoice, alpha: number, beta: number, extra: Partial<Fact> = {}): Fact {
  return {
    id: `behavior-layout-${choice}`,
    category: 'reading',
    value: `layout:${choice}`,
    confidence: alpha / (alpha + beta),
    source: 'behavior',
    evidence: [],
    prior: { alpha, beta },
    ...extra,
  }
}

const withFacts = (facts: Fact[]): Profile => ({ ...emptyProfile(), version: 1, facts })

beforeEach(async () => {
  indexedDB = new IDBFactory()
  resetDbForTests()
  resetLearnStateForTests()
  await setSettings({ activeProfileId: 'default' })
})

describe('priors', () => {
  it('seeds a weak prior from a chat fact', () => {
    expect(seedPriorFromChats(chatFact('a', 'x', { confidence: 0.6 }))).toEqual({ alpha: 1.6, beta: 1 })
    expect(seedPriorFromChats(chatFact('a', 'x', { confidence: 3 }))).toEqual({ alpha: 2, beta: 1 })
    expect(seedPriorFromChats(chatFact('a', 'x', { confidence: -1 }))).toEqual({ alpha: 1, beta: 1 })
  })

  it('updatePrior adds one to alpha on a reward and one to beta otherwise', () => {
    expect(updatePrior({ alpha: 1.6, beta: 1 }, true)).toEqual({ alpha: 2.6, beta: 1 })
    expect(updatePrior({ alpha: 1.6, beta: 1 }, false)).toEqual({ alpha: 1.6, beta: 2 })
  })

  it('maps chat facts onto layout choices: the chats are the prior', () => {
    const p = withFacts([
      chatFact('specs', 'prefers detailed technical specs', { confidence: 0.9 }),
      chatFact('weak', 'likes specs tables', { confidence: 0.3 }),
      chatFact('gone', 'dislikes marketing fluff', { category: 'dislikes', userStatus: 'deleted' }),
    ])
    expect(chatPriorFor(p, 'specs_first')).toEqual({ alpha: 1.9, beta: 1 })
    expect(chatPriorFor(p, 'marketing_collapsed')).toBeNull()
    expect(layoutPrior(p, 'summary_only')).toEqual({ alpha: 1, beta: 1 })
  })
})

describe('sampling', () => {
  it('sampleBeta has the right mean (seeded), including shapes below 1', () => {
    const rng = seededRng(42)
    const mean = (a: number, b: number) => {
      let s = 0
      for (let i = 0; i < 4000; i++) s += sampleBeta({ alpha: a, beta: b }, rng)
      return s / 4000
    }
    expect(mean(3, 1)).toBeCloseTo(0.75, 1)
    expect(mean(1, 1)).toBeCloseTo(0.5, 1)
    expect(mean(0.5, 2)).toBeCloseTo(0.2, 1)
  })

  it('never spins forever on a degenerate rng', () => {
    const draw = sampleBeta({ alpha: 2, beta: 2 }, () => 0)
    expect(draw).toBeGreaterThanOrEqual(0)
    expect(draw).toBeLessThanOrEqual(1)
  })

  it('sampleLayout is deterministic with a seeded rng and follows strong evidence', () => {
    const p = withFacts([
      layoutFact('specs_first', 40, 1),
      layoutFact('marketing_collapsed', 20, 1),
      layoutFact('summary_only', 1, 40),
      layoutFact('compare_table', 1, 40),
      layoutFact('steps_expanded', 1, 40),
    ])
    const a = sampleLayout(p, seededRng(7))
    expect(a).toEqual(sampleLayout(p, seededRng(7)))
    expect(a).toEqual(['specs_first', 'marketing_collapsed'])
  })

  it('ignores a deleted behavior fact', () => {
    const p = withFacts([layoutFact('specs_first', 1, 60, { userStatus: 'deleted' })])
    expect(layoutPrior(p, 'specs_first')).toEqual({ alpha: 1, beta: 1 })
  })

  it('bestLayout returns choices with mean > 0.5, strongest first', () => {
    const p = withFacts([layoutFact('marketing_collapsed', 2, 1), layoutFact('specs_first', 5, 1), layoutFact('summary_only', 1, 2)])
    expect(bestLayout(p)).toEqual(['specs_first', 'marketing_collapsed'])
  })
})

describe('applyInteraction', () => {
  it('creates a behavior fact on the first expand, then updates the same fact', async () => {
    const start = withFacts([chatFact('ps5', 'owns a PS5', { category: 'owns' })])
    const first = await applyInteraction(start, interaction('expand', 'key_facts'))
    expect(start.facts).toHaveLength(1) // input not mutated
    expect(first.changed).toHaveLength(1)
    const created = first.changed[0]
    expect(created).toMatchObject({
      source: 'behavior',
      category: 'reading',
      value: 'layout:specs_first',
      prior: { alpha: 2, beta: 1 },
    })
    expect(created.confidence).toBeCloseTo(2 / 3)
    expect(created.evidence).toEqual([
      { origin: URL_A, title: 'bestbuy.com', date: '2026-10-10T21:30:00.000Z', quote: 'expanded the specs table' },
    ])

    const second = await applyInteraction(first.profile, interaction('expand', 'compare', { at: '2026-10-10T21:31:00.000Z' }))
    expect(second.profile.facts).toHaveLength(2)
    expect(second.changed.map((f) => f.id)).toEqual([created.id])
    const updated = second.changed[0]
    expect(updated.prior).toEqual({ alpha: 3, beta: 1 })
    expect(updated.confidence).toBeCloseTo(0.75)
    expect(updated.evidence.map((e) => e.quote)).toEqual(['expanded the comparison table', 'expanded the specs table'])
    expect(bestLayout(second.profile)).toEqual(['specs_first'])
  })

  it('starts the behavior fact from the chat prior when the chats hint at it', async () => {
    const start = withFacts([chatFact('specs', 'prefers technical specs', { confidence: 0.5 })])
    const { changed } = await applyInteraction(start, interaction('expand', 'key_facts'))
    expect(changed[0].prior).toEqual({ alpha: 2.5, beta: 1 })
  })

  it('caps evidence at 5, newest first', async () => {
    let p = withFacts([])
    for (let i = 0; i < 7; i++) {
      p = (await applyInteraction(p, interaction('collapse', 'section', { at: `2026-10-10T21:0${i}:00.000Z` }))).profile
    }
    const f = p.facts.find((x) => x.value === 'layout:marketing_collapsed')!
    expect(f.prior).toEqual({ alpha: 8, beta: 1 })
    expect(f.evidence).toHaveLength(5)
    expect(f.evidence[0].date).toBe('2026-10-10T21:06:00.000Z')
  })

  it('maps steps, ignore and unrelated blocks', async () => {
    const steps = await applyInteraction(withFacts([]), interaction('expand', 'steps'))
    expect(steps.changed[0]).toMatchObject({ value: 'layout:steps_expanded', prior: { alpha: 2, beta: 1 } })

    const ignored = await applyInteraction(withFacts([]), interaction('ignore', 'key_facts'))
    expect(ignored.changed[0]).toMatchObject({ value: 'layout:specs_first', prior: { alpha: 1, beta: 2 } })
    expect(ignored.changed[0].evidence[0].quote).toBe('skipped the specs table')

    const nothing = await applyInteraction(withFacts([]), interaction('expand', 'cta'))
    expect(nothing.changed).toEqual([])
  })

  it('open_why adds one to alpha on the cited facts only, with no layout change', async () => {
    const start = withFacts([chatFact('ps5', 'owns a PS5', { confidence: 0.6 }), chatFact('other', 'likes OLED')])
    const { changed, profile } = await applyInteraction(start, interaction('open_why', 'for_you', { factIds: ['ps5', 'missing'] }))
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ id: 'ps5', prior: { alpha: 2.6, beta: 1 }, confidence: 0.6 })
    expect(profile.facts.some((f) => f.source === 'behavior')).toBe(false)
  })

  it('ignoring a "for you" note counts against the facts it cites', async () => {
    const start = withFacts([chatFact('ps5', 'owns a PS5', { confidence: 0.6 })])
    const { changed } = await applyInteraction(start, interaction('ignore', 'for_you', { factIds: ['ps5'] }))
    expect(changed[0].prior).toEqual({ alpha: 1.6, beta: 2 })
  })

  it('toggle_original penalizes every choice currently > 0.5 (or the remembered layout)', async () => {
    const start = withFacts([layoutFact('specs_first', 3, 1), layoutFact('summary_only', 1, 3)])
    const { changed } = await applyInteraction(start, interaction('toggle_original', 'summary'))
    expect(changed.map((f) => [f.value, f.prior])).toEqual([['layout:specs_first', { alpha: 3, beta: 2 }]])

    rememberLayout(URL_A, ['summary_only'])
    const remembered = await applyInteraction(start, interaction('toggle_original', 'summary'))
    expect(remembered.changed.map((f) => [f.value, f.prior])).toEqual([['layout:summary_only', { alpha: 1, beta: 4 }]])
  })

  it('dwell rewards the shown layout only after 8 seconds', async () => {
    rememberLayout(URL_A, ['specs_first', 'marketing_collapsed'])
    const short = await applyInteraction(withFacts([]), interaction('dwell', 'summary', { ms: 7999 }))
    expect(short.changed).toEqual([])
    const long = await applyInteraction(withFacts([]), interaction('dwell', 'summary', { ms: 12000 }))
    expect(long.changed.map((f) => f.value)).toEqual(['layout:specs_first', 'layout:marketing_collapsed'])
    expect(long.changed[0].evidence[0].quote).toBe('read the tailored page for 12s')
  })

  it('never relearns a behavior fact the owner deleted', async () => {
    const start = withFacts([layoutFact('specs_first', 2, 1, { userStatus: 'deleted' })])
    const { changed } = await applyInteraction(start, interaction('expand', 'key_facts'))
    expect(changed).toEqual([])
  })
})

describe("handlers['learn/log']", () => {
  const call = (i: Interaction) => handlers['learn/log']!({ type: 'learn/log', interaction: i }, {} as chrome.runtime.MessageSender)

  it('logs, applies, saves and returns the new version and the changed facts', async () => {
    await saveProfile(await getProfile()) // version 1
    const res = await call(interaction('expand', 'key_facts'))
    expect(res.profileVersion).toBe(2)
    expect(res.changed.map((f) => f.value)).toEqual(['layout:specs_first'])

    const stored = await getProfile()
    expect(stored.version).toBe(2)
    expect(stored.facts.map((f) => f.value)).toEqual(['layout:specs_first'])
    expect(await (await getDb()).count('interactions')).toBe(1)
  })

  it('does not bump the version when nothing changed, and counts two quick clicks twice', async () => {
    const quiet = await call(interaction('dwell', 'summary', { ms: 100 }))
    expect(quiet).toEqual({ profileVersion: 0, changed: [] })

    await Promise.all([call(interaction('expand', 'key_facts')), call(interaction('expand', 'key_facts'))])
    const f = (await getProfile()).facts.find((x) => x.value === 'layout:specs_first')!
    expect(f.prior).toEqual({ alpha: 3, beta: 1 })
    expect(await (await getDb()).count('interactions')).toBe(3)
  })
})
