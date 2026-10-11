import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fact, PageEdit, PageSegment, TailoredPage } from '@/types'
import { collectSegments, resolveSegment } from '@/tailor/segments'
import { mountTailorButton, playTailored, renderFromSite, renderReportSheet, renderTailored, showOriginal, showTailored, type RenderCallbacks, type TailorUi } from './index'
import { appliedLabels, foldTargets, markedElements, noteAnchor } from './inplace'
import { buildScorecard, countWords, measureSide, scorecardChip, scorecardLine, scorecardRows } from './scorecard'

const ps5: Fact = {
  id: 'f1',
  category: 'owns',
  value: 'owns a PS5',
  confidence: 0.9,
  source: 'chat',
  evidence: [{ origin: 'chatgpt', title: 'TV shopping', date: '2026-08-03', quote: 'just got a PS5, which TV should I get?' }],
}
const simple: Fact = { id: 'f2', category: 'reading', value: 'prefers short sentences', confidence: 0.7, source: 'chat', evidence: [] }

const PAGE_HTML = `
  <main>
    <h1 style="font-size:40px"><span class="sr-only">Maximize revenue from the demand you already have.</span><span aria-hidden="true">Maximize</span> <span aria-hidden="true">revenue</span></h1>
    <p id="intro">Four HDMI 2.1 ports support 4K at 120Hz, which is great for consoles.</p>
    <ul id="list"><li>Plug in the console</li><li>Turn on Game Mode in settings</li></ul>
    <section id="praise" class="hero"><img src="x.png" alt=""><h2>Loved by families everywhere</h2><p>Thousands of five-star reviews from happy customers.</p></section>
    <p id="specs" style="display:flex">Price $1,299.99. Panel: Neo QLED.</p>
  </main>`

let ui: TailorUi | null = null
let segments: PageSegment[] = []
let elements = new Map<string, Element>()

function setup(html = PAGE_HTML) {
  document.body.innerHTML = html
  const collected = collectSegments(document)
  segments = collected.segments
  elements = collected.elements
  const callbacks = {
    onTailor: vi.fn<RenderCallbacks['onTailor']>(async () => {}),
    onShowOriginal: vi.fn<RenderCallbacks['onShowOriginal']>(),
    onShowTailored: vi.fn<RenderCallbacks['onShowTailored']>(),
    onInteraction: vi.fn<RenderCallbacks['onInteraction']>(),
  }
  ui = mountTailorButton(callbacks)
  return { ui, callbacks, onInteraction: callbacks.onInteraction }
}

const target = () => ({ segments, resolve: (s: PageSegment) => resolveSegment(document, s, elements.get(s.id)) })
const byText = (text: string) => segments.find((s) => s.text.startsWith(text))!.id

function page(edits: PageEdit[]): TailoredPage {
  return { url: 'https://www.example.com/tv', profileVersion: 1, blocks: [], gate: { checked: 3, stripped: [] }, edits }
}

const hosts = (tag: string) => [...document.querySelectorAll<HTMLElement>(tag)]
const inShadow = <E extends Element = HTMLElement>(host: Element, sel: string): E => {
  const found = host.shadowRoot?.querySelector<E>(sel)
  if (!found) throw new Error(`missing ${sel} in ${host.tagName}`)
  return found
}

afterEach(() => {
  ui?.destroy()
  ui = null
  document.body.innerHTML = ''
})

