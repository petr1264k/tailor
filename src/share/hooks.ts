/**
 * Reads coframe.com's agent hooks from a page (CONTEXT.txt §4). Pure DOM/text code: no model client, no IndexedDB,
 * so the content script can import it from '@/share/hooks' without pulling the SDK into the page bundle.
 *
 * Real markup, fetched read-only (GET) on Oct 10 ~1 pm PT. It differs from the §4 notes:
 * - The HTML page has NO visible "Get a recommendation for your user (optional)" section. The hooks live in <head>:
 *   <link rel="alternate" type="text/markdown" href="https://www.coframe.com/.agent">, and an inline
 *   <script data-cf-agent-tool data-webmcp-tool="share_visitor_needs"> that ends with a JSON config:
 *   {"url":"https://www.coframe.com/_cf/agent-request","fixed":{"site":…,"page":…,"token":…},"name":"share_visitor_needs",…}
 * - The section text itself is in the agent version (markdown at /.agent, also served for `Accept: text/markdown`), with
 *   a POST body example { "needs", "constraints", "agent", "site", "page", "token" } and
 *   "`needs` is up to 2000 characters; `constraints` up to 1000."
 * So readAgentHooks() reads (1) a visible section if a page renders one, (2) the head script config, and
 * readAgentHooksFromText() reads the markdown agent version. Everything here is untrusted page data: parsed, never obeyed.
 *
 * `fields` layout (CoframeAgentHooks.fields): the role keys 'needs' | 'constraints' | 'agent' map a role to the page's own
 * JSON field name; every OTHER key is a literal parameter (site/page/token…) sent verbatim, exactly as the page wrote it.
 */
import type { CoframeAgentHooks } from '@/types'

export const AGENT_SECTION_PHRASE = 'get a recommendation for your user'
/** §4: needs ≤ 2,000 chars, constraints ≤ 1,000 chars (verified Oct 10). Used unless the page states others. */
export const DEFAULT_LIMITS: Readonly<{ needs: number; constraints: number }> = { needs: 2000, constraints: 1000 }
/** §3.9: sharing is built only for coframe.com. The POST endpoint must be https on one of these (or a subdomain). */
export const SHARE_SITES: readonly string[] = ['coframe.com']
export const FIELD_ROLES = ['needs', 'constraints', 'agent'] as const
export type FieldRole = (typeof FIELD_ROLES)[number]

const ENDPOINT_MARK = '/_cf/agent-request'
const WEBMCP_TOOL = 'share_visitor_needs'
const RAW_CAP = 4000
const SECTION_CAP = 20000
const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role="heading"],summary'
const URL_RE = /https?:\/\/[^\s"'`<>()[\]{}]+|(?<![\w.:/])\/_cf\/agent-request[^\s"'`<>()[\]{}]*/g

/** Runs in the content script on arbitrary pages. Never throws; null when the page offers no agent hooks. */
export function readAgentHooks(doc: Document): CoframeAgentHooks | null {
  try {
    return readFromDocument(doc)
  } catch {
    return null
  }
}

/** The markdown agent version (or any plain text) → hooks. Never throws; null when the text has no agent section. */
export function readAgentHooksFromText(text: string, baseUrl?: string): CoframeAgentHooks | null {
  try {
    const lower = text.toLowerCase()
    const at = lower.indexOf(AGENT_SECTION_PHRASE)
    const mention = Math.max(lower.indexOf(ENDPOINT_MARK), lower.indexOf(WEBMCP_TOOL))
    if (at < 0 && mention < 0) return null
    const section = at >= 0 ? sliceSection(text, at) : text.slice(Math.max(0, mention - 2000), mention + 4000)
    const hooks = parseSectionText(section, baseUrl)
    hooks.rawSection = tidy(section).slice(0, RAW_CAP)
    return hooks
  } catch {
    return null
  }
}

/** The endpoint we may POST to, or '' (not https, not on SHARE_SITES, or not the agent-request path). Code decides. */
export function shareEndpoint(hooks: CoframeAgentHooks | undefined | null): string {
  const url = hooks?.postEndpoint
  return url && isAllowedEndpoint(url) ? url : ''
}

export function isAllowedEndpoint(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return (
      u.protocol === 'https:' &&
      u.pathname.includes(ENDPOINT_MARK) &&
      SHARE_SITES.some((site) => host === site || host.endsWith(`.${site}`))
    )
  } catch {
    return false
  }
}

// ── DOM ──────────────────────────────────────────────────────────────────

