import type { ComponentType } from 'react'
import {
  Box,
  Clapperboard,
  Contrast,
  Film,
  Grid3x3,
  ImageIcon,
  Layers,
  Library as LibraryIcon,
  Link2,
  Music,
  Newspaper,
  Orbit,
  Palette,
  ScrollText,
  Shuffle,
  Sparkles,
  Type,
  Upload,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ShelfToolId, useEditor } from '../../store'
import { Director } from '../Director'
import { IngestPanel } from '../IngestPanel'
import { MediaPool } from '../MediaPool'
import { TranscriptPanel } from '../TranscriptPanel'
import { BeatSync } from '../tools/BeatSync'
import { DepthParallax } from '../tools/DepthParallax'
import { FilmStrip } from '../tools/FilmStrip'
import { GridSplit } from '../tools/GridSplit'
import { OnePhoto } from '../tools/OnePhoto'
import { Props3d } from '../tools/Props3d'
import { StripFlashes } from '../tools/StripFlashes'
import {
  CardRingPanel,
  ColourCardsPanel,
  GradePanel,
  LibraryPanel,
  NARRATION_SOON,
  NarrationPanel,
  NewspaperPanel,
  TextPanel,
  TransitionsPanel
} from './panels'

/**
 * The Shelf's tools: one tile each on the home grid, and the panel the tile
 * opens (docs/WINDOW.md §2, §3.2–3.14, §6 Step 9).
 *
 * In the sketch's order, row by row — the user's "order yes" (sheet 20):
 *   Upload · URL · Narration · Library
 *   Transcript · Director · Depth / Parallax · Beat sync / Cut to words
 *   Transitions · One photo · Grid split · Strip flashes
 *   Film strip · 3D props · Text · Colour cards
 *   Grade · Newspaper clipping · Card ring
 * The grid reflows to three a row in the 240 px column, but the reading order
 * stays this one (tests/shelfRegistry.test.ts pins it). The labels are the
 * sketch's words.
 *
 * Every tool that exists keeps its own panel inside its tile — its "inside
 * job". Step 9 had the eight automation tiles all open the whole Automation
 * panel; step 10 split it into one panel per tool (components/tools/, and the
 * Director tile mounts Director itself), each opening on its own header under
 * the Shelf's. Step 11 fills out the one-click ones.
 *
 * The user calls this panel the "sidecar"; the code says Shelf, because the
 * sidecar in code and docs is the Python helper (WINDOW.md §1).
 */

/** The store's state, as a busy selector reads it. */
type Editor = ReturnType<typeof useEditor.getState>

export interface ShelfTool {
  id: ShelfToolId
  /** The sketch's words, on the tile and in the open tool's header. */
  label: string
  icon: LucideIcon
  /** One line on what the tool is for: the tile's tooltip. */
  hint: string
  /** What the tile opens, inside its own error boundary (Shelf.tsx). */
  panel: ComponentType
  /**
   * The tool works on media the user brings — photos, a clip, music — so its
   * panel will start with where that comes from (the "Uses:" line, step 12).
   */
  takesMedia: boolean
  /** Not built yet: what it will do. The tile says "soon" and the panel says this. */
  soon?: string
  /**
   * Whether a run this tool started is under way, from the store's own flags,
   * so the tile shows it from the home grid. Absent where the tool has no
   * long-running work.
   */
  busy?: (state: Editor) => boolean
}

const any = (record: Record<string, unknown>): boolean => Object.keys(record).length > 0

/**
 * A download this window asked for, still on its way — the same jobs the URL
 * panel's "N downloads running" line counts (IngestPanel.tsx). Not
 * `pendingIngests` alone: a download that failed or was cancelled stays in it
 * until something collects it, which nothing will.
 */
const downloading = (s: Editor): boolean =>
  s.jobs.some((job) => Boolean(s.pendingIngests[job.id]) && (job.status === 'running' || job.status === 'queued'))

