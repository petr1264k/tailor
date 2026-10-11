/**
 * The extraction job for the profile page. Owner: Petr.
 *
 * One extraction at a time, owned by the PAGE rather than by a React component, so switching between the Import,
 * Profile and Receipts tabs never unmounts it: the run keeps going and its progress, result or error shows on every
 * tab. The state is mirrored to chrome.storage.session, so a reload (or a second profile-page tab) shows what
 * happened, and the result stays visible until dismissed.
 *
 * The page that runs the job holds a Web Lock for as long as it runs. The browser drops the lock when that page
 * dies, so another page (or the same tab after a reload) can tell a live run from a dead one at once, and a second
 * tab cannot start a run alongside it. Where the Lock API is missing (vitest) the heartbeat age decides instead.
 *
 * The model calls run in this page, not in the background worker: Chrome stops an extension service worker when a
 * fetch takes more than 30 s to answer, which the Sonnet merge regularly does. Closing or reloading the page
 * therefore stops the run; the page warns before unload, and a run cut short shows as "interrupted" afterwards.
 * Facts are saved to the profile by runExtract as soon as the run completes (src/extract).
 * stopExtract() cancels this page's run mid-flight (in-flight model calls included); a stopped run saves nothing.
 */
import { runExtract } from '@/extract'

export type ExtractStage = 'map' | 'reduce' | 'questions'

interface JobBase {
  profileId: string
  profileName: string
  startedAt: string
}

export interface RunningJob extends JobBase {
  status: 'running'
  stage: ExtractStage
  done: number
  total: number
  /** Last progress or heartbeat. Decides live vs dead only where the Lock API is missing. */
  updatedAt: string
  /** The page that runs it. Only that page may advance or finish the job. */
  pageId: string
}

export type ExtractJob =
  | { status: 'idle' }
  | RunningJob
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
  | (JobBase & { status: 'stopped'; finishedAt: string; seconds: number; stage: ExtractStage; done: number; total: number })
  | (JobBase & { status: 'interrupted'; stage: ExtractStage; done: number; total: number; updatedAt: string })

/** What chrome.storage.session holds: the job plus the page that wrote it, so a page can ignore its own echoes. */
interface StoredJob {
  writer: string
  job: ExtractJob
}

export const EXTRACT_JOB_KEY = 'tailor.extractJob'
/** Held by the running page for the whole run (Web Locks API); released by the browser when the page goes away. */
export const EXTRACT_LOCK = 'tailor.extract'
/** Without the Lock API: a running record older than this (no progress, no heartbeat) belongs to a page that is gone. */
export const STALE_MS = 150_000
const HEARTBEAT_MS = 5_000
/** This page's identity for the lifetime of the document. A reload gets a new one. */
export const PAGE_ID = crypto.randomUUID()

type Listener = (job: ExtractJob) => void
type Clock = () => number

let state: ExtractJob = { status: 'idle' }
const listeners = new Set<Listener>()
/** vitest fallback for chrome.storage.session. */
let memory: StoredJob | null = null
let watching = false
/** This page's run: its abort switch and its promise (stopExtract waits for it to settle). */
let controller: AbortController | null = null
let current: Promise<void> | null = null

function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.session
}

function lockManager(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null
}

async function persist(job: ExtractJob): Promise<void> {
  const stored: StoredJob = { writer: PAGE_ID, job }
  if (hasSessionStorage()) await chrome.storage.session.set({ [EXTRACT_JOB_KEY]: stored })
  else memory = stored
}

function asStored(value: unknown): StoredJob | null {
  const v = value as Partial<StoredJob> | undefined
  return v && typeof v === 'object' && typeof v.writer === 'string' && v.job && typeof v.job.status === 'string' ? (v as StoredJob) : null
}

async function readPersisted(): Promise<StoredJob | null> {
  if (!hasSessionStorage()) return memory
  const raw = await chrome.storage.session.get(EXTRACT_JOB_KEY)
  return asStored(raw[EXTRACT_JOB_KEY])
}

function notify(): void {
  for (const l of listeners) l(state)
}

/** Sets the state, tells the page, mirrors it to session storage (a storage error never breaks the run). */
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
 * Starts the run. Rejects when this page, or another profile-page tab, already runs one. Progress, heartbeat, result
 * and error all land in the state; the returned promise resolves with the final state (done or error).
 */
export async function startExtract(profileId: string, profileName: string, now: Clock = Date.now): Promise<ExtractJob> {
  if (isOwnRun()) throw new Error(`Extraction into “${(state as RunningJob).profileName}” is already running on this page.`)
  const locks = lockManager()
  if (!locks) {
    await (current = runJob(profileId, profileName, now))
    return state
  }
  const ran = await locks.request(EXTRACT_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return false
    await (current = runJob(profileId, profileName, now))
    return true
  })
  if (!ran) throw new Error('An extraction is already running in another Tailor tab. Let it finish first.')
  return state
}

async function runJob(profileId: string, profileName: string, now: Clock): Promise<void> {
  const t0 = now()
  const base: JobBase = { profileId, profileName, startedAt: iso(t0) }
  set({ ...base, status: 'running', stage: 'map', done: 0, total: 0, updatedAt: iso(t0), pageId: PAGE_ID })

  const heartbeat = setInterval(() => {
    if (isOwnRun()) set({ ...(state as RunningJob), updatedAt: iso(now()) })
  }, HEARTBEAT_MS)
  const abort = (controller = new AbortController())

  try {
    const r = await runExtract(
      profileId,
      (done, total, stage) => {
        if (!isOwnRun()) return
        set({ ...(state as RunningJob), stage, done, total, updatedAt: iso(now()) })
      },
      abort.signal,
    )
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
    const seconds = Math.round((t1 - t0) / 1000)
    if (abort.signal.aborted) {
      const { stage, done, total } = state as RunningJob
      set({ ...base, status: 'stopped', finishedAt: iso(t1), seconds, stage, done, total })
    } else set({ ...base, status: 'error', finishedAt: iso(t1), seconds, error: errorText(e) })
  } finally {
    clearInterval(heartbeat)
    controller = null
    current = null
  }
}

