/**
 * Outside advertising, decided by code (CONTEXT.txt §0: the model proposes, code decides). An outside ad is an
 * ad-network slot, a sponsored unit, a paid placement for another company. The content script marks their ids
 * (PageContent.adIds) so the prompt can name them in a hide without mistaking them for the site's own words. Nothing on
 * a page is ever removed (4008148): a hide moves the part below what matters, an outside ad included; the site's own
 * words (its news, its newsletter pitch, its testimonials, its membership offer, promos for its own products) move down
 * the same way when they matter less to this person.
 *
 * Three signals, all from the DOM, found bottom-up so a small page never counts as one big ad:
 * - ad markup on the element or an ancestor (adsbygoogle, Ad Manager ids, ad/sponsored class tokens, data-ad-*);
 * - an ad-network iframe: its slot is the wrapper around it (empty wrappers and a caption like "Advertisement");
 * - an ad label ("Sponsored", "Advertisement", "Paid partnership", ...): its unit is the small block around it.
 * The walk never passes <main>, <body> or <html>: a page is never an ad.
 *
 * Runs in the CONTENT SCRIPT and in jsdom (eval). No fetching, no model calls.
 */
import type { PageRegion } from '@/types'

/** Markup that ad networks and ad managers leave behind. Class and id tokens match whole, not as substrings. */
export const AD_SELECTOR = [
  'ins.adsbygoogle',
  '[id^="div-gpt-ad"]',
  '[id^="google_ads"]',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[data-ad-client]',
  '[data-google-query-id]',
  '[data-adunit]',
  '[data-ad-name]',
  '[class~="ad"]',
  '[class~="ads"]',
  '[class~="advert"]',
  '[class~="advertisement"]',
  '[class~="advertising"]',
  '[class~="ad-slot"]',
  '[class~="ad-unit"]',
  '[class~="ad-container"]',
  '[class~="ad-wrapper"]',
  '[class~="ad-banner"]',
  '[class~="adsbygoogle"]',
  '[id="ad"]',
  '[id^="ad-"]',
  '[id^="ad_"]',
  '[id$="-ad"]',
  '[id$="_ad"]',
  '[class~="sponsored"]',
  '[class~="sponsored-content"]',
  '[data-sponsored]',
  '[aria-label="Advertisement" i]',
  '[aria-label="Sponsored" i]',
  '[id*="taboola" i]',
  '[class*="taboola" i]',
  '[id*="outbrain" i]',
  '[class*="outbrain" i]',
  '[class*="mgid" i]',
].join(', ')

/** Ad-network hosts. An iframe from one of these marks the slot it sits in. */
export const AD_IFRAME_HOSTS: readonly string[] = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  '2mdn.net',
  'adnxs.com',
  'amazon-adsystem.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'adsrvr.org',
  'media.net',
  'moatads.com',
  'adform.net',
  'smartadserver.com',
  'teads.tv',
  'yieldmo.com',
  'sharethrough.com',
  'mgid.com',
  'revcontent.com',
  'casalemedia.com',
  'indexww.com',
  'advertising.com',
]

/** The short labels a page prints on an outside ad. Matched against an element's whole text. */
export const AD_LABEL_RE =
  /^(?:ad|ads|advertisement|advertising|advertisement feature|sponsored|sponsored (?:content|post|link|links|listing|result|results|story|stories)|sponsored by .{1,60}|paid (?:partnership|promotion|post|content)|presented by .{1,60}|promoted|promoted by .{1,60}|partner content)$/i

/** A labeled ad is a slot or a card, not a page: its text stays under this. */
export const MAX_LABELED_AD_CHARS = 600
/** A label is a word or two. */
const MAX_LABEL_CHARS = 40

const TEXT_NODE = 3
const STOP_TAGS = new Set(['main', 'body', 'html'])
const NON_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template'])

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const isStop = (el: Element): boolean => STOP_TAGS.has(el.tagName.toLowerCase())

function matchesAdMarkup(el: Element): boolean {
  try {
    return el.matches(AD_SELECTOR)
  } catch {
    return false
  }
}

/** True for an <iframe> served by an ad network (by host) or placed by Google Ad Manager (by id). */
export function isAdIframe(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'iframe') return false
  if (/^google_ads_iframe/i.test(el.getAttribute('id') ?? '')) return true
  const src = el.getAttribute('src') || el.getAttribute('data-src') || ''
  if (!src) return false
  let host: string
  try {
    host = new URL(src, 'https://page.invalid/').hostname.toLowerCase()
  } catch {
    return false
  }
  return AD_IFRAME_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

