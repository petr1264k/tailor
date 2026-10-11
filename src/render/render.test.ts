import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Block, Fact, TailoredPage } from '@/types'
import type { SharePreview } from '@/messages'
import {
  blockToPlainText,
  evidenceLine,
  mountTailorButton,
  renderConsentSheet,
  renderFromSite,
  renderTailored,
  showOriginal,
  showTailored,
  splitSiteClaims,
  type RenderCallbacks,
  type TailorUi,
} from './index'

const ps5: Fact = {
  id: 'f1',
  category: 'owns',
  value: 'owns a PS5',
  confidence: 0.9,
  source: 'chat',
  evidence: [{ origin: 'chatgpt', title: 'TV shopping', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
}
const budget: Fact = {
  id: 'f2',
  category: 'constraint',
  value: 'TV budget around $800',
  confidence: 0.8,
  source: 'chat',
  evidence: [{ origin: 'claude', title: 'Budget', date: '2026-09-12', quote: 'I want to stay under $800' }],
}
const stack: Fact = {
  id: 'f3',
  category: 'expertise',
  value: 'frontend engineer',
  confidence: 0.7,
  source: 'chat',
  evidence: [{ origin: 'chatgpt', title: 'React', date: '2026-07-01', quote: 'my React app re-renders too much' }],
}

const ALL_BLOCKS: Block[] = [
  { type: 'summary', text: 'A 55-inch TV with four HDMI ports.' },
  { type: 'for_you', text: 'Works with your PS5 at 120 Hz.', factIds: ['f1'] },
  { type: 'key_facts', rows: [{ label: 'Price', value: '$899' }, { label: 'Panel', value: 'OLED' }] },
  { type: 'compare', columns: ['Model', 'Price'], rows: [['A55', '$899'], ['A65', '$1,199']] },
  { type: 'steps', items: ['Plug in the PS5', 'Turn on Game Mode'] },
  { type: 'warning', text: 'This is over your budget.', factIds: ['f2'] },
  { type: 'section', heading: 'Specs', text: 'Short specs text.' },
  { type: 'hidden', label: 'Marketing', reason: 'you skip marketing copy' },
  { type: 'cta', label: 'Buy now', href: 'https://shop.example.com/buy' },
  { type: 'from_site', text: 'We ship in 2 weeks.', siteUrl: 'https://www.coframe.com/' },
]

function page(blocks: Block[] = ALL_BLOCKS): TailoredPage {
  return {
    url: 'https://www.example.com/tv',
    profileVersion: 3,
    blocks,
    gate: { checked: 12, stripped: [{ blockIndex: 1, blockType: 'for_you', claim: '120 Hz on all four HDMI ports', reason: 'not_on_page' }] },
  }
}

let ui: TailorUi | null = null

function setup() {
  const callbacks = {
    onTailor: vi.fn<RenderCallbacks['onTailor']>(async () => {}),
    onShowOriginal: vi.fn<RenderCallbacks['onShowOriginal']>(),
    onShowTailored: vi.fn<RenderCallbacks['onShowTailored']>(),
    onInteraction: vi.fn<RenderCallbacks['onInteraction']>(),
  }
  ui = mountTailorButton(callbacks)
  return { ui, callbacks, onInteraction: callbacks.onInteraction }
}

const q = <E extends Element = HTMLElement>(sel: string): E => {
  const found = ui!.root.querySelector<E>(sel)
  if (!found) throw new Error(`missing ${sel}`)
  return found
}
const blockEls = () => [...ui!.root.querySelectorAll<HTMLElement>('.blocks > .block')]
const buttonByText = (text: string) => [...ui!.root.querySelectorAll('button')].find((b) => b.textContent === text)

afterEach(() => {
  ui?.destroy()
  ui = null
  vi.restoreAllMocks()
})

describe('mountTailorButton', () => {
  it('mounts the bar inside a shadow root', () => {
    const { ui } = setup()
    expect(document.getElementById('tailor-ext-host')).toBe(ui.host)
    expect(ui.host.shadowRoot).toBe(ui.root)
    expect(ui.root.querySelector('.bar')).not.toBeNull()
    expect(ui.button.textContent).toBe('Tailor')
    // Styles live in the shadow root only.
    expect(ui.root.querySelector('style')?.textContent).toContain('.panel')
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('clicking Tailor runs onTailor and ends in tailored mode once a panel is shown', async () => {
    const { callbacks } = setup()
    callbacks.onTailor.mockImplementation(async () => {
      await Promise.resolve()
      renderTailored(page(), [ps5], ui!)
    })
    ui!.button.click()
    expect(ui!.button.textContent).toBe('Tailoring…')
    await vi.waitFor(() => expect(ui!.button.textContent).toBe('Re-tailor'))
    expect(buttonByText('Original')?.hidden).toBe(false)
  })

  it('shows the error in the bar when onTailor fails', async () => {
    const { callbacks } = setup()
    callbacks.onTailor.mockRejectedValue(new Error('No Anthropic API key'))
    ui!.button.click()
    await vi.waitFor(() => expect(q('.status').textContent).toBe('No Anthropic API key'))
    expect(q('.status').classList.contains('is-error')).toBe(true)
    expect(ui!.button.textContent).toBe('Tailor')
  })
})

describe('renderTailored', () => {
  it('renders one element per block, in order, with the right text', () => {
    setup()
    renderTailored(page(), [ps5, budget], ui!)
    const els = blockEls()
    expect(els.map((e) => e.dataset['blockType'])).toEqual(ALL_BLOCKS.map((b) => b.type))
    const [summary, forYou, keyFacts, compare, steps, warning, section, hidden, cta, fromSite] = els as HTMLElement[] & { length: 10 }
    expect(summary!.textContent).toBe('A 55-inch TV with four HDMI ports.')
    expect(forYou!.textContent).toContain('Works with your PS5 at 120 Hz.')
    expect(keyFacts!.querySelectorAll('tr')).toHaveLength(2)
    expect(keyFacts!.querySelector('th')?.textContent).toBe('Price')
    expect(keyFacts!.querySelector('td')?.textContent).toBe('$899')
    expect([...compare!.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['Model', 'Price'])
    expect(compare!.querySelectorAll('tbody tr')).toHaveLength(2)
    expect([...steps!.querySelectorAll('ol > li')].map((l) => l.textContent)).toEqual(['Plug in the PS5', 'Turn on Game Mode'])
    expect(warning!.textContent).toContain('This is over your budget.')
    expect(section!.querySelector('h3')?.textContent).toBe('Specs')
    expect(section!.classList.contains('is-collapsed')).toBe(false)
    expect(section!.querySelector('.toggle')).toBeNull()
    expect(hidden!.querySelector('.row .text')?.textContent).toBe('Hidden: Marketing') // the reason is never shown
    expect(hidden!.classList.contains('is-collapsed')).toBe(true)
    const a = cta!.querySelector('a')!
    expect(a.textContent).toBe('Buy now')
    expect(a.href).toBe('https://shop.example.com/buy')
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    expect(fromSite!.querySelector('.kicker')?.textContent).toBe("From coframe.com · the site's own words")
  })

  it('shows a fixed dialog panel with the host and the gate log', () => {
    setup()
    renderTailored(page(), [ps5], ui!)
    const panel = q('.panel')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-label')).toBe('Tailored page')
    expect(q('.overlay').hidden).toBe(false)
    expect(q('.meta').textContent).toBe('example.com')
    expect(q('.gate-log summary').textContent).toContain('12 claims checked')
    expect(q('.gate-log .claim').textContent).toBe('120 Hz on all four HDMI ports')
  })

  it('a why chip click reports open_why with the fact id and shows the quote', () => {
    const { onInteraction } = setup()
    renderTailored(page(), [ps5, budget], ui!)
    const chip = q<HTMLButtonElement>('.block--for_you .why')
    const pop = q('.block--for_you .why-pop')
    expect(pop.hidden).toBe(true)
    chip.click()
    expect(onInteraction).toHaveBeenCalledWith({ kind: 'open_why', blockType: 'for_you', factIds: ['f1'] })
    expect(pop.hidden).toBe(false)
    expect(pop.textContent).toContain('owns a PS5')
    expect(pop.textContent).toContain("ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'")
    chip.click() // closing does not report again
    expect(pop.hidden).toBe(true)
    expect(onInteraction.mock.calls.filter(([e]) => e.kind === 'open_why')).toHaveLength(1)
  })

  it('gives no chip for unknown or deleted facts', () => {
    setup()
    renderTailored(page([{ type: 'for_you', text: 'x', factIds: ['f1', 'nope'] }]), [{ ...ps5, userStatus: 'deleted' }], ui!)
    expect(ui!.root.querySelectorAll('.why')).toHaveLength(0)
  })

  it('a long section starts collapsed; Expand reports expand, Collapse reports collapse', () => {
    const { onInteraction } = setup()
    renderTailored(page([{ type: 'section', heading: 'Marketing', text: 'Best TV ever. '.repeat(50) }]), [], ui!)
    const section = q('.block--section')
    const toggle = q<HTMLButtonElement>('.block--section .toggle')
    expect(section.classList.contains('is-collapsed')).toBe(true)
    expect(toggle.textContent).toBe('Expand')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'expand', blockType: 'section', factIds: [] })
    expect(section.classList.contains('is-collapsed')).toBe(false)
    expect(toggle.textContent).toBe('Collapse')
    toggle.click()
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'collapse', blockType: 'section', factIds: [] })
  })

  it('a long specs table starts collapsed and reports expand key_facts (learn: specs first); a short one has no toggle', () => {
    const { onInteraction } = setup()
    const rows = Array.from({ length: 8 }, (_, i) => ({ label: `Spec ${i}`, value: `${i}` }))
    renderTailored(page([{ type: 'key_facts', rows }, { type: 'key_facts', rows: rows.slice(0, 3) }]), [], ui!)
    const [long, short] = Array.from(ui!.root.querySelectorAll<HTMLElement>('.block--key_facts'))
    expect(long!.classList.contains('is-collapsed')).toBe(true)
    expect(short!.querySelector('.toggle')).toBeNull()
    long!.querySelector<HTMLButtonElement>('.toggle')!.click()
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'expand', blockType: 'key_facts', factIds: [] })
  })

  it('the hidden row expands and reports expand', () => {
    const { onInteraction } = setup()
    renderTailored(page([{ type: 'hidden', label: 'Marketing', reason: 'you skip it' }]), [], ui!)
    q<HTMLButtonElement>('.block--hidden .toggle').click()
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'expand', blockType: 'hidden', factIds: [] })
    expect(q('.block--hidden').classList.contains('is-collapsed')).toBe(false)
  })

  it('the ✕ on warning hides it and reports ignore', () => {
    const { onInteraction } = setup()
    renderTailored(page(), [ps5, budget], ui!)
    q<HTMLButtonElement>('.block--warning .dismiss').click()
    expect(q('.block--warning').hidden).toBe(true)
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'ignore', blockType: 'warning', factIds: ['f2'] })
  })

  it('never renders a javascript: cta as a link', () => {
    setup()
    renderTailored(page([{ type: 'cta', label: 'Click', href: 'javascript:alert(1)' }]), [], ui!)
    expect(ui!.root.querySelector('a')).toBeNull()
    expect(q('.block--cta').textContent).toBe('Click')
  })

  it('re-rendering replaces the blocks', () => {
    setup()
    renderTailored(page(), [], ui!)
    renderTailored(page([{ type: 'summary', text: 'again' }]), [], ui!)
    expect(blockEls()).toHaveLength(1)
    expect(ui!.root.querySelectorAll('.overlay')).toHaveLength(1)
  })
})

