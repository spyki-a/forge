"""MediaPipe's face detector over a clip — a CHILD process of the AI helper.

docs/CLIPS.md §4.3. ``capabilities/faces.py`` starts it as

    python -E -s -B -c <bootstrap>

whose bootstrap puts ``forge_sidecar/stubs`` FIRST on this process's
``sys.path`` (never the helper's) and runs this module as ``__main__``
(docs/CLIPS.md §3a.2): three empty files that satisfy mediapipe's import-time
``import cv2`` and ``import matplotlib.pyplot`` (drawing_utils.py:20-21), which
detection never calls. Without them ``import mediapipe`` fails on ``cv2``
(measured on sidecar/.venv, 2026-10-13). A separate process because
MediaPipe's macOS wheel ABORTS the whole process (SIGABRT, return code -6)
where it cannot get a Metal device, even on the CPU delegate
(docs/EFFECTS.md §37): here that ends this child, and the helper says so and
keeps answering.

The conversation, line-based UTF-8:

- **stdin**: one line of JSON, the spec (``parse_spec``), then held OPEN. Its
  end is the cancel — the helper closes it on a cancel, and it ends by itself
  when the helper dies — and the pass stops before the next frame, its
  ffmpeg killed by ``media.iter_frames``.
- **stdout**, one flushed line each:
  ``ready <mediapipe version> <import seconds>`` once the detector's library
  has loaded; ``progress <fraction, or - when the length is unknown> <frames>``
  every ``PROGRESS_EVERY`` frames; ``done <frames> <frames with a face>`` once
  the track is in place; ``error <kind> <message>`` before a handled non-zero
  exit (``input`` → EXIT_INPUT, ``import`` → EXIT_IMPORT).
- **stderr**: the library's own log. The helper keeps its last line for the
  message when this process dies without saying why. Beside it, this
  worker's own stage notes (``_note``: ``mp_faces: <what> (+<s> s)``) and,
  past ``STALL_DUMP_S`` with no progress, every thread's stack
  (``faulthandler``): the helper relays the tail when the worker goes silent
  (capabilities/faces.py ``SILENT_REPORT_S``) and never takes either for the
  reason it died (``faces.last_words``).
- **the track**: written sample by sample to ``spec["partial"]`` and moved
  onto ``spec["track"]`` with ``os.replace`` only when whole, so the cache
  never holds half a track. A pass that stops short removes its own partial
  — a cancel, a file it cannot decode, anything raised — because the end of
  stdin is also how the helper's DEATH reaches it, and then nobody else is
  left to (measured: the helper SIGKILLed mid-pass left
  ``<track>.<pid>-<id>.part`` behind for good, its name carrying a pid no
  later helper has). A partial left by a kill or an abort, which end this
  process before it can, is the helper's to remove.

Boxes are normalised 0..1 against the analysed frame, which is the UPRIGHT
frame scaled (``analysis_size``: long side = edge, the upright aspect, even
sides), clamped to it, at 4 dp; at most the TWO largest per sample, largest
first (by area, a tie to the higher score), each scoring at least
``minScore``. ``ms`` is ``media.iter_frames``' SOURCE time,
``start_ms + i × 1000 / fps``.

The pure parts — the spec, the size, the boxes, the writer — import only the
standard library, so tests/sidecar/test_faces.py runs them on CI's bare
interpreter. numpy and mediapipe are imported inside the pass.

Two environment variables exist for tests/integration/faces.int.test.ts and
nothing else, because the sandbox the tests are built in cannot run the
detector (no Metal) and a test must still see the plumbing work:

- ``FORGE_FACES_WORKER_ABORT=1`` — ``os.abort()`` once the first sample is on
  disk: a C++ CHECK failing mid-pass, deterministically.
- ``FORGE_FACES_WORKER_FAKE=colour[:<ms a frame>]`` — a stand-in detector
  that never imports mediapipe: one box per saturated colour present
  (red 0.9, green 0.8, blue 0.7, yellow 0.3 — the score), the colour's
  bounding box in analysed pixels, optionally slowed. capabilities/faces.py
  names it in the result's ``detector`` and in the cache's hash, so a
  stand-in track is never served as a real one.
"""

