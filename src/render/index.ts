/**
 * Render in place (CONTEXT.txt §3.7). Owner: Petr.
 *
 * Plain DOM inside a shadow root so the site's CSS never clashes. Nothing of ours stays on the page: the control bar
 * exists for the popup and the tests but is never shown (Petr, Oct 10: no always-on element); Original ↔ Tailored
 * is the popup's. Every change has a "why" chip that opens the exact quote from the user's chats. When the changes
 * have played (demo mode) nothing opens: the numbers code measured reach the popup through the status.
 * Interactions (expand, collapse, toggle_original, open_why, ignore, dwell) are reported through `onInteraction`.
 *
 * Files: styles.ts (PANEL_CSS, restyle there), blocks.ts (one renderer per Block type + pure helpers), this file
 * (the bar, the panel, Original ↔ Tailored, dwell, the consent sheet, the site's reply).
 * Text enters the DOM only via textContent. NEVER innerHTML anywhere in src/render.
 *
 * Two views:
 *  - IN PLACE (the product, §3.7): when the page has edits, inplace.ts applies them to the site's own DOM. Headings and
 *    paragraphs are rewritten where they stand, fluff folds where it stood, notes slot in next to what they are about.
 *    The site keeps its look. Original ↔ Tailored puts the original nodes back.
 *  - PANEL (fallback): pages with no editable text elements (or a cached page without edits) get the block panel:
 *    a fixed column over a dimmed backdrop, rendered from `page.blocks`.
 * In demo mode (`playTailored`) the in-place edits play one by one, top to bottom, with motion (inplace.playInPlace).
 * The gate checks the visible ORIGINAL page in both cases; extraction happens before anything is changed (§3.6).
 */
import type { Fact, Interaction, StrippedClaim, TailoredPage } from '@/types'
import type { SharePreview } from '@/messages'
import { type BlockContext, displayHost, el, evidenceLine, renderBlock } from './blocks'
import { PANEL_CSS } from './styles'
import { type Scorecard, scorecardChip, scorecardLine, scorecardRows } from './scorecard'
import {
  appendFromSiteInPlace,
  appliedLabels,
  applyInPlace,
  hasInPlace,
  hideInPlace,
  inPlaceShown,
  playInPlace,
  showInPlace,
  teardownInPlace,
  type InPlaceTarget,
  type PlayOptions,
} from './inplace'

export { PANEL_CSS, INPLACE_CSS, WHY_CSS, BADGE_CSS } from './styles'
export { appliedLabels, applyInPlace, hasInPlace, inPlaceShown, markedElements, playInPlace, whyChip } from './inplace'
export type { InPlaceTarget, PlayOptions, ResolveSegment, ResolveRegion } from './inplace'
export { MOTION } from './live'
export { buildScorecard, countEdits, countWords, measureSide, scorecardChip, scorecardLine, scorecardRows } from './scorecard'
export type { Scorecard, ScorecardSide } from './scorecard'
export {
  COLLAPSE_AT,
  blockFactIds,
  blockToPlainText,
  displayHost,
  evidenceLine,
  evidenceSource,
  formatShortDate,
  renderBlock,
  safeHref,
  splitSiteClaims,
  TABLE_ROWS_SHOWN,
} from './blocks'
export type { BlockContext, TextPart } from './blocks'

export type InteractionEvent = Omit<Interaction, 'url' | 'profileVersion' | 'at'>

export interface RenderCallbacks {
  onTailor: () => Promise<void>
  onShowOriginal: () => void
  onShowTailored: () => void
  onInteraction: (event: InteractionEvent) => void
  /** When set, the bar shows a Share button in tailored mode (§4, §9 finale). */
  onShare?: () => Promise<void>
}

export type UiMode = 'original' | 'tailored' | 'loading'

export interface TailorUi {
  host: HTMLElement
  root: ShadowRoot
  button: HTMLButtonElement
  /** The callbacks given to mountTailorButton; the panel reports interactions through them. */
  callbacks: RenderCallbacks
  setMode(mode: UiMode): void
  /** "checked N · stripped M" in the bar; with `log`, clicking it opens the list of stripped claims (§9 "Trust"). */
  setGateSummary(checked: number, stripped: number, log?: StrippedClaim[]): void
  /** Shows an error (or any short status) in the bar. Never pass message text here. */
  setStatus(text: string, isError?: boolean): void
  /** The last status, for the popup (the bar itself is never shown). `isGate` = the "checked N · stripped M" line. */
  readStatus(): { text: string; isError: boolean; isGate: boolean }
  /** The scorecard chip ("1st match 3.6 screens down → first screen · words 2,870 → 1,140"); clicking it opens the rows. null clears it. */
  setScorecard(card: Scorecard | null): void
  destroy(): void
}

