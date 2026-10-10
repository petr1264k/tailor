/**
 * Extension settings: API keys, flags, active profile. Stored in chrome.storage.local.
 * Keys never leave the browser except in the Authorization header to the provider they belong to.
 * Falls back to an in-memory store when `chrome` is absent (vitest).
 */
import type { HandlerMap } from '@/messages'

export interface Settings {
  anthropicKey?: string
  googleKey?: string
  openrouterKey?: string
  /** Which provider does fast rewrites. Gemini Flash-Lite is the alternative if it is faster on the day (§5). */
  rewriteProvider: 'anthropic' | 'gemini'
  /** Pre-tailor on page load and cache per (url, profileVersion) (§3.5). */
  pretailorOnLoad: boolean
  /** Which stored profile is active (the demo uses two: Mikhail, Petr). */
  activeProfileId: string
  /** Override the output language (BCP 47). Empty = the user's chat language. */
  language?: string
  readingLevel?: 'simple' | 'standard' | 'expert'
}

export const DEFAULT_SETTINGS: Settings = {
  rewriteProvider: 'anthropic',
  pretailorOnLoad: false,
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
