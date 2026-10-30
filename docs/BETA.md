# The plan to a beta

> Written 2026-09-27. The facts come from five Opus readers over PLAN.md,
> FIX.md, COMPARISON.md, PACKAGING.md, STACK.md, SIDECAR.md,
> WHERE-THINGS-ARE.md, SHEETS.md, EVAL.md, eval/findings.md and the code
> (186 items), a writer and a critic; each claim was checked against the code
> at the time. The days are estimates. Mark each step DONE here as it lands,
> with the commit, the way PLAN.md's steps carry their "Built" notes.
>
> **2026-10-05: the beta now follows `CLIPS.md`.** The user's decision
> ("will finish this and will get back to the beta"): CLIPS.md's plan runs
> first, then R1–R12, R13 and R14 here (`CLIPS.md` §2, §16.27). Two edits
> the same day (`CLIPS.md` §16.25): R2 gained items 7–9 and R4's full route
> is `CLIPS.md` Step P; both are built inside that plan, before the beta
> resumes.

## 0. What "beta" means

A tester can **install, open, edit, direct an ad and export a playable file
on macOS arm64 and Windows x64, with nothing embarrassing** — and can tell
us what happened when something goes wrong. Everything below is measured
against that sentence. The bars of PLAN.md §0 (the ratings, the blind
preference) are C5's and come after; a beta is what gets real users' runs
into `EVAL.md`.

The rules do not change for release work: measure, do not assume (CLAUDE.md);
every regression test is mutation-checked; every render change gets a real
ffmpeg render check under `tests/output/<check>/`; every push is read at
github.com/spyki-a/forge/actions; each step ends with typecheck, the full
suite written to a file and `$?` checked, commit, push, CI.

## 1. The order, and why

Runtime failures first (a tester who cannot get an ad out on day one stops),
then the things a tester will meet in the first hour, then the release
mechanics, then the smoke test that proves the installer, then the remaining
Phase C work that the plan already lists. Twelve steps to the installer, two
more to a careful closed beta.

