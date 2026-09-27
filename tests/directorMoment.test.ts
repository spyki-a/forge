import { describe, expect, it } from 'vitest'
import type { MusicAnalysis } from '@shared/automation/cutPlan'
import { MAX_TRACKS, emptyProject, type Clip, type MediaAsset, type Project, type Track } from '@shared/timeline'
import { buildSlots } from '@shared/director/menu'
import { PRODUCT_REVEAL, type Recipe } from '@shared/director/recipes'
import { rhythmGrid, type MomentEvent } from '@shared/director/rhythm'
import type { Menu2 } from '@shared/director/schema2'
import { validateSpine2 } from '@shared/director/validate2'
import { baselineSpine2 } from '@shared/director/baseline2'
import { composeAd, type Composed } from '@shared/director/compose'
import { applyRecipe, momentSeed, type Applied2 } from '@shared/director/apply2'
import { COPY_RULE, LOOK_RULE, MOMENT_RULE, SPINE_RULE, clearDirector } from '@shared/director/apply'
import { MOMENT_SECONDS, bridgesCut, momentSpan, movingFrames } from '@shared/render/moment'
import type { Brief } from '@shared/director/schema'

/*
 * The moments the rhythm engine places, as clips (docs/PLAN.md §7): on the
 * lane above the shots, under the look and under the cards, spanning the cut
 * as `momentSpan` says, from the two shots' clips, seeded by where they are —
 * and gone with the ad. Over stills only for now; footage says so. And the
 * engine's side: a depth push owns its whole shot, so nothing is placed over
 * it or blended out of it.
 */

const fps = 30
const brief: Brief = { product: 'Aura serum', benefit: 'glow', audience: '', tone: 'premium', cta: 'Shop now', seconds: 20, language: 'English' }

function song(bpm: number, seconds: number, sections: number[] = []): MusicAnalysis {
  const beatMs = 60_000 / bpm
  const beats: number[] = []
  for (let t = 0; t <= seconds * 1000; t += beatMs) beats.push(Math.round(t))
  return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), tiers: beats.map(() => 2), drops: [], buildups: [], sections, durationMs: seconds * 1000 }
}

const photo = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => ({ id, path: `/media/${id}.jpg`, name: `${id}.jpg`, kind: 'image', durationFrames: 150, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false, size: 100, ...over })

