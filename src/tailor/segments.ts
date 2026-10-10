/**
 * Page segmentation for in-place tailoring (CONTEXT.txt §3.5 step 1, §3.7). Runs in the CONTENT SCRIPT (page origin)
 * and in jsdom (eval). No fetching, no model calls. Everything returned is untrusted website text.
 *
 * A segment is one editable text element of the live page: a heading, paragraph, list item, table cell, quote,
 * caption, or a <div> that holds only inline content (Tailwind-style sites). Ids are `s1`, `s2`, ... in document
 * order. The model gets {id, tag, text}; the content script keeps the id → Element map and applies edits to it.
 *
 * What is skipped, in code: navigation, footers, anything aria-hidden, our own <tailor-*> hosts, code, forms' labels,
 * invisible elements, and very short labels. An element that contains another candidate (an <li> wrapping a <p>) is
 * not a segment itself: the inner element is, so a rewrite never flattens nested markup.
 */
import type { PageSegment } from '@/types'

/** Tags whose text we are willing to rewrite in place. */
const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'figcaption', 'dt', 'dd', 'td', 'th', 'summary']
const TEXT_SELECTOR = TEXT_TAGS.join(',')
const CANDIDATE_SELECTOR = `${TEXT_SELECTOR},div`

/**
 * Links and buttons. An element whose text is all inside these (a CTA row, "Sign in · Get a demo", a list of links)
 * is a control group, not prose: a rewrite would replace its children with one text node and the links would be gone.
 */
const CONTROL_SELECTOR = 'a, button, [role="button"], [role="link"], input, select, textarea'

/** Inside these, nothing is a segment. */
const SKIP_SELECTOR =
  'nav, footer, header nav, [role="navigation"], [role="contentinfo"], [role="menu"], [role="menubar"], [role="tablist"], ' +
  '[aria-hidden="true"], script, style, noscript, template, svg, math, pre, code, kbd, samp, textarea, select, option, ' +
  'button, label, [contenteditable="true"], tailor-ext, tailor-note, tailor-fold, tailor-why'

/** Elements that start a new line in rendered text. A <div> with any of these as a child is a container, not a text leaf. */
const BLOCK_TAGS_SELECTOR =
  ':is(address, article, aside, blockquote, details, dialog, div, dl, fieldset, figure, footer, form, ' +
  'h1, h2, h3, h4, h5, h6, header, hr, main, menu, nav, ol, p, pre, section, table, ul, video, iframe, canvas)'
const BLOCK_CHILD_SELECTOR = `:scope > ${BLOCK_TAGS_SELECTOR}`

// Node type constants by value: the eval harness runs this in Node, where the `Node` global does not exist.
const TEXT_NODE = 3
const ELEMENT_NODE = 1

export const MIN_HEADING_CHARS = 2
export const MIN_TEXT_CHARS = 8
export const MAX_SEGMENT_CHARS = 1_500
export const MAX_SEGMENTS = 220

export interface SegmentedPage {
  segments: PageSegment[]
  /** id → the live element. Content script only; never serialized. */
  elements: Map<string, Element>
}

const isHeading = (tag: string): boolean => /^h[1-6]$/.test(tag)

/**
 * Visible-ish check that works in Chrome and in jsdom (no layout there). Chrome: Element.checkVisibility with CSS
 * visibility. jsdom: hidden attribute or inline display/visibility only. Opacity 0 counts as visible (text animations).
 */
export function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  const check = (el as Element & { checkVisibility?: (o?: { checkVisibilityCSS?: boolean }) => boolean }).checkVisibility
  if (typeof check === 'function') return check.call(el, { checkVisibilityCSS: true })
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = (node as HTMLElement).style
    if (!style) continue
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/**
 * The text a reader sees in one element: text nodes only, skipping aria-hidden subtrees (coframe.com animates each
 * word in aria-hidden spans and keeps the real copy in a screen-reader span), scripts, styles and our own hosts.
 * Falls back to the full text when everything inside is aria-hidden (icon-font style sites).
 */
export function segmentText(el: Element): string {
  const seen = collectText(el, true).trim()
  const text = seen || collectText(el, false)
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_CHARS)
}

function collectText(el: Element, skipAriaHidden: boolean): string {
  let out = ''
  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      out += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== ELEMENT_NODE) return
    const e = node as Element
    const tag = e.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag.startsWith('tailor-')) return
    if (skipAriaHidden && e.getAttribute('aria-hidden') === 'true') return
    if (tag === 'br') out += ' '
    for (const child of Array.from(e.childNodes)) walk(child)
    if (e.matches(BLOCK_TAGS_SELECTOR)) out += ' '
  }
  walk(el)
  return out
}

/**
 * True when what is left of the element's text outside its links and buttons is too short to be worth editing:
 * the element IS its controls. A paragraph that merely contains a link is prose and stays editable.
 */
export function isControlGroup(el: Element): boolean {
  if (!el.querySelector(CONTROL_SELECTOR)) return false
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll(CONTROL_SELECTOR).forEach((c) => c.remove())
  return segmentText(clone).length < MIN_TEXT_CHARS
}

/** True when `el` should be a segment: a visible text leaf outside skipped regions, long enough to matter. */
function qualifies(el: Element, tag: string): boolean {
  if (el.closest(SKIP_SELECTOR)) return false
  if (tag === 'div') {
    if (el.querySelector(BLOCK_CHILD_SELECTOR)) return false
  }
  // Not a leaf: an inner candidate will be the segment instead.
  if (el.querySelector(TEXT_SELECTOR)) return false
  if (tag === 'div' && el.closest(TEXT_SELECTOR)) return false // a div inside a <li> or <td>: the li/td is the segment
  if (isControlGroup(el)) return false
  if (!isVisible(el)) return false
  return true
}

/** Every segment of the page, in document order, with its live element. */
export function collectSegments(doc: Document): SegmentedPage {
  const segments: PageSegment[] = []
  const elements = new Map<string, Element>()
  const root = doc.body
  if (!root) return { segments, elements }
  for (const el of Array.from(root.querySelectorAll(CANDIDATE_SELECTOR))) {
    if (segments.length >= MAX_SEGMENTS) break
    const tag = el.tagName.toLowerCase()
    if (!qualifies(el, tag)) continue
    const text = segmentText(el)
    if (text.length < (isHeading(tag) ? MIN_HEADING_CHARS : MIN_TEXT_CHARS)) continue
    const id = `s${segments.length + 1}`
    segments.push({ id, tag, text })
    elements.set(id, el)
  }
  return { segments, elements }
}

/**
 * Finds the live element for a segment of an earlier extraction: the remembered element when it is still in the
 * document, else a fresh element with the same tag and text (SPAs re-render). Null when the text is gone.
 */
export function resolveSegment(doc: Document, segment: PageSegment, remembered: Element | undefined): Element | null {
  if (remembered?.isConnected) return remembered
  for (const el of Array.from(doc.body?.querySelectorAll(segment.tag) ?? [])) {
    if (el.closest(SKIP_SELECTOR)) continue
    if (segmentText(el) === segment.text) return el
  }
  return null
}
