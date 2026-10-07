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
| R4 | beats without Python: a TypeScript beat tracker (the full route is `CLIPS.md` Step P) | 3 (Step P's 5–10 counted in `CLIPS.md`) |
| R5 | portrait phone media: rotation and EXIF | 1.5 (built first, in `CLIPS.md` step 0, §3.1) |
| R6 | the library pack's fonts and licences | 0.5 |
| R7 | name, app id, icon, version | 0.5 (once you decide) |
| R8 | macOS signing, at least ad hoc | 0.5 to days |
| R9 | a release page from a tag | 0.5 |
| R10 | the tester guide, and the Ollama run | 1 |
| R11 | a log file and Help › Show Logs | 1 |
| R12 | clean-machine smoke test, both platforms | 2 + what it finds |
| R13 | the rest of C4: glitch and liquid | 2 to 3 |
| R14 | the beta.2 list | 3 to 5 |

R1 to R12 is 13 to 15 working days; R13 and R14 make a careful closed beta
about three weeks of work once R1 starts. Four things wait on you: the name (R7), whether to
pay Apple (R8), 45 minutes of rating (R3), and the Freesound originals (R14).
**The total is unchanged by the 2026-10-05 edits**: R2's items 7–9 (1.5
days) and R4's full route (Step P, 5–10 days) are counted once, in
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
(unverified; check it in R12).

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
Python pack under `userData` (5 to 10 days, 300 MB or more), and no Python
half ships in an installer before it. Decided 2026-10-05 (`SHEETS.md:806-809`,
`CLIPS.md` §16.25); it is built inside `CLIPS.md`, before the beta resumes.

**Tests.** `tests/beats.test.ts` on synthetic clicks at known tempos;
`tests/integration/beats.int.test.ts` against the reference recordings'
saved sidecar analyses; mutation: the period doubled.

### R5 — Portrait phone media · a day and a half

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
picked by hand in the gear (the model defaults to none); how to report. The
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
the Surface's GPU, the Surface's look-pass wait and memory, and the Mac
`python3` dialog. What it finds goes back into R2.

### R13 — The rest of C4: glitch and liquid · two to three days

Two new `MomentKind`s on the rails the four have (PLAN.md §7): **glitch**
— a seeded RGB split, block displacement and stutter for Energy and Trailer
drops — and **liquid** — a ripple or ink displacement for Fashion and
Wedding sections. Each is a shader in `momentCanvas.ts`, a parameter curve
in `render/moment.ts` that is exactly the two shots at t = 0 and t = 1, a
`MOMENT_SECONDS` row, a recipe placement, `tests/moment.test.ts` cases, the
harness check, a render check, and a render of the real serum ad. Then the
Opus review, as for the four.

### R14 — The beta.2 list · three to five days

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
  Telugu studios.
- Single-instance lock; a "new version" check against the release page.
- Keep or drop the meme packs from the manifest.

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
