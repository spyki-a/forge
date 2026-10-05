# Clips — from a landscape talk to a vertical clip that explains itself: the plan

> **Status, 2026-10-05. Nothing here is built.** This is the plan for the
> piece agreed with the user on 2026-10-04/05: the reframe engine, caption
> free space, the motion-graphics engine with the Director's third pass, Best
> clips, B-roll, retrieved-fact cards with 3D templates, and creator styles,
> in that order. It follows `PLAN.md`'s form. Each step gives what is wrong or
> what it is, the fix, the files, the shapes, the tests with their mutations,
> the render check, the harness check with its census rows, and an exit bar.
>
> It was written from six readers over the code and one measurer (workflow
> `wf_b205a69c-451`, 2026-10-05). Every number below was run or fetched that
> day on the Mac (the bundled ffmpeg 4.4 and the dev venv's CPython 3.14.6),
> unless it says **unmeasured**. Nothing was run on the Windows 2018 build:
> those rows say **dated** and wait for CI or the Surface. Measurements land
> in `docs/EFFECTS.md` (§37 onward) as each step makes them. This file's
> steps get "Built" notes the way `PLAN.md`'s do.
>
> **Revised the same day after a review** (thirty-three findings, eight of
> them blockers). The review measured more on the Mac's ffmpeg and on the
> live web pages of Wikidata, Commons, X, Brave and the Guardian; the fixer
> re-ran the ones a step stands on (runFfmpeg's log level silencing
> `metadata=print`, zoompan's restamping at 60 fps, `-filter_complex_script`,
> Brave's prices, X's display rules, the Beatles' Wikidata and Commons
> records, the grey-level scene scores, yt-dlp on a `file://` URL). Where
> those changed a fact, the text below says so in place.
>
> **Names.** The left panel the user calls the "sidecar" is the **Shelf**. In
> this file **the Python helper** is the process in `sidecar/` (the code's
> name for it, and what the screen calls "the AI helper"). The app is being
> renamed 3dit; the code still says Forge.

---

## 0. What this is, and the exit bar

The brief has two inputs: a long landscape video (a podcast, a talk, a
wedding speech, a product demo) or its link. The output is vertical clips
that:

- follow the person speaking;
- keep the captions off their face;
- explain themselves, with a counter when a number is said, a step list when
  steps are listed, and a picture of the thing being talked about from a
  source the creator may use.

"In the right way" means three things: measured, preview equal to export,
and never inventing a fact.

| bar | measured how | pass |
|---|---|---|
| **the subject stays in frame** | the reframe render check (§4.9), plus ten real landscape clips the user supplies (interview, two-person podcast, speech, product demo, wedding toast, two of each) | wherever a face was found, the face's box is inside the crop on ≥ 95 % of sampled frames. **No crop is ever held across a cut** (frame-exact, render check). The user rates "follows like an editor would" ≥ 4/5 on ≥ 8 of 10 |
| **captions never cover a face** | the free-space render check (§5.5), plus the same ten clips | zero sampled caption lines intersect a face box, on both caption routes (libass and the canvas bake) |
| **no graphic says what was not said** | the validator, by construction (a property test with adversarial generators, §6.11), plus the graphics eval (§6.10) | **zero** shipped graphics with a number or name that is not in the transcript stretch they cite, with a label paired to a value it was not said with, or with a negation the speaker said and the graphic dropped. The property test checks what the painter DRAWS at the settled frame, not only the spec. A number grounded on a YouTube caption track or an unsure Whisper word is never placed without the user's Keep (§6.6). The truth-hit rate and the drop rate are recorded per configuration. **What this bar cannot promise:** the validator proves a graphic matches the transcript, not that the transcript heard the speaker right |
| **Best clips are worth posting** | ten real links chosen by the user | on ≥ 7 of 10, at least one of the three cards is one the user would post. Recorded separately with the model and with the signal fallback |
| **every outside picture is licensed and credited** | the licence gate's tests, plus the credits render check (§8.10) | every B-roll asset carries a credit, and every **required** credit reaches the export's Done line until the user copies it. Nothing outside PD / CC0 / CC BY by default; BY-SA only with the switch on, and each BY-SA file says so at its own click. **No picture that may show a person is placed without the user's confirmation**: the dialog shows unless the file is shown NOT to depict people (§8.6) |
| **it fits the floor machine** | Clip it end to end on the Surface (the 8 GB-class floor machine, `FIX.md:1060`), with the helper's peak RSS recorded (§12.1) | no swapping during the run, on a 10-minute 1080p source |
| **it never falls over** | every degraded mode in §14 rendered | each one produces a playable file and says what it left out |

**The principle, carried over from `PLAN.md`: the model chooses and copies;
code composes and checks.** In this piece that means:

- **The model never writes code and never times anything.** It picks a
  sentence id and a template id, and copies words. Every frame comes from
  word timings and shot boundaries.
- **The validator drops any graphic whose numbers or names are not in the
  stretch of transcript it cites.** A dropped graphic costs a note, never the
  clip.
- **The 2B model has no browsing.** The app fetches, the model extracts.
  Every card quotes something that was fetched and carries its source.
- **Every download is the user's click**: B-roll, and every model that is
  not on disk (the face finder, BiRefNet 109 MB, Florence-2 275 MB,
  faster-whisper small 464 MB) and a link's audio. The button that starts
  one names its size before the press, as the packs do (`Get · 57 MB`) and
  as yt-dlp's first fetch does. **No toggle and no typed phrase ever starts
  a download.**
- **Detection and scene cuts are measurements.** Where a detector's box and a
  model's opinion disagree, the box wins (`PLAN.md` §4.3 rule 4).

---

## 1. What exists — the rails this is built on

| piece | where | what it gives this plan |
|---|---|---|
| the crop | `CropRect` in SOURCE pixels, one static rectangle per clip (`src/shared/timeline.ts:224-234`, `:314-315`); `solveCrop` (`render/crop.ts:144`, centred: 1920×1080 → 9:16 gives `{656,0,608,1080}`), `safeCrop` (`:69`), `effectiveCrop` (`:114`), `evenDown` (`:38`) | the mechanical half of sheet 14. Every reframe rectangle goes through `safeCrop` |
| the subject-centred rule | `fitRect(cx, cy, h, aspect, source)` (`automation/framing.ts:204`); `framingLadder`'s `wide` rung (`:124-125`) is "full height, centred on the subject's x" | the box-to-crop function. **It does not even its output** (1215 px wide on a 4K 9:16; measured), so it is always followed by `safeCrop` |
| the render's crop | `cropFilter` (`render/plan.ts:637-666`), in the per-clip chain at `:1173` after steady, hold and retime (`:1165`), and before the camera move or zoom (`:1190`), the fit and `fps=` (`:1192`). **At speed 1 there is no retime** (`speedVideoFilter` returns null, `render/speed.ts:248`), so the crop and zoompan see the SOURCE's timestamps, not the project's frames | measured: `w`/`h` are evaluated once, and `x`/`y` on every frame (below) |
| the render's command line | `buildRenderPlan` puts the whole graph in one argument, `'-filter_complex', filters.join(';')` (`plan.ts:1979`); `renderJob.ts:43-49` spawns it. 22 test files read the graph as `args[args.indexOf('-filter_complex') + 1]` | Windows' `CreateProcess` caps a command line at 32,767 characters; a followed clip's crop expression is long (§3.7) |
| keyed properties | `KeyedProperty` (`render/keyframes.ts:35-49`); the mask tracks are the template for tracks kept off the clip's own rows (`MASK_PROPERTIES` `:67`, `MASK_TRACK` `render/mask.ts:420-428`); `rebaseAnimation` (`timeline.ts:1121-1138`) and `convertFrameRate` (`project/frameRate.ts:77-83`) carry any key track | crop keys ride these for free |
| source ↔ timeline | `sourceFrameFor` (`timeline.ts:1002`), speed- and ramp-aware and monotone. **There is no inverse** | needed to put a source-time cut on a timeline frame |
| aspect switch | `setAspect` (`renderer/store.ts:1363-1391`) **replaces every clip's crop with `solveCrop`** (`:1387`), then `rebakeGenerated` (`:1406-1455`) | must learn to re-derive a reframed clip rather than wipe it |
| a subject box | `ParallaxBake.subjectBox` (`timeline.ts:752-777`): BiRefNet's matte bbox, normalised 0..1 to 4 dp, for stills only (`sidecar/forge_sidecar/capabilities/depth.py:291-318`); consumed by the one-photo reel (`store.ts:2297-2309`) | the box convention, the normalised→pixel conversion, and a salient-subject model (109 MB; on disk on the dev Mac, **a download for any user who never baked depth**, §4.4) |
| the Python helper | the `OPTIONAL` table (`capabilities/__init__.py:15-44`, one degraded reason per row); the degraded and unavailable rules (`rpc.py:77-91`, `:115-128`, `:143-152`); progress and cooperative cancel (`rpc.py:35-61`, `src/main/sidecar/client.ts:186-239`); models under `userData/models` in hf cache layout (`service.ts:39-44`, `client.ts:96-107`); ffmpeg decode helpers (`depth.py:174-225`) | the shape every new capability takes |
| ffmpeg work in main | the stems handler does its mid/side in main because "the ffmpeg to do it is already here" (`src/main/ipc.ts:762-770`); `runFfmpeg` / `killProcess` (`src/main/ffmpeg/run.ts:42-74`). **`runFfmpeg` was built for renders**: unless `complete: true` it prepends `-loglevel error` (`run.ts:80-82`), it keeps only the last 12 stderr lines (`:33`, `:96-103`, split per chunk, so a line can be cut in two) and shows them only on failure, and every failure unlinks `outputPath` (`:117-121`) | the scene-cut pass lives here and needs no Python, but **not on `runFfmpeg` as it is**: `metadata=print` logs at INFO, so `-loglevel error` prints no scene line at all (measured, §4.2) |
| long jobs | the `downloads` `JobQueue` (`ipc.ts:114-207`, concurrency 2) chains a Python-helper call with its own bar share and cancel; it shares the `jobs:changed` list with exports, so jobs show in the EXPORT strip | the analysis job's model |
| transcripts | `Transcript {words, segments}` keyed by asset, in SOURCE ms (`src/shared/transcript.ts:10-43`). Segments are "the boundary IDs the director picks from" (`:19-22`). `withWordText` never renumbers (`:125-133`). `segmentIntoSentences` splits on `SENTENCE_END` (`:48`, `[.!?…]` only: **no Devanagari danda `।`**) and on a 700 ms pause (`:46`), and has no length cap | sentence ids for every pass; word indices as stable anchors |
| captions | two export routes. libass `subtitles` (`plan.ts:1649`, `src/main/captions.ts:84`, `buildAss` writes one `Dialogue` per line, `captions/ass.ts:180`). The canvas bake (`renderer/captionBake.ts` via `buildGraphicsSpec`, `graphics/fromTimeline.ts:81`) when the style needs a canvas (`:43-63`). One `captionSpec` per line (`captions/line.ts:48`) | per-line placement goes into both |
| the lyric-cut logic | `accentsFrom` (`automation/lyrics.ts:133`), `planLyricCuts` (min gap 160 ms, `:211`). Punch is ASCII-only (`:77`) | beats on spoken words |
| the Director's plumbing | `askStructured` (`director/ask.ts:29-48`); the flat-schema checker (`conforms.ts`); `run.ts`'s menu and settle functions shared with the eval (`:184-250`); moments placement (`apply2.ts:349-435`) and cards (`:522-573`); `decisionFor2` (`:665-687`); the eval relay | the third pass, Best clips scoring and the B-roll pass |
| the moments engine | `render/moment.ts` (pure, seeded, `movingFrames`), `renderer/momentCanvas.ts` (live preview, bake, dispose), `threeShared.ts` (one renderer), `render/exportBake.ts` (`Bakers`; a drawn clip that cannot be drawn is **dropped**, `:130-144`, `:164-167`) | the graphics engine's rails, 2D and 3D |
| 2D painters | `drawTextOnto` (`render/textPaint.ts:44`), `paperPaint.ts`; the fake-context test (`tests/textPaint.test.ts:20-47`) | 2D templates, testable in node |
| caption styles | `Project.captions {styleId, overrides}` (`timeline.ts:44-50`), `resolveStyle` (`captions/style.ts:137-176`), the OUTPUT strip's presets (`OutputStrip.tsx:225-268`) | the model for the graphic style |
| URL ingest | `buildYtDlpArgs` (`shared/ingest/args.ts:117-226`), `downloadMedia` (`src/main/ingest/download.ts`), `section.ts` (`PAD_MS` 10 s `:52`, `offsetIntoDownload` `:97`), `collectIngest` (`store.ts:4662-4747`, one undo), `IngestPanel.tsx` | Best clips' transcript and Clip it's ranged download |
| keys | the Director's write-only path: `setDirectorSettings` (`src/main/director.ts:61-84`), `publicConfig` → `hasKey` (`director/provider.ts:82-98`), the IPC whitelist (`ipc.ts:830-848`), `redactKey` (`shared/voice/provider.ts:190`). Settings' "coming with Narration" rows (`SettingsPanel.tsx:276-280`) | the Pexels and Brave keys |
| consent | packs: the button is the ask, `Get · 57 MB` (`shared/assets/pack.ts:367`); the renderer picks an id and main picks the URL (`ipc.ts:588-601`) | the B-roll download flow |
| the paste fix | `ed7ff0f`: a pasted self-drawn clip gets its own asset record (`edit/recipes.ts:277-284`) | a new self-drawn kind inherits it through `drawsItself` |

**What bounds the design:**

- **Two ffmpegs, and the scene score is computed differently on each.**
  Measured on the Mac and read in the 2018 source (§4.2). Every analysis
  filter also goes into `tests/oldestFfmpeg.test.ts`.
- **Installed users have no Python** (BETA R4; `service.ts:26-35`;
  `electron-builder.yml` excludes `.venv`). Every capability must degrade.
  Scene cuts, Best clips over YouTube's own captions, graphics and captions
  **over a transcript that already exists** (a link's caption track), and
  B-roll need no Python. The creator's own footage has no transcript until
  Whisper makes one, and Whisper is Python, so for own footage captions and
  graphics need it too; so do faces, and so does the `callout` template
  (§12). Step P (§3a) is what puts Python on an installed machine.
- **The floor machine is 8 GB** (the Surface, `FIX.md:1060`). E2B is
  ~2–3 GB resident and Electron 1–2 GB before anything loads
  (`LLM.md:165-167`), and the helper caches every ONNX session for its whole
  life (`depth.py:97-98`, `:129-151`). Every model this plan adds is
  budgeted against that (§12.1).
- **The renderer cannot reach the network**
  (`src/renderer/index.html:6-9`: `connect-src 'self' forge-media:`). Every
  search, thumbnail and download happens in main.
- **The development sandbox can reach neither localhost nor Electron.**
  Electron 44 aborts at start-up (`mach_port_rendezvous … Permission
  denied`), and the macOS MediaPipe wheel aborts with no Metal device. Those
  measurements are the user's to run, on their own machine (§15).

---

## 2. The order, and the days

| step | what | days | needs | proves |
|---|---|---|---|---|
| **M0** (offered, §7.6) | transcript rows → **Clip it** on a timeline clip: row selection, `clipToRange`, `timelineFrameAt` | ~2, **moved** from 1f and step 4, not added | — | sheet 26 on the user's own footage, with no Python wherever a transcript exists |
| **0** | the ground: R5's rotation-aware probe, held keys landing on their frame, `adelay` in samples, zoom keys on video, **the graph in a file**, the floor list, the helper's shared media code | 4.5 | — | the measured bugs under every later step are gone |
| **P** (§3a) | **BETA R4's full route**: the app installs its own Python pack under `userData` | 5–10 (`BETA.md`'s 1–2 weeks) | — | every Python half below reaches an installed user |
| **1** | the reframe engine: scene cuts in main, faces, a salient box, Florence-2 grounding, the crop path, the followed crop, "Reframe to 9:16" | 16 (1g Florence is 3 of them, gated by its own measurement) | 0; P for faces on an installed machine | a landscape talk becomes a 9:16 that follows its subject, frame-exact at every cut |
| **2** | caption free space | 2.5 | 1 | captions stay off faces, stable within a shot |
| **3** | the graphics engine (six 2D templates), the graphic style, the Director's third pass with its validator | 14.5 | 2 for placement (degrades to the style's third without it) | a spoken number becomes a counter that lands on the word, and nothing unsaid is ever drawn |
| **4** | Best clips in the URL tile; transcript → Clip it (sheet 26) | 11 (9 if M0 was taken) | 1–3 (each optional at run time) | a link becomes three clip cards and a 9:16 clip with captions |
| **5** | B-roll: the Pexels key, five sources, cards, the X capture, credits, the person rule | 15.5 | 3 (cards are templates) | pictures arrive licensed, credited, and only by click |
| **6** | retrieved-fact cards with the Brave key and its cap; the 3D templates | 8 | 3, 5 | facts from outside, with their sources; three.js graphics |
| **7** | creator styles and saved templates | 4.5 | 3; **`MARKET.md` Stage 0** (below) | toward `MARKET.md` Stage 1 |

