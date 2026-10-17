"""stdin as lines, never with a read left waiting on Windows (sidecar/forge_sidecar/stdio.py).

On Windows CI (run 38982628323) a thread blocked in a read of the stdin pipe
held up another thread's load of a native module until a line came: the face
worker's ``import numpy`` never finished, and beats' first call waited for
the next request. ``stdio.LineReader`` reads lines; on win32, for a pipe, it
asks ``PeekNamedPipe`` how many bytes are there and reads only those.

Three layers here, on any platform:

- a real ``os.pipe`` through the reader as this platform chooses it (the
  plain blocking read on POSIX; on Windows the polled one, with the real
  ``PeekNamedPipe``): partial lines, several lines in one read, a line split
  across reads, the end with and without a last newline;
- the choice itself, with ``sys.platform`` set to win32 and ``_winapi`` and
  ``msvcrt`` stood in: a pipe is polled, a console or a file is not;
- the polled branch driven by a scripted pipe: no read is ever asked for more
  than the pipe holds or of an empty pipe, the waits double from
  POLL_FIRST_S to POLL_MAX_S and start again after bytes, and the pipe's end
  (ERROR_BROKEN_PIPE) is the end only once its bytes are read.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import types
import unittest
from unittest import mock

from forge_sidecar import stdio


def windows_error(code: int) -> OSError:
    """An OSError carrying ``winerror`` on any platform, as ``_winapi`` raises one on Windows.

    A subclass's class attribute, since only Windows' OSError takes a
    winerror in its constructor.
    """
    return type("WindowsError", (OSError,), {"winerror": code})(0, f"Windows error {code}")


class RealPipe(unittest.TestCase):
    """An ``os.pipe`` through ``LineReader`` as this platform reads it."""

    def setUp(self) -> None:
        self.r, self.w = os.pipe()
        self.open = {self.r, self.w}
        self.addCleanup(self._close_all)

    def close(self, fd: int) -> None:
        """Each end closed once, so a cleanup never closes a number the process has since reused."""
        if fd in self.open:
            self.open.discard(fd)
            os.close(fd)

    def _close_all(self) -> None:
        for fd in list(self.open):
            self.close(fd)

    def write_later(self, *pieces: bytes, gap: float = 0.05) -> threading.Thread:
        """The pieces written ``gap`` apart from another thread, as a writer's do, then the write end closed."""

        def run() -> None:
            for piece in pieces:
                time.sleep(gap)
                os.write(self.w, piece)
            self.close(self.w)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        return thread

    def test_this_platform_polls_a_pipe_only_on_windows(self) -> None:
        self.assertEqual(stdio.LineReader(self.r).polled, sys.platform == "win32")

    def test_several_lines_in_one_write_come_out_one_by_one(self) -> None:
        os.write(self.w, b'{"id":1}\n{"id":2}\n\n{"id":3}\n')
        self.close(self.w)
        reader = stdio.LineReader(self.r)
        self.assertEqual(list(reader), [b'{"id":1}', b'{"id":2}', b"", b'{"id":3}'])
        self.assertIsNone(reader.readline())

    def test_a_line_written_in_pieces_comes_out_whole(self) -> None:
        self.write_later(b'{"method":', b'"system.hello",', b'"id":7}\n{"id":', b"8}\n")
        reader = stdio.LineReader(self.r)
        self.assertEqual(reader.readline(), b'{"method":"system.hello","id":7}')
        self.assertEqual(reader.readline(), b'{"id":8}')
        self.assertIsNone(reader.readline())

    def test_a_line_split_across_reads_comes_out_whole(self) -> None:
        # Every read gives at most 3 bytes, so each line spans several reads and a read spans two lines.
        os.write(self.w, b"first line\nsecond\n")
        self.close(self.w)
        reads: list[int] = []

        def small(fd: int, n: int) -> bytes:
            data = os.read(fd, min(n, 3))
            reads.append(len(data))
            return data

        reader = stdio.LineReader(self.r, read=small)
        self.assertEqual(list(reader), [b"first line", b"second"])
        self.assertGreater(len(reads), 6, reads)

    def test_the_end_gives_the_last_line_without_a_newline_then_none(self) -> None:
        self.write_later("Bräutigam 5:30pm".encode("utf-8"))
        reader = stdio.LineReader(self.r)
        self.assertEqual(reader.readline(), "Bräutigam 5:30pm".encode("utf-8"))
        self.assertIsNone(reader.readline())
        self.assertIsNone(reader.readline(), "asked again after the end")

    def test_bytes_written_before_the_close_are_read_before_the_end(self) -> None:
        os.write(self.w, b"one\ntwo")
        self.close(self.w)
        self.assertEqual(list(stdio.LineReader(self.r)), [b"one", b"two"])

    def test_an_empty_pipe_that_ends_is_none(self) -> None:
        self.close(self.w)
        self.assertIsNone(stdio.LineReader(self.r).readline())


