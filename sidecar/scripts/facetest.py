#!/usr/bin/env python3
"""Face-detector measurement for docs/CLIPS.md §4.1 (step 1a).

Runs MediaPipe's Tasks FaceDetector over a clip with the short-range and the
full-range BlazeFace models, on frames ffmpeg decodes UPRIGHT (a phone clip
tagged rotate=90 is turned on decode, so the analysed size follows the upright
side lengths; docs/CLIPS.md §3.1). It writes EVERY detection to a JSON file and
a few annotated frames as PNG, so the boxes can be checked by eye and the run
compared across machines (the Mac, the Surface), and it times the import, the
decode and the detection separately.

It is a measurement tool, never imported by the app. It needs a venv built the
way docs/CLIPS.md §4.3 describes: numpy, absl-py, flatbuffers, certifi and
sounddevice installed normally, then `pip install --no-deps mediapipe==0.10.35`,
and the three empty stub files first on PYTHONPATH (cv2/__init__.py,
matplotlib/__init__.py, matplotlib/pyplot.py). The two .tflite files come from
storage.googleapis.com/mediapipe-models/face_detector/<name>/float16/latest/.

    PYTHONPATH=<stubs> <venv>/bin/python sidecar/scripts/facetest.py \
        --ffmpeg <ffmpeg> --ffprobe <ffprobe> --source <clip> --models <dir> \
        --fps 5 --width 640 1080 --out <dir>

`--no-detect` decodes and writes frames without importing mediapipe, which is
how the plumbing is checked where mediapipe cannot run (the dev sandbox).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

MODELS = ("blaze_face_short_range.tflite", "blaze_face_full_range.tflite")


def probe_upright(ffprobe: str, src: str) -> dict:
    """Width and height AFTER the rotation tag is applied, as ffmpeg decodes."""
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", src],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list") or []:
        if "rotation" in sd:
            rot = int(round(float(sd["rotation"])))
    tag = (v.get("tags") or {}).get("rotate")
    if not rot and tag:
        rot = int(tag)
    if rot % 180:
        w, h = h, w
    num, den = (v.get("avg_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    return {
        "codedWidth": int(v["width"]), "codedHeight": int(v["height"]),
        "width": w, "height": h, "rotation": rot, "fps": fps,
        "codec": v.get("codec_name"), "pixFmt": v.get("pix_fmt"),
        "durationS": float(d["format"].get("duration") or 0),
    }


def analysed_size(edge: int, up_w: int, up_h: int) -> tuple[int, int]:
    """`edge` is the LONG side; the short side follows the upright aspect, even."""
    if up_w >= up_h:
        w, h = edge, int(round(edge * up_h / up_w / 2)) * 2
    else:
        w, h = int(round(edge * up_w / up_h / 2)) * 2, edge
    return w, h


def decode(ffmpeg: str, src: str, start: float, dur: float | None, fps: float, w: int, h: int):
    args = [ffmpeg, "-v", "error", "-ss", f"{start:.3f}"]
    if dur is not None:
        args += ["-t", f"{dur:.3f}"]
    args += ["-i", src, "-an", "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    t0 = time.perf_counter()
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    dt = time.perf_counter() - t0
    n = len(raw) // (w * h * 3)
    frames = np.frombuffer(raw[: n * w * h * 3], np.uint8).reshape(n, h, w, 3).copy()
    return frames, dt


def draw_box(img: np.ndarray, x: int, y: int, bw: int, bh: int, color=(255, 40, 40), t: int = 2) -> None:
    H, W, _ = img.shape
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + bw), min(H, y + bh)
    if x1 <= x0 or y1 <= y0:
        return
    img[y0:min(H, y0 + t), x0:x1] = color
    img[max(0, y1 - t):y1, x0:x1] = color
    img[y0:y1, x0:min(W, x0 + t)] = color
    img[y0:y1, max(0, x1 - t):x1] = color


def save_png(ffmpeg: str, img: np.ndarray, path: Path) -> None:
    h, w, _ = img.shape
    subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
         "-i", "-", "-frames:v", "1", str(path)],
        input=img.tobytes(), check=True,
    )


def run_model(mp, vision, BaseOptions, model_path: Path, frames: np.ndarray, fps: float, min_score: float):
    opts = vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=str(model_path), delegate=BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO,
        min_detection_confidence=min_score,
    )
    det = vision.FaceDetector.create_from_options(opts)
    per_frame = []
    t0 = time.perf_counter()
    for i, f in enumerate(frames):
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f))
        r = det.detect_for_video(img, int(round(i * 1000.0 / fps)))
        dets = []
        for d in r.detections:
            b = d.bounding_box
            dets.append({
                "x": int(b.origin_x), "y": int(b.origin_y), "w": int(b.width), "h": int(b.height),
                "score": round(float(d.categories[0].score), 3),
            })
        per_frame.append(dets)
    dt = time.perf_counter() - t0
    det.close()
    return per_frame, dt


def stability(per_frame) -> dict:
    """Mean absolute jump of the FIRST box's centre between consecutive detected frames, px."""
    centres = [(d[0]["x"] + d[0]["w"] / 2, d[0]["y"] + d[0]["h"] / 2) if d else None for d in per_frame]
    jumps = []
    for a, b in zip(centres, centres[1:]):
        if a and b:
            jumps.append(abs(b[0] - a[0]) + abs(b[1] - a[1]))
    return {
        "consecutivePairs": len(jumps),
        "meanJumpPx": round(float(np.mean(jumps)), 1) if jumps else None,
        "maxJumpPx": round(float(np.max(jumps)), 1) if jumps else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ffmpeg", required=True)
    ap.add_argument("--ffprobe", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--models", default=".", help="directory holding the two .tflite files")
    ap.add_argument("--start", type=float, default=0.0, help="seconds into the clip")
    ap.add_argument("--duration", type=float, default=None, help="seconds to analyse (default: to the end)")
    ap.add_argument("--fps", type=float, default=5.0, help="analysis sample rate")
    ap.add_argument("--width", type=int, nargs="+", default=[640], help="analysed LONG side(s), e.g. 640 1080")
    ap.add_argument("--min-score", type=float, default=0.5)
    ap.add_argument("--out", default="facetest-out", help="directory for boxes.json and the annotated frames")
    ap.add_argument("--dump", type=int, default=8, help="annotated frames to write per model and size")
    ap.add_argument("--no-detect", action="store_true", help="decode and write frames only; never import mediapipe")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    probe = probe_upright(a.ffprobe, a.source)
    print(f"source {probe['codedWidth']}x{probe['codedHeight']} rotation {probe['rotation']} -> upright "
          f"{probe['width']}x{probe['height']}, {probe['codec']} {probe['pixFmt']} {probe['fps']:.3f} fps, "
          f"{probe['durationS']:.1f} s")

    report = {"source": a.source, "probe": probe, "fps": a.fps, "start": a.start, "duration": a.duration,
              "minScore": a.min_score, "runs": []}

    mp = vision = BaseOptions = None
    import_s = None
    if not a.no_detect:
        t0 = time.perf_counter()
        import mediapipe as mp  # noqa: E402  (needs the stubs on PYTHONPATH)
        from mediapipe.tasks.python import vision  # noqa: E402
        from mediapipe.tasks.python.core.base_options import BaseOptions  # noqa: E402
        import_s = time.perf_counter() - t0
        print(f"import mediapipe: {import_s:.2f} s (mediapipe {getattr(mp, '__version__', '?')}, "
              f"python {sys.version.split()[0]})")
        report["importS"] = round(import_s, 3)
        report["mediapipe"] = getattr(mp, "__version__", None)
        report["python"] = sys.version.split()[0]

    for edge in a.width:
        w, h = analysed_size(edge, probe["width"], probe["height"])
        frames, decode_s = decode(a.ffmpeg, a.source, a.start, a.duration, a.fps, w, h)
        n = len(frames)
        print(f"\n[{edge}] analysed at {w}x{h}: {n} frames at {a.fps} fps, decode {decode_s:.2f} s "
              f"({1000 * decode_s / max(n, 1):.1f} ms/frame)")
        run = {"edge": edge, "width": w, "height": h, "frames": n, "decodeS": round(decode_s, 3), "models": {}}
        if a.no_detect:
            for k in np.linspace(0, n - 1, min(a.dump, n)).astype(int) if n else []:
                save_png(a.ffmpeg, frames[k], out / f"frame-{edge}-{k:04d}.png")
            report["runs"].append(run)
            continue
        for name in MODELS:
            path = Path(a.models) / name
            if not path.exists():
                print(f"  {name}: MISSING at {path}")
                run["models"][name] = {"error": f"missing {path}"}
                continue
            try:
                per_frame, det_s = run_model(mp, vision, BaseOptions, path, frames, a.fps, a.min_score)
            except Exception as e:  # a C++ CHECK abort never reaches here; a Python error does
                print(f"  {name}: FAILED {type(e).__name__}: {str(e)[:200]}")
                run["models"][name] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
                continue
            with_det = sum(1 for d in per_frame if d)
            multi = sum(1 for d in per_frame if len(d) > 1)
            stab = stability(per_frame)
            sizes = [d[0]["h"] for d in per_frame if d]
            scores = [d[0]["score"] for d in per_frame if d]
            print(f"  {name}: {with_det}/{n} frames with a detection ({multi} with more than one), "
                  f"{1000 * det_s / max(n, 1):.1f} ms/frame; first-box height "
                  f"{min(sizes) if sizes else '-'}..{max(sizes) if sizes else '-'} px, score "
                  f"{min(scores) if scores else '-'}..{max(scores) if scores else '-'}; "
                  f"centre jump mean {stab['meanJumpPx']} max {stab['maxJumpPx']} px")
            run["models"][name] = {
                "framesWithDetection": with_det, "framesWithMoreThanOne": multi,
                "msPerFrame": round(1000 * det_s / max(n, 1), 2), "stability": stab,
                "boxes": [{"i": i, "t": round(a.start + i / a.fps, 3), "dets": d} for i, d in enumerate(per_frame)],
            }
            # Annotated frames, evenly spaced, every box drawn; missed frames are written too.
            tag = name.replace("blaze_face_", "").replace(".tflite", "")
            for k in np.linspace(0, n - 1, min(a.dump, n)).astype(int) if n else []:
                img = frames[k].copy()
                for d in per_frame[k]:
                    draw_box(img, d["x"], d["y"], d["w"], d["h"])
                save_png(a.ffmpeg, img, out / f"{tag}-{edge}-{k:04d}-{'hit' if per_frame[k] else 'miss'}.png")
        report["runs"].append(run)

    (out / "boxes.json").write_text(json.dumps(report, indent=1))
    print(f"\nwrote {out / 'boxes.json'} and the annotated frames in {out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
