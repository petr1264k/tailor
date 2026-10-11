/**
 * Popup (Owner: Petr). Key entry, active profile, "Tailor this page" / "Show original" / "Share with this site",
 * status with gate counts (§3.6), "Tailor pages automatically as they load" (§3.5, on by default), demo mode (§9, on by
 * default: the changes play top to bottom with motion). CONTEXT.txt §3.5–3.9, §4.
 * Runs in the extension origin: reads settings and profiles directly; talks to the page via sendToTab.
 * Every call is wrapped; errors show inline. Look: coframe.com (src/ui/theme.css).
 */
import { useEffect, useState } from 'react'
import { getSettings, setSettings } from '@/settings'
import { send, sendToTab, type ContentCommand, type ContentStatus } from '@/messages'
import { listProfiles } from '@/profile'
import { attempt } from '../profile/helpers'
import { Brand } from '../Brand'
import { describeStatus } from './status'

const NOT_RUNNING = 'Tailor is not on this tab. Switch to a normal web page (Chrome blocks every extension on chrome:// and the Web Store), or reload a page that was open before the extension loaded.'
/** Hidden for the demo: "Share with this site" (§3.9, §4). Set true to bring the button back. */
const SHOW_SHARE = false
const POLL_MS = 1000
const POLL_MAX = 90

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

export function App() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  /** A key is in storage (null until settings load). With a key, the key fields stay folded until "Change". */
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [editingKey, setEditingKey] = useState(false)
  const [apiTest, setApiTest] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [autoTailor, setAutoTailor] = useState(true)
  const [demoMode, setDemoMode] = useState(true)
  const [status, setStatus] = useState<ContentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await attempt(getSettings)
      if (!s.ok) return setError(s.error)
      setKey(s.value.anthropicKey ?? '')
      setHasKey(!!s.value.anthropicKey)
      setAutoTailor(s.value.autoTailorOnLoad)
      setDemoMode(s.value.demoMode)
      setProfileName(s.value.activeProfileId)
      const list = await attempt(listProfiles)
      const name = list.ok ? list.value.find((p) => p.id === s.value.activeProfileId)?.name : undefined
      if (name) setProfileName(name)
    })()
    void command({ type: 'content/status' }, { quiet: true })
  }, [])

  /** Sends a command to the content script in the active tab, then polls while it is tailoring. */
  async function command(cmd: ContentCommand, opts: { quiet?: boolean } = {}) {
    const id = await attempt(activeTabId)
    if (!id.ok || id.value === undefined) return setError(NOT_RUNNING)
    setBusy(!opts.quiet)
    const r = await attempt(() => sendToTab(id.value!, cmd))
    setBusy(false)
    if (!r.ok) return setError(opts.quiet ? NOT_RUNNING : `${NOT_RUNNING} (${r.error})`)
    setError(null)
    setStatus(r.value ?? null)
    for (let i = 0; i < POLL_MAX && r.value?.mode === 'loading'; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      const next = await attempt(() => sendToTab(id.value!, { type: 'content/status' }))
      if (!next.ok || !next.value) return
      setStatus(next.value)
      if (next.value.mode !== 'loading') return
    }
  }

  async function saveKey() {
    const trimmed = key.trim()
    const r = await attempt(() =>
      setSettings({ anthropicKey: trimmed || undefined }),
    )
    if (!r.ok) return setError(r.error)
    setSaved(true)
    setHasKey(!!trimmed)
    setEditingKey(false)
  }

  async function cancelKeyEdit() {
    const s = await attempt(getSettings)
    if (s.ok) setKey(s.value.anthropicKey ?? '')
    setSaved(false)
    setEditingKey(false)
  }

  async function toggleAutoTailor(on: boolean) {
    setAutoTailor(on)
    const r = await attempt(() => setSettings({ autoTailorOnLoad: on }))
    if (!r.ok) {
      setAutoTailor(!on)
      setError(r.error)
    }
  }

  async function toggleDemoMode(on: boolean) {
    setDemoMode(on)
    const r = await attempt(() => setSettings({ demoMode: on }))
    if (!r.ok) {
      setDemoMode(!on)
      setError(r.error)
    }
  }

  function testKey() {
    setApiTest('Testing…')
    void send('llm/test', {}).then(
      (r) => setApiTest(r.ok ? `OK: ${r.model} answered in ${r.ms} ms` : `FAILED (${r.model}, ${r.ms} ms)\n${r.error ?? ''}`),
      (err: unknown) => setApiTest(`FAILED\n${err instanceof Error ? err.message : String(err)}`),
    )
  }

  return (
    <div className="popup">
      <header className="head">
        <Brand light />
        <div className="who">
          <span className="label">Profile</span>
          <span>
            <b>{profileName || '…'}</b>
            <button className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
              Open
            </button>
          </span>
        </div>
      </header>

      <div className="body">
        <button className="primary big arrow" disabled={busy} onClick={() => void command({ type: 'content/tailor' })}>
          Tailor this page
        </button>
        {SHOW_SHARE ? (
          <div className="pair">
            <button disabled={busy} onClick={() => void command({ type: 'content/original' })}>
              Show original
            </button>
            <button
              disabled={busy}
              title={status && !status.hasAgentHooks ? 'This page does not ask agents what you need' : undefined}
              onClick={() => void command({ type: 'content/share' })}
            >
              Share with this site
            </button>
          </div>
        ) : (
          <button disabled={busy} onClick={() => void command({ type: 'content/original' })}>
            Show original
          </button>
        )}

        {status && (
          <div className="panel">
            <span className="label">Status</span>
            <div className="status-line">{describeStatus(status)}</div>
            {status.scorecard && <div className="hint">{status.scorecard}</div>}
            {status.message && <div className={status.isError ? 'error' : 'hint'}>{status.message}</div>}
            {SHOW_SHARE && status.hasAgentHooks && (
              <div className="hint">This site asks agents what you need. Sharing shows you the exact words first.</div>
            )}
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="panel">
          <span className="label">Settings</span>
          <label className="check">
            <input type="checkbox" checked={autoTailor} onChange={(e) => void toggleAutoTailor(e.target.checked)} />
            Tailor pages automatically as they load
          </label>
          <label className="check" title="The changes play one by one from the top of the page down, with motion, and the window follows. Off: they land at once.">
            <input type="checkbox" checked={demoMode} onChange={(e) => void toggleDemoMode(e.target.checked)} />
            Demo mode: play the changes top to bottom
          </label>
          {hasKey && !editingKey && (
            <div className="key-row">
              <span className="hint">Anthropic API key saved</span>
              <button className="link" onClick={() => setEditingKey(true)}>
                Change
              </button>
            </div>
          )}
          {hasKey === false || editingKey ? (
            <>
              <label className="field">
                <span className="hint">Anthropic API key (stays in this browser)</span>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value)
                    setSaved(false)
                  }}
                  placeholder="sk-ant-…"
                />
              </label>
              <div className="pair">
                <button onClick={() => void saveKey()}>{saved ? 'Saved' : 'Save key'}</button>
                <button onClick={testKey}>Test API key</button>
              </div>
              {editingKey && (
                <button className="link key-cancel" onClick={() => void cancelKeyEdit()}>
                  Cancel
                </button>
              )}
            </>
          ) : null}
          {apiTest && <pre className="api-out">{apiTest}</pre>}
        </div>
      </div>
    </div>
  )
}
