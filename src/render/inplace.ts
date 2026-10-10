/**
 * In-place rendering (CONTEXT.txt §3.7): apply a TailoredPage's edits to the site's OWN DOM. Owner: Petr.
 *
 * The site keeps its look. A rewrite swaps the text inside the site's element (same tag, same site styles). A hide
 * sets display:none on the smallest container that holds only the hidden elements and leaves a one-line stub where it
 * stood. A note is a sticky note STUCK ON the element it is about: it lives in an overlay (absolutely positioned in
 * <body>), pinned to a corner of the element's box, and follows the element through layout changes (see `placePin`).
 * Each change carries a "why" chip. Original ↔ Tailored puts every original node back: `off()` undoes exactly what
 * `on()` did. In demo mode the changes PLAY instead of landing at once (`playInPlace`): promotes fly to their new spot
 * first, then everything else top to bottom, each with its own motion (live.ts), the window following along.
 *
 * Everything we insert is a custom element (<tailor-note>, <tailor-fold>, <tailor-why>) with its own shadow root, so
 * our styles never reach the site and the site's rarely reach us. Text enters the DOM only via textContent /
 * createTextNode. NEVER innerHTML anywhere in src/render.
 */
import type { BlockType, Fact, PageEdit, PageRegion, PageSegment, RegionRole, TailoredPage } from '@/types'
import type { InteractionEvent, TailorUi } from './index'
import { displayHost, el, evidenceLine, splitSiteClaims } from './blocks'
import { BADGE_CSS, INPLACE_CSS, WHY_CSS } from './styles'
import {
  MOTION,
  type Run,
  animate,
  badgeIn,
  bringOnScreen,
  byDocumentOrder,
  cancelRun,
  collapse,
  dim,
  finishRun,
  flip,
  flipScope,
  glow,
  hold,
  noteIn,
  onScreen,
  pause,
  scrollWindowTo,
  shortLabel,
  startRun,
  stubIn,
  typeDuration,
  typewrite,
} from './live'

/** Finds the live element for a segment (tailor.resolveSegment bound to the document and the remembered elements). */
export type ResolveSegment = (segment: PageSegment) => Element | null
/** Finds the live element for a region (r#) or item (i#) of the page map. */
export type ResolveRegion = (id: string) => Element | null

export interface InPlaceTarget {
  segments: PageSegment[]
  resolve: ResolveSegment
  /** The page map (PageContent.regions) and how to find its elements, when the page has one. */
  regions?: PageRegion[]
  resolveRegion?: ResolveRegion
  /** Promoted regions land after the top run of regions with this role (SiteProfile.policy.promoteAfterRole). */
  promoteAfterRole?: RegionRole
}

const isMapId = (id: string): boolean => /^[ri]\d+$/.test(id)

/**
 * One change to the page. `on` applies it, `off` undoes exactly what `on` did, `play` applies it with its motion.
 * Neither on nor off is re-entrant on its own: the Applied wrapper (turnOn / turnOff) keeps them to one call each.
 */
interface Step {
  op: PageEdit['op'] | 'from_site'
  /** One line for the bar while the change plays, e.g. "Folding: Customer praise". */
  label: string
  /** The element to bring on screen before the change plays; null plays it where the viewport is. */
  target(): Element | null
  on(): void
  off(): void
  /**
   * Applies the change with its motion, calling `on` (never Step.on directly) at the moment the DOM should change.
   * `on` is a no-op once the run is cancelled, so a motion interrupted by Original ↔ Tailored leaves nothing applied.
   */
  play(run: Run, on: () => void): Promise<void>
}

interface Applied {
  step: Step
  /** Whether `on` is in effect right now. */
  active: boolean
}

function turnOn(a: Applied, run?: Run): void {
  if (a.active || run?.cancelled) return
  a.step.on()
  a.active = true
}

function turnOff(a: Applied): void {
  if (!a.active) return
  a.step.off()
  a.active = false
}

/** Instant on, or a Step whose play() has no motion of its own. */
const instant = (run: Run, on: () => void): Promise<void> => {
  if (!run.cancelled) on()
  return Promise.resolve()
}

