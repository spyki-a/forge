#!/usr/bin/env python3
"""The AI helper's pack: the two locks, the completeness check, the manifest.

    sidecar/.venv/bin/python -I scripts/pack_lock.py [--check-github] [--bump] [--licences]

docs/CLIPS.md §3a.1 ("The wheels", "The base pack, and what is not in it",
"The lock"). The installers ship no Python; the app installs a pinned CPython
from python-build-standalone and the base pack's wheels into it, offline, from
files it fetched itself and checked against what this script writes:

    sidecar/pack/lock-darwin-arm64.txt   pip's format, one `name==version --hash=sha256:<hex>` per line
    sidecar/pack/lock-win32-x64.txt
    sidecar/pack/resolved.json           every file's name, size, upload time, URL and sha256, and each
                                         distribution's Requires-Dist, raw and evaluated per target
    sidecar/pack/history.json            each pack number -> its lock and interpreter sha256 per platform
    src/shared/sidecar/packManifest.ts   HELPER_PACK, read by the app; never edited by hand

Where the pins come from. The ROOTS are the three requirements files
(requirements.txt, requirements-faces.txt, requirements-faces-nodeps.txt).
Every transitive package is pinned to the version the dev venv runs, read with
importlib.metadata under this interpreter, so the script must be run by the dev
venv's own python. pip is never locked: the interpreter ships pip 26.2.1
pre-installed. A package a target's markers pull in that the venv does not have
(it was built on the Mac) is pinned in EXTRA_PINS: today exactly colorama, by
tqdm's `platform_system == "Windows"`.

Why the markers are evaluated here. pip's --platform changes the wheel tags it
accepts but evaluates environment markers for the HOST, so a Windows lock made
on the Mac with pip would miss colorama. Each target's marker environment is
written out below and evaluated with packaging.markers, with no extras.

How each wheel is picked: as pip ranks them, by packaging.tags. The supported
tags for cp314 are cpython_tags + compatible_tags (abi3 included: av is abi3),
on macOS for the pack's floor, 14.0 (mac_platforms((14, 0), 'arm64'): that is
what makes onnxruntime's and av's macosx_14_0 wheels pickable), and win_amd64.
The best-ranked wheel whose tags intersect wins. A distribution with no wheel
for a target fails the run: nothing is ever built from an sdist.

THE COMPLETENESS CHECK. The pack installs in one pip run with --no-deps, so a
missing transitive package would show up only as a degraded capability on a
user's machine. The run fails unless every Requires-Dist of every lock line,
read from that wheel's own METADATA (PEP 658, files.pythonhosted.org) with the
target's markers and no extras, is in that target's lock and admits the locked
version, against ONE allowlist: mediapipe's matplotlib and
opencv-contrib-python, which the stub route stands in for (CLIPS §4.3).

The pack number. history.json maps each number to its pair of hashes per
platform. A run whose lock or interpreter differs from the newest number's
fails unless --bump is given, which writes the next number. The number names
the install folder (userData/python/<pack>/), so a changed lock under an old
number would read as installed on a machine that has the old one.

Network: pypi.org (JSON), files.pythonhosted.org (each picked wheel's .metadata
only; no wheel is downloaded), and with --check-github api.github.com. TLS
goes through certifi, since python.org's build may not find the system's
certificates. Standard library, packaging and certifi only.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import email.parser
import email.policy
import gzip
import hashlib
import http.client
import json
import posixpath
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from importlib import metadata
from pathlib import Path

try:
    import certifi
    from packaging.markers import Marker
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from packaging.tags import compatible_tags, cpython_tags, mac_platforms
    from packaging.utils import canonicalize_name, parse_wheel_filename
    from packaging.version import Version
except ImportError as e:  # pragma: no cover - a message, not a feature
    sys.exit(f'pack_lock.py needs packaging and certifi; run it with sidecar/.venv/bin/python -I ({e})')

REPO = Path(__file__).resolve().parent.parent
SIDECAR = REPO / 'sidecar'
PACK_DIR = SIDECAR / 'pack'
HISTORY = PACK_DIR / 'history.json'
RESOLVED = PACK_DIR / 'resolved.json'
MANIFEST_TS = REPO / 'src' / 'shared' / 'sidecar' / 'packManifest.ts'
PROTOCOL_TS = REPO / 'src' / 'shared' / 'sidecar' / 'protocol.ts'

ROOT_FILES = ('requirements.txt', 'requirements-faces.txt', 'requirements-faces-nodeps.txt')

# The interpreter ships pip 26.2.1 pre-installed (build-cpython.sh, CLIPS §3a.1).
NOT_LOCKED = frozenset({'pip'})

# The one allowlist: what the stub route stands in for (CLIPS §4.3, SIDECAR.md).
# hf-xet joins it as huggingface-hub's once it leaves the lock (§3a.8 row 35).
ALLOWLIST: dict[str, frozenset[str]] = {
    'mediapipe': frozenset({'matplotlib', 'opencv-contrib-python'}),
}

# Packages a target needs that the dev venv (built on the Mac) does not have.
# colorama 0.4.6 is the newest release on PyPI at 2026-10-14 (uploaded
# 2022-10-25T02:36:20Z, py2.py3-none-any, 25,335 B); tqdm 4.70.1 asks for it
# with no version specifier, `colorama; platform_system == "Windows"`.
EXTRA_PINS: dict[str, str] = {
    'colorama': '0.4.6',
}

PYTHON_VERSION = '3.14.8'
PYTHON_BUILD = '20261001'
PBS_REPO = 'astral-sh/python-build-standalone'

# The interpreter pins: GitHub's per-asset `digest` for release 20261001, read
# 2026-10-14 (CLIPS §3a.1). --check-github reads them again.
INTERPRETERS = {
    'darwin-arm64': {
        'name': 'cpython-3.14.8+20261001-aarch64-apple-darwin-install_only_stripped.tar.gz',
        'bytes': 26_680_498,
        'sha256': '69e48cd7f54261df5b6abbd374f69fe6e496fa781d271592aeef49cd5ffbea6c',
    },
    'win32-x64': {
        'name': 'cpython-3.14.8+20261001-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
        'bytes': 23_227_899,
        'sha256': 'b7ff8b700995379e425b39abce9b087d84a45aa265ea465c0069c2747ea5b2ea',
    },
}

# What the install's self-test must see registered (CLIPS §3a.2). Never a stems
# or voice method: neither is in the base pack (§16.39).
EXPECTS = (
    'asr.transcribe',
    'audio.beats',
    'depth.layers',
    'vision.measure',
    'vision.faces',
    'vision.facesModel',
    'vision.salient',
    'vision.salientModel',
)

# Pre-CI measurements (CLIPS §3a.1, §3a.2), replaced by CI's install (§3a.8
# row 28). All relative to the version folder (userData/python/<pack>/).
#
# macOS: the 47 distributions' files in the dev venv, every RECORD entry
# stat()ed on disk (587,943,059 B, .pyc included), plus the interpreter's
# 69,430,272 B of tar. Paths: the longest is onnxruntime's
# RuntimeOptimizationRecordContainerEntry .pyc, 125 characters under
# site-packages + 36 for `python/lib/python3.14/site-packages/`; the longest
# directory numpy's dist-info/licenses/…/pythoncapi-compat, 71 + 36. The
# interpreter's own tree is not in these (row 26 unpacks it).
#
# Windows: the 48 cp314 wheels' central directories, 556,756,305 B, plus pip's
# compile at the dev venv's .pyc/.py byte ratio (105,047,119 / 79,995,354)
# over their 77,229,712 B of .py, plus 63,299,584 B of interpreter tar. Paths:
# the same .pyc, 125 under site-packages + 25 for `python\Lib\site-packages\`,
# and the longest directory 71 + 25. (§3a.2's 141 is that .pyc's temporary
# name, 125 + 16, which the path check adds itself.)
MAC_PACKAGES_ON_DISK = 587_943_059
MAC_INTERPRETER_TAR = 69_430_272
WIN_WHEEL_INDEX_BYTES = 556_756_305
WIN_PY_BYTES = 77_229_712
VENV_PYC_BYTES = 105_047_119
VENV_PY_BYTES = 79_995_354
WIN_INTERPRETER_TAR = 63_299_584
LONGEST_PYC_UNDER_SITE_PACKAGES = 125
LONGEST_DIR_UNDER_SITE_PACKAGES = 71


def _win_bytes_on_disk() -> int:
    return WIN_WHEEL_INDEX_BYTES + round(WIN_PY_BYTES * VENV_PYC_BYTES / VENV_PY_BYTES) + WIN_INTERPRETER_TAR


TARGETS: dict[str, dict] = {
    'darwin-arm64': {
        'markers': {
            'implementation_name': 'cpython',
            'implementation_version': PYTHON_VERSION,
            'os_name': 'posix',
            'platform_machine': 'arm64',
            'platform_python_implementation': 'CPython',
            'platform_system': 'Darwin',
            'python_full_version': PYTHON_VERSION,
            'python_version': '3.14',
            'sys_platform': 'darwin',
            # Never guessed: a marker that reads either fails the run (below).
            'platform_release': '',
            'platform_version': '',
        },
        'platforms': lambda: list(mac_platforms((14, 0), 'arm64')),
        'python': 'python/bin/python3.14',
        'minOs': '14.0',
        'bytesOnDisk': MAC_PACKAGES_ON_DISK + MAC_INTERPRETER_TAR,
        'longestPath': LONGEST_PYC_UNDER_SITE_PACKAGES + len('python/lib/python3.14/site-packages/'),
        'longestDir': LONGEST_DIR_UNDER_SITE_PACKAGES + len('python/lib/python3.14/site-packages/'),
    },
    'win32-x64': {
        'markers': {
            'implementation_name': 'cpython',
            'implementation_version': PYTHON_VERSION,
            'os_name': 'nt',
            'platform_machine': 'AMD64',
            'platform_python_implementation': 'CPython',
            'platform_system': 'Windows',
            'python_full_version': PYTHON_VERSION,
            'python_version': '3.14',
            'sys_platform': 'win32',
            'platform_release': '',
            'platform_version': '',
        },
        'platforms': lambda: ['win_amd64'],
        'python': 'python/python.exe',
        'minOs': None,
        'bytesOnDisk': _win_bytes_on_disk(),
        'longestPath': LONGEST_PYC_UNDER_SITE_PACKAGES + len('python\\Lib\\site-packages\\'),
        'longestDir': LONGEST_DIR_UNDER_SITE_PACKAGES + len('python\\Lib\\site-packages\\'),
    },
}

UNGUESSED_MARKERS = ('platform_release', 'platform_version')

FILES_HOST = 'files.pythonhosted.org'


class LockError(Exception):
    """A reason the locks cannot be written. The run exits non-zero with it."""


# ------------------------------------------------------------------- network

_TLS = ssl.create_default_context(cafile=certifi.where())


class _Status(Exception):
    def __init__(self, status: int, location: str | None):
        super().__init__(f'HTTP {status}')
        self.status = status
        self.location = location


def _get_once(url: str) -> bytes:
    """One GET over http.client, through the environment's HTTPS proxy if any.

    Not urllib.request.urlopen: it sends `Connection: close`, and the dev
    sandbox's proxy then cut the body short (pypi.org's faster-whisper JSON,
    gzip, 6,564 B: 1 of 15 complete, every other stopped at 4,134 B; curl 15 of
    15). The same request without that header, keep-alive, came back whole 10
    of 10 (measured 2026-10-14)."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname:
        raise LockError(f'refusing to fetch {url}: https only')
    host = parts.hostname
    path = parts.path + (f'?{parts.query}' if parts.query else '')
    proxy = urllib.request.getproxies().get('https')
    if proxy and not urllib.request.proxy_bypass(host):
        p = urllib.parse.urlsplit(proxy if '://' in proxy else f'http://{proxy}')
        headers = {}
        if p.username:
            cred = f'{urllib.parse.unquote(p.username)}:{urllib.parse.unquote(p.password or "")}'
            headers['Proxy-Authorization'] = 'Basic ' + base64.b64encode(cred.encode()).decode()
        conn = http.client.HTTPSConnection(p.hostname, p.port or 80, context=_TLS, timeout=60)
        conn.set_tunnel(host, parts.port or 443, headers=headers)
    else:
        conn = http.client.HTTPSConnection(host, parts.port or 443, context=_TLS, timeout=60)
    try:
        conn.request(
            'GET',
            path,
            headers={'User-Agent': 'forge-pack-lock/1', 'Accept-Encoding': 'gzip', 'Accept': '*/*'},
        )
        r = conn.getresponse()
        body = r.read()
        if r.status != 200:
            raise _Status(r.status, r.getheader('Location'))
        if r.getheader('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        return body
    finally:
        conn.close()


def fetch(url: str, attempts: int = 6) -> bytes:
    """GET with gzip, redirects and retries."""
    last: Exception | None = None
    redirects = 0
    attempt = 0
    while attempt < attempts:
        try:
            return _get_once(url)
        except _Status as e:
            if e.status in (301, 302, 303, 307, 308) and e.location and redirects < 5:
                url = urllib.parse.urljoin(url, e.location)
                redirects += 1
                continue
            if e.status in (403, 404, 410):
                raise LockError(f'{url} answered {e.status}') from e
            last = e
        except (http.client.HTTPException, OSError, EOFError) as e:
            last = e
        time.sleep(min(8.0, 0.5 * 2**attempt))
        attempt += 1
    raise LockError(f'{url} failed {attempts} times: {last!r}')


def fetch_json(url: str) -> dict:
    return json.loads(fetch(url))


def parallel(fn, items, workers: int = 8):
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(fn, items))


