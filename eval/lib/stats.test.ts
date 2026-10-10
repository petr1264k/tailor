import { describe, expect, it } from 'vitest'
import { asciiLetterShare, binomialTail, countWords, median, minSuccesses, wilson } from './stats'
import { parseCsv, toCsv } from './csv'

describe('binomial thresholds stated in CONTEXT.txt §8.3', () => {
  it('10 trials: 9/10 at 50% chance, 6/10 at 25% chance (one-sided, p < .05)', () => {
    expect(binomialTail(9, 10, 0.5)).toBeCloseTo(11 / 1024, 6)
    expect(binomialTail(8, 10, 0.5)).toBeGreaterThan(0.05)
    expect(minSuccesses(10, 0.5)).toBe(9)
    expect(binomialTail(6, 10, 0.25)).toBeLessThan(0.05)
    expect(binomialTail(5, 10, 0.25)).toBeGreaterThan(0.05)
    expect(minSuccesses(10, 0.25)).toBe(6)
    expect(binomialTail(0, 10, 0.25)).toBe(1)
    expect(minSuccesses(2, 0.5)).toBeNull()
  })

  it('wilson interval brackets the estimate', () => {
    const [lo, hi] = wilson(40, 50)
    expect(lo).toBeLessThan(0.8)
    expect(hi).toBeGreaterThan(0.8)
    expect(wilson(0, 0)).toEqual([0, 0])
  })
})

describe('small helpers', () => {
  it('asciiLetterShare tells English from Russian', () => {
    expect(asciiLetterShare('Hello world')).toBe(1)
    expect(asciiLetterShare('Привет мир')).toBe(0)
    expect(asciiLetterShare('123 !!')).toBe(1)
  })
  it('median and countWords', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(countWords('  Price: $1,299 — 4 HDMI ports ')).toBe(5)
  })
  it('csv round-trips quotes, commas and newlines', () => {
    const rows = [['id', 'value', 'correct'], ['f1', 'says "hi", then\nleaves', 'y']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
    expect(parseCsv('﻿a,b\r\n1,\r\n\r\n')).toEqual([['a', 'b'], ['1', '']])
  })
})
