/**
 * The Tailor mark: a page taken in at the waist, the way a jacket is taken in. The line at the waist is the one
 * that changed. Chosen Oct 10 2026 from five concepts (artifact "Tailor Logo Concepts"). Palette: bottle green,
 * tailor's chalk, chalk yellow.
 *
 * The geometry lives here once. React (TailorMark.tsx), the in-page bar (string SVG) and the static files in
 * src/assets/logo all draw the same paths; the PNG icons in src/assets/icons are rendered from those files.
 */
export const BRAND = {
  green: '#1b5a44',
  chalk: '#f1ece0',
  chalkYellow: '#f4d35e',
} as const

export const MARK_VIEWBOX = '0 0 64 64'
/** Page outline with a shallow dart on each side. */
export const MARK_PAGE = 'M17 7H47V25.5L43.5 32L47 38.5V56H17V38.5L20.5 32L17 25.5Z'
/** The lines of text Tailor left alone. */
export const MARK_LINES = 'M24 16H40M24 22H34M24 42H40M24 48H32'
/** The line at the waist: the one Tailor rewrote. */
export const MARK_WAIST = 'M26 32H38'
/** Corner radius of the tile, in viewBox units (22%). */
export const TILE_RADIUS = 14

export interface MarkColors {
  /** Page outline and text lines. */
  ink: string
  /** The rewritten line. */
  accent: string
  /** The ground: tile fill and page fill. */
  paper: string
}

export const MARK_ON_GREEN: MarkColors = { ink: BRAND.chalk, accent: BRAND.chalkYellow, paper: BRAND.green }

export interface MarkOptions {
  /** Draw the green rounded square behind the page (the app-icon form). Default true. */
  tile?: boolean
  /** Filled page without text lines, for 16 px and under. Default false. */
  solid?: boolean
}

/** Inline SVG markup for places without React, such as the shadow-root bar. `size` is the box in px. */
export function markSvg(size: number, c: MarkColors = MARK_ON_GREEN, opts: MarkOptions = {}): string {
  const tile = opts.tile ?? true
  const bg = tile ? `<rect width="64" height="64" rx="${TILE_RADIUS}" fill="${c.paper}"/>` : ''
  const page = opts.solid
    ? `<path d="${MARK_PAGE}" fill="${c.ink}"/><path d="${MARK_WAIST}" fill="none" stroke="${c.accent}" stroke-width="5" stroke-linecap="round"/>`
    : `<path d="${MARK_PAGE}" fill="${c.paper}" stroke="${c.ink}" stroke-width="4" stroke-linejoin="round"/>` +
      `<path d="${MARK_LINES}" fill="none" stroke="${c.ink}" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>` +
      `<path d="${MARK_WAIST}" fill="none" stroke="${c.accent}" stroke-width="2.8" stroke-linecap="round"/>`
  const inner = tile ? `<g transform="translate(8 8) scale(.75)">${page}</g>` : page
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}" aria-hidden="true">${bg}${inner}</svg>`
}
