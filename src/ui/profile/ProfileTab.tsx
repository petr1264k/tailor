/**
 * Profile tab (CONTEXT.txt §3.4; demo §9 0:00–0:45). Look: coframe, like the Import tab (src/ui/theme.css), with the
 * tape-measure confidence from the hand-built profile artifact, in the brand accent.
 *  - Hero: title and lede; white card with the stats (facts, quotes, messages read, chat dates).
 *  - Sticky filter card: a "Jump to" row of sections, category chips with counts, search, "Show grounding".
 *  - One card per group of how Tailor uses a fact (factView.ts). Each fact: category, value, tape confidence,
 *    Edit / Delete; with "Show grounding" on, also the quotes behind it (own words highlighted).
 *    Deleted facts stay visible, struck through, with Restore. Delete one live on stage.
 *  - Split: what ChatGPT knows, what Claude knows, the overlap (live facts only).
 * Hidden for the demo (no ChatGPT export, sharing off): the split switch, the own-words filter and Export JSON
 * (SHOW_SPLIT, SHOW_OWN_WORDS_FILTER, SHOW_EXPORT).
 * Only owner-approved facts and short quotes are shown, never raw chats (§0).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Fact, FactCategory, OmittedItem, Profile, SourceSplit } from '@/types'
import { activeFacts, deleteFact, getOmitted, getProfile, sourceSplit, truncateQuote, updateFact } from '@/profile'
import { LAYOUT_LABELS, layoutChoiceOf } from '@/learn'
import { useExtractJob } from './useExtractJob'
import { attempt, errorText, monthRange, type Attempt } from './helpers'
import {
  CATEGORY_ORDER,
  NO_FILTER,
  groupForView,
  hasOwnWords,
  matchesFilter,
  quoteSource,
  type FactFilter,
} from './factView'

type View = 'category' | 'split'

/** Hidden for the demo: set true to bring each back. */
const SHOW_SPLIT = false
const SHOW_OWN_WORDS_FILTER = false
const SHOW_EXPORT = false

const SHOW_GROUNDING_KEY = 'tailor.profile.showGrounding'

/** "Show grounding" (off by default): a per-browser view preference (localStorage), so it survives a reload on stage. */
function useShowGrounding(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SHOW_GROUNDING_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setOn(next)
    try {
      localStorage.setItem(SHOW_GROUNDING_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  }
  return [on, set]
}

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

/** Height of the page's sticky top bar, so the filter card sticks just below it. */
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
  const [omitted, setOmitted] = useState<OmittedItem[]>([])

  const reload = useCallback(async () => {
    setProfile(await attempt(() => getProfile(profileId)))
    const o = await attempt(() => getOmitted(profileId))
    setOmitted(o.ok ? o.value : [])
  }, [profileId])
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
    edit: (f, value) => act(() => updateFact(f.id, { value, userStatus: 'edited' }, profileId)),
    remove: (f) => act(() => deleteFact(f.id, profileId)),
    restore: (f) => act(() => updateFact(f.id, { userStatus: 'kept' }, profileId)),
  }

  if (!profile) return <div className="muted">Loading…</div>
  if (!profile.ok) return <div className="error">Profile: {profile.error}</div>
  const p = profile.value
  return (
    <div className="stack pf">
      <section className="hero">
        <div className="hero-copy">
          <span className="tag">Your profile</span>
          <h1>What Tailor knows about you</h1>
          <p>Learned from your own messages. Edit or delete any fact: a deleted fact never reaches a page or a site.</p>
          {(SHOW_SPLIT || SHOW_EXPORT) && (
            <div className="row">
              {SHOW_SPLIT && (
                <div className="seg" role="tablist" aria-label="View">
                  <button role="tab" aria-selected={view === 'category'} onClick={() => setView('category')}>
                    By category
                  </button>
                  <button role="tab" aria-selected={view === 'split'} onClick={() => setView('split')}>
                    ChatGPT / Claude
                  </button>
                </div>
              )}
              {SHOW_EXPORT && (
                <button className="sm" title="Download this profile for the eval harness (data/profiles/)" onClick={() => downloadProfile(profileId, p)}>
                  Export JSON
                </button>
              )}
            </div>
          )}
        </div>
        <div className="hero-card">
          <div className="row between">
            <span className="label">{profileName}</span>
            <span className="chip">Version {p.version}</span>
          </div>
          <ProfileStats profile={p} />
        </div>
      </section>
      {actionError && <div className="error">{actionError}</div>}
      {view === 'category' ? (
        <FactsView facts={p.facts} actions={actions} keptOut={omitted.reduce((n, o) => n + o.count, 0)} />
      ) : (
        <SplitView profile={p} />
      )}
      {omitted.length > 0 && <OmittedCard items={omitted} />}
    </div>
  )
}

const KEPT_OUT_ID = 'kept-out'

