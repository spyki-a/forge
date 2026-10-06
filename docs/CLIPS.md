# Clips — from a landscape talk to a vertical clip that explains itself: the plan

> **Status, 2026-10-05. Nothing here is built.** This is the plan for the
> piece agreed with the user on 2026-10-04/05: the reframe engine, caption
> free space, the motion-graphics engine with the Director's third pass, Best
> clips, B-roll, retrieved-fact cards with 3D templates, and creator styles,
> in that order, except that M0 (§3b), the transcript → Clip it half of
> Best clips, now comes first, after §3.3's half day (revised below). It follows
> `PLAN.md`'s form. Each step gives what is wrong or
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
> **Revised again after the user ran the MediaPipe test on their own Mac**
> (2026-10-05, §4.1, `EFFECTS.md` §37): it runs where Metal exists, the
> full-range model is accepted and reports a face on 57 of 80 frames where
> the short-range one reports 1 (detections, not checked against marks), and
> the detector recommendation in §16.1 changed with it.
>
> **Revised 2026-10-05 (evening) with the user's answers (§16):** this plan
> before the beta; M0 taken first and redefined as the URL transcript →
> Clip it flow (§3b); MediaPipe full range; the stacked two-up in step 1;
> X cards become the user's own paste-only quote card and the capture
> window is gone; Brave is out; pyautoflip recorded as a baseline. Every
> item in §16 now ends with its answer line, and §2's days are recomputed
> with each delta named. The stacked two-up's filter shape was measured on
> the Mac's 4.4 build for this revision (§4.7); nothing else new was run.
> A review of that revision re-ran the two-up (its rawvideo-versus-FFV1
> caveat is now in §4.7 and `EFFECTS.md` §38) and re-fetched pyautoflip's
> PyPI metadata, which caps it below Python 3.14 and lists torch among its
> requirements (§4.1); the fixer repeated both.
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
  Every retrieved-fact card quotes something that was fetched and carries
  its source; a social quote card carries only what the user typed, with
  its attribution line (§8.4).
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
| URL ingest | `buildYtDlpArgs` (`shared/ingest/args.ts:117-226`), `downloadMedia` (`src/main/ingest/download.ts`), `section.ts` (`PAD_MS` 10 s `:52`, `offsetIntoDownload` `:97`), `collectIngest` (`store.ts:4662-4747`, one undo), `IngestPanel.tsx` (its "Just a part of it" From/To fields, `:234-274`) | M0's transcript and Clip it's ranged download (§3b), which Best clips reuses |
| keys | the Director's write-only path: `setDirectorSettings` (`src/main/director.ts:61-84`), `publicConfig` → `hasKey` (`director/provider.ts:82-98`), the IPC whitelist (`ipc.ts:830-848`), `redactKey` (`shared/voice/provider.ts:190`). Settings' "coming with Narration" rows (`SettingsPanel.tsx:276-280`) | the Pexels key |
| consent | packs: the button is the ask, `Get · 57 MB` (`shared/assets/pack.ts:367`); the renderer picks an id and main picks the URL (`ipc.ts:588-601`) | the B-roll download flow |
| the paste fix | `ed7ff0f`: a pasted self-drawn clip gets its own asset record (`edit/recipes.ts:277-284`) | a new self-drawn kind inherits it through `drawsItself` |

**What bounds the design:**

- **Two ffmpegs, and the scene score is computed differently on each.**
  Measured on the Mac and read in the 2018 source (§4.2). Every analysis
  filter also goes into `tests/oldestFfmpeg.test.ts`.
- **Installed users have no Python** (BETA R4; `service.ts:26-35`;
  `electron-builder.yml` excludes `.venv`). Every capability must degrade.
  Scene cuts, M0's transcript → Clip it and Best clips over YouTube's own
  captions, graphics and captions
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
  denied`), and the macOS MediaPipe wheel aborts there with no Metal device
  (on the user's own Mac it ran: §4.1). Those measurements are the user's to
  run, on their own machine (§15).

---

## 2. The order, and the days

| step | what | days | needs | proves |
|---|---|---|---|---|
| **0** | the ground: R5's rotation-aware probe, held keys landing on their frame, `adelay` in samples, zoom keys on video, **the graph in a file**, the floor list, the helper's shared media code | 4.5 | — | the measured bugs under every later step are gone, the three shipping ones (§3.2–3.4) first |
| **M0** (§3b) | **the URL transcript → Clip it**: the link's own captions (no media, no model), rows of time and text, a run picked by click and shift-click or by two cut handles, chapter chips, the exact ranged download of exactly that run with its words and the link's credit, Add another clip; the start/end fields kept for a video with no captions; the timeline half (`clipToRange`, `timelineFrameAt`) | 7.5, **moved** from step 4 | §3.3 only (pulled ahead of it); the rest of step 0 follows | sheets 25–26: a link becomes the clip the user picked by its words, with no Python |
| **P** (§3a) | **BETA R4's full route**: the app installs its own Python pack under `userData` | 5–10 (`BETA.md` R4's 5 to 10 days) | — | every Python half below reaches an installed user |
| **1** | the reframe engine: scene cuts in main, faces (MediaPipe), a salient box, Florence-2 grounding, the crop path with the stacked two-up, the followed crop, "Reframe to 9:16" | 17.5 (1g Florence is 3 of them, gated by its own measurement; 18 if the Surface run fails and YuNet's decoder is built) | 0; P for faces on an installed machine | a landscape talk becomes a 9:16 that follows its subject, frame-exact at every cut, and two people too far apart share the frame |
| **2** | caption free space | 2.5 | 1 | captions stay off faces, stable within a shot |
| **3** | the graphics engine (six 2D templates), the graphic style, the Director's third pass with its validator | 14.5 | 2 for placement (degrades to the style's third without it) | a spoken number becomes a counter that lands on the word, and nothing unsaid is ever drawn |
| **4** | Best clips in the URL tile: windows, signals, the model's pick, three cards, Clip it from a card | 3.5 (M0 took 7.5 of its 11) | M0; 1–3 (each optional at run time) | a link becomes three clip cards and a 9:16 clip with captions |
| **5** | B-roll: the Pexels key, the sources, the social quote card, credits, the person rule | 14 | 3 (cards are templates) | pictures arrive licensed, credited, and only by click |
| **6** | retrieved-fact cards (Wikipedia, page, answer-with-sources over fetched text); the 3D templates | 7 | 3, 5 | facts from outside, with their sources; three.js graphics |
| **7** | creator styles and saved templates | 4.5 | 3; **`MARKET.md` Stage 0** (below) | toward `MARKET.md` Stage 1 |

**About 75.5 working days, plus Step P's 5–10: about 80.5–85.5 days,
sixteen to seventeen weeks, honestly counted.**

The arithmetic, so it can be checked. **The first draft's total was 76.5**,
with what the review added: step 0 +0.5 (the graph in a file, §3.7); step 1
+2 (shots' own runner +0.5, YuNet's hand decoder +0.5, the followed crop
compiled at read time +0.5, releasing the helper's sessions +0.5); step 3
+1.5 (the binding validator, negators, fixed titles, the painter's contract,
ASR proposals); step 4 +1.5 (json3 word ends and segment caps, the exact-cut
measurement and its real yt-dlp test, Clip it into its own project); step 5
+1.5 (the person rule from Commons' depicts and the face check, the credits'
licence links and Done line; the Brave row moved to step 6); step 6 +1
(Brave's monthly cap and its key in `safeStorage`; both gone now, below).
**The user's answers (2026-10-05, evening) then moved:**

| delta | from → to | why |
|---|---|---|
| M0 +7.5, step 4 −7.5 | M0 ~2 (moved, never added) → 7.5; step 4 11 → 3.5 | M0 redefined as the URL half of step 4 plus the timeline half, built first (§3b, §16.26). Net 0 |
| step 1 +2 | 16 → 18 | the stacked two-up (§4.6 rule 3, §4.7; §16.3): 1e +0.5, 1f +1, §4.9's checks +0.5 |
| step 1 −0.5 | 18 → 17.5 | MediaPipe decided (§16.1), so YuNet's hand decoder is not built (1c 2.5 → 2) |
| step 5 −2 +0.5 | 15.5 → 14 | the X capture window (2) removed; the social quote card and its Surprise me (0.5) added (§8.4, §16.18) |
| step 6 −1 | 8 → 7 | Brave out: its key, cap and `safeStorage` (1) gone (§9, §16.16) |

1f keeps its first-draft days although M0 now builds `timelineFrameAt`
(§3b.6). The first draft never itemised that share, so it stays in 1f as
slack rather than being moved.

| step | 0 | M0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | **total** |
|---|---|---|---|---|---|---|---|---|---|---|
| before the answers | 4.5 | (2, inside 4) | 16 | 2.5 | 14.5 | 11 | 15.5 | 8 | 4.5 | **76.5** |
| after | 4.5 | 7.5 | 17.5 | 2.5 | 14.5 | 3.5 | 14 | 7 | 4.5 | **75.5** |

76.5 + (7.5 − 7.5) + 2 − 0.5 − 2 + 0.5 − 1 = 75.5. With Step P's 5–10,
80.5–85.5 days.
If the Surface run fails and YuNet's decoder is built after all, add 0.5.

**These dates are conditional on "your part" below**: step 1a cannot run
until its clips and marks exist. With MediaPipe decided, 1a needs the ten
clips with their cut marks and about 100 face marks for the sanity check
(§4.1), not 300.

It is achievable because each step ships on its own. What each milestone
gives **an installed user**, with and without Step P, in the order they are
built:

- **§3.3 comes first (half a day), then M0.** You asked for M0 first. The
  one step-0 item M0 stands on is §3.3: at 30 fps, every clip appended at a
  frame not divisible by 3 starts a third of a millisecond off (16 samples
  at 48 kHz), the rounding §3.3 measured as a click on a split; on an
  appended join the click is unmeasured, so that half-day fix is pulled
  ahead of M0 as its own commit. The rest of step 0 (4 days) follows M0 and
  comes before step 1, which stands on §3.2 and §3.7; so all three shipping
  bugs are still fixed before the beta.
- **M0 (~7.5): the first thing useful with no Python at all.** Paste a link,
  Get transcript, pick a run by its words, Clip it; the clip lands with its
  transcript and the link's credit, and Add another clip repeats it. Needs
  the video's own caption track; a video without one keeps today's start
  and end fields, and with P gets Listen to it. The timeline half works on
  any clip with a transcript (a link's at once; own footage's is Whisper's,
  so Python).
- **M1, steps 1–2 without 1g (~17 days: 14.5 + 2.5):** with P, "Reframe to
  9:16" follows the subject, stacks two people who will not fit one crop,
  and captions dodge faces. **Without P it shows nothing new**: the shots
  are found but every crop is the centre, which is today's `solveCrop`, and
  Smart placement and Follow the subject are greyed with "needs the AI
  helper". So M1 does not reach an installer before P.
- **M2, step 3 (~14.5):** graphics on spoken numbers. Without P: over a
  link's caption track only, and no `callout` (it needs a face box).
- **M3, step 4 (~3.5):** Best clips from a link: three cards, each clipped
  through M0's path. Without P: YouTube's captions, centred crops, captions,
  graphics.
- **M4, step 5 (~14):** B-roll and the social quote card. No Python needed;
  without the helper, the face check that clears a picture of people cannot
  run, so every candidate that might show one asks (§8.6).
- **M5, steps 1g, 6 and 7 (~14.5: 3 + 7 + 4.5).**

4.5 + 7.5 + 17 + 14.5 + 3.5 + 14 + 14.5 = 75.5. Florence-2 (1g) can slip
behind M3 without blocking anything, because the salient box (1d) covers the
no-face shot until then.

**Where this sits against the beta.** You decided (2026-10-05): "will finish
this and will get back to the beta". **This plan comes first**, then
`BETA.md` R1–R12, R13 and R14. So:

- **§3.2–3.4 are beta blockers**, bugs in features that ship today (every
  split clicks, zoom keys freeze or slow a video, held keys land a frame
  late), and `BETA.md`'s "nothing embarrassing" rule covers them. They are
  now listed in `BETA.md` R2 as items 7–9 (edited 2026-10-05, §16.25), and
  they are built here, in step 0, so they are fixed before the beta
  resumes; the days are counted once, here. R5 is shared the same way
  (§3.1), so it too is done before R1 starts.
- **`BETA.md` R4 used to say the full route was "Not for the beta"**, while
  `SHEETS.md:806-809` records your decision that the installed app sets
  Python up itself and that "the beta plan's R4 changes accordingly". R4 now
  points here (edited 2026-10-05, §16.25): the full route is Step P, built
  inside this plan.
- **The order, outright:** §3.3 → M0 → the rest of step 0 → M1, built
  while Step P is built, and shipped only with P → M2 → M3 → M4 → M5 →
  `BETA.md` R1–R12 → R13 → R14 (beta.2). Steps 5–7 (about 25.5 days now) are no longer after the
  beta: they come before it with the rest.
- **Step 7 is gated on `MARKET.md` Stage 0** (`MARKET.md:94-103`): Phase C
  measured and finished (it is paused), and a music library with
  redistribution rights or the `filler-supplies` policy alone for paid
  templates. Until those hold, step 7's saved templates wait (§10).

### Your part — what gates the dates

None of these can be done by the planner or committed from third-party
speech. Asked for on **day 0**, so M0 and step 0 run while they are
collected.

| item | roughly | gates |
|---|---|---|
| ten landscape clips (interview, two-person podcast, speech, product demo, wedding toast, two of each), with a `cuts.json` of hand-marked cut times | 3–4 h | 1a's threshold; step 1's exit |
| face marks: ~100 hand-marked frames (10 per clip) as a sanity check of MediaPipe's boxes, counting false boxes as well as misses (the ~300 for a YuNet comparison are not needed: §16.1 is answered) | ~1 h | 1a's sanity check |
| the detector run on the Surface (the Mac MediaPipe run is done, 2026-10-05, §4.1; neither MediaPipe nor Electron runs in the dev sandbox) | 30 min | 1a, then 1c |
| the face fixture (§16.5): **recorded 2026-10-05**, `references/recordings/face-fixture-2026-10-05.mov`, 26.6 s (`REFERENCES.md`) | done | 1c's integration tests |
| the Florence-2 int8 download (275 MB) and its timing on the Mac and the Surface | 1 h | 1g's gate |
| pyautoflip run on the ten clips on your Mac (a scratch venv on Python 3.13 or older, since it refuses 3.14, with an ffmpeg on `PATH`; its MediaPipe would likely abort in the dev sandbox as the face detector did, §4.1 — unmeasured), and its output rated beside ours (§4.1) | ~1 h | step 1's exit |
| the helper's peak memory per capability on the Surface (§12.1) | 1 h | the floor-machine bar |
| ten graphics fixtures with truth labels (six English, two Telugu, two Hindi), your own speech or text you wrote | 4–6 h | step 3's eval and exit |
| three YouTube videos for ASR timing against Whisper, and three with unpunctuated ASR tracks (one Hindi or Telugu) | 1 h | §7.2: the unpunctuated three inside M0, the timing three by step 4's exit |
| ten links for M0 (talks and podcasts, two in Hindi or Telugu, at least one with no caption track), each with a run you select and clip | 1 h | M0's exit (§3b) |
| ten Best clips links, and rating their cards | 3 h | step 4's exit |
| the exact-cut measurement on the Surface, if CI cannot run yt-dlp (§7.1) | 30 min | §16.13, inside M0 |
| reading Pexels' licence and API guidelines in a browser (Cloudflare blocks the sandbox) | 30 min | 8.3 |
| signing up for Pexels (free) | 10 min | 8.3 |
| Clip it end to end on the Surface | 1 h | step 4's exit, the floor-machine bar |

**About 19–22 hours in all, spread over the plan.** Against the first
draft's 19–22 on the recommended route: the X developer agreement (30 min),
Brave's Terms §3 (30 min), Brave's sign-up (10 of the 20 min) and the X
capture measurement (1 h) are gone, −2.2 h; pyautoflip's run and rating
(~1 h) and M0's ten links (1 h, which M0's new exit bar needs) are added,
+2 h. The first six rows are needed before step 1 can finish; M1's date
moves with them.

Every step ends the same way: typecheck green; the full suite green (output
written to a file, `$?` checked; `CLAUDE.md`); the render check's output in
`tests/output/<check>/` looked at; the listed mutations killed; CI read at
github.com/spyki-a/forge/actions; `WHERE-THINGS-ARE.md` and the UI census
updated for every new control.

---

## 3. Step 0 — The ground under it · 4.5 days

**Order (2026-10-05):** §3.3 is built first of all, before M0 (§3b), as its
own commit; the other six items follow M0 and come before step 1.

Six measured bugs and three pieces of plumbing that every later step stands
on. Each is small and ships on its own commit. **§3.2–3.4 are bugs in what
ships today, and are listed in `BETA.md` R2 as items 7–9** (§2, edited
2026-10-05); they are written and built here, first, because the reframe
and M0 stand on them and this plan now runs before the beta.

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

> **Built 2026-10-05** — `src/shared/render/plan.ts` (the audio chain emits
> `adelay=${n}S|…`, n = round(start/fps × `settings.sampleRate`)), the render
> check `tests/integration/audioSplit.int.test.ts` (into
> `tests/output/audio-split/`, both channels, against the tone unsplit),
> `tests/render.test.ts` and `tests/oldestFfmpeg.test.ts` (every delay in
> every shape in samples). Measured through `buildRenderPlan` with a
> half-scale tone: the 30 fps frame-47 spike **0.172 before, 0.00128 after**
> (unsplit 0.00128). After review the check cuts at 30 fps frames 47, 62 and
> 73, where whole ms, `Math.ceil` and `Math.floor` each click (0.172, 0.322,
> 0.319: the float lands a hair either side of the sample) and round does
> not. **Exact only while a frame is a whole number of samples**, which every
> offered rate is at 48 kHz, pinned by a test. At 29.97 a split at frames 47
> and 96 still leaves a one-sample hole (0.21), so that rate is out of the
> check; it cannot be chosen today. Corrections to the text below, read from
> the sources: the `S` form is `b5314333de` (2016-08-11) — `7748f395de` is a
> vf_select commit whose tree was read; at the Windows build's `f22fcd4` the
> line is `av_sscanf`; fractional ms an hour in is off by about 6 + 8
> samples, derived. The 2018 build is the next Windows CI run. `EFFECTS.md`
> §39.

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
  that. The old 264 MB stays where it is (your decision, §16.24); nothing
  in step 0 reads or removes it.

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
`BETA.md` R4 called the full route "later" and "Not for the beta"; you
decided otherwise (`SHEETS.md:806-809`), R4 now points here (edited
2026-10-05, §16.25), and this step is that decision, scheduled.

**What it is**, as `BETA.md` R4 sketches it: a Python pack the app installs
under `userData` (300 MB or more, 5 to 10 days by that estimate), from
`requirements.txt` plus the optional files this plan adds (§12). Its own
download button with its size (§0's click rule), its own progress, a
version, and a repair path.

**Its details are written here when the step begins**, since `BETA.md` R4
now points to this section (§16.25). This plan holds the bar now: **no step's Python half is shipped
in an installer until P is in it**, and every Python control is greyed with
"needs the AI helper" before then, never offered as a control that changes
nothing (§12).

**Exit.** A clean Mac and the Surface, with no Python of their own, install
the pack from the app and pass the twelve helper tests from inside it.

---

## 3b. M0 — Transcript → Clip it · 7.5 days (moved from step 4; built first, after §3.3's half day)

**What it is.** Sheets 25 and 26 (`SHEETS.md:682-722`) as you described
them on 2026-10-05: "get the transcript using same ytdlp transcript only and
then the same will appear on UI so the user will select text or like a
trimmer start and end togglers at the time stamps so we only take those time
stamps and as usual we download those clips only". In the URL tile: paste a
link, **Get transcript**, and the panel shows rows of `time | text`. You
pick a run of words, by click and shift-click or by dragging a **start** and
an **end** cut handle along the rows, and **Clip it** downloads exactly that
run's span, with its words and the link's credit. **Add another clip** keeps
the transcript on screen and does it again. Chapter chips pick a chapter's
rows. The start and end fields of sheet 12 stay, for a video with no
captions. The timeline half (sheet 26 on your own footage) is §7.6's,
moved here unchanged.

**Why first.** You called sheet 26 "the most important feature … first among
the three" (`SHEETS.md:715-717`), and none of it needs Python: the
transcript is YouTube's own caption track, fetched by yt-dlp with no media,
no key and no model. It needs nothing from steps 1–3. It is built **first**,
as you asked, with one piece of step 0 pulled ahead of it: §3.3's half day,
because a clip appended at 30 fps on a frame not divisible by 3 starts at a
fractional millisecond, which §3.3's rounding moves by a third of a
millisecond (measured there as a click on a split; on an appended join,
unmeasured). The rest of step 0 follows M0.

**The days, from the sub-estimates of the step they came from:**

| piece | days | written in |
|---|---|---|
| metadata and the captions runner in main, `ingest:meta` / `ingest:captions` with their marks, `removePartials` fixed | 1 | §7.1 |
| json3 → `Transcript` (the word-end cap, the danda, the segment caps), `shiftTranscript`, and the three-track measurement before the parser is final | 1.5 | §7.2 |
| the rows, the two cut handles, the run's duration, the chapter chips | 1.5 | below |
| Clip it: the exact ranged download, collect with the shifted transcript and the link's credit in one undo, Add another clip, the time-field rule, the no-caption notice and Listen to it | 1 | below |
| the timeline half: row selection in the Transcript tile, `clipToRange`, `placeAssetRange`, `timelineFrameAt` | 1.5 | §7.6, moved here |
| tests and render checks, the exact cut's cross-correlation with the real yt-dlp included | 1 | §7.7 |
| **M0** | **7.5** | step 4: 11 → 3.5 |

The first draft's M0 was "~2" for the timeline half alone, row component
included. That row component is now built once for both tiles, on the rows
line above, so the timeline half is 1.5 here. Step 4's 11 days were never
itemised; this is the split, and step 4 keeps Best clips proper (§7).

### 3b.1 (a) Get transcript — §7.1 and §7.2, built here

- **Metadata first**: `buildMetaArgs(url)` (§7.1's measured subset, 1.68 s
  live): title, duration, language, chapters, heatmap, and `channel`,
  `uploader` and `webpage_url`, which were **not yet printed in a
  measurement**; that print is M0's first task (§15 row 15).
- **Captions only**: `buildCaptionArgs(url, keys, dir, key)`, §7.1's
  measured shape (`--skip-download --no-simulate --write-subs
  --write-auto-subs --sub-langs <explicit keys> --sub-format json3`, the
  `after_video` print). Keyless, no media, no model. Explicit language keys,
  never `.*`: a regex pulls auto-translated tracks (measured).
- **Parsed** by `parseJson3` (§7.2): word starts from `tStartMs +
  tOffsetMs`, word ends estimated (json3 has none), confidence `null`, the
  danda, segments capped at 30 words or 15 s. **The three unpunctuated
  tracks are segmented before the parser is final** (§7.2).
- **Which track**: `-orig` timing with the uploader's text where both exist
  (§16.12, taken as recommended).
- The URL transcript lives in the renderer's `urlSource` slice, with main's
  caption file kept under `userData/url/<linkKey>/` as the reload cache
  (§7.2).

### 3b.2 (b) The rows, and the two ways to pick a run

`src/renderer/src/components/tools/TranscriptRows.tsx`, **one component for
both tiles** (the URL tile's transcript, and a timeline clip's in the
Transcript tile). A row is a capped segment (`capSegments(t.segments, 30,
15000)`, §7.2): its start as `m:ss`, then its words. A run is a **word**
range, so both ways of picking set the same thing:

- **click and shift-click**: a click picks a row's words; a shift-click on
  another row extends the run to cover it; a shift-click on a word extends
  the run to that word;
- **the cut handles** (sheet 26's "cut ↕", your "trimmer start and end
  togglers at the time stamps"): a **Start** and an **End** handle in the
  rows' gutter, dragged along the rows. Start snaps to a word's start, End
  to a word's end, and neither passes the other.

Under the rows, the run's span and length: "0:42 selected".

```ts
// src/shared/edit/wordRun.ts — pure
export interface WordRun { from: number; to: number }                 // word indices of one Transcript, inclusive
export function rowsOf(t: Transcript): { startMs: number; words: [number, number]; text: string }[]   // over capSegments(t.segments, 30, 15000)
export function runFromRows(t: Transcript, a: number, b: number): WordRun   // click a row, shift-click another
export function extendRun(run: WordRun, word: number): WordRun             // shift-click a word
export function snapHandle(t: Transcript, which: 'start' | 'end', ms: number, run: WordRun): WordRun   // Start → a word's start, End → a word's end, clamped so from ≤ to
export function runOfChapter(t: Transcript, ch: { start_time: number; end_time: number }): WordRun | null   // seconds, as yt-dlp prints them; words whose START lies in [start, end)
export function runRange(t: Transcript, run: WordRun): { startMs: number; endMs: number }
//  first word's start → last word's end as §7.2 estimates it, which never reaches the next word's start;
//  extended to MIN_RANGE_MS (1 s) when shorter — the media only; the collected transcript keeps exactly the run's words (§3b.4) —
//  which moves to section.ts from IngestPanel.tsx:36; sectionPlan reads a zero-length range as the whole video
```

### 3b.3 (c) Chapter chips

From the metadata's `chapters` (`[{start_time, end_time, title}]`, 12 on the
test video, §7.1). A chip picks `runOfChapter`, the rows inside it, so a
chapter is clipped by the same Clip it ("anyway we have the chapter
downloader as we get the metadata of the video"). On a video with no
captions a chip sets the start and end fields instead
(`setIngest({useRange, startMs, endMs})`).

### 3b.4 (d) Clip it, and (e) Add another clip

- **The download is the existing ranged one**: `startIngest` with a request
  override `{range: runRange(…), exact}` (`store.ts:1060-1090` takes only
  `get().ingest` today), so `sectionPlan` (`section.ts:59`) emits
  `--download-sections` with `--force-keyframes-at-cuts` for an exact cut
  (`section.ts:72-74`) through our ffmpeg (`--ffmpeg-location`,
  `args.ts:156`). The exact/fast toggle stays. Today it defaults to fast
  (`store.ts:1055`, `exact: false`). Clip it from a run defaults to exact,
  as §16.13 leans, through its request override, and the plain ranged
  ingest keeps its fast default. §16.13 stays **open until the exact cut
  is cross-correlated** (§7.1; this step's exit). If that measurement
  refuses the exact cut on either build, Clip it's default becomes fast,
  with `offsetIntoDownload` as its head offset.
- **Collect** (§7.5 step 2, built here): `pendingIngests[jobId]` gains
  `transcriptFrom: {linkKey, captionPath, range, run}`, and `collectIngest`
  writes `project.transcripts[asset.id] = shiftTranscript(…)` (head offset 0
  for an exact cut, `offsetIntoDownload(range)` for a fast one, `section.ts:97`),
  and `shiftTranscript` keeps exactly words `run.from..run.to`, so a run
  extended to `MIN_RANGE_MS` collects no neighbour; and it writes
  `asset.credit` of source `'link'`, `"<title> — <channel>,
  <webpage_url>"` (§8.5), inside its begin/commit (`store.ts:4691-4723`).
  **One undo step: asset, clip, trim, transcript, credit.** If the
  `urlSource` slice is gone (a Cmd+R mid-download), collect re-parses the
  caption file at `captionPath` rather than landing a clip without its
  words. `MediaAsset.credit` and the `AssetCredit` type (§8.3) arrive here,
  with source `'link'` only; step 5 adds the rest. Until step 5's Credits
  block, the credit shows in the pool tile's tooltip (`MediaPool.tsx:219`).
