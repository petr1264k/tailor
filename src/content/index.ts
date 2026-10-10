/**
 * Content script entry. Runs in the page origin: no IndexedDB, no API keys, no model calls here.
 * Mounts the floating bar, extracts page content, asks the background to tailor, renders the result.
 */
import type { ContentCommand, ContentStatus } from '@/messages'
import { send } from '@/messages'
import type { Interaction, TailoredPage } from '@/types'
import { extractPageContent } from '@/tailor'
import { mountTailorButton, renderTailored, showOriginal, showTailored } from '@/render'

let current: TailoredPage | null = null
let mode: ContentStatus['mode'] = 'original'

function boot(): void {
  if (window.top !== window) return // frames: skip
  const url = location.href

  const ui = mountTailorButton({
    onTailor: async () => {
      mode = 'loading'
      const content = extractPageContent(document, url)
      current = await send('tailor/run', { content })
      const profile = await send('profile/get', {})
      renderTailored(current, profile.facts, ui)
      ui.setGateSummary(current.gate.checked, current.gate.stripped.length)
      mode = 'tailored'
    },
    onShowOriginal: () => {
      showOriginal(ui)
      mode = 'original'
    },
    onShowTailored: () => {
      showTailored(ui)
      mode = 'tailored'
    },
    onInteraction: (event) => {
      if (!current) return
      const interaction: Interaction = { ...event, url, profileVersion: current.profileVersion, at: new Date().toISOString() }
      void send('learn/log', { interaction }).catch((err: unknown) => console.warn('[tailor] learn/log failed', err))
    },
  })

  chrome.runtime.onMessage.addListener((cmd: ContentCommand, _sender, sendResponse) => {
    switch (cmd.type) {
      case 'content/tailor':
        ui.button.click()
        break
      case 'content/original':
        showOriginal(ui)
        mode = 'original'
        break
      case 'content/share':
        // TODO(share): previewShare → renderConsentSheet → sendShare → renderFromSite
        break
      case 'content/status':
        break
    }
    const status: ContentStatus = { url, mode, hasAgentHooks: false, gate: current?.gate }
    sendResponse(status)
    return false
  })

  // TODO(tailor): pre-tailor on load when settings.pretailorOnLoad is true, using the cache first (§3.5).
}

boot()
