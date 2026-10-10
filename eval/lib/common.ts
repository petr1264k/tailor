/**
 * Node-side plumbing shared by the eval tasks (CONTEXT.txt §8): paths, demo pages via jsdom, eval profiles,
 * the tailored-page cache, reports, and the BLOCKED/ERROR line for modules that still throw TODO.
 * No Chrome here: run.ts installs fake-indexeddb; settings fall back to their in-memory store.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'
import type { Fact, PageContent, Profile, TailoredPage } from '@/types'
import { getSettings, setSettings, type Settings } from '@/settings'
import { LlmError } from '@/llm/client'
import { loadDotEnv } from './env'
import { questionsNewestFirst } from './firstScreen'

/** Repo root with a trailing slash. String form of import.meta.url: vitest's jsdom URL class is not Node's. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..') + sep
export const OUT_DIR = join(ROOT, 'eval/out')
export const TAILORED_DIR = join(OUT_DIR, 'tailored')
/** Gitignored (data/): personal profiles never get committed. */
export const PROFILES_DIR = join(ROOT, 'data/profiles')
export const PAGES_JSON = join(ROOT, 'demo/pages.json')
export const ANSWERS_JSON = join(ROOT, 'eval/answers.json')

// ───────────────────────────── args ─────────────────────────────

export interface TaskArgs {
  values: Record<string, string | boolean | undefined>
  positionals: string[]
}

export interface TaskReport {
  /** JSON written to eval/out/<task>-<iso>.json */
  json: unknown
  /** Markdown written to eval/out/<task>-<iso>.md and printed. */
  md: string
}

