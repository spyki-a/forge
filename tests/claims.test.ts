import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BIND_WINDOW,
  CLAUSE_BREAK,
  FUNCTION_WORDS_EN,
  NEGATORS,
  bind,
  claimToken,
  claimTokens,
  claimTokensOf,
  claimsOf,
  clauseAt,
  marksOf,
  numbersIn,
  type CanonNumber,
  type Claim,
  type ClaimStretch
} from '@shared/director/claims'
import { numberOf } from '@shared/graphics/numbers'
import * as validator from '@shared/director/validateGraphics'
import {
  checkGraphicData,
  reportedBy,
  stretchFor,
  validateBaseline,
  validateGraphics,
  type AnswerGraphic
} from '@shared/director/validateGraphics'
import { settleGraphics, type GraphicsMenu } from '@shared/director/run'
import { GRAPHIC_SPACING, type GraphicCandidate } from '@shared/graphics/template'
import { capSegments, type Transcript } from '@shared/transcript'
import nestedEn1 from './fixtures/graphics/nested-en-1.json'
import { GRAPHIC_TEMPLATES, type GraphicData, type TemplateDef } from '@shared/graphics/template'
import type { Segment, Word } from '@shared/transcript'
import specs from './fixtures/graphics/specs.json'

/*
 * director/claims.ts (docs/CLIPS.md §6.7): the normaliser (rules 1-4 and the
 * lists), then claimsOf and bind (rules 5-8) with the review's cases, each
 * named. Rule 9's template rules over a bound graphic (ring's %, bars' one
 * unit) are validateGraphics.ts's; the cases here that need one assert the
 * bind-level half and say what the template rule then decides.
 *
 * Each mutation §6.7 and the lane's brief name was put back and run against
 * this file; the case that kills it is named in the lane's commit.
 */

/** The one number a phrase holds, or a failure naming what was found instead. */
function one(text: string): CanonNumber {
  const found = numbersIn(claimTokensOf(text))
  expect(found, `numbers in "${text}"`).toHaveLength(1)
  return found[0].value
}

describe('rule 1: NFC, then lower case', () => {
  it('lower-cases, locale-independent', () => {
    expect(claimToken('WEDDING')).toBe('wedding')
    expect(claimToken('Instagram')).toBe('instagram')
    expect(claimToken('I')).toBe('i')
  })

  it('composes to NFC, so NFD and NFC of one word are one token', () => {
    const nfd = 'Café'
    const nfc = 'Café'
    expect(nfd).not.toBe(nfc)
    expect(claimToken(nfd)).toBe('café')
    expect(claimToken(nfd)).toBe(claimToken(nfc))
  })
})

describe('rule 2: trim, combining marks kept, units split off first', () => {
  it('keeps Telugu and Hindi combining marks, final ones included', () => {
    // validate.ts's normalise measured 'పెళ్లి' → 'పెళ్ల' and 'शादी' → 'शाद' (§6.7).
    expect(claimToken('పెళ్లి')).toBe('పెళ్లి')
    expect(claimToken('శాతం,')).toBe('శాతం')
    expect(claimToken('शादी')).toBe('शादी')
    expect(claimToken('“हिस्से”')).toBe('हिस्से')
    expect(claimToken('पैसे।')).toBe('पैसे')
  })

  it('a Devanagari nukta letter meets its decomposed twin', () => {
    // U+0958 is a composition exclusion: NFC writes it as क + nukta (U+0915 U+093C), so the
    // input NFC CHANGES. Escapes, so no editor can normalise the literals away.
    const precomposed = '\u0958\u0932'
    const pair = '\u0915\u093C\u0932'
    expect(precomposed).not.toBe(pair)
    expect(claimToken(precomposed)).toBe(pair)
    expect(claimToken(pair)).toBe(pair)
  })

  it('a Telugu vowel sign meets its decomposed twin (NFC = NFD)', () => {
    // ై U+0C48 decomposes to U+0C46 U+0C56.
    const nfc = '\u0C28\u0C32\u0C2D\u0C48'
    const nfd = nfc.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    expect(Array.from(nfd)).toContain('\u0C56')
    expect(claimToken(nfd)).toBe(nfc)
    expect(claimTokens(nfd)).toEqual([nfc])
  })

  it('trims punctuation at either end, never inside', () => {
    expect(claimToken('Parts:')).toBe('parts')
    expect(claimToken('“Budget,”')).toBe('budget')
    expect(claimToken("don't")).toBe("don't")
    expect(claimToken('40,000.')).toBe('40,000')
    expect(claimToken('—')).toBe('')
  })

  it('splits a leading currency sign and a trailing % off as unit tokens', () => {
    expect(claimTokens('$40')).toEqual(['$', '40'])
    expect(claimTokens('40%')).toEqual(['40', '%'])
    expect(claimTokens('(₹40,000)')).toEqual(['₹', '40,000'])
    expect(claimTokens('€3')).toEqual(['€', '3'])
    expect(claimTokens('£12')).toEqual(['£', '12'])
    expect(claimTokens('$1.2M')).toEqual(['$', '1.2m'])
    expect(claimTokens('%')).toEqual(['%'])
    expect(claimTokens('४०%')).toEqual(['40', '%'])
    expect(claimTokens('Parts')).toEqual(['parts'])
    expect(claimTokens('"')).toEqual([])
    expect(claimTokensOf('we spent $40 on ads')).toEqual(['we', 'spent', '$', '40', 'on', 'ads'])
  })

  it('keeps a minus before the digits as its own token, so -5% is not 5%', () => {
    expect(claimTokens('-5%')).toEqual(['−', '5', '%'])
    expect(one('-5%')).toEqual({ n: -5, unit: '%' })
    expect(one('5%')).toEqual({ n: 5, unit: '%' })
    expect(one('-$5')).toEqual({ n: -5, unit: 'currency', currency: '$' })
    expect(one('$-5')).toEqual(one('-$5'))
    expect(one('(−5)')).toEqual({ n: -5, unit: '' })
    // A hyphen before a letter is punctuation, trimmed as rule 2 says.
    expect(claimTokens('-well')).toEqual(['well'])
  })

  it('reads an en-dash minus and a spoken minus as negative, never as the positive number', () => {
    expect(claimTokens('\u201340%')).toEqual(['−', '40', '%'])
    expect(one('\u201340%')).toEqual({ n: -40, unit: '%' })
    expect(numberOf('\u201340%')).toBe(-40)
    expect(one('minus 40 percent')).toEqual({ n: -40, unit: '%' })
    expect(one('negative 5%')).toEqual({ n: -5, unit: '%' })
    expect(one('minus $5')).toEqual({ n: -5, unit: 'currency', currency: '$' })
  })

  it('reads no number from a decimal point before the digits, never ten times the value', () => {
    expect(claimTokens('.5%')).toEqual(['.5', '%'])
    expect(numbersIn(claimTokensOf('a fee of .5% on every booking'))).toEqual([])
    expect(numbersIn(claimTokensOf('it costs $.50 a print'))).toEqual([])
    expect(numberOf('.5%')).toBeNull()
    expect(numberOf('$.50')).toBeNull()
  })

  it('reads no number from a trailing currency sign, never a bare number', () => {
    expect(claimTokens('40€')).toEqual(['40€'])
    expect(numbersIn(claimTokensOf('ads cost 40€ each'))).toEqual([])
  })

  it('puts a CLAUSE_BREAK where a clause or sentence mark stood', () => {
    expect(claimTokens('40%.')).toEqual(['40', '%', CLAUSE_BREAK])
    expect(claimTokens('€3,')).toEqual(['€', '3', CLAUSE_BREAK])
    expect(claimTokens('Parts:')).toEqual(['parts', CLAUSE_BREAK])
    expect(claimTokens('—')).toEqual([CLAUSE_BREAK])
    expect(claimTokens('पैसे।')).toEqual(['पैसे', CLAUSE_BREAK])
    // The point of the currency word 'Rs.' is an abbreviation's, not a sentence's.
    expect(claimTokens('Rs.')).toEqual(['rs'])
  })
})

describe('rule 3: native digits to ASCII, each of the ten blocks', () => {
  const BLOCKS: [string, number][] = [
    ['Devanagari', 0x966],
    ['Bengali', 0x9e6],
    ['Gurmukhi', 0xa66],
    ['Gujarati', 0xae6],
    ['Tamil', 0xbe6],
    ['Telugu', 0xc66],
    ['Kannada', 0xce6],
    ['Malayalam', 0xd66],
    ['Arabic-Indic', 0x660],
    ['Extended Arabic-Indic', 0x6f0]
  ]
  for (const [name, zero] of BLOCKS) {
    it(`${name} (U+${zero.toString(16).toUpperCase().padStart(4, '0')})`, () => {
      const d = (k: number): string => String.fromCodePoint(zero + k)
      expect(claimToken(d(4) + d(0))).toBe('40')
      expect(claimToken(d(1) + d(2) + d(3) + d(4) + d(5) + d(6) + d(7) + d(8) + d(9) + d(0))).toBe('1234567890')
    })
  }

  it('reads a native-digit number with its % and its Indian grouping', () => {
    expect(one('४०%')).toEqual({ n: 40, unit: '%' })
    expect(one('౪౦%')).toEqual({ n: 40, unit: '%' })
    expect(one('१,००,०००')).toEqual({ n: 100000, unit: '' })
    expect(one('౧,౦౦,౦౦౦')).toEqual({ n: 100000, unit: '' })
  })

  it('reads no number from digits of two scripts, as numberOf reads none', () => {
    expect(numbersIn(claimTokensOf('4०'))).toEqual([])
    expect(numberOf('4०')).toBeNull()
  })
})

