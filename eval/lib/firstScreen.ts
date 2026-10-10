/**
 * The main number (CONTEXT.txt §8.1): questions answered on the first screen, original vs tailored. Pure; no I/O.
 *
 * Answers come from the hand-made eval/answers.json. Each answer must be text copied exactly from the page's
 * visible text; code verifies it (validateAnswers) and refuses anything else, with the reason.
 */
import { z } from 'zod'
import type { Block, Fact } from '@/types'

export const FIRST_SCREEN_CHARS = 1500
/** §8.1: 5 questions per person and page. */
export const MAX_TRIALS_PER_PAIR = 5
/** Shorter answers ("4K", "$9") match by accident somewhere in 1,500 characters. */
export const MIN_ANSWER_CHARS = 3
export const MAX_ANSWER_CHARS = 200

export const FIRST_SCREEN_DEFINITION =
  `First screen, original = the first ${FIRST_SCREEN_CHARS.toLocaleString('en-US')} characters of the page's visible text ` +
  `(PageContent.visibleText from extractPageContent). First screen, tailored = blockToPlainText (src/render) of the ` +
  `tailored blocks, in order, joined by newlines, cut at ${FIRST_SCREEN_CHARS.toLocaleString('en-US')} characters. ` +
  `An answer counts when it appears inside that text; case, runs of whitespace, and curly-vs-straight quotes and ` +
  `dash styles are ignored, everything else must match. Strict variant: a long section block that the renderer starts ` +
  `collapsed contributes only its heading.`

export const HELD_OUT_RULE =
  'Held out (§8.1): the profile used for tailoring is built only from chats BEFORE a cutoff date ' +
  "(extractFacts(messages, { before: cutoff }), the extract 'before' option), and the questions come from chats ON OR AFTER " +
  'the cutoff (mineQuestions on the newer messages only). The tailor never sees the questions it is scored on. ' +
  'Per person and page, the 5 newest held-out questions that have an answer on the page are used: a human only decides ' +
  '"answerable here or not" and copies the answer from the ORIGINAL page, before looking at the tailored page; code picks ' +
  'which questions count (newest first) and verifies every answer.'

export const AnswerEntrySchema = z.object({
  pageId: z.string().min(1),
  profileId: z.string().min(1),
  question: z.string().min(1),
  /** Exact text from the page. Blank = not answerable on this page (skipped, not refused). */
  answer: z.string(),
})
export type AnswerEntry = z.infer<typeof AnswerEntrySchema>
export const AnswersFileSchema = z.array(AnswerEntrySchema)

/** Throws a readable error when eval/answers.json has the wrong shape. */
export function parseAnswersFile(raw: unknown): AnswerEntry[] {
  const parsed = AnswersFileSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  throw new Error(
    `eval/answers.json must be an array of { pageId, profileId, question, answer } (all strings). Refused: ${issues.join('; ')}`,
  )
}

/** NFKC, curly quotes → straight, unicode dashes → '-', whitespace collapsed, lowercased. Used on both sides of every check. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function containsAnswer(screen: string, answer: string): boolean {
  const a = normalizeForMatch(answer)
  return a.length > 0 && normalizeForMatch(screen).includes(a)
}

export function originalFirstScreen(visibleText: string, chars = FIRST_SCREEN_CHARS): string {
  return visibleText.slice(0, chars)
}

export interface TailoredScreenOptions {
  chars?: number
  /** Strict variant: sections at or over `collapseAt` characters start collapsed in the renderer, so only the heading counts. */
  collapsedSectionsHidden?: boolean
  /** Mirror of src/render COLLAPSE_AT. */
  collapseAt?: number
}

export function tailoredFirstScreen(
  blocks: Block[],
  toText: (block: Block) => string,
  opts: TailoredScreenOptions = {},
): string {
  const chars = opts.chars ?? FIRST_SCREEN_CHARS
  const collapseAt = opts.collapseAt ?? 600
  let out = ''
  for (const b of blocks) {
    if (out.length >= chars) break
    const text = opts.collapsedSectionsHidden && b.type === 'section' && b.text.length >= collapseAt ? b.heading : toText(b)
    out += (out ? '\n' : '') + text
  }
  return out.slice(0, chars)
}

export interface Screens {
  original: string
  tailored: string
  tailoredStrict: string
}

export interface ScoredTrial<T> {
  entry: T
  inOriginal: boolean
  inTailored: boolean
  inTailoredStrict: boolean
}

export function scoreTrials<T extends { answer: string }>(entries: T[], screens: Screens): ScoredTrial<T>[] {
  return entries.map((entry) => ({
    entry,
    inOriginal: containsAnswer(screens.original, entry.answer),
    inTailored: containsAnswer(screens.tailored, entry.answer),
    inTailoredStrict: containsAnswer(screens.tailoredStrict, entry.answer),
  }))
}