function containsAdIframe(el: Element): boolean {
  for (const f of Array.from(el.querySelectorAll('iframe'))) if (isAdIframe(f)) return true
  return false
}

/** Elements whose own text is an ad label: the text nodes that match, by their parent element. */
function labelElements(doc: Document): Element[] {
  const out: Element[] = []
  const root = doc.body
  if (!root) return out
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== TEXT_NODE) continue
    const value = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    if (!value || value.length > MAX_LABEL_CHARS || !AD_LABEL_RE.test(value)) continue
    const parent = node.parentElement
    if (!parent || NON_TEXT_TAGS.has(parent.tagName.toLowerCase()) || parent.tagName.toLowerCase().startsWith('tailor-')) continue
    // The label is the element's whole text, not a word inside a sentence.
    if (textOf(parent) === value) out.push(parent)
  }
  return out
}

export interface AdFinder {
  /** The outside-ad unit `el` belongs to (itself or an ancestor), or null when `el` is the site's own content. */
  adContainerOf(el: Element): Element | null
  isOutsideAd(el: Element): boolean
}

/**
 * Finds the page's ad units once (iframe slots and labeled units, bottom-up), then answers per element by walking
 * up to the nearest unit or ad markup. Build one per page; answers are memoized.
 */
export function createAdFinder(doc: Document): AdFinder {
  const units = new Set<Element>()

  // An ad-network iframe's slot: up through empty wrappers, taking a caption that is an ad label, stopping at content.
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    if (!isAdIframe(frame)) continue
    let slot: Element = frame
    for (let n = frame.parentElement; n && !isStop(n); n = n.parentElement) {
      const text = textOf(n)
      if (text.length === 0) {
        slot = n
        continue
      }
      if (text.length <= MAX_LABEL_CHARS && AD_LABEL_RE.test(text)) slot = n
      break
    }
    units.add(slot)
  }

  // A labeled unit: the nearest block around the label that holds more than the label, and not more than a card.
  for (const label of labelElements(doc)) {
    const labelLen = textOf(label).length
    for (let n = label.parentElement; n && !isStop(n); n = n.parentElement) {
      if (matchesAdMarkup(n)) {
        units.add(n)
        break
      }
      const len = textOf(n).length
      if (len > MAX_LABELED_AD_CHARS) break
      if (len > labelLen || containsAdIframe(n)) {
        units.add(n)
        break
      }
    }
  }

  const memo = new Map<Element, Element | null>()
  const adContainerOf = (el: Element): Element | null => {
    const known = memo.get(el)
    if (known !== undefined) return known
    let found: Element | null = null
    for (let n: Element | null = el; n && !isStop(n); n = n.parentElement) {
      if (units.has(n) || matchesAdMarkup(n)) {
        found = n
        break
      }
    }
    memo.set(el, found)
    return found
  }
  return { adContainerOf, isOutsideAd: (el) => adContainerOf(el) !== null }
}

/** One-off: the outside-ad unit `el` belongs to, or null. Builds a finder for the element's document. */
export function adContainerOf(el: Element): Element | null {
  return createAdFinder(el.ownerDocument).adContainerOf(el)
}

/** One-off: true when `el` is, or sits inside, an outside ad. The renderer asks this before it folds anything. */
export function isOutsideAd(el: Element): boolean {
  return adContainerOf(el) !== null
}

/**
 * Every id (s#, r#, i#) that is an outside ad, in map order then segment order. A region that is an ad takes its items
 * and segments with it; an item that is an ad takes its segments. They move down like anything else a hide names.
 */
export function outsideAdIds(doc: Document, segments: Map<string, Element>, regionElements: Map<string, Element>, regions: PageRegion[]): string[] {
  const finder = createAdFinder(doc)
  const out = new Set<string>()
  for (const r of regions) {
    const el = regionElements.get(r.id)
    const labeled = AD_LABEL_RE.test(r.title.replace(/\s+/g, ' ').trim())
    if (labeled || (el && finder.isOutsideAd(el))) {
      out.add(r.id)
      for (const i of r.items ?? []) {
        out.add(i.id)
        for (const s of i.segmentIds) out.add(s)
      }
      for (const s of r.segmentIds) out.add(s)
      continue
    }
    for (const i of r.items ?? []) {
      const card = regionElements.get(i.id)
      if (card && finder.isOutsideAd(card)) {
        out.add(i.id)
        for (const s of i.segmentIds) out.add(s)
      }
    }
  }
  for (const [id, el] of segments) {
    if (!out.has(id) && finder.isOutsideAd(el)) out.add(id)
  }
  return [...out]
}
