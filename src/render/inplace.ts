/**
 * In-place rendering (CONTEXT.txt §3.7): apply a TailoredPage's edits to the site's OWN DOM. Owner: Petr.
 *
 * The site keeps its look. A rewrite swaps the text inside the site's element (same tag, same site styles). A hide
 * sets display:none on the smallest container that holds only the hidden elements and leaves a one-line stub where it
 * stood. A note slots in right after the element it is about. Each change carries a "why" chip. Original ↔ Tailored
 * puts every original node back: `off()` undoes exactly what `on()` did.
 *
 * Everything we insert is a custom element (<tailor-note>, <tailor-fold>, <tailor-why>) with its own shadow root, so
 * our styles never reach the site and the site's rarely reach us. Text enters the DOM only via textContent /
 * createTextNode. NEVER innerHTML anywhere in src/render.
 */
import type { BlockType, Fact, PageEdit, PageSegment, TailoredPage } from '@/types'
import type { InteractionEvent, TailorUi } from './index'
import { displayHost, el, evidenceLine, splitSiteClaims } from './blocks'
import { INPLACE_CSS, WHY_CSS } from './styles'

/** Finds the live element for a segment (tailor.resolveSegment bound to the document and the remembered elements). */
export type ResolveSegment = (segment: PageSegment) => Element | null

export interface InPlaceTarget {
  segments: PageSegment[]
  resolve: ResolveSegment
}

/** One applied change. `on` applies it, `off` undoes exactly what `on` did. Both are idempotent. */
interface Applied {
  on(): void
  off(): void
}

interface InPlaceState {
  applied: Applied[]
  shown: boolean
  dwellStart: number | null
  facts: Map<string, Fact>
  bySegment: Map<string, PageSegment>
  resolve: ResolveSegment
  /** Hidden elements → the stub that stands in for them (notes anchored inside a fold go after the stub). */
  foldStubs: Map<Element, HTMLElement>
  onPageHide: () => void
}

/** How each edit op is reported in Interaction.blockType (the frozen types speak in block types). */
const BLOCK_TYPE_OF: Record<PageEdit['op'], BlockType> = { rewrite: 'section', hide: 'hidden', note: 'for_you', warn: 'warning' }

/** Anchors inside list/table structures: a note goes after the whole structure, never between two <li>. */
const STRUCTURE_ITEM = 'li, td, th, tr, dt, dd, summary'
const STRUCTURE = 'ul, ol, table, dl, details'

const states = new WeakMap<ShadowRoot, InPlaceState>()

export function hasInPlace(root: ShadowRoot): boolean {
  return states.has(root)
}

export function inPlaceShown(root: ShadowRoot): boolean {
  return states.get(root)?.shown === true
}

// ───────────────────────────── inserted elements ─────────────────────────────

function shadowHost(tag: 'tailor-note' | 'tailor-fold' | 'tailor-why', css: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag)
  const root = host.attachShadow({ mode: 'open' })
  const style = el('style')
  style.textContent = css
  root.append(style)
  return { host, root }
}

/** One "why" chip for a fact: hover previews the quote, click pins it and reports open_why. */
export function whyChip(fact: Fact, blockType: BlockType, report: (e: InteractionEvent) => void): HTMLElement {
  const { host, root } = shadowHost('tailor-why', WHY_CSS)
  host.dataset['factId'] = fact.id
  const chip = el('button', 'why', 'why')
  chip.type = 'button'
  chip.setAttribute('aria-expanded', 'false')
  chip.setAttribute('aria-label', `Why: ${fact.value}`)
  const pop = el('span', 'why-pop')
  pop.hidden = true
  const first = fact.evidence[0]
  pop.append(el('span', 'why-value', fact.value), el('span', 'why-quote', first ? evidenceLine(first) : 'No quote on file'))
  chip.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = pop.hidden
    pop.hidden = !open
    chip.setAttribute('aria-expanded', String(open))
    if (open) report({ kind: 'open_why', blockType, factIds: [fact.id] })
  })
  root.append(chip, pop)
  return host
}

