"""The salient box for a shot with no face (sidecar/forge_sidecar/capabilities/salient.py, docs/CLIPS.md §4.4).

Run by tests/integration/sidecarMedia.int.test.ts with the helper's own
interpreter when there is one, else CI's bare 3.12. Only what needs numpy says
so and skips ("numpy is not installed", the one reason that suite allows); the
params, the model gate, the per-item errors, the cancel and the fetch run on a
bare interpreter, with BiRefNet's matte and the decode stood in. The model
itself, on real frames, is tests/integration/salient.int.test.ts.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

from forge_sidecar import media
from forge_sidecar.capabilities import depth, salient
from forge_sidecar.rpc import Cancelled, Server, Unavailable

FFMPEG = os.environ.get("FORGE_TEST_FFMPEG", "")
FFPROBE = os.environ.get("FORGE_TEST_FFPROBE", "")
OUT = os.environ.get("FORGE_TEST_OUT") or tempfile.mkdtemp(prefix="forge-salient-")

try:
    import numpy  # noqa: F401

    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

needs_ffmpeg = unittest.skipUnless(FFMPEG and FFPROBE, "FORGE_TEST_FFMPEG and FORGE_TEST_FFPROBE are not set")
needs_numpy = unittest.skipUnless(HAVE_NUMPY, "numpy is not installed")

#: Two files that exist, for the params' ffmpeg/ffprobe check when no frame is decoded.
SOME_FILE = sys.executable


class Recorder:
    """A request's context: records progress, cancels after `cancel_after` checks."""

    def __init__(self, cancel_after: int | None = None) -> None:
        self.seen: list[tuple[float | None, str | None]] = []
        self.checks = 0
        self.cancel_after = cancel_after

    def progress(self, progress: float | None, message: str | None = None) -> None:
        self.seen.append((progress, message))

    def raise_if_cancelled(self) -> None:
        self.checks += 1
        if self.cancel_after is not None and self.checks > self.cancel_after:
            raise Cancelled()


class Hub:
    """Just as much huggingface_hub as media.download and salient ask of it.

    ``cached`` is what the cache holds (a path, or None); a fetch is recorded,
    writes a file and caches it, so a status asked afterwards is answered from
    the stand-in's disk as the real one would be.
    """

    def __init__(self, cached: str | None = None, chunks: int = 0) -> None:
        self.cached = cached
        self.chunks = chunks
        self.asked: list[tuple[str, str, str | None, str | None]] = []
        self.fetched: list[dict[str, object]] = []
        self.updates = 0

    def try_to_load_from_cache(self, repo: str, filename: str, cache_dir: str | None = None, revision: str | None = None) -> object:
        self.asked.append((repo, filename, cache_dir, revision))
        return self.cached

    def hf_hub_download(self, repo: str, filename: str, revision: str | None = None, cache_dir: str | None = None, tqdm_class: type | None = None) -> str:
        self.fetched.append({"repo": repo, "filename": filename, "revision": revision, "cache_dir": cache_dir})
        if tqdm_class is not None and self.chunks:
            bar = tqdm_class(total=self.chunks * 1_000_000, initial=0)
            for _ in range(self.chunks):
                bar.update(1_000_000)
                self.updates += 1
        folder = tempfile.mkdtemp(prefix="forge-hub-")
        self.cached = os.path.join(folder, "model_fp16.onnx")
        with open(self.cached, "wb") as handle:
            handle.write(b"onnx")
        return self.cached

    def module(self) -> types.SimpleNamespace:
        return types.SimpleNamespace(try_to_load_from_cache=self.try_to_load_from_cache, hf_hub_download=self.hf_hub_download)


def params(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "items": [{"path": SOME_FILE, "ms": 0}],
        "ffmpeg": SOME_FILE,
        "ffprobe": SOME_FILE,
        "width": 640,
        "height": 360,
    }
    base.update(over)
    return base


# ------------------------------------------------------------------- params


