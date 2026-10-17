"""Entry point: python -m forge_sidecar"""

from __future__ import annotations

import io
import sys

from .capabilities import register_all
from .rpc import Server


def utf8_stdio() -> None:
    """The protocol is UTF-8 on every rung (docs/CLIPS.md §3a.2, §3a.8 row 38).

    The pack starts with ``-E``, which ignores ``PYTHONIOENCODING``; without
    it Python gives a pipe the locale's encoding. Measured on the Mac
    (2026-10-14, the venv's 3.14.6, ``-E -s -u -B``): under
    ``LC_ALL=en_IE.ISO8859-1`` stdin and stdout were ``iso8859-1``, a request
    carrying ``Bräutigam 5:30pm ಕನ್ನಡ.mp4`` was read as mojibake
    (``Br\\xc3\\xa4utigam…``), and a reply holding it failed with "'latin-1'
    codec can't encode characters". (Under ``LC_ALL=C`` Python turns on UTF-8
    mode by itself, so the C locale cannot show it.) Windows gives a pipe the
    ANSI code page, cp1252 on most machines: the same fault.

    So the streams are set here, before anything reads or writes them, as
    ``PYTHONIOENCODING=utf-8`` set them: stdin and stdout strict, stderr (the
    log) with ``backslashreplace``. Not ``-X utf8``: that also changes every
    ``open()``'s default and gives stdin and stdout ``surrogateescape``, and it
    would be one more flag on one rung rather than the same code on all.

    The requests themselves no longer pass through ``sys.stdin``: the read
    loop reads stdin's descriptor and decodes each line as UTF-8 itself
    (rpc.py ``_read_loop``, stdio.py). stdin is still set here, for anything
    else that reads it.
    """
    for stream, errors in ((sys.stdin, "strict"), (sys.stdout, "strict"), (sys.stderr, "backslashreplace")):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors=errors)


def main() -> int:
    utf8_stdio()
    # Anything a library prints to stdout would corrupt the JSON-RPC stream, so
    # stdout is reserved for protocol traffic and everything else goes to stderr.
    sys.stdout.reconfigure(line_buffering=True)

    server = Server()
    register_all(server)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
