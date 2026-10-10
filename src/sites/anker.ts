/**
 * anker.com (verified 3:10 pm Oct 10 2026 against a saved copy of https://www.anker.com/; selectors come from that copy).
 * Storefront: hero banners, a stats strip, category tiles, series and scenario collections, a tabbed "Must-Have"
 * product shelf (29 cards: title, price, crossed-out price, one-line detail, product link), partner promos, a
 * membership pitch, reviews and a buying guide.
 */
import type { SiteProfile } from './types'

export const anker: SiteProfile = {
  host: 'anker.com',
  name: 'Anker',
  kind: 'storefront',
  contentRoot: ['.ipc_template', 'main'],
  region: ':scope > div, :scope > section',
  skip: '.ipc_spacer, [id="amazon_pixel"]',
  roles: [
    { role: 'hero', selector: '[data-ui-component-id="HeroBanner"], .hero-banner-carousel, [data-ui-component-id="HeroBannerSlide"]' },
    { role: 'products', selector: '.shelf-display-wrap' },
    { role: 'reviews', selector: '.evaluate-box' },
    { role: 'membership', selector: '[data-ui-component-id="MemberEquity"]' },
    { role: 'stats', heading: /no\. ?1|global customers|markets/i },
    { role: 'categories', heading: /by category|categories|shop by/i },
    { role: 'products', heading: /must-have|selections|best ?sellers|top picks|new arrivals/i },
    { role: 'reviews', heading: /from our fans|reviews|customers say/i },
    { role: 'membership', heading: /member|rewards/i },
    { role: 'article', heading: /guide|how to|what .* use\?/i },
    { role: 'promo', heading: /exclusive offers|savings|deals?|sale|%/i },
    { role: 'collection', selector: '[data-ui-component-id="MultiLayoutGraphicBlock"], [data-ui-component-id="GraphicOverlay"], .rounded-box' },
    { role: 'collection', heading: /for every moment|series|prime|nano|discover more/i },
  ],
  items: [
    {
      roles: ['products'],
      card: '.swiper-slide',
      title: 'h3',
      price: '.final-price',
      wasPrice: '.origin-price',
      detail: 'h3 + span',
      link: 'a[href*="/products/"]',
    },
    { roles: ['categories'], card: '.swiper-slide', title: 'p', link: 'a[href]' },
    { roles: ['collection', 'promo', 'article'], card: '.rounded-box, .swiper-slide', title: 'h3, h4, p', detail: 'h4', link: 'a[href]' },
  ],
  vocabulary: [
    ['macbook', 'laptop', 'notebook', '140w', '100w', '65w'],
    ['iphone', 'maggo', 'magsafe', 'qi2', 'wireless'],
    ['ipad', 'tablet'],
    ['travel', 'trip', 'flight', 'airport', 'adapter', 'portable', 'journey'],
    ['desk', 'workspace', 'monitor', 'dock', 'docking', 'hub', 'display', 'productivity'],
    ['car', 'drive', 'commute', 'road'],
    ['camera', 'gopro', 'drone'],
    ['usb-c', 'usbc', 'type-c', 'pd'],
    ['battery', 'powerbank', 'power bank', 'mah', '26k', '20k', '10k', '5k'],
    ['gaming', 'valorant', 'ps5', 'xbox', 'steam', 'switch', 'gamer'],
    ['charger', 'charging', 'gan', 'watt', 'fast'],
    ['cable', 'retractable', 'cord'],
    ['home', 'outlet', 'power strip', 'surge', 'strip'],
  ],
  policy: { promoteAfterRole: 'hero', neverHide: ['products', 'hero'] },
}
