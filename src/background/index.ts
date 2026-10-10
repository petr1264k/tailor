/**
 * Background service worker. Merges every module's `handlers` and routes runtime messages.
 * All model API calls originate here (or in extension pages), never in the content script.
 */
import type { HandlerMap, Request, RequestType } from '@/messages'
import { isErrorResponse } from '@/messages'
import { settingsHandlers } from '@/settings'
import { llmHandlers } from '@/llm/handlers'
import { handlers as archiveHandlers } from '@/archive'
import { handlers as importHandlers } from '@/import'
import { handlers as extractHandlers } from '@/extract'
import { handlers as profileHandlers } from '@/profile'
import { handlers as tailorHandlers } from '@/tailor'
import { handlers as learnHandlers } from '@/learn'
import { handlers as shareHandlers } from '@/share'

const registry: HandlerMap = {
  ping: async () => ({ ok: true, at: new Date().toISOString() }),
  ...settingsHandlers,
  ...llmHandlers,
  ...archiveHandlers,
  ...importHandlers,
  ...extractHandlers,
  ...profileHandlers,
  ...tailorHandlers,
  ...learnHandlers,
  ...shareHandlers,
}

type AnyHandler = (msg: Request, sender: chrome.runtime.MessageSender) => Promise<unknown>

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  const handler = registry[msg.type as RequestType] as AnyHandler | undefined
  if (!handler) {
    sendResponse({ error: `No handler for ${String(msg.type)}` })
    return false
  }
  handler(msg, sender).then(
    (res) => sendResponse(isErrorResponse(res) ? res : (res ?? null)),
    (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  )
  return true // keep the channel open for the async reply
})

chrome.runtime.onInstalled.addListener(() => {
  console.log('[tailor] installed', chrome.runtime.getManifest().version)
})

// chrome://extensions keeps only the TEXT of what reaches the error log (objects show as "[object Object]"), so every
// uncaught error and rejection in the worker is re-logged as one line that names the error and its message.
function errorLine(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`
  if (typeof reason === 'object' && reason !== null) {
    try {
      return JSON.stringify(reason).slice(0, 500)
    } catch {
      return Object.prototype.toString.call(reason)
    }
  }
  return String(reason)
}
self.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  console.error(`[tailor] unhandled rejection: ${errorLine((event as PromiseRejectionEvent).reason)}`)
})
self.addEventListener('error', (event) => {
  const e = event as ErrorEvent
  console.error(`[tailor] uncaught error: ${errorLine(e.error ?? e.message)}`)
})
