/**
 * Extraction (CONTEXT.txt §3.2): map-reduce over the user's own messages. Owner: Mikhail (+ third engineer for prompts).
 *
 * map:    Haiku 5.5 reads chunks and proposes candidate facts, each with a short supporting quote (CandidateFactsOutputSchema).
 *         Code verifies every quote actually appears in the cited message, otherwise the candidate is dropped.
 * reduce: Sonnet 5.5 merges duplicates and scores by frequency and recency (MergedFactsOutputSchema).
 *         Code rebuilds evidence from candidate indices; the model never invents ids, dates or origins.
 * also:   mine the questions the person asks again and again (category 'question'); the first-screen eval uses them (§8.1).
 *
 * Message text is never logged (§0). Prompts live in ./prompts.ts.
 */
import type { Evidence, Fact, OwnMessage, Profile } from '@/types'
import { CandidateFactsOutputSchema, MergedFactsOutputSchema, type CandidateFact } from '@/schemas'
import type { HandlerMap } from '@/messages'
import { completeJson } from '@/llm/client'
import { getArchiveStats, getOwnMessages } from '@/archive'
import { getProfile, saveProfile, withProfileLock } from '@/profile'
import { MAP_SYSTEM, MERGE_SYSTEM } from './prompts'

export interface ExtractOptions {
  /** Rough tokens per chunk (chars / 4). Default 6000. */
  chunkTokens?: number
  /** Cap on chunks for the demo. Default 40. */
  maxChunks?: number
  /** Build the profile only from messages before this ISO date (held-out split, §8.1). Questions then come from the rest. */
  before?: string
  onProgress?: (done: number, total: number, stage: 'map' | 'reduce' | 'questions') => void
}

/** A candidate with the message it cites, after code verified the quote. */
export interface VerifiedCandidate extends CandidateFact {
  message: OwnMessage
}

const DEFAULT_CHUNK_TOKENS = 6000
const DEFAULT_MAX_CHUNKS = 40
const MAP_CONCURRENCY = 4
/** Long pastes (code, docs) say little about the person; only the head goes into the prompt. Quotes still verify. */
const MAX_MESSAGE_CHARS = 2000
const MAX_QUOTE_CHARS = 200
const MAX_FACTS = 80
const MAX_EVIDENCE = 5
/** Sonnet prompt budget; candidates arrive newest first so the cap drops the oldest. */
const MAX_MERGE_CANDIDATES = 500
const MAX_QUESTIONS = 40

// ───────────────────────────── text helpers ─────────────────────────────

/** Lowercase, straight quotes, collapsed whitespace. Used for quote matching and value identity. */
function normalizeLoose(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercase, no punctuation, collapsed whitespace (§3.2 question clustering, profile value identity). */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Finds `quote` inside `text`, ignoring case, whitespace runs and curly-vs-straight quotes, and returns the
 * ORIGINAL slice of `text` (so evidence is the user's exact words), or null when the model fabricated it.
 */
export function findVerbatim(text: string, quote: string): string | null {
  const q = normalizeLoose(quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’.…]+$/g, ''))
  if (q.length < 3) return null
  // Normalize `text` char by char, remembering where each normalized char came from.
  let norm = ''
  const origin: number[] = []
  let prevSpace = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/\s/.test(c)) {
      if (!prevSpace) {
        norm += ' '
        origin.push(i)
      }
      prevSpace = true
      continue
    }
    prevSpace = false
    const n = normalizeLoose(c) || c
    for (let k = 0; k < n.length; k++) origin.push(i) // per UTF-16 unit, matching norm.length
    norm += n
  }
  const at = norm.indexOf(q)
  if (at < 0) return null
  return text.slice(origin[at], origin[at + q.length - 1] + 1)
}

/** Cut to `max` chars at a word boundary. A prefix of a verbatim quote is still verbatim. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function weakPrior(confidence: number): Fact['prior'] {
  return { alpha: 1 + confidence, beta: 1 } // WEAK prior: clicks override it quickly (§3.8)
}

// ───────────────────────────── chunking ─────────────────────────────

/** The prompt line for one message: "[id] (origin, title, date): text". */
function messageLine(m: OwnMessage, id: string): string {
  return `[${id}] (${m.origin}, ${oneLine(m.title) || 'untitled'}, ${day(m.date)}): ${oneLine(m.text).slice(0, MAX_MESSAGE_CHARS)}`
}

