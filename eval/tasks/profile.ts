/**
 * Build a HELD-OUT eval profile (CONTEXT.txt §8.1) in Node, from the same export file the extension imports.
 *   facts:              extractFacts(messages before the cutoff, { before: cutoff })
 *   heldOutQuestions:   mineQuestions(messages on/after the cutoff)
 * Written to data/profiles/<id>.json (gitignored). Counts only are printed: never message text.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Fact, OwnMessage, Profile } from '@/types'
import { applyLimits, detectExportFormat, parseExport } from '@/import'
import { extractFacts, mineQuestions } from '@/extract'
import { PROFILES_DIR, ROOT, argString, mdTable, requireApiKey, type EvalProfileFile, type TaskArgs, type TaskReport } from '../lib/common'

/** Default cutoff: 30 days before the newest message, so the newest month is held out. */
export const DEFAULT_HOLDOUT_DAYS = 30

export async function run(args: TaskArgs): Promise<TaskReport> {
  const id = argString(args, 'id') ?? argString(args, 'profile')
  if (!id || !/^[\w-]+$/.test(id)) throw new Error('usage: npm run eval -- profile --id <name> [--chats a.json,b.json] [--cutoff YYYY-MM-DD]')

  let files = (argString(args, 'chats') ?? '').split(',').map((f) => f.trim()).filter(Boolean).map((f) => resolve(ROOT, f))
  if (files.length === 0) {
    const dir = join(ROOT, 'data', id)
    files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)) : []
  }
  if (files.length === 0) throw new Error(`no export files: pass --chats <conversations.json> or put them in data/${id}/`)

  const messages: OwnMessage[] = []
  const sources: (string | number)[][] = []
  for (const file of files) {
    const json: unknown = JSON.parse(await readFile(file, 'utf8'))
    const origin = detectExportFormat(json)
    if (origin === 'unknown') {
      sources.push([file.replace(ROOT, ''), 'unknown format: skipped', 0, 0])
      continue
    }
    const conversations = applyLimits(parseExport(json, origin))
    const own = conversations.flatMap((c) => c.messages)
    messages.push(...own)
    sources.push([file.replace(ROOT, ''), origin, conversations.length, own.length])
  }
  if (messages.length === 0) throw new Error('no own messages after import limits')
  messages.sort((a, b) => a.date.localeCompare(b.date))

  const newest = messages[messages.length - 1].date
  const cutoffArg = argString(args, 'cutoff')
  const cutoffMs = cutoffArg ? Date.parse(cutoffArg) : Date.parse(newest) - DEFAULT_HOLDOUT_DAYS * 86_400_000
  if (!Number.isFinite(cutoffMs)) throw new Error(`bad --cutoff: ${cutoffArg}`)
  const cutoff = new Date(cutoffMs).toISOString()
  const older = messages.filter((m) => m.date < cutoff)
  const newer = messages.filter((m) => m.date >= cutoff)
  if (older.length === 0 || newer.length === 0) {
    throw new Error(`cutoff ${cutoff} leaves ${older.length} older / ${newer.length} newer messages; pick a cutoff with both`)
  }

  await requireApiKey() // extraction calls the model
  console.log(`extracting from ${older.length} older messages (before ${cutoff.slice(0, 10)}) ...`)
  const extracted = await extractFacts(older, {
    before: cutoff,
    onProgress: (done, total, stage) => process.stdout.write(`\r  ${stage} ${done}/${total}   `),
  })
  process.stdout.write('\n')
  const facts: Fact[] = [...extracted.facts, ...extracted.questions]
  console.log(`mining questions from ${newer.length} newer messages (held out) ...`)
  const heldOut = await mineQuestions(newer)

  const conversationsOlder = new Set(older.map((m) => m.conversationId)).size
  const profile: Profile = {
    version: 1,
    facts,
    shares: [],
    stats: { conversations: conversationsOlder, messages: older.length, from: older[0].date, to: older[older.length - 1].date },
  }
  const heldOutQuestions: Fact[] = heldOut.filter((f) => f.category === 'question')
  const file: EvalProfileFile = {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    cutoff,
    builtAt: new Date().toISOString(),
    profile,
    heldOutQuestions,
  }
  await mkdir(PROFILES_DIR, { recursive: true })
  const path = join(PROFILES_DIR, `${id}.json`)
  await writeFile(path, JSON.stringify(file, null, 2))

  const byCategory: Record<string, number> = {}
  for (const f of profile.facts) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
  const md = [
    `# Held-out profile: ${id}`,
    '',
    `Cutoff: ${cutoff.slice(0, 10)}. Profile from ${older.length} messages before it (${conversationsOlder} conversations); ` +
      `questions from ${newer.length} messages on or after it. The tailor never sees the held-out questions.`,
    '',
    mdTable(['Export file', 'Origin', 'Conversations', 'Own messages'], sources),
    '',
    `Facts kept: N = ${profile.facts.length} (${Object.entries(byCategory).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}).`,
    `Held-out questions: N = ${heldOutQuestions.length}.`,
    `Extraction: ${extracted.stats.chunks} chunks, ${extracted.stats.candidates} candidates, ${extracted.stats.verified} with verified quotes.`,
    '',
    `Wrote ${path.replace(ROOT, '')} (gitignored). Next: npm run eval -- first-screen`,
  ].join('\n')
  return {
    json: {
      id,
      cutoff,
      files: sources,
      olderMessages: older.length,
      newerMessages: newer.length,
      facts: profile.facts.length,
      byCategory,
      heldOutQuestions: heldOutQuestions.length,
      extractStats: extracted.stats,
    },
    md,
  }
}
