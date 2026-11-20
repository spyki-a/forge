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
    await until(() => seen.some((u) => u.progress === 0.375))
    await new Promise((r) => setTimeout(r, 20))
    // Held: no progress past half way, all of it naming large-v3.
    expect(Math.max(...seen.map((u) => u.progress ?? 0))).toBeLessThanOrEqual(0.5)
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

  it('a press with no model names none in what the stub records, as before the choice', async () => {
    await bridge.speechModel({ download: true })
    expect(stub.presses.at(-1)).toEqual({ call: 'speechModel', options: { download: true } })
    expect(stub.speechPresent).toBe(true)
  })
})
