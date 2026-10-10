/**
 * §8.1, the main number: questions each person actually asks, answered on the first screen, original vs tailored.
 *   live (default):  extractPageContent (jsdom) → tailorPage → cache eval/out/tailored/<profile>-<page>.json
 *   --offline:       read that cache instead of calling the model
 * Answers: eval/answers.json [{ pageId, profileId, question, answer }], verified by code (validateAnswers).
 * Also writes eval/out/answers-template.json: the newest held-out questions per (person, page), ready to fill.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PageContent, TailoredPage } from '@/types'
import { tailorPage } from '@/tailor'
import { COLLAPSE_AT, blockToPlainText } from '@/render'
import {
  ANSWERS_JSON,
  OUT_DIR,
  argFlag,
  argString,
  blockedReason,
  evalQuestions,
  evalSettings,
  loadEvalProfiles,
  loadPageContents,
  mdTable,
  readJsonFile,
  readTailored,
  useApiKey,
  writeTailored,
  type EvalProfile,
  type TaskArgs,
  type TaskReport,
} from '../lib/common'
import {
  FIRST_SCREEN_DEFINITION,
  HELD_OUT_RULE,
  MAX_TRIALS_PER_PAIR,
  normalizeForMatch,
  originalFirstScreen,
  parseAnswersFile,
  scoreTrials,
  selectTrials,
  tailoredFirstScreen,
  tally,
  validateAnswers,
  type AnswerEntry,
  type ScoredTrial,
  type Tally,
  type ValidAnswer,
} from '../lib/firstScreen'

/** How many of the newest questions per (person, page) the template offers to fill. */
const TEMPLATE_QUESTIONS = 10

const frac = (k: number, n: number) => `${k}/${n}`

export async function getTailored(
  profile: EvalProfile,
  pageId: string,
  content: PageContent,
  opts: { offline: boolean; lang?: string },
): Promise<{ tailored: TailoredPage | null; note?: string; ms?: number }> {
  if (opts.offline) {
    const tailored = await readTailored(profile.id, pageId)
    return tailored ? { tailored } : { tailored: null, note: 'no cached tailored page (run once without --offline)' }
  }
  try {
    const t0 = performance.now()
    const tailored = await tailorPage(content, profile.profile, await evalSettings(profile.id, content, opts.lang))
    const ms = performance.now() - t0
    await writeTailored(profile.id, pageId, tailored)
    return { tailored, ms }
  } catch (err) {
    return { tailored: null, note: blockedReason(err) }
  }
}

