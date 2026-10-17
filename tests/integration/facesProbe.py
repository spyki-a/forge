"""The stand-in face pass taken apart, one layer at a time (tests/integration/faces.int.test.ts).

On Windows every stand-in pass through the helper hung before its tenth frame
(CI run 38972858204). Run 38982628323 took it apart with this file: the
stream alone finished in 0.28 s, and every layer with a thread blocked in a
read of stdin stopped for good in ``create_module``, the main thread's first
native import after that read began (numpy's). The helper's read loop
(rpc.py) and the worker's watch (mp_faces.py) now read stdin through
``forge_sidecar.stdio.LineReader``, which on Windows never leaves a read
waiting, and the worker imports everything before it watches. So:

    python -E -s -B facesProbe.py <sidecar folder> <mode> <clip> <ffmpeg> [<scratch folder>]

The layers the test requires to finish:

- ``frames``: ``media.iter_frames`` over the clip at 5 fps, 640x360, and
  nothing else in the process.
- ``held``: the same, with a daemon thread reading this process's stdin
  through ``stdio.LineReader`` (as the worker's watch does), which the test
  holds open, and numpy imported AFTER that thread starts: the shape that
  hung, now through the reader.
- ``helper``: ``faces.run_worker`` (the helper's own start of the worker and
  its relay) from a plain process, the stand-in detector on through the
  environment the test gives it; stdin not read.
- ``helper-held``: the helper's own shape: ``run_worker`` on a request
  thread while the main thread reads stdin's lines through
  ``stdio.LineReader`` (rpc.py's loop), until the test ends stdin after
  ``done``.

And diagnostics, reported but not required, which name what a load waits on
when a read of stdin is left waiting (stdio.py's two candidates). Each starts
its reading thread, gives it 0.3 s to be inside its read, then does its one
thing; each extension module's name is said just before its load (``loading
<name>``), so the last one said is where a hang is:

- ``raw-read``: the old shape, a thread in ``os.read(0)`` (the C runtime's
  ``read()``, which takes the UCRT's lock on descriptor 0 and then calls
  ``ReadFile``), then ``import numpy``. Expected to hang on Windows.
- ``raw-readfile`` (win32): a thread in ``kernel32.ReadFile`` on the same
  handle through ctypes, with no C runtime lock taken, then ``import numpy``.
  If this hangs, the kernel's lock on the synchronous handle is enough; if it
  finishes while ``raw-read`` hangs, the UCRT's lock is what the load waits
  on.
- ``filetype`` (win32): a thread in ``kernel32.ReadFile``, then
  ``GetFileType`` on the same handle, as a C runtime's start-up asks of each
  standard handle: whether that call waits for the read.

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


def in_thread(target: object, what: str) -> None:
    threading.Thread(target=target, daemon=True).start()  # type: ignore[arg-type]
    say(what)


def name_each_native_load() -> None:
    """``loading <module>`` on stdout just before each extension module loads: the last one said is the one a hang is in."""
    import importlib.machinery

    original = importlib.machinery.ExtensionFileLoader.create_module

    def create_module(self, spec):  # type: ignore[no-untyped-def]
        say("loading", spec.name)
        return original(self, spec)

    importlib.machinery.ExtensionFileLoader.create_module = create_module  # type: ignore[method-assign]


def raw_readfile() -> tuple[object, object]:
    """``kernel32.ReadFile`` on stdin's handle through ctypes (imported here, before any thread reads), and the handle."""
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    kernel32.ReadFile.restype = wintypes.BOOL
    handle = msvcrt.get_osfhandle(0)

    def watch() -> None:
        buffer = ctypes.create_string_buffer(4096)
        got = wintypes.DWORD()
        while kernel32.ReadFile(handle, buffer, 4096, ctypes.byref(got), None) and got.value:
            pass

    return watch, handle


faulthandler.dump_traceback_later(8, file=sys.stderr)
from forge_sidecar import media, stdio  # noqa: E402 - after the path, as the worker imports them


def read_lines() -> None:
    for _line in stdio.LineReader(0):
        pass


if MODE == "held":
    in_thread(read_lines, "holding")

if MODE in ("frames", "held"):
    import numpy  # noqa: E402,F401 - after the reading thread starts: the shape that hung

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
        read_lines()
elif MODE in ("raw-read", "raw-readfile", "filetype"):
    if MODE == "raw-read":

        def blocked() -> None:
            try:
                while os.read(0, 4096):
                    pass
            except OSError:
                pass

        in_thread(blocked, "in os.read")
    else:
        watch, handle = raw_readfile()
        in_thread(watch, "in ReadFile")
    time.sleep(0.3)
    if MODE == "filetype":
        import _winapi  # noqa: E402 - built in: no load of its own

        say("asking GetFileType")
        say("filetype", _winapi.GetFileType(handle))
    else:
        name_each_native_load()
        import numpy  # noqa: E402,F401,F811

        say("imported")
else:
    raise SystemExit(f"no such mode: {MODE}")

faulthandler.cancel_dump_traceback_later()
