/**
 * Tailored-page cache (CONTEXT.txt §3.5: "cache per (url, profileVersion)"), keyed per profile too because the
 * demo switches between two profiles. IndexedDB 'tailored' store: extension origin only, never the content script.
 *
 * Entries carry the in-place edits (§3.7) and a format number. An entry from an older format (written before edits
 * existed, so it would render as the panel) is a miss, not a hit: the page is tailored again and overwritten.
 */
import type { TailoredPage } from '@/types'
import { getDb } from '@/archive'

/** Bump when what a cached page carries changes shape. 2 = blocks + gate + in-place edits. */
export const CACHE_FORMAT = 2

/** The URL without its #fragment: in-page anchors are the same page. */
export function stripHash(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href
  } catch {
    const i = url.indexOf('#')
    return i < 0 ? url : url.slice(0, i)
  }
}

/** `${profileId}|${profileVersion}|${url without hash}` (matches CachedTailoredPage.key in src/archive/db.ts). */
export function cacheKey(profileId: string, profileVersion: number, url: string): string {
  return `${profileId}|${profileVersion}|${stripHash(url)}`
}

export async function getCachedTailoredPage(url: string, profileId: string, profileVersion: number): Promise<TailoredPage | null> {
  const db = await getDb()
  const hit = await db.get('tailored', cacheKey(profileId, profileVersion, url))
  if (!hit || hit.format !== CACHE_FORMAT) return null
  const page: TailoredPage = { url: hit.url, profileVersion: hit.profileVersion, blocks: hit.blocks, gate: hit.gate }
  if (hit.edits) page.edits = hit.edits
  return page
}

export async function setCachedTailoredPage(page: TailoredPage, profileId: string): Promise<void> {
  const db = await getDb()
  // TODO(tailor): evict old versions (every profile save bumps version, so stale entries pile up). Fine for the demo.
  await db.put('tailored', {
    url: page.url,
    profileVersion: page.profileVersion,
    blocks: page.blocks,
    gate: page.gate,
    ...(page.edits ? { edits: page.edits } : {}),
    format: CACHE_FORMAT,
    key: cacheKey(profileId, page.profileVersion, page.url),
    cachedAt: new Date().toISOString(),
  })
}
