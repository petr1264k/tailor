/**
 * patagonia.com (verified 5:40 pm Oct 10 2026 against a rendered copy of https://www.patagonia.com/home/,
 * demo/pages/7-patagonia.html, saved with demo/scan-page.sh --headed: Akamai serves a "Sit tight" failover page to
 * headless Chrome and to curl).
 * Salesforce Commerce Cloud Page Designer storefront with a strong editorial side. The home page is
 * `main > .page-wrapper`: the navigation custom element, `#homepage.page-designer-reference > .experience-main` with ten
 * `data-pd-component-type` blocks (hero "New Arrivals", an empty flex row, the category router (Down, Fleece, Fly Fish,
 * Nano-Air, Black Hole Bags, Kids' & Baby, Provisions, Books: each card links to Women's / Men's / Kids' / Explore), an
 * empty router, the Einstein "Recently Viewed" shelf (skeleton for a new visitor), an html block, the "11.2 Million
 * Vote Project" campaign hero, an empty hero, the activities router (Climbing, Trail Running, Surfing) and the "Latest
 * Stories" carousel (8 story cards with author and blurb)), then a `.content-asset` values strip (guarantee,
 * responsibility, activism, Worn Wear, 1% for the Planet) and the footer. Empty blocks drop out by themselves.
 */
import type { SiteProfile } from './types'

