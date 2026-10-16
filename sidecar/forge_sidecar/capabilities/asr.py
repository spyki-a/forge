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
  model on disk. Now the model is the snapshot of ONE pinned commit, loaded by
  its folder's path, so a load asks no host; while it is not on disk the call
  is ``Unavailable`` before anything else runs.
- ``asr.model`` answers whether the model is on disk, with the bytes, label
  and host the Get button names before the press, and fetches it through
  ``media.download`` only on ``download: true`` exactly.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from .. import media
from ..rpc import Context, Server, Unavailable

MODEL_REPO = "Systran/faster-whisper-small"
"""src/shared/asr/speechModel.ts SPEECH_MODEL_REPO; tests/speechModelIpc.test.ts holds the two equal."""

MODEL_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
"""The repository's commit, read from huggingface.co's API on 2026-10-16
(``/api/models/Systran/faster-whisper-small?blobs=true``: ``sha``, last
modified 2023-11-23T10:57:09Z), and the commit the app's userData/models on
the dev Mac already held. A commit, never ``main``: ``media.download`` refuses
anything else."""

MODEL_FILES: tuple[tuple[str, int], ...] = (
    ("config.json", 2_370),
    ("vocabulary.txt", 459_861),
    ("tokenizer.json", 2_203_239),
    ("model.bin", 483_546_902),
)
"""What ``WhisperModel`` reads from the snapshot, with each file's size at
``MODEL_REVISION`` (the API's ``siblings``; model.bin is LFS, sha256
``3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671``).
faster-whisper's own ``allow_patterns`` are config.json,
preprocessor_config.json (not in this repository: the feature extractor's
defaults are used, as they always were), model.bin, tokenizer.json and
vocabulary.*; tokenizer.json on disk is what keeps the load from asking the Hub
for a tokenizer. README.md (1,998 B) and .gitattributes (1,477 B) are never
fetched. Smallest first, so the bar's last 99.4 % is model.bin's."""

MODEL_BYTES = sum(size for _, size in MODEL_FILES)
"""486,212,372 B: "464 MB" through formatBytes, as the press names it."""

MODEL_LABEL = "the speech model"
"""src/shared/asr/speechModel.ts SPEECH_MODEL_LABEL."""

MODEL_HOST = "huggingface.co"
"""src/shared/asr/speechModel.ts SPEECH_MODEL_HOST. The bytes come from its CDN
after a redirect, so a restricted network allows huggingface.co and *.hf.co
(docs/SIDECAR.md; measured for this model in docs/CLIPS.md §3a.8 row 35)."""

MODEL_NAME = "small"
"""The only size there is: ``params.model``, when sent, must name it."""

NOT_DOWNLOADED = "The speech model is not downloaded yet"
"""``asr.transcribe``'s ``Unavailable`` while it is not on disk: a sentence the
window may show as it is, so no method name, and no size, which the press
writes through formatBytes (464 MB) where ``media._megabytes`` would say 486."""

# One WhisperModel per (snapshot folder, compute type), loaded on first use.
_model_lock = threading.Lock()
_models: dict[tuple[str, str], Any] = {}


# -------------------------------------------------------------------- model


def snapshot_dir() -> str | None:
    """The pinned commit's snapshot folder when every file is in it, else None.

    The question ``media.download`` asks before it fetches anything
    (``try_to_load_from_cache`` at a commit hash reads only the cache's
    folders: models--Systran--faster-whisper-small/snapshots/<commit>/), so a
    folder here loads without a request. A partial download is never an
    answer: Hugging Face writes a blob as ``.incomplete`` and links the
    snapshot only once it is whole.
    """
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        return None
    folder: str | None = None
    for filename, _size in MODEL_FILES:
        try:
            found = try_to_load_from_cache(
                MODEL_REPO, filename, cache_dir=media.models_dir(), revision=MODEL_REVISION
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


def model_status() -> dict[str, Any]:
    """ModelStatus: on disk or not, and what the Get button names before the press."""
    return {
        "present": snapshot_dir() is not None,
        "bytes": MODEL_BYTES,
        "label": MODEL_LABEL,
        "host": MODEL_HOST,
    }


def model(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``asr.model``: ModelParams -> ModelStatus; fetches only when ``download`` is exactly true."""
    if params.get("download") is True and snapshot_dir() is None:
        done = 0
        for filename, size in MODEL_FILES:
            # Each file's share of the bar by its bytes; a file already in
            # the cache at the commit is returned by media.download unasked.
            span = (done / MODEL_BYTES, (done + size) / MODEL_BYTES)
            media.download(MODEL_REPO, filename, MODEL_REVISION, context, MODEL_LABEL, span)
            done += size
    return model_status()


def _load_model(folder: str, compute_type: str) -> Any:
    """The model in ``folder`` (the snapshot), loaded once per compute type.

    By its path, so ``WhisperModel`` never reaches ``download_model``; and
    ``local_files_only`` besides, so even a path it did not take for a folder
    could only be looked up, never fetched.
    """
    from faster_whisper import WhisperModel

    key = (folder, compute_type)
    with _model_lock:
        if key not in _models:
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

    size = params.get("model") or MODEL_NAME
    if size != MODEL_NAME:
        raise ValueError(f"The speech model is faster-whisper {MODEL_NAME}, pinned; there is no {size!r}")
    language = params.get("language") or None
    # Names and words to listen for: Whisper treats the prompt as text said
    # just before the audio, so a name spelled here is far likelier to be
    # heard as that name (src/shared/transcript.ts vocabularyPrompt).
    prompt = params.get("initialPrompt")
    initial_prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None
    # int8 is 2-4x faster on CPU with negligible quality loss for captions.
    compute_type = params.get("computeType") or "int8"

    folder = snapshot_dir()
    if folder is None:
        raise Unavailable(NOT_DOWNLOADED)

    context.progress(None, f"loading {size}")
    whisper = _load_model(folder, compute_type)
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
