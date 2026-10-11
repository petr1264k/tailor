/**
 * Smoke tests for the profile page. No testing library is installed: react-dom/client + act + jsdom.
 * 1. Every tab renders without crashing, whatever state the other modules are in (errors show inline).
 * 2. The §9 demo path: drop a ChatGPT conversations.json → archive stats; facts → delete one live → struck through → restore.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Fact } from '@/types'
import { resetDbForTests } from '@/archive'
import { saveProfile, emptyProfile, getProfile } from '@/profile'
import { App } from './App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let el: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}

async function mount() {
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root.render(<App />))
  await flush()
}

function button(label: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent === label)
  if (!b) throw new Error(`no button "${label}"`)
  return b
}

async function click(label: string) {
  await act(async () => button(label).click())
  await flush()
}

/** Types into a React-controlled input: set the value through the native setter, then fire 'input'. */
async function typeInto(selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  indexedDB = new IDBFactory()
  resetDbForTests()
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

describe('profile page', () => {
  it('renders Import, Profile and Receipts tabs without crashing', async () => {
    await mount()
    expect(el.textContent).toContain('Import your chat history')
    for (const label of ['Profile', 'Receipts', 'Import']) await click(label)
    expect(el.textContent).toContain('Archive')
  })

  it('imports one ChatGPT file and shows per-source stats', async () => {
    await mount()
    const t = Date.now() / 1000
    const node = (id: string, parent: string | null, children: string[], role: string, text: string) => ({
      id,
      parent,
      children,
      message: { id, author: { role }, create_time: t, content: { content_type: 'text', parts: [text] } },
    })
    const exportJson = [
      {
        id: 'c1',
        title: 'TV',
        create_time: t,
        mapping: {
          a: node('a', null, ['b'], 'user', 'just got a PS5, which TV should I get?'),
          b: node('b', 'a', ['c'], 'assistant', 'assistant text is never stored'),
          c: node('c', 'b', [], 'user', 'budget is around 800'),
        },
      },
    ]
    const file = new File([JSON.stringify(exportJson)], 'conversations.json', { type: 'application/json' })
    const input = el.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await flush()
    expect(el.textContent).toContain('ChatGPT: saved 1 conversations, 2 of your own messages.')
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['ChatGPT12', 'Claude00'])
  })

  it('deletes a fact live, strikes it through, and restores it', async () => {
    const fact: Fact = {
      id: 'f1',
      category: 'owns',
      value: 'owns a PS5',
      confidence: 0.8,
      source: 'chat',
      evidence: [{ origin: 'chatgpt', title: 'TV', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
    }
    await saveProfile({ ...emptyProfile(), facts: [fact] }, 'default')
    await mount()
    await click('Profile')
    expect(el.textContent).toContain('owns a PS5')
    const quote = el.querySelector('.q.own')?.textContent
    expect(quote).toContain('✎ Your words')
    expect(quote).toContain('ChatGPT · Aug 3, 2026')
    expect(quote).toContain('just got a PS5, which TV should I get?')

    await typeInto('input[type="search"]', 'zzz')
    expect(el.textContent).toContain('No facts match these filters.')
    await click('Show all facts')
    expect(el.textContent).toContain('owns a PS5')

    await click('Delete')
    expect(el.querySelector('.fact.deleted')?.textContent).toContain('owns a PS5')
    expect((await getProfile('default')).facts[0]!.userStatus).toBe('deleted')

    await click('Restore')
    expect(el.querySelector('.fact.deleted')).toBeNull()
    expect((await getProfile('default')).facts[0]!.userStatus).toBe('kept')
  })
})
