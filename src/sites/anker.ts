/**
 * anker.com (verified 5:40 pm Oct 10 2026 against a rendered copy of https://www.anker.com/, demo/pages/5-anker.html,
 * saved with demo/scan-page.sh after a full scroll; first verified 3:10 pm against an HTML-only copy).
 * Next.js storefront: `main > .ipc_template` holds the page, top to bottom: three hero banners (Fall Savings, MagGo
 * power bank, Valorant, USB-C hub), a stats strip (No. 1 brand, 146 markets), a two-tile collection (Pack Light /
 * Smart Display charger), seven category tiles, the flagship-series intro, two series tiles (Prime, Nano), four
 * scenario tiles (Apple, On the Go, Workspace, Home), the tabbed "Must-Have Anker Selections" shelf (29 cards: title,
 * price, crossed-out price, one-line detail, product link), the Anker Innovations tile (eufy), a "Shop With Confidence"
 * strip, the member-perks block (fast free delivery, warranty, support), five exclusive-offer tiles (newsletter,
 * corporate, refurbished, referral, education), five reviews, and five blog cards. 17 regions, 60 cards, 29 priced.
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
    { role: 'stats', heading: /no\. ?1|global customers|markets|shop with confidence|warranty/i },
    { role: 'categories', heading: /by category|categories|shop by/i },
    { role: 'products', heading: /must-have|selections|best ?sellers|top picks|new arrivals/i },
    { role: 'reviews', heading: /from our fans|reviews|customers say/i },
    { role: 'membership', heading: /member|rewards/i },
    { role: 'article', heading: /guide|how to|what .* use\?|blogs?|updates|stories/i },
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
    ['travel adapter', 'universal charger', 'international', 'countries', 'plugs', 'europe', 'uk', 'abroad', 'overseas'],
    ['samsung', 'galaxy', 'android', 'pixel', 'oneplus'],
    ['airpods', 'apple watch', 'watch', 'earbuds', '3-in-1', '3 in 1', 'charging station', 'nightstand', 'bedside'],
    ['eufy', 'security camera', 'doorbell', 'robot vacuum', 'vacuum', 'baby monitor', 'smart home', 'smart lock'],
    ['soundcore', 'headphones', 'earbuds', 'speaker', 'speakers', 'audio', 'music', 'podcast', 'podcasts'],
    ['solix', 'solar', 'solar generator', 'power station', 'outage', 'blackout', 'camping', 'rv', 'van', 'off-grid', 'outdoors', 'outdoor'],
    ['nebula', 'projector', 'movie', 'movies', 'home theater', 'tv'],
    ['education', 'student', 'students', 'college', 'university', 'school', 'teacher', 'campus'],
    ['corporate', 'bulk', 'business', 'team', 'office', 'employees', 'company', 'startup'],
    ['refurbished', 'budget', 'cheap', 'cheaper', 'deal', 'deals', 'sale', 'discount', 'savings', 'save', 'price', 'afford'],
    ['warranty', 'reliable', 'safe', 'safety', 'overheat', 'overheating', 'durable', 'quality'],
  ],
  policy: { promoteAfterRole: 'hero', neverHide: ['products', 'hero'] },
}
