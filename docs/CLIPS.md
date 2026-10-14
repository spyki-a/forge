# Clips — from a landscape talk to a vertical clip that explains itself: the plan

> **Status, 2026-10-14.** Built since, each with its Built note in place:
> step 0 (§3.1–§3.7); M0 (§3b, run on your ten links, §3b.9); and step 1's
> 1b to 1f with the UI, the harness check and the render check (§4.2–§4.9;
> 1d's salient box is in the helper, but no job calls it, §16.35). Not built:
> 1g, step P, and everything from step 2 on. **Step P is planned, not
> built** (2026-10-14): §3a is written in full, revised after two reviews,
> at 9.5–13 days, with §16.36–50 open for you. Step 1's exit waits on
> runs only you can make (§4.10). Nothing after `d7244ce` is pushed: all
> of 1f, its render half and its action half, waits for your push and
> Windows CI.
>
> **As written, 2026-10-05, when nothing here was built.** This is the plan for the
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
  not on disk (the face finder, BiRefNet 115 MB, Florence-2 275 MB,
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
| a subject box | `ParallaxBake.subjectBox` (`timeline.ts:752-777`): BiRefNet's matte bbox, normalised 0..1 to 4 dp, for stills only (`sidecar/forge_sidecar/capabilities/depth.py:291-318`); consumed by the one-photo reel (`store.ts:2297-2309`) | the box convention, the normalised→pixel conversion, and a salient-subject model (115 MB; on disk on the dev Mac, **a download for any user who never baked depth**, §4.4) |
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
| **P** (§3a) | **BETA R4's full route**: the app installs its own Python pack under `userData` | 9.5–13 (planned 2026-10-14, §3a; `BETA.md` R4 had 5 to 10; 9–12 if the speech model's press waits, §16.49) | — | every Python half below reaches an installed user |
| **1** | the reframe engine: scene cuts in main, faces (MediaPipe), a salient box, Florence-2 grounding, the crop path with the stacked two-up, the followed crop, "Reframe to 9:16" | 17.5 (1g Florence is 3 of them, gated by its own measurement; 18 if the Surface run fails and YuNet's decoder is built) | 0; P for faces on an installed machine | a landscape talk becomes a 9:16 that follows its subject, frame-exact at every cut, and two people too far apart share the frame |
| **2** | caption free space | 2.5 | 1 | captions stay off faces, stable within a shot |
| **3** | the graphics engine (six 2D templates), the graphic style, the Director's third pass with its validator | 14.5 | 2 for placement (degrades to the style's third without it) | a spoken number becomes a counter that lands on the word, and nothing unsaid is ever drawn |
| **4** | Best clips in the URL tile: windows, signals, the model's pick, three cards, Clip it from a card | 3.5 (M0 took 7.5 of its 11) | M0; 1–3 (each optional at run time) | a link becomes three clip cards and a 9:16 clip with captions |
| **5** | B-roll: the Pexels key, the sources, the social quote card, credits, the person rule | 14 | 3 (cards are templates) | pictures arrive licensed, credited, and only by click |
| **6** | retrieved-fact cards (Wikipedia, page, answer-with-sources over fetched text); the 3D templates | 7 | 3, 5 | facts from outside, with their sources; three.js graphics |
| **7** | creator styles and saved templates | 4.5 | 3; **`MARKET.md` Stage 0** (below) | toward `MARKET.md` Stage 1 |

**About 75.5 working days, plus Step P's 9.5–13: about 85–88.5 days,
seventeen to eighteen weeks, honestly counted.** (P was held at `BETA.md`
R4's 5–10 until it was planned in full on 2026-10-14, §3a; the plan and its
two reviews put it at 9.5–13, with two open-ended risks left uncounted.)

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

76.5 + (7.5 − 7.5) + 2 − 0.5 − 2 + 0.5 − 1 = 75.5. With Step P's 9.5–13
(§3a's table, 2026-10-14), 85–88.5 days.
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

> **Built 2026-10-08** — `src/shared/media.ts` (`displayRotation`,
> `uprightSize`: the display matrix's angle negated and folded as ffmpeg's
> `get_rotation` does, the sides swapped at 90 and 270; the `rotate` tag is
> never read, because the 2018 build's decoder reads only the matrix,
> `cmdutils.c:2175-2192` at f22fcd4), `src/main/ffmpeg/probe.ts` (the asset's
> size is the upright one; `MediaInfo.rotation`, and `MediaAsset.rotation`
> when it is not 0 — `src/shared/types.ts`, `src/shared/timeline.ts`,
> `src/main/assets.ts`), `src/main/imports.ts` (`exifOrientation`,
> `needsReadableCopy`: a still tagged 2–8 is turned by sharp's `rotate()`
> into the converted cache, `source` kept, on import and on relink; a JPEG's
> copy is a quality-95 4:4:4 JPEG — 3.5 MB in 193 ms where a PNG was 28 MB in
> 635 ms for 12 megapixels, and 47 dB from the lossless turn), the render
> check `tests/integration/rotation.int.test.ts` (into
> `tests/output/rotation/`) and `tests/mediaRotation.test.ts`. Measured: the
> 90° remux decodes as the coded frame through `transpose=cclock`, exactly;
> neither build turns a JPEG by its EXIF (4.4 run, f22fcd4's `mjpegdec.c`
> read). The render's fit was never wrong — the reframe was: `solveCrop` cut
> a 202×360 "9:16" out of a frame that was already 9:16, and a 540×960 export
> differed from the upright picture by **83.7** (the 90° clip), **80.3** (4K
> tagged 270) and **99.4** (the EXIF-6 photo) mean levels; after, **0.39 /
> 0.30 / 0.48**, with no crop. The probe's size equals the decoded frame's
> for the untagged clip, both tagged clips and the turned copies of
> orientations 3, 6 and 8, and a relink to the orientation-6 photo goes
> through a turned copy too, as does the copy `locateAsset` remakes when the
> cache has lost it. In the helper, `media.probe_upright` and
> `media.require_upright` (§3.6); no capability today is sent a size by main,
> so the refusal's first caller is faces.py (§4.3). Mutations: the probe
> ignores the matrix (4 failures), the import ignores EXIF (3), the relink
> alone ignores it (1), and in the unit test the tag read as a turn, a half
> turn swapping, the angle not negated.
> Found on the way: any `-ss` before a JPEG decodes nothing, so the helper's
> `decode_rgb` never seeks a still. Not measured: Electron's `<video>` of a
> rotated clip (Electron exits SIGTRAP in the sandbox; R12's smoke test).
> Not handled: assets imported before keep their coded size until
> re-imported, and relinking such a still to its tagged file hands ffmpeg the
> turned copy under that old size (the relink keeps the asset's width and
> height). **The 2018 build is Windows CI's run of the check on the next
> push.** `EFFECTS.md` §49.

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

> **Built 2026-10-07** — `src/shared/render/keyframes.ts` (`keyframeExpression`
> ends each picture segment at `(start + (frame − 0.5)/fps).toFixed(6)`, the
> opening boundary too; a new `boundary: 'instant'` keeps the old
> `(frame/fps).toFixed(4)` for the volume envelope, passed in
> `src/shared/render/plan.ts`), the render check in
> `tests/integration/keyframes.int.test.ts` (into `tests/output/held-keys/`:
> opacity held 0 → 1 at frames 4, 5 and 8 at 24, 25 and 30 fps, every frame
> decoded, plus an eased curve held to `valueAt` at every frame), and
> `tests/keyframes.test.ts` / `tests/maskKeyframes.test.ts` (text pins
> replaced by evaluated steps). Measured through `buildRenderPlan`: before,
> 30 fps keys 5 and 8 lit on **6** and **9**, and 24 fps key 4 on **5** — at
> 24 and 60 fps every key on a frame ≡ 1 (mod 3) is late, which the plan did
> not list; after, all nine on their key. The eased control is unchanged
> but for frame 8 (252 → 253 mean, the old segment's p = 0.99967 there).
> **The sound is not moved**: the envelope steps on 2048-sample audio frames
> at or after its key (2–37 ms, sixteen keys measured), and on the half
> frame three came in before it (to −10.7 ms), so it keeps the instant,
> byte-identical; `tests/integration/volumeEnvelope.int.test.ts` renders
> that (30 fps keys 4 and 8 in at +37.33 and +32.00 ms, never before the
> key). Mutations: the four-place boundary back, 7 failures (the 30 fps
> frame-5 row first lit on 6); the envelope's `'instant'` dropped, the plan
> test and both held-volume renders fail (−5.33 and −10.67 ms).
> `EFFECTS.md` §45.

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
> samples, derived. **Windows CI run 37410645171 on `9a85d9f`: green on the
> 2018 build.** `EFFECTS.md` §39.

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

> **Built 2026-10-07** — `src/shared/render/plan.ts` (`zoomKeyframeFilter`
> takes `moving`: for footage, and for a moment's drawn frames, it emits
> `fps=${fps},zoompan=…:d=1:…:fps=${fps}`; a photograph keeps
> `d=<length>`), the render check `tests/integration/zoomVideo.int.test.ts`
> (into `tests/output/zoom-video/`: 60 fps 3 s and 29.97 fps 20 s sources
> with AAC, plus a moment's 30 fps PNGs, each frame's index drawn as bars and
> read through the zoom, against the unkeyed export: length, stream starts,
> every frame's source index, frames 0 / mid / last through zoompan's own
> window), and `tests/oldestFfmpeg.test.ts` (the shape in `SHAPES`, `fps=30`
> before its zoompan and `d=1`). Measured through `buildRenderPlan`: before,
> all three froze on source frame 0 (**the moment's frames too**, which the
> plan did not list; the Keys tab offers Zoom on them); after, every frame is
> the unkeyed export's, frames 0 / mid / last within 0.55 of a level. The
> export's length never showed the bug (the overlay gates the clip's
> stream), so the per-frame index is the check. `d=1` alone: 60 fps at half
> speed, 29.97 one frame ahead from frame 500; behind the trailing `fps=`
> the 60 fps chain alone made 46,080 frames over 1,536 s (zoompan forwards
> its input's EOF pts unrescaled, `vf_zoompan.c:310` at f22fcd4, read).
> zoompan's window rounds x down to the chroma grid (`:183`), modelled in
> the check. No refusal was needed on the Mac; **the 2018 build is Windows
> CI's run of the check on the next push**, so `Keyframes.tsx` and
> `CurvePanel.tsx` are untouched. Mutations: `d` back (all three frozen),
> the leading `fps=` dropped (60 and 29.97 fail, the 30 fps moment passes),
> the predicate video-only (the moment fails). `EFFECTS.md` §46.

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

> **Built 2026-10-08** — `tests/oldestFfmpeg.test.ts`: `/\bscdet\b/` on
> `TOO_NEW` (the Mac build has it: 15.625 on a red → blue cut, re-measured),
> and `ANALYSIS_SHAPES` — the chroma-key probe, the nine encoder probes, five
> shapes of a moment's footage pre-pass, a steady clip's `vidstabdetect`
> pass as main runs it, a voice-over's conversion, the Converter's presets,
> and the helper's `media.frame_args` / `media.decode_args` asked of its own
> interpreter — scanned by the same blocklist, with an `it.todo` as the hook
> for `sceneArgs` (§4.2). Mutations: `scdet` in the chroma-key probe, and in
> the helper's frame stream, each fails its shape; the frame stream's seek
> dropped fails the test that the shapes reach what they say. **The caches: the text
> below was wrong — `client.ts` did not set `FORGE_CACHE_DIR`**, only
> `FORGE_MODELS_DIR`, which is why bakes fell to `~/.cache`. Now
> `src/main/sidecar/client.ts` (`cacheDir`, the pure `sidecarEnv`) and
> `service.ts` (`helperFolders`) pass `userData/helper-cache` — not
> `userData/cache`, which on a case-insensitive disk (the APFS default, NTFS)
> IS Chromium's own `Cache`, measured — and depth.py bakes in
> `media.cache_dir("parallax")` (§3.6). Measured: a fresh bake through the
> client landed in `<userData>/helper-cache/parallax/<key>/`, and
> `~/.cache/forge/parallax` kept its 40 entries and 264 MB with nothing
> newer; nothing reads, moves or deletes it. Tests: `tests/sidecarFolders.test.ts`,
> which reads the env the helper is handed at `spawn` (mutations: the variable
> dropped from `sidecarEnv`, 2 failures; `start()` building its env inline
> again, the service passing the models folder only, the folder named
> `cache` — 1 each) and, on the helper's side, `cache_dir` and depth's folder
> in `tests/sidecar/test_media.py`. Not yet under it: `stems.py`'s Demucs
> cache, still `~/.cache/forge/stems` because main sends no `outDir` (a
> change of its own, with the same old-folder decision). `docs/SIDECAR.md`;
> `EFFECTS.md` §50.

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

> **Built 2026-10-08** — `sidecar/forge_sidecar/media.py` as below, plus
> `display_rotation`, `require_upright` (raises `SizeMismatch`), the pure
> `decode_args` / `frame_args` and `progress_class`; the folders return
> `str`, as every caller joins with `os.path`; nothing beyond the standard
> library at module level. `depth.py`, `vision.py`, `asr.py` and `voice.py`
> moved onto it: for sixteen stills the sizes, two decodes' bytes and every
> measure were byte-identical before and after, and the twelve sidecar tests
> and vision's seven passed before and after. depth's two downloads go
> through `media.download`, pinned to the commits already in the app's cache
> (depth `4472b73…`, BiRefNet `de15b22…`) and mapped into the bake's own
> progress span: 138 ms from the cache against 4.9 s unpinned (a Hub round
> trip), and a real 19 MB download forwarded its bytes in three messages
> (huggingface_hub reads 10 MiB chunks). Streaming, measured through the
> module: 50 frames then stop 0.089 s with the decoder killed; 20 s of 1080p
> at 5 fps and 480×270 in 0.26 s; a seek 48–67 ms. `capabilities/__init__.py`:
> `OPTIONAL` is `[(methods, module)]`, and a failing module is withdrawn and
> degraded whole (`Server.unregister`, `rpc.py`) — `voice.voices` now answers
> −32001 with the reason, where it answered −32601. `protocol.ts` gains
> `voiceSpeak`, `voiceVoices` and `OPTIONAL_METHODS`; `ipc.ts`'s `'audio.beats'`
> and `voice.ts`'s four voice literals use them. Tests: `sidecar.int` gains
> two (every optional method a capability or degraded, and every method
> answered for on the list; both voice methods degraded where kokoro is
> missing, and `voice.voices` unavailable), fourteen now;
> `tests/sidecar/test_media.py` (32 `unittest` cases) run by
> `tests/integration/sidecarMedia.int.test.ts` with the venv (none may skip)
> or the bare interpreter (only the six numpy cases may). The decodes run
> there too: the helper's own `decode_args` / `frame_args` through the bundled
> ffmpeg, read as bytes, and `iter_frames` with a stand-in numpy — the seek
> (red at 0.5 s, blue at 1.5 s), ten frames for 2 s at `fps=5`, the turned
> clip at 180×320 and counter-clockwise (1.95 against 206 the other way),
> cancel → kill — so CI's bare 3.12 measures them on the 2018 build; on bare
> 3.12 and 3.14 venvs here, 26 pass and `system.hello` lists every optional
> method degraded. Each
> module's `OPTIONAL` tuple is held to its own `server.register` calls, read
> from the source. Downloads' guard runs offline, against a stand-in
> `huggingface_hub`. Mutations: register-and-degrade only the first method (3
> failures: both new `sidecar.int` tests and the Python registration case);
> `voice.voices` left out of its tuple, and out of `OPTIONAL_METHODS` (1
> each); in `media.py` the kill, the per-frame cancel, the stream without
> `fps=`, the one-frame decode not seeking, `FORGE_CACHE_DIR`, the matrix, a
> still seeked, a loose revision and a wrong hash kept, depth's own folder,
> and a partial registration kept — each fails its case, and every decode
> mutation fails on the bare 3.12 too. `EFFECTS.md` §50, `docs/SIDECAR.md`.

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

> **Built 2026-10-07** — `src/shared/render/graphFile.ts` (`withGraphFile`,
> one pair counted with `filter`; `filterGraphOf`; `commandLine` for the
> pasteable command), `src/main/render/renderJob.ts` (writes
> `graph-<uuid>.txt` to `RenderOptions.tempDir`, set to `userData/tmp` in
> `src/main/ipc.ts`, spawns the swapped argv; removes the script after a
> finished or cancelled export, keeps it after a failure and logs the
> command with its path; a failed export keeps its captions' `.ass` too,
> which the graph names, and a launch sweep removes both after a week —
> `releasesTemporaries`, `sweepTemporaries`), `tests/graphFile.test.ts`,
> `tests/integration/longGraph.int.test.ts` (through `startRender`, into
> `tests/output/long-graph/`), `tests/fixtures/longGraph.ts`, and
> `tests/oldestFfmpeg.test.ts` (every shape spawned through the swap; no
> `-/option`, which is 7.0). **Two things the plan did not know, measured:**
> (1) the limit is met TODAY by any timeline of cuts — a talk cut into
> **55** pieces is a 33,052-character command line, so it cannot start on
> Windows; with the script the ceiling is about 370 pieces at that path,
> where the inputs alone reach it. (2) **The 360-cut followed clip cannot
> render on either build in any route**: `keyframeExpression` nests one `if`
> per key, and ffmpeg's parser stops at 100 levels (`eval.c`
> `stack_index`), so one track of about 93 keys or more is refused
> (`EFFECTS.md` §48; a flat sum of steps parsed 540 cuts, measured, not
> built — the reframe needs it). So the render check and the unit test use
> a timeline of 72 cuts (graph 35,107, line 41,894; 6,632 after the swap
> for the unit test's Windows paths): 216 frames each on its own source
> frame through `startRender`, the script on disk as the job starts, and
> every decoded frame identical to the inline route's on the Mac; on
> Windows the inline route must be refused. Mutations: the swap skipped,
> the spawn given `plan.args`, the script removed on failure, `indexOf` for
> the count, the `-/` spelling (and, alone, a `-/` beside the script), a
> failed export's captions released, the sweep without its age or its name
> check — each caught by the unit or floor tests; `longGraph.int` fails
> today's `renderJob.ts` on the Mac (no script written) but passes the swap
> mutations here, and is their Windows measurement. `EFFECTS.md` §47, §48.

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

> **2026-10-08, met on the Mac:** all seven items built, each with its test
> or render check; `npm run typecheck` and the full `npm test` exit 0 (246
> files, 3,121 tests, 12 skipped, 1 todo — the `sceneArgs` hook). **Not yet
> met:** §3.1, §3.5 and §3.6 committed and pushed, and one Windows CI run
> green over all seven — which is also the 2018 measurement for §3.1's
> render check, the helper's media tests on a bare 3.12 (its decodes and
> frame stream included, read without numpy) and §3.5's floor
> (§3.3 was green there in run 37410645171; §3.7's refusal was measured in
> run 37668502747).

---

## 3a. Step P — Python on an installed machine · 9.5–13 days (`BETA.md` R4's full route; R4 had 5–10)

> **Planned 2026-10-14; the user took §16.36–50 as recommended the same
> day ("okay go ahead"), and the build began in three slices: P.1–P.2 with
> §3a.8 row 26, then P.3 with P.5, then P.4, P.6, P.7 and P.10; P.9 is the
> user's. Slice A built 2026-10-14** (P.1, P.2 and row 26 on the Mac, with
> row 38 measured beside them; §3a.1's and §3a.2's notes, `EFFECTS.md` §57;
> fourteen commits, `f39a47a` … `4dae71d`, not pushed). Written from three
> readers (the interpreter sources, the wheel set, and the product side
> read from the code). Every size, version, wheel tag and licence below was fetched that
> day from PyPI's JSON (`pypi.org/pypi/<name>/<version>/json`), GitHub's API
> (`api.github.com/repos/astral-sh/python-build-standalone/releases`, the
> `20261001` tag re-read for this text), python.org's release API and the
> projects' own sources on `raw.githubusercontent.com`, or measured on the
> dev Mac (the venv's CPython 3.14.6, Electron 44.3.0's Node 24.20.0).
> Nothing was downloaded but JSON and text, plus 4-byte gzip trailers and
> zip indexes read by byte range, so sizes and DLL lists could be measured
> without fetching an interpreter or a wheel. What was not measured says
> **unmeasured**. Nothing in `src/` or `sidecar/` changed for this plan. The
> URLs are in §3a.11.
>
> **Revised the same day after two reviews**: forty findings, seven of them
> high, several found by both. The reviewers measured more: the PE import
> tables of the Windows wheels' native files, the CPython 3.14 path
> calculation's registry read, the client with a slow fake helper, the
> central directories of all 48 Windows wheels, and `huggingface_hub`'s and
> `httpx`'s network code. Their numbers are cited as theirs, dated
> 2026-10-14. The writer re-fetched the release's asset list, scikit-learn's
> Windows wheel index and CPython 3.14's `getpath.py`, and re-read the code
> each finding names (`client.ts`, `service.ts`, `ipc.ts`, `voice.ts`,
> `separate.ts`, `store.ts`, `binary.ts`, `asr.py`, mediapipe's
> `mediapipe_c_bindings.py`). Each fix is written in place. The two places
> this text goes another way than a review (the days, and development's own
> pack root beside the review's lock) say why where they fall.

**What is wrong.** The installers ship no Python, and a packaged app walks
`service.ts:26-35` to a PATH interpreter: `FORGE_PYTHON`, then
`sidecar/.venv` (which `electron-builder.yml:63-77` filters out, so it never
matches once packaged), then the literal `python` on Windows and `python3`
elsewhere. On a Windows with no Python, `python` is the Store's alias stub:
it exits 9009, the client restarts it three times with backoff
(`client.ts:158-168`) and then says "The AI helper keeps crashing and has
been stopped" (`service.ts:71-73`). On a clean Mac, `python3` may raise
Apple's Command Line Tools dialog (R4, unverified). So every Python half of
this plan (faces for the reframe, Whisper for own footage and for links
without captions, depth, beats) reaches no installed user. Seven smaller
faults sit in the same path:

- **Every helper call can spawn, not only the status ask.** `voiceStatus`
  calls `getSidecar().start()` each time the voice providers are listed
  (`voice.ts:73`). Beats, depth, measure and transcribe (`ipc.ts:718`, `:752`,
  `:799`, `:958`), stems (`separate.ts:38`) and the voice calls (`voice.ts:114`,
  `:148`) call `request()`, which spawns when there is no child
  (`client.ts:203-206`) with `options.python ?? FORGE_PYTHON ?? 'python3'`
  (`client.ts:117`). A fix at the status ask alone leaves the 9009 loop in
  place.
- **A second ask before the first hello spawns a second helper.** `start()`
  returns early only when `running && hello` (`client.ts:108-109`). While a
  hello is out it calls `spawnChild()` again, which overwrites `this.child`
  and resets the decoder both children's stdout feed. At every launch
  `startSidecar` starts one child (`index.ts:244`), and `App.tsx:234-244`
  asks `sidecar:status` on mount, which calls `start()` (`ipc.ts:1005-1012`).
  A reviewer measured it with `client.ts` and a fake helper that answers
  hello after 1.5 s: `start()`, then `start()` 300 ms later, got answers from
  two pids (7087 and 7099); after `stop()`, 7087 was still alive 2.5 s
  later. The window is the hello's duration: tiny on a bare interpreter,
  seconds with the pack's registration imports on a cold Surface. A 30 s
  hello timeout rejects without killing its child (`client.ts:111`,
  `:221-226`), so the next ask spawns yet another. And `stop()`'s SIGKILL
  after 1.5 s (`client.ts:276`) kills only `python.exe` on Windows, so a face
  worker or its ffmpeg survives.
- **A restart that works is never told to the window.** `client.ts:112`
  emits `ready`, but `startSidecar` listens only for `log` and `gaveUp`
  (`service.ts:70-73`), and a crash after `ready` is not told until the
  client gives up. A switch to a newly installed pack depends on that
  broadcast.
- **Two Python controls gate on the process, not the method.** MediaPool's
  Transcribe (`MediaPool.tsx:262-265`) and LinkTranscript's reason
  (`LinkTranscript.tsx:157`, `:183`) read `sidecarReady`. On a bare
  interpreter, where every optional method is degraded, Transcribe is
  offered and fails when pressed. The reframe already gates on its methods
  (`reframeHelperFrom`, `job.ts:247-256`).
- **Transcribe would fetch 464 MB that no button names.** MediaPool's
  Transcribe calls `transcribeAsset`; `ipc.ts:942-970` passes `model` as
  undefined; `asr.py:26-37` builds `WhisperModel(size,
  download_root=models_dir())` with no revision and no local-only flag, and
  faster-whisper 1.2.1's `download_model` calls
  `huggingface_hub.snapshot_download(repo_id, revision=None,
  local_files_only=False)` (read by a reviewer, 2026-10-14). Once P makes
  `asr.transcribe` available, the first press fetches
  `Systran/faster-whisper-small` (464 MB on disk, §12) with no size on any
  button, which breaks §0's click rule; it fetches at `main`, so an upstream
  push changes the model with no press; and every session's first load asks
  `huggingface.co`. Behind a proxy that is set but unreachable,
  `httpx.ProxyError` is re-raised (`_snapshot_download.py:277-279`), so a
  model already on disk will not load. Nothing in `src/renderer` offers the
  speech model, and LinkTranscript's Listen is a disabled button that says
  "soon".
- **The Settings row shows green "Running" for a bare interpreter**
  (`helperState`, `SettingsPanel.tsx:50-54`), which is CI's state and any
  user's own `python`.
- **Neither of today's fetchers can carry the pack.** Both hold a whole body
  in memory (`binary.ts:385-400`, `packs.ts:258-275`), the packs then
  `gunzipSync` the archive (`packs.ts:166`), and `readTar` refuses every
  symlink and skips PAX records (`tar.ts:135-141`), so a member whose name is
  only in a PAX `path` record would be written under its truncated ustar
  name.

**What it is.** A pinned CPython 3.14.8 from python-build-standalone,
unpacked under `userData/python/<pack>/`, with the base pack's wheels (47 on
the Mac, 48 on Windows) installed into its own site-packages by its own pip,
**offline**, from files the app fetched itself and checked against a lock
the app ships. It is started with its own flags and a cleaned environment,
so nothing of a user's own Python reaches it. One press in Settings,
**Install the AI helper · 170 MB** on the Mac and **· 205 MB** on Windows
(§0's click rule: the size is on the button before the press); a row in the
EXPORT strip with its bar and its X; a receipt that is the version; Repair
and Remove, each with its size. A packaged app never spawns a PATH Python
again: with no pack it says **Not installed**, and **no caller starts
anything**. The speech model gets its own sized press (§16.49).

**The bar, unchanged.** No step's Python half ships in an installer until P
is in it, and every Python control stays greyed "needs the AI helper" until
then, never offered as a control that changes nothing (§12).

**Exit** (in full in §3a.9). A clean Mac and the Surface, with no Python of
their own, install the pack from the app and pass the helper's tests from
inside it: `sidecar.int`'s 15, `sidecarMedia.int`'s Python cases with none
skipped, and the capability suites, started **through the pack's own
launch** (its flags and environment), with hello's `sys.prefix` and every
`sys.path` entry inside the pack or the app's `sidecar` folder. CI does the
same on every push on Windows, and on a macOS 14 runner if §16.48 is
answered (b). (The old text said
"the twelve helper tests"; `sidecar.int.test.ts` has 15.)

**The days**, against the 5–10 R4 held:

| piece | days | written in |
|---|---|---|
| row 26 (the pinned archives fetched into a scratch folder and read) and row 19 widened (`net.fetch`, one Hugging Face press and one `fetch_url` press, behind one proxy) | 0.5 | §3a.8 |
| the lock script with its completeness check, the `pack.ts` manifest, the interpreter pins, hf-xet's measurement | 0.5–1 | §3a.1 |
| the interpreter order, `absent` at every caller, the launch with its flags and clean environment, `restartSidecar` with `ready` and `exit` broadcast, `executable`, `prefix` and `path` in hello | 0.5–1 | §3a.2 |
| one helper process: `start()` single flight, a hello timeout that kills, the status ask answered from the broadcast, the Windows tree kill, no `'python3'` default | 0.5 | §3a.2 |
| the fetcher: many files, sha256 and a byte count while streaming, a retry budget per file, the job's own signal, file-level resume, renames retried on Windows, `binary.ts`'s retry lifted with host-named reasons, an injected fetch | 1–1.25 | §3a.3 |
| the streaming tar reader (PAX names, in-root symlinks) and the Windows path check | 0.5 | §3a.3 |
| the pip stage with its progress and cancel; `system.selftest` in fresh processes, mediapipe's library load among them | 1–1.25 | §3a.3 |
| the job on its own queue: stages, Repair that fetches first, Remove, Update, quit, the launch sweep, the lock across app instances | 1–1.25 | §3a.3 |
| the speech model's own press, pinned and loaded local-only (§16.49) | 0.5–1 | §3a.4 |
| the UI: the Settings row in its states, the sized buttons, the pointers, gating by method, the harness bridge and the census | 1–1.5 | §3a.4 |
| tests with their mutations; CI's real install on Windows and macOS 14, its cache, the URL probe, the PE import listing, `pip check`, the suites through the pack's launch | 1.5–1.75 | §3a.6, §3a.7 |
| the clean Mac and the Surface, and what they find | 0.5–1 | §3a.9 |
| docs | 0.5 | §3a.10 |
| **P** | **9.5–13** | |

**Where it lands: 9.5–13, above the 5–10 R4 held.** The first draft of this
plan counted 7.5–10; the reviews added work the plan itself assigns to P
and had left out of the table: rows 19 and 26, the speech model's press
(0.5–1), `absent` at every caller and one helper process (0.5), the PE
import listing and the lock's completeness check, the job's hardening, and
macOS back in the push matrix. *A note on the disagreement:* the review put
P at about 9.5–12.5. This text counts half a day more at the top, because
Repair fetching first, the lock across instances, the receipt removed
first, retried renames, byte counting and a budget per file each come with
a test and a mutation, and the review left them inside the first draft's
rows. If the speech model's press waits (§16.49 (b)), P is 9–12. **Not
counted, and open-ended:** what the capability suites find on their first
Windows run (they have never run there, §12), and a missing Visual C++
runtime on a clean Windows (§16.45). Either can take P past 13. With P at
9.5–13, §2's total becomes 75.5 + 9.5–13 = **85–88.5 days**.

### 3a.1 P.1 — The sources · 0.5–1 day

> **Built 2026-10-14 — slice A, with §3a.2 and §3a.8 row 26.** Not pushed
> (the user's order).
>
> Commits:
> - the sources, `pack.ts`, their two test files and row 26: `cfe25b6`;
> - the fix phase, after three verifiers: `8329e1b` (two of the manifest
>   test's checks), `af61545` (versions in the CI completeness check),
>   `4dae71d` (the pre-CI `bytesOnDisk` from row 26's trees).
>
> Every number below is in `EFFECTS.md` §57, with its command.
>
> **What landed:**
>
> - **`scripts/pack_lock.py`**, run as `sidecar/.venv/bin/python -I
>   scripts/pack_lock.py` (PyPI's JSON and its PEP 658 metadata only; no
>   wheel is downloaded). It writes:
>   - `sidecar/pack/lock-darwin-arm64.txt`, 47 wheels, and
>     `lock-win32-x64.txt`, 48 (colorama by tqdm's Windows marker, the only
>     line beyond the Mac's). **ASCII and LF only**, so their bytes are
>     their sha256 on both platforms: `9932ef36…` and `6ec44386…`. The
>     first run wrote "§" into each header; pip reads a requirements file
>     without a BOM in the Windows code page, so the script now refuses a
>     non-ASCII lock, and the headers cite "3a.1";
>   - `sidecar/pack/resolved.json` (every file's name, size, upload date,
>     URL and sha256; each distribution's raw `requiresDist` and its
>     requirements evaluated per target; the one allowlist,
>     `{mediapipe: matplotlib, opencv-contrib-python}`);
>   - `sidecar/pack/history.json`, pack 1 with one pair of hashes per
>     platform; a changed lock needs `--bump`;
>   - `src/shared/sidecar/packManifest.ts`, `HELPER_PACK`, generated, with
>     every wheel on `files.pythonhosted.org`, the interpreter on the
>     `20261001` tag, `expects` as listed in §3a.2 and `minOs: '14.0'` on
>     the Mac.
> - **`src/shared/sidecar/pack.ts`**, pure: §3a.2's types field for field,
>   `packPlatform`, `isUnsupported`, `parseReceipt`, `receiptMatches`
>   (parses, then platform, then `lockSha256`, then `interpreterSha256`,
>   never the pack number), `packBytes`, `packSizeLabel` and `packHosts`
>   (`release-assets.githubusercontent.com` added wherever `github.com`
>   is).
>
> **The button, as planned to the byte:** the Mac's 47 wheels are
> 151,510,094 B, with the interpreter 178,190,592 B, "170 MB"; Windows' 48
> are 191,876,652 B, with the interpreter 215,104,551 B, "205 MB". A
> verifier asked pip 26.2.1 itself for its pick on `macosx_14_0_arm64` and
> `win_amd64` at cp314: all 95 wheels are the manifest's, by name, URL and
> sha256; none is yanked or `cp314t`; the pinned interpreter's own pip
> accepts all 47 Mac tags; and the script, re-run into a scratch copy,
> reproduced every committed file byte for byte.
>
> **`bytesOnDisk` before CI** (labelled PRE-CI in the manifest, from
> `4dae71d`): 675,024,351 B on the Mac and 728,486,971 B on Windows, the
> packages as measured above plus the pinned interpreter's tree as row 26
> unpacked it, its standard library compiled once (87,081,292 and
> 70,315,292 B). The first generation had added the `20261013` build's tar
> sizes and no compile. `formatBytes` (binary GiB) prints the Mac's as
> **"0.6 GB"** and Windows' as "0.7 GB"; "about 0.7 GB" above holds in
> decimal GB (0.675). Which unit the Settings row means is §3a.4's to say.
> `longestPath`/`longestDir` stay the dev venv's (161/107) and the Windows
> wheels' indexes' (150/96), above the interpreter tree's own: 106/97 on
> the Mac as unpacked (116/97 once compiled) and 105/86 on Windows.
>
> **Where it differs from the text below:**
> - `packPlatform` refuses a macOS major of **17 to 25** as unreadable ("The
>   AI helper could not read this Mac's version (<v>)"). Electron 44.3.0's
>   main process on the dev Mac reads `getSystemVersion()` 26.5.2 and
>   `os.release()` 25.5.0, so a caller passing the Darwin number would have
>   taken macOS 13 (Darwin 22) as supported; no marketing version is in that
>   range. 16 is left accepted.
> - Row 26 answered the "unmeasured" in "What is inside", and corrects four
>   sentences there: every `.pyc` either archive ships is **stale** once
>   unpacked, so the job compiles the standard library once (§3a.3); there
>   is **no `EXTERNALLY-MANAGED`** file and no `._pth`; on the Mac,
>   **OpenSSL 3.5.9 is built into `python3.14` itself** (with `_hashlib`,
>   `_sqlite3` and zlib, which is the system's 1.2.12; zlib 1.3.2 is
>   Windows' `zlib1.dll`), not linked into a separate `_ssl`; CPython's
>   licence is **`python/lib/python3.14/LICENSE.txt`** on the Mac (13,804 B)
>   and `python/LICENSE.txt` on Windows (23,601 B); and the Mac's
>   `python/bin` does hold `pip`, `pip3` and `pip3.14` (234 B sh
>   trampolines). It is `python -m pip` on both regardless.
> - The table's "unpacked" column is the `20261013` build's: the pinned
>   build's tar streams are **69,373,952 B** (Mac) and **63,301,120 B**
>   (Windows).
> - The CI completeness check (`packLock.test.ts`) checks **versions as
>   well as names** (`af61545`): each requirement's specifier is read from
>   the raw `requiresDist` in `resolved.json` (all 143 evaluated
>   requirements of pack 1 have exactly one line naming them without an
>   extra) and must admit the locked version by a PEP 440 subset (`==`,
>   `!=`, `<`, `<=`, `>`, `>=`, `~=`, `==N.*`, a/b/rc, `.post`, `.dev`); a
>   shape it cannot read is a named failure. §3a.7 asked for names.
> - The manifest test's button check compares `packBytes` with
>   `resolved.json`'s `targets[p].packBytes`, not the literal totals, so
>   dropping hf-xet under `--bump` does not fail it (`8329e1b`).
>
> **Tests** (run to a file at `4dae71d` by the recorder):
> `tests/helperPackManifest.test.ts` (45) and `tests/packLock.test.ts`
> (11). Mutations, each seen to fail, each anchor counted first and every
> file restored and compared: 22 by the builder in an isolated copy (a wheel
> dropped from the manifest; opencv added; a `latest` URL; the lock edited
> without its sha256; the lock changed under pack 1; the Darwin guard
> dropped; the version read as Darwin; `translated` ignored on each
> platform; each of `receiptMatches`' checks dropped, and the number
> compared; colorama dropped, and dropped with everything else regenerated
> to match, where only the completeness check names "tqdm -> colorama"; the
> allowlist widened; stems expected; a history entry with one platform;
> each direction of the set check, and `lockHashes`' `matchAll`, weakened;
> the requirement lookup dropped); 4 more by a verifier (the release-assets
> host dropped, a hash upper-cased, one wheel's bytes +1, and hf-xet's
> `cp314t` twin swapped in everywhere the generator writes, which the tag
> test catches); and the fix phase's 10 (one wheel's bytes +1;
> `lockShaProblems` made blind; the Mac lock's header edited;
> `packSizeLabel` rounding by 10⁶; the version admission removed; `<` read
> as `<=`; `~=` without its prefix; a `.dev` sorted as a final; `==N.*` not
> read; an unreadable clause passed).
>
> **Left:**
> - **hf-xet** stays in the lock (3,876,287 / 4,033,128 B) until row 35
>   shows depth's and asr's downloads pass without it; then `--bump` drops
>   it and the allowlist gains `huggingface-hub: hf-xet`.
> - **CI's install (row 28)** replaces the three PRE-CI numbers per
>   platform.
> - **Row 26's Surface half**: `sys.winver`, and `sys.path` with a planted
>   HKCU `PythonCore\<winver>\PythonPath`, with and without `-E`.
> - **pip over the lock** is row 34's. A verifier's `pip install --dry-run
>   --require-hashes --no-deps --no-index` of both locks stopped at "No
>   matching distribution found for absl-py==2.5.0", which proves the
>   syntax only: a malformed `--hash` is not reported before resolution
>   (the manifest test's count of every `--hash=` is what holds that).
> - **The history's order**: `f39a47a` (§3a.2) imports `./pack`, which
>   first lands here in `cfe25b6`, so `f39a47a` alone does not typecheck.
>   Reordering unpushed commits is the user's call; otherwise the push
>   says so.

#### The interpreter

python-build-standalone (astral-sh), the `install_only_stripped` flavour,
the normal (GIL) build, not `freethreaded` (its wheels would have to be
`cp314t`) and not the `debug`, `pgo` or `lto` archives. It is the only
source that puts a working interpreter under a user folder **with no admin
and no installer on both platforms**, and it is what `uv python install`
fetches by default (`uv`'s `fetch-download-metadata.py` lists
`install_only_stripped` first; its `download-metadata.json` carries the same
sha256 GitHub does).

| platform | asset (release `20261001`, published 2026-10-01T22:37:31Z) | bytes | sha256 | unpacked |
|---|---|---|---|---|
| macOS arm64 | `cpython-3.14.8+20261001-aarch64-apple-darwin-install_only_stripped.tar.gz` | 26,680,498 | `69e48cd7f54261df5b6abbd374f69fe6e496fa781d271592aeef49cd5ffbea6c` | 69,430,272 B of tar (the `20261013` build's, from its gzip trailer; `20261001`'s within 3 KB compressed) |
| Windows x64 | `cpython-3.14.8+20261001-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` | 23,227,899 | `b7ff8b700995379e425b39abce9b087d84a45aa265ea465c0069c2747ea5b2ea` | 63,299,584 B of tar (likewise) |

Both from GitHub's per-asset `digest` field (re-read 2026-10-14); the
release's `SHA256SUMS` (142,015 B) agreed on every row read, so the app
needs only the pin, never the sums file. The download URL is
`https://github.com/astral-sh/python-build-standalone/releases/download/20261001/<asset>`
with the `+` as `%2B`; it answers with a redirect to
`release-assets.githubusercontent.com`, which honoured an explicit byte
range (206) and refused a suffix range (`bytes=-4`, 501).

- **Pin a tag, never `latest`.** Twelve releases came between 2026-08-04 and
  2026-10-13, about one every six days, and the newest (`20261013`) was
  hours old with its notes still "TBD". `20261001` is the first with 3.14.8
  and is two weeks old from 2026-10-15; P pins the newest tag that has stood
  two weeks on the day it starts.
- **Stripped, not plain, on Windows.** The plain Windows archive at
  `20261001` is **50,181,000 B** because it carries the PDBs (the first
  draft's 50,245,204 B is `20261013`'s); stripping (`release.rs`
  `convert_to_stripped`) more than halves it. On the Mac the two differ by
  under 0.5 % (26,815,246 against 26,680,498 B).
- **Windows on Arm, for later.** The same release publishes a native
  `cpython-3.14.8+20261001-aarch64-pc-windows-msvc-install_only_stripped.tar.gz`,
  22,228,934 B. The app ships x64 only (`electron-builder.yml:84-85`), so P
  does not use it (§16.44).
- **What is inside** (read in the build scripts, confirmed on first unpack,
  §3a.8 row 26): pip 26.2.1 pre-installed (`build-cpython.sh:1031`, Windows
  `build.py:1792-1817`); no `ensurepip` run; on Windows no `pip.exe`
  (`build.py:1829-1838`), so it is always `python -m pip`; `vcruntime140.dll`
  and `vcruntime140_1.dll` beside `python.exe` (`PC/layout/main.py:164-169`;
  issue #855 kept their signatures through stripping); OpenSSL linked into
  `_ssl` on the Mac with `--openssldir=/private/etc/ssl`
  (`build-openssl-3.5.sh:46`), and `/private/etc/ssl/cert.pem` exists on this
  Mac (333,483 B). **Unmeasured, and row 26's:** whether the archive ships
  the standard library's `__pycache__` (the pack starts with
  `-B`, §3a.2, so a missing `.pyc` would be compiled in memory at every
  start), and whether an `EXTERNALLY-MANAGED` file is present.
- **Signatures.** The arm64 binaries are ad-hoc linker-signed (issue #749);
  Developer ID signing is only being rehearsed (PR #1255, opened
  2026-09-09). Apple Silicon needs a valid signature, and ad hoc counts.
  Gatekeeper assesses quarantined code, and a file written by Electron
  44.3.0's Node (`ELECTRON_RUN_AS_NODE`) carried no `com.apple.quarantine`,
  only `com.apple.provenance` (measured). Chromium's download pipeline is
  what quarantines (`base_file.cc` → `quarantine_mac.mm`), so the pack is
  **never** fetched through `session.downloadURL` or `will-download`. The
  dev Mac has never run the helper on an ad-hoc-signed interpreter (its venv
  is python.org's Developer ID build): the clean Mac is the first test
  (§3a.8 row 31), and its fallback is named there.
- **Why not the others** (each fetched 2026-10-14):

  | source | why not |
  |---|---|
  | python.org macOS `.pkg` (3.14.8, 75,240,265 B) | `IFPkgFlagAuthorizationAction = RootAuthorization`, installs to `/Library/Frameworks`: an admin password (`build-installer.py:1494-1503`) |
  | python.org Windows installer `/quiet` per-user (3.14.8, 33,387,464 B) | registers with Windows and shares the user's own per-minor slot; the 3.14 manual has moved to the Install Manager; no 3.12 binaries since 3.12.10 (2025-04-08) |
  | python.org Windows embeddable zip (3.14.8, 12,601,679 B) | no pip, a `._pth` that restricts the path, and the C runtime left out (the manual says so); Windows only, so two sources |
  | Microsoft Store / Install Manager | needs its own UI; the alias stub exits 9009 (`CLAUDE.md`) |
  | uv 0.13.1 (Mac tar 14,280,170 B; Windows zip 15,308,685 B, `uv.exe` 32,095,024 B) | the same archives plus a 28–32 MB binary to keep current; its value is a resolver this route does not need. Kept in reserve if pip proves slow on the Surface (§3a.8 row 27) |
  | winget, Homebrew | system tooling a user runs, not an app |

- **Licence.** CPython is PSF-2.0 / CNRI-Python; the build scripts are
  MPL-2.0 (the build system, not the interpreter). The components at
  `20261013`: OpenSSL 3.5.9 Apache-2.0, zlib 1.3.2 and zlib-ng 2.2.4 Zlib,
  libffi 3.8.0 MIT, expat 2.9.0 MIT, xz 5.8.4 0BSD, mpdecimal 4.0.0 BSD-2,
  libedit BSD-3 (built instead of readline, and `_gdbm` disabled, both to
  avoid GPL, `docs/running.md`), Tcl/Tk 9.0.4 TCL, SQLite public domain. The
  third-party licence texts are only in the **full** archive
  (`python/licenses/`); `install_only` keeps CPython's `LICENSE.txt`. So the
  credits page carries the components' texts.

#### The wheels

The roots are the pins already in `requirements.txt`,
`requirements-faces.txt` and `requirements-faces-nodeps.txt`; every
transitive package is pinned to what `sidecar/.venv` runs (48
distributions, pip among them). Markers were evaluated per target and each
wheel picked by pip's ranking (`packaging.tags` 26.3). **Every package has a
binary wheel for cp312 and cp314 on both platforms; none is sdist-only and
none needs a compiler.**

| target | wheels | wheel bytes | with the interpreter (`20261001`) | the button (`pack.ts` `formatBytes`) |
|---|---|---|---|---|
| macOS arm64, cp314 | 47 | 151,510,094 | 178,190,592 | **170 MB** |
| Windows x64, cp314 | 48 (colorama, by tqdm's Windows marker) | 191,876,652 | 215,104,551 | **205 MB** |
| macOS arm64, cp312 | 47 | 151,530,925 | (3.12.15: 25,023,573) | — |
| Windows x64, cp312 | 48 | 189,174,743 | (3.12.15: 22,013,771) | — |

**On disk, about 0.7 GB on both.**

- **The Mac, measured.** The 47 distributions' RECORD sizes in the dev venv
  are **587.9 MB** (11,629 files, 99.3 MB of them `.pyc`), 3.88× the wheel
  bytes. With the interpreter's ~69 MB of tar that is **about 0.66 GB**.
- **Windows, measured from the wheels' indexes** (a reviewer, 2026-10-14;
  the first draft's 0.84 GB was an estimate from the Mac's ratios and is
  withdrawn). The central directories of all 48 Windows cp314 wheels sum to
  556,756,305 B in 6,528 files, of which 4,373 are `.py` (77,229,712 B). At
  the dev venv's measured `.pyc`-to-`.py` byte ratio (1.313: 105,047,119 /
  79,995,354 B), pip's compile adds about 101 MB. That gives **about 0.66 GB
  of packages and about 0.72 GB** with the interpreter's 63.3 MB of tar.
  NTFS slack on about 15,000 files adds roughly 30 MB (an estimate).
- **The peak during an install** is the download plus the tree: about
  0.84 GB on the Mac and about 0.94 GB on Windows, until the downloads are
  deleted (§16.47).

R4's "300 MB or more" was right for the download only. CI's install measures
both platforms (§3a.6), and the manifest carries the measured numbers.

The heavy ones (cp314; Mac / Windows wheel bytes):

| package | version | wheels | on disk (Mac) | why it is there |
|---|---|---|---|---|
| llvmlite | 0.49.0 | 40,479,230 / 42,986,588 | 130.96 MB | numba, for librosa |
| scipy | 1.18.1 | 20,466,839 / 37,362,755 | 98.26 MB | librosa; depth's clustering; vision |
| onnxruntime | 1.30.0 | 21,545,313 / 14,675,319 | 82.72 MB | depth, salient, ground |
| av | 18.1.0 (abi3) | 18,217,603 / 27,595,679 | 46.01 MB | **faster-whisper decodes with it** (`transcribe.py:387` → `audio.py:46 av.open`), and imports it on `import faster_whisper` |
| mediapipe | 0.10.35 (`py3-none`) | 17,782,605 / 10,905,503 | 55.21 MB | the face finder, installed `--no-deps` (the stub route, unchanged) |
| ctranslate2 | 4.8.2 | 1,272,406 / 19,478,465 | — | faster-whisper |
| numpy | 2.5.3 | 5,449,793 / 12,698,179 | — | everything |

What each capability brings alone: Whisper (av, ctranslate2,
faster-whisper, tokenizers) 23.7 / 51.1 MB of download, 63.0 MB on the
Mac's disk; faces (mediapipe, absl-py, sounddevice) 18.9 / 12.1 MB,
58.6 MB; **librosa's chain (18 packages) 54.6 / 57.1 MB, 222.7 MB on disk,
38 % of the Mac's packages, for `audio.beats` alone** (beats.py's
`librosa.segment.agglomerative` and `chroma_cqt` run the whole chain, read).
Depth, `vision.measure` and salient bring nothing of their own.

**The version: 3.14.8** (§16.36). The wheels do not decide it; what does is
that every package-level run so far, the stub route included, was on
3.14.6, and 3.14 is supported to 2030-10 where 3.12 is security-only to
2028-10. 3.11 is out (numpy 2.5.3, scipy 1.18.1 and librosa 1.0.0 require
≥ 3.12). 3.15.0 (2026-10-09) is out: no cp315 wheel for onnxruntime 1.30.0,
ctranslate2 4.8.2, numba 0.67.0, llvmlite 0.49.0 or pyyaml 6.0.3. **What
3.14 costs:** no voice (below), and **no pack below macOS 14**: onnxruntime
1.30.0 and av 18.1.0 publish arm64 wheels only as `macosx_14_0`, while
Electron 44.3.0's `LSMinimumSystemVersion` is 13.0 (read from its
`Info.plist`) (§16.44).

#### The base pack, and what is not in it

- **The base pack** is `requirements.txt` plus both faces files, as §12
  said, in **one hash-pinned lock per platform**, installed in **one** pip
  run with `--no-deps`. With a complete lock nothing is resolved on the
  user's machine, so faces' second `--no-deps` run folds into it. The lock
  holds mediapipe and not `opencv-contrib-python` or matplotlib: the stub
  route is exactly as it is (§4.3, `SIDECAR.md`).
- **The lock is checked complete**, since with `--no-deps` a missing
  transitive package (most likely one behind a Windows-only marker) would
  show up only as a degraded capability on a user's machine. `pack_lock.py`
  fails unless every `Requires-Dist` of every lock line, with that target's
  markers and no extras, is in that target's lock, against one allowlist:
  `{mediapipe: matplotlib, opencv-contrib-python}`. Measured by a reviewer
  over the dev venv's 48 distributions, per target: Windows needs exactly
  tqdm → colorama beyond the Mac set, and the only unmet requirements on
  both targets are mediapipe's two. So the check is cheap and passes today.
  CI then runs `pip check` from inside the installed pack and asserts that
  every problem it reports is one of those two (membership, not a
  snapshot). (The first draft said `pip check` is never run, since it would
  report those two; with the allowlist it can run.)
- **hf-xet** (1.6.0; 3,876,287 / 4,033,128 B, 8.2 MB on disk) comes in by
  huggingface-hub's marker and is never used: the client sets
  `HF_HUB_DISABLE_XET=1`, and huggingface_hub imports it only through
  `is_xet_available()` (`utils/_runtime.py:157-162`). The lock leaves it out
  once depth's and asr's downloads pass without it (§3a.8 row 35); the
  allowlist then gains `huggingface-hub: hf-xet`.
- **Stems is not in it.** demucs and torch are their own press, after P and
  not in its days (§16.39). Facts for when it comes:
  `requirements-stems.txt` pins demucs **4.0.1, which is sdist-only and has
  no `demucs/api.py`** at its tag (`facebookresearch/demucs` `v4.0.1`), so
  `stems.py`'s `import demucs.api` degrades even with it installed; demucs
  4.1.0 (2026-07-11, `adefossez/demucs`, `py3-none-any`, 100,567 B) has it.
  With torch 2.14.1 from PyPI (its Windows wheel is the CPU build: every CUDA
  package is marked Linux-only), the stems set is 13 wheels,
  **139,876,993 B on the Mac and 136,363,381 B on Windows** (torch alone
  127,325,330 / 124,110,781 B); installed size unmeasured, plus the htdemucs
  model. **And a second OpenMP runtime:** ctranslate2 ships Intel's
  `libiomp5md.dll` and scikit-learn Microsoft's `vcomp140.dll`; torch would
  add its own, and faster-whisper #967 shows a Windows process aborting with
  "OMP: Error #15" when two OpenMP runtimes meet (§3a.8 row 37).
- **Voice is in no pack.** Every kokoro-onnx release since 0.4.8, the
  pinned 0.4.9 and the newest 0.6.1 (2026-08-19) included, declares
  `Requires-Python <3.14,>=3.10` (0.6.1 re-read 2026-10-14), so it cannot
  install on the pack; and its chain ships espeak-ng, GPL-3.0, which
  `STACK.md` §9 rules out as bundled. That verdict is not reopened. Voice
  stays on the hosted provider, and in the pack `voice.speak` and
  `voice.voices` are degraded with their reason.
- **Salient registers** (its dependencies are depth's) and the analysis job
  still does not call it (§16.35).

#### Licences

From PyPI's `license`, `license_expression` and classifiers, and GitHub's
licence endpoint where PyPI is empty. Most of the base pack is MIT, BSD,
Apache-2.0, ISC or PSF-2.0 (the full list goes into §11's credits). These
are recorded for the credits and for §16.37's route; no settled licensing
decision is reopened. **Flagged:**

- **av 18.1.0's FFmpeg is GPL by linkage.** Its wheel bundles libx264 (.165)
  and libx265 (.216), GPL-2.0 (the licence endpoints of `mirror/x264` and
  `videolan/x265`; the pyav-ffmpeg README lists both for every platform).
  In the dev venv, `otool -L` on `libavcodec.62.28.102.dylib` lists
  `@loader_path/libx264.165.dylib` and `libx265.216.dylib`, and its
  embedded configure line has `--enable-libx264 --enable-libx265
  --enable-version3` and no `--enable-gpl` (a reviewer, 2026-10-14). Its
  banner says "LGPL version 3 or later", but stock configure refuses x264
  without `--enable-gpl`, so the banner does not describe the combined work:
  as shipped, that libavcodec is GPL-2.0-or-later. It also links libmp3lame
  and opencore-amr. PyAV's own code is BSD-3-Clause. It is a third FFmpeg in
  the app.
- **ctranslate2 4.8.2's Windows wheel carries NVIDIA's `cudnn64_9.dll`**
  (266,288 B, under NVIDIA's cuDNN licence, not open source) and **Intel's
  `libiomp5md.dll`** (1,614,192 B) (a reviewer's read of its index,
  2026-10-14).
- **scikit-learn 1.9.1's Windows wheel carries Microsoft's `msvcp140.dll`
  (643,512 B) and `vcomp140.dll` (212,920 B)** under `sklearn/.libs/`,
  under the Visual C++ redistribution terms (its index re-read 2026-10-14).
- **soxr 1.1.0 is LGPL-2.1-or-later** (re-read 2026-10-14); **soundfile
  bundles libsndfile, LGPL-2.1**.
- **MPL-2.0**: certifi; tqdm (MPL-2.0 AND MIT).
- Not fetched: the licences of scipy's bundled libgfortran, libquadmath and
  libgcc_s, scikit-learn's libomp on the Mac, and the ASIO SDK in
  sounddevice's PortAudio DLLs.

**Who distributes them is the route's question (§16.37).** Fetched from
PyPI's own file URLs at the user's press, nothing is re-hosted by the
project. A project-hosted wheelhouse or environment archive would make the
project the distributor of av's GPL-2.0 encoders, the LGPL libraries,
NVIDIA's cuDNN DLL and Microsoft's runtime DLLs.

#### The lock

```
sidecar/pack/lock-darwin-arm64.txt     # pip's format: one `name==version --hash=sha256:<64 hex>` per line
sidecar/pack/lock-win32-x64.txt
sidecar/pack/resolved.json             # every file's name, size, upload date, URL and sha256, and each distribution's
                                       # Requires-Dist evaluated per target; committed
sidecar/pack/history.json              # each pack number → its lock and interpreter sha256 per platform (§3a.2)
scripts/pack_lock.py                   # run with the dev venv's python: PyPI JSON → both locks, the completeness check, pack.ts's file list
```

`pack_lock.py` evaluates each target's markers itself (pip's `--platform`
changes wheel tags but evaluates markers for the HOST, so a Windows lock
made on the Mac would miss colorama) and picks each wheel by
`packaging.tags`, as the measurement did. It fetches PyPI's JSON itself and
writes `resolved.json` beside the locks, so the lock can be rebuilt from
the repo and a change shows in a diff. CI installing each lock on its own
platform and running the suites is the check that the lock is right
(§3a.6).

### 3a.2 P.2 — The pack on disk · 0.5–1 day, and one helper process · 0.5 day

> **Built 2026-10-14 — slice A, with §3a.1.** Nothing is on disk yet but
> what a test plants: the install job that writes a pack is §3a.3's. What
> landed is everything that reads one, chooses the interpreter, starts it
> and keeps it to one process. Not pushed (the user's order).
>
> Commits:
> - the two pure functions: `f39a47a`;
> - the Python side (UTF-8 stdio, hello's three fields, the worker's
>   bootstrap): `2700e2c`;
> - the service, the client, the status and every caller: `451520d`;
> - the fix phase, after three verifiers: `621bc4f` (the in-use record on
>   the helper's exit), `95c836e` (Update after a pack-number bump),
>   `6400037` (the Windows stop waits for `taskkill`), `890b767`
>   (`helperRowFrom`), `2011e47` (installing reads as missing), `fd15746`
>   (the tests' own interpreter), `c232b4a` (faces.int's stand-in scrub).
>
> Every measurement below is in `EFFECTS.md` §57, with its command.
>
> **Which interpreter runs** (`src/shared/sidecar/helperPython.ts`, pure: no
> disk, no electron, no node import, so the renderer can use it):
> - **development:** `FORGE_PYTHON` (when set and not empty, as `service.ts`
>   always read it; looked up in any case on win32, where a copy of
>   `process.env` loses Windows' case-insensitive lookup), then
>   `sidecar/.venv`, then the dev pack, then `python` on win32 and `python3`
>   elsewhere;
> - **packaged:** the pack, then `FORGE_PYTHON`, then `absent`. Never a PATH
>   Python, and a venv is not a rung there.
> - **`damaged` wins over every later rung.** So in a packaged app it beats
>   `FORGE_PYTHON` (§16.42 (b) as built: someone who set it and installed a
>   pack is told the pack is broken); in development it beats only PATH.
> - **A receipt that parses and does not match** (another platform,
>   `lockSha256` or `interpreterSha256`) is not a pack and not damaged: it
>   falls through, and reads as Update even with its interpreter gone.
> - **An unsupported machine** (`packPlatform`'s reasons, §3a.1) skips the
>   pack rung whole, its damaged check with it: Repair could not run there.
> - **How "does not parse" is passed:** `pack: null` only when there is no
>   `pack.json`; otherwise `receiptFromText(text)`, the JSON or the frozen
>   `UNPARSEABLE_RECEIPT`. Anything `parseReceipt` refuses (`{}`, `null`, a
>   bare string, an empty file) is damaged. The reasons are fixed:
>   "Python is missing from the AI helper's folder (removed by antivirus?)"
>   and "The AI helper's install record (pack.json) cannot be read".
>
> **The launch** (`helperLaunch`, now what the service starts):
>
> | rung | argv after the interpreter | environment |
> |---|---|---|
> | the pack, **in development too** | `-E -s -u -B -m forge_sidecar`, never `-I` | the parent's with every `PYTHON*` and `HF_*` key dropped (case-insensitively on win32, exactly elsewhere, where Python and huggingface_hub read the upper-case names only), then `FORGE_MODELS_DIR`, `FORGE_CACHE_DIR`, `HF_HUB_DISABLE_XET=1`, `HF_HUB_DISABLE_TELEMETRY=1`, one spelling each on win32; no `PYTHONUNBUFFERED` or `PYTHONIOENCODING` |
> | `FORGE_PYTHON`, packaged | `-B -m forge_sidecar` | `HF_*` dropped, `PYTHON*` kept, then `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8` and the four above |
> | `FORGE_PYTHON`, the venv and PATH, in development | `-m forge_sidecar` | `plainHelperEnv`, the old `sidecarEnv` key for key (a verifier compared them by `JSON.stringify`, key order included, on win32 and darwin) |
> | `absent`, `damaged` | nothing is started | — |
>
> `helperSourceLabel` gives "installed by the app · pack N" (the receipt's
> number), "from FORGE_PYTHON <path>", "development venv" and "python3 on
> PATH" / "python on PATH". Nothing shows it yet (§3a.4).
>
> **`absent` at every caller** (`src/main/sidecar/service.ts`). The service
> gathers the order's inputs: `app.isPackaged`, the environment, the venv
> only if it is a file, `<packRoot>/<HELPER_PACK.pack>/pack.json` (`packRoot`
> is `userData/python` packaged and `userData/python-dev` in development;
> ENOENT or ENOTDIR is no receipt, any other read error, EISDIR or EACCES,
> is the unparseable receipt, so damaged), whether the interpreter is a
> file, `packPlatform` with `process.getSystemVersion()` (`''` when it is
> missing, which reads "needs macOS 14") and
> `app.runningUnderARM64Translation`. When the manifest's folder has no
> receipt, `olderReceipt` takes the highest numbered folder below it whose
> `pack.json` parses, for the offer only. `getSidecar()` builds a client
> only for a choice with a launch; otherwise it throws a `SidecarError`
> **synchronously**: "The AI helper is not installed", "The AI helper needs
> an update" (an older pack on disk), the damaged reason, the unsupported
> reason ("The AI helper needs macOS 14 or later", "… is not available on
> Windows on Arm yet"), or, during a switch, "The AI helper is restarting".
> Where each caller's throw lands:
> - `voiceStatus`: inside its own try, so the local voice reads not ready
>   with the sentence as its reason; `voiceOptions` and `speak` reach the
>   helper only after the provider choice picks it, which needs it ready;
> - `separateStems`: mid/side, as for any helper failure;
> - `audio:beats`, `depth:layers`, `asr:transcribe`: reject with the
>   sentence before any request;
> - `vision:measure`: `{measures: [], unavailable}`;
> - the reframe job and `reframe:faceModel`: `analyse.ts` `helperOf` maps
>   the throw to `no-helper`, before the scene pass;
> - `sidecar:status`: `sidecarStatus()`, the last broadcast, never a start.
>
> `tests/sidecarService.test.ts` runs ipc.ts's real `registerIpc` in a
> packaged app with no pack, every spawn recorded: spawn is never called.
>
> **The status** (`src/shared/sidecar/status.ts`): `SidecarStatus` is the
> block below, field for field. `PackOffer` is `{supported: true, kind,
> bytes, bytesOnDisk, hosts}` or `{supported: false, reason}`, from the pure
> `packOffer(manifest, platform, receipt, damaged, older)`: `install` with
> no receipt, `update` for a receipt that parses and does not match or an
> older number's, `repair` for a damaged, unreadable or matching one.
> `helperStatusReason` is every sentence above; `helperRowFrom` is what the
> header dot and the row take (`ready` running; `absent`, `damaged` and
> `failed` not running with their sentence; `starting` and `installing` not
> running with none), and App.tsx's `applyHelperStatus` makes that one
> call. `reframeHelperFrom` reads `absent`, `damaged`, `failed` and
> `installing` as missing and `starting` as unknown.
>
> **One helper process** (`src/main/sidecar/client.ts`). The client is
> built from a launch (`{cwd, launch, maxRestarts?, helloTimeoutMs?,
> platform?}`); the `'python3'` default and `sidecarEnv` are gone.
> - `start()` is single flight, and spawns only when there is no child; a
>   `request()` with no ready helper joins that start and sends after the
>   hello (it used to write to the child at once).
> - A hello that does not come back kills its child before it rejects with
>   "The AI helper did not answer within N s". **The ceiling is 30 s on the
>   development rungs and 90 s on the pack's (`PACK_HELLO_TIMEOUT_MS`), a
>   placeholder until row 29's cold hello on the Surface sets it.**
> - `stop()` resolves when the child has exited. After `STOP_GRACE_MS`
>   (1.5 s) its kill is `taskkill /pid <pid> /f /t` (`windowsHide`) on
>   win32, **awaited until taskkill itself exits** (if taskkill cannot
>   start, a SIGKILL of the helper; after `TREE_KILL_WAIT_MS`, 10 s, it
>   goes on regardless), and SIGKILL elsewhere. A timed-out hello takes the
>   same kill. A stopped client never spawns again.
> - `idle()` resolves once nothing is pending or queued behind a start.
> - Events: `spawn` `{pid, source}`, `ready` on every start that answers (a
>   restart's included), `exit` `{code, signal, source, pid}`, `gaveUp`.
> - An interpreter that is not there rejects with "Could not start the AI
>   helper: …" and restarts nothing (Node 24 gives `'error'`, then
>   `'close'`, and no `'exit'`).
>
> The service broadcasts `starting`; `ready` on every `ready`, which closes
> the restart fault above; `failed` "The AI helper stopped (code N)" on a
> crash after ready; `failed` on `gaveUp`; and a start that fails, in its
> own words. **`restartSidecar(signal?)`** is single flight: it waits for
> idle or the caller's abort (an abort leaves the helper as it was), stops
> the client and waits for its exit, resolves the order again and starts;
> `getSidecar` throws "restarting" meanwhile. `stopSidecar()` resolves on
> the exit.
>
> **The in-use record**: `<root>/in-use/<this app's process.pid>` holding
> `{"pack": N}`, written on every spawn from a pack (a restart's included),
> removed on the helper's exit and on a stop. Nothing reads it yet.
>
> **`system.hello`** gains `executable`, `prefix` and `path` (`sys.executable`,
> `sys.prefix`, `list(sys.path)`), required in `HelloResult`.
>
> **The face worker** starts as `[sys.executable, '-E', '-s', '-B', '-c',
> WORKER_BOOTSTRAP]`, cwd the folder `forge_sidecar` is in. The bootstrap
> puts `forge_sidecar/stubs` first and that folder second on `sys.path` and
> runs `forge_sidecar.workers.mp_faces` as `__main__` with `runpy`; the
> worker's environment is a plain copy of the helper's, and it sets its own
> stdout and stderr to UTF-8. Through the bootstrap mediapipe 0.10.35 was
> ready in 143 ms wall (the import 0.076 s); with the stubs taken off its
> path the worker exits 69, "No module named 'cv2'".
>
> **Row 38, measured and decided.** Under `-E -s -u -B` and
> `LC_ALL=en_IE.ISO8859-1` the pipes were ISO 8859-1: a request carrying
> "Bräutigam 5:30pm ಕನ್ನಡ.mp4" was read as mojibake and the reply failed
> with "'latin-1' codec can't encode characters in position 59-63".
> `__main__.utf8_stdio()` now sets stdin and stdout to UTF-8 strict and
> stderr to UTF-8 `backslashreplace`, what `PYTHONIOENCODING=utf-8` gave, on
> every rung; both directions then round-trip under the C, Latin-1 and UTF-8
> locales. `-X utf8` round-trips too, but gives stdin and stdout
> `surrogateescape` and changes every `open()`'s default, so it was not
> taken.
>
> **Where it differs from the text below:**
> - **The pack rung's flags apply in development too**, not only packaged:
>   §3a.6 step 3 needs a test that reaches the pack to start it as an
>   installed user does. "In development every rung starts as today" holds
>   for `FORGE_PYTHON`, the venv and PATH.
> - **The face worker's bootstrap is on every rung**, not only under the
>   pack, and it was built before row 26's registry run on the Surface
>   rather than decided by it. Accepted as a deliberate widening: one shape,
>   tested (`test_faces.py`'s planted-`PYTHONPATH` case), and the venv rung
>   is unaffected; a `FORGE_PYTHON` whose mediapipe is reachable only
>   through `PYTHONPATH` or the user site would lose faces.
> - **"Waits for its exit and its tree's"** holds on Windows, where the
>   `taskkill /f /t` is awaited. On the Mac the wait is the helper's own
>   exit after a SIGKILL to the helper alone; its face worker ends when the
>   helper's stdin closes (§15 row 1). macOS does not lock open files, so
>   Repair and Remove are not blocked by it. Spawning detached and killing
>   the group was not taken: it changes how `npm run dev`'s Ctrl-C reaches
>   the helper, and must never apply on Windows.
> - **Update after a bump.** The offer reads an older number's receipt when
>   the manifest's folder has none, so a pack in `python/1/` under a
>   manifest at 2 is offered as Update, never as a fresh Install over 0.7 GB
>   on disk; a torn older receipt is no pack, and the offer is Install. The
>   old pack is still never run (§16.46 (a)).
> - **`PackOffer.bytes` is the whole pack** (`packBytes`), not "bytes left
>   to fetch": the left part needs §3a.3's `downloads/<n>`, and `packOffer`
>   subtracts the verified files then (`helperPackJob.test`'s "N MB left").
> - **`reframeHelperFrom`** keeps `starting` as unknown, as before this
>   slice, for the seconds its hello takes; `installing` is missing, since
>   an install runs for minutes and unknown would have said "the AI helper
>   is starting" all that time.
> - On an unsupported machine every caller is told why ("needs macOS 14 or
>   later"), not "not installed".
> - A `pack.json` that a scanner holds at launch (EACCES, EBUSY) reads as
>   damaged for that launch; there is no retry.
>
> **Tests** (run to a file at `4dae71d` by the recorder; 171 passed in these
> nine files): `tests/helperPython.test.ts` (23), `tests/helperLaunch.test.ts`
> (16), `tests/sidecarClient.test.ts` (12, against
> `tests/fixtures/fake-helper.mjs`, a Node stand-in that speaks the protocol
> and logs its pid per start), `tests/sidecarService.test.ts` (28),
> `tests/sidecarFolders.test.ts` (5), `tests/reframeContract.test.ts` (13),
> `tests/integration/sidecar.int.test.ts` (18: the 15, hello's three fields,
> and row 38 in each direction under a Latin-1 locale), with
> §3a.1's two files. And `tests/sidecar/test_faces.py` (42, run by
> `sidecarMedia.int`), `reframeJob.int`'s not-installed case,
> `faces.int` (13 passed, 2 skipped, with or without the shell's
> `FORGE_FACES_WORKER_FAKE`, which no longer reaches the tests that need
> the real mediapipe), and `settingsPanel.test.ts`'s no-"sidecar"-on-screen
> check, which now skips an import's module path and still fails on that
> path written as a string anywhere else. `tests/integration/venv.ts`'s
> `HELPER_PYTHON` falls back as the app's development order does (`python`
> on win32), so the Python-only suites and `sidecar.int` no longer disagree
> on the Surface.
>
> **Mutations killed** (each anchor counted at one match first, each file
> restored and compared byte for byte):
> - the order's 14: the PATH fallback put back in a packaged app; the env
>   rung first there; the pack before `.venv` in development; the escape
>   hatch dropped; a missing interpreter read as absent; an unparseable
>   receipt read as none; damaged yielding to `FORGE_PYTHON` packaged; an
>   unsupported machine given a platform, or read as damaged; exact-case
>   `FORGE_PYTHON` on win32; the interpreter checked before
>   `receiptMatches`; the PATH names swapped; an empty `FORGE_PYTHON` set; a
>   damaged dev pack ignored. And `receiptMatches`' three checks, each
>   dropped through `vi.mock` with `pack.ts` untouched (a control mock passes);
> - the launch's 16, among them an exact-case delete (`PythonPath` survives
>   on win32), `-E` dropped, `HF_ENDPOINT` kept, `-I` for `-E -s`, the pack
>   launched as today in development, the development environment cleaned,
>   and a source label saying "sidecar";
> - the client's 11 and the fix phase's 5 (`stop()` or `kill()` not
>   awaiting the tree kill, `killTree` resolving at once, its error path
>   never resolving, or resolving without its SIGKILL);
> - the service's 15 and the fix phase's 13 (the exit's own in-use removal
>   deleted, which **survived** the builder's tests until `621bc4f`; the six
>   of Update; the five of `helperRowFrom` (a verifier's move of App.tsx's
>   `absent` and `damaged` beside `starting` had **survived** every renderer
>   test before `890b767`); and installing read as unknown);
> - the Python side's 8 (the stubs dropped from the bootstrap, `-E` dropped,
>   the worker's and the helper's UTF-8 setup dropped, stdin and stdout each
>   left alone, hello without `executable`, a `None` in its path) and a
>   verifier's 3 on the bootstrap (the stubs dropped again, appended last,
>   and a `run_name` other than `__main__`);
> - the no-"sidecar" check's 2 (a UI string in App.tsx, and the import's
>   path written as a string outside an import), the tests' interpreter
>   (2) and faces.int's scrub (2).
>
> **Left:**
> - `installing` is defined and never emitted, until §3a.3's job.
> - The Settings row still reads `helperState(ready, error)`, so `absent`
>   shows red "Not running · The AI helper is not installed", not §3a.4's
>   grey "Not installed"; its states, the sized Install, Repair and Update
>   buttons and the census rows are §3a.4's. The harness bridge still
>   answers `{state: 'failed', error: 'harness: no sidecar'}`; reporting
>   `absent` is the harness slice's.
> - `restartSidecar` has no caller and the in-use record no reader: their
>   first real use is §3a.3's install, Repair, Update and Remove.
> - The pack's 90 s hello ceiling, until row 29. The reframe's `helloOf`
>   still asks hello with its own 30 s after a start that may take 90.
> - Row 38's Windows half (cp1252 pipes): `sidecar.int`'s two row-38 tests
>   set no locale on win32, so CI's Windows job runs them on the ANSI code
>   page first, then the Surface.
> - The tree kill is proven on this Mac through a stand-in `taskkill`; the
>   grandchild's death is asserted only on win32, so CI and the Surface
>   are its first real runs. The 10 s ceiling has no test of its own.
> - No integration test reaches the dev pack rung until §3a.6's
>   `FORGE_HELPER_PACK`.
> - `CLAUDE.md`'s fresh-Windows `FORGE_PYTHON` row is now stale: the
>   development fallback is `python` on win32, for the app and for the
>   tests, so `FORGE_PYTHON` is needed there only where `python` on PATH is
>   the Store's alias stub. §3a.10 corrects it with the rest when P lands.

#### Layout

```
userData/python/
  .lock                      held while an install, Repair, Remove or Update runs: {pid, startedAt}, created with O_EXCL
  in-use/<pid>               one per app instance whose helper runs from a pack: {pack}; removed on the helper's exit
  1/                         the pack number from the manifest
    python/                  the archive's own tree (`install_only` → `python/…`)
      bin/python3.14         macOS (and its `python3` link; names confirmed on first unpack, §3a.8 row 26)
      python.exe             Windows
    pack.json                the receipt: WRITTEN LAST and REMOVED FIRST (temp + a retried rename; never an in-place write)
  downloads/1/               the verified files of an install in progress; deleted after a success (§16.47)
```

- **No venv.** Packages go into the tree's own site-packages. A venv's
  `pyvenv.cfg` holds an absolute `home`, which a renamed userData (R7) would
  break; `pip --target` with `PYTHONPATH` skips `.pth` files and leaks into
  every child Python. The standalone tree is relocatable ("can be installed
  into any path", its README); the `_sysconfigdata` build paths it keeps
  matter only for compiling, and nothing here compiles.
- **In place, at the versioned path, with the receipt last** (the packs
  rule, `packs.ts:170-175`), **and removed first.** A folder with no
  receipt is a partial; the next install into that number deletes it first,
  and the launch sweep removes it. Every delete of a version folder (Repair,
  Remove, an old version after Update) unlinks `pack.json` before the tree,
  then removes the tree with `fs.rm`'s `maxRetries`, so a delete that stops
  part-way (a scanner, `EBUSY`) leaves a partial the order ignores, never a
  receipt over half a site-packages. No staging rename of 11,000 files under
  a scanner.
- **Development has its own root**, `userData/python-dev/`. The dev app and
  the installed one share a userData folder: `package.json`'s name is
  `forge` and `productName` is `Forge`, the same folder on case-insensitive
  APFS and NTFS (`service.ts`'s comment records `…/forge/cache` resolving to
  Chromium's `Cache`). Without a root of its own, `npm run dev` with a newer
  manifest would sweep the installed app's downloads and, as an old version,
  its pack. The review proposed the lock alone; the lock keeps two
  instances off one job, but not a newer manifest off an older pack, which
  is why development gets a root of its own.
- **The path budget on Windows.** MAX_PATH's 260 includes the terminating
  NUL, so a file path can be at most 259 characters and a directory at most
  247 (`CreateDirectoryW`'s MAX_PATH − 12). pip compiles each `.py` through
  `py_compile`, whose `_write_atomic` writes `f'{path}.{id(path)}'` first
  (`_bootstrap_external.py:205` in the dev venv's 3.14.6): up to 16
  characters past the final `.pyc` (a dot and up to 15 digits). Measured
  from the 48 Windows wheels' indexes (a reviewer, 2026-10-14): the longest
  final `.pyc` is 125 characters
  (`onnxruntime/tools/ort_format_model/ort_flatbuffers_py/fbs/__pycache__/RuntimeOptimizationRecordContainerEntry.cpython-314.pyc`),
  its temporary name up to 141, the longest wheel file 100, the longest
  directory 71. Under
  `C:\Users\<10 characters>\AppData\Roaming\Forge\python\1\python\Lib\site-packages\`
  (76 characters) that is **217 of 259** for the temporary name, computed;
  a 20-character user name gives 227, and the longest directory 147 of 247.
  So the budget holds, and the check is **root + longestPath + 16 ≤ 259 and
  root + longestDir ≤ 247**, before the unpack (§3a.3 stage 0). Node
  prefixes paths with `\\?\` and can write past MAX_PATH; pip and Python
  cannot without the admin-only `LongPathsEnabled`, so an unpack would
  succeed and the failure come later, in pip. CI's install measures
  `longestPath` and `longestDir` over the whole version folder into the
  manifest.

#### The receipt and the manifest

```ts
// src/shared/sidecar/pack.ts — pure, in the shape of shared/assets/pack.ts and shared/ingest/release.ts
export type PackPlatform = 'darwin-arm64' | 'win32-x64'

export interface PackFile { name: string; url: string; bytes: number; sha256: string }

export interface PlatformPack {
  interpreter: PackFile               // github.com/astral-sh/python-build-standalone/releases/download/<tag>/…, never `latest`
  wheels: PackFile[]                  // one per lock line, PyPI's own files.pythonhosted.org URL
  lock: { file: string; sha256: string }
  python: string                      // the interpreter, relative to the version folder
  expects: string[]                   // what the self-test must see: asr.transcribe, audio.beats, depth.layers,
                                      // vision.measure, vision.faces, vision.facesModel, vision.salient, vision.salientModel
  bytesOnDisk: number                 // measured by CI's install
  longestPath: number                 // likewise, over the whole version folder
  longestDir: number                  // likewise
  minOs?: string                      // '14.0' on darwin (§16.44)
}

export interface HelperPackManifest {
  pack: number                        // names the folder; goes up whenever a lock or the interpreter changes
  python: { version: string; build: string }   // '3.14.8', '20261001'
  platforms: Record<PackPlatform, PlatformPack>
}

export interface PackReceipt {
  pack: number; python: string; build: string; platform: PackPlatform
  interpreterSha256: string; lockSha256: string
  bytesOnDisk: number; installedAt: string; appVersion: string
  hello: { capabilities: string[]; degraded: Record<string, string> }   // what the helper registered
  selftest: Record<string, 'ok' | string>                              // per group: ok, or its reason (§3a.3 stage 4)
}

export function packPlatform(m: {
  platform: NodeJS.Platform; arch: string
  osVersion: string                   // process.getSystemVersion(): '14.6.1', never os.release()'s Darwin number
  translated: boolean                 // app.runningUnderARM64Translation: Rosetta, or Windows' x64 emulation
}): PackPlatform | { unsupported: string }
export function receiptMatches(receipt: unknown, manifest: HelperPackManifest, platform: PackPlatform): boolean
```

**An unsupported machine gets a reason instead of a platform**: macOS 13
("needs macOS 14", §16.44), and Windows on Arm. The app ships an x64 NSIS
build only, which runs under emulation there, where `process.arch` reports
`'x64'`; so `packPlatform` takes Electron's `app.runningUnderARM64Translation`
(true under Rosetta and under Windows' x64 emulation, `electron.d.ts:1995`),
and what that machine gets is §16.44's answer. An Intel Mac cannot reach the
row at all, since the DMG is arm64 only (`electron-builder.yml:101`); its
branch stays in `packPlatform` as a defence, with no row and no census entry.

**`receiptMatches`** is true only when `pack.json` parses, its `platform` is
this machine's, and its `lockSha256` and `interpreterSha256` equal the
manifest's for this platform. The `pack` number then only names the folder,
so a lock or interpreter change that ships without a bump still reads as
"Update". Each check is mutation-checked on its own. And the bump itself is
held: a committed `sidecar/pack/history.json` maps each pack number to its
pair of hashes per platform, and `helperPackManifest.test.ts` fails a push
whose lock or interpreter changed under a number already in it. If such a
pack reaches a machine anyway, Update runs as Repair does, into the same
folder, fetching first.

#### Which interpreter runs

One pure function, unit-tested a rung at a time:

```ts
export type HelperChoice =
  | { kind: 'env'; python: string }                 // FORGE_PYTHON
  | { kind: 'pack'; python: string; pack: number; root: string }
  | { kind: 'venv'; python: string }                // development only
  | { kind: 'path'; python: 'python' | 'python3' }  // development only
  | { kind: 'damaged'; reason: string }             // a receipt that does not parse, or one whose interpreter is gone: nothing is spawned
  | { kind: 'absent' }                              // a packaged app with nothing to run: nothing is spawned

export function resolveHelperPython(input: {
  packaged: boolean; env: NodeJS.ProcessEnv; platform: NodeJS.Platform
  venvPython: string | null
  pack: { receipt: unknown; interpreterExists: boolean; python: string; root: string } | null
  manifest: HelperPackManifest; packPlatform: PackPlatform | { unsupported: string }
}): HelperChoice
```

- **Development and tests:** `FORGE_PYTHON`, then `sidecar/.venv`, then the
  dev pack (`python-dev/`) if one is installed, then `python`/`python3`. (The
  first draft put the pack before `.venv`, which would have quietly run the
  pack under `npm run dev`.) Tests reach the pack rung explicitly (§3a.6).
- **A packaged app:** the pack, then `FORGE_PYTHON` (the escape hatch for a
  machine that cannot download the pack, as `FORGE_YTDLP` is for yt-dlp,
  `release.ts:71-83`), then **`absent`. Never a PATH Python.** That is
  §16.42's recommendation; its other options are written there.
- **A receipt is never ignored silently.** One that matches but whose
  interpreter file is gone (Defender quarantined `python.exe` or a DLL, or a
  delete stopped part-way) is `damaged`: the row reads red "Not running ·
  Python is missing from the AI helper's folder (removed by antivirus?)" and
  offers Repair, never a 205 MB Install over 0.7 GB already on disk. One that
  does not parse is `damaged` too, and the sweep never removes it (§3a.3).
  The tree is not re-hashed at launch; Repair is the integrity path.

#### The launch: flags and a clean environment

`resolveHelperPython` chooses; a second pure function says how to start the
choice, so every caller (the service, the install's self-test, the tests)
starts it the same way:

```ts
export interface HelperLaunch { command: string; args: string[]; env: NodeJS.ProcessEnv; source: HelperSource }
export function helperLaunch(choice: HelperChoice, o: {
  packaged: boolean; platform: NodeJS.Platform; base: NodeJS.ProcessEnv; modelsDir: string; cacheDir: string
}): HelperLaunch | null      // null for absent and damaged
```

- **The pack's rung starts `<python> -E -s -u -B -m forge_sidecar`.** `-E`
  ignores every `PYTHON*` variable and, on Windows, also skips the
  registry: CPython 3.14's `Modules/getpath.py` adds the value of every
  subkey under HKCU and HKLM `SOFTWARE\Python\PythonCore\<winver>\PythonPath`
  to `sys.path` ahead of the stdlib whenever `use_environment` is on
  (lines 700-728, re-read 2026-10-14), and on 3.14 that key is shared with any
  python.org 3.14 and anything that registers there. `-s` skips the user
  site (`pip --user` packages). `-u` replaces `PYTHONUNBUFFERED`, `-B`
  replaces `PYTHONDONTWRITEBYTECODE`. **Not `-I`**: it adds `-P`, which
  drops the working directory from `sys.path`, and `python -m
  forge_sidecar` from `cwd` `sidecarDir()` would not import. (A user's
  `PYTHONSAFEPATH=1` would do the same today; `-E` ends that too.)
- **`PYTHONIOENCODING` is ignored under `-E`**, and the protocol needs
  UTF-8 on stdio. Two ways, measured before one is chosen (§3a.8 row 38):
  the helper reconfigures its own streams at start (`sys.stdin` and
  `sys.stdout` `.reconfigure(encoding='utf-8')` in `__main__`, which keeps
  `PYTHONIOENCODING=utf-8`'s strict errors and works under every rung), or
  `-X utf8`, whose stdio error handler differs (to read in the docs and
  measure with a non-ASCII path in a request).
- **The environment is still cleaned**, because the helper's children read
  it: every key matching `/^PYTHON/` or `/^HF_/` is dropped,
  **case-insensitively on win32** (a `PythonPath` typed that way in System
  Properties survives `delete env.PYTHONPATH`, since Windows' names are
  case-insensitive), then the app's own are set (`FORGE_MODELS_DIR`,
  `FORGE_CACHE_DIR`, `HF_HUB_DISABLE_XET`, `HF_HUB_DISABLE_TELEMETRY`). A
  user's `HF_ENDPOINT` would send every model press to another host,
  `HF_HUB_OFFLINE` would fail every one as offline, and `HF_TOKEN` would be
  sent with each request.
- **The face worker gets its stubs without `PYTHONPATH`.** Today
  `faces.worker_env` puts the stubs first on the worker's `PYTHONPATH`
  (`faces.py:258-279`), and the worker starts as `sys.executable -m …`. Under
  the pack it starts as `sys.executable -E -s -B -c <bootstrap>`, where the
  bootstrap puts the stubs first on `sys.path` and runs the worker module
  with `runpy`, so the registry and a user's variables never reach it
  either. The stub route itself is unchanged. If row 26's registry run shows
  the leak cannot reach the worker in practice, the bootstrap may be dropped
  and the leak recorded as accepted; that is decided on the measurement.
- **`FORGE_PYTHON` in a packaged app** starts with `-B` and the `HF_*`
  clean-up, and keeps the rest of its environment: it is someone's own
  interpreter. **In development** every rung starts as today.
- **`-B` and the bundle.** The helper's own code runs from
  `resources/sidecar`, inside the app bundle on the Mac (and inside a
  read-only translocated copy when a quarantined app is first run from
  Downloads, §3a.9). electron-builder ships no `.pyc`
  (`electron-builder.yml:73-74`), so without `-B` Python would write
  `__pycache__` there; whether that breaks an ad-hoc seal on a later launch
  is **unmeasured** (row 31). site-packages' bytecode, compiled by pip at
  install, is still read. If row 26 finds the standard library ships no
  `.pyc`, the job compiles it once at install, before `-B` applies (§3a.3).
- `system.hello` gains **`executable`, `prefix` and `path`** (`sys.executable`,
  `sys.prefix`, `sys.path`), additive to the protocol, so the row and the
  tests can show which interpreter answered and prove nothing outside the
  pack reached it (§3a.6, §3a.9).

#### `absent` at every caller

`absent` (and `damaged`) is a status in which **nothing is spawned,
anywhere**:

- `getSidecar()` builds a client only for a choice with a launch. For
  `absent` and `damaged`, every helper call rejects at once with "The AI
  helper is not installed" (or the damaged reason): `voiceStatus` reports
  that reason for the local voice; `separateStems` takes its mid/side
  fallback, as it does for any helper failure; beats, depth, measure and
  transcribe reject before any request.
- The client's own `'python3'` default goes (`client.ts:117`): a client
  must be given its launch.
- `sidecar:status` answers `{state: 'absent', offer}` without building a
  client, `startSidecar` spawns nothing, and `reframeHelperFrom` (now
  `helperCan`, §3a.4) keeps mapping anything not `ready` to `missing`.

That ends the 9009 loop on Windows and the Command Line Tools question on
the Mac for every tester before they press Install.

```ts
export type SidecarStatus =
  | { state: 'absent'; offer: PackOffer }        // supported, bytes left to fetch, bytesOnDisk, hosts — or the unsupported reason
  | { state: 'damaged'; reason: string; offer: PackOffer }
  | { state: 'installing'; stage: string }
  | { state: 'starting'; source: HelperSource }
  | { state: 'ready'; hello: HelloResult; source: HelperSource; selftest?: Record<string, string> }
  | { state: 'failed'; error: string; source: HelperSource }
```

`HelperSource` names the rung, so the Settings row can say "installed by the
app · pack 1", "from FORGE_PYTHON <path>" or "development venv".

#### One helper process

The pack's cold start makes the double-spawn window above seconds long, on
the 8 GB machine, and Repair and Remove need to know that the one child they
waited for was the only one. So, inside P:

- **`start()` is single flight**: it keeps the in-flight promise, and a
  second call before the hello joins it. It spawns only when there is no
  child.
- **A hello that times out kills its child** before it rejects.
- **The status ask never spawns.** `sidecar:status` answers from the
  service's last broadcast; the window's mount gets "starting" and then the
  broadcast, as it gets every later change.
- **`stop()` returns a promise that resolves on the child's exit.** Its
  1.5 s kill (`client.ts:276`) becomes a tree kill on Windows (`taskkill /f
  /t`, as the shot finder's cancel does, §15 row 23), so a face worker and
  its ffmpeg go with the helper; on the Mac the helper's own cancel already
  stops the worker (§15 row 1).
- **The hello's timeout** is set from row 29's measured cold start (after an
  install, and after a reboot), plus a margin, not left at 30 s.
- **The service broadcasts** on the client's `ready` and `exit` as well as
  `gaveUp`, which closes the restart fault above.

#### The switch to a new rung

`restartSidecar()` in `service.ts` waits until no helper work is in flight
(or its caller cancels), stops the client and **waits for its exit and its
tree's**, resolves the order again and starts a new client. On Windows a
running `python.exe` holds `python314.dll` and the `.pyd` files open, so
Repair and Remove need the wait too.

### 3a.3 P.3 — The install job · 3.5–4.25 days

A module with its dependencies injected, in the shape of
`createReframeJobs` (`analyse.ts:267`, `:418-446`), so the whole job runs in
vitest outside Electron:

```ts
// src/main/sidecar/pack.ts
export function createHelperPackJobs(deps: {
  userData: string
  root: string                              // userData/python, or userData/python-dev in development
  manifest: HelperPackManifest
  platform: PackPlatform
  fetch: typeof globalThis.fetch            // Node's in tests and CI; Electron's net.fetch once §15 row 19 says so
  spawn: typeof import('node:child_process').spawn
  fs: PackFs                                // rename, rm, open(O_EXCL), statfs: injected so a test can refuse a rename or hold a file
  now(): number                             // the retry budget's clock, so a test can pass minute 6
  helper: {
    busy(): boolean                         // a reframe analysis, a transcription, a bake in flight
    whenIdle(signal: AbortSignal): Promise<void>
    stop(): Promise<void>                   // resolves on the child's exit and its tree's
    restart(): Promise<void>
  }
}): {
  queue: JobQueue                           // concurrency 1, presetId 'helper'
  install(options?: { repair?: boolean; update?: boolean }): Job   // single flight in this process: a second press joins the first
  remove(options: { models: boolean }): Promise<void>
  checkAgain(): Promise<void>               // the self-test alone, no download (§3a.4)
  status(): Promise<PackStatus>
}
```

The queue joins `allJobs` and its broadcast (`ipc.ts:268-271`), the one X
(`render:cancel`, `ipc.ts:1089-1096`), `jobs:clearFinished`
(`ipc.ts:1100-1112`) and `before-quit` (`index.ts:279-300`).

**Across app instances.** Nothing makes Forge single-instance
(`requestSingleInstanceLock` appears nowhere in `src/`, grep 2026-10-14), so
a double-clicked shortcut on Windows opens a second app on the same
userData. Its launch sweep would delete the first one's version folder
under its pip, and a Repair in one would delete the pack under the other's
running helper. So install, Repair, Remove and Update hold
`<root>/.lock` (created with `O_EXCL`, holding `{pid, startedAt}`; a lock
whose pid is not alive is stale and is taken over), and each instance whose
helper runs from a pack keeps `<root>/in-use/<pid>` while it does. The
sweep does nothing while another live instance holds the lock; Repair,
Remove and Update refuse, with the reason ("the AI helper is in use by
another Forge window"), while another live instance holds the lock or has
the pack in use. Whether to make the app single-instance outright is its
own question (§16.50).

**The download.** The retry rules are `ensureYtDlp`'s (`binary.ts:562-639`,
`FETCH_RETRY`): four tries, a stall is `idleMs` of nothing, retries only for
the network's failures (a 5xx, 429, 408, a dropped or stalled connection),
**never for a file that is not the file**, a unique temporary name renamed
into place, and a worded failure that names the escape hatch. Four things
are not taken from it:

- **Not its shared promise.** `ensureYtDlp`'s shared fetch carries no
  caller's signal (`binary.ts:612-626`): a caller's cancel stops only its own
  waiting, and the transfer carries on. The pack's job has its own
  `AbortController`, its signal goes into every fetch, and the EXPORT
  strip's X aborts the transfer itself. Single flight is per job.
- **A budget per file.** In `binary.ts` one `Fetching` carries
  `endsAt = now + budgetMs` (`:474`; `budgetMs` is 6 minutes, `:113`), each
  try's answer wait is `min(answerMs, endsAt - now)` (`:430`), and
  `outOfTime` (`:434`) stops the retries. Lifted with one `Fetching` for the
  job, a 205 MB install slower than about 0.6 MB/s passes minute 6 part-way,
  and every later file gets a 1 ms answer wait and no retry, so the install
  fails every time on that line. `fetchVerified`'s contract is one
  `Fetching` per file.
- **The host by name.** `shortReason` and `reasonOf` say "GitHub answered"
  and "GitHub did not answer" (`binary.ts:200-203`, `:404-409`). The shared
  module names the URL's host after its redirects, so a
  files.pythonhosted.org failure does not read as GitHub's.
- **The body streams to disk** instead of `Buffer.concat`.

#### The stages

The bar's weights are placeholders until the first measured install sets
them, as the reframe's 0–15 / 15–85 / 85–100 were.

| stage | bar | the speed column says |
|---|---|---|
| 0. **Checking** | 0 % | "checking space": `fs.statfs` on userData covers what is left to fetch, `bytesOnDisk` and 10 %, or the job fails "needs N GB free on <drive>"; on Windows root + `longestPath` + 16 ≤ 259 and root + `longestDir` ≤ 247, or it fails naming the path; the platform is supported; the lock is taken |
| 1. **Downloading** | 0–70 %, by bytes over every file | "downloading · 31 of 205 MB · 4.2 MB/s" |
| 2. **Unpacking** the interpreter | 70–75 % | "unpacking Python" |
| 3. **Installing the libraries** | 75–95 % | "installing libraries · 12 of 48" |
| 4. **Checking** the AI helper | 95–100 % | "checking the AI helper", or "waiting for the AI helper's work to finish" |

**1. Downloading.** `src/main/net/fetchFile.ts`, lifted out of `binary.ts`
(`tryOnce`, `withRetry`, `transient`, `FETCH_RETRY`, which `binary.ts` then
imports back):

```ts
export async function fetchVerified(file: PackFile, dir: string, f: {
  fetch: typeof globalThis.fetch; retry: FetchRetry; signal: AbortSignal; now(): number
  rename(from: string, to: string): Promise<void>      // renameWithRetry in the app
  onBytes(n: number): void; onMessage?(message: string): void
}): Promise<string>   // the verified file's path; one Fetching (its own retry budget) per call
```

Each file is streamed to `<name>.part`, hashed **and counted** while it
streams, and renamed to its own name (pip needs the wheel's filename to read
its tags) only when it is the file:

| what arrived | what it is | what happens |
|---|---|---|
| a `Content-Length` other than `bytes` | not the file | no retry; "something other than the file arrived from <host> (a sign-in page or a network filter?)" |
| the body ends short of `bytes` | a broken transfer (a proxy closing a chunked body, a CDN hiccup) | the `.part` is dropped and the file retried |
| the body runs past `bytes` | not the file | aborted at once, dropped, no retry |
| exactly `bytes`, another sha256 | the hard checksum failure | no retry; the job fails naming the file and its host |
| exactly `bytes`, the sha256 | the file | renamed into place |

A file already in `downloads/<pack>/` with its hash is skipped, so **a
cancelled or failed install resumes file by file**, and the Install button
says what is left (§3a.4). The largest single file is llvmlite's Windows
wheel, 42,986,588 B, so byte-range resume inside a file is not built in P;
release-assets honoured an explicit range and files.pythonhosted.org served
the zip-index range reads, so it can come later if the Surface's download
says so (§3a.8 row 33). Files go one at a time in P; parallel only if the
measured time asks for it.

**Renames are retried on Windows.** A scanner holding a just-closed file
makes a rename fail with `EPERM`, `EACCES` or `EBUSY`. `renameWithRetry`
(win32 only, those three codes, bounded, with backoff; graceful-fs 4.2.11,
already in `node_modules`, retries renames on win32 for those codes for up
to 60 s, `polyfills.js:96-123`) serves the 49 `.part` renames and the
receipt. The receipt has **no in-place fallback**: `store.ts:159-181`
writes settings in place when the rename is refused, and a receipt written
so could be torn; a receipt that cannot be renamed fails the job. CI cannot
show this: GitHub's Windows image disables real-time monitoring and IOAV
protection and excludes `C:\` and `D:\`
(`actions/runner-images` `Configure-WindowsDefender.ps1`, read by a
reviewer, 2026-10-14). The Surface can (row 27).

**2. Unpacking.** A streaming gunzip (`zlib.createGunzip`) into a
**streaming tar reader**: `@shared/assets/tar.ts` gains `TarStream`, a push
parser over chunks, beside `readTar`, which the library packs keep. It
honours PAX `path` and `linkpath` records and GNU long names (the ustar
prefix it already reads); it accepts a **symlink only when its target,
resolved from the link's own folder, stays inside the root**, and still
refuses absolute targets, hard links, devices and sparse files; it keeps
`safeMemberPath` and restores only the executable bit (`packs.ts:198-202`).
Not the `tar` npm package (7.5.22, BlueOak-1.0.0, in the lockfile tree as a
dev dependency) and not the system `tar`: the reader we have is pure,
already holds the safety rules and their tests, and Windows' `tar.exe` is
unmeasured on the Surface. If the real archives hold member types the
reader refuses (§3a.8 row 26), `tar` 7.5.x is the fallback, promoted to a
production dependency. **Row 26 has read the real archives (2026-10-14,
`EFFECTS.md` §57):** they hold only regular files and, on the Mac, 9
relative symlinks inside `python/`, so nothing the reader refuses; there are
**no PAX and no GNU records**, every name over 100 characters is carried by
the **ustar prefix field** alone (so `TarStream` joins prefix + `/` + name,
as `readTar` does); there are **no directory entries**, so the reader
creates each member's parent folders itself; and the executable bit comes
from the mode (0775 on the Mac's 19 executables, 0777 on Windows' 14).
Then, only if row 26 says so:

- **the standard library compiled once** (`<python> -E -s -m compileall -q
  python/Lib`), if the archive ships no stdlib `.pyc`, so `-B` costs no
  start time. **Row 26 says so, on both platforms**: every `.pyc` either
  archive ships is stale once unpacked. The measured command is `<python>
  -I -m compileall -q -j 1 <python/lib/python3.14 | python\Lib>` (2.22 s
  on the Mac, 1,059 `.pyc`; 2.03 s for Windows' tree compiled on the Mac);
  `-j 0` failed in the dev sandbox on `SC_SEM_NSEMS_MAX`, so it is `-j 1`
  unless measured outside it. `--invalidation-mode unchecked-hash` would
  free the `.pyc` from the unpacked mtimes; an option, unmeasured;
- **on the Mac, the quarantine stripped** (`/usr/bin/xattr -dr
  com.apple.quarantine <version folder>`, allowed on files the user owns),
  if row 31 finds `com.apple.quarantine` on the unpacked files, so
  Gatekeeper does not assess each of about a thousand `.so` and `.dylib`
  files.

**3. Installing the libraries.**

```
<pack python> -E -s -m pip install --isolated --no-index --find-links <downloads/1> \
  --no-deps --require-hashes --only-binary=:all: --no-cache-dir \
  --disable-pip-version-check --no-input --progress-bar off \
  --no-warn-script-location -r <lock>
```

spawned with `windowsHide: true` and the pack's environment. `--isolated`
ignores `PIP_*` variables and pip's config files; `--no-index` with a local
folder means pip never touches the network, so its proxy and certificate
handling never come into it; `--only-binary=:all:` means no build step can
run on a user's machine. The progress is the count of `*.dist-info` folders
in site-packages, polled every 500 ms, against the lock's line count; the
stage text is pip's last `Processing …` / `Installing …` line. Whether pip
writes the dist-info folders one package at a time is §3a.8 row 34. Cancel
kills pip's tree (`taskkill /f /t` on Windows, the shot finder's precedent,
§15 row 23). `--no-compile` would save 99.3 MB and the compile time at the
cost of the first start; measured before it is chosen (§3a.8 row 27).

**pip writes 19 console-script `.exe` launchers into `python\Scripts\` on
Windows** (counted by a reviewer from each wheel's `entry_points.txt`:
ctranslate2 7, huggingface-hub 3, numpy 2, and onnxruntime, av, tqdm, httpx,
cffi, idna and charset-normalizer 1 each). They are unsigned distlib
launchers made on the user's machine; nothing in the helper runs them, and
pip has no flag to skip them. `--no-warn-script-location` keeps pip's
"not on PATH" warning out of the stage text. Antivirus has flagged distlib
launchers before (pypa/distlib #126, via pip #5047), and a failed launcher
write aborts the whole install (pip #9023, open, cause not established), so
pip's "Failed to write executable" maps to a worded reason: "Windows would
not let pip write a small launcher file; antivirus may have blocked it.
Repair, or allow the AI helper's folder." Row 32 records whether Defender
touches `Scripts\*.exe` on the Surface. (Their shebangs hold the absolute
`python.exe` path, so R7's rename breaks them; harmless, since nothing uses
them.)

**4. Checking.** A `SidecarClient` on the new pack exactly as the service
will start it (`helperLaunch` of the pack's rung, cwd `sidecarDir()`,
`maxRestarts: 0`):

- `system.hello` within **120 s**, or row 29's measured cold start plus a
  margin once it is in (the first cold start after Defender has scanned the
  fresh `.pyd` and `.dll` files);
- `executable`, `prefix` and every `path` entry inside the version folder or
  `sidecarDir()`, by `path.relative` on real paths; `python` the manifest's
  version;
- `expects` ⊆ capabilities;
- one `system.ping`;
- a new **`system.selftest`**, which runs **each group in a fresh
  `sys.executable -E -s -B -c` child** (`CREATE_NO_WINDOW` on Windows) and
  returns each group's exit and its last error line. One process would not
  do: scikit-learn 1.9.1's Windows wheel preloads its own
  `sklearn/.libs/msvcp140.dll` and `vcomp140.dll` by name on `import
  sklearn` (`_distributor_init.py`, read by a reviewer; the DLLs re-read in
  its index 2026-10-14), and after that every later DLL in the same process
  that imports `MSVCP140` resolves to sklearn's copy. A self-test in one
  process passes as soon as sklearn comes first, on a machine where a fresh
  helper fails. And `hello` cannot see it either: `import librosa`, all that
  beats' `register()` does (`beats.py:313-315`), loads neither soxr nor
  numba; the first `librosa.stft` (`beats.py:124`) loads both. The groups,
  each doing the smallest real call that loads its native code:

  | group | in its own process | why |
  |---|---|---|
  | asr | `ctranslate2`, `av`, `faster_whisper`, `tokenizers` | ctranslate2's 59 MB DLL and av's FFmpeg |
  | beats | `librosa`, `soxr`, `numba`, `numba.core.typeconv._typeconv`, then `librosa.stft` on one second of silence | soxr's `soxr_ext.pyd` and numba's `_typeconv` import `MSVCP140.dll` (a reviewer's read of their PE import tables, 2026-10-14); neither wheel ships it |
  | onnx | `onnxruntime`, and a session on a 1-node Identity model shipped in `sidecar/forge_sidecar/selftest/` (under 200 B) | depth, salient, ground; a session is what loads `onnxruntime.dll` for certain |
  | vision | `numpy`, `scipy.ndimage`, `scipy.spatial` | `vision.measure` |
  | sklearn | `sklearn` alone | its preload must not mask anyone else's |
  | faces | the `mp_faces` worker's import-only run, through its bootstrap, with **`mediapipe_c_bindings.load_raw_library()`** | see below |

  **The faces group loads mediapipe's native library.** Registration asks
  only `find_spec('mediapipe')` (`SIDECAR.md`), and the worker's three
  imports (`mp_faces.py:294-296`) do not load it: measured by a reviewer in
  `sidecar/.venv-faces` (mediapipe 0.10.35, stubs first), after them
  `mediapipe_c_bindings._shared_lib` is still `None`. The library is loaded by
  `ctypes.CDLL` only when `FaceDetector.create_from_options` runs
  (`face_detector.py:236`, then `load_shared_library`; `load_raw_library`
  re-read 2026-10-14). On Windows it is `mediapipe/tasks/c/libmediapipe.dll`,
  28,736,000 B of C++, and the wheel's index shows no `msvcp140`. So the
  import-only spec (`importOnly: true`) also calls `load_raw_library()`,
  which needs no model, and returns its error line; exit 0, or 69 with its
  `error import` line. The worker's start costs 0.14–0.23 s on the Mac.

  Which DLL each group's call loads is read once on Windows (row 30); the
  CI listing of every native file's imports (§3a.6) answers which ones
  *need* a runtime the pack does not carry.

Then the stdlib and quarantine steps if row 26 and row 31 asked for them,
`pack.json` (with `hello` and `selftest`), older version folders removed
(receipt first), `downloads/` removed (§16.47), the lock released, and
`restartSidecar()`. **If helper work is in flight, the switch waits**
("waiting for the AI helper's work to finish") and can be cancelled; it
never kills that work.

**When the check fails part of the way.** If the helper starts but an
`expects` method is degraded, or a self-test group fails (on Windows most
likely a missing Visual C++ runtime, §16.45), the pack is **kept**: the
receipt records what was seen, the service adds the failed groups' methods
to hello's `degraded` so `helperCan` greys their controls, and the row
names what is missing, mapping "DLL load failed" to the Visual C++ sentence
`binary.ts:529-533` already uses, with Microsoft's link and a **Check
again** button that reruns the self-test with no download (for after the
runtime is installed). A pack whose helper does not start at all is removed
(receipt first), and the row offers Repair.

**Cancel, quit and the sweep.**

- A cancel during the download aborts the transfer, keeps the verified
  files and removes the `.part`, so the next press fetches only what is
  missing.
- A cancel after the download removes the version folder (receipt first)
  and keeps the downloads.
- A quit cancels the job (`before-quit`) and releases the lock.
- **The launch sweep** (each root's own, and nothing while another live
  instance holds the lock):
  - removes a version folder with **no** `pack.json`;
  - never removes a folder whose `pack.json` does not parse: it reads
    "Not running · Repair" (`damaged`), so a torn receipt cannot delete
    0.7 GB;
  - removes a version folder with a parseable receipt whose number is below
    the manifest's, but only when a complete pack of the manifest's number
    exists and no live instance has the old one in use (an Update
    interrupted after its new receipt would otherwise leave 0.66–0.72 GB
    behind for good);
  - removes any `downloads/<n>` of another pack number.

**Repair fetches first.** The first draft deleted the working pack and then
downloaded again, which on a flaky or offline line leaves a user with a
degraded pack holding none; it also dropped the staging rule the packs keep
(`packs.ts:170-175`). Repair is the same job with `repair: true`, in this
order, asserted as one shape: **every file fetched and verified into
`downloads/<n>`** (with its bar and its X, while the helper keeps running;
files already verified there are reused) → wait until idle → stop → exit
(the tree's too) → unlink the receipt → remove the tree (`maxRetries`, for
a scanner) → unpack → pip → check → receipt. If the fetch fails, the old
receipt and folder are untouched. If pip fails after the delete, the
downloads stay, so the next Repair works offline.

**Remove** asks first, with both sizes, then stops the helper and waits for
its exit, unlinks the receipt, deletes `<root>` (`maxRetries`), and resolves
the order again (`FORGE_PYTHON` or `absent`); `userData/models` stays unless
the confirm's box, off by default, says otherwise.

**Update**: when the manifest's lock or interpreter hashes differ from the
receipt's, the old pack is not used, its controls grey, and the row offers
"Update the AI helper · N MB" (§16.46). It installs the new number's folder
beside the old one (the helper is not running from it, so nothing waits),
and the old folder goes after the new receipt is written, or at the next
launch's sweep.

All three refuse while helper work is running or another instance holds
the lock or the pack, with the reason, so no work is lost.

### 3a.4 P.4 — The UI · 1–1.5 days, and the speech model · 0.5–1 day

**One home: Settings.** `WINDOW.md` §3.9 already homes "AI helper (Python)
status" in the settings panel, and §3's legend gives each control one home.
The row, by state:

| state | dot | the row |
|---|---|---|
| **Not installed** | grey, never red: it is every tester's first state, not a fault | **Install the AI helper · 170 MB** (205 MB on Windows), and under it: "Uses about 0.7 GB on disk. Downloads from github.com (and the host it redirects to, today release-assets.githubusercontent.com) and files.pythonhosted.org. Its own Python; any Python on this machine is left alone." Sheet 22's "the button has to say Python is not installed rather than spin" (`SHEETS.md:636-639`) |
| **Not installed**, part fetched | grey | **Install the AI helper · 120 MB left**: the manifest's bytes minus the verified files in `downloads/` |
| **Installing · <stage>** | grey | "its bar and its X are in EXPORT"; no second cancel |
| **Running · Python 3.14.8 · pack 1 · 0.7 GB** | green, only with every `expects` method a capability and every self-test group ok | what is on this machine, from hello; **Repair · 170 MB** (205 MB on Windows) and **Remove**, small, in the Key row's Save and Clear style (`SettingsPanel.tsx:239-253`). Repair's number is the manifest's bytes minus the verified files present (all of it after a success, §16.47) |
| **Running · 6 of 8 helper features · <reason>** | grey | a pack with a degraded `expects` method or a failed self-test group; for the Visual C++ runtime, its sentence and Microsoft's link; **Check again** and Repair |
| **Running · from FORGE_PYTHON <path> · N of 8 helper features** | green only when N is 8; otherwise grey | the dot comes from hello, not from the process being up (CLAUDE.md's Surface setup points `FORGE_PYTHON` at a bare python.org 3.12 with `setx`, which an Explorer-started packaged app inherits); Install stays, with "used instead of FORGE_PYTHON once installed" (§16.42) |
| **Update the AI helper · N MB** | grey | the old pack unused until pressed (§16.46) |
| **Not running · <reason>** | red | an installed pack that will not start; "Python is missing from the AI helper's folder (removed by antivirus?)"; a receipt that does not parse; a spawn refused by Group Policy (below); **Repair · N MB** first |
| **Not available on this computer · <reason>** | grey | macOS 13; Windows on Arm, unless §16.44 allows the x64 pack there; no button |

The on-disk number is the manifest's `bytesOnDisk` from CI's install; the
download numbers go through `pack.ts`'s `formatBytes`, which the packs'
`Get · 57 MB` uses. `helperState` gains `absent`, `damaged`, `installing`,
`partial` and `unavailable`, and takes hello and the manifest's `expects`,
so the header's dot (`App.tsx:79`, `:110`) and the row cannot disagree, as
its comment promises, and a bare interpreter is never green.

**Group Policy.** Some managed machines refuse executables under user
folders (astral-sh/uv #6584: a venv's `python.exe` refused with "This
program is blocked by group policy", os error 1260). This is not new with P
(yt-dlp's exe already lives in userData), but the helper's spawn error maps
to a worded reason ("Windows' policy on this computer blocks programs in
your user folder; ask whoever manages it, or point FORGE_PYTHON at an
allowed Python"), not "The AI helper keeps crashing".

**Everywhere else is a pointer, not a second Install** (§16.41). Each
"needs the AI helper" becomes a small button that opens Settings with the AI
helper row in view, as the Director's gear opens the same card
(`WHERE-THINGS-ARE.md`, Settings). Its text stays, so `ui-census.json`'s
three `needs the AI helper` rows (lines 5722, 7825, 7884) still match it;
its title gains "install it in Settings". MediaPool's disabled Transcribe has
no room for a link, so its title becomes "needs the AI helper — install it
in Settings" (the census row at line 4408 changes with it).

**Grey every Python control by its own method.** `reframeHelperFrom`
becomes `helperCan(status, method)` in `src/shared/sidecar/`, true only for
`ready` with the method in `hello.capabilities` and not failed by the
receipt's self-test; MediaPool and LinkTranscript move to `asr.transcribe`,
the reframe stays on `vision.faces` and `vision.facesModel`. LinkTranscript's
Listen stays the disabled "soon" it is: P makes its reason honest, not the
button live.

**The speech model's own press** (§16.49, recommended (a)). Once P makes
`asr.transcribe` available, Transcribe must not fetch 464 MB unnamed and
unpinned (What is wrong, above). So, in P:

- **Get the speech model · 464 MB**, beside a greyed Transcribe ("needs the
  speech model") and on the Settings row's model list, fetches
  `Systran/faster-whisper-small` through `media.download` at a **pinned
  commit** into `FORGE_MODELS_DIR`, through the job list, as the face
  finder's press does. Its commit and file hashes are read from
  huggingface.co when the press is built (outside this plan's hosts, not
  fetched for it).
- `_load_model` loads that local snapshot by its path with
  `local_files_only=True`, so a session's first load asks no host, and a
  set-but-unreachable proxy cannot stop a model on disk from loading.
- Test: with the model present, a transcription makes no request
  (`huggingface_hub.snapshot_download` replaced by one that raises); it
  fails with the size name passed as today. Census rows for the press and
  the greyed reason.

If §16.49 is answered (b) instead, Transcribe stays greyed "needs the
speech model" and leaves P's exit, and P is 0.5–1 day shorter.

**The EXPORT row** reads "Installing the AI helper" (or "Repairing",
"Updating") with the stage in the speed column, as the reframe's label does
(`job.ts:171-180`); `jobName` and `cancellable` (`ExportStrip.tsx:55-61`)
learn `helper`, cancellable while queued too, and it has no Show in folder
(`ExportStrip.tsx:443`).

**No first-run prompt** (§16.41): the grey dot, the pointers and the tester
guide (R10: Settings → AI helper → Install) are enough.

**The bridge.** The new `window.forge` calls (`helperPack.status`,
`install`, `repair`, `remove`, `checkAgain`, and the speech model's `get`)
go into the preload, `harness/bridge.ts` and the fallback bridge
(`WINDOW.md:588-589`), with stubs that walk the states.

### 3a.5 P.5 — Offline, proxies and restricted networks · inside P.3

**The hosts, named on the row and in the guide** (§16.40):

| what | host | measured |
|---|---|---|
| the interpreter | `github.com`, which redirects to `release-assets.githubusercontent.com` (GitHub has changed that host before: `objects.githubusercontent.com`) | the redirect and its 206 to an explicit range, 2026-10-14 |
| the wheels | `files.pythonhosted.org` | served the zip-index range reads, 2026-10-14 |
| models, each its own press later | `huggingface.co` and `*.hf.co` (Whisper, depth, BiRefNet: `SIDECAR.md`); `storage.googleapis.com` (the face finder) | 2026-10-13 |

pip contacts nothing, and `pypi.org`'s index is not used: the URLs are in
the manifest. The job's log records the host each file came from after its
redirects, so a tester's report names it.

**Three network stacks, not one.** The pack's own files come through main's
fetcher; the models come through the helper, which has two:

| fetcher | used by | trust | proxy |
|---|---|---|---|
| main's `fetchVerified` | the interpreter and the wheels | Node's (CI, vitest) or Chromium's (`net.fetch`, once row 19 says so) | Node's fetch ignored `HTTPS_PROXY` without `NODE_USE_ENV_PROXY=1` (§8.2); `net.fetch` uses the system's |
| the helper's `media.fetch_url` (urllib) | the face finder | certifi added to the default context (`media.py:489-508`) | urllib reads the system proxy settings on macOS and Windows |
| huggingface_hub 1.31.0 over httpx 0.28.1 | Whisper, depth, BiRefNet | `create_ssl_context` loads only `certifi.where()` (or `SSL_CERT_FILE`), no system roots | environment variables only (a reviewer's read, 2026-10-14) |

So on a network with a company root certificate or a system-set proxy,
Install can succeed through `net.fetch` and then every Hugging Face model
press fail. **Row 19 is part of P and is widened**: `net.fetch`, one
Hugging Face model press and one `fetch_url` press, behind the same proxy.
For the beta, the row and the guide say that model presses need direct
access (or a proxy in `HTTPS_PROXY`), and model fetches move to main's
fetcher with §16.22's one network stack (§16.40 (d)). Neither of main's
paths quarantines on the Mac (both write with `fs`); Mark of the Web on
Windows is §3a.8 row 32.

**Offline.** The download stage fails with the lifted worded reasons after
its retries ("files.pythonhosted.org did not answer · gave up after 4 tries
over 61s"), with the way out: "If this machine cannot reach github.com and
files.pythonhosted.org, point FORGE_PYTHON at a Python with the helper's
requirements." "Install from a file…" is later (§16.40). A model on disk
loads with no network (the speech model by `local_files_only`, §3a.4;
depth's and BiRefNet's loads are read for the same fault when P is built).

**TLS.** Our fetcher uses Node's or Chromium's trust; pip is offline; the
standalone OpenSSL's default bundle path exists on macOS. A model download
from inside the pack is part of the clean Mac's run (§3a.9).

### 3a.6 P.6 — Packaging and CI · with P.7's 1.5–1.75 days

**The installer still ships no Python.** The sidecar filter becomes
`!.venv*` and `!.venv*/**` (it names `.venv` and `.venv-faces` today,
`electron-builder.yml:66-72`; `tests/packaging.test.ts:89-104` holds every
`.venv*` folder on the packing machine to it). The two locks and
`resolved.json` ship in `sidecar/pack/`; their sha256 is in the manifest,
so a lock edited without `pack.ts` fails a test.

**The NSIS uninstaller removes the pack.** It leaves userData today
(`deleteAppDataOnUninstall` is not set), so every uninstall would leave
0.7 GB behind. An `nsis.include` with a `customUnInstall` macro removes
`$APPDATA\${PRODUCT_NAME}\python` (not the models, not the projects),
guarded by `${ifNot} ${isUpdated}` so an app update's silent uninstall of
the old version keeps the pack. That guard's behaviour is **unmeasured**
and is checked on the Surface with an update (§3a.9);
`packaging.test.ts` pins the include and the guard. On the Mac there is no
uninstaller; the guide says Remove first.

**CI installs the pack for real**, on the Windows push job and, by
§16.48 (b), on a **`macos-14` arm64 runner** pushed too, which is free for a
public repo and is the only place the pack's macOS 14 floor runs (the dev
Mac runs macOS 26). After the existing `npm test` (which keeps its bare 3.12
and every degraded check, §16.36):

1. **The URL probe, on every push**, cache or not: each manifest URL (about
   49) gets a HEAD or a 1-byte range request, asserting 200 or 206 and the
   manifest's length. Without it, a pinned file deleted from PyPI or GitHub,
   or a changed redirect host, breaks every tester's Install while CI stays
   green on the cached pack.
2. `tests/integration/helperPack.int.test.ts` runs the app's own job
   module, Node's fetch, into `${runner.temp}/forge pack é/userData` (**a
   space and a non-ASCII character**, as a user's profile name can have;
   non-ASCII model paths for CTranslate2 and mediapipe on Windows are
   unmeasured, CTranslate2 #1227). Under CI it **fails rather than skips**,
   as `exactCut.int` does.
3. **The helper's suites run again from inside the pack, through the pack's
   launch** (its flags and environment), not through the env rung. The
   first draft reached the pack through `FORGE_HELPER_PYTHON` and
   `FORGE_PYTHON`, which is `sidecarEnv(process.env)` with no flags
   (`client.ts:39-53`, `:123`): CI would have certified an environment no
   installed user gets. So `FORGE_HELPER_PACK=<userData>` (new in
   `tests/integration/venv.ts`) makes `resolveHelperPython` take the pack
   rung, and `venv.ts`'s `VENV_PYTHON`, `HAS_VENV` and `HELPER_PYTHON` and
   `sidecar.int`'s client all start through `helperLaunch` of that choice;
   `sidecar.int` gains one case that asserts the launch's argv is the pack
   rung's. The suites: `sidecar.int` (15), `sidecarMedia.int` (32 Python
   cases, **none may skip** with numpy present), `vision.int`, `beats.int`,
   `faces.int`'s stand-in-detector cases, `reframeJob.int`'s helper suite,
   and `asr.int` if its `jfk.flac` fixture and `tiny` model are seeded into
   the cached userData (decided when the step is written; the model's bytes
   are unmeasured).
4. **`pip check` from inside the pack**: every problem it reports is one of
   mediapipe's two (membership).
5. **The native imports, listed** (Windows job): a reader of every `.pyd`
   and `.dll` in the installed pack (`dumpbin /dependents` on the runner, or
   a PE import reader of about 60 lines) lists each import that is neither
   beside it in the pack nor part of Windows, by name, with
   `MSVCP140*`, `VCOMP140*`, `VCRUNTIME140*` and `CONCRT140*` always listed
   with where in the pack (if anywhere) a copy sits. The list is asserted by
   membership against a committed expected list, so a new need for a
   runtime shows as a failing diff on the push that brings it. That answers
   "whether they need it" for every native file on every push; whether a
   clean Windows *has* it stays row 30's.

**The cache**, built like yt-dlp's (`ci.yml:130-138`): the installed
`userData/python`, keyed on the OS, the architecture, **the ISO week** (as
yt-dlp's is), and a hash of `src/shared/sidecar/pack.ts`,
`sidecar/pack/lock-*.txt`, `src/main/sidecar/pack.ts`,
`src/main/net/fetchFile.ts` and `src/shared/assets/tar.ts`, with no
restore-keys. So the push that changes the installer or the lock runs a real
install, a real install runs at least weekly, and every other push runs the
suites from the cached pack. A red job saves nothing.

**What this closes and what it risks.** It runs the capability suites on
Windows for the first time (§12's "never run on Windows"), on the 2018
ffmpeg and a Windows CPU. That is also the step's open-ended risk, not
counted in its days. Salient's suite stays off the push path (a 115 MB model
and a 6.6–9.7 GB peak; the job does not call it, §16.35). GitHub's Windows
runners carry the Visual C++ runtime and run with Defender's real-time
scanning off, so CI cannot prove §16.45 or the rename retries.

**No new ffmpeg shape.** P runs pip and the helper, not ffmpeg: nothing
for §13 or `tests/oldestFfmpeg.test.ts`, and no render check.

### 3a.7 P.7 — Tests, harness, census

Every test is mutation-checked: the bug put back, the test seen to fail.
Anchors over lock lines, job argv and launch args use `matchAll`, never
`indexOf`.

**Unit tests (every push):**

- `tests/helperPython.test.ts`, `resolveHelperPython`. In development,
  `FORGE_PYTHON` beats `.venv`, and `.venv` beats the dev pack; in a
  packaged app the pack beats `FORGE_PYTHON`; `FORGE_PYTHON` with no pack in
  a packaged app is the escape hatch; a packaged app with neither is
  `absent`; a receipt with another `platform`, another `lockSha256` or
  another `interpreterSha256` is not a pack; a matching receipt with no
  interpreter file is `damaged`, and so is one that does not parse;
  development's `python` on win32 and `python3` elsewhere. Mutations, one per
  rung and one per receipt check: the PATH fallback restored in a packaged
  app; the env rung first in a packaged app; the pack before `.venv` in
  development; the escape hatch dropped; each hash check dropped; a missing
  interpreter read as `absent`.
- `tests/helperLaunch.test.ts`, `helperLaunch`: the pack rung's args hold
  `-E`, `-s`, `-u` and `-B` before `-m forge_sidecar` and never `-I`; on
  win32, `{PythonPath: 'x', pythonhome: 'y'}` comes out without either; no
  `PYTHON*` or `HF_*` key survives outside the set the app writes
  (membership), so `HF_ENDPOINT`, `HF_HUB_OFFLINE`, `HF_TOKEN` and
  `PYTHONSAFEPATH` are gone and `FORGE_MODELS_DIR` and the app's two `HF_`
  flags are there; `FORGE_PYTHON` in a packaged app gets `-B`; development
  is unchanged. Mutations: an exact-case delete (the `PythonPath` survives);
  `-E` dropped; `HF_ENDPOINT` kept; `-I` for `-E -s`.
- `tests/helperPackManifest.test.ts`: every file a 64-hex sha256 and
  positive bytes; every wheel URL on `https://files.pythonhosted.org/packages/`;
  the interpreter URL on an exact tag, never `latest`; **the lock's hashes,
  read with `matchAll` over every line, equal the manifest's wheel hashes
  as a set**; the lock file's sha256 equals the manifest's; the lock holds
  mediapipe and neither `opencv-contrib-python` nor matplotlib; `expects` ⊆
  `OPTIONAL_METHODS` and holds no stems or voice method; the button's
  number is the files' sum; `packPlatform` greys macOS 13 by
  `getSystemVersion`'s '13.x' (not a Darwin '22.x'), and reports Windows on
  Arm when `translated` is true on win32; each pack number in
  `history.json` carries one pair of hashes per platform. Mutations: a wheel
  dropped from the manifest but kept in the lock; opencv added to the lock;
  a `latest` URL; the lock edited without its sha256; the lock changed with
  the number kept; `os.release()` for the version; `translated` ignored.
- `tests/packLock.test.ts`, in TypeScript over the committed
  `resolved.json` (CI's bare Python has no `packaging`): every requirement
  of every lock line is in that target's lock or on the allowlist. It
  passes on the committed locks and fails with colorama dropped from the
  Windows lock.
- `tests/tarStream.test.ts`: `TarStream` gives `readTar`'s entries for any
  chunking (a property over random split points of an archive built in the
  test); a 150-character name carried only in a PAX `path` record lands
  under that name; `bin/python3 → python3.14` is accepted, `../../x` and
  `/etc/x` refused, a hard link refused. Mutations: PAX skipped as today (the
  member lands under its truncated name); the in-root check dropped. **And,
  since row 26 (2026-10-14):** the real archives carry their long names in
  the ustar prefix field and have no directory entries, so a 106-character
  name split across prefix and name lands whole, and a member whose folders
  have no entry of their own is written with them. Mutations: the prefix
  ignored; the parent folders not created.
- `tests/fetchFile.test.ts`, `fetchVerified` with a fake fetch and a fake
  clock:
  - a body cut at 90 % is retried and succeeds. Mutation: a hash-only check
    (it fails as tampered);
  - a `Content-Length` other than `bytes` fails at once with the "something
    other than the file" sentence and one fetch;
  - exactly `bytes` with a wrong sha256 fails on the **first** fetch.
    Mutation: the mismatch made transient (four fetches);
  - a 503 then a 200 is retried. Mutation: no retry;
  - past minute 6 across files, a later file's 503 is still retried.
    Mutation: one `Fetching` for all files;
  - after the job's abort, the fake body is read no further. Mutation: a
    shared fetch with no signal;
  - a files.pythonhosted.org failure names that host. Mutation: the
    hard-coded "GitHub";
  - an injected rename that fails with `EPERM` twice still succeeds on
    win32. Mutation: no retry.
- `tests/helperPackJob.test.ts`, the job with a fake fetch, a fake pip and a
  fake helper over a temp userData:
  - progress never goes down across the stages (a property over the fake's
    random chunk sizes);
  - a file that is not the file fails the job with no version folder and no
    receipt;
  - a cancel mid-download keeps the verified files and no `.part`, and the
    next press fetches only the missing ones (counted), with the offer's
    "N MB left" equal to the manifest's bytes minus the files present.
    Mutation: the cancel clears `downloads/`;
  - pip failing leaves no receipt, and `resolveHelperPython` does not pick
    the folder. Mutation: the receipt written before pip;
  - the receipt's rename refused past its retries fails the job and leaves
    no `pack.json`. Mutation: an in-place fallback;
  - a degraded `expects` method or a failed self-test group keeps the pack,
    with the receipt's reason, the method greyed by `helperCan`, and "DLL
    load failed" mapped to the Visual C++ sentence;
  - helper work in flight holds the switch. Mutation: restart at once (the
    fake's in-flight request is rejected);
  - **Repair's order is one ordered shape**: [all files verified, idle,
    stop, exit, unlink receipt, rm tree, unpack, pip, check, receipt]; with
    a fetch that fails, the old receipt and folder are untouched. Mutations:
    delete before the fetch; the receipt removed last;
  - Remove refuses while a helper job runs, and keeps `models/` unless
    asked;
  - the launch sweep removes a receipt-less folder and another pack's
    downloads, keeps a complete pack and an unparseable receipt, removes an
    old number only beside a complete current one, and **removes nothing
    while another live instance holds the lock**. Mutations: the sweep
    ignores receipts; the sweep ignores the lock; old numbers removed with no
    current pack;
  - Repair refuses while another live instance has the pack in use;
  - a stale lock (its pid dead) is taken over;
  - an install into a number whose folder exists without a receipt deletes
    it first;
  - two presses, one job. Mutation: no single flight.
- `tests/sidecarClient.test.ts`: two `start()` calls before hello spawn once
  (mutation: today's `running && hello` check); a hello timeout kills its
  child; `stop()` resolves on exit and leaves no pid alive, its tree included
  on win32 (a fake `taskkill`).
- `tests/sidecarService.test.ts`: a packaged build with no pack answers
  `sidecar:status` with `absent`, and `voiceStatus`, `separateStems` (which
  takes mid/side), and the beats, depth, measure and transcribe handlers
  each reject or degrade with **spawn never called** (mutation: `getSidecar`
  building a client as today); the status ask never calls `start()`; a
  restart's `ready` reaches `onStatus` (mutation: the service listening
  only for `log` and `gaveUp`).
- `tests/sidecar/test_selftest.py` (beside `test_media.py`): the self-test's import list holds
  soxr, numba, onnxruntime, ctranslate2, av and sklearn (membership;
  mutation: soxr dropped); each group runs in its own process (a stand-in
  that records its pid; mutation: one process); a stand-in mediapipe on the
  worker's path whose `load_raw_library` raises turns the faces group red
  (mutation: the call dropped).
- `tests/sidecar/test_asr.py`: with the speech model on disk, a
  transcription makes no request (§3a.4).
- `tests/reframeContract.test.ts` and the component tests: `helperCan` is
  false for `absent`, `damaged`, `installing`, `starting`, `failed`, a
  degraded method and a failed self-test group; MediaPool's Transcribe and
  LinkTranscript are greyed for a ready hello without `asr.transcribe`
  (mutation: back to `sidecarReady`, and Transcribe is enabled on a bare
  interpreter); `tests/renderer/settingsPanel.test.tsx` renders every state,
  the Install and Repair labels carry the offer's size, `absent` is grey
  (mutation: drawn as red "Not running"), a bare hello on the env rung is
  not green (mutation: green on the process alone), and a damaged receipt
  offers Repair, not Install.
- `tests/packaging.test.ts`: the `.venv*` filter, the shipped locks, and the
  NSIS include with its `isUpdated` guard.

**Integration, `tests/integration/helperPack.int.test.ts`** (opt-in on the
Mac with `FORGE_PACK_REAL=1`; always in CI). It installs the pinned pack
from the real hosts into a userData path with a space and a non-ASCII
character, then asserts: the receipt; hello's `executable`, `prefix` and
**every `sys.path` entry contained in** the version folder or
`sidecarDir()` (by `path.relative`, on real paths, never a string prefix);
`python` is `3.14.8`; `expects` ⊆ capabilities; every self-test group ok;
`audio.stems`, `voice.speak` and `voice.voices` degraded, each with its
reason; `pip check`'s problems ⊆ mediapipe's two. It prints `bytesOnDisk`,
the longest relative path and the longest directory, which go into
`pack.ts`. Mutations, each on a scratch copy of the lock or the launch:
without librosa (`audio.beats` degraded, `expects` fails); without
mediapipe (`vision.faces` degraded by `find_spec`, fails); `-s` dropped
with a user site planted in the test's own `HOME` / `APPDATA` (a `sys.path`
entry outside the pack, fails). And a guard in `venv.ts`: under CI with
`FORGE_HELPER_PACK` set, a `describeWithVenv` suite that would skip for "no
helper venv" fails instead (mutation: `venv.ts` ignoring the variable, so
every suite skips green).

**Harness check** `harness/helperPackCheck.ts`
(`window.__forgeHelperPackCheck`): the bridge reports `absent`; Follow the
subject's "needs the AI helper" pointer opens Settings with the row in view,
and the row shows the sized Install; the press puts "Installing the AI
helper" in the EXPORT strip with a stage; a cancel leaves "· N MB left"; the
stub reaches `ready` with the full capabilities, the row reads "Running ·
Python 3.14.8 · pack 1" with "Repair · N MB", and Follow the subject is
enabled; Transcribe is greyed "needs the speech model" with its sized press;
a stub with a failed beats group shows "6 of 8 helper features" and Check
again; Remove asks with both sizes and returns to Not installed.

**Census rows** (`tests/fixtures/ui-census.json`, each with its `needs`
recipe): "Install the AI helper", "Install the AI helper · N MB left", "Not
installed", "Installing", "Repair · N MB", "Remove", "Check again", "N of 8
helper features", "Update the AI helper", "Not available on this computer",
"Python is missing from the AI helper's folder", the hosts line, the
pointer's title, Transcribe's new title, "Get the speech model · 464 MB" and
"needs the speech model".

### 3a.8 P.8 — Measure before relying

These are §15 rows 26–38. Row 26 is P's first task; row 19 (`net.fetch`
behind a proxy) is P's too, widened in §3a.5.

26. **The pinned archives' members**, from a real download into a scratch
    folder: the interpreter's names (`python/bin/python3.14`, its `python3`
    link, `python/python.exe`), every member type (symlinks, PAX and GNU
    records, hard links), pip's version, whether an `EXTERNALLY-MANAGED`
    file (PEP 668) is present (which would refuse `pip install` into the
    tree), and **the count of `.pyc` under `python/Lib`** (none means the job
    compiles the stdlib once, §3a.3). On the Surface, from the unpacked
    pack: `sys.winver` and `sys.path` with a planted HKCU
    `PythonCore\<winver>\PythonPath` subkey, with and without `-E` (whether
    the face worker's bootstrap is needed, §3a.2).
    **Measured 2026-10-14, the Mac's half** (`EFFECTS.md` §57): both
    archives equal their pins (26,680,498 and 23,227,899 B, one redirect to
    release-assets); POSIX ustar with no PAX or GNU records, no hard links
    and **no directory entries**, every name over 100 characters in the
    **ustar prefix field** (9 on the Mac, 6 on Windows); 9 relative
    symlinks on the Mac, all inside `python/`; the interpreter is
    `python/bin/python3.14` (a regular file, 18,952,864 B, with `python3`
    and `python` linked to it) and `python/python.exe`, as the manifest
    says; pip 26.2.1; no `EXTERNALLY-MANAGED` and no `._pth` in either.
    The standard library ships 3 `.pyc` of 655 on the Mac and 168 on
    Windows (pip's 404 too), and **every one is stale on unpack** (members
    stamped 2024-01-01, the `.pyc` recording build-day mtimes), so the job
    compiles once: `python3.14 -I -m compileall -q -j 1 python/lib/python3.14`
    took 2.22 s and wrote 1,059 `.pyc` (19,043,394 B), and a 19-module
    import under `-E -s -B` went from 0.34 s to 0.07 s. The Windows tree,
    read on the Mac and never run, needs no `msvcp140`: its 58 PE files
    import only `VCRUNTIME140`/`_1` (shipped) and the Universal CRT.
    **The Surface half is open.**
27. **Install time** on the M1 Pro and the Surface, per stage (download,
    unpack, pip with and without `--no-compile`, the self-test), Defender's
    share on the Surface (11,629 files in the Mac's site-packages), and the
    rename retries' count there (the bound for `renameWithRetry`). If pip is
    too slow there, uv is the reserve (§3a.1).
28. **Bytes on disk, the longest relative path and the longest directory**,
    per platform, from CI's install. Windows is measured from the wheels'
    indexes today (about 0.72 GB with the interpreter); the interpreter's
    extracted size is measured only as its tar stream.
29. **The cold `system.hello`** from the pack on the Surface, **both** the
    first start after an install and the first after a reboot, against the
    client's 30 s. The client's hello timeout is set from it, plus a margin
    (§3a.2).
30. **The Visual C++ runtime on a clean Windows**, for **soxr, numba,
    mediapipe (`libmediapipe.dll`), onnxruntime and ctranslate2**, each
    imported (and called, as the self-test's groups do) **in its own fresh
    process**, and once more in the helper's own order (asr first,
    `capabilities/__init__.py:23-24`, and librosa loading sklearn lazily). Read
    by reviewers from the wheels by byte range, 2026-10-14: soxr's
    `soxr_ext.pyd` and numba's `_typeconv` import `MSVCP140.dll`, and numba's
    `omppool.pyd` imports `MSVCP140` and `VCOMP140`, and neither wheel ships
    either; onnxruntime 1.30.0's `onnxruntime.dll` (18,446,136 B) and
    ctranslate2 4.8.2's `ctranslate2.dll` (59,296,256 B, beside
    `libiomp5md.dll` 1,614,192 B and `cudnn64_9.dll` 266,288 B) ship no
    `msvcp140`; mediapipe's `libmediapipe.dll` is 28,736,000 B with no
    `msvcp140` in the wheel; numpy and llvmlite carry private, name-mangled
    copies (llvmlite's `msvcp140-8f141b….dll`, 557,648 B); av ships its own
    MinGW runtime; scipy's `_nd_image`, `_ckdtree` and `_uarray` import no
    `MSVCP140`. Whether onnxruntime's and ctranslate2's DLLs import it is
    CI's listing (§3a.6) to answer. Here also: the file version of every
    `msvcp140*.dll` in the pack (sklearn's reads FileVersion 14.51.36247.0,
    a reviewer). **Known, not measured here:** a System32 `msvcp140` older
    than 14.40 is a crash class for binaries built with VS 2022 17.10 or
    later (the `std::mutex` constexpr change), and the first `msvcp140`
    loaded serves the whole process. The Surface has the redistributable
    (`CLAUDE.md`) and so do GitHub's runners: Windows Sandbox or a fresh VM
    answers, and only after `Test-Path C:\Windows\System32\msvcp140.dll`
    inside it says it is absent (that is assumed, not known), and with its
    version read if present. The Sandbox's memory is not the floor's, so its
    run is not the memory measurement.
31. **The packaged, unsigned app on a clean Mac**, the DMG fetched through a
    browser in that account (so quarantined) and launched once from
    Downloads (so translocated, a read-only bundle) before it is moved:
    `xattr -l` on the pack's interpreter (no `com.apple.quarantine`; if
    there is one, §3a.3's `xattr -dr` step is turned on and run on the same
    account), `codesign -dv` on it (`adhoc,linker-signed`), the helper
    starting, a model download verifying TLS, and `codesign --verify
    --deep` on the app after a session (the helper must leave the bundle as
    it was). Apple's `LSFileQuarantineEnabled` page was not read (outside
    the hosts this measurement could reach).
32. **On Windows**: Mark of the Web on the fetched files; SmartScreen or
    Defender on the pack's `python.exe` and on `Scripts\*.exe` (§3a.3); a
    window flashing from the helper, a face worker or its ffmpeg in a
    packaged app (`python.exe` is a console exe,
    `PCbuild/python.vcxproj:96`; the client spawns it with `windowsHide:
    true`, `client.ts:122`, and workers with `CREATE_NO_WINDOW`,
    `media.py:51`); and the tree kill leaving no worker or ffmpeg.
33. **Range resume inside a file**, on release-assets and
    files.pythonhosted.org, and whether it is worth building over P's
    file-level resume.
34. **pip 26.2.1 over the lock**: `--require-hashes` with `--no-deps
    --no-index --only-binary=:all: --no-warn-script-location`, its output
    lines, and whether the dist-info folders appear one package at a time
    (the bar's measure).
35. **hf-xet left out**: depth's and asr's model downloads pass without it.
36. **The Surface itself**, recorded where no doc has it yet (grep of
    `docs/`, 2026-10-14): Windows 10 or 11, version and build (it decides
    Smart App Control and Sandbox), edition (Windows Sandbox is not in
    Home), free disk, CPU, the installed redistributable's `msvcp140`
    version, and the Smart App Control and Defender states.
37. **CI**: the install's minutes on a cache miss, the cache's size, what
    the capability suites' first Windows run finds, and **one Windows helper
    process running asr and then beats** (two OpenMP runtimes meeting would
    abort it; CI runs asr only if its model is seeded, §3a.6).
38. **The protocol's encoding under `-E`**: the helper's stdio through a
    reconfigure in `__main__` and through `-X utf8`, against today's
    `PYTHONIOENCODING=utf-8`, with a non-ASCII path in a request and a reply
    (§3a.2).
    **Measured 2026-10-14 on the Mac** (the venv's 3.14.6; `EFFECTS.md`
    §57): under `-E -s -u -B` and `LC_ALL=en_IE.ISO8859-1` stdin and stdout
    were `iso8859-1/strict`, a request carrying "Bräutigam 5:30pm ಕನ್ನಡ.mp4"
    was read as `Br\xc3\xa4utigam…` and a reply holding it failed ("'latin-1'
    codec can't encode characters in position 59-63"); `LC_ALL=C` cannot
    show it, since Python turns UTF-8 mode on there by itself. The
    reconfigure and `-X utf8` both round-trip under C, Latin-1 and UTF-8;
    the reconfigure was taken (`2700e2c`: stdin and stdout UTF-8 strict,
    stderr `backslashreplace`). **The Windows half (cp1252 pipes) is open**:
    CI's Windows job runs `sidecar.int`'s two row-38 tests first, then the
    Surface.

### 3a.9 P.9 — Exit · 0.5–1 day

- **CI**: on the Windows push job and the `macos-14` one (§16.48),
  `helperPack.int` installs the pinned pack into a temp userData with a
  space and a non-ASCII character in its path, and the helper's suites run
  green from inside it through the pack's launch, `sidecarMedia.int`'s Python
  cases with none skipped; hello's `executable`, `prefix` and every
  `sys.path` entry are inside the pack or `sidecarDir()`; the URL probe, the
  native-import listing and `pip check` are green.
- **A clean Mac**: a fresh macOS user account, no `FORGE_PYTHON`; the DMG
  from CI, **fetched through a browser in that account** and launched once
  from Downloads, as a tester's copy is (quarantined and translocated), then
  from Applications. Settings shows "Not installed" with **Install the AI
  helper · 170 MB**; the press puts its bar and X in EXPORT; one cancel during
  the download and a second press that shows "· N MB left" and fetches only
  what was missing; the self-test passes and the row reads "Running · Python
  3.14.8 · pack 1"; **Get the speech model · 464 MB** (§16.49 (a)) and one Transcribe on a
  pool clip; one **Follow the subject** (the face finder by its own 1.1 MB
  press); Repair once (its size shown); Remove once, both sizes shown,
  models kept; and row 31's checks. The dev Mac's python.org framework
  install stays visible to a fresh account, which is why hello's `prefix`
  and `sys.path` are the proof, not the absence of a Python.
- **The Surface**, two runs:
  - **the app**: Windows Sandbox if its edition has it (no Python, no
    `FORGE_PYTHON`; the Visual C++ runtime's absence checked, not assumed,
    row 30), otherwise a new local account **with a non-ASCII name** (so
    every pack path carries one), with no `FORGE_PYTHON`; the installer from
    CI; the same presses as the Mac at **· 205 MB**; row 32's checks; then an
    app update from CI's next installer, with the pack still there after it
    (the uninstaller's `isUpdated` guard), and an uninstall, with
    `%APPDATA%\Forge\python` gone after it;
  - **the bar's tests on the floor machine**: on the Surface's dev checkout,
    `FORGE_PACK_REAL=1` `helperPack.int` and then the suites from that pack
    (`FORGE_HELPER_PACK`), which tests the 8 GB machine's CPU and memory that
    CI's runner does not have. The full suite's output written to a file and
    `$?` checked.
- Typecheck green; the full suite green, written to a file and `$?` checked;
  every mutation above killed; CI read at github.com/spyki-a/forge/actions;
  `WHERE-THINGS-ARE.md`'s Settings and the census updated.

**Your part:** the clean-account run on the Mac and the Sandbox (or new
account) run on the Surface, about 2 hours with the downloads; the
Surface's dev-checkout run, about 1 hour; row 36's facts about the Surface,
10 minutes (the sandbox here can run neither Electron nor an installer);
and §16.36–50.

### 3a.10 Docs this step corrects · 0.5 day

Found stale on the way, each corrected when P lands:

- `requirements.txt:1-5` and `SIDECAR.md:69-71` say soundfile is sdist-only
  and that audio decoding goes through the bundled ffmpeg. soundfile 0.14.0
  (2026-06-06) ships `py2.py3-none` wheels for both platforms, and librosa
  1.0.0 requires it; beats decodes with our ffmpeg (`beats.py:59-64`), but
  **asr decodes with PyAV**.
- §12's "mediapipe supports 3.12–3.14 by wheel tags": 0.10.35's two wheels
  are `py3-none`, with no Requires-Python.
- `requirements-stems.txt`'s demucs 4.0.1 has no `demucs.api` (§3a.1).
- `PACKAGING.md:58` and `electron-builder.yml:19` say the venv is 542 MB;
  `du -sh sidecar/.venv` says 598 MB. `PACKAGING.md:61-62` says the
  requirements ship "so the setup step is available"; the pack replaces that.
- This section's old exit counted "twelve helper tests" and `CLAUDE.md`
  says fourteen; `sidecar.int.test.ts` has 15. `CLAUDE.md` says `client.ts`
  falls back to `python3`; the app's fallback is `service.ts:34` (`python` on
  Windows), and after P a packaged app has none.
- Then `SIDECAR.md` Setup (the pack, and the venv for development),
  `PACKAGING.md` ("What is deliberately left out", the first-run list, the
  uninstaller's macro), `CLAUDE.md`'s fresh-Windows table (`FORGE_PYTHON`'s
  new place; the dev pack's own root), `WHERE-THINGS-ARE.md` Settings,
  `BETA.md` R4 (the full route built) and R12 (the `python3` dialog question
  gone), and §14 below.

**§14 gains six rows**, written into §14 on 2026-10-14 with the plan: the
pack missing on an installed app; an install stopped part-way; a module
degraded inside the pack; a damaged pack; the machines with no pack; and
another app instance holding the pack.

### 3a.11 Sources · fetched or read 2026-10-14

- python-build-standalone: `https://api.github.com/repos/astral-sh/python-build-standalone/releases`
  and `…/releases/tags/20261001` (re-read by the writer for this text:
  every asset's size and digest, among them the plain Windows archive's
  50,181,000 B and the Windows arm64 stripped archive's 22,228,934 B) and
  `…/tags/20261013`; the asset URLs under
  `https://github.com/astral-sh/python-build-standalone/releases/download/20261001/`
  (the redirect, a 206 and a 501, and 4-byte gzip trailers by range); the
  build sources on `https://raw.githubusercontent.com/astral-sh/python-build-standalone/`
  (`cpython-unix/build-cpython.sh`, `cpython-windows/build.py`,
  `cpython-unix/build-openssl-3.5.sh`, `src/release.rs`, `docs/running.md`);
  issues #749 and #855 and PR #1255 on `https://github.com/astral-sh/python-build-standalone/`.
- uv: `https://raw.githubusercontent.com/astral-sh/uv/` (`fetch-download-metadata.py`,
  `download-metadata.json`); `https://api.github.com/repos/astral-sh/uv/releases`
  (0.13.1's assets); issue #6584 on `https://github.com/astral-sh/uv/`.
- python.org: `https://www.python.org/api/v2/downloads/release/` and the
  3.14.8 release files (the `.pkg`, the Windows installer, the embeddable
  zip); CPython's `Mac/BuildScript/build-installer.py`, `PC/layout/main.py`
  and `PCbuild/python.vcxproj` on `https://raw.githubusercontent.com/python/cpython/`;
  `https://raw.githubusercontent.com/python/cpython/3.14/Modules/getpath.py`
  (lines 700-728, re-read by the writer).
- PyPI: `https://pypi.org/pypi/<name>/<version>/json` for every one of the
  48 distributions in both locks and for kokoro-onnx (every release since
  0.4.8; 0.6.1 re-read by the writer), demucs 4.1.0, torch 2.14.1 and its
  stems set, onnxruntime 1.23.2, av 15.1.0, and the cp312 and cp315 checks;
  scikit-learn 1.9.1, ctranslate2 4.8.2, soxr 1.1.0, numba 0.67.0 and
  onnxruntime 1.30.0 re-read by the writer.
- The wheels' zip indexes and members by byte range on
  `https://files.pythonhosted.org/packages/…`: the 48 Windows cp314 wheels'
  central directories (sizes, file counts, the longest paths and directory,
  the DLL lists, `entry_points.txt`), and the PE import tables of soxr's
  `soxr_ext.pyd` and numba's `_typeconv` and `omppool` (reviewers);
  scikit-learn 1.9.1's Windows index re-read by the writer
  (`sklearn/.libs/msvcp140.dll` 643,512 B, `vcomp140.dll` 212,920 B).
- Licences: `https://api.github.com/repos/mirror/x264/license`,
  `https://api.github.com/repos/videolan/x265/license`, the pyav-ffmpeg
  README on `raw.githubusercontent.com`; `facebookresearch/demucs` at
  `v4.0.1` and `adefossez/demucs` on `api.github.com`.
- `https://raw.githubusercontent.com/actions/runner-images/…/Configure-WindowsDefender.ps1`
  (a reviewer).
- `https://api.github.com/repos/spyki-a/forge` (`private: false`).
- Issues: pypa/distlib #126, pypa/pip #5047 and #9023,
  OpenNMT/CTranslate2 #1227, SYSTRAN/faster-whisper #967 (on `github.com`).
- Electron 44.3.0: `docs/api/app.md` at `v44.3.0` on
  `raw.githubusercontent.com/electron/electron`, and `electron.d.ts:1995`
  in `node_modules`.
- On the dev Mac: the venv's RECORD sizes and `du`; `xattr` on a file
  written by Electron's Node; `/private/etc/ssl/cert.pem`; Electron's
  `Info.plist`; `otool -L` on av's libavcodec (a reviewer); mediapipe's
  `_shared_lib` after the worker's imports in `.venv-faces` (a reviewer);
  `client.ts` with a slow fake helper (a reviewer: pids 7087 and 7099);
  `graceful-fs` 4.2.11's `polyfills.js` and `tar` 7.5.22 in `node_modules`;
  `_bootstrap_external.py:205`; huggingface_hub 1.31.0's
  `_snapshot_download.py`, httpx 0.28.1's `create_ssl_context` and
  faster-whisper 1.2.1's `download_model` (reviewers).

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

> **Built 2026-10-05** — the backend only, no UI. `src/shared/ingest/args.ts`
> (`buildMetaArgs`, `buildCaptionArgs`, `META_MARK`/`SUBS_MARK` in
> `readMarkedLine`, `captionKeys`, `parseMeta`, `parseRequestedSubtitles`),
> `src/shared/ingest/captions.ts` (`parseJson3`, `json3Kind`, `mergeTracks`
> for §16.12, `transcriptFromTracks`, `shiftTranscript` with the run),
> `src/shared/transcript.ts` (`।` and `॥`, the optional cap, `capSegments`),
> `src/shared/ingest/url.ts` (`linkCacheKey`: the id plus a digest, so two
> ids differing only in case are two folders), `src/main/ingest/meta.ts`
> (`runMeta`, `runCaptions`, one run per link key), IPC `ingest:meta` and
> `ingest:captions`, preload `ingestMeta`/`ingestCaptions`, the harness
> stubs, and `removePartials` fixed. Tests: `tests/ingestArgs.test.ts`,
> `tests/ingestCaptions.test.ts`, `tests/integration/ingestCaptions.int.test.ts`
> (the fake yt-dlp extended), and the fr/en/en-orig cleanup case in
> `tests/integration/ingestDownload.int.test.ts`. Measured with yt-dlp
> 2026.08.19 (`EFFECTS.md` §40): `channel`, `uploader`, `webpage_url` print
> on all eight videos tried, and absent fields are omitted, not null; with no
> uploader track `<l>` is a byte copy of `<l>-orig`. **Without the word-end
> estimate an unpunctuated English track was one segment for 31 minutes**;
> with it and the cap, 362 (p50 15 words, max 30, 11.9 s). 80 ms a grapheme
> is confirmed for English (p50 64–70); Hindi and Telugu run 120–160, left
> open. Hindi ASR ends sentences with `।`, never `.`. On one of two videos
> the uploader's track ran **12.0 s ahead of the ASR**: matching on its clock
> found 8.7% of its words; with the per-line clock alignment added for it,
> 93.9%. The event-gap rule never added a break the pause rule had not
> (derived: the word gap is never smaller than the event gap) and is kept as
> the backstop for wrong word ends; a test builds the one case it alone
> breaks (a word starting past its event's end). **Two signatures differ from
> the text below:** `capSegments` takes the Transcript —
> `capSegments(t, 30, 15000)`, not `t.segments` — because it splits at the
> gap between words, which segments do not carry; and `segmentIntoSentences`'
> optional third argument is `{maxWords, maxMs, breakAfter}`, `breakAfter`
> carrying the event-gap breaks. After review (2026-10-06): a caption fetch
> writes into a staging folder of its own and renames its tracks into
> `userData/url/<linkKey>/`, so a failed or cancelled fetch never deletes the
> tracks an earlier one left for a placed clip; `ingest:meta` and
> `ingest:captions` give up after 60 s and 120 s with a timeout error, not a
> cancel; a quit aborts both; the merge keeps ASR words the uploader's lines
> do not cover (2 words on one video, none on the other) and glues a lone
> punctuation token as the lone-track parse does. **After M0's exit run
> (2026-10-13):** the caption run passes `--ignore-errors` and drops any
> track whose URL carries `tlang` (`debe991` — on two of your dubbed links
> `<l>` was a dub's machine translation that answered 429 and stopped the
> run before `<l>-orig`); so "`<l>` is a byte copy of `<l>-orig`" above holds
> only on a video with no dubs. The metadata run also prints whether any
> caption track exists (`de3f286`). Both in §3b.9 and `EFFECTS.md` §51.

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

> **Built 2026-10-06** — §3b.2 to §3b.5, the URL tile's half (M0 slice 2;
> §3b.6, the Transcript tile's, is slice 3). `src/shared/ingest/wordRun.ts`
> (`rowsOf`, `runFromRows`, `extendRun`, `snapHandle`, `stepHandle`,
> `runOfChapter`, `runRange`, `msAtY`; in `ingest/`, beside `WordRun` in
> `captions.ts`, not `edit/`), `MIN_RANGE_MS` moved to `section.ts`,
> `src/shared/ingest/linkClip.ts` (`TranscriptFrom`, `linkCredit`,
> `checkLinkClip`, `transcriptFits`, `runIn`), `AssetCredit` and
> `MediaAsset.credit` in `timeline.ts` (source `'link'` only, no licence yet;
> the credit line shows in the pool tile's tooltip),
> `components/tools/TranscriptRows.tsx` (rows, click and shift-click, the
> Start and End handles, every handler on the rows' box) and
> `components/tools/LinkTranscript.tsx` (Get transcript, the chips, Clip it,
> Add another clip, the From/To mirror, the no-caption notice, Listen to it,
> Choose the language) inside `IngestPanel.tsx`; the store's `urlSource`
> slice, `getTranscript`, `setUrlRun`, `clipItFromLink`, `addAnotherClip`,
> `startIngest(override)` and `collectIngest`'s words and credit in its one
> begin/commit; `src/main/ingest/start.ts` (`ingest:start`'s payload, the clip
> checked). **Where it differs from the text below:** `transcriptFrom`
> carries the track KEYS, not a `captionPath` — two tracks are merged
> (§16.12), and the re-read must merge the same two for the run's indices to
> mean the same words — plus the run's word count and first and last words,
> so a transcript a later fetch replaced has the run found again in it
> (`runIn`: as many words, the same first and last, starting inside the
> range), and only failing that lands the range's words. It also goes to MAIN
> with `ingest:start` (`clip`, checked field by field) and comes back from
> `ingest:collect`, because `pendingIngests` does not survive a Cmd+R either;
> the tracks are then read again by `ingest:captionTrack({linkKey, key})`,
> which checks both keys and builds the path in main. And Clip it's done row
> has no **Captions on**: captions are switched on in OUTPUT as for any
> transcript (store-tested with the shifted words); Listen to it is greyed in
> every case in M0 ("needs the AI helper", or "soon" with the helper up), with
> no size line, since the audio download is Step P's. With words on screen the
> typed From and To give way to the run's, read-only, and a plain Get takes
> the whole video — and says so: it reads **Whole video**, is no longer the
> accent button, and Enter in the link box does not press it (the user's call
> to confirm; the alternative was Get taking the run). Relabelled the same day,
> the user's decision ("let's specify the complete full download, clip
> download, so that way it will be clear"): Get, while words are shown, reads
> **Full download** ("Download the whole video and put it on the timeline"),
> and Clip it's button reads **Clip download** ("Download only the words you
> picked and put them on the timeline"); with no words shown Get stays **Get**;
> measured in the 240 px column, 113.5 px and 116.9 px, one line each, the link
> box beside Full download 94.3 px. After review: a row
> shift-click extends from the row last CLICKED only while nothing else has
> moved the run — after a drag, a key or a word shift-click it extends the run
> on screen, keeping a start set by hand; a handle moved by a key into another
> row keeps the focus, and the keys it takes stop at it (the window's arrows
> step the playhead); Clip it takes the video, or the sound with Audio chosen,
> never a song's Instrumental or Vocal stem; `formatMark` rounds to tenths
> before splitting minutes (59 960 ms showed `0:60.0`); a chapter's bounds are
> rounded to whole ms (`4.03 * 1000`); a credit with no title is not the link
> twice; "landed without its words" is said only once the clip has landed.
> Tests: `tests/wordRun.test.ts` (14, two properties over 300 random
> transcripts), `tests/linkClip.test.ts` (7), `tests/renderer/ingestPanel.test.tsx`
> (20; `.test.tsx` added to vitest's include), `tests/renderer/clipItCollect.test.ts`
> (11, including a save/load/relink keeping the credit), `tests/ingestStart.test.ts`
> (7: main's `startRequest`, the preload with a fake `ipcRenderer`, and the
> handlers' wiring by counted anchors), a `formatMark` case in
> `tests/ingest.test.ts`, and three `ingest:captionTrack` cases in
> `tests/integration/ingestCaptions.int.test.ts`; 68 mutations, each killed and
> restored byte-identical. Census: 35 rows in the `url` home under ten
> `link-*` recipes and `none`; the full census on a fresh page gave missing
> `[]`, 793 checked, 8 skipped. `window.__forgeClipItCheck()`
> (`harness/clipItCheck.ts`) on a fresh page: 12 rows; rows 3–6 picked
> `{from 18, to 53}` by click and shift-click and by the dragged handles alike
> ("0:39.6 selected", as `formatMark` of its range); the arrow keys on Start
> and End across a row's edge each way, a word a press, the focus kept on
> every one and the playhead never stepped; Start dragged into row 2's middle
> (`{14, 53}`) then row 7 shift-clicked gave `{14, 62}`; the Middle chip
> `{39, 79}`; Get read "Whole video", not the accent, and Enter started
> nothing; Clip it one exact job, `*25.000-64.600`, one
> `--download-sections`; Add another clip kept 12 rows, cleared the run,
> started nothing; rows 8–9 a second job, `*85.000-100.800`, one section; the
> no-caption link said so, Listen to it greyed with "needs the AI helper", a
> chip set typed From and To — no failures, 1359 ms. Since then: §16.13 is
> answered on the Mac and confirmed on the 2018 build by `exactCut.int.test.ts`
> in Windows CI (run 37571739663, green); the `clipIt.int` render check is
> still to write.
> Clip it inherits ingest's collect-once rule (2026-10-06, `INGEST.md`, "The
> renderer half"): main marks a job collected when `ingest:collect` hands it
> back, so a reload no longer lands its clip, words and credit a second time.

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

> **Built 2026-10-06** — the exact cut Clip it defaults to (`CLIP_IT_EXACT`,
> `store.ts`) was cross-correlated against its source on the Mac, its first
> frame the source's at the requested start on three videos (the next frame,
> within half a frame, when a start falls between frames, on those and a
> fourth) and its sound exact to the sample (`EFFECTS.md` §41), and `tests/integration/exactCut.int.test.ts`
> runs the real yt-dlp through the bundled ffmpeg so Windows CI measures the
> 2018 build — **run 37571739663 on `d458cb0`, 2026-10-07: green, so the
> cut is frame-exact there too** — which leaves exact the default (§16.13).
> **After M0's exit run (2026-10-13):** a sectioned download refused at once
> (a googlevideo 403, about one in ten on your links) runs again with fresh
> URLs, up to three runs, and a cut that still fails says ffmpeg's reason
> (`db75a1f`, `d71a207`). On real streams the exact clip's picture sits
> within one source frame of its sound and its sound at 0 ms against the
> fast cut, on 18 clips (§3b.9, `EFFECTS.md` §51).

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

> **Changed 2026-10-13, from M0's exit run (§3b.9)** — a link with no
> caption track of any kind (the details' track flags `00`) says "This
> video has no captions" at once instead of asking a language first, and
> offers no language (`de3f286`); and captions burn through libass's
> complex shaper, `ass=…:shaping=complex` in place of `subtitles=`, which
> ran the simple one, so Hindi and Telugu conjuncts and pre-base vowel signs
> are drawn joined and in place (`2ead680`). Both in `EFFECTS.md` §51.

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

> **Built 2026-10-06** — the Transcript tile's half (M0 slice 3).
> `src/shared/timeline.ts` `timelineFrameAt(clip, sourceMs, fps)`: the first
> timeline frame showing the source frame that holds `sourceMs`, or a later
> one — a binary search over `sourceFrameFor`, so constant speed and ramps
> alike — clamped to `[start, clipEnd]`, null for a hold. `src/shared/edit/clipIt.ts`:
> `clipSourceWindow`; `cutFrames` (the first word's start floored to its
> frame, the last word's end ceiled; at a speed above 1, where the timeline
> skips the frame holding the start, the frame before it, so a word's first
> sound is not lost); `clipToRange(project, clipId, startMs, endMs) →
> {project, note}` (the start kept, the in-point the source frame the clip
> showed at the cut's first frame, the length the cut's frames; a ramp keeps
> its part of the curve, as `splitClip` gives each half its part; the
> animation rebased as `trimStart` does; nothing else on the track moves; at
> a constant speed the length is counted on the cut clip's OWN frames, from
> its whole-frame in-point, and between 1× and 1.5× a cut whose old clip
> skipped the word's first frame opens on it, so cutting the cut clip to the
> same run again changes nothing — measured before, of 300 runs a second press
> shaved a frame at 0.5× in 299, 0.75× 102, 1.5× 27, and at 1.25× 107, 66 of
> them at the head; a ramp is within one frame, not a fixed point; a hold
> refused with `HOLD_NOTE`, "this clip has a hold; cut it by hand"; a picture
> whose sound is on its own track, `audioDetached`, refused with
> `DETACHED_NOTE`, "this clip’s sound is on its own track; cut both by hand"; a
> still, a range outside what the clip plays and a cut keeping the whole clip
> return the same project, so no undo step); `clipWords(t, window, rule)` (the
> words whose MIDDLE the clip plays — the rows' — or, `overlap`, every word it
> plays any part of; renumbered by position — a Whisper transcript's indices
> have a gap once a word was emptied, `withWordText` — with the whole
> transcript's sentences cut to them, cached per transcript and span so the
> rows are not made again on every playhead move); `clipEditWords` (Edit's:
> the overlap, or a hold's whole transcript). The store: `clipRun`,
> `setClipRun`, `cutToWords` (one `update()`, one undo; the pick cleared) and
> `placeAssetRange` (begin → `addAssetToTimeline` → `clipToRange` → commit; a
> still, and a range wholly outside the asset, refused — null, nothing placed,
> no undo step). `TranscriptPanel.tsx`: `TranscriptBody` (Edit's words, or the
> rows, or the line saying why there are none) and `ClipWords` —
> `TranscriptRows` with three new props, `stampOf` (a row's time on the
> TIMELINE), `activeRow` (the row under the playhead, read through
> `sourceFrameFor`) and `fill` — the hint line, "0:02.8 selected" (the cut's
> length on the timeline), **Cut to these words**, the hold's note, the lifted
> sound's and "No words are spoken in this clip"; picking moves the playhead
> to the cut's first frame, so a click on a row still jumps there. **Where it
> differs from the text below:** the button is **Cut
> to these words**, not Clip it — on a clip already on the timeline it is a
> cut, not a download (the URL tile's is **Clip download**, §3b.2's note);
> `timelineFrameAt` takes `fps`, since a word is in ms and a clip in the
> project's frames; the rows are the words the clip PLAYS, not the asset's
> whole transcript, so every row can be cut to and nothing outside the clip is
> offered (a cut never grows a clip: it is a trim, not a ripple); the cut
> keeps the clip's START and slides the kept footage to it — not what a drag
> head trim does (`trimStart` moves the start with the in-point) — so a
> picture whose sound was lifted (Detach audio, every Director J-cut,
> `apply2.ts`) is refused with its note rather than left out of sync with its
> sound, and a Director backdrop (the same footage on a lane below,
> `apply2.ts`) is NOT detected: a cut moves the picture against it the same
> way; Edit corrects every word the clip plays ANY part of (what its captions
> burn, ass.ts's overlap — a word its edge cuts through included), a hold's
> whole transcript as before, sent back to the store by the whole
> transcript's index, and is not offered when the clip plays no word; the
> rows fill the tile with the line and the cut under them, because with a
> clip selected the dock takes the column's lower half and in the harness the
> cut sat below the rows' 18 rem box, out of sight — and the block's least
> height is its own (the rows' basis 0 px, not `flex-1`'s 0 %, which made it
> every row tall), so in a column too short for it the tile scrolls rather
> than drawing the cut over Listen for, as the first version did (the
> review's 240 px column: 137.5 px given of 176 needed);
> `placeAssetRange` has no button yet — it is the store action step 4's
> cards will call. At 1× and 2× every kept frame shows exactly the footage it
> showed; at 0.5× and through a ramp within one source frame, because an
> in-point is a whole frame (a split has the same property). Tests:
> `tests/timelineFrameAt.test.ts` (11: the round trip over 200 random frames
> at 1×, 2×, 0.5× and two ramps, the first frame showing a source, 29.97 fps,
> a skipped source frame, the clamp, the hold), `tests/clipIt.test.ts` (28:
> exact frames at 1×, 2× and 0.5×; 150 random runs at each of seven speeds
> landing on the words' frames, on the old clip's frames and the cut's own;
> the ramp's part; the animation; a second cut changing nothing at eight
> constant speeds; what is refused, the lifted sound built with
> `detachAudio`; `clipWords` by middle, across an index gap, and cached,
> both rules at once; `clipEditWords` by overlap and for a hold),
> `tests/renderer/clipItStore.test.ts` (5: the store's cut and
> `placeAssetRange` each ONE undo step, a range outside the asset placing
> nothing, the store being the renderer's) and
> `tests/renderer/transcriptPanel.test.tsx` (11: the clip's rows and their
> timeline times at 2×, the active row, no transcript, the hold with Edit
> still listing the whole transcript, the lifted sound, nothing said with no
> Edit, a pick moving the playhead, the cut in one undo and one undo back, a
> stale pick not shown, Edit's correction landing on the whole transcript's
> index past an emptied word, and a word the clip's edge cuts through listed
> and corrected); `tests/renderer/ingestPanel.test.tsx` relabelled. 50
> mutations, each killed and restored byte-identical, run in a copy of the
> tree so a concurrent suite never saw them (the review's thirteen among
> them). Census: twelve rows in the `transcript` home under `transcript`,
> `transcript-run`, `transcript-hold`, `transcript-silent` and
> `transcript-detached`, the URL tile's four renamed, the tile's tooltip
> ("…click to jump, cut the clip to a run of them, correct a misheard one");
> the full census on a fresh page gave missing `[]`, 805 checked, 8 skipped
> (46.9 s). `window.__forgeClipItCheck()` step 9 on a fresh page: the stub talk on an
> offline asset at 2×, 12 rows, row 3 at "0:12" (its source time 0:25), rows
> 3–6 `{18, 53}`, the playhead on frame 375, "0:19.8 selected", Cut to these
> words → `{start 0, inPoint 750, duration 594}`, `clipToRange`'s, every kept
> frame the same footage, one undo step; one undo → `{0, 0, 2250}`; the cut
> measured against Listen for with the dock open in the 239.7 px column — as
> the tile opens its bottom 305 against Listen for's top 313, with the run
> picked 277.4 against 285.4, on screen unscrolled both times, the tile's
> content 336 px in 298 (it scrolls 38); against the first version's layout
> the same check fails both ways (305 and 277.4 over 274.7), and with the
> rows' basis back at 0 % the cut fell to 708 px in a 313 px tile; and 4b
> measured the relabel in the 239.7 px column — "Full download" 113.5 px and
> "Clip download" 116.9 px, one line each, the link box 94.3 px — no failures,
> 1562 ms. Still open: the `clipIt.int` render check and Listen to it
> (§16.13 is answered on the Mac and confirmed on the 2018 build in Windows
> CI, run 37571739663). Edit's overlap rule matches the
> export's captions only at 1×: `captions/timeline.ts` still maps in-point and
> length without speed or hold — §17's speed-aware captions, which will share
> `timelineFrameAt`.

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
- New: `src/shared/ingest/wordRun.ts`, `src/shared/edit/clipIt.ts`,
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

  > **Built 2026-10-07** — `tests/integration/clipIt.int.test.ts` (README in
  > `tests/output/clipit/`): a lossless 30 fps source naming each frame in
  > bars, 57 made-up words 15–25 frames apart, irregularly (so a run's onsets
  > are its own), served as json3 by the fake yt-dlp, which now also cuts the
  > section with the bundled ffmpeg in yt-dlp's two-input shape (§41). Main's
  > handlers behind the real store: Get transcript, w31–w40, `clipItFromLink`
  > (exact) — the fast cut through `startIngest` with the same override and
  > `offsetIntoDownload` as head — `collectIngest`, then exported through
  > `prepareCaptions` (libass) and the bake's plan (stand-in pictures spelling
  > the lit word). **Read by the picture**: a word's frame is the export frame
  > whose bars show its source frame, and each captioned export must show the
  > captionless one's frames, frame for frame; a caption is band pixels more
  > than 40 levels from that captionless export (blank frames 0 such pixels,
  > captioned ≥ 611; held frames 0 change, word onsets ≥ 621), a line its first
  > frame after a blank, a word that or a change in the band. Mac, exact and
  > fast alike: the first frame is source 631 (w31's); lines at 0, 47, 107, 179
  > against 0, 47, 107, 179 on both routes; libass every word +0; the bake +0
  > as well since §44 (before it, w32 and w35 lit a frame early: its pictures
  > started on a 40 ms grid, `EFFECTS.md` §42; the bake's tolerance is now 0);
  > a one-word run captions its word alone. Recorded, not asserted: one range,
  > two lengths — the exact file 187 frames (631…817), the fast clip 186
  > (`trimToRequestedRange` rounds the range's 186.21 frames, dropping 817);
  > whether it should keep the last frame starting inside the range is open.
  > Mutations, each killed by the reading, restored `cmp`-identical: the shift
  > early by the range's start (no caption anywhere); the fast cut's head
  > dropped in the collect (none on the fast cut); the run filter widened to
  > the range (w47 joins the one-word clip at frame 20); the unshifted
  > transcript (every leg — the exact cut 8 onsets for 10; the fast cut's ten up
  > to 11 frames off, w34 at 53 for 47, its bake showing w14–w23); the libass
  > and the bake offsets without the in-point; ASS times 67 ms late (+2); the
  > picture a frame late under the bake only (`tpad` before the overlay: w32
  > lit 2 frames early, caught only by the frame-for-frame comparison).
  > **Found**, measured before §43: the bake ended an export at its last
  > caption (`shortest=1`) — the one-word clip, 8 frames of 30 (§42; fixed in
  > §43, committed as `0aaae32`). Since then that leg reads both routes: 30
  > frames, w46 at +0, so it guards §43 as well. The bake's second finding,
  > the 40 ms grid, is fixed in §44 (the list on the demuxer's own 1/25 s
  > clock, scaled back with `settb`+`setpts` before `fps`; every rate 0 wrong
  > frames on the Mac; the 2018 build measured by CI on the push).
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

> **Built 2026-10-12, run 2026-10-13 on your ten links** —
> `tests/integration/m0Exit.int.test.ts` (opt-in, `FORGE_M0_EXIT=1`; never
> in CI), the runs and readings in `tests/fixtures/m0Exit.ts` (unit tests
> `tests/m0Exit.test.ts`), all 42 tests green on the last full run (693 s);
> the clips, the runs' words and every reading are in
> `tests/output/m0-exit/` (gitignored), the numbers in `EFFECTS.md` §51.
> **Against the first bullet: 8 of the 8 links with captions landed** — each
> clip exactly its run's words, nothing outside it, captions on; **Add
> another clip** gave a second clip with only its own words on
> `O35KGzkS4VA` and `eK71EN3P78U`, the first clip, asset and words
> unchanged; and on **both no-caption links** Get transcript says `none` at
> once (and `none` again when English is asked), with the fields, the
> notice and Listen to it greyed. Nothing measurable in the bullet is left
> open on the Mac; what is left is the ear's, below.
> The run found four things in the product, each fixed: Get transcript
> failed on `O35KGzkS4VA` and `3pG8Hgq3Z8M` (a dub's machine-translated `en`
> answering 429; `--ignore-errors`, and a translated track is never kept);
> about one sectioned download in ten was refused at once (a googlevideo
> 403; a refused cut now gets three runs, and its error says why — 2 of the
> last run's 36 needed a second); Hindi and Telugu captions were burnt
> unshaped (the `subtitles` filter's simple shaper; now `ass` with
> `shaping=complex`); and the two links with no caption track asked for a
> language before saying so (now said at once). Measured on the eight
> caption links: 18 clips (a run at 40 %, a second through Add another clip
> on two links, and a run with no pause either side on every link) — each
> exactly its words, each word where the run had it on the file's clock,
> the sound exactly the range, the clip 0–2 frames past it, the original
> audio read off the file (correlation 0.98–1.00 against the original
> track's own section, 0.09–0.30 against a dub's), and every caption on
> the very frame libass should draw it, one onset per word, none extra.
> On the two no-caption links the URL tile, rendered from the state the
> real handlers left, shows "This video has no captions", Listen to it
> greyed with "needs the AI helper", and the start and end fields behind
> "Just a part of it", as for any link. An exact cut's negative head offset
> is refused by `checkLinkClip` (`linkClip.ts`), which a verifier's
> mutation met.
>
> **Left to your ear.** In `tests/output/m0-exit/<n>-<id>/`, watch
> `clip-captions.mp4` (and `second-clip-captions.mp4` where there is one)
> with that folder's README.txt beside it, which lists the run's words; the
> mid-row run (no pause either side) has no export, so listen to
> `mid-exact-download.mp4`. On every clip: are the words you hear the
> README's, the first and last whole, and nothing of a neighbour? Times are
> in the source video; what each link adds:
>
> 1. `O35KGzkS4VA` — the run at 25:23–25:29 is cut inside speech (−8 dB on
>    both sides of its head): is its first word whole? Add another clip's
>    run (44:22–44:24) plays after it in `second-clip-captions.mp4`.
> 2. `eK71EN3P78U`, Telugu — the second run (61:09–61:19, from 6.0 s in
>    `second-clip-captions.mp4`) has voice in the 40 ms before its head
>    (−2.3 dB): does its first word lose its start? All three runs' tails
>    sit in sound (−6 to −18 dB): are the last words whole? And the
>    captions: 12 of the first run's 20 words need complex shaping — do
>    they read right?
> 3. `lqOH-zxtCDE`, Hindi, the run near 47:57 (47:58–48:03) — its last word
>    ends on the 80 ms-a-grapheme estimate, 1.4 s before the next word: is
>    it cut short? (A verifier's energy reading had voice going on about
>    260 ms past the cut.) The mid run (29:13–29:18) holds 6
>    shaping-sensitive words, but mid runs are not exported, and this
>    link's exported run has none: no export here shows a Hindi conjunct
>    or pre-base vowel sign (only `captions.int`'s made-up line does).
> 4. `3pG8Hgq3Z8M` — a clip now (Get transcript failed here before the
>    fix). Its mid run (13:41–13:46) is cut in sound at both ends (−16 to
>    −19 dB): a sliver of a neighbour?
> 5. `bvz_zK5ZxpM` (2:22–2:26) — the clean case: both cuts in quiet, the
>    tail at −51 dB.
> 6. `j4aoo1qbGoE` (4:08–4:14) — the next word starts 41 ms after the end
>    cut: none of it heard, the last word whole? Lip sync: the picture runs
>    31 ms behind the sound.
> 7. `xON4Vot8j8g` (12:24–12:28) — the README's first word is there twice:
>    is it said twice? Lip sync, 23 ms behind.
> 8. `zEqLXGE_re4` — nothing to hear. In the app, Get transcript says "This
>    video has no captions" at once, Listen to it greyed.
> 9. `F7Lg2yHtqRA` — the same.
> 10. `jze_5hvaVV8` (2:48–2:51) — a quiet source (−41 LUFS) lifted about
>     26 dB by the export's loudness step: is the background noise
>     acceptable? A verifier's Whisper heard a different first word from
>     the README's: which do you hear?
>
> **Left to you**: §16.32 (an uploader's regional track), §16.33 (where a
> cut's edges fall — waits on 2 and 3 above), §16.34 (a no-caption link's
> start and end fields), and the Indic caption font, `BETA.md` R14. And on
> the next push, Windows CI's `captions.int` line saying whether its libass
> shapes (not measurable here).
>
> **Heard 2026-10-13** — you watched the clips: they landed well. The 80 ms
> word end stays (§16.33), the fields stay where they are (§16.34), the
> regional uploader track waits (§16.32), and the Indic font goes to the
> beta list (`BETA.md` R14). Windows CI for the push was green (run
> 38357257266), which proves the `ass` filter runs on the 2018 build and
> the app's frames are the complex shaper's there; whether that libass
> shapes Hindi and Telugu is printed, not asserted, on Windows, and is read
> on the Surface. **M0's exit is met.** Next: step 1, with Step P alongside.

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

> **Built 2026-10-13** — `src/shared/reframe/shots.ts`, pure: `SCENE_DEFAULTS`,
> `SCENE_BACKEND` (`'ffmpeg-select-rgb24'`, `SubjectTrack['scene']`'s),
> `sceneFilter`, `sceneArgs`, `sceneLogReader` / `parseSceneLog`, `shotsFrom`;
> `src/main/ffmpeg/shots.ts`, `findShots` on `runFfmpeg` with `complete: true`
> and `SHOTS_GLOBALS` (`-nostdin -loglevel info`; `sceneArgs` brings
> `-hide_banner -nostats`), `outputPath: null`, progress from ffmpeg's own
> `-progress`, an AbortSignal through `killProcess`; `runFfmpeg` gains
> `onStderrLine`, fed by `lineSplitter` (`\n`, `\r\n` and a lone `\r` each end
> a line, a `\r` ending a chunk waits, `end()` at `close` hands over a last
> unterminated line), and `outputPath: string | null`. `sceneArgs` is on
> `tests/oldestFfmpeg.test.ts`'s `ANALYSIS_SHAPES`; `split` and `nullsink`
> are at `f22fcd4`. **Two corrections to the shape below, both measured
> (`EFFECTS.md` §52), and the shape now shows the built one:** with `select`
> on the output path `-progress` stopped at the last cut (4.033 s of 10 s at
> T 0.5), so the frames are `split` and the scored branch ends in
> `nullsink` — same cost, 2.86–3.03 s against 2.86–3.06 s for 60 s of 1080p
> (the builder's run: 2.81 s both); and `-t` after `-i` bounds only the
> output, which the sink branch never meets (a 3–7 s window printed a cut at
> source 8 s), so it goes before `-i`. **The fixture** has five sources and
> so **four** cuts, scored 1.000 / 1.000 / 0.400 / 0.200 on rgb24 (0.40 /
> 0.61 / 0.34 / 0.17 on the Mac's Y path), committed in
> `tests/fixtures/reframe/scene-scores.json`; its greys decode as 98 / 138 /
> 118 (the H.264 round trip), the same with `-cpuflags 0`, and |ΔA|/100 holds
> on those. **The rules `shotsFrom` settled:** a cut on frame ≤
> `skipHeadFrames` (`round(ms × fps / 1000)`) is dropped, as is one at or
> past the end; two cuts on one frame keep the higher score; a shot under
> `minShotMs` merges into its LONGER neighbour, shortest first; between
> neighbours of one length the weaker cut goes, then the earlier; a merge
> into the next shot keeps the earlier cut's ms and score. `Shot.startMs` is
> the cut frame's own `pts_time` in ms, µs-rounded — relative to the
> container's start (plus the seek) — and names the frame by `round(ms × fps
> / 1000)`: `%.6g` is exact to the frame at up to 100 fps under 10,000 s, and
> at 120 fps past 1,000 s can name its neighbour (the review). `cuts` keeps
> every pick before the head-skip and the merge; the merge drops real cuts
> that would open a shot under 500 ms, the file's first and last 500 ms
> included, so §4.10's "zero crops held across a cut" counts against `shots`,
> or counts the merged cuts on their own. **A window is not for a clip:**
> `shotsFrom` runs over it as over a file, so its head-skip and merge act at
> its edges — measured, [1867, 3867] and [1900, 3900] list the cut at 2000 ms
> in `cuts` and return one shot across it — and on an MPEG-TS copy the 3–7 s
> window found no cut at all; a clip's shots are the whole-file pass's,
> sliced (`findShots`' doc comment). `findShots` reports 0..1 of its own
> pass (§4.8's job scales it into its 0–15 %); a cancel rejects with
> `CancelledError` once ffmpeg is gone, and a signal already aborted spawns
> nothing. Tests: `tests/reframeShots.test.ts` (29: the arguments as ordered
> shapes, the parser over three committed stderr fixtures, `shotsFrom`'s
> merge, head-skip and both tie rules, the splitter at every offset and the
> unterminated last line); `tests/integration/shots.int.test.ts` (10, through
> `findShots`: exact frames at an explicit T 0.3, the default T by
> membership, red→blue at 0.5, the table within 0.01, the window, progress to
> the end of the clip and of a window, one shot, a cancel that stops ffmpeg
> — exit code not 0 — and a pre-aborted signal). Mutations killed:
> `format=rgb24` dropped; `-loglevel error`; scores paired with the next
> frame line; merge into the shorter neighbour; head-skip off; `scdet`;
> `-t` after `-i`; `select` on the output path; stderr split per chunk; no
> `end()` at `close`; a null `outputPath` unlinked; a cancel settling early,
> or not killing; an abort that does not cancel; a window's progress against
> the file; the later cut lost on a tie; the default threshold ignored.
> **Still 1a's, and CI's.** `SCENE_DEFAULTS`' T 0.3 and `minShotMs` 500 are
> placeholders until 1a's eval on your ten clips with hand-marked cuts sets
> them (§4.1, §15 row 2). The tests read `SCENE_DEFAULTS` or name their own
> values: every case passed with T at 0.45 and at 0.15 (the fix's check).
> A minShot up to 1 s, the top of 1a's grid, leaves the fixture's shots
> whole (its shortest, the window case's, are 1 s; read from the test, not
> run). **The 2018 build's scores: Windows CI run 38408749271 (2026-10-13,
> on `d8e3259`) was green**, so the table case passed there — every row
> within 0.01 — along with the split graph inside `-vf` and the cancel
> through `taskkill`; a row off the table would have failed with every off
> row named in the run's annotation. The stderr lines verbatim, the table
> beside the Y path's, the timings and the cancel are in `EFFECTS.md` §53.

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

**The shape** (as built; the planned one put `select` on the output path and
`-t` after `-i`, both measured wrong — the note above):

```
ffmpeg -nostdin -loglevel info -hide_banner -nostats [-ss S] [-t D] -i <file> -an
       -vf "scale=320:-2,format=rgb24,split[scored];[scored]select='gt(scene,T)',metadata=print,nullsink"
       -f null - -progress pipe:1 -nostats
```

Every frame goes on to the output, whose time is what `-progress` reports;
the scored branch ends in `nullsink`. `-t` before `-i` bounds what is read,
so the sink branch never sees past the window.

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
`runFfmpeg`'s own `-progress pipe:1` against the duration — the OUTPUT's
time, which is why every frame goes on to it (the `split` above); the cuts
from `parseSceneLog` over the lines. An AbortSignal cancels through
`killProcess`.

### 4.3 1c — Faces — `sidecar/forge_sidecar/capabilities/faces.py` · 2 days (2.5 if the YuNet fallback's decoder is built)

> **Built 2026-10-13** — `capabilities/faces.py` (`vision.faces`,
> `vision.facesModel`), the worker `workers/mp_faces.py` (the new
> `workers/` package, `docs/SIDECAR.md`), `sidecar/requirements-faces.txt`
> and `requirements-faces-nodeps.txt` (1c `b8a54cb`, `8052585`, `1d30f84`; the fix
> phase after review through `7cb25c4`); tests `tests/sidecar/test_faces.py`
> (39; on CI's bare 3.12 all 39 run but one, the registration check, which
> skips with "numpy is not installed") and
> `tests/integration/faces.int.test.ts` (13 in the sandbox, plus your 2).
> The detection itself cannot run in the sandbox (no Metal device); it is
> one command on your Mac, which writes what it found to
> `tests/output/faces/real/README.txt`:
> `FORGE_FACES_REAL=1 npx vitest run tests/integration/faces.int.test.ts`.
> **Run on your Mac, 2026-10-13, in the app's Terminal tab (outside the
> sandbox):** on the 4K original (3840×2160, 26.6 s, 5 fps, 640 edge,
> minScore 0.5) **101 of 133 samples hold a face**, in 37.8 s (the decode
> is the cost: 1.4× realtime for 4K HEVC, as §4.10 and `EFFECTS.md` §37
> predicted), the track 10,046 B; the worker started and imported
> mediapipe in 0.69 s there. On the phone-shaped copy (ten seconds at
> 640×360, re-encoded sideways with a `rotate=90` matrix) 26 of 50 samples
> hold a face in both copies, and the boxes agree with the plain copy's to
> within 0.031 of the frame on an edge, overlapping by at least 0.875 (IoU).
> The first bar was 0.02 on an edge, and it failed: that is the detector's
> own jitter between two lossy encodes, not geometry, so the check now holds
> the OVERLAP to at least 0.5 — a box in the coded frame of a turned clip,
> or one not turned at all, shares nothing with the plain clip's
> (`overlap()` in the test, with its reason).
> - **The model gate is a second method**, as the scaffold chose
>   (`protocol.ts` above `ModelParams`): the row is `(("vision.faces",
>   "vision.facesModel"), "faces")`. `vision.faces` never fetches, and without
>   the model answers `unavailable`, "the face finder is not downloaded yet
>   (1,083,786 bytes from storage.googleapis.com) …"; `vision.facesModel`
>   answers `{present, bytes, label, host}` and fetches only on
>   `download: true` (exactly `true`). The URL is the versioned
>   `…/blaze_face_full_range/float16/1/blaze_face_full_range.tflite`:
>   `float16/latest/` served the same bytes on 2026-10-13 (both 1,083,786 B,
>   the same md5), but `latest` can move. The sha256 pinned,
>   `3698b18f…2b181b`, is the local `.venv-faces` file's, and both URLs'.
>   One real fetch through the handler: 0.13 s, three progress messages
>   ("downloading the face finder (1 MB, first run only)"; "1.1 MB" since
>   the fix phase, as the dock writes it).
> - **`media.fetch_url` failed on this Mac as built**: the python.org 3.14
>   install has an empty `etc/openssl`, so `urlopen`'s default context
>   cannot verify storage.googleapis.com (`CERTIFICATE_VERIFY_FAILED`). The
>   fetch above worked with `SSL_CERT_FILE` set to certifi's bundle, which
>   `requirements-faces.txt` installs. **Fixed in the fix phase**:
>   `fetch_url` verifies with the platform's default context plus certifi's
>   bundle when certifi imports (added, not swapped, so a company's own root
>   in the system store still counts); re-measured, the same fetch without
>   certifi is `CERTIFICATE_VERIFY_FAILED` in 0.10 s, and with it reaches the
>   body. A body shorter than its `Content-Length` now says "cut short (N of
>   M bytes); try again" rather than "does not match its sha256" (through
>   the sandbox's proxy 9 of 10 fetches were cut short; curl got 3 of 3).
>   Hugging Face downloads are unaffected: they go through huggingface_hub's
>   own client.
> - **The install, measured on `sidecar/.venv`** (pip 26.2.1, CPython
>   3.14.6). The first file took 0.74 s and installed absl-py 2.5.0 (wheel
>   137,410 B) and sounddevice 0.5.6 (1,009,647 B universal2); flatbuffers,
>   certifi, cffi and pycparser were already there. The second, mediapipe
>   0.10.35 `--no-deps`, took 1.28 s for a 17,782,605 B wheel (win_amd64:
>   10,905,503 B), 54.5 MB on disk. In the sandbox pip needed
>   `--use-deprecated=legacy-certs` (macOS trust store unreachable, OSStatus
>   −26276), which is a sandbox matter. `import mediapipe` without the stubs:
>   `ModuleNotFoundError: No module named 'cv2'` at `drawing_utils.py:20`;
>   with them it imports 0.10.35.
> - **The worker** starts and imports mediapipe in 0.14–0.23 s wall (the
>   import 0.07–0.13 s) on this Mac. In the sandbox, with the model, it dies
>   at `create_from_options` with **−6** (`gl_context_nsgl.cc failed to
>   create pixel format`, then `graph_service.h:139] Check failed:
>   service_`), 0.3–1.3 s in. Through the helper, the answer is
>   `unavailable`, "the face detector stopped (code -6): …" with that
>   `Check failed` line, and `ping` still answers.
> - **The child-process rule, measured in the sandbox** (the 1c verifier's
>   own driver on the real helper, its process tree read through libproc
>   because `ps` is blocked there; `EFFECTS.md` §54):
>   - the real detector's abort answered −32001 in 0.598 s; the only
>     children seen were ffprobe and the worker, no ffmpeg (the abort is at
>     `create_from_options`, before the first frame); afterwards no
>     children, the helper alive, `ping` answered, the cache empty;
>   - a cancel mid-pass (the stand-in, on a 20 s clip, tree helper → worker
>     → ffmpeg): −32800 at 0.222 s, worker and ffmpeg both gone by then, the
>     `.part` removed;
>   - the helper SIGKILLed mid-pass: its ffmpeg gone in 0.090 s, the worker
>     in 0.103 s — and, before the fix phase, the `.part` left behind;
>   - an app quit mid-pass (`client.stop()`, which now cancels what is in
>     flight first): the helper exits by itself, code 0, 302 ms after the
>     stop, with no worker and an empty cache (fix phase).
>   - **The Windows code for the abort is unmeasured.** `os.abort()` there
>     is expected as 3 or `0xC0000409` (3221226505), and both tests accept
>     either on win32 (`7e95fc0`). CI cannot name it: both abort tests need
>     the helper's venv, which CI's bare 3.12 has not, so they skip there
>     (run 38453960372 on `d7244ce` was green with them skipped). The Surface
>     names it, and the comment is then corrected.
> - **What only your Mac can measure** — the command above, on your face
>   fixture (decision §16.5; nothing of it committed). It probes as coded
>   3840×2160 HEVC, 30 fps, 26.6 s, start time 0, no rotation, so its coded
>   size is its upright one. Two bars, both unmeasured on this clip (§4.1's
>   57 of 80 was `capcut-grid-template.mp4`): a face on at least half the
>   samples of the original at 5 fps and a 640 edge, and a phone-shaped
>   copy whose first boxes are the plain copy's within 0.02. The pass over
>   the original is decode-bound before any detection: the stand-in took
>   10.8–14.7 s for its 133 samples. **The detector's own RSS is not
>   recorded by that run** (it writes counts, time and the track's size),
>   so §12.1's faces number stays open until a line is added for it.
> - **What the plan left open, as built.**
>   - The spec goes in as one JSON line on the worker's stdin, which stays
>     open: its end is the cancel, and it also ends when the helper dies, so
>     no worker outlives the helper. Out come `ready` / `progress <fraction>
>     <frames>` (every 10) / `done` / `error <kind> <message>` lines.
>   - The track is streamed to a `.part` beside the cache file and renamed
>     whole. A pass that stops short removes its own `.part`: the end of
>     stdin is also how the helper's death reaches the worker, and then
>     nobody else is left to (fix phase, measured: the helper SIGKILLed
>     mid-pass, as `client.stop()` does 1.5 s after an app quit, had left
>     `<track>.<pid>-<id>.part` for good). The helper removes one left by a
>     kill or an abort of the worker.
>   - A cancel closes stdin, and the worker is killed after 3 s if it has
>     not stopped.
>   - Each detection is clamped to the analysed frame, then normalised with
>     its edges rounded to 4 dp, so `x + width` is never past 1. A sample
>     keeps at most the two largest by area (a tie goes to the higher
>     score), each scoring at least `minScore`.
>   - The analysed frame's long side is `edge`, even, and the short side
>     follows the UPRIGHT aspect, also even; a small source is scaled up.
>   - The cache name is `<key, ':' → '-'>-<sha1[:16]>.json`. The hash covers
>     the raw key, the size, the window, fps, edge, minScore, the detector
>     and the model's sha256.
>   - The cache is checked **before** the model, so a track on disk answers
>     without it.
>   - fps is clamped to 1–30, edge to 64–2048, minScore to 0–1.
>   - The model reaches MediaPipe as bytes (`model_asset_buffer`), so a
>     profile path is never read by the C++ side.
> - **Found while building**: the worker's stdin watcher must read the raw
>   descriptor. A daemon thread blocked in `sys.stdin.buffer` made the
>   interpreter's shutdown abort with −6 after a pass that had written its
>   whole track and said `done`, which is the detector's own death code.
> - **The sandbox's stand-in**: `FORGE_FACES_WORKER_FAKE=colour` swaps in a
>   detector that boxes each saturated colour. With it the pass, the track's
>   shape, the two-largest rule, source ms, the relay, the cache and the
>   cancel run without Metal; `FORGE_FACES_WORKER_ABORT=1` aborts mid-pass.
>   The result names the stand-in as its `detector`, and the stand-in is in
>   the cache's hash.
> - **The rotated case** (§4.9): the plan's `-c copy` remux puts the picture
>   on its side in the upright frame. Its geometry is checked in the sandbox
>   with the stand-in: every box is the plain clip's turned counter-clockwise
>   (np.rot90's way), within 0.0000. Your run uses a phone-shaped copy
>   instead: stored on its side and turned back by its matrix, coded
>   360×640, upright 640×360. Its boxes must equal the plain copy's within
>   0.02, because a face lying on its side tests whether BlazeFace finds
>   sideways faces, not where the boxes land.
> - **Mutations killed** (each restored byte-identical, `cmp`; "unit" is
>   test_faces.py, "int" the integration file):
>   - the stubs dropped from the worker's env (int: the import test fails on
>     `No module named 'cv2'`, the real run on "could not start"; unit);
>   - the stubs put on the helper's `sys.path`, and the worker's env written
>     into the helper's (int: the path test; unit);
>   - the worker run in-process (int: the helper dies, "The AI helper
>     stopped (signal SIGABRT)");
>   - the two-largest rule off, and sorted by score (unit; int: the stand-in
>     pass);
>   - normalised against the frame's sides swapped, a turned clip's coded
>     size (unit; int: the pass and the turned case);
>   - the progress relay dropped (unit; int: the pass and the cancel);
>   - the partial kept (unit; int: the cancel and the abort);
>   - no kill after the grace, and stdin left open on cancel (unit);
>   - no stop at all (unit and int; before a fix to `run_worker`'s
>     `finally` it hung the run instead of failing it);
>   - the cache keyed on the key alone (unit; int: the cache);
>   - the model gate dropped (unit; int: the gate test);
>   - any truthy `download` fetching (unit);
>   - the key's colon kept in the name (unit; int);
>   - the upright check skipped (unit; int);
>   - decoded at the probed coded sides (int, by the answered size). Its
>     effect on the BOXES needs the real detector, so it is your run's
>     mutation — **run on your Mac, 2026-10-13**, as the decoder not turning
>     the clip (`-noautorotate` in `media.frame_args`, restored
>     byte-identical): the phone-shaped copy then held a face on 1 sample
>     instead of 26 (a sideways face is barely detected), and the pair-count
>     bar failed before the overlap bar was reached, so the real check
>     catches an unturned decode by the count; the overlap bar is what tells
>     a box in the wrong frame from the detector's jitter;
>   - the worker's stdin watcher put back on `sys.stdin.buffer` (unit: the
>     real worker held open exits −6, `_enter_buffered_busy`, on the venv's
>     3.14 and the bare 3.12).
>
>   **Added in the fix phase**, each with its commit:
>   - the half-track kept when a pass stops short (`ad4942b`: three
>     `WorkerStopsShort` unit tests, and the int test that SIGKILLs the
>     helper on its first mid-pass progress, which found the `.part`);
>   - a window's ms made window-relative, and `media.frame_args`' `-ss`
>     dropped (`2e88dba`: the int windows 1000–3000 and 1900–2900, on the
>     ms list and on the box at 2000, 0.4984 off);
>   - `run_worker`'s loop without its cancel check (`09cd96a`: the stand-in
>     workers exit 99 after 15 s, so two Pipe tests fail by name and the
>     file runs in 30.4 s instead of hanging);
>   - `client.stop()` without its cancels (`114e63c`: `sidecar.int` and the
>     int stop test, both on `{code: null, signal: 'SIGKILL'}`);
>   - the stubs put in `sidecarEnv` or in the package's `__main__`
>     (`10e28a0`: the int probe that starts the helper as main does; the
>     earlier path test passed both);
>   - faces' registration folded into `vision.register` (`97a78f2`: the
>     unit registration check; until then a missing mediapipe took
>     `vision.measure` down with every suite green);
>   - the no-window flag dropped from the worker's spawn (`1420120`: a unit
>     spy with `media._NO_WINDOW` set as on Windows; on POSIX the flag is
>     `{}`, so nothing else could see it);
>   - the macOS abort code reported as `abs(code)` (`7e95fc0`: both abort
>     tests);
>   - a second model layout in `faces.model_path` (`ffbf181`: the unit
>     Model test, against `media.fetched_path`).

Its own module and its own `OPTIONAL` row, `(("vision.faces",), "faces")`
(as built, `(("vision.faces", "vision.facesModel"), "faces")`: the note above).
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
  `models_dir()/files/<sha256[:16]>-blaze_face_full_range.tflite`, the
  layout `fetch_url` keeps every URL download in (as built; this said
  `models_dir()/mediapipe/`, which would have been a second layout). That is
  a second host for restricted networks to allow, and the Settings line says
  so.
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

> **Built 2026-10-13** — `capabilities/salient.py` (`vision.salient`,
> `vision.salientModel`), and one function moved in `capabilities/depth.py`:
> `_matte_of(rgb, variant, context)`, the tensor path `_subject_matte` now
> calls, so salient and a bake run one matte the same way (1d `8a587e7`;
> `depth.layers` on two stills before and after: manifests, `subjectBox`,
> the plane PNGs' sha256 and every progress message byte-identical, `cmp`).
> Tests `tests/sidecar/test_salient.py` (26 on the venv; on the bare 3.12, 17
> run and 9 skip with "numpy is not installed") and
> `tests/integration/salient.int.test.ts` (9: 7 with the model, which the
> test clones from the app's store or `FORGE_TEST_MODELS`, skipping with
> that reason without it; 2 without, which need only the venv). **Its
> memory does not fit the 8 GB floor machine as built**: read the memory
> bullet before 1f calls it.
> - **The model gate is a second method**, as for faces: the row is
>   `(("vision.salient", "vision.salientModel"), "salient")`.
>   `vision.salientModel` answers `{present, bytes, label, host}` and
>   fetches only on `download: true` (exactly `true`); `vision.salient`
>   without the model answers `unavailable`, "the subject finder is not
>   downloaded yet (115 MB from huggingface.co)", before any session opens
>   (depth's `_matte_session` would download as a side effect). The file is
>   **114,538,221 B, "115 MB"**: the plan said "109 MB", du's MiB. Its bytes
>   come from `us.aws.cdn.hf.co` after a 307 from `huggingface.co` to the
>   renamed repo and a 302 (`docs/SIDECAR.md`), so a restricted network must
>   allow `*.hf.co` too. A cancel stops the fetch at the next 10 MiB chunk
>   (`media.progress_class`, since the fix phase), leaving only a lock file.
>   On the real Hub (Xet off, as the app sets it): the first progress 5.79 s
>   after the press, a cancel landing at 9 % 6.3 s in with no blob and no
>   snapshot left, and the second press fetching all 114,538,221 B in 2.4 s
>   in 12 messages, sha256 `d39b897c…`, the blob's own name.
> - **The rule is subjectBox's** (`depth.py:461-474`): the matte cut at
>   0.5; `coverage` its share; a box only when the unrounded share is within
>   1–92 %, drawn round the cut after `_clean_mask` (pieces under
>   max(64, 0.0004·w·h) px, 419 at 1024² — so **scipy** is one of the row's
>   requirements, with numpy, onnxruntime and huggingface_hub) and trimmed
>   at 1 %, normalised by the matte's sides, which are the upright frame's.
>   1f decides by `box !== null`, never from the rounded `coverage`.
> - **One session with depth**: `_matte_session`'s `matte:fp16`, built under
>   depth's lock, whichever of a parallax bake and an analysis asks first;
>   so §12.1's release of `matte:fp16` covers both. The lock covers the
>   build only, not `session.run`: a bake and an analysis at once run two
>   mattes side by side, and the memory below doubles.
> - **Cost on the Mac**: about 8–9 s of matte per item (7.9–9.3 s by the
>   builder, 8.8–8.9 s in the fix phase; fp16 on the CPU provider, 4 or 8
>   threads alike), plus 30–74 ms of decode at 640×360 and 247–550 ms on the
>   4K HEVC fixture. Ten no-face shots alone are most of §4.10's 90 s.
>   Progress is 0, then (i+1)/n, "finding the subject"; a cancel lands
>   between items, so up to ~9 s late. The session's build is 1.8–2.5 s,
>   once; the cut, clean and box 35–49 ms (284 ms the first time, the scipy
>   import). Whole calls: six items 34.2–37.3 s and two 16.1–17.2 s, each
>   with the build; `salient.int` 69–75 s.
> - **Where the boxes land** (synthetic clips made in the test): a disc of
>   radius 60 moving across 640×360 answered x 0.2197 / 0.4697 / 0.7197
>   where it was drawn at 0.21875 / 0.46875 / 0.71875, y 0.252 (0.25),
>   width 0.1865–0.1875 (0.1875), height 0.332 (0.3333), coverage 0.0492
>   against π·60² of the frame, 0.0491. A flat grey frame: coverage 0, box
>   null. The `rotate=90` remux sent as 360×640: {0.252, 0.5928, 0.333,
>   0.1875}, drawn upright at {0.25, 0.59375, 0.3333, 0.1875}, and the 1d
>   verifier's box from the decoder's own upright frame was {0.25, 0.5922,
>   0.3361, 0.1891}; sent as 640×360, that item alone answers "is 360×640
>   upright (turned 270°), but 640×360 was sent". One still through salient
>   and through `depth.layers`' `subjectBox` agree within 0.0006. On the 4K
>   face fixture the boxes sit on the person, coverage 0.17–0.58.
> - **Memory — measured, and over the floor's budget.** The helper's RSS,
>   sampled every 10–20 ms (libproc, or psutil) on the Mac (17.2 GB): a
>   matte peaks at **6.6–9.7 GB**, a session's first 7.7–8.7 GB (the 1d
>   verifier 8.6 and 9.3, 6.6–9.7 with the arena off; the helper-rules
>   verifier 8.0–8.7; the fix phase 7.7 and 8.6), and
>   with ORT's default CPU arena the helper then **holds 4.9–8.7 GB** until
>   the session goes. With the arena off it falls back to 1.1–1.4 GB after
>   each call, but the peak is the same. Dropping `matte:fp16` under the
>   lock brought it to 155–294 MB. On the 8 GB Surface, with Electron at
>   1–2 GB, a single no-face shot would page, so **§12.1's bar cannot be met
>   with salient as built**, and 1f must not call it there until one of
>   these is decided and measured (§12.1): salient only on a machine with
>   the RAM (a gate), the arena off plus a release at the job's end, a
>   worker process of its own so the memory goes back on exit, or a
>   smaller export (BiRefNet's input is fixed at 1024² in this ONNX file;
>   another size needs a re-export, unmeasured). **Decided 2026-10-13
>   (§16.35): the analysis job does not call it for the beta; no-face shots
>   centre with a note, and a small saliency model is measured later as its
>   own item (§12.1, §15 row 25).** The method stays, unused by the job.
> - **Mutations killed** (the builder's, each restored with `cmp`): a box
>   at 93 %; trim 0; the box in a turned clip's coded frame; a size mismatch
>   or a decode error failing the whole call; the session built outside
>   depth's lock; the presence check dropped (end to end, −32603 from the
>   Hub instead of −32001); no cancel between items; no cancel in the fetch;
>   any truthy `download` fetching. **Added in the fix phase**: the trim at
>   1.1 %, 0.9 % and 20 % (`test_the_trim_is_one_percent_exactly`); the box
>   drawn round the raw cut, `_clean_mask` skipped
>   (`test_speckle_is_cleaned_before_the_box_is_drawn`, a 225 px speck at
>   1024²); and salient keeping a BiRefNet session of its own (`OneSession`
>   now asks for a bake's matte afterwards: two builds). The integration
>   file's 0.05 tolerance cannot see the first two; only the unit tests do.
>   The cancel test's own eye was checked too: with an extra `ffmpeg -re`
>   started before each decode it reports "the helper's children: ffmpeg,
>   …", so its libproc listing (macOS; `/proc` and `Get-CimInstance` on the
>   others, unmeasured) does see the helper's children.

`LLM.md:162-163` and `:282-283` both say to check depth before adding
anything. BiRefNet already finds the subject of a still. **It is on disk on
the dev Mac (114,538,221 B, "115 MB"; this said 109, du's MiB), not on a user's machine**: a user who never
baked a parallax has to download it, so the first reframe that needs a
salient box shows "Find subjects without faces · gets the subject finder,
115 MB, first time" and asks, never pulling it as a side effect (§0). Without
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

> **Built 2026-10-13** — `src/shared/reframe/types.ts` as below
> (`SUBJECT_TRACK_VERSION` 1); `src/shared/reframe/path.ts`: `cropPath`,
> `PATH_RULES` as below, `FACE_SHARE` 0.2, `OPENING_MS` 1000, `HEAD_MS` 125,
> `UPPER_THIRD`, and the types `Pan`, `HalfCrop`, `ShotWhy`, `ShotCrop`,
> `CropPath`, `HalfOffsets`, `PathFollow`. **Read where the rules were
> open, and fixed after review** (each measured, each a test):
> - **The head (rule 5)** is a time, 125 ms — three frames at 24 fps, more at
>   any faster rate; a sample that close after the cut starts no trigger
>   clock. It was built as three of the track's samples, 1.5 s at 2 a
>   second, and no shot under about 2.6 s could pan.
> - **The running median** is centred, over `smoothMs` and never fewer than
>   three of the track's samples (±1.5 of its spacing). Over `smoothMs` alone
>   it held one sample at 2 a second, and a pan fired on a stray box aimed at
>   it: 216 px past the face, then a second pan back.
> - **One person** (`FACE_SHARE` is also the second-person bar: a second face
>   on under 20 % of samples is a stray). A 'face' shot follows the face
>   nearer the one last followed, from a sample that holds only one; it
>   followed `faces[0]`, and a larger passer-by on three samples pulled the
>   crop off its subject for the rest of an 8 s shot.
> - **On y**, the subject's centre goes at the upper third, then the crop
>   moves just enough to keep a subject that fits with its margin whole —
>   held and panned alike (`aim`). At the upper third alone, a 500 px
>   two-shot that passed rule 3's fit lost 48 px of its top face, and a
>   460 px face 28 px. Centred on x this changes nothing.
> - **Rule 6** is for a shot with no face at all in its opening second: the
>   ladder holds it (`why` from the ladder, and a note) and the face, once it
>   shows, earns a pan by rule 5. A face there that is not yet the subject — a
>   two-shot's second person still to come, the larger person not yet in —
>   starts the crop on the subject's median over the shot, as a two-up's half
>   does, keeping its `why`. It went to the ladder with the note "no face in
>   its first second": a two-shot opening on one face started centred with
>   neither face in the crop.
> - **A box that is not four finite numbers with a size** (NaN, JSON's null
>   for it) is a sample without that face; it made a NaN position.
> - A pan that cannot end strictly before its shot's end is not started; an
>   offset is a share of the crop's free-axis length, added after the solve
>   and re-clamped, and a pan it flattens goes; a two-up clip's height is
>   floored to a multiple of 4 (1080 stays, 1078 → 1076) so its halves are
>   exactly half; a canvas of the source's own shape gives every shot
>   'centre' at 0 with no pans and never a two-up (1f emits no follow keys
>   for it).
> - **The other open rules, as the builder read them.**
>   - The axis is y when the target's ratio is wider than the source's by
>     more than 0.001.
>   - Rule 3's fit is judged on the MEDIAN union over the two-face samples,
>     plus twice the margin. Two faces together on 20 % to under 60 % of
>     samples is a face lost (`larger`, with its note); under 20 %, the
>     second face is a stray (`face`).
>   - `larger` keeps its people by side: by x order where both show, and a
>     lone face goes to the side whose median place it is nearer. It frames
>     the side with the larger median area, a tie going left, and a sample
>     showing only the other person holds.
>   - Rule 4's held position is the median smoothed centre over the opening
>     second. The static test counts only samples that hold the subject.
>   - A rule-5 pan starts on the sample that fires it and takes
>     `max(panMs, ⌈1000 · distance / (len · maxSpeed)⌉)` ms. The next pan
>     may start no sooner than `minHoldMs` after it ENDS.
>   - A two-up half's y is held for the shot at the opening second's median
>     face.
>   - Rule 7 rounds to the nearest even and clamps to [0, ⌊room/2⌋ · 2].
>
> **What 1f gets.** Per shot one held `at` (a step on the cut's frame, §45's
> half-frame boundary) and `pans` as `{fromMs, toMs, to}` in source ms:
> absolute targets, sequential (each starts at least `minHoldMs` after the
> last ended), each ending before the shot does — in SOURCE ms, so after
> `timelineFrameAt` a pan can still be easing on the cut's frame by up to
> half a frame, which `reframeKeys` clamps or asserts. The ease is
> smoothstep, `keyframes.ts`' `eased('smooth')`, a comment contract; a
> `positionAt(path, ms)` for a clip's in-point mid-pan, the preview and the
> tests is 1f's to write beside it. The fixed axis is always 0. A two-up
> shot's `at`/`pans` mirror the top half; a single shot on a two-up clip keys
> the top half at (x, 0) and the bottom at (x, `half.height`). `offsets` are
> keyed by `shot.startMs` as 1b writes it (fractional, e.g. 2035.37), so a
> re-analysis that moves a cut by a microsecond orphans a drag: match by
> index or within a tolerance. ffmpeg puts crop's x at `lrint(x) & ~1`
> (`EFFECTS.md` §52), so the preview of an eased frame takes `Math.round(x)
> & ~1`; the 599-term flat sum of this shape matched a static crop on every
> one of 3,000 frames. Tests: `tests/reframePath.test.ts`, 41 cases over
> synthetic tracks. Mutations killed: dead zone 0; trigger ignored; the
> union unchecked; a size per shot; the two-up on a lost face; the halves by
> size, either order; no upper clamp; the speed cap; the minimum hold; the
> head as samples, and none; a pan ending on its cut; an offset as a share
> of the source; no smoothing, and `smoothMs` alone; the same-shape branch;
> a half's offset on both halves; the static rule removed, and its margin 0;
> the fit without its margin; `bothShare` 0.9, and `>` for `>=`; the largest
> face followed, and the follower seeded by size; the y clamp removed, and
> the pan target unaimed; rule 6's ladder on any absence, and on a face
> anywhere; every box usable, null let through.

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

> **Built 2026-10-13 — the render half (slice A): the keys, their
> compiler, the render, `cropAt` and the moments' pull.** The action half
> (slice B: the job, the IPC, the store, the consumers and the Director's
> hook) is the next note; its UI is §4.8's note and its harness check
> §4.9's.
>
> Commits:
> - the keys: `29e1dce`, `12c4eae`, `8e5c530`;
> - the render, `cropAt`, the pull, the floor scan and the render check:
>   `46d5ec3`, `9ca3d40`, `f49e475`, `e92d2db`, `d251755`;
> - the fix phase, after two verifiers: `0e2f087` … `90755ab`.
>
> Every number below is in `EFFECTS.md` §55, with its command.
>
> **What was built:**
>
> - **`src/shared/reframe/expression.ts`, the compiler.** A followed crop's
>   x (or y, and each two-up half's x and y) is a `FlatSum` `{base,
>   terms}`.
>   - It is written in frame order, every time to 6 dp and every pixel an
>     integer:
>     `base ± Δ*gte(t,(f−0.5)/fps) ± Δ*(P)*(P)*(3-2*(P))`, with P =
>     `min(1,max(0,(t−t0)/span))`.
>   - It is **never `keyframeExpression`**. That function's nested `if()`,
>     as the crop's x, is refused at 97 held keys and at 92 smooth ones.
>   - Frame-exact in the plan's chain to 2,998 terms.
>   - Past `FLAT_GROUP` (1,000) terms it is written in parenthesised groups.
>     ffmpeg's evaluator recurses down a flat sum, and it crashed past about
>     7,000 terms at a 1 MB stack. 9,595 grouped terms were exact there.
>   - The other exports:
>     - `flatSumAt` is the same arithmetic on the constants as written,
>       adding each group first.
>     - `exportPixel(v) = Math.round(v) & ~1` is the crop's `lrint & ~1`.
>     - `windowSum` keeps the terms that change frames [from, to).
> - **`src/shared/reframe/keys.ts`.**
>   - **`followKeys(project, clip, fps)`** is compiled, never stored. It is
>     memoised per track object on every input that changes it; removing any
>     one component fails its own test case.
>   - It runs `cropPath` and puts each cut's held key on **the export's own
>     frame for it**, `exportFrameAt`, and **not on `timelineFrameAt`**.
>     That frame is:
>     - the `fps=` slot after the seek, `floor(t·fps + ½)`;
>     - at a constant speed, the same after `setpts`' truncation;
>     - through a ramp, from the ramp's own `setpts`;
>     - computed exactly from `{pts, timeBase}` when given. Until 1b keeps
>       those, it comes from the printed ms with `TIE_SLACK`.
>   - Pans go on the same grid and end by the next cut's frame. A pan
>     already running at the in-point opens mid-pan.
>   - It returns `{crop, cropX | cropY, halves?, axis, size, half, shots,
>     notes}`.
>   - On a two-up clip all four lanes share the cut slots, and a single shot
>     keys (x, 0) and (x, `half.height`).
>   - A canvas of the source's own shape gets no keys, with the note
>     "nothing to follow". A hold gets a static crop at its frozen frame,
>     with a note. `null` when the clip has no `follow` or its track is
>     refused.
>   - **`followAt(keys, frame)`** is what the export draws on a clip frame.
>     `positionAt(path, ms)` is the path's own source clock.
>   - `KeyedProperty` gains `cropX`/`cropY` for the type only; they stay out
>     of `KEYED_PROPERTIES`. `Clip.follow` and `Project.subjects` are in
>     `timeline.ts`.
> - **`render/plan.ts`.**
>   - **`cropFilter(clip, source, follow?, fps, index)`** writes x (and y) as
>     `'max(0,min(<sum>,in_w-out_w))'` with `w`/`h` literal, so `streamSize`
>     reads the follow's size.
>   - **On a clip whose path holds a two-up** it writes
>     `split=2[r<i>a][r<i>b];[r<i>a]crop=…[r<i>t];[r<i>b]crop=…[r<i>u];[r<i>t][r<i>u]vstack,tpad=stop_mode=clone:stop=1`.
>   - **`followClock`** puts `fps=${fps}:start_time=0` right ahead of a crop
>     that moves, at every speed; at speeds other than 1 it comes after the
>     retime's own `fps=`.
>   - **`followedRetime`** writes a followed ramp's `setpts` on `T`.
>   - As rendered, at speed 1:
>     `[0:v]fps=30:start_time=0,crop=…,scale=…,crop=1080:1920,fps=30,…`.
>     At 2×: `[0:v]setpts=PTS/2,fps=30,fps=30:start_time=0,crop=…`.
> - **`render/crop.ts` `cropAt(project, clip, source, frame)`**, the one
>   reader. For a followed clip it calls `followAt` on the compiled keys at
>   the clip frame, at the export's rounding. It returns `halves` only on a
>   frame where the two halves are not one crop; otherwise it returns
>   `effectiveCrop`.
> - **`render/momentFrames.ts`, the pull.**
>   - The crop (or the stack) moves ahead of `tpad…,trim…,setpts`, right
>     after the retime and the clock: the render's own order.
>   - Its keys are the window's (`windowSum`), so its `-vf` stays under
>     2,000 characters at any length. The whole clip's keys came to 46,001
>     characters for a 20-minute clip, past Windows' 32,767.
>   - `FootageRequest` (`moment.ts`) carries `cropX`, `cropY` and `halves`;
>     `momentFramesKey` names them; `PULL_VERSION` is 6.
>   - `followedFootage(project, clip, fps)` is what slice B's
>     `momentTextures` spreads in.
>
> **The shape per rate, as measured: one shape for every rate and speed.**
>
> - **30 fps:** the clock changes nothing measurable (a static crop is
>   framemd5-identical, video and audio). It is kept so there is one shape.
> - **29.97 and VFR:** the clock is required. Without `fps=` first, pans
>   drifted 12 px (29.97) and 8 px (VFR) off the frame grid, and a VFR frame
>   stamped on a half slot took the old crop.
> - **60:** frame-exact either way on the exact slot, and 14–18 % faster
>   with the clock.
> - **`start_time=0`:** without it, `fps=` starts on slot 1 whenever the
>   first frame is half a slot or more past the seek. That happens for VFR
>   at in-point 1, 29.97 at in-points 500–1000 and from 1501, and 24 fps at
>   three in-points of five. Every reader of such a clip was then a frame off
>   the export: 26 of 150 frames, 960 px on a cut frame.
> - **Ramps:** measured from STARTT, a ramp moved every cut of a VFR clip at
>   in-point 7 (721 of 721). On `T`, 0 off.
> - **The cut's key:** the exact slot. `timelineFrameAt` was early on 15–21
>   of 44 cuts at speed 1 and on every cut at 0.5×. `Math.round(ms)` was
>   early on 15 of 45 odd 60 fps cuts.
>
> **The render check.** `tests/integration/reframe.int.test.ts`, 34 tests,
> 83 s on the Mac. The clip starts at timeline frame 15 from in-point 6.
>
> Cut frames (source frame → clip frame, at 9:16 and 1:1, then at 2×):
>
> - 30 fps: 29/61/165 → 23/55/159; at 2× 12/28/80.
> - 29.97: 30/60/165 → 24/54/159; at 2× 12/27/80.
> - 60: 61/120/331 → 25/54/160. Frames 61 and 331 are exact ties that
>   `fps=` rounds up. At 2× 12/27/80.
> - VFR: 30/62/169 → 25/56/163. Frame 30 is the half-stamped tie. At 2×
>   12/28/82.
>
> At every cut, cut − 1 shows the old shot's chroma at the old crop, and
> the cut frame shows the new shot's at the new crop:
>
> - 9:16: 176 | 1136, 1136 | 272, 848 | 656.
> - 1:1: 0 | 840, 840 | 36, 612 | 420.
>
> The rest of the readings:
>
> - **Pans:** 272 → 848, never backwards.
> - **The two-up:** at its cut the halves read (81, 162) on the left face
>   and (1232, 378) on the right; the path says (80, 162) and (1232, 378).
>   On cut − 1 they read (848, 0) and (848, 540).
> - **A single shot in a two-up clip:** 0.000 levels from the same clip with
>   no two-up.
> - **The last frame** is kept.
> - **Worst |read − model|:** 1 px on every row, 0 at 1:1.
> - **The sound:** worst second difference 0.0053, the unreframed export's
>   own; A/V start 0.00 ms.
> - **The moments:** within 1 px, at 0.38–0.63 levels.
> - **The fix phase's rows:**
>   - VFR at in-point 1, where the clock's start matters: 30/61/168 at 1×,
>     59/122/336 at 0.5×.
>   - A ramp: cuts on 31/66/215, where STARTT would give 30/65/214.
>   - 109 held keys.
>   - A grouped sum of 1,103 terms.
> - **The media's ties** are asserted from the probed pts.
> - **An independent re-read**, with a different reader, found 0 frames off
>   and every x even.
>
> **Where the render check differs from §4.9's text:**
>
> - The shot identity is in the chroma, so the luma codes survive the
>   pull's RGBA.
> - The cuts are near 1, 2 and 5.5 s, so shot 3 can hold its 948 ms pan.
> - Every frame is decoded in order rather than sampled at (f − 0.25)/fps.
> - The bar is ±2 px on the Mac and ±8 elsewhere.
>
> **Tests:**
>
> - `tests/reframeExpression.test.ts` (13).
> - `tests/reframeKeys.test.ts` (31).
> - `tests/reframeRender.test.ts` (19): the shapes as ordered anchors,
>   counted (`crop=w=` twice, `fps=30` twice).
> - `tests/oldestFfmpeg.test.ts` (50): `SHAPES` gains a followed clip and a
>   two-up clip, `ANALYSIS_SHAPES` gains both pulls, and `TOO_NEW` gains
>   `sgn` and `randomi`.
> - `tests/moment.test.ts` (35).
> - The whole suite after the fix phase: 3,379 passed.
>
> **Mutations killed** (each restored byte-identical with `cmp`, each
> anchor counted at one match first):
>
> - the key at cut − 1 (11 tests), or through `timelineFrameAt` (10);
> - §3.2's boundary reverted, the 30 fps cut on clip frame 23 showing the
>   old crop;
> - keys compiled from the clip's start;
> - the memo without each of its parts;
> - the moving axis always x;
> - the seek floored, or not subtracted;
> - `setpts` not truncated;
> - the tie slack removed, or uncapped;
> - `followAt` without `& ~1`;
> - nested output, or a loosened smoothstep, in the compiler;
> - `cropX` in `KEYED_PROPERTIES`;
> - `fps=` first removed, or `start_time` dropped, or the clock at speed 1
>   only;
> - a ramp on STARTT, in the render and in the pull;
> - the stack dropped, or its `tpad` dropped;
> - the bottom half on the top's keys;
> - `keyframeExpression` in place of the sum (the 110-key export is
>   refused);
> - no grouping, or a flat reader of a grouped sum;
> - the pull's crop after its trim, or the pull with the whole clip's keys;
> - `momentFramesKey` without the keys;
> - `sgn` for a step.
>
> "Keyed on `n`" survives, as an equivalent: behind the clock, `n/fps` is
> `t`.
>
> **Where the code differs from the text below:**
>
> - `cropX`/`cropY` are `FlatSum`s, not `Keyframe[]`.
> - `cropFilter`'s arguments are `(clip, source, follow?, fps, index)`.
> - A hold gets a static crop, not a refusal.
> - The same-shape canvas returns keys-less `FollowKeys` with a note, not
>   `null`.
>
> **Slice B's — every item built (the next note):**
>
> - The preview reads `cropAt(project, clip, src, clipFrame)` on the clip
>   frame from `exportFrameAt(clip, fps, currentTime·1000)`, never from
>   `sourceFrameFor` or `timelineFrameAt` (as built, the presented frame's
>   `mediaTime` when the element gives one). Draw `halves.top` and
>   `halves.bottom` into a `size`-shaped canvas.
> - `momentTextures` spreads `followedFootage`.
> - `shotPicture` and the strips effect take `cropAt(…).crop`, with a note on
>   a stacked frame.
> - The Inspector line reads `followKeys(…)?.shots`.
> - `setAspect` keeps `follow` and stores a copy of `followKeys(…).crop`.
> - `reframeClip` makes one `update()`, then `rebakeGenerated` (as built,
>   `rebakeFollowed`: only the moments over that file, no undo entry).
> - The migration tolerates no `subjects`.
> - A re-analysis remaps `offsets` and `halfOffsets` onto its new shots.
>   `path.ts` matches a drag's offset by the exact `startMs`.
> - Decide whether an export whose `request.canvas` overrides the project's
>   should follow. **Decided in slice B: it follows on the export's canvas**
>   (the note below).
> - The Director's `BACKDROP_KEEP` hook.
>
> **Windows CI on the push** is the first run on the 2018 build of:
>
> - the flat sum's `gte`, `min` and `max` in a crop's x;
> - `fps=…:start_time=0` and its slots on the four sources;
> - speed 2's truncating `setpts`;
> - the two-up and its `tpad` keeping the last frame;
> - the slot-1 rows and the ramp row;
> - 110 held keys and the 1,103-term grouped sum through the graph file;
> - the pulls' labelled `split`/`vstack` inside `-vf`.
>
> It does not reach sums past about 1,100 terms, the stack depth, a long
> clip's pull, smooth slow motion or 10-bit sources.
>
> **Left:**
>
> - 1b's `Shot.startPts` and `SubjectTrack.timeBase`, then `exportFrameAt`'s
>   exact path in `followKeys` (**done in slice B, `4aafdc4`**). These are
>   **required for 25 and 50 fps projects**, where the printed-ms path keys 1 cut in 6 a frame late at 2
>   in-points of 5. Until then a printed near-tie (29.97 frame 499) is keyed
>   a frame late.
> - At 0.5× the preview's picture changes a frame before the export's.
>   `sourceFrameFor` rounds n/2 half up, while the export shows floor(n/2).
>   **Playing: fixed in slice B** (the crop is read at the presented frame,
>   `playback.ts`). **Paused: still left** — the element is still seeked
>   through `sourceFrameFor` (slice B's Left).
> - Smooth slow motion's cut frames are unmeasured.
> - The 2018 exe's stack reserve has not been read.
> - A 4:4:4 source's snap is unmeasured.

> **Built 2026-10-13, fixed 2026-10-14 — slice B, the action half: the
> job, the IPC, the store, the consumers and the Director's hook.** The UI
> is §4.8's note, the harness check and §15 row 5's answer §4.9's. Not
> pushed (the user's call).
>
> Commits:
> - the scaffold, the shared contract (`shared/reframe/job.ts`, the
>   preload's four methods, the store's `reframe` slice and its action
>   signatures, the bridge's stubs, `harness/reframeStub.ts`): `bec28fa`;
> - the job (J): `4aafdc4` (exact pts), `bbcb110` (the reduction), `c44cb0b`
>   (`main/reframe/analyse.ts`, the queue, the IPC);
> - the store and its consumers (S): `3ca53f9`, `973764a`, `9b02172`,
>   `b5947ad`, `8f6fe73`;
> - the UI and the harness (U): `e94511c`, `a591c83`, `bf1c315`, `7ea36c4`,
>   `a7a9bdc`, `a5cf41f`;
> - the fix phase, after three verifiers (the job, the store, the UI):
>   `6d90e7f` … `e0472d9`, then `d8baa57` and this note.
>
> **The contract** (`src/shared/reframe/job.ts`, pure, Electron-free):
> - `REFRAME_CHANNELS`: `reframe:analyse` (`ReframeAnalyseRequest` → the
>   queued `Job`), `reframe:collect` (`{jobId}` → `ReframeCollectResult`),
>   `reframe:faceModel` (`{download?}` → `ModelStatus`), and
>   `reframe:faceModelProgress`, main → renderer while the face finder
>   downloads. `REFRAME_PRESET` `'reframe'` is the job's `presetId`.
> - The request carries, beside the plan's `{assetId, path, width, height,
>   phrase?}`, the asset's `name` (the job row's words, never a path) and
>   the `clipIds` that asked, which main keeps and echoes back, so a reload
>   mid-job still knows which clips to follow.
> - The collect answers `{kind: 'track', assetId, clipIds, track, cached}`
>   ONCE and `{kind: 'already'}` after, so a reload after the landing does
>   not follow a clip the user has since unfollowed; a failed or cancelled
>   job answers `{kind: 'failed', reason, message}` as often as asked. The
>   reason is typed — `no-helper`, `model-missing`, `phrase-needs-ground`,
>   `size-mismatch`, `cancelled`, `failed` — with its words in
>   `REFRAME_FAILURES`, because `Job.error` is prose and nothing parses
>   prose.
> - `REFRAME_STAGES` (shots 0–0.15, faces 0.15–0.85, the reduction
>   0.85–1; `stageProgress` clamps, NaN giving the stage's start), their
>   words riding in `Job.speed`; `REDUCE` (2 a second, 2 faces, picked);
>   `subjectTrackFileName`; and `reframeHelperFrom`: ready only when
>   `hello.capabilities` holds both `vision.faces` and `vision.facesModel`,
>   unknown while the helper starts, missing otherwise — the face finder
>   degraded included.
>
> **The job** (`main/reframe/analyse.ts`, Electron-free, so ipc.ts and
> `reframeJob.int` run the same handlers):
> - an `analysis` JobQueue at concurrency 1, in the same `jobs:changed`
>   list, each job `presetId: 'reframe'`, `inputName` the file's name,
>   `params: { assetId }`, the stage's words in `speed`; the payload
>   re-validated in main (`reframeRequest`: the ids exactly, an absolute
>   path, a whole size above 0, each clip once, the name less any folders, a
>   blank phrase dropped);
> - **the gate comes before any work** (a deviation from the order above):
>   a phrase fails at once with `phrase-needs-ground`; the file's key and
>   `probeWithClock`, the size held to the request's (`size-mismatch`);
>   then the helper's own `hello.capabilities` (`reframeHelperFrom`,
>   `no-helper`) and `vision.facesModel {}` (`model-missing`). A missing
>   helper or model costs no scene pass;
> - shots on the whole file (0–15 %), `vision.faces` at the upright size, 5
>   fps, the 640 edge, minScore 0.5 and the key (15–85 %; an `unavailable`
>   answer is `model-missing` only if `facesModel` now says not present),
>   the reduction (85–100 %), the track written beside itself and renamed
>   into `$userData/subjects/<key made file-safe>-v<version>.json`;
> - **the cache**: a track on disk for this key, version and size is handed
>   back (`cached: true`) only when it was cut at today's `SCENE_DEFAULTS`
>   and reduced from today's face track (`facesVersion`, below);
> - collect is pulled and hands a track back once (`already` after), the
>   entry marked only after the answer is built; an unknown or cleared job
>   is "That analysis was cleared from the list", a queued or running one
>   "That analysis has not finished";
> - `releaseSessions` is a commented no-op: there is no `system.release`
>   yet, and `vision.faces` holds no session in the helper (§12.1);
> - a cancel aborts `findShots` or the helper's request and removes
>   nothing; a quit cancels every analysis (`cancelAnalyses` from
>   `before-quit`, fix phase): a running scene pass is main's own ffmpeg;
> - the time split on the synthetic clip, the cache and both cancels are
>   `EFFECTS.md` §56.
>
> **The reduction** (`shared/reframe/reduce.ts`): a tick every 500 ms from
> 0; each keeps the sample nearest it from the tick's OWN shot, within one
> tick, the earlier on a tie, with its own ms and its own boxes — picked,
> never averaged (a box is one frame's fact; the mean of two is a box no
> frame had); a shot no tick falls in keeps the sample nearest its middle.
> `cleanFace` clamps each box into the frame at 4 dp and drops a non-finite
> or empty one; the two largest stay, largest first, a tie to the higher
> score. `checkSubjectTrack` holds the result — and the cache's read-back,
> and since the fix phase the migration — to what `path.ts` and `keys.ts`
> can walk.
>
> **Exact pts** (slice A's Left, the 1b follow-up): the scene pass's
> integer `pts:` is parsed into `SceneCut.pts` (null for NOPTS) and carried
> into `Shot.startPts` (the first shot's 0), kept only for a pass that did
> not seek; `probeWithClock` reads the stream's `time_base` into
> `SubjectTrack.timeBase` (`parseTimeBase`; `probeFile` unchanged); and
> `keys.ts` hands `{pts, timeBase}` to `exportFrameAt` whenever both are
> there (`exactOf`, guarded on a matching shot count and start), at the cut
> slots and in a hold's branch. The 25 fps case — in-point 72, source frame
> 231, pts 118272 on 1/15360 — keys its cut on slot 120, where the printed
> 7700 ms keyed it on 121.
>
> **The IPC** (`main/ipc.ts`): the queue is in `allJobs`, in the `changed`
> broadcast beside the exports' and the downloads', in `render:cancel` and
> in `jobs:clearFinished` (which drops main's kept entries too); handlers
> on the three invoke channels; `faceModel` fetches only when `download`
> is exactly `true`, one fetch at a time, relays the helper's progress on
> the fourth channel, and throws the no-helper words when the helper is not
> ready (`ModelStatus` has no such state). The preload gains
> `analyseSubjects`, `collectSubjects`, `faceModel` and
> `onFaceModelProgress`, their channels written as literals and held to
> `REFRAME_CHANNELS` by `tests/renderer/bridgeMethods.test.ts`. That test
> also loads the real preload (Electron mocked) and the harness bridge and
> requires every preload method on the bridge; its first run found
> `relinkAssets` missing, which the bridge's `as unknown as
> Window['forge']` cast had hidden from typecheck.
>
> **The store** (`renderer/src/store.ts`; the edits are pure functions in
> `shared/reframe/follow.ts`, each returning the same project when nothing
> changes):
> - `reframeClip(clipId)` and `reframeAll()` go through `startReframe`, one
>   job per FILE: a phrase is refused at once with its reason;
>   `reframe.helper === 'missing'` with "Following the subject needs the AI
>   helper"; a file already being found adds the clips to that job; a file
>   whose track the project already holds at this key (`fileKeys`, main's
>   `size:mtime`) and version lands at once, with no job; otherwise
>   `ensureFaceModel` (asks `faceModel({})` unless the last answer was
>   present, then fetches with `{download: true}`, its progress in
>   `reframe.fetching`), then `analyseSubjects`, and `pending[assetId]`.
>   Both resolve once the job is queued. `reframeAll` follows
>   `followCandidates` — the clips the canvas chip counts (below).
> - `setJobs` → `syncReframeJobs`: `pending` rebuilt from each job's
>   `params.assetId` on every broadcast (a reload still knows the busy
>   file), and every finished reframe job — done, failed or cancelled —
>   claimed synchronously, before any await, and collected once per window.
>   `already` touches nothing; `failed` is said once from its reason
>   (cancelled says nothing; `model-missing` also clears `model.present`,
>   so the dock names the fetch again); a track lands through `landTrack`.
> - `landTrack` → `followWithTrack`, in ONE `update()`, one undo:
>   `subjects[assetId]`, `follow: {version: 1}` on each asked clip, and the
>   stored crop of each followed clip of that file — a COPY of the followed
>   crop's first frame (`storedFollowCrop`, falling back to `solveCrop`);
>   clips that already followed get their drags remapped in the same
>   update. During an open gesture it waits on `afterCommit` and lands as
>   its own step (fix phase). Then `rebakeFollowed([assetId])` re-pulls only
>   the moments that read that file's footage, with no history entry (fix
>   phase). The project it was asked in is remembered by `project.id`.
> - `unfollow(clipId)` makes the crop at the playhead static (`cropAt(…)
>   .crop`: on a stacked frame the top half's position at `size`);
>   `setFollowTwoUp(clipId, on)` writes `twoUp: false`, or takes it away;
>   both then `rebakeFollowed`. `dragFollowOffset` SETS the drag's total
>   under `FollowShot.startMs` exactly as `followKeys` returns it, never
>   rounded — a share of the crop's free axis, or `{half, x, y}` of each
>   half's axes on a two-up shot (each refused on the other kind of shot) —
>   inside the overlay's begin/commit.
> - `setAspect` keeps `follow` and stores `storedFollowCrop` at the new
>   shape: 9:16 → 16:9 (the whole 1920×1080, "nothing to follow") → 1:1
>   (1080×1080) → 9:16 gives the landing crop back exactly.
> - `setKeyframe` and `setKeyframes` refuse any property outside
>   `KEYED_PROPERTIES ∪ MASK_PROPERTIES` (`storableKey`), so no action
>   stores `cropX` or `cropY`.
> - The migration (`shared/project.ts` `subjectsOf`) opens a project with
>   no `subjects`, drops a value that is not a table, and keeps only tracks
>   `checkSubjectTrack` accepts. Clear leaves `subjects` alone: it is a fact
>   about the file.
>
> **The consumers** — each reads `cropAt` or `followKeys`; none re-derives:
> - the preview's Output and its Source outline (`Preview.tsx`), on the
>   frame `previewClipFrame` gives (below); a stacked frame through
>   `renderer/stackedCrop.ts`, and a grade mask's plain picture stacked the
>   same way; the Source outline draws both rectangles, dimming outside the
>   top and filling outside the bottom so their overlap is not dimmed twice;
> - `CropOverlay.tsx`: `FollowedCrop` on the Source outline — one
>   rectangle, or two, `data-forge-follow` `one` / `top` / `bottom`, no
>   corner handles; on a two-up frame the half under the pointer, the nearer
>   centre where they overlap (`halfUnderPointer`) — and
>   `FollowedOutputDrag` (`output`) on the Output side of the split;
> - the dock's Reframe field (`Inspector.tsx`, `followSummary`): "Follows
>   the subject · 3 shots · 1 stacked" in place of a rectangle;
> - `momentTextures` spreads `followedFootage` (its `Pick` gains
>   `subjects`), and `moments:frames` passes `cropX`, `cropY` and `halves`
>   through; `shotPicture` gets footage already pulled (a note in
>   `moment.ts`); the strips cut each flash from `cropAt(…).crop` on ITS OWN
>   frame (the store's `buildStrips`; a note on a stacked frame in
>   `strips.ts`);
> - the render compiles `followKeys` against `followCanvas(project,
>   canvas)` and `exportBake` pulls the export's moments at the same shape
>   (the decision below);
> - the Director (`apply2.ts`): a video slot that needs a crop and whose
>   file's track `followKeys` reads gets `follow` and a copy of the followed
>   crop and no `BACKDROP_KEEP` copy (a photo keeps its rule); a J-cut that
>   moves the in-point stores the followed crop of its moved first frame
>   (pinned in the fix phase); no track, or a track of another size, keeps
>   the blurred copy.
>
> **Measured and decided in the fix phase:**
> - **Each face sample is the frame on screen at its ms.** The helper's
>   `fps=5` rounded to nearest and showed the frame 66.7 ms past each label
>   (frames 2, 8, 14 … of a 30 fps clip); `fps=5:round=up` shows 0, 6, 12 …
>   (`EFFECTS.md` §54). The helper's face track is **version 2**, and main's
>   subject track records it (`facesVersion`), so a track reduced from
>   version 1 is analysed again rather than handed back from userData.
> - **The scene pass's pts count from the file's first timestamp**, not the
>   container's zero: ffmpeg subtracts `start_time` (an MPEG-TS copy starting
>   at 1.4 s prints its 2 s cut as `pts:180000`; `EFFECTS.md` §55). Nothing
>   downstream subtracts it again.
> - **An export whose `request.canvas` is not the project's follows on the
>   EXPORT's canvas** (`render/plan.ts` `followCanvas`), and its moments are
>   pulled at that shape too (`exportBake.ts`). Measured: a 16:9 edit
>   exported at 9:16 cut `crop=1920x1080` ("nothing to follow") and then
>   letterboxed; it now cuts the 9:16 keys, the text the 9:16 project's chain
>   has. Tests: `tests/reframeConsumers.test.ts` ("an export whose canvas is
>   not the project's", and the moment pulled at the export's shape).
> - **The preview's frame for a followed crop** (`shared/reframe/playback.ts`):
>   paused, the playhead's own clip frame (`clipFrameAtPlayhead`); playing,
>   the export's frame for the media time the element presents
>   (`requestVideoFrameCallback`'s `mediaTime`, else `currentTime`, through
>   `exportFrameAt`) — never `sourceFrameFor`, whose half-up rounding at
>   0.5× drew the new shot a frame early. A stacked frame is drawn by
>   `renderer/stackedCrop.ts`: `halves.top` over `halves.bottom` into a
>   crop-sized canvas, then the single-crop path.
> - **A re-analysis moves the drags onto the new shots** by the nearest start
>   within `REMAP_TOLERANCE_MS` (`minShotMs / 2` = 250 ms), else the same
>   index, else dropped with a note (`follow.ts`).
> - **`followCandidates`** — what Reframe to 9:16 follows and its chip counts:
>   unfollowed clips of a landscape VIDEO file, on a video lane, that are
>   not a backdrop (`BACKDROP_RULE`) or a strip flash (`STRIP_RULE`).
> - **One undo step for a reframe edit, kept.** A track that lands during a
>   drag waits for its commit and is its own step; Follow, Unfollow and Stack
>   two people re-pull only the moments over that file's clips
>   (`rebakeFollowed`), with no history entry of their own — `rebakeGenerated`
>   had added one per text, title and moment clip. The project an analysis was
>   asked in is remembered by its id, so a save mid-job lands the track.
> - **The Output view's drag moves the picture with the pointer** (the crop
>   against it, `playback.ts` `outputDragScale`); on the Source outline the
>   rectangle — the crop — follows the pointer. **Both drags live in the
>   Reframe tool, which opens the split** (Toolbox `startCrop`): the Output
>   drag mounts only beside a Source viewport, as the static crop's rectangle
>   does; choosing Output mid-reframe takes it away until the source is back.
> - The UI's decisions (the 57rem breakpoint, the Follow: field's words,
>   where "needs the AI helper" shows) are in §4.8's note.
>
> **Where it differs from the text below:**
> - the gate (the helper, then the face finder) runs before the shots, not
>   after them, so a missing helper or model costs no scene pass;
> - `reframe:collect` answers a `ReframeCollectResult`, not a bare
>   `SubjectTrack`; the request carries `name` and `clipIds`; a fourth
>   channel carries the face finder's download;
> - `size-mismatch` is decided by main's own probe against the request
>   (the helper refuses a wrong size too, but only in prose);
> - a track on disk is handed back only at today's `SCENE_DEFAULTS` and
>   face-track version, so 1a's re-tune runs every file again;
> - `rebakeFollowed`, not `rebakeGenerated`, after a landing, Unfollow and
>   Stack two people;
> - the preview reads the presented frame's `mediaTime`
>   (`requestVideoFrameCallback`), with `currentTime` only as the fallback;
> - no `vision.salient` and no `vision.ground` (§16.35; 1g unbuilt), and
>   neither has a slice of the bar.
>
> **Tests** (run to a file at `d8baa57` on 2026-10-14: the seventeen files
> here and in §4.8's note, `shots.int` among them, 246 passed;
> `reframeJob.int` 13 passed and its gated real run skipped):
> - the job: `tests/reframeReduce.test.ts` (10), `tests/reframeShots.test.ts`
>   (33, the pts cases among them), `tests/reframeKeys.test.ts` (33, the
>   25 fps exact case and the hold's), `tests/integration/shots.int.test.ts`
>   (12: the whole file's pts against ffprobe's `best_effort_timestamp`, the
>   MPEG-TS copy), `tests/integration/reframeJob.int.test.ts` (14: six that
>   need no venv and so run in CI — the re-validation, the phrase,
>   size-mismatch, a file gone, no-helper from a missing interpreter and
>   from a bare one, collect's errors; three on a stand-in helper client and
>   the real shot finder — the methods asked, only `vision.facesModel` and
>   `vision.faces`, the cache's conditions, the mid-shots cancel; four on the
>   real helper with its stand-in detector — the pass, from disk,
>   model-missing, the mid-faces cancel; and your gated run), and
>   `tests/sidecar/test_media.py` (round=up, on CI's 2018 build);
> - the contract: `tests/reframeContract.test.ts` (12: the file name on its
>   basename, the stages, the reasons, `reframeHelperFrom`, the job row's
>   words, the quit's wiring) and `tests/renderer/bridgeMethods.test.ts` (7);
> - the store and consumers: `tests/renderer/reframeStore.test.ts` (28,
>   through the real actions with the harness bridge as `window.forge`),
>   `tests/reframePlayback.test.ts` (11), `tests/reframeConsumers.test.ts`
>   (5), `tests/directorReframe.test.ts` (6), `tests/crop.test.ts` (22, its
>   source check re-anchored on `cropAt`) and `tests/scrub.test.ts` (8);
> - the UI's and the harness's: §4.8's and §4.9's notes;
> - the whole suite after the fix phase: 3,513 passed and 57 skipped in 266
>   files (189 s), typecheck green on both configs before every commit.
>
> **Mutations killed** (every anchor counted at one match first, every file
> restored byte-identical and checked with `cmp` or `filecmp`):
> - the scaffold's nine: `relinkAssets`, or `analyseSubjects`, gone from the
>   bridge; the collect channel misspelt; `faceModel`'s default `{}`
>   dropped; the file name keeping the key's colon; the helper ready on
>   `vision.faces` alone; the stub's third shot at 0.45/0.55 (no two-up);
>   the stages unclamped; the stub collecting twice;
> - the job's nineteen: the exact pass-through dropped (the 25 fps cut on
>   121); the pts not carried into the next shot on a merge; the pts read
>   from the `pts_time` column; a window's pts kept, or the whole file's
>   dropped; averaging; the smallest faces kept; each tick's sample from the
>   next tick; the tick's shot ignored (tick 1500 took the next shot's
>   1560); a window from 500 ms instead of the whole file (the track check
>   refuses shots that do not tile it); the colon kept; collect-once
>   dropped; main's model gate skipped (a scene pass ran before
>   model-missing); faces' progress unscaled (the bar read 1 while finding
>   faces); the time base not written; the helper check skipped; the size
>   check dropped; the faces request without its abort signal (the cancel
>   took 3.97 s); the phrase refusal dropped;
> - the store's and consumers' nineteen: the three facts in two updates;
>   the stored crop the memo's own object — which **survived** at first:
>   `vi.resetModules` gives the store its own copy of `keys.ts`, and its own
>   memo, so the test's identity check compared two memos; it is now asked
>   of the store's own module, and three tests kill it; the Director storing
>   the memo's object; the drag keyed by `Math.round(startMs)`; the remap by
>   equality only, or without its index fallback; the preview's frame
>   through `sourceFrameFor` (the 0.5× case); the Director taking the
>   backdrop with a track; `setAspect` dropping `follow`; `cropX` keys
>   stored; the Output view back on the stored crop; the render, or the
>   export's moments, on the project's canvas; `momentTextures` back on the
>   stored crop; every strip cut at the first frame's crop; the migration
>   keeping any `subjects`; no collect claim; `pending` not rebuilt; a
>   half's drag written to both halves;
> - the verifiers', re-run in isolated copies of the tree: the gate
>   removed; collect without `already`; averaging; the two largest kept
>   smallest first; a tie to the later sample; `exactOf` reading the shot
>   before's pts; collect on done only; `previewClipFrame` ignoring
>   `mediaTime`. **Seven survived**, each pinned by the fix phase: the
>   signal dropped from `findShots` (the job read cancelled 3,086 ms after
>   the press); the exact pts dropped in the hold's branch; the cache's
>   scene condition made `true`; the rebake after a landing removed; the
>   Director's J-cut refresh removed; and two of the UI's (§4.8's note);
> - the fix phase's: `round=up` dropped (`test_media.py`, the floor scan and
>   `reframeJob.int`'s pass all fail);
>   the cache without `facesVersion`; the worker's version left at 1;
>   `-copyts` in `sceneArgs` (the pts become 306000 …); the seven survivors
>   above; the quit's call removed, or its assignment in `registerIpc`; the
>   project's path put back (a save mid-job never lands), or the comparison
>   dropped (another project's clip follows); the landing's deferral
>   removed, or `commit`'s early return put back; the moments' repoint
>   through `update()` (two entries), or every moment rebaked; Unfollow or
>   Stack two people without the rebake; the migration's old shape check;
>   the stub's ids by length; and the UI's (§4.8's, §4.9's notes).
>
> **Left:**
> - **Paused at 0.5×, one frame per cut shows the new shot through the old
>   crop.** The crop is the export's (clip frame 57, the frame before the
>   cut on 58, takes the old shot's x 176), but the element is still seeked
>   through `sourceFrameFor`, which rounds 57/2 up to source 29, the new
>   shot's first. `reframePlayback` pins both halves of that. The same is
>   possible paused at speed 1 on 29.97 or VFR sources, where the browser's
>   seek and `fps=`'s slot can disagree: unmeasured. The cure is the seek
>   (floor-mapped as the export does) or the paused crop read from the
>   presented frame. Playing is right (§4.9's note).
> - The real detector's run and its time, on your clips: §4.10.
> - `releaseSessions` is a no-op until the job opens a session (§12.1).
> - `setAspect` still repoints every drawn kind with an undo entry each (it
>   redraws them all; older than this slice, and `rebakeFollowed` is not
>   used there).
> - Ingest's download still remembers its project by path (store.ts, the
>   same pattern the reframe had).
> - The dock's Reframe field still says "Follows the subject · N shots" on
>   a canvas of the file's own shape, where nothing is keyed (the panel's
>   note says "nothing to follow").
> - A Director main shot whose file gains a track later keeps its old
>   backdrop clip under it: harmless, redundant.
> - Windows CI on the push is the first run of `reframeJob.int`'s no-venv
>   suite on the 2018 build — its clip is libx264 yuv444p `-qp 0` through
>   `overlay=…:format=yuv444`, never encoded there; if that fails, the
>   whole file fails, refusals included — and of `test_media.py`'s
>   round=up.

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
  Unmeasured in the harness until §4.9's check runs. **Measured since
  (§4.9's note, §15 row 5): it holds the cut.**
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
//   NOT for the beta, decided 2026-10-13 (§16.35, §4.4's note): the job never calls vision.salient, on any machine, and has no RAM gate — a no-face shot centres with a note
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

> **Built 2026-10-13, fixed 2026-10-14** — U: `e94511c`, `a591c83`,
> `bf1c315`, `7ea36c4`, `a7a9bdc`, `a5cf41f`; the fix phase `7ba9aa0`,
> `a442c63`, `c8ac180`, `2c5951c`. Every control in its home, and the map
> has each (`WHERE-THINGS-ARE.md`: the dock, EXPORT, the canvas bar;
> `WINDOW.md` §3.15, §3.17, §3.18):
>
> - **The canvas bar** (`CanvasBar.tsx`). `reframeOffer(project)`
>   (`shared/edit/reframeOffer.ts`) is a portrait canvas (height over width:
>   1:1 is not) and a count of `followCandidates` — the very clips
>   `reframeAll` follows, so the chip never offers a press that does
>   nothing: on the timeline, of a landscape VIDEO by its upright size, on a
>   video lane, not following, and not a Director backdrop or a strip flash.
>   Its chip reads "Landscape video on a 9:16 canvas" with **Reframe to
>   9:16** ("Landscape video on a portrait canvas" with **Reframe to fit** on
>   a portrait size the bar has no button for), and the press is
>   `reframeAll()`, never `setAspect`. **The precedence lives in the bar**:
>   `orientationMismatch` is asked only when the offer is null, so the photo
>   rule is untouched and `tests/orientation.test.ts` still pins it (its
>   words-go anchor now reads the bar's `chip`, the offer or the mismatch).
>   Greyed "needs the AI helper" without one and "the AI helper is
>   starting" while it starts; disabled while every file it would follow is
>   already being analysed. The shapes' tooltip gains "Followed clips keep
>   following their subject." The shape words give way below **57rem**,
>   not 48rem: measured in the harness, the offer is 312 px, 415 px with
>   "needs the AI helper", and at 48rem its words were cut to 125 of 178 px
>   (the cost: the photo chip's shape words also go below 912 px, not 768).
> - **The Trimmer dock** (`tools/ReframePanel.tsx`, mounted in
>   `Inspector.tsx` under Steady, for a video clip only). **Follow the
>   subject** reads "Follow the subject · gets the face finder, 1.1 MB,
>   first time" while `faceModel({})` — asked once the helper is up, and
>   never a download — says it is not on disk; the press is `reframeClip`,
>   which fetches it and then analyses, the button reading "Getting the face
>   finder… N%", then "Finding the subject… N%". Greyed with "needs the AI
>   helper" (or "the AI helper is starting"), and that line shows **only
>   with the Follow button** (fix phase): a followed clip keeps following
>   without the helper, and beside Unfollow it read as if the follow had
>   broken. On a followed clip: "3 shots · 1 stacked", **Unfollow**,
>   **Stack two people** (pressed by default) and `followKeys`' notes ("shot
>   3: two people too far apart, stacked"; "the clip already has the
>   canvas's shape: nothing to follow"). A clip whose `follow` has lost its
>   file's track says "No subject track for this file" and shows Follow and
>   Unfollow both. Last, **Follow:** with its field ("a face"), greyed, and
>   its reason in the job's own words, "following something named is not
>   built yet" (fix phase: it was "needs the subject model, step 1g", a
>   step number and the name of the salient model §16.35 dropped).
> - **The job row** (`ExportStrip.tsx` `jobName`, `reframeJobLabel`):
>   "Finding the subject · <name>" in EXPORT's list and in its header's
>   running bar ("Running: Finding the subject · clip 1.webm — 0%"), its
>   stage (finding the shots, finding faces, keeping the track) where an
>   export has its speed, its X while it runs **and while it waits** (the
>   queue holds one), no Show in folder, and never the header's Done button
>   (`exportHeadline` reads renders only). The queue drops a progress report
>   within 150 ms of the last, so a short file can skip "keeping the track".
> - **The census.** Fourteen rows in `tests/fixtures/ui-census.json` (827
>   in all): in the canvas bar "Landscape video on a 9:16 canvas", "Reframe
>   to 9:16", "needs the AI helper" and the shapes' tooltip (count 3); in the
>   dock "Follow the subject", "gets the face finder", "Follow:", the "a
>   face" placeholder, "following something named is not built yet", "needs
>   the AI helper", "Unfollow", "Stack two people" and "two people too far
>   apart, stacked"; in EXPORT "Finding the subject". Each is counted on
>   screen by one of four recipes in `harness/census.ts`: `reframe-offer`
>   (the bridge's 640×360 video on a 9:16 timeline with three landscape
>   photos, so the offer must outrank the photo chip; the helper ready, the
>   face finder not on disk), `reframe-no-helper`, `reframe-followed` (the
>   stub's track in `project.subjects`) and `reframe-running`. No row for
>   "Get the subject model" or "Find subjects without faces" (§16.35;
>   `censusHomes.test.ts` pins their absence). `fresh()` now empties the
>   jobs list per scenario: run after the reframe check on one page, the
>   stub's finished analyses left "Clear", "Exports" and "Finding the
>   subject" absent. **`__forgeCensus()` at `d8baa57`, a fresh page: missing
>   [], 819 checked, 8 skipped, 48.0 s** (41.8–48 s across the slice's runs).
> - **Tests:** `tests/reframeOffer.test.ts` (7, the pure rule, and that both
>   rules would speak on the photo-and-talk project),
>   `tests/renderer/reframePanel.test.tsx` (24: the bar, the dock and the
>   job row rendered and pressed; here because the node tsconfig cannot
>   render TSX), `tests/renderer/censusHomes.test.ts` (5, two new: each
>   label in its home, no salient row), `tests/orientation.test.ts` (14)
>   and `tests/uiCensus.test.ts` (9).
> - **Mutations killed:** the video rule folded into `orientationMismatch`
>   (§4.8's own: the photo-and-talk render read "Most photos are landscape
>   Switch to 16:9", and 13 tests failed across three files); Reframe to
>   9:16 on `setAspect(aspect)`; the precedence inverted (the photo chip up
>   with video present); Stack two people doing nothing; the size shown once
>   the face finder is on disk; the row named by its file only; the offer on
>   any canvas; the shape words giving way for the photo chip only (the
>   relaxed `orientation.test.ts` anchor still catches it); Stack two people
>   hidden (the census names it absent); the census without its jobs reset;
>   a "Get the subject model" row added (`censusHomes`, `uiCensus`). Two of
>   the UI verifier's mutations **survived** — the offer's busy check
>   dropped, and "the AI helper is starting" said as "needs" — and are
>   killed since `c8ac180`, in the dock and the bar each. The fix phase's
>   own two are killed as well: the old phrase reason put back (the panel
>   test and `uiCensus`), and the helper's reason shown beside Unfollow.

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
  **As built (slice B, §16.35): the last two are NOT rows** — the analysis
  never calls the salient finder, so neither control exists, and
  `tests/renderer/censusHomes.test.ts` pins their absence. The Follow:
  field's reason row reads "following something named is not built yet".
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
  `-loglevel error`** (the clip's four cuts all go: zero found); scores parsed
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
  - Cancellation mid-pass leaves no ffmpeg child. As built (fix phase),
    so do a helper SIGKILLed mid-pass and a `client.stop()` mid-pass (the
    stop now cancels what is in flight, and the helper exits by itself);
    neither leaves a worker or a half-track. A windowed pass is checked for
    SOURCE ms and the scene at each sample's time.
  - **MediaPipe (§16.1):** the worker imports on the venv with the
    stubs first on its `PYTHONPATH` (mutation: the stubs dropped from the
    worker's env, and the test fails on `No module named 'cv2'`); the
    helper's own `sys.path` holds no stub directory (mutation: the stubs
    added to the helper's env, caught by asserting a real `cv2.__file__` is
    not under `stubs/` when one is installed); a worker that calls
    `os.abort()` leaves the helper answering and `faces.py` returning
    `Unavailable` (mutation: the worker run in-process, and the helper dies).
    As built, the path check also starts the helper exactly as main does
    (`sidecarEnv`, its cwd, the package's `__main__`), which caught stubs
    added in either place where nothing else did.
  - **Salient** shares depth's `matte:fp16` session, held by
    `test_salient.OneSession` (a bake's matte asked for after two salient
    calls is the same one session), so §12.1's release covers both.
- `tests/integration/sidecar.int.test.ts`: on CI's bare 3.12, each of
  `vision.faces`, `vision.salient` and `vision.ground` appears in
  `capabilities` or `degraded`. Membership, not the list. And (fix phase)
  `client.stop()` with a request in flight ends in the helper's own exit,
  not the SIGKILL 1.5 s later.
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

  > **Built 2026-10-13, run again 2026-10-14 at `d8baa57`** —
  > `src/renderer/src/harness/reframeCheck.ts` (`window.__forgeReframeCheck`,
  > registered in `harness/main.tsx`; `7ea36c4`, then the fix phase's
  > `4cb105f`, `2c5951c` and `e0472d9`), against the bridge's stub
  > (`harness/reframeStub.ts`: shots at 0 / 2000 / 4000 ms, 0.1 × 0.1778
  > faces at y 0.25 centred on 0.25, 0.75, then 0.35 and 0.65, score 0.95, 2
  > a second, detector `harness/stub`; the stub's job paced by
  > `window.forgeReframe.stageMs`, its face finder by `.modelPresent`). The
  > check records its own video, `recordColumnsVideo`: 640×360 in 16 px
  > columns 9° of hue apart, because over the bridge's flat colour a crop
  > that moved sideways looks like one that did not (a first 37° step
  > repeated every ten columns, and shot 1 against shot 2 measured only
  > 18.8). Fronted tab, a fresh page, 1510×1017 at dpr 1: **failures [],
  > 21.1 s** (21.2 s in the earlier runs; twice on one page since the stub's
  > job ids stopped repeating after Clear). Mean |Output − expected| over
  > RGB, 0..255; in brackets the same against the picture that would be
  > wrong there:
  > - **the press**: "Follow the subject · gets the face finder, 1.1 MB, first
  >   time"; the face finder fetched (`modelPresent` false → true), one job,
  >   the track in ONE undo step, 633 ms after the press;
  > - **the crops**: shot 1 x 60 (centre 161, face 160), shot 2 x 380
  >   (481/480), shot 3 a two-up, top (124, 50) and bottom (316, 50), both
  >   202×180, centres 225 and 417 on faces 224 and 416 — the left face on
  >   top;
  > - **paused**: frame 30 0.55 (106.9), 90 0.54 (74.4), 149 stacked 0.76
  >   (55.0); cut 60, frames 59 and 60: 0.55 and 0.54 (106.7, 107.0); cut 120,
  >   frame 119 0.57 and frame 120 stacked 0.73 (74.4, 74.2). The earlier
  >   runs read 0.83–0.98;
  > - **the Source outline in shot 3**, the preview's brightness over the
  >   bare picture's: lit 1.03 in the top half, 1.04 in the bottom, 1.08 in
  >   the bottom half outside the one crop; dimmed 0.39 inside the one crop
  >   and outside both halves, 0.46 outside everything. Two rectangles;
  > - **9:16 → 16:9 → 9:16** on the bar's own buttons: at 16:9 the clip still
  >   follows, its note "the clip already has the canvas's shape: nothing to
  >   follow"; back at 9:16 the three crops and the stored crop are exactly
  >   as before;
  > - **a −60 px drag on shot 2's rectangle** (Reframe on, the split open):
  >   share −0.2970 under 2000, the crop moved −60, the other shots not, one
  >   undo step;
  > - **+40 px in the two-up's lower half on the Output side**:
  >   `halfOffsets[4000].bottom.x` −0.1979, the bottom crop −40 (the picture
  >   follows the pointer, so the crop moves against it: `2c5951c`), the top
  >   0, one undo step; the dragged two-up on the Output 0.78 (24.6 against
  >   the stack before the drag);
  > - **Stack two people off**: `twoUp: false`, one crop centred 225 on the
  >   left face (the faces are equal; the larger, else the left), 0.54 (53.5
  >   against the stack it replaced);
  > - **six undos**, each restoring its step: Stack two people on, the bottom
  >   half where it was, the second shot where it was, 16:9, 9:16 following,
  >   the clip before the follow.
  >
  > **Playing — §15 row 5, answered: the cut lands on the element's frame.**
  > Every frame the element presents (`requestVideoFrameCallback`) is read
  > once the preview has painted: its `mediaTime` through `exportFrameAt` (the
  > element's clip frame) against the store's playhead, and near each cut the
  > Output against both frames' crops. Two passes:
  > - **as it plays**: 177 frames, drift (playhead − element) 0 on every one;
  >   −1..+1 across the slice's runs (0..+1, −1..0, 0..0). With so little
  >   drift the two rules rarely disagree — one frame in one run (element
  >   119, playhead 120: the element's crop, 0.81 against 74.7) — so this
  >   pass alone cannot say which the preview follows;
  > - **nudged**, the element set 3 frames ahead through the first cut and 3
  >   behind through the second, inside the 0.18 s the preview tolerates:
  >   177 frames, drift −3..+5 (−3..+6 across runs). On the 4 near-cut frames
  >   where the element's frame and the playhead's give different crops (4
  >   to 8 a run), the preview drew the ELEMENT's every time: 0.65–0.68
  >   against 74.4–107.0 (0.34–1.01 against 73.8–107.0 across runs; the
  >   critic's run at `f73416e`, 1482×870, failures [], 21.1 s: 8 such
  >   frames, 0.34–0.40 against 74.0–106.9). A fixed
  >   +0.1 s nudge was lost (a play can start with the element already 4
  >   frames ahead), so the nudge sets a target drift.
  >
  > So `exportFrameAt` on the presented `mediaTime` holds the cut on the
  > frame the element shows. Paused at 0.5× is another matter (§4.7's slice
  > B Left).
  >
  > **Found by the check, fixed:** with Scrub on, stopping playback left a
  > video with no sound playing on to the end of its file behind the stopped
  > playhead — only a sounding element got the scrub burst that pauses it
  > (`Preview.tsx` `syncMedia`'s `!scrubbing` guard). `scrub.ts`
  > `leftToScrubBurst(scrubbing, hasAudio)` leaves only a sounding element
  > to the burst (`e0472d9`); `stillPlaying` is false on both passes (true
  > before, and one compare failed by 3.4/255 until the check paused the
  > element itself). And a synthetic pointer is not an active pointer, so
  > `setPointerCapture` threw in the overlay's pointerdown and nothing moved:
  > the check makes it a no-op during its own drags.
  >
  > **Mutations** (in the browser on blob copies of the check's module, so
  > no file changed, or in `Preview.tsx`, restored with `cmp`): the preview
  > drawing the two-up as one crop (`twoUp = undefined`) — shot 3's frame 149
  > off by 54.96/255, cut 120 by 55.49, near-cut playing frames over 4/255
  > in both passes, the dragged two-up by 61.19; the check's own compare
  > without halves — then only its wrong-picture guard catches a one-crop
  > preview ("only 0.86/255 away"), so the stacked compare is what catches
  > it, and the guard a second line (the UI verifier's H1: 6 failures); the
  > nudge removed — "the element's and the playhead's crops disagreed on
  > only 1 near-cut frames", so the check will not claim the rule without a
  > real disagreement (H2); the Scrub guard put back — the check fails on
  > both passes.

### 4.10 Exit

> **Where the exit stands, 2026-10-14, after slice B.** Met here, in the
> sandbox: the action end to end — the press, the job on the real shot
> finder and the real helper with its stand-in detector, the landing, the
> preview, the drags, the round trip, undo (§4.7's slice B note, §4.9's
> harness note); the render check frame-exact on the Mac on all four
> sources with the two-up rows (§4.7's slice A note). Nothing here could
> run the face finder itself (no Metal, `EFFECTS.md` §54), so the rest is
> yours, outside the sandbox — in the app's Terminal tab, as your
> `FORGE_FACES_REAL` run was:
>
> 1. **The analysis time.** A 10-minute 1080p clip on the Mac, then a 4K
>    HEVC phone clip on its own budget:
>
>        FORGE_REFRAME_REAL=/path/to/clip.mp4 npx vitest run tests/integration/reframeJob.int.test.ts
>
>    It runs the app's own job (`createReframeJobs`, the code ipc.ts
>    registers) on that file with the real detector, through
>    `sidecar/.venv` with `requirements-faces*.txt` installed (as now); the
>    face finder is copied from `sidecar/.venv-faces/models/` when it is
>    there, otherwise fetched by the product's own `faceModel({download:
>    true})`. It writes the probe, gate, shots, faces and reduce-and-write
>    times, the shot count, the samples kept and how many hold one face and
>    two, and the track's bytes into `tests/output/reframe-job/README.txt`.
>    The bar: ≤ 90 s for the 10-minute clip. The Surface's ≤ 3 min is the
>    same command there, with `FORGE_PYTHON` set (`CLAUDE.md`'s
>    fresh-checkout table) and the helper's venv built on it. It does not
>    record the helper's peak RSS yet. **Run on your Mac, 2026-10-14, from
>    the app's Terminal tab (outside the sandbox):** the ten-link set's
>    `j4aoo1qbGoE` downloaded whole (1920×1080 H.264, 23.98 fps, 613.8 s)
>    analysed in **43.7 s** — probe 0.02, shots 23.19, faces 20.48, reduce
>    0.01 — 162 shots, 1,228 samples, 893 with a face, 153 with two, the
>    track 114,160 B: **the Mac bar is met** with half the budget to spare.
>    The 4K budget, on the face fixture (3840×2160 HEVC, 30 fps, 26.6 s):
>    **18.2 s** — shots 8.86, faces 9.29 — 1 shot, 54 samples, 40 with a
>    face, so about 0.7× realtime, or roughly 7 minutes for ten minutes of
>    4K phone footage, split evenly between the scene pass's decode and the
>    face pass's (`EFFECTS.md` §56). The Surface is still open.
> 2. **Your ten clips through the action**, in the app (`npm run dev`):
>    each landscape talk on a 9:16 timeline, **Reframe to 9:16** in the
>    canvas bar (or **Follow the subject** in the dock), a play through, a
>    nudge in the Reframe tool where a shot needs one, and an export. Then
>    a session reads face-inside-crop and crops held across a cut from the
>    project's tracks (its copies of `userData/subjects/`) and the keys the
>    export cuts with, each cut judged against the picture the export shows
>    there, into `tests/output/reframe-real/` — the reader is
>    built, its command under the first bullet below — and you rate each
>    export 1–5: ≥ 4 on ≥ 8 of 10.
> 3. **pyautoflip** on the same ten (§15 row 21: a scratch venv, Python 3.13
>    or older), rated by you beside ours.
> 4. **Windows CI** once you allow a push: the render check on the 2018
>    build, and `reframeJob.int`'s no-venv suite there for the first time.
> 5. **The Surface**: whether MediaPipe runs there at all (§15 row 1), the
>    time, and the helper's peak RSS (a line the gated run still lacks).
> 6. **1g**: not built; the Follow: field stays greyed.
>
> Two bullets below have changed under them: no shot calls the salient box
> any more (§16.35), so its 8–9 s a shot is out of the budget; and
> "sessions released when the job ends" is a no-op today — the job opens
> no session (§12.1) — so it is met trivially until one is opened, or read
> as the helper's RSS back at its baseline after a job, measured with the
> RSS line.

- The ten user clips through the action, with frames sampled into
  `tests/output/reframe-real/` (not committed):
  - face-inside-crop ≥ 95 % where a face was found (on a two-up shot, each
    face inside its own half);
  - zero crops held across a cut;
  - the user's rating ≥ 4/5 on ≥ 8 of 10.

  **The reader exists (2026-10-14)**: `FORGE_REFRAME_EXIT=/path/to/project.forge
  npx vitest run tests/integration/reframeExit.int.test.ts` reads a saved
  project through `deserializeProject`, scores every followed clip
  (`src/shared/reframe/exit.ts`: the face the shot follows — a one-person
  shot's subject by identity as path.ts follows it, so a larger passer-by is
  not it; a two-shot's two faces both; a `larger` shot's larger face — or
  each face against its own half on a stacked two-up, held to `followAt` on
  the clip frame `exportFrameAt` gives its sample; a cut held where a lane of
  the path moves — each half's x and y on a two-up clip, lane by lane — and
  that lane does not change on the frame the PICTURE cuts on, so a track cut
  a frame off the picture, late or early, is held too: the runner reads the
  pulled frames F−3 … F+3 as 64×64 grey and takes the clear largest change
  within ±2 frames, ≥ 20 and ≥ 2× the next — on j4aoo1qbGoE's first 180 s
  all 42 of the scene pass's cuts were on their own frame, 40.7–111.6 and
  2.6× or more, and motion inside a shot ran 10–16 — and where none is clear
  the keys' own frame, which the README names), and writes into
  `tests/output/reframe-real/` a contact sheet per cut (frames F−1 | F | F+1,
  widened to take in the picture's cut P where it is not F, then named
  `-pPPPPP`) and a frame per shot — the source frame the export shows there, the crop
  drawn in red (a two-up's bottom half in blue), the faces in green — and a
  README.txt table with both bars marked per clip and an empty rating (1–5)
  column, which is yours to fill — clearing only its own last run there, so
  the clips kept in that folder (`source/`) stay and a filled-in README is
  kept as `README.<time>.txt`.
- pyautoflip's output on the same ten clips (§4.1) rated by you beside
  ours, both ratings in `EFFECTS.md`. A baseline, not a bar: where it rates
  higher, the clip and the reason are written down before the exit.
- The render check frame-exact on both builds, on all four sources (30,
  29.97, 60 fps and VFR), the two-up rows included.
- Analysis time recorded: **≤ 90 s for a 10-minute 1080p clip on the Mac,
  ≤ 3 min on the Surface**. Over that, drop to 3 fps first, then 480 px.
  **Mac: met, 2026-10-14 — 43.7 s for a 10 min 14 s 1080p clip** (the
  note above; `EFFECTS.md` §56); the Surface is open.
  **A 4K HEVC phone clip is a separate budget**: its decode alone measured
  about 3.3× realtime on the Mac, about 3 minutes for 10 minutes before any
  detection (`EFFECTS.md` §37, on the face fixture), so the 4K time is
  recorded on its own, and hardware decode (`videotoolbox`; unmeasured) is
  the lever if it is too slow. Measured since in step 1's helper slice
  (`EFFECTS.md` §54): on that fixture 5 fps → 2 fps saved only 6 % of the
  face pass (the decode is the cost), so "drop to 3 fps" does not rescue a
  4K budget; and each no-face shot's salient box is about 8–9 s of matte
  on the Mac, so ten such shots are most of the 90 s on their own.
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
| 1 reframe | shots (main), every crop centred: **today's `solveCrop`, so nothing new to see**; Follow the subject and Reframe greyed | faces, salient, ground; the stacked two-up (it needs two face boxes) | faces: MediaPipe 0.10.35, 17.8 MB (Mac) / 10.9 MB (Windows) of wheel installed `--no-deps` with stubs, plus the 1.1 MB full-range model (§4.3); on the dev Mac the two pip runs took 0.74 s and 1.28 s and mediapipe is 54.5 MB on disk; RSS measured on the Mac without the detector, which aborts in the sandbox: the helper about 100 MB, the worker 45–92 MB, its ffmpeg 455 MB on 4K HEVC; YuNet 0.23 MB on the installed onnxruntime only if the fallback is needed; **BiRefNet 115 MB (114,538,221 B), a download for any user who never baked depth** (on disk only on the dev Mac; one matte peaks the helper at 6.6–9.7 GB, §4.4, §12.1); Florence-2 int8 275 MB, each its own Get press. **The Surface's numbers, all of them, and the detector's own RSS are unmeasured** |
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
  `EFFECTS.md`. **Salient is measured on the Mac, and it is the problem**
  (§4.4, `EFFECTS.md` §54): one BiRefNet_lite matte peaks the helper at
  **6.6–9.7 GB** (7.7–8.7 GB for a session's first), and with ORT's default CPU arena it then holds 4.9–8.7 GB
  until the session is dropped (arena off: 1.1–1.4 GB after each call,
  the same peak). On the Surface that is a page-out on the first no-face
  shot. Faces is cheap on the helper's side (about 100 MB; the worker 45–92
  MB without the detector, which only your run can load; its ffmpeg 455 MB
  decoding 4K HEVC to 640×360, the helper-rules verifier's numbers). The detector's
  own RSS is not yet recorded by that run: it writes counts, time and the
  track's size, so a line for the worker's peak is still to add (§4.3).
- **Salient's gate — decided (2026-10-13, §16.35): the analysis job does
  not call `vision.salient` for the beta, on any machine.** A no-face shot
  falls to the centre with a note, as §4.4 always allowed; `vision.salient`
  and its model method stay in the helper, unused by the job, so the box
  rule, the per-item errors and the gate carry over to whatever replaces
  the model. A bounding box does not need a 1024² matte at 8 s and 8 GB a
  frame: a small saliency model (U²-Net's small variant, about 5 MB,
  Apache-2.0, or another measured the same way) is its own later item,
  measured for time and RSS before it is chosen (§15 row 25). The options
  not taken: a RAM gate (salient on the Mac class only), the arena off plus
  the release below, a worker of its own, a smaller re-export. §12.1's bar
  below is then measured without salient.
- **Release when done.** A new helper method, `system.release({names})`,
  drops the named sessions under the session lock; the analysis job calls it
  for everything it opened when it ends, success, failure or cancel.
  Measured for salient: dropping `matte:fp16` under the lock took the
  helper from 4.9–8.6 GB back to 155–294 MB. **salient and depth's parallax
  bakes share that one session** (`matte:fp16`, depth's), so one release
  covers both — and the lock covers only the session's build, not its run,
  so a bake must not overlap an analysis job either. Depth's own cache
  moves to the same rule: an LRU with a byte cap (set from the
  measurement) rather than "forever".
  **As built (slice B, 2026-10-13):** the job ends, success, failure or
  cancel, in `releaseSessions`, a commented no-op. `system.release` is not
  built, because nothing the job calls holds a session: the face finder
  lives and dies in its worker process, and salient is not called
  (§16.35). The hook becomes real with the first capability the job calls
  that keeps one (a small saliency model, §15 row 25; 1g's Florence).
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
| `select='gt(scene,T)'` after `scale=320:-2,format=rgb24`, on a `split` branch that ends in `nullsink`; `metadata=print` at **`-loglevel info`** | 1b shots (`sceneArgs`, built 2026-10-13) | 2012 / 2012 / 2016; `split` and `nullsink` are in `allfilters.c` at `f22fcd4` (read) | **built**; measured on the Mac (`EFFECTS.md` §52, §53). Without `format=rgb24` the score differs per build (§4.2). At `-loglevel error` nothing prints (re-measured on the built shape: 0 lines). `select` on the output path starves `-progress`, hence the split. It is on `ANALYSIS_SHAPES`, where `scdet` in its place fails the floor test. **Windows parity is §4.9's committed score table, asserted in CI: green on the 2018 build in run 38408749271 (2026-10-13)** |
| `-ss S -t D`, both before `-i` (a window) | 1b `findShots`' window (no caller: a clip's shots come from the whole-file pass) | input `-t` is at `f22fcd4` (`ffmpeg_opt.c:3360`, `OPT_INPUT`; trimmed at the graph's input, `ffmpeg_filter.c:846`; read) | measured on the Mac: with `-t` after `-i`, a 3–7 s window printed a cut at source 8 s; with it before, only the cuts at 4 and 6 s. On MPEG-TS the window seeks wrong and finds nothing (`EFFECTS.md` §52). A camera's `.MTS` is unmeasured; **the whole-file pass on MPEG-TS is** (2026-10-14, §55): its pts count from the file's first timestamp, as the export's `-ss` does |
| `scale` before analysis; `-ss` before `-i` for one frame | 1b, 1c, 1d, 1g (in the helper) | old | measured on the Mac (30–80 ms a seek, exact shot) |
| `fps=${fps}:round=up` in the helper's frame stream (`media.frame_args`) | 1c's face pass | `fps` 2010s; `round` and its `up` in `vf_fps.c`'s option table at `f22fcd4` (:81, :85; read) | **built 2026-10-14** (slice B's fix phase): each sample the frame on screen at its ms, where `fps=5` showed one 66.7 ms later (`EFFECTS.md` §54); the face track is version 2. On `ANALYSIS_SHAPES`, and `test_media.py` reads the frames on CI's 2018 build |
| `crop` whose `x` (or `y`) is a **flat sum**, `base±Δ*gte(t,B)±Δ*(P)*(P)*(3-2*(P))` with P = `min(1,max(0,(t-t0)/span))`, every time to 6 dp and every pixel an integer, written in parenthesised groups past 1,000 terms; inside `max(0,min(…,in_w-out_w))`, `w`/`h` literal | 1f's followed crop (`cropFilter`, built 2026-10-13): the render and the moments' pull | crop 2010s; `max`, `min` and `gte` are in `eval.c` at `f22fcd4` (:440, :441, :443, evaluated at :309–313); crop evaluates x and y per frame, `lrint`s them (:130), clamps them and clears the low bit (`vf_crop.c:263–281`) (all read) | **built**; measured on the Mac inside `buildRenderPlan`'s chain (`EFFECTS.md` §55): frame-exact to 2,998 terms written flat and to 9,595 grouped, the crop at `Math.round(x) & ~1` on every frame. **Not `keyframeExpression`**: its nested `if()` as the crop's x is refused at 97 held and 92 smooth keys. A flat sum past about 7,000 terms crashed the evaluator at a 1 MB stack, hence the groups. `sgn` (4.3) and `randomi` (7.0) are on the floor scan's `TOO_NEW`. **Dated** for Windows: reframe.int's rows (110 held keys, a 1,103-term grouped sum) run it in CI on the push |
| `fps=${fps}:start_time=0` immediately ahead of a followed crop (or the two-up's `split`), at every speed: at speed 1 it is the clip's first filter, and at other speeds it comes after the retime's own `fps=` | 1f (`followClock`), the render and the moments' pull | `fps` 2010s; `start_time` in `vf_fps.c`'s option table at `f22fcd4` (:80, its offsets set at :159–172), rounding NEAR_INF (:81) (read) | **built**; measured on the Mac (§55). Without `fps=` first, 29.97 and VFR pans drifted 12 and 8 px off the frame grid, and a VFR frame stamped on a half slot took the old crop. Without `start_time=0`, `fps=` starts at slot 1 when the first frame is half a slot or more past the seek, and every reader was a frame off. A static crop is framemd5-identical with it (video and audio) on 30, 29.97, 60 and two VFR sources; 60 fps is 14–18 % faster. **Dated** for Windows; CI on the push |
| a followed ramp's `setpts` written on `T` (seek-relative after `-ss`), not `T-STARTT` | 1f (`followedRetime`), the render and the pull | `setpts`' `T` and `STARTT`, old | **built**; measured on the Mac (§55): from STARTT, every cut of a VFR clip at in-point 7 moved (721 of 721, by up to 5 frames); on `T`, 0 off for four ramps on VFR, 29.97, 30 and 60 fps at in-points 0 and 7. reframe.int's ramp row runs it in CI |
| **the stacked two-up**: `split=2[r<i>a][r<i>b]`, two `crop`s each with flat-sum `x` and `y` and literal `w`/`h`, then `vstack,tpad=stop_mode=clone:stop=1`, with clip-indexed labels | 1f (§4.6 rule 3, §4.7), the render and the moments' pull's `-vf` | in `allfilters.c` at `f22fcd4`: crop :176, split :351, tpad :372, vstack :391; `split.c:123`, `vf_stack.c:368`; tpad's `stop`, `clone` and `stop_mode` at `vf_tpad.c:54`, `:57`, `:58`; tpad merged October 2018 (all read) | **built**; measured on the Mac (§38 in `-vf`, §55 in the chain). As first specified, the chain's trailing `fps=` **dropped the clip's last frame** (59 of 60 at 30 and 29.97 fps, and at 60 fps with `fps=` first: vstack's framesync sends EOF with no pts, `framesync.c:98`); with the `tpad`, 60 of 60 bit-identical to the one crop, with captions and the baked band, at +3–6 %. reframe.int's two-up rows on four sources. **Dated** for Windows; CI on the push |
| the moments' pull: `-vf "[retime,]fps=…:start_time=0,<crop or the stack>,tpad=stop_mode=clone:stop_duration=…,trim=start_frame=…:end_frame=…,setpts=PTS-STARTPTS,scale=<cap>,format=rgba"`, with the window's keys only (`windowSum`) | 1f (`momentFrameArgs`) | all of the above; `trim` is at `allfilters.c:376` | **built**; measured on the Mac (§55): a window across a key switch read 10 of 10 and the clip's last 5 read 5 of 5 at 30, 29.97 and 60 fps; the pull equals the render's frame beneath within 1 px on every reframe.int row. With the whole clip's keys this `-vf` was 46,001 characters for a 20-minute clip, past Windows' 32,767; with the window's, under 2,000. **Dated** for Windows; CI on the push |
| `sgn`, `randomi` in an expression | **not used** | 4.3 / 7.0 (absent from `eval.c` at `f22fcd4`) | in `TOO_NEW`; the Mac's build accepts `sgn` and refuses `randomi` |
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
`ANALYSIS_SHAPES`. `sceneArgs` has been there since 2026-10-13, registered
with a window, so `-ss` and `-t` are scanned too. So have 1f's shapes since
2026-10-13: `SHAPES` holds a followed clip at speed 1 and a two-up clip, and
`ANALYSIS_SHAPES` holds both of their moments' pulls.

---

## 14. Degraded modes — each rendered, each a test

| missing | what happens | test |
|---|---|---|
| the Python helper | Follow the subject, Reframe and Smart placement greyed with "needs the AI helper"; crops as they were; captions at the style's place; Best clips over YouTube captions only; graphics over caption tracks only, no `callout`; every B-roll picture that may show a person asks | `reframe.int` with the helper refused; `bestClips` without asr; census rows for each greyed control. **The reframe's, as built (slice B):** `reframeJob.int`'s no-helper case (a missing interpreter, and a bare one: `no-helper` before any scene pass, in CI too); `reframePanel` and the census's `reframe-no-helper` rows for Follow the subject and Reframe to 9:16; a followed clip keeps following |
| a model not on disk | its Get button with its size; nothing downloads until it is pressed | census rows; a store test that no toggle or phrase starts a download. **The face finder's, as built (slice B):** no Get button of its own — Follow the subject names it, "gets the face finder, 1.1 MB, first time" (its census row), and the press fetches, then analyses; `reframeJob.int`: a job asked without it fails `model-missing` with nothing fetched and no scene pass; `reframeStore`: a phrase is refused before any job |
| the face detector (degraded) | salient, then centre, per shot, with a note. **As built (slice B):** the helper counts as missing (`reframeHelperFrom`), so Follow the subject is greyed "needs the AI helper"; and a shot with no face centres with a note, salient never called (§16.35) | path test "no faces"; `reframeContract` (`reframeHelperFrom`); `reframeJob.int`'s bare interpreter, where `vision.faces` is degraded |
| two people, one of them lost for much of the shot | no two-up: the larger face, with a note | path test "a lost face gives larger" |
| Florence-2 (not downloaded, or over its gate) | the phrase field greyed with its reason; salient covers no-face shots. **As built (slice B):** 1g is not built, so Follow: is always greyed, "following something named is not built yet", and a no-face shot centres (§16.35) | path test "ground absent"; `reframePanel`; the census row |
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
| the AI helper's pack, on an installed app (Step P, §3a) | nothing spawned at any caller; a grey "Not installed" with the sized Install; every Python control greyed "needs the AI helper", each a pointer to Settings; the local voice says why; stems split by mid/side | `sidecarService` (spawn never called); the harness check; census rows |
| a pack install stopped part-way (cancel, quit, offline) | verified downloads kept, no receipt, the folder ignored by the order and swept at launch; the next press says "· N MB left" and fetches only that | `helperPackJob`; `fetchFile` |
| a module degraded inside the pack (most likely the Visual C++ runtime) | the pack kept; its controls greyed by method; the row grey, "N of 8 helper features", naming what is missing, with Check again | `helperPackJob`; `test_selftest`; §15 row 30's run |
| a damaged pack (its interpreter gone, its receipt torn) | red "Not running" naming it, Repair with its size; never swept, never offered as a fresh Install | `helperPython`; `helperPackJob`'s sweep; `settingsPanel` |
| macOS 13, Windows on Arm | "Not available on this computer" with the reason, no button | `helperPackManifest`; `settingsPanel` |
| another app instance holding the pack | the sweep does nothing; Repair, Remove and Update refuse, with the reason | `helperPackJob` |
| Windows | every render check above runs in CI on the 2018 build | CI, read after every push |

---

## 15. Measure before relying — the open measurements

Each is named in its step, and each step's first task is its own row:

1. MediaPipe: **measured on the user's Mac** (it survives, the full-range
   model is accepted, 5 ms a frame at 360×778, CPython 3.14.6; §4.1). Still
   open: the Surface (no Metal; the Windows wheel), mediapipe 1.0.1, the
   cost at the 640 px edge, and recall and false boxes against hand marks
   on the ten clips. The worker's start is measured (2026-10-13, §4.3): it
   starts and imports mediapipe in 0.14–0.23 s wall (the import 0.07–0.13 s)
   on the dev Mac, once per analysis. **The child-process rule is measured
   in the sandbox**, where the detector cannot run: the worker dies at
   `create_from_options` with −6, the helper answers −32001 in 0.6 s and
   keeps answering, and a cancel, a SIGKILLed helper and an app quit each
   leave no worker, no ffmpeg and no half-track (`EFFECTS.md` §54). **The
   detection on your face fixture: measured on your Mac, 2026-10-13** — 101
   of 133 samples with a face on the 4K original at 5 fps and a 640 edge in
   37.8 s, and the phone-shaped copy's boxes overlapping the plain copy's by
   at least 0.875 (§4.3's Built note). Still open: the Windows code for
   the abort (3 or `0xC0000409`, both accepted until the Surface names it;
   CI's bare interpreter skips those tests, run 38453960372). The YuNet
   comparison is not run (§16.1 answered); YuNet's hand decoder and its
   golden test only if the Surface run fails (§4.1, §4.3). **Since slice B
   (2026-10-14)** the detector runs inside the analysis job
   (`main/reframe/analyse.ts`), and each sample is the frame on screen at
   its label (`fps=5:round=up`, face track version 2; with `fps=5` it was
   the frame 66.7 ms later, `EFFECTS.md` §54). The job's cost on a real
   clip is one command of yours, outside the sandbox (§4.10):
   `FORGE_REFRAME_REAL=/path/to/clip.mp4 npx vitest run
   tests/integration/reframeJob.int.test.ts`. Its pts follow-up is row 6.
2. The scene threshold and minimum shot on footage with hand-marked cuts
   (1a, §4.1): open. The per-cut scores against the committed table:
   **measured on the Mac** (2026-10-13, `EFFECTS.md` §53: 1.000 / 1.000 /
   0.400 / 0.200, beside the Y path's 0.40 / 0.61 / 0.34 / 0.17). **The 2018
   build: measured in Windows CI** — `shots.int.test.ts`' table case, every
   row within 0.01, green in run 38408749271 on `d8e3259` (2026-10-13;
   §4.2, §4.9). Still 1a's: T and the minimum shot on hand-marked cuts.
3. Florence-2 int8 on the CPU: seconds per grounding on the Mac and the
   Surface, the hand-written loop, box quality, **and its peak RSS** (§4.5).
4. **The helper's peak RSS per capability** (faces, salient, ground, asr) on
   the Mac and the Surface, and Clip it end to end on the Surface without
   swapping (§12.1). **Salient measured on the Mac** (2026-10-13, three
   runs, `EFFECTS.md` §54): 6.6–9.7 GB peak a matte, 4.9–8.7 GB held after
   with ORT's arena, 155–294 MB once `matte:fp16` is dropped — over the
   floor machine's budget as built; **decided 2026-10-13 (§16.35): not
   called by the analysis job for the beta** (§12.1).
   Faces' helper side measured (about 100 MB at hello and through a pass;
   the worker without the detector 45–92 MB; its ffmpeg 455 MB decoding the
   4K HEVC fixture to 640×360). The detector's own RSS needs your Mac, and
   your `FORGE_FACES_REAL=1` run does not record it yet (§4.3). Still open:
   the detector, ground, asr, and all of it on the Surface, where salient's
   gate is decided first. The analysis job's release is a no-op as built
   (slice B, §12.1): nothing it calls holds a session, and
   `FORGE_REFRAME_REAL` does not record RSS either.
5. The followed crop in the preview while playing: the cut lands on the
   element's frame (§4.9 harness). **Answered 2026-10-13/14 (slice B,
   §4.9's harness note): it does.** The preview reads the crop at
   `exportFrameAt(clip, fps, mediaTime·1000)` of the frame the element
   presents (`requestVideoFrameCallback`; `shared/reframe/playback.ts`),
   never through `sourceFrameFor` or `timelineFrameAt`. As it plays, the
   drift (playhead − element) is −1..+1 frames over 175–177 frames a pass;
   nudged 3 frames each way through the cuts it is −3..+6, and on every
   near-cut frame where the element's frame and the playhead's give
   different crops (4 to 8 a run) the preview drew the element's:
   0.34–1.01/255 against 73.8–107 for the playhead's. The export's side is
   settled by construction (2026-10-13, §4.7's slice A note):
   - `cropAt` reads the export's own compiled keys at the export's rounding
     (`lrint & ~1`, even on every one of 3,000 frames read);
   - the followed clock makes the export's clip frame k slot k.

   Still open, and PAUSED, not playing: at 0.5× the element is seeked
   through `sourceFrameFor`, which rounds n/2 half up while the export shows
   floor(n/2), so on the frame before each cut the paused preview shows the
   new shot's picture through the old shot's (correct) crop; the same may
   happen paused at speed 1 on 29.97 or VFR sources, unmeasured (§4.7's
   slice B Left).
6. **The followed crop at speed 1 on 29.97 fps, 60 fps and VFR sources**:
   whether `fps=`'s rounding agrees with the half-frame keys, or the crop
   needs `fps=` ahead of it (§4.7, §4.9). **Measured on the Mac (2026-10-13,
   `EFFECTS.md` §55): it needs `fps=` ahead of it.** At speed 1 the crop ran
   on each source frame's own time:
   - pans drifted up to 12 px off the frame grid on 209 of 1,100 frames at
     29.97, and up to 8 px at VFR;
   - a VFR frame stamped exactly on a half output frame took the old crop,
     because a 6-dp boundary rounded above its time. That was 1 cut of 44,
     or 2 with an in-point.

   With `fps=` first: 0 frames off the grid on 30, 29.97, 60 and both VFR
   sources, and a static crop framemd5-identical, video and audio.

   **As built**, `fps=${fps}:start_time=0` goes ahead of every followed crop
   at every speed. Without `start_time`, `fps=` starts at slot 1 after some
   seeks and every reader was a frame off. Each cut's key goes on the
   export's exact slot: `timelineFrameAt` was early on 15–21 of 44 cuts, and
   `Math.round(ms)` on 15 of 45 odd 60 fps cuts.

   reframe.int is frame-exact at every cut on all four sources, at 9:16,
   1:1, 2× and the two-up, plus the slot-1 rows and a ramp, within 1 px on
   every frame. Still open:
   - the 2018 build: CI's reframe.int on the push;
   - ~~25 and 50 fps projects, which need 1b's `Shot.startPts` and the
     track's time base~~ — **done in slice B** (`4aafdc4`, 2026-10-13). ffmpeg
     rounds the seek into the time base, and the printed-ms path keyed 1 cut
     in 6 a frame late at 2 in-points of 5 (159 of 958 measured). The scene
     pass's integer `pts:` is now kept as `Shot.startPts` and the stream's
     time base as `SubjectTrack.timeBase`, and `keys.ts` hands both to
     `exportFrameAt` at every cut and in a hold: the measured case (25 fps,
     in-point 72, source frame 231, pts 118272 on 1/15360) keys slot 120,
     where the printed 7700 ms keyed 121. The pts count from the file's
     first timestamp, as the export's `-ss` does (`EFFECTS.md` §55).
7. The 360-cut render through `-filter_complex_script` on the 2018 build,
   and its export time (§3.7). **The followed clip it was written for
   renders now** (2026-10-13, `EFFECTS.md` §55).
   - The flat sum has no parser limit where `keyframeExpression` stopped
     (97 held keys as a crop's x).
   - On the Mac, inside the plan's chain through the graph file, a
     2,998-term x (220,580 characters, a 221,148 B file) rendered
     frame-exact over 3,000 frames in 17.9–18.1 s, against 14.0–15.4 s for
     a static crop. A 360-cut clip with a pan per shot is about 720 terms.
   - Past 1,000 terms the sum is grouped, because written flat it crashed
     the evaluator past about 7,000 terms at a 1 MB stack. 9,595 grouped
     terms were exact.
   - The 2018 build: §3.7's 72-cut `longGraph.int` ran in Windows CI with
     the full suite, green in run 38408749271. reframe.int's 110-held-key
     and 1,103-term rows run on the push.

   Still open: a long followed clip's export time on the Surface, and the
   2018 exe's stack reserve.
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
14. **The exact cut's first frame against its source**: **measured on the
    Mac** (2026-10-06, `EFFECTS.md` §41) — the source's frame at the start on
    three videos, the sound to the sample, a start between frames within half
    a frame on those and a fourth; the fast cut's 10 s head on four videos.
    **The 2018 build: measured in Windows CI** on `d458cb0` (run
    37571739663, 2026-10-07), green — `exactCut.int.test.ts` runs there on
    every push, both legs, and fails rather than skips (§7.1; M0's exit,
    §3b.9). The Surface is no longer needed for this.
15. Whether low-view videos carry a heatmap (§7.4); whether the metadata
    subset's `channel`, `uploader` and `webpage_url` print as expected
    (§7.1; M0's first task, §3b.1).
16. *(Removed 2026-10-05: the X capture window is out, §8.4, §17. The
    number is kept so no reference moves.)*
17. Pexels' licence, guidelines and rate limits, read in a browser (§11).
18. The schema.org paywall signal on three news sites (§9).
19. Electron `net.fetch` against Node fetch behind a proxy (§8.2); for
    Step P, also one Hugging Face model press and one `fetch_url` press
    behind the same proxy (§3a.5).
20. three.js flat colour and edge alpha against the 2D painter (§9).
21. pyautoflip on the ten clips, run once in a scratch venv on your Mac
    (Python 3.13 or older: it refuses 3.14), and rated beside ours at step
    1's exit (§4.1, §4.10).
22. The stacked two-up (`split`, two keyed `crop`s, `vstack`) on the 2018
    build, through §4.9's two-up rows in Windows CI (§4.7, §13). **Measured
    in the plan's chain on the Mac** (2026-10-13, `EFFECTS.md` §55).
    - As specified, it lost the clip's last frame to the trailing `fps=`: 59
      of 60 at 30 and 29.97 fps, and at 60 with `fps=` first, the 60th the
      black canvas. vstack's framesync sends its EOF with no pts.
    - Built as `vstack,tpad=stop_mode=clone:stop=1`, it gives 60 of 60,
      bit-identical to the one crop, with an `ass` caption and the baked
      band, at +3–6 %.
    - In reframe.int, on 30, 29.97, 60 and VFR:
      - each half reads its own face at the cut, (81, 162) and (1232, 378)
        against the path's (80, 162) and (1232, 378);
      - a single shot is 0.000 levels from a clip with no two-up;
      - the last frame is kept;
      - the moments' one stacked pull matches the render beneath.

    Still open: the 2018 build. It is dated at `f22fcd4` (`split.c:123`,
    `vf_stack.c:368`, `vf_tpad.c:54`/`:57`/`:58`, and `framesync.c:98`'s
    EOF the same), and the two-up rows run it in CI on the push.
23. The shot finder's other paths that only Windows runs, in the same CI
    run as row 2 (§4.2):
    - the `split`/`nullsink` graph inside `-vf`. It was read in the 2018
      source (`ffmpeg_filter.c:1080`, a simple graph's one open input and
      one open output), not run;
    - the cancel through `taskkill /f /t`, asserted to leave ffmpeg exited
      with a code that is not 0.
24. A window over a camera's AVCHD `.MTS` (MPEG-TS, short GOPs). An MPEG-TS
    copy of the fixture seeked wrong and found no cut (`EFFECTS.md` §52).
    This is to measure before any caller passes a window; none does today
    (§4.2).
25. **A small saliency model for no-face shots**, to replace BiRefNet's
    matte there (§16.35): U²-Net's small variant (about 5 MB, Apache-2.0)
    or another, measured for time a frame and the helper's peak RSS on the
    Mac and the Surface, and for where its box lands against BiRefNet's on
    the salient check's synthetic clips and the face fixture (§4.4), before
    it is chosen. Until then the analysis job centres a no-face shot with a
    note.

**Rows 26–38 are Step P's**, written in full in §3a.8 (2026-10-14): the
pinned archives' members (26, P's first task), install time (27), bytes on
disk and the longest paths (28), the cold hello (29), the Visual C++
runtime (30), the clean Mac (31), Windows' scanners and console windows
(32), range resume (33), pip over the lock (34), hf-xet left out (35), the
Surface itself (36), CI's first runs (37), and the protocol's encoding under
`-E` (38).

- **Row 26: the Mac's half measured 2026-10-14** (§3a.8, `EFFECTS.md` §57):
  ustar archives whose long names ride the prefix field, with no directory
  entries; the interpreter's names as the manifest has them; pip 26.2.1, no
  `EXTERNALLY-MANAGED`; every shipped `.pyc` stale, so the job compiles the
  standard library once (2.22 s on the Mac, 0.34 → 0.07 s for a 19-module
  import). Open: the Surface's `sys.winver` and the planted HKCU
  `PythonPath`, with and without `-E`.
- **Row 38: the Mac's half measured 2026-10-14** (§3a.8, `EFFECTS.md` §57):
  under `-E` a Latin-1 locale broke the protocol both ways; the helper now
  sets its own stdio to UTF-8, and both directions round-trip. Open: the
  Windows pipes (CI's Windows job, then the Surface).

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

    **Answer (2026-10-06, measured on the Mac): exact stays Clip it's
    default.** Through yt-dlp 2026.08.19 and the bundled Mac ffmpeg, the
    exact cut's first frame IS the source's frame at the requested start on
    three videos (25 and 60 fps, H.264 and VP9; corr 0.99995–0.99999
    against 0.9893–0.9994 for the neighbouring frame), and its sound starts
    there to the sample; a start between frames, on these and a fourth at
    23.976 fps, gives the next frame, placed within half a frame (2.7–16.3
    ms) by the cut's edit list — `EFFECTS.md` §41. **The 2018 Windows build
    confirmed it the next day:** CI run 37571739663 on `d458cb0` (2026-10-07)
    ran `exactCut.int.test.ts` there — both legs, since under CI it fails
    rather than skips — green. Exact is Clip it's default on both platforms.
    The fast cut with `offsetIntoDownload` as its head offset stays built as
    the fallback (its 10 s head measured on four videos, its first frame up
    to a frame early between frames).
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

**Added 2026-10-13, from M0's exit on your ten links (§3b.9; measured in
`EFFECTS.md` §51).** Each is **OPEN**.

32. **An uploader's regional caption track.** The app asks `<l>` and
    `<l>-orig` from the language's primary subtag, so an uploader track
    keyed `en-US` on a video whose language is `en` is never fetched — one
    of your ten links (`jze_5hvaVV8`; 47 words and 1 sentence end against
    the ASR's 744 and 114, so little lost there). A regional pattern in the
    one fetch would pull translations and dubs' ASR (measured on
    `3pG8Hgq3Z8M`). Measured to work: a second, uploader-only fetch
    (`--write-subs` alone, `--sub-langs '<l>-[A-Za-z]+'` — no comma, since
    yt-dlp splits that option on commas), 1.7 s, `en-US` on `jze_5hvaVV8`
    and nothing on five others; run only when the details' first track flag
    says an uploader track exists, which on your ten links is that one
    video. Recommended: **wait** until a link you care about loses an
    uploader's text this way, then build it as measured (half a day with
    its tests).

    **Answer (2026-10-13):** taken as recommended — wait.
33. **Where a cut's edges fall, in Hindi and Telugu and in loud sound.** A
    word's end is estimated at 80 ms a grapheme (at most 600 ms, never past
    the next word's start); §3b.1 measured Hindi and Telugu at 120–160 ms
    and left them open, and a verifier found the last word of every first
    run on your links ending on that estimate. If links 2 and 3 of §3b.9's
    ear list sound cut short, recommended: 140 ms a grapheme for `hi` and
    `te` (the next word's start still bounds it, so no neighbour can be
    pulled in), re-run on those two links and heard again. A cut that lands in loud sound (`eK71EN3P78U`'s second head) could
    also snap to the quietest 40 ms within about ±120 ms of the word edge;
    recommended only if the first change does not settle it, since it moves
    every cut.

    **Answer (2026-10-13):** keep 80 ms — you heard links 2 and 3 and the
    clips landed well. Step P's Listen to it does not replace this estimate
    on the captions path: it is a separate transcript, heard from the sound,
    for a link with no captions or when you ask for it; a link clipped from
    its YouTube captions keeps the estimate for its word ends.
34. **A no-caption link's start and end fields** sit behind "Just a part of
    it", as on every link (one click). Open them at once on a link with no
    captions, or leave them (recommended: leave them — one rule for every
    link, and your §16.26 answer kept them as they were).

    **Answer (2026-10-13):** leave them.
35. **The subject finder's memory.** One BiRefNet_lite matte peaks the AI
    helper at 6.6–9.7 GB and holds 4.9–8.7 GB after (§4.4, §12.1,
    `EFFECTS.md` §54), which the 8 GB Surface cannot carry. The choices
    were: not calling it for the beta (a no-face shot centres with a note,
    as §4.4 always allowed) and measuring a small saliency model later (§15
    row 25); a RAM gate; the arena off plus a release; a worker of its own;
    a smaller re-export. Recommended: the first.

    **Answer (2026-10-13):** the first. The analysis job does not call
    `vision.salient`; the method stays in the helper, unused by the job;
    the small model is its own later item.

    **Built so (slice B, 2026-10-13/14):** a whole job asks the helper
    `vision.facesModel` and `vision.faces` and nothing else, pinned in
    `reframeJob.int` on any interpreter (the mutation that adds a
    `vision.salient` request fails it); no salient control exists, and
    `censusHomes.test.ts` pins that no census row names one (§4.7, §4.8).

**Added 2026-10-14, from Step P's plan (§3a) and its two reviews.** Each is
**OPEN**.

36. **The AI helper's Python.** python-build-standalone's
    `install_only_stripped` CPython: relocatable, no admin, no installer UI,
    and the build uv installs by default. The version:
    - **3.14.8** (Mac 26,680,498 B, Windows 23,227,899 B at `20261001`):
      every base wheel exists (47 / 48); the whole stack has only ever run
      on 3.14 (the dev venv's 3.14.6, the stub route included); supported
      to 2030-10. It costs voice (kokoro-onnx caps below 3.14) and any pack
      below macOS 14 (§16.44).
    - **3.12.15** (25,023,573 / 22,013,771 B): the same wheels exist; never
      run with the stack; security-only to 2028-10; python.org stopped
      building 3.12 binaries at 3.12.10.
    - **3.15.0** (2026-10-09): no cp315 wheels for onnxruntime,
      ctranslate2, numba, llvmlite or pyyaml at these pins.
    - Other sources fail on admin (python.org's Mac `.pkg`), on registering
      with Windows (its silent installer), on pip and the C runtime (the
      embeddable zip), on a UI (the Store), or add a 28–32 MB binary (uv).

    **Recommended: 3.14.8**, pinned to `20261001` (or the newest tag that
    has stood two weeks when P starts), its URL, bytes and sha256 in
    `pack.ts`. CI keeps its bare 3.12 run as the floor for the degraded
    checks; the pack's 3.14 runs the full suites.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
37. **Where the wheels come from.** The bytes are the same either way (Mac
    151,510,094 B, Windows 191,876,652 B):
    - **(a) PyPI's own files at the press.** The app ships a hash-pinned
      lock with every file's files.pythonhosted.org URL, fetches each with
      its own bar, retries, byte count and sha256, and pip installs
      offline. Two host families (GitHub, PyPI); nothing re-hosted; no
      release step per pack version.
    - **(b) A project-hosted wheelhouse**, one archive per platform on the
      project's release, as the asset packs are (`spyki-a/forge-assets`).
      One host family and one file; but the project becomes the
      distributor of av's FFmpeg (GPL-2.0-or-later as linked, with x264 and
      x265), the LGPL soxr and libsndfile, NVIDIA's cuDNN DLL in
      ctranslate2's Windows wheel, and Microsoft's runtime DLLs in
      scikit-learn's; and each pack version needs a build and a publish.
    - **(c) pip online** on the user's machine: no bar of ours, pip's own
      proxy and certificate handling, and the index host too.
    - **(d) A CI-built environment archive**: no pip on the user's machine;
      the same redistribution as (b); its size unmeasured.

    **Recommended: (a).** Revisit only if a tester's network blocks
    files.pythonhosted.org, and then read the redistribution terms of every
    binary above before (b) or (d). This records who distributes; it does
    not reopen a settled licensing decision.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
38. **The base pack's contents and size.** `requirements.txt` plus both
    faces files, one lock checked complete, one `--no-deps` pip run, the
    stub route unchanged: **170 MB on the Mac's button and 205 MB on
    Windows'** (178,190,592 and 215,104,551 B); **about 0.7 GB on disk on
    both**: 0.66 GB on the Mac (587.9 MB of packages measured, plus the
    interpreter) and 0.72 GB on Windows (measured from the wheels' indexes;
    the first draft's 0.84 GB estimate is withdrawn), with a peak of about
    0.84 / 0.94 GB while the downloads are still there. Within it: Whisper
    23.7 / 51.1 MB (63.0 MB on the Mac's disk), faces 18.9 / 12.1 MB
    (58.6 MB), librosa's chain 54.6 / 57.1 MB (**222.7 MB, 38 % of the
    Mac's packages, for `audio.beats` alone**).
    - (a) one pack, all of it;
    - (b) without librosa's chain until `BETA.md` R4's TypeScript beat
      tracker: −54.6 / −57.1 MB to download, −222.7 MB on disk,
      `audio.beats` degraded meanwhile;
    - (c) a press per capability (a core, then Whisper, faces, beats): more
      states and tests, about a day more.

    Either way hf-xet leaves the lock once the downloads pass without it
    (−3.9 / −4.0 MB, −8.2 MB on disk), and av stays: asr decodes with it,
    and a stub would need decode parity measured first. **Recommended:
    (a)**; revisit (b) when R4's tracker matches the helper's beats on the
    reference recordings.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
39. **Stems (torch) for the beta, and voice.**
    - (a) **Not offered**: `audio.stems` stays degraded with its reason and
      mid/side (29 dB of rejection, `requirements-stems.txt`) stays the
      app's split;
    - (b) **its own press after P**: demucs 4.1.0 plus torch 2.14.1 CPU
      from PyPI, 13 wheels, 139,876,993 B on the Mac and 136,363,381 B on
      Windows (torch alone 127.3 / 124.1 MB), installed size unmeasured,
      plus the htdemucs model. The pin must first move off 4.0.1, which has
      no `demucs.api`, so stems degrades today even where it is installed.
      And torch brings its own OpenMP runtime into a process that already
      holds ctranslate2's Intel one and scikit-learn's `vcomp140`;
      faster-whisper #967 shows a Windows process aborting with "OMP: Error
      #15" when two meet, so (b) is measured for that first (§3a.8 row 37).

    Voice has no option on 3.14: every kokoro-onnx release since 0.4.8
    requires Python below 3.14, and its chain ships espeak-ng (GPL-3.0),
    which `STACK.md` §9 rules out as bundled. That stands; voice stays on
    the hosted provider. **Recommended: (a)** for the beta, with the demucs
    pin fixed as its own half day when stems comes back.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
40. **The hosts a restricted network must allow, and the model presses.**
    For the pack: github.com (it redirects to
    release-assets.githubusercontent.com, measured, and GitHub has moved
    that host before) and files.pythonhosted.org; pip itself contacts
    nothing. For models, each its own press: huggingface.co and *.hf.co, and
    storage.googleapis.com. The model presses go through the helper's own
    two fetchers (§3a.5): huggingface_hub over httpx trusts only certifi and
    reads proxies only from the environment, so behind a company root
    certificate or a system-set proxy the pack can install and every
    Hugging Face press still fail.
    - (a) name the hosts on the row, under the button (the redirect host
      included), and in the tester guide;
    - (b) also an "Install from a file…" route, taking files fetched
      elsewhere against the same pins (half a day or more);
    - (c) a mirror setting (no: a pin's host is part of the pin);
    - (d) for the models: move their fetches to main's fetcher with
      §16.22's one network stack, or say on the row and in the guide that a
      model press needs direct access (or a proxy in `HTTPS_PROXY`).

    **Recommended: (a) now, (b) when a tester needs it**, `FORGE_PYTHON`
    the escape hatch meanwhile; **for (d), the sentence for the beta**, and
    the move with §16.22 once row 19 is measured with one Hugging Face press
    behind a proxy.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
41. **Where the Install press lives.**
    - (a) **Settings only**: one row, one button with its size; every
      "needs the AI helper" becomes a pointer that opens Settings at the
      row, its text unchanged so the census rows keep matching. One home, as
      `WINDOW.md` §3's legend asks, and the Director's gear's precedent;
    - (b) **on every greyed control**, "Install the AI helper · 205 MB",
      then the control's own action. The face finder's press on Follow the
      subject is 1.1 MB; this would be a 205 MB side effect of a dock button;
    - (c) **a first-run prompt**: a 205 MB offer before any work reads as
      bloat.

    **Recommended: (a)**, with no first-run prompt.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
42. **FORGE_PYTHON's place.** Today it beats everything (`service.ts:27`),
    and the Surface sets it with `setx`, so every app started from Explorer
    there inherits it.
    - (a) **first everywhere**, the row naming the source. An installed app
      on the Surface keeps using the dev Python after Install, and the
      Install button is pointless there;
    - (b) **first in development and tests; after the pack in a packaged
      app**, where it is also the escape hatch when no pack is installed.
      Development's order is `FORGE_PYTHON` → `.venv` → the dev pack →
      PATH, so `npm run dev` never quietly runs a pack; an installed app
      uses the pack the user installed;
    - (c) **never in a packaged app**: no offline escape hatch.

    **Recommended: (b).** The row always names the source, and takes its dot
    from hello: a bare `FORGE_PYTHON` reads grey "N of 8 helper features",
    never green. The exit runs on a fresh account either way.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
43. **Where the pack lives on Windows.**
    - (a) **userData** (`%APPDATA%`, Roaming), beside the models (Whisper
      small's 464 MB already lives there), yt-dlp and the packs. The
      deepest file pip writes, its temporary `.pyc` name, is 217 of 259
      characters for a 10-character user name and 227 for a 20-character
      one (computed from the wheels' measured paths). One root for Remove,
      the uninstaller and the guide;
    - (b) **`%LOCALAPPDATA%`**: Electron's `app.md` (v44.3.0) advises
      against large files in userData, and roaming profiles on domain
      machines copy Roaming at logon. It saves 2 characters, and gives two
      folders to remove.

    Either way, R7's name lands before any tester installs a pack, because
    userData follows `productName`. **Recommended: (a)** for the beta; if a
    tester's profile roams, move pack and models together to (b).

    **Answer (2026-10-14):** as recommended ("okay go ahead").
44. **The machines with no pack: macOS 13 and Windows on Arm.**
    - **macOS 13.** The pack's floor is macOS 14: onnxruntime 1.30.0 and av
      18.1.0 publish arm64 wheels only as `macosx_14_0`. Electron 44.3.0's
      own floor is 13.0. (a) Install greyed "needs macOS 14"; (b) a second,
      cp312 lock for 13 (onnxruntime 1.23.2 and av 15.1.0 have
      `macosx_13_0_arm64` wheels; never run).
    - **Windows on Arm.** The app ships x64 only and runs emulated there,
      where `process.arch` says `'x64'`; `packPlatform` sees it through
      `app.runningUnderARM64Translation`. (a) Install greyed "not available
      on Windows on Arm yet"; (b) the x64 pack under emulation, never run
      (onnxruntime and ctranslate2 emulated are unmeasured); (c) later, an
      arm64 build of the app with the native
      `aarch64-pc-windows-msvc` interpreter (22,228,934 B at `20261001`) and
      arm64 wheels, which is its own step.
    - An Intel Mac cannot open the arm64-only DMG, so it needs no row.

    **Recommended: (a) for both**; macOS's (b) or Windows on Arm's (b) only
    if a tester needs it, measured on that machine first.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
45. **The Visual C++ runtime on a clean Windows.** The interpreter carries
    `vcruntime140.dll` and `vcruntime140_1.dll`. Measured by reviewers from
    the wheels (2026-10-14): soxr's and numba's native files import
    `MSVCP140.dll` (numba's `omppool` also `VCOMP140`) and their wheels ship
    neither; onnxruntime's, ctranslate2's and mediapipe's DLLs ship no
    `msvcp140`, whether they import it is CI's listing to answer (§3a.6);
    scikit-learn ships its own `msvcp140.dll` and `vcomp140.dll` and
    preloads them on import, so in one process whatever it loaded first
    serves the rest. So the question reaches **audio.beats** too (soxr,
    numba), not only Whisper and depth, and `hello` cannot see it (the
    imports that need it happen at the first call). First: CI's listing on
    every push, then row 30 in Windows Sandbox with each import in its own
    process. If imports fail on a clean machine:
    - (a) the self-test names it, "needs Microsoft's Visual C++ runtime",
      with Microsoft's download link and Check again: the sentence yt-dlp's
      check already uses;
    - (b) app-local `msvcp140` DLLs beside `python.exe`, the folder Python
      already loads `vcruntime140.dll` from (Microsoft's redistribution
      terms to read first; the project would host the DLLs);
    - (c) the NSIS installer runs `vc_redist` (a UAC prompt, from an
      installer that is per-user today);
    - (d) the helper preloads scikit-learn's own `msvcp140.dll` at start,
      which needs no DLL hosted by the project, once its version is read
      against the toolsets onnxruntime and ctranslate2 were built with (an
      older copy bound first could itself be the crash, row 30).

    **Recommended: measure (CI's listing, then row 30); then (a) for the
    beta, and (d) or (b) after**, chosen on the versions read.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
46. **When a release changes the lock.**
    - (a) the old pack is not used until "Update the AI helper · N MB" is
      pressed, and its controls grey meanwhile; lock changes are batched so
      testers meet one or two pack versions;
    - (b) the old pack keeps running under a compatibility number (more
      states, more tests).

    **Recommended: (a)** for the beta; (b) if testers meet updates often.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
47. **Repair, Remove, the downloads and the uninstaller.** Repair fetches
    and verifies every file first, while the helper keeps running, and only
    then stops it, waits for its exit, removes the receipt, then the tree,
    and reinstalls; its button shows what it will fetch ("Repair · 170 MB" on
    the Mac, 205 MB on Windows, less what is already verified).
    Remove deletes the pack only, with a box, off by default, for
    `userData/models`, both sizes shown. The downloads are deleted after a
    successful install, so Repair downloads again (a failed attempt's
    verified files are reused, and an Install after a cancel says "· N MB
    left"); keeping them costs 170 / 205 MB and makes Repair work offline.
    The NSIS uninstaller removes `%APPDATA%\<productName>\python` but not
    the models, guarded so an app update keeps it (the guard to be measured
    on the Surface); on the Mac the guide says Remove first. **Recommended
    as written.**

    **Answer (2026-10-14):** as recommended ("okay go ahead").
48. **CI on the push.** The repo is public
    (`api.github.com/repos/spyki-a/forge`: `private: false`, 2026-10-14),
    which `ci.yml:31-32` names as the condition for putting macOS back on
    push.
    - (a) the Windows push job installs the pack (cached on the OS, the
      architecture, the ISO week and a hash of `pack.ts`, the locks and the
      installer's code) and runs the helper's suites from inside it through
      the pack's launch; macOS stays on dispatch or a tag;
    - (b) the same on both, with macOS back in the push matrix as `ci.yml`'s
      header says, **on a `macos-14` arm64 runner**, the only place the
      pack's macOS 14 floor runs (the dev Mac is on macOS 26); installers
      stay on dispatch or a tag.

    Either way, every push probes each pinned URL (about 49 requests), so a
    file gone from PyPI or GitHub fails CI rather than a tester.
    **Recommended: (b).** Salient's suite stays off the push path either
    way.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
49. **The speech model on Transcribe.** Once P makes `asr.transcribe`
    available, MediaPool's Transcribe fetches `Systran/faster-whisper-small`
    (464 MB) unnamed, at `main` with no pin, and asks huggingface.co at each
    session's first load (`asr.py:26-37`, faster-whisper 1.2.1's
    `download_model`; §3a, What is wrong).
    - (a) **its own press in P**: "Get the speech model · 464 MB" beside a
      greyed Transcribe and in Settings, through `media.download` at a
      pinned commit; `_load_model` loads that snapshot by path with
      `local_files_only=True`. 0.5–1 day, counted in P's 9.5–13;
    - (b) **Transcribe greyed "needs the speech model"** until a later step
      builds the press, and out of P's exit: P is 9–12.

    **Recommended: (a).** §0's click rule already promised the press ("its
    own Get press", §12), and the exit is the first real Transcribe on a
    clean machine.

    **Answer (2026-10-14):** as recommended ("okay go ahead").
50. **One app at a time.** Nothing makes Forge single-instance, so a
    second window shares userData with the first (and the dev app shares
    it with the installed one, which P answers with a dev root of its own,
    §3a.2).
    - (a) **P's own lock**: `userData/python/.lock` held by install, Repair,
      Remove and Update, and an in-use record per instance whose helper runs
      from the pack; the sweep and the destructive jobs honour both. Built
      and tested in P (§3a.3);
    - (b) **(a) plus `app.requestSingleInstanceLock()`**: a second launch
      focuses the first window. It ends the case for every userData file
      (settings, caches, the fetched yt-dlp), not only the pack's, but it is
      a product decision with its own measurement (whether the dev app and
      the installed one would then exclude each other);
    - (c) nothing: a double-clicked shortcut can delete a pack under pip.

    **Recommended: (a) in P**; (b) as its own decision, not inside P.

    **Answer (2026-10-14):** as recommended ("okay go ahead").

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
