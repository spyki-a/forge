import { describe, it, expect } from 'vitest'
import {
  SHAPED_SCRIPTS,
  STILL,
  TEXT_ANIMATIONS,
  animationFrames,
  piecesOf,
  shapedScript,
  stepAt,
  textAnimationById,
  type TextAnimation
} from '@shared/render/textAnimation'

/*
 * How the words arrive.
 *
 * An animation is a tiny pure function — (progress, index, count) to a
 * displacement — and everything expensive downstream is decided by it: how many
 * frames the export bakes, when the preview may stop redrawing, whether the
 * last word ever reaches its place. So the properties worth guarding are not
 * the shapes of the curves but the promises the rest of the system makes on
 * their behalf.
 */

const find = (id: string): TextAnimation => {
  const animation = textAnimationById(id)
  if (!animation) throw new Error(`no animation ${id}`)
  return animation
}

describe('the library', () => {
  it('has unique ids', () => {
    const ids = TEXT_ANIMATIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every animation a name and a reason to exist', () => {
    for (const a of TEXT_ANIMATIONS) {
      expect(a.name.length, a.id).toBeGreaterThan(0)
      expect(a.description.length, a.id).toBeGreaterThan(10)
    }
  })

  it('keeps every move short enough to catch a scroll', () => {
    // A caption that takes a second to arrive has already lost the viewer it
    // was supposed to stop.
    for (const a of TEXT_ANIMATIONS) {
      expect(a.seconds, a.id).toBeGreaterThan(0)
      expect(a.seconds, a.id).toBeLessThanOrEqual(0.6)
      expect(a.stagger, a.id).toBeGreaterThanOrEqual(0)
      expect(a.stagger, a.id).toBeLessThanOrEqual(1)
    }
  })

  it('unknown ids resolve to nothing rather than throwing', () => {
    expect(textAnimationById('not-an-animation')).toBeNull()
    expect(textAnimationById(undefined)).toBeNull()
  })
})

