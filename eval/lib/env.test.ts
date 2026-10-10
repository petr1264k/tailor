import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDotEnv, parseEnv } from './env'

describe('parseEnv', () => {
  it('reads KEY=VALUE lines and skips comments and blanks', () => {
    const env = parseEnv('# comment\n\nANTHROPIC_API_KEY=sk-ant-123\nGOOGLE_AI_STUDIO_KEY=\n  OPENROUTER_API_KEY = abc  \n')
    expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-123', GOOGLE_AI_STUDIO_KEY: '', OPENROUTER_API_KEY: 'abc' })
  })

  it('strips quotes, `export`, inline comments on unquoted values, and handles CRLF', () => {
    const env = parseEnv('export A="x # not a comment"\r\nB=\'single\'\r\nC=plain # trailing\r\nD=a=b\r\n')
    expect(env).toEqual({ A: 'x # not a comment', B: 'single', C: 'plain', D: 'a=b' })
  })

  it('ignores junk lines', () => {
    expect(parseEnv('not a pair\n=novalue\n1BAD=x\nOK=1')).toEqual({ OK: '1' })
  })
})

describe('loadDotEnv', () => {
  it('sets missing keys only, returns names, and tolerates a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tailor-env-'))
    const path = join(dir, '.env')
    writeFileSync(path, 'A=from-file\nB=from-file\n')
    const env: NodeJS.ProcessEnv = { A: 'already-set' }
    expect(loadDotEnv(path, env)).toEqual(['B'])
    expect(env).toEqual({ A: 'already-set', B: 'from-file' })
    expect(loadDotEnv(join(dir, 'missing.env'), env)).toEqual([])
  })
})