# --------------------------------------------------------------- the inputs


def read_roots() -> dict[str, str]:
    """name -> pinned version, from the three requirements files."""
    roots: dict[str, str] = {}
    for file in ROOT_FILES:
        for raw in (SIDECAR / file).read_text(encoding='utf-8').splitlines():
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            req = Requirement(line)
            pins = [s for s in req.specifier if s.operator == '==']
            if len(pins) != 1 or len(req.specifier) != 1 or req.marker or req.extras or req.url:
                raise LockError(f'{file}: "{line}" is not a plain name==version pin')
            name = canonicalize_name(req.name)
            if name in roots and roots[name] != pins[0].version:
                raise LockError(f'{name} is pinned twice, {roots[name]} and {pins[0].version}')
            roots[name] = pins[0].version
    return roots


def read_venv() -> dict[str, dict]:
    """canonical name -> {name, version, requires} for this interpreter's distributions."""
    if not Path(sys.prefix).resolve().is_relative_to((SIDECAR / '.venv').resolve()):
        print(f'note: {sys.executable} is not sidecar/.venv; its distributions are the pins', file=sys.stderr)
    out: dict[str, dict] = {}
    for dist in metadata.distributions():
        name = canonicalize_name(dist.metadata['Name'])
        if name in out:
            raise LockError(f'{name} is installed twice in the venv ({out[name]["version"]}, {dist.version})')
        out[name] = {'name': dist.metadata['Name'], 'version': dist.version, 'requires': list(dist.requires or [])}
    return out


