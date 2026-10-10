/**
 * The generic profile: any site without a hand-written one. Regions are the top-level children of <main> (or the
 * body, minus header/nav/footer/aside); roles come from common heading words; cards are found by shape
 * (repeated siblings that each carry a link and some text, regions.ts repeatedCards).
 */
import type { SiteProfile } from './types'

export const generic: SiteProfile = {
  host: '*',
  name: '',
  kind: 'generic',
  contentRoot: ['main', '[role="main"]', 'article', 'body'],
  region: ':scope > div, :scope > section, :scope > article, :scope > ul, :scope > ol',
  skip: 'header, nav, footer, aside, [role="navigation"], [role="contentinfo"], [role="banner"]',
  roles: [
    { role: 'hero', selector: 'h1' },
    { role: 'categories', heading: /by category|categories|shop by|browse/i },
    { role: 'products', heading: /best ?sellers|top picks|featured|new arrivals|selections|popular|trending|deals/i },
    { role: 'reviews', heading: /reviews|testimonials|customers say|loved by/i },
    { role: 'membership', heading: /member|rewards|newsletter|sign up|subscribe/i },
    { role: 'stats', heading: /million|customers|countries|markets|years/i },
    { role: 'promo', heading: /sale|save|offer|% off/i },
    { role: 'article', heading: /guide|how to|why|what is/i },
  ],
  items: [],
  vocabulary: [],
  policy: { promoteAfterRole: 'hero', neverHide: ['hero'] },
}
