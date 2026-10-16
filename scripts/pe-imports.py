#!/usr/bin/env python3
"""The native imports of the AI helper's pack on Windows, listed (docs/CLIPS.md §3a.6 step 5, §16.45).

For every .pyd and .dll under a folder (the pack's version folder,
`<userData>/python/<n>`), read the PE import directory and the delay-load
directory, and list each imported DLL that Windows would not find without
help:

  - not beside it (its own folder, which Python 3.8+ searches for an
    extension module's dependencies, any case);
  - not in python.exe's folder (the application directory, searched for
    every DLL the process loads: python314.dll, vcruntime140.dll);
  - not part of Windows (kernel32, user32, ..., ucrtbase, api-ms-win-*).

Microsoft's C++ runtimes, MSVCP140*, VCOMP140*, VCRUNTIME140* and
CONCRT140*, are ALWAYS listed, wherever they resolve, because the first one
loaded serves the whole process and a System32 copy older than the one a
binary was built for is a crash class (§3a.8 row 30). Each entry says where
it resolves ("beside it", "python.exe's folder", "elsewhere in the pack",
"not in the pack") and every copy of that name in the pack.

    python scripts/pe-imports.py <folder> [--expected <file>] [--record <file>] [--raw]

The listing is JSON on stdout, sorted. `--expected` compares by MEMBERSHIP:
every listed import, by (file, DLL, where it resolves), must be in the
expected list, and a new one exits 1, named; one that is gone is reported
and is not a failure. An expected list whose `recorded` is false is a
bootstrap: nothing is compared (CI's first Windows run records the full
pack's list as an artifact, and the next commit takes it). `--record` writes
the listing with `recorded: true`. `--raw` prints every file's imports,
unfiltered, instead. A file that is not a readable PE, or a folder with no
.pyd or .dll at all, exits 1.

Stdlib only, Python 3.12+. Run it with -I.
"""

from __future__ import annotations

import argparse
import json
import mmap
import struct
import sys
from pathlib import Path

#: The data directories read (PE/COFF: 1 is the import table, 13 the delay-load import descriptors).
IMPORT_DIRECTORY = 1
DELAY_IMPORT_DIRECTORY = 13

#: Always listed, by prefix, lowercased.
RUNTIMES = ("msvcp140", "vcomp140", "vcruntime140", "concrt140")

#: Part of Windows: never shipped, never listed. Lowercased, without ".dll".
SYSTEM = frozenset(
    """
    advapi32 avrt bcrypt bcryptprimitives cabinet cfgmgr32 clbcatq comctl32 comdlg32 crypt32 cryptbase
    cryptnet cryptsp d2d1 d3d11 d3d12 d3d9 d3dcompiler_47 dbgeng dbghelp dcomp dnsapi dsound dwmapi dwrite
    dxcore dxgi dxva2 esent gdi32 gdiplus glu32 hid imagehlp imm32 iphlpapi kernel32 kernelbase ksuser
    mf mfplat mfreadwrite mfuuid mpr msacm32 msasn1 mscms msctf msi msimg32 msvcrt mswsock ncrypt netapi32
    normaliz ntdll ole32 oleacc oleaut32 opengl32 pdh powrprof propsys psapi rpcrt4 secur32 setupapi
    shcore shell32 shlwapi sspicli ucrtbase urlmon user32 userenv usp10 uxtheme version winhttp wininet
    winmm winspool winsta wintrust wldap32 ws2_32 wsock32 wtsapi32 xinput1_4 xinput9_1_0 comsvcs
    """.split()
)
SYSTEM_PREFIXES = ("api-ms-win-", "ext-ms-win-")

BESIDE = "beside it"
APP_DIR = "python.exe's folder"
ELSEWHERE = "elsewhere in the pack"
NOT_IN_PACK = "not in the pack"


class NotPE(Exception):
    """A .pyd or .dll that does not read as a PE image."""


