/**
 * Block renderers (CONTEXT.txt §3.7, §6): one function per Block type, plus the pure helpers.
 *
 * Safety rule for this whole directory: text reaches the DOM ONLY through textContent / createTextNode.
 * NEVER innerHTML, outerHTML or insertAdjacentHTML. Model output and site replies are untrusted text (§0, §4 step 5).
 *
 * The pure helpers (blockToPlainText, evidenceLine, splitSiteClaims, displayHost, ...) touch no DOM at call or
 * import time, so the Node eval harness (§8) can import them.
 */
import type { Block, BlockType, Evidence, Fact } from '@/types'
import type { InteractionEvent } from './index'

/** Sections with text this long or longer start collapsed (§3.7, §9 "marketing collapsed"). */
export const COLLAPSE_AT = 600
/**
 * Specs / compare tables with more rows than this start collapsed to their first rows. Expanding one reports
 * expand key_facts / compare, which learn counts toward "specs first" (§9 1:25 "expand the collapsed specs twice").
 */
export const TABLE_ROWS_SHOWN = 5

// ───────────────────────────── pure helpers ─────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "https://www.coframe.com/x" → "coframe.com". Falls back to the input when it is not a URL. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** ISO date → "Aug 3". Date-only strings are read as written (no time-zone shift); timestamps use local time (Pacific on stage). */
export function formatShortDate(iso: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const month = MONTHS[Number(dateOnly[2]) - 1]
    return month ? `${month} ${Number(dateOnly[3])}` : ''
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** chatgpt → ChatGPT, claude → Claude, a page URL (behavior facts) → its hostname. */
export function evidenceSource(origin: string): string {
  if (origin === 'chatgpt') return 'ChatGPT'
  if (origin === 'claude') return 'Claude'
  return displayHost(origin)
}

/**
 * "ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'" (§3.4).
 * Computed locally on purpose: profile.formatEvidence may still throw TODO, and the content script must not depend on it.
 */
export function evidenceLine(e: Evidence): string {
  const date = formatShortDate(e.date)
  return `${evidenceSource(e.origin)}${date ? `, ${date}` : ''}: '${e.quote}'`
}

/** The fact ids a block cites ([] for block types without factIds). */
export function blockFactIds(block: Block): string[] {
  return 'factIds' in block ? block.factIds : []
}

/**
 * The words a reader sees in a block, without UI chrome (kickers, chips, buttons). Pure.
 * Used by the eval (§8) for first-screen checks and words-before-vs-after counts.
 * Collapsed sections return their full text; the eval decides what counts as visible.
 */
export function blockToPlainText(block: Block): string {
  switch (block.type) {
    case 'summary':
    case 'for_you':
    case 'warning':
      return block.text
    case 'key_facts':
      return block.rows.map((r) => `${r.label}: ${r.value}`).join('\n')
    case 'compare':
      return [block.columns, ...block.rows]
        .filter((r) => r.length > 0)
        .map((r) => r.join(' | '))
        .join('\n')
    case 'steps':
      return block.items.map((s, i) => `${i + 1}. ${s}`).join('\n')
    case 'section':
      return `${block.heading}\n${block.text}`
    case 'hidden':
      return `Hidden: ${block.label} — ${block.reason}`
    case 'cta':
      return block.label
    case 'from_site':
      return block.text
  }
}

/**
 * Numbers in a site's reply are the site's claims (§4 step 5). Matches standalone numbers with an optional currency
 * prefix and an optional unit: "$1,299", "120 Hz", "4K", "2 weeks", "99.9%", "500+". Not digits inside words ("H100").
 */
const SITE_CLAIM_RE =
  /(?<![A-Za-z\d])(?:[$€£¥]\s?)?\d+(?:[.,]\d+)*\+?(?:\s?%|\s?(?:Hz|kHz|MHz|GHz|ms|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?|months?|years?|GB|TB|MB|px|inch(?:es)?|cm|mm|km|kg|lbs?|fps|nits|USD|EUR|users?|customers?|teams?|sites?)\b|[A-Za-z]{1,3}\b)?/g

export interface TextPart {
  text: string
  claim: boolean
}

/** Splits site text into plain parts and claim parts. Pure; concatenating every part.text gives back the input. */
export function splitSiteClaims(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(SITE_CLAIM_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), claim: false })
    parts.push({ text: m[0], claim: true })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), claim: false })
  return parts
}