# ------------------------------------------------------------------- markers


def applies(req: Requirement, env: dict[str, str]) -> bool:
    """The requirement's marker for this target with no extras (extra = '')."""
    if req.marker is None:
        return True
    text = str(req.marker)
    for var in UNGUESSED_MARKERS:
        if var in text and _needs_var(req.marker, env, var):
            raise LockError(f'"{req}" reads {var}, which this script does not guess per target')
    return bool(req.marker.evaluate({**env, 'extra': ''}))


def _needs_var(marker: Marker, env: dict[str, str], var: str) -> bool:
    """True when the marker's result depends on `var` (two probes differ)."""
    a = marker.evaluate({**env, 'extra': '', var: '0'})
    b = marker.evaluate({**env, 'extra': '', var: '99999'})
    return a != b


# ------------------------------------------------------------------- the walk


def walk(target: str, roots: dict[str, str], venv: dict[str, dict], extra_info: dict[str, dict]) -> dict[str, str]:
    """name -> version: the roots and everything they require on this target."""
    env = TARGETS[target]['markers']
    lock: dict[str, str] = {}
    queue = [(name, '(a root)') for name in sorted(roots)]
    while queue:
        name, why = queue.pop()
        if name in lock:
            continue
        if name in NOT_LOCKED:
            continue
        if name in venv:
            version = venv[name]['version']
            requires = venv[name]['requires']
        elif name in EXTRA_PINS:
            version = EXTRA_PINS[name]
            requires = extra_info[name]['info'].get('requires_dist') or []
        else:
            raise LockError(
                f'{target} needs {name} ({why}), which is neither installed in the dev venv nor in EXTRA_PINS'
            )
        lock[name] = version
        for line in requires:
            req = Requirement(line)
            if not applies(req, env):
                continue
            dep = canonicalize_name(req.name)
            if dep in ALLOWLIST.get(name, frozenset()):
                continue
            if req.extras:
                raise LockError(f'{name} asks for {dep}[{",".join(sorted(req.extras))}]; the lock has no extras')
            queue.append((dep, f'{name}: "{line}"'))
    return dict(sorted(lock.items()))