/** "Left out on purpose": what a hand-built profile file says was found in the chats and kept out. Only kinds, never items. */
function OmittedCard({ items }: { items: OmittedItem[] }) {
  const total = items.reduce((n, i) => n + i.count, 0)
  return (
    <section id={KEPT_OUT_ID} className="card stack">
      <div className="card-head">
        <span className="tag">Left out on purpose</span>
        <h2>
          What Tailor kept out <span className="count">{total}</span>
        </h2>
        <p className="muted small">
          Found in your chats and deliberately not turned into facts, so no page or site sees them. Only the kind of item is listed, never the
          item itself.
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Items</th>
            <th>Kind</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={n}>
              <td>{i.category}</td>
              <td className="num">{i.count}</td>
              <td className="muted">{i.kinds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ProfileStats({ profile }: { profile: Profile }) {
  const live = activeFacts(profile)
  const deleted = profile.facts.length - live.length
  const quotes = live.flatMap((f) => f.evidence).length
  const own = live.filter(hasOwnWords).length
  const { conversations, messages, from, to } = profile.stats
  const notes = [`${own} of ${live.length} facts backed by your own words`, deleted > 0 ? `${deleted} deleted` : '', messages > 0 ? `${conversations.toLocaleString()} conversations` : '']
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <span className="label">Facts</span>
          <b>{live.length}</b>
        </div>
        <div className="stat">
          <span className="label">Quotes</span>
          <b>{quotes}</b>
        </div>
        <div className="stat">
          <span className="label">Your messages</span>
          <b>{messages > 0 ? messages.toLocaleString() : '—'}</b>
        </div>
        <div className="stat">
          <span className="label">From – to</span>
          <b className="text">{monthRange(from, to) || '—'}</b>
        </div>
      </div>
      <div className="muted small">{notes.filter(Boolean).join(' · ')}</div>
    </div>
  )
}

/** Each resolves to true on success; errors are shown by ProfileTab. */
interface FactActions {
  edit: (f: Fact, value: string) => Promise<boolean>
  remove: (f: Fact) => Promise<boolean>
  restore: (f: Fact) => Promise<boolean>
}

/**
 * The "Jump to" row lists the sections on screen (groups that pass the filter) with their live-fact counts, plus
 * "What Tailor kept out" when `keptOut` > 0 (OmittedCard).
 */
function FactsView({ facts, actions, keptOut }: { facts: Fact[]; actions: FactActions; keptOut: number }) {
  const [filter, setFilter] = useState<FactFilter>(NO_FILTER)
  const [grounding, setGrounding] = useShowGrounding()
  const top = useTopbarHeight()
  const filtersRef = useRef<HTMLElement>(null)
  const groups = useMemo(() => groupForView(facts), [facts])
  const live = useMemo(() => facts.filter((f) => f.userStatus !== 'deleted'), [facts])
  const counts = useMemo(() => {
    const c = new Map<FactCategory, number>()
    for (const f of live) c.set(f.category, (c.get(f.category) ?? 0) + 1)
    return c
  }, [live])

  if (facts.length === 0) {
    return <div className="card muted">No facts yet. On the Import tab, import an export and run Extract profile, or load a saved profile.</div>
  }

  const shown = (f: Fact) => matchesFilter(f, filter, factLabel(f))
  const shownLive = live.filter(shown).length
  const visibleGroups = groups.map((g) => ({ ...g, facts: g.facts.filter(shown) })).filter((g) => g.facts.length > 0)
  const pick = (category: FactCategory | 'all') =>
    setFilter((f) => ({ ...f, category: f.category === category && category !== 'all' ? 'all' : category }))

  /** Scrolls a section card to just below the sticky top bar and this filter card. */
  function jumpTo(id: string) {
    const target = document.getElementById(id)
    if (!target) return
    const covered = top + 12 + (filtersRef.current?.offsetHeight ?? 0) + 16
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - covered, behavior: 'smooth' })
  }

  const toc = [
    ...visibleGroups.map((g) => ({ id: g.id, title: g.title, n: g.facts.filter((f) => f.userStatus !== 'deleted').length })),
    ...(keptOut > 0 ? [{ id: KEPT_OUT_ID, title: 'What Tailor kept out', n: keptOut }] : []),
  ]

  return (
    <>
      <section ref={filtersRef} className="card pf-filters" style={{ top: top + 12 }} aria-label="Filter facts">
        {toc.length > 0 && (
          <nav className="pf-toc" aria-label="Sections">
            <span className="label">Jump to</span>
            {toc.map((s) => (
              <button key={s.id} type="button" onClick={() => jumpTo(s.id)}>
                {s.title} <span className="count">{s.n}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="pf-chips" role="group" aria-label="Category">
          <Chip label="All" n={live.length} pressed={filter.category === 'all'} onClick={() => pick('all')} />
          {CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
            <Chip key={c} label={c} n={counts.get(c)!} pressed={filter.category === c} onClick={() => pick(c)} />
          ))}
        </div>
        <div className="row pf-row">
          <input
            className="pf-search"
            type="search"
            placeholder="Search facts and quotes"
            aria-label="Search facts and quotes"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
          {SHOW_OWN_WORDS_FILTER && (
            <label className="row pf-toggle">
              <input type="checkbox" checked={filter.ownOnly} onChange={(e) => setFilter((f) => ({ ...f, ownOnly: e.target.checked }))} />
              Only facts with your own words
            </label>
          )}
          <label className="row pf-toggle">
            <input type="checkbox" checked={grounding} onChange={(e) => setGrounding(e.target.checked)} />
            Show grounding
          </label>
          <span className="label pf-result" aria-live="polite">
            {shownLive} of {live.length} facts
          </span>
        </div>
      </section>

      {visibleGroups.length === 0 ? (
        <div className="card row between">
          <span className="muted">No facts match these filters.</span>
          <button className="sm" onClick={() => setFilter(NO_FILTER)}>
            Show all facts
          </button>
        </div>
      ) : (
        visibleGroups.map((g) => (
          <section key={g.id} id={g.id} className="card stack">
            <div className="card-head">
              <span className="tag">{g.cats.join(' · ')}</span>
              <h2>
                {g.title} <span className="count">{g.facts.filter((f) => f.userStatus !== 'deleted').length}</span>
              </h2>
              <p className="muted small">{g.note}</p>
            </div>
            <ul className="facts">
              {g.facts.map((f) => (
                <FactRow key={f.id} fact={f} actions={actions} grounding={grounding} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}

function Chip({ label, n, pressed, onClick }: { label: string; n: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pf-chip" aria-pressed={pressed} onClick={onClick}>
      {label}
      <span className="n">{n}</span>
    </button>
  )
}

const MAX_QUOTES = 4

/** The gold tape-measure confidence, kept from the profile artifact. */
function Tape({ confidence }: { confidence: number }) {
  const c = Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 0))
  return (
    <span className="pf-conf">
      <span className="tape" role="img" aria-label={`Confidence ${c.toFixed(2)} of 1`} style={{ ['--c' as string]: c }}>
        <i />
      </span>
      <span className="num">{c.toFixed(2)}</span>
    </span>
  )
}

/** `grounding` on shows the quotes behind the fact. */
function FactRow({ fact, actions, grounding }: { fact: Fact; actions: FactActions; grounding: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.value)
  const [busy, setBusy] = useState(false)
  const [allQuotes, setAllQuotes] = useState(false)
  const deleted = fact.userStatus === 'deleted'
  const quotes = allQuotes ? fact.evidence : fact.evidence.slice(0, MAX_QUOTES)

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
          <span className="row fact-tags">
            <span className="label">{fact.category}</span>
            {fact.source === 'behavior' && <span className="chip accent">from your clicks</span>}
            {fact.userStatus && fact.userStatus !== 'kept' && <span className="chip">{fact.userStatus}</span>}
          </span>
          {editing ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                const value = draft.trim()
                if (!value) return
                void run(() => actions.edit(fact, value)).then((ok) => ok && setEditing(false))
              }}
            >
              <input type="text" className="edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="primary sm" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <span className="fact-value">{factLabel(fact)}</span>
          )}
        </div>
        <Tape confidence={fact.confidence} />
      </div>

      {grounding && quotes.length > 0 && (
        <ul className="evidence">
          {quotes.map((e, i) => {
            const s = quoteSource(e)
            return (
              <li key={i} className={s.kind === 'own' ? 'q own' : 'q'}>
                <span className="src">
                  <span className="kind">{s.label}</span> {[s.name, s.where].filter(Boolean).join(' · ')}
                </span>
                <span className="quote" lang={/[Ѐ-ӿ]/.test(e.quote) ? 'ru' : undefined}>
                  “{truncateQuote(e.quote)}”
                </span>
              </li>
            )
          })}
          {fact.evidence.length > MAX_QUOTES && (
            <li>
              <button className="link small" onClick={() => setAllQuotes((v) => !v)}>
                {allQuotes ? 'Show fewer quotes' : `Show ${fact.evidence.length - MAX_QUOTES} more`}
              </button>
            </li>
          )}
        </ul>
      )}

      {!editing && (
        <div className="row fact-foot">
          <span className="actions">
            {deleted ? (
              <button className="sm" disabled={busy} onClick={() => void run(() => actions.restore(fact))}>
                Restore
              </button>
            ) : (
              <>
                <button
                  className="sm"
                  disabled={busy}
                  onClick={() => {
                    setDraft(fact.value)
                    setEditing(true)
                  }}
                >
                  Edit
                </button>
                <button className="sm danger" disabled={busy} onClick={() => void run(() => actions.remove(fact))}>
                  Delete
                </button>
              </>
            )}
          </span>
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
        <section key={c.title} className="card stack">
          <h3>
            {c.title} <span className="count">{c.facts.length}</span>
          </h3>
          {c.facts.length === 0 ? (
            <div className="muted small">Nothing here.</div>
          ) : (
            <ul className="facts">
              {c.facts.map((f) => (
                <li key={f.id} className="fact">
                  <span className="label">{f.category}</span>
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
