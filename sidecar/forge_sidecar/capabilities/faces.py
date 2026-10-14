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
``forge_sidecar/stubs`` satisfy, and those go on the WORKER's ``PYTHONPATH``
alone (``worker_env``), so a real ``cv2`` installed later for mask tracking is
never shadowed in the helper. Registration asks ``importlib.util.find_spec``
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

_PACKAGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUBS_DIR = os.path.join(_PACKAGE_DIR, "stubs")
"""``forge_sidecar/stubs``: first on the worker's PYTHONPATH, never on the helper's sys.path."""
PACKAGE_PARENT = os.path.dirname(_PACKAGE_DIR)
"""The folder ``forge_sidecar`` is in — the worker's cwd, and on its PYTHONPATH after the stubs."""

WORKER_MODULE = "forge_sidecar.workers.mp_faces"
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
    """The worker's environment: ``base`` (FORGE_* and all) with the stubs FIRST on PYTHONPATH.

    A copy: the helper's own ``os.environ`` is never touched, so nothing it
    starts later — and nothing it imports — sees the stubs. After the stubs,
    the folder ``forge_sidecar`` is in (the worker runs ``-m``), then whatever
    PYTHONPATH the helper itself was given.
    """
    env = dict(base)
    inherited = env.get("PYTHONPATH")
    env["PYTHONPATH"] = os.pathsep.join([STUBS_DIR, PACKAGE_PARENT, *([inherited] if inherited else [])])
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def worker_command(base: Mapping[str, str] = os.environ) -> dict[str, Any]:
    """How the worker is started: argv, cwd and environment — one place, which the tests read."""
    return {
        "argv": [sys.executable or "python", "-m", WORKER_MODULE],
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


def last_words(text: str) -> str:
    """The line of a dead worker's stderr that says why: its C++ ``Check failed`` if there is one.

    An abort ends its log with a stack trace (``*** Check failure stack
    trace: ***`` then ``@ 0x… frame`` lines, measured in the sandbox), whose
    last line is a thread entry point; the line that names the failure is the
    ``F…] Check failed: …`` above it. Otherwise the last line that is not a
    stack frame.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not line.startswith(("@", "***"))]
    checks = [line for line in lines if "Check failed" in line]
    chosen = checks[-1] if checks else (lines[-1] if lines else "")
    return chosen[:300]


def _last_line(errors: Any) -> str:
    try:
        errors.seek(0)
        return last_words(errors.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return ""


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
    ``Unavailable`` (it could not import mediapipe, or it died — an abort
    included — with the code it died with), or ``ValueError`` (the file could
    not be decoded).
    """
    command = worker_command()
    lines: "queue.Queue[str | None]" = queue.Queue()
    failure: tuple[str, str] | None = None

    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            command["argv"], cwd=command["cwd"], env=command["env"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
            **media._NO_WINDOW,
        )
        # The helper's log (stderr): which process is the worker, so a stuck
        # one can be found — and so tests/integration/faces.int.test.ts can
        # check it is gone after a cancel without listing processes.
        print(f"faces: worker {process.pid} started", file=sys.stderr, flush=True)

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
            while True:
                context.raise_if_cancelled()
                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    continue
                if line is None:
                    break
                kind, _, rest = line.partition(" ")
                if kind == "progress":
                    fraction, _, _frames = rest.partition(" ")
                    try:
                        value: float | None = min(0.99, max(0.0, float(fraction)))
                    except ValueError:
                        value = None
                    context.progress(value, "finding faces")
                elif kind == "ready":
                    print(f"faces: worker {process.pid} ready ({rest})", file=sys.stderr, flush=True)
                elif kind == "error":
                    what, _, message = rest.partition(" ")
                    failure = (what, message)
            code = process.wait()
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
        tail = _last_line(errors)

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
