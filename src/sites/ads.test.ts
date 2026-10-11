import { describe, expect, it } from 'vitest'
import { collectSegments } from '@/tailor/segments'
import { adContainerOf, isAdIframe, isOutsideAd, outsideAdIds } from './ads'
import { generic } from './generic'
import { collectRegions } from './regions'

const URL_ = 'https://shop.example.com/'
const filler = 'Everything for your desk, delivered tomorrow, with free returns for thirty days. '

const PAGE = `
  <main>
    <section id="hero"><h1>Example Shop</h1><p>${filler.repeat(2)}</p></section>
    <section id="news"><h2>News</h2><p>Our new store opens in Austin this fall, come and visit us there.</p><p>Join the newsletter for weekly picks and offers from us, straight to your inbox.</p></section>
    <div id="slot" class="ad-slot"><p>Advertisement</p><iframe src="https://securepubads.g.doubleclick.net/gampad/ads?iu=1"></iframe></div>
    <section id="sponsored"><span class="label">Sponsored</span><h3>Acme VPN keeps you safe online</h3><p>Try Acme VPN free for 30 days and browse without limits from anywhere.</p></section>
    <section id="native" class="taboola-feed"><h3>Promoted stories</h3><p>You will not believe what this tiny gadget does for your kitchen counter.</p></section>
    <section id="reviews"><h2>What customers say</h2><p>Five stars, the stand arrived a day early and feels solid on my desk.</p></section>
  </main>`

function setup(html = PAGE) {
  document.body.innerHTML = html
  const segmented = collectSegments(document)
  const map = collectRegions(document, segmented.segments, segmented.elements, generic, URL_)
  return { segmented, map }
}

const byId = (id: string) => document.getElementById(id)!

describe('outside ads', () => {
  it('ad markup, an ad-network iframe and a "Sponsored" label mark an ad; the site\'s own news and reviews do not', () => {
    setup()
    expect(isOutsideAd(byId('slot'))).toBe(true)
    expect(isOutsideAd(byId('slot').querySelector('p')!)).toBe(true)
    expect(isOutsideAd(byId('sponsored').querySelector('p')!)).toBe(true)
    expect(adContainerOf(byId('sponsored').querySelector('p')!)).toBe(byId('sponsored'))
    expect(isOutsideAd(byId('native').querySelector('p')!)).toBe(true)
    expect(isOutsideAd(byId('news'))).toBe(false)
    expect(isOutsideAd(byId('news').querySelector('p')!)).toBe(false)
    expect(isOutsideAd(byId('hero'))).toBe(false)
    expect(isOutsideAd(byId('reviews'))).toBe(false)
  })

  it('a label alone does not turn a whole long section into an ad', () => {
    setup(`<main><section id="long"><span>Sponsored</span><h2>Guide</h2><p>${filler.repeat(12)}</p></section></main>`)
    expect(isOutsideAd(byId('long').querySelector('p')!)).toBe(false)
  })

  it('isAdIframe keys off the host or the Ad Manager id, never the site\'s own iframes', () => {
    document.body.innerHTML = `
      <iframe id="a" src="https://tpc.googlesyndication.com/safeframe/1-0-40/html/container.html"></iframe>
      <iframe id="b" src="https://www.youtube.com/embed/xyz"></iframe>
      <iframe id="google_ads_iframe_123" src="about:blank"></iframe>
      <iframe id="c"></iframe>`
    expect(isAdIframe(byId('a'))).toBe(true)
    expect(isAdIframe(byId('b'))).toBe(false)
    expect(isAdIframe(byId('google_ads_iframe_123'))).toBe(true)
    expect(isAdIframe(byId('c'))).toBe(false)
  })

  it('outsideAdIds lists ad regions with their segments, and ad segments elsewhere, never the site\'s own content', () => {
    const { segmented, map } = setup()
    const ids = outsideAdIds(document, segmented.elements, map.elements, map.regions)
    const regionById = new Map(map.regions.map((r) => [r.id, r]))
    const adRegions = map.regions.filter((r) => ids.includes(r.id))
    expect(adRegions.map((r) => map.elements.get(r.id)!.id).sort()).toEqual(['native', 'slot', 'sponsored'])
    for (const r of adRegions) for (const s of r.segmentIds) expect(ids).toContain(s)
    const own = map.regions.filter((r) => ['hero', 'news', 'reviews'].includes(map.elements.get(r.id)!.id))
    expect(own).toHaveLength(3)
    for (const r of own) {
      expect(ids).not.toContain(r.id)
      for (const s of r.segmentIds) expect(ids).not.toContain(s)
    }
    expect(regionById.size).toBe(map.regions.length)
  })

  it('a region titled as an ad counts even when it is long', () => {
    const { segmented, map } = setup(`<main><section id="big"><h2>Sponsored content</h2><p>${filler.repeat(12)}</p></section><section id="own"><h2>Our story</h2><p>${filler.repeat(2)}</p></section></main>`)
    const ids = outsideAdIds(document, segmented.elements, map.elements, map.regions)
    const big = map.regions.find((r) => map.elements.get(r.id)!.id === 'big')!
    const own = map.regions.find((r) => map.elements.get(r.id)!.id === 'own')!
    expect(ids).toContain(big.id)
    expect(ids).not.toContain(own.id)
  })
})
