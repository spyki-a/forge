"""The AI helper's self-test (sidecar/forge_sidecar/selftest.py, docs/CLIPS.md §3a.3 stage 4, §16.45).

Run by tests/integration/sidecarMedia.int.test.ts with every other file here,
on the helper's venv or on CI's bare interpreter, so nothing here skips and
nothing needs a package: the groups' sources are read as code (``ast``), the
process rule is held with a STAND-IN interpreter (a small script set as the
argv prefix, which records its pid, when it started, its arguments and its
stdin per run), and the faces group's library load with a stand-in
``mediapipe`` planted first on the real worker's path. The real run on this
interpreter is asserted for its shape everywhere, and for success where a
group's packages are installed.

Standard library only: unittest, no pytest.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from unittest import mock

from forge_sidecar import media, selftest
from forge_sidecar.capabilities import faces, system
from forge_sidecar.rpc import Cancelled, Server

STANDIN = textwrap.dedent(
    """
    # A stand-in interpreter for forge_sidecar.selftest: run as
    # `python standin.py <log> <the group's own argv after the interpreter>`.
    import json, os, sys, time
    log, args = sys.argv[1], sys.argv[2:]
    stdin = sys.stdin.buffer.read().decode("utf-8", "replace")
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"pid": os.getpid(), "t": time.time(), "args": args, "stdin": stdin}) + "\\n")
    plan = json.loads(os.environ.get("FORGE_TEST_STANDIN") or "{}")
    if plan.get("match", "\\0") in args[-1]:
        if plan.get("sleep"):
            time.sleep(plan["sleep"])
            if plan.get("marker"):
                open(plan["marker"], "w").write("not killed")
        sys.stdout.write(plan.get("stdout", ""))
        sys.stdout.flush()
        sys.stderr.write(plan.get("stderr", ""))
        sys.stderr.flush()
        sys.exit(plan.get("exit", 0))
    """
)


def imported(source: str) -> set[str]:
    """Every module a source imports, read as code: ``import a, b.c`` and ``from d import e``."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


