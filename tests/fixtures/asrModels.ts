import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * asr.py's `MODELS`, read as text: the helper's table of the three speech
 * models, for tests/speechModelTable.test.ts to hold equal to
 * src/shared/asr/speechModel.ts SPEECH_MODELS, and for asr.int to find each
 * model's snapshot. Parsed, not imported: a node test runs with no Python.
 *
 * Strict about the shape, so a change to it fails here rather than reading
 * less: the block runs from `MODELS: tuple[SpeechModel, ...] = (` to the
 * first `)` alone at column 0; each entry is one `SpeechModel(` with exactly
 * one name=, repo= and revision= and its `("file", size)` pairs.
 */

export const ASR_PY = resolve(__dirname, '..', '..', 'sidecar', 'forge_sidecar', 'capabilities', 'asr.py')

export interface AsrModel {
  name: string
  repo: string
  revision: string
  files: [string, number][]
}

export function asrModelsFrom(text: string): AsrModel[] {
  const opens = [...text.matchAll(/^MODELS: tuple\[SpeechModel, \.\.\.\] = \($/gm)]
  if (opens.length !== 1) throw new Error(`asr.py opens MODELS ${opens.length} times`)
  const start = opens[0].index! + opens[0][0].length
  const end = text.indexOf('\n)\n', start)
  if (end < 0) throw new Error('asr.py never closes MODELS')
  const block = text.slice(start, end)
  const entries = block.split(/^ {4}SpeechModel\($/m).slice(1)
  if (entries.length !== [...block.matchAll(/SpeechModel\(/g)].length) throw new Error('asr.py MODELS has an entry out of shape')
  return entries.map((entry, i) => {
    const one = (field: string): string => {
      const hits = [...entry.matchAll(new RegExp(`^ {8}${field}="([^"]+)",$`, 'gm'))]
      if (hits.length !== 1) throw new Error(`asr.py MODELS entry ${i} has ${hits.length} ${field}=`)
      return hits[0][1]
    }
    const files = [...entry.matchAll(/^ {12}\("([^"]+)", ([\d_]+)\),$/gm)].map((m): [string, number] => [m[1], Number(m[2].replace(/_/g, ''))])
    // Every line that looks like a file must have been read as one.
    const fileish = [...entry.matchAll(/\("[^"]*",/g)].length
    if (fileish !== files.length) throw new Error(`asr.py MODELS entry ${i} has a file out of shape`)
    return { name: one('name'), repo: one('repo'), revision: one('revision'), files }
  })
}

export function asrModels(): AsrModel[] {
  return asrModelsFrom(readFileSync(ASR_PY, 'utf8'))
}
