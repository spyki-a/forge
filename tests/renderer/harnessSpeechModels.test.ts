import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SPEECH_MODEL_BUSY, SPEECH_MODEL_SETTING, speechModelPin, type SpeechModelProgress, type SpeechModelStatus } from '@shared/asr/speechModel'

/*
 * The harness bridge's stand-in for the three speech models (the speech
 * model choice, piece 1): what the harness page shows the Settings row, so
 * each rule main keeps is kept here too: the model named, else the chosen
 * one; each its own bytes; one fetch at a time; a held "being fetched" state
 * a reading can look at; Remove with its box takes all three.
 */

type Bridge = {
  speechModel: (request?: unknown) => Promise<SpeechModelStatus>
  cancelSpeechModel: () => Promise<void>
  onSpeechModelProgress: (cb: (update: SpeechModelProgress) => void) => () => void
  setSetting: (key: string, value: unknown) => Promise<Record<string, unknown>>
  helperModelsBytes: () => Promise<number>
  removeHelper: (options: { models: boolean }) => Promise<void>
}

let bridge: Bridge
let stub: typeof import('../../src/renderer/src/harness/bridge').harnessHelper

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('window', {})
  const mod = await import('../../src/renderer/src/harness/bridge')
  mod.installHarnessBridge()
  bridge = (window as unknown as { forge: Bridge }).forge
  stub = mod.harnessHelper
  stub.reset()
  stub.stepMs = 1
  stub.set('ready')
})

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 2))
  if (!check()) throw new Error('never happened')
}

describe('the harness stand-in for three speech models', () => {
  it('each model answers its own bytes; none named is the chosen one, small by default', async () => {
    stub.speechOnDisk.medium = true
    for (const name of ['small', 'medium', 'large-v3'] as const) {
      expect(await bridge.speechModel({ model: name })).toMatchObject({ model: name, bytes: speechModelPin(name).bytes, present: name === 'medium' })
    }
    expect(await bridge.speechModel({})).toMatchObject({ model: 'small', present: false })
    await bridge.setSetting(SPEECH_MODEL_SETTING, 'medium')
    expect(await bridge.speechModel({})).toMatchObject({ model: 'medium', present: true })
    await expect(bridge.setSetting(SPEECH_MODEL_SETTING, 'huge')).rejects.toThrow('There is no speech model "huge"')
    expect(await bridge.speechModel({})).toMatchObject({ model: 'medium' })
    // speechPresent is small's, as the checks written before the choice read it.
    expect(stub.speechPresent).toBe(false)
  })

  it('three states at once: one on disk, one not, one held being fetched; another press is refused; its X ends it', async () => {
    const seen: SpeechModelProgress[] = []
    bridge.onSpeechModelProgress((u) => seen.push(u))
    const fetching = stub.speechModelsIn({ small: 'present', medium: 'absent', 'large-v3': 'fetching' })
    expect(fetching).not.toBeNull()
    const outcome = fetching!.then(
      () => 'done',
      (err: Error) => err.message
    )
    await until(() => seen.some((u) => u.progress === 0.5))
    await new Promise((r) => setTimeout(r, 20))
    // Held AT half way (the line reads "… 50%"), no further, all of it naming large-v3.
    expect(Math.max(...seen.map((u) => u.progress ?? 0))).toBe(0.5)
    expect(new Set(seen.map((u) => u.model))).toEqual(new Set(['large-v3']))
    await expect(bridge.speechModel({ download: true, model: 'medium' })).rejects.toThrow(SPEECH_MODEL_BUSY)
    expect(await bridge.speechModel({ model: 'small' })).toMatchObject({ present: true })
    expect(await bridge.speechModel({ model: 'medium' })).toMatchObject({ present: false })
    await bridge.cancelSpeechModel()
    expect(await outcome).toBe('Cancelled')
    expect(stub.speechOnDisk['large-v3']).toBe(false)
    expect(stub.presses.filter((p) => p.call === 'speechModel').map((p) => p.options)).toContainEqual({ download: true, model: 'large-v3' })
  })

  it('released, the held fetch completes and that model is on disk; the models take the three’s bytes; Remove with its box takes them all', async () => {
    const fetching = stub.speechModelsIn({ small: 'present', medium: 'fetching' })!
    await new Promise((r) => setTimeout(r, 15))
    stub.speechHold = false
    expect(await fetching).toMatchObject({ model: 'medium', present: true })
    expect(await bridge.helperModelsBytes()).toBe(speechModelPin('small').bytes + speechModelPin('medium').bytes)
    stub.set('absent')
    await bridge.removeHelper({ models: true })
    expect(stub.speechOnDisk).toEqual({ small: false, medium: false, 'large-v3': false })
  })

  it('a press with no model named fetches the CHOSEN one, and its progress names it', async () => {
    const seen: SpeechModelProgress[] = []
    bridge.onSpeechModelProgress((u) => seen.push(u))
    await bridge.setSetting(SPEECH_MODEL_SETTING, 'medium')
    expect(await bridge.speechModel({ download: true })).toMatchObject({ model: 'medium', present: true })
    expect(stub.speechOnDisk).toEqual({ small: false, medium: true, 'large-v3': false })
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen.map((u) => u.model))).toEqual(new Set(['medium']))
  })

  it('as main: while one model is fetched, a press for another is refused even when that one is on disk', async () => {
    const fetching = stub.speechModelsIn({ small: 'present', 'large-v3': 'fetching' })!
    const outcome = fetching.then(
      () => 'done',
      (err: Error) => err.message
    )
    await expect(bridge.speechModel({ download: true, model: 'small' })).rejects.toThrow(SPEECH_MODEL_BUSY)
    // A status ask is still answered.
    expect(await bridge.speechModel({ model: 'small' })).toMatchObject({ present: true })
    await bridge.cancelSpeechModel()
    expect(await outcome).toBe('Cancelled')
  })

  it('speechFail: the next fetch ends half way not on disk, without a throw, and the switch goes off', async () => {
    stub.speechFail = true
    expect(await bridge.speechModel({ download: true, model: 'medium' })).toMatchObject({ model: 'medium', present: false })
    expect(stub.speechOnDisk.medium).toBe(false)
    expect(stub.speechFail).toBe(false)
    // The next press fetches as usual.
    expect(await bridge.speechModel({ download: true, model: 'medium' })).toMatchObject({ model: 'medium', present: true })
  })

  it('reset() puts the choice back to small', async () => {
    await bridge.setSetting(SPEECH_MODEL_SETTING, 'large-v3')
    stub.reset()
    stub.set('ready')
    expect(await bridge.speechModel({})).toMatchObject({ model: 'small', bytes: speechModelPin('small').bytes })
  })

  it('a press with no model names none in what the stub records, as before the choice', async () => {
    await bridge.speechModel({ download: true })
    expect(stub.presses.at(-1)).toEqual({ call: 'speechModel', options: { download: true } })
    expect(stub.speechPresent).toBe(true)
  })
})