describe('rule 4: a number is canonical {n, unit, currency?}', () => {
  it("claimToken keeps the decimal point: '1.2' is not '12'", () => {
    // automation/keywords.ts's normaliseToken maps '1.2' to '12' (§6.7).
    expect(claimToken('1.2')).toBe('1.2')
    expect(claimTokensOf('1.2 million')).toEqual(['1.2', 'million'])
  })

  it('numbersIn reads 1.2 as 1.2, not 12', () => {
    expect(numbersIn(['1.2'])).toEqual([{ value: { n: 1.2, unit: '' }, at: 0 }])
    expect(numbersIn(['12'])).toEqual([{ value: { n: 12, unit: '' }, at: 0 }])
    expect(numbersIn(['40,000.50'])[0].value.n).toBe(40000.5)
  })

  it('takes Indian grouping as western: 10,00,000 = 1,000,000', () => {
    expect(numbersIn(['10,00,000'])).toEqual([{ value: { n: 1_000_000, unit: '' }, at: 0 }])
    expect(numbersIn(['10,00,000'])).toEqual(numbersIn(['1,000,000']))
    expect(numbersIn(['1,00,000'])[0].value.n).toBe(100_000)
    expect(numbersIn(['1,50,00,000'])[0].value.n).toBe(15_000_000)
    expect(numbersIn(['40,000'])[0].value.n).toBe(40_000)
  })

  it('reads no number from a grouping that is neither western nor Indian', () => {
    expect(numbersIn(['1,0'])).toEqual([])
    expect(numbersIn(['1234,567'])).toEqual([])
    expect(numbersIn(['1,00'])).toEqual([])
  })

  it('reads no number from a grouping whose middle groups mix lengths', () => {
    for (const v of ['1,000,00,000', '1,00,000,000']) {
      expect(numbersIn([v]), v).toEqual([])
      expect(numberOf(v), v).toBeNull()
    }
  })

  it('applies each suffix multiplier written on the digits', () => {
    expect(numbersIn(['4k'])[0].value.n).toBe(4_000)
    expect(numbersIn(['12m'])[0].value.n).toBe(12_000_000)
    expect(numbersIn(['3mn'])[0].value.n).toBe(3_000_000)
    expect(numbersIn(['2bn'])[0].value.n).toBe(2_000_000_000)
    expect(numbersIn(['2b'])[0].value.n).toBe(2_000_000_000)
  })

  it('reads no number from other letters on the digits', () => {
    expect(numbersIn(['1st'])).toEqual([])
    expect(numbersIn(['4x'])).toEqual([])
  })

  it('applies each word multiplier', () => {
    expect(one('5 thousand').n).toBe(5_000)
    expect(one('15 million').n).toBe(15_000_000)
    expect(one('2 billion').n).toBe(2_000_000_000)
    expect(one('3 lakh').n).toBe(300_000)
    expect(one('3 lakhs').n).toBe(300_000)
    expect(one('2 crore').n).toBe(20_000_000)
    expect(one('2 crores').n).toBe(20_000_000)
    expect(one('two million').n).toBe(2_000_000)
  })

  // A scale word numbersIn does not apply, after a number: no number, never the bare digits.
  const UNREAD: [string, string][] = [
    ['hundred after digits', 'we had 5 hundred guests'],
    ['a second multiplier', 'a budget of ₹40 lakh crore'],
    ['a second multiplier on a decimal', '1.5 lakh crore'],
    ['trillion', 'a $2 trillion market'],
    ['dozen', 'two dozen roses'],
    ['grand', '40 grand'],
    ['k alone', 'we hit 4 k'],
    ['m alone', 'we raised $5 m last year'],
    ['mn alone', '$5 mn'],
    ['b alone', 'plan 4 b'],
    ['bn alone', '$4 bn'],
    ['लाख', '₹40 लाख का बजट'],
    ['हज़ार', '40 हज़ार लोग आए'],
    ['हजार', '40 हजार लोग आए'],
    ['करोड़', '₹2 करोड़'],
    ['सौ', '5 सौ लोग'],
    ['లక్ష', '2 లక్ష'],
    ['లక్షలు', '2 లక్షలు'],
    ['వేల', '40 వేల మంది'],
    ['వేలు', '40 వేలు'],
    ['కోట్లు', '2 కోట్లు'],
    ['వంద', '5 వంద'],
    ['hundreds', '5 hundreds'],
    ['thousands', '5 thousands'],
    ['millions', '2 millions'],
    ['billions', '2 billions'],
    ['trillions', '2 trillions'],
    ['dozens', '2 dozens'],
    ['हज़ारों', '40 हज़ारों लोग'],
    ['हजारों', '40 हजारों लोग'],
    ['लाखों', '40 लाखों'],
    ['करोड़ों', '2 करोड़ों'],
    ['अरब', '2 अरब'],
    ['खरब', '2 खरब'],
    ['వందల', '5 వందల'],
    ['వందలు', '5 వందలు'],
    ['వేయి', '5 వేయి'],
    ['వెయ్యి', '5 వెయ్యి'],
    ['లక్షల', '2 లక్షల'],
    ['కోటి', '2 కోటి'],
    ['కోట్ల', '2 కోట్ల']
  ]
  for (const [name, text] of UNREAD) {
    it(`reads no number before an unread scale word: ${name}`, () => {
      expect(numbersIn(claimTokensOf(text)), text).toEqual([])
    })
  }

  it("reads no number on either side of 'point'", () => {
    expect(numbersIn(claimTokensOf('one point two million views'))).toEqual([])
    expect(numbersIn(claimTokensOf('point five percent'))).toEqual([])
  })

  it('never joins number words across a clause or sentence mark', () => {
    expect(numbersIn(claimTokensOf('we had forty, two of them came back')).map((f) => f.value.n)).toEqual([40, 2])
    expect(numbersIn(claimTokensOf('top twenty, five were brides')).map((f) => f.value.n)).toEqual([20, 5])
    expect(numbersIn(claimTokensOf('forty. Two')).map((f) => f.value.n)).toEqual([40, 2])
    expect(numbersIn(claimTokensOf('forty — two')).map((f) => f.value.n)).toEqual([40, 2])
    expect(numbersIn(claimTokensOf('two hundred, five')).map((f) => f.value.n)).toEqual([200, 5])
    expect(numbersIn(claimTokensOf('three thousand; five')).map((f) => f.value.n)).toEqual([3000, 5])
  })

  it("reads no number from a currency number with a percent ('$40%')", () => {
    expect(numbersIn(claimTokensOf('$40%'))).toEqual([])
    expect(numbersIn(claimTokensOf('$40 percent'))).toEqual([])
    expect(numbersIn(claimTokensOf('₹40 per cent'))).toEqual([])
  })

  it("reads no number from a currency sign and another currency's word ('$40 rupees')", () => {
    expect(numbersIn(claimTokensOf('$40 rupees'))).toEqual([])
    expect(one('$40 dollars')).toEqual({ n: 40, unit: 'currency', currency: '$' })
  })

  it("reads only a ten and a unit as hyphenated number words ('fifty-fifty' is none)", () => {
    expect(numbersIn(claimTokensOf('fifty-fifty'))).toEqual([])
    expect(numbersIn(claimTokensOf('forty-two-three'))).toEqual([])
  })

  it('reads every English number word, zero to nineteen and the tens', () => {
    const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
      'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
    small.forEach((w, n) => expect(one(w).n, w).toBe(n))
    const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
    tens.forEach((w, i) => expect(one(w).n, w).toBe(20 + 10 * i))
  })

  it('reads compound number words, hyphenated or spaced, with hundred and thousand', () => {
    expect(one('forty-two').n).toBe(42)
    expect(one('forty two').n).toBe(42)
    expect(one('Ninety-Nine.').n).toBe(99)
    expect(one('a hundred').n).toBe(100)
    expect(one('two hundred').n).toBe(200)
    expect(one('two hundred and five').n).toBe(205)
    expect(one('three thousand').n).toBe(3_000)
    expect(one('forty two thousand five hundred').n).toBe(42_500)
    expect(one('a hundred thousand').n).toBe(100_000)
  })

  it("'forty percent' = '40%' = '40 per cent'", () => {
    expect(one('forty percent')).toEqual({ n: 40, unit: '%' })
    expect(one('forty percent')).toEqual(one('40%'))
    expect(one('40 per cent')).toEqual(one('40%'))
    expect(one('40 percent.')).toEqual(one('40%'))
  })

  it("'$1.2M' = '1.2 million dollars'", () => {
    expect(one('$1.2M')).toEqual({ n: 1_200_000, unit: 'currency', currency: '$' })
    expect(one('$1.2M')).toEqual(one('1.2 million dollars'))
  })

  it('reads each currency by sign and by word', () => {
    expect(one('₹500')).toEqual({ n: 500, unit: 'currency', currency: '₹' })
    expect(one('500 rupees')).toEqual(one('₹500'))
    expect(one('one rupee')).toEqual({ n: 1, unit: 'currency', currency: '₹' })
    expect(one('Rs. 500')).toEqual(one('₹500'))
    expect(one('500 rs')).toEqual(one('₹500'))
    expect(one('€3')).toEqual({ n: 3, unit: 'currency', currency: '€' })
    expect(one('3 euros')).toEqual(one('€3'))
    expect(one('£3')).toEqual({ n: 3, unit: 'currency', currency: '£' })
    expect(one('3 pounds')).toEqual(one('£3'))
    expect(one('$40')).toEqual(one('forty dollars'))
    expect(one('₹2 crore')).toEqual({ n: 20_000_000, unit: 'currency', currency: '₹' })
  })

  it('a bare number has no unit, and units differ between numbers of one value', () => {
    expect(one('40')).toEqual({ n: 40, unit: '' })
    expect(one('40')).not.toEqual(one('40%'))
    expect(one('$40')).not.toEqual(one('40%'))
    expect(one('$40')).not.toEqual(one('€40'))
  })

  it('finds every number of a run, each at its token index', () => {
    const tokens = claimTokensOf('We spent $40 on ads and 40% of signups came from them.')
    expect(numbersIn(tokens)).toEqual([
      { value: { n: 40, unit: 'currency', currency: '$' }, at: 3 },
      { value: { n: 40, unit: '%' }, at: 7 }
    ])
    expect(numbersIn(claimTokensOf('we signed 40 clients'))).toEqual([{ value: { n: 40, unit: '' }, at: 2 }])
    const offices = numbersIn(claimTokensOf('We had 3 offices and 40 staff in 2019, now 12 offices'))
    // '2019,' is ['2019', CLAUSE_BREAK]: 12 is token 11.
    expect(offices.map((f) => [f.value.n, f.at])).toEqual([[3, 2], [40, 5], [2019, 8], [12, 11]])
  })

  it("a hyphenated number word's index is its token's, and the tokens after it keep theirs", () => {
    expect(numbersIn(claimTokensOf('forty-two and 5 more'))).toEqual([
      { value: { n: 42, unit: '' }, at: 0 },
      { value: { n: 5, unit: '' }, at: 2 }
    ])
  })

  it('does not parse Hindi or Telugu number words (v1: a digit for a word said is dropped)', () => {
    expect(numbersIn(claimTokensOf('चालीस प्रतिशत'))).toEqual([])
    expect(numbersIn(claimTokensOf('నలభై శాతం'))).toEqual([])
  })

  it('reads no number from a word that only looks like a key of an object', () => {
    expect(numbersIn(claimTokensOf('the constructor of tostring valueof'))).toEqual([])
  })
})

describe('numbers.ts and claims.ts agree on the value of every numeric fixture value', () => {
  interface Item {
    value?: string
  }
  const values: { id: string; value: string }[] = []
  for (const f of specs.specs as { id: string; spec: { data: { value?: string; items?: Item[] } } }[]) {
    const d = f.spec.data
    if (typeof d.value === 'string') values.push({ id: f.id, value: d.value })
    for (const item of d.items ?? []) if (typeof item.value === 'string') values.push({ id: f.id, value: item.value })
  }

  it('finds the fixtures it compares', () => {
    // counter ×3, bars 5 + 3 + 2, ring ×3 (tests/fixtures/graphics/specs.json).
    expect(values.length).toBeGreaterThanOrEqual(16)
  })

  it('each value is one number in both, and the same number', () => {
    for (const { id, value } of values) {
      const drawn = numberOf(value)
      expect(drawn, `${id} "${value}" numberOf`).not.toBeNull()
      const said = numbersIn(claimTokensOf(value))
      expect(said, `${id} "${value}" numbersIn`).toHaveLength(1)
      expect(said[0].value.n, `${id} "${value}"`).toBe(drawn)
    }
  })
})

describe('the lists rules 6-8 name', () => {
  it('BIND_WINDOW is 8 (rule 6)', () => {
    expect(BIND_WINDOW).toBe(8)
  })

  it("holds every negator rule 7 lists, each already in claimToken's form", () => {
    for (const w of ['not', 'no', 'never', "n't", 'without', 'nor', 'neither', 'none', 'nobody', 'nothing']) {
      expect(NEGATORS.en, w).toContain(w)
    }
    for (const w of ['नहीं', 'न', 'मत']) expect(NEGATORS.hi, w).toContain(w)
    for (const w of ['కాదు', 'లేదు']) expect(NEGATORS.te, w).toContain(w)
    for (const list of Object.values(NEGATORS)) for (const w of list) expect(claimToken(w), w).toBe(w)
  })

  it("holds rule 8's forty English function words, each in claimToken's form", () => {
    const listed = ('a an the of to in on at for from by with and or but so as is are was were be been it its ' +
      'this that these those our my your their we i you they he she have').split(' ')
    expect(listed).toHaveLength(40)
    for (const w of listed) expect(FUNCTION_WORDS_EN, w).toContain(w)
    // Both ways: a content word added to the list would be exempt from grounding.
    for (const w of FUNCTION_WORDS_EN) expect(listed, w).toContain(w)
    for (const w of FUNCTION_WORDS_EN) expect(claimToken(w), w).toBe(w)
    expect(new Set(FUNCTION_WORDS_EN).size).toBe(FUNCTION_WORDS_EN.length)
  })

  it('FUNCTION_WORDS_EN holds no negator, direction word or comparative (rule 8: never exempt)', () => {
    const directions = ['up', 'down', 'over', 'under', 'before', 'after']
    const comparatives = ['more', 'less', 'fewer', 'than']
    for (const list of [NEGATORS.en, NEGATORS.hi, NEGATORS.te, directions, comparatives]) {
      for (const w of list) expect(FUNCTION_WORDS_EN, w).not.toContain(w)
    }
  })
})

// ---------------------------------------------------------------------------
// The second half: claimsOf and bind.

/**
 * A stretch as the validator gets it: real Word[] (indices from `first`, 400 ms
 * each) and one Segment per sentence, wordStart..wordEnd inclusive.
 */
function stretchOf(sentences: string[], first = 100): ClaimStretch {
  const words: Word[] = []
  const segs: Segment[] = []
  let index = first
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * 400, endMs: index * 400 + 350, confidence: null })
      index += 1
    }
    segs.push({
      id: `s${String(k).padStart(2, '0')}`,
      startMs: start * 400,
      endMs: (index - 1) * 400 + 350,
      text,
      wordStart: start,
      wordEnd: index - 1
    })
  })
  return { words, sentences: segs }
}

