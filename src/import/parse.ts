/**
 * Export parsers (CONTEXT.txt §3.1). Pure functions, no IndexedDB, no model.
 *
 * Both exports are untrusted, loosely shaped JSON. Rules:
 * - keep only the user's own messages (ChatGPT `author.role === 'user'`, Claude `sender === 'human'`);
 *   assistant/system/tool turns are dropped here, before anything is stored;
 * - ignore unknown fields; a missing message date falls back to the conversation's date;
 * - one bad conversation or message is skipped and counted, never thrown.
 * Limits (months window, token cap) are NOT applied here: see `applyLimits` in ./limits.ts.
 */
import type { ChatOrigin, ImportedConversation, OwnMessage } from '@/types'

export interface ParseResult {
  conversations: ImportedConversation[]
  /** Conversations that were not objects or had no readable message list. */
  skippedConversations: number
  /** Own messages that were malformed or had no usable date. Empty / image-only messages are not counted. */
  skippedMessages: number
}

type Obj = Record<string, unknown>

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined
}

/**
 * Normalize a date to `Date#toISOString()` form. All stored dates use this exact form so the
 * IndexedDB `by-date` index (string order) is also chronological order.
 * Numbers are unix seconds (ChatGPT, may be fractional); values > 1e12 are taken as milliseconds.
 */
export function toIsoDate(value: unknown): string | undefined {
  let ms: number
  if (typeof value === 'number') ms = value > 1e12 ? value : value * 1000
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value)
  else return undefined
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  // Outside this range toISOString() changes shape (e.g. "+010000-…") and would break string ordering.
  if (!(year >= 1990 && year <= 2200)) return undefined // also catches NaN (invalid Date)
  return d.toISOString()
}

/**
 * Accept the parsed `conversations.json` (an array), its raw text, or a `{ conversations: [...] }` wrapper.
 * Returns null when it is none of these.
 */
export function unwrapExport(json: unknown): unknown[] | null {
  let value = json
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) return value
  if (isObj(value) && Array.isArray(value.conversations)) return value.conversations
  return null
}

/** Sniff the export shape from the first conversation-like entries. */
export function detectFormat(json: unknown): ChatOrigin | 'unknown' {
  const list = unwrapExport(json)
  if (!list) return 'unknown'
  for (const entry of list.slice(0, 20)) {
    if (!isObj(entry)) continue
    if (isObj(entry.mapping)) return 'chatgpt'
    if (Array.isArray(entry.chat_messages)) return 'claude'
  }
  return 'unknown'
}

function titleOf(x: unknown): string {
  const t = str(x)?.trim()
  return t ? t : 'Untitled'
}

// ───────────────────────────── ChatGPT ─────────────────────────────

/** Text of a ChatGPT message's `content`. String parts, plus `text` of object parts (voice transcriptions). */
function chatGptText(content: Obj): string | undefined {
  if (Array.isArray(content.parts)) {
    const pieces: string[] = []
    for (const part of content.parts) {
      if (typeof part === 'string') pieces.push(part)
      else if (isObj(part) && typeof part.text === 'string') pieces.push(part.text)
    }
    return pieces.join('\n')
  }
  return str(content.text)
}

/**
 * Node ids in chronological order: depth-first from the root(s) through `children` (iterative, so very
 * long threads can't overflow the stack). All branches are kept: edited prompts are still the user's words.
 * Several roots (broken parent links) are walked in `create_time` order; nodes the walk cannot reach
 * (cycles) are appended sorted by `create_time`.
 */
function orderChatGptNodes(mapping: Obj): string[] {
  const ids = Object.keys(mapping)
  const node = (id: string): Obj => (isObj(mapping[id]) ? mapping[id] : {})
  const time = (id: string): number => {
    const msg = node(id).message
    const t = isObj(msg) ? msg.create_time : undefined
    return typeof t === 'number' && Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  const byTime = (a: string, b: string): number => time(a) - time(b) || 0
  const roots = ids
    .filter((id) => {
      const parent = str(node(id).parent)
      return !parent || !Object.hasOwn(mapping, parent)
    })
    .sort(byTime)
  const visited = new Set<string>()
  const order: string[] = []
  const stack = [...roots].reverse()
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id) || !Object.hasOwn(mapping, id)) continue
    visited.add(id)
    order.push(id)
    const children = Array.isArray(node(id).children) ? (node(id).children as unknown[]) : []
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (typeof child === 'string') stack.push(child)
    }
  }
  const rest = ids.filter((id) => !visited.has(id)).sort(byTime)
  return order.concat(rest)
}

