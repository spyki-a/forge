import { describe, expect, it } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FoldDown, type FoldDownChoice } from '../../src/renderer/src/components/ui/FoldDown'

/*
 * The fold-down list (components/ui/FoldDown.tsx): the sketch's
 * "collapsable" — a button saying what is chosen, and its choices under it in
 * the flow, never floating over anything.
 *
 * Called as a function, its open state passed in as its owner will pass it,
 * and its buttons pressed by their own handlers: folded it is one button;
 * open, the choices are there; a choice calls back AND folds; Escape folds;
 * `aria-expanded` follows. Rendered to markup for what a person and a screen
 * reader get.
 */

type Props = Parameters<typeof FoldDown<number>>[0]

const LENGTHS: FoldDownChoice<number>[] = [
  { value: 60_000, label: '1 min' },
  { value: 120_000, label: '2 min' },
  { value: 180_000, label: '3 min', title: 'About three minutes' },
  { value: 240_000, label: '4 min' }
]

/** A FoldDown and a record of what it called back with. */
function made(open: boolean, value = 120_000): { props: Props; said: { open: boolean[]; chose: number[] } } {
  const said = { open: [] as boolean[], chose: [] as number[] }
  return {
    said,
    props: {
      id: 'length',
      label: 'Duration',
      value,
      choices: LENGTHS,
      open,
      onOpenChange: (next) => said.open.push(next),
      onChoose: (next) => said.chose.push(next)
    }
  }
}

