"""The AI helper's self-test: each native library loaded in a fresh process.

docs/CLIPS.md §3a.3 stage 4 and §16.45. The install job asks the freshly
installed pack ``system.selftest`` (capabilities/system.py), and the answer
becomes the receipt's ``selftest`` record and the greyed methods
(src/shared/sidecar/selftest.ts, which names the same six groups).

**Why a process per group, not one import list in the helper.** A native
library that is missing a runtime fails only when it is LOADED, and in one
process whatever loaded first serves the rest. scikit-learn's Windows wheel
preloads its own ``msvcp140.dll`` on ``import sklearn``, after which soxr's and
numba's imports of ``MSVCP140`` resolve to that copy and pass, on a machine
where a fresh helper would fail. And ``hello`` cannot see it either: beats'
registration imports librosa, which loads neither soxr nor numba. So each
group is ``sys.executable -E -s -B -c <source>`` in a FRESH child, one after
another, doing the smallest real call that loads its native code:

- ``asr``: ctranslate2, av, faster_whisper, tokenizers;
- ``beats``: librosa, soxr, numba, numba's ``_typeconv``, then ``librosa.stft``
  on one second of silence at 22,050 Hz;
- ``onnx``: onnxruntime, and a session on ``selftest/identity.onnx`` (80 B, one
  Identity node) run once on a 1×1 float, which is what loads
  ``onnxruntime.dll`` for certain;
- ``vision``: numpy, scipy.ndimage, scipy.spatial;
- ``sklearn``: sklearn ALONE, so its preload masks nobody;
- ``faces``: the face worker's own import-only run, through its bootstrap
  (``faces.worker_command``), which loads mediapipe's native library with
  ``mediapipe_c_bindings.load_raw_library()`` (workers/mp_faces.py
  ``_mediapipe``): no model and no Metal needed.

A group's source never imports ``forge_sidecar``: the child is bare, and what
it proves is what a fresh process of this interpreter can load.

Each child: ``CREATE_NO_WINDOW`` on Windows (``media._NO_WINDOW``), cwd the
folder ``forge_sidecar`` is in, the helper's environment copied as it is
(``FORGE_*`` kept; ``-E`` ignores every ``PYTHON*``) except that the faces
group never gets the worker's stand-in switch (``FORGE_FACES_WORKER_FAKE``):
a self-test that passed on the stand-in would report a library nobody loaded.
Each has ``GROUP_TIMEOUT_S``; a child past it is killed and reported as exit
-1, "timed out after 60 s", never waited on. A cancel is seen every
``POLL_S`` while a child runs, and kills it.

The answer per group is ``{exit, ms, error}``: the child's exit code (0
passed; negative for a signal on POSIX), its wall time, and ``error`` — the
faces worker's ``error import …`` line when it printed one, else the child's
last stderr line that says why (``faces.last_words``: a C++ ``Check failed``
line over the stack frames after it) — or None when it passed.

Imports only the standard library and the helper's own stdlib-only modules,
so it runs (and is tested, tests/sidecar/test_selftest.py) on a bare
interpreter, where every group simply reads failed.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from typing import Any, Mapping, Sequence

from . import media
from .capabilities import faces
from .rpc import Cancelled

GROUP_TIMEOUT_S = 60.0
"""Each group's ceiling. A cold Surface imports ctranslate2's 59 MB DLL
through Defender's first scan; past this the child is killed and the group
reads "timed out"."""

POLL_S = 0.1
"""How often a running child is checked for a cancel and the timeout."""

GROUP_FLAGS = ("-E", "-s", "-B")
"""As the face worker starts (faces.WORKER_FLAGS): ``-E`` no ``PYTHON*`` and,
on Windows, no registry ``PythonPath``; ``-s`` no user site; ``-B`` no
``__pycache__`` written into the app's own folder."""

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "selftest", "identity.onnx")
"""The onnx group's model: 80 bytes, input ``x`` → Identity → output ``y``,
float 1×1, IR 7, opset 13. Shipped beside this module (a folder with no
``__init__.py``, so ``forge_sidecar.selftest`` stays this file)."""

FACES_SPEC = b'{"mode": "import"}\n'
"""The face worker's import-only spec (workers/mp_faces.py ``parse_spec``)."""

SOURCES: dict[str, str] = {
    "asr": "import ctranslate2, av, faster_whisper, tokenizers\n",
    "beats": (
        "import numpy, librosa, soxr, numba, numba.core.typeconv._typeconv\n"
        "librosa.stft(numpy.zeros(22050, dtype=numpy.float32))\n"
    ),
    "onnx": (
        "import numpy, onnxruntime\n"
        f"session = onnxruntime.InferenceSession({MODEL!r}, providers=['CPUExecutionProvider'])\n"
        "x = numpy.full((1, 1), 0.5, dtype=numpy.float32)\n"
        "if not (session.run(None, {'x': x})[0] == x).all():\n"
        "    raise SystemExit('the Identity model did not give its input back')\n"
    ),
    "vision": "import numpy, scipy.ndimage, scipy.spatial\n",
    "sklearn": "import sklearn\n",
}
"""Each plain group's ``-c`` source. The faces group runs the worker instead."""