/** The word index of the first word of `sentence` (in a stretch built by `stretchOf`) whose text is `text`. */
function wordAt(stretch: ClaimStretch, text: string): number {
  const found = stretch.words.filter((w) => w.text === text)
  expect(found, `"${text}" in the stretch`).toHaveLength(1)
  return found[0].index
}

function def(id: keyof typeof GRAPHIC_TEMPLATES): TemplateDef {
  const d = GRAPHIC_TEMPLATES[id]
  expect(d, id).toBeDefined()
  return d!
}

function bindData(data: GraphicData, sentences: string[], lang = 'en'): ReturnType<typeof bind> {
  return bind(claimsOf(data, def(data.template)), stretchOf(sentences), lang)
}

function bars(items: [label: string, value: string][], title = 'By the numbers'): GraphicData {
  return { template: 'bars', title, items: items.map(([label, value]) => ({ label, value })) }
}

describe('claimsOf', () => {
  it("a counter: its value one number claim, its label's content tokens, both in pair 0", () => {
    const claims = claimsOf({ template: 'counter', value: '40 percent', label: 'of couples book in March' }, def('counter'))
    expect(claims).toMatchObject([
      { path: 'value', text: '40 percent', kind: 'number', value: { n: 40, unit: '%' }, pair: 0 },
      { path: 'label', text: 'couples', kind: 'token', pair: 0 },
      { path: 'label', text: 'book', kind: 'token', pair: 0 },
      { path: 'label', text: 'march', kind: 'token', pair: 0 }
    ])
  })

  it('bars: each item its own pair, in item order; a fixed title makes no claim, a said title does', () => {
    const fixed = claimsOf(bars([['Ads', '$40'], ['Signups', '40%']]), def('bars'))
    expect(fixed.map((c) => [c.path, c.kind, c.pair])).toEqual([
      ['items[0].label', 'token', 0],
      ['items[0].value', 'number', 0],
      ['items[1].label', 'token', 1],
      ['items[1].value', 'number', 1]
    ])
    const said = claimsOf(bars([['Ads', '40']], 'Where the money went'), def('bars'))
    expect(said.filter((c) => c.path === 'title').map((c) => c.text)).toEqual(['where', 'money', 'went'])
    expect(said.find((c) => c.path === 'title')?.pair).toBeUndefined()
  })

  it('a value field that is not exactly one number has no value, so it binds nowhere', () => {
    for (const value of ['40 clients', '40 to 50', 'forty-ish', '', 'one point two million']) {
      const [c] = claimsOf({ template: 'counter', value, label: '' }, def('counter'))
      expect(c, value).toMatchObject({ kind: 'number', path: 'value' })
      expect(c.value, value).toBeUndefined()
    }
  })

  it('negators, direction words and comparatives are claims; function words are not', () => {
    const texts = claimsOf({ template: 'callout', label: 'not up to the more than before', shape: 'arrow' }, def('callout'))
      .map((c) => c.text)
    for (const w of ['not', 'up', 'more', 'than', 'before']) expect(texts, w).toContain(w)
    for (const w of ['to', 'the']) expect(texts, w).not.toContain(w)
  })

  it('in Hindi and Telugu every token is a claim', () => {
    expect(claimsOf({ template: 'callout', label: 'दुल्हन का लहंगा', shape: 'arrow' }, def('callout')).map((c) => c.text))
      .toEqual(['दुल्हन', 'का', 'लहंगा'])
    expect(claimsOf({ template: 'callout', label: 'పెళ్లి మండపం', shape: 'circle' }, def('callout')).map((c) => c.text))
      .toEqual(['పెళ్లి', 'మండపం'])
  })

  it('no claim of an index, user, speaker, fixed or app field', () => {
    expect(claimsOf({ template: 'keyword', words: 'Light beats gear', lit: 1 }, def('keyword'))).toMatchObject([
      { path: 'words', text: 'Light beats gear', kind: 'run', mid: true }
    ])
    expect(claimsOf({ template: 'quote', kind: 'said', text: 'Fail fast', speaker: 'Elon' }, def('quote'))).toMatchObject([
      { path: 'text', text: 'Fail fast', kind: 'run' }
    ])
    const social: GraphicData = { template: 'quote', kind: 'social', text: 'hi', name: 'n', handle: 'h', date: 'd', link: 'l' }
    expect(claimsOf(social, def('quote'))).toEqual([])
    expect(claimsOf({ template: 'lower-third', name: 'Priya', role: 'Photographer' }, def('lower-third'))).toEqual([])
    expect(claimsOf({ template: 'callout', label: 'bride', shape: 'circle' }, def('callout')).map((c) => c.path))
      .toEqual(['label'])
    const steps = claimsOf({
      template: 'steps', title: 'Step by step', connector: 'tree',
      items: [{ label: 'Charge batteries', parent: -1 }, { label: 'Format cards', parent: 0 }]
    }, def('steps'))
    expect(steps.map((c) => c.path)).toEqual(['items[0].label', 'items[0].label', 'items[1].label', 'items[1].label'])
    for (const c of steps) expect(c.pair, c.path).toBeUndefined()
  })
})

describe('bind: the review cases, each named (§6.7, "Why it binds, not just matches")', () => {
  it('"we signed 40 clients" + ring 40: binds, and the matched number carries no % (rule 9 drops the ring)', () => {
    // Deferred to validateGraphics.ts (piece 3): the ring rule that drops it on matched[0].unit.
    const r = bindData({ template: 'ring', value: '40', label: 'clients' }, ['we signed 40 clients'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matched[0]).toEqual({ n: 40, unit: '' })
  })

  it('"we spent $40 on ads and 40% of signups" + bars with BARE values: the matched numbers carry two units', () => {
    // The spec strings share a unit (none); the matched numbers do not. Rule 9's bars rule
    // (piece 3) drops on the matched units, which bind must give as the stretch's, not the spec's.
    // Said so that 'signups' is 13 tokens from '$40': the window alone forces it onto the 40%, so
    // only the spec-strings mutation (not one occurrence bound twice) gives the units ['', ''].
    const said = ['We spent $40 on ads last month and then 40% of all our new signups came from them.']
    const r = bindData(bars([['ads', '40'], ['signups', '40']]), said)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const units = r.matched.filter((m): m is CanonNumber => m !== undefined).map((m) => m.unit)
    expect(units).toEqual(['currency', '%'])
  })

  it("the Instagram/referrals swap in §6.7's own sentence: 'referrals' is 12 words from '30%', so the window drops it first", () => {
    const full = ['Last year 30% of our clients came from Instagram and 70% from referrals.']
    expect(bindData(bars([['Instagram', '70%'], ['referrals', '30%']]), full)).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('the Instagram/referrals swap: bars [Instagram 70%, referrals 30%] → order', () => {
    // Said tighter, every label sits within the window of its swapped value, and only the order rule drops it.
    const st = stretchOf(['30% came from Instagram and 70% from referrals.'])
    // 7 words on, 8 tokens past the '%' token: the window's edge, inside it.
    expect(wordAt(st, 'referrals.') - wordAt(st, '30%')).toBe(7)
    const r = bind(claimsOf(bars([['Instagram', '70%'], ['referrals', '30%']]), def('bars')), st, 'en')
    expect(r).toMatchObject({ ok: false, reason: 'order' })
  })

  it('"3 offices and 40 staff in 2019, now 12 offices" + bars [2019: 12, now: 3] → order', () => {
    const said = ['We had 3 offices and 40 staff in 2019, now 12 offices.']
    expect(bindData(bars([['2019', '12'], ['now', '3']]), said)).toMatchObject({ ok: false, reason: 'order' })
  })

  it('"It\'s not true that 90% of startups fail" + ring 90% → negated', () => {
    const r = bindData({ template: 'ring', value: '90%', label: 'of startups fail' }, ["It's not true that 90% of startups fail."])
    expect(r).toMatchObject({ ok: false, reason: 'negated' })
  })

  it('"I\'d never tell you to quit your job" + quote "quit your job" → refused', () => {
    // Refused as 'absent': 'quit' starts mid-clause (after 'to'), so the boundary rule refuses it before
    // rule 7 (which would also refuse it) is reached. Double-guarded: no single mutation keeps it. The
    // after-a-negator rule's own case is "I would say never, quit your job." below.
    const quote: GraphicData = { template: 'quote', kind: 'said', text: 'quit your job', speaker: '' }
    expect(bindData(quote, ["I'd never tell you to quit your job."])).toMatchObject({ ok: false, reason: 'absent' })
  })

  it('stretch "clients happy" + label "clients not happy" → absent', () => {
    const r = bindData({ template: 'counter', value: '40', label: 'clients not happy' }, ['We kept 40 clients happy.'])
    expect(r).toMatchObject({ ok: false, reason: 'absent' })
    if (r.ok) return
    expect(r.missing.map((c) => c.text)).toEqual(['not'])
  })

  it("a counter's label taken from the next sentence, within 8 tokens across the boundary → unpaired", () => {
    const said = ['We shot 300.', 'Weddings were most of it.']
    const st = stretchOf(said)
    const claims = claimsOf({ template: 'counter', value: '300', label: 'weddings' }, def('counter'))
    // The label is one spoken token past the value: inside the window, outside the sentence.
    expect(wordAt(st, 'Weddings') - wordAt(st, '300.')).toBe(1)
    expect(bind(claims, st, 'en')).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('a label 12 tokens from its value in one sentence → unpaired', () => {
    const said = ['We filmed 300 last year across the coast and the green hills in winter weddings.']
    const st = stretchOf(said)
    expect(wordAt(st, 'weddings.') - wordAt(st, '300')).toBe(12)
    const r = bind(claimsOf({ template: 'counter', value: '300', label: 'weddings' }, def('counter')), st, 'en')
    expect(r).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('a unit added by the model fails', () => {
    expect(bindData({ template: 'counter', value: '40%', label: 'clients' }, ['we signed 40 clients']))
      .toMatchObject({ ok: false, reason: 'unit' })
    expect(bindData({ template: 'ring', value: '40%', label: 'clients' }, ['we signed 40 clients']))
      .toMatchObject({ ok: false, reason: 'unit' })
    expect(bindData({ template: 'counter', value: '$40', label: 'clients' }, ['we signed 40% of clients']))
      .toMatchObject({ ok: false, reason: 'unit' })
    expect(bindData({ template: 'counter', value: '€40', label: 'ads' }, ['we spent $40 on ads']))
      .toMatchObject({ ok: false, reason: 'unit' })
  })

  it('a unit dropped passes where the template allows it, the matched unit given for the template to judge', () => {
    // A counter draws data.value only (rule 5); a ring needs the matched %, which this one has.
    const dropped = bindData({ template: 'counter', value: '40', label: 'couples' }, ['40% of couples book in March.'])
    expect(dropped.ok).toBe(true)
    if (dropped.ok) expect(dropped.matched[0]).toEqual({ n: 40, unit: '%' })
  })

  it('one 40 said, two bars of 40: no two claims bind the same occurrence → unpaired', () => {
    const r = bindData(bars([['ads', '40'], ['signups', '40']]), ['We spent 40 on ads and signups.'])
    expect(r).toMatchObject({ ok: false, reason: 'unpaired' })
  })
})

describe('bind: what passes, and where it binds', () => {
  it('the swap the right way round binds, one word index per claim in claim order', () => {
    const st = stretchOf(['Last year 30% of our clients came from Instagram and 70% from referrals.'])
    const claims = claimsOf(bars([['Instagram', '30%'], ['referrals', '70%']]), def('bars'))
    const r = bind(claims, st, 'en')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.at).toEqual([wordAt(st, 'Instagram'), wordAt(st, '30%'), wordAt(st, 'referrals.'), wordAt(st, '70%')])
    expect(r.matched).toEqual([undefined, { n: 30, unit: '%' }, undefined, { n: 70, unit: '%' }])
  })

  it("it's true that 90% of startups fail binds the ring", () => {
    expect(bindData({ template: 'ring', value: '90%', label: 'of startups fail' }, ["It's true that 90% of startups fail."]).ok)
      .toBe(true)
  })

  it('a label negated in its own words binds where the stretch says it; its value in that clause does not', () => {
    expect(bindData({ template: 'callout', label: 'clients not happy', shape: 'arrow' }, ['Look, clients not happy.']).ok)
      .toBe(true)
    // Rule 7 is per field: the value '40' lacks the clause's 'not', so the counter drops.
    expect(bindData({ template: 'counter', value: '40', label: 'clients not happy' }, ['We had 40 clients not happy.']))
      .toMatchObject({ ok: false, reason: 'negated' })
  })

  it('a negator two clauses back does not negate the claim; the clause directly before does (piece 3 fix)', () => {
    // Rule 7's clause, and the one directly before it in the sentence: a negated clause governs the one
    // after its mark. Two clauses back it does not.
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['Not last year, as you know, but now we have 40 clients.']).ok)
      .toBe(true)
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['Not last year, but now we have 40 clients.']))
      .toMatchObject({ ok: false, reason: 'negated' })
    // The cost, the safe direction: an affirming 'No,' drops a true counter too.
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['No, we have 40 clients.']))
      .toMatchObject({ ok: false, reason: 'negated' })
    // A clause before the sentence's start is not the claim's: the previous sentence's 'not' does not reach.
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['It was not easy.', 'We have 40 clients.']).ok)
      .toBe(true)
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ["We don't have 40 clients."]))
      .toMatchObject({ ok: false, reason: 'negated' })
  })

  it('the cited fact may sit in a neighbouring sentence of the stretch', () => {
    expect(bindData({ template: 'counter', value: '300', label: 'weddings' }, ['Hi.', 'We shot 300 weddings.', 'Bye.']).ok).toBe(true)
  })

  it('folds English plurals on both sides, and only in English', () => {
    expect(bindData({ template: 'counter', value: '40', label: 'client' }, ['we signed 40 clients']).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '40', label: 'boxes' }, ['we sold 40 box']).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '40', label: 'client' }, ['we signed 40 clients'], 'hi').ok).toBe(false)
  })

  it('a word said as a number word binds a digit, Indian grouping and native digits too', () => {
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['we signed forty clients']).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '10,00,000', label: 'views' }, ['ten lakh views on the reel']).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '10,00,000', label: 'views' }, ['10 lakh views on the reel']).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '౩౦౦', label: 'పెళ్లిళ్లు' }, ['మేము ౩౦౦ పెళ్లిళ్లు చేశాము'], 'te').ok).toBe(true)
  })

  it('a Hindi or Telugu number said in words is not bound by a digit (v1: dropped)', () => {
    expect(bindData({ template: 'counter', value: '40%', label: 'జంటలు' }, ['నలభై శాతం జంటలు'], 'te'))
      .toMatchObject({ ok: false, reason: 'absent' })
  })
})