from __future__ import annotations

import faulthandler
import io
import json
import math
import os
import sys
import threading
import time
from typing import Any, Callable, Iterable, Sequence

from .. import media
from ..rpc import Cancelled

PROGRESS_EVERY = 10
"""A progress line every this many frames (docs/CLIPS.md §4.3)."""

MAX_FACES = 2
"""Faces kept per sample: the two largest. Main's reduction for the project
keeps the two largest too (§4.6's SubjectSample); a third is never used by the
crop path, which frames one person or two (rule 3's two-up)."""

EXIT_INPUT = 65
"""A spec the worker cannot use, or a file ffmpeg cannot decode."""
EXIT_IMPORT = 69
"""mediapipe did not import — the stubs missing from sys.path, or a broken install."""
EXIT_CANCELLED = 75
"""Stopped because stdin ended. The helper started the cancel and ignores the code."""

ABORT_ENV = "FORGE_FACES_WORKER_ABORT"
FAKE_ENV = "FORGE_FACES_WORKER_FAKE"

NOTE_PREFIX = "mp_faces: "
"""The start of each of this worker's stage notes on stderr. capabilities/faces.py
keeps a literal copy (``last_words`` skips these lines), held equal by
tests/sidecar/test_faces.py."""

STALL_DUMP_S = 8.0
"""With no progress for this long — the import, ffmpeg's start, the first
frame, or ten frames — every thread's stack goes to stderr, once, through
``faulthandler.dump_traceback_later``; re-armed at each progress line and
cancelled at the end. A stuck pass then names the line it is stuck on (the
helper relays it, capabilities/faces.py ``SILENT_REPORT_S``). On the dev Mac
the stand-in's whole 20-frame pass takes well under a second, and the real
detector ten frames in about 50 ms (5 ms a frame, faces.STOP_GRACE_S)."""

TRACK_VERSION = 2
"""capabilities/faces.py's ``TRACK_VERSION``, a literal copy (the helper never
imports this module): 2 = each sample the frame on screen at its ms."""

_began = time.perf_counter()
"""When this module was imported, just before ``main``: what each stage note's ``+<s> s`` counts from."""

Detection = tuple[float, float, float, float, float]
"""``(x, y, width, height, score)`` in analysed pixels, as MediaPipe's
``bounding_box`` gives them: an origin and a size, possibly past the frame."""


# --------------------------------------------------------------------- spec


def _number(spec: dict[str, Any], name: str) -> float:
    value = spec.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"the spec's {name} must be a finite number, not {value!r}")
    return float(value)


def _text(spec: dict[str, Any], name: str) -> str:
    value = spec.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"the spec's {name} must be a non-empty string, not {value!r}")
    return value


def parse_spec(text: str) -> dict[str, Any]:
    """The spec line, checked: every field the pass reads, with its type and range.

    ``mode`` is ``"detect"`` (the default) or ``"import"``, which only loads
    mediapipe and its native library (``_mediapipe``), says ``ready`` and
    exits — the import check tests/integration/faces.int.test.ts runs through
    faces.py's own command, and the self-test's faces group
    (forge_sidecar/selftest.py).
    A process boundary, so nothing is trusted: a field out of range is an
    error here, not a surprise in ffmpeg.
    """
    try:
        spec = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"the spec is not JSON: {exc}") from exc
    if not isinstance(spec, dict):
        raise ValueError("the spec must be a JSON object")
    mode = spec.get("mode", "detect")
    if mode == "import":
        return {"mode": "import"}
    if mode != "detect":
        raise ValueError(f"the spec's mode must be 'detect' or 'import', not {mode!r}")

    width, height = _number(spec, "width"), _number(spec, "height")
    if width < 1 or height < 1 or width != int(width) or height != int(height):
        raise ValueError(f"the upright size must be whole pixels, not {width!r}×{height!r}")
    fps = _number(spec, "fps")
    if not 1 <= fps <= 30:
        raise ValueError(f"fps must be within 1–30, not {fps!r}")
    edge = _number(spec, "edge")
    if edge < 2 or edge != int(edge):
        raise ValueError(f"the edge must be whole pixels, not {edge!r}")
    min_score = _number(spec, "minScore")
    if not 0 <= min_score <= 1:
        raise ValueError(f"minScore must be within 0–1, not {min_score!r}")
    start_ms = _number(spec, "startMs")
    if start_ms < 0:
        raise ValueError(f"startMs must not be negative, not {start_ms!r}")
    end_ms = None if spec.get("endMs") is None else _number(spec, "endMs")
    if end_ms is not None and end_ms <= start_ms:
        raise ValueError(f"endMs ({end_ms!r}) must be after startMs ({start_ms!r})")
    duration_ms = None if spec.get("durationMs") is None else _number(spec, "durationMs")

    return {
        "mode": "detect",
        "path": _text(spec, "path"),
        "ffmpeg": _text(spec, "ffmpeg"),
        "width": int(width),
        "height": int(height),
        "fps": fps,
        "edge": int(edge),
        "minScore": min_score,
        "startMs": start_ms,
        "endMs": end_ms,
        "durationMs": duration_ms,
        "model": _text(spec, "model"),
        "track": _text(spec, "track"),
        "partial": _text(spec, "partial"),
    }


