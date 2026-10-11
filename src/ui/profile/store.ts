/**
 * Small persistence helpers for the extension pages. Extension origin only.
 *  - creating a profile (the profile module has no create function yet, so write a StoredProfile via getDb())
 *  - renaming a profile (popup header and options page)
 */
import { getDb, type StoredProfile } from '@/archive'
import { emptyProfile } from '@/profile'
import { profileIdFromName } from './helpers'

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

/**
 * Renames profile `id` and returns the row. The id, facts and version stay: the tailored-page cache is keyed by
 * (id, version, url), and a name is not part of what a page sees. A profile that the settings point at but
 * that was never written (getProfile creates it lazily) is created here with the new name.
 */
export async function renameProfile(id: string, name: string, now = new Date()): Promise<StoredProfile> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the profile a name')
  const db = await getDb()
  const tx = db.transaction('profiles', 'readwrite')
  const existing = await tx.store.get(id)
  const stored: StoredProfile = existing
    ? { ...existing, name: trimmed, updatedAt: now.toISOString() }
    : { ...emptyProfile(), id, name: trimmed, updatedAt: now.toISOString() }
  await tx.store.put(stored)
  await tx.done
  return stored
}