class FakeWindows:
    """``_winapi`` and ``msvcrt`` stood in, each call recorded; ``kind`` is what GetFileType says."""

    FILE_TYPE_DISK, FILE_TYPE_CHAR, FILE_TYPE_PIPE = 1, 2, 3

    def __init__(self, kind: int, peeks: list[object]) -> None:
        self.kind = kind
        self.peeks = list(peeks)
        self.calls: list[tuple[str, object]] = []
        self.winapi = types.SimpleNamespace(
            FILE_TYPE_DISK=self.FILE_TYPE_DISK, FILE_TYPE_CHAR=self.FILE_TYPE_CHAR, FILE_TYPE_PIPE=self.FILE_TYPE_PIPE,
            GetFileType=self.get_file_type, PeekNamedPipe=self.peek_named_pipe,
        )
        self.msvcrt = types.SimpleNamespace(get_osfhandle=self.get_osfhandle)

    def get_osfhandle(self, fd: int) -> int:
        self.calls.append(("get_osfhandle", fd))
        return 4000 + fd

    def get_file_type(self, handle: int) -> int:
        self.calls.append(("GetFileType", handle))
        return self.kind

    def peek_named_pipe(self, handle: int, size: int = 0) -> tuple[int, int]:
        self.calls.append(("PeekNamedPipe", handle))
        assert size == 0, "the reader peeks for a count, never for bytes"
        step = self.peeks.pop(0)
        if isinstance(step, BaseException):
            raise step
        return int(step), 0  # type: ignore[call-overload]

    def installed(self) -> "mock._patch[dict]":
        return mock.patch.dict(sys.modules, {"_winapi": self.winapi, "msvcrt": self.msvcrt})


class TheChoice(unittest.TestCase):
    """``pipe_peek``: polled on win32 for a pipe, plainly read for anything else."""

    def test_on_win32_a_pipe_is_polled_through_peeknamedpipe_on_its_own_handle(self) -> None:
        windows = FakeWindows(FakeWindows.FILE_TYPE_PIPE, [5, windows_error(109)])
        with windows.installed(), mock.patch.object(sys, "platform", "win32"):
            reader = stdio.LineReader(7)
            self.assertTrue(reader.polled)
            self.assertEqual(reader.peek(), 5)
            self.assertIsNone(reader.peek(), "ERROR_BROKEN_PIPE is the end")
        self.assertEqual(
            windows.calls,
            [("get_osfhandle", 7), ("GetFileType", 4007), ("PeekNamedPipe", 4007), ("PeekNamedPipe", 4007)],
        )

    def test_on_win32_each_ended_pipe_error_is_the_end_and_any_other_is_raised(self) -> None:
        for code in stdio.PIPE_ENDED:
            windows = FakeWindows(FakeWindows.FILE_TYPE_PIPE, [windows_error(code)])
            with windows.installed(), mock.patch.object(sys, "platform", "win32"):
                self.assertIsNone(stdio.LineReader(0).peek(), code)
        windows = FakeWindows(FakeWindows.FILE_TYPE_PIPE, [windows_error(5)])  # ERROR_ACCESS_DENIED
        with windows.installed(), mock.patch.object(sys, "platform", "win32"), self.assertRaises(OSError):
            stdio.LineReader(0).peek()

    def test_on_win32_a_console_or_a_file_is_read_plainly(self) -> None:
        for kind in (FakeWindows.FILE_TYPE_CHAR, FakeWindows.FILE_TYPE_DISK):
            windows = FakeWindows(kind, [])
            with windows.installed(), mock.patch.object(sys, "platform", "win32"):
                self.assertFalse(stdio.LineReader(0).polled, kind)
            self.assertNotIn("PeekNamedPipe", [name for name, _ in windows.calls])

    def test_off_win32_nothing_windows_is_asked(self) -> None:
        windows = FakeWindows(FakeWindows.FILE_TYPE_PIPE, [])
        with windows.installed(), mock.patch.object(sys, "platform", "darwin"):
            self.assertFalse(stdio.LineReader(0).polled)
        self.assertEqual(windows.calls, [])


class ScriptedPipe:
    """A pipe whose writer acts on the reader's waits: ``script[i]`` is what it does at the i-th wait.

    Each step is bytes to write, ``"close"``, or None (nothing yet). ``read``
    fails the test on any read the OPEN pipe could not answer at once — of an
    empty pipe, or for more than it holds — which on Windows is a read left
    waiting. A closed pipe answers any read at once: what is left, or b"".
    """

    def __init__(self, script: list[object], first: bytes = b"") -> None:
        self.script = list(script)
        self.held = bytearray(first)
        self.closed = False
        self.waits: list[float] = []
        self.reads: list[int] = []

    def peek(self) -> int | None:
        if self.held:
            return len(self.held)
        return None if self.closed else 0

    def read(self, fd: int, n: int) -> bytes:
        if not self.closed and not 0 < n <= len(self.held):
            raise AssertionError(f"a read of {n} bytes from an open pipe holding {len(self.held)} would wait")
        self.reads.append(n)
        data = bytes(self.held[:n])
        del self.held[:n]
        return data

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        if not self.script:
            raise AssertionError("the reader waited past the script's end")
        step = self.script.pop(0)
        if step == "close":
            self.closed = True
        elif isinstance(step, bytes):
            self.held += step


