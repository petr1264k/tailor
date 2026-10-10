/**
 * The per-page scorecard (CONTEXT.txt §8.5, storefront edition). CODE ONLY, measured on the live page, before and
 * after the edits, at the same scroll position: how far down the first thing marked for this person sits, how many
 * marked things are on the first screen, and how many words the page shows. Pure functions apart from reading layout.
 *
 * "First match" = the first element the tailored page marks for this person (a promoted region or card, a badge, a
 * note's anchor), in document order of the ORIGINAL page. Its position is where a reader would have had to scroll to.
 */
import type { TailoredPage } from '@/types'
import { isVisible } from '@/tailor/segments'

export interface ScorecardSide {
  /** Visible words on the page (innerText; hidden parts drop out). */
  words: number
  /** Document y of the first marked element, in px from the top of the page. null when nothing is marked. */
  firstMatchTop: number | null
  /** The same, in screens (viewport heights). */
  firstMatchScreens: number | null
  /** Marked elements whose top is inside the first viewport. */
  onFirstScreen: number
}

export interface Scorecard {
  before: ScorecardSide
  after: ScorecardSide
  /** Marked elements counted (the N for the first-screen numbers). */
  marked: number
  promoted: number
  hidden: number
  badges: number
  notes: number
  warnings: number
  rewrites: number
  viewportHeight: number
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu)
  return m ? m.length : 0
}

/** Visible text: innerText in Chrome; in jsdom (no layout) a clone minus hidden elements and inline display:none. */
export function visibleWords(doc: Document): number {
  const body = doc.body as HTMLElement | null
  if (!body) return 0
  const inner = body.innerText
  if (typeof inner === 'string') return countWords(inner)
  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style, noscript, template, [hidden], [style*="display:none"], [style*="display: none"]').forEach((n) => n.remove())
  return countWords(clone.textContent ?? '')
}

/** Document y of an element's top; null when it is not rendered (display:none, hidden). */
function documentTop(el: Element, scrollY: number): number | null {
  if (!isVisible(el)) return null
  const rect = el.getBoundingClientRect()
  return Math.max(0, Math.round(rect.top + scrollY))
}

/** One side of the scorecard, from the page as it is right now. */
export function measureSide(doc: Document, marked: Element[]): ScorecardSide {
  const win = doc.defaultView
  const scrollY = win?.scrollY ?? 0
  const viewport = win?.innerHeight || 900
  const tops = marked.map((e) => documentTop(e, scrollY)).filter((t): t is number => t !== null)
  const first = tops.length ? Math.min(...tops) : null
  return {
    words: visibleWords(doc),
    firstMatchTop: first,
    firstMatchScreens: first === null ? null : Math.round((first / viewport) * 10) / 10,
    onFirstScreen: tops.filter((t) => t < viewport).length,
  }
}

export function countEdits(page: TailoredPage): Pick<Scorecard, 'promoted' | 'hidden' | 'badges' | 'notes' | 'warnings' | 'rewrites'> {
  const c = { promoted: 0, hidden: 0, badges: 0, notes: 0, warnings: 0, rewrites: 0 }
  for (const e of page.edits ?? []) {
    if (e.op === 'promote') c.promoted++
    else if (e.op === 'hide') c.hidden++
    else if (e.op === 'badge') c.badges++
    else if (e.op === 'note') c.notes++
    else if (e.op === 'warn') c.warnings++
    else c.rewrites++
  }
  return c
}

export function buildScorecard(page: TailoredPage, before: ScorecardSide, after: ScorecardSide, marked: number, viewportHeight: number): Scorecard {
  return { before, after, marked, ...countEdits(page), viewportHeight }
}

const fmt = (n: number): string => n.toLocaleString('en-US')

function screensLabel(side: ScorecardSide): string {
  if (side.firstMatchScreens === null) return 'none'
  if (side.firstMatchScreens < 1) return 'first screen'
  return `${side.firstMatchScreens} screens down`
}

/** One line for the bar: "1st match 3.6 screens down → first screen · words 2,870 → 1,140". */
export function scorecardLine(card: Scorecard): string {
  const parts: string[] = []
  if (card.marked > 0) parts.push(`1st match ${screensLabel(card.before)} → ${screensLabel(card.after)}`)
  parts.push(`words ${fmt(card.before.words)} → ${fmt(card.after.words)}`)
  return parts.join(' · ')
}

/** The popover rows: label → value, all measured by code on this page. */
export function scorecardRows(card: Scorecard): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  if (card.marked > 0) {
    rows.push(['First thing marked for you', `${screensLabel(card.before)} → ${screensLabel(card.after)}${card.before.firstMatchTop !== null && card.after.firstMatchTop !== null ? ` (${fmt(card.before.firstMatchTop)} px → ${fmt(card.after.firstMatchTop)} px)` : ''}`])
    rows.push(['Marked for you on the first screen', `${card.before.onFirstScreen} → ${card.after.onFirstScreen} of ${card.marked}`])
  }
  rows.push(['Words on the page', `${fmt(card.before.words)} → ${fmt(card.after.words)}`])
  const changes: string[] = []
  if (card.promoted) changes.push(`${card.promoted} moved up`)
  if (card.badges) changes.push(`${card.badges} tagged`)
  if (card.hidden) changes.push(`${card.hidden} hidden`)
  if (card.notes) changes.push(`${card.notes} notes`)
  if (card.warnings) changes.push(`${card.warnings} warnings`)
  if (card.rewrites) changes.push(`${card.rewrites} rewritten`)
  rows.push(['Changes', changes.join(', ') || 'none'])
  return rows
}
