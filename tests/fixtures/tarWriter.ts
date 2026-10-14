/**
 * A tiny tar writer for the streaming reader's and the unpacker's tests
 * (tests/tarStream.test.ts, tests/unpack.test.ts): every header shape the
 * readers must take, written byte for byte — POSIX ustar with the prefix
 * field, PAX `x` and `g` records, GNU `L` and `K` long names, symlinks, hard
 * links, devices, folders. Not a general writer: it writes what it is told,
 * including archives no honest writer would make, which is the point.
 */

export type TarSpec =
  | {
      kind?: 'file'
      /** The full name; split into prefix + name when `split` says so. */
      name: string
      body?: Uint8Array | string
      mode?: number
      /** 'prefix': the ustar prefix field carries the head (POSIX magic). 'pax': a PAX `path` record carries it. 'gnu': a GNU `L` record. */
      long?: 'prefix' | 'pax' | 'gnu'
      /** The header's own type flag, overriding '0'. */
      type?: string
      /** GNU magic (`ustar  \0`) instead of POSIX's, as the library packs' test writer uses. */
      gnuMagic?: boolean
    }
  | { kind: 'symlink'; name: string; target: string; long?: 'pax' | 'gnu' }
  | { kind: 'hardlink'; name: string; target: string }
  | { kind: 'directory'; name: string; mode?: number }
  | { kind: 'device'; name: string }
  | { kind: 'pax'; scope: 'x' | 'g'; records: Record<string, string> }
  | { kind: 'raw'; bytes: Uint8Array }

const enc = new TextEncoder()
const bytes = (body: Uint8Array | string | undefined): Uint8Array =>
  body === undefined ? new Uint8Array(0) : typeof body === 'string' ? enc.encode(body) : body

interface HeaderFields {
  name: string
  prefix?: string
  mode?: number
  size: number
  type: string
  linkname?: string
  gnuMagic?: boolean
}

export function tarHeader(h: HeaderFields): Uint8Array {
  const header = new Uint8Array(512)
  const put = (text: string, at: number, len: number): void => {
    const b = enc.encode(text)
    if (b.length > len) throw new Error(`tarWriter: ${JSON.stringify(text)} does not fit ${len} bytes`)
    header.set(b, at)
  }
  put(h.name, 0, 100)
  put((h.mode ?? 0o644).toString(8).padStart(7, '0'), 100, 8)
  put('0000000', 108, 8)
  put('0000000', 116, 8)
  put(h.size.toString(8).padStart(11, '0'), 124, 12)
  put('14540000000', 136, 12) // 2024-01-01, as the real archives
  header[156] = h.type.charCodeAt(0)
  if (h.linkname) put(h.linkname, 157, 100)
  if (h.gnuMagic) {
    put('ustar  ', 257, 8)
  } else {
    put('ustar', 257, 6) // and its NUL
    put('00', 263, 2)
  }
  if (h.prefix) put(h.prefix, 345, 155)
  for (let i = 148; i < 156; i++) header[i] = 0x20
  let sum = 0
  for (let i = 0; i < 512; i++) sum += header[i]
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return header
}

/** A PAX record set, each `<length> <key>=<value>\n` with the length counting its own digits, in bytes. */
export function paxBody(records: Record<string, string>): Uint8Array {
  let text = ''
  for (const [key, value] of Object.entries(records)) {
    const rest = ` ${key}=${value}\n`
    const restBytes = enc.encode(rest).length
    let length = restBytes + 1
    while (String(length).length + restBytes !== length) length = String(length).length + restBytes
    text += `${length}${rest}`
  }
  return enc.encode(text)
}

function padded(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(body.length / 512) * 512)
  out.set(body)
  return out
}

/** A name cut to fit the header's own field, the way a writer leaves it when a record carries the whole. */
function truncated(name: string): string {
  let cut = name.slice(0, 99)
  while (/[/. ]$/.test(cut)) cut = cut.slice(0, -1)
  return cut
}

function splitPrefix(name: string): { prefix: string; name: string } {
  for (let i = name.length - 1; i > 0; i--) {
    if (name[i] !== '/') continue
    const prefix = name.slice(0, i)
    const rest = name.slice(i + 1)
    if (rest.length <= 100 && enc.encode(prefix).length <= 155) return { prefix, name: rest }
  }
  throw new Error(`tarWriter: ${name} cannot be split into prefix and name`)
}

export function tarOf(specs: TarSpec[], o: { end?: boolean } = {}): Uint8Array {
  const blocks: Uint8Array[] = []
  const longRecord = (style: 'pax' | 'gnu', key: 'path' | 'linkpath', value: string): void => {
    if (style === 'pax') {
      const body = paxBody({ [key]: value })
      blocks.push(tarHeader({ name: 'PaxHeaders/long', size: body.length, type: 'x' }), padded(body))
    } else {
      const body = enc.encode(value + '\0')
      blocks.push(tarHeader({ name: '././@LongLink', size: body.length, type: key === 'path' ? 'L' : 'K' }), padded(body))
    }
  }
  for (const spec of specs) {
    switch (spec.kind) {
      case 'raw':
        blocks.push(spec.bytes)
        break
      case 'pax': {
        const body = paxBody(spec.records)
        blocks.push(tarHeader({ name: 'PaxHeaders/records', size: body.length, type: spec.scope }), padded(body))
        break
      }
      case 'symlink': {
        let name = spec.name
        let target = spec.target
        if (spec.long) {
          longRecord(spec.long, 'path', spec.name)
          longRecord(spec.long, 'linkpath', spec.target)
          name = truncated(spec.name)
          target = truncated(spec.target)
        }
        blocks.push(tarHeader({ name, size: 0, type: '2', linkname: target, mode: 0o775 }))
        break
      }
      case 'hardlink':
        blocks.push(tarHeader({ name: spec.name, size: 0, type: '1', linkname: spec.target }))
        break
      case 'directory':
        blocks.push(tarHeader({ name: spec.name.endsWith('/') ? spec.name : `${spec.name}/`, size: 0, type: '5', mode: spec.mode ?? 0o755 }))
        break
      case 'device':
        blocks.push(tarHeader({ name: spec.name, size: 0, type: '3' }))
        break
      default: {
        const body = bytes(spec.body)
        let name = spec.name
        let prefix: string | undefined
        if (spec.long === 'prefix') ({ prefix, name } = splitPrefix(spec.name))
        else if (spec.long) {
          longRecord(spec.long, 'path', spec.name)
          name = truncated(spec.name)
        }
        blocks.push(
          tarHeader({ name, prefix, size: body.length, type: spec.type ?? '0', mode: spec.mode, gnuMagic: spec.gnuMagic }),
          padded(body)
        )
      }
    }
  }
  if (o.end !== false) blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of blocks) {
    out.set(b, at)
    at += b.length
  }
  return out
}

/** A seeded generator (mulberry32), so a property's random cuts are the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Bytes that are not all alike, so a shifted or cut copy shows. */
export function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  const next = seeded(seed)
  for (let i = 0; i < n; i++) out[i] = Math.floor(next() * 256)
  return out
}
