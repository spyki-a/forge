/**
 * A render's filtergraph, moved out of the command line into a file.
 *
 * `buildRenderPlan` puts the whole graph in ONE argument, `-filter_complex
 * <graph>`, and on Windows `CreateProcess` caps a command line at 32,767
 * characters. A talk cut into 55 pieces is past that (each piece is an input
 * and about 510 characters of graph), and ffmpeg would never start — on
 * Windows only, since the Mac's ARG_MAX is about a megabyte, so a check run
 * here passes (docs/CLIPS.md §3.7, EFFECTS.md §47). With the graph in a file
 * the inputs alone are left, about 87 characters a piece.
 *
 * So the export writes the graph to a file and hands ffmpeg
 * `-filter_complex_script <file>`. That option is in the Windows build's own
 * source (f22fcd4, `fftools/ffmpeg_opt.c:3109` and `:3478`): it reads the file
 * whole (`read_file`, through `avio_open`) and parses it exactly as the
 * argument would have been. The path is an option value opened as a file, not
 * text inside the graph, so the drive-letter colon and the graph's escaping
 * rules (captions/timeline.ts) do not apply to it.
 *
 * `buildRenderPlan` stays pure and keeps emitting `-filter_complex <graph>`:
 * every test that reads the graph from its argv still does, and this swap is
 * done once, where the export spawns (main/render/renderJob.ts).
 */

const OPTION = '-filter_complex'
const SCRIPT = '-filter_complex_script'

/** Every index of the bare `-filter_complex` option in an argv — counted, not the first one found. */
function sites(args: readonly string[]): number[] {
  return args.flatMap((arg, i) => (arg === OPTION ? [i] : []))
}

function onlySite(args: readonly string[]): number {
  const found = sites(args)
  if (found.length !== 1) {
    throw new Error(`A render has one filtergraph; this argv has ${found.length} ${OPTION} options`)
  }
  const at = found[0]
  if (at + 1 >= args.length) throw new Error(`${OPTION} is the last argument, with no graph after it`)
  return at
}

/** The render's one filtergraph: the value after its single `-filter_complex`. */
export function filterGraphOf(args: readonly string[]): string {
  return args[onlySite(args) + 1]
}

/**
 * The same argv with its one `-filter_complex <graph>` pair replaced by
 * `-filter_complex_script <file>`, every other argument kept, in order.
 *
 * Throws unless there is exactly one pair: two graphs, or none, is not a
 * render this was written for, and guessing which to move would be worse.
 */
export function withGraphFile(args: readonly string[], file: string): string[] {
  const at = onlySite(args)
  return [...args.slice(0, at), SCRIPT, file, ...args.slice(at + 2)]
}

/**
 * The argv as one line to paste into a shell — what a failed export reports,
 * so the command can be run again by hand. Its graph is the script's path,
 * which is why the script is kept when an export fails — and the captions'
 * `.ass` the graph names with it (main/render/renderJob.ts,
 * `releasesTemporaries`).
 *
 * POSIX single quotes, or Windows double quotes (a Windows path cannot hold
 * a `"`, and the graph is no longer on the line), around any argument that is
 * not plainly safe.
 */
export function commandLine(binary: string, args: readonly string[], platform: string): string {
  const quote = (arg: string): string => {
    if (/^[A-Za-z0-9_\-.,/:=@%+]+$/.test(arg)) return arg
    return platform === 'win32' ? `"${arg.replace(/"/g, '\\"')}"` : `'${arg.replace(/'/g, `'\\''`)}'`
  }
  return [binary, ...args].map(quote).join(' ')
}