/** Live (not deleted) facts for a list of ids; unknown ids get no chip (never a reason we cannot back with a quote). */
function liveFacts(ids: string[] | undefined, facts: Map<string, Fact>): Fact[] {
  return (ids ?? []).map((id) => facts.get(id)).filter((f): f is Fact => !!f && f.userStatus !== 'deleted')
}

function whyRow(facts: Fact[], blockType: BlockType, report: (e: InteractionEvent) => void): HTMLElement | null {
  if (facts.length === 0) return null
  const row = el('div', 'why-row')
  for (const f of facts) row.append(whyChip(f, blockType, report))
  return row
}

/** A personal note (for_you) or warning, inserted into the page. ✕ hides it and reports ignore. */
function noteHost(edit: Extract<PageEdit, { op: 'note' | 'warn' }>, state: InPlaceState, report: (e: InteractionEvent) => void): HTMLElement {
  const { host, root } = shadowHost('tailor-note', INPLACE_CSS)
  const blockType = BLOCK_TYPE_OF[edit.op]
  host.dataset['blockType'] = blockType
  const note = el('div', edit.op === 'warn' ? 'note is-warn' : 'note')
  if (edit.op === 'warn') note.setAttribute('role', 'note')
  note.append(el('div', 'kicker', edit.op === 'warn' ? 'Heads up' : 'For you'), el('p', 'text', edit.text))
  const facts = liveFacts(edit.factIds, state.facts)
  const row = whyRow(facts, blockType, report)
  if (row) note.append(row)
  const x = el('button', 'dismiss', '✕')
  x.type = 'button'
  x.setAttribute('aria-label', 'Dismiss this note')
  x.addEventListener('click', () => {
    host.hidden = true
    report({ kind: 'ignore', blockType, factIds: edit.factIds })
  })
  note.append(x)
  root.append(note)
  return host
}

/** The site's reply, verbatim, labeled as the site's, numbers marked as its claims (§4 step 5). Plain text only. */
function fromSiteHost(text: string, siteUrl: string): HTMLElement {
  const { host, root } = shadowHost('tailor-note', INPLACE_CSS)
  host.dataset['blockType'] = 'from_site'
  host.dataset['untrusted'] = 'true'
  const note = el('div', 'note is-site')
  const body = el('p', 'text')
  for (const part of splitSiteClaims(text)) {
    if (!part.claim) {
      body.append(document.createTextNode(part.text))
      continue
    }
    const span = el('span', 'site-claim', part.text)
    span.title = "the site's claim"
    body.append(span)
  }
  note.append(el('div', 'kicker', `From ${displayHost(siteUrl)} · the site's own words`), body)
  root.append(note)
  return host
}

/** The one-line stub left where a hidden part stood: "Hidden: <label> — <reason>  Show". */
function foldHost(edit: Extract<PageEdit, { op: 'hide' }>, onToggle: (expand: boolean) => void): { host: HTMLElement; toggle: HTMLButtonElement } {
  const { host, root } = shadowHost('tailor-fold', INPLACE_CSS)
  host.dataset['blockType'] = 'hidden'
  const fold = el('div', 'fold')
  const label = el('span', 'label')
  label.append(el('b', undefined, `Hidden: ${edit.label}`), document.createTextNode(` — ${edit.reason}`))
  const toggle = el('button', 'toggle', 'Show')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.addEventListener('click', () => {
    const expand = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(expand))
    toggle.textContent = expand ? 'Hide' : 'Show'
    onToggle(expand)
  })
  fold.append(label, toggle)
  root.append(fold)
  return { host, toggle }
}

// ───────────────────────────── DOM placement ─────────────────────────────

/** Where a note about `anchor` goes: after the list/table it sits in, else after the anchor itself. */
function placementFor(anchor: Element): Element {
  if (anchor.matches(STRUCTURE_ITEM)) return anchor.closest(STRUCTURE) ?? anchor
  return anchor
}