def stem(dll: str) -> str:
    low = dll.lower()
    return low[:-4] if low.endswith(".dll") else low


def is_runtime(dll: str) -> bool:
    return stem(dll).startswith(RUNTIMES)


def is_system(dll: str) -> bool:
    low = stem(dll)
    return low in SYSTEM or low.startswith(SYSTEM_PREFIXES) or dll.lower() == "winspool.drv"


def _cstring(data: bytes | mmap.mmap, at: int) -> str:
    end = data.find(b"\0", at, at + 512)
    if end < 0:
        raise NotPE(f"an import name at {at:#x} runs past 512 bytes")
    return bytes(data[at:end]).decode("ascii", errors="replace")


def read_imports(data: bytes | mmap.mmap) -> list[tuple[str, bool]]:
    """Every DLL the image imports, in order, as (name, delay-loaded)."""
    try:
        if data[:2] != b"MZ":
            raise NotPE("no MZ header")
        (e_lfanew,) = struct.unpack_from("<I", data, 0x3C)
        if data[e_lfanew : e_lfanew + 4] != b"PE\0\0":
            raise NotPE("no PE signature")
        coff = e_lfanew + 4
        (sections_count,) = struct.unpack_from("<H", data, coff + 2)
        (optional_size,) = struct.unpack_from("<H", data, coff + 16)
        optional = coff + 20
        (magic,) = struct.unpack_from("<H", data, optional)
        if magic == 0x20B:  # PE32+
            (image_base,) = struct.unpack_from("<Q", data, optional + 24)
            count_at, directories_at = optional + 108, optional + 112
        elif magic == 0x10B:  # PE32
            (image_base,) = struct.unpack_from("<I", data, optional + 28)
            count_at, directories_at = optional + 92, optional + 96
        else:
            raise NotPE(f"an optional header of magic {magic:#x}")
        (directories,) = struct.unpack_from("<I", data, count_at)
        sections = []
        for i in range(sections_count):
            virtual_size, virtual_address, raw_size, raw_at = struct.unpack_from("<IIII", data, optional + optional_size + 40 * i + 8)
            sections.append((virtual_address, max(virtual_size, raw_size), raw_at))

        def offset(rva: int) -> int:
            for virtual_address, size, raw_at in sections:
                if virtual_address <= rva < virtual_address + size:
                    return rva - virtual_address + raw_at
            raise NotPE(f"RVA {rva:#x} is in no section")

        def directory(index: int) -> int:
            if index >= directories:
                return 0
            (rva, _size) = struct.unpack_from("<II", data, directories_at + 8 * index)
            return rva

        found: list[tuple[str, bool]] = []
        rva = directory(IMPORT_DIRECTORY)
        if rva:
            at = offset(rva)
            for _ in range(4096):
                original_thunk, stamp, chain, name_rva, thunk = struct.unpack_from("<IIIII", data, at)
                if original_thunk == stamp == chain == name_rva == thunk == 0:
                    break
                found.append((_cstring(data, offset(name_rva)), False))
                at += 20
        rva = directory(DELAY_IMPORT_DIRECTORY)
        if rva:
            at = offset(rva)
            for _ in range(4096):
                attributes, name_rva = struct.unpack_from("<II", data, at)
                if name_rva == 0:
                    break
                # Attribute bit 0 clear: an old-style descriptor holding a VA, not an RVA.
                found.append((_cstring(data, offset(name_rva if attributes & 1 else name_rva - image_base)), True))
                at += 32
        return found
    except struct.error as err:
        raise NotPE(f"truncated ({err})") from err


def imports_of(path: Path) -> list[tuple[str, bool]]:
    with path.open("rb") as handle:
        if path.stat().st_size == 0:
            raise NotPE("empty")
        with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
            return read_imports(data)