class Context:
    """A request's context: records progress; cancelled once ``cancel`` is set."""

    request_id = 9

    def __init__(self) -> None:
        self.seen: list[tuple[float | None, str | None]] = []
        self.cancel = threading.Event()

    def progress(self, progress: float | None, message: str | None = None) -> None:
        self.seen.append((progress, message))

    def raise_if_cancelled(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


class Folder(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp(prefix="forge-selftest-")
        self.addCleanup(shutil.rmtree, self.dir, True)


# ------------------------------------------------------------------ sources


class Sources(unittest.TestCase):
    def test_the_import_list_holds_every_native_library_the_groups_exist_for(self) -> None:
        # The plan's list (docs/CLIPS.md §3a.7): soxr, numba, onnxruntime,
        # ctranslate2, av and sklearn, each imported by some group's own
        # source — and each by the group it stands for.
        everything = set().union(*(imported(source) for source in selftest.SOURCES.values()))
        for name in ("soxr", "numba", "onnxruntime", "ctranslate2", "av", "sklearn"):
            self.assertIn(name, everything)
        expected = {
            "asr": {"ctranslate2", "av", "faster_whisper", "tokenizers"},
            "beats": {"librosa", "soxr", "numba", "numba.core.typeconv._typeconv"},
            "onnx": {"onnxruntime"},
            "vision": {"numpy", "scipy.ndimage", "scipy.spatial"},
            "sklearn": {"sklearn"},
        }
        for group, names in expected.items():
            for name in names:
                self.assertIn(name, imported(selftest.SOURCES[group]), f"{group} does not import {name}")

    def test_sklearn_runs_alone_and_nowhere_else(self) -> None:
        # Its Windows wheel preloads its own msvcp140.dll on import, and every
        # later DLL in that process resolves to it: imported beside soxr or
        # numba, it would pass them on a machine where a fresh helper fails.
        self.assertEqual(imported(selftest.SOURCES["sklearn"]), {"sklearn"})
        for group, source in selftest.SOURCES.items():
            if group != "sklearn":
                self.assertFalse(
                    {n for n in imported(source) if n.split(".")[0] == "sklearn"},
                    f"{group} imports sklearn",
                )

    def test_beats_makes_the_call_that_loads_its_native_code(self) -> None:
        # `import librosa` alone loads neither soxr nor numba (beats.py's
        # registration does just that); the first stft does.
        calls = [
            node for node in ast.walk(ast.parse(selftest.SOURCES["beats"]))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "stft" and isinstance(node.func.value, ast.Name) and node.func.value.id == "librosa"
        ]
        self.assertEqual(len(calls), 1)

    def test_onnx_opens_a_session_on_the_shipped_model(self) -> None:
        tree = ast.parse(selftest.SOURCES["onnx"])
        opened = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "InferenceSession"
        ]
        self.assertEqual(len(opened), 1)
        self.assertIsInstance(opened[0].args[0], ast.Constant)
        self.assertEqual(opened[0].args[0].value, selftest.MODEL)
        with open(selftest.MODEL, "rb") as handle:
            data = handle.read()
        self.assertLess(len(data), 200, "the plan's 'under 200 B'")
        self.assertIn(b"Identity", data)

    def test_no_group_imports_the_helper(self) -> None:
        # The child is bare: what it proves is what a fresh process can load.
        for group, source in selftest.SOURCES.items():
            self.assertFalse({n for n in imported(source) if n.split(".")[0] == "forge_sidecar"}, group)

    def test_the_groups_are_the_plain_sources_and_the_faces_worker(self) -> None:
        self.assertEqual(set(selftest.GROUPS), set(selftest.SOURCES) | {"faces"})
        self.assertEqual(len(selftest.GROUPS), len(set(selftest.GROUPS)))

    def test_the_module_is_this_file_not_the_models_folder(self) -> None:
        # forge_sidecar/selftest/ (the model) has no __init__.py, so the
        # module of the same name wins; one added there would shadow it.
        self.assertTrue(selftest.__file__.endswith("selftest.py"), selftest.__file__)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(selftest.MODEL), "__init__.py")))


# ----------------------------------------------------------------- commands


class Commands(unittest.TestCase):
    def test_a_plain_group_is_a_fresh_bare_interpreter(self) -> None:
        environ = {"FORGE_MODELS_DIR": "/models", "PATH": "/bin"}
        for group in selftest.SOURCES:
            command = selftest.group_command(group, ["py"], environ)
            # One ordered shape: the interpreter, -E -s -B, -c, the group's source.
            self.assertEqual(command["argv"], ["py", "-E", "-s", "-B", "-c", selftest.SOURCES[group]])
            self.assertEqual(command["cwd"], faces.PACKAGE_PARENT)
            self.assertEqual(command["env"], environ)
            self.assertIsNone(command["stdin"])

    def test_the_faces_group_is_the_workers_own_import_only_run(self) -> None:
        environ = {"FORGE_MODELS_DIR": "/models", faces.FAKE_ENV: "colour"}
        command = selftest.group_command("faces", ["py"], environ)
        self.assertEqual(command["argv"], ["py", *faces.WORKER_FLAGS, "-c", faces.WORKER_BOOTSTRAP])
        self.assertEqual(command["cwd"], faces.PACKAGE_PARENT)
        self.assertEqual(json.loads(command["stdin"]), {"mode": "import"})
        # FORGE_* kept, but never the stand-in detector: it says ready without mediapipe.
        self.assertEqual(command["env"].get("FORGE_MODELS_DIR"), "/models")
        self.assertNotIn(faces.FAKE_ENV, command["env"])

    def test_an_unknown_group_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            selftest.group_command("stems")
        with self.assertRaises(ValueError):
            selftest.checked_groups(["beats", "stems"])
        with self.assertRaises(ValueError):
            selftest.checked_groups("beats")
        self.assertEqual(selftest.checked_groups(None), list(selftest.GROUPS))
        self.assertEqual(selftest.checked_groups(["sklearn", "asr", "sklearn"]), ["sklearn", "asr"])