/** Is there anything (panel or in-place edits) to toggle back to? */
function hasView(root: ShadowRoot): boolean {
  return panels.has(root) || hasInPlace(root)
}

/** Is a tailored view on screen right now? */
function viewShown(root: ShadowRoot): boolean {
  return inPlaceShown(root) || panels.get(root)?.overlay.hidden === false
}

const HOST_ID = 'tailor-ext-host'

// ───────────────────────────── floating bar ─────────────────────────────

/** Mounts the floating control bar once per page. */
export function mountTailorButton(callbacks: RenderCallbacks): TailorUi {
  document.getElementById(HOST_ID)?.remove()
  // A custom tag (not <div>) so generic site rules like `div { display: none }` cannot reach the host.
  const host = document.createElement('tailor-ext')
  host.id = HOST_ID
  const root = host.attachShadow({ mode: 'open' })
  const style = el('style')
  style.textContent = PANEL_CSS
  const bar = el('div', 'bar')
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Tailor')
  const button = el('button', 'primary', 'Tailor')
  button.type = 'button'
  const toggle = el('button', 'secondary view', 'Original')
  toggle.type = 'button'
  toggle.hidden = true
  const share = el('button', 'secondary', 'Share')
  share.type = 'button'
  share.hidden = true
  const status = el('button', 'status')
  status.type = 'button'
  status.setAttribute('aria-live', 'polite')
  const gatePop = el('div', 'gate-pop')
  gatePop.hidden = true
  const score = el('button', 'score')
  score.type = 'button'
  score.setAttribute('aria-label', 'What changed for you on this page')
  const scorePop = el('div', 'score-pop')
  scorePop.hidden = true
  bar.append(button, toggle, share, score, status)
  // Never shown: the page carries only the changes themselves. The popup drives Tailor / Show original / Share and
  // reads the status through readStatus, numbers included. The bar stays so those paths work.
  bar.hidden = true
  root.append(style, bar, gatePop, scorePop)
  document.documentElement.append(host)

  let mode: UiMode = 'original'
  const ui: TailorUi = {
    host,
    root,
    button,
    callbacks,
    setMode(next) {
      mode = next
      bar.dataset['mode'] = next // PANEL_CSS draws the active segment of the view toggle from this
      const has = hasView(root)
      button.disabled = next === 'loading'
      button.textContent = next === 'loading' ? 'Tailoring…' : next === 'tailored' ? 'Re-tailor' : 'Tailor'
      toggle.hidden = !has || next === 'loading'
      toggle.textContent = next === 'tailored' ? 'Original' : 'Tailored'
      share.hidden = !callbacks.onShare || !has || next !== 'tailored'
    },
    setGateSummary(checked, stripped, log) {
      ui.setStatus(`checked ${checked} · stripped ${stripped}`)
      renderGatePop(gatePop, checked, log)
      status.classList.toggle('has-log', !!log)
      if (!log) gatePop.hidden = true
    },
    setStatus(text, isError = false) {
      status.textContent = text
      status.title = text // the bar truncates long statuses
      status.classList.toggle('is-error', isError)
      // A plain status (a demo step, an error, "Learned: …") replaces the gate line: shown at rest, opens nothing.
      // setGateSummary puts has-log back after it calls this.
      status.classList.remove('has-log')
      gatePop.hidden = true
    },
    readStatus() {
      return { text: status.textContent ?? '', isError: status.classList.contains('is-error'), isGate: status.classList.contains('has-log') }
    },
    setScorecard(card) {
      scorePop.hidden = true
      if (!card) {
        score.textContent = ''
        score.hidden = true
        scorePop.replaceChildren()
        return
      }
      const chip = scorecardChip(card) // the short form fits the small bar; the full line is the tooltip
      score.hidden = chip === '' // nothing moved: no chip rather than "3.9 → 3.9"
      score.textContent = chip
      score.title = scorecardLine(card)
      renderScorePop(scorePop, card)
    },
    destroy() {
      teardownInPlace(ui)
      teardownPanel(ui)
      host.remove()
    },
  }
  status.addEventListener('click', () => {
    if (status.classList.contains('has-log')) gatePop.hidden = !gatePop.hidden
    scorePop.hidden = true
  })
  score.addEventListener('click', () => {
    scorePop.hidden = !scorePop.hidden
    gatePop.hidden = true
  })

  const showError = (err: unknown): void => ui.setStatus(err instanceof Error ? err.message : String(err), true)

  button.addEventListener('click', () => {
    ui.setMode('loading')
    // Mode follows what is actually on screen, so a failed Re-tailor over a visible view stays 'tailored'.
    const settle = (): void => ui.setMode(viewShown(root) ? 'tailored' : 'original')
    callbacks.onTailor().then(settle, (err: unknown) => {
      settle()
      showError(err)
    })
  })
  toggle.addEventListener('click', () => {
    if (mode === 'tailored') {
      userShowsOriginal(ui)
    } else {
      showTailored(ui)
      callbacks.onShowTailored()
    }
  })
  share.addEventListener('click', () => {
    if (!callbacks.onShare) return
    share.disabled = true
    callbacks
      .onShare()
      .catch(showError)
      .finally(() => {
        share.disabled = false
      })
  })
  return ui
}

