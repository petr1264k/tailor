/**
 * Archive of the user's OWN messages (CONTEXT.txt §3.1, §5). Owner: Mikhail.
 * IndexedDB via `db.ts`. Request the unlimitedStorage permission (done in manifest.config.ts).
 */
import type { ChatOrigin, ImportedConversation, OwnMessage } from '@/types'
import type { ArchiveStats, HandlerMap } from '@/messages'
import { todo } from '@/todo'

export { getDb, resetDbForTests } from './db'
export type { ConversationMeta, StoredProfile, CachedTailoredPage, TailorDB } from './db'

/** Upsert conversations (metadata) and their own messages. Returns what was written. */
export async function saveConversations(
  conversations: ImportedConversation[],
): Promise<{ conversations: number; messages: number }> {
  void conversations
  return todo('archive.saveConversations', 'write metadata + messages in one transaction')
}

export interface GetMessagesOptions {
  origin?: ChatOrigin
  /** ISO date; only messages on or after it. */
  since?: string
  /** ISO date; only messages before it (held-out split for the eval, §8.1). */
  before?: string
  limit?: number
}

/** Own messages, newest first. */
export async function getOwnMessages(options: GetMessagesOptions = {}): Promise<OwnMessage[]> {
  void options
  return todo('archive.getOwnMessages')
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  return todo('archive.getArchiveStats', 'conversations, messages, from, to, byOrigin')
}

export async function clearArchive(): Promise<void> {
  return todo('archive.clearArchive')
}

export const handlers: HandlerMap = {
  'archive/stats': async () => getArchiveStats(),
}
