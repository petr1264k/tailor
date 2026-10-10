/**
 * Share with sites (CONTEXT.txt §3.9, §4). Built only for coframe.com. Owner: Mikhail.
 *
 * 1. Take the few facts the rewrite already chose for this page → 1–2 sentence needs string (NeedsTextSchema).
 * 2. Run it through the sensitive filter. Never names, emails or phone numbers.
 * 3. Consent sheet shows the text word for word and the facts it uses. "Share 3 facts" / "Don't share". Opt-in per site.
 * 4. POST with agent name "Tailor". Read endpoint, field names and any page/token parameters FROM THE PAGE; never hardcode.
 * 5. Show the reply in a `from_site` block: plain text, never passed to the rewrite model, links must exist on the page,
 *    numbers marked as the site's claims.
 * 6. Save a receipt (SiteShare) in the profile.
 * Before the feature freeze: call the endpoint ONCE with a made-up needs string (team's OK first) and cache the reply here as the demo fallback.
 */
import type { Block, CoframeAgentHooks, Fact, PageContent, PageLink, SiteShare, TailoredPage } from '@/types'
import type { HandlerMap, SharePreview } from '@/messages'
import { todo } from '@/todo'

export const AGENT_NAME = 'Tailor' as const

/** Fill in after the one real call before freeze. Label the fallback honestly in the UI. */
export const DEMO_FALLBACK_REPLY: { response: string; capturedAt: string } | null = null

/** Runs in the content script. Finds the "Get a recommendation for your user (optional)" section and reads its parameters. */
export function readAgentHooks(doc: Document): CoframeAgentHooks | null {
  void doc
  return todo('share.readAgentHooks')
}

/** The needs string from the chosen facts, then scrubForSharing. */
export async function buildNeedsText(facts: Fact[], content: PageContent): Promise<{ needs: string; constraints?: string }> {
  void facts
  void content
  return todo('share.buildNeedsText')
}

export async function previewShare(content: PageContent, tailored: TailoredPage): Promise<SharePreview> {
  void content
  void tailored
  return todo('share.previewShare')
}

/** POSTs (or uses the cached fallback), saves the receipt, returns it. The response is untrusted text. */
export async function sendShare(req: {
  url: string
  needsText: string
  constraints?: string
  factIds: string[]
  hooks: CoframeAgentHooks
}): Promise<SiteShare> {
  void req
  return todo('share.sendShare')
}

/** The site's reply as a block. Links not on the original page are removed; numbers are marked as the site's claims. */
export function toFromSiteBlock(share: SiteShare, links: PageLink[]): Block {
  void links
  return { type: 'from_site', text: share.response, siteUrl: share.url }
}

export const handlers: HandlerMap = {
  'share/preview': async (msg) => previewShare(msg.content, msg.tailored),
  'share/send': async (msg) => sendShare(msg),
}