**About 76.5 working days, plus Step P's 5–10: 82–87 days, sixteen to
seventeen weeks, honestly counted.** What the review added, so the number can
be checked: step 0 +0.5 (the graph in a file, §3.7); step 1 +2 (shots' own
runner +0.5, YuNet's hand decoder +0.5, the followed crop compiled at read
time +0.5, releasing the helper's sessions +0.5); step 3 +1.5 (the binding
validator, negators, fixed titles, the painter's contract, ASR proposals);
step 4 +1.5 (json3 word ends and segment caps, the exact-cut measurement and
its real yt-dlp test, Clip it into its own project); step 5 +1.5 (the person
rule from Commons' depicts and the face check, the credits' licence links and
Done line; the Brave row moved to step 6); step 6 +1 (Brave's monthly cap and
its key in `safeStorage`). **These dates are conditional on "your part"
below**: step 1a cannot run until its clips and marks exist.

It is achievable because each step ships on its own. What each milestone
gives **an installed user**, with and without Step P:

- **M0 (~2, if taken):** select transcript rows, Clip it. Needs a transcript:
  a link's captions with no Python; Whisper, so Python, for own footage.
- **M1, steps 0–2 without 1g (~20 days):** with P, "Reframe to 9:16" follows
  the subject and captions dodge faces. **Without P it shows nothing new**:
  the shots are found but every crop is the centre, which is today's
  `solveCrop`, and Smart placement and Follow the subject are greyed with
  "needs the AI helper". So M1 does not reach an installer before P.
- **M2, step 3 (~14.5):** graphics on spoken numbers. Without P: over a
  link's caption track only, and no `callout` (it needs a face box).
- **M3, step 4 (~11):** Best clips from a link. **The first milestone that
  is useful without Python**: YouTube's captions, centred crops, captions,
  graphics.
- **M4, step 5 (~15.5):** B-roll. No Python needed; without the helper, the
  face check that clears a picture of people cannot run, so every candidate
  that might show one asks (§8.6).
- **M5, steps 1g, 6 and 7 (~15.5).**

Florence-2 (1g) can slip behind M3 without blocking anything, because the
salient box (1d) covers the no-face shot until then.

**Where this sits against the beta.** `BETA.md` puts a closed beta about
three weeks away (R1–R12 are 13–15 working days, R13 and R14 after), with
only R2.6 done. So:

- **§3.2–3.4 are beta blockers, not plan steps.** They are bugs in features
  that ship today (every split clicks, zoom keys freeze or slow a video,
  held keys land a frame late), and `BETA.md`'s "nothing embarrassing" rule
  covers them. They belong in `BETA.md` R2 now, as R5 is already shared
  (§3.1). That is an edit to `BETA.md`, made when you agree (decision
  §16.25); the days are counted once, here.
- **`BETA.md` R4 still says the full route is "Not for the beta"**
  (`BETA.md:142-143`), while `SHEETS.md:806-809` records your decision that
  the installed app sets Python up itself and that "the beta plan's R4
  changes accordingly". This plan makes the full route Step P. `BETA.md` R4
  is edited to match when you confirm (decision §16.25).
- **The order, outright:** beta R1–R12 (with §3.2–3.4 in R2) → the rest of
  step 0 → M0 if you take it → M1, built while Step P is built, and shipped
  only with P → M2 → M3 → beta.2 (`BETA.md` R14) → M4 → M5. Steps 5–7
  (about 28 days) are after the beta on any reading.
- **Step 7 is gated on `MARKET.md` Stage 0** (`MARKET.md:94-103`): Phase C
  measured and finished (it is paused), and a music library with
  redistribution rights or the `filler-supplies` policy alone for paid
  templates. Until those hold, step 7's saved templates wait (§10).

### Your part — what gates the dates

None of these can be done by the planner or committed from third-party
speech. Asked for on **day 0**, so step 0 runs while they are collected.

| item | roughly | gates |
|---|---|---|
| ten landscape clips (interview, two-person podcast, speech, product demo, wedding toast, two of each), with a `cuts.json` of hand-marked cut times | 3–4 h | 1a's threshold; step 1's exit |
| ~300 hand-marked face frames (30 per clip) | 3–5 h | 1a's detector choice (§16.1) |
| the detector comparison run on the Mac and on the Surface (neither MediaPipe nor Electron runs in the dev sandbox) | 1–2 h | 1a, then 1c |
| a ten-second clip of yourself as the face fixture (§16.5) | 15 min | 1c's integration tests |
| the Florence-2 int8 download (275 MB) and its timing on the Mac and the Surface | 1 h | 1g's gate |
| the helper's peak memory per capability on the Surface (§12.1) | 1 h | the floor-machine bar |
| ten graphics fixtures with truth labels (six English, two Telugu, two Hindi), your own speech or text you wrote | 4–6 h | step 3's eval and exit |
| three YouTube videos for ASR timing against Whisper, and three with unpunctuated ASR tracks (one Hindi or Telugu) | 1 h | §7.2, before §7.3 |
| ten Best clips links, and rating their cards | 3 h | step 4's exit |
| the exact-cut measurement on the Surface, if CI cannot run yt-dlp (§7.1) | 30 min | §16.13 |
| reading Pexels' licence and API guidelines in a browser (Cloudflare blocks the sandbox) | 30 min | 8.3 |
| reading X's developer agreement and policy beyond the display rules (the display rules are now read, §8.4) | 30 min | 8.4 |
| reading Brave's Terms §3 | 30 min | step 6's search card |
| signing up for Pexels (free) and Brave (a card on file) | 20 min | 8.3, step 6 |
| the X capture measurement under `npm run dev` on the Mac and the Surface | 1 h | 8.4 |
| Clip it end to end on the Surface | 1 h | step 4's exit, the floor-machine bar |

**About 20–28 hours in all, spread over the plan.** The first five rows are
needed before step 1 can finish; M1's date moves with them.

Every step ends the same way: typecheck green; the full suite green (output
written to a file, `$?` checked; `CLAUDE.md`); the render check's output in
`tests/output/<check>/` looked at; the listed mutations killed; CI read at
github.com/spyki-a/forge/actions; `WHERE-THINGS-ARE.md` and the UI census
updated for every new control.

---

## 3. Step 0 — The ground under it · 4.5 days

Six measured bugs and three pieces of plumbing that every later step stands
on. Each is small and ships on its own commit. **§3.2–3.4 are bugs in what
ships today, and belong in `BETA.md` R2** (§2); they are written here because
the reframe stands on them.

### 3.1 R5 — the rotation-aware probe · 1.5 days (`BETA.md` R5, pulled forward)

**What is wrong, measured.** A 640×360 clip remuxed with `rotate=90` probes
as `width=640, height=360` (side data rotation 90, tag rotate 270), and the
bundled ffmpeg **autorotates on decode**: `scale=320:-2` came out 320×568.
So `MediaAsset.width/height` (`src/main/ffmpeg/probe.ts:70`) and the frames
a detector sees disagree on orientation, and a normalised box from the helper
would be laid on the wrong axes.

**The fix** is BETA R5 as written there: the probe reads
`side_data_list` rotation and swaps the sides; tagged JPEGs are turned at
import. In the Python helper, `media.probe_upright()` (§3.6) does the same,
and every new capability **refuses a file whose upright size disagrees with
the size main sent**, rather than returning boxes against the wrong frame.

**Tests.** BETA's `tests/integration/rotation.int.test.ts`. Mutation: the
probe ignores the matrix.

### 3.2 Held keys land one frame late in the export · half a day

**What is wrong, measured.** `keyframeExpression` (`render/keyframes.ts:318-329`)
writes each segment boundary as `lt(t, (frame/fps).toFixed(4))`. Keys
`[{0, 0, hold}, {5, 1000}]` at 30 fps emit `if(lt(t,0.1667),0,1000)`. Frame 5
sits at t = 0.16666…, still under 0.1667, so ffmpeg steps on **frame 6**,
while the preview's `valueAt` steps on frame 5. At 30 fps, every key on a
frame ≡ 2 (mod 3) is late; 25 fps is exact. This already affects held
opacity, rotation and mask keys today. `tests/integration/keyframes.int.test.ts:121-131`
samples only 0.1 s and 1.0 s, so it cannot catch it. A held crop key at a cut
would show the new shot's first frame with the old crop, which is exactly the
reframe's failure.

**The fix.** Every boundary compares against the half frame,
`lt(t, ((frame − 0.5)/fps).toFixed(6))`. Frame f−1 at (f−1)/fps falls below
it and frame f at f/fps does not, for any fps, and continuous segments are
unaffected because both sides agree at the boundary.

**Tests.** A render check in `keyframes.int.test.ts`: opacity held 0 → 1 at
frame 5 and at frame 8, at 30, 24 and 25 fps. The frame AT the key carries
the new value and the frame before does not. Any test pinning the
expression's text is rewritten to assert rendered frames instead. Mutation:
restore `toFixed(4)` of `frame/fps`, and the 30 fps frame-5 row fails
(measured: frame 6 today).

### 3.3 Every split clicks — `adelay` in samples · half a day

**What is wrong, measured.** `delayMs = Math.round(start × 1000)`
(`plan.ts:1761`). At 30 fps, frame 47 is 1566.667 ms, rounded to 1567, which
is 16 samples late at 48 kHz. Through the real `buildRenderPlan`, a 440 Hz
tone split at frames 47 and 95 has a second-difference spike of **0.149** at
frame 47, against 0.0012 unsplit. That is every user split today, and any cut
a later step makes.

**The fix.** Delay in samples: `adelay=${n}S|${n}S|…` with
`n = round(start/fps × sampleRate)`. The chain already resamples to
`project.settings.sampleRate` before the delay (`plan.ts:1763-1764`). Measured
on the Mac: `75200S` starts exactly at sample 75200. Dated for Windows, from
the source at commit `7748f395de` (committed 2018-11-11, inside the floor),
read for this plan: `sscanf(arg, "%d%c", &d->delay, &type)` takes the `S`
form exactly. Its fallback `%f` path parses fractional ms into a **float**
and truncates `delay × rate / 1000`. That is why samples beat "fractional ms":
a float holds 3,600,000.333 ms only to 0.25 ms, so an hour into a timeline
it would be up to 12 samples off.

**Tests.** A render check (`tests/integration/audioSplit.int.test.ts`, into
`tests/output/audio-split/`): the split tone has no second-difference spike
above 0.01 at either cut. It runs in CI on the 2018 build, which is the
Windows measurement. Mutation: back to rounded ms, and the frame-47 spike
returns.

### 3.4 Zoom keys on a video clip export a frozen frame · half a day

**What is wrong, measured.** `zoomKeyframeFilter` emits
`zoompan … d=${clip.duration}` (`plan.ts:437`, `:472`), and zoompan's `d` is
output frames *per input frame*. A video clip with zoom keys 1 → 1.5 exported
its frame 0 held while the unkeyed clip moved. `Keyframes.tsx:59` offers Zoom
on any clip. A punch-in on reframed footage would meet this.

**`d=1` alone is wrong, measured.** zoompan restamps every output frame as
its own `frame_count / fps` (the 2018 source, `f22fcd4` `vf_zoompan.c:158`,
`:225`, read by the review) and forwards the input's EOF pts unrescaled
(`:309-310`). At speed 1 no `fps=` runs before it (§1: `speed.ts:248`), so it
sees the source's own frames:

- a 2.000 s 60 fps mp4 through `zoompan=…:d=1:fps=30` gave 120 frames over
  4.000 s, **half speed**;
- 29.97 fps gave 300 frames over 10.000 s against a 10.010 s input, a drift
  the audio slips against;
- behind the chain's trailing `fps=30` (`plan.ts:1192`), the 60 fps source
  came out as **30,720 frames over 1,024 s** (re-measured by the fixer).

**The fix.** For a video input emit `fps=${fps},zoompan=…:d=1:…:fps=${fps}`,
so zoompan meets exactly one input frame per output frame and `on` counts
timeline frames. Measured on the Mac with the trailing `fps=` in place: 60
frames over 2.000 s from the 60 fps source, and 300 over 10.000 s from
29.97. If the render check below refuses it on the 2018 build instead, zoom
keys on video are refused in **both** places that offer them, since both
list `KEYED_PROPERTIES` (`render/keyframes.ts:64`): `Keyframes.tsx:59` and
`CurvePanel.tsx:53`, each with the same tooltip.

**Tests.** A render check (`tests/integration/zoomVideo.int.test.ts`, into
`tests/output/zoom-video/`) with **60 fps and 29.97 fps** sources, each with
an AAC track: frame count, duration and the A/V start offset of the export
against the unzoomed clip, plus frames 0 / mid / last against it scaled. It
runs in Windows CI, which is the 2018 measurement. A same-rate 30 fps
fixture would pass with the slow-motion bug in, so none is used alone.
Mutations: `d=clip.duration` again (frozen frame); the leading `fps=` dropped
(the 60 fps case doubles its duration).

### 3.5 The floor, and the caches · half a day

- `tests/oldestFfmpeg.test.ts`: add `/\bscdet\b/` to `TOO_NEW`. scdet merged
  2020-05-14, and the Mac build **has** it (it ran, giving `lavfi.scd.score:
  15.625`), which is how it would ship broken, the `colortemperature` story.
  `graphOf` (`:120-125`) scans only `buildRenderPlan`'s graph, so add
  `ANALYSIS_SHAPES`. These are the pure argument builders that are not
  render plans (`sceneArgs` §4.2, the face-decode args §4.3), scanned by the
  same blocklist.
- `client.ts` sets `FORGE_CACHE_DIR = userData/cache`. Today parallax bakes
  default to `~/.cache/forge/parallax` (measured: 264 MB, never evicted),
  against `SIDECAR.md`'s own rule. New caches (face tracks) must not repeat
  that. What happens to the old 264 MB is decision §16.24.

### 3.6 The helper's shared media code — `sidecar/forge_sidecar/media.py` · half a day

`vision.py:25` imports `_decode_rgb` / `_probe_size` from `depth.py`, and
`_models_dir()` is copied three times (`asr.py:25`, `depth.py:101`,
`voice.py:38`). One module:

```python
# sidecar/forge_sidecar/media.py
def probe_upright(path, ffprobe) -> dict      # {width, height, rotation, durationMs, fps} — sides swapped at ±90
def decode_rgb(path, ffmpeg, w, h, at_ms=None) -> np.ndarray   # one frame; `-ss at_ms` BEFORE -i (measured 30–80 ms a seek, exact shot)
def iter_frames(path, ffmpeg, fps, w, h, start_ms, end_ms, context) -> Iterator[tuple[int, np.ndarray]]
    # subprocess.Popen, exact w*h*3 reads, context.raise_if_cancelled() per frame, proc.kill() in finally
def models_dir() -> Path                      # $FORGE_MODELS_DIR, else ~/.cache/forge/models
def cache_dir(name) -> Path                   # $FORGE_CACHE_DIR/<name>
def download(repo, filename, revision, context, label) -> Path
    # hf_hub_download(..., revision=pinned, tqdm_class=<forwards bytes/total → context.progress(f, 'downloading <label> (N MB, first run only)')>)
def fetch_url(url, sha256, context, label) -> Path   # for files not on HF (the MediaPipe .tflite, §4.3)
```

Measured facts it encodes:

- **Streaming.** A whole video through `_decode_rgb`'s `capture_output` is
  414,720,000 bytes for 20 s at 640×360. `iter_frames` streams instead: 50
  frames read, then `kill()` gives returncode −9, 0.18 s in all. At fps 5 and
  480×270, 20 s of 1080p decodes in 0.26 s.
- **Byte progress.** `huggingface_hub` 1.31.0's `hf_hub_download` takes
  `tqdm_class`, `revision` and `local_files_only` (inspected), so byte
  progress needs no new dependency.
- **Pinned revisions.** Every model download pins its `revision`; today
  nothing does.

`__init__.py`'s `OPTIONAL` becomes `[(methods: tuple, module)]`, and a
failing module marks **every** method it would have registered as degraded.
Measured today: `voice.voices` answers METHOD_NOT_FOUND rather than
"unavailable", because only `voice.speak` is in the table. `protocol.ts:140-161`
gains constants for the literals `ipc.ts:657` and `voice.ts:113,147` use.

**Tests.** `tests/integration/sidecar.int.test.ts` gains: on the bare
interpreter, each of `voice.speak` and `voice.voices` is in `degraded`
(membership, not the list). Mutation: register-and-degrade only the first
method.

### 3.7 The graph goes in a file — `-filter_complex_script` · half a day

**What is wrong, measured by the review.** The whole graph is one argument
(`plan.ts:1979`), and Windows' `CreateProcess` caps a command line at 32,767
characters. The real `keyframeExpression` for a 10-minute 30 fps followed
clip with 120 held cuts and 60 eased pans is 12,832 characters, 12,877 as
its crop filter. A 30-minute podcast as one followed clip (about 38 KB), or
three 10-minute followed clips, **fails to spawn on Windows only**. The
Mac's `ARG_MAX` hides it, so a Mac-run check that only records a length
passes.

**The fix.** Every render writes its graph to a file and passes
`-filter_complex_script <file>`. Measured on the Mac 4.4 build (the fixer
re-ran it), and present in the exact Windows source, `f22fcd4`
`fftools/ffmpeg_opt.c:3109` and `:3478` (read by the review). The path is an
option value, not inside a filter argument, so the drive-letter colon and
the escaping table do not apply. `buildRenderPlan` stays pure and keeps
emitting `-filter_complex <graph>`, so the 22 test files that read
`args[indexOf('-filter_complex') + 1]` are untouched. A pure
`withGraphFile(args, file): string[]` in `src/shared/render/graphFile.ts`
swaps the pair, and `renderJob.ts:43-49` writes the graph beside the job's
other temporaries before it spawns. The copy-pasteable command a failure
reports prints the script's path.

**Tests.**

- `tests/graphFile.test.ts`: `withGraphFile` replaces exactly one
  `-filter_complex` pair (counted with `filter`, not `indexOf`) and keeps
  every other argument in order.
- A unit test builds the 360-cut project and asserts the argv after
  `withGraphFile` is under 30,000 characters. Mutation: skip the swap, and
  it fails.
- **A 360-cut render check** (`tests/integration/longGraph.int.test.ts`)
  goes through `withGraphFile` and runs in Windows CI, so the script route is
  measured on the 2018 build. Integration tests that spawn a plan directly
  keep doing so; this one exists so the route a user's export takes is the
  one Windows CI runs.

**Exit.** All seven commits in, each with its render check or test, CI green
on Windows (that run is the measurement for §3.3, §3.4 and §3.7 there).

---

## 3a. Step P — Python on an installed machine · 5–10 days (`BETA.md` R4's full route)

**What is wrong.** The installers ship no Python (`service.ts:26-35`); the
packaged app spawns a bare interpreter, because `.venv` is excluded. Every
Python half of this plan (faces, salient, ground, Whisper for own footage
and for links without captions) reaches no installed user until this lands.
`BETA.md` R4 calls the full route "later" and "Not for the beta"
(`BETA.md:142-143`); you decided otherwise (`SHEETS.md:806-809`), and this
step is that decision, scheduled.

**What it is**, as `BETA.md` R4 sketches it: a Python pack the app installs
under `userData` (300 MB or more, 1–2 weeks by that estimate), from
`requirements.txt` plus the optional files this plan adds (§12). Its own
download button with its size (§0's click rule), its own progress, a
version, and a repair path.

**Its details are `BETA.md` R4's to write** when you confirm the edit there
(§16.25). This plan holds only the bar: **no step's Python half is shipped
in an installer until P is in it**, and every Python control is greyed with
"needs the AI helper" before then, never offered as a control that changes
nothing (§12).

**Exit.** A clean Mac and the Surface, with no Python of their own, install
the pack from the app and pass the twelve helper tests from inside it.

---

## 4. Step 1 — The reframe engine · 16 days

**What is missing.** Sheet 14's deciding half. Nothing works out *where* the
interesting part of the frame is, so a landscape video on a 9:16 canvas is
cut down the middle (`solveCrop`), or, in the Director, kept whole over a
blurred copy. A 16:9 frame in a 9:16 ad keeps 31.6 % of the picture, below
`BACKDROP_KEEP` 2/3 (`director/apply2.ts:104`, `:178-181`).

**What it is.** Four measurements and a deterministic solver:

1. **Shot boundaries** from ffmpeg's scene score, in main (§4.2).
2. **Faces**, per sampled frame, in the Python helper (§4.3).
3. **A subject when there is no face**: BiRefNet's salient box (already
   installed) for one frame per shot (§4.4), and Florence-2 grounding of a
   named subject such as "the product" (§4.5).
4. **A crop path** of one box per shot that pans only when the subject leaves
   it (§4.6), applied as **ordinary clip edits through the existing crop
   solver**: one crop size per clip, with the free axis keyed (§4.7).

**Not MediaPipe AutoFlip** (a C++ graph, no wheel). **Not `cropdetect`**
(black bars only).

### 4.1 1a — Measure first · 1 day

Two things the plan cannot be finished without. Both are run on the user's
machine, outside the sandbox. Results go to `EFFECTS.md` §37.

**The face detector, on real footage.** The agreed detector is MediaPipe.
Three costs were measured since that was agreed:

- **Weight.** `mediapipe` 1.0.1 (2026-08-14, Apache-2.0) ships `py3-none`
  wheels (Mac arm64 33.7 MB, win_amd64 20.1 MB): one ctypes library, not a
  CPython extension. Its package import pulls `cv2` and `matplotlib.pyplot`
  at module top (`tasks/python/vision/__init__.py` → `drawing_utils.py:20-21`).
  `opencv-contrib-python` (55.7 MB Mac, 53.8 MB Windows) and matplotlib
  (~9.3 MB plus its dependencies) are therefore hard requirements: about
  100 MB of wheels.
- **A clash.** opencv's PyPI page says to install only one `cv2` package,
  and mask tracking plans `opencv-python-headless` (`PLAN.md:363-366`).
- **A process kill.** On this Mac, 0.10.35 (same Requires-Dist, same ctypes
  design) **aborted the whole process** with SIGABRT, exit 134
  (`gl_context_nsgl.cc failed to create pixel format` → `Check failed:
  service_`), even with `Delegate.CPU` and in IMAGE mode, because the sandbox
  has no Metal device. Whether it runs on a normal Mac, on the Surface, and
  on CPython 3.14 (the classifiers stop at 3.12) is **unmeasured**.
- **Range.** Only `blaze_face_short_range.tflite` (229,746 B) is meant for the
  Tasks `FaceDetector`. Short range means faces within about 2 m. Whether it
  accepts `blaze_face_full_range` (1,083,786 B, served) is **unmeasured**.
  Landscape interviews often have small faces.

Measured alongside, as evidence only: **YuNet**
(`opencv/face_detection_yunet`, MIT, 232,589 B ONNX) loads on the venv's
onnxruntime 1.30 CPU and ran at about 10 ms a frame at 640×640 with 4
threads, **on random input**. Its accuracy is **unmeasured**. It needs no pip
addition and uses the same download path as depth. **But its decoder is not
free**: the reference wrapper in that repo is `cv2.FaceDetectorYN`
(`yunet.py:10`, `:22`, read by the review), so on onnxruntime the 2023mar
model's multi-stride cls / obj / bbox / kps outputs need prior decoding and
NMS written by hand in numpy (§4.3). The comparison below runs YuNet
**through that hand decoder, not through cv2**; a decode bug would otherwise
look like poor recall in the very comparison the choice rests on.

The comparison runs both on the user's ten clips, at 5 fps and a 640 px long
side (YuNet through the hand decoder, so 1a waits on its first half day from
1c), and records five things:

- recall on faces ≥ 40 px and ≥ 20 px tall, against the user's hand marks
  on 30 frames per clip;
- ms per frame on the Mac and the Surface;
- whether the process survives;
- the install weight;
- the import time.

The measurer's script is `/tmp/claude-501/facetest.py`, run with
`PYTHONPATH=/tmp/claude-501/stubs /tmp/claude-501/mpvenv/bin/python
/tmp/claude-501/facetest.py`. The choice is decision §16.1. The rest of this
step is written so that the detector is one module (`faces.py`) behind one
contract (§4.3).

**The scene threshold, on footage with known cuts.** No footage in the repo
has hard cuts. The three reference recordings are continuous takes with
treatments, and the 60 s check is synthetic. The user supplies the ten clips
with a `cuts.json` of hand-marked cut times. Precision and recall are measured
at T = 0.2 / 0.3 / 0.4 / 0.5 on the rgb24 path (§4.2), with the minimum shot
length at 0.3 / 0.5 / 1.0 s.

### 4.2 1b — Shots, in main — `src/main/ffmpeg/shots.ts` · 1.5 days

In main, not the Python helper: it needs only ffmpeg, so it works without
Python (BETA R4), and the stems handler is the precedent (`ipc.ts:762-770`).
`LLM.md:184-186` names TransNetV2 for this; the agreed direction supersedes
that.

**Measured, 2026-10-05:**

| fact | number |
|---|---|
| the syntax works on the bundled Mac ffmpeg | `select='gt(scene,0.3)',metadata=print` prints `pts_time:3` and `lavfi.scene_score=0.400000` for a red→blue cut at exactly 3 s. showinfo's `n` counts OUTPUT frames, so the frame comes from `pts_time × fps` |
| **the score differs by build** | the same red→blue cut scores **0.40** on the Mac's default yuv path, **1.000** with `format=rgb24`, and 0.47 with `format=gray`. The Nov 2018 source (`f_select.c` at `7748f395de`) accepts only RGB24/BGR24 for scene detection. Y-plane scoring (`b696caba1a` 2019-07-22, `ad3ef00ce5` 2019-08-17) landed **after** the floor. The Mac's 0.40 is exactly the Y-only formula. So one threshold means different things on the two platforms, unless the graph forces `format=rgb24` |
| accuracy and cost, 60 s 1080p30, 5 hard cuts | every variant found all 5 at frames 300/600/900/1200/1500 with no false cuts. Wall time: yuv 1.97 s; `scale=320:-2,format=rgb24` **3.11 s** (3.05 s through `execFile` with `windowsHide`), about 19× realtime; rgb24 at full size 8.25 s. Cut scores on rgb24+320 were 1.0/0.93/0.99/1.0/1.0, and the highest within-shot score was 0.095 |
| a cut that does not saturate | on the rgb24 path the score of a uniform grey change is \|ΔA\|/100: lossless 640×360 grey 100 → 140 scored **0.400** and 140 → 120 scored **0.200** (measured by the fixer). These are the parity fixture's non-saturated cuts (§4.9) |
| **the log level** | `metadata=print` logs at INFO. With `runFfmpeg`'s globals (`-hide_banner -nostdin -loglevel error -y`, `run.ts:80-82`) the same graph printed **0** `scene_score` lines; at the default level, `pts_time:3` and `lavfi.scene_score=1.000000` (measured by the review, re-run by the fixer). On `runFfmpeg` as it is, every clip silently becomes one shot |
| real recordings, no hard cuts | median 0.003–0.007, p95 0.06–0.08. Above 0.3 on rgb24: a CapCut grid flash (0.397), card swaps (0.35–0.40), and the first frames of a screen recording (0.56, 0.34) |
| the floor | select's scene score 2012-06-04, as frame metadata 2012-10-21, `metadata` filter 2016-02-10: all **dated safe**. `scdet` merged 2020-05-14: OUT (§3.5) |

**The shape:**

```
ffmpeg -hide_banner -nostats [-ss S] -i <file> [-t D] -an
       -vf "scale=320:-2,format=rgb24,select='gt(scene,T)',metadata=print"
       -f null -
```

Parse `pts_time` and `lavfi.scene_score` from **stderr**. The filter graph
carries no path, so the escaping rules never arise; `metadata=print:file=<path>`
would put one inside an argument, with the drive-letter colon. The scale
comes before `format=rgb24`, so the conversion is cheap. The rotated clip
decodes upright (320×568), which does not matter here because no geometry is
read.

```ts
// src/shared/reframe/shots.ts — pure, so tests/oldestFfmpeg.test.ts can scan it
export const SCENE_DEFAULTS = { threshold: 0.3, minShotMs: 500, skipHeadFrames: 3, edge: 320 } as const  // T and minShot are 1a's to set
export function sceneArgs(path: string, o: { threshold: number; edge: number; startMs?: number; endMs?: number }): string[]
export function parseSceneLog(stderr: string): { ms: number; score: number }[]
export function shotsFrom(cuts: { ms: number; score: number }[], durationMs: number, fps: number,
                          o: { minShotMs: number; skipHeadFrames: number }): Shot[]   // a cut within skipHeadFrames of 0 is dropped; a shot under minShotMs merges into the longer neighbour
```

**The runner.** `src/main/ffmpeg/shots.ts` runs it on `runFfmpeg`, which
gains what an analysis needs and a render never did (`src/main/ffmpeg/run.ts`):

- `complete: true`, with shots' own globals `-hide_banner -nostdin -loglevel
  info` (never `error`: §4.2's table);
- `onStderrLine?: (line: string) => void`, **line-buffered across chunks**
  (today's split per chunk, `run.ts:98`, can cut a line in two: harmless for
  a 12-line error tail, not for a parser), called for every line; the
  12-line tail stays for the error message;
- `outputPath: string | null`, where `null` means nothing to unlink: today
  every failure unlinks `outputPath` (`run.ts:117-121`), meaningless for
  `-f null -` and, given `'-'`, an unlink of a file called `-` in the cwd.

`windowsHide` and `killProcess` stay as they are. Progress comes from
`runFfmpeg`'s own `-progress pipe:1` against the duration; the cuts from
`parseSceneLog` over the lines. An AbortSignal cancels through
`killProcess`.

### 4.3 1c — Faces — `sidecar/forge_sidecar/capabilities/faces.py` · 2.5 days

Its own module and its own `OPTIONAL` row, `(("vision.faces",), "faces")`.
**Never in `vision.py`**: a missing mediapipe must not take `vision.measure`,
the Director's gate, down with it.

```ts
// src/shared/sidecar/protocol.ts — SIDECAR_METHODS.faces = 'vision.faces'
interface FacesParams {
  path: string; ffmpeg: string; ffprobe: string
  width: number; height: number      // the UPRIGHT size main believes (R5); refused when probe_upright disagrees
  startMs?: number; endMs?: number
  fps?: number                       // default 5, clamped 1–30
  edge?: number                      // analysis long side, default 640
  minScore?: number                  // default 0.5
  key: string                        // `${size}:${mtimeMs}` — the cache key, stems-style (stems.py:51-54), never a whole-file sha1
}
interface FacesResult {
  width: number; height: number; durationMs: number
  sampleFps: number; frames: number; withFace: number
  detector: string                   // 'mediapipe/blaze_face_short_range@1.0.1' | 'yunet/2023mar'
  track: string                      // absolute path: $FORGE_CACHE_DIR/faces/<key>-<params hash>.json
  cached: boolean
}
// the track file: { version: 1, samples: [{ ms, faces: [{ x, y, width, height, score }] }] }
//   normalised 0..1 of the upright frame, 4 dp (depth.py:313-318), ms of SOURCE media
```

The track goes to disk, not over the pipe: 10 minutes at 5 fps is 3,000
samples (`protocol.ts:11-15`). Frames come from `media.iter_frames`, with
progress every 10 frames (`'finding faces'`) and a cancel check per frame.

**If MediaPipe is chosen:**

- It runs in a **child process** (`python -m forge_sidecar.workers.mp_faces`)
  that reads the ffmpeg pipe itself and writes the track. `faces.py` relays
  its progress lines and kills it on cancel. A C++ CHECK abort, which is what
  was measured, then ends the child, not the helper, and `faces.py` reports
  `Unavailable('the face detector stopped (exit 134)')`.
- The `.tflite` comes from `storage.googleapis.com/mediapipe-models/…`, not
  Hugging Face, so it goes through `media.fetch_url` with a pinned sha256
  into `models_dir()/mediapipe/`. That is a second host for restricted
  networks to allow, and the Settings line says so.
- Its requirements go in `sidecar/requirements-faces.txt`
  (`mediapipe==1.0.1`, which brings opencv-contrib-python, matplotlib and
  sounddevice), optional in the style of `requirements-stems.txt`.

**If YuNet is chosen:** no worker and no new requirement, but **half a day
for its decoder**, built first because 1a's comparison needs it. It uses
`media.download` from `opencv/face_detection_yunet` at a pinned revision, ORT
`CPUExecutionProvider`, and threads at cpu/2, as depth does
(`depth.py:129-151`). The 2023mar model's outputs are per-stride cls, obj,
bbox and kps maps; `faces.py` decodes them against their priors and runs
NMS in numpy, which `cv2.FaceDetectorYN` does in the reference wrapper.
**The golden test:** `cv2.FaceDetectorYN`'s boxes on the face fixture's
frames, generated once in a scratch venv and committed as JSON (cv2 is never
a dependency); the hand decoder's boxes must match them within 2 px and the
same count per frame. Mutation: a stride's priors off by one cell.

**Either way, the face finder is a download** (0.23 MB for YuNet, 229,746 B
for the MediaPipe model): its first use is the press of a button that says
so (§0).

Main reduces the track for the project (§4.6): **2 samples a second, the two
largest faces**. Pans need about 0.5 s of resolution, and a 10-minute clip
then adds about 1,200 samples (~60–70 KB) to the project file, which is
measured in the step.

### 4.4 1d — The salient box, for a shot with no face — `capabilities/salient.py` · half a day

`LLM.md:162-163` and `:282-283` both say to check depth before adding
anything. BiRefNet already finds the subject of a still. **It is on disk on
the dev Mac (109 MB, measured), not on a user's machine**: a user who never
baked a parallax has to download it, so the first reframe that needs a
salient box shows "Find subjects without faces · gets the subject finder,
109 MB, first time" and asks, never pulling it as a side effect (§0). Without
it, no-face shots fall to the centre with a note. `vision.salient` takes
`{items: [{path, ms}], ffmpeg, ffprobe, width, height}`. It decodes one frame
per item (`media.decode_rgb(at_ms=…)`, measured 30–80 ms a seek), runs
depth's BiRefNet session (imported from `depth.py`; that module holds the
session lock), and returns
`{results: [{ms, box: UnitRect | null, coverage} | {ms, error}]}`. `box` is
`_mask_box` trimmed at 1 %, and is present only when the matte covers 1–92 %,
the same rule as `subjectBox`. Its own `OPTIONAL` row. Main asks it for the
middle frame of every shot with fewer than 20 % of its samples holding a
face.

### 4.5 1g — Florence-2 grounding — `capabilities/ground.py` · 3 days, gated

Built after 1f, and it may slip behind M3. It **grounds a named subject**
("the product", "the cake") on one frame per shot, which the salient box
cannot: BiRefNet finds what is salient, not what is named. The same model
serves caption placement's OCR (§5.3) and later the B-roll pass's frame
description, as `LLM.md:149-163` planned.

**Measured from the hub (no weights downloaded):**

- `onnx-community/Florence-2-base-ft` (MIT, not gated) needs four graphs.
  The int8 set is vision_encoder 93.75 + embed_tokens 39.39 + encoder 43.65
  + decoder_model_merged 98.18 = **275.0 MB**. q4f16 is 223.5 MB, fp16
  544 MB. `LLM.md`'s "0.23B" is the parameter count, not a small download.
- Preprocessing resizes to 768×768 ignoring aspect, bicubic, with ImageNet
  mean and std. Those are the same constants as `depth.py:50-51`, so
  `decode_rgb(path, ffmpeg, 768, 768, at_ms)` reproduces it exactly.
- `tokenizer.json` (2.3 MB) loads with the installed tokenizers 0.23.2:
  vocab 51289, `<loc_0>`=50269 … `<loc_999>`=51268.
- **Task tags are not tokens.** The processor swaps in prompt text, e.g.
  `Locate {input} in the image.` for open-vocabulary detection, or
  `Locate the phrases in the caption: {input}`. Boxes come back as 1000-bin
  coordinates of the squashed square, which are normalised 0..1 of the
  original frame directly.
- Generation is decoder_start 2, eos 2, num_beams 3. The repo publishes only
  Transformers.js usage, so the encoder–decoder loop with past key values is
  **hand-written in numpy** here. Its cost is **unmeasured**.

**The gate: measure before building the rest.** Download the int8 set (on
the user's machine, not the planner's), and write the greedy loop first,
since beams cost ×3. Time the encoder plus one grounding generation on the
Mac and the Surface, then check boxes on 20 frames of named products.

- **Bar: ≤ 4 s per frame on the Surface**, and the helper's peak RSS with
  Florence loaded within §12.1's budget. A 4-minute clip with 30 no-face
  shots would then take 2 minutes.
- Over the bar: Florence runs only for a phrase the user typed, and the
  salient box covers every other shot.
- **Typing never downloads.** The **Follow:** phrase field is live only when
  the model is on disk; otherwise a **Get the subject model · 275 MB** button
  sits beside it, and the phrase waits for that press (§0).
- If the hand-written loop fails: the Transformers.js route in main is
  decision §16.4.

```ts
// SIDECAR_METHODS.ground = 'vision.ground'
interface GroundParams {
  items: { path: string; ms: number }[]; ffmpeg: string; ffprobe: string; width: number; height: number
  task: 'ground' | 'detect' | 'ocr'           // ocr = <OCR_WITH_REGION>, for §5.3
  phrase?: string                             // required for 'ground'
  variant?: 'int8' | 'q4f16'
}
interface GroundResult {
  model: string                               // 'florence-2-base-ft/int8@<revision>'
  results: ({ ms: number; boxes: (UnitRect & { label: string })[] } | { ms: number; error: string })[]
}
```

Sessions are made under the session lock (`depth.py:97-98`) but **not kept
for the helper's life**, as depth's are today (`:129-151`): the four graphs
are released when the analysis job that used them ends (§12.1). All four
graphs and `tokenizer.json` are pinned by `revision`. `tokenizers` goes into
`requirements.txt` explicitly; it is only transitive today. The download,
started only by the Get press above, shows byte progress through
`media.download`. Peak memory with the four graphs loaded is
**unmeasured** (int8 weights are 275 MB; activations unknown) and is 1g's
gate's second number.

### 4.6 1e — The crop path — `src/shared/reframe/path.ts` · 2 days

Pure. The rules, with constants named so tests and the eval can hold them:

```ts
// src/shared/reframe/types.ts
/** Normalised 0..1 against the UPRIGHT frame (R5), 4 dp — depth.py's subjectBox convention. */
export interface UnitRect { x: number; y: number; width: number; height: number }
export interface FaceBox extends UnitRect { score: number }
export interface Shot { startMs: number; endMs: number; score: number }          // [start, end) in SOURCE ms
export interface SubjectSample { ms: number; faces: FaceBox[] }                  // the two largest, largest first

/** Project.subjects[assetId] — a fact about the file, like Project.looks: Clear leaves it alone. */
export interface SubjectTrack {
  key: string                       // `${size}:${mtimeMs}`
  version: number                   // SUBJECT_TRACK_VERSION
  width: number; height: number     // must equal asset.width/height, or the track is refused
  durationMs: number
  shots: Shot[]
  samples: SubjectSample[]          // 2 a second (§4.3)
  perShot: { salient?: { box: UnitRect; ms: number }; ground?: { box: UnitRect; ms: number; phrase: string } }[]  // parallel to shots
  detector: string
  scene: { threshold: number; minShotMs: number; backend: 'ffmpeg-select-rgb24' }
  at: string                        // ISO
}

// src/shared/reframe/path.ts
export const PATH_RULES = {
  smoothMs: 600,        // a running median of the subject's centre
  marginShare: 0.06,    // of the crop's free-axis length, each side
  deadZone: 0.5,        // the centre may wander inside the middle half of the crop without a move
  triggerMs: 500,       // ... and must stay outside it this long before the crop moves
  panMs: 600,           // a move, eased in-out
  maxSpeed: 1.0,        // crop lengths per second — a longer move takes longer
  minHoldMs: 1000,      // between two moves
  bothShare: 0.6,       // two faces together on ≥ 60 % of a shot's samples = a two-shot
  staticShare: 0.9      // the subject inside the held crop on ≥ 90 % of samples = no pan at all
} as const
export interface ShotCrop {
  startMs: number; endMs: number
  at: number                                       // the held position on the free axis, source px
  pans: { fromMs: number; toMs: number; to: number }[]
  why: 'face' | 'both' | 'larger' | 'ground' | 'salient' | 'centre'
}
export interface CropPath {
  axis: 'x' | 'y'                                  // x for landscape → portrait/square; y for portrait → landscape
  size: { width: number; height: number }          // ONE size for the clip: full height (or width) at the target aspect, even, safeCrop'd
  shots: ShotCrop[]
  notes: string[]
}
export function cropPath(track: SubjectTrack, target: Size, offsets?: Record<number, number>): CropPath
```

**The rules, in order, per shot:**

1. **The size is fixed for the clip.** `w`/`h` cannot animate in the export.
   Measured: `w='608+100*t'` fails with "Error when evaluating the
   expression". So every shot shares one size, `fitRect`'s full height at the
   target aspect through `safeCrop`, and only the free axis moves. A per-shot
   zoom is out (§17).
2. **Which subject.** The faces in the shot's samples, if ≥ 20 % of samples
   hold one. Otherwise `ground` (a phrase was given and Florence answered),
   then `salient`, then the centre (`solveCrop`'s position), with `why` saying
   which.
3. **Two people.** If the two largest faces are together on ≥ `bothShare` of
   the samples and their union, plus the margin, fits inside the crop's
   width, the crop centres on the union (`both`). Otherwise it frames the
   face with the larger median area (`larger`), with a note naming the shot.
   **Cutting to whoever is speaking needs to know who is speaking, and
   nothing here measures that**: no diarization, and face landmarks do not
   show a moving mouth. A stacked two-up (both faces, one above the other, on
   the grid's rails) is decision §16.3.
4. **Static first.** The held position centres the smoothed subject over the
   shot's first second. If the subject's box, widened by the margin, stays
   inside that crop on ≥ `staticShare` of the samples, the shot has no pan.
5. **A pan only when the subject leaves.** When the smoothed centre has been
   outside the dead zone for `triggerMs`, the crop re-centres over
   `max(panMs, distance / maxSpeed)`, eased. There are never two moves within
   `minHoldMs`, and nothing triggers in a shot's first three frames (the
   recording-start spikes measured in §4.2).
6. **A lost face holds.** No detection holds the last position. A face lost
   for the first second of a shot falls to rule 2's ladder for that shot.
7. **Clamped.** Every position is clamped inside the frame. Positions are
   kept as integers because the export's crop `x` is integer and **snaps to
   even on 4:2:0**: measured, `x=333` starts at column 332 without `exact=1`.
   The preview rounds to even as well, so the two never disagree by the one
   pixel that would otherwise show on a slow pan.
8. **A hand correction survives.** `offsets[shotStartMs]` is a share of the
   free axis that the user dragged (§4.7). It is added after the solve, so
   switching aspect keeps the correction's intent rather than its pixels.

For a portrait source going to 16:9 the same rules run on y, with the face
placed at the upper third rather than centred.

### 4.7 1f — Applying it: the followed crop, `setAspect`, the action · 3.5 days

**Expressed as a crop that follows on one clip, not as splits** (decision
§16.2, with the alternative). Both were measured:

- **Split at each cut, one static crop per piece, works in the export
  today.** The real `splitClip` at frame 47 into 608×1080, with the right
  piece cropped at x=1000, changes on exactly frame 47. But it costs:
  - a timeline of 40 pieces for a 4-minute podcast;
  - a cold `<video>` seek per cut in the preview, since elements are pooled
    per clip id with no preroll (`Preview.tsx:569`, `:856-859`);
  - another full-length decoder and padded `amix` input per piece. Measured
    +21 % export time at 30 shots (4.6 s against 3.8 s for 30 s of 1080p);
    120 shots unmeasured;
  - the audio click (§3.3, fixed in step 0, but the decoders remain).
- **One clip with a keyed crop `x`: one decoder.** Measured: a piecewise crop
  `x` steps exactly (frame 29 at x=0, frame 30 at x=1000) and a linear pan is
  exact (0/306/634/962/1290 at frames 0/14/29/44/59), **on a 30 fps source**.
  - Time at the crop is **clip-relative seconds**, measured after the `-ss`
    input seek and after a speed's `setpts`, so the keys compile with
    `startSeconds 0`, as rotation and opacity do.
  - **At speed 1 the crop sees the source's own frames**, because no `fps=`
    runs before it (`speed.ts:248`; the chain's `fps=` is `plan.ts:1192`).
    With §3.2's half-frame boundaries, the source frames that `fps=` later
    turns into timeline frame f should be exactly the ones at or after
    (f − 0.5)/fps, but that holds only if `fps=`'s rounding agrees, and it
    was measured on 30 fps alone. §4.9's render check repeats on 29.97 fps,
    60 fps and VFR sources. **If a row fails, the fix is §3.4's**: a followed
    clip at speed 1 gets `fps=${fps}` ahead of its crop.
  - **Never key on `n`**: at speed 1 it counts SOURCE frames.
  - The held keys at cuts depend on §3.2's fix, and a long expression on
    §3.7's.

**The followed crop is compiled, never stored.** The review found that
stored crop keys go stale under ordinary edits: `withClipSpeed`
(`render/speed.ts:290-330`) never touches keyframes, ramp edits likewise, and
`convertFrameRate` rounds every stored key with `at()`
(`project/frameRate.ts:77-83`). Speeding up a followed clip after the
reframe would leave every held key at its speed-1 frame while the cuts move,
so crops would be held across cuts, which is this step's hardest bar broken
by an ordinary edit. So `cropX`/`cropY` are **derived every time they are
read**, from facts that do not go stale: `Project.subjects[assetId]` (source
ms), `clip.follow`, and the clip's current in-point, duration, speed and
ramp. Speed changes, ramps, frame-rate conversion, head trims and splits
(both halves keep `follow`) are then right by construction. The alternative,
stored keys re-derived inside each of those updates, is a list the next edit
forgets (decision §16.2).

**The pieces:**

- `src/shared/reframe/keys.ts`:
  `followKeys(project, clip, fps): { crop: CropRect; cropX?: Keyframe[]; cropY?: Keyframe[]; notes: string[] } | null`,
  pure and memoised on (track key and version, `follow`, in-point, duration,
  speed, ramp, fps, canvas aspect). It runs `cropPath` (§4.6), then at each
  shot boundary inside the clip's window writes a **held** key on the cut's
  timeline frame; each pan becomes two eased keys. Source ms go to a
  clip-relative frame through `timelineFrameAt(clip, sourceMs)`, a new
  inverse in `timeline.ts` by binary search over the monotone
  `sourceFrameFor`, so constant speed and ramps both work. Holds have no
  mapping and are refused with a note. `null` when the clip has no `follow`
  or its track is refused (§3.1's size check).
- `render/keyframes.ts:35-49`: `KeyedProperty` gains `'cropX' | 'cropY'` (in
  SOURCE pixels) **for the compiler's type only**. They stay out of
  `KEYED_PROPERTIES` (`:64`), so neither `Keyframes.tsx:59` nor
  `CurvePanel.tsx:53` offers them, and nothing ever writes them to
  `clip.keyframes`.
- `render/plan.ts:637-666` `cropFilter(clip, source, fps, follow?)`, with
  `buildRenderPlan` passing `followKeys(project, clip, fps)`:
  `x='max(0,min(${keyframeExpression(follow.cropX, {durationFrames, fps, startSeconds: 0, fallback: crop.x, precision: 0})},in_w-out_w))'`.
  `w`/`h` stay literal, so `streamSize` (`:1030-1034`) is unaffected. The
  parallax call site (`:1064`) takes no keys: reframe is footage only.
- `render/crop.ts`: `cropAt(project, clip, source, frame): CropRect`, the one
  reader every consumer of a crop calls:
  - the preview's output and its Source outline (`Preview.tsx:1102-1106`,
    `:1374`, `:1435`);
  - the moments' `shotPicture` (`moment.ts:400`);
  - the strips effect (`automation/strips.ts:207`);
  - the Inspector line (`Inspector.tsx:147-148`), which says "Follows the
    subject · N shots" instead of a rectangle.
- **The footage pre-pass does NOT follow by itself** (the first draft said
  it did). `momentFrameArgs` applies `cropFilter` after
  `trim=start_frame=${req.first}…,setpts=PTS-STARTPTS`
  (`render/momentFrames.ts:62`, `:89`), so `t` restarts at 0 at the
  moment's window, and keys compiled from the clip's start would put the
  clip's opening crop on a window near its end. And `FootageRequest`
  carries only `crop`, while `momentFramesKey` (`:101-106`) leaves keys out,
  so a re-solve would reuse stale pulls. The fix:
  - the crop moves **ahead of** the `tpad…,trim…,setpts` in the pull's
    `-vf`, right after the retime, which is the render's own order (crop
    after retime);
  - `FootageRequest` gains `cropX`/`cropY` (the compiled keys) and
    `momentFramesKey` includes them; `PULL_VERSION` 5 → 6 (`:98`);
  - **`reframeClip`'s update calls `rebakeGenerated`**, so moments already
    baked over the clip re-pull with the followed crop rather than keeping
    the centred one.
- **The preview reads a followed crop at the `<video>`'s `currentTime`**,
  not the playhead, while playing. The element may drift up to 0.18 s,
  about 5 frames (`Preview.tsx:116`), from the playhead before it is
  re-seeked, and a cut must change on the frame the element shows.
  Unmeasured in the harness until §4.9's check runs.
- `Clip.follow?: { phrase?: string; offsets?: Record<number, number>; version: number }`
  (`timeline.ts`, beside `crop`). It marks a clip whose crop follows
  `Project.subjects[assetId]`.
- **`setAspect`** (`store.ts:1387`): a clip with `follow` and a valid track
  keeps `follow`, and its stored `crop` becomes `followKeys`' size at the new
  aspect with the first shot's position, so a consumer that does not know
  about following still gets the right size. Otherwise `solveCrop`, as
  today. This is the line that would otherwise wipe every reframe on a
  9:16 → 16:9 → 9:16 round trip.
- **CropOverlay** (`CropOverlay.tsx:62-67`, `:107`): on a followed clip a
  drag moves the shot under the playhead. It records
  `follow.offsets[shotStartMs]` as a share of the free axis; the next read
  re-solves. That is one undo entry (begin/commit), as today. **Unfollow**
  (in the dock) removes `follow` and leaves the crop at the playhead static.

**The action, the job, the IPC:**

```ts
// src/main/reframe/analyse.ts — a JobQueue executor, on a new `analysis` queue (concurrency 1: it competes with an export for CPU), in the same jobs:changed list
//   shots (main, 0–15 %) → vision.faces (15–85 %) → vision.salient for no-face shots (85–95 %) → vision.ground when a phrase is set (95–100 %)
//   reduces the track (§4.3), writes $userData/subjects/<key>-v<version>.json, presetId 'reframe'
//   ends with sidecar `release` for the sessions it opened (§12.1), success or not
ipcMain.handle('reframe:analyse', ({ assetId, path, width, height, phrase }) => jobId)
ipcMain.handle('reframe:collect', ({ jobId }) => SubjectTrack)      // PULLED, so it survives Cmd+R, like ingest:collect (ipc.ts:1101-1130)
// preload: analyseSubjects, collectSubjects; harness/bridge.ts: a deterministic stub (§4.9) — the bridge is cast `as unknown as Window['forge']` (:659), so typecheck will not catch a missing one
```

- **Store.** `reframeClip(clipId, {phrase?})` starts the job, or skips it when
  `project.subjects[assetId]` matches the file's key and version. When the
  job reaches `done`, `setJobs` collects `presetId === 'reframe'` the way it
  collects `'ingest'` (`store.ts:4640`). Then **one `update()`** (one undo)
  writes `project.subjects[assetId]`, the clip's `follow` and its stored
  crop, and then `rebakeGenerated` runs (above).
- `reframeAll()` does that for every unfollowed landscape video clip.
- With the Python helper missing, **Follow the subject is greyed** with
  "needs the AI helper", rather than offered as a control that would only
  find shots and centre every crop, which is what the clip already has.
- **The Director.** At `apply2.ts:179-181`, a footage slot with a subject
  track uses the followed crop instead of `BACKDROP_KEEP`'s blurred copy.

### 4.8 The UI · inside the 3.5 days of 1f

Where it goes, per `WHERE-THINGS-ARE.md`:

- **The canvas bar.** `orientationMismatch` (`edit/orientation.ts:33-44`)
  counts images only, so a landscape VIDEO on a 9:16 canvas raises no chip
  today. **The new rule does not join it**: today's chip means "the canvas is
  the wrong way round for your media, switch the canvas" (`Switch to
  {mismatch}`, `CanvasBar.tsx:121-135`), and its landscape-majority branch
  on a portrait canvas returns `'16:9'`. A video rule folded in would say
  "Switch to 16:9" for exactly the case of a landscape talk on a 9:16 canvas,
  and with landscape photos and talks together the two rules would give
  opposite advice in one chip slot. Instead:
  - a separate pure rule, `reframeOffer(project)` in
    `src/shared/edit/reframeOffer.ts`: a portrait canvas, and at least one
    **unfollowed landscape video clip on the timeline**, returns the clip
    count, else null;
  - its own chip, "Landscape video on a 9:16 canvas", with the button
    **Reframe to 9:16** (the canvas's own aspect), which calls `reframeAll()`
    only. It **never calls `setAspect`**: the canvas already has the shape;
  - precedence, spelled out: when the timeline holds video and
    `reframeOffer` fires, its chip shows and the photo chip does not;
  - the photo rule stays photos-only and unchanged, still pinned by
    `tests/orientation.test.ts`;
  - with the AI helper missing, the button is greyed with "needs the AI
    helper", like Follow the subject.
  The aspect buttons' tooltip ("re-solves every clip's reframe") gains
  "followed clips keep following".
- **The dock.** A new `src/renderer/src/components/tools/ReframePanel.tsx`,
  mounted for a selected video clip (`Inspector.tsx:218-221`, home `dock`):
  **Follow the subject** (or **Unfollow**), which reads **"Follow the
  subject · gets the face finder, 0.2 MB, first time"** while the model is
  not on disk, and is greyed with "needs the AI helper" without Python;
  **Follow:** with a phrase field ("a face" by default, or "the cake";
  Florence only, so greyed with its reason until 1g); the shot count; the notes ("shot 4: two people too far
  apart, framing the nearer").
- **The job row** in the EXPORT strip's list: "Finding the subject · <name>",
  with its bar and its cancel.
- **Census rows** in `tests/fixtures/ui-census.json`, each label counted on
  screen by a `needs` recipe in `harness/census.ts` (a landscape video on a
  9:16 canvas; a followed clip selected; a missing model): "Landscape video
  on a 9:16 canvas", "Reframe to 9:16", "Follow the subject", "Unfollow",
  "Follow:", "Finding the subject", "needs the AI helper", "Get the subject
  model", "Find subjects without faces".
- `tests/reframeOffer.test.ts`: a landscape video on 9:16 fires; a followed
  one does not; a landscape video in the pool but not on the timeline does
  not; with landscape photos AND a landscape talk on 9:16, the chip shown is
  the reframe offer (membership of the shown chip, not a snapshot of both).
  Mutation: fold the video rule into `orientationMismatch`, and the
  photo-and-talk case shows "Switch to 16:9".

### 4.9 Tests, harness check, render check, mutations

- `tests/reframeShots.test.ts`:
  - `parseSceneLog` over committed stderr excerpts in
    `tests/fixtures/reframe/` (ffmpeg's own output on synthetic media,
    rights-clean);
  - `shotsFrom`'s merge and head-skip;
  - `sceneArgs` contains `format=rgb24` **before** `select`, asserted as an
    ordered shape, not loose substrings (`CLAUDE.md`'s anchor rule).
- `tests/integration/shots.int.test.ts` (into `tests/output/shots/`) runs
  **through `src/main/ffmpeg/shots.ts`**, the runner a user's analysis takes,
  never `sceneArgs` plus its own `execFile` (which would pass with
  `runFfmpeg`'s `-loglevel error` in place). The media: a 10 s 640×360
  lossless clip of five lavfi sources with cuts at 2/4/6/8 s, a red→blue
  pair, and two **non-saturating** grey cuts (100 → 140 and 140 → 120,
  measured at 0.400 and 0.200 on the Mac's rgb24 path). It asserts:
  - at the default T, every cut scoring above it is found on its exact
    frame, the 0.200 grey cut is not, and nothing else is;
  - the red→blue cut is found at **T = 0.5**;
  - **every cut's score equals a committed table within 0.01, on both
    builds** (`tests/fixtures/reframe/scene-scores.json`), from a second run
    at T = 0.1 so that the 0.200 cut prints too. The saturating cuts
    (1.0 / 0.93 / 0.99) cannot tell the Y-only formula from the RGB one; the
    grey cuts can, so a formula difference fails CI rather than landing in a
    README nobody asserts on.

  Mutations: **drop `format=rgb24`** (on the Mac the red→blue cut scores
  0.40 and is missed, and the grey cuts' scores no longer match the table); **restore
  `-loglevel error`** (the five-cut clip yields zero cuts); scores parsed
  from the wrong line (the table fails).
- `tests/reframePath.test.ts`: every rule in §4.6 over synthetic tracks:
  - a static subject gives no pans;
  - a 0.3 s excursion gives no pan; a 0.8 s one gives one;
  - the speed cap and the minimum hold;
  - both faces fitting give `both`; too far apart gives `larger` with a note;
  - no faces gives `salient`, then `centre`; `ground` beats `salient`;
  - one size, even, inside the frame;
  - an offset survives an aspect change;
  - the same input gives the same output.

  Mutations, each killed by a named case: dead zone 0 (static); trigger
  ignored (excursion); the union not checked against the width (too far
  apart); a size per shot (one size).
- `tests/reframeKeys.test.ts`:
  - `followKeys` puts a held key ON each cut's frame;
  - `timelineFrameAt` inverts `sourceFrameFor` at speed 1, 2 and 0.5 and
    through a ramp, landing on the frame whose source frame is the cut;
  - **after each ordinary edit, a held key is still on each cut's frame**:
    `withClipSpeed` to 2 and 0.5, a ramp edit, `convertFrameRate` 30 → 25 →
    30, a head trim, and a split (each half checked);
  - a hold is refused.

  Mutations: the key at cut − 1; the memo key without `speed` (the speed-2
  case reads the speed-1 keys and fails).
- `tests/integration/reframe.int.test.ts`, **the render check**, into
  `tests/output/reframe/`:
  - **The media**, made in the test: a 1920×1080 clip whose top strip
    **encodes each source column as a barcode**: 16 px bands, each band's
    index in a 7-bit Gray code, one bit per row of blocks, read at block
    centres. A luma ramp cannot carry this: across 1920 px it is about
    7.5 px per 8-bit code, and the export is lossy H.264 (±2–3 codes, so
    roughly ±20 px). Below the strip, each shot fills with its own
    **identity colour**; hard cuts at 1/2/3 s; a 440 Hz tone throughout, as
    **AAC in MP4** so the audio assertion meets the codec users export.
  - **Four sources: 30 fps, 29.97 fps, 60 fps, and VFR** (a phone-style
    variable rate, made by `setpts` jitter and stored with `-vsync vfr`
    (`-fps_mode` is too new for the floor)). At speed 1 the crop sees each
    one's own timestamps (§4.7), so each exercises a different boundary.
  - A hand-built `SubjectTrack` (no detector) whose subject jumps between
    shots and drifts inside shot 3 → `followKeys` → `buildRenderPlan` at
    1080×1920 → `withGraphFile` (§3.7) → bundled ffmpeg.
  - Sampled at `(f − 0.25)/fps` (the `-ss` lesson from
    `moment.int.test.ts`). The crop's x is the barcode's band at the
    output's left edge, **within ±8 px**, at frames cut − 1, cut and cut + 1
    for every cut, and non-decreasing band by band through the pan.
    **Frame-exactness is read from the identity colour**: frame cut − 1
    shows the old shot's colour with the old crop, frame cut the new one's
    with the new.
  - The same at 16:9 → 1:1, and with the clip at speed 2.
  - The audio's second difference stays under 0.01 throughout, and the A/V
    start offset is within one audio frame of the unreframed export's.
  - **A moment over the followed clip, whose window spans a cut**, is
    baked through the footage pre-pass; its frames match the render's frame
    beneath (mean difference ≤ 2/255).

  Mutations: §3.2 reverted (the 30 fps cut at frame ≡ 2 mod 3 shows the old
  identity colour); keys compiled with `startSeconds` = the clip's start;
  keyed on `n`; the pre-pass's crop left after its `trim` (the moment
  spanning the cut shows the clip's opening crop).
- `tests/integration/faces.int.test.ts` (and `salient`, `ground`):
  - Each skips without a venv. The gate becomes one helper,
    `tests/integration/venv.ts`, which also knows `.venv/Scripts/python.exe`,
    so these run on Windows where a venv exists. Today every capability test
    gates on the POSIX path only (`vision.int.test.ts:22-24`).
  - The fixture is the user's own 10-second clip (decision §16.5; none is
    committed).
  - The rotated case: remux with `-c copy -metadata:s:v:0 rotate=90` (it
    probes 640×360 coded and decodes 360×640) and assert the boxes are in
    the upright frame. Mutation: decode at the probed sides.
  - Cancellation mid-pass leaves no ffmpeg child.
- `tests/integration/sidecar.int.test.ts`: on CI's bare 3.12, each of
  `vision.faces`, `vision.salient` and `vision.ground` appears in
  `capabilities` or `degraded`. Membership, not the list.
- **Harness check** `src/renderer/src/harness/reframeCheck.ts`
  (`window.__forgeReframeCheck`):
  - The bridge stub `analyseSubjects` returns, for the harness's
    640×360 webm, shots at 0–2 / 2–4 / 4–6 s: a box at x 0.25, then 0.75,
    then two faces at 0.35 and 0.65 (too far apart for a 202 px crop).
  - The check reframes the clip, plays it, and at frames inside each shot
    compares the Output canvas against the source frame drawn through the
    expected crop. Mean difference ≤ 2/255. The check also compares the
    frame on each side of every cut.
  - Then it toggles 9:16 → 16:9 → 9:16 and expects the crops back, drags
    one shot and expects the offset kept, and undoes.

  It shows what the harness can (the timeline result, the Output view, the
  Source outline, drags, round trips). It cannot show detection or the
  export; those are the integration tests.

### 4.10 Exit

- The ten user clips through the action, with frames sampled into
  `tests/output/reframe-real/` (not committed):
  - face-inside-crop ≥ 95 % where a face was found;
  - zero crops held across a cut;
  - the user's rating ≥ 4/5 on ≥ 8 of 10.
- The render check frame-exact on both builds, on all four sources (30,
  29.97, 60 fps and VFR).
- Analysis time recorded: **≤ 90 s for a 10-minute 1080p clip on the Mac,
  ≤ 3 min on the Surface**. Over that, drop to 3 fps first, then 480 px.
- The helper's peak RSS during the analysis recorded on the Surface, and its
  sessions released when the job ends (§12.1).
- 1g's gate measured and its decision written.

---

## 5. Step 2 — Caption free space · 2.5 days

**What is wrong.** Captions sit at the style's top, middle or bottom
(`captions/line.ts:22-39`) whatever is in the frame. In a 9:16 reframe of a
talking head, the default lower third often covers the mouth and chin. Sheet
13 asks for **Smart placement**, the "dead space" toggle.

### 5.1 Where the subject is on the OUTPUT frame — `src/shared/reframe/frameMap.ts`

`sourceToFrame(clip, asset, canvas, frame, box): UnitRect`. A source box
goes through `cropAt` (§4.7) and the clip's fit (`fitFor`, as `shotPicture`
does) to output-frame coordinates. For any clip with a `SubjectTrack`, the
face boxes at the caption line's time become frame boxes.

A face box is **extended downward by half its height** before it counts, so
the chin and mouth are covered too: the worst place for a caption is over
the mouth.

### 5.2 Choosing the third — `src/shared/reframe/freeSpace.ts`

```ts
export type Third = 'top' | 'middle' | 'bottom'
export function overlapByThird(frameBoxes: UnitRect[]): Record<Third, number>   // the share of each third the boxes cover
export function captionThirds(project: Project, style: CaptionStyle): { startFrame: number; endFrame: number; third: Third }[]
```

**One choice per shot**: stable within it, as agreed. It is computed over
the shot's samples at the 90th percentile of overlap, so a gesture does not
move the caption. The rules:

1. The style's own position stands unless its third's overlap exceeds 0.05.
2. If it does, the third with the least overlap is taken, provided it is at
   least 50 % better. That margin is the hysteresis.
3. A shot with no track keeps the style's position.
4. A line that spans a cut takes the shot where it starts.

Sheet 13's "set 3 / set 5 / set 10" grids are thirds only in v1 (decision
§16.6).

### 5.3 Burned-in text to avoid (after 1g)

Florence-2's `ocr` task (`<OCR_WITH_REGION>`) on each shot's middle frame
adds existing on-screen text (a lower third, a logo, a slide) as boxes, so a
caption does not land on a title already in the footage. This is half a day,
counted in this step's 2.5, and built only once 1g passed its gate. **The
toggle never downloads Florence**: the OCR half runs only when the model is
already on disk, and otherwise the toggle's row shows **Get the subject
model · 275 MB** with "also keeps captions off text in the picture" (§0).

### 5.4 Both caption routes

`captionSpec(style, words, active, placement?)` (`line.ts:48`) takes a
`Third` override, which sets `position` and `offsetY`. The callers are:

- the canvas bake, via `fromTimeline.ts:131`;
- the preview, `captionPreview.ts:76`;
- libass, via `buildAss`: each `Dialogue` gets an alignment override,
  `{\an8}` for top, `{\an5}` for middle, and the style's own for bottom,
  plus its `MarginV` field (`ass.ts:180` writes `0,0,0` today).

**Measured for this plan** on the Mac's libass (640×360, PlayResY 360):

| event | text rows |
|---|---|
| default (bottom, MarginV 20) | 306–332 |
| `{\an8}` | 26–52 |
| `{\an5}` | 167–191 |
| per-event MarginV 90 | 236–262 |

Per-event `\an` and MarginV are core ASS and long predate the floor
(**dated**); the render check below runs them on the Windows build in CI.

`Project.captions.placement?: 'style' | 'smart'`. The OUTPUT strip's
caption block gains a **Smart placement** toggle with its tooltip ("keeps
captions off faces, one position per shot"). **With no subject track and no
AI helper the toggle is greyed** with "needs the AI helper", rather than a
switch that changes nothing; with the helper but no track yet, its tooltip
says "reframe a clip first". Census rows: "Smart placement", "needs the AI
helper".

### 5.5 Tests, render check, mutations

- `tests/freeSpace.test.ts`:
  - overlap per third;
  - the 0.05 rule and the hysteresis;
  - one choice per shot;
  - a line spanning a cut;
  - a shot with no track;
  - the downward extension.

  Mutations: no hysteresis (a jittering box flips the third, which the
  stability case catches); no downward extension (a face sitting just above
  the lower third "fits", which the mouth case catches).
- `tests/integration/captionsFree.int.test.ts`, the render check, into
  `tests/output/captions-free/`:
  - The media: a reframed synthetic clip whose track places a "face" in the
    lower third for shot 1 and the upper third for shot 2. A white box is
    drawn into the source where the track says it is, so a caption over it
    would be visible.
  - The caption's text rows are read from the output by luma, on **both
    routes**: a plain style (libass) and a gradient style (the canvas bake).
  - Shot 1's lines sit in another third, shot 2's likewise, and no caption
    row intersects the box. The same at 16:9.

  Mutation: `placement` ignored by `buildAss`. The libass rows land back on
  the box while the canvas route still passes, which proves that both routes
  are tested.

**Exit.** The ten clips show zero sampled caption lines on a face; both
routes pass the render check in CI.

---

## 6. Step 3 — The graphics engine and the Director's third pass · 14.5 days

**What it is.** A library of **typed parametric templates** (counter,
comparison bars, step list, quote card, callout, percentage ring) drawn by
**pure frame functions**: live in the preview, baked to PNG frames at export
exactly as the moments engine is. A creator-level **graphic style**. The
Director's **third pass** over a transcript:

1. spot the moment;
2. pick a template and copy its data;
3. a **validator** drops any graphic whose numbers or names were not said in
   that stretch;
4. word timings land the animation's beats on the spoken words;
5. free-space placement.

**The LLM never writes code**: it fills fields of a type the app defined.

### 6.1 The spec — `Clip.graphic?: GraphicSpec`

`src/shared/graphics/` already holds `spec.ts`'s `GraphicsSpec` (36 uses: the
caption-layer scene for the canvas bake and the dormant frame server).
`GraphicSpec` would differ from it by one letter, which is exactly the trap
`CLAUDE.md`'s anchor table records. So 3a's first commit renames the old
type `CaptionLayersSpec` (and `buildGraphicsSpec` → `buildCaptionLayers`),
mechanically, with typecheck as the guard (decision §16.8).

```ts
// src/shared/graphics/template.ts
export type GraphicTemplateId =
  | 'counter' | 'bars' | 'steps' | 'quote' | 'callout' | 'ring'   // step 3
  | 'timeline' | 'before-after' | 'versus'                         // step 6 (2D and 3D)
  | 'source'                                                       // step 5/6: a retrieved fact with its sources

export type GraphicData =
  | { template: 'counter'; value: string /* as said: "40%", "1.2 million", "₹500" — drawn verbatim */; label: string }
  | { template: 'bars'; title: string /* grounded, or one of the template's fixed titles */; items: { label: string; value: string }[] /* 2–5; every MATCHED stretch number shares one unit */ }
  | { template: 'steps'; title: string /* grounded, or a fixed title */; items: { label: string }[] /* 2–6 */ }
  | { template: 'quote'; text: string /* a contiguous run of the said words, clause to clause */; speaker: string /* '' | the asset's speaker as the user set it | a name the stretch says said it (§6.7) */ }
  | { template: 'callout'; label: string; shape: 'arrow' | 'circle' }
  | { template: 'ring'; value: string /* the matched stretch number must carry '%' and be ≤ 100 */; label: string }
  | { template: 'timeline'; items: { when: string; label: string }[] }
  | { template: 'before-after'; before: { label: string; value: string }; after: { label: string; value: string } }
  | { template: 'versus'; left: { label: string; value: string }; right: { label: string; value: string } }
  | { template: 'source'; kind: 'wiki' | 'page' | 'headline' | 'answer'; title: string; excerpt: string; outlet: string; date: string }

export interface GraphicSpec {
  data: GraphicData                        // every string the painter draws comes from here, or from the style's fixed glyphs
  seconds: number                          // on screen; GRAPHIC_TEMPLATES[t].seconds bounds it
  /** when each element ARRIVES, in seconds from the clip's start — computed from word timings by the app, never by the model */
  beats: number[]
  /** what grounds it: the transcript's asset, the cited sentence, and the word index each beat landed on (stable under hand corrections — transcript.ts:125-133) */
  grounding?: { assetId: string; sentence: string; words: number[] }
  /** where it sits; `auto` is recomputed from free space on rebake (an aspect change, a reframe) */
  place: { auto: true; third: 'top' | 'middle' | 'bottom' } | { auto: false; box: UnitRect }
  /** a callout's target: a subject box in SOURCE units on the clip beneath, at a source ms; drawn through frameMap.ts */
  subject?: { clipId: string; box: UnitRect; ms: number }
  /** retrieved facts (step 5/6): what was fetched, quoted, credited */
  sources?: { title: string; url: string; outlet: string; date: string; licence: string }[]
  /** a graphic the user must Keep before it is placed: its number came from a YouTube track or an unsure Whisper word (§6.6) */
  proposal?: { reason: 'check-the-number'; wordSource: 'youtube-asr' | 'youtube-lines' | 'whisper-unsure' }
  style?: string                           // a GRAPHIC_STYLES id; absent = the project's
  seed: number                             // stored; never Math.random at draw time
  version: number
}

export interface TemplateDef {
  id: GraphicTemplateId
  seconds: { min: number; default: number; max: number }
  /** how the validator treats each string field (§6.7). No field drawn into a frame is ever 'free' */
  fields: Record<string, 'verbatim' | 'grounded' | 'fixed' | 'speaker'>
  /** the titles a template may draw without grounding: 'By the numbers', 'Step by step', 'Compared' … */
  fixedTitles?: string[]
  /** fields that bind as label–value pairs (§6.7 rule 6) */
  pairs?: [label: string, value: string][]
  maxItems?: number
  needsSubject?: boolean                   // callout
  threeD: boolean
}
export const GRAPHIC_TEMPLATES: Record<GraphicTemplateId, TemplateDef>
```

Timings are in **seconds**, as `MomentSpec.seconds` is, so
`project/frameRate.ts` needs no change. A frame-rate change already calls
`rebakeGenerated` (`store.ts:1355-1357`).

### 6.2 The six templates

| template | draws | beats | seconds (min/default/max) | fields |
|---|---|---|---|---|
| `counter` | a number counting up from 0 and **arriving at the value on the word that says it**, with the label beneath | 1 | 2 / 3 / 4 | value `grounded` (number), label `grounded`; **paired** (value, label) |
| `bars` | 2–5 horizontal bars growing to their values, each on its own word, labels and values beside them | one per item | 3 / 5 / 6 | title `grounded` or fixed ('By the numbers', 'Compared'); each item **paired** (label, value), both `grounded`; every matched stretch number shares one unit, or the graphic is dropped |
| `steps` | a numbered list, one row arriving per item as it is said | one per item | 3 / 6 / 8 | title `grounded` or fixed ('Step by step'); item label `grounded` |
| `quote` | the said line in quotation marks, each word lit as it is spoken (the captions' highlight logic) | one per word | 2 / 4 / 6 | text `verbatim`, clause to clause; speaker `speaker` (§6.7 rule 7) |
| `callout` | an arrow or a ring drawn on, to the subject box, with a label | 1 | 1.5 / 2.5 / 3 | label `grounded`; `needsSubject` (a face track: Python, §12) |
| `ring` | a ring filling to the percentage, arriving on the word | 1 | 2 / 3 / 4 | value `grounded`, and **the matched stretch number carries `%` (or "percent")** and is ≤ 100; label `grounded`; **paired** (value, label) |

**The painter's contract** (the first draft contradicted itself here: it
promised the painter draws nothing outside `data`, then had the counter draw
in-between numbers and a style regroup them):

- **At the settled frame, every `data` string is drawn verbatim**, never
  regrouped, re-cased or re-punctuated.
- **Counter frames before the last** draw only digit strings whose value is
  ≤ the value, **in the value's own format**: its own separators (western,
  Indian or none, read off `data.value`), its decimals as said, its currency
  prefix and unit suffix as said. The style has no number format of its own
  (§6.5).
- **The only glyph the painter adds is a ring's `%`**, and only when the
  matched stretch number's unit is `%`. A counter whose `data.value` is a
  bare "40" draws "40", never "40%", whatever the stretch says.
- The style's fixed glyphs (quotation marks, step numerals, the arrow) are
  listed in the template and are not text claims.

A fake-context test holds each line (§6.11).

### 6.3 Drawing: pure frame functions, preview, bake, export

The files mirror the moments engine's:

- `src/shared/graphics/frame.ts` (pure, node-tested):
  `graphicMovingFrames(spec, fps)` = round((last beat + settle 0.5 s) × fps),
  capped at the clip; `graphicParams(spec, frame, fps)` → per element
  `{t, appear, value}` from the beats, with `seeded()` (`moment.ts:101`)
  drawn in a fixed order; `layout(spec, w, h, style)` → element boxes as
  pure geometry.
- `src/shared/graphics/paint.ts` (`/// <reference lib="dom" />` scoped to the
  file, as `textPaint.ts:1-5`): `drawGraphicOnto(ctx, spec, style, w, h,
  {frame, fps}, measure)`. Every word goes through `drawTextOnto`
  (`textPaint.ts:44`), so the 42 text looks apply. **In-between numbers are
  formatted by `graphics/numbers.ts` in the value's own format (§6.2's
  contract), never `toLocaleString()`, and the settled frame draws
  `data.value` itself.**
