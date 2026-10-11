/**
 * Claude export extras (CONTEXT.txt §3.1): the files besides the conversations file.
 * - memories JSON: notes Claude keeps about the person. The assistant's words, third person → kind 'memory'.
 * - one JSON per project: its description and instructions, written by the person → kind 'project'.
 * Each note or project becomes an ImportedConversation of OwnMessage-shaped items, so extraction can cite them
 * like messages. Starter projects and attached project docs are skipped (docs are pasted material, not the person).
 * `project_memories` is skipped: the same notes appear under memory_files /projects/.
 */
import type { ImportedConversation, OwnMessage } from '@/types'
import { toIsoDate } from './parse'

export type ClaudeExtraKind = 'memories' | 'project'

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined)

/** Longest item the extractor reads whole (src/extract shows the first 2,000 characters of a message). */
const MAX_PART_CHARS = 1800

/** Which extra file this is, or null for anything else (including the conversations file). */
export function detectClaudeExtra(json: unknown): ClaudeExtraKind | null {
  if (!isObj(json)) return null
  if (typeof json.conversations_memory === 'string' || Array.isArray(json.memory_files)) return 'memories'
  if (typeof json.uuid === 'string' && typeof json.name === 'string' && ('prompt_template' in json || 'docs' in json)) {
    return 'project'
  }
  return null
}

/** Drop a leading front-matter block but keep its description line; drop "[stated]"-style tags on list items. */
export function cleanNote(text: string): string {
  let body = text.replace(/\r\n/g, '\n').trim()
  let description = ''
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body)
  if (fm) {
    description = /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
    body = body.slice(fm[0].length)
  }
  body = body.replace(/^(\s*[-*]\s+)\[[a-z-]+\]\s*/gim, '$1').trim()
  return [description, body].filter(Boolean).join('\n')
}

/** Split at line breaks into parts of at most `max` characters; a single longer line is cut. */
export function splitText(text: string, max = MAX_PART_CHARS): string[] {
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const pieces = line.length > max ? (line.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) ?? []) : [line]
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > max) {
        parts.push(current.trim())
        current = ''
      }
      current = current ? `${current}\n${piece}` : piece
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts.filter(Boolean)
}

function toConversation(id: string, title: string, date: string, kind: 'memory' | 'project', text: string): ImportedConversation | null {
  const messages: OwnMessage[] = splitText(text).map((part, i) => ({
    id: `${id}:${i}`,
    conversationId: id,
    origin: 'claude',
    title,
    date,
    text: part,
    kind,
  }))
  return messages.length ? { id, origin: 'claude', title, createdAt: date, updatedAt: date, messages } : null
}

/** Parse a memories or project file from a Claude export. Returns [] for anything else. */
export function parseClaudeExtra(json: unknown): ImportedConversation[] {
  const kind = detectClaudeExtra(json)
  if (!kind || !isObj(json)) return []

  if (kind === 'project') {
    if (json.is_starter_project === true) return []
    const name = str(json.name)?.trim() || 'Untitled project'
    const text = [str(json.description), str(json.prompt_template)]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join('\n')
    const date = toIsoDate(json.created_at) ?? toIsoDate(json.updated_at)
    if (!text || !date) return []
    const c = toConversation(`claude-project:${str(json.uuid)}`, `Claude project · ${name}`, date, 'project', text)
    return c ? [c] : []
  }

  const out: ImportedConversation[] = []
  const add = (c: ImportedConversation | null) => {
    if (c) out.push(c)
  }
  const files = Array.isArray(json.memory_files) ? json.memory_files.filter(isObj) : []
  // The summary has no date of its own: use the newest note's.
  const newest = files
    .map((f) => toIsoDate(f.updated_at))
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)
  const summary = str(json.conversations_memory)?.trim()
  if (summary && newest) add(toConversation('claude-memory:summary', 'Claude memory · summary', newest, 'memory', summary))
  for (const f of files) {
    const path = str(f.path)
    const content = str(f.content)
    const date = toIsoDate(f.updated_at)
    if (!path || !content?.trim() || !date) continue
    const name = path.replace(/\/+$/, '').split('/').pop()!.replace(/\.md$/i, '')
    add(toConversation(`claude-memory:${path}`, `Claude memory · ${name}`, date, 'memory', cleanNote(content)))
  }
  return out
}
