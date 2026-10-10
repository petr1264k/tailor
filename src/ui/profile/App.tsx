/**
 * Profile page (options page, opens in a tab). Owner: Petr.
 *
 * Tabs (CONTEXT.txt §3.1, §3.4, §9):
 *  - Import:   drop conversations.json (ChatGPT) / Claude export → archive stats (N conversations, M messages, two sources)
 *  - Profile:  facts with source quotes; keep / edit / delete; split: ChatGPT-only, Claude-only, overlap;
 *              "never extracted" list with counts; switch between profiles (Mikhail / Petr)
 *  - Receipts: what was shared with which site, when (SiteShare)
 * Runs in the extension origin: call modules directly (import, archive, profile) instead of messaging.
 */
import { useState } from 'react'

type Tab = 'import' | 'profile' | 'receipts'

export function App() {
  const [tab, setTab] = useState<Tab>('import')
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Tailor</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          {(['import', 'profile', 'receipts'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ fontWeight: tab === t ? 700 : 400 }}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'import' && <ImportScreen />}
      {tab === 'profile' && <ProfileViewer />}
      {tab === 'receipts' && <Receipts />}
    </div>
  )
}

function ImportScreen() {
  // TODO(ui.import): file input → JSON.parse → import.detectExportFormat → parseExport → archive.saveConversations → stats; then "Extract profile" → extract handler
  return <section>Import: drop <code>conversations.json</code> here. (TODO)</section>
}

function ProfileViewer() {
  // TODO(ui.profile): list facts with formatEvidence(); keep/edit/delete; source split; never-extracted counts; profile switcher
  return <section>Profile viewer. (TODO)</section>
}

function Receipts() {
  // TODO(ui.receipts): profile.shares → table of url, needsText, facts, at
  return <section>Share receipts. (TODO)</section>
}