# ------------------------------------------------------------------- frames


def analysis_size(edge: int, width: int, height: int) -> tuple[int, int]:
    """The analysed frame: long side ``edge``, the UPRIGHT aspect, both sides even.

    ``width``×``height`` is the upright size (main's, checked by
    ``media.require_upright``), so a phone clip stored on its side is analysed
    the way it is watched — a 640×360-coded clip turned a quarter is 360×640
    here, and decodes that way (docs/EFFECTS.md §49).
    """
    long_side = max(2, int(edge) // 2 * 2)
    if width >= height:
        return long_side, max(2, int(round(long_side * height / width / 2)) * 2)
    return max(2, int(round(long_side * width / height / 2)) * 2), long_side


def _edge(value: float) -> float:
    return round(value, 4)


def boxes_of(detections: Iterable[Detection], width: int, height: int, min_score: float) -> list[dict[str, float]]:
    """One sample's faces for the track: normalised, filtered, the two largest first.

    Each detection is clamped to the ``width``×``height`` analysed frame
    (BlazeFace's box can run past an edge), dropped when nothing of it is
    inside, when a coordinate is not finite, or when it scores under
    ``min_score``. The edges are rounded to 4 dp and the size is taken
    between the rounded edges, so ``x + width`` never passes 1.
    """
    kept: list[tuple[float, float, dict[str, float]]] = []
    for x, y, w, h, score in detections:
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y, w, h, score)):
            continue
        if score < min_score:
            continue
        x0, y0 = max(0.0, float(x)), max(0.0, float(y))
        x1, y1 = min(float(width), float(x) + float(w)), min(float(height), float(y) + float(h))
        if x1 <= x0 or y1 <= y0:
            continue
        left, top = _edge(x0 / width), _edge(y0 / height)
        right, bottom = _edge(x1 / width), _edge(y1 / height)
        if right <= left or bottom <= top:
            continue
        box = {
            "x": left,
            "y": top,
            "width": _edge(right - left),
            "height": _edge(bottom - top),
            "score": _edge(float(score)),
        }
        kept.append(((x1 - x0) * (y1 - y0), float(score), box))
    kept.sort(key=lambda item: (-item[0], -item[1]))
    return [box for _area, _score, box in kept[:MAX_FACES]]


def expected_frames(spec: dict[str, Any]) -> int | None:
    """How many samples the pass should give, for the progress fraction; None when unknown."""
    end = spec["endMs"] if spec["endMs"] is not None else spec["durationMs"]
    if end is None or end <= spec["startMs"]:
        return None
    return max(1, int(math.ceil((end - spec["startMs"]) * spec["fps"] / 1000 - 1e-9)))


# -------------------------------------------------------------------- track


