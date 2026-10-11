/**
 * Live playback of in-place edits (demo mode, CONTEXT.txt §3.7, §9). Owner: Petr.
 *
 * The page rebuilds itself in front of the audience: one change at a time, top to bottom, each with its own motion,
 * while the window scrolls to keep the change on screen. The window goes only where a change is: never a pass over the
 * page first (on a long storefront that is a dash to the bottom and back). This file holds the primitives; inplace.ts composes them per
 * edit op (what a change DOES lives there, how it MOVES lives here).
 *
 * Every motion is a Web Animations API animation on the element itself, never an inline style: cancelling an animation
 * returns the element to its stylesheet state, so Original ↔ Tailored and a cancelled run leave nothing behind. A Run
 * owns its animations and cancels them all at once. Without WAAPI (jsdom) every motion resolves at once and the
 * sequence still applies every change in order. Reduced motion (OS setting) plays every motion at zero length.
 */

export interface Run {
  /** Set by cancelRun: every await in a play() returns early after this and `on` becomes a no-op. */
  cancelled: boolean
  /** The user scrolled by hand during the run: stop steering the viewport, keep applying. */
  userScrolled: boolean
  /** Whether a step may move the window at all (demo scroll on). Off when the caller keeps the viewport, and in tests. */
  steer: boolean
  /** Multiplier on every duration. 0 plays every step at once, still in order (tests). */
  pace: number
  animations: Set<Animation>
  cleanups: Array<() => void>
}

const BRAND = '90,82,236' // the "why" indigo (#5a52ec), the one colour we add to a page
export const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)'
export const EASE_IN_OUT = 'cubic-bezier(.4,0,.2,1)'
/** Overshoot a touch, then settle: a note pressed onto the page. */
const EASE_SLAP = 'cubic-bezier(.34,1.56,.64,1)'

/** Durations (ms) at pace 1. */
export const MOTION = {
  dim: 160,
  /** Typing: slow enough to watch the words appear (a headline takes about a second and a half). */
  typeMin: 600,
  typeMax: 2800,
  typePerChar: 30,
  /** Backspacing the old text away before the new one types in: quick, a few tenths of a second. */
  eraseMin: 200,
  eraseMax: 450,
  erasePerChar: 6,
  glowTail: 260,
  flip: 650,
  /** The halo on a moved-down part once the window has followed it to where it landed: "still here, just lower". */
  land: 760,
  noteIn: 440,
  badgeIn: 380,
  /** Breath between two changes. */
  stepGap: 160,
  /** Changes already on screen start this far apart. */
  cascade: 170,
  /** Backstop for a smooth scroll that never settles; the real wait follows the distance (see scrollWindowTo). */
  scrollCap: 2400,
}

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Keys that scroll a page: a press during a run means the reader took the wheel. */
const SCROLL_KEYS = new Set([' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])

/** Starts a run and watches for the reader scrolling by hand. finishRun removes the listeners. */
export function startRun(pace = 1): Run {
  const run: Run = { cancelled: false, userScrolled: false, steer: true, pace: reducedMotion() ? 0 : pace, animations: new Set(), cleanups: [] }
  if (typeof window !== 'undefined') {
    const took = (): void => {
      run.userScrolled = true
    }
    const onKey = (e: KeyboardEvent): void => {
      if (SCROLL_KEYS.has(e.key)) took()
    }
    const opts = { passive: true, capture: true } as const
    window.addEventListener('wheel', took, opts)
    window.addEventListener('touchmove', took, opts)
    window.addEventListener('keydown', onKey, opts)
    run.cleanups.push(() => {
      window.removeEventListener('wheel', took, opts)
      window.removeEventListener('touchmove', took, opts)
      window.removeEventListener('keydown', onKey, opts)
    })
  }
  return run
}

/** Stops a run: every motion is cancelled (elements snap back to their stylesheet state) and no step applies after this. */
export function cancelRun(run: Run): void {
  run.cancelled = true
  finishRun(run)
}

/** Releases what a run holds: listeners and any animation still alive (finished ones are harmless to cancel). */
export function finishRun(run: Run): void {
  for (const a of run.animations) a.cancel()
  run.animations.clear()
  for (const c of run.cleanups.splice(0)) c()
}

export const dur = (run: Run, ms: number): number => Math.round(ms * run.pace)

export function pause(run: Run, ms: number): Promise<void> {
  if (run.cancelled) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, dur(run, ms)))
}

