/**
 * The page map (CONTEXT.txt §3.5 step 1, storefront edition). Runs in the CONTENT SCRIPT (page origin) and in jsdom
 * (eval). No fetching, no model calls. Everything returned is untrusted website text.
 *
 * Given the site profile, the segments and their live elements, this finds the page's top-level regions, assigns each
 * a role, reads the cards inside it (title, price, detail, link) and maps every segment to its region and item.
 * Ids are `r1`, `r2`, ... and `i1`, `i2`, ... in document order. The model gets the map; the content script keeps the
 * id → Element maps and applies promote / hide / badge edits to those elements.
 */
import type { PageItem, PageRegion, PageSegment, RegionRole } from '@/types'
import { isVisible, segmentText } from '@/tailor/segments'
import type { ItemRule, SiteProfile } from './types'

export const MAX_REGIONS = 40
export const MAX_ITEMS_PER_REGION = 30
export const MAX_ITEMS = 120
export const MAX_TITLE_CHARS = 120
export const MAX_DETAIL_CHARS = 160
/** A card needs at least this much text to count (generic shape detection). */
const MIN_CARD_CHARS = 8
/** Without a heading, a shape-detected card needs this much text, or it is a link list. */
const MIN_GENERIC_CARD_CHARS = 24
/** Repeated siblings: at least this many alike children make a list of cards. */
const MIN_CARDS = 3

const HEADING_SELECTOR = 'h1, h2, h3, h4'
const CAROUSEL_CLONE_SELECTOR = '.slick-cloned, .swiper-slide-duplicate'
const PRICE_RE = /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP))/

