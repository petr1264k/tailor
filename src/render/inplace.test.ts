import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fact, PageEdit, PageSegment, TailoredPage } from '@/types'
import { collectSegments, resolveSegment } from '@/tailor/segments'
import { mountTailorButton, renderFromSite, renderTailored, showOriginal, showTailored, type RenderCallbacks, type TailorUi } from './index'
import { foldTargets } from './inplace'

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

  it('a hide folds the whole exclusive section (image included) and leaves a stub; Show/Hide report expand/collapse', () => {
    const { onInteraction } = setup()
    renderTailored(page([{ op: 'hide', ids: [byText('Loved'), byText('Thousands')], label: 'Customer praise', reason: 'you skip marketing' }]), [], ui!, target())
    const section = document.getElementById('praise')!
    expect(section.style.getPropertyValue('display')).toBe('none')
    expect(section.style.getPropertyPriority('display')).toBe('important')
    const stub = hosts('tailor-fold')[0]!
    expect(stub.nextElementSibling).toBe(section)
    expect(inShadow(stub, '.label').textContent).toBe('Hidden: Customer praise — you skip marketing')
    const toggle = inShadow<HTMLButtonElement>(stub, '.toggle')
    toggle.click()
    expect(section.style.getPropertyValue('display')).toBe('')
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'expand', blockType: 'hidden', factIds: [] })
    expect(toggle.textContent).toBe('Hide')
    toggle.click()
    expect(section.style.getPropertyValue('display')).toBe('none')
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'collapse', blockType: 'hidden', factIds: [] })
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

  it('a note goes right after its anchor; a note on a list item goes after the list; ✕ reports ignore', () => {
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
    expect(document.getElementById('intro')!.nextElementSibling).toBe(notes[0])
    expect(document.getElementById('list')!.nextElementSibling).toBe(notes[1])
    expect(inShadow(notes[0]!, '.kicker').textContent).toBe('For you')
    expect(inShadow(notes[0]!, '.text').textContent).toBe('Works with your PS5 at 120Hz.')
    expect(inShadow(notes[1]!, '.note').classList.contains('is-warn')).toBe(true)
    expect(inShadow(notes[1]!, '.kicker').textContent).toBe('Heads up')
    expect(inShadow(notes[0]!, 'tailor-why')).toBeTruthy()
    inShadow<HTMLButtonElement>(notes[1]!, '.dismiss').click()
    expect(notes[1]!.hidden).toBe(true)
    // The host has its own display rule, so the shadow stylesheet must hide the host itself, not just its children.
    expect(inShadow(notes[1]!, 'style').textContent).toContain(':host([hidden])')
    expect(onInteraction).toHaveBeenLastCalledWith({ kind: 'ignore', blockType: 'warning', factIds: ['f1'] })
  })

  it('a note anchored inside a hidden part lands after the stub, not inside the hidden section', () => {
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
    const stub = hosts('tailor-fold')[0]!
    const note = hosts('tailor-note')[0]!
    expect(stub.nextElementSibling).toBe(note)
    expect(document.getElementById('praise')!.contains(note)).toBe(false)
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
    expect(hosts('tailor-fold')).toHaveLength(1)
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

  it('the site reply is inserted under the headline as plain text with numbers marked as claims', () => {
    setup()
    renderTailored(page([{ op: 'rewrite', id: byText('Maximize'), text: 'New.' }]), [], ui!, target())
    const evil = 'Thanks! <img src=x onerror=alert(1)> We can go live in 2 weeks for $1,299.'
    renderFromSite(ui!, evil, 'https://www.coframe.com/_cf/agent-request')
    expect(document.querySelectorAll('img:not([alt=""])')).toHaveLength(0)
    const host = hosts('tailor-note')[0]!
    expect(document.querySelector('h1')!.nextElementSibling).toBe(host)
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
