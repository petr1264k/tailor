import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, PageContent, Profile, TailoredPage } from '@/types'
import { resetDbForTests } from '@/archive'
import { completeJson } from '@/llm/client'
import { runFidelityGate } from '@/gate'
import { DEFAULT_SETTINGS, type Settings } from '@/settings'
import {
  cacheKey,
  fetchAgentMarkdown,
  getCachedTailoredPage,
  handlers,
  setCachedTailoredPage,
  stripHash,
  tailorPage,
} from './index'

vi.mock('@/llm/client', () => ({ completeJson: vi.fn() }))
vi.mock('@/gate', () => ({ runFidelityGate: vi.fn() }))

const URL_ = 'https://shop.example.com/tv?id=7#reviews'

const content: PageContent = {
  url: URL_,
  title: 'Samsung 65" QN90D',
  text: 'Four HDMI 2.1 ports support 4K at 120Hz, great for PS5. Price $1,299.99.',
  visibleText: 'VISIBLE: Four HDMI 2.1 ports support 4K at 120Hz, great for PS5. Price $1,299.99.',
  jsonLd: [],
  links: [{ text: 'Buy', href: 'https://shop.example.com/cart' }],
  source: 'readability',
  lang: 'en',
}

const profile: Profile = {
  version: 4,
  facts: [
    {
      id: 'f-ps5',
      category: 'owns',
      value: 'owns a PS5',
      confidence: 0.9,
      source: 'chat',
      evidence: [{ origin: 'chatgpt', title: 'TV', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
    },
    { id: 'f-hike', category: 'interest', value: 'likes hiking', confidence: 0.9, source: 'chat', evidence: [] },
  ],
  shares: [],
  stats: { conversations: 1, messages: 1, from: '', to: '' },
}

const settings: Settings = { ...DEFAULT_SETTINGS, activeProfileId: 'mikhail' }

const modelBlocks: Block[] = [
  { type: 'for_you', text: 'Your PS5 gets 4K at 120Hz on all four HDMI 2.1 ports.', factIds: ['f-ps5'] },
  { type: 'key_facts', rows: [{ label: 'Refresh', value: '240Hz' }] },
]

function mockModel(blocks: Block[] = modelBlocks) {
  vi.mocked(completeJson).mockResolvedValue({ value: { blocks }, model: 'm', ms: 1, usage: { input: 0, output: 0, cacheRead: 0 } })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDbForTests()
  vi.mocked(completeJson).mockReset()
  vi.mocked(runFidelityGate).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('cache', () => {
  it('key strips the hash', () => {
    expect(stripHash('https://a.test/p?q=1#frag')).toBe('https://a.test/p?q=1')
    expect(stripHash('not a url#x')).toBe('not a url')
    expect(cacheKey('mikhail', 4, 'https://a.test/p#top')).toBe('mikhail|4|https://a.test/p')
  })

  it('round-trips by (profileId, version, url without hash)', async () => {
    const page: TailoredPage = { url: URL_, profileVersion: 4, blocks: modelBlocks, gate: { checked: 2, stripped: [] } }
    await setCachedTailoredPage(page, 'mikhail')
    expect(await getCachedTailoredPage('https://shop.example.com/tv?id=7', 'mikhail', 4)).toEqual(page)
    expect(await getCachedTailoredPage('https://shop.example.com/tv?id=7#specs', 'mikhail', 4)).toEqual(page)
    expect(await getCachedTailoredPage(URL_, 'mikhail', 5)).toBeNull()
    expect(await getCachedTailoredPage(URL_, 'petr', 4)).toBeNull()
  })
})

describe('tailorPage', () => {
  it('selects facts, rewrites, gates against the VISIBLE page and caches', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(({ blocks }) => ({
      blocks: blocks.slice(0, 1),
      gate: { checked: 5, stripped: [{ blockIndex: 1, blockType: 'key_facts', claim: '240Hz', reason: 'not_on_page' }] },
    }))

    const page = await tailorPage(content, profile, settings)

    expect(page).toEqual({
      url: URL_,
      profileVersion: 4,
      blocks: [modelBlocks[0]],
      gate: { checked: 5, stripped: [{ blockIndex: 1, blockType: 'key_facts', claim: '240Hz', reason: 'not_on_page' }] },
    })
    const user = vi.mocked(completeJson).mock.calls[0]![0].user
    expect(user).toContain('f-ps5 | owns | owns a PS5')
    expect(user).not.toContain('f-hike')
    expect(runFidelityGate).toHaveBeenCalledWith({
      blocks: modelBlocks,
      visibleText: content.visibleText,
      links: content.links,
      userFactValues: ['owns a PS5', 'just got a PS5, which TV should I get?'],
    })
    expect(await getCachedTailoredPage(URL_, 'mikhail', 4)).toEqual(page)
  })

  it('passes the learned layout to the rewrite (§9: two expands of the specs → next page specs first)', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(({ blocks }) => ({ blocks, gate: { checked: 0, stripped: [] } }))
    const learned: Profile = {
      ...profile,
      facts: [
        ...profile.facts,
        {
          id: 'behavior-layout-specs_first',
          category: 'reading',
          value: 'layout:specs_first',
          confidence: 0.75,
          source: 'behavior',
          evidence: [{ origin: URL_, title: 'shop.example.com', date: '2026-10-10', quote: 'expanded the specs table' }],
          prior: { alpha: 3, beta: 1 },
        },
      ],
    }
    await tailorPage(content, learned, settings)
    const user = vi.mocked(completeJson).mock.calls[0]![0].user
    expect(user).toContain('Layout: specs first')
    expect(user).not.toContain('layout:specs_first') // not sent as a fact
  })

  it('rethrows real gate errors (fail closed)', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(tailorPage(content, profile, settings)).rejects.toThrow('boom')
  })

  it('uses the agent markdown for the rewrite but still gates against the visible page', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(({ blocks }) => ({ blocks, gate: { checked: 0, stripped: [] } }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Agent version\n\nPS5 owners: 4K at 120Hz.', { headers: { 'content-type': 'text/markdown' } })),
    )
    await tailorPage({ ...content, agentHooks: { markdownUrl: '/tv.md' } }, profile, settings)
    expect(vi.mocked(completeJson).mock.calls[0]![0].user).toContain('# Agent version')
    expect(vi.mocked(runFidelityGate).mock.calls[0]![0].visibleText).toBe(content.visibleText)
  })
})