- `src/renderer/src/graphicCanvas.ts`:
  - `graphicPreviewCanvas(clipId, spec, style, w, h, clock, onReady)`. A 2D
    template follows `textPreviewCanvas` (`textCanvas.ts:64-123`), keyed on
    size, the spec without its version, the **resolved style**, and the frame
    (or `settled`). It skips the cache while a font is still loading
    (`:113-119`).
  - Every redraw stamps `dataset.forgeRev` (`grade.ts:465-497`).
  - `forgetGraphicPreview` joins Preview's removed-clip sweep
    (`Preview.tsx:665-667`). That sweep never calls `forgetPaperPreview` or
    `forgetCarouselPreview` today; see §17.
  - `bakeGraphicSequence(spec, style, clipId, w, h, frames, fps)` awaits every
    face the style uses, then runs the `bakeGuard` loop (`beginBake`,
    `isSuperseded` before each write, `writeTitleFrame`, `endBake` in a
    `finally`) over the **moving frames only**. `tpad` holds the last
    (`plan.ts:683-686`), so the render needs no new filter: an image asset
    with `frames` is already `-framerate <fps> -i <pattern>` + `holdFilter`
    (`plan.ts:839-851`), and alpha passes (`format=yuva420p`, EFFECTS §34).
- **The exit is opacity keys** on the clip over its last 0.3 s. They already
  render (geq on alpha, covered by an integration test), so held frames are
  never baked just to fade.
