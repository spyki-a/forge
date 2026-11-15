import { describe, expect, it } from 'vitest'
import { CLIPS_GRAPHIC_RULE, applyGraphics, graphicDropsOf } from '@shared/graphics/apply'
import { tooCloseReason } from '@shared/graphics/budget'
import { runGraphicsPass, type GraphicsBaseline } from '@shared/director/run'
import type { GraphicCandidate } from '@shared/graphics/template'
import type { Segment, Transcript, Word } from '@shared/transcript'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * Try-out 1 (2026-11-15), F1: the shape of the owner's run, end to end through
 * runGraphicsPass (no model: the baseline route) and applyGraphics. A clip with
 * a Speaker, a keyword at 5.4 s, a ring at 10.04 s, a keyword at 18.0 s, a
 * counter at 21.3 s and a keyword at 24.2 s. In the try-out the ring and the
 * counter were spaced out inside settle (each within 6 s of an earlier
 * keyword), and the budget then dropped the first keyword for the lower third,
 * so the ring lost its room to a graphic that never landed. Now the lower
 * third, the ring and the counter land; the three keywords do not, each with a
 * reason that names what it lost to.
 *
 * The transcript is synthetic, English, written here: each sentence's words
 * are placed so the graphic's first beat word starts at the try-out's onset.
 */

const FPS = 30

/** A sentence: its words and the start of each, in ms. */
type Line = [string, number[]]

function step(from: number, n: number, ms: number): number[] {
  return Array.from({ length: n }, (_, i) => from + i * ms)
}

const LINES: Line[] = [
  ['I am Asha.', step(3660, 3, 140)], // s00: the lower third's beat, the clip's first shown word at 3.66 s
  ['First of all, thank you for watching.', step(4200, 7, 200)], // s01: "watching" at 5.4 s
  ['40% of my couples book me a year ahead.', step(10040, 9, 300)], // s02: "40%" at 10.04 s
  ['Light matters more than gear.', step(16800, 5, 300)], // s03: "gear" at 18.0 s
  ['A full wedding costs $2,500.', step(20100, 5, 300)], // s04: "$2,500", the counter's first beat, at 21.3 s
  ['First, check the venue.', step(23300, 4, 300)], // s05: "venue" at 24.2 s
  ...Array.from({ length: 24 }, (_, k): Line => ['The light was soft that day.', step(26000 + k * 2900, 6, 400)])
]

function transcript(): Transcript {
  const words: Word[] = []
  const segments: Segment[] = []
  LINES.forEach(([text, starts], k) => {
    const first = words.length
    text.split(' ').forEach((w, i) => words.push({ index: words.length, text: w, startMs: starts[i], endMs: starts[i] + 120, confidence: null }))
    segments.push({ id: `s${String(k).padStart(2, '0')}`, startMs: starts[0], endMs: starts[starts.length - 1] + 120, text, wordStart: first, wordEnd: words.length - 1 })
  })
  return { assetId: 'talk', language: 'en', model: 'small', durationMs: 100000, words, segments }
}

/** 95.7 s of the talk on V1, its asset with a Speaker: room for four graphics, the lower third outside the count. */
function setup(): { project: Project; clip: Clip } {
  const base = emptyProject('try-out room')
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const asset: MediaAsset = { id: 'talk', path: '/media/talk.mp4', name: 'talk.mp4', kind: 'video', durationFrames: FPS * 100, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1, speaker: 'Asha' }
  const clip: Clip = { id: 'shot', assetId: 'talk', trackId, start: 0, duration: Math.round(FPS * 95.7), inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR } }
  return { clip, project: { ...base, settings: { ...base.settings, fps: FPS }, assets: [asset], clips: [clip], transcripts: { talk: transcript() } } }
}

const cand = (sentence: string, data: GraphicCandidate['data']): GraphicCandidate => ({ sentence, data, bound: [], beatWords: [], why: 'try-out 1', source: 'baseline' })

/** The try-out's candidates, as the baseline gave them for the window that holds s01 to s05 (a later window gets none). */
const baseline: GraphicsBaseline = (_t, menu) =>
  menu.sentences.some((s) => s.id === 's01')
    ? [
        cand('s01', { template: 'keyword', words: 'watching', lit: 0 }),
        cand('s02', { template: 'ring', value: '40%', label: 'couples' }),
        cand('s03', { template: 'keyword', words: 'gear', lit: 0 }),
        cand('s04', { template: 'counter', value: '$2,500', label: 'wedding' }),
        cand('s05', { template: 'keyword', words: 'venue', lit: 0 })
      ]
    : []

describe("try-out 1's room: nothing loses room to a graphic that does not land", () => {
  it('the lower third, the ring and the counter land; the three keywords do not, each with a true reason', async () => {
    const { project, clip } = setup()
    const run = await runGraphicsPass(project, [clip], async () => ({ answer: { error: 'No model is set up' }, model: null }), { baseline })
    // Settle keeps all five (it no longer decides room): what reaches the budget is everything the validator passed.
    expect(run.pair.kept.map((k) => [k.candidate.sentence, k.candidate.data.template])).toEqual([
      ['s01', 'keyword'],
      ['s02', 'ring'],
      ['s03', 'keyword'],
      ['s04', 'counter'],
      ['s05', 'keyword']
    ])
    expect(run.pair.settled.drops).toEqual([])

    let n = 0
    const out = applyGraphics(project, run.pair.kept, [clip.id], CLIPS_GRAPHIC_RULE, { fps: FPS, newId: (p) => `${p}-${++n}` })
    const placed = out.clipIds.map((id) => out.project.clips.find((c) => c.id === id)!)
    expect(placed.map((c) => c.graphic!.data.template)).toEqual(['lower-third', 'ring', 'counter'])
    const onset = (c: Clip): number => c.start / FPS + Math.min(...c.graphic!.beats)
    // The onsets the try-out measured, to a frame.
    expect(placed.map((c) => Math.abs(onset(c) - [3.66, 10.04, 21.3][placed.indexOf(c)]) <= 1 / FPS)).toEqual([true, true, true])

    const [lower, , counter] = placed
    const drops = graphicDropsOf(project, run.pair.kept, [clip.id], out.problems)
    expect(drops.map((d) => [d.template, d.text, d.reason])).toEqual([
      ['keyword', 'watching', tooCloseReason({ template: 'lower-third', onset: onset(lower), placed: false }, 'outranked')],
      ['keyword', 'gear', tooCloseReason({ template: 'counter', onset: onset(counter), placed: false }, 'outranked')],
      ['keyword', 'venue', tooCloseReason({ template: 'counter', onset: onset(counter), placed: false }, 'outranked')]
    ])
    // As the dock reads them.
    expect(drops.map((d) => d.reason)).toEqual([
      'within 6 s of the lower third at 3.7 s; a keyword yields to any other graphic',
      'within 6 s of the counter at 21.3 s; a keyword yields to any other graphic',
      'within 6 s of the counter at 21.3 s; a keyword yields to any other graphic'
    ])
  })
})
