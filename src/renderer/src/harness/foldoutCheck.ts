/**
 * The fold-out panel beside the picture, opened, switched, dragged-free and
 * closed on the page, and measured (the clip maker's layout, piece 1):
 *
 *   await window.__forgeFoldoutCheck()   → { ok, cases: [{ name, pass, detail }], measured }
 *
 * What only a page can say: that the Panel follows the store to a real width
 * and back to none, that the divider is there to grab only while the panel is
 * open, that the picture shrinks beside the panel and keeps its share, that
 * nothing in the panel runs out of it, that no ancestor of it makes a
 * containing block for the full-window pickers — and the one that matters
 * most, that the Preview's canvas is the SAME element after an open, a switch
 * and a close: it never remounted (its rAF loop is the playback clock).
 *
 * Driven through the store, as the panel's own buttons drive it. It puts the
 * page's panel back as it found it, and its last case says whether it did.
 */

import { FOLDOUT_MAX, FOLDOUT_MIN, PICTURE_MIN, type FoldoutState } from '@shared/foldout'
import { useEditor } from '../store'

export interface FoldoutCheckCase {
  name: string
  pass: boolean
  detail: string
}

export interface FoldoutCheckResult {
  ok: boolean
  cases: FoldoutCheckCase[]
  /** Pixels, read off the page: the row, and the panel and the picture open. */
  measured: { row: number; panel: number; picture: number; share: number }
}

/** The cases, in the order they run: what the session reads back when all is well, every one passing. */
export const FOLDOUT_CHECK_CASES = [
  'shut: no width, nothing drawn, divider disabled',
  'open on Clips: within its bounds, the picture keeps its share',
  'open: divider live, body scrolls inside, nothing runs out',
  'no transform, filter or backdrop-filter around it',
  'switch to Transcript',
  'shut again',
  'the Preview never remounted',
  'put back as found'
] as const

const frames = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))

const share = (value: string): number => parseFloat(value) / 100

function parts(): { root: HTMLElement; panel: HTMLElement; separator: HTMLElement | null; picture: HTMLElement | null; row: HTMLElement } {
  const roots = document.querySelectorAll<HTMLElement>('[data-foldout]')
  if (roots.length !== 1) throw new Error(`${roots.length} [data-foldout] on the page`)
  const root = roots[0]
  const panel = root.closest<HTMLElement>('[data-panel]')
  const row = panel?.parentElement ?? null
  if (!panel || !row || !row.matches('[data-group]')) throw new Error('the fold-out panel is not in a panel group')
  const separator = panel.nextElementSibling?.matches('[role="separator"]') ? (panel.nextElementSibling as HTMLElement) : null
  const picture = (separator ?? panel).nextElementSibling as HTMLElement | null
  return { root, panel, separator, picture, row }
}

async function until(test: () => boolean, ms = 2000): Promise<boolean> {
  const deadline = performance.now() + ms
  for (;;) {
    await frames()
    if (test()) return true
    if (performance.now() > deadline) return false
  }
}