function commonAncestor(els: Element[]): Element | null {
  let node: Element | null = els[0] ?? null
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement
  return node
}

/**
 * The elements to hide for a group: the highest ancestor that holds only this group's segments (so a whole
 * testimonials <section> folds, images and all), else each element on its own. Never body/html/main/article.
 */
export function foldTargets(group: Element[], allSegmentEls: Element[]): Element[] {
  if (group.length === 0) return []
  const inGroup = new Set(group)
  const stopAt = (e: Element): boolean => e === document.body || e === document.documentElement || e.matches('main, article, [role="main"]')
  let best: Element | null = null
  let node = commonAncestor(group)
  while (node && !stopAt(node)) {
    const current = node
    const exclusive = allSegmentEls.every((seg) => !current.contains(seg) || inGroup.has(seg))
    if (!exclusive) break
    best = current
    node = current.parentElement
  }
  return best ? [best] : group
}

interface SavedDisplay {
  value: string
  priority: string
  /** Whether the element had a style attribute at all, so the undo leaves no empty style="" behind. */
  hadStyleAttr: boolean
}

const NO_DISPLAY: SavedDisplay = { value: '', priority: '', hadStyleAttr: true }

function hideElement(target: Element): SavedDisplay {
  const style = (target as HTMLElement).style
  const saved = { value: style.getPropertyValue('display'), priority: style.getPropertyPriority('display'), hadStyleAttr: target.hasAttribute('style') }
  style.setProperty('display', 'none', 'important')
  return saved
}

function restoreElement(target: Element, saved: SavedDisplay): void {
  const style = (target as HTMLElement).style
  if (saved.value) style.setProperty('display', saved.value, saved.priority)
  else style.removeProperty('display')
  if (!saved.hadStyleAttr && style.length === 0) target.removeAttribute('style')
}

// ───────────────────────────── apply / show / hide ─────────────────────────────

function stopDwell(ui: TailorUi, state: InPlaceState): void {
  if (state.dwellStart === null) return
  const ms = Math.max(0, Date.now() - state.dwellStart)
  state.dwellStart = null
  ui.callbacks.onInteraction({ kind: 'dwell', blockType: 'summary', ms })
}

/** Undoes and forgets everything applied for this ui. Safe to call when nothing was applied. */
export function teardownInPlace(ui: TailorUi): void {
  const state = states.get(ui.root)
  if (!state) return
  stopDwell(ui, state)
  for (const a of [...state.applied].reverse()) a.off()
  window.removeEventListener('pagehide', state.onPageHide)
  states.delete(ui.root)
}

/**
 * Applies `page.edits` to the live document and shows them. Returns how many edits were applied (an edit whose
 * element is gone is skipped, never half-applied). Re-applying first undoes the previous application.
 */
