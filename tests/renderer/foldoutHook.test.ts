import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDOUT_MIN, FOLDOUT_OPEN, FOLDOUT_START } from '@shared/foldout'

/*
 * `useFoldoutPanel` (components/Foldout.tsx): the fold-out's Panel and the
 * store's `foldout.open`, kept in step both ways, the Curve tray's way.
 *
 * There is no DOM here, so React's three hooks it uses are stood in for —
 * `useEffect` runs at once and keeps its cleanup, `useRef` is a box,
 * `useCallback` is the function — and the library's `usePanelRef` hands back
 * a fake Panel with a width. Then the hook is called as a function, and the
 * real store drives it: the store opening it expands the Panel, the store
 * shutting it collapses it, and a resize to nothing writes the store shut.
 */

const cleanups: (() => void)[] = []

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  return {
    ...real,
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    useRef: <T,>(value: T) => ({ current: value }),
    useCallback: <T,>(fn: T) => fn
  }
})

interface Fake {
  width: number
  calls: string[]
  isCollapsed: () => boolean
  resize: (size: number | string) => void
  collapse: () => void
}

const fake: { current: Fake | null } = { current: null }

vi.mock('react-resizable-panels', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-resizable-panels')>()
  return { ...real, usePanelRef: () => fake }
})

const { useEditor } = await import('../../src/renderer/src/store')
const { useFoldoutPanel } = await import('../../src/renderer/src/components/Foldout')

/** A Panel `room` px could hold: collapsed at 0, and refusing to open where 280 px does not fit. */
function panel(room = 1000): Fake {
  const p: Fake = {
    width: 0,
    calls: [],
    isCollapsed: () => p.width === 0,
    resize: (size) => {
      p.calls.push(`resize(${size})`)
      if (room >= FOLDOUT_MIN) p.width = typeof size === 'number' ? size : (parseFloat(size) / 100) * room
    },
    collapse: () => {
      p.calls.push('collapse()')
      p.width = 0
    }
  }
  return p
}

beforeEach(() => {
  useEditor.setState({ foldout: FOLDOUT_START })
})

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  fake.current = null
})

describe('useFoldoutPanel', () => {
  it('the store opening the panel expands it, at 40 % the first time; shutting it collapses it', () => {
    fake.current = panel(1000)
    useFoldoutPanel()
    expect(fake.current.calls).toEqual([])
    useEditor.getState().openFoldout('clips')
    expect(fake.current.calls).toEqual([`resize(${FOLDOUT_OPEN})`])
    expect(fake.current.width).toBe(400)
    // Switching tabs is not an open: the Panel is left where it is.
    useEditor.getState().openFoldout('transcript')
    expect(fake.current.calls).toHaveLength(1)
    useEditor.getState().closeFoldout()
    expect(fake.current.calls).toEqual([`resize(${FOLDOUT_OPEN})`, 'collapse()'])
    expect(fake.current.width).toBe(0)
  })

  it('a resize to zero writes the store shut, keeping the tab', () => {
    fake.current = panel(1000)
    const { onResize } = useFoldoutPanel()
    useEditor.getState().openFoldout('transcript', 'clip')
    onResize({ inPixels: 0, asPercentage: 0 })
    expect(useEditor.getState().foldout).toEqual({ open: false, tab: 'transcript', words: 'clip' })
  })

  it('a drag shut and back open in one go keeps the tab it was on', () => {
    // The library keeps an active drag's hit region after the divider turns
    // disabled, so one drag can pull the panel shut and then open again.
    fake.current = panel(1000)
    const { onResize } = useFoldoutPanel()
    useEditor.getState().openFoldout('transcript', 'clip')
    onResize({ inPixels: 0, asPercentage: 0 })
    expect(useEditor.getState().foldout.open).toBe(false)
    onResize({ inPixels: 400, asPercentage: 40 })
    expect(useEditor.getState().foldout).toEqual({ open: true, tab: 'transcript', words: 'clip' })
  })

  it('reopens where a drag left it, as its share of the row', () => {
    fake.current = panel(1000)
    const { onResize } = useFoldoutPanel()
    useEditor.getState().openFoldout('clips')
    // A drag to 52.5 %, then shut and open again.
    onResize({ inPixels: 525, asPercentage: 52.5 })
    expect(useEditor.getState().foldout.open).toBe(true)
    useEditor.getState().closeFoldout()
    useEditor.getState().openFoldout('clips')
    expect(fake.current.calls.at(-1)).toBe('resize(52.5%)')
  })

  it('an open panel resized wider leaves the store as it is', () => {
    fake.current = panel(1000)
    const { onResize } = useFoldoutPanel()
    useEditor.getState().openFoldout('clips')
    const before = useEditor.getState().foldout
    onResize({ inPixels: 450, asPercentage: 45 })
    expect(useEditor.getState().foldout).toBe(before)
  })

  it('with no room for it the store is written shut, rather than an open panel drawn in nothing', () => {
    fake.current = panel(200)
    useFoldoutPanel()
    useEditor.getState().openFoldout('clips')
    expect(fake.current.isCollapsed()).toBe(true)
    expect(useEditor.getState().foldout.open).toBe(false)
  })
})
