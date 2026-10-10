// End to end: export JSON → 'import/run' handler → IndexedDB (fake). Synthetic fixtures only.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getArchiveStats, getOwnMessages, resetDbForTests } from '@/archive'
import { handlers, runImport } from '@/import'

const sender = {} as chrome.runtime.MessageSender
const day = (iso: string) => Date.parse(iso) / 1000

const userNode = (id: string, parent: string, children: string[], text: string, at: string) => ({
  id,
  parent,
  children,
  message: { author: { role: 'user' }, create_time: day(at), content: { content_type: 'text', parts: [text] } },
})

const chatgptExport = [
  {
    title: 'Recent',
    id: 'recent',
    create_time: day('2025-12-01T00:00:00Z'),
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'], message: null },
      u1: userNode('u1', 'root', ['a1'], 'just got a PS5, which TV should I get?', '2025-12-01T00:00:00Z'),
      a1: { id: 'a1', parent: 'u1', children: ['u2'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['…'] } } },
      u2: userNode('u2', 'a1', ['bad'], 'will it work with my PS5?', '2025-12-02T00:00:00Z'),
      bad: { id: 'bad', parent: 'u2', children: [], message: 'garbage' }, // malformed: skipped + counted
    },
  },
  {
    title: 'Old', // outside the 12-month window: dropped by limits + counted
    id: 'old',
    create_time: day('2023-01-01T00:00:00Z'),
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'], message: null },
      u1: userNode('u1', 'root', [], 'an old question', '2023-01-01T00:00:00Z'),
    },
  },
  { title: 'Broken', mapping: 'nope' }, // malformed conversation: skipped, never thrown
]

const claudeExport = [
  {
    uuid: 'c1',
    name: 'Bullets please',
    created_at: '2025-11-01T00:00:00Z',
    chat_messages: [
      { uuid: 'h1', sender: 'human', text: 'answer in bullet points', created_at: '2025-11-01T00:00:01Z' },
      { uuid: 'a1', sender: 'assistant', text: 'Sure', created_at: '2025-11-01T00:00:02Z' },
    ],
  },
]

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDbForTests()
})

describe("'import/run'", () => {
  it('stores own messages only and reports real skipped counts', async () => {
    const res = await handlers['import/run']!({ type: 'import/run', origin: 'chatgpt', json: chatgptExport }, sender)
    expect(res).toMatchObject({ origin: 'chatgpt', conversations: 1, messages: 2, skippedMessages: 2 })
    expect((await getOwnMessages()).map((m) => m.text)).toEqual(['will it work with my PS5?', 'just got a PS5, which TV should I get?'])
  })

  it('imports both origins side by side; re-importing is idempotent', async () => {
    await handlers['import/run']!({ type: 'import/run', origin: 'chatgpt', json: chatgptExport }, sender)
    await handlers['import/run']!({ type: 'import/run', origin: 'claude', json: claudeExport }, sender)
    await handlers['import/run']!({ type: 'import/run', origin: 'claude', json: claudeExport }, sender)
    const stats = await getArchiveStats()
    expect(stats).toMatchObject({
      conversations: 2,
      messages: 3,
      from: '2025-11-01T00:00:01.000Z',
      to: '2025-12-02T00:00:00.000Z',
      byOrigin: { chatgpt: { conversations: 1, messages: 2 }, claude: { conversations: 1, messages: 1 } },
    })
  })

  it('respects options and breaks the counts down in runImport', async () => {
    const res = await runImport(chatgptExport, 'chatgpt', { months: Number.POSITIVE_INFINITY, tokenCap: 12 })
    // tokens: 'will it work with my PS5?' = 7, the PS5 question = 10 → only the newest fits under 12
    expect(res).toEqual({ origin: 'chatgpt', conversations: 1, messages: 1, skippedMessages: 3, droppedByLimits: 2, skippedConversations: 1 })
  })

  it('uses the detected format when the requested origin is wrong, accepts raw text', async () => {
    const res = await runImport(JSON.stringify(claudeExport), 'chatgpt')
    expect(res.origin).toBe('claude')
    expect(res.messages).toBe(1)
  })

  it('throws a clear error only when the whole file is wrong', async () => {
    await expect(runImport({ hello: 'world' }, 'chatgpt')).rejects.toThrow(/conversations\.json/)
    await expect(runImport([{ foo: 1 }])).rejects.toThrow(/ChatGPT or Claude/)
    expect(await runImport([], 'claude')).toMatchObject({ conversations: 0, messages: 0, skippedMessages: 0 })
  })
})