// ───────────────────────────── the panel ─────────────────────────────

interface PanelState {
  overlay: HTMLElement
  panel: HTMLElement
  meta: HTMLElement
  gateLog: HTMLDetailsElement
  list: HTMLElement
  facts: Map<string, Fact>
  /** Date.now() when the panel was last shown; null while hidden. */
  dwellStart: number | null
  onPageHide: () => void
}

/** Per shadow root, so the TailorUi object itself stays a plain interface. */
const panels = new WeakMap<ShadowRoot, PanelState>()

function ensurePanel(ui: TailorUi): PanelState {
  const existing = panels.get(ui.root)
  if (existing) return existing

  const overlay = el('div', 'overlay')
  overlay.hidden = true
  const panel = el('div', 'panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Tailored page')
  panel.tabIndex = -1 // focusable, so arrow keys / space scroll the column

  const head = el('header', 'panel-head')
  const titles = el('div')
  const meta = el('span', 'meta')
  titles.append(el('span', 'eyebrow', 'Tailored for you'), meta)
  const back = el('button', 'ghost', 'Show original')
  back.type = 'button'
  back.addEventListener('click', () => userShowsOriginal(ui))
  head.append(titles, back)

  const gateLog = el('details', 'gate-log')
  const list = el('div', 'blocks')
  panel.append(head, gateLog, list)
  overlay.append(panel)
  ui.root.append(overlay)

  const state: PanelState = {
    overlay,
    panel,
    meta,
    gateLog,
    list,
    facts: new Map(),
    dwellStart: null,
    onPageHide: () => stopDwell(ui),
  }
  window.addEventListener('pagehide', state.onPageHide)
  panels.set(ui.root, state)
  return state
}

function teardownPanel(ui: TailorUi): void {
  const state = panels.get(ui.root)
  if (!state) return
  stopDwell(ui)
  window.removeEventListener('pagehide', state.onPageHide)
  panels.delete(ui.root)
}

/** Reports dwell once per shown period: when the panel is hidden or the page goes away (§3.8). */
function stopDwell(ui: TailorUi): void {
  const state = panels.get(ui.root)
  if (!state || state.dwellStart === null) return
  const ms = Math.max(0, Date.now() - state.dwellStart)
  state.dwellStart = null
  ui.callbacks.onInteraction({ kind: 'dwell', blockType: 'summary', ms })
}

function blockContext(ui: TailorUi, state: PanelState): BlockContext {
  return { facts: state.facts, report: (event) => ui.callbacks.onInteraction(event) }
}

function appendBlock(state: PanelState, block: Parameters<typeof renderBlock>[0], ctx: BlockContext): HTMLElement | null {
  try {
    const node = renderBlock(block, ctx)
    node.dataset['blockIndex'] = String(state.list.children.length)
    state.list.append(node)
    return node
  } catch {
    // A malformed block (e.g. from an old cache) is skipped, never half-rendered. Log the type only, never text.
    console.warn('[tailor] skipped a block that failed to render:', (block as { type?: unknown }).type)
    return null
  }
}

const STRIP_REASONS: Record<string, string> = {
  not_on_page: 'not on the page',
  link_not_on_page: 'link not on the page',
  invalid_block: 'invalid block',
}