/** ChatGPT `conversations.json` → own messages per conversation. */
export function parseChatGpt(json: unknown): ParseResult {
  const result: ParseResult = { conversations: [], skippedConversations: 0, skippedMessages: 0 }
  const list = unwrapExport(json)
  if (!list) return result

  list.forEach((raw, index) => {
    try {
      if (!isObj(raw) || !isObj(raw.mapping)) {
        result.skippedConversations++
        return
      }
      const mapping = raw.mapping
      const key = str(raw.conversation_id) ?? str(raw.id) ?? String(index)
      const id = `chatgpt:${key}`
      const title = titleOf(raw.title)
      const convDate = toIsoDate(raw.create_time) ?? toIsoDate(raw.update_time)

      const messages: OwnMessage[] = []
      for (const nodeId of orderChatGptNodes(mapping)) {
        const node = mapping[nodeId]
        if (!isObj(node) || node.message == null) continue // root / placeholder nodes carry no message
        const msg = node.message
        if (!isObj(msg)) {
          result.skippedMessages++
          continue
        }
        const author = isObj(msg.author) ? msg.author : undefined
        if (author?.role !== 'user') continue // own messages only (§3.1)
        const meta = isObj(msg.metadata) ? msg.metadata : {}
        if (meta.is_visually_hidden_from_conversation === true) continue // custom-instructions context, not typed by the user
        if (!isObj(msg.content)) {
          result.skippedMessages++
          continue
        }
        if (msg.content.content_type === 'user_editable_context') continue
        const text = chatGptText(msg.content)?.trim()
        if (text === undefined) {
          result.skippedMessages++
          continue
        }
        if (!text) continue // image-only / empty
        const date = toIsoDate(msg.create_time) ?? convDate
        if (!date) {
          result.skippedMessages++
          continue
        }
        messages.push({ id: `chatgpt:${key}:${nodeId}`, conversationId: id, origin: 'chatgpt', title, date, text })
      }
      if (!messages.length) return

      const createdAt = convDate ?? messages[0].date
      const updatedAt = toIsoDate(raw.update_time) ?? messages[messages.length - 1].date
      result.conversations.push({ id, origin: 'chatgpt', title, createdAt, updatedAt, messages })
    } catch {
      result.skippedConversations++
    }
  })
  return result
}

// ───────────────────────────── Claude ─────────────────────────────

/** Prefer `text`; otherwise join the `text` content blocks. Tool use, attachments and files are not the user's words. */
function claudeText(msg: Obj): string | undefined {
  const text = str(msg.text)
  if (text?.trim()) return text
  if (Array.isArray(msg.content)) {
    const pieces = msg.content
      .filter((c): c is Obj => isObj(c) && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
    return pieces.join('\n')
  }
  return text
}

/** Claude export `conversations.json` → own messages per conversation. */
export function parseClaude(json: unknown): ParseResult {
  const result: ParseResult = { conversations: [], skippedConversations: 0, skippedMessages: 0 }
  const list = unwrapExport(json)
  if (!list) return result

  list.forEach((raw, index) => {
    try {
      if (!isObj(raw) || !Array.isArray(raw.chat_messages)) {
        result.skippedConversations++
        return
      }
      const key = str(raw.uuid) ?? String(index)
      const id = `claude:${key}`
      const title = titleOf(raw.name)
      const convDate = toIsoDate(raw.created_at) ?? toIsoDate(raw.updated_at)

      const messages: OwnMessage[] = []
      raw.chat_messages.forEach((msg, msgIndex) => {
        if (!isObj(msg)) {
          result.skippedMessages++
          return
        }
        if (msg.sender !== 'human') return // own messages only (§3.1)
        const text = claudeText(msg)?.trim()
        if (text === undefined) {
          result.skippedMessages++
          return
        }
        if (!text) return
        const date = toIsoDate(msg.created_at) ?? convDate
        if (!date) {
          result.skippedMessages++
          return
        }
        const msgKey = str(msg.uuid) ?? String(msgIndex)
        messages.push({ id: `claude:${key}:${msgKey}`, conversationId: id, origin: 'claude', title, date, text })
      })
      if (!messages.length) return

      const createdAt = convDate ?? messages[0].date
      const updatedAt = toIsoDate(raw.updated_at) ?? messages[messages.length - 1].date
      result.conversations.push({ id, origin: 'claude', title, createdAt, updatedAt, messages })
    } catch {
      result.skippedConversations++
    }
  })
  return result
}