const canAnimate = (el: Element): el is Element & { animate: Element['animate'] } => typeof (el as { animate?: unknown }).animate === 'function'

/**
 * Plays keyframes on an element and resolves when they finish (or at once when the run is cancelled or WAAPI is
 * absent). `duration` is in pace-1 ms. Resolves with a release function for fill:forwards animations: call it once the
 * DOM has caught up (e.g. after the new text is in), so the element returns to its stylesheet state.
 */
export function animate(run: Run, el: Element, keyframes: Keyframe[], duration: number, extra: KeyframeAnimationOptions = {}): Promise<() => void> {
  if (run.cancelled || !canAnimate(el)) return Promise.resolve(() => {})
  const a = el.animate(keyframes, { duration: dur(run, duration), easing: EASE_OUT, ...extra })
  run.animations.add(a)
  const release = (): void => {
    run.animations.delete(a)
    a.cancel()
  }
  return new Promise((resolve) => {
    a.finished.then(
      () => {
        if (extra.fill !== 'forwards' && extra.fill !== 'both') run.animations.delete(a)
        resolve(release)
      },
      () => resolve(release), // cancelled: nothing left to release
    )
  })
}

/** Pins a state (e.g. opacity 0) on an element until released, without touching its inline styles. */
export function hold(run: Run, el: Element, frame: Keyframe): () => void {
  if (run.cancelled || !canAnimate(el)) return () => {}
  const a = el.animate([frame, frame], { duration: 1, fill: 'both' })
  run.animations.add(a)
  return () => {
    run.animations.delete(a)
    a.cancel()
  }
}

// ───────────────────────────── motions ─────────────────────────────

/** Fades an element almost out and keeps it there; resolves with the release. The old text goes quiet before the new one types in. */
export function dim(run: Run, el: Element): Promise<() => void> {
  return animate(run, el, [{ opacity: 1 }, { opacity: 0.12 }], MOTION.dim, { fill: 'forwards' })
}

/** A soft indigo halo that rises and fades: "this is the one being changed". */
export function glow(run: Run, el: Element, duration: number): Promise<() => void> {
  return animate(
    run,
    el,
    [
      { boxShadow: `0 0 0 0 rgba(${BRAND},0)` },
      { boxShadow: `0 0 0 3px rgba(${BRAND},.45)`, offset: 0.25 },
      { boxShadow: `0 0 0 0 rgba(${BRAND},0)` },
    ],
    duration,
    { easing: EASE_IN_OUT },
  )
}

/** How long typing `text` takes at pace 1: slow enough to watch a headline being written, capped for a paragraph. */
export const typeDuration = (text: string): number => Math.min(MOTION.typeMax, Math.max(MOTION.typeMin, text.length * MOTION.typePerChar))

/** How long backspacing `text` away takes at pace 1. */
export const eraseDuration = (text: string): number => Math.min(MOTION.eraseMax, Math.max(MOTION.eraseMin, text.length * MOTION.erasePerChar))

/** The caret shown at the end of text being typed or erased, in the site's own font. Gone once the text is complete. */
export const CARET = '|'

const nextFrame = (): Promise<number> =>
  new Promise((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(resolve) : setTimeout(() => resolve(performance.now()), 16)))

/**
 * Types `text` into a text node over `duration` pace-1 ms, a caret at the end of what is typed so far. Leaves the full
 * text (no caret) in place however it ends.
 */
