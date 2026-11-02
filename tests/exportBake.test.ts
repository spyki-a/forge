import { describe, it, expect } from 'vitest'
import { bakeForExport, exportBakeSizes, exportKey, type Bakers } from '@shared/render/exportBake'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import type { GraphicTargets } from '@shared/graphics/items'
import { graphicStyleOf } from '@shared/graphics/style'

/*
 * An export draws its own cards, at its own canvas, into a copy.
 *
 * The editor's rebake drew at the PROJECT's canvas and wrote into the edit, so
 * a 16:9 project through the 9:16 preset got its titles letterboxed, and every
 * export added undo entries and marked the project unsaved. Found by the B2
 * review. The drawing itself is canvas code; here it is faked, recording what
 * it was asked for, because what is under test is what gets ASKED.
 */

interface Call { kind: string; key: string; width: number; height: number }

function fakeBakers(fail: string[] = []): { bakers: Bakers; calls: Call[] } {
  const calls: Call[] = []
  const record = (kind: string, key: string, width: number, height: number): void => {
    calls.push({ kind, key, width, height })
    if (fail.includes(key)) throw new Error(`could not draw ${key}`)
  }
  const bakers: Bakers = {
    text: async (_s, key, w, h) => { record('text', key, w, h); return `/cache/${key}.png` },
    textSequence: async (spec, key, w, h) => {
      record('textSequence', key, w, h)
      return spec.animationId ? { pattern: `/cache/${key}.seq/%05d.png`, frames: 30 } : null
    },
    solid: async (_s, key, w, h) => { record('solid', key, w, h); return `/cache/${key}.png` },
    title: async (_s, key, w, h) => { record('title', key, w, h); return `/cache/${key}.png` },
    paper: async (_s, key, w, h, frames) => {
      record('paper', key, w, h)
      return { pattern: `/cache/${key}.seq/%05d.png`, frames }
    },
    carousel: async (_s, key, _p, w, h, frames) => {
      record('carousel', key, w, h)
      return { pattern: `/cache/${key}.seq/%05d.png`, frames }
    },
    moment: async (_s, key, _t, w, h, frames) => {
      record('moment', key, w, h)
      return { pattern: `/cache/${key}.seq/%05d.png`, frames }
    },
    graphic: async (_s, _style, key, w, h, frames) => {
      record('graphic', key, w, h)
      return { pattern: `/cache/${key}.seq/%05d.png`, frames }
    }
  }
  return { bakers, calls }
}

const asset = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  id, path: `/edit/${id}.png`, name: id, kind: 'image', durationFrames: 90,
  width: 1920, height: 1080, fps: null, hasVideo: true, hasAudio: false, size: 0, ...over
})
const clip = (over: Partial<Clip> & { id: string; assetId: string }): Clip => ({
  trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }, ...over
})

/** A 16:9 project with one of each generated card and a real video clip. */
function landscape(): Project {
  return {
    ...emptyProject(),
    settings: { ...emptyProject().settings, width: 1920, height: 1080, fps: 30 },
    assets: [
      asset('video', { kind: 'video', path: '/media/shot.mp4', hasAudio: true, fps: 30 }),
      // The text asset still carries frames from when the caption was animated;
      // it is not any more, and the export must not replay them.
      asset('t', { frames: { pattern: '/edit/t.seq/%05d.png', count: 12 } }),
      asset('s'), asset('ti'), asset('p'), asset('photo', { path: '/media/photo.jpg' }), asset('r')
    ],
    clips: [
      clip({ id: 'shot', assetId: 'video' }),
      clip({ id: 'words', assetId: 't', text: { content: 'Hello', version: 3 } as NonNullable<Clip['text']> }),
      clip({ id: 'card', assetId: 's', solid: { color: '#ff0000', opacity: 1, version: 1 } }),
      clip({ id: 'name', assetId: 'ti', title: { template: '/t/lower.svg', texts: {}, version: 2 } as NonNullable<Clip['title']> }),
      clip({ id: 'news', assetId: 'p', paper: { holdFrames: 10 } as NonNullable<Clip['paper']> }),
      clip({ id: 'ring', assetId: 'r', carousel: { assetIds: ['photo'] } as NonNullable<Clip['carousel']> })
    ]
  }
}