class Params(unittest.TestCase):
    def refused(self, why: str, **over: object) -> None:
        with self.assertRaises(ValueError, msg=why) as caught:
            salient._checked(params(**over))
        self.assertIn("vision.salient", str(caught.exception), why)

    def test_items_are_a_non_empty_list(self) -> None:
        self.refused("no items", items=None)
        self.refused("an empty list", items=[])
        self.refused("not a list", items={"path": SOME_FILE, "ms": 0})

    def test_each_item_has_a_path_and_ms_of_zero_or_more(self) -> None:
        self.refused("no path", items=[{"ms": 0}])
        self.refused("an empty path", items=[{"path": "", "ms": 0}])
        self.refused("not an object", items=[SOME_FILE])
        self.refused("no ms", items=[{"path": SOME_FILE}])
        self.refused("negative ms", items=[{"path": SOME_FILE, "ms": -1}])
        self.refused("a bool for ms", items=[{"path": SOME_FILE, "ms": True}])
        self.refused("NaN ms", items=[{"path": SOME_FILE, "ms": float("nan")}])
        self.refused("a string for ms", items=[{"path": SOME_FILE, "ms": "500"}])
        # The second item is checked as the first is.
        self.refused("a bad second item", items=[{"path": SOME_FILE, "ms": 0}, {"path": SOME_FILE, "ms": -0.5}])

    def test_ffmpeg_and_ffprobe_are_files(self) -> None:
        self.refused("no ffmpeg", ffmpeg=None)
        self.refused("no ffprobe", ffprobe=None)
        self.refused("a missing ffmpeg", ffmpeg=os.path.join(OUT, "no-such-ffmpeg"))

    def test_the_upright_size_is_two_positive_whole_numbers(self) -> None:
        self.refused("no width", width=None)
        self.refused("zero height", height=0)
        self.refused("a fractional width", width=640.5)
        self.refused("a string height", height="360")

    def test_a_good_set_is_read_as_given(self) -> None:
        items, ffmpeg, ffprobe, width, height = salient._checked(
            params(items=[{"path": SOME_FILE, "ms": 1500.5}, {"path": SOME_FILE, "ms": 0}], width=360.0)
        )
        self.assertEqual(items, [(SOME_FILE, 1500.5), (SOME_FILE, 0)])
        self.assertEqual((ffmpeg, ffprobe, width, height), (SOME_FILE, SOME_FILE, 360, 360))
        self.assertIsInstance(width, int)

    def test_bad_params_fail_before_the_model_is_asked_about(self) -> None:
        hub = Hub()
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}):
            with self.assertRaises(ValueError):
                salient.salient(params(items=[]), Recorder())
        self.assertEqual(hub.asked, [])


# --------------------------------------------------------------- the model


class TheModelGate(unittest.TestCase):
    """The work never downloads; the …Model method answers, and fetches only on download: true."""

    def setUp(self) -> None:
        self.models = tempfile.mkdtemp(prefix="forge-models-")
        env = mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": self.models})
        env.start()
        self.addCleanup(env.stop)

    def test_the_work_is_unavailable_without_the_model_and_fetches_nothing(self) -> None:
        hub = Hub(cached=None)
        decoded: list[object] = []
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}), \
                mock.patch.object(media, "decode_rgb", side_effect=lambda *a, **k: decoded.append(a)):
            with self.assertRaises(Unavailable) as caught:
                salient.salient(params(), Recorder())
        self.assertEqual(str(caught.exception), "the subject finder is not downloaded yet (115 MB from huggingface.co)")
        self.assertEqual(hub.fetched, [])
        self.assertEqual(decoded, [])
        # It asked the cache the question media.download asks, at the pinned commit, in FORGE_MODELS_DIR.
        self.assertEqual(hub.asked, [(depth.MATTE_REPO, "onnx/model_fp16.onnx", self.models, depth.MATTE_REVISION)])

    def test_the_status_without_download_only_answers(self) -> None:
        hub = Hub(cached=None)
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}):
            for asked in ({}, {"download": False}, {"download": "yes"}, {"download": 1}):
                self.assertEqual(
                    salient.model(asked, Recorder()),
                    {"present": False, "bytes": 114_538_221, "label": "the subject finder", "host": "huggingface.co"},
                    asked,
                )
        self.assertEqual(hub.fetched, [])

    def test_a_cache_entry_that_is_not_a_file_is_not_the_model(self) -> None:
        hub = Hub(cached=os.path.join(self.models, "gone.onnx"))
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}):
            self.assertFalse(salient.model({}, Recorder())["present"])

    def test_download_true_fetches_the_pinned_file_then_answers_present(self) -> None:
        hub = Hub(cached=None, chunks=3)
        context = Recorder()
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}):
            status = salient.model({"download": True}, context)
            self.assertTrue(status["present"])
            # Present now: a second press fetches nothing.
            salient.model({"download": True}, Recorder())
        self.assertEqual(
            hub.fetched,
            [{"repo": depth.MATTE_REPO, "filename": "onnx/model_fp16.onnx", "revision": depth.MATTE_REVISION, "cache_dir": self.models}],
        )
        # The bytes are the request's progress, labelled with what is coming.
        self.assertEqual(context.seen[-1], (1.0, "downloading the subject finder (3 MB, first run only)"))

    def test_a_cancel_stops_the_fetch_between_chunks(self) -> None:
        hub = Hub(cached=None, chunks=50)
        # The first check is the progress bar's opening report; cancel two percent later.
        context = Recorder(cancel_after=3)
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub.module()}):
            with self.assertRaises(Cancelled):
                salient.model({"download": True}, context)
        self.assertLess(hub.updates, 50)
        self.assertEqual(hub.updates, 2)