describe('fetchAgentMarkdown', () => {
  it('accepts text/markdown or a body starting with #', async () => {
    const fetchMock = vi.fn(async () => new Response('\n\n# Title\nbody', { headers: { 'content-type': 'text/plain' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAgentMarkdown('https://www.coframe.com/')).toBe('\n\n# Title\nbody')
    expect(fetchMock).toHaveBeenCalledWith('https://www.coframe.com/', expect.objectContaining({ headers: { Accept: 'text/markdown' } }))
  })

  it('rejects HTML, errors and other sites', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><p>hi</p>', { headers: { 'content-type': 'text/html' } })))
    expect(await fetchAgentMarkdown('https://www.coframe.com/')).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('# nope', { status: 404 })))
    expect(await fetchAgentMarkdown('https://www.coframe.com/')).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))))
    expect(await fetchAgentMarkdown('https://www.coframe.com/')).toBeNull()

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAgentMarkdown('https://www.coframe.com/', 'http://192.168.0.1/admin.md')).toBeNull()
    expect(await fetchAgentMarkdown('https://www.coframe.com/', 'file:///etc/passwd')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the www/apex variant of the same site', async () => {
    const fetchMock = vi.fn(async () => new Response('# md', { headers: { 'content-type': 'text/markdown; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAgentMarkdown('https://www.coframe.com/', 'https://coframe.com/index.md')).toBe('# md')
  })
})

describe('handlers', () => {
  const sender = {} as chrome.runtime.MessageSender

  it('tailor/run returns the cache hit unless force, and tailor/cached reads it', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(({ blocks }) => ({ blocks, gate: { checked: 1, stripped: [] } }))

    expect(await handlers['tailor/cached']!({ type: 'tailor/cached', url: URL_ }, sender)).toBeNull()

    const first = await handlers['tailor/run']!({ type: 'tailor/run', content }, sender)
    expect(completeJson).toHaveBeenCalledTimes(1)
    expect(first.profileVersion).toBe(0) // fresh empty 'default' profile from src/profile

    const second = await handlers['tailor/run']!({ type: 'tailor/run', content }, sender)
    expect(second).toEqual(first)
    expect(completeJson).toHaveBeenCalledTimes(1)

    await handlers['tailor/run']!({ type: 'tailor/run', content, force: true }, sender)
    expect(completeJson).toHaveBeenCalledTimes(2)

    expect(await handlers['tailor/cached']!({ type: 'tailor/cached', url: URL_ }, sender)).toEqual(first)
  })

  it('tailor/run shares one model call between concurrent requests for the same page', async () => {
    mockModel()
    vi.mocked(runFidelityGate).mockImplementation(({ blocks }) => ({ blocks, gate: { checked: 0, stripped: [] } }))
    const [a, b] = await Promise.all([
      handlers['tailor/run']!({ type: 'tailor/run', content }, sender),
      handlers['tailor/run']!({ type: 'tailor/run', content: { ...content, url: 'https://shop.example.com/tv?id=7' } }, sender),
    ])
    expect(a).toEqual(b)
    expect(completeJson).toHaveBeenCalledTimes(1)
  })
})
