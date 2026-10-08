import { describe, expect, it } from 'vitest'
import { displayRotation, uprightSize } from '@shared/media'

/*
 * The turn the decoder gives a stream, read the way ffmpeg reads it
 * (docs/CLIPS.md §3.1). The files themselves are tests/integration/
 * rotation.int.test.ts; this is the arithmetic, including the inputs no
 * fixture here produces (a negative angle, a string, an odd angle, a tag with
 * no matrix).
 */

const matrix = (rotation: number | string): { side_data_list: { side_data_type: string; rotation: number | string }[] } => ({
  side_data_list: [{ side_data_type: 'Display Matrix', rotation }]
})

describe('displayRotation', () => {
  it('is the matrix angle negated and folded, as ffmpeg get_rotation does', () => {
    // ffprobe printed rotation 90 for a `rotate=90` remux, and ffmpeg turned it with transpose=cclock: 270 clockwise.
    expect(displayRotation(matrix(90))).toBe(270)
    expect(displayRotation(matrix(-90))).toBe(90)
    expect(displayRotation(matrix(180))).toBe(180)
    expect(displayRotation(matrix(-180))).toBe(180)
    expect(displayRotation(matrix(0))).toBe(0)
    expect(displayRotation(matrix('-90'))).toBe(90)
    // Within a degree of a right angle is that angle, as ffmpeg decides it.
    expect(displayRotation(matrix(-89.6))).toBe(90)
    // An odd angle is turned in place by ffmpeg's `rotate`, so it is reported but never swaps.
    expect(displayRotation(matrix(45))).toBe(315)
  })

  it('reads the matrix and nothing else', () => {
    expect(displayRotation(undefined)).toBe(0)
    expect(displayRotation({ width: 640, height: 360 })).toBe(0)
    // The legacy tag without a matrix: the decoder does not turn it, so neither does the size.
    expect(displayRotation({ width: 640, height: 360, tags: { rotate: '90' } } as never)).toBe(0)
    // A side data entry that is not a rotation is passed over.
    expect(displayRotation({ side_data_list: [{ side_data_type: 'Stereo 3D' }, { side_data_type: 'Display Matrix', rotation: -90 }] })).toBe(90)
  })
})

describe('uprightSize', () => {
  it('swaps the sides for a quarter turn and only then', () => {
    expect(uprightSize({ width: 640, height: 360, ...matrix(90) })).toEqual({ width: 360, height: 640, rotation: 270 })
    expect(uprightSize({ width: 3840, height: 2160, ...matrix(-90) })).toEqual({ width: 2160, height: 3840, rotation: 90 })
    expect(uprightSize({ width: 640, height: 360, ...matrix(180) })).toEqual({ width: 640, height: 360, rotation: 180 })
    expect(uprightSize({ width: 640, height: 360, ...matrix(45) })).toEqual({ width: 640, height: 360, rotation: 315 })
    expect(uprightSize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360, rotation: 0 })
    expect(uprightSize(undefined)).toEqual({ width: null, height: null, rotation: 0 })
  })
})
