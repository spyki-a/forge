import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { safeMemberPath } from '@shared/assets/pack'
import { readTar, TarError, TarStream, type TarMember } from '@shared/assets/tar'
import { noise, paxBody, seeded, tarHeader, tarOf, type TarSpec } from './fixtures/tarWriter'

/*
 * The streaming tar reader (docs/CLIPS.md §3a.3 stage 2, §3a.7): the AI
 * helper's interpreter is a 69 MB tar stream, read chunk by chunk as gunzip
 * hands it over. Row 26 (EFFECTS §57) read the real archives: POSIX ustar,
 * names over 100 characters in the prefix field, no PAX, no GNU records, no
 * directory entries, nine relative symlinks on the Mac. The reader takes those
 * and every other way a name can be carried, and refuses what could write
 * outside its folder.
 *
 * Every archive here is built by tests/fixtures/tarWriter.ts.
 */

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

interface Read {
  name: string
  type: TarMember['type']
  size: number
  mode: number
  linkname?: string
  /** sha256 of the bytes handed out, for a file. */
  sha?: string
}

/** Push `tar` in the given pieces; every member, with its bytes joined and hashed. */
function readStream(tar: Uint8Array, cuts: number[]): Read[] {
  const stream = new TarStream(safeMemberPath)
  const out: Read[] = []
  let parts: Uint8Array[] = []
  let at = 0
  for (const cut of [...cuts, tar.length]) {
    for (const event of stream.push(tar.slice(at, cut))) {
      if (event.kind === 'member') {
        const m = event.member
        out.push({ name: m.name, type: m.type, size: m.size, mode: m.mode, ...(m.linkname !== undefined ? { linkname: m.linkname } : {}) })
        parts = []
      } else if (event.kind === 'data') {
        parts.push(event.bytes.slice())
      } else {
        const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
        let o = 0
        for (const p of parts) {
          joined.set(p, o)
          o += p.length
        }
        out[out.length - 1].sha = sha(joined)
      }
    }
    at = cut
  }
  stream.end()
  return out
}

/** `count` sorted cut points in (0, length), from a seeded generator. */
function randomCuts(length: number, count: number, next: () => number): number[] {
  const cuts = new Set<number>()
  while (cuts.size < Math.min(count, length - 1)) cuts.add(1 + Math.floor(next() * (length - 1)))
  return [...cuts].sort((a, b) => a - b)
}

// Names as long as the real ones: 106 characters through the prefix field, as pip's licence files are.
const PREFIX_NAME = 'python/lib/python3.14/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/cachecontrol/LICENSE.txt'
const GNU_NAME = `python/lib/python3.14/site-packages/${'g'.repeat(70)}/gnu_long_name_${'n'.repeat(20)}.py`
const PAX_NAME = `python/lib/python3.14/site-packages/${'p'.repeat(60)}/ünïcødé_${'x'.repeat(41)}.pyc`

/** What both readers can read: regular files of every awkward size, the prefix name, the GNU name, and modes. */
const PLAIN: TarSpec[] = [
  { name: 'python/bin/python3.14', body: noise(1500, 1), mode: 0o775 },
  { name: 'python/lib/python3.14/os.py', body: noise(512, 2), mode: 0o664 },
  { name: 'python/lib/python3.14/empty.py', body: '', mode: 0o664 },
  { name: 'python/lib/python3.14/one.py', body: noise(1, 3), mode: 0o664 },
  { name: 'python/lib/python3.14/odd.py', body: noise(513, 4), mode: 0o644 },
  { name: PREFIX_NAME, body: noise(700, 5), long: 'prefix', mode: 0o664 },
  { name: GNU_NAME, body: noise(2049, 6), long: 'gnu', mode: 0o664 },
  { name: 'python/bin/pip', body: noise(234, 7), mode: 0o775 }
]

describe('TarStream reads what readTar reads, however the stream is cut', () => {
  const tar = tarOf(PLAIN)
  const expected: Read[] = readTar(tar, safeMemberPath).map((e) => ({
    name: e.name,
    type: 'file',
    size: e.size,
    mode: e.mode,
    sha: sha(tar.subarray(e.offset, e.offset + e.size))
  }))

  it('readTar sees the eight files, the long names whole', () => {
    expect(expected.map((e) => e.name)).toEqual(PLAIN.map((s) => (s as { name: string }).name))
    expect(PREFIX_NAME).toHaveLength(106)
    expect(GNU_NAME.length).toBeGreaterThan(100)
  })

  it('in one piece, byte by byte, and over 300 seeded random cuttings', () => {
    expect(readStream(tar, [])).toEqual(expected)
    expect(readStream(tar, Array.from({ length: tar.length - 1 }, (_, i) => i + 1))).toEqual(expected)
    const next = seeded(20261014)
    for (let run = 0; run < 300; run++) {
      const cuts = randomCuts(tar.length, 1 + Math.floor(next() * 40), next)
      expect(readStream(tar, cuts), `cuts ${cuts.join(',')}`).toEqual(expected)
    }
  })
})