interface InPlaceState {
  applied: Applied[]
  shown: boolean
  /** The playback in progress (playInPlace), if any. hide/teardown cancel it. */
  run: Run | null
  dwellStart: number | null
  facts: Map<string, Fact>
  bySegment: Map<string, PageSegment>
  resolve: ResolveSegment
  resolveRegion: ResolveRegion
  /** Hidden elements → the stub that stands in for them (a note anchored inside a fold is pinned to the stub). */
  foldStubs: Map<Element, HTMLElement>
  /** Sticky notes in the overlay and what each is pinned to. */
  pins: Pin[]
  /** Re-places every pin after layout changes: resize, scroll (capture, so sub-scrollers too), body resize, a timer. */
  watch: { ro: ResizeObserver | null; schedule: () => void; timer: ReturnType<typeof setInterval> | null }
  onPageHide: () => void
}

interface Pin {
  host: HTMLElement
  /** The live element the note is about (or the fold stub standing in for it); null when it is gone. */
  anchorOf: () => Element | null
  /** A few px of hand-placed looseness, from the note's text. */
  jitter: number
}

/** A placed note's box in viewport coordinates, so later notes do not land on it. */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const anchorsByHost = new WeakMap<Element, () => Element | null>()

/** The element a sticky note is pinned to right now (tests and the scorecard). */
export function noteAnchor(host: Element): Element | null {
  return anchorsByHost.get(host)?.() ?? null
}

/** How each edit op is reported in Interaction.blockType (the frozen types speak in block types). */
const BLOCK_TYPE_OF: Record<PageEdit['op'], BlockType> = {
  rewrite: 'section',
  hide: 'hidden',
  note: 'for_you',
  warn: 'warning',
  promote: 'for_you',
  badge: 'for_you',
}

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

function shadowHost(tag: 'tailor-note' | 'tailor-fold' | 'tailor-why' | 'tailor-badge', css: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag)
  const root = host.attachShadow({ mode: 'open' })
  const style = el('style')
  style.textContent = css
  root.append(style)
  return { host, root }
}

/**
 * One "why" chip for a fact: hover previews the quote, click pins it and reports open_why. `onPaper` marks a chip
 * that sits on a sticky note, which WHY_CSS draws in the note's ink instead of as a bordered chip.
 */
export function whyChip(fact: Fact, blockType: BlockType, report: (e: InteractionEvent) => void, onPaper = false): HTMLElement {
  const { host, root } = shadowHost('tailor-why', WHY_CSS)
  host.dataset['factId'] = fact.id
  if (onPaper) host.dataset['paper'] = ''
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
  for (const f of facts) row.append(whyChip(f, blockType, report, true))
  return row
}

const KICKER: Record<'note' | 'warn' | 'promote', string> = { note: 'For you', warn: 'Heads up', promote: 'Moved up for you' }

/** Leans a note picks from: some straight, most a little off, like notes stuck on by hand. Paired with a few px of jitter. */
const TILTS = ['-2.2deg', '0deg', '1.6deg', '-0.9deg', '2.4deg', '0deg', '-1.4deg', '1.1deg']
const JITTERS = [0, 9, 3, 13, 6, 1, 11, 4]

/**
 * A sticky note: tape + paper, leaning its own way. The lean comes from the note's text, so the same note keeps its
 * lean across re-renders and two notes next to each other almost never lean alike. The jitter lands on the host
 * (data-jitter) for `placePin`.
 */
function stickyNote(host: HTMLElement, paper: HTMLElement, seed: string): HTMLElement {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const sticky = el('div', 'sticky')
  sticky.style.setProperty('--tilt', TILTS[h % TILTS.length]!)
  host.dataset['jitter'] = String(JITTERS[(h >>> 4) % JITTERS.length])
  const tape = el('span', 'tape')
  tape.setAttribute('aria-hidden', 'true')
  sticky.append(tape, paper)
  return sticky
}

/** A personal note (for_you), warning, or "moved up" sticky, stuck onto the page. ✕ hides it and reports ignore. */
function noteHost(edit: Extract<PageEdit, { op: 'note' | 'warn' | 'promote' }>, state: InPlaceState, report: (e: InteractionEvent) => void): HTMLElement {
  const { host, root } = shadowHost('tailor-note', INPLACE_CSS)
  const blockType = BLOCK_TYPE_OF[edit.op]
  host.dataset['blockType'] = blockType
  host.dataset['op'] = edit.op
  const note = el('div', edit.op === 'warn' ? 'note is-warn' : edit.op === 'promote' ? 'note is-move' : 'note')
  if (edit.op === 'warn') note.setAttribute('role', 'note')
  note.append(el('div', 'kicker', KICKER[edit.op]), el('p', 'text', edit.op === 'promote' ? edit.reason : edit.text))
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
  root.append(stickyNote(host, note, edit.op === 'promote' ? edit.reason : edit.text))
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
  root.append(stickyNote(host, note, text))
  return host
}