/** Four photos and a song. */
function edit(assets: MediaAsset[] = [photo('p1'), photo('p2'), photo('p3'), photo('p4')]): Project {
  const music: Clip = {
    id: 'music', assetId: 'song', trackId: 'a1', start: 0, duration: 20 * fps, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  const empty = emptyProject()
  return {
    ...empty,
    settings: { ...empty.settings, width: 1080, height: 1920, fps },
    assets: [...assets, { ...photo('song'), name: 'song.m4a', kind: 'audio', width: null, height: null, hasVideo: false, hasAudio: true, durationFrames: 20 * fps }],
    clips: [music]
  }
}

function compose(p: Project, sections: number[] = [], heroIndex = 2, recipe: Recipe = PRODUCT_REVEAL): { composed: Composed; menu: Menu2 } {
  const slots = buildSlots(p)
  // The hero is the third picture (unless said otherwise), so the hero reveal is a cut with a shot before it.
  const heroes = [slots[heroIndex].id, ...slots.filter((_, i) => i !== heroIndex).map((s) => s.id)]
  const menu: Menu2 = { slots, recipes: [PRODUCT_REVEAL], fallback: PRODUCT_REVEAL, heroCandidates: heroes, fps, seconds: 20, bpm: 100, holds: { min: 4, max: 8 }, drops: [] }
  const checked = validateSpine2(baselineSpine2(brief, menu, PRODUCT_REVEAL), menu)
  if ('rejected' in checked) throw new Error(checked.rejected)
  const grid = rhythmGrid(song(100, 20, sections), { fps, seconds: 20, tempo: PRODUCT_REVEAL.tempo })
  return { composed: composeAd(checked.plan, recipe, menu, grid), menu }
}

function direct(p: Project, composed: Composed, menu: Menu2, lookFile: { file: string; name: string } | null = null, catalogue: { id: string; family: string }[] = []): Applied2 {
  let n = 0
  return applyRecipe(p, composed, menu, {
    fps, videoTrackId: 'v1', brief, model: 'baseline', catalogue, musicClipId: 'music', lookFile, newId: (x) => `${x}-${++n}`
  })
}

const momentsOf = (p: Project): Clip[] => p.clips.filter((c) => c.generatedBy?.rule === MOMENT_RULE)
const shotsOf = (p: Project): Clip[] => p.clips.filter((c) => c.generatedBy?.rule === SPINE_RULE)
const laneIndex = (p: Project, trackId: string): number => p.tracks.filter((t) => t.kind === 'video').findIndex((t) => t.id === trackId)
const withMoments = (composed: Composed, moments: MomentEvent[]): Composed => ({ ...composed, layout: { ...composed.layout, moments } })

describe('a product reveal, with its moments', () => {
  const p = edit()
  const { composed, menu } = compose(p)
  const applied = direct(p, composed, menu, { file: '/looks/soft.cube', name: 'Soft' })
  const project = applied.project
  const placed = momentsOf(project)

  it('the engine fired the recipe’s first moment on the hero reveal, and it landed as a clip', () => {
    expect(composed.layout.moments.length).toBeGreaterThan(0)
    expect(composed.layout.moments[0]).toMatchObject({ moment: PRODUCT_REVEAL.moments.kinds[0], place: 'hero-reveal' })
    expect(placed.length).toBe(composed.layout.moments.length)
    expect(applied.momentClipIds.sort()).toEqual(placed.map((c) => c.id).sort())
  })

  it('each spans its cut as momentSpan says, from the two shots’ clips, on the lane above the shots and under the look', () => {
    const shots = shotsOf(project)
    composed.layout.moments.forEach((event, index) => {
      const clip = placed.find((c) => c.moment?.seed === momentSeed(event.frame, index))!
      expect(clip, `moment ${index}`).toBeDefined()
      const to = shots.find((s) => s.start === event.frame)!
      const from = shots.find((s) => s.start + s.duration === event.frame)!
      expect(clip.moment).toEqual({
        kind: event.moment,
        from: { clipId: from.id },
        to: { clipId: to.id },
        seconds: MOMENT_SECONDS[event.moment].default,
        intensity: composed.intensity ?? composed.recipe.intensity,
        seed: momentSeed(event.frame, index),
        version: 1
      })
      const span = momentSpan(clip.moment!, fps)
      expect(clip.start).toBe(event.frame - span.before)
      expect(clip.duration).toBe(span.total)
      expect(clip.inPoint).toBe(0)
      // Its lane: above V1, below the look.
      expect(clip.trackId).not.toBe('v1')
      expect(laneIndex(project, clip.trackId)).toBeGreaterThan(laneIndex(project, 'v1'))
      const look = project.clips.find((c) => c.generatedBy?.rule === LOOK_RULE)!
      expect(laneIndex(project, look.trackId)).toBeGreaterThan(laneIndex(project, clip.trackId))
      // Its picture is the app's to draw: an empty, frame-sized asset.
      const asset = project.assets.find((a) => a.id === clip.assetId)!
      expect(asset.path).toBe('')
      expect(asset.size).toBe(0)
      expect(asset.width).toBe(1080)
      expect(asset.height).toBe(1920)
      const title = event.moment.replace('-', ' ')
      expect(asset.name).toBe(title[0].toUpperCase() + title.slice(1))
      expect(clip.generatedBy!.reason).toContain(event.moment)
      expect(clip.generatedBy!.reason).toContain(event.place.replace('-', ' '))
    })
  })

  it('every headline card sits above the look and above every moment — the type is not graded, and never under a moment', () => {
    const cards = project.clips.filter((c) => c.generatedBy?.rule === COPY_RULE)
    const look = project.clips.find((c) => c.generatedBy?.rule === LOOK_RULE)!
    expect(cards.length).toBeGreaterThan(1)
    // The hook card does not overlap the moment: the lane under the look would be free for it, and is not taken.
    for (const card of cards) {
      expect(laneIndex(project, card.trackId), card.generatedBy!.reason).toBeGreaterThan(laneIndex(project, look.trackId))
      for (const m of placed) expect(laneIndex(project, card.trackId), card.generatedBy!.reason).toBeGreaterThan(laneIndex(project, m.trackId))
    }
  })

  it('the seed is where the moment is: the same layout gives the same seed, another cut another', () => {
    expect(momentSeed(120, 0)).toBe(momentSeed(120, 0))
    expect(momentSeed(120, 0)).not.toBe(momentSeed(121, 0))
    expect(momentSeed(120, 0)).not.toBe(momentSeed(120, 1))
    expect(Number.isInteger(momentSeed(120, 0))).toBe(true)
  })

  it('clearing the ad takes the moments and their assets with it', () => {
    const cleared = clearDirector(project)
    expect(momentsOf(cleared)).toHaveLength(0)
    for (const c of placed) expect(cleared.assets.find((a) => a.id === c.assetId)).toBeUndefined()
    expect(clearDirector(cleared)).toBe(cleared)
  })
})

describe('what the engine asks for that cannot land', () => {
  it('a depth push covers its whole shot — the push eases over its two seconds and holds — and a shot shorter than the push says so', () => {
    const p = edit()
    const { composed, menu } = compose(p)
    const shot = composed.layout.shots[1]
    const event: MomentEvent = { kind: 'moment', moment: 'depth-push', frame: shot.startFrame, from: composed.layout.shots[0].slotId, to: shot.slotId, place: 'section' }
    const applied = direct(p, withMoments(composed, [event]), menu)
    const [clip] = momentsOf(applied.project)
    expect(clip.moment!.from).toBeUndefined()
    expect(clip.start).toBe(shot.startFrame)
    expect(clip.duration).toBe(shot.clipFrames)
    expect(clip.moment!.seconds).toBe(MOMENT_SECONDS['depth-push'].default)
    expect(movingFrames(clip.moment!, fps, clip.duration)).toBe(Math.min(shot.clipFrames, Math.round(MOMENT_SECONDS['depth-push'].default * fps)))
    expect(applied.problems.some((q) => q.message.includes('shorter than the recipe'))).toBe(shot.clipFrames < momentSpan(clip.moment!, fps).total)

    // The same push into a shot with a second of footage: the clip is that second, and the note says so.
    const short = { ...composed, layout: { ...composed.layout, shots: composed.layout.shots.map((s) => (s === shot ? { ...s, clipFrames: fps } : s)) } }
    const squeezed = direct(p, withMoments(short, [event]), menu)
    const [small] = momentsOf(squeezed.project)
    expect(small.duration).toBe(fps)
    expect(squeezed.problems.some((q) => q.message.includes('shorter than the recipe') && q.message.includes('1.0s'))).toBe(true)
  })

  it('a bridge shrinks to a short outgoing shot — it never starts before that shot does — and says so', () => {
    const p = edit()
    const { composed, menu } = compose(p)
    const shot = composed.layout.shots[2]
    const before = composed.layout.shots[1]
    // Four frames of the outgoing shot: a zoom punch's six frames before the cut do not fit.
    const short: Composed = withMoments(
      { ...composed, layout: { ...composed.layout, shots: composed.layout.shots.map((s) => (s === before ? { ...s, startFrame: s.endFrame - 4, clipFrames: 4 } : s)) } },
      [{ kind: 'moment', moment: 'zoom-punch', frame: shot.startFrame, from: before.slotId, to: shot.slotId, place: 'climax' }]
    )
    const applied = direct(p, withMoments(short, short.layout.moments), menu)
    const [clip] = momentsOf(applied.project)
    expect(clip).toBeDefined()
    expect(clip.start).toBe(shot.startFrame - 4)
    expect(clip.duration).toBe(4 + 6)
    expect(applied.problems.some((q) => q.message.includes('shorter than the recipe'))).toBe(true)
  })

  it('over footage — the shot it lands on OR the shot it comes from — the cut is plain, and says so; an undrawn kind likewise', () => {
    const footage = (id: string): MediaAsset => ({ ...photo(id), path: `/media/${id}.mp4`, name: `${id}.mp4`, kind: 'video', fps: 30, durationFrames: 600, hasAudio: false })
    // The hero (the third slot) is the footage: the hero reveal's moment lands on it.
    const onto = edit([photo('p1'), photo('p2'), footage('v'), photo('p4')])
    const { composed, menu } = compose(onto)
    const applied = direct(onto, composed, menu)
    expect(momentsOf(applied.project)).toHaveLength(0)
    expect(applied.problems.some((q) => q.message.includes('over footage is not drawn yet'))).toBe(true)

    // The shot BEFORE the hero is the footage: the moment would come from it.
    const outOf = edit([photo('p1'), footage('v'), photo('p3'), photo('p4')])
    const from = compose(outOf)
    const fromApplied = direct(outOf, from.composed, from.menu)
    expect(from.composed.layout.moments[0]?.from).toBe(from.menu.slots[1].id)
    expect(momentsOf(fromApplied.project)).toHaveLength(0)
    expect(fromApplied.problems.some((q) => q.message.includes('over footage is not drawn yet'))).toBe(true)

    const stills = edit()
    const still = compose(stills)
    const shot = still.composed.layout.shots[2]
    const kinetic = direct(stills, withMoments(still.composed, [{ kind: 'moment', moment: 'kinetic-type', frame: shot.startFrame, from: still.composed.layout.shots[1].slotId, to: shot.slotId, place: 'climax' }]), still.menu)
    expect(momentsOf(kinetic.project)).toHaveLength(0)
    expect(kinetic.problems.some((q) => q.message.includes('"kinetic-type" moment is not drawn yet'))).toBe(true)
  })

  it('a moment whose shots do not meet — the one before ends early — has no cut to bridge', () => {
    const p = edit()
    const { composed, menu } = compose(p)
    const shot = composed.layout.shots[2]
    const before = composed.layout.shots[1]
    const short: Composed = withMoments(
      { ...composed, layout: { ...composed.layout, shots: composed.layout.shots.map((s) => (s === before ? { ...s, clipFrames: s.clipFrames - 10 } : s)) } },
      [{ kind: 'moment', moment: 'zoom-punch', frame: shot.startFrame, from: before.slotId, to: shot.slotId, place: 'climax' }]
    )
    const applied = direct(p, short, menu)
    expect(momentsOf(applied.project)).toHaveLength(0)
    expect(applied.problems.some((q) => q.message.includes('no cut to bridge'))).toBe(true)
  })

  it('a whip between a picture shown whole and one that fills the frame is a cut, as a blend there is; a zoom punch is allowed', () => {
    // A square hero in a 9:16 ad keeps 56 % under the frame's crop: shown whole over its backdrop.
    const p = edit([photo('p1'), photo('p2'), photo('sq', { width: 1080, height: 1080 }), photo('p4')])
    const { composed, menu } = compose(p)
    const hero = composed.layout.shots[2]
    const before = composed.layout.shots[1]
    const whip = direct(p, withMoments(composed, [{ kind: 'moment', moment: 'whip-blur', frame: hero.startFrame, from: before.slotId, to: hero.slotId, place: 'drop' }]), menu)
    expect(momentsOf(whip.project)).toHaveLength(0)
    expect(whip.problems.some((q) => q.message.includes('a whip between a picture shown whole and one that fills the frame'))).toBe(true)
    const zoom = direct(p, withMoments(composed, [{ kind: 'moment', moment: 'zoom-punch', frame: hero.startFrame, from: before.slotId, to: hero.slotId, place: 'drop' }]), menu)
    expect(momentsOf(zoom.project)).toHaveLength(1)
  })

  it('a second moment over frames the first already covers is a cut with a note — the net under the engine', () => {
    const p = edit()
    const { composed, menu } = compose(p)
    const pushed = composed.layout.shots[1]
    const next = composed.layout.shots[2]
    const applied = direct(
      p,
      withMoments(composed, [
        { kind: 'moment', moment: 'depth-push', frame: pushed.startFrame, from: composed.layout.shots[0].slotId, to: pushed.slotId, place: 'section' },
        { kind: 'moment', moment: 'zoom-punch', frame: next.startFrame, from: pushed.slotId, to: next.slotId, place: 'climax' }
      ]),
      menu
    )
    const placed = momentsOf(applied.project)
    expect(placed).toHaveLength(1)
    expect(placed[0].moment!.kind).toBe('depth-push')
    expect(applied.problems.some((q) => q.message.includes('would sit over the depth-push'))).toBe(true)
  })

  it('with every lane taken and no room for another, the moment is dropped with a note', () => {
    const p = edit()
    const locked = (i: number): Track => ({ id: `x${i}`, kind: 'video', name: `X${i}`, muted: false, hidden: false, locked: true })
    const videos = p.tracks.filter((t) => t.kind === 'video').map((t) => (t.id === 'v1' ? t : { ...t, locked: true }))
    const audios = p.tracks.filter((t) => t.kind !== 'video')
    const full: Project = { ...p, tracks: [...videos, ...Array.from({ length: MAX_TRACKS - videos.length - audios.length }, (_, i) => locked(i)), ...audios] }
    expect(full.tracks).toHaveLength(MAX_TRACKS)
    const { composed, menu } = compose(full)
    expect(composed.layout.moments.length).toBeGreaterThan(0)
    const applied = direct(full, composed, menu)
    expect(momentsOf(applied.project)).toHaveLength(0)
    expect(applied.problems.some((q) => q.message.includes('no free layer for the') && q.message.includes('dropped'))).toBe(true)
  })
})

describe('the engine keeps a depth push’s shot to itself', () => {
  /*
   * Sections every two seconds, so nearly every cut is one, and the hero
   * the FOURTH picture: the recipe's first moment (a bridge) goes on the
   * hero's cut, and its second — a depth push at a section — would, by the
   * cut alone, fit on the shot right before the hero, whose end IS the
   * bridge's cut. The push's whole shot has to keep its distance, not its
   * first frame.
   */
  const p = edit([photo('p1'), photo('p2'), photo('p3'), photo('p4'), photo('p5'), photo('p6'), photo('p7')])
  const { composed } = compose(p, [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000], 3)
  const { layout } = composed
  const pushes = layout.moments.filter((m) => !bridgesCut(m.moment))
  const bar = Math.round((60 / 100) * fps) * 4

  it('fires a bridge and a push — the fixture is only a fixture if it does', () => {
    expect(layout.moments.some((m) => bridgesCut(m.moment))).toBe(true)
    expect(pushes.length).toBeGreaterThan(0)
  })

  it('even with a blend wanted on every cut, none leaves or enters a pushed shot', () => {
    // stillsShare 1: the engine asks for a transition on every boundary it may use — so the ones it may not are the test.
    const eager = compose(p, [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000], 3, { ...PRODUCT_REVEAL, transitions: { ...PRODUCT_REVEAL.transitions, stillsShare: 1 } }).composed.layout
    const eagerPushes = eager.moments.filter((m) => !bridgesCut(m.moment))
    expect(eagerPushes.length).toBeGreaterThan(0)
    expect(eager.transitions.length).toBeGreaterThan(0)
    for (const push of eagerPushes) {
      const shotIndex = eager.shots.findIndex((s) => s.startFrame === push.frame)
      expect(eager.transitions.some((t) => t.shot === shotIndex + 1), 'a blend out of the pushed shot').toBe(false)
      expect(eager.transitions.some((t) => t.shot === shotIndex), 'a blend into the pushed shot').toBe(false)
      // The boundary after the pushed shot is a real one that a blend could otherwise have taken.
      expect(shotIndex + 1).toBeLessThan(eager.shots.length)
    }
  })

  it('no transition leaves or enters a pushed shot, and no other moment comes within a bar of the shot it covers', () => {
    for (const push of pushes) {
      const shotIndex = layout.shots.findIndex((s) => s.startFrame === push.frame)
      expect(shotIndex).toBeGreaterThan(0)
      const shot = layout.shots[shotIndex]
      expect(layout.transitions.some((t) => t.shot === shotIndex + 1), 'a blend out of the pushed shot').toBe(false)
      expect(layout.transitions.some((t) => t.shot === shotIndex), 'a blend into the pushed shot').toBe(false)
      for (const other of layout.moments) {
        if (other === push) continue
        expect(other.frame + bar <= push.frame || other.frame >= shot.endFrame + bar, `${other.moment} at ${other.frame} against a push over ${push.frame}–${shot.endFrame}`).toBe(true)
      }
    }
  })
})
