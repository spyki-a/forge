import { type ReactNode } from 'react'
import { Contrast, Newspaper, Orbit, Palette, Type, type LucideIcon } from 'lucide-react'
import { useEditor } from '../../store'
import { Library } from '../Library'
import { BigButton } from '../ui/Tile'

/**
 * The Shelf's smaller panels — the ones that are not a whole component of
 * their own already (docs/WINDOW.md §3.5, §3.6, §3.14).
 *
 * Step 9 gives every tile somewhere to open, so that nothing the left panel
 * and the source row held is lost when they go: the Narration tile its
 * coming-soon words, the Library and Transitions tiles the Library on the
 * right drawer, and each one-click tool the Add button that sat above the
 * media grid with one line on what it makes. Step 11 fills these out. The
 * automation tools' panels are components of their own (components/tools/,
 * step 10), and the Director tile opens Director itself.
 */

/**
 * What Narration will do, said rather than pretended: an entry point that
 * quietly does nothing is the thing that made half this app feel broken.
 * It used to end "The only part of the app that needs paid services" — not
 * true once its keys live in Settings like the rest.
 */
export const NARRATION_SOON =
  'Topic and length in, narration and a cut out. The keys it will use — a hosted voice, Pexels — are in Settings, top right.'

export function NarrationPanel(): ReactNode {
  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] leading-snug text-ink-400">{NARRATION_SOON}</p>
      <span className="inline-block rounded bg-ink-850 px-1.5 py-0.5 text-[10px] text-ink-600">not built yet</span>
    </div>
  )
}

/** The Library tile: the whole library, opening on Stickers. */
export function LibraryPanel(): ReactNode {
  return <Library initialKind="sticker" />
}

/**
 * The Transitions tile: the Library, opened on its Transitions drawer. The
 * chip stays in the Library too; a transition is applied by dragging it onto
 * a clip, and its length and family are in the Trimmer once that clip is
 * selected (Transition in).
 */
export function TransitionsPanel(): ReactNode {
  return <Library initialKind="transition" />
}

/* ------------------------------------------------------- one-click tools */

/** The highest unlocked video track: text and cards belong on top of the picture. */
function useTopVideoTrack(): string {
  return useEditor((s) => {
    const video = s.project.tracks.filter((t) => t.kind === 'video' && !t.locked)
    return video[video.length - 1]?.id ?? ''
  })
}

type Adder = 'addTextClip' | 'addSolidClip' | 'addAdjustmentLayer' | 'addPaperClip' | 'addCarouselClip'

/**
 * One Add button and what it makes. The labels are the ones the buttons wore
 * above the media grid, so they read the same where they went; the clip lands
 * at the playhead on the top video track, and its editor is in the Trimmer
 * dock, which opens on it.
 */
function OneClick({
  icon,
  add,
  label,
  what
}: {
  icon: LucideIcon
  add: Adder
  label: string
  what: string
}): ReactNode {
  const adder = useEditor((s) => s[add])
  const playhead = useEditor((s) => s.playhead)
  const track = useTopVideoTrack()
  return (
    <div className="space-y-2.5 p-3">
      <BigButton icon={icon} onClick={() => void adder(track, playhead)} className="w-full">
        {label}
      </BigButton>
      <p className="text-[10.5px] leading-snug text-ink-500">{what}</p>
    </div>
  )
}

/*
 * Creating text was impossible before `+ Text`: titles needed an SVG template
 * with placeholders in it, so there was nothing to write a word with — and
 * therefore nothing to put behind a subject.
 */
export function TextPanel(): ReactNode {
  return (
    <OneClick
      icon={Type}
      add="addTextClip"
      label="+ Text"
      what="A card of your own words at the playhead, over the picture. Its words, font and style are in the Trimmer below; title templates are in the Library, under Titles."
    />
  )
}

export function ColourCardsPanel(): ReactNode {
  return (
    <OneClick
      icon={Palette}
      add="addSolidClip"
      label="+ Colour"
      what="A flat card of colour — for text to sit on, or as a wash between shots."
    />
  )
}

export function GradePanel(): ReactNode {
  return (
    <OneClick
      icon={Contrast}
      add="addAdjustmentLayer"
      label="+ Grade"
      what="An adjustment layer: it grades everything on the tracks below it, for as long as it runs."
    />
  )
}

export function NewspaperPanel(): ReactNode {
  return (
    <OneClick
      icon={Newspaper}
      add="addPaperClip"
      label="+ Newspaper clippings"
      what="A word highlighted across a run of torn newspaper clippings, over your footage."
    />
  )
}

export function CardRingPanel(): ReactNode {
  return (
    <OneClick
      icon={Orbit}
      add="addCarouselClip"
      label="+ Card ring"
      what="Your photographs on a rotating ring, in 3D — the first twelve photos in Upload."
    />
  )
}