const sizeOf = (calls: Call[], kind: string): { width: number; height: number } => {
  const call = calls.find((c) => c.kind === kind)!
  return { width: call.width, height: call.height }
}

describe('the sizes an export draws its cards at', () => {
  it('draws in the EXPORT’s shape when it differs, though the pixel count is the same', () => {
    // 1920×1080 and 1080×1920 are the same area — which is why an area test missed it.
    const { stills, runs } = exportBakeSizes({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })
    expect(stills).toEqual({ width: 1080, height: 1920 })
    expect(runs).toEqual({ width: 1080, height: 1920 })
  })

  it('draws stills at 4K for a 4K export, and keeps picture runs to the canvas’s pixels', () => {
    const { stills, runs } = exportBakeSizes({ width: 1920, height: 1080 }, { width: 3840, height: 2160 })
    expect(stills).toEqual({ width: 3840, height: 2160 })
    expect(runs).toEqual({ width: 1920, height: 1080 })
  })

  it('draws smaller for a smaller export', () => {
    const { stills, runs } = exportBakeSizes({ width: 1920, height: 1080 }, { width: 1280, height: 720 })
    expect(stills).toEqual({ width: 1280, height: 720 })
    expect(runs).toEqual({ width: 1280, height: 720 })
  })

  it('keeps a portrait 4K run portrait while bringing it down to the canvas’s pixels', () => {
    const { runs } = exportBakeSizes({ width: 1920, height: 1080 }, { width: 2160, height: 3840 })
    expect(runs.height).toBeGreaterThan(runs.width)
    expect(runs.width * runs.height).toBeLessThanOrEqual(1920 * 1080 + 4000)
    expect(runs.width % 2 + (runs.height % 2)).toBe(0)
  })
})

describe('baking for one export', () => {
  it('draws every card at the export’s canvas — a 16:9 edit through the 9:16 preset', async () => {
    const { bakers, calls } = fakeBakers()
    await bakeForExport(landscape(), { width: 1080, height: 1920 }, bakers)
    for (const kind of ['text', 'solid', 'title', 'paper', 'carousel']) {
      expect(sizeOf(calls, kind), kind).toEqual({ width: 1080, height: 1920 })
    }
  })

  it('points the copy at the export’s files, with their real sizes', async () => {
    const { bakers } = fakeBakers()
    const out = await bakeForExport(landscape(), { width: 1080, height: 1920 }, bakers)
    const card = out.assets.find((a) => a.id === 's')!
    expect(card.path).toBe(`/cache/${exportKey('card')}.png`)
    expect({ width: card.width, height: card.height }).toEqual({ width: 1080, height: 1920 })
    const news = out.assets.find((a) => a.id === 'p')!
    expect(news.frames).toEqual({ pattern: `/cache/${exportKey('news')}.seq/%05d.png`, count: 60 })
    // A still caption has no frames — it must not inherit the edit's old ones.
    const words = out.assets.find((a) => a.id === 't')!
    expect(words.frames).toBeUndefined()
  })

  it('never writes to the edit: the project handed in is unchanged, and its files untouched', async () => {
    const { bakers, calls } = fakeBakers()
    const edit = landscape()
    const before = structuredClone(edit)
    await bakeForExport(edit, { width: 1080, height: 1920 }, bakers)
    expect(edit).toEqual(before)
    // Every file drawn is the export's own, never a name the edit points at.
    for (const call of calls) expect(call.key.endsWith('-export'), call.key).toBe(true)
  })

  it('leaves footage alone', async () => {
    const { bakers } = fakeBakers()
    const edit = landscape()
    const out = await bakeForExport(edit, { width: 1080, height: 1920 }, bakers)
    expect(out.assets.find((a) => a.id === 'video')).toBe(edit.assets.find((a) => a.id === 'video'))
    expect(out.clips).toBe(edit.clips)
  })

  it('uses a card’s last picture when it will not redraw, and says so', async () => {
    const { bakers } = fakeBakers([exportKey('card')])
    const heard: string[] = []
    const edit = landscape()
    const out = await bakeForExport(edit, { width: 1080, height: 1920 }, bakers, (c) => heard.push(c.id))
    expect(heard).toEqual(['card'])
    expect(out.assets.find((a) => a.id === 's')).toEqual(edit.assets.find((a) => a.id === 's'))
    // And the rest were still drawn.
    expect(out.assets.find((a) => a.id === 't')!.path).toBe(`/cache/${exportKey('words')}.png`)
  })
})

