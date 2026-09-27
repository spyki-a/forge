import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { emptyProject, type Clip, type MediaAsset, type MomentSpec, type Project } from '@shared/timeline'
import { buildRenderPlan } from '@shared/render/plan'
import { bakeForExport, type Bakers } from '@shared/render/exportBake'
import { momentPlacement, momentSpan, movingFrames } from '@shared/render/moment'
import { FFMPEG, outputDir, pixelAt, run, saveFrame, writeNote } from './output'

/*
 * A moment, baked and rendered (docs/PLAN.md §7.4).
 *
 * The shader is proved in the harness, where there is a GPU. What node can
 * prove is the rest of the path — the span against the cut, the export bake
 * at the export's shape, the overlay of numbered PNGs with `tpad` — so the
 * frames here come from a fake drawer that keeps the same contract: its first
 * frame is the outgoing card, its last the incoming one, and every frame
 * between a grey of its own, so each rendered frame says WHICH of the
 * moment's frames it is. A zoom punch over a red card cutting to a blue one,
 * rendered at 9:16 (the project's shape) and 16:9 (an export's).
 */

const fps = 30
const CUT = 30
let dir = ''
const files: Record<'portrait' | 'landscape', string> = { portrait: '', landscape: '' }
const canvases = { portrait: { width: 90, height: 160 }, landscape: { width: 160, height: 90 } }
const spec: MomentSpec = { kind: 'zoom-punch', from: { clipId: 'red' }, to: { clipId: 'blue' }, seconds: 0.4, intensity: 0.5, seed: 1, version: 1 }
const span = momentSpan(spec, fps)
const placement = momentPlacement(CUT, span)
/* A depth push over the blue card, which runs 60 frames: 45 move, 15 hold. */
const push: MomentSpec = { kind: 'depth-push', to: { clipId: 'blue' }, seconds: 1.5, intensity: 0.5, seed: 2, version: 1 }
const PUSH_SHOT = 60
let pushFile = ''
const lines: string[] = []

