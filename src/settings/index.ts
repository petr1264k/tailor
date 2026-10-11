/**
 * Extension settings: API keys, flags, active profile. Stored in chrome.storage.local.
 * Keys never leave the browser except in the Authorization header to the provider they belong to.
 * Falls back to an in-memory store when `chrome` is absent (vitest).
 */
import type { HandlerMap } from '@/messages'

export interface Settings {
  anthropicKey?: string
  /** Required by Anthropic when the key is an org-level key (not scoped to a workspace). Sent as the anthropic-workspace-id header. */
  anthropicWorkspaceId?: string
  googleKey?: string
  openrouterKey?: string
  /** Which provider does fast rewrites. Gemini Flash-Lite is the alternative if it is faster on the day (§5). */
  rewriteProvider: 'anthropic' | 'gemini'
  /**
   * Tailor every page as it loads and apply the result the moment it is ready; cached per (url, profileVersion) (§3.5).
   * Off: the page stays as it is until the user clicks Tailor.
   */
  autoTailorOnLoad: boolean
  /**
   * Demo mode (§9), "Animate" in the popup: when a tailored result lands, the changes play one by one from the top of the
   * page to the bottom, each with its motion and the window following, instead of appearing at once. On by default; off = instant.
   */
  demoMode: boolean
  /** Which stored profile is active (the demo uses two: Mikhail, Petr). */
  activeProfileId: string
  /** Override the output language (BCP 47). Empty = the user's chat language. */
  language?: string
  readingLevel?: 'simple' | 'standard' | 'expert'
}

export const DEFAULT_SETTINGS: Settings = {
  rewriteProvider: 'anthropic',
  autoTailorOnLoad: true,
  demoMode: true,
  activeProfileId: 'default',
}

const STORAGE_KEY = 'tailor.settings'
let memory: Settings = { ...DEFAULT_SETTINGS }

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

export async function getSettings(): Promise<Settings> {
  if (!hasChromeStorage()) return memory
  const raw = await chrome.storage.local.get(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS, ...(raw[STORAGE_KEY] as Partial<Settings> | undefined) }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  if (hasChromeStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next })
  else memory = next
  return next
}

export const settingsHandlers: HandlerMap = {
  'settings/get': async () => getSettings(),
  'settings/set': async (msg) => setSettings(msg.patch),
}