/** The bar's fact-check popover: every stripped claim, struck through, with where it was and why (§9 "Trust"). */
function renderGatePop(pop: HTMLElement, checked: number, log: StrippedClaim[] | undefined): void {
  pop.replaceChildren()
  if (!log) return
  pop.append(el('div', 'gate-title', `Fact check: ${checked} claims checked against this page · ${log.length} stripped`))
  const items = el('ul')
  for (const s of log) {
    const li = el('li')
    li.append(el('span', 'claim', s.claim), document.createTextNode(` (${s.blockType}, ${STRIP_REASONS[s.reason] ?? s.reason})`))
    items.append(li)
  }
  if (log.length === 0) items.append(el('li', undefined, 'Nothing stripped: every claim was found on the page.'))
  pop.append(items)
}

/** The scorecard popover: every row measured by code on this page, before vs after the edits (§8.5). */
function renderScorePop(pop: HTMLElement, card: Scorecard): void {
  pop.replaceChildren()
  pop.append(el('div', 'gate-title', `What changed for you · measured on this page (N = ${card.marked} marked)`))
  const table = el('table')
  for (const [label, value] of scorecardRows(card)) {
    const tr = el('tr')
    tr.append(el('td', undefined, label), el('td', undefined, value))
    table.append(tr)
  }
  pop.append(table)
  pop.append(el('div', 'foot', `Positions measured at the same scroll offset, before and after. Screen = ${card.viewportHeight} px.`))
}

function renderGateLog(state: PanelState, gate: TailoredPage['gate']): void {
  const summary = el('summary', undefined, `Fact check: ${gate.checked} claims checked against this page · ${gate.stripped.length} stripped`)
  const items = el('ul')
  for (const s of gate.stripped) {
    const li = el('li')
    li.append(el('span', 'claim', s.claim), document.createTextNode(` (${s.blockType}, ${STRIP_REASONS[s.reason] ?? s.reason})`))
    items.append(li)
  }
  if (gate.stripped.length === 0) items.append(el('li', undefined, 'Nothing stripped: every claim was found on the page.'))
  state.gateLog.replaceChildren(summary, items)
}

/**
 * Shows a tailored page. With `page.edits` and an in-place target, the edits are applied to the site's own DOM (§3.7)
 * and any panel is dropped. Otherwise the blocks render in the panel. "Why" chips show evidence from `facts`.
 */
export function renderTailored(page: TailoredPage, facts: Fact[], ui: TailorUi, target?: InPlaceTarget): void {
  if (page.edits && target) {
    dropPanel(ui)
    applyInPlace(page, facts, ui, target)
    ui.setMode('tailored')
    return
  }
  teardownInPlace(ui)
  const state = ensurePanel(ui)
  state.facts = new Map(facts.map((f) => [f.id, f]))
  state.meta.textContent = displayHost(page.url)
  renderGateLog(state, page.gate)
  state.list.replaceChildren()
  const ctx = blockContext(ui, state)
  for (const block of page.blocks) appendBlock(state, block, ctx)
  state.panel.scrollTop = 0
  showTailored(ui)
}

/**
 * Demo mode: like renderTailored for a page with edits, but the changes PLAY (§9: "the page re-fits itself"): promoted
 * cards fly to the front of their list, then every change top to bottom with its motion, the window following. The bar shows "Tailored" from
 * the start so Original can stop the run. Resolves with whether the tailored view is on screen at the end (false when
 * the user flipped to Original mid-run). Pages without edits fall back to renderTailored (the panel) and resolve true.
 */
export async function playTailored(page: TailoredPage, facts: Fact[], ui: TailorUi, target: InPlaceTarget, opts: PlayOptions = {}): Promise<boolean> {
  if (!page.edits) {
    renderTailored(page, facts, ui, target)
    return true
  }
  dropPanel(ui)
  applyInPlace(page, facts, ui, target, false)
  ui.setMode('tailored')
  return playInPlace(ui, opts)
}

/** An in-place render replaces any block panel. */
function dropPanel(ui: TailorUi): void {
  const panel = panels.get(ui.root)
  if (!panel) return
  panel.overlay.hidden = true
  teardownPanel(ui)
  panel.overlay.remove()
}

/** Puts the original back (in-place edits undone, or the panel hidden; both remembered), closes any sheet, reports dwell. */
export function showOriginal(ui: TailorUi): void {
  openSheets.get(ui.root)?.(false)
  hideInPlace(ui)
  const state = panels.get(ui.root)
  if (state) {
    state.overlay.hidden = true
    stopDwell(ui)
  }
  ui.setMode('original')
}

