/**
 * The site's reply as a `from_site` block (CONTEXT.txt §4 share flow, step 5). Pure code, no imports with side effects,
 * so the renderer and the content script can import it from '@/share/block'.
 * - Plain text, kept verbatim, except links that are not on the original page: those are replaced (code decides).
 * - The renderer labels it with fromSiteLabel() and marks numbers in it as the site's claims.
 * - Never passed to a model as instructions.
 */
import type { Block, PageLink, SiteShare } from '@/types'

export const LINK_REMOVED = '[link removed: not on this page]'
export const FROM_SITE_CAP = 4000
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s"'`<>()[\]{}]+/gi

export function toFromSiteBlock(share: SiteShare, links: PageLink[]): Block {
  const allowed = new Set(links.map((l) => normalizeUrl(l.href, share.url)).filter((u): u is string => !!u))
  const text = share.response.slice(0, FROM_SITE_CAP).replace(URL_IN_TEXT, (match) => {
    const url = match.replace(/[.,;:!?]+$/, '')
    const trail = match.slice(url.length)
    const norm = normalizeUrl(url, share.url)
    return (norm && allowed.has(norm) ? url : LINK_REMOVED) + trail
  })
  return { type: 'from_site', text, siteUrl: share.url }
}

/** "From coframe.com · the site's own words" (§4 step 5). */
export function fromSiteLabel(siteUrl: string): string {
  let host = 'the site'
  try {
    host = new URL(siteUrl).hostname.replace(/^www\./, '') || host
  } catch {
    // keep the generic label
  }
  return `From ${host} · the site's own words`
}

/** Compare links loosely enough to survive a trailing slash or #fragment, strictly enough to keep hosts and paths. */
function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    return null
  }
}
