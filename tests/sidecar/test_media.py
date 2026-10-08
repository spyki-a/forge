"""The helper's shared media code (sidecar/forge_sidecar/media.py, docs/CLIPS.md §3.6).

Run by tests/integration/sidecarMedia.int.test.ts with the helper's own
interpreter when there is one (sidecar/.venv), else the bare one CI installs —
so everything that needs numpy says so and skips, and everything else must
pass on an interpreter with nothing installed. Fixtures are made with the
bundled ffmpeg the suite hands over (FORGE_TEST_FFMPEG, FORGE_TEST_FFPROBE) and
left in FORGE_TEST_OUT, beside the other render checks' artefacts.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import hashlib
import importlib
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

from forge_sidecar import media
from forge_sidecar.rpc import Cancelled, Server

FFMPEG = os.environ.get("FORGE_TEST_FFMPEG", "")
FFPROBE = os.environ.get("FORGE_TEST_FFPROBE", "")
OUT = os.environ.get("FORGE_TEST_OUT") or tempfile.mkdtemp(prefix="forge-media-")

try:
    import numpy  # noqa: F401

    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

needs_ffmpeg = unittest.skipUnless(FFMPEG and FFPROBE, "FORGE_TEST_FFMPEG and FORGE_TEST_FFPROBE are not set")
needs_numpy = unittest.skipUnless(HAVE_NUMPY, "numpy is not installed")


def ffmpeg(*args: str) -> None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


_made: dict[str, str] = {}


def fixture(name: str) -> str:
    """Each fixture once per run, into FORGE_TEST_OUT."""
    if name in _made:
        return _made[name]
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    encode = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    if name == "still.png":
        ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=1", "-frames:v", "1", path)
    elif name == "plain.mp4":
        # 2 s at 30 fps: red for the first second, blue for the second.
        ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=1",
               "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=1",
               "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", *encode, path)
    elif name == "pattern.mp4":
        ffmpeg("-loop", "1", "-framerate", "30", "-i", fixture("still.png"), "-t", "1", *encode, path)
    elif name == "rot90.mp4":
        ffmpeg("-i", fixture("pattern.mp4"), "-c", "copy", "-metadata:s:v:0", "rotate=90", path)
    elif name == "rot180.mp4":
        ffmpeg("-i", fixture("pattern.mp4"), "-c", "copy", "-metadata:s:v:0", "rotate=180", path)
    elif name == "long.mp4":
        ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=20", *encode, path)
    else:
        raise KeyError(name)
    _made[name] = path
    return path


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


# ------------------------------------------------------------------ probing


class DisplayRotation(unittest.TestCase):
    def test_matrix_angle_negated_and_folded(self) -> None:
        def turn(angle: object) -> int:
            return media.display_rotation({"side_data_list": [{"side_data_type": "Display Matrix", "rotation": angle}]})

        self.assertEqual(turn(90), 270)
        self.assertEqual(turn(-90), 90)
        self.assertEqual(turn(180), 180)
        self.assertEqual(turn("-90"), 90)
        self.assertEqual(turn(-89.6), 90)
        self.assertEqual(turn(45), 315)

    def test_the_tag_alone_is_not_a_turn(self) -> None:
        self.assertEqual(media.display_rotation({"tags": {"rotate": "90"}}), 0)
        self.assertEqual(media.display_rotation({}), 0)


@needs_ffmpeg
class ProbeUpright(unittest.TestCase):
    def test_an_untagged_clip_is_as_coded(self) -> None:
        probed = media.probe_upright(fixture("plain.mp4"), FFPROBE)
        self.assertEqual((probed["width"], probed["height"], probed["rotation"]), (640, 360, 0))
        self.assertAlmostEqual(probed["durationMs"], 2000, delta=40)
        self.assertAlmostEqual(probed["fps"], 30, places=3)

    def test_a_90_remux_is_upright(self) -> None:
        probed = media.probe_upright(fixture("rot90.mp4"), FFPROBE)
        self.assertEqual((probed["width"], probed["height"]), (360, 640))
        self.assertIn(probed["rotation"], (90, 270))

    def test_a_half_turn_keeps_its_sides(self) -> None:
        probed = media.probe_upright(fixture("rot180.mp4"), FFPROBE)
        self.assertEqual((probed["width"], probed["height"], probed["rotation"]), (640, 360, 180))

    def test_a_still_has_no_duration_or_rate(self) -> None:
        probed = media.probe_upright(fixture("still.png"), FFPROBE)
        self.assertEqual(probed, {"width": 640, "height": 360, "rotation": 0, "durationMs": None, "fps": None})

    def test_require_upright_refuses_the_coded_size(self) -> None:
        path = fixture("rot90.mp4")
        self.assertEqual(media.require_upright(path, FFPROBE, 360, 640)["width"], 360)
        with self.assertRaises(media.SizeMismatch) as caught:
            media.require_upright(path, FFPROBE, 640, 360)
        self.assertIn("360×640 upright", str(caught.exception))


# ----------------------------------------------------------------- decoding


@needs_ffmpeg
@needs_numpy
class Decode(unittest.TestCase):
    def test_one_frame_at_a_time_from_before_the_input(self) -> None:
        path = fixture("plain.mp4")
        early = media.decode_rgb(path, FFMPEG, 64, 36, at_ms=500)
        late = media.decode_rgb(path, FFMPEG, 64, 36, at_ms=1500)
        self.assertEqual(early.shape, (36, 64, 3))
        self.assertGreater(int(early[18, 32, 0]), 200)  # red
        self.assertGreater(int(late[18, 32, 2]), 200)  # blue

    def test_a_still_is_never_seeked(self) -> None:
        # Any -ss before a JPEG decodes nothing; at_ms=0 must still answer.
        jpeg = os.path.join(OUT, "still.jpg")
        ffmpeg("-i", fixture("still.png"), jpeg)
        self.assertEqual(media.decode_rgb(jpeg, FFMPEG, 64, 36, at_ms=0).shape, (36, 64, 3))

    def test_the_turned_clip_decodes_at_its_upright_size_and_the_right_way_round(self) -> None:
        import numpy as np

        probed = media.probe_upright(fixture("rot90.mp4"), FFPROBE)
        turned = media.decode_rgb(fixture("rot90.mp4"), FFMPEG, probed["width"] // 2, probed["height"] // 2)
        coded = media.decode_rgb(fixture("pattern.mp4"), FFMPEG, 320, 180)
        self.assertEqual(turned.shape, (320, 180, 3))
        # The decoder turned it counter-clockwise (transpose=cclock), np.rot90's
        # direction: measured 1.95 against the coded frame turned that way, and
        # 206 the other way (scaled before the turn rather than after, hence not 0).
        difference = np.abs(turned.astype(int) - np.rot90(coded).astype(int)).mean()
        self.assertLess(difference, 6)


def spawned() -> tuple[list[subprocess.Popen], object]:
    """Every decoder iter_frames starts, kept so a test can see it was killed and reaped."""
    made: list[subprocess.Popen] = []
    real = subprocess.Popen

    def spy(*args: object, **kwargs: object) -> subprocess.Popen:
        process = real(*args, **kwargs)
        made.append(process)
        return process

    return made, mock.patch.object(media.subprocess, "Popen", side_effect=spy)


@needs_ffmpeg
@needs_numpy
class IterFrames(unittest.TestCase):
    def test_counts_and_times(self) -> None:
        path = fixture("plain.mp4")
        frames = list(media.iter_frames(path, FFMPEG, 5, 64, 36))
        self.assertEqual([ms for ms, _ in frames], list(range(0, 2000, 200)))
        self.assertTrue(all(frame.shape == (36, 64, 3) for _, frame in frames))
        window = list(media.iter_frames(path, FFMPEG, 5, 64, 36, start_ms=500, end_ms=1500))
        self.assertEqual([ms for ms, _ in window], [500, 700, 900, 1100, 1300])
        # The window's frames are the source's: red before the cut at 1 s, blue after.
        self.assertGreater(int(window[0][1][18, 32, 0]), 200)
        self.assertGreater(int(window[-1][1][18, 32, 2]), 200)

    def test_a_cancel_kills_the_decoder(self) -> None:
        path = fixture("long.mp4")
        made, patch = spawned()
        context = Recorder(cancel_after=3)
        started = time.monotonic()
        with patch:
            got = []
            with self.assertRaises(Cancelled):
                for item in media.iter_frames(path, FFMPEG, 30, 640, 360, context=context):
                    got.append(item[0])
        elapsed = time.monotonic() - started
        self.assertEqual(len(got), 3)
        self.assertEqual(len(made), 1)
        # Killed and reaped, not left to decode 20 s of video nobody reads.
        self.assertIsNotNone(made[0].returncode)
        self.assertNotEqual(made[0].returncode, 0)
        self.assertLess(elapsed, 5)

    def test_stopping_early_kills_the_decoder(self) -> None:
        path = fixture("long.mp4")
        made, patch = spawned()
        with patch:
            frames = media.iter_frames(path, FFMPEG, 30, 640, 360)
            for count, _ in enumerate(frames, start=1):
                if count == 50:
                    break
            frames.close()
        self.assertIsNotNone(made[0].returncode)
        self.assertNotEqual(made[0].returncode, 0)


class _Frame:
    """What ``np.frombuffer(chunk, dtype=np.uint8).reshape(h, w, 3)`` gives
    iter_frames, without numpy: the frame's bytes, and the shape asked for."""

    def __init__(self, data: bytes) -> None:
        self.data = bytes(data)
        self.shape: tuple[int, ...] = (len(self.data),)

    def reshape(self, *shape: int) -> "_Frame":
        self.shape = shape
        return self


