/**
 * Tailor (CONTEXT.txt §3.5). Owner: Mikhail (engine) + third engineer (prompts, relevance, speed).
 *
 * content script:  extractPageContent(document) → PageContent (Readability + JSON-LD + agent hooks).
 * background:      tailorPage(content, profile) → select relevant facts → rewrite (Haiku, JSON blocks only)
 *                  → fidelity gate → cache per (profileId, profileVersion, url).
 * Output is in the user's chat language, at their reading level. Pre-tailor on page load when enabled.
 */
import type { Block, Fact, PageContent, Profile, TailoredPage } from '@/types'
import type { HandlerMap } from '@/messages'
import type { Settings } from '@/settings'
import { todo } from '@/todo'

/** Runs in the content script. Readability + JSON-LD + visible text + links (+ coframe agent hooks via share.readAgentHooks). */
export function extractPageContent(doc: Document, url: string): PageContent {
  void doc
  void url
  return todo('tailor.extractPageContent')
}

/** Background. If the site offers an agent/markdown version, fetch it (try `Accept: text/markdown`, then an agent User-Agent). Unverified: test with curl first (§4). */
export async function fetchAgentMarkdown(url: string): Promise<string | null> {
  void url
  return todo('tailor.fetchAgentMarkdown')
}

/** Only the facts relevant to THIS page go to the model. Code-first (keyword overlap with page text), then an optional model pass (RelevantFactIdsSchema). */
export async function selectRelevantFacts(profile: Profile, content: PageContent, max = 8): Promise<Fact[]> {
  void profile
  void content
  void max
  return todo('tailor.selectRelevantFacts')
}

export interface RewriteOptions {
  language?: string
  readingLevel?: Settings['readingLevel']
}

/** Haiku rewrite. Returns blocks validated by RewriteOutputSchema; the gate runs AFTER this. */
export async function rewritePage(content: PageContent, facts: Fact[], options: RewriteOptions = {}): Promise<Block[]> {
  void content
  void facts
  void options
  return todo('tailor.rewritePage')
}

/** select → rewrite → gate → cache. Returns a TailoredPage whose blocks have already passed the gate. */
export async function tailorPage(content: PageContent, profile: Profile, settings: Settings): Promise<TailoredPage> {
  void content
  void profile
  void settings
  return todo('tailor.tailorPage')
}

export async function getCachedTailoredPage(url: string, profileId: string, profileVersion: number): Promise<TailoredPage | null> {
  void url
  void profileId
  void profileVersion
  return todo('tailor.getCachedTailoredPage')
}

export async function setCachedTailoredPage(page: TailoredPage, profileId: string): Promise<void> {
  void page
  void profileId
  return todo('tailor.setCachedTailoredPage')
}

export const handlers: HandlerMap = {
  'tailor/run': async (msg) => {
    void msg
    return todo('tailor.handlers[tailor/run]', 'settings + active profile → cache check unless force → tailorPage')
  },
  'tailor/cached': async (msg) => {
    void msg
    return todo('tailor.handlers[tailor/cached]')
  },
}
