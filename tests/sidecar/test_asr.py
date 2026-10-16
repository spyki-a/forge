"""The speech model's own press (sidecar/forge_sidecar/capabilities/asr.py, docs/CLIPS.md §3a.4, §16.49).

Run by tests/integration/sidecarMedia.int.test.ts with the helper's own
interpreter when there is one, else CI's bare 3.12, so nothing here needs
faster-whisper or huggingface_hub: both are stood in through sys.modules, and
the stand-ins for every call that could reach a host (``snapshot_download``,
``hf_hub_download``) RAISE, so a request made where none may be fails the
test instead of passing quietly. The real model, on real speech, is
tests/integration/asr.int.test.ts.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

from forge_sidecar import capabilities, media
from forge_sidecar.capabilities import asr
from forge_sidecar.rpc import Server, Unavailable

FILES = [name for name, _ in asr.MODEL_FILES]


class Recorder:
    """A request's context: records progress, never cancels."""

    def __init__(self) -> None:
        self.seen: list[tuple[float | None, str | None]] = []

    def progress(self, progress: float | None, message: str | None = None) -> None:
        self.seen.append((progress, message))

    def raise_if_cancelled(self) -> None:
        pass


class Hub:
    """Just as much huggingface_hub as asr and media.download ask of it.

    ``try_to_load_from_cache`` reads the cache's own layout on disk
    (``models--<org>--<name>/snapshots/<commit>/<file>``) and asks no host;
    every call that could reach one raises.
    """

    def __init__(self) -> None:
        self.asked: list[tuple[str, str, str | None, str | None]] = []
        self.requests: list[str] = []

    def try_to_load_from_cache(self, repo: str, filename: str, cache_dir: str | None = None, revision: str | None = None) -> object:
        self.asked.append((repo, filename, cache_dir, revision))
        if cache_dir is None or revision is None:
            return None
        path = os.path.join(cache_dir, "models--" + repo.replace("/", "--"), "snapshots", revision, filename)
        return path if os.path.isfile(path) else None

    def _request(self, name: str) -> "object":
        def refuse(*args: object, **kwargs: object) -> object:
            self.requests.append(name)
            raise AssertionError(f"huggingface_hub.{name} was called: that is a request")

        return refuse

    def module(self) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            try_to_load_from_cache=self.try_to_load_from_cache,
            snapshot_download=self._request("snapshot_download"),
            hf_hub_download=self._request("hf_hub_download"),
        )


class Whisper:
    """faster_whisper.WhisperModel, recording what it was given; transcribes to two words."""

    made: list[tuple[str, dict[str, object]]] = []

    def __init__(self, model_size_or_path: str, **kwargs: object) -> None:
        Whisper.made.append((model_size_or_path, dict(kwargs)))

    def transcribe(self, path: str, **_kwargs: object) -> tuple[object, object]:
        word = types.SimpleNamespace
        segment = types.SimpleNamespace(
            end=1.0,
            words=[word(word=" ask", start=0.1, end=0.4, probability=0.9), word(word=" not", start=0.5, end=0.8, probability=0.8)],
        )
        info = types.SimpleNamespace(duration=1.0, language="en", language_probability=0.99)
        return iter([segment]), info

    @classmethod
    def module(cls) -> types.SimpleNamespace:
        return types.SimpleNamespace(WhisperModel=cls)


