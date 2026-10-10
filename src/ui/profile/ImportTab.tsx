/**
 * Import tab (CONTEXT.txt §3.1; demo §9 0:00–0:20 "N conversations, M messages, two sources").
 * ONE JSON file, never a zip → detectExportFormat (user overrides if 'unknown') → import.runImport, which is
 * parseExport → applyLimits → saveConversations plus skip counts → per-source stats. Then "Extract profile" runs extract.runExtract
 * (§3.2, with progress) into the active profile.
 * Nothing here logs or displays message text: the raw chats never reach the screen (§0).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatOrigin } from '@/types'
import type { ArchiveStats } from '@/messages'
import { DEFAULT_IMPORT_OPTIONS, detectExportFormat, runImport } from '@/import'
import { clearArchive, getArchiveStats } from '@/archive'
import { runExtract } from '@/extract'
import { attempt, isZipFile, monthRange, originLabel, type Attempt } from './helpers'

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
      <section className="card stack">
        <h2>Import your chat history</h2>
        <p className="muted" style={{ margin: 0 }}>
          ChatGPT: Settings › Data controls › Export data. Claude: Settings › Privacy › Export data. Unzip it and drop only{' '}
          <code>conversations.json</code>. Tailor keeps only your own messages from the last {DEFAULT_IMPORT_OPTIONS.months} months, in this
          browser.
        </p>
        <DropZone disabled={busy} onFiles={(f) => void onFiles(f)} />
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

      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Archive</h2>
          <button className="danger" onClick={() => void onClear()} disabled={busy}>
            Clear archive
          </button>
        </div>
        <StatsView stats={stats} />
      </section>

      <ExtractCard profileId={profileId} profileName={profileName} disabled={busy} />
    </div>
  )
}

function DropZone({ disabled, onFiles }: { disabled: boolean; onFiles: (files: FileList | null) => void }) {
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
      <b>Drop conversations.json here</b>
      <span className="muted">or</span>
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
  if (!stats) return <div className="muted">Loading…</div>
  if (!stats.ok) return <div className="error">Archive stats: {stats.error}</div>
  const s = stats.value
  if (s.messages === 0) return <div className="muted">Nothing imported yet.</div>
  const sources = ORIGINS.filter((o) => (s.byOrigin[o]?.messages ?? 0) > 0).length
  return (
    <div className="stack">
      <div className="big-numbers">
        <div>
          <b>{s.conversations.toLocaleString()}</b>
          <span className="muted">conversations</span>
        </div>
        <div>
          <b>{s.messages.toLocaleString()}</b>
          <span className="muted">of your messages</span>
        </div>
        <div>
          <b>{sources}</b>
          <span className="muted">{sources === 1 ? 'source' : 'sources'}</span>
        </div>
        <div>
          <b style={{ fontSize: 22, paddingTop: 8 }}>{monthRange(s.from, s.to)}</b>
          <span className="muted">from – to</span>
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

function ExtractCard({ profileId, profileName, disabled }: { profileId: string; profileName: string; disabled: boolean }) {
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [running])

  async function run() {
    setRunning(true)
    setSeconds(0)
    setProgress('')
    setResult(null)
    const t0 = Date.now()
    // Called directly: this page is in the extension origin (CLAUDE.md), so it gets live progress.
    const r = await attempt(() =>
      runExtract(profileId, (done, total, stage) =>
        setProgress(stage === 'map' ? `Haiku reading chunk ${done} of ${total}` : stage === 'reduce' ? 'Sonnet merging' : 'Finding repeated questions'),
      ),
    )
    const secs = Math.round((Date.now() - t0) / 1000)
    if (r.ok) {
      const live = r.value.profile.facts.filter((f) => f.userStatus !== 'deleted').length
      const { candidates, verified } = r.value.stats
      setResult({
        ok: true,
        text:
          `Done in ${secs} s: the model proposed ${candidates} facts, code verified the quotes of ${verified}; ` +
          `${live} facts in profile v${r.value.profile.version}. Open the Profile tab to review.`,
      })
    } else {
      setResult({ ok: false, text: `Extraction failed after ${secs} s: ${r.error}` })
    }
    setRunning(false)
  }

  return (
    <section className="card stack">
      <h2>Extract profile</h2>
      <p className="muted" style={{ margin: 0 }}>
        Haiku proposes facts with a quote from your own messages; code checks every quote; Sonnet merges and scores them. Everything the
        model proposes and code verifies goes into the profile; review it on the Profile tab.
      </p>
      <div className="row">
        <button className="primary" disabled={running || disabled} onClick={() => void run()}>
          {running ? 'Extracting…' : `Extract into “${profileName}”`}
        </button>
        {running && (
          <span className="muted">
            {progress || 'Reading your messages…'} · {seconds} s
          </span>
        )}
      </div>
      {result && <div className={result.ok ? 'ok' : 'error'}>{result.text}</div>}
    </section>
  )
}