export async function runFoldoutCheck(): Promise<FoldoutCheckResult> {
  const cases: FoldoutCheckCase[] = []
  const add = (name: string, pass: boolean, detail: string): void => void cases.push({ name, pass, detail })
  const measured = { row: 0, panel: 0, picture: 0, share: 0 }
  const before: FoldoutState = useEditor.getState().foldout
  const store = useEditor.getState
  const width = (el: Element | null): number => el?.getBoundingClientRect().width ?? -1

  const canvases = document.querySelectorAll('canvas[data-forge-preview="1"]')
  const canvas = canvases[0] ?? null

  try {
    store().closeFoldout()
    await until(() => width(parts().panel) <= 0.5)
    {
      const p = parts()
      const ok = width(p.panel) <= 0.5 && p.root.getAttribute('data-foldout') === 'shut' && p.root.childElementCount === 0 &&
        p.separator?.getAttribute('aria-disabled') === 'true' && width(p.separator) <= 0.5
      add(FOLDOUT_CHECK_CASES[0], ok, `panel ${width(p.panel)} px, root ${p.root.getAttribute('data-foldout')} with ${p.root.childElementCount} children, divider aria-disabled ${p.separator?.getAttribute('aria-disabled')} at ${width(p.separator)} px`)
    }

    store().openFoldout('clips')
    await until(() => width(parts().panel) >= FOLDOUT_MIN - 2 && parts().root.getAttribute('data-foldout') === 'clips')
    {
      const p = parts()
      measured.row = Math.round(width(p.row))
      measured.panel = Math.round(width(p.panel))
      measured.picture = Math.round(width(p.picture))
      measured.share = Math.round((width(p.panel) / width(p.row)) * 1000) / 10
      const ok = width(p.panel) >= FOLDOUT_MIN - 1 && width(p.panel) <= share(FOLDOUT_MAX) * width(p.row) + 1 &&
        width(p.picture) >= share(PICTURE_MIN) * width(p.row) - 1 && store().foldout.open
      add(FOLDOUT_CHECK_CASES[1], ok, `row ${measured.row} px: panel ${measured.panel} px (${measured.share} %), picture ${measured.picture} px`)

      const body = p.root.querySelector<HTMLElement>('[data-foldout-body]')
      const box = p.panel.getBoundingClientRect()
      const outside = [...p.root.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5)
      })
      const scrolls = body ? getComputedStyle(body).overflowY === 'auto' : false
      const sideways = body ? body.scrollWidth - body.clientWidth : -1
      const live = p.separator !== null && p.separator.getAttribute('aria-disabled') === null && width(p.separator) >= 0.5
      add(FOLDOUT_CHECK_CASES[2], live && scrolls && sideways <= 0 && outside.length === 0,
        `divider aria-disabled ${p.separator?.getAttribute('aria-disabled')} at ${width(p.separator)} px; body overflow-y ${body ? getComputedStyle(body).overflowY : 'none'}, ${sideways} px sideways; ${outside.length} elements outside the panel`)

      const traps: string[] = []
      for (let at: Element | null = p.root; at && at !== document.documentElement; at = at.parentElement) {
        const s = getComputedStyle(at)
        if (s.transform !== 'none' || s.filter !== 'none' || (s.backdropFilter && s.backdropFilter !== 'none')) traps.push(at.tagName.toLowerCase())
      }
      add(FOLDOUT_CHECK_CASES[3], traps.length === 0, traps.length ? `on ${traps.join(', ')}` : 'none')
    }

    store().openFoldout('transcript')
    const switched = await until(() => parts().root.getAttribute('data-foldout') === 'transcript')
    add(FOLDOUT_CHECK_CASES[4], switched && width(parts().panel) >= FOLDOUT_MIN - 2, `shows ${parts().root.getAttribute('data-foldout')} at ${Math.round(width(parts().panel))} px`)

    store().closeFoldout()
    const shut = await until(() => width(parts().panel) <= 0.5)
    add(FOLDOUT_CHECK_CASES[5], shut && parts().root.getAttribute('data-foldout') === 'shut', `${Math.round(width(parts().panel))} px`)

    const now = document.querySelectorAll('canvas[data-forge-preview="1"]')
    add(FOLDOUT_CHECK_CASES[6], canvases.length === 1 && now.length === 1 && now[0] === canvas && canvas.isConnected,
      `${canvases.length} canvas before, ${now.length} after, same element: ${now[0] === canvas}`)
  } catch (err) {
    add('ran to the end', false, err instanceof Error ? err.message : String(err))
  } finally {
    useEditor.setState({ foldout: before })
    await frames()
    const back = useEditor.getState().foldout
    add(FOLDOUT_CHECK_CASES[7], back.open === before.open && back.tab === before.tab && back.words === before.words, JSON.stringify(back))
  }
  return { ok: cases.every((c) => c.pass) && cases.length === FOLDOUT_CHECK_CASES.length, cases, measured }
}

export function installFoldoutCheck(): void {
  ;(window as unknown as { __forgeFoldoutCheck: () => Promise<FoldoutCheckResult> }).__forgeFoldoutCheck = runFoldoutCheck
}