describe('Original ↔ Tailored and dwell', () => {
  it('showOriginal/showTailored hide and show the same panel and set the mode', () => {
    setup()
    renderTailored(page(), [ps5], ui!)
    const first = blockEls()[0]
    showOriginal(ui!)
    expect(q('.overlay').hidden).toBe(true)
    expect(buttonByText('Tailored')?.hidden).toBe(false)
    showTailored(ui!)
    expect(q('.overlay').hidden).toBe(false)
    expect(blockEls()[0]).toBe(first) // DOM kept: instant toggle
    expect(ui!.button.textContent).toBe('Re-tailor')
  })

  it('the bar toggle shows the original, calls back and logs toggle_original', () => {
    const { callbacks, onInteraction } = setup()
    renderTailored(page(), [ps5], ui!)
    ui!.setMode('tailored')
    buttonByText('Original')!.click()
    expect(q('.overlay').hidden).toBe(true)
    expect(callbacks.onShowOriginal).toHaveBeenCalledOnce()
    expect(onInteraction).toHaveBeenCalledWith({ kind: 'toggle_original', blockType: 'summary' })
    buttonByText('Tailored')!.click()
    expect(q('.overlay').hidden).toBe(false)
    expect(callbacks.onShowTailored).toHaveBeenCalledOnce()
  })

  it('reports dwell once when hidden, and again on pagehide after re-showing', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { onInteraction } = setup()
    renderTailored(page(), [ps5], ui!)
    now.mockReturnValue(4_500)
    showOriginal(ui!)
    showOriginal(ui!)
    const dwells = () => onInteraction.mock.calls.map(([e]) => e).filter((e) => e.kind === 'dwell')
    expect(dwells()).toEqual([{ kind: 'dwell', blockType: 'summary', ms: 3_500 }])
    now.mockReturnValue(10_000)
    showTailored(ui!)
    now.mockReturnValue(12_000)
    window.dispatchEvent(new Event('pagehide'))
    expect(dwells()).toEqual([
      { kind: 'dwell', blockType: 'summary', ms: 3_500 },
      { kind: 'dwell', blockType: 'summary', ms: 2_000 },
    ])
  })
})