/** Every element in a tree, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = []
  const visit = (at: ReactNode): void => {
    Children.forEach(at, (child) => {
      if (!isValidElement(child)) return
      const el = child as ReactElement<Record<string, unknown>>
      out.push(el)
      visit(el.props.children as ReactNode)
    })
  }
  visit(node)
  return out
}

const buttons = (node: ReactNode): ReactElement<Record<string, unknown>>[] => elements(node).filter((el) => el.type === 'button')
const textOf = (el: ReactElement<Record<string, unknown>>): string => renderToStaticMarkup(el).replace(/<[^>]+>/g, '')

describe('FoldDown', () => {
  it('folded: one button, saying what it chooses and what is chosen, aria-expanded false, no choices drawn', () => {
    const { props } = made(false)
    const tree = FoldDown(props)
    const all = buttons(tree)
    expect(all).toHaveLength(1)
    expect(all[0].props['aria-expanded']).toBe(false)
    expect(all[0].props['aria-controls']).toBe('fold-down-length')
    expect(textOf(all[0])).toBe('Duration2 min')
    const html = renderToStaticMarkup(tree as ReactElement)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-fold-down="length"')
    expect(html).not.toContain('1 min')
  })

  it('its button opens it', () => {
    const { props, said } = made(false)
    ;(buttons(FoldDown(props))[0].props.onClick as () => void)()
    expect(said.open).toEqual([true])
    expect(said.chose).toEqual([])
  })

  it('open: aria-expanded true and every choice under it in the flow, the chosen one pressed', () => {
    const { props } = made(true)
    const tree = FoldDown(props)
    const [head, ...choices] = buttons(tree)
    expect(head.props['aria-expanded']).toBe(true)
    expect(choices.map(textOf)).toEqual(['1 min', '2 min', '3 min', '4 min'])
    expect(choices.map((c) => c.props['aria-pressed'])).toEqual([false, true, false, false])
    expect(choices[2].props.title).toBe('About three minutes')
    // The list is the button's aria-controls, and sits in the flow: no fixed or absolute box.
    const html = renderToStaticMarkup(tree as ReactElement)
    expect(html).toContain('id="fold-down-length"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toMatch(/\b(?:fixed|absolute)\b/)
  })

  it('a choice calls back with its value and folds the list', () => {
    const { props, said } = made(true)
    const [, , , three] = buttons(FoldDown(props))
    ;(three.props.onClick as (e: unknown) => void)({ currentTarget: null })
    expect(said.chose).toEqual([180_000])
    expect(said.open).toEqual([false])
  })

  it('a choice or Escape puts the keyboard back on its button; Escape while folded leaves focus alone', () => {
    // The list unmounts under the focused choice; without this, focus falls to the
    // page and the next Tab starts again at the top of the window.
    const at = (): { event: { key: string; currentTarget: unknown; stopPropagation: () => void }; focused: string[] } => {
      const focused: string[] = []
      const head = { focus: () => focused.push('head') }
      const root = {
        querySelector: (sel: string) => (sel === ':scope > button[aria-expanded]' ? head : null)
      }
      const currentTarget = { closest: (sel: string) => (sel === '[data-fold-down]' ? root : null) }
      return { event: { key: 'Escape', currentTarget, stopPropagation: () => undefined }, focused }
    }
    const chose = at()
    const { props } = made(true)
    ;(buttons(FoldDown(props))[2].props.onClick as (e: unknown) => void)(chose.event)
    expect(chose.focused).toEqual(['head'])
    const escaped = at()
    ;(FoldDown(made(true).props) as ReactElement<{ onKeyDown: (e: unknown) => void }>).props.onKeyDown(escaped.event)
    expect(escaped.focused).toEqual(['head'])
    const folded = at()
    ;(FoldDown(made(false).props) as ReactElement<{ onKeyDown: (e: unknown) => void }>).props.onKeyDown(folded.event)
    expect(folded.focused).toEqual([])
  })

  it('puts the owner’s data attribute on every choice with its own value, and none without one', () => {
    // Best clips' lengths keep the data-best-length their four buttons carried (the harness finds them by it).
    const { props } = made(true)
    const [head, ...choices] = buttons(FoldDown({ ...props, choiceData: 'data-best-length' }))
    expect(choices.map((c) => c.props['data-best-length'])).toEqual(['60000', '120000', '180000', '240000'])
    expect(head.props['data-best-length']).toBeUndefined()
    for (const c of buttons(FoldDown(props))) expect(Object.keys(c.props).filter((k) => k.startsWith('data-'))).toEqual([])
  })

  it('its button pressed again folds it', () => {
    const { props, said } = made(true)
    ;(buttons(FoldDown(props))[0].props.onClick as () => void)()
    expect(said.open).toEqual([false])
  })

  it('Escape folds it, and is kept from the window; other keys, or Escape while folded, do nothing', () => {
    const press = (open: boolean, key: string): { said: { open: boolean[] }; stopped: boolean } => {
      const { props, said } = made(open)
      const root = FoldDown(props) as ReactElement<{ onKeyDown: (e: unknown) => void }>
      let stopped = false
      root.props.onKeyDown({ key, stopPropagation: () => (stopped = true) })
      return { said, stopped }
    }
    const escape = press(true, 'Escape')
    expect(escape.said.open).toEqual([false])
    expect(escape.stopped).toBe(true)
    expect(press(true, 'Enter').said.open).toEqual([])
    const folded = press(false, 'Escape')
    expect(folded.said.open).toEqual([])
    // Folded, Escape is the window's (leaving full screen).
    expect(folded.stopped).toBe(false)
  })

  it('every part is a real button, reached from the keyboard', () => {
    const { props } = made(true)
    for (const b of buttons(FoldDown(props))) {
      expect(b.props.type).toBe('button')
      expect(b.props.tabIndex).toBeUndefined()
    }
  })

  it('wears no transform, filter or backdrop-filter, folded or open', () => {
    // The full-window pickers are fixed; any of these would trap them (ui/Strip.tsx).
    const TRAPS = /(?:^|\s)(?:[a-z-]+:)*-?(?:transform|filter|backdrop-[\w-]+|scale-[\w./-]+|translate-[\w./-]+|rotate-[\w./-]+|blur(?:-[\w-]+)?)(?=\s|$)/
    for (const open of [false, true]) {
      const html = renderToStaticMarkup(FoldDown(made(open).props) as ReactElement)
      for (const [, cls] of html.matchAll(/class="([^"]*)"/g)) expect(cls).not.toMatch(TRAPS)
    }
  })
})
