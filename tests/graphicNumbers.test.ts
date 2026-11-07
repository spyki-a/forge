import { describe, it, expect } from 'vitest'
import { inBetween, numberOf } from '@shared/graphics/numbers'

/*
 * graphics/numbers.ts (docs/CLIPS.md §6.2): a counter's in-between values in
 * the value's own format, and a bar's or a ring's size. Every in-between is
 * checked against the value's grouping, decimals, script, prefix and suffix,
 * and against "≤ the value" (the painter's contract).
 */

const DEVANAGARI = /^[०-९]+$/
const TELUGU = /^[౦-౯]+$/

/** Every fraction a counter could ask for over a lead, 0 to just under 1. */
const FRACTIONS = Array.from({ length: 101 }, (_, i) => i / 101)

describe('inBetween (§6.2)', () => {
  it('counts an Indian-grouped value in Indian grouping: "10,00,000" through "9,50,000", never "950,000"', () => {
    expect(inBetween('10,00,000', 0.95)).toBe('9,50,000')
    expect(inBetween('10,00,000', 0.5)).toBe('5,00,000')
    expect(inBetween('10,00,000', 0.0123)).toBe('12,300')
    for (const f of FRACTIONS) {
      const s = inBetween('10,00,000', f)
      expect(s).toMatch(/^\d{1,2}(,\d\d)*,\d{3}$|^\d{1,3}$/)
      expect(numberOf(s)!).toBeLessThanOrEqual(1_000_000)
    }
  })

  it('keeps a currency prefix: "₹500" through "₹250"', () => {
    expect(inBetween('₹500', 0.5)).toBe('₹250')
    expect(inBetween('₹500', 0)).toBe('₹0')
    for (const f of FRACTIONS) expect(inBetween('₹500', f).startsWith('₹')).toBe(true)
  })

  it('keeps the Devanagari script: "४०%" stays Devanagari', () => {
    expect(inBetween('४०%', 0.5)).toBe('२०%')
    for (const f of FRACTIONS) {
      const s = inBetween('४०%', f)
      expect(s.endsWith('%')).toBe(true)
      expect(s.slice(0, -1)).toMatch(DEVANAGARI)
      expect(numberOf(s)!).toBeLessThanOrEqual(40)
    }
  })

  it('keeps the Telugu script, with Indian grouping', () => {
    expect(inBetween('౧,౦౦,౦౦౦', 0.5)).toBe('౫౦,౦౦౦')
    for (const f of FRACTIONS) expect(inBetween('౩౦౦', f)).toMatch(TELUGU)
  })

  it('counts a western-grouped value in western grouping', () => {
    expect(inBetween('1,000,000', 0.95)).toBe('950,000')
    expect(inBetween('1,000,000', 0.5)).toBe('500,000')
    expect(inBetween('$1,200', 0.5)).toBe('$600')
    expect(inBetween('100,000', 0.999)).toBe('99,900')
    expect(inBetween('2,500,000', 0.5)).toBe('1,250,000')
  })

  it('adds no separator to an ungrouped value', () => {
    expect(inBetween('1000000', 0.5)).toBe('500000')
    expect(inBetween('2019', 0.5)).toBe('1010')
  })

  it('keeps the decimals as written, rounded to them', () => {
    expect(inBetween('4.5', 0.5)).toBe('2.3')
    expect(inBetween('4.50', 0.5)).toBe('2.25')
    expect(inBetween('1.2 million', 0.5)).toBe('0.6 million')
    expect(inBetween('99.9%', 0)).toBe('0.0%')
    for (const f of FRACTIONS) expect(inBetween('12.75', f)).toMatch(/^\d+\.\d\d$/)
  })

  it('keeps each suffix as said: k, million, lakh, %, percent', () => {
    expect(inBetween('500k', 0.5)).toBe('250k')
    expect(inBetween('3 million', 0.5)).toBe('2 million')
    expect(inBetween('20 lakh', 0.5)).toBe('10 lakh')
    expect(inBetween('40%', 0.5)).toBe('20%')
    expect(inBetween('40 percent', 0.25)).toBe('10 percent')
    expect(inBetween('-12°', 0.5)).toBe('-6°')
  })

  it('returns the value itself, unchanged, at fraction 1 and past it', () => {
    for (const v of ['10,00,000', '1,000,000', '₹500', '४०%', '4.50', '40 percent', '007', '1,000-2,000', 'none']) {
      expect(inBetween(v, 1)).toBe(v)
      expect(inBetween(v, 1.5)).toBe(v)
    }
  })

  it('gives a value with no digits, or with two numbers, no in-between: it is whole at every fraction', () => {
    for (const v of ['forty', 'चालीस', '1,000-2,000', '40 to 50', '१०-२०']) {
      for (const f of [0, 0.3, 0.99]) expect(inBetween(v, f)).toBe(v)
    }
  })

  it('never draws more than the value, at any fraction, for every format above', () => {
    const values = ['10,00,000', '1,000,000', '₹500', '४०%', '౩౦౦', '4.50', '500k', '1.2 million', '99.9%']
    for (const v of values) {
      const whole = numberOf(v)!
      for (const f of FRACTIONS) expect(numberOf(inBetween(v, f))!).toBeLessThanOrEqual(whole)
    }
  })
})

describe('numberOf (§6.2)', () => {
  it('reads every format above as a size', () => {
    expect(numberOf('10,00,000')).toBe(1_000_000)
    expect(numberOf('1,000,000')).toBe(1_000_000)
    expect(numberOf('₹500')).toBe(500)
    expect(numberOf('४०%')).toBe(40)
    expect(numberOf('౩౦౦')).toBe(300)
    expect(numberOf('4.50')).toBe(4.5)
    expect(numberOf('40 percent')).toBe(40)
    expect(numberOf('-12')).toBe(-12)
  })

  it('applies an English multiplier after the number', () => {
    expect(numberOf('500k')).toBe(500_000)
    expect(numberOf('1.2 million')).toBe(1_200_000)
    expect(numberOf('20 lakh')).toBe(2_000_000)
    expect(numberOf('3 crore')).toBe(30_000_000)
  })

  it('is null for a value with no digits or with two numbers', () => {
    expect(numberOf('forty')).toBeNull()
    expect(numberOf('1,000-2,000')).toBeNull()
    expect(numberOf('40 to 50')).toBeNull()
  })
})

describe('numbers.ts formats nothing through the locale', () => {
  it('never calls toLocaleString', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/shared/graphics/numbers.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/toLocaleString|Intl\.NumberFormat/)
  })
})