export interface RegionMap {
  regions: PageRegion[]
  /** r# and i# → the live element. Content script only; never serialized. */
  elements: Map<string, Element>
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function textOf(el: Element | null, max: number): string {
  return el ? oneLine(segmentText(el)).slice(0, max) : ''
}

/**
 * The region's title: its top-level visible heading (an h1 before any h2, ...), first in document order among equals.
 * Document order alone picks a card's h3 or a photo caption's h5 when the real heading comes later in the markup
 * (patagonia.com puts the hero's h5 caption before its h1).
 */
function firstHeadingText(el: Element): string {
  let best = ''
  let bestLevel = Infinity
  for (const h of Array.from(el.querySelectorAll(HEADING_SELECTOR))) {
    const level = Number(h.tagName.slice(1))
    if (level >= bestLevel || !isVisible(h)) continue
    const t = textOf(h, MAX_TITLE_CHARS)
    if (!t) continue
    best = t
    bestLevel = level
    if (level === 1) break
  }
  return best
}

/** The region's title: the profile's title selector when it has one and matches, else the top-level heading. */
function regionTitle(el: Element, profile: SiteProfile): string {
  if (profile.title) {
    for (const t of queryAll(el, profile.title)) {
      if (!isVisible(t)) continue
      const text = textOf(t, MAX_TITLE_CHARS)
      if (text) return text
    }
  }
  return firstHeadingText(el)
}

function roleOf(el: Element, heading: string, profile: SiteProfile): RegionRole {
  for (const rule of profile.roles) {
    if (rule.selector) {
      try {
        if (el.matches(rule.selector) || el.querySelector(rule.selector)) return rule.role
      } catch {
        // a bad selector in a profile must never break extraction
      }
    }
    if (rule.heading && heading && rule.heading.test(heading)) return rule.role
  }
  return 'section'
}

function absoluteHref(a: Element | null, baseUrl: string): string | undefined {
  const raw = a?.getAttribute('href')
  if (!raw) return undefined
  try {
    const u = new URL(raw, baseUrl)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}

function query(el: Element, selector: string | undefined): Element | null {
  if (!selector) return null
  try {
    return el.querySelector(selector)
  } catch {
    return null
  }
}

function queryAll(el: Element, selector: string): Element[] {
  try {
    return Array.from(el.querySelectorAll(selector))
  } catch {
    return []
  }
}

/** The first class token, so "swiper-slide !flex" and "swiper-slide active" count as alike. */
const classKey = (el: Element): string => `${el.tagName}.${(el.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? ''}`

/**
 * Cards found by shape: the first element (breadth-first) with MIN_CARDS+ children that share a tag and first class,
 * where each child carries a link and some text. Used when the profile has no item rule for the region.
 */
export function repeatedCards(region: Element): Element[] {
  const queue: Element[] = [region]
  let steps = 0
  while (queue.length && steps++ < 400) {
    const el = queue.shift()!
    const children = Array.from(el.children).filter((c) => !/^(script|style|svg|template)$/i.test(c.tagName))
    if (children.length >= MIN_CARDS) {
      const key = classKey(children[0]!)
      const alike = children.filter((c) => classKey(c) === key)
      if (alike.length >= MIN_CARDS && alike.length >= children.length * 0.6) {
        const cards = alike.filter((c) => c.querySelector('a[href]') && isVisible(c) && segmentText(c).length >= MIN_CARD_CHARS)
        if (cards.length >= MIN_CARDS) return cards
      }
    }
    queue.push(...children)
  }
  return []
}

interface ReadCard {
  element: Element
  title: string
  price?: string
  wasPrice?: string
  detail?: string
  href?: string
}

function readCard(card: Element, rule: ItemRule | null, baseUrl: string): ReadCard | null {
  let title = ''
  let price: string | undefined
  let wasPrice: string | undefined
  let detail: string | undefined
  let href: string | undefined
  if (rule) {
    title = textOf(query(card, rule.title), MAX_TITLE_CHARS)
    price = priceText(query(card, rule.price))
    wasPrice = priceText(query(card, rule.wasPrice))
    detail = textOf(query(card, rule.detail), MAX_DETAIL_CHARS) || undefined
    href = absoluteHref(query(card, rule.link ?? 'a[href]'), baseUrl)
  } else {
    // Shape-detected cards (generic profile): a bare link list ("Careers", "Blog") is navigation, not cards.
    const heading = textOf(card.querySelector(HEADING_SELECTOR), MAX_TITLE_CHARS)
    const text = segmentText(card)
    if (!heading && text.length < MIN_GENERIC_CARD_CHARS) return null
    title = heading || textOf(card.querySelector('p, span, a'), MAX_TITLE_CHARS)
    const m = PRICE_RE.exec(text)
    price = m?.[0]
    href = absoluteHref(card.querySelector('a[href]'), baseUrl)
  }
  if (!title) return null
  const out: ReadCard = { element: card, title }
  if (price) out.price = price
  if (wasPrice) out.wasPrice = wasPrice
  if (detail && detail !== title) out.detail = detail
  if (href) out.href = href
  return out
}

/**
 * The price as the card shows it. Screen-reader words around the figure ("Price reduced from $37.00 to", yeti.com)
 * are dropped: the figure is the page's own, the sentence is not what the eye sees.
 */
function priceText(el: Element | null): string | undefined {
  const raw = textOf(el, 80)
  if (!raw) return undefined
  const m = PRICE_RE.exec(raw)
  return (m ? m[0] : raw.slice(0, 40)).trim()
}

function cardsOf(region: Element, role: RegionRole, profile: SiteProfile, baseUrl: string): ReadCard[] {
  const rules = profile.items.filter((r) => !r.roles || r.roles.includes(role))
  let found: ReadCard[] = []
  for (const rule of rules) {
    // Carousel clones (slick, swiper) repeat the edge cards for the loop; the real card is the one the engine may move.
    const cards = queryAll(region, rule.card).filter((c) => isVisible(c) && !c.closest(CAROUSEL_CLONE_SELECTOR))
    found = cards.map((c) => readCard(c, rule, baseUrl)).filter((c): c is ReadCard => c !== null)
    if (found.length) break
  }
  if (!found.length) found = repeatedCards(region).map((c) => readCard(c, null, baseUrl)).filter((c): c is ReadCard => c !== null)
  // Responsive duplicates (the same card once per breakpoint) collapse to the first visible one.
  const seen = new Set<string>()
  return found
    .filter((c) => {
      const key = `${c.title}|${c.href ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ITEMS_PER_REGION)
}

function contentRoot(doc: Document, profile: SiteProfile): Element {
  for (const sel of profile.contentRoot) {
    const el = query(doc.documentElement, sel)
    if (el) return el
  }
  return doc.body
}

/**
 * Builds the page map. `segments` and `elements` come from collectSegments (the id → Element map). Regions with no
 * segment and no card are dropped (spacers, trackers, empty wrappers).
 */
export function collectRegions(doc: Document, segments: PageSegment[], elements: Map<string, Element>, profile: SiteProfile, baseUrl: string): RegionMap {
  const empty: RegionMap = { regions: [], elements: new Map() }
  const root = contentRoot(doc, profile)
  if (!root) return empty
  let candidates = queryAll(root, profile.region)
  if (profile.skip) {
    const skip = profile.skip
    candidates = candidates.filter((c) => {
      try {
        return !c.matches(skip) && !c.closest(skip)
      } catch {
        return true
      }
    })
  }
  candidates = candidates.filter((c) => !/^(script|style|template|noscript|header|nav|footer)$/i.test(c.tagName) && isVisible(c))
  if (!candidates.length) return empty
  const candidateSet = new Set(candidates)

  // Segment → its region candidate (nearest ancestor that is a candidate).
  const segmentsIn = new Map<Element, PageSegment[]>()
  for (const seg of segments) {
    const el = elements.get(seg.id)
    if (!el) continue
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (candidateSet.has(node)) {
        const list = segmentsIn.get(node) ?? []
        list.push(seg)
        segmentsIn.set(node, list)
        break
      }
    }
  }

  const regions: PageRegion[] = []
  const out = new Map<string, Element>()
  let items = 0
  for (const el of candidates) {
    if (regions.length >= MAX_REGIONS) break
    const segs = segmentsIn.get(el) ?? []
    const heading = regionTitle(el, profile)
    const role = roleOf(el, heading, profile)
    const cards = items < MAX_ITEMS ? cardsOf(el, role, profile, baseUrl) : []
    if (!segs.length && !cards.length) continue
    const id = `r${regions.length + 1}`
    // A region without a heading is named by its cards (a tile row: "Down, Fleece, Fly Fish …"), else by its first text.
    const cardTitle = cards.length ? (cards.slice(0, 3).map((c) => c.title).join(', ') + (cards.length > 3 ? ' …' : '')).slice(0, MAX_TITLE_CHARS) : ''
    const region: PageRegion = { id, role, title: heading || cardTitle || segs[0]?.text.slice(0, MAX_TITLE_CHARS) || '', segmentIds: segs.map((s) => s.id) }
    if (cards.length) {
      region.items = []
      for (const card of cards) {
        if (items >= MAX_ITEMS) break
        const iid = `i${++items}`
        const inside = segs.filter((s) => {
          const sel = elements.get(s.id)
          return !!sel && card.element.contains(sel)
        })
        const item: PageItem = { id: iid, title: card.title, segmentIds: inside.map((s) => s.id) }
        if (card.price) item.price = card.price
        if (card.wasPrice) item.wasPrice = card.wasPrice
        if (card.detail) item.detail = card.detail
        if (card.href) item.href = card.href
        region.items.push(item)
        out.set(iid, card.element)
      }
    }
    regions.push(region)
    out.set(id, el)
  }
  return { regions, elements: out }
}

/** Every id the model may address in a region-aware edit: regions and items. */
export function regionIds(regions: PageRegion[]): Set<string> {
  const ids = new Set<string>()
  for (const r of regions) {
    ids.add(r.id)
    for (const i of r.items ?? []) ids.add(i.id)
  }
  return ids
}

/** The region an item belongs to, or the region itself. Null for segment ids and unknown ids. */
export function regionOf(id: string, regions: PageRegion[]): PageRegion | null {
  for (const r of regions) {
    if (r.id === id) return r
    if (r.items?.some((i) => i.id === id)) return r
  }
  return null
}

/** Compact prompt lines for the page map (edit.ts). Prices and details are the page's own words. */
export function regionPromptLines(regions: PageRegion[], maxItemsPerRegion = 24): string[] {
  const lines: string[] = []
  for (const r of regions) {
    let line = `${r.id} | ${r.role} | ${oneLine(r.title) || '(untitled)'}`
    const items = r.items ?? []
    if (items.length) {
      const shown = items.slice(0, maxItemsPerRegion).map((i) => {
        let s = `${i.id} ${oneLine(i.title)}`
        if (i.price) s += ` — ${i.price}${i.wasPrice ? ` (was ${i.wasPrice})` : ''}`
        if (i.detail) s += ` — ${oneLine(i.detail).slice(0, 90)}`
        return s
      })
      line += ` | items: ${shown.join('; ')}${items.length > maxItemsPerRegion ? `; +${items.length - maxItemsPerRegion} more` : ''}`
    } else if (r.segmentIds.length) {
      line += ` | ${r.segmentIds[0]}–${r.segmentIds[r.segmentIds.length - 1]}`
    }
    lines.push(line)
  }
  return lines
}