# ------------------------------------------------------------- picking wheels


def supported_tags(target: str) -> dict:
    plats = TARGETS[target]['platforms']()
    tags = list(cpython_tags(python_version=(3, 14), abis=['cp314'], platforms=plats))
    tags += list(compatible_tags(python_version=(3, 14), interpreter='cp314', platforms=plats))
    rank: dict = {}
    for i, tag in enumerate(tags):
        rank.setdefault(tag, i)
    return rank


def pick_wheel(name: str, version: str, files: list[dict], rank: dict, target: str) -> dict:
    best = None
    for f in files:
        if f.get('packagetype') != 'bdist_wheel' or not f['filename'].endswith('.whl'):
            continue
        _, wversion, build, tags = parse_wheel_filename(f['filename'])
        if wversion != Version(version):
            continue
        ranks = [rank[t] for t in tags if t in rank]
        if not ranks:
            continue
        # pip: the best-supported tag first, then the highest build number.
        key = (min(ranks), -build[0] if build else 0)
        if best is None or key < best[0]:
            best = (key, f)
        elif key == best[0]:
            raise LockError(f'{name} {version}: {f["filename"]} and {best[1]["filename"]} rank the same on {target}')
    if best is None:
        raise LockError(f'{name} {version} has no wheel for {target} (cp314); nothing is built from an sdist')
    chosen = best[1]
    if chosen.get('yanked'):
        raise LockError(f'{chosen["filename"]} is yanked: {chosen.get("yanked_reason")}')
    rp = chosen.get('requires_python')
    if rp and not SpecifierSet(rp).contains(PYTHON_VERSION, prereleases=True):
        raise LockError(f'{chosen["filename"]} requires Python {rp}, not {PYTHON_VERSION}')
    host = urllib.parse.urlsplit(chosen['url']).hostname
    if host != FILES_HOST:
        raise LockError(f'{chosen["filename"]} is served from {host}, not {FILES_HOST}')
    sha = chosen['digests']['sha256']
    if not re.fullmatch(r'[0-9a-f]{64}', sha):
        raise LockError(f'{chosen["filename"]}: sha256 {sha!r} is not 64 lower-case hex')
    return chosen


def read_wheel_metadata(file: dict) -> dict:
    """The wheel's own METADATA (PEP 658), checked against PyPI's core-metadata hash."""
    body = fetch(file['url'] + '.metadata')
    core = file.get('core-metadata') or file.get('data-dist-info-metadata')
    if isinstance(core, dict) and core.get('sha256'):
        got = hashlib.sha256(body).hexdigest()
        if got != core['sha256']:
            raise LockError(f'{file["filename"]}.metadata hashes to {got}, PyPI says {core["sha256"]}')
    msg = email.parser.BytesParser(policy=email.policy.compat32).parsebytes(body)
    return {
        'name': msg['Name'],
        'version': msg['Version'],
        'requires': [str(r).strip() for r in (msg.get_all('Requires-Dist') or [])],
        'requiresPython': msg['Requires-Python'],
        'licenseExpression': msg['License-Expression'],
        'classifiers': [str(c) for c in (msg.get_all('Classifier') or [])],
    }


# ------------------------------------------------------- the completeness check


def evaluated(requires: list[str], env: dict[str, str]) -> list[tuple[str, Requirement]]:
    out = []
    for line in requires:
        req = Requirement(line)
        if applies(req, env):
            out.append((canonicalize_name(req.name), req))
    return out


