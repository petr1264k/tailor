/**
 * Learn (CONTEXT.txt §3.8). Owner: Mikhail.
 *
 * Log interactions: expand, collapse, toggle back to the original, open "why", ignore a note, dwell time.
 * Signals update the profile as behavior facts (source 'behavior'), each with evidence (page url, title, date, what happened).
 * Each layout choice (specs first, marketing collapsed, ...) is a small per-person bandit with a Beta prior.
 * Seed it with a WEAK prior from the chats and let clicks override it quickly.
 * Stage line: "Your chats are the prior, your clicks are the evidence."
 *
 * Behavior fact per layout choice: value 'layout:<choice>', category 'reading', prior = Beta(alpha, beta),
 * confidence = alpha / (alpha + beta). Code only; no model call anywhere in this module.
 * Interactions carry no chat text, so logging them never stores message text.
 */
import type { BlockType, Evidence, Fact, FactCategory, Interaction, Profile } from '@/types'
import type { HandlerMap } from '@/messages'
import { getDb } from '@/archive'
import { activeFacts, getProfile, saveProfile, siteName, withProfileLock } from '@/profile'

export type LayoutChoice = 'specs_first' | 'marketing_collapsed' | 'steps_expanded' | 'compare_table' | 'summary_only'

export const LAYOUT_CHOICES: readonly LayoutChoice[] = [
  'specs_first',
  'marketing_collapsed',
  'steps_expanded',
  'compare_table',
  'summary_only',
]

/** Human labels for the profile viewer (the behavior fact's value is the machine form 'layout:<choice>'). */
export const LAYOUT_LABELS: Record<LayoutChoice, string> = {
  specs_first: 'Specs first',
  marketing_collapsed: 'Marketing collapsed',
  steps_expanded: 'Steps expanded',
  compare_table: 'Comparison table',
  summary_only: 'Summary only',
}

export interface BetaPrior {
  alpha: number
  beta: number
}

const FLAT: BetaPrior = { alpha: 1, beta: 1 }
const DWELL_MS = 8000
const EVIDENCE_CAP = 5

export function layoutFactValue(choice: LayoutChoice): string {
  return `layout:${choice}`
}

/** 'layout:specs_first' → 'specs_first'; null for any other fact. */
export function layoutChoiceOf(fact: Fact): LayoutChoice | null {
  if (fact.source !== 'behavior' || !fact.value.startsWith('layout:')) return null
  const choice = fact.value.slice('layout:'.length) as LayoutChoice
  return LAYOUT_CHOICES.includes(choice) ? choice : null
}

export function priorMean(prior: BetaPrior): number {
  return prior.alpha / (prior.alpha + prior.beta)
}

/** Weak prior: a chat fact with confidence c starts at alpha = 1 + c, beta = 1. One click outweighs it. */
export function seedPriorFromChats(fact: Fact): BetaPrior {
  const c = Math.min(1, Math.max(0, Number.isFinite(fact.confidence) ? fact.confidence : 0))
  return { alpha: 1 + c, beta: 1 }
}

export function updatePrior(prior: BetaPrior, reward: boolean): BetaPrior {
  return reward ? { alpha: prior.alpha + 1, beta: prior.beta } : { alpha: prior.alpha, beta: prior.beta + 1 }
}

// ── Chat seeds: which chat facts speak to which layout choice (code-only keyword map) ──

const HINT_CATEGORIES: ReadonlySet<FactCategory> = new Set<FactCategory>(['reading', 'visual', 'dislikes', 'expertise'])

const CHAT_HINTS: Record<LayoutChoice, RegExp> = {
  specs_first: /\bspecs?\b|specification|technical|benchmark|numbers/i,
  marketing_collapsed: /marketing|hype|fluff|buzzword|sales ?pitch/i,
  steps_expanded: /step[- ]by[- ]step|\bsteps\b|instructions|how[- ]to|walkthrough/i,
  compare_table: /compar|side[- ]by[- ]side|\bvs\b|versus|\btables?\b/i,
  summary_only: /\btl;?dr\b|summar|concise|brief|short answers?|bullet/i,
}

/**
 * The weak chat prior for a layout choice: the strongest active chat fact whose value hints at it
 * (e.g. reading: "prefers detailed technical specs" → specs_first). null when the chats say nothing.
 */
export function chatPriorFor(profile: Profile, choice: LayoutChoice): BetaPrior | null {
  let best: Fact | null = null
  for (const f of activeFacts(profile)) {
    if (f.source !== 'chat' || !HINT_CATEGORIES.has(f.category) || !CHAT_HINTS[choice].test(f.value)) continue
    if (!best || f.confidence > best.confidence) best = f
  }
  return best ? (best.prior ?? seedPriorFromChats(best)) : null
}

/** The live behavior fact for a choice. Deleted ones are ignored (the owner said no). */
function layoutFact(profile: Profile, choice: LayoutChoice): Fact | undefined {
  return activeFacts(profile).find((f) => f.source === 'behavior' && f.value === layoutFactValue(choice))
}

