/**
 * Profile page (options page, opens in a tab). Owner: Petr. Look: coframe.com (src/ui/theme.css).
 *
 * Tabs (CONTEXT.txt §3.1, §3.4, §4 step 6, §9 0:00–0:45):
 *  - Import:   ONE JSON file (ChatGPT conversations.json or the Claude export) → archive stats per source → Extract profile
 *  - Profile:  facts by category with source quotes; keep / edit / delete / restore; ChatGPT / Claude / both split
 *  - Receipts: what was shared with which site, when (SiteShare)
 * The extraction job (extractJob.ts) belongs to the page, not to the Import tab: it keeps running while another tab is
 * open, its status strip shows on the other tabs, and the page warns before unload while it runs.
 * The top bar carries the "Tailor pages automatically as they load" switch (§3.5) and the profile switcher, so the
 * active profile (Mikhail / Petr) is visible on every tab.
 * Runs in the extension origin: calls modules directly. Every call is wrapped (attempt); errors show inline.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSettings, setSettings } from '@/settings'
import { DEFAULT_PROFILE_ID, listProfiles } from '@/profile'
import { Brand } from '../Brand'
import { Switch } from '../Switch'
import { attempt } from './helpers'
import { createProfile } from './store'
import { ImportTab } from './ImportTab'
import { describeExtractJob, dismissExtractJob, isOwnRun, restoreExtractJob, type ExtractJob } from './extractJob'
import { useExtractJob } from './useExtractJob'
import { ProfileTab } from './ProfileTab'
import { ReceiptsTab } from './ReceiptsTab'

type Tab = 'import' | 'profile' | 'receipts'
/** Receipts is hidden for the demo (sharing is off): set `hidden: false` to bring the tab back. */
const TABS: { id: Tab; label: string; hidden?: boolean }[] = [
  { id: 'import', label: 'Import' },
  { id: 'profile', label: 'Profile' },
  { id: 'receipts', label: 'Receipts', hidden: true },
]

type ProfileEntry = { id: string; name: string }

export function App() {
  const [tab, setTab] = useState<Tab>('import')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileEntry[]>([])
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [autoTailor, setAutoTailor] = useState(true)
  const job = useExtractJob()
  const ownRun = isOwnRun(job)

  useEffect(() => {
    void restoreExtractJob()
  }, [])

  // Leaving the page would stop the run (the model calls live in this page), so ask first.
  useEffect(() => {
    if (!ownRun) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [ownRun])

  const refreshProfiles = useCallback(async () => {
    const r = await attempt(listProfiles)
    if (r.ok) setProfiles(r.value.map((p) => ({ id: p.id, name: p.name })))
    else setSwitchError(`Profiles: ${r.error}`)
  }, [])

  useEffect(() => {
    void attempt(getSettings).then((r) => {
      setProfileId(r.ok ? r.value.activeProfileId : DEFAULT_PROFILE_ID)
      if (r.ok) setAutoTailor(r.value.autoTailorOnLoad)
    })
    void refreshProfiles()
  }, [refreshProfiles])

  async function switchTo(id: string) {
    const r = await attempt(() => setSettings({ activeProfileId: id }))
    if (!r.ok) return setSwitchError(r.error)
    setSwitchError(null)
    setProfileId(id)
  }

  async function toggleAutoTailor(on: boolean) {
    setAutoTailor(on)
    const r = await attempt(() => setSettings({ autoTailorOnLoad: on }))
    if (!r.ok) {
      setAutoTailor(!on)
      setSwitchError(r.error)
    }
  }

  async function newProfile(name: string): Promise<boolean> {
    const r = await attempt(() => createProfile(name))
    if (!r.ok) {
      setSwitchError(r.error)
      return false
    }
    await refreshProfiles()
    await switchTo(r.value.id)
    return true
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <nav className="tabs" role="tablist">
            {TABS.filter((t) => !t.hidden).map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <Switch label="Tailor pages automatically as they load" checked={autoTailor} onChange={(on) => void toggleAutoTailor(on)} />
            {profileId && (
              <ProfileSwitcher profiles={profiles} activeId={profileId} onSwitch={switchTo} onCreate={newProfile} />
            )}
          </div>
        </div>
      </header>
      <main className="page">
        {switchError && <div className="error">{switchError}</div>}
        {tab !== 'import' && job.status !== 'idle' && <ExtractStrip job={job} onView={job.status === 'done' && job.profileId === profileId && tab !== 'profile' ? () => setTab('profile') : undefined} />}
        {/* key={profileId}: switching profiles remounts the tab so it reloads that profile's data */}
        {profileId && tab === 'import' && <ImportTab key={profileId} profileId={profileId} profileName={nameOf(profiles, profileId)} />}
        {profileId && tab === 'profile' && <ProfileTab key={profileId} profileId={profileId} profileName={nameOf(profiles, profileId)} />}
        {profileId && tab === 'receipts' && <ReceiptsTab key={profileId} profileId={profileId} />}
      </main>
    </>
  )
}

function nameOf(profiles: ProfileEntry[], id: string): string {
  return profiles.find((p) => p.id === id)?.name ?? id
}

function ProfileSwitcher(props: {
  profiles: ProfileEntry[]
  activeId: string
  onSwitch: (id: string) => Promise<void>
  onCreate: (name: string) => Promise<boolean>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  // The active id may not be stored yet (getProfile creates it lazily), so always offer it.
  const options = props.profiles.some((p) => p.id === props.activeId)
    ? props.profiles
    : [{ id: props.activeId, name: props.activeId }, ...props.profiles]

  return (
    <div className="switcher">
      <label className="row">
        <span className="label">Profile</span>
        <select value={props.activeId} onChange={(e) => void props.onSwitch(e.target.value)}>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {creating ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void props.onCreate(name).then((created) => {
              if (!created) return
              setName('')
              setCreating(false)
            })
          }}
        >
          <input type="text" autoFocus placeholder="Name, e.g. Petr" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="primary" disabled={!name.trim()}>
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button onClick={() => setCreating(true)}>New profile</button>
      )}
    </div>
  )
}

/** The extraction job's one-line status, shown on every tab except Import (which has the full card). */
function ExtractStrip({ job, onView }: { job: ExtractJob; onView?: () => void }) {
  const cls = job.status === 'done' ? 'ok' : job.status === 'running' ? 'progress' : 'error'
  return (
    <div className="card row between extract-strip" role="status">
      <span className={cls}>{describeExtractJob(job)}</span>
      <span className="row">
        {job.status === 'done' && onView && <button className="sm" onClick={onView}>View profile</button>}
        {job.status !== 'running' && (
          <button className="sm" onClick={dismissExtractJob}>
            Dismiss
          </button>
        )}
      </span>
    </div>
  )
}