export function argString(args: TaskArgs, name: string): string | undefined {
  const v = args.values[name]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export const argFlag = (args: TaskArgs, name: string): boolean => args.values[name] === true

// ───────────────────────────── errors ─────────────────────────────

/** 'BLOCKED: gate (TODO(gate.runFidelityGate))', 'BLOCKED: llm (...)', or 'ERROR in tailor: ...'. Never includes chat text. */
export function blockedReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const todo = /^TODO\(([\w-]+)/.exec(message) // 'TODO(gate.runFidelityGate): ...' → 'gate'
  if (todo) return `BLOCKED: ${todo[1]} (${message.split(' — ')[0]})`
  if (err instanceof Error && err.name === 'LlmError') {
    const code = (err as Error & { code?: string }).code
    if (code === 'missing_key') return 'BLOCKED: llm (no ANTHROPIC_API_KEY: put it in .env at the repo root, or use --offline)'
    return `ERROR in llm (${code ?? 'api'}): ${message}`
  }
  const stack = err instanceof Error ? (err.stack ?? '') : ''
  const mod = /src\/(\w+)\//.exec(`${message}\n${stack}`)?.[1]
  return `ERROR${mod ? ` in ${mod}` : ''}: ${message}`
}

// ───────────────────────────── api key ─────────────────────────────

/** Loads .env (repo root) and hands ANTHROPIC_API_KEY to src/settings, the only place keys live. True when a key is set. */
export async function useApiKey(): Promise<boolean> {
  loadDotEnv(join(ROOT, '.env'))
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (key) await setSettings({ anthropicKey: key })
  return !!key
}

/** For live-only tasks: throws the same missing_key error the model client would, so it prints as BLOCKED: llm. */
export async function requireApiKey(): Promise<void> {
  if (!(await useApiKey())) throw new LlmError('missing_key', 'No ANTHROPIC_API_KEY in .env')
}

/**
 * Settings for one tailor run. Language is pinned (§8.3 "hold language constant"): --lang, else the page's language,
 * else English. The extension itself picks the user's chat language; evals must not compare Russian vs English.
 */
export async function evalSettings(profileId: string, content: PageContent, lang?: string): Promise<Settings> {
  const base = await getSettings()
  return { ...base, activeProfileId: profileId, language: lang || content.lang?.split('-')[0] || 'en' }
}

// ───────────────────────────── demo pages ─────────────────────────────

export interface DemoPage {
  id: string
  url: string
  file: string
  kind: string
  note?: string
}

export async function loadPages(): Promise<DemoPage[]> {
  const raw: unknown = JSON.parse(await readFile(PAGES_JSON, 'utf8'))
  if (!Array.isArray(raw)) throw new Error('demo/pages.json must be an array')
  return raw.filter(
    (p): p is DemoPage => typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.file === 'string',
  )
}

export const savedCopyExists = (page: DemoPage): boolean => existsSync(resolve(ROOT, page.file))

/** The live URL when known (links resolve the same as in Chrome), else the file:// URL of the saved copy. */
export function pageUrl(page: DemoPage): string {
  return page.url?.trim() || pathToFileURL(resolve(ROOT, page.file)).href
}

/**
 * Saved HTML → PageContent through the SAME extractPageContent the content script uses. Scripts never run
 * (jsdom default), nothing is fetched, console noise is dropped. null when the saved copy is missing.
 * jsdom has no layout: visibleText is textContent minus script/style, so hidden menus count as visible.
 */
export async function loadPageContent(page: DemoPage): Promise<PageContent | null> {
  const path = resolve(ROOT, page.file)
  if (!existsSync(path)) return null
  const html = await readFile(path, 'utf8')
  const { extractPageContent } = await import('@/tailor')
  const dom = new JSDOM(html, { url: pageUrl(page), contentType: 'text/html', virtualConsole: new VirtualConsole() })
  try {
    return extractPageContent(dom.window.document, pageUrl(page))
  } finally {
    dom.window.close()
  }
}

/** Every page with a saved copy, plus a note for each one without. */
export async function loadPageContents(): Promise<{ pages: DemoPage[]; contents: Map<string, PageContent>; notes: string[] }> {
  const pages = await loadPages()
  const contents = new Map<string, PageContent>()
  const notes: string[] = []
  for (const page of pages) {
    try {
      const content = await loadPageContent(page)
      if (content) contents.set(page.id, content)
      else notes.push(`page "${page.id}": no saved copy at ${page.file} (demo/save-offline.sh or ⌘S, see demo/README.md)`)
    } catch (err) {
      notes.push(`page "${page.id}": ${blockedReason(err)}`)
    }
  }
  return { pages, contents, notes }
}

// ───────────────────────────── profiles ─────────────────────────────

/**
 * data/profiles/<id>.json, written by `npm run eval -- profile`: { id, name, cutoff, profile, heldOutQuestions }.
 * A bare Profile JSON is accepted too (then the questions are NOT held out, and the report says so).
 */
export interface EvalProfile {
  id: string
  name: string
  profile: Profile
  /** Questions mined from chats on/after the cutoff. null when the file had none (not held out). */
  heldOutQuestions: Fact[] | null
  cutoff?: string
}

export interface EvalProfileFile {
  id: string
  name: string
  cutoff: string
  builtAt: string
  profile: Profile
  heldOutQuestions: Fact[]
}

function isProfile(x: unknown): x is Profile {
  return typeof x === 'object' && x !== null && Array.isArray((x as Profile).facts) && typeof (x as Profile).version === 'number'
}

export async function loadEvalProfiles(only?: string): Promise<EvalProfile[]> {
  if (!existsSync(PROFILES_DIR)) return []
  const files = (await readdir(PROFILES_DIR)).filter((f) => f.endsWith('.json')).sort()
  const out: EvalProfile[] = []
  for (const file of files) {
    const id = file.slice(0, -'.json'.length)
    if (only && id !== only) continue
    const raw: unknown = JSON.parse(await readFile(join(PROFILES_DIR, file), 'utf8'))
    const wrapped = raw as Partial<EvalProfileFile>
    if (isProfile(wrapped.profile)) {
      out.push({
        id,
        name: wrapped.name ?? id,
        profile: wrapped.profile,
        heldOutQuestions: Array.isArray(wrapped.heldOutQuestions) ? wrapped.heldOutQuestions : null,
        cutoff: wrapped.cutoff,
      })
    } else if (isProfile(raw)) {
      out.push({ id, name: id, profile: raw, heldOutQuestions: null })
    } else {
      console.warn(`skipping data/profiles/${file}: not a Profile`)
    }
  }
  return out
}

/** The questions the first-screen eval draws from: held-out ones when available, else the profile's own (flagged). */
export function evalQuestions(p: EvalProfile): { facts: Fact[]; heldOut: boolean } {
  if (p.heldOutQuestions) return { facts: questionsNewestFirst(p.heldOutQuestions), heldOut: true }
  return { facts: questionsNewestFirst(p.profile.facts), heldOut: false }
}

// ───────────────────────────── tailored cache ─────────────────────────────

export const tailoredPath = (profileId: string, pageId: string): string => join(TAILORED_DIR, `${profileId}-${pageId}.json`)

export async function readTailored(profileId: string, pageId: string): Promise<TailoredPage | null> {
  const path = tailoredPath(profileId, pageId)
  if (!existsSync(path)) return null
  return JSON.parse(await readFile(path, 'utf8')) as TailoredPage
}

export async function writeTailored(profileId: string, pageId: string, page: TailoredPage): Promise<void> {
  await mkdir(TAILORED_DIR, { recursive: true })
  await writeFile(tailoredPath(profileId, pageId), JSON.stringify(page, null, 2))
}

/** Every cached TailoredPage, matched back to (profileId, pageId) by the file name `<profile>-<page>.json`. */
export async function listTailored(pages: DemoPage[]): Promise<{ profileId: string; page: DemoPage; tailored: TailoredPage }[]> {
  if (!existsSync(TAILORED_DIR)) return []
  const out: { profileId: string; page: DemoPage; tailored: TailoredPage }[] = []
  for (const file of (await readdir(TAILORED_DIR)).filter((f) => f.endsWith('.json')).sort()) {
    const base = file.slice(0, -'.json'.length)
    const page = pages.find((p) => base.endsWith(`-${p.id}`))
    if (!page) continue
    const profileId = base.slice(0, -(page.id.length + 1))
    out.push({ profileId, page, tailored: JSON.parse(await readFile(join(TAILORED_DIR, file), 'utf8')) as TailoredPage })
  }
  return out
}

// ───────────────────────────── reports ─────────────────────────────

export function isoStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

export async function writeReport(task: string, report: TaskReport): Promise<{ json: string; md: string }> {
  await mkdir(OUT_DIR, { recursive: true })
  const stamp = isoStamp()
  const json = join(OUT_DIR, `${task}-${stamp}.json`)
  const md = join(OUT_DIR, `${task}-${stamp}.md`)
  await writeFile(json, JSON.stringify(report.json, null, 2))
  await writeFile(md, report.md.endsWith('\n') ? report.md : report.md + '\n')
  return { json, md }
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Markdown table. Cells are escaped for pipes and newlines. */
export function mdTable(head: string[], rows: (string | number)[][]): string {
  const cell = (c: string | number) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}