class Polled(unittest.TestCase):
    """The polled branch: the waits, the reads, the lines and the end."""

    def reader(self, pipe: ScriptedPipe) -> stdio.LineReader:
        return stdio.LineReader(0, pipe.peek, read=pipe.read, sleep=pipe.sleep)

    def test_nothing_is_read_until_the_pipe_holds_bytes_and_then_only_those(self) -> None:
        pipe = ScriptedPipe([None, None, None, b'{"id":', None, b'1}\n{"id":2}\n', "close"])
        reader = self.reader(pipe)
        self.assertEqual(reader.readline(), b'{"id":1}')
        self.assertEqual(reader.readline(), b'{"id":2}')
        self.assertIsNone(reader.readline())
        self.assertEqual(pipe.reads, [6, 12, stdio.CHUNK], "then one last read of the ended pipe")

    def test_the_waits_double_to_the_cap_and_start_again_after_bytes(self) -> None:
        pipe = ScriptedPipe([None] * 7 + [b"a\n"] + [None, b"b\n", "close"])
        reader = self.reader(pipe)
        self.assertEqual(reader.readline(), b"a")
        first = stdio.POLL_FIRST_S
        expected = [min(first * 2 ** i, stdio.POLL_MAX_S) for i in range(8)]
        self.assertEqual(pipe.waits, expected)
        self.assertEqual(pipe.waits[-1], stdio.POLL_MAX_S, "the cap is reached")
        self.assertEqual(reader.readline(), b"b")
        self.assertEqual(pipe.waits[8:], [first, first * 2], "after bytes the wait starts again at the first")

    def test_bytes_already_there_are_read_without_a_wait(self) -> None:
        pipe = ScriptedPipe(["close"], first=b"spec\nrest")
        reader = self.reader(pipe)
        self.assertEqual(reader.readline(), b"spec")
        self.assertEqual(pipe.waits, [])
        self.assertEqual(reader.readline(), b"rest")
        self.assertIsNone(reader.readline())

    def test_a_pipe_closed_with_bytes_in_it_gives_them_before_the_end(self) -> None:
        pipe = ScriptedPipe([], first=b"last\nno newline")
        pipe.closed = True
        self.assertEqual(list(self.reader(pipe)), [b"last", b"no newline"])
        self.assertEqual(pipe.waits, [])

    def test_an_end_said_while_bytes_are_still_in_the_pipe_loses_none_of_them(self) -> None:
        # Not what PeekNamedPipe is expected to do, and unmeasured: one last read at the end takes what is left.
        class EndsEarly(ScriptedPipe):
            def peek(self) -> int | None:
                return None if self.closed else len(self.held)

        pipe = EndsEarly([], first=b'{"mode": "import"}\nlast')
        pipe.closed = True
        self.assertEqual(list(self.reader(pipe)), [b'{"mode": "import"}', b"last"])
        self.assertEqual(pipe.reads, [stdio.CHUNK, stdio.CHUNK], "one read took what was left, one more found the end")

    def test_a_read_refused_at_the_end_is_the_end(self) -> None:
        pipe = ScriptedPipe([], first=b"")
        pipe.closed = True

        def refused(_fd: int, _n: int) -> bytes:
            raise OSError(22, "Invalid argument")

        self.assertIsNone(stdio.LineReader(0, pipe.peek, read=refused, sleep=pipe.sleep).readline())

    def test_a_partial_line_then_its_end_and_two_more_in_one_read_are_three_lines(self) -> None:
        # The search for the next newline starts where the last one stopped, and again from 0 after each line.
        pipe = ScriptedPipe([b" end\none\ntwo\n", "close"], first=b"partial")
        self.assertEqual(list(self.reader(pipe)), [b"partial end", b"one", b"two"])
        self.assertEqual(pipe.reads, [7, 13, stdio.CHUNK])

    def test_a_read_is_never_bigger_than_a_chunk(self) -> None:
        pipe = ScriptedPipe(["close"], first=b"x" * (stdio.CHUNK + 10) + b"\n")
        line = self.reader(pipe).readline()
        self.assertEqual(len(line or b""), stdio.CHUNK + 10)
        self.assertEqual(pipe.reads, [stdio.CHUNK, 11])


if __name__ == "__main__":
    unittest.main()
