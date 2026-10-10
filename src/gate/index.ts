/**
 * Fidelity gate (CONTEXT.txt §3.6). CODE ONLY, no model. Owner: Mikhail. Precise rules: src/gate/README.md.
 *
 * Pull every number, price, spec, model name and quoted claim out of the blocks and check each one appears
 * in the original VISIBLE page (even when content came from the agent/markdown version). Strip and count what doesn't.
 * Facts from the user's profile (e.g. their budget) are allowed only in blocks labeled as the user's (for_you, warning).
 * `cta.href` must exist on the original page. `from_site` text is left as is (it is labeled as the site's).
 */
import type { Block, BlockType, GateResult, PageLink, StrippedClaim } from '@/types'
import { BLOCK_TYPES } from '@/types'
import { BlockSchema } from '@/schemas'
import { claimKey, extractClaims, findClaims, matchForm, scanCopy, type Claim } from './claims'
import { containsToken, normalizeForMatch, normalizeHref } from './normalize'

export type { Claim, LocatedClaim } from './claims'
export { extractClaims, findClaims } from './claims'
export { normalizeForMatch, normalizeHref } from './normalize'
export { runEditGate, EDIT_BLOCK_TYPE, MAX_REWRITE_GROWTH, MAX_REWRITE_EXTRA_CHARS } from './edits'
export type { EditGateInput, EditGateOutput } from './edits'

export interface GateInput {
  blocks: Block[]
  /** Text of the visible page (PageContent.visibleText). */
  visibleText: string
  links: PageLink[]
  /**
   * Values of the facts used for this page; claims that match these are the user's, not the page's.
   * Pass fact values AND their evidence quotes, so a for_you note quoting the user's own words is not stripped.
   */
  userFactValues: string[]
}

export interface GateOutput {
  blocks: Block[]
  gate: GateResult
}

/**
 * Blocks that are labeled as the user's (they carry factIds and render with a "why" chip). Only here may a claim
 * pass because it matches a user fact (§3.6 "labeled as the user's"). Everywhere else a claim must be on the page,
 * so the model cannot restate the user's wish ("144 Hz") as a page fact.
 */
export const USER_FACT_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['for_you', 'warning'])

const isLoose = (kind: Claim['kind']) => kind === 'spec' || kind === 'model_name'

export function claimOnPage(claim: Claim, normalizedVisibleText: string, links: PageLink[]): boolean {
  if (claim.kind === 'link') {
    const href = normalizeHref(claim.text)
    return href !== null && links.some((l) => normalizeHref(l.href) === href)
  }
  return containsToken(normalizedVisibleText, matchForm(claim), isLoose(claim.kind))
}

/** `normalizedFacts` must already be normalized. Links never pass as user facts; quotes only if inside a fact. */
export function matchesUserFact(claim: Claim, normalizedFacts: string[]): boolean {
  if (claim.kind === 'link') return false
  const needle = matchForm(claim)
  if (!needle) return false
  return normalizedFacts.some(
    (f) => containsToken(f, needle, isLoose(claim.kind)) || (claim.kind !== 'quote' && containsToken(needle, f)),
  )
}

const SENTENCE_END = /(?:[.!?…]+["')\]]*(?=\s|$)|\n)\s*/g

/** Partition of `scan` into sentences (each span keeps its trailing whitespace). Splits on . ! ? and newlines. */
function sentenceSpans(scan: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let last = 0
  for (const m of scan.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length
    if (end > last) spans.push([last, end])
    last = end
  }
  if (last < scan.length) spans.push([last, scan.length])
  return spans
}

/** Removes every sentence that overlaps a bad claim. Unchanged string if none; null if nothing meaningful is left. */
export function stripSentences(text: string, bad: Set<string>): string | null {
  const hits = findClaims(text).filter((c) => bad.has(claimKey(c)))
  if (hits.length === 0) return text
  let out = ''
  for (const [a, b] of sentenceSpans(scanCopy(text))) {
    if (!hits.some((c) => c.start < b && c.end > a)) out += text.slice(a, b)
  }
  out = out.trim()
  return /[\p{L}\p{N}]/u.test(out) ? out : null
}

/** Rebuilds a block without its bad claims, or returns null to drop it. Never mutates `block`. */
function stripBlock(block: Block, bad: Set<string>): Block | null {
  const hasBad = (s: string) => findClaims(s).some((c) => bad.has(claimKey(c)))
  switch (block.type) {
    case 'summary':
    case 'for_you':
    case 'warning': {
      const text = stripSentences(block.text, bad)
      return text === null ? null : { ...block, text }
    }
    case 'section': {
      const heading = stripSentences(block.heading, bad)
      const text = stripSentences(block.text, bad)
      return heading === null || text === null ? null : { ...block, heading, text }
    }
    case 'hidden': {
      const label = stripSentences(block.label, bad)
      const reason = stripSentences(block.reason, bad)
      return label === null || reason === null ? null : { ...block, label, reason }
    }
    case 'key_facts': {
      const rows = block.rows.filter((r) => !hasBad(r.label) && !hasBad(r.value))
      return rows.length ? { ...block, rows } : null
    }
    case 'compare': {
      // A bad column header (e.g. a competitor the page never names) means the table is not about this page.
      if (block.columns.some(hasBad)) return null
      const rows = block.rows.filter((row) => !row.some(hasBad))
      return rows.length ? { ...block, rows } : null
    }
    case 'steps': {
      const items = block.items.filter((s) => !hasBad(s))
      return items.length ? { ...block, items } : null
    }
    case 'cta':
      return null // a bad href or a bad claim in the label: the whole button goes
    case 'from_site':
      return block
  }
}

function blockTypeOf(raw: unknown): BlockType {
  const t = (raw as { type?: unknown } | null)?.type
  return BLOCK_TYPES.includes(t as BlockType) ? (t as BlockType) : 'summary'
}

/** Strips unsupported claims (or whole rows/blocks when a claim cannot be removed cleanly) and counts everything. */
export function runFidelityGate(input: GateInput): GateOutput {
  const page = normalizeForMatch(input.visibleText)
  const facts = input.userFactValues.map(normalizeForMatch).filter((f) => f.length > 0)
  const blocks: Block[] = []
  const stripped: StrippedClaim[] = []
  let checked = 0

  input.blocks.forEach((raw, blockIndex) => {
    // Re-validate (cache, other callers) and get a deep copy: the input is never mutated or aliased.
    const parsed = BlockSchema.safeParse(raw)
    if (!parsed.success) {
      const type = (raw as { type?: unknown } | null)?.type
      stripped.push({ blockIndex, blockType: blockTypeOf(raw), claim: `invalid block (${String(type)})`, reason: 'invalid_block' })
      return
    }
    const block = parsed.data
    const claims = extractClaims(block)
    checked += claims.length
    const bad = new Set<string>()
    for (const claim of claims) {
      if (USER_FACT_BLOCK_TYPES.has(block.type) && matchesUserFact(claim, facts)) continue
      if (claimOnPage(claim, page, input.links)) continue
      bad.add(claimKey(claim))
      stripped.push({
        blockIndex,
        blockType: block.type,
        claim: claim.text,
        reason: claim.kind === 'link' ? 'link_not_on_page' : 'not_on_page',
      })
    }
    const kept = bad.size === 0 ? block : stripBlock(block, bad)
    if (kept) blocks.push(kept)
  })

  return { blocks, gate: { checked, stripped } }
}