describe('what readTar does not read', () => {
  const FULL: TarSpec[] = [
    { kind: 'pax', scope: 'g', records: { comment: 'a global record, which names nothing' } },
    ...PLAIN.slice(0, 2),
    { name: PAX_NAME, body: noise(900, 8), long: 'pax', mode: 0o664 },
    { kind: 'symlink', name: 'python/bin/python3', target: 'python3.14' },
    { kind: 'symlink', name: 'python/share/man/man1/python3.1', target: '../../../bin/python3.14' },
    { kind: 'directory', name: 'python/include/empty' },
    ...PLAIN.slice(2)
  ]
  const tar = tarOf(FULL)
  const once = readStream(tar, [])

  it('a 150-character name carried only in a PAX path record lands under that name', () => {
    expect(PAX_NAME.length).toBeGreaterThanOrEqual(150)
    const member = once.find((m) => m.sha === sha(noise(900, 8)))
    expect(member?.name).toBe(PAX_NAME)
  })

  it('the 106-character name split across prefix and name lands whole', () => {
    expect(once.map((m) => m.name)).toContain(PREFIX_NAME)
  })

  it('bin/python3 -> python3.14 is accepted, and a target that climbs and stays inside too', () => {
    expect(once).toContainEqual({ name: 'python/bin/python3', type: 'symlink', size: 0, mode: 0o775, linkname: 'python3.14' })
    expect(once).toContainEqual(
      expect.objectContaining({ name: 'python/share/man/man1/python3.1', type: 'symlink', linkname: '../../../bin/python3.14' })
    )
  })

  it('a folder entry is handed out as a folder, without its slash', () => {
    expect(once).toContainEqual(expect.objectContaining({ name: 'python/include/empty', type: 'directory' }))
  })

  it('the same members for any cutting', () => {
    expect(once).toHaveLength(FULL.length - 1)
    const next = seeded(7)
    for (let run = 0; run < 200; run++) {
      const cuts = randomCuts(tar.length, 1 + Math.floor(next() * 30), next)
      expect(readStream(tar, cuts), `cuts ${cuts.join(',')}`).toEqual(once)
    }
  })

  it('a PAX linkpath and a GNU K record carry a long target', () => {
    const longTarget = `${'t'.repeat(60)}/${'u'.repeat(60)}/python3.14`
    for (const long of ['pax', 'gnu'] as const) {
      const read = readStream(tarOf([{ kind: 'symlink', name: `python/bin/${'l'.repeat(110)}`, target: longTarget, long }]), [])
      expect(read).toEqual([{ name: `python/bin/${'l'.repeat(110)}`, type: 'symlink', size: 0, mode: 0o775, linkname: longTarget }])
    }
  })

  it('a global PAX path applies to the members after it', () => {
    const read = readStream(tarOf([{ kind: 'pax', scope: 'g', records: { path: 'python/global.txt' } }, { name: 'ignored.txt', body: 'x' }]), [])
    expect(read.map((m) => m.name)).toEqual(['python/global.txt'])
  })

  it('a PAX record’s length counts bytes, not characters', () => {
    // 'ü' is two bytes: the record is 11 bytes and 10 characters, and its length says 11.
    const record = paxBody({ path: 'ü' })
    expect(record).toHaveLength(11)
    expect(new TextDecoder().decode(record)).toBe('11 path=ü\n')
    const read = readStream(tarOf([{ kind: 'pax', scope: 'x', records: { path: 'python/ü.txt' } }, { name: 'x.txt', body: 'x' }]), [])
    expect(read.map((m) => m.name)).toEqual(['python/ü.txt'])
  })
})