# ---------------------------------------------------------------- processes


class Processes(Folder):
    # The two kill cases' clock. selftest() gives every group its one
    # timeout, so in the timeout case the group that must FINISH (sklearn)
    # has the sleeping group's budget, and the cancel case's child must have
    # started, its line in the log, before the cancel lands. Both are a Python
    # start: the stand-in's is about 0.1 s, and on 2026-10-28, beside two
    # other vitest runs, it went past these cases' old 0.3 s and the finishing
    # group was killed too ("-1 != 0"). Every start slowed by 0.3 s (a
    # sitecustomize that sleeps first) failed both old cases, the timeout one
    # on sklearn and the cancel one on the log ("0 != 1"); at BUDGET_S both
    # pass a start slowed by 1.9 s, and fail at 2.1.
    BUDGET_S = 2.0
    """The timeout, and the cancel's timer: a budget a loaded machine's Python start meets."""
    TOOK_S = 5.0
    """A run longer than this waited for the sleeping child. A passing timeout run
    is two groups of at most BUDGET_S + POLL_S each, 4.2 s: the sleeper killed on
    the first poll past its deadline, the finisher's exit seen on the wait that
    would have found its own; a cancelled run is one."""
    SLEEP_S = 6.0
    """The sleeping child's sleep: a run that waited for it takes this and its start."""

    def outlive(self, run: dict) -> None:
        """Wait until a second past the moment a stand-in's sleep would end, timed from its own start, not the run's end."""
        time.sleep(max(0.0, run["t"] + self.SLEEP_S + 1.0 - time.time()))

    def clock_in_order(self) -> None:
        """The clock's order, which both kill cases stand on: each calls this first, so either run alone checks it.

        A passing timeout run, two groups of at most BUDGET_S + POLL_S each,
        fits under TOOK_S with half a second to spare (a cancelled run is one
        group); and the sleeping child outlasts TOOK_S, or a run that waited
        for it would pass the took bound.
        """
        self.assertLess(
            2 * (self.BUDGET_S + selftest.POLL_S), self.TOOK_S - 0.5,
            "POLL_S changed: retune BUDGET_S, TOOK_S and SLEEP_S together",
        )
        self.assertLess(
            self.TOOK_S, self.SLEEP_S,
            "SLEEP_S must outlast TOOK_S, or a run that waited for the sleeping child passes the took bound",
        )

    def run_standin(self, plan: dict | None = None, groups: list[str] | None = None, **options: object) -> tuple[dict, list[dict]]:
        script = os.path.join(self.dir, "standin.py")
        with open(script, "w", encoding="utf-8") as handle:
            handle.write(STANDIN)
        log = os.path.join(self.dir, "runs.jsonl")
        environ = {**os.environ, "FORGE_TEST_STANDIN": json.dumps(plan or {})}
        result = selftest.selftest(groups, python=[sys.executable, script, log], environ=environ, **options)  # type: ignore[arg-type]
        return result, self.runs(log)

    @staticmethod
    def runs(log: str) -> list[dict]:
        if not os.path.exists(log):
            return []
        with open(log, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def test_each_group_runs_in_its_own_process(self) -> None:
        result, runs = self.run_standin()
        self.assertEqual(list(result), list(selftest.GROUPS))
        self.assertEqual(len(runs), len(selftest.GROUPS), runs)
        pids = [run["pid"] for run in runs]
        self.assertEqual(len(set(pids)), len(selftest.GROUPS), f"one process per group, got pids {pids}")
        self.assertNotIn(os.getpid(), pids)
        # Each run is its own group's command, in order, and only that.
        for group, run in zip(selftest.GROUPS, runs):
            command = selftest.group_command(group, ["x"])
            self.assertEqual(run["args"], command["argv"][1:], group)
            self.assertEqual(run["stdin"], (command["stdin"] or b"").decode(), group)
        for group in selftest.GROUPS:
            self.assertEqual(result[group]["exit"], 0)
            self.assertIsNone(result[group]["error"])
            self.assertIsInstance(result[group]["ms"], int)

    def test_a_failed_group_says_why_in_its_last_stderr_line(self) -> None:
        plan = {
            "match": "soxr",
            "stderr": "Traceback (most recent call last):\n  File \"<string>\", line 1\nModuleNotFoundError: No module named 'soxr'\n\n",
            "exit": 1,
        }
        result, _runs = self.run_standin(plan)
        self.assertEqual(result["beats"], {"exit": 1, "ms": result["beats"]["ms"], "error": "ModuleNotFoundError: No module named 'soxr'"})
        for group in selftest.GROUPS:
            if group != "beats":
                self.assertEqual(result[group]["exit"], 0, group)

    def test_the_faces_group_reports_the_workers_error_line(self) -> None:
        plan = {
            "match": "mp_faces",
            "stdout": "error import OSError: libmediapipe.dll could not be loaded\n",
            "stderr": "some log line\n",
            "exit": faces.EXIT_IMPORT,
        }
        result, _runs = self.run_standin(plan, ["faces"])
        self.assertEqual(result["faces"]["exit"], faces.EXIT_IMPORT)
        self.assertEqual(result["faces"]["error"], "error import OSError: libmediapipe.dll could not be loaded")

    def test_a_group_past_its_time_is_killed_and_reported(self) -> None:
        self.clock_in_order()
        marker = os.path.join(self.dir, "survived")
        started = time.monotonic()
        result, runs = self.run_standin(
            {"match": "ctranslate2", "sleep": self.SLEEP_S, "marker": marker}, ["asr", "sklearn"], timeout=self.BUDGET_S,
        )
        took = time.monotonic() - started
        self.assertEqual(result["asr"]["exit"], -1)
        self.assertIn("timed out", result["asr"]["error"])
        # WHEN the kill landed, which the whole-run bound below does not hold
        # (a deadline of twice the timeout kills at about 4.1 s, the run about
        # 4.2 s, under TOOK_S). run_group kills once time.perf_counter() >=
        # started + timeout and reads ms after that kill, from the same
        # started on the same clock, rounded to the millisecond (which takes
        # up the float sum's last bit): a kill on time never reads under
        # BUDGET_S, so the lower bound cannot flake, and catches a deadline set
        # early. The deadline is seen on the first POLL_S wait past it; the
        # upper bound gives a loaded machine a second more than that.
        self.assertGreaterEqual(result["asr"]["ms"], self.BUDGET_S * 1000, "the child was killed before its deadline")
        self.assertLess(
            result["asr"]["ms"], (self.BUDGET_S + selftest.POLL_S) * 1000 + 1000,
            "the child was killed late: a second past the first poll after its deadline",
        )
        self.assertLess(took, self.TOOK_S, "the run waited for the child instead of killing it")
        # The next group still ran, and finished inside the same budget.
        self.assertEqual(list(result), ["asr", "sklearn"], "the group after a timed-out one was not run")
        self.assertEqual(result["sklearn"]["exit"], 0, result["sklearn"])
        self.assertEqual(len(runs), 2, runs)
        [child] = [run for run in runs if "ctranslate2" in run["args"][-1]]
        self.outlive(child)
        self.assertFalse(os.path.exists(marker), "the timed-out child was left running")

    def test_a_cancel_kills_the_running_group_and_starts_no_other(self) -> None:
        self.clock_in_order()
        marker = os.path.join(self.dir, "survived")
        context = Context()
        threading.Timer(self.BUDGET_S, context.cancel.set).start()
        started = time.monotonic()
        with self.assertRaises(Cancelled):
            self.run_standin({"match": "ctranslate2", "sleep": self.SLEEP_S, "marker": marker}, ["asr", "beats"], context=context)
        self.assertLess(time.monotonic() - started, self.TOOK_S, "the cancel waited for the child instead of killing it")
        runs = self.runs(os.path.join(self.dir, "runs.jsonl"))
        self.assertEqual(len(runs), 1, runs)
        self.outlive(runs[0])
        self.assertFalse(os.path.exists(marker), "the cancelled child was left running")

    def test_a_cancel_before_a_group_starts_nothing(self) -> None:
        context = Context()
        context.cancel.set()
        with self.assertRaises(Cancelled):
            self.run_standin(None, None, context=context)
        self.assertEqual(self.runs(os.path.join(self.dir, "runs.jsonl")), [])

    def test_each_group_is_a_progress_line(self) -> None:
        context = Context()
        self.run_standin(None, ["sklearn", "asr"], context=context)
        self.assertEqual(
            context.seen,
            [(0.0, "checking sklearn · 1 of 2"), (0.5, "checking asr · 2 of 2"), (1.0, None)],
        )

    def test_an_interpreter_that_cannot_start_is_a_failed_group(self) -> None:
        missing = os.path.join(self.dir, "no-such-python")
        result = selftest.selftest(["sklearn"], python=[missing])
        self.assertEqual(result["sklearn"]["exit"], -1)
        self.assertIn("could not start", result["sklearn"]["error"])

    def test_every_child_is_started_with_no_window(self) -> None:
        # media._NO_WINDOW is {} off Windows, where Popen refuses
        # creationflags, so the flag is put in and Popen watched.
        seen: list[dict] = []
        real = subprocess.Popen

        def spy(*args: object, **kwargs: object) -> object:
            seen.append(dict(kwargs))
            if os.name != "nt":
                kwargs.pop("creationflags", None)
            return real(*args, **kwargs)  # type: ignore[call-overload]

        with mock.patch.object(media, "_NO_WINDOW", {"creationflags": 0x08000000}), \
                mock.patch.object(selftest.subprocess, "Popen", side_effect=spy):
            self.run_standin()
        self.assertEqual(len(seen), len(selftest.GROUPS))
        for kwargs in seen:
            self.assertEqual(kwargs.get("creationflags"), 0x08000000)


# -------------------------------------------------------------------- faces


class FacesGroup(Folder):
    """The real worker, through its real bootstrap, with a stand-in ``mediapipe`` first on its path.

    The stand-in's ``load_raw_library`` either records that it was called or
    raises, as ``ctypes.CDLL`` does where libmediapipe's runtime is missing.
    Runs on a bare interpreter: the worker's own modules are stdlib-only.
    """

    def plant(self, load_raw_library: str) -> str:
        root = os.path.join(self.dir, "planted")
        files = {
            "mediapipe/__init__.py": '__version__ = "0.0-stand-in"\n',
            "mediapipe/tasks/__init__.py": "",
            "mediapipe/tasks/python/__init__.py": "",
            "mediapipe/tasks/python/vision/__init__.py": "",
            "mediapipe/tasks/python/core/__init__.py": "",
            "mediapipe/tasks/python/core/base_options.py": "class BaseOptions:\n    pass\n",
            "mediapipe/tasks/python/core/mediapipe_c_bindings.py": load_raw_library,
        }
        for name, text in files.items():
            path = os.path.join(root, *name.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(text)
        return root

    def bootstrap_with(self, root: str) -> str:
        # FIRST on the worker's path: in front of the stubs and the package,
        # put there by the bootstrap's own line, right before the worker runs.
        anchor = "runpy.run_module("
        self.assertEqual(faces.WORKER_BOOTSTRAP.count(anchor), 1)
        return faces.WORKER_BOOTSTRAP.replace(anchor, f"sys.path.insert(0, {root!r})\n{anchor}")

    def run_faces(self, root: str, environ: dict | None = None) -> dict:
        with mock.patch.object(faces, "WORKER_BOOTSTRAP", self.bootstrap_with(root)):
            return selftest.selftest(["faces"], environ=environ)["faces"]

    def test_the_faces_group_loads_mediapipes_library(self) -> None:
        marker = os.path.join(self.dir, "loaded")
        root = self.plant(f"def load_raw_library(signatures=()):\n    open({marker!r}, 'w').write('loaded')\n    return object()\n")
        result = self.run_faces(root)
        self.assertEqual(result["exit"], 0, result)
        self.assertIsNone(result["error"])
        self.assertTrue(os.path.exists(marker), "the import-only run never loaded the library")

    def test_a_library_that_will_not_load_turns_the_group_red(self) -> None:
        root = self.plant(
            "def load_raw_library(signatures=()):\n"
            "    raise OSError(\"stand-in: libmediapipe could not be loaded (or one of its dependencies)\")\n"
        )
        result = self.run_faces(root)
        self.assertEqual(result["exit"], faces.EXIT_IMPORT, result)
        self.assertEqual(result["error"], "error import OSError: stand-in: libmediapipe could not be loaded (or one of its dependencies)")

    def test_the_stand_in_detector_never_answers_for_the_group(self) -> None:
        # FORGE_FACES_WORKER_FAKE makes the worker say `ready` without
        # mediapipe; a shell that has it set must not turn the group green.
        root = self.plant("def load_raw_library(signatures=()):\n    raise OSError('stand-in: no library')\n")
        result = self.run_faces(root, {**os.environ, faces.FAKE_ENV: "colour"})
        self.assertEqual(result["exit"], faces.EXIT_IMPORT, result)


# ----------------------------------------------------------------- the method


class Method(unittest.TestCase):
    def handler(self):  # type: ignore[no-untyped-def]
        server = Server()
        system.register(server)
        self.assertIn("system.selftest", server.capabilities)
        return server._handlers["system.selftest"]  # noqa: SLF001 - the registered handler itself

    def test_system_selftest_runs_the_named_groups(self) -> None:
        handler = self.handler()
        context = Context()
        ran: list[str] = []

        def fake(group: str, **_options: object) -> dict:
            ran.append(group)
            return {"exit": 0, "ms": 1, "error": None}

        with mock.patch.object(selftest, "run_group", side_effect=fake):
            answer = handler({"groups": ["vision", "beats"]}, context)
            self.assertEqual(list(answer), ["vision", "beats"])
            self.assertEqual(ran, ["vision", "beats"])
            ran.clear()
            self.assertEqual(list(handler({}, context)), list(selftest.GROUPS))
        self.assertEqual(ran, list(selftest.GROUPS))

    def test_system_selftest_refuses_what_is_not_a_list_of_groups(self) -> None:
        handler = self.handler()
        for groups in ("beats", ["beats", 3], ["stems"]):
            with self.assertRaises(ValueError, msg=repr(groups)):
                handler({"groups": groups}, Context())


# ----------------------------------------------------------------- real run


class RealRun(unittest.TestCase):
    PACKAGES = {
        "asr": ("ctranslate2", "av", "faster_whisper", "tokenizers"),
        "beats": ("librosa", "soxr", "numba", "numpy"),
        "onnx": ("onnxruntime", "numpy"),
        "vision": ("numpy", "scipy"),
        "sklearn": ("sklearn",),
        "faces": ("mediapipe",),
    }

    def test_the_real_run_answers_every_group_with_its_shape(self) -> None:
        # On CI's bare interpreter every group fails, and that is an answer;
        # where a group's packages are installed (the dev venv has them all)
        # it must pass, in its own fresh process of this interpreter.
        result = selftest.selftest(environ={k: v for k, v in os.environ.items() if k != faces.FAKE_ENV})
        self.assertEqual(list(result), list(selftest.GROUPS))
        self.assertEqual(set(self.PACKAGES), set(selftest.GROUPS))
        for group, one in result.items():
            self.assertEqual(set(one), {"exit", "ms", "error"}, group)
            self.assertIsInstance(one["exit"], int, group)
            self.assertIsInstance(one["ms"], int, group)
            self.assertGreaterEqual(one["ms"], 0, group)
            if one["exit"] == 0:
                self.assertIsNone(one["error"], group)
            else:
                self.assertIsInstance(one["error"], (str, type(None)), group)
            installed = all(importlib.util.find_spec(name) is not None for name in self.PACKAGES[group])
            if installed:
                self.assertEqual(one["exit"], 0, f"{group} is installed here and failed: {one}")


if __name__ == "__main__":
    unittest.main()
