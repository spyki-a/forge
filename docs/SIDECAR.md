# The Python sidecar

Every local AI capability runs in a separate Python process that Electron supervises — on
screen, "the AI helper". This is the gate for all of Phase 2 onward.

What it can answer is `capabilities/__init__.py`'s `OPTIONAL`, one row per module, each
degrading on its own: speech to text (`asr.transcribe`, and since 2026-10-16 `asr.model`, the
speech model's status and its press; below), beats (`audio.beats`), parallax layers
(`depth.layers`), the Director's photo measures (`vision.measure`), stems (`audio.stems`), the
local voice (`voice.speak`, `voice.voices`), and since 2026-10-13 step 1's two: **the face
finder** (`vision.faces`, `vision.facesModel`; below) and **the subject finder**
(`vision.salient`, `vision.salientModel`; below). Beside them, always there: `system.hello`,
`system.ping`, `system.sleep` and, since 2026-10-14, `system.selftest` (Setup, below). The
installed pack's `expects`, what its check and the Settings row count as "N of 9 helper
features", is asr's two, beats, depth, measure and the face and subject finders' four
(`src/shared/sidecar/packManifest.ts`); stems and the voice are in no pack.

## Why stdio JSON-RPC, not a local HTTP server

The obvious design is a small FastAPI server on localhost. Reasons it isn't:

- **No macOS firewall prompt.** Binding a listening socket makes the OS ask the user to
  allow incoming connections. In a video editor that reads as spyware.
- No port allocation, so no conflicts with whatever else the user runs.
- No CORS, no auth, no listening socket to secure.
- The child dies with the parent automatically.

Framing is one JSON object per line. **That only holds because large payloads never go
through the pipe** — audio, video and model output travel as file paths on disk. Keep it
that way; piping megabytes through stdio stalls the event loop on both sides.

## Properties the design guarantees

**A missing capability degrades one feature, never the process.** `system.hello` returns
`capabilities` *and* `degraded: {method: reason}`, so the UI can say "transcription
unavailable: faster-whisper is not installed" instead of a feature silently vanishing.
A module that fails marks *every* method it would have registered (`OPTIONAL` lists them as a
tuple per module): with one name per module, `voice.voices` answered "unknown method" on every
machine without kokoro. `tests/integration/sidecar.int.test.ts` holds each of
`OPTIONAL_METHODS` (`src/shared/sidecar/protocol.ts`) to "a capability or degraded", and every
method the helper answers for to that list; `tests/sidecar/test_media.py` holds each module's
tuple to the `server.register` calls in its own source, so a tuple that leaves out a method its
module registers fails a test even on a bare interpreter, where no module loads.

**Shared media code lives in `forge_sidecar/media.py`**: the upright probe, one-frame and
streamed decodes, the model and cache folders, and pinned downloads (`docs/CLIPS.md` §3.6,
`EFFECTS.md` §49–§50). It imports only the standard library at module level, so the helper
still starts on a bare interpreter; its tests are `tests/sidecar/test_media.py`, run by
`tests/integration/sidecarMedia.int.test.ts` — the decodes among them read as bytes, with no
numpy, so CI's bare interpreter runs them against the 2018 ffmpeg. A capability sent a size by
main checks it with `media.require_upright` and refuses a file whose upright size disagrees.

Both the import and the registration are guarded — a module can import cleanly and still
fail at register time when its heavy dependency is missing. Getting that wrong took the
whole sidecar down; the integration suite caught it.

**Cancellation is cooperative.** Handlers call `context.raise_if_cancelled()` inside their
loops. Killing a thread mid-work would leave models and file handles undefined, so a handler
that never checks simply cannot be interrupted — that is a deliberate trade.

**Requests run on their own threads** so a long transcription doesn't block the read loop;
cancel notifications must still arrive while work is in flight.

**In-flight work drains on EOF.** Handler threads are daemons, so returning immediately when
stdin closes destroys them mid-request and the client never sees a response. Fast handlers
hide this completely — `ping` always worked; transcription never did.

**The client treats the process as disposable.** It restarts on unexpected exit with
exponential backoff, fails all pending requests with a clear error, and gives up after a
limit. Nothing in the editor may depend on the sidecar being alive.

## Environment findings

- **Python 3.14 is fine.** `numpy`, `onnxruntime`, `ctranslate2` and `av` all publish cp314
  arm64 wheels; `faster-whisper` is pure Python. Every package of the base pack has a binary
  wheel for cp314 on both platforms (`docs/CLIPS.md` §3a.1). `soundfile` is not sdist-only:
  0.14.0 (2026-06-06) ships `py2.py3-none` wheels for both, and librosa 1.0.0 requires it.
  **Decoding is not one ffmpeg**: beats decodes with the app's bundled ffmpeg
  (`beats.py:59-64`), but asr decodes with **PyAV** (faster-whisper's `audio.py` calls
  `av.open`), a third FFmpeg in the app (§3a.1's licences). (This said "only soundfile is
  sdist-only" and "audio decoding goes through the ffmpeg the app already bundles" until
  2026-10-16; `sidecar/requirements.txt`'s header still does.)
- **Disable Hugging Face's Xet backend.** `hf-xet` fetches from `cas-server.xethub.hf.co`,
  a separate CDN host that restricted networks and corporate proxies block. The client sets
  `HF_HUB_DISABLE_XET=1`; the plain HTTP path is slower. **Since pack 2 (2026-10-16) hf-xet is
  not in the installed pack at all**: depth's and the speech model's downloads both passed
  without it (`docs/CLIPS.md` §3a.8 row 35), so the lock leaves it out, and `pip check` in the
  pack names huggingface-hub's want of it beside mediapipe's two. The dev venv still has it.
- **But the plain path is not huggingface.co alone.** Measured by headers on 2026-10-13 for
  the subject finder (BiRefNet_lite fp16 at the pinned `de15b22…`): the resolve URL on
  `huggingface.co` answers **307** to the repo's new name, `onnx-community/BiRefNet_lite-ONNX`
  (the pinned commit is still served: `x-repo-commit de15b22…`, `x-linked-size 114538221`), and
  that answers **302** to `https://us.aws.cdn.hf.co/xet-bridge-us/…`, where the bytes are. So a
  restricted network must allow `huggingface.co` **and** `*.hf.co`; the dock's `host` names only
  the first (`ModelStatus.host`, `src/shared/sidecar/protocol.ts`). `storage.googleapis.com`, the
  face finder's host, serves its file itself (200, no redirect).
- **`depth.MATTE_REPO` works only through the Hub's rename redirect.** `onnx-community/BiRefNet_lite`
  was renamed `…/BiRefNet_lite-ONNX`; huggingface_hub follows the 307 today (the 1d builder's real
  fetch worked, and the cache keeps the old name's folder), but if the Hub ever drops the old name,
  every machine without the model loses parallax subjects and the subject finder at once. Moving
  the constant to the new name changes the cache folder, so it re-downloads 115 MB once per machine
  that has it: a decision, not a tidy-up.
- **Never default the model cache to `~/.cache`.** The client passes `FORGE_MODELS_DIR`
  explicitly, pointing at `userData`.
- **Nor the bakes.** Until 2026-10-08 nothing set `FORGE_CACHE_DIR`, so depth.py's parallax
  bakes fell back to `~/.cache/forge/parallax` — 264 MB measured on the development Mac, never
  evicted. The client now passes it as `userData/helper-cache` (`helperFolders`,
  `src/main/sidecar/service.ts`), and the caches that follow it are `media.cache_dir(name)`
  under it: parallax bakes now, step 1's face tracks next. **Not stems, yet:** `stems.py`
  `_cache_dir` (:45-48) still falls back to `~/.cache/forge/stems` when no `outDir` is sent,
  and main sends none (`src/main/separate.ts:40`), so with Demucs installed every separation
  lands there, unevicted. Moving it onto `media.cache_dir("stems")` re-separates each song once
  (minutes of CPU) and needs the same decision about the old folder as `docs/CLIPS.md`
  §16.24, so it is a change of its own. The folder is not `userData/cache`: userData already
  holds Chromium's own `Cache` (its HTTP disk cache), and on a
  case-insensitive disk — the APFS default, and NTFS — `cache` is that folder (measured:
  `ls -d …/forge/cache` resolved to it). The old parallax folder is left exactly where it is (the user's
  decision, `docs/CLIPS.md` §16.24): with the variable set nothing reads, moves or deletes it, a
  project whose planes are there keeps finding them by their stored paths, and a photo baked
  there is baked once more into the new folder on its next bake. Measured: a fresh bake through
  the client landed in `<userData>/helper-cache/parallax/<key>/`, and `~/.cache/forge/parallax`
  kept its 40 entries and 264 MB with nothing newer than the day. Model downloads are pinned to a
  commit (`media.download`; depth `4472b73…`, BiRefNet `de15b22…`, the revisions already in the
  app's cache), which also skips the Hub round trip a branch name costs on the first bake of a
  session: 138 ms from the cache against 4.9 s unpinned, measured. Bytes are forwarded as
  progress through `tqdm_class`, in huggingface_hub's 10 MiB chunks (three messages for a 19 MB
  file, measured).

## ASR

`asr.transcribe` → faster-whisper (CTranslate2), `int8` on CPU, `word_timestamps=True`,
`vad_filter=True`. Returns word-level timing in **milliseconds of source media**, never
timeline frames — a transcript belongs to an asset, and storing frames would corrupt every
transcript the moment the project frame rate changed.

Whisper is the universal tier: it covers Indic languages, which Parakeet does not. Parakeet-TDT
is the better European option (native transducer timestamps, ±20-40ms vs Whisper's
±100-300ms DTW) and slots in beside this as a second tier — see `STACK.md` §2.

Measured on an M-series Mac: `tiny`/int8 transcribes the 11-second JFK fixture in ~640ms,
roughly 17× realtime, with the model cached in-process after first load. (Since 2026-10-16
`tiny` is refused: see below.)

**The speech model is a press of its own, pinned** (since 2026-10-16, `docs/CLIPS.md` §3a.4,
§16.49). `WhisperModel("small", download_root=…)` used to fetch `Systran/faster-whisper-small`
at `main` on the first Transcribe, 464 MB with nothing on screen naming it, and asked
huggingface.co at every session's first load. Now:

- `asr.py` pins commit `536b0662742c02347bc0e980a01041f333bce120` and only the four files the
  load reads: `config.json`, `vocabulary.txt`, `tokenizer.json` and `model.bin`, 486,212,372 B
  ("464 MB" on the press).
- **`asr.transcribe` never downloads.** With the model not on disk it answers `unavailable`,
  "The speech model is not downloaded yet"; it loads the snapshot folder by path with
  `local_files_only=True`, so a session asks no host (measured: a fresh session with no host
  allowed transcribed in 1.6 s). Any `model` but `small` is refused.
- **`asr.model`** answers `{present, bytes, label, host}`, and fetches only with `download:
  true`, each file through `media.download` at the pinned revision, cancellable at each chunk.
  The window's press is "Get the speech model · 464 MB" (Settings, the Media pool, the
  Transcript tile), with its X.
- The download goes to `huggingface.co`, which answers `model.bin` with a 302 to
  `us.aws.cdn.hf.co`, so the rule above (`huggingface.co` and `*.hf.co`) holds for it too. Measured
  through the installed pack without hf-xet: 486,212,372 B in 14.7 s (`EFFECTS.md` §59).
- `tests/sidecar/test_asr.py` (16, on a bare interpreter too) holds a transcription with the
  model on disk to make no request (every hub call replaced by one that raises); `asr.int`
  needs the model seeded in `FORGE_MODELS_DIR` and a `jfk.flac` for its transcription cases.

## Faces — the helper's first child process

`vision.faces` (`capabilities/faces.py`, `docs/CLIPS.md` §4.3) runs MediaPipe's BlazeFace
full-range detector **in a worker process**, `forge_sidecar.workers.mp_faces` started through
its bootstrap (below), never in the helper: the macOS wheel aborts the whole process where there is no Metal device, even
on the CPU delegate (`EFFECTS.md` §37). Measured in the dev sandbox through the helper: the
worker imports mediapipe cleanly, dies at `create_from_options` with return code **−6**
(`graph_service.h:139] Check failed: service_`), and the request answers `unavailable`, "the
face detector stopped (code -6): …", while the helper keeps answering `ping`.

- **mediapipe is never imported in the helper.** Its import needs `cv2` and
  `matplotlib.pyplot`, which only the stubs satisfy, on the worker's path alone (the stubs rule,
  below); without them the worker's import fails on `No module named 'cv2'` (measured).
  Registration asks only `importlib.util.find_spec('mediapipe')`.
- **The conversation**: one JSON spec line on the worker's stdin, which then stays open — its
  end is the cancel, and it also ends by itself if the helper dies, so a worker never outlives
  it; `ready` / `progress <fraction> <frames>` / `done` / `error <kind> <message>` lines on its
  stdout; the track written as it goes to a `.part` beside the cache file and renamed into place
  whole. A cancel closes stdin (the worker stops before its next frame and kills its ffmpeg) and
  kills it after 3 s if it has not gone. A pass that stops short removes its own `.part`, because
  the end of stdin is also how the helper's death reaches it (measured: a helper SIGKILLed
  mid-pass left `<track>.<pid>-<id>.part` in the cache for good before the worker did this); one
  left by a kill or an abort of the worker itself is removed by the helper.
