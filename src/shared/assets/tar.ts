/**
 * Reading a tar archive, in pure TypeScript.
 *
 * Packs are `.tar.gz` rather than `.zip` for one reason: Node can gunzip with
 * `node:zlib` and tar's format is simple enough to parse here, so installing a
 * pack needs no native dependency, no bundled binary and no `tar` on the user's
 * PATH. A zip would have meant adding one of those three, and every one of them
 * is a thing that can be missing on a machine we cannot see — which this project
 * has now spent a day learning about.
 *
 * It also means the parsing is PURE, so the member-path safety and the header
 * arithmetic are tested without writing a single file to disk.
 *
 * Only what a pack actually contains is supported: regular files and
 * directories, plus GNU long names. Symlinks, hard links, devices and sparse
 * files are refused rather than ignored — a pack containing one is not a pack
 * we made, and quietly skipping it would be the wrong answer to that.
 */

export interface TarEntry {
  /** The member's path inside the archive, already checked for safety. */
  name: string
  /** Byte offset of the member's contents within the tar buffer. */
  offset: number
  size: number
  /** Unix mode bits, for restoring the executable bit where it matters. */
  mode: number
}

const BLOCK = 512

/**
 * A NUL-terminated header field, read verbatim.
 *
 * Deliberately NOT trimmed. Tar NUL-pads names and space-pads only its numeric
 * fields, so trimming here would silently rewrite a member called `report.txt `
 * into `report.txt` — turning a name Windows cannot create into one it can,
 * and writing a file the archive did not describe. `safeMemberPath` must be the
 * thing that refuses it, which it cannot do if this has already tidied it away.
 */
function str(buffer: Uint8Array, start: number, length: number): string {
  let end = start
  const limit = start + length
  while (end < limit && buffer[end] !== 0) end++
  return new TextDecoder().decode(buffer.subarray(start, end))
}

/** Sizes and modes are octal ASCII, space- or NUL-padded. */
function octal(buffer: Uint8Array, start: number, length: number): number {
  const text = str(buffer, start, length).replace(/[^0-7]/g, '')
  if (!text) return 0
  const value = parseInt(text, 8)
  return Number.isFinite(value) ? value : 0
}

/**
 * The header checksum, which is what tells a real header from padding.
 *
 * Computed with the checksum field itself read as eight spaces — that is the
 * spec, and getting it wrong means every header looks corrupt. Both the signed
 * and unsigned sums are accepted because historic writers disagreed about
 * whether the bytes were signed, and some archives in the wild use each.
 */
function checksumMatches(header: Uint8Array): boolean {
  const stored = octal(header, 148, 8)
  let unsigned = 0
  let signed = 0
  for (let i = 0; i < BLOCK; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : header[i]
    unsigned += byte
    signed += byte > 127 ? byte - 256 : byte
  }
  return stored === unsigned || stored === signed
}

export class TarError extends Error {}

/**
 * Every file in the archive, with where its bytes are.
 *
 * Returns offsets rather than copies so a 150MB pack is walked without being
 * duplicated in memory.
 *
 * `isSafe` decides which member paths are allowed. It is injected rather than
 * imported so this file stays free of any policy — the caller owns that, and
 * `safeMemberPath` in pack.ts is what it passes.
 */
export function readTar(buffer: Uint8Array, isSafe: (name: string) => string | null): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  /** GNU long name, when the previous header was an 'L' record. */
  let pendingName: string | null = null

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK)

    // Two consecutive zero blocks end the archive; one is padding.
    if (header.every((byte) => byte === 0)) {
      offset += BLOCK
      continue
    }
    if (!checksumMatches(header)) {
      throw new TarError(`Corrupt tar header at byte ${offset}`)
    }

    const rawName = pendingName ?? str(header, 0, 100)
    const prefix = str(header, 345, 155)
    const name = pendingName === null && prefix ? `${prefix}/${rawName}` : rawName
    pendingName = null

    const size = octal(header, 124, 12)
    const mode = octal(header, 100, 8)
    const type = String.fromCharCode(header[156] || 0x30)
    const dataAt = offset + BLOCK
    // Contents are padded to a block boundary.
    const advance = BLOCK + Math.ceil(size / BLOCK) * BLOCK

    if (dataAt + size > buffer.length) {
      throw new TarError(`Truncated tar: ${name} claims ${size} bytes past the end`)
    }

    if (type === 'L') {
      // GNU long name: this record's CONTENTS are the next member's path.
      pendingName = new TextDecoder().decode(buffer.subarray(dataAt, dataAt + size)).replace(/\0+$/, '')
      offset += advance
      continue
    }

    if (type === '0' || type === '\0') {
      const safe = isSafe(name)
      if (safe === null) {
        throw new TarError(`Refusing a tar member that escapes its directory: ${name}`)
      }
      entries.push({ name: safe, offset: dataAt, size, mode })
    } else if (type === '5' || type === 'x' || type === 'g') {
      // Directory, or a pax header we do not need — both carry nothing to write.
    } else {
      // A symlink, hard link or device node. Not something our packs contain,
      // and following one is how an archive writes outside its directory.
      throw new TarError(`Unsupported tar entry type '${type}' for ${name}`)
    }

    offset += advance
  }

  return entries
}

