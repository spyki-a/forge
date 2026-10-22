import { describe, expect, it } from 'vitest'
import { HINDI_NUMBER_WORDS, formCounts, hindiNumberMeaning, numberForm, numberLines } from './integration/asrHindi'

/*
 * M21's classifier (tests/integration/asrHindi.ts; docs/CLIPS.md §6.15):
 * which words of a Hindi transcript bear a number, and how the model wrote
 * each. asr.int's gated case runs it over the user's clips; this holds its
 * rules without a model.
 */

describe('numberForm: how a word of a Hindi transcript bears a number', () => {
  it('reads Devanagari digits as Devanagari digits, at any place in the word', () => {
    for (const text of ['२५', '२०२४,', '₹५००', '३५वें', '१']) expect(numberForm(text), text).toBe('devanagari-digits')
  })

  it('reads ASCII digits as ASCII digits', () => {
    for (const text of ['25', '25%', '2024।', '₹500', '35वें']) expect(numberForm(text), text).toBe('ascii-digits')
  })

  it('reads a word holding both as mixed', () => {
    expect(numberForm('2५')).toBe('mixed-digits')
  })

  it('reads a Hindi number word, with its edge punctuation and the danda trimmed', () => {
    for (const text of ['पच्चीस', 'दो,', 'सौ।', '"हज़ार"', 'लाख', 'डेढ़', 'साढ़े', 'निन्यानवे']) expect(numberForm(text), text).toBe('word')
  })

  it('matches a nukta letter written precomposed or as its letter and nukta', () => {
    // ड़ as U+095C, and as U+0921 U+093C; ज़ as U+095B, and as U+091C U+093C.
    for (const text of ['करोड़', 'करोड़', 'हज़ार', 'हज़ार']) {
      expect(numberForm(text), [...text].map((c) => c.codePointAt(0)!.toString(16)).join(' ')).toBe('word')
    }
  })

  it('gives null for a word that bears none: the danda alone is punctuation, not a digit', () => {
    for (const text of ['नमस्ते', 'शादी', '।', '॥', 'hello', '', 'दोस्त', 'एकदम']) expect(numberForm(text), JSON.stringify(text)).toBeNull()
  })
})

describe('the Hindi number words', () => {
  const spellings = HINDI_NUMBER_WORDS.flatMap(([, ...s]) => s)

  it('holds the cardinals, the scale words and the fractions said as numbers', () => {
    for (const [word, means] of [['शून्य', '0'], ['दो', '2'], ['पच्चीस', '25'], ['नब्बे', '90'], ['सौ', '100'], ['हजार', '1,000'], ['ढाई', '2.5']] as const) {
      expect(hindiNumberMeaning(word), word).toBe(means)
    }
    for (const word of ['लाख', 'करोड़', 'अरब', 'डेढ़', 'सवा', 'पौने']) expect(spellings, word).toContain(word)
  })

  it('names 0 to 100 once each', () => {
    const cardinals = HINDI_NUMBER_WORDS.map(([means]) => means).filter((m) => /^\d+$/.test(m)).map(Number)
    expect(cardinals).toEqual(Array.from({ length: 101 }, (_, n) => n))
  })

  it('reads every spelling it lists as a word, and lists no spelling twice', () => {
    for (const s of spellings) expect(numberForm(s), s).toBe('word')
    expect(new Set(spellings.map((s) => s.normalize('NFC'))).size).toBe(spellings.length)
  })
})

describe('numberLines and formCounts', () => {
  const words = [
    { text: 'शादी', startMs: 0, endMs: 400 },
    { text: '२५', startMs: 400, endMs: 900 },
    { text: 'तारीख', startMs: 900, endMs: 1300 },
    { text: 'पच्चीस,', startMs: 12_340, endMs: 12_800 },
    { text: '2024।', startMs: 13_000, endMs: 13_500 }
  ]

  it('writes one line per number-bearing word, with its clip, its time and its form, as the model wrote it', () => {
    expect(numberLines('Bride 5.30pm.mp4', words)).toEqual([
      'Bride 5.30pm.mp4\t0.40-0.90 s\tdevanagari-digits\t२५',
      'Bride 5.30pm.mp4\t12.34-12.80 s\tword\tपच्चीस,\t= 25',
      'Bride 5.30pm.mp4\t13.00-13.50 s\tascii-digits\t2024।'
    ])
  })

  it('counts each form', () => {
    expect(formCounts(words)).toEqual({ 'devanagari-digits': 1, 'ascii-digits': 1, 'mixed-digits': 0, word: 1 })
  })
})
