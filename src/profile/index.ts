/**
 * Profile (CONTEXT.txt §3.4). Owner: Mikhail.
 *
 * A list of facts, each with its source ("ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'").
 * Keep, edit or delete any fact. Group by source: what ChatGPT knows, what Claude knows, the overlap.
 * Every save bumps `version`; the tailored-page cache is keyed by it. The demo uses two profiles (Mikhail, Petr).
 *
 * Storage: StoredProfile rows in the 'profiles' store (src/archive/db.ts). Extension origin only
 * (background, popup, options page); the content script must go through `send('profile/get')`.
 */
import type { Evidence, Fact, OmittedItem, Profile, SourceSplit } from '@/types'
import type { HandlerMap } from '@/messages'
import { getDb, type StoredProfile } from '@/archive'
import { getSettings } from '@/settings'
import { OmittedListSchema, ProfileFileSchema } from '@/schemas'

export const DEFAULT_PROFILE_ID = 'default'

export function emptyProfile(): Profile {
  return { version: 0, facts: [], shares: [], stats: { conversations: 0, messages: 0, from: '', to: '' } }
}

async function resolveId(profileId?: string): Promise<string> {
  return profileId || (await getSettings()).activeProfileId || DEFAULT_PROFILE_ID
}

/** 'mikhail' → 'Mikhail'. The demo names its two profiles by id. */
function defaultName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** Strip the storage-only fields so callers get a plain §6 Profile. */
function toProfile(stored: StoredProfile): Profile {
  return { version: stored.version, facts: stored.facts, shares: stored.shares, stats: stored.stats }
}

let lock: Promise<unknown> = Promise.resolve()

/**
 * Serializes read-modify-write cycles on profiles within one JS context (the background worker).
 * Without it, two quick clicks ("expand the specs twice", §9) race: both read v3, the second write loses the first.
 * Not re-entrant: inside `fn` call getProfile/saveProfile directly, never updateFact/deleteFact or
 * withProfileLock again (that would deadlock). UI pages run in another context and have their own lock.
 */
export function withProfileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn)
  lock = run.catch(() => undefined)
  return run
}

export async function listProfiles(): Promise<Pick<StoredProfile, 'id' | 'name' | 'version' | 'updatedAt'>[]> {
  const db = await getDb()
  const rows = await db.getAll('profiles')
  return rows.map(({ id, name, version, updatedAt }) => ({ id, name, version, updatedAt }))
}

/** The active profile unless an id is given. Creates an empty one if missing. */
export async function getProfile(profileId?: string): Promise<Profile> {
  const id = await resolveId(profileId)
  const db = await getDb()
  // One readwrite transaction, so a first-use create can never overwrite a save that landed in between.
  const tx = db.transaction('profiles', 'readwrite')
  let stored = await tx.store.get(id)
  if (!stored) {
    stored = { ...emptyProfile(), id, name: defaultName(id), updatedAt: new Date().toISOString() }
    await tx.store.put(stored)
  }
  await tx.done
  return toProfile(stored)
}

/**
 * Saves and bumps `version`. The new version is max(stored, given) + 1 so versions only ever grow,
 * even if a stale copy is saved: the tailored cache is keyed by (profileId, version, url) and must never collide.
 * The stored "Left out on purpose" list stays unless `opts.omitted` is passed (loadProfileFile replaces it).
 */
export async function saveProfile(profile: Profile, profileId?: string, opts?: { omitted?: OmittedItem[] }): Promise<Profile> {
  const id = await resolveId(profileId)
  const db = await getDb()
  const tx = db.transaction('profiles', 'readwrite')
  const existing = await tx.store.get(id)
  const omitted = opts ? opts.omitted : existing?.omitted
  const stored: StoredProfile = {
    id,
    name: existing?.name ?? defaultName(id),
    version: Math.max(existing?.version ?? 0, profile.version) + 1,
    facts: profile.facts,
    shares: profile.shares,
    stats: profile.stats,
    updatedAt: new Date().toISOString(),
    ...(omitted?.length ? { omitted } : {}),
  }
  await tx.store.put(stored)
  await tx.done
  return toProfile(stored)
}

export async function updateFact(
  factId: string,
  patch: Partial<Pick<Fact, 'value' | 'category' | 'userStatus'>>,
  profileId?: string,
): Promise<Profile> {
  return withProfileLock(async () => {
    const profile = await getProfile(profileId)
    const fact = profile.facts.find((f) => f.id === factId)
    if (!fact) throw new Error(`profile.updateFact: no fact with id ${factId}`)
    const edited =
      (patch.value !== undefined && patch.value !== fact.value) ||
      (patch.category !== undefined && patch.category !== fact.category)
    // An explicit userStatus wins. Otherwise an owner edit (value, or category) marks the fact 'edited' (§3.4),
    // except that a deleted fact stays deleted until the owner explicitly restores it: deleted never reaches a page.
    const userStatus =
      patch.userStatus ?? (edited && fact.userStatus !== 'deleted' ? 'edited' : fact.userStatus)
    const next: Fact = { ...fact, ...patch, userStatus }
    return saveProfile({ ...profile, facts: profile.facts.map((f) => (f.id === factId ? next : f)) }, profileId)
  })
}

/**
 * Marks the fact deleted (userStatus). Never physically removed, so the owner's decision is remembered
 * (re-extraction can skip it). Deleted facts never reach a page or a site: every consumer uses activeFacts().
 */
