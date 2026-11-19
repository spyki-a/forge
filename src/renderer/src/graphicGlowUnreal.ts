/**
 * The glow's `'unreal'` route (docs/CLIPS.md §6.16, "Glow"; M7, §6.15): three
 * r186's own `UnrealBloomPass`, loaded only when a compositor is made on that
 * route, so the planned `'quad'` route never loads it. Its own module so that
 * removing the route M7 does not keep is a deletion of this file and of the
 * branches that name it in `graphicCompositor.ts`, not a rewrite.
 *
 * How r186's pass treats alpha (read in node_modules, three 0.186.0,
 * examples/jsm/postprocessing/UnrealBloomPass.js): the high pass and every
 * blur read and write RGB only (each blur writes alpha 1 into half-float
 * targets); the composite writes `vec4(bloom, max(bloom.r, bloom.g,
 * bloom.b))`, an alpha taken from the bloom's own brightness, into
 * `renderTargetsHorizontal[0]`; the last step adds that over its input with
 * `AdditiveBlending` and `premultipliedAlpha` (ONE, ONE on colour and
 * alpha). The compositor reads `renderTargetsHorizontal[0]` itself and adds
 * it as the quad route's glow is added, so both routes end the same way and
 * M7 reads only how each spreads and what alpha it leaves. Its `dispose()`
 * does not dispose `materialHighPassFilter`; the compositor does.
 */

import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export type UnrealBloom = typeof UnrealBloomPass

export async function loadUnrealBloom(): Promise<UnrealBloom> {
  return (await import('three/examples/jsm/postprocessing/UnrealBloomPass.js')).UnrealBloomPass
}
