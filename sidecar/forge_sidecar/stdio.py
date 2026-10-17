"""stdin as lines, read so that no thread ever waits inside a read of it.

The AI helper's read loop (rpc.py) and the face worker's watch
(workers/mp_faces.py ``_StdinEnd``) read stdin through this and nothing else.

**Why.** On Windows, under the pack's CPython 3.14.8 (CI run 38982628323), a
thread blocked in a read of the stdin pipe held up another thread's load of
a native module until a line arrived on stdin:

- the face worker's watch held a read for its whole pass, and its main
  thread's ``import numpy`` (the stand-in detector's) sat in
  ``create_module`` for good, in every stand-in pass and in
  tests/integration/facesProbe.py's bare shape of it (a thread in
  ``os.read(0)``, then ``import numpy``);
- the helper's own loop held one between requests, and beats' first call sat
  in its onset stage (numba's first compile) until the NEXT request's line
  came, then finished;
- the install's self-test, whose groups run in fresh processes that read no
  stdin, passed every group, numpy and numba included.

A read of a pipe there is CPython's ``_Py_read``, which calls the C runtime's
``read()`` with the GIL released (Python/fileutils.c at v3.14.8, :1914-1916),
and ``read()`` is one synchronous ``ReadFile``. So the GIL is not what the
load waits on. What it does wait on is NOT established; two candidates, which
tests/integration/facesProbe.py's diagnostic layers tell apart on the next
Windows run: the kernel's per-file-object lock, which the I/O manager holds
for the whole of a synchronous ``ReadFile`` and which other calls on the same
handle (``GetFileType`` among them, as a C runtime's start-up asks of each
standard handle) wait for; or the UCRT's per-descriptor lock, which
``read()`` holds across the same call.

**What this does.** Either way no read is ever left waiting. On win32, when
stdin is a pipe, ``PeekNamedPipe`` asks how many bytes it holds without
reading, and only that many are read, which returns at once; between asks it
sleeps, ``POLL_FIRST_S`` doubling to ``POLL_MAX_S`` while the pipe stays
empty, back to the first after any bytes. ``_winapi`` and ``msvcrt`` are built
into python3x.dll (CPython's PC/config.c), so the polling loads no native file
of its own. The pipe's end is ``PIPE_ENDED``. Anywhere else (POSIX, or a
Windows stdin that is a console or a file, as when the helper is run by hand)
the read is the plain blocking one: nothing has shown it to block anything
there.

**What it costs.** An idle helper on Windows asks 50 times a second. A request
that comes after a pause waits at most ``POLL_MAX_S`` (20 ms) before it is
read; one sent right after the reply to the last is read within a few ms,
since the wait starts again at ``POLL_FIRST_S``.

Bytes in, lines out, undecoded: each caller decodes its own (UTF-8), so the
locale's encoding of ``sys.stdin`` is never in the way. ``sys.stdin``'s own
buffer is never used: a daemon thread blocked inside its BufferedReader holds
the reader's lock, and the interpreter's shutdown then aborts the process
(mp_faces.py ``_StdinEnd``).
"""

from __future__ import annotations

import os
import sys
import time
from typing import Callable, Iterator

CHUNK = 64 * 1024
"""The most one read asks for."""

POLL_FIRST_S = 0.001
"""win32, a pipe: the first wait after an empty ask; it doubles while the pipe stays empty."""

POLL_MAX_S = 0.02
"""win32, a pipe: the longest wait between two asks, and so the most a request waits to be read."""

PIPE_ENDED = (109, 232, 233)
"""``PeekNamedPipe``'s errors that mean the other end has gone: ERROR_BROKEN_PIPE
(the writer closed it), ERROR_NO_DATA (the pipe is being closed) and
ERROR_PIPE_NOT_CONNECTED (a named pipe's server disconnected). Bytes written
before the close are still read first: tests/sidecar/test_stdio.py and
test_rpc.py write, close, then read a real ``os.pipe``, which on Windows is
this branch."""

