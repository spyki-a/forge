"""Handshake and liveness."""

from __future__ import annotations

import platform
import sys
import time
from typing import Any

from ..rpc import Context, Server, PROTOCOL_VERSION


def register(server: Server) -> None:
    def hello(_params: dict[str, Any], _context: Context) -> dict[str, Any]:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "python": sys.version.split()[0],
            "platform": f"{platform.system()}-{platform.machine()}",
            "capabilities": server.capabilities,
            "degraded": server.degraded,
            # Which interpreter answered (docs/CLIPS.md §3a.2): the Settings
            # row names it, and the pack's tests check that every path entry
            # is inside the pack or the helper's own folder.
            "executable": sys.executable,
            "prefix": sys.prefix,
            "path": list(sys.path),
        }

    def ping(params: dict[str, Any], _context: Context) -> dict[str, Any]:
        return {"pong": params.get("echo"), "at": time.time()}

    def sleep(params: dict[str, Any], context: Context) -> dict[str, Any]:
        """Cancellable busy-work. Exists so the transport's progress and cancel
        paths can be tested end to end without loading a model."""
        seconds = float(params.get("seconds", 1.0))
        steps = max(1, int(seconds * 20))
        for step in range(steps):
            context.raise_if_cancelled()
            time.sleep(seconds / steps)
            context.progress((step + 1) / steps, f"step {step + 1}/{steps}")
        return {"slept": seconds}

    server.register("system.hello", hello)
    server.register("system.ping", ping)
    server.register("system.sleep", sleep)