- **The worker's stdin watcher reads the raw descriptor** (`os.read`), never
  `sys.stdin.buffer`: a daemon thread blocked in the BufferedReader holds its lock, and the
  interpreter's shutdown then aborts with −6 after a pass that finished — measured, and the
  same code the detector dies with.
- **The model is a download behind a press.** `vision.faces` never fetches; with the model not on
  disk it answers `unavailable` ("the face finder is not downloaded yet (1,083,786 bytes from
  storage.googleapis.com) …"). `vision.facesModel` answers `{present, bytes, label, host}`, and
  fetches only with `download: true`, through `media.fetch_url` against the pinned sha256, into
  `models_dir()/files/3698b18f063835bc-blaze_face_full_range.tflite`.

## The subject finder — `vision.salient`

`vision.salient` (`capabilities/salient.py`, `docs/CLIPS.md` §4.4) says where the subject is in
a shot with no face. For each `{path, ms}` item it decodes one frame at 1024² with
`media.decode_rgb`, runs it through BiRefNet_lite's matte — **depth's own session**, `matte:fp16`,
built under depth's lock, so a parallax bake and an analysis share one model in memory — and
answers `{ms, box, coverage}` by a bake's `subjectBox` rule (a box only when the matte covers
1–92 %, drawn after `_clean_mask` and trimmed at 1 %, in the upright frame), or `{ms, error}`
for that item alone (a missing file, a size mismatch, a frame that will not decode). It is
gated as the face finder is: `vision.salient` never fetches, and without the model answers
`unavailable` before any session opens, because `depth._matte_session` downloads on a cache
miss; `vision.salientModel` answers `{present, bytes, label, host}` and fetches the
114,538,221 B only on `download: true`, cancellable at each 10 MiB chunk. It needs numpy,
onnxruntime, scipy and huggingface_hub; on a bare interpreter both methods are degraded.
**Its cost is memory**: measured on the dev Mac, one matte peaks the helper at 6.6–9.7 GB, and
with ORT's default arena the helper keeps 4.9–8.7 GB until `matte:fp16` is dropped (155–294 MB
after), which is over the 8 GB floor machine's budget (`EFFECTS.md` §54, `CLIPS.md` §12.1);
and each item is about 8–9 s of matte on the CPU.

