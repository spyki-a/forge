# The Python sidecar

Every local AI capability — ASR now, TTS/matting/depth/LLM later — runs in a separate
Python process that Electron supervises. This is the gate for all of Phase 2 onward.

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
  arm64 wheels; `faster-whisper` is pure Python. Only `soundfile` is sdist-only — and it
  isn't needed, because audio decoding goes through the ffmpeg the app already bundles.
- **Disable Hugging Face's Xet backend.** `hf-xet` fetches from `cas-server.xethub.hf.co`,
  a separate CDN host that restricted networks and corporate proxies block. The client sets
  `HF_HUB_DISABLE_XET=1`; the plain HTTP path is slower.
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
roughly 17× realtime, with the model cached in-process after first load.

## Faces — the helper's first child process

`vision.faces` (`capabilities/faces.py`, `docs/CLIPS.md` §4.3) runs MediaPipe's BlazeFace
full-range detector **in a worker process**, `python -m forge_sidecar.workers.mp_faces`, never
in the helper: the macOS wheel aborts the whole process where there is no Metal device, even
on the CPU delegate (`EFFECTS.md` §37). Measured in the dev sandbox through the helper: the
worker imports mediapipe cleanly, dies at `create_from_options` with return code **−6**
(`graph_service.h:139] Check failed: service_`), and the request answers `unavailable`, "the
face detector stopped (code -6): …", while the helper keeps answering `ping`.

- **mediapipe is never imported in the helper.** Its import needs `cv2` and
  `matplotlib.pyplot`, which only the three empty files in `forge_sidecar/stubs/` satisfy, and
  those go first on the **worker's** `PYTHONPATH` alone (`faces.worker_env`, a copy of the
  helper's environment); without them the worker's import fails on `No module named 'cv2'`
  (measured). Registration asks only `importlib.util.find_spec('mediapipe')`.
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

## Setup

```bash
python3 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.txt
```

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