def completeness(target: str, lock: dict[str, str], wheel_meta: dict[str, dict]) -> tuple[list[str], list[str]]:
    """(failures, allowlisted) over every requirement of every lock line."""
    env = TARGETS[target]['markers']
    failures: list[str] = []
    allowed: list[str] = []
    for name, version in lock.items():
        meta = wheel_meta[name]
        if canonicalize_name(meta['name']) != name or Version(meta['version']) != Version(version):
            failures.append(f'{name}=={version}: its METADATA says {meta["name"]} {meta["version"]}')
        rp = meta.get('requiresPython')
        if rp and not SpecifierSet(rp).contains(PYTHON_VERSION, prereleases=True):
            failures.append(f'{name}=={version} requires Python {rp}')
        for dep, req in evaluated(meta['requires'], env):
            if dep in ALLOWLIST.get(name, frozenset()):
                allowed.append(f'{name} -> {dep}')
                continue
            if req.extras:
                failures.append(f'{name} -> {req}: asks for extras, and the lock has none')
            if dep not in lock:
                failures.append(f'{name} -> {dep} ("{req}") is not in the {target} lock')
            elif not req.specifier.contains(lock[dep], prereleases=True):
                failures.append(f'{name} -> {req}, but the lock has {dep}=={lock[dep]}')
    return failures, allowed


# ------------------------------------------------------------- the interpreter


def interpreter_url(asset: str) -> str:
    return f'https://github.com/{PBS_REPO}/releases/download/{PYTHON_BUILD}/{urllib.parse.quote(asset, safe="")}'


def check_github() -> list[str]:
    """Each pin against GitHub's release, by size and per-asset digest."""
    api = f'https://api.github.com/repos/{PBS_REPO}/releases/tags/{PYTHON_BUILD}'
    release = fetch_json(api)
    assets = {a['name']: a for a in release.get('assets', [])}
    wanted = {pin['name'] for pin in INTERPRETERS.values()}
    page = 1
    while not wanted <= assets.keys():
        listing = fetch_json(f'https://api.github.com/repos/{PBS_REPO}/releases/{release["id"]}/assets?per_page=100&page={page}')
        if not listing:
            break
        assets.update({a['name']: a for a in listing})
        page += 1
    lines = [f'GitHub release {release.get("tag_name")}, published {release.get("published_at")}']
    for target, pin in INTERPRETERS.items():
        asset = assets.get(pin['name'])
        if asset is None:
            raise LockError(f'{pin["name"]} is not in release {PYTHON_BUILD}')
        digest = asset.get('digest') or ''
        if asset['size'] != pin['bytes']:
            raise LockError(f'{pin["name"]}: GitHub says {asset["size"]} B, the pin {pin["bytes"]} B')
        if digest != f'sha256:{pin["sha256"]}':
            raise LockError(f'{pin["name"]}: GitHub says {digest}, the pin sha256:{pin["sha256"]}')
        expected_url = interpreter_url(pin['name'])
        if asset.get('browser_download_url') and asset['browser_download_url'] != expected_url:
            raise LockError(f'{pin["name"]}: GitHub serves it at {asset["browser_download_url"]}, not {expected_url}')
        lines.append(f'  {target}: {pin["name"]} {asset["size"]:,} B {digest} — matches the pin')
    return lines


# ---------------------------------------------------------------- the outputs


def lock_text(target: str, lock: dict[str, str], wheels: dict[str, dict]) -> str:
    """No date in it: the lock's sha256 is the pack's identity, so the same pins
    must give the same bytes whenever the script runs. And ASCII only: pip reads
    a requirements file in the locale's encoding when it has no BOM, which on a
    Windows machine is a code page, not UTF-8."""
    floor = f', macOS {TARGETS[target]["minOs"]} or later' if TARGETS[target]['minOs'] else ''
    head = [
        f"# The AI helper's base pack for {target}: CPython {PYTHON_VERSION} (cp314){floor}.",
        '# Generated by scripts/pack_lock.py from the dev venv and PyPI; do not edit (docs/CLIPS.md, 3a.1).',
        '# Complete by construction and by check: it is installed in one pip run with --no-deps.',
    ]
    body = [f'{name}=={version} --hash=sha256:{wheels[name]["digests"]["sha256"]}' for name, version in lock.items()]
    text = '\n'.join(head + body) + '\n'
    if not text.isascii():
        raise LockError(f'the {target} lock is not ASCII')
    return text


def licence_of(info: dict, metas: list[dict]) -> dict:
    """What PyPI and the wheels' METADATA say, for the credits (CLIPS §11). A
    record, not a verdict: no settled licensing decision is reopened here."""
    out: dict = {}
    expression = info.get('license_expression') or next(
        (m['licenseExpression'] for m in metas if m.get('licenseExpression')), None
    )
    if expression:
        out['expression'] = expression
    first = (info.get('license') or '').strip().splitlines()
    # A whole licence text pasted into the field is not a name: kept only when short.
    if first and len(first[0]) <= 60 and not first[0].lower().startswith('copyright'):
        out['license'] = first[0]
    found = list(info.get('classifiers') or []) + [c for m in metas for c in m.get('classifiers', [])]
    classifiers = sorted({c.split(' :: ')[-1] for c in found if c.startswith('License ::')})
    if classifiers:
        out['classifiers'] = classifiers
    return out


def ts_number(n: int) -> str:
    s = str(n)
    if n < 10_000:
        return s
    groups = []
    while s:
        groups.insert(0, s[-3:])
        s = s[:-3]
    return '_'.join(groups)


def ts_string(s: str) -> str:
    if "'" in s or '\\' in s or '\n' in s:
        raise LockError(f'refusing to write {s!r} into TypeScript unescaped')
    return f"'{s}'"