## Workers — `forge_sidecar/workers/`

A worker is a child process the helper runs, never code it imports: since 2026-10-14
`mp_faces` starts as `<sys.executable> -E -s -B -c <bootstrap>` on every rung, the bootstrap
putting what the worker needs first on its own `sys.path` and running the module as `__main__`
with `runpy` (`faces.worker_command`, `docs/CLIPS.md` §3a.2), started with `media._NO_WINDOW` (a
packaged Windows app has no console, so a child without it opens a window) and with its own
environment, a copy of the helper's, which `-E` keeps from reaching its path. It talks to the capability that started it only through its pipes and the files it
writes. A library goes into a worker when loading it can kill the process that loads it, or
when it needs import-time shims the helper must not see; today that is `mp_faces`, for both
reasons. The helper imports nothing from the package (`-X importtime` across a face pass: 601
import lines, none of them `forge_sidecar.workers`), so registration can only ask
`find_spec`, and the worker's own import is the real check, made per run. The capability
reads the worker's last `error <kind> <message>` line, not only its code: `import` (exit 69)
answers `unavailable` ("could not start: …"); `input`, bad input or an undecodable file
(exit 65), is a `ValueError`; a cancel exits 75; any other death is `unavailable` with its
return code and the line of its stderr that says why — its C++ `Check failed` line when there
is one, since an abort's log ends in a stack trace (−6 on macOS for an abort; Windows' is unmeasured,
3 or `0xC0000409`). It costs one process start and one import per request: 0.14–0.23 s for
`mp_faces` on the dev Mac. Since 2026-10-14 its `_mediapipe()` also loads mediapipe's native
library (`mediapipe_c_bindings.load_raw_library()`, 0.068 s, no model and no Metal), which the
three imports alone do not, so `ready` means the library is loaded; its `{"mode": "import"}` run
is the self-test's faces group (below).