- **Size: the export's STILLS size**, the canvas exactly, as text is
  (`exportBake.ts:92`), so lines and type are crisp at 4K.
- **The export.** `Bakers.graphic(spec, style, key, w, h, frames, fps)` with
  a branch beside `exportBake.ts:130-144`. A graphic whose bake returns null
  or throws is **dropped** from the export with `onError`, as a moment is,
  never left on the edit's asset, whose path is `''` until the store's bake
  lands (`-i ''` fails the whole export). `exportBakers.ts:13-26` wires it.
  Every test that builds a `Bakers` literal gains `graphic` (`exportB2`,
  `exportBake`, `moment`, `integration/{exportBake,jcut,moment,spine2Render}`,
  `renderer/stripsRender`).
- **The store.** `addGraphicClip(trackId, startFrame, spec)` mints
  `graphic-<base36>-<rand>`: **app-minted ids only**, because clip ids become
  frame-cache paths unsanitised (`src/main/titles.ts:148`). It adds a drawn
  asset `{path: '', kind: 'image', size: 0, …}` (size 0 is what keeps it out
  of the photo tools, `edit/photos.ts:25`), stacks via `stackOverlay`
  (`store.ts:295`), and calls `revealClip`. `setGraphic` is `update()` then a
  rebake. `rebakeGraphic` writes through the history-less `fillAssetPath`
  (`:1735`), as paper does, **not** through `update()` as the carousel does
  (`:2781`).

**Measure in the step:** the PNG encode cost of a mostly transparent
1080×1920 frame on the Mac and the Surface. `EFFECTS.md` §34 has only opaque
moment frames, at 20–61 ms each, and the encode, not the draw, is the cost.

### 6.4 Every guard a new self-drawn kind joins

`PLAN.md:1172-1180`'s rule, with this kind's list (from the census of the
code, 2026-10-05):

- `drawsItself` (`edit/recipes.ts:46`). This also feeds `setAspect`'s crop
  clear (`store.ts:1386`), `rebakeGenerated`'s targets (`:1409`) and paste's
  own-asset rule (`recipes.ts:277`).
- Preview's local `drawsItself` (`Preview.tsx:1202-1203`) and a `sourceFor`
  branch (`:1233`) that returns `live ?? nothing()`, so a stale file is never
  shown.
- `clipKind` → `'graphic'` (`edit/clipKind.ts:156`).
- `isKeyable` (`render/chromaKey.ts:222`).
- `canSteady` (`render/steady.ts:36`).
- `canMoveCamera` (`edit/camera.ts:34`). A graphic's asset is kind `image`,
  so without this guard the Camera panel would Ken-Burns its baked frames.
- `clearDirector`'s drawn-asset filter (`director/apply.ts:127`). Without it,
  every Clear orphans an asset.
- `rebakeGenerated` (`store.ts:1432-1589`).
- `placeCopies` (`store.ts:4577-4582`).
- `Inspector.tsx:218-221`.

The test is `tests/graphicGuards.test.ts`, modelled on
`tests/moment.test.ts:581-645`. It asserts **membership** (a clip with
`.graphic` is in each set). The wiring in the store, the Preview and
`exportBakers` is anchored on unique text with its arguments, and anchors
are counted with `matchAll` before they are trusted. Each site is
mutation-checked by leaving `graphic` out.

Whether the spelled-out lists become one `SELF_DRAWN_FIELDS` constant is
decision §16.9.

### 6.5 The graphic style — `src/shared/graphics/style.ts`

The twin of the caption styles:

```ts
export interface GraphicStyle {
  id: string; name: string
  textStyleId: string                      // one of the 42 (render/textStyle.ts:164)
  font: string; titleWeight: number; valueWeight: number
  palette: { ink: string; accent: string; muted: string; panel: string; panelOpacity: number }
  radius: number; stroke: number; shadow: number
  motion: { entrance: 'rise' | 'pop' | 'wipe'; ease: 'out-cubic' | 'out-back' | 'linear' }
  // no number format: a style that regrouped "10,00,000" as "1,000,000" would draw a string nobody said (§6.2)
}
export const GRAPHIC_STYLES: GraphicStyle[]               // six: clean, bold, editorial, neon, mono, accent (from the project's accent colour)
export function resolveGraphicStyle(styleId: string, overrides?: Record<string, unknown>): GraphicStyle   // guards every number, as resolveStyle does
// Project.graphics?: { styleId: string; overrides?: Record<string, unknown> }   — timeline.ts, beside CaptionSettings
```

The UI goes in the OUTPUT strip beside the caption presets
(`OutputStrip.tsx:225-268`): six tiles, each a sample drawn by
`drawGraphicOnto` (as `captionSample` is, `:71-85`). Picking a preset keeps
`textStyleId`, as `setCaptionStyle` does (`store.ts:4234-4241`). A change
calls `rebakeGenerated`.

Fonts must cover the transcript's script. The caption fallbacks for Telugu
and Hindi are reused, and a missing script falls back with a note, as
`PLAN.md` §9 records for cards.

Census rows: "Graphics", the six preset names.

### 6.6 The third pass — `graphics@1`: menu, schema, prompt

The pure half goes in `src/shared/director/run.ts`, as `graphicsMenuFor` and
`settleGraphics`, so the app and the eval share one copy. The files beside
it:

- **`promptGraphics.ts`.**
  - **System**: one constant playbook, which a server caches. It says: you
    mark the moments in a talk where a simple graphic would help a viewer,
    meaning a number, a comparison, steps, a line worth quoting, a thing on
    screen worth pointing at, or a share of a whole; you copy words; you
    never invent a number or a name; at most four; an empty list when
    nothing qualifies.
  - **User**: a SENTENCES table of `s07  0:42  "…"` lines, then a TEMPLATES
    table (id, when to use it, its fields), then the language line last.
    That last line is what took Telugu and Hindi copy from 0/24 to 24/24 in
    the target script (`EVAL.md:60-70`).
  - The menu is **≤ 24 sentences** per call (`MAX_CANDIDATES`,
    `menu.ts:40-41`). A clip of 1–4 minutes at the measured ~180 words/min
    is 300–1,300 tokens and fits whole. A longer transcript is cut into
    24-sentence windows, one call each.
