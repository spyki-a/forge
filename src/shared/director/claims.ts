/**
 * The graphics validator's normaliser (docs/CLIPS.md §6.7, "The normaliser").
 *
 * Only `claimToken` so far, the part `graphics/tree.ts` needs to find each
 * step's run in the spoken words; lane T2a's claims (numbers as `{n, unit,
 * currency?}`, the unit tokens, plurals, the function-word list) extend this
 * file. Named apart from `automation/keywords.ts`'s `normaliseToken`, which
 * is ASCII-only and maps Hindi and Telugu to '' (§6.7), and from
 * `director/validate.ts`'s `normalise`, which drops final combining marks.
 *
 * Pure and node-runnable.
 */

/** The zero of each native digit block §6.7 rule 3 maps to ASCII. */
const NATIVE_ZEROS = [0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0x660, 0x6f0] as const

/** Leading and trailing characters outside letters, marks and numbers. */
const EDGES = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu

/**
 * One word as the validator compares it (§6.7 rules 1-3): NFC, lower case
 * (locale-independent), leading and trailing characters outside
 * `[\p{L}\p{M}\p{N}]` trimmed with combining marks kept, and native digits
 * mapped to ASCII by block offset. 'పెళ్లి' stays 'పెళ్లి', 'शादी' stays
 * 'शादी', 'Parts:' is 'parts', '४०' is '40'. A word of punctuation alone is ''.
 */
export function claimToken(word: string): string {
  const trimmed = word.normalize('NFC').toLowerCase().replace(EDGES, '')
  let out = ''
  for (const ch of trimmed) {
    const c = ch.codePointAt(0)!
    const zero = NATIVE_ZEROS.find((z) => c >= z && c <= z + 9)
    out += zero === undefined ? ch : String.fromCharCode(48 + c - zero)
  }
  return out
}