export interface Tally {
  n: number
  original: number
  tailored: number
  tailoredStrict: number
}

export function tally(trials: ScoredTrial<unknown>[]): Tally {
  return {
    n: trials.length,
    original: trials.filter((t) => t.inOriginal).length,
    tailored: trials.filter((t) => t.inTailored).length,
    tailoredStrict: trials.filter((t) => t.inTailoredStrict).length,
  }
}

/** Newest evidence date of a fact (ISO string compare is fine: dates are stored as toISOString()). */
export function newestEvidenceDate(fact: Fact): string {
  return fact.evidence.reduce((max, e) => (e.date > max ? e.date : max), '')
}

/** Active 'question' facts, newest first. */
export function questionsNewestFirst(facts: Fact[]): Fact[] {
  return facts
    .filter((f) => f.category === 'question' && f.userStatus !== 'deleted')
    .sort((a, b) => newestEvidenceDate(b).localeCompare(newestEvidenceDate(a)))
}

export interface ValidationContext {
  /** Visible text per page id. A page without a saved copy is absent. */
  visibleText: ReadonlyMap<string, string>
  /** Mined (held-out) question values per profile id, NEWEST FIRST. */
  questions: ReadonlyMap<string, readonly string[]>
}

export interface ValidAnswer extends AnswerEntry {
  /** Position of the question in the person's questions, newest first (0 = newest). */
  rank: number
}

export interface AnswersCheck {
  valid: ValidAnswer[]
  refused: { entry: AnswerEntry; reason: string }[]
  /** Blank answers: the question is not answerable on that page. Skipped, not refused. */
  blank: AnswerEntry[]
}

/** Code decides which hand-made answers are allowed (§8.1). Every refusal says why. */
export function validateAnswers(entries: AnswerEntry[], ctx: ValidationContext): AnswersCheck {
  const out: AnswersCheck = { valid: [], refused: [], blank: [] }
  const seen = new Set<string>()
  const normalizedPages = new Map<string, string>()
  const pageText = (id: string): string | undefined => {
    const raw = ctx.visibleText.get(id)
    if (raw === undefined) return undefined
    if (!normalizedPages.has(id)) normalizedPages.set(id, normalizeForMatch(raw))
    return normalizedPages.get(id)
  }

  for (const entry of entries) {
    const refuse = (reason: string) => out.refused.push({ entry, reason })
    const answer = normalizeForMatch(entry.answer)
    if (!answer) {
      out.blank.push(entry)
      continue
    }
    const page = pageText(entry.pageId)
    if (page === undefined) {
      refuse(`page "${entry.pageId}" has no saved copy (demo/pages.json → file), so the answer cannot be verified`)
      continue
    }
    const questions = ctx.questions.get(entry.profileId)
    if (!questions) {
      refuse(`no profile "${entry.profileId}" in data/profiles/, so the question cannot be checked against what the person asks`)
      continue
    }
    const q = normalizeForMatch(entry.question)
    const rank = questions.findIndex((x) => normalizeForMatch(x) === q)
    if (rank < 0) {
      refuse(
        `the question is not one of ${entry.profileId}'s mined questions; copy it verbatim from eval/out/answers-template.json`,
      )
      continue
    }
    if (answer.length < MIN_ANSWER_CHARS) {
      refuse(`the answer is under ${MIN_ANSWER_CHARS} characters and would match by accident; copy a longer exact phrase`)
      continue
    }
    if (answer.length > MAX_ANSWER_CHARS) {
      refuse(`the answer is over ${MAX_ANSWER_CHARS} characters; copy the shortest exact phrase that answers the question`)
      continue
    }
    if (!page.includes(answer)) {
      refuse(
        "the answer is not an exact substring of the page's visible text (case and whitespace ignored). Copy it again " +
          'from the saved page; text in images, in a different page version, or reworded does not count',
      )
      continue
    }
    const key = `${entry.pageId}\u0000${entry.profileId}\u0000${q}`
    if (seen.has(key)) {
      refuse('duplicate question for this page and person; keep one')
      continue
    }
    seen.add(key)
    out.valid.push({ ...entry, rank })
  }
  return out
}

/** The trials for one (person, page): the newest MAX_TRIALS_PER_PAIR valid answers. Code picks, not the human. */
export function selectTrials(valid: ValidAnswer[], pageId: string, profileId: string, max = MAX_TRIALS_PER_PAIR): ValidAnswer[] {
  return valid
    .filter((a) => a.pageId === pageId && a.profileId === profileId)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
}