export const patagonia: SiteProfile = {
  host: 'patagonia.com',
  name: 'Patagonia',
  kind: 'storefront',
  contentRoot: ['main > .page-wrapper', 'main'],
  region: '.page-designer-reference > .experience-main > div, .page-wrapper > .content-asset',
  // The recommender shelf is a skeleton until the visitor has browsed; the html block is script only.
  skip: '[data-pd-component-type="einstein.einsteinCarousel"], [data-pd-component-type="content.htmlblock"]',
  // The hero puts a photo caption (h5) before its h1; the stories header carries a "View All" count in a second span.
  title: '.hero-main__headline, .slider-cards__header-title > span:first-child, .grid-product-tiles__header-title',
  roles: [
    { role: 'article', heading: /vote|activism|letter|planet|climate|petition|stories|journal|films?|podcast/i },
    { role: 'hero', selector: '.hero-main' },
    { role: 'products', selector: '.product-tile' },
    { role: 'categories', selector: '.card--router, [data-pd-component-type="commerce_layouts.flexRouting"]' },
    { role: 'article', selector: '.card--article-content' },
    { role: 'stats', selector: '.content-asset > .themed' },
    { role: 'stats', heading: /guarantee|responsibility|footprint|1% for the planet|worn wear/i },
    { role: 'promo', heading: /sale|% off|web specials|free shipping|offer/i },
    { role: 'membership', heading: /newsletter|sign up|pro program|members/i },
    { role: 'collection', heading: /collection|new arrivals|favorites|featured/i },
  ],
  items: [
    { roles: ['categories'], card: '.card--router', title: '.copy__title', detail: '.copy__subtitle, .copy__body', link: 'a.card__block-link, a[href]' },
    { roles: ['article'], card: '.card--article-content', title: '.card__title', detail: '.card__blurb', link: 'a.card__link-full, a[href]' },
    // SFRA product tiles (category pages and the recommender shelf once it has content); not on a first visit's home page.
    { roles: ['products'], card: '.product-tile', title: '.pdp-link a, .product-tile__name, .link', price: '.sales .value', wasPrice: '.strike-through .value', link: 'a[href]' },
    { roles: ['stats'], card: '.row > [class*="col-"]', title: '.h4, h4, p', link: 'a[href]' },
  ],
  vocabulary: [
    ['jacket', 'jackets', 'puffy', 'puffer', 'down', 'nano puff', 'micro puff', 'down sweater', 'insulation', 'insulated', 'warm', 'warmth', 'winter', 'cold', 'parka', 'vest'],
    ['fleece', 'better sweater', 'synchilla', 'snap-t', 'retro-x', 'retro pile', 'regulator', 'midlayer', 'mid-layer', 'layer', 'sweater', 'pullover', 'cozy'],
    ['nano-air', 'nano air', 'breathable', 'active insulation', 'sweat', 'aerobic'],
    ['shell', 'hard shell', 'hardshell', 'hard-shell', 'soft shell', 'softshell', 'soft-shell', 'rain', 'rain jacket', 'raincoat', 'waterproof', 'gore-tex', 'torrentshell', 'h2no', 'wet', 'storm'],
    ['backpack', 'pack', 'packs', 'bag', 'bags', 'black hole', 'duffel', 'duffle', 'tote', 'luggage', 'travel', 'trip', 'flight', 'carry-on', 'commute', 'laptop bag'],
    ['climbing', 'climb', 'climber', 'bouldering', 'crag', 'alpine', 'mountaineering', 'belay', 'rope'],
    ['trail running', 'trail run', 'running', 'run', 'runner', 'ultramarathon', 'ultra', 'marathon', 'jog', 'jogging'],
    ['surfing', 'surf', 'surfer', 'wetsuit', 'wetsuits', 'boardshorts', 'board shorts', 'ocean', 'swim', 'swimming', 'beach'],
    ['fly fish', 'fly fishing', 'fishing', 'waders', 'river', 'trout', 'angler', 'angling'],
    ['ski', 'skiing', 'skier', 'snowboard', 'snowboarding', 'snow', 'backcountry', 'ski touring', 'touring', 'powder', 'resort', 'bibs'],
    ['mountain bike', 'mountain biking', 'mtb', 'biking', 'cycling', 'bike', 'ride', 'riding', 'gravel'],
    ['hiking', 'hike', 'hiker', 'backpacking', 'camping', 'camp', 'trail', 'thru-hike', 'national park', 'outdoors', 'outdoor'],
    ['kids', 'kid', 'baby', 'toddler', 'children', 'child', 'daughter', 'son', "kids' & baby", 'family'],
    ["women's", 'womens', 'women', 'woman', 'her'],
    ["men's", 'mens', 'men', 'man', 'him'],
    ['activism', 'activist', 'environment', 'environmental', 'climate', 'planet', 'sustainability', 'sustainable', 'vote', 'voting', 'voters', 'election', 'petition', 'nonprofit', 'grassroots', 'conservation', 'protect', 'donate'],
    ['recycled', 'recycling', 'organic', 'fair trade', 'netplus', 'responsible', 'responsibility', 'footprint', 'ethical', 'b corp'],
    ['worn wear', 'used', 'repair', 'repairs', 'repaired', 'secondhand', 'second-hand', 'trade in', 'trade-in', 'resale', 'ironclad guarantee', 'guarantee', 'warranty', 'durable', 'buy it for life', 'last', 'lasts'],
    ['provisions', 'food', 'beer', 'snacks', 'tinned fish', 'kernza', 'recipes', 'recipe', 'cooking', 'eat', 'protein'],
    ['workwear', 'work pants', 'canvas', 'iron forge', 'hemp', 'ranch', 'farm', 'work', 'job site'],
    ['baggies', 'shorts', 'summer', 'hot', 'hot weather', 'capilene', 'sun shirt', 'sunshirt', 'sun protection', 'upf', 'tee', 't-shirt', 'shirt'],
    ['stories', 'story', 'film', 'films', 'podcast', 'podcasts', 'articles', 'article', 'journal', 'read', 'reading', 'documentary', 'essay', 'letter'],
    ['guide', 'guides', 'compare', 'comparison', 'vs', 'versus', 'which', 'difference', 'how to', 'layering', 'layers', 'fit', 'sizing', 'size'],
    ['sale', 'web specials', 'past season', 'discount', 'deal', 'deals', 'budget', 'cheap', 'cheaper', 'price', 'expensive', 'afford'],
    ['gift', 'gifts', 'gift card', 'holiday', 'birthday', 'present', 'christmas'],
    ['pants', 'jeans', 'trousers', 'leggings', 'baselayer', 'base layer', 'baselayers', 'socks', 'underwear', 'hat', 'beanie', 'gloves'],
  ],
  policy: { promoteAfterRole: 'hero', neverHide: ['products', 'hero'] },
}
