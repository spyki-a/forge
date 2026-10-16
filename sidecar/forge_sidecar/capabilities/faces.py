"""Faces through a clip, for the reframe — MediaPipe in a child process.

docs/CLIPS.md §4.3. Two methods, one OPTIONAL row:

- ``vision.faces`` (FacesParams → FacesResult): every sampled frame's faces,
  written to a track file in ``media.cache_dir("faces")`` — ten minutes at
  5 fps is 3,000 samples, so the track goes to disk and only its path comes
  back. NEVER downloads: with the model not on disk it answers
  ``Unavailable`` ("… is not downloaded yet"), as voice.speak does for
  Kokoro's files.
- ``vision.facesModel`` (ModelParams → ModelStatus): whether the model is on
  disk, with its size and host — what the dock's "Follow the subject · gets
  the face finder, 1.1 MB, first time" needs before any press — and, with
  ``download: true`` (set only by that press), the fetch, through
  ``media.fetch_url`` against a pinned sha256 with labelled byte progress and
  cancel. Why two methods and not a flag on the analysis is written in
  src/shared/sidecar/protocol.ts above ModelParams.

**mediapipe is never imported here.** Its import needs ``cv2`` and
``matplotlib.pyplot`` (drawing_utils.py:20-21), which only the empty stubs in
``forge_sidecar/stubs`` satisfy, and those go first on the WORKER's
``sys.path`` alone (``worker_command``'s bootstrap), so a real ``cv2``
installed later for mask tracking is never shadowed in the helper. Registration asks ``importlib.util.find_spec``
whether the package is there at all; the worker's own import is the real
check, made per run, and a failure there is that request's ``Unavailable``.

**The detector runs in ``forge_sidecar.workers.mp_faces``**, a child process
that decodes the clip itself (``media.iter_frames``) and writes the track. Its
macOS wheel aborts the process where there is no Metal device, even on the
CPU delegate (docs/EFFECTS.md §37: SIGABRT, return code -6, which a shell
prints as 134); that ends the child, and this answers ``Unavailable('the face
detector stopped (code -6)')`` while the helper keeps answering. The child's
progress lines are relayed as "finding faces"; a cancel closes its stdin (it
stops before the next frame and kills its ffmpeg) and kills it if it has not
gone within ``STOP_GRACE_S``; whatever it leaves half-written is removed.

Install with:
    pip install -r sidecar/requirements-faces.txt
    pip install --no-deps -r sidecar/requirements-faces-nodeps.txt
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Mapping

from .. import media
from ..rpc import Cancelled, Context, Server, Unavailable

MEDIAPIPE_VERSION = "0.10.35"
"""requirements-faces-nodeps.txt's pin. The stubs are tied to it: an upgrade
re-runs the worker's import test (tests/integration/faces.int.test.ts)."""

DETECTOR = f"mediapipe/blaze_face_full_range@{MEDIAPIPE_VERSION}"

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_full_range/float16/1/blaze_face_full_range.tflite"
)
"""The versioned path, ``float16/1/``. ``float16/latest/`` served the same
bytes on 2026-10-13 (both 1,083,786 B, md5 XeN2/MhVJzxccgdm02UjoA==, sha256
below), but ``latest`` is a name that can move; the sha256 refuses anything
else either way."""

MODEL_SHA256 = "3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b"
"""sha256 of the file the user's Mac detected with (sidecar/.venv-faces/models,
docs/EFFECTS.md §37), and of both URLs' bytes, computed 2026-10-13."""

MODEL_BYTES = 1_083_786
MODEL_LABEL = "the face finder"
MODEL_HOST = "storage.googleapis.com"