describe('bind: unpaired grounded fields bind as one run', () => {
  const callout = (label: string): GraphicData => ({ template: 'callout', label, shape: 'arrow' })

  it('binds in spoken order with gaps of up to 3', () => {
    expect(bindData(callout('The ring bearer'), ['Watch the ring bearer here.']).ok).toBe(true)
    expect(bindData(callout('ring bearer'), ['The ring and the little bearer.']).ok).toBe(true)
  })

  it('out of spoken order → unpaired', () => {
    expect(bindData(callout('ring bearer'), ['The bearer of the ring.'])).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('a gap of 4 → unpaired', () => {
    expect(bindData(callout('ring bearer'), ['The ring and the very little bearer.'])).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('across two sentences → unpaired', () => {
    expect(bindData(callout('ring bearer'), ['The ring.', 'The bearer.'])).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('every Hindi token is checked', () => {
    expect(bindData(callout('दुल्हन का लहंगा'), ['यह दुल्हन का लहंगा है'], 'hi').ok).toBe(true)
    expect(bindData(callout('दुल्हन का लहंगा'), ['यह दुल्हन लहंगा है'], 'hi')).toMatchObject({ ok: false, reason: 'absent' })
  })
})

describe('bind: verbatim runs', () => {
  const quote = (text: string): GraphicData => ({ template: 'quote', kind: 'said', text, speaker: '' })

  it('a whole clause or sentence binds, its first word recorded', () => {
    const st = stretchOf(['Honestly, put the camera where the light is.'])
    const r = bind(claimsOf(quote('Put the camera where the light is'), def('quote')), st, 'en')
    expect(r).toMatchObject({ ok: true, at: [wordAt(st, 'put')], matched: [undefined] })
  })

  it('a run that starts or ends mid-clause is refused', () => {
    expect(bindData(quote('the camera where the light is'), ['Put the camera where the light is.'])).toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData(quote('put the camera'), ['Put the camera where the light is.'])).toMatchObject({ ok: false, reason: 'absent' })
  })

  it('a run across two sentences is refused', () => {
    expect(bindData(quote('fail fast learn fast'), ['Fail fast.', 'Learn fast.'])).toMatchObject({ ok: false, reason: 'absent' })
  })

  it('a run directly after a negator is refused, at the clause the caller may demote to', () => {
    const st = stretchOf(['I would say never, quit your job.'])
    const r = bind(claimsOf(quote('quit your job'), def('quote')), st, 'en')
    expect(r).toMatchObject({ ok: false, reason: 'negated' })
    if (r.ok) return
    expect(r.at).toEqual([wordAt(st, 'quit')])
    expect(clauseAt(st, r.at![0])).toEqual({ start: wordAt(st, 'quit'), end: wordAt(st, 'job.') })
    expect(clauseAt(st, wordAt(st, 'never,'))).toEqual({ start: wordAt(st, 'I'), end: wordAt(st, 'never,') })
  })

  it("keyword's run may sit mid-clause, but not in a negated clause or after a negator", () => {
    const kw = (words: string): GraphicData => ({ template: 'keyword', words, lit: 0 })
    expect(bindData(kw('expensive gear'), ['Light beats expensive gear every time.']).ok).toBe(true)
    expect(bindData(kw('easy'), ['This is not easy.'])).toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData(kw('easy'), ['This is not really easy.'])).toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData(kw('my job'), ['I love my.', 'Job is great.'])).toMatchObject({ ok: false, reason: 'absent' })
  })
})

describe('bind is pure over its claims', () => {
  it('claims with no value bind nowhere, and no claims bind trivially', () => {
    const none: Claim = { path: 'value', text: 'x', kind: 'number', pair: 0 }
    expect(bind([none], stretchOf(['we signed 40 clients']), 'en')).toMatchObject({ ok: false, reason: 'absent', missing: [none] })
    expect(bind([], stretchOf(['anything']), 'en')).toMatchObject({ ok: true, at: [], matched: [] })
  })
})

describe('numbersIn: what is no number, so a claim for it is dropped (the fix after the critics)', () => {
  it("years said in pairs are no number ('nineteen ninety nine' is neither 19 nor 99)", () => {
    expect(numbersIn(claimTokensOf('in nineteen ninety nine we had clients'))).toEqual([])
    expect(numbersIn(claimTokensOf('twenty twenty one'))).toEqual([])
    // Still read: one group, and two groups apart.
    expect(one('nineteen hundred and ninety nine').n).toBe(1999)
    expect(numbersIn(claimTokensOf('nineteen brides, ninety guests')).map((f) => f.value.n)).toEqual([19, 90])
  })

  it("a number followed by a fraction is no number ('two and a half million', 'three quarters')", () => {
    expect(numbersIn(claimTokensOf('we got two and a half million views'))).toEqual([])
    expect(numbersIn(claimTokensOf('2 and a half'))).toEqual([])
    expect(numbersIn(claimTokensOf('three quarters of couples'))).toEqual([])
    expect(numbersIn(claimTokensOf('two million and a half'))).toEqual([])
    // 'and' then no fraction: both read.
    expect(numbersIn(claimTokensOf('two and fifty')).map((f) => f.value.n)).toEqual([2, 50])
  })

  it("two numbers joined as a range or a ratio are no number ('40 to 50', '1 in 4', '3 out of 4')", () => {
    for (const text of ['40 to 50 clients', 'forty or fifty clients', '1 in 4 couples', '3 out of 4 couples', '3 of 4']) {
      expect(numbersIn(claimTokensOf(text)), text).toEqual([])
    }
    expect(numbersIn(claimTokensOf('40 clients to 50 staff')).map((f) => f.value.n)).toEqual([40, 50])
  })
})

describe('bind: the false graphics the critics found, each named and dropped', () => {
  it('"In nineteen ninety nine we had clients." + counter 99 or 19 → absent (a year is not a count)', () => {
    const said = ['In nineteen ninety nine we had clients.']
    expect(bindData({ template: 'counter', value: '99', label: 'clients' }, said)).toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData({ template: 'counter', value: '19', label: 'clients' }, said)).toMatchObject({ ok: false, reason: 'absent' })
  })

  it('"We got two and a half million views." + counter 2 / "million views" → absent', () => {
    expect(bindData({ template: 'counter', value: '2', label: 'million views' }, ['We got two and a half million views.']))
      .toMatchObject({ ok: false, reason: 'absent' })
  })

  it('"1 in 4 couples." + counter 4 couples, "We had 40 to 50 clients." + counter 40 → absent', () => {
    expect(bindData({ template: 'counter', value: '4', label: 'couples' }, ['1 in 4 couples.']))
      .toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['We had 40 to 50 clients.']))
      .toMatchObject({ ok: false, reason: 'absent' })
  })

  it('a value the speaker did not say does not bind: 41 or 40.5 over "we signed 40 clients" → absent', () => {
    for (const value of ['41', '40.5', '40.000001']) {
      expect(bindData({ template: 'counter', value, label: 'clients' }, ['we signed 40 clients']), value)
        .toMatchObject({ ok: false, reason: 'absent' })
    }
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, ['we signed 40 clients']).ok).toBe(true)
  })

  it('"Instagram gave us 30%, referrals 70%, and Instagram keeps growing." + bars [Instagram 70%, referrals 30%] → unpaired', () => {
    // 'Instagram' said twice: its second occurrence lets the false chart keep spoken order. Both pairings
    // bind, so the stretch cannot tell them apart, and the graphic is dropped (either way round).
    const said = ['Instagram gave us 30%, referrals 70%, and Instagram keeps growing.']
    expect(bindData(bars([['Instagram', '70%'], ['referrals', '30%']]), said)).toMatchObject({ ok: false, reason: 'unpaired' })
    expect(bindData(bars([['Instagram', '30%'], ['referrals', '70%']]), said)).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it('"We had 40 clients and 12 staff." + counter 12 / clients → unpaired; each true counter binds', () => {
    const said = ['We had 40 clients and 12 staff.']
    expect(bindData({ template: 'counter', value: '12', label: 'clients' }, said)).toMatchObject({ ok: false, reason: 'unpaired' })
    expect(bindData({ template: 'counter', value: '40', label: 'clients' }, said).ok).toBe(true)
    expect(bindData({ template: 'counter', value: '12', label: 'staff' }, said).ok).toBe(true)
  })

  it('"10% of staff quit and 90% of interns stayed." + ring 90% / "of staff quit" → unpaired', () => {
    const said = ['10% of staff quit and 90% of interns stayed.']
    expect(bindData({ template: 'ring', value: '90%', label: 'of staff quit' }, said)).toMatchObject({ ok: false, reason: 'unpaired' })
    expect(bindData({ template: 'ring', value: '90%', label: 'of interns stayed' }, said).ok).toBe(true)
  })

  it("rule 7's other spellings: 'cannot', 'dont' without its apostrophe, Hindi 'नही' → negated", () => {
    const ring: GraphicData = { template: 'ring', value: '90%', label: 'of startups fail' }
    expect(bindData(ring, ['You cannot say 90% of startups fail.'])).toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData(ring, ['I dont think 90% of startups fail.'])).toMatchObject({ ok: false, reason: 'negated' })
    const quote: GraphicData = { template: 'quote', kind: 'said', text: 'quit your job', speaker: '' }
    expect(bindData(quote, ['I would say dont, quit your job.'])).toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData({ template: 'counter', value: '40', label: 'ग्राहक खुश' }, ['40 ग्राहक खुश नही थे।'], 'hi'))
      .toMatchObject({ ok: false, reason: 'negated' })
    // The words those spellings must not take.
    expect(bindData({ template: 'counter', value: '40', label: 'clients want' }, ['40 clients want it.']).ok).toBe(true)
  })

  it("Hindi and Telugu negators negate through bind", () => {
    expect(bindData({ template: 'counter', value: '40', label: 'ग्राहक' }, ['40 ग्राहक नहीं आए'], 'hi'))
      .toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData({ template: 'counter', value: '40', label: 'జంటలు' }, ['40 జంటలు లేదు'], 'te'))
      .toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData({ template: 'counter', value: '40', label: 'ग्राहक' }, ['40 ग्राहक आए'], 'hi').ok).toBe(true)
  })

  it('"I would never, ever, quit your job." + quote "quit your job" → negated (an \'ever\' between is still directly after)', () => {
    const quote: GraphicData = { template: 'quote', kind: 'said', text: 'quit your job', speaker: '' }
    expect(bindData(quote, ['I would never, ever, quit your job.'])).toMatchObject({ ok: false, reason: 'negated' })
  })

  it('"Never." "Quit your job." + quote "quit your job" → negated (a sentence break does not end "directly after")', () => {
    const quote: GraphicData = { template: 'quote', kind: 'said', text: 'quit your job', speaker: '' }
    expect(bindData(quote, ['Never.', 'Quit your job.'])).toMatchObject({ ok: false, reason: 'negated' })
    expect(bindData(quote, ['Honestly.', 'Quit your job.']).ok).toBe(true)
  })

  it("English plurals fold, but 'news' is not the plural of 'new': counter 40 / 'new clients' → absent", () => {
    expect(bindData({ template: 'counter', value: '40', label: 'new clients' }, ['40 clients saw the news.']))
      .toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData({ template: 'counter', value: '40', label: 'new clients' }, ['40 new client came.']).ok).toBe(true)
  })
})