GROUPS: tuple[str, ...] = ("asr", "beats", "onnx", "vision", "sklearn", "faces")
"""Every group, in the order they run: src/shared/sidecar/selftest.ts
``SELFTEST_GROUPS``' keys (tests/integration/sidecar.int.test.ts holds the two
equal through the real helper)."""


def interpreter() -> list[str]:
    """This interpreter, as the argv prefix every group starts with."""
    return [sys.executable or "python"]


def group_command(
    group: str,
    python: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """How one group's child starts: ``argv``, ``cwd``, ``env`` and ``stdin`` (bytes, or None).

    ``python`` is the argv prefix (this interpreter by default; a test passes
    a stand-in), ``environ`` the environment to copy (``os.environ``).
    """
    prefix = list(python) if python is not None else interpreter()
    base = os.environ if environ is None else environ
    if group == "faces":
        command = faces.worker_command(base)
        env = {key: value for key, value in command["env"].items() if key != faces.FAKE_ENV}
        return {"argv": [*prefix, *command["argv"][1:]], "cwd": command["cwd"], "env": env, "stdin": FACES_SPEC}
    if group not in SOURCES:
        raise ValueError(f"unknown self-test group: {group!r}")
    return {
        "argv": [*prefix, *GROUP_FLAGS, "-c", SOURCES[group]],
        "cwd": faces.PACKAGE_PARENT,
        "env": dict(base),
        "stdin": None,
    }


def _read(handle: Any) -> str:
    try:
        handle.seek(0)
        return handle.read().decode("utf-8", "replace")
    except (OSError, ValueError):
        return ""


def error_line(group: str, stdout: str, stderr: str) -> str | None:
    """Why a group failed, in one line: the worker's ``error …`` line, else stderr's last words."""
    if group == "faces":
        said = [line.strip() for line in stdout.splitlines() if line.startswith("error ")]
        if said:
            return said[-1][:300]
    return faces.last_words(stderr) or None


def _kill(process: subprocess.Popen) -> None:
    try:
        process.kill()
    except OSError:
        pass
    process.wait()


def run_group(
    group: str,
    *,
    python: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
    timeout: float = GROUP_TIMEOUT_S,
    context: Any = None,
) -> dict[str, Any]:
    """One group in its own child: ``{exit, ms, error}``. Raises ``Cancelled`` (the child killed) on a cancel."""
    command = group_command(group, python, environ)
    started = time.perf_counter()

    def elapsed() -> int:
        return int(round((time.perf_counter() - started) * 1000))

    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            process = subprocess.Popen(
                command["argv"], cwd=command["cwd"], env=command["env"],
                stdin=subprocess.PIPE if command["stdin"] is not None else subprocess.DEVNULL,
                stdout=out, stderr=err,
                **media._NO_WINDOW,
            )
        except OSError as exc:
            return {"exit": -1, "ms": elapsed(), "error": f"could not start {command['argv'][0]}: {exc}"}
        if command["stdin"] is not None and process.stdin is not None:
            try:
                process.stdin.write(command["stdin"])
                process.stdin.close()
            except OSError:
                pass  # it died before reading: its exit code says why
        deadline = started + timeout
        while True:
            try:
                code = process.wait(timeout=POLL_S)
                break
            except subprocess.TimeoutExpired:
                pass
            if context is not None:
                try:
                    context.raise_if_cancelled()
                except Cancelled:
                    _kill(process)
                    raise
            if time.perf_counter() >= deadline:
                _kill(process)
                return {"exit": -1, "ms": elapsed(), "error": f"timed out after {timeout:g} s"}
        ms = elapsed()
        if code == 0:
            return {"exit": 0, "ms": ms, "error": None}
        return {"exit": code, "ms": ms, "error": error_line(group, _read(out), _read(err))}


def checked_groups(groups: Any) -> list[str]:
    """The groups a request names, in its order and once each; every group when it names none."""
    if groups is None:
        return list(GROUPS)
    if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
        raise ValueError("groups must be a list of self-test group names")
    unknown = [g for g in groups if g not in GROUPS]
    if unknown:
        raise ValueError(f"unknown self-test group: {unknown[0]!r} (the groups are {', '.join(GROUPS)})")
    return list(dict.fromkeys(groups))


def selftest(
    groups: list[str] | None = None,
    *,
    context: Any = None,
    python: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
    timeout: float = GROUP_TIMEOUT_S,
) -> dict[str, dict[str, Any]]:
    """``system.selftest``'s answer: each group run in its own child, one after another.

    With a ``context``, a cancel is checked before each group and while one
    runs, and each group's start is a progress line ("checking beats · 2 of 6");
    the last progress, 1.0 once every group is done, carries no words.
    """
    names = checked_groups(groups)
    result: dict[str, dict[str, Any]] = {}
    for index, group in enumerate(names):
        if context is not None:
            context.raise_if_cancelled()
            context.progress(index / len(names), f"checking {group} · {index + 1} of {len(names)}")
        result[group] = run_group(group, python=python, environ=environ, timeout=timeout, context=context)
    if context is not None:
        context.progress(1.0)
    return result
