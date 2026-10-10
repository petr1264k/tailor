/**
 * Site profiles (CONTEXT.txt §3.5, built Oct 10 for the storefront demo). A site profile is code-side knowledge of how a
 * site's pages are built: where the content lives, what counts as a region, which role each region plays (hero,
 * categories, product shelf, reviews, membership, ...), how to read a card (title, price, link), which words the site
 * uses for things the user talks about, and what the renderer may move or hide there.
 *
 * Nothing here is content: the facts come from the user's profile and the words come from the live page. The profile
 * only tells the engine the page's anatomy, so the model can propose MAJOR edits (promote a shelf, move a product to
 * the front, hide a membership pitch, tag a card) and code can apply them to the site's own DOM with an exact undo.
 */
import type { RegionRole, SiteKind } from '@/types'

/** How a region gets its role. Rules are tried in order; the first match wins. */
export interface RoleRule {
  role: RegionRole
  /** The region element matches this, or contains an element that does. */
  selector?: string
  /** The region's heading matches this. */
  heading?: RegExp
}

/** How to read the cards inside a region. */
export interface ItemRule {
  /** Regions this applies to; absent = any region. */
  roles?: RegionRole[]
  /** Card selector, relative to the region element. */
  card: string
  /** Selectors relative to the card. `title` is required; a card without a title is skipped. */
  title: string
  price?: string
  wasPrice?: string
  detail?: string
  link?: string
}

export interface SitePolicy {
  /** Promoted regions land after the top run of regions with this role (the hero stays first). Absent: at the very top. */
  promoteAfterRole?: RegionRole
  /** Regions that must never be hidden as a whole (code drops such hides). */
  neverHide: RegionRole[]
}

export interface SiteProfile {
  /** 'anker.com' matches anker.com and its subdomains. '*' is the generic fallback. */
  host: string
  name: string
  kind: SiteKind
  /** Where the page content lives; the first selector that matches wins. Falls back to <body>. */
  contentRoot: string[]
  /** What counts as a top-level region inside the content root (`:scope > ...` works). */
  region: string
  /** Region candidates matching this are ignored (spacers, trackers). */
  skip?: string
  roles: RoleRule[]
  items: ItemRule[]
  /**
   * Synonym groups: the words this site uses for the things people say in chats ("MacBook" ↔ "laptop", "100W").
   * Relevance selection treats every word of a group as present when the page has any of them. Code only.
   */
  vocabulary: string[][]
  policy: SitePolicy
}
