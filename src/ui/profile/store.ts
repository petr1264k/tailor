/**
 * Small persistence helpers for the extension pages. Extension origin only.
 *  - creating a profile (the profile module has no create function yet, so write a StoredProfile via getDb())
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