def manifest_ts(pack: int, platforms: dict[str, dict], today: str) -> str:
    out = [
        '/**',
        f' * generated by scripts/pack_lock.py on {today} — do not edit.',
        ' *',
        " * The AI helper's pack (docs/CLIPS.md §3a.1, §3a.2): the pinned interpreter,",
        " * one wheel per lock line, and the lock's own sha256, per platform. Rebuild",
        ' * it with `sidecar/.venv/bin/python -I scripts/pack_lock.py`; a changed lock',
        ' * needs `--bump` (sidecar/pack/history.json).',
        ' *',
        ' * bytesOnDisk, longestPath and longestDir are PRE-CI MEASUREMENTS (CLIPS',
        ' * §3a.1, §3a.2), relative to the version folder: on the Mac, the dev venv',
        " * on disk plus the interpreter's tar; on Windows, the wheels' indexes, pip's",
        " * .pyc at the dev venv's ratio and the interpreter's tar. CI's install",
        ' * replaces them (§3a.8 row 28).',
        ' */',
        '',
        "import type { HelperPackManifest } from './pack'",
        '',
        'export const HELPER_PACK: HelperPackManifest = {',
        f'  pack: {pack},',
        f'  python: {{ version: {ts_string(PYTHON_VERSION)}, build: {ts_string(PYTHON_BUILD)} }},',
        '  platforms: {',
    ]

    def file_obj(f: dict, indent: str) -> list[str]:
        return [
            f'{indent}{{',
            f'{indent}  name: {ts_string(f["name"])},',
            f'{indent}  url: {ts_string(f["url"])},',
            f'{indent}  bytes: {ts_number(f["bytes"])},',
            f'{indent}  sha256: {ts_string(f["sha256"])}',
            f'{indent}}}',
        ]

    targets = list(platforms)
    for ti, target in enumerate(targets):
        p = platforms[target]
        out.append(f"    '{target}': {{")
        interp = file_obj(p['interpreter'], '      ')
        interp[0] = '      interpreter: {'
        interp[-1] = '      },'
        out += interp
        out.append(f'      // {len(p["wheels"])} wheels, {p["wheelBytes"]:,} B; with the interpreter {p["packBytes"]:,} B')
        out.append('      wheels: [')
        for wi, w in enumerate(p['wheels']):
            obj = file_obj(w, '        ')
            if wi < len(p['wheels']) - 1:
                obj[-1] += ','
            out += obj
        out.append('      ],')
        out.append('      lock: {')
        out.append(f'        file: {ts_string(p["lock"]["file"])},')
        out.append(f'        sha256: {ts_string(p["lock"]["sha256"])}')
        out.append('      },')
        out.append(f'      python: {ts_string(p["python"])},')
        out.append('      expects: [')
        for ei, method in enumerate(EXPECTS):
            out.append(f'        {ts_string(method)}{"," if ei < len(EXPECTS) - 1 else ""}')
        out.append('      ],')
        out.append('      // pre-CI measurements, see the header')
        out.append(f'      bytesOnDisk: {ts_number(p["bytesOnDisk"])},')
        out.append(f'      longestPath: {p["longestPath"]},')
        if p.get('minOs'):
            out.append(f'      longestDir: {p["longestDir"]},')
            out.append(f'      minOs: {ts_string(p["minOs"])}')
        else:
            out.append(f'      longestDir: {p["longestDir"]}')
        out.append('    },' if ti < len(targets) - 1 else '    }')
    out += ['  }', '}', '']
    return '\n'.join(out)


def protocol_methods() -> set[str]:
    """The method names SIDECAR_METHODS holds, read from protocol.ts's text."""
    text = PROTOCOL_TS.read_text(encoding='utf-8')
    start = text.index('export const SIDECAR_METHODS = {')
    end = text.index('\n}', start)
    return set(re.findall(r":\s*'([a-zA-Z]+\.[a-zA-Z]+)'", text[start:end]))


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


DATED = re.compile(r'(generated by scripts/pack_lock\.py on |"generatedOn": ")\d{4}-\d{2}-\d{2}')


def write_if_changed(path: Path, text: str) -> None:
    """Writes only a real change: a rerun that differs from the file on disk in
    nothing but the date it was generated leaves the file, and the diff, alone."""
    data = text.encode('utf-8')
    if path.exists():
        old = path.read_bytes()
        if old == data or DATED.sub(r'\1', old.decode('utf-8')) == DATED.sub(r'\1', text):
            return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_bytes(data)
    tmp.replace(path)


def venv_disk_check(lock_names: set[str]) -> str | None:
    """On the Mac, the dev venv's measured size of the lock's distributions."""
    if sys.platform != 'darwin':
        return None
    total = files = 0
    longest = longest_dir = 0
    for dist in metadata.distributions():
        if canonicalize_name(dist.metadata['Name']) not in lock_names:
            continue
        for f in dist.files or []:
            try:
                total += f.locate().stat().st_size
            except FileNotFoundError:
                continue
            files += 1
            rel = posixpath.normpath('python/lib/python3.14/site-packages/' + str(f))
            longest = max(longest, len(rel))
            longest_dir = max(longest_dir, len(posixpath.dirname(rel)))
    return (
        f'dev venv now: {total:,} B in {files:,} files, longest path {longest}, longest directory {longest_dir} '
        f'(the manifest holds {MAC_PACKAGES_ON_DISK:,} B, '
        f'{TARGETS["darwin-arm64"]["longestPath"]}, {TARGETS["darwin-arm64"]["longestDir"]})'
    )


