"""The helper's shared media code: probing, decoding, folders and downloads.

Every capability that reads a picture needs the same few things, and each of
them carries a measured fact that a second copy would drift from
(docs/CLIPS.md §3.6). They live here, once:

- ``probe_upright`` — the size the DECODER delivers. ffmpeg turns a phone clip
  upright as it decodes it ("autorotate", from the display matrix in the file's
  side data), so a 640×360 clip stored with a 90° matrix arrives as 360×640
  frames while ffprobe's ``width``/``height`` still say 640×360. Measured with
  the bundled ffmpeg (docs/EFFECTS.md §49): ``scale=320:-2`` of such a clip
  came out 320×568. Only the matrix counts — the 2018 Windows build's
  ``get_rotation`` reads the side data and nothing else (fftools/cmdutils.c
  :2175-2192 at f22fcd4) — so the legacy ``rotate`` tag is never read here: a
  file with the tag and no matrix is NOT turned by the decoder.
- ``decode_rgb`` / ``iter_frames`` — one frame, or a stream of them, at an
  exact size. A whole video through ``capture_output`` was 414,720,000 bytes
  for 20 s at 640×360; streaming reads one frame at a time and kills ffmpeg the
  moment the caller stops (50 frames then stop: 0.089 s, measured,
  docs/EFFECTS.md §50).
- ``models_dir`` / ``cache_dir`` — where downloads and bakes go. The app passes
  both as environment variables pointing under its own userData
  (src/main/sidecar/service.ts); the ``~/.cache/forge`` fallbacks are for the
  helper run by hand.
- ``download`` / ``fetch_url`` — a model file, from Hugging Face at a PINNED
  commit or from any URL against its sha256, with byte progress.

Imports nothing beyond the standard library at module level: the helper must
start on a bare interpreter (CI runs one with no ``pip install``), so numpy and
huggingface_hub are imported inside the functions that need them.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
from typing import TYPE_CHECKING, Any, Iterator

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .rpc import Context

# A packaged app has no console of its own; a console child spawned without
# this would open a window on Windows. The helper's own spawn passes
# windowsHide, and its children say the same (CLAUDE.md, "Spawning").
_NO_WINDOW: dict[str, Any] = (
    {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
)

COMMIT = re.compile(r"[0-9a-f]{40}")
"""A Hugging Face revision that cannot move: a full commit hash. A branch name
such as ``main`` would hand a new machine whatever was pushed last."""


class SizeMismatch(ValueError):
    """The file's upright size is not the size main sent.

    Raised rather than answering: a box normalised against the wrong frame
    would be laid on the wrong axes by the caller, silently.
    """


# ------------------------------------------------------------------ probing


def display_rotation(stream: dict[str, Any]) -> int:
    """Clockwise degrees the decoder turns this stream's coded picture.

    The same arithmetic as ffmpeg's ``get_rotation``: the display matrix's
    counter-clockwise angle negated, folded into [0, 360). A right angle is
    returned exactly (within a degree, as ffmpeg decides it); any other angle
    is rounded, and ffmpeg turns those in place with ``rotate`` rather than
    swapping the sides.
    """
    for entry in stream.get("side_data_list") or []:
        raw = entry.get("rotation") if isinstance(entry, dict) else None
        try:
            angle = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(angle):
            continue
        theta = -angle
        theta -= 360 * math.floor(theta / 360 + 0.9 / 360)
        for right in (0, 90, 180, 270, 360):
            if abs(theta - right) < 1.0:
                return right % 360
        return int(round(theta)) % 360
    return 0


def _rate(text: Any) -> float | None:
    if not isinstance(text, str) or "/" not in text:
        return None
    num, _, den = text.partition("/")
    try:
        value = float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        return None
    return value if math.isfinite(value) and value > 0 else None


def probe_upright(path: str, ffprobe: str) -> dict[str, Any]:
    """The first picture stream as the decoder will deliver it.

    ``{width, height, rotation, durationMs, fps}``: the sides swapped when the
    decoder turns the picture a quarter, ``rotation`` the clockwise turn
    (``display_rotation``), ``durationMs`` and ``fps`` None for a still.
    """
    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_streams", "-show_format", "-of", "json", path],
        capture_output=True, check=False, **_NO_WINDOW,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise ValueError(message or f"Could not read image dimensions: {path}")
    data = json.loads(result.stdout or b"{}")
    streams = data.get("streams") or []
    if not streams:
        raise ValueError(f"No image stream in {path}")
    stream = streams[0]
    width, height = int(stream["width"]), int(stream["height"])
    rotation = display_rotation(stream)
    if rotation in (90, 270):
        width, height = height, width

    container = (data.get("format") or {}).get("format_name") or ""
    # A still probes as one frame at image2's nominal 25 fps (a JPEG as 0.04 s,
    # a PNG through png_pipe with no duration at all); it has neither.
    still = container == "image2" or container.endswith("_pipe")
    seconds: float | None = None
    for raw in ((data.get("format") or {}).get("duration"), stream.get("duration")):
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            seconds = value
            break
    if still:
        seconds = None
    fps = None if still else _rate(stream.get("avg_frame_rate"))
    return {
        "width": width,
        "height": height,
        "rotation": rotation,
        "durationMs": int(round(seconds * 1000)) if seconds is not None else None,
        "fps": fps,
    }


def require_upright(path: str, ffprobe: str, width: Any, height: Any) -> dict[str, Any]:
    """``probe_upright``, refusing a file whose upright size is not ``width``×``height``.

    The rule for every capability that is sent a size by main and answers in
    that frame's coordinates (docs/CLIPS.md §3.1) — faces.py (§4.3) is the
    first. Main's asset size is the probe's upright size too
    (src/main/ffmpeg/probe.ts), so a disagreement means the asset is stale or
    the wrong file was sent, and a box normalised against either frame would be
    laid on the wrong axes.
    """
    probed = probe_upright(path, ffprobe)
    try:
        sent = (int(width), int(height))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"A size is needed for {path!r}, got {width!r}×{height!r}") from exc
    if (probed["width"], probed["height"]) != sent:
        raise SizeMismatch(
            f"{os.path.basename(path)} is {probed['width']}×{probed['height']} upright "
            f"(turned {probed['rotation']}°), but {sent[0]}×{sent[1]} was sent"
        )
    return probed


# ----------------------------------------------------------------- decoding


def _seconds(ms: float) -> str:
    return f"{ms / 1000:.3f}"


def decode_args(
    path: str, ffmpeg: str, width: int, height: int, at_ms: float | None = None
) -> list[str]:
    """The ffmpeg argv ``decode_rgb`` runs: pure, so the floor test can scan it."""
    seek = ["-ss", _seconds(at_ms)] if at_ms is not None and at_ms > 0 else []
    return [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        *seek, "-i", path, "-frames:v", "1",
        "-vf", f"scale={width}:{height}:flags=bicubic",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ]


def decode_rgb(
    path: str, ffmpeg: str, width: int, height: int, at_ms: float | None = None
) -> "Any":
    """One frame as an RGB array (height × width × 3, uint8) at an exact size.

    ``at_ms`` seeks with ``-ss`` BEFORE ``-i``: the fast seek, frame-exact when
    transcoding (30–80 ms a seek, measured for docs/CLIPS.md §3.6). Zero or
    None does not seek at all: ANY ``-ss`` before a JPEG — even ``-ss 0`` —
    gives no frame on the bundled ffmpeg ("Output file is empty", measured
    2026-10-08, EFFECTS.md §49), so a still is never seeked. One frame whatever
    the input, so a video handed in by mistake costs one frame, not the whole
    file in memory. Images go through the bundled ffmpeg for the same reason
    audio does: one decoding path in the product, and no compiled Python
    imaging dependency.
    """
    import numpy as np

    result = subprocess.run(
        decode_args(path, ffmpeg, width, height, at_ms),
        capture_output=True, check=False, **_NO_WINDOW,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise ValueError(message or "ffmpeg could not decode this image")
    expected = width * height * 3
    if len(result.stdout) != expected:
        raise ValueError(
            f"Decoded {len(result.stdout)} bytes, expected {expected} "
            f"for {width}x{height}"
        )
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(height, width, 3)


def _read_exact(stream: Any, count: int) -> bytes:
    """``count`` bytes, or fewer only at the end of the stream."""
    parts: list[bytes] = []
    remaining = count
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            break
        parts.append(chunk)
        remaining -= len(chunk)
    return b"".join(parts)


def frame_args(
    path: str, ffmpeg: str, fps: float, width: int, height: int,
    start_ms: float = 0, end_ms: float | None = None,
) -> list[str]:
    """The ffmpeg argv ``iter_frames`` runs: pure, so the floor test can scan it."""
    seek = ["-ss", _seconds(start_ms)] if start_ms > 0 else []
    span = ["-t", _seconds(end_ms - start_ms)] if end_ms is not None else []
    return [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        *seek, "-i", path, *span, "-an",
        "-vf", f"fps={fps},scale={width}:{height}:flags=bicubic",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ]


def iter_frames(
    path: str, ffmpeg: str, fps: float, width: int, height: int,
    start_ms: float = 0, end_ms: float | None = None,
    context: "Context | None" = None,
) -> Iterator[tuple[int, "Any"]]:
    """``(ms, frame)`` at ``fps`` from ``start_ms`` to ``end_ms``, streamed.

    One frame of exactly ``width*height*3`` bytes at a time from a Popen pipe,
    the request's cancellation checked before each, and ffmpeg killed in
    ``finally`` — so a caller that stops early (a cancel, an exception, a
    ``break``) never leaves a decoder running or a video in memory. ``ms`` is
    the frame's time in the source: ``start_ms + i × 1000 / fps``, rounded.
    ffmpeg's errors go to a temporary file rather than a pipe nobody reads,
    which would fill and stall the decoder.
    """
    if width <= 0 or height <= 0 or fps <= 0:
        raise ValueError(f"Cannot stream frames at {width}x{height}, {fps} fps")
    if end_ms is not None and end_ms <= start_ms:
        return
    import numpy as np

    size = width * height * 3
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            frame_args(path, ffmpeg, fps, width, height, start_ms, end_ms),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors,
            **_NO_WINDOW,
        )
        try:
            index = 0
            while True:
                if context is not None:
                    context.raise_if_cancelled()
                chunk = _read_exact(process.stdout, size)
                if not chunk:
                    break
                if len(chunk) != size:
                    raise ValueError(
                        f"ffmpeg stopped part-way through frame {index}: "
                        f"{len(chunk)} of {size} bytes"
                    )
                ms = int(round(start_ms + index * 1000 / fps))
                yield ms, np.frombuffer(chunk, dtype=np.uint8).reshape(height, width, 3)
                index += 1
            if process.wait() != 0:
                errors.seek(0)
                message = errors.read().decode("utf-8", "replace").strip()
                raise ValueError(message or f"ffmpeg could not decode {path}")
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdout is not None:
                process.stdout.close()


# ------------------------------------------------------------------ folders


def models_dir() -> str:
    """Where model files are downloaded: ``$FORGE_MODELS_DIR``, else ``~/.cache/forge/models``.

    The app always passes the variable (userData/models,
    src/main/sidecar/service.ts); docs/SIDECAR.md's rule is never to default a
    real install to ``~/.cache``.
    """
    override = os.environ.get("FORGE_MODELS_DIR")
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".cache", "forge", "models")


def cache_dir(name: str) -> str:
    """One cache's folder: ``$FORGE_CACHE_DIR/<name>``, else ``~/.cache/forge/<name>``.

    The app passes ``FORGE_CACHE_DIR`` (userData/helper-cache), so every new
    bake made through here lands under userData. stems.py does not use it yet:
    it falls back to ``~/.cache/forge/stems`` because main sends no ``outDir``. The old ``~/.cache/forge/parallax`` (264 MB,
    measured) is left exactly where it is — the user's decision, docs/CLIPS.md
    §16.24 — and with the variable set nothing reads, moves or deletes it.
    ``name`` is one folder name, never a path.
    """
    if not isinstance(name, str) or not name or name in (".", "..") or re.search(r"[\\/:]", name):
        raise ValueError(f"A cache is named by one folder name, not {name!r}")
    base = os.environ.get("FORGE_CACHE_DIR") or os.path.join(
        os.path.expanduser("~"), ".cache", "forge"
    )
    return os.path.join(base, name)


# ---------------------------------------------------------------- downloads


def _megabytes(count: float) -> str:
    return "under 1 MB" if count < 500_000 else f"{round(count / 1_000_000)} MB"


def progress_class(
    context: "Context | None", label: str, span: tuple[float, float] = (0.0, 1.0)
) -> type:
    """A tqdm-shaped class that forwards a download's bytes to the request.

    ``hf_hub_download(tqdm_class=…)`` builds it with ``total`` and ``initial``
    and calls ``update(n)`` per chunk (huggingface_hub 1.31.0, read:
    ``http_get`` → ``_create_progress_bar``, which calls a class that is not
    its own tqdm subclass with the keyword arguments alone). The fraction is
    mapped into ``span`` so the caller's bar never runs backwards, and only a
    whole new percent is sent, so a 115 MB file is at most a hundred messages.
    """
    low, high = span

    class Bytes:
        def __init__(self, *_args: Any, total: Any = None, initial: Any = 0, **_kwargs: Any) -> None:
            self.total = total if isinstance(total, (int, float)) and total > 0 else None
            self.n = initial if isinstance(initial, (int, float)) else 0
            self._sent = -1
            self._report()

        def _report(self) -> None:
            if context is None:
                return
            if self.total is None:
                if self._sent == -1:
                    self._sent = 0
                    context.progress(None, f"downloading {label} (first run only)")
                return
            fraction = min(1.0, max(0.0, self.n / self.total))
            percent = int(fraction * 100)
            if percent == self._sent:
                return
            self._sent = percent
            context.progress(
                low + (high - low) * fraction,
                f"downloading {label} ({_megabytes(self.total)}, first run only)",
            )

        def update(self, n: Any = 1) -> None:
            self.n += n or 0
            self._report()

        def close(self) -> None:
            pass

        def refresh(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def set_description(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def __enter__(self) -> "Bytes":
            return self

        def __exit__(self, *_exc: Any) -> bool:
            self.close()
            return False

    return Bytes


def download(
    repo: str, filename: str, revision: str, context: "Context | None", label: str,
    span: tuple[float, float] = (0.0, 1.0),
) -> str:
    """A file from Hugging Face at a pinned commit, into ``models_dir()``; its local path.

    A file already in the cache at that commit is returned without a request
    (huggingface_hub returns a commit hash's snapshot directly). Otherwise the
    bytes are forwarded as progress — the first bake on a new machine fetches
    up to 115 MB, and a frozen-looking bar was what "estimating depth" used to
    show for it.
    """
    if not isinstance(revision, str) or not COMMIT.fullmatch(revision):
        raise ValueError(f"{repo}/{filename}: pin a commit hash, not {revision!r}")
    from huggingface_hub import hf_hub_download, try_to_load_from_cache

    cache = models_dir()
    try:
        found = try_to_load_from_cache(repo, filename, cache_dir=cache, revision=revision)
    except Exception:  # noqa: BLE001 - a cache probe must never be fatal
        found = None
    if isinstance(found, str) and os.path.isfile(found):
        return found
    return hf_hub_download(
        repo, filename, revision=revision, cache_dir=cache,
        tqdm_class=progress_class(context, label, span),
    )


def _safe_name(name: str) -> str:
    """A file name Windows accepts: no ``< > : " / \\ | ? *``, no trailing dot or space."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).rstrip(". ")
    return cleaned or "download"


