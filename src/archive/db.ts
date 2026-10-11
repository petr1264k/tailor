/**
 * The one IndexedDB database. Extension origin only (popup, options page, service worker).
 * The content script runs in the page origin and must not open this.
 * Stores: conversations (metadata), messages (own messages), profiles, interactions, tailored (cache).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChatOrigin, ImportedConversation, Interaction, OmittedItem, OwnMessage, Profile, TailoredPage } from '@/types'

export type ConversationMeta = Omit<ImportedConversation, 'messages'> & { messageCount: number }

export interface StoredProfile extends Profile {
  id: string
  /** Display name for the demo, e.g. "Mikhail" / "Petr". */
  name: string
  updatedAt: string
  /** "Left out on purpose" rows from a loaded profile file (profile.loadProfileFile). Kept across saves. */
  omitted?: OmittedItem[]
}

export interface CachedTailoredPage extends TailoredPage {
  /** `${profileId}|${profileVersion}|${url}` */
  key: string
  cachedAt: string
  /** src/tailor/cache.ts CACHE_FORMAT. Entries without it (or with an older number) are treated as misses. */
  format?: number
}

export interface TailorDB extends DBSchema {
  conversations: { key: string; value: ConversationMeta; indexes: { 'by-origin': ChatOrigin } }
  messages: { key: string; value: OwnMessage; indexes: { 'by-date': string; 'by-conversation': string; 'by-origin': ChatOrigin } }
  profiles: { key: string; value: StoredProfile }
  interactions: { key: number; value: Interaction; indexes: { 'by-url': string } }
  tailored: { key: string; value: CachedTailoredPage }
}

export const DB_NAME = 'tailor'
export const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<TailorDB>> | null = null

export function getDb(): Promise<IDBPDatabase<TailorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TailorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const conversations = db.createObjectStore('conversations', { keyPath: 'id' })
        conversations.createIndex('by-origin', 'origin')
        const messages = db.createObjectStore('messages', { keyPath: 'id' })
        messages.createIndex('by-date', 'date')
        messages.createIndex('by-conversation', 'conversationId')
        messages.createIndex('by-origin', 'origin')
        db.createObjectStore('profiles', { keyPath: 'id' })
        const interactions = db.createObjectStore('interactions', { autoIncrement: true })
        interactions.createIndex('by-url', 'url')
        db.createObjectStore('tailored', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

/** Tests: drop the cached connection so a fresh fake IndexedDB can be used. */
export function resetDbForTests(): void {
  dbPromise = null
}