Peek = Callable[[], "int | None"]
"""How many bytes the pipe holds now, without reading any; None once it has ended."""


def pipe_peek(fd: int) -> Peek | None:
    """``fd``'s ``Peek`` when reads of it must be polled — win32, and ``fd`` a pipe — else None (read it plainly).

    The handle's type is asked once, here, before anything reads it.
    """
    if sys.platform != "win32":
        return None
    import _winapi
    import msvcrt

    handle = msvcrt.get_osfhandle(fd)
    if _winapi.GetFileType(handle) != _winapi.FILE_TYPE_PIPE:
        return None

    def peek() -> int | None:
        try:
            available, _left = _winapi.PeekNamedPipe(handle, 0)
        except OSError as exc:
            if getattr(exc, "winerror", None) in PIPE_ENDED:
                return None
            raise
        return int(available)

    return peek


_ASK = object()
"""``LineReader``'s default ``peek``: ask ``pipe_peek``."""


class LineReader:
    """Lines read from a descriptor, each without its ``\\n``; None at the end.

    A last line with no ``\\n`` comes out at the end as a line, as a file's
    iteration gives it. ``peek`` is ``pipe_peek(fd)``'s unless given; with
    one, a read is made only for bytes the pipe already holds (``_more``).
    ``read`` and ``sleep`` are ``os.read`` and ``time.sleep``, given only by
    tests.
    """

    def __init__(
        self,
        fd: int,
        peek: "Peek | None | object" = _ASK,
        *,
        read: Callable[[int, int], bytes] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self.fd = fd
        self.peek: Peek | None = pipe_peek(fd) if peek is _ASK else peek  # type: ignore[assignment]
        self._read = read or os.read
        self._sleep = sleep or time.sleep
        self._buffer = bytearray()
        self._scanned = 0
        self._ended = False

    @property
    def polled(self) -> bool:
        """Whether reads wait for bytes by asking (win32, a pipe) rather than inside a read."""
        return self.peek is not None

    def _more(self) -> bytes:
        """The next bytes, b"" at the end. Polled: never a read the pipe cannot answer at once."""
        if self.peek is None:
            return self._read(self.fd, CHUNK)
        wait = POLL_FIRST_S
        while True:
            available = self.peek()
            if available is None:
                return self._last_read()
            if available > 0:
                return self._read(self.fd, min(available, CHUNK))
            self._sleep(wait)
            wait = min(wait * 2, POLL_MAX_S)

    def _last_read(self) -> bytes:
        """Polled, once the pipe has ended: whatever is still in it, or b"".

        One read, which cannot wait: nothing can arrive in an ended pipe, so
        it answers at once with what is left or with the end. Then no byte
        written before the close is lost even if ``PeekNamedPipe`` said the
        pipe had ended while bytes were still in it (not what is expected of
        it, and not measured: the face worker's spec in the self-test, and a
        cancel written just before the helper's stdin closes, would be them).
        A read refused outright is the end too.
        """
        try:
            return self._read(self.fd, CHUNK)
        except OSError:
            return b""

    def readline(self) -> bytes | None:
        """The next line without its ``\\n``, or None once the descriptor has ended and every line is out."""
        while True:
            end = self._buffer.find(b"\n", self._scanned)
            if end >= 0:
                line = bytes(self._buffer[:end])
                del self._buffer[: end + 1]
                self._scanned = 0
                return line
            self._scanned = len(self._buffer)
            if self._ended:
                break
            data = self._more()
            if data:
                self._buffer += data
            else:
                self._ended = True
        if self._buffer:
            line = bytes(self._buffer)
            self._buffer.clear()
            self._scanned = 0
            return line
        return None

    def __iter__(self) -> Iterator[bytes]:
        while True:
            line = self.readline()
            if line is None:
                return
            yield line
