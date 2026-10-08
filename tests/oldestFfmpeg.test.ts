import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildRenderPlan, videoInputArgs, type RenderRequest } from '@shared/render/plan'
import { filterGraphOf, withGraphFile } from '@shared/render/graphFile'
import { keyProbeArgs } from '@shared/render/chromaKey'
import { ENCODERS, probeArgs } from '@shared/render/encode'
import { momentFrameArgs } from '@shared/render/momentFrames'
import { steadyDetectFilter } from '@shared/render/steady'
import { voiceOverArgs } from '@shared/render/voiceover'
import { PRESETS, defaultParams } from '@shared/presets'
import { emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'

/*
 * Nothing in a filter graph may be newer than the OLDEST bundled ffmpeg.
 *
 * `@ffmpeg-installer` ships a different build per platform, and the Windows one
 * is not a release at all. `@ffmpeg-installer/win32-x64@4.1.0` declares
 * `"ffmpeg": "20181217-f22fcd4"` — a static nightly of ffmpeg MASTER taken on
 * **17 December 2018**, a week after the 4.1 branch point. (macOS arm64 is
 * `92718-g092cb17983`, which reports itself as 4.4.)
 *
 * So the real floor is a DATE, not a version: whatever was merged to master by
 * 2018-12-17. That distinction is not pedantry, and `tpad` is the proof —
 * it first appears in the 4.2 release, so "added in 4.2" says it cannot be
 * used, but it was merged on 30 October 2018 and is therefore present in the
 * Windows build. `holdFilter` has emitted it all along and Windows CI renders
 * fine. Judging by release number alone would have sent us rewriting working
 * code.
 *
 * It nearly did. `amix`'s `weights` was blocked here as "4.2 — no pre-4.2
 * equivalent", and both halves were wrong: the Windows build lists it
 * (`weights <string> ... (default "1 1")`) and renders it at equal and unequal
 * weights, and it IS the pre-4.2 equivalent the note said did not exist. It was
 * blocked by reading a release number; it was unblocked by running the binary.
 * If you reach for it to mix at unequal levels, it works — measure before
 * adding it back here.
 *
 * The rule that actually holds: an option works on Windows if it was MERGED
 * before 2018-12-17, whatever release first carried it. Three have not been:
 *
 *     anullsrc  d=          4.2   every render died before a frame
 *     adelay    all=        4.2   and the naive fix was worse than the bug
 *     amix      normalize=  4.2   and the forum workaround is 6dB hot
 *
 * Each was found by a Windows CI run, which is a slow and expensive way to
 * learn it. This test fails on a Mac instead. It is a blocklist, so it cannot
 * catch something nobody has thought of — but each entry is a thing that has
 * either bitten us or is one autocomplete away from it, and the version beside
 * it is why. The real rule is in docs/EFFECTS.md §25.
 *
 * If ffmpeg is ever unified across platforms, delete this file rather than
 * maintaining it — the whole class of bug goes with it.
 */

/** Option or filter, the release it first shipped in, and what to use instead. */
const TOO_NEW: { pattern: RegExp; since: string; why: string }[] = [
  { pattern: /\bnormalize=/, since: '4.2', why: 'amix — pad the inputs and scale by N instead' },
  { pattern: /anullsrc[^;,]*\bd(uration)?=/, since: '4.2', why: 'bound the stream with -t' },
  { pattern: /\badelay=[^;,]*\ball=/, since: '4.2', why: 'repeat the delay once per channel' },
  { pattern: /\b(pad_dur|whole_dur)=/, since: '4.2', why: 'apad — follow it with atrim=end=' },
  { pattern: /\bxfade\b/, since: '4.3', why: 'the transition registry builds these by hand' },
  { pattern: /\bspeechnorm\b/, since: '4.3', why: 'dynaudnorm is the old one' },
  { pattern: /\b(colorize|exposure|dblur|shufflepixels|thistogram)\b/, since: '4.3', why: 'no' },
  { pattern: /\b(colorcorrect|colorcontrast|monochrome|estdif|adenorm)\b/, since: '4.4', why: 'no' },
  /*
   * Temperature and tint are the obvious reach for a white-balance slider,
   * and the macOS build HAS `colortemperature` — measured 2026-09-22 — which
   * is exactly how it would ship broken. It merged in January 2021. The
   * same slider is a 3×3 matrix on `colorchannelmixer` (2013), and the
   * preview's WebGL grade can apply the identical matrix. docs/FIX.md B3.
   */
  { pattern: /\bcolortemperature\b/, since: '4.4', why: 'colorchannelmixer with a temperature/tint matrix' },
  { pattern: /\b(asupercut|asubcut|asuperpass|asuperstop)\b/, since: '4.4', why: 'highpass/lowpass' },
  /*
   * `afade` itself is from 2013 and is safe. Its CURVE list is not uniformly
   * safe, and it is an unusually easy thing to reach for: the names sit in one
   * dropdown-looking list in `-h filter=afade`, and nothing about `losi`
   * announces that it is fifteen years newer than `tri`.
   *
   * The list is an append-only enum, so the index IS the age ordering. The
   * curves we use are `tri` (0) and `qsin` (1) — both from the filter's first
   * commit. These four are the top of the list on the 4.4 build here and are
   * not verified against the 2018-12-17 Windows snapshot; `sinc`/`isinc` are
   * plainly newer than it. If one of them is genuinely wanted, run it on
   * Windows CI first and move it out of this list with the measurement.
   */
  {
    pattern: /curve=(losi|nofade|sinc|isinc)\b/,
    since: 'unverified on the 2018 build',
    why: 'afade — tri and qsin are curve 0 and 1, from the original commit'
  },
  /*
   * Scene detection is the obvious reach for step 1's shot pass
   * (docs/CLIPS.md §4.2), and the macOS build HAS it — it ran, giving
   * `lavfi.scd.score: 15.625` — which is how it would ship broken, the
   * `colortemperature` story again. It merged 2020-05-14 and is in 4.3's
   * Changelog ("scdet filter", read at n4.3). `select`'s `scene` score
   * (2012) is the old way to the same number.
   */
  { pattern: /\bscdet\b/, since: '4.3', why: "select='gt(scene,…)' with showinfo, or the scene score from metadata" }
]

const W = 640
const H = 360

function asset(id: string): MediaAsset {
  return {
    id, path: `/tmp/${id}.mp4`, name: `${id}.mp4`, kind: 'video',
    durationFrames: 300, width: W, height: H, fps: 30,
    hasVideo: true, hasAudio: true, size: 0
  }
}

function clip(over: Partial<Clip>): Clip {
  return {
    id: 'c', assetId: 'v', trackId: 'v1', start: 0, duration: 60, inPoint: 0, volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    color: { brightness: 0, contrast: 1, saturation: 1 },
    ...over
  }
}

function project(over: Partial<Project>): Project {
  return {
    ...emptyProject(),
    settings: { width: W, height: H, fps: 30, sampleRate: 48000 },
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
      { id: 'a1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false, duck: true }
    ],
    assets: [asset('v'), asset('m')],
    ...over
  }
}

type Overlay = RenderRequest['captionOverlay']

/** Every filter graph the plan builds for a project, as one string. */
function graphOf(p: Project, range?: { start: number; end: number }, captionOverlay?: Overlay): string {
  const args = buildRenderPlan({ project: p, outputPath: '/tmp/out.mp4', range, captionOverlay }).args
  const at = args.indexOf('-filter_complex')
  expect(at).toBeGreaterThan(-1)
  return args[at + 1]
}

/** The shape with the canvas bake's captions overlaid. */
const BAKED = 'a canvas caption bake, replayed through the concat demuxer'
const BAKE: Overlay = { listPath: '/tmp/caption-bake/captions.txt', y: 280, height: 60 }

/** The shape with more than one clip off zero, so more than one delay. */
const SEVERAL = 'music and a second clip both off zero, so two clips are delayed'

/** The shape with zoom keys on footage. */
const ZOOMED = 'zoom keys on a video clip, at speed 1'

/*
 * The shapes that between them reach every branch of the audio tail — which is
 * where all three bugs were, because it is the part that only appears once a
 * project has more than one of something.
 */
const SHAPES: { name: string; project: Project; range?: { start: number; end: number }; captionOverlay?: Overlay }[] = [
  {
    name: 'one clip, no mixing at all',
    project: project({ clips: [clip({ id: 'a' })] })
  },
  {
    name: 'two clips, so the dialogue mix appears',
    project: project({
      clips: [clip({ id: 'a' }), clip({ id: 'b', start: 60, duration: 30, inPoint: 150 })]
    })
  },
  {
    name: 'music under dialogue, so the duck and the final mix appear',
    project: project({
      clips: [
        clip({ id: 'a' }),
        clip({ id: 'b', start: 60, duration: 30, inPoint: 150 }),
        clip({ id: 'm', assetId: 'm', trackId: 'a1', start: 0, duration: 90 })
      ]
    })
  },
  {
    name: 'silent picture, which takes the anullsrc branch',
    project: project({
      assets: [{ ...asset('v'), hasAudio: false }],
      clips: [clip({ id: 'a' })]
    })
  },
  {
    // B3's white balance: must stay colorchannelmixer (2013), never become
    // colortemperature (2021), which is on the blocklist above.
    name: 'a white balance on a clip',
    project: project({
      clips: [clip({ id: 'a', color: { brightness: 0, contrast: 1, saturation: 1, temperature: 0.6, tint: -0.2 } })]
    })
  },
  {
    // B3's chroma key with everything that meets it: despill, a graded `eq`
    // (wrapped to keep alpha), a turn and a keyframed fade (geq's alpha()).
    // chromakey is 2015 and despill 2017; the Windows CI renders prove it.
    name: 'a keyed, graded, turned clip with a keyframed fade',
    project: project({
      clips: [
        clip({
          id: 'a',
          key: { color: '#00b140', similarity: 0.12, blend: 0.08, despill: 0.6 },
          color: { brightness: 0.1, contrast: 1.1, saturation: 1.2 },
          transform: { x: 0, y: 0, scale: 0.9, rotation: 10, opacity: 1 },
          keyframes: { opacity: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }] } as Clip['keyframes']
        })
      ]
    })
  },
  {
    // B3's moving mask: keyed curves in the mask's geq, held with st()/ld().
    name: 'a mask whose centre and size are keyed',
    project: project({
      clips: [
        clip({
          id: 'a',
          mask: { mode: 'reveal', blur: 0, shape: { kind: 'rectangle', x: 0.5, y: 0.5, width: 0.3, height: 0.3, rotation: 10, feather: 0.1, radius: 0.2, invert: false } },
          keyframes: {
            maskX: [{ frame: 0, value: 0.3 }, { frame: 30, value: 0.7 }],
            maskWidth: [{ frame: 0, value: 0.1 }, { frame: 30, value: 0.4, ease: 'smooth' }]
          }
        })
      ]
    })
  },
  {
    // C4's moment: a drawn frame sequence on the lane above a cut — the image2
    // input, the tpad hold and an overlay with alpha, as the card ring and the
    // captions already use.
    name: 'a moment’s frames over a cut',
    project: project({
      tracks: [
        { id: 'v1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
        { id: 'v2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false },
        { id: 'a1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false, duck: true }
      ],
      assets: [
        asset('v'),
        { id: 'mo', path: '/tmp/mo.seq/00000.png', name: 'Zoom punch', kind: 'image', durationFrames: 300, width: W, height: H, fps: null, hasVideo: true, hasAudio: false, size: 0, frames: { pattern: '/tmp/mo.seq/%05d.png', count: 12 } }
      ],
      clips: [
        clip({ id: 'a' }),
        clip({ id: 'b', start: 60, duration: 30, inPoint: 150 }),
        clip({
          id: 'mo', assetId: 'mo', trackId: 'v2', start: 54, duration: 12,
          moment: { kind: 'zoom-punch', from: { clipId: 'a' }, to: { clipId: 'b' }, seconds: 0.4, intensity: 0.5, seed: 1, version: 1 }
        })
      ]
    })
  },
  {
    // B2's range export trims the finished picture and the finished mix; the
    // branch only exists with a range, so without this shape nothing checks it.
    name: 'a range export, so the picture and the mix are trimmed',
    project: project({
      clips: [
        clip({ id: 'a' }),
        clip({ id: 'b', start: 60, duration: 30, inPoint: 150 }),
        clip({ id: 'm', assetId: 'm', trackId: 'a1', start: 0, duration: 90 })
      ]
    }),
    range: { start: 20, end: 80 }
  },
  {
    /*
     * The styled captions' bake: a concat list of PNGs as one more input,
     * its clock scaled to the project's (`settb=AVTB,setpts=PTS*25/30`)
     * before `fps` and the band's overlay (EFFECTS.md §44). settb is
     * 214c0d420b (2010-10-11), setpts a532bb390f (2010-11-02), fps
     * 54c5dd89e3 (2012-05-18). The input takes no options before
     * `-f concat`: the demuxer opens each file with none on the 2018 build.
     * `-framerate` there is fatal on the Mac (measured, §44), and on the 2018
     * build by its source: its concat demuxer has no framerate option (only
     * safe, auto_convert, segment_time_metadata), and ffmpeg_opt.c exits on
     * a format option nothing consumed (assert_avoptions, at f22fcd4).
     */
    name: BAKED,
    project: project({ clips: [clip({ id: 'a' })] }),
    captionOverlay: BAKE
  },
  {
    // Every other shape delays one clip at most (b at 60); this one delays
    // two, at different offsets and on different tracks.
    name: SEVERAL,
    project: project({
      clips: [
        clip({ id: 'a' }),
        clip({ id: 'b', start: 60, duration: 30, inPoint: 150 }),
        clip({ id: 'm', assetId: 'm', trackId: 'a1', start: 30, duration: 60 })
      ]
    })
  },
  {
    /*
     * §3.4's footage zoom: `fps=<rate>,zoompan=…:d=1:…:fps=<rate>`. zoompan is
     * 2013 and fps 2012; zoompan's restamping (each frame its own output count
     * over its fps, vf_zoompan.c:158/:225 at f22fcd4) is why the `fps=` must
     * come first. zoomVideo.int is the render, in Windows CI.
     */
    name: ZOOMED,
    project: project({
      clips: [clip({ id: 'a', keyframes: { zoom: [{ frame: 0, value: 1 }, { frame: 59, value: 1.5 }] } })]
    })
  }
]

/*
 * The argument builders that are NOT render plans (docs/CLIPS.md §3.5).
 *
 * `graphOf` scans only `buildRenderPlan`'s graph, but the bundled ffmpeg runs
 * other commands on the same 2018 build: the probes main runs at launch, the
 * moments' footage pre-pass, a steady clip's motion analysis, the Converter's
 * presets, a voice-over's conversion — and the AI helper's decodes, which are
 * Python (sidecar/forge_sidecar/media.py `frame_args` / `decode_args`, the
 * face pass's decoder, §4.3), asked for their argv through the helper's own
 * interpreter. Each is scanned whole by the same blocklist.
 *
 * Not here, because no pure builder exists: the helper's beat decode
 * (beats.py `_decode_mono`, `-ss`/`-t`/`-ac`/`-ar` and no filter) and its
 * plane writer (depth.py `_write_rgba`, an image encode), and main's stems
 * split, waveform, mask-tag probe (src/main/transitions/maskTags.ts:50,
 * `scale=…,format=gray`) and graphics compositor
 * (src/main/graphics/compositor.ts:60, `overlay=0:0:shortest=1,
 * format=yuv420p`), which build their argv inline. All old filters today;
 * a new one added to any of these is NOT scanned until it gets a builder here.
 *
 * Step 1's scene pass, `sceneArgs` in src/main/ffmpeg/shots.ts (§4.2), joins
 * this list when it is built — `scdet` is on the blocklist because that pass
 * is where it would be reached for. The `it.todo` below is the hook.
 */
const SIDECAR = resolve(__dirname, '../sidecar')
const VENV = join(SIDECAR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const HELPER_PYTHON = existsSync(VENV) ? VENV : process.env.FORGE_PYTHON ?? 'python3'

/** The helper's decode argv, from the helper itself: stdlib-only, so a bare interpreter answers. Asked once. */
let helperOnce: { frames: string[]; frame: string[] } | null = null
function helperArgs(): { frames: string[]; frame: string[] } {
  if (helperOnce) return helperOnce
  const script = [
    'import json',
    'from forge_sidecar import media',
    'print(json.dumps({',
    '  "frames": media.frame_args("/tmp/in.mp4", "ffmpeg", 5, 640, 360, 1500, 2500),',
    '  "frame": media.decode_args("/tmp/in.mp4", "ffmpeg", 640, 360, 1500),',
    '}))'
  ].join('\n')
  const out = execFileSync(HELPER_PYTHON, ['-c', script], {
    cwd: SIDECAR,
    env: { ...process.env, PYTHONPATH: SIDECAR, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    windowsHide: true
  })
  helperOnce = JSON.parse(out) as { frames: string[]; frame: string[] }
  return helperOnce
}

const FOOTAGE = { path: '/tmp/v.mp4', inPoint: 30, duration: 60, first: 10, count: 12, fps: 30, size: { width: W, height: H }, maxEdge: 2160 }

const ANALYSIS_SHAPES: { name: string; args: () => string[] }[] = [
  { name: 'the chroma-key scale probe (main, at launch)', args: () => keyProbeArgs() },
  ...ENCODERS.map((e) => ({ name: `the encoder probe, ${e.id}`, args: () => probeArgs(e.id, '/tmp/probe.mp4') })),
  { name: 'a moment’s footage pre-pass, cropped', args: () => momentFrameArgs({ ...FOOTAGE, crop: { x: 40, y: 0, width: 202, height: 360 } }, '/tmp/m/%05d.png') },
  { name: 'a moment’s footage pre-pass, at half speed', args: () => momentFrameArgs({ ...FOOTAGE, speed: 0.5 }, '/tmp/m/%05d.png') },
  { name: 'a moment’s footage pre-pass, smooth slow motion', args: () => momentFrameArgs({ ...FOOTAGE, speed: 0.5, smoothSlow: true }, '/tmp/m/%05d.png') },
  { name: 'a moment’s footage pre-pass, over a ramp', args: () => momentFrameArgs({ ...FOOTAGE, ramp: { from: 1, to: 0.25 } }, '/tmp/m/%05d.png') },
  { name: 'a moment’s footage pre-pass, on a freeze', args: () => momentFrameArgs({ ...FOOTAGE, hold: true }, '/tmp/m/%05d.png') },
  {
    // main/render/steady.ts runs exactly this: the clip's input, then the detect filter.
    name: 'a steady clip’s motion analysis',
    args: () => [...videoInputArgs(clip({ id: 'a' }), { path: '/tmp/v.mp4' }, 30), '-vf', steadyDetectFilter('steady-0.trf'), '-f', 'null', '-']
  },
  { name: 'a voice-over kept', args: () => voiceOverArgs('/tmp/take.webm', '/tmp/take.wav', 48000) },
  ...PRESETS.filter((p) => p.buildArgs).map((p) => ({
    name: `the Converter’s ${p.id}`,
    args: () =>
      p.buildArgs!({
        input: '/tmp/in', output: `/tmp/out.${p.outExt(defaultParams(p))}`, params: defaultParams(p),
        info: { path: '/tmp/in', name: 'in', size: 1, kind: p.kind, durationMs: 10_000, width: W, height: H, rotation: 0, videoCodec: 'h264', audioCodec: 'aac', fps: 30 }
      })
  })),
  { name: 'the helper’s frame stream (media.frame_args — the face pass’s decoder)', args: () => helperArgs().frames },
  { name: 'the helper’s one-frame decode (media.decode_args)', args: () => helperArgs().frame }
]

describe('a filter graph runs on the oldest bundled ffmpeg', () => {
  for (const { name, project: p, range, captionOverlay } of SHAPES) {
    it(`uses nothing merged after 2018-12-17 — ${name}`, () => {
      const graph = graphOf(p, range, captionOverlay)
      for (const { pattern, since, why } of TOO_NEW) {
        const hit = pattern.exec(graph)
        expect(
          hit,
          `"${hit?.[0]}" first shipped in ffmpeg ${since}, and was merged after ` +
            `the Windows build's 2018-12-17 snapshot of master — ${why}`
        ).toBeNull()
      }
    })
  }

  it('still mixes rather than silently dropping a stream', () => {
    /*
     * The guard above is satisfied by emitting no audio at all, so this pins
     * the thing it is guarding: three sources still reach one output, and the
     * amix that joins them still compensates for its own normalisation.
     */
    const graph = graphOf(SHAPES[2].project)
    expect(graph).toMatch(/amix=inputs=2:duration=longest:dropout_transition=0,volume=2/)
    expect(graph).toContain('apad,atrim=end=')
    expect(graph).toContain('sidechaincompress')
  })

  it('reaches a delayed clip, and every delay in every shape is in samples', () => {
    /*
     * `adelay=<n>S|<n>S|…` places each clip on its exact sample (docs/CLIPS.md
     * §3.3, EFFECTS.md §39); whole milliseconds put a split 16 samples apart.
     *
     * Dated, not run here. The `S` form is b5314333de, 2016-08-11 ("make it
     * possible to delay channels by exact number of samples"). At the Windows
     * build's own commit, f22fcd4 (committed 2018-12-17), each entry is read
     *
     *     ret = av_sscanf(arg, "%d%c", &d->delay, &type);
     *
     * and is samples when `ret == 2 && type == 'S'`; anything else falls to
     * `%f` milliseconds. (The plan cited 7748f395de: a vf_select commit of
     * 2018-11-11 whose tree it read — the right file, the wrong commit.) The
     * render check, tests/integration/audioSplit.int.test.ts, is the run, in
     * Windows CI.
     *
     * The CASE matters. Lowercase `s` is seconds, and that is 35a8179149,
     * 2019-01-01 — after the floor. On the 2018 build `2s` scans as 2 and 's',
     * fails the `'S'` test, falls to `%f` and is 2 ms: silently wrong, no
     * error. The case-sensitive /^\d+S$/ below is the guard against it.
     *
     * Every site in every shape, not the first.
     */
    const sites = new Map<string, number>()
    for (const { name, project: p, range, captionOverlay } of SHAPES) {
      let n = 0
      for (const m of graphOf(p, range, captionOverlay).matchAll(/adelay=([^,;[\]]*)/g)) {
        n++
        for (const entry of m[1].split('|')) expect(entry, name).toMatch(/^\d+S$/)
      }
      sites.set(name, n)
    }
    // The scan is not of graphs without a delay in them: each shape with a
    // clip off zero reached one (five today; more is fine)…
    expect([...sites.values()].filter((n) => n > 0).length).toBeGreaterThanOrEqual(5)
    // …and the shape with two clips off zero reached both.
    expect(sites.get(SEVERAL)).toBeGreaterThanOrEqual(2)
  })

  it('reaches the caption bake, its clock scaled once, before fps, so the scan above is not of a graph without it', () => {
    const shape = SHAPES.find((s) => s.name === BAKED)!
    const args = buildRenderPlan({ project: shape.project, outputPath: '/tmp/out.mp4', captionOverlay: shape.captionOverlay }).args
    // The list is one more input, read by the concat demuxer, with no input option of its own: the
    // token before `-f concat` is the previous input's path, after its `-i`.
    const sites = args.flatMap((a, i) => (a === BAKE!.listPath ? [i] : []))
    expect(sites, 'the list in the argv').toHaveLength(1)
    const at = sites[0]
    expect(args.slice(at - 5, at + 1)).toEqual(['-f', 'concat', '-safe', '0', '-i', BAKE!.listPath])
    expect(args[at - 7], 'an input option before -f concat').toBe('-i')
    // Its chain, at its one site, by filter and order only: a time base set, the clock moved once, then onto
    // the shape's 30 fps frames. The expressions are not pinned. More than one form is frame-exact (§44
    // measured `fps=25,settb=AVTB,setpts=N/(30*TB)` as well), and whether a form puts each picture on its
    // frame is captionBakeTiming.int's to say, on decoded frames. This checks that the floor's three filters
    // are what the bake reaches.
    const graph = graphOf(shape.project, undefined, shape.captionOverlay)
    const chains = [...graph.matchAll(/\[(\d+):v\]([^[;]*)\[cap\]/g)]
    expect(chains, 'caption chains').toHaveLength(1)
    const steps = chains[0][2].split(',')
    const setpts = steps.flatMap((f, i) => (f.startsWith('setpts=') ? [i] : []))
    expect(setpts, `${chains[0][2]}: the clock moved once`).toHaveLength(1)
    const order = [steps.findIndex((f) => f.startsWith('settb=')), setpts[0], steps.lastIndexOf('fps=30')]
    expect(order.every((i) => i >= 0), `${chains[0][2]} has settb, setpts and fps=30`).toBe(true)
    expect([...order].sort((a, b) => a - b), `${chains[0][2]} in order`).toEqual(order)
    expect(graph).toContain(`[cap]overlay=0:${BAKE!.y}:shortest=1`)
  })

  it('reaches the footage zoom, one frame in for one out, at the project rate', () => {
    /*
     * Membership and order, not the expression. Every zoompan in the shape (one
     * today), its chain read back to the input label: an `fps=30` before it, and
     * `d=1`. `d=<the clip's length>` froze the clip on its first frame, and
     * `d=1` without the `fps=` played 60 fps footage at half speed
     * (EFFECTS.md §46); which frames each form shows is zoomVideo.int's to say.
     */
    const graph = graphOf(SHAPES.find((s) => s.name === ZOOMED)!.project)
    const chains = [...graph.matchAll(/\[\d+:v\]([^;]*)/g)].map((m) => m[1]).filter((c) => c.includes('zoompan='))
    expect(chains, 'chains with a zoompan').toHaveLength(1)
    const steps = chains[0].split(/,(?![^']*'(?:[^']*'[^']*')*[^']*$)/)
    const zoom = steps.findIndex((f) => f.startsWith('zoompan='))
    expect(steps.slice(0, zoom), 'an fps= before the zoompan').toContain('fps=30')
    expect(steps[zoom].split(':'), 'one output frame per input frame').toContain('d=1')
  })

  it('spawns every shape with its graph in a file, by an option the 2018 build has', () => {
    /*
     * The export does not pass the graph scanned above on its command line: it
     * writes it to a file and passes `-filter_complex_script <file>`
     * (docs/CLIPS.md §3.7, EFFECTS.md §47). That option is ffmpeg 2.0's (2013,
     * Changelog), and at the Windows build's f22fcd4 it is in the option table
     * (fftools/ffmpeg_opt.c:3478) and reads the file whole into the same
     * graph_desc `-filter_complex` fills (:3109). The newer spelling of the
     * same thing, `-/filter_complex <file>`, is 7.0 (2024): nothing spawned may
     * use it. Every shape, every argument.
     */
    for (const { name, project: p, range, captionOverlay } of SHAPES) {
      const args = buildRenderPlan({ project: p, outputPath: '/tmp/out.mp4', range, captionOverlay }).args
      const spawned = withGraphFile(args, '/tmp/graph-0.txt')
      expect(spawned.filter((a) => a === '-filter_complex_script'), name).toHaveLength(1)
      expect(spawned.filter((a) => a === '-filter_complex'), name).toHaveLength(0)
      expect(spawned.filter((a) => /^-\//.test(a)), `${name}: -/option is ffmpeg 7.0`).toEqual([])
      // What goes in the file is the graph the scan above read.
      expect(filterGraphOf(args), name).toBe(graphOf(p, range, captionOverlay))
    }
  })

  it('reaches the range trims, so the scan above is not of a graph without them', () => {
    const shape = SHAPES.find((s) => s.range)!
    const graph = graphOf(shape.project, shape.range)
    expect(graph).toContain('trim=start=')
    expect(graph).toContain('atrim=start=')
  })
})

describe('every other ffmpeg command runs on the oldest bundled ffmpeg', () => {
  for (const { name, args } of ANALYSIS_SHAPES) {
    it(`uses nothing merged after 2018-12-17 — ${name}`, () => {
      const argv = args()
      expect(argv.length, name).toBeGreaterThan(0)
      const text = argv.join('\n')
      for (const { pattern, since, why } of TOO_NEW) {
        const hit = pattern.exec(text)
        expect(
          hit,
          `"${hit?.[0]}" first shipped in ffmpeg ${since}, and was merged after ` +
            `the Windows build's 2018-12-17 snapshot of master — ${why}`
        ).toBeNull()
      }
    })
  }

  it('reaches the filters it says it scans', () => {
    // The scan above is satisfied by an empty argv; this pins what the shapes hold.
    const filterOf = (argv: string[]): string => argv[argv.indexOf('-vf') + 1] ?? ''
    const byName = new Map(ANALYSIS_SHAPES.map((s) => [s.name, s.args()]))
    expect(filterOf(byName.get('a moment’s footage pre-pass, cropped')!)).toContain('crop=')
    expect(filterOf(byName.get('a moment’s footage pre-pass, smooth slow motion')!)).toContain('minterpolate')
    expect(filterOf(byName.get('a steady clip’s motion analysis')!)).toContain('vidstabdetect=')
    expect(filterOf(byName.get('the chroma-key scale probe (main, at launch)')!)).toContain('chromakey=')
    const helper = helperArgs()
    expect(filterOf(helper.frames).split(','), 'the frame stream').toEqual(expect.arrayContaining(['fps=5']))
    // indexOf is -1 for a missing -ss, which is "before" anything: present first, then before.
    expect(helper.frames.indexOf('-ss'), 'the frame stream seeks').toBeGreaterThanOrEqual(0)
    expect(helper.frames.indexOf('-ss'), 'the seek before the input').toBeLessThan(helper.frames.indexOf('-i'))
    expect(filterOf(helper.frame)).toMatch(/^scale=/)
  })

  it.todo('scans step 1’s sceneArgs (docs/CLIPS.md §4.2) — add it to ANALYSIS_SHAPES when src/main/ffmpeg/shots.ts lands')
})
