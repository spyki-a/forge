import { describe, expect, it } from 'vitest'
import { emptyProject, type Clip, type Project } from '@shared/timeline'
import { dockSubject } from '../src/renderer/src/dock'

/**
 * What the Trimmer dock shows (docs/WINDOW.md §3.18, src/renderer/src/dock.ts).
 *
 * The dock is drawn only while there is something to trim: a selected clip
 * that is really in the project, or a Library sound being auditioned. The
 * audition branch is the one that is easy to lose — the Inspector the dock
 * replaces never showed for one — and without it a sound picked in the Library
 * would have nowhere to be trimmed before it is placed, which was the whole
 * point of auditioning it.
 */

function withClip(id: string): Project {
  const project = emptyProject()
  const clip = { id, assetId: 'a1', trackId: project.tracks[0].id, start: 0, duration: 30, inPoint: 0 } as Clip
  return { ...project, clips: [clip] }
}

const sound = { path: '/library/sfx/whoosh.wav', name: 'whoosh', inMs: 0, outMs: 0 }

describe('dockSubject', () => {
  it('is the clip, for a selected clip in the project', () => {
    expect(dockSubject(withClip('c1'), 'c1', null)).toBe('clip')
  })

  it('is nothing for a selection that outlived its clip', () => {
    // Undo, a delete from the menu, a file opened over it: the id is still in
    // the store and the clip is not in the project.
    expect(dockSubject(withClip('c1'), 'gone', null)).toBeNull()
    expect(dockSubject(emptyProject(), 'c1', null)).toBeNull()
  })

  it('is the audition, for a Library sound with nothing selected', () => {
    expect(dockSubject(emptyProject(), null, sound)).toBe('audition')
  })

  it('is the clip when both are there — the waveform shows the clip over an audition', () => {
    expect(dockSubject(withClip('c1'), 'c1', sound)).toBe('clip')
  })

  it('falls back to the audition when the selected clip is gone', () => {
    expect(dockSubject(withClip('c1'), 'gone', sound)).toBe('audition')
  })

  it('is nothing at all with nothing selected and nothing auditioned', () => {
    expect(dockSubject(emptyProject(), null, null)).toBeNull()
    expect(dockSubject(withClip('c1'), null, null)).toBeNull()
  })
})
