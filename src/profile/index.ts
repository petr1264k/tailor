/**
 * Profile (CONTEXT.txt §3.4). Owner: Mikhail.
 *
 * A list of facts, each with its source ("ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'").
 * Keep, edit or delete any fact. Group by source: what ChatGPT knows, what Claude knows, the overlap.
 * Every save bumps `version`; the tailored-page cache is keyed by it. The demo uses two profiles (Mikhail, Petr).
 */
import type { Evidence, Fact, Profile, SourceSplit } from '@/types'
import type { HandlerMap } from '@/messages'
import type { StoredProfile } from '@/archive'
import { todo } from '@/todo'

export const DEFAULT_PROFILE_ID = 'default'

export function emptyProfile(): Profile {
  return { version: 0, facts: [], shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } }
}

export async function listProfiles(): Promise<Pick<StoredProfile, 'id' | 'name' | 'version' | 'updatedAt'>[]> {
  return todo('profile.listProfiles')
}

/** The active profile unless an id is given. Creates an empty one if missing. */
export async function getProfile(profileId?: string): Promise<Profile> {
  void profileId
  return todo('profile.getProfile')
}

/** Saves and bumps `version`. */
export async function saveProfile(profile: Profile, profileId?: string): Promise<Profile> {
  void profile
  void profileId
  return todo('profile.saveProfile')
}

export async function updateFact(
  factId: string,
  patch: Partial<Pick<Fact, 'value' | 'category' | 'userStatus'>>,
  profileId?: string,
): Promise<Profile> {
  void factId
  void patch
  void profileId
  return todo('profile.updateFact', "set userStatus 'edited' when value changes")
}

/** Marks the fact deleted (userStatus). Deleted facts never reach a page or a site. */
export async function deleteFact(factId: string, profileId?: string): Promise<Profile> {
  void factId
  void profileId
  return todo('profile.deleteFact')
}

/** Facts that are live: not deleted. */
export function activeFacts(profile: Profile): Fact[] {
  return profile.facts.filter((f) => f.userStatus !== 'deleted')
}

/** What ChatGPT knows, what Claude knows, the overlap (by evidence origin). */
export function sourceSplit(profile: Profile): SourceSplit {
  void profile
  return todo('profile.sourceSplit')
}

/** "ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'" */
export function formatEvidence(evidence: Evidence): string {
  void evidence
  return todo('profile.formatEvidence')
}

export const handlers: HandlerMap = {
  'profile/get': async (msg) => getProfile(msg.profileId),
  'profile/split': async (msg) => sourceSplit(await getProfile(msg.profileId)),
  'profile/updateFact': async (msg) => updateFact(msg.factId, msg.patch, msg.profileId),
  'profile/deleteFact': async (msg) => deleteFact(msg.factId, msg.profileId),
}
