/**
 * Profile page (options page, opens in a tab). Owner: Petr.
 *
 * Tabs (CONTEXT.txt §3.1, §3.4, §4 step 6, §9 0:00–0:45):
 *  - Import:   ONE JSON file (ChatGPT conversations.json or the Claude export) → archive stats per source → Extract profile
 *  - Profile:  facts by category with source quotes; keep / edit / delete / restore; ChatGPT / Claude / both split;
 *              "never extracted" counts
 *  - Receipts: what was shared with which site, when (SiteShare)
 * The profile switcher sits in the header so the active profile (Mikhail / Petr) is visible on every tab.
 * Runs in the extension origin: calls modules directly. Every call is wrapped (attempt); errors show inline.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSettings, setSettings } from '@/settings'
import { DEFAULT_PROFILE_ID, listProfiles } from '@/profile'
import { attempt } from './helpers'
import { createProfile } from './store'
import { ImportTab } from './ImportTab'
import { ProfileTab } from './ProfileTab'
import { ReceiptsTab } from './ReceiptsTab'

type Tab = 'import' | 'profile' | 'receipts'
const TABS: { id: Tab; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'profile', label: 'Profile' },
  { id: 'receipts', label: 'Receipts' },
]

type ProfileEntry = { id: string; name: string }

export function App() {
  const [tab, setTab] = useState<Tab>('import')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileEntry[]>([])
  const [switchError, setSwitchError] = useState<string | null>(null)

  const refreshProfiles = useCallback(async () => {
    const r = await attempt(listProfiles)
    if (r.ok) setProfiles(r.value.map((p) => ({ id: p.id, name: p.name })))
    else setSwitchError(`Profiles: ${r.error}`)
  }, [])

  useEffect(() => {
    void attempt(getSettings).then((r) => setProfileId(r.ok ? r.value.activeProfileId : DEFAULT_PROFILE_ID))
    void refreshProfiles()
  }, [refreshProfiles])

  async function switchTo(id: string) {
    const r = await attempt(() => setSettings({ activeProfileId: id }))
    if (!r.ok) return setSwitchError(r.error)
    setSwitchError(null)
    setProfileId(id)
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
    <div className="page">
      <header className="header">
        <h1>Tailor</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {profileId && (
          <ProfileSwitcher profiles={profiles} activeId={profileId} onSwitch={switchTo} onCreate={newProfile} />
        )}
      </header>
      {switchError && <div className="error">{switchError}</div>}
      {/* key={profileId}: switching profiles remounts the tab so it reloads that profile's data */}
      {profileId && tab === 'import' && <ImportTab key={profileId} profileId={profileId} profileName={nameOf(profiles, profileId)} />}
      {profileId && tab === 'profile' && <ProfileTab key={profileId} profileId={profileId} />}
      {profileId && tab === 'receipts' && <ReceiptsTab key={profileId} profileId={profileId} />}
    </div>
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
        <span className="muted">Profile</span>
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