/* ------------------------------------------------------------ streaming */

/** A member `TarStream` hands out: what to make, where, and with which mode. */
export interface TarMember {
  /** The member's path inside the archive, already checked for safety, with no trailing slash. */
  name: string
  /** Bytes of content: a file's; 0 for a link or a folder. */
  size: number
  /** Unix mode bits, for restoring the executable bit where it matters. */
  mode: number
  type: 'file' | 'symlink' | 'directory'
  /** A symlink's target, as the archive wrote it: relative, and inside the root (checked). */
  linkname?: string
}

/**
 * What one `push` found, in archive order. A file is a `member`, then its
 * bytes as `data` (zero or more slices of the chunks pushed, never copied),
 * then `end`; a symlink or a folder is a `member` alone.
 */
export type TarEvent = { kind: 'member'; member: TarMember } | { kind: 'data'; bytes: Uint8Array } | { kind: 'end' }

/** A PAX or GNU long-name record bigger than this is not a name: refused, rather than held in memory. */
const META_LIMIT = 1 << 20

/** POSIX ustar's magic and version, `ustar\0` `00`: the only format whose bytes 345-499 are a name prefix. */
function isPosixUstar(header: Uint8Array): boolean {
  return (
    header[257] === 0x75 && // u
    header[258] === 0x73 && // s
    header[259] === 0x74 && // t
    header[260] === 0x61 && // a
    header[261] === 0x72 && // r
    header[262] === 0
  )
}

/**
 * A size field: octal ASCII, or GNU's base-256 (the high bit of the first byte
 * set) for a member past 8 GB. Refused rather than misread when it is negative
 * or past what a JavaScript number holds exactly.
 */
function sizeField(header: Uint8Array): number {
  if ((header[124] & 0x80) === 0) return octal(header, 124, 12)
  if (header[124] & 0x40) throw new TarError('A tar member claims a negative size')
  let value = header[124] & 0x3f
  for (let i = 125; i < 136; i++) value = value * 256 + header[i]
  if (!Number.isSafeInteger(value)) throw new TarError('A tar member claims a size past 2^53 bytes')
  return value
}

/**
 * A PAX extended header's records: `<length> <key>=<value>\n`, where the
 * length counts the whole record in BYTES, its own digits and the newline
 * included. Read as bytes, so a UTF-8 name's length is not miscounted.
 */
function paxRecords(bytes: Uint8Array): Map<string, string> {
  const records = new Map<string, string>()
  const decoder = new TextDecoder()
  let at = 0
  while (at < bytes.length) {
    // Trailing NUL padding, which some writers leave, ends the records.
    if (bytes[at] === 0) break
    let space = at
    while (space < bytes.length && bytes[space] !== 0x20) space++
    const length = Number(decoder.decode(bytes.subarray(at, space)))
    if (!Number.isSafeInteger(length) || length <= space - at + 1 || at + length > bytes.length || bytes[at + length - 1] !== 0x0a) {
      throw new TarError('Corrupt PAX record in a tar extended header')
    }
    const record = decoder.decode(bytes.subarray(space + 1, at + length - 1))
    const equals = record.indexOf('=')
    if (equals <= 0) throw new TarError('Corrupt PAX record in a tar extended header')
    records.set(record.slice(0, equals), record.slice(equals + 1))
    at += length
  }
  return records
}

/** A record's value; an empty one unsets the key (POSIX), so it reads as absent. */
function pax(records: Map<string, string>, key: string): string | undefined {
  const value = records.get(key)
  return value === undefined || value === '' ? undefined : value
}

/**
 * Where a symlink's target lands, as a path from the root, or null if it is
 * outside or cannot be judged.
 *
 * Resolved from the link's own folder. `..` is allowed only as a leading run:
 * it climbs out of the link's folder, which is a real folder (no member is ever
 * written under a link, below), and then the rest only descends. A `..` after
 * a name could climb back out of a folder that is, or later becomes, a link to
 * somewhere else — `a/b/..` is `a` only while `a/b` is a folder — so it is
 * refused rather than resolved on paper.
 */
