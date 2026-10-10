/**
 * Render in place (CONTEXT.txt §3.7). Owner: Petr.
 *
 * Plain DOM inside a shadow root so the site's CSS never clashes. A floating Original ↔ Tailored switch.
 * Every change has a "why" chip that opens the exact quote from the user's chats.
 * Interactions (expand, collapse, toggle_original, open_why, ignore, dwell) are reported through `onInteraction`.
 * The scaffold below mounts a working floating button so the empty extension is visible in Chrome; replace freely.
 */
import type { Fact, Interaction, TailoredPage } from '@/types'
import type { SharePreview } from '@/messages'
import { todo } from '@/todo'

export type InteractionEvent = Omit<Interaction, 'url' | 'profileVersion' | 'at'>

export interface RenderCallbacks {
  onTailor: () => Promise<void>
  onShowOriginal: () => void
  onShowTailored: () => void
  onInteraction: (event: InteractionEvent) => void
  onShare?: () => Promise<void>
}

export interface TailorUi {
  host: HTMLElement
  root: ShadowRoot
  button: HTMLButtonElement
  setMode(mode: 'original' | 'tailored' | 'loading'): void
  setGateSummary(checked: number, stripped: number): void
  destroy(): void
}

const HOST_ID = 'tailor-ext-host'

const BASE_CSS = `
  :host { all: initial; }
  .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
         font: 13px/1.2 system-ui, -apple-system, sans-serif; background: #111; color: #fff; padding: 8px 10px; border-radius: 999px;
         box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px; background: #fff; color: #111; font-weight: 600; }
  button[disabled] { opacity: .5; cursor: default; }
  .gate { opacity: .7; }
`

/** Mounts the floating control bar once per page. */
export function mountTailorButton(callbacks: RenderCallbacks): TailorUi {
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = HOST_ID
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = BASE_CSS
  const bar = document.createElement('div')
  bar.className = 'bar'
  const button = document.createElement('button')
  button.textContent = 'Tailor'
  const toggle = document.createElement('button')
  toggle.textContent = 'Original'
  toggle.hidden = true
  const gate = document.createElement('span')
  gate.className = 'gate'
  bar.append(button, toggle, gate)
  root.append(style, bar)
  document.documentElement.append(host)

  let mode: 'original' | 'tailored' | 'loading' = 'original'
  const ui: TailorUi = {
    host,
    root,
    button,
    setMode(next) {
      mode = next
      button.disabled = next === 'loading'
      button.textContent = next === 'loading' ? 'Tailoring…' : next === 'tailored' ? 'Re-tailor' : 'Tailor'
      toggle.hidden = next === 'original' && !toggle.dataset['hasTailored']
      toggle.textContent = next === 'tailored' ? 'Original' : 'Tailored'
    },
    setGateSummary(checked, stripped) {
      gate.textContent = `gate: checked ${checked}, stripped ${stripped}`
    },
    destroy() {
      host.remove()
    },
  }

  button.addEventListener('click', () => {
    ui.setMode('loading')
    callbacks.onTailor().then(
      () => {
        toggle.dataset['hasTailored'] = '1'
        ui.setMode('tailored')
      },
      (err: unknown) => {
        ui.setMode('original')
        gate.textContent = err instanceof Error ? err.message : String(err)
      },
    )
  })
  toggle.addEventListener('click', () => {
    if (mode === 'tailored') {
      callbacks.onShowOriginal()
      callbacks.onInteraction({ kind: 'toggle_original', blockType: 'summary' })
      ui.setMode('original')
    } else {
      callbacks.onShowTailored()
      ui.setMode('tailored')
    }
  })
  return ui
}

/** Blocks → DOM inside the shadow root, replacing the page's main content view. "Why" chips show evidence from `facts`. */
export function renderTailored(page: TailoredPage, facts: Fact[], ui: TailorUi): void {
  void page
  void facts
  void ui
  todo('render.renderTailored', 'one renderer per Block type; why chips; expand/collapse; dwell timer')
}

export function showOriginal(ui: TailorUi): void {
  void ui
  todo('render.showOriginal')
}

export function showTailored(ui: TailorUi): void {
  void ui
  todo('render.showTailored')
}

/** The consent sheet (§4 step 3). Resolves true for "Share N facts", false for "Don't share". */
export function renderConsentSheet(ui: TailorUi, preview: SharePreview): Promise<boolean> {
  void ui
  void preview
  return todo('render.renderConsentSheet')
}

/** "From coframe.com · the site's own words" block, plain text only. */
export function renderFromSite(ui: TailorUi, text: string, siteUrl: string): void {
  void ui
  void text
  void siteUrl
  todo('render.renderFromSite')
}
