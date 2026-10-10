import { describe, expect, it } from 'vitest'
import { collectSegments } from '@/tailor/segments'
import { anker, collectRegions, generic, regionIds, regionOf, regionPromptLines, repeatedCards, siteProfileFor } from './index'

const STORE_HTML = `
<main><div class="ipc_template">
  <div data-ui-component-id="HeroBanner"><h2>Fall Savings Start Now</h2><p>Save up to 50% on select favorites.</p><a href="/sale">Shop</a></div>
  <div class="ipc_spacer"></div>
  <div><h2>The World's No. 1 Mobile Charging Brand</h2><p>Available in 146 Markets</p></div>
  <div><div class="shelf-display-wrap"><h2>Must-Have Selections</h2><div class="swiper-wrapper">
    <div class="swiper-slide !flex"><a href="/products/a1">img</a><h3>Nano Charger (45W, Smart Display)</h3><span>Smart iPhone Recognition</span><div class="final-price">$29.99</div><div class="origin-price">$39.99</div></div>
    <div class="swiper-slide"><a href="/products/a2">img</a><h3>Laptop Power Bank (25K, 165W)</h3><span>Charges a MacBook Pro</span><div class="final-price">$129.99</div></div>
    <div class="swiper-slide"><a href="/products/a3">img</a><h3>Prime Charger (250W, 6 Ports)</h3><span>Six ports</span><div class="final-price">$169.99</div></div>
    <div class="swiper-slide"><a href="/products/a1">img</a><h3>Nano Charger (45W, Smart Display)</h3><span>duplicate for mobile</span><div class="final-price">$29.99</div></div>
  </div></div></div>
  <div data-ui-component-id="MemberEquity"><h2>Become a member today</h2><p>Earn points on every purchase you make.</p></div>
  <div class="evaluate-box"><h2>Straight From Our Fans</h2><p>Thousands of five-star reviews from happy customers.</p></div>
</div></main>`

function build(html: string, url: string) {
  document.body.innerHTML = html
  const { segments, elements } = collectSegments(document)
  return collectRegions(document, segments, elements, siteProfileFor(url), url)
}

describe('siteProfileFor', () => {
  it('matches the host and its subdomains, else the generic profile', () => {
    expect(siteProfileFor('https://www.anker.com/')).toBe(anker)
    expect(siteProfileFor('https://us.anker.com/products/x')).toBe(anker)
    expect(siteProfileFor('https://notanker.com/')).toBe(generic)
    expect(siteProfileFor('not a url')).toBe(generic)
  })
})

describe('collectRegions (anker profile)', () => {
  it('finds regions in order, assigns roles by selector and heading, skips spacers', () => {
    const { regions } = build(STORE_HTML, 'https://www.anker.com/')
    expect(regions.map((r) => [r.id, r.role, r.title])).toEqual([
      ['r1', 'hero', 'Fall Savings Start Now'],
      ['r2', 'stats', "The World's No. 1 Mobile Charging Brand"],
      ['r3', 'products', 'Must-Have Selections'],
      ['r4', 'membership', 'Become a member today'],
      ['r5', 'reviews', 'Straight From Our Fans'],
    ])
  })

  it('reads product cards (title, price, was-price, detail, absolute link), dedupes responsive copies, maps segments', () => {
    const { regions, elements } = build(STORE_HTML, 'https://www.anker.com/')
    const shelf = regions[2]!
    expect(shelf.items).toHaveLength(3)
    expect(shelf.items![0]).toMatchObject({
      id: 'i1',
      title: 'Nano Charger (45W, Smart Display)',
      price: '$29.99',
      wasPrice: '$39.99',
      detail: 'Smart iPhone Recognition',
      href: 'https://www.anker.com/products/a1',
    })
    expect(shelf.items![1]!.wasPrice).toBeUndefined()
    expect(shelf.items![0]!.segmentIds.length).toBeGreaterThan(0)
    expect(shelf.segmentIds).toEqual(expect.arrayContaining(shelf.items![0]!.segmentIds))
    expect(elements.get('i1')?.classList.contains('swiper-slide')).toBe(true)
    expect(elements.get('r3')?.querySelector('.shelf-display-wrap')).not.toBeNull()
  })

  it('exposes ids, region lookup and prompt lines', () => {
    const { regions } = build(STORE_HTML, 'https://www.anker.com/')
    expect([...regionIds(regions)]).toEqual(expect.arrayContaining(['r1', 'r3', 'i1', 'i3']))
    expect(regionOf('i2', regions)?.id).toBe('r3')
    expect(regionOf('r4', regions)?.role).toBe('membership')
    expect(regionOf('s1', regions)).toBeNull()
    const lines = regionPromptLines(regions)
    expect(lines[2]).toContain('r3 | products | Must-Have Selections | items: i1 Nano Charger (45W, Smart Display) — $29.99 (was $39.99) — Smart iPhone Recognition;')
    expect(lines[0]).toMatch(/^r1 \| hero \| Fall Savings Start Now \| s\d+–s\d+$/)
  })
})

describe('collectRegions (generic profile)', () => {
  it('uses main > * as regions, finds cards by shape and prices by pattern', () => {
    const html = `
      <header><nav><a href="/">Home</a></nav></header>
      <main>
        <section><h1>Welcome to the shop</h1><p>Everything you need for the trail.</p></section>
        <section><h2>Best sellers</h2><ul>
          <li class="card"><a href="/p/1"><h3>Trail Pack 30L</h3><p>Light and tough. $89.00</p></a></li>
          <li class="card"><a href="/p/2"><h3>Rain Shell</h3><p>Packs into its pocket. $120.00</p></a></li>
          <li class="card"><a href="/p/3"><h3>Water Filter</h3><p>Two litres a minute. $35.50</p></a></li>
        </ul></section>
        <section><h2>What customers say</h2><p>Five stars from thousands of hikers.</p></section>
      </main>
      <footer><p>© Shop</p></footer>`
    const { regions } = build(html, 'https://shop.example.com/')
    expect(regions.map((r) => [r.id, r.role])).toEqual([
      ['r1', 'hero'],
      ['r2', 'products'],
      ['r3', 'reviews'],
    ])
    expect(regions[1]!.items!.map((i) => [i.title, i.price, i.href])).toEqual([
      ['Trail Pack 30L', '$89.00', 'https://shop.example.com/p/1'],
      ['Rain Shell', '$120.00', 'https://shop.example.com/p/2'],
      ['Water Filter', '$35.50', 'https://shop.example.com/p/3'],
    ])
  })

  it('repeatedCards needs three alike siblings that each carry a link and text', () => {
    document.body.innerHTML = `<div id="x"><div class="c"><a href="/a">Alpha item</a></div><div class="c"><a href="/b">Beta item</a></div><div class="other">no</div></div>`
    expect(repeatedCards(document.getElementById('x')!)).toEqual([])
    document.body.innerHTML = `<div id="y"><div class="c"><a href="/a">Alpha item</a></div><div class="c"><a href="/b">Beta item</a></div><div class="c"><a href="/c">Gamma item</a></div></div>`
    expect(repeatedCards(document.getElementById('y')!)).toHaveLength(3)
  })

  it('returns no regions for a page without content containers', () => {
    const { regions } = build('<p>Just one line of text here.</p>', 'https://example.com/')
    expect(regions).toEqual([])
  })
})