TRACK_VERSION = 2
"""The track file's version, and part of its cache key (``track_path``). 2
since 2026-10-14: each sample is the frame on screen at its ms
(media.frame_args' ``fps=…:round=up``); version 1's samples were up to half a
slot late (66.7 ms at 5 a second on 30 fps), so a version-1 track is never
reused. The worker writes its own copy (workers/mp_faces.py, held equal by
tests/sidecar/test_faces.py), and src/shared/sidecar/protocol.ts
``FACES_TRACK_VERSION`` is what main reads."""
DEFAULT_FPS, MIN_FPS, MAX_FPS = 5.0, 1.0, 30.0
DEFAULT_EDGE, MIN_EDGE, MAX_EDGE = 640, 64, 2048
DEFAULT_MIN_SCORE = 0.5

STOP_GRACE_S = 3.0
"""How long a cancelled worker gets to stop by itself (it checks between frames,
5 ms apart on the user's Mac) before it is killed."""

READY_TIMEOUT_S = 60.0
"""How long a running worker may take to say ``ready`` (mediapipe imported, its
native library loaded) before it is stopped and the request answers
``Unavailable`` with the last lines of its stderr. Without it, a worker that
hung before ``ready`` held the request for as long as the caller waited. The
self-test's ceiling for the same import (selftest.GROUP_TIMEOUT_S: a cold
Surface, Defender's first scan of the library), held equal by
tests/sidecar/test_faces.py: an import the self-test passes, a pass never
refuses."""

SILENT_REPORT_S = 10.0
"""After this long with no line from the worker, and again each time as long
again passes, the helper's log (its stderr: main's console, the tests'
diagnostics) says so: still running or not, its last line, and the tail of its
stderr — the worker's stage notes and, past workers/mp_faces.py
``STALL_DUMP_S``, every thread's stack. Logged only; the pass goes on."""

NOTE_PREFIX = "mp_faces: "
"""workers/mp_faces.py ``NOTE_PREFIX``, a literal copy: the worker's own stage
notes, never the reason it died (``last_words``)."""

TAIL_BYTES = 64 * 1024
"""How much of the end of the worker's stderr is read for a message or a report."""

_PACKAGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUBS_DIR = os.path.join(_PACKAGE_DIR, "stubs")
"""``forge_sidecar/stubs``: first on the worker's sys.path, never on the helper's."""
PACKAGE_PARENT = os.path.dirname(_PACKAGE_DIR)
"""The folder ``forge_sidecar`` is in — the worker's cwd, and second on its sys.path."""

WORKER_MODULE = "forge_sidecar.workers.mp_faces"

WORKER_FLAGS = ("-E", "-s", "-B")
"""The worker's interpreter flags (docs/CLIPS.md §3a.2): ``-E`` ignores every
``PYTHON*`` variable and, on Windows, the registry's ``PythonPath`` subkeys
that CPython puts ahead of the stdlib, ``-s`` skips the user site, ``-B``
writes no ``__pycache__`` into the app's own folder. Not ``-I``: the
bootstrap sets the path itself, and ``-I``'s ``-P`` is not needed for that."""

def worker_bootstrap(stubs: str, parent: str) -> str:
    """``WORKER_BOOTSTRAP`` for two folders: a function so a test can build it for any path."""
    return (
        "import runpy, sys\n"
        f"sys.path[0:0] = [{stubs!r}, {parent!r}]\n"
        f"runpy.run_module({WORKER_MODULE!r}, run_name='__main__', alter_sys=True)\n"
    )


WORKER_BOOTSTRAP = worker_bootstrap(STUBS_DIR, PACKAGE_PARENT)
"""How the worker starts, as ``-c``: the stubs FIRST on its ``sys.path``,
the package's folder second, then the worker module run as ``__main__``.
It used to get both through ``PYTHONPATH``, which ``-E`` ignores — and which
a user's own ``PYTHONPATH`` or the Windows registry could reach as well.
Three lines: on Windows ``subprocess.list2cmdline`` quotes it whole and the C
runtime gives it back newlines and all (a ``repr`` with a quote in it
included), which tests/sidecar/test_faces.py checks against the C runtime's
own rules."""
# The worker's own names for its environment variables and exit codes. Kept
# as literals rather than imported: nothing in forge_sidecar.workers is
# imported by the helper (workers/__init__.py). test_faces.py holds the two
# copies equal.
FAKE_ENV = "FORGE_FACES_WORKER_FAKE"
EXIT_INPUT = 65
EXIT_IMPORT = 69


