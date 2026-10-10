/**
 * Extraction (CONTEXT.txt §3.2): map-reduce over the user's own messages. Owner: Mikhail (+ third engineer for prompts).
 *
 * map:    Haiku 5.5 reads chunks and proposes candidate facts, each with a short supporting quote (CandidateFactsOutputSchema).
 *         Code verifies every quote actually appears in the cited message, otherwise the candidate is dropped.
 * reduce: Sonnet 5.5 merges duplicates and scores by frequency and recency (MergedFactsOutputSchema).
 *         Code rebuilds evidence from candidate indices; the model never invents ids, dates or origins.
 * also:   mine the questions the person asks again and again (category 'question'); the first-screen eval uses them (§8.1).
 */
import type { Fact, OwnMessage } from '@/types'
import type { CandidateFact } from '@/schemas'
import type { HandlerMap } from '@/messages'
import { todo } from '@/todo'

export interface ExtractOptions {
  /** Rough tokens per chunk (chars / 4). Default 6000. */
  chunkTokens?: number
  /** Cap on chunks for the demo. Default 40. */
  maxChunks?: number
  /** Build the profile only from messages before this ISO date (held-out split, §8.1). */
  before?: string
  onProgress?: (done: number, total: number, stage: 'map' | 'reduce' | 'questions') => void
}

/** A candidate with the message it cites, after code verified the quote. */
export interface VerifiedCandidate extends CandidateFact {
  message: OwnMessage
}

export function chunkMessages(messages: OwnMessage[], chunkTokens = 6000): OwnMessage[][] {
  void messages
  void chunkTokens
  return todo('extract.chunkMessages', 'group by conversation, newest first, respect the token size')
}

/** Haiku map step for one chunk, then code-verify quotes. */
export async function proposeCandidates(chunk: OwnMessage[]): Promise<VerifiedCandidate[]> {
  void chunk
  return todo('extract.proposeCandidates')
}

/** Sonnet reduce step over all candidates; returns Facts with evidence rebuilt by code. */
export async function mergeCandidates(candidates: VerifiedCandidate[]): Promise<Fact[]> {
  void candidates
  return todo('extract.mergeCandidates')
}

/** Recurring questions, e.g. "will it work with my PS5?". Code-first (normalize + count), model optional. */
export async function mineQuestions(messages: OwnMessage[]): Promise<Fact[]> {
  void messages
  return todo('extract.mineQuestions')
}

export async function extractFacts(
  messages: OwnMessage[],
  options: ExtractOptions = {},
): Promise<{ facts: Fact[]; questions: Fact[]; stats: { chunks: number; candidates: number; verified: number } }> {
  void messages
  void options
  return todo('extract.extractFacts', 'chunk → map (parallel, bounded) → reduce → questions')
}

export const handlers: HandlerMap = {
  'extract/run': async (msg) => {
    void msg
    return todo('extract.handlers[extract/run]', 'archive.getOwnMessages → extractFacts → filterSensitive → profile.saveProfile')
  },
}