export async function run(args: TaskArgs): Promise<TaskReport> {
  const offline = argFlag(args, 'offline')
  const lang = argString(args, 'lang')
  const notes: string[] = []

  const { pages, contents, notes: pageNotes } = await loadPageContents()
  notes.push(...pageNotes)
  const profiles = await loadEvalProfiles(argString(args, 'profile'))
  if (profiles.length === 0) notes.push('no profiles in data/profiles/: run `npm run eval -- profile --id <name>` first')
  for (const p of profiles) {
    if (!evalQuestions(p).heldOut) notes.push(`profile "${p.id}": questions are NOT held out (bare Profile file); say so if you report it`)
  }

  // Answers: shape (zod) first, then code checks each one against the page and the person's mined questions.
  const entries: AnswerEntry[] = existsSync(ANSWERS_JSON) ? parseAnswersFile(await readJsonFile(ANSWERS_JSON)) : []
  const check = validateAnswers(entries, {
    visibleText: new Map([...contents].map(([id, c]) => [id, c.visibleText])),
    questions: new Map(profiles.map((p) => [p.id, evalQuestions(p).facts.map((f) => f.value)])),
  })

  if (!offline && !(await useApiKey())) notes.push('BLOCKED: llm (no ANTHROPIC_API_KEY in .env); use --offline with cached pages')

  type Row = { profileId: string; pageId: string; status: string; trials: ScoredTrial<ValidAnswer>[] }
  const rows: Row[] = []
  for (const profile of profiles) {
    for (const page of pages) {
      const content = contents.get(page.id)
      if (!content) continue
      const { tailored, note } = await getTailored(profile, page.id, content, { offline, lang })
      if (!tailored) {
        rows.push({ profileId: profile.id, pageId: page.id, status: note ?? 'no tailored page', trials: [] })
        console.log(`${profile.id} × ${page.id}: ${note}`)
        continue
      }
      const trials = selectTrials(check.valid, page.id, profile.id)
      const scored = scoreTrials(trials, {
        original: originalFirstScreen(content.visibleText),
        tailored: tailoredFirstScreen(tailored.blocks, blockToPlainText),
        tailoredStrict: tailoredFirstScreen(tailored.blocks, blockToPlainText, { collapsedSectionsHidden: true, collapseAt: COLLAPSE_AT }),
      })
      rows.push({ profileId: profile.id, pageId: page.id, status: trials.length ? 'ok' : 'no valid answers yet', trials: scored })
      console.log(`${profile.id} × ${page.id}: ${tailored.blocks.length} blocks, ${scored.length} questions`)
    }
  }

  // Template for the human: newest held-out questions per (person, page), existing answers kept.
  const existing = new Map(entries.map((e) => [`${e.pageId}|${e.profileId}|${normalizeForMatch(e.question)}`, e.answer]))
  const template: AnswerEntry[] = []
  for (const profile of profiles) {
    for (const page of pages) {
      for (const q of evalQuestions(profile).facts.slice(0, TEMPLATE_QUESTIONS)) {
        const answer = existing.get(`${page.id}|${profile.id}|${normalizeForMatch(q.value)}`) ?? ''
        template.push({ pageId: page.id, profileId: profile.id, question: q.value, answer })
      }
    }
  }
  await mkdir(OUT_DIR, { recursive: true })
  const templatePath = join(OUT_DIR, 'answers-template.json')
  await writeFile(templatePath, JSON.stringify(template, null, 2))

  // Tallies.
  const all = rows.flatMap((r) => r.trials)
  const overall = tally(all)
  const perPerson = profiles.map((p) => ({ id: p.id, t: tally(rows.filter((r) => r.profileId === p.id).flatMap((r) => r.trials)) }))
  const pairsScored = rows.filter((r) => r.trials.length > 0).length
  const tailoredPairs = rows.filter((r) => r.status === 'ok' || r.status === 'no valid answers yet').length
  const people = new Set(rows.filter((r) => r.trials.length).map((r) => r.profileId)).size
  const pagesScored = new Set(rows.filter((r) => r.trials.length).map((r) => r.pageId)).size
  const tallyRow = (label: string, t: Tally) => [label, frac(t.original, t.n), frac(t.tailored, t.n), frac(t.tailoredStrict, t.n), t.n]

  const md = [
    '# First screen: questions answered before scrolling (CONTEXT.txt §8.1)',
    '',
    `Mode: ${offline ? 'offline (cached tailored pages)' : 'live (tailorPage, then cached)'}. Language pinned to ${lang ?? "each page's language"} (§8.3).`,
    `N: ${overall.n} questions over ${pairsScored} (person × page) pairs; ${people} people, ${pagesScored} pages. ` +
      `${tailoredPairs} pairs had a tailored page. Up to ${MAX_TRIALS_PER_PAIR} questions per pair.`,
    '',
    '## Result',
    '',
    `**Overall: original ${frac(overall.original, overall.n)} vs tailored ${frac(overall.tailored, overall.n)}** ` +
      `(strict ${frac(overall.tailoredStrict, overall.n)}; n = ${overall.n}).`,
    '',
    mdTable(['Person', 'Original', 'Tailored', 'Tailored (strict)', 'n'], [...perPerson.map((p) => tallyRow(p.id, p.t)), tallyRow('**all**', overall)]),
    '',
    '### Per page',
    '',
    mdTable(
      ['Person', 'Page', 'Original', 'Tailored', 'Strict', 'n', 'Status'],
      rows.map((r) => {
        const t = tally(r.trials)
        return [r.profileId, r.pageId, frac(t.original, t.n), frac(t.tailored, t.n), frac(t.tailoredStrict, t.n), t.n, r.status]
      }),
    ),
    '',
    'Write-up (§13): "Questions each person actually asks were answered on the first screen ' +
      `${overall.original}/${overall.n} times on the original pages vs ${overall.tailored}/${overall.n} tailored."`,
    '',
    '## Definition',
    '',
    FIRST_SCREEN_DEFINITION,
    'Caveats: jsdom has no layout, so the "first screen" is a character budget, not pixels, and text in hidden menus counts as ' +
      'visible on the original. A short answer can match an unrelated spot; answers must be at least 3 characters.',
    '',
    '## Held-out rule',
    '',
    HELD_OUT_RULE,
    ...profiles.map((p) => `- ${p.id}: ${p.cutoff ? `cutoff ${p.cutoff.slice(0, 10)}` : 'no cutoff (NOT held out)'}, ` +
      `${evalQuestions(p).facts.length} candidate questions.`),
    '',
    '## Answers check (code decides)',
    '',
    `eval/answers.json: ${entries.length} entries. Valid ${check.valid.length}, refused ${check.refused.length}, ` +
      `blank (not answerable on that page) ${check.blank.length}.`,
    ...check.refused.map((r) => `- REFUSED ${r.entry.profileId} × ${r.entry.pageId}: "${r.entry.question}": ${r.reason}`),
    '',
    `Template with the newest ${TEMPLATE_QUESTIONS} questions per pair: ${templatePath.replace(OUT_DIR, 'eval/out')}. ` +
      'Copy it to eval/answers.json and fill `answer` with text copied from the ORIGINAL page (leave blank if not answerable).',
    ...(notes.length ? ['', '## Notes', '', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')

  return {
    json: {
      definition: FIRST_SCREEN_DEFINITION,
      heldOutRule: HELD_OUT_RULE,
      mode: offline ? 'offline' : 'live',
      overall,
      perPerson,
      rows: rows.map((r) => ({
        profileId: r.profileId,
        pageId: r.pageId,
        status: r.status,
        trials: r.trials.map((t) => ({
          question: t.entry.question,
          answer: t.entry.answer,
          inOriginal: t.inOriginal,
          inTailored: t.inTailored,
          inTailoredStrict: t.inTailoredStrict,
        })),
      })),
      refused: check.refused,
      blank: check.blank.length,
      notes,
    },
    md,
  }
}
