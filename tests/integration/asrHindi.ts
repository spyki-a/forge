import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Word } from '@shared/transcript'

/**
 * M21 (docs/CLIPS.md §6.15): how the installed faster-whisper writes the
 * numbers said in Hindi. asr.int's gated case transcribes the user's Hindi
 * clips (`FORGE_ASR_HINDI=<folder>`) and writes every number-bearing word
 * AS THE MODEL WROTE IT into tests/output/asr/hindi-numbers.txt, so the
 * counter's Hindi digit format follows what the model writes (Devanagari or
 * ASCII digits), and the share written as words, which §16.11 drops in v1,
 * is counted beside it.
 *
 * A word bears a number when it holds a Devanagari digit (U+0966-096F), an
 * ASCII digit, or is one of the Hindi number words below once its edge
 * punctuation (the danda included) is trimmed. Nothing is converted or
 * corrected: the record is the model's spelling.
 */

/** How a number-bearing word is written. */
export type NumberForm = 'devanagari-digits' | 'ascii-digits' | 'mixed-digits' | 'word'

/** Devanagari digits ० to ९. Not U+0964-0965, the danda and double danda just before them, which are punctuation. */
const DEVANAGARI_DIGIT = /[०-९]/u
const ASCII_DIGIT = /[0-9]/

/**
 * The Hindi number words, each with what it means, every spelling the model
 * might write on its row. Cardinals 0-100 (each its own word in Hindi), the
 * scale words, and the fractions that are said as numbers. Spellings are
 * compared after NFC, so a nukta letter (ड़, ढ़, ज़) matches whether it is
 * written precomposed or as its letter and nukta.
 *
 * Two are also ordinary words, and every match is written anyway, for the
 * reader to judge: एक is the article "a" as well as one, and दो is "give" as
 * well as two. Ordinals (पहला, दूसरा …) are not counters and are left out.
 */
export const HINDI_NUMBER_WORDS: readonly (readonly [means: string, ...spellings: string[]])[] = [
  ['0', 'शून्य'],
  ['1', 'एक'],
  ['2', 'दो'],
  ['3', 'तीन'],
  ['4', 'चार'],
  ['5', 'पाँच', 'पांच'],
  ['6', 'छह', 'छः', 'छे', 'छै'],
  ['7', 'सात'],
  ['8', 'आठ'],
  ['9', 'नौ'],
  ['10', 'दस'],
  ['11', 'ग्यारह'],
  ['12', 'बारह'],
  ['13', 'तेरह'],
  ['14', 'चौदह'],
  ['15', 'पंद्रह', 'पन्द्रह'],
  ['16', 'सोलह'],
  ['17', 'सत्रह'],
  ['18', 'अठारह', 'अट्ठारह'],
  ['19', 'उन्नीस'],
  ['20', 'बीस'],
  ['21', 'इक्कीस'],
  ['22', 'बाईस'],
  ['23', 'तेईस'],
  ['24', 'चौबीस'],
  ['25', 'पच्चीस'],
  ['26', 'छब्बीस'],
  ['27', 'सत्ताईस'],
  ['28', 'अट्ठाईस', 'अठाईस'],
  ['29', 'उनतीस', 'उन्तीस'],
  ['30', 'तीस'],
  ['31', 'इकतीस', 'इकत्तीस'],
  ['32', 'बत्तीस'],
  ['33', 'तैंतीस', 'तेंतीस'],
  ['34', 'चौंतीस', 'चौतीस'],
  ['35', 'पैंतीस'],
  ['36', 'छत्तीस'],
  ['37', 'सैंतीस'],
  ['38', 'अड़तीस'],
  ['39', 'उनतालीस', 'उनचालीस'],
  ['40', 'चालीस'],
  ['41', 'इकतालीस'],
  ['42', 'बयालीस', 'बियालीस'],
  ['43', 'तैंतालीस', 'तेंतालीस'],
  ['44', 'चौवालीस', 'चवालीस'],
  ['45', 'पैंतालीस'],
  ['46', 'छियालीस'],
  ['47', 'सैंतालीस'],
  ['48', 'अड़तालीस'],
  ['49', 'उनचास'],
  ['50', 'पचास'],
  ['51', 'इक्यावन'],
  ['52', 'बावन'],
  ['53', 'तिरेपन', 'तिरपन'],
  ['54', 'चौवन'],
  ['55', 'पचपन'],
  ['56', 'छप्पन'],
  ['57', 'सत्तावन'],
  ['58', 'अट्ठावन'],
  ['59', 'उनसठ'],
  ['60', 'साठ'],
  ['61', 'इकसठ'],
  ['62', 'बासठ'],
  ['63', 'तिरसठ'],
  ['64', 'चौंसठ'],
  ['65', 'पैंसठ'],
  ['66', 'छियासठ'],
  ['67', 'सड़सठ', 'सरसठ'],
  ['68', 'अड़सठ'],
  ['69', 'उनहत्तर'],
  ['70', 'सत्तर'],
  ['71', 'इकहत्तर'],
  ['72', 'बहत्तर'],
  ['73', 'तिहत्तर'],
  ['74', 'चौहत्तर'],
  ['75', 'पचहत्तर'],
  ['76', 'छिहत्तर'],
  ['77', 'सतहत्तर'],
  ['78', 'अठहत्तर'],
  ['79', 'उनासी', 'उन्यासी'],
  ['80', 'अस्सी'],
  ['81', 'इक्यासी'],
  ['82', 'बयासी'],
  ['83', 'तिरासी'],
  ['84', 'चौरासी'],
  ['85', 'पचासी'],
  ['86', 'छियासी'],
  ['87', 'सत्तासी'],
  ['88', 'अट्ठासी'],
  ['89', 'नवासी'],
  ['90', 'नब्बे'],
  ['91', 'इक्यानबे', 'इक्यानवे'],
  ['92', 'बानबे', 'बानवे'],
  ['93', 'तिरानबे', 'तिरानवे'],
  ['94', 'चौरानबे', 'चौरानवे'],
  ['95', 'पंचानबे', 'पंचानवे'],
  ['96', 'छियानबे', 'छियानवे'],
  ['97', 'सत्तानबे', 'सत्तानवे'],
  ['98', 'अट्ठानबे', 'अट्ठानवे'],
  ['99', 'निन्यानबे', 'निन्यानवे'],
  ['100', 'सौ'],
  ['1,000', 'हज़ार', 'हजार'],
  ['100,000 (lakh)', 'लाख'],
  ['10,000,000 (crore)', 'करोड़', 'करोड'],
  ['1,000,000,000', 'अरब'],
  ['a half', 'आधा', 'आधी', 'आधे'],
  ['1.5', 'डेढ़', 'डेढ'],
  ['2.5', 'ढाई'],
  ['and a half (साढ़े तीन, 3.5)', 'साढ़े', 'साढे'],
  ['and a quarter (सवा दो, 2.25)', 'सवा'],
  ['less a quarter (पौने तीन, 2.75)', 'पौने', 'पौन']
]

