"""The helper's read loop (sidecar/forge_sidecar/rpc.py ``Server._read_loop``).

It reads stdin's DESCRIPTOR through ``stdio.LineReader``, never ``sys.stdin``:
on Windows a read of stdin left waiting held up another thread's load of a
native module until the next line came (CI run 38982628323: beats' first
call waited for the next request), and the reader never leaves one waiting
there (tests/sidecar/test_stdio.py). Here ``sys.stdin`` is a stand-in that
fails the test if it is read as a stream, and its descriptor is a real
``os.pipe`` — on Windows the reader's polled branch, with the real
``PeekNamedPipe``.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
import unittest
from typing import Any
from unittest import mock

from forge_sidecar.rpc import PARSE_ERROR, Server


class FdOnly:
    """``sys.stdin`` as the read loop may use it: its descriptor. Read as a stream, it fails the test."""

    def __init__(self, fd: int) -> None:
        self.fd = fd

    def fileno(self) -> int:
        return self.fd

    def _streamed(self, *_args: object) -> Any:
        raise AssertionError("the read loop read sys.stdin as a stream, not its descriptor through stdio.LineReader")

    __iter__ = __next__ = read = readline = readlines = _streamed

    @property
    def buffer(self) -> Any:
        return self._streamed()


def echo_server() -> Server:
    server = Server()
    server.register("t.echo", lambda params, _context: params)
    return server


def replies(text: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class ReadLoop(unittest.TestCase):
    def setUp(self) -> None:
        self.r, self.w = os.pipe()
        self.open = {self.r, self.w}
        self.addCleanup(self._close_all)

    def close(self, fd: int) -> None:
        if fd in self.open:
            self.open.discard(fd)
            os.close(fd)

    def _close_all(self) -> None:
        for fd in list(self.open):
            self.close(fd)

    def serve(self, server: Server) -> str:
        out = io.StringIO()
        with mock.patch.object(sys, "stdin", FdOnly(self.r)), mock.patch.object(sys, "stdout", out):
            server.serve_forever(drain_timeout=10)
        return out.getvalue()

    def test_two_requests_in_one_write_are_both_answered(self) -> None:
        name = "Bräutigam 5:30pm ಕನ್ನಡ.mp4"
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "t.echo", "params": {"echo": name}},
            {"jsonrpc": "2.0", "id": 2, "method": "t.echo", "params": {"echo": 2}},
        ]
        os.write(self.w, "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in requests).encode("utf-8"))
        self.close(self.w)
        answered = {m["id"]: m["result"] for m in replies(self.serve(echo_server()))}
        self.assertEqual(answered, {1: {"echo": name}, 2: {"echo": 2}})

    def test_each_request_is_answered_while_stdin_is_still_open(self) -> None:
        # The client's own shape: the second request goes only once the first is answered, in two pieces.
        out = io.StringIO()
        sent: list[str] = []

        def client() -> None:
            os.write(self.w, b'{"jsonrpc":"2.0","id":1,"method":"t.echo","params":{"n":1}}\n')
            sent.append("first")
            end = time.monotonic() + 10
            while '"id":1' not in out.getvalue() and time.monotonic() < end:
                time.sleep(0.005)
            sent.append("answered" if '"id":1' in out.getvalue() else "not answered")
            os.write(self.w, b'{"jsonrpc":"2.0","id":2,')
            time.sleep(0.05)
            os.write(self.w, b'"method":"t.echo","params":{"n":2}}\n')
            self.close(self.w)

        thread = threading.Thread(target=client, daemon=True)
        with mock.patch.object(sys, "stdin", FdOnly(self.r)), mock.patch.object(sys, "stdout", out):
            thread.start()
            echo_server().serve_forever(drain_timeout=10)
        thread.join(5)
        self.assertEqual(sent, ["first", "answered"], "the first request was not answered before stdin ended")
        self.assertEqual({m["id"]: m["result"] for m in replies(out.getvalue())}, {1: {"n": 1}, 2: {"n": 2}})

    def test_a_line_that_is_not_utf8_is_a_parse_error_and_the_loop_goes_on(self) -> None:
        os.write(self.w, b'{"jsonrpc":"2.0","id":1,"method":"t.echo","params":{"x":"\xff\xfe"}}\n')
        os.write(self.w, b'{"jsonrpc":"2.0","id":2,"method":"t.echo","params":{"x":"ok"}}\n')
        self.close(self.w)
        said = replies(self.serve(echo_server()))
        self.assertEqual(said[0], {"jsonrpc": "2.0", "id": None, "error": {"code": PARSE_ERROR, "message": "Parse error"}})
        self.assertEqual(said[1], {"jsonrpc": "2.0", "id": 2, "result": {"x": "ok"}})


if __name__ == "__main__":
    unittest.main()
