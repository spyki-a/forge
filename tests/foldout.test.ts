import { describe, expect, it } from 'vitest'
import {
  FOLDOUT_MAX,
  FOLDOUT_MIN,
  FOLDOUT_OPEN,
  FOLDOUT_SHUT,
  FOLDOUT_START,
  PICTURE_MIN,
  followFoldout,
  foldoutClosed,
  foldoutOpenAt,
  foldoutOpened,
  foldoutResized,
  foldoutShowing,
  foldoutShowsWords,
  foldoutToggled,
  foldoutToggledWords,
  foldoutTranscript,
  type FoldoutPanelHandle,
  type FoldoutState,
  type FoldoutWords
} from '@shared/foldout'

/*
 * The fold-out panel's rules (src/shared/foldout.ts): which transcript its
 * Transcript tab shows, how its toggles open, switch and close it, and how
 * its Panel and the store keep in step. Plain node, as tests/curveTray.test.ts
 * holds the Curve tray's.
 */

const state = (open: boolean, tab: FoldoutState['tab'], words: FoldoutWords): FoldoutState => ({ open, tab, words })

describe('which transcript the Transcript tab shows', () => {
  /*
   * The one asked for if it exists; else the other if that exists; else the
   * asked one's empty state. Every combination of asked × link × clip.
   */
  const table: [FoldoutWords, boolean, boolean, FoldoutWords, boolean][] = [
    // asked, link exists, clip exists → shows, ready
    ['link', true, true, 'link', true],
    ['link', true, false, 'link', true],
    ['link', false, true, 'clip', true],
    ['link', false, false, 'link', false],
    ['clip', true, true, 'clip', true],
    ['clip', true, false, 'link', true],
    ['clip', false, true, 'clip', true],
    ['clip', false, false, 'clip', false]
  ]
  for (const [asked, link, clip, words, ready] of table) {
    it(`asked ${asked}, link ${link ? 'has words' : 'none'}, clip ${clip ? 'selected' : 'none'} → ${words}${ready ? '' : ' (empty)'}`, () => {
      expect(foldoutTranscript(asked, { link, clip })).toEqual({ words, ready })
    })
  }
})

describe('opening, closing and toggling', () => {
  it('starts shut, on Clips, the Transcript tab on the link', () => {
    expect(FOLDOUT_START).toEqual({ open: false, tab: 'clips', words: 'link' })
    expect(Object.isFrozen(FOLDOUT_START)).toBe(true)
  })

  it('opens on the tab asked, changing the words only when given', () => {
    expect(foldoutOpened(state(false, 'clips', 'clip'), 'transcript')).toEqual(state(true, 'transcript', 'clip'))
    expect(foldoutOpened(state(false, 'clips', 'clip'), 'transcript', 'link')).toEqual(state(true, 'transcript', 'link'))
    expect(foldoutOpened(state(true, 'transcript', 'link'), 'clips')).toEqual(state(true, 'clips', 'link'))
  })

  it('gives the same object back when nothing changes', () => {
    const open = state(true, 'clips', 'link')
    expect(foldoutOpened(open, 'clips')).toBe(open)
    const shut = state(false, 'transcript', 'clip')
    expect(foldoutClosed(shut)).toBe(shut)
  })

  it('closes keeping the tab and the words for the next open', () => {
    expect(foldoutClosed(state(true, 'transcript', 'clip'))).toEqual(state(false, 'transcript', 'clip'))
  })

  it('a toggle on the tab already showing closes it', () => {
    expect(foldoutToggled(state(true, 'clips', 'link'), 'clips')).toEqual(state(false, 'clips', 'link'))
    expect(foldoutToggled(state(true, 'transcript', 'clip'), 'transcript', 'clip')).toEqual(state(false, 'transcript', 'clip'))
    // A Transcript toggle that names no words is the tab, whichever words it shows.
    expect(foldoutToggled(state(true, 'transcript', 'clip'), 'transcript')).toEqual(state(false, 'transcript', 'clip'))
  })

  it('a toggle on the other tab switches to it, open', () => {
    expect(foldoutToggled(state(true, 'clips', 'link'), 'transcript', 'link')).toEqual(state(true, 'transcript', 'link'))
    expect(foldoutToggled(state(true, 'transcript', 'link'), 'clips')).toEqual(state(true, 'clips', 'link'))
  })

  it('a toggle for the other transcript switches to it rather than closing', () => {
    expect(foldoutShowing(state(true, 'transcript', 'clip'), 'transcript', 'link')).toBe(false)
    expect(foldoutToggled(state(true, 'transcript', 'clip'), 'transcript', 'link')).toEqual(state(true, 'transcript', 'link'))
    // Clips has no words: its toggle closes it whatever words are kept.
    expect(foldoutToggled(state(true, 'clips', 'clip'), 'clips', 'link')).toEqual(state(false, 'clips', 'clip'))
  })

  it('a toggle on a shut panel opens it on that tab', () => {
    expect(foldoutToggled(state(false, 'clips', 'link'), 'clips')).toEqual(state(true, 'clips', 'link'))
    expect(foldoutToggled(state(false, 'clips', 'link'), 'transcript', 'clip')).toEqual(state(true, 'transcript', 'clip'))
  })
})

