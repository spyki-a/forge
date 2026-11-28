import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type Project } from '@shared/timeline'
import type { GraphicSpec } from '@shared/graphics/template'
import { footageOf } from '@shared/graphics/sound'
import { wordsClipOf } from '@shared/wordsClip'

/*
 * Whose words the Transcript tab and tile show for a selection
 * (shared/wordsClip.ts): a footage clip's own, and for a selected GRAPHIC the
 * footage clip it shows over — the user's "yes please" of 2026-11-27, asked
 * whether a graphic, selected to change it the moment Find graphics placed it,
 * should keep the video's words on screen instead of "No transcript yet".
 *
 * Plain clips on the empty project's own tracks (v1 under v2), no store.
 */

const BASE = {
  speed: 1,
  volume: 1,
  inPoint: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  color: { brightness: 0, contrast: 1, saturation: 1 }
}

const SPEC: GraphicSpec = {
  data: { template: 'lower-third', name: 'A Speaker', role: '' },
  seconds: 3,
  beats: [0.5],
  place: { auto: true, third: 'bottom' },
  seed: 1,
  version: 1
}

const talk: Clip = { ...BASE, id: 'talk', assetId: 'talk-asset', trackId: 'v1', start: 100, duration: 600 }
const other: Clip = { ...BASE, id: 'other', assetId: 'other-asset', trackId: 'v1', start: 900, duration: 300 }
const overTalk: Clip = { ...BASE, id: 'g-talk', assetId: '', trackId: 'v2', start: 250, duration: 90, graphic: SPEC }
const overOther: Clip = { ...BASE, id: 'g-other', assetId: '', trackId: 'v2', start: 950, duration: 90, graphic: SPEC }
const overNothing: Clip = { ...BASE, id: 'g-none', assetId: '', trackId: 'v2', start: 2000, duration: 90, graphic: SPEC }
const title: Clip = { ...BASE, id: 'title', assetId: '', trackId: 'v2', start: 400, duration: 60, text: { content: 'A title' } as Clip['text'] }

const project = (): Project => ({ ...emptyProject(), clips: [talk, other, overTalk, overOther, overNothing, title] })

describe('whose words a selection shows', () => {
  it('a footage clip is its own', () => {
    expect(wordsClipOf(project(), 'talk')?.id).toBe('talk')
    expect(wordsClipOf(project(), 'other')?.id).toBe('other')
  })

  it('a graphic is the footage clip it shows over — each graphic its own, not the first footage clip there is', () => {
    const p = project()
    // The fixture is what it claims: these two graphics do sit over those two clips.
    expect(footageOf(p, overTalk, SPEC)).toBe('talk')
    expect(footageOf(p, overOther, SPEC)).toBe('other')
    expect(wordsClipOf(p, 'g-talk')?.id).toBe('talk')
    expect(wordsClipOf(p, 'g-other')?.id).toBe('other')
  })

  it('a graphic drawn over another graphic reaches the footage under both: what draws itself is never the footage', () => {
    // A third video track above v2, and on it a graphic inside g-talk's span.
    const base = project()
    const p: Project = {
      ...base,
      tracks: [...base.tracks, { id: 'v3', kind: 'video', name: 'V3', muted: false, hidden: false, locked: false }],
      clips: [...base.clips, { ...overTalk, id: 'g-top', trackId: 'v3', start: 260 }]
    }
    expect(wordsClipOf(p, 'g-top')?.id).toBe('talk')
  })

  it('a graphic with no footage clip under its first frame stays itself', () => {
    const p = project()
    expect(footageOf(p, overNothing, SPEC)).toBeNull()
    expect(wordsClipOf(p, 'g-none')?.id).toBe('g-none')
  })

  it('a title over footage stays itself: only a graphic was asked about', () => {
    expect(wordsClipOf(project(), 'title')?.id).toBe('title')
  })

  it('nothing selected, or a selection that outlived its clip, is no clip', () => {
    expect(wordsClipOf(project(), null)).toBeNull()
    expect(wordsClipOf(project(), 'gone')).toBeNull()
  })

  it('returns the project’s own clip object, never a copy', () => {
    const p = project()
    expect(wordsClipOf(p, 'g-talk')).toBe(p.clips[0])
  })
})