/* -------------------------------------------------------------- graphics */

/*
 * The graphic's branch (docs/CLIPS.md §6.3, "The export, the store, the
 * preview"): baked at the STILLS' size with the style `graphicStyleOf`
 * resolves, its targets read on the export's canvas at the clip's first
 * frame, the box allowed only at the identity placement, and the export's
 * copy of the asset carrying the box when the bake took it. The drop of a
 * graphic that will not draw is tests/graphicGuards.test.ts's (lane C's half).
 */
describe('a graphic', () => {
  const BOX = { x: 120, y: 1400, width: 840, height: 300 }
  const spec = (over: Partial<GraphicSpec> = {}): GraphicSpec => ({
    data: { template: 'counter', value: '40', label: 'forty' },
    seconds: 2,
    beats: [0.5],
    place: { auto: true, third: 'bottom' },
    // On the shot, in source units: the targets' spec route (graphics/targets.ts).
    subject: { clipId: 'shot', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, ms: 0 },
    seed: 1,
    version: 3,
    ...over
  })
  interface Ask { key: string; width: number; height: number; frames: number; fps: number; boxAllowed: boolean; styleId: string; accent: string; at: (GraphicTargets | null)[] }
  /** Fake bakers recording what the graphic was asked for, answering `give`. */
  const bakers = (give: { pattern: string; frames: number; box?: typeof BOX } | null): { bakers: Bakers; asks: Ask[] } => {
    const asks: Ask[] = []
    const unused = async (): Promise<never> => { throw new Error('not this one') }
    return {
      asks,
      bakers: {
        text: unused, textSequence: async () => null, solid: unused, title: unused, paper: unused, carousel: unused, moment: unused,
        graphic: async (_spec, style, key, width, height, frames, fps, targetsAt, boxAllowed) => {
          asks.push({ key, width, height, frames, fps, boxAllowed, styleId: style.id, accent: style.palette.accent, at: [targetsAt(0), targetsAt(20)] })
          return give
        }
      }
    }
  }
  /** The project's one style, with an override only the project carries: what tells the project's style from a default. */
  const GRAPHICS = { styleId: 'clean', overrides: { 'palette.accent': '#2563EB' }, sound: true }
  /** A 9:16 project: a 1080×1920 shot on v1 (`shotFrames` long), a graphic over it on v2 from frame 30, at the identity unless `over` says otherwise. */
  const edit = (over: Partial<Clip> = {}, shotFrames = 300): Project => ({
    ...emptyProject(),
    settings: { ...emptyProject().settings, width: 1080, height: 1920, fps: 30 },
    graphics: GRAPHICS,
    assets: [
      asset('video', { kind: 'video', path: '/media/shot.mp4', width: 1080, height: 1920, fps: 30, durationFrames: 300 }),
      asset('g', { path: '', width: 1080, height: 1920, durationFrames: 300 })
    ],
    clips: [
      clip({ id: 'shot', assetId: 'video', duration: shotFrames }),
      clip({ id: 'g', assetId: 'g', trackId: 'v2', start: 30, duration: 60, graphic: spec(), keyframes: { opacity: [{ frame: 51, value: 1, ease: 'smooth' }, { frame: 59, value: 0 }] }, ...over })
    ]
  })

  it('is baked at the stills’ size, the export canvas exactly, under <clip>-export, with the project’s style, for the clip’s frames at its rate', async () => {
    const { bakers: b, asks } = bakers({ pattern: '/cache/g-export.seq/%05d.png', frames: 31 })
    await bakeForExport(edit(), { width: 1080, height: 1920 }, b)
    expect(asks).toHaveLength(1)
    // The project's style with its override, as `graphicStyleOf` resolves it (the one call the store and the preview make too).
    expect(asks[0]).toMatchObject({ key: exportKey('g'), width: 1080, height: 1920, frames: 60, fps: 30, boxAllowed: true, styleId: 'clean', accent: '#2563EB' })
    expect(asks[0].accent).toBe(graphicStyleOf({ graphics: GRAPHICS }, spec()).palette.accent)
    // At 4K, the stills' size is the export canvas: 4K lines and type, not 1080's blown up.
    asks.length = 0
    await bakeForExport(edit(), { width: 2160, height: 3840 }, b)
    expect(asks[0]).toMatchObject({ width: 2160, height: 3840 })
  })

  it('hands targets read on the export’s canvas at the stills’ size: the subject the clip’s first frame sees, for every frame of it', async () => {
    const { bakers: b, asks } = bakers(null)
    await bakeForExport(edit(), { width: 1080, height: 1920 }, b)
    // The 0.1/0.2 box of the 1080×1920 shot, on a 1080×1920 frame: x 108, y 384, 216×576 (graphics/targets.ts, the frames' Built note).
    expect(asks[0].at[0]?.subject).toMatchObject({ x: 108, y: 384, width: 216, height: 576 })
    expect(asks[0].at[1]).toEqual(asks[0].at[0])
    // Half the size, half the pixels: the targets are in the STILLS' pixels, not the project's.
    asks.length = 0
    await bakeForExport(edit(), { width: 540, height: 960 }, b)
    expect(asks[0].at[0]?.subject).toMatchObject({ x: 54, y: 192, width: 108, height: 288 })
    // The onset's, though the shot ends under the graphic: frame 20 of the clip is past the shot, and still sees the box.
    asks.length = 0
    await bakeForExport(edit({}, 45), { width: 1080, height: 1920 }, b)
    expect(asks[0].at[0]?.subject).toMatchObject({ x: 108, y: 384, width: 216, height: 576 })
    expect(asks[0].at[1]).toEqual(asks[0].at[0])
  })

  it('allows the box only at the identity placement', async () => {
    const { bakers: b, asks } = bakers(null)
    await bakeForExport(edit({ transform: { x: 0, y: 0, scale: 1, rotation: 10, opacity: 1 } }), { width: 1080, height: 1920 }, b)
    expect(asks[0].boxAllowed).toBe(false)
    asks.length = 0
    await bakeForExport(edit({ keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 30, value: 1.4 }] } }), { width: 1080, height: 1920 }, b)
    expect(asks[0].boxAllowed).toBe(false)
  })

  it('points the copy at the frames: at the box’s size with frames.box when the bake took the box, at the stills’ size without one; never the edit', async () => {
    const boxed = bakers({ pattern: '/cache/g-export.seq/%05d.png', frames: 31, box: BOX })
    const source = edit()
    const out = await bakeForExport(source, { width: 1080, height: 1920 }, boxed.bakers)
    const drawn = out.assets.find((a) => a.id === 'g')!
    expect(drawn.path).toBe('/cache/g-export.seq/00000.png')
    expect({ width: drawn.width, height: drawn.height }).toEqual({ width: 840, height: 300 })
    expect(drawn.frames).toEqual({ pattern: '/cache/g-export.seq/%05d.png', count: 31, box: BOX })
    // Nothing of the box's x and y lands on the asset itself.
    expect('x' in drawn).toBe(false)
    expect(out.clips.map((c) => c.id)).toEqual(['shot', 'g'])
    expect(source.assets.find((a) => a.id === 'g')!.path).toBe('')
    expect(source.assets.find((a) => a.id === 'g')!.frames).toBeUndefined()

    const whole = bakers({ pattern: '/cache/g-export.seq/%05d.png', frames: 31 })
    const canvas = (await bakeForExport(source, { width: 1080, height: 1920 }, whole.bakers)).assets.find((a) => a.id === 'g')!
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 1080, height: 1920 })
    expect(canvas.frames).toEqual({ pattern: '/cache/g-export.seq/%05d.png', count: 31 })
  })
})
