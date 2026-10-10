/**
 * Fidelity gate for in-place edits (CONTEXT.txt §3.6, §3.7). CODE ONLY, no model. Same rules as the block gate:
 * every number, price, spec, model name and quoted claim in an edit must appear on the VISIBLE page; what does not
 * is stripped (sentence by sentence) and counted. Only notes and warnings are labeled as the user's, so only there
 * may a claim pass because it matches one of the user's facts. Rewrites replace the site's own words, so every claim
 * in them must be the page's.
 *
 * Also code-decided here: unknown segment ids (the model proposes, code checks), rewrites that change nothing,
 * rewrites that balloon past the original, and hides of nothing.
 */
import type { BlockType, GateResult, PageEdit, PageSegment, StrippedClaim } from '@/types'
import { PageEditSchema } from '@/schemas'
import { claimKey, findClaims, type Claim } from './claims'
import { claimOnPage, matchesUserFact, stripSentences } from './index'
import { normalizeForMatch } from './normalize'

export interface EditGateInput {
  edits: PageEdit[]
  segments: PageSegment[]
  /** Text of the visible page (PageContent.visibleText). */
  visibleText: string
  /** Fact values and evidence quotes used for this page (tailor.userFactValues). */
  userFactValues: string[]
}

export interface EditGateOutput {
  edits: PageEdit[]
  gate: GateResult
}

/** A rewrite may be longer than the original (simple reading level explains jargon), but never a new essay. */
export const MAX_REWRITE_GROWTH = 2
export const MAX_REWRITE_EXTRA_CHARS = 120

/** How each edit op is reported in GateResult / Interaction (the frozen types speak in block types). */
export const EDIT_BLOCK_TYPE: Record<PageEdit['op'], BlockType> = {
  rewrite: 'section',
  hide: 'hidden',
  note: 'for_you',
  warn: 'warning',
}

/** Edits whose text is labeled as the user's (they carry factIds and render with a "why" chip). */
const USER_FACT_OPS: ReadonlySet<PageEdit['op']> = new Set<PageEdit['op']>(['note', 'warn'])

function textsOf(edit: PageEdit): string[] {
  switch (edit.op) {
    case 'rewrite':
    case 'note':
    case 'warn':
      return [edit.text]
    case 'hide':
      return [edit.label, edit.reason]
  }
}

function claimsOf(edit: PageEdit): Claim[] {
  const seen = new Set<string>()
  const out: Claim[] = []
  for (const s of textsOf(edit)) {
    for (const c of findClaims(s)) {
      const key = claimKey(c)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind: c.kind, text: c.text })
    }
  }
  return out
}

/** Rebuilds an edit without its bad claims, or null to drop it. Never mutates `edit`. */
function stripEdit(edit: PageEdit, bad: Set<string>): PageEdit | null {
  switch (edit.op) {
    case 'rewrite':
    case 'note':
    case 'warn': {
      const text = stripSentences(edit.text, bad)
      return text === null ? null : { ...edit, text }
    }
    case 'hide': {
      const label = stripSentences(edit.label, bad)
      const reason = stripSentences(edit.reason, bad)
      return label === null || reason === null ? null : { ...edit, label, reason }
    }
  }
}

const opOf = (raw: unknown): PageEdit['op'] => {
  const op = (raw as { op?: unknown } | null)?.op
  return op === 'hide' || op === 'note' || op === 'warn' ? op : 'rewrite'
}

export function runEditGate(input: EditGateInput): EditGateOutput {
  const page = normalizeForMatch(input.visibleText)
  const facts = input.userFactValues.map(normalizeForMatch).filter((f) => f.length > 0)
  const byId = new Map(input.segments.map((s) => [s.id, s]))
  const edits: PageEdit[] = []
  const stripped: StrippedClaim[] = []
  let checked = 0

  const invalid = (blockIndex: number, raw: unknown, what: string): void => {
    stripped.push({ blockIndex, blockType: EDIT_BLOCK_TYPE[opOf(raw)], claim: what, reason: 'invalid_block' })
  }

  input.edits.forEach((raw, blockIndex) => {
    const parsed = PageEditSchema.safeParse(raw)
    if (!parsed.success) return invalid(blockIndex, raw, `invalid edit (${String((raw as { op?: unknown } | null)?.op)})`)
    let edit = parsed.data

    // Structure checks first (code decides which elements exist).
    if (edit.op === 'rewrite') {
      const seg = byId.get(edit.id)
      if (!seg) return invalid(blockIndex, edit, `unknown segment ${edit.id}`)
      const text = edit.text.replace(/\s+/g, ' ').trim()
      if (!text || text === seg.text) return // a no-op is not an edit; nothing to count
      if (text.length > seg.text.length * MAX_REWRITE_GROWTH + MAX_REWRITE_EXTRA_CHARS) {
        return invalid(blockIndex, edit, `rewrite of ${edit.id} is ${text.length} chars for a ${seg.text.length}-char element`)
      }
      edit = { ...edit, text }
    } else if (edit.op === 'hide') {
      const ids = [...new Set(edit.ids.filter((id) => byId.has(id)))]
      if (ids.length === 0) return invalid(blockIndex, edit, 'hide with no known segment')
      edit = { ...edit, ids }
    } else if (!byId.has(edit.after)) {
      // A note is the most valuable thing we show; a mistyped anchor should not lose it. Code moves it to the top.
      const first = input.segments[0]
      if (!first) return invalid(blockIndex, edit, `unknown anchor ${edit.after}`)
      edit = { ...edit, after: first.id }
    }

    const claims = claimsOf(edit)
    checked += claims.length
    const bad = new Set<string>()
    for (const claim of claims) {
      if (USER_FACT_OPS.has(edit.op) && matchesUserFact(claim, facts)) continue
      if (claimOnPage(claim, page, [])) continue
      bad.add(claimKey(claim))
      stripped.push({ blockIndex, blockType: EDIT_BLOCK_TYPE[edit.op], claim: claim.text, reason: 'not_on_page' })
    }
    const kept = bad.size === 0 ? edit : stripEdit(edit, bad)
    if (kept) edits.push(kept)
  })

  return { edits, gate: { checked, stripped } }
}
