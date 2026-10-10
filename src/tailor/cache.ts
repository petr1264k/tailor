/**
 * Tailored-page cache (CONTEXT.txt §3.5: "cache per (url, profileVersion)"), keyed per profile too because the
 * demo switches between two profiles. IndexedDB 'tailored' store: extension origin only, never the content script.
 */
import type { TailoredPage } from '@/types'
import { getDb } from '@/archive'

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
  if (!hit) return null
  return { url: hit.url, profileVersion: hit.profileVersion, blocks: hit.blocks, gate: hit.gate }
}

export async function setCachedTailoredPage(page: TailoredPage, profileId: string): Promise<void> {
  const db = await getDb()
  // TODO(tailor): evict old versions (every profile save bumps version, so stale entries pile up). Fine for the demo.
  await db.put('tailored', {
    url: page.url,
    profileVersion: page.profileVersion,
    blocks: page.blocks,
    gate: page.gate,
    key: cacheKey(profileId, page.profileVersion, page.url),
    cachedAt: new Date().toISOString(),
  })
}