class TrackWriter:
    """The track file, written as the pass goes and put in place when whole.

    ``{"version": TRACK_VERSION, "samples": [{"ms", "faces": [...]}, …]}`` — the shape
    src/shared/sidecar/protocol.ts ``FacesTrack`` reads. Streamed rather than
    held: memory stays flat however long the clip, and a pass that dies leaves
    only ``partial``, never ``track``.
    """

    def __init__(self, partial: str, track: str) -> None:
        self.partial = partial
        self.track = track
        self.frames = 0
        self.with_face = 0
        folder = os.path.dirname(track)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self._out = open(partial, "w", encoding="utf-8", newline="\n")
        self._out.write('{"version":%d,"samples":[' % TRACK_VERSION)

    def add(self, ms: int, faces: Sequence[dict[str, float]]) -> None:
        sample = json.dumps({"ms": int(ms), "faces": list(faces)}, separators=(",", ":"))
        self._out.write(("," if self.frames else "") + sample)
        # On disk per sample: what a reader of the partial (or an abort's
        # leftovers) finds is every sample so far.
        self._out.flush()
        self.frames += 1
        if faces:
            self.with_face += 1

    def finish(self) -> None:
        self._out.write("]}\n")
        self._out.close()
        os.replace(self.partial, self.track)

    def close(self) -> None:
        if not self._out.closed:
            self._out.close()


# ---------------------------------------------------------------- detectors


def _mediapipe() -> tuple[Any, Any, Any, float]:
    """mediapipe and the two Tasks names the pass needs, its native library loaded, with the seconds.

    The three imports do not load the library: after them
    ``mediapipe_c_bindings._shared_lib`` is still None (measured in
    sidecar/.venv-faces, mediapipe 0.10.35), and ``ctypes.CDLL`` runs only
    inside ``FaceDetector.create_from_options``. On Windows that library is
    ``mediapipe/tasks/c/libmediapipe.dll``, 28,736,000 B of C++ whose wheel
    ships no ``msvcp140`` (docs/CLIPS.md §16.45), so a machine without the
    Visual C++ runtime would pass every import and fail at the first pass.
    ``load_raw_library()`` is that same load with no model and no Metal device
    (0.068 s on the dev Mac, in the sandbox that has none): the import-only
    run, which is the self-test's faces group (forge_sidecar/selftest.py),
    fails here with its ``error import`` line, and ``ready`` comes only once
    the library is in. ``create_from_options`` then reuses the loaded copy.
    """
    started = time.perf_counter()
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core import mediapipe_c_bindings
    from mediapipe.tasks.python.core.base_options import BaseOptions

    mediapipe_c_bindings.load_raw_library()
    return mp, vision, BaseOptions, time.perf_counter() - started


def _blaze_face(mp: Any, vision: Any, base_options: Any, model: str, min_score: float) -> tuple[Callable[[Any, int], list[Detection]], Callable[[], None]]:
    """The Tasks FaceDetector, VIDEO mode, CPU delegate — as sidecar/scripts/facetest.py ran it.

    The model is handed over as bytes rather than a path: the path is under the
    user's profile, which may hold characters the C++ side reads wrongly on
    Windows, and the bytes are 1 MB.
    """
    import numpy as np

    with open(model, "rb") as handle:
        buffer = handle.read()
    options = vision.FaceDetectorOptions(
        base_options=base_options(model_asset_buffer=buffer, delegate=base_options.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO,
        min_detection_confidence=min_score,
    )
    detector = vision.FaceDetector.create_from_options(options)

    def detect(frame: Any, ms: int) -> list[Detection]:
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(frame, dtype=np.uint8, order="C", copy=True))
        found: list[Detection] = []
        for detection in detector.detect_for_video(image, int(ms)).detections:
            box = detection.bounding_box
            score = detection.categories[0].score if detection.categories else 0.0
            found.append((float(box.origin_x), float(box.origin_y), float(box.width), float(box.height), float(score)))
        return found

    return detect, detector.close


COLOURS: tuple[tuple[tuple[bool, bool, bool], float], ...] = (
    ((True, False, False), 0.9),  # red
    ((False, True, False), 0.8),  # green
    ((False, False, True), 0.7),  # blue
    ((True, True, False), 0.3),  # yellow: under the default minScore
)
"""The stand-in's colours, each a channel pattern (on > 200, off < 60) and the score it reports."""