/** A tag on a card or element: "For you · <label>" plus why chips. Inline, so it sits inside the card's own title. */
function badgeHost(kicker: string, label: string, factIds: string[], state: InPlaceState, report: (e: InteractionEvent) => void): HTMLElement {
  const { host, root } = shadowHost('tailor-badge', BADGE_CSS)
  host.dataset['blockType'] = 'for_you'
  const pill = el('span', 'badge')
  pill.append(el('span', 'badge-kicker', kicker), el('span', 'badge-label', label))
  root.append(pill)
  for (const f of liveFacts(factIds, state.facts)) root.append(whyChip(f, 'for_you', report))
  return host
}

/** Where a badge goes inside a card: its title (heading) when it has one, else the card itself. */
function badgeSlot(target: Element): Element {
  return target.querySelector('h1, h2, h3, h4, h5, h6') ?? target
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

/** The anchor to pin to: the fold stub when the anchor sits inside a hidden part, else the anchor itself. */
function visibleAnchor(anchor: Element, state: InPlaceState): Element {
  for (const [hidden, stub] of state.foldStubs) {
    if (hidden === anchor || hidden.contains(anchor)) return stub
  }
  return anchor
}

const EDGE = 8 // keep notes this far inside the viewport
const INSET = 14 // how far inside the anchor's corner a note sits

/**
 * Puts a sticky note on its anchor. Tall anchors (images, cards, sections) get the note inside a corner, top-right
 * first. Short ones (a line or two of text) get it stuck on the right end of the line, centred on it, two thirds
 * hanging out beside it: into the margin when there is one, over the neighbour when there is not; else hanging off
 * the line's end below or above it. The first spot clear of earlier notes wins, else the one overlapping them least,
 * so a note always stays on its anchor. Coordinates come from the live box, so this re-runs on layout changes.
 */
function placePin(pin: Pin, taken: Box[]): void {
  const { host } = pin
  if (!host.isConnected) return
  const anchor = pin.anchorOf()
  const r = anchor?.getBoundingClientRect()
  const sticky = host.shadowRoot?.querySelector<HTMLElement>('.sticky')
  if (!anchor || !r || !sticky || (r.width === 0 && r.height === 0)) {
    host.style.visibility = 'hidden' // the anchor is not rendered right now: no note floating at 0,0
    return
  }
  host.style.visibility = ''
  const w = sticky.offsetWidth
  const h = sticky.offsetHeight
  const tall = r.height >= h + 2 * INSET + 24
  const spots: [number, number][] = tall
    ? [
        [r.right - w - INSET, r.top + INSET],
        [r.left + INSET, r.top + INSET],
        [r.right - w - INSET, r.bottom - h - INSET],
        [r.left + INSET, r.bottom - h - INSET],
      ]
    : [
        [r.right - w / 3, r.top + r.height / 2 - h / 2],
        [r.right - w + 20, r.bottom - 12],
        [r.right - w + 20, r.top - h + 12],
      ]
  if (r.width < w + 2 * INSET) for (const spot of spots) spot[0] = r.left + (r.width - w) / 2 // narrower than the note: centre on it
  const viewportW = document.documentElement.clientWidth
  let left = 0
  let top = 0
  let bestOverlap = Infinity
  for (const [x, y] of spots) {
    const l = Math.max(EDGE, Math.min(x, viewportW - w - EDGE))
    const t = y + pin.jitter
    let overlap = 0
    for (const o of taken) overlap += Math.max(0, Math.min(l + w, o.right) - Math.max(l, o.left)) * Math.max(0, Math.min(t + h, o.bottom) - Math.max(t, o.top))
    if (overlap >= bestOverlap) continue
    left = l
    top = t
    bestOverlap = overlap
    if (overlap === 0) break
  }
  // Never above the top of a page the window scrolls. The bound is in document space (viewport y >= -scrollY), which
  // does not move with the reader. A bound in viewport space would re-pin a note scrolled past to the viewport's top
  // edge on every scroll frame, so it travelled with the reader instead of staying on its spot.
  const se = document.scrollingElement
  if (se && se.scrollHeight > se.clientHeight + 1) top = Math.max(top, -window.scrollY)
  taken.push({ left, top, right: left + w, bottom: top + h })
  // Viewport → the host's own coordinates. Its containing block is measured, not assumed: the host sits at the
  // block's origin plus the left/top it has now, so origin = its box minus those. Holds for a static body (the
  // document), a positioned body (Shopify themes), a transformed body or html, and a page that scrolls in a wrapper.
  const hr = host.getBoundingClientRect()
  const originX = hr.left - (parseFloat(host.style.left) || 0)
  const originY = hr.top - (parseFloat(host.style.top) || 0)
  host.style.left = `${Math.round(left - originX)}px`
  host.style.top = `${Math.round(top - originY)}px`
}

/** Appends the note to the overlay and places every note again (so this one lands clear of the others); `off` is `host.remove()`. */
function pinNote(host: HTMLElement, anchorOf: () => Element | null, state: InPlaceState): void {
  const pin: Pin = { host, anchorOf, jitter: Number(host.dataset['jitter'] ?? 0) }
  anchorsByHost.set(host, anchorOf)
  state.pins.push(pin)
  document.body.append(host)
  placeAll(state)
}

function placeAll(state: InPlaceState): void {
  const taken: Box[] = []
  for (const pin of state.pins) placePin(pin, taken)
}

function startWatching(state: InPlaceState): void {
  let queued = false
  const run = (): void => {
    queued = false
    if (state.shown) placeAll(state)
  }
  const schedule = (): void => {
    if (queued) return
    queued = true
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }
  state.watch.schedule = schedule
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('load', schedule)
  if (typeof ResizeObserver !== 'undefined') {
    state.watch.ro = new ResizeObserver(schedule)
    state.watch.ro.observe(document.documentElement)
    state.watch.ro.observe(document.body)
  }
  state.watch.timer = setInterval(schedule, 1000) // lazy images, fonts, late scripts: cheap, five rect reads a second
}

function stopWatching(state: InPlaceState): void {
  window.removeEventListener('resize', state.watch.schedule)
  window.removeEventListener('scroll', state.watch.schedule, true)
  window.removeEventListener('load', state.watch.schedule)
  state.watch.ro?.disconnect()
  if (state.watch.timer !== null) clearInterval(state.watch.timer)
  state.watch = { ro: null, schedule: () => {}, timer: null }
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
  if (state.run) cancelRun(state.run)
  state.run = null
  for (const a of [...state.applied].reverse()) turnOff(a)
  stopWatching(state)
  window.removeEventListener('pagehide', state.onPageHide)
  states.delete(ui.root)
}

/**
 * Applies `page.edits` to the live document and shows them (with `show` false: prepares them for playInPlace or
 * showInPlace). Returns how many edits were applied (an edit whose element is gone is skipped, never half-applied).
 * Re-applying first undoes the previous application.
 */
export function applyInPlace(page: TailoredPage, facts: Fact[], ui: TailorUi, target: InPlaceTarget, show = true): number {
  teardownInPlace(ui)
  const state: InPlaceState = {
    applied: [],
    shown: false,
    run: null,
    dwellStart: null,
    facts: new Map(facts.map((f) => [f.id, f])),
    bySegment: new Map(target.segments.map((s) => [s.id, s])),
    resolve: target.resolve,
    resolveRegion: target.resolveRegion ?? (() => null),
    foldStubs: new Map(),
    pins: [],
    watch: { ro: null, schedule: () => {}, timer: null },
    onPageHide: () => {
      const s = states.get(ui.root)
      if (s) stopDwell(ui, s)
    },
  }
  const report = (e: InteractionEvent): void => ui.callbacks.onInteraction(e)
  const resolveId = (id: string): Element | null => {
    if (isMapId(id)) return state.resolveRegion(id)
    const seg = state.bySegment.get(id)
    return seg ? state.resolve(seg) : null
  }
  const allSegmentEls = target.segments.map((s) => state.resolve(s)).filter((e): e is Element => !!e)
  const edits = page.edits ?? []
  const regions = target.regions ?? []
  const regionTitle = (id: string): string => regions.find((r) => r.id === id)?.title ?? regions.flatMap((r) => r.items ?? []).find((i) => i.id === id)?.title ?? ''
  const push = (step: Step): void => {
    state.applied.push({ step, active: false })
  }

  // 0. Promotes: a region moves to the top of the content (after the hero run), a card to the front of its list.
  //    Undo puts the node back between its original neighbours. Applied first, so hides and notes see the final order.
  const pinnedRole = target.promoteAfterRole
  let topRun = 0
  while (pinnedRole && topRun < regions.length && regions[topRun]!.role === pinnedRole) topRun++
  const firstMovable = regions.slice(topRun).map((r) => state.resolveRegion(r.id)).find((e): e is Element => !!e) ?? null
  let lastPromotedRegion: Element | null = null
  const lastPromotedIn = new Map<Element, Element>() // list container → the card promoted last into it
  for (const edit of edits) {
    if (edit.op !== 'promote') continue
    const element = resolveId(edit.id)
    if (!element) continue
    const isRegion = edit.id.startsWith('r')
    const parent = element.parentElement
    if (!parent) continue
    let origParent: Element | null = null
    let origNext: Node | null = null
    const strip = isRegion ? noteHost(edit, state, report) : badgeHost('Moved up for you', edit.reason, edit.factIds, state, report)
    /** Where the element lands: after the last promoted region (else the first movable one), or the front of its list. */
    const destination = (): Element | null => (isRegion ? lastPromotedRegion ?? firstMovable : element.parentElement)
    push({
      op: 'promote',
      label: `Moving up: ${shortLabel(regionTitle(edit.id) || edit.reason)}`,
      target: destination,
      on: () => {
        origParent = element.parentElement
        origNext = element.nextSibling
        if (isRegion) {
          const anchor = lastPromotedRegion ? lastPromotedRegion.nextSibling : firstMovable
          if (anchor && anchor !== element && anchor.parentNode) anchor.parentNode.insertBefore(element, anchor)
          else if (!anchor && firstMovable?.parentElement && !lastPromotedRegion) firstMovable.parentElement.append(element)
          lastPromotedRegion = element
          pinNote(strip, () => element, state)
        } else {
          const list = element.parentElement!
          const prev = lastPromotedIn.get(list)
          const anchor = prev ? prev.nextSibling : list.firstChild
          if (anchor !== element) list.insertBefore(element, anchor)
          lastPromotedIn.set(list, element)
          badgeSlot(element).append(strip)
        }
      },
      off: () => {
        strip.remove()
        if (origParent) origParent.insertBefore(element, origNext && origNext.parentNode === origParent ? origNext : null)
        if (isRegion) lastPromotedRegion = null
        else lastPromotedIn.clear()
      },
      // The element flies from where it was to where it lands; what it displaces slides out of the way. Its strip
      // (the "moved up" note or badge) stays out of sight until the element has settled, then is pressed on.
      play: async (run, on) => {
        const scope = flipScope(element, destination()?.parentElement ?? element.parentElement)
        let release = (): void => {}
        void glow(run, element, MOTION.flip + MOTION.glowTail)
        await flip(run, scope, () => {
          on()
          release = hold(run, strip, { opacity: 0 })
        })
        if (run.cancelled) return release()
        placeAll(state) // the pin was placed while the region was still in flight
        release()
        await (isRegion ? noteIn(run, strip) : badgeIn(run, strip))
      },
    })
  }

  // 1. Rewrites: swap the element's children for one text node (+ a why chip when the model cited facts).
  for (const edit of edits) {
    if (edit.op !== 'rewrite') continue
    const element = resolveId(edit.id)
    if (!element) continue
    const original = Array.from(element.childNodes)
    const chips = liveFacts(edit.factIds, state.facts).map((f) => whyChip(f, 'section', report))
    const textNode = document.createTextNode(edit.text)
    push({
      op: 'rewrite',
      label: `Rewriting: ${shortLabel(state.bySegment.get(edit.id)?.text ?? edit.text)}`,
      target: () => element,
      on: () => {
        textNode.data = edit.text
        element.replaceChildren(textNode, ...chips)
      },
      off: () => element.replaceChildren(...original),
      // The old text goes quiet, then the new one types in under a soft glow; the why chips pop in at the end.
      play: async (run, on) => {
        const undim = await dim(run, element)
        if (run.cancelled) return undim()
        on()
        const releases = chips.map((c) => hold(run, c, { opacity: 0 }))
        undim()
        const ms = typeDuration(edit.text)
        await Promise.all([typewrite(run, textNode, edit.text, ms), glow(run, element, ms + MOTION.glowTail)])
        for (const r of releases) r()
        await Promise.all(chips.map((c) => badgeIn(run, c)))
      },
    })
  }

  // 2. Hides: fold the smallest exclusive container, leave a stub. Show/Hide on the stub reports expand/collapse.
  //    Region and item ids are containers already and fold as they are.
  for (const edit of edits) {
    if (edit.op !== 'hide') continue
    const direct = edit.ids.filter(isMapId).map(resolveId).filter((e): e is Element => !!e)
    const group = edit.ids.filter((id) => !isMapId(id)).map(resolveId).filter((e): e is Element => !!e)
    const targets = [...direct, ...foldTargets(group, allSegmentEls).filter((t) => !direct.some((d) => d.contains(t)))]
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
    push({
      op: 'hide',
      label: `Folding: ${shortLabel(edit.label)}`,
      target: () => targets[0]!,
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
      // Each part dims and shrinks to a line, then display:none lands and the stub slides into its place.
      play: async (run, on) => {
        const releases = await Promise.all(targets.map((t) => collapse(run, t)))
        on()
        for (const r of releases) r()
        if (run.cancelled) return
        await stubIn(run, host)
      },
    })
  }

  // 3. Notes and warnings: stuck on the anchor's right side (on the fold stub when the anchor is in a hidden part).
  //    A note on a list item sticks to the whole list; a note on a region sticks to the region's box.
  for (const edit of edits) {
    if (edit.op !== 'note' && edit.op !== 'warn') continue
    const anchor = resolveId(edit.after) ?? (target.segments[0] ? state.resolve(target.segments[0]) : null)
    if (!anchor) continue
    const host = noteHost(edit, state, report)
    const placement = edit.after.startsWith('r') ? anchor : placementFor(anchor)
    push({
      op: edit.op,
      label: `${edit.op === 'warn' ? 'Heads up' : 'Note'}: ${shortLabel(edit.text)}`,
      // For ordering and scrolling: the stub when the anchor's part is already folded, else the anchor itself.
      target: () => {
        const a = visibleAnchor(placement, state)
        return a.isConnected ? a : placement
      },
      on: () => pinNote(host, () => visibleAnchor(placement, state), state),
      off: () => host.remove(),
      play: async (run, on) => {
        on()
        await noteIn(run, host)
      },
    })
  }

  // 4. Badges: a tag inside the card's title (or the element itself).
  for (const edit of edits) {
    if (edit.op !== 'badge') continue
    const element = resolveId(edit.id)
    if (!element) continue
    const host = badgeHost('For you', edit.label, edit.factIds, state, report)
    push({
      op: 'badge',
      label: `Tagging: ${shortLabel(edit.label)}`,
      target: () => element,
      on: () => badgeSlot(element).append(host),
      off: () => host.remove(),
      play: async (run, on) => {
        on()
        await badgeIn(run, host)
      },
    })
  }

  window.addEventListener('pagehide', state.onPageHide)
  startWatching(state)
  states.set(ui.root, state)
  if (show) showInPlace(ui)
  return state.applied.length
}

/** Sticks the site's reply on the page's first segment (the headline), or on the top of the body. */
export function appendFromSiteInPlace(ui: TailorUi, text: string, siteUrl: string): HTMLElement | null {
  const state = states.get(ui.root)
  if (!state) return null
  const first = state.bySegment.values().next().value as PageSegment | undefined
  const anchor = first ? state.resolve(first) : null
  const host = fromSiteHost(text, siteUrl)
  const placement = anchor ? placementFor(anchor) : document.body
  const applied: Applied = {
    step: {
      op: 'from_site',
      label: `From ${displayHost(siteUrl)}`,
      target: () => (placement === document.body ? null : visibleAnchor(placement, state)),
      on: () => pinNote(host, () => visibleAnchor(placement, state), state),
      off: () => host.remove(),
      play: async (run, on) => {
        on()
        await noteIn(run, host)
      },
    },
    active: false,
  }
  state.applied.push(applied)
  if (state.run) turnOn(applied) // a playback is running: the reply joins the page at once, the run plays on
  else if (state.shown) void playOne(state, applied)
  else showInPlace(ui)
  return host
}

/** Plays one late change (the site's reply) on a shown page with its own short run. */
async function playOne(state: InPlaceState, applied: Applied): Promise<void> {
  const run = startRun()
  state.run = run
  try {
    await applied.step.play(run, () => turnOn(applied, run))
  } finally {
    if (state.run === run) state.run = null
    finishRun(run)
  }
}

/**
 * Applies every change at once (idempotent) and starts the dwell timer. A playback in progress is cut short: what it
 * had not reached yet lands now. No-op before anything was applied.
 */
export function showInPlace(ui: TailorUi): void {
  const state = states.get(ui.root)
  if (!state) return
  if (state.run) cancelRun(state.run)
  state.run = null
  for (const a of state.applied) turnOn(a)
  state.shown = true
  if (state.dwellStart === null) state.dwellStart = Date.now()
}

/** Puts every original node back (idempotent), stops any playback, and reports dwell. The changes stay remembered for an instant re-show. */
export function hideInPlace(ui: TailorUi): void {
  const state = states.get(ui.root)
  if (!state) return
  if (state.run) cancelRun(state.run)
  state.run = null
  for (const a of [...state.applied].reverse()) turnOff(a)
  state.shown = false
  stopDwell(ui, state)
}

export interface PlayOptions {
  /** Called as each change starts, with its one-line label and its place in the sequence (for the bar). */
  onStep?: (label: string, index: number, total: number) => void
  /** Steer the window to each change (default true). Off when the caller keeps the viewport, and in tests. */
  scroll?: boolean
  /** Multiplier on every duration (default 1). 0 plays everything at once, still in order (tests). */
  pace?: number
}

/**
 * Plays the applied changes instead of showing them at once (demo mode): the window goes to the top, promotes fly to
 * their new spot, then everything else plays top to bottom, each change brought on screen first and changes already
 * on screen cascading a beat apart. Resolves with whether the tailored view is on screen when it ends: true after a
 * full run, true when showInPlace cut it short, false when hideInPlace (Original) stopped it. A reader who scrolls
 * by hand keeps control of the viewport; the changes still play.
 */
export async function playInPlace(ui: TailorUi, opts: PlayOptions = {}): Promise<boolean> {
  const state = states.get(ui.root)
  if (!state) return false
  if (state.shown && !state.run) return true
  if (state.run) cancelRun(state.run)
  const run = startRun(opts.pace ?? 1)
  state.run = run
  state.shown = true
  if (state.dwellStart === null) state.dwellStart = Date.now()
  const scroll = opts.scroll !== false
  const total = state.applied.length
  let index = 0
  const play = async (a: Applied): Promise<void> => {
    if (run.cancelled || a.active) return
    opts.onStep?.(a.step.label, index++, total)
    await a.step.play(run, () => turnOn(a, run))
  }
  try {
    if (scroll) await scrollWindowTo(run, 0)
    for (const a of state.applied.filter((x) => x.step.op === 'promote')) {
      if (run.cancelled) break
      if (scroll) await bringOnScreen(run, a.step.target())
      await play(a)
      await pause(run, MOTION.stepGap)
    }
    const queue = byDocumentOrder(
      state.applied.filter((x) => x.step.op !== 'promote'),
      (a) => a.step.target(),
    )
    while (queue.length && !run.cancelled) {
      const first = queue.shift()!
      if (scroll) await bringOnScreen(run, first.step.target())
      const group = [first]
      while (queue.length && group.length < 6 && (!scroll || onScreen(queue[0]!.step.target()))) group.push(queue.shift()!)
      await Promise.all(group.map((a, i) => pause(run, i * MOTION.cascade).then(() => play(a))))
      await pause(run, MOTION.stepGap)
    }
    return state.shown
  } finally {
    if (state.run === run) state.run = null
    finishRun(run)
  }
}

/**
 * The elements a tailored page marks for this person, in edit order: promote targets, badge targets, note / warn
 * anchors. The scorecard measures where they sit before and after the edits (src/render/scorecard.ts).
 */
export function markedElements(page: TailoredPage, target: InPlaceTarget): Element[] {
  const bySegment = new Map(target.segments.map((s) => [s.id, s]))
  const resolveId = (id: string): Element | null => {
    if (isMapId(id)) return target.resolveRegion?.(id) ?? null
    const seg = bySegment.get(id)
    return seg ? target.resolve(seg) : null
  }
  const out: Element[] = []
  for (const e of page.edits ?? []) {
    const id = e.op === 'promote' || e.op === 'badge' ? e.id : e.op === 'note' || e.op === 'warn' ? e.after : null
    if (!id) continue
    const element = resolveId(id)
    if (element && !out.includes(element)) out.push(element)
  }
  return out
}