export function applyInPlace(page: TailoredPage, facts: Fact[], ui: TailorUi, target: InPlaceTarget): number {
  teardownInPlace(ui)
  const state: InPlaceState = {
    applied: [],
    shown: false,
    dwellStart: null,
    facts: new Map(facts.map((f) => [f.id, f])),
    bySegment: new Map(target.segments.map((s) => [s.id, s])),
    resolve: target.resolve,
    foldStubs: new Map(),
    onPageHide: () => {
      const s = states.get(ui.root)
      if (s) stopDwell(ui, s)
    },
  }
  const report = (e: InteractionEvent): void => ui.callbacks.onInteraction(e)
  const resolveId = (id: string): Element | null => {
    const seg = state.bySegment.get(id)
    return seg ? state.resolve(seg) : null
  }
  const allSegmentEls = target.segments.map((s) => state.resolve(s)).filter((e): e is Element => !!e)
  const edits = page.edits ?? []

  // 1. Rewrites: swap the element's children for one text node (+ a why chip when the model cited facts).
  for (const edit of edits) {
    if (edit.op !== 'rewrite') continue
    const element = resolveId(edit.id)
    if (!element) continue
    const original = Array.from(element.childNodes)
    const chips = liveFacts(edit.factIds, state.facts).map((f) => whyChip(f, 'section', report))
    state.applied.push({
      on: () => element.replaceChildren(document.createTextNode(edit.text), ...chips),
      off: () => element.replaceChildren(...original),
    })
  }

  // 2. Hides: fold the smallest exclusive container, leave a stub. Show/Hide on the stub reports expand/collapse.
  for (const edit of edits) {
    if (edit.op !== 'hide') continue
    const group = edit.ids.map(resolveId).filter((e): e is Element => !!e)
    const targets = foldTargets(group, allSegmentEls)
    if (targets.length === 0) continue
    let saved: SavedDisplay[] = []
    let expanded = false
    const hideAll = (): void => {
      saved = targets.map(hideElement)
    }
    const showAll = (): void => {
      targets.forEach((t, i) => restoreElement(t, saved[i] ?? NO_DISPLAY))
    }
    const { host, toggle } = foldHost(edit, (expand) => {
      expanded = expand
      if (expand) showAll()
      else hideAll()
      report({ kind: expand ? 'expand' : 'collapse', blockType: 'hidden', factIds: [] })
    })
    for (const t of targets) state.foldStubs.set(t, host)
    state.applied.push({
      on: () => {
        hideAll()
        expanded = false
        toggle.setAttribute('aria-expanded', 'false')
        toggle.textContent = 'Show'
        targets[0]!.before(host)
      },
      off: () => {
        if (!expanded) showAll()
        host.remove()
      },
    })
  }

  // 3. Notes and warnings: after the anchor (or after the stub that replaced the part the anchor is in).
  for (const edit of edits) {
    if (edit.op !== 'note' && edit.op !== 'warn') continue
    const anchor = resolveId(edit.after) ?? (target.segments[0] ? state.resolve(target.segments[0]) : null)
    if (!anchor) continue
    const host = noteHost(edit, state, report)
    state.applied.push({
      on: () => insertAfterVisible(placementFor(anchor), host, state),
      off: () => host.remove(),
    })
  }

  window.addEventListener('pagehide', state.onPageHide)
  states.set(ui.root, state)
  showInPlace(ui)
  return state.applied.length
}

/** Inserts `host` after `anchor`, or after the fold stub when the anchor sits inside a hidden part. */
function insertAfterVisible(anchor: Element, host: HTMLElement, state: InPlaceState): void {
  for (const [hidden, stub] of state.foldStubs) {
    if (hidden === anchor || hidden.contains(anchor)) {
      stub.after(host)
      return
    }
  }
  anchor.after(host)
}

/** Appends the site's reply after the page's first segment (the headline), or at the top of the body. */
export function appendFromSiteInPlace(ui: TailorUi, text: string, siteUrl: string): HTMLElement | null {
  const state = states.get(ui.root)
  if (!state) return null
  const first = state.bySegment.values().next().value as PageSegment | undefined
  const anchor = first ? state.resolve(first) : null
  const host = fromSiteHost(text, siteUrl)
  const applied: Applied = {
    on: () => {
      if (anchor) insertAfterVisible(placementFor(anchor), host, state)
      else document.body.prepend(host)
    },
    off: () => host.remove(),
  }
  state.applied.push(applied)
  if (state.shown) applied.on()
  else showInPlace(ui)
  return host
}

/** Applies every change (idempotent) and starts the dwell timer. No-op before anything was applied. */
export function showInPlace(ui: TailorUi): void {
  const state = states.get(ui.root)
  if (!state) return
  if (!state.shown) for (const a of state.applied) a.on()
  state.shown = true
  if (state.dwellStart === null) state.dwellStart = Date.now()
}

/** Puts every original node back (idempotent) and reports dwell. The changes stay remembered for an instant re-show. */
export function hideInPlace(ui: TailorUi): void {
  const state = states.get(ui.root)
  if (!state) return
  if (state.shown) for (const a of [...state.applied].reverse()) a.off()
  state.shown = false
  stopDwell(ui, state)
}
