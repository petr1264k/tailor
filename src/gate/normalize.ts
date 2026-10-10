/**
 * Normalization for the fidelity gate (CONTEXT.txt §3.6). Code only, no model.
 *
 * The SAME `normalizeForMatch` runs on the visible page text, on every claim and on every user fact value,
 * so formatting alone never decides a match: "120Hz" = "120 Hz", "$1,299" = "1299 USD", 65" = 65-inch.
 */

/** Unit spellings → one canonical unit. "120Hz" / "120 Hz" / "120-hz" → "120 hz"; 65" / 65-inch / 65 in → "65 inch". */
export const UNIT_CANON: Readonly<Record<string, string>> = {
  inches: 'inch', inch: 'inch', in: 'inch',
  hz: 'hz', khz: 'khz', mhz: 'mhz', ghz: 'ghz',
  nits: 'nit', nit: 'nit',
  lbs: 'lb', lb: 'lb', pounds: 'lb', pound: 'lb', kg: 'kg', grams: 'g', gram: 'g', g: 'g', oz: 'oz',
  mm: 'mm', cm: 'cm', m: 'm', km: 'km', feet: 'ft', foot: 'ft', ft: 'ft',
  watts: 'w', watt: 'w', w: 'w', kw: 'kw', wh: 'wh', kwh: 'kwh', mah: 'mah', volts: 'v', volt: 'v', v: 'v',
  gb: 'gb', tb: 'tb', mb: 'mb', gbps: 'gbps', mbps: 'mbps', ms: 'ms', db: 'db', fps: 'fps', mp: 'mp', mph: 'mph',
  hours: 'h', hour: 'h', hrs: 'h', hr: 'h', h: 'h',
  minutes: 'min', minute: 'min', mins: 'min', min: 'min',
  seconds: 'sec', second: 'sec', secs: 'sec', sec: 'sec',
  days: 'day', day: 'day', months: 'month', month: 'month', years: 'year', year: 'year', yrs: 'year', yr: 'year',
  cups: 'cup', cup: 'cup', tablespoons: 'tbsp', tablespoon: 'tbsp', tbsp: 'tbsp',
  teaspoons: 'tsp', teaspoon: 'tsp', tsp: 'tsp', ml: 'ml', liters: 'l', liter: 'l', litres: 'l', litre: 'l', l: 'l',
  kcal: 'kcal', calories: 'kcal', calorie: 'kcal', cal: 'kcal', servings: 'serving', serving: 'serving',
  '°f': '°f', '°c': '°c', '%': '%', percent: '%', x: 'x',
}

const CURRENCY: Readonly<Record<string, string>> = {
  usd: '$', dollar: '$', dollars: '$', $: '$',
  eur: '€', euro: '€', euros: '€', '€': '€',
  gbp: '£', '£': '£',
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const byLengthDesc = (a: string, b: string): number => b.length - a.length

const UNIT_RE = new RegExp(
  `(\\d) ?-? ?(${Object.keys(UNIT_CANON).sort(byLengthDesc).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
)

/**
 * Length-preserving character unification: curly quotes and guillemets → straight, unicode dashes → '-',
 * unicode spaces → ' ', × → x. Length-preserving so the claim scanner can map positions back to the original.
 */
export function unifyChars(s: string): string {
  return s
    .replace(/[“-‟«»]/g, '"')
    .replace(/[‘-‛′]/g, "'")
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[  -   　]/g, ' ')
    .replace(/×/g, 'x')
}

/**
 * NFKC, lowercase, unified dashes/quotes, thousands separators stripped inside numbers (1,299 → 1299),
 * trailing ".00" dropped, currencies to one form ("1,299 USD" / "USD 1,299" / "$ 1,299" → "$1299"; € and £ alike),
 * inch forms to "N inch", unit spacing to "N unit" ("120Hz" → "120 hz"), "3840 x 2160" → "3840x2160",
 * whitespace collapsed. Used on both sides of every check.
 */
export function normalizeForMatch(text: string): string {
  let s = text
    .replace(/[­​-‍⁠﻿™®©℠]/g, '') // soft hyphen, zero-width, ™ ® © ℠
    .replace(/[″〃]/g, '"') // ″ is an inch mark; NFKC would turn it into two primes
    .normalize('NFKC')
    .toLowerCase()
  s = unifyChars(s).replace(/\s+/g, ' ')
  s = s
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\.00(?!\d)/g, '$1')
    .replace(/(?<![\p{L}\p{N}])(?:us ?\$|usd ?\$?|\$) ?(?=\d)/gu, '$$')
    .replace(/(?<![\p{L}\p{N}])(?:eur|€) ?(?=\d)/gu, '€')
    .replace(/(?<![\p{L}\p{N}])(?:gbp|£) ?(?=\d)/gu, '£')
    .replace(
      /(?<![$€£\d.,])(\d+(?:\.\d+)?) ?(usd|dollars?|eur|euros?|gbp|\$|€|£)(?![\p{L}\p{N}])/gu,
      (_m, n: string, c: string) => `${CURRENCY[c] ?? c}${n}`,
    )
    .replace(/(\d)"/g, '$1 inch')
    .replace(/(\d) ?x ?(?=\d)/g, '$1x')
    .replace(UNIT_RE, (_m, d: string, u: string) => `${d} ${UNIT_CANON[u] ?? u}`)
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Link form used on both sides of the link check: hash and trailing slashes stripped.
 * Absolute URLs must be http(s) (a `javascript:` or `data:` href is never allowed, even if the page has one).
 * Relative hrefs are compared as strings. Returns null when the href can never be allowed.
 */
export function normalizeHref(href: string): string | null {
  const raw = href.trim()
  if (!raw) return null
  let out: string
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    out = u.href
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
    out = raw.split('#')[0] ?? ''
  }
  out = out.replace(/\/+$/, '')
  return out || null
}

/**
 * True when `needle` occurs in `haystack` as a whole token: it may not continue a word or a number
 * ("20" is not in "120", "$1299" is not in "$1299.99"). `loose` lets '-' / ' ' between parts be optional
 * ("wi-fi 6e" = "wifi 6e", "rtx 4070" = "rtx4070"); used for specs and model names only.
 * Both arguments must already be normalized.
 */
export function containsToken(haystack: string, needle: string, loose = false): boolean {
  if (!needle) return false
  let body = escapeRe(needle)
  if (loose) body = body.replace(/[- ]+/g, '[- ]?')
  const lb = /^[\p{L}\p{N}]/u.test(needle) ? `(?<![\\p{L}\\p{N}])${/^\d/.test(needle) ? '(?<!\\d[.,])' : ''}` : ''
  const rb = /[\p{L}\p{N}]$/u.test(needle) ? `(?![\\p{L}\\p{N}])${/\d$/.test(needle) ? '(?![.,]\\d)' : ''}` : ''
  return new RegExp(lb + body + rb, 'u').test(haystack)
}
