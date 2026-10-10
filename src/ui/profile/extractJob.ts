/**
 * The extraction job for the profile page. Owner: Petr.
 *
 * One extraction at a time, owned by the PAGE rather than by a React component, so switching between the Import,
 * Profile and Receipts tabs never unmounts it: the run keeps going and its progress, result or error shows on every
 * tab. The state is mirrored to chrome.storage.session, so a reload (or a second profile-page tab) shows what
 * happened, and the result stays visible until dismissed.
 *
 * The model calls run in this page, not in the background worker: Chrome stops an extension service worker when a
 * fetch takes more than 30 s to answer, which the Sonnet merge regularly does. Closing or reloading the page
 * therefore stops the run; the page warns before unload, and a run cut short shows as "interrupted" afterwards.
 * Facts are saved to the profile by runExtract as soon as the run completes (src/extract).
 */
import { runExtract } from '@/extract'

export type ExtractStage = 'map' | 'reduce' | 'questions'

interface JobBase {
  profileId: string
  profileName: string
  startedAt: string
}

export type ExtractJob =
  | { status: 'idle' }
  | (JobBase & {
      status: 'running'
      stage: ExtractStage
      done: number
      total: number
      /** Last progress or heartbeat; another page uses it to tell a live run from a dead one. */
      updatedAt: string
      /** The page that runs it. Only that page may advance or finish the job. */
      pageId: string
    })
  | (JobBase & {
      status: 'done'
      finishedAt: string
      seconds: number
      chunks: number
      candidates: number
      verified: number
      liveFacts: number
      version: number
    })
  | (JobBase & { status: 'error'; finishedAt: string; seconds: number; error: string })
  | (JobBase & { status: 'interrupted'; stage: ExtractStage; done: number; total: number; updatedAt: string })

export const EXTRACT_JOB_KEY = 'tailor.extractJob'
/** A running record older than this (no progress, no heartbeat) belongs to a page that is gone. */
export const STALE_MS = 150_000
const HEARTBEAT_MS = 5_000
/** This page's identity for the lifetime of the document. */
export const PAGE_ID = crypto.randomUUID()

type Listener = (job: ExtractJob) => void
type Clock = () => number

let state: ExtractJob = { status: 'idle' }
const listeners = new Set<Listener>()
/** vitest fallback for chrome.storage.session. */
let memory: ExtractJob | null = null

function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.session
}

async function persist(job: ExtractJob): Promise<void> {
  if (hasSessionStorage()) await chrome.storage.session.set({ [EXTRACT_JOB_KEY]: job })
  else memory = job
}

async function readPersisted(): Promise<ExtractJob | null> {
  if (!hasSessionStorage()) return memory
  const raw = await chrome.storage.session.get(EXTRACT_JOB_KEY)
  const value = raw[EXTRACT_JOB_KEY] as ExtractJob | undefined
  return value && typeof value === 'object' && typeof value.status === 'string' ? value : null
}

function notify(): void {
  for (const l of listeners) l(state)
}

