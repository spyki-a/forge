import { describe, expect, it } from 'vitest'
import { helperCan } from '@shared/sidecar/helperCan'
import { SIDECAR_METHODS, type HelloResult } from '@shared/sidecar/protocol'
import { SELFTEST_GROUP_NAMES, VCRUNTIME_SENTENCE } from '@shared/sidecar/selftest'
import type { PackOffer, SidecarStatus } from '@shared/sidecar/status'

/*
 * Every Python control greys by its OWN method (docs/CLIPS.md §3a.4 "Grey
 * every Python control by its own method", §3a.7): `helperCan` is true only
 * for a ready helper whose hello registered the method, did not degrade it,
 * and whose install self-test did not fail its group. Never because a
 * process is up.
 */

const TRANSCRIBE = SIDECAR_METHODS.transcribe

const hello = (capabilities: string[], degraded: Record<string, string> = {}): HelloResult => ({
  protocolVersion: 1,
  python: '3.14.8',
  platform: 'Windows-AMD64',
  capabilities,
  degraded,
  executable: 'C:\\Users\\a\\AppData\\Roaming\\Forge\\python\\1\\python\\python.exe',
  prefix: 'C:\\Users\\a\\AppData\\Roaming\\Forge\\python\\1\\python',
  path: []
})

const source = { kind: 'pack', pack: 1, root: '/u/python/1' } as const
const offer: Extract<PackOffer, { supported: true }> = { supported: true, kind: 'install', bytes: 10, bytesOnDisk: 20, hosts: ['github.com'] }
const allOk = Object.fromEntries(SELFTEST_GROUP_NAMES.map((g) => [g, 'ok']))
const ready = (h: HelloResult, selftest?: Record<string, string>): SidecarStatus => ({ state: 'ready', hello: h, source, ...(selftest ? { selftest } : {}) })

describe('helperCan', () => {
  it('is true for a ready helper that registered the method, with every group ok', () => {
    expect(helperCan(ready(hello([TRANSCRIBE]), allOk), TRANSCRIBE)).toBe(true)
    // A status as main's own gates pass it: no source, no self-test record.
    expect(helperCan({ state: 'ready', hello: hello([TRANSCRIBE]) }, TRANSCRIBE)).toBe(true)
  })

  it('is false with no helper to ask: absent, damaged, installing, starting, failed, or not answered yet', () => {
    expect(helperCan({ state: 'absent', offer }, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'absent', offer: { supported: false, reason: 'The AI helper needs macOS 14 or later' } }, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'damaged', reason: 'gone', offer: { ...offer, kind: 'repair' } }, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'installing', stage: 'Downloading' }, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'starting', source }, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'failed', error: 'The AI helper stopped (code 9009)', source }, TRANSCRIBE)).toBe(false)
    expect(helperCan(null, TRANSCRIBE)).toBe(false)
  })

  it('is decided by the state first: a status that is not ready is never able, whatever else it carries', () => {
    // A failed or starting status carries no hello by its type; one that did (a stale copy, a careless spread) still is not ready.
    const stale = { state: 'failed', error: 'The AI helper keeps crashing and has been stopped', source, hello: hello([TRANSCRIBE]) }
    expect(helperCan(stale as unknown as SidecarStatus, TRANSCRIBE)).toBe(false)
    expect(helperCan({ state: 'starting', source, hello: hello([TRANSCRIBE]) } as unknown as SidecarStatus, TRANSCRIBE)).toBe(false)
  })

  it('is false for a method the hello did not register: a bare interpreter is up and can do nothing', () => {
    expect(helperCan(ready(hello([])), TRANSCRIBE)).toBe(false)
    expect(helperCan(ready(hello([SIDECAR_METHODS.beats])), TRANSCRIBE)).toBe(false)
  })

  it('is false for a degraded method, even one main left in capabilities when it merged the self-test', () => {
    expect(helperCan(ready(hello([TRANSCRIBE], { [TRANSCRIBE]: 'No module named faster_whisper' })), TRANSCRIBE)).toBe(false)
    // The other methods of that hello stay able.
    expect(helperCan(ready(hello([TRANSCRIBE, SIDECAR_METHODS.beats], { [TRANSCRIBE]: 'x' })), SIDECAR_METHODS.beats)).toBe(true)
  })

  it('is false for a method whose self-test group failed, read from the record when hello was not merged', () => {
    const beatsFailed = { ...allOk, beats: `beats ${VCRUNTIME_SENTENCE}` }
    const status = ready(hello([TRANSCRIBE, SIDECAR_METHODS.beats]), beatsFailed)
    expect(helperCan(status, SIDECAR_METHODS.beats)).toBe(false)
    // Only that group's methods: Transcribe's group passed.
    expect(helperCan(status, TRANSCRIBE)).toBe(true)
  })

  it('does not read an inherited name as a capability or a degraded one', () => {
    expect(helperCan(ready(hello([])), 'toString')).toBe(false)
    expect(helperCan(ready(hello(['toString'])), 'toString')).toBe(true)
  })
})