def fetch_url(
    url: str, sha256: str, context: "Context | None", label: str,
    span: tuple[float, float] = (0.0, 1.0),
) -> str:
    """A file that is not on Hugging Face, checked against its sha256; its local path.

    Kept in ``models_dir()/files`` under a name carrying the hash's first 16
    digits, written as a ``.part`` and moved into place only once the whole
    file hashes right, so a cut connection or a changed file never leaves
    something that looks finished. A wrong hash raises and keeps nothing.
    """
    import urllib.parse
    import urllib.request

    digest = sha256.lower() if isinstance(sha256, str) else ""
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError(f"{url}: a sha256 of 64 hex digits is needed, not {sha256!r}")
    leaf = os.path.basename(urllib.parse.urlparse(url).path)
    folder = os.path.join(models_dir(), "files")
    target = os.path.join(folder, f"{digest[:16]}-{_safe_name(leaf)}")
    if os.path.isfile(target):
        return target

    os.makedirs(folder, exist_ok=True)
    partial = f"{target}.{os.getpid()}.part"
    hasher = hashlib.sha256()
    try:
        with urllib.request.urlopen(url, timeout=60) as response, open(partial, "wb") as out:
            length = response.headers.get("Content-Length") if hasattr(response, "headers") else None
            total = int(length) if length and str(length).isdigit() else None
            bar = progress_class(context, label, span)(total=total)
            while True:
                if context is not None:
                    context.raise_if_cancelled()
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                hasher.update(chunk)
                out.write(chunk)
                bar.update(len(chunk))
        if hasher.hexdigest() != digest:
            raise ValueError(
                f"{label}: the file from {url} does not match its sha256 "
                f"(got {hasher.hexdigest()[:16]}…, expected {digest[:16]}…)"
            )
        os.replace(partial, target)
    finally:
        if os.path.exists(partial):
            os.remove(partial)
    return target