def listing(root: Path) -> dict:
    """The pack's PE files and what each imports that Windows would not find without help."""
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in (".pyd", ".dll"))
    if not files:
        raise SystemExit(f"no .pyd or .dll under {root}: is it the pack's version folder?")
    names: dict[str, list[str]] = {}
    for path in root.rglob("*"):
        if path.is_file():
            names.setdefault(path.name.lower(), []).append(path.relative_to(root).as_posix())
    folders: dict[Path, set[str]] = {}

    def in_folder(folder: Path) -> set[str]:
        if folder not in folders:
            folders[folder] = {p.name.lower() for p in folder.iterdir() if p.is_file()}
        return folders[folder]

    interpreters = sorted((Path(root, p) for p in names.get("python.exe", [])), key=lambda p: len(p.parts))
    app_dir = interpreters[0].parent if interpreters else None

    entries, unreadable, raw = [], [], {}
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            imported = imports_of(path)
        except (NotPE, OSError, ValueError) as err:
            unreadable.append({"file": rel, "error": str(err)})
            continue
        raw[rel] = [name for name, _ in imported]
        seen = set()
        for name, delay in imported:
            low = name.lower()
            if low in seen:
                continue
            seen.add(low)
            if low in in_folder(path.parent):
                where = BESIDE
            elif app_dir is not None and low in in_folder(app_dir):
                where = APP_DIR
            elif low in names:
                where = ELSEWHERE
            else:
                where = NOT_IN_PACK
            if not is_runtime(name) and (where in (BESIDE, APP_DIR) or (where == NOT_IN_PACK and is_system(name))):
                continue
            entries.append({"file": rel, "imports": name, "delay": delay, "resolves": where, "copies": sorted(names.get(low, []))})
    entries.sort(key=lambda e: (e["file"], e["imports"].lower()))
    return {"files": len(files), "imports": entries, "unreadable": unreadable, "raw": raw}


def key(entry: dict) -> tuple[str, str, str]:
    return (entry["file"], entry["imports"].lower(), entry["resolves"])


def compare(found: list[dict], expected: list[dict]) -> tuple[list[dict], list[dict]]:
    """(new, gone): by membership on (file, DLL, where it resolves)."""
    want = {key(e) for e in expected}
    have = {key(e) for e in found}
    return [e for e in found if key(e) not in want], [e for e in expected if key(e) not in have]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--expected", type=Path)
    parser.add_argument("--record", type=Path)
    parser.add_argument("--raw", action="store_true")
    args = parser.parse_args(argv)

    result = listing(args.folder)
    if args.raw:
        json.dump(result["raw"], sys.stdout, indent=1, sort_keys=True)
        print()
        return 1 if result["unreadable"] else 0
    out = {"recorded": True, "files": result["files"], "imports": result["imports"], "unreadable": result["unreadable"]}
    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    print()
    if args.record:
        args.record.parent.mkdir(parents=True, exist_ok=True)
        args.record.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    code = 0
    for bad in result["unreadable"]:
        print(f"UNREADABLE: {bad['file']}: {bad['error']}", file=sys.stderr)
        code = 1
    outside = sum(1 for e in result["imports"] if e["resolves"] == NOT_IN_PACK)
    print(f"{result['files']} PE files; {len(result['imports'])} imports listed, {outside} of them not in the pack", file=sys.stderr)
    if args.expected:
        expected = json.loads(args.expected.read_text(encoding="utf-8"))
        if expected.get("recorded") is not True:
            print(f"{args.expected} is a bootstrap (recorded: false): listed, nothing compared", file=sys.stderr)
            return code
        new, gone = compare(result["imports"], expected.get("imports", []))
        for e in gone:
            print(f"no longer: {e['file']} imports {e['imports']} ({e['resolves']})", file=sys.stderr)
        for e in new:
            copies = ", ".join(e["copies"]) or "none"
            print(f"NEW: {e['file']} imports {e['imports']}{' (delay-loaded)' if e['delay'] else ''}, {e['resolves']}; copies in the pack: {copies}", file=sys.stderr)
        if new:
            print(f"{len(new)} import(s) not in {args.expected}", file=sys.stderr)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