#: Just as much numpy as iter_frames uses, so its stream runs where numpy is absent.
BYTES_NUMPY = types.SimpleNamespace(uint8="uint8", frombuffer=lambda data, dtype: _Frame(data))


def rgb_at(data: bytes, width: int, x: int, y: int, frame: int = 0, height: int = 0) -> tuple[int, int, int]:
    """One pixel of raw rgb24 bytes — frame ``frame`` of a stream of ``width``×``height`` frames."""
    at = frame * width * height * 3 + (y * width + x) * 3
    return data[at], data[at + 1], data[at + 2]


@needs_ffmpeg
class DecodeWithoutNumpy(unittest.TestCase):
    """The decodes again, on an interpreter with nothing installed.

    CI's helper interpreter is a bare 3.12 (no ``pip install``), so the numpy
    cases above skip there — and that run is the only one on the 2018 Windows
    ffmpeg. These hand the helper's own argv (``decode_args``, ``frame_args``)
    to the bundled ffmpeg and read the bytes, and run ``iter_frames`` itself
    with a stand-in numpy, so the seek before ``-i``, the ``fps=5`` count,
    the turned clip's decode and cancel → kill are measured on that build too
    (docs/CLIPS.md §3.6). On the venv they run beside the numpy cases.
    """

    W, H = 64, 36

    def bytes_of(self, argv: list[str]) -> bytes:
        result = subprocess.run(argv, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        return result.stdout

    def test_one_frame_seeked_from_before_the_input(self) -> None:
        path = fixture("plain.mp4")
        early = self.bytes_of(media.decode_args(path, FFMPEG, self.W, self.H, at_ms=500))
        late = self.bytes_of(media.decode_args(path, FFMPEG, self.W, self.H, at_ms=1500))
        self.assertEqual(len(early), self.W * self.H * 3)
        self.assertEqual(len(late), self.W * self.H * 3)
        # Measured on the Mac's 4.4: (252, 0, 0) and (0, 0, 253).
        red, _, blue = rgb_at(early, self.W, 32, 18)
        self.assertGreater(red, 200)
        self.assertLess(blue, 60)
        red, _, blue = rgb_at(late, self.W, 32, 18)
        self.assertGreater(blue, 200)
        self.assertLess(red, 60)

    def test_a_jpeg_at_zero_is_one_frame(self) -> None:
        jpeg = os.path.join(OUT, "still-bare.jpg")
        ffmpeg("-i", fixture("still.png"), jpeg)
        self.assertEqual(len(self.bytes_of(media.decode_args(jpeg, FFMPEG, self.W, self.H, at_ms=0))), self.W * self.H * 3)

    def test_the_turned_clip_decodes_upright_and_counter_clockwise(self) -> None:
        probed = media.probe_upright(fixture("rot90.mp4"), FFPROBE)
        self.assertEqual((probed["width"], probed["height"]), (360, 640))
        w, h = probed["width"] // 2, probed["height"] // 2  # 180×320, as the decoder delivers it
        turned = self.bytes_of(media.decode_args(fixture("rot90.mp4"), FFMPEG, w, h))
        coded = self.bytes_of(media.decode_args(fixture("pattern.mp4"), FFMPEG, h, w))  # 320×180, as stored
        self.assertEqual(len(turned), w * h * 3)

        def against(clockwise: bool) -> float:
            # Row i, column j of the turned frame, from the coded one (h wide, w tall).
            total = 0
            for i in range(h):
                for j in range(w):
                    source = ((w - 1 - j) * h + i) if clockwise else (j * h + (h - 1 - i))
                    for k in range(3):
                        total += abs(turned[(i * w + j) * 3 + k] - coded[source * 3 + k])
            return total / (w * h * 3)

        # Measured 1.95 counter-clockwise (transpose=cclock, np.rot90's way) and
        # 206 clockwise; not 0 because the turn comes after the scale here.
        self.assertLess(against(clockwise=False), 6)
        self.assertGreater(against(clockwise=True), 100)

    def test_the_stream_is_five_frames_a_second(self) -> None:
        path = fixture("plain.mp4")
        frame = self.W * self.H * 3
        whole = self.bytes_of(media.frame_args(path, FFMPEG, 5, self.W, self.H))
        self.assertEqual(len(whole), 10 * frame)  # 2 s at fps=5
        window = self.bytes_of(media.frame_args(path, FFMPEG, 5, self.W, self.H, 500, 1500))
        self.assertEqual(len(window), 5 * frame)  # 500, 700, 900, 1100, 1300
        # From the source's own times: red before the cut at 1 s, blue after.
        self.assertGreater(rgb_at(window, self.W, 32, 18, 0, self.H)[0], 200)
        self.assertGreater(rgb_at(window, self.W, 32, 18, 2, self.H)[0], 200)
        self.assertGreater(rgb_at(window, self.W, 32, 18, 3, self.H)[2], 200)
        self.assertGreater(rgb_at(window, self.W, 32, 18, 4, self.H)[2], 200)

    def test_iter_frames_streams_with_nothing_installed(self) -> None:
        path = fixture("plain.mp4")
        with mock.patch.dict(sys.modules, {"numpy": BYTES_NUMPY}):
            frames = list(media.iter_frames(path, FFMPEG, 5, self.W, self.H))
            window = list(media.iter_frames(path, FFMPEG, 5, self.W, self.H, start_ms=500, end_ms=1500))
        self.assertEqual([ms for ms, _ in frames], list(range(0, 2000, 200)))
        self.assertTrue(all(len(f.data) == self.W * self.H * 3 and f.shape == (self.H, self.W, 3) for _, f in frames))
        self.assertEqual([ms for ms, _ in window], [500, 700, 900, 1100, 1300])
        self.assertGreater(rgb_at(window[0][1].data, self.W, 32, 18)[0], 200)
        self.assertGreater(rgb_at(window[-1][1].data, self.W, 32, 18)[2], 200)

    def test_a_cancel_kills_the_decoder_with_nothing_installed(self) -> None:
        path = fixture("long.mp4")  # made before the spy, so only the decoder is counted
        made, patch = spawned()
        context = Recorder(cancel_after=3)
        got = []
        started = time.monotonic()
        with patch, mock.patch.dict(sys.modules, {"numpy": BYTES_NUMPY}):
            with self.assertRaises(Cancelled):
                for ms, _ in media.iter_frames(path, FFMPEG, 30, 640, 360, context=context):
                    got.append(ms)
        self.assertEqual(len(got), 3)
        self.assertEqual(len(made), 1)
        self.assertIsNotNone(made[0].returncode)
        self.assertNotEqual(made[0].returncode, 0)
        self.assertLess(time.monotonic() - started, 5)

    def test_stopping_early_kills_the_decoder_with_nothing_installed(self) -> None:
        path = fixture("long.mp4")
        made, patch = spawned()
        with patch, mock.patch.dict(sys.modules, {"numpy": BYTES_NUMPY}):
            frames = media.iter_frames(path, FFMPEG, 30, 640, 360)
            for count, _ in enumerate(frames, start=1):
                if count == 50:
                    break
            frames.close()
        self.assertIsNotNone(made[0].returncode)
        self.assertNotEqual(made[0].returncode, 0)


class FrameArgs(unittest.TestCase):
    def test_the_seek_is_before_the_input_and_the_span_after(self) -> None:
        argv = media.frame_args("in.mp4", "ffmpeg", 5, 64, 36, 1500, 2500)
        self.assertLess(argv.index("-ss"), argv.index("-i"))
        self.assertGreater(argv.index("-t"), argv.index("-i"))
        self.assertEqual(argv[argv.index("-ss") + 1], "1.500")
        self.assertEqual(argv[argv.index("-t") + 1], "1.000")
        self.assertNotIn("-ss", media.frame_args("in.mp4", "ffmpeg", 5, 64, 36))


# ------------------------------------------------------------------ folders


class Folders(unittest.TestCase):
    def test_models_dir(self) -> None:
        with mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": "/somewhere/models"}):
            self.assertEqual(media.models_dir(), "/somewhere/models")
        env = {k: v for k, v in os.environ.items() if k != "FORGE_MODELS_DIR"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(media.models_dir(), os.path.join(os.path.expanduser("~"), ".cache", "forge", "models"))

    def test_cache_dir_honours_the_variable(self) -> None:
        with mock.patch.dict(os.environ, {"FORGE_CACHE_DIR": os.path.join("x", "helper-cache")}):
            self.assertEqual(media.cache_dir("parallax"), os.path.join("x", "helper-cache", "parallax"))
            self.assertEqual(media.cache_dir("faces"), os.path.join("x", "helper-cache", "faces"))
        env = {k: v for k, v in os.environ.items() if k != "FORGE_CACHE_DIR"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(media.cache_dir("parallax"), os.path.join(os.path.expanduser("~"), ".cache", "forge", "parallax"))

    def test_cache_dir_is_one_folder_name(self) -> None:
        for bad in ("", ".", "..", "a/b", "a\\b", "c:d"):
            with self.assertRaises(ValueError, msg=bad):
                media.cache_dir(bad)

    def test_parallax_bakes_go_where_the_app_says(self) -> None:
        # depth.py imports nothing heavy at module level, so this runs on a bare interpreter.
        depth = importlib.import_module("forge_sidecar.capabilities.depth")
        with mock.patch.dict(os.environ, {"FORGE_CACHE_DIR": os.path.join("user", "data", "helper-cache")}):
            self.assertEqual(depth._cache_dir(), os.path.join("user", "data", "helper-cache", "parallax"))


# ---------------------------------------------------------------- downloads


class Downloads(unittest.TestCase):
    def test_a_revision_must_be_a_commit(self) -> None:
        # Refused before anything is asked of the Hub. A stand-in
        # huggingface_hub records any call, so the guard is tested offline,
        # installed or not: with the real one, a loose revision let through
        # went to huggingface.co and was caught only by the Hub's 401.
        calls: list[str] = []

        def recorded(name: str) -> object:
            def call(*_args: object, **_kwargs: object) -> None:
                calls.append(name)
                raise AssertionError(f"{name} was asked for a loose revision")

            return call

        hub = types.SimpleNamespace(
            hf_hub_download=recorded("hf_hub_download"),
            try_to_load_from_cache=recorded("try_to_load_from_cache"),
        )
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub}):
            for loose in ("main", "v1.0", "4472b73", None):
                with self.assertRaises(ValueError, msg=str(loose)):
                    media.download("org/repo", "model.onnx", loose, None, "a model")  # type: ignore[arg-type]
        self.assertEqual(calls, [])

    def test_byte_progress_lands_inside_the_span(self) -> None:
        context = Recorder()
        bar = media.progress_class(context, "the depth model", (0.2, 0.3))(total=27_258_801, initial=0, unit="B", desc="x")
        with bar:
            for _ in range(27):
                bar.update(1_000_000)
            bar.update(258_801)
        fractions = [p for p, _ in context.seen]
        self.assertEqual(fractions[0], 0.2)
        self.assertAlmostEqual(fractions[-1], 0.3)
        self.assertEqual(fractions, sorted(fractions))
        self.assertTrue(all(0.2 <= f <= 0.3 for f in fractions))
        self.assertLessEqual(len(fractions), 101)
        self.assertEqual(context.seen[-1][1], "downloading the depth model (27 MB, first run only)")

    def test_no_total_is_one_message_without_a_fraction(self) -> None:
        context = Recorder()
        bar = media.progress_class(context, "a file")(total=None)
        bar.update(10)
        bar.update(10)
        self.assertEqual(context.seen, [(None, "downloading a file (first run only)")])


class FetchUrl(unittest.TestCase):
    def setUp(self) -> None:
        self.models = tempfile.mkdtemp(prefix="forge-models-")
        self.addCleanup(shutil.rmtree, self.models, True)
        self.source = os.path.join(self.models, "source model.tflite")
        with open(self.source, "wb") as handle:
            handle.write(os.urandom(300_000))
        with open(self.source, "rb") as handle:
            self.sha = hashlib.sha256(handle.read()).hexdigest()
        self.url = pathlib.Path(self.source).as_uri()

    def test_kept_under_its_hash_once_it_matches(self) -> None:
        with mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": self.models}):
            path = media.fetch_url(self.url, self.sha, Recorder(), "the face model")
            self.assertEqual(os.path.dirname(path), os.path.join(self.models, "files"))
            self.assertTrue(os.path.basename(path).startswith(self.sha[:16] + "-"))
            with open(path, "rb") as handle:
                self.assertEqual(hashlib.sha256(handle.read()).hexdigest(), self.sha)
            # Kept: a second ask does not fetch again.
            os.remove(self.source)
            self.assertEqual(media.fetch_url(self.url, self.sha, None, "the face model"), path)

    def test_a_wrong_hash_keeps_nothing(self) -> None:
        with mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": self.models}):
            with self.assertRaises(ValueError):
                media.fetch_url(self.url, "0" * 64, None, "the face model")
            folder = os.path.join(self.models, "files")
            self.assertEqual(os.listdir(folder) if os.path.isdir(folder) else [], [])


# ------------------------------------------------------------- registration


class Registration(unittest.TestCase):
    def test_a_module_that_fails_part_way_is_withdrawn_whole(self) -> None:
        from forge_sidecar import capabilities

        name = "_partial_for_test"
        module = types.ModuleType(f"forge_sidecar.capabilities.{name}")

        def register(server: Server) -> None:
            server.register("partial.first", lambda params, context: None)
            raise RuntimeError("the second half is missing")

        module.register = register  # type: ignore[attr-defined]
        sys.modules[module.__name__] = module
        setattr(capabilities, name, module)
        try:
            with mock.patch.object(capabilities, "OPTIONAL", [(("partial.first", "partial.second"), name)]):
                server = Server()
                capabilities.register_all(server)
        finally:
            sys.modules.pop(module.__name__, None)
            delattr(capabilities, name)
        self.assertNotIn("partial.first", server.capabilities)
        self.assertIn("partial.first", server.degraded)
        self.assertIn("partial.second", server.degraded)
        self.assertIn("the second half is missing", server.degraded["partial.second"])

    def test_each_module_lists_every_method_it_registers(self) -> None:
        # The voice.voices bug: a module's OPTIONAL tuple naming fewer methods
        # than it registers, so the rest answered "unknown method" wherever the
        # module could not load. Read from the source — every
        # `server.register("…"` site in the file, not the first — so it runs
        # with none of the modules' dependencies installed.
        from forge_sidecar import capabilities

        folder = os.path.dirname(capabilities.__file__)
        for methods, name in capabilities.OPTIONAL:
            with open(os.path.join(folder, f"{name}.py"), encoding="utf-8") as handle:
                source = handle.read()
            registered = re.findall(r"""server\.register\(\s*["']([^"']+)["']""", source)
            self.assertTrue(registered, f"{name}.py registers nothing this test can read")
            self.assertEqual(sorted(registered), sorted(methods), f"{name}.py registers {registered}, OPTIONAL lists {methods}")


if __name__ == "__main__":
    unittest.main()