## The stubs — `forge_sidecar/stubs/`

Three empty files, `cv2/__init__.py`, `matplotlib/__init__.py` and `matplotlib/pyplot.py`,
satisfy mediapipe 0.10.35's import-time `import cv2` and `import matplotlib.pyplot`
(`drawing_utils.py:20-21`), so the ~65 MB of `opencv-contrib-python` and matplotlib that its
dependency list would bring are never installed (`--no-deps`, the second pip run below; the
app's pack installs everything in one `--no-deps` run over a complete lock), and
detection runs without them (`EFFECTS.md` §37). **The rule: they go first on a worker's
`sys.path`, put there by its bootstrap, and nowhere else** — never the helper's `sys.path`, its
environment, the helper's launch in main (`helperLaunch`), or the package's `__main__`. (They
were on the worker's `PYTHONPATH` until 2026-10-14; `-E` ignores that, and a user's own
`PYTHONPATH` or the Windows registry could reach it too, `docs/CLIPS.md` §3a.2.) A stub on the
helper's path would answer for a real `cv2` installed later (mask tracking's planned
`opencv-python-headless`) and break it silently. `faces.worker_env` builds the worker's
environment as a plain copy; `faces.int.test.ts` starts the helper as main does on a
development rung (`plainHelperEnv`, cwd `sidecar/`, the package's `__main__`) and asserts no
stub folder on its path and no `mediapipe`, `cv2` or `matplotlib` loaded. The stubs
are tied to the pinned mediapipe: an upgrade re-runs the worker's import test in the same file.

## Setup

```bash
python3 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.txt
```

This venv is development's route, and the only one that needs pip by hand. **An installed app
uses the pack**: a pinned CPython 3.14.8 with the base pack's wheels (46 on the Mac, 47 on
Windows since pack 2), fetched and checked against a lock the app ships, installed offline by
the pack's own pip into `userData/python/<pack>/`, and checked by `system.selftest`
(`src/main/sidecar/install.ts`, `docs/CLIPS.md` §3a). The user presses it in Settings → AI
helper (Python) → **Install the AI helper · 166 MB** on the Mac, **· 201 MB** on Windows (since
2026-10-16; the row is `src/shared/sidecar/row.ts`, with Repair, Update, Remove and Check again
beside it). It is started as `-E -s -u -B -m forge_sidecar` with a cleaned environment, so
nothing of a user's own Python reaches it, and `NUMBA_CACHE_DIR` under `userData/helper-cache`,
so numba's cache never lands in the pack.

