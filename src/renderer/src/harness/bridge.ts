import type { MediaAsset } from '@shared/timeline'
import type { PackListing } from '@shared/assets/pack'
import { LOOKS, cubeFor } from '@shared/render/looks'
import type { Job } from '@shared/types'
import { buildYtDlpArgs, captionKeys, outputStem, type IngestRequest, type LinkMeta } from '@shared/ingest/args'
import { linkCacheKey, parseLink } from '@shared/ingest/url'
import { parseJson3, type CaptionFetch } from '@shared/ingest/captions'
import type { LinkClip } from '@shared/ingest/linkClip'

/**
 * A working stand-in for the Electron bridge, so the UI runs in a browser.
 *
 * Not a mock in the testing sense — nothing asserts on it. It exists so the
 * interface can be opened, clicked and looked at without building and launching
 * the app, which is the one thing that cannot be done from outside the machine.
 * Layout, panel logic, what appears when a clip is selected, where the text box
 * lands: all of that is renderer-side and all of it has been reported as broken
 * at some point.
 *
 * What it cannot stand in for: ffmpeg, the Python sidecar, real decoding, and
 * the export. Those are real work in other processes. Anything the harness
 * shows about THOSE is worthless, and it says so rather than faking a result.
 */

const unsupported = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} needs the real app — the harness has no ${what.toLowerCase()}`)
}

/** Settings for this page's lifetime; the harness has no disk to keep them on. */
const harnessSettings: Record<string, unknown> = {}

/** Files the harness has made, so they can be handed back as assets. */
const made = new Map<string, { width: number; height: number }>()

/* --------------------------------------------------------------- packs */

/**
 * Two packs, in the two states that matter.
 *
 * One published, so there is something to press, and one unpublished, because
 * that is what every pack in the real build is today and the panel has to look
 * right in it. Mutable: installing one here changes what the button says, which
 * is the whole point of having it.
 */
const harnessPacks: PackListing[] = [
  {
    id: 'library',
    name: 'Asset library',
    summary: '88 fonts, 412 transitions, 50 title templates, SFX and props',
    group: 'library',
    version: 1,
    url: 'https://example.invalid/library.tar.gz',
    sha256: 'a'.repeat(64),
    bytes: 85_000_000,
    state: { kind: 'available' }
  },
  {
    id: 'stickers-telugu',
    name: 'Telugu reactions',
    summary: '78 reaction stickers with transparency',
    group: 'stickers',
    version: 1,
    url: '',
    sha256: '',
    bytes: 14_000_000,
    state: { kind: 'unpublished' }
  }
]

/* ------------------------------------------------------- link captions */

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const FILLER = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']

/**
 * A link's caption track, made up — never anyone's speech.
 *
 * The measured ASR shape (docs/EFFECTS.md §40): a window event, then one
 * roll-up event per line, its first word at `tStartMs` and the rest at
 * `tOffsetMs`, `acAsrConf` 0, and a "\n" `aAppend` event between lines. Twelve
 * sentences, "row <n> …" so a check can tell them apart, each ending in a full
 * stop, one every 12 s from 1 s: twelve rows, and three chapters of 5, 4 and 3.
 */
function harnessJson3(): unknown {
  const events: unknown[] = [{ tStartMs: 0, dDurationMs: 150_000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 }]
  for (let row = 0; row < 12; row++) {
    const start = 1_000 + row * 12_000
    const words = ['row', NUMBER_WORDS[row], ...Array.from({ length: 7 }, (_, k) => FILLER[(row + k) % FILLER.length])]
    words[words.length - 1] += '.'
    events.push({
      tStartMs: start,
      dDurationMs: 6_000,
      wWinId: 1,
      segs: words.map((w, k) => (k === 0 ? { utf8: w, acAsrConf: 0 } : { utf8: ` ${w}`, tOffsetMs: k * 400, acAsrConf: 0 }))
    })
    events.push({ tStartMs: start + 3_900, dDurationMs: 2_100, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] })
  }
  return { wireMagic: 'pb3', events }
}

/**
 * The links the stubs know by name (CLIPS.md §3b.8). Any other link is the
 * twelve-row talk too; these two are the states a check needs besides it.
 */
export const HARNESS_LINKS = {
  /** Twelve rows, three chapters, English. */
  talk: 'https://www.youtube.com/watch?v=HarnessTalk',
  /** The same details and chapters, and no caption track in any language. */
  noCaptions: 'https://www.youtube.com/watch?v=NoCaptions1',
  /** Details that name no language, so the user chooses one. */
  noLanguage: 'https://www.youtube.com/watch?v=NoLanguage1'
} as const

const isLink = (url: string, which: string): boolean => parseLink(url)?.url === parseLink(which)?.url

function harnessMeta(url: string): LinkMeta {
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  return {
    id: link.videoId ?? link.key,
    title: 'A harness talk in twelve rows',
    duration: 150,
    language: isLink(url, HARNESS_LINKS.noLanguage) ? null : 'en',
    chapters: [
      { start_time: 0, end_time: 50, title: 'Opening' },
      { start_time: 50, end_time: 100, title: 'Middle' },
      { start_time: 100, end_time: 150, title: 'Close' }
    ],
    heatmap: null,
    channel: 'Harness channel',
    uploader: 'Harness channel',
    webpage_url: link.url
  }
}

function harnessCaptions(url: string, language: string): CaptionFetch {
  const link = parseLink(url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  const keys = captionKeys(language)
  if (!keys) throw new Error('Choose the video’s language to fetch its captions')
  const linkKey = linkCacheKey(link)
  // yt-dlp's answer for a video with none of these languages: `NA`, nothing written (EFFECTS.md §40).
  if (isLink(url, HARNESS_LINKS.noCaptions)) return { linkKey, keys, tracks: [], transcript: null }
  const asr = keys[keys.length - 1]
  return {
    linkKey,
    keys,
    tracks: [{ key: asr, kind: 'asr', path: `harness://url/${linkKey}/${linkKey}.captions.${asr}.json3` }],
    transcript: parseJson3(harnessJson3(), `url:${linkKey}`, 'youtube-asr', keys[0])
  }
}

