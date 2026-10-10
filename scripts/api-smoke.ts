/**
 * Reproduces the extension's rewrite call outside Chrome and prints the full API error body.
 * Usage: put ANTHROPIC_API_KEY=sk-ant-... in .env (gitignored), then `npm run smoke`.
 * Never prints the key.
 */
import { readFileSync } from 'node:fs'
import { setSettings } from '../src/settings'
import { completeJson, LlmError, MODELS } from '../src/llm/client'
import { RewriteOutputSchema } from '../src/schemas'
import { REWRITE_SYSTEM, buildRewriteUserPrompt } from '../src/tailor/rewrite'
import type { PageContent } from '../src/types'

function loadEnv(): void {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env */
  }
}

loadEnv()
const key = process.env['ANTHROPIC_API_KEY']
if (!key) {
  console.error('No ANTHROPIC_API_KEY in .env or the environment.')
  process.exit(1)
}
console.log(`key: ${key.slice(0, 10)}… (${key.length} chars)  model: ${MODELS.rewrite}`)
await setSettings({ anthropicKey: key })

const page: PageContent = {
  url: 'https://example.com/tv/qn90d',
  title: 'Samsung 65" QN90D Neo QLED 4K TV',
  text: 'The QN90D is a 65-inch Neo QLED 4K TV with a 120 Hz panel, four HDMI 2.1 ports, Dolby Atmos and a $1,299 price. Game Mode Pro supports VRR and ALLM for PS5 and Xbox.',
  visibleText: 'The QN90D is a 65-inch Neo QLED 4K TV with a 120 Hz panel, four HDMI 2.1 ports, Dolby Atmos and a $1,299 price. Game Mode Pro supports VRR and ALLM for PS5 and Xbox.',
  jsonLd: [],
  links: [{ text: 'Buy now', href: 'https://example.com/tv/qn90d/buy' }],
  source: 'raw',
  segments: [],
  lang: 'en',
}

try {
  const t0 = Date.now()
  const res = await completeJson({
    role: 'rewrite',
    effort: 'low',
    schema: RewriteOutputSchema,
    maxTokens: 2000,
    system: REWRITE_SYSTEM,
    user: buildRewriteUserPrompt(page, []),
  })
  console.log(`OK in ${Date.now() - t0} ms: ${res.value.blocks.length} blocks, usage`, res.usage)
  for (const b of res.value.blocks) console.log(' -', b.type, JSON.stringify(b).slice(0, 120))
} catch (e) {
  if (e instanceof LlmError) {
    console.error(`LlmError ${e.code}: ${e.message}`)
    const d = e.detail as { status?: number; error?: unknown; message?: string } | undefined
    if (d && typeof d === 'object') console.error('status:', d.status, '\nbody:', JSON.stringify(d.error ?? d.message, null, 2))
  } else {
    console.error(e)
  }
  process.exit(1)
}
export {}