/** Sets the state, tells the page, mirrors it to session storage (errors there never break the run). */
function set(next: ExtractJob): void {
  state = next
  notify()
  void persist(next).catch((e: unknown) => console.warn('[tailor] extract job: could not persist', e instanceof Error ? e.name : ''))
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function getExtractJob(): ExtractJob {
  return state
}

export function subscribeExtractJob(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** True when THIS page is running the job (the one case where leaving the page would stop it). */
export function isOwnRun(job: ExtractJob = state): boolean {
  return job.status === 'running' && job.pageId === PAGE_ID
}

/**
 * Starts the run. Rejects when this page already runs one. Progress, heartbeat, result and error all land in the
 * state; the returned promise resolves with the final state (done or error) and never rejects.
 */
export async function startExtract(profileId: string, profileName: string, now: Clock = Date.now): Promise<ExtractJob> {
  if (isOwnRun()) throw new Error(`Extraction into “${(state as JobBase).profileName}” is already running on this page.`)
  const t0 = now()
  const base: JobBase = { profileId, profileName, startedAt: iso(t0) }
  set({ ...base, status: 'running', stage: 'map', done: 0, total: 0, updatedAt: iso(t0), pageId: PAGE_ID })

  const heartbeat = setInterval(() => {
    if (isOwnRun()) set({ ...(state as Extract<ExtractJob, { status: 'running' }>), updatedAt: iso(now()) })
  }, HEARTBEAT_MS)

  try {
    const r = await runExtract(profileId, (done, total, stage) => {
      if (!isOwnRun()) return
      set({ ...(state as Extract<ExtractJob, { status: 'running' }>), stage, done, total, updatedAt: iso(now()) })
    })
    const t1 = now()
    set({
      ...base,
      status: 'done',
      finishedAt: iso(t1),
      seconds: Math.round((t1 - t0) / 1000),
      chunks: r.stats.chunks,
      candidates: r.stats.candidates,
      verified: r.stats.verified,
      liveFacts: r.profile.facts.filter((f) => f.userStatus !== 'deleted').length,
      version: r.profile.version,
    })
  } catch (e) {
    const t1 = now()
    set({ ...base, status: 'error', finishedAt: iso(t1), seconds: Math.round((t1 - t0) / 1000), error: errorText(e) })
  } finally {
    clearInterval(heartbeat)
  }
  return state
}

/** Clears a finished, failed or interrupted job from view. A running job cannot be dismissed. */
export function dismissExtractJob(): void {
  if (state.status === 'running') return
  set({ status: 'idle' })
}

/**
 * A running record from another page is adopted while it is fresh, and becomes "interrupted" once it goes stale
 * (that page closed or reloaded mid-run). Called on load and from the UI's clock tick.
 */
export function syncExtractJob(now: Clock = Date.now): ExtractJob {
  if (state.status === 'running' && !isOwnRun() && now() - Date.parse(state.updatedAt) > STALE_MS) {
    const { pageId: _pageId, ...rest } = state
    void _pageId
    set({ ...rest, status: 'interrupted' })
  }
  return state
}

/** Applies a record written by another page. Never overrides this page's own run. */
function adopt(saved: ExtractJob | null, now: Clock): void {
  if (!saved || isOwnRun()) return
  state = saved
  notify()
  syncExtractJob(now)
}

let watching = false

/**
 * Page load: pick up what the previous page (a reload) or another open profile-page tab left in session storage,
 * and keep following that tab's updates. A reload shows the old run as "interrupted" once its record goes stale.
 */
export async function restoreExtractJob(now: Clock = Date.now): Promise<ExtractJob> {
  adopt(await readPersisted(), now)
  if (!watching && hasSessionStorage()) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session' || !(EXTRACT_JOB_KEY in changes)) return
      adopt((changes[EXTRACT_JOB_KEY]?.newValue as ExtractJob | undefined) ?? { status: 'idle' }, now)
    })
  }
  return state
}

/** One line for the UI. `now` only matters for the running stage (elapsed seconds). */
export function describeExtractJob(job: ExtractJob, now: Clock = Date.now): string {
  switch (job.status) {
    case 'idle':
      return ''
    case 'running': {
      const secs = Math.max(0, Math.round((now() - Date.parse(job.startedAt)) / 1000))
      const stage =
        job.stage === 'map'
          ? job.total > 0
            ? `Haiku reading chunk ${job.done} of ${job.total}`
            : 'Reading your messages…'
          : job.stage === 'reduce'
            ? 'Sonnet merging'
            : 'Finding repeated questions'
      const where = job.pageId === PAGE_ID ? '' : ' (in another Tailor tab)'
      return `Extracting into “${job.profileName}”${where}: ${stage} · ${secs} s`
    }
    case 'done':
      return (
        `Done in ${job.seconds} s: the model proposed ${job.candidates} facts, code verified the quotes of ${job.verified}; ` +
        `${job.liveFacts} facts saved in profile “${job.profileName}” v${job.version}.`
      )
    case 'error':
      return `Extraction into “${job.profileName}” failed after ${job.seconds} s: ${job.error}`
    case 'interrupted':
      return `Extraction into “${job.profileName}” was interrupted (the page closed or reloaded during ${job.stage}, ${job.done}/${job.total}). Nothing was saved; run it again.`
  }
}

/** Tests only: a fresh page. `persisted` is what the previous page left in session storage (default: nothing). */
export function resetExtractJobForTests(persisted: ExtractJob | null = null): void {
  state = { status: 'idle' }
  listeners.clear()
  memory = persisted
  watching = false
}
