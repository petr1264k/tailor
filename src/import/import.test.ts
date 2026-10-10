// Synthetic fixtures only. Never commit a real export (personal data; conversations.json is gitignored).
import { describe, expect, it } from 'vitest'
import type { ImportedConversation, OwnMessage } from '@/types'
import {
  applyLimits,
  detectExportFormat,
  estimateTokens,
  parseChatGptExport,
  parseClaudeExport,
  parseExportDetailed,
  toIsoDate,
} from '@/import'

const user = (text: string | unknown[], create_time?: number | null, extra: Record<string, unknown> = {}) => ({
  author: { role: 'user' },
  create_time,
  content: { content_type: 'text', parts: typeof text === 'string' ? [text] : text },
  ...extra,
})
const assistant = (text: string) => ({ author: { role: 'assistant' }, content: { content_type: 'text', parts: [text] } })

/** ChatGPT conversations.json shape (§3.1). Keys deliberately out of order; one branch from an edited prompt. */
const chatgptExport = [
  {
    title: 'TV for my PS5',
    conversation_id: 'conv-a',
    create_time: 1717200000.5, // 2024-06-01T00:00:00.500Z
    update_time: 1717203600,
    current_node: 'u3',
    unknown_field: { ignored: true },
    mapping: {
      u2: { id: 'u2', parent: 'a1', children: ['a2'], message: user([{ content_type: 'image_asset_pointer' }, 'under $800 please'], 1717200300) },
      root: { id: 'root', parent: null, children: ['sys', 'ctx'], message: null },
      sys: { id: 'sys', parent: 'root', children: [], message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] } } },
      ctx: {
        id: 'ctx',
        parent: 'root',
        children: ['u1'],
        message: {
          author: { role: 'user' },
          content: { content_type: 'user_editable_context', user_profile: 'I am a developer' },
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
      u1: { id: 'u1', parent: 'ctx', children: ['a1'], message: user('just got a PS5, which TV should I get?', 1717200100) },
      a1: { id: 'a1', parent: 'u1', children: ['u2', 'u2b'], message: assistant('Here are some TVs') },
      u2b: { id: 'u2b', parent: 'a1', children: [], message: user('edited: what about OLED?', 1717200400) },
      a2: { id: 'a2', parent: 'u2', children: ['u3', 'blank', 'bad', 'nocontent'], message: assistant('Sure') },
      u3: { id: 'u3', parent: 'a2', children: [], message: user('will it work with my PS5?', null) }, // no date → conversation date
      blank: { id: 'blank', parent: 'a2', children: [], message: user('   ') }, // whitespace-only: dropped, not counted
      bad: { id: 'bad', parent: 'a2', children: [], message: 'garbage' }, // malformed: counted
      nocontent: { id: 'nocontent', parent: 'a2', children: [], message: { author: { role: 'user' } } }, // malformed: counted
    },
  },
  'not a conversation', // malformed conversation: counted
  { title: 'No mapping' }, // malformed conversation: counted
  {
    title: 'Assistant only',
    id: 'conv-b',
    create_time: 1717300000,
    mapping: { r: { id: 'r', parent: null, children: ['a'], message: null }, a: { id: 'a', parent: 'r', children: [], message: assistant('hi') } },
  },
  {
    // no conversation_id / id → index-based id; no children links → create_time fallback order
    title: '',
    create_time: 1717400000,
    mapping: {
      late: { parent: 'gone', message: user('second', 1717400200) },
      early: { parent: 'missing', message: user('first', 1717400100) },
    },
  },
]

/** Claude conversations.json shape (§3.1). */
const claudeExport = [
  {
    uuid: 'c1',
    name: 'Rust lifetimes',
    created_at: '2025-01-10T09:00:00.000000Z',
    updated_at: '2025-01-10T10:00:00.000000Z',
    account: { uuid: 'ignored' },
    chat_messages: [
      { uuid: 'h1', sender: 'human', text: 'explain lifetimes like I know C++', created_at: '2025-01-10T09:00:01.123456Z' },
      { uuid: 'a1', sender: 'assistant', text: 'Sure, here goes', created_at: '2025-01-10T09:00:05Z' },
      {
        uuid: 'h2',
        sender: 'human',
        text: '',
        content: [{ type: 'text', text: 'use bullet points' }, { type: 'tool_use', input: {} }, { type: 'text', text: 'please' }],
        created_at: '2025-01-10T09:01:00Z',
      },
      { uuid: 'h3', sender: 'human', text: 'no date on this one' },
      { uuid: 'h4', sender: 'human', text: '   ', created_at: '2025-01-10T09:02:00Z' },
      42, // malformed: counted
      { uuid: 'h5', sender: 'human', created_at: '2025-01-10T09:03:00Z' }, // no text at all: counted
    ],
  },
  { uuid: 'c2', name: 'broken', chat_messages: 'nope' }, // malformed conversation
  null, // malformed conversation
  { uuid: 'c3', name: 'Only Claude talking', created_at: '2025-02-01T00:00:00Z', chat_messages: [{ sender: 'assistant', text: 'hello' }] },
]