/** Rough tokens (chars / 4) of the message as it appears in the prompt. */
export function estimateTokens(m: OwnMessage): number {
  return Math.ceil(messageLine(m, 'm000').length / 4)
}

/**
 * Group by conversation, newest conversation first, messages in order within a conversation; pack whole conversations
 * into chunks of ~chunkTokens; a conversation bigger than a chunk is split across consecutive chunks.
 */
export function chunkMessages(messages: OwnMessage[], chunkTokens = DEFAULT_CHUNK_TOKENS): OwnMessage[][] {
  const byConv = new Map<string, OwnMessage[]>()
  for (const m of messages) {
    const list = byConv.get(m.conversationId)
    if (list) list.push(m)
    else byConv.set(m.conversationId, [m])
  }
  const convs = [...byConv.values()].map((msgs) => {
    const sorted = [...msgs].sort((a, b) => a.date.localeCompare(b.date))
    return { msgs: sorted, newest: sorted[sorted.length - 1].date, tokens: sorted.reduce((n, m) => n + estimateTokens(m), 0) }
  })
  convs.sort((a, b) => b.newest.localeCompare(a.newest))

  const chunks: OwnMessage[][] = []
  let current: OwnMessage[] = []
  let used = 0
  const flush = () => {
    if (current.length) chunks.push(current)
    current = []
    used = 0
  }
  for (const conv of convs) {
    if (used + conv.tokens <= chunkTokens) {
      current.push(...conv.msgs)
      used += conv.tokens
      continue
    }
    if (conv.tokens <= chunkTokens) {
      flush()
      current.push(...conv.msgs)
      used = conv.tokens
      continue
    }
    // Oversized conversation: top up the open chunk, then fill chunk after chunk; the tail stays open.
    for (const m of conv.msgs) {
      const t = estimateTokens(m)
      if (used + t > chunkTokens && current.length) flush()
      current.push(m)
      used += t
    }
  }
  flush()
  return chunks
}

// ───────────────────────────── map (Haiku) ─────────────────────────────

async function proposeAndVerify(chunk: OwnMessage[]): Promise<{ proposed: number; verified: VerifiedCandidate[] }> {
  if (chunk.length === 0) return { proposed: 0, verified: [] }
  // Short local ids (m1, m2, ...): models copy them reliably; real ids are long UUIDs.
  const byId = new Map<string, OwnMessage>()
  const lines = chunk.map((m, i) => {
    const id = `m${i + 1}`
    byId.set(id, m)
    return messageLine(m, id)
  })
  const { value } = await completeJson({
    role: 'extract',
    system: MAP_SYSTEM,
    user: `Messages (newest conversation first):\n<messages>\n${lines.join('\n')}\n</messages>`,
    schema: CandidateFactsOutputSchema,
  })
  const verified: VerifiedCandidate[] = []
  for (const c of value.facts) {
    const message = byId.get(c.messageId) ?? chunk.find((m) => m.id === c.messageId)
    if (!message) continue // cites a message that is not in this chunk
    const exact = findVerbatim(message.text, c.quote)
    if (!exact) continue // quote is not in the cited message: fabricated or paraphrased
    verified.push({ ...c, quote: clip(exact, MAX_QUOTE_CHARS), messageId: message.id, message })
  }
  return { proposed: value.facts.length, verified }
}

/** Haiku map step for one chunk, then code-verify quotes. */
export async function proposeCandidates(chunk: OwnMessage[]): Promise<VerifiedCandidate[]> {
  return (await proposeAndVerify(chunk)).verified
}

// ───────────────────────────── reduce (Sonnet) ─────────────────────────────