/** Shows the last tailored view again (in-place edits re-applied, or the panel) and restarts dwell. No-op before any render. */
export function showTailored(ui: TailorUi): void {
  if (hasInPlace(ui.root)) {
    showInPlace(ui)
    ui.setMode('tailored')
    return
  }
  const state = panels.get(ui.root)
  if (!state) return
  state.overlay.hidden = false
  if (state.dwellStart === null) state.dwellStart = Date.now()
  state.panel.focus({ preventScroll: true })
  ui.setMode('tailored')
}

/** The user flipped to the original (bar toggle or the panel's button): hide, notify, log toggle_original. */
function userShowsOriginal(ui: TailorUi): void {
  showOriginal(ui)
  ui.callbacks.onShowOriginal()
  ui.callbacks.onInteraction({ kind: 'toggle_original', blockType: 'summary' })
}

// ───────────────────────────── consent sheet (§4 step 3) ─────────────────────────────

/** Closes an open sheet (answering false) before a new one opens, so no promise is left hanging. */
const openSheets = new WeakMap<ShadowRoot, (answer: boolean) => void>()

/** The consent sheet (§4 step 3). Resolves true for "Share N facts", false for "Don't share" / Escape / backdrop. */
export function renderConsentSheet(ui: TailorUi, preview: SharePreview): Promise<boolean> {
  openSheets.get(ui.root)?.(false)
  return new Promise<boolean>((resolve) => {
    const n = preview.facts.length
    const host = displayHost(preview.endpoint) || location.hostname

    const backdrop = el('div', 'sheet-backdrop')
    const sheet = el('div', 'sheet')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    const title = el('h2', 'sheet-title', `Share with ${host}?`)
    title.id = 'tailor-consent-title'
    sheet.setAttribute('aria-labelledby', title.id)

    sheet.append(title, el('p', 'sheet-label', 'Tailor will send exactly these words:'), el('blockquote', 'quote-box', preview.needsText))
    if (preview.constraints) {
      sheet.append(el('p', 'sheet-label', 'And these constraints:'), el('blockquote', 'quote-box', preview.constraints))
    }
    if (n > 0) {
      const list = el('ul', 'sheet-facts')
      for (const fact of preview.facts) {
        const li = el('li')
        li.append(el('strong', undefined, fact.value))
        const first = fact.evidence[0]
        if (first) li.append(el('span', 'ev', evidenceLine(first)))
        list.append(li)
      }
      sheet.append(el('p', 'sheet-label', `Built from ${n} ${n === 1 ? 'fact' : 'facts'} in your profile:`), list)
    }
    sheet.append(el('p', 'sheet-meta', `Sent as: ${preview.agentName}`))
    if (preview.usingFallback) sheet.append(el('p', 'sheet-fallback', 'Using the cached demo reply'))

    const deny = el('button', 'secondary', "Don't share")
    deny.type = 'button'
    const allow = el('button', 'primary', `Share ${n} ${n === 1 ? 'fact' : 'facts'}`)
    allow.type = 'button'
    const actions = el('div', 'sheet-actions')
    actions.append(deny, allow)
    sheet.append(actions)
    backdrop.append(sheet)

    let done = false
    const close = (answer: boolean): void => {
      if (done) return
      done = true
      document.removeEventListener('keydown', onKey, true)
      openSheets.delete(ui.root)
      backdrop.remove()
      resolve(answer)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close(false)
    }
    allow.addEventListener('click', () => close(true))
    deny.addEventListener('click', () => close(false))
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false)
    })
    document.addEventListener('keydown', onKey, true)
    openSheets.set(ui.root, close)

    ui.root.append(backdrop)
    deny.focus() // the safe default: Enter alone never shares
  })
}

// ───────────────────────────── the site's reply (§4 step 5) ─────────────────────────────

/**
 * "From coframe.com · the site's own words", plain text only. In place: inserted into the page under the headline.
 * Panel: appended as a from_site block via the same renderer.
 */
export function renderFromSite(ui: TailorUi, text: string, siteUrl: string): void {
  if (hasInPlace(ui.root)) {
    const host = appendFromSiteInPlace(ui, text, siteUrl)
    ui.setMode('tailored')
    host?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    return
  }
  const state = ensurePanel(ui)
  const node = appendBlock(state, { type: 'from_site', text, siteUrl }, blockContext(ui, state))
  showTailored(ui)
  node?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
}
