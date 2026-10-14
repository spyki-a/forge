import { describe, expect, it } from 'vitest'
import {
  CHECKING_SPACE,
  CHECKING_THE_HELPER,
  HELPER_JOB_INPUT,
  HELPER_PRESET,
  INSTALL_STAGES,
  UNPACKING_PYTHON,
  WAITING_FOR_THE_HELPER,
  bytesLeft,
  downloadingText,
  driveLabel,
  helperInstallRequest,
  helperJobKind,
  helperJobLabel,
  helperRemoveRequest,
  installProgress,
  installingText,
  spaceNeeded,
  spaceSentence,
  sweepPlan,
  type InstallStage,
  type SweepInput
} from '../src/shared/sidecar/install'
import { HELPER_PACK } from '../src/shared/sidecar/packManifest'
import { packBytes } from '../src/shared/sidecar/pack'

/*
 * The install job's pure half (docs/CLIPS.md §3a.3): the bar across the
 * stages, the speed column's words, the row's label, free space, what is left
 * to fetch, the IPC payloads and the launch sweep's rules. The job itself is
 * tests/helperPackJob.test.ts.
 */

/** A small seeded generator (mulberry32), so a failing property names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MIB = 1024 * 1024

describe('the stages and the bar', () => {
  it('names five stages, Checking first, sharing the whole bar end to end', () => {
    expect(INSTALL_STAGES.map((s) => s.label)).toEqual(['Checking', 'Downloading', 'Unpacking', 'Installing the libraries', 'Checking the AI helper'])
    // The weights are placeholders until a measured install sets them (§3a.8 row 27): what is held is
    // that they tile 0..1 in order, so a re-weighting done right still passes.
    expect(INSTALL_STAGES[0].from).toBe(0)
    expect(INSTALL_STAGES[INSTALL_STAGES.length - 1].to).toBe(1)
    for (let i = 0; i < INSTALL_STAGES.length; i++) {
      expect(INSTALL_STAGES[i].to).toBeGreaterThanOrEqual(INSTALL_STAGES[i].from)
      if (i > 0) expect(INSTALL_STAGES[i].from, INSTALL_STAGES[i].label).toBe(INSTALL_STAGES[i - 1].to)
    }
  })

  it('never goes down as the job moves through the stages: a property over random fractions', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed)
      // A job's reports: each stage in turn, any number of non-decreasing fractions within it.
      const reports: number[] = []
      for (let stage = 0 as InstallStage; stage <= 4; stage = (stage + 1) as InstallStage) {
        let f = 0
        const count = 1 + Math.floor(r() * 6)
        for (let i = 0; i < count; i++) {
          f = Math.min(1, f + r() * 0.5)
          reports.push(installProgress(stage, f))
        }
        if (stage === 4) break
      }
      for (let i = 1; i < reports.length; i++) {
        expect(reports[i], `seed ${seed}, report ${i}`).toBeGreaterThanOrEqual(reports[i - 1])
      }
      expect(reports.every((p) => p >= 0 && p <= 1)).toBe(true)
    }
  })

  it('each stage starts exactly where the one before it ends, and fractions outside 0..1 are clamped', () => {
    for (let s = 0; s < 4; s++) expect(installProgress((s + 1) as InstallStage, 0)).toBe(installProgress(s as InstallStage, 1))
    expect(installProgress(1, -1)).toBe(0)
    expect(installProgress(1, 2)).toBe(INSTALL_STAGES[1].to)
    expect(installProgress(3, Number.NaN)).toBe(INSTALL_STAGES[3].from)
    expect(installProgress(4, 1)).toBe(1)
  })
})

describe('the speed column', () => {
  it('says each stage in the plan’s words', () => {
    expect(CHECKING_SPACE).toBe('checking space')
    expect(downloadingText(31 * MIB, 205 * MIB, 4.2 * MIB)).toBe('downloading · 31 of 205 MB · 4.2 MB/s')
    expect(UNPACKING_PYTHON).toBe('unpacking Python')
    expect(installingText(12, 48)).toBe('installing libraries · 12 of 48')
    expect(CHECKING_THE_HELPER).toBe('checking the AI helper')
    expect(WAITING_FOR_THE_HELPER).toBe("waiting for the AI helper's work to finish")
  })

  it('leaves the speed out until there is one, and never mixes two units', () => {
    expect(downloadingText(0, 205 * MIB, null)).toBe('downloading · 0 of 205 MB')
    expect(downloadingText(10, 205 * MIB, 0)).toBe('downloading · 0 of 205 MB')
    expect(downloadingText(3 * 1024, 40 * 1024, 2 * MIB)).toBe('downloading · 3 of 40 KB · 2.0 MB/s')
    // Never past the total, though a retried file counts its bytes twice.
    expect(downloadingText(300 * MIB, 205 * MIB, null)).toBe('downloading · 205 of 205 MB')
    expect(installingText(50, 48)).toBe('installing libraries · 48 of 48')
  })
})

describe('the job row', () => {
  it('reads Installing, Repairing or Updating the AI helper, by the job’s params.kind', () => {
    expect(HELPER_PRESET).toBe('helper')
    expect(HELPER_JOB_INPUT).toBe('the AI helper')
    expect(helperJobLabel('install')).toBe('Installing the AI helper')
    expect(helperJobLabel('repair')).toBe('Repairing the AI helper')
    expect(helperJobLabel('update')).toBe('Updating the AI helper')
    expect(helperJobKind({ kind: 'repair' })).toBe('repair')
    expect(helperJobKind({ kind: 'update' })).toBe('update')
    expect(helperJobKind({ kind: 'nonsense' })).toBe('install')
    expect(helperJobKind(undefined)).toBe('install')
  })
})

describe('free space', () => {
  it('needs what is left to fetch, the pack on disk, and 10 %', () => {
    expect(spaceNeeded(100, 200)).toBe(330)
    expect(spaceNeeded(0, 1000)).toBe(1100)
    expect(spaceNeeded(-5, 1000)).toBe(1100)
  })

  it('names the drive on Windows, and says it in GB', () => {
    expect(driveLabel('C:\\Users\\bride\\AppData\\Roaming\\Forge', 'win32')).toBe('C:')
    expect(driveLabel('d:\\Forge', 'win32')).toBe('D:')
    expect(driveLabel('\\\\server\\share\\Forge', 'win32')).toBe('\\\\server\\share')
    expect(driveLabel('/Users/bride/Library/Application Support/forge', 'darwin')).toBe('this disk')
    const gib = 1024 * 1024 * 1024
    expect(spaceSentence(0.8 * gib, 0.3 * gib, 'C:')).toBe('The AI helper needs 0.8 GB free on C: (0.3 GB is free)')
  })
})

describe('what is left to fetch', () => {
  const platform = 'win32-x64' as const
  const pack = HELPER_PACK.platforms[platform]

  it('is the whole pack with nothing present, and less each verified file', () => {
    expect(bytesLeft(HELPER_PACK, platform, {})).toBe(packBytes(pack))
    const [a, b] = pack.wheels
    expect(bytesLeft(HELPER_PACK, platform, { [pack.interpreter.name]: pack.interpreter.bytes, [a.name]: a.bytes })).toBe(
      packBytes(pack) - pack.interpreter.bytes - a.bytes
    )
    // A file of another size under the name is not the file: it is fetched again.
    expect(bytesLeft(HELPER_PACK, platform, { [b.name]: b.bytes - 1, 'stranger.whl': 99 })).toBe(packBytes(pack))
    const all = Object.fromEntries([pack.interpreter, ...pack.wheels].map((f) => [f.name, f.bytes]))
    expect(bytesLeft(HELPER_PACK, platform, all)).toBe(0)
  })
})

describe('the IPC payloads', () => {
  it('install takes nothing, or repair or update as booleans, never both', () => {
    expect(helperInstallRequest(undefined)).toEqual({})
    expect(helperInstallRequest({})).toEqual({})
    expect(helperInstallRequest({ repair: true })).toEqual({ repair: true })
    expect(helperInstallRequest({ update: true, repair: false })).toEqual({ update: true })
    expect(() => helperInstallRequest({ repair: 'yes' })).toThrow()
    expect(() => helperInstallRequest({ repair: true, update: true })).toThrow('not both')
    expect(() => helperInstallRequest('repair')).toThrow()
    expect(() => helperInstallRequest([true])).toThrow()
  })

  it('remove takes {models} as a boolean, and nothing else', () => {
    expect(helperRemoveRequest({ models: false })).toEqual({ models: false })
    expect(helperRemoveRequest({ models: true, extra: 1 })).toEqual({ models: true })
    expect(() => helperRemoveRequest({})).toThrow()
    expect(() => helperRemoveRequest({ models: 'true' })).toThrow()
    expect(() => helperRemoveRequest(null)).toThrow()
  })
})

describe('the launch sweep’s rules', () => {
  const base: SweepInput = {
    current: 2,
    versions: [
      { n: 1, receipt: 'parses' },
      { n: 2, receipt: 'parses' },
      { n: 3, receipt: 'none' },
      { n: 4, receipt: 'unparseable' },
      { n: 7, receipt: 'parses' }
    ],
    downloads: [1, 2, 9],
    lockedElsewhere: false,
    inUse: [],
    currentComplete: true
  }
  const paths = (input: SweepInput): string[] => sweepPlan(input).map((s) => s.path)

  it('removes a receipt-less folder, an older pack beside a complete one, and other packs’ downloads', () => {
    expect(paths(base)).toEqual(['1', '3', 'downloads/1', 'downloads/9'])
  })

  it('never removes a folder whose pack.json does not parse, the complete pack, a newer number’s pack, or this pack’s downloads', () => {
    const kept = paths(base)
    for (const path of ['2', '4', '7', 'downloads/2']) expect(kept).not.toContain(path)
  })

  it('removes the older pack’s receipt before its tree; a partial has none to remove', () => {
    const steps = sweepPlan(base)
    expect(steps.find((s) => s.path === '1')).toMatchObject({ kind: 'version', receiptFirst: true })
    expect(steps.find((s) => s.path === '3')).toMatchObject({ kind: 'version', receiptFirst: false })
    expect(steps.find((s) => s.path === 'downloads/9')).toMatchObject({ kind: 'downloads', n: 9 })
  })

  it('keeps an older pack while there is no complete pack of the manifest’s number', () => {
    expect(paths({ ...base, currentComplete: false })).toEqual(['3', 'downloads/1', 'downloads/9'])
  })

  it('keeps an older pack a live instance has in use, or while a record names no pack', () => {
    expect(paths({ ...base, inUse: [1] })).not.toContain('1')
    expect(paths({ ...base, inUse: [null] })).not.toContain('1')
    expect(paths({ ...base, inUse: [2] })).toContain('1')
  })

  it('removes nothing at all while another live instance holds the lock', () => {
    expect(sweepPlan({ ...base, lockedElsewhere: true })).toEqual([])
  })
})
