/**
 * Receipts tab (CONTEXT.txt §4 share flow step 6, §3.9): what was sent, which facts, which site, when.
 * The site's reply is untrusted text: rendered as plain text only (React escapes it), labeled as the site's words.
 */
import { useEffect, useState } from 'react'
import type { Profile, SiteShare } from '@/types'
import { getProfile } from '@/profile'
import { isFallbackShare } from '@/share/fallback'
import { attempt, dateTime, factValues, siteLabel, truncate, type Attempt } from './helpers'

const REPLY_PREVIEW_CHARS = 160

export function ReceiptsTab({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<Attempt<Profile> | null>(null)
  useEffect(() => {
    void attempt(() => getProfile(profileId)).then(setProfile)
  }, [profileId])

  if (!profile) return <div className="muted">Loading…</div>
  if (!profile.ok) return <div className="error">Receipts: {profile.error}</div>
  const shares = [...profile.value.shares].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <section className="card stack">
      <div className="card-head">
        <span className="tag">Receipts</span>
        <h2>What you shared with sites</h2>
        <p className="muted small">Sharing is opt-in per site. Each row is exactly what Tailor sent, and the site's reply in its own words.</p>
      </div>
      {shares.length === 0 ? (
        <div className="muted">Nothing shared yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>When</th>
              <th>What Tailor sent</th>
              <th>Facts it used</th>
              <th>The site's reply</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((s, i) => (
              <ReceiptRow key={`${s.at}-${i}`} share={s} profile={profile.value} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function ReceiptRow({ share, profile }: { share: SiteShare; profile: Profile }) {
  const [expanded, setExpanded] = useState(false)
  const long = share.response.trim().length > REPLY_PREVIEW_CHARS
  return (
    <tr>
      <td>
        <b>{siteLabel(share.url)}</b>
      </td>
      <td className="small">{dateTime(share.at)}</td>
      <td>{share.needsText}</td>
      <td>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {factValues(share.factIds, profile.facts).map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </td>
      <td>
        <div className="from-site">
          From {siteLabel(share.url)} · the site's own words
          {isFallbackShare(share) && ' · cached demo reply (nothing was sent)'}
        </div>
        <p className="reply">{expanded || !long ? share.response : truncate(share.response, REPLY_PREVIEW_CHARS)}</p>
        {long && (
          <button className="link" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </td>
    </tr>
  )
}
