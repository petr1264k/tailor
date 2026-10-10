/**
 * Import (CONTEXT.txt §3.1). Owner: Mikhail.
 *
 * Input: ONE file. `conversations.json` from a ChatGPT export (Settings › Data controls › Export data)
 * or the conversations file from a Claude export (Settings › Privacy › Export data). Never the zip.
 * Output: the user's own messages only; assistant turns are dropped before anything is stored.
 * Limits: last 6–12 months and a token cap, newest first.
 */
import type { ChatOrigin, ImportedConversation, ImportOptions } from '@/types'
import type { HandlerMap } from '@/messages'
import { saveConversations } from '@/archive'
import { todo } from '@/todo'

export const DEFAULT_IMPORT_OPTIONS: Required<ImportOptions> = { months: 12, tokenCap: 400_000 }

/** Sniff the shape of a parsed export file. */
export function detectExportFormat(json: unknown): ChatOrigin | 'unknown' {
  void json
  return todo('import.detectExportFormat', 'ChatGPT: array of {title, mapping, create_time}; Claude: array of {uuid, name, chat_messages}')
}

/** ChatGPT `conversations.json`: walk each `mapping` tree, keep `author.role === "user"` text parts. */
export function parseChatGptExport(json: unknown, options: ImportOptions = {}): ImportedConversation[] {
  void json
  void options
  return todo('import.parseChatGptExport')
}

/** Claude export: keep `sender === "human"` messages. */
export function parseClaudeExport(json: unknown, options: ImportOptions = {}): ImportedConversation[] {
  void json
  void options
  return todo('import.parseClaudeExport')
}

export function parseExport(json: unknown, origin: ChatOrigin, options: ImportOptions = {}): ImportedConversation[] {
  return origin === 'chatgpt' ? parseChatGptExport(json, options) : parseClaudeExport(json, options)
}

/** Apply the months window and the token cap, newest first. Rough tokens = chars / 4. */
export function applyLimits(conversations: ImportedConversation[], options: ImportOptions = {}): ImportedConversation[] {
  void conversations
  void options
  return todo('import.applyLimits')
}

export const handlers: HandlerMap = {
  'import/run': async (msg) => {
    const parsed = applyLimits(parseExport(msg.json, msg.origin, msg.options), msg.options)
    const written = await saveConversations(parsed)
    return { ...written, skippedMessages: 0 }
  },
}
