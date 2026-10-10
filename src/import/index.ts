/**
 * Import (CONTEXT.txt §3.1). Owner: Mikhail.
 *
 * Input: ONE file. `conversations.json` from a ChatGPT export (Settings › Data controls › Export data)
 * or the conversations file from a Claude export (Settings › Privacy › Export data). Never the zip.
 * Output: the user's own messages only; assistant turns are dropped before anything is stored.
 * Limits: last 6–12 months and a token cap, newest first.
 *
 * Easiest entry point for the UI (extension origin): `runImport(json)`. The content script must not
 * import files; it has no IndexedDB access. The background exposes the same thing as 'import/run'.
 */
import type { ChatOrigin, ImportedConversation, ImportOptions } from '@/types'
import type { HandlerMap } from '@/messages'
import { saveConversations } from '@/archive'
import { DEFAULT_LIMITS, countMessages, limitConversations } from './limits'
import { detectFormat, parseChatGpt, parseClaude, unwrapExport, type ParseResult } from './parse'

export { estimateTokens, countMessages } from './limits'
export { toIsoDate, type ParseResult } from './parse'

export const DEFAULT_IMPORT_OPTIONS: Required<ImportOptions> = DEFAULT_LIMITS

/** Sniff the shape of a parsed export file. Also accepts the raw file text or a `{ conversations }` wrapper. */
export function detectExportFormat(json: unknown): ChatOrigin | 'unknown' {
  return detectFormat(json)
}

/**
 * ChatGPT `conversations.json`: walk each `mapping` tree, keep `author.role === "user"` text parts.
 * Does not apply limits (`options` is accepted for symmetry): call `applyLimits` or use `runImport`.
 */
export function parseChatGptExport(json: unknown, options: ImportOptions = {}): ImportedConversation[] {
  void options
  return parseChatGpt(json).conversations
}

/** Claude export: keep `sender === "human"` messages. Does not apply limits (see `parseChatGptExport`). */
export function parseClaudeExport(json: unknown, options: ImportOptions = {}): ImportedConversation[] {
  void options
  return parseClaude(json).conversations
}

export function parseExport(json: unknown, origin: ChatOrigin, options: ImportOptions = {}): ImportedConversation[] {
  return origin === 'chatgpt' ? parseChatGptExport(json, options) : parseClaudeExport(json, options)
}

/** Like `parseExport`, plus how many conversations / messages were malformed and skipped. */
export function parseExportDetailed(json: unknown, origin: ChatOrigin): ParseResult {
  return origin === 'chatgpt' ? parseChatGpt(json) : parseClaude(json)
}

/** Apply the months window and the token cap, newest first. Rough tokens = chars / 4. */
export function applyLimits(conversations: ImportedConversation[], options: ImportOptions = {}): ImportedConversation[] {
  return limitConversations(conversations, options)
}

export interface ImportResult {
  /** The origin actually used: the detected format wins over the requested one. */
  origin: ChatOrigin
  /** Written to the archive. */
  conversations: number
  messages: number
  /** Own messages not stored: malformed / undated, plus `droppedByLimits`. */
  skippedMessages: number
  /** Part of `skippedMessages`: outside the months window or over the token cap. */
  droppedByLimits: number
  /** Malformed conversations skipped whole (their message count is unknown). */
  skippedConversations: number
}

/**
 * detect → parse → limits → save. Throws only when the whole file is wrong (not a conversations array,
 * or neither format and no origin given); a bad conversation inside a good file is skipped and counted.
 */
export async function runImport(json: unknown, origin?: ChatOrigin, options: ImportOptions = {}): Promise<ImportResult> {
  const list = unwrapExport(json) // parse raw text once, not once per step
  if (!list) throw new Error('Expected conversations.json from a ChatGPT or Claude export (a JSON array of conversations).')
  const detected = detectExportFormat(list)
  const used = detected !== 'unknown' ? detected : origin
  if (!used) throw new Error('This file does not look like a ChatGPT or Claude conversations.json.')

  const parsed = parseExportDetailed(list, used)
  const limited = applyLimits(parsed.conversations, options)
  const droppedByLimits = countMessages(parsed.conversations) - countMessages(limited)
  const written = await saveConversations(limited)
  return {
    origin: used,
    conversations: written.conversations,
    messages: written.messages,
    skippedMessages: parsed.skippedMessages + droppedByLimits,
    droppedByLimits,
    skippedConversations: parsed.skippedConversations,
  }
}

export const handlers: HandlerMap = {
  'import/run': async (msg) => runImport(msg.json, msg.origin, msg.options),
}