/** Clicks if any, else the chats, else flat Beta(1, 1). */
export function layoutPrior(profile: Profile, choice: LayoutChoice): BetaPrior {
  return layoutFact(profile, choice)?.prior ?? chatPriorFor(profile, choice) ?? FLAT
}

// ── Sampling ──

/** mulberry32: a tiny seeded rng for tests, evals and a deterministic demo. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleNormal(rng: () => number): number {
  const u1 = 1 - rng() // (0, 1]: log() stays finite
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Gamma(shape, 1) via Marsaglia–Tsang; shape < 1 via the boost Gamma(shape + 1) · U^(1/shape). */
export function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(1 - rng(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  // Bounded so a degenerate rng (e.g. a constant) cannot spin forever; real rngs accept in ~1 to 2 tries.
  for (let i = 0; i < 100; i++) {
    const x = sampleNormal(rng)
    const v0 = 1 + c * x
    if (v0 <= 0) continue
    const v = v0 * v0 * v0
    if (Math.log(1 - rng()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
  }
  return shape // the mean
}

export function sampleBeta(prior: BetaPrior, rng: () => number): number {
  const x = sampleGamma(Math.max(prior.alpha, 1e-3), rng)
  const y = sampleGamma(Math.max(prior.beta, 1e-3), rng)
  return x + y > 0 ? x / (x + y) : 0.5
}

/**
 * Thompson sampling over the layout facts in the profile. Deterministic when `rng` is given (tests, evals).
 * For each choice: draw from Beta(prior); keep the choices whose draw > 0.5, strongest first.
 */
export function sampleLayout(profile: Profile, rng: () => number = Math.random): LayoutChoice[] {
  return LAYOUT_CHOICES.map((choice) => ({ choice, draw: sampleBeta(layoutPrior(profile, choice), rng) }))
    .filter((d) => d.draw > 0.5)
    .sort((a, b) => b.draw - a.draw)
    .map((d) => d.choice)
}

/** Greedy (no sampling): choices whose posterior mean is > 0.5, strongest first. A no-surprises mode for the demo. */
export function bestLayout(profile: Profile): LayoutChoice[] {
  return LAYOUT_CHOICES.map((choice) => ({ choice, mean: priorMean(layoutPrior(profile, choice)) }))
    .filter((d) => d.mean > 0.5)
    .sort((a, b) => b.mean - a.mean)
    .map((d) => d.choice)
}

// ── What was shown on each page (so dwell / toggle reward or penalize the right arms) ──

const shownLayouts = new Map<string, LayoutChoice[]>()

/**
 * Tailor calls this with the layout it actually used for a url (after sampleLayout).
 * In memory only: an MV3 worker restart forgets it, and dwell / toggle_original fall back to bestLayout().
 */
export function rememberLayout(url: string, choices: LayoutChoice[]): void {
  shownLayouts.delete(url)
  shownLayouts.set(url, choices)
  if (shownLayouts.size > 50) shownLayouts.delete(shownLayouts.keys().next().value as string)
}

/** Tests only. */
export function resetLearnStateForTests(): void {
  shownLayouts.clear()
}

function shownLayout(profile: Profile, url: string): LayoutChoice[] {
  return shownLayouts.get(url) ?? bestLayout(profile)
}

// ── Interaction → (choice, reward) ──

/** The layout choice a block expresses (used when the user ignores it). */
const BLOCK_CHOICE: Partial<Record<BlockType, LayoutChoice>> = {
  key_facts: 'specs_first',
  compare: 'compare_table',
  hidden: 'marketing_collapsed',
  steps: 'steps_expanded',
  summary: 'summary_only',
}

/** Notes that cite profile facts. Ignoring one is evidence against the cited facts (§3.8 "ignore a note"). */
const NOTE_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(['for_you', 'warning'])

const BLOCK_LABEL: Record<BlockType, string> = {
  summary: 'summary',
  for_you: '"for you" note',
  key_facts: 'specs table',
  compare: 'comparison table',
  steps: 'steps',
  warning: 'warning',
  section: 'section',
  hidden: 'collapsed section',
  cta: 'button',
  from_site: "site's reply",
}

export interface LayoutReward {
  choice: LayoutChoice
  reward: boolean
}

/**
 * The mapping (§3.8):
 *  expand key_facts/compare → specs_first ✓      collapse section/summary → marketing_collapsed ✓
 *  expand steps → steps_expanded ✓               ignore a block → the choice that block expresses ✗
 *  toggle_original → every shown choice ✗        dwell ≥ 8 s → every shown choice ✓
 *  open_why → no layout change (handled on the cited facts instead)
 * "Shown" = what rememberLayout() recorded for this url, else the choices currently > 0.5 (bestLayout).
 */
export function layoutRewards(profile: Profile, interaction: Interaction): LayoutReward[] {
  const { kind, blockType } = interaction
  switch (kind) {
    case 'expand':
      if (blockType === 'key_facts' || blockType === 'compare') return [{ choice: 'specs_first', reward: true }]
      if (blockType === 'steps') return [{ choice: 'steps_expanded', reward: true }]
      // TODO(learn): expanding a 'hidden' block arguably means marketing_collapsed ✗, but render may hide specs there too.
      return []
    case 'collapse':
      return blockType === 'section' || blockType === 'summary' ? [{ choice: 'marketing_collapsed', reward: true }] : []
    case 'ignore': {
      const choice = BLOCK_CHOICE[blockType]
      return choice ? [{ choice, reward: false }] : []
    }
    case 'toggle_original':
      return shownLayout(profile, interaction.url).map((choice) => ({ choice, reward: false }))
    case 'dwell':
      return (interaction.ms ?? 0) >= DWELL_MS
        ? shownLayout(profile, interaction.url).map((choice) => ({ choice, reward: true }))
        : []
    case 'open_why':
      return []
  }
}

/** The short "what happened" line stored as the behavior fact's evidence quote, e.g. 'expanded the specs table'. */
function describe(interaction: Interaction): string {
  const label = BLOCK_LABEL[interaction.blockType] ?? interaction.blockType
  switch (interaction.kind) {
    case 'expand':
      return `expanded the ${label}`
    case 'collapse':
      return `collapsed the ${label}`
    case 'ignore':
      return `skipped the ${label}`
    case 'toggle_original':
      return 'switched back to the original page'
    case 'dwell':
      return `read the tailored page for ${Math.round((interaction.ms ?? 0) / 1000)}s`
    case 'open_why':
      return `opened "why" on the ${label}`
  }
}

/** Append to the archive's `interactions` store. */
export async function logInteraction(interaction: Interaction): Promise<void> {
  const db = await getDb()
  await db.add('interactions', interaction)
}

/**
 * Turn one interaction into prior updates and behavior facts. Returns the facts that changed, for the on-screen
 * update in the demo. Pure: the input profile is not mutated and the version is not bumped (saveProfile does that).
 */
export async function applyInteraction(profile: Profile, interaction: Interaction): Promise<{ profile: Profile; changed: Fact[] }> {
  const facts = profile.facts.slice()
  const changed = new Map<string, Fact>()
  const put = (fact: Fact): void => {
    const i = facts.findIndex((f) => f.id === fact.id)
    if (i >= 0) facts[i] = fact
    else facts.push(fact)
    changed.set(fact.id, fact)
  }

  // 1. Signals on the cited facts: open "why" → alpha + 1; ignoring a note that cites them → beta + 1.
  //    Chat facts keep their extraction confidence (the prior feeds chatPriorFor); behavior facts track the mean.
  const citedReward =
    interaction.kind === 'open_why' ? true : interaction.kind === 'ignore' && NOTE_BLOCKS.has(interaction.blockType) ? false : null
  if (citedReward !== null) {
    for (const id of new Set(interaction.factIds ?? [])) {
      const fact = facts.find((f) => f.id === id && f.userStatus !== 'deleted')
      if (!fact) continue
      const prior = updatePrior(fact.prior ?? seedPriorFromChats(fact), citedReward)
      put({ ...fact, prior, ...(fact.source === 'behavior' ? { confidence: priorMean(prior) } : {}) })
    }
  }

  // 2. Layout bandit: create or update one behavior fact per (choice, reward).
  const evidence: Evidence = {
    origin: interaction.url,
    title: siteName(interaction.url),
    date: interaction.at,
    quote: describe(interaction),
  }
  for (const { choice, reward } of layoutRewards(profile, interaction)) {
    const value = layoutFactValue(choice)
    const existing = facts.find((f) => f.source === 'behavior' && f.value === value)
    // The owner deleted this learned preference: respect it, never relearn or resurrect it.
    if (existing?.userStatus === 'deleted') continue
    const base: Fact = existing ?? {
      id: `behavior-${value.replace(':', '-')}`,
      category: 'reading',
      value,
      confidence: 0.5,
      source: 'behavior',
      evidence: [],
    }
    const prior = updatePrior(base.prior ?? chatPriorFor(profile, choice) ?? FLAT, reward)
    put({
      ...base,
      prior,
      confidence: priorMean(prior),
      evidence: [evidence, ...base.evidence].slice(0, EVIDENCE_CAP), // newest first
    })
  }

  return { profile: { ...profile, facts }, changed: [...changed.values()] }
}

export const handlers: HandlerMap = {
  // logInteraction → getProfile → applyInteraction → saveProfile → { profileVersion, changed }.
  // Serialized with the profile lock so two quick clicks both count. No change → no version bump (keeps the cache warm).
  'learn/log': async (msg) =>
    withProfileLock(async () => {
      await logInteraction(msg.interaction)
      const profile = await getProfile()
      const { profile: next, changed } = await applyInteraction(profile, msg.interaction)
      if (changed.length === 0) return { profileVersion: profile.version, changed }
      const saved = await saveProfile(next)
      return { profileVersion: saved.version, changed }
    }),
}
