/**
 * Profile tab view model, kept pure so it is testable. The look follows the hand-built profile artifact
 * (claude.ai/artifact/SM5TqkJDGUF9CMfSxtSTDN): facts grouped by how Tailor uses them, each quote labelled with
 * where it comes from, quotes in the owner's own words marked, and a category / search / own-words filter.
 */
import type { Evidence, Fact, FactCategory } from '@/types'
import { siteName, truncateQuote } from '@/profile'

export interface FactGroupDef {
  title: string
  note: string
  cats: FactCategory[]
}

/** Every FactCategory is in exactly one group (helpers test checks it). */
export const FACT_GROUPS: FactGroupDef[] = [
  {
    title: 'How you read',
    note: 'Tailor uses these to choose what a page leads with, what it collapses, and which language it answers in.',
    cats: ['reading', 'visual', 'dislikes', 'language'],
  },
  {
    title: 'Questions you keep asking',
    note: "Tailor's first-screen test asks whether a page answers questions like these before you scroll.",
    cats: ['question'],
  },
  { title: 'What you do', note: 'Sets the depth and vocabulary of a rewrite.', cats: ['expertise', 'goal'] },
  {
    title: 'What you own and follow',
    note: 'Gives a page something concrete to check against: your gear, your interests, your limits.',
    cats: ['owns', 'interest', 'constraint'],
  },
]

export const CATEGORY_ORDER: FactCategory[] = FACT_GROUPS.flatMap((g) => g.cats)

export type QuoteKind = 'own' | 'memory' | 'project' | 'artifact' | 'clicks'

export interface QuoteSource {
  kind: QuoteKind
  /** "✎ Your words", "Claude memory", … */
  label: string
  /** Conversation, memory or page title, shortened. */
  name: string
  /** "ChatGPT · Aug 3, 2026", "bestbuy.com · Aug 3, 2026", or just the date. */
  where: string
}

/** Evidence titles a hand-built profile uses for quotes that are not the owner's own messages. */
const NOT_OWN_PREFIXES: [string, QuoteKind, string][] = [
  ['Claude memory · ', 'memory', 'Claude memory'],
  ['Claude project · ', 'project', 'Your project instructions'],
  ['Claude artifact · ', 'artifact', 'Artifact'],
]

const TITLE_MAX = 60
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Aug 3, 2026'. Date-only strings are calendar dates (UTC); timestamps are local. Unparseable → ''. */
export function fullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

const joinDot = (...parts: string[]) => parts.filter(Boolean).join(' · ')

/** Where a quote comes from. Chat evidence is the owner's own words unless its title marks Claude's memory, a project or an artifact. */
export function quoteSource(e: Evidence): QuoteSource {
  const date = fullDate(e.date)
  if (e.origin !== 'chatgpt' && e.origin !== 'claude') {
    return { kind: 'clicks', label: 'Your clicks', name: truncateQuote(e.title, TITLE_MAX), where: joinDot(siteName(e.origin), date) }
  }
  for (const [prefix, kind, label] of NOT_OWN_PREFIXES) {
    if (e.title.startsWith(prefix)) return { kind, label, name: truncateQuote(e.title.slice(prefix.length), TITLE_MAX), where: date }
  }
  const origin = e.origin === 'chatgpt' ? 'ChatGPT' : 'Claude'
  return { kind: 'own', label: '✎ Your words', name: truncateQuote(e.title, TITLE_MAX), where: joinDot(origin, date) }
}

export function hasOwnWords(fact: Fact): boolean {
  return fact.evidence.some((e) => quoteSource(e).kind === 'own')
}

export interface FactFilter {
  category: FactCategory | 'all'
  query: string
  ownOnly: boolean
}

export const NO_FILTER: FactFilter = { category: 'all', query: '', ownOnly: false }

/** Category, own-words and a case-insensitive search over the shown label, the value, the quotes and their titles. */
export function matchesFilter(fact: Fact, filter: FactFilter, label = fact.value): boolean {
  if (filter.category !== 'all' && fact.category !== filter.category) return false
  if (filter.ownOnly && !hasOwnWords(fact)) return false
  const q = filter.query.trim().toLowerCase()
  if (!q) return true
  const haystack = [label, fact.value, ...fact.evidence.flatMap((e) => [e.quote, e.title])].join(' ').toLowerCase()
  return haystack.includes(q)
}

/** FACT_GROUPS with their facts: live before deleted, then category order within the group, then confidence. */
export function groupForView(facts: Fact[]): (FactGroupDef & { facts: Fact[] })[] {
  const deleted = (f: Fact) => (f.userStatus === 'deleted' ? 1 : 0)
  return FACT_GROUPS.map((g) => ({
    ...g,
    facts: facts
      .filter((f) => g.cats.includes(f.category))
      .sort(
        (a, b) =>
          deleted(a) - deleted(b) || g.cats.indexOf(a.category) - g.cats.indexOf(b.category) || b.confidence - a.confidence,
      ),
  }))
}

/** "Weak prior Beta(α 1.80, β 1) · your clicks update it" */
export function formatPrior(prior: { alpha: number; beta: number }): string {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2))
  return `Weak prior Beta(α ${prior.alpha.toFixed(2)}, β ${n(prior.beta)}) · your clicks update it`
}