describe('its sizes', () => {
  it('opens at 40 %, never under 280 px nor over 60 %, the picture never under 35 %', () => {
    expect(FOLDOUT_SHUT).toBe(0)
    expect(FOLDOUT_MIN).toBe(280)
    expect(FOLDOUT_OPEN).toBe('40%')
    expect(FOLDOUT_MAX).toBe('60%')
    expect(PICTURE_MIN).toBe('35%')
    // The two shares leave room for each other.
    expect(parseFloat(FOLDOUT_MAX) + parseFloat(PICTURE_MIN)).toBeLessThanOrEqual(100)
    expect(parseFloat(FOLDOUT_OPEN)).toBeLessThan(parseFloat(FOLDOUT_MAX))
  })

  it('is open at or past the midpoint between shut and the least open width', () => {
    expect(foldoutOpenAt(0)).toBe(false)
    expect(foldoutOpenAt(139)).toBe(false)
    expect(foldoutOpenAt(140)).toBe(true)
    expect(foldoutOpenAt(FOLDOUT_MIN)).toBe(true)
    expect(foldoutOpenAt(600)).toBe(true)
  })
})

/** The library's handle, as far as the rules use it: a width, collapsed at 0, and a floor it will not open under. */
function fakePanel(start: number, room = Infinity): FoldoutPanelHandle & { width: number; calls: string[] } {
  const panel = {
    width: start,
    calls: [] as string[],
    isCollapsed: () => panel.width === 0,
    resize: (size: number | string) => {
      panel.calls.push(`resize(${size})`)
      // Refused, as the Group refuses it, when 280 px does not fit.
      if (room >= FOLDOUT_MIN) panel.width = typeof size === 'number' ? size : 400
    },
    collapse: () => {
      panel.calls.push('collapse()')
      panel.width = 0
    }
  }
  return panel
}

describe('keeping the Panel and the store in step', () => {
  it('the store opening it expands the Panel to where it was left', () => {
    const panel = fakePanel(0)
    expect(followFoldout(panel, true, '37.5%')).toBe('moved')
    expect(panel.calls).toEqual(['resize(37.5%)'])
    expect(panel.isCollapsed()).toBe(false)
  })

  it('the store shutting it collapses the Panel', () => {
    const panel = fakePanel(400)
    expect(followFoldout(panel, false, FOLDOUT_OPEN)).toBe('moved')
    expect(panel.calls).toEqual(['collapse()'])
    expect(panel.width).toBe(0)
  })

  it('does nothing when the two agree, so neither answers the other', () => {
    const open = fakePanel(400)
    expect(followFoldout(open, true, FOLDOUT_OPEN)).toBe('same')
    const shut = fakePanel(0)
    expect(followFoldout(shut, false, FOLDOUT_OPEN)).toBe('same')
    expect([...open.calls, ...shut.calls]).toEqual([])
  })

  it('says so when the Group will not open it', () => {
    const panel = fakePanel(0, 200)
    expect(followFoldout(panel, true, FOLDOUT_OPEN)).toBe('refused')
  })

  it('a resize to zero is shut; a resize past the midpoint is open, remembered as its share', () => {
    expect(foldoutResized({ inPixels: 0, asPercentage: 0 })).toEqual({ open: false, width: null })
    expect(foldoutResized({ inPixels: 120, asPercentage: 10 })).toEqual({ open: false, width: null })
    expect(foldoutResized({ inPixels: 420, asPercentage: 42.5 })).toEqual({ open: true, width: '42.5%' })
  })
})

describe('the Transcript toggles, on the words the tab shows (the clip maker’s layout, piece 3)', () => {
  const both = { link: true, clip: true }

  it('reads showing on the words the rule shows, not merely the ones asked for', () => {
    // Asked for the clip, none selected, the link's words there: the tab shows the link's.
    const asked = state(true, 'transcript', 'clip')
    expect(foldoutShowsWords(asked, 'link', { link: true, clip: false })).toBe(true)
    expect(foldoutShowsWords(asked, 'clip', { link: true, clip: false })).toBe(false)
    // Both there: the one asked.
    expect(foldoutShowsWords(asked, 'clip', both)).toBe(true)
    expect(foldoutShowsWords(asked, 'link', both)).toBe(false)
    // Neither there: the asked one's empty line is what shows.
    expect(foldoutShowsWords(asked, 'clip', { link: false, clip: false })).toBe(true)
    // Shut, or on Clips: nothing of the Transcript tab shows.
    expect(foldoutShowsWords(state(false, 'transcript', 'clip'), 'clip', both)).toBe(false)
    expect(foldoutShowsWords(state(true, 'clips', 'clip'), 'clip', both)).toBe(false)
  })

  it('closes on the words shown, and opens the Transcript tab asking for its words on anything else', () => {
    const asked = state(true, 'transcript', 'clip')
    expect(foldoutToggledWords(asked, 'link', { link: true, clip: false })).toEqual(state(false, 'transcript', 'clip'))
    expect(foldoutToggledWords(asked, 'link', both)).toEqual(state(true, 'transcript', 'link'))
    expect(foldoutToggledWords(asked, 'clip', both)).toEqual(state(false, 'transcript', 'clip'))
    expect(foldoutToggledWords(state(false, 'clips', 'link'), 'clip', both)).toEqual(state(true, 'transcript', 'clip'))
    expect(foldoutToggledWords(state(true, 'clips', 'clip'), 'clip', both)).toEqual(state(true, 'transcript', 'clip'))
  })
})