# --------------------------------------------------------------- the rule


@needs_numpy
class CoverageRule(unittest.TestCase):
    """The rule a bake's subjectBox follows (depth.py:461-474), on made-up mattes."""

    def matte(self, rows: int, cols: int, *blocks: tuple[int, int, int, int], value: float = 1.0) -> "object":
        import numpy as np

        soft = np.zeros((rows, cols), dtype=np.float32)
        for top, left, height, width in blocks:
            soft[top:top + height, left:left + width] = value
        return soft

    def test_under_one_percent_is_a_speck(self) -> None:
        coverage, box = salient._subject(self.matte(100, 100, (20, 40, 9, 10)))  # 90 px, 0.9 %
        self.assertEqual(coverage, 0.009)
        self.assertIsNone(box)

    def test_one_percent_is_a_subject(self) -> None:
        coverage, box = salient._subject(self.matte(100, 100, (20, 40, 10, 10)))  # 100 px, 1 %
        self.assertEqual(coverage, 0.01)
        self.assertEqual(box, {"x": 0.4, "y": 0.2, "width": 0.1, "height": 0.1})

    def test_ninety_two_percent_is_still_a_subject(self) -> None:
        coverage, box = salient._subject(self.matte(100, 100, (0, 0, 92, 100)))  # 9,200 px
        self.assertEqual(coverage, 0.92)
        self.assertIsNotNone(box)

    def test_ninety_three_percent_is_the_whole_picture(self) -> None:
        coverage, box = salient._subject(self.matte(100, 100, (0, 0, 93, 100)))  # 9,300 px
        self.assertEqual(coverage, 0.93)
        self.assertIsNone(box)

    def test_the_cut_is_above_one_half(self) -> None:
        # A matte at exactly 0.5 everywhere is no subject; just above, it is all subject.
        self.assertEqual(salient._subject(self.matte(100, 100, (0, 0, 100, 100), value=0.5)), (0.0, None))
        self.assertEqual(salient._subject(self.matte(100, 100, (0, 0, 100, 100), value=0.51)), (1.0, None))

    def test_the_box_is_trimmed_at_one_percent(self) -> None:
        # The subject, and a wisp of 1 px a row (under 1 % of the busiest row's 200) trailing below it, apart.
        soft = self.matte(300, 400, (40, 100, 20, 200), (100, 200, 80, 1))
        coverage, box = salient._subject(soft)
        self.assertEqual(coverage, round(4080 / 120_000, 4))
        # The box is the subject's alone: x 100..299, y 40..59.
        self.assertEqual(box, {"x": 0.25, "y": 0.1333, "width": 0.5, "height": 0.0667})


# ---------------------------------------------------------- items and errors


