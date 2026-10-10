/**
 * Content script entry. Runs in the page origin: no IndexedDB, no API keys, no model calls here.
 * Mounts the floating bar, extracts the page content (while the ORIGINAL page is visible, because the
 * gate checks claims against the rendered visible text), asks the background to tailor, renders the
 * result, and runs the share flow with consent (CONTEXT.txt §3.5, §3.7, §4).
 *
 * Imports stay light on purpose: '@/tailor/extract', '@/share/hooks' and '@/share/block' pull in no SDK
 * and no IndexedDB, so this bundle loads fast on every page.
 */
import type { ContentCommand, ContentStatus } from '@/messages'
import { send } from '@/messages'
import type { Fact, Interaction, PageContent, TailoredPage } from '@/types'
import { extractPage, resolveSegment, type ExtractedPage } from '@/tailor/extract'
import { readAgentHooks, shareEndpoint } from '@/share/hooks'
import { toFromSiteBlock } from '@/share/block'
import { DEMO_FALLBACK_REPLY } from '@/share/fallback'
import {
  mountTailorButton,
  renderConsentSheet,
  renderFromSite,
  renderTailored,
  showOriginal,
  type TailorUi,
} from '@/render'

let current: TailoredPage | null = null
let extracted: ExtractedPage | null = null
let mode: ContentStatus['mode'] = 'original'

/** Deleted facts never reach a page (§3.4). Inlined so this bundle does not import '@/profile'. */
function liveFacts(facts: Fact[]): Fact[] {
  return facts.filter((f) => f.userStatus !== 'deleted')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
  function inPlaceTarget() {
    const { content, elements } = getExtracted()
    return { segments: content.segments, resolve: (seg: PageContent['segments'][number]) => resolveSegment(document, seg, elements.get(seg.id)) }
  }

  async function tailorNow(ui: TailorUi, force: boolean): Promise<void> {
    const previous = mode
    mode = 'loading'
    try {
      const content = getContent()
      const page = current && !force ? current : await send('tailor/run', { content, force })
      current = page
      const profile = await send('profile/get', {})
      renderTailored(page, liveFacts(profile.facts), ui, inPlaceTarget())
      ui.setGateSummary(page.gate.checked, page.gate.stripped.length, page.gate.stripped)
      mode = 'tailored'
    } catch (err) {
      mode = previous === 'loading' ? 'original' : previous
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
    return { url, mode, hasAgentHooks: canShare, gate: current?.gate }
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

  // Pre-tailor on load (§3.5): cache first, then a background run; nothing is shown until the user clicks.
  void (async () => {
    try {
      const settings = await send('settings/get', {})
      if (!settings.pretailorOnLoad) return
      const content = getContent()
      const page = (await send('tailor/cached', { url })) ?? (await send('tailor/run', { content }))
      if (current) return // the user clicked Tailor meanwhile; that result is already on screen
      current = page // a click on Tailor now shows this instantly
      if (mode === 'original') ui.setStatus('Tailored version ready')
    } catch (err) {
      console.warn('[tailor] pre-tailor failed', err)
    }
  })()
}

boot()
