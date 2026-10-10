import { MARK_LINES, MARK_ON_GREEN, MARK_PAGE, MARK_VIEWBOX, MARK_WAIST, TILE_RADIUS, type MarkColors } from './geometry'

/**
 * The Tailor mark as a React element. Default: the green tile with the chalk page, 24 px, decorative.
 * Pass `title` when the mark stands alone (no wordmark next to it) so screen readers name it.
 */
export function TailorMark({
  size = 24,
  tile = true,
  colors = MARK_ON_GREEN,
  title,
  className,
}: {
  size?: number
  tile?: boolean
  colors?: MarkColors
  title?: string
  className?: string
}) {
  const page = (
    <>
      <path d={MARK_PAGE} fill={colors.paper} stroke={colors.ink} strokeWidth="4" strokeLinejoin="round" />
      <path d={MARK_LINES} fill="none" stroke={colors.ink} strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
      <path d={MARK_WAIST} fill="none" stroke={colors.accent} strokeWidth="2.8" strokeLinecap="round" />
    </>
  )
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}
    >
      {title && <title>{title}</title>}
      {tile && <rect width="64" height="64" rx={TILE_RADIUS} fill={colors.paper} />}
      {tile ? <g transform="translate(8 8) scale(.75)">{page}</g> : page}
    </svg>
  )
}
