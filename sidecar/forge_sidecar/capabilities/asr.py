"""Speech recognition with word-level timestamps.

Uses faster-whisper (CTranslate2). Whisper covers every language including the
Indic set, which Parakeet does not — see docs/STACK.md §2. Parakeet-TDT is the
better European-language option (native transducer timestamps, ±20-40ms vs
Whisper's ±100-300ms DTW) and slots in beside this as a second tier.

Two methods, as every model-gated capability is (src/shared/sidecar/protocol.ts,
above ModelParams; docs/CLIPS.md §3a.4 "The speech model's own press", §16.49):

- ``asr.transcribe`` does the work and NEVER downloads. It used to call
  ``WhisperModel("small", download_root=…)``, which is faster-whisper's
  ``download_model``: ``snapshot_download`` at ``main``, unpinned, 464 MB on
  the first press of Transcribe with nothing on screen naming it, and a
  question to huggingface.co at every session's first load even with the
  model on disk. Now each model is the snapshot of ONE pinned commit, loaded by
  its folder's path, so a load asks no host; while the model asked for is not
  on disk the call is ``Unavailable`` before anything else runs.
- ``asr.model`` answers whether a model is on disk, with the bytes, label
  and host the Get button names before the press, and fetches it through
  ``media.download`` only on ``download: true`` exactly.

Three models (the speech model choice, 2026-11-20): ``small``, ``medium`` and
``large-v3``, each a ``SpeechModel`` in ``MODELS``. Both methods take
``params.model``, one of the three names; omitted, it is ``small``, the one
model there was before the choice, so an older caller asks what it always
asked. src/shared/asr/speechModel.ts SPEECH_MODELS is the same table for the
window, and tests/speechModelTable.test.ts holds the two equal (it reads
``MODELS`` below as text, so keep each entry in this exact shape).
"""

from __future__ import annotations

import os
import threading
from typing import Any, NamedTuple

from .. import media
from ..rpc import Context, Server, Unavailable


class SpeechModel(NamedTuple):
    """One pinned speech model: a repository at one commit, and the files read from it."""

    name: str
    """The protocol's name for it, ``params.model``: 'small', 'medium', 'large-v3'."""
    repo: str
    revision: str
    """A commit, never ``main``: ``media.download`` refuses anything else."""
    files: tuple[tuple[str, int], ...]
    """What ``WhisperModel`` reads from the snapshot, each with its size at
    ``revision``, smallest first, so the bar's last stretch is model.bin's."""

    @property
    def bytes(self) -> int:
        return sum(size for _, size in self.files)


MODELS: tuple[SpeechModel, ...] = (
    SpeechModel(
        name="small",
        repo="Systran/faster-whisper-small",
        revision="536b0662742c02347bc0e980a01041f333bce120",
        files=(
            ("config.json", 2_370),
            ("vocabulary.txt", 459_861),
            ("tokenizer.json", 2_203_239),
            ("model.bin", 483_546_902),
        ),
    ),
    SpeechModel(
        name="medium",
        repo="Systran/faster-whisper-medium",
        revision="08e178d48790749d25932bbc082711ddcfdfbc4f",
        files=(
            ("config.json", 2_257),
            ("vocabulary.txt", 459_861),
            ("tokenizer.json", 2_203_239),
            ("model.bin", 1_527_906_378),
        ),
    ),
    SpeechModel(
        name="large-v3",
        repo="Systran/faster-whisper-large-v3",
        revision="edaa852ec7e145841d8ffdb056a99866b5f0a478",
        files=(
            ("preprocessor_config.json", 340),
            ("config.json", 2_394),
            ("vocabulary.json", 1_068_114),
            ("tokenizer.json", 2_480_617),
            ("model.bin", 3_087_284_237),
        ),
    ),
)
"""The pins, read from huggingface.co's public API
(``/api/models/Systran/faster-whisper-<name>?blobs=true``: ``sha`` and the
``siblings``' sizes): small on 2026-10-16 (last modified
2023-11-23T10:57:09Z, the commit the dev Mac's userData/models already held),
medium and large-v3 on 2026-11-20 (last modified 2023-11-23T11:13:59Z and
2023-11-23T09:41:12Z). All three repositories are MIT, public, not gated.

486,212,372 B, 1,530,571,735 B and 3,090,835,702 B: "464 MB", "1.4 GB" and
"2.9 GB" through formatBytes, as the presses name them. model.bin is LFS, its
sha256 ``3e305921…d671`` (small), ``9b45e100…51ae`` (medium) and
``69f74147…d4f1`` (large-v3).

faster-whisper 1.2.1's own ``allow_patterns`` are config.json,
preprocessor_config.json, model.bin, tokenizer.json and vocabulary.*; and
``WhisperModel`` given a folder reads tokenizer.json (on disk, so the load
never asks the Hub for one) and preprocessor_config.json when it is there
(``_get_feature_kwargs``), else the feature extractor's defaults, 80 mel bins.
small and medium have no preprocessor_config.json, so the defaults are theirs,
as they always were; large-v3 HAS one and takes 128 mel bins, so it is fetched.
large-v3's vocabulary is vocabulary.json, which CTranslate2 reads as it reads
vocabulary.txt. README.md and .gitattributes are never fetched."""

