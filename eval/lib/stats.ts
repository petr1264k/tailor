/** Small, pure statistics for the eval write-up (CONTEXT.txt §8). State N next to every number. */

/** One-sided binomial tail P(X >= k) for X ~ Binomial(n, p). */
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  if (p <= 0) return 0
  if (p >= 1) return 1
  let pmf = Math.pow(1 - p, n) // P(X = 0)
  let tail = 0
  for (let i = 0; i <= n; i++) {
    if (i >= k) tail += pmf
    pmf = (pmf * (n - i) * p) / ((i + 1) * (1 - p))
  }
  return Math.min(1, tail)
}

/** Smallest k with P(X >= k) < alpha, or null when even n of n is not enough. §8.3: n = 10 → 9 at p = .5, 6 at p = .25. */
export function minSuccesses(n: number, p: number, alpha = 0.05): number | null {
  for (let k = 0; k <= n; k++) if (binomialTail(k, n, p) < alpha) return k
  return null
}

/** Wilson score interval (95% by default) for k of n. [0, 0] when n = 0. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0]
  const phat = k / n
  const denom = 1 + (z * z) / n
  const center = (phat + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/** Share of letters that are ASCII a-z/A-Z. A crude language check (§8.3 "hold language constant"). 1 when no letters. */
export function asciiLetterShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (letters === 0) return 1
  return (text.match(/[A-Za-z]/g)?.length ?? 0) / letters
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export const pct = (x: number): string => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a')
