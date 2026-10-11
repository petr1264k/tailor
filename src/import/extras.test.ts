import { describe, expect, it } from 'vitest'
import { cleanNote, detectClaudeExtra, parseClaudeExtra, splitText } from './extras'

const memories = {
  conversations_memory: '**Work context**\n\nRuns a small bakery and writes about sourdough.',
  memory_files: [
    {
      path: '/topics/hardware.md',
      content: '---\nname: hardware\ndescription: Computing hardware\nsources: [chat]\n---\n\n- [stated] Primary machine: a ThinkPad X1\n- [stated] Runs Linux',
      updated_at: '2026-07-29T17:29:05.040975+00:00',
    },
    { path: '/profile.md', content: '- [stated] Writes in English and Spanish', updated_at: '2026-08-21T16:15:49+00:00' },
    { path: '/empty.md', content: '   ', updated_at: '2026-08-21T16:15:49+00:00' },
  ],
  project_memories: { abc: 'same notes again' },
  account_uuid: 'acct',
}

const project = {
  uuid: 'p1',
  name: 'Recipe cards',
  description: 'Short recipe cards',
  prompt_template: 'Write each card in under 100 words. No intro.',
  is_starter_project: false,
  created_at: '2025-03-22T10:00:00Z',
  updated_at: '2025-03-23T10:00:00Z',
  docs: [{ filename: 'guide.pdf', content: 'pasted guide' }],
}

describe('detectClaudeExtra', () => {
  it('tells memories and project files apart from anything else', () => {
    expect(detectClaudeExtra(memories)).toBe('memories')
    expect(detectClaudeExtra(project)).toBe('project')
    expect(detectClaudeExtra([{ chat_messages: [] }])).toBeNull()
    expect(detectClaudeExtra({ users: [] })).toBeNull()
  })
})

describe('parseClaudeExtra', () => {
  it('turns the memory summary and each note into memory items with clean text', () => {
    const convs = parseClaudeExtra(memories)
    expect(convs.map((c) => c.title)).toEqual(['Claude memory · summary', 'Claude memory · hardware', 'Claude memory · profile'])
    const hardware = convs[1].messages[0]
    expect(hardware).toMatchObject({ kind: 'memory', origin: 'claude', date: '2026-07-29T17:29:05.040Z' })
    expect(hardware.text).toBe('Computing hardware\n- Primary machine: a ThinkPad X1\n- Runs Linux')
    // The summary takes the newest note's date.
    expect(convs[0].messages[0].date).toBe('2026-08-21T16:15:49.000Z')
  })

  it('reads a project description and instructions as the person’s own words, without docs', () => {
    const [conv] = parseClaudeExtra(project)
    expect(conv.title).toBe('Claude project · Recipe cards')
    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0]).toMatchObject({ kind: 'project', date: '2025-03-22T10:00:00.000Z' })
    expect(conv.messages[0].text).toBe('Short recipe cards\nWrite each card in under 100 words. No intro.')
  })

  it('skips starter projects and empty projects', () => {
    expect(parseClaudeExtra({ ...project, is_starter_project: true })).toEqual([])
    expect(parseClaudeExtra({ ...project, description: '', prompt_template: '' })).toEqual([])
  })
})

describe('splitText / cleanNote', () => {
  it('splits long text at line breaks and cuts a single overlong line', () => {
    const parts = splitText(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(70)].join('\n'), 64)
    expect(parts.every((p) => p.length <= 64)).toBe(true)
    expect(parts.join('').replace(/\n/g, '')).toBe('a'.repeat(30) + 'b'.repeat(30) + 'c'.repeat(70))
  })

  it('keeps notes without front matter as they are, minus tags', () => {
    expect(cleanNote('- [backfill] Likes tea\nplain line')).toBe('- Likes tea\nplain line')
  })
})
