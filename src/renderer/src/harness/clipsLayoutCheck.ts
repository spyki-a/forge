/**
 * Best clips' two parts measured where they are now, on the page (the clip
 * maker's layout, piece 2): what jsdom cannot say about widths.
 *
 *   window.__forgeClipsLayout()   → { ok, left, tab, problems }
 *
 * It changes nothing: the session stands the state up (a link with words in
 * the URL tile, Analyse pressed, the panel open on Clips), sets the widths it
 * wants to look at — the left column at its 240 px floor, the panel at its
 * 280 px floor, then wide — and reads this back each time.
 *
 * - LEFT: the URL tile's Best clips section. Nothing in it reaches past the
 *   section's right edge, and the Shelf's panel does not scroll sideways.
 * - TAB: the fold-out's Clips tab. Nothing in it reaches past the tab's right
 *   edge, the tab does not scroll sideways, no card title is cut, and every
 *   card is at least 15rem (240 px) wide, or as wide as the tab when the tab
 *   is narrower; `perRow` says how many cards sit on the first row.
 *
 * WHEN ALL IS WELL: `ok: true`, `problems: []`; at a 280 px panel `perRow` 1,
 * and at a panel of 520 px or more `perRow` 2 or more (when there are two or
 * more cards). A part that is not on screen is reported as null, and is a
 * problem only for the part the session asked to see (both, by default).
 */

export interface ClipsLayout {
  ok: boolean
  left: { width: number; sideways: boolean; past: string[] } | null
  tab: { width: number; sideways: boolean; past: string[]; cards: number[]; perRow: number; titlesCut: number } | null
  problems: string[]
}

/** 15rem, the grid's floor for a card (tools/BestClips.tsx). */
const CARD_MIN = 240

const round = (n: number): number => Math.round(n * 10) / 10

/** A short name for an element in a report: its tag, its data- attributes. */
function nameOf(el: Element): string {
  const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `${a.name}${a.value ? `=${a.value}` : ''}`)
  const text = (el.textContent ?? '').trim().slice(0, 24)
  return `${el.tagName.toLowerCase()}${data.length ? `[${data.join(' ')}]` : ''}${text ? ` "${text}"` : ''}`
}

/** Every element inside `root` whose box reaches past `root`'s right edge (half a pixel of rounding allowed). */
function pastRight(root: Element): string[] {
  const edge = root.getBoundingClientRect().right + 0.5
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    const box = el.getBoundingClientRect()
    if (box.width > 0 && box.right > edge) out.push(`${nameOf(el)} by ${round(box.right - edge + 0.5)} px`)
  }
  return out
}

export function measureClipsLayout(want: { left?: boolean; tab?: boolean } = {}): ClipsLayout {
  const problems: string[] = []
  const wantLeft = want.left ?? true
  const wantTab = want.tab ?? true

  let left: ClipsLayout['left'] = null
  const section = document.querySelector('[data-shelf-tool="url"] [data-shelf-panel] [data-best-clips]')
  if (section) {
    const shelf = section.closest('[data-shelf-panel]') as HTMLElement
    left = { width: round(section.getBoundingClientRect().width), sideways: shelf.scrollWidth > shelf.clientWidth + 1, past: pastRight(section) }
    if (left.sideways) problems.push(`the URL tile scrolls sideways (${shelf.scrollWidth} in ${shelf.clientWidth})`)
    for (const p of left.past) problems.push(`left: ${p}`)
  } else if (wantLeft) problems.push('no Best clips section in the URL tile (open the URL tile with a link in the box)')

  let tab: ClipsLayout['tab'] = null
  const body = document.querySelector<HTMLElement>('[data-foldout-body="clips"]')
  const inner = body?.querySelector('[data-best-clips-tab]') ?? null
  if (body && inner) {
    const width = inner.getBoundingClientRect().width
    const cards = [...inner.querySelectorAll('li[data-best-card]')].map((li) => li.getBoundingClientRect())
    const top = cards.length > 0 ? cards[0].top : 0
    const titles = [...inner.querySelectorAll<HTMLElement>('[data-card-title]')]
    tab = {
      width: round(width),
      sideways: body.scrollWidth > body.clientWidth + 1,
      past: pastRight(inner),
      cards: cards.map((box) => round(box.width)),
      perRow: cards.filter((box) => Math.abs(box.top - top) < 1).length,
      titlesCut: titles.filter((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).length
    }
    if (tab.sideways) problems.push(`the Clips tab scrolls sideways (${body.scrollWidth} in ${body.clientWidth})`)
    for (const p of tab.past) problems.push(`tab: ${p}`)
    if (tab.titlesCut > 0) problems.push(`${tab.titlesCut} card titles are cut`)
    for (const w of tab.cards) if (w + 0.5 < Math.min(CARD_MIN, width)) problems.push(`a card is ${w} px wide, under ${Math.min(CARD_MIN, round(width))}`)
  } else if (wantTab) problems.push('no Clips tab on screen (open the panel on Clips)')

  return { ok: problems.length === 0, left, tab, problems }
}

export function installClipsLayoutCheck(): void {
  ;(window as unknown as { __forgeClipsLayout: typeof measureClipsLayout }).__forgeClipsLayout = measureClipsLayout
}
