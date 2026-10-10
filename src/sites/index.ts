/**
 * Site profiles (src/sites): per-site page anatomy for deep, structural personalization. See types.ts.
 * `siteProfileFor(url)` picks the hand-written profile for a host, else the generic one.
 * Light on purpose: no SDK, no IndexedDB; the content script imports this.
 */
import type { SiteProfile } from './types'
import { anker } from './anker'
import { generic } from './generic'

export type { SiteProfile, RoleRule, ItemRule, SitePolicy } from './types'
export { anker, generic }
export { collectRegions, regionIds, regionOf, regionPromptLines, repeatedCards, MAX_REGIONS, MAX_ITEMS, MAX_ITEMS_PER_REGION } from './regions'
export type { RegionMap } from './regions'

/** Hand-written profiles, most specific host first. */
export const SITE_PROFILES: readonly SiteProfile[] = [anker]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** The profile for a URL's host (anker.com matches www.anker.com and us.anker.com), else the generic profile. */
export function siteProfileFor(url: string): SiteProfile {
  const host = hostOf(url)
  if (!host) return generic
  for (const p of SITE_PROFILES) {
    if (host === p.host || host.endsWith(`.${p.host}`)) return p
  }
  return generic
}

/** True when a hand-written profile (not the generic one) describes this URL. */
export function hasSiteProfile(url: string): boolean {
  return siteProfileFor(url) !== generic
}
