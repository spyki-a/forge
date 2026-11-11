import { describe, it, expect } from 'vitest'
import {
  BIND_WINDOW,
  CLAUSE_BREAK,
  FUNCTION_WORDS_EN,
  NEGATORS,
  claimToken,
  claimTokens,
  claimTokensOf,
  numbersIn,
  type CanonNumber
} from '@shared/director/claims'
import { numberOf } from '@shared/graphics/numbers'
import specs from './fixtures/graphics/specs.json'

/*
 * director/claims.ts, the normaliser half (docs/CLIPS.md §6.7 rules 1-5's
 * normaliser and the exports list). The binding cases (the review's five,
 * the negation and order cases) are the second half's, with claimsOf and bind.
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