- **`schemaGraphics.ts`.** `GRAPHICS_PASS = 'graphics@1'`. The schema is flat
  and fits `conforms.ts`: prototyped and measured with `unsupportedKeywords
  []` and `flatViolations []`, at 1,269 chars. One graphic object carries
  the **union** of the templates' fields, with unused ones left as `''`:

  ```jsonc
  {
    "reasoning": "…",                                   // ≤ 300
    "graphics": [                                       // maxItems 4, minItems 0
      {
        "sentence": "s07",                              // enum: this request's sentence ids
        "template": "counter",                          // enum: the offered templates
        "title": "", "value": "40%", "label": "of new clients",   // decode maxLength looser than kept (title 60 → 40 kept); a title that neither grounds nor equals a fixed title is replaced by the template's first fixed title, with a note
        "items": [ { "label": "", "value": "" } ],      // maxItems 6
        "quote": "",                                    // decode 200
        "why": "…"                                      // decode 100 → 60 kept
      }
    ]
  }
  ```

  `constrained: true` for the decoder (enums, maxLengths) and `false` for
  the validator's shape check, so an out-of-list id is repaired rather than
  failing the pass (`schema2.ts:88-92`). Decode limits are set looser than
  what is kept: a grammar cut-off mid-string made Gemma 4 E2B close a whole
  plan after one segment (`EVAL.md:84-95`). Whether LM Studio's strict
  `json_schema` decodes `minItems: 0` cleanly is **unmeasured**; the eval's
  first run answers it.
- **`maxTokensForGraphics`** starts at `250 + 140 × 4`, recalibrated from the
  eval, as `prompt2.ts:80-88` was.
- **The ask.** Through `askStructured` (`ask.ts:29`), wrapped so a throw
  becomes `{error}` (`store.ts:1910-1912`). **A finding to fix here:** the
  thinking-on retry does nothing on the OpenAI shape, because
  `openaiRequestBody` never sends `think` (`provider.ts:214-237` against
  `:189`). On LM Studio, the configuration every eval used, the "retry" is
  the same request. On that shape the retry instead appends one line to the
  user prompt ("Answer with the JSON object only."), and the eval counts
  whether prose ever came back.

**Where it runs:**

- **in Direct**, over every footage slot with speech, after the spine and
  the look;
- **in Clip it** (§7.5);
- **by hand**, from the Transcript tile's new **Graphics** section: "Find
  graphics in this clip", a list of proposals with Keep / Drop, and its
  notes.

**What is placed without review, and what is not.** The validator proves a
graphic matches the transcript, not what was said. YouTube's ASR sets word
confidence to nothing (`acAsrConf` is 0 on every word, §7.1), so a misheard
"14%" for "40%" would become a confident counter. So:

- Graphics from Clip it and Direct are placed, and **every one is listed** in
  the Transcript tile's Graphics list and in the run's notes, each with
  **Drop**.
- **A graphic whose grounded number came from a `youtube-asr` or
  `youtube-lines` transcript, or from a Whisper word under 0.5 confidence,
  is a proposal only** (`GraphicSpec.proposal`), marked **check the number**
  beside the words it heard, and is not placed until the user presses Keep.
- Census rows: "check the number", "Keep", "Drop", for a stub transcript of
  each source.

Graphics made by Direct carry `GRAPHIC_RULE 'director.graphic'` in
`DIRECTOR_RULES`, so Direct again and Clear take them. Graphics made by Clip
it or the Transcript tile carry `'clips.graphic'`, outside the Director, with
their own **Clear graphics** that also removes the drawn assets
(decision §16.10). The decision record is `pass: GRAPHICS_PASS`, ops
`[{graphics, dropped, model}]`, into `project.decisions`.

### 6.7 The validator — `src/shared/director/validateGraphics.ts` and `claims.ts`

It **rejects** only what `validate2.ts` rejects: a truncated answer and the
wrong shape. Everything else is **one graphic at a time**: repaired, or
dropped with a `Problem {path: '$.graphics[i].items[j].value', message}`
that the panel shows ("graphic dropped: '45%' is not said in s07").

**Why it binds, not just matches** (the first draft's hole, found by the
review). Checking that each token of the spec appears *somewhere* in the
stretch lets real words be given false relations. Each of these grounded on
every token and would have shipped:

- "Last year 30% of our clients came from Instagram and 70% from referrals"
  → bars [Instagram 70%, referrals 30%]: a false chart.
- "We had 3 offices and 40 staff in 2019, now 12 offices" → bars
  [2019: 12, now: 3].
- "It's not true that 90% of startups fail" → ring 90% "of startups fail":
  the check ran only from spec to stretch, so a dropped "not" was never seen.
- "we signed 40 clients" → ring 40: an invented percentage.
- "$40 … 40%" → bars of one chart in two units.

**The stretch** is the cited sentence plus one sentence either side, because
a fact often runs over a boundary. Its words come from
`Segment.wordStart..wordEnd` (`transcript.ts:24-33`), **over capped
segments**: no segment in a menu or a stretch is longer than 30 words or
15 s (§7.2), or an unpunctuated track would make the stretch the whole talk.
**Binding (rule 6) is always within one sentence**: the ±1 says which
sentences a graphic's facts may come from (the model may cite s07 for a fact
said in s08), never that a label in one may pair with a value in another.

**The normaliser** is its own function. The existing ones were measured
unsafe for this:

- `validate.ts`'s `normalise` drops final combining marks: 'పెళ్లి' →
  'పెళ్ల', 'शादी' → 'शाद', and NFD 'Café' → 'cafe' while NFC stays 'café'.
- `keywords.ts`'s `normaliseToken` is ASCII-only and maps '1.2' → '12' and
  Telugu or Hindi → ''.

The rules, in order:

1. `normalize('NFC')`, then `toLowerCase()` (locale-independent).
2. Trim leading and trailing characters outside `[\p{L}\p{M}\p{N}]`.
   **Combining marks are kept.** A leading currency sign and a trailing `%`
   are split off first as unit tokens.
3. Native digits → ASCII by block offset: Devanagari U+0966, Bengali
   U+09E6, Gurmukhi U+0A66, Gujarati U+0AE6, Tamil U+0BE6, Telugu U+0C66,
   Kannada U+0CE6, Malayalam U+0D66, Arabic-Indic U+0660 / U+06F0.
4. **A number is canonical `{n, unit, currency?}`.**
   - Thousands separators go, both western `1,000,000` and Indian
     `10,00,000`. **The decimal point stays**, so 1.2 ≠ 12.
   - Suffix and word multipliers: `k`, `m`/`mn`, `bn`/`b`, `thousand`,
     `million`, `billion`, `lakh`, `crore`.
   - Units: `%` = `percent` = `per cent`. Currency: `$` = `dollar(s)`,
     `₹` = `rupee(s)`/`rs`, `€` = `euro(s)`, `£` = `pound(s)`.
   - English number words: zero–nineteen, the tens, hyphenated or spaced
     (`forty-two`, `forty two`), `hundred`, `thousand`, `a hundred`.
     **Hindi and Telugu number words are not parsed in v1**, so a number
     the model wrote in digits that was said as a word in those languages
     is **dropped**. That is the safe direction, and the eval counts it
     (decision §16.11).
5. **Numbers match on value, and units are judged on the MATCHED stretch
   number**, per template:
   - values equal (relative 1e-9);
   - a `%` or a currency in the spec must be on the matched stretch number
     (the model may not add a unit);
   - a bare spec number may match a stretch number that carries a unit, but
     then **the template decides**: a `ring` needs its matched stretch
     number to carry `%` (or "percent"), else it is dropped; `bars` need
     **every matched stretch number** to share one unit (the stretch's
     units, not the spec strings'), else dropped; a `counter` draws
     `data.value` only and never gains the stretch's unit (§6.2).
6. **Binding: each claim is bound to ONE occurrence, and pairs bind
   together.** For the paired fields (`TemplateDef.pairs`: `counter` and
   `ring` value + label, each `bars` item; later `before-after`, `versus`,
   `timeline`):
   - each value binds to one occurrence of its number in the stretch,
     recorded by word index; no two claims bind to the same occurrence;
   - **the label's content tokens must sit in the same sentence as its
     value's occurrence, within 8 tokens of it** (`BIND_WINDOW`, set by the
     eval);
   - **pairs keep spoken order**: across a template's pairs, if value A is
     said before value B, A's label is said before B's label. This is what
     drops [Instagram 70%, referrals 30%] and [2019: 12, now: 3];
   - unpaired `grounded` fields (a `steps` label, a `callout` label, a
     grounded title) bind as one run: their content tokens within one
     sentence, in spoken order, with gaps of at most 3 tokens between them.
7. **Negation.** If the clause a claim binds in (from the previous clause
   boundary — `, ; : —` or a sentence start — to the next) holds a negator
   the field lacks, the graphic is **dropped**, or for a `quote` **demoted**
   to the verbatim clause with its negator. Negators: `not`, `no`, `never`,
   `n't`, `without`, `nor`, `neither`, `none`, `nobody`, `nothing`; Hindi
   `नहीं`, `न`, `मत`; Telugu `కాదు`, `లేదు`. **Telugu mostly negates with a
   verb ending, not a word**, which no list catches: in v1 a Telugu clause
   whose verb ends in a negative suffix the eval's fixtures collect is
   treated as negated, and the gap is measured on the Telugu fixtures
   before step 3's exit (§15).
8. **Field modes** (`TemplateDef.fields`):
   - `verbatim`: the field's normalised tokens are a contiguous run of one
     sentence, **starting and ending on a sentence or clause boundary**. A
     run directly after a negator is refused ("I'd never tell you to quit
     your job" cannot become "quit your job").
   - `grounded`: every content token binds as in rule 6, after normalising
     and folding English plurals (`s`, `es`) on both sides. The template's
     fixed words and **an explicit English function-word list** are exempt:
     `a an the of to in on at for from by with and or but so as is are was
     were be been it its this that these those our my your their we i you
     they he she have` (40 words). **Never exempt**: negators (rule 7),
     direction words and comparatives (`up down more less fewer than before
     after over under`). No list exists yet for Hindi or Telugu, so every
     token there is checked.
   - `fixed`: one of the template's `fixedTitles`, or the style's own
     glyphs; never checked, never model-written.
   - `speaker` (the `quote`'s): `''`; or the asset's speaker as the user set
     it (`MediaAsset.speaker`, a field in the Transcript tile); or, for a
     linked video, the channel from yt-dlp's metadata (§7.1), never the
     model's; or a name **only when the stretch says "<name> said / says /
     told … " directly governing the quoted run**. A run directly after a
     reporting verb is a reported quote: kept only with that verb's subject
     as the speaker, else refused. So "My mentor told me, and I think Elon
     said something like it: fail fast" cannot ship "fail fast — Elon".
   - **There is no `free` mode for anything drawn into a frame.** The 2B
     model writes no free text that lands in a picture. (Best clips' card
     titles are shown in the UI only; §7.4 holds them to their own rule.)
9. **Template rules after binding:**
   - `ring` ≤ 100 and `%` on the matched number (rule 5);
   - `bars` one matched unit (rule 5);
   - `counter` must contain a number;
   - `callout` needs a subject box from the clip's `SubjectTrack` at the
     sentence's time (otherwise dropped, "no subject found to point at").
10. **Spacing (code, not model):** graphics ≥ 6 s apart and ≤ 1 per 20 s of
    clip; the earlier one wins.

Each bound claim records the **word index** it bound to. Those indices are
the beats (§6.8) and are kept in `grounding.words`.

```ts
// src/shared/director/claims.ts
export interface CanonNumber { n: number; unit: '' | '%' | 'currency'; currency?: '$' | '€' | '£' | '₹' }
export interface Claim { path: string; text: string; kind: 'number' | 'token' | 'run'; value?: CanonNumber; pair?: number /* index into the template's pairs */ }
export const BIND_WINDOW = 8
export const NEGATORS: Record<'en' | 'hi' | 'te', readonly string[]>
export const FUNCTION_WORDS_EN: readonly string[]          // the 40 above; asserted to contain no NEGATOR, direction word or comparative
export function normaliseToken(raw: string): string
export function numbersIn(tokens: string[]): { value: CanonNumber; at: number /* token index */ }[]
export function claimsOf(data: GraphicData, def: TemplateDef): Claim[]
export function bind(claims: Claim[], stretch: { words: Word[]; sentences: Segment[] }, lang: string):
  { ok: true; at: number[] /* one word index per claim */ } | { ok: false; missing: Claim[]; reason: 'absent' | 'unpaired' | 'order' | 'negated' | 'unit' }
```

### 6.8 Beats — the words land the animation

- **Beat times.** Each element's grounded word is the beat:
  `word.startMs` → timeline seconds, through the clip, with the same offset
  the captions use (`captions/timeline.ts:76-86`). The graphic then agrees
  with the captions.
- **Lead and settle.** The clip starts 0.5 s before the first beat (the
  entrance) and lasts to the last beat + 0.8 s, clamped to the template's
  bounds and to the clip beneath. An element **arrives on** its beat: the
  counter reaches its value, a bar its length, a row its place.
- **Spacing.** Two beats closer than 160 ms are spread to 160 ms, the
  minimum gap from `planLyricCuts` (`lyrics.ts:211`).
- **Punch is not used.** `punchOf` is ASCII-only (`lyrics.ts:77`), so every
  Indic word scores 0.2; word starts are script-neutral.
- **Retimed clips are refused** with a note ("graphics on a speed-changed
  clip are not timed yet"), as J-cuts refuse a retimed clip
  (`apply2.ts:225-227`). The captions and props mapping ignores speed today
  (`automation/apply.ts:58-65`), so a speed-aware graphic would drift from
  its own captions. The proper inverse is §4.7's `timelineFrameAt`, applied
  to captions and graphics together later (§17).

### 6.9 Placement — `src/shared/graphics/place.ts`

`placeGraphic(project, clipId, startFrame, frames, template) → place`:

- The thirds' overlap comes from §5's map, **excluding the caption's third**.
  Captions are burned last over the whole picture
  (`captions/timeline.ts:10-12`), so they sit over any graphic.
- The best remaining third is taken. Templates needing height (`steps`,
  `bars`) prefer the middle third when it is free. With no track, the
  style's default is the middle third, or the top when captions use the
  middle.
- `callout` is drawn at the subject box through `frameMap.ts`, so it follows
  a reframe and a Ken Burns (`shotPicture`'s mapping inverted,
  `moment.ts:393-459`).
- `place.auto` is recomputed by `rebakeGenerated` on an aspect change or a
  reframe; a box the user dragged is kept.

**On the timeline**, graphics sit on lanes **above the look and every card**
(`laneFor(start, dur, cardsAbove())`, `apply2.ts:513-520`, `:533-546`), so
type is never graded (decision §16.7).

### 6.10 The baseline and the eval

**The baseline (no model)**, `director/baselineGraphics.ts`, is
deterministic:

- a sentence with a `%` → `ring`;
- a number with a unit or currency → `counter`;
- two or more consecutive sentences opening with ordinals ("first",
  "second", "step one") → `steps`;
- validated the same way.

It is what "preferred to the standard" compares against, and what runs with
no model.

**The eval** (`tests/eval/director.eval.test.ts`) gets a
`FORGE_EVAL_GRAPHICS` block, copied from the look-pass block (`:180-237`).
Its requests use the `EvalRequest` shape, so `evalRelay.ts:57-63` posts them
unchanged. Scoring goes through `settleGraphics`, into
`results-graphics.json`. `eval-report.mjs`'s `summarise()` gains a pass
filter, so a graphics run does not show as a broken spine row (`:30-58`).

**Fixtures**, `tests/fixtures/graphics/*.json`: ten transcripts (six
English, two Telugu, two Hindi), **of the user's own speech or text the user
wrote** (third-party speech cannot be committed), with numbers both in
digits and spoken out ("forty percent"), names, a list of steps, a quotable
line, **and the traps**: two numbers with two labels in one sentence, a
negated claim, a reported quote, and a count that is not a percentage. Each
has the user's truth: the sentence ids where a graphic belongs, and its
template.

**Recorded per run:**

- parsed / truncated / shape;
- graphics proposed;
- **the share dropped by the validator**, the hallucination rate and the key
  number;
- the truth-hit rate (±1 sentence);
- a blind 1–5 template-fit rating through `eval-rate`;
- model against baseline.

### 6.11 Tests, harness check, render checks, mutations

- `tests/claims.test.ts`:
  - every normaliser rule, including Telugu/Hindi marks kept and NFC = NFD;
  - `1.2 ≠ 12`; Indian grouping; 'forty percent' = '40%'; '$1.2M' =
    '1.2 million dollars';
  - a unit added by the model fails, a unit dropped passes **where the
    template allows it**;
  - native digits;
  - **the review's cases, each named**: "we signed 40 clients" + ring 40 →
    dropped; "we spent $40 on ads and 40% of signups came from them" + bars
    with **bare** values [ads 40, signups 40] → dropped (the spec strings
    share a unit; the matched numbers do not); the Instagram/referrals swap
    → dropped; "3 offices … 40 staff in 2019, now 12 offices" + bars
    [2019: 12, now: 3] → dropped; "It's not true that 90% of startups fail"
    + ring → dropped; "I'd never tell you to quit your job" + quote "quit
    your job" → refused; "…I think Elon said something like it: fail fast"
    + speaker Elon → refused; stretch "clients happy" + label "clients not
    happy" → dropped; a counter's label taken from the next sentence, within 8 tokens across
    the boundary → dropped; a label 12 tokens from its value in one sentence → dropped;
  - `FUNCTION_WORDS_EN` contains no negator, direction word or comparative
    (membership over each list).

  Mutations, **each killed by a case that no other rule also catches**
  (checked when the case is written): reuse `keywords.normaliseToken`
  (1.2 = 12); strip `\p{M}`; ignore units; **ring's `%` not required**
  (the 40-clients case); **units checked on the spec strings, not the
  matched numbers** (the bare $40/40% bars); **the same-sentence rule
  removed** (the next-sentence label); **the 8-token window removed** (the
  12-token label); **spoken order not checked** (the Instagram swap and the
  2019 bars, which every other rule passes); **negators exempt as function
  words** (the "clients not happy" label); **rule 7 removed** (the 90 %
  ring).
- **The property test** (`tests/graphicsValidator.test.ts`): random specs
  against random stretches, run by a fixed-seed generator, **plus
  adversarial generators**: swap the values of two pairs; insert a negator
  into the bound clause; take a label from the neighbouring sentence; strip
  a unit from the stretch but not the spec. **Every graphic `settleGraphics`
  keeps is grounded by an independent matcher that checks BINDING, not
  membership**: one occurrence per claim, same sentence, the window, spoken
  order, no unmatched negator. And **the grounding runs over what the
  painter draws**: the kept spec is painted at its settled frame into the
  fake context, and every string in its `fillText` list is grounded, so a
  painter that reformats a number or adds a unit fails the property even
  when the spec is clean. This is the bar's "by construction". Mutations:
  skip `grounded` fields; drop the order rule; let the painter regroup (each
  fails the property).
- `tests/directorGraphics.test.ts`:
  - the schema is flat, `reasoning` first, required in declaration order
    (the `directorSpine2.test.ts:63-67` pattern);
  - the prompt's last line is the language;
  - truncation and the wrong shape reject the pass but never the clip;
  - a wrong-template field is repaired;
  - spacing; the retry nudge on the OpenAI shape.
- `tests/graphicFrame.test.ts`:
  - moving frames from the beats;
  - an element arrives on its beat frame;
  - the seed draws in a fixed order;
  - the counter's last moving frame is `data.value` exactly (a fake
    context records `fillText`);
  - **the settled frame draws every `data` string verbatim, and nothing else
    but the template's listed fixed glyphs** (the fake context lists every
    string), and a ring's `%` only when the matched number carries one;
  - every counter frame before the last draws a digit string ≤ the value,
    in the value's own format ("10,00,000" counts through "9,50,000", never
    "950,000"). Mutation: format in-between numbers western always.
- `tests/graphicGuards.test.ts`: §6.4.
- **Harness check** `harness/graphicCheck.ts` (`__forgeGraphicCheck`,
  installed in `harness/main.tsx:28`), for each template:
  - frames 0, a beat, the last moving frame and the end differ as they
    should;
  - the last moving frame equals the held end (meanDiff 0);
  - alpha is 0 outside the layout box;
  - the same spec drawn twice is identical;
  - the live preview canvas equals the baked PNG within 1/255 (preview =
    export);
  - 1080×1920 draw and encode are timed for `EFFECTS.md`.
- `tests/integration/graphic.int.test.ts`, the render check, into
  `tests/output/graphic/` (the `moment.int.test.ts:42-194` pattern):
  - A fake `Bakers.graphic` writes a grey per frame index inside the
    template's box and transparency outside. A red shot sits beneath on V1,
    with a transcript whose words land on known frames.
  - `bakeForExport` runs at 9:16 and 16:9, then `buildRenderPlan`, then the
    bundled ffmpeg, sampled at `(f − 0.25)/fps`.
  - **The frame of each beat's word is that beat's grey**, and the frame
    before is not.
  - After the last moving frame the grey holds to the clip's end, then the
    opacity exit.
  - Outside the box the red shot shows.
  - The box sits in the free third §6.9 chose.

  Mutations: beats one frame late; the export bakes at the project's shape;
  a null bake left on the edit's asset (the export must not fail; the clip
  is dropped with a note).

**Census rows:** the Transcript tile's "Graphics", "Find graphics in this
clip", "Keep", "Drop", "Clear graphics"; the dock's graphic panel
(`tools/GraphicPanel.tsx`: the template's fields, re-checked by the
validator on every edit so a typed number not in the stretch shows a
warning, not a block, because the user may type what they like); the OUTPUT
strip's style tiles.

### 6.12 Exit

- The property test green and mutation-checked, over the painter's output
  and with the adversarial generators: **zero ungrounded, mispaired or
  de-negated graphics can ship.**
- Every number heard from a YouTube track or an unsure Whisper word waits
  for Keep (census rows present).
- One local configuration: a truth hit (±1 sentence) on ≥ 6 of 10 fixtures;
  the drop rate recorded; template fit ≥ 3/5 on ≥ 8 of 10, blind.
- The render check frame-exact at both shapes, on both builds.
- The harness's preview = export ≤ 1/255 for all six templates.

---

## 7. Step 4 — Best clips in the URL tile · 11 days

**What it is.** Sheet 27: **duration 1 / 2 / 3 / 4 min · Analyse** → three
tall cards, each with a title and why → **Clip it**. Sheet 26 falls out of it:
a transcript's rows selected and cut. The user called the URL panel "the
biggest one" and sheet 26 "the most important feature".

### 7.1 Metadata and the transcript from a link — measured with yt-dlp 2026.08.19

| fact | measured |
|---|---|
| metadata without downloading | `--simulate --print '@forgemeta@%(.{id,title,duration,language,chapters,heatmap})j'`, 1.68 s live. The full `-J` was 908 KB (162 caption languages × 7 URLs), so print a subset. The subset gains `channel`, `uploader` and `webpage_url` (standard yt-dlp fields, **not yet printed in a measurement**) for the quote's speaker and the credits' first line (§6.7, §8.5) |
| captions in today's job shape | `--write-subs --write-auto-subs --sub-langs <keys> --sub-format json3` added to the real argv works unchanged. The file lands as `<stem>.<lang>.json3` beside the media; `FILE_MARK` still prints the media path; `--print 'after_move:@forgesubs@%(requested_subtitles)j'` prints each caption's path |
| **a hyphenated key is subtraction** in a template | `%(requested_subtitles.en-orig.filepath)s` prints `NA` even when the track exists. Print the whole dict and parse it in TS |
| captions-only | with `--skip-download` the `after_move` and `post_process` prints never fire; `before_dl` and `after_video` do. `--print` without a later-stage print simulates and writes nothing, so pass `--no-simulate`. A missing language is skipped silently |
| **`--download-sections` does not trim captions** | a 6 s section still wrote the full 18.7-minute json3, 361,161 bytes. Captions are written before the media download with no range (`YoutubeDL.py` `_write_subtitles`). Caption times are always in the ORIGINAL video's clock |
| where a ranged file starts | exact cut 60–66 s: ffprobe `start_time 0.000`, duration 6.000. **That is the container's clock, not the content**: whether the exact cut's first frame IS source 60.000 s was **not measured**; only the fast cut was cross-correlated (corr 1.000, source start at file t = **10.000 s** = `PAD_MS`). **One video, Mac only**, and the 2018 Windows ffmpeg has never run under yt-dlp's `--download-sections --force-keyframes-at-cuts` |
| a local file for the test | **measured by the fixer**: yt-dlp 2026.08.19 with `--enable-file-urls` on a `file://` URL refuses a section, `ERROR: This format cannot be partially downloaded`. The integration test therefore serves its lossless clip over a localhost HTTP server inside the test (**unmeasured**: the dev sandbox cannot bind a port; CI can) |
| the ASR track | keyed `<lang>-orig` (`en-orig` on a video whose language is `en-US`). In json3, word start = `tStartMs + (tOffsetMs ?? 0)`. There is **no word end**, and `acAsrConf` is 0 on every word. Events overlap (roll-up). `\n` segs and `[Music]` appear. Punctuation is present |
| uploader subtitles | one seg per event: line timing only |
| `--sub-langs en.*` | also pulls auto-TRANSLATED tracks ('English from German'). Never use a regex |
| chapters | `%(chapters)j` → `[{start_time, end_time, title}]` (12 on the test video). Several `--download-sections` in one job all write `<stem>.%(ext)s` (measured in simulate), and `takeLine` keeps only the last mark (`download.ts:240`) |
| "Most replayed" | `heatmap`: 100 buckets `{start_time, end_time, value 0..1}` on one popular video. Low-view videos **unmeasured** |
| cleanup | the cancel cleanup regex (`download.ts:133-136`) **deletes** `<stem>.fr.json3`, `.fi.vtt` and `.fa.vtt` (they match the format-id group) and **leaves** `.en.json3` and `.en-orig.json3` as orphans, breaking `INGEST.md:78` |

