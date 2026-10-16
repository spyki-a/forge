import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeadlineError, ciNotice, ciWarning, oneLine, pythonStderr, withDeadline } from './integration/helperDiag'

/*
 * tests/integration/helperDiag.ts: what a red Windows run can say through its
 * annotations. A command the runner cannot parse is plain log text, which
 * needs a sign-in to read; a message past 4,096 characters loses its end.
 */

describe('the annotations', () => {
  const was = process.env.GITHUB_ACTIONS
  afterEach(() => {
    if (was === undefined) delete process.env.GITHUB_ACTIONS
    else process.env.GITHUB_ACTIONS = was
    vi.restoreAllMocks()
  })

  function written(write: () => void): string {
    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    })
    write()
    return chunks.join('')
  }

  it('are one command on a line of their own, escaped as the runner unescapes them', () => {
    process.env.GITHUB_ACTIONS = 'true'
    // A newline left in would end the command there; a colon or a comma in the title would end the title.
    expect(written(() => ciNotice('faces.int: timings, pack', '50%\nnext\rline'))).toBe('\n::notice title=faces.int%3A timings%2C pack::50%25%0Anext%0Dline\n')
    expect(written(() => ciWarning('beats.int: 1 of 13 failed', 'x'))).toBe('\n::warning title=beats.int%3A 1 of 13 failed::x\n')
  })

  it('stay under the 4,096 characters a step keeps of each', () => {
    process.env.GITHUB_ACTIONS = 'true'
    const line = written(() => ciNotice('t', 'y'.repeat(9000)))
    const message = line.trim().split('::').pop()!
    expect(message.length).toBeLessThan(4096 - 100)
    expect(message.endsWith('…')).toBe(true)
  })

  it('go to the console off CI', () => {
    delete process.env.GITHUB_ACTIONS
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(written(() => ciNotice('t', 'm'))).toBe('')
    expect(logged).toHaveBeenCalledWith('[notice] t: m')
  })
})

describe('a deadline', () => {
  it('says what it waited for, how long and the context read at that moment, on one bounded line', async () => {
    let state = 'before'
    const never = new Promise<never>(() => undefined)
    const waiting = withDeadline(never, 50, 'the stand-in pass', () => `state ${state}\nworker 12 alive\n${'z'.repeat(5000)}\nthe newest line`)
    state = 'after'
    const err = await waiting.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeadlineError)
    const message = (err as Error).message
    expect(message).not.toMatch(/\n/)
    expect(message.length).toBeLessThanOrEqual(3000)
    expect(message.startsWith('the stand-in pass: nothing within 0.1 s. state after ⏎ worker 12 alive ⏎ ')).toBe(true)
    // The end is kept: a log's newest lines are where a hang shows.
    expect(message.endsWith(' ⏎ the newest line')).toBe(true)
  })

  it('is the promise itself when that settles first, a rejection included', async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, 'x', () => '')).resolves.toBe(7)
    const own = new Error('its own')
    await expect(withDeadline(Promise.reject(own), 1000, 'x', () => '')).rejects.toBe(own)
  })

  it('keeps a long text’s start and end, newlines shown', () => {
    expect(oneLine('a\nb')).toBe('a ⏎ b')
    const long = oneLine(`${'s'.repeat(100)}${'m'.repeat(1000)}${'e'.repeat(100)}`, 300)
    expect(long.length).toBe(300)
    expect(long.startsWith('s'.repeat(90))).toBe(true)
    expect(long.endsWith('e'.repeat(100))).toBe(true)
  })
})

describe("a Python child's stderr", () => {
  it('is its notes, faces.py’s lines, the rest and the last stall dump’s newest frames — test_faces.py’s dump, read the same', () => {
    const folder = 'C:\\Users\\Zoë\\AppData\\Local\\Programs\\3dit\\resources\\sidecar\\forge_sidecar'
    const dump = [
      'Timeout (0:00:08)!',
      'Thread 0x0000000170e6f000 [Thread-1 (_watch)] (most recent call first):',
      `  File "${folder}\\workers\\mp_faces.py", line 418 in _watch`,
      '  File "C:\\py\\Lib\\threading.py", line 1024 in run',
      '  File "C:\\py\\Lib\\threading.py", line 1082 in _bootstrap_inner',
      '  File "C:\\py\\Lib\\threading.py", line 1044 in _bootstrap',
      '',
      'Thread 0x00000001f774dd80 (most recent call first):',
      `  File "${folder}\\media.py", line 238 in _read_exact`,
      `  File "${folder}\\media.py", line 310 in iter_frames`,
      `  File "${folder}\\workers\\mp_faces.py", line 523 in run`,
      `  File "${folder}\\workers\\mp_faces.py", line 598 in main`,
      `  File "${folder}\\workers\\mp_faces.py", line 604 in <module>`,
      '  File "<string>", line 3 in <module>'
    ]
    const earlier = ['Timeout (0:00:08)!', 'Thread 0x01 (most recent call first):', '  File "x.py", line 1 in earlier']
    const text = [
      ...earlier,
      'mp_faces: the spec read (+0.000 s)',
      'faces: worker 812 started',
      'mp_faces: ffmpeg 813 started, 640x360 at 5 fps (+0.034 s)',
      'W0000 gl_context.cc:80] no pixel format',
      ...dump
    ].join('\r\n')
    const said = pythonStderr(text)
    expect(said).toBe(
      'notes: mp_faces: the spec read (+0.000 s) ⏎ mp_faces: ffmpeg 813 started, 640x360 at 5 fps (+0.034 s); faces.py: faces: worker 812 started; ' +
        'other: W0000 gl_context.cc:80] no pixel format; stacks: Thread-1 (_watch): mp_faces.py:418 _watch < threading.py:1024 run < threading.py:1082 _bootstrap_inner < threading.py:1044 _bootstrap' +
        ' | main: media.py:238 _read_exact < media.py:310 iter_frames < mp_faces.py:523 run < mp_faces.py:598 main'
    )
    expect(said).not.toContain('Zoë')
    expect(pythonStderr('')).toBe('')
  })
})