- **Where it lands**: as today's ingest places a clip, in this project, the
  aspect unchanged. The new-project question of §7.5 step 0 comes with step
  4's cards, three separate shorts, where it is needed (§16.29).
- **Add another clip** keeps the transcript on screen, clears the run, and
  lets the next one be picked. **One job per range**: several
  `--download-sections` in one job all write `<stem>.%(ext)s` (measured in
  simulate, §7.1), and `takeLine` keeps only the last mark
  (`download.ts:240`). The `downloads`
  queue runs two at a time (`ipc.ts:207`), and each job collects with its own
  shifted transcript.

### 3b.5 (f) The start and end fields stay, and (g) captions at once

- **The fields of sheet 12 are not removed** ("Just a part of it", From and
  To, `IngestPanel.tsx:234-274`). With a caption track loaded they **mirror
  the picked run, read-only**, with "set by the words you picked", so the
  numbers are there for whoever wants them. With no caption track they are
  how a range is set, exactly as today.
- **A video with no caption track says so**: "This video has no captions".
  It offers **Listen to it · downloads the audio (~N MB) and the speech model
  (464 MB, first time)**, N from the metadata's duration and the audio
  format's bitrate (§7.5's button, built here): an audio-only download that
  is not placed, transcribed by path (the reel's `lyrics:` precedent,
  `store.ts:2112`), whose words then fill the rows. **Without the AI helper
  the button is greyed with "needs the AI helper"**, which is every
  installed machine until Step P (§3a, §12).
- **Captions at once.** The clip's transcript is YouTube's, so no Python is
  needed: Clip it's done row offers **Captions on**, which switches the
  project's captions on over it in the current style.
- **No reframe and no graphics in M0.** They attach to Clip it as steps 1–3
  land (§7.5 steps 3–5), and Best clips' cards (step 4) clip through this
  same path.

### 3b.6 (h) The timeline half — §7.6, moved here

`TranscriptPanel.tsx` takes `TranscriptRows` with the same selection: click
and shift-click, and the handles. **Clip it** on a timeline clip is
`clipToRange(project, clipId, startMs, endMs)` in `src/shared/edit/clipIt.ts`,
pure: the clip's in-point and duration are trimmed to the run, mapped with
`timelineFrameAt` (built here, a binary search over the monotone
`sourceFrameFor`; 1f reuses it, §4.7), so speed is honoured.
TranscriptPanel's own mapping ignores speed (`:32-47`); it moves onto the
same function. For an asset not yet on the timeline, `placeAssetRange(assetId,
startMs, endMs)` (begin → `addAssetToTimeline` → set in-point and duration →
commit, beside `trimToRequestedRange`, `section.ts:116-131`).

### 3b.7 Files

- `src/shared/ingest/args.ts`, `src/main/ingest/meta.ts`, the IPC and
  `removePartials` (§7.1); `src/shared/ingest/captions.ts` and
  `src/shared/transcript.ts`'s danda, optional cap and `capSegments` (§7.2).
- New: `src/shared/edit/wordRun.ts`, `src/shared/edit/clipIt.ts`,
  `src/renderer/src/components/tools/TranscriptRows.tsx`,
  `src/renderer/src/harness/clipItCheck.ts`.
- `src/shared/ingest/section.ts` gains `MIN_RANGE_MS` (from
  `IngestPanel.tsx:36`); `src/shared/timeline.ts` gains `timelineFrameAt`
  and `MediaAsset.credit`.
- `IngestPanel.tsx`: Get transcript, the rows, the chips, Clip it, Add
  another clip, the time-field rule, the notice, Listen to it.
  `TranscriptPanel.tsx`: the rows and Clip it.
- The store: the `urlSource` slice; `getTranscript`, `clipItFromLink(run)`,
  `addAnotherClip()`, `listenToLink()`; `startIngest`'s request override;
  `pendingIngests[jobId].transcriptFrom`; `collectIngest`'s transcript and
  credit; `placeAssetRange`.
- Preload and `harness/bridge.ts`: `ingestMeta`, `ingestCaptions`, with
  deterministic stubs.

### 3b.8 Tests, render check, harness, census

