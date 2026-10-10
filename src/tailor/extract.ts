/**
 * Page content extraction (CONTEXT.txt §3.5 step 1). Runs in the CONTENT SCRIPT (page origin):
 * no fetching, no IndexedDB, no model calls, no keys. Kept in its own file so the content script can
 * import it without pulling the model client and IndexedDB code into the page bundle.
 *
 * Everything returned here is untrusted website text. It is data for the rewrite prompt, never instructions.
 */
import { Readability } from '@mozilla/readability'
import type { PageContent, PageLink } from '@/types'
import { readAgentHooks } from '@/share/hooks'
import { collectSegments } from './segments'

export { collectSegments, resolveSegment, segmentText } from './segments'
export type { SegmentedPage } from './segments'

/** Readability text shorter than this is treated as a failed parse; we fall back to the raw body text. */
export const MIN_READABLE_CHARS = 200
/** Cap on visible text (the gate checks against it, §3.6). */
export const MAX_VISIBLE_CHARS = 60_000
/** Cap on main-content text kept in PageContent (the rewrite prompt caps further). */
export const MAX_TEXT_CHARS = 60_000
export const MAX_LINKS = 500
export const MAX_JSON_LD = 20

/** Collapse runs of spaces/tabs and of blank lines. Keeps line breaks so lists stay readable. */
export function tidyText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Elements that start a new line in rendered text. Used only by the no-innerText fallback (jsdom / Node eval). */
const BLOCK_SELECTOR =
  'address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, ' +
  'header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul'

/**
 * Text of the visible page. In Chrome, body.innerText already skips script/style and hidden elements.
 * jsdom has no innerText, so we fall back to textContent of a clone with script/style/noscript removed and a line
 * break after each block element, so adjacent elements do not glue together ("ProductResourcesCareers").
 */
export function visibleTextOf(doc: Document): string {
  const body = doc.body
  if (!body) return ''
  const inner = (body as HTMLElement).innerText
  let text: string
  if (typeof inner === 'string' && inner.trim()) {
    text = inner
  } else {
    const clone = body.cloneNode(true) as HTMLElement
    clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove())
    clone.querySelectorAll(BLOCK_SELECTOR).forEach((n) => n.after(doc.createTextNode('\n')))
    text = clone.textContent ?? ''
  }
  return tidyText(text).slice(0, MAX_VISIBLE_CHARS)
}

/** Parsed <script type="application/ld+json"> blocks. Arrays are flattened; parse errors are ignored. */
export function readJsonLd(doc: Document): unknown[] {
  const out: unknown[] = []
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? '')
      if (Array.isArray(parsed)) out.push(...parsed)
      else if (parsed !== null && parsed !== undefined) out.push(parsed)
    } catch {
      // Broken JSON-LD is common on real sites. Skip it.
    }
    if (out.length >= MAX_JSON_LD) break
  }
  return out.slice(0, MAX_JSON_LD)
}

/** Unique http(s) links, resolved against the page URL. The gate only allows cta hrefs from this list (§3.6). */
export function readLinks(doc: Document, pageUrl: string): PageLink[] {
  const byHref = new Map<string, string>()
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const raw = a.getAttribute('href')
    if (!raw) continue
    let href: string
    try {
      const u = new URL(raw, pageUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      href = u.href
    } catch {
      continue
    }
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const seen = byHref.get(href)
    if (seen === undefined) {
      if (byHref.size >= MAX_LINKS) continue
      byHref.set(href, text)
    } else if (!seen && text) {
      byHref.set(href, text) // prefer a labeled occurrence of the same href
    }
  }
  return Array.from(byHref, ([href, text]) => ({ text, href }))
}

/** What the content script keeps: the PageContent it sends plus the live elements behind each segment (never sent). */
export interface ExtractedPage {
  content: PageContent
  elements: Map<string, Element>
}

/** Runs in the content script. Readability + JSON-LD + visible text + links + segments (+ coframe agent hooks). */
export function extractPageContent(doc: Document, url: string): PageContent {
  return extractPage(doc, url).content
}

/** extractPageContent plus the id → Element map the in-place renderer needs (§3.7). */
export function extractPage(doc: Document, url: string): ExtractedPage {
  const visibleText = visibleTextOf(doc)
  const segmented = collectSegments(doc)

  // Readability mutates the document it parses, so it always gets a clone.
  let article: ReturnType<Readability['parse']> = null
  try {
    article = new Readability(doc.cloneNode(true) as Document).parse()
  } catch {
    article = null
  }
  const readable = tidyText(article?.textContent ?? '')
  const useReadability = readable.length >= MIN_READABLE_CHARS

  const lang = doc.documentElement?.getAttribute('lang')?.trim() || article?.lang?.trim() || undefined
  const agentHooks = readAgentHooks(doc) // never throws; null when the page offers no agent hooks

  const content: PageContent = {
    url,
    title: (article?.title || doc.title || '').trim(),
    text: (useReadability ? readable : visibleText).slice(0, MAX_TEXT_CHARS),
    visibleText,
    jsonLd: readJsonLd(doc),
    links: readLinks(doc, url),
    source: useReadability ? 'readability' : 'raw',
    segments: segmented.segments,
  }
  if (agentHooks) content.agentHooks = agentHooks
  if (lang) content.lang = lang
  return { content, elements: segmented.elements }
}
