/**
 * Fidelity gate (CONTEXT.txt §3.6). CODE ONLY, no model. Owner: Mikhail.
 *
 * Pull every number, price, spec, model name and quoted claim out of the blocks and check each one appears
 * in the original VISIBLE page (even when content came from the agent/markdown version). Strip and count what doesn't.
 * Facts from the user's profile (e.g. their budget) are labeled as the user's and are allowed.
 * `cta.href` must exist on the original page. `from_site` text is left as is (it is labeled as the site's).
 */
import type { Block, GateResult, PageLink } from '@/types'
import { todo } from '@/todo'

export interface GateInput {
  blocks: Block[]
  /** Text of the visible page (PageContent.visibleText). */
  visibleText: string
  links: PageLink[]
  /** Values of the facts used for this page; claims that match these are the user's, not the page's. */
  userFactValues: string[]
}

export interface Claim {
  kind: 'number' | 'price' | 'spec' | 'model_name' | 'quote' | 'link'
  text: string
}

export interface GateOutput {
  blocks: Block[]
  gate: GateResult
}

/** Whitespace/case/unicode-dash/thousands-separator normalization used on both sides of every check. */
export function normalizeForMatch(text: string): string {
  void text
  return todo('gate.normalizeForMatch')
}

/** Numbers (120 Hz, 4K, 65"), prices ($1,299), specs (HDMI 2.1), model names (QN90D), quoted claims ("..."). */
export function extractClaims(block: Block): Claim[] {
  void block
  return todo('gate.extractClaims')
}

export function claimOnPage(claim: Claim, normalizedVisibleText: string, links: PageLink[]): boolean {
  void claim
  void normalizedVisibleText
  void links
  return todo('gate.claimOnPage')
}

/** Strips unsupported claims (or whole rows/blocks when a claim cannot be removed cleanly) and counts everything. */
export function runFidelityGate(input: GateInput): GateOutput {
  void input
  return todo('gate.runFidelityGate')
}
