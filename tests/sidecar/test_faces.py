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

import hashlib
import importlib.machinery
import json
import os
import pathlib
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
            (faces.FAKE_ENV, faces.EXIT_INPUT, faces.EXIT_IMPORT),
            (mp_faces.FAKE_ENV, mp_faces.EXIT_INPUT, mp_faces.EXIT_IMPORT),
        )

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

        with mock.patch.object(mp_faces.media, "iter_frames", side_effect=frames), \
                mock.patch.object(mp_faces, "_colour_detector", return_value=lambda _frame, _ms: []), \
                mock.patch.object(mp_faces, "_say"):
            code = mp_faces.run(self.spec, mock.Mock(ended=False), {mp_faces.FAKE_ENV: "colour"})
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
        # The worker's: the stubs first, then the package's folder, then what the helper had.
        parts = command["env"]["PYTHONPATH"].split(os.pathsep)
        self.assertEqual(parts[:2], [faces.STUBS_DIR, faces.PACKAGE_PARENT])
        self.assertEqual(command["argv"][1:], ["-m", "forge_sidecar.workers.mp_faces"])
        self.assertTrue(os.path.isfile(os.path.join(faces.STUBS_DIR, "cv2", "__init__.py")))
        self.assertTrue(os.path.isfile(os.path.join(faces.STUBS_DIR, "matplotlib", "pyplot.py")))

    def test_an_inherited_pythonpath_comes_after_the_stubs(self) -> None:
        env = faces.worker_env({"PYTHONPATH": "/somewhere", "FORGE_CACHE_DIR": "/c"})
        self.assertEqual(env["PYTHONPATH"].split(os.pathsep), [faces.STUBS_DIR, faces.PACKAGE_PARENT, "/somewhere"])
        self.assertEqual(env["FORGE_CACHE_DIR"], "/c")


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
        with mock.patch.dict(os.environ, {"FORGE_CACHE_DIR": cache}), \
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
        # -6 (SIGABRT) on macOS and Linux; abort() exits 3 on Windows.
        code = 3 if os.name == "nt" else -6
        self.assertIn(f"the face detector stopped (code {code})", str(caught.exception))
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