| step | what | days |
|---|---|---|
| R1 | the even-grid fallback when there are no beats | 0.5 |
| R2 | the first-hour bugs (six of them, plus 7–9 from `CLIPS.md`) | 1.5 (7–9's 1.5 counted in `CLIPS.md` step 0) |
| R3 | copy rules and one blind rating run | 0.5 + your 45 minutes |
| R4 | beats without Python: a TypeScript beat tracker (the full route is `CLIPS.md` Step P, planned in its §3a on 2026-10-14 and **built 2026-10-14/16**; its exit, the clean Mac and the Surface, is yours) | 3 (Step P's 9.5–13 counted in `CLIPS.md`) |
| R5 | portrait phone media: rotation and EXIF — DONE 2026-10-08 | 1.5 (built first, in `CLIPS.md` step 0, §3.1) |
| R6 | the library pack's fonts and licences | 0.5 |
| R7 | name, app id, icon, version | 0.5 (once you decide) |
| R8 | macOS signing, at least ad hoc | 0.5 to days |
| R9 | a release page from a tag | 0.5 |
| R10 | the tester guide, and the Ollama run | 1 |
| R11 | a log file and Help › Show Logs | 1 |
| R12 | clean-machine smoke test, both platforms | 2 + what it finds |
| R13 | the rest of C4: glitch and liquid | 2 to 3 |
| R14 | the beta.2 list | 2.5 to 4.5 (the Indic fonts' half day is counted in `CLIPS.md` §6.20, decided 2026-10-21 and built 2026-10-29/30, `6bc8b07` to `ae3e48f`) |

R1 to R12 is 13 to 15 working days; R13 and R14 make a careful closed beta
about three weeks of work once R1 starts. Four things wait on you: the name (R7), whether to
pay Apple (R8), 45 minutes of rating (R3), and the Freesound originals (R14).
**The total is unchanged by the 2026-10-05 edits**: R2's items 7–9 (1.5
days) and R4's full route (Step P, 9.5–13 days as planned on 2026-10-14) are counted once, in
`CLIPS.md`, which now runs before R1; they are done when the beta resumes.
What changed is the order: R5 is `CLIPS.md` §3.1, in its step 0, so it is
also done by then, and R1–R12 leave 11.5 to 13.5 days when the beta
resumes.

---

## 2. The steps

### R1 — No beats is not no ad · half a day

**What is wrong.** `analyseBeats` is awaited unguarded in `direct()`
(`src/renderer/src/store.ts:1790`), so a fresh install — no sidecar, no
Python — gets an error toast and no ad. PLAN.md §9's even-grid fallback
(`DEFAULT_TARGET_SHOT_SECONDS`, the recipe's curve at its `tempo`) never
runs, although `gridsFor` already accepts `null`.

**The fix.** Catch the sidecar's failure in `direct()` and pass `null` into
`gridsFor`; the notice says "no beats — cut to the recipe's tempo". The same
guard for the reel (`buildReel`) and the grid split, which share the call.

**Tests.** `tests/renderer/directStore.test.ts`: a bridge whose
`analyseBeats` rejects still lands an ad, with the note; mutation: remove the
catch. `tests/directorRhythm.test.ts` already covers the grid without
analysis — assert the tempo it takes. The degraded-mode row "no sidecar" in
PLAN.md §9 gets its render: `tests/integration/degraded.int.test.ts`, one
case per row as they land (R1 starts the file).

### R2 — The first-hour bugs · a day and a half

Six things a tester meets in the first hour, each hours, and, since
2026-10-05, three bugs in what ships today from `CLIPS.md` (items 7–9
below), each with a test that fails when the bug is put back:

1. **Length clamps each keystroke** (`src/renderer/src/components/Director.tsx:265`):
   typing "30" gives 60. Clamp on blur, not on change.
2. **Library stickers join the pool** (`src/shared/director/menu.ts:113`)
   and can be cast as shots. `buildSlots` skips assets the catalogue owns
   (their `broughtBy`, and the sticker kinds).
3. **Nothing can be removed from the pool or left out of the ad**: one wrong
   import lands in every ad in that project. A "leave out" toggle per pool
   item in the Director panel, persisted on the asset (`MediaAsset.excluded`),
   honoured by `buildSlots`.
4. **No model gives a wedding brief the Energy recipe** because the default
   tone is energetic (`src/shared/director/recipes/index.ts:174`): the tone
   table's fallback reads the brief's words (wedding, product, fashion) before
   the tone.
5. **Errors show internals**: "Error invoking remote method" and "code
   9009". One `describeError` in the store that turns IPC and sidecar errors
   into the sentence the user needs (the sidecar one already exists in
   CLAUDE.md's table: "Python is not installed"); the crash dialog stops
   saying nothing autosaves.
6. **A moment whose bake throws** — DONE 2026-09-27: `exportBake.ts` leaves
   the moment out (`tests/moment.test.ts`, mutation-checked).
7. **Every split clicks** — DONE 2026-10-05 (`9a85d9f`): `adelay` in
   samples (`tests/integration/audioSplit.int.test.ts`, mutation-checked,
   green on the 2018 build in Windows CI; `CLIPS.md` §3.3, `EFFECTS.md` §39).
   Was: (`CLIPS.md` §3.3) the audio delay is rounded to
   whole milliseconds (`plan.ts:1761`); at 30 fps frame 47 lands 16 samples
   late at 48 kHz, a measured click. `adelay` in samples instead.
8. **Zoom keys on a video clip export a frozen frame** — DONE 2026-10-07
   (this change): footage and a moment's frames get `fps=<rate>,zoompan=…:d=1`
   in `plan.ts` (`tests/integration/zoomVideo.int.test.ts`, 60 and 29.97 fps
   sources, mutation-checked; the 2018 build is the next push's Windows CI;
   `CLIPS.md` §3.4, `EFFECTS.md` §46). Was: (`CLIPS.md` §3.4)
   zoompan's `d=${clip.duration}` holds frame 0. `fps=${fps},zoompan=…:d=1`
   (`d=1` alone plays a 60 fps source at half speed, measured).
9. **Held keyframes land one frame late at 30 fps** — DONE 2026-10-07 (this
   change): picture keys end on the half frame, `keyframes.ts`
   (`tests/integration/keyframes.int.test.ts`, every frame at 24, 25 and
   30 fps, mutation-checked; `CLIPS.md` §3.2, `EFFECTS.md` §45). Was:
   (`CLIPS.md` §3.2)
   `toFixed(4)` of `frame/fps` puts a key at frame 5 on frame 6, for every
   key on a frame ≡ 2 (mod 3). Compare against the half-frame boundary
   instead.

Items 7–9 were added on 2026-10-05 as beta blockers (bugs in what ships
today, `CLIPS.md` §16.25). Their fixes, tests and render checks are
written in `CLIPS.md` §3.2–3.4 and built there, in step 0, before the beta
resumes; their 1.5 days are counted there.

**Tests.** Component tests for 1 and 3 (`tests/renderer/`), unit tests for
2, 4 and 5; each mutation-checked. 7–9: the render checks of `CLIPS.md`
§3.2–3.4.

### R3 — The copy rules, and one rating · half a day + 45 minutes

**What is wrong.** spine@2 transliterated "Paradise Spice" into Telugu, put
one headline on two cards and wrote one CTA longer than its card allows
(eval/findings.md).

**The fix.** Three validator rules in `src/shared/director/validate2.ts`:
the brand is kept as written (the brief's product name appears verbatim
in any headline that mentions it, or the headline is dropped with a note);
no headline repeats another's text; a CTA over its card's capacity is cut
to the brief's CTA. Then `npm run eval:rate` once on the existing runs, so
`EVAL.md` carries one rating row before testers add theirs.

**Tests.** `tests/directorValidate2.test.ts` per rule, mutation-checked.

### R4 — Beats without Python · three days

**What is wrong.** The installers ship no Python and nothing sets it up
(`src/main/sidecar/service.ts:26`), so no installed user gets beat cuts,
captions or depth — and the app spawns a bare `python3` at launch, which on a
Mac without the Command Line Tools may raise Apple's install dialog
(unverified; check it in R12). *(Both were true when written. Since
2026-10-14 a packaged app never starts a Python from PATH (`CLIPS.md` §3a.2),
so the dialog cannot come from the app; since 2026-10-16 the user installs
the AI helper's own Python from Settings, below.)*

**The fix, the cheap route.** A TypeScript beat tracker in
`src/main/audio/beats.ts`: decode to mono PCM with the bundled ffmpeg
(`-f f32le -ac 1 -ar 22050`), an onset envelope (spectral flux over an STFT
or a simple energy difference over 46 ms frames), a tempo estimate by
autocorrelation of the envelope between 60 and 180 BPM, beats by peak
picking on the envelope at that period, downbeats every four, sections from
energy changes over eight-bar windows. Behind the same `analyseBeats`
interface the sidecar answers, so the Director, the reel and the grid split
get it without change; the sidecar's answer wins when it is there.
Measured against the reference recordings in `docs/REFERENCES.md` (the
sidecar's beats are the oracle: within 70 ms on ≥ 80 % of beats, tempo
within 2 BPM).

**The full route** is `CLIPS.md` Step P (§3a): the app installs its own
Python pack under `userData` (estimated here at 5 to 10 days, 300 MB or more), and no Python
half ships in an installer before it. Decided 2026-10-05 (`SHEETS.md:806-809`,
`CLIPS.md` §16.25); it is built inside `CLIPS.md`, before the beta resumes.
Its plan is written in full in `CLIPS.md` §3a (2026-10-14): a
pinned CPython 3.14.8 and a hash-pinned wheel lock installed offline under
`userData/python/`, 170 MB to download on the Mac and 205 MB on Windows,
about 0.7 GB on disk, 9.5–13 days, with its decisions in
`CLIPS.md` §16.36–53 (all answered as recommended).

**Built 2026-10-14/16** (`CLIPS.md` §3a.1–§3a.7, three slices; `EFFECTS.md`
§57–59). One press in Settings → AI helper (Python) → **Install the AI
helper · 166 MB** on the Mac, **· 201 MB** on Windows (pack 2: hf-xet left
the lock), 636 / 685 MB on disk; its bar and X in EXPORT; Repair, Update,
Remove and Check again on the same row; every Python control greyed by its
own method, each "needs the AI helper" a pointer to that row; the speech
model its own press ("Get the speech model · 464 MB"); the NSIS uninstaller
removing the pack. Installed for real on the dev Mac (53–58 s). **What the
exit still owes** (`CLIPS.md` §3a.9): CI's first run with the pack on both
runners (the next push); the clean Mac, from a DMG fetched through a
browser; and the Surface, in Windows Sandbox or a new account, with an
update and an uninstall. Those are R12's machines too.

**Whether the cheap route below is still wanted is yours.** It was written
before the pack: with the pack built it would serve only a user who has not
pressed Install, or whose machine has no pack (macOS 13, Windows on Arm),
where R1's even-grid fallback (not built yet) would land an ad without
beats.

**Tests.** `tests/beats.test.ts` on synthetic clicks at known tempos;
`tests/integration/beats.int.test.ts` against the reference recordings'
saved sidecar analyses; mutation: the period doubled.

### R5 — Portrait phone media · a day and a half

**DONE 2026-10-08** (built in `CLIPS.md` §3.1): the probe reads the display
matrix and swaps the sides (`src/shared/media.ts` `uprightSize`,
`src/main/ffmpeg/probe.ts`), and a still tagged with an EXIF orientation is
turned into the converted cache at import, `source` kept
(`src/main/imports.ts`) — `tests/integration/rotation.int.test.ts`,
mutation-checked; a 9:16 export of a 90° clip, a 4K clip tagged 270 and an
orientation-6 photo went from 83.7 / 80.3 / 99.4 mean levels off the upright
picture to 0.39 / 0.30 / 0.48; the 2018 build is the next push's Windows CI;
`EFFECTS.md` §49. Was:

**What is wrong.** The probe ignores the rotation matrix
(`src/main/ffmpeg/probe.ts:70`): a rotated phone clip probes 320×180 and
decodes 180×320, so the pool size, the fill decisions and the preview crop
use swapped sides. Phone JPEGs have the same problem: the bundled ffmpeg
ignores EXIF orientation (measured: an orientation-6 JPEG renders unturned)
while the preview's `<img>` shows it upright — a portrait photo exports on
its side. Only AVIF and HEIC go through sharp's `rotate()`
(`src/main/imports.ts:33`).

**The fix.** The probe reads `side_data_list` rotation and swaps the sides;
tagged JPEGs are turned at import the way AVIF is (sharp `rotate()` into the
converted cache, `MediaAsset.source` kept — the AVIF path already does this).
The moments' footage pre-pass already measures the frame that arrives
(EFFECTS.md §36), so it needs nothing.

**Tests.** `tests/integration/rotation.int.test.ts`: a clip tagged
`rotate=90` and an orientation-6 JPEG, each rendered on both ffmpegs (CI is
the Windows one); the frame's shape is the upright one. Mutation: the probe
ignores the matrix.

### R6 — The library pack's fonts and licences · half a day

**What is wrong.** The published pack ships Arial, Verdana, Impact, Comic
Sans, Georgia, Futura, Copperplate and other system fonts that ASSETS.md
says are referenced, not shipped; three personal-use or demo fonts, in an
app that makes commercial ads; and no OFL texts for the Google fonts.

**The fix.** `scripts/build-pack.mjs` excludes them, adds the licence texts,
republishes as pack v2, updates the sha256 the app checks. And a rule in
PACKAGING.md: never pack an installer on this Mac — `extraResources` copies
the whole local `assets/` into it.

**Tests.** A test over the pack manifest: no font outside the allow-list, a
licence file beside every family.

### R7 — Name, app id, icon, version · half a day

`electron-builder.yml:29` still says `Forge` with a placeholder appId, and
`userData` follows the name — renaming after the beta strands every tester's
settings, packs and autosaves. Version 1.0.0 should read as a beta
(`0.9.0-beta.1`). Decide the name; then the id, the icon (both platforms'
formats) and the version in one commit, with `PACKAGING.md` updated.

### R8 — macOS opens · half a day, or days

`identity: null` (`electron-builder.yml:101`) skips signing, and a
downloaded unsigned arm64 app will say "damaged". Minimum: ad-hoc signing
(`identity: '-'`) plus the microphone entitlement in the entitlements file
(the hardened runtime blocks voice-over without it) and a tested "Open
Anyway" route in the guide. Proper: Developer ID and notarisation, $99 a
year, your call. No DMG has ever been installed on a Mac — R12 does that.

### R9 — A download page · half a day

Installers are CI artifacts that expire in 14 days
(`.github/workflows/ci.yml:206`); there are no tags or releases. A GitHub
Release from a `v*` tag, built by the existing package job on both
platforms, with the two installers attached and the guide as the release
text. REFERENCES.md:154 still says the repo is private; it is public.

### R10 — The tester guide, and the Ollama run · a day

A README for testers: Gatekeeper and SmartScreen steps; Apple Silicon and
x64 only; install the library first; LM Studio with `google/gemma-4-e2b`,
picked by hand in the gear (the model defaults to none); how to report.
**The AI helper** (since 2026-10-16, `CLIPS.md` §3a.4, §16.40–41): Settings
(the gear) → AI helper (Python) → **Install the AI helper · 166 MB** (201 MB
on Windows), the only place it is installed; on a Mac, Remove it there before
deleting the app. The hosts a restricted network must allow: for the
install, github.com (which redirects to release-assets.githubusercontent.com)
and files.pythonhosted.org, fetched through the system's own network
settings, proxy included (Chromium's stack, `CLIPS.md` §15 row 19; not yet
measured behind a real proxy, so say so in the guide); for each
model press, huggingface.co and *.hf.co (storage.googleapis.com for the face
finder), which need a direct connection or a proxy set in `HTTPS_PROXY`,
as the Settings row says. On Windows, if the row says "needs Microsoft's
Visual C++ runtime", install it from the link and press Check again. The
app's own hints send people to Ollama (`src/main/director.ts:182`) and Auto
prefers it, yet Ollama has never been run against a real model here: run it
once and record it in `EVAL.md`, or point the hints at LM Studio.

### R11 — A log file · a day

Nothing is written to disk today. `electron-log` or a small writer under
`userData/logs/`: the main process's errors, each IPC failure, the
Director's notes, the export's ffmpeg stderr; `Help › Show Logs` reveals the
folder. Without it a tester's report is "it didn't work".

### R12 — Clean-machine smoke test, both platforms · two days plus what it finds

No installer has been built since 2026-09-19 — the package job runs only by
hand or on a tag — so no installer contains any Phase C work; the only
recorded install is Windows at a3b71bb. Build from HEAD, install on a clean
Mac and on the Surface, add the pack, Direct with a song and a model, export,
play. This settles the Director over IPC with a live model, the moments on
the Surface's GPU, the Surface's look-pass wait and memory, and the AI
helper's Install from Settings on both (`CLIPS.md` §3a.9's clean Mac and
Surface runs are the same machines, so do them together). *(The Mac
`python3` dialog question is gone: since 2026-10-14 a packaged app never
starts a Python from PATH.)* What it finds goes back into R2.

### R13 — The rest of C4: glitch and liquid · two to three days

Two new `MomentKind`s on the rails the four have (PLAN.md §7): **glitch**
— a seeded RGB split, block displacement and stutter for Energy and Trailer
drops — and **liquid** — a ripple or ink displacement for Fashion and
Wedding sections. Each is a shader in `momentCanvas.ts`, a parameter curve
in `render/moment.ts` that is exactly the two shots at t = 0 and t = 1, a
`MOMENT_SECONDS` row, a recipe placement, `tests/moment.test.ts` cases, the
harness check, a render check, and a render of the real serum ad. Then the
Opus review, as for the four.

### R14 — The beta.2 list · two and a half to four and a half days

Things testers will notice but can follow the first installer:

- Publish `sfx-cinematic` from the Freesound originals with the CC-BY
  credit; without it Wedding highlight has no swell (needs your sign-in).
- The Director offers the library pack when the catalogue is empty.
- Pool reorder: the Director casts pictures in import order.
- Auto-pick the model a server lists (the default is `''`); a Cancel for
  Direct.
- Notes show slot ids; Clear drops hand edits without asking; the brief is
  not saved with the project.
- HEIC through `sips` on macOS.
- Telugu and Hindi headline capacity, and a Telugu font (the library has
  none; Poppins and Teko cover Devanagari) — a blocker if the testers are
  Telugu studios. **Captions too, measured 2026-10-13 on M0's exit links**
  (`CLIPS.md` §3b.9, `EFFECTS.md` §51): the "pop" style's Anton has no
  Devanagari or Telugu, and of the 88 fonts in `assets/fonts` only Poppins
  Black and ExtraBold (94 of the Devanagari block's 128 code points) and
  Teko Bold (93) carry Devanagari, none Telugu. On the Mac libass falls back
  through CoreText to Kohinoor Devanagari and Telugu, and since `2ead680`
  shapes them right (conjuncts joined, the i-matra first); on Windows the
  2018 build has no CoreText, and both its fallback font and whether its
  libass has HarfBuzz are unmeasured — the next push's `captions.int` line
  answers the second. **Measured 2026-10-27 on the Surface** (`CLIPS.md`
  §6.15, `EFFECTS.md` §61), by `graphic.int`, not the `captions.int` line:
  letters in a system face (not named in the report), unshaped at
  `shaping=complex`, so the build does not shape Hindi or Telugu (the
  Telugu row, drawn in a face installed on Windows, settles it: `CLIPS.md`
  §6.15); the route for those captions is `CLIPS.md` §16.66, answered
  (a) on 2026-10-27: the canvas bake for those tracks on both platforms,
  the whole track.
  **Decided 2026-10-21** (`CLIPS.md` §16.63, D10 of the
  graphics research): bundle Noto Sans Devanagari and Noto Sans Telugu
  (OFL, the licence of the pack's Google fonts) and have a Hindi or Telugu
  transcript's captions and graphics name them, so both platforms draw the
  same letters instead of whatever each system falls back to (the
  captions are to name them through the canvas bake's font chain, since
  under `CLIPS.md` §16.66 (a) a Hindi or Telugu track will be the bake's,
  libass only a failed or empty bake's fallback; the `\fn` tags are
  dropped; not built yet — built 2026-10-29, below). Built in
  `CLIPS.md` §6.20, before step 3's phase-1 Indic render check, with a
  render check on both builds; this item's half day is counted there, once,
  with the quarter day the route of `CLIPS.md` §16.66 (a) adds beside it
  (0.75 in all, 2026-10-27).
  The two Regular files are to be committed under `assets/fonts/`, each with its
  own OFL text beside it (`.gitignore`'s `/assets` narrowed to let exactly
  those four files through), so CI's libass draws them too, and main's scan
  also lists them when an asset pack's root is the one scanned (`CLIPS.md`
  §6.20). R6's rule holds for them: a licence file beside every family.
  **Built 2026-10-29/30** (`CLIPS.md` §6.20's second Built note;
  `EFFECTS.md` §61's three dated subsections): the four files are tracked
  (`6bc8b07`: Noto Sans Devanagari v2.007 and Noto Sans Telugu v2.005,
  hinted Regular, from the Noto project's own releases, with their OFL
  texts; `tests/appFontFiles.test.ts` holds R6's rule for them), every
  catalogue lists them wherever it scans and the Library's "empty" no
  longer counts them (`9a0f232`), the canvas painter's chain names them
  after the clip's face and every text site the plan lists loads the face
  the words need (`8932535`, `00b42b4`), and a Hindi or Telugu track is
  the bake's on both
  platforms with the "unshaped" notice on Windows for a failed or empty
  bake (`f77fd29`, `ae3e48f`). **Not as this item read for libass**: on
  the Mac libass still falls back through CoreText to Kohinoor whether or
  not the Noto files are in its fontsdir (measured 2026-10-29: 0 of 108
  Indic frames change with them removed; the fontsdir serves a face a
  style names, not the fallback), and the Windows build's fallback face is
  still unmeasured. The same letters on both platforms come from the bake,
  not from libass. **Still yours**: the render check in the development
  app on both builds, M0's exit run on the two Indic links (then once more
  with the route's script test put back), the Surface's reading of the
  Windows `captions.int` notice, Electron's own `document.fonts.check`,
  and the paper clip's font chain (`src/renderer/src/paperCanvas.ts`,
  `src/shared/render/paperPaint.ts:79`), which names no Noto face and is
  outside §6.20's list of sites.
- **A pack's faces never reach libass.** Found 2026-10-29 while building
  the Indic fonts (`CLIPS.md` §6.20, "A gap found, outside this step"):
  libass takes one `fontsdir` (`src/shared/render/plan.ts:103`, the
  `:fontsdir=` argument built at `:1932`, from `fontsDir()`,
  `src/main/fontsDir.ts:17`), and that is the app's own
  `assets/fonts` whether or not an asset pack is installed, so on a
  machine with a pack a burned-in caption in one of the pack's faces is
  drawn by libass in a system fallback, while the preview and the canvas
  bake, which load from the catalogue, draw the pack's face. Found by
  reading the code, not measured in an export. The fix is a fontsdir that
  reaches the pack's fonts as well (a merged folder, or the scanned root's
  `fonts/` beside the app's), with a render check on a machine with a pack
  installed; the beta's installs all have a pack, so it is this list's.
- Single-instance lock; a "new version" check against the release page.
- Keep or drop the meme packs from the manifest.
- **Cmd+C with nothing selected copies nothing, anywhere in the window.**
  Seen 2026-10-22 in the development app on the Mac (`CLIPS.md` §6.15's
  phase-0 runs): with no clip selected, Cmd+C inside a text area copied
  nothing, and DevTools' `copy()` did not reach the clipboard either; the
  console's Save as… had to stand in. The Edit menu's Copy is the app's own
  (`src/main/menu.ts:156-175`: `CmdOrCtrl+C` sends `copy` to the store and
  is `enabled` only with a selection, not `role: 'copy'`), so with nothing
  selected macOS finds a disabled accelerator and swallows the keystroke
  before any text field sees it. Not yet measured in the app's own fields
  (a caption's text, a name): if it holds there, the fix is to fall through
  to the focused field's native copy when the store has no selection, with a
  test over the menu's enabled states.

---

## 3. After the beta

The full C5 bars (blind preference on real photos, the eyes, the hero, the
reference spots, more models); the remaining degraded-mode renders of
PLAN.md §9; Director work not drawn yet (the Energy and Trailer treatments,
moments over backdrops, kinetic-type, L-cuts, lyric cards, video-slot
looks); cache pruning for the converted stills; Windows signing;
auto-update; Intel Macs; credits; mask tracking; the pro-editor gaps in
COMPARISON.md; the open sheets in SHEETS.md. Stale docs to fix as they are
touched: PLAN.md:8, LLM.md:435, PACKAGING.md, SHEETS.md ⑪,
REFERENCES.md:154.

## 4. Done means

- A tester on each platform has installed the release build, directed an
  ad with a song and a model, exported it and played it, and the log file
  shows what happened.
- Every step above is marked DONE here with its commit, its test and its
  render check.
- `EVAL.md` carries at least one rating row, and the guide tells a tester
  how to add theirs.