def stand_ins(test: unittest.TestCase, coverage: float = 0.05) -> list[tuple[str, float | None]]:
    """The decode and the matte stood in, so the item loop runs with nothing installed.

    Returns the list of (path, at_ms) each decode was asked for.
    """
    decoded: list[tuple[str, float | None]] = []
    box = {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}

    def decode(path: str, _ffmpeg: str, width: int, height: int, at_ms: float | None = None) -> str:
        test.assertEqual((width, height), (depth.MATTE_SIZE, depth.MATTE_SIZE))
        if path.endswith("past-the-end.mp4"):
            raise ValueError("Decoded 0 bytes, expected 3145728 for 1024x1024")
        decoded.append((path, at_ms))
        return "rgb"

    for patch in (
        mock.patch.object(salient, "_model_path", return_value="/models/model_fp16.onnx"),
        mock.patch.object(media, "decode_rgb", side_effect=decode),
        mock.patch.object(depth, "_matte_of", side_effect=lambda rgb, variant, context=None: ("soft", rgb, variant)),
        mock.patch.object(salient, "_subject", side_effect=lambda soft: (coverage, dict(box))),
    ):
        patch.start()
        test.addCleanup(patch.stop)
    return decoded


_made: dict[str, str] = {}


def fixture(name: str) -> str:
    if name in _made:
        return _made[name]
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    run = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    if name == "salient-wide.mp4":
        subprocess.run([*run, "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1",
                        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path], check=True)
    elif name == "salient-turned.mp4":
        subprocess.run([*run, "-i", fixture("salient-wide.mp4"), "-c", "copy", "-metadata:s:v:0", "rotate=90", path], check=True)
    else:
        raise KeyError(name)
    _made[name] = path
    return path


@needs_ffmpeg
class Items(unittest.TestCase):
    """One unreadable or mis-sized file costs its own items, never the call."""

    def test_a_size_mismatch_is_that_items_error_and_the_rest_are_answered(self) -> None:
        wide, turned = fixture("salient-wide.mp4"), fixture("salient-turned.mp4")
        decoded = stand_ins(self)
        probed: list[str] = []
        real = media.require_upright

        def require(path: str, *rest: object) -> object:
            probed.append(path)
            return real(path, *rest)

        missing = os.path.join(OUT, "salient-missing.mp4")
        with mock.patch.object(media, "require_upright", side_effect=require):
            result = salient.salient({
                "items": [
                    {"path": wide, "ms": 100},
                    {"path": turned, "ms": 200},
                    {"path": wide, "ms": 300},
                    {"path": missing, "ms": 400},
                    {"path": turned, "ms": 500},
                    {"path": wide, "ms": 600},
                ],
                "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 640, "height": 360,
            }, Recorder())

        answers = result["results"]
        self.assertEqual([a["ms"] for a in answers], [100, 200, 300, 400, 500, 600])
        for at in (0, 2, 5):
            self.assertEqual(answers[at], {"ms": answers[at]["ms"], "box": {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}, "coverage": 0.05})
        # The turned clip is 360x640 upright: both its items say so, from one probe.
        for at in (1, 4):
            self.assertNotIn("box", answers[at])
            self.assertIn("360×640 upright", answers[at]["error"])
        self.assertIn("No such file", answers[3]["error"])
        self.assertEqual(probed.count(turned), 1)
        self.assertEqual(probed.count(wide), 1)
        # Only the answered items were decoded, each at its own time.
        self.assertEqual(decoded, [(wide, 100), (wide, 300), (wide, 600)])

    def test_a_frame_that_cannot_be_decoded_is_that_items_error(self) -> None:
        wide = fixture("salient-wide.mp4")
        past = os.path.join(OUT, "past-the-end.mp4")
        with open(wide, "rb") as source, open(past, "wb") as copy:
            copy.write(source.read())
        stand_ins(self)
        result = salient.salient({
            "items": [{"path": past, "ms": 99_000}, {"path": wide, "ms": 0}],
            "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 640, "height": 360,
        }, Recorder())
        self.assertEqual(result["results"][0], {"ms": 99_000, "error": "Decoded 0 bytes, expected 3145728 for 1024x1024"})
        self.assertIn("box", result["results"][1])

    def test_a_cancel_is_checked_between_items(self) -> None:
        wide = fixture("salient-wide.mp4")
        decoded = stand_ins(self)
        context = Recorder(cancel_after=2)
        with self.assertRaises(Cancelled):
            salient.salient({
                "items": [{"path": wide, "ms": ms} for ms in (0, 100, 200, 300, 400)],
                "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 640, "height": 360,
            }, context)
        self.assertEqual([ms for _, ms in decoded], [0, 100])

    def test_progress_runs_from_nothing_to_whole_one_item_at_a_time(self) -> None:
        wide = fixture("salient-wide.mp4")
        stand_ins(self)
        context = Recorder()
        salient.salient({
            "items": [{"path": wide, "ms": ms} for ms in (0, 100, 200, 300)],
            "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "width": 640, "height": 360,
        }, context)
        self.assertEqual([p for p, _ in context.seen], [0.0, 0.25, 0.5, 0.75, 1.0])
        self.assertEqual({m for _, m in context.seen}, {"finding the subject"})