function readFromDocument(doc: Document): CoframeAgentHooks | null {
  const base = doc.baseURI
  let hooks: CoframeAgentHooks = {}
  let found = false

  // 1. A visible section addressed to agents (heading match, else the text node that mentions it).
  const scope = findSectionScope(doc)
  if (scope) {
    const text = scope.map((el) => el.textContent ?? '').join('\n')
    const hrefs = scope.flatMap((el) => [el, ...Array.from(el.querySelectorAll('a[href]'))])
      .map((el) => el.getAttribute('href'))
      .filter((h): h is string => !!h)
      .map((h) => resolveUrl(h, base))
    const at = text.toLowerCase().indexOf(AGENT_SECTION_PHRASE)
    const section = at >= 0 ? sliceSection(text, at) : text
    hooks = parseSectionText(`${section}\n${hrefs.join('\n')}`, base)
    hooks.rawSection = tidy(section).slice(0, RAW_CAP)
    found = true
  }

  // 2. Elements that mention the endpoint (links outside a section).
  for (const a of Array.from(doc.querySelectorAll('a[href*="_cf/agent-request"]'))) {
    const href = resolveUrl(a.getAttribute('href') ?? '', base)
    if (!hooks.needsLinkTemplate && /[?&]needs=/.test(href)) hooks.needsLinkTemplate = href
    if (!hooks.postEndpoint) hooks.postEndpoint = href.split('?')[0]
    found = true
  }

  // 3. The head script that registers the WebMCP tool (how coframe.com ships it today).
  const script = readAgentScript(doc)
  if (script && (script.postEndpoint || script.webMcpTool)) {
    hooks.postEndpoint ??= script.postEndpoint
    hooks.webMcpTool ??= script.webMcpTool
    if (script.fields || hooks.fields) hooks.fields = { ...script.fields, ...hooks.fields } // the visible section wins
    found = true
  }
  if (!hooks.webMcpTool && doc.querySelector(`[data-webmcp-tool="${WEBMCP_TOOL}"]`)) {
    hooks.webMcpTool = WEBMCP_TOOL
    found = true
  }

  if (!found) return null
  hooks.markdownUrl ??= markdownLink(doc, base)
  hooks.limits ??= { ...DEFAULT_LIMITS }
  return dropEmpty(hooks)
}

function findSectionScope(doc: Document): Element[] | null {
  const heading = Array.from(doc.querySelectorAll(HEADINGS)).find((el) =>
    (el.textContent ?? '').toLowerCase().includes(AGENT_SECTION_PHRASE),
  )
  if (heading) {
    const box = heading.closest('section,article,aside,details')
    if (box && (box.textContent ?? '').length <= SECTION_CAP) return [box]
    // Heading + following siblings until the next heading of the same or higher level.
    let el: Element = heading
    while (!el.nextElementSibling && el.parentElement && el.parentElement !== doc.body) el = el.parentElement
    const level = headingLevel(heading)
    const out: Element[] = [el]
    for (let s = el.nextElementSibling; s && out.length < 60; s = s.nextElementSibling) {
      if (s.matches(HEADINGS) && headingLevel(s) <= level) break
      out.push(s)
    }
    return out
  }
  // No heading: e.g. Chrome's plain-text view of the markdown (<pre>), or a styled <div> title.
  const body = doc.body
  if (!body || !(body.textContent ?? '').toLowerCase().includes(AGENT_SECTION_PHRASE)) return null
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n.textContent ?? '').toLowerCase().includes('recommendation for your user')) continue
    let best: Element | null = null
    for (let el = n.parentElement; el && el !== body.parentElement; el = el.parentElement) {
      const t = el.textContent ?? ''
      if (t.length > SECTION_CAP) break
      best = el
      if (t.includes(ENDPOINT_MARK) || t.includes(WEBMCP_TOOL) || /needs/i.test(t.replace(/recommendation for your user/i, ''))) break
    }
    return best ? [best] : null
  }
  return null
}

function headingLevel(el: Element): number {
  const m = /^H([1-6])$/.exec(el.tagName)
  if (m) return Number(m[1])
  const aria = Number(el.getAttribute('aria-level'))
  return aria >= 1 && aria <= 6 ? aria : 6
}

function readAgentScript(
  doc: Document,
): { postEndpoint?: string; webMcpTool?: string; fields?: Record<string, string> } | null {
  for (const s of Array.from(doc.querySelectorAll('script'))) {
    if (s.getAttribute('src')) continue
    const marked = s.hasAttribute('data-cf-agent-tool') || s.hasAttribute('data-webmcp-tool')
    const text = s.textContent ?? ''
    if (!marked && !text.includes(ENDPOINT_MARK)) continue
    const objs = text.length <= 200_000 ? findJsonObjects(text) : []
    const cfg =
      objs.find((o) => typeof o.url === 'string' && o.url.includes(ENDPOINT_MARK)) ?? objs.find((o) => isRecord(o.fixed))
    const name = typeof cfg?.name === 'string' ? cfg.name : undefined
    const webMcpTool =
      s.getAttribute('data-webmcp-tool') || name || (text.includes(WEBMCP_TOOL) ? WEBMCP_TOOL : undefined)
    // The page's own WebMCP client POSTs { needs, constraints, agent, ...fixed }: those are the field names.
    const fixed = isRecord(cfg?.fixed) ? literalFields(cfg.fixed) : {}
    return {
      postEndpoint: typeof cfg?.url === 'string' ? cfg.url : undefined,
      webMcpTool,
      fields: cfg ? { needs: 'needs', constraints: 'constraints', agent: 'agent', ...fixed } : undefined,
    }
  }
  return null
}

