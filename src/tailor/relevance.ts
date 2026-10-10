/**
 * Relevance selection (CONTEXT.txt §3.5): only the facts relevant to THIS page go to the model.
 * Pure code, no model: token overlap between each fact (value + evidence quotes) and the page (title + text),
 * plus a small category bonus. Output-style facts (reading/visual/language) always get a baseline.
 */
import type { Fact, FactCategory, PageContent, Profile } from '@/types'
import { activeFacts } from '@/profile'
import { layoutChoiceOf } from '@/learn'
import { siteProfileFor } from '@/sites'

const STOPWORDS = new Set(
  (
    'the and for with that this you your yours are was were have has had not but from they them their there ' +
    'what which who whom will would should could can just get got how all any about into out more most some ' +
    'than then these those here also very like want need does did doing done been being one only other such ' +
    'when where why use using used make made much many may might must over under each both few own same too ' +
    'now new best good really thing things know let lets its don dont yes yeah okay please ' +
    'thanks thank our ours his her hers she him himself herself itself something anything everything ' +
    // A few Russian function words: the demo users chat partly in Russian.
    'что как это для или мне так уже все всё его она они там тут вот если есть был была было быть ' +
    'чтобы когда где почему какой какая какие только тоже ещё еще надо нужно можно'
  ).split(/\s+/),
)

/** Categories whose relevance comes from matching the page. */
const SITUATIONAL_BONUS: Partial<Record<FactCategory, number>> = { constraint: 0.5, owns: 0.5, goal: 0.5, question: 0.5 }
/** Output-style facts apply to every page, so they get a baseline even with zero overlap. */
const STYLE_BASELINE: Partial<Record<FactCategory, number>> = { reading: 1.5, visual: 1.5, language: 1.5 }

/** Quote tokens are chattier than the fact value, so they count less. */
const QUOTE_WEIGHT = 0.5

/** lowercase, letters/digits only, stopwords dropped, tokens ≥ 3 chars, light plural folding ("ports" → "port"). */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue
    out.push(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
  }
  return out
}

export function pageTokens(content: Pick<PageContent, 'title' | 'text'>): Set<string> {
  return new Set(tokenize(`${content.title}\n${content.text}`))
}

/**
 * The site's vocabulary (SiteProfile.vocabulary): when the page has any word of a synonym group, every word of the
 * group counts as present, so "owns a MacBook Pro" matches a page that says "laptop" and "100W". Code only.
 * Also folds the page map's item titles, prices and details into the token set (they are the page, too).
 */
export function expandPageTokens(page: Set<string>, content: Pick<PageContent, 'url' | 'regions'>, groups?: string[][]): Set<string> {
  const out = new Set(page)
  for (const r of content.regions ?? []) {
    for (const t of tokenize(r.title)) out.add(t)
    for (const i of r.items ?? []) for (const t of tokenize(`${i.title} ${i.price ?? ''} ${i.detail ?? ''}`)) out.add(t)
  }
  const vocabulary = groups ?? siteProfileFor(content.url).vocabulary
  for (const group of vocabulary) {
    const tokens = group.flatMap((w) => tokenize(w))
    if (tokens.some((t) => out.has(t))) for (const t of tokens) out.add(t)
  }
  return out
}

/** Score of one fact against the page's token set. Exported for tests and for tuning in the eval harness. */
export function scoreFact(fact: Fact, page: Set<string>): number {
  const valueTokens = new Set(tokenize(fact.value))
  const quoteTokens = new Set(tokenize(fact.evidence.map((e) => e.quote).join(' ')))
  let overlap = 0
  for (const t of valueTokens) if (page.has(t)) overlap += 1
  for (const t of quoteTokens) if (!valueTokens.has(t) && page.has(t)) overlap += QUOTE_WEIGHT

  const baseline = STYLE_BASELINE[fact.category]
  if (baseline !== undefined) return baseline + overlap
  if (overlap === 0) return 0 // not about this page: never sent to the model
  return overlap + (SITUATIONAL_BONUS[fact.category] ?? 0)
}

/** Only the facts relevant to THIS page go to the model. Code-first (keyword overlap with page text), then an optional model pass (RelevantFactIdsSchema). */
export async function selectRelevantFacts(profile: Profile, content: PageContent, max = 8): Promise<Fact[]> {
  const page = expandPageTokens(pageTokens(content), content)
  const ranked = activeFacts(profile)
    // Learned layout facts ('layout:specs_first') reach the rewrite as the Layout line (learn.bestLayout), not as facts.
    .filter((fact) => layoutChoiceOf(fact) === null)
    .map((fact) => ({ fact, score: scoreFact(fact, page) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.fact.confidence - a.fact.confidence)
  // TODO(tailor): optional model pass. Send the top ~20 candidates (id | category | value) plus the page title
  // to completeJson({ role: 'rewrite', schema: RelevantFactIdsSchema }) and keep only ids that exist in the
  // candidate list (code decides). Measure whether it beats this baseline in the eval before turning it on.
  return ranked.slice(0, Math.max(0, max)).map((r) => r.fact)
}
