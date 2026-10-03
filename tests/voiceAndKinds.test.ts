import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { VOICES, voiceById, voiceFilters, MIN_PITCH, MAX_PITCH } from '@shared/render/voice'
import { ATEMPO_MIN } from '@shared/render/speed'
import { clipKind, kindsPresent, styleFor, SFX_MAX_SECONDS } from '@shared/edit/clipKind'
import { clockStep } from '@shared/render/clock'
import { emptyProject, type Clip, type MediaAsset, type Track } from '@shared/timeline'

const RATE = 48000

describe('voice effects', () => {
  it('leaves a clip alone when it has none', () => {
    expect(voiceFilters(undefined, RATE)).toEqual([])
    expect(voiceFilters({ id: 'chipmunk' as const }, 0)).toEqual([])
  })

  it('shifts pitch and puts the SPEED back, so the clip is the same length', () => {
    /*
     * The whole trick. `asetrate` moves pitch and speed together; without the
     * `atempo` undoing the speed, a chipmunk voice would also be a shorter
     * clip — and every cut after it on the timeline would be off the beat.
     */
    const filters = voiceFilters({ id: 'chipmunk' }, RATE)
    const preset = voiceById('chipmunk')!

    expect(filters[0]).toBe(`asetrate=${Math.round(RATE * preset.pitch)}`)
    expect(filters[1]).toBe(`atempo=${Number((1 / preset.pitch).toFixed(4))}`)
    // And back to the project's rate, or every later filter runs at its own.
    expect(filters[2]).toBe(`aresample=${RATE}`)
  })

  it('is exactly reciprocal: the two rate changes cancel', () => {
    for (const preset of VOICES.filter((v) => Math.abs(v.pitch - 1) >= 0.001)) {
      const filters = voiceFilters({ id: preset.id }, RATE)
      const rate = Number(/asetrate=(\d+)/.exec(filters.join(' '))![1])
      const tempo = Number(/atempo=([\d.]+)/.exec(filters.join(' '))![1])

      // Playing back `rate` samples per second at `tempo` speed returns the
      // original duration, within the rounding of an integer sample rate.
      expect((rate / RATE) * tempo, preset.id).toBeCloseTo(1, 3)
    }
  })

  it('keeps every preset inside the measured atempo range', () => {
    /*
     * atempo refuses below 0.5 — measured, not read off a release note
     * (render/speed.ts). Undoing a pitch of P costs a tempo of 1/P, so a
     * preset above 2 could not be corrected by a single atempo and would need
     * a chain that makes a voice sound like a fax machine.
     */
    expect(MIN_PITCH).toBe(ATEMPO_MIN)
    expect(MAX_PITCH).toBe(1 / ATEMPO_MIN)
    for (const preset of VOICES) {
      expect(preset.pitch, preset.id).toBeGreaterThanOrEqual(MIN_PITCH)
      expect(preset.pitch, preset.id).toBeLessThanOrEqual(MAX_PITCH)
      const tempo = 1 / preset.pitch
      expect(tempo, `${preset.id} tempo`).toBeGreaterThanOrEqual(ATEMPO_MIN)
    }
  })

  it('band presets filter instead of retuning', () => {
    // A phone call is not a different voice, it is a narrower channel.
    const filters = voiceFilters({ id: 'phone' }, RATE)
    expect(filters.some((f) => f.startsWith('asetrate'))).toBe(false)
    expect(filters).toContain('highpass=f=400')
    expect(filters).toContain('lowpass=f=3400')
  })

  it('uses nothing newer than the Windows build allows', () => {
    /*
     * The floor is a DATE — 2018-12-17 (CLAUDE.md). All four of these were
     * merged years before it and are present on the bundled binary, measured.
     * This pins the set so a fifth filter cannot be added without the question
     * being asked again.
     */
    const used = new Set(
      VOICES.flatMap((v) => voiceFilters({ id: v.id }, RATE)).map((f) => f.split('=')[0])
    )
    expect([...used].sort()).toEqual(['aresample', 'asetrate', 'atempo', 'highpass', 'lowpass'])
  })

  it('refuses an id it does not know rather than guessing', () => {
    expect(voiceById('nope')).toBeNull()
    expect(voiceFilters({ id: 'nope' as never }, RATE)).toEqual([])
  })
})

