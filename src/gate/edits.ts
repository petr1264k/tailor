/**
 * Fidelity gate for in-place edits (CONTEXT.txt §3.6, §3.7). CODE ONLY, no model. Same rules as the block gate:
 * every number, price, spec, model name and quoted claim in an edit must appear on the VISIBLE page; what does not
 * is stripped (sentence by sentence) and counted. Only edits labeled as the user's (note, warn, promote, badge: they
 * carry factIds and render with a "why" chip) may pass a claim because it matches one of the user's facts. Rewrites
 * replace the site's own words, so every claim in them must be the page's.
 *
 * Also code-decided here: unknown segment / region / item ids (the model proposes, code checks), rewrites that change
 * nothing, rewrites that balloon past the original, hides of nothing, hides of regions the site policy protects
 * (the product shelf, the hero), promotes of nothing, badges on regions.
 */
import type { BlockType, GateResult, PageEdit, PageRegion, PageSegment, RegionRole, StrippedClaim } from '@/types'
import { PageEditSchema } from '@/schemas'
import { claimKey, findClaims, type Claim } from './claims'
import { claimOnPage, matchesUserFact, stripSentences } from './index'
import { normalizeForMatch } from './normalize'

export interface EditGateInput {
  edits: PageEdit[]
  segments: PageSegment[]
  /** The page map (PageContent.regions), when the page has one. Region ids r# and item ids i# resolve through it. */
  regions?: PageRegion[]
  /** Region roles that may never be hidden as a whole (SiteProfile.policy.neverHide). */
  neverHide?: RegionRole[]
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
/** A badge is a tag, not a paragraph. */
export const MAX_BADGE_CHARS = 90
/** A note is one line stuck on a card. Longer ones keep their first sentence; a long first sentence is cut at a word. */
export const MAX_NOTE_CHARS = 120

/** Code decides how long a note gets to be: the model is asked for one line, this makes sure of it. */
export function shortNote(text: string, max = MAX_NOTE_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const first = t.split(/(?<=[.!?])\s+/)[0] ?? t
  if (first.length <= max) return first
  const cut = first.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`
}

/** How each edit op is reported in GateResult / Interaction (the frozen types speak in block types). */
export const EDIT_BLOCK_TYPE: Record<PageEdit['op'], BlockType> = {
  rewrite: 'section',
  hide: 'hidden',
  note: 'for_you',
  warn: 'warning',
  promote: 'for_you',
  badge: 'for_you',
}

/** Edits whose text is labeled as the user's (they carry factIds and render with a "why" chip). */
const USER_FACT_OPS: ReadonlySet<PageEdit['op']> = new Set<PageEdit['op']>(['note', 'warn', 'promote', 'badge'])

function textsOf(edit: PageEdit): string[] {
  switch (edit.op) {
    case 'rewrite':
    case 'note':
    case 'warn':
      return [edit.text]
    case 'hide':
      return [edit.label, edit.reason]
    case 'promote':
      return [edit.reason]
    case 'badge':
      return [edit.label]
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
    case 'promote': {
      const reason = stripSentences(edit.reason, bad)
      return reason === null ? null : { ...edit, reason }
    }
    case 'badge': {
      const label = stripSentences(edit.label, bad)
      return label === null ? null : { ...edit, label }
    }
  }
}

const OPS: ReadonlySet<string> = new Set(['rewrite', 'hide', 'note', 'warn', 'promote', 'badge'])

const opOf = (raw: unknown): PageEdit['op'] => {
  const op = (raw as { op?: unknown } | null)?.op
  return typeof op === 'string' && OPS.has(op) ? (op as PageEdit['op']) : 'rewrite'
}

export function runEditGate(input: EditGateInput): EditGateOutput {
  const page = normalizeForMatch(input.visibleText)
  const facts = input.userFactValues.map(normalizeForMatch).filter((f) => f.length > 0)
  const byId = new Map(input.segments.map((s) => [s.id, s]))
  const regions = input.regions ?? []
  const regionById = new Map(regions.map((r) => [r.id, r]))
  const itemIds = new Set(regions.flatMap((r) => (r.items ?? []).map((i) => i.id)))
  const protectedRoles = new Set<RegionRole>(input.neverHide ?? [])
  const knownAnchor = (id: string): boolean => byId.has(id) || regionById.has(id) || itemIds.has(id)
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
    switch (edit.op) {
      case 'rewrite': {
        const seg = byId.get(edit.id)
        if (!seg) return invalid(blockIndex, edit, `unknown segment ${edit.id}`)
        const text = edit.text.replace(/\s+/g, ' ').trim()
        if (!text || text === seg.text) return // a no-op is not an edit; nothing to count
        if (text.length > seg.text.length * MAX_REWRITE_GROWTH + MAX_REWRITE_EXTRA_CHARS) {
          return invalid(blockIndex, edit, `rewrite of ${edit.id} is ${text.length} chars for a ${seg.text.length}-char element`)
        }
        edit = { ...edit, text }
        break
      }
      case 'hide': {
        const ids = [...new Set(edit.ids.filter(knownAnchor))]
        const kept = ids.filter((id) => {
          const role = regionById.get(id)?.role
          return !(role && protectedRoles.has(role))
        })
        if (kept.length < ids.length) {
          invalid(blockIndex, edit, `hide of a protected region (${ids.filter((id) => !kept.includes(id)).join(', ')})`)
        }
        if (kept.length === 0) return ids.length === 0 ? invalid(blockIndex, edit, 'hide with no known segment') : undefined
        edit = { ...edit, ids: kept }
        break
      }
      case 'note':
      case 'warn': {
        if (!knownAnchor(edit.after)) {
          // A note is the most valuable thing we show; a mistyped anchor should not lose it. Code moves it to the top.
          const first = input.segments[0]
          if (!first) return invalid(blockIndex, edit, `unknown anchor ${edit.after}`)
          edit = { ...edit, after: first.id }
        }
        const text = shortNote(edit.text)
        if (!text) return invalid(blockIndex, edit, `empty ${edit.op} on ${edit.after}`)
        edit = { ...edit, text }
        break
      }
      case 'promote': {
        if (!regionById.has(edit.id) && !itemIds.has(edit.id)) return invalid(blockIndex, edit, `promote of unknown ${edit.id}`)
        break
      }
      case 'badge': {
        if (!byId.has(edit.id) && !itemIds.has(edit.id)) return invalid(blockIndex, edit, `badge on unknown ${edit.id}`)
        const label = edit.label.replace(/\s+/g, ' ').trim()
        if (!label) return invalid(blockIndex, edit, `empty badge on ${edit.id}`)
        edit = { ...edit, label: label.slice(0, MAX_BADGE_CHARS) }
        break
      }
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