export async function deleteFact(factId: string, profileId?: string): Promise<Profile> {
  return updateFact(factId, { userStatus: 'deleted' }, profileId)
}

/**
 * Checks a dropped profile file with ProfileFileSchema: a bare §6 Profile (claude.profile.json) or one wrapped as
 * `{ id, profile }` (api-profile.json, petr/default.json). Throws a readable error that names the first bad field
 * by its path only, never its value.
 */
export function parseProfileFile(json: unknown): Profile {
  const r = ProfileFileSchema.safeParse(unwrapProfileFile(json))
  if (r.success) return r.data
  throw new Error(`not a Tailor profile file (${firstIssue(r.error.issues)})`)
}

function unwrapProfileFile(json: unknown): unknown {
  const wrapped = typeof json === 'object' && json !== null && !('facts' in json) && 'profile' in json
  return wrapped ? (json as { profile: unknown }).profile : json
}

function firstIssue(issues: { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0]
  return `${issue?.path.length ? issue.path.map(String).join('.') : 'top level'}: ${issue?.message ?? 'invalid'}`
}

/**
 * The optional "Left out on purpose" list of a profile file: `omitted` next to the profile fields, or next to
 * `profile` in the wrapped shape. Undefined when absent; throws (path only) when present but malformed.
 */
export function parseOmitted(json: unknown): OmittedItem[] | undefined {
  const holders = [json, unwrapProfileFile(json)].filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
  const raw = holders.find((h) => 'omitted' in h)?.omitted
  if (raw === undefined) return undefined
  const r = OmittedListSchema.safeParse(raw)
  if (r.success) return r.data
  throw new Error(`not a Tailor profile file (omitted.${firstIssue(r.error.issues)})`)
}

/**
 * Replaces the facts, shares, stats and "Left out on purpose" list of a profile with a checked profile file. The name
 * stays; the version bumps past both the stored and the file's version (saveProfile), so no tailored page from before
 * is reused.
 */
export async function loadProfileFile(json: unknown, profileId?: string): Promise<Profile> {
  const file = parseProfileFile(json)
  const omitted = parseOmitted(json)
  return withProfileLock(() => saveProfile(file, profileId, { omitted }))
}

/** The stored "Left out on purpose" list ([] when the profile has none). */
export async function getOmitted(profileId?: string): Promise<OmittedItem[]> {
  const db = await getDb()
  return (await db.get('profiles', await resolveId(profileId)))?.omitted ?? []
}

/** What "Save profile to disk" writes: the §6 Profile, plus `omitted` when it has one. loadProfileFile reads it back. */
export async function profileFile(profileId?: string): Promise<Profile & { omitted?: OmittedItem[] }> {
  const profile = await getProfile(profileId)
  const omitted = await getOmitted(profileId)
  return omitted.length ? { ...profile, omitted } : profile
}

/** Facts that are live: not deleted. */
export function activeFacts(profile: Profile): Fact[] {
  return profile.facts.filter((f) => f.userStatus !== 'deleted')
}

/**
 * What ChatGPT knows, what Claude knows, the overlap (by evidence origin), among active facts (§3.4, §9 hook).
 * Facts with no chat-origin evidence (behavior facts, whose evidence origin is a page URL) are in none of
 * the three groups: they come from clicks, not chats, so they don't belong in "what ChatGPT / Claude knows".
 */
export function sourceSplit(profile: Profile): SourceSplit {
  const split: SourceSplit = { chatgptOnly: [], claudeOnly: [], both: [] }
  for (const fact of activeFacts(profile)) {
    const fromChatgpt = fact.evidence.some((e) => e.origin === 'chatgpt')
    const fromClaude = fact.evidence.some((e) => e.origin === 'claude')
    if (fromChatgpt && fromClaude) split.both.push(fact)
    else if (fromChatgpt) split.chatgptOnly.push(fact)
    else if (fromClaude) split.claudeOnly.push(fact)
  }
  return split
}

/** "https://www.bestbuy.com/x" → "bestbuy.com". Falls back to the input when it is not a URL. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'MMM D'. Date-only strings ('2026-08-03') are read as calendar dates (UTC); timestamps in local time. */
function formatShortDate(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export const QUOTE_MAX = 90

/** Collapse whitespace; cut to ~max chars at a word boundary when one is close, then add an ellipsis. */
export function truncateQuote(quote: string, max = QUOTE_MAX): string {
  const s = quote.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max - 25 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…'
}

/** "ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'" (§3.4). What the "why" chip shows (§3.7). */
export function formatEvidence(evidence: Evidence): string {
  const label =
    evidence.origin === 'chatgpt' ? 'ChatGPT' : evidence.origin === 'claude' ? 'Claude' : siteName(evidence.origin)
  const date = formatShortDate(evidence.date)
  return `${label}${date ? `, ${date}` : ''}: '${truncateQuote(evidence.quote)}'`
}

export const handlers: HandlerMap = {
  'profile/get': async (msg) => getProfile(msg.profileId),
  'profile/split': async (msg) => sourceSplit(await getProfile(msg.profileId)),
  'profile/updateFact': async (msg) => updateFact(msg.factId, msg.patch, msg.profileId),
  'profile/deleteFact': async (msg) => deleteFact(msg.factId, msg.profileId),
}
