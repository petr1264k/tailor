/**
 * Profile tab (CONTEXT.txt §3.4; demo §9 0:00–0:45).
 *  - Facts grouped by category: value, confidence bar, source chip, evidence lines ("ChatGPT, Aug 3: '…'"),
 *    Keep / Edit / Delete. Deleted facts stay visible, struck through, with Restore. Delete one live on stage.
 *  - Split: what ChatGPT knows, what Claude knows, the overlap (live facts only).
 * Only owner-approved facts and short quotes are shown, never raw chats (§0).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Fact, Profile, SourceSplit } from '@/types'
import { activeFacts, deleteFact, formatEvidence, getProfile, sourceSplit, updateFact } from '@/profile'
import { LAYOUT_LABELS, layoutChoiceOf } from '@/learn'
import { FACT_CATEGORY_LABELS, attempt, confidencePct, errorText, groupFactsByCategory, monthRange, type Attempt } from './helpers'

type View = 'category' | 'split'

/** Learned layout facts ('layout:specs_first') read as "Layout: Specs first"; everything else as stored. */
function factLabel(fact: Fact): string {
  const choice = layoutChoiceOf(fact)
  return choice ? `Layout: ${LAYOUT_LABELS[choice]}` : fact.value
}

/**
 * Downloads `<profileId>.json` as { id, profile }, the shape eval/lib/common.ts loads from data/profiles/ (§8.2 precision).
 * Local file only: it holds facts and short quotes, so never open it on stage.
 */