export const SHELF_TOOLS: readonly ShelfTool[] = [
  /* row 1 — where material comes from, and the library */
  {
    id: 'upload',
    label: 'Upload',
    icon: Upload,
    hint: 'Photos, video and music from this machine',
    panel: MediaPool,
    takesMedia: false,
    // The pool's own runs: its Transcribe chips.
    busy: (s) => any(s.transcribing)
  },
  {
    id: 'url',
    label: 'URL',
    icon: Link2,
    hint: 'Paste a link, choose the quality, take the video or just the audio',
    panel: IngestPanel,
    takesMedia: false,
    busy: downloading
  },
  {
    id: 'narration',
    label: 'Narration',
    icon: Clapperboard,
    hint: 'Give a topic; the edit is written and assembled for you',
    panel: NarrationPanel,
    takesMedia: false,
    soon: NARRATION_SOON
  },
  {
    id: 'library',
    label: 'Library',
    icon: LibraryIcon,
    hint: 'Stickers, props, transitions, titles, sounds and fonts — and packs of more',
    panel: LibraryPanel,
    takesMedia: false
  },

  /* row 2 */
  {
    id: 'transcript',
    label: 'Transcript',
    icon: ScrollText,
    hint: 'The words spoken in the selected clip — click to jump, correct a misheard one',
    panel: TranscriptPanel,
    takesMedia: false,
    busy: (s) => any(s.transcribing)
  },
  {
    id: 'director',
    label: 'Director',
    icon: Sparkles,
    hint: 'Describe the product; a whole ad is cut from your pictures',
    panel: Director,
    takesMedia: true,
    busy: (s) => s.directing
  },
  {
    id: 'depth-parallax',
    label: 'Depth / Parallax',
    icon: Layers,
    hint: 'Photos cut into depth planes that move apart as the camera drifts',
    panel: DepthParallax,
    takesMedia: true,
    busy: (s) => any(s.baking)
  },
  {
    id: 'beat-sync',
    label: 'Beat sync / Cut to words',
    icon: Music,
    hint: 'Your photos cut to the music’s beats — or to the words of the song',
    panel: BeatSync,
    takesMedia: true,
    busy: (s) => s.reelBuilding
  },

  /* row 3 */
  {
    id: 'transitions',
    label: 'Transitions',
    icon: Shuffle,
    hint: 'Wipes and blends to drag onto a clip',
    panel: TransitionsPanel,
    takesMedia: false
  },
  {
    id: 'one-photo',
    label: 'One photo',
    icon: ImageIcon,
    hint: 'A whole reel from a single photo and a caption',
    panel: OnePhoto,
    takesMedia: true,
    // The same reel machinery as Beat sync, so the same flag.
    busy: (s) => s.reelBuilding
  },
  {
    id: 'grid-split',
    label: 'Grid split',
    icon: Grid3x3,
    hint: 'A photo broken into pieces that land one by one',
    panel: GridSplit,
    takesMedia: true,
    busy: (s) => s.gridBuilding
  },
  {
    id: 'strip-flashes',
    label: 'Strip flashes',
    icon: Zap,
    hint: 'Slices of a shot that flash on the beat',
    panel: StripFlashes,
    takesMedia: true,
    busy: (s) => s.stripsBuilding
  },

  /* row 4 */
  {
    id: 'film-strip',
    label: 'Film strip',
    icon: Film,
    hint: 'Your photos as frames on a running film strip',
    panel: FilmStrip,
    takesMedia: true
  },
  {
    id: 'props-3d',
    label: '3D props',
    icon: Box,
    hint: '3D props that pop up on the words they are named by',
    panel: Props3d,
    takesMedia: false
  },
  {
    id: 'text',
    label: 'Text',
    icon: Type,
    hint: 'A card of your own words over the picture',
    panel: TextPanel,
    takesMedia: false
  },
  {
    id: 'colour-cards',
    label: 'Colour cards',
    icon: Palette,
    hint: 'A flat card of colour, to write on or wash between shots',
    panel: ColourCardsPanel,
    takesMedia: false
  },

  /* row 5 */
  {
    id: 'grade',
    label: 'Grade',
    icon: Contrast,
    hint: 'A grade over everything on the tracks below it',
    panel: GradePanel,
    takesMedia: false
  },
  {
    id: 'newspaper',
    label: 'Newspaper clipping',
    icon: Newspaper,
    hint: 'A word highlighted across torn newspaper clippings',
    panel: NewspaperPanel,
    takesMedia: false
  },
  {
    id: 'card-ring',
    label: 'Card ring',
    icon: Orbit,
    hint: 'Your photographs on a rotating ring, in 3D',
    panel: CardRingPanel,
    takesMedia: true
  }
]

/** The tool with this id, or null for an id the registry does not have. */
export function shelfToolById(id: ShelfToolId): ShelfTool | null {
  return SHELF_TOOLS.find((tool) => tool.id === id) ?? null
}