async function still(file: string, colour: string, width: number, height: number): Promise<string> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=${width}x${height}`, '-frames:v', '1', file])
  return file
}

/** The grey the fake drawer gives moment frame `i` (0 < i < last): distinct, so a rendered frame names its source. */
const grey = (i: number, step = 15): number => 20 + i * step
const hex = (level: number): string => `0x${level.toString(16).padStart(2, '0').repeat(3)}`

/**
 * The fake drawer: the timing contract, without a shader. A bridge's first
 * frame is the outgoing card and its last the incoming; a depth push writes
 * only its MOVING frames (movingFrames), a grey per frame, and leaves the
 * hold to the render.
 */
const bakers = (colours: Record<string, string>): Bakers => ({
  moment: async (spec, key, textures, width, height, frames, rate) => {
    const seq = join(dir, `${key}.seq`)
    await mkdir(seq, { recursive: true })
    const moving = movingFrames(spec, rate, frames)
    for (let i = 0; i < moving; i++) {
      const colour = !textures.from
        ? hex(grey(i, 5))
        : i === 0 ? colours[textures.from.path] : i === moving - 1 ? colours[textures.to.path] : hex(grey(i))
      await still(join(seq, `${String(i).padStart(5, '0')}.png`), colour, width, height)
    }
    return { pattern: join(seq, '%05d.png'), frames: moving }
  },
  text: async () => { throw new Error('no text') },
  textSequence: async () => null,
  solid: async () => { throw new Error('no solid') },
  title: async () => { throw new Error('no title') },
  paper: async () => { throw new Error('no paper') },
  carousel: async () => { throw new Error('no carousel') }
})

beforeAll(async () => {
  dir = await outputDir('moment')
  const media = join(dir, 'media')
  await mkdir(media, { recursive: true })
  const red = await still(join(media, 'red.png'), 'red', 90, 160)
  const blue = await still(join(media, 'blue.png'), 'blue', 90, 160)
  const asset = (id: string, path: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
    id, path, name: id, kind: 'image', durationFrames: 300, width: 90, height: 160, fps: null, hasVideo: true, hasAudio: false, size: 100, ...over
  })
  const clip = (over: Partial<Clip> & { id: string; assetId: string }): Clip => ({
    trackId: 'v1', start: 0, duration: CUT, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
  })
  const empty = emptyProject()
  const project: Project = {
    ...empty,
    settings: { ...empty.settings, ...canvases.portrait, fps },
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
      { id: 'v2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false },
      { id: 'a1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false }
    ],
    assets: [asset('red', red), asset('blue', blue), asset('m', '', { size: 0 })],
    clips: [
      clip({ id: 'red', assetId: 'red', start: 0 }),
      clip({ id: 'blue', assetId: 'blue', start: CUT }),
      clip({ id: 'm', assetId: 'm', trackId: 'v2', start: placement.start, duration: placement.duration, moment: spec })
    ]
  }
  for (const shape of ['portrait', 'landscape'] as const) {
    const canvas = canvases[shape]
    const baked = await bakeForExport(project, canvas, bakers({ [red]: 'red', [blue]: 'blue' }), (c, err) => {
      throw new Error(`${c.id}: ${String(err)}`)
    })
    files[shape] = join(dir, `${shape}.mp4`)
    const plan = buildRenderPlan({ project: baked, outputPath: files[shape], canvas })
    await writeFile(join(dir, `${shape}.graph.txt`), plan.args.join(' ').replace(/;/g, ';\n'))
    await run(FFMPEG, plan.args, { maxBuffer: 64 * 1024 * 1024 })
  }

  /* The push: the blue card lengthened to 60 frames, the moment over all of it. */
  const pushed: Project = {
    ...project,
    clips: [
      project.clips[0],
      { ...project.clips[1], duration: PUSH_SHOT },
      clip({ id: 'm', assetId: 'm', trackId: 'v2', start: CUT, duration: PUSH_SHOT, moment: push })
    ]
  }
  const bakedPush = await bakeForExport(pushed, canvases.portrait, bakers({ [red]: 'red', [blue]: 'blue' }), (c, err) => {
    throw new Error(`${c.id}: ${String(err)}`)
  })
  pushFile = join(dir, 'push.mp4')
  const pushPlan = buildRenderPlan({ project: bakedPush, outputPath: pushFile, canvas: canvases.portrait })
  await writeFile(join(dir, 'push.graph.txt'), pushPlan.args.join(' ').replace(/;/g, ';\n'))
  await run(FFMPEG, pushPlan.args, { maxBuffer: 64 * 1024 * 1024 })
}, 300_000)

/**
 * Just before a frame's own timestamp, in seconds. `-ss` seeks accurately and
 * hands back the first frame AT OR AFTER the point, so asking for the middle
 * of a frame gets the next one — measured: every sample landed one frame late.
 */
const at = (frame: number): number => (frame - 0.25) / fps

describe('a zoom punch over a cut', () => {
  it('spans the cut evenly: 12 frames, six before and six after', () => {
    expect(span).toEqual({ before: 6, after: 6, total: 12 })
    expect(placement).toEqual({ start: 24, duration: 12 })
  })

  for (const shape of ['portrait', 'landscape'] as const) {
    it(`${shape}: the frame before it is the outgoing card, the frame after the incoming, and the cut frame is the moment’s own middle`, async () => {
      const file = files[shape]
      const canvas = canvases[shape]
      const cx = Math.round(canvas.width / 2)
      const cy = Math.round(canvas.height / 2)
      const before = await pixelAt(file, at(placement.start - 1), cx, cy, canvas)
      const first = await pixelAt(file, at(placement.start), cx, cy, canvas)
      const cut = await pixelAt(file, at(CUT), cx, cy, canvas)
      const cutCorner = await pixelAt(file, at(CUT), 4, 4, canvas)
      const last = await pixelAt(file, at(placement.start + placement.duration - 1), cx, cy, canvas)
      const after = await pixelAt(file, at(placement.start + placement.duration), cx, cy, canvas)
      await saveFrame(file, at(CUT), join(dir, `${shape}.cut.png`))
      lines.push(
        `- ${shape} ${canvas.width}×${canvas.height}: frame ${placement.start - 1} rgb(${before.join(', ')}), first ${placement.start} rgb(${first.join(', ')}), ` +
          `cut ${CUT} rgb(${cut.join(', ')}) corner rgb(${cutCorner.join(', ')}), last rgb(${last.join(', ')}), after rgb(${after.join(', ')})`
      )
      // Before and on its first frame: red. On its last and after: blue.
      for (const px of [before, first]) {
        expect(px[0]).toBeGreaterThan(200)
        expect(px[2]).toBeLessThan(50)
      }
      for (const px of [last, after]) {
        expect(px[2]).toBeGreaterThan(200)
        expect(px[0]).toBeLessThan(50)
      }
      // The cut frame is the moment's frame `before` — its own grey, to the frame (H.264 lands within a few levels).
      const want = grey(span.before)
      for (const channel of cut) expect(Math.abs(channel - want)).toBeLessThan(6)
      // And it fills the EXPORT's frame: the corner is that grey too, not the letterbox a project-shaped bake would leave.
      for (const channel of cutCorner) expect(Math.abs(channel - want)).toBeLessThan(6)
    })
  }

  it('a depth push writes only its moving frames, and the render holds the last of them to the end of the shot', async () => {
    const moving = movingFrames(push, fps, PUSH_SHOT)
    expect(moving).toBe(45)
    const canvas = canvases.portrait
    const cx = Math.round(canvas.width / 2)
    const cy = Math.round(canvas.height / 2)
    const before = await pixelAt(pushFile, at(CUT - 1), cx, cy, canvas)
    const first = await pixelAt(pushFile, at(CUT), cx, cy, canvas)
    const lastMoving = await pixelAt(pushFile, at(CUT + moving - 1), cx, cy, canvas)
    const held = await pixelAt(pushFile, at(CUT + moving + 7), cx, cy, canvas)
    const end = await pixelAt(pushFile, at(CUT + PUSH_SHOT - 1), cx, cy, canvas)
    lines.push(`- push: frame ${CUT - 1} rgb(${before.join(', ')}), first rgb(${first.join(', ')}), last moving (${CUT + moving - 1}) rgb(${lastMoving.join(', ')}), held (+7) rgb(${held.join(', ')}), shot’s last rgb(${end.join(', ')})`)
    expect(before[0]).toBeGreaterThan(200)
    for (const channel of first) expect(Math.abs(channel - grey(0, 5))).toBeLessThan(6)
    // Frame 44 is the last drawn; 45 on is that frame, held — never the blue card beneath.
    for (const px of [lastMoving, held, end]) for (const channel of px) expect(Math.abs(channel - grey(moving - 1, 5))).toBeLessThan(6)
  })

  it('writes the note', async () => {
    await writeNote(dir, [
      '# moment', '',
      'A zoom punch (0.4 s, 12 frames) over a red card cutting to a blue one at frame 30, drawn by a fake drawer that keeps the timing contract:',
      'first frame red, last frame blue, each frame between a grey of its own (20 + 15·i). Rendered at the project’s 9:16 and at a 16:9 export.',
      'And a depth push (1.5 s) over the blue card lengthened to 60 frames: 45 frames drawn (grey 20 + 5·i), the 45th held by the render for the rest.', '',
      ...lines
    ])
  })
})