DEFAULT_MODEL = "small"
"""The model when ``params.model`` is omitted: the one there was before the choice."""

MODEL_LABEL = "the speech model"
"""src/shared/asr/speechModel.ts SPEECH_MODEL_LABEL: every model's ``label``,
so the progress line reads as it always did; the window names which one from
its own table (Small, Medium, Large)."""

MODEL_HOST = "huggingface.co"
"""src/shared/asr/speechModel.ts SPEECH_MODEL_HOST. The bytes come from its CDN
after a redirect, so a restricted network allows huggingface.co and *.hf.co
(docs/SIDECAR.md; measured for small in docs/CLIPS.md §3a.8 row 35)."""

NOT_DOWNLOADED = "The speech model is not downloaded yet"
"""``asr.transcribe``'s ``Unavailable`` while the model asked for is not on
disk: a sentence the window may show as it is, so no method name, and no
size, which the press writes through formatBytes where ``media._megabytes``
would say another number."""

# The loaded WhisperModel, by (model name, snapshot folder, compute type),
# loaded on first use: the name in the key, so two sizes never share an entry.
# ONE model's entries at a time: loading another size forgets the others first,
# so a session that tries Small, Medium and Large never holds all three in
# memory at once (large-v3's model.bin alone is 3 GB on disk).
_model_lock = threading.Lock()
_models: dict[tuple[str, str, str], Any] = {}


def pinned(name: Any = None) -> SpeechModel:
    """The model ``name`` names; ``small`` for None or ""; a refusal naming the three for anything else."""
    wanted = name if name not in (None, "") else DEFAULT_MODEL
    for entry in MODELS:
        if entry.name == wanted:
            return entry
    choices = ", ".join(entry.name for entry in MODELS)
    raise ValueError(f"There is no speech model {wanted!r}: the speech models are {choices}")


# -------------------------------------------------------------------- model


def snapshot_dir(name: Any = None) -> str | None:
    """The model's pinned snapshot folder when every file is in it, else None.

    The question ``media.download`` asks before it fetches anything
    (``try_to_load_from_cache`` at a commit hash reads only the cache's
    folders: models--Systran--faster-whisper-<size>/snapshots/<commit>/), so a
    folder here loads without a request. A partial download is never an
    answer: Hugging Face writes a blob as ``.incomplete`` and links the
    snapshot only once it is whole.
    """
    entry = pinned(name)
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        return None
    folder: str | None = None
    for filename, _size in entry.files:
        try:
            found = try_to_load_from_cache(
                entry.repo, filename, cache_dir=media.models_dir(), revision=entry.revision
            )
        except Exception:  # noqa: BLE001 - a cache probe must never be fatal
            return None
        if not isinstance(found, str) or not os.path.isfile(found):
            return None
        here = os.path.dirname(found)
        if folder is None:
            folder = here
        elif os.path.normcase(here) != os.path.normcase(folder):
            return None
    return folder


