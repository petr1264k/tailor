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
import { extractPageContent } from '@/tailor/extract'
import { readAgentHooks } from '@/share/hooks'
import { toFromSiteBlock } from '@/share/block'
import {
  mountTailorButton,
  renderConsentSheet,
  renderFromSite,
  renderTailored,
  showOriginal,
  type TailorUi,
} from '@/render'

let current: TailoredPage | null = null
let pageContent: PageContent | null = null
let mode: ContentStatus['mode'] = 'original'

/** Deleted facts never reach a page (§3.4). Inlined so this bundle does not import '@/profile'. */
function liveFacts(facts: Fact[]): Fact[] {
  return facts.filter((f) => f.userStatus !== 'deleted')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function boot(): void {
  if (window.top !== window) return // frames: skip
  const url = location.href
  let hooks: ReturnType<typeof readAgentHooks> = null
  try {
    hooks = readAgentHooks(document)
  } catch (err) {
    console.warn('[tailor] readAgentHooks failed', err)
  }

  /** Extracted once, while the original page is shown; re-tailoring reuses it. */
  function getContent(): PageContent {
    if (!pageContent) pageContent = extractPageContent(document, url)
    return pageContent
  }

  async function tailorNow(ui: TailorUi, force: boolean): Promise<void> {
    const previous = mode
    mode = 'loading'
    try {
      const content = getContent()
      const page = current && !force ? current : await send('tailor/run', { content, force })
      current = page
      const profile = await send('profile/get', {})
      renderTailored(page, liveFacts(profile.facts), ui)
      ui.setGateSummary(page.gate.checked, page.gate.stripped.length)
      mode = 'tailored'
    } catch (err) {
      mode = previous === 'loading' ? 'original' : previous
      throw err
    }
  }

  /** §4 share flow: preview → consent sheet (word for word) → POST → the site's reply, labeled as the site's. */
  async function shareWithSite(ui: TailorUi): Promise<void> {
    if (!current) throw new Error('Tailor the page first')
    const content = getContent()
    const preview = await send('share/preview', { content, tailored: current })
    const agreed = await renderConsentSheet(ui, preview)
    if (!agreed) return
    const share = await send('share/send', {
      url,
      needsText: preview.needsText,
      constraints: preview.constraints,
      factIds: preview.facts.map((f) => f.id),
      hooks: content.agentHooks ?? hooks ?? {},
    })
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
      void send('learn/log', { interaction }).catch((err: unknown) => console.warn('[tailor] learn/log failed', err))
    },
    onShare: () => shareWithSite(ui).catch((err: unknown) => ui.setStatus(errorText(err), true)),
  })

  function status(): ContentStatus {
    return { url, mode, hasAgentHooks: hooks !== null, gate: current?.gate }
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
      current = (await send('tailor/cached', { url })) ?? (await send('tailor/run', { content }))
      ui.setStatus('Tailored version ready')
    } catch (err) {
      console.warn('[tailor] pre-tailor failed', err)
    }
  })()
}

boot()