/**
 * Downloads asked for, recorded rather than run: the request, a Clip it's
 * words and credit, and the argv main would spawn yt-dlp with — built by the
 * same `buildYtDlpArgs`, so a check can count its `--download-sections`.
 */
export interface HarnessIngest {
  id: string
  request: IngestRequest
  clip: LinkClip | null
  args: string[]
}
export const harnessIngests: HarnessIngest[] = []

/**
 * A download job that only records its request. It is queued and stays so —
 * the harness has no yt-dlp — and nothing broadcasts it, so the export list
 * and the store's jobs are left as they were; the clip never lands here.
 */
function harnessStartIngest(request: IngestRequest, clip?: LinkClip | null): Job {
  const link = parseLink(request.url)
  if (!link) throw new Error('That is not a link yt-dlp can read')
  const id = `harness-dl-${harnessIngests.length + 1}`
  const stem = outputStem(link, request)
  const { args } = buildYtDlpArgs(request, { ffmpegPath: 'harness/ffmpeg', destDir: 'harness/downloads', stem })
  harnessIngests.push({ id, request, clip: clip ?? null, args })
  return {
    id,
    presetId: 'ingest',
    input: link.url,
    inputName: `harness · ${stem}`,
    output: 'harness/downloads',
    params: {},
    status: 'queued',
    progress: 0,
    speed: null,
    error: null,
    startedAt: null,
    finishedAt: null
  }
}

/** One caption track read back by its keys, as `ingest:captionTrack` does from the reload cache. */
function harnessCaptionTrack(linkKey: string, key: string): { key: string; kind: 'asr' | 'lines'; json: unknown } {
  const talk = parseLink(HARNESS_LINKS.talk)!
  if (key.endsWith('-orig') && linkKey === linkCacheKey(talk)) return { key, kind: 'asr', json: harnessJson3() }
  throw new Error('The captions this clip was picked from are no longer on this machine')
}

const packCancels = new Set<string>()
const packListeners = new Set<(update: { id: string; progress: number | null; message: string }) => void>()

function emitPackProgress(id: string, progress: number | null, message: string): void {
  for (const listener of packListeners) listener({ id, progress, message })
}

function blobUrl(data: BlobPart, type: string): string {
  return URL.createObjectURL(new Blob([data], { type }))
}

/**
 * Record a picture's REAL size.
 *
 * The harness must never guess at dimensions. The first run of it drew every
 * text clip twice — once from the baked PNG, once from the editing overlay, in
 * different places — which looks exactly like a placement bug and was purely
 * this file claiming a 1920x1080 image was 1080x1920. A harness that lies sends
 * you hunting for faults that are not there.
 */