describe('in-place edits', () => {
  it('segments the fixture as expected', () => {
    setup()
    expect(segments.map((s) => s.text)).toEqual([
      'Maximize revenue from the demand you already have.',
      'Four HDMI 2.1 ports support 4K at 120Hz, which is great for consoles.',
      'Plug in the console',
      'Turn on Game Mode in settings',
      'Loved by families everywhere',
      'Thousands of five-star reviews from happy customers.',
      'Price $1,299.99. Panel: Neo QLED.',
    ])
  })

  it('a rewrite swaps the text inside the site element, keeps its styles, and adds a why chip for cited facts', () => {
    const { onInteraction } = setup()
    renderTailored(page([{ op: 'rewrite', id: byText('Maximize'), text: 'Earn more from the visitors you already have.', factIds: ['f2'] }]), [ps5, simple], ui!, target())
    const h1 = document.querySelector('h1')!
    expect(h1.style.fontSize).toBe('40px')
    expect(h1.childNodes[0]?.textContent).toBe('Earn more from the visitors you already have.')
    expect(h1.querySelectorAll('span.sr-only')).toHaveLength(0)
    const chip = inShadow<HTMLButtonElement>(h1.querySelector('tailor-why')!, '.why')
    chip.click()
    expect(onInteraction).toHaveBeenCalledWith({ kind: 'open_why', blockType: 'section', factIds: ['f2'] })
    expect(inShadow(h1.querySelector('tailor-why')!, '.why-pop').textContent).toContain('prefers short sentences')
    // No site-visible stylesheet was added.
    expect(document.head.querySelector('style')).toBeNull()
    expect(document.body.querySelector('style')).toBeNull()
  })

  it('a hide moves the whole exclusive section (image included) to the bottom of its parent; nothing is hidden', () => {
    setup()
    renderTailored(page([{ op: 'hide', ids: [byText('Loved'), byText('Thousands')], label: 'Customer praise', reason: 'you skip marketing' }]), [], ui!, target())
    const main = document.querySelector('main')!
    const section = document.getElementById('praise')!
    expect(main.lastElementChild).toBe(section)
    expect(section.hasAttribute('style')).toBe(false) // not display:none, not touched at all
    expect(section.querySelector('img')).not.toBeNull()
    expect(hosts('tailor-fold')).toHaveLength(0) // no stub, nothing of ours left where it stood
    expect(appliedLabels(ui!)).toEqual(['Moved down: Customer praise · you skip marketing'])
    showOriginal(ui!)
    expect(section.nextElementSibling?.id).toBe('specs') // back between its original neighbours
  })

  it('foldTargets hides elements one by one when their common ancestor holds other segments', () => {
    setup()
    const intro = document.getElementById('intro')!
    const specs = document.getElementById('specs')!
    const all = segments.map((s) => elements.get(s.id)!)
    expect(foldTargets([intro, specs], all)).toEqual([intro, specs])
    const praise = [elements.get(byText('Loved'))!, elements.get(byText('Thousands'))!]
    expect(foldTargets(praise, all)).toEqual([document.getElementById('praise')])
  })

  it('a note is stuck on its anchor from the overlay; a note on a list item sticks to the list; ✕ reports ignore', () => {
    const { onInteraction } = setup()
    renderTailored(
      page([
        { op: 'note', after: byText('Four HDMI'), text: 'Works with your PS5 at 120Hz.', factIds: ['f1'] },
        { op: 'warn', after: byText('Plug in'), text: 'Game Mode is off by default.', factIds: ['f1'] },
      ]),
      [ps5],
      ui!,
      target(),
    )
    const notes = hosts('tailor-note')
    expect(notes).toHaveLength(2)
    expect(notes.map((n) => n.parentElement)).toEqual([document.body, document.body]) // overlay, not in the page's flow
    expect(noteAnchor(notes[0]!)).toBe(document.getElementById('intro'))
    expect(noteAnchor(notes[1]!)).toBe(document.getElementById('list'))
    expect(document.getElementById('intro')!.nextElementSibling?.id).toBe('list') // the page's own order is untouched
    expect(inShadow(notes[0]!, '.kicker').textContent).toBe('For you')
    expect(inShadow(notes[0]!, '.text').textContent).toBe('Works with your PS5 at 120Hz.')
    expect(inShadow(notes[1]!, '.note').classList.contains('is-warn')).toBe(true)
    expect(inShadow(notes[1]!, '.kicker').textContent).toBe('Heads up')
    expect(inShadow(notes[0]!, 'tailor-why')).toBeTruthy()
    expect(inShadow(notes[0]!, 'tailor-why').hasAttribute('data-paper')).toBe(true) // drawn in the note's ink, not as a chip
    inShadow<HTMLButtonElement>(notes[1]!, '.dismiss').click()
    expect(notes[1]!.hidden).toBe(true)
    // The host has its own display rule, so the shadow stylesheet must hide the host itself, not just its children.
    expect(inShadow(notes[1]!, 'style').textContent).toContain(':host([hidden])')
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'ignore', blockType: 'warning', factIds: ['f1'] })
  })

  it('a note keeps its place in the document when the page scrolls, on a positioned body too', async () => {
    setup()
    document.body.style.position = 'relative' // Shopify themes do this; it used to re-pin a scrolled-past note to the viewport top
    let scrollY = 0
    const scrollYDesc = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true })
    Object.defineProperty(document, 'scrollingElement', { value: { scrollHeight: 6000, clientHeight: 800 }, configurable: true })
    // jsdom has no layout: the intro sits 1,200px down the page, the body starts at the top, and the note host sits
    // where its left/top put it in body coordinates. All in viewport space, so they move with scrollY.
    const rect = (x: number, y: number, w: number, h: number) =>
      ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === document.body) return rect(0, -scrollY, 1000, 6000)
      if (this.id === 'intro') return rect(100, 1200 - scrollY, 600, 40)
      if (this.tagName === 'TAILOR-NOTE') {
        const el = this as HTMLElement
        return rect(parseFloat(el.style.left) || 0, (parseFloat(el.style.top) || 0) - scrollY, 240, 80)
      }
      return rect(0, 0, 0, 0)
    })
    try {
      renderTailored(page([{ op: 'note', after: byText('Four HDMI'), text: 'Works with your PS5.', factIds: ['f1'] }]), [ps5], ui!, target())
      const host = hosts('tailor-note')[0]!
      const placed = parseFloat(host.style.top)
      expect(placed).toBeGreaterThan(1100) // document space: on the intro, not on the viewport
      scrollY = 1500 // the intro is now 300px above the viewport
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 50))
      expect(parseFloat(host.style.top)).toBe(placed) // stayed on its spot instead of travelling with the reader
    } finally {
      spy.mockRestore()
      delete (document as { scrollingElement?: unknown }).scrollingElement
      if (scrollYDesc) Object.defineProperty(window, 'scrollY', scrollYDesc)
    }
  })

  it('a note anchored inside a moved-down part stays on it', () => {
    setup()
    renderTailored(
      page([
        { op: 'hide', ids: [byText('Loved'), byText('Thousands')], label: 'Praise', reason: 'filler' },
        { op: 'note', after: byText('Thousands'), text: 'Reviews mention console input lag.', factIds: ['f1'] },
      ]),
      [ps5],
      ui!,
      target(),
    )
    const praise = document.getElementById('praise')!
    expect(document.querySelector('main')!.lastElementChild).toBe(praise)
    expect(noteAnchor(hosts('tailor-note')[0]!)).toBe(praise.querySelector('p'))
  })

  it('Original puts every original node back exactly; Tailored re-applies instantly', () => {
    const { callbacks, onInteraction } = setup()
    const before = document.querySelector('main')!.innerHTML
    const originalH1Nodes = Array.from(document.querySelector('h1')!.childNodes)
    renderTailored(
      page([
        { op: 'rewrite', id: byText('Maximize'), text: 'New headline.' },
        { op: 'rewrite', id: byText('Price'), text: 'Price $1,299.99.' },
        { op: 'hide', ids: [byText('Loved'), byText('Thousands')], label: 'Praise', reason: 'filler' },
        { op: 'note', after: byText('Four HDMI'), text: 'PS5 ready.', factIds: ['f1'] },
      ]),
      [ps5],
      ui!,
      target(),
    )
    expect(document.querySelector('main')!.innerHTML).not.toBe(before)
    expect(ui!.button.textContent).toBe('Re-tailor')
    const toggle = [...ui!.root.querySelectorAll('button')].find((b) => b.textContent === 'Original')!
    expect(toggle.hidden).toBe(false)
    toggle.click()
    expect(document.querySelector('main')!.innerHTML).toBe(before)
    expect(Array.from(document.querySelector('h1')!.childNodes)).toEqual(originalH1Nodes)
    expect(document.getElementById('specs')!.style.display).toBe('flex')
    expect(callbacks.onShowOriginal).toHaveBeenCalledOnce()
    expect(onInteraction).toHaveBeenCalledWith({ kind: 'toggle_original', blockType: 'summary' })
    showTailored(ui!)
    expect(document.querySelector('h1')!.textContent).toContain('New headline.')
    expect(hosts('tailor-note')).toHaveLength(1)
    expect(document.querySelector('main')!.lastElementChild!.id).toBe('praise')
    showOriginal(ui!)
    expect(document.querySelector('main')!.innerHTML).toBe(before)
  })

  it('reports dwell for the time the tailored page was shown', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { onInteraction } = setup()
    renderTailored(page([{ op: 'rewrite', id: byText('Maximize'), text: 'New.' }]), [], ui!, target())
    now.mockReturnValue(5_000)
    showOriginal(ui!)
    expect(onInteraction).toHaveBeenCalledWith({ kind: 'dwell', blockType: 'summary', ms: 4_000 })
    now.mockRestore()
  })

  it('skips edits whose element is gone and re-finds elements the site re-rendered', () => {
    setup()
    const introId = byText('Four HDMI')
    const goneId = byText('Price')
    document.getElementById('specs')!.remove()
    // Re-render the intro paragraph: same tag and text, new node.
    const intro = document.getElementById('intro')!
    const fresh = document.createElement('p')
    fresh.textContent = intro.textContent
    intro.replaceWith(fresh)
    renderTailored(page([{ op: 'rewrite', id: introId, text: 'Rewritten intro.' }, { op: 'rewrite', id: goneId, text: 'Rewritten specs.' }]), [], ui!, target())
    expect(fresh.textContent).toBe('Rewritten intro.')
    expect(document.body.textContent).not.toContain('Rewritten specs.')
  })

  it('re-rendering undoes the previous edits first', () => {
    setup()
    renderTailored(page([{ op: 'note', after: byText('Four HDMI'), text: 'One.', factIds: ['f1'] }]), [ps5], ui!, target())
    renderTailored(page([{ op: 'note', after: byText('Four HDMI'), text: 'Two.', factIds: ['f1'] }]), [ps5], ui!, target())
    const notes = hosts('tailor-note')
    expect(notes).toHaveLength(1)
    expect(inShadow(notes[0]!, '.text').textContent).toBe('Two.')
  })

  it('the site reply is stuck on the headline as plain text with numbers marked as claims', () => {
    setup()
    renderTailored(page([{ op: 'rewrite', id: byText('Maximize'), text: 'New.' }]), [], ui!, target())
    const evil = 'Thanks! <img src=x onerror=alert(1)> We can go live in 2 weeks for $1,299.'
    renderFromSite(ui!, evil, 'https://www.coframe.com/_cf/agent-request')
    expect(document.querySelectorAll('img:not([alt=""])')).toHaveLength(0)
    const host = hosts('tailor-note')[0]!
    expect(noteAnchor(host)).toBe(document.querySelector('h1'))
    expect(host.dataset['blockType']).toBe('from_site')
    expect(inShadow(host, '.kicker').textContent).toBe("From coframe.com · the site's own words")
    expect(inShadow(host, '.text').textContent).toBe(evil)
    expect([...host.shadowRoot!.querySelectorAll('.site-claim')].map((c) => c.textContent)).toEqual(expect.arrayContaining(['2 weeks', '$1,299']))
    showOriginal(ui!)
    expect(hosts('tailor-note')).toHaveLength(0)
    showTailored(ui!)
    expect(hosts('tailor-note')).toHaveLength(1)
  })

  it('a page without edits still renders the panel; the next in-place render removes the panel', () => {
    setup()
    renderTailored({ ...page([]), edits: undefined, blocks: [{ type: 'summary', text: 'panel' }] }, [], ui!, target())
    expect(ui!.root.querySelector('.overlay')).not.toBeNull()
    renderTailored(page([{ op: 'rewrite', id: byText('Maximize'), text: 'New.' }]), [], ui!, target())
    expect(ui!.root.querySelector('.overlay')).toBeNull()
    expect(document.querySelector('h1')!.textContent).toContain('New.')
  })

  it('the gate summary opens a popover listing stripped claims', () => {
    setup()
    ui!.setGateSummary(7, 1, [{ blockIndex: 0, blockType: 'section', claim: '144 Hz', reason: 'not_on_page' }])
    const status = ui!.root.querySelector<HTMLButtonElement>('.status')!
    expect(status.textContent).toBe('checked 7 · stripped 1')
    const pop = ui!.root.querySelector<HTMLElement>('.gate-pop')!
    expect(pop.hidden).toBe(true)
    status.click()
    expect(pop.hidden).toBe(false)
    expect(pop.querySelector('.claim')?.textContent).toBe('144 Hz')
    expect(pop.textContent).toContain('7 claims checked')
  })
})

