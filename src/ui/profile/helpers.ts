/**
 * Pure helpers for the extension pages (profile page + popup). No React, no chrome, no IndexedDB here,
 * so everything in this file is unit-tested in helpers.test.ts.
 */
import type { Fact, FactCategory } from '@/types'
import { FACT_CATEGORIES } from '@/types'

// ── Errors: every module call on these pages is wrapped; a thrown TODO shows inline, never crashes the page ──

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Unknown error'
}

/** Runs sync or async work and returns the value or the error text. Never throws. */
export async function attempt<T>(fn: () => T | Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

// ── Labels ──

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  reading: 'Reading',
  visual: 'Visual',
  language: 'Language',
  expertise: 'Expertise',
  interest: 'Interests',
  constraint: 'Constraints',
  owns: 'Owns',
  dislikes: 'Dislikes',
  goal: 'Goals',
  question: 'Questions they keep asking',
}

export function originLabel(origin: string): string {
  if (origin === 'chatgpt') return 'ChatGPT'
  if (origin === 'claude') return 'Claude'
  return siteLabel(origin)
}

/** Hostname without "www.", or the input unchanged if it is not a URL. */
export function siteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ── Dates (times are Pacific on stage; date-only strings are calendar dates, so format those in UTC) ──

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** "Aug 3" (adds the year when it is not the current one). Empty or invalid input → "". */
export function shortDate(iso: string, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const timeZone = DATE_ONLY.test(iso) ? 'UTC' : undefined
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone })
}

/** "Oct 10, 2026, 3:42 PM" for receipts. */
export function dateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

/** "Nov 2025 – Oct 2026" for archive stats. */
export function monthRange(from: string, to: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  const a = fmt(from)
  const b = fmt(to)
  if (!a && !b) return '—'
  if (a === b || !b) return a
  if (!a) return b
  return `${a} – ${b}`
}

// ── Text ──

export function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

// ── Facts ──

export interface FactGroup {
  category: FactCategory
  facts: Fact[]
}

/**
 * Groups facts in FACT_CATEGORIES order, skipping empty groups. Within a group: live facts first,
 * by confidence (high → low); deleted facts last so the struck-through ones sit at the bottom.
 */
export function groupFactsByCategory(facts: Fact[]): FactGroup[] {
  const rank = (f: Fact) => (f.userStatus === 'deleted' ? 1 : 0)
  return FACT_CATEGORIES.map((category) => ({
    category,
    facts: facts
      .filter((f) => f.category === category)
      .sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence),
  })).filter((g) => g.facts.length > 0)
}

/** Confidence as a 0..100 integer for the bar; clamps junk. */
export function confidencePct(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100)
}

/** Fact values for a receipt's factIds; unknown ids (fact since removed) show as the id. */
export function factValues(factIds: string[], facts: Fact[]): string[] {
  const byId = new Map(facts.map((f) => [f.id, f.value]))
  return factIds.map((id) => byId.get(id) ?? `(fact ${id})`)
}

// ── Import ──

/** A zip is never accepted (§3.1): exports can be gigabytes. Take conversations.json out of it. */
export function isZipFile(name: string, type: string): boolean {
  return /\.zip$/i.test(name) || /zip/i.test(type)
}

// ── Profiles ──

/** Stable, readable id from a display name ("Mikhail" → "mikhail"), unique among `existing`. */
export function profileIdFromName(name: string, existing: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'profile'
  if (!existing.includes(base)) return base
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`
    if (!existing.includes(id)) return id
  }
}

