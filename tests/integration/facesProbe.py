"""The stand-in face pass taken apart, one layer at a time (tests/integration/faces.int.test.ts).

On Windows every stand-in pass through the helper hung before its tenth frame
(CI run 38972858204), while ``media.iter_frames`` itself streams there in
``npm test`` (tests/sidecar/test_media.py, on the bare interpreter). So the
layers between the two are run here alone, each in its own process, and the
test records how far each got:

    python -E -s -B facesProbe.py <sidecar folder> <mode> <clip> <ffmpeg> [<scratch folder>]

- ``frames``: ``media.iter_frames`` over the clip at 5 fps, 640x360, and
  nothing else in the process.
- ``held``: the same, with a daemon thread blocked in ``os.read`` on this
  process's stdin, which the test holds open, as the face worker's
  ``_StdinEnd`` is through its whole pass; ``media`` imported before the
  thread starts and numpy after, in the worker's order.
- ``helper``: ``faces.run_worker`` (the helper's own start of the worker and
  its relay) from a plain process, the stand-in detector on through the
  environment the test gives it; stdin not read.
- ``helper-held``: the helper's own shape: ``run_worker`` on a request
  thread while the main thread is blocked in ``for line in sys.stdin`` (the
  helper's read loop, rpc.py), until the test ends stdin after ``done``.

Each stdout line is ``<what> <seconds since the start>``, flushed; past 8 s
``faulthandler`` writes every thread's stack to stderr, and the helper modes
also get faces.py's own log there.
"""

from __future__ import annotations

import faulthandler
import os
import sys
import threading
import time

SIDECAR, MODE, CLIP, FFMPEG = sys.argv[1:5]
sys.path.insert(0, SIDECAR)
BEGAN = time.perf_counter()


def say(*words: object) -> None:
    sys.stdout.write(" ".join(str(w) for w in words) + f" {time.perf_counter() - BEGAN:.3f}\n")
    sys.stdout.flush()


def hold_stdin() -> None:
    def watch() -> None:
        try:
            while os.read(0, 4096):
                pass
        except OSError:
            pass

    threading.Thread(target=watch, daemon=True).start()
    say("holding")


faulthandler.dump_traceback_later(8, file=sys.stderr)
from forge_sidecar import media  # noqa: E402 - after the path, as the worker imports it

if MODE == "held":
    hold_stdin()

if MODE in ("frames", "held"):
    import numpy  # noqa: E402,F401 - the stand-in detector imports it after its watcher starts

    say("imported")
    count = 0
    for _ms, _frame in media.iter_frames(CLIP, FFMPEG, 5.0, 640, 360, started=lambda pid: say("ffmpeg", pid)):
        count += 1
        if count == 1:
            say("first")
    say("frames", count)
elif MODE in ("helper", "helper-held"):
    from forge_sidecar.capabilities import faces  # noqa: E402

    folder = sys.argv[5]
    track = os.path.join(folder, f"{MODE}.json")
    spec = {
        "mode": "detect", "path": CLIP, "ffmpeg": FFMPEG, "width": 640, "height": 360, "fps": 5.0, "edge": 640,
        "minScore": 0.5, "startMs": 0.0, "endMs": None, "durationMs": 4000.0, "model": "unused by the stand-in",
        "track": track, "partial": f"{track}.part",
    }

    class Context:
        request_id = 1

        def progress(self, value: float | None, message: str | None = None) -> None:
            say("progress", value)

        def raise_if_cancelled(self) -> None:
            pass

    def request() -> None:
        try:
            faces.run_worker(spec, Context())
            say("done", os.path.getsize(track))
        except BaseException as exc:  # noqa: BLE001 - said, for the test to read
            say("failed", repr(exc).replace("\n", " "))

    if MODE == "helper":
        request()
    else:
        threading.Thread(target=request, daemon=True).start()
        say("reading stdin")
        for _line in sys.stdin:
            pass
else:
    raise SystemExit(f"no such mode: {MODE}")

faulthandler.cancel_dump_traceback_later()
