"""The subject of a frame with no face, for the reframe (docs/CLIPS.md §4.4).

A shot where the face finder found nobody still has something worth framing —
a cake, a ring, a dress on a hanger — and BiRefNet already finds the subject of
a still for depth's bakes. This asks it about one decoded frame per item (main
sends the middle frame of every shot with too few face samples) and answers a
box in the same convention as a parallax bake's ``subjectBox``.

Two methods, as the scaffold chose for every model-gated capability
(src/shared/sidecar/protocol.ts, above ModelParams):

- ``vision.salient`` does the work and NEVER downloads. The model is ~115 MB
  that a user who never baked a parallax does not have, and its first fetch is
  a press of a button that names its size (§0, §4.4). Absent, the call is
  ``Unavailable`` before any session is opened: depth's ``_matte_session``
  downloads on a cache miss, so the presence check has to come first.
- ``vision.salientModel`` answers whether the model is on disk, with the bytes
  and host the button names, and fetches it only on ``download: true``.

The session is depth's, under depth's lock: one BiRefNet in memory whichever
capability asked first.
"""

from __future__ import annotations

import os
from typing import Any

from .. import media
from ..rpc import Context, Server, Unavailable
from . import depth

VARIANT = depth.DEFAULT_MATTE_VARIANT

MODEL_BYTES = 114_538_221
"""``onnx/model_fp16.onnx`` at ``depth.MATTE_REVISION``, measured on the dev
Mac's store: what the Get button names (``media._megabytes`` shows 115 MB; the
plan's "109 MB" is du's MiB)."""

LABEL = "the subject finder"
HOST = "huggingface.co"

CUT = 0.5
"""Where the soft matte becomes the subject: depth.py's own cut (``> 0.5``,
depth.py:461), so the coverage and the box mean what a bake's do."""

TRIM = 0.01
"""``_mask_box``'s fringe: rows and columns under 1 % of the busiest one are
not the subject (depth.py ``_mask_box``)."""


# -------------------------------------------------------------------- model


def _model_path() -> str | None:
    """The model file when it is on disk at the pinned commit, else None.

    The same question ``media.download`` asks before it fetches anything
    (``try_to_load_from_cache`` at a commit hash only reads the cache's
    folders), so a True here means depth's session opens without a request. A
    partial download is never an answer: Hugging Face writes the blob as
    ``.incomplete`` and links the snapshot only once it is whole.
    """
    from huggingface_hub import try_to_load_from_cache

    try:
        found = try_to_load_from_cache(
            depth.MATTE_REPO, depth.MATTE_VARIANTS[VARIANT],
            cache_dir=media.models_dir(), revision=depth.MATTE_REVISION,
        )
    except Exception:  # noqa: BLE001 - a cache probe must never be fatal
        return None
    return found if isinstance(found, str) and os.path.isfile(found) else None


def _status() -> dict[str, Any]:
    return {"present": _model_path() is not None, "bytes": MODEL_BYTES, "label": LABEL, "host": HOST}


class _Cancellable:
    """The request's context, with its cancel checked at every progress message.

    ``media.download`` has no cancel of its own: ``hf_hub_download`` reads the
    body in its own loop and calls the progress class once per chunk, which is
    10 MiB in huggingface_hub 1.31 (``DOWNLOAD_CHUNK_SIZE``), so a cancel lands
    within about 9 % of this model. Measured on the Hub, 2026-10-13: cancelled
    at the second message (9 %, 6.3 s after the press), the folder held only
    the lock file — no partial blob, no snapshot link — so ``_model_path`` still
    says absent, and the next press fetched the whole 114,538,221 B again
    (2.4 s on that connection) with the sha256 its blob is named by.
    """

    def __init__(self, context: Context) -> None:
        self._context = context

    def progress(self, progress: float | None, message: str | None = None) -> None:
        self._context.raise_if_cancelled()
        self._context.progress(progress, message)

    def raise_if_cancelled(self) -> None:
        self._context.raise_if_cancelled()