The installer ships no Python and no venv (`docs/PACKAGING.md`). In development a pack can
be installed into `userData/python-dev/` (its own root, so the dev app never touches the
installed one's); the tests reach a pack through `FORGE_HELPER_PACK=<userData or version
folder>` (`tests/integration/venv.ts`), started through the pack rung's own launch, and
`FORGE_PACK_REAL=1 npx vitest run tests/integration/helperPack.int.test.ts` installs one for
real from the pinned hosts. CI does both on every push, on Windows and `macos-14`
(`.github/workflows/ci.yml`, CLIPS §3a.6).

Which Python runs the helper is `resolveHelperPython` (`src/shared/sidecar/helperPython.ts`,
`docs/CLIPS.md` §3a.2). In development: `FORGE_PYTHON` when set, then this venv, then a dev pack
under `userData/python-dev/`, then `python` on Windows and `python3` elsewhere. A packaged app
runs the pack the app installed, then `FORGE_PYTHON`, and otherwise nothing: it never starts a
Python from PATH.

The face finder, optional, is two pip runs, because pip rejects `--no-deps` inside a
requirements file:

```bash
sidecar/.venv/bin/python -m pip install -r sidecar/requirements-faces.txt
sidecar/.venv/bin/python -m pip install --no-deps -r sidecar/requirements-faces-nodeps.txt
```

Run it by hand to inspect the protocol:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"system.hello"}' | (cd sidecar && .venv/bin/python -m forge_sidecar)
```

`system.sleep` exists purely so the transport's progress and cancel paths can be tested
end to end without loading a model.

`system.selftest` (`forge_sidecar/selftest.py`, since 2026-10-14) proves the native libraries
load as a fresh helper loads them, which `hello` cannot: registration imports too little (beats'
`import librosa` loads neither soxr nor numba), and in one process scikit-learn's Windows wheel
preloads its own `msvcp140.dll` for everything after it. So each of six groups (asr, beats,
onnx, vision, sklearn, faces) runs in its own `<sys.executable> -E -s -B -c` child, one after
another, 60 s each, and answers `{exit, ms, error}`. The install job runs it after pip, and
Check again reruns it alone (`docs/CLIPS.md` §3a.3). A failed group greys its methods
(`SELFTEST_GROUPS`, `src/shared/sidecar/selftest.ts`: the asr group takes both
`asr.transcribe` and `asr.model`, since 2026-10-16), and the Settings row names it; on
Windows a loader failure reads "needs Microsoft's Visual C++ runtime" with Microsoft's link
and Check again.