describe('every animation', () => {
  it('ends exactly where the type is set', () => {
    // The last baked frame is held for the rest of the clip by `tpad`. If an
    // animation did not settle on STILL, the words would sit permanently
    // wherever it happened to stop — offset, shrunk or half transparent — for
    // the whole caption.
    for (const a of TEXT_ANIMATIONS) {
      expect(stepAt(a, 1000, 30, 0, 3), a.id).toEqual(STILL)
    }
  })

  it('starts somewhere other than where it ends', () => {
    // An animation whose first frame is already the final one is not an
    // animation; it would bake frames that all look the same.
    for (const a of TEXT_ANIMATIONS) {
      expect(stepAt(a, 0, 30, 0, 3), a.id).not.toEqual(STILL)
    }
  })

  it('never asks for a scale that would vanish or blow up the line', () => {
    for (const a of TEXT_ANIMATIONS) {
      for (let frame = 0; frame <= 60; frame++) {
        const step = stepAt(a, frame, 60, 0, 4)
        expect(step.scale, `${a.id} @${frame}`).toBeGreaterThan(0.05)
        expect(step.scale, `${a.id} @${frame}`).toBeLessThan(3)
        expect(step.alpha, `${a.id} @${frame}`).toBeGreaterThanOrEqual(0)
        expect(step.alpha, `${a.id} @${frame}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('has every piece settled by the time the baked frames run out', () => {
    /*
     * The load-bearing promise of the whole design.
     *
     * `animationFrames` decides how many frames are drawn and written; the last
     * one is then held forever. If any piece were still moving at that frame,
     * the export would freeze it mid-flight and no test of the curves would
     * have noticed.
     */
    const fps = 30
    for (const a of TEXT_ANIMATIONS) {
      for (const count of [1, 2, 5, 12]) {
        const last = animationFrames(a, fps, count) - 1
        for (let index = 0; index < count; index++) {
          expect(stepAt(a, last, fps, index, count), `${a.id} piece ${index}/${count}`).toEqual(
            STILL
          )
        }
      }
    }
  })
})

describe('stagger', () => {
  it('starts the first piece immediately and the last one latest', () => {
    const rise = find('rise')
    const first = stepAt(rise, 4, 30, 0, 4)
    const last = stepAt(rise, 4, 30, 3, 4)
    // Both are still arriving, but the last one has further to go.
    expect(Math.abs(last.dy)).toBeGreaterThan(Math.abs(first.dy))
  })

  it('moves a single piece as one, with no offset to spread', () => {
    const rise = find('rise')
    expect(stepAt(rise, 0, 30, 0, 1)).toEqual(rise.at(0))
  })

  it('costs no extra frames when there is only one piece', () => {
    for (const a of TEXT_ANIMATIONS) {
      const one = animationFrames(a, 30, 1)
      const many = animationFrames(a, 30, 8)
      expect(one, a.id).toBeLessThanOrEqual(many)
      if (a.stagger > 0) expect(many, a.id).toBeGreaterThan(one)
    }
  })
})

describe('animationFrames', () => {
  it('bakes a fraction of a three-second caption', () => {
    // The entire reason this is affordable: a caption on screen for three
    // seconds at 30fps is ninety frames, and a pop costs about fifteen.
    const pop = find('pop')
    expect(animationFrames(pop, 30, 4)).toBeLessThan(90 / 3)
  })

  it('never returns nothing to draw', () => {
    for (const a of TEXT_ANIMATIONS) {
      expect(animationFrames(a, 1, 1), a.id).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(animationFrames(a, 30, 3)), a.id).toBe(true)
    }
  })

  it('scales with the frame rate', () => {
    const pop = find('pop')
    expect(animationFrames(pop, 60, 3)).toBeGreaterThan(animationFrames(pop, 30, 3))
  })
})

describe('piecesOf', () => {
  it('keeps a block whole', () => {
    expect(piecesOf('two words', 'block')).toEqual(['two words'])
  })

  it('splits characters, spaces included', () => {
    expect(piecesOf('ab c', 'char')).toEqual(['a', 'b', ' ', 'c'])
  })

  it('keeps the gaps when splitting words', () => {
    // The pieces are re-joined to lay the line out, so dropping the spaces
    // would run the words together.
    expect(piecesOf('one two', 'word').join('')).toBe('one two')
  })

  it('never produces an empty piece', () => {
    for (const scope of ['word', 'char', 'block'] as const) {
      for (const piece of piecesOf('  spaced  out  ', scope)) {
        expect(piece.length, scope).toBeGreaterThan(0)
      }
    }
  })

  it('survives text with nothing in it', () => {
    expect(piecesOf('', 'word')).toEqual([])
    expect(piecesOf('', 'char')).toEqual([])
  })
})

/*
 * Lines whose letters join or reorder (D8, CLIPS §6.20, §16.61).
 *
 * `bounce` and `wave` move letters, and a letter was a code point: प्रिय came
 * apart into प, ्, र, ि and य, each drawn by itself, so the conjunct lost its
 * shape and the i-matra sat after its consonant instead of before it. Such a
 * line now moves by word, the smallest piece a canvas always draws whole.
 */
const HINDI = 'प्रिय मित्र किताब'
const HINDI_WORDS = ['प्रिय', ' ', 'मित्र', ' ', 'किताब']
const TELUGU = 'నమస్కారం తెలుగు మిత్రమా'
const TELUGU_WORDS = ['నమస్కారం', ' ', 'తెలుగు', ' ', 'మిత్రమా']
const MIXED = 'hello प्रिय world'
const LATIN = 'hello world'
const CYRILLIC = 'привет мир'

describe('piecesOf a shaped script', () => {
  it('moves a Hindi line by word under character scope', () => {
    expect(piecesOf(HINDI, 'char')).toEqual(HINDI_WORDS)
    expect(piecesOf(HINDI, 'char')).toEqual(piecesOf(HINDI, 'word'))
  })

  it('moves a Telugu line by word under character scope', () => {
    expect(piecesOf(TELUGU, 'char')).toEqual(TELUGU_WORDS)
    expect(piecesOf(TELUGU, 'char')).toEqual(piecesOf(TELUGU, 'word'))
  })

  it('moves a mixed line by word whole, its Latin words included', () => {
    expect(piecesOf(MIXED, 'char')).toEqual(['hello', ' ', 'प्रिय', ' ', 'world'])
    expect(piecesOf(MIXED, 'char')).toEqual(piecesOf(MIXED, 'word'))
  })

  it('still cuts every other line into code points, exactly as before', () => {
    // The fallback is for shaped scripts alone: a Latin, Cyrillic, Greek or
    // CJK line under `bounce` gets the very pieces it got before D8's fix.
    for (const line of [LATIN, CYRILLIC, 'ab c', 'Γειά σου', '日本語 です', 'Bride 5:30pm!']) {
      expect(piecesOf(line, 'char'), line).toEqual(Array.from(line))
    }
  })

  it('leaves word and block scope as they were for a shaped line', () => {
    expect(piecesOf(HINDI, 'word')).toEqual(HINDI_WORDS)
    expect(piecesOf(HINDI, 'block')).toEqual([HINDI])
  })
})

describe('shapedScript', () => {
  it('is true for Devanagari, Telugu and a line mixing one in', () => {
    expect(shapedScript(HINDI)).toBe(true)
    expect(shapedScript(TELUGU)).toBe(true)
    expect(shapedScript(MIXED)).toBe(true)
  })

  it('is false for Latin and Cyrillic, and for nothing', () => {
    expect(shapedScript(LATIN)).toBe(false)
    expect(shapedScript(CYRILLIC)).toBe(false)
    expect(shapedScript('')).toBe(false)
  })

  it('gives the same answer however often it is asked', () => {
    // A stateful regex (a `g` flag on a shared one) answers true, then false
    // once its lastIndex has walked past the last shaped letter. Asked of one
    // line in a row: a miss in between would reset it and hide the fault.
    for (let i = 0; i < 24; i++) expect(shapedScript(MIXED), `call ${i}`).toBe(true)
    for (let i = 0; i < 24; i++) expect(shapedScript(LATIN), `call ${i}`).toBe(false)
  })

  it('holds Devanagari and Telugu, the scripts D8 names first', () => {
    // Membership, never the list: CLIPS §6.20 records the list as a proposal
    // for the user to narrow or extend.
    expect(SHAPED_SCRIPTS).toContain('Devanagari')
    expect(SHAPED_SCRIPTS).toContain('Telugu')
  })

  it('reads a sample of each script it lists', () => {
    // Iterates the constant, so a script narrowed away is simply not tried, and
    // one added without a sample here is still compiled below.
    const samples: Partial<Record<string, string>> = {
      Devanagari: 'किताब',
      Bengali: 'বাংলা',
      Gurmukhi: 'ਪੰਜਾਬੀ',
      Gujarati: 'ગુજરાતી',
      Oriya: 'ଓଡ଼ିଆ',
      Tamil: 'தமிழ்',
      Telugu: 'తెలుగు',
      Kannada: 'ಕನ್ನಡ',
      Malayalam: 'മലയാളം',
      Sinhala: 'සිංහල',
      Arabic: 'عربي',
      Syriac: 'ܣܘܪܝܝܐ',
      Thai: 'ไทย',
      Lao: 'ລາວ',
      Tibetan: 'བོད',
      Myanmar: 'မြန်မာ',
      Khmer: 'ខ្មែរ'
    }
    for (const script of SHAPED_SCRIPTS) {
      // Each name must be one the regex engine knows as a script.
      expect(() => new RegExp(`\\p{Script=${script}}`, 'u'), script).not.toThrow()
      const sample = samples[script]
      if (!sample) continue
      expect(new RegExp(`\\p{Script=${script}}`, 'u').test(sample), `${script} sample`).toBe(true)
      expect(shapedScript(sample), script).toBe(true)
      expect(shapedScript(`ok ${sample}`), `${script} mixed`).toBe(true)
    }
  })
})