# ---------------------------------------------------------------------- main


def run(args: argparse.Namespace) -> int:
    today = dt.date.today().isoformat()
    roots = read_roots()
    venv = read_venv()
    for name, version in roots.items():
        if name not in venv:
            raise LockError(f'{name}=={version} is a root but is not installed in the dev venv')
        if venv[name]['version'] != version:
            raise LockError(f'{name} is pinned {version} but the venv runs {venv[name]["version"]}')
    for name in EXTRA_PINS:
        if name in venv:
            raise LockError(f'{name} is in EXTRA_PINS and installed in the venv; take it out of EXTRA_PINS')

    extra_info = {name: fetch_json(f'https://pypi.org/pypi/{name}/{v}/json') for name, v in EXTRA_PINS.items()}
    newest = {name: fetch_json(f'https://pypi.org/pypi/{name}/json')['info']['version'] for name in EXTRA_PINS}

    locks = {t: walk(t, roots, venv, extra_info) for t in TARGETS}
    union = sorted({(n, v) for lock in locks.values() for n, v in lock.items()})
    used_extra = {n for lock in locks.values() for n in lock if n in EXTRA_PINS}
    unused = set(EXTRA_PINS) - used_extra
    if unused:
        raise LockError(f'EXTRA_PINS holds {sorted(unused)}, which no target needs any more')
    strays = sorted(set(venv) - NOT_LOCKED - {n for n, _ in union})
    print(f'roots: {len(roots)} pins from {", ".join(ROOT_FILES)}')
    print(f'dev venv: {len(venv)} distributions, {sorted(NOT_LOCKED)} never locked', end='')
    print(f'; not required by any root on any target: {strays}' if strays else '; every other one is required')

    releases = dict(zip(union, parallel(lambda nv: fetch_json(f'https://pypi.org/pypi/{nv[0]}/{nv[1]}/json'), union)))

    wheels: dict[str, dict[str, dict]] = {}
    for target, lock in locks.items():
        rank = supported_tags(target)
        wheels[target] = {n: pick_wheel(n, v, releases[(n, v)]['urls'], rank, target) for n, v in lock.items()}

    picked = sorted({w['url']: w for t in wheels.values() for w in t.values()}.values(), key=lambda w: w['url'])
    meta_by_url = dict(zip((w['url'] for w in picked), parallel(read_wheel_metadata, picked)))

    failures: list[str] = []
    report: list[str] = []
    for target, lock in locks.items():
        wheel_meta = {n: meta_by_url[wheels[target][n]['url']] for n in lock}
        fails, allowed = completeness(target, lock, wheel_meta)
        failures += [f'{target}: {f}' for f in fails]
        report.append(
            f'completeness, {target}: {len(lock)} lock lines, '
            + ('every requirement met' if not fails else f'{len(fails)} unmet')
            + (f'; allowlisted: {", ".join(allowed)}' if allowed else '')
        )
        unused_allow = {
            f'{n} -> {d}' for n, deps in ALLOWLIST.items() if n in lock for d in deps
        } - set(allowed)
        if unused_allow:
            report.append(f'  note: allowlist entries no longer needed on {target}: {sorted(unused_allow)}')
    only_win = sorted(set(locks['win32-x64']) - set(locks['darwin-arm64']))
    only_mac = sorted(set(locks['darwin-arm64']) - set(locks['win32-x64']))
    report.append(f'win32-x64 beyond darwin-arm64: {only_win or "nothing"}; darwin-arm64 beyond win32-x64: {only_mac or "nothing"}')
    for line in report:
        print(line)
    if failures:
        for f in failures:
            print(f'  UNMET {f}', file=sys.stderr)
        raise LockError(f'the completeness check failed: {len(failures)} unmet requirement(s)')

    known = protocol_methods()
    missing = [m for m in EXPECTS if m not in known]
    if missing:
        raise LockError(f'EXPECTS names {missing}, which SIDECAR_METHODS in protocol.ts does not hold')

    if args.check_github:
        for line in check_github():
            print(line)

    # Everything is decided before anything is written: a failure leaves the repo as it was.
    texts = {t: lock_text(t, locks[t], wheels[t]) for t in TARGETS}
    lock_sha = {t: sha256_bytes(texts[t].encode('utf-8')) for t in TARGETS}
    current = {t: {'lockSha256': lock_sha[t], 'interpreterSha256': INTERPRETERS[t]['sha256']} for t in TARGETS}

    history = json.loads(HISTORY.read_text(encoding='utf-8')) if HISTORY.exists() else {}
    if not history:
        pack = 1
    else:
        latest = max(int(k) for k in history)
        if history[str(latest)] == current:
            if args.bump:
                raise LockError(f'--bump, but nothing changed since pack {latest}')
            pack = latest
        elif args.bump:
            pack = latest + 1
        else:
            changed = [t for t in TARGETS if history[str(latest)].get(t) != current[t]]
            raise LockError(
                f'the lock or interpreter of {changed} changed under pack {latest}; '
                f'run again with --bump to make it pack {latest + 1}'
            )
    history[str(pack)] = current

    platforms: dict[str, dict] = {}
    for target in TARGETS:
        cfg = TARGETS[target]
        pin = INTERPRETERS[target]
        wlist = [
            {
                'name': w['filename'],
                'url': w['url'],
                'bytes': w['size'],
                'sha256': w['digests']['sha256'],
            }
            for w in wheels[target].values()
        ]
        wheel_bytes = sum(w['bytes'] for w in wlist)
        platforms[target] = {
            'interpreter': {
                'name': pin['name'],
                'url': interpreter_url(pin['name']),
                'bytes': pin['bytes'],
                'sha256': pin['sha256'],
            },
            'wheels': wlist,
            'wheelBytes': wheel_bytes,
            'packBytes': wheel_bytes + pin['bytes'],
            'lock': {'file': f'pack/lock-{target}.txt', 'sha256': lock_sha[target]},
            'python': cfg['python'],
            'bytesOnDisk': cfg['bytesOnDisk'],
            'longestPath': cfg['longestPath'],
            'longestDir': cfg['longestDir'],
            'minOs': cfg['minOs'],
        }

    distributions: dict[str, dict] = {}
    for name, version in union:
        info = releases[(name, version)]['info']
        raw = [str(r).strip() for r in info.get('requires_dist') or []]
        entry: dict = {
            'name': info.get('name') or name,
            'version': version,
            'requiresPython': info.get('requires_python') or None,
            'requiresDist': raw,
            'licence': licence_of(info, [meta_by_url[wheels[t][name]['url']] for t in locks if name in locks[t]]),
            'targets': {},
        }
        if name in EXTRA_PINS:
            entry['extraPin'] = {'newestOnPyPI': newest[name]}
        by_target: dict[str, list[str]] = {}
        for target, lock in locks.items():
            if name not in lock:
                continue
            w = wheels[target][name]
            meta = meta_by_url[w['url']]
            if [str(Requirement(r)) for r in meta['requires']] != [str(Requirement(r)) for r in raw]:
                by_target[target] = meta['requires']
            entry['targets'][target] = {
                'file': {
                    'name': w['filename'],
                    'size': w['size'],
                    'uploadTime': w['upload_time_iso_8601'],
                    'url': w['url'],
                    'sha256': w['digests']['sha256'],
                },
                'requires': sorted({dep for dep, _ in evaluated(meta['requires'], TARGETS[target]['markers'])}),
            }
        if by_target:
            # The wheel's own METADATA differs from the release's; the wheel's is what pip reads.
            entry['requiresDistByTarget'] = by_target
        distributions[name] = entry

    resolved = {
        'generatedBy': 'scripts/pack_lock.py',
        'generatedOn': today,
        'pack': pack,
        'python': {'version': PYTHON_VERSION, 'build': PYTHON_BUILD},
        'roots': roots,
        'notLocked': sorted(NOT_LOCKED),
        'allowlist': {k: sorted(v) for k, v in ALLOWLIST.items()},
        'extraPins': EXTRA_PINS,
        'targets': {
            t: {
                'markers': {k: v for k, v in TARGETS[t]['markers'].items()},
                'tags': f'cp314, {TARGETS[t]["platforms"]()[0]} first',
                'lock': platforms[t]['lock'],
                'wheels': len(platforms[t]['wheels']),
                'wheelBytes': platforms[t]['wheelBytes'],
                'interpreter': platforms[t]['interpreter'],
                'packBytes': platforms[t]['packBytes'],
            }
            for t in TARGETS
        },
        'distributions': distributions,
    }

    PACK_DIR.mkdir(parents=True, exist_ok=True)
    for t in TARGETS:
        write_if_changed(PACK_DIR / f'lock-{t}.txt', texts[t])
    write_if_changed(RESOLVED, json.dumps(resolved, indent=2, ensure_ascii=False) + '\n')
    write_if_changed(HISTORY, json.dumps(history, indent=2) + '\n')
    write_if_changed(MANIFEST_TS, manifest_ts(pack, platforms, today))

    print(f'pack {pack}: python {PYTHON_VERSION} ({PYTHON_BUILD})')
    for t, p in platforms.items():
        mib = round(p['packBytes'] / 2**20)
        print(
            f'  {t}: {len(p["wheels"])} wheels, {p["wheelBytes"]:,} B; with the interpreter {p["packBytes"]:,} B '
            f'({mib} MB on the button); lock sha256 {lock_sha[t]}'
        )
    for name, v in EXTRA_PINS.items():
        info = releases[(name, v)]
        up = [f['upload_time_iso_8601'] for f in info['urls'] if f['packagetype'] == 'bdist_wheel']
        note = '' if newest[name] == v else f' — PyPI now has {newest[name]}'
        print(f'  extra pin: {name}=={v}, uploaded {min(up)}{note}')
    check = venv_disk_check(set(locks['darwin-arm64']))
    if check:
        print(f'  {check}')

    if args.licences:
        print('licences (PyPI license_expression / license / classifiers):')
        for name, entry in distributions.items():
            lic = entry['licence']
            text = lic.get('expression') or lic.get('license') or ', '.join(lic.get('classifiers', [])) or '(none on PyPI)'
            print(f'  {name} {entry["version"]}: {text}')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--check-github', action='store_true', help="re-read the interpreter pins from GitHub's release")
    parser.add_argument('--bump', action='store_true', help='the lock or interpreter changed: write the next pack number')
    parser.add_argument('--licences', action='store_true', help='print each distribution’s licence as PyPI states it')
    args = parser.parse_args()
    try:
        return run(args)
    except LockError as e:
        print(f'pack_lock.py: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