class Planted(unittest.TestCase):
    """A FORGE_MODELS_DIR of the test's own, the stand-ins in sys.modules, and asr's loaded models forgotten."""

    def setUp(self) -> None:
        self.models = tempfile.mkdtemp(prefix="forge-models-")
        self.addCleanup(shutil.rmtree, self.models, True)
        self.snapshot = os.path.join(self.models, "models--Systran--faster-whisper-small", "snapshots", asr.MODEL_REVISION)
        self.hub = Hub()
        Whisper.made = []
        patches = [
            mock.patch.dict(os.environ, {"FORGE_MODELS_DIR": self.models}),
            mock.patch.dict(sys.modules, {"huggingface_hub": self.hub.module(), "faster_whisper": Whisper.module()}),
            mock.patch.dict(asr._models, clear=True),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.audio = os.path.join(self.models, "speech.wav")
        with open(self.audio, "wb") as handle:
            handle.write(b"RIFF")

    def plant(self, names: "list[str] | None" = None) -> None:
        """The model's files at the pinned commit's place in the cache (a byte each: only their names are read here)."""
        os.makedirs(self.snapshot, exist_ok=True)
        for name in FILES if names is None else names:
            with open(os.path.join(self.snapshot, name), "wb") as handle:
                handle.write(b"x")


# ------------------------------------------------------------------- the pin


class ThePin(unittest.TestCase):
    def test_the_revision_is_a_commit_and_the_files_are_what_whisper_reads(self) -> None:
        self.assertRegex(asr.MODEL_REVISION, r"^[0-9a-f]{40}$")
        self.assertTrue(media.COMMIT.fullmatch(asr.MODEL_REVISION))
        self.assertEqual(sorted(FILES), ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"])
        # The sizes read from huggingface.co's API at that commit, summed: what the press names.
        self.assertEqual(dict(asr.MODEL_FILES)["model.bin"], 483_546_902)
        self.assertEqual(asr.MODEL_BYTES, 486_212_372)
        self.assertEqual((asr.MODEL_REPO, asr.MODEL_LABEL, asr.MODEL_HOST), ("Systran/faster-whisper-small", "the speech model", "huggingface.co"))


# ------------------------------------------------------------ the status


class TheStatus(Planted):
    def test_absent_it_answers_without_a_request(self) -> None:
        for asked in ({}, {"download": False}, {"download": "true"}, {"download": 1}):
            with mock.patch.object(media, "download", side_effect=AssertionError("fetched without download: true")) as fetch:
                self.assertEqual(
                    asr.model(asked, Recorder()),
                    {"present": False, "bytes": 486_212_372, "label": "the speech model", "host": "huggingface.co"},
                    asked,
                )
            self.assertEqual(fetch.call_count, 0, asked)
        self.assertEqual(self.hub.requests, [])

    def test_present_it_answers_present_from_the_cache_at_the_commit(self) -> None:
        self.plant()
        status = asr.model({}, Recorder())
        self.assertEqual(status, {"present": True, "bytes": 486_212_372, "label": "the speech model", "host": "huggingface.co"})
        self.assertEqual(self.hub.requests, [])
        # It asked the cache about every file, at the pinned commit, in FORGE_MODELS_DIR.
        self.assertEqual(sorted(self.hub.asked), sorted((asr.MODEL_REPO, name, self.models, asr.MODEL_REVISION) for name in FILES))

    def test_one_file_missing_is_not_the_model(self) -> None:
        for missing in FILES:
            shutil.rmtree(self.snapshot, True)
            self.plant([name for name in FILES if name != missing])
            self.assertFalse(asr.model({}, Recorder())["present"], missing)
            self.assertIsNone(asr.snapshot_dir(), missing)

    def test_another_commits_snapshot_is_not_the_model(self) -> None:
        other = os.path.join(os.path.dirname(self.snapshot), "0" * 40)
        os.makedirs(other)
        for name in FILES:
            with open(os.path.join(other, name), "wb") as handle:
                handle.write(b"x")
        self.assertFalse(asr.model({}, Recorder())["present"])

    def test_the_planted_layout_is_the_hubs_own_where_huggingface_hub_is_installed(self) -> None:
        # The stand-in's layout against the real module's, wherever there is
        # one (the venv, a pack). On a bare interpreter there is nothing to
        # compare and the stand-in alone answers, as in every other test.
        self.plant()
        with mock.patch.dict(sys.modules):
            sys.modules.pop("huggingface_hub", None)
            try:
                import huggingface_hub as real
            except ImportError:
                return
            for name in FILES:
                found = real.try_to_load_from_cache(asr.MODEL_REPO, name, cache_dir=self.models, revision=asr.MODEL_REVISION)
                self.assertEqual(found, os.path.join(self.snapshot, name), name)


# ------------------------------------------------------------- the press


class ThePress(Planted):
    def test_download_true_fetches_each_file_at_the_pinned_commit_with_spans_summing_to_one(self) -> None:
        calls: list[tuple[object, ...]] = []

        def download(repo: str, filename: str, revision: str, context: object, label: str, span: tuple[float, float] = (0.0, 1.0)) -> str:
            calls.append((repo, filename, revision, context, label, span))
            self.plant([filename])
            return os.path.join(self.snapshot, filename)

        context = Recorder()
        with mock.patch.object(media, "download", side_effect=download):
            status = asr.model({"download": True}, context)
        self.assertTrue(status["present"])
        self.assertEqual([c[1] for c in calls], FILES)
        for repo, _filename, revision, given, label, _span in calls:
            self.assertEqual((repo, revision, given, label), (asr.MODEL_REPO, asr.MODEL_REVISION, context, "the speech model"))
        spans = [c[5] for c in calls]
        # One bar: each span starts where the last ended, from 0 to 1.
        self.assertEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[-1][1], 1.0, places=12)
        for before, after in zip(spans, spans[1:]):
            self.assertEqual(before[1], after[0])
        # model.bin is nearly all of it.
        self.assertEqual(calls[-1][1], "model.bin")
        self.assertGreater(spans[-1][1] - spans[-1][0], 0.99)
        self.assertEqual(self.hub.requests, [])

    def test_download_true_with_the_model_present_fetches_nothing(self) -> None:
        self.plant()
        with mock.patch.object(media, "download", side_effect=AssertionError("fetched a model on disk")) as fetch:
            self.assertTrue(asr.model({"download": True}, Recorder())["present"])
        self.assertEqual(fetch.call_count, 0)

    def test_through_media_download_the_hub_is_asked_at_the_commit_into_the_models_folder(self) -> None:
        # media.download itself, with the stand-in's hf_hub_download recording
        # and writing the file into the layout as the real one does.
        fetched: list[dict[str, object]] = []

        def hf_hub_download(repo: str, filename: str, revision: "str | None" = None, cache_dir: "str | None" = None, tqdm_class: "type | None" = None) -> str:
            fetched.append({"repo": repo, "filename": filename, "revision": revision, "cache_dir": cache_dir, "progress": tqdm_class is not None})
            self.plant([filename])
            return os.path.join(self.snapshot, filename)

        module = self.hub.module()
        module.hf_hub_download = hf_hub_download
        with mock.patch.dict(sys.modules, {"huggingface_hub": module}):
            self.assertTrue(asr.model({"download": True}, Recorder())["present"])
        self.assertEqual(
            fetched,
            [{"repo": asr.MODEL_REPO, "filename": name, "revision": asr.MODEL_REVISION, "cache_dir": self.models, "progress": True} for name in FILES],
        )


# --------------------------------------------------------------- the work


class TheWork(Planted):
    def test_with_the_model_on_disk_a_transcription_makes_no_request_and_loads_the_snapshot_by_path(self) -> None:
        self.plant()
        with mock.patch.object(media, "download", side_effect=AssertionError("transcribe downloaded")):
            result = asr.transcribe({"path": self.audio, "language": "en"}, Recorder())
        self.assertEqual([w["text"] for w in result["words"]], ["ask", "not"])
        self.assertEqual(result["model"], "faster-whisper/small/int8")
        self.assertEqual(self.hub.requests, [])
        self.assertEqual(len(Whisper.made), 1)
        given, kwargs = Whisper.made[0]
        # The snapshot folder, never the size name (which is download_model's road to the Hub).
        self.assertEqual(given, self.snapshot)
        self.assertNotEqual(given, "small")
        self.assertTrue(os.path.isdir(given))
        self.assertIs(kwargs.get("local_files_only"), True)
        self.assertNotIn("download_root", kwargs)

    def test_a_second_transcription_reuses_the_loaded_model(self) -> None:
        self.plant()
        asr.transcribe({"path": self.audio}, Recorder())
        asr.transcribe({"path": self.audio, "model": "small"}, Recorder())
        self.assertEqual(len(Whisper.made), 1)

    def test_without_the_model_it_is_unavailable_and_downloads_nothing(self) -> None:
        with mock.patch.object(media, "download", side_effect=AssertionError("transcribe downloaded")) as fetch:
            with self.assertRaises(Unavailable) as caught:
                asr.transcribe({"path": self.audio}, Recorder())
        self.assertEqual(str(caught.exception), "The speech model is not downloaded yet")
        self.assertEqual(Whisper.made, [])
        self.assertEqual(fetch.call_count, 0)
        self.assertEqual(self.hub.requests, [])
        # Nothing was written into the models folder either.
        self.assertEqual(sorted(os.listdir(self.models)), ["speech.wav"])

    def test_another_size_is_refused_before_anything_is_loaded(self) -> None:
        self.plant()
        with self.assertRaises(ValueError) as caught:
            asr.transcribe({"path": self.audio, "model": "tiny"}, Recorder())
        self.assertIn("'tiny'", str(caught.exception))
        self.assertEqual(Whisper.made, [])

    def test_a_missing_file_is_refused_first(self) -> None:
        with self.assertRaises(ValueError):
            asr.transcribe({"path": os.path.join(self.models, "no-such.wav")}, Recorder())


# ---------------------------------------------------------- registration


class Registration(unittest.TestCase):
    def test_registers_both_methods_when_faster_whisper_imports(self) -> None:
        server = Server()
        with mock.patch.dict(sys.modules, {"faster_whisper": Whisper.module()}):
            asr.register(server)
        self.assertEqual(server.capabilities, ["asr.model", "asr.transcribe"])

    def test_without_faster_whisper_both_are_degraded_by_name(self) -> None:
        server = Server()
        with mock.patch.dict(sys.modules, {"faster_whisper": None}), \
                mock.patch.object(capabilities, "OPTIONAL", [row for row in capabilities.OPTIONAL if row[1] == "asr"]):
            capabilities.register_all(server)
        for method in ("asr.transcribe", "asr.model"):
            self.assertNotIn(method, server.capabilities)
            self.assertIn(method, server.degraded)
            self.assertIn("asr unavailable: faster-whisper is not installed", server.degraded[method])


if __name__ == "__main__":
    unittest.main()
