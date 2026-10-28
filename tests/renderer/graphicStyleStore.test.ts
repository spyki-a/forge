import { describe, it, expect } from 'vitest'
import { graphicStyleOf } from '@shared/graphics/style'
import { emptyProject, type GraphicsSettings } from '@shared/timeline'
import { useEditor } from '../../src/renderer/src/store'

/*
 * The graphic style's two store actions (docs/CLIPS.md §6.5), the captions'
 * setters' twins. Here, as tests/renderer/keyStore.test.ts is, because the
 * store is renderer code.
 */

const graphics = (): GraphicsSettings | undefined => useEditor.getState().project.graphics
const history = (): number => useEditor.getState().past.length

function start(settings?: GraphicsSettings): void {
  useEditor.setState({ project: { ...emptyProject(), ...(settings ? { graphics: settings } : {}) }, past: [], future: [] })
}

describe('setGraphicsStyle', () => {
  it('on a project with no graphics: the style, no overrides, sounds on; one undo, which takes it back off', () => {
    start()
    expect(graphics()).toBeUndefined()
    useEditor.getState().setGraphicsStyle('clean')
    expect(graphics()).toEqual({ styleId: 'clean', overrides: {}, sound: true })
    expect(history()).toBe(1)
    useEditor.getState().undo()
    expect(graphics()).toBeUndefined()
  })

  it('keeps the text style and the accent colour and the sounds switch, and drops the rest', () => {
    start({
      styleId: 'clean',
      overrides: { textStyleId: 'outline', 'palette.accent': '#2563EB', radius: 0.05, 'motion.ease': 'linear' },
      sound: false
    })
    useEditor.getState().setGraphicsStyle('bold')
    expect(graphics()).toEqual({
      styleId: 'bold',
      overrides: { textStyleId: 'outline', 'palette.accent': '#2563EB' },
      sound: false
    })
    expect(history()).toBe(1)
  })
})

describe('setGraphicsOverride', () => {
  it('writes one key at a time on clean with sounds on, keeps the others, and removes a key set to undefined; one undo each', () => {
    start()
    useEditor.getState().setGraphicsOverride('palette.accent', '#2563EB')
    expect(graphics()).toEqual({ styleId: 'clean', overrides: { 'palette.accent': '#2563EB' }, sound: true })
    useEditor.getState().setGraphicsOverride('radius', 0.05)
    expect(graphics()?.overrides).toEqual({ 'palette.accent': '#2563EB', radius: 0.05 })
    // What the export and the preview will draw with.
    const style = graphicStyleOf(useEditor.getState().project, {})
    expect(style.palette.accent).toBe('#2563EB')
    expect(style.radius).toBe(0.05)

    useEditor.getState().setGraphicsOverride('radius', undefined)
    // Gone, not present-and-empty: the captions' Reset button sat lit over that.
    expect('radius' in (graphics()?.overrides ?? {})).toBe(false)
    expect(graphics()?.overrides).toEqual({ 'palette.accent': '#2563EB' })
    expect(history()).toBe(3)
    useEditor.getState().undo()
    expect(graphics()?.overrides).toEqual({ 'palette.accent': '#2563EB', radius: 0.05 })
  })

  it('leaves the project’s style and its sounds switch alone', () => {
    start({ styleId: 'editorial', overrides: {}, sound: false })
    useEditor.getState().setGraphicsOverride('dim', true)
    expect(graphics()).toEqual({ styleId: 'editorial', overrides: { dim: true }, sound: false })
  })
})