export async function typewrite(run: Run, node: Text, text: string, duration: number): Promise<void> {
  const total = dur(run, duration)
  if (total <= 0 || text.length === 0) {
    node.data = text
    return
  }
  node.data = CARET
  const start = performance.now()
  for (;;) {
    const t = await nextFrame()
    if (run.cancelled) break
    const progress = Math.min(1, (t - start) / total)
    if (progress >= 1) break
    node.data = text.slice(0, Math.ceil(progress * text.length)) + CARET
  }
  node.data = text
}

/**
 * Backspaces `from` out of a text node over `duration` pace-1 ms (the caret eats the text from its end), so a rewrite
 * reads as the old line being retyped, never as a swap. Sets the node to `from` at once, before the first frame, so
 * the element never shows the new text early. Leaves the node empty however it ends.
 */
export async function erase(run: Run, node: Text, from: string, duration: number): Promise<void> {
  node.data = from
  const total = dur(run, duration)
  if (total <= 0 || from.length === 0) {
    node.data = ''
    return
  }
  const start = performance.now()
  for (;;) {
    const t = await nextFrame()
    if (run.cancelled) break
    const progress = Math.min(1, (t - start) / total)
    if (progress >= 1) break
    node.data = from.slice(0, Math.floor((1 - progress) * from.length)) + CARET
  }
  node.data = ''
}

/** A sticky note pressed onto the page: fades in while it comes down from a little above, a size up, and settles. */
export function noteIn(run: Run, host: HTMLElement): Promise<void> {
  const sticky = host.shadowRoot?.querySelector('.sticky')
  const motions = [animate(run, host, [{ opacity: 0 }, { opacity: 1 }], MOTION.noteIn * 0.6)]
  if (sticky) {
    motions.push(animate(run, sticky, [{ scale: '1.18', translate: '0 -14px' }, { scale: '1', translate: '0 0' }], MOTION.noteIn, { easing: EASE_SLAP }))
  }
  return Promise.all(motions).then(() => {})
}

/** A badge pops into a card's title. */
export function badgeIn(run: Run, host: Element): Promise<() => void> {
  return animate(run, host, [{ opacity: 0, scale: '0.5' }, { opacity: 1, scale: '1.1', offset: 0.7 }, { opacity: 1, scale: '1' }], MOTION.badgeIn, { easing: EASE_OUT })
}

/**
 * FLIP: records where `scope` sits, runs `move` (which changes the DOM), then slides every element that moved from its
 * old spot to its new one. A promoted card flies to the front of its list; the cards it passes slide out of the way.
 */
export async function flip(run: Run, scope: Element[], move: () => void): Promise<void> {
  if (run.cancelled) return
  const before = new Map(scope.map((e) => [e, e.getBoundingClientRect()] as const))
  move()
  const motions: Promise<unknown>[] = []
  for (const e of scope) {
    const b = before.get(e)
    if (!b || !e.isConnected) continue
    const a = e.getBoundingClientRect()
    if (a.width === 0 && a.height === 0) continue
    const dx = b.left - a.left
    const dy = b.top - a.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    motions.push(animate(run, e, [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], MOTION.flip, { easing: EASE_OUT }))
  }
  await Promise.all(motions)
}

/** The siblings a move can displace: the element, everything beside it now, everything beside where it lands. */
export function flipScope(element: Element, destinationParent: Element | null, cap = 120): Element[] {
  const out = new Set<Element>([element])
  for (const parent of [element.parentElement, destinationParent]) {
    if (!parent) continue
    for (const child of Array.from(parent.children)) {
      if (child.tagName.toLowerCase().startsWith('tailor-')) continue
      out.add(child)
      if (out.size >= cap) return [...out]
    }
  }
  return [...out]
}

// ───────────────────────────── scrolling ─────────────────────────────