describe('bind: the edges the critics found unpinned', () => {
  it('BIND_WINDOW: a label 8 spoken tokens from its value binds, 9 does not', () => {
    const at8 = stretchOf(['We shot 300 in the hills and the coast for weddings.'])
    expect(wordAt(at8, 'weddings.') - wordAt(at8, '300')).toBe(BIND_WINDOW)
    const at9 = stretchOf(['We shot 300 in the hills and the coast for all weddings.'])
    expect(wordAt(at9, 'weddings.') - wordAt(at9, '300')).toBe(BIND_WINDOW + 1)
    const claims = claimsOf({ template: 'counter', value: '300', label: 'weddings' }, def('counter'))
    expect(bind(claims, at8, 'en').ok).toBe(true)
    expect(bind(claims, at9, 'en')).toMatchObject({ ok: false, reason: 'unpaired' })
  })

  it("spoken order holds over a WHOLE label: [ads growth 40, signups 70] over 'Ads 40 signups 70 growth.' → order", () => {
    expect(bindData(bars([['ads growth', '40'], ['signups', '70']]), ['Ads 40 signups 70 growth.']))
      .toMatchObject({ ok: false, reason: 'order' })
  })

  it("a keyword run never spans a clause mark: 'cheap really' over 'It is cheap, really.' → absent (piece 3 fix)", () => {
    expect(bindData({ template: 'keyword', words: 'cheap really', lit: 0 }, ['It is cheap, really not.']))
      .toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData({ template: 'keyword', words: 'cheap really', lit: 0 }, ['It is cheap, really.']))
      .toMatchObject({ ok: false, reason: 'absent' })
    expect(bindData({ template: 'keyword', words: 'cheap really', lit: 0 }, ['It is cheap really.']).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The third half: validateGraphics.ts (§6.7's head, rules 8-10) and settleGraphics' validation half.

/**
 * A talk as the validator gets it: one segment per sentence, ids s00, s01, …,
 * words from index 0, each `msPerWord` long (the next starting 50 ms after).
 */
function talk(sentences: string[], options: { msPerWord?: number; language?: string; confidence?: Record<string, number> } = {}): Transcript {
  const step = options.msPerWord ?? 400
  const words: Word[] = []
  const segments: Segment[] = []
  let index = 0
  sentences.forEach((text, k) => {
    const start = index
    for (const w of text.split(/\s+/u).filter(Boolean)) {
      words.push({ index, text: w, startMs: index * step, endMs: index * step + step - 50, confidence: options.confidence?.[w] ?? null })
      index += 1
    }
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: start * step, endMs: (index - 1) * step + step - 50, text, wordStart: start, wordEnd: index - 1 })
  })
  return { assetId: 'asset-1', language: options.language ?? 'en', model: 'test', durationMs: index * step, words, segments }
}

/** The menu `graphicsMenuFor` (lane T2b's) would make: the capped sentences, the templates offered. */
function menuOf(t: Transcript, extra: Partial<GraphicsMenu> = {}): GraphicsMenu {
  return {
    assetId: t.assetId,
    clipId: 'clip-1',
    language: t.language,
    sentences: capSegments(t, 30, 15000).map((s) => ({ id: s.id, startMs: s.startMs, text: s.text, wordStart: s.wordStart, wordEnd: s.wordEnd })),
    templates: ['counter', 'bars', 'steps', 'quote', 'ring', 'keyword'],
    wordSource: 'whisper',
    ...extra
  }
}

/** One answer graphic, every unused field '' as the schema has it (§6.6). */
function g(fields: Partial<AnswerGraphic> & Pick<AnswerGraphic, 'sentence' | 'template'>): AnswerGraphic {
  return { title: '', value: '', label: '', items: [], quote: '', words: '', lit: 0, why: 'it helps', ...fields }
}

function answer(...graphics: AnswerGraphic[]): { reasoning: string; graphics: AnswerGraphic[] } {
  return { reasoning: 'r', graphics }
}

type Verdict = ReturnType<typeof validateGraphics>

function kept(v: Verdict): GraphicCandidate[] {
  expect(v, 'not rejected').not.toHaveProperty('rejected')
  return 'kept' in v ? v.kept : []
}

function droppedOf(v: Verdict): { path: string; message: string }[] {
  expect(v, 'not rejected').not.toHaveProperty('rejected')
  return 'dropped' in v ? v.dropped : []
}

/** Validate one answer graphic over the sentences, the menu offering what `extra` says. */
function one1(sentences: string[], graphic: AnswerGraphic, extra: Partial<GraphicsMenu> = {}, t = talk(sentences)): Verdict {
  return validateGraphics(answer(graphic), menuOf(t, extra), t)
}

describe('rule 9: the template rules after binding, the review cases', () => {
  it('"we signed 40 clients" + ring 40 → dropped: the matched number carries no %', () => {
    const v = one1(['We signed 40 clients.'], g({ sentence: 's00', template: 'ring', value: '40', label: 'clients' }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].value', message: "graphic dropped: '40' is not said as a percentage in s00" }])
    // The same ring over a said percentage is kept, its one beat the value's word.
    const ok = one1(['We signed 40% of clients.'], g({ sentence: 's00', template: 'ring', value: '40', label: 'clients' }))
    expect(kept(ok)).toMatchObject([{ data: { template: 'ring', value: '40', label: 'clients' }, bound: [2, 4], beatWords: [2] }])
  })

  it('a ring over 100% → dropped', () => {
    const v = one1(['Our bookings grew 120% this year.'], g({ sentence: 's00', template: 'ring', value: '120%', label: 'bookings grew' }))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].value', message: "graphic dropped: '120%' is not a share of a whole (0 to 100%)" }])
  })

  it('the bars in two units ($40 and 40%, bare in the spec) → dropped', () => {
    const said = ['We spent $40 on ads last month and then 40% of all our new signups came from them.']
    const v = one1(said, g({ sentence: 's00', template: 'bars', title: 'By the numbers', items: [{ label: 'ads', value: '40' }, { label: 'signups', value: '40' }] }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].items', message: 'graphic dropped: the bars are said in s00 in more than one unit' }])
  })

  it('a counter must hold a number', () => {
    const v = one1(['We signed forty-ish clients.'], g({ sentence: 's00', template: 'counter', value: 'forty-ish', label: 'clients' }))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].value', message: "graphic dropped: 'forty-ish' is not one number" }])
  })

  it('a quote of more than 16 words → dropped', () => {
    const line = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen'
    const v = one1([`${line}.`], g({ sentence: 's00', template: 'quote', quote: line }))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].quote', message: 'graphic dropped: a quote is at most 16 words, this is 17' }])
  })
})

describe("rule 8's speaker mode: a said quote's speaker is the app's", () => {
  const elon = ['My mentor told me, and I think Elon said something like it: fail fast.']

  it('"…I think Elon said something like it: fail fast" + speaker Elon → refused', () => {
    const t = talk(elon)
    const data: GraphicData = { template: 'quote', kind: 'said', text: 'fail fast', speaker: 'Elon' }
    const grounding = { assetId: t.assetId, sentence: 's00', words: [] }
    expect(checkGraphicData(data, def('quote'), grounding, t)).toEqual([
      { path: '$.speaker', message: "'Elon' is not who said it: no one is named saying it" }
    ])
    // With no speaker, or the asset's Speaker the app passes, it grounds; a model's quote takes ''.
    expect(checkGraphicData({ ...data, speaker: '' }, def('quote'), grounding, t)).toEqual([])
    expect(checkGraphicData({ ...data, speaker: 'Priya' }, def('quote'), grounding, t, ['Priya'])).toEqual([])
    expect(kept(one1(elon, g({ sentence: 's00', template: 'quote', quote: 'fail fast' })))).toMatchObject([
      { data: { template: 'quote', kind: 'said', text: 'fail fast', speaker: '' } }
    ])
  })

  it('a run directly after "<name> said" is kept with that name as its speaker, and no other', () => {
    const said = ['I think Elon said: fail fast.']
    expect(kept(one1(said, g({ sentence: 's00', template: 'quote', quote: 'fail fast' })))).toMatchObject([
      { data: { speaker: 'Elon' }, beatWords: [4, 5] }
    ])
    const t = talk(said)
    const grounding = { assetId: t.assetId, sentence: 's00', words: [] }
    const data: GraphicData = { template: 'quote', kind: 'said', text: 'fail fast', speaker: '' }
    expect(checkGraphicData(data, def('quote'), grounding, t, ['Priya'])).toEqual([
      { path: '$.speaker', message: "'' is not who said it: the stretch says Elon said it" }
    ])
    expect(checkGraphicData({ ...data, speaker: 'Priya' }, def('quote'), grounding, t, ['Priya'])).toHaveLength(1)
  })

  it('a reported quote whose speaker the stretch does not name → refused', () => {
    for (const said of ['He said: fail fast.', 'My mentor told me: fail fast.', 'Someone asked: why bother.']) {
      const quote = said.split(': ')[1].replace('.', '')
      const v = one1([said], g({ sentence: 's00', template: 'quote', quote }))
      expect(kept(v), said).toEqual([])
      expect(droppedOf(v), said).toEqual([
        { path: '$.graphics[0].quote', message: `graphic dropped: '${quote}': it is reported speech and the transcript does not name who said it` }
      ])
    }
  })

  it('reportedBy reads back across a sentence mark and past "told me" and "that", but names only within one sentence', () => {
    // Across a sentence the run is still reported (so it is never shipped as the speaker's own), but no
    // verb governs it from the sentence before, so no one is named and the quote is refused.
    const st = stretchOf(['Priya told us.', 'Book early.'], 0)
    expect(reportedBy(st, 3)).toEqual({ reported: true, name: null })
    expect(reportedBy(stretchOf(['I hear Priya says that book early.'], 0), 5)).toEqual({ reported: true, name: 'Priya' })
    expect(reportedBy(stretchOf(['Book early.'], 0), 0)).toEqual({ reported: false })
  })
})

describe('rule 9: keyword', () => {
  const kw = (sentence: string, words: string, lit = 0): AnswerGraphic => g({ sentence, template: 'keyword', words, lit })

  it('"this is not easy" + keyword "easy" → dropped (rule 7 on its clause)', () => {
    const v = one1(['This is not easy.'], kw('s00', 'easy'))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'easy' is said negated in s00" }])
    // Not directly after the negator, so rule 7 on the clause alone drops it.
    expect(droppedOf(one1(['This is not really easy.'], kw('s00', 'easy')))).toEqual([
      { path: '$.graphics[0].words', message: "graphic dropped: 'easy' is said negated in s00" }
    ])
    expect(kept(one1(['This is easy.'], kw('s00', 'easy')))).toMatchObject([{ data: { words: 'easy', lit: 0 }, beatWords: [2] }])
  })

  it('keyword "my job" taken across two sentences → dropped', () => {
    const v = one1(['I love my.', 'Job is great.'], kw('s00', 'my job', 1))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'my job' is not said in s00" }])
    // Unpunctuated, so the segment edge alone is what drops it (no clause mark in the run).
    expect(droppedOf(one1(['I love my', 'Job is great'], kw('s00', 'my job', 1)))).toEqual([
      { path: '$.graphics[0].words', message: "graphic dropped: 'my job' is not said in s00" }
    ])
    expect(kept(one1(['I love my job.'], kw('s00', 'my job', 1)))).toHaveLength(1)
  })

  it('keyword "of the" → dropped: no content word', () => {
    const v = one1(['Most of the time it rains.'], kw('s00', 'of the'))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'of the' holds no word that says anything" }])
  })

  it('lit 7 on a two-word keyword → repaired to 1, with a note', () => {
    const v = one1(['Light beats expensive gear.'], kw('s00', 'expensive gear', 7))
    expect(kept(v)).toMatchObject([{ data: { template: 'keyword', words: 'expensive gear', lit: 1 }, beatWords: [2] }])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].lit', message: 'graphic repaired: lit 7 is not one of the 2 words — the last one is lit' }])
  })

  it("checkGraphicData flags a lit out of range (the dock's warning)", () => {
    const t = talk(['Light beats expensive gear.'])
    const grounding = { assetId: t.assetId, sentence: 's00', words: [] }
    expect(checkGraphicData({ template: 'keyword', words: 'expensive gear', lit: 2 }, def('keyword'), grounding, t)).toEqual([
      { path: '$.lit', message: "lit 2 is not one of the keyword's 2 words" }
    ])
    expect(checkGraphicData({ template: 'keyword', words: 'expensive gear', lit: 1 }, def('keyword'), grounding, t)).toEqual([])
  })

  it('a keyword of five words → dropped', () => {
    const v = one1(['Light beats expensive gear every time.'], kw('s00', 'beats expensive gear every time'))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: 'graphic dropped: a keyword is 1 to 4 said words, this is 5' }])
  })
})