**The files:**

- `src/shared/ingest/args.ts`:
  - `buildMetaArgs(url)`;
  - `buildCaptionArgs(url, keys, dir, key)` (`--skip-download --no-simulate
    --write-subs --write-auto-subs --sub-langs <explicit keys>
    --sub-format json3 -P dir -o '<key>.captions.%(ext)s'
    --print 'after_video:@forgesubs@%(requested_subtitles)j'`);
  - `META_MARK` and `SUBS_MARK` in `readMarkedLine` (`:229-234`). Pinned in
    `tests/ingestArgs.test.ts`.
- **Languages.** The primary subtag of the metadata language
  (`en-US` → `en`), requesting `<l>,<l>-orig`; or the user's pick from a
  list when it is missing.
- `src/main/ingest/meta.ts`: `runMeta` and `runCaptions` on the same spawn,
  detached group kill and `windowsHide` as `download.ts:203-217`. **Not
  `downloadMedia`**, whose success path assumes a media file and falls back
  to `findCached`, which could resolve 'done' with an unrelated media file of
  the same stem (`:296-311`).
- IPC `ingest:meta` and `ingest:captions`, with an AbortController per link
  key, `ensureYtDlp` first, and **not on presetId `'ingest'`**: `setJobs`
  would try to place the result as media (`store.ts:4640`).
- **`removePartials` fixed** to match `<stem>.<lang>.<ext>` deliberately,
  for every language. Mutation-checked with `fr`, `en` and `en-orig` cases,
  all three anchored.

### 7.2 json3 → Transcript, and shifting it onto a ranged download — `src/shared/ingest/captions.ts`

```ts
export function parseJson3(json: unknown, assetId: string, source: 'youtube-asr' | 'youtube-lines'): Transcript
//  word.startMs = event.tStartMs + (seg.tOffsetMs ?? 0)
//  word.endMs   = min(next word's start, event end, startMs + estimate(word))   — json3 has no word end;
//                 estimate = 80 ms per grapheme, at most 600 ms, so a real pause stays a gap
//  confidence   = null — never 0: TranscriptPanel.tsx:164 underlines < 0.5 as unsure, and acAsrConf is 0 on every word
//  '\n' segs and bracket tags ([Music]) dropped
//  segments = segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: 30, maxMs: 15000 }), plus a break at every json3 event gap ≥ 700 ms
//  'youtube-lines' (uploader track, line-timed): words spread within each line by grapheme count — marked approximate
export function shiftTranscript(t: Transcript, range: { startMs: number; endMs: number }, headOffsetMs: number, assetId: string): Transcript
//  keep words with startMs in [range.startMs, range.endMs); subtract (range.startMs − headOffsetMs); renumber; resegment
//  headOffsetMs = 0 for an exact cut (measured start_time 0), offsetIntoDownload(range) for a fast one (section.ts:97)
```

**Why the word ends are estimated, measured against the code.** With
`endMs = min(next start, event end)` the gap between words is about 0, so
`segmentIntoSentences`' 700 ms pause rule (`transcript.ts:46`, `:96-99`)
never fires. An unpunctuated ASR track (common on older videos and in Hindi
and Telugu) would become **one segment for the whole video**: Best clips
would have no sentence boundaries to build windows on (§7.3), and the
graphics stretch "cited sentence ±1" would become the whole talk, so a
number said anywhere would ground a graphic. Punctuation was seen on one
video only. So:

- word ends are capped by the grapheme estimate above (80 ms a grapheme is
  a starting value, **unmeasured**; the three-track measurement below sets
  it), and segments also break at json3 event gaps;
- `SENTENCE_END` (`transcript.ts:48`) gains the Devanagari danda `।` and
  double danda `॥`, which Whisper's Hindi output and YouTube's Hindi tracks
  use. This changes how future Hindi transcripts segment; stored transcripts
  keep their segments (they are never re-segmented on load);
- `segmentIntoSentences` gains an **optional** cap, `{maxWords, maxMs}`,
  splitting a long run at its largest inter-word gap. It is off by default,
  so the Director's existing behaviour is unchanged; YouTube tracks use it at
  parse, and every menu and stretch in this plan builds from
  `capSegments(t.segments, 30, 15000)` (pure, never written back);
- **measured before §7.3 is built**: three unpunctuated tracks, one Hindi or
  Telugu, segmented, with the segment-length distribution written into
  `EFFECTS.md`.

Which track wins is decision §16.12. The recommendation:

- `-orig` (word-timed ASR) for timing;
- the uploader track's text when both exist, matched line by line;
- Whisper on the downloaded range when the Python helper is there and
  neither track exists, or when the user asks.

How accurate YouTube's ASR timing is against faster-whisper is
**unmeasured**: no Whisper weights are on the dev Mac's userData path.
Measure it first on three videos.

**The URL transcript before a download** has no asset to key on. It lives in
the renderer's `urlSource` slice, with main's caption file kept on disk under
`userData/url/<linkKey>/` as the reload cache. It joins
`project.transcripts[asset.id]` only through `shiftTranscript` at collect.

### 7.3 Windows — `src/shared/bestclips/windows.ts`

```ts
export interface ClipWindow { id: string /* 'w1' */; segFrom: string; segTo: string; startMs: number; endMs: number; words: number }
export function windowsFor(t: Transcript, targetMs: number, tolerance = 0.2): ClipWindow[]
```

- **Boundaries are sentence boundaries only.** A window starts at a segment
  start and ends at a segment end within ±20 % of the target, preferring a
  sentence-final punctuation end.
- **Stride:** one segment.
- **No time from the model.** The model picks ids; code turns ids into ms
  (`DIRECTOR.md` §1).

### 7.4 Scoring — signals, then the model

**Signals**, `bestclips/signals.ts`, pure, always computed. Each gives its
own reason line:

- the heatmap mean over the window, when present;
- speech density from `wordsInRange` (`transcript.ts:157`) against the
  video's median;
- whether it ends on `.`, `!` or `?`;
- a penalty for a leading connective ("and", "so", "but");
- a hook in the first sentence (a question, "you", a number);
- the share of `[Music]`-style gaps.

**The prefilter.** Signals pick ≤ 24 windows (`MAX_CANDIDATES`) that do not
overlap by more than half. An hour is ~10.8k words and does not fit
`num_ctx` 8192 (`provider.ts:196`) in one call. Each window is shown
**condensed** to ~60–80 tokens: its first two sentences and its densest one.
24 × 80 + the system prompt + the answer is about 3k tokens. The density was
measured on Gemma 4 E2B in LM Studio at 3.0–3.55 chars a prompt token, from
the recorded spine runs.

**The model** makes **one comparative call**: `{reasoning, picks: [{id, title, why}]}`,
with `minItems 3`, `maxItems 3`, and `id` an enum. A 2B compares well and
rates on an absolute scale badly (`look.ts:13-16`).

- The validator checks that the id is in the menu.
- Titles are kept to 60 graphemes and why to 120, with decode headroom.
- The title is shown on the card only, never drawn into a frame, so it may
  be the model's words; but **every number in it and every capitalised
  token, the first word included**, must be in its window, else the title
  falls back to the window's first sentence cut to 40 graphemes. ("Modi
  admits failure" no longer passes on the first-word exemption.) A card
  title becomes a drawn title only through §6.7's `grounded` or `fixed`
  modes.
- Fewer than three valid picks are filled from the signals, with a note.

