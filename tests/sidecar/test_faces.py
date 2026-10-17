"""The face finder's helper half and its worker's pure parts (docs/CLIPS.md §4.3).

sidecar/forge_sidecar/capabilities/faces.py and workers/mp_faces.py. Run by
tests/integration/sidecarMedia.int.test.ts with every other file here, on the
helper's venv or on CI's bare interpreter, so nothing in this file needs
mediapipe or numpy: the boxes, the size, the cache's name, the spec, the model
gate, the registration and the stub rule are plain Python, and the worker's
CONVERSATION — progress relayed, an abort reported, a cancel that stops and
cleans up — is driven with small stand-in workers the test writes, run through
faces.run_worker exactly as the real one is. The real worker, the real ffmpeg
and the real mediapipe are tests/integration/faces.int.test.ts.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import ast
import contextlib
import hashlib
import importlib.machinery
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from unittest import mock

from forge_sidecar import media
from forge_sidecar.capabilities import faces
from forge_sidecar.rpc import Cancelled, Server, Unavailable
from forge_sidecar.workers import mp_faces

FFMPEG = os.environ.get("FORGE_TEST_FFMPEG", "")
FFPROBE = os.environ.get("FORGE_TEST_FFPROBE", "")
OUT = os.environ.get("FORGE_TEST_OUT") or tempfile.mkdtemp(prefix="forge-faces-")
_MADE_OUT = OUT != os.environ.get("FORGE_TEST_OUT")


def tearDownModule() -> None:
    # A folder of our own (run by hand, no FORGE_TEST_OUT) goes; the runner's is its to keep.
    if _MADE_OUT:
        shutil.rmtree(OUT, True)


needs_ffmpeg = unittest.skipUnless(FFMPEG and FFPROBE, "FORGE_TEST_FFMPEG and FORGE_TEST_FFPROBE are not set")


class Context:
    """A request's context: records progress; cancelled when ``cancel`` is set."""

    request_id = 7

    def __init__(self) -> None:
        self.seen: list[tuple[float | None, str | None]] = []
        self.cancel = threading.Event()

    def progress(self, progress: float | None, message: str | None = None) -> None:
        self.seen.append((progress, message))

    def raise_if_cancelled(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


def settings(**overrides: object) -> dict:
    base = {
        "path": __file__, "ffmpeg": "ffmpeg", "ffprobe": "ffprobe",
        "width": 1920, "height": 1080, "key": "1234567:1728912345678.25",
    }
    base.update(overrides)
    return faces.settings(base)


# -------------------------------------------------------------------- boxes


class Boxes(unittest.TestCase):
    """mp_faces.boxes_of: the sample's faces as the track holds them."""

    def test_the_two_largest_are_kept_largest_first(self) -> None:
        detections = [
            (10, 10, 20, 20, 0.95),    # small
            (100, 50, 80, 80, 0.60),   # largest
            (300, 40, 40, 40, 0.90),   # middle
            (400, 200, 200, 150, 0.4), # largest of all, but under the score floor
        ]
        kept = mp_faces.boxes_of(detections, 640, 360, 0.5)
        self.assertEqual(len(kept), 2)
        self.assertEqual([round(b["width"] * 640) for b in kept], [80, 40])
        self.assertEqual([b["score"] for b in kept], [0.6, 0.9])

    def test_a_tie_in_area_goes_to_the_higher_score(self) -> None:
        kept = mp_faces.boxes_of([(0, 0, 40, 40, 0.6), (100, 0, 40, 40, 0.8)], 640, 360, 0.5)
        self.assertEqual([b["score"] for b in kept], [0.8, 0.6])

    def test_normalised_against_the_analysed_frame_at_4_dp(self) -> None:
        # A portrait analysed frame, 360 wide and 640 tall: x by 360, y by 640.
        (box,) = mp_faces.boxes_of([(90, 160, 36, 64, 0.876543)], 360, 640, 0.5)
        self.assertEqual(box, {"x": 0.25, "y": 0.25, "width": 0.1, "height": 0.1, "score": 0.8765})
        (odd,) = mp_faces.boxes_of([(1, 1, 1, 1, 0.9)], 3, 7, 0.5)
        # The size is taken between the rounded edges (0.6667 − 0.3333), so x + width is the right edge.
        self.assertEqual((odd["x"], odd["y"], odd["width"], odd["height"]), (0.3333, 0.1429, 0.3334, 0.1428))

    def test_a_box_past_the_edges_is_clamped_inside_the_frame(self) -> None:
        (box,) = mp_faces.boxes_of([(-20, 300, 100, 100, 0.9)], 640, 360, 0.5)
        self.assertEqual((box["x"], box["y"]), (0.0, round(300 / 360, 4)))
        self.assertEqual(box["width"], round(80 / 640, 4))
        self.assertLessEqual(box["y"] + box["height"], 1.0 + 1e-9)
        (right,) = mp_faces.boxes_of([(600.3, 0, 100, 10, 0.9)], 640, 360, 0.5)
        self.assertLessEqual(right["x"] + right["width"], 1.0 + 1e-9)

    def test_nothing_inside_or_not_a_number_is_no_face(self) -> None:
        nan = float("nan")
        self.assertEqual(mp_faces.boxes_of([(700, 10, 20, 20, 0.9), (10, 10, 0, 20, 0.9), (nan, 0, 9, 9, 0.9), (0, 0, 9, 9, nan)], 640, 360, 0.5), [])

    def test_the_score_floor_is_inclusive(self) -> None:
        self.assertEqual(len(mp_faces.boxes_of([(0, 0, 10, 10, 0.5)], 640, 360, 0.5)), 1)


class AnalysisSize(unittest.TestCase):
    def test_the_long_side_is_the_edge_with_the_upright_aspect(self) -> None:
        self.assertEqual(mp_faces.analysis_size(640, 3840, 2160), (640, 360))
        # A phone clip turned upright: the LONG side is its height.
        self.assertEqual(mp_faces.analysis_size(640, 1080, 1920), (360, 640))
        self.assertEqual(mp_faces.analysis_size(640, 360, 640), (360, 640))

    def test_both_sides_are_even(self) -> None:
        for edge, w, h in ((640, 1000, 333), (641, 1000, 333), (480, 1179, 2556), (640, 101, 99)):
            got = mp_faces.analysis_size(edge, w, h)
            self.assertEqual([side % 2 for side in got], [0, 0], (edge, w, h, got))
        self.assertEqual(mp_faces.analysis_size(641, 1000, 333), (640, 214))


# -------------------------------------------------------------------- cache


class Cache(unittest.TestCase):
    def setUp(self) -> None:
        self.cache = tempfile.mkdtemp(prefix="forge-faces-cache-")
        self.addCleanup(shutil.rmtree, self.cache, True)
        patcher = mock.patch.dict(os.environ, {"FORGE_CACHE_DIR": self.cache})
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop(faces.FAKE_ENV, None)

    def test_the_track_is_under_the_faces_cache_and_its_name_has_no_colon(self) -> None:
        path = faces.track_path(settings())
        self.assertEqual(os.path.dirname(path), os.path.join(self.cache, "faces"))
        name = os.path.basename(path)
        self.assertNotIn(":", name)
        self.assertRegex(name, r"^1234567-1728912345678\.25-[0-9a-f]{16}\.json$")

    def test_every_setting_that_changes_the_samples_changes_the_name(self) -> None:
        base = faces.track_path(settings())
        self.assertEqual(faces.track_path(settings()), base)
        for change in (
            {"fps": 10}, {"edge": 480}, {"minScore": 0.6}, {"startMs": 1000}, {"endMs": 9000},
            {"width": 1080, "height": 1920}, {"key": "1234567:1728912345679.25"},
        ):
            self.assertNotEqual(faces.track_path(settings(**change)), base, change)
        with mock.patch.dict(os.environ, {faces.FAKE_ENV: "colour"}):
            self.assertNotEqual(faces.track_path(settings()), base, "a stand-in's track must never be served as real")

    def test_two_keys_that_clean_alike_are_still_two_tracks(self) -> None:
        self.assertNotEqual(faces.track_path(settings(key="12:34")), faces.track_path(settings(key="12-34")))

    def test_defaults_and_clamps(self) -> None:
        s = settings()
        self.assertEqual((s["fps"], s["edge"], s["minScore"], s["startMs"], s["endMs"]), (5.0, 640, 0.5, 0.0, None))
        s = settings(fps=120, edge=10_000, minScore=3, startMs=-5)
        self.assertEqual((s["fps"], s["edge"], s["minScore"], s["startMs"]), (30.0, 2048, 1.0, 0.0))
        self.assertEqual(settings(fps=0.2)["fps"], 1.0)
        with self.assertRaises(ValueError):
            settings(startMs=5000, endMs=4000)
        with self.assertRaises(ValueError):
            settings(key="")

    def test_a_track_is_read_only_when_whole(self) -> None:
        folder = os.path.join(self.cache, "faces")
        os.makedirs(folder)
        whole = os.path.join(folder, "whole.json")
        writer = mp_faces.TrackWriter(whole + ".part", whole)
        writer.add(0, [{"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2, "score": 0.9}])
        writer.add(200, [])
        self.assertFalse(os.path.exists(whole), "nothing is in place before the pass ends")
        writer.finish()
        self.assertFalse(os.path.exists(whole + ".part"))
        self.assertEqual(faces.summary(whole), (2, 1))
        with open(whole, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["samples"][1], {"ms": 200, "faces": []})
        half = os.path.join(folder, "half.json")
        with open(half, "w", encoding="utf-8") as handle:
            handle.write('{"version":1,"samples":[{"ms":0,"faces":[]}')
        self.assertIsNone(faces.summary(half))


# --------------------------------------------------------------------- spec


class Spec(unittest.TestCase):
    def test_the_spec_survives_the_pipe(self) -> None:
        s = settings(fps=7.5, edge=480, minScore=0.65, startMs=1500, endMs=9000)
        spec = faces.worker_spec(s, 26600, "/m/model.tflite", "/c/faces/t.json", "/c/faces/t.json.1-7.part")
        self.assertEqual(mp_faces.parse_spec(json.dumps(spec)), spec)
        whole = faces.worker_spec(settings(), None, "/m", "/t", "/p")
        self.assertEqual(mp_faces.parse_spec(json.dumps(whole)), whole)
        self.assertEqual(mp_faces.parse_spec('{"mode": "import"}'), {"mode": "import"})

    def test_a_spec_out_of_range_is_refused(self) -> None:
        good = faces.worker_spec(settings(), 1000, "/m", "/t", "/p")
        for change in ({"fps": 0}, {"fps": 31}, {"minScore": 1.5}, {"width": 0}, {"width": 10.5},
                       {"startMs": -1}, {"startMs": 500, "endMs": 400}, {"path": ""}, {"track": None},
                       {"edge": True}, {"mode": "draw"}):
            with self.assertRaises(ValueError, msg=str(change)):
                mp_faces.parse_spec(json.dumps({**good, **change}))
        with self.assertRaises(ValueError):
            mp_faces.parse_spec("not json")

    def test_expected_frames(self) -> None:
        spec = mp_faces.parse_spec(json.dumps(faces.worker_spec(settings(), 4000, "/m", "/t", "/p")))
        self.assertEqual(mp_faces.expected_frames(spec), 20)
        spec = mp_faces.parse_spec(json.dumps(faces.worker_spec(settings(startMs=1000, endMs=2500), 4000, "/m", "/t", "/p")))
        self.assertEqual(mp_faces.expected_frames(spec), 8)
        spec = mp_faces.parse_spec(json.dumps(faces.worker_spec(settings(), None, "/m", "/t", "/p")))
        self.assertIsNone(mp_faces.expected_frames(spec))

    def test_the_helper_and_the_worker_name_the_same_codes(self) -> None:
        # faces.py keeps literal copies so it never imports the worker module.
        self.assertEqual(
            (faces.FAKE_ENV, faces.EXIT_INPUT, faces.EXIT_IMPORT, faces.TRACK_VERSION, faces.NOTE_PREFIX),
            (mp_faces.FAKE_ENV, mp_faces.EXIT_INPUT, mp_faces.EXIT_IMPORT, mp_faces.TRACK_VERSION, mp_faces.NOTE_PREFIX),
        )

    def test_a_pass_waits_for_ready_as_long_as_the_self_test_waits_for_the_import(self) -> None:
        # The same import, in the same worker: a pass never refuses what the install's self-test passes.
        from forge_sidecar import selftest

        self.assertEqual(faces.READY_TIMEOUT_S, selftest.GROUP_TIMEOUT_S)

    def test_the_fake_mode_is_read_strictly(self) -> None:
        self.assertEqual(mp_faces.fake_mode("colour"), ("colour", 0.0))
        self.assertEqual(mp_faces.fake_mode("colour:40"), ("colour", 40.0))
        self.assertIsNone(mp_faces.fake_mode(""))
        self.assertIsNone(mp_faces.fake_mode("faces"))


class WorkerStopsShort(unittest.TestCase):
    """mp_faces.run itself, its frames and detector stood in: a pass that stops short removes its partial.

    The end of the worker's stdin is a cancel, and it is also how the helper's
    DEATH reaches the worker — after which nobody else is left to remove the
    partial (measured: a helper SIGKILLed mid-pass left one in the cache for
    good). tests/integration/faces.int.test.ts kills a real helper.
    """

    def setUp(self) -> None:
        self.folder = tempfile.mkdtemp(prefix="forge-faces-run-")
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.track = os.path.join(self.folder, "t.json")
        self.partial = self.track + ".1-7.part"
        self.spec = mp_faces.parse_spec(json.dumps(faces.worker_spec(settings(), 4000, "/m", self.track, self.partial)))

    def run_then(self, stopped_by: BaseException) -> int:
        written: list[bool] = []

        def frames(*_args: object, **_kwargs: object):  # type: ignore[no-untyped-def]
            yield 0, None
            yield 200, None
            written.append(os.path.isfile(self.partial))
            raise stopped_by

        with mock.patch.object(mp_faces.media, "iter_frames", side_effect=frames), mock.patch.object(mp_faces, "_say"):
            code = mp_faces.run(self.spec, (lambda _frame, _ms: [], lambda: None), mock.Mock(ended=False), {})
        self.assertEqual(written, [True], "the pass never wrote its partial, so this proves nothing")
        return code

    def test_a_cancel_removes_the_partial(self) -> None:
        self.assertEqual(self.run_then(Cancelled()), mp_faces.EXIT_CANCELLED)
        self.assertEqual(os.listdir(self.folder), [], "the cancelled half-track was kept")

    def test_a_file_it_cannot_decode_removes_the_partial(self) -> None:
        self.assertEqual(self.run_then(ValueError("moov atom not found")), mp_faces.EXIT_INPUT)
        self.assertEqual(os.listdir(self.folder), [])

    def test_anything_else_raised_removes_the_partial(self) -> None:
        # A pipe to a dead helper: the next progress line raises BrokenPipeError.
        with self.assertRaises(BrokenPipeError):
            self.run_then(BrokenPipeError())
        self.assertEqual(os.listdir(self.folder), [])


class StdinOnly:
    """``sys.stdin`` as the worker may use it: its descriptor. Read as a stream, it fails the test."""

    def __init__(self, fd: int) -> None:
        self.fd = fd

    def fileno(self) -> int:
        return self.fd

    def _streamed(self, *_args: object) -> object:
        raise AssertionError("the worker read sys.stdin as a stream, not its descriptor through stdio.LineReader")

    __iter__ = __next__ = read = readline = _streamed

    @property
    def buffer(self) -> object:
        return self._streamed()


class WorkerOrder(unittest.TestCase):
    """mp_faces.main: the spec, then every import (``load``), then the watch on stdin, then the pass.

    On Windows a read of stdin left waiting held up the main thread's
    ``import numpy`` for good: the stand-in imported numpy after its watch
    had started reading, and every stand-in pass on CI run 38982628323 hung
    there. stdio.LineReader no longer leaves a read waiting on Windows; this
    order is the second guard, on every platform. The real main, with stdin
    a real pipe held open as the helper holds it, the stand-in detector's
    import stood in (no numpy needed) and two frames.
    """

    def test_everything_is_imported_before_stdin_is_watched(self) -> None:
        folder = tempfile.mkdtemp(prefix="forge-faces-order-")
        self.addCleanup(shutil.rmtree, folder, True)
        track = os.path.join(folder, "t.json")
        spec = faces.worker_spec(settings(), 4000, "/m", track, track + ".1-7.part")
        r, w = os.pipe()
        os.write(w, (json.dumps(spec) + "\n").encode("utf-8"))
        watching_at_import: list[bool] = []

        def watching() -> bool:
            return any(t.name.endswith("(_watch)") and t.is_alive() for t in threading.enumerate())

        def detector(_delay_ms: float) -> object:
            watching_at_import.append(watching())
            return lambda _frame, _ms: []

        def frames(*_args: object, **_kwargs: object):  # type: ignore[no-untyped-def]
            yield 0, None
            yield 200, None

        try:
            with mock.patch.object(sys, "stdin", StdinOnly(r)), \
                    mock.patch.dict(os.environ, {mp_faces.FAKE_ENV: "colour"}), \
                    mock.patch.object(mp_faces, "_colour_detector", side_effect=detector), \
                    mock.patch.object(mp_faces.media, "iter_frames", side_effect=frames), \
                    contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
                code = mp_faces.main()
                watched = watching()
        finally:
            os.close(w)  # the helper's close: the watch sees the end and goes
            for thread in threading.enumerate():
                if thread.name.endswith("(_watch)"):
                    thread.join(5)
            os.close(r)
        notes = [line.split(" (+")[0] for line in err.getvalue().splitlines() if line.startswith(mp_faces.NOTE_PREFIX)]
        self.assertEqual(
            notes[:3],
            ["mp_faces: the spec read", "mp_faces: the stand-in detector made (numpy imported)", "mp_faces: watching stdin"],
            err.getvalue(),
        )
        self.assertEqual(watching_at_import, [False], "the detector's import ran beside the watch's read of stdin")
        self.assertTrue(watched, "the pass ran with nothing watching stdin for its cancel")
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(out.getvalue().splitlines(), ["ready fake/colour 0.000", "done 2 0"])
        self.assertTrue(os.path.isfile(track))


# -------------------------------------------------------------------- stubs


class Stubs(unittest.TestCase):
    def test_the_stubs_are_the_workers_and_never_the_helpers(self) -> None:
        stubs = os.path.normcase(os.path.realpath(faces.STUBS_DIR))
        before = dict(os.environ)
        server = Server()
        from forge_sidecar import capabilities

        with mock.patch.object(capabilities, "OPTIONAL", [(("vision.faces", "vision.facesModel"), "faces")]):
            capabilities.register_all(server)
        command = faces.worker_command()
        # The helper's own path and environment: no stub folder, before or after building the worker's.
        for entry in sys.path:
            self.assertFalse(
                os.path.normcase(os.path.realpath(entry or os.curdir)).startswith(stubs),
                f"{entry} is on the helper's sys.path",
            )
        self.assertEqual(dict(os.environ), before, "building the worker's environment changed the helper's")
        # The worker's: this interpreter, -E -s -B, and a bootstrap — never the stubs in its environment.
        self.assertEqual(command["argv"][0], sys.executable)
        self.assertEqual(command["argv"][1:5], ["-E", "-s", "-B", "-c"])
        self.assertEqual(command["argv"][5], faces.WORKER_BOOTSTRAP)
        self.assertEqual(len(command["argv"]), 6)
        self.assertNotIn("-I", command["argv"])
        self.assertNotIn(faces.STUBS_DIR, command["env"].get("PYTHONPATH", ""))
        self.assertTrue(os.path.isfile(os.path.join(faces.STUBS_DIR, "cv2", "__init__.py")))
        self.assertTrue(os.path.isfile(os.path.join(faces.STUBS_DIR, "matplotlib", "pyplot.py")))

    def test_the_worker_env_is_the_helpers_own_forge_settings_and_all(self) -> None:
        env = faces.worker_env({"FORGE_CACHE_DIR": "/c", "FORGE_FACES_WORKER_FAKE": "colour", "PATH": "/bin"})
        self.assertEqual(env, {"FORGE_CACHE_DIR": "/c", "FORGE_FACES_WORKER_FAKE": "colour", "PATH": "/bin"})

    def probe(self, env: dict[str, str]) -> dict:
        """The worker's real argv, with its bootstrap's last line — the run of the worker
        module — swapped for a report of what the worker would start with. The path
        line, the flags, the cwd and the environment are the real ones."""
        command = faces.worker_command(env)
        bootstrap = command["argv"][-1]
        run = f"runpy.run_module({faces.WORKER_MODULE!r}, run_name='__main__', alter_sys=True)"
        self.assertEqual(bootstrap.count(run), 1, bootstrap)
        report = (
            "import importlib.util, json; spec = importlib.util.find_spec('cv2'); "
            "print(json.dumps({'path': sys.path, 'cv2': spec.origin if spec else None, "
            "'flags': [sys.flags.ignore_environment, sys.flags.no_user_site, sys.flags.dont_write_bytecode]}))"
        )
        done = subprocess.run(
            [*command["argv"][:-1], bootstrap.replace(run, report)],
            cwd=command["cwd"], env=command["env"], capture_output=True, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr.decode(errors="replace"))
        return json.loads(done.stdout)

    def test_the_bootstrap_puts_the_stubs_first_and_the_package_second(self) -> None:
        seen = self.probe(dict(os.environ))
        self.assertEqual(seen["path"][:2], [faces.STUBS_DIR, faces.PACKAGE_PARENT])
        self.assertEqual(os.path.dirname(os.path.dirname(seen["cv2"])), faces.STUBS_DIR)
        self.assertEqual(seen["flags"], [1, 1, 1])

    def test_a_pythonpath_of_the_users_never_reaches_the_worker(self) -> None:
        # A folder with a cv2 of its own on PYTHONPATH: -E keeps it off the worker's path.
        planted = tempfile.mkdtemp(prefix="forge-faces-planted-")
        self.addCleanup(shutil.rmtree, planted, True)
        os.makedirs(os.path.join(planted, "cv2"))
        pathlib.Path(planted, "cv2", "__init__.py").write_text("raise ImportError('the planted cv2')\n")
        seen = self.probe({**os.environ, "PYTHONPATH": planted})
        resolved = [os.path.realpath(entry or os.curdir) for entry in seen["path"]]
        self.assertNotIn(os.path.realpath(planted), resolved)
        self.assertEqual(os.path.dirname(os.path.dirname(seen["cv2"])), faces.STUBS_DIR)

    def test_the_worker_speaks_utf8_whatever_the_locale(self) -> None:
        # A spec it refuses, naming a non-ASCII value: the "error input" line must reach
        # the helper as UTF-8. Latin-1 here (the Mac has the locale); Windows' pipes
        # take the ANSI code page anyway. -E ignores PYTHONIOENCODING, so the worker
        # sets its own streams.
        command = faces.worker_command()
        env = {k: v for k, v in command["env"].items() if not k.upper().startswith("PYTHON")}
        latin1 = "en_US.ISO8859-1"
        if sys.platform == "darwin" and os.path.isdir(f"/usr/share/locale/{latin1}"):
            env.update(LC_ALL=latin1, LANG=latin1)
        done = subprocess.run(
            command["argv"], cwd=command["cwd"], env=env, capture_output=True, timeout=60,
            input='{"mode": "ಕನ್ನಡ Bräutigam"}\n'.encode("utf-8"),
        )
        out = done.stdout.decode("utf-8")
        self.assertIn("error input the spec's mode must be 'detect' or 'import', not 'ಕನ್ನಡ Bräutigam'", out, done.stderr.decode(errors="replace"))
        self.assertEqual(done.returncode, faces.EXIT_INPUT)


def crt_argv(line: str) -> list[str]:
    """argv as the Microsoft C runtime builds it from one command line — what a Windows python.exe gets.

    The UCRT's rules (argv_parsing.cpp; Microsoft's "Parsing C command-line
    arguments"): the program name runs to the first space or tab outside
    quotes, its quotes dropped and nothing escaped; then 2N backslashes and a
    quote are N backslashes and a quote that opens or closes, 2N+1 and a quote
    are N and a literal quote, backslashes before anything else are literal,
    a doubled quote inside quotes is one literal quote, and only a space or a
    tab outside quotes ends an argument — a newline is an ordinary character.
    """
    args: list[str] = []
    i, n = 0, len(line)
    name: list[str] = []
    quoted = False
    while i < n and (quoted or line[i] not in " \t"):
        if line[i] == '"':
            quoted = not quoted
        else:
            name.append(line[i])
        i += 1
    args.append("".join(name))
    quoted = False
    while True:
        while i < n and line[i] in " \t":
            i += 1
        if i >= n:
            return args
        arg: list[str] = []
        while True:
            copy = True
            slashes = 0
            while i < n and line[i] == "\\":
                slashes += 1
                i += 1
            if i < n and line[i] == '"':
                if slashes % 2 == 0:
                    if quoted and i + 1 < n and line[i + 1] == '"':
                        i += 1
                    else:
                        copy = False
                        quoted = not quoted
                slashes //= 2
            arg.append("\\" * slashes)
            if i >= n or (not quoted and line[i] in " \t"):
                break
            if copy:
                arg.append(line[i])
            i += 1
        args.append("".join(arg))


class WindowsCommandLine(unittest.TestCase):
    """The worker's argv through ``subprocess.list2cmdline`` and back through the C runtime.

    On Windows a child gets ONE command line, which Popen builds with
    ``list2cmdline`` and the child's C runtime splits again; the bootstrap is
    three lines of Python with every folder in it as a ``repr`` — which turns
    to double quotes for a folder with an apostrophe (``C:\\Users\\O'Brien``).
    The install's self-test runs this command on Windows (CI's step 12 passed
    with it); this holds it for the folders that run did not have.
    """

    def test_the_parser_follows_microsofts_own_examples(self) -> None:
        for line, expected in (
            (r'"a b c" d e', ["a b c", "d", "e"]),
            (r'"ab\"c" "\\" d', ['ab"c', "\\", "d"]),
            (r'a\\\b d"e f"g h', [r"a\\\b", "de fg", "h"]),
            (r'a\\\"b c d', [r'a\"b', "c", "d"]),
            (r'a\\\\"b c" d e', [r"a\\b c", "d", "e"]),
            (r'a"b"" c d', ['ab" c d']),
        ):
            self.assertEqual(crt_argv("prog " + line)[1:], expected, line)
        # A program name in quotes, its backslashes as they are; a newline inside an argument is kept.
        self.assertEqual(crt_argv('"C:\\Program Files\\x.exe" -c "a\nb c"\td'), ["C:\\Program Files\\x.exe", "-c", "a\nb c", "d"])

    def test_the_bootstrap_comes_back_whole_for_any_folder(self) -> None:
        folders = [
            (faces.STUBS_DIR, faces.PACKAGE_PARENT),
            (r"C:\Program Files\3dit\resources\sidecar\forge_sidecar\stubs", r"C:\Program Files\3dit\resources\sidecar"),
            (r"C:\Users\O'Brien\AppData\Local\Programs\3dit\resources\sidecar\forge_sidecar\stubs", r"C:\Users\O'Brien\AppData\Local\Programs\3dit\resources\sidecar"),
            (r"D:\a\_temp\forge pack é\sidecar\forge_sidecar\stubs", r"D:\a\_temp\forge pack é\sidecar"),
            ("C:\\Users\\Zoë\\stubs\\", "\\\\server\\share\\sidecar\\\\"),
            ('C:\\a "quoted" name\\stubs', "C:\\tab\there\\and a 'quote'"),
        ]
        for stubs, parent in folders:
            bootstrap = faces.worker_bootstrap(stubs, parent)
            argv = [r"C:\Program Files\3dit\python\python.exe", *faces.WORKER_FLAGS, "-c", bootstrap]
            line = subprocess.list2cmdline(argv)
            self.assertEqual(crt_argv(line), argv, line)
            # And the line the worker runs puts exactly these two folders first.
            assign = ast.parse(bootstrap).body[1]
            self.assertIsInstance(assign, ast.Assign)
            self.assertEqual(ast.literal_eval(assign.value), [stubs, parent])  # type: ignore[union-attr]
        self.assertEqual(faces.WORKER_BOOTSTRAP, faces.worker_bootstrap(faces.STUBS_DIR, faces.PACKAGE_PARENT))
        command = faces.worker_command()
        self.assertEqual(crt_argv(subprocess.list2cmdline(command["argv"])), command["argv"])


class Registration(unittest.TestCase):
    def test_absent_mediapipe_is_unavailable_with_how_to_install(self) -> None:
        server = Server()
        with mock.patch.object(faces.importlib.util, "find_spec", return_value=None):
            with self.assertRaises(Unavailable) as caught:
                faces.register(server)
        self.assertIn("requirements-faces.txt", str(caught.exception))
        self.assertNotIn("vision.faces", server.capabilities)

    def test_present_mediapipe_registers_both_without_importing_it(self) -> None:
        server = Server()
        found = importlib.machinery.ModuleSpec("mediapipe", None)
        had = "mediapipe" in sys.modules
        with mock.patch.object(faces.importlib.util, "find_spec", return_value=found) as asked:
            faces.register(server)
        asked.assert_called_once_with("mediapipe")
        self.assertIn("vision.faces", server.capabilities)
        self.assertIn("vision.facesModel", server.capabilities)
        self.assertEqual("mediapipe" in sys.modules, had, "registration imported mediapipe")

    def test_absent_mediapipe_leaves_vision_measure_registered(self) -> None:
        # docs/CLIPS.md §4.3: never in vision.py — a missing mediapipe must not
        # take vision.measure, the Director's gate, down with it. That holds
        # only by register_all's structure, one module a row, so it is asked
        # of register_all itself. vision.measure needs numpy and scipy; on an
        # interpreter without them it is degraded anyway, and this cannot ask.
        try:
            import numpy  # noqa: F401
            import scipy  # noqa: F401
        except ImportError:
            self.skipTest("numpy is not installed")
        from forge_sidecar import capabilities

        real = faces.importlib.util.find_spec

        def find(name: str, *args: object, **kwargs: object) -> object:
            return None if name == "mediapipe" else real(name, *args, **kwargs)  # type: ignore[arg-type]

        server = Server()
        with mock.patch.object(faces.importlib.util, "find_spec", side_effect=find):
            capabilities.register_all(server)
        self.assertIn("vision.measure", server.capabilities)
        self.assertNotIn("vision.measure", server.degraded)
        for method in ("vision.faces", "vision.facesModel"):
            self.assertIn("mediapipe is not installed", server.degraded.get(method, ""), method)


# -------------------------------------------------------------------- model


class Model(unittest.TestCase):
    def setUp(self) -> None:
        self.models = tempfile.mkdtemp(prefix="forge-faces-models-")
        self.addCleanup(shutil.rmtree, self.models, True)
        patcher = mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": self.models})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_pin(self) -> None:
        self.assertEqual(faces.MODEL_BYTES, 1_083_786)
        self.assertRegex(faces.MODEL_SHA256, r"^[0-9a-f]{64}$")
        self.assertTrue(faces.MODEL_URL.startswith("https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/"))
        self.assertTrue(faces.MODEL_URL.endswith("/blaze_face_full_range.tflite"))

    def test_asking_never_fetches(self) -> None:
        def no_network(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("the network was touched")

        with mock.patch("urllib.request.urlopen", side_effect=no_network):
            for params in ({}, {"download": False}, {"download": "yes"}, {"download": 1}):
                status = faces.faces_model(params, Context())
                self.assertEqual(status, {"present": False, "bytes": 1_083_786, "label": "the face finder", "host": "storage.googleapis.com"})
        self.assertEqual(os.listdir(self.models), [], "a question left something in the models folder")

    def test_the_press_fetches_into_fetch_urls_own_place(self) -> None:
        source = os.path.join(self.models, "src", "blaze_face_full_range.tflite")
        os.makedirs(os.path.dirname(source))
        with open(source, "wb") as handle:
            handle.write(os.urandom(200_000))
        with open(source, "rb") as handle:
            sha = hashlib.sha256(handle.read()).hexdigest()
        url = pathlib.Path(source).as_uri()
        with mock.patch.object(faces, "MODEL_URL", url), mock.patch.object(faces, "MODEL_SHA256", sha):
            context = Context()
            status = faces.faces_model({"download": True}, context)
            self.assertTrue(status["present"])
            # The place faces.py looks is the place fetch_url keeps it: the same call answers it.
            self.assertEqual(faces.model_path(), media.fetch_url(url, sha, None, "the face finder"))
            self.assertTrue(context.seen and all(m and "the face finder" in m for _p, m in context.seen))
            # Present: a second press fetches nothing.
            os.remove(source)
            self.assertTrue(faces.faces_model({"download": True}, Context())["present"])

    @needs_ffmpeg
    def test_the_work_without_its_model_says_so_and_starts_nothing(self) -> None:
        clip = os.path.join(OUT, "faces-gate.mp4")
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "color=c=black:s=320x180:r=10:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip], check=True)
        cache = tempfile.mkdtemp(prefix="forge-faces-cache-")
        self.addCleanup(shutil.rmtree, cache, True)
        # The network refused too: a gate that fetched as a side effect fails here
        # by name, rather than pulling the real model from Google mid-test.
        with mock.patch.dict(os.environ, {"FORGE_CACHE_DIR": cache}), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("the network was touched")), \
                mock.patch.object(faces, "run_worker", side_effect=AssertionError("a worker was started")):
            with self.assertRaises(Unavailable) as caught:
                faces.faces({"path": clip, "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 320, "height": 180, "key": "1:2"}, Context())
            self.assertIn("not downloaded yet", str(caught.exception))
            self.assertIn("1,083,786", str(caught.exception))
            # The upright check comes first: the wrong size is refused with both sizes, before the model.
            with self.assertRaises(media.SizeMismatch) as wrong:
                faces.faces({"path": clip, "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 180, "height": 320, "key": "1:2"}, Context())
            self.assertIn("320×180", str(wrong.exception))
            self.assertIn("180×320", str(wrong.exception))


# ------------------------------------------------------- the worker's pipe


STAND_IN_DEADLINE_S = 15
"""How long a stand-in worker may live. Past it, it exits 99: a helper that never
stops its worker (its relay loop not checking the cancel) then fails the test
that was waiting on it, by name, rather than hanging the suite — on CI's bare
interpreter this layer is the only one that runs."""
STAND_IN_OVERTIME = 99


def stand_in(body: str) -> dict:
    """A worker command running ``body`` (it gets ``spec``, ``say``) instead of mp_faces."""
    script = textwrap.dedent(
        f"""
        import json, os, sys, threading, time
        _deadline = threading.Timer({STAND_IN_DEADLINE_S}, os._exit, ({STAND_IN_OVERTIME},))
        _deadline.daemon = True
        _deadline.start()
        spec = json.loads(sys.stdin.buffer.readline())
        def say(*words):
            sys.stdout.write(" ".join(str(w) for w in words) + "\\n"); sys.stdout.flush()
        """
    ) + textwrap.dedent(body)
    return {"argv": [sys.executable, "-c", script], "cwd": OUT, "env": dict(os.environ)}


class Pipe(unittest.TestCase):
    """faces.run_worker against stand-in workers: what the helper does with what a worker says and does."""

    def setUp(self) -> None:
        self.folder = tempfile.mkdtemp(prefix="forge-faces-pipe-")
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.track = os.path.join(self.folder, "t.json")
        self.partial = self.track + ".1-7.part"
        self.spec = {"track": self.track, "partial": self.partial}

    def run_with(self, body: str, context: Context | None = None) -> Context:
        context = context or Context()
        with mock.patch.object(faces, "worker_command", return_value=stand_in(body)):
            faces.run_worker(self.spec, context)
        return context

    def test_progress_is_relayed_as_finding_faces(self) -> None:
        context = self.run_with(
            """
            open(spec["partial"], "w").write('{"version":1,"samples":[]}')
            say("ready", "0.10.35", "0.1")
            say("progress", "0.25", "10")
            say("progress", "0.5", "20")
            say("progress", "-", "30")
            os.replace(spec["partial"], spec["track"])
            say("done", "30", "0")
            """
        )
        self.assertEqual(context.seen, [(0.25, "finding faces"), (0.5, "finding faces"), (None, "finding faces")])
        self.assertTrue(os.path.isfile(self.track))

    def test_an_abort_is_unavailable_with_its_code_and_leaves_no_partial(self) -> None:
        with self.assertRaises(Unavailable) as caught:
            self.run_with(
                """
                open(spec["partial"], "w").write('{"version":1,"samples":[{"ms":0,"faces":[]}')
                sys.stderr.write("F0000 graph_service.h:139] Check failed: service_ Service is unavailable.\\n")
                sys.stderr.write("*** Check failure stack trace: ***\\n    @ 0x18b540c1c thread_start\\n")
                sys.stderr.flush()
                os.abort()
                """
            )
        # -6 (SIGABRT) on macOS and Linux. On Windows CPython's docs say
        # abort() exits 3, but the UCRT's abort() fast-fails with
        # STATUS_STACK_BUFFER_OVERRUN, 0xC0000409, when _CALL_REPORTFAULT is
        # set. Neither is measured (docs/CLIPS.md §4.3), so either is accepted
        # there until a Windows run says which; the message's shape is the
        # same whatever the number.
        codes = (3, 0xC0000409) if os.name == "nt" else (-6,)
        message = str(caught.exception)
        self.assertTrue(any(message.startswith(f"the face detector stopped (code {c}): ") for c in codes), message)
        self.assertIn("Check failed: service_", str(caught.exception))
        self.assertFalse(os.path.exists(self.partial), "the abort's half-track was kept")
        self.assertFalse(os.path.exists(self.track))

    def test_a_failed_import_is_unavailable_with_the_reason(self) -> None:
        with self.assertRaises(Unavailable) as caught:
            self.run_with('say("error", "import", "ModuleNotFoundError: No module named \'cv2\'"); sys.exit(69)')
        self.assertEqual(str(caught.exception), "the face detector could not start: ModuleNotFoundError: No module named 'cv2'")

    def test_an_unreadable_file_is_an_error_not_unavailable(self) -> None:
        with self.assertRaises(ValueError) as caught:
            self.run_with('say("error", "input", "moov atom not found"); sys.exit(65)')
        self.assertNotIsInstance(caught.exception, Unavailable)
        self.assertIn("moov atom not found", str(caught.exception))

    def test_a_cancel_ends_stdin_and_the_worker_goes_with_its_partial(self) -> None:
        context = Context()
        marker = os.path.join(self.folder, "stopped")
        threading.Timer(0.5, context.cancel.set).start()
        started = time.monotonic()
        with self.assertRaises(Cancelled):
            self.run_with(
                f"""
                open(spec["partial"], "w").write('{{"version":1,"samples":[')
                say("progress", "0.1", "10")
                sys.stdin.buffer.read()            # until the helper closes it
                open({marker!r}, "w").write("stopped by itself")
                sys.exit(75)
                """,
                context,
            )
        self.assertLess(time.monotonic() - started, faces.STOP_GRACE_S)
        self.assertTrue(os.path.isfile(marker), "the worker did not see its stdin end")
        self.assertFalse(os.path.exists(self.partial), "the cancelled half-track was kept")

    def test_a_worker_that_ignores_the_cancel_is_killed(self) -> None:
        context = Context()
        threading.Timer(0.3, context.cancel.set).start()
        started = time.monotonic()
        with mock.patch.object(faces, "STOP_GRACE_S", 0.5), self.assertRaises(Cancelled):
            self.run_with(
                """
                open(spec["partial"], "w").write("[")
                say("progress", "0.1", "10")
                time.sleep(60)
                """,
                context,
            )
        self.assertLess(time.monotonic() - started, 10)
        self.assertFalse(os.path.exists(self.partial))

    def test_the_worker_is_started_with_no_window(self) -> None:
        # A packaged Windows app has no console of its own, so a console
        # python.exe started without CREATE_NO_WINDOW opens a window on every
        # analysis (CLAUDE.md, "Spawning"). media._NO_WINDOW is {} off Windows,
        # where Popen refuses creationflags, so the flag is put in and Popen
        # watched: what reaches it is what the packaged app would pass.
        seen: list[dict] = []
        real = subprocess.Popen

        def spy(*args: object, **kwargs: object) -> object:
            seen.append(dict(kwargs))
            if os.name != "nt":
                kwargs.pop("creationflags", None)
            return real(*args, **kwargs)  # type: ignore[call-overload]

        with mock.patch.object(media, "_NO_WINDOW", {"creationflags": 0x08000000}), \
                mock.patch.object(faces.subprocess, "Popen", side_effect=spy):
            self.run_with('say("done", "0", "0")')
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].get("creationflags"), 0x08000000)

    def test_the_real_worker_exits_cleanly_with_its_stdin_still_open(self) -> None:
        # The worker module itself, through faces.worker_command, in its import
        # mode with the stand-in (no numpy, no mediapipe: runs on a bare
        # interpreter). stdin stays OPEN while it exits, as it does after every
        # pass in the helper, whose stdin is closed only once the worker has
        # gone. A watcher thread blocked in sys.stdin.buffer made the
        # interpreter's shutdown abort (-6) after a finished pass — the
        # detector's own death code.
        command = faces.worker_command()
        env = {**command["env"], faces.FAKE_ENV: "colour"}
        process = subprocess.Popen(command["argv"], cwd=command["cwd"], env=env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            assert process.stdin is not None and process.stdout is not None and process.stderr is not None
            process.stdin.write(b'{"mode": "import"}\n')
            process.stdin.flush()
            code = process.wait(timeout=30)
            out, err = process.stdout.read(), process.stderr.read()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
        self.assertEqual(out.decode().split(), ["ready", "fake/colour", "0.000"])
        self.assertEqual(code, 0, err.decode(errors="replace"))

    def test_a_worker_with_no_ready_is_stopped_at_the_bound_and_answers_with_its_stderr(self) -> None:
        # A worker hung before `ready` (the import, its native library) held the request for as
        # long as the caller waited, and said nothing of why. Now: stopped at READY_TIMEOUT_S, and
        # Unavailable with the last lines of its stderr, which the helper's log carries too.
        started = time.monotonic()
        with mock.patch.object(faces, "READY_TIMEOUT_S", 1.0), mock.patch.object(faces, "STOP_GRACE_S", 0.5), \
                contextlib.redirect_stderr(io.StringIO()) as log, self.assertRaises(Unavailable) as caught:
            self.run_with(
                """
                sys.stderr.write("loading libmediapipe.dll\\n"); sys.stderr.flush()
                time.sleep(30)
                """
            )
        took = time.monotonic() - started
        message = str(caught.exception)
        self.assertTrue(message.startswith("the face detector did not start within 1 s (stopped while still running): "), message)
        self.assertIn("loading libmediapipe.dll", message)
        self.assertLess(took, 8, "stopped at the bound, not when the stand-in gave up")
        self.assertRegex(log.getvalue(), r"faces: worker \d+: the face detector did not start within 1 s .*loading libmediapipe\.dll")
        self.assertFalse(os.path.exists(self.partial))

    def test_a_silent_worker_is_reported_with_its_stderr_and_its_pass_goes_on(self) -> None:
        with mock.patch.object(faces, "SILENT_REPORT_S", 0.3), contextlib.redirect_stderr(io.StringIO()) as log:
            context = self.run_with(
                """
                say("ready", "0.10.35", "0.1")
                sys.stderr.write("mp_faces: ffmpeg 4242 started (+0.010 s)\\n"); sys.stderr.flush()
                time.sleep(1.2)
                open(spec["partial"], "w").write('{"version":2,"samples":[]}')
                say("progress", "0.5", "10")
                os.replace(spec["partial"], spec["track"])
                say("done", "10", "0")
                """
            )
        said = log.getvalue()
        # The first report carries its stderr; the next ones, the same stderr, say so in a word.
        self.assertRegex(said, r"faces: worker \d+ silent \d+ s, still running; its last line 'ready 0\.10\.35 0\.1'; its stderr: notes: mp_faces: ffmpeg 4242 started \(\+0\.010 s\)\n")
        self.assertRegex(said, r"faces: worker \d+ silent \d+ s, still running; its last line 'ready 0\.10\.35 0\.1'; its stderr unchanged\n")
        self.assertRegex(said, r"faces: worker \d+ ended \(code 0\) after \d+\.\d s")
        self.assertEqual(context.seen, [(0.5, "finding faces")])
        self.assertTrue(os.path.isfile(self.track))

    def test_the_worker_log_is_read_without_moving_where_the_worker_writes(self) -> None:
        # The helper reads the worker's stderr while the worker may still write to it, through
        # one open file and so one offset: what the worker writes after a read lands after
        # what it wrote before, and the read is the end of the file.
        with tempfile.TemporaryFile() as errors:
            os.write(errors.fileno(), b"first\n")
            self.assertEqual(faces.worker_log(errors), "first\n")
            os.write(errors.fileno(), b"second\n")
            self.assertEqual(faces.worker_log(errors), "first\nsecond\n")
            os.write(errors.fileno(), b"x" * faces.TAIL_BYTES + b"\nlast\n")
            tail = faces.worker_log(errors)
            self.assertEqual(len(tail.encode()), faces.TAIL_BYTES)
            self.assertTrue(tail.endswith("\nlast\n"))

    def test_the_last_words_are_never_a_stage_note_or_a_stall_dump(self) -> None:
        # The worker's notes and faulthandler's dump share its stderr with the reason it died.
        dump = (
            "mp_faces: the spec read (+0.051 s)\n"
            "mp_faces: ffmpeg 812 started, 640x360 at 5 fps (+0.230 s)\n"
            "Timeout (0:00:08)!\n"
            "Thread 0x0000700001234000 (most recent call first):\n"
            '  File "C:\\\\forge\\\\media.py", line 238 in _read_exact\n'
            "  <no Python frame>\n"
            "Current thread 0x00000001f2a3c0c0 (most recent call first):\n"
            '  File "C:\\\\forge\\\\mp_faces.py", line 418 in _watch\n'
        )
        self.assertEqual(faces.last_words(dump), "")
        self.assertEqual(faces.last_words(dump + "Fatal Python error: Aborted\n"), "Fatal Python error: Aborted")
        traceback = 'Traceback (most recent call last):\n  File "x.py", line 3, in <module>\nMemoryError: out of frames\n'
        self.assertEqual(faces.last_words(dump + traceback), "MemoryError: out of frames")
        self.assertEqual(faces.last_words('  File "x.py", line 3, in <module>\n'), 'File "x.py", line 3, in <module>')

    def test_a_stall_dump_is_read_as_each_threads_newest_frames_on_one_line(self) -> None:
        # faulthandler's dump as Python 3.14 writes it (its format read off a worker hung on purpose,
        # 2026-10-16), on Windows paths under a user's profile: what the silence report says of it.
        folder = "C:\\Users\\Zoë\\AppData\\Local\\Programs\\3dit\\resources\\sidecar\\forge_sidecar"
        dump = (
            "Timeout (0:00:08)!\n"
            "Thread 0x0000000170e6f000 [Thread-1 (_watch)] (most recent call first):\n"
            f'  File "{folder}\\workers\\mp_faces.py", line 418 in _watch\n'
            '  File "C:\\py\\Lib\\threading.py", line 1024 in run\n'
            '  File "C:\\py\\Lib\\threading.py", line 1082 in _bootstrap_inner\n'
            '  File "C:\\py\\Lib\\threading.py", line 1044 in _bootstrap\n'
            "\n"
            "Thread 0x00000001f774dd80 (most recent call first):\n"
            f'  File "{folder}\\media.py", line 238 in _read_exact\n'
            f'  File "{folder}\\media.py", line 310 in iter_frames\n'
            f'  File "{folder}\\workers\\mp_faces.py", line 523 in run\n'
            f'  File "{folder}\\workers\\mp_faces.py", line 598 in main\n'
            f'  File "{folder}\\workers\\mp_faces.py", line 604 in <module>\n'
            '  File "<string>", line 3 in <module>\n'
        )
        earlier = 'Timeout (0:00:08)!\nThread 0x01 (most recent call first):\n  File "x.py", line 1 in earlier\n'
        notes = "mp_faces: the spec read (+0.000 s)\nmp_faces: ffmpeg 812 started, 640x360 at 5 fps (+0.034 s)\n"
        stacks = (
            "Thread-1 (_watch): mp_faces.py:418 _watch < threading.py:1024 run < threading.py:1082 _bootstrap_inner < threading.py:1044 _bootstrap"
            " | main: media.py:238 _read_exact < media.py:310 iter_frames < mp_faces.py:523 run < mp_faces.py:598 main"
        )
        self.assertEqual(faces.compact_dump(earlier + notes + dump), stacks)
        self.assertEqual(faces.compact_dump(notes), "")
        said = faces.stderr_summary(earlier + notes + "W0000 gl_context.cc:80] no pixel format\n" + dump)
        self.assertEqual(
            said,
            "notes: mp_faces: the spec read (+0.000 s) ⏎ mp_faces: ffmpeg 812 started, 640x360 at 5 fps (+0.034 s)"
            f"; other: W0000 gl_context.cc:80] no pixel format; stacks: {stacks}",
        )
        self.assertNotIn("Zoë", said)
        self.assertEqual(faces.stderr_summary(""), "")

    def test_the_last_words_of_a_measured_abort(self) -> None:
        log = (
            "W0000 gl_context_nsgl.cc:80] failed to create pixel format; trying without acceleration\n"
            "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.\n"
            "F0000 00:00:1791902123.964178 1639393 graph_service.h:139] Check failed: service_ Service is unavailable.\n"
            "*** Check failure stack trace: ***\n"
            "    @        0x112520fd8  absl::log_internal::LogMessage::SendToLog()\n"
            "    @        0x18b540c1c  thread_start\n"
        )
        self.assertTrue(faces.last_words(log).endswith("Check failed: service_ Service is unavailable."))
        self.assertEqual(faces.last_words("one\ntwo\n"), "two")
        self.assertEqual(faces.last_words(""), "")


if __name__ == "__main__":
    unittest.main()