describe('renderFromSite', () => {
  it('renders site text as plain text: no img element, numbers marked as claims', () => {
    setup()
    renderTailored(page([{ type: 'summary', text: 'hi' }]), [], ui!)
    const evil = 'Thanks! <img src=x onerror=alert(1)> We can go live in 2 weeks for $1,299.'
    renderFromSite(ui!, evil, 'https://www.coframe.com/_cf/agent-request')
    expect(ui!.root.querySelectorAll('img')).toHaveLength(0)
    expect(document.querySelectorAll('img')).toHaveLength(0)
    const block = blockEls().at(-1)!
    expect(block.dataset['blockType']).toBe('from_site')
    expect(block.querySelector('.kicker')?.textContent).toBe("From coframe.com · the site's own words")
    expect(block.querySelector('.text')?.textContent).toBe(evil)
    const claims = [...block.querySelectorAll<HTMLElement>('.site-claim')]
    expect(claims.map((c) => c.textContent)).toEqual(expect.arrayContaining(['2 weeks', '$1,299']))
    expect(claims.every((c) => c.title === "the site's claim")).toBe(true)
  })

  it('creates and shows the panel when nothing was tailored yet', () => {
    setup()
    renderFromSite(ui!, 'hello', 'https://coframe.com')
    expect(q('.overlay').hidden).toBe(false)
    expect(blockEls()).toHaveLength(1)
  })
})