**No model:** the top three by signals, each titled with its first sentence
cut to 40 graphemes, and its reason line as the why ("the most replayed
part", "dense, ends on a full stop"). `scoredBy: 'model' | 'signals'` is
shown on each card.

The files are `bestclips/{schema,prompt,validate,run}.ts`, with `run.ts`
shared with the eval, as the Director's is.

### 7.5 Three cards, and Clip it

The URL tile panel (`IngestPanel.tsx`) gains:

- **Get transcript** (rows of time | text);
- chapter chips (each sets the range: `setIngest({useRange, startMs, endMs})`);
- **Best clips** in `src/renderer/src/components/tools/BestClips.tsx`:
  duration 1 / 2 / 3 / 4 min, **Analyse**, then three tall 9:16 cards with
  the title, the why, the range, the word count and `scoredBy`. A frame
  thumbnail per card (yt-dlp's storyboard formats) is **unmeasured** and
  left out of v1.

**Clip it**, from a card or from selected rows:

0. **Where the result goes.** Best clips' three cards are three separate
   shorts, and the first draft would have landed all three on one timeline,
   and its "Make it vertical" called `setAspect`, which re-solves **every**
   clip's crop with `solveCrop` (`store.ts:1387`): a Clip it into an
   existing 16:9 edit would flip and re-crop that whole edit. So:
   - **with nothing else on the timeline**, Clip it uses the current
     project and sets 9:16 if it is not already;
   - **otherwise it asks**, naming what it would do: "Start a new 9:16
     project for this clip" (the File → New Project route, `App.tsx:580-587`
     → `newProject`, `store.ts:4867`, which today does not check for unsaved
     work, so Clip it saves or asks first), or "Add it to this project" with
     the aspect unchanged and the clip reframed only if the canvas is
     already portrait;
   - **"Make it vertical" never changes an existing project's aspect without
     saying so.**
1. **Download.** `startIngest` with a request override `{range, exact: true}`
   (`store.ts:1060-1090` takes only `get().ingest` today). Exact or fast is
   decision §16.13, **open until the exact cut is cross-correlated against
   its source** as the fast cut was (§7.1: only the container's start time
   was measured). One job per range; several ranges are several jobs, which
   run 2 at a time (`ipc.ts:207`).
2. **Collect.** `pendingIngests[jobId]` gains `transcriptFrom: linkKey`, and
   `collectIngest` writes
   `project.transcripts[asset.id] = shiftTranscript(…)` inside its
   begin/commit (`store.ts:4691-4723`), plus `asset.credit` of source
   `'link'` with the channel and the URL (§8.5). One undo step: asset, clip,
   trim, transcript.
3. **Reframe.** When the Python helper is there and the face finder is on
   disk, `reframeClip` runs; a missing model is a button with its size, not
   a side effect (§0). Without the helper the crop is centred, with a note.
   That is its own undo step when the job lands.
4. **Captions** on, with smart placement (§5) where a track exists.
5. **Graphics.** `graphics@1` over the clip when a model answers, otherwise
   the baseline. **It starts only after the analysis job has finished and
   released its sessions** (§12.1), so the local model and Florence or
   BiRefNet are never resident together on the 8 GB machine. Every graphic
   is listed with Drop; one whose number came from a YouTube track waits for
   Keep (§6.6). Its own undo step, with Clear graphics.
6. **B-roll suggestions** (after step 5, §8.7), listed, never downloaded.

The panel lists what ran and what was skipped, and why.

**A link with no caption track:** the button reads **Listen to it ·
downloads the audio (~N MB) and the speech model (464 MB, first time)**, N
from the metadata's duration and the audio format's bitrate. Pressed, it is
an audio-only download that is not placed, transcribed by path (the reel's
`lyrics:` precedent, `store.ts:2112`). Without the Python helper: "This
video has no captions; Best clips needs the AI helper to listen to it."
Census rows: "Listen to it", "Start a new 9:16 project for this clip", "Add
it to this project".

### 7.6 Transcript → Clip it (sheet 26) — offered first, as M0

You called this "the most important feature … first among the three"
(`SHEETS.md:715-717`). **Its timeline half needs nothing from steps 1–3, and
no Python wherever a transcript exists**, so it is offered as **M0, about two
days, ahead of step 1** (decision §16.26): row selection, `clipToRange`,
`placeAssetRange`, and `timelineFrameAt`, which 1f needs anyway. Best clips
reuses it unchanged later. The agreed order stands unless you take the
offer.

`TranscriptPanel.tsx` gains row selection: click, then shift-click. That
covers the URL transcript in the URL tile, and a timeline clip's transcript
in the Transcript tile. **Clip it** on a URL transcript is §7.5. On a timeline
clip it is `clipToRange(project, clipId, startMs, endMs)` in
`src/shared/edit/clipIt.ts`, pure: the clip's in-point and duration are
trimmed to the selection, mapped with `timelineFrameAt` (§4.7) so speed is
honoured. TranscriptPanel's own mapping ignores speed (`:32-47`); it moves
onto the same function. For an asset not yet on the timeline,
`placeAssetRange(assetId, startMs, endMs)` (begin → `addAssetToTimeline` →
set in-point and duration → commit, beside `trimToRequestedRange`,
`section.ts:116-131`).

### 7.7 Tests, render check, harness, census

- `tests/ingestArgs.test.ts`: the new argv shapes as ordered shapes; the
  marks; explicit language keys, never `.*`.
- `tests/ingestCaptions.test.ts` (fixtures built in the test with the
  measured json3 structure; no third party's speech committed):
  - start = `tStartMs + tOffsetMs`; end from the next word, the event end,
    or the grapheme cap, whichever is first;
  - confidence null; `\n` and `[Music]` dropped; overlapping roll-up events;
  - the uploader track spread;
  - `shiftTranscript` for exact and fast heads;
  - **an unpunctuated track with 1 s pauses INSIDE one roll-up event
    breaks at each pause** (the break positions asserted, not the count),
    so only the word-end estimate can make those gaps; a second fixture
    whose pauses fall BETWEEN events breaks there by the event-gap rule; a
    pause-free run of 80 words is split by the cap, none over 30 words or
    15 s; a Hindi track ending lines in `।` splits there.

  Mutations, each failing its own fixture: confidence 0 (the "unsure"
  underline appears on every word); word ends at the next start (the
  in-event pauses stop breaking, and the cap splits elsewhere); the
  event-gap rule removed; the cap removed; `।` left out of `SENTENCE_END`.
- `tests/integration/ingestCaptions.int.test.ts`: `fake-yt-dlp.mjs` extended
  to print the meta and subs marks and write a json3, then
  `ingest:captions` end to end. The cancel path leaves no `.en.json3` and no
  `.fr.json3` (both anchored).
- **`tests/integration/exactCut.int.test.ts`, with the REAL yt-dlp**, because
  the Clip it check below uses the fake one and so never runs
  `--download-sections` with `--force-keyframes-at-cuts` (`section.ts:72-74`)
  through OUR ffmpeg (`--ffmpeg-location`, `args.ts:156`). A lossless frame-indexed clip (each frame's luma is its
  index) is served over a localhost HTTP server inside the test (a
  `file://` URL is refused for sections, measured, §7.1); yt-dlp cuts an
  exact and a fast section with `--ffmpeg-location` set to the bundled
  binary; the first frame's index is read off each file and compared with
  the requested start. It runs in Windows CI, which is the 2018 build's
  first run under yt-dlp. **If CI cannot run yt-dlp** (it is fetched at run
  time by `ensureYtDlp`), the test skips with its reason and the
  measurement is §15's, on the Surface. Mutation: request the section one
  second late, and the index check fails.
- `tests/bestClips.test.ts`:
  - windows start and end on sentence boundaries (a property over random
    transcripts), within tolerance;
  - the prefilter ≤ 24 with no window overlapping another by more than half;
  - the schema is flat;
  - fewer than three picks are filled;
  - the fallback with no model; a missing heatmap.

  Mutation: a window ends mid-sentence, and the property fails.
- `tests/clipIt.test.ts`: `clipToRange` at speed 1, 2 and through a ramp;
  `placeAssetRange`; **Clip it into a project with a 16:9 edit on its
  timeline asks and leaves every existing clip's crop and the aspect
  untouched** (membership over the existing clips). Mutation: call
  `setAspect` directly, and the existing clips' crops change.
- **Render check** `tests/integration/clipIt.int.test.ts`, into
  `tests/output/clipit/`: a local lossless clip with a synthetic transcript,
  "downloaded" as an exact range by the fake yt-dlp, collected with its
  shifted transcript, exported with captions. Each caption line's first
  frame is within one frame of its word, read by the caption's appearance.
  Mutation: the shift off by the range's start; every caption is then early
  by the start, and the test fails.
- **Harness:** the bridge stubs `ingestMeta` and `ingestCaptions`
  deterministically. The check selects rows, presses Clip it, and sees the
  stubbed job; then Analyse with the model stub, and three cards.
- **Census rows:** "Get transcript", "Best clips", "1 min", "2 min",
  "3 min", "4 min", "Analyse", "Clip it", "Make it vertical", chapter chips,
  and the Transcript tile's row selection hint.

### 7.8 Exit

- Ten real links chosen by the user (talks and podcasts; two in Hindi or
  Telugu): on ≥ 7 of 10, at least one card the user would post, with the
  model and with signals alone, recorded separately.
- Every window on sentence boundaries, by property.
- Clip it's captions within one frame on the exact cut (render check), on
  both builds.
- The exact cut's first frame cross-correlated against its source (the real
  yt-dlp test, or the Surface), and §16.13 decided on that number.
- Clip it end to end on the Surface without swapping (§12.1).
- YouTube ASR timing against Whisper measured on three videos and written
  into `EFFECTS.md`.

---

## 8. Step 5 — B-roll · 15.5 days

**What it is.** For a moment in the transcript, the model picks a **kind**,
the app fetches **candidates**, the user **clicks** one, and it lands
credited. The five agreed sources:

- Pexels (mood);
- Wikimedia Commons through Wikidata (the real thing);
- fact cards from the speaker's own words;
- X post cards from a pasted link;
- headline cards.

Plus Wikipedia cards, a page card from a pasted link, and the search and
answer cards. **No Google or Perplexity screenshots.**

### 8.1 Keys in Settings, write-only — `src/main/web/keys.ts` · 1 day

The Director's path, built once. **Step 5 adds the Pexels key only; the
Brave key, with its monthly cap and `safeStorage`, is step 6's** (§9), the
step that first uses it.

- `Settings.webKeys?: { pexels: string }` (step 6 adds `brave`) and
  `Settings.broll?: { allowShareAlike: boolean }` (`src/shared/types.ts:87-114`).
  `defaults()` and a strings-only sanitiser go in `src/main/store.ts:38-73`,
  modelled on `voiceHosted()` (`:105-119`). `mainKeys()` is derived from
  `defaults()` (`:125`), so `settings:set` refuses them and
  `rendererSettings()` leaves them out, automatically. Two existing tests
  loop over `Object.keys(getSettings())` and cover the new fields; each is
  mutation-checked again with them in.
- `keyStatus(): { pexels: { hasKey } }` (step 6: `brave: { hasKey, usedThisMonth, cap }`);
  `setServiceKey(service, key): KeyStatus` (`''` clears, absent keeps);
  `keyFor(service)`, for main's fetchers only, never over IPC.
- IPC `keys:status` and `keys:set`, with the service checked against the
  enum and `typeof key === 'string'`; they return `keyStatus()` only.
  Preload: two narrow named functions (`preload/index.ts:43-47`: no generic
  invoke). Harness stand-ins sit beside `bridge.ts:570-576`.
- `SettingsPanel.tsx:276-280`: Pexels becomes a write-only key row
  (password field holding only the draft, Save, Clear, then the draft
  cleared). An **"Allow share-alike (CC BY-SA)"** switch is added; its
  tooltip says what ShareAlike asks ("anything you make from a BY-SA picture
  or text is shared under BY-SA too, with credit and a link to the
  licence"). The switch is global, so it is not the only notice: each BY-SA
  candidate carries its own badge and its own click says it again (§8.8).
- **The panel's tests pin snapshot counts** (exactly one `type="password"`,
  two `apiKey` identifiers, one `setKey('')`; `tests/settingsPanel.test.ts:118-161`).
  They break when a second key row is added correctly. They become
  membership checks over **every** password field and **every** key save,
  and are mutation-checked again: put one field's value back to the saved
  key, and the relaxed check must fail.
- The Pexels key stays plaintext in `settings.json`, as the Director's and
  the voice's are; **the Brave key does not** (it is backed by a card, §9),
  and whether every key moves to `safeStorage` together is decision §16.14.
- **The user signs up for each key**; the app never creates accounts.

### 8.2 One fetcher in main — `src/main/web/fetch.ts` · half a day

`webFetch(url, {timeoutMs, headers, signal, onProgress, allow})` combines
three existing pieces: `director.ts:96-112` (a timeout with its own
sentence), `binary.ts:148-169` (cancel and timeout kept distinct), and
`packs.ts:243-285` (streamed progress). It adds:

- a **per-source host allowlist**;
- `redactKey` on every error;
- `User-Agent: 3dit/<version> (https://3dit.meme; <contact>)`. Measured:
  Wikimedia returns 403 to no UA and to `python-requests/2.32`, and its
  policy asks for client/version and contact. The contact is decision
  §16.23.

The keys go in headers, **never in a URL**: Pexels takes a raw
`Authorization: <key>` (measured: 401 "Invalid API key"); Brave takes
`X-Subscription-Token` (measured: 422, not 401, for both missing and
invalid, so the status sentence branches on `error.code`).

**Node 24's global fetch ignored `HTTPS_PROXY` in this shell** (ENOTFOUND)
unless `NODE_USE_ENV_PROXY=1`. Whether these fetchers should move to
Electron's `net.fetch`, which uses Chromium's stack with the system proxy
and certificate store, is **unmeasured inside Electron 44** (decision
§16.22).

### 8.3 The sources — `src/main/broll/` · 6 days

Every source returns `Candidate`s. **Main keeps each candidate's URL,
licence and author under an id**, and the download IPC takes the id only.
That is the packs precedent: "a renderer that could pass a URL here would be
a renderer that could make the app download … anything" (`ipc.ts:588-595`).

```ts
// src/shared/broll/types.ts
export type BrollSource = 'pexels' | 'commons' | 'x' | 'headline' | 'page' | 'wikipedia' | 'search' | 'link'   // 'link': a video ingested from a URL, credited by channel (§8.5)
export interface Candidate {
  id: string; source: BrollSource
  title: string; author: string | null
  thumb: string                              // forge-media://local/?p=<userData>/broll/thumbs/<id>.jpg — the renderer's CSP allows nothing remote
  licence: { id: string; name: string; url: string | null }   // 'pd' | 'cc0' | 'cc-by-4.0' | 'cc-by-sa-4.0' | 'pexels' | …
  /** may it show a person? Decided in main (§8.6); 'unknown' asks, exactly as 'yes' does */
  people: { verdict: 'yes' | 'no' | 'unknown'; why: string[]; names: { qid?: string; name: string }[] }
  restrictions: string[]
  shareAlike: boolean                                         // drawn as a badge on the candidate (§8.8)
  bytes?: number; width?: number; height?: number; kind: 'image' | 'video' | 'card'
}
export interface AssetCredit {                // MediaAsset.credit — persists with no migration (project.ts:79, :161; relink.ts:159)
  source: BrollSource; title: string; author: string | null
  licence: { id: string; name: string; url: string | null }
  attributionRequired: boolean
  pageUrl: string; line: string             // the credit line as shown (§8.5)
  objectName?: string; revision?: number    // Commons ObjectName; Wikipedia revision id
  shownWhole?: boolean                      // an X post: fit only, never cropped, masked, moved or shaped (§8.4)
  fetchedAt: string
  person?: { names: { qid?: string; name: string }[]; confirmedAt: string }
}
```

| source | how (measured 2026-10-05) | file |
|---|---|---|
| **Pexels** (mood) | `api.pexels.com/v1/search` and `/videos/search`, with the user's key. The API host is reachable (401 without a key). **Its docs, licence page and rate limits returned a Cloudflare challenge (403) again on 2026-10-05, and are unmeasured** (not worked around). **You read them in a browser before 8.3 is built**, and their clauses on identifiable people, endorsement and attribution (including any "provided by Pexels" link the search panel must show) go into §11. Until then, **a Pexels candidate goes through the same confirmation as a Commons person** whenever the AI helper's face finder sees a face on it, or it cannot be checked (§8.6): most of Pexels' stock shows people, and it would otherwise land under any sentence, including one about fraud or illness | `pexels.ts` |
| **Commons via Wikidata** (the real thing) | `wbsearchentities` (Eiffel Tower → Q243, plus two Delaunay *paintings*, so disambiguation runs on the description and P31); `wbgetclaims` P18 → the Commons file; `prop=imageinfo&iiprop=url\|size\|mime\|extmetadata`. `License` is machine-readable (`pd`, `cc0`, `cc-by-4.0`, `cc-by-sa-4.0`); `Artist` and `Credit` are HTML (strip tags); `AttributionRequired`; `Restrictions` (`personality` on Q42's portrait, which is CC BY-SA 2.0); `descriptionurl` is the credit's link. `iiurlwidth=1080` returned a bucketed **1280 px** thumb, so **the probe, not the API, is the size**. SVGs come back as `.svg.png`. Files are on `upload.` and `thumb.wikimedia.org`. Commons titles are free text, **never file names** | `wikidata.ts`, `commons.ts` |
| **fact cards** | the speaker's own words, as a `quote` graphic (§6) with `verbatim` text. No fetch, no third party | — |
| **X post cards** | the user pastes a link. Keyless `publish.x.com/oembed?url=…&omit_script=1&dnt=true` returns 200 JSON (`author_name`, `html` as a `<blockquote>` with the text and the date, `width` 550). `publish.twitter.com` 301s there. A missing post is **404 HTML**, so check content-type. `widgets.js` (94 KB, `platform.twitter.com`) styles the card inside a cross-origin iframe. Capture is §8.4 | `xpost.ts` |
| **headline cards** | **Google News RSS is out by its own terms**. Measured: its channel `<copyright>` restricts the feed to "a personal feed reader for personal, non-commercial use". Its links are Google redirect tokens, not the outlet's URL. So a headline card comes from **a pasted article link**: main fetches the page's `h1`, `og:title`, `og:site_name`, `article:published_time`, `article:modified_time` and `article:section`. The card is **our web-article card** (below), not a newspaper clipping. **Never the outlet's photo or logo; the app never writes or edits a headline.** A news feed with acceptable terms is decision §16.17 | `page.ts` |
| **Wikipedia cards** | keyless REST `page/summary/<title>`: `extract`, `wikibase_item` (the Q id, linking the card to Wikidata), `content_urls`. **The summary's `thumbnail` and the page's `og:image` were an enwiki-local logo file, not Commons (Eiffel Tower), so they are never used.** Images come only through P18 → Commons with its licence | `wikipedia.ts` |
| **page card** | a pasted link: `og:title`, `og:site_name`, `description`, the published time, drawn as our `source` graphic. Not a screenshot (decision §16.19) | `page.ts` |
| **search / answer** (step 6) | Brave Search, user's key; terms §11 | `brave.ts` |

**The headline card is a web-article card, not a clipping** (the first
draft drew it on the newspaper clipping; decision §16.17 records the change
from "the newspaper clipping tool fits"). Drawing a real outlet's name as the
masthead of a print clipping makes a mock-up of a page that never existed,
the same thing X forbids for posts. And the review measured on
theguardian.com (2026-10-05), on a political sketch column, that `og:title`
ends in " | John Crace" (the columnist) while the `h1` does not: drawing
`og:title` verbatim puts the columnist's name inside the headline, and
stripping it would be the app editing a headline.
That article was published at 17:13 and modified at 20:25, so headlines
change after publication, and an opinion column reads as news on a
clipping. So, as a `source` graphic of kind `'headline'`:

- **the headline in our type**, then an attribution line
  `<og:site_name> · <domain> · <published date>`; no page, paper or print
  styling, and no columns;
- **the headline text is the page's `h1`** when `og:title` equals the `h1`
  plus a trailing ` | …` or ` - …` segment; when they differ in any other
  way, the panel shows both and the user picks; the app never composes one;
- **"Opinion"** on the card when `article:section` or the page's schema.org
  type says so (`OpinionNewsArticle`, a section named Opinion or Comment);
- the credit keeps `fetchedAt` and the modified time beside the published
  one.

`PaperSpec` (`render/paper.ts:174`) is untouched: it generates headlines from
templates and fills columns with invented text (`:150-168`), which is fine
for the user's own playful clipping and never meets a real outlet's name.
`tests/headlineCard.test.ts`: the og:title/h1 cases above (the Guardian
shape, synthetic), "Opinion" from each signal, and the painter draws no
string outside the headline, the attribution line and "Opinion". Mutation:
draw `og:title` when it differs from the `h1` by more than a suffix.

### 8.4 The capture window, for X — `src/main/capture/cardWindow.ts` · 2 days, measure first

**X's display requirements, now read**
(`docs.x.com/developer-terms/display-requirements`, fetched by the review
and again by the fixer on 2026-10-05). For a post shown in a broadcast or video they ask that the
user's full name, @username, post text and profile picture be shown, with the
X logo near the post for as long as it appears and the timestamp displayed.
They forbid deleting, obscuring or altering the post content or the user's
identification; leaving out the timestamp; using X content in advertising or
to imply endorsement without the user's explicit permission; and "mock ups of
posts that don't exist on the platform". And X says it grants no permission
to use the content itself: the post author's rights are not X's to give.
What follows from that:

- **Only X's own rendered embed is used.** The first draft's fallback, our
  own neutral card from the oEmbed fields with no logo, breaks the logo and
  avatar rules, and cannot comply even in principle: the keyless oEmbed
  response carries `author_name`, `author_url`, `html`, `width` and no
  avatar URL (measured). **If capture fails there is no X card**, only a
  note.
- **The captured post is shown whole.** The asset's credit carries
  `shownWhole: true`, and a pure `shownWhole(asset)` is consulted by
  everything that could crop, cover or move it: `setAspect`
  (`store.ts:1386-1387`: no `solveCrop`, fit only), `canMoveCamera`
  (`edit/camera.ts:30`), `isKeyable` (`render/chromaKey.ts:218`),
  `CropOverlay` (`CropOverlay.tsx:23`), the mask and rounded-shape tools,
  Fill-with-picture, and B-roll's placement shapes (§8.8). Membership tests
  per site, as §6.4's guards are.
- **Never in a Director ad.** `broll@1`'s `post` kind is refused inside
  Direct, and placing an X card anywhere shows "using a post in an ad needs
  the author's permission".

**Measure first, on the user's machine (`npm run dev`) and on the Surface;
Electron cannot start in the sandbox:**

- does `capturePage(rect)` on a hidden window include X's cross-origin
  iframe?
- at what scale factor?
- how long until the widget has rendered?

**If it does:** a window modelled on `FrameServer`
(`graphics/frameServer.ts:13-90`), but **never on the default session**.
`forge-media:` serves any absolute path with `Access-Control-Allow-Origin: *`
on the default session (`mediaProtocol.ts:64-86`, `index.ts:16-37`), so
remote JavaScript there could read `settings.json` and the keys. The window
uses:

- `session.fromPartition('capture')`, in memory, where that handler is
  absent;
- no preload; `sandbox: true`;
- `webRequest.onBeforeRequest` allowing only `platform.twitter.com`,
  `syndication.twitter.com`, `cdn.syndication.twimg.com`, `pbs.twimg.com`
  and `abs.twimg.com` (the last two unmeasured);
- `setPermissionRequestHandler` denying everything;
- `setWindowOpenHandler` deny; `will-navigate` prevented.

**The flow:**

1. main validates the pasted URL;
2. fetches the oEmbed;
3. loads a local template holding `html` and `widgets.js`;
4. waits for the widget's rendered event or a stable size;
5. reads the element's rect and **asserts that the X logo and the
   timestamp lie inside it**, through the widget iframe's `WebFrameMain`
   (Electron can run script in a cross-origin subframe from main;
   **unmeasured in Electron 44**); a rect that would cut either is refused;
6. captures it to `userData/cards/<sha1(url)>.png`;
7. `probeImports` → an image asset with
   `credit {source: 'x', author: author_name, pageUrl, shownWhole: true}`.

IPC `cards:xPost({url, fps}) → MediaAsset`.

**If it does not** capture the iframe: no X card in v1, and the panel says
so (decision §16.18).

### 8.5 Credits — `src/shared/broll/credits.ts` · 2 days

- `creditsFor(project, range?)` walks the clips in range, takes their
  assets' `credit`, dedupes, keeps first-appearance order, and returns
  `{line, required, url}[]`. **A video ingested from a link comes first**:
  `collectIngest` gives it a `credit` of source `'link'` with the channel and
  `webpage_url` from the metadata (§7.1), the one credit a clipper always
  needs.
- Its consumers:
  - the pool tile's tooltip (`MediaPool.tsx:219`);
  - an EXPORT strip **Credits** block with **Copy** (for the video's
    description);
  - **the Done line.** A `credits.txt` beside the mp4 is not attribution: a
    Reels or TikTok upload never sees it. So when the export range holds an
    `attributionRequired` asset, EXPORT's Done line reads **"N credits
    required — Copy"** until the user copies them;
  - **`<output>.credits.txt`** written beside the export when the render
    job reaches done (the queue's changed handler, `ipc.ts:214-225`;
    `outputPath` is known at `:955-1013`), as a record.
- An optional **on-screen credit line** (small type at the bottom while the
  picture is on screen, drawn as a fixed-style text card) is decision
  §16.20.
- **Line formats**, from the licences' own terms (read by the review in the
  legal code: CC BY-SA 4.0 §3(a)(1) asks for a URI or hyperlink to the
  licence and that you indicate if you modified the material; CC BY 2.0
  §4(a) asks for the licence's URI with every copy, and §4(b) the work's
  title):
  - Commons: `"<ObjectName> by <Artist, tags stripped>, <LicenseShortName>
    <LicenseUrl>, via Wikimedia Commons <descriptionurl>"`, plus
    **" — cropped/changed"** whenever the clip crops, scales, shapes or
    grades it, which is nearly always (`setAspect` alone crops it).
    `LicenseUrl` and `ObjectName` are in extmetadata (measured:
    `https://creativecommons.org/licenses/by-sa/2.0` on Q42's portrait; PD
    files have no `LicenseUrl` and need none);
  - Pexels: `"Photo by <photographer> on Pexels"`, **to be confirmed against
    their guidelines** (§8.3);
  - X: `"@<handle> on X, <date>"`, with the post's URL;
  - headline and page: `"<site_name> · <domain>, <published date>"`, with
    the URL and the fetched time;
  - Wikipedia: `"From “<title>”, Wikipedia (rev <id>), CC BY-SA 4.0
    <licence URL> — <page URL> (excerpt)"`; the REST summary returns
    `title`, `content_urls.page` and `revision` (measured);
  - a linked video: `"<title> — <channel>, <webpage_url>"`.

**Tests** (in §8.9's `brollCredits.test.ts`): every credit with
`attributionRequired` carries a licence URL (membership over the credits,
not a snapshot); a cropped Commons picture's line says it was changed; an
export with a CC BY still shows the required-credit Done line; the link
credit is first. Mutations: drop `LicenseUrl`; skip `attributionRequired`
in the Done line; skip the modified flag.

### 8.6 The person rule and the licence gate — in main

**In `broll:download`, not the renderer:**

- **Licence.** `License` must be in `{pd, cc0, cc-by-*}`. `cc-by-sa-*` is
  allowed only when `Settings.broll.allowShareAlike`. **Everything else is
  refused**, with its name.
- **Person: the dialog shows unless the file is shown NOT to depict
  people.** The first draft fired it only on Wikidata P31 = Q5 or Commons
  `Restrictions` containing `personality`. Measured on 2026-10-05 (by the
  review, re-checked by the fixer): The Beatles (Q1299) is P31 = Q215380
  (musical group), not Q5, and its P18 file "Beatles Trenter 1963.jpg" is
  `License pd` with `Restrictions ''`, so a photo of four identifiable people
  would have landed with no confirmation. The same gap covers every band,
  team, couple, event and crowd, and cropped variants: Q42's second P18,
  "Douglas adams portrait cropped.jpg", has `Restrictions ''` where the
  uncropped file says `personality`. The signal exists in Commons'
  structured data: the review found M25320209's P180 "depicts" listing four
  humans plus Q1299, while M176712255, another P18 of the band, depicts only
  Q1299. So `people.verdict` is **'yes'** when any of these holds:
  - the entity's P31 is Q5;
  - any Commons MediaInfo P180 "depicts" value on the file has P31 = Q5;
  - the entity is a group of humans: P31/P279* reaches Q16334295 (one
    SPARQL `ASK` on `query.wikidata.org`, a host the Commons allowlist adds;
    measured by the fixer: musical group Q215380 → group of humans
    Q16334295 is true), or it has P527 / P463 members that are Q5;
  - `Restrictions` contains `personality`;
  - when the AI helper runs, the face finder (step 1) finds a face on the
    downloaded still (it runs on the file in staging, before it is placed).

  **'no' only when none of them holds AND each one could be checked** (the
  depicts statements exist and name no human, and the face finder ran and
  found none). Anything undecidable is **'unknown', which asks exactly as
  'yes' does.** The dialog (`dialog.showMessageBox`, as the close guard does,
  `index.ts:150-157`) names the people it knows of and the file, and refuses
  without an explicit yes; the confirmation is stored in
  `credit.person.confirmedAt`. **A picture that may show a person never
  lands without it.** Any other restriction value (`trademarked`,
  `insignia`) uses the same dialog. **Pexels** candidates take the face
  check and the 'unknown' rule the same way (§8.3).

### 8.7 The B-roll pass — `broll@1`: the model picks the kind · 2 days

```jsonc
{ "reasoning": "…",
  "picks": [   // maxItems 6
    { "sentence": "s12",                                   // enum
      "kind": "entity",                                    // enum: mood | entity | fact | post | headline | none
      "query": "Eiffel Tower",                             // entity: must be a contiguous run of the sentence (verbatim); mood: ≤ 4 words, free
      "link": "",                                          // post/headline: enum of the links the user pasted for this clip (L1, L2…), '' otherwise
      "why": "…" } ] }
```

- `src/shared/broll/{schema,prompt,validate}.ts`; the menu is the
  sentences, as in §6.6.
- **Validated:** an entity query is verbatim in its sentence; a post or
  headline pick must name a pasted link; at most one pick per 8 s; **a
  `post` pick is refused inside Direct** (§8.4).
- The result is **suggestions**, stored as
  `Project.broll?: Record<assetId, BrollSuggestion[]>` in source ms. They
  are shown in the B-roll panel and never downloaded by themselves.
- **Disambiguation:** Wikidata's top three by description are shown, and
  the user picks. The model does not choose an entity for a person.
- **No model:** no suggestions. The panel's search works by hand.

### 8.8 The panel and the download flow · 2 days

`src/renderer/src/components/tools/Broll.tsx`. Its home (a Shelf tile, which
changes sheet 20's order, or a section of Best clips and the Transcript
tile, as sheet 27's "B-roll images (its own settings again…)" suggests) is
decision §16.6.

- **Search** (source, query) → `broll:search` → candidates with thumbnails.
  The Search press is the consent for thumbnails, which are small and go to
  an in-memory cache under userData (decision §16.21).
- **Each full file is its own click**, labelled with the size where known
  (the packs precedent, `Get · 1.2 MB`).
- **A BY-SA candidate wears a "share-alike" badge**, and its Get click says
  what ShareAlike asks before it downloads, every time, because the switch
  that allows it is global and would otherwise let BY-SA land silently in a
  later, possibly commercial, project.
- Stills go through a direct invoke. **A Pexels video goes through the
  `downloads` queue** with a bar and a cancel (`ipc.ts:114-207`, the ingest
  start/collect pattern).
- Files are written to `userData/broll/<source>/<id>.<ext>`, **named by
  provider id or content hash, never by a title** (`Bride 5:30pm.jpg`: a
  colon is illegal on Windows), then `probeImports` (`imports.ts:112`) and
  `asset.credit`.
- **Placement** of a picked candidate at a suggestion: an overlay clip over
  the sentence, sized by the suggestion. Its shape is one of the B-roll
  effects the app has (`picture-in-picture`, the strip, the clipping), as
  sheet 27 says, and it uses free-space placement (§6.9). **An X post takes
  none of them**: it is placed whole, fitted, with no camera move (§8.4).

Census rows: every label above, plus the Settings rows and the switch.

### 8.9 Tests, render check, mutations

- `tests/brollLicence.test.ts`: each licence id → allowed, refused, or
  behind the switch. **Membership over a table, not a snapshot.** Mutation:
  BY-SA allowed without the switch.
- `tests/brollPerson.test.ts`: **one fixture per signal, in which that
  signal is the only one that fires**, so each mutation below has a case
  that only it can fail (`CLAUDE.md`: a mutation another rule also catches
  proves nothing):
  - P180 only: a file on a non-human, non-group entity whose depicts lists a
    Q5 (the shape of M25320209's statements);
  - group only: the measured Beatles entity (P31 Q215380, which reaches
    Q16334295) with M176712255, whose depicts names only Q1299, and `pd`
    with empty `Restrictions`;
  - Q5 only; `personality` only (Q42's uncropped portrait); a face found
    only (a stub face finder);
  - and the combined Beatles case (P18 "Beatles Trenter 1963.jpg", `pd`,
    empty `Restrictions`, M25320209's humans) reaches the dialog; an
    undecidable file ('unknown') reaches it; a refusal leaves no file.

  Mutations, each failing its own fixture: drop the P180 check; drop the
  group-of-humans check; drop the face check; skip the dialog when `qid`
  is missing (Restrictions-only must still trigger it); treat 'unknown' as
  'no'.
- `tests/brollCredits.test.ts`: `creditsFor` dedupes and orders; HTML
  stripped from `Artist`; every placed B-roll asset has a credit
  (membership).
- `tests/webFetch.test.ts`: a key never in a URL; `redactKey` on errors; the
  allowlist refuses other hosts; the UA is present.
- `tests/settingsStore.test.ts`, `tests/settingsPanel.test.ts`: §8.1's
  relaxed membership checks, mutation-checked again.
- `tests/headlineCard.test.ts`: §8.3's cases.
- `tests/xPost.test.ts`: `shownWhole` holds at every guard (`setAspect`,
  `canMoveCamera`, `isKeyable`, `CropOverlay`, the shapes), membership per
  site; a failed capture yields no asset; `post` refused in Direct.
  Mutation: leave `shownWhole` out of `setAspect` (the captured post is
  re-cropped to 9:16).
- `tests/brollPass.test.ts`: the schema is flat; an entity query must be
  verbatim; a post needs a pasted link.
- Fixtures: recorded API responses (Wikidata, Commons, oEmbed and Wikipedia
  JSON, measured shapes) in `tests/fixtures/broll/`, made from PD/CC0
  examples. No network in CI. **No Brave response is ever recorded**: its
  Terms forbid storage beyond transient storage (§9, §11).
- **Render check** `tests/integration/brollCredits.int.test.ts`, into
  `tests/output/broll-credits/`: a synthetic still with a fake CC BY credit,
  placed, exported. `<name>.credits.txt` sits beside the mp4 with the line,
  and with the on-screen option the line's rows are present in frames while
  the picture shows. Mutation: the credits file written before the job is
  done (a cancelled export leaves one).

### 8.10 Exit

- One real session by the user: five moments, each kind used once.
- Every asset placed carries a credit; `credits.txt` is correct; the Done
  line names the required credits.
- A person's portrait, and a group photo with no Q5 on its entity, both
  refused without the confirm and placed with it.
- A BY-SA file refused with the switch off.
- The X capture measured, with the logo and timestamp inside every
  captured rect; the Pexels licence and guidelines read, their clauses in
  §11 and the credit line confirmed.
- No key appears in any log, error or URL (a test over the redaction
  paths).

---

## 9. Step 6 — Retrieved-fact cards and the 3D templates · 8 days

**Retrieved-fact cards** (3 days) are the `source` template with `sources[]`:

- a **Wikipedia card**: the extract, credited (§8.5), behind the BY-SA
  switch (§16.15);
- a **page card** from a pasted link;
- an **answer-with-sources card**, titled **"From <site>"**, never "Answer".
  The model extracts from fetched texts only (the Wikipedia extract, fetched
  pages), and:
  - **verbatim runs only**, never `grounded` paraphrase, so two pages'
    sentences cannot be stitched into a claim neither makes;
  - **at most 25 words per source**, with a source line under each sentence;
  - **one claim per card**;
  - each sentence validated as a verbatim run of one fetched text, with its
    index (§6.7's matcher pointed at the fetched text); a sentence that
    grounds nowhere is dropped;
- a **search card** only as decision §16.16 allows (the terms, §11).

**Fetched numbers never land on the speaker's beat.** A counter whose number
came from a page, placed on the word the speaker said, makes the page's
figure read as the speaker's claim: if they said "about a third" and the
page says 31.4 %, the video contradicts or overstates them. So:

- a fetched number appears **only in a `source` card**, with its source line,
  never in a step-3 template on a spoken beat;
- if the stretch holds a **different** number with the same unit, the card
  is dropped with the note "the page says X; the speaker said Y".

**Paywalled text is never quoted.** The fetcher takes only what a page
serves without signing in, and a page whose schema.org data says
`isAccessibleForFree: false` is refused (**unmeasured** on real pages; read
on three news sites in the step).

**The Brave key, here and not in step 5** (1 day). Measured on
brave.com/search/api (2026-10-05, by the review and again by the fixer):
Search costs **$5 per 1,000 requests** and includes **$5 in free credits
every month**, applied automatically, with a card on file. Past about 1,000
searches a month the user's card is charged: a per-use API cost, against
`CLAUDE.md`'s "no per-use API cost". So:

- **a hard monthly cap, enforced in main**: 900 requests, counted per
  calendar month in settings, refused at the cap with a plain sentence
  ("You've used this month's free searches; they reset on the 1st"), and
  shown in Settings as **"N of 1,000 free searches this month"**;
- **the Brave key is stored with Electron's `safeStorage`**, not plaintext
  (at least this one; §16.14 asks about the rest);
- the Settings row, its census row, and §8.1's write-only path and tests,
  extended to the second key;
- **Brave test fixtures are synthetic only, and no eval ever runs over Brave
  results.** The Terms (api-dashboard.search.brave.com/terms-of-service,
  read by the review) forbid storage beyond transient storage (i), and using
  Search Results to create, evaluate or train AI models (xiii). A recorded
  response or an eval of the answer card over live Brave results would do
  both.

Tests: the cap refuses the 901st request in a month, made across several
of its days, and resets on the 1st (fake clock); the key never leaves `safeStorage` in plaintext (the settings
file holds no key string, membership over its values). Mutations: count per
day instead of per month; write the key to `settings.json`.

**The 3D templates** (4 days): `timeline`, `before-after`, `versus`, and 3D
variants of `counter` and `ring`, on the shared renderer:

- `threeShared.ts`; `sized()` before every render (`momentCanvas.ts:393-395`);
- baked serially;
- **disposed on rebuild, supersede, bake end and clip removal**, as
  `momentCanvas.ts` does (`:523`, `:533-536`, `:555-558`, `:612`). Not like
  the carousel, whose rebuilt scenes are never disposed
  (`carouselCanvas.ts:128-141`: a probable leak on the one shared context,
  found by reading, §17).
- **Type is drawn with `drawTextOnto` into a `CanvasTexture`.** Measured:
  three 0.186.0's `TTFLoader` imports opentype.js from `cdn.jsdelivr.net` at
  runtime, and `TextGeometry` needs typeface JSON fonts the catalogue does
  not have.

**Measure in the harness:** whether a flat style colour through three.js
(an `SRGBColorSpace` texture, the default output colour space) comes out
byte-equal to the 2D painter's, and whether an antialiased semi-transparent
edge survives WebGL premultiplied → `drawImage` → straight-alpha PNG. Both
are **unmeasured**, and `graphicCheck.ts` gains them.

The tests and render checks are §6.11's, extended per template. The 3D
templates replace the stub `kinetic-type` moment (`moment.ts:16-19`,
`:227-228`), which today draws as a depth push.

**Exit:** each 3D template passes the harness contract; the flat-colour
check is within 2/255; the answer card never ships a sentence that is not a
verbatim run of one fetched text (property test); no fetched number lands
on a spoken beat (a test over every template's placement); the Brave cap
holds.

---

## 10. Step 7 — Creator styles and saved templates · 4.5 days

**Gated on `MARKET.md` Stage 0** (`MARKET.md:94-103`). Its own
prerequisites are not met today: Phase C measured and finished (it is
paused), and a music library with redistribution rights or the
`filler-supplies` policy as the only one for paid templates. The creator
style below needs neither and can land with step 3's styles if you want it
sooner; the saved template waits for Stage 0, or moves to §17.

- **A creator style** is a caption style and a graphic style saved together
  as "my look". It is exported and imported as JSON (`{author, version,
  licence}` header, `MARKET.md` §1), and applied in one click from the
  OUTPUT strip. 2 days.
- **A saved template with slots** is a Clip it result (reframe rules, caption
  look, graphic style, B-roll shapes, the graphic templates with their data
  emptied into slots) saved as `MARKET.md`'s Stage 1 local template, with no
  network. **Rights:** B-roll with a credit and the author's own footage are
  stripped on save, like slot media (`MARKET.md:181-190`). No third-party
  marks; no likenesses. 2.5 days.
- Stage 2 onward (sharing, the store) is `MARKET.md`'s, not this plan's.

---

## 11. Rights — the rule per source

Not legal advice; these are the rules the code enforces, from what was read
on 2026-10-05.

| source | allowed | credit | refused | measured / unmeasured |
|---|---|---|---|---|
| the speaker's own words (fact, quote cards) | **the creator's own footage**: always. **A linked video** (Best clips): the speaker is a third party, so a quote names them from yt-dlp's channel, never from the model, and the link's credit is the first line of the credits | own footage: none; a link: `<title> — <channel>, <url>` | a speaker name the stretch does not say said it (§6.7) | the video's own rights are yours to clear, as for any link you ingest |
| Wikimedia Commons | `pd`, `cc0`, `cc-by-*`; `cc-by-sa-*` **only with the switch**, each BY-SA file badged and explained at its click | `<ObjectName> by <Artist>, <LicenseShortName> <LicenseUrl>, via Wikimedia Commons <descriptionurl>`, plus " — cropped/changed" when it is; required where `AttributionRequired` | every other `License` (refused with its name); **a file that may show a person** (P31 Q5, a P180 depicts of a human, a group of humans, `personality`, or a face found) **without the user's confirm**, and an undecidable one likewise; other `Restrictions` without the confirm | extmetadata measured on Q243, Q42 and Q1299; P180 on M25320209 and M176712255 |
| Pexels | the Pexels licence, as you read it | `Photo by <name> on Pexels` written always, to be confirmed | until the licence is read: any candidate the face finder sees a face on, or cannot check, without the confirm | **the licence page, API guidelines and rate limits are unmeasured** (Cloudflare 403 again on 2026-10-05). You read them before 8.3 is built, and their people, endorsement and attribution clauses go here |
| Wikipedia text | the extract quoted with a link, **behind the BY-SA switch** (it is CC BY-SA 4.0, and a trimmed extract is a modification) | `From “<title>”, Wikipedia (rev <id>), CC BY-SA 4.0 <licence URL> — <page URL> (excerpt)` | **the summary thumbnail and og:image, always** (measured: an enwiki-local logo) | `title`, `content_urls.page` and `revision` measured in the REST summary |
| X posts | a post **the user pasted**, through X's own embed, **shown whole**: full name, @username, text, avatar, logo and timestamp kept, never cropped, masked, moved, shaped or retimed | `@handle on X, date`, with the URL | any post the user did not paste; **any card of our own making** (a mock-up); an X card in a Director ad; a capture that cuts the logo or the timestamp | **X's display rules read and followed** (2026-10-05); **the post author's rights are yours to clear**: X grants none. The developer agreement beyond the display rules is yours to read |
| news headlines | the page's own headline (`h1`, or `og:title` less a trailing byline), the outlet's name in our type, the date, from **a pasted article link**, as a web-article card | `<site_name> · <domain>, <date>`, with the URL and the fetched time | the outlet's photo or logo; a print-clipping masthead; a headline the app writes or edits; **Google News RSS** (its own `<copyright>` restricts the feed to personal, non-commercial use, measured) | another feed's terms are unmeasured |
| page cards | the page's own title, site name and date as our graphic | `site, date`, with the URL | og:image; a screenshot (decision §16.19) | — |
| **page text** (answer and page cards) | **a short verbatim quote with its source**: at most 25 words a source, one claim a card | the page's own credit under each sentence | paraphrase; text stitched across pages; **paywalled text** (`isAccessibleForFree: false`, or anything behind a sign-in) | the paywall signal is unmeasured on real pages |
| Brave Search | **the URLs it returns, to fetch the pages themselves**, under a hard cap of 900 searches a month | the fetched page's own credit | **a card showing Brave's snippets or result list**; storing results beyond transient storage (Terms (i)); **any eval or fixture made from Brave results** (Terms (xiii): no creating, evaluating or training AI models with them); a search past the cap | the Terms (1 Sep 2026) and prices ($5 per 1,000, $5 free a month) measured 2026-10-05; you read §3 before the search card is planned (decision §16.16) |
| Google / Perplexity screenshots | **never** | — | — | agreed |
| saved templates | library assets by id, the author's own design elements | per `MARKET.md` | B-roll with a credit and third-party footage (stripped on save) | `MARKET.md` §5 |

---

## 12. Python — the prerequisite (BETA R4)

The installers ship no Python (`service.ts:26-35`), and the packaged app falls
through to a bare interpreter because `.venv` is excluded. **No step's Python
half reaches installed users until Step P lands** (§3a: BETA R4's full
route, the app installing a Python pack under `userData` itself, 1–2 weeks
and 300 MB or more by `BETA.md`), as sheet 22 decided ("for this we will
install Python then I guess"). Until then **every Python control is greyed
with "needs the AI helper"**, never offered as a toggle that changes
nothing.

What each step needs:

| step | without Python | with it | sizes |
|---|---|---|---|
| 1 reframe | shots (main), every crop centred: **today's `solveCrop`, so nothing new to see**; Follow the subject and Reframe greyed | faces, salient, ground | faces: YuNet 0.23 MB, or MediaPipe ~34 + 56 + 9 MB of wheels (Mac) and the 0.23 MB model; **BiRefNet 109 MB, a download for any user who never baked depth** (on disk only on the dev Mac); Florence-2 int8 275 MB, each its own Get press |
| 2 free space | the style's position; **Smart placement greyed** | per shot | — |
| 3 graphics | over **a link's caption track** only; **no `callout`** (it needs a face box) | over own footage (its transcript is Whisper's), and `callout` | — |
| own-footage transcript | **none**: own footage has no captions | Whisper | faster-whisper small 464 MB on disk (measured), its own Get press |
| 4 Best clips | **all of it over YouTube's captions**; Clip it with centred crops | Whisper for links without captions and for Clip it's re-transcription; the reframe | as above |
| 5 B-roll | **all of it**, but every picture that might show a person asks (no face check) | the face check that clears a picture of people (§8.6) | — |

**The pack's contents.** `requirements.txt`, plus the optional files this plan
adds: `requirements-faces.txt` if MediaPipe is chosen, and nothing extra for
ground (onnxruntime, tokenizers and numpy are there). `tokenizers` becomes
explicit.

**The cv2 clash.** MediaPipe brings `opencv-contrib-python`; mask tracking
plans `opencv-python-headless`. One environment may hold one `cv2`
(decision §16.1).

**The interpreter.** The dev venv is CPython 3.14.6. CI runs a bare 3.12 with
no pip install (`.github/workflows/ci.yml:78-83`), so every new method must
appear in `degraded` there (§4.9). R4 picks the pack's version; mediapipe
supports 3.12–3.14 by wheel tags, and whether it runs on 3.14 is
**unmeasured**.

**A Windows-only gap.** Capability integration tests gate on
`.venv/bin/python` and so have never run on Windows (`vision.int.test.ts:22-24`).
§4.9's `venv.ts` fixes that; Windows still needs a venv on the Surface
(`CLAUDE.md`'s fresh-checkout table: `FORGE_PYTHON`, the Store alias trap).

### 12.1 Memory on the 8 GB floor machine

The Surface is "the 8 GB-class floor machine" (`FIX.md:1060`). `LLM.md`
budgets E2B at ~2–3 GB resident and Electron at 1–2 GB before anything loads
(`LLM.md:165-167`). Clip it can stack, in one run: the reframe analysis (the
face finder, BiRefNet, and Florence-2's four graphs at 275 MB of int8
weights, activations **unmeasured**), then `graphics@1` on the local model,
plus faster-whisper for a link with no captions. And the helper caches every
ONNX session for its whole life (`depth.py:97-98`, `:129-151`), so whatever
the analysis loaded stays resident while the model runs.

- **Measure first** (§15): the helper's peak RSS per capability (faces,
  salient, ground, asr) on the Mac and the Surface, written into
  `EFFECTS.md`.
- **Release when done.** A new helper method, `system.release({names})`,
  drops the named sessions under the session lock; the analysis job calls it
  for everything it opened when it ends, success, failure or cancel. Depth's
  own cache moves to the same rule: an LRU with a byte cap (set from the
  measurement) rather than "forever".
- **Serialise Clip it.** The model pass starts only after the analysis job
  has finished and released (§7.5 step 5); Whisper releases before the
  analysis starts. The analysis queue's concurrency 1 (§4.7) already keeps
  two analyses from overlapping.
- **The bar** (§0): Clip it end to end on the Surface, on a 10-minute 1080p
  source, without swapping. Over it, Florence runs only for a typed phrase,
  then the analysis drops to 3 fps and 480 px.

---

## 13. Every ffmpeg filter and option this plan emits, against the floor

| filter / option | used by | merged | status |
|---|---|---|---|
| `select='gt(scene,T)'` after `format=rgb24`, `metadata=print`, at **`-loglevel info`** | 1b shots | 2012 / 2012 / 2016 | **dated**; measured on the Mac. The score differs per build without `format=rgb24` (§4.2); at `-loglevel error` nothing prints (measured). **Windows parity is §4.9's committed score table, asserted in CI** |
| `scale` before analysis; `-ss` before `-i` for one frame | 1b, 1c, 1d, 1g (in the helper) | old | measured on the Mac (30–80 ms a seek, exact shot) |
| `crop` with a per-frame `x`/`y` expression (`if`, `lt`, eased segments), literal `w`/`h` | 1f crop keys | crop 2010s; eval functions 2011 | measured on the Mac (step and linear exact); **dated** for Windows; the reframe render check runs in CI |
| `adelay=<n>S\|…` (samples) | step 0, every audio clip | the `S` form is in the 2018-11-11 source read for this plan | measured exact on the Mac; **CI with step 0** |
| `fps=${fps},zoompan=…:d=1:…:fps=${fps}` on video | step 0 (§3.4) | 2014; zoompan's restamping read in the 2018 source (`vf_zoompan.c:158`, `:225`, `:309-310`) | measured on the Mac: 60 fps and 29.97 fps sources keep their duration with the leading `fps=`, and go to half speed or drift without it; **CI with step 0** |
| `-filter_complex_script <file>` | step 0 (§3.7), every render | in the 2018 source (`f22fcd4` `fftools/ffmpeg_opt.c:3109`, `:3478`) | measured on the Mac (re-run by the fixer); the 360-cut render check runs it in CI |
| `-vsync vfr` (a test fixture's variable-rate source; `-fps_mode` is 2022, too new) | §4.9's render check | old | measured in CI with step 1 |
| ASS per-event `{\anN}` and `MarginV` via `subtitles` | step 2 | core ASS / libass | measured on the Mac (rows above); **dated**, CI with step 2 |
| `overlay` of a PNG sequence, `format=yuva420p`, `tpad=stop_mode=clone` | step 3 graphics | 2010 / Oct 2018 | in CI (moments, captions) |
| opacity keys (`geq` on alpha) | step 3 exits | 2014 | in CI |
| `scdet` | **not used** | 2020-05-14 | goes into `TOO_NEW` (§3.5); the Mac build has it |
| `cropdetect` | **not used** (black bars only) | — | — |

Every new shape goes into `tests/oldestFfmpeg.test.ts`: the render shapes
into `SHAPES`, and the analysis argv into the new `ANALYSIS_SHAPES`.

---

## 14. Degraded modes — each rendered, each a test

| missing | what happens | test |
|---|---|---|
| the Python helper | Follow the subject, Reframe and Smart placement greyed with "needs the AI helper"; crops as they were; captions at the style's place; Best clips over YouTube captions only; graphics over caption tracks only, no `callout`; every B-roll picture that may show a person asks | `reframe.int` with the helper refused; `bestClips` without asr; census rows for each greyed control |
| a model not on disk | its Get button with its size; nothing downloads until it is pressed | census rows; a store test that no toggle or phrase starts a download |
| the face detector (degraded) | salient, then centre, per shot, with a note | path test "no faces" |
| Florence-2 (not downloaded, or over its gate) | the phrase field greyed with its reason; salient covers no-face shots | path test "ground absent" |
| no shots found (a single take) | one shot; the path still pans | path test |
| a rotated file whose size disagrees | the track is refused; centred crop; "the file's orientation changed — reframe again" | `faces.int` rotated case |
| a retimed clip | the followed crop is recompiled from the track at read time, so its cuts move with the speed; graphics refuse with a note | `reframeKeys` after `withClipSpeed`, a ramp, `convertFrameRate`, a trim, a split; graphics test |
| no model | graphics from the baseline; Best clips from signals; no B-roll suggestions | each pass's settle test with the fake provider refusing |
| a prose or truncated answer | that pass only falls back; the clip stands | settle tests |
| a graphic that cannot be baked | dropped from the export with a note; the export succeeds | `graphic.int` |
| WebGL unavailable | 3D templates dropped with a note; 2D ones draw | graphic test |
| no Pexels or Brave key | the source greyed: "add a key in Settings" | panel test |
| offline | each source's search says so; nothing half-written (staging then rename) | `webFetch` test |
| X capture fails | no X card, a note; never a card of our own making | `xPost` test |
| the Brave cap reached | the search says so and refuses until the 1st | the cap test (§9) |
| a number from a YouTube track | the graphic is a proposal, "check the number", until Keep | `directorGraphics` test |
| a link with no captions and no Python | "Best clips needs the AI helper to listen to it" | panel test |
| Windows | every render check above runs in CI on the 2018 build | CI, read after every push |

---

## 15. Measure before relying — the open measurements

Each is named in its step, and each step's first task is its own row:

1. MediaPipe on a normal Mac, on the Surface and on CPython 3.14: survival,
   recall on small faces, speed, and full-range acceptance. Against YuNet
   **through its hand decoder** on the same frames (§4.1, §4.3).
2. The scene threshold and minimum shot on footage with hand-marked cuts;
   the per-cut scores on the 2018 build against the committed table (§4.1,
   §4.9).
3. Florence-2 int8 on the CPU: seconds per grounding on the Mac and the
   Surface, the hand-written loop, box quality, **and its peak RSS** (§4.5).
4. **The helper's peak RSS per capability** (faces, salient, ground, asr) on
   the Mac and the Surface, and Clip it end to end on the Surface without
   swapping (§12.1).
5. The followed crop in the preview while playing: the cut lands on the
   element's frame (§4.9 harness).
6. **The followed crop at speed 1 on 29.97 fps, 60 fps and VFR sources**:
   whether `fps=`'s rounding agrees with the half-frame keys, or the crop
   needs `fps=` ahead of it (§4.7, §4.9).
7. The 360-cut render through `-filter_complex_script` on the 2018 build,
   and its export time (§3.7).
8. The fps-prefixed zoompan on the 2018 build, at 60 and 29.97 fps (§3.4).
9. The PNG encode of a transparent 1080×1920 graphic frame (§6.3).
10. LM Studio's strict `json_schema` with `minItems: 0`; whether Gemma 4 E2B
    ever answers prose under it; LM Studio's context length for the user's
    load; Ollama past `num_ctx` (§6.6).
11. Telugu negative verb endings on the Telugu fixtures, against the
    validator's rule 7 (§6.7).
12. Prefill time for a 3k-token Best-clips prompt on the Surface, against
    the 180 s timeout.
13. YouTube ASR word timing against faster-whisper on three videos; **three
    unpunctuated tracks (one Hindi or Telugu) segmented**, and the grapheme
    estimate for word ends set from them (§7.2).
14. **The exact cut's first frame against its source**, cross-correlated as
    the fast cut was, on both builds: the real yt-dlp test in CI, or **on
    the Surface** if CI cannot run yt-dlp; the fast-cut head offset on more
    videos (§7.1).
15. Whether low-view videos carry a heatmap (§7.4); whether the metadata
    subset's `channel`, `uploader` and `webpage_url` print as expected
    (§7.1).
16. Electron 44 `capturePage` of X's cross-origin iframe on a hidden window,
    and reading the logo's and timestamp's rects through its `WebFrameMain`
    (§8.4).
17. Pexels' licence, guidelines and rate limits, read in a browser; X's
    developer agreement beyond the display rules (now read) (§11).
18. The schema.org paywall signal on three news sites (§9).
19. Electron `net.fetch` against Node fetch behind a proxy (§8.2).
20. three.js flat colour and edge alpha against the 2D painter (§9).

---

## 16. Decisions for the user

Each has a recommendation; nothing here reopens a settled licensing or
sourcing question.

1. **The face detector.** MediaPipe was agreed. Measured since:
   - ~100 MB of wheels, from a hard `cv2` + `matplotlib` import;
   - a `cv2` clash with mask tracking's planned package;
   - a whole-process abort on a Mac without Metal;
   - short-range faces only (full range unmeasured).

   YuNet is 0.23 MB on the installed onnxruntime and ran at ~10 ms a frame
   on random input, with accuracy unmeasured; on onnxruntime it needs a
   hand-written prior decoder and NMS (half a day, golden-tested against
   `cv2.FaceDetectorYN` once in a scratch venv), and 1a compares it through
   that decoder. **Recommendation:** run 1a's comparison on your
   ten clips (one day) and pick by recall on small faces and survival. My
   lean is YuNet unless MediaPipe is clearly better, because it adds nothing
   to install and cannot take the helper down.
2. **Per-shot crops as one followed clip** (recommended: one decoder, a
   clean timeline, it re-solves on an aspect change) **or split at each cut**
   (works today and is measured, but 40 pieces for a podcast, +21 % export
   at 30 shots, and a seek per cut in the preview). And within the
   recommendation: **the crop compiled from the subject track every time it
   is read** (recommended: speed, ramp, frame-rate, trim and split edits are
   right by construction) or keys stored on the clip and re-derived inside
   each of those edits (a list the next edit forgets).
3. **Two people too far apart for one crop.** v1 frames the nearer face with
   a note. A stacked two-up (both faces, one above the other, as podcast
   clips do) on the grid's rails: in step 1 (+2 days) or later?
4. **Florence-2's route.** Python ORT with a hand-written loop
   (recommended: same process, same download path), or Transformers.js in
   main. And: is BiRefNet's salient box enough for unnamed subjects, with
   Florence only for a typed phrase (recommended until 1g's gate)?
5. **A face fixture for the tests.** You record ten seconds of yourself
   (recommended: rights-clean, and a real face), or a PD/CC0 Commons clip.
6. **Homes in the window.**
   - Best clips: inside the URL tile (agreed).
   - Graphics: a section of the Transcript tile, plus Clip it and Direct
     (recommended), or a new Shelf tile, which changes sheet 20's order.
   - B-roll: the same question.
   - Sheet 13's "set 5 / set 10" placements later, or now?
7. **Graphics above the look (ungraded, like cards; recommended) or under
   it.**
8. **Naming.** The new `GraphicSpec`, with the old `GraphicsSpec` renamed
   `CaptionLayersSpec` (recommended; it is 36 sites, mechanical).
9. **One `SELF_DRAWN_FIELDS` constant** that every guard reads, so the next
   kind is a one-line change, with membership tests kept per site
   (recommended, done in 3a), or the spelled-out lists as today.
10. **Which graphics a Clear removes.** Direct's join `DIRECTOR_RULES`; Clip
    it's and the Transcript tile's have their own Clear (recommended).
11. **Validator strictness.**
    - The stretch: the cited sentence ±1 (recommended).
    - Hindi and Telugu number words: not parsed in v1, so such graphics are
      dropped (the safe direction).
    - Function-word lists for Hindi and Telugu: none in v1, so every token
      is checked.
    - Binding: a label within 8 tokens of its value in the same sentence,
      pairs in spoken order, and a negator in the bound clause drops the
      graphic (recommended; `BIND_WINDOW` set by the eval).
    - Telugu negation is mostly a verb ending: a clause with a collected
      negative ending counts as negated in v1, measured on the Telugu
      fixtures (recommended), or Telugu graphics limited to verbatim quotes
      until it is.
12. **The URL transcript.** `-orig` timing with the uploader's text where
    both exist (recommended); Whisper on the download when neither exists.
13. **Clip it from a link: the exact cut or the fast one.** Open until the
    exact cut's first frame is cross-correlated against its source (§15
    row 14): only its container start (0.000) was measured, and the 2018
    Windows build has never run under yt-dlp's section cut. Lean: exact, if
    it measures frame-exact on both builds.
14. **Keys in settings.json.** The Brave key goes into `safeStorage`
    regardless (it is backed by your card, §9). The rest stay plaintext like
    the Director's and the voice's (recommended for now), or all move to
    `safeStorage` together.
15. **The share-alike switch** is a main-owned setting, and **Wikipedia
    extracts sit behind it too** (recommended: they are CC BY-SA 4.0 text,
    and a trimmed extract is a modification). Each BY-SA file is badged and
    explained at its own click whatever the switch says.
16. **Brave Search.** Its terms forbid storing results beyond transient
    storage, deriving from and redistributing them, and using them to
    create, evaluate or train AI models. It costs $5 per 1,000 searches
    after $5 of free credit a month, charged to the card it needs at sign-up.
    **Recommendation:** use it only to find URLs, and quote the fetched page;
    a hard cap of 900 searches a month, shown in Settings, so it never
    costs you anything; no Brave fixtures and no eval over its results. No
    card shows Brave's own snippets or results unless you read the Terms' §3
    and decide otherwise.
17. **News.** Google News RSS is ruled out by its own terms. Headline cards
    come from a pasted article link (recommended for v1); find a feed with
    acceptable terms later? **And a change from what was agreed**: the
    direction said "the newspaper clipping tool fits". The review found that
    a real outlet's name as a print masthead is a mock-up of a page that
    never existed, and that `og:title` can carry a byline the headline does
    not (measured). Recommended: a plain web-article card (headline,
    "site · domain · date", "Opinion" when it is one), and the clipping
    kept for the user's own playful headlines.
18. **X post cards.** X's own embed captured from a hidden window (agreed;
    capture to be measured). **X's display rules are now read**, and they
    remove the fallback: our own card would break the logo, avatar and
    no-mock-up rules, and oEmbed carries no avatar. So: if capture does not
    work, there is no X card in v1. The post is always shown whole, and X
    cards are refused in Director ads (X forbids using posts to promote
    without the author's permission). The post author's rights are yours to
    clear.
19. **Page cards** as our own graphic (recommended, consistent with the
    headline rule), or a screenshot of the page (it would carry the outlet's
    photos and layout).
20. **How credits reach the viewer.** Copy for the description, with
    EXPORT's Done line saying "N credits required — Copy" until you copy
    them, and `credits.txt` as a record (default); an on-screen credit line
    as an option?
21. **Thumbnails.** Pressing Search is consent for the thumbnails
    (recommended); every full file is its own click.
22. **The network stack.** Move the new fetchers (and later the old ones)
    to Electron's `net.fetch` for the system proxy (recommended once 15 is
    measured).
23. **The contact address** in the User-Agent Wikimedia asks for.
24. **The old parallax bakes** in `~/.cache/forge/parallax` (264 MB):
    migrate into `userData/cache`, delete on first run, or leave them.
25. **Two edits to `BETA.md`**, made when you say yes: §3.2–3.4 (the split
    click, the frozen or slowed zoom, the late held key) move into R2 as
    beta blockers, since they are bugs in what ships today; and R4's "Not
    for the beta" is replaced by the full route as Step P (§3a), matching
    `SHEETS.md:806-809`. Recommended: both.
26. **M0: Transcript → Clip it first** (about 2 days, moved forward, not
    added): row selection, `clipToRange` and `timelineFrameAt`, ahead of
    step 1, since you called it the most important feature and it needs no
    Python where a transcript exists. Recommended; the agreed order stands
    if you decline.
27. **The order against the beta**: beta R1–R12 → M0 → M1 (shipped only
    with Step P) → M2 → M3 → beta.2 → M4 → M5 (recommended), or this plan
    before the beta.
28. **Step 7's saved templates** wait for `MARKET.md` Stage 0, or move to
    §17; the creator style may come forward with step 3's styles.
29. **Clip it into a project that already holds an edit**: a new 9:16
    project per clip (recommended), or appended to this one with its aspect
    unchanged. Clip it asks either way and never re-crops the existing edit.
30. **Graphics from Clip it and Direct**: placed and listed with Drop, with
    only those whose number came from a YouTube track or an unsure Whisper
    word held for Keep (recommended), or every graphic held for Keep.
31. **The speaker's name on a quote**: a Speaker field per asset in the
    Transcript tile for your own footage, and yt-dlp's channel for a link
    (recommended), or no names on quotes in v1.

---

## 17. Out of this plan, on purpose

- A per-shot zoom on reframed footage (crop size cannot animate; zoompan on
  video needs step 0's `fps=` fix measured on the 2018 build first).
- Active-speaker detection and cutting to the speaker.
- Mask tracking.
- Speed-aware captions and props: they share §4.7's inverse later, and
  graphics refuse retimed clips until then.
- Storyboard thumbnails on Best clips cards.
- TransNetV2; AutoFlip; `cropdetect`; YOLO.
- Fine-tuning of any kind.
- The template store (`MARKET.md` Stage 2+).
- Two existing leaks found by reading:
  - `forgetPaperPreview` and `forgetCarouselPreview` are never called
    (`Preview.tsx:645-671`);
  - the carousel never disposes a rebuilt scene (`carouselCanvas.ts:128-141`).

  Both are worth a small fix of their own; neither blocks this plan.

---

## 18. Done means

- The seven bars in §0 met and recorded: the ten reframe clips, the ten
  Best clips links, the graphics eval in `EVAL.md`, a real B-roll session,
  Clip it on the Surface without swapping.
- Step P's exit met before any Python half shipped in an installer, and
  `BETA.md` R2 and R4 edited as decision §16.25 says.
- Every row of §14 has a rendered output in `tests/output/` and a test.
- Every "dated" row of §13 has become "in CI" on the Windows build.
- Every regression test above has had its bug put back and failed.
- Every measurement in §15 is in `EFFECTS.md` (§37 on), or has changed the
  plan where it disagreed.
- `WHERE-THINGS-ARE.md` has every new control. `LLM.md` §Built records
  `graphics@1`, `broll@1` and the Best clips pass. `SHEETS.md` sheets 13, 14,
  25, 26 and 27 are marked built. This file's steps are marked DONE with
  their commits.
