/**
 * Popup (Owner: Petr). Key entry, status, "Tailor this page", "Open profile".
 * Runs in the extension origin: may call settings directly.
 */
import { useEffect, useState } from 'react'
import { getSettings, setSettings } from '@/settings'
import { sendToTab, type ContentStatus } from '@/messages'

export function App() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState<ContentStatus | null>(null)

  useEffect(() => {
    void getSettings().then((s) => setKey(s.anthropicKey ?? ''))
  }, [])

  async function activeTabId(): Promise<number | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.id
  }

  async function tailorThisPage() {
    const id = await activeTabId()
    if (id === undefined) return
    setStatus((await sendToTab(id, { type: 'content/tailor' })) ?? null)
  }

  return (
    <div style={{ padding: 14, display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 16 }}>Tailor</strong>
      <label style={{ display: 'grid', gap: 4 }}>
        <span>Anthropic API key (stays in this browser)</span>
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
      <button
        onClick={() => {
          void setSettings({ anthropicKey: key.trim() || undefined }).then(() => setSaved(true))
        }}
      >
        {saved ? 'Saved' : 'Save key'}
      </button>
      <button onClick={() => void tailorThisPage()}>Tailor this page</button>
      <button onClick={() => void chrome.runtime.openOptionsPage()}>Open profile</button>
      {status && (
        <small style={{ opacity: 0.7 }}>
          {status.mode}
          {status.gate ? ` · gate checked ${status.gate.checked}, stripped ${status.gate.stripped.length}` : ''}
        </small>
      )}
    </div>
  )
}
