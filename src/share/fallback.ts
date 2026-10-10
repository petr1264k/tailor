/**
 * The cached demo reply (CONTEXT.txt §4 "Before the feature freeze", §7 16:00, §12 "cache one real reply").
 * After the ONE real call (team's OK first), run recordFallbackReply(share.response, share.at) and paste its output
 * over the DEMO_FALLBACK_REPLY line below. The UI must label a fallback reply honestly (SharePreview.usingFallback,
 * isFallbackShare()). Pure module: the renderer and UI pages may import it from '@/share/fallback'.
 */
import type { SiteShare } from '@/types'

export interface DemoFallbackReply {
  response: string
  capturedAt: string
}

/** Fill in after the one real call before freeze. Label the fallback honestly in the UI. */
export const DEMO_FALLBACK_REPLY: DemoFallbackReply | null = null

/** Returns the exact TypeScript line(s) to paste over DEMO_FALLBACK_REPLY above. */
export function recordFallbackReply(response: string, at: string): string {
  return (
    `export const DEMO_FALLBACK_REPLY: DemoFallbackReply | null = {\n` +
    `  response: ${JSON.stringify(response)},\n` +
    `  capturedAt: ${JSON.stringify(at)},\n` +
    `}\n`
  )
}

/** True when a receipt's reply is the cached demo reply, so the UI can label it honestly (§4, §12). */
export function isFallbackShare(share: SiteShare): boolean {
  const cached: DemoFallbackReply | null = DEMO_FALLBACK_REPLY
  return cached !== null && share.response === cached.response
}