function linkTarget(name: string, target: string): string | null {
  if (!target || target.startsWith('/') || target.startsWith('\\') || target.includes('\\')) return null
  if (/^[A-Za-z]:/.test(target)) return null
  const at = name.split('/').slice(0, -1)
  let descended = false
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (descended || at.length === 0) return null
      at.pop()
      continue
    }
    descended = true
    at.push(part)
  }
  return at.join('/')
}

/**
 * Reading a tar archive as it streams, chunk by chunk, without ever holding
 * the archive — the AI helper's interpreter (docs/CLIPS.md §3a.3 stage 2) is a
 * 69 MB tar stream, and `readTar` wants it whole. `readTar` stays for the
 * library packs.
 *
 * `push` takes the next chunk and returns what it completed: each member, and a
 * file's bytes as slices of the chunk (consume them before pushing again); `end`
 * says the stream is over and refuses one that stopped inside a member.
 *
 * Names, every way an archive carries them: the header's own field, the ustar
 * prefix (`prefix/name`, the POSIX format only — the real archives carry their
 * names over 100 characters this way, EFFECTS §57), a PAX `path` record (`x`
 * for the next member, `g` for every one after), and a GNU `L` record; and a
 * link's target the same way (`linkpath`, `K`). A PAX record wins over a GNU
 * one, which wins over a global record, which wins over the header.
 *
 * What it refuses, as `readTar` does, rather than skipping: a name
 * `isSafe` rejects, hard links, devices, FIFOs, sparse files (GNU's `S` type
 * and the `GNU.sparse.*` PAX keys), any type it does not know. What it accepts
 * that `readTar` does not: a symlink whose target, resolved from the link's own
 * folder, stays inside the root (`linkTarget`) — the Mac interpreter has nine,
 * `bin/python3 -> python3.14` among them — and no member at or under a path an
 * earlier member made a link, so nothing is ever written through one.
 */
export class TarStream {
  private readonly head = new Uint8Array(BLOCK)
  private headFill = 0
  private state: 'header' | 'data' | 'meta' | 'pad' = 'header'
  /** Bytes left in the current member's content, or in its padding. */
  private remaining = 0
  private padding = 0
  /** The record being collected, for a PAX or GNU long-name header. */
  private meta: { type: string; bytes: Uint8Array; fill: number } | null = null
  private local = new Map<string, string>()
  private readonly global = new Map<string, string>()
  private longName: string | null = null
  private longLink: string | null = null
  /** Every path this archive made a symlink: nothing is written at or under one. */
  private readonly links = new Set<string>()
  /** Bytes taken so far, for an error's position. */
  private offset = 0
  private current = ''
  private ended = false

  constructor(private readonly isSafe: (name: string) => string | null) {}

  push(chunk: Uint8Array): TarEvent[] {
    if (this.ended) throw new TarError('A tar stream was given bytes after its end')
    const events: TarEvent[] = []
    let at = 0
    while (at < chunk.length) {
      const left = chunk.length - at
      if (this.state === 'header') {
        const take = Math.min(BLOCK - this.headFill, left)
        this.head.set(chunk.subarray(at, at + take), this.headFill)
        this.headFill += take
        at += take
        this.offset += take
        if (this.headFill === BLOCK) {
          this.headFill = 0
          this.header(events)
        }
      } else if (this.state === 'data') {
        const take = Math.min(this.remaining, left)
        events.push({ kind: 'data', bytes: chunk.subarray(at, at + take) })
        this.remaining -= take
        at += take
        this.offset += take
        if (this.remaining === 0) {
          events.push({ kind: 'end' })
          this.afterContent()
        }
      } else if (this.state === 'meta') {
        const meta = this.meta!
        const take = Math.min(meta.bytes.length - meta.fill, left)
        meta.bytes.set(chunk.subarray(at, at + take), meta.fill)
        meta.fill += take
        at += take
        this.offset += take
        if (meta.fill === meta.bytes.length) {
          this.record(meta.type, meta.bytes)
          this.meta = null
          this.afterContent()
        }
      } else {
        const take = Math.min(this.padding, left)
        this.padding -= take
        at += take
        this.offset += take
        if (this.padding === 0) this.state = 'header'
      }
    }
    return events
  }

  /** The stream is over: anything but a clean break between members is a truncated archive. */
  end(): void {
    this.ended = true
    if (this.state === 'data' || this.state === 'meta') {
      throw new TarError(`Truncated tar: the archive ended inside ${this.current || 'a member'}`)
    }
    if (this.headFill !== 0) throw new TarError('Truncated tar: the archive ended inside a header')
    if (this.longName !== null || this.longLink !== null || this.local.size > 0) {
      throw new TarError('Truncated tar: the archive ended after a long-name record, before its member')
    }
  }

  /** After a member's content: its padding to the next block, then the next header. */
  private afterContent(): void {
    this.state = this.padding > 0 ? 'pad' : 'header'
  }

