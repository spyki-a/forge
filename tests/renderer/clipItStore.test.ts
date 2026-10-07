import { beforeEach, describe, expect, it } from 'vitest'
import { useEditor } from '../../src/renderer/src/store'
import { clipSourceWindow, clipToRange, clipWords } from '@shared/edit/clipIt'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { PAUSE_BOUNDARY_MS, segmentIntoSentences, type Transcript, type Word } from '@shared/transcript'

/*
 * The store's half of §3b.6 (docs/CLIPS.md §3b.8, beside tests/clipIt.test.ts):
 * Cut to these words (`cutToWords`) and `placeAssetRange`, each ONE undo step
 * — membership of what one undo takes back, not a count of updates. Picking a
 * run is not an edit. The transcript is made up — NATO letters.
 */

const FPS = 30

function asset(patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'talk',
    path: '/media/talk.mp4',
    name: 'talk',
    kind: 'video',
    durationFrames: 120 * FPS,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasVideo: true,
    hasAudio: true,
    size: 1,
    ...patch
  }
}

/** The talk at 4 s on the timeline, at 2× from 15 s of source. */
function project(): Project {
  const base = emptyProject()
  const clip: Clip = {
    id: 'c',
    assetId: 'talk',
    trackId: 'v1',
    start: 120,
    duration: 900,
    inPoint: 450,
    speed: 2,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 }
  }
  return { ...base, settings: { ...base.settings, fps: FPS }, assets: [asset()], clips: [clip] }
}

const theClip = (p: Project): Clip => p.clips.find((c) => c.id === 'c')!

function transcriptOf(spec: [string, number, number][]): Transcript {
  const words: Word[] = spec.map(([text, start, end], i) => ({ index: i, text, startMs: start, endMs: end, confidence: 0.9 }))
  return { assetId: 'talk', language: 'en', model: 'test', durationMs: words[words.length - 1].endMs, words, segments: segmentIntoSentences(words, PAUSE_BOUNDARY_MS) }
}

/** The clip plays 15 s to 75 s: "bravo." to "echo" are its words. */
const TALK = transcriptOf([
  ['alpha.', 14_000, 14_400],
  ['bravo.', 16_000, 16_400],
  ['charlie', 20_000, 20_400],
  ['delta.', 20_600, 21_000],
  ['echo.', 44_500, 44_900],
  ['golf.', 80_000, 80_400]
])

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState())
})

describe('Cut to these words', () => {
  it('trims the picked clip in ONE undo step — picking is none — and one undo puts it back', () => {
    useEditor.setState({ project: { ...project(), transcripts: { talk: TALK } } })
    const before = theClip(useEditor.getState().project)
    const words = clipWords(TALK, clipSourceWindow(before, FPS))!
    expect(words.transcript.words.map((w) => w.text)).toEqual(['bravo.', 'charlie', 'delta.', 'echo.'])
    useEditor.getState().setClipRun('c', words.transcript, { from: 1, to: 2 })
    // Picking is not an edit.
    expect(useEditor.getState().past).toHaveLength(0)

    useEditor.getState().cutToWords()
    const s = useEditor.getState()
    expect(s.past).toHaveLength(1)
    // charlie (20 000) to delta. (21 000): source 600 to 630, at 2× from 450 — 15 frames from clip frame 75.
    expect(theClip(s.project)).toEqual(theClip(clipToRange(s.past[0], 'c', 20_000, 21_000).project))
    expect(theClip(s.project)).toMatchObject({ start: 120, inPoint: 600, duration: 15, speed: 2 })
    expect(s.clipRun).toBeNull()

    useEditor.getState().undo()
    expect(theClip(useEditor.getState().project)).toEqual(before)
  })

  it('does nothing with no run picked', () => {
    useEditor.setState({ project: { ...project(), transcripts: { talk: TALK } } })
    const words = clipWords(TALK, clipSourceWindow(theClip(useEditor.getState().project), FPS))!
    useEditor.getState().setClipRun('c', words.transcript, null)
    useEditor.getState().cutToWords()
    expect(useEditor.getState().past).toHaveLength(0)
  })
})

describe('placeAssetRange', () => {
  it('places the asset cut to the range — its in-point and length set — and one undo takes the clip AND its cut back', () => {
    useEditor.setState({ project: { ...emptyProject(), settings: { ...emptyProject().settings, fps: FPS }, assets: [asset()] } })
    const id = useEditor.getState().placeAssetRange('talk', 20_000, 22_510)
    const s = useEditor.getState()
    const placed = s.project.clips.find((c) => c.id === id)!
    // 20 000 ms is source frame 600; 22 510 ends inside 675, so 676 frames' worth: 76.
    expect(placed).toMatchObject({ assetId: 'talk', start: 0, inPoint: 600, duration: 76 })
    expect(s.past).toHaveLength(1)
    useEditor.getState().undo()
    // Not an uncut clip left behind: no clip of the asset at all.
    expect(useEditor.getState().project.clips.filter((c) => c.assetId === 'talk')).toEqual([])
  })

  it('places nothing for a range wholly outside the asset — not the whole uncut asset, which would look like success', () => {
    useEditor.setState({ project: { ...emptyProject(), settings: { ...emptyProject().settings, fps: FPS }, assets: [asset()] } })
    // The talk is 120 s: a range past its end, as a short download would give.
    expect(useEditor.getState().placeAssetRange('talk', 130_000, 131_000)).toBeNull()
    expect(useEditor.getState().project.clips).toHaveLength(0)
    expect(useEditor.getState().past).toHaveLength(0)
    // One that reaches into it is cut to what it has: its last two seconds.
    const id = useEditor.getState().placeAssetRange('talk', 118_000, 131_000)
    expect(useEditor.getState().project.clips.find((c) => c.id === id)).toMatchObject({ inPoint: 118 * FPS, duration: 2 * FPS })
  })

  it('places nothing for a still, or an asset that is not there', () => {
    useEditor.setState({ project: { ...emptyProject(), assets: [asset({ id: 'still', kind: 'image' })] } })
    expect(useEditor.getState().placeAssetRange('still', 0, 1000)).toBeNull()
    expect(useEditor.getState().placeAssetRange('nope', 0, 1000)).toBeNull()
    expect(useEditor.getState().project.clips).toHaveLength(0)
    expect(useEditor.getState().past).toHaveLength(0)
  })
})