describe('detectExportFormat', () => {
  it('sniffs both formats, raw text and a { conversations } wrapper', () => {
    expect(detectExportFormat(chatgptExport)).toBe('chatgpt')
    expect(detectExportFormat(claudeExport)).toBe('claude')
    expect(detectExportFormat(JSON.stringify(claudeExport))).toBe('claude')
    expect(detectExportFormat({ conversations: chatgptExport })).toBe('chatgpt')
  })
  it('returns unknown for anything else', () => {
    expect(detectExportFormat([])).toBe('unknown')
    expect(detectExportFormat({})).toBe('unknown')
    expect(detectExportFormat('not json')).toBe('unknown')
    expect(detectExportFormat([{ foo: 1 }])).toBe('unknown')
    expect(detectExportFormat(null)).toBe('unknown')
  })
})

describe('toIsoDate', () => {
  it('normalizes unix seconds, milliseconds and ISO strings to toISOString form', () => {
    expect(toIsoDate(1717200000.5)).toBe('2024-06-01T00:00:00.500Z')
    expect(toIsoDate(1717200000500)).toBe('2024-06-01T00:00:00.500Z')
    expect(toIsoDate('2025-01-10T09:00:01.123456+00:00')).toBe('2025-01-10T09:00:01.123Z')
  })
  it('rejects missing or absurd values', () => {
    for (const v of [null, undefined, '', 'yesterday', 0, -5, Number.NaN, 1e20]) expect(toIsoDate(v)).toBeUndefined()
  })
})

describe('parseChatGptExport', () => {
  const result = parseExportDetailed(chatgptExport, 'chatgpt')

  it('keeps only user text, walking the tree in order, all branches', () => {
    const conv = result.conversations.find((c) => c.id === 'chatgpt:conv-a')!
    expect(conv.messages.map((m) => m.text)).toEqual([
      'just got a PS5, which TV should I get?',
      'under $800 please',
      'will it work with my PS5?',
      'edited: what about OLED?',
    ])
    expect(conv.messages.map((m) => m.id)).toEqual(['chatgpt:conv-a:u1', 'chatgpt:conv-a:u2', 'chatgpt:conv-a:u3', 'chatgpt:conv-a:u2b'])
    expect(conv).toMatchObject({
      origin: 'chatgpt',
      title: 'TV for my PS5',
      createdAt: '2024-06-01T00:00:00.500Z',
      updatedAt: '2024-06-01T01:00:00.000Z',
    })
    for (const m of conv.messages) expect(m).toMatchObject({ conversationId: 'chatgpt:conv-a', origin: 'chatgpt', title: 'TV for my PS5' })
  })

  it('dates messages from create_time, falling back to the conversation date', () => {
    const conv = result.conversations.find((c) => c.id === 'chatgpt:conv-a')!
    expect(conv.messages[0].date).toBe('2024-06-01T00:01:40.000Z')
    expect(conv.messages[2].date).toBe(conv.createdAt)
  })

  it('falls back to create_time order when the tree links are broken', () => {
    const conv = result.conversations.find((c) => c.id === 'chatgpt:4')!
    expect(conv.title).toBe('Untitled')
    expect(conv.messages.map((m) => m.text)).toEqual(['first', 'second'])
  })

  it('skips and counts malformed entries, drops conversations with no own messages', () => {
    expect(result.conversations.map((c) => c.id)).toEqual(['chatgpt:conv-a', 'chatgpt:4'])
    expect(result.skippedConversations).toBe(2)
    expect(result.skippedMessages).toBe(2)
    expect(parseChatGptExport(chatgptExport)).toEqual(result.conversations)
  })

  it('never throws on junk', () => {
    for (const junk of [null, 42, 'x', {}, [null, [], { mapping: null }, { mapping: { a: null, b: { message: {} } } }]]) {
      expect(() => parseChatGptExport(junk)).not.toThrow()
    }
    expect(parseExportDetailed([{ mapping: null }, 7], 'chatgpt').skippedConversations).toBe(2)
  })

  it('handles a very long thread without recursion', () => {
    const mapping: Record<string, unknown> = { root: { parent: null, children: ['n0'], message: null } }
    const n = 20_000
    for (let i = 0; i < n; i++) {
      mapping[`n${i}`] = { parent: i ? `n${i - 1}` : 'root', children: i < n - 1 ? [`n${i + 1}`] : [], message: user(`m${i}`, 1717200000 + i) }
    }
    const [conv] = parseChatGptExport([{ title: 'long', id: 'L', create_time: 1717200000, mapping }])
    expect(conv.messages).toHaveLength(n)
    expect(conv.messages[n - 1].text).toBe(`m${n - 1}`)
  })
})

