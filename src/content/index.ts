/**
 * Content script entry. Runs in the page origin: no IndexedDB, no API keys, no model calls here.
 * Mounts the (never shown) control host, extracts the page content (while the ORIGINAL page is visible, because the
 * gate checks claims against the rendered visible text), asks the background to tailor, renders the
 * result, and runs the share flow with consent (CONTEXT.txt §3.5, §3.7, §4).
 * By default this happens on its own: the page starts tailoring as soon as it has loaded and the edits land in
 * place the moment the run finishes (§3.5). The bar's Tailor button re-runs it; the popup can turn auto off.
 * In demo mode (on by default, §9) the edits PLAY: the page rebuilds itself change by change down to the bottom,
 * with motion, the window going only where a change is, ending back at the top on a report of what changed with
 * the numbers (OK closes it). Show original (popup) stops the run; off = everything at once, no report.
 * Nothing of ours stays on the page: the popup drives everything and reads the status from here.
 *
 * Imports stay light on purpose: '@/tailor/extract', '@/share/hooks' and '@/share/block' pull in no SDK
 * and no IndexedDB, so this bundle loads fast on every page.
 */
import type { ContentCommand, ContentStatus } from '@/messages'
import { send } from '@/messages'
import type { Fact, Interaction, PageContent, TailoredPage } from '@/types'
import { extractPage, resolveSegment, type ExtractedPage } from '@/tailor/extract'
import { readAgentHooks, shareEndpoint } from '@/share/hooks'
import { siteProfileFor } from '@/sites'
import { toFromSiteBlock } from '@/share/block'
import { DEMO_FALLBACK_REPLY } from '@/share/fallback'
import {
  appliedLabels,
  buildScorecard,
  displayHost,
  markedElements,
  measureSide,
  mountTailorButton,
  playTailored,
  renderConsentSheet,
  renderFromSite,
  renderReportSheet,
  renderTailored,
  scorecardLine,
  showOriginal,
  type InPlaceTarget,
  type Scorecard,
  type TailorUi,
} from '@/render'

let current: TailoredPage | null = null
let extracted: ExtractedPage | null = null
let mode: ContentStatus['mode'] = 'original'
/** The scorecard measured on the last tailored result, for the popup. */
let lastCard: Scorecard | null = null
/** Counts tailorNow calls: a run that finds a newer one started (Re-tailor during a playback) leaves the state to it. */
let tailorRuns = 0

/** Auto-tailor waits for `load` (capped) plus a short settle, so late-rendering storefronts are extracted whole. */
const AUTO_LOAD_CAP_MS = 1500
const AUTO_SETTLE_MS = 300
/** Below this the page has no text to edit in place (tailor.MIN_SEGMENTS_FOR_EDITS; inlined so this bundle does not import '@/tailor'). */
const MIN_AUTO_SEGMENTS = 3

/** Deleted facts never reach a page (§3.4). Inlined so this bundle does not import '@/profile'. */
function liveFacts(facts: Fact[]): Fact[] {
  return facts.filter((f) => f.userStatus !== 'deleted')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pageSettled(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const settle = (): void => {
      if (done) return
      done = true
      setTimeout(resolve, AUTO_SETTLE_MS)
    }
    if (document.readyState === 'complete') return settle()
    setTimeout(settle, AUTO_LOAD_CAP_MS)
    window.addEventListener('load', settle, { once: true })
  })
}

/** 'layout:specs_first' → 'specs first'. Inlined (not learn.LAYOUT_LABELS) so this bundle does not import '@/learn'. */
function layoutLabel(fact: Fact): string | null {
  return fact.source === 'behavior' && fact.value.startsWith('layout:') ? fact.value.slice(7).replace(/_/g, ' ') : null
}

