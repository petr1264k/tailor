/**
 * Import tab (CONTEXT.txt §3.1; demo §9 0:00–0:20 "N conversations, M messages, two sources").
 * Hero (coframe-style dark band + white stats card) with the archive numbers, then Import and Extract side by side.
 * ONE JSON file, never a zip → detectExportFormat (user overrides if 'unknown') → import.runImport, which is
 * parseExport → applyLimits → saveConversations plus skip counts → per-source stats. Then "Extract profile" starts the
 * page-level extraction job (extractJob.ts → extract.runExtract, §3.2) into the active profile; it keeps running across the tabs.
 * The shortcut past extraction: drop a saved profile file (*.profile.json, a §6 Profile) → profile.loadProfileFile.
 * Nothing here logs or displays message text: the raw chats never reach the screen (§0).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatOrigin } from '@/types'
import type { ArchiveStats } from '@/messages'
import { DEFAULT_IMPORT_OPTIONS, detectExportFormat, runImport } from '@/import'
import { clearArchive, getArchiveStats } from '@/archive'
import { activeFacts, getProfile, loadProfileFile, parseProfileFile } from '@/profile'
import { attempt, isZipFile, monthRange, originLabel, type Attempt } from './helpers'
import { describeExtractJob, dismissExtractJob, isOwnRun, startExtract } from './extractJob'
import { useExtractJob } from './useExtractJob'

const ORIGINS: ChatOrigin[] = ['chatgpt', 'claude']

/** A parsed file waiting for the user to say which export it is (detection said 'unknown' or threw). */
interface Pending {
  fileName: string
  json: unknown
  note: string
}

export function ImportTab({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [stats, setStats] = useState<Attempt<ArchiveStats> | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [importLine, setImportLine] = useState<{ ok: boolean; text: string } | null>(null)

  const refreshStats = useCallback(async () => setStats(await attempt(getArchiveStats)), [])
  useEffect(() => void refreshStats(), [refreshStats])

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    if (files.length > 1) return setImportLine({ ok: false, text: 'Drop one file at a time.' })
    const file = files[0]!
    setPending(null)
    if (isZipFile(file.name, file.type)) {
      return setImportLine({ ok: false, text: 'That is the zip. Unzip it and drop only conversations.json (the zip can be gigabytes).' })
    }
    setBusy(true)
    setImportLine({ ok: true, text: `Reading ${file.name}…` })
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      // Deliberately no parser message: it can quote a snippet of the file, i.e. chat text (§0).
      setBusy(false)
      return setImportLine({ ok: false, text: `${file.name} is not valid JSON. Use conversations.json from the export.` })
    }
    const detected = await attempt(() => detectExportFormat(json))
    if (detected.ok && detected.value !== 'unknown') return doImport(json, detected.value, file.name)
    setBusy(false)
    if ((await attempt(() => parseProfileFile(json))).ok) {
      return setImportLine({ ok: false, text: `${file.name} is a profile, not a chat export. Drop it under “Load a saved profile”.` })
    }
    setImportLine(null)
    setPending({
      fileName: file.name,
      json,
      note: detected.ok ? 'Tailor could not tell which export this is.' : `Format detection failed: ${detected.error}`,
    })
  }

  async function doImport(json: unknown, origin: ChatOrigin, fileName: string) {
    setPending(null)
    setBusy(true)
    setImportLine({ ok: true, text: `Importing ${fileName} as a ${originLabel(origin)} export…` })
    // runImport: parse → applyLimits → saveConversations. A detected format wins over `origin` (the override).
    const r = await attempt(() => runImport(json, origin, DEFAULT_IMPORT_OPTIONS))
    setBusy(false)
    if (!r.ok) return setImportLine({ ok: false, text: `Import failed: ${r.error}` })
    const { conversations, messages, droppedByLimits, skippedConversations } = r.value
    const malformed = r.value.skippedMessages - droppedByLimits
    setImportLine({
      ok: true,
      text:
        `${originLabel(r.value.origin)}: saved ${conversations.toLocaleString()} conversations, ${messages.toLocaleString()} of your own messages.` +
        (droppedByLimits > 0 ? ` ${droppedByLimits.toLocaleString()} older or over the token cap were left out.` : '') +
        (malformed > 0 || skippedConversations > 0
          ? ` Skipped as unreadable: ${malformed.toLocaleString()} messages, ${skippedConversations.toLocaleString()} conversations.`
          : ''),
    })
    await refreshStats()
  }

  async function onClear() {
    if (!window.confirm('Delete every imported message from this browser? Profiles and receipts stay.')) return
    const r = await attempt(clearArchive)
    setImportLine(r.ok ? { ok: true, text: 'Archive cleared.' } : { ok: false, text: `Clear failed: ${r.error}` })
    await refreshStats()
  }

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="tag">Your archive</span>
          <h1>Your ChatGPT and Claude history knows you better than any website does.</h1>
          <p>
            Tailor keeps only your own messages from the last {DEFAULT_IMPORT_OPTIONS.months} months, in this browser. Nothing leaves it
            except the facts you approve.
          </p>
        </div>
        <div className="hero-card">
          <div className="row between">
            <span className="label">Archive</span>
            <button className="danger sm" onClick={() => void onClear()} disabled={busy}>
              Clear archive
            </button>
          </div>
          <StatsView stats={stats} />
        </div>
      </section>

      <div className="two-col">
        <section className="card stack">
          <div className="card-head">
            <span className="tag">Import</span>
            <h2>Import your chat history</h2>
            <p className="muted">
              ChatGPT: Settings › Data controls › Export data. Claude: Settings › Privacy › Export data. Unzip it and drop only{' '}
              <code>conversations.json</code>.
            </p>
          </div>
          <DropZone label="Drop conversations.json here" disabled={busy} onFiles={(f) => void onFiles(f)} />
          {pending && (
            <div className="row">
              <span>
                {pending.note} Which export is <b>{pending.fileName}</b>?
              </span>
              {ORIGINS.map((o) => (
                <button key={o} className="primary" onClick={() => void doImport(pending.json, o, pending.fileName)}>
                  {originLabel(o)}
                </button>
              ))}
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          )}
          {importLine && <div className={importLine.ok ? 'ok' : 'error'}>{importLine.text}</div>}
        </section>

        <ExtractCard profileId={profileId} profileName={profileName} disabled={busy} />
      </div>
    </div>
  )
}

