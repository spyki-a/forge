import { describe, expect, it } from 'vitest'
import { SHELF_TOOLS, shelfToolById } from '../../src/renderer/src/components/shelf/tools'
import { Director } from '../../src/renderer/src/components/Director'
import { IngestPanel } from '../../src/renderer/src/components/IngestPanel'
import { MediaPool } from '../../src/renderer/src/components/MediaPool'
import { TranscriptPanel } from '../../src/renderer/src/components/TranscriptPanel'
import { BeatSync } from '../../src/renderer/src/components/tools/BeatSync'
import { DepthParallax } from '../../src/renderer/src/components/tools/DepthParallax'
import { FilmStrip } from '../../src/renderer/src/components/tools/FilmStrip'
import { GridSplit } from '../../src/renderer/src/components/tools/GridSplit'
import { OnePhoto } from '../../src/renderer/src/components/tools/OnePhoto'
import { Props3d } from '../../src/renderer/src/components/tools/Props3d'
import { StripFlashes } from '../../src/renderer/src/components/tools/StripFlashes'
import { useEditor } from '../../src/renderer/src/store'

/**
 * The Shelf's registry as the app loads it (docs/WINDOW.md §3.2, §6 Step 9):
 * what each tile opens, what is coming soon, and when a tile is busy.
 *
 * The ids, the labels and their order are pinned from the source in
 * tests/shelfRegistry.test.ts — a node test, so it can sit beside the other
 * window tests; this half imports the registry, which needs the renderer's
 * project (JSX, the DOM types), so it lives under tests/renderer.
 */

describe('the Shelf registry, loaded', () => {
  it('gives every entry a component to open, an icon and a tooltip of its own', () => {
    expect(SHELF_TOOLS).toHaveLength(19)
    for (const tool of SHELF_TOOLS) {
      expect(typeof tool.panel, `${tool.id}: panel`).toBe('function')
      // A lucide icon is a forwardRef component: an object React can render.
      expect(['function', 'object'], `${tool.id}: icon`).toContain(typeof tool.icon)
      expect(tool.icon, `${tool.id}: icon`).toBeTruthy()
      expect(tool.hint.trim().length, `${tool.id}: hint`).toBeGreaterThan(10)
      expect(typeof tool.takesMedia, `${tool.id}: takesMedia`).toBe('boolean')
    }
    // Every tooltip its own: they are the tiles' census rows.
    expect(new Set(SHELF_TOOLS.map((tool) => tool.hint)).size).toBe(SHELF_TOOLS.length)
  })

  it('opens the source tiles on the panels that held them before the Shelf', () => {
    // Step 9's "nothing is lost": the pool, the link form and the transcript, whole.
    expect(shelfToolById('upload')?.panel).toBe(MediaPool)
    expect(shelfToolById('url')?.panel).toBe(IngestPanel)
    expect(shelfToolById('transcript')?.panel).toBe(TranscriptPanel)
  })

  it('opens each automation tile on its own tool’s panel', () => {
    // Step 10 split the Automation panel, which all eight opened in step 9:
    // each tile its own panel, and the Director tile the Director itself.
    // Spelled out pair by pair, so a swap names the tile it moved.
    const own = {
      director: Director,
      'depth-parallax': DepthParallax,
      'beat-sync': BeatSync,
      'one-photo': OnePhoto,
      'grid-split': GridSplit,
      'strip-flashes': StripFlashes,
      'film-strip': FilmStrip,
      'props-3d': Props3d
    } as const
    for (const [id, panel] of Object.entries(own) as [keyof typeof own, (typeof own)[keyof typeof own]][]) {
      expect(shelfToolById(id)?.panel, id).toBe(panel)
    }
    // Eight panels for eight tiles: none shared, none another tile's.
    const panels = Object.keys(own).map((id) => shelfToolById(id as keyof typeof own)?.panel)
    expect(new Set(panels).size).toBe(8)
    const elsewhere = SHELF_TOOLS.filter((tool) => !(tool.id in own)).map((tool) => tool.panel)
    expect(panels.filter((panel) => elsewhere.includes(panel as never))).toEqual([])
  })

  it('marks Narration, and only Narration, as coming soon — with what it will do', () => {
    expect(SHELF_TOOLS.filter((tool) => tool.soon !== undefined).map((tool) => tool.id)).toEqual(['narration'])
    const soon = shelfToolById('narration')?.soon ?? ''
    expect(soon).toContain('Topic and length in, narration and a cut out.')
    // The keys live in Settings now; "the only part … that needs paid services" went.
    expect(soon).not.toMatch(/paid services/)
  })

  it('reads busy from the store’s own flags, for the tools that run', () => {
    const base = useEditor.getState()
    const busy = (id: Parameters<typeof shelfToolById>[0], patch: Partial<typeof base>): boolean => {
      const tool = shelfToolById(id)
      expect(tool?.busy, `${id} has a busy selector`).toBeDefined()
      return tool!.busy!({ ...base, ...patch })
    }
    // Nothing under way in a fresh store.
    expect(SHELF_TOOLS.filter((tool) => tool.busy?.(base)).map((tool) => tool.id)).toEqual([])
    expect(busy('beat-sync', { reelBuilding: true })).toBe(true)
    expect(busy('one-photo', { reelBuilding: true })).toBe(true)
    expect(busy('grid-split', { gridBuilding: true })).toBe(true)
    expect(busy('strip-flashes', { stripsBuilding: true })).toBe(true)
    expect(busy('director', { directing: true })).toBe(true)
    expect(busy('depth-parallax', { baking: { a: { progress: null } } })).toBe(true)
    expect(busy('transcript', { transcribing: { a: { progress: 0.5 } } })).toBe(true)
    expect(busy('upload', { transcribing: { a: { progress: 0.5 } } })).toBe(true)
    // A download is busy while it runs, not once it has failed and been left in pendingIngests.
    const job = (status: 'running' | 'failed'): (typeof base)['jobs'][number] =>
      ({ id: 'dl', presetId: 'ingest', status }) as unknown as (typeof base)['jobs'][number]
    expect(busy('url', { jobs: [job('running')], pendingIngests: { dl: { projectPath: null } } })).toBe(true)
    expect(busy('url', { jobs: [job('failed')], pendingIngests: { dl: { projectPath: null } } })).toBe(false)
    // One flag does not light another tool.
    expect(busy('grid-split', { reelBuilding: true })).toBe(false)
  })
})
