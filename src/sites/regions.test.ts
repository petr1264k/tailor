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

// ───────────────────────────── yeti.com / patagonia.com (markup from the Oct 10 2026 rendered copies) ─────────────────────────────

const YETI_HTML = `
<main><div id="maincontent"><div class="storepage pd-components"><div class="experience-region experience-main">
  <div class="experience-component experience-yeti_layouts-bannerContainer"><div class="image-block-content">
    <div class="content-block-eyebrow">Last Chance</div><h1 class="content-block-title">PATCH PERFECT</h1>
    <div class="content-block-content">Get a free collectors’ patch with the purchase of select bags.</div><a href="/collections/featured/bags">SHOP NOW</a></div></div>
  <div class="experience-component experience-yeti_layouts-banner4column">
    <div class="lifestylecat"><div class="lifestylecat__heading">Coolers</div><a class="lifestylecat__cta" href="https://www.yeti.com/coolers">Shop Now</a></div>
    <div class="lifestylecat"><div class="lifestylecat__heading">Custom</div><a class="lifestylecat__cta" href="https://www.yeti.com/customize">Shop Now</a></div>
    <div class="lifestylecat"><div class="lifestylecat__heading">Drinkware</div><a class="lifestylecat__cta" href="https://www.yeti.com/drinkware">Shop Now</a></div>
    <div class="lifestylecat"><div class="lifestylecat__heading">Bags</div><a class="lifestylecat__cta" href="https://www.yeti.com/bags">Shop Now</a></div>
  </div>
  <div class="experience-component experience-yeti_stories_layouts-tabbedLayout"><div class="tabbed-layout-container">
    <ul class="nav nav-tabs"><li class="nav-item"><a class="nav-link active" href="#offers-tab">Offers</a></li><li class="nav-item"><a class="nav-link" href="#new-arrivals-tab">New Arrivals</a></li></ul>
    <div class="tab-content">
      <div class="tab-pane fade show active" id="offers-tab"><div class="slick-slider">
        <div class="slick-slide slick-cloned" aria-hidden="true"><div class="product-tile"><div class="pdp-link"><a class="link" href="/coolers/roadie-8.html">Roadie® 8 Hard Cooler</a></div><div class="price"><span class="sales"><span class="value">$132.00</span></span></div></div></div>
        <div class="slick-slide"><div class="product-tile"><a class="tile-image-link" href="/drinkware/bottles/21071508327.html">img</a>
          <div class="pdp-link"><a class="link" href="/drinkware/bottles/21071508327.html">Rambler® 16 oz Travel Bottle</a><div class="subline-copy">WITH COMMUTER CAP</div></div>
          <div class="price"><span><del><span class="strike-through list"><span class="value">$37.00<span class="sr-only">Price reduced from</span><span class="sr-only">to</span></span></span></del><span class="sales"><span class="value">$27.75</span></span></span></div></div></div>
        <div class="slick-slide"><div class="product-tile"><div class="pdp-link"><a class="link" href="/bags/lunch/daytrip-5l.html">Daytrip® 5L Lunch Box</a></div><div class="price"><span class="sales"><span class="value">$68.00</span></span></div></div></div>
        <div class="slick-slide"><div class="product-tile"><div class="pdp-link"><a class="link" href="/coolers/roadie-8.html">Roadie® 8 Hard Cooler</a></div><div class="price"><span class="sales"><span class="value">$132.00</span></span></div></div></div>
      </div></div>
      <div class="tab-pane fade" id="new-arrivals-tab" hidden><div class="slick-slider">
        <div class="slick-slide"><div class="product-tile"><div class="pdp-link"><a class="link" href="/drinkware/new-thing.html">Brand New Thing</a></div><div class="price"><span class="sales"><span class="value">$99.00</span></span></div></div></div>
      </div></div>
    </div></div></div>
  <div class="experience-component experience-yeti_layouts-benefitsContainer"><div class="benefits-container">
    <div class="benefits-heading">WHY BUY FROM YETI.COM?</div><div class="benefits-subheading">Buying from YETI.com comes with benefits.</div>
    <div class="benefits-list-wrapper"><ul>
      <li><div class="list-item-heading">Customization</div><div class="list-item-subtext">Make it yours. <a href="https://www.yeti.com/customize">Customize now.</a></div></li>
      <li><div class="list-item-heading">Free Shipping</div><div class="list-item-subtext">On every order over the threshold.</div></li>
    </ul></div></div></div>
  <div class="experience-component experience-yeti_assets-banner"><div class="pd-banner"><h2>BUILT FOR THE WILD®</h2><p>In 2006, we founded YETI Coolers with a simple mission: build the hard coolers we’d use every day.</p></div></div>
  <div class="experience-component experience-yeti_assets-html"><script type="application/ld+json">{"@type":"Organization"}</script></div>
</div></div></div></main>`

