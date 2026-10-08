"""Capability registration.

A capability that cannot run must degrade itself, never take the sidecar down.
Both the import *and* the registration are guarded: a module can import fine and
still fail at register time when its heavy dependency is missing.
"""

from __future__ import annotations

from typing import Callable

from ..rpc import Server

# (every method the module registers, module name).
#
# EVERY method, not one: a module that fails takes all of its methods with it,
# and each must answer "unavailable, because …" rather than "unknown method".
# With one name per module, voice.voices answered METHOD_NOT_FOUND on every
# machine without kokoro (measured 2026-10-08, docs/CLIPS.md §3.6): it said
# the method does not exist instead of why it cannot run. A test holds every
# method in src/shared/sidecar/protocol.ts `OPTIONAL_METHODS` to "in
# capabilities or in degraded" (tests/integration/sidecar.int.test.ts).
OPTIONAL: list[tuple[tuple[str, ...], str]] = [
    (("asr.transcribe",), "asr"),
    (("audio.beats",), "beats"),
    (("depth.layers",), "depth"),
    # Sharpness, exposure and near-duplicates, for the Director's quality gate
    # (docs/PLAN.md §4.2). numpy and scipy only; absent, the gate lets every
    # photo through rather than the Director failing.
    (("vision.measure",), "vision"),
    # Optional in the strongest sense: the app can already split a song with
    # mid/side and the bundled ffmpeg, so this being absent costs quality
    # rather than the feature. See stems.py.
    (("audio.stems",), "stems"),
    # Speech, the local half. Absent, the app uses whatever hosted endpoint the
    # user configured — see src/shared/voice/provider.ts.
    (("voice.speak", "voice.voices"), "voice"),
]


def register_all(server: Server) -> None:
    from . import system

    system.register(server)

    for methods, module_name in OPTIONAL:
        try:
            module = __import__(f"{__name__}.{module_name}", fromlist=["register"])
            register: Callable[[Server], None] = module.register
            register(server)
        except Exception as exc:  # noqa: BLE001 - degrade, never crash
            reason = f"{module_name} unavailable: {exc}"
            for method in methods:
                # All or nothing: a module that failed part-way through its
                # registration may have left a handler that cannot run.
                server.unregister(method)
                server.mark_degraded(method, reason)
