/**
 * Tailor data formats.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ FROZEN 12:45 pm PT, Sat Oct 10 2026 (CONTEXT.txt §6).                 │
 * │ Change the FROZEN section only with the whole team's OK, in its own   │
 * │ commit. The INTERNAL section below it may evolve freely.              │
 * └──────────────────────────────────────────────────────────────────────┘
 */

// ───────────────────────────── FROZEN (§6) ─────────────────────────────

export type FactCategory =
  | 'reading'
  | 'visual'
  | 'language'
  | 'expertise'
  | 'interest'
  | 'constraint'
  | 'owns'
  | 'dislikes'
  | 'goal'
  | 'question'

export const FACT_CATEGORIES: readonly FactCategory[] = [
  'reading',
  'visual',
  'language',
  'expertise',
  'interest',
  'constraint',
  'owns',
  'dislikes',
  'goal',
  'question',
]

/** Where a fact came from. `chatgpt` / `claude` for chat facts; a page URL for behavior facts. */
export type EvidenceOrigin = 'chatgpt' | 'claude' | (string & {})

export interface Evidence {
  origin: EvidenceOrigin
  /** Conversation title, or page title for behavior facts. */
  title: string
  /** ISO 8601 date of the message or interaction. */
  date: string
  /** Short verbatim quote. Keep it short: this is what the "why" chip shows on stage. */
  quote: string
}

export interface Fact {
  id: string
  category: FactCategory
  /** e.g. "prefers bullet points over prose" */
  value: string
  /** 0..1 */
  confidence: number
  source: 'chat' | 'behavior'
  evidence: Evidence[]
  userStatus?: 'kept' | 'deleted' | 'edited'
  /** Weak chat prior; interactions update it. "Your chats are the prior, your clicks are the evidence." */
  prior?: { alpha: number; beta: number }
}

export interface ProfileStats {
  conversations: number
  messages: number
  /** ISO date of the oldest message used. */
  from: string
  /** ISO date of the newest message used. */
  to: string
}

export interface Profile {
  version: number
  facts: Fact[]
  shares: SiteShare[]
  stats: ProfileStats
}

export interface KeyFactRow {
  label: string
  value: string
}

/** The fixed component list. The rewrite model may return ONLY these. Never free-form HTML. */
export type Block =
  | { type: 'summary'; text: string }
  | { type: 'for_you'; text: string; factIds: string[] }
  | { type: 'key_facts'; rows: KeyFactRow[] }
  | { type: 'compare'; columns: string[]; rows: string[][] }
  | { type: 'steps'; items: string[] }
  | { type: 'warning'; text: string; factIds: string[] }
  | { type: 'section'; heading: string; text: string }
  | { type: 'hidden'; label: string; reason: string }
  /** href must exist on the original page (the gate enforces this). */
  | { type: 'cta'; label: string; href: string }
  /** Verbatim site reply, labeled as the site's. Never passed to a model as instructions. */
  | { type: 'from_site'; text: string; siteUrl: string }

export type BlockType = Block['type']

export const BLOCK_TYPES: readonly BlockType[] = [
  'summary',
  'for_you',
  'key_facts',
  'compare',
  'steps',
  'warning',
  'section',
  'hidden',
  'cta',
  'from_site',
]

export interface StrippedClaim {
  /** Index into TailoredPage.blocks before stripping. */
  blockIndex: number
  blockType: BlockType
  /** The exact claim text that was removed. Shown in the gate log on stage. */
  claim: string
  reason: 'not_on_page' | 'link_not_on_page' | 'invalid_block'
}

export interface GateResult {
  /** How many claims (numbers, prices, specs, model names, quotes, links) the gate checked. */
  checked: number
  stripped: StrippedClaim[]
}

export interface TailoredPage {
  url: string
  profileVersion: number
  blocks: Block[]
  gate: GateResult
  /**
   * ADDED 2:05 pm PT Oct 10 (additive, optional): in-place edits to the page's own elements (see PageEdit below).
   * When present, the renderer applies these to the site's DOM; `blocks` is then a derived projection of the same
   * edits (notes → for_you, warnings → warning, hides → hidden, rewrites → section) for share, learn and the eval.
   */
  edits?: PageEdit[]
}

/** The receipt shown in the profile after sharing with a site. */
export interface SiteShare {
  url: string
  needsText: string
  factIds: string[]
  /** The site's reply, verbatim. Untrusted text. */
  response: string
  /** ISO timestamp. */
  at: string
}

export type InteractionKind = 'expand' | 'collapse' | 'toggle_original' | 'open_why' | 'ignore' | 'dwell'

export interface Interaction {
  url: string
  profileVersion: number
  kind: InteractionKind
  blockType: BlockType
  factIds?: string[]
  /** Dwell time in milliseconds (kind === 'dwell'). */
  ms?: number
  /** ISO timestamp. */
  at: string
}

// ───────────────────────────── INTERNAL ────────────────────────────────
// Types below are implementation details and may change. Keep them small.

export type ChatOrigin = 'chatgpt' | 'claude'

/** One of the user's own messages, after import. Assistant messages are never stored. */
export interface OwnMessage {
  id: string
  conversationId: string
  origin: ChatOrigin
  /** Conversation title. */
  title: string
  /** ISO 8601. */
  date: string
  text: string
}

export interface ImportedConversation {
  id: string
  origin: ChatOrigin
  title: string
  createdAt: string
  updatedAt: string
  messages: OwnMessage[]
}

export interface ImportOptions {
  /** Keep only messages from the last N months. Default 12. (§3.1) */
  months?: number
  /** Rough token cap across all kept messages. Default 400k. (§3.1) */
  tokenCap?: number
}