def model_status(name: Any = None) -> dict[str, Any]:
    """ModelStatus for one model: on disk or not, and what its Get button names before the press."""
    entry = pinned(name)
    return {
        "present": snapshot_dir(entry.name) is not None,
        "bytes": entry.bytes,
        "label": MODEL_LABEL,
        "host": MODEL_HOST,
        "model": entry.name,
    }


def model(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``asr.model``: ModelParams -> ModelStatus; fetches only when ``download`` is exactly true.

    ``params.model`` names which of the three (omitted: small), refused
    before anything is asked when it is none of them.
    """
    entry = pinned(params.get("model"))
    if params.get("download") is True and snapshot_dir(entry.name) is None:
        total = entry.bytes
        done = 0
        for filename, size in entry.files:
            # Each file's share of the bar by its bytes; a file already in
            # the cache at the commit is returned by media.download unasked.
            span = (done / total, (done + size) / total)
            media.download(entry.repo, filename, entry.revision, context, MODEL_LABEL, span)
            done += size
    return model_status(entry.name)


def _load_model(name: str, folder: str, compute_type: str) -> Any:
    """The model in ``folder`` (the snapshot), loaded once per model and compute type,
    and only one model's at a time: another size's is forgotten first.

    By its path, so ``WhisperModel`` never reaches ``download_model``; and
    ``local_files_only`` besides, so even a path it did not take for a folder
    could only be looked up, never fetched.
    """
    from faster_whisper import WhisperModel

    key = (name, folder, compute_type)
    with _model_lock:
        if key not in _models:
            # Another size's loaded model goes before this one is read in.
            for other in [k for k in _models if k[0] != name]:
                del _models[other]
            _models[key] = WhisperModel(
                folder,
                device="cpu",
                compute_type=compute_type,
                local_files_only=True,
            )
        return _models[key]


# --------------------------------------------------------------------- work


def transcribe(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``asr.transcribe``: { path, language?, model?, initialPrompt?, computeType? } -> words."""
    path = params.get("path")
    if not isinstance(path, str) or not os.path.isfile(path):
        raise ValueError(f"No such media file: {path!r}")

    entry = pinned(params.get("model"))
    size = entry.name
    language = params.get("language") or None
    # Names and words to listen for: Whisper treats the prompt as text said
    # just before the audio, so a name spelled here is far likelier to be
    # heard as that name (src/shared/transcript.ts vocabularyPrompt).
    prompt = params.get("initialPrompt")
    initial_prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None
    # int8 is 2-4x faster on CPU with negligible quality loss for captions.
    compute_type = params.get("computeType") or "int8"

    folder = snapshot_dir(size)
    if folder is None:
        raise Unavailable(NOT_DOWNLOADED)

    context.progress(None, f"loading {size}")
    whisper = _load_model(size, folder, compute_type)
    context.raise_if_cancelled()

    context.progress(None, "analysing audio")
    segments_iter, info = whisper.transcribe(
        path,
        language=language,
        initial_prompt=initial_prompt,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )

    duration = float(info.duration or 0.0)
    words: list[dict[str, Any]] = []
    index = 0

    for segment in segments_iter:
        # Cancellation is cooperative; this is the checkpoint. Whisper
        # yields lazily, so the loop is where the real work happens.
        context.raise_if_cancelled()

        for word in segment.words or []:
            text = word.word.strip()
            if not text:
                continue
            words.append(
                {
                    "index": index,
                    "text": text,
                    "startMs": int(round(word.start * 1000)),
                    "endMs": int(round(word.end * 1000)),
                    "confidence": (
                        round(float(word.probability), 4)
                        if word.probability is not None
                        else None
                    ),
                }
            )
            index += 1

        if duration > 0:
            context.progress(min(1.0, segment.end / duration))

    context.progress(1.0, "done")
    return {
        "language": info.language,
        "languageProbability": round(float(info.language_probability or 0), 4),
        "durationMs": int(round(duration * 1000)),
        "model": f"faster-whisper/{size}/{compute_type}",
        "words": words,
    }


def register(server: Server) -> None:
    try:
        import faster_whisper  # noqa: F401
    except ImportError as exc:
        raise Unavailable(f"faster-whisper is not installed: {exc}") from exc

    server.register("asr.transcribe", transcribe)
    server.register("asr.model", model)