describe('collectRegions (yeti profile)', () => {
  it('names regions by tab label, shelf headline and top heading; reads clean prices; skips hidden panes and slick clones', () => {
    const { regions } = build(YETI_HTML, 'https://www.yeti.com/')
    expect(regions.map((r) => [r.id, r.role, r.title])).toEqual([
      ['r1', 'hero', 'PATCH PERFECT'],
      ['r2', 'categories', 'Coolers, Custom, Drinkware …'],
      ['r3', 'products', 'Offers'],
      ['r4', 'membership', 'WHY BUY FROM YETI.COM?'],
      ['r5', 'article', 'BUILT FOR THE WILD®'],
    ])
    const shelf = regions[2]!
    expect(shelf.items!.map((i) => [i.title, i.price, i.wasPrice, i.detail])).toEqual([
      ['Rambler® 16 oz Travel Bottle', '$27.75', '$37.00', 'WITH COMMUTER CAP'],
      ['Daytrip® 5L Lunch Box', '$68.00', undefined, undefined],
      ['Roadie® 8 Hard Cooler', '$132.00', undefined, undefined],
    ])
    expect(shelf.items![0]!.href).toBe('https://www.yeti.com/drinkware/bottles/21071508327.html')
    expect(regions[1]!.items!.map((i) => i.title)).toEqual(['Coolers', 'Custom', 'Drinkware', 'Bags'])
    expect(regions[3]!.items!.map((i) => [i.title, i.detail])).toEqual([
      ['Customization', 'Make it yours. Customize now.'],
      ['Free Shipping', 'On every order over the threshold.'],
    ])
  })
})

const PATAGONIA_HTML = `
<main><div class="page-wrapper is-light"><patagonia-navigation><nav><a href="/shop/mens">Men's</a> <a href="/shop/womens">Women's</a></nav></patagonia-navigation>
<div id="homepage" class="page-designer-reference"><div class="experience-region experience-main">
  <div data-pd-component-type="content.heroV2"><div class="hero hero-main v2">
    <h5 class="hero-main__overlay-info-blurb">Connor Ryan takes a base camp nap after a ski tour.</h5>
    <div class="hero-main__eyebrow">MADE FOR THE MOMENT. BUILT FOR A LIFETIME.</div><h1 class="hero-main__headline"><span>New Arrivals</span></h1>
    <p class="hero-main__subhead">Our Winter ’26 New Arrivals are made for the moments you chase.</p><a href="/shop/new-arrivals">Explore</a></div></div>
  <div data-pd-component-type="layouts.flexRow"></div>
  <div data-pd-component-type="commerce_layouts.flexRouting"><div class="swiper-wrapper">
    <div class="swiper-slide"><div class="multi-link-tile card card-tile card--router"><a class="card__block-link" href="https://www.patagonia.com/shop/collections/down-clothing/">Shop</a><div class="card__copy"><p class="copy__title">Down</p></div><div class="card__addon"><a href="/shop/womens/jackets-vests/down/">Women's</a> <a href="/shop/mens/jackets-vests/down/">Men's</a></div></div></div>
    <div class="swiper-slide"><div class="multi-link-tile card card-tile card--router"><a class="card__block-link" href="https://www.patagonia.com/shop/collections/fleece/">Shop</a><div class="card__copy"><p class="copy__title">Fleece</p></div></div></div>
    <div class="swiper-slide"><div class="multi-link-tile card card-tile card--router"><a class="card__block-link" href="https://www.patagonia.com/shop/fly-fishing/">Shop</a><div class="card__copy"><p class="copy__title">Fly Fish</p></div></div></div>
    <div class="swiper-slide"><div class="multi-link-tile card card-tile card--router"><a class="card__block-link" href="https://www.patagonia.com/shop/collections/nano-air/">Shop</a><div class="card__copy"><p class="copy__title">Nano-Air®</p></div></div></div>
  </div></div>
  <div data-pd-component-type="einstein.einsteinCarousel"><h2 class="grid-product-tiles__header-title">Recently Viewed</h2><div class="product-tile skeleton"></div></div>
  <div data-pd-component-type="content.heroV2"><div class="hero hero-main v2"><h1 class="hero-main__headline"><span>11.2 Million Vote Project</span></h1><p class="hero-main__subhead">11.2M environmental voters skipped the last election. Together, we can change that.</p><a href="/elections/">Join Us</a></div></div>
  <div data-pd-component-type="dynamic_content.dynamiccontentcarousel"><h2 class="slider-cards__header-title"><span>Latest Stories</span><span class="slider-cards__header-count">View All</span></h2><div class="swiper-wrapper">
    <div class="swiper-slide"><div class="card card-tile card--article-content"><a class="card__link-full" href="/stories/planet/activism/a-letter-from-yvon-chouinard/story-123.html"></a><div class="card__title"><span>A Letter from Yvon Chouinard</span></div><div class="card__meta-tags">Yvon Chouinard</div><div class="card__blurb"><p>Earth is now our only shareholder.</p></div></div></div>
    <div class="swiper-slide"><div class="card card-tile card--article-content"><a class="card__link-full" href="/stories/sports/climbing/the-highhug-route/story-124.html"></a><div class="card__title"><span>The HighHug Route</span></div><div class="card__meta-tags">Leath Tonino</div><div class="card__blurb"><p>Nine years in the making.</p></div></div></div>
    <div class="swiper-slide"><div class="card card-tile card--article-content"><a class="card__link-full" href="/stories/product/guides/down-vs-nano/story-125.html"></a><div class="card__title"><span>Down Sweater™ vs. Nano Puff® Jackets</span></div><div class="card__meta-tags">MaiLee Hung</div><div class="card__blurb"><p>These insulated midlayers differ in important ways.</p></div></div></div>
  </div></div>
</div></div>
<div class="content-asset"><div class="container themed"><div class="row">
  <div class="col-8 col-lg"><img alt=""><p class="h4">We guarantee everything we make.</p><a href="https://help.patagonia.com/s/article/Ironclad-Guarantee">View Ironclad Guarantee</a></div>
  <div class="col-8 col-lg"><img alt=""><p class="h4">We take responsibility for our impact.</p><a href="/our-footprint/">Explore Our Footprint</a></div>
  <div class="col-8 col-lg"><img alt=""><p class="h4">We keep your gear in play.</p><a href="https://wornwear.patagonia.com/">Visit Worn Wear</a></div>
</div></div></div>
<footer class="footer"><p>© 2026 Patagonia, Inc. All Rights Reserved.</p></footer>
</div></main>`

