/** `llm/test`: one tiny rewrite-shaped call so the popup can show the full API error text. */
import type { HandlerMap } from '@/messages'
import { z } from 'zod'
import { completeJson, MODELS } from './client'

const PingSchema = z.object({ ok: z.literal(true) })

export const llmHandlers: HandlerMap = {
  'llm/test': async () => {
    const t0 = performance.now()
    try {
      await completeJson({
        role: 'rewrite',
        effort: 'low',
        schema: PingSchema,
        maxTokens: 200,
        system: 'Reply with JSON only.',
        user: 'Return exactly {"ok": true}',
      })
      return { ok: true, model: MODELS.rewrite, ms: Math.round(performance.now() - t0) }
    } catch (e) {
      // LlmError messages already carry the HTTP status, the API error body and the request id.
      const error = e instanceof Error ? e.message : String(e)
      return { ok: false, model: MODELS.rewrite, ms: Math.round(performance.now() - t0), error }
    }
  },
}