/** Is this element on screen where the eye already is (not hugging an edge)? */
export function onScreen(el: Element | null): boolean {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const vh = window.innerHeight || document.documentElement.clientHeight || 900
  return r.top >= vh * 0.06 && r.top <= vh * 0.6 && (r.bottom <= vh * 0.92 || r.height > vh * 0.5)
}

/** Smooth-scrolls the window and waits until it has settled (or the cap). Does nothing once the reader took the wheel. */
export function scrollWindowTo(run: Run, top: number): Promise<void> {
  if (run.cancelled || run.userScrolled) return Promise.resolve()
  if (typeof window.scrollTo !== 'function') return Promise.resolve()
  const se = document.scrollingElement
  if (!se || se.scrollHeight <= se.clientHeight + 1) return Promise.resolve()
  const max = se.scrollHeight - se.clientHeight
  const to = Math.max(0, Math.min(Math.round(top), max))
  const from = window.scrollY
  if (Math.abs(to - from) < 24) return Promise.resolve()
  if (run.pace === 0) {
    window.scrollTo({ top: to })
    return Promise.resolve()
  }
  window.scrollTo({ top: to, behavior: 'smooth' })
  return new Promise((resolve) => {
    // Chrome's smooth programmatic scroll runs about sqrt(px) / 60 s (1000 px ~ 0.5 s, 8000 px ~ 1.5 s); wait that long
    // plus a margin before giving up, so a change never starts before the window has arrived.
    const cap = Math.min(MOTION.scrollCap, 250 + Math.sqrt(Math.abs(to - from)) * 17)
    const start = performance.now()
    let last = from
    let still = 0
    const tick = (): void => {
      if (run.cancelled) return resolve()
      const y = window.scrollY
      if (Math.abs(y - to) < 2 || performance.now() - start > cap) return resolve()
      still = Math.abs(y - last) < 1 ? still + 1 : 0
      last = y
      if (still >= 4 && performance.now() - start > 120) return resolve() // stuck (the page cannot scroll that far)
      void nextFrame().then(tick)
    }
    void nextFrame().then(tick)
  })
}

/** Passes bringOnScreen makes at most: the first scroll, then re-aims after the page shifted under it. */
const AIM_PASSES = 3

/**
 * Brings a change's element on screen: its top sits a bit above the middle, so the change happens where the eye is.
 * The window goes only to the element itself, and checks that it got there: on a long storefront, sections lazy-load
 * while the window travels and push the target further down, so a scroll aimed at where it WAS lands on some other
 * section with the change playing off screen. After each scroll settles the element is measured again and the window
 * re-aims, up to a few passes. A reader who took the wheel is never steered.
 */
export async function bringOnScreen(run: Run, el: Element | null): Promise<void> {
  for (let pass = 0; pass < AIM_PASSES; pass++) {
    if (run.cancelled || run.userScrolled || !el || !el.isConnected || onScreen(el)) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    const vh = window.innerHeight || document.documentElement.clientHeight || 900
    const offset = r.height > vh * 0.6 ? vh * 0.1 : vh * 0.28
    const from = window.scrollY
    await scrollWindowTo(run, from + r.top - offset)
    if (run.pace === 0 || window.scrollY === from) return // nothing moved (pace 0, a page that cannot scroll, too close): no re-aim
    await nextFrame()
    await nextFrame() // what loaded during the scroll lays out before the element is measured again
  }
}

/** Steps in document order: what is higher on the page plays first. Disconnected targets go last. */
export function byDocumentOrder<T>(items: T[], target: (item: T) => Element | null): T[] {
  const pos = (el: Element | null): number => (el && el.isConnected ? 0 : 1)
  return [...items].sort((x, y) => {
    const a = target(x)
    const b = target(y)
    const pa = pos(a)
    const pb = pos(b)
    if (pa !== pb) return pa - pb
    if (!a || !b || a === b) return 0
    const rel = a.compareDocumentPosition(b)
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
}

/** "Rewriting: Four HDMI 2.1 ports support…" fits the bar. */
export function shortLabel(text: string, max = 110): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