/** Stops this page's run mid-flight and waits until it has settled as 'stopped'. A no-op when this page runs nothing. */
export async function stopExtract(): Promise<void> {
  if (!isOwnRun() || !controller) return
  const settling = current
  controller.abort(new DOMException('Extraction stopped', 'AbortError'))
  await settling
}

/** Clears a finished, failed or interrupted job from view. A running job cannot be dismissed. */
export function dismissExtractJob(): void {
  if (state.status === 'running') return
  set({ status: 'idle' })
}

/** Whether the page that owns the running record is still alive: from the Web Lock, or null when the API is missing. */
async function ownerAlive(): Promise<boolean | null> {
  const locks = lockManager()
  if (!locks) return null
  const { held } = await locks.query()
  return (held ?? []).some((l) => l.name === EXTRACT_LOCK)
}

function interrupted(r: RunningJob): ExtractJob {
  return {
    status: 'interrupted',
    profileId: r.profileId,
    profileName: r.profileName,
    startedAt: r.startedAt,
    stage: r.stage,
    done: r.done,
    total: r.total,
    updatedAt: r.updatedAt,
  }
}

/**
 * Turns a running record whose page is gone (closed or reloaded mid-run) into "interrupted": at once via the Web
 * Lock, or by heartbeat age where the API is missing. Called on load, on every storage change and from the UI's
 * clock tick. This page's own run is never touched.
 */
export async function syncExtractJob(now: Clock = Date.now): Promise<ExtractJob> {
  if (state.status !== 'running' || isOwnRun()) return state
  const running = state
  const alive = await ownerAlive()
  if (state !== running) return state // changed while we asked
  const dead = alive === null ? now() - Date.parse(running.updatedAt) > STALE_MS : !alive
  if (dead) set(interrupted(running))
  return state
}

/**
 * Applies a record written by another page. This page's own writes are ignored (its in-memory state is the truth,
 * and chrome.storage.onChanged echoes them back later), and nothing replaces this page's own run.
 */
async function adopt(stored: StoredJob | null, now: Clock): Promise<ExtractJob> {
  if (!stored || stored.writer === PAGE_ID || isOwnRun()) return state
  if (stored.job.status === 'running' && stored.job.pageId === PAGE_ID) return state // our own earlier record, whoever relayed it
  state = stored.job
  notify()
  return syncExtractJob(now)
}

/**
 * Page load: pick up what the previous page (a reload) or another open profile-page tab left in session storage,
 * and keep following that tab's updates. A reload shows the old run as "interrupted".
 */
export async function restoreExtractJob(now: Clock = Date.now): Promise<ExtractJob> {
  await adopt(await readPersisted(), now)
  if (!watching && hasSessionStorage()) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session' || !(EXTRACT_JOB_KEY in changes)) return
      void adopt(asStored(changes[EXTRACT_JOB_KEY]?.newValue), now)
    })
  }
  return state
}

function stageLabel(stage: ExtractStage, done: number, total: number, tense: 'now' | 'then'): string {
  if (stage === 'map') {
    if (total === 0) return tense === 'now' ? 'Reading your messages…' : 'reading your messages'
    return tense === 'now' ? `Haiku reading chunk ${done} of ${total}` : `Haiku was reading chunk ${done} of ${total}`
  }
  if (stage === 'reduce') return tense === 'now' ? 'Sonnet merging' : 'Sonnet was merging'
  return tense === 'now' ? 'Finding repeated questions' : 'finding repeated questions'
}

/** One line for the UI. `now` only matters for the running stage (elapsed seconds). */
export function describeExtractJob(job: ExtractJob, now: Clock = Date.now): string {
  switch (job.status) {
    case 'idle':
      return ''
    case 'running': {
      const secs = Math.max(0, Math.round((now() - Date.parse(job.startedAt)) / 1000))
      const where = job.pageId === PAGE_ID ? '' : ' (in another tab)'
      return `Extracting into “${job.profileName}”${where}: ${stageLabel(job.stage, job.done, job.total, 'now')} · ${secs} s`
    }
    case 'done':
      return (
        `Done in ${job.seconds} s: the model proposed ${job.candidates} facts, code verified the quotes of ${job.verified}; ` +
        `profile “${job.profileName}” v${job.version} now has ${job.liveFacts} live facts.`
      )
    case 'error':
      return `Extraction into “${job.profileName}” failed after ${job.seconds} s: ${job.error}`
    case 'stopped':
      return `Stopped extraction into “${job.profileName}” after ${job.seconds} s, while ${stageLabel(job.stage, job.done, job.total, 'then')}. Nothing was saved.`
    case 'interrupted':
      return (
        `Extraction into “${job.profileName}” was interrupted while ${stageLabel(job.stage, job.done, job.total, 'then')} ` +
        '(the page closed or reloaded). Nothing was saved; run it again.'
      )
  }
}

/** Tests only: a fresh page. `persisted` is what a previous page left in session storage, as that page wrote it. */
export function resetExtractJobForTests(persisted: { writer: string; job: ExtractJob } | null = null): void {
  state = { status: 'idle' }
  listeners.clear()
  memory = persisted
  watching = false
  controller = null
  current = null
}