/** Only http(s) and mailto links are rendered as links. The gate already checked the href is on the page (§3.6). */
export function safeHref(href: string, base?: string): string | null {
  try {
    const url = new URL(href, base ?? (typeof document !== 'undefined' ? document.baseURI : undefined))
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// ───────────────────────────── DOM renderers ─────────────────────────────

export interface BlockContext {
  /** Profile facts by id, for the "why" chips. */
  facts: Map<string, Fact>
  report: (event: InteractionEvent) => void
}

/** createElement + className + textContent. The only way text enters the DOM here. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(className: string, text: string): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  return b
}

/** Expand/Collapse control. State lives in the `is-collapsed` class on the block root; CSS does the rest. */
function collapsible(root: HTMLElement, block: Block, startCollapsed: boolean, ctx: BlockContext): HTMLButtonElement {
  const toggle = button('toggle', '')
  const set = (collapsed: boolean): void => {
    root.classList.toggle('is-collapsed', collapsed)
    toggle.textContent = collapsed ? 'Expand' : 'Collapse'
    toggle.setAttribute('aria-expanded', String(!collapsed))
  }
  set(startCollapsed)
  toggle.addEventListener('click', () => {
    const collapse = !root.classList.contains('is-collapsed')
    set(collapse)
    ctx.report({ kind: collapse ? 'collapse' : 'expand', blockType: block.type, factIds: blockFactIds(block) })
  })
  return toggle
}

/** ✕ on for_you / warning: hides the note and reports 'ignore' (§3.8). */
function appendDismiss(root: HTMLElement, block: Extract<Block, { factIds: string[] }>, ctx: BlockContext): void {
  const x = button('dismiss', '✕')
  x.setAttribute('aria-label', 'Dismiss this note')
  x.addEventListener('click', () => {
    root.hidden = true
    ctx.report({ kind: 'ignore', blockType: block.type, factIds: block.factIds })
  })
  root.append(x)
}

/** One "why" chip per cited fact (§3.7). Hover previews; click pins the popover and reports 'open_why'. */
function appendWhyChips(root: HTMLElement, block: Block, ctx: BlockContext): void {
  const facts = blockFactIds(block)
    .map((id) => ctx.facts.get(id))
    // Unknown or deleted facts get no chip: never show a reason we cannot back with the user's own words.
    .filter((f): f is Fact => !!f && f.userStatus !== 'deleted')
  if (facts.length === 0) return
  const row = el('div', 'why-row')
  for (const fact of facts) {
    const wrap = el('span', 'why-wrap')
    const chip = button('why', 'why')
    chip.dataset['factId'] = fact.id
    chip.setAttribute('aria-expanded', 'false')
    chip.setAttribute('aria-label', `Why: ${fact.value}`)
    const pop = el('span', 'why-pop')
    pop.hidden = true
    const first = fact.evidence[0]
    pop.append(el('span', 'why-value', fact.value), el('span', 'why-quote', first ? evidenceLine(first) : 'No quote on file'))
    chip.addEventListener('click', () => {
      const open = pop.hidden
      pop.hidden = !open
      chip.setAttribute('aria-expanded', String(open))
      if (open) ctx.report({ kind: 'open_why', blockType: block.type, factIds: [fact.id] })
    })
    wrap.append(chip, pop)
    row.append(wrap)
  }
  root.append(row)
}

/** Site text as text nodes, with numbers wrapped as the site's claims. Never parsed as HTML. */
function appendSiteText(parent: HTMLElement, text: string): void {
  for (const part of splitSiteClaims(text)) {
    if (!part.claim) {
      parent.append(document.createTextNode(part.text))
      continue
    }
    const span = el('span', 'site-claim', part.text)
    span.title = "the site's claim"
    parent.append(span)
  }
}

type BlockOf<T extends BlockType> = Extract<Block, { type: T }>
type Renderer<T extends BlockType> = (root: HTMLElement, block: BlockOf<T>, ctx: BlockContext) => void

/** One renderer per block type. Each fills the block's root element; renderBlock adds the why chips. */
const RENDERERS: { [T in BlockType]: Renderer<T> } = {
  summary(root, b) {
    root.append(el('p', 'text', b.text))
  },
  for_you(root, b, ctx) {
    root.append(el('div', 'kicker', 'For you'), el('p', 'text', b.text))
    appendDismiss(root, b, ctx)
  },
  key_facts(root, b, ctx) {
    const tbody = el('tbody')
    for (const r of b.rows) {
      const th = el('th', undefined, r.label)
      th.scope = 'row'
      const tr = el('tr')
      tr.append(th, el('td', undefined, r.value))
      tbody.append(tr)
    }
    const table = el('table', 'kv')
    table.append(tbody)
    root.append(table)
    if (b.rows.length > TABLE_ROWS_SHOWN) root.append(collapsible(root, b, true, ctx))
  },
  compare(root, b, ctx) {
    const headRow = el('tr')
    for (const c of b.columns) {
      const th = el('th', undefined, c)
      th.scope = 'col'
      headRow.append(th)
    }
    const thead = el('thead')
    thead.append(headRow)
    const tbody = el('tbody')
    for (const r of b.rows) {
      const tr = el('tr')
      for (const cell of r) tr.append(el('td', undefined, cell))
      tbody.append(tr)
    }
    const table = el('table', 'compare')
    table.append(thead, tbody)
    const wrap = el('div', 'table-wrap')
    wrap.append(table)
    root.append(wrap)
    if (b.rows.length > TABLE_ROWS_SHOWN) root.append(collapsible(root, b, true, ctx))
  },
  steps(root, b) {
    const ol = el('ol')
    for (const item of b.items) ol.append(el('li', undefined, item))
    root.append(ol)
  },
  warning(root, b, ctx) {
    root.setAttribute('role', 'note')
    root.append(el('div', 'kicker', 'Heads up'), el('p', 'text', b.text))
    appendDismiss(root, b, ctx)
  },
  section(root, b, ctx) {
    root.append(el('h3', undefined, b.heading), el('div', 'body', b.text))
    if (b.text.length >= COLLAPSE_AT) root.append(collapsible(root, b, true, ctx))
  },
  hidden(root, b, ctx) {
    const row = el('div', 'row')
    row.append(el('span', 'text', `Hidden: ${b.label} — ${b.reason}`), collapsible(root, b, true, ctx))
    // TODO(render): the frozen hidden block carries no text, so Expand can only point back to the original page.
    // If the tailor module starts locating the hidden part in the original DOM, show it here.
    root.append(row, el('p', 'body', 'Tailor folded this part away for you. It is still on the original page: switch to Original to read it.'))
  },
  cta(root, b) {
    const href = safeHref(b.href)
    if (!href) {
      root.append(el('span', 'cta-link is-disabled', b.label))
      return
    }
    const a = el('a', 'cta-link', b.label)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener'
    root.append(a)
  },
  from_site(root, b) {
    // §4 step 5: verbatim, plain text, labeled as the site's. Links are NOT made clickable; numbers are marked as claims.
    root.dataset['untrusted'] = 'true'
    const body = el('p', 'text')
    appendSiteText(body, b.text)
    root.append(el('div', 'kicker', `From ${displayHost(b.siteUrl)} · the site's own words`), body)
  },
}

/** Block → one root element `.block.block--<type>`. Throws on a malformed block; callers skip it. */
export function renderBlock(block: Block, ctx: BlockContext): HTMLElement {
  const root = el('div', `block block--${block.type}`)
  root.dataset['blockType'] = block.type
  const render = RENDERERS[block.type] as Renderer<BlockType>
  render(root, block, ctx)
  appendWhyChips(root, block, ctx)
  return root
}