function buildEvidence(cands: VerifiedCandidate[]): Evidence[] {
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const c of [...cands].sort((a, b) => b.message.date.localeCompare(a.message.date))) {
    const key = `${c.message.origin}|${normalizeLoose(c.quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ origin: c.message.origin, title: c.message.title, date: c.message.date, quote: c.quote })
    if (out.length === MAX_EVIDENCE) break
  }
  return out
}

/** Sonnet reduce step over all candidates; returns Facts with evidence rebuilt by code. */
export async function mergeCandidates(candidates: VerifiedCandidate[]): Promise<Fact[]> {
  if (candidates.length === 0) return []
  const list = [...candidates]
    .sort((a, b) => b.message.date.localeCompare(a.message.date))
    .slice(0, MAX_MERGE_CANDIDATES)
  const lines = list.map(
    (c, i) => `[${i}] ${c.category} | ${oneLine(c.value)} | ${JSON.stringify(c.quote)} | ${day(c.message.date)} | ${c.message.origin}`,
  )
  const { value } = await completeJson({
    role: 'merge',
    effort: 'medium',
    system: MERGE_SYSTEM,
    user: `Newest message date: ${day(list[0].message.date)}\nCandidates:\n<candidates>\n${lines.join('\n')}\n</candidates>`,
    schema: MergedFactsOutputSchema,
    maxTokens: 16000,
  })
  const facts: Fact[] = []
  for (const m of value.facts) {
    // Code decides: only valid indices count, and evidence comes from the candidates, never from the model.
    const cited = [...new Set(m.candidateIndices)].filter((i) => i < list.length).map((i) => list[i])
    if (cited.length === 0) continue
    facts.push({
      id: crypto.randomUUID(),
      category: m.category,
      value: m.value.trim(),
      confidence: m.confidence,
      source: 'chat',
      evidence: buildEvidence(cited),
      prior: weakPrior(m.confidence),
    })
  }
  return facts.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_FACTS)
}

// ───────────────────────────── questions (code only) ─────────────────────────────

const QUESTION_START = /^(?:how|what|which|will|can|does|is|should)\b/i
/** Requests to the assistant ("can you write...") are not the person's own recurring questions. */
const ASSISTANT_DIRECTED = /^(?:(?:can|could|would|will)\s+(?:you|u)|what do you think)\b/i
/** Pasted code ("a ? b : c", "x => y") is not a question either. */
const CODE_LIKE = /[{};=<>`]|=>/

function questionSentences(text: string): string[] {
  return text
    .split(/(?<=[?!.])\s+|\n+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        (s.endsWith('?') || QUESTION_START.test(s)) &&
        !ASSISTANT_DIRECTED.test(s) &&
        !CODE_LIKE.test(s) &&
        s.length <= 300 &&
        s.split(/\s+/).length >= 3,
    )
}

/** Recurring questions, e.g. "will it work with my PS5?". Code-first (normalize + count), model optional. */
export async function mineQuestions(messages: OwnMessage[]): Promise<Fact[]> {
  const clusters = new Map<string, { messageIds: Set<string>; hits: { sentence: string; message: OwnMessage }[] }>()
  for (const message of messages) {
    for (const sentence of questionSentences(message.text)) {
      const norm = normalizeText(sentence)
      if (!norm) continue
      const key = norm.split(' ').slice(0, 6).join(' ') // near-duplicates share the first 6 normalized words
      let c = clusters.get(key)
      if (!c) clusters.set(key, (c = { messageIds: new Set(), hits: [] }))
      if (c.messageIds.has(message.id)) continue // count a question once per message
      c.messageIds.add(message.id)
      c.hits.push({ sentence, message })
    }
  }
  const ranked = [...clusters.values()]
    .map((c) => {
      const hits = c.hits.sort((a, b) => b.message.date.localeCompare(a.message.date))
      return { hits, count: hits.length, newest: hits[0].message.date }
    })
    .sort((a, b) => b.count - a.count || b.newest.localeCompare(a.newest))
  // Keep everything asked at least twice; if that is fewer than 10, top up to 10 by count (then recency).
  const repeated = ranked.filter((c) => c.count >= 2)
  const picked = (repeated.length >= 10 ? repeated : ranked.slice(0, Math.max(10, repeated.length))).slice(0, MAX_QUESTIONS)

  // TODO(extract): optional Haiku pass to merge paraphrases that do not share their first 6 words.
  return picked.map(({ hits, count }) => {
    const confidence = Math.min(1, count / 5)
    return {
      id: crypto.randomUUID(),
      category: 'question',
      value: clip(hits[0].sentence, MAX_QUOTE_CHARS),
      confidence,
      source: 'chat',
      evidence: hits.slice(0, MAX_EVIDENCE).map(({ sentence, message }) => ({
        origin: message.origin,
        title: message.title,
        date: message.date,
        quote: clip(sentence, MAX_QUOTE_CHARS),
      })),
      prior: weakPrior(confidence),
    } satisfies Fact
  })
}

