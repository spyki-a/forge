import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { helperPythonFor } from './integration/venv'

/*
 * scripts/pe-imports.py, the Windows CI job's listing of the pack's native
 * imports (docs/CLIPS.md §3a.6 step 5): every .pyd and .dll's import and
 * delay-load directories, filtered to what Windows would not find without
 * help, with Microsoft's C++ runtimes always listed.
 *
 * Run against a tiny hand-built PE tree on every machine (the bytes written
 * here, by the PE/COFF layout), and against the pinned interpreter's real
 * Windows tree when it is unpacked on this disk (the row 26 scratch folder).
 */

const ROOT = resolve(__dirname, '..')
const SCRIPT = join(ROOT, 'scripts', 'pe-imports.py')
const EXPECTED = join(ROOT, 'tests', 'fixtures', 'pack-native-imports-win32.json')
/** The real archive's tree (§3a.8 row 26's scratch unpack on the dev Mac), or another named by FORGE_PE_TREE. */
const REAL_TREE = process.env.FORGE_PE_TREE || '/private/tmp/claude-501/-Users-spyker-my-claude/c20fe2df-facd-4bef-a6b9-df41e326182a/scratchpad/row26/win'
// Any interpreter: the script is the standard library only. The development order's bare rung, never a pack.
const PYTHON = helperPythonFor({ venvPython: null, env: process.env, platform: process.platform })

interface Entry {
  file: string
  imports: string
  delay: boolean
  resolves: string
  copies: string[]
}
interface Listing {
  recorded: boolean
  files: number
  imports: Entry[]
  unreadable: { file: string; error: string }[]
  note?: string
}

