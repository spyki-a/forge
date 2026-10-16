/** Types for scripts/probe-pack-urls.mjs, so tests/probePackUrls.test.ts can import it under strict TypeScript. */

export interface ProbedFile {
  name: string
  url: string
  bytes: number
  sha256: string
}

export interface ProbeManifest {
  platforms: Record<string, { interpreter: ProbedFile; wheels: ProbedFile[] }>
}

export interface Judged {
  ok: boolean
  transient: boolean
  status: number | null
  host: string
  reason: string | null
}

export const MANIFEST_PATH: string
export const PROBE_RETRY: { tries: number; firstDelayMs: number; answerMs: number }
export function hostOf(url: string): string
export function expectedHosts(url: string): string[]
export function manifestFromText(text: string): ProbeManifest
export function loadManifest(path?: string): Promise<{ manifest: ProbeManifest; how: string }>
export function filesOf(manifest: ProbeManifest): { files: (ProbedFile & { platforms: string[] })[]; faults: string[] }
export function judge(file: ProbedFile, response: Response): Judged
export function probeFile(
  file: ProbedFile,
  o: { fetch: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void>; tries?: number; firstDelayMs?: number; answerMs?: number }
): Promise<Judged & { tries: number }>
export function main(o?: {
  manifest?: ProbeManifest
  fetch?: typeof globalThis.fetch
  out?: (line: string) => void
  env?: Record<string, string | undefined>
  sleep?: (ms: number) => Promise<void>
  tries?: number
  firstDelayMs?: number
  width?: number
}): Promise<number>
