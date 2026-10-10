/**
 * Claim extraction for the fidelity gate (CONTEXT.txt §3.6). Code only, no model.
 *
 * A claim is a checkable token in a block: a price, a number (with or without a unit), a spec token,
 * a model name, a quoted phrase of ≥ 3 words, or a CTA link. Everything else in the text is NOT a claim
 * and is not checked (see README.md, "What it does NOT catch").
 */
import type { Block } from '@/types'
import { UNIT_CANON, byLengthDesc, escapeRe, normalizeForMatch, normalizeHref, unifyChars } from './normalize'

export interface Claim {
  kind: 'number' | 'price' | 'spec' | 'model_name' | 'quote' | 'link'
  text: string
}

/** A claim plus where it sits in the string it came from (UTF-16 offsets; for quotes, including the quote marks). */
export interface LocatedClaim extends Claim {
  start: number
  end: number
}

/** Sentinel for an inch mark in the scan copy (a `"` right after a digit, outside an open quote). */
const INCH = '″'

const W_BEFORE = String.raw`(?<![\p{L}\p{N}])`
const W_AFTER = String.raw`(?![\p{L}\p{N}])`
const NUM_LB = String.raw`${W_BEFORE}(?<!\d[.,])`
const NUM_RB = String.raw`${W_AFTER}(?![.,]\d)`
/** 1,299 / 1,299.99 / 1299 / 2.1 */
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`

const PRICE_RE = new RegExp(
  `${W_BEFORE}(?:US\\$|USD ?|EUR ?|GBP ?|\\$|€|£) ?${NUM}${NUM_RB}` +
    `|${NUM_LB}${NUM} ?(?:USD|EUR|GBP|dollars?|euros?|\\$|€|£)${W_AFTER}`,
  'giu',
)

/** Small, explicit list (§3.6). Anything not here is not a spec claim (it may still be a model name or number). */
const SPEC_TOKENS = [
  String.raw`HDMI(?: ?\d(?:\.\d)?[a-z]?)?`,
  String.raw`eARC`,
  String.raw`Wi-?Fi(?: ?\d[e]?)?`,
  String.raw`Bluetooth(?: ?\d(?:\.\d)?)?`,
  String.raw`USB(?:[- ]?C)?(?: ?\d(?:\.\d)?)?`,
  String.raw`Thunderbolt(?: ?\d)?`,
  String.raw`DisplayPort(?: ?\d(?:\.\d)?)?`,
  String.raw`QD-?OLED|OLED|Neo ?QLED|QLED|Mini-?LED|Micro-?LED`,
  String.raw`Dolby (?:Vision|Atmos)(?: IQ)?`,
  String.raw`HDR10\+|HDR10|HDR|HLG`,
  String.raw`VRR|ALLM|FreeSync(?: Premium(?: Pro)?)?|G-?Sync`,
  String.raw`NVMe|PCIe(?: ?\d(?:\.\d)?)?|(?:LP)?DDR\d[x]?|GDDR\d[x]?`,
]
const SPEC_RE = new RegExp(`${W_BEFORE}(?:${SPEC_TOKENS.join('|')})${W_AFTER}`, 'giu')

const RESOLUTION_RE = new RegExp(`${NUM_LB}\\d{3,5} ?x ?\\d{3,5}${NUM_RB}`, 'gu')

/** Units for extraction: the normalization table minus bare "in" ("1 in 5", "HDMI 2.1 in game mode") and "x" (handled glued-only). */
const MEASURE_UNITS = [...Object.keys(UNIT_CANON).filter((u) => u !== 'in' && u !== 'x'), INCH]
const MEASURE_RE = new RegExp(
  `${NUM_LB}${NUM} ?-? ?(?:${MEASURE_UNITS.sort(byLengthDesc).map(escapeRe).join('|')})${W_AFTER}` +
    `|${NUM_LB}${NUM}x${W_AFTER}` + // 2x, 1.5x
    `|${NUM_LB}\\d{1,2}k${W_AFTER}` + // 4K, 8K
    `|${NUM_LB}\\d{3,4}[pi]${W_AFTER}`, // 1080p, 2160p
  'giu',
)

/** "RTX 4070", "XPS 13": an uppercase acronym, a space, a 2–5 digit number. Case-sensitive on purpose. */
const MODEL_MULTI_RE = new RegExp(`${W_BEFORE}[A-Z]{2,5} \\d{2,5}[A-Za-z]{0,2}${W_AFTER}`, 'gu')
/** Single tokens (hyphens allowed inside), filtered by isModelToken: QN90D, S95D, PS5, XR-65A95L. */
const MODEL_TOKEN_RE = /(?<![\p{L}\p{N}-])[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*(?![\p{L}\p{N}-])/gu
/** Any remaining number; kept only with ≥ 2 digits (single digits are everywhere: "3 steps"). */
const BARE_RE = new RegExp(`${NUM_LB}\\d+(?:[.,]\\d+)*${W_AFTER}`, 'gu')

const QUOTE_RE = /"([^"\n]+)"/g

function isModelToken(t: string): boolean {
  const letters = t.match(/\p{L}/gu)?.length ?? 0
  const digits = t.match(/\p{N}/gu)?.length ?? 0
  return digits >= 1 && letters >= 2 && t.replace(/-/g, '').length >= 3 && !/^\d+(?:st|nd|rd|th|am|pm|s)$/i.test(t)
}

const hasTwoDigits = (t: string): boolean => (t.match(/\d/g)?.length ?? 0) >= 2

type Pass = [Claim['kind'], RegExp, ((t: string) => boolean)?]
/** Priority order. A later pass never takes a span an earlier pass already took (no double counting). */
const PASSES: Pass[] = [
  ['price', PRICE_RE],
  ['spec', SPEC_RE],
  ['number', RESOLUTION_RE],
  ['number', MEASURE_RE],
  ['model_name', MODEL_MULTI_RE],
  ['model_name', MODEL_TOKEN_RE, isModelToken],
  ['number', BARE_RE, hasTwoDigits],
]

/** Same length as the input: unified chars, and inch-mark `"` (digit + `"`, outside an open quote) → INCH. */
export function scanCopy(text: string): string {
  const s = unifyChars(text)
  let out = ''
  let open = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c !== '"') {
      out += c
    } else if (!open && i > 0 && /\d/.test(s[i - 1]!)) {
      out += INCH
    } else {
      open = !open
      out += c
    }
  }
  return out
}

/** Every claim in one string, with positions. Quotes may overlap token claims (both are checked). */
export function findClaims(text: string): LocatedClaim[] {
  const scan = scanCopy(text)
  const out: LocatedClaim[] = []
  for (const m of scan.matchAll(QUOTE_RE)) {
    const inner = m[1]!
    if (inner.trim().split(/\s+/).length < 3) continue
    const start = m.index
    out.push({ kind: 'quote', text: text.slice(start + 1, start + 1 + inner.length).trim(), start, end: start + m[0].length })
  }
  const taken: Array<[number, number]> = []
  for (const [kind, re, keep] of PASSES) {
    for (const m of scan.matchAll(re)) {
      const start = m.index
      const end = start + m[0].length
      if (taken.some(([a, b]) => start < b && end > a)) continue
      if (keep && !keep(m[0])) continue
      taken.push([start, end])
      out.push({ kind, text: text.slice(start, end), start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The normalized form a claim is matched with. Quotes drop leading/trailing punctuation; links use normalizeHref. */
export function matchForm(claim: Claim): string {
  if (claim.kind === 'link') return normalizeHref(claim.text) ?? ''
  const n = normalizeForMatch(claim.text)
  return claim.kind === 'quote' ? n.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') : n
}

/** Dedupe key: same kind + same normalized form = same claim ("$1,299" and "$1299" are one claim). */
export function claimKey(claim: Claim): string {
  return `${claim.kind}|${matchForm(claim) || claim.text.trim()}`
}

/** Every string the gate checks in a block. from_site → none (labeled as the site's). cta.href is a link claim, not text. */
export function checkedStrings(block: Block): string[] {
  switch (block.type) {
    case 'summary':
    case 'for_you':
    case 'warning':
      return [block.text]
    case 'section':
      return [block.heading, block.text]
    case 'hidden':
      return [block.label, block.reason]
    case 'key_facts':
      return block.rows.flatMap((r) => [r.label, r.value])
    case 'compare':
      return [...block.columns, ...block.rows.flat()]
    case 'steps':
      return block.items
    case 'cta':
      return [block.label]
    case 'from_site':
      return []
  }
}

/** All claims in a block, deduped within the block, in reading order. cta.href becomes a 'link' claim. */
export function extractClaims(block: Block): Claim[] {
  const seen = new Set<string>()
  const out: Claim[] = []
  const add = (c: Claim) => {
    const key = claimKey(c)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind: c.kind, text: c.text })
  }
  for (const s of checkedStrings(block)) for (const c of findClaims(s)) add(c)
  if (block.type === 'cta') add({ kind: 'link', text: block.href })
  return out
}
