/**
 * A tiny .env reader for the Node eval harness (dotenv is not installed). Keys never get printed.
 * Supports KEY=VALUE, `export KEY=VALUE`, # comments, single/double-quoted values, inline ` # comments` on unquoted values.
 */
import { readFileSync } from 'node:fs'

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue // blank lines, comments, junk
    const quoted = /^(["'])([\s\S]*)\1$/.exec(m[2])
    out[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, '')
  }
  return out
}

/** Reads `path` into `env` without overwriting what is already set. Returns the key NAMES it set. Missing file → []. */
export function loadDotEnv(path: string, env: NodeJS.ProcessEnv = process.env): string[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const set: string[] = []
  for (const [k, v] of Object.entries(parseEnv(text))) {
    if (env[k] === undefined || env[k] === '') {
      env[k] = v
      set.push(k)
    }
  }
  return set
}
