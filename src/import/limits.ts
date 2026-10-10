/**
 * Import limits (CONTEXT.txt §3.1): "last 6 to 12 months, with a token cap", newest first.
 * Pure and deterministic; never mutates its input.
 */
import type { ImportedConversation, ImportOptions } from '@/types'

export const DEFAULT_LIMITS: Required<ImportOptions> = { months: 12, tokenCap: 400_000 }

/** Rough token estimate used for the cap: chars / 4, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function countMessages(conversations: ImportedConversation[]): number {
  return conversations.reduce((n, c) => n + c.messages.length, 0)
}

/**
 * 1. Drop messages older than `months` (calendar months, fractions rounded up, counted back from the NEWEST message, not
 *    from today: exports can be old and the demo must still work).
 * 2. Walk the rest newest → oldest, summing `estimateTokens`; the first message that would exceed
 *    `tokenCap` and everything older is dropped (the kept set is always a contiguous recent window).
 * 3. Drop conversations with no messages left. Message order inside a conversation is preserved.
 * A non-positive or non-finite `months` / `tokenCap` disables that limit. Unparseable dates count as oldest.
 */
export function limitConversations(
  conversations: ImportedConversation[],
  options: ImportOptions = {},
): ImportedConversation[] {
  const months = options.months ?? DEFAULT_LIMITS.months
  const tokenCap = options.tokenCap ?? DEFAULT_LIMITS.tokenCap

  const all = conversations.flatMap((c) => c.messages)
  const time = (date: string): number => {
    const t = Date.parse(date)
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
  }
  // seq breaks date ties: later in the input = newer (same-date fallbacks keep conversation order).
  let candidates = all.map((m, seq) => ({ id: m.id, t: time(m.date), tokens: estimateTokens(m.text), seq }))

  if (Number.isFinite(months) && months > 0 && candidates.length) {
    const newest = candidates.reduce((max, c) => Math.max(max, c.t), Number.NEGATIVE_INFINITY) // no spread: exports can hold 100k+ messages
    if (Number.isFinite(newest)) {
      const cutoff = new Date(newest)
      cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.ceil(months))
      const cutoffMs = cutoff.getTime()
      candidates = candidates.filter((c) => c.t >= cutoffMs)
    }
  }

  candidates.sort((a, b) => b.t - a.t || b.seq - a.seq)
  const keep = new Set<string>()
  const capped = Number.isFinite(tokenCap) && tokenCap > 0
  let used = 0
  for (const c of candidates) {
    used += c.tokens
    if (capped && used > tokenCap) break
    keep.add(c.id)
  }

  return conversations
    .map((c) => ({ ...c, messages: c.messages.filter((m) => keep.has(m.id)) }))
    .filter((c) => c.messages.length > 0)
}
