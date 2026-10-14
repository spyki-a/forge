import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REFRAME_FAILURES,
  REFRAME_STAGES,
  isReframeFailure,
  reframeHelperFrom,
  reframeJobLabel,
  stageProgress,
  subjectTrackFileName,
  type ReframeStage
} from '@shared/reframe/job'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'

/*
 * The pure half of the reframe job's contract (shared/reframe/job.ts,
 * docs/CLIPS.md §4.7): the track's file name, the bar's stages, the typed
 * failures and the helper's state.
 */

describe('subjectTrackFileName', () => {
  it('turns the file key’s colon into a name Windows accepts', () => {
    expect(subjectTrackFileName('1083786:1728000000123', 1)).toBe('1083786-1728000000123-v1.json')
  })

  it('leaves no character Windows refuses, and no trailing dot, whatever the key holds', () => {
    // Asserted on the name itself — the basename — never on a path, whose drive letter has a colon (CLAUDE.md).
    const name = basename(subjectTrackFileName('a<b>c:d"e/f\\g|h?i*j. ', 3))
    expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/)
    expect(name).not.toMatch(/[. ]$/)
    expect(name.endsWith('-v3.json')).toBe(true)
  })

  it('is never a reserved device name', () => {
    expect(subjectTrackFileName('CON', 1)).toBe('CON-v1.json')
  })

  it('refuses a missing key or version rather than writing a nameless file', () => {
    expect(() => subjectTrackFileName('', 1)).toThrow()
    expect(() => subjectTrackFileName('1:2', 0)).toThrow()
  })
})

describe('the stages', () => {
  it('cover the bar end to end, in order, with no gap', () => {
    const order: ReframeStage[] = ['shots', 'faces', 'reduce']
    expect(Object.keys(REFRAME_STAGES)).toEqual(order)
    expect(REFRAME_STAGES.shots.from).toBe(0)
    expect(REFRAME_STAGES.reduce.to).toBe(1)
    for (let i = 1; i < order.length; i++) expect(REFRAME_STAGES[order[i]].from).toBe(REFRAME_STAGES[order[i - 1]].to)
  })

  it('places a stage’s own progress inside its range, clamped', () => {
    expect(stageProgress('faces', 0)).toBeCloseTo(0.15, 10)
    expect(stageProgress('faces', 0.5)).toBeCloseTo(0.5, 10)
    expect(stageProgress('faces', 1)).toBeCloseTo(0.85, 10)
    expect(stageProgress('reduce', 7)).toBe(1)
    expect(stageProgress('shots', Number.NaN)).toBe(0)
  })
})

describe('failures', () => {
  it('every reason has words, and only those are reasons', () => {
    for (const reason of ['no-helper', 'model-missing', 'phrase-needs-ground', 'size-mismatch', 'cancelled', 'failed']) {
      expect(isReframeFailure(reason)).toBe(true)
      expect(REFRAME_FAILURES[reason as keyof typeof REFRAME_FAILURES].length).toBeGreaterThan(0)
    }
    expect(isReframeFailure('toString')).toBe(false)
    expect(isReframeFailure('salient')).toBe(false)
  })

  it('never calls the helper anything but the AI helper on screen', () => {
    for (const words of Object.values(REFRAME_FAILURES)) expect(words.toLowerCase()).not.toContain('sidecar')
  })
})

describe('reframeHelperFrom', () => {
  const hello = (capabilities: string[], degraded: Record<string, string> = {}): HelloResult => ({
    protocolVersion: 1,
    python: '3.12',
    platform: 'darwin',
    capabilities,
    degraded
  })

  it('is ready only when both the face finder and its model method registered', () => {
    expect(reframeHelperFrom({ state: 'ready', hello: hello([SIDECAR_METHODS.faces, SIDECAR_METHODS.facesModel]) })).toBe('ready')
    expect(reframeHelperFrom({ state: 'ready', hello: hello([SIDECAR_METHODS.faces]) })).toBe('missing')
    expect(
      reframeHelperFrom({
        state: 'ready',
        hello: hello([SIDECAR_METHODS.facesModel], { [SIDECAR_METHODS.faces]: 'No module named mediapipe' })
      })
    ).toBe('missing')
  })

  it('is missing when the helper failed to start, and unknown while it starts', () => {
    expect(reframeHelperFrom({ state: 'failed', error: 'The AI helper stopped (code 9009)' })).toBe('missing')
    expect(reframeHelperFrom({ state: 'starting' })).toBe('unknown')
  })
})

describe('the job row', () => {
  it('names the file after the title', () => {
    expect(reframeJobLabel({ inputName: 'Toast.mp4' })).toBe('Finding the subject · Toast.mp4')
  })
})

/* ------------------------------------------------------------ a quit */

const source = (file: string): string => readFileSync(resolve(__dirname, '..', file), 'utf8')

/** The `{…}` block that follows `anchor`, which must occur exactly once (CLAUDE.md: count the anchor's matches). */
function blockAfter(text: string, anchor: string): string {
  expect(text.split(anchor).length - 1, `anchor "${anchor}"`).toBe(1)
  const from = text.indexOf(anchor)
  let depth = 0
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) return text.slice(from, i + 1)
  }
  throw new Error(`unbalanced block after "${anchor}"`)
}

describe('a quit', () => {
  it('cancels every analysis: before-quit calls cancelAnalyses, which cancels the queue registerIpc made', () => {
    // Main's scene pass is its own ffmpeg; left alone it read the rest of its file after the app had gone.
    const quit = blockAfter(source('src/main/index.ts'), "app.on('before-quit', (event) =>")
    expect(quit).toContain('cancelAnalyses()')
    // After the close guard's early return, beside the helper's stop and the link runs' abort.
    expect(quit.indexOf('cancelAnalyses()')).toBeGreaterThan(quit.indexOf('return'))
    const ipc = source('src/main/ipc.ts')
    expect(blockAfter(ipc, 'export function cancelAnalyses(): void')).toContain('analyses?.queue.cancelAll()')
    // The queue it cancels is the one registerIpc lists and broadcasts: assigned once, right after it is made.
    expect([...ipc.matchAll(/^\s*analyses = reframe$/gm)]).toHaveLength(1)
    const made = ipc.indexOf('const reframe = createReframeJobs(')
    expect(made).toBeGreaterThan(-1)
    expect(ipc.indexOf('analyses = reframe', made)).toBeGreaterThan(made)
  })
})