describe('what is refused', () => {
  const refused = (specs: TarSpec[]): string => {
    try {
      readStream(tarOf(specs), [])
    } catch (err) {
      expect(err).toBeInstanceOf(TarError)
      return (err as Error).message
    }
    throw new Error('expected the archive to be refused')
  }

  it('a symlink that climbs out of the root, or names an absolute path', () => {
    expect(refused([{ kind: 'symlink', name: 'python/bin/x', target: '../../../x' }])).toContain('points outside its directory')
    expect(refused([{ kind: 'symlink', name: 'python/x', target: '../../x' }])).toContain('points outside its directory')
    expect(refused([{ kind: 'symlink', name: 'python/x', target: '/etc/x' }])).toContain('points outside its directory')
    expect(refused([{ kind: 'symlink', name: 'python/x', target: 'C:/Windows/x' }])).toContain('points outside its directory')
    expect(refused([{ kind: 'symlink', name: 'python/x', target: 'a\\..\\..\\x' }])).toContain('points outside its directory')
  })

  it('a `..` after a name, which only resolves on paper while that name is a folder', () => {
    expect(refused([{ kind: 'symlink', name: 'python/x', target: 'lib/..' }])).toContain('points outside its directory')
  })

  it('anything at or under a path the archive made a link, so nothing is written through one', () => {
    expect(
      refused([
        { kind: 'symlink', name: 'python/lib', target: 'other' },
        { name: 'python/lib/os.py', body: 'x' }
      ])
    ).toContain('written through the link python/lib')
    expect(
      refused([
        { kind: 'symlink', name: 'python/bin/python3', target: 'python3.14' },
        { name: 'python/bin/python3', body: 'x' }
      ])
    ).toContain('written through the link python/bin/python3')
  })

  it('under a link, judged as a case-insensitive file system judges a name: X and x, é composed and decomposed', () => {
    // On APFS and NTFS `python/x/os.py` is written through the link `python/X`.
    expect(
      refused([
        { kind: 'symlink', name: 'python/X', target: 'other' },
        { name: 'python/x/os.py', body: 'x' }
      ])
    ).toContain('written through the link python/X')
    expect(
      refused([
        { kind: 'symlink', name: 'python/é', target: 'other' },
        { name: 'python/é/os.py', body: 'x' }
      ])
    ).toContain('written through the link python/é')
    expect(
      refused([
        { kind: 'symlink', name: 'python/lib/ÉTÉ', target: 'other' },
        { kind: 'symlink', name: 'python/lib/été', target: 'other' }
      ])
    ).toContain('written through the link python/lib/ÉTÉ')
  })

  it('a link one level shallower than its name, then a case variant of it, cannot be climbed out of', () => {
    // The real escape on APFS: `a/x` IS `a/X` = `c`, so `a/x/y/L` lands at `c/y/L`, one level
    // shallower than its name, and its `../../..` — inside on paper — climbs out of the root.
    expect(
      refused([
        { name: 'python/c/keep.txt', body: 'x' },
        { kind: 'symlink', name: 'python/a/X', target: '../c' },
        { kind: 'symlink', name: 'python/a/x/y/L', target: '../../../../other' },
        { name: 'python/a/x/y/l/evil.txt', body: 'x' }
      ])
    ).toContain('written through the link python/a/X')
  })

  it('a link to its own folder or to one above it, which only makes a loop', () => {
    expect(refused([{ kind: 'symlink', name: 'X', target: '.' }])).toContain('its own folder or one above it')
    expect(refused([{ kind: 'symlink', name: 'python/x', target: '.' }])).toContain('its own folder or one above it')
    expect(refused([{ kind: 'symlink', name: 'python/a/b/L', target: '../..' }])).toContain('its own folder or one above it')
    expect(refused([{ kind: 'symlink', name: 'python/a/L', target: '..' }])).toContain('its own folder or one above it')
    // A case variant of an ancestor is that ancestor.
    expect(refused([{ kind: 'symlink', name: 'python/a/L', target: '../../PYTHON' }])).toContain('its own folder or one above it')
    // A sibling, or a cousin, is not.
    expect(readStream(tarOf([{ kind: 'symlink', name: 'python/a/b/L', target: '../../c' }]), []).map((m) => m.name)).toEqual(['python/a/b/L'])
  })

  it('a hard link, a device, a GNU sparse member and a PAX sparse one', () => {
    expect(refused([{ kind: 'hardlink', name: 'python/bin/python3', target: 'python/bin/python3.14' }])).toContain('hard link')
    expect(refused([{ kind: 'device', name: 'python/dev/null' }])).toContain('device')
    expect(refused([{ name: 'python/sparse.bin', body: 'x', type: 'S' }])).toContain('sparse')
    expect(refused([{ kind: 'pax', scope: 'x', records: { 'GNU.sparse.major': '1' } }, { name: 'python/sparse.bin', body: 'x' }])).toContain('sparse')
  })

  it('a member name that escapes, as readTar refuses it', () => {
    expect(refused([{ name: '../evil.py', body: 'x' }])).toContain('escapes its directory')
    // Carried by a PAX record, which is checked like any other name.
    expect(refused([{ name: `python/${'a'.repeat(120)}/../../../etc/passwd`, body: 'x', long: 'pax' }])).toContain('escapes its directory')
  })

  it('an archive that stops inside a member, or inside a header', () => {
    const tar = tarOf([{ name: 'python/os.py', body: noise(1000) }], { end: false })
    expect(() => readStream(tar.slice(0, 512 + 300), [])).toThrow('ended inside python/os.py')
    expect(() => readStream(tar.slice(0, 200), [])).toThrow('ended inside a header')
  })

  it('a header whose checksum does not add up', () => {
    const header = tarHeader({ name: 'python/os.py', size: 0, type: '0' })
    header[0] ^= 1
    expect(refused([{ kind: 'raw', bytes: header }])).toContain('Corrupt tar header at byte 0')
  })
})