function boot(): void {
  if (window.top !== window) return // frames: skip
  const url = location.href
  const hooks = readAgentHooks(document) // never throws; null on pages without agent hooks
  /** Sharing is built only for coframe.com (§3.9): offered only when the page names an allowed endpoint. */
  const canShare = shareEndpoint(hooks) !== ''

  /** Extracted once, while the original page is shown; re-tailoring reuses it. Elements stay here, never sent. */
  function getExtracted(): ExtractedPage {
    if (!extracted) extracted = extractPage(document, url)
    return extracted
  }
  function getContent(): PageContent {
    return getExtracted().content
  }
  /** Where each edit lands: the remembered element, or the same text re-found if the site re-rendered (§3.7). */
  function inPlaceTarget(): InPlaceTarget {
    const { content, elements, regionElements } = getExtracted()
    const target: InPlaceTarget = {
      segments: content.segments,
      resolve: (seg: PageContent['segments'][number]) => resolveSegment(document, seg, elements.get(seg.id)),
    }
    if (content.regions) {
      target.regions = content.regions
      // Region and card elements are containers; when a site re-renders them we do not re-find them (no safe text key).
      target.resolveRegion = (id: string) => {
        const e = regionElements.get(id)
        return e?.isConnected ? e : null
      }
      const after = siteProfileFor(url).policy.promoteAfterRole
      if (after) target.promoteAfterRole = after
    }
    return target
  }

  /**
   * Runs the pipeline and puts the result on screen. `auto` is the on-load run (§3.5): it applies in-place edits only.
   * The block panel is a modal column, so it never opens over a page the user did not ask to tailor; a click shows it.
   */
  async function tailorNow(ui: TailorUi, force: boolean, auto = false): Promise<void> {
    const previous = mode
    const run = ++tailorRuns
    mode = 'loading'
    try {
      const content = getContent()
      const page = current && !force ? current : await send('tailor/run', { content, force })
      if (run !== tailorRuns) return
      current = page
      if (auto && !page.edits?.length) {
        mode = 'original'
        ui.setStatus(page.edits ? 'Nothing to change for you on this page' : 'Tailored version ready')
        return
      }
      const [profile, settings] = await Promise.all([send('profile/get', {}), send('settings/get', {})])
      if (run !== tailorRuns) return
      const facts = liveFacts(profile.facts)
      const target = inPlaceTarget()
      // Scorecard (§8.5): the same marked elements measured on the ORIGINAL page, then on the tailored one.
      showOriginal(ui)
      const marked = page.edits ? markedElements(page, target) : []
      const before = measureSide(document, marked)
      const demo = settings.demoMode && !!page.edits?.length
      if (demo) {
        // Demo mode: the changes play top to bottom. Mode reads Tailored from the start so Show original can stop the run.
        mode = 'tailored'
        const shown = await playTailored(page, facts, ui, target, {
          onStep: (label, i, n) => ui.setStatus(`${i + 1}/${n} · ${label}`),
        })
        if (run !== tailorRuns) return
        if (!shown) {
          // The user flipped to Original mid-run (onShowOriginal set the mode); the gate counts still belong in the bar.
          ui.setGateSummary(page.gate.checked, page.gate.stripped.length, page.gate.stripped)
          return
        }
      } else {
        renderTailored(page, facts, ui, target)
      }
      const after = measureSide(document, marked)
      const card = page.edits ? buildScorecard(page, before, after, marked.length, window.innerHeight) : null
      lastCard = card
      ui.setScorecard(card)
      ui.setGateSummary(page.gate.checked, page.gate.stripped.length, page.gate.stripped)
      mode = 'tailored'
      // Demo mode ends on the report: what changed, the numbers code measured, the fact check. OK closes it.
      if (demo) void renderReportSheet(ui, { site: displayHost(url) || location.hostname, card, gate: page.gate, changes: appliedLabels(ui) })
    } catch (err) {
      if (run === tailorRuns) mode = previous === 'loading' ? 'original' : previous
      throw err
    }
  }

  /** §4 share flow: preview → consent sheet (word for word) → POST → the site's reply, labeled as the site's. */
  async function shareWithSite(ui: TailorUi): Promise<void> {
    if (!canShare) throw new Error('This page does not ask agents what you need')
    if (!current) throw new Error('Tailor the page first')
    const content = getContent()
    const preview = await send('share/preview', { content, tailored: current })
    const agreed = await renderConsentSheet(ui, preview)
    if (!agreed) return
    const req = {
      url,
      needsText: preview.needsText,
      constraints: preview.constraints,
      factIds: preview.facts.map((f) => f.id),
      hooks: content.agentHooks ?? hooks ?? {},
    }
    let share
    try {
      share = await send('share/send', req)
    } catch (err) {
      // §12: the live endpoint failed or was slow. Use the one real reply cached before the freeze, labeled as cached.
      if (!DEMO_FALLBACK_REPLY) throw err
      console.warn('[tailor] live share failed; using the cached reply', errorText(err))
      share = await send('share/send', { ...req, useFallback: true })
      ui.setStatus(`Live call failed: showing the site's cached reply from ${DEMO_FALLBACK_REPLY.capturedAt.slice(0, 10)}`, true)
    }
    const block = toFromSiteBlock(share, content.links)
    if (block.type === 'from_site') renderFromSite(ui, block.text, block.siteUrl)
  }

  const ui = mountTailorButton({
    onTailor: () => tailorNow(ui, mode === 'tailored'),
    onShowOriginal: () => {
      mode = 'original'
    },
    onShowTailored: () => {
      mode = 'tailored'
    },
    onInteraction: (event) => {
      if (!current) return
      const interaction: Interaction = { ...event, url, profileVersion: current.profileVersion, at: new Date().toISOString() }
      send('learn/log', { interaction })
        .then(({ changed }) => {
          // §9 1:25: "the profile updates on screen". Learned layout preferences only, with the posterior mean.
          const learned = changed.flatMap((f) => {
            const label = layoutLabel(f)
            return label ? [`${label} (${Math.round(f.confidence * 100)}%)`] : []
          })
          if (learned.length) ui.setStatus(`Learned: ${learned.join(', ')}`)
        })
        .catch((err: unknown) => console.warn('[tailor] learn/log failed', errorText(err)))
    },
    ...(canShare ? { onShare: () => shareWithSite(ui) } : {}),
  })

  function status(): ContentStatus {
    const s = ui.readStatus()
    const line = lastCard ? scorecardLine(lastCard) : ''
    return {
      url,
      mode,
      hasAgentHooks: canShare,
      ...(current ? { gate: current.gate } : {}),
      ...(s.text && !s.isGate ? { message: s.text, isError: s.isError } : {}),
      ...(line ? { scorecard: line } : {}),
    }
  }

  chrome.runtime.onMessage.addListener((cmd: ContentCommand, _sender, sendResponse) => {
    switch (cmd.type) {
      case 'content/tailor':
        ui.button.click() // the bar owns the loading/error state for this path
        break
      case 'content/original':
        showOriginal(ui)
        mode = 'original'
        break
      case 'content/share':
        void shareWithSite(ui).catch((err: unknown) => ui.setStatus(errorText(err), true))
        break
      case 'content/status':
        break
    }
    sendResponse(status())
    return false
  })

  // Auto-tailor on load (§3.5), on by default: extract while the original is on screen, run (cache first, so a page
  // seen before re-fits instantly), apply the moment the result lands. Quiet when there is no key, no profile yet or
  // no editable text; the Tailor button works the same in every case.
  void (async () => {
    try {
      const settings = await send('settings/get', {})
      if (!settings.autoTailorOnLoad) return
      if (!settings.anthropicKey) return ui.setStatus('Add an API key in the Tailor popup to tailor pages as they load')
      await pageSettled()
      if (current || mode !== 'original') return // the user clicked Tailor meanwhile
      if (getContent().segments.length < MIN_AUTO_SEGMENTS) return // nothing to edit in place; a click opens the panel
      const profile = await send('profile/get', {})
      if (!liveFacts(profile.facts).length) return ui.setStatus('Import your chats in Tailor to personalize pages')
      ui.setMode('loading')
      try {
        await tailorNow(ui, false, true)
      } finally {
        // tailorNow set `mode` across the await; the cast stops TS from narrowing it to the value checked above.
        ui.setMode((mode as ContentStatus['mode']) === 'tailored' ? 'tailored' : 'original')
      }
    } catch (err) {
      console.warn('[tailor] auto-tailor failed', err)
      ui.setStatus(errorText(err), true)
    }
  })()
}

boot()