describe('parseClaudeExport', () => {
  const result = parseExportDetailed(claudeExport, 'claude')

  it('keeps human messages, prefers text, else joins text content blocks', () => {
    expect(result.conversations).toHaveLength(1)
    const [conv] = result.conversations
    expect(conv).toMatchObject({
      id: 'claude:c1',
      origin: 'claude',
      title: 'Rust lifetimes',
      createdAt: '2025-01-10T09:00:00.000Z',
      updatedAt: '2025-01-10T10:00:00.000Z',
    })
    expect(conv.messages.map((m) => [m.id, m.text, m.date])).toEqual([
      ['claude:c1:h1', 'explain lifetimes like I know C++', '2025-01-10T09:00:01.123Z'],
      ['claude:c1:h2', 'use bullet points\nplease', '2025-01-10T09:01:00.000Z'],
      ['claude:c1:h3', 'no date on this one', '2025-01-10T09:00:00.000Z'],
    ])
  })

  it('skips and counts malformed entries', () => {
    expect(result.skippedConversations).toBe(2)
    expect(result.skippedMessages).toBe(2)
    expect(parseClaudeExport(claudeExport)).toEqual(result.conversations)
    expect(() => parseClaudeExport({ nope: true })).not.toThrow()
  })
})

// ───────────────────────────── applyLimits ─────────────────────────────

function msg(conv: string, n: number, date: string, text = 'x'.repeat(40)): OwnMessage {
  return { id: `${conv}:${n}`, conversationId: conv, origin: 'chatgpt', title: conv, date, text }
}
function conv(id: string, messages: OwnMessage[]): ImportedConversation {
  return { id, origin: 'chatgpt', title: id, createdAt: messages[0].date, updatedAt: messages[messages.length - 1].date, messages }
}
const ids = (cs: ImportedConversation[]) => cs.flatMap((c) => c.messages.map((m) => m.id))

describe('applyLimits', () => {
  const convs = [
    conv('old', [msg('old', 1, '2024-11-01T00:00:00.000Z'), msg('old', 2, '2025-01-20T00:00:00.000Z')]),
    conv('ancient', [msg('ancient', 1, '2023-05-01T00:00:00.000Z')]),
    conv('new', [msg('new', 1, '2025-12-15T00:00:00.000Z')]),
  ]

  it('keeps the last 12 months by default, counted back from the newest message', () => {
    const out = applyLimits(convs)
    expect(ids(out)).toEqual(['old:2', 'new:1'])
    expect(out.map((c) => c.id)).toEqual(['old', 'new']) // 'ancient' has nothing left
  })

  it('honours a shorter window', () => {
    expect(ids(applyLimits(convs, { months: 6 }))).toEqual(['new:1'])
    expect(ids(applyLimits(convs, { months: Number.POSITIVE_INFINITY }))).toEqual(['old:1', 'old:2', 'ancient:1', 'new:1'])
  })

  it('caps tokens newest first and drops everything older than the first overflow', () => {
    const c = [
      conv('a', [
        msg('a', 1, '2025-06-01T00:00:00.000Z', 'tiny'), // 1 token, fits but is older than the overflow
        msg('a', 2, '2025-06-02T00:00:00.000Z', 'y'.repeat(800)), // 200 tokens: overflows
      ]),
      conv('b', [msg('b', 1, '2025-06-03T00:00:00.000Z', 'z'.repeat(400)), msg('b', 2, '2025-06-04T00:00:00.000Z', 'z'.repeat(400))]),
    ]
    expect(estimateTokens('z'.repeat(400))).toBe(100)
    expect(ids(applyLimits(c, { tokenCap: 250 }))).toEqual(['b:1', 'b:2'])
    expect(ids(applyLimits(c, { tokenCap: 200 }))).toEqual(['b:1', 'b:2'])
    expect(ids(applyLimits(c, { tokenCap: 199 }))).toEqual(['b:2'])
    expect(ids(applyLimits(c, { tokenCap: 401 }))).toEqual(['a:1', 'a:2', 'b:1', 'b:2'])
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(convs)
    applyLimits(convs, { months: 1, tokenCap: 1 })
    expect(JSON.stringify(convs)).toBe(before)
  })
})