function markdownLink(doc: Document, base: string): string | undefined {
  for (const l of Array.from(doc.querySelectorAll('link[rel][href]'))) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
    if (rel.includes('alternate') && (l.getAttribute('type') ?? '').toLowerCase() === 'text/markdown') {
      return resolveUrl(l.getAttribute('href') ?? '', base)
    }
  }
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? ''
    if (/markdown|agent version/i.test(a.textContent ?? '') || isMarkdownUrl(href)) return resolveUrl(href, base)
  }
  return undefined
}

// ── Text ─────────────────────────────────────────────────────────────────

/** From the start of the line holding the phrase to the next markdown heading of level 1–2 (or the cap). */
function sliceSection(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1
  const rest = text.slice(at)
  const next = rest.search(/\n#{1,2}\s/)
  return text.slice(start, next >= 0 ? at + next : at + SECTION_CAP).slice(0, SECTION_CAP)
}

function parseSectionText(text: string, baseUrl?: string): CoframeAgentHooks {
  const urls = Array.from(text.matchAll(URL_RE), (m) => resolveUrl(m[0].replace(/[.,;:!?]+$/, ''), baseUrl))
  const endpoints = urls.filter((u) => u.includes(ENDPOINT_MARK))
  const hooks: CoframeAgentHooks = {
    markdownUrl: urls.find(isMarkdownUrl),
    needsLinkTemplate: urls.find((u) => /[?&]needs=/.test(u)),
    postEndpoint: endpoints.find((u) => !u.includes('?')) ?? endpoints[0]?.split('?')[0],
    fields: fieldsFromJson(findJsonObjects(text)),
    limits: limitsFromText(text),
    webMcpTool: text.includes(WEBMCP_TOOL)
      ? WEBMCP_TOOL
      : /registers the tool\s*[`'"]?([A-Za-z_][\w-]{2,60})/i.exec(text)?.[1],
  }
  return dropEmpty(hooks)
}

function roleOf(key: string): FieldRole | null {
  const k = key.toLowerCase()
  if (/need|query|looking|summary/.test(k)) return 'needs'
  if (/constraint|budget|timing/.test(k)) return 'constraints'
  if (/^(agent|agent_?name|client|client_?name|product)$/.test(k)) return 'agent'
  return null
}

/** The first JSON example with a needs-like key → { role: pageFieldName, literalKey: literalValue }. */
function fieldsFromJson(objs: Record<string, unknown>[]): Record<string, string> | undefined {
  const obj = objs.find((o) => Object.keys(o).some((k) => roleOf(k) === 'needs'))
  if (!obj) return undefined
  const fields: Record<string, string> = {}
  for (const k of Object.keys(obj)) {
    const role = roleOf(k)
    if (role && !fields[role]) fields[role] = k
  }
  return { ...literalFields(obj), ...fields }
}

/** Literal parameters (site/page/token…), verbatim. Never anything that looks like a slot for personal data. */
function literalFields(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (roleOf(k) || /mail|phone|name|address/i.test(k)) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
  }
  return out
}

function limitsFromText(text: string): { needs: number; constraints: number } {
  const read = (field: string, fallback: number): number => {
    const re = new RegExp(`\\b${field}\\b\\W{0,3}[^.\\n]{0,40}?(?:up to|at most|max(?:imum)?|≤|<=|limited to)\\s*([\\d,]{2,7})`, 'i')
    const n = Number(re.exec(text)?.[1]?.replace(/,/g, ''))
    return n >= 50 && n <= 100_000 ? n : fallback
  }
  return { needs: read('needs', DEFAULT_LIMITS.needs), constraints: read('constraints', DEFAULT_LIMITS.constraints) }
}

/** JSON objects embedded in text or JS (each starts with `{"`). Unparseable candidates are skipped. */
export function findJsonObjects(text: string, max = 20): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const re = /\{\s*"/g
  let tries = 0
  for (let m = re.exec(text); m && out.length < max && tries < 200; m = re.exec(text)) {
    tries++
    const end = matchBrace(text, m.index)
    if (end < 0) continue
    try {
      const v: unknown = JSON.parse(text.slice(m.index, end + 1))
      if (isRecord(v)) {
        out.push(v)
        re.lastIndex = end + 1
      }
    } catch {
      // not JSON (e.g. a JS object literal); keep scanning
    }
  }
  return out
}

function matchBrace(text: string, start: number): number {
  let depth = 0
  let inStr = false
  const stop = Math.min(text.length, start + 50_000)
  for (let i = start; i < stop; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

// ── small helpers ────────────────────────────────────────────────────────

function isMarkdownUrl(u: string): boolean {
  return /\.md(?:[?#]|$)|\/\.agent(?:[?#]|$)|[?&]view=agent\b/i.test(u)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Absolute URLs stay exactly as written; relative ones resolve against the page when possible. */
function resolveUrl(href: string, base?: string): string {
  if (/^https?:\/\//i.test(href) || !base) return href
  try {
    return new URL(href, base).href
  } catch {
    return href
  }
}

function tidy(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

function dropEmpty(h: CoframeAgentHooks): CoframeAgentHooks {
  const out: CoframeAgentHooks = {}
  for (const [k, v] of Object.entries(h) as [keyof CoframeAgentHooks, unknown][]) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v
  }
  return out
}