function downloadProfile(profileId: string, profile: Profile): void {
  const blob = new Blob([JSON.stringify({ id: profileId, profile }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${profileId}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
}

export function ProfileTab({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<Attempt<Profile> | null>(null)
  const [view, setView] = useState<View>('category')
  const [actionError, setActionError] = useState<string | null>(null)

  const reload = useCallback(async () => setProfile(await attempt(() => getProfile(profileId))), [profileId])
  useEffect(() => void reload(), [reload])

  /** Runs a profile mutation; shows the updated profile, or the error inline. */
  async function act(fn: () => Promise<Profile>): Promise<boolean> {
    const r = await attempt(fn)
    if (r.ok) {
      setActionError(null)
      setProfile(r)
    } else setActionError(r.error)
    return r.ok
  }

  const actions: FactActions = {
    keep: (f) => act(() => updateFact(f.id, { userStatus: 'kept' }, profileId)),
    edit: (f, value) => act(() => updateFact(f.id, { value, userStatus: 'edited' }, profileId)),
    remove: (f) => act(() => deleteFact(f.id, profileId)),
    restore: (f) => act(() => updateFact(f.id, { userStatus: 'kept' }, profileId)),
  }

  return (
    <div className="stack">
      {!profile && <div className="muted">Loading…</div>}
      {profile && !profile.ok && <div className="error">Profile: {profile.error}</div>}
      {profile?.ok && (
        <>
          <section className="card stack">
            <div className="row between">
              <div className="card-head">
                <span className="tag">Profile</span>
                <h2>What Tailor knows about you</h2>
                <ProfileSummary profile={profile.value} />
              </div>
              <div className="row">
                <div className="seg" role="tablist" aria-label="View">
                  <button role="tab" aria-selected={view === 'category'} onClick={() => setView('category')}>
                    By category
                  </button>
                  <button role="tab" aria-selected={view === 'split'} onClick={() => setView('split')}>
                    ChatGPT / Claude
                  </button>
                </div>
                <button className="sm" title="Download this profile for the eval harness (data/profiles/)" onClick={() => downloadProfile(profileId, profile.value)}>
                  Export JSON
                </button>
              </div>
            </div>
            {actionError && <div className="error">{actionError}</div>}
          </section>
          {view === 'category' ? <FactsByCategory facts={profile.value.facts} actions={actions} /> : <SplitView profile={profile.value} />}
        </>
      )}
    </div>
  )
}

function ProfileSummary({ profile }: { profile: Profile }) {
  const live = activeFacts(profile).length
  const deleted = profile.facts.length - live
  const { conversations, messages, from, to } = profile.stats
  return (
    <div className="muted small">
      {live} facts{deleted > 0 ? ` (${deleted} deleted)` : ''} · version {profile.version}
      {messages > 0 && ` · from ${conversations.toLocaleString()} conversations, ${messages.toLocaleString()} messages, ${monthRange(from, to)}`}
    </div>
  )
}

/** Each resolves to true on success; errors are shown by ProfileTab. */
interface FactActions {
  keep: (f: Fact) => Promise<boolean>
  edit: (f: Fact, value: string) => Promise<boolean>
  remove: (f: Fact) => Promise<boolean>
  restore: (f: Fact) => Promise<boolean>
}

function FactsByCategory({ facts, actions }: { facts: Fact[]; actions: FactActions }) {
  const groups = useMemo(() => groupFactsByCategory(facts), [facts])
  if (groups.length === 0) {
    return <div className="card muted">No facts yet. Import an export and run Extract profile on the Import tab.</div>
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.category} className="card group">
          <h3>
            {FACT_CATEGORY_LABELS[g.category]} <span className="count">{g.facts.filter((f) => f.userStatus !== 'deleted').length}</span>
          </h3>
          <ul className="facts">
            {g.facts.map((f) => (
              <FactRow key={f.id} fact={f} actions={actions} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

const MAX_EVIDENCE_LINES = 3

function FactRow({ fact, actions }: { fact: Fact; actions: FactActions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.value)
  const [busy, setBusy] = useState(false)
  const deleted = fact.userStatus === 'deleted'
  const pct = confidencePct(fact.confidence)

  async function run(fn: () => Promise<boolean>): Promise<boolean> {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    return ok
  }

  return (
    <li className={deleted ? 'fact deleted' : 'fact'}>
      <div className="fact-head">
        {editing ? (
          <form
            className="row edit"
            onSubmit={(e) => {
              e.preventDefault()
              const value = draft.trim()
              if (!value) return
              void run(() => actions.edit(fact, value)).then((ok) => ok && setEditing(false))
            }}
          >
            <input type="text" className="edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="primary" disabled={busy || !draft.trim()}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="fact-value">{factLabel(fact)}</span>
        )}
        <span className={fact.source === 'behavior' ? 'chip accent' : 'chip'}>{fact.source === 'behavior' ? 'from your clicks' : 'from your chats'}</span>
        {fact.userStatus && fact.userStatus !== 'deleted' && <span className="chip">{fact.userStatus}</span>}
        <span className="conf" title={`confidence ${pct}%`}>
          <span className="conf-track">
            <span className="conf-fill" style={{ display: 'block', width: `${pct}%` }} />
          </span>
          {pct}%
        </span>
      </div>
      {fact.evidence.length > 0 && (
        <ul className="evidence">
          {fact.evidence.slice(0, MAX_EVIDENCE_LINES).map((e, i) => (
            <li key={i}>{formatEvidence(e)}</li>
          ))}
          {fact.evidence.length > MAX_EVIDENCE_LINES && <li>+ {fact.evidence.length - MAX_EVIDENCE_LINES} more</li>}
        </ul>
      )}
      {!editing && (
        <div className="actions">
          {deleted ? (
            <button disabled={busy} onClick={() => void run(() => actions.restore(fact))}>
              Restore
            </button>
          ) : (
            <>
              <button disabled={busy || fact.userStatus === 'kept'} onClick={() => void run(() => actions.keep(fact))}>
                Keep
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(fact.value)
                  setEditing(true)
                }}
              >
                Edit
              </button>
              <button className="danger" disabled={busy} onClick={() => void run(() => actions.remove(fact))}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function SplitView({ profile }: { profile: Profile }) {
  // Deleted facts never count as "known" (§3.4), so split only the live ones.
  const split = useMemo<Attempt<SourceSplit>>(() => {
    try {
      return { ok: true, value: sourceSplit({ ...profile, facts: activeFacts(profile) }) }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  }, [profile])
  if (!split.ok) return <div className="error">Split: {split.error}</div>
  const columns: { title: string; facts: Fact[] }[] = [
    { title: 'ChatGPT only', facts: split.value.chatgptOnly },
    { title: 'Claude only', facts: split.value.claudeOnly },
    { title: 'Both', facts: split.value.both },
  ]
  return (
    <div className="split">
      {columns.map((c) => (
        <section key={c.title} className="card group">
          <h3>
            {c.title} <span className="count">{c.facts.length}</span>
          </h3>
          {c.facts.length === 0 ? (
            <div className="muted small">Nothing here.</div>
          ) : (
            <ul>
              {c.facts.map((f) => (
                <li key={f.id}>
                  {f.value} <span className="muted small">{FACT_CATEGORY_LABELS[f.category].toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
