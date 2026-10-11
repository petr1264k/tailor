/**
 * yeti.com (verified 5:40 pm Oct 10 2026 against a rendered copy of https://www.yeti.com/, demo/pages/6-yeti.html,
 * saved with demo/scan-page.sh --headed: the site serves a bot wall to headless Chrome).
 * Salesforce Commerce Cloud Page Designer storefront: the home page is `.storepage > .experience-main` with 13
 * `.experience-component` blocks, top to bottom: hero banner (Patch Perfect), four lifestyle category tiles (Coolers,
 * Custom, Drinkware, Bags), a skinny promo (25% off Rambler travel bottles), the Fandom collection carousel (MLB, NBA,
 * collegiate), the "New & Trending" product spotlight carousel (12 slides, no prices), a tabbed product shelf
 * (Offers | New Arrivals: 34 product tiles with price, crossed-out price, subline, badge, link), a two-column promo
 * (30% off straw mug, Riverhead collection), a tabbed colour-drop carousel (New Colors | 20% off | Seasonal | Core),
 * a tabbed category carousel (Categories | Activities), the "YETI Nation" customer-photo gallery, the "Why buy from
 * YETI.com" benefits list, and the founders' story (Built for the Wild). Inactive tab panes are display:none, so the
 * live page and the saved copy both expose only the active tab's cards.
 */
import type { SiteProfile } from './types'

export const yeti: SiteProfile = {
  host: 'yeti.com',
  name: 'YETI',
  kind: 'storefront',
  contentRoot: ['.storepage > .experience-main', '.pd-components > .experience-main', '#maincontent', 'main'],
  region: ':scope > .experience-component',
  skip: '.experience-yeti_assets-html, .quick-nav-buttons-m',
  // Tab labels and shelf headlines are divs and links, not headings; carousels have no headline, so their first real slide names them.
  title: '.nav-tabs .nav-link.active, .carousel-headline, .benefits-heading, h1.content-block-title, .banner-container-skinny .content-block-title, .slick-slide:not(.slick-cloned) .content-block-title',
  roles: [
    { role: 'hero', selector: '.experience-yeti_layouts-bannerContainer' },
    { role: 'products', selector: '.product-tile' },
    { role: 'categories', selector: '.lifestylecat' },
    { role: 'categories', heading: /^categories$|activities|shop by|shop all/i },
    { role: 'membership', selector: '.benefits-container' },
    { role: 'promo', selector: '.banner-container-skinny, .experience-yeti_layouts-banner2column' },
    { role: 'promo', heading: /% off|sale|save|offers?|deal|last chance|clearance/i },
    { role: 'reviews', heading: /yeti nation|builtforthewild|customers|reviews|fans/i },
    { role: 'article', heading: /built for the wild|founders|our story|mission|since 2006|stories/i },
    { role: 'collection', selector: '.experience-yeti_layouts-carouselSimple' },
    { role: 'collection', heading: /collection|new & trending|new colou?rs|limited edition|drop|seasonal|core/i },
  ],
  items: [
    {
      roles: ['products'],
      card: '.product-tile',
      title: '.pdp-link a',
      price: '.sales .value',
      wasPrice: '.strike-through .value',
      detail: '.subline-copy, .promotions .callout',
      link: 'a.tile-image-link, .pdp-link a[href]',
    },
    { roles: ['categories'], card: '.lifestylecat', title: '.lifestylecat__heading', link: 'a[href]' },
    // Slick carousels clone their edge slides (.slick-cloned); the card is the slide itself, so a promote reorders the track.
    {
      roles: ['categories', 'collection', 'promo', 'article', 'reviews', 'hero'],
      card: '.slick-slide:not(.slick-cloned)',
      title: 'h4, h3, h2, .content-block-title, .lifestylecat__heading, .cta-description p',
      detail: '.content-block-content, p',
      link: 'a[href]',
    },
    { roles: ['membership'], card: '.benefits-list-wrapper li', title: '.list-item-heading', detail: '.list-item-subtext', link: 'a[href]' },
  ],
  vocabulary: [
    ['tumbler', 'rambler', 'mug', 'cup', 'coffee', 'tea', 'travel mug', 'drinkware', 'bottle', 'water bottle', 'hydration', 'straw', 'jug', 'wine', 'barware', 'beer'],
    ['cooler', 'coolers', 'tundra', 'roadie', 'hopper', 'ice chest', 'ice', 'camping', 'camp', 'tailgate', 'tailgating', 'fishing', 'hunting', 'beach', 'boat', 'boating', 'picnic', 'bbq'],
    ['bag', 'bags', 'backpack', 'duffel', 'duffle', 'tote', 'crossbody', 'luggage', 'camino', 'panga', 'crossroads', 'ranchero', 'travel', 'trip', 'flight', 'commute', 'hiking', 'hike', 'gym'],
    ['customize', 'custom', 'customization', 'personalize', 'personalized', 'engrave', 'engraving', 'monogram', 'logo', 'gift', 'gifts', 'birthday', 'holiday', 'wedding', 'groomsmen'],
    ['dog', 'dogs', 'puppy', 'boomer', 'pet', 'pets'],
    ['kitchen', 'grill', 'grilling', 'grill press', 'cast iron', 'cooking', 'cook', 'ceramic', 'bowl', 'serving'],
    ['apparel', 'hoodie', 'sweatshirt', 't-shirt', 'tee', 'shirt', 'hat', 'cap', 'sunshirt', 'clothing', 'clothes'],
    ['fan shop', 'fan', 'fans', 'fandom', 'mlb', 'nba', 'nfl', 'team', 'collegiate', 'college', 'baseball', 'basketball', 'football', 'hockey', 'sports', 'game day', 'spurs', 'lakers', 'knicks', 'dodgers', 'yankees'],
    ['kids', 'kid', 'child', 'children', 'daughter', 'son', 'lunch box', 'lunch', 'school', 'back to school', 'daytrip'],
    ['outdoor living', 'chair', 'camp chair', 'bucket', 'hondo', 'trailhead', 'blanket', 'patio', 'backyard', 'yard'],
    ['sale', 'offer', 'offers', 'deal', 'deals', 'discount', '% off', 'seasonal offers', 'budget', 'cheap', 'cheaper', 'price', 'expensive', 'afford'],
    ['limited edition', 'color', 'colors', 'colour', 'colours', 'new colors', 'drop', 'just dropped', 'coming soon', 'new arrivals', 'new'],
    ['cases', 'storage', 'gobox', 'loadout', 'tool', 'tools', 'gear box', 'organize', 'organizer', 'phone case', 'iphone'],
    ['warranty', 'durable', 'indestructible', 'lifetime', 'rugged', 'tough', 'last', 'quality', 'returns', 'free shipping', 'shipping'],
    ['water', 'leakproof', 'leak', 'spill', 'insulated', 'insulation', 'cold', 'hot', 'keep', 'hours'],
  ],
  policy: { promoteAfterRole: 'hero', neverHide: ['products', 'hero'] },
}