- **§7.7's transcript and Clip it tests land here, with their mutations**:
  `tests/ingestArgs.test.ts`, `tests/ingestCaptions.test.ts`,
  `tests/integration/ingestCaptions.int.test.ts`,
  `tests/integration/exactCut.int.test.ts` (the real yt-dlp),
  `tests/clipIt.test.ts` (its `clipToRange` and `placeAssetRange` cases;
  the project-question case comes with step 4), and the render check
  `tests/integration/clipIt.int.test.ts`.
- `tests/wordRun.test.ts`:
  - **click and shift-click, and the handles, over the same words give the
    same run and the same range** (a property over random runs on random
    transcripts);
  - Start snaps to a word's start and End to a word's end; neither passes
    the other;
  - a chapter picks exactly the words whose start lies in `[start, end)`:
    the fixture has a word starting exactly at `start_time` (picked) and
    one exactly at `end_time` (not);
  - the range never reaches the next unpicked word's start unless the run
    is under `MIN_RANGE_MS`; such a run is extended to it, and its
    collected transcript still holds only the run's words.

  Mutations, each failing its own case: the chapter's end inclusive (the
  `end_time` word is picked); the range's end padded past the next word's
  start; the handles snapping to rows instead of words (the word-level case
  fails); `shiftTranscript` filtering by range instead of run (the one-word
  run's clip gains its neighbour).
- `tests/clipIt.test.ts` gains:
  - **Add another clip starts one job per range**, each argv holding
    exactly one `--download-sections` (counted with `filter`, not
    `indexOf`). Mutation: two ranges batched into one job;
  - collect with `transcriptFrom` writes the asset, clip, transcript and
    credit **in one undo step**: one undo removes all four (membership over
    what the undo removes). Mutation: the transcript written in a second
    `update()`;
  - the credit is source `'link'` with the channel and `webpage_url`.
    Mutation: the credit dropped.
- `tests/renderer/ingestPanel.test.tsx` (component):
  - with a caption track, From and To are read-only and equal the run's
    range, and stay equal when the run changes;
  - with none, they are editable as today, "This video has no captions"
    shows, and Listen to it is greyed with "needs the AI helper" when the
    bridge reports no helper;
  - Add another clip keeps the rows and clears the run;
  - Get transcript failing (the bridge's `ingestCaptions` rejects, offline)
    says so, and From and To stay editable as today.

  Mutations: the fields left editable with a transcript (a typed value then
  differs from the run); Add another clip clearing the transcript; Listen
  to it enabled without the helper; the fields left read-only after a
  failed fetch.
- **The render check** is §7.7's `clipIt.int.test.ts`, into
  `tests/output/clipit/`: a local lossless clip with a synthetic
  transcript, "downloaded" as an exact range by the fake yt-dlp, collected
  with its shifted transcript, exported with captions. **Each caption
  line's first frame is within one frame of its word**, read by the
  caption's appearance. Mutation: the shift off by the range's start.
  **And the exact cut itself** is `exactCut.int.test.ts` with the real
  yt-dlp over a localhost server, in Windows CI (§7.7).
- **Harness check** `harness/clipItCheck.ts` (`window.__forgeClipItCheck`):
  the bridge stubs `ingestMeta` and `ingestCaptions` (12 rows, three
  chapters). The check picks rows 3–5 by click and shift-click and reads the
  range; clears; drags the handles to the same words and expects the same
  range; presses a chapter chip and expects its rows; presses Clip it and
  sees the stubbed job's request carry exactly that range; presses Add
  another clip and sees the rows kept and the run cleared, picks rows 8–9,
  presses Clip it, and sees a second job whose argv holds only that range
  (one `--download-sections`, counted with `filter`); then the no-caption stub shows the
  editable fields, the notice and Listen to it greyed. Then the Transcript
  tile: rows picked on a timeline clip at speed 2, Clip it, the clip's
  in-point and duration as `clipToRange` says.
- **Census rows** (`tests/fixtures/ui-census.json`, each with its `needs`
  recipe): "Get transcript", "Start", "End", "selected", a chapter chip,
  "Clip it", "Add another clip", "set by the words you picked", "This video
  has no captions", "Listen to it", "needs the AI helper", "Captions on",
  and the Transcript tile's row-selection hint.

### 3b.9 Exit

- **Ten links you choose** (talks and podcasts, two in Hindi or Telugu, at
  least one with no caption track): on every link with captions, the run
  you picked lands as a clip whose words begin with the run's first word and
  end with its last, nothing outside it, with captions on; Add another clip
  on one link gives a second clip with its own words; **the no-caption link
  shows the start and end fields, "This video has no captions" and Listen
  to it** (greyed without the helper).
- The render check: captions within one frame of their word on the exact
  cut, on both builds.
- The exact cut's first frame cross-correlated against its source
  (`exactCut.int.test.ts` in CI, or the Surface, §15 row 14), and §16.13
  decided on that number.
- The three unpunctuated tracks segmented and the grapheme estimate set
  (§7.2, §15 row 13), and the metadata subset's `channel` and `webpage_url`
  printed (§15 row 15).
- Typecheck green, the suite green (written to a file, `$?` checked), the
  mutations killed, CI read, `WHERE-THINGS-ARE.md` and the census updated.

---

## 4. Step 1 — The reframe engine · 17.5 days (1a 1 · 1b 1.5 · 1c 2 · 1d 0.5 · 1e 2.5 · 1f 4.5 · 1g 3 · releasing the helper's sessions 0.5 · §4.9's checks 2; the stacked two-up is +2 of it, in 1e, 1f and the checks; 18 if the Surface run fails and YuNet's decoder is built)

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
   solver**: one crop size per clip, with the free axis keyed (§4.7). Two
   people too far apart for one box get a **stacked two-up**: two
   half-height boxes, one face each, one above the other (§4.6 rule 3).

**Not Google's MediaPipe AutoFlip** (a C++ graph; Google ships no wheel for
it). **Not `pyautoflip` either**, though it exists: a community Python
reimplementation on PyPI, which writes a rendered video file rather than a
crop path the timeline can hold. It is run once in 1a as a baseline to
compare ours against, never shipped (§4.1, §17). **Not `cropdetect`** (black
bars only).

### 4.1 1a — Measure first · 1 day

Two things the plan cannot be finished without. Both are run on the user's
machine, outside the sandbox. Results go to `EFFECTS.md` §37.

**The face detector, on real footage.** The agreed detector is MediaPipe,
and your answer to §16.1 (2026-10-05, "media pipe is good") settles it:
the full-range model, installed the stub way, with YuNet as the fallback.
Three costs were measured in the sandbox since that was agreed (the weight,
the `cv2` clash, a process abort) and one question was open (whether the
full-range model is accepted). Then **the user ran the test on their own
Mac** (2026-10-05; an Apple M1 Pro by the renderer line; the measurer's venv
`/tmp/claude-501/mpvenv`, CPython 3.14.6 by its `pyvenv.cfg`, mediapipe
0.10.35 installed `--no-deps`, with empty `cv2` and `matplotlib` (with
`pyplot`) stubs on `PYTHONPATH`; the output itself prints neither version;
`EFFECTS.md` §37):

- **It runs where Metal exists.** The sandbox run had aborted the whole
  process with SIGABRT, exit 134 (`gl_context_nsgl.cc failed to create
  pixel format` → `Check failed: service_`), even with `Delegate.CPU` and
  in IMAGE mode, because the sandbox has no Metal device. On the user's Mac
  it created its GL context through Metal (`GL version: 2.1 (2.1 Metal -
  90.5)`), ran the model on the XNNPACK CPU delegate, and finished. **Still
  unmeasured:** the Surface (no Metal; the Windows wheel), and mediapipe
  1.0.1 (the test ran 0.10.35, whose wheel was small enough to fetch; the
  classifiers stop at 3.12, and 0.10.35 ran on 3.14.6). A process that
  cannot get a Metal device, as inside the dev sandbox on this same M1 Pro,
  loses the whole process; whether a VM or a CI runner is such a machine is
  unmeasured, so the child-process rule in §4.3 stays.
- **The full-range model is accepted, and on this footage it is the one
  that detects.** On 80 frames of `capcut-grid-template.mp4` at 8–16 s
  (source 1180×2556, analysed at 360×778, at a detection threshold of 0.5;
  the faces run from about 15 px to about 94 px in the analysed frame),
  `blaze_face_short_range.tflite` (229,746 B) had a detection on **1 of 80**
  frames at 1.7 ms a frame; `blaze_face_full_range.tflite` (1,083,786 B) had
  one on **57 of 80** at **5.0 ms a frame**. The script prints seven of the
  57 boxes (every ninth, first detection only); the verifier drew them on
  the same decoded frames: six sit on the face at 40–50 px, scores
  0.66–0.88, and one (8.0 s, 38×38, score 0.58) sits on a bridge pillar
  while that frame's ~15 px face is missed. So the counts are detections,
  **neither recall nor precision**: nobody has marked that footage, and
  frame-to-frame box stability was not measured. Its faces are 5–6 % of
  the frame height; landscape interviews can have faces that small (wide
  and two-person shots), so the plan installs the full-range model, and 1a's
  sanity check on the ten clips, counting false boxes as well as misses, is
  where that is confirmed on landscape footage.
- **Speed is not the question.** 5 ms a frame on the Mac, at 360×778 only
  (the plan's 640 px edge is unmeasured), means a 10-minute clip sampled at
  5 fps (3,000 frames) is about 15 s of detection; decoding the same ten
  minutes of 1080p30 is about 20–30 s by §4.2's synthetic measurement, not
  timed in this run. The Surface is unmeasured.
- **Weight.** `mediapipe` 1.0.1 (2026-08-14, Apache-2.0) ships `py3-none`
  wheels (Mac arm64 33.7 MB, win_amd64 20.1 MB; 0.10.35 is 17.8 / 10.9 MB):
  one ctypes library, not a CPython extension. Its package import pulls
  `cv2` and `matplotlib.pyplot` at module top
  (`tasks/python/vision/__init__.py` → `drawing_utils.py:20-21`), so with
  its full dependency list `opencv-contrib-python` (55.7 MB Mac, 53.8 MB
  Windows) and matplotlib (~9.3 MB plus its dependencies) come too: about
  100 MB of wheels, and a `cv2` clash with mask tracking's planned
  `opencv-python-headless` (`PLAN.md:363-366`; opencv's PyPI page says to
  install only one `cv2` package). **The measured run used neither**: three
  empty stub files (`cv2/__init__.py`, `matplotlib/__init__.py`,
  `matplotlib/pyplot.py`) satisfied the import and detection ran. §4.3
  installs it that way.

Measured alongside, as evidence only: **YuNet**
(`opencv/face_detection_yunet`, MIT, 232,589 B ONNX) loads on the venv's
onnxruntime 1.30 CPU and ran at about 10 ms a frame at 640×640 with 4
threads, **on random input**. Its accuracy is **unmeasured**. It needs no pip
addition and uses the same download path as depth. **But its decoder is not
free**: the reference wrapper in that repo is `cv2.FaceDetectorYN`
(`yunet.py:10`, `:22`, read by the review), so on onnxruntime the 2023mar
model's multi-stride cls / obj / bbox / kps outputs need prior decoding and
NMS written by hand in numpy (§4.3). A comparison would run YuNet
**through that hand decoder, not through cv2**; a decode bug would otherwise
look like poor recall. YuNet is OpenCV's own small DNN face model
(published in the OpenCV Zoo as `face_detection_yunet`, not inside the
`cv2` wheel; `cv2.FaceDetectorYN` is its wrapper), so it is "the OpenCV
one" asked about in §16.1. The Haar cascades the `cv2` wheel does ship are
OpenCV's older detector, not considered.

**The comparison is not run** (§16.1 answered 2026-10-05). It is kept here
as the record of what it would have measured, and is what runs if the
Surface run fails and YuNet becomes the detector: both on the user's ten
clips, at 5 fps and a 640 px long side (YuNet through the hand decoder, so
1a would wait on its first half day from 1c), recording five things:

- recall on faces ≥ 40 px and ≥ 20 px tall, against the user's hand marks
  on 30 frames per clip;
- ms per frame on the Mac and the Surface;
- whether the process survives;
- the install weight;
- the import time.

The measurer's script is `/tmp/claude-501/facetest.py`, run with
`PYTHONPATH=/tmp/claude-501/stubs /tmp/claude-501/mpvenv/bin/python
/tmp/claude-501/facetest.py`; the user ran it on 2026-10-05, and the
detection counts, timings and boxes above are its output (the byte and wheel
sizes are the measurer's). That script is Mac-only: it hard-codes the darwin
ffmpeg, the source and a scratch venv under `/tmp`, which is not kept. So
**for the Surface run it is committed as `sidecar/scripts/facetest.py`**,
taking the ffmpeg, the source and the two `.tflite` paths as arguments, with
its venv recipe beside it (§4.3's two pip runs, and the stubs first on
`PYTHONPATH`); the Surface run uses the win32-x64 ffmpeg. **§16.1 took
MediaPipe's full-range model outright**, so the comparison is not run: 1a
keeps the scene-threshold measurement and a sanity check of MediaPipe's
boxes on ten frames per clip (about 100 marks, an hour), counting false
boxes as well as misses, YuNet's decoder is not built (1c is 2 days, not
2.5), and YuNet stays the fallback if the Surface run fails. The rest of
this step is written so that the detector is one module (`faces.py`) behind
one contract (§4.3).

**The scene threshold, on footage with known cuts.** No footage in the repo
has hard cuts. The three reference recordings are continuous takes with
treatments, and the 60 s check is synthetic. The user supplies the ten clips
with a `cuts.json` of hand-marked cut times. Precision and recall are measured
at T = 0.2 / 0.3 / 0.4 / 0.5 on the rgb24 path (§4.2), with the minimum shot
length at 0.3 / 0.5 / 1.0 s.

**The baseline: `pyautoflip`, run once, never shipped.** Google's AutoFlip
has no wheel, but a community Python reimplementation does exist (fetched
2026-10-05 from PyPI's JSON and the GitHub README): `pyautoflip` 0.2.1,
uploaded 2026-03-27 (0.1.0 on 2025-06-23), MIT, 23 stars, by AhmedHisham1
(`github.com/AhmedHisham1/pyautoflip`). It requires Python `>=3.10,<3.14`
(its README says only "3.10+"; PyPI's metadata and its `pyproject.toml`
cap it below 3.14, so the dev venv's CPython 3.14.6 cannot install it).
Its requirements are `opencv-python>=4.11.0.86`, `numpy>=1.24.0`,
`scikit-learn>=1.6.1`, `pillow>=10.0.0`, `tqdm>=4.65.0`,
`scenedetect>=0.6.6`, `insightface>=0.7.3`, `onnxruntime>=1.21.0`,
`mediapipe>=0.10.21`, `tensorboardx>=2.6.4`, `tensorboard>=2.20.0`,
`torchvision>=0.26.0`, `torch>=2.11.0`, `scipy>=1.15.3`,
`scikit-image>=0.25.2` and `matplotlib>=3.10.7` (PyPI JSON for 0.2.1,
re-fetched 2026-10-05 by the review and again by the fixer), and its README
asks for a system FFmpeg. Its API is `reframe_video(input_path, output_path,
target_aspect_ratio="9:16")`, which **writes a video file**. It detects with
InsightFace faces plus MediaPipe objects, or a UNISAL saliency ONNX model;
finds cuts with PySceneDetect; smooths per scene in three classes
(STATIONARY, PANNING, TRACKING); and **splits the screen when its subjects
are too far apart**, which is the precedent for §4.6 rule 3's stacked
two-up. Why it is not used is in §17. What it is used for: in 1a, in a
scratch venv on your Mac (Python 3.13 or older; its MediaPipe is expected
to abort without Metal, as the face detector did; unmeasured), it reframes
the same ten clips once, and at step 1's exit you rate its output beside
ours (§4.10). Both ratings go into `EFFECTS.md`: the question is "is ours
at least as good as the free tool". Its venv is never the helper's, and
nothing of it ships. Its face path downloads InsightFace's pretrained
models, which InsightFace licenses for non-commercial research only (its
README, read 2026-10-05 by the review; the code is MIT). So the run stays a
local one-off: none of its weights, outputs or frames enter the repo, a
fixture or a build, only the two ratings.

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

### 4.3 1c — Faces — `sidecar/forge_sidecar/capabilities/faces.py` · 2 days (2.5 if the YuNet fallback's decoder is built)

Its own module and its own `OPTIONAL` row, `(("vision.faces",), "faces")`.
**Never in `vision.py`**: a missing mediapipe must not take `vision.measure`,
the Director's gate, down with it. And **`faces.py` never imports mediapipe
in the helper**: without the stubs on its path that import fails on `cv2`
(measured). It registers when `importlib.util.find_spec('mediapipe')` finds
the package, and the worker's own import is the real check, reported as
`Unavailable` if it fails.

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
  detector: string                   // 'mediapipe/blaze_face_full_range@0.10.35' | 'yunet/2023mar'
  track: string                      // absolute path: $FORGE_CACHE_DIR/faces/<key>-<params hash>.json
  cached: boolean
}
// the track file: { version: 1, samples: [{ ms, faces: [{ x, y, width, height, score }] }] }
//   normalised 0..1 of the upright frame, 4 dp (depth.py:313-318), ms of SOURCE media
```

The track goes to disk, not over the pipe: 10 minutes at 5 fps is 3,000
samples (`protocol.ts:11-15`). Frames come from `media.iter_frames`, with
progress every 10 frames (`'finding faces'`) and a cancel check per frame.

**MediaPipe, as decided** (§16.1, answered 2026-10-05):

- It runs in a **child process** (`python -m forge_sidecar.workers.mp_faces`)
  that reads the ffmpeg pipe itself and writes the track. `faces.py` relays
  its progress lines and kills it on cancel. A C++ CHECK abort, which is what
  the sandbox measured without Metal, then ends the child, not the helper,
  and `faces.py` reports `Unavailable('the face detector stopped')` with the
  return code it saw (−6, SIGABRT, on macOS, which a shell prints as exit
  134; the Windows code is unmeasured). On the user's Mac it did not abort
  (§4.1); the child costs one process start and one mediapipe import per
  analysis (both unmeasured, §15) and keeps a machine without Metal from
  losing the helper.
- **The model is `blaze_face_full_range.tflite`** (1,083,786 B): the
  short-range one found 1 of 80 frames on the test footage (§4.1). It comes
  from `storage.googleapis.com/mediapipe-models/…`, not Hugging Face, so it
  goes through `media.fetch_url` with a pinned sha256 into
  `models_dir()/mediapipe/`. That is a second host for restricted networks
  to allow, and the Settings line says so.
- **Its requirements are two files, installed in two pip runs, the way the
  measured venv was built** (pip rejects `--no-deps` inside a requirements
  file, in both forms; measured with pip 26.1.2): `sidecar/requirements-faces.txt`
  holds `absl-py==2.5.0`, `flatbuffers==25.12.19`, `certifi==2026.7.22` and
  `sounddevice==0.5.6`, the measured venv's versions, installed normally
  (sounddevice brings cffi 2.1.1 and pycparser 3.0; numpy 2.5.3 is already
  there through faster-whisper, librosa and onnxruntime); then
  `sidecar/requirements-faces-nodeps.txt`, holding only `mediapipe==0.10.35`
  (the version that ran on CPython 3.14.6; 1.0.1 is measured before it is
  pinned), installed with `pip install --no-deps -r`. With `--no-deps`
  mediapipe's own ranges (absl-py~=2.3, sounddevice~=0.5, flatbuffers~=25.9)
  are not checked, which is why the first file pins them. Whether
  `sounddevice` can go is unmeasured. Plus **three empty stub files,
  `cv2/__init__.py`, `matplotlib/__init__.py` and `matplotlib/pyplot.py`**
  (the measured ones are `/tmp/claude-501/stubs`; `drawing_utils.py:20-21`
  imports both `cv2` and `matplotlib.pyplot`), shipped in
  `sidecar/forge_sidecar/stubs/` and put first on `PYTHONPATH` **for the
  worker process only**, so a real `cv2` installed later for mask tracking is
  never shadowed in the helper. That is 17.8 MB (Mac) or 10.9 MB (Windows) of
  mediapipe wheel plus a few small packages; with its full dependency list
  the same 0.10.35 would be about 83 MB (Mac) or 74 MB (Windows), and 1.0.1
  about 99 / 83 MB (33.7 MB on the stub route if 1.0.1 is pinned later). The
  stubs remove the ~65 MB of opencv-contrib-python and matplotlib, and no
  real `cv2` lands, so mask tracking's package has nothing to clash with.
  The stubs are tied to the pinned version: a mediapipe upgrade re-runs the
  import test in §4.9's `faces.int.test.ts`.

**YuNet, the fallback, only if the Surface run fails:** no worker and no new
requirement, but **half a day for its decoder**, built only then (the
comparison is not run, §4.1). It uses
`media.download` from `opencv/face_detection_yunet` at a pinned revision, ORT
`CPUExecutionProvider`, and threads at cpu/2, as depth does
(`depth.py:129-151`). The 2023mar model's outputs are per-stride cls, obj,
bbox and kps maps; `faces.py` decodes them against their priors and runs
NMS in numpy, which `cv2.FaceDetectorYN` does in the reference wrapper.
**The golden test:** `cv2.FaceDetectorYN`'s boxes on the face fixture's
frames, generated once in a scratch venv and committed as JSON (cv2 is never
a dependency); the hand decoder's boxes must match them within 2 px and the
same count per frame. Mutation: a stride's priors off by one cell.

**Either way, the face finder is a download** (1,083,786 B for MediaPipe's
full-range model, 0.23 MB for YuNet): its first use is the press of a button
that says so (§0).

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

### 4.6 1e — The crop path — `src/shared/reframe/path.ts` · 2.5 days (+0.5 for the two-up)

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
  staticShare: 0.9,     // the subject inside the held crop on ≥ 90 % of samples = no pan at all
  twoUpFaceY: 0.4       // a two-up half places its face's centre this far down the half
} as const
export interface ShotCrop {
  startMs: number; endMs: number
  at: number                                       // the held position on the free axis, source px
  pans: { fromMs: number; toMs: number; to: number }[]
  why: 'face' | 'both' | 'two-up' | 'larger' | 'ground' | 'salient' | 'centre'
  /** why 'two-up' only: each half's top-left in source px, `half`-sized; top = the face further left in the source */
  halves?: { top: { x: number; y: number; pans: { fromMs: number; toMs: number; to: number }[] }; bottom: { x: number; y: number; pans: { fromMs: number; toMs: number; to: number }[] } }
}
export interface CropPath {
  axis: 'x' | 'y'                                  // x for landscape → portrait/square; y for portrait → landscape
  size: { width: number; height: number }          // ONE size for the clip: full height (or width) at the target aspect, even, safeCrop'd
  half: { width: number; height: number }          // size.width × even(size.height / 2): each two-up half. 1920×1080 → 9:16: size 608×1080, half 608×540 (≈ 9:8)
  shots: ShotCrop[]
  notes: string[]
}
export function cropPath(track: SubjectTrack, target: Size,
                         follow?: { offsets?: Record<number, number>; halfOffsets?: Record<number, HalfOffsets>; twoUp?: boolean }): CropPath
export interface HalfOffsets { top?: { x: number; y: number }; bottom?: { x: number; y: number } }   // shares of each axis the user dragged
```

**The rules, in order, per shot:**

1. **The size is fixed for the clip.** `w`/`h` cannot animate in the export.
   Measured: `w='608+100*t'` fails with "Error when evaluating the
   expression". So every shot shares one size, `fitRect`'s full height at the
   target aspect through `safeCrop`, and only the free axis moves. A per-shot
   zoom is out (§17). A two-up shot (rule 3) uses `half` for both its crops,
   also one literal size for the clip, and keys y as well as x (§4.7).
2. **Which subject.** The faces in the shot's samples, if ≥ 20 % of samples
   hold one. Otherwise `ground` (a phrase was given and Florence answered),
   then `salient`, then the centre (`solveCrop`'s position), with `why` saying
   which.
3. **Two people.** If the two largest faces are together on ≥ `bothShare` of
   the samples:
   - and their union, plus the margin, fits inside the crop's width, the
     crop centres on the union (`both`);
   - **otherwise the shot is a stacked two-up** (`two-up`; §16.3, answered
     2026-10-05): the output frame is split into a top and a bottom half,
     each a face-centred crop of the same source at the half's aspect, on
     the grid's rails. For a 1080×1920 canvas each half is 1080×960 (9:8);
     from a 1920×1080 source each half's crop is `half`, 608×540. The face
     further left in the source goes on top. Each half centres its face on x
     and puts the face's centre `twoUpFaceY` down the half, clamped; it is
     held for the shot and pans on x by rule 5 for its own face. pyautoflip
     splits the screen in the same case (§4.1), which is the sign that
     clippers expect it.

   If the two are together on fewer than `bothShare` of the samples (one is
   lost for much of the shot), the crop frames the face with the larger
   median area (`larger`), with a note naming the shot. **`larger` now
   remains only for a face lost**, for a portrait source going to 16:9
   (below), or when the clip's `follow.twoUp` is
   false (the dock's **Stack two people**, on by default, §4.8). The two-up
   runs on the x axis only (a landscape source to a portrait or square
   canvas); a portrait source going to 16:9 keeps `larger`.
   **Cutting to whoever is speaking needs to know who is speaking, and
   nothing here measures that**: no diarization, and face landmarks do not
   show a moving mouth.
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
   free axis that the user dragged (§4.7); on a two-up shot,
   `halfOffsets[shotStartMs].top` or `.bottom` is a share of each axis for
   the half that was dragged. It is added after the solve, so switching
   aspect keeps the correction's intent rather than its pixels.

For a portrait source going to 16:9 the same rules run on y, with the face
placed at the upper third rather than centred.

### 4.7 1f — Applying it: the followed crop, `setAspect`, the action · 4.5 days (+1 for the two-up)

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
  `followKeys(project, clip, fps): { crop: CropRect; cropX?: Keyframe[]; cropY?: Keyframe[]; halves?: HalfKeys; notes: string[] } | null`,
  pure and memoised on (track key and version, `follow`, in-point, duration,
  speed, ramp, fps, canvas aspect). It runs `cropPath` (§4.6), then at each
  shot boundary inside the clip's window writes a **held** key on the cut's
  timeline frame; each pan becomes two eased keys. Source ms go to a
  clip-relative frame through `timelineFrameAt(clip, sourceMs)`, the
  inverse M0 adds to `timeline.ts` (§3b.6) by binary search over the
  monotone `sourceFrameFor`, so constant speed and ramps both work. Holds
  have no mapping and are refused with a note. `null` when the clip has no
  `follow` or its track is refused (§3.1's size check). `halves`
  (`{ top: { x: Keyframe[]; y: Keyframe[] }; bottom: { x: Keyframe[]; y: Keyframe[] } }`)
  is present only when the clip's path holds a two-up shot (below).
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
- **The stacked two-up in the render** (§4.6 rule 3). For a clip whose
  path holds any two-up shot, `cropFilter` returns, in place of the one
  crop, one input split into two crops with their own keyed `x` **and** `y`,
  stacked:
  `split=2[r${i}a][r${i}b];[r${i}a]crop=w='min(${half.width},in_w)':h='min(${half.height},in_h)':x='…top x…':y='…top y…'[r${i}t];[r${i}b]crop=…bottom…[r${i}u];[r${i}t][r${i}u]vstack`.
  Labels are clip-indexed, as the chroma key's `split=3[kp${i}]…` already is
  (`plan.ts:1263`). **Every single shot in that clip keys the top half at
  (x, 0) and the bottom at (x, `half.height`)**, which reassembles the
  single crop exactly, so one graph serves both layouts and a cut switches
  them with the same held keys. The stack's output is `size` (608×1080 from
  1920×1080), and both crops' sizes are literal, so `streamSize` and
  everything after the crop (the camera move, the fit, `fps=`) are
  unchanged; for that, a two-up clip's `size.height` is evened to a multiple
  of 4 so the two halves add up to it. A clip with no two-up shot keeps the
  one crop. **Measured for this revision** on the Mac's 4.4 build
  (2026-10-05; a 1920×1080 `testsrc2` source stored as yuv420p FFV1, 30
  fps, 60 frames; outputs compared by `framemd5` over **rawvideo**. Hashed
  as FFV1 packets instead, frames 30–35 of the keyed run differ from the
  static two-up, because FFV1 carries its coding state across the default
  12-frame GOP from the single-crop frames before the switch; with rawvideo
  or `-g 1` they match. Re-measured by the review, and again by the fixer,
  rawvideo and FFV1 both; `EFFECTS.md` §38):
  - the split, two 608×540 crops at (656, 0) and (656, 540), and `vstack`
    are **bit-identical, frame by frame, to `crop=608:1080:656:0`**;
  - with both crops' `x` and `y` keyed as held `if(lt(t,0.983333),…)` (frame
    30's half-frame boundary at 30 fps, §3.2), frames 0–29 matched the single
    crop and frames 30–59 matched a static two-up, bit for bit;
  - the same shape inside a `-vf` (one input, one output, labels inside)
    ran and matched the static two-up's frames.

  **Dated, not measured:** the 2018 Windows build (`crop` 2010s, `split`
  about 2011, `vstack` merged 2015, §13), other frame rates (§4.9's check
  runs 29.97, 60 and VFR), and the shape inside `buildRenderPlan`'s own
  chain.
- **The two-up in the preview**: the same `<video>` element drawn twice. On
  a two-up frame, the Preview draws the element's top-half source rectangle
  into the top of a `size`-shaped offscreen canvas and the bottom-half
  rectangle into the bottom (two `drawImage` calls, as the one crop is one
  today, `Preview.tsx:1698-1700`), then draws that canvas on through the
  path a single crop takes, so the camera move and the fit see the stacked
  frame the export's chain sees after `vstack`. **The Source outline shows
  both rectangles.**
- **The two-up in the footage pre-pass: one pull of the stacked frame**, not
  two. The same split, crops and `vstack` go into the pull's `-vf` where the
  one crop goes (measured above to run inside `-vf`), so a moment over a
  two-up shot gets exactly the frame the render draws, and
  `FootageRequest` carries the halves' keys beside `cropX`/`cropY`.
- `render/crop.ts`: `cropAt(project, clip, source, frame): { crop: CropRect; halves?: { top: CropRect; bottom: CropRect } }`,
  the one reader every consumer of a crop calls. A consumer that cannot draw
  two rectangles (the strips effect) takes `crop`, the top half's position
  at `size`, with a note. The consumers:
  - the preview's output and its Source outline (`Preview.tsx:1102-1106`,
    `:1374`, `:1435`);
  - the moments' `shotPicture` (`moment.ts:400`);
  - the strips effect (`automation/strips.ts:207`);
  - the Inspector line (`Inspector.tsx:147-148`), which says "Follows the
    subject · N shots" instead of a rectangle (and "· M stacked" when a
    two-up is among them).
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
  - `FootageRequest` gains `cropX`/`cropY` (the compiled keys) and, for a
    two-up clip, the halves' keys, and `momentFramesKey` includes them all;
    `PULL_VERSION` 5 → 6 (`:98`);
  - **`reframeClip`'s update calls `rebakeGenerated`**, so moments already
    baked over the clip re-pull with the followed crop rather than keeping
    the centred one.
- **The preview reads a followed crop at the `<video>`'s `currentTime`**,
  not the playhead, while playing. The element may drift up to 0.18 s,
  about 5 frames (`Preview.tsx:116`), from the playhead before it is
  re-seeked, and a cut must change on the frame the element shows.
  Unmeasured in the harness until §4.9's check runs.
- `Clip.follow?: { phrase?: string; offsets?: Record<number, number>; halfOffsets?: Record<number, HalfOffsets>; twoUp?: boolean; version: number }`
  (`timeline.ts`, beside `crop`). It marks a clip whose crop follows
  `Project.subjects[assetId]`. `twoUp` absent means on.
- **`setAspect`** (`store.ts:1387`): a clip with `follow` and a valid track
  keeps `follow`, and its stored `crop` becomes `followKeys`' size at the new
  aspect with the first shot's position, so a consumer that does not know
  about following still gets the right size. Otherwise `solveCrop`, as
  today. This is the line that would otherwise wipe every reframe on a
  9:16 → 16:9 → 9:16 round trip.
- **CropOverlay** (`CropOverlay.tsx:62-67`, `:107`): on a followed clip a
  drag moves the shot under the playhead. It records
  `follow.offsets[shotStartMs]` as a share of the free axis; the next read
  re-solves. **On a two-up shot the drag moves the half it starts in**: on
  the Source outline, the rectangle under the pointer; on the Output view,
  the top or bottom half of the frame. It records
  `follow.halfOffsets[shotStartMs].top` or `.bottom`, a share of each axis,
  and the other half stays where it is. That is one undo entry
  (begin/commit), as today. **Unfollow** (in the dock) removes `follow` and
  leaves the crop at the playhead static (on a two-up frame, the top half's
  position at `size`).

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

### 4.8 The UI · inside the 4.5 days of 1f

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
  subject · gets the face finder, 1.1 MB, first time"** (0.2 MB if YuNet) while the model is
  not on disk, and is greyed with "needs the AI helper" without Python;
  **Follow:** with a phrase field ("a face" by default, or "the cake";
  Florence only, so greyed with its reason until 1g); **Stack two people**
  (on by default; off sets `follow.twoUp: false`, and a two-up shot frames
  the larger face instead, §4.6 rule 3); the shot count; the notes ("shot 4:
  two people too far apart, stacked"; "shot 6: one face lost, framing the
  larger").
- **The job row** in the EXPORT strip's list: "Finding the subject · <name>",
  with its bar and its cancel.
- **Census rows** in `tests/fixtures/ui-census.json`, each label counted on
  screen by a `needs` recipe in `harness/census.ts` (a landscape video on a
  9:16 canvas; a followed clip selected; a missing model): "Landscape video
  on a 9:16 canvas", "Reframe to 9:16", "Follow the subject", "Unfollow",
  "Follow:", "Stack two people", "Finding the subject", "needs the AI
  helper", "Get the subject model", "Find subjects without faces".
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
  - both faces fitting give `both`; **too far apart gives `two-up`**, the
    face further left on top, both halves `half`-sized, each face centred on
    x and `twoUpFaceY` down its half; **a lost face gives `larger`** with a
    note (two faces together on fewer than `bothShare` of the samples); with
    `twoUp: false`, too far apart gives `larger`;
  - no faces gives `salient`, then `centre`; `ground` beats `salient`;
  - one size, even, inside the frame; on a two-up clip, `size.height` a
    multiple of 4 and `half` exactly half of it;
  - an offset survives an aspect change; a half's offset moves only that
    half;
  - the same input gives the same output.

  Mutations, each killed by a named case: dead zone 0 (static); trigger
  ignored (excursion); the union not checked against the width (too far
  apart); a size per shot (one size); **the two-up taken when one face is
  lost** (the lost-face case); the halves' order by size instead of by side
  (the left-on-top case, whose left face is the smaller).
- `tests/reframeKeys.test.ts`:
  - `followKeys` puts a held key ON each cut's frame;
  - `timelineFrameAt` inverts `sourceFrameFor` at speed 1, 2 and 0.5 and
    through a ramp, landing on the frame whose source frame is the cut;
  - **after each ordinary edit, a held key is still on each cut's frame**:
    `withClipSpeed` to 2 and 0.5, a ramp edit, `convertFrameRate` 30 → 25 →
    30, a head trim, and a split (each half checked);
  - a hold is refused;
  - on a two-up clip, every single shot keys the top half at (x, 0) and the
    bottom at (x, `half.height`), and the halves' keys are held on each cut's
    frame like the one crop's.

  Mutations: the key at cut − 1; the memo key without `speed` (the speed-2
  case reads the speed-1 keys and fails); a single shot's bottom half keyed
  at y 0.
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
  - **A two-up shot, frame-exact at its cuts, both halves read by the
    barcode.** For it the media's barcode strip is repeated every 270 rows,
    and a vertical strip carrying each row band's Gray code the same way is
    repeated every 256 columns, so every 608×540 half holds at least one of
    each and its x **and** y are read off its own pixels.
    The hand-built track gives shot 4 two faces at x 0.2 and 0.8. Frame
    cut − 1 is the single crop; frame cut shows the top half at the left
    face's crop and the bottom half at the right face's, each within ±8 px
    on both axes, with shot 4's identity colour in both. A single shot
    inside the two-up clip matches the same shot rendered from a clip with
    no two-up (mean difference ≤ 1/255; the shape alone is bit-identical,
    measured, §4.7). And a moment whose window spans the two-up's first cut
    matches the render beneath it through the one stacked pull.

  Mutations: §3.2 reverted (the 30 fps cut at frame ≡ 2 mod 3 shows the old
  identity colour); keys compiled with `startSeconds` = the clip's start;
  keyed on `n`; the pre-pass's crop left after its `trim` (the moment
  spanning the cut shows the clip's opening crop); **the bottom crop given
  the top's keys** (the bottom half's barcode reads the left face's x).
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
  - **MediaPipe (§16.1):** the worker imports on the venv with the
    stubs first on its `PYTHONPATH` (mutation: the stubs dropped from the
    worker's env, and the test fails on `No module named 'cv2'`); the
    helper's own `sys.path` holds no stub directory (mutation: the stubs
    added to the helper's env, caught by asserting a real `cv2.__file__` is
    not under `stubs/` when one is installed); a worker that calls
    `os.abort()` leaves the helper answering and `faces.py` returning
    `Unavailable` (mutation: the worker run in-process, and the helper dies).
- `tests/integration/sidecar.int.test.ts`: on CI's bare 3.12, each of
  `vision.faces`, `vision.salient` and `vision.ground` appears in
  `capabilities` or `degraded`. Membership, not the list.
- **Harness check** `src/renderer/src/harness/reframeCheck.ts`
  (`window.__forgeReframeCheck`):
  - The bridge stub `analyseSubjects` returns, for the harness's
    640×360 webm, shots at 0–2 / 2–4 / 4–6 s: a box at x 0.25, then 0.75,
    then two faces at 0.35 and 0.65 (too far apart for a 202 px crop, so a
    two-up).
  - The check reframes the clip, plays it, and at frames inside each shot
    compares the Output canvas against the source frame drawn through the
    expected crop, **or through the two expected halves** in the third
    shot. Mean difference ≤ 2/255. The check also compares the frame on
    each side of every cut, and the Source outline shows two rectangles in
    the third shot.
  - Then it toggles 9:16 → 16:9 → 9:16 and expects the crops back, drags
    one shot and expects the offset kept, **drags the bottom half of the
    two-up and expects only that half to move**, turns Stack two people
    off and expects one crop on the larger face, and undoes.

  It shows what the harness can (the timeline result, the Output view, the
  Source outline, drags, round trips). It cannot show detection or the
  export; those are the integration tests.

### 4.10 Exit

- The ten user clips through the action, with frames sampled into
  `tests/output/reframe-real/` (not committed):
  - face-inside-crop ≥ 95 % where a face was found (on a two-up shot, each
    face inside its own half);
  - zero crops held across a cut;
  - the user's rating ≥ 4/5 on ≥ 8 of 10.
- pyautoflip's output on the same ten clips (§4.1) rated by you beside
  ours, both ratings in `EFFECTS.md`. A baseline, not a bar: where it rates
  higher, the clip and the reason are written down before the exit.
- The render check frame-exact on both builds, on all four sources (30,
  29.97, 60 fps and VFR), the two-up rows included.
- Analysis time recorded: **≤ 90 s for a 10-minute 1080p clip on the Mac,
  ≤ 3 min on the Surface**. Over that, drop to 3 fps first, then 480 px.
  **A 4K HEVC phone clip is a separate budget**: its decode alone measured
  about 3.3× realtime on the Mac, about 3 minutes for 10 minutes before any
  detection (`EFFECTS.md` §37, on the face fixture), so the 4K time is
  recorded on its own, and hardware decode (`videotoolbox`; unmeasured) is
  the lever if it is too slow.
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
face boxes at the caption line's time become frame boxes. On a two-up frame
(§4.6 rule 3) each face maps through its own half, so both halves' faces
count.

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
  | { template: 'quote'; kind?: 'said'; text: string /* a contiguous run of the said words, clause to clause */; speaker: string /* '' | the asset's speaker as the user set it | a name the stretch says said it (§6.7) */ }
  | { template: 'quote'; kind: 'social'; text: string; name: string; handle: string; date: string; link: string }   // step 5 (§8.4): every field typed or pasted by the user; link stored, never fetched; no logo, no avatar
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
  fields: Record<string, 'verbatim' | 'grounded' | 'fixed' | 'speaker' | 'user'>   // 'user': the social quote card's (§8.4), typed by the user, never offered to a model; reached through kindFields
  /** per data.kind, overriding fields: quote's 'social' → text, name, handle, date, link all 'user' (§8.4) */
  kindFields?: Record<string, Record<string, 'verbatim' | 'grounded' | 'fixed' | 'speaker' | 'user'>>   // GRAPHIC_TEMPLATES.quote.kindFields.social
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
| `quote` | the said line in quotation marks, each word lit as it is spoken (the captions' highlight logic) | one per word | 2 / 4 / 6 | text `verbatim`, clause to clause; speaker `speaker` (§6.7 rule 7). Its `social` kind (step 5, §8.4): `kindFields.social`, every field `user`, typed by the user; nothing fetched from X, no X logo or avatar, not shaped as a post |
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
     The social quote card's `user` mode (§8.4) is the user's own typing,
     never a model's: no pass is offered that kind, so the validator never
     sees it.
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
  its own captions. The proper inverse is `timelineFrameAt` (built in M0,
  §3b.6), applied to captions and graphics together later (§17).

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
validator on every edit, except fields in `user` mode (a social card is
never checked against a stretch), so a typed number not in the stretch
shows a warning, not a block, because the user may type what they like); the OUTPUT
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

## 7. Step 4 — Best clips in the URL tile · 3.5 days (M0, §3b, took 7.5 of its 11)

**What it is.** Sheet 27: **duration 1 / 2 / 3 / 4 min · Analyse** → three
tall cards, each with a title and why → **Clip it**. The user called the URL
panel "the biggest one" and sheet 26 "the most important feature". **Sheet
26 is M0 now (§3b), built first**: the link's transcript (written here, in
§7.1 and §7.2) and its rows, handles, chapter chips, Clip it from a run and
the timeline half (written in §3b) are all built there. Best clips proper
stays here:

| piece | days |
|---|---|
| windows (§7.3) | 0.5 |
| signals and the prefilter (§7.4) | 0.5 |
| the model's comparative pick: schema, prompt, validate, `run.ts` shared with the eval (§7.4) | 1 |
| three cards, and Clip it from a card through M0's path, with §7.5's project question; steps 3–5 are already on that path (each attached in its own step: 1f, step 2, §6.6), step 6 arrives with §8.7 | 0.5 |
| tests, the harness's cards half, census, the ten-links eval (§7.7, §7.8) | 1 |
| **step 4** | **3.5** |

### 7.1 Metadata and the transcript from a link — measured with yt-dlp 2026.08.19

Built in M0 (§3b.1); Best clips reads what M0 fetched.

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

Built in M0 (§3b.1, §3b.4), the three-track measurement below included.

```ts
export function parseJson3(json: unknown, assetId: string, source: 'youtube-asr' | 'youtube-lines'): Transcript
//  word.startMs = event.tStartMs + (seg.tOffsetMs ?? 0)
//  word.endMs   = min(next word's start, event end, startMs + estimate(word))   — json3 has no word end;
//                 estimate = 80 ms per grapheme, at most 600 ms, so a real pause stays a gap
//  confidence   = null — never 0: TranscriptPanel.tsx:164 underlines < 0.5 as unsure, and acAsrConf is 0 on every word
//  '\n' segs and bracket tags ([Music]) dropped
//  segments = segmentIntoSentences(words, PAUSE_BOUNDARY_MS, { maxWords: 30, maxMs: 15000 }), plus a break at every json3 event gap ≥ 700 ms
//  'youtube-lines' (uploader track, line-timed): words spread within each line by grapheme count — marked approximate
export function shiftTranscript(t: Transcript, range: { startMs: number; endMs: number }, headOffsetMs: number, assetId: string, run?: WordRun): Transcript
//  with run: keep words run.from..run.to; without: words with startMs in [range.startMs, range.endMs)
//  subtract (range.startMs − headOffsetMs); renumber; resegment
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
- **measured in M0, before the parser is final** (so long before §7.3 is
  built): three unpunctuated tracks, one Hindi or
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

M0 (§3b) gave the URL tile panel (`IngestPanel.tsx`) **Get transcript**
(rows of time | text, picked by click and shift-click or the cut handles),
chapter chips, Clip it from a run, Add another clip, and Listen to it. Step
4 adds:

- **Best clips** in `src/renderer/src/components/tools/BestClips.tsx`:
  duration 1 / 2 / 3 / 4 min, **Analyse**, then three tall 9:16 cards with
  the title, the why, the range, the word count and `scoredBy`. A frame
  thumbnail per card (yt-dlp's storyboard formats) is **unmeasured** and
  left out of v1.

**Clip it from a card** runs M0's Clip it (§3b.4: steps 1 and 2 below are
M0's, built there), with step 0's question in front and steps 3–6 after it:

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
1. **Download** (M0's, §3b.4). `startIngest` with a request override
   `{range, exact: true}` (`store.ts:1060-1090` takes only `get().ingest`
   today). Exact or fast is decision §16.13, **open until the exact cut is
   cross-correlated against its source** as the fast cut was (§7.1: only
   the container's start time was measured); M0's exit decides it. One job
   per range; several ranges are several jobs, which run 2 at a time
   (`ipc.ts:207`).
2. **Collect** (M0's, §3b.4). `pendingIngests[jobId]` gains
   `transcriptFrom`, and `collectIngest` writes
   `project.transcripts[asset.id] = shiftTranscript(…)` inside its
   begin/commit (`store.ts:4691-4723`), plus `asset.credit` of source
   `'link'` with the channel and the URL (§8.5). One undo step: asset, clip,
   trim, transcript, credit.
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

**A link with no caption track** (M0 built the button, §3b.5): it reads
**Listen to it · downloads the audio (~N MB) and the speech model (464 MB,
first time)**, N from the metadata's duration and the audio format's
bitrate. Pressed, it is an audio-only download that is not placed,
transcribed by path (the reel's `lyrics:` precedent, `store.ts:2112`).
Without the Python helper, Best clips adds: "This video has no captions;
Best clips needs the AI helper to listen to it." Census rows: "Start a new
9:16 project for this clip", "Add it to this project" ("Listen to it" is
M0's).

### 7.6 Transcript → Clip it (sheet 26) — now M0, §3b

You called this "the most important feature … first among the three"
(`SHEETS.md:715-717`). The first draft offered its timeline half as an M0 of
about two days. **You took it first and redefined it** (§16.26, 2026-10-05)
as the URL transcript → Clip it flow plus this timeline half, 7.5 days,
moved from this step. The whole of it is §3b; the timeline half as written
here (row selection in the Transcript tile, `clipToRange`,
`placeAssetRange`, `timelineFrameAt`) is §3b.6, moved there unchanged.
Best clips reuses it.

### 7.7 Tests, render check, harness, census

**Which of these are M0's.** `ingestArgs`, `ingestCaptions`,
`ingestCaptions.int`, `exactCut.int`, the `clipToRange` and
`placeAssetRange` cases of `clipIt`, and the `clipIt.int` render check land
with M0 (§3b.8), with their mutations. Step 4 adds `bestClips`, the
project-question case of `clipIt`, the harness's cards half and its census
rows.

- `tests/ingestArgs.test.ts`: the new argv shapes as ordered shapes; the
  marks; explicit language keys, never `.*`.
- `tests/ingestCaptions.test.ts` (fixtures built in the test with the
  measured json3 structure; no third party's speech committed):
  - start = `tStartMs + tOffsetMs`; end from the next word, the event end,
    or the grapheme cap, whichever is first;
  - confidence null; `\n` and `[Music]` dropped; overlapping roll-up events;
  - the uploader track spread;
  - `shiftTranscript` for exact and fast heads, and with a run (exactly its
    words, §3b.8);
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
  deterministically. M0's check (`clipItCheck.ts`, §3b.8) selects rows,
  presses Clip it, and sees the stubbed job; step 4's half then runs Analyse
  with the model stub, sees three cards, and clips one.
- **Census rows:** step 4's are "Best clips", "1 min", "2 min", "3 min",
  "4 min", "Analyse", "Make it vertical"; "Get transcript", "Clip it",
  chapter chips and the Transcript tile's row selection hint are M0's
  (§3b.8).

### 7.8 Exit

- Ten real links chosen by the user (talks and podcasts; two in Hindi or
  Telugu): on ≥ 7 of 10, at least one card the user would post, with the
  model and with signals alone, recorded separately.
- Every window on sentence boundaries, by property.
- Clip it's captions within one frame on the exact cut, and the exact cut
  cross-correlated with §16.13 decided: **M0's exit** (§3b.9), already met.
- Clip it from a card end to end on the Surface without swapping, with the
  reframe and graphics attached (§12.1).
- YouTube ASR timing against Whisper measured on three videos and written
  into `EFFECTS.md`.

---

## 8. Step 5 — B-roll · 14 days (the X capture window's 2 out, the social quote card's 0.5 in)

**What it is.** For a moment in the transcript, the model picks a **kind**,
the app fetches **candidates**, the user **clicks** one, and it lands
credited. The five agreed sources, the fourth changed by your answer to
§16.18:

- Pexels (mood);
- Wikimedia Commons through Wikidata (the real thing);
- fact cards from the speaker's own words;
- **social quote cards**: a public statement you type or paste, drawn as
  our own card in the graphic styles, never fetched from anywhere (§8.4);
- headline cards.

Plus Wikipedia cards, a page card from a pasted link, and the
answer-with-sources cards (step 6). **No Google or Perplexity screenshots.**

### 8.1 Keys in Settings, write-only — `src/main/web/keys.ts` · 1 day

The Director's path, built once, **for the Pexels key only**: it is the one
key this plan adds now that Brave is out of v1 (§9, §16.16).

- `Settings.webKeys?: { pexels: string }` and
  `Settings.broll?: { allowShareAlike: boolean }` (`src/shared/types.ts:87-114`).
  `defaults()` and a strings-only sanitiser go in `src/main/store.ts:38-73`,
  modelled on `voiceHosted()` (`:105-119`). `mainKeys()` is derived from
  `defaults()` (`:125`), so `settings:set` refuses them and
  `rendererSettings()` leaves them out, automatically. Two existing tests
  loop over `Object.keys(getSettings())` and cover the new fields; each is
  mutation-checked again with them in.
- `keyStatus(): { pexels: { hasKey } }`;
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
  the voice's are. With Brave out, no key backed by a card remains, so
  §16.14 is moot and no `safeStorage` is built.
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

The key goes in a header, **never in a URL**: Pexels takes a raw
`Authorization: <key>` (measured: 401 "Invalid API key"). **No allowlist
holds an X host, and the pasted-link sources refuse one**: `page.ts` (page
and headline cards, whose allowlist is the pasted link's own host) refuses
`x.com`, `twitter.com`, `t.co` and `twimg.com` as host suffixes, on the
pasted URL and on every redirect hop, before any request, with "Type the
words into a social quote card instead" (§8.4).

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
export type BrollSource = 'pexels' | 'commons' | 'headline' | 'page' | 'wikipedia' | 'link'   // 'link': a video ingested from a URL, credited by channel (§8.5; M0 adds it first, §3b.4)
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
  fetchedAt: string
  person?: { names: { qid?: string; name: string }[]; confirmedAt: string }
}
```

| source | how (measured 2026-10-05) | file |
|---|---|---|
| **Pexels** (mood) | `api.pexels.com/v1/search` and `/videos/search`, with the user's key. The API host is reachable (401 without a key). **Its docs, licence page and rate limits returned a Cloudflare challenge (403) again on 2026-10-05, and are unmeasured** (not worked around). **You read them in a browser before 8.3 is built**, and their clauses on identifiable people, endorsement and attribution (including any "provided by Pexels" link the search panel must show) go into §11. Until then, **a Pexels candidate goes through the same confirmation as a Commons person** whenever the AI helper's face finder sees a face on it, or it cannot be checked (§8.6): most of Pexels' stock shows people, and it would otherwise land under any sentence, including one about fraud or illness | `pexels.ts` |
| **Commons via Wikidata** (the real thing) | `wbsearchentities` (Eiffel Tower → Q243, plus two Delaunay *paintings*, so disambiguation runs on the description and P31); `wbgetclaims` P18 → the Commons file; `prop=imageinfo&iiprop=url\|size\|mime\|extmetadata`. `License` is machine-readable (`pd`, `cc0`, `cc-by-4.0`, `cc-by-sa-4.0`); `Artist` and `Credit` are HTML (strip tags); `AttributionRequired`; `Restrictions` (`personality` on Q42's portrait, which is CC BY-SA 2.0); `descriptionurl` is the credit's link. `iiurlwidth=1080` returned a bucketed **1280 px** thumb, so **the probe, not the API, is the size**. SVGs come back as `.svg.png`. Files are on `upload.` and `thumb.wikimedia.org`. Commons titles are free text, **never file names** | `wikidata.ts`, `commons.ts` |
| **fact cards** | the speaker's own words, as a `quote` graphic (§6) with `verbatim` text. No fetch, no third party | — |
| **social quote cards** | **no fetch at all, and no X branding** (no logo, avatar, verified mark or post shape). The user types or pastes the statement, the name, the @handle and the date (and, if they like, the link, kept as text). Drawn as our `quote` template's `social` kind in the six graphic styles (§8.4). Nothing is requested from X or any other host. The embed-capture route (its oEmbed half measured, its capture never) is out (§17) | — (`graphics/social.ts`, §8.4) |
| **headline cards** | **Google News RSS is out by its own terms**. Measured: its channel `<copyright>` restricts the feed to "a personal feed reader for personal, non-commercial use". Its links are Google redirect tokens, not the outlet's URL. So a headline card comes from **a pasted article link**: main fetches the page's `h1`, `og:title`, `og:site_name`, `article:published_time`, `article:modified_time` and `article:section`. The card is **our web-article card** (below), not a newspaper clipping. **Never the outlet's photo or logo; the app never writes or edits a headline.** A news feed with acceptable terms is decision §16.17 | `page.ts` |
| **Wikipedia cards** | keyless REST `page/summary/<title>`: `extract`, `wikibase_item` (the Q id, linking the card to Wikidata), `content_urls`. **The summary's `thumbnail` and the page's `og:image` were an enwiki-local logo file, not Commons (Eiffel Tower), so they are never used.** Images come only through P18 → Commons with its licence | `wikipedia.ts` |
| **page card** | a pasted link: `og:title`, `og:site_name`, `description`, the published time, drawn as our `source` graphic. Not a screenshot (decision §16.19) | `page.ts` |
| **answer** (step 6) | text fetched from Wikipedia and from links the user pasted; no search engine in v1 (Brave is out, §9, §17) | `wikipedia.ts`, `page.ts` |

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

### 8.4 The social quote card — the user's own quotation · half a day

**The first draft's capture window for X is removed** (2 days; the facts
measured for it are kept in one sentence in §17). In its place, **your
idea** (§16.18, 2026-10-05): "instead what we gonna do is we will make new
cards of kinds in our assets and the user will pick in the custom or we can
give any card randomly if they select".

**What it is.** A `social` kind of the `quote` template (§6.1) with five
fields, **every one typed or pasted by the user**: `text` (the statement),
`name`, `handle`, `date`, and an optional `link`. It is drawn in the six
graphic styles (§6.5): you pick one from the style tiles, or press
**Surprise me**, which picks one at random **once, at the press**: the
chosen style is stored on the spec as `style`, with the `seed` that chose
it, so the card draws the same on every frame, preview and export alike.
Never `Math.random` at draw time. It has no grounding: `beats: []`, so it
arrives on its entrance at the clip's start; `seconds` is the quote
template's default, 4; **Add a social quote** lands it at the playhead,
over the clip beneath, placed by §6.9.

**The rule that makes it your quotation, not X's content:**

- **The app never fetches anything from X**: no oEmbed, no embed script,
  no capture window, no X host in any allowlist, and a pasted X link
  refused by the page fetcher (§8.2). The `link`, if you paste one, is
  stored as text and never requested.
- **No X logo, no avatar, and nothing shaped like a post**: no post chrome,
  no like or repost counts, no verified mark. It is a quote card in our own
  styles: the statement in quotation marks, then the attribution line
  **"<name> (@handle) · <date>"**.
- So it is you quoting a public statement, as one quotes a speech. X's
  display requirements bind content obtained from X (they were read on
  2026-10-05, §17), and nothing here is obtained from X; and it is not a
  "mock-up of a post", because it does not present itself as one.
- **You are responsible for the quote's accuracy.** The fields' panel says
  so beside them: "You are quoting this person; check the words and the
  date".
- **Quoting a person to promote something can read as their endorsement.**
  The fields' panel says so under the accuracy line: "Using someone's words
  in an ad needs their permission". The quoted person's rights, and any
  endorsement a viewer may read into the card, are yours to clear. The
  first draft refused X cards in Director ads for the same reason; no model
  places this card (§8.7).
- **It is a graphic like any other**: placed by free-space placement
  (§6.9), with the same exit and guards as every graphic (§6.4).
  The first draft's whole-post protections went with the capture window.
- **Never offered to a model.** Its fields are mode `'user'` (§6.1, §6.7
  rule 8); neither `graphics@1` nor `broll@1` is offered the `social` kind
  (§8.7), so no model writes or suggests one.
- **Recorded assumption:** this is your idea taken in its **paste-only**
  form (the app fetches nothing). You have not yet confirmed that condition
  in so many words (§16.18).

**Files.** `src/shared/graphics/social.ts` (the fields' sanitiser: trimmed,
the handle stored without a leading `@` (any number of them stripped), and
the attribution line adds exactly one; the date as typed); the
`quote`/`social` branch of `graphics/paint.ts`; `tools/GraphicPanel.tsx`'s
fields for the kind, with **Surprise me**; **Add a social quote** in the
Transcript tile's Graphics section and in the B-roll panel (§8.8).

**Tests** (`tests/socialCard.test.ts`):

- the settled frame draws every user field verbatim, the attribution line,
  and nothing else but the style's listed fixed glyphs (the fake context
  lists every `fillText` string), and draws no image (no `drawImage` call:
  no logo, no avatar);
- a handle typed as `@@name` draws `(@name)`;
- Surprise me stores a `style` that is in `GRAPHIC_STYLES` and a `seed`,
  and the same spec draws identically twice;
- `graphics@1`'s graphic item has none of `name`, `handle`, `date`, `link`
  among its properties (membership over the schema's keys),
  `settleGraphics` never returns data with kind `social` (property), and
  `post`/`social` are not in `broll@1`'s kind enum;
- no source's allowlist holds an X host (`x.com`, `twitter.com`,
  `twimg.com` as host suffixes, membership over every allowlist), and the
  `link` field never reaches `webFetch` (a spy over the fetcher for the
  card's whole life: created, edited, baked, exported);
- `page.ts` refuses a pasted `https://x.com/<user>/status/<id>`, a `t.co`
  link, and a pasted link whose server redirects to `x.com`, and the
  fetcher's spy records no request to any X host.

Mutations, each failing its own case: Surprise me calling `Math.random` at
paint time (the two draws differ); `handle` added to `graphics@1`'s item
schema; an X host added to the page fetcher's allowlist; the X refusal
dropped from `page.ts` (the pasted x.com link is requested); the attribution
line without the handle; the line adding `@` to a handle that kept its own.

**Render check**: §6.11's `graphic.int.test.ts` gains a social card at
9:16, placed and exported: its box sits in the third §6.9 chose and its
frames are the fake baker's. **Harness**: `graphicCheck.ts` (§6.11) draws
the social kind in each of the six styles, preview against bake within
1/255. **Census rows**: "Add a social quote", "Surprise me", "You are
quoting this person", "Using someone's words in an ad needs their
permission", "Type the words into a social quote card instead".

### 8.5 Credits — `src/shared/broll/credits.ts` · 2 days

- `creditsFor(project, range?)` walks the clips in range, takes their
  assets' `credit`, dedupes, keeps first-appearance order, and returns
  `{line, required, url}[]`. **A video ingested from a link comes first**:
  `collectIngest` gives it a `credit` of source `'link'` with the channel and
  `webpage_url` from the metadata (§7.1; built in M0, §3b.4), the one credit
  a clipper always needs. A social quote card has no asset credit:
  `creditsFor` also walks the clips' `graphic`, and for `data.kind ===
  'social'` emits `{line: "<name> (@handle) · <date>", required: false,
  url: null}` (a pasted link goes in the line as text, never as a URL).
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
  - a social quote card (§8.4): the attribution line **"<name> (@handle) ·
    <date>"**, drawn on the card itself and listed in the Credits block, not
    `attributionRequired`. No URL is fetched; a link you pasted into the
    card is listed as the text you typed;
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
credit is first; a social card in range yields its attribution line with
`required` false. Mutations: drop `LicenseUrl`; skip `attributionRequired`
in the Done line; skip the modified flag; walk assets only (the social
card's line is missing).

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
      "kind": "entity",                                    // enum: mood | entity | fact | headline | none
      "query": "Eiffel Tower",                             // entity: must be a contiguous run of the sentence (verbatim); mood: ≤ 4 words, free
      "link": "",                                          // headline: enum of the links the user pasted for this clip (L1, L2…), '' otherwise
      "why": "…" } ] }
```

- `src/shared/broll/{schema,prompt,validate}.ts`; the menu is the
  sentences, as in §6.6.
- **The first draft's `post` kind is removed**, not turned into a
  suggestion: the social quote card is the user's own (§8.4), and no model
  is offered it.
- **Validated:** an entity query is verbatim in its sentence; a headline
  pick must name a pasted link; at most one pick per 8 s.
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
  sheet 27 says, and it uses free-space placement (§6.9).
- **Add a social quote** opens the social card's fields (§8.4); it is a
  graphic, so it lands like one, with no download and no candidate.

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
- `tests/socialCard.test.ts`: §8.4's cases and mutations.
- `tests/brollPass.test.ts`: the schema is flat; an entity query must be
  verbatim; a headline needs a pasted link; neither `post` nor `social` is
  a member of the kind enum (membership, not the list).
- Fixtures: recorded API responses (Wikidata, Commons and Wikipedia JSON,
  measured shapes) in `tests/fixtures/broll/`, made from PD/CC0 examples. No
  network in CI.
- **Render check** `tests/integration/brollCredits.int.test.ts`, into
  `tests/output/broll-credits/`: a synthetic still with a fake CC BY credit,
  placed, exported. `<name>.credits.txt` sits beside the mp4 with the line,
  and with the on-screen option the line's rows are present in frames while
  the picture shows. Mutation: the credits file written before the job is
  done (a cancelled export leaves one).

### 8.10 Exit

- One real session by the user: five moments, one from each of the five
  sources in §8 (Pexels, Commons, a fact card, a social quote card typed by
  hand, a headline card).
- Every asset placed carries a credit; `credits.txt` is correct; the Done
  line names the required credits.
- A person's portrait, and a group photo with no Q5 on its entity, both
  refused without the confirm and placed with it.
- A BY-SA file refused with the switch off.
- A social quote card typed, styled by Surprise me, placed and exported,
  with its attribution line; nothing requested from any X host during it
  (the fetcher's log). The Pexels licence and guidelines read, their
  clauses in §11 and the credit line confirmed.
- No key appears in any log, error or URL (a test over the redaction
  paths).

---

## 9. Step 6 — Retrieved-fact cards and the 3D templates · 7 days (Brave's 1 out)

**Retrieved-fact cards** (3 days) are the `source` template with `sources[]`:

- a **Wikipedia card**: the extract, credited (§8.5), behind the BY-SA
  switch (§16.15);
- a **page card** from a pasted link;
- an **answer-with-sources card**, titled **"From <site>"**, never "Answer".
  The model extracts from fetched texts only (the Wikipedia extract, and
  pages fetched from links the user pasted), and:
  - **verbatim runs only**, never `grounded` paraphrase, so two pages'
    sentences cannot be stitched into a claim neither makes;
  - **at most 25 words per source**, with a source line under each sentence;
  - **one claim per card**;
  - each sentence validated as a verbatim run of one fetched text, with its
    index (§6.7's matcher pointed at the fetched text); a sentence that
    grounds nowhere is dropped.

**No search engine in v1** (§16.16, answered 2026-10-05: "the brave too I
guess LM Studio has inbuilt the web scraping so we don't need it
additionally"). The first draft's Brave key, its monthly cap, its
`safeStorage` and its search card are removed (1 day). Brave is dropped on
its own merits: a card on file, a per-use cost past the free credit, and
terms against storing results and against evaluating models with them (the
terms are kept in §17). **On the LM Studio point**, a web search for this
revision (2026-10-05; read, not tried in LM Studio) found that LM Studio has
no built-in web search: search arrives through MCP servers configured in
LM Studio's settings and used in its own chat window, not through the
OpenAI-compatible API the app calls, where the model has no tools unless
the app provides them; and Ollama users have none of it. So the app's rule
stands: **the app fetches, the model extracts** (§0), from Wikipedia and
from links you paste.

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
on a spoken beat (a test over every template's placement).

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
| social quote cards (a public statement, e.g. from X) | **a quote the user typed or pasted** (text, name, @handle, date), drawn as **our own quote card** in our graphic styles, with the attribution line `<name> (@handle) · <date>` | the attribution line, on the card | **fetching anything from X** (no oEmbed, no embed script, no capture, no X host in any allowlist, and a pasted X link refused by `page.ts`, §8.2); **any X branding** (logo, avatar, verified mark); **any card shaped as a post** | nothing is obtained from X, so X's display rules (read 2026-10-05, §17) do not attach; the quote's accuracy is yours. The paste-only condition is the agreed reading of your idea, to confirm (§16.18); the quoted person's rights, and any endorsement implied by using the card in an ad, are yours to clear |
| news headlines | the page's own headline (`h1`, or `og:title` less a trailing byline), the outlet's name in our type, the date, from **a pasted article link**, as a web-article card | `<site_name> · <domain>, <date>`, with the URL and the fetched time | the outlet's photo or logo; a print-clipping masthead; a headline the app writes or edits; **Google News RSS** (its own `<copyright>` restricts the feed to personal, non-commercial use, measured) | another feed's terms are unmeasured |
| page cards | the page's own title, site name and date as our graphic | `site, date`, with the URL | og:image; a screenshot (decision §16.19) | — |
| **page text** (answer and page cards) | **a short verbatim quote with its source**: at most 25 words a source, one claim a card | the page's own credit under each sentence | paraphrase; text stitched across pages; **paywalled text** (`isAccessibleForFree: false`, or anything behind a sign-in) | the paywall signal is unmeasured on real pages |
| Brave Search | **not in v1** (§16.16): no search engine; the answer card quotes Wikipedia and pasted links only | — | — | its prices and Terms, measured 2026-10-05, are kept in §17 |
| Google / Perplexity screenshots | **never** | — | — | agreed |
| saved templates | library assets by id, the author's own design elements | per `MARKET.md` | B-roll with a credit and third-party footage (stripped on save) | `MARKET.md` §5 |

---

## 12. Python — the prerequisite (BETA R4)

The installers ship no Python (`service.ts:26-35`), and the packaged app falls
through to a bare interpreter because `.venv` is excluded. **No step's Python
half reaches installed users until Step P lands** (§3a: BETA R4's full
route, the app installing a Python pack under `userData` itself, 5 to 10
days and 300 MB or more by `BETA.md`), as sheet 22 decided ("for this we will
install Python then I guess"). Until then **every Python control is greyed
with "needs the AI helper"**, never offered as a toggle that changes
nothing.

What each step needs:

| step | without Python | with it | sizes |
|---|---|---|---|
| M0 transcript → Clip it | **all of it over the link's own captions**: Get transcript, the rows and handles, chapter chips, Clip it with its words, Add another clip, captions on; a video with no captions keeps the start and end fields, and Listen to it is greyed | Listen to it (Whisper) for a video with no captions; the timeline half over own footage (its transcript is Whisper's) | faster-whisper small 464 MB, its own Get press |
| 1 reframe | shots (main), every crop centred: **today's `solveCrop`, so nothing new to see**; Follow the subject and Reframe greyed | faces, salient, ground; the stacked two-up (it needs two face boxes) | faces: MediaPipe 0.10.35, 17.8 MB (Mac) / 10.9 MB (Windows) of wheel installed `--no-deps` with stubs, plus the 1.1 MB full-range model (§4.3); YuNet 0.23 MB on the installed onnxruntime only if the fallback is needed; **BiRefNet 109 MB, a download for any user who never baked depth** (on disk only on the dev Mac); Florence-2 int8 275 MB, each its own Get press |
| 2 free space | the style's position; **Smart placement greyed** | per shot | — |
| 3 graphics | over **a link's caption track** only; **no `callout`** (it needs a face box) | over own footage (its transcript is Whisper's), and `callout` | — |
| own-footage transcript | **none**: own footage has no captions | Whisper | faster-whisper small 464 MB on disk (measured), its own Get press |
| 4 Best clips | **all of it over YouTube's captions**; Clip it from a card with centred crops | Whisper for links without captions and for Clip it's re-transcription; the reframe | as above |
| 5 B-roll | **all of it**, but every picture that might show a person asks (no face check) | the face check that clears a picture of people (§8.6) | — |

**The pack's contents.** `requirements.txt`, plus the optional files this plan
adds: `requirements-faces.txt` and `requirements-faces-nodeps.txt`
(MediaPipe, decided in §16.1), and nothing extra for
ground (onnxruntime, tokenizers and numpy are there). `tokenizers` becomes
explicit.

**The cv2 clash** exists only if MediaPipe is installed with its full
dependency list: it brings `opencv-contrib-python`, mask tracking plans
`opencv-python-headless`, and one environment may hold one `cv2`. The stub
route (§4.3) installs no real `cv2`, which is how the measured run imported
it.

**The interpreter.** The dev venv is CPython 3.14.6. CI runs a bare 3.12 with
no pip install (`.github/workflows/ci.yml:78-83`), so every new method must
appear in `degraded` there (§4.9). R4 picks the pack's version; mediapipe
supports 3.12–3.14 by wheel tags, and 0.10.35 **ran on 3.14.6** on the
user's Mac (§4.1); 1.0.1 is unmeasured.

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
| **the stacked two-up**: `split=2`, two `crop`s each with keyed `x` and `y` and literal `w`/`h`, `vstack`, with clip-indexed labels | 1f (§4.6 rule 3, §4.7), the render and the footage pre-pass's `-vf` | crop 2010s; split about 2011; vstack 2015 (the dates as known, not re-read in the 2018 source for this revision) | **measured on the Mac's 4.4 build for this revision**: a single shot as two halves is bit-identical to the one crop (`framemd5`, 60 frames), held keys switch both halves on the exact frame, and the shape runs inside `-vf` (compared over rawvideo; `EFFECTS.md` §38). **Dated** for Windows; §4.9's two-up rows run it in CI |
| yt-dlp's `--download-sections` with `--force-keyframes-at-cuts`, through `--ffmpeg-location` (the ffmpeg arguments are yt-dlp's, not this plan's) | M0's Clip it (§3b.4) | — | one exact cut measured on the Mac (container start only, §7.1); **the 2018 build has never run under it**: `exactCut.int.test.ts` in Windows CI, or the Surface (§7.7, §15 row 14) |
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
(the two-up's included) into `SHAPES`, and the analysis argv into the new
`ANALYSIS_SHAPES`.

---

## 14. Degraded modes — each rendered, each a test

| missing | what happens | test |
|---|---|---|
| the Python helper | Follow the subject, Reframe and Smart placement greyed with "needs the AI helper"; crops as they were; captions at the style's place; Best clips over YouTube captions only; graphics over caption tracks only, no `callout`; every B-roll picture that may show a person asks | `reframe.int` with the helper refused; `bestClips` without asr; census rows for each greyed control |
| a model not on disk | its Get button with its size; nothing downloads until it is pressed | census rows; a store test that no toggle or phrase starts a download |
| the face detector (degraded) | salient, then centre, per shot, with a note | path test "no faces" |
| two people, one of them lost for much of the shot | no two-up: the larger face, with a note | path test "a lost face gives larger" |
| Florence-2 (not downloaded, or over its gate) | the phrase field greyed with its reason; salient covers no-face shots | path test "ground absent" |
| no shots found (a single take) | one shot; the path still pans | path test |
| a rotated file whose size disagrees | the track is refused; centred crop; "the file's orientation changed — reframe again" | `faces.int` rotated case |
| a retimed clip | the followed crop is recompiled from the track at read time, so its cuts move with the speed; graphics refuse with a note | `reframeKeys` after `withClipSpeed`, a ramp, `convertFrameRate`, a trim, a split; graphics test |
| no model | graphics from the baseline; Best clips from signals; no B-roll suggestions | each pass's settle test with the fake provider refusing |
| a prose or truncated answer | that pass only falls back; the clip stands | settle tests |
| a graphic that cannot be baked | dropped from the export with a note; the export succeeds | `graphic.int` |
| WebGL unavailable | 3D templates dropped with a note; 2D ones draw | graphic test |
| no Pexels key | the source greyed: "add a key in Settings" | panel test |
| offline | each source's search says so; nothing half-written (staging then rename); Get transcript says so and the start and end fields stay | `webFetch` test; `ingestPanel` component test |
| a number from a YouTube track | the graphic is a proposal, "check the number", until Keep | `directorGraphics` test |
| a link with no captions and no Python | M0: "This video has no captions", the start and end fields as today, Listen to it greyed with "needs the AI helper"; Best clips adds "Best clips needs the AI helper to listen to it" | `ingestPanel` component test (§3b.8); panel test |
| Windows | every render check above runs in CI on the 2018 build | CI, read after every push |

---

## 15. Measure before relying — the open measurements

Each is named in its step, and each step's first task is its own row:

1. MediaPipe: **measured on the user's Mac** (it survives, the full-range
   model is accepted, 5 ms a frame at 360×778, CPython 3.14.6; §4.1). Still
   open: the Surface (no Metal; the Windows wheel), mediapipe 1.0.1, the
   worker's import and start-up time, the cost at the 640 px edge, and
   recall and false boxes against hand marks on the ten clips. The YuNet
   comparison is not run (§16.1 answered); YuNet's hand decoder and its
   golden test only if the Surface run fails (§4.1, §4.3).
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
13. YouTube ASR word timing against faster-whisper on three videos (step
    4); **three unpunctuated tracks (one Hindi or Telugu) segmented**, and
    the grapheme estimate for word ends set from them (§7.2; in M0, §3b.9).
14. **The exact cut's first frame against its source**, cross-correlated as
    the fast cut was, on both builds: the real yt-dlp test in CI, or **on
    the Surface** if CI cannot run yt-dlp; the fast-cut head offset on more
    videos (§7.1; M0's exit, §3b.9).
15. Whether low-view videos carry a heatmap (§7.4); whether the metadata
    subset's `channel`, `uploader` and `webpage_url` print as expected
    (§7.1; M0's first task, §3b.1).
16. *(Removed 2026-10-05: the X capture window is out, §8.4, §17. The
    number is kept so no reference moves.)*
17. Pexels' licence, guidelines and rate limits, read in a browser (§11).
18. The schema.org paywall signal on three news sites (§9).
19. Electron `net.fetch` against Node fetch behind a proxy (§8.2).
20. three.js flat colour and edge alpha against the 2D painter (§9).
21. pyautoflip on the ten clips, run once in a scratch venv on your Mac
    (Python 3.13 or older: it refuses 3.14), and rated beside ours at step
    1's exit (§4.1, §4.10).
22. The stacked two-up (`split`, two keyed `crop`s, `vstack`) on the 2018
    build, through §4.9's two-up rows in Windows CI (§4.7, §13).

---

## 16. Decisions for the user

Each has a recommendation; nothing here reopens a settled licensing or
sourcing question. **Answered 2026-10-05 (evening).** Each item now ends
with its answer line: your own words where you answered; "taken as
recommended unless you say otherwise" where you did not; and **OPEN**, with
what is needed, where the answer waits on something not yet in hand.

1. **The face detector.** MediaPipe was agreed; the first draft of this
   plan leaned to YuNet on three measured costs and one open question
   (whether the full-range model is accepted). **You then ran the test on
   your Mac** (2026-10-05, §4.1): the abort was the sandbox hiding Metal, and
   the open question is answered:
   - it **runs** where Metal exists;
   - the **full-range model is accepted**, and had a detection on 57 of 80
     frames where the short-range one had 1, at 5 ms a frame (six of the
     seven printed boxes sit on the face; one is a false box on a pillar).

   The other two costs are answered by how it is installed (§4.3): with
   `--no-deps` and three empty stub files, the way the measured run imported
   it, the ~65 MB of opencv-contrib-python and matplotlib is not installed
   (0.10.35 is then ~18 MB of wheel on the Mac; 1.0.1 would be ~34 MB), and
   no real `cv2` is installed, so there is no clash with mask tracking. Still
   unmeasured: the Surface, mediapipe 1.0.1, and recall and false boxes
   against hand marks.

   YuNet is 0.23 MB on the installed onnxruntime and ran at ~10 ms a frame
   on random input, with accuracy unmeasured; on onnxruntime it needs a
   hand-written prior decoder and NMS (half a day, golden-tested against
   `cv2.FaceDetectorYN` once in a scratch venv).

   **Recommendation, changed because the measurement changed:** take
   MediaPipe's full-range model now, in a child process, installed the stub
   way. Skip the comparison; 1a keeps the scene-threshold measurement and
   an hour's sanity check of the boxes on your ten clips. YuNet is the
   fallback if the Surface run fails, with its decoder built then.
   MediaPipe's survival and speed are measured on this Mac and YuNet's are
   not; neither one's accuracy is, so the hour's sanity check counts false
   boxes as well as misses, and YuNet would cost half a day before it could
   even be compared.

   **Answer (2026-10-05):** MediaPipe — "media pipe is good". The
   full-range model in a child process, installed the stub way; the
   comparison is not run; YuNet is the fallback if the Surface run fails.
   The OpenCV face model you asked about is YuNet itself (OpenCV's
   `cv2.FaceDetectorYN` wraps it), so it is that fallback; the older Haar
   cascades the `cv2` wheel ships are not considered (§4.1). 1c is 2 days and
   step 1 half a day shorter (§2).
2. **Per-shot crops as one followed clip** (recommended: one decoder, a
   clean timeline, it re-solves on an aspect change) **or split at each cut**
   (works today and is measured, but 40 pieces for a podcast, +21 % export
   at 30 shots, and a seek per cut in the preview). And within the
   recommendation: **the crop compiled from the subject track every time it
   is read** (recommended: speed, ramp, frame-rate, trim and split edits are
   right by construction) or keys stored on the clip and re-derived inside
   each of those edits (a list the next edit forgets).

   **Answer (2026-10-05):** taken as recommended unless you say otherwise:
   one followed clip, its crop compiled from the track every time it is
   read.
3. **Two people too far apart for one crop.** v1 frames the nearer face with
   a note. A stacked two-up (both faces, one above the other, as podcast
   clips do) on the grid's rails: in step 1 (+2 days) or later?

   **Answer (2026-10-05):** yes, in step 1 (+2 days): the stacked two-up of
   §4.6 rule 3 and §4.7, with **Stack two people** on by default in the
   dock. Framing the larger face stays only for a face lost, with the
   toggle off, or for a portrait source going to 16:9 (the two-up runs on
   x only).
4. **Florence-2's route.** Python ORT with a hand-written loop
   (recommended: same process, same download path), or Transformers.js in
   main. And: is BiRefNet's salient box enough for unnamed subjects, with
   Florence only for a typed phrase (recommended until 1g's gate)?

   **Answer (2026-10-05):** taken as recommended unless you say otherwise:
   Python ORT with the hand-written loop; the salient box for unnamed
   subjects, Florence only for a typed phrase until 1g's gate.
5. **A face fixture for the tests.** You record ten seconds of yourself
   (recommended: rights-clean, and a real face), or a PD/CC0 Commons clip.

   **Answer (2026-10-05): recorded.** `references/recordings/face-fixture-2026-10-05.mov`
   (gitignored like the other recordings; `REFERENCES.md`): 26.6 s,
   landscape 3840×2160 HEVC at 30 fps, no rotation tag, AAC stereo. The face
   enters at about 7 s, moves across the frame, looks away, points, and
   leaves at the end, which exercises the pan, lost-face and static-first
   rules in one take. It stays on each machine that runs 1c's tests; the
   detector run on it is `sidecar/scripts/facetest.py` (§4.1).
6. **Homes in the window.**
   - Best clips: inside the URL tile (agreed).
   - Graphics: a section of the Transcript tile, plus Clip it and Direct
     (recommended), or a new Shelf tile, which changes sheet 20's order.
   - B-roll: the same question.
   - Sheet 13's "set 5 / set 10" placements later, or now?

   **Answer (2026-10-05):** taken as recommended unless you say otherwise:
   graphics, and by the same recommendation B-roll, as sections of the
   Transcript tile (B-roll also in Best clips), with no new Shelf tile, so
   sheet 20's order is unchanged; sheet 13's "set 5 / set 10" later (v1 is
   thirds, §5.2). M0's rows live in the URL tile and the Transcript tile
   (§3b.2).
7. **Graphics above the look (ungraded, like cards; recommended) or under
   it.**

   **Answer (2026-10-05):** taken as recommended unless you say otherwise:
   above the look, ungraded.
8. **Naming.** The new `GraphicSpec`, with the old `GraphicsSpec` renamed
   `CaptionLayersSpec` (recommended; it is 36 sites, mechanical).

   **Answer (2026-10-05):** taken as recommended unless you say otherwise.
9. **One `SELF_DRAWN_FIELDS` constant** that every guard reads, so the next
   kind is a one-line change, with membership tests kept per site
   (recommended, done in 3a), or the spelled-out lists as today.

   **Answer (2026-10-05):** taken as recommended unless you say otherwise:
   one constant, done in 3a.
10. **Which graphics a Clear removes.** Direct's join `DIRECTOR_RULES`; Clip
    it's and the Transcript tile's have their own Clear (recommended).

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.
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

    **Answer (2026-10-05):** taken as recommended unless you say otherwise,
    every bullet as written.
12. **The URL transcript.** `-orig` timing with the uploader's text where
    both exist (recommended); Whisper on the download when neither exists.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise;
    M0 builds it (§3b.1), and Whisper arrives as Listen to it (§3b.5).
13. **Clip it from a link: the exact cut or the fast one.** Open until the
    exact cut's first frame is cross-correlated against its source (§15
    row 14): only its container start (0.000) was measured, and the 2018
    Windows build has never run under yt-dlp's section cut. Lean: exact, if
    it measures frame-exact on both builds.

    **Answer (2026-10-05): OPEN until measured.** Needed: the exact cut's
    first frame against its source on both builds, which is now M0's exit
    (§3b.9). Until then M0 keeps the exact/fast toggle (today's default is
    fast, `store.ts:1055`), and Clip it from a run defaults to exact, the
    lean.
14. **Keys in settings.json.** The Brave key goes into `safeStorage`
    regardless (it is backed by your card, §9). The rest stay plaintext like
    the Director's and the voice's (recommended for now), or all move to
    `safeStorage` together.

    **Answer (2026-10-05): moot.** Brave is out (§16.16), so no key backed
    by a card remains. Every key stays plaintext in `settings.json` like the
    Director's, as recommended for the rest, and no `safeStorage` is built.
15. **The share-alike switch** is a main-owned setting, and **Wikipedia
    extracts sit behind it too** (recommended: they are CC BY-SA 4.0 text,
    and a trimmed extract is a modification). Each BY-SA file is badged and
    explained at its own click whatever the switch says.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.
16. **Brave Search.** Its terms forbid storing results beyond transient
    storage, deriving from and redistributing them, and using them to
    create, evaluate or train AI models. It costs $5 per 1,000 searches
    after $5 of free credit a month, charged to the card it needs at sign-up.
    **Recommendation:** use it only to find URLs, and quote the fetched page;
    a hard cap of 900 searches a month, shown in Settings, so it never
    costs you anything; no Brave fixtures and no eval over its results. No
    card shows Brave's own snippets or results unless you read the Terms' §3
    and decide otherwise.

    **Answer (2026-10-05):** Brave is out of v1 — "the brave too I guess LM
    Studio has inbuilt the web scraping so we don't need it additionally".
    It is dropped on its own merits (a card on file, a per-use cost past
    the free credit, the terms). On LM Studio, a web search for this
    revision found that its web search comes through MCP servers used in
    its own chat window, not through the API the app calls, and Ollama has
    none; so the app keeps fetching and the model keeps extracting (§9).
    Step 6 is a day shorter; Brave's measured prices and terms are kept in
    §17.
17. **News.** Google News RSS is ruled out by its own terms. Headline cards
    come from a pasted article link (recommended for v1); find a feed with
    acceptable terms later? **And a change from what was agreed**: the
    direction said "the newspaper clipping tool fits". The review found that
    a real outlet's name as a print masthead is a mock-up of a page that
    never existed, and that `og:title` can carry a byline the headline does
    not (measured). Recommended: a plain web-article card (headline,
    "site · domain · date", "Opinion" when it is one), and the clipping
    kept for the user's own playful headlines.

    **Answer (2026-10-05):** confirmed: the plain web-article card from a
    pasted link. In your words, the newspaper clipping is for "the
    different purposes like a meme or something or to make fun or false
    claims as jokes, so it's different". So the clipping stays your own
    playful tool (`PaperSpec` untouched, §8.3) and never carries a real
    outlet's name; a feed with acceptable terms is later.
18. **X post cards.** X's own embed captured from a hidden window (agreed;
    capture to be measured). **X's display rules are now read**, and they
    remove the fallback: our own card would break the logo, avatar and
    no-mock-up rules, and oEmbed carries no avatar. So: if capture does not
    work, there is no X card in v1. The post is always shown whole, and X
    cards are refused in Director ads (X forbids using posts to promote
    without the author's permission). The post author's rights are yours to
    clear.

    **Answer (2026-10-05):** your idea — "instead what we gonna do is we
    will make new cards of kinds in our assets and the user will pick in
    the custom or we can give any card randomly if they select" —
    **confirmed in the paste-only form**: "it's only a normal card, like an
    edit, not as a claim". It is the social quote card of §8.4: every field
    typed or pasted by you, drawn in our six styles, picked by you or by
    Surprise me; no X logo, no avatar, nothing shaped as a post, and
    nothing fetched from X. The capture window is out (§17), and step 5 is
    1.5 days shorter.
19. **Page cards** as our own graphic (recommended, consistent with the
    headline rule), or a screenshot of the page (it would carry the outlet's
    photos and layout).

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.
20. **How credits reach the viewer.** Copy for the description, with
    EXPORT's Done line saying "N credits required — Copy" until you copy
    them, and `credits.txt` as a record (default); an on-screen credit line
    as an option?

    **Answer (2026-10-05):** taken as the default unless you say otherwise;
    the on-screen line as the option §8.9's render check already covers.
21. **Thumbnails.** Pressing Search is consent for the thumbnails
    (recommended); every full file is its own click.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.
22. **The network stack.** Move the new fetchers (and later the old ones)
    to Electron's `net.fetch` for the system proxy (recommended once 15 is
    measured).

    **Answer (2026-10-05):** taken as recommended unless you say otherwise,
    once its measurement (§15 row 19) is in.
23. **The contact address** in the User-Agent Wikimedia asks for.

    **Answer (2026-10-05): OPEN.** Needed: the address (an email, or a page
    on 3dit.meme) to put in the User-Agent; §8.2's fetcher waits for it.
24. **The old parallax bakes** in `~/.cache/forge/parallax` (264 MB):
    migrate into `userData/cache`, delete on first run, or leave them.

    **Answer (2026-10-05): leave them** — "keep it for now, it's only
    264 MB". §3.5 moves new caches under `userData/cache` and never touches
    the old folder.
25. **Two edits to `BETA.md`**, made when you say yes: §3.2–3.4 (the split
    click, the frozen or slowed zoom, the late held key) move into R2 as
    beta blockers, since they are bugs in what ships today; and R4's "Not
    for the beta" is replaced by the full route as Step P (§3a), matching
    `SHEETS.md:806-809`. Recommended: both.

    **Answer (2026-10-05):** both — "yeah". Made the same day: `BETA.md` R2
    lists §3.2–3.4 as items 7–9, R4's full route points to Step P (§3a),
    and its status block says the beta now follows this plan.
26. **M0: Transcript → Clip it first** (about 2 days, moved forward, not
    added): row selection, `clipToRange` and `timelineFrameAt`, ahead of
    step 1, since you called it the most important feature and it needs no
    Python where a transcript exists. Recommended; the agreed order stands
    if you decline.

    **Answer (2026-10-05):** yes, and redefined by you: the URL transcript
    from yt-dlp's captions, rows you pick by text or by start and end
    handles, Clip it downloading only those words, Add another clip,
    chapter chips, the start and end fields kept for a video with no
    captions, and the timeline half. That is §3b: 7.5 days moved from
    step 4, built first, after §3.3's half day.
27. **The order against the beta**: beta R1–R12 → M0 → M1 (shipped only
    with Step P) → M2 → M3 → beta.2 → M4 → M5 (recommended), or this plan
    before the beta.

    **Answer (2026-10-05):** this plan before the beta — "will finish this
    and will get back to the beta". §3.3 → M0 → the rest of step 0 → M1
    (shipped only with Step P) → M2 → M3 → M4 → M5 → `BETA.md` R1–R12 →
    R13 → R14 (§2).
28. **Step 7's saved templates** wait for `MARKET.md` Stage 0, or move to
    §17; the creator style may come forward with step 3's styles.

    **Answer (2026-10-05):** taken as §10 writes it unless you say
    otherwise: the saved template waits for Stage 0, and the creator style
    stays in step 7 unless you ask for it with step 3's styles.
29. **Clip it into a project that already holds an edit**: a new 9:16
    project per clip (recommended), or appended to this one with its aspect
    unchanged. Clip it asks either way and never re-crops the existing edit.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise,
    for Best clips' cards (step 4). M0's Clip it from a run lands as today's
    ingest does, in this project with its aspect unchanged (§3b.4): it
    neither reframes nor changes the aspect, so it has nothing to ask.
30. **Graphics from Clip it and Direct**: placed and listed with Drop, with
    only those whose number came from a YouTube track or an unsure Whisper
    word held for Keep (recommended), or every graphic held for Keep.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.
31. **The speaker's name on a quote**: a Speaker field per asset in the
    Transcript tile for your own footage, and yt-dlp's channel for a link
    (recommended), or no names on quotes in v1.

    **Answer (2026-10-05):** taken as recommended unless you say otherwise.

---

## 17. Out of this plan, on purpose

- A per-shot zoom on reframed footage (crop size cannot animate; zoompan on
  video needs step 0's `fps=` fix measured on the 2018 build first).
- Active-speaker detection and cutting to the speaker.
- Mask tracking.
- Speed-aware captions and props: they share §3b.6's inverse later, and
  graphics refuse retimed clips until then.
- Storyboard thumbnails on Best clips cards.
- TransNetV2; Google's AutoFlip (a C++ MediaPipe graph with no wheel);
  `cropdetect`; YOLO.
- **`pyautoflip`** (0.2.1, MIT, fetched 2026-10-05; §4.1) as the reframe
  engine. It outputs a rendered video file, not a crop path the timeline
  can hold: no preview equal to the export, no dragging a shot, no re-solve
  on an aspect change. Its dependency stack includes torch and torchvision
  (installed size unmeasured) and brings `opencv-python` beside
  MediaPipe's `opencv-contrib-python`, the `cv2` clash §4.3's stubs avoid;
  and it refuses Python 3.14. And it is a 23-star project. It is used only as
  a baseline: run once on the ten clips in a scratch venv, rated beside ours
  (§4.10), never shipped.
- **X embed capture** (the first draft's §8.4), replaced by the user's own
  social quote card. Kept as measured: keyless `publish.x.com/oembed`
  returned the post's text, author and date as JSON with no avatar
  (`publish.twitter.com` 301s to it; a missing post answers 404 HTML, so
  content-type must be checked; `widgets.js`, 94 KB, draws the card in a
  cross-origin iframe), and X's display requirements (read 2026-10-05) ask
  for the logo, avatar and timestamp and forbid mock-ups of posts; neither
  is used now, since the app fetches nothing from X. Kept as read, for any
  later window that loads remote content: `forge-media:` serves any
  absolute path with `Access-Control-Allow-Origin: *` on the default
  session (`mediaProtocol.ts:64-86`, `index.ts:16-37`), so remote
  JavaScript there could read `settings.json` and the keys. Such a window
  must use its own in-memory partition (`session.fromPartition`), with no
  preload and `sandbox: true`.
- **Brave Search** (the first draft's search card and step 6's key). Kept
  as measured on 2026-10-05: $5 per 1,000 requests after $5 of free credit
  a month, with a card on file. Its Terms (1 Sep 2026) forbid storing
  results beyond transient storage and using them to create, evaluate or
  train AI models. Its API answered 422, not 401, to a missing or an
  invalid `X-Subscription-Token`.
- Fine-tuning of any kind.
- The template store (`MARKET.md` Stage 2+).
- Two existing leaks found by reading:
  - `forgetPaperPreview` and `forgetCarouselPreview` are never called
    (`Preview.tsx:645-671`);
  - the carousel never disposes a rebuilt scene (`carouselCanvas.ts:128-141`).

  Both are worth a small fix of their own; neither blocks this plan.

---

## 18. Done means

- The seven bars in §0 met and recorded: the ten reframe clips (with
  pyautoflip's baseline beside them), the ten Best clips links, the
  graphics eval in `EVAL.md`, a real B-roll session with a social quote
  card, Clip it on the Surface without swapping. And M0's exit (§3b.9): its
  ten links.
- Step P's exit met before any Python half shipped in an installer.
  `BETA.md` R2 and R4 were edited on 2026-10-05 as decision §16.25 says,
  and §3.2–3.4 are fixed here in step 0, so they are done when the beta
  resumes.
- **Then the beta**: `BETA.md` R1–R12, R13 and R14 follow this plan (§2,
  §16.27).
- Every row of §14 has a rendered output in `tests/output/` and a test.
- Every "dated" row of §13 has become "in CI" on the Windows build.
- Every regression test above has had its bug put back and failed.
- Every measurement in §15 is in `EFFECTS.md` (§37 on), or has changed the
  plan where it disagreed.
- `WHERE-THINGS-ARE.md` has every new control. `LLM.md` §Built records
  `graphics@1`, `broll@1` and the Best clips pass. `SHEETS.md` sheets 13, 14,
  25, 26 and 27 are marked built. This file's steps are marked DONE with
  their commits.