# ------------------------------------------------------------------- model


def model_path() -> str:
    """Where ``media.fetch_url`` keeps the model: ``models_dir()/files/<sha256[:16]>-<leaf>``.

    ``media.fetched_path``, the name ``fetch_url`` itself uses, so asking
    whether the model is on disk never fetches. tests/sidecar/test_faces.py
    holds the two equal by fetching a local file through ``fetch_url``.
    """
    return media.fetched_path(MODEL_URL, MODEL_SHA256)


def model_status() -> dict[str, Any]:
    """ModelStatus: on disk or not, and what the Get button names before the press."""
    return {
        "present": os.path.isfile(model_path()),
        "bytes": MODEL_BYTES,
        "label": MODEL_LABEL,
        "host": MODEL_HOST,
    }


def faces_model(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``vision.facesModel``: answer, and fetch only when ``download`` is exactly true."""
    if params.get("download") is True and not os.path.isfile(model_path()):
        media.fetch_url(MODEL_URL, MODEL_SHA256, context, MODEL_LABEL)
    return model_status()


# ----------------------------------------------------------------- settings


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def detector_name(environ: Mapping[str, str] = os.environ) -> str:
    """``DETECTOR``, or the worker's stand-in by name, so a stand-in track is never served as real."""
    fake = environ.get(FAKE_ENV)
    return f"test-stand-in/{fake}" if fake else DETECTOR


def settings(params: dict[str, Any]) -> dict[str, Any]:
    """FacesParams checked, with every default and clamp applied — what the cache is keyed on."""
    path = params.get("path")
    if not isinstance(path, str) or not os.path.isfile(path):
        raise ValueError(f"No such video: {path!r}")
    for tool in ("ffmpeg", "ffprobe"):
        if not isinstance(params.get(tool), str) or not params[tool]:
            raise ValueError(f"Finding faces needs the {tool} path")
    key = params.get("key")
    if not isinstance(key, str) or not key:
        raise ValueError("Finding faces needs the file's cache key (`${size}:${mtimeMs}`)")

    fps = _finite(params.get("fps"))
    fps = DEFAULT_FPS if fps is None else min(MAX_FPS, max(MIN_FPS, fps))
    edge = _finite(params.get("edge"))
    edge_px = DEFAULT_EDGE if edge is None else int(min(MAX_EDGE, max(MIN_EDGE, round(edge))))
    min_score = _finite(params.get("minScore"))
    min_score = DEFAULT_MIN_SCORE if min_score is None else min(1.0, max(0.0, min_score))
    start = _finite(params.get("startMs"))
    start_ms = 0.0 if start is None else max(0.0, start)
    end = _finite(params.get("endMs"))
    if params.get("endMs") is not None and end is None:
        raise ValueError(f"endMs must be a number, not {params.get('endMs')!r}")
    if end is not None and end <= start_ms:
        raise ValueError(f"endMs ({end}) must be after startMs ({start_ms})")

    return {
        "path": path,
        "ffmpeg": params["ffmpeg"],
        "ffprobe": params["ffprobe"],
        "width": params.get("width"),
        "height": params.get("height"),
        "startMs": start_ms,
        "endMs": end,
        "fps": round(fps, 3),
        "edge": edge_px,
        "minScore": round(min_score, 4),
        "key": key,
    }


def _file_safe(key: str) -> str:
    """The key as a file-name part: ``123:1728.5`` → ``123-1728.5``.

    The key holds a COLON (``${size}:${mtimeMs}``, src/main/assets.ts
    ``fileKey``), illegal in a Windows file name (CLAUDE.md). Two keys that
    clean to the same text still get different tracks: the RAW key is in the
    hash beside it.
    """
    cleaned = re.sub(r"[^0-9A-Za-z._-]", "-", key)[:64].strip(". ")
    return cleaned or "key"


def track_path(s: dict[str, Any], environ: Mapping[str, str] = os.environ) -> str:
    """``$FORGE_CACHE_DIR/faces/<key>-<params hash>.json``, absolute.

    The hash is over everything that changes the samples: the raw key, the
    upright size, the window, the rate, the edge, the score floor, the
    detector (a stand-in included) and the model's sha256 — so a re-analysis
    with any of them changed is a new track, never the old one.
    """
    identity = {
        "version": TRACK_VERSION,
        "detector": detector_name(environ),
        "model": MODEL_SHA256,
        "key": s["key"],
        "width": int(s["width"]),
        "height": int(s["height"]),
        "startMs": s["startMs"],
        "endMs": s["endMs"],
        "fps": s["fps"],
        "edge": s["edge"],
        "minScore": s["minScore"],
    }
    digest = hashlib.sha1(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    return os.path.abspath(os.path.join(media.cache_dir("faces"), f"{_file_safe(s['key'])}-{digest}.json"))


def summary(track: str) -> tuple[int, int] | None:
    """``(frames, frames with a face)`` of a track on disk; None when it is not a whole version-1 track."""
    try:
        with open(track, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("version") != TRACK_VERSION:
        return None
    samples = data.get("samples")
    if not isinstance(samples, list):
        return None
    with_face = sum(1 for sample in samples if isinstance(sample, dict) and sample.get("faces"))
    return len(samples), with_face


# ------------------------------------------------------------------- worker


def worker_env(base: Mapping[str, str]) -> dict[str, str]:
    """The worker's environment: a copy of ``base``, FORGE_* and all.

    Nothing is added: the stubs reach the worker through its bootstrap's
    ``sys.path``, not ``PYTHONPATH`` (``-E`` ignores it), and the worker sets
    its own stdio to UTF-8 and flushes every line, so ``PYTHONUNBUFFERED`` and
    ``PYTHONIOENCODING`` (ignored under ``-E`` too) are not needed. A copy, so
    the helper's own ``os.environ`` is never touched.
    """
    return dict(base)


def worker_command(base: Mapping[str, str] = os.environ) -> dict[str, Any]:
    """How the worker is started: argv, cwd and environment — one place, which the tests read.

    One shape on every rung, the pack's and the venv's alike:
    ``<this interpreter> -E -s -B -c <bootstrap>``.
    """
    return {
        "argv": [sys.executable or "python", *WORKER_FLAGS, "-c", WORKER_BOOTSTRAP],
        "cwd": PACKAGE_PARENT,
        "env": worker_env(base),
    }


def worker_spec(s: dict[str, Any], duration_ms: float | None, model: str, track: str, partial: str) -> dict[str, Any]:
    """The spec line the worker reads (workers/mp_faces.py ``parse_spec``)."""
    return {
        "mode": "detect",
        "path": s["path"],
        "ffmpeg": s["ffmpeg"],
        "width": int(s["width"]),
        "height": int(s["height"]),
        "fps": s["fps"],
        "edge": s["edge"],
        "minScore": s["minScore"],
        "startMs": s["startMs"],
        "endMs": s["endMs"],
        "durationMs": duration_ms,
        "model": model,
        "track": track,
        "partial": partial,
    }


_NOT_WHY = ("@", "***", NOTE_PREFIX, "Timeout (", "Thread 0x", "Current thread 0x", "<no Python frame>", "...")
"""Lines of a worker's stderr that never say why it died: an abort's stack
frames, the worker's own stage notes, and ``faulthandler``'s stall dump (its
``Timeout (0:00:08)!`` header, each thread's line, and its frames, whose
``line N in f`` has no comma — a Python traceback's ``line N, in f`` does, and
its last line, the exception, is a reason)."""
_DUMP_FRAME = re.compile(r'File ".*", line \d+ in ')


def last_words(text: str) -> str:
    """The line of a dead worker's stderr that says why: its C++ ``Check failed`` if there is one.

    An abort ends its log with a stack trace (``*** Check failure stack
    trace: ***`` then ``@ 0x… frame`` lines, measured in the sandbox), whose
    last line is a thread entry point; the line that names the failure is the
    ``F…] Check failed: …`` above it. Otherwise the last line that is not a
    stack frame, a stage note or a stall dump's (``_NOT_WHY``).
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not line.startswith(_NOT_WHY) and not _DUMP_FRAME.match(line)]
    checks = [line for line in lines if "Check failed" in line]
    chosen = checks[-1] if checks else (lines[-1] if lines else "")
    return chosen[:300]


def worker_log(errors: Any) -> str:
    """The end of what the worker has written to stderr so far (``TAIL_BYTES``), as text.

    The worker writes through the same open file, whose offset the two
    processes share. On POSIX it is read with ``os.pread``, which leaves the
    offset alone; on Windows (no ``pread``) by seeking, after which the offset
    is at the end — where the worker's next write goes anyway. It is read
    while the worker is silent or gone, so a write landing between that seek
    and the read, the one race, could cost a diagnostic's first bytes at most.
    """
    try:
        fd = errors.fileno()
        size = os.fstat(fd).st_size
        start = max(0, size - TAIL_BYTES)
        chunks: list[bytes] = []
        if hasattr(os, "pread"):
            offset = start
            while True:
                chunk = os.pread(fd, 1 << 16, offset)
                if not chunk:
                    break
                chunks.append(chunk)
                offset += len(chunk)
        else:  # pragma: no cover - Windows
            os.lseek(fd, start, os.SEEK_SET)
            while True:
                chunk = os.read(fd, 1 << 16)
                if not chunk:
                    break
                chunks.append(chunk)
        return b"".join(chunks).decode("utf-8", "replace")
    except (OSError, ValueError):
        return ""


_THREAD = re.compile(r"^(?:Current thread|Thread) (0x[0-9a-fA-F]+)(?: \[(.*)\])? \(most recent call first\):$")


def _bounded(text: str, limit: int) -> str:
    return text if len(text) <= limit else "…" + text[-(limit - 1):]


def compact_dump(text: str, frames: int = 4) -> str:
    """faulthandler's LAST stall dump in ``text`` on one line: each thread's newest ``frames`` frames.

    ``main: media.py:307 iter_frames < mp_faces.py:523 run < … | Thread-1: …``
    — file names without their folders (a user's profile path stays out of the
    log), the thread holding ``<module>`` named ``main``. "" when there is no dump.
    """
    lines = [line.strip() for line in text.splitlines()]
    starts = [i for i, line in enumerate(lines) if line.startswith("Timeout (")]
    if not starts:
        return ""
    threads: list[tuple[str, list[str]]] = []
    for line in lines[starts[-1] + 1:]:
        thread = _THREAD.match(line)
        if thread:
            threads.append((thread.group(2) or thread.group(1), []))
            continue
        frame = re.match(r'File "(.*)", line (\d+) in (.*)$', line)
        if frame and threads:
            leaf = re.split(r"[\\/]", frame.group(1))[-1]
            threads[-1][1].append(f"{leaf}:{frame.group(2)} {frame.group(3)}")
    said = []
    for name, stack in threads:
        label = "main" if any(f.endswith(" <module>") for f in stack) else name
        said.append(f"{label}: {' < '.join(stack[:frames]) or '(no Python frame)'}")
    return " | ".join(said)


def stderr_summary(text: str, limit: int = 1500) -> str:
    """A worker's stderr on one line: its last stage notes, its last other lines, and its last stall dump's stacks.

    What a silent or stopped worker was doing, in the order it is read: where
    it got to (``notes``), anything else it said (``other``: a library's
    warning, an exception), and the line each thread is on (``stacks``,
    ``compact_dump``). "" for an empty stderr.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    notes = [line for line in lines if line.startswith(NOTE_PREFIX)]
    other = [line for line in lines if not line.startswith(_NOT_WHY) and not _DUMP_FRAME.match(line)]
    parts = []
    if notes:
        parts.append("notes: " + _bounded(" ⏎ ".join(notes[-6:]), limit // 2))
    if other:
        parts.append("other: " + _bounded(" ⏎ ".join(other[-3:]), limit // 4))
    dump = compact_dump(text)
    if dump:
        parts.append("stacks: " + dump)
    return _bounded("; ".join(parts), limit)


def _report_silence(process: subprocess.Popen, quiet_s: float, last: str, said: str, before: str) -> None:
    """One line in the helper's log: the worker silent this long, running or not, its last line, and its stderr if it changed."""
    state = "still running" if process.poll() is None else f"exited (code {process.returncode})"
    stderr = "its stderr unchanged" if said == before else f"its stderr: {said or '(nothing)'}"
    print(f"faces: worker {process.pid} silent {quiet_s:.0f} s, {state}; its last line {last!r}; {stderr}", file=sys.stderr, flush=True)


def _stop(process: subprocess.Popen) -> None:
    """Close the worker's stdin — its cancel — and kill it if it has not gone in STOP_GRACE_S."""
    try:
        if process.stdin is not None:
            process.stdin.close()
    except OSError:
        pass
    try:
        process.wait(timeout=STOP_GRACE_S)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as exc:  # pragma: no cover - a held file on Windows
        print(f"faces: could not remove {path}: {exc}", file=sys.stderr)


def run_worker(spec: dict[str, Any], context: Context) -> None:
    """Run one pass in the worker, relaying its progress; return once the track is in place.

    Raises ``Cancelled`` (the worker stopped, its partial removed),
    ``Unavailable`` (it could not import mediapipe, it died — an abort
    included — with the code it died with, or it was still running without a
    ``ready`` after ``READY_TIMEOUT_S``), or ``ValueError`` (the file could
    not be decoded). While it is silent the helper's log says so every
    ``SILENT_REPORT_S``, with the tail of its stderr.
    """
    command = worker_command()
    lines: "queue.Queue[str | None]" = queue.Queue()
    failure: tuple[str, str] | None = None
    stalled = False

    with tempfile.TemporaryFile() as errors:
        began = time.monotonic()
        process = subprocess.Popen(
            command["argv"], cwd=command["cwd"], env=command["env"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
            **media._NO_WINDOW,
        )
        pid = process.pid
        # The helper's log (stderr): which process is the worker, so a stuck
        # one can be found — and so tests/integration/faces.int.test.ts can
        # check it is gone after a cancel without listing processes.
        print(f"faces: worker {pid} started", file=sys.stderr, flush=True)

        def read() -> None:
            try:
                assert process.stdout is not None
                for raw in process.stdout:
                    lines.put(raw.decode("utf-8", "replace").strip())
            finally:
                lines.put(None)

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        try:
            try:
                assert process.stdin is not None
                process.stdin.write(json.dumps(spec).encode("utf-8") + b"\n")
                process.stdin.flush()
            except OSError:
                pass  # it died before reading: its exit code says why, below
            ready = False
            heard = time.monotonic()
            last = ""
            report_at = SILENT_REPORT_S
            reported = ""
            while True:
                context.raise_if_cancelled()
                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    now = time.monotonic()
                    if not ready and now - began >= READY_TIMEOUT_S and process.poll() is None:
                        stalled = True
                        break
                    if now - heard >= report_at:
                        said = stderr_summary(worker_log(errors))
                        _report_silence(process, now - heard, last, said, reported)
                        reported = said
                        report_at += SILENT_REPORT_S
                    continue
                if line is None:
                    break
                heard, last, report_at = time.monotonic(), line, SILENT_REPORT_S
                kind, _, rest = line.partition(" ")
                if kind == "progress":
                    fraction, _, _frames = rest.partition(" ")
                    try:
                        value: float | None = min(0.99, max(0.0, float(fraction)))
                    except ValueError:
                        value = None
                    context.progress(value, "finding faces")
                elif kind == "ready":
                    ready = True
                    print(f"faces: worker {pid} ready ({rest})", file=sys.stderr, flush=True)
                elif kind == "error":
                    what, _, message = rest.partition(" ")
                    failure = (what, message)
            # A stalled worker is still running: the finally stops it.
            code = None if stalled else process.wait()
        finally:
            if process.poll() is None:
                _stop(process)
            else:
                try:
                    if process.stdin is not None:
                        process.stdin.close()
                except OSError:
                    pass
            reader.join(timeout=5.0)
            # Closed only once the reader has let go of it: closing a
            # BufferedReader that another thread is blocked reading waits on
            # its lock, and the request would hang for as long as anything
            # held the pipe open (measured: a mutant that never stopped its
            # worker hung the test run here, rather than failing it).
            if process.stdout is not None and not reader.is_alive():
                process.stdout.close()
            # Whatever happened, a half-written track never stays: the worker
            # renames it into place only when whole, so a partial still here
            # is a cancel's, a kill's or an abort's.
            _remove(spec["partial"])
            took = time.monotonic() - began
            print(f"faces: worker {pid} ended (code {process.returncode}) after {took:.1f} s", file=sys.stderr, flush=True)
        log = worker_log(errors)
        tail = last_words(log)

    if stalled:
        said = stderr_summary(log, 900)
        message = f"the face detector did not start within {READY_TIMEOUT_S:g} s (stopped while still running)" + (f": {said}" if said else "")
        print(f"faces: worker {pid}: {message}", file=sys.stderr, flush=True)
        raise Unavailable(message)
    if code == 0:
        return
    if failure is not None and failure[0] == "import":
        raise Unavailable(f"the face detector could not start: {failure[1]}")
    if failure is not None and failure[0] == "input":
        raise ValueError(failure[1] or "the face detector could not read this file")
    raise Unavailable(f"the face detector stopped (code {code})" + (f": {tail}" if tail else ""))


# -------------------------------------------------------------------- faces


def faces(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``vision.faces``: the upright check, the cache, the model gate, then the worker."""
    s = settings(params)
    probed = media.require_upright(s["path"], s["ffprobe"], s["width"], s["height"])
    s["width"], s["height"] = probed["width"], probed["height"]
    duration = probed.get("durationMs")
    track = track_path(s)

    def answer(cached: bool) -> dict[str, Any]:
        counted = summary(track)
        if counted is None:
            raise ValueError(f"the face track at {track} is not readable")
        return {
            "width": s["width"],
            "height": s["height"],
            "durationMs": duration or 0,
            "sampleFps": s["fps"],
            "frames": counted[0],
            "withFace": counted[1],
            "detector": detector_name(),
            "track": track,
            "cached": cached,
        }

    if os.path.isfile(track):
        if summary(track) is not None:
            context.progress(1.0, "finding faces")
            return answer(True)
        _remove(track)  # not a whole track: made again below

    model = model_path()
    if not os.path.isfile(model):
        raise Unavailable(
            f"{MODEL_LABEL} is not downloaded yet ({MODEL_BYTES:,} bytes from {MODEL_HOST}); "
            "vision.facesModel with download: true fetches it"
        )

    os.makedirs(os.path.dirname(track), exist_ok=True)
    partial = f"{track}.{os.getpid()}-{context.request_id}.part"
    context.progress(0.0, "finding faces")
    run_worker(worker_spec(s, duration, model, track, partial), context)
    context.progress(1.0, "finding faces")
    return answer(False)


def register(server: Server) -> None:
    # find_spec only looks: importing mediapipe here would fail on cv2 (the
    # stubs are the worker's alone), and would load 55 MB into the helper.
    if importlib.util.find_spec("mediapipe") is None:
        raise Unavailable(
            "mediapipe is not installed (pip install -r sidecar/requirements-faces.txt, "
            "then pip install --no-deps -r sidecar/requirements-faces-nodeps.txt)"
        )
    server.register("vision.faces", faces)
    server.register("vision.facesModel", faces_model)
