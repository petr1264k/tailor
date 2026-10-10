/**
 * The Tailor lockup: the official mark (src/brand, the fitted page on a bottle-green tile) plus the wordmark.
 * Styles: src/ui/theme.css (.brand). `light` is for dark surfaces: the page is drawn in chalk with no tile.
 */
import { BRAND, TailorMark } from '@/brand'

const ON_DARK = { ink: BRAND.chalk, accent: BRAND.chalkYellow, paper: 'transparent' }

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={light ? 'brand brand--light' : 'brand'}>
      {light ? <TailorMark size={26} tile={false} colors={ON_DARK} /> : <TailorMark size={24} />}
      <span className="wordmark">Tailor</span>
    </span>
  )
}