def _colour_detector(delay_ms: float) -> Callable[[Any, int], list[Detection]]:
    """FORGE_FACES_WORKER_FAKE's stand-in: each saturated colour's bounding box, in analysed pixels."""
    import numpy as np

    def detect(frame: Any, _ms: int) -> list[Detection]:
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)
        high, low = frame > 200, frame < 60
        found: list[Detection] = []
        for pattern, score in COLOURS:
            mask = np.ones(frame.shape[:2], dtype=bool)
            for channel, on in enumerate(pattern):
                mask &= high[..., channel] if on else low[..., channel]
            if not mask.any():
                continue
            rows = np.nonzero(mask.any(axis=1))[0]
            cols = np.nonzero(mask.any(axis=0))[0]
            found.append((float(cols[0]), float(rows[0]), float(cols[-1] - cols[0] + 1), float(rows[-1] - rows[0] + 1), score))
        return found

    return detect


def fake_mode(value: str | None) -> tuple[str, float] | None:
    """``colour`` or ``colour:<ms>`` → ``("colour", ms)``; anything else is no stand-in."""
    if not value:
        return None
    name, _, delay = value.partition(":")
    if name != "colour":
        return None
    try:
        ms = float(delay) if delay else 0.0
    except ValueError:
        ms = 0.0
    return name, ms if math.isfinite(ms) and ms > 0 else 0.0


# --------------------------------------------------------------------- run


class _StdinEnd:
    """The pass's context for ``media.iter_frames``: cancelled once stdin ends.

    The watcher reads the raw descriptor with ``os.read``, never
    ``sys.stdin.buffer``: a daemon thread blocked inside the BufferedReader
    holds its lock, and the interpreter's shutdown then aborts the process
    ("Fatal Python error: _enter_buffered_busy: could not acquire lock for
    <_io.BufferedReader name='<stdin>'>", return code -6) — measured, on a
    pass that had written its whole track and said ``done``. That is the
    detector's own death code, so a clean pass would have read as a crash.
    """

    def __init__(self, fd: int) -> None:
        self._ended = threading.Event()
        threading.Thread(target=self._watch, args=(fd,), daemon=True).start()

    def _watch(self, fd: int) -> None:
        try:
            while os.read(fd, 4096):
                pass
        except OSError:
            pass
        self._ended.set()

    @property
    def ended(self) -> bool:
        return self._ended.is_set()

    def raise_if_cancelled(self) -> None:
        if self._ended.is_set():
            raise Cancelled()


def _say(*words: Any) -> None:
    sys.stdout.write(" ".join(str(w) for w in words) + "\n")
    sys.stdout.flush()


def _note(text: str) -> None:
    """One stage note on stderr, ``mp_faces: <text> (+<s> s)`` since ``_began``.

    Only from the main thread: a daemon thread writing to ``sys.stderr`` at
    the interpreter's shutdown is the same lock abort ``_StdinEnd`` avoids. A
    note that cannot be written is dropped: it never stops a pass.
    """
    try:
        sys.stderr.write(f"{NOTE_PREFIX}{text} (+{time.perf_counter() - _began:.3f} s)\n")
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def _arm_stall_dump() -> None:
    """(Re)start the ``STALL_DUMP_S`` clock: past it with no call here, every thread's stack goes to stderr, once.

    A stderr with no descriptor (a test's captured stream) arms nothing.
    """
    try:
        faulthandler.dump_traceback_later(STALL_DUMP_S, repeat=False, file=sys.stderr)
    except (OSError, ValueError, AttributeError, RuntimeError):
        pass