describe('in place: page map edits (promote, badge, region hide) and the scorecard', () => {
  const STORE = `
    <main><div class="wrap">
      <div id="hero"><h2>Fall Savings Start Now</h2><p>Save up to 50% on select favorites.</p></div>
      <div id="stats"><h2>The No. 1 Mobile Charging Brand</h2><p>Available in 146 Markets</p></div>
      <div id="shelf"><h2>Must-Have Selections</h2><div id="list">
        <div class="card" id="c1"><a href="/p/1">x</a><h3>Nano Charger (45W)</h3><p>Small and foldable.</p></div>
        <div class="card" id="c2"><a href="/p/2">x</a><h3>Laptop Power Bank (25K, 165W)</h3><p>Charges a MacBook Pro.</p></div>
        <div class="card" id="c3"><a href="/p/3">x</a><h3>Prime Charger (250W)</h3><p>Six ports for the desk.</p></div>
      </div></div>
      <div id="member"><h2>Become a member today</h2><p>Earn points on every purchase you make.</p></div>
    </div></main>`
  const regions = [
    { id: 'r1', role: 'hero' as const, title: 'Fall Savings Start Now', segmentIds: [] },
    { id: 'r2', role: 'stats' as const, title: 'The No. 1 Mobile Charging Brand', segmentIds: [] },
    {
      id: 'r3',
      role: 'products' as const,
      title: 'Must-Have Selections',
      segmentIds: [],
      items: [
        { id: 'i1', title: 'Nano Charger (45W)', segmentIds: [] },
        { id: 'i2', title: 'Laptop Power Bank (25K, 165W)', segmentIds: [] },
        { id: 'i3', title: 'Prime Charger (250W)', segmentIds: [] },
      ],
    },
    { id: 'r4', role: 'membership' as const, title: 'Become a member today', segmentIds: [] },
  ]
  const byId: Record<string, string> = { r1: 'hero', r2: 'stats', r3: 'shelf', r4: 'member', i1: 'c1', i2: 'c2', i3: 'c3' }
  const mapTarget = () => ({ ...target(), regions, resolveRegion: (id: string) => document.getElementById(byId[id] ?? '') , promoteAfterRole: 'hero' as const })
  const order = (parent: string) => Array.from(document.getElementById(parent)!.children).map((c) => c.id || c.tagName.toLowerCase()).filter((x) => !x.startsWith('tailor'))
  const wrapOrder = () => Array.from(document.querySelector('.wrap')!.children).map((c) => c.id || c.tagName.toLowerCase())

  it('promotes a region to just after the hero run and a card to the front of its list, with an exact undo', () => {
    const { ui } = setup(STORE)
    const originalWrap = wrapOrder()
    const originalList = order('list')
    renderTailored(
      page([
        { op: 'promote', id: 'r3', reason: 'Power banks for your trips come first.', factIds: ['f1'] },
        { op: 'promote', id: 'i2', reason: 'Enough for your MacBook Pro.', factIds: ['f1'] },
      ]),
      [ps5],
      ui,
      mapTarget(),
    )
    expect(wrapOrder()).toEqual(['hero', 'shelf', 'stats', 'member']) // the strip is in the overlay, not in the wrap
    const strip = hosts('tailor-note')[0]!
    expect(noteAnchor(strip)?.id).toBe('shelf')
    expect(strip.shadowRoot!.querySelector('.kicker')!.textContent).toBe('Moved up for you')
    expect(strip.shadowRoot!.querySelector('.text')!.textContent).toBe('Power banks for your trips come first.')
    expect(order('list')).toEqual(['c2', 'c1', 'c3'])
    const badge = document.querySelector('#c2 h3 tailor-badge') as HTMLElement
    expect(badge.shadowRoot!.querySelector('.badge-kicker')!.textContent).toBe('Moved up for you')
    expect(badge.shadowRoot!.querySelector('.badge-label')!.textContent).toBe('Enough for your MacBook Pro.')

    showOriginal(ui)
    expect(wrapOrder()).toEqual(originalWrap)
    expect(order('list')).toEqual(originalList)
    expect(document.querySelector('tailor-note, tailor-badge')).toBeNull()

    showTailored(ui)
    expect(wrapOrder()).toEqual(['hero', 'shelf', 'stats', 'member'])
    expect(order('list')).toEqual(['c2', 'c1', 'c3'])
  })

  it('tags a card with a badge inside its title, moves a region whole to the bottom, and undoes both', () => {
    const { ui } = setup(STORE)
    const member = document.getElementById('member') as HTMLElement
    const parent = member.parentElement!
    const orderBefore = [...parent.children].map((c) => c.id || c.tagName)
    renderTailored(
      page([
        { op: 'badge', id: 'i1', label: '45W: enough for your phone', factIds: ['f1'] },
        { op: 'hide', ids: ['r4'], label: 'Membership pitch', reason: 'You buy, you do not join.' },
      ]),
      [ps5],
      ui,
      mapTarget(),
    )
    const badge = document.querySelector('#c1 h3 tailor-badge') as HTMLElement
    expect(badge.shadowRoot!.querySelector('.badge-label')!.textContent).toBe('45W: enough for your phone')
    expect(badge.shadowRoot!.querySelectorAll('tailor-why')).toHaveLength(1)
    expect(parent.lastElementChild).toBe(member) // moved down, still on the page
    expect(member.hasAttribute('style')).toBe(false)
    expect(document.querySelector('tailor-fold')).toBeNull()
    showOriginal(ui)
    expect(document.querySelector('tailor-badge')).toBeNull()
    expect([...parent.children].map((c) => c.id || c.tagName)).toEqual(orderBefore)
  })

  it('skips map edits whose element is gone and still applies the rest', () => {
    const { ui } = setup(STORE)
    document.getElementById('c3')!.remove()
    renderTailored(
      page([
        { op: 'badge', id: 'i3', label: 'gone', factIds: ['f1'] },
        { op: 'promote', id: 'i9', reason: 'unknown', factIds: ['f1'] },
        { op: 'badge', id: 'i1', label: 'still here', factIds: ['f1'] },
      ]),
      [ps5],
      ui,
      mapTarget(),
    )
    expect(document.querySelectorAll('tailor-badge')).toHaveLength(1)
  })

  it('markedElements lists promote and badge targets and note anchors once each, in edit order', () => {
    setup(STORE)
    const marked = markedElements(
      page([
        { op: 'promote', id: 'r3', reason: 'r', factIds: ['f1'] },
        { op: 'badge', id: 'i2', label: 'b', factIds: ['f1'] },
        { op: 'note', after: 'i2', text: 'n', factIds: ['f1'] },
        { op: 'hide', ids: ['r4'], label: 'h', reason: 'r' },
        { op: 'note', after: byText('Save up'), text: 'n2', factIds: ['f1'] },
      ]),
      mapTarget(),
    )
    expect(marked.map((e) => e.id || e.tagName.toLowerCase())).toEqual(['shelf', 'c2', 'p'])
  })
})