/** A link visible on the original page. The gate only allows hrefs from this list. */
export interface PageLink {
  text: string
  href: string
}

/** Agent hooks read from a coframe.com page (§4). Read per page; never hardcode. */
export interface CoframeAgentHooks {
  /** URL of the markdown "agent version" of the page, if offered. */
  markdownUrl?: string
  /** Link template with a needs= parameter, if offered. */
  needsLinkTemplate?: string
  /** HTTP POST endpoint, e.g. https://www.coframe.com/_cf/agent-request */
  postEndpoint?: string
  /** Exact JSON field names and any page/token parameters, exactly as the page states them. */
  fields?: Record<string, string>
  /** needs ≤ 2000 chars, constraints ≤ 1000 chars (verified Oct 10). */
  limits?: { needs: number; constraints: number }
  /** Whether the page registered a WebMCP tool (share_visitor_needs). Bonus path only. */
  webMcpTool?: string
  /** The raw text of the agent section, kept for the consent sheet and for debugging. */
  rawSection?: string
}

/**
 * One editable text element on the live page: a heading, paragraph, list item or text leaf (src/tailor/segments.ts).
 * Ids are `s1`, `s2`, ... in document order. The content script keeps the id → Element map; only this goes to the model.
 */
export interface PageSegment {
  id: string
  /** Lowercase tag name: h1, p, li, div, ... */
  tag: string
  /** Visible text of the element, whitespace collapsed. Untrusted website text. */
  text: string
}

/**
 * An edit to the live page, keyed to PageSegment ids (s#) and, where the page has a map (PageRegion), region ids (r#)
 * and item ids (i#). The model proposes these (EditOutputSchema), code checks them (tailor.checkEdits, then
 * gate.runEditGate) and the renderer applies them to the site's own DOM (§3.7, in place).
 * - rewrite: replace the element's text (same element, same site styles). Page facts only; optional factIds say why.
 * - hide: collapse a group of elements (or whole regions / items) into a one-line stub where they stood.
 * - note / warn: a personal note inserted right after the anchor (element, region or item), citing the facts it relies on.
 * - promote: move a region to the top of the content, or an item to the front of its list, with a "moved up for you" strip.
 * - badge: a short tag on an item or element saying why it fits this person.
 */
export type PageEdit =
  | { op: 'rewrite'; id: string; text: string; factIds?: string[] }
  | { op: 'hide'; ids: string[]; label: string; reason: string }
  | { op: 'note'; after: string; text: string; factIds: string[] }
  | { op: 'warn'; after: string; text: string; factIds: string[] }
  /** Move a region (r#) to the top of the page content, or an item (i#) to the front of its list. The reason cites facts. */
  | { op: 'promote'; id: string; reason: string; factIds: string[] }
  /** A short tag on an item (i#) or element (s#) saying why it fits this person, e.g. "100W: enough for your MacBook Pro". */
  | { op: 'badge'; id: string; label: string; factIds: string[] }

export type PageEditOp = PageEdit['op']

/** What kind of site a profile describes; the prompt and the policy (src/sites) key off it. */
export type SiteKind = 'storefront' | 'docs' | 'article' | 'marketing' | 'generic'

/**
 * Roles a top-level region of a page can play. Code assigns them from the site profile (selectors and heading
 * patterns, src/sites); the model only reads them. 'section' is the fallback.
 */
export type RegionRole =
  | 'hero'
  | 'promo'
  | 'stats'
  | 'categories'
  | 'collection'
  | 'products'
  | 'reviews'
  | 'membership'
  | 'article'
  | 'section'

/** One card inside a region: a product, a category tile, a collection tile. Ids are `i1`, `i2`, ... in document order. */
export interface PageItem {
  id: string
  /** The card's title, as shown. Untrusted website text. */
  title: string
  /** The price as written on the card (e.g. "$29.99"), when the card shows one. */
  price?: string
  /** The crossed-out price, when the card shows one. */
  wasPrice?: string
  /** One line of the card's own description. */
  detail?: string
  /** Absolute URL the card links to. */
  href?: string
  /** Segments that live inside this card. */
  segmentIds: string[]
}

/** One top-level region of the page. Ids are `r1`, `r2`, ... in document order. */
export interface PageRegion {
  id: string
  role: RegionRole
  /** The region's heading, or its first text when it has none. Untrusted website text. */
  title: string
  /** Segments inside this region, in order (items' segments included). */
  segmentIds: string[]
  items?: PageItem[]
}

/** What the content script extracts from a page and sends to the background. */
export interface PageContent {
  url: string
  title: string
  /** Main content as plain text (Readability, or the site's agent/markdown version when offered). */
  text: string
  /** The VISIBLE page's text. The gate checks against this even when `text` came from the agent version. */
  visibleText: string
  /** Embedded JSON-LD objects, parsed. */
  jsonLd: unknown[]
  links: PageLink[]
  source: 'readability' | 'agent-markdown' | 'raw'
  /** Editable text elements of the live page, in document order (src/tailor/segments.ts). Empty when none were found. */
  segments: PageSegment[]
  /** Which site profile described this page (src/sites). Absent when only the generic profile applied. */
  site?: { host: string; name: string; kind: SiteKind }
  /** The page map: top-level regions with their role, title and items (src/sites/regions.ts). Absent when none were found. */
  regions?: PageRegion[]
  /** Present only on pages that offer agent hooks (coframe.com). */
  agentHooks?: CoframeAgentHooks
  /** Language detected on the page (BCP 47), used to hold language constant in evals. */
  lang?: string
}

/** Per-profile source split for the profile viewer and the demo hook (§3.4, §9). */
export interface SourceSplit {
  chatgptOnly: Fact[]
  claudeOnly: Fact[]
  both: Fact[]
}
