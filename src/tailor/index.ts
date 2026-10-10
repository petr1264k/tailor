/**
 * Tailor (CONTEXT.txt §3.5). Owner: Mikhail (engine) + third engineer (prompts, relevance, speed).
 *
 * content script:  extractPageContent(document) → PageContent (Readability + JSON-LD + agent hooks).   [extract.ts]
 * background:      tailorPage(content, profile) → select relevant facts (code only)                     [relevance.ts]
 *                  → rewrite (Haiku, JSON blocks only)                                                  [rewrite.ts]
 *                  → fidelity gate (§3.6, src/gate) → cache per (profileId, profileVersion, url).       [cache.ts]
 * Output is in the user's chat language, at their reading level. Pre-tailor on page load when enabled.
 */
import type { PageContent, Profile, TailoredPage } from '@/types'
import type { HandlerMap } from '@/messages'
import type { Settings } from '@/settings'
import { getSettings } from '@/settings'
import { getProfile } from '@/profile'
import { runFidelityGate, type GateOutput } from '@/gate'
import { selectRelevantFacts } from './relevance'
import { rewritePage } from './rewrite'
import { cacheKey, getCachedTailoredPage, setCachedTailoredPage } from './cache'

export { extractPageContent } from './extract'
export { selectRelevantFacts, scoreFact, tokenize } from './relevance'
export { rewritePage, buildRewriteUserPrompt, checkBlocks, chooseLanguage, REWRITE_SYSTEM } from './rewrite'
export type { RewriteOptions } from './rewrite'
export { getCachedTailoredPage, setCachedTailoredPage, cacheKey, stripHash } from './cache'

export const AGENT_MARKDOWN_TIMEOUT_MS = 3_000
export const MAX_AGENT_MARKDOWN_CHARS = 60_000

/** Errors thrown by `todo()` (src/todo.ts) in modules that are not built yet. */
export function isTodoError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('TODO(')
}

const siteOf = (host: string) => host.replace(/^www\./, '')

/**
 * Background. If the site offers an agent/markdown version, fetch it (§4).
 * - markdownUrl given (read from the page's agent section): GET it. It must be http(s) and on the page's own site,
 *   because the page controls this value and we should not fetch arbitrary hosts for it.
 * - otherwise GET the page URL with `Accept: text/markdown`.
 * Accepted when content-type includes text/markdown or the first non-empty line starts with '#'. 3 s timeout.
 * Returns null on any failure. The body is untrusted page text, same as Readability output.
 *
 * UNVERIFIED (§4): what actually triggers coframe.com's markdown version. Test with curl before relying on it:
 *   curl -sI -H 'Accept: text/markdown' https://www.coframe.com/   then an agent-style User-Agent.
 * TODO(tailor): add the User-Agent variant if curl shows the Accept header alone is not enough
 * (note: browsers may not let an extension override User-Agent on fetch; that would need declarativeNetRequest).
 */
export async function fetchAgentMarkdown(url: string, markdownUrl?: string): Promise<string | null> {
  let target: URL
  try {
    const page = new URL(url)
    target = new URL(markdownUrl ?? url, page)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
    if (siteOf(target.hostname) !== siteOf(page.hostname)) return null
  } catch {
    return null
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AGENT_MARKDOWN_TIMEOUT_MS)
  try {
    const res = await fetch(target.href, {
      headers: { Accept: 'text/markdown' },
      credentials: 'omit', // the agent version is public; never send the user's cookies with it
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    const body = await res.text()
    const firstLine = body.split('\n').find((l) => l.trim())?.trim() ?? ''
    if (!type.includes('text/markdown') && !firstLine.startsWith('#')) return null
    return body.trim() ? body.slice(0, MAX_AGENT_MARKDOWN_CHARS) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** select → rewrite → gate → cache. Returns a TailoredPage whose blocks have already passed the gate. */
export async function tailorPage(content: PageContent, profile: Profile, settings: Settings): Promise<TailoredPage> {
  // Extract from the agent version when offered; the gate still checks the VISIBLE page (§3.6).
  let working = content
  const markdownUrl = content.agentHooks?.markdownUrl
  if (markdownUrl) {
    const md = await fetchAgentMarkdown(content.url, markdownUrl)
    if (md) working = { ...content, text: md, source: 'agent-markdown' }
  }

  const facts = await selectRelevantFacts(profile, working)
  const blocks = await rewritePage(working, facts, {
    language: settings.language || undefined,
    readingLevel: settings.readingLevel,
  })

  let gated: GateOutput
  try {
    gated = runFidelityGate({
      blocks,
      visibleText: content.visibleText,
      links: content.links,
      userFactValues: facts.map((f) => f.value),
    })
  } catch (err) {
    // TODO(tailor): remove this wrapper once gate.runFidelityGate is implemented. Real gate errors still throw.
    if (!isTodoError(err)) throw err
    console.warn('[tailor] fidelity gate not built yet; blocks are UNGATED')
    gated = { blocks, gate: { checked: 0, stripped: [] } }
  }

  const page: TailoredPage = { url: content.url, profileVersion: profile.version, blocks: gated.blocks, gate: gated.gate }
  try {
    await setCachedTailoredPage(page, settings.activeProfileId)
  } catch (err) {
    console.warn('[tailor] could not cache tailored page', err instanceof Error ? err.name : 'error')
  }
  return page
}

/** Runs in flight per cache key, so pre-tailor on load + a click on Tailor share one model call (§3.5). */
const inFlight = new Map<string, Promise<TailoredPage>>()

export const handlers: HandlerMap = {
  'tailor/run': async (msg) => {
    const settings = await getSettings()
    const profile = await getProfile(settings.activeProfileId)
    const key = cacheKey(settings.activeProfileId, profile.version, msg.content.url)
    if (!msg.force) {
      const pending = inFlight.get(key)
      if (pending) return pending
      const hit = await getCachedTailoredPage(msg.content.url, settings.activeProfileId, profile.version)
      if (hit) return hit
    }
    const run = tailorPage(msg.content, profile, settings).finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key)
    })
    inFlight.set(key, run)
    return run
  },
  'tailor/cached': async (msg) => {
    const settings = await getSettings()
    const profile = await getProfile(settings.activeProfileId)
    return getCachedTailoredPage(msg.url, settings.activeProfileId, profile.version)
  },
}