describe('collectRegions (patagonia profile)', () => {
  it('titles the hero by its h1 (not the h5 caption), reads routers, stories and the values strip, skips the empty recommender', () => {
    const { regions } = build(PATAGONIA_HTML, 'https://www.patagonia.com/home/')
    expect(regions.map((r) => [r.id, r.role, r.title])).toEqual([
      ['r1', 'hero', 'New Arrivals'],
      ['r2', 'categories', 'Down, Fleece, Fly Fish …'],
      ['r3', 'article', '11.2 Million Vote Project'],
      ['r4', 'article', 'Latest Stories'],
      ['r5', 'stats', 'We guarantee everything we make., We take responsibility for our impact., We keep your gear in play.'],
    ])
    expect(regions[1]!.items!.map((i) => [i.title, i.href])).toEqual([
      ['Down', 'https://www.patagonia.com/shop/collections/down-clothing/'],
      ['Fleece', 'https://www.patagonia.com/shop/collections/fleece/'],
      ['Fly Fish', 'https://www.patagonia.com/shop/fly-fishing/'],
      ['Nano-Air®', 'https://www.patagonia.com/shop/collections/nano-air/'],
    ])
    expect(regions[3]!.items!.map((i) => [i.title, i.detail])).toEqual([
      ['A Letter from Yvon Chouinard', 'Earth is now our only shareholder.'],
      ['The HighHug Route', 'Nine years in the making.'],
      ['Down Sweater™ vs. Nano Puff® Jackets', 'These insulated midlayers differ in important ways.'],
    ])
    expect(regions[3]!.items![0]!.href).toBe('https://www.patagonia.com/stories/planet/activism/a-letter-from-yvon-chouinard/story-123.html')
    expect(regions[4]!.items!.map((i) => i.title)).toEqual(['We guarantee everything we make.', 'We take responsibility for our impact.', 'We keep your gear in play.'])
  })

  it('siteProfileFor knows yeti.com and patagonia.com', () => {
    expect(siteProfileFor('https://www.yeti.com/').name).toBe('YETI')
    expect(siteProfileFor('https://www.patagonia.com/home/').name).toBe('Patagonia')
    expect(siteProfileFor('https://www.yeti.ca/')).toBe(generic)
  })
})

describe('region titles (generic profile)', () => {
  it('prefers the top-level heading over an earlier lower one', () => {
    const html = `<main><section>
      <div class="card"><a href="/p/1"><h3>Trail Pack 30L</h3><p>Light and tough, carries a week of food.</p></a></div>
      <h2>Best sellers this week</h2>
      <div class="card"><a href="/p/2"><h3>Rain Shell</h3><p>Packs into its own pocket for the trail.</p></a></div>
      <div class="card"><a href="/p/3"><h3>Water Filter</h3><p>Two litres a minute, no pumping.</p></a></div>
    </section></main>`
    const { regions } = build(html, 'https://shop.example.com/')
    expect(regions[0]!.title).toBe('Best sellers this week')
  })
})