describe('renderConsentSheet', () => {
  const preview: SharePreview = {
    needsText: 'A CTO evaluating fit with an existing React stack, integration time and SOC 2.',
    constraints: 'Needs approval before go-live.',
    facts: [ps5, budget, stack],
    endpoint: 'https://www.coframe.com/_cf/agent-request',
    agentName: 'Tailor',
    usingFallback: true,
  }

  it('shows the exact words, the facts with quotes, the agent name and the fallback line', () => {
    setup()
    void renderConsentSheet(ui!, preview)
    expect(q('.sheet-title').textContent).toBe('Share with coframe.com?')
    expect(q('.quote-box').textContent).toBe(preview.needsText)
    expect(ui!.root.querySelectorAll('.sheet-facts li')).toHaveLength(3)
    expect(q('.sheet-facts').textContent).toContain("Claude, Sep 12: 'I want to stay under $800'")
    expect(q('.sheet-meta').textContent).toBe('Sent as: Tailor')
    expect(q('.sheet-fallback').textContent).toBe('Using the cached demo reply')
    buttonByText("Don't share")!.click()
  })

  it("resolves true on 'Share N facts'", async () => {
    setup()
    const answer = renderConsentSheet(ui!, preview)
    buttonByText('Share 3 facts')!.click()
    await expect(answer).resolves.toBe(true)
    expect(ui!.root.querySelector('.sheet')).toBeNull()
  })

  it("resolves false on 'Don't share'", async () => {
    setup()
    const answer = renderConsentSheet(ui!, { ...preview, usingFallback: false })
    expect(ui!.root.querySelector('.sheet-fallback')).toBeNull()
    buttonByText("Don't share")!.click()
    await expect(answer).resolves.toBe(false)
  })

  it('resolves false on Escape', async () => {
    setup()
    const answer = renderConsentSheet(ui!, preview)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(answer).resolves.toBe(false)
    expect(ui!.root.querySelector('.sheet')).toBeNull()
  })
})

describe('pure helpers', () => {
  it('blockToPlainText covers every block type', () => {
    const expected = [
      'A 55-inch TV with four HDMI ports.',
      'Works with your PS5 at 120 Hz.',
      'Price: $899\nPanel: OLED',
      'Model | Price\nA55 | $899\nA65 | $1,199',
      '1. Plug in the PS5\n2. Turn on Game Mode',
      'This is over your budget.',
      'Specs\nShort specs text.',
      'Hidden: Marketing',
      'Buy now',
      'We ship in 2 weeks.',
    ]
    expect(ALL_BLOCKS.map(blockToPlainText)).toEqual(expected)
  })

  it('evidenceLine formats chat and page origins', () => {
    expect(evidenceLine(ps5.evidence[0]!)).toBe("ChatGPT, Aug 3: 'just got a PS5, which TV should I get?'")
    expect(evidenceLine({ origin: 'https://www.bestbuy.com/tv/1', title: 't', date: 'not a date', quote: 'expanded specs' })).toBe(
      "bestbuy.com: 'expanded specs'",
    )
  })

  it('splitSiteClaims keeps the text intact and skips digits inside words', () => {
    const text = 'H100 nodes: 99.9% uptime, 500+ teams, 4K at 120Hz.'
    const parts = splitSiteClaims(text)
    expect(parts.map((p) => p.text).join('')).toBe(text)
    expect(parts.filter((p) => p.claim).map((p) => p.text)).toEqual(['99.9%', '500+ teams', '4K', '120Hz'])
  })
})
