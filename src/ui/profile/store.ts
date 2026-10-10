/**
 * Small persistence helpers for the extension pages. Extension origin only.
 *  - "never extracted" counts (§3.3) in chrome.storage.local under 'tailor.neverExtracted'
 *  - creating a profile (the profile module has no create function yet, so write a StoredProfile via getDb())
 * Falls back to an in-memory store when `chrome` is absent (vitest), like src/settings.
 */
import { getDb, type StoredProfile } from '@/archive'
import { emptyProfile } from '@/profile'
import { profileIdFromName } from './helpers'

export const NEVER_EXTRACTED_KEY = 'tailor.neverExtracted'

/**
 * Stored shape: per profile id, because the demo has two profiles (Mikhail, Petr) built from two different
 * imports, and each one's "never extracted" list must show its own counts.
 */
export type NeverExtractedStore = Record<string, { counts: Record<string, number>; at: string }>

let memory: NeverExtractedStore = {}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

async function readAll(): Promise<NeverExtractedStore> {
  if (!hasChromeStorage()) return memory
  const raw = await chrome.storage.local.get(NEVER_EXTRACTED_KEY)
  const value = raw[NEVER_EXTRACTED_KEY]
  return value && typeof value === 'object' ? (value as NeverExtractedStore) : {}
}

export async function loadNeverExtracted(profileId: string): Promise<{ counts: Record<string, number>; at: string } | null> {
  return (await readAll())[profileId] ?? null
}

export async function saveNeverExtracted(profileId: string, counts: Record<string, number>, at = new Date().toISOString()): Promise<void> {
  const next = { ...(await readAll()), [profileId]: { counts, at } }
  if (hasChromeStorage()) await chrome.storage.local.set({ [NEVER_EXTRACTED_KEY]: next })
  else memory = next
}

/** Tests only. */
export function resetNeverExtractedForTests(): void {
  memory = {}
}

/**
 * Creates an empty profile named `name` and returns it. Ids come from the name ("Petr" → "petr"), unique among
 * existing profiles. TODO(ui): switch to a profile-module create function if one is added (see requests).
 */
export async function createProfile(name: string, now = new Date()): Promise<StoredProfile> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the profile a name')
  const db = await getDb()
  const existing = (await db.getAllKeys('profiles')).map(String)
  const stored: StoredProfile = {
    ...emptyProfile(),
    id: profileIdFromName(trimmed, existing),
    name: trimmed,
    updatedAt: now.toISOString(),
  }
  await db.add('profiles', stored)
  return stored
}
