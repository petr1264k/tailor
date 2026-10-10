/**
 * The only place that talks to a model. (CONTEXT.txt §5)
 *
 * - Runs in the background service worker (and in the extension pages). Browser-side calls need
 *   `dangerouslyAllowBrowser`, which sets the `anthropic-dangerous-direct-browser-access: true` header.
 * - `completeJson()` is the one entry point: it asks for JSON, parses it, validates it with a zod schema,
 *   and throws a typed `LlmError` otherwise. The model proposes, code decides.
 * - Model ids come from CONTEXT.txt §5: Haiku 5.5 for extraction and rewrites, Sonnet 5.5 for the merge.
 * - Haiku 5.5 / Sonnet 5.5: thinking is adaptive by default; depth is controlled with `output_config.effort`.
 *   Do not send `temperature` (non-default values are rejected on these models).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ZodType } from 'zod'
import { getSettings } from '@/settings'

export const MODELS = {
  /** Haiku reads chunks and proposes candidate facts (§3.2). */
  extract: 'claude-haiku-5-5',
  /** Sonnet merges duplicates and scores facts (§3.2). */
  merge: 'claude-sonnet-5-5',
  /** Fast in-page rewrite (§3.5). */
  rewrite: 'claude-haiku-5-5',
} as const
export type ModelRole = keyof typeof MODELS

export type LlmErrorCode = 'missing_key' | 'refusal' | 'truncated' | 'bad_json' | 'schema' | 'rate_limit' | 'network' | 'api'

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

let cached: { cacheKey: string; client: Anthropic } | null = null

export async function getClient(): Promise<Anthropic> {
  const { anthropicKey, anthropicWorkspaceId } = await getSettings()
  if (!anthropicKey) throw new LlmError('missing_key', 'No Anthropic API key. Paste one in the Tailor popup.')
  const workspaceId = anthropicWorkspaceId?.trim() || undefined
  const cacheKey = `${anthropicKey}|${workspaceId ?? ''}`
  if (cached?.cacheKey === cacheKey) return cached.client
  const client = new Anthropic({
    apiKey: anthropicKey,
    dangerouslyAllowBrowser: true,
    // The SDK retries 408/409/429/5xx with exponential backoff and honours retry-after. Extraction fires MAP_CONCURRENCY
    // Haiku calls at once, so a 429 burst is normal; 4 retries ride it out instead of dropping the chunk.
    maxRetries: 4,
    // Org-level keys must name a workspace; workspace-scoped keys ignore this header.
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  })
  cached = { cacheKey, client }
  return client
}

export interface CompleteJsonOptions<T> {
  role: ModelRole
  /** Keep this string stable across calls: it is cached with `cache_control`. Put volatile content in `user`. */
  system: string
  user: string
  schema: ZodType<T>
  /** Default 8192. Raise for long pages; the reply is JSON, so truncation means a hard failure. */
  maxTokens?: number
  /** Default 'low' for speed. Use 'medium' for the merge. */
  effort?: 'low' | 'medium' | 'high'
}

export interface CompleteJsonResult<T> {
  value: T
  model: string
  ms: number
  usage: { input: number; output: number; cacheRead: number }
}

/** Strip ```json fences and leading prose, then JSON.parse. Models sometimes wrap JSON even when told not to. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.search(/[[{]/)
  if (start < 0) throw new LlmError('bad_json', 'No JSON object in model reply', text)
  try {
    return JSON.parse(candidate.slice(start))
  } catch (e) {
    throw new LlmError('bad_json', 'Model reply is not valid JSON', { text, error: String(e) })
  }
}

/** One line of text for an SDK error: "400 This API key is not scoped to a workspace… (request-id req_…)". */
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const status = e.status ? `HTTP ${e.status}: ` : ''
    const text = e.message.startsWith(String(e.status ?? '')) ? e.message : `${status}${e.message}`
    return e.requestID ? `${text} (request-id ${e.requestID})` : text
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`
  if (typeof e === 'object' && e !== null) {
    try {
      return JSON.stringify(e).slice(0, 500)
    } catch {
      return Object.prototype.toString.call(e)
    }
  }
  return String(e)
}

export async function completeJson<T>(opts: CompleteJsonOptions<T>): Promise<CompleteJsonResult<T>> {
  const client = await getClient()
  const model = MODELS[opts.role]
  const t0 = performance.now()
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 8192,
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.user }],
      output_config: { effort: opts.effort ?? 'low' },
    })
  } catch (e) {
    // chrome://extensions keeps only the text of a console.error (objects show as "[object Object]"),
    // so log one line of text. The SDK message already starts with the HTTP status and the error body.
    const summary = describeApiError(e)
    console.error(`[tailor] Anthropic API error (${model}): ${summary}`)
    if (e instanceof Anthropic.RateLimitError) throw new LlmError('rate_limit', `Rate limited by the API: ${summary}`, e)
    if (e instanceof Anthropic.APIConnectionError) throw new LlmError('network', `Could not reach the API: ${summary}`, e)
    throw new LlmError('api', `API error: ${summary}`, e)
  }
  if (res.stop_reason === 'refusal') throw new LlmError('refusal', 'The model declined this request', res.stop_details)
  if (res.stop_reason === 'max_tokens') throw new LlmError('truncated', `Reply hit max_tokens (${opts.maxTokens ?? 8192})`)

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = opts.schema.safeParse(extractJson(text))
  if (!parsed.success) throw new LlmError('schema', 'Model reply failed schema validation', parsed.error.issues)

  return {
    value: parsed.data,
    model,
    ms: performance.now() - t0,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
    },
  }
}