async function measured(url: string): Promise<string> {
  const size = await new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = url
  })
  if (size.width > 0) made.set(url, size)
  return url
}

/**
 * A synthetic photograph.
 *
 * Distinct colours and a number on each, because "the wrong clip is showing"
 * and "the layer order is upside down" are both invisible with identical
 * placeholders.
 */
function samplePhoto(index: number, width = 1600, height = 1067): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const hue = (index * 47) % 360
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, `hsl(${hue} 55% 62%)`)
  sky.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 28%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  // A figure, roughly where a subject sits, so framing and matting have a shape.
  ctx.fillStyle = `hsl(${(hue + 180) % 360} 40% 18%)`
  ctx.beginPath()
  ctx.ellipse(width * 0.42, height * 0.34, width * 0.07, width * 0.07, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(width * 0.35, height * 0.44, width * 0.14, height * 0.5)

  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `bold ${Math.round(height * 0.16)}px sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText(String(index + 1), width - 40, height - 40)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob!)
      made.set(url, { width, height })
      resolve(url)
    }, 'image/png')
  })
}

/**
 * A synthetic VIDEO — a real, decodable, seekable file.
 *
 * Recorded from a canvas rather than faked, because the things that need
 * checking about video cannot be checked against a still: playback rate,
 * seeking, drift, trimming, and now speed. Until this existed the harness could
 * only ever produce images, so an entire half of the editor was invisible to
 * it — and "only images" is exactly the blind spot that lets a video-only bug
 * ship.
 *
 * A moving counter and a sweeping bar, so a frame can be identified on sight:
 * "it is showing the wrong moment" is impossible to see in a static gradient.
 */
async function sampleVideo(seconds = 6, fps = 30): Promise<string> {
  const width = 640
  const height = 360
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const stream = canvas.captureStream(fps)
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t)
  )
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start()

  /*
   * Paced by the wall clock, not by a frame count.
   *
   * The first version drew `seconds * fps` frames one per animation frame,
   * which on a 60Hz display recorded 180 frames in three seconds and produced a
   * three-second file that the harness then announced as six. A harness that
   * misreports a duration sends you hunting a trimming bug that does not exist
   * — the same trap this file already carries a warning about for image sizes.
   */
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const draw = (): void => {
      const t = (performance.now() - start) / 1000
      if (t >= seconds) {
        resolve()
        return
      }
      ctx.fillStyle = `hsl(${Math.round(t * 90) % 360} 45% 22%)`
      ctx.fillRect(0, 0, width, height)
      // A bar sweeping once per second: a seek landing early is visible.
      ctx.fillStyle = '#f97a4b'
      ctx.fillRect(((t % 1) * width) | 0, 0, 8, height)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 84px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(t.toFixed(2), width / 2, height / 2)
      requestAnimationFrame(draw)
    }
    requestAnimationFrame(draw)
  })

  recorder.stop()
  await done
  const url = URL.createObjectURL(new Blob(chunks, { type: type ?? 'video/webm' }))
  made.set(url, { width, height })
  // What was actually recorded, asked of the file itself.
  videoFiles.set(url, await videoSeconds(url))
  return url
}

/**
 * How long a recorded blob really is.
 *
 * Chromium reports `Infinity` for MediaRecorder webm until it has been seeked
 * past the end, which is why this asks twice instead of trusting `duration`.
 */
async function videoSeconds(url: string): Promise<number> {
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = url
  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => resolve()
  })
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve()
    video.onerror = () => resolve()
    video.currentTime = 1e6
  })
  return Number.isFinite(video.currentTime) && video.currentTime > 0 ? video.currentTime : 1
}

/** Which synthetic files are video, and how long each one is. */
const videoFiles = new Map<string, number>()

/**
 * The same length the asset record claims.
 *
 * A waveform is indexed by the peaks' own duration, so a stub that disagreed
 * with `asset()` would draw every clip's sound stretched or squashed — and it
 * would look like a bug in the mapping rather than a bug in the fixture.
 */
function fakeDurationMs(path: string): number {
  return Math.round((videoFiles.get(path) ?? 12) * 1000)
}

function asset(path: string, name: string, fps: number, kind: MediaAsset['kind']): MediaAsset {
  const size = made.get(path) ?? { width: 1600, height: 1067 }
  return {
    id: `a-${Math.random().toString(36).slice(2, 9)}`,
    path,
    name,
    kind,
    // A recorded clip reports its REAL length. Claiming twelve seconds for a
    // six-second file would let a trim run off the end of the media, which is
    // precisely the sort of fiction that sends you hunting a bug that is not there.
    durationFrames:
      kind === 'image' ? fps * 5 : Math.round((videoFiles.get(path) ?? 12) * fps),
    width: kind === 'audio' ? null : size.width,
    height: kind === 'audio' ? null : size.height,
    fps: kind === 'image' ? null : fps,
    hasVideo: kind !== 'audio',
    hasAudio: kind === 'audio',
    size: 1024
  }
}

/** Steady 120 BPM, so beat-driven planning has something plausible to chew. */
function fakeBeats(durationMs: number): Record<string, unknown> {
  const step = 500
  const beats = Array.from({ length: Math.floor(durationMs / step) }, (_, i) => i * step)
  return {
    bpm: 120,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    tiers: beats.map((_, i) => (i % 16 >= 12 ? 3 : 2)),
    drops: [{ ms: Math.round(durationMs * 0.5), score: 0.9 }],
    buildups: [],
    sections: [0, Math.round(durationMs * 0.5)],
    durationMs,
    onsets: beats,
    windowStartMs: 0
  }
}

/** The director's provider settings, kept in memory so the panel round-trips. */
const harnessDirector = {
  provider: 'auto' as 'auto' | 'ollama' | 'openai',
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: '' },
  openai: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', hasKey: false }
}

/*
 * The menu and the window's full-screen state, as listeners a script can call.
 *
 * There is no menu bar here, so `onMenuCommand` used to drop its callback —
 * which made File > New the one control in the app that no harness run could
 * reach: the New Project dialog opens from that command and nothing else. The
 * same for full screen and its Exit button. Keeping the listeners costs
 * nothing, and `window.forgeMenu('new')` / `window.forgeFullScreen(true)` stand
 * in for the main process sending them.
 */
const menuListeners = new Set<(command: string) => void>()
const fullScreenListeners = new Set<(on: boolean) => void>()

function sendMenuCommand(command: string): void {
  if (menuListeners.size === 0) throw new Error('Nothing is listening for menu commands yet')
  for (const listener of menuListeners) listener(command)
}

function sendFullScreen(on: boolean): void {
  if (fullScreenListeners.size === 0) throw new Error('Nothing is listening for full screen yet')
  for (const listener of fullScreenListeners) listener(on)
}

/** How many frames each clip has baked, for the harness to read back. */
const titleFrames = new Map<string, number>()
/** Byte sizes of the caption pictures baked, and the concat list naming them. */
const captionFrames: number[] = []
const captionList = { text: '' }

export function installHarnessBridge(): void {
  let sampleCount = 0

  const bridge = {
    getPathForFile: () => '',

    probe: async (paths: string[], fps: number) => ({
      assets: paths.map((p, i) =>
        asset(p, videoFiles.has(p) ? `clip ${i + 1}.webm` : `sample ${i + 1}`, fps,
          videoFiles.has(p) ? 'video' : 'image')
      ),
      failed: []
    }),

    /** Stands in for the file dialog: makes pictures rather than opening any. */
    pickMedia: async () => {
      const files: string[] = []
      for (let i = 0; i < 3; i++) files.push(await samplePhoto(sampleCount++))
      // One real recorded clip alongside the stills, so anything that only
      // applies to moving pictures — speed, seeking, playback rate — can
      // actually be tried here.
      files.push(await sampleVideo())
      return files
    },

    pickLut: async () => {
      const look = LOOKS[2]
      return blobUrl(cubeFor(look, 9), 'text/plain')
    },

    builtInLooks: async () =>
      LOOKS.map((look) => ({
        id: look.id,
        name: look.name,
        description: look.description,
        file: blobUrl(cubeFor(look, 9), 'text/plain')
      })),

    placeAsset: async (file: string, fps: number) =>
      asset(file, file.split('/').pop() ?? 'placed', fps,
        videoFiles.has(file) ? 'video' : 'image'),

    writeTitleImage: async (_clipId: string, bytes: ArrayBuffer) =>
      // Straight back out as a URL the preview can load, so text really draws.
      measured(blobUrl(bytes, 'image/png')),

    /*
     * Baked animation frames, counted rather than written.
     *
     * There is no disk here, but how MANY frames a clip bakes is the part of
     * the export path a browser can genuinely check — it is decided entirely by
     * the animation and the clip, and getting it wrong means either a frozen
     * caption or a folder full of identical pictures.
     */
    writeTitleFrame: async (clipId: string, frame: number) => {
      titleFrames.set(clipId, Math.max(titleFrames.get(clipId) ?? 0, frame + 1))
      return `harness://${clipId}.seq/%05d.png`
    },
    clearTitleFrames: async (clipId: string) => {
      titleFrames.delete(clipId)
    },
    // The eval pulls a run's footage frames in node and serves them; the app itself needs ffmpeg for this.
    momentFrames: unsupported("A moment's footage frames"),

    /*
     * Baked captions, counted and kept rather than written.
     *
     * There is no disk here, but HOW MANY distinct pictures a timeline bakes is
     * the number the whole optimisation turns on — it is decided entirely by the
     * caption timings and the animation, and a regression that quietly baked one
     * picture per frame would look identical in every other respect.
     */
    writeCaptionFrame: async (index: number, bytes: ArrayBuffer) => {
      captionFrames.push(bytes.byteLength)
      return `harness://captions/${String(index).padStart(5, '0')}.png`
    },
    writeCaptionList: async (text: string) => {
      captionList.text = text
      return 'harness://captions/captions.txt'
    },
    clearCaptionFrames: async () => {
      captionFrames.length = 0
      captionList.text = ''
    },

    renderText: unsupported('Text rasterising'),
    renderSolid: async (options: { width: number; height: number; color: string; opacity: number }) => {
      const canvas = document.createElement('canvas')
      canvas.width = options.width
      canvas.height = options.height
      const ctx = canvas.getContext('2d')!
      ctx.globalAlpha = options.opacity
      ctx.fillStyle = options.color
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL('image/png')
      made.set(url, { width: options.width, height: options.height })
      return url
    },

    titleSlots: async () => [],
    renderTitle: unsupported('Title templates'),

    assetCatalog: async () => ({
      catalog: { version: 1, generatedAt: '', entries: [] },
      root: '',
      exists: false
    }),
    assetFileUrl: async (relative: string) => relative,
    assetFontData: unsupported('Font loading'),
    transitionLibrary: async () => [],

    /*
     * Asset packs, SIMULATED — and the one place this file fakes a result on
     * purpose.
     *
     * A download is real work elsewhere, so by the rule above this should
     * refuse. But the thing worth looking at here is not the download: it is
     * the button's state machine — bar, indeterminate stage, cancel, installed,
     * remove, try again — and every one of those is renderer logic. Refusing
     * would leave a panel of four greyed buttons with nothing to click, which
     * checks nothing at all.
     *
     * So the bytes are imaginary and the catalog stays empty, which it does in
     * every other harness state too. Nothing here says anything about whether a
     * real pack unpacks; `tests/assetPacks.test.ts` is what covers that.
     */
    assetPacks: async () => harnessPacks.map((pack) => ({ ...pack })),
    installAssetPack: async (id: string) => {
      const pack = harnessPacks.find((p) => p.id === id)
      if (!pack) throw new Error(`There is no pack called ${id}`)
      packCancels.delete(id)

      for (let step = 0; step <= 10; step++) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        if (packCancels.has(id)) {
          packCancels.delete(id)
          throw new Error('Cancelled')
        }
        emitPackProgress(id, step / 10, `fetching ${pack.name}`)
      }
      // The two stages with no total, which is what the striped bar is for.
      emitPackProgress(id, null, 'checking what arrived')
      await new Promise((resolve) => setTimeout(resolve, 250))
      emitPackProgress(id, null, 'unpacking')
      await new Promise((resolve) => setTimeout(resolve, 250))

      pack.state = { kind: 'installed', version: pack.version }
      return { ...pack }
    },
    cancelAssetPack: async (id: string) => {
      packCancels.add(id)
    },
    removeAssetPack: async (id: string) => {
      const pack = harnessPacks.find((p) => p.id === id)
      if (pack) pack.state = { kind: 'available' }
      return harnessPacks.map((entry) => ({ ...entry }))
    },
    onPackProgress: (cb: (update: { id: string; progress: number | null; message: string }) => void) => {
      packListeners.add(cb)
      return () => packListeners.delete(cb)
    },

    analyseBeats: async (_path: string, range?: { startMs?: number; endMs?: number }) =>
      fakeBeats((range?.endMs ?? 30_000) - (range?.startMs ?? 0)),

    /*
     * Peaks are INTERLEAVED min/max pairs — two numbers per bucket, the
     * trough and the crest. This returned one number per bucket, which is a
     * different array with the same field name: anything reading it as pairs
     * read half the file at twice the rate, with every trough taken from the
     * next bucket's crest. The trimmer never noticed because it draws
     * `max - min` and any two numbers make a bar.
     *
     * It also has a shape now. A flat band proves a waveform is drawn; it
     * cannot show whether the right PART of the file was drawn, which is the
     * only hard question a clip waveform asks.
     */
    peaks: async (path: string, buckets = 400) => {
      const values: number[] = []
      for (let i = 0; i < buckets; i++) {
        const t = i / buckets
        // A four-bar loop with a kick on the beat, so a trimmed clip's
        // waveform can be checked against where it was trimmed from.
        const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 64)), 6)
        const swell = 0.25 + 0.55 * Math.sin(t * Math.PI)
        const amp = Math.min(1, swell * (0.35 + beat) + 0.04)
        values.push(-amp * 0.9, amp)
      }
      return { values, buckets, durationMs: fakeDurationMs(path) }
    },

    bakeParallax: unsupported('Depth baking'),
    cancelParallax: async () => undefined,
    onParallaxProgress: () => () => undefined,

    // No sidecar here: the gate lets every photo through, as it does in the app
    // when the sidecar cannot measure. Keys by path, so a look is asked once.
    measurePhotos: async (paths: string[]) => ({
      measures: [],
      keys: Object.fromEntries(paths.map((p) => [p, `harness:${p}`])),
      unavailable: 'the harness has no sidecar'
    }),
    fileKeys: async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `harness:${p}`])),

    splitStems: async (path: string) => ({
      instrumental: path,
      voice: path,
      backend: 'harness',
      quality: 'emphasised' as const
    }),

    /*
     * Downloads cannot happen here, but the PANEL must still be clickable —
     * it is renderer logic, which is exactly what the harness exists to check.
     * So status answers honestly and the two actions refuse by name.
     */
    ingestStatus: async () => ({ ready: false, tool: null, reason: 'harness: no yt-dlp' }),
    // Recorded, never run: Clip it's job and its argv are what a check reads (CLIPS.md §3b.8).
    startIngest: async (request: IngestRequest, clip?: LinkClip | null) => harnessStartIngest(request, clip),
    collectIngest: unsupported('Downloading'),
    // Deterministic stand-ins for a link's details and caption track, so the
    // URL tile's transcript rows can be clicked through (CLIPS.md §3b.8).
    ingestMeta: async (url: string) => harnessMeta(url),
    ingestCaptions: async (url: string, language: string) => harnessCaptions(url, language),
    ingestCaptionTrack: async (linkKey: string, key: string) => harnessCaptionTrack(linkKey, key),

    voiceStatus: async () => [
      { id: 'kokoro' as const, label: 'Kokoro (on this machine)', kind: 'local' as const, ready: false, reason: 'harness: no sidecar' },
      { id: 'hosted' as const, label: 'Hosted API', kind: 'hosted' as const, ready: false, reason: 'harness: no network' }
    ],
    voiceOptions: async () => [],
    speak: unsupported('Speech'),

    /*
     * The director, without a model.
     *
     * Status is honest — no server here — and settings round-trip in memory
     * so the panel's picker and key field can be exercised. `directorComplete`
     * is the one call that genuinely needs a model; the store falls back to
     * the deterministic baseline plan when it fails, which is the path worth
     * being able to click through in a browser.
     */
    directorStatus: async () => [
      { id: 'ollama' as const, label: 'Ollama (on this machine)', kind: 'local' as const, ready: false, reason: 'harness: no model server', models: [] },
      { id: 'openai' as const, label: 'Local server (LM Studio, llama.cpp)', kind: 'local' as const, ready: false, reason: 'harness: no model server' }
    ],
    directorModels: async () => [],
    directorSettings: async () => ({ ...harnessDirector, openai: { ...harnessDirector.openai } }),
    setDirectorSettings: async (patch: {
      provider?: 'auto' | 'ollama' | 'openai'
      ollama?: Partial<{ baseUrl: string; model: string }>
      openai?: Partial<{ baseUrl: string; apiKey: string; model: string }>
    }) => {
      if (patch.provider) harnessDirector.provider = patch.provider
      Object.assign(harnessDirector.ollama, patch.ollama ?? {})
      if (patch.openai?.baseUrl !== undefined) harnessDirector.openai.baseUrl = patch.openai.baseUrl
      if (patch.openai?.model !== undefined) harnessDirector.openai.model = patch.openai.model
      if (patch.openai?.apiKey !== undefined) harnessDirector.openai.hasKey = patch.openai.apiKey.length > 0
      return { ...harnessDirector, openai: { ...harnessDirector.openai } }
    },
    directorComplete: unsupported('Directing with a model'),

    transcribe: unsupported('Transcription'),
    cancelTranscribe: async () => undefined,
    sidecarStatus: async () => ({ state: 'failed' as const, error: 'harness: no sidecar' }),
    onTranscribeProgress: () => () => undefined,
    onSidecarStatus: () => () => undefined,

    startRender: unsupported('Exporting'),
    // Only the software H.264 the plan falls back to anyway.
    encoders: async () => [{ id: 'libx264' as const, ok: true }],
    cancelRender: async () => undefined,
    listJobs: async () => [],
    clearFinished: async () => undefined,
    graphicsSelfTest: async () => ({
      ok: false,
      transparentFraction: 0,
      opaqueFraction: 0,
      bytes: 0,
      message: 'harness: no frame server'
    }),

    chooseExportPath: async () => null,
    saveProject: async () => null,
    openProject: async () => null,
    revealPath: async () => undefined,
    openPath: async () => undefined,
    onJobsChanged: () => () => undefined,

    /*
     * Settings, held in memory for the session.
     *
     * Not faked as refusals like the render calls are: the app READS these
     * during startup, so a throw here takes the whole window down — which is
     * exactly what it did when they were missing and the App rendered into the
     * error boundary instead. Nothing is written to disk, which is the honest
     * limit; presets made here last as long as the page does.
     */
    getSettings: async () => ({ ...harnessSettings }),
    setSetting: async (key: string, value: unknown) => {
      harnessSettings[key] = value
      return { ...harnessSettings }
    },

    /*
     * Autosave and recovery: inert, by design.
     *
     * There is no main process to write a file or build a menu, and these are
     * all fire-and-forget from the renderer's side — so doing nothing is the
     * truthful answer rather than a refusal the caller would have to handle.
     * The menu's commands and full screen are kept (see `menuListeners`), so a
     * script can play the part of the main process.
     */
    autosaveProject: async () => null,
    recoveries: async () => [],
    recoverProject: async () => null,
    clearAutosave: async () => undefined,
    reportMenuState: () => undefined,
    rememberRecent: () => undefined,
    reportSaved: () => undefined,
    onMenuCommand: (cb: (command: string) => void) => {
      menuListeners.add(cb)
      return () => menuListeners.delete(cb)
    },
    onMenuOpen: () => () => undefined,
    onFullScreen: (cb: (on: boolean) => void) => {
      fullScreenListeners.add(cb)
      return () => fullScreenListeners.delete(cb)
    },
    // What the main process does: leave, then tell the window it has left.
    exitFullScreen: () => {
      if (fullScreenListeners.size > 0) sendFullScreen(false)
    },

    // The browser can open a microphone; only the main process can turn a
    // recording into a WAV, so saving a take is refused with a reason.
    microphonePermission: async () => true,
    saveVoiceOver: unsupported('Saving a voice-over')
  }

  window.forge = bridge as unknown as Window['forge']
  // The main process's half of the menu and of full screen, for a driving script.
  ;(window as unknown as { forgeMenu: (command: string) => void }).forgeMenu = sendMenuCommand
  ;(window as unknown as { forgeFullScreen: (on: boolean) => void }).forgeFullScreen = sendFullScreen
  // Readable from a driving script, which cannot see a module-scoped Map.
  ;(window as unknown as { forgeTitleFrames: Map<string, number> }).forgeTitleFrames = titleFrames
  ;(
    window as unknown as { forgeCaptionBake: { frames: number[]; list: { text: string } } }
  ).forgeCaptionBake = { frames: captionFrames, list: captionList }
  // The downloads asked for, with their argv (`harnessStartIngest`).
  ;(window as unknown as { forgeIngestLog: HarnessIngest[] }).forgeIngestLog = harnessIngests
}