describe('scorecard', () => {
  it('counts words, screens and first-screen marks; formats the bar line and rows', () => {
    expect(countWords("Anker's 45W charger — $29.99, 180° foldable")).toBe(6)
    const before = { words: 2870, firstMatchTop: 3240, firstMatchScreens: 3.6, onFirstScreen: 0 }
    const after = { words: 1140, firstMatchTop: 420, firstMatchScreens: 0.5, onFirstScreen: 2 }
    const card = buildScorecard(
      page([
        { op: 'promote', id: 'r3', reason: 'r', factIds: ['f1'] },
        { op: 'badge', id: 'i2', label: 'b', factIds: ['f1'] },
        { op: 'hide', ids: ['r4'], label: 'h', reason: 'r' },
      ]),
      before,
      after,
      3,
      900,
    )
    expect(card).toMatchObject({ marked: 3, promoted: 1, badges: 1, hidden: 1, notes: 0, warnings: 0, rewrites: 0 })
    expect(scorecardLine(card)).toBe('1st match 3.6 screens down → first screen · words 2,870 → 1,140')
    expect(scorecardChip(card)).toBe('3.6 → 0.5 screens · 2,870 → 1,140 words')
    expect(scorecardRows(card)).toEqual([
      ['First thing marked for you', '3.6 screens down → first screen (3,240 px → 420 px)'],
      ['Marked for you on the first screen', '0 → 2 of 3'],
      ['Words on the page', '2,870 → 1,140'],
      ['Changes', '1 moved up, 1 tagged, 1 moved down'],
    ])
    const none = buildScorecard(page([]), { ...before, firstMatchTop: null, firstMatchScreens: null }, { ...after, firstMatchTop: null, firstMatchScreens: null }, 0, 900)
    expect(scorecardLine(none)).toBe('words 2,870 → 1,140')
    expect(scorecardChip(none)).toBe('2,870 → 1,140 words')
  })

  it('shows a stat only when the edits moved it', () => {
    const before = { words: 2870, firstMatchTop: 3240, firstMatchScreens: 3.9, onFirstScreen: 0 }
    const sameScreens = buildScorecard(page([]), before, { ...before, words: 1140 }, 3, 900)
    expect(scorecardChip(sameScreens)).toBe('2,870 → 1,140 words')
    expect(scorecardLine(sameScreens)).toBe('words 2,870 → 1,140')
    const sameWords = buildScorecard(page([]), before, { ...before, firstMatchTop: 420, firstMatchScreens: 0.5 }, 3, 900)
    expect(scorecardChip(sameWords)).toBe('3.9 → 0.5 screens')
    expect(scorecardLine(sameWords)).toBe('1st match 3.9 screens down → first screen')
    const nothing = buildScorecard(page([]), before, { ...before }, 3, 900)
    expect(scorecardChip(nothing)).toBe('')
    expect(scorecardLine(nothing)).toBe('')
    expect(scorecardRows(nothing)[2]).toEqual(['Changes', 'none']) // an unchanged word count is no row at all
  })

  it('measureSide reads positions and visible words from the live page', () => {
    document.body.innerHTML = `<div id="a">one two three</div><div id="b" style="display:none">hidden words here</div>`
    const side = measureSide(document, [document.getElementById('a')!, document.getElementById('b')!])
    expect(side.words).toBe(3)
    expect(side.firstMatchTop).toBe(0)
    expect(side.onFirstScreen).toBe(1)
  })
})

