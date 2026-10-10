/**
 * §8.6 Learning: how the profile changed after N interactions, and how the next page differed.
 * Code only, no model: a scripted session on page 1 (§9 1:25: "expand the collapsed specs twice", read 10 s, ...)
 * goes through applyInteraction (src/learn) on a COPY of the profile. Then, for the next page, compare
 * selectRelevantFacts (what the rewrite would receive) and the layout bandit (bestLayout, sampleLayout over seeded draws).
 * "Your chats are the prior, your clicks are the evidence."
 */
import type { Fact, Interaction, PageContent, Profile } from '@/types'
import { LAYOUT_CHOICES, LAYOUT_LABELS, applyInteraction, bestLayout, layoutPrior, priorMean, sampleBeta, sampleLayout, seededRng, type LayoutChoice } from '@/learn'
import { activeFacts } from '@/profile'
import { selectRelevantFacts } from '@/tailor'
import { argString, loadEvalProfiles, loadPageContents, mdTable, pageUrl, type TaskArgs, type TaskReport } from '../lib/common'
import { pct } from '../lib/stats'

export const DRAWS = 1000
const SEED = 20261010

/** Used only when data/profiles/ is empty, so the task runs today. Every output says SYNTHETIC. */
export const SYNTHETIC_PROFILE: Profile = {
  version: 1,
  shares: [],
  stats: { conversations: 0, messages: 0, from: '', to: '' },
  facts: [
    {
      id: 'syn-owns-ps5',
      category: 'owns',
      value: 'owns a PS5',
      confidence: 0.8,
      source: 'chat',
      evidence: [{ origin: 'chatgpt', title: 'synthetic', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
    },
    {
      id: 'syn-budget',
      category: 'constraint',
      value: 'TV budget under $1,000',
      confidence: 0.7,
      source: 'chat',
      evidence: [{ origin: 'claude', title: 'synthetic', date: '2026-08-20', quote: 'nothing over a grand' }],
    },
  ],
}

type Step = Pick<Interaction, 'kind' | 'blockType' | 'factIds' | 'ms'>

/** The scripted session. N = its length. */
export function sessionScript(citedFactId?: string): Step[] {
  return [
    { kind: 'expand', blockType: 'key_facts' },
    { kind: 'expand', blockType: 'key_facts' },
    { kind: 'dwell', blockType: 'summary', ms: 10_000 },
    { kind: 'collapse', blockType: 'section' },
    ...(citedFactId ? [{ kind: 'open_why', blockType: 'for_you', factIds: [citedFactId] } satisfies Step] : []),
  ]
}

/**
 * Share of seeded Thompson draws in which each layout choice is shown (sampleLayout keeps a choice when its Beta draw
 * is > 0.5). One rng stream per choice, so a choice whose prior did not change reads exactly the same before and after.
 */
export function layoutShares(profile: Profile, draws = DRAWS, seed = SEED): Record<LayoutChoice, number> {
  const out = {} as Record<LayoutChoice, number>
  LAYOUT_CHOICES.forEach((c, i) => {
    const rng = seededRng(seed + i)
    const prior = layoutPrior(profile, c)
    let shown = 0
    for (let k = 0; k < draws; k++) if (sampleBeta(prior, rng) > 0.5) shown++
    out[c] = shown / draws
  })
  return out
}

const describeStep = (s: Step) => `${s.kind} ${s.blockType}${s.ms ? ` (${s.ms / 1000} s)` : ''}${s.factIds ? ` → ${s.factIds.join(', ')}` : ''}`
const priorText = (f?: Fact) => (f?.prior ? `Beta(${f.prior.alpha.toFixed(1)}, ${f.prior.beta.toFixed(1)})` : 'none')

export async function run(args: TaskArgs): Promise<TaskReport> {
  const { pages, contents, notes } = await loadPageContents()
  const loaded = await loadEvalProfiles(argString(args, 'profile'))
  const synthetic = loaded.length === 0
  const who = synthetic ? 'SYNTHETIC' : loaded[0].id
  const before: Profile = structuredClone(synthetic ? SYNTHETIC_PROFILE : loaded[0].profile)

  const withCopy = pages.filter((p) => contents.has(p.id))
  const page1 = withCopy[0] ?? pages[0]
  const page2 = withCopy[1]
  const content1: PageContent | undefined = page1 ? contents.get(page1.id) : undefined
  const url1 = page1 ? pageUrl(page1) : 'https://example.com/product'

  // open "why" on the fact the rewrite would most likely cite on page 1.
  const cited = content1 ? (await selectRelevantFacts(before, content1))[0] : activeFacts(before).find((f) => f.source === 'chat')
  const steps = sessionScript(cited?.id)

  let profile = before
  const stepRows: (string | number)[][] = []
  const t0 = Date.now()
  for (const [i, step] of steps.entries()) {
    const interaction: Interaction = { ...step, url: url1, profileVersion: profile.version, at: new Date(t0 + i * 15_000).toISOString() }
    const res = await applyInteraction(profile, interaction)
    profile = { ...res.profile, version: profile.version + (res.changed.length ? 1 : 0) } // saveProfile bumps in the extension
    stepRows.push([i + 1, describeStep(step), res.changed.map((f) => `${f.value}: ${priorText(f)}`).join('; ') || '(no change)'])
  }
  const after = profile

  const byIdBefore = new Map(before.facts.map((f) => [f.id, f]))
  const changed = after.facts.filter((f) => JSON.stringify(f) !== JSON.stringify(byIdBefore.get(f.id)))
  const changedRows = changed.map((f) => {
    const old = byIdBefore.get(f.id)
    return [f.value, f.source, old ? `${old.confidence.toFixed(2)} → ${f.confidence.toFixed(2)}` : `new → ${f.confidence.toFixed(2)}`, `${priorText(old)} → ${priorText(f)}`,
      // Behavior evidence is "expanded the specs table"; chat facts keep their quotes out of the report.
      f.source === 'behavior' ? (f.evidence[0]?.quote ?? '') : '(chat fact)']
  })

  const sharesBefore = layoutShares(before)
  const sharesAfter = layoutShares(after)
  const layoutRows = LAYOUT_CHOICES.map((c) => [
    LAYOUT_LABELS[c],
    `${priorMean(layoutPrior(before, c)).toFixed(2)} → ${priorMean(layoutPrior(after, c)).toFixed(2)}`,
    `${pct(sharesBefore[c])} → ${pct(sharesAfter[c])}`,
  ])
  const best = (p: Profile) => bestLayout(p).map((c) => LAYOUT_LABELS[c]).join(', ') || '(none above 0.5)'
  const draw = (p: Profile) => sampleLayout(p, seededRng(SEED)).map((c) => LAYOUT_LABELS[c]).join(', ') || '(none)'

  let nextPage = ['No second saved page: save two demo pages to compare the next page.']
  let relevance: { page: string; before: string[]; after: string[] } | null = null
  if (page2) {
    const c2 = contents.get(page2.id)!
    const relBefore = await selectRelevantFacts(before, c2)
    const relAfter = await selectRelevantFacts(after, c2)
    const ids = (fs: Fact[]) => new Set(fs.map((f) => f.id))
    const added = relAfter.filter((f) => !ids(relBefore).has(f.id))
    const dropped = relBefore.filter((f) => !ids(relAfter).has(f.id))
    relevance = { page: page2.id, before: relBefore.map((f) => f.value), after: relAfter.map((f) => f.value) }
    nextPage = [
      `Next page: "${page2.id}". Facts the rewrite receives (selectRelevantFacts): ${relBefore.length} before → ${relAfter.length} after.`,
      `Added: ${added.map((f) => f.value).join('; ') || 'none'}. Dropped: ${dropped.map((f) => f.value).join('; ') || 'none'}.`,
      // TODO(eval): re-tailor the next page live before/after and diff the block order (the rewrite gets bestLayout as its Layout line).
    ]
  }

  const specs = 'specs_first' as const
  const md = [
    '# Learning (CONTEXT.txt §8.6)',
    '',
    `Profile: ${who}${synthetic ? ' (no data/profiles/*.json yet: a 2-fact synthetic profile, NOT a real number)' : ''}. ` +
      `Session on "${page1?.id ?? 'example'}": N = ${steps.length} interactions. Layout draws: ${DRAWS} seeded Thompson samples.`,
    '',
    `**After ${steps.length} interactions, ${changed.length} facts changed; on the next page "${LAYOUT_LABELS[specs]}" is shown in ` +
      `${pct(sharesBefore[specs])} → ${pct(sharesAfter[specs])} of layout draws.**`,
    '',
    '## Interactions',
    '',
    mdTable(['#', 'Interaction', 'Facts changed (prior after)'], stepRows),
    '',
    '## Changed facts',
    '',
    mdTable(['Fact', 'Source', 'Confidence', 'Prior', 'Latest evidence'], changedRows),
    '',
    '## Layout bandit for the next page',
    '',
    mdTable(['Layout choice', 'Posterior mean', `Shown in ${DRAWS} draws`], layoutRows),
    '',
    `Greedy layout (bestLayout, what tailorPage puts in the next page's Layout line): before: ${best(before)}; after: ${best(after)}.`,
    `One seeded Thompson draw (sampleLayout, the exploring alternative): before: ${draw(before)}; after: ${draw(after)}.`,
    '',
    ...nextPage,
    '',
    'Stage line: "Your chats are the prior, your clicks are the evidence." Chat seeds are weak (alpha = 1 + confidence), so two clicks outweigh them.',
    ...(notes.length ? ['', '## Notes', '', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')
  return {
    json: {
      profile: who,
      synthetic,
      interactions: steps,
      changed: changed.map((f) => ({ id: f.id, value: f.value, source: f.source, confidence: f.confidence, prior: f.prior })),
      layoutSharesBefore: sharesBefore,
      layoutSharesAfter: sharesAfter,
      bestBefore: bestLayout(before),
      bestAfter: bestLayout(after),
      relevance,
      notes,
    },
    md,
  }
}