/** Reads the one dropped JSON file. Returns an error line instead of the parser message (it can quote file text, §0). */
async function readOneJson(files: FileList | null): Promise<{ file: File; json: unknown } | { error: string } | null> {
  if (!files || files.length === 0) return null
  if (files.length > 1) return { error: 'Drop one file at a time.' }
  const file = files[0]!
  try {
    return { file, json: JSON.parse(await file.text()) }
  } catch {
    return { error: `${file.name} is not valid JSON.` }
  }
}

function DropZone({ label, disabled, onFiles }: { label: string; disabled: boolean; onFiles: (files: FileList | null) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className={over ? 'drop over' : 'drop'}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) onFiles(e.dataTransfer.files)
      }}
    >
      <b>{label}</b>
      <span className="muted small">or</span>
      <button className="primary" disabled={disabled} onClick={() => input.current?.click()}>
        Choose file
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = '' // allow re-importing the same file
        }}
      />
    </div>
  )
}

function StatsView({ stats }: { stats: Attempt<ArchiveStats> | null }) {
  if (!stats) return <div className="empty">Loading…</div>
  if (!stats.ok) return <div className="error">Archive stats: {stats.error}</div>
  const s = stats.value
  if (s.messages === 0) {
    return (
      <div className="empty">
        Nothing imported yet. Drop a <code>conversations.json</code> below.
      </div>
    )
  }
  const sources = ORIGINS.filter((o) => (s.byOrigin[o]?.messages ?? 0) > 0).length
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <span className="label">Conversations</span>
          <b>{s.conversations.toLocaleString()}</b>
        </div>
        <div className="stat">
          <span className="label">Your messages</span>
          <b>{s.messages.toLocaleString()}</b>
        </div>
        <div className="stat">
          <span className="label">{sources === 1 ? 'Source' : 'Sources'}</span>
          <b>{sources}</b>
        </div>
        <div className="stat">
          <span className="label">From – to</span>
          <b className="text">{monthRange(s.from, s.to)}</b>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th className="num">Conversations</th>
            <th className="num">Messages</th>
          </tr>
        </thead>
        <tbody>
          {ORIGINS.map((o) => (
            <tr key={o}>
              <td>{originLabel(o)}</td>
              <td className="num">{(s.byOrigin[o]?.conversations ?? 0).toLocaleString()}</td>
              <td className="num">{(s.byOrigin[o]?.messages ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Starts the page-level extraction job (extractJob.ts). The job outlives this card: switching to the Profile or
 * Receipts tab keeps it running, and its progress, result, error or interruption shows here and in a status strip
 * on the other tabs.
 */
function ExtractCard({ profileId, profileName, disabled }: { profileId: string; profileName: string; disabled: boolean }) {
  const job = useExtractJob()
  const own = isOwnRun(job)
  const running = job.status === 'running'
  const [startError, setStartError] = useState<string | null>(null)

  async function run() {
    setStartError(null)
    const r = await attempt(() => startExtract(profileId, profileName))
    if (!r.ok) setStartError(r.error)
  }

  const [loadLine, setLoadLine] = useState<{ ok: boolean; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  /** A saved profile file replaces this profile's facts: the shortcut past extraction (e.g. claude.profile.json). */
  async function onProfileFile(files: FileList | null) {
    const read = await readOneJson(files)
    if (!read) return
    if ('error' in read) return setLoadLine({ ok: false, text: read.error })
    const { file, json } = read
    const parsed = await attempt(() => parseProfileFile(json))
    if (!parsed.ok) return setLoadLine({ ok: false, text: `${file.name}: ${parsed.error}` })
    const current = await attempt(() => getProfile(profileId))
    const existing = current.ok ? activeFacts(current.value).length : 0
    const incoming = parsed.value.facts.length
    if (existing > 0 && !window.confirm(`Replace the ${existing} facts in “${profileName}” with the ${incoming} facts in ${file.name}?`)) return
    setLoading(true)
    const r = await attempt(() => loadProfileFile(json, profileId))
    setLoading(false)
    setLoadLine(
      r.ok
        ? { ok: true, text: `Loaded ${incoming} facts from ${file.name} into “${profileName}”. Open the Profile tab to review.` }
        : { ok: false, text: `Load failed: ${r.error}` },
    )
  }

  const line = describeExtractJob(job)
  const hint = job.status === 'done' ? (job.profileId === profileId ? ' Open the Profile tab to review.' : ' Switch to that profile to review.') : ''
  return (
    <section className="card stack">
      <div className="card-head">
        <span className="tag">Extract</span>
        <h2>Extract profile</h2>
        <p className="muted">
          Haiku proposes facts with a quote from your own messages; code checks every quote; Sonnet merges and scores them. Keep, edit or
          delete any fact on the Profile tab. The run keeps going while you look at the other tabs and the facts are saved to the profile
          the moment it finishes; closing or reloading this page stops it.
        </p>
      </div>
      <div className="row">
        <button className={running ? 'primary' : 'primary arrow'} disabled={running || disabled} onClick={() => void run()}>
          {own ? 'Extracting…' : running ? 'Running in another tab…' : `Extract into “${profileName}”`}
        </button>
        {running && <span className="progress">{line}</span>}
      </div>
      {startError && <div className="error">{startError}</div>}
      {job.status !== 'idle' && !running && (
        <div className="row between">
          <div className={job.status === 'done' ? 'ok' : 'error'}>
            {line}
            {hint}
          </div>
          <button className="sm" onClick={dismissExtractJob}>
            Dismiss
          </button>
        </div>
      )}
      <div className="card-head load-head">
        <h3>Load a saved profile</h3>
        <p className="muted small">
          Already extracted? Drop a profile file (<code>*.profile.json</code>). It replaces the facts in “{profileName}”.
        </p>
      </div>
      <DropZone
        label="Drop a .profile.json here"
        disabled={running || loading || disabled}
        onFiles={(f) => void onProfileFile(f)}
      />
      {loadLine && <div className={loadLine.ok ? 'ok' : 'error'}>{loadLine.text}</div>}
    </section>
  )
}