describe('what a clip is, for the eye', () => {
  const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
    id: 'a', path: '/a.mp4', name: 'a', kind: 'video', durationFrames: 300,
    width: 100, height: 100, fps: 30, hasVideo: true, hasAudio: true, size: 1, ...over
  })
  const clip = (over: Partial<Clip> = {}): Clip => ({
    id: 'c', assetId: 'a', trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
  })
  const video: Track = { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false }
  const audio: Track = { id: 'a1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false }

  it('reads the kind off what the clip already carries', () => {
    expect(clipKind(clip(), asset(), video, 30)).toBe('video')
    expect(clipKind(clip({ adjustment: true }), asset(), video, 30)).toBe('adjustment')
    expect(clipKind(clip({ text: {} as never }), asset(), video, 30)).toBe('text')
    expect(clipKind(clip({ paper: {} as never }), asset(), video, 30)).toBe('graphic')
    expect(clipKind(clip(), asset({ kind: 'image' }), video, 30)).toBe('image')
    expect(clipKind(clip(), asset({ matte: '/m.mp4' }), video, 30)).toBe('sticker')
    expect(clipKind(clip({ voice: { id: 'deep' } }), asset(), video, 30)).toBe('voice')
  })

  it('splits sound by role, and a ducked track is music at any length', () => {
    /*
     * There is no flag saying "this is an effect", and inventing one would
     * make every existing project guess wrong. Length is the honest signal: a
     * whoosh is a hit, a bed runs under the edit. But a track MARKED to duck
     * is someone saying it is music, which beats any guess.
     */
    const short = clip({ trackId: 'a1', duration: SFX_MAX_SECONDS * 30 - 1 })
    const long = clip({ trackId: 'a1', duration: SFX_MAX_SECONDS * 30 + 60 })

    expect(clipKind(short, asset({ kind: 'audio' }), audio, 30)).toBe('sfx')
    expect(clipKind(long, asset({ kind: 'audio' }), audio, 30)).toBe('music')
    expect(clipKind(short, asset({ kind: 'audio' }), { ...audio, duck: true }, 30)).toBe('music')
  })

  it('every kind has a style, and the legend keeps a stable order', () => {
    // A kind with no style would render as an unstyled box, which reads as a
    // broken clip rather than as a missing colour.
    for (const kind of ['video', 'image', 'text', 'sticker', 'graphic', 'music', 'sfx', 'voice', 'adjustment'] as const) {
      expect(styleFor(kind).kind, kind).toBe(kind)
      expect(styleFor(kind).dot, kind).toMatch(/^bg-/)
    }

    // Order comes from the table, not from the order clips happen to appear,
    // so the legend does not rearrange itself as the timeline is edited.
    const one = kindsPresent(['sfx', 'video']).map((s) => s.kind)
    const other = kindsPresent(['video', 'sfx']).map((s) => s.kind)
    expect(one).toEqual(other)
    expect(one).toEqual(['video', 'sfx'])
    expect(kindsPresent([])).toEqual([])
  })

  it('gives every kind a hue of its own, and none of them the accent', () => {
    /*
     * Text and paper clippings were violet and indigo — one purple, side by
     * side on the timeline — and a photo and a shot were cyan and sky. Colour
     * is for finding a clip, so no two kinds share a hue; and blue is the
     * app's accent (the playhead, the selection), so no kind wears it. Orange
     * stays out too: it was the accent until the user took it away.
     */
    const kinds = ['video', 'image', 'text', 'sticker', 'graphic', 'music', 'sfx', 'voice', 'adjustment'] as const
    const hueOf = (kind: (typeof kinds)[number]): string => /^bg-([a-z]+)-\d+$/.exec(styleFor(kind).dot)?.[1] ?? ''
    const hues = kinds.map(hueOf)
    expect(new Set(hues).size, hues.join(', ')).toBe(kinds.length)
    expect(hues).not.toContain('orange')
    expect(hues).not.toContain('blue')
    expect(hues).not.toContain('accent')
    // Text and graphics, the pair that prompted this, are not neighbours either.
    expect(['violet', 'indigo', 'purple', 'fuchsia']).not.toContain(hueOf('text'))
    // And each kind's body, border and swatch are one hue, not a mix.
    for (const kind of kinds) {
      const style = styleFor(kind)
      const used = new Set([...`${style.idle} ${style.selected} ${style.dot}`.matchAll(/-(?:bg|border)?([a-z]+)-\d{2,3}/g)].map((m) => m[1]))
      expect([...used].filter((h) => h !== 'bg' && h !== 'border'), kind).toEqual([hueOf(kind)])
    }
  })

  it('keeps every shade a kind wears visibly apart from every accent step, measured, not named', () => {
    /*
     * The name check above forbids `blue`, but indigo is a different name for
     * nearly the same colour: 0.070 from the accent in OKLab, against blue's
     * 0.078. So this one measures. Each shade comes from Tailwind's own theme
     * (OKLCH), the accent steps from the app's @theme (hex), and the distance is
     * Euclidean in OKLab, with 0.12 as the floor.
     *
     * Every shade a kind's classes use, not only its swatch, and against every
     * accent step that draws on the timeline (the 500 playhead and selection,
     * the 400 drag box and markers, the 300 selected transition). The first
     * version measured only each -500 against accent-500 — a shade no clip body
     * wears, the -500 is the legend dot — and passed graphics on sky, whose
     * -700 selected border is 0.105 from accent-400.
     */
    const theme = readFileSync(resolve(__dirname, '../node_modules/tailwindcss/theme.css'), 'utf8')
    const styles = readFileSync(resolve(__dirname, '../src/renderer/src/styles.css'), 'utf8')
    const accentHexes = [500, 400, 300].map((step) => {
      const hex = new RegExp(`--color-accent-${step}:\\s*#([0-9a-f]{6});`, 'i').exec(styles)?.[1]
      expect(hex, `--color-accent-${step} in styles.css`).toBeDefined()
      return [step, hex!] as const
    })

    const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const fromHex = (hex: string): [number, number, number] => {
      const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255))
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      ]
    }
    /** `violet-700` → OKLab, from Tailwind's theme. */
    const fromTheme = (shade: string): [number, number, number] => {
      const m = new RegExp(`--color-${shade}:\\s*oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`).exec(theme)
      expect(m, `--color-${shade} in tailwindcss/theme.css`).not.toBeNull()
      const [L, C, H] = [Number(m![1]) / 100, Number(m![2]), (Number(m![3]) * Math.PI) / 180]
      return [L, C * Math.cos(H), C * Math.sin(H)]
    }
    const accents = accentHexes.map(([step, hex]) => [step, fromHex(hex)] as const)
    /** The nearest accent step to a shade, and how near. */
    const nearest = (shade: string): { step: number; distance: number } => {
      const lab = fromTheme(shade)
      return accents
        .map(([step, a]) => ({ step, distance: Math.hypot(...lab.map((v, i) => v - a[i])) }))
        .reduce((best, next) => (next.distance < best.distance ? next : best))
    }

    // The measure is about something: what the name check cannot see fails it —
    // indigo, and the sky border that the first version of this test let through.
    expect(nearest('blue-500').distance).toBeLessThan(0.12)
    expect(nearest('indigo-500').distance).toBeLessThan(0.12)
    expect(nearest('sky-700').distance).toBeLessThan(0.12)

    /** Every Tailwind colour a class string paints with: `hover:bg-teal-300/70` → `teal-300`. */
    const shadesIn = (classes: string): string[] =>
      [...classes.matchAll(/(?<![\w-])(?:[a-z-]+:)*(?:bg|border)-([a-z]+-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g)].map((m) => m[1])

    const kinds = ['video', 'image', 'text', 'sticker', 'graphic', 'music', 'sfx', 'voice', 'adjustment'] as const
    const tooClose: string[] = []
    for (const kind of kinds) {
      const style = styleFor(kind)
      // Each part is read, or the loop below measures nothing for it.
      for (const part of ['idle', 'selected', 'dot'] as const) {
        expect(shadesIn(style[part]).length, `${kind}.${part} paints with a colour`).toBeGreaterThan(0)
      }
      const worn = new Set([style.idle, style.selected, style.dot].flatMap(shadesIn))
      // The selected border, the shade that sky failed on, is among them.
      const border = /(?<![\w-])border-([a-z]+-\d{2,3})(?![\w-])/.exec(style.selected)?.[1]
      expect(border, `${kind} has a selected border`).toBeDefined()
      expect([...worn], kind).toContain(border)
      for (const shade of worn) {
        const { step, distance } = nearest(shade)
        if (distance < 0.12) tooClose.push(`${kind}: ${shade} is ${distance.toFixed(3)} from accent-${step}`)
      }
    }
    expect(tooClose).toEqual([])
  })
})

