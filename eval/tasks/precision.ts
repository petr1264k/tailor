/**
 * §8.2 Profile precision. Each owner marks every extracted fact right or wrong (about 5 minutes each).
 *   npm run eval -- precision [--profile id]   → eval/out/precision-<profile>.csv (id, category, value, evidence, correct)
 *   npm run eval -- precision --score <csv>    → P% with N (blank rows are unrated and excluded, and counted)
 * The CSV holds short evidence quotes for the owner only. It lives in eval/out/ (gitignored). Never put it on screen.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { activeFacts, formatEvidence } from '@/profile'
import { OUT_DIR, ROOT, argString, loadEvalProfiles, mdTable, type TaskArgs, type TaskReport } from '../lib/common'
import { parseCsv, toCsv } from '../lib/csv'
import { pct, wilson } from '../lib/stats'

const HEADER = ['id', 'category', 'value', 'evidence', 'correct']
const YES = new Set(['y', 'yes', '1', 'true', 'x', '✓', '+', 'right', 'correct'])
const NO = new Set(['n', 'no', '0', 'false', '✗', '-', 'wrong', 'incorrect'])

export function scoreRows(rows: string[][]): { right: number; wrong: number; unrated: number; unreadable: string[] } {
  const [head, ...body] = rows
  const col = head ? head.findIndex((h) => h.trim().toLowerCase() === 'correct') : -1
  if (col < 0) throw new Error('the CSV has no "correct" column')
  let right = 0
  let wrong = 0
  let unrated = 0
  const unreadable: string[] = []
  for (const row of body) {
    const v = (row[col] ?? '').trim().toLowerCase()
    if (!v) unrated++
    else if (YES.has(v)) right++
    else if (NO.has(v)) wrong++
    else unreadable.push(`${row[0] ?? '?'}: "${v}"`)
  }
  return { right, wrong, unrated, unreadable }
}

async function score(path: string): Promise<TaskReport> {
  const { right, wrong, unrated, unreadable } = scoreRows(parseCsv(await readFile(path, 'utf8')))
  const n = right + wrong
  const [lo, hi] = wilson(right, n)
  const p = n ? right / n : NaN
  const md = [
    `# Profile precision (CONTEXT.txt §8.2): ${path.replace(ROOT, '')}`,
    '',
    `**P = ${pct(p)}** (${right} of N = ${n} rated facts correct; 95% Wilson CI ${pct(lo)}–${pct(hi)}).`,
    `Unrated (blank): ${unrated}. Unreadable marks: ${unreadable.length}${unreadable.length ? ` (${unreadable.join(', ')})` : ''}.`,
    'Marks: y/yes/1/✓ = right, n/no/0/✗ = wrong.',
    '',
    `Write-up (§13): "Owners rated ${pct(p)} of extracted facts correct" (N = ${n}).`,
  ].join('\n')
  return { json: { file: path, right, wrong, n, precision: p, ci95: [lo, hi], unrated, unreadable }, md }
}

export async function run(args: TaskArgs): Promise<TaskReport> {
  const scorePath = argString(args, 'score')
  if (scorePath) return score(resolve(ROOT, scorePath))

  const profiles = await loadEvalProfiles(argString(args, 'profile'))
  if (profiles.length === 0) throw new Error('no profiles in data/profiles/: run `npm run eval -- profile --id <name>` first')
  await mkdir(OUT_DIR, { recursive: true })
  const written: (string | number)[][] = []
  for (const p of profiles) {
    const facts = activeFacts(p.profile)
    const rows = facts.map((f) => [f.id, f.category, f.value, f.evidence.slice(0, 2).map(formatEvidence).join(' | '), ''])
    const path = join(OUT_DIR, `precision-${p.id}.csv`)
    await writeFile(path, toCsv([HEADER, ...rows]))
    written.push([p.id, facts.length, path.replace(ROOT, '')])
  }
  const md = [
    '# Profile precision sheets (CONTEXT.txt §8.2)',
    '',
    mdTable(['Owner', 'Active facts (N)', 'Sheet'], written),
    '',
    'Each owner opens their own sheet, writes y or n in `correct` for every row (about 5 minutes), saves as CSV, then:',
    '`npm run eval -- precision --score eval/out/precision-<id>.csv`',
  ].join('\n')
  return { json: { sheets: written }, md }
}
