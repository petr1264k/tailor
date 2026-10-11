/**
 * Profile tab (CONTEXT.txt §3.4; demo §9 0:00–0:45). Look: the hand-built profile artifact (factView.ts).
 *  - Header: display title, lede, four stats (facts, quotes, messages read, chat dates); view switch and Export JSON.
 *  - Sticky filter bar: category chips with counts, search, "only facts with your own words".
 *  - Facts grouped by how Tailor uses them. Each fact: category, value, tape-measure confidence, the quotes behind it
 *    (own words highlighted), the prior, Keep / Edit / Delete. Deleted facts stay visible, struck through, with Restore.
 *    Delete one live on stage.
 *  - Split: what ChatGPT knows, what Claude knows, the overlap (live facts only).
 * Only owner-approved facts and short quotes are shown, never raw chats (§0).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Fact, FactCategory, Profile, SourceSplit } from '@/types'
import { activeFacts, deleteFact, getProfile, sourceSplit, truncateQuote, updateFact } from '@/profile'
import { LAYOUT_LABELS, layoutChoiceOf } from '@/learn'
import { useExtractJob } from './useExtractJob'
import { attempt, errorText, monthRange, type Attempt } from './helpers'
import {
  CATEGORY_ORDER,
  NO_FILTER,
  formatPrior,
  groupForView,
  hasOwnWords,
  matchesFilter,
  quoteSource,
  type FactFilter,
} from './factView'

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

/** Height of the page's sticky top bar, so the filter bar sticks just below it. */
function useTopbarHeight(): number {
  const [h, setH] = useState(0)
  useEffect(() => {
    const measure = () => setH(document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return h
}

export function ProfileTab({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [profile, setProfile] = useState<Attempt<Profile> | null>(null)
  const [view, setView] = useState<View>('category')
  const [actionError, setActionError] = useState<string | null>(null)

  const reload = useCallback(async () => setProfile(await attempt(() => getProfile(profileId))), [profileId])
  useEffect(() => void reload(), [reload])

  // A run into this profile just finished (maybe while this tab was open): show the new facts without a manual reload.
  const job = useExtractJob({ tick: false })
  const finishedAt = job.status === 'done' && job.profileId === profileId ? job.finishedAt : null
  useEffect(() => {
    if (finishedAt) void reload()
  }, [finishedAt, reload])

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

  if (!profile) return <div className="muted">Loading…</div>
  if (!profile.ok) return <div className="error">Profile: {profile.error}</div>
  const p = profile.value
  return (
    <div className="pf">
      <header className="pf-head">
        <div className="pf-title">
          <p className="pf-eyebrow">
            Tailor · {profileName} · profile v{p.version}
          </p>
          <h1>What Tailor knows about you</h1>
          <p className="pf-lede">
            Each fact lists the quotes behind it. Quotes marked <span className="pen">✎ Your words</span> come from your own messages.
            Keep, edit or delete any fact: a deleted fact never reaches a page or a site.
          </p>
        </div>
        <div className="pf-tools">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'category'} onClick={() => setView('category')}>
              By category
            </button>
            <button role="tab" aria-selected={view === 'split'} onClick={() => setView('split')}>
              ChatGPT / Claude
            </button>
          </div>
          <button className="sm" title="Download this profile for the eval harness (data/profiles/)" onClick={() => downloadProfile(profileId, p)}>
            Export JSON
          </button>
        </div>
        <ProfileStats profile={p} />
      </header>
      {actionError && <div className="error">{actionError}</div>}
      {view === 'category' ? <FactsView facts={p.facts} actions={actions} /> : <SplitView profile={p} />}
    </div>
  )
}

function ProfileStats({ profile }: { profile: Profile }) {
  const live = activeFacts(profile)
  const deleted = profile.facts.length - live.length
  const quotes = live.flatMap((f) => f.evidence)
  const ownQuotes = quotes.filter((e) => quoteSource(e).kind === 'own').length
  const { conversations, messages, from, to } = profile.stats
  const range = monthRange(from, to)
  const stats: [string, string, string][] = [
    ['Facts', String(live.length), `${live.filter(hasOwnWords).length} backed by your own words${deleted > 0 ? ` · ${deleted} deleted` : ''}`],
    ['Quotes', String(quotes.length), `${ownQuotes} in your own words`],
    ['Your messages read', messages > 0 ? messages.toLocaleString() : '—', messages > 0 ? `in ${conversations.toLocaleString()} conversations` : 'no chats imported yet'],
    ['Chats dated', range || '—', `profile version ${profile.version}`],
  ]
  return (
    <dl className="pf-stats">
      {stats.map(([label, value, note]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value}
            <small>{note}</small>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Each resolves to true on success; errors are shown by ProfileTab. */
interface FactActions {
  keep: (f: Fact) => Promise<boolean>
  edit: (f: Fact, value: string) => Promise<boolean>
  remove: (f: Fact) => Promise<boolean>
  restore: (f: Fact) => Promise<boolean>
}

function FactsView({ facts, actions }: { facts: Fact[]; actions: FactActions }) {
  const [filter, setFilter] = useState<FactFilter>(NO_FILTER)
  const top = useTopbarHeight()
  const groups = useMemo(() => groupForView(facts), [facts])
  const live = useMemo(() => facts.filter((f) => f.userStatus !== 'deleted'), [facts])
  const counts = useMemo(() => {
    const c = new Map<FactCategory, number>()
    for (const f of live) c.set(f.category, (c.get(f.category) ?? 0) + 1)
    return c
  }, [live])

  if (facts.length === 0) {
    return (
      <div className="pf-empty">
        <p>No facts yet. On the Import tab, import an export and run Extract profile, or load a saved profile.</p>
      </div>
    )
  }

  const shown = (f: Fact) => matchesFilter(f, filter, factLabel(f))
  const shownLive = live.filter(shown).length
  const visibleGroups = groups.map((g) => ({ ...g, facts: g.facts.filter(shown) })).filter((g) => g.facts.length > 0)
  const pick = (category: FactCategory | 'all') =>
    setFilter((f) => ({ ...f, category: f.category === category && category !== 'all' ? 'all' : category }))

  return (
    <>
      <section className="pf-filters" style={{ top }} aria-label="Filter facts">
        <div className="pf-chips" role="group" aria-label="Category">
          <Chip label="All" n={live.length} pressed={filter.category === 'all'} onClick={() => pick('all')} />
          {CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
            <Chip key={c} label={c} n={counts.get(c)!} pressed={filter.category === c} onClick={() => pick(c)} />
          ))}
        </div>
        <div className="pf-row">
          <input
            className="pf-search"
            type="search"
            placeholder="Search facts and quotes"
            aria-label="Search facts and quotes"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
          <label className="pf-toggle">
            <input type="checkbox" checked={filter.ownOnly} onChange={(e) => setFilter((f) => ({ ...f, ownOnly: e.target.checked }))} />
            Only facts with your own words
          </label>
          <span className="pf-result" aria-live="polite">
            Showing {shownLive} of {live.length} facts
          </span>
        </div>
      </section>

      {visibleGroups.length === 0 ? (
        <div className="pf-empty">
          <p>No facts match these filters.</p>
          <button className="sm" onClick={() => setFilter(NO_FILTER)}>
            Show all facts
          </button>
        </div>
      ) : (
        <div className="pf-groups">
          {visibleGroups.map((g) => (
            <section key={g.title} className="pf-group">
              <div className="pf-group-head">
                <h2>{g.title}</h2>
                <p className="pf-note">{g.note}</p>
              </div>
              <ul className="pf-facts">
                {g.facts.map((f) => (
                  <FactCard key={f.id} fact={f} actions={actions} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function Chip({ label, n, pressed, onClick }: { label: string; n: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pf-chip" aria-pressed={pressed} onClick={onClick}>
      <span>{label}</span>
      <span className="n">{n}</span>
    </button>
  )
}

const MAX_QUOTES = 4

function FactCard({ fact, actions }: { fact: Fact; actions: FactActions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.value)
  const [busy, setBusy] = useState(false)
  const [allQuotes, setAllQuotes] = useState(false)
  const deleted = fact.userStatus === 'deleted'
  const conf = Math.min(1, Math.max(0, Number.isFinite(fact.confidence) ? fact.confidence : 0))
  const quotes = allQuotes ? fact.evidence : fact.evidence.slice(0, MAX_QUOTES)
  const eyebrow = [fact.category, fact.source === 'behavior' ? 'from your clicks' : '', fact.userStatus ?? ''].filter(Boolean).join(' · ')

  async function run(fn: () => Promise<boolean>): Promise<boolean> {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    return ok
  }

  return (
    <li className={deleted ? 'fact deleted' : 'fact'}>
      <div className="fact-head">
        <div className="fact-main">
          <span className="pf-cat">{eyebrow}</span>
          {editing ? (
            <form
              className="pf-edit"
              onSubmit={(e) => {
                e.preventDefault()
                const value = draft.trim()
                if (!value) return
                void run(() => actions.edit(fact, value)).then((ok) => ok && setEditing(false))
              }}
            >
              <input type="text" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="primary sm" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h3 className="fact-value">{factLabel(fact)}</h3>
          )}
        </div>
        <div className="pf-conf">
          <span className="tape" role="img" aria-label={`Confidence ${conf.toFixed(2)} of 1`} style={{ ['--c' as string]: conf }}>
            <i />
          </span>
          <span className="num">{conf.toFixed(2)}</span>
        </div>
      </div>

      {quotes.length > 0 && (
        <ul className="pf-why">
          {quotes.map((e, i) => {
            const s = quoteSource(e)
            return (
              <li key={i} className={s.kind === 'own' ? 'q own' : 'q'}>
                <span className="src">
                  <span className="kind">{s.label}</span>
                  <span>{[s.name, s.where].filter(Boolean).join(' · ')}</span>
                </span>
                <blockquote lang={/[Ѐ-ӿ]/.test(e.quote) ? 'ru' : undefined}>{truncateQuote(e.quote)}</blockquote>
              </li>
            )
          })}
          {fact.evidence.length > MAX_QUOTES && (
            <li>
              <button className="link pf-more" onClick={() => setAllQuotes((v) => !v)}>
                {allQuotes ? 'Show fewer quotes' : `Show ${fact.evidence.length - MAX_QUOTES} more`}
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="pf-foot">
        <span className="pf-prior">{fact.prior ? formatPrior(fact.prior) : ''}</span>
        {!editing && (
          <span className="actions">
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
          </span>
        )}
      </div>
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
        <section key={c.title} className="pf-group">
          <div className="pf-group-head">
            <h2>{c.title}</h2>
            <p className="pf-note">
              {c.facts.length} {c.facts.length === 1 ? 'fact' : 'facts'}
            </p>
          </div>
          {c.facts.length === 0 ? (
            <div className="pf-empty">
              <p>Nothing here.</p>
            </div>
          ) : (
            <ul className="pf-facts">
              {c.facts.map((f) => (
                <li key={f.id} className="fact compact">
                  <span className="pf-cat">{f.category}</span>
                  <span className="fact-value">{factLabel(f)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
