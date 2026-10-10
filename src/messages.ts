/**
 * Runtime message protocol. One place for every message type.
 *
 * content script ──send()──▶ background service worker (merges each module's `handlers`)
 * popup ──sendToTab()──▶ content script (ContentCommand)
 * UI pages run in the extension origin and may call modules directly instead of messaging.
 */
import type {
  ChatOrigin,
  CoframeAgentHooks,
  Fact,
  ImportOptions,
  Interaction,
  PageContent,
  Profile,
  ProfileStats,
  SiteShare,
  SourceSplit,
  TailoredPage,
} from './types'
import type { Settings } from './settings'

export interface ArchiveStats extends ProfileStats {
  byOrigin: Record<ChatOrigin, { conversations: number; messages: number }>
}

/** What the consent sheet shows, word for word (§4 share flow, step 3). */
export interface SharePreview {
  needsText: string
  constraints?: string
  /** The facts the needs text uses, each with its evidence, for the consent sheet. */
  facts: Fact[]
  endpoint: string
  agentName: 'Tailor'
  /** True when the real endpoint will not be called and the cached demo reply is used instead. Label it honestly. */
  usingFallback: boolean
}

type Empty = Record<never, never>

export interface RequestMap {
  ping: { req: Empty; res: { ok: true; at: string } }
  'settings/get': { req: Empty; res: Settings }
  'settings/set': { req: { patch: Partial<Settings> }; res: Settings }
  'import/run': {
    req: { origin: ChatOrigin; json: unknown; options?: ImportOptions }
    res: { conversations: number; messages: number; skippedMessages: number }
  }
  'archive/stats': { req: Empty; res: ArchiveStats }
  'extract/run': {
    req: { profileId?: string }
    res: { profile: Profile; neverExtracted: Record<string, number> }
  }
  'profile/get': { req: { profileId?: string }; res: Profile }
  'profile/split': { req: { profileId?: string }; res: SourceSplit }
  'profile/updateFact': {
    req: { factId: string; patch: Partial<Pick<Fact, 'value' | 'category' | 'userStatus'>>; profileId?: string }
    res: Profile
  }
  'profile/deleteFact': { req: { factId: string; profileId?: string }; res: Profile }
  'tailor/run': { req: { content: PageContent; force?: boolean }; res: TailoredPage }
  'tailor/cached': { req: { url: string }; res: TailoredPage | null }
  'learn/log': { req: { interaction: Interaction }; res: { profileVersion: number; changed: Fact[] } }
  'share/preview': { req: { content: PageContent; tailored: TailoredPage }; res: SharePreview }
  'share/send': {
    req: { url: string; needsText: string; constraints?: string; factIds: string[]; hooks: CoframeAgentHooks }
    res: SiteShare
  }
}

export type RequestType = keyof RequestMap
export type Request = { [K in RequestType]: { type: K } & RequestMap[K]['req'] }[RequestType]
export type RequestOf<K extends RequestType> = Extract<Request, { type: K }>
export type ResponseFor<K extends RequestType> = RequestMap[K]['res']

export type Handler<K extends RequestType> = (
  msg: RequestOf<K>,
  sender: chrome.runtime.MessageSender,
) => Promise<ResponseFor<K>>

/** Each module exports one of these; src/background/index.ts merges them. */
export type HandlerMap = { [K in RequestType]?: Handler<K> }

export interface ErrorResponse {
  error: string
}

export function isErrorResponse(x: unknown): x is ErrorResponse {
  return typeof x === 'object' && x !== null && 'error' in x && typeof (x as ErrorResponse).error === 'string'
}

/** Content script / UI → background. Throws if the handler threw. */
export async function send<K extends RequestType>(type: K, body: RequestMap[K]['req']): Promise<ResponseFor<K>> {
  const res: unknown = await chrome.runtime.sendMessage({ type, ...body })
  if (isErrorResponse(res)) throw new Error(`${type}: ${res.error}`)
  return res as ResponseFor<K>
}

/** Popup → the content script in a tab. */
export type ContentCommand =
  | { type: 'content/tailor' }
  | { type: 'content/original' }
  | { type: 'content/share' }
  | { type: 'content/status' }

export interface ContentStatus {
  url: string
  mode: 'original' | 'tailored' | 'loading'
  hasAgentHooks: boolean
  gate?: TailoredPage['gate']
}

export async function sendToTab(tabId: number, cmd: ContentCommand): Promise<ContentStatus | undefined> {
  return chrome.tabs.sendMessage(tabId, cmd)
}