describe('rule 9: what a model may not name', () => {
  it('an answer naming lower-third → dropped ("not offered"), even when a menu wrongly offers it', () => {
    const said = ['Hi, I am Priya.']
    for (const templates of [undefined, ['counter', 'lower-third']] as const) {
      const v = one1(said, g({ sentence: 's00', template: 'lower-third', label: 'Priya' }), templates ? { templates: [...templates] } : {})
      expect(kept(v)).toEqual([])
      expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].template', message: "graphic dropped: 'lower-third' is not offered" }])
    }
  })

  it('a callout the menu did not offer → dropped ("not offered"); offered, it grounds', () => {
    const said = ['Look at the bride.']
    const answerCallout = g({ sentence: 's00', template: 'callout', label: 'the bride' })
    expect(droppedOf(one1(said, answerCallout))).toEqual([{ path: '$.graphics[0].template', message: "graphic dropped: 'callout' is not offered" }])
    expect(kept(one1(said, answerCallout, { templates: ['callout'] }))).toMatchObject([
      { data: { template: 'callout', label: 'the bride', shape: 'arrow' }, beatWords: [3] }
    ])
  })

  it('a sentence not on the menu → dropped', () => {
    const v = one1(['We signed 40% of clients.'], g({ sentence: 's09', template: 'ring', value: '40%', label: 'clients' }))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].sentence', message: "graphic dropped: 's09' is not a sentence on the menu" }])
  })
})

describe('validateGraphics rejects only a truncated answer and the wrong shape', () => {
  const t = talk(['We signed 40% of clients.'])
  const fine = answer(g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' }))

  it('a truncated answer → rejected', () => {
    expect(validateGraphics(fine, menuOf(t), t, { truncated: true })).toEqual({ rejected: "The model's graphics ran out of room before it finished" })
  })

  it('the wrong shape → rejected, with the path', () => {
    expect(validateGraphics({ reasoning: 'r', graphics: 'none' }, menuOf(t), t)).toEqual({
      rejected: 'The graphics are not the shape asked for — $.graphics is "none", expected a list'
    })
    const { why: _why, ...noWhy } = fine.graphics[0]
    expect(validateGraphics({ reasoning: 'r', graphics: [noWhy] }, menuOf(t), t)).toEqual({
      rejected: 'The graphics are not the shape asked for — $.graphics[0].why is missing'
    })
  })

  it('a model-written parent is not a field of the answer: the wrong shape', () => {
    const steps = g({ sentence: 's00', template: 'steps', items: [{ label: 'a', value: '' }] })
    const withParent = { ...steps, items: [{ label: 'a', value: '', parent: 0 }] }
    expect(validateGraphics(answer(withParent as AnswerGraphic), menuOf(t), t)).toEqual({
      rejected: 'The graphics are not the shape asked for — $.graphics[0].items[0].parent is not a field the plan has'
    })
  })

  it('an empty list is an answer, and a fine one is kept', () => {
    expect(validateGraphics(answer(), menuOf(t), t)).toEqual({ kept: [], dropped: [] })
    expect(kept(validateGraphics(fine, menuOf(t), t))).toHaveLength(1)
  })
})

describe('steps: the app sets connector and every parent (rule 9)', () => {
  const fixture = nestedEn1 as unknown as { transcript: Transcript; items: string[]; parents: number[] }
  const t = fixture.transcript
  const stepsData = (parents: number[] | null, connector: 'none' | 'line' | 'tree'): GraphicData => ({
    template: 'steps',
    title: 'Step by step',
    items: fixture.items.map((label, j) => (parents ? { label, parent: parents[j] } : { label })),
    connector
  })

  it("a model's steps get the app's tree, from tree.ts", () => {
    const v = validateGraphics(
      answer(g({ sentence: 's03', template: 'steps', title: 'Step by step', items: fixture.items.map((label) => ({ label, value: '' })) })),
      menuOf(t),
      t
    )
    expect(kept(v)).toHaveLength(1)
    const data = kept(v)[0].data as Extract<GraphicData, { template: 'steps' }>
    expect(data.items.map((i) => i.parent)).toEqual(fixture.parents)
    expect(data.connector).toBe('tree')
    // Each item's beat is its label's first bound word.
    // plan, budget, timeline (s02), shoot (s03; not s01's 'shoot', outside the stretch), edit (s04).
    expect(kept(v)[0].beatWords).toEqual([9, 15, 25, 28, 32])
  })

  it('a steps graphic with a written parent gets the app\'s parents (the baseline seam, where data carries them)', () => {
    // A written tree over a flat-said list: [−1, 0, 0] and 'tree' where the speaker said three plain steps.
    const flat = talk(['First charge the batteries, then format the cards, then pack the bag.'])
    const written: GraphicCandidate = {
      sentence: 's00',
      data: { template: 'steps', title: 'Step by step', items: [{ label: 'charge batteries', parent: -1 }, { label: 'format cards', parent: 0 }, { label: 'pack bag', parent: 0 }], connector: 'tree' },
      bound: [],
      beatWords: [],
      why: 'a list',
      source: 'baseline'
    }
    const s = validateBaseline([written], menuOf(flat), flat)
    expect(s.kept).toHaveLength(1)
    const data = s.kept[0].data as Extract<GraphicData, { template: 'steps' }>
    expect(data.items.map((i) => i.parent)).toEqual([-1, -1, -1])
    expect(data.connector).toBe('line')
    // And the fixture's own tree, written wrong, comes back right.
    const wrong: GraphicCandidate = { ...written, sentence: 's03', data: stepsData([-1, -1, -1, 2, 3], 'line') }
    const nested = validateBaseline([wrong], menuOf(t), t)
    expect((nested.kept[0].data as Extract<GraphicData, { template: 'steps' }>).items.map((i) => i.parent)).toEqual(fixture.parents)
  })

  it('checkGraphicData flags parents that are not a tree', () => {
    const grounding = { assetId: t.assetId, sentence: 's03', words: [] }
    expect(checkGraphicData(stepsData([-1, 0, 1, -1, -1], 'tree'), def('steps'), grounding, t)).toEqual([
      { path: '$.items', message: 'the steps are not a valid tree' }
    ])
    expect(checkGraphicData(stepsData(fixture.parents, 'tree'), def('steps'), grounding, t)).toEqual([])
  })

  it('a steps row of function words alone grounds nothing → dropped', () => {
    const v = validateGraphics(
      answer(g({ sentence: 's00', template: 'steps', title: 'Step by step', items: [{ label: 'charge batteries', value: '' }, { label: 'of the', value: '' }] })),
      menuOf(talk(['Charge batteries, most of the time.'])),
      talk(['Charge batteries, most of the time.'])
    )
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].items[1].label', message: "graphic dropped: 'of the' holds no word the transcript can ground" }])
  })

  it('a title the stretch does not say is replaced by the first fixed title, with a note', () => {
    const said = ['We had 3 weddings in May and 5 in June.']
    const v = one1(said, g({ sentence: 's00', template: 'bars', title: 'Our best year', items: [{ label: 'May', value: '3' }, { label: 'June', value: '5' }] }))
    expect(kept(v)).toMatchObject([{ data: { title: 'By the numbers' }, beatWords: [2, 7] }])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].title', message: "graphic repaired: the title 'Our best year' is not said in s00 — 'By the numbers'" }])
  })
})