def model(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``vision.salientModel``: ModelParams -> ModelStatus."""
    if params.get("download") is True and _model_path() is None:
        media.download(
            depth.MATTE_REPO, depth.MATTE_VARIANTS[VARIANT], depth.MATTE_REVISION,
            _Cancellable(context), LABEL,
        )
    return _status()


# --------------------------------------------------------------------- work


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")


def _checked(params: dict[str, Any]) -> tuple[list[tuple[str, Any]], str, str, int, int]:
    """The params, or a ValueError that fails the whole call: these are main's mistakes, not a file's."""
    items = params.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("vision.salient needs a non-empty list of items")
    checked: list[tuple[str, Any]] = []
    for index, item in enumerate(items):
        path = item.get("path") if isinstance(item, dict) else None
        ms = item.get("ms") if isinstance(item, dict) else None
        if not isinstance(path, str) or not path:
            raise ValueError(f"vision.salient item {index} needs a path")
        if not _number(ms) or ms < 0:
            raise ValueError(f"vision.salient item {index} needs ms of 0 or more, not {ms!r}")
        checked.append((path, ms))

    ffmpeg = params.get("ffmpeg")
    ffprobe = params.get("ffprobe")
    if not isinstance(ffmpeg, str) or not os.path.isfile(ffmpeg) or not isinstance(ffprobe, str) or not os.path.isfile(ffprobe):
        raise ValueError("vision.salient needs the paths to ffmpeg and ffprobe")

    width, height = params.get("width"), params.get("height")
    if not (_number(width) and _number(height) and width > 0 and height > 0 and int(width) == width and int(height) == height):
        raise ValueError(f"vision.salient needs the upright width and height, not {width!r}×{height!r}")
    return checked, ffmpeg, ffprobe, int(width), int(height)


def _subject(soft: "Any") -> tuple[float, "dict[str, float] | None"]:
    """``(coverage, box)`` of a soft matte: the rule a bake's subjectBox follows.

    depth.py:461-474: the matte cut at 0.5; its share of the frame is the
    coverage; a box only when that share is within MIN_SUBJECT..MAX_SUBJECT
    (1–92 %, inclusive) — under it the matte found a speck, over it the whole
    picture — drawn round the cut once speckle is cleaned (``_clean_mask`` at
    depth.py:445's floor) and trimmed at 1 %. The share is judged before the
    cleaning, as there. The box is normalised by the matte's own sides, so it
    is in the frame the decoder delivered: the UPRIGHT one.
    """
    cut = soft > CUT
    share = float(cut.mean())
    coverage = round(share, 4)
    if not (depth.MIN_SUBJECT <= share <= depth.MAX_SUBJECT):
        return coverage, None
    height, width = cut.shape[:2]
    cleaned = depth._clean_mask(cut, max(64, int(0.0004 * width * height)))
    return coverage, depth._mask_box(cleaned, TRIM)


def salient(params: dict[str, Any], context: Context) -> dict[str, Any]:
    """``vision.salient``: SalientParams -> SalientResult."""
    items, ffmpeg, ffprobe, width, height = _checked(params)
    if _model_path() is None:
        # Before any session: depth's would fetch the file as a side effect.
        # (The file deleted between here and the session's first build would
        # still be fetched by depth._matte_session: depth.py is shared and
        # downloads by design, and that window is one call's first item.)
        raise Unavailable(
            f"{LABEL} is not downloaded yet ({media._megabytes(MODEL_BYTES)} from {HOST})"
        )

    sizes: dict[str, str | None] = {}
    results: list[dict[str, Any]] = []
    total = len(items)
    context.progress(0.0, "finding the subject")
    for index, (path, ms) in enumerate(items):
        context.raise_if_cancelled()
        # One unreadable or mis-sized file costs its own items, not the call.
        if path not in sizes:
            try:
                if not os.path.isfile(path):
                    raise ValueError(f"No such file: {path!r}")
                media.require_upright(path, ffprobe, width, height)
                sizes[path] = None
            except (ValueError, OSError) as exc:  # SizeMismatch is a ValueError
                sizes[path] = str(exc)
        problem = sizes[path]
        if problem is None:
            try:
                rgb = media.decode_rgb(path, ffmpeg, depth.MATTE_SIZE, depth.MATTE_SIZE, at_ms=ms)
            except (ValueError, OSError) as exc:
                problem = str(exc)
        if problem is not None:
            results.append({"ms": ms, "error": problem})
        else:
            coverage, box = _subject(depth._matte_of(rgb, VARIANT, context))
            results.append({"ms": ms, "box": box, "coverage": coverage})
        context.progress((index + 1) / total, "finding the subject")
    return {"results": results}


def register(server: Server) -> None:
    try:
        import numpy  # noqa: F401
        import onnxruntime  # noqa: F401
        import scipy  # noqa: F401
        from huggingface_hub import try_to_load_from_cache  # noqa: F401
    except ImportError as exc:
        raise Unavailable(f"subject finder dependencies are not installed: {exc}") from exc

    server.register("vision.salient", salient)
    server.register("vision.salientModel", model)