def run(spec: dict[str, Any], stop: _StdinEnd, environ: dict[str, str] | os._Environ[str]) -> int:
    fake = fake_mode(environ.get(FAKE_ENV))
    if fake is not None:
        _say("ready", f"fake/{fake[0]}", "0.000")
        if spec["mode"] == "import":
            return 0
        detect = _colour_detector(fake[1])
        _note("the stand-in detector made (numpy imported)")
        close: Callable[[], None] = lambda: None
    else:
        try:
            mp, vision, base_options, seconds = _mediapipe()
        except Exception as exc:  # noqa: BLE001 - any import failure is the same answer
            _say("error", "import", f"{type(exc).__name__}: {exc}")
            return EXIT_IMPORT
        _say("ready", getattr(mp, "__version__", "?"), f"{seconds:.3f}")
        if spec["mode"] == "import":
            return 0
        if stop.ended:
            return EXIT_CANCELLED
        # On a machine with no Metal device THIS is where the macOS wheel
        # aborts the process (docs/EFFECTS.md §37); nothing after it runs.
        detect, close = _blaze_face(mp, vision, base_options, spec["model"], spec["minScore"])
        _note("the detector made")

    _arm_stall_dump()
    width, height = analysis_size(spec["edge"], spec["width"], spec["height"])
    expected = expected_frames(spec)
    abort = environ.get(ABORT_ENV) == "1"
    writer = TrackWriter(spec["partial"], spec["track"])
    whole = False
    try:
        frames = media.iter_frames(
            spec["path"], spec["ffmpeg"], spec["fps"], width, height,
            spec["startMs"], spec["endMs"], context=stop,
            started=lambda pid: _note(f"ffmpeg {pid} started, {width}x{height} at {spec['fps']:g} fps"),
        )
        _note("decoding")
        for ms, frame in frames:
            if writer.frames == 0:
                _note("the first frame read")
            writer.add(ms, boxes_of(detect(frame, ms), width, height, spec["minScore"]))
            if abort and writer.frames == 1:
                os.abort()
            if writer.frames % PROGRESS_EVERY == 0:
                fraction = "-" if expected is None else f"{min(0.99, writer.frames / expected):.4f}"
                _say("progress", fraction, writer.frames)
                _arm_stall_dump()
        writer.finish()
        whole = True
        _note(f"{writer.frames} frames, the track in place")
    except Cancelled:
        _note(f"cancelled (stdin ended) after {writer.frames} frames")
        return EXIT_CANCELLED
    except ValueError as exc:  # ffmpeg could not decode the file
        _say("error", "input", str(exc).replace("\n", " "))
        return EXIT_INPUT
    finally:
        faulthandler.cancel_dump_traceback_later()
        writer.close()
        close()
        if not whole:
            # Closed first: Windows will not delete a file that is still open.
            try:
                os.remove(spec["partial"])
            except OSError:
                pass
    _say("done", writer.frames, writer.with_face)
    return 0


def _spec_line(fd: int) -> bytes:
    """The first line of stdin, read from the descriptor a byte at a time.

    Unbuffered on purpose: whatever follows the line stays in the pipe for
    ``_StdinEnd`` to read, and nothing is left inside a Python buffer (the
    line is a few hundred bytes).
    """
    data = bytearray()
    while True:
        byte = os.read(fd, 1)
        if not byte or byte == b"\n":
            return bytes(data)
        data += byte


def _utf8_stdio() -> None:
    """stdout (the conversation) and stderr (the log) in UTF-8, whatever the locale.

    The worker starts with ``-E``, so ``PYTHONIOENCODING`` is ignored and a
    pipe gets the locale's encoding (the ANSI code page on Windows); an
    ``error input`` line naming a file such as ``Bräutigam 5:30pm.mp4`` must
    reach the helper, which decodes every line as UTF-8. stdin is read as
    bytes from its descriptor and decoded here, so it needs nothing.
    """
    for stream, errors in ((sys.stdout, "strict"), (sys.stderr, "backslashreplace")):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors=errors)


def main() -> int:
    _utf8_stdio()
    fd = sys.stdin.fileno()
    try:
        spec = parse_spec(_spec_line(fd).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        _say("error", "input", str(exc))
        return EXIT_INPUT
    _arm_stall_dump()
    try:
        if spec["mode"] == "detect":
            _note("the spec read")
        stop = _StdinEnd(fd)
        return run(spec, stop, os.environ)
    finally:
        faulthandler.cancel_dump_traceback_later()


if __name__ == "__main__":
    raise SystemExit(main())
