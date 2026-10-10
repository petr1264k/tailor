import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatOrigin, ImportedConversation, OwnMessage } from '@/types'
import { clearArchive, getArchiveStats, getDb, getOwnMessages, handlers, resetDbForTests, saveConversations } from '@/archive'

function msg(origin: ChatOrigin, conv: string, n: number, date: string): OwnMessage {
  return { id: `${origin}:${conv}:${n}`, conversationId: `${origin}:${conv}`, origin, title: conv, date, text: `message ${n} in ${conv}` }
}
function conv(origin: ChatOrigin, id: string, messages: OwnMessage[]): ImportedConversation {
  return {
    id: `${origin}:${id}`,
    origin,
    title: id,
    createdAt: messages[0]?.date ?? '2025-01-01T00:00:00.000Z',
    updatedAt: messages[messages.length - 1]?.date ?? '2025-01-01T00:00:00.000Z',
    messages,
  }
}

const tv = conv('chatgpt', 'tv', [msg('chatgpt', 'tv', 1, '2025-03-01T10:00:00.000Z'), msg('chatgpt', 'tv', 2, '2025-03-01T10:05:00.000Z')])
const rust = conv('claude', 'rust', [msg('claude', 'rust', 1, '2025-02-01T09:00:00.000Z'), msg('claude', 'rust', 2, '2025-04-01T09:00:00.000Z')])
const trip = conv('chatgpt', 'trip', [msg('chatgpt', 'trip', 1, '2025-01-15T12:00:00.000Z')])

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDbForTests()
})

describe('archive', () => {
  it('starts empty', async () => {
    expect(await getArchiveStats()).toEqual({
      conversations: 0,
      messages: 0,
      from: '',
      to: '',
      byOrigin: { chatgpt: { conversations: 0, messages: 0 }, claude: { conversations: 0, messages: 0 } },
    })
    expect(await getOwnMessages()).toEqual([])
  })

  it('round-trips conversations and messages, newest first', async () => {
    expect(await saveConversations([tv, rust, trip, conv('claude', 'empty', [])])).toEqual({ conversations: 3, messages: 5 })
    const all = await getOwnMessages()
    expect(all.map((m) => m.id)).toEqual(['claude:rust:2', 'chatgpt:tv:2', 'chatgpt:tv:1', 'claude:rust:1', 'chatgpt:trip:1'])
    expect(all[0]).toEqual(rust.messages[1])

    const db = await getDb()
    expect(await db.get('conversations', 'chatgpt:tv')).toEqual({
      id: 'chatgpt:tv',
      origin: 'chatgpt',
      title: 'tv',
      createdAt: '2025-03-01T10:00:00.000Z',
      updatedAt: '2025-03-01T10:05:00.000Z',
      messageCount: 2,
    })
    expect(await db.get('conversations', 'claude:empty')).toBeUndefined()
  })

  it('filters by origin, since (inclusive), before (exclusive) and limit', async () => {
    await saveConversations([tv, rust, trip])
    const ids = (ms: OwnMessage[]) => ms.map((m) => m.id)
    expect(ids(await getOwnMessages({ origin: 'claude' }))).toEqual(['claude:rust:2', 'claude:rust:1'])
    expect(ids(await getOwnMessages({ since: '2025-03-01T10:05:00.000Z' }))).toEqual(['claude:rust:2', 'chatgpt:tv:2'])
    expect(ids(await getOwnMessages({ before: '2025-02-01T09:00:00.000Z' }))).toEqual(['chatgpt:trip:1'])
    // date-only bounds are normalized: whole of March, nothing from April
    expect(ids(await getOwnMessages({ since: '2025-03-01', before: '2025-04-01' }))).toEqual(['chatgpt:tv:2', 'chatgpt:tv:1'])
    expect(ids(await getOwnMessages({ origin: 'chatgpt', limit: 2 }))).toEqual(['chatgpt:tv:2', 'chatgpt:tv:1'])
    expect(await getOwnMessages({ limit: 0 })).toEqual([])
    expect(await getOwnMessages({ since: '2025-05-01', before: '2025-01-01' })).toEqual([])
  })

  it('reports stats with the date span and per-origin counts (also via the handler)', async () => {
    await saveConversations([tv, rust, trip])
    const expected = {
      conversations: 3,
      messages: 5,
      from: '2025-01-15T12:00:00.000Z',
      to: '2025-04-01T09:00:00.000Z',
      byOrigin: { chatgpt: { conversations: 2, messages: 3 }, claude: { conversations: 1, messages: 2 } },
    }
    expect(await getArchiveStats()).toEqual(expected)
    const handler = handlers['archive/stats']!
    expect(await handler({ type: 'archive/stats' }, {} as chrome.runtime.MessageSender)).toEqual(expected)
  })

  it('upserts: a re-imported conversation replaces its old messages', async () => {
    await saveConversations([tv, rust])
    const shorter = conv('chatgpt', 'tv', [msg('chatgpt', 'tv', 2, '2025-03-01T10:05:00.000Z'), msg('chatgpt', 'tv', 3, '2025-03-02T08:00:00.000Z')])
    expect(await saveConversations([shorter])).toEqual({ conversations: 1, messages: 2 })
    expect((await getOwnMessages({ origin: 'chatgpt' })).map((m) => m.id)).toEqual(['chatgpt:tv:3', 'chatgpt:tv:2'])
    const stats = await getArchiveStats()
    expect(stats.messages).toBe(4)
    expect(stats.conversations).toBe(2)
    expect((await (await getDb()).get('conversations', 'chatgpt:tv'))?.messageCount).toBe(2)
  })

  it('stores only OwnMessage fields, tied to the conversation it was saved under', async () => {
    const sneaky = { ...msg('claude', 'x', 1, '2025-05-01T00:00:00.000Z'), conversationId: 'wrong', assistantReply: 'never stored' }
    await saveConversations([conv('claude', 'x', [sneaky as OwnMessage])])
    const [stored] = await getOwnMessages()
    expect(stored).toEqual({ ...msg('claude', 'x', 1, '2025-05-01T00:00:00.000Z') })
    expect(stored).not.toHaveProperty('assistantReply')
  })

  it('clears conversations and messages', async () => {
    await saveConversations([tv, rust, trip])
    await clearArchive()
    const stats = await getArchiveStats()
    expect([stats.conversations, stats.messages, stats.from, stats.to]).toEqual([0, 0, '', ''])
    expect(await getOwnMessages()).toEqual([])
  })
})