/** Each spelling, NFC, to what it means. */
const MEANS = new Map(HINDI_NUMBER_WORDS.flatMap(([means, ...spellings]) => spellings.map((s) => [s.normalize('NFC'), means] as const)))

/** The word with the punctuation and symbols at its edges trimmed (the danda is punctuation), NFC. */
function bare(text: string): string {
  return text.normalize('NFC').replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
}

/** What a Hindi number word means, or null when the word is not one. */
export function hindiNumberMeaning(text: string): string | null {
  return MEANS.get(bare(text)) ?? null
}

/** How a word bears a number, or null when it bears none. Digits first: a word holding one is a written number whatever else it holds. */
export function numberForm(text: string): NumberForm | null {
  const devanagari = DEVANAGARI_DIGIT.test(text)
  const ascii = ASCII_DIGIT.test(text)
  if (devanagari && ascii) return 'mixed-digits'
  if (devanagari) return 'devanagari-digits'
  if (ascii) return 'ascii-digits'
  return hindiNumberMeaning(text) === null ? null : 'word'
}

const seconds = (ms: number): string => (ms / 1000).toFixed(2)

/**
 * One line per number-bearing word of a clip's transcript: the clip, the
 * word's time in seconds, its form, and the word as the model wrote it (with
 * what a number word means). Tab-separated, in the transcript's order.
 */
export function numberLines(clip: string, words: readonly Pick<Word, 'text' | 'startMs' | 'endMs'>[]): string[] {
  return words.flatMap((w) => {
    const form = numberForm(w.text)
    if (form === null) return []
    const means = form === 'word' ? `\t= ${hindiNumberMeaning(w.text)}` : ''
    return [`${clip}\t${seconds(w.startMs)}-${seconds(w.endMs)} s\t${form}\t${w.text}${means}`]
  })
}

/** How many words of each form, for the file's last line. */
export function formCounts(words: readonly Pick<Word, 'text'>[]): Record<NumberForm, number> {
  const counts: Record<NumberForm, number> = { 'devanagari-digits': 0, 'ascii-digits': 0, 'mixed-digits': 0, word: 0 }
  for (const w of words) {
    const form = numberForm(w.text)
    if (form) counts[form]++
  }
  return counts
}

/** What faster-whisper is handed: audio and video files PyAV decodes, by extension, case aside. */
export const CLIP_EXTENSIONS: readonly string[] = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.mp4', '.mov', '.m4v', '.mkv', '.webm']

/** The clips in a folder (its own files, not its subfolders'), by name, sorted. */
export function hindiClips(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => CLIP_EXTENSIONS.includes(extname(name).toLowerCase()) && statSync(join(folder, name)).isFile())
    .sort()
}
