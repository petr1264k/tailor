/**
 * Archive of the user's OWN messages (CONTEXT.txt §3.1, §5). Owner: Mikhail.
 * IndexedDB via `db.ts`. Request the unlimitedStorage permission (done in manifest.config.ts).
 *
 * Extension origin only (background, popup, options page). The content script must use
 * `send('archive/stats', {})` instead. Assistant messages are never stored: only `OwnMessage`s.
 * Dates are stored in `toISOString()` form (the importer normalizes them), so the `by-date`
 * index's string order is chronological.
 */
import type { ChatOrigin, ImportedConversation, OwnMessage } from '@/types'
import type { ArchiveStats, HandlerMap } from '@/messages'
import { getDb, type ConversationMeta } from './db'

export { getDb, resetDbForTests } from './db'
export type { ConversationMeta, StoredProfile, CachedTailoredPage, TailorDB } from './db'

/** Store exactly the OwnMessage fields, tied to the conversation it is saved under. */
function toStoredMessage(m: OwnMessage, c: ImportedConversation): OwnMessage {
  return { id: m.id, conversationId: c.id, origin: c.origin, title: m.title || c.title, date: m.date, text: m.text }
}

/**
 * Upsert conversations (metadata) and their own messages, in one readwrite transaction.
 * A re-imported conversation replaces the old one: its messages that are no longer present are deleted,
 * so `messageCount` always matches what is stored. Conversations with no messages are not written.
 * Returns what was written.
 */
export async function saveConversations(
  conversations: ImportedConversation[],
): Promise<{ conversations: number; messages: number }> {
  const db = await getDb()
  const tx = db.transaction(['conversations', 'messages'], 'readwrite')
  const done = tx.done
  done.catch(() => {}) // awaited below; this only prevents an unhandled rejection if we abort early
  // A failed request aborts the transaction and its error surfaces via `done`, so per-request errors are ignored.
  const ignore = (): void => {}
  const convStore = tx.objectStore('conversations')
  const msgStore = tx.objectStore('messages')
  const byConversation = msgStore.index('by-conversation')
  // One batch per conversation id (a duplicated conversation in the input is merged, later wins).
  const byId = new Map<string, { c: ImportedConversation; messages: Map<string, OwnMessage> }>()
  for (const c of conversations) {
    const batch = byId.get(c.id) ?? { c, messages: new Map<string, OwnMessage>() }
    batch.c = c
    for (const m of c.messages) batch.messages.set(m.id, toStoredMessage(m, c))
    byId.set(c.id, batch)
  }
  const batches = [...byId.values()].filter((b) => b.messages.size > 0)
  let convCount = 0
  let msgCount = 0

  try {
    // All reads in parallel inside the same transaction, then all writes.
    const existing = await Promise.all(batches.map((b) => byConversation.getAllKeys(b.c.id)))
    batches.forEach(({ c, messages }, i) => {
      for (const key of existing[i]) if (!messages.has(key)) msgStore.delete(key).catch(ignore)
      for (const m of messages.values()) msgStore.put(m).catch(ignore)
      const meta: ConversationMeta = {
        id: c.id,
        origin: c.origin,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: messages.size,
      }
      convStore.put(meta).catch(ignore)
      convCount++
      msgCount += messages.size
    })
  } catch (err) {
    try {
      tx.abort()
    } catch {
      // already finished or aborted
    }
    throw err
  }
  await done
  return { conversations: convCount, messages: msgCount }
}

export interface GetMessagesOptions {
  origin?: ChatOrigin
  /** ISO date; only messages on or after it. */
  since?: string
  /** ISO date; only messages before it (held-out split for the eval, §8.1). */
  before?: string
  limit?: number
}

/** Bring a caller's date bound into the stored `toISOString()` form so string comparison is correct. */
function normalizeBound(date: string): string {
  const t = Date.parse(date)
  return Number.isFinite(t) ? new Date(t).toISOString() : date
}

/** Own messages, newest first (ties: higher id first). */
export async function getOwnMessages(options: GetMessagesOptions = {}): Promise<OwnMessage[]> {
  const { origin, limit } = options
  if (limit !== undefined && limit <= 0) return []
  const since = options.since ? normalizeBound(options.since) : undefined
  const before = options.before ? normalizeBound(options.before) : undefined
  if (since && before && since >= before) return []

  let range: IDBKeyRange | undefined
  if (since && before) range = IDBKeyRange.bound(since, before, false, true)
  else if (since) range = IDBKeyRange.lowerBound(since)
  else if (before) range = IDBKeyRange.upperBound(before, true)

  const db = await getDb()
  const index = db.transaction('messages').store.index('by-date')
  const out: OwnMessage[] = []
  let cursor = await index.openCursor(range, 'prev')
  while (cursor) {
    if (!origin || cursor.value.origin === origin) {
      out.push(cursor.value)
      if (limit !== undefined && out.length >= limit) break
    }
    cursor = await cursor.continue()
  }
  return out
}

/** Counts plus the date span. `from` / `to` are '' when the archive is empty. */
export async function getArchiveStats(): Promise<ArchiveStats> {
  const db = await getDb()
  const tx = db.transaction(['conversations', 'messages'])
  const convStore = tx.objectStore('conversations')
  const msgStore = tx.objectStore('messages')
  const byDate = msgStore.index('by-date')
  const [conversations, messages, oldest, newest, gptConvs, gptMsgs, claudeConvs, claudeMsgs] = await Promise.all([
    convStore.count(),
    msgStore.count(),
    byDate.openCursor(null, 'next'),
    byDate.openCursor(null, 'prev'),
    convStore.index('by-origin').count('chatgpt'),
    msgStore.index('by-origin').count('chatgpt'),
    convStore.index('by-origin').count('claude'),
    msgStore.index('by-origin').count('claude'),
  ])
  return {
    conversations,
    messages,
    from: oldest?.value.date ?? '',
    to: newest?.value.date ?? '',
    byOrigin: {
      chatgpt: { conversations: gptConvs, messages: gptMsgs },
      claude: { conversations: claudeConvs, messages: claudeMsgs },
    },
  }
}

/** Delete every conversation and own message. Profiles, interactions and the tailored cache are untouched. */
export async function clearArchive(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['conversations', 'messages'], 'readwrite')
  await Promise.all([tx.objectStore('conversations').clear(), tx.objectStore('messages').clear(), tx.done])
}

export const handlers: HandlerMap = {
  'archive/stats': async () => getArchiveStats(),
}