# ---------------------------------------------------------------- the lock


@needs_numpy
class OneSession(unittest.TestCase):
    """Two calls at once build one BiRefNet session: depth's, made under depth's lock."""

    def test_two_concurrent_calls_build_one_session(self) -> None:
        import numpy as np

        built: list[str] = []

        class Session:
            def __init__(self, path: str, _options: object, providers: list[str]) -> None:
                built.append(path)
                time.sleep(0.3)  # long enough for the other call to arrive while this one builds

            def get_inputs(self) -> list[types.SimpleNamespace]:
                return [types.SimpleNamespace(name="input_image")]

            def run(self, _names: object, feeds: dict[str, object]) -> list[object]:
                return [np.zeros((1, 1, depth.MATTE_SIZE, depth.MATTE_SIZE), dtype=np.float32)]

        ort = types.SimpleNamespace(SessionOptions=lambda: types.SimpleNamespace(), InferenceSession=Session)
        frame = np.zeros((depth.MATTE_SIZE, depth.MATTE_SIZE, 3), dtype=np.uint8)
        gate = threading.Barrier(2)
        answers: list[object] = []

        def call() -> None:
            gate.wait()
            answers.append(salient.salient(params(), Recorder()))

        with mock.patch.dict(sys.modules, {"onnxruntime": ort}), \
                mock.patch.dict(depth._sessions, clear=True), \
                mock.patch.object(salient, "_model_path", return_value="/models/model_fp16.onnx"), \
                mock.patch.object(media, "download", return_value="/models/model_fp16.onnx"), \
                mock.patch.object(media, "require_upright", return_value={}), \
                mock.patch.object(media, "decode_rgb", return_value=frame):
            threads = [threading.Thread(target=call) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)
        self.assertEqual(len(answers), 2)
        self.assertEqual(built, ["/models/model_fp16.onnx"])


# ---------------------------------------------------------- registration


class Registration(unittest.TestCase):
    def test_registers_both_methods_when_its_dependencies_import(self) -> None:
        present = {name: types.ModuleType(name) for name in ("numpy", "onnxruntime", "scipy")}
        present["huggingface_hub"] = Hub().module()  # type: ignore[assignment]
        server = Server()
        with mock.patch.dict(sys.modules, present):
            salient.register(server)
        self.assertEqual(server.capabilities, ["vision.salient", "vision.salientModel"])

    def test_a_missing_dependency_is_unavailable_by_name(self) -> None:
        for missing in ("numpy", "onnxruntime", "scipy", "huggingface_hub"):
            modules: dict[str, object] = {name: types.ModuleType(name) for name in ("numpy", "onnxruntime", "scipy")}
            modules["huggingface_hub"] = Hub().module()
            modules[missing] = None  # an import of a None entry raises ImportError
            server = Server()
            with mock.patch.dict(sys.modules, modules):
                with self.assertRaises(Unavailable, msg=missing) as caught:
                    salient.register(server)
            self.assertIn("subject finder dependencies are not installed", str(caught.exception))
            self.assertIn(missing, str(caught.exception))
            self.assertEqual(server.capabilities, [], missing)


if __name__ == "__main__":
    unittest.main()