// ───────────────────────────── pipeline ─────────────────────────────

export async function extractFacts(
  messages: OwnMessage[],
  options: ExtractOptions = {},
): Promise<{ facts: Fact[]; questions: Fact[]; stats: { chunks: number; candidates: number; verified: number } }> {
  const { chunkTokens = DEFAULT_CHUNK_TOKENS, maxChunks = DEFAULT_MAX_CHUNKS, before, onProgress } = options
  const pool = before ? messages.filter((m) => m.date < before) : messages
  const chunks = chunkMessages(pool, chunkTokens).slice(0, maxChunks) // newest first, so the cap drops the oldest

  // map: bounded concurrency; a failed chunk is skipped unless every chunk fails (e.g. missing key).
  let done = 0
  let proposed = 0
  const verified: VerifiedCandidate[] = []
  const errors: unknown[] = []
  onProgress?.(0, chunks.length, 'map')
  let next = 0
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      try {
        const r = await proposeAndVerify(chunk)
        proposed += r.proposed
        verified.push(...r.verified)
      } catch (e) {
        errors.push(e)
      }
      onProgress?.(++done, chunks.length, 'map')
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAP_CONCURRENCY, chunks.length) }, worker))
  if (chunks.length > 0 && errors.length === chunks.length) throw errors[0]
  if (errors.length) console.warn(`[tailor] extract: ${errors.length}/${chunks.length} chunks failed and were skipped`)

  onProgress?.(0, 1, 'reduce')
  const facts = await mergeCandidates(verified)
  onProgress?.(1, 1, 'reduce')

  // Held-out split (§8.1): profile from older chats, questions from newer ones.
  onProgress?.(0, 1, 'questions')
  const questions = await mineQuestions(before ? messages.filter((m) => m.date >= before) : pool)
  onProgress?.(1, 1, 'questions')

  return { facts, questions, stats: { chunks: chunks.length, candidates: proposed, verified: verified.length } }
}

// ───────────────────────────── profile merge + handler ─────────────────────────────

/**
 * Merge freshly extracted chat facts into a profile. A fact whose normalized value already exists keeps the old id,
 * userStatus and prior (and the user's text if they edited it). Behavior facts and chat facts the user touched
 * (kept/edited/deleted) survive even when not re-extracted; untouched old chat facts are replaced.
 */
export function mergeIntoProfile(profile: Profile, extracted: Fact[]): Profile {
  const key = (f: Fact) => normalizeText(f.value)
  const existing = new Map(profile.facts.filter((f) => f.source === 'chat').map((f) => [key(f), f]))
  const seen = new Set<string>()
  const facts: Fact[] = []
  for (const f of extracted) {
    const k = key(f)
    if (seen.has(k)) continue
    seen.add(k)
    const old = existing.get(k)
    if (!old) facts.push(f)
    else
      facts.push({
        ...f,
        id: old.id,
        userStatus: old.userStatus,
        prior: old.prior ?? f.prior,
        ...(old.userStatus === 'edited' ? { value: old.value, category: old.category } : {}),
      })
  }
  for (const old of profile.facts) {
    if (old.source === 'behavior' || (old.userStatus && !seen.has(key(old)))) facts.push(old)
  }
  return { ...profile, facts }
}

export interface ExtractRunResult {
  profile: Profile
  stats: { chunks: number; candidates: number; verified: number }
}

/**
 * The whole run: own messages → extractFacts → merge into the stored profile → save.
 * The profile page calls this directly (extension origin) to show progress; 'extract/run' wraps it.
 * The long model work runs outside the profile lock; only the read-merge-save is serialized.
 */
export async function runExtract(profileId?: string, onProgress?: ExtractOptions['onProgress']): Promise<ExtractRunResult> {
  const messages = await getOwnMessages()
  const { facts, questions, stats } = await extractFacts(messages, { onProgress })
  const profile = await withProfileLock(async () => {
    const current = await getProfile(profileId)
    const { conversations, messages: count, from, to } = await getArchiveStats()
    return saveProfile({ ...mergeIntoProfile(current, [...facts, ...questions]), stats: { conversations, messages: count, from, to } }, profileId)
  })
  return { profile, stats }
}

export const handlers: HandlerMap = {
  // No progress over messaging: the profile page calls runExtract(profileId, onProgress) directly instead.
  'extract/run': async (msg) => runExtract(msg.profileId),
}