function run(...args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(PYTHON, ['-I', SCRIPT, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/**
 * A minimal PE32+ image, by the PE/COFF layout: a DOS header pointing at the
 * PE signature, the COFF header, a 240-byte optional header whose data
 * directory 1 is the import table and 13 the delay-load table, and one
 * section at RVA 0x1000 (file offset 0x200) holding both tables and the names.
 */
function pe(imports: string[], delayed: string[] = []): Buffer {
  const b = Buffer.alloc(0x1200)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(0x40, 0x3c)
  b.write('PE\0\0', 0x40, 'latin1')
  const coff = 0x44
  b.writeUInt16LE(0x8664, coff) // AMD64
  b.writeUInt16LE(1, coff + 2) // one section
  b.writeUInt16LE(240, coff + 16) // SizeOfOptionalHeader
  b.writeUInt16LE(0x2022, coff + 18) // a DLL
  const opt = coff + 20
  b.writeUInt16LE(0x20b, opt) // PE32+
  b.writeBigUInt64LE(0x180000000n, opt + 24) // ImageBase
  b.writeUInt32LE(16, opt + 108) // NumberOfRvaAndSizes
  const dir = (index: number, rva: number, size: number): void => {
    b.writeUInt32LE(rva, opt + 112 + 8 * index)
    b.writeUInt32LE(size, opt + 112 + 8 * index + 4)
  }
  const section = opt + 240
  b.write('.idata', section, 'latin1')
  b.writeUInt32LE(0x1000, section + 8) // VirtualSize
  b.writeUInt32LE(0x1000, section + 12) // VirtualAddress
  b.writeUInt32LE(0x1000, section + 16) // SizeOfRawData
  b.writeUInt32LE(0x200, section + 20) // PointerToRawData
  const at = (rva: number): number => rva - 0x1000 + 0x200
  let names = 0x1800
  const name = (text: string): number => {
    const rva = names
    b.write(`${text}\0`, at(rva), 'latin1')
    names += text.length + 1
    return rva
  }
  if (imports.length > 0) {
    imports.forEach((dll, i) => b.writeUInt32LE(name(dll), at(0x1000 + 20 * i) + 12))
    dir(1, 0x1000, 20 * (imports.length + 1))
  }
  if (delayed.length > 0) {
    delayed.forEach((dll, i) => {
      b.writeUInt32LE(1, at(0x1400 + 32 * i)) // RVA-based
      b.writeUInt32LE(name(dll), at(0x1400 + 32 * i) + 4)
    })
    dir(13, 0x1400, 32 * (delayed.length + 1))
  }
  return b
}

const MOD = 'python/Lib/site-packages/pkg/_mod.cp314-win_amd64.pyd'
let tree = ''

function put(rel: string, bytes: Buffer | string): void {
  const path = join(tree, ...rel.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

beforeAll(() => {
  tree = mkdtempSync(join(tmpdir(), 'forge-pe-'))
  put('python/python.exe', 'not scanned: only .pyd and .dll are')
  put('python/vcruntime140.dll', pe([]))
  put('python/python314.dll', pe(['KERNEL32.dll', 'VCRUNTIME140.dll']))
  put(MOD, pe(['KERNEL32.dll', 'VCRUNTIME140.dll', 'MSVCP140.dll', 'python314.dll', 'libbar.dll', 'LIBBAZ.DLL', 'libfoo.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'], ['cudart64_12.dll']))
  put('python/Lib/site-packages/pkg/libbar.dll', pe([]))
  put('python/Lib/site-packages/pkg.libs/libbaz.dll', pe([]))
})

afterAll(() => {
  if (tree) rmSync(tree, { recursive: true, force: true })
})

describe('a hand-built PE tree', () => {
  it('reads each file’s import and delay-load directories, in order', () => {
    const r = run(tree, '--raw')
    expect(r.code, r.stderr).toBe(0)
    const raw = JSON.parse(r.stdout) as Record<string, string[]>
    expect(raw['python/python314.dll']).toEqual(['KERNEL32.dll', 'VCRUNTIME140.dll'])
    expect(raw[MOD]).toEqual(['KERNEL32.dll', 'VCRUNTIME140.dll', 'MSVCP140.dll', 'python314.dll', 'libbar.dll', 'LIBBAZ.DLL', 'libfoo.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'cudart64_12.dll'])
    expect(raw['python/vcruntime140.dll']).toEqual([])
  })

  it('lists what Windows would not find without help, and the C++ runtimes wherever they resolve', () => {
    const r = run(tree)
    expect(r.code, r.stderr).toBe(0)
    const listing = JSON.parse(r.stdout) as Listing
    expect(listing.files).toBe(5)
    expect(listing.unreadable).toEqual([])
    const shape = listing.imports.map((e) => `${e.file} | ${e.imports} | ${e.resolves}${e.delay ? ' | delay' : ''} | ${e.copies.join(' ')}`)
    expect(shape).toEqual([
      `${MOD} | cudart64_12.dll | not in the pack | delay | `,
      `${MOD} | LIBBAZ.DLL | elsewhere in the pack | python/Lib/site-packages/pkg.libs/libbaz.dll`,
      `${MOD} | libfoo.dll | not in the pack | `,
      `${MOD} | MSVCP140.dll | not in the pack | `,
      `${MOD} | VCRUNTIME140.dll | python.exe's folder | python/vcruntime140.dll`,
      'python/python314.dll | VCRUNTIME140.dll | beside it | python/vcruntime140.dll'
    ])
    // Windows' own (KERNEL32, the API sets), what sits beside (libbar) and python.exe's folder (python314) are not listed.
    expect(listing.imports.map((e) => e.imports.toLowerCase())).not.toContain('kernel32.dll')
  })

  it('--expected passes on the same list, fails on a new import by name, and compares nothing while it is a bootstrap', () => {
    const record = join(tree, '..', `${tree.split(/[\\/]/).at(-1)}-record.json`)
    try {
      expect(run(tree, '--record', record).code).toBe(0)
      const recorded = JSON.parse(readFileSync(record, 'utf8')) as Listing
      expect(recorded.recorded).toBe(true)
      expect(run(tree, '--expected', record).code).toBe(0)

      // The pack gains a need: the expected list without MSVCP140's line.
      writeFileSync(record, JSON.stringify({ ...recorded, imports: recorded.imports.filter((e) => e.imports !== 'MSVCP140.dll') }))
      const failed = run(tree, '--expected', record)
      expect(failed.code).toBe(1)
      expect(failed.stderr).toContain(`NEW: ${MOD} imports MSVCP140.dll, not in the pack; copies in the pack: none`)

      // A runtime that resolved beside its file and no longer does is new too: the key holds where it resolves.
      writeFileSync(record, JSON.stringify({ ...recorded, imports: recorded.imports.map((e) => (e.imports === 'VCRUNTIME140.dll' && e.file === MOD ? { ...e, resolves: 'beside it' } : e)) }))
      expect(run(tree, '--expected', record).code).toBe(1)

      writeFileSync(record, JSON.stringify({ ...recorded, recorded: false, imports: [] }))
      const bootstrap = run(tree, '--expected', record)
      expect(bootstrap.code).toBe(0)
      expect(bootstrap.stderr).toContain('is a bootstrap (recorded: false): listed, nothing compared')
    } finally {
      rmSync(record, { force: true })
    }
  })

  it('fails on a .dll that is not a PE, and on a folder with none', () => {
    const bad = mkdtempSync(join(tmpdir(), 'forge-pe-bad-'))
    try {
      writeFileSync(join(bad, 'notes.dll'), 'MZ but nothing after')
      const r = run(bad)
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('UNREADABLE: notes.dll:')
      rmSync(join(bad, 'notes.dll'))
      const none = run(bad)
      expect(none.code).toBe(1)
      expect(none.stderr).toContain('no .pyd or .dll under')
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })
})

describe('the committed expected list', () => {
  const committed = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Listing

  it('is the bootstrap until CI’s first Windows list is committed, and every entry has its five fields', () => {
    expect(typeof committed.recorded).toBe('boolean')
    if (!committed.recorded) expect(committed.note).toContain('bootstrap')
    for (const e of committed.imports) {
      expect(Object.keys(e).sort(), JSON.stringify(e)).toEqual(['copies', 'delay', 'file', 'imports', 'resolves'])
    }
  })

  it.skipIf(!existsSync(REAL_TREE))('holds the pinned interpreter’s real Windows tree: python314.dll imports KERNEL32 and VCRUNTIME140, and only VCRUNTIME140 and _1 are listed, each in the pack (EFFECTS §57)', () => {
    const raw = JSON.parse(run(REAL_TREE, '--raw').stdout) as Record<string, string[]>
    expect(raw['python/python314.dll']).toEqual(expect.arrayContaining(['KERNEL32.dll', 'VCRUNTIME140.dll']))
    const r = run(REAL_TREE, '--expected', EXPECTED)
    expect(r.code, r.stderr).toBe(0)
    const listing = JSON.parse(r.stdout) as Listing
    expect(listing.files).toBe(48)
    expect(new Set(listing.imports.map((e) => e.imports.toLowerCase()))).toEqual(new Set(['vcruntime140.dll', 'vcruntime140_1.dll']))
    for (const e of listing.imports) expect(e.resolves, e.file).not.toBe('not in the pack')
    // The bootstrap is this tree's list: every entry of it is in the committed file, by (file, DLL, where).
    const key = (e: Entry): string => `${e.file}|${e.imports.toLowerCase()}|${e.resolves}`
    const want = new Set(committed.imports.map(key))
    expect(listing.imports.map(key).filter((k) => !want.has(k))).toEqual([])
  })
})