describe('playback inside a marked range', () => {
  const anchor = { at: 0, frame: 0 }
  const at = (ms: number) => clockStep(anchor, ms, 30, 300, true, 100)

  it('returns to the IN point rather than to zero', () => {
    // 11 seconds at 30fps is frame 330, past the out point of 300.
    expect(at(11_000)).toEqual({ kind: 'loop', frame: 100 })
  })

  it('stops at the out point when not looping', () => {
    expect(clockStep(anchor, 11_000, 30, 300, false, 100)).toEqual({ kind: 'stop', frame: 300 })
  })

  it('ignores a start that is not inside the range', () => {
    // A start at or past the end is a mistake upstream, and looping to it
    // would never advance. The whole timeline is the honest answer.
    expect(clockStep(anchor, 11_000, 30, 300, true, 300)).toEqual({ kind: 'loop', frame: 0 })
    expect(clockStep(anchor, 11_000, 30, 300, true, 900)).toEqual({ kind: 'loop', frame: 0 })
    expect(clockStep(anchor, 11_000, 30, 300, true, -5)).toEqual({ kind: 'loop', frame: 0 })
  })

  it('behaves exactly as before when no range is marked', () => {
    // Every existing caller passes five arguments; none of them may change.
    expect(clockStep(anchor, 11_000, 30, 300, true)).toEqual({ kind: 'loop', frame: 0 })
    expect(clockStep(anchor, 1_000, 30, 300, true)).toEqual({ kind: 'play', frame: 30 })
    expect(clockStep(anchor, 1_000, 30, 0, true)).toEqual({ kind: 'stop', frame: 0 })
  })
})

describe('the project model still round-trips a voice', () => {
  it('carries the effect on the clip and nowhere else', () => {
    const p = emptyProject()
    expect(p.clips).toHaveLength(0)
    // Absent means untouched, which is every clip made before this existed.
    const plain: Clip = {
      id: 'c', assetId: 'a', trackId: 'a1', start: 0, duration: 30, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 }
    }
    expect(plain.voice).toBeUndefined()
    expect(voiceFilters(plain.voice, RATE)).toEqual([])
  })
})
