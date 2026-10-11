import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectSegments, resolveSegment, segmentText } from './segments'

function dom(body: string): Document {
  document.body.innerHTML = body
  return document
}

describe('collectSegments', () => {
  it('numbers headings, paragraphs and list items in document order and skips nav, footer and aria-hidden', () => {
    const doc = dom(`
      <nav><a href="/">Home</a><p>Navigation paragraph long enough</p></nav>
      <main>
        <h1>Big Title</h1>
        <p>First paragraph with enough text.</p>
        <ul><li>First item in the list</li><li>Second item in the list</li></ul>
        <p aria-hidden="true">Decorative duplicate text here</p>
        <p>tiny</p>
      </main>
      <footer><p>Footer legal text that is long</p></footer>`)
    const { segments, elements } = collectSegments(doc)
    expect(segments.map((s) => [s.id, s.tag, s.text])).toEqual([
      ['s1', 'h1', 'Big Title'],
      ['s2', 'p', 'First paragraph with enough text.'],
      ['s3', 'li', 'First item in the list'],
      ['s4', 'li', 'Second item in the list'],
    ])
    expect(elements.get('s1')?.tagName).toBe('H1')
    expect(elements.get('s3')?.textContent).toBe('First item in the list')
  })

  it('reads the screen-reader copy of an animated heading once (coframe.com word spans)', () => {
    const doc = dom(`<h1><span class="sr-only">What if your website optimized itself?</span>
      <span aria-hidden="true" class="cf-le">What</span> <span aria-hidden="true" class="cf-le">if</span></h1>`)
    expect(collectSegments(doc).segments[0]?.text).toBe('What if your website optimized itself?')
  })

  it('falls back to the full text when everything inside is aria-hidden', () => {
    const doc = dom(`<p><span aria-hidden="true">Only hidden words here, long enough</span></p>`)
    expect(segmentText(doc.body.firstElementChild!)).toBe('Only hidden words here, long enough')
  })

  it('takes the inner element, never the wrapper: li > p, div > p, div > div', () => {
    const doc = dom(`
      <div class="card"><div class="body"><p>Paragraph inside two divs.</p></div></div>
      <ul><li><p>Paragraph inside a list item.</p></li></ul>
      <div class="leaf">A Tailwind text leaf with <b>inline</b> children only.</div>
      <div class="wrap"><div>Inner text leaf of a wrapper div.</div></div>`)
    const { segments } = collectSegments(doc)
    expect(segments.map((s) => `${s.tag}:${s.text}`)).toEqual([
      'p:Paragraph inside two divs.',
      'p:Paragraph inside a list item.',
      'div:A Tailwind text leaf with inline children only.',
      'div:Inner text leaf of a wrapper div.',
    ])
  })

  it('skips invisible elements, code, buttons and our own hosts', () => {
    const doc = dom(`
      <p style="display:none">Hidden by inline style, long enough</p>
      <div style="visibility:hidden"><p>Inside an invisible parent, long enough</p></div>
      <pre><p>code block paragraph long enough</p></pre>
      <button><p>Button paragraph long enough</p></button>
      <tailor-note><p>Our own inserted note, long enough</p></tailor-note>
      <p>The one visible paragraph.</p>`)
    expect(collectSegments(doc).segments.map((s) => s.text)).toEqual(['The one visible paragraph.'])
  })

  it('skips elements whose text is all links or buttons; prose that merely contains a link stays', () => {
    const doc = dom(`
      <div class="actions"><a href="/signin">Sign in</a><a href="/demo">Get a demo</a></div>
      <ul><li><a href="/a">Experiment ideas</a></li><li><a href="/b">Design variations</a></li></ul>
      <p>Read the <a href="/docs">docs</a> before you start building.</p>
      <a href="/card"><h3>Card title inside a link</h3></a>`)
    expect(collectSegments(doc).segments.map((s) => `${s.tag}:${s.text}`)).toEqual([
      'p:Read the docs before you start building.',
      'h3:Card title inside a link',
    ])
  })

  it('resolveSegment returns the remembered element while connected, else re-finds it by tag and text', () => {
    const doc = dom(`<p>Stable paragraph text here.</p>`)
    const { segments, elements } = collectSegments(doc)
    const seg = segments[0]!
    const el = elements.get(seg.id)!
    expect(resolveSegment(doc, seg, el)).toBe(el)
    doc.body.innerHTML = `<section><p>Stable paragraph text here.</p></section>`
    const found = resolveSegment(doc, seg, el)
    expect(found).not.toBe(el)
    expect(found?.textContent).toBe('Stable paragraph text here.')
    doc.body.innerHTML = `<p>Something else entirely now.</p>`
    expect(resolveSegment(doc, seg, el)).toBeNull()
  })

  const coframe = 'demo/pages/4-coframe.html'
  it.skipIf(!existsSync(coframe))('finds the headings of the saved coframe.com homepage', () => {
    const html = readFileSync(coframe, 'utf8')
    const body = html.slice(html.indexOf('<body'))
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '')
    const { segments } = collectSegments(document)
    const texts = segments.map((s) => s.text)
    expect(texts).toContain('Maximize revenue from the demand you already have.')
    expect(texts).toContain('What if your website optimized itself?')
    expect(texts.some((t) => t.includes('Manual research, design, and testing.'))).toBe(true)
    expect(texts.filter((t) => t === 'Maximize revenue from the demand you already have.')).toHaveLength(1)
    expect(segments.length).toBeGreaterThan(20)
    expect(segments.length).toBeLessThanOrEqual(220)
  })
})

describe('isVisible without checkVisibility (jsdom, saved demo copies)', () => {
  it('treats a `hidden` ancestor like display:none, so an inactive tab pane marked by demo/scan-page.sh is skipped', () => {
    const doc = dom(`
      <div id="offers"><p>Rambler 16 oz Travel Bottle with commuter cap, now a quarter off.</p></div>
      <div id="new" hidden><p>Brand New Thing arriving next week, sign up to be notified first.</p></div>
      <div id="inline" style="display:none"><p>Mobile-only quick links to every category on the site.</p></div>`)
    const texts = collectSegments(doc).segments.map((s) => s.text)
    expect(texts.some((t) => t.startsWith('Rambler 16 oz'))).toBe(true)
    expect(texts.some((t) => t.startsWith('Brand New Thing'))).toBe(false)
    expect(texts.some((t) => t.startsWith('Mobile-only'))).toBe(false)
  })
})