  private header(events: TarEvent[]): void {
    const header = this.head
    const at = this.offset - BLOCK
    // Two consecutive zero blocks end the archive; one is padding. Both are skipped, as readTar does.
    if (header.every((byte) => byte === 0)) return
    if (!checksumMatches(header)) throw new TarError(`Corrupt tar header at byte ${at}`)

    const type = String.fromCharCode(header[156] || 0x30)
    const size = pax(this.local, 'size') ?? pax(this.global, 'size')
    const length = type === 'x' || type === 'g' || type === 'L' || type === 'K' ? sizeField(header) : size !== undefined ? Number(size) : sizeField(header)
    if (!Number.isSafeInteger(length) || length < 0) throw new TarError('A tar member claims a size that is not a size')
    this.padding = (BLOCK - (length % BLOCK)) % BLOCK

    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      if (length > META_LIMIT) throw new TarError(`A tar '${type}' record of ${length} bytes is too long to be a name`)
      this.current = `a '${type}' record`
      this.meta = { type, bytes: new Uint8Array(length), fill: 0 }
      this.state = length > 0 ? 'meta' : 'header'
      if (length === 0) {
        this.record(type, this.meta.bytes)
        this.meta = null
        this.afterContent()
      }
      return
    }

    const local = this.local
    const longName = this.longName
    const longLink = this.longLink
    this.local = new Map()
    this.longName = null
    this.longLink = null

    const prefix = isPosixUstar(header) ? str(header, 345, 155) : ''
    const own = str(header, 0, 100)
    const raw = pax(local, 'path') ?? longName ?? pax(this.global, 'path') ?? (prefix ? `${prefix}/${own}` : own)
    this.current = raw

    for (const key of [...local.keys(), ...this.global.keys()]) {
      if (key.startsWith('GNU.sparse.')) throw new TarError(`Refusing a sparse tar member: ${raw}`)
    }

    let kind: TarMember['type']
    if (type === '0' || type === '\0') kind = 'file'
    else if (type === '2') kind = 'symlink'
    else if (type === '5') kind = 'directory'
    else if (type === '1') throw new TarError(`Refusing a hard link in a tar: ${raw}`)
    else if (type === '3' || type === '4' || type === '6') throw new TarError(`Refusing a device or FIFO in a tar: ${raw}`)
    else if (type === 'S') throw new TarError(`Refusing a sparse tar member: ${raw}`)
    else throw new TarError(`Unsupported tar entry type '${type}' for ${raw}`)

    // A folder's name may end in slashes; a file's may not (isSafe refuses the empty part).
    const name = this.isSafe(kind === 'directory' ? raw.replace(/\/+$/, '') : raw)
    if (name === null) throw new TarError(`Refusing a tar member that escapes its directory: ${raw}`)
    const parts = name.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const through = parts.slice(0, i).join('/')
      if (this.links.has(through)) {
        throw new TarError(`Refusing ${name}: it would be written through the link ${through}`)
      }
    }
    const mode = octal(header, 100, 8)

    if (kind === 'symlink') {
      const target = pax(local, 'linkpath') ?? longLink ?? pax(this.global, 'linkpath') ?? str(header, 157, 100)
      if (linkTarget(name, target) === null) {
        throw new TarError(`Refusing a symlink that points outside its directory: ${name} -> ${target}`)
      }
      this.links.add(name)
      events.push({ kind: 'member', member: { name, size: 0, mode, type: 'symlink', linkname: target } })
    } else if (kind === 'directory') {
      events.push({ kind: 'member', member: { name, size: 0, mode, type: 'directory' } })
    } else {
      events.push({ kind: 'member', member: { name, size: length, mode, type: 'file' } })
      if (length === 0) {
        events.push({ kind: 'end' })
        this.afterContent()
        return
      }
      this.remaining = length
      this.state = 'data'
      return
    }
    // A link or a folder carries no content; any it claims is skipped.
    this.remaining = 0
    if (length > 0) {
      this.padding += length
      this.state = 'pad'
    } else {
      this.afterContent()
    }
  }

  private record(type: string, bytes: Uint8Array): void {
    if (type === 'L' || type === 'K') {
      // GNU: the record's CONTENTS are the next member's path, or its link's target.
      const value = new TextDecoder().decode(bytes).replace(/\0+$/, '')
      if (type === 'L') this.longName = value
      else this.longLink = value
      return
    }
    const records = paxRecords(bytes)
    if (type === 'x') {
      for (const [key, value] of records) this.local.set(key, value)
    } else {
      for (const [key, value] of records) {
        if (value === '') this.global.delete(key)
        else this.global.set(key, value)
      }
    }
  }
}