describe("validateGraphics: one graphic at a time, the answer's paths and messages", () => {
  it('drops each graphic with its own path and the reason the panel shows, keeping the others', () => {
    const said = ['We signed 40% of clients.', 'Then we spent $5 on ads and $9 on prints.']
    const v = one1(said, g({ sentence: 's00', template: 'counter', value: '45%', label: 'clients' }))
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].value', message: "graphic dropped: '45%' is not said in s00" }])
    const t = talk(said)
    const many = validateGraphics(
      answer(
        g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' }),
        g({ sentence: 's01', template: 'bars', title: 'Compared', items: [{ label: 'ads', value: '$5' }, { label: 'prints', value: '$7' }] }),
        g({ sentence: 's01', template: 'quote', quote: 'we spent $5 on ads' })
      ),
      menuOf(t),
      t
    )
    expect(kept(many).map((k) => k.data.template)).toEqual(['ring'])
    expect(droppedOf(many)).toEqual([
      { path: '$.graphics[1].items[1].value', message: "graphic dropped: '$7' is not said in s01" },
      { path: '$.graphics[2].quote', message: "graphic dropped: 'we spent $5 on ads' is not said in s01" }
    ])
  })

  it('a kept graphic records its sentence, one bound word per claim in claim order, its beats, its why and its source', () => {
    const said = ['We had 3 weddings in May and 5 in June.']
    const v = one1(said, g({ sentence: 's00', template: 'bars', title: 'Compared', items: [{ label: 'May weddings', value: '3' }, { label: 'June', value: '5' }], why: 'two months' }))
    expect(kept(v)).toMatchObject([
      {
        sentence: 's00',
        data: { template: 'bars', title: 'Compared', items: [{ label: 'May weddings', value: '3' }, { label: 'June', value: '5' }] },
        bound: [5, 3, 2, 9, 7],
        beatWords: [2, 7],
        why: 'two months',
        source: 'model'
      }
    ])
    expect(kept(v)[0]).not.toHaveProperty('proposal')
  })

  it('a quote beats on each of its words', () => {
    const v = one1(['Honestly, put the camera where the light is.'], g({ sentence: 's00', template: 'quote', quote: 'put the camera where the light is' }))
    expect(kept(v)).toMatchObject([{ bound: [1], beatWords: [1, 2, 3, 4, 5, 6, 7] }])
  })

  it("a number bound to a YouTube word, or to a Whisper word under 0.5, is a proposal (§6.6); a label's word is not", () => {
    const said = ['We signed 40% of clients.']
    const ring = g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' })
    expect(kept(one1(said, ring, { wordSource: 'youtube-asr' }))[0].proposal).toEqual({ reason: 'check-the-number', wordSource: 'youtube-asr' })
    expect(kept(one1(said, ring, {}, talk(said, { confidence: { '40%': 0.3 } })))[0].proposal).toEqual({ reason: 'check-the-number', wordSource: 'whisper-unsure' })
    expect(kept(one1(said, ring, {}, talk(said, { confidence: { 'clients.': 0.3, '40%': 0.9 } })))[0]).not.toHaveProperty('proposal')
  })

  it('a field over its kept length (§6.6) → dropped; the why is cut', () => {
    const said = ['We signed 40% of clients.']
    const long = one1(said, g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients '.repeat(6).trim() }))
    expect(droppedOf(long)).toEqual([{ path: '$.graphics[0].label', message: 'graphic dropped: is 47 characters, at most 40 are drawn' }])
    const why = one1(said, g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients', why: 'x'.repeat(80) }))
    expect(kept(why)[0].why).toBe(`${'x'.repeat(59)}…`)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('validateGraphics calls the exported checkGraphicData, the one the dock calls (§6.6)', () => {
    const spy = vi.spyOn(validator, 'checkGraphicData')
    const t = talk(['We signed 40% of clients.'])
    const graphic = g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' })
    expect(kept(validateGraphics(answer(graphic), menuOf(t), t))).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual({ template: 'ring', value: '40%', label: 'clients' })
    expect(spy.mock.calls[0][2]).toEqual({ assetId: 'asset-1', sentence: 's00', words: [] })
    // And what it says decides: a check that finds a problem drops the graphic.
    spy.mockReturnValue([{ path: '$.label', message: 'made up' }])
    expect(droppedOf(validateGraphics(answer(graphic), menuOf(t), t))).toEqual([{ path: '$.graphics[0].label', message: 'graphic dropped: made up' }])
  })
})

describe('the stretch: the cited sentence and one either side, over capped segments', () => {
  const said = ['We signed 40% of our clients.', 'It was a good year.', 'The light was soft.', 'We shot in May.']
  const ring = (sentence: string): AnswerGraphic => g({ sentence, template: 'ring', value: '40%', label: 'clients' })

  it('a fact said in the next sentence of the one cited is kept; two sentences away it is dropped', () => {
    expect(kept(one1(said, ring('s00')))).toHaveLength(1)
    expect(kept(one1(said, ring('s01')))).toHaveLength(1)
    const v = one1(said, ring('s02'))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([
      { path: '$.graphics[0].value', message: "graphic dropped: '40%' is not said in s02" },
      { path: '$.graphics[0].label', message: "graphic dropped: 'clients' is not said in s02" }
    ])
  })

  it('stretchFor holds the cited sentence and one either side, their words and no more', () => {
    const t = talk(said)
    const st = stretchFor(t, 's01')!
    expect(st.sentences.map((s) => s.id)).toEqual(['s00', 's01', 's02'])
    expect(st.words.map((w) => w.index)).toEqual(Array.from({ length: t.segments[2].wordEnd + 1 }, (_, i) => i))
    expect(stretchFor(t, 's00')!.sentences.map((s) => s.id)).toEqual(['s00', 's01'])
    expect(stretchFor(t, 's09')).toBeNull()
  })

  it('a 40-word unpunctuated segment is capped, so the stretch is not the whole talk', () => {
    // 1 s a word: 40 s, past the 15 s cap, so capSegments cuts it in four of ten words.
    const words = ['We', 'signed', '40%', 'of', 'our', 'clients']
    for (let i = 6; i < 40; i++) words.push(`word${i}`)
    const t = talk([words.join(' ')], { msPerWord: 1000 })
    const pieces = capSegments(t, 30, 15000).map((s) => s.id)
    expect(pieces).toEqual(['s00.1', 's00.2', 's00.3', 's00.4'])
    expect(kept(one1([], ring('s00.2'), {}, t))).toHaveLength(1)
    const far = one1([], ring('s00.3'), {}, t)
    expect(kept(far)).toEqual([])
    expect(droppedOf(far)).toEqual([
      { path: '$.graphics[0].value', message: "graphic dropped: '40%' is not said in s00.3" },
      { path: '$.graphics[0].label', message: "graphic dropped: 'clients' is not said in s00.3" }
    ])
  })
})

describe('settleGraphics: the validation half (rule 10 and the baseline seam)', () => {
  // 400 ms a word; each 'N% of clients' sentence is where a ring may sit.
  const lines = (n: number): string[] => Array.from({ length: n }, (_, k) => `In week ${k} we signed ${k + 1}% of clients today.`)

  it('graphics closer than 6 s: the earlier one stays, whatever order the answer lists them', () => {
    expect(GRAPHIC_SPACING).toEqual({ minGapS: 6, perS: 20 })
    // Each sentence is 9 words = 3.6 s, so s00's number and s01's are 3.6 s apart, s00's and s02's 7.2 s;
    // twelve sentences are 43.15 s of clip, room for two.
    const t = talk(lines(12))
    const ring = (k: number): AnswerGraphic => g({ sentence: `s0${k}`, template: 'ring', value: `${k + 1}%`, label: 'clients' })
    const s = settleGraphics({ value: answer(ring(1), ring(0), ring(2)), truncated: false }, menuOf(t), t)
    expect(s.baseline).toBe(false)
    expect(s.rejected).toBeNull()
    expect(s.kept.map((k) => k.sentence)).toEqual(['s00', 's02'])
    expect(s.dropped).toEqual([
      { path: '$.graphics', message: 'graphic dropped: the ring on s01 is within 6 s of the one before — the earlier one stays' }
    ])
  })

  it('at most one graphic per 20 s of clip', () => {
    // Eight sentences of 3.6 s: 28.75 s of clip, so one graphic; twelve: 43.15 s, so two.
    const short = talk(lines(8))
    const ring = (k: number): AnswerGraphic => g({ sentence: `s${String(k).padStart(2, '0')}`, template: 'ring', value: `${k + 1}%`, label: 'clients' })
    const s = settleGraphics({ value: answer(ring(0), ring(3), ring(6)), truncated: false }, menuOf(short), short)
    expect(s.kept.map((k) => k.sentence)).toEqual(['s00'])
    expect(s.dropped.map((p) => p.message)).toEqual([
      'graphic dropped: the ring on s03 — at most one graphic per 20 s of clip, the earlier ones stay',
      'graphic dropped: the ring on s06 — at most one graphic per 20 s of clip, the earlier ones stay'
    ])
    const long = talk(lines(12))
    expect(settleGraphics({ value: answer(ring(0), ring(3), ring(6)), truncated: false }, menuOf(long), long).kept.map((k) => k.sentence)).toEqual(['s00', 's03'])
  })

  it('a rejected answer settles to the baseline, validated the same way, and says why', () => {
    const t = talk(['We signed 40% of clients.'])
    const good: GraphicCandidate = { sentence: 's00', data: { template: 'ring', value: '40%', label: 'clients' }, bound: [], beatWords: [], why: 'a share', source: 'baseline' }
    const bad: GraphicCandidate = { ...good, data: { template: 'ring', value: '45%', label: 'clients' } }
    const s = settleGraphics({ value: answer(), truncated: true }, menuOf(t), t, { baseline: () => [bad, good] })
    expect(s).toMatchObject({ baseline: true, rejected: "The model's graphics ran out of room before it finished" })
    expect(s.kept).toMatchObject([{ ...good, bound: [2, 4], beatWords: [2] }])
    expect(s.kept).toHaveLength(1)
    expect(s.dropped).toEqual([
      { path: '$', message: "the baseline's graphics are used for sentence s00: The model's graphics ran out of room before it finished" },
      { path: '$.baseline[0].value', message: "graphic dropped: '45%' is not said in s00" }
    ])
    // No model at all, and no baseline passed to the seam (the app passes baselineGraphics, lane T4): nothing, with a note that is true without one (T2b, piece 2).
    const none = settleGraphics({ error: 'no model is set up' }, menuOf(t), t)
    expect(none).toMatchObject({ baseline: true, rejected: 'no model is set up' })
    expect(none.kept).toEqual([])
    expect(none.dropped).toEqual([{ path: '$', message: 'no graphics for sentence s00: no model is set up' }])
  })
})

// ---------------------------------------------------------------------------
// Piece 3's fix: the false graphics the two critics found kept, each now dropped and pinned by its own case.

describe("rule 8's speaker: a name only where '<name> said / says / told' directly governs the run (piece 3 fix)", () => {
  const quote = (q: string, sentence = 's00'): AnswerGraphic => g({ sentence, template: 'quote', quote: q })
  const refused = (q: string): { path: string; message: string }[] => [
    { path: '$.graphics[0].quote', message: `graphic dropped: '${q}': it is reported speech and the transcript does not name who said it` }
  ]

  it("'That is not what Elon said.' 'Fail fast.' → no 'fail fast — Elon'", () => {
    const v = one1(['That is not what Elon said.', 'Fail fast.'], quote('fail fast', 's01'))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual(refused('fail fast'))
  })

  it("a verb in the segment before governs nothing: 'I think Elon said' / 'fail fast' → refused", () => {
    expect(droppedOf(one1(['I think Elon said', 'fail fast'], quote('fail fast', 's01')))).toEqual(refused('fail fast'))
  })

  it("a sentence mark inside one segment: 'I think Elon said. Fail fast.' → refused", () => {
    expect(droppedOf(one1(['I think Elon said. Fail fast.'], quote('fail fast')))).toEqual(refused('fail fast'))
  })

  it("a negator before the verb in its sentence: 'Never has Elon said: fail fast.' → dropped; two clauses back → refused", () => {
    // The clause directly before the run holds the negator, so rule 7 drops it first.
    const negated = [{ path: '$.graphics[0].quote', message: "graphic dropped: 'fail fast' is said negated in s00" }]
    expect(droppedOf(one1(['Never has Elon said: fail fast.'], quote('fail fast')))).toEqual(negated)
    // Further back than rule 7 reaches, the speaker rule's own scan refuses the name.
    expect(droppedOf(one1(['Never, as I recall, has Elon said: fail fast.'], quote('fail fast')))).toEqual(refused('fail fast'))
  })

  it("a negator is never the speaker: 'Nobody said: fail fast.', 'Nobody told me: fail fast.' → dropped", () => {
    for (const said of ['Nobody said: fail fast.', 'Nobody told me: fail fast.']) {
      const v = one1([said], quote('fail fast'))
      expect(kept(v), said).toEqual([])
      expect(droppedOf(v), said).toEqual([{ path: '$.graphics[0].quote', message: "graphic dropped: 'fail fast' is said negated in s00" }])
    }
  })

  it("a capital at a sentence's start is no name: 'Then said: …', 'Mentors said: …', 'Elon said: …' alone → refused", () => {
    for (const said of ['Then said: fail fast.', 'Mentors said: fail fast.', 'Elon said: fail fast.']) {
      expect(droppedOf(one1([said], quote('fail fast'))), said).toEqual(refused('fail fast'))
    }
    // The same word written with a capital where no sentence starts is a name.
    expect(kept(one1(['I met Elon. Elon said: fail fast.'], quote('fail fast')))).toMatchObject([{ data: { speaker: 'Elon' } }])
  })

  it("'said this:' points at the run: 'My coach told me this: quit your job.' → refused, not the speaker's own", () => {
    expect(droppedOf(one1(['My coach told me this: quit your job.'], quote('quit your job')))).toEqual(refused('quit your job'))
  })
})

describe('rule 7: a negated clause governs the clause after its mark (piece 3 fix)', () => {
  it("'I would never say this: quit your job.' and 'Nobody should ever tell you this: quit your job.' → no 'quit your job'", () => {
    for (const said of ['I would never say this: quit your job.', 'Nobody should ever tell you this: quit your job.']) {
      const v = one1([said], g({ sentence: 's00', template: 'quote', quote: 'quit your job' }))
      expect(kept(v), said).toEqual([])
      expect(droppedOf(v), said).toEqual([{ path: '$.graphics[0].quote', message: "graphic dropped: 'quit your job' is said negated in s00" }])
    }
  })

  it("'It is not true, 90% of startups fail.' → no 90% ring (the review's own case, a comma added)", () => {
    for (const said of ['It is not true, 90% of startups fail.', "It's not true, that 90% of startups fail."]) {
      const v = one1([said], g({ sentence: 's00', template: 'ring', value: '90%', label: 'startups fail' }))
      expect(kept(v), said).toEqual([])
      expect(droppedOf(v).map((p) => p.message), said).toContain("graphic dropped: '90%' is said negated in s00")
    }
    expect(kept(one1(['It is true, 90% of startups fail.'], g({ sentence: 's00', template: 'ring', value: '90%', label: 'startups fail' })))).toHaveLength(1)
  })

  it("a negator outside §6.7's list: 'It is hardly easy.' → no keyword 'easy'", () => {
    const v = one1(['It is hardly easy.'], g({ sentence: 's00', template: 'keyword', words: 'easy', lit: 0 }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'easy' is said negated in s00" }])
  })
})

describe('rule 9: a keyword is one phrase, never across a clause or sentence mark (piece 3 fix)', () => {
  it("'It is easy, money comes slowly.' → no keyword 'easy money'", () => {
    const v = one1(['It is easy, money comes slowly.'], g({ sentence: 's00', template: 'keyword', words: 'easy money', lit: 0 }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'easy money' is not said in s00" }])
  })

  it("two sentences in ONE segment: 'I love my. Job is hard.' → no keyword 'my job'", () => {
    const v = one1(['I love my. Job is hard.'], g({ sentence: 's00', template: 'keyword', words: 'my job', lit: 1 }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].words', message: "graphic dropped: 'my job' is not said in s00" }])
  })
})

describe('rule 4: a qualified number is no exact number (piece 3 fix)', () => {
  const counter = (said: string): Verdict => one1([said], g({ sentence: 's00', template: 'counter', value: '40', label: 'clients' }))
  const absent = [{ path: '$.graphics[0].value', message: "graphic dropped: '40' is not said in s00" }]

  it("'between 30 and 40' is a range, as '30 to 40' is", () => {
    expect(droppedOf(counter('We signed between 30 and 40 clients.'))).toEqual(absent)
    expect(numbersIn(claimTokensOf('between 30 and 40'))).toEqual([])
    // 'and' alone joins nothing: 'we kept 30 and 40 clients came' is two numbers.
    expect(numbersIn(claimTokensOf('we kept 30 and 40 came')).map((f) => f.value.n)).toEqual([30, 40])
  })

  it("'up to 40' → no counter 40", () => {
    expect(droppedOf(counter('We could sign up to 40 clients.'))).toEqual(absent)
  })

  it("'almost 40', and 'fewer than 40%' → no 40 and no 40% ring", () => {
    expect(droppedOf(counter('We signed almost 40 clients.'))).toEqual(absent)
    const ring = one1(['Fewer than 40% of clients came back.'], g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients came back' }))
    expect(kept(ring)).toEqual([])
    expect(droppedOf(ring)).toContainEqual({ path: '$.graphics[0].value', message: "graphic dropped: '40%' is not said in s00" })
    // The unqualified number still binds.
    expect(kept(counter('We signed 40 clients.'))).toHaveLength(1)
  })
})

describe("rule 9's item counts and ring's lower bound, each pinned (piece 3 fix)", () => {
  it('a bars of one item, or a steps of one row → dropped (minItems)', () => {
    const one = one1(['We had 3 weddings in May.'], g({ sentence: 's00', template: 'bars', title: 'By the numbers', items: [{ label: 'May', value: '3' }] }))
    expect(kept(one)).toEqual([])
    expect(droppedOf(one)).toEqual([{ path: '$.graphics[0].items', message: 'graphic dropped: a bars needs at least 2 items, has 1' }])
    const row = one1(['First charge the batteries.'], g({ sentence: 's00', template: 'steps', title: 'Step by step', items: [{ label: 'charge batteries', value: '' }] }))
    expect(kept(row)).toEqual([])
    expect(droppedOf(row)).toEqual([{ path: '$.graphics[0].items', message: 'graphic dropped: a steps needs at least 2 items, has 1' }])
  })

  it('six bars, which the answer shape allows, → dropped (maxItems 5)', () => {
    const said = ['We had 1 in May, 2 in June, 3 in July, 4 in August, 5 in September and 6 in October.']
    const months = ['May', 'June', 'July', 'August', 'September', 'October']
    const v = one1(said, g({ sentence: 's00', template: 'bars', title: 'By the numbers', items: months.map((label, k) => ({ label, value: String(k + 1) })) }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].items', message: 'graphic dropped: a bars holds at most 5 items, has 6' }])
  })

  it('a ring below 0 → dropped', () => {
    const v = one1(['Our bookings fell -5% this year.'], g({ sentence: 's00', template: 'ring', value: '-5%', label: 'bookings' }))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].value', message: "graphic dropped: '-5%' is not a share of a whole (0 to 100%)" }])
  })
})

describe('the edges the critics found unpinned in piece 3', () => {
  it('a Whisper word at exactly 0.5 is not unsure: no proposal', () => {
    const said = ['We signed 40% of clients.']
    const ring = g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' })
    expect(kept(one1(said, ring, {}, talk(said, { confidence: { '40%': 0.5 } })))[0]).not.toHaveProperty('proposal')
  })

  it("checkGraphicData with no grounding (a hand-made graphic at the dock's entry) → one problem at '$'", () => {
    const t = talk(['We signed 40% of clients.'])
    expect(checkGraphicData({ template: 'ring', value: '40%', label: 'clients' }, def('ring'), undefined, t)).toEqual([
      { path: '$', message: 'has no sentence to ground it' }
    ])
  })

  it('a sentence of the transcript that is not on the menu → dropped', () => {
    const t = talk(['We signed 40% of clients.', 'We signed 40% of clients again.'])
    const menu = menuOf(t)
    const v = validateGraphics(answer(g({ sentence: 's01', template: 'ring', value: '40%', label: 'clients' })), { ...menu, sentences: menu.sentences.slice(0, 1) }, t)
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].sentence', message: "graphic dropped: 's01' is not a sentence on the menu" }])
  })

  it("a lit that is not an integer is the wrong shape: the whole answer is rejected (§6.6's integer)", () => {
    const t = talk(['Light beats expensive gear.'])
    const v = validateGraphics(answer(g({ sentence: 's00', template: 'keyword', words: 'expensive gear', lit: 0.5 })), menuOf(t), t)
    expect(v).toHaveProperty('rejected')
    expect((v as { rejected: string }).rejected).toMatch(/^The graphics are not the shape asked for — \$\.graphics\[0\]\.lit /u)
  })

  it("FUNCTION_WORDS_EN is English's: a Hindi talk's keyword 'is it' is not refused for it", () => {
    const t = talk(['यह is it है।'], { language: 'hi' })
    expect(kept(validateGraphics(answer(g({ sentence: 's00', template: 'keyword', words: 'is it', lit: 0 })), menuOf(t), t))).toHaveLength(1)
  })

  it("rule 10 spaces by a graphic's FIRST beat: a bars whose last beat is near a ring keeps both", () => {
    const said = ['We had 3 weddings in May and 5 weddings in June and 7 weddings in July and 9 weddings in August.', 'The light was soft.', 'In week 2 we signed 40% of clients today.']
    for (let k = 0; k < 13; k++) said.push('The light was soft that day.')
    const t = talk(said)
    const months = ['May', 'June', 'July', 'August']
    const s = settleGraphics(
      {
        value: answer(
          g({ sentence: 's00', template: 'bars', title: 'By the numbers', items: months.map((label, k) => ({ label, value: String(3 + 2 * k) })) }),
          g({ sentence: 's02', template: 'ring', value: '40%', label: 'clients' })
        ),
        truncated: false
      },
      menuOf(t),
      t
    )
    // Bars beats at 0.8 s to 6.8 s; the ring's at 12.0 s: 11.2 s after the bars' first beat, 5.2 s after its last.
    expect(s.kept.map((k) => t.words[k.beatWords[0]].startMs)).toEqual([800, 12000])
    expect(s.kept.map((k) => k.data.template)).toEqual(['bars', 'ring'])
    expect(s.dropped).toEqual([])
  })
})

describe("rule 8's marks and a list's row order: the false graphics piece 4's critics found", () => {
  const counter = (value: string, label = 'clients'): AnswerGraphic => g({ sentence: 's00', template: 'counter', value, label })

  it("a value with a mark around its number ('>40', '40+', '~40', '#1', …) is not one number → dropped", () => {
    for (const value of ['>40', '<40', '≥40', '±40', '+40', '40+', '~40', '40×', '40*', '40 %', '%40', '40%%']) {
      const v = one1(['we signed 40 clients.'], counter(value))
      expect(kept(v), value).toEqual([])
      expect(droppedOf(v), value).toEqual([{ path: '$.graphics[0].value', message: `graphic dropped: '${value}' is not one number` }])
    }
    expect(kept(one1(['we signed 1 client.'], counter('#1', 'client')))).toEqual([])
    for (const value of ['+40%', '40%+']) expect(kept(one1(['we had 40% of clients.'], g({ sentence: 's00', template: 'ring', value, label: 'clients' }))), value).toEqual([])
    const bars = g({ sentence: 's00', template: 'bars', title: 'Compared', items: [{ label: 'clients', value: '30' }, { label: 'couples', value: '70+' }] })
    expect(kept(one1(['30 clients and 70 couples.'], bars))).toEqual([])
    // The marks a number is written with still read: a minus, a sign, a %, 'Rs.'.
    expect(kept(one1(['we signed 40 clients.'], counter('40'))).map((k) => k.data)).toEqual([{ template: 'counter', value: '40', label: 'clients' }])
    expect(kept(one1(['we had 40% of clients.'], g({ sentence: 's00', template: 'ring', value: '40%', label: 'clients' })))).toHaveLength(1)
    expect(kept(one1(['we spent Rs. 500 on prints.'], counter('Rs. 500', 'prints')))).toHaveLength(1)
    expect(kept(one1(['bookings fell -5% this year.'], counter('-5%', 'bookings')))).toHaveLength(1)
  })

  it("a label, a callout's label or a keyword with a mark ('> clients', 'clients?', '-bride', '¬easy') → dropped", () => {
    for (const label of ['> clients', '↑ clients', 'clients?', '-clients', '+ clients']) {
      const v = one1(['we signed 40 clients.'], counter('40', label))
      expect(kept(v), label).toEqual([])
      expect(droppedOf(v)[0], label).toMatchObject({ path: '$.graphics[0].label', message: expect.stringContaining('which the transcript cannot ground') })
    }
    const callout = one1(['look at the bride right here.'], g({ sentence: 's00', template: 'callout', label: '-bride' }), { templates: ['callout'] })
    expect(kept(callout)).toEqual([])
    expect(kept(one1(['look at the bride right here.'], g({ sentence: 's00', template: 'callout', label: 'the bride' }), { templates: ['callout'] }))).toHaveLength(1)
    expect(kept(one1(['this is easy.'], g({ sentence: 's00', template: 'keyword', words: '¬easy', lit: 0 })))).toEqual([])
    // Plain punctuation draws nothing the speaker did not: brackets, quotes, a comma, a point.
    expect(kept(one1(['we signed 40 clients.'], counter('40', '(clients).')))).toHaveLength(1)
  })

  it("a verbatim '?' or '!' only where the speaker's word carries it: 'keep it simple?' over '… keep it simple.' → dropped", () => {
    const quote = (text: string): AnswerGraphic => g({ sentence: 's00', template: 'quote', quote: text })
    const v = one1(['honestly, keep it simple.'], quote('keep it simple?'))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toEqual([{ path: '$.graphics[0].quote', message: "graphic dropped: 'keep it simple?' draws '?', which is not said in s00" }])
    expect(kept(one1(['this is easy.'], g({ sentence: 's00', template: 'keyword', words: 'easy!', lit: 0 })))).toEqual([])
    // Said, it is kept: a question, an exclamation, a run starting inside its first word.
    expect(kept(one1(['honestly, why not?'], quote('why not?')))).toHaveLength(1)
    expect(kept(one1(['honestly, keep it simple!'], quote('keep it simple!')))).toHaveLength(1)
    expect(kept(one1(['this is easy!'], g({ sentence: 's00', template: 'keyword', words: 'easy!', lit: 0 })))).toHaveLength(1)
    expect(kept(one1(['we paid $40!'], g({ sentence: 's00', template: 'keyword', words: '40!', lit: 0 })))).toHaveLength(1)
  })

  it("steps' rows in the order they are said: 'first charge batteries, then pack bag.' + [pack bag, charge batteries] → dropped", () => {
    const said = ['first charge batteries, then pack bag.']
    const steps = (labels: string[]): AnswerGraphic => g({ sentence: 's00', template: 'steps', title: 'Step by step', items: labels.map((label) => ({ label, value: '' })) })
    const v = one1(said, steps(['pack bag', 'charge batteries']))
    expect(kept(v)).toEqual([])
    expect(droppedOf(v)).toContainEqual({ path: '$.graphics[0].items[0].label', message: "graphic dropped: 'pack bag' is not said in the order the list draws it in s00" })
    expect(kept(one1(said, steps(['charge batteries', 'pack bag'])))).toHaveLength(1)
  })
})

describe("a sentence's own end mark is no drawn mark: the danda (piece 5's critic)", () => {
  it("a whole Hindi sentence quoted verbatim, ending in '।' or '॥', grounds as a whole Telugu or English one does", () => {
    for (const end of ['।', '॥']) {
      const said = `हमने इस साल चालीस ग्राहक जोड़े${end}`
      const t = talk([said], { language: 'hi' })
      const grounding = { assetId: t.assetId, sentence: 's00', words: [] }
      expect(checkGraphicData({ template: 'quote', kind: 'said', text: said, speaker: '' }, def('quote'), grounding, t), end).toEqual([])
      expect(marksOf(`जोड़े${end}`, 'words'), end).toEqual([])
      expect(marksOf(`जोड़े${end}`, 'verbatim'), end).toEqual([])
    }
    // A mark the sentence does not end in is still drawn and refused.
    expect(marksOf('जोड़े»', 'words')).toEqual(['»'])
  })
})