describe('demo mode: the changes play top to bottom', () => {
  const edits = (): PageEdit[] => [
    { op: 'note', after: byText('Price'), text: 'Under your $1,500 budget.', factIds: ['f1'] },
    { op: 'hide', ids: [byText('Loved'), byText('Thousands')], label: 'Customer praise', reason: 'you skip marketing' },
    { op: 'rewrite', id: byText('Maximize'), text: 'Earn more from the visitors you already have.', factIds: ['f2'] },
    { op: 'badge', id: byText('Plug in'), label: 'Works with your PS5', factIds: ['f1'] },
  ]

  it('plays every change in document order, narrates each step, and ends exactly like the instant render', async () => {
    setup()
    renderTailored(page(edits()), [ps5, simple], ui!, target())
    const instant = document.body.innerHTML
    showOriginal(ui!)
    const steps: string[] = []
    const shown = await playTailored(page(edits()), [ps5, simple], ui!, target(), {
      scroll: false,
      pace: 0,
      onStep: (label, i, n) => steps.push(`${i + 1}/${n} ${label}`),
    })
    expect(shown).toBe(true)
    // Top to bottom: the headline, the list item, the praise section, the price line.
    expect(steps).toEqual([
      '1/4 Rewrote: Maximize revenue from the demand you already have.',
      '2/4 Tagged: Works with your PS5',
      '3/4 Moved down: Customer praise · you skip marketing',
      '4/4 Note: Under your $1,500 budget.',
    ])
    expect(appliedLabels(ui!)).toEqual([
      'Rewrote: Maximize revenue from the demand you already have.',
      'Moved down: Customer praise · you skip marketing',
      'Note: Under your $1,500 budget.',
      'Tagged: Works with your PS5',
    ])
    expect(document.querySelector('h1')!.childNodes[0]?.textContent).toBe('Earn more from the visitors you already have.')
    expect(document.querySelector('main')!.lastElementChild!.id).toBe('praise')
    expect(hosts('tailor-note')).toHaveLength(1)
    expect(hosts('tailor-badge')).toHaveLength(1)
    expect(document.body.innerHTML).toBe(instant)
  })

  it('promotes play first, before the rest of the page', async () => {
    setup(`<main><section id="hero"><h1>Hero</h1><p>Welcome to the store.</p></section>
      <section id="cats"><h2>Categories</h2><p>Browse by room.</p></section>
      <section id="shelf"><h2>Must-Have</h2><ul><li><h3>Charger A</h3><p>65W, $39</p></li><li><h3>Charger B</h3><p>100W, $59</p></li></ul></section></main>`)
    const regions = [
      { id: 'r1', role: 'hero' as const, title: 'Hero', segmentIds: [] },
      { id: 'r2', role: 'categories' as const, title: 'Categories', segmentIds: [] },
      { id: 'r3', role: 'products' as const, title: 'Must-Have', segmentIds: [], items: [{ id: 'i1', title: 'Charger A', segmentIds: [] }, { id: 'i2', title: 'Charger B', segmentIds: [] }] },
    ]
    const byId: Record<string, Element> = {
      r1: document.getElementById('hero')!,
      r2: document.getElementById('cats')!,
      r3: document.getElementById('shelf')!,
      i1: document.querySelectorAll('li')[0]!,
      i2: document.querySelectorAll('li')[1]!,
    }
    const t = { ...target(), regions, resolveRegion: (id: string) => byId[id] ?? null, promoteAfterRole: 'hero' as const }
    const steps: string[] = []
    await playTailored(
      page([
        { op: 'rewrite', id: byText('Welcome'), text: 'Welcome back.' },
        { op: 'promote', id: 'r3', reason: 'you asked about chargers', factIds: ['f1'] },
        { op: 'promote', id: 'i2', reason: '100W fits your laptop', factIds: ['f1'] },
      ]),
      [ps5],
      ui!,
      t,
      { scroll: false, pace: 0, onStep: (label) => steps.push(label) },
    )
    expect(steps).toEqual(['Moved up: Must-Have', 'Moved up: Charger B', 'Rewrote: Welcome to the store.'])
    expect(document.getElementById('hero')!.nextElementSibling?.id).toBe('shelf')
    expect(document.querySelector('li h3')!.textContent).toBe('Charger B')
  })

  it('Original mid-run stops the playback and puts everything back; Tailored then lands at once', async () => {
    const { onInteraction } = setup()
    const before = document.querySelector('main')!.innerHTML
    const steps: string[] = []
    const shown = await playTailored(page(edits()), [ps5, simple], ui!, target(), {
      scroll: false,
      pace: 0,
      onStep: (label) => {
        steps.push(label)
        if (steps.length === 2) showOriginal(ui!) // the user flips to Original while the second change plays
      },
    })
    expect(shown).toBe(false)
    expect(steps).toHaveLength(2) // the run stopped: nothing after the step that was playing
    expect(document.querySelector('main')!.innerHTML).toBe(before) // the first change undone, the later ones never applied
    expect(document.getElementById('specs')!.style.display).toBe('flex') // an edit that never played left no trace
    expect(hosts('tailor-note')).toHaveLength(0)
    expect(onInteraction).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'toggle_original' })) // showOriginal, not the user's toggle
    showTailored(ui!)
    expect(document.querySelector('main')!.lastElementChild!.id).toBe('praise')
    expect(document.querySelector('h1')!.childNodes[0]?.textContent).toBe('Earn more from the visitors you already have.')
    expect(hosts('tailor-note')).toHaveLength(1)
    expect(hosts('tailor-badge')).toHaveLength(1)
    showOriginal(ui!)
    expect(document.querySelector('main')!.innerHTML).toBe(before)
  })

  it('the report sheet lists the numbers, the changes and the fact check; OK closes it', async () => {
    setup()
    const card = buildScorecard(
      page(edits()),
      { words: 2870, firstMatchTop: 3240, firstMatchScreens: 3.6, onFirstScreen: 0 },
      { words: 1140, firstMatchTop: 120, firstMatchScreens: 0.1, onFirstScreen: 2 },
      3,
      900,
    )
    const closed = renderReportSheet(ui!, {
      site: 'www.example.com',
      card,
      gate: { checked: 14, stripped: [{ blockIndex: 0, blockType: 'section', claim: '144 Hz', reason: 'not_on_page' }] },
      changes: ['Moved up: Must-Have Picks', 'Folded: Customer praise'],
    })
    const sheet = ui!.root.querySelector('.sheet')!
    expect(sheet.querySelector('.sheet-title')!.textContent).toBe('2 changes for you on this page')
    expect(sheet.querySelector('.sheet-label')!.textContent).toBe('Tailored for you · www.example.com')
    const rows = [...sheet.querySelectorAll('.report-rows tr')].map((tr) => [...tr.children].map((td) => td.textContent))
    expect(rows[0]).toEqual(['First thing marked for you', '3.6 screens down → first screen (3,240 px → 120 px)'])
    expect(rows[2]).toEqual(['Words on the page', '2,870 → 1,140'])
    const items = [...sheet.querySelectorAll('.report-changes li')]
    expect(items.map((li) => li.textContent)).toEqual(['Moved up: Must-Have Picks', 'Folded: Customer praise'])
    expect(items[0]!.querySelector('b')!.textContent).toBe('Moved up:')
    expect(sheet.querySelector('.report-gate')!.textContent).toContain('14 claims checked against this page · 1 stripped')
    expect(sheet.querySelector('.report-gate .claim')!.textContent).toBe('144 Hz')
    expect(ui!.root.querySelector<HTMLElement>('.bar')!.hidden).toBe(true) // nothing of ours stays on the page
    ui!.root.querySelector<HTMLButtonElement>('.sheet-actions .primary')!.click()
    await closed
    expect(ui!.root.querySelector('.sheet')).toBeNull()
  })

  it('a page without edits falls back to the panel and resolves true', async () => {
    setup()
    const shown = await playTailored({ ...page([]), edits: undefined, blocks: [{ type: 'summary', text: 'Hi' }] }, [], ui!, target(), { scroll: false, pace: 0 })
    expect(shown).toBe(true)
    expect(ui!.root.querySelector('.panel')).toBeTruthy()
  })
})
