import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatBytes } from '../src/shared/assets/pack'
import {
  DEFAULT_SPEECH_MODEL,
  SPEECH_MODELS,
  SPEECH_MODEL_NAMES,
  isSpeechModelName,
  speechModelLabel,
  speechModelName,
  speechModelPin
} from '../src/shared/asr/speechModel'
import { ASR_PY, asrModels, asrModelsFrom } from './fixtures/asrModels'

/*
 * The three speech models, one table on each side of the protocol: asr.py
 * `MODELS` (what the helper fetches and loads) and speechModel.ts
 * `SPEECH_MODELS` (what the window names and sizes). Held equal here, as
 * tests/speechModelIpc.test.ts held the one pin before the choice: every
 * name, repository, commit, file and size, in order, and the sums.
 */

/** The pins as read from huggingface.co's API, 2026-10-16 (small) and 2026-11-20 (medium, large-v3). */
const READ = {
  small: { revision: '536b0662742c02347bc0e980a01041f333bce120', bytes: 486_212_372, modelBin: 483_546_902 },
  medium: { revision: '08e178d48790749d25932bbc082711ddcfdfbc4f', bytes: 1_530_571_735, modelBin: 1_527_906_378 },
  'large-v3': { revision: 'edaa852ec7e145841d8ffdb056a99866b5f0a478', bytes: 3_090_835_702, modelBin: 3_087_284_237 }
} as const

const window = (): { name: string; repo: string; revision: string; files: [string, number][] }[] =>
  SPEECH_MODELS.map((m) => ({ name: m.name, repo: m.repo, revision: m.revision, files: m.files.map(([f, s]): [string, number] => [f, s]) }))

describe('the two tables', () => {
  it('asr.py MODELS and SPEECH_MODELS name the same models, repositories, commits, files and sizes, in order', () => {
    expect(asrModels()).toEqual(window())
  })

  it('each sum is its files’, and the sums are the ones read', () => {
    for (const m of SPEECH_MODELS) {
      expect(m.bytes, m.name).toBe(m.files.reduce((sum, [, size]) => sum + size, 0))
      expect(m.bytes, m.name).toBe(READ[m.name].bytes)
      expect(m.revision, m.name).toBe(READ[m.name].revision)
      expect(Object.fromEntries(m.files)['model.bin'], m.name).toBe(READ[m.name].modelBin)
    }
    const helper = asrModels()
    expect(helper.map((m) => m.files.reduce((sum, [, size]) => sum + size, 0))).toEqual(SPEECH_MODELS.map((m) => m.bytes))
  })

  it('the names are the protocol’s three, small the default; on screen Small, Medium, Large, each with its hint', () => {
    expect(SPEECH_MODELS.map((m) => m.name)).toEqual([...SPEECH_MODEL_NAMES])
    expect(SPEECH_MODEL_NAMES).toEqual(['small', 'medium', 'large-v3'])
    expect(DEFAULT_SPEECH_MODEL).toBe('small')
    expect(SPEECH_MODELS.map((m) => [m.label, m.hint])).toEqual([
      ['Small', 'fastest'],
      ['Medium', 'more accurate, slower'],
      ['Large', 'most accurate, slowest']
    ])
    expect(readFileSync(ASR_PY, 'utf8').match(/^DEFAULT_MODEL = "([^"]+)"$/m)?.[1]).toBe(DEFAULT_SPEECH_MODEL)
  })

  it('large-v3 fetches its preprocessor_config.json and vocabulary.json; small and medium vocabulary.txt; none README.md or .gitattributes', () => {
    const files = (name: string): string[] => speechModelPin(name as never).files.map(([f]) => f)
    expect(files('large-v3')).toContain('preprocessor_config.json')
    expect(files('large-v3')).toContain('vocabulary.json')
    expect(files('small')).toContain('vocabulary.txt')
    expect(files('medium')).toContain('vocabulary.txt')
    for (const m of SPEECH_MODELS) {
      expect(m.files.map(([f]) => f), m.name).not.toContain('README.md')
      expect(m.files.map(([f]) => f), m.name).not.toContain('.gitattributes')
      expect(m.revision, m.name).toMatch(/^[0-9a-f]{40}$/)
      expect(m.repo, m.name).toBe(`Systran/faster-whisper-${m.name}`)
    }
  })

  it('each press names its model’s size through formatBytes', () => {
    expect(SPEECH_MODELS.map((m) => speechModelLabel(m))).toEqual([
      'Get the speech model · 464 MB',
      'Get the speech model · 1.4 GB',
      'Get the speech model · 2.9 GB'
    ])
    expect(SPEECH_MODELS.map((m) => formatBytes(m.bytes))).toEqual(['464 MB', '1.4 GB', '2.9 GB'])
  })
})

describe('the reader of asr.py fails on drift rather than reading less', () => {
  const text = readFileSync(ASR_PY, 'utf8')
  it('a file line out of shape is refused, not skipped', () => {
    const bad = text.replace('("preprocessor_config.json", 340),', '("preprocessor_config.json", 340), # x')
    expect(bad).not.toBe(text)
    expect(() => asrModelsFrom(bad)).toThrow(/out of shape/)
  })
  it('a second MODELS is refused', () => {
    expect(() => asrModelsFrom(`${text}\nMODELS: tuple[SpeechModel, ...] = (\n)\n`)).toThrow(/opens MODELS 2 times/)
  })
})

describe('the setting’s guard', () => {
  it('one of the three exactly; anything else is small', () => {
    for (const name of SPEECH_MODEL_NAMES) {
      expect(isSpeechModelName(name)).toBe(true)
      expect(speechModelName(name)).toBe(name)
    }
    for (const bad of [undefined, null, '', 'large', 'Large', 'tiny', 'LARGE-V3', 3, {}, ['medium']]) {
      expect(isSpeechModelName(bad), JSON.stringify(bad)).toBe(false)
      expect(speechModelName(bad), JSON.stringify(bad)).toBe('small')
    }
  })
})
