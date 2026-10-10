/**
 * Render in place (CONTEXT.txt §3.7). Owner: Petr.
 *
 * Plain DOM inside a shadow root so the site's CSS never clashes. A floating Original ↔ Tailored switch.
 * Every change has a "why" chip that opens the exact quote from the user's chats.
 * Interactions (expand, collapse, toggle_original, open_why, ignore, dwell) are reported through `onInteraction`.
 *
 * Files: styles.ts (PANEL_CSS, restyle there), blocks.ts (one renderer per Block type + pure helpers), this file
 * (the bar, the panel, Original ↔ Tailored, dwell, the consent sheet, the site's reply).
 * Text enters the DOM only via textContent. NEVER innerHTML anywhere in src/render.
 *
 * Layout choice: the tailored view is a fixed, scrollable column (max-width 720px) centered over a dimmed backdrop
 * that covers the page, NOT a rewrite of the site's DOM. Why: (1) we never touch the site's DOM or styles (CLAUDE.md);
 * (2) the original page stays intact underneath, so Original ↔ Tailored is instant (hide/show, no re-render);
 * (3) one layout works on every site whatever its markup; (4) the fidelity gate checks the visible original page,
 * which this keeps exactly as the site rendered it (§3.6).
 */
import type { Fact, Interaction, TailoredPage } from '@/types'
import type { SharePreview } from '@/messages'
import { type BlockContext, displayHost, el, evidenceLine, renderBlock } from './blocks'
import { PANEL_CSS } from './styles'

export { PANEL_CSS } from './styles'
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
  setGateSummary(checked: number, stripped: number): void
  /** Shows an error (or any short status) in the bar. Never pass message text here. */
  setStatus(text: string, isError?: boolean): void
  destroy(): void
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
  const toggle = el('button', 'secondary', 'Original')
  toggle.type = 'button'
  toggle.hidden = true
  const share = el('button', 'secondary', 'Share')
  share.type = 'button'
  share.hidden = true
  const status = el('span', 'status')
  status.setAttribute('aria-live', 'polite')
  bar.append(button, toggle, share, status)
  root.append(style, bar)
  document.documentElement.append(host)

  let mode: UiMode = 'original'
  const ui: TailorUi = {
    host,
    root,
    button,
    callbacks,
    setMode(next) {
      mode = next
      const hasPanel = panels.has(root)
      button.disabled = next === 'loading'
      button.textContent = next === 'loading' ? 'Tailoring…' : next === 'tailored' ? 'Re-tailor' : 'Tailor'
      toggle.hidden = !hasPanel || next === 'loading'
      toggle.textContent = next === 'tailored' ? 'Original' : 'Tailored'
      share.hidden = !callbacks.onShare || !hasPanel || next !== 'tailored'
    },
    setGateSummary(checked, stripped) {
      ui.setStatus(`checked ${checked} · stripped ${stripped}`)
    },
    setStatus(text, isError = false) {
      status.textContent = text
      status.classList.toggle('is-error', isError)
    },
    destroy() {
      teardownPanel(ui)
      host.remove()
    },
  }

  const showError = (err: unknown): void => ui.setStatus(err instanceof Error ? err.message : String(err), true)

  button.addEventListener('click', () => {
    ui.setMode('loading')
    // Mode follows what is actually on screen, so a failed Re-tailor over a visible panel stays 'tailored'.
    const settle = (): void => ui.setMode(panels.get(root)?.overlay.hidden === false ? 'tailored' : 'original')
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

/** Blocks → DOM inside the shadow root, covering the page's main content. "Why" chips show evidence from `facts`. */
export function renderTailored(page: TailoredPage, facts: Fact[], ui: TailorUi): void {
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

/** Hides the panel (DOM kept, so the toggle is instant), reports dwell, sets the bar to Original. */
export function showOriginal(ui: TailorUi): void {
  const state = panels.get(ui.root)
  if (state) {
    state.overlay.hidden = true
    stopDwell(ui)
  }
  ui.setMode('original')
}

/** Shows the last rendered panel again and restarts the dwell timer. No-op before anything was rendered. */
export function showTailored(ui: TailorUi): void {
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

/** "From coframe.com · the site's own words" block, plain text only, appended to the panel via the same renderer. */
export function renderFromSite(ui: TailorUi, text: string, siteUrl: string): void {
  const state = ensurePanel(ui)
  const node = appendBlock(state, { type: 'from_site', text, siteUrl }, blockContext(ui, state))
  showTailored(ui)
  node?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
}
