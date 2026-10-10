import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAgentHooks } from '@/share/hooks'
import { extractPageContent } from './extract'

// share.readAgentHooks may still be a TODO stub; control it here so these tests do not depend on it.
vi.mock('@/share/hooks', () => ({ readAgentHooks: vi.fn(() => null) }))

const URL_ = 'https://shop.example.com/tv/qn90d?ref=home#reviews'

const para = (s: string) => `<p>${s} ${'This television is built for living rooms and game nights alike. '.repeat(3)}</p>`

const TV_PAGE = `<!doctype html>
<html lang="en-US">
<head>
  <title>Samsung 65" QN90D Neo QLED 4K TV | Example Shop</title>
  <style>.hero { color: red }</style>
  <script type="application/ld+json">{"@type":"Product","name":"QN90D","offers":{"price":"1299.99","priceCurrency":"USD"}}</script>
  <script type="application/ld+json">{ this is broken json </script>
  <script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"Organization","name":"Example Shop"}]</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/tv">TVs</a> <a href="mailto:help@example.com">Email us</a> <a href="javascript:void(0)">Menu</a></nav>
  <main>
    <article>
      <h1>Samsung 65" QN90D Neo QLED 4K TV</h1>
      ${para('Four HDMI 2.1 ports support 4K at 120Hz, so a PS5 or Xbox Series X runs at full frame rate.')}
      ${para('The price is $1,299.99 with free delivery in the contiguous US.')}
      ${para('Anti-glare screen and Neural Quantum Processor 4K for bright rooms.')}
      ${para('Game Mode lowers input lag and supports VRR and AMD FreeSync Premium Pro.')}
      <p><a href="/tv/qn90d/specs">Full specifications</a> <a href="https://shop.example.com/cart">Add to cart</a>
         <a href="/cart"></a> <a href="#reviews">Reviews</a></p>
    </article>
  </main>
  <script>window.trackingPixel = "do-not-include"</script>
  <noscript>Enable JavaScript please</noscript>
</body>
</html>`

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('extractPageContent', () => {
  beforeEach(() => {
    vi.mocked(readAgentHooks).mockReset().mockReturnValue(null)
  })

  it('extracts a long article with Readability, JSON-LD, links and lang', () => {
    const doc = parse(TV_PAGE)
    const before = doc.body.innerHTML
    const c = extractPageContent(doc, URL_)

    expect(doc.body.innerHTML).toBe(before) // Readability ran on a clone
    expect(c.url).toBe(URL_)
    expect(c.source).toBe('readability')
    expect(c.title).toContain('QN90D')
    expect(c.text).toContain('HDMI 2.1 ports support 4K at 120Hz')
    expect(c.text).toContain('$1,299.99')
    expect(c.lang).toBe('en-US')

    // Visible text: page words yes, script/style/noscript no.
    expect(c.visibleText).toContain('Neural Quantum Processor')
    expect(c.visibleText).not.toContain('trackingPixel')
    expect(c.visibleText).not.toContain('color: red')
    expect(c.visibleText).not.toContain('Enable JavaScript')

    // JSON-LD: one object + an array of two, broken block ignored.
    expect(c.jsonLd).toHaveLength(3)
    expect(c.jsonLd[0]).toMatchObject({ '@type': 'Product', name: 'QN90D' })

    // Links: resolved, http(s) only, unique, labeled occurrence wins.
    const hrefs = c.links.map((l) => l.href)
    expect(hrefs).toContain('https://shop.example.com/')
    expect(hrefs).toContain('https://shop.example.com/tv/qn90d/specs')
    expect(hrefs).toContain('https://shop.example.com/tv/qn90d?ref=home#reviews')
    expect(hrefs.some((h) => h.startsWith('mailto:') || h.startsWith('javascript:'))).toBe(false)
    expect(hrefs.filter((h) => h === 'https://shop.example.com/cart')).toHaveLength(1)
    expect(c.links.find((l) => l.href === 'https://shop.example.com/cart')?.text).toBe('Add to cart')

    expect(c.agentHooks).toBeUndefined()
  })

  it('falls back to raw body text when Readability finds too little', () => {
    const c = extractPageContent(parse('<html><head><title>Tiny</title></head><body><p>Just a line.</p></body></html>'), 'https://x.test/')
    expect(c.source).toBe('raw')
    expect(c.text).toBe('Just a line.')
    expect(c.visibleText).toBe('Just a line.')
    expect(c.title).toBe('Tiny')
    expect(c.lang).toBeUndefined()
    expect(c.jsonLd).toEqual([])
    expect(c.links).toEqual([])
  })

  it('degrades gracefully while share.readAgentHooks is a TODO stub', () => {
    vi.mocked(readAgentHooks).mockImplementation(() => {
      throw new Error('TODO(share.readAgentHooks) — see CONTEXT.txt')
    })
    expect(extractPageContent(parse(TV_PAGE), URL_).agentHooks).toBeUndefined()
  })

  it('attaches agent hooks when the page offers them', () => {
    vi.mocked(readAgentHooks).mockReturnValue({ markdownUrl: 'https://shop.example.com/tv/qn90d.md' })
    expect(extractPageContent(parse(TV_PAGE), URL_).agentHooks).toEqual({ markdownUrl: 'https://shop.example.com/tv/qn90d.md' })
  })
})
