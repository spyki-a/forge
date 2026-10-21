# Clips — from a landscape talk to a vertical clip that explains itself: the plan

> **Status, 2026-10-16.** Built since, each with its Built note in place:
> step 0 (§3.1–§3.7); M0 (§3b, run on your ten links, §3b.9); step 1's 1b
> to 1f with the UI, the harness check and the render check (§4.2–§4.9;
> 1d's salient box is in the helper, but no job calls it, §16.35); Step P,
> in three slices (§3a, 2026-10-14 to 16); and **step 2, caption free
> space** (§5, 2026-10-16), all of it but §5.3's OCR, which waits on 1g.
> Not built: 1g, and everything from step 3 on. The exits wait on runs
> only you can make: step 1's (§4.10), P's (§3a.9) and step 2's ten clips
> (§5's note), and Windows CI has yet to run step 2's last commits. Pushed
> through `fb65a18` (2026-10-16); step 2's commits from `04b25ab` on, and
> its record, were not pushed when this was written.
>
> **Revised 2026-10-21: step 3 re-planned** after the graphics research
> (`docs/research/graphics-motion-research-2026-10-17.md`), with your answers
> to its twelve decisions (§16.54-65): 30.5 days in five phases, where §6 as
> written had 14.5, plus a gated 6 for the hand build (§6's note). Nothing
> of it is built. §2's total is now about 100-103.5 days with Step P.
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
| **3** | the graphics engine, re-planned 2026-10-21 after the graphics research (§16.54-65): one draw list read by two painters (canvas 2D, and a three.js compositor for 2.5D), one motion module, one stroke primitive; eight templates in nine shapes (counter, bars, steps alone or with a connector or a tree, quote, callout, ring, keyword, lower third), and a screen recording as a 2.5D card; a dim; sound on the beats; the graphic style; the Director's third pass with its validator; the hand spike | 30.5, was 14.5 (phases 0-3 and the spike, §6; +6 for phase 4's hand build only if the spike passes its gate) | 2 for placement (degrades to the style's third without it) | a spoken number becomes a counter that lands on the word, a clip that says no number still gets graphics, and nothing unsaid is ever drawn |
| **4** | Best clips in the URL tile: windows, signals, the model's pick, three cards, Clip it from a card | 3.5 (M0 took 7.5 of its 11) | M0; 1–3 (each optional at run time) | a link becomes three clip cards and a 9:16 clip with captions |
| **5** | B-roll: the Pexels key, the sources, the social quote card, credits, the person rule | 14 | 3 (cards are templates) | pictures arrive licensed, credited, and only by click |
| **6** | retrieved-fact cards (Wikipedia, page, answer-with-sources over fetched text); the 3D templates `timeline`, `before-after` and `versus` on step 3's draw list | 5, was 7 (the 3D half 4 → 2: the 2.5D counter and ring moved to step 3's phase 3, §16.55) | 3, 5 | facts from outside, with their sources; three.js graphics |
| **7** | creator styles and saved templates | 4.5 | 3; **`MARKET.md` Stage 0** (below) | toward `MARKET.md` Stage 1 |

**About 89.5 working days in the steps, 90.5 with the one day outside them
(§6.20), plus Step P's 9.5–13: about 100–103.5 days, twenty to twenty-one
weeks, honestly counted; 106–109.5 if the hand spike passes its gate.**
(Re-planned 2026-10-21 with step 3, §16.54-65; it was 75.5, and 85–88.5
with P. P was held at `BETA.md` R4's 5–10 until it was planned in full on
2026-10-14, §3a; the plan and its two reviews put it at 9.5–13, with two
open-ended risks left uncounted.)

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

**Step 3's re-plan (2026-10-21) then moved:**

| delta | from → to | why |
|---|---|---|
| step 3 +16 | 14.5 → 30.5 | §16.54: phases 0-2 for §6 as written, +9.5 new; §16.56: the hand spike, +1.5; §16.55: phase 3 directly after phase 2, +5, 2 of them from step 6 |
| step 6 −2 | 7 → 5 | §16.55: its 3D half falls from 4 to 2; the 2.5D counter and ring are built in step 3's phase 3 |
| outside the steps +1 | — → 1 | §16.61: the captions' per-word fallback for Indic scripts, 0.5, new; §16.63: the two Noto fonts, 0.5, `BETA.md` R14's own half day pulled forward and counted here once, as §3.1 counted R5 (§6.20) |
| phase 4 | +6, gated | §16.56: the hand build only if the spike passes its gate; in no total above |

| step | 0 | M0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | **total** |
|---|---|---|---|---|---|---|---|---|---|---|
| before the answers | 4.5 | (2, inside 4) | 16 | 2.5 | 14.5 | 11 | 15.5 | 8 | 4.5 | **76.5** |
| after | 4.5 | 7.5 | 17.5 | 2.5 | 14.5 | 3.5 | 14 | 7 | 4.5 | **75.5** |
| after 2026-10-21 | 4.5 | 7.5 | 17.5 | 2.5 | 30.5 | 3.5 | 14 | 5 | 4.5 | **89.5** |

76.5 + (7.5 − 7.5) + 2 − 0.5 − 2 + 0.5 − 1 = 75.5. With Step P's 9.5–13
(§3a's table, 2026-10-14), 85–88.5 days.
If the Surface run fails and YuNet's decoder is built after all, add 0.5.
Then, 2026-10-21: 75.5 + (30.5 − 14.5) − (7 − 5) = 89.5; plus §6.20's 1 =
90.5. With Step P's 9.5–13, 100–103.5; with phase 4, if the spike's gate
passes, 106–109.5.

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
- **M2, step 3 (~30.5; was ~14.5 before the re-plan of 2026-10-21):**
  graphics on spoken numbers, lists, quotable lines and keywords, landing on
  their words, with sound on their beats, and 2.5D on each clip's hero
  counter or ring (a proposal of the plan's, not one of your twelve
  answers) or wherever you choose it in the dock (§6.16).
  Without P: over a link's caption track only; no `callout` and no dim
  around the speaker (both need a face box). Pointing, if phase 4 is built,
  needs P too.
- **M3, step 4 (~3.5):** Best clips from a link: three cards, each clipped
  through M0's path. Without P: YouTube's captions, centred crops, captions,
  graphics.
- **M4, step 5 (~14):** B-roll and the social quote card. No Python needed;
  without the helper, the face check that clears a picture of people cannot
  run, so every candidate that might show one asks (§8.6).
- **M5, steps 1g, 6 and 7 (~12.5: 3 + 5 + 4.5).**

4.5 + 7.5 + 17 + 30.5 + 3.5 + 14 + 12.5 = 89.5 (2026-10-21; it was 75.5
with step 3 at 14.5 and step 6 at 7). Florence-2 (1g) can slip behind M3
without blocking anything, because the salient box (1d) covers the no-face
shot until then.

**Step 3's re-plan moves step 4.** Best clips starts 16 days later than the
old order had it, 5 of them the three.js compositor that §16.55 put directly
after phase 2.

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
  `BETA.md` R1–R12 → R13 → R14 (beta.2). Steps 5–7 (about 23.5 days now) are no longer after the
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
| ten graphics fixtures with truth labels (six English, two Telugu, two Hindi), your own speech or text you wrote; since 2026-10-21 also the five nested-enumeration talks (three English, one Hindi, one Telugu) and the Hindi and Telugu strings of the 27 drawing fixtures (§6.10) | 6.5–8.5 h (was 4–6) | step 3's eval and exit |
| step 3's phase 0 runs: `__forgeGraphicCheck` in the development app's console on the Mac and the Surface for M1, M2, M3, M5, M6's Indic and colour parts and M22, and M22's sheet judged by eye beside the libass one (§6.15) | 1.5–2 h | phase 0's exit; phase 1 starts on it |
| M21: Hindi clips of yours with numbers said, through `asr.int`'s gated case | 30 min, with the clips | phase 2's counter |
| the later harness runs on both machines: phase 1's primitives and Indic check, M8, M13, M19; phase 2's templates, Indic check and M10; phase 3's M6, M7, M12 | 1.5 h | phases 1-3's exits |
| M14: the blind curve rating, six curves on your clips, for a counter, a keyword and a callout; then the blind look rating, whole graphics under the presets and restrained against energetic, with its questions (§6.10) | 2 h | phase 2's default curves; the rows of §6's "What waits" that wait on the look rating |
| M15: the audible onset frame of 30 words marked in the timeline | 45 min | whether beats need an onset refinement |
| M17: graphics, zooms and sounds per minute, counted in five clips you call pro and five from a clipper | 2 h | `GRAPHICS_PER_MINUTE` |
| M18: graphic sounds under your speech, judged by ear | 30 min | the sounds' levels and their cap |
| M20: a 1080p screen recording, and the card's legibility judged at 9:16 | 20 min | the screen card's scope |
| the hand spike's footage (§6.17): at least ten marked points each on bare hands in daylight, on hennaed hands with bangles and rings, and in low light or with motion blur (a low-light reception and a fast point among them); a held microphone, phone or bouquet; three minutes or more of natural gesturing with no point in each of those three conditions; rear-camera or DSLR clips; one 16:9 talking-head clip; two clips per condition kept back for phase 4; about 30 hand boxes marked (H3), the onset frames (H8) and one fast point's path (H5) | 5–7 h, with the filming | the spike's gate (§6.12) |
| the spike's runs (H1–H10, H12, H13) on the M1 Pro and the Surface | 2 h | the gate |
| three YouTube videos for ASR timing against Whisper, and three with unpunctuated ASR tracks (one Hindi or Telugu) | 1 h | §7.2: the unpunctuated three inside M0, the timing three by step 4's exit |
| ten links for M0 (talks and podcasts, two in Hindi or Telugu, at least one with no caption track), each with a run you select and clip | 1 h | M0's exit (§3b) |
| ten Best clips links, and rating their cards | 3 h | step 4's exit |
| the exact-cut measurement on the Surface, if CI cannot run yt-dlp (§7.1) | 30 min | §16.13, inside M0 |
| reading Pexels' licence and API guidelines in a browser (Cloudflare blocks the sandbox) | 30 min | 8.3 |
| signing up for Pexels (free) | 10 min | 8.3 |
| Clip it end to end on the Surface | 1 h | step 4's exit, the floor-machine bar |

**About 38–43 hours in all, spread over the plan** (2026-10-21: step 3's
re-plan adds about 16–18.5 hours of measurement, rating and spike rows, and
2.5 to the graphics fixtures' row; it was 19–22). Against the first draft's 19–22
on the recommended route: the X developer agreement (30 min),
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
> fourteen commits, `f39a47a` … `4dae71d`, not pushed). **Slice B built
> 2026-10-14** (P.3 with P.5; the first real install on the Mac, and rows
> 27's Mac half, 33, 34 and 35's depth half measured beside it; §3a.3's and
> §3a.5's notes, `EFFECTS.md` §58; nineteen commits, `0453abb` …
> `08984ee`). Slices A and B were pushed with `c7a2a86` on 2026-10-16;
> that push's Windows CI run (38919769393) was red on six tests, all new
> to Windows, and slice C fixes each (§3a.6's note). **Slice C built
> 2026-10-16** (P.4, P.6, P.7 and P.10, with §16.51–53 and rows 19, 35's
> asr half and 37's first run beside them; §3a.4's, §3a.6's and §3a.7's
> notes, `EFFECTS.md` §59; thirty-one code commits after `c7a2a86`,
> `aa377f9` … `1a043c9`, then the record's own, pushed together on
> 2026-10-16). **P's build is complete.
> §3a.9's exit, the clean Mac and the Surface, is the user's**, with CI's
> first run of the pack (the next push). Written from three
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
unpacked under `userData/python/<pack>/`, with the base pack's wheels (46 on
the Mac, 47 on Windows since pack 2, 2026-10-16; pack 1 had 47 and 48 with
hf-xet) installed into its own site-packages by its own pip,
**offline**, from files the app fetched itself and checked against a lock
the app ships. It is started with its own flags and a cleaned environment,
so nothing of a user's own Python reaches it. One press in Settings,
**Install the AI helper · 166 MB** on the Mac and **· 201 MB** on Windows
(pack 2; pack 1's were 170 and 205 MB) (§0's click rule: the size is on the
button before the press); a row in the
EXPORT strip with its bar and its X; a receipt that is the version; Repair
and Remove, each with its size. A packaged app never spawns a PATH Python
again: with no pack it says **Not installed**, and **no caller starts
anything**. The speech model gets its own sized press (§16.49).

**The bar, unchanged.** No step's Python half ships in an installer until P
is in it, and every Python control stays greyed "needs the AI helper" until
then, never offered as a control that changes nothing (§12).

**Exit** (in full in §3a.9). A clean Mac and the Surface, with no Python of
their own, install the pack from the app and pass the helper's tests from
inside it: `sidecar.int`'s 20, `sidecarMedia.int`'s Python cases with none
skipped, and the capability suites, started **through the pack's own
launch** (its flags and environment), with hello's `sys.prefix` and every
`sys.path` entry inside the pack or the app's `sidecar` folder. CI does the
same on every push on Windows and on a macOS 14 runner (§16.48 answered
(b), built in slice C, §3a.6). (The old text said
"the twelve helper tests"; `sidecar.int.test.ts` had 15 when this was
planned and has 20 since slice B.)

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
9.5–13, §2's total becomes 75.5 + 9.5–13 = **85–88.5 days** (since step 3's
re-plan of 2026-10-21, 90.5 + 9.5–13 = 100–103.5, §2).

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
> sizes and no compile. `formatBytes` writes GB only from 1 GiB, so it
> prints the Mac's as **"644 MB"** and Windows' as "695 MB" (this note
> first said "0.6 GB" and "0.7 GB"; corrected 2026-10-16, when the row
> showed MB on screen, `EFFECTS.md` §59); "about 0.7 GB" above holds in
> decimal GB (0.675). The Settings row shows `formatBytes` (§3a.4's note).
> **The first real install** (slice B, 2026-10-14, §3a.3's note) wrote
> 675,763,387 B apparent on the Mac, 0.11 % above the PRE-CI figure, with
> the longest path 161 and directory 107 exactly as below; the manifest
> keeps its figures until CI's install (row 28).
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
> - ~~**hf-xet** stays in the lock (3,876,287 / 4,033,128 B) until row 35
>   shows depth's and asr's downloads pass without it; then `--bump` drops
>   it and the allowlist gains `huggingface-hub: hf-xet`.~~ **Done
>   2026-10-16: pack 2**, below.
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
>   says so. *(It was pushed as it stood, with `c7a2a86`, 2026-10-16.)*
>
> **Slice C (2026-10-16): hf-xet out of the lock, pack 2** (`1a5051c`;
> `EFFECTS.md` §59). Row 35 passed on both halves: depth's on 2026-10-14,
> and asr's the day the speech model's press was built (§3a.4's note:
> 486,212,372 B in 14.7 s on a copy of pack 1 with hf-xet uninstalled).
> - `pack_lock.py` gains **`EXCLUDE = {hf-xet}`**, what the dev venv has and
>   no lock may; the allowlist gains **`huggingface-hub: hf-xet`** beside
>   mediapipe's two, and any other requirement reaching hf-xet fails the
>   walk by name. `resolved.json` gains `"excluded": ["hf-xet"]`. `EXPECTS`
>   gains `asr.model`, so the row counts **9** helper features.
> - **Its share leaves the PRE-CI figures**, measured the same two ways:
>   the Mac's 9 RECORD files, 8,152,766 B; Windows' wheel index,
>   9,805,289 B, and its 107 B of `.py` taken out of the `.py` total that
>   the estimate of pip's `.pyc` is scaled from.
> - **Pack 2**, written with `--bump --check-github` (the run without
>   `--bump` refused and wrote nothing; a second `--bump` was refused; a
>   rerun reproduced every file):
>
>   | | darwin-arm64 | win32-x64 |
>   |---|---|---|
>   | wheels | 46, 147,633,807 B | 47, 187,843,524 B |
>   | with the interpreter: the button | 174,314,305 B, **"166 MB"** | 211,071,423 B, **"201 MB"** |
>   | lock sha256 | `ed220aed…` | `ecbbec7b…` |
>   | `bytesOnDisk`, PRE-CI | 666,871,585 B, "636 MB" on screen | 718,681,542 B, "685 MB" |
>
>   Pack 1's hashes stay in `history.json`; a pack 1 on disk now reads as
>   Update.
> - **Pack 2 installed for real on the Mac** twice (the speech-model lane,
>   58.3 s; the packaging lane, 53.0 s): receipt `bytesOnDisk` 667,609,685
>   and 667,495,529 B (+0.11 % and +0.09 % on the PRE-CI figure), longest
>   path 161 and directory 107, 13,515 files, 46 dist-infos; `pip check`
>   exactly huggingface-hub's hf-xet line and mediapipe's two. The manifest
>   keeps its PRE-CI figures until CI's install (row 28).
> - Tests: `packLock` 14 and `helperPackManifest` 47 (at `1a043c9`). With
>   pack 1's five generated files put back under them, 8 fail; with
>   `asr.model` out of both `expects`, 2.

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
| macOS arm64 | `cpython-3.14.8+20261001-aarch64-apple-darwin-install_only_stripped.tar.gz` | 26,680,498 | `69e48cd7f54261df5b6abbd374f69fe6e496fa781d271592aeef49cd5ffbea6c` | 69,373,952 B of tar, measured on the pinned archive 2026-10-14 (row 26; the plan had the `20261013` build's 69,430,272 from a gzip trailer); 1,689 files, 68,060,050 B unpacked, 87,081,292 B once the standard library is compiled |
| Windows x64 | `cpython-3.14.8+20261001-x86_64-pc-windows-msvc-install_only_stripped.tar.gz` | 23,227,899 | `b7ff8b700995379e425b39abce9b087d84a45aa265ea465c0069c2747ea5b2ea` | 63,301,120 B of tar, measured likewise (the plan had 63,299,584); 2,190 files, 61,643,159 B unpacked, 70,315,292 B compiled |

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
  issue #855 kept their signatures through stripping); OpenSSL 3.5.9 built
  **into the `python3.14` executable itself** on the Mac (with `_hashlib`,
  `_sqlite3` and the system's zlib 1.2.12; not a separate `_ssl`, as this
  text first said), with `--openssldir=/private/etc/ssl`
  (`build-openssl-3.5.sh:46`), and `/private/etc/ssl/cert.pem` exists on this
  Mac (333,483 B). **Measured by row 26 (2026-10-14, `EFFECTS.md` §57):**
  both archives ship a few standard-library `.pyc` (3 on the Mac, 168 on
  Windows) and **every one is stale once unpacked**, so the install job
  compiles the standard library once (§3a.3 stage 2) and the pack's `-B`
  then costs no start time; there is **no `EXTERNALLY-MANAGED`** file and no
  `._pth`; and the Mac's `python/bin` does hold `pip`, `pip3` and `pip3.14`
  (234-byte shell trampolines), though it is `python -m pip` on both
  platforms regardless.
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
  (`python/licenses/`); `install_only` keeps CPython's `LICENSE.txt`, at
  `python/lib/python3.14/LICENSE.txt` on the Mac (13,804 B) and
  `python/LICENSE.txt` on Windows (23,601 B) (row 26). The zlib line holds
  for Windows (`zlib1.dll`); the Mac interpreter uses the system's 1.2.12.
  So the credits page carries the components' texts.

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

These are pack 1's, with hf-xet. **Pack 2** (2026-10-16, hf-xet left out,
§3a.1's note): 46 wheels and 147,633,807 B on the Mac, 174,314,305 B with
the interpreter, **166 MB**; 47 and 187,843,524 B on Windows, 211,071,423 B,
**201 MB**.

**On disk, about 0.7 GB on both** (decimal GB; pack 2's PRE-CI figures,
666,871,585 and 718,681,542 B, read "636 MB" and "685 MB" through
`formatBytes`, which writes GB only from 1 GiB).

- **The Mac, measured.** The 47 distributions' RECORD sizes in the dev venv
  are **587.9 MB** (11,629 files, 99.3 MB of them `.pyc`), 3.88× the wheel
  bytes. With the pinned interpreter's tree as row 26 unpacked and compiled
  it (87,081,292 B) that is **675,024,351 B, about 0.68 GB** (the manifest's
  pre-CI `bytesOnDisk`; this text first said ~69 MB of tar and 0.66 GB).
  The first pack the app installed (2026-10-14, §3a.3's slice B note) is
  675,763,387 B apparent and 706,039,808 B by `du`, in 13,525 files.
- **Windows, measured from the wheels' indexes** (a reviewer, 2026-10-14;
  the first draft's 0.84 GB was an estimate from the Mac's ratios and is
  withdrawn). The central directories of all 48 Windows cp314 wheels sum to
  556,756,305 B in 6,528 files, of which 4,373 are `.py` (77,229,712 B). At
  the dev venv's measured `.pyc`-to-`.py` byte ratio (1.313: 105,047,119 /
  79,995,354 B), pip's compile adds about 101 MB. That gives **about 0.66 GB
  of packages and 728,486,971 B, about 0.73 GB**, with the interpreter's
  tree as row 26 unpacked and compiled it (70,315,292 B; this text first
  counted 63.3 MB of tar).
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
  allowlist then gains `huggingface-hub: hf-xet`. **Left out since pack 2,
  2026-10-16** (`1a5051c`): both downloads passed without it, and `pip
  check` in the pack now names huggingface-hub's hf-xet beside mediapipe's
  two.
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
> - The pack's 90 s hello ceiling, until row 29 (the Mac's first start after
>   an install took 11.3–14.4 s, slice B, §3a.3's note). The reframe's
>   `helloOf` still asks hello with its own 30 s after a start that may
>   take 90.
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
>
> **Slice B (2026-10-14) closed three of these** (§3a.3's note): the job
> emits `installing` (broadcast only while no client is up);
> `restartSidecar` and the in-use record have their callers (the job's
> switch, Repair, Remove, Update and the launch sweep); and
> `FORGE_HELPER_PACK` in `tests/integration/venv.ts` reaches the pack rung
> through its own launch.

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
  offers Repair, never a 201 MB Install over 0.7 GB already on disk. One that
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
app · pack 2", "from FORGE_PYTHON <path>" or "development venv".

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

> **Built 2026-10-14 — slice B, with §3a.5.** The job installs, repairs,
> updates, removes, checks again and sweeps a pack, and the app's own job
> has installed one on this Mac from the real hosts. Nothing on screen
> presses it yet: the Settings row is §3a.4's. Not pushed (the user's
> order), so CI has not run any of it.
>
> Commits (nineteen, `0453abb` … `08984ee`):
> - the fetcher, the tar reader, the unpack with the path budget and the
>   compile: `0453abb`, `a5a8b98`, `6b12896`;
> - the self-test, pip and the check: `a6a496b`, `cf7f2ab`, `e50b992`;
> - the job's pure half and its lock, the job, its wiring: `72d6c71`,
>   `95f0d07`, `29c6a40`;
> - the real workers, the real install's test, the bar: `24bc2a0`,
>   `083fb7a`, `863f4f6`;
> - the fix phase, after three verifiers: `4b9073d` (an unpack outside the
>   version folder), `bcfc515` (Repair's two races, Remove refusing, the
>   sweep's guard), `d3c5ed3` (the host each file came from, §3a.5),
>   `d891e9c` (the Visual C++ pattern), `aa4f16b` (a web page refused, a
>   temporary name per fetch, yt-dlp's redirect pinned), `441cf9c` (pip's
>   cancel), `08984ee` (the bar on a retried file).
>
> Every number below is in `EFFECTS.md` §58, with its command.
>
> **The job** is `createHelperPackJobs` in `src/main/sidecar/install.ts`,
> with its pure half (stages, wording, free space, what is left, the IPC
> payloads, `sweepPlan`) in `src/shared/sidecar/install.ts` and its
> contracts in `installTypes.ts`. It returns `{queue, install, remove,
> checkAgain, sweep, cancel, clearFinished, busy, quit}`. The workers come
> in through `src/main/sidecar/installDeps.ts`: `helperWorkers()` is
> `fetchVerified`, `unpackTarGz`, `compileStdlib`, `runPip` and `checkPack`
> with `FETCH_RETRY`, every rename goes through `renameWithRetry`, and
> `index.ts` hands them to `registerIpc`.
>
> **Stage 0, Checking**, in this order:
> 1. the platform (`packPlatform`'s reason refuses);
> 2. the lock;
> 3. for a Repair or an Update, the other windows' in-use records;
> 4. Windows' path budget, before anything is fetched
>    (`src/shared/sidecar/pathBudget.ts`: the root with one separator +
>    `longestPath` + 16 ≤ 259 and root + `longestDir` ≤ 247, else a
>    sentence naming the root, the count and the limit and pointing at
>    `FORGE_PYTHON`), handed to the unpacker again;
> 5. free space: `statfs` `bavail × bsize` on userData against
>    ceil((left to fetch + `bytesOnDisk`) × 1.1), "The AI helper needs
>    0.8 GB free on C: (0.3 GB is free)" ("this disk" off Windows);
> 6. a folder of this number with no receipt, deleted.
>
> **Stage 1, Downloading** (`src/main/net/fetchFile.ts`). `binary.ts`'s
> retry machinery is lifted out and imported back. yt-dlp's fetch is
> unchanged word for word: its "GitHub" is now an argument (`naming: {who:
> 'GitHub'}`), and its redirect `'follow'` is pinned by a test.
> `fetchVerified` streams each file to `<name>.<pid>.<8 hex>.part` through
> a sha256 and a byte count, one file at a time, the interpreter first.
> Each file has one `Fetching` with its own budget. The job's signal goes
> into every request, and a cancel also stops the body reader. Its table,
> as built:
>
> | what arrived | what happens |
> |---|---|
> | a `Content-Type` of `text/html` | not the file, judged before the body, no retry: "something other than the file arrived from <host> (a sign-in page or a network filter?): <name> came back as a web page (<type>)" |
> | a `Content-Length` other than `bytes`, with no `Content-Encoding` (or `identity`) | the same sentence ending "<name> is N B and the answer said M", no retry |
> | a body short of `bytes` | dropped and retried |
> | a body past `bytes` | aborted at once, no retry |
> | exactly `bytes`, another sha256 | fails on the first fetch: "<name> from <host> did not match its published checksum (… vs …). Nothing was installed from it." |
> | exactly `bytes`, the sha256 | renamed into place; the log gets "<name> came from <host>: N B, its sha256 verified" |
>
> - Redirects are followed by hand (at most 10, https only, one answer wait
>   over every hop), so each sentence names the host that failed after
>   them.
> - After the retries, every failure but a checksum carries §3a.5's way out.
> - A file already there with its hash is skipped unfetched; one with
>   another hash is fetched again.
> - `renameWithRetry` is win32 only, for `EPERM`, `EACCES` and `EBUSY`: 10
>   tries, 50 ms doubling to a 2 s cap, 9.15 s in all; elsewhere, one try.
>   graceful-fs's 60 s bounds an unattended `npm install`; this rename runs
>   49 times under a bar someone is watching, and 10 s outlasts an
>   on-access scan of a just-closed file. Unmeasured until the Surface
>   (row 27).
>
> **Stage 2, Unpacking.** `TarStream` (`@shared/assets/tar.ts`, beside
> `readTar`, which is unchanged) is a push parser. It reads PAX
> `path`/`linkpath` (`x` and `g`), GNU `L` and `K`, and the ustar prefix
> under POSIX magic only. It refuses hard links, devices, FIFOs, sparse
> members, unknown types and records over 1 MiB. A symlink is accepted only
> when its target, resolved from its own folder, stays inside the root, and
> three rules go beyond the plan:
> - `..` only as the target's leading run;
> - never a link to its own folder or to one above it;
> - no member at or under an earlier link, names compared folded (NFC, then
>   case), because APFS and NTFS fold.
>
> `unpackTarGz` (`src/main/sidecar/unpack.ts`) streams `createGunzip` into
> it, so neither the archive nor its tar is held. It makes each member's
> parent folders (the archives have no folder entries), checking by
> `realpath` that each lands inside the root before it is made; opens files
> `wx`; restores 0755 from any x bit on POSIX; makes the Mac's links;
> refuses a link on Windows by name; and reads the signal between members.
> Row 26's facts are honoured: on the real archives it writes tar's tree
> exactly (the Mac's 1,689 files, 9 links, 160 folders and 19 executables;
> Windows', unpacked on the Mac as data, 2,190 files), and the interpreter
> it writes runs `import ssl, sqlite3`. Then `compileStdlib`
> (`src/main/sidecar/compile.ts`): `<python> -I -m compileall -q -j 1
> <stdlib>`, `windowsHide`, the pack's environment, the signal killing the
> child.
>
> **Stage 3, Installing the libraries** (`src/main/sidecar/pip.ts`,
> `runPip`): the command below, flag for flag, with the downloads folder as
> its cwd (`-m` puts the cwd first on `sys.path`).
> - The bar is the count of `*.dist-info` folders pip added (any there
>   before are not counted), polled every 500 ms against the lock's 47
>   package lines and held at its high-water mark. The speed column says
>   "installing libraries · N of 47"; pip's last line goes to the log.
> - Cancel is `taskkill /pid <pid> /f /t` on Windows (a non-zero exit is
>   followed by a SIGKILL) and SIGKILL elsewhere. It settles as cancelled
>   after 10 s at the latest, whatever the kill did.
> - A failure keeps pip's last 40 lines and is worded: the antivirus
>   sentence below for "Failed to write executable", otherwise "pip could
>   not install the libraries (exit N): <pip's last ERROR: line>".
>
> **Stage 4, Checking** (`src/main/sidecar/check.ts`, `checkPack`):
> - one `SidecarClient` started as the service starts the pack (cwd
>   `sidecarDir()`, `maxRestarts: 0`, the pack rung's 90 s hello read from
>   `helloTimeoutFor`);
> - executable, prefix and every `sys.path` entry inside the version folder
>   or `sidecarDir()`, by `path.relative` on `realpathSync.native` paths (a
>   path not on disk, `python314.zip`, through its longest existing
>   ancestor; `''` is the cwd, `sidecarDir()`);
> - `python` 3.14.8, and `expects` ⊆ capabilities;
> - one ping, then `system.selftest` with a 390 s transport ceiling (6 ×
>   60 s + 30 s).
>
> The client is stopped, and its exit awaited, before the check settles.
> Degraded methods and failed groups are results, not rejections; only a
> helper that does not start or answer rejects.
>
> **`system.selftest`** (`sidecar/forge_sidecar/selftest.py`, registered in
> `capabilities/system.py`) takes `{groups?}` and answers `{<group>: {exit,
> ms, error}}`.
> - Each group runs in its own `<sys.executable> -E -s -B -c <source>`
>   child, one after another, with `CREATE_NO_WINDOW` on Windows.
> - 60 s each; past it the child is killed and the group answers exit −1,
>   "timed out after 60 s". A cancel is seen every 0.1 s and kills the
>   child.
> - A progress line goes out per group ("checking beats · 2 of 6").
> - The groups are the table below, each child's source on one line. onnx's
>   model is `forge_sidecar/selftest/identity.onnx`, 80 B.
> - The faces group is the worker's own `{"mode": "import"}` run. Its
>   `_mediapipe()` now calls `mediapipe_c_bindings.load_raw_library()` in
>   both modes (0.068 s, no model, no Metal), so `ready` means the library
>   is loaded. `FORGE_FACES_WORKER_FAKE` is removed from its environment.
> - On Windows a group's line becomes the Visual C++ sentence only for the
>   loader's own words: "DLL load failed", "The specified module could not
>   be found", WinError 126 and 193, and ctypes' "Could not find module …
>   (or one of its dependencies)", which is how `libmediapipe.dll` fails. An
>   ImportError that merely names a `.pyd` is worded as itself.
>
> **The receipt** is written last as `pack.json.part` and renamed through
> `renameWithRetry`; a refused rename fails the job (no in-place write). It
> records `hello`, the self-test record for the pack's own platform,
> `problems` when the check found any (a field beyond §3a.2's type, which
> `parseReceipt` ignores) and `bytesOnDisk`. That is now an apparent-bytes
> walk of the whole version folder after pip, with the manifest's figure
> only if the walk fails. Then older numbers go by the sweep's rules,
> `downloads/` is removed (§16.47), the lock is released, and the switch
> waits for idle ("waiting for the AI helper's work to finish",
> cancellable) and restarts.
>
> **The lock** (`src/main/sidecar/lock.ts`) is `<root>/.lock`, created
> `O_CREAT | O_EXCL | O_WRONLY`, holding `{pid, startedAt}`.
> - A live other pid refuses: "The AI helper is in use by another Forge
>   window".
> - A dead pid, or this process's own pid when this process does not hold
>   the lock (pid reuse), is taken over.
> - An empty or torn lock younger than 10 s counts as held.
> - In one process a second taker is refused ("The AI helper is already
>   being installed, repaired or removed"). Its key is reserved before the
>   first await, which closed a same-tick race a mutation found.
> - `release` unlinks only a lock that still names this call;
>   `readInUse` drops a dead pid's record. The service writes
>   `in-use/<pid>` as slice A built it; Repair, Update and Remove read it.
>
> **The launch sweep** is `sweepPlan` run under the lock by `runLaunchSweep`,
> on its own root only, just before `startSidecar` and not awaited. It
> follows the four rules below, and removes nothing while any window, this
> one included, holds the lock.
>
> **Repair**, asserted as one ordered shape: every file verified → idle →
> hold → stop → unlink the receipt → remove the tree → unpack → compile →
> pip → check → receipt → release → restart.
> - Before the hold it waits for idle in a loop. On each turn it reads the
>   other windows' in-use records again (a window may have started from the
>   pack during the download: Repair then refuses, and the downloads stay)
>   and asks `busy()` again, so the hold and the stop follow the last check
>   with no await between.
> - The hold (`helperControl.hold`) makes every `getSidecar` caller throw
>   "The AI helper is being repaired" ("…being updated" for an Update into
>   the same folder) and spawns nothing.
> - A fetch that fails leaves the old receipt and folder untouched; a
>   failure after the delete keeps the downloads, so the next Repair is
>   offline; a helper the job stopped is restarted whatever happens.
>
> **Remove** (`remove({models})`) takes the lock. With no numbered folder it
> removes the empty root (and `models/` if asked) and leaves the helper
> alone. Otherwise it reads the in-use records, **refuses while helper work
> runs** ("The AI helper is working; remove it once that work has
> finished"), and then, in the same tick: hold → stop → every receipt → the
> root → `models/` only when asked → release → restart.
>
> **Update** is read from disk at the press: an older number's receipt, or
> one that parses and does not match. Into a new number it neither holds
> nor stops, and the old folder goes by the sweep's rule after the new
> receipt, or at the next launch if this window still runs it.
>
> **Check again** (`checkAgain()`) takes the lock, reads the receipt (it
> must parse and match), runs the check alone, and rewrites `hello`,
> `selftest` and `problems` by the rename rule (`installedAt` kept). Then
> it restarts the helper, so the record reaches `ready` and a fresh process
> loads whatever was installed meanwhile.
>
> **The service, the IPC and the row.**
> - `service.ts` lends the job `helperControl` (`busy`, `whenIdle`, `stop`,
>   `hold`, `restart`). `readyStatus` merges the receipt's failed groups
>   into `hello.degraded` and carries the record as `selftest`.
>   `installing` is broadcast only while no client is up, and
>   `settleHelperStatus` re-broadcasts what is on disk when a job ends.
>   Offers carry `bytesLeft`.
> - `ipc.ts` puts the queue in the job list, `render:cancel` and
>   `jobs:clearFinished`, beside `helper:install`, `helper:remove` and
>   `helper:checkAgain` (the preload's `installHelper`, `removeHelper` and
>   `checkHelperAgain`; the harness bridge has `unsupported` stubs).
>   `before-quit` cancels and releases the lock synchronously
>   (`quitHelperJobs`).
> - The EXPORT row (`ExportStrip.tsx` `jobName`) reads "Installing the AI
>   helper" (or Repairing, Updating), cancellable while queued, with no Show
>   in folder.
>
> **The first real install** (2026-10-14, the M1 Pro in the dev sandbox:
> `FORGE_PACK_REAL=1 NODE_USE_ENV_PROXY=1 … npx vitest run
> tests/integration/helperPack.int.test.ts`, the app's own job on the real
> workers and hosts, into a userData under "Forge Bräutigam"; every
> assertion green):
>
> | stage | the first run, every file fetched | after the fix phase, 45 of 48 seeded |
> |---|---|---|
> | Checking | 2 ms | 4 ms |
> | Downloading | 6,032 ms: 178,190,592 B at 28.17 MiB/s | 1,306 ms: 3 files, 26,698,907 B |
> | Unpacking | 2,760 ms: unpack 467, compile 2,293 | 2,679 ms: unpack 470, compile 2,209 |
> | Installing the libraries | 11,396 ms | 11,353 ms |
> | Checking the AI helper | 36,992 ms | 36,582 ms |
> | **the job** | **57,183 ms** | **51,927 ms** |
>
> - **The check is cold.** The new pack's first hello took 11,348 ms
>   (11.3–14.4 s over four installs). The self-test took asr 209, beats
>   21,096, onnx 108, vision 285, sklearn 1,768 and faces 1,460 ms, every
>   group exit 0, faces without Metal. Warm, on the installed pack, hello is
>   0.27 s and the self-test 2.3 s (beats 0.9 s). The cold time is the
>   first load of each new native file: `-X importtime` on a fresh copy took
>   14.09 s real against 1.06 s of CPU, av alone 10.8 s, and 0.91 s the
>   second time. Its cause past that is not established.
> - **The receipt**: `bytesOnDisk` 675,763,387 B apparent (the manifest's
>   PRE-CI 675,024,351, +0.11 %), `du` 706,039,808 B; the longest path 161
>   and directory 107, as the manifest says; 13,525 files, 1,446 folders.
>   The peak use, about 884 MB, sat under `spaceNeeded`'s 938,536,438 B.
> - The interpreter "came from release-assets.githubusercontent.com"; `pip
>   check` names only mediapipe's two.
> - Through the installed pack (`FORGE_HELPER_PACK`), §3a.9's suites passed
>   with no new skip: `sidecar.int` 20, `sidecarMedia.int`'s 132 Python
>   tests none skipped, `vision.int` 7, `beats.int` 13, `faces.int` 13 (+2
>   opt-in skips), `reframeJob.int` 13 (+1).
>
> **Where it differs from the text below:**
> - **The bar's weights are 45 / 5 / 15 / 35** (downloading, unpacking,
>   installing, checking), not 70 / 5 / 20 / 5. The placeholders held the
>   bar at 95 % for 37 of the install's 57 s. The new weights come from
>   this install at the table's 4.2 MB/s example line (a 40 s download of
>   about 92 s), and the check now reports its own progress (0.35 after
>   hello and the ping, then each group). The Surface's row 27 may move
>   them.
> - **The module is `install.ts`, not `pack.ts`, and has no `status()`**:
>   the status is `sidecar:status`'s. It adds `sweep`, `cancel`,
>   `clearFinished`, `busy` and `quit`.
> - **Remove refuses while helper work runs** and never waits, as the
>   section's last line says ("All three refuse"). Repair keeps its own
>   "wait until idle", since its job has an X. The text said both.
> - **The speed column during pip** is the table's "installing libraries ·
>   12 of 48", not pip's last line; row 34 found all 47 "Processing" lines
>   within 0.25 s, so the line would carry little.
> - **After a pack that does not start**, its folder is removed (receipt
>   first) and the order reads `absent`, so the offer is Install · 0 MB
>   left, not Repair. That press is a Repair in all but name (offline, from
>   the kept downloads); only `Job.error` says the helper did not start.
> - **The temporary name** is `<name>.<pid>.<8 hex>.part`, the rule of
>   `ensureYtDlp`'s `.download`; clean-up goes by the suffix.
> - **A `text/html` answer is a row the table lacked.** Under a
>   `Content-Encoding` the `Content-Length` counts encoded bytes and is not
>   compared, so a gzip-encoded filter page read as a short body and was
>   fetched four times. Both hosts answer `application/octet-stream` with
>   no encoding (measured).
> - **Repair and Update refuse while another window has any pack of the
>   root in use**, not only this one; one build runs one number.
> - **The face worker loads mediapipe's library in both modes**, not only
>   the import-only run, and the plan's `importOnly` is the worker's
>   existing `mode: "import"`.
> - **`unpackTarGz` takes `budget` and `platform`** beyond the contract;
>   `installTypes.ts` gained `budget`, `onTry` and the check's
>   `onProgress`, all optional.
> - **`venv.ts`'s guard fails a suite whenever `FORGE_HELPER_PACK` names a
>   pack that does not run**, under CI or not, and the variable takes a
>   version folder or a userData. `helperPack.int` stays opt-in
>   (`FORGE_PACK_REAL=1`) under CI too, until CI installs the pack (§3a.6).
> - **The compiled `.pyc` carry their source's absolute path**, about
>   1,052 B per character of the install root (18,965,516 B under a
>   40-character root against §57's 19,043,394 B under 114), so
>   `bytesOnDisk` depends on the user's userData path.
>
> **Tests** (run to a file at `08984ee` by the recorder, exit 0: 283 passed
> and 11 skipped in 18 files): `fetchFile` 20, `tarStream` 20, `unpack` 20
> (its real-archive cases ran: row 26's archives are on this Mac),
> `pathBudget` 7, `pipStage` 12, `packCheck` 18, `helperPackJob` 40,
> `helperLock` 12, `installStages` 18, `sidecarService` 36, `helperIpc` 4,
> `installDeps` 5, `renderer/helperJobRow` 3, `helperPython` 28,
> `ytdlpBinary` 19, `sidecar.int` 20, `sidecarMedia.int` 1 (its 132 Python
> tests), and `helperPack.int`'s 11, skipped without `FORGE_PACK_REAL`
> (all 11 passed in the fix phase's real install). And
> `tests/sidecar/test_selftest.py`, 25, OK.
>
> **Mutations**, each anchor counted at one match first, each file restored
> and compared byte for byte:
> - the fetcher, reader and unpack lane's 38 (the fetcher 13, yt-dlp's
>   wording 1, the reader 9, the unpack, compile and budget 15);
> - the self-test, pip and check lane's 29 (12, 6 and 11). pip's "folders
>   already there counted" survived until its test was given a total above
>   what pip adds;
> - the job lane's 73. Two survivors, Remove's own busy check and a second
>   `.part` clean-up, were redundant layers, removed so each guard is
>   tested alone;
> - the integration's 16, four of them whole installs: without librosa,
>   without mediapipe, without idna (for the `pip check` assertion), and
>   `-s` dropped with a planted user site;
> - the verifiers' 22. One survived every committed test (a torn receipt
>   below the current number, in `sweepPlan`) and is now guarded;
> - the fix phase's 33 runs. Three were checks, not kills: a second
>   per-member `realpath` check that nothing could fail was removed; the
>   verifier's hold-first Repair passes the race tests by design; and one
>   race test was rebuilt so its next request is registered on the first.
>
> **Left:**
> - **The UI** (§3a.4, slice C). Nothing presses Install yet. Also there:
>   the Settings row's states and sized buttons; `helperCan`, which must
>   read the status's merged `degraded`, not `getSidecar().info` (the
>   reframe's `helloOf` does not see a failed group); the pointers, the
>   census, and harness stubs that walk the states. While a `FORGE_PYTHON`
>   or venv helper runs, `installing` is not broadcast, so the row reads the
>   job list then.
> - **CI's install** (§3a.6, rows 28 and 37), on Windows and `macos-14`,
>   with the URL probe, the native-import listing and the cache.
> - **`net.fetch`** (row 19): the job uses Node's fetch, which ignores a
>   proxy unless `NODE_USE_ENV_PROXY=1`, and the app does not set it
>   (§3a.5's note).
> - **The Surface**: row 27 (Defender's share, the rename retries against
>   9.15 s, the weights), row 29 (the cold hello against 90 s), row 30 (the
>   faces group's ctypes line comes from CPython's source, not a clean
>   machine), row 32 (`taskkill /f /t` on pip and the compile), and the
>   8.3-name `realpath`.
> - **asr's half of row 35** waits for the speech model's press (§3a.4).
> - **A cancel during the final switch** leaves the pack installed (receipt
>   written) and the job reading Cancelled; P-C may word it. *(Not worded
>   in slice C.)*
>
> **Slice C (2026-10-16) closed** the UI (§3a.4's note), CI's steps (§3a.6's
> note; their first run is the next push), row 19's Electron half (the
> pack's fetch inside the app is `net.request`, §3a.5's note) and asr's half
> of row 35. The check's speed column now opens on "checking the AI helper
> · starting (the first start is slow)" and names each self-test group as
> it starts ("checking the AI helper · beats"), through
> `PackCheckOptions.onGroup` (`a1aaf0e`). The Surface's rows stay open.
>
> **Open, for the user** (none was built in slice B; **answered 2026-10-16
> as §16.51–53, each as recommended, built in slice C**: `a3958bf`,
> `c996f80` with `3e90349` for CI, and `a1aaf0e`; what each does is in
> §16.51–53):
> - An install whose check finds a `sys.path` entry outside the pack, or a
>   Python other than 3.14.8, reads Done: the problem is only logged and
>   kept in the receipt's `problems` (the user-site mutation reached such a
>   receipt). → §16.51: keep the pack, mark the receipt, the row shows the
>   warning with Repair.
> - numba writes 38 cache files (1,190,255 B) into the installed pack's
>   librosa folders on the first real beats pass; the self-test writes none.
>   → §16.52: `NUMBA_CACHE_DIR` under `helper-cache`.
> - Two windows that find the same stale lock within the same milliseconds
>   can both take it over, and a window can still spawn from the pack in
>   the moment between Repair's or Remove's last in-use read and the stop.
>   → §16.53: every pack start consults the lock first; the takeover
>   re-reads after writing.

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
  job, a 201 MB install slower than about 0.6 MB/s passes minute 6 part-way,
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
them, as the reframe's 0–15 / 15–85 / 85–100 were. **The first measured
install set them on 2026-10-14** (`863f4f6`, the Mac's row 27, `EFFECTS.md`
§58): the check took 37 of 57 s, and the placeholders held the bar at 95 %
through it. The planned weight is kept in brackets.

| stage | bar | the speed column says |
|---|---|---|
| 0. **Checking** | 0 % | "checking space": `fs.statfs` on userData covers what is left to fetch, `bytesOnDisk` and 10 %, or the job fails "needs N GB free on <drive>"; on Windows root + `longestPath` + 16 ≤ 259 and root + `longestDir` ≤ 247, or it fails naming the path; the platform is supported; the lock is taken |
| 1. **Downloading** | 0–45 % (planned 0–70 %), by bytes over every file | "downloading · 31 of 201 MB · 4.2 MB/s" |
| 2. **Unpacking** the interpreter | 45–50 % (70–75 %) | "unpacking Python" |
| 3. **Installing the libraries** | 50–65 % (75–95 %) | "installing libraries · 12 of 47" |
| 4. **Checking** the AI helper | 65–100 % (95–100 %), moved by the check's own progress | "checking the AI helper · starting (the first start is slow)", then "checking the AI helper" and "checking the AI helper · <group>" as each self-test group starts (since `a1aaf0e`), or "waiting for the AI helper's work to finish" |

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
says so (§3a.8 row 33). (Row 33, measured 2026-10-14: both hosts answer
206 with a `Content-Range`, and github.com's signed redirect expires 40
minutes after it is issued, so a resume would ask github.com again.) Files
go one at a time in P; parallel only if the measured time asks for it.

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
Then, in this stage, right after the unpack and before pip:

- **the standard library compiled once**, so `-B` costs no start time.
  Row 26 settled it (2026-10-14, `EFFECTS.md` §57): every `.pyc` either
  archive ships is **stale** once unpacked, on both platforms, so the step
  is unconditional. The one command, the measured one, is `<python> -I -m
  compileall -q -j 1 <stdlib>` with `<stdlib>` = `python/lib/python3.14` on
  the Mac and `python\Lib` on Windows (2.22 s on the Mac, 1,059 `.pyc`;
  2.03 s for Windows' tree compiled on the Mac). `-j 0` failed in the dev
  sandbox on `SC_SEM_NSEMS_MAX`, so it is `-j 1` unless measured outside
  it. `--invalidation-mode unchecked-hash` would free the `.pyc` from the
  unpacked mtimes; an option, unmeasured. The manifest's pre-CI
  `bytesOnDisk` already counts this compile (`4dae71d`). It has no bar
  weight of its own: two seconds inside the unpack's share;
- **on the Mac, the quarantine stripped**, only if row 31 says so: (`/usr/bin/xattr -dr
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
writes the dist-info folders one package at a time is §3a.8 row 34 (it
does, measured 2026-10-14; the speed column as built is the table's count,
and pip's line goes to the log). Cancel
kills pip's tree (`taskkill /f /t` on Windows, the shot finder's precedent,
§15 row 23). `--no-compile` would save 99.3 MB and the compile time at the
cost of the first start; measured before it is chosen (§3a.8 row 27).
**Measured 2026-10-14 on the Mac** (`EFFECTS.md` §58): it saves 109.3 MB
and 9.3 s of pip, once, and costs 0.29 s at every later start (550 against
263 ms), since `-B` never writes the `.pyc`. Not taken: pip compiles.

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

- `system.hello` within the client's own pack-rung timeout
  (`PACK_HELLO_TIMEOUT_MS`, `client.ts`: **90 s** as a placeholder since
  slice A, the same number the service waits), to be set from row 29's
  measured cold start plus a margin once it is in (the first cold start
  after Defender has scanned the fresh `.pyd` and `.dll` files; on the Mac
  the first start after an install took 11.3–14.4 s over four installs,
  2026-10-14, so 90 s has about 6× margin there); the
  self-test and the service must never disagree on it, so the job reads
  the constant rather than carrying its own;
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

Then the quarantine step if row 31 asked for it (the standard library was
compiled in stage 2, before pip),
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

> **Built 2026-10-16 — slice C, with §3a.6, §3a.7 and §16.51–53.** Not
> pushed when this was written.
>
> Commits:
> - the gate and the row: `be3ae1b` (`helperCan.ts`, `row.ts`,
>   `reframeHelperFrom` over `helperCan`);
> - the window: `bd2264a` (the store keeps the status whole; App's dot and
>   Settings' row from one reading; the Media pool's and the URL tile's
>   gates), `00e431b` (the pointers; EXPORT's speed column wraps);
> - the speech model: `739fa55` (`asr.py` pinned, `asr.model`), `93c6bde`
>   (main's channel and the preload);
> - main's half: `a3958bf` (§16.51), `a1aaf0e` (§16.53, the Group Policy
>   sentence, the check's speed column);
> - the harness and the census: `e3221d3` (§3a.7's note);
> - the fix phase, after three verifiers: `d8f714e` (asr's self-test group
>   takes both its methods), `ae2be28` (a model gone from disk is asked
>   about again), `33ee0ff` (the Transcript tile's Transcribe gated),
>   `d2e939e` (the fallback bridge), `dca719c` (Remove's two sizes),
>   `e43d967` (Repair's bytes left), `27aa661` (the speech press's X),
>   `016f470` (the model presses' network sentence), `0537c12` (hosts under
>   a failed pack's Repair), `a5b58de` (`helperRowFrom` removed), `1a043c9`
>   (census rows).
>
> Every number below is in `EFFECTS.md` §59, with its command.
>
> **`helperCan(status, method)`** (`src/shared/sidecar/helperCan.ts`) is
> true only for `ready`, with the method in `hello.capabilities`, not in
> `hello.degraded` (where main merges a failed self-test group), and not
> failed by the self-test record. `reframeHelperFrom` is a mapping over it
> for `vision.faces` and `vision.facesModel`: `starting` is unknown, any
> other state but ready (an install included) is missing. A pack whose
> faces group failed its self-test used to read as able to find a face; it
> reads missing now. `SELFTEST_GROUPS.asr` names both `asr.transcribe` and
> `asr.model` (`d8f714e`): both stand on one faster-whisper import.
>
> **The row** (`src/shared/sidecar/row.ts` `helperRow({status, pack, job})`)
> is one reading, drawn by Settings' `HelperSection` and by the header
> gear's dot (`useHelperRow`), so they cannot disagree. The store's
> `sidecarReady` and `sidecarError` are gone: it keeps `helperStatus`,
> `helperJob`, `helperUi`, `speechModel`, `speechFetch` and
> `settingsFocus`. `status.ts` `helperRowFrom` is removed (`a5b58de`). As
> built, with the Mac's pack 2 (Windows' sizes are 201 MB and 685 MB):
>
> | state | dot | the row: word · line | presses | under them |
> |---|---|---|---|---|
> | no status yet, or `starting` | grey | Starting (· "installed by the app · pack 2" once the source is known) | — | — |
> | `installing` | grey | Installing · <stage> | — | "Its bar and its X are in EXPORT." |
> | a helper job in the list (wins over the status) | grey | Installing / Repairing / Updating · <the job's speed>, "waiting to start" while queued | the status's own, each disabled with the title "Repairing the AI helper — its bar and its X are in EXPORT" | "Its bar and its X are in EXPORT." |
> | `absent`, install | grey | Not installed | Install the AI helper · 166 MB, or · 141 MB left after a cancel | the hosts sentence |
> | `absent`, update | grey | Needs an update | Update the AI helper · 166 MB | "The AI helper on this computer is from an older version of the app, and is not used until it is updated." and the hosts sentence |
> | `absent`, unsupported | grey | Not available on this computer · The AI helper needs macOS 14 or later | — | — |
> | `damaged` | red | Not running · Python is missing from the AI helper's folder (removed by antivirus?) | Repair · 166 MB, Remove | the hosts sentence |
> | `failed`, a pack (Group Policy, keeps crashing) | red | Not running · <the sentence> | Repair · <bytes left, or 166 MB>, Remove | the hosts sentence (`0537c12`) |
> | `failed`, another window holds the lock (§16.53) | grey | Not running · The AI helper is being repaired by another Forge window | — | — |
> | `failed`, `FORGE_PYTHON` | red | Not running · <error> | Install the AI helper · 166 MB | "used instead of FORGE_PYTHON once installed" and the hosts sentence |
> | `failed`, the venv, PATH, or no source | red | Not running · <error> | — | — |
> | `ready`, a whole pack | green | Running · Python 3.14.8 · pack 2 · 636 MB | Repair · <bytes left, or 166 MB>, Remove | — |
> | `ready`, a short pack | grey | Running · 8 of 9 helper features · beats needs Microsoft's Visual C++ runtime | Check again, Repair, Remove | each reason once; the Visual C++ sentence whole, its link pressable |
> | `ready`, integrity problems (§16.51) | grey | Running · <ok> of 9 helper features · <the first problem> | Repair, Remove | each problem, then each reason, and the hosts sentence |
> | `ready`, `FORGE_PYTHON` | green only when whole | Running · from FORGE_PYTHON <path> · N of 9 helper features | Install the AI helper · 166 MB | the reasons, "used instead of FORGE_PYTHON once installed", the hosts sentence |
> | `ready`, the venv or PATH | green only when whole | Running · development venv (or "python3 on PATH"), with "· N of 9 helper features" when short | — | the reasons |
>
> - **The hosts sentence** is "Uses about 636 MB on disk. Downloads from
>   github.com (and the host it redirects to, today
>   release-assets.githubusercontent.com) and files.pythonhosted.org. Its
>   own Python; any Python on this machine is left alone." Under any
>   running helper, also §16.40 (d)'s sentence for the beta (`016f470`):
>   "Each model downloads on its own press, from huggingface.co and
>   *.hf.co, or storage.googleapis.com for the face finder. Those presses
>   need a direct connection, or a proxy set in HTTPS_PROXY."
> - **Whole** means every `expects` method registered, none degraded or
>   failed by the self-test, every self-test group ok and no integrity
>   problem. The count is out of `expects.length`, 9 since pack 2. A short
>   pack's reasons go in `expects` order (hello's degraded reason, the
>   self-test's, or "the AI helper has no <method>"), then any failed group
>   with no method of its own (sklearn). The line carries the Visual C++
>   reason's head only.
> - **Every size goes through `formatBytes`**, none is written: Install is
>   the offer's bytes, or its `bytesLeft` with "left" when fewer; Repair
>   beside a ready or failed pack is the status's optional `bytesLeft` when
>   main has it (`service.ts` `withRepairLeft`, set only while verified
>   downloads sit in `downloads/<n>/`, and said again by
>   `settleHelperStatus` when a job ends beside a running helper,
>   `e43d967`), else the manifest's bytes; the size on disk is the
>   manifest's `bytesOnDisk`, still PRE-CI.
> - **The presses** go through the store: Install is `installHelper({})`,
>   Repair `{repair: true}`, Update `{update: true}`, Check again
>   `checkHelperAgain()`. Each reads "Starting the install…", "Starting the
>   repair…", "Starting the update…", "Removing…" or "Checking…" while it
>   runs, every other press disabled. A refusal shows in red without
>   Electron's "Error invoking remote method '<channel>': Error: " prefix
>   (its shape read in `electron.d.ts`, not measured).
> - **Remove asks first**: "Remove the AI helper? It frees about 636 MB.",
>   a box, off by default, "also remove the downloaded models · 464 MB"
>   (the size from main's `HelperPackJobs.modelsBytes()`, the apparent
>   bytes of `userData/models`, over `helper:modelsBytes` and the preload's
>   `helperModelsBytes()`, shown only above 0, `dca719c`), then "Remove it"
>   and "Keep it". It sends `{models}` as the box was left.
> - **The pointers** (§16.41): `HelperPointer` (`SettingsPanel.tsx`), a
>   small dotted-underline button reading "needs the AI helper", titled
>   "install it in Settings", which calls `openSettingsAt('helper')`:
>   Settings opens with the row scrolled into view, the card the Director's
>   gear opens. In the Trimmer dock under Follow the subject
>   (`ReframePanel.tsx`), in the canvas bar's reframe chip (`CanvasBar.tsx`),
>   beside a greyed Listen to it on a link with no captions
>   (`LinkTranscript.tsx`), and under the Transcript tile's Transcribe.
>   While the helper starts each says "the AI helper is starting" instead.
>   The Media pool's Transcribe icon has no room: its title is "needs the AI
>   helper — install it in Settings". The renderer's one `installHelper`
>   call is the Settings press; there is no first-run prompt.
> - **Transcribe and Listen to it** (`transcribeGate`): ready only with
>   `helperCan(status, 'asr.transcribe')` and the speech model on disk.
>   Otherwise the Media pool's Transcribe and the Transcript tile's
>   (`33ee0ff`; it was pressable on any helper before) are greyed with
>   "needs the AI helper — install it in Settings", "needs the speech
>   model" or "the AI helper is starting". With the model missing, a bar
>   over the pool (shown while it holds a video or a sound) and the
>   Transcript tile read "Transcribe needs the speech model" with the sized
>   press. Listen to it stays the disabled "soon", said only when both hold.
>   A Transcribe rejected with the helper's own sentence,
>   `SPEECH_MODEL_NOT_DOWNLOADED`, resets the store's `speechModel`, so the
>   press comes back (`ae2be28`).
>
> **The speech model's own press** (§16.49 (a)):
> - `asr.py` pins `Systran/faster-whisper-small` at commit
>   **`536b0662742c02347bc0e980a01041f333bce120`** (read from
>   huggingface.co's API 2026-10-16), and only the four files WhisperModel
>   reads: `config.json` 2,370 B, `vocabulary.txt` 459,861,
>   `tokenizer.json` 2,203,239 and `model.bin` 483,546,902 (LFS sha256
>   `3e305921…d671`), **486,212,372 B, "464 MB"**.
> - Presence is `try_to_load_from_cache` at the commit for every file, in
>   one snapshot folder; the load is `WhisperModel(<snapshot folder>,
>   device='cpu', compute_type, local_files_only=True)`.
> - **`asr.transcribe` never downloads.** Without the model it answers
>   Unavailable, "The speech model is not downloaded yet"; a `model` other
>   than `small` is refused (nothing in the app sends one).
> - **`asr.model`** answers `{present, bytes, label, host}` and fetches only
>   when `download` is exactly `true`, each file through `media.download` at
>   the pinned revision. `capabilities/__init__.py`'s asr tuple names both
>   methods.
> - Main's `asr:model` (`speechModelRequest`): the status ask has 30 s, the
>   fetch none of its own (huggingface_hub's 10 s read timeout bounds it);
>   two presses share one fetch; with no helper it rejects without a
>   spawn. Progress is `asr:modelProgress`; the X is `asr:modelCancel`
>   (`27aa661`), an abort the helper honours at its next chunk, which ends
>   every press sharing the fetch with "Cancelled" and no notice. The
>   preload: `speechModel()`, `onSpeechModelProgress()`,
>   `cancelSpeechModel()`.
> - On screen: Settings' "Speech model · 464 MB · on this machine", or
>   "Speech model" with **Get the speech model · 464 MB**, or "Getting the
>   speech model… N%" with an X titled "Stop getting the speech model";
>   shown only while the helper can `asr.transcribe`. The helper's own
>   progress messages give sizes in decimal MB ("484 MB"); the window shows
>   the fraction and its own label.
> - **Row 35's asr half passed** on a copy of pack 1 with hf-xet
>   uninstalled: `asr.model {download: true}` fetched 486,212,372 B in
>   14.7 s from huggingface.co and us.aws.cdn.hf.co, and Transcribe gave 22
>   words; a fresh session with no host allowed transcribed too (§3a.8 row
>   35).
>
> **Group Policy** (`a1aaf0e`): `client.ts` `startFailure` gives
> `HELPER_BLOCKED_BY_POLICY` for a `spawn` error of the pack rung on win32
> with `EACCES`, `EPERM` or `UNKNOWN`, or errno 1260. By libuv 1.52.1's
> source (Electron 44.3.0's), 1260 has no case and reaches Node as
> `UNKNOWN`, so `EACCES` and `EPERM` alone would never have matched it. A
> refused spawn has no pid and is not restarted, so "keeps crashing" never
> overwrites it. Elsewhere it stays "Could not start the AI helper:
> <message>".
>
> **The EXPORT row** is slice B's; its speed column now wraps,
> right-aligned, instead of clipping the check's longest texts (`00e431b`,
> read from the classes, not measured on screen).
>
> **The bridge.** The preload has slice B's `installHelper`, `removeHelper`
> and `checkHelperAgain`, and now `speechModel`, `onSpeechModelProgress`,
> `cancelSpeechModel` and `helperModelsBytes`; the status is
> `sidecarStatus`, as slice A built it. The harness bridge's stub is
> §3a.7's. **The fallback bridge** moved to
> `src/renderer/src/fallbackBridge.ts` (`d2e939e`) and has them all:
> `sidecarStatus` resolves failed, "The app bridge did not load — restart
> Forge" (a red row with no presses), the presses throw, the subscriptions
> are inert. It had none of the helper's calls, though App subscribes to
> `onSidecarStatus` and asks `sidecarStatus()` at mount, so a missing
> preload threw before anything was drawn; `onTranscribeProgress` and
> `onParallaxProgress`, older than this slice, were missing the same way.
> `tests/renderer/fallbackBridge.test.ts` reads App's mount calls from
> `App.tsx` with the TypeScript parser and calls each on the fallback.
>
> **Where it differs from the text below:**
> - `helperRow` takes `{status, pack, job}`: a ready or failed status
>   carries no offer, so `pack` (`packFactsFor(HELPER_PACK,
>   navigator.platform)`) brings the manifest's `expects`, bytes,
>   `bytesOnDisk` and hosts. The speech model is its own `speechModelRow`.
>   "`helperState` gains absent …" is this one row instead.
> - The older pack's word is "Needs an update"; the table named only its
>   button. The sentences sit under the presses.
> - **Sizes read in MB**: `formatBytes` writes GB only from 1 GiB, so the
>   table's "0.7 GB" is 636 MB on the Mac and 685 MB on Windows (computed,
>   not seen on a Windows screen).
> - **The speech press forwards progress and has an X; it is not a row in
>   EXPORT's list.** The text's "through the job list, as the face finder's
>   press does" contradicts its own precedent: the face finder's press is
>   progress forwarding too. Whether the speech press should also be an
>   EXPORT row is the user's to decide.
> - "used instead of FORGE_PYTHON once installed" shows in development
>   too, where `FORGE_PYTHON` stays first: the renderer cannot tell a
>   packaged app from development.
> - A status not yet answered reads "Starting", and Transcribe and Listen
>   to it say "the AI helper is starting" (they said "needs the AI helper").
>   A failed status with no source (the harness page's own) has no presses.
> - The pool's sized press is one bar over the pool, not beside each tile's
>   Transcribe icon, which has no room.
> - The hosts sentence is not under the Repair of a whole or short running
>   pack: there it would be a standing paragraph. Whether it belongs there
>   is the plan's to say.
>
> **Tests** (run by the recorder at `1a043c9`, exit 0, among 62 files and
> 812 passed): `helperCan` 7, `helperRow` 32, `reframeContract` 16,
> `settingsPanel` 15, `renderer/settingsPanel` 19, `renderer/mediaPool` 9,
> `renderer/transcriptPanel` 16, `renderer/ingestPanel` 23,
> `renderer/reframePanel` 26, `renderer/helperJobRow` 4,
> `renderer/fallbackBridge` 3, `speechModelIpc` 12, `uiCensus` 9; and
> `tests/sidecar/test_asr.py` 16 (none skipped on a bare 3.12), `asr.int` 8
> with the seeded model and fixture (its 3 transcription cases skip without
> them).
>
> **Mutations**, each anchor counted at one match first, each file restored
> and compared byte for byte, each seen to fail:
> - the window lane's 51: `helperCan`'s four checks each dropped (the state
>   check **survived** until a test with a cast status carrying a hello was
>   added) and an `in` for its own-property test; `reframeHelperFrom` back
>   on capabilities, `facesModel` dropped, installing as unknown; the row's
>   16 (a size written by hand, Not installed drawn red, the env rung green
>   on the process alone, a damaged pack offered Install, the hosts line
>   dropped, integrity ignored, a literal 8 as the count, failed groups
>   ignored, the job ignored, `bytesLeft` ignored, Repair's size by hand, a
>   queued job before a running one, the Visual C++ reason whole, the
>   integrity row green, a failure with no source dereferenced, the other
>   window's refusal dropped); the component's 13 through the store and the
>   bridge (Remove's box on by default or ignored, Remove without asking,
>   the refusal shown with Electron's prefix, every press sent as Install,
>   …); the gates' 9, the pointers' 3, EXPORT's 2 and the row's scroll;
> - the speech-model lane's 12 over `asr.py`, `ipc.ts`, the preload and the
>   protocol (the status ask fetching, the old `WhisperModel(size,
>   download_root)`, `local_files_only` dropped, a revision of None, the
>   progress send dropped, two presses not sharing one fetch, the
>   preload's `{}` default dropped, and the test's stand-in agreeing with
>   its planted files on a layout that is not the hub's);
> - the main-process lane's 3 for Group Policy (the generic sentence back,
>   `UNKNOWN` left out, the sentence not limited to the pack) and 3 for the
>   speed column;
> - a verifier re-ran 11 of the window and harness lanes' and each failed
>   as claimed; the fix phase's, among them the store listening for "needs the speech
>   model" again, `asr.py`'s sentence reworded, the Transcript tile's gate
>   dropped, a fallback missing a startup call, the models' size never
>   drawn, Repair back on the whole bytes, the speech fetch without its
>   signal, and the network sentence dropped.
>
> **A test that certified a path that never ran**, found by two verifiers:
> `mediaPool.test.tsx` threw "needs the speech model", the greyed title,
> where the helper answers "The speech model is not downloaded yet", so the
> reset it guarded never fired against a real helper. It throws the
> helper's sentence now, held equal to `asr.py`'s `NOT_DOWNLOADED` by
> `speechModelIpc` (`ae2be28`).
>
> **Left:**
> - **The clean Mac and the Surface** (§3a.9): the first Install pressed in
>   the real app, the first on `chromiumFetch`, and the first Transcribe
>   through the press.
> - **The user's**: whether the speech press is also an EXPORT row; the
>   plan's: whether a running pack's Repair carries the hosts sentence.
> - A ready pack's "· 636 MB" and Remove's "frees about" read the
>   manifest's PRE-CI `bytesOnDisk`, not the receipt's measured one, which
>   the status does not carry.
> - The window asks `sidecar:status` once, at mount: after §16.53's
>   refusal the row heals at the next helper request or the next ask, and
>   nothing polls.
> - What a real SRP or AppLocker block reports (libuv's source says
>   `UNKNOWN`; WDAC's 4551 or a virus block's 225 would read as the policy
>   sentence too).

**One home: Settings.** `WINDOW.md` §3.9 already homes "AI helper (Python)
status" in the settings panel, and §3's legend gives each control one home.
The row, by state:

| state | dot | the row |
|---|---|---|
| **Not installed** | grey, never red: it is every tester's first state, not a fault | **Install the AI helper · 166 MB** (201 MB on Windows; pack 1's were 170 and 205), and under it: "Uses about 636 MB on disk. Downloads from github.com (and the host it redirects to, today release-assets.githubusercontent.com) and files.pythonhosted.org. Its own Python; any Python on this machine is left alone." Sheet 22's "the button has to say Python is not installed rather than spin" (`SHEETS.md:636-639`) |
| **Not installed**, part fetched | grey | **Install the AI helper · 120 MB left**: the manifest's bytes minus the verified files in `downloads/` |
| **Installing · <stage>** | grey | "its bar and its X are in EXPORT"; no second cancel |
| **Running · Python 3.14.8 · pack 2 · 636 MB** (685 MB on Windows) | green, only with every `expects` method a capability and every self-test group ok | what is on this machine, from hello; **Repair · 166 MB** (201 MB on Windows) and **Remove**, small, in the Key row's Save and Clear style (`SettingsPanel.tsx:239-253`). Repair's number is the manifest's bytes minus the verified files present (all of it after a success, §16.47) |
| **Running · 8 of 9 helper features · <reason>** (9 since pack 2 added `asr.model`) | grey | a pack with a degraded `expects` method or a failed self-test group; for the Visual C++ runtime, its sentence and Microsoft's link; **Check again** and Repair |
| **Running · from FORGE_PYTHON <path> · N of 9 helper features** | green only when N is 9; otherwise grey | the dot comes from hello, not from the process being up (CLAUDE.md's Surface setup points `FORGE_PYTHON` at a bare python.org 3.12 with `setx`, which an Explorer-started packaged app inherits); Install stays, with "used instead of FORGE_PYTHON once installed" (§16.42) |
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
(`ExportStrip.tsx:443`). **Built in slice B** (`29c6a40`, 2026-10-14, as
written here); nothing on screen starts the job until this section's
Settings row.

**No first-run prompt** (§16.41): the grey dot, the pointers and the tester
guide (R10: Settings → AI helper → Install) are enough.

**The bridge.** The new `window.forge` calls (`helperPack.status`,
`install`, `repair`, `remove`, `checkAgain`, and the speech model's `get`)
go into the preload, `harness/bridge.ts` and the fallback bridge
(`WINDOW.md:588-589`), with stubs that walk the states.

### 3a.5 P.5 — Offline, proxies and restricted networks · inside P.3

> **Built 2026-10-14 — slice B, with §3a.3** (`EFFECTS.md` §58; not
> pushed).
>
> - **The host after the redirects is in the log** (`d3c5ed3`): each file
>   that lands logs "<name> came from <host>: N B, its sha256 verified". In
>   the real install the interpreter came from
>   release-assets.githubusercontent.com and the wheels from
>   files.pythonhosted.org. Every failure names the host that failed,
>   because `fetchVerified` follows redirects by hand.
> - **Offline**, run once with the real workers, Node's fetch and a short
>   budget (2 tries; a temporary test, not committed): the job failed in
>   about 0.2 s with "cpython-3.14.8+…tar.gz could not be downloaded:
>   github.com could not be reached: fetch failed (getaddrinfo ENOTFOUND
>   github.com) — gave up after 2 tries over 0s. If this machine cannot
>   reach github.com and files.pythonhosted.org, point FORGE_PYTHON at a
>   Python with the helper's requirements." Its retry line read "the
>   connection to github.com failed (ENOTFOUND), trying again in 1s (2 of
>   2)". A checksum mismatch carries no way out, since it is not the
>   network's.
> - **A sign-in page or a filter's page** answered as `text/html` is
>   refused before its body, with the "something other than the file"
>   sentence and the way out.
> - **Proxies: Install fails behind one today.** `HTTPS_PROXY` alone is
>   ignored by Node's fetch: the run failed exactly as with no proxy, as
>   §8.2 said. With `NODE_USE_ENV_PROXY=1` and a dead proxy it failed in
>   about 0.1 s with no retry, and the sentence blames github.com, naming
>   the proxy only in the raw cause ("connect EPERM 127.0.0.1:9", the
>   sandbox's refusal). The real install in the dev sandbox needed
>   `NODE_USE_ENV_PROXY=1`, which the app does not set.
> - **Waits for row 19**: the job's move to `net.fetch`, `net.fetch` with
>   `redirect: 'manual'` (unmeasured; the hand-followed redirects rely on
>   Node's fetch returning the 3xx itself, undici `index.js:1190-1196`,
>   which a verifier saw as a 302 with `Location` against github.com on
>   Node 24.18.1), a sentence that names a proxy, and one Hugging Face
>   press and one `fetch_url` press behind the same proxy.
>
> **Slice C (2026-10-16): row 19's Electron half, measured and built**
> (`2664a63`, `EFFECTS.md` §59). `scripts/probe-netfetch.mjs`, run as an
> Electron 44.3.0 main-process script in the user's Terminal: `net.fetch`
> with `redirect: 'manual'` **rejects** github.com's 302 ("Redirect was
> cancelled"), and with `'follow'` leaves `response.url` empty, so it cannot
> carry the hand-followed redirects that name each host. `net.request` in
> its `'manual'` mode hands the 302 back with its `Location`. So:
> - **The pack's fetch inside the app is `src/main/net/chromiumFetch.ts`**, a
>   fetch over `net.request` that returns a manual redirect as undici does,
>   so `fetchVerified` follows each hop unchanged and the log still names
>   release-assets.githubusercontent.com; every request is `cache:
>   'no-store'`, so the pack never lands in Chromium's disk cache too; the
>   system's proxy is Chromium's. `installDeps.ts` `packFetch()` picks it
>   inside a ready Electron; vitest and CI keep Node's fetch.
> - **Chromium's `net::ERR_` network codes are retried** (not a certificate,
>   a cancel, an unsafe port or a policy block), and **a failing proxy is
>   named as the proxy**: "the proxy 127.0.0.1:59998 (this computer's proxy
>   settings) could not be reached: net::ERR_PROXY_CONNECTION_FAILED"
>   (Chromium, the address from `session.resolveProxy`), or "the proxy
>   127.0.0.1:9 (HTTPS_PROXY) could not be reached: …" (Node under
>   `NODE_USE_ENV_PROXY=1`, `NO_PROXY` honoured), its retry line too.
> - **§16.40 (d)'s sentence for the beta is on the row** (`016f470`, §3a.4's
>   note): model presses need a direct connection or `HTTPS_PROXY`.
> - **Still open**: a real system proxy (none was available), one Hugging
>   Face press and one `fetch_url` press behind it, and the app's own
>   Install on `chromiumFetch`, which the sandbox cannot run (the clean Mac
>   is its first, §3a.9). `service.ts` still hands the job
>   `globalThis.fetch`, which `packFetchVerified` swaps; passing
>   `packFetch()` there would read better and behave the same.

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
| main's `fetchVerified` | the interpreter and the wheels | Node's (CI, vitest) or, inside the app since `2664a63`, Chromium's through `net.request` (`chromiumFetch.ts`; row 19 found `net.fetch` cannot carry the hand-followed redirects) | Node's fetch ignored `HTTPS_PROXY` without `NODE_USE_ENV_PROXY=1` (§8.2); Chromium's uses the system's |
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

> **Built 2026-10-16 — slice C, with §3a.4 and §3a.7.** Not pushed when
> this was written, so CI has run none of it; the run of `c7a2a86` (slices
> A and B) is below.
>
> Commits: `aa377f9` (the filter and the uninstaller), `446f99b` (CI's six
> steps, the URL probe, the PE reader, `helperPack.int`'s modes),
> `83373de` (`ci.yml`'s URL count), `a943cd3` (the macro held to its kinds
> of line; `.claude` and `.DS_Store` out), `3e90349` (numba's cache out of
> CI's pack); and four fixes for `c7a2a86`'s Windows run, `b046c08`,
> `16af45d`, `cbce56a`, `cec5ac1`. Every number is in `EFFECTS.md` §59.
>
> **The installer** (`electron-builder.yml`). The sidecar filter leaves out
> `!.venv*` and `!.venv*/**` (both: electron-builder gives a pattern with a
> dot no implied `/**`, app-builder-lib `fileMatcher.js`), `!.claude`,
> `!.claude/**` and `!**/.DS_Store` (`a943cd3`), beside `__pycache__`,
> `*.py[cod]` and the `:memory:` file. `sidecar/.venv` is 598 MB and
> `.venv-faces` 108 MB by `du -sh`. `packaging.test.ts` judges the filter
> through app-builder-lib's own `getFileMatchers`, so a `.venv-stems`
> nobody has made yet is refused too.
>
> **The uninstaller** (`build/installer.nsh`, through `nsis.include`):
> `customUnInstall`, which electron-builder inserts at the start of its
> uninstall section, before the files go. Its whole body is inside
> `${ifNot} ${isUpdated}` (an update runs the old version's uninstaller
> with `/S /KEEP_APP_DATA --updated`; the guard is spelled as
> electron-builder's own app-data guard is). It sets the shell context to
> the current user for a per-machine install, then `RMDir /r
> "$APPDATA\${PRODUCT_NAME}\python"`, and the same under
> `${APP_PACKAGE_NAME}` when that name differs (a compile-time `!if`).
> Electron names userData after the packaged `package.json`'s name
> ("forge", no `productName`), which on NTFS is the same folder as
> `Forge`; the second line is for a later rename (3dit). Never the models,
> projects, settings or userData itself; `deleteAppDataOnUninstall` stays
> unset. `packaging.test.ts` pins the include, one macro, the guard as its
> first line and its `${endif}` as its last, every `RMDir` (by `matchAll`)
> inside it and ending in `\python`, and since `a943cd3` every line one of
> seven kinds and the file the macro alone: a verifier's `Delete` of
> `settings.json` inside the guard had **survived** the first version.
> **`makensis` has never compiled it** (the package job, which brings it,
> runs on dispatch or a tag), and the guard's behaviour is unmeasured.
>
> **CI** (`.github/workflows/ci.yml`): the test matrix is `[windows-latest,
> macos-14]` on every push (the repo is public, so the minutes are free;
> the header's 9–14 and 6–10 minutes a push are estimates until row 37);
> the installer job stays on dispatch or a `v*` tag. After `npm test`,
> which keeps its bare 3.12:
> 1. **The URL probe**, `node scripts/probe-pack-urls.mjs`: a one-byte
>    range GET of each URL (**67 for pack 2's 95 files**), asserting 200 or
>    206, the pinned length from `Content-Range`, and a landing host the
>    row names (`pack.ts` `packHosts`), each failure an annotation. It reads
>    the manifest through Node's own type stripping, with a literal parser
>    as the fallback, held equal to the import by a test.
> 2. **The cache** of `${{ runner.temp }}/forge pack é/userData/python`,
>    keyed on the OS, the architecture, the ISO week (the step `iso-week`,
>    shared with yt-dlp's) and a hash of `packManifest.ts`, `pack.ts`, the
>    locks, `install.ts`, `installDeps.ts`, `pip.ts`, `check.ts`,
>    `unpack.ts`, `compile.ts`, `fetchFile.ts` and `tar.ts`; no
>    restore-keys; saved only by a green job.
> 3. **`helperPack.int`** with `FORGE_PACK_REAL=1` and `FORGE_PACK_USERDATA`
>    at that path (without `FORGE_PACK_REAL` it fails, `venv.ts`
>    `packSuiteGate`). Over a pack this build accepts (`cachedPackIn`: the
>    receipt parses, its platform and both hashes are the manifest's, the
>    interpreter is there) it runs the job's Check again and every
>    assertion; a stale receipt or a partial folder is removed and
>    installed fresh. Its README goes up as `helper-pack-install-<os>` for
>    rows 28 and 37.
> 4. **The helper's suites through the pack's launch**
>    (`FORGE_HELPER_PACK`): `sidecar.int`, `sidecarMedia.int` (strict: its
>    Python cases may skip nothing, `venv.ts` `pythonCasesGate`),
>    `vision.int`, `beats.int`, `faces.int` and `reframeJob.int`. Since
>    `3e90349`, `packLaunch` gives the helper `<userData>/helper-cache`, so
>    numba writes nothing into the cached pack (§16.52).
> 5. **`packPipCheck.int`**: every problem `pip check` reports is
>    mediapipe's two, or huggingface-hub's hf-xet while the lock pins no
>    `hf_xet` wheel.
> 6. **Windows: `scripts/pe-imports.py`** over the version folder, which
>    lists each import that is neither beside its file, nor in
>    `python.exe`'s folder, nor Windows' own, with `MSVCP140*`,
>    `VCOMP140*`, `VCRUNTIME140*` and `CONCRT140*` always listed with where
>    each resolves and every copy in the pack, delay-load imports read and
>    flagged. Compared by membership with
>    `tests/fixtures/pack-native-imports-win32.json`, and the full pack's
>    list recorded and uploaded as `helper-pack-native-imports-win32`.
>    **The committed list is a bootstrap** (`"recorded": false`, the
>    interpreter's tree alone, read on the Mac: 48 PE files, 45 entries),
>    and while it says so the step compares nothing: item 5 below is
>    **listing built, comparison pending**, until the next slice commits
>    CI's artifact as the fixture.
>
> **Measured locally** (the packaging lane, in clean copies): the URL probe
> answered for all 67 URLs (206, every length the pin's) in 0.6 s; pack 2
> installed fresh into `$TMPDIR/laneC-pack é/userData` in 53.0 s, then
> checked again from the cache in 2.9 s, then reinstalled over a stale
> receipt in 54.0 s, and once more through `2664a63`'s `fetchFile.ts` in
> 50.5 s, each 11 of 11; `pip check` and `sidecarMedia.int`'s 148 Python
> tests from the pack, none skipped; both fail with the reason on a pack
> that is not there. `ci.yml` parses with js-yaml and PyYAML 6.0.3.
> `helperPack.int`'s progress case broke on `a1aaf0e`'s per-group check
> texts and would have failed CI's first push; it folds them now.
>
> **`c7a2a86`'s Windows CI run** (2026-10-16, read by the CI reader,
> https://github.com/spyki-a/forge/actions/runs/38919769393): **red**,
> 9 min 13 s, Windows only (the push matrix before `446f99b`); `npm test`
> failed after 7 min 55 s on six tests, each new since the last green run
> (`d7244ce`) and running on Windows for the first time; the build and the
> installer job were skipped. Five were the tests' own faults:
> `shots.int` ×2 (the win32 ffprobe prints frame 0's side data as `0,` in
> csv, so the `/^\d+$/` filter counted 299 of 300; `b046c08` reads JSON),
> `unpack.test` (the Mac's archive with its link unpacked on a win32 host,
> which refuses links by design; `cbce56a`) and `pipStage.test` (a killed
> pip's cwd removed before Windows released it, EPERM; `cec5ac1`). **One was
> a product bug**: two `reframe.int` VFR rows showed the black canvas on
> their last two frames at 0.5×, because the 2018 build's `setpts` passes
> its EOF on un-retimed and `fps=` drops the last frame it holds, so **every
> slowed clip on Windows lost its last source frame** (the shape since
> `e536186`, 2026-09-16). `16af45d` puts `tpad=stop_mode=clone:stop=1`
> (`RETIME_TAIL`) ahead of a retime that slows and ends in `fps=`; emulated
> on the Mac, it reproduces CI's frames without the clone and none with it.
> The next Windows run proves all four on the runner.
>
> **Where it differs from the text below:**
> - The cache key hashes `install.ts`, `installDeps.ts`, `pip.ts`,
>   `check.ts`, `unpack.ts` and `compile.ts` (and the shared `pack.ts`):
>   `src/main/sidecar/pack.ts` does not exist, and each of these decides
>   what an install puts on disk.
> - Step 1 counts 67 URLs, not about 49; step 3's `asr.int` is left out (no
>   fixture or model seeded) and `tiny` is now refused by `asr.transcribe`.
> - `pe-imports.py` counts `python.exe`'s folder as found (Windows searches
>   the application directory for every DLL in the process), and reads the
>   delay-load imports too.
> - A stale receipt in CI is removed and installed fresh, not taken
>   through the app's Update path, whose helper calls differ.
> - The uninstaller's second `RMDir`, for the package name's folder.
>
> **Tests** (at `1a043c9`): `packaging` 17, `probePackUrls` 14, `peImports`
> 6, `helperPackCi` 13, `fetchFile` 35, `installDeps` 5, `unpack` 21,
> `pipStage` 12. **Mutations**, each seen to fail: the packaging lane's 5 on
> the filter and the macro, then 2 more on the macro's kinds of line and 2
> on `.claude` and `.DS_Store`; the URL probe's 5; the PE reader's 4 (one
> anchor, `IMPORT_DIRECTORY = 1`, also matched inside
> `DELAY_IMPORT_DIRECTORY = 13`, was refused and run again on a unique
> one); `venv.ts`'s 4 and the fix phase's numba one; `fetchFile`'s 7 and
> `installDeps`' 1 (row 19's, §3a.5's note); and the CI fixes' own (§59).
>
> **Left:**
> - **CI's first run of the pack** on both runners, at the next push: read
>   it at github.com/spyki-a/forge/actions, both jobs; the capability
>   suites have never run on Windows (an open-ended risk on the 2018
>   ffmpeg and a Windows CPU), and `actions/cache` on a path with a space
>   and an `é` on Windows is unmeasured (a failure there should be a miss
>   or a save warning, not a red job).
> - **The PE fixture** from CI's artifact, `recorded: true`.
> - **`makensis` on `build/installer.nsh`**: run the workflow by hand once
>   before the Surface's update run.
> - **Row 37**: the minutes on a miss, the cache's size, and one Windows
>   helper process running asr and then beats, which CI does not run
>   (`asr.int` is not seeded).
> - `tests/sidecar/test_*.py` must skip nothing under `FORGE_HELPER_PACK`,
>   so a skip added there later fails step 4 by design.

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

1. **The URL probe, on every push**, cache or not: each manifest URL (67
   for pack 2, as built) gets a HEAD or a 1-byte range request, asserting 200 or 206 and the
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
   rung's. (Built in slice B, `083fb7a`, and rehearsed on the Mac through
   the first installed pack: §3a.3's note.) The suites: `sidecar.int` (15), `sidecarMedia.int` (32 Python
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
Python 3.14.8 · pack 2" with "Repair · N MB", and Follow the subject is
enabled; Transcribe is greyed "needs the speech model" with its sized press;
a stub with a failed beats group shows "8 of 9 helper features" and Check
again; Remove asks with both sizes and returns to Not installed.

> **Built 2026-10-16** (`e3221d3`, with `dca719c`, `e43d967` and `0537c12`
> in the fix phase; `EFFECTS.md` §59 has every step's text as read on
> screen). `harness/bridge.ts` holds a stub helper, `harnessHelper` (also
> `window.__forgeHelperStub`: `set(state)`, `reset()`, `stepMs`), whose
> every status is built from the manifest (`packOffer`, `bytesLeft`):
> absent, absent with files verified, ready, ready with the beats group
> failed for the Visual C++ runtime, update, damaged, unsupported (macOS
> 13) and the Group Policy refusal. Its install is a job in the list that
> walks main's real stages and texts over the manifest's files on a timer,
> fetching nothing, honours the job list's X, and ends starting → ready;
> Remove, Check again and the speech model's press have stubs too. The
> page's own status stays the old "failed: harness: no sidecar" (the
> census's settings rows and the reframe and clip-it checks are written
> against it); the check moves the stub to absent itself. It passed in
> 5.3–5.8 s with each step as listed above, plus Repair beside a running
> pack (its presses waiting on the job, then "Repair · 141 MB" after the
> X), and the damaged, update, policy and unsupported rows. The Mac's
> texts: "Install the AI helper · 166 MB", "· 141 MB left", "Running ·
> Python 3.14.8 · pack 2 · 636 MB", "8 of 9 helper features", "Remove the
> AI helper? It frees about 636 MB." with "also remove the downloaded
> models · 464 MB". Twelve mutations of the code it guards each fail it;
> one of them, Settings opened without asking for the row, **survived** the
> first version, since in a 785 px window the row is in view either way,
> until the check watched the store's focus. Dropping the hosts sentence
> fails it too (a verifier), and so do the fix phase's two. **It needs the Browser pane shown, not only the tab
> fronted, and a window about 785 px tall**; its offline video asset fills
> the console with `forge-media://` errors, which are harmless.
> `clipItCheck.ts` reads the no-caption link's reason as the pointer now.

**Census rows** (`tests/fixtures/ui-census.json`, each with its `needs`
recipe): "Install the AI helper", "Install the AI helper · N MB left", "Not
installed", "Installing", "Repair · N MB", "Remove", "Check again", "N of 9
helper features", "Update the AI helper", "Not available on this computer",
"Python is missing from the AI helper's folder", the hosts line, the
pointer's title, Transcribe's new title, "Get the speech model · 464 MB" and
"needs the speech model".

> **Built 2026-10-16** (`e3221d3`, then `33ee0ff`, `27aa661`, `016f470`,
> `0537c12` and `1a043c9`). The fixture went from 827 rows to 860, then
> 883; the browser census checks 875 of them with none missing (8 skipped,
> 54.7 s). Every label above has its row, a number's label by the existing
> `part` kind ("Install the AI helper ·", "Repair ·", "helper features",
> "Get", …); "left" counts 2 under helper-partial and "Check again" 2 under
> helper-short. Beyond the list: "Needs an update" and the older-pack
> sentence, the Visual C++ sentence and its link, the Group Policy
> sentence, Remove's question, box, "Remove it" and "Keep it", "Speech
> model" and its X, the model presses' network sentence, "Installing",
> "Repairing" and "Updating" in Settings and EXPORT, "Its bar and its X are
> in EXPORT.", "used instead of FORGE_PYTHON once installed", and "the AI
> helper is starting" in each home that says it. The pointer's title has a
> row in the url, canvasbar and dock homes; MediaPool's "The AI helper
> (Python) is not running" became "needs the AI helper — install it in
> Settings". New recipes in `census.ts`: helper-absent, -partial,
> -installing, -short, -update, -unsupported, -damaged, -policy,
> -remove-asked, -repairing, -updating and -env; speech-model-offered,
> -present, -missing and -fetching, and speech-fetching-pool;
> transcribe-no-model, transcribe-ready and the Transcript tile's four
> (transcript-no-model, -speech-press, -helper-starting, -starting-line);
> and the starting state in the pool, the dock and the URL tile
> (pool-helper-starting, reframe-helper-starting,
> link-no-captions-starting). `uiCensus.test.ts` checks the fixture against the source,
> not the source against the fixture, so a text written on screen with no
> row goes unseen there: five such words were found by a verifier, not by
> it.

### 3a.8 P.8 — Measure before relying

These are §15 rows 26–38. Row 26 is P's first task; row 19 (`net.fetch`
behind a proxy) is P's too, widened in §3a.5.

**Row 19: Electron's half measured 2026-10-16** (`EFFECTS.md` §59): an
Electron 44.3.0 probe in the user's Terminal found `net.fetch` rejects a
`'manual'` redirect ("Redirect was cancelled") and leaves `response.url`
empty after `'follow'`, while `net.request`'s `'manual'` mode hands the 302
back with its `Location`; so the pack's fetch inside the app is
`chromiumFetch.ts` over `net.request`, and a dead proxy reads
`net::ERR_PROXY_CONNECTION_FAILED`, now named as the proxy (§3a.5's note).
**Open**: a real system proxy, one Hugging Face press and one `fetch_url`
press behind it, and the app's first Install on the new fetcher (the clean
Mac).

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
    **Measured 2026-10-14, the Mac's half** (`EFFECTS.md` §58): 57.2 s in
    all, the download 6.0 s (178,190,592 B at 28.2 MiB/s), the unpack
    0.47 s and the compile 2.29 s, pip 11.4 s, the check 37.0 s (a cold
    first hello of 11.3 s and a cold self-test of about 25 s, beats 21.1 s);
    the bar's weights are now 45 / 5 / 15 / 35. `--no-compile` saves
    109.3 MB and 9.3 s of pip and costs 0.29 s at every start, so pip
    compiles. **Pack 2 on the Mac, 2026-10-16** (`EFFECTS.md` §59):
    53.0–58.3 s over two lanes' fresh installs (the download 5.4–6.3 s at
    26–31 MiB/s, pip 11.5–12.9 s, the check 32.5–36.5 s with a cold hello
    of 11.1–11.4 s), and 2.9 s for CI's cached mode, Check again on a warm
    pack. **The Surface half is open.**
28. **Bytes on disk, the longest relative path and the longest directory**,
    per platform, from CI's install. Windows is measured from the wheels'
    indexes today (about 0.72 GB with the interpreter); the interpreter's
    extracted size is measured only as its tar stream.
    **The Mac's figures from a local install, 2026-10-14** (§58): 675,763,387
    B apparent (the manifest's PRE-CI figure +0.11 %), longest path 161 and
    directory 107 as the manifest has them. CI's install on both platforms
    is still owed. **Pack 2 on the Mac, 2026-10-16** (§59): 667,609,685 and
    667,495,529 B apparent over two installs (+0.11 % and +0.09 % on the
    PRE-CI 666,871,585), `du` 697,860,096 and 697,757,696 B, longest path
    161 and directory 107, 13,515 files. CI's install, both platforms, is
    the next push's (`446f99b`).
29. **The cold `system.hello`** from the pack on the Surface, **both** the
    first start after an install and the first after a reboot, against the
    client's 30 s. The client's hello timeout is set from it, plus a margin
    (§3a.2).
    **The Mac's first start after an install, 2026-10-14** (§58):
    11.3–14.4 s over four installs (warm 0.27 s), inside the pack's 90 s
    placeholder. The Surface, and the first start after a reboot, are
    open.
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
    `msvcp140` in the wheel (**CI's listing, `scripts/pe-imports.py`, is
    built, 2026-10-16**: on the interpreter's tree alone, read on the Mac,
    its 48 `.pyd` and `.dll` files give 45 runtime entries, every one a
    `VCRUNTIME140` or `_1` found in the pack and none an `MSVCP140`; the
    full pack's list is CI's first Windows run's, §3a.6's note); numpy and llvmlite carry private, name-mangled
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
    **Measured 2026-10-14** (§58): both answer an explicit range with 206
    and a `Content-Range`, and mid-file ranges return the file's own bytes;
    github.com's signed redirect expires 40 minutes after it is issued. It
    can be built; whether it is worth it is the Surface's download's to
    say.
34. **pip 26.2.1 over the lock**: `--require-hashes` with `--no-deps
    --no-index --only-binary=:all: --no-warn-script-location`, its output
    lines, and whether the dist-info folders appear one package at a time
    (the bar's measure).
    **Measured 2026-10-14** (§58): 50 lines on stdout and none on stderr
    ("Looking in links", 47 "Processing …" within 0.25 s, "Installing
    collected packages: …", "Successfully installed …"); the dist-info
    folders appear one package at a time, so the 500 ms poll moves the bar
    in about 12 steps over 11 s.
35. **hf-xet left out**: depth's and asr's model downloads pass without it.
    **Depth's half measured 2026-10-14** (§58): on a copy of the installed
    pack with hf-xet uninstalled and `HF_HUB_DISABLE_XET=1`, `depth.layers`
    fetched its 27,258,801 B model in about 0.8 s and returned 3 layers.
    **asr's half waits for the speech model's press** (§3a.4), and hf-xet
    stays in the lock until it passes.
    **asr's half measured 2026-10-16** (`EFFECTS.md` §59): on a copy of
    pack 1 with hf-xet uninstalled, started as the pack rung with
    `HF_HUB_DISABLE_XET=1`, `asr.model {download: true}` fetched the pinned
    486,212,372 B in 14.7 s (`model.bin` about 13.6 s) from huggingface.co
    and us.aws.cdn.hf.co, and `asr.transcribe` gave 22 words in 2.1 s; a
    fresh session with no host allowed transcribed in 1.6 s. **Row 35 is
    closed: hf-xet left the lock as pack 2** (`1a5051c`, §3a.1's note).
36. **The Surface itself**, recorded where no doc has it yet (grep of
    `docs/`, 2026-10-14): Windows 10 or 11, version and build (it decides
    Smart App Control and Sandbox), edition (Windows Sandbox is not in
    Home), free disk, CPU, the installed redistributable's `msvcp140`
    version, and the Smart App Control and Defender states.
37. **CI**: the install's minutes on a cache miss, the cache's size, what
    the capability suites' first Windows run finds, and **one Windows helper
    process running asr and then beats** (two OpenMP runtimes meeting would
    abort it; CI runs asr only if its model is seeded, §3a.6).
    **The first push's CI measured 2026-10-16** (`EFFECTS.md` §59):
    `c7a2a86`, slices A and B, Windows only, run 38919769393, red in
    9 min 13 s (`npm test` 7 min 55 s) on six tests new to Windows: five
    the tests' own (two csv reads of the win32 ffprobe, a Mac archive
    unpacked on win32, a killed pip's cwd), one a product bug (every slowed
    clip lost its last frame on the 2018 build), each fixed in slice C
    (§3a.6's note). The pack's own CI steps were not in that push. **Open**:
    their first run (the next push, both runners), its minutes on a miss,
    the cache's size, the capability suites on Windows, and asr then beats
    in one Windows process (not in CI: `asr.int` is not seeded).
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
  helper · 166 MB** (pack 2); the press puts its bar and X in EXPORT; one cancel during
  the download and a second press that shows "· N MB left" and fetches only
  what was missing; the self-test passes and the row reads "Running · Python
  3.14.8 · pack 2 · 636 MB"; **Get the speech model · 464 MB** (§16.49 (a)) and one Transcribe on a
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
    CI; the same presses as the Mac at **· 201 MB**; row 32's checks; then an
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

> **Where the exit stands, 2026-10-16.** Every build piece is in (slices
> A–C), and §16.36–53 are answered. What is left is this section's runs:
> **CI's** first run with the pack, which is the next push (`446f99b`
> onward, both runners; then commit CI's native-import artifact as the
> fixture); **the clean Mac** (also the first Install on `chromiumFetch`
> in the real app, and row 31); and **the Surface's two runs**, with an
> installer from a hand-run workflow, which is also `makensis`'s first
> compile of the uninstaller's macro. The clean Mac should read 166 MB and
> 636 MB, the Surface 201 MB and 685 MB, where this text first said 170
> and 205 MB and 0.7 GB.

### 3a.10 Docs this step corrects · 0.5 day

Found stale on the way, each corrected when P lands. **Done 2026-10-16 by
slice C's recorder**, item by item (✓ corrected, with the file; ✗ left,
with why):

- `requirements.txt:1-5` and `SIDECAR.md:69-71` say soundfile is sdist-only
  and that audio decoding goes through the bundled ffmpeg. soundfile 0.14.0
  (2026-06-06) ships `py2.py3-none` wheels for both platforms, and librosa
  1.0.0 requires it; beats decodes with our ffmpeg (`beats.py:59-64`), but
  **asr decodes with PyAV**.
  ✓ `docs/SIDECAR.md` "Environment findings". ✗ `sidecar/requirements.txt`'s
  header still says it: a file under `sidecar/`, which the recorder does
  not edit; a one-comment change for the next code commit there.
- §12's "mediapipe supports 3.12–3.14 by wheel tags": 0.10.35's two wheels
  are `py3-none`, with no Requires-Python. ✓ §12, "The interpreter".
- `requirements-stems.txt`'s demucs 4.0.1 has no `demucs.api` (§3a.1).
  §3a.1 already says so ("Stems is not in it"). ✗ the file itself, under
  `sidecar/`, still pins 4.0.1 with no note; it goes with stems' own half
  day (§16.39).
- `PACKAGING.md:58` and `electron-builder.yml:19` say the venv is 542 MB;
  `du -sh sidecar/.venv` says 598 MB. `PACKAGING.md:61-62` says the
  requirements ship "so the setup step is available"; the pack replaces that.
  ✓ `docs/PACKAGING.md` ("What is deliberately left out", rewritten);
  `electron-builder.yml`'s comment already says 598 MB (`aa377f9`).
- This section's old exit counted "twelve helper tests" and `CLAUDE.md`
  says fourteen; `sidecar.int.test.ts` has 15. `CLAUDE.md` says `client.ts`
  falls back to `python3`; the app's fallback is `service.ts:34` (`python` on
  Windows), and after P a packaged app has none.
  ✓ already: `CLAUDE.md` says "the twenty sidecar tests" (`sidecar.int` had
  18 after slice A and has 20 since slice B) and its `FORGE_PYTHON` row was
  rewritten on 2026-10-14. ✓ §3a's "Exit" now says 20 (it said 15, the
  count when it was planned).
- Then `SIDECAR.md` Setup (the pack, and the venv for development),
  `PACKAGING.md` ("What is deliberately left out", the first-run list, the
  uninstaller's macro), `CLAUDE.md`'s fresh-Windows table (`FORGE_PYTHON`'s
  new place; the dev pack's own root), `WHERE-THINGS-ARE.md` Settings,
  `BETA.md` R4 (the full route built) and R12 (the `python3` dialog question
  gone), and §14 below.
  ✓ `docs/SIDECAR.md` (the methods with `asr.model` and `system.selftest`,
  Setup, ASR, hf-xet); ✓ `docs/PACKAGING.md` (left out, what ships, the
  pack and the uninstaller, the first-run list, "Getting an installer");
  ✓ `CLAUDE.md` (the `FORGE_PYTHON` row: both orders and
  `userData/python-dev`; the CI paragraph: both runners on every push, the
  pack's steps, reading CI without signing in); ✓
  `docs/WHERE-THINGS-ARE.md` (the gear's dot, the Media pool, the URL tile,
  the Transcript tile, Follow the subject, the canvas chip, EXPORT, and
  Settings' AI helper row); ✓ `docs/BETA.md` (R4 built, with what the exit
  owes; R10's guide line; R12's question gone); ✓ `docs/WINDOW.md` §1 and
  §3.9 (the store's `helperStatus`); ✓ §14, already written 2026-10-14.
- **Found while recording, and corrected:** §3a.1's slice-A note said
  `formatBytes` prints the PRE-CI on-disk figure as "0.6 GB" and "0.7 GB";
  it writes GB only from 1 GiB, so "644 MB" and "695 MB" (pack 2: 636 and
  685 MB). Every current value in §3a that said 170 MB, 205 MB, pack 1 or
  "N of 8" now says pack 2's 166 MB, 201 MB, pack 2 and "N of 9"; the Built
  notes keep the history. `EFFECTS.md` §55's csv note and its speed section
  point at §59.

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

> **Built 2026-10-16, all but §5.3**, which waits on 1g: 1g is not built,
> and nothing of the OCR half is coded. Ten commits, made between 19:50
> and 21:33 that evening among other agents' (`0436d83`, `7e72b8a`,
> `83e7fe4`, `fb65a18`):
> - §5.1 and §5.2, the pure half: `11a07c2` (`frameMap.ts`, `freeSpace.ts`);
> - §5.4: `5946b86` (the three routes), `ab49b60` (the toggle and the
>   census);
> - §5.5's render checks: `0c08569` (`captions.int` reads a line's third by
>   the centre of its rows, after CI's fallback face), `32b969b` and
>   `04b25ab` (`captionsFree.int`);
> - the fix phase, after two verifiers: `0d7dd0b` (short shots), `cf165b5`
>   (the frame libass first draws a line on), `96ab85f` (the toggle's
>   no-track state), `a0837ea` (the bake's band shared with the render
>   check).
>
> `11a07c2` … `32b969b` reached origin with `fb65a18`; `04b25ab`, the fix
> phase and this record were not pushed when this was written. `32b969b`'s
> co-author line names "Claude Opus 5.5" where the others name "Claude
> Fable 5.1"; it is pushed, so it stays. Three lanes built it (lane A the
> pure half, lane B the routes and the toggle, lane C the render check),
> then two verifiers and a fix phase. Every number below is in
> `EFFECTS.md` §60, with its command and who measured it.
>
> **§5.1, as built** (`src/shared/reframe/frameMap.ts`):
> - `sourceToFrame(project, clip, asset, canvas, frame, box): UnitRect |
>   null`. The project is an argument the plan's signature lacked: the crop
>   is `cropAt(followCanvas(project, canvas), clip, …, frame − clip.start)`,
>   because the export compiles a followed crop for its own canvas, and
>   `frame` is a PROJECT frame. Null when none of the box is on screen.
> - The fit is `clipBox` and `fitFor` with `fitFilter`'s arithmetic: contain
>   scales by the smaller ratio and centres; cover scales by the larger,
>   centres, and is cut at the clip's box. The result is clipped to the
>   crop (or its half), the box and the canvas.
> - On a stacked two-up frame a box goes through the half that holds its
>   centre (when both or neither do, the half it touches whose centre is
>   nearer; null if it touches neither), into that half's part of the
>   `vstack`.
> - `subjectBoxesAt` takes the track's sample nearest the frame's source
>   time, within `SAMPLE_REACH_MS` (500), **and only from the shot the
>   export shows on that frame**: a nearer sample across the cut is another
>   picture, mapped through the wrong crop. The source time (`sourceMsAt`)
>   is the middle of the source interval `keys.ts` `exportFrameAt` puts on
>   the frame, inverted by bisection; not the preview's `sourceFrameAt`,
>   which rounds where the export at 0.5× floors.
> - Each face is extended downward by `CHIN_EXTENSION`, 0.5 of its height.
> - A track a clip may read is `followKeys`' own (`subjectTrackOf`):
>   present, of today's version, measured on a video of the asset's size.
> - Not modelled: a clip's rotation, an animated transform, and a camera
>   move (Ken Burns, zoom keys) on top of the crop.
>
> **§5.2, as built** (`src/shared/reframe/freeSpace.ts`):
> - `overlapByThird` is the exact area of the union, not a raster: the
>   boxes cut to the band, the x axis cut at every box edge, each strip's y
>   intervals merged. So two faces that overlap count once.
> - `captionThirds(project, style, canvas)`: the canvas is a third argument
>   (the crop and the fit are per canvas), and `style` needs only its
>   `position`. One entry per span of a clip's shot on `captionTrack`, in
>   project frames [start, end), in clip order. A followed clip's spans are
>   its `followKeys(…).shots`, the frames its crop steps on; any other
>   clip's are each cut at its `exportFrameAt`. A clip with no usable track
>   is one entry at the style's third. A gap between clips has none, so
>   `thirdAt` returns null there and the caller keeps the style's.
> - Each sample of a shot sits on the frame `exportFrameAt` gives its ms,
>   held to its own shot's frames. A span holding no sample takes the
>   shot's sample nearest its middle frame within 500 ms, else the style's
>   third (rule 3).
> - The constants: `OVERLAP_LIMIT` 0.05, strict (0.05 stays, 0.0501
>   moves); `BETTER_BY` 0.5, inclusive (0.1 against 0.2 moves, 0.1001
>   stays); `PERCENTILE` 0.9 by nearest rank, ceil(0.9n), not interpolated;
>   and `MIN_SAMPLES_TO_DISCOUNT` 3, from the fix phase (`0d7dd0b`).
>   Below ten samples the nearest rank IS the highest sample, so as first
>   built one gesture moved the caption in every shot under 5 s, against
>   this section's own "so a gesture does not move the caption" (a
>   verifier: 2, 3, 4 and 4.5 s shots moved, 5 s held). Now, from three
>   samples, the highest is never taken alone (the second-highest stands
>   in where the rank would be the top); one or two samples take the
>   higher; at ten or more nothing changed.
> - Among the two other thirds a tie goes to the one nearer the style's:
>   from the top or the bottom, the middle first; from the middle, the
>   bottom before the top. This section named no tie-break.
> - A style's third: `bottom` the lower, `center` the middle, `top` the
>   upper.
>
> **§5.4, as built.**
> - **One decision** (`src/shared/captions/smart.ts`). `smartPlacement(project,
>   style, canvas)` is the only reader of `Project.captions.placement`. It
>   is null unless the value is `'smart'` (absent, `'style'` or anything
>   else), and every route then draws exactly what it did before; with
>   `'smart'` it runs `captionThirds` once and returns a lookup from a
>   project frame to a third.
> - **A moved line** (`src/shared/captions/placement.ts`, a leaf that
>   imports none of the routes). `placedStyle` moves the position and keeps
>   the edge distance. A centred style moved to an edge takes
>   `CENTRE_MOVED_MARGIN_V`, the default style's 220 of 1080: a centred
>   style's margin is neither drawn nor shown (OUTPUT hides Margin at
>   Middle), Bold centre's is 0, and without it Bold centre moved to the
>   bottom sat 13 px from the edge at 360 tall (measured).
>   `captionSpec(style, words, active, placement?)` sets `position` and
>   `offsetY` from the placed style: top, margin − `TITLE_SAFE`; middle, 0;
>   bottom, `TITLE_SAFE` − margin.
> - **libass.** `buildAss`'s `thirdAt(sourceMs)` is asked once per LINE,
>   at its first word inside `rangeMs`, and every event of the line takes
>   the answer; asked per word, a line would move part-way through. A moved
>   line's events carry `{\an8}`, `{\an5}` or `{\an2}` at the head of their
>   text and their own MarginV field: round(marginV × PlayResY / 1080),
>   which for Pop's 220 is 391 at 1920 tall, 220 at 1080, 130 at 640 and 73
>   at 360, and 0 under `\an5`, where libass ignores it. **This section
>   said "the style's own for bottom"**: so it is when the style is a
>   bottom one, since its line is then not moved; a top or centred style
>   moved to the bottom gets
>   `{\an2}` and the field, because an event MarginV of 0 means "the
>   style's". An unmoved line is written exactly as before: MarginV 0, no
>   tag. `main/captions.ts` hands `smartPlacement(…)` to
>   `buildTimelineCaptions` as a fourth argument, rather than
>   `captions/timeline.ts` computing it: that would close an import cycle
>   (`freeSpace` → `frameMap` → `render/plan.ts` → `captions/timeline.ts`,
>   for `escapeFilterPath`).
> - **The canvas bake.** `buildGraphicsSpec` asks at each caption layer's
>   `startFrame`.
> - **The preview.** `Preview.tsx` memoises the lookup on the project and
>   the aspect (with captions on), and asks for the line on screen through
>   `lineThird`, the way the style's export route will (`captionNeedsCanvas`).
> - **Each route asks at the frame it first shows the line on** (rule 4;
>   `cf165b5`). Measured on the bundled ffmpeg, the `ass` filter draws a
>   cue from ceil(its centisecond time × fps / 1000) (80 cues at 24, 25, 30
>   and 60 fps), where the bake shows a line from the rounded frame. So
>   libass asks at `libassLineFrame` (the cue's own shift and centiseconds,
>   rounded up) and the bake at `captionLineFrame` (its layer's
>   `startFrame`). They differ only for a line starting between half a
>   frame and a frame before a cut. As first built, libass asked at the
>   rounded frame too, and such a line ("Late start." at 2975 ms, rendered)
>   took shot 1's third and sat on shot 2's face on all 18 of its frames.
>   Both are the caption clock: start and in-point, no speed.
> - **The project file.** `CaptionSettings.placement?: 'style' | 'smart'`;
>   `deserializeProject` drops any other value; no schema version change.
>   With it absent every caption output is byte-identical to the code
>   before step 2: a verifier compared 360 outputs of
>   `buildTimelineCaptions`, `buildGraphicsSpec`, `planBakeOf`, `buildAss`
>   and `captionSpec` at `0436d83` and at `04b25ab` (`cmp`: identical), and
>   lane B 90 of `buildAss` and `captionSpec`. The fix phase's `toAssTime`
>   formats `assTimeMs`, its output unchanged.
> - **The toggle** (`ab49b60`, `96ab85f`). In OUTPUT's caption block, under
>   Place and Margin: a full-width row, "Smart placement", with a switch
>   (`role="switch"`, `aria-checked`, `data-smart-placement`) and the
>   tooltip "keeps captions off faces, one position per shot". The store's
>   `setCaptionPlacement('smart' | 'style')`; turning it off deletes the
>   field. Its states, from `smartPlacementState(project, helperStatus)`:
>
> | state | when | the switch | said |
> |---|---|---|---|
> | ready | a clip on the caption track has a subject track it may read | works, whatever the helper's state | the tooltip |
> | no-track | no track yet, and the AI helper can reframe: `reframeHelperFrom`, Follow the subject's own test (`vision.faces` and `vision.facesModel`, the faces self-test passed) | works; nothing moves until a clip is reframed | the tooltip ends "— reframe a clip first" |
> | helper-starting | no track, and the helper has not answered | greyed | "the AI helper is starting" under it |
> | needs-helper | no track, and nothing here can make one | greyed | **needs the AI helper** under it: the shared `HelperPointer`, titled "install it in Settings", opening Settings at the AI helper's row |
>
> A greyed switch that is on (a project saved so) can still be turned off.
> As first built, no-track took `vision.faces` alone and offered "reframe a
> clip first" where the reframe itself would refuse (`96ab85f`).
> - **The census**: six rows in the `output` home where this section named
>   two. "Smart placement", its tooltip, "needs the AI helper" and "install
>   it in Settings" under needs `none` (the harness page's own helper has
>   failed by design); "reframe a clip first", part of a title, under the
>   new recipe `captions-placement-no-track`; "the AI helper is starting"
>   under `captions-placement-starting`. Lane B's census run in the harness:
>   288 rows, none missing. The "reframe a clip first" row's note still
>   reads "able to find faces"; since `96ab85f` it is "able to reframe".
>
> **§5.5, as built.** The step's test files at `a0837ea`, run by the
> recorder on 2026-10-16: 11 files, 190 tests, all passed.
> - `tests/frameMap.test.ts` (14) and `tests/freeSpace.test.ts` (14): every
>   bullet above, the mouth case, the two-up's halves, a sample never taken
>   across a cut, and the short shots (1.5 to 4.5 s: one lean stays at the
>   bottom, two move it).
> - `tests/captionPlacement.test.ts` (21): one test per route, so each can
>   fail alone; the measured libass table pinned as `LIBASS_FIRST_FRAME`;
>   the late line on each route; the toggle's state over nine helper
>   statuses; main's one call and the preview's dependencies as source
>   shapes. `tests/renderer/smartPlacement.test.tsx` (6): the toggle in
>   every state. Cases added to `captionLine`, `captions`, `project` and
>   the census fixture.
> - `tests/integration/captions.int.test.ts` (8 in all): libass alone at
>   360×640, Pop and Bold centre, smart against absent, each line's third
>   read by the centre of its rows (`0c08569`); and the late line read on
>   every frame (`cf165b5`).
> - `tests/integration/captionsFree.int.test.ts` (19), into
>   `tests/output/captions-free/`, the render check. A 1280×720, 30 fps,
>   6 s lossless source cut at 3 s, with a white box drawn exactly where a
>   hand-written track puts the face: the lower third in shot 1, the upper
>   in shot 2. The clip at timeline frame 12, in-point 6; seven yellow lines
>   of two words or one, two of them a few frames either side of the cut.
>   9:16 at 360×640 follows its subject (a 404×720 crop); 16:9 at 640×360
>   has a static 16:9 crop. Both routes, through the app's own code:
>   libass from main's `prepareCaptions` to the export's `subtitlesPath`;
>   the canvas bake (Pop with gradient-sunset) through `buildGraphicsSpec`,
>   `planBakeOf`, main's picture and list writers and `captionOverlay`, in
>   the band `captionBand` computes (`a0837ea`). Pop at its bottom and moved
>   to the top, each smart and with placement absent (eight controls). Every
>   frame of every render is read: no caption row inside the box's rows;
>   each line's third, by the centre of its rows, the hand-derived one and
>   never the face's; nothing between lines. The controls sit in the
>   style's third and on the box through the face's shot.
> - The mutations this section named are killed: no hysteresis (1 test);
>   no downward extension (4, across `frameMap` and `freeSpace`);
>   `placement` ignored by `buildAss`, where exactly `captionsFree.int`'s
>   four libass smart cases fail and the four canvas cases and eight
>   controls pass (lane C, then a verifier). Every other mutation `EFFECTS.md`
>   §60 lists failed its tests too.
>
> **The rows**, Pop on this Mac with Anton, the union over each third's
> lines, against this section's table (640×360, MarginV 20):
>
> | | top | middle | bottom |
> |---|---|---|---|
> | the plan's probe, 640×360 | 26–52 (`\an8`) | 167–191 (`\an5`) | 306–332 |
> | libass, Pop, 640×360 (MarginV 73) | 84–99 | 174–189 | 264–279 |
> | libass, Pop, 360×640 (MarginV 130) | 148–177 | 309–337 | 470–498 |
> | the canvas stand-in, 640×360 | 73–105 | 163–195 | 254–286 |
> | the canvas stand-in, 360×640 | 130–188 | 291–349 | 451–509 |
>
> Both `\an5` rows centre on PlayResY / 2 (179 and 181.5); under `\an8`
> the first row is 6 below MarginV in the plan's and 11 below in Pop's; at
> the bottom both end 8 rows above MarginV from the edge. In the smart
> renders no frame put a caption row on the box, and the nearest any came
> was 62 rows (16:9, the canvas, Pop at the bottom); the controls sat on it
> for 42 frames (Pop at the bottom) and 36 (at the top).
>
> **Where the build reads otherwise than this section**, each said above:
> the signatures (`project` and a null return in `sourceToFrame`; `canvas`
> in `captionThirds`); the nearest sample from the shown shot only; the
> discount below ten samples; a tie-break; `{\an2}` and the field for a
> top or centred style moved down; `CENTRE_MOVED_MARGIN_V`; a fourth state
> and six census rows; and the render check's canvas route, whose GLYPHS
> are stood in. Each canvas line is the opaque yellow block `layoutText`
> gives it, read by chroma (Y > 150, U < 80) rather than by luma, because
> the painting needs a DOM canvas and the check runs in node and in CI.
> The band over the blocks is the app's own (`captionBand`). The real
> paint's ink, measured once in the harness, starts up to 0.32 of the font
> size above the block and ends inside it; raised so, the canvas cases'
> nearest approach to the box would still be 62 rows. A line spanning a
> cut is `captions.int`'s and the route tests' case; no render-check line
> spans one.
>
> **The exit**, two halves:
> 1. **Both routes pass the render check in CI.** On the Mac: 19 of 19 at
>    `a0837ea` (the recorder's run), and 19 of 19 with the fonts folder
>    emptied (lane C's rehearsal on this Mac's fallback face). **In CI,
>    met**: run 38988978219 (the push of `fb65a18`, read by the orchestrator
>    the same night) passed `captionsFree.int` 19 of 19 on **both**
>    windows-latest and macos-14, each with Anton absent (`/assets` is
>    gitignored, so libass draws a fallback face on the runners). Its
>    "captionsFree: caption rows" notice from Windows, the first reading of a
>    MOVED line on the 2018 build: 9:16 libass, Pop at the bottom, shot 1's
>    lines at rows 300–337 (moved to the middle; the box at 446–569) and
>    shot 2's at 461–498 (back at the bottom; the box at 57–195); Pop at the
>    top 140–177 then 461–498; 16:9 libass 169–189 then 260–280; the canvas
>    cases 291–349 / 451–509 and 163–195 / 254–286; every control on the
>    style's rows (460–498 bottom, 140–177 top). macOS 14 read 302–338 /
>    462–498 and 170–189 / 260–280. So per-event `\an` and MarginV are
>    **measured on the 2018 build**, no longer only dated. Earlier, run
>    38986994729 had failed lane B's `captions.int` case on an UNMOVED line
>    (the fallback face's three-word line wrapped to rows 409–498 across the
>    426.7 boundary), fixed by reading a line's third from its centre
>    (`0c08569`). The fix phase's four commits (the late line and the shared
>    band among them) run first on the push after this record.
> 2. **The ten clips show zero sampled caption lines on a face.** Not run,
>    and **no reader for it exists yet**: step 1's exit reader
>    (`reframeExit.int`, §4.10) scores crops and cuts, not caption lines.
>    The ten clips are yours, after step 1's own run through the action.
>
> **Open, found while building:**
> - **The preview's cost.** It recomputes the thirds on every edit while
>   Smart placement is on: lane B measured 4.1–9.3 ms for a 10-minute clip
>   unfollowed and 58–70 ms followed (1,200 samples, 60 shots). Memoising on
>   the inputs would still recompute on a drag, since a drag changes the
>   clips; a per-clip cache is a design change.
> - **The bake's band spans every third a line uses**: 9:16 Pop moved to
>   the top is a band 380 rows tall where its control's is 60. `EFFECTS.md`
>   §13 measured, per 10 s at 1080×1920, 2.61 s with a band overlay and
>   5.15 s with a full frame, against 1.75 s with no captions; a 1080×1920
>   export with Smart placement on is unmeasured. One band per third is
>   the lever.
> - **A clip at a speed other than 1**: a line is looked up on the caption
>   clock (no speed), the thirds are on the picture clock, so a line's
>   third can come from a shot other than the one on screen. The export's
>   cues already ignore speed; the same cause.
> - **libass draws Anton at about 0.57× the canvas painter's size** for the
>   same Pop style (`EFFECTS.md` §60): a plain-style export's captions are
>   about half the height the preview shows. Unrelated to placement; a
>   step of its own.
> - CI uploads no `tests/output/captions-free/`, so a red run shows only
>   the failure lines and the one notice; and two runs of `captionsFree.int`
>   at once clear each other's folder.

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

## 6. Step 3 — The graphics engine and the Director's third pass · 30.5 days

> **Revised 2026-10-21.**
>
> 1. **What was planned.** This section as written on 2026-10-05: six canvas
>    2D templates (counter, bars, steps, quote, callout, ring), the graphic
>    style, the `graphics@1` pass and its binding validator, 14.5 days. None
>    of it was built.
> 2. **Why it changed.** You asked for research before the three.js graphics
>    engine was planned. `docs/research/graphics-motion-research-2026-10-17.md`
>    (commit `4e59965`; 197 dated sources; no video watched, nothing
>    installed, no code) rated this section as written 4 of 10 against your
>    bar, raw footage that "will completely modify and look like pro", and
>    its recommended plan 6.5 (6 without the hand build). It kept the
>    architecture and found the coverage short: graphics fired only on said
>    numbers, lists, quotes and faces, at most three a minute, with no lines
>    or trees, no hands, no sound and no depth (the research, §0). Every
>    rating there is the research's inference; the first measurement of the
>    look is phase 2's blind look rating (§6.10, §6.12), with M14's curve
>    pick beside it.
> 3. **The answer.** On 2026-10-21 you took all twelve of the research's
>    decisions as recommended: "ive read you 12 recomondations as well wil go
>    with it". They are §16.54-65 (D1 = §16.54 … D12 = §16.65).
> 4. **What stays exactly as settled.** §16.7-11 (graphics above the look,
>    ungraded; `GraphicSpec`, with the old `GraphicsSpec` renamed
>    `CaptionLayersSpec`; one `SELF_DRAWN_FIELDS` constant; which graphics a
>    Clear removes; the validator's strictness); the Director contract; the
>    painter's contract of §6.2; the licences of everything already in use.
>    The research's "recommended against" list stays out (below, "What waits
>    and what is out").
> 5. **The shape.** Five phases: 0, measure, 2 days (§6.15); 1, the engine
>    and the motion module, 7.5; 2, the templates, the third pass, the
>    validator and sound, 14.5; the hand spike, 1.5, run during phase 2
>    (§6.17); 3, the three.js compositor and 2.5D, 5, two of them moved from
>    step 6 (§6.16). Then phase 4, the hand build, 6 days, only if the spike
>    passes its gate (§6.18, §6.12). §6.19 is the build order.
> 6. **The sub-section numbers §6.1-§6.12 keep their topics**, so the
>    references to them elsewhere in this file (§0's bar row, §7's day table,
>    §7.4, §7.5, §8.4, §8.7, §8.8, §9, §11, §15 rows 9-11) stay true. The new
>    material is §6.13-§6.21.
> 7. **The references were re-censused** at `4e59965` on 2026-10-21: §6.3's
>    and §6.4's had drifted since 2026-10-05 (the research's §7.1 found it).
>    Every `file:line` in this section was read at that commit; references
>    into this file are by section number.

**What it is.** A library of **typed parametric templates** (counter,
comparison bars, step list, quote card, callout, percentage ring, and since
2026-10-21 a keyword card and a lower third; a step list may carry a
connector or a tree) drawn by **pure frame functions**: live in the preview,
baked to PNG frames at export exactly as the moments engine is. A
creator-level **graphic style**. The Director's **third pass** over a
transcript:

1. spot the moment;
2. pick a template and copy its data;
3. a **validator** drops any graphic whose numbers or names were not said in
   that stretch;
4. word timings land the animation's beats on the spoken words;
5. free-space placement.

**The LLM never writes code**: it fills fields of a type the app defined.

**The engine, as re-planned** (§16.54-56). One pure function turns a spec, a
style and a frame into a **draw list** (strokes, text, shapes, images, a dim,
groups), and **two painters read it**: canvas 2D for every graphic, every
word through `drawTextOnto` so the 42 looks and Chromium's shaping apply
(§6.3), and a three.js compositor on the one shared renderer, only for a
graphic that asks for depth, a camera move or a glow (§6.16). **One motion
module** (`graphics/motion.ts`, §6.13) times every element. **One stroke
primitive** with a riding arrowhead draws arrows, underlines, connectors and
trees on (§6.3). **Three new shapes fire where no number is said**:
`keyword`, `lower-third`, and `steps` with a connector or a tree whose
parents the app computes (§6.2). A **dim** behind a graphic, holed around the
speaker (§6.3, §6.9). The library's own **sounds on a graphic's beats**,
under that graphic's own Clear (§6.14). **2.5D** variants of the counter and
the ring, and a screen recording shown as a 2.5D card (§6.16). And, behind a
measured gate, **the presenter's pointing finger**: a 1.5-day spike during
phase 2, a 6-day build only if the gate passes (§6.17, §6.18).

**The phases.** Each phase's exit is §6.12; the build order is §6.19.

| phase | what | days | of which | exit, in one line |
|---|---|---|---|---|
| 0 | measure the forks: M1-M5, M6's Indic and colour parts, M22, and M21 before phase 2's counter (§6.15; M7, the glow, opens phase 3) | 2 | 0.5 is §6.3's own measurement as written; 1.5 new | every number in `EFFECTS.md` §61 with its command; the bake region, pool depth, Indic animation unit and blur-rise chosen; M22's verdict on the canvas painter's Indic shaping |
| 1 | the engine and the motion module: the §16.8 rename, `SELF_DRAWN_FIELDS` and every guard, the draw list, the canvas painter, the stroke, the dim, `motion.ts`, the canvas, bake and export (§6.1, §6.3-§6.5, §6.13, §6.11) | 7.5 | about 5 of §6 as written; 2.5 new | the primitives' preview = export ≤ 1/255; the Indic render check; the render check frame-exact on both builds |
| 2 | the templates in nine shapes, the third pass, the validator, beats, placement and the budget, sound, the baseline and the eval (§6.2, §6.5-§6.10, §6.14, §6.11) | 14.5 | about 9 of §6; 5.5 new | the exit as written for nine shapes, plus the Indic check per template, the sound Clear test and the tree |
| spike | the hand spike, run during phase 2 (§6.17; §16.56) | 1.5 | new; mostly your runs | H1-H10, H12, H13 in `EFFECTS.md` §62; the gate passed or failed |
| 3 | the three.js compositor and 2.5D (§6.16; §16.55) | 5 | 2 moved from step 6's 3D templates; 3 new | M7's glow route chosen first; flat colour ≤ 2/255; Indic on a texture at 0.000; preview = export; WebGL missing tested |
| **step 3** | | **30.5** | §6's 14.5 + 2 from step 6 + 14 new | |
| 4 | the hand build, only if the spike passes its gate (§6.18) | 6 | new; in no total | the gate's figures on held-out clips; the line's tip on the marked fingertip |
| outside step 3 | the captions' per-word fallback (§16.61) and the two Indic fonts (§16.63), §6.20 | 1 | 0.5 new; 0.5 is `BETA.md` R14's own, pulled forward | counted in §2 beside the steps |

The split of §6's 14.5 days into "about 5" and "about 9" is the research's
estimate (its §7.3); §6 as written never itemised them.

**What stays settled.**

- **The Director contract**: the model never writes code, it fills typed
  fields of templates the app drew; a pass is validated whole and fails
  alone; grounding is checked over what the painter draws (§6.7's property
  test, now over the draw list's text items).
- **§16.7** graphics above the look, ungraded; **§16.8** `GraphicSpec`, and
  `GraphicsSpec` renamed `CaptionLayersSpec` as step 3's first commit;
  **§16.9** one `SELF_DRAWN_FIELDS` constant, done first (§16.8 and §16.9
  call that first slice "3a", a name written before Step P took it);
  **§16.10** Direct's graphics join `DIRECTOR_RULES`, Clip it's and the
  Transcript tile's have their own Clear; **§16.11** the validator's
  strictness as written.
- **The painter's contract of §6.2**, kept word for word and extended to the
  new shapes there.
- **The licences of everything already in use**: three, MediaPipe and the
  rest of the AI helper's pack, the asset library. Not reopened.

**What waits and what is out.** Two of your answers draw the line:

- **§16.57 (D4):** "Not in step 3. A screen recording gets the 2.5D card, a
  dim and graphics. Revisit with a one-day cursor-from-pixels spike only if
  users bring screen recordings; a recorder of our own is a separate
  project."
- **§16.64 (D11):** "Not in step 3. Vendor sources call emoji pops the cheap
  look [60], and the CC BY attribution question is open." (`[60]` is a
  source in the research's §8.)

What no phase of step 3 builds, and what it waits for (the research, §7.4,
one line each):

| pattern | waits for |
|---|---|
| click zoom, cursor smoothing, click ripples, keystrokes, a magnifier lens | cursor and click data: a recorder of our own (its own project) or a cursor finder over pixels (§16.57) |
| the product as the set, the cursor as actor | a designer's rebuild of a product's interface; not planned |
| grade and grain | nothing: the looks carry it, and graphics sit above the look (§16.7) |
| motion blur on fast moves | the look rating's motion-blur question answered yes (§6.10); then `tmix` (M4) or canvas subframes |
| text behind the subject | a full-clip person matte from the AI helper, its edges measured |
| emoji or hand stickers, Lottie accents, animated icons | an attribution decision and a player determinism check (§16.64); a check tick beside a `steps` item is the stroke primitive, a style option once the look rating's tick question asks for it (§6.10) |
| per-letter Indic kinetic type, a per-character typewriter | M3 (§16.61) |
| a code-terminal reveal | a source of the code's text; not researched |
| a card pop with ripple rings; confetti or particle bursts | the energetic style (§16.58), once the look rating's energetic question asks for more (§6.10); a burst seeded, fired by a word |
| an image or screenshot pop-up card | pictures to put in it: step 5's (§8) or yours; the draw list's `image` item is ready |
| frosted glass behind a card | M5's blur cost; the panel is a style property in phase 2, the glow phase 3's |
| masked or wipe text reveals, a marker sweep behind a word | a source that times them, then a look rating of them (§6.10) |
| B-roll or a picture over the speaker | step 5 (§8) |
| camera layouts (the speaker in a corner over a screen, a split) | a project of two sources, a layout of the reframe's kind; not planned |
| continuous transitions and match cuts | the eight transitions and the moments serve the cut; not planned |
| an end card with a call to action | the Director's end card for ads exists; for a talk, a `user`-mode field, not planned |
| a line chart drawing on; a before/after wipe | step 6's `timeline` and `before-after` (§9), on the same draw list |
| a progress bar or step counter | a timing source and a trigger beyond `steps` |
| shape morphs | an animator's tool; not planned |
| two-hand gestures, swipes, counted fingers, a thumbs badge, an open-palm reveal | rules on the hand track, after phase 4 passes |
| curves shared with captions and zoom punches | M14's pick and the look rating (§6.10), then their own change (§16.62, §6.13) |

**Out, never planned in step 3** (the research, §7.5): drawing flat graphics
through three.js, or making three.js the only painter; troika-three-text and
drei's `<Text>`; GSAP; Remotion; Theatre.js; Motion Canvas; Revideo; elkjs;
Rive; pmndrs `postprocessing` (its peer range pins three below 0.187,
whatever M7's scratch-branch leg records of its alpha); the canned
Gesture Recognizer as the pointing detector; Model Maker; marketplace
templates, CapCut materials and LottieFiles animations shipped as built-ins;
stock B-roll, emoji pops and hook-title boilerplate; a screen recorder;
splitting Indic text by code point; gesture reactions; a spring as the clock
of an arrival on a word, and stateful springs anywhere. Allowed when their
condition is met: `d3-hierarchy` and `d3-shape` (only if the tree needs more
than a fixed one-to-n layout, phase 2), `perfect-freehand` (after M10,
which runs it from a scratch branch, §6.15), `UnrealBloomPass` (three's own,
M7). Nothing is installed by this plan.

### 6.1 The spec — `Clip.graphic?: GraphicSpec`

**Phase 1 · 0.5 day.** The meaning of each template's fields is §6.2's, and
their values (`GRAPHIC_TEMPLATES`) are built in phase 2.

**The rename first (§16.8).** `src/shared/graphics/` already holds
`spec.ts`'s `GraphicsSpec` (`spec.ts:101`), the caption-layer scene for the
canvas bake and the dormant frame server. `GraphicSpec` would differ from it
by one letter, the trap `CLAUDE.md`'s anchor table records. So step 3's
first commit renames `GraphicsSpec` to `CaptionLayersSpec` and
`buildGraphicsSpec` (`fromTimeline.ts:82`) to `buildCaptionLayers`,
mechanically, with typecheck as the guard. Counted 2026-10-21 at `4e59965`
with `grep -rwo … src tests --exclude-dir=output`: 23 `GraphicsSpec` in 9
files (`spec.ts`, `fromTimeline.ts`, `captions/bake.ts`,
`main/graphics/tier2.ts`, `main/graphics/frameServer.ts`,
`renderer/src/graphics/main.ts`, `tests/graphics.test.ts`,
`tests/captionBake.test.ts`, `tests/integration/captionBakeTiming.int.test.ts`)
and 53 `buildGraphicsSpec` in 13 files (56 with three READMEs under the
gitignored `tests/output/`). §16.8 said 36 sites; whichever count was meant,
typecheck holds the rename. Neither new name occurs anywhere before the
commit (counted: 0). The file keeps its name and its other exports
(`Easing`, `GraphicsLayer`, `GraphicsFont`, `applyEasing`, `popIn`).
EFFECTS' dated records keep the old names, since they describe the code as
it was.

**The types**, in `src/shared/graphics/template.ts` (types only in phase 1):

- `GraphicTemplateId` = `'counter' | 'bars' | 'steps' | 'quote' | 'callout'
  | 'ring'` (as written) `| 'keyword' | 'lower-third'` (phase 2) `|
  'screen-card'` (phase 3, §6.16) `| 'timeline' | 'before-after' | 'versus'`
  (step 6) `| 'source'` (steps 5/6). **No ninth id (chosen 2026-10-21):**
  phase 2's ninth shape is `steps` with a connector, because a `tree` id
  would let the model choose a structure the app computes (the research,
  §4.5).
- `GraphicData`: §6.1's union as written for every member it had
  (`counter` `{ value; label }`, `bars` `{ title; items: { label; value }[] }`,
  `quote` with its `said` kind `{ text; speaker }` and its `social` kind
  `{ text; name; handle; date; link }` (§8.4), `callout` `{ label; shape:
  'arrow' | 'circle' }`, `ring` `{ value; label }`, `timeline` `{ items:
  { when; label }[] }`, `before-after` and `versus` `{ before, after }` and
  `{ left, right }` of `{ label; value }`, `source` `{ kind: 'wiki' | 'page'
  | 'headline' | 'answer'; title; excerpt; outlet; date }`), every value a
  string as said, with these changed or added:
  - `steps`: `{ template: 'steps'; title: string; items: { label: string;
    parent?: number }[]; connector: 'none' | 'line' | 'tree' }`. `parent` (an
    index into `items`, −1 the title) and `connector` are set by the app,
    never by the model (§6.2, §6.7).
  - `keyword`: `{ template: 'keyword'; words: string; lit: number }`, one to
    four said words in a contiguous run; `lit` an index into them.
  - `lower-third`: `{ template: 'lower-third'; name: string; role: string }`,
    `name` from `MediaAsset.speaker`, `role` typed by the user.
  - `screen-card`: `{ template: 'screen-card'; clipId: string; move:
    'tilt-in' | 'pull-back' }` (phase 3; no string field that is a claim, so
    the validator never sees it).
- `FieldMode` = `'verbatim' | 'grounded' | 'fixed' | 'speaker' | 'user' |
  'index'`. `index` is the research's one extension of §6.1 (its §4.5): a
  number pointing into another field, checked for range only (§6.7 rule 8).
- `TemplateDef` = §6.1's as written (`id`, `seconds: { min; default; max }`,
  `fields`, `kindFields?`, `fixedTitles?`, `pairs?`, `maxItems?`,
  `needsSubject?`, `threeD`), with `fields: Record<string, FieldMode>`,
  `kindFields?: Record<string, Record<string, FieldMode>>`, a new
  `appFields?: string[]`, and `threeD: boolean` read as "this template may
  ask for depth" (§6.16). `appFields` lists every field the app sets and no
  model is offered: `steps.parent`, `steps.connector`, `callout.shape`,
  `quote.speaker`, `lower-third.name`, and the screen card's `clipId` and
  `move` (§6.2's table). `quote.speaker` and `lower-third.name` keep their
  `speaker` mode, which the validator checks (§6.7 rule 8); the others take
  no mode.
- `GraphicSpec`, every field of §6.1 as written kept, `proposal?` widened,
  and `depth?`, `hero?` and `anchor?` added (typed in phase 1, set in
  phases 3 and 4):

| field | type | set by | holds |
|---|---|---|---|
| `data` | `GraphicData` | the model's fields, the app's, the user's | every string the painter draws, or the template's listed fixed glyphs |
| `seconds` | number | the app, inside `TemplateDef.seconds` | on screen |
| `beats` | number[] | the app, from word timings (§6.8) | when each element arrives, seconds from the clip's start; never the model's |
| `grounding?` | `{ assetId; sentence; words: number[] }` | the app | the transcript's asset, the cited sentence, the word index each beat landed on |
| `place` | `{ auto: true; third: 'top' \| 'middle' \| 'bottom' } \| { auto: false; box: UnitRect }` | the app (§6.9), or the user's drag | where it sits; `auto` is recomputed on rebake |
| `subject?` | `{ clipId; box: UnitRect; ms }` | the app, once, at onset (§6.9) | a callout's target and a dim's hole on the clip beneath, in source units |
| `sources?` | `{ title; url; outlet; date; licence }[]` | steps 5/6 | retrieved facts |
| `proposal?` | `{ reason: 'check-the-number' \| 'pointed'; wordSource?: 'youtube-asr' \| 'youtube-lines' \| 'whisper-unsure' }` | the app | a graphic the user keeps before it is placed (§6.6; `'pointed'` §6.18) |
| `style?` | string | the user | a `GRAPHIC_STYLES` id; absent is the project's |
| `seed` | number | the app | stored; never `Math.random` at draw time |
| `version` | number | the app | bumped on every edit; left out of every cache key |
| `depth?` | `'tilt' \| 'parallax' \| 'dolly' \| 'focus'` | the user, or the hero rule's `'tilt'`, phase 3 (§6.16) | only where `TemplateDef.threeD` |
| `hero?` | `true` | the app, phase 3 (§6.16) | its footage clip's hero graphic: the hero rule's tilt, and its glow under a style with `glow`; cleared by your Depth choice |
| `anchor?` | `{ assetId; event }` | the app, phase 4 (§6.18) | a `PointEvent.id` |

**Units.** Timings are in seconds, as `MomentSpec.seconds` is
(`timeline.ts:303`), so `project/frameRate.ts` needs no change: a frame-rate
change (`setFrameRate`, `store.ts:1970`) already calls `rebakeGenerated`
(`:1992`), which redraws a graphic through its arm (§6.4). The grounding's
word indices are stable under hand corrections: `withWordText`
(`transcript.ts:245-256`) changes a word's text, keeps its timing, takes an
emptied word out and renumbers nothing.

**On the project and the clip** (`src/shared/timeline.ts`), all optional, so
every saved project opens unchanged and the store's migration tolerates
their absence as it does `subjects` (`timeline.ts:967-974`):

- `Clip.graphic?: GraphicSpec` (beside `moment`, `timeline.ts:512`).
- `Project.graphics?: GraphicsSettings` = `{ styleId: string; overrides?:
  Record<string, unknown>; sound: boolean }`, beside `captions`
  (`timeline.ts:975`). `sound` is §6.14's, `true` when absent.
- Owned elsewhere, typed in the same commit so the file changes once:
  `Project.graphicProposals?: GraphicProposal[]`, `GraphicProposal` = `{ id:
  string; clipId: string; spec: GraphicSpec; rule: string; note: string }`,
  and `MediaAsset.speaker?: string` (§6.6; §16.31 decided the field, which
  does not exist at `4e59965`); `Clip.forGraphic?: string`, a sound clip's
  graphic clip id (§6.14). Not here: `Clip.pointing?: true` and
  `Project.hands?: Record<string, HandTrack>` are added by phase 4 with
  `src/shared/hands/types.ts` (§6.18), since `HandTrack` does not exist
  before the spike writes that file, and phase 4 may never be built.
- **(box)** `MediaAsset.frames.box?: { x: number; y: number; width: number;
  height: number }` (`frames` is `timeline.ts:141-145`), written only by the
  export's own bake and only if M1 chooses the box (§6.3, "The bake
  region").

**Every graphic clip id is app-minted**: the store's
`graphic-<base36 time>-<5 base36>`, as the card ring's `ring-…` is
(`store.ts:3378`), and the
Director's through `ApplyContext.newId` (`director/apply.ts:83`, default
`:179`), never a string from a model or a transcript, because clip ids
become frame-cache paths unsanitised (`writeTitleFrame`,
`src/main/titles.ts:143-150`, the `.seq` folder at `:148`).

### 6.2 The templates — eight ids, nine shapes

**Phase 2 · 4 days.** Phase 2 draws §6.2's six templates as written, plus
`keyword`, `lower-third` and `steps` with a connector: eight
`GraphicTemplateId`s, nine shapes (§6.1: no ninth id; the tree is `steps`
with `connector: 'tree'`, set by the app). D1 (§16.54) is the scope.

Each template is one pure function in `src/shared/graphics/templates/<id>.ts`
(`lowerThird.ts` for `lower-third`): `draw<Id>(spec, style, clock: { t:
number; fps: number }, size, measure, targets): DrawOut`, with `t` in
seconds from the graphic clip's start, registered as its row of `DRAWERS`
(`templates/index.ts`, §6.3). `DrawOut` = `{ items: DrawItem[]; camera?:
Camera; glow?: GlowRequest[] }` (§6.3), typed in phase 1 so that phase 3's
depth branches and glow (§6.16) need no change to any drawer's signature;
in phases 1 and 2 a drawer returns `items` only. `drawListAt` (§6.3) calls
it. A template uses only §6.3's item kinds (`stroke`, `text`, `shape`,
`dim`, `group`; `image` waits for phase 3's screen card and step 5's
pictures) and §6.13's motion exports. It never paints, never
measures text except through the injected `measure`, never reads the project
(`targets` carries what it needs of the footage), and never formats a
string except through `graphics/numbers.ts`. Its curves come only from
`graphics/motion.ts` (D9, §16.62); its strokes take the style's
`strokeLook`, `clean` unless M10 has passed (D7, §16.60); and no template
draws an emoji, a sticker or a Lottie accent (D11, §16.64).

**The nine shapes.** Seconds are on screen, the lead included; they are
proposals until M16.

| shape | draws | beats (each a bound word's start, §6.8) | seconds min / default / max | fields (mode) |
|---|---|---|---|---|
| `counter` | a number counting up from 0 and **arriving at the value on the word that says it**, with the label beneath | 1: the value's word | 2 / 3 / 4 | `value` grounded (a number), `label` grounded; **paired** |
| `bars` | 2-5 horizontal bars, each growing to its value on its own word; labels and values beside them | one per item: its value's word | 3 / 5 / 6 | `title` grounded or fixed ('By the numbers', 'Compared'); each item **paired** (`label`, `value`), both grounded; every matched stretch number shares one unit |
| `steps` (connector `none`) | a numbered list, one row arriving per item as it is said | one per item: its label's first bound word | 3 / 6 / 8 | `title` grounded or fixed ('Step by step'); item `label` grounded; `parent` and `connector` set by the app |
| `steps` with `connector: 'line'` or `'tree'` | as `steps`, plus strokes. `line`: a rule joining the numerals, each segment drawn on into its row. `tree`: the title as the root, and an elbow edge from each item's parent drawn on into the item, ending in an arrowhead | as `steps`; each edge arrives with its item | 3 / 6 / 8 | as `steps`; `connector` and every `parent` set by the app (the tree, below) |
| `quote` | the said line in quotation marks, each word lit as it is spoken, the speaker beneath | one per word, unspread (§6.8) | 2 / 4 / 6 | `text` verbatim, clause to clause, at most 16 words (proposal); `speaker` speaker (§6.7 rule 8). Its `social` kind (step 5, §8.4): `kindFields.social`, every field `user`, typed by the user; nothing fetched from X, no X logo or avatar, not shaped as a post |
| `callout` | an arrow drawn on to the subject box, or a ring drawn round it, with a label | 1: the label's first bound word | 1.5 / 2.5 / 3 | `label` grounded; `shape` set by the app; `needsSubject` (a face track, §12) |
| `ring` | a ring filling to the percentage and arriving on the word, the value inside | 1: the value's word | 2 / 3 / 4 | `value` grounded, and **the matched stretch number carries `%` (or "percent")** and is ≤ 100; `label` grounded; **paired** |
| `keyword` | one to four of the speaker's own words on a card, one of them lit | 1: the run's first word | 1.5 / 2.5 / 3.5 | `words` verbatim (a contiguous run of 1-4 said words, §6.7 rule 9); `lit` index |
| `lower-third` | the speaker's name and, when typed, their role, low in the frame or in the free third | 1: the speaker's first word the clip shows | 2.5 / 3.5 / 5 | `name` speaker (only `MediaAsset.speaker`); `role` user |

**`GRAPHIC_TEMPLATES`**, the values of `graphics/template.ts`'s record (the
types are §6.1's):

| id | `fields` | `fixedTitles` | `pairs` | `maxItems` | `appFields` | `needsSubject` | `threeD` | offered to the model |
|---|---|---|---|---|---|---|---|---|
| `counter` | `value` grounded, `label` grounded | — | `[value, label]` | — | — | — | true (phase 3) | yes |
| `bars` | `title` grounded, `items.label` grounded, `items.value` grounded | 'By the numbers', 'Compared' | `[items.label, items.value]` | 5 (at least 2) | — | — | false | yes |
| `steps` | `title` grounded, `items.label` grounded | 'Step by step' | — | 6 (at least 2) | `parent`, `connector` | — | false | yes |
| `quote` | `text` verbatim, `speaker` speaker; `kindFields.social`: `text`, `name`, `handle`, `date`, `link` all user | — | — | — (16 words, §6.7 rule 9) | `speaker` | — | false | yes, the `said` kind only |
| `callout` | `label` grounded | — | — | — | `shape` | true | false | only when the clip has a subject track (§6.6) |
| `ring` | `value` grounded, `label` grounded | — | `[value, label]` | — | — | — | true (phase 3) | yes |
| `keyword` | `words` verbatim, `lit` index | — | — | — (4 words, §6.7 rule 9) | — | — | false | yes |
| `lower-third` | `name` speaker, `role` user | — | — | — | `name` | — | false | never |
| `screen-card` (phase 3, §6.16) | none (`{}`) | — | — | — | `clipId`, `move` | — | true | never |

`threeD` is read as "may ask for depth" (§6.16). The screen card's seconds
are 1 / 10 / 600 (proposal; its `seconds` is the recording clip's length)
and its one beat is its landing (§6.16). The other ids (`timeline`,
`before-after`, `versus`, `source`) carry the entries their own steps write
(§9, §8); the menu never offers them, nor `screen-card` (§6.6).

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

Extended on 2026-10-21 for the new shapes:

- **`keyword` draws its words verbatim**, one text item per word (`source:
  { path: 'data.words', piece: i }`), so the pieces joined by single spaces
  equal `data.words` with its whitespace normalised. `lit` changes the lit
  word's colour (`palette.accent`, through its `look.accent`, §6.3) and
  draws an underline stroke beneath it, and nothing else: never its text,
  case or order.
- **`lower-third` draws `name` exactly as `MediaAsset.speaker` holds it and
  `role` as the user typed it**, and adds no glyph.
- **`quote`** draws its words one text item per word, as `keyword` does;
  its marks and the dash before the speaker are the style's fixed glyphs.
- **A connector or a tree adds strokes, arrowheads and dots, never a glyph
  that is a text claim.** The step numerals ("1" to "6", restarting under
  each parent in a tree) stay fixed glyphs.
- **No Hindi or Telugu string is drawn in pieces smaller than a word** (D8,
  §16.61). A field drawn word by word is split on whitespace only; every
  other field is one text item, drawn whole by one `drawTextOnto` call
  (§6.3). Clusters only for a script in `CLUSTER_SCRIPTS` (§6.3), which is
  empty until M3.

| template | fixed glyphs |
|---|---|
| `counter`, `bars`, `callout`, `keyword`, `lower-third`, `screen-card` | none (an arrowhead or a bezel is a stroke, not a glyph) |
| `ring` | `%`, appended to the value's text item only when `data.value` carries neither `%` nor a percent word; every kept ring's matched number carries one (§6.7 rule 9) |
| `steps` (any connector) | the numerals "1" to "6" |
| `quote` | the style's opening and closing marks, and "— " before the speaker |

**The draw lists.** Every list starts, when the resolved style's `dim` is
true, with a `dim` item fading in over `DURATIONS.dim` (§6.13) from t = 0,
its hole round `targets.subject` (fixed at onset, §6.9), and no hole when
that is null. The exit is never drawn: it is the clip's opacity keys over
its last `EXIT_S` (§6.3). Item ids are stable across frames (`value`,
`row-2`, `edge-2` …), as §6.3 requires.

| template | items | what moves, and what arrives on the beat |
|---|---|---|
| `counter` | `panel` shape (rounded; drawn only when `palette.panelOpacity` > 0), `value` text, `label` text | the group enters from t = 0 with `style.motion.entrance` over `DURATIONS.entrance`; `value`'s string is `inBetween(data.value, p)` with p = `progress(t, 0, beat, style.motion.ease)`, so the count runs over the lead and lands on the beat; from the beat on it is `data.value` itself |
| `ring` | `track` (a ring shape, `sweep` 1, `palette.muted`), `arc` (a ring shape, `start` −π/2), `value` text, `label` text | `arc.sweep` = (n ÷ 100) × p, with n from `numberOf(data.value)` and p as the counter's; `value` counts as the counter's, with the `%` glyph when due |
| `bars` | `title` text; per item `track-i` and `bar-i` (rect shapes), `label-i` and `value-i` text | each bar's width is its `numberOf` share of the largest, times p over `DURATIONS.entrance` ending on its beat; its label enters with it; its value counts as the counter's over the same span |
| `steps` | `title` text; per item `num-i` (a fixed glyph) and `label-i` text, grouped as `row-i` | each row enters over `DURATIONS.entrance`, ending in place on its beat |
| `steps`, `line` | as `steps`, plus `edge-i` strokes (i ≥ 1) from the numeral above to row i's numeral, round caps, no heads | `edge-i` draws on (`from` 0, `to` p) over `DURATIONS.stroke`, ending on row i's beat |
| `steps`, `tree` | as `steps`, the title at the top as the root, each row indented by its depth (at most two levels); `edge-i` an elbow path from its parent's numeral (or the title's marker) down and across to row i, with a rounded corner, `heads.end` an `Arrowhead` | `edge-i` draws on over `DURATIONS.stroke` ending on row i's beat; its head rides the tip, growing in over its first 0.1 s (§6.3); the row enters on the beat |
| `quote` | `open` glyph, one `word-i` text item per word laid out in lines by `measure`, `close` glyph, `speaker` text after the "— " glyph (absent when `speaker` is '') | everything enters together, ending on the first beat; the lit word is the one whose beat is the latest at or before t, held until the next (the captions' rule, `activeWordAt`, `captions/line.ts:125`), drawn in `palette.accent` (its `look.accent`, §6.3), the rest in the text style's own fill |
| `callout` | `stroke` (`shape: 'arrow'`: a quadratic curve from the label's nearest edge to the subject box's nearest edge, bowing away from the frame's centre, `heads.end`; `shape: 'circle'`: a closed path round the subject box, padded 12 %, proposal), `label` text | the stroke draws on over `DURATIONS.stroke` ending on the beat; the label enters from the beat. The app sets `shape`: `circle` when the label fits beside the subject in the same third, else `arrow` |
| `keyword` | `panel` shape (rounded), one `word-i` text item per word, an `underline` stroke under the lit word (round caps, no head, `palette.accent`, 0.08 of the word's pixel size thick, its baseline plus 0.12 of that size below it; proposal) | the card scales from 0.92 (proposal) with a rise and fade (`style.motion.entrance`; `pop` with `out-back` in `energetic` only, D5, §16.58), arriving on the beat; the words stagger 0.05 s each (proposal, the research's §1.2 row 1), the last arriving on the beat; `underline` draws on left to right (`from` 0, `to` p) over `DURATIONS.stroke`, ending on the beat; the lit word in `palette.accent` throughout. The underline is the research's "underline" use of the stroke (its §7.2 item 3) |
| `lower-third` | `bar` (a rect shape in `palette.accent`), `name` text, `role` text (absent when '') | the bar grows to full width over `DURATIONS.entrance`, ending on the beat; `name` rises from behind it with it; `role` follows 0.1 s later (proposal) |

From the last beat plus `SETTLE_S` the list is constant, so the moving frames
end there (`graphicMovingFrames`, §6.3) and `tpad` holds the rest. The one
exception in phase 2 is optional: in the `energetic` style only, a `line`
connector may carry a **travelling beam** (a short span whose `from` and
`to` both advance, `linear`, a 5 s loop, the research's §4.4), at most once
per clip. Every frame of its hold then moves, so it bakes the whole hold
(`graphicMovingFrames` returns the clip's frames for it, §6.3); it stays off
until M1's verdict on that cost is in EFFECTS §61 (§6.15).

**The layout** (added 2026-10-21 so the eight drawers are built to one
geometry; every figure a proposal, set against the sample tiles in phase 2
and revised with the look rating, §6.10). Sizes are fractions of the output
frame's short side, `s`; positions are output pixels.

- **The content rect.** With `place.auto`, the chosen third (the frame's
  full width, a third of its height), inset at each side by `TITLE_SAFE`
  (0.05, `timeline.ts:757`) of the width, and, where the third meets the
  frame's top or bottom edge, by `TITLE_SAFE` of the height. With `auto:
  false`, the dragged box itself. The graphic is centred in it, except the
  lower third, which sits at its left.
- **Wrapping.** `textItems` wraps a field at the content rect's width, never
  wider than 0.8 of the frame's width (`measure`, §6.3).
- **Too big.** If the laid-out graphic is taller or wider than the content
  rect, every size below scales down together to fit, never below 0.6 of
  the table; past that the graphic is dropped with a note ("too long to fit
  its place").

| template | text sizes (px, of `s`) | geometry |
|---|---|---|
| `counter` | `value` 0.11, `label` 0.045 | value above label, 0.25 × the label's px apart; the panel round both, padded 0.6 × the label's px, corner `style.radius` |
| `ring` | `value` 0.07, `label` 0.045 | ring 0.28 across, track and arc 0.025 thick; value centred inside; label beneath, 0.3 × its px below the ring |
| `bars` | `title` 0.05, `label-i` and `value-i` 0.04 | a label column of 0.3 of the content width; tracks over the next 0.55, each 0.6 × the label's px tall; values at the bar's end; rows 0.5 × the label's px apart |
| `steps` (any connector) | `title` 0.05, `num-i` and `label-i` 0.045 | a numeral column 0.07 wide; rows 0.6 × the label's px apart; a tree indents a child 0.06; edges leave the numeral's left middle |
| `quote` | words 0.055, marks 0.09, `speaker` 0.035 | lines wrapped as above; the speaker right-aligned beneath, 0.5 × its px below |
| `callout` | `label` 0.045 | the label with a panel as the counter's, beside the subject in the third, on the side with more room |
| `keyword` | words 0.08 | one line where it fits; the panel padded 0.5 × the words' px |
| `lower-third` | `name` 0.05, `role` 0.035 | left-aligned; `bar` 0.008 tall, under the name, as wide as the name plus 0.04 |

**`graphics/numbers.ts`.** `inBetween(value: string, fraction: number):
string` reads the value's own format off `value`: a leading currency sign or
minus; the digits and their grouping (western 3-3, Indian 3-2-2, or none);
the decimal places as written; the digit script (ASCII, Devanagari, Telugu
and the other blocks §6.7 rule 3 lists, kept as written); and any suffix
(`%`, `k`, `million`, `lakh`, "percent" …). It returns the value times
`fraction`, rounded to the value's own decimals and written back in the same
grouping, script, prefix and suffix. At `fraction` ≥ 1 it returns `value`
itself, unchanged. A value with no digits, or with two numbers
("1,000-2,000"), has no in-between: it appears whole on its beat.
`numberOf(value: string): number | null` gives a bar or a ring its size.
Nothing calls `toLocaleString`. The counter's Hindi digits follow what the
installed speech model writes (M21, measured before the counter is built).

**The tree — `graphics/tree.ts`.** The app computes the parents; the model
never fills them (the research, §4.5).

- `treeParents(items: { label: string }[], title: string, words: Word[]):
  number[]` returns one parent per item: `-1` is the title, any other value
  an earlier item. `words` are the stretch's words, from the first item's
  first bound word to the last item's last. Each label's run is found in
  spoken order with `claims.ts`'s `claimToken` (named apart from
  `automation/keywords.ts`'s ASCII-only `normaliseToken`, `:50`, which maps
  Hindi and Telugu to '').
- **Rule 1.** Every parent is `-1` by default: one root, every item its
  child, in spoken order.
- **Rule 2, a sub-count (English, v1).** Between item j's run and item j+1's,
  the words may say a count governed by item j: a number from two to six, in
  digits or as an English number word, within two tokens of one of `parts`,
  `things`, `steps`, `ways`, `kinds`, `types`, `reasons`, `points`,
  `pieces`, `stages`, `options` (a proposal; the nested fixtures may extend
  it). "Plan, which has two parts: budget and timeline. Second, shoot" is
  the case. The next k items, k being that count, then take j as their
  parent. If k is more than the items left, nothing nests. A child's own
  count is ignored, so depth is at most two.
- **Hindi and Telugu: flat in v1.** No cue list exists for them, as none
  exists for their number words (§16.11). Their nested fixtures are scored,
  not passed (§6.10).
- `parentsValid(parents: number[]): boolean`: every parent is −1 or an
  earlier index, and no parent's own parent is other than −1 (one root,
  depth ≤ 2).
- **The connector is the app's.** It is `tree` when any parent is ≥ 0 (a
  nested enumeration), `line` for three or more items, and `none` for two.
  The dock may change it (§6.6): `tree` on a flat list draws the title
  fanning out to each item. A fixed one-to-n layout serves six nodes in two
  levels, so `d3-hierarchy` is not taken; it was a "try" only beyond that
  (the research, §4.9).

**Reading holds (M16).** A graphic's seconds are the largest of three: the
template's `seconds.min`; its last beat plus `TAIL_S`; and `LEAD_S` plus
`readingSeconds(drawn text)` plus `EXIT_S`. That figure is held to the
template's `seconds.max`. A graphic that needs more than the max is dropped
with a note ("said over 9 s; a steps card holds 8").

`readingSeconds(text: string): number`, in `graphics/beats.ts`, is the
text's grapheme count ÷ 20: Netflix's 20 characters a second, the research
[33], counted with `graphemeCount` (`ingest/captions.ts:57`, through
`Intl.Segmenter`) so a Hindi vowel sign is not a character of its own. The
stricter rule, twice at 200 words a minute (0.6 s a word, the research
[34]), is printed by M16 and not enforced until its result is read into
EFFECTS §61. A template whose seconds do not hold its longest fixture label
gets its seconds raised in the table above or its label capped, decided in
phase 2 (§6.15, M16).

**Fixtures for drawing**, `tests/fixtures/graphics/specs.json`: one
`GraphicSpec` per shape in English, Hindi and Telugu, 27 in all, each with
its beats, place and seed, the longest label each template allows among
them. The Hindi and Telugu strings are written or checked by you (§6.10's
"Your part"). `graphicFrame`, `graphicPaint`, `graphicHolds`, the harness's
`templates` option and phase 2's Indic render check (§6.11) all read them.
That check draws them with the bundled Noto Sans Devanagari and Noto Sans
Telugu (D10, §16.63; §6.20), not whatever fallback each OS resolves.

**Tests** (each mutation must fail its test; §6.11 indexes them by phase):

- **`tests/graphicFrame.test.ts`, phase 2's cases.** For each of the 27
  fixtures, at the settled frame the draw list's text items are every `data`
  string verbatim (a per-word field's pieces joined) and nothing else but
  the template's listed fixed glyphs; each element arrives on its beat
  frame; the counter's, ring's and bars' in-between strings are ≤ the value
  and in its own format ("10,00,000" counts through "9,50,000", never
  "950,000"; "₹500" through "₹250"; "४०%" stays Devanagari); the ring's `%`
  only when the value lacks one; `keyword` draws its words as said, `lit`
  changing a colour and no text, its `underline` stroke spanning the lit
  word's box and reaching `to` 1 on the beat frame, not before;
  `lower-third` draws the speaker's name and
  the role as typed; a connector or a tree adds no text item; per template,
  the list at the last moving frame deep-equals the list at the clip's last
  frame. Mutations: in-between numbers formatted western always; a ring that
  always appends `%`; the lit word upper-cased; rows one frame late; the
  underline drawn under word 0 whatever `lit` says.
- **`tests/graphicHolds.test.ts`** (M16). Per template and language
  (English, Hindi, Telugu), the longest fixture label's reading time, in
  graphemes through `graphemeCount` at 20 a second, fits its seconds; the
  0.6 s-a-word figure is printed beside it; a template whose maximum is
  short fails, naming the label. It pins the grapheme count of one Hindi and
  one Telugu label. Mutations: seconds taken as `seconds.min` without the
  reading time (the longest fixture fails); characters counted as UTF-16
  units (the pin fails); words counted with empty strings.
- **`tests/graphicTree.test.ts`.** On the three English nested-enumeration
  fixtures (§6.10) `treeParents` gives the expected parent lists exactly;
  over generated item lists every computed parent points backwards
  (`parents[i] < i`, `-1` the title) with exactly one root and depth ≤ 2;
  `parentsValid` refuses a forward parent and two levels below a child; the
  connector rule. Mutations: `parentsValid` accepting a forward parent (the
  property fails); rule 2 applied to a child's own count (depth 3); every
  item parented to the title where the fixture nests (the exact match
  fails).

**Days: 4** (phase 2): the eight draw files (nine shapes) on §6.3's primitives
and the layout above, `numbers.ts`, `tree.ts`, `GRAPHIC_TEMPLATES`, the
fixtures' wiring and the three tests above.

### 6.3 Drawing: one draw list, two painters, preview, bake, export

**Phase 1 · 4 days.** One engine from the first commit (§16.54, D1): a pure
function returns a draw list, and painter A (canvas 2D, here) or painter B
(three.js, §6.16) draws it. It replaces §6.3 as written thus (the research,
§7.2 item 1): `frame.ts`'s `graphicParams` and `layout` fold into
`drawListAt`; `paint.ts`'s `drawGraphicOnto` becomes `paintDrawList2d`,
which draws every text item through `drawTextOnto` verbatim and so can
format nothing; `strokeAt` is new; `graphicCanvas.ts` keeps its name and
its three jobs.

**The files.**

| file | holds | where it runs |
|---|---|---|
| `src/shared/graphics/drawList.ts` | `drawListAt`, `needsCompositor`, `graphicBox` | node and renderer, pure; the only importer of `templates/index.ts` |
| `src/shared/graphics/items.ts` | the `DrawItem` types, `Drawer`, `DrawOut`, `textItems`, `textSpecOf`, `itemBounds`, `unitFor`, `CLUSTER_SCRIPTS` | pure; the templates import this, never `drawList.ts`, so no import cycle runs through `templates/index.ts` (`textItems` reads `unitFor`, so the two live together) |
| `src/shared/graphics/templates/index.ts` | `DRAWERS: Partial<Record<GraphicTemplateId, Drawer>>`, created empty in phase 1; each template's commit adds its own row (§6.2) | pure |
| `src/shared/graphics/stroke.ts` | `flattenPath`, `strokeAt`, the head's geometry, `STROKE_TOLERANCE` | pure |
| `src/shared/graphics/frame.ts` | `graphicMovingFrames`, `beatFrame`, `graphicExitKeys`, `drawnGraphicAsset` | pure |
| `src/shared/graphics/targets.ts` | `graphicTargetsAt` | pure |
| `src/shared/graphics/paint.ts` | `paintDrawList2d`, `STROKE_MIN_PX` (`/// <reference lib="dom" />` scoped to the file, as `textPaint.ts:1-5`) | renderer |
| `src/renderer/src/graphicCanvas.ts` | preview, bake, frames for the harness; `GRAPHIC_BAKE_REGION`, `GRAPHIC_POOL_DEPTH` | renderer |
| `src/renderer/src/encodePool.ts` | `encodeFrames`, the `toBlob` pool | renderer |

**`encodePool.ts` is extracted, `captionBake.ts` is not touched.** The pool
is `captionBake.ts:129-196`'s pattern (four canvases, an encode in flight
per canvas, measured 1000 ms serial to 264 ms at four for 60 pictures,
`:119-128`), written once as `encodeFrames({ count, width, height, depth,
draw: (ctx, index) => void, write: (index, bytes) => Promise<string>,
cancelled: () => boolean }): Promise<string | null>`, written in phase 0
(§6.15's piece 0.2) so that M1 and M2 measure the code that ships. The
caption bake keeps its own loop in step 3: it writes a concat list and has
no supersede guard, and moving it is a change to a render-checked path with
nothing gained here.

#### The draw list

`drawListAt(spec: GraphicSpec, style: GraphicStyle, frame: number, fps:
number, size: { width: number; height: number }, measure: TextMeasure,
targets?: GraphicTargets): DrawList`, where `DrawList` = `{ width: number;
height: number; items: DrawItem[]; camera?: Camera; glow?: GlowRequest[] }`.
It looks up `DRAWERS[spec.data.template]` (a `Drawer` is §6.2's `draw<Id>`,
`t = frame / fps`), calls it, and copies the `DrawOut`'s `items`, `camera`
and `glow` onto the list; for a template with no drawer it returns an empty
list. It is pure: no `Math.random`, no clock, `seeded()` (`moment.ts:101`)
drawn in a fixed order from `spec.seed`, so the same arguments give a
deep-equal list.

**The drawer seam** (phase 1 has no template). `drawListAt`, `graphicBox`
(below) and the renderer's `graphicPreviewCanvas`, `bakeGraphicSequence` and
`graphicFrameCanvases` take an optional last argument `drawer?: Drawer`,
which defaults to `DRAWERS[spec.data.template]`. Phase 1's tests and the
harness's `primitives` option pass a hand-built drawer that returns fixed
lists, so the draw list, the box, the paint and the bake are all exercised
before phase 2 writes a template. **The primitives' spec** is
`PRIMITIVES_SPEC` in `harness/graphicCheck.ts`: a `counter` spec with beats
at 0.5 and 1.0 s, `seconds` 2, seed 1, drawn only through that drawer.
`DRAWERS` is a frozen record, never mutated at run time (no `registerDrawer`),
and no production caller passes `drawer`: the store, the Preview and the
export reach a graphic only through its template's row.

Every `DrawItem` carries `id: string` (stable per element across frames),
`opacity: number`, `transform?: { x; y; scale; rotate }` (frame pixels and
degrees, about the item's own centre, as `itemBounds` gives it), and `z?:
number` (phase 3's planes). Units: `Rect` = `{ x; y; width; height }` and
`Point` = `{ x; y }` are output-frame pixels; `UnitRect` is
`reframe/types.ts:18`'s 0..1. The kinds:

| kind | fields | drawn by painter A as |
|---|---|---|
| `stroke` | `d` (SVG path data, frame px), `from`, `to` (fractions of length), `width`, `color`, `cap: 'round' \| 'butt' \| 'square'`, `join: 'round' \| 'miter' \| 'bevel'`, `dash?: { pattern: number[]; offset }`, `heads?: { start?: Arrowhead; end?: Arrowhead }`, `look?: 'clean' \| 'marker'`; `Arrowhead` = `{ size; grow }` (grow 0..1) | the visible span's polyline, heads riding its ends (below) |
| `text` | `text` (drawn whole, never split by the painter), `look: TextLook`, `box: Rect`, `source?: { path: string; piece: number }`; `TextLook` = `{ textStyleId; font; px; align: 'left' \| 'center' \| 'right'; accent?: string }` | one `drawTextOnto` call, whole |
| `shape` | `shape: 'rect' \| 'rounded' \| 'circle' \| 'ring'`, `box`, `radius?`, `sweep?` (a ring's arc, 0..1), `start?` (radians), `fill?`, `stroke?: { color; width }`, `shadow?: { blur; dy; color; opacity }` | `rect`, `roundRect` (already used, `maskPreview.ts:139`), `ellipse`, a ring as an `arc` of `sweep × 2π` from `start` |
| `image` | `src` (an asset path joined by `assetPath.ts`), `box`, `fit: 'contain' \| 'cover'` | `drawImage` of the bitmap `options.images` holds for `src`, which the caller decoded first (below) |
| `dim` | `color`, `alpha`, `hole?: { box: Rect; radius; feather }` | below |
| `group` | `children: DrawItem[]` | its children, with its opacity and transform applied to them |

`Camera` = `{ tilt; yaw; dolly; fov; focus?: { z: number; px: number } }`
(degrees; dolly 0 is flat; `focus`, added for §6.16, is the depth in focus
and the blur in frame pixels per frame height of distance from it).
`GlowRequest` = `{ item: string; radius; strength; color? }`. `TextMeasure`
= `(text: string, look: TextLook) => { width; ascent; descent }`, injected.
`camera`, `glow` and `z` are typed here and given meaning by §6.16. A
`Drawer` emits them, through its `DrawOut` and its items' `z`, only when
`spec.depth` is set or the spec is its clip's hero under a style with
`glow` (§6.16's two rules, both phase 3), so in phases 1 and 2
`needsCompositor(list)` is false for every list (a test pins it). `needsCompositor(list: DrawList): boolean`
is true when any item carries `z`, or the list carries `camera` or a
non-empty `glow`; painter A ignores all three.

#### Text items and their units

- **One line per item, drawn whole.** A field that wraps is laid out by
  `textItems` into one item per line, or per word, using `measure`; the
  painter never splits, joins or re-cases a string. `source.path` names the
  `GraphicData` field it came from (`items.2.label`); `source.piece` is its
  index when a field is drawn as more than one item, in reading order. An
  item with no `source` must be one of its template's listed fixed glyphs
  (§6.2), which is how the property test (§6.7) tells a claim from a glyph.
- **The unit** is `unitFor(text: string, wanted: 'line' | 'word' |
  'cluster'): 'line' | 'word' | 'cluster'`: `'line'` and `'word'` as asked;
  `'cluster'` only when the text holds no shaped script (`shapedScript`,
  §6.20) or every shaped script in it is in `CLUSTER_SCRIPTS` (Unicode
  script names, `readonly string[]`, **empty until M3 clears one**);
  otherwise `'word'`. Words split on whitespace; clusters through
  `Intl.Segmenter` with `granularity: 'grapheme'`, as
  `ingest/captions.ts:49-64` already does, and `'word'` where it is missing.
  **Never a code point**, the defect D8 fixes in the captions (§6.20). Per
  word is the default everywhere (D8, §16.61).
- **A text item becomes a `TextSpec`** through `textSpecOf(text, look,
  box)`, every required field of `TextSpec` (`timeline.ts:646-722`) set:
  `version: 0`; `content` the text; `font` = `look.font`; `size` =
  `look.px / box.height`; `color: '#FFFFFF'` and `weight: 700`, both read
  only on the styleless route, which a graphic never takes (its `styleId`
  always resolves: below); `align` from the look; `position: 'center'`;
  `tracking: 0`; `uppercase: false`; `shadow: 0`, `stroke: 0`,
  `strokeColor: '#000000'` (no outline or shadow of the spec's own: a
  panel's shadow is the style's, a text's the text style's); `styleId` =
  `look.textStyleId`; `margin: 0`; `offsetX` and `offsetY` 0; no
  `animationId`; and `highlight` = `{ word: 0, color: look.accent }` when
  `look.accent` is set, absent otherwise. Painter A translates to the box
  and calls `drawTextOnto(ctx, spec, box.width, box.height)`
  (`textPaint.ts:44`).
- **Where a text item's colour and weight come from** (corrected
  2026-10-21 by the review). When `spec.styleId` resolves, `drawTextOnto`
  paints with the text style's own fill and weight: the style
  (`textPaint.ts:58`) gives each row its `paintForLine` (`:102`),
  `fontString` draws `paint?.weight ?? spec.weight` (`:286-291`) and the
  fill pass sets `fillStyleFor(ctx, paint.fill, …)` (`:425-427`); `spec.color` reaches the canvas only through `plainPaint`
  (`:274-275`) on the styleless route. All 23 text styles a graphic may use
  set `base.weight` and a solid or gradient fill (counted with node 24
  importing `TEXT_STYLES`). So **a graphic's ink and weight are its text
  style's** (§6.5 picks each preset's text style for that), and `TextLook`
  carries no `color` or `weight`. The one colour a graphic sets on text is
  a lit word's: `look.accent`, set only on a one-word item (a `keyword` or
  `quote` word), reaches the paint through `highlight`
  (`textPaint.ts:159-176`), the captions' own per-word override, which
  replaces that word's fill (and its size, when a scale is given, which a
  graphic never gives) and keeps the style's glow, outline and shadow. The box's height is `round(px × LINE_HEIGHT)`
  (`textLayout.ts:38`), so `layoutText` (`textLayout.ts:40-86`, which wraps
  nothing: it splits on `\n` only, `:43`) puts the baseline where
  `drawListAt` measured it. `textSpecOf` is pure and shared, so the
  renderer's `TextMeasure` measures the very spec the painter draws.
- **The measure.** In node a fake (a width per grapheme of 0.55 of the
  pixel size, deterministic). In the renderer, `measureText` on a scratch
  context set with the font and letter spacing the painter will use, which
  `textPaint.ts` exports as `textSpecFont(spec): { font: string;
  letterSpacing: string }` (the shorthand `fontString` builds at
  `textPaint.ts:286-291`, with the face's `sizeScale` and `tracking`), so
  measure and paint cannot read two fonts.
- **Only text styles that keep the words as given.** A text style's face
  can re-case (`paint.uppercase`, applied at `textPaint.ts:106`), which
  draws a string the data does not hold (§6.2's contract), or light one word
  of each line (`accentScope` `'firstWord'` or `'lastWord'`,
  `textStyle.ts:93-119`), which on per-word items would light every word,
  each being its own line. So a graphic's `textStyleId` is one of
  `GRAPHIC_TEXT_STYLES` (§6.5), computed from the faces, not listed:
  counted 2026-10-21 by importing `TEXT_STYLES` under node 24's type
  stripping, 15 of the 42 re-case in their base face and 5 scope their
  accent to a word (one does both), leaving 23. A line-scoped accent never
  engages, since every item is one line.
- **Shaped-script items take their script's face.** A text item whose text
  holds Devanagari or Telugu is drawn in `INDIC_FONTS`' face for that script
  (§6.20) as its `look.font`, not the style's face first: Poppins Black and
  ExtraBold carry 94 of the Devanagari block's 128 code points and Teko Bold
  93 (`BETA.md` R14), and a face that covers part of a word would draw
  one word in two faces. Latin items keep the style's face. This holds
  under a text style because `fontString` draws `paint?.font ?? spec.font`
  (`textPaint.ts:286-291`) and none of the 42 text styles sets a face of its
  own (`Face.font`, `textStyle.ts:83`, is given no value anywhere in the
  file, read 2026-10-21); `GRAPHIC_TEXT_STYLES` refuses one that does, so
  it stays so (§6.5).

#### The stroke primitive — `src/shared/graphics/stroke.ts`

One primitive serves the callout's arrow and ring, the steps connector and
tree edges, underlines and the edge sweep of §6.16 (the research, §4.4).

- `flattenPath(d: string, tolerance: number): PathGeometry`, `PathGeometry`
  = `{ points: Point[]; lengths: number[]` (cumulative)`; total: number }`,
  parses `M L H V C S Q T Z`, absolute and relative, and refuses `A` (a
  template draws a circle as four cubics, κ = 0.5523), flattening curves by
  de Casteljau subdivision until each piece is within `tolerance` of its
  chord. `STROKE_TOLERANCE` = 0.25 frame px (proposal; M8 sets it, §6.15).
  Painter A memoises it per `d` (64 entries).
- `strokeAt(path, from, to): { points: Point[]; tip: Point | null; tangent:
  number; length: number }` clamps `0 ≤ from ≤ to ≤ 1` and returns the
  visible span: its points, with both ends interpolated; `tip`, the point at
  `to` (null when the span is empty); `tangent`, the direction of the
  segment arriving at the tip (the incoming one at a vertex); and `length`.
- **Painter A strokes that polyline, not a dashed `Path2D`.** Canvas has no
  length query (the research, §4.4), so a `setLineDash` draw-on ends where
  Chromium's own flattening says, while the head would sit where ours says.
  Drawing the span we computed makes the line's end and the head's tip one
  number. M8 compares our `total` with an `SVGPathElement`'s
  `getTotalLength()`; agreement validates the parser, it does not choose a
  route. `dash` (marching dashes) applies `setLineDash` and `lineDashOffset`
  to the same polyline; a travelling beam is `from` and `to` both advancing,
  with nothing new in the primitive.
- **The riding arrowhead.** A filled triangle of length `size × grow` and
  half-width `0.45 × size × grow` (proposal) whose point is the span's tip,
  turned by `tangent`. The line stops `0.6 × size × grow` short of the tip,
  so a round cap never shows past the head's base (proposal). While the
  visible length is under `size`, the head scales by length / size, so a
  stroke at `to` = 0.01 shows no full-size head. A `start` head sits at the
  span's start, turned back. `grow` runs 0 to 1 over `DURATIONS.headGrow`
  (0.1 s, §6.13) from the stroke's own start: the head travels with the line
  instead of waiting at the path's end (the research, §4.4, from Motion
  Canvas's `Curve`).
- **Widths are frame units, never preview pixels**, so a 270×480 preview and
  a 1080×1920 export draw the same relative width. Painter A draws
  `max(width, STROKE_MIN_PX × min(w, h) / 1080)`; `STROKE_MIN_PX` = 2
  (proposal until M19 measures the 4:2:0 fringe through the plan's
  `format=yuva420p`, `plan.ts:1484`).
- **The marker look** (D7, §16.60) is perfect-freehand's outline over the
  span's points, drawn only once M10 passes and the dependency is added in
  phase 2; until then `resolveGraphicStyle` never yields it (§6.5), and a
  `look: 'marker'` item is drawn clean. rough.js is not used.

#### The dim

A `dim` is a full-frame darkening with an optional rounded hole: painter A
fills a frame-sized layer (a context from `options.layer`, below) with
`color` at `alpha`, cuts the hole with
`globalCompositeOperation = 'destination-out'` (a hard edge at `feather` 0;
softened with `filter = blur(feather px)` otherwise), and composites the
layer at the item's opacity. **The hole is fixed at onset** (the research,
§4.4 and §4.6; §6.9): `subjectBoxesAt` takes the nearest of the track's two
samples a second without interpolating (`frameMap.ts:235-245`, `:275-291`),
so a hole that followed the face would jump every 0.5 s and make every held
frame a moving one. With the hole fixed, the layer is cached per hole and
size and only its opacity animates (over `DURATIONS.dim`), so a dim's cost
is one layer, not a blur per frame. A dim makes the graphic's box the whole
frame.

#### Painter A — `paintDrawList2d(ctx: CanvasRenderingContext2D, list: DrawList, options?: PaintOptions): void`

`PaintOptions` = `{ offset?: Point; layer?: (width: number, height: number)
=> CanvasRenderingContext2D; images?: ReadonlyMap<string, ImageBitmap> }`.
Items are drawn in list order; for each, `save`, opacity multiplied into
`globalAlpha` down the group tree, the transform applied about the item's
centre, the kind drawn as the table above says, `restore`. `offset`
translates the whole list (the box bake draws at −box.x, −box.y, as the
caption band draws at −band.y, `captionBake.ts:163`). `layer` makes the
dim's offscreen context; it defaults to a `document.createElement('canvas')`
in the renderer, and node's tests pass a second fake context, since the fake
of `tests/textPaint.test.ts:24-46` cannot make a canvas. `images` holds the
decoded bitmaps an `image` item names by `src`. A shape's `shadow` uses the
context's `shadowBlur`, `shadowOffsetY` and `shadowColor`. An `image` whose
bitmap is missing from `images` is skipped. Painter A reads no clock and no
random, formats nothing, and draws every text item through `drawTextOnto`,
so the 42 looks apply (within `GRAPHIC_TEXT_STYLES`) and Chromium shapes
the text (an inference until M22).

#### The box — `graphicBox(spec, style, fps, total, size, measure, targetsAt: (frame: number) => GraphicTargets, drawer?): Rect | null`

The union of `itemBounds` over every frame of `drawListAt` from 0 to the
last moving frame: a text item's box widened by its style's reach (shadow,
glow, outline, extrusion, the box behind it, read from the `TextStyle`'s
`Paint` by `textInkReach(styleId, px)` in `textStyle.ts`, a new export), a
shape's box and stroke and shadow, a stroke's full path widened by half its
width and its heads, the whole frame for a dim, and a group's children under
its transform. Snapped outward to even x, y, width and height (an odd offset
or size is invalid for the subsampled chroma, as `captionBand` snaps,
`captions/bake.ts:170`, `:178-192`), clamped to the frame, at least 2×2;
null when no frame has ink. In node it is geometry; the harness checks the
real paint against it (alpha 0 outside the box, §6.11).

#### Targets — `graphicTargetsAt(project, clip, spec, frame, size): GraphicTargets`

`GraphicTargets` = `{ subject?: Rect | null; tip?: Point | null; screen?: {
box: Rect; file: string | null } | null }`, output frame pixels, resolved by
the caller and passed into `drawListAt`, so the drawing stays pure:

- **`subject`** from `spec.subject` (a box in source units on its `clipId`,
  taken once at onset by §6.9), mapped by `sourceToFrame`
  (`frameMap.ts:86-132`) and scaled to `size`; without one, the union of
  `subjectBoxesAt` (`frameMap.ts:275-291`) on the clip of
  `captionTrack(project)` (`captions/timeline.ts:30`) under the frame, the
  track whose speaker the captions follow. Null off screen or with no
  track: an ordinary case, not an error.
- **When**: `subject` is evaluated once, at the graphic clip's first frame,
  for every template, the callout included (§6.9 chose it 2026-10-21), and
  that value is what `targetsAt` returns for every frame of the clip. So a
  callout's target, a dim's hole and a connector's target are fixed at
  onset and add no moving frame. Following a moving crop per frame instead
  would have baked a default 2.5 s callout over a followed clip whole (75
  frames at 30 fps instead of the 31 its beat needs, about 0.4-1.2 s against
  0.16-0.49 s a callout; computed from EFFECTS §34 and the caption pool, not
  measured for transparent frames), which is the reason it is not done.
- **`tip`** is phase 4's: `tipOnFrame` (§6.18), mapped on every frame; the
  branch in `targets.ts` is §6.18's.
- **`screen`** is phase 3's screen card: its box and each frame's pulled
  file (§6.16). The pure `graphicTargetsAt` gives the box and `file: null`;
  the file is filled in the renderer by `screenTargetsAt` in
  `graphicCanvas.ts` (§6.16), which wraps it, since the footage pull exists
  only there.

#### Moving frames, the beat frame and the exit — `graphics/frame.ts`

- `beatFrame(beat, fps)` = `ceil(beat × fps − 1e-6)`: the first frame at or
  after the beat. An element **arrives on** its beat: its progress reaches 1
  on that frame and not before (`progress`, §6.13, starts its curve
  `seconds` before the beat and allows 1e-6 s, more than this 1e-6 of a
  frame, so a frame that
  `beatFrame` names is never a hair short of 1).
- `graphicMovingFrames(spec: GraphicSpec, style: GraphicStyle, fps: number,
  total: number): number` = `min(total, beatFrame(last beat + SETTLE_S, fps)
  + 1)`, `SETTLE_S` = 0.5: the last frame baked is the first settled one, so
  the frame `tpad` holds is the settled picture and not one a frame short of
  it (§6.3 as written said round((last beat + 0.5) × fps); a beat at 1.0 s at
  30 fps gives 46 moving frames, not 45). It runs past the settle in
  exactly three cases, each a hold that moves, once per clip at most: a
  `steps` with a `line` connector carrying the energetic style's travelling
  beam (§6.2) and a callout with an `anchor` (its tip, §6.18), for which it
  returns `total` (at most 8 s and 3 s); and a screen card under a style
  with `glow`, for which it returns `min(total, L + 1 +
  round(EDGE_SWEEP_S × fps))`, the landing plus one loop of its edge sweep
  (§6.16), never the card's whole hold.
- **The exit is opacity keys on the clip** over its last `EXIT_S` = 0.3 s:
  `graphicExitKeys(durationFrames, fps): KeyframeTracks` gives two `opacity`
  keys, 1 at `durationFrames − round(EXIT_S × fps)` and 0 on the last frame,
  ease `'smooth'` (the keys' own vocabulary, `render/keyframes.ts:62`, not
  the motion module's). They already render (geq on alpha, covered by an
  integration test), so held frames are never baked to fade. Written by
  `addGraphicClip` and the Director's apply, again by `setGraphic` when
  `seconds` changes, and again on a trim (the store, below). A screen card
  has no exit fade (§6.16).
- `tpad` holds the last moving frame (`holdFilter`, `plan.ts:906-909`): an
  image asset with `frames` is already `-start_number 0 -framerate <fps> -i
  <pattern>` (`plan.ts:1083-1101`, `:1096`) plus the hold, and alpha passes
  through `format=yuva420p` (`plan.ts:1484`; EFFECTS §34). The render needs
  no new filter.
- `drawnGraphicAsset(clipId, width, height, durationFrames, name):
  MediaAsset` builds a graphic's drawn asset, `{ id:
  'graphic-asset-<clipId>', path: '', name, kind: 'image', durationFrames,
  size: 0, width, height, fps: null, hasVideo: true, hasAudio: false }`
  (`MediaAsset` requires `name` and `durationFrames`, `timeline.ts:62-145`).
  Its callers pass `name` = the template's id and " — graphic" ("counter —
  graphic") and
  `durationFrames` = `max(duration, round(fps × 10))`, as the paper asset
  does (`store.ts:3283-3297`), so a trim can lengthen the clip (`trimEnd`
  stops at the asset's length). It is the one helper the store's
  `addGraphicClip` and §6.6's pure `applyGraphics` both call, so the two
  shapes cannot differ.

#### `graphicCanvas.ts` — preview, bake, frames

- `graphicPreviewCanvas(clipId, spec, style, width, height, clock: { frame:
  number; total: number; fps: number }, targets: GraphicTargets, onReady?,
  drawer?): HTMLCanvasElement | null`, following `textPreviewCanvas`
  (`textCanvas.ts:64-123`): cached per clip, keyed on the size, the spec
  without its version, the resolved style, the targets, and the frame (or
  `settled` past the moving frames, so a held frame costs nothing). It skips
  the cache while a face is still loading (`document.fonts.check`, `:113`,
  and the skip at `:108-119`), asking the catalogue for it. Every redraw
  stamps `dataset.forgeRev`, which `canvasContentKey` reads (`grade.ts:478`,
  `:495`). `targets` is an argument so that the preview draws the same
  targets the bake does.
  `forgetGraphicPreview(clipId)` drops the entry.
- `bakeGraphicSequence(spec, style, clipId, width, height, frames, fps,
  targetsAt, boxAllowed, drawer?): Promise<{ pattern: string; frames:
  number; box?: Rect } | null>` awaits every face the list draws (the
  style's, its text styles' faces, `INDIC_FONTS` when any item is shaped),
  decodes each moving frame's `image` files (`createImageBitmap` on the
  file's bytes) into the `images` map it hands painter A, computes the
  moving frames (and extends them to the last frame
  whose `targetsAt` differs, which in step 3 only phase 3's and phase 4's
  per-frame targets do), then, under `@shared/bakeGuard` (`beginBake`,
  `isSuperseded` before each write, `endBake` in a `finally`, as
  `bakeMomentSequence` does, `momentCanvas.ts:571-614`), clears the clip's
  frames and runs `encodeFrames` at `GRAPHIC_POOL_DEPTH` over the moving
  frames only, writing each through `writeTitleFrame`. It returns `{
  pattern; frames; box? }`, or null when superseded or empty. `boxAllowed`
  is the box route's (below).
- `graphicFrameCanvases(spec, style, width, height, total, fps, frames,
  targetsAt, drawer?)`: chosen frames, each on its own canvas, for the
  harness, as `momentFrameCanvases` (`momentCanvas.ts:622-646`).
- `screenTargetsAt(footage: FootageRequest, targetsAt: (frame: number) =>
  GraphicTargets): Promise<(frame: number) => GraphicTargets>` (phase 3):
  pulls the screen card's moving frames through the moments' footage
  pre-pass (`window.forge.momentFrames`, §6.16) and returns `targetsAt`
  with `screen.file` filled per frame. The `FootageRequest` is built purely
  by §6.16's `screenCardFootage` in shared code, as `bakeForExport` builds
  a moment's `momentTextures` and hands them to `bakers.moment`, which
  pulls (`exportBake.ts:131-145`). `liveBakers.graphic` and `rebakeGraphic`
  call it for a screen card; every other template passes through
  untouched.
- Preview and bake call one internal `paintFrame(list, ctx, options:
  PaintOptions)`, so they cannot paint differently. When `needsCompositor(list)` is true (phase
  3), that seam is §6.16's: one compositor per preview entry or bake,
  `paintDrawList3d` then `drawImage` into the entry's or bake's own 2D
  canvas, and painter A with a note when WebGL is missing.

#### The bake region (M1) and the box route

`GRAPHIC_BAKE_REGION: 'canvas' | 'box'` and `GRAPHIC_POOL_DEPTH: 1 | 2 | 4`
are set from M1's numbers on the Mac and the Surface (§6.15's outcomes);
until then `'canvas'` and 4 (proposal). M2 decides only whether
`encodeFrames` gains a worker back-end (`OffscreenCanvas.convertToBlob` on
an `ImageBitmap` transferred from the drawn canvas, the drawing staying on
the main thread, where `drawTextOnto` sees the document's fonts): built in
phase 1, inside these days, only if M2 passes its bar (§6.15).

**If M1 picks the box** (everything marked (box) is built only then):

- **Only the export's bake takes the box**, and only for a clip placed at
  the identity: transform x 0, y 0, scale 1, no `scaleY`, rotation 0, no
  `path`, no keyframes but opacity. That predicate, `identityPlaced(clip)`,
  sits beside `clipBox` (`plan.ts:456-482`) and both the export and the plan
  read it. Any other placement bakes the canvas: a rotated clip turns about
  its stream's middle (`plan.ts:1244-1251`, `:1291-1294`), which for a box
  is not the canvas's, so a box would part from the preview. The store's
  own bakes always take the canvas; the edit's asset never carries a box.
- **The box reaches the overlay exactly through the asset, not the
  transform.** The export's copy of the asset gets the box's size as its
  width and height and `frames.box` = the box; the plan's per-clip box
  (`plan.ts:1241`) is `frames.box` when present and `identityPlaced(clip)`,
  else `clipBox` as today. The stream is then the box's size, so the fit
  (`fitFilter`, `plan.ts:251-264`) scales nothing, and the overlay lands at
  the box's even x and y, as every clip's does (`plan.ts:1921-1922`).
  Through the transform instead (`clipBox`, as a first outline of this
  re-plan asked), the bake would rewrite a value the Inspector shows and the user
  drags (Size, X, Y, `Inspector.tsx:170-211`) on every rebake; the caption
  band's own `overlay=0:<y>` (`plan.ts:1978-1982`) is a separate input,
  which a clip on a track is not.
- **Nothing new reaches ffmpeg for §13**: `overlay` at integer x and y, a
  same-size `scale` and `pad`, `tpad`, all already emitted. Its render check
  is `graphic.int`'s box case (§6.11).

#### The export, the store, the preview

- **The export** (`exportBake.ts`). `Bakers.graphic(spec, style, key, width,
  height, frames, fps, targetsAt, boxAllowed, footage?: FootageRequest)`
  (`footage` only for a screen card, from `screenCardFootage` on the
  export's project, phase 3), required, returning as
  `bakeGraphicSequence` does (the interface at `:35-67`), wired in
  `exportBakers.ts:13-26`. A branch beside the moment's (`:131-145`) bakes
  at the **stills** size (`exportBakeSizes`, `:88-96`), the canvas exactly,
  so lines and type are crisp at 4K. The style is `graphicStyleOf(project,
  spec)` (§6.5); `targetsAt(f)`, for a frame `f` within the clip, is
  `graphicTargetsAt` on `followCanvas(project, exportCanvas)` (`plan.ts:959`)
  at the stills size, as the moment's textures are read: its `subject` the
  one taken at the clip's first frame, `clip.start`, for every `f` (the
  onset rule above), and only phases 3 and 4's `screen` and `tip` read at
  project frame `clip.start + f` (the store's own bakes pass the same
  function on the project as it is); `boxAllowed` is `identityPlaced(clip)`. A graphic whose
  bake returns null or throws is **dropped** with `onError`, as a moment is
  (`:137-145`), never left on the edit's asset, whose path is `''` until
  the store's bake lands (`-i ''` fails the whole export). The catch at
  `:168` gains a line of its own, `if (clip.graphic) dropped.add(clip.id)`,
  beside the moment's: not a joined `clip.moment || clip.graphic`, which is
  two self-drawn fields on one receiver and so exactly what §6.4's regex
  refuses (the two kinds share this rule because their asset is empty until
  the store's bake lands, a reason no guard site has). `screenTargetsAt`
  reaches the export through `liveBakers.graphic`, which receives the
  card's `footage`, since `bakeForExport` is shared and the footage pull is
  the renderer's. A dropped screen
  card also strikes its two opacity keys from the export's copy of the
  recording clip (§6.16's rule, in this branch). Every `Bakers` literal
  gains `graphic` (the list is §6.11's).
- **The store** (`src/renderer/src/store.ts`):
  - `addGraphicClip(trackId, startFrame, spec): Promise<string | null>`
    refuses a track that is not a video track or is locked ("A graphic goes
    on a video track"), mints the id (§6.1), adds `drawnGraphicAsset` as the
    paper clip adds its asset (`store.ts:3277-3315`; size 0 keeps it out of
    the photo tools, `isPhoto`, `edit/photos.ts:25`), stacks it with
    `stackOverlay` (`store.ts:449`), writes `graphicExitKeys`, calls
    `revealClip` (`:5274`) and a background `rebakeGraphic`. The Director's
    graphics are built by §6.6's pure apply, not through this action.
  - `setGraphic(clipId, patch)` is `update()` then `rebakeGraphic`.
  - **Trims and splits** (`trimClipStart`, `trimClipEnd`,
    `store.ts:1915-1935`; `splitAtPlayhead`, `:1937-1956`). A trim of a
    graphic clip, in the same `update()`, sets `spec.seconds` to the clip's
    new length and rewrites its `graphicExitKeys`, so the fade stays on its
    last 0.3 s; a start trim also takes the trimmed seconds off every beat
    (a beat before 0 becomes 0) and leaves `inPoint` at 0, since a graphic's
    frames start at its own first frame; then `rebakeGraphic`. A split
    leaves a graphic clip whole: `splitAtPlayhead` skips it among its
    candidates, with the note "a graphic is trimmed, not split", since the
    right half would draw the entrance again.
  - `rebakeGraphic(clipId)` bakes the canvas region at the project's size
    and writes through the history-less `fillAssetPath` (`:2394`), as
    `rebakePaper` does (`:3349`), not through `update()` as the carousel
    does (`:3440`): a bake is a file, not an edit.
  - `setGraphicsStyle(styleId)` and `setGraphicsOverride(key, value)`: §6.5.
- **The preview** (`Preview.tsx`). A `graphic` branch in `sourceFor`
  (`:1263`) beside the moment's (`:1272-1293`): `graphicPreviewCanvas` with
  `{ frame: playhead - layer.clip.start, total: layer.clip.duration, fps }`
  and the onset's `graphicTargetsAt` (the frame's own for phases 3 and 4's
  per-frame targets), then `return live ?? nothing()` (`nothing()`,
  `:244`), so a stale file is never shown. `forgetGraphicPreview(clipId)`
  joins the removed-clip sweep (the effect at `:680-707`) beside
  `forgetMomentPreview` (`:701-703`).

#### Degraded modes

| state | what happens |
|---|---|
| a face still loading | the preview draws and does not cache; the bake waits for it |
| a face that will not load | drawn in the fallback face, as every text clip is |
| Hindi or Telugu before §6.20's fonts land | the system's fallback face, recorded by M22; a note, "Hindi and Telugu are drawn in this computer's own font" (§14) |
| no subject track, or the subject off screen | `subject: null`; the template draws without its target (§6.2, §6.9 say how) |
| a bake superseded | null, nothing written, the newer bake's frames kept |
| a bake that fails | the export drops the graphic with a note; the edit keeps its clip |
| an `image` that will not decode | the item is skipped |
| a list that asks for the compositor before phase 3 | not possible in phases 1-2 (pinned); from phase 3, §6.16 |

#### Measure before relying (§6.15)

M1 and M2 choose `GRAPHIC_BAKE_REGION`, `GRAPHIC_POOL_DEPTH` and the worker
back-end; M3 fills `CLUSTER_SCRIPTS`; M5 decides `blur-rise` (§6.5); M8
validates `flattenPath` and sets `STROKE_TOLERANCE`; M19 sets
`STROKE_MIN_PX`; M22 decides whether the canvas shapes Hindi and Telugu at
all, the premise of drawing text with painter A; M13 sets the tolerance a
Mac frame and a Surface frame are compared at. If M22 finds a cluster
unshaped, what phase 1 may build meanwhile is stated once, in §6.15's M22
row.

#### Tests (each mutation-checked; §6.11 indexes them by phase)

- **`tests/graphicStroke.test.ts`.** A straight line's exact length, a
  quadratic's, and a four-cubic circle's within 0.05 % of 2πr at the
  default tolerance (proposal; the tolerance M8 sets); relative commands
  equal absolute; `A` refused; `strokeAt(path, 0, 0.5)` ends on the point
  at half the length on a path of one long and nine short segments, and
  its span length is `(to − from) × total`; `tip` is the visible end
  (`to`), not the path's end; `tangent` 0 on a horizontal line, ±90 on a
  vertical one, the incoming segment's at a corner; `from` = `to` draws
  nothing and carries no head; an arrowhead's `grow` runs 0 → 1 over its
  first 0.1 s and holds at 1, and a head at a visible length under `size`
  is scaled down; widths are in frame units (the same list at 1080 and at
  270 wide differs in width by the same ratio, 4); the same path flattens
  to the same points twice. Mutations: length by point count; the span by
  point index; lengths not cumulative; the tip at the path's end; the span's
  end snapped to a vertex; the tangent from the first segment, or the
  outgoing one at a vertex; a width in preview pixels.
- **`tests/graphicDrawList.test.ts`.** Every case in phase 1 draws through
  the drawer seam with hand-built drawers (one that seeds a jitter from its
  `seeded()` draws, one that returns `camera` and `glow`). `drawListAt`
  deterministic (the same arguments twice give deep-equal lists; another
  `seed` changes only the seeded items); a drawer's `DrawOut.camera` and
  `glow` arrive on the list; with no drawer for the template, the list is
  empty. **Units**: with `CLUSTER_SCRIPTS` empty, no text item holds
  less than a whole word of Devanagari or Telugu, over the EFFECTS §51
  clusters and one Hindi and one Telugu sentence (a word is a run between
  whitespace), while Latin text asked for by `'cluster'` comes back in
  graphemes; `unitFor` never yields a split by code point. **The onset
  targets**: with the subject moving on every frame, the dim's hole and the
  subject the template sees are the onset's on every frame of the hold.
  **`needsCompositor`**: false for a flat list and for every list a phase-1
  or phase-2 drawer returns; true for each of `z`, `camera`, `glow` alone.
  **`graphicBox`** holds every moving frame's `itemBounds` (a property over
  random lists, an entrance that rises from below its place included) and
  is even on all four numbers. §6.16 adds two depth cases. Mutations:
  `unitFor` ignoring `CLUSTER_SCRIPTS`, or a script added to it; a split by
  `Array.from` in the cluster branch; the hole read from each frame's
  targets; `needsCompositor` ignoring `glow`; `graphicBox` from the settled
  or the first frame only (the entrance's frames fall outside it, as the
  caption band built from its first line only did, EFFECTS §60); the even
  snap removed.
- **`tests/graphicPaint.test.ts`.** A fake context in the manner of
  `tests/textPaint.test.ts:24-46` records every `fillText` with the
  `fillStyle` set when it was called; a second fake is the dim's `layer`.
  **The pin, per text item** (rewritten 2026-10-21: a style draws one
  string several times, `shadow-pop` with two glow passes and `neon-green`
  with three, `textStyle.ts:201`, `:342`, `textPaint.ts:370`, so joining
  every call would read "40 40 40"): every `fillText` string between the
  item's `save` and `restore`, whitespace normalised, equals the item's
  `text` or, if `drawTextOnto` wrapped it, one of its laid-out rows; and
  every row of the item is drawn at least once. Membership, never an exact
  call list. Run under `clean`, `shadow-pop` and `neon-green`. **The ink**:
  a lit `keyword` or `quote` word's last `fillText` (the fill pass) is made
  with `fillStyle` `palette.accent`; an unlit word's is not. No Hindi or
  Telugu `fillText` string is less than a word (or a cluster, for a script
  in `CLUSTER_SCRIPTS`). Strokes, shapes and the dim reach the context (a
  stroke or a fill per item, membership; the dim through the `layer`
  fake); the head is a filled path whose point is the span's tip; `z`,
  `camera` and `glow` change nothing. Mutations: the painter splitting a
  text item by code point (`Array.from`); the painter formatting a
  numeric-looking string (`toLocaleString`, which fails the pin under every
  style); the head drawn at the path's end instead of the tip; `highlight`
  left out of `textSpecOf` (the lit word draws in the style's own fill).
- **`tests/graphicFrame.test.ts`, phase 1's cases.** `graphicMovingFrames`
  from the beats (`SETTLE_S`, the `+ 1`, capped at the clip; a beat at
  1.0 s at 30 fps gives 46), and past the settle in its three cases only;
  `beatFrame` at 24, 25, 30 and 60 fps with beats on and between frames; an
  element's progress is 1 on its beat frame and under 1 on the frame
  before; the seed is drawn in a fixed order (a spec whose object keys were
  inserted in another order draws the same); the exit keys. Mutations:
  `round` for `ceil` (an arrival a frame early); `SETTLE_S` dropped; the `+
  1` dropped (45); the moving frames run to the clip's end (the hold baked);
  seeded draws in key-insertion order. §6.2 and §6.16 add cases.
- **`tests/renderer/graphicStore.test.ts`, phase 1's cases.**
  `addGraphicClip` mints `graphic-<base36>-<5 base36>`, a legal Windows
  basename, never an id taken from a spec or a model; the drawn asset is
  `drawnGraphicAsset`'s (`path: ''`, `kind: 'image'`, `size: 0`);
  `rebakeGraphic` lands through `fillAssetPath` (`store.ts:2394`) with no
  history entry, and `setGraphic` through `update()` then a rebake,
  rewriting the exit keys when `seconds` changes; a pasted graphic gets its
  own asset and is rebaked by `placeCopies` (`store.ts:5256-5272`); removing
  it reaches `forgetGraphicPreview` in Preview's sweep
  (`Preview.tsx:680-707`); a trim keeps `spec.seconds` equal to the clip's
  length and the exit keys on its last 0.3 s, and a split leaves the
  graphic whole with its note. Mutations: the id taken from the spec; the
  rebake through `update()` (an undo step appears); `toBake` without
  graphics (the paste shows the source's frames); the sweep without
  `forgetGraphicPreview`; a trim that leaves the keys (the fade lands past
  the clip's end). §6.14 and §6.16 add cases.
- `tests/graphicGuards.test.ts` is §6.4's; the harness check's `primitives`
  and Indic halves, and `graphic.int`'s phase-1 cases, are §6.11's.

#### Phase 1, piece by piece

| piece | section | days |
|---|---|---|
| the rename; the types in `template.ts` and `timeline.ts` | §6.1 | 0.5 |
| `SELF_DRAWN_FIELDS`, every guard site, `graphicGuards.test.ts`, the three existing tests rewritten | §6.4 | 1 |
| `motion.ts` and `graphicMotion.test.ts` (M9) | §6.13 | 1 |
| `drawList.ts`, `items.ts`, units, `textItems`, `itemBounds`, `graphicBox`, `needsCompositor`, `templates/index.ts` | §6.3 | 1 |
| `stroke.ts` with the riding head | §6.3 | 0.5 |
| `paint.ts`, painter A, the dim's cached layer | §6.3 | 0.75 |
| `frame.ts` and `targets.ts` | §6.3 | 0.25 |
| `graphicCanvas.ts`; `encodePool.ts`'s worker back-end only if M2 asks (`encodeFrames` itself lands in phase 0, §6.15, so M1 and M2 time it) | §6.3 | 0.75 |
| the export branch, `Bakers`, `exportBakers.ts`, the store's three actions, the preview branch and sweep, (box) `identityPlaced` and the plan's read | §6.3 | 0.5 |
| the harness check's `primitives` and Indic halves (§6.11's table) | §6.3 | 0.25 |
| `GraphicStyle`, `resolveGraphicStyle`, `clean`, `GRAPHIC_TEXT_STYLES`, `graphicStyleOf`, `setGraphicsStyle` and `setGraphicsOverride` | §6.5 | 0.5 |
| the harness check's `pathLength` and `strokes` widths, `graphic.int`'s phase-1 cases, `SHAPES`' graphic overlay | §6.11 | 0.5 |
| **phase 1** | | **7.5** |

The order is §6.19's.

### 6.4 Every guard a new self-drawn kind joins — `SELF_DRAWN_FIELDS`, re-censused

**Phase 1 · 1 day.** §16.9: one constant every guard reads, so the next
self-drawn kind is a one-line change, with membership tests kept per site,
done first. It replaces `PLAN.md:1172-1180`'s rule of adding a kind to each
spelled-out list; the commit that lands the constant points that paragraph
here.

**The constant**, in `src/shared/edit/recipes.ts` beside `drawsItself`
(`:45-46`): `SELF_DRAWN_FIELDS = ['text', 'paper', 'carousel', 'solid',
'title', 'moment', 'graphic'] as const`, `SelfDrawnField` its member type,
and `LIVE_DRAWN_FIELDS`, the constant without `'solid'` and `'title'`: the
two kinds the preview shows from their baked file (`elementFor`, keyed by
their version, `Preview.tsx:597-603`) rather than drawing live.
`drawsItself` becomes `drawsItself(clip: Pick<Clip, SelfDrawnField>):
boolean`, true when any field of the constant is set, and is the one reader
for every site that wants the whole set.

**The sites, as they stand at `4e59965`** (read 2026-10-21; §6.4 as written
cited lines from 2026-10-05, most of which had moved). They spell out
different subsets today; each reads the constant as the last column says,
and why.

| site | today | reads | why |
|---|---|---|---|
| `drawsItself` (`edit/recipes.ts:45-46`) | text, paper, carousel, solid, title, moment | the whole constant | it is the definition. It also feeds `setAspect`'s crop clear (`store.ts:2021`), `rebakeGenerated`'s targets (`:2053`) and paste's own-asset rule (`recipes.ts:277`) |
| Preview's local `drawsItself` (`Preview.tsx:1241-1242`, read by `ready` at `:1244-1245`) | text, paper, carousel, moment | `LIVE_DRAWN_FIELDS` | solid and title load as files and must wait for them; every kind drawn live is ready at once. A graphic is drawn live |
| `clipKind` (`edit/clipKind.ts:154-156`) | `'text'` for text and title (`:155`); `'graphic'` for paper, carousel, solid, moment (`:156`) | the whole constant, after the text branch | text and title have returned at `:155`, so the whole constant gives every existing kind the answer it has today |
| `isKeyable` (`render/chromaKey.ts:218-224`), `canSteady` (`render/steady.ts:32-38`), `canMoveCamera` (`edit/camera.ts:30-36`) | adjustment and six | `clip.adjustment \|\| drawsItself(clip)`; the parameter type becomes `Pick<Clip, 'adjustment' \| SelfDrawnField>` | the same seven today; the paths are in `src/shared/render/` and `src/shared/edit/`, not `director/`. Without `canMoveCamera`'s guard the Camera panel would Ken-Burns a graphic's baked frames, its asset being kind `image` |
| `clearDirector`'s drawn-asset filter (`director/apply.ts:126-127`) | text, solid, adjustment, moment, and sounds brought (`:125`) | `drawsItself(c) \|\| c.adjustment \|\| brought.has(c.assetId)` | it filters only clips the Director's rules removed; no Director rule makes paper, carousel or title (its clip literals, `apply2.ts:455`, `:472`, `:594`), and an asset a survivor still uses is kept (`stillUsed`, `:121`). Without `graphic` every Clear orphans a Direct graphic's asset. The `broughtBy` sweep (`:125`) is §6.14's |

**The sites that branch per kind** (no list to read; each gains a graphic
arm, and the test anchors each):

| site | today | the graphic arm |
|---|---|---|
| `rebakeGenerated` (`store.ts:2050-2223`) | moment `:2076`, carousel `:2086`, paper `:2110`, text `:2145`, solid `:2198`, title `:2205` | before the text arm: `await get().rebakeGraphic(clip.id)`, with `place.auto` recomputed first (§6.9) and a screen card realigned (§6.16) |
| `placeCopies` (`store.ts:5256-5272`) | its `toBake` loop (`:5266-5271`) rebakes text, solid, paper, carousel (a pasted moment is not rebaked there, a gap outside this step) | `else if (from.graphic) await get().rebakeGraphic(clipId)` |
| `rebakeFollowed` (`store.ts:2225-2253`) | moments whose shots read a re-followed file | a graphic whose `spec.subject.clipId`'s asset, or the caption track's clip under it, is in `assetIds` is rebaked: a callout's onset target moves when Follow re-solves the crop beneath it. Not in §6.4 as written |
| Preview's `sourceFor` (`Preview.tsx:1263`) | the moment's branch `:1272-1293`, `live ?? nothing()` at `:1292` | §6.3's branch, also ending `return live ?? nothing()` |
| Preview's removed-clip sweep (`Preview.tsx:680-707`) | `forgetTextPreview` `:701`, `forgetMomentPreview` `:703` | `forgetGraphicPreview(clipId)` |
| `bakeForExport` (`exportBake.ts:117-170`) | a moment that cannot draw is dropped (`:137-145`, `:168`) | §6.3's branch, dropped the same way, the catch's graphic line apart from the moment's (§6.3) |
| `liveBakers` (`exportBakers.ts:13-26`) | seven bakers | `graphic` |
| the Inspector's per-kind panels (`Inspector.tsx:234-237`, `PaperPanel`, `CarouselPanel`) | — | `GraphicPanel` for a clip with `.graphic`, in phase 2 with the panel (§6.6) |

`SpeedPanel` needs nothing: it returns null for an image asset
(`SpeedPanel.tsx:30`), and a graphic's asset is one. `isPhoto` needs
nothing: size 0. The frame-rate change needs nothing beyond
`rebakeGenerated`'s arm: the spec is in seconds (§6.1).

**The test**, `tests/graphicGuards.test.ts`, modelled on
`tests/moment.test.ts:585-647`, asserting membership, never a whole list.
It is written in two halves (chosen 2026-10-21 by the review, so each lane
commits it green): **the head lane's half** (§6.19) is the behaviour over
the constant and the regex below, with the five list sites and the
membership rewrites of `paper.test` and `moment.test`; **lane C's half**
adds the wiring cases and the three store arms (`rebakeGenerated`,
`placeCopies`, `rebakeFollowed`, which call lane C's `rebakeGraphic`), the
Preview's branch and sweep, `Bakers.graphic` and the export's branch, in
lane C's own commits.

- **Behaviour, over the constant.** For every field of `SELF_DRAWN_FIELDS`,
  a clip carrying only that field: `drawsItself` true; `isKeyable`,
  `canSteady`, `canMoveCamera` false; `clipKind` `'text'` for text and
  title and `'graphic'` for the rest; `clearDirector` of a project where a
  Director-ruled clip carries it removes its unused drawn asset. A site that
  spells out its own list again, without `graphic`, fails on `graphic`.
  `'graphic'` is in `SELF_DRAWN_FIELDS` and in `LIVE_DRAWN_FIELDS`; `'solid'`
  and `'title'` are not in `LIVE_DRAWN_FIELDS`. (Lane C's half:) a failed
  graphic bake is dropped from `bakeForExport`'s project with `onError`
  heard (fake bakers), both for a null return and a throw.
- **No list spelled out again.** The regex, with `F` the alternation built
  from `SELF_DRAWN_FIELDS` itself (`text|paper|carousel|solid|title|moment|graphic`):
  `\b(?:layer\.clip|clip|c)\.(?:F) *(?:\?\?|\|\|) *(?:layer\.clip|clip|c)\.(?:F)\b`,
  global. It matches direct `receiver.field` members only, two self-drawn
  fields joined by `??` or `||`; an optional chain is not a match, so the
  version keys at `Preview.tsx:603` and `:684` (`c.title?.version ??
  c.text?.version ?? c.solid?.version`, keys, not guards) are never seen. It
  is run with `matchAll` over every `.ts` and `.tsx` file under `src/`;
  every match must be the one allowed line, `clipKind.ts:155`'s `clip.text
  ?? clip.title` (a classification into `'text'`, not a guard), anchored on
  that whole line's text. Run at `4e59965` (2026-10-21, `grep -E` with the
  same pattern) it finds exactly eight lines: `recipes.ts:46`,
  `Preview.tsx:1242`, `clipKind.ts:155` and `:156`, `chromaKey.ts:222`,
  `steady.ts:36`, `camera.ts:34` and `director/apply.ts:127`, the seven list
  sites of the tables above and the allowed one, so it sees every site it
  guards. §6.3's export catch is written as its own line for this reason.
  `export const SELF_DRAWN_FIELDS` occurs once under `src/`.
- **The wiring, anchored on unique text with its arguments**, each anchor
  counted with `matchAll` before it is trusted (`CLAUDE.md`'s table). Each
  store action's body is cut from its own anchor (`rebakeGenerated: async
  () => {`, `rebakeFollowed: async (assetIds) => {`, `placeCopies: async
  (board, frame) => {`, each counted once) to the next action's anchor, not
  by a fixed slice length; inside each, its arm. In `Preview.tsx`: the use
  expression `LIVE_DRAWN_FIELDS.some(` counted with `matchAll` and asserted
  at exactly 1 (the bare name also occurs in the import, so a count of the
  name proves nothing); the graphic branch's own slice, cut from `if
  (layer.clip.graphic)` to the next `if (layer.clip.`, contains
  `graphicPreviewCanvas(` with its clock and `return live ?? nothing()`;
  `forgetGraphicPreview(clipId)` once. In `exportBakers.ts`: `graphic:`
  handing its arguments to `bakeGraphicSequence` in order. From phase 2,
  `Inspector.tsx`'s mount.
- **Mutations**, each seen to fail its own case and no other: each site in
  turn with `graphic` left out; `'graphic'` left out of `SELF_DRAWN_FIELDS`
  (every reading site fails); `canSteady` given back its spelled-out seven
  (a site reverted to a list without `graphic`); the Preview reading
  `SELF_DRAWN_FIELDS` whole (solid and title shown before their file); the
  graphic branch returning the baked file instead of `nothing()`; the
  sweep's forget removed; the paste arm removed; the `rebakeFollowed` arm
  removed; a failed graphic kept in the export.

**Existing tests that change.** `tests/paper.test.ts:496-507` and
`:722-725` and `tests/moment.test.ts:629` pin the spelled-out expressions
(`drawsItself`'s `return Boolean((?:clip\.\w+ \?\? )*clip\.paper`, and
Preview's `layer.clip.paper` and `layer.clip.moment` within 160 and 200
characters of its `drawsItself`). Those expressions go, so the assertions
become membership of `paper` and `moment` in `SELF_DRAWN_FIELDS` and
`LIVE_DRAWN_FIELDS` and the readers' anchors above, each mutation-checked
again by leaving `paper` and then `moment` out of the constant. The store
assertions beside them (`if (drawsItself(c)) return { ...c, crop: undefined
}`, `project.clips.filter(drawsItself)`) stand as they are.

### 6.5 The graphic style — `src/shared/graphics/style.ts`

**0.5 day in phase 1, 0.5 day in phase 2.** The twin of the caption
styles, now carrying the motion names, the stroke look and the dim.

`GraphicStyle` = `{ id; name; textStyleId` (one of `GRAPHIC_TEXT_STYLES`,
§6.3, within the 42 of `render/textStyle.ts:164`)`; font; palette: { ink;
accent; muted; panel; panelOpacity; dim; dimOpacity }; radius` (a fraction
of the frame's short side)`; stroke` (the
same)`; shadow` (0..1, a soft shadow under panels)`; motion: { entrance:
'rise' | 'pop' | 'wipe' | 'blur-rise'; ease: MotionEase; exit: MotionEase };
strokeLook: 'clean' | 'marker'; dim: boolean` (whether a template may dim
with this style)`; energy: 'restrained' | 'energetic'; glow?: { radius;
strength } }`. `MotionEase` is §6.13's (named so, not `Ease`, because
`render/keyframes.ts:62` already exports an `Ease`, the keys' `'linear' |
'hold' | 'smooth'`, and two exported types of one name are the anchor trap
`CLAUDE.md` records).

- **Text takes its text style's ink and weight** (corrected 2026-10-21; the
  contract's `titleWeight`, `valueWeight` and a text colour in `TextLook`
  would never have drawn, §6.3). So `palette.ink` is not a text colour: it
  is the colour of strokes, arrowheads, bars and the ring's arc, set in
  each preset to match its text style's fill (a gradient's last stop).
  `palette.accent` lights a word (through `highlight`, §6.3), fills the
  lower third's bar and draws the keyword's underline. A preset whose look
  needs dark type takes a text style with a dark fill.

- **No number format**, as §6.5 as written says: a style that regrouped
  "10,00,000" as "1,000,000" would draw a string nobody said (§6.2).
- **The entrances** (`entrance(name, p)` in `motion.ts`, §6.13): `rise`
  (up from half the text's height, opacity to 1), `pop` (scale from 0.92,
  proposal, with `out-back` only in the energetic style), `blur-rise` (rise
  with a blur falling to 0) **only if M5 allows** its cost; until then it
  resolves to `rise`, and allowing it adds an optional `blur?: number`
  (frame px) to `DrawItem`. `wipe` stays in the type and resolves to `rise`:
  a masked reveal needs a clip on items, which waits for a source that times
  it and phase 2's ratings (the research, §7.4).
- **The stroke look** (D7, §16.60: "Clean vector by default; a marker look
  through perfect-freehand as a style option once M10 passes; rough.js not
  now"). Every preset is `clean`; `resolveGraphicStyle` yields `marker` only
  while `MARKER_READY` is true, which phase 2 sets only after M10 passes and
  perfect-freehand is added. M10 itself runs from a scratch branch with
  perfect-freehand added there and never merged, as M7's pmndrs leg does
  (§6.15); only on a pass does a phase-2 commit add the dependency, the
  marker painter and `MARKER_READY`.
- **The dim** is a style property (the research, §1.4: light type on
  daylight footage needs a panel, a dim or a shadow): `palette.dim`,
  `palette.dimOpacity`, and `dim`, which the templates read (§6.2, §6.9).
  Off in every restrained preset, on in `energetic` (the presets table):
  the research treats the dim as an option behind a graphic (its §4.4),
  D5 makes the default restrained, and a dim makes a graphic's box the
  whole frame (§6.3). The look rating asks whether you want it (§6.10).
  The screen card dims whatever the style says (D4 names "a dim", §6.16).
- **The default is restrained** (D5, §16.58: "Restrained by default …, with
  an energetic style as an option that keeps the `pop` entrance and
  `out-back`").

**`resolveGraphicStyle(styleId: string, overrides?: Record<string,
unknown>): GraphicStyle`** starts from the preset (`clean` for an unknown
id) and guards every override, as `resolveStyle` does for captions:
opacities to 0..1; `radius` to 0..0.1; `stroke` to the minimum
of §6.3 up to 0.02; a NaN or negative number to the preset's; a
`textStyleId` outside `GRAPHIC_TEXT_STYLES`, a missing `font`, or an
unknown ease falls back to the preset's; the entrance and stroke-look gates
above; unknown keys ignored. **`graphicStyleOf(project, spec)`** resolves
`spec.style ?? project.graphics?.styleId ?? 'clean'` with the project's
overrides: the one call the store, the Preview and the export make, so
three sites cannot resolve a style three ways.

**The presets** (`GRAPHIC_STYLES: GraphicStyle[]`, seven; every value a
proposal, chosen against the sample tiles in phase 2 and revised by the
look rating, §6.10; the faces are in the library, `assets/fonts`). The text
style column gives that style's base fill, read from `TEXT_STYLES` on
2026-10-21: it is the type's ink (§6.3).

| id | name | text style (its fill) | face | entrance · ease · exit | palette: ink, accent, panel at opacity | `dim` · `dimOpacity` | energy |
|---|---|---|---|---|---|---|---|
| `clean` | Clean | `clean` (#FFFFFF) | Montserrat | rise · M14's winner, `expo-out` until then · `accelerate` | #FFFFFF, #FFD400, #0B0D10 at 0.55 | false · 0.35 | restrained, the default |
| `bold` | Bold | `outline` (#FFFFFF, a black edge) | Anton | rise · `expo-out` · `accelerate` | #FFFFFF, #FFD400, #000000 at 0.7 | false · 0.35 | restrained |
| `editorial` | Editorial | `midnight` (#101014, a white rim) | Playfair Display | rise · `decelerate` · `accelerate` | #101014, #B4232A, #F2EFE7 at 0.92 | false · 0.3 | restrained |
| `neon` | Neon | `neon-green` (a gradient, #E7FFB0 to #68D43A) | Unbounded | rise · `expo-out` · `accelerate` | #68D43A, #FFFFFF, #050608 at 0.6; `glow` (phase 3: the hero's glow and the screen card's edge sweep, §6.16) | false · 0.45 | restrained |
| `mono` | Mono | `clean` (#FFFFFF) | Montserrat | rise · `standard` · `accelerate` | #FFFFFF, #FFFFFF, #000000 at 0.5 | false · 0.35 | restrained |
| `accent` | Accent | `clean` (#FFFFFF) | Montserrat | rise · `expo-out` · `accelerate` | #FFFFFF, the user's colour (`overrides['palette.accent']`), #0B0D10 at 0.55 | false · 0.35 | restrained |
| `energetic` | Energetic | `shadow-pop` (#FFE14D) | Poppins | pop · `out-back` · `accelerate` | #FFE14D, #FFFFFF, #000000 at 0.6; `glow` as `neon`'s | true · 0.5 | energetic |

Changed 2026-10-21 by the review, because a text style's fill is the ink
(§6.3): `bold` takes `outline` instead of `shadow-pop`, whose yellow fill
would have hidden a `#FFD400` lit word; `editorial` takes `midnight`, since
`clean` would have drawn white type on its cream panel; `neon`'s and
`energetic`'s accents are white, against green and yellow type.

`#FFD400` is the Director's punch colour (`PUNCH_COLOR`,
`director/apply.ts:59`); `#0B0D10` the preview's stage (`styles.css:90`).
There is no project accent colour at `4e59965` (searched `timeline.ts` and
`project.ts`), so the `accent` preset reads your pick from `overrides`,
defaulting to the 3dit blue `#2563EB` (`--color-accent-500`,
`styles.css:87`). Hindi and Telugu items draw in `INDIC_FONTS` whatever the
preset's face (§6.3, §6.20).

**The UI** (phase 2). In the OUTPUT strip, under the caption presets
(`OutputStrip.tsx:287-310`), a **Graphics** section: the seven presets as
rows in the captions' manner (name and face; the chosen one lit), a sample
tile drawn by `paintDrawList2d` from a fixed `counter` sample at its settled
frame (a UI sample, not a claim; drawn as `captionSample` feeds the caption
tiles, `:133-147`), `TextStylePicker` limited to `GRAPHIC_TEXT_STYLES` (an
optional prop naming the ids it may show; it lists all of `TEXT_STYLES`
today, `components/TextStylePicker.tsx:47-48`), and an **Accent colour**
control beside the `accent` preset. Picking a preset keeps `textStyleId` and
the accent, as `setCaptionStyle` keeps the look (`store.ts:4899`). A change
rebakes every graphic clip through `rebakeGraphic`, not `rebakeGenerated`,
which redraws every drawn kind. "Graphic sounds" sits in the same section
(§6.14).

**Census rows:** "Graphics", "Clean", "Bold", "Editorial", "Neon", "Mono",
"Accent", "Energetic", "Accent colour" (with §6.14's "Graphic sounds").

**Days.** Phase 1, 0.5: the type, `resolveGraphicStyle` and its guards,
`clean`, `GRAPHIC_TEXT_STYLES`, `graphicStyleOf`, `setGraphicsStyle` and
`setGraphicsOverride`. Phase 2, 0.5: the six other presets, the OUTPUT strip
section and its sample, the census rows, and, if M10 passes on its scratch
branch, the marker painter in `paint.ts` and `MARKER_READY` set
(perfect-freehand added to `main` then, not by this plan's writing).

**Tests**, `tests/graphicStyle.test.ts`. Phase 1's cases: `resolveGraphicStyle`
guards every number (NaN, negative and out-of-range values clamped or
replaced, as `resolveStyle` does); an unknown id resolves to `clean`;
`strokeLook: 'marker'` resolves to `clean` while `MARKER_READY` is false,
`entrance: 'blur-rise'` to `rise` unless M5 allowed it, and `wipe` to
`rise`; no key of `GraphicStyle` or of any preset names a format, a locale,
a grouping or a separator (`/format|locale|group|separator/i`, membership
over the keys); `GRAPHIC_TEXT_STYLES` is `TEXT_STYLES` filtered by
`graphicEligible(style: TextStyle): boolean` (a base face that does not
re-case, sets no `font` of its own, so a shaped item's `INDIC_FONTS` face
is the one drawn, §6.3, and has no word-scoped accent): every member passes
it, and it refuses a synthetic style for each condition (the font one is
synthetic only, since no style of the 42 sets a face today), and
"Mixed Case 10,00,000"
drawn through each by `drawTextOnto` with a fake context in the manner of
`tests/textPaint.test.ts:24-46` comes back unchanged (the `TextSpec`
written inline as §6.3's `textSpecOf` builds it, since `textSpecOf` is lane
B's, §6.19); `'chrome'` (a re-casing style, by its faces) asked for
resolves to the preset's text style. Phase 2's cases: the seven presets by id, each
resolving to itself; `clean` the default and restrained; every preset
`energy: 'restrained'` except `energetic`, the only one with `pop` and
`out-back` (§16.58); `dim` false in every preset but `energetic`; each
preset's `palette.ink` equals its text style's base fill (or a gradient's
last stop), read from `TEXT_STYLES`. Mutations: an override's NaN passed
through; the radius clamp removed; the re-casing filter dropped (`'chrome'` becomes eligible and
"Mixed Case" comes back upper-cased); `marker` honoured with `MARKER_READY`
false; a `numberFormat` key added; `clean` given `out-back`; `editorial`
given the `clean` text style (its ink case fails); the font condition
dropped from `graphicEligible` (the synthetic style passes).

### 6.6 The third pass — `graphics@1`: menu, schema, prompt

**Phase 2 · 2 days.** The pure half goes in `src/shared/director/run.ts`,
beside `settle2` (`:229`), so the app and the eval share one copy:

- `graphicsMenuFor(project, clip, transcript): GraphicsMenu[]`
- `settleGraphics(answer, menu, transcript, options): SettledGraphics`

`GraphicsMenu` = `{ assetId: string; clipId: string; language: string;
sentences: { id: string; startMs: number; text: string; wordStart: number;
wordEnd: number }[]; templates: GraphicTemplateId[]; wordSource: 'whisper' |
'youtube-asr' | 'youtube-lines' }`.

- **Sentences.** The segments of the words the clip shows, capped by
  `capSegments` (`transcript.ts:207`) at 30 words or 15 s (§7.2).
- **Windows.** At most 24 sentences a call (`MAX_CANDIDATES`, `menu.ts:41`).
  A clip of 1-4 minutes at the measured ~180 words a minute is 300-1,300
  tokens and fits whole; a longer transcript is cut into 24-sentence
  windows, one call each.
- **Templates offered.** `counter`, `bars`, `steps`, `quote`, `ring` and
  `keyword` always. `callout` only when the clip's asset has a subject track
  (`subjectTrackOf`, `frameMap.ts:142`), since without one it is dropped
  anyway. Never `lower-third`, `screen-card` or a later step's id.

The files beside it:

- **`promptGraphics.ts`: `GRAPHICS_SYSTEM`; `graphicsPrompt(menu, lang): {
  system: string; user: string }`.**
  - **System**: one constant playbook, which a server caches. It says: you
    mark the moments in a talk where a simple graphic would help a viewer,
    meaning a number, a comparison, steps, a line worth quoting, a thing on
    screen worth pointing at, a share of a whole, or a few words worth
    seeing; you copy words; you never invent a number or a name; you never
    choose a look, a motion, a sound, a connector or a name, because the
    app does; at most four; an empty list when nothing qualifies.
  - **User**: a SENTENCES table of `s07  0:42  "…"` lines; then a TEMPLATES
    table (id, when to use it, its fields); then the language line, last.
    That last line is what took Telugu and Hindi copy from 0/24 to 24/24 in
    the target script (`EVAL.md:60-70`).

The TEMPLATES table's rows:

| id | when (the prompt's words) | fields |
|---|---|---|
| `counter` | one number, said with what it counts | `value`, `label` |
| `bars` | two to five numbers said as a comparison, in one unit | `title`, `items` |
| `steps` | two to six steps or reasons said in order | `title`, `items[].label` |
| `quote` | a line worth quoting, copied word for word from clause to clause | `quote` |
| `callout` | a thing on screen the speaker names (offered only with a subject) | `label` |
| `ring` | a share of a whole, said as a percentage | `value`, `label` |
| `keyword` | one to four words the speaker stresses, copied exactly; `lit` is which of them to light, counting from 0 | `words`, `lit` |

- **`schemaGraphics.ts`: `GRAPHICS_PASS = 'graphics@1'`;
  `graphicsSchema(menu, options: { constrained?: boolean }): ObjectSchema`;
  `maxTokensForGraphics(menu): number`.**
  - **Shape.** The schema is flat and fits `conforms.ts`
    (`SUPPORTED_KEYWORDS`, `conforms.ts:69-82`). One graphic object carries
    the **union** of the offered templates' fields, unused ones left as `''`.
  - **Measured size.** The 2026-10-05 prototype measured 1,269 chars, with
    `unsupportedKeywords []` and `flatViolations []`, without `words` and
    `lit`. With them it is re-measured by the test.
  - **The fields, in declaration order.** `reasoning` (≤ 300) comes first.
    Then `graphics`: `maxItems` 4 (`MAX_GRAPHICS`), `minItems` 0. Each
    object holds, in order: `sentence` (an enum of this request's ids);
    `template` (an enum of the offered templates); `title` (decoded to 60,
    kept to 40); `value` (decoded to 24, kept to 16); `label` (decoded to
    60, kept to 40); `items` (`maxItems` 6, each `label` decoded to 48, kept
    to 32, and `value` decoded to 24, kept to 16); `quote` (decoded to 200,
    kept to 120 and 16 words); `words` (decoded to 60, kept to 40 and 4
    words); `lit` (an integer, `minimum` 0 and `maximum` 3 when constrained,
    any integer otherwise); `why` (decoded to 100, kept to 60).
  - **Kept lengths** count grapheme clusters, so a Telugu label is not cut
    for its vowel signs. A title that neither grounds nor equals a fixed
    title is replaced by the template's first fixed title, with a note.
  - **`constrained`.** `true` for the decoder (enums, maxLengths, the
    integer's range); `false` for the validator's shape check, so an
    out-of-list id or an out-of-range `lit` is repaired rather than failing
    the pass (`schema2.ts:88-93`).
  - **Decode limits are looser than what is kept.** A grammar cut-off
    mid-string made Gemma 4 E2B close a whole plan after one segment
    (`EVAL.md:84-95`).
  - **`minItems: 0`.** Whether LM Studio's strict `json_schema` decodes it
    cleanly is **unmeasured** (§15 row 10); the eval's first run answers it.
  - **`maxTokensForGraphics`** starts at `250 + 150 × 4` (proposal: §6.6 as
    written had 140 a graphic, before `words` and `lit`). It is recalibrated
    from the eval, as `maxTokensFor2` was (`prompt2.ts:86`).
- **The ask.** It goes through `askStructured` (`ask.ts:29`), wrapped so a
  throw becomes `{error}`, as the spine's ask is (`store.ts:2559-2570`).
  **A finding fixed here:** the retry with thinking on does nothing on the
  OpenAI shape, because `openaiRequestBody` never sends `think`
  (`provider.ts:214-237` against `:189`), so on LM Studio, the
  configuration every eval used, the "retry" is the same request with more
  room (it raises `maxTokens` by `THINKING_EXTRA_TOKENS`, `ask.ts:38-42`,
  and nothing else reaches the server). On a first result whose `provider`
  is `'openai'` (`provider.ts:36`), `askStructured` instead retries with one
  line appended to the user prompt ("Answer with the JSON object only."),
  keeping the extra room. Every pass gains it, since every pass calls the
  one function. Its test sits in `tests/directorAsk.test.ts`, beside the
  existing retry cases (`:39-48`). The eval counts whether prose ever came
  back.

**What the model never fills.** It never fills any field of a
`lower-third`; `steps.parent` or `steps.connector`; `callout.shape`;
`callout.anchor` (phase 4: the app binds the `PointEvent` that overlaps the
beat, §6.18); the quote's `speaker`; `depth` (phase 3, §6.16); and no curve,
duration, sound, place or beat. The schema has no field for any of them.
This is the Director contract, unchanged: the LLM fills typed fields of a
type the app defined.

**Where it runs:**

- **In Direct**, after the spine, the look and the bake (`direct()`,
  `store.ts:2469`), over every shot on the video track whose asset has a
  transcript and whose span holds speech. Its graphics carry `GRAPHIC_RULE`.
- **In Clip it, from step 4.** §7.5's steps 3-6 (reframe, captions,
  graphics, B-roll) are step 4's, built after this step; M0's built Clip it
  has no graphics step to wire. So step 3 wires Direct and the Transcript
  tile only, and builds everything Clip it's graphics step will call
  (`findGraphics`, `applyGraphics`, `CLIPS_GRAPHIC_RULE`); step 4 calls it
  as its fifth step, after the analysis job has released its sessions. Its
  graphics carry `CLIPS_GRAPHIC_RULE`.
- **By hand**, from the Transcript tile's **Graphics** section
  (`src/renderer/src/components/TranscriptGraphics.tsx`, mounted in
  `TranscriptPanel.tsx` between `TranscriptBody` at `:105` and `Vocabulary`
  at `:107`; the Shelf's `transcript` tile, `components/shelf/tools.ts:150`,
  §16.6).
  Its graphics carry `CLIPS_GRAPHIC_RULE`. The section holds:
  - **"Find graphics in this clip"**;
  - the list of every graphic over the clip, whichever rule made it: its
    template, the words it draws and its time, **Drop** on each, and
    **Keep** on a proposal, with **check the number** beside the words
    heard (and, in phase 4, a `'pointed'` proposal's note beside it,
    §6.18);
  - the notes, each drop with its reason;
  - **"Clear graphics"**;
  - the **"Speaker"** field (§16.31), `MediaAsset.speaker`. For a link's
    asset it starts empty, showing the channel (`credit.author`,
    `timeline.ts:178`) as its placeholder. A quote takes the channel while
    the field is empty, as §16.31 settled. A lower third waits until you
    type a name or press to use the channel's, because a channel may be a
    brand rather than the person speaking.

  Find again replaces the clip's `'clips.graphic'` graphics, their sounds
  and its pending proposals, in one undo step.
- **With no model**, or a pass that is rejected, the baseline runs (§6.10)
  through the same validator, and the notes say so.
- **A `lower-third`** is the app's in every run: placed on the speaker's
  first word the clip shows, at most once per clip, when the asset has a
  Speaker (§6.8, §6.9). It is made by `lowerThirdFor(project, clip):
  KeptGraphic | null` in `graphics/apply.ts`, which `applyGraphics` calls
  first, so the lower third carries the run's own rule; null without a
  Speaker, or when the clip already has one.

**What is placed without review, and what is not.** The validator proves a
graphic matches the transcript, not what was said. YouTube's ASR sets word
confidence to nothing (`acAsrConf` is 0 on every word, §7.1; stored as
`null`, `ingest/captions.ts:204`), so a misheard "14%" for "40%" would
become a confident counter. So (§16.30):

- Graphics from Clip it and Direct are placed, and **every one is listed**
  in the Transcript tile's Graphics list and in the run's notes, each with
  **Drop**.
- **A graphic whose grounded number came from a YouTube transcript, or from
  a Whisper word under 0.5 confidence, is a proposal only**
  (`GraphicSpec.proposal`). It is marked **check the number** beside the
  words it heard, and is not placed until you press Keep. Only the words
  bound to a number claim count.
  - **YouTube**: the transcript's `model` is `'youtube-asr'`,
    `'youtube-lines'` (`ingest/captions.ts:336`) or `'youtube-asr+lines'`
    (`:633`). `wordSource` is `'youtube-lines'` when the model is
    `'youtube-lines'` or the transcript is `approximate`, else
    `'youtube-asr'`.
  - **Whisper**: a word whose `confidence` is non-null and under 0.5 gives
    `'whisper-unsure'`. A `null` there is a word you corrected
    (`withWordText`, `transcript.ts:256`), which is trusted.
- **A `lower-third` is placed without review**: its text is your own.
- Phase 4's pointed graphics are proposals (§6.18, D3, §16.56).

**When something is missing** (each a degraded mode; §14 carries the rows):

| missing | what happens |
|---|---|
| a model, or a pass rejected | the baseline, validated the same way, with a note |
| a subject track | `callout` not offered; a dim drawn with no hole; placement takes the no-track default (§6.9) |
| captions | no third is excluded |
| a Speaker on the asset | no lower third; a quote's speaker is '' (or a link's channel, §16.31) |
| the sound library | graphics land silent, with one note (§6.14) |
| a free lane (the track limit) | the graphic is dropped, with a note (§6.9) |
| plain speed (the clip is retimed) | refused, with a note (§6.8) |
| a parser for Hindi or Telugu number words | a number said as a word there is dropped (§16.11), counted by the eval |
| a cue list for Hindi or Telugu nesting | the tree is flat (§6.2) |

**Proposals live in `Project.graphicProposals`** (confirmed 2026-10-21: a
held number may wait days for your check, so it is saved with the
project). Each is a `GraphicProposal` (§6.1).

- **Keep** places it through §6.9's placement and budget at that moment. If
  the budget would refuse it, Keep says why ("another graphic is on screen
  then") and leaves it listed.
- **Drop** removes it.
- **Clear graphics** removes the `'clips.graphic'` ones.
- **Direct's Clear** removes the `GRAPHIC_RULE` ones: `clearDirector`'s
  return (`director/apply.ts:133-138`) filters `graphicProposals` by
  `DIRECTOR_RULES`.

**The rules** (§16.10, unchanged):

- `GRAPHIC_RULE = 'director.graphic'` sits beside `director/apply.ts:37-49`
  and joins `DIRECTOR_RULES` (`:49`), so Direct again and Direct's Clear
  take Direct's graphics, their sounds and their files (§6.14).
- `CLIPS_GRAPHIC_RULE = 'clips.graphic'` sits in `graphics/apply.ts`, outside
  the Director. Its own **Clear graphics**, `clearGraphics(project):
  Project`, removes, in one undo step: the `'clips.graphic'` graphic clips
  and their drawn assets; their sound clips and the files the app brought
  for them (§6.14); the `'clips.graphic'` proposals. It leaves Direct's
  graphics, and its note says so ("Direct's graphics stay; Direct's Clear
  takes them").
- `applyGraphics(project: Project, kept: KeptGraphic[], covered: string[],
  rule: string, ctx: Pick<ApplyContext, 'fps' | 'newId'>): { project:
  Project; problems: Problem[]; clipIds: string[] }` in
  `graphics/apply.ts`, with `KeptGraphic` = `{ clipId: string; assetId:
  string; candidate: GraphicCandidate }` (`clipId` the footage clip,
  `assetId` its transcript's asset), `covered` the footage clip ids the run
  read (a lower third is offered on each, even where no graphic was kept),
  and `ApplyContext` the Director's
  (`director/apply.ts:69-84`, `newId` optional and injectable for tests). A
  `GraphicCandidate` carries only menu-local ids (§6.7), so the caller
  pairs each kept candidate with the `clipId` and `assetId` of the
  `GraphicsMenu` its answer came from. **This is the seam between lanes T2
  and T3** (§6.19): T3 commits the signature first as a typed stub. It
  lands a run's graphics, in order: `lowerThirdFor` on each `covered` clip
  (above); the beats
  (§6.8); the seconds (§6.2); proposals set aside; the budget (§6.9);
  placement and the subject at onset, dropping a callout with no subject
  there (§6.9); the lane (§6.9); the sounds (§6.14). Each graphic clip gets
  an app-minted id, `newId('graphic')`, its exit keys (`graphicExitKeys`)
  and its asset from `drawnGraphicAsset` (§6.3), the helper the store's
  `addGraphicClip` uses, so the two cannot differ. The store then calls
  `rebakeGraphic` on each returned clip id.

**The decision record.** There is no `Project.decisions`; the 2026-10-05
text was wrong. A run appends a `DecisionRecord` (`src/shared/project.ts:23-37`:
`id`, `pass`, `ops`, a top-level `model: { id; quantHash?; runtime? }`,
`createdAt`) to the store's `decisions`, as Direct's spine record is
appended (`store.ts:2623`). It is built by `decisionForGraphics(settled:
SettledGraphics, model: { id: string; runtime: string } | null, options: {
id?: string; now?: Date } = {}): DecisionRecord` in `run.ts`, mirroring
`decisionFor2` (`director/apply2.ts:690-714`): `id` from `options.id` or a
default id made as `apply2.ts:85`'s `defaultId` makes one (it is not
exported); `pass: GRAPHICS_PASS`; `ops: [{ graphics, dropped,
baseline }]`; `model` = `{ id: model.id, runtime: model.runtime }`, or `{
id: 'baseline', runtime: 'none' }` when no model answered (no model, or a
rejected pass whose baseline ran); `createdAt` from `options.now`. It is
saved in the project file's `decisions` (`project.ts:45`). There is one
record per Find or Direct run (and, from step 4, per Clip it run).

**The dock's panel**, `src/renderer/src/components/GraphicPanel.tsx`
(chosen 2026-10-21: per-kind dock panels live in `components/`, beside
`PaperPanel.tsx` and `CarouselPanel.tsx`; §6.11 as written said `tools/`),
is mounted beside `PaperPanel` and `CarouselPanel` (`Inspector.tsx:234-237`)
as the panel of a clip with `.graphic`. It shows the template's fields by
mode:

- **Grounded, verbatim and index fields** are re-checked on every edit by
  `checkGraphicData(data: GraphicData, def: TemplateDef, grounding:
  GraphicSpec['grounding'], transcript: Transcript): Problem[]`, the core
  `validateGraphics.ts` exports and `validateGraphics` itself calls per
  graphic (§6.7), run against the graphic's `grounding` stretch. Each
  problem is a warning under its field, never a block: you may type what
  you like. No answer or menu is built for one edited graphic.
- **`user` fields** are never checked.
- **Speaker fields** show the asset's Speaker; editing one calls
  `setSpeaker`, which updates every graphic of that asset that drew the old
  name and rebakes them.
- **App fields are choices**: the connector (none, line, tree) and the
  callout's shape (arrow, circle).
- **The rest**: the seconds within the template's bounds; the place (an auto
  third, or a box you dragged); and a lower third's **Role**, pre-filled
  from the asset's most recent lower third.
- **From phase 3, a Depth choice** (Flat, the default; Tilt, Parallax,
  Dolly, Focus) on templates whose `threeD` is true (§6.16), and the note
  when WebGL is missing.

Each edit is `setGraphic` (§6.3).

**Store actions** (`src/renderer/src/store.ts`): `findGraphics(clipId)`,
`keepGraphic(proposalId)`, `dropGraphic(clipId)`, `clearGraphics()`,
`setSpeaker(assetId, name)`, `setGraphicSounds(on)`. Drop takes the graphic,
its drawn asset when nothing else uses it, and its sounds (§6.14).

**Census rows** (exact text): the Transcript tile's "Graphics", "Find
graphics in this clip", "Keep", "Drop", "check the number" (for a stub
transcript of each source: a YouTube ASR track, a YouTube uploader track,
an unsure Whisper word), "Clear graphics", "Speaker"; the dock's graphic
panel and its "Role"; the OUTPUT strip's "Graphic sounds" (§6.14).

**Tests** (§6.11 indexes them by phase):

- **`tests/directorGraphics.test.ts`.** The schema is flat, `reasoning`
  first, `required` in declaration order (the
  `tests/directorSpine2.test.ts:60-69` pattern); `unsupportedKeywords` and
  `flatViolations` are empty, and the size is printed; the prompt's last
  line is the language; the menu never offers `lower-third` or
  `screen-card`, and offers `callout` only with a subject track; the schema
  offers `keyword.words` and `keyword.lit`, and neither the template enum
  nor any property offers `lower-third`, `parent`, `connector`, `anchor`,
  `depth`, a curve, a duration or a sound (membership over the schema's
  names); truncation and the wrong shape reject the pass but never the
  clip; a wrong-template field and an out-of-range `lit` are repaired;
  spacing; `decisionForGraphics`' shape, with `model.id` `'baseline'` when
  no model answered. Mutations: `lower-third` in the menu or the enum; the
  language line moved up; a `parent` accepted from the answer; the record's
  `model` put inside `ops`.
- **`tests/directorAsk.test.ts`**, a case beside the retry cases at
  `:39-48`: on a first result whose `provider` is `'openai'`, the retry's
  user prompt ends with the nudge and keeps the raised `maxTokens`; on the
  Ollama shape the retry is unchanged (thinking on). Mutation: the nudge
  removed (the OpenAI retry is the same request with more room).
- **`tests/renderer/transcriptGraphics.test.tsx`.** Find graphics lists the
  run's graphics, each with Drop; a "check the number" proposal is not
  placed until Keep; Drop removes the clip, its drawn asset and its sound;
  Clear graphics removes every `'clips.graphic'` clip, asset, sound, file
  and proposal and leaves Direct's; the Speaker field writes
  `MediaAsset.speaker` and a `lower-third` reads it. Mutations: a proposal
  placed before Keep; Clear graphics leaving the drawn asset; Clear graphics
  taking `GRAPHIC_RULE` graphics; the speaker not saved.
- **`tests/renderer/graphicPanel.test.tsx`.** Every grounded, verbatim or
  index field re-checked on each edit through `checkGraphicData`, the one
  `validateGraphics` calls (a spy on the module's export); a typed number not
  in the stretch shows a warning, never a block; `user` fields (Role, a
  social card's) are never checked. Mutations: the check skipped on edit;
  the warning made a disabled field; a `user` field checked.

**Days: 2** (phase 2): the menu, prompt and schema; the ask's fix;
`settleGraphics` and `decisionForGraphics`; Direct's and the tile's wiring
(Clip it's is step 4's, above); the two panels; the store actions and the
four tests (2.5 would be safer; the figure is kept).

### 6.7 The validator — `src/shared/director/validateGraphics.ts` and `claims.ts`

**Phase 2 · 3 days.** `validateGraphics(answer, menu, transcript, options:
{ truncated?: boolean }): { kept: GraphicCandidate[]; dropped: Problem[] } |
{ rejected: string }`.

- **Rejects only what `validate2.ts` rejects**: a truncated answer (`:37`)
  and the wrong shape (`:40`).
- **Everything else is one graphic at a time**: repaired, or dropped with a
  `Problem { path: '$.graphics[i].items[j].value', message }` that the panel
  shows ("graphic dropped: '45%' is not said in s07").
- **A kept graphic** is a `GraphicCandidate` = `{ sentence: string; data:
  GraphicData; bound: number[]; beatWords: number[]; why: string; source:
  'model' | 'baseline'; proposal?: GraphicSpec['proposal'] }`. `bound` holds
  one word index per claim, in claim order; `beatWords` the word index of
  each beat (§6.8). The type is declared in `graphics/template.ts` with
  §6.6's `KeptGraphic`, in phase 1's types commit (§6.19), so the lanes on
  either side of `applyGraphics` share it from the start.

`settleGraphics` (§6.6) is `settle2`'s twin. Given a rejected answer it
validates the baseline the same way and says why. It returns `SettledGraphics`
= `{ kept; dropped; baseline: boolean; rejected: string | null }`.

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

- `validate.ts`'s `normalise` (`director/validate.ts:102`) drops final
  combining marks: 'పెళ్లి' → 'పెళ్ల', 'शादी' → 'शाद', and NFD 'Café' →
  'cafe' while NFC stays 'café'.
- `keywords.ts`'s `normaliseToken` (`automation/keywords.ts:50`) is
  ASCII-only and maps '1.2' → '12' and Telugu or Hindi → ''.

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
     (§16.11). How often it bites is M21's.
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
7. **Negation.** The bound clause runs from the previous clause boundary
   (`, ; : —` or a sentence start) to the next. If the clause a claim binds
   in holds a negator the field lacks, the graphic is **dropped**, or for a
   `quote` **demoted** to the verbatim clause with its negator.
   - **Negators**: `not`, `no`, `never`, `n't`, `without`, `nor`,
     `neither`, `none`, `nobody`, `nothing`; Hindi `नहीं`, `न`, `मत`; Telugu
     `కాదు`, `లేదు`.
   - **Telugu mostly negates with a verb ending, not a word**, which no list
     catches. In v1 a Telugu clause whose verb ends in a negative suffix the
     eval's fixtures collect is treated as negated, and the gap is measured
     on the Telugu fixtures before phase 2's exit (§15 row 11).
8. **Field modes** (`TemplateDef.fields`):
   - `verbatim`: the field's normalised tokens are a contiguous run of one
     sentence, **starting and ending on a sentence or clause boundary**. A
     run directly after a negator is refused ("I'd never tell you to quit
     your job" cannot become "quit your job"). `keyword` relaxes the
     boundaries only (rule 9).
   - `grounded`: every content token binds as in rule 6, after normalising
     and folding English plurals (`s`, `es`) on both sides.
     - Exempt: the template's fixed words, and **an explicit English
       function-word list**: `a an the of to in on at for from by with and
       or but so as is are was were be been it its this that these those
       our my your their we i you they he she have` (40 words).
     - **Never exempt**: negators (rule 7), direction words and
       comparatives (`up down more less fewer than before after over
       under`).
     - No list exists yet for Hindi or Telugu, so every token there is
       checked.
   - `fixed`: one of the template's `fixedTitles`, or the style's own
     glyphs; never checked, never model-written.
   - `speaker` (the `quote`'s and the `lower-third`'s, set by the app):
     `''`; or the asset's speaker as you set it (`MediaAsset.speaker`, the
     Transcript tile's field); or, for a linked video, the channel from
     yt-dlp's metadata (§7.1), never the model's; or, for a `quote` only, a
     name **when the stretch says "<name> said / says / told …" directly
     governing the quoted run**. A run directly after a reporting verb is a
     reported quote: kept only with that verb's subject as the speaker, else
     refused. So "My mentor told me, and I think Elon said something like
     it: fail fast" cannot ship "fail fast — Elon". A `lower-third`'s `name`
     is `MediaAsset.speaker` alone.
   - `index` (new, 2026-10-21; the research, §4.5): a number that points
     into another field, not a claim. `keyword.lit` must be an integer with
     0 ≤ `lit` < the number of words in `words`. Out of range, it is
     **repaired** to the last word with a note, since emphasis on a wrong
     word misstates nothing the speaker said. A range check is all the
     validator can do for it.
   - **There is no `free` mode for anything drawn into a frame.** The 2B
     model writes no free text that lands in a picture. (Best clips' card
     titles are shown in the UI only; §7.4 holds them to their own rule.)
     The social quote card's `user` mode (§8.4) and the lower third's
     `role` are your own typing, never a model's, so the validator never
     sees them.
9. **Template rules after binding:**
   - `ring` ≤ 100 and `%` on the matched number (rule 5);
   - `bars` one matched unit (rule 5);
   - `counter` must contain a number;
   - `callout`: the validator has no project or subject track in its
     arguments, so it refuses only a `callout` the menu did not offer
     ("not offered": the clip has no subject track, §6.6). A callout whose
     subject is missing at its onset is dropped by `applyGraphics`'
     placement step (§6.9 item 4), with this rule's note, "no subject found
     to point at"; its tests are `graphicPlace`'s, not `claims`';
   - `quote` at most 16 words;
   - **`keyword`** (new): its `words` are a contiguous run of 1-4 said
     words inside one sentence, and may start and end mid-clause; in
     English, at least one token is outside `FUNCTION_WORDS_EN`; rule 7
     applies to the clause the run sits in, so "this is not easy" cannot
     ship "easy"; a run directly after a negator is refused, as
     `verbatim`'s is; its one beat is its first word;
   - **`lower-third`** never comes from the model: a graphic the answer
     names `lower-third` is dropped ("not offered");
   - **`steps`**: after binding, the app sets `connector` and every `parent`
     (`treeParents`, §6.2). If `parentsValid` fails, the graphic keeps
     `connector: 'line'` and flat parents, with a note: an invalid tree
     never ships.
10. **Spacing (code, not model).** Graphics are at least 6 s apart and at
    most one per 20 s of clip; the earlier one wins (`GRAPHIC_SPACING`, kept
    for every graphic, D12, §16.65). `settleGraphics` applies it within the
    answer, so the eval counts what the app would place. `applyBudget`
    applies it again across the project with the other budget rules
    (§6.9).
11. **The anchor (phase 4).** A callout's `anchor` must name a `PointEvent`
    that exists in `Project.hands` for the clip's asset and overlaps the
    graphic's beat. The rule's text is §6.18's; it is listed here so the
    count of rules is whole. The field is reserved in phase 2 and never
    filled there.

Each bound claim records the **word index** it bound to. Those indices are
the beats (§6.8) and are kept in `grounding.words`. §16.11's strictness is
unchanged by any of the additions above. A screen card has no claim, so the
validator never sees it (§6.16).

**`claims.ts`**, its exports as §6.7 as written:

- `CanonNumber` = `{ n: number; unit: '' | '%' | 'currency'; currency?: '$'
  | '€' | '£' | '₹' }`
- `Claim` = `{ path: string; text: string; kind: 'number' | 'token' | 'run';
  value?: CanonNumber; pair?: number }` (`pair` an index into the
  template's pairs)
- `BIND_WINDOW = 8`
- `NEGATORS: Record<'en' | 'hi' | 'te', readonly string[]>`
- `FUNCTION_WORDS_EN: readonly string[]`, the 40 above, asserted to contain
  no negator, direction word or comparative
- `claimToken(raw: string): string`, rules 1-3 on one token (renamed
  2026-10-21 from the contract's `normaliseToken`, which
  `automation/keywords.ts:50` already exports with an ASCII-only body that
  maps 'शादी' to '' and '1.2' to '12': one name for two functions is the
  trap `MotionEase` and `CaptionLayersSpec` were named to avoid)
- `numbersIn(tokens: string[]): { value: CanonNumber; at: number }[]` (`at`
  a token index)
- `claimsOf(data: GraphicData, def: TemplateDef): Claim[]`
- `bind(claims, stretch: { words: Word[]; sentences: Segment[] }, lang:
  string): { ok: true; at: number[] } | { ok: false; missing: Claim[];
  reason: 'absent' | 'unpaired' | 'order' | 'negated' | 'unit' }` (`at` one
  word index per claim)

`claimsOf` makes no claim of an `index`, `user`, `fixed` or app field.

`validateGraphics.ts` also exports `checkGraphicData(data: GraphicData,
def: TemplateDef, grounding: GraphicSpec['grounding'], transcript:
Transcript): Problem[]`, the per-graphic core (rules 4-9 over one graphic's
data against its stretch) that `validateGraphics` calls for each answer
graphic and the dock calls on each edit (§6.6), so the two cannot check
differently; `graphicPanel.test` pins the shared call.

**Tests** (§6.11 indexes them by phase):

- **`tests/claims.test.ts`**: every normaliser rule, including Telugu and
  Hindi marks kept and NFC = NFD; `1.2 ≠ 12`; Indian grouping; 'forty
  percent' = '40%'; '$1.2M' = '1.2 million dollars'; a unit added by the
  model fails, and a unit dropped passes **where the template allows it**;
  native digits; **the review's cases, each named**: "we signed 40 clients"
  + ring 40 → dropped; "we spent $40 on ads and 40% of signups came from
  them" + bars with **bare** values [ads 40, signups 40] → dropped (the spec
  strings share a unit; the matched numbers do not); the
  Instagram/referrals swap → dropped; "3 offices … 40 staff in 2019, now 12
  offices" + bars [2019: 12, now: 3] → dropped; "It's not true that 90% of
  startups fail" + ring → dropped; "I'd never tell you to quit your job" +
  quote "quit your job" → refused; "…I think Elon said something like it:
  fail fast" + speaker Elon → refused; stretch "clients happy" + label
  "clients not happy" → dropped; a counter's label taken from the next
  sentence, within 8 tokens across the boundary → dropped; a label 12
  tokens from its value in one sentence → dropped; `FUNCTION_WORDS_EN`
  contains no negator, direction word or comparative (membership over each
  list); and **the new cases**: "this is not easy" + keyword "easy" →
  dropped; keyword "my job" taken across two sentences → dropped; keyword
  "of the" → dropped (no content word); `lit` 7 on a two-word keyword →
  repaired to 1; an answer naming `lower-third` → dropped.

  Mutations, **each killed by a case that no other rule also catches**
  (checked when the case is written): `claimToken` replaced by
  `automation/keywords.ts`'s `normaliseToken` (1.2 = 12); strip `\p{M}`; ignore units; **ring's `%` not required** (the
  40-clients case); **units checked on the spec strings, not the matched
  numbers** (the bare $40/40% bars); **the same-sentence rule removed** (the
  next-sentence label); **the 8-token window removed** (the 12-token
  label); **spoken order not checked** (the Instagram swap and the 2019
  bars, which every other rule passes); **negators exempt as function
  words** (the "clients not happy" label); **rule 7 removed** (the 90 %
  ring); and, new: keyword's rule-7 check removed ("not easy"); keyword
  allowed across a sentence boundary; `lit`'s range check removed.
- **`tests/graphicsValidator.test.ts`, the property test.** Random specs
  against random stretches, by a fixed-seed generator, **plus adversarial
  generators**: swap the values of two pairs; insert a negator into the
  bound clause; take a label from the neighbouring sentence; strip a unit
  from the stretch but not the spec; and, new, a `keyword` run with a gap
  in it; a keyword run stretched over a negated clause; a `lit` past the
  run's end; a model-written `parent`. **An independent matcher**: every
  graphic `settleGraphics` keeps is grounded by a matcher that checks
  BINDING, not membership (one occurrence per claim, same sentence, the
  window, spoken order, no unmatched negator). **Over what the painter
  draws**: each kept graphic, given beats, is turned into its settled frame
  by `drawListAt` with a fake `measure` (node, no fake context), and every
  `text` item's string (per-word pieces joined, fixed glyphs set aside)
  must ground. So a template that reformats a number or adds a unit fails
  the property even when the spec is clean; `tests/graphicPaint.test.ts`
  (§6.3) pins `paintDrawList2d`'s `fillText` strings to those items. This is
  the bar's "by construction", node-pure. Mutations, each failing the
  property: skip `grounded` fields; drop the order rule; let `inBetween` or
  `drawListAt` regroup the settled value; let a template draw `data.label`
  re-cased; accept a `keyword` run with a gap. (Let the painter regroup:
  `graphicPaint` fails.)

**Days: 3** (phase 2): `claims.ts`, `validateGraphics.ts`, `settleGraphics`'
validation half, and both tests.

### 6.8 Beats — the words land the animation

**Phase 2 · 0.5 day.** `graphicBeats(project, clip, transcript,
wordIndices: number[]): number[] | null`, in `src/shared/graphics/beats.ts`.
`clip` is the footage clip the words show on. It returns each beat's
**timeline** time in seconds, or null when the clip is retimed.
`applyGraphics` then sets the graphic clip's start frame and stores
`GraphicSpec.beats` relative to it, in seconds (§6.1). `beats.ts` also holds
`readingSeconds` (§6.2).

- **Beat times.** Each element's grounded word is its beat (`beatWords`,
  §6.7; the per-template beats are §6.2's table): `word.startMs` → timeline
  seconds through the clip, with the same offset the captions use
  (`offsetMs`, `captions/timeline.ts:86-96`, `:96`). The graphic then agrees
  with the captions.
- **Lead, settle, tail.** The graphic clip starts `LEAD_S` (0.5 s) before
  the first beat, the entrance, but never before the footage clip's start.
  Its seconds are §6.2's rule: at least to the last beat plus `TAIL_S`
  (0.8 s), within the template's bounds, and never past the footage clip's
  end. If the footage clip ends too soon, the graphic is dropped ("too close
  to the clip's end to be read"). An element **arrives on** its beat: the
  counter reaches its value, a bar its length, a row its place, an edge its
  child. The moving frames end at the last beat plus `SETTLE_S` (0.5 s), and
  the last `EXIT_S` (0.3 s) is the opacity exit (§6.3).
- **Spacing.** Two arriving beats closer than 160 ms are spread to 160 ms,
  the later moved, the minimum gap of `planLyricCuts`
  (`DEFAULT_MIN_GAP_MS`, `automation/lyrics.ts:192`; `planLyricCuts` at
  `:211`). **A quote's beats are not spread**: they light words, as the
  captions' highlight does, and spreading them would drift the lit word
  from the speech.
- **Punch is not used.** `punchOf` is ASCII-only (`lyrics.ts:76`), so every
  Indic word scores 0.2; word starts are script-neutral.
- **Retimed clips are refused** with a note ("graphics on a speed-changed
  clip are not timed yet"), as J-cuts refuse a retimed clip
  (`director/apply2.ts:248`, `speed` or `ramp` set). The captions and props
  mapping ignores speed today (`automation/apply.ts:58-65`), so a
  speed-aware graphic would drift from its own captions. The proper inverse
  is `timelineFrameAt` (built in M0, §3b.6), applied to captions and
  graphics together later (§17).
- **The onset.** A transcript's `startMs` is not the audible onset to the
  frame. M15 (you mark 30 onsets) says whether beats need a refinement;
  until then a beat is the word's `startMs`.
- **A `lower-third`'s beat** is the first word of the asset's transcript
  that the clip shows. **A `keyword`'s** is its first word. **A `quote`'s**
  are its words.

**Test:** `tests/graphicBeats.test.ts`: a beat is its word's `startMs`
through the clip with the captions' offset, on a trimmed clip and on a clip
moved later; the lead clamped at the clip's start; the tail and the
template's bounds; 160 ms spreading of arriving beats, but not of a quote's;
a retimed clip refused with its note (`graphicBeats` returns null).
Mutations: the offset dropped, or taken from `clip.start` without
`inPoint`; `endMs` for `startMs`; 100 ms spacing, or spreading removed;
spreading applied to a quote; a retimed clip accepted; beats one frame
late.

**Days: 0.5** (phase 2).

### 6.9 Placement and the budget — `src/shared/graphics/place.ts`, `budget.ts`

**Phase 2 · 1 day.**

**Placement.** `placeGraphic(project, clipId, startFrame, frames, template,
canvas: { width: number; height: number }): GraphicSpec['place'] | null`,
where `clipId` is the footage clip and `canvas` the output frame (as
`captionThirds` and `subjectBoxesAt` both take one); null is "no free
third":

1. **The caption's third over the span is excluded.** Captions are burned
   last over the whole picture (`captions/timeline.ts:9-12`), so they would
   sit over any graphic.
   - With captions on and `placement: 'smart'`, that is every third
     `thirdAt` (`freeSpace.ts:227`) gives over the span, from one
     `captionThirds` (`:199`).
   - Otherwise it is the caption style's own third (`styleThird`, `:51`).
   - With captions off, nothing is excluded.
2. **The subject's overlap per third** is read as Smart placement reads it.
   Smart placement's sample reader, `spanSamples` (`freeSpace.ts:166-191`),
   is private: it holds each sample to its shot's frames through
   `exportFrameAt` and falls back to the sample nearest a short shot's
   middle. Step 3 exports a span reader beside it, `samplesOver(project,
   clip, asset, canvas, from: number, to: number): Record<Third,
   number>[]` (clip frames, `from` inclusive, `to` exclusive), which applies
   `spanSamples`' rule to each shot the range crosses (each sample placed on
   its export frame through `exportFrameAt` and held to its shot's frames)
   and keeps the samples whose frame falls in the range; when none does, it
   takes the sample nearest the range's middle, as `spanSamples` does for a
   short shot. It has its own mutation-checked cases in
   `tests/freeSpace.test.ts` (a range inside one shot reads only that
   shot's samples inside the range; a range shorter than the sample step
   reads the nearest; mutations: the range ignored, so the shot's every
   sample counts; a sample clamped into the range instead of left out). `shotOverlap` (`:131`)
   then gives the 90th percentile of `samplesOver`'s overlaps, so one
   gesture does not move a graphic.
3. **The best remaining third is taken.**
   - A third is free when its overlap is at most `OVERLAP_LIMIT` (0.05,
     `:39`). Among free thirds the template's preference decides: `steps`
     (any connector) and `bars` take the middle first, then the top, then
     the bottom; `lower-third` takes the bottom first, then the top; every
     other template takes the middle, the top, then the bottom.
   - With no free third, the least-covered remaining one is taken, and the
     style's panel or dim keeps the type legible.
   - With no remaining third (the caption takes all three over a span that
     crosses two cuts), the graphic is dropped ("no free third").
   - **With no track**: the middle, or the top when the captions use the
     middle (§6.9 as written).
4. **The subject at onset.** `GraphicSpec.subject` = `{ clipId, box, ms }` is
   taken **once, at the graphic's onset frame**, from the sample
   `subjectBoxesAt` reads on that frame (`nearestSample`,
   `frameMap.ts:235-245`, from the shot the export shows): its largest face,
   in SOURCE units, without the chin extension, at the sample's ms.
   `graphicTargetsAt` (§6.3) maps it through `sourceToFrame`
   (`frameMap.ts:86-132`) at the onset frame, and that one `GraphicTargets`
   is what the preview and the bake pass for every frame of the clip. So in
   phase 2 the callout's target, the dim's hole and a connector's target are
   all fixed at onset (chosen 2026-10-21). **This departs from the
   research as well as from §6.9 as written**: the research's §4.6 fixes
   only the dim's hole and a connector's target at onset and maps the
   callout through `frameMap.ts` on every frame, as §6.9 as written did.
   - **Why, two reasons.** The sampling: re-reading the face per frame
     through `subjectBoxesAt`, which takes the nearest of two samples a
     second and never interpolates (`frameMap.ts:235-245`, `:275-291`),
     would make the target jump every 0.5 s. The cost: mapping even a fixed
     source box through a moving crop changes the target on every frame of
     a followed clip, so every held frame becomes a moving one (§6.3 gives
     the figures). The first reason is answered by fixing the source box at
     onset; only the second needs the mapping fixed too, and it is the one
     this plan weighs heavier for a 1.5-3 s callout.
   - **What it costs.** A callout on a static crop of a speaker who moves
     points where the face was; over a 1.5-3 s callout on a talking head
     that is expected to be small, and it is unmeasured.
   - **A null target.** A callout whose subject maps to null at onset (off
     screen, or no sample there) is dropped here, in `applyGraphics`'
     placement step, with §6.7 rule 9's note. Any other template draws its
     dim without a hole.
   - **A camera move or a zoom beneath.** `sourceToFrame` does not model a
     camera move or zoom keys on top of the crop (`frameMap.ts:31-35`; step
     2's Built note says the same). So when the footage clip beneath
     carries a `motion` (`Clip.motion`, `timeline.ts:545`, Ken Burns or a
     shake) or a `zoom` key other than 1 anywhere over the graphic's span
     (`Clip.keyframes`, `:566`), the subject is not taken: a callout is
     dropped ("the shot zooms under it, so its target would miss"), and
     every other template draws its dim without a hole. A held zoom of 1 is
     no zoom.
   - Only phase 4's fingertip is mapped per frame (§6.18).
5. **The hand.** In phase 4 the hand's box is a second obstacle in step 2
   of this list (§6.18, `pointPlacement`).

`place.auto` is recomputed, with the subject at onset, by `rebakeGenerated`
on an aspect change or a reframe (§6.4 wires the call); a box you dragged
is kept.

**On the timeline.** Graphics sit on lanes **above the look and every card**
(§16.7), so type is never graded and never hidden under a moment.

- **The starting lane** is the lowest video track above both the footage
  clip's track and every track holding an adjustment clip (`Clip.adjustment`:
  the look, and a grade of yours), a moment, or a Director card
  (`COPY_RULE`, `ENDING_RULE`). This is `cardsAbove`'s rule
  (`director/apply2.ts:558`; `laneFor` at `:538`) widened to cards and
  adjustments.
- **From there**, the first lane free over the span is taken (`stackedSlot`,
  `timeline.ts:1201`), else a new top track (`addTrack`, `:1469`). At the
  track limit (`trackLimitReached`, `:1228`) the graphic is dropped with a
  note.
- **Direct's new track** is marked `director: true`, so Clear takes it when
  empty (`clearDirector`). Clip it's is not marked.

**The budget.** `applyBudget(project, candidates): { kept; dropped: { spec;
reason }[] }` runs over every graphic already on the timeline (any rule,
kept first: they are placed) and the run's candidates in onset order. The
earlier one wins. A candidate is kept only when every rule holds:

1. **Spacing for every graphic** (D12, §16.65): its onset is at least
   `GRAPHIC_SPACING.minGapS` (6 s) from every kept graphic's onset, and the
   kept graphics over its clip number at most max(1, ⌊clip seconds ÷
   `GRAPHIC_SPACING.perS` (20)⌋). "Its clip" is the footage clip for Clip
   it and the tile, and the whole ad for Direct, whose shots are a few
   seconds each. **The lower third is outside the per-20 s count**, though
   it keeps the 6 s gap and rule 2 (a reading of D12 recorded 2026-10-21
   by the review, for you to overturn): counted, it would take the only
   slot of every clip under 40 s whose asset has a Speaker, max(1, ⌊30 ÷
   20⌋) = 1, so a typical 30 s short would get its name card and no
   counter, keyword or steps, against D1's point of "three templates that
   fire without numbers" (§16.54). Being on the clip's first word, it is
   the earliest, so it is placed first and the next graphic starts 6 s
   after it at the soonest.
2. **One on screen.** Its span overlaps no kept graphic's span. A Director
   card (`COPY_RULE`, `ENDING_RULE`) counts as one: one piece of designed
   type at a time.
3. **None over a zoom punch.** Its span overlaps neither a clip whose
   `moment.kind` is `'zoom-punch'` (`timeline.ts:290`) nor, on the footage
   clip beneath, a span between two adjacent `zoom` keys of different value
   (`KEYED_PROPERTIES`, `render/keyframes.ts:74`). A held zoom is not a
   punch.
4. **The per-minute cap.** When `GRAPHICS_PER_MINUTE` is set, no 60 s window
   of the timeline holds more than that many graphics. It is null until M17
   gives it a value (§6.15). Rule 1 alone already allows at most three a
   minute.

**The screen card is outside the budget** (§6.16): it frames footage and
says nothing, so it counts toward neither the spacing nor the one-on-screen
rule, and graphics may sit over it. This is a reading of D4 against D12,
recorded here: D12 keeps the spacing "for every graphic", and D4 gives a
screen recording "the 2.5D card, a dim and graphics", which a card that
held the only slot over a recording could not. While a card is on screen
its dim is the only dim: another graphic's dim is not drawn.

Dropped candidates go to the notes with their reason ("another graphic is
on screen then", "over a zoom punch at 12.4 s"). `GRAPHIC_SOUND_CAP` is
applied by `graphicSounds` (§6.14), not here.

**Tests** (§6.11 indexes them by phase):

- **`tests/graphicPlace.test.ts`**: the caption's third excluded, from the
  style and from Smart placement (captions at the bottom, a face in the
  middle: a counter goes to the top); the middle preferred by `steps` and
  `bars` when free; the bottom by `lower-third`; the no-track default;
  `callout`'s target through `sourceToFrame` on a reframed 9:16 clip, fixed
  at onset (the held frames equal); `place.auto` recomputed on an aspect
  change and a dragged box kept; the dim's hole and a connector's target
  from `subjectBoxesAt` read once, at onset; a callout whose subject is
  null at onset dropped with rule 9's note; over a footage clip with a
  Ken Burns `motion` or a `zoom` key of 1.2, a callout dropped and a
  counter's dim drawn without a hole, while a held zoom of 1 changes
  nothing. Phase 4 adds a `PointEvent.hand` box as a second obstacle
  (§6.18). Mutations: the caption's third not excluded; the callout at the
  source box unmapped; a dragged box recomputed; the subject re-read per
  frame (the held frames differ); the null-subject drop removed (a callout
  points at nothing); the zoom check removed (the target misses by the
  zoom); (phase 4) the hand's box ignored.
- **`tests/graphicBudget.test.ts`, the no-overlap test**: §6.7's spacing for
  every graphic (≥ 6 s apart, ≤ 1 per 20 s, the earlier wins); one graphic
  on screen at a time (a `steps` 8 s long and a counter starting 6.5 s
  after it: the counter is dropped although the spacing passes), a Director
  card included; none over a zoom-punch moment or a zoom move, a held zoom
  allowed; `GRAPHICS_PER_MINUTE` applied once it is not null; a screen card
  outside the count; on a 30 s clip with a Speaker, the lower third and a
  counter 8 s later both kept (the lower third outside the per-20 s count,
  inside the 6 s gap); and a property over every fixture's settled graphics:
  no two overlap in time and none sits over a punch (§6.12). Mutations: the
  later graphic winning; an overlap allowed when the spacing passes (the
  overlap check removed); punches or zoom keys ignored; the lower third
  counted (the 30 s clip's counter is dropped).

**Days: 1** (phase 2).

### 6.10 The baseline and the eval

**Phase 2 · 1.5 days.**

**The baseline (no model)**, `director/baselineGraphics.ts`:
`baselineGraphics(transcript, menu): GraphicCandidate[]`. It is
deterministic:

- a sentence with a `%` → `ring`;
- a number with a unit or currency → `counter`;
- two or more consecutive sentences opening with ordinals ("first",
  "second", "step one") → `steps`, its connector and parents from `tree.ts`
  (§6.2);
- (new) an English sentence of at most 8 words (proposal), not a question,
  whose last one to three words hold a content word → `keyword` of those
  words, `lit` the last. Hindi and Telugu get no baseline keyword in v1:
  their sentences end on a verb or an auxiliary, and no function-word list
  exists to see past it;
- each validated the same way (§6.7).

It is what "preferred to the standard" compares against, and what runs with
no model. No model and no baseline ever makes a `lower-third`: it is the
app's, placed in every run on the speaker's first word when the asset has a
Speaker (§6.6, §6.8).

**The eval** (`tests/eval/director.eval.test.ts`) gets a
`FORGE_EVAL_GRAPHICS=<folder>` block, copied from the look-pass block
(`:173-237`):

- `STEP=prepare` writes the requests, built with the app's own
  `graphicsMenuFor`, `graphicsPrompt`, `graphicsSchema` and
  `maxTokensForGraphics`, in the `EvalRequest` shape, so the relay
  (`src/renderer/src/harness/evalRelay.ts:57-63`) posts them unchanged;
- `STEP=score` settles each answer through `settleGraphics` into
  `results-graphics.json`;
- `scripts/eval-report.mjs`'s `summarise()` (`:30`) gains a pass filter, so
  a graphics run does not show as a broken spine row.

**Fixtures**, `tests/fixtures/graphics/*.json`, all of your own speech or
text written for this plan (third-party speech cannot be committed). Who
writes what:
the ten eval transcripts are your recordings and your truth; the Hindi and
Telugu strings everywhere are yours; a lane may write the three English
nested fixtures and the English drawing fixtures as text, for you to check
before they are relied on. The shapes (added 2026-10-21):

- `eval-*.json`: `{ language: string; transcript: Transcript; truth: {
  sentence: string; template: GraphicTemplateId }[]; traps: string[] }`
  (`traps` names the sentence ids that hold a trap, for the report).
- `nested-*.json`: `{ language: string; transcript: Transcript; title:
  string; items: string[]; parents: number[] }` (`parents` as
  `treeParents` returns them; a text-written fixture times its words at
  0.3 s each, since `treeParents` reads only their order).

The sets:

- **The eval's ten transcripts** (`eval-*.json`), six English, two Telugu,
  two Hindi. They hold numbers both in digits and spoken out ("forty
  percent"), names, a list of steps, a quotable line, a phrase worth a
  keyword, **and the traps**: two numbers with two labels in one sentence,
  a negated claim, a reported quote, a count that is not a percentage, and a
  negated phrase a keyword might lift. Each has your truth: the sentence ids
  where a graphic belongs and its template.
- **The nested-enumeration set** (`nested-*.json`, new): five short talks,
  three English, one Hindi, one Telugu, in which the speaker enumerates
  items with sub-items ("three things; the first has two parts …"). Each
  has the expected title, items and parent list. The English three are
  `treeParents`' exit (exact match, §6.12). The Hindi and Telugu two are
  scored and recorded, not passed: v1's parser is English only (§6.2).
- **The drawing fixtures** (`specs.json`, §6.2): 27 specs, one per shape in
  English, Hindi and Telugu.

**Recorded per run:**

- parsed / truncated / shape, and whether prose came back (§6.6's nudge);
- graphics proposed, per template, `keyword` included;
- **the share dropped by the validator**, by reason, the hallucination rate
  and the key number;
- Hindi and Telugu graphics dropped because a number was said as a word
  (§16.11; M21 sizes it);
- Telugu clauses with a negative ending missed (§15 row 11);
- `lit` repairs;
- the truth-hit rate (±1 sentence);
- a blind 1–5 template-fit rating through `npm run eval:rate`
  (`scripts/eval-rate.mjs`);
- the nested set's exact matches;
- model against baseline.

**The blind curve rating (M14)** is run in phase 2, on your clips, in the
development app's console (`await window.__forgeGraphicCheck({ curves: {
names: [...], clipId: '<a graphic clip of the open project>' } })`, §6.11,
§6.15):

1. **The renders.** The named graphic clip, landing on its word, is
   rendered under each of the six curves at 30 fps; you run it once on each
   of three of your clips. Each render gets a letter A-F, shuffled per run
   and shown on the page; the key is returned in the result object, not
   shown, and you save it with DevTools' `copy()` into
   `tests/output/graphic/curves/key-<date>.json` (gitignored) before you
   watch: the renderer has no channel that writes into the repo.
2. **The pick.** You watch each clip's six without the key and pick the
   best, and a second.
3. **The score.** The curve picked first on the most clips becomes the
   default `ease` of `clean` and the restrained presets (§6.5). A tie, or no
   clear pick, keeps `expo-out`, the research's default. The picks and the
   key go to EFFECTS §61.

M14's command names a counter. The same rating is run with a `keyword` (an
entrance) and a `callout` (a draw-on) as the named clip, so "the default
curve per template" covers the three motions phase 2 has; a
template whose own pick differs from the overall winner records it as its
default (§6.13). Durations are not rated in the same pass: one variable at a
time.

**The blind look rating** (added 2026-10-21 by the review: several rows of
§6's "What waits", the presets and `DURATIONS` waited on "phase 2's
ratings", and M14 picks curves only). Run in phase 2 after M14's winner is
set, on your clips, in the development app's console (`await
window.__forgeGraphicCheck({ look: { clipIds: [...] } })`, §6.11), as M14's
is run:

1. **The renders.** For each named graphic clip (at least six, covering
   the eight templates, on three of your clips), the clip rendered under
   `clean`, `bold`, `editorial` and `energetic`, and `clean` again with
   `dim` on; letters shuffled per clip, the key returned for you to save as
   M14's is.
2. **The questions**, answered per graphic without the key, 1-5 where it is
   a rating: does it look like a pro reveal or tutorial (your bar, §0), per
   render; restrained against energetic, which you would ship; is the dim
   wanted; would motion blur on the fast moves help (yes or no); would a
   check tick beside a step help (yes or no); does the energetic style
   want more (ripples, a burst: yes or no); is any duration too quick or
   too slow (name the template).
3. **What it decides.** The median rating per preset goes to EFFECTS §61
   with the key. A "yes" on at least half the graphics unlocks its row of
   "What waits" as its own later change (outside step 3's days); a
   template named too quick or too slow twice has its `DURATIONS` or
   seconds revised in phase 2; a preset rated under 3 on every graphic is
   revised or removed; the dim's answer sets `dim` in the restrained
   presets.

**Your part** (§2's table): about 4 hours to record and mark the ten
transcripts, 1.5 for the nested set, 1 to write or check the 27 drawing
fixtures' Hindi and Telugu strings, and 2 for M14's three rating rounds and
the look rating; about 8.5 hours in all.

**Days: 1.5** (phase 2): the baseline, the eval block, the report's filter,
the fixtures' wiring, and M14's and the look rating's runs.

### 6.11 Tests, harness check, render checks, mutations — by phase

**1 day**: 0.5 in phase 1 (the harness check's `pathLength` and `strokes`
widths, `graphic.int`'s phase-1 cases, `SHAPES`' graphic overlay), 0.5 in
phase 2 (the harness check's `templates`, `curves` and per-template Indic
options, `graphic.int`'s phase-2 cases, the property test's wiring): the
pieces no single section owns. Every other test is written with its piece
and counted in that piece's days; phase 0's are inside §6.15's, phase 3's
and phase 4's inside §6.16's and §6.18's.

Every regression test is mutation-checked: the bug put back, the test seen
to fail, the file restored byte for byte. Every string anchor is counted
with `matchAll` first and asserted over every match, or anchored on text
that is unique, with its arguments. Membership is asserted, never a whole
list (`CLAUDE.md`). A mutation is listed with the case that kills it; where
a mutation could be killed by a rule other than the one it names, the case
is written so that only the named rule catches it, and that is checked when
the case is written (as §6.11 as written did for `claims.test`). Each test
is specified once, in the section that owns its code, with its cases and
its mutations; this section holds the index, the phase 0 cases, the
existing tests that change, the harness check, the Indic render check, the
render check and the census.

#### Where each test is written

| phase | test | specified in |
|---|---|---|
| 0 | `tests/oldestFfmpeg.test.ts`'s M4 case; `tests/integration/graphic.int.test.ts`'s libass reference; `tests/integration/asr.int.test.ts`'s M21 case | below |
| 1 | `tests/graphicGuards.test.ts` | §6.4 |
| 1 | `tests/graphicMotion.test.ts` (M9) | §6.13 |
| 1 | `tests/graphicStroke.test.ts`, `tests/graphicDrawList.test.ts`, `tests/graphicPaint.test.ts` | §6.3 (two depth cases in `graphicDrawList`, §6.16) |
| 1-3 | `tests/graphicFrame.test.ts` | phase 1 §6.3, phase 2 §6.2, the screen card §6.16 |
| 1-2 | `tests/graphicStyle.test.ts` | §6.5 |
| 1-3 | `tests/renderer/graphicStore.test.ts` | phase 1 §6.3, the sounds that follow a graphic §6.14, the screen card §6.16 |
| 2 | `tests/claims.test.ts`, `tests/graphicsValidator.test.ts` (the property test) | §6.7 |
| 2 | `tests/directorGraphics.test.ts`, `tests/renderer/transcriptGraphics.test.tsx`, `tests/renderer/graphicPanel.test.tsx` | §6.6 |
| 2 | `tests/graphicHolds.test.ts` (M16), `tests/graphicTree.test.ts` | §6.2 |
| 2 | `tests/graphicBeats.test.ts` | §6.8 |
| 2-4 | `tests/graphicPlace.test.ts`, `tests/graphicBudget.test.ts` | §6.9 (phase 3's hero case in `graphicBudget`, §6.16; phase 4's hand case in `graphicPlace`, §6.18) |
| 2 | `tests/graphicSound.test.ts` (the sound Clear test) | §6.14 |
| 3 | `tests/graphicCompositor.test.ts` | §6.16 |
| spike, 4 | `tests/handsEvents.test.ts`, `tests/handsSmooth.test.ts`, `tests/handsAnchor.test.ts`, `tests/sidecar/test_hands.py`, `tests/integration/hands.int.test.ts` | §6.18 (their first versions, §6.17) |
| 4 | `tests/renderer/pointingToggle.test.tsx` (added 2026-10-21 by §6.18) | §6.18 |
| 0-4 | `tests/integration/graphic.int.test.ts`, the render check | below |
| 0-2 | the Indic render check, in the app's renderer | below |

#### Phase 0's cases

- `tests/oldestFfmpeg.test.ts` gains **M4's case** (§6.15): it runs the
  bundled ffmpeg (`FFMPEG`, `tests/integration/output.ts:21`) with
  `-hide_banner -h filter=<name>` for `tmix`, `overlay` and `perspective`,
  and prints, through `ciNotice` (`tests/integration/helperDiag.ts:211`) as
  one notice titled "oldestFfmpeg: M4 probes", whether each exists and
  whether `overlay`'s help lists `alpha` with `premultiplied`. It reads
  presence from the text, never the exit code: on the Mac's bundled 4.4
  (measured 2026-10-21 for this plan) an existing filter's help begins
  "Filter <name>", and `-h filter=nosuchfilter` exits 0 and prints "Unknown
  filter 'nosuchfilter'."; `overlay`'s help lists `alpha` with `straight`
  and `premultiplied`. It asserts only that `overlay` is found (so a probe
  that prints nothing fails), and records the rest: a filter missing on the
  Windows build is struck from §13's later options, not worked around.
  Mutation: the presence read from the exit code (the unknown filter reads
  as present).
- `tests/integration/graphic.int.test.ts` begins, **with the libass
  reference for M22**: a hand-written `.ass` of the EFFECTS §51 clusters
  (क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త, one per event) burnt through the bundled
  ffmpeg with the plan's own filter, `ass=…:shaping=complex` and again
  `shaping=simple`, into `tests/output/graphic/indic-libass/` as one contact
  sheet per level. `captions.int`'s Indic case
  (`tests/integration/captions.int.test.ts:213`) carries four of each
  script's five clusters (no ज्ञ, no స్త) and renders into a temp folder it
  deletes (`:27`, `:37-38`), so it cannot be the reference the eye compares
  against. The case prints, per cluster, whether complex and simple differ
  (a `ciNotice` on CI). It asserts nothing about the fallback face: in phase
  0 `/assets` is gitignored and CI's libass draws whatever it finds, and
  from §6.20's fonts commit on, the two Noto faces are in its `fontsdir`.
- `tests/integration/asr.int.test.ts` gains **M21's gated case**: with the
  models folder it already reads (`FORGE_MODELS_DIR`, `:11`) and a folder of
  your Hindi clips (`FORGE_ASR_HINDI=<folder>`, proposal), it transcribes
  each and writes every number-bearing word as the model wrote it
  (Devanagari digits, ASCII digits or words) into
  `tests/output/asr/hindi-numbers.txt`. Skipped without the folder.

#### Existing tests that change

- `tests/oldestFfmpeg.test.ts`: M4's case (phase 0, above); and in phase 1 a
  graphic's PNG sequence with its opacity exit joins `SHAPES` (`:196`), so
  the `TOO_NEW` scan (`:61`) covers the graphic overlay's shape although
  nothing in it is new (§13).
- **Every `Bakers` literal gains `graphic`** (phase 1; `Bakers.graphic` is
  required): `tests/exportBake.test.ts:23`, `tests/moment.test.ts:522` and
  `:551`, `tests/reframeConsumers.test.ts:104`,
  `tests/integration/exportBake.int.test.ts:45`, `jcut.int.test.ts:49`,
  `moment.int.test.ts:52`, `spine2Render.int.test.ts:75`, **and
  `tests/eval/pipeline.ts:585-597`**, an object literal passed straight to
  `bakeForExport` that names no `Bakers` type, so a search for the type's
  name misses it; tests are typechecked (`tsconfig.node.json` includes
  `tests/**/*`), so a required `graphic` fails it there.
  `tests/exportB2.test.ts:372` only reads the call's text, and the four
  renderer tests that mock `liveBakers: {}`
  (`tests/renderer/stripsRender.test.ts:38` and three more) need nothing.
- `tests/paper.test.ts:496-507`, `:722-725` and `tests/moment.test.ts:629`:
  their spelled-out guard pins become membership (§6.4).
- `tests/textAnimation.test.ts`, `tests/textPaint.test.ts`,
  `tests/captions.test.ts` (the `\fn` tags),
  `tests/integration/captions.int.test.ts` (its Windows notice with Noto
  present) and `tests/integration/assetscan.int.test.ts` (the two fonts
  listed on a pack root; its `toHaveLength(3)` for fonts becomes
  membership; the catalogue's version): §6.20.
- `tests/eval/director.eval.test.ts`: the `FORGE_EVAL_GRAPHICS` block,
  copied from the look block (`:173-237`) (§6.10).
- `tests/uiCensus.test.ts` with `tests/fixtures/ui-census.json`: the census
  rows below.
- `tests/integration/sidecar.int.test.ts`: the self-test groups held equal
  to the helper's (`:155-178`) once `vision.handsModel` joins
  `SELFTEST_GROUPS.faces`, and the optional methods (phase 4, §6.18).
- `tests/integration/reframeJob.int.test.ts`: a hands ask and H12's stage
  clock with hands on the shared decode (the spike reads H12 by the
  worker's clock; phase 4 builds this case, §6.18).
- `tests/helperPackManifest.test.ts`, `tests/integration/helperPack.int.test.ts`
  and `tests/renderer/bridgeMethods.test.ts`: `vision.handsModel` in
  `expects` and the hand model's channels (phase 4, §6.18).
- `tests/directorAsk.test.ts`: the OpenAI retry's nudge (phase 2, §6.6).
- `tests/freeSpace.test.ts`: `samplesOver`'s cases (phase 2, §6.9).

#### The harness check — `window.__forgeGraphicCheck(options)`

In `src/renderer/src/harness/graphicCheck.ts`, installed by
`installGraphicCheck()` in `harness/main.tsx` after `installHelperPackCheck()`
(`:46`). Its measuring half is written in phase 0 to §6.15's spec (engine's
code), phase 1 adds the primitives, phase 2 the templates, phase 3 the
compositor (§6.16's code). It returns its numbers, the frames it drew (as
PNG data, and a contact sheet on the page), and `navigator.userAgent`, so a
result names the browser that made it. `GraphicCheckOptions`' keys are the
table's.

**Where it runs.** The harness "serves the renderer as an ordinary web
page" (`vite.harness.config.ts:7-13`), so its results belong to whichever
browser opened it. M3 and M22 depend on Electron 44's Chromium, ICU and
HarfBuzz, and M13 and M19 bake through the app's own writer
(`writeTitleFrame`, `src/main/titles.ts:143-150`), which the harness bridge
does not have. So the check is also installed in the development app's own
renderer, behind `import.meta.env.DEV` with a dynamic import so no
production bundle carries it (`src/renderer/src/main.tsx`, which installs
only the fallback bridge today, `:8`), and every run below is made in
`npm run dev`'s DevTools console where it can be; the harness page is the
fallback for the timings, with its user agent recorded. Neither Electron nor
the harness's localhost can be reached from the development sandbox, so
every run is yours.

| option | phase | does | measurement or bar |
|---|---|---|---|
| `encode: { frames, region, pool }` and `encode: { frames, workers }` | 0 | §6.15's synthetic graphic, 120 frames, encoded per region and pool depth through `encodeFrames`, and in 1, 2 and 4 module workers | M1, M2 |
| `segments: true` | 0 | segments and paints the Indic words cluster by cluster | M3 |
| `blur: { words, px }` | 0 | a ten-word blur-rise line at 1080×1920 | M5 |
| `parity: true` | 0 (Indic and colour, raw three.js), 3 (whole, through `paintDrawList3d`, and each 2.5D variant's settled frame against its flat twin) | painter output through a `CanvasTexture` against the canvas | M6 |
| `glow: ['unreal', 'quad', 'pmndrs']` | 3, first, through the compositor's glow seam with both routes built behind it (`'unreal'` and `'quad'`; `'pmndrs'` only from a scratch branch, §6.15); moved from phase 0 on 2026-10-21 | alpha outside a glowing shape | M7 |
| `indic: true` | 0 (bare `drawTextOnto`), 1 (through a text item and `paintDrawList2d`, and through a text clip's and a caption's own bake in a Latin face, so the `INDIC_FONTS` loading at those sites, §6.20, is seen in the frames), 2 (with `templates`) | the Indic render check below | M22; phases 1 and 2's Indic bars |
| `primitives: true` | 1 | `PRIMITIVES_SPEC` through the drawer seam (§6.3), its drawer returning hand-built lists (a cubic stroke with an end head at `to` 0, 0.5 and 1; a text entrance in Latin and in the EFFECTS §51 clusters at progress 0, 0.5 and 1; a dim with a hard and a 24 px feathered hole; a rotated, scaled group) through the preview path and through `encodeFrames`, each PNG decoded (`createImageBitmap` with `premultiplyAlpha` and `colorSpaceConversion` `'none'`): per case the mean and largest difference against the preview canvas, the last moving frame against the held end, alpha outside `graphicBox`, the same list drawn twice, and 1080×1920 draw and encode times | phase 1's exit; M13's first half |
| `pathLength: true` | 1 | `SVGPathElement` length and points against `flattenPath` | M8 |
| `strokes: { widths: [1, 2, 3] }` | 1 | stroke PNGs through the app's bake, for M19's overlay | M19 |
| `templates: GraphicTemplateId[]` | 2 (and step 6, §9) | per shape, from `specs.json`: frames 0, a beat, the last moving frame and the end differ as they should; the last moving frame equals the held end (mean 0); alpha 0 outside the box; the same spec twice identical; preview against baked PNG ≤ 1/255; draw and encode timed | phase 2's exit |
| `curves: { names: CurveName[]; clipId: string }` | 2 | the named graphic clip of the open project (a counter, then a keyword and a callout, §6.10) under each named curve, lettered and shown blind; the key in the result | M14 |
| `look: { clipIds: string[] }` | 2 | each named graphic clip under four presets and `clean` with the dim, lettered and shown blind; the key in the result (§6.10) | the look rating |
| `strokes: ['freehand']` | 2, from a scratch branch with perfect-freehand added there and never merged, imported by a DEV-only dynamic `import()` (§6.15) | perfect-freehand's draw-on, both ways; the `rough` half is not run in step 3 (§16.60) | M10 |
| `readback: […], frames` | 3 | the three readbacks timed | M12 |
| `screenCard: '<path>'` | 3 | Tilt in and Pull back at 9:16, at rest and moving; the bake cost of the moving frames and of the one-loop edge sweep; the hand-off (§6.16) | M20 |

#### The Indic render check

Run in the app's own renderer on the Mac and the Surface; CI cannot run it,
since painting needs a DOM canvas and CI's canvas checks stand the glyphs in
(EFFECTS §60, "The stand-in against the real painter"). **Phase 0** runs it
on `drawTextOnto` alone (M22). **Phase 1** runs it again through a draw
list's text item and `paintDrawList2d` (expected equal to `drawTextOnto`
directly: one function, one spec), after §6.20's fonts are in (§16.63).
**Phase 2** runs it over every template's Hindi and Telugu fixture.
**Phase 3** runs it through a `CanvasTexture` at 1:1 (M6, 0.000).

- **Media**: the EFFECTS §51 clusters (क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త), each
  drawn whole, and again one code point at a time (`Array.from`, standing in
  for libass's `shaping=simple`), at 1080 wide in the style's own size.
- **Reading**, per cluster: each conjunct's `measureText` advance narrower
  than the sum of its code points' advances; the whole-drawn frame differs
  from the per-code-point frame by more than 1/255 mean over the cluster's
  ink box (proposal); for कि, whose i-matra goes before its consonant, the
  two frames differ in the order of their ink (the i-matra's ink left of the
  consonant's in the whole drawing). The whole-drawn sheet is set beside
  `graphic.int`'s libass sheets (`tests/output/graphic/indic-libass/`) and
  judged by your eye: a loose virama or an i-matra after its consonant is a
  fail. The font each cluster resolved to is recorded (§6.15, M22).
- **Tolerance**: the numeric parts exact as stated; the eye check pass or
  fail.
- **Mutation**, run once by you on the Mac: the painter made to draw per
  code point (an `Array.from` split in `paintDrawList2d`) must fail it, every
  conjunct's frame then equal to its per-code-point frame.

#### The render check — `tests/integration/graphic.int.test.ts`

Into `tests/output/graphic/`, the pattern of
`tests/integration/moment.int.test.ts` (its fake drawer `:42-71`, its cases
`:138-205`). Every case decodes every frame in order and samples a frame at
`(f − 0.25)/fps`, which lands on frame f (EFFECTS §34). A pixel matches a
colour within 5 levels per channel (`toBeLessThan(6)`), as `moment.int`
reads H.264 (`:171-174`). It runs in CI on both runners, where the library
is absent (only §6.20's two Noto faces and their licences are tracked under
`assets/`): nothing in it may need the library's fonts or sounds.

- **The fake `Bakers.graphic`**: for moving frame i it writes a PNG whose
  place rect (`place.box`, or for `place.auto` the third's content rect of
  §6.2's layout), scaled to the export's size, is filled with grey 20 +
  15·(i mod 12) and is transparent outside (it draws no list, so it needs
  no drawer and no `graphicBox`), except on an arrival frame (a frame that
  `beatFrame` gives for one of `spec.beats`), which it fills white. Greys 15 apart, so a frame off by one reads
  as another grey; mod 12, so a frame names itself within a short window.
  It writes the moving frames only, as the app's bake does.
- **Phase 0**: the libass reference (above).
- **Phase 1** (§6.3): a red 9:16 shot, 360×640 at 30 fps, on V1; a graphic
  clip on V2 whose spec has `place: { auto: false, box }` and beats at 0.5 s
  and 1.0 s into the clip (set in the spec: beats from words are phase 2's).
  `bakeForExport` at 9:16 and at a 16:9 export (640×360), then
  `buildRenderPlan`, then the bundled ffmpeg. Read: the frame before the clip
  is red; each moving frame i shows grey(i) inside the box; each arrival
  frame is white and the frame before it is not; after the last moving frame
  its grey holds to the start of the exit; over the exit's frames the box
  falls monotonically to red, and the frame after the clip is red; outside
  the box the red shot shows on every frame; the box sits where the spec put
  it at both shapes. The note counts the PNGs written, which must equal
  `graphicMovingFrames`. **(box) If M1 picks the box bake**: the grey's
  first and last columns and rows are within 1 px of the box's edges at
  both shapes (luma only, as 4:2:0 smears chroma), and the same graphic
  exported by the box route and by the canvas route is `framemd5`-equal
  (alpha 0 outside the box leaves the base untouched, and even edges keep
  the chroma blocks aligned; proposal). Mutations: the export baking at the
  project's shape (the 16:9 box is wrong); a null bake left on the edit's
  asset (the export must not fail; the clip is dropped with a note); the
  hold baked (the PNG count equals the clip's frames); (box) an odd x (an
  edge one pixel off; the two routes differ).
- **Phase 2** (§6.2, §6.8, §6.9, §6.14): a transcript whose words land on
  known frames; a `counter` (one beat) and a `steps` with a tree (three
  items, three beats), made as hand-built `KeptGraphic`s through
  `applyGraphics` on the fixture project (no model, no settle), under
  `clean` (dim off), at 9:16 and 16:9, with a subject track written by
  hand (as `captionsFree.int` writes its own) that puts the face in the
  middle third and captions at the bottom. Read: **the frame of each beat's
  word is white, and the frame before is not**; the box's centre sits in
  the third §6.9 chose (hand-derived, as `captionsFree.int`'s `EXPECTED`); a
  no-track case keeps the style's third. A sound case: `graphicSounds`
  places a stand-in tick on the counter's beat: a 20 ms 1 kHz tone the
  test makes (CI has no library), handed in as a one-entry `SoundPack`
  whose `SoundFile` is `{ id, name: 'clock_tick.wav', file: <the tone>,
  role: 'tick', seconds: 0.02, peakSeconds: 0, peakDb: −10 }`, so its peak
  is its onset; the export's audio has its onset within 1 ms of that
  frame's time. Mutations: beats one frame late;
  placement ignoring the caption's third; the tick placed at the clip's
  start instead of its beat; the two earlier phases' mutations still killed.
- **Phase 3** (§6.16), the screen card's hand-off through the real plan: a
  3 s recording whose every frame is its own grey, a red track beneath, a
  stand-in card baker that writes the card's moving frames (a grey card in
  the box up to `L`, then a bezel ring with a hole). Read: the PNG count
  equals the card's moving frames, not the clip's; before `L` the box shows
  the card's grey and the red round it; from `L + 1` the box shows the
  recording's own grey for that frame, changing frame to frame, and the
  bezel round it; a null bake leaves the recording visible from its first
  frame. Mutations: the hold baked frame by frame (the PNG count, and the
  box's grey frozen at `L`); the opacity key one frame late (frame `L + 1`'s
  box shows red); the keys left on a dropped card (the box red for the
  move).
- **Phase 4, the hand render check** (§6.18): a 640×360 source with a white
  6×6 "fingertip" moved along a known path (an `overlay` of a `color` source
  at x and y expressions of `t`), a `Project.hands` `HandTrack` written by
  hand whose `PointEvent.tip` follows the same path, a followed 9:16 crop;
  the stand-in baker draws a 4×4 magenta square at `targets.tip` (the
  line's end) through `targetsAt` on each frame. Read: on every frame of the
  event the magenta square's centre is within 2 px of the white dot's centre
  in the export, on both builds; where the tip leaves the crop no square is
  drawn. Mutations: the tip mapped through the fit but not the crop; the
  tip taken once at onset.

#### Census rows

The Transcript tile's "Graphics", "Find graphics in this clip", "Keep",
"Drop", "check the number" (one per transcript source: a stub YouTube ASR
track, a YouTube uploader track, an unsure Whisper word), "Clear graphics"
and "Speaker"; the dock's graphic panel (`components/GraphicPanel.tsx`) and
its "Role"; the OUTPUT strip's "Graphics" section with its seven style
tiles ("Clean", "Bold", "Editorial", "Neon", "Mono", "Accent",
"Energetic"), "Accent colour" and "Graphic sounds" (§6.5, §6.14); phase 3's
"Screen card" with "Tilt in" and "Pull back", and the dock's "Depth" choice
(§6.16); phase 4's pointing switch, `POINTING_SWITCH` ("Callouts follow a
point", proposal), with "needs the AI helper", "the AI helper is starting",
"needs the hand finder", "Get the hand finder · 7.8 MB", "Get the hand and
face finders · 8.9 MB" and "Finding where they point" (§6.18). The exact
text is each owning section's.

### 6.12 Exit — by phase

Each bar below is measurable and says who reads it. Every phase also ends as
every step does (§2): typecheck green; the full suite green, its output
written to a file and `$?` checked; the phase's mutations (§6.11's index)
killed; the render check's output in `tests/output/graphic/` looked at; CI
read on both runners at github.com/spyki-a/forge/actions (annotations by the
full sha); `WHERE-THINGS-ARE.md` and the census updated for every new
control.

**Phase 0.** Read by the phase's recorder, from your console output and CI's
annotations.

- Every measurement phase 0 owns (M1, M2, M3, M4, M5, M6's Indic and colour
  parts, M22) is in `EFFECTS.md` §61 with its command, machine (the Mac,
  the Surface, or the CI run's id), date and user agent. M21 is there before
  phase 2's counter is built.
- §6.15's "as measured" note records, and phase 1 starts from: the bake
  region and pool depth (M1, M2); whether any Indic entrance may go below a
  word, as `CLUSTER_SCRIPTS` (M3); whether `blur-rise` is offered (M5);
  M22's verdict on the canvas painter's Indic shaping, with the fallback
  font each machine resolved. (The glow route, M7, is chosen at phase 3's
  start, §6.15.)
- M4's three probes printed by both runners. A filter missing on the Windows
  build is struck from §13's later options, not worked around.
- If M22 finds a cluster unshaped, its cause is found before any phase-1
  commit that draws text; the rename, the guards, the motion module and the
  stroke may land meanwhile (§6.15's M22 row, the one statement of it).
- If M6's Indic part is not 0.000, or no colour setting gives 2/255, phase 3
  is flagged now; phases 1 and 2 do not wait on it.

**Phase 1.**

- `graphicGuards` green, each site mutation-checked (the suite).
- In the development app's console on the Mac and the Surface (yours):
  `primitives` gives preview against the baked PNG within 1/255 mean for a
  stroke at p = 0, 0.5 and 1, a text entrance and a dim; the last moving
  frame equal to the held end (mean 0); alpha 0 outside the box (maximum 0);
  the same spec twice identical. M8's agreement and M19's minimum width
  recorded; M13's first half (the primitives' spec baked twice,
  `framemd5`-equal; the Mac against the Surface recorded).
- **The Indic render check** (§6.11), through `paintDrawList2d`, after
  §6.20's fonts are named first, on the Mac and the Surface; mutation-checked
  once (a per-code-point painter fails it).
- `graphicPaint`: no Hindi or Telugu string drawn in pieces smaller than a
  word (or a cluster, where M3 allowed it), mutation-checked by `Array.from`.
- `graphicMotion`: the closed-form spring within M9's tolerance of the
  reference; M9's figures in §61.
- `graphic.int`'s phase-1 cases frame-exact at 9:16 and 16:9 on both builds
  (CI).

**Phase 2.** §6.12 as written on 2026-10-05, for all nine shapes (§6.2):

- the property test green and mutation-checked, over the draw list's text
  items with the painter pinned to them, with the adversarial generators:
  **zero ungrounded, mispaired or de-negated graphics can ship** (the
  suite);
- every number heard from a YouTube track or an unsure Whisper word waits
  for Keep (census rows present);
- one local configuration: a truth hit (±1 sentence) on ≥ 6 of 10 fixtures;
  the drop rate recorded; template fit ≥ 3/5 on ≥ 8 of 10, blind (the eval,
  your ratings);
- the render check frame-exact at both shapes, on both builds (CI);
- the harness's preview = export ≤ 1/255 for all nine shapes (yours, Mac and
  Surface).

And, from the research:

- M14 run on your clips and its winner made each template's default curve;
- the blind look rating run (§6.10), its medians and answers in EFFECTS
  §61, and the presets, `DURATIONS` and the restrained presets' `dim`
  revised by it where it says so;
- M18's levels recorded, with speech intelligible to you under every graphic
  sound;
- `graphicBudget`'s no-overlap property green over every fixture (no two
  graphics overlap in time, none sits over a zoom punch), mutation-checked;
- M16's reading holds met by every template's longest fixture label.

Three additions to the bar as written:

- **the Indic render check over every template's Hindi and Telugu fixture**,
  on the Mac and the Surface, mutation-checked the same way;
- **the sound Clear test** (`graphicSound`), its three cases,
  mutation-checked: with graphic sounds tagged `SOUND_RULE`, the first case
  fails;
- **the tree** (`graphicTree`): the computed parent lists equal the expected
  ones on the three English nested-enumeration fixtures, and the property
  (every parent backwards, one root) is mutation-checked by allowing a
  forward parent. **This narrows the research's bar** (its §7.3: exact
  parent lists "on the nested-enumeration fixtures", with no language
  limit): v1's sub-count rule has an English cue list only, as §16.11 has
  English number words only, so the Hindi and Telugu fixtures are scored
  and recorded, not passed (§6.2, §6.10).

Also before phase 2 is called done: §15 rows 10 and 11 measured (the eval's
first run answers LM Studio's `minItems: 0`; the Telugu fixtures answer the
negative endings); M15 and M17 recorded, and `GRAPHICS_PER_MINUTE` set from
M17 or left null with the reason; `LLM.md` §Built records `graphics@1`.

**The spike's gate** (§16.56; the spike is §6.17). Read from `EFFECTS.md`
§62, which holds H1-H10, H12 and H13 with their commands, machines and
dates. Measured in three conditions **separately**: bare hands in daylight;
hennaed hands (with bangles and rings); low light or motion blur. It passes
when all of these hold:

1. **It runs**: H1 on the M1 Pro and on the Surface (`ready`, then a whole
   raw track from a real clip); CI's bare interpreter answers degraded,
   never crashes.
2. **Per condition, on the M1 Pro** (H4, H7): at least **8 of 10** marked
   points found, and at most **one false event a minute** over at least
   three minutes of natural gesturing with no point, with §6.18's rules and
   dwell. A marked point is found when an event in its shot starts within
   0.5 s of the marked onset (proposal).
3. **The Surface agrees**: the bare-hands condition repeated there meets the
   same bar.

Recorded beside it, not gated: H9's share of points inside a 9:16 crop;
H2's cost; H8's onset error; H10's handedness; H12's shared decode.

The three outcomes (D3's "if hennaed hands or low light fail, pointing ships
off by default on wedding footage with a note, or the work stops at the
spike", made exact):

- **Pass**: phase 4 is built (6 days, §6.18), the switch off per clip by
  default, every pointed graphic a proposal you keep.
- **Partial**: conditions 1 and 3 hold and bare hands pass, but hennaed
  hands or low light fails. Pointing is already off per clip by default;
  whether to build phase 4 with the switch carrying the measured limits
  ("points on hennaed hands or in low light are often missed", with the
  figures) or to stop is put to you as a new decision (the next free §16
  number) with §62's figures. Recommendation: build if one of the two fails, stop if
  both do: weddings are the first niche, and a feature that misses both
  would miss most of their footage.
- **Fail**: condition 1 or 3 fails, or bare hands fail on the M1 Pro: the
  work stops at the spike and phase 4's 6 days are not spent. What the
  spike leaves behind is §6.17's.

**Phase 3.**

- M6 whole, through `paintDrawList3d`: flat colour through the compositor
  within 2/255 of painter A; the EFFECTS §51 clusters through a
  `CanvasTexture` at 1:1 at 0.000; a 1 px anti-aliased line at 10, 50 and
  90 % alpha within 2/255 over black and over white (yours, Mac and
  Surface).
- Preview = export within 1/255 for the 2.5D `counter` and `ring` at rest and
  on three moving frames, and for the screen card's moving frames; each
  variant's settled frame equal to its flat twin.
- The same spec baked twice, `framemd5`-equal (M13, on a 2.5D counter and a
  screen card); the Mac against the Surface recorded in §61 as the golden
  tolerance (no CI check compares pixels across machines).
- M7 run first, on the compositor's glow seam on both machines: the route
  that passes kept, the other removed; the glow's alpha 0 outside its shape
  on that route; the hero rule's glow and tilt drawn (§6.16).
- Disposal: after a 2.5D bake and the clip's removal, the shared renderer's
  `info.memory` geometries and textures back to their counts before the bake
  (harness; proposal).
- With WebGL missing, the flat graphic drawn with the note
  (`graphicCompositor`).
- The screen card legible at 9:16 by your eye; its hand-off within 2/255
  mean on both machines (proposal); its bake cost, the sweep's and the
  readbacks (M20, M12) in §61.
- `graphic.int`'s phase-3 case on both builds; §9 reads 5 days.

**Phase 4** (only if the gate passed, or on a partial with your yes).

- The gate's figures measured again on **held-out clips** (§6.17's two per
  condition, none used to tune `DEFAULT_POINT_RULES`), on the M1 Pro, each
  condition the gate passed meeting the gate's bars.
- **The hand render check**: `graphic.int`'s phase-4 case within 2 px through
  the crop on every frame of the event (CI, both builds); and in the
  development app, on the held-out clips' marked frames, the real painter's
  callout line ending on the marked fingertip within 2 % of the frame's
  short side (the dead zone, proposal; yours; H4's tip error, in palm-size
  units, says whether it is reachable).
- `handsEvents`: an event never crosses a shot, and a re-analysis never
  moves a placed graphic, both mutation-checked.
- The switch off per clip by default; a pointed graphic a proposal until
  Keep (census rows).
- The face track unchanged by pointing (`hands.int`, byte for byte).
- `vision.handsModel` in `SELFTEST_GROUPS.faces` and the pack's `expects`
  (`packManifest.ts:314-324`, `:628`); `sidecar.int`'s groups held equal;
  `helperPack.int` green with it on both runners; H13's pin in
  `capabilities/faces.py` beside `MODEL_URL` (`:67-82`).

### 6.13 The motion module — `src/shared/graphics/motion.ts`

**Phase 1 · 1 day.** D9, §16.62: "One module, `graphics/motion.ts`, above
the graphic style, read by graphics first; captions and zoom punches migrate
after phase 2's ratings." Every template reads its curves and durations
from here; the model never picks a curve, a duration or a sound (the
research, §4.5).

**The curves** (`CurveName` = `'expo-out' | 'decelerate' | 'accelerate' |
'standard' | 'out-cubic' | 'out-back' | 'linear' | 'carbon-expressive'`;
`curve(name: CurveName): (x: number) => number`, exact at 0 and 1 for every
name):

| name | definition | use | source |
|---|---|---|---|
| `expo-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | the default entrance and a counter's arrival until M14 | the research's §1.4, [17]; the Bézier form, because it ends exactly at 1 where 1 − 2^(−10x) ends at 0.999; the two differ by under 0.01 at 10-50 % |
| `decelerate` | `(0.05, 0.7, 0.1, 1.0)` | an alternative entrance | Material's emphasized decelerate, [23] |
| `accelerate` | `(0.3, 0, 0.8, 0.15)` | exits | Material's emphasized accelerate, [23] |
| `standard` | `(0.2, 0, 0, 1)` | moves within the frame | [23] |
| `out-cubic` | 1 − (1 − x)³ | kept: it is the captions' `easeOut` (`textAnimation.ts:62`) | — |
| `out-back` | c1 = 1.70158 | the `pop` entrance only, in the energetic style | [25]; the captions' `backOut` uses 1.7 (`textAnimation.ts:72`), 10.0 % overshoot at 58 % of the duration either way (the research, §1.4) |
| `linear` | x | loops only: beams, marching dashes, sweeps | [27] |
| `carbon-expressive` | `(0, 0, 0.3, 1)` | compared in M14 (chosen 2026-10-21) | IBM Carbon's expressive entrance, [26] |

`MotionEase` = `CurveName | 'spring1'` (named so beside the keys' own `Ease`,
`render/keyframes.ts:62`; §6.5). **`spring1`** is the critically damped
response as a curve of fixed length: 1 − (1 + kx) e^(−kx) with k = 9.23, so
the residual at x = 1 is 0.1 % (computed), divided by its value at 1 so it
ends exactly there, spreading the residual over the move rather than leaving
a jump on the last frame. It is a curve that ends on the beat, not a spring
used as the clock of an arrival, which the research rejects (its §7.5).

**`cubicBezier(x1, y1, x2, y2): (x: number) => number`** solves x for the
curve parameter by Newton-Raphson (8 steps) with a bisection fallback and
returns y, exact at the ends: about twenty lines, written here rather than
taken as a dependency (`bezier-easing` "not needed", the research, §4.9).

**`spring(t: number, p: SpringParams, from?: number, to?: number, v0?:
number): { x: number; v: number }`** returns position and velocity in
closed form for the under-, critically and over-damped cases, from
`SpringParams` = `{ zeta: number; omega: number }` (ω in radians a second),
as Motion's generator evaluates position and velocity at any t (the
research, §4.6, [32]). Written here from the damped oscillator's solution; a
line copied from `motion-dom` keeps its MIT notice. **Every spring is a pure
function of t**: never stateful integration, never the clock of an arrival
on a word. It serves settles that need velocity continuity, a content swap's
entering element for one (the research, §4.4).

**`progress(t: number, start: number, seconds: number, ease: MotionEase):
number`** = the ease of `clamp((t − start + 1e-6) / seconds, 0, 1)`: a
1e-6 s allowance, larger than the 1e-6 of a frame `beatFrame` subtracts
(§6.3), so a frame whose time is a hair before the beat, which `beatFrame`
may name, still reads exactly 1 and not 0.99999. A template that must arrive on a beat starts its curve at `beat −
seconds`, so progress is 1 on `beatFrame` and below 1 the frame before.
**`entrance(name, p): { dy; scale; opacity; blur }`** turns an entrance name
and a progress into its four values (dy and blur as fractions of the text's
pixel size), the one place the entrances of §6.5 are defined.

**`DURATIONS`** (proposals from the research's §1.4; the look rating
revises them, §6.10):

| key | seconds | range read |
|---|---|---|
| `entrance` | 0.35 | 0.3-0.4 |
| `exit` | 0.2 | about 0.12-0.3 |
| `swap` | 0.12 | the old element's exit in a content swap |
| `dim` | 0.5 | 0.3-0.7 (Carbon's background dim, 700 ms) |
| `stroke` | 0.45 | 0.35-0.6 for a draw-on |
| `headGrow` | 0.1 | the riding head's scale-in |
| `loop` | 5.5 | 5-6, linear |

The clip's own 0.3 s fade is not here: it is `EXIT_S`, drawn by the keys
(§6.3).

**Measurements.** M9 (node, below). M14 (phase 2, §6.10): one counter
landing on its word under `expo-out`, `out-cubic`, `spring1`, `linear`,
`decelerate` and `carbon-expressive`, then a keyword and a callout, shown
blind to you; the overall pick becomes `clean`'s and the restrained presets'
`motion.ease`, and a template whose own pick differs records it as its
default in §6.2.

**Tests**, `tests/graphicMotion.test.ts`: every `CurveName` is 0 at 0 and
exactly 1 at 1; every curve but `out-back` is monotone over 1,000 points,
and no curve but `out-back` passes 1; `expo-out` and `decelerate` match the
research's table at 10, 20, 30 and 50 % within 0.01; `cubicBezier` matches
a bisection reference within 1e-6 at 101 points; `out-cubic` equals 1 − (1
− x)³ at 64 points; `out-back` overshoots 10.0 % at 58 %; `spring1` ends
exactly at 1 with no overshoot; the closed-form spring at ζ = 1 never
overshoots and at ζ = 0.5 overshoots about 16 % (computed, the research's
§1.4); **M9**: the closed form (ζ = 1, and one under- and one over-damped
case) against a semi-implicit Euler integration with 1,000 substeps a frame,
sampled on each frame at 24, 25, 30 and 60 fps, the largest difference under
10⁻⁴ of the travel (proposal), and the closed form's cost per call, both
printed for `EFFECTS.md` §61; the spring at a time depends on the time only
(0.2 s at 30 and at 60 fps equal, bit for bit) and two calls at one time are
equal (no state); `progress` is 0 before its start, 1 from its end on, and
exactly 1 on the frame its beat names, at 24, 25, 30 and 60 fps with beats
on and between frames (`beatFrame`'s own cases). Mutations: `expo-out` as 1 − 2^(−10x)
with no end fix (0.99902 at 1); the Bézier evaluated at t = x without
solving, or solved on the wrong axis (the table fails); the critically
damped case through the under-damped formula (NaN at ζ = 1); the
under-damped branch's sine term with the wrong sign (M9 fails); the spring
stepped by frame number instead of seconds (30 and 60 fps disagree); a
spring that keeps state between calls; `spring1` not normalised (it ends at
0.999); `progress` unclamped; `progress` without the 1e-6 (a beat a hair
after a frame's time reads 0.99999 on the frame `beatFrame` names).

**Later, not in step 3's days**: the captions' `easeOut` and `backOut`
(`textAnimation.ts:62`, `:72`) and the zoom punches move onto this module
after phase 2's ratings (M14's pick and the look rating, §6.10), as their
own change (D9).

### 6.14 Sound on the beats, under each graphic's own Clear

**Phase 2 · 1.5 days.** D6 (§16.59), answered as recommended: graphics get
sound, from the library's own sounds, capped per clip, off per project if
wanted, levels from M18. **Each sound carries its graphic's Clear rule,
never the Director's `SOUND_RULE`**, so each Clear removes exactly its own
graphics' sounds. This adds to §6; §16.10 itself is unchanged. The app
places every sound; the model never picks one (§6.6).

**The sounds.** `src/shared/graphics/sound.ts`: `graphicSounds(project,
clip, spec, rule, pack: SoundPack): { clips: Clip[]; assets: MediaAsset[] }`.
It reads the library through `soundPackFor` (`director/soundRoles.ts:89`),
and picks **by file name, not by role** (corrected 2026-10-21 by the
review): `SOUND_ROLES` has two `tick` files, `clock_tick.wav` and
`heartbeat_pulse.wav` (0.6 s, peak at 0.255 s, `soundRoles.ts:46-47`), and
`pickSound`'s pattern sorts a role's files longest first and indexes into
them (`sound.ts:75-80`), so a role-based pick would land a heartbeat on the
first graphic and on every other one after it. So `GRAPHIC_SOUND_FILES` =
`{ tick: ['clock_tick.wav'], whoosh: ['fast_whoosh.wav', 'whoosh_fast.wav',
'sword_swish.wav', 'swoosh_heavy.wav'] }` in `graphics/sound.ts`, and the
pack is filtered to entries whose `name` is in the list (`SoundFile.name`,
`soundRoles.ts:70-77`):

| key | files (entries of `SOUND_ROLES`, `soundRoles.ts:35-67`) | used for |
|---|---|---|
| `tick` | `clock_tick.wav` (0.08 s, peak at 5 ms) | a landing: where something visibly stops or appears |
| `whoosh` | `fast_whoosh.wav`, `whoosh_fast.wav`, `sword_swish.wav`, `swoosh_heavy.wav` (0.26-0.65 s, peaks mid-file) | the fastest move of a stroke or an entrance |
| not used | `heartbeat_pulse.wav` (a `tick` by role, a pulse by ear); `riser_climax.wav`, the table's only `hit` (`:51`), a 1.1 s swell into a boom, far too heavy for a card | — |

**The "pop".** No `pop` role
exists, and the library's only hit is a boom, so the research's "pop" is
not a soft hit. The library does ship `pop_bubble.wav` and `ding_chime.wav`
(`assets/sfxx/`, listed locally on 2026-10-21); `PLAN.md` §6.2 sets them
aside as meme and UI sounds, "not for the Director" (`PLAN.md:1064`).

- **Phase 2's landing is a `tick`.**
- **`pop_bubble.wav` is a candidate for M18's listening.** If your ear picks
  it under speech, it joins `SOUND_ROLES` as a new role `'pop'`, measured by
  `scripts/measure-sfx.mjs` as every entry is, and the `energetic` style
  lands with it. That is your decision after M18, not taken here.

**Placement** follows the research's sound rules (its §1.4, [35]):

- **A landing sound** goes only where something visibly stops or appears.
  Its measured peak (`peakSeconds`) is placed on the beat frame, as
  `placeSounds` lines peaks up (`director/sound.ts:112-136`).
- **A whoosh's peak** goes on the fastest frame of its move: the frame where
  the curve's progress changes most, computed from §6.13's curve. Never on
  a held frame.
- **No repeats.** Within a key of `GRAPHIC_SOUND_FILES` the file varies by
  index, in the list's own order, so the same envelope does not repeat
  across edits (`pickSound`'s indexing, `sound.ts:75-80`, without its
  longest-first sort).
- **The cap.** Every sound is under `GRAPHIC_SOUND_CAP` per footage clip, in
  onset order.

**Restrained styles** (every preset but `energetic`, D5, §16.58) get at most
one sound per graphic; **`energetic`** adds a `tick` on every beat and a
`whoosh` on each stroke's or entrance's fastest frame:

| template | restrained |
|---|---|
| `counter`, `ring` | a `tick` on the arrival beat |
| `bars`, `steps` (any connector) | a `tick` on the first item's beat |
| `keyword` | a `tick` on its beat |
| `callout` | a `whoosh` on its stroke's fastest frame |
| `quote` | none: the speech is the graphic |
| `lower-third`, `screen-card` | none |

**The cap and the levels** are proposals until M18 and M17:

- **`GRAPHIC_SOUND_CAP = 3`** a footage clip. With at most one graphic per
  20 s, that is a sound on every graphic of a minute-long clip and on half
  of a two-minute one's.
- **`GRAPHIC_SOUND_DB`** (in `graphics/sound.ts`): `tick` −24, `whoosh` −26
  dBFS peak. A graphic's sound sits under speech, not over the music, so it
  is not `SOUND_LEVEL_DB`'s music-relative table
  (`render/soundLevels.ts:17-24`).
- **The gain** is `min(MAX_SOUND_GAIN, 10^((level − peakDb) ÷ 20))`: the
  file's lift to its level, capped at the fader's ceiling
  (`soundLevels.ts:35`), as `soundGain` (`:54`) computes it, without the
  music's fader.
- **M18** measures a tick and a whoosh (and `pop_bubble.wav`) under your
  speech with `ebur128`; your ear judges whether the speech stays
  intelligible. The levels and the cap move to what M18 records. Speech
  peaks on your clips are unmeasured.

**Each sound clip and its file carry the graphic's rule:**

- Every sound clip has `generatedBy: { rule, reason: '<role> on "<the
  field's text>" · <file>' }`, with `rule` being `GRAPHIC_RULE` or
  `CLIPS_GRAPHIC_RULE`, and `forGraphic: <the graphic clip's id>`
  (`Clip.forGraphic`, §6.1).
- A file the app brings is a `MediaAsset` with `broughtBy: rule`
  (`timeline.ts:93`), as the Director's sounds carry `SOUND_RULE`
  (`sound.ts:189`).
- A file already in the pool under the same path is reused, as
  `placeSounds` reuses one (`sound.ts:90`, `:171`). A file you imported
  carries no rule and stays on every Clear.
- **Direct's graphic sounds** go on the Director's "Sound design" lane
  (`SOUND_LANE_NAME`, `sound.ts:28`): an audio track marked `director`,
  free over the span, else a new one, by a lane finder written as
  `soundLaneFor` is (`director/apply2.ts:628-641`, a function inside the
  spine's apply, not an export, so written again here).
- **A Clip-it or Transcript-tile graphic's sounds** go on an ordinary audio
  track named "Graphic sounds", reused when free over the span, else added;
  never the Director's lane.

**What learns the rule.** In `clearDirector` (`director/apply.ts:112`), the
asset sweep is the `brought` set at `:125`, today `a.broughtBy ===
SOUND_RULE`. It becomes **any asset with a `broughtBy`**: `a.broughtBy !==
undefined`, a superset of learning `GRAPHIC_RULE`.

- **Why the superset.** `placeSounds` (`sound.ts:90`) and `graphicSounds`
  both reuse an audio asset by path whatever rule brought it. So a Director
  whoosh can stand on a file a Clip-it graphic brought. Keyed on two rules,
  Direct's Clear would leave that file in the pool after Clear graphics
  took the graphic.
- **Why it is safe.** Removal stays limited to assets of removed clips that
  no surviving clip uses (`:126-137`). An import of yours carries no
  `broughtBy`.
- **The other lines.** The drawn-asset filter at `:126-127` is §6.4's: it
  reads `drawsItself`, so it gains `graphic`. Direct's Clear removes
  `GRAPHIC_RULE` graphics, their sounds (their rule is in `DIRECTOR_RULES`)
  and their files; its return (`:133-138`) filters `graphicProposals` (§6.6).
- **`clearGraphics`** (`graphics/apply.ts`) mirrors it for
  `CLIPS_GRAPHIC_RULE`. It removes the rule's graphic clips and their sound
  clips, then every asset of those clips that is a drawn graphic asset, or
  has a `broughtBy`, and that no surviving clip uses.

**A graphic's sounds follow it:**

- `dropGraphic`, and `removeClip` on a graphic (`store.ts:1874`), take the
  clips whose `forGraphic` is its id, with their brought files when unused.
- `moveClip` (`store.ts:1879`) and `moveSelectionTo` (`:5173`) shift those
  clips by the graphic's own shift when they are not in the move
  themselves.
- `setGraphic` and `keepGraphic` re-place them.
- A pasted copy drops `forGraphic`: `pasteClipboard`'s `copy`
  (`edit/recipes.ts:281-295`) sets it `undefined`, so a pasted sound is an
  ordinary sound and Drop on the original never takes it.

**Off per project.** `Project.graphics.sound` (§6.1's `GraphicsSettings`,
`true` when absent) is the OUTPUT strip's **"Graphic sounds"** switch, beside
the style tiles (§6.5). `setGraphicSounds(false)` removes every clip with a
`forGraphic` and its brought files in one undo step; `true` places them
again for every graphic. With no sound library installed, or no file for a
role, graphics land silent with one note ("no sound library is installed —
graphics land silent"), as the Director's sound design does
(`sound.ts:93-95`).

**Tests** (§6.11 indexes them by phase):

- **`tests/graphicSound.test.ts`, the sound Clear test.** The research's
  three cases (its §7.3), each named: (1) Direct's Clear leaves a Clip-it
  graphic's sound clip and its file; (2) Clear graphics removes them; (3)
  Direct's Clear removes a Direct graphic's sound and its file. And: (4) the
  reused file: a Director whoosh on a file a Clip-it graphic brought; Clear
  graphics, then Direct's Clear, leaves no orphan in the pool; (5) a sound
  you imported, reused, survives both Clears; (6) Drop takes exactly its
  graphic's sounds; (7) a pasted sound loses `forGraphic`. Placement: each
  sound clip carries its graphic's rule and `forGraphic`; peaks on the beat
  frame; a whoosh on the fastest frame; restrained against energetic;
  `GRAPHIC_SOUND_CAP` per clip (a clip with more graphic beats than the cap
  keeps the first N sounds, a second clip its own N); a Clip-it graphic's
  sound on an ordinary audio track; with `Project.graphics.sound` false
  none is placed; with no library sound for a role none is placed, with the
  note.

  | mutation | the case it fails |
  |---|---|
  | graphic sounds tagged `SOUND_RULE` | case 1 |
  | `clearGraphics` leaving the sounds | case 2 |
  | the sweep left on `SOUND_RULE` alone | case 3 (its file stays) |
  | the sweep on `SOUND_RULE` and `GRAPHIC_RULE` only | case 4 |
  | Drop matching by time instead of `forGraphic`, or leaving the sound | case 6 |
  | the cap ignored, or counted per project | the cap cases |
  | the tick picked by role (`heartbeat_pulse.wav` lands on a beat) | the placement case over a pack holding both tick files |

- **`tests/renderer/graphicStore.test.ts`, phase 2's cases**: `removeClip`
  on a graphic takes its `forGraphic` sounds; `moveClip` and
  `moveSelectionTo` shift them by the graphic's own shift; a pasted copy has
  no `forGraphic`. Mutations: the remove arm dropped (the sound stays); the
  move arm dropped (the sound stays behind).

**Days: 1.5** (phase 2): `sound.ts`, `apply.ts`'s `clearGraphics` and the
sweep, the store's follow-on edits, the switch and the tests.

### 6.15 Phase 0 — Measure before relying: M1-M22 and H1-H13

**2 days**, mostly your runs. Its pieces, built in this order (§6.19):

| piece | what | days |
|---|---|---|
| 0.1 | M4's case in `tests/oldestFfmpeg.test.ts` (§6.11), committed and pushed first, so CI's two runners answer it while the rest is written | 0.25 |
| 0.2 | the measuring half of `harness/graphicCheck.ts`: `encode` (with `encodePool.ts`'s `encodeFrames`, §6.3, written here so M1 and M2 time the code that ships), `segments`, `blur`, `parity` (Indic and colour, one raw three.js rig: a canvas uploaded as a `CanvasTexture` under an orthographic quad and read back), `indic`; installed in the harness and, behind `import.meta.env.DEV`, in the development app (§6.11) | 1 |
| 0.3 | `graphic.int`'s libass reference and `asr.int`'s gated M21 case (§6.11) | 0.25 |
| 0.4 | your runs on the Mac and the Surface (your hours are §2's "Your part"); `EFFECTS.md` §61 opened; the verdicts recorded in this section's "as measured" note and the constants set | 0.5 |

**Changed 2026-10-21 by the review.** Piece 0.2 at 0.75 day could not carry
the encode pool, M3's segment painter, M5, M22's font detection, the three.js
parity rig and two glow routes. M7 (the glow) moves to phase 3's first day
(§6.16): it gates only phase 3, and phase 3's glow item builds both routes
behind one seam anyway, so the raw-three.js legs would have been written
twice. M6's colour part stays here, on the Indic part's own rig. Piece 0.2
becomes 1 day and 0.4, the recording, 0.5; phase 0 stays 2 days.

**The synthetic graphic** the timing measurements draw (M1, M2, M5), since no
template exists yet: on a transparent 1080×1920 canvas, a 900×420 rounded
panel at 0.85 opacity with two lines of type through `drawTextOnto` and a
6 px stroke drawing on, the whole rising 2 px a frame (proposal), so every
frame differs, most of the canvas is alpha 0, and the box is about a fifth of
the frame.

**Where results land.** Every M result goes into a new `EFFECTS.md` §61,
"Graphics: the forks measured"; every H result into §62, "Hands: the spike
measured". Each with its command, machine and date, as §54 and §56 record
theirs, and with the user agent the check returns. Electron does not start
in the development sandbox and the macOS MediaPipe wheel aborts there without
Metal (§1), so every run in Electron or MediaPipe is yours, on the Mac and
the Surface, unless the table says CI or node. **The command shapes are
proposals**: the hook, its options and the gated cases do not exist until
phase 0 writes them. The harness "serves the renderer as an ordinary web
page" (`vite.harness.config.ts:7-13`), so M3 and M22 run in the development
app's console, never the harness page (§6.11).

The rows are copied from the research's §4.10 and §5.10 on 2026-10-21. The
only changes: its section marks read "the research, §x", since a bare §4.2
in this file is step 1's; M16's line reference into this file reads §6.2
(the seconds column as written 2026-10-05). `[n]` marks are the research's
sources (its §8). These are §15's rows 39-60 (M1-M22) and 61-73 (H1-H13).
One reading of M22's row is changed in the doing, not in the row: the
libass frames its eye check sets beside the canvas are `graphic.int`'s
phase-0 reference sheets (§6.11), because `captions.int`'s Indic case
carries four of each script's five clusters and deletes its frames when it
ends.

| # | measurement | command shape | where | decides |
|---|---|---|---|---|
| M1 | PNG encode of a mostly transparent 1080×1920 graphic frame | `await window.__forgeGraphicCheck({ encode: { frames: 120, region: ['canvas', 'box'], pool: [1, 2, 4] } })`: 120 frames of a synthetic template, full canvas against its box, an encode pool of 1, 2 and 4 (the `captionBake.ts` pattern); ms per frame at p50 and p95, and bytes per frame | Mac, Surface | the bake region and pool depth |
| M2 | encode in workers, against the existing pool | `await window.__forgeGraphicCheck({ encode: { frames: 120, workers: [1, 2, 4] } })`: `OffscreenCanvas.convertToBlob({ type: 'image/png' })` in 1, 2 and 4 workers, against the four-deep `toBlob` pool whose encodes already run off the main thread (the research, §4.1), on the same frames; ms per frame at p50 and p95 | Mac, Surface | whether workers beat the `toBlob` pool |
| M3 | Indic segmentation and per-segment drawing | `await window.__forgeGraphicCheck({ segments: true })`: in Electron 44's renderer, `new Intl.Segmenter(undefined, { granularity: 'grapheme' })` over स्कूल, क्षत्रिय, स्त्री, తెలుగు, క్ష, స్త్ర and the EFFECTS §51 clusters; count the segments; paint them cumulatively with `fillText` and diff the last frame against the word drawn whole | Mac, Surface | whether any Indic entrance goes below a word |
| M4 | ffmpeg filters on both builds | `"$FFMPEG" -hide_banner -h filter=tmix`, `-h filter=overlay` (the `alpha` option) and `-h filter=perspective`, as a case in `tests/oldestFfmpeg.test.ts` so both runners print it | CI, both runners | motion blur by `tmix`; the raw RGBA path; the `perspective` screen card. Any filter used stays in `tests/oldestFfmpeg.test.ts` |
| M5 | canvas blur cost | `await window.__forgeGraphicCheck({ blur: { words: 10, px: 8 } })`: a ten-word blur-rise line with `ctx.filter = 'blur(8px)'` per word per frame, at 1080×1920; ms per frame | Mac, Surface | whether blur-rise is offered |
| M6 | three.js parity | `await window.__forgeGraphicCheck({ parity: true })`: the EFFECTS §51 clusters painted by `drawTextOnto`, uploaded as a `CanvasTexture` with mipmaps off under an orthographic camera at 1:1, against the canvas drawn flat (expect 0.000); brand hex squares and a 50% blend through three.js with colour management on and off, against canvas 2D (within 2/255); a 1 px anti-aliased line at 10, 50 and 90% alpha through WebGL, `drawImage` and PNG, over black and over white | Mac, Surface | phase 3's exit |
| M7 | glow with alpha | `await window.__forgeGraphicCheck({ glow: ['unreal', 'quad', 'pmndrs'] })`: a shape with `UnrealBloomPass` (r186) and with our own quad shader over a transparent clear: alpha outside the shape 0, the glow's alpha below 1; then pmndrs Bloom | Mac, Surface | the glow route |
| M8 | path length | `await window.__forgeGraphicCheck({ pathLength: true })`: an off-DOM `SVGPathElement`'s `getTotalLength()` and `getPointAtLength()` against our own flattening; agreement and ms | Mac | the stroke primitive |
| M9 | spring | `npx vitest run tests/graphicMotion.test.ts`: the closed form against frame-stepped at 24, 25, 30 and 60 fps; the largest difference and the cost per frame, printed | node | the motion module |
| M10 | stroke libraries | `await window.__forgeGraphicCheck({ strokes: ['rough', 'freehand'] })`: rough.js with one seed, its PNGs from the Mac and the Surface compared by mean difference; perfect-freehand drawn on by truncating its input points and by clipping the finished outline, whether the tapered end changes from frame to frame | Mac, Surface | the marker look |
| M11 | raw RGBA | `ffmpeg -f rawvideo -pix_fmt rgba -s 1080x1920 -r 30 -i pipe:0 -i base.mp4 -filter_complex "[1][0]overlay=alpha=premultiplied"` against the PNG path; `-f framemd5` of both; IPC throughput at 8.3 MB a frame | Mac, Surface | only if M1-M2 fall short |
| M12 | readback | `await window.__forgeGraphicCheck({ readback: ['drawImage', 'readPixels', 'readRenderTargetPixelsAsync'], frames: 120 })`: `drawImage(gl)` with `toBlob`, `readPixels` into a `Uint8Array`, and `readRenderTargetPixelsAsync`; ms at p50 and p95 | Mac, Surface | phase 3's bake |
| M13 | determinism | the same template baked twice through the app, then `"$FFMPEG" -start_number 0 -i <clipId>.seq/%05d.png -f framemd5 -` on each bake (equal), and the Mac's frames against the Surface's by mean difference | Mac, Surface | the golden tolerance |
| M14 | curves, blind | `await window.__forgeGraphicCheck({ curves: ['expo-out', 'out-cubic', 'spring1', 'linear', 'decelerate', 'carbon-expressive'] })` renders one counter landing on its word under each, on the user's clips at 30 fps; shown blind to the user, who picks | the user | the default curve per template |
| M15 | onset error | the user marks the audible onset frame of 30 words in 3dit's timeline on their own footage; a node script subtracts the transcript's `startMs` for each, in frames | the user's clips | whether beats need an onset refinement |
| M16 | reading holds | `npx vitest run tests/graphicHolds.test.ts`: each template's longest label at 20 characters a second [33] and twice at 200 words a minute [34], in English, Hindi and Telugu, against its seconds (§6.2) | node | the templates' seconds |
| M17 | density | graphics, zooms and sounds per minute, counted frame by frame by the user in five clips they call pro and five from a clipper | the user | the overall cap |
| M18 | sound levels | `"$FFMPEG" -i mix.wav -af ebur128 -f null -` for a tick, a pop and a whoosh under speech on the user's clips; intelligibility judged by the user's ear | Mac | sound levels |
| M19 | 4:2:0 fringing | `await window.__forgeGraphicCheck({ strokes: { widths: [1, 2, 3] } })` writes the PNGs; each is overlaid through the plan's `format=yuva420p` overlay, and its chroma bleed is measured against the PNG | Mac | the minimum stroke width |
| M20 | screen card | `await window.__forgeGraphicCheck({ screenCard: '<a 1080p screen recording>' })`: a tilted 2.5D card at 9:16; legibility at rest judged by the user, and the bake cost of its moving frames | Mac, Surface | the screen card's scope |
| M21 | Hindi numbers | `FORGE_MODELS_DIR=<models> npx vitest run tests/integration/asr.int.test.ts`, extended with the user's Hindi clips: how the installed faster-whisper writes numbers said in Hindi (Devanagari digits, ASCII digits or words) | the user's clips | sizes how many Hindi counters survive §16.11's drop of number words in v1; decides the counter's digit format |
| M22 | Indic shaping in the canvas painter | `await window.__forgeGraphicCheck({ indic: true })`: the EFFECTS §51 clusters (क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త) painted by `drawTextOnto` whole, and again one code point at a time (`Array.from`, standing in for libass's `shaping=simple`). Per cluster: the two frames must differ, as `captions.int` requires complex ≠ simple on all 54 frames of each script (EFFECTS.md:4737-4742), and each conjunct's `measureText` advance must be narrower than the sum of its code points'. Then the whole-drawn frames are set beside `captions.int`'s `shaping=complex` and `shaping=simple` frames of the same clusters and judged by eye (two renderers, so no pixel equality is expected), so a loose virama or an i-matra after its consonant is seen. Which fallback font resolved is recorded by comparing each cluster's width against the same cluster drawn in each candidate system font named explicitly | Mac, Surface | whether "text has to be canvas 2D" holds (the research, §4.2); phase 1's and phase 2's Indic exit bars (the research, §7.3); D10 |

**When each runs, who runs it, and what each outcome does.** Values marked
(proposal) are this plan's starting rules, revised by the measurement
itself when it shows them wrong.

| # | §15 row | phase; who, where | on each outcome |
|---|---|---|---|
| M1 | 39 | 0; you, the development app on the Mac and the Surface | `GRAPHIC_BAKE_REGION` is `'box'` when the box's p50 encode is at least 20 % under the canvas's on the Surface, the floor machine (proposal; the box costs §6.3's exact placement), else `'canvas'`. `GRAPHIC_POOL_DEPTH` is the depth fastest on the Surface. Bytes per frame give the disk a graphic costs. A whole-hold bake (a travelling beam, an edge sweep) is allowed once per clip only if 300 frames bake in under 10 s on the Surface at the chosen region and depth (proposal); otherwise those motions are not offered. If a 60 s clip's three graphics (90-270 moving frames, the research's §4.8 estimate) would take over 10 s on the Surface even so (proposal), M1-M2 "fall short" and M11 runs |
| M2 | 40 | 0; you, the development app | workers are taken only if their p50 beats the four-deep `toBlob` pool by 20 % or more on both machines (proposal); otherwise the bake keeps the pool and no `OffscreenCanvas` enters `src/`. A same-origin module worker file is needed (`src/renderer/src/harness/graphicEncodeWorker.ts`, proposal; moved beside `encodePool.ts` if taken): the renderer's CSP (`src/renderer/index.html:7-8`, `script-src 'self'`, no `worker-src`) admits no `blob:` worker (an inference from the policy; the run shows it) |
| M3 | 41 | 0; you, the development app only | a script enters `CLUSTER_SCRIPTS` only if, on both machines, the cumulative per-cluster paint's last frame equals the whole word's (mean 0 over the word's box, proposal) for every word listed, and the count shows the current rule (स्कूल two clusters, not three); otherwise that script animates per word (§16.61). Empty until then |
| M4 | 42 | 0; CI, both runners, through `ciNotice` | each filter found on both builds: §13 lists it "probed, not emitted". `tmix` missing on Windows: motion blur by `tmix` is struck (canvas subframes stay the only route). `alpha=premultiplied` missing: the raw RGBA path is struck. `perspective` missing: the screen card's ffmpeg alternative is struck (phase 3 uses painter B anyway). Never worked around |
| M5 | 43 | 0; you, the development app | `blur-rise` is offered when a ten-word blur-rise frame's p95 draw is no more than M1's p50 encode on the Surface, so blur at most doubles a frame's bake (proposal); otherwise `resolveGraphicStyle` maps it to `rise` (§6.5) |
| M6 | 44 | 0 for its Indic and colour parts; 3 whole; you, the development app | Indic through a texture at 0.000 and colour within 2/255 under one colour setting: that setting is phase 3's. Neither: phase 3 is flagged at phase 0's exit and re-planned before it starts; phases 1-2 go on. The 1 px line (phase 3): within 2/255 over black and white, or the compositor's alpha settings change until it is; it is phase 3's exit |
| M7 | 45 | 3, first, on the compositor's glow seam with both routes built behind it (§6.16; moved from phase 0 on 2026-10-21, above); you | `UnrealBloomPass` is the glow route if, on both machines, alpha outside the shape is 0 and the glow's alpha below 1; else the quad shader (§6.16's two passes). The route not taken is removed. The pmndrs leg is optional, run only from a scratch branch with the package added there and never merged; its result is recorded, and it stays out whatever it shows, because its peer range pins three below 0.187 (the research, §4.9) |
| M8 | 46 | 1; you, the Mac | `STROKE_TOLERANCE` is the coarsest at which total length agrees with `getTotalLength()` within 0.1 % and every sampled point within 0.5 px at 1080 wide (proposal); our flattening stays node-pure either way |
| M9 | 47 | 1; node, anywhere | `graphicMotion.test.ts` asserts the closed form within 1e-4 of the travel against its reference (§6.13) and prints the figures; a larger difference means the closed form is wrong, not the tolerance |
| M10 | 48 | 2, the perfect-freehand half only, from a scratch branch with perfect-freehand added there and never merged (as M7's pmndrs leg; the harness imports it by a DEV-only dynamic `import()`); you, Mac and Surface | only on a pass does a phase-2 commit add perfect-freehand to `main` with the marker painter and `MARKER_READY` (D7's order). `strokeLook: 'marker'` is offered (§16.60) only if one of the two draw-ons keeps the tapered end's shape from frame to frame behind the moving tip (mean 0 outside the last 5 % of length, proposal) and preview = export ≤ 1/255. The rough.js half is not run in step 3 (§16.60: "rough.js not now") |
| M11 | 49 | only if M1-M2 fall short; you | a raw RGBA path is then planned as its own change, outside step 3's days, using `overlay`'s `alpha=premultiplied` only if M4 found it on Windows |
| M12 | 50 | 3; you | the fastest readback at p50 on the Surface that keeps straight alpha through to the PNG is phase 3's bake; `drawImage` stays unless another is at least twice as fast (proposal, §6.16) |
| M13 | 51 | 1 (the primitives' spec), 3 (a 2.5D counter and a screen card); you | two bakes on one machine must be `framemd5`-equal, or the bake is not deterministic and the phase does not exit. The Mac-against-Surface mean difference is recorded as the golden tolerance; no CI check compares pixels across machines |
| M14 | 52 | 2; you, blind, on your clips, with `curves: { names, clipId }` (§6.10, §6.11; the key returned in the result for you to save) | run on a counter, then a keyword and a callout (§6.10); the overall pick becomes the restrained presets' `motion.ease` in `GRAPHIC_STYLES`, a template's own differing pick its default (§6.13). Until then `expo-out`. The look rating follows it (§6.10) |
| M15 | 53 | 2; you mark the onset frames into `tests/fixtures/graphics/onsets.json` (`{ assetId; marks: { word: number; frame: number }[] }`, proposal), and `scripts/measure-onsets.mjs` (proposal) reads it against the transcript's `startMs` | median error within one frame at 30 fps: beats as §6.8 writes them. More: an onset refinement is planned as its own change, outside step 3's days (proposal) |
| M16 | 54 | 2; node | a template whose seconds do not hold its longest fixture label gets its seconds raised in §6.2's table or its label capped, decided in phase 2 |
| M17 | 55 | 2; you count | `GRAPHICS_PER_MINUTE` = the median graphics per minute of the five clips you call pro, rounded down (proposal); null until counted. Zooms and sounds per minute are recorded beside it |
| M18 | 56 | 2; you, the Mac: `mix.wav` is the audio of an export of one of your clips with a graphic's sound on a beat, exported by the app with the sound on (`ffmpeg -i <export> -vn mix.wav`), one per sound | the row's "pop" is `pop_bubble.wav`, a candidate role (§6.14). Each role's level under speech is set where you judge speech intelligible; the integrated loudness and the momentary maximum are recorded; `GRAPHIC_SOUND_DB` and `GRAPHIC_SOUND_CAP` are revised with them |
| M19 | 57 | 1; you write the PNGs in the development app, then a node read | `STROKE_MIN_PX` is the smallest of 1, 2 and 3 px at 1080 wide whose centre line keeps U and V within 8 levels of the PNG's after the `format=yuva420p` overlay (proposal); the research's starting value is 2 px. The read is a gated case in `graphic.int` over the folder the bake wrote (`FORGE_GRAPHIC_FRAMES=<folder>`, proposal) |
| M20 | 58 | 3; you | legible at rest and its moving frames within M1's whole-hold budget: the card ships as §6.16 plans it. Legible but slow: tilt-in only, no pull-back. Not legible: the card is not offered, and a recording gets the dim and graphics only. The run also records the card's hand-off (frame `L` of the card against the export's frame `L` without the card), whose bar is 2/255 mean (proposal, §6.16) |
| M21 | 59 | 0, any time before phase 2's counter; you, with your Hindi clips | the counter's Hindi digits follow what the installed model writes (Devanagari or ASCII); the share written as words, which §16.11 drops in v1, is recorded beside it |
| M22 | 60 | 0; you, the development app on the Mac and the Surface | **Shaped on both** (every cluster's frames differ, every conjunct narrower, the eye agrees with the libass complex sheet): "text has to be canvas 2D" holds and phase 1 starts; §6.20's fonts still land before phase 1's Indic check, so both machines draw the same letters (§16.63). **A cluster unshaped, and the font that drew it lacks the script** (its width equals a missing-glyph box's, or no candidate font matches): §6.20's fonts move into phase 0, M22 runs again with them named first, and phase 1's text work starts when it passes. **Unshaped with a font that has the script**: the shaper is not running, so the research's choice of painter (its §4.2) reopens as a decision for you (the next free §16 number) before any graphic draws Indic text. While either cause is open, no phase-1 commit that draws text lands; the rename, the guards, the motion module and the stroke may (this sentence is the one statement of it; §6.3 and §6.12 point here). The font each cluster resolved to is found by drawing it in each installed candidate face named explicitly; a candidate counts as installed only if a Latin probe drawn in it differs from the same probe in a family that does not exist |

The hand spike's measurements. All but H11 are your runs (MediaPipe needs
Metal on the Mac; H13 downloads the model).

| # | measurement | command shape |
|---|---|---|
| H1 | does it run | `FORGE_HANDS_REAL=<clip> npx vitest run tests/integration/hands.int.test.ts` on the M1 Pro with Metal, after the same run in the sandbox confirms the −6 abort, as the face finder's did; then on the Surface, and the bare-interpreter case on CI's Windows runner |
| H2 | cost | the same test with spec `{"mode": "hands", "bench": true}` at `edge` 640 and 1080 and `fps` 5, 10, 15 and 30, for `hand_landmarker.task` and `gesture_recognizer.task`: ms per frame at p50 and p95, with palm-detector re-runs counted by per-frame time spikes; M1 Pro and Surface |
| H3 | recall against size | the test's track against frames a person marked (a JSON of frame, hand box): recall per band of hand width as a share of frame width |
| H4 | wedding hands, low light, blur | the same, on clips of henna, bangles and rings, a held microphone, phone or bouquet, **a low-light reception and a fast point with motion blur**, each against bare hands in daylight: recall and tip error in palm-size units |
| H5 | jitter and lag | a node script over the test's raw track (`npx vitest run tests/handsSmooth.test.ts` once the filter exists): tip jitter at rest in palm-size units, raw and after the 1€ filter (`min_cutoff` 1, `beta` 0); lag on a fast point, causal and forward-backward, against a hand-marked path |
| H6 | the canned class | the test with the gesture bundle on clips of a finger pointing sideways, down and at the camera: the label and score `Pointing_Up` returns |
| H7 | false and missed events | `pointEvents(raw, rules)` over the test's tracks: false events per minute on natural gesturing with no pointing; missed events on footage with marked points |
| H8 | onset | the same, at `fps` 5, 10 and 15: event onset against a human-marked onset frame, in frames |
| H9 | inside the crop | the events' tips mapped through `sourceToFrame` on the user's 16:9 talking-head projects with a 9:16 reframe: the share inside the frame |
| H10 | handedness | the label against the truth on unmirrored rear-camera or DSLR clips |
| H11 | size | `wc -c` of the raw cache track and of the reduced event list, per minute of footage |
| H12 | shared decode | the faces stage alone (EFFECTS §56's 9.29 s on the 4K fixture, 20.48 s on `j4aoo1qbGoE`) against faces and hands on one decode, and against two passes, by the job's own stage clock (`FORGE_REFRAME_REAL=<file> npx vitest run tests/integration/reframeJob.int.test.ts`) |
| H13 | pin | `shasum -a 256` (macOS) and `certutil -hashfile <file> SHA256` (Windows) over the bytes fetched from the versioned `float16/1` URL, and its length against the 7,819,105 B the HEAD gave [179] |

Notes beside the table: H7's `pointEvents` is called with the shots as well,
`pointEvents(raw, rules, shots)`, since "never across a cut" needs them; the
spike's raw track carries no shots, so `hands.int`'s real suite runs
`findShots` (`src/main/ffmpeg/shots.ts:73`) on the clip for H7 and H8. H9
is a gated case of the same file that reads a saved project you reframed to
9:16 (`FORGE_HANDS_PROJECT=<the project file> FORGE_HANDS_REAL=<its 16:9
clip> npx vitest run tests/integration/hands.int.test.ts`, proposal) and
maps each event's tip through `tipOnFrame` on that project's followed clip,
writing the share on screen to the README. H2's
spec mode `hands` is the worker's, in `workers/mp_faces.py`'s `parse_spec`
(`:155-213`), which today accepts only `detect` and `import`; the spike
drives the worker directly through its test (§6.17), and the app's RPC is
phase 4's (`vision.faces` gains an optional `hands` param; §6.18). All
but H11 are your runs on the M1 Pro (with Metal, after the sandbox's run
confirms the −6 abort as the face finder's did, EFFECTS §54) and the
Surface; H11 is phase 4's.

| # | §15 row | who, where, and the spike's run | decides | on each outcome |
|---|---|---|---|---|
| H1 | 61 | you: the sandbox's −6 first, then the M1 Pro (Metal) and the Surface, the real suite's `ready`, the mediapipe version and a whole raw track; CI's Windows runner, the stand-in suite's bare-interpreter case (`error import`, as the face worker's) | whether there is a spike at all | runs on both machines: the spike goes on. Fails on either: the gate fails (§6.12). CI's bare interpreter must answer degraded, never crash |
| H2 | 62 | you, M1 Pro and Surface: `bench: true` at `edge` 640 and 1080, `fps` 5, 10, 15 and 30, both detectors; palm-detector re-runs counted as per-sample time spikes | the analysis rate and edge | the cheapest `fps` and `edge` that keep H7 and H8 within the gate; the hand bundle against the gesture bundle's cost recorded. If the hand model needs a larger edge than the faces' 640, phase 4's shared decode is struck (§6.18) |
| H3 | 63 | you mark, the test reads: recall per band of hand width against the marked boxes | the smallest hand an event is offered for | a band of hand width under which recall falls below the gate's 8 of 10 is not offered (proposal) |
| H4 | 64 | you, on §6.17's clips: recall and tip error in palm-size units per condition, against bare hands in daylight | the gate's per-condition bars | §6.12's gate, per condition |
| H5 | 65 | node, over your raw tracks: `npx vitest run tests/handsSmooth.test.ts`, jitter at rest raw and filtered, lag causal and forward-backward | `OneEuroParams` and the dead zone | the 1€ starting values (1, 0, 1) kept or tuned as its authors say: lower `min_cutoff` until a still hand stops jittering, then raise `beta` until fast moves stop lagging |
| H6 | 66 | you: the `'gesture'` detector on sideways, downward and at-camera points, the label and score returned | nothing depends on it | recorded only; the geometric rule decides (the research, §5.4) |
| H7 | 67 | node, over your tracks: `pointEvents` with the shots, false events a minute in the no-point stretches, marked points missed | `DEFAULT_POINT_RULES` and the gate | the gate's 8 of 10 found and at most one false event a minute; rules tuned on tuning clips, re-measured on held-out ones in phase 4 |
| H8 | 68 | node: the same at `fps` 5, 10 and 15, onset against the marked onset, in frames | the sample rate | onset within 3 frames at ten a second: the rate stays. More: the rate goes to 15 (H2 prices it); the research's ±300 ms dense re-pass round each onset (its §5.2) is not planned in step 3 (§6.18) |
| H9 | 69 | you: the 16:9 clip analysed by main's own job (`createReframeJobs`, `src/main/reframe/analyse.ts:285`, as `reframeJob.int` drives it) in the app, followed at 9:16 (`Clip.follow`), the project saved; then the gated case above maps each event's tip through `tipOnFrame` on it | recorded beside the gate | the share on screen decides how often pointing is offered at 9:16, and is said in the switch's note if low |
| H10 | 70 | you, on rear-camera or DSLR clips | whether handedness is used | never for the side a graphic goes (the research, §5.3); recorded |
| H11 | 71 | node, the sandbox (phase 4) | where the track lives | the raw track in the AI helper's cache, the reduced events in the project (§6.18); confirmed or revised by size |
| H12 | 72 | you: in the spike, the worker's own clock on one clip (faces alone, `mode: 'detect'`; hands alone; both on one decode, `faces` in the hands spec), against EFFECTS §56's faces stage (EFFECTS.md:6310-6311); in phase 4, the job's stage clock as the row's command says | one decode or two | hands on the faces worker's decode (`vision.faces` with `hands`, §6.18) unless two passes measure no slower |
| H13 | 73 | you, the Mac and the Surface | the pin | `HAND_MODEL_URL`, `HAND_MODEL_SHA256` and `HAND_MODEL_BYTES` (7,819,105 if the length agrees) in `capabilities/faces.py`; the research read the file's HEAD [179] but did not record its path, so H13 fixes the URL before it is pinned |

§6's own open measurements stay as written: §15 row 10 (LM Studio's strict
`json_schema` with `minItems: 0` under Gemma 4 E2B, answered by phase 2's
first eval run) and row 11 (the Telugu negative endings, on the Telugu
fixtures before phase 2's exit).

**Phase 0's exit** is §6.12's. When its runs are in, this section gains a
"> **Phase 0, as measured**" note with each verdict and the constants'
values, dated, as the steps above carry their Built notes.

### 6.16 Phase 3 — The three.js compositor and 2.5D

**Phase 3 · 5 days, directly after phase 2, 2 of them moved from step 6.**
§16.55 (D2), answered as recommended on 2026-10-21: "Phase 3 directly after
phase 2. It is the three.js engine the request is about, and step 6 then
shrinks by 2 days. Step 4 (Best clips) moves 5 days later."

Phase 1 gave every graphic one pure `drawListAt` and painter A (§6.3); this
phase gives painter B its body. It rests on the research's reading of the
evidence (its §4.2): paint every layer with canvas 2D, so every word still
goes through `drawTextOnto` (`textPaint.ts:44`), the only renderer route
expected to shape Hindi and Telugu (an inference until M22), and use
three.js only to compose painted layers that ask for a camera, a depth, a
focus blur or a glow. That is the moments engine's own pattern: compose on a
2D canvas, upload, shade (`momentCanvas.ts:144-185`, `:321-335`).

**Nothing new reaches ffmpeg.** Painter B's frames are the same numbered PNGs
with alpha that §6.3 bakes, held by `tpad`, overlaid as every graphic is; §13
gains no row from this phase. Graphics stay above the look, ungraded
(§16.7). The validator never sees depth: a depth variant changes `z`,
`camera`, `glow` and transforms, never a text item (tested below), so §6.7's
property test, which reads the draw list's text items, holds unchanged.

#### The compositor — `src/renderer/src/graphicCompositor.ts`

New. Its exports:

- `createCompositor(width: number, height: number): Promise<Compositor |
  null>`: awaits `sharedRenderer(width, height)` (`threeShared.ts:35-50`)
  and builds the scene, cameras, quad geometry and shader materials once.
  Null when WebGL is missing (below). `Compositor` = `{ dispose(): void }`;
  its internals are not exported.
- `paintDrawList3d(list: DrawList, compositor: Compositor, options?:
  PaintOptions): HTMLCanvasElement` (`options` handed to painter A for each
  plane: the `images` a screen card's frame needs, the dim's `layer`):
  synchronous once created, as `momentPreviewCanvas`
  draws synchronously after an async build (`momentCanvas.ts:509-553`);
  returns the canvas the frame is on, which the caller copies into its own
  2D canvas with `drawImage`, as the moments do (`momentCanvas.ts:547-551`,
  `:600-603`), until M12 says otherwise.
- Pure, for the tests: `planesOf(list): { z: number; items: DrawItem[] }[]`,
  `isFlat(list): boolean`, `cameraFor(camera: Camera, size: { width: number;
  height: number }): { projection: number[]; view: number[]; distance:
  number }`; constants `MAX_PLANES = 4` (proposal) and `WEBGL_MISSING_NOTE`.

**Three routes, chosen per frame from the list alone** (`needsCompositor`,
§6.3, has already sent the list here):

| the list | route | why |
|---|---|---|
| flat: no `camera`, or tilt, yaw and dolly all 0 and no focus blur; and no `glow` | painter A paints every item, in plane order, onto one 2D canvas; no WebGL call | the settled frame of every 2.5D move is flat, so it equals the flat graphic **by construction**, not within a tolerance; the held end is then exactly what a flat graphic holds |
| flat, with `glow` | one plane: painter A's canvas uploaded at 1:1 under the identity quad, then the glow pass | the glow persists at rest; the base under it is the texture at 1:1, which M6 expects at 0.000 |
| a camera off flat, or a focus blur | one plane per `z`, under the perspective camera | the move |

**Planes.** `planesOf` groups the items by `z ?? 0`, ascending (far to
near), keeping list order inside a plane. A draw function that asks for
depth emits its items in ascending `z`, so painter A's list order and painter
B's plane order are the same picture. At most `MAX_PLANES` distinct `z`
values; a draw function never emits more (tested). `z` is in frame heights,
positive toward the viewer. Each plane is a frame-sized 2D canvas painted by
`paintDrawList2d` (§6.3) with that plane's items alone, uploaded as a
`CanvasTexture` with the moments' settings exactly: `NoColorSpace`, `flipY`
false, `premultiplyAlpha` false, no mipmaps, linear filters, clamped edges.
`textureOf` (`momentCanvas.ts:321-335`) becomes an export of that file,
unchanged, so the two drawers upload one way. A plane is repainted and
re-uploaded only when its items change, keyed as `Composed.at` keys its
rectangles (`momentCanvas.ts:163-170`): a tilt that changes only the camera
uploads each plane once.

**`dim` items are screen space.** They are painted on a base layer under
every plane by the identity route and never placed under the camera: a dim is
a darkened region of the frame, not an object in it.

**Shaders.** The flat route's quad uses the moments' identity vertex shader
(`momentCanvas.ts:189-194`). The perspective route uses three's standard
projection. The fragment shader samples the straight texel and writes
premultiplied colour, as the depth push does (`momentCanvas.ts:309-317`);
planes blend premultiplied "over" (`momentCanvas.ts:377-384`). With a focus
blur above 0 it averages a fixed disc of taps (13, proposal) at the plane's
radius; at radius 0 it returns the texel itself, so a settled plane is
exact.

**The camera.** `Camera` = `{ tilt, yaw, dolly, fov, focus? }` in degrees
(§6.3). A `PerspectiveCamera` at `fov` (30° when the list gives none,
proposal) looks at the frame's centre from `D = (H / 2) / tan(fov / 2)`
pixels, so the `z = 0` plane exactly fills the frame. A plane at `z` sits at
`z × H` and is scaled by `(D − zH) / D`, so under the flat camera every plane
projects to the frame (the parallax compensation; `cameraFor` is tested on
it). Tilt turns the planes about the frame's horizontal centre line, yaw
about its vertical one; `dolly` moves the camera to `D × (1 − dolly)`, so 0
is flat and a negative value starts further away. `Camera.focus` (added to
§6.3's type for this phase) is the depth in focus and the blur in frame
pixels per frame height of distance from it; absent, nothing is blurred.

**Glow.** `GlowRequest` = `{ item, radius, strength, color? }` (§6.3). The
requested items are painted alone onto a glow canvas per plane, rendered
through the same camera into a render target, blurred in two separable
passes (horizontal, then vertical) into a second, and added premultiplied
over the planes, so alpha is 0 beyond the glow's reach and below 1 inside it.
That is the planned route, needing nothing beyond three itself. **M7
decides, on this phase's first day** (moved from phase 0, §6.15): both
routes are built behind one seam, and if `UnrealBloomPass` (three r186's
own, alpha fixed 2025-12-09, the research's §4.2) keeps alpha 0 outside the
shape and below 1 in the glow on both machines, it is the route; else the
two passes are. The route not taken is removed. pmndrs `postprocessing`
stays out whatever M7's scratch-branch leg records, because its peer range
pins three below 0.187.

**What glows** (named 2026-10-21 by the review; the research's phase 3 has
"glow by M7's winner" on the hero graphic). A drawer emits a
`GlowRequest` only under a style with `glow` (`neon`, `energetic`), and only
for its clip's hero graphic (below): a `counter`'s `value` text, or a
`ring`'s `arc`, with the style's `glow.radius` and `glow.strength` and
`palette.accent` as its colour. At most one glowing graphic per footage
clip. The screen card's edge sweep (below) is the only other glow in step
3. No other template glows; a glow on a keyword's lit word waits for the
look rating.

**The one renderer.** Every render calls the compositor's own `sized()`
first, written as the moments' is (`momentCanvas.ts:393-395`, a closure
inside the moment builder, not an export), because another drawer may have
resized the shared context between two frames. The compositor never makes a renderer of
its own (`threeShared.ts:25-33`: one context, a browser keeps about sixteen).

**Disposal.** A `disposables` list as `momentCanvas.ts:361` and `:397-399`
keep: every texture, material, geometry and render target the compositor
made, disposed once each. The callers dispose it where the moments dispose
theirs: on rebuild and on supersede in the preview (`momentCanvas.ts:523`,
`:533-536`), on clip removal (`:555-558`), and in the bake's `finally`
(`:612`). Not as the carousel, whose rebuilt scenes are never disposed
(`carouselCanvas.ts:128-141`, §17).

**WebGL missing.** `new WebGLRenderer` (`threeShared.ts:42`) throws, or the
context comes back lost: `createCompositor` resolves null, once per session
(remembered). The caller then paints the list with painter A, which ignores
`camera`, `glow` and `z` (§6.3): every 2.5D variant draws flat, glow is
absent, the screen card's move is its flat fade and scale, the edge sweep
draws without its glow. The bake records `WEBGL_MISSING_NOTE` once ("drawn
flat: 3D needs WebGL, which did not start on this computer") in the
export's notes and the dock's graphic panel; the export succeeds (§14's
WebGL row).

**How `graphicCanvas.ts` reaches it** (§6.3's file; the seam stated here so
the two lanes agree): when `needsCompositor(list)` is true, the preview entry
or the bake creates one compositor (`createCompositor`) and keeps it with the
entry or for the bake's length; each frame is `paintDrawList3d` then
`drawImage` into the entry's or the bake's own 2D canvas; a null compositor
means painter A and the note. The compositor always renders the whole
frame, and a spec whose lists need it bakes the canvas region even if M1
chose the box (§6.3): a tilt or a glow puts ink outside the flat
`itemBounds` that `graphicBox` unions, so a box would crop it.

#### The 2.5D variants of `counter` and `ring`

`GraphicSpec.depth?: 'tilt' | 'parallax' | 'dolly' | 'focus'` (§6.1),
honoured only where `TemplateDef.threeD` is true: `counter`, `ring` and
`screen-card` in step 3 (§6.2's table; step 6 adds its three, §9). The
variants are written by this phase's lane into `templates/counter.ts` and
`templates/ring.ts` after phase 2 has closed them, as one `depth` branch in
each draw function, built only from §6.3's item kinds and §6.13's motion.

| `depth` | counter | ring | settles |
|---|---|---|---|
| `tilt` | one plane; the camera from tilt 24° (the top away) to 0 over the entrance | the same | camera exactly flat on the last beat |
| `parallax` | panel `z` 0, label 0.02, value 0.05; yaw from −8° to 0 over the entrance, the planes sliding against each other | panel 0, arc 0.03, value 0.05 | flat on the last beat |
| `dolly` | dolly from −0.12 to 0; the value's plane at 0.05 grows fastest | the same | flat on the last beat |
| `focus` | camera flat throughout; label plane at −0.02 with `focus` from 10 px to 0 as the value lands sharp | the arc and value sharp, label as counter | blur exactly 0 on the last beat |

Every figure is a proposal; the curve is the style's (§6.13, M14's winner).
Each variant arrives with its flat twin: the number reaches its value, the
arc its sweep, on the same beat frame. Because the last moving frame is flat,
the frame `tpad` holds is the flat graphic's own (route one above). Text is
resampled while a plane is tilted, so it softens in motion; at rest it is
painter A's.

**Who sets `depth`** (revised 2026-10-21 by the review). The first draft of
this re-plan had you only, through the dock; then phase 3's three.js work
never acted in an automatic run, though the research scored phase 3 for
"the hero graphic a glow or an edge sweep" (its §0, §7.3) and D2 calls it
"the three.js engine the request is about". So, as a proposal of this plan
and not one of your twelve answers:

- **The hero rule.** In phase 3, `applyGraphics` (§6.6) makes the first
  kept `counter` or `ring` of each footage clip that clip's hero: it gets
  `depth: 'tilt'`, the least of the four moves (a 24° settle over the
  entrance, flat on its beat), under every style; and under a style with
  `glow`, its glow (above). A clip with no counter or ring has no hero.
  `GraphicSpec.hero?: true` marks it (typed in phase 1 with `depth`, §6.1),
  so a rebake keeps one hero per clip.
- **You**, through the **Depth** choice in the dock's graphic panel (§6.6),
  on templates whose `threeD` is true: Flat, Tilt, Parallax, Dolly or
  Focus. Your choice wins over the rule and clears `hero` on that graphic.
- **Never the model** (§6.6), and never the style alone: D5 (§16.58) keeps
  the default restrained, which a 24° settle on one graphic a clip is
  meant to respect. The look rating (§6.10) asks about it with phase 3's
  renders once phase 3 lands; if you rate it down, the rule is turned off
  by a one-line change and the dock remains.

#### The screen card — `src/shared/graphics/templates/screenCard.ts`

§16.57 (D4): "Not in step 3. A screen recording gets the 2.5D card, a dim
and graphics. Revisit with a one-day cursor-from-pixels spike only if users
bring screen recordings; a recorder of our own is a separate project." This
is the card.

**Its trigger** (chosen 2026-10-21): **a dock action on a selected video
clip only**, **"Screen card"** with **Tilt in** and **Pull back**, in a new
`src/renderer/src/components/tools/ScreenCardButton.tsx` mounted beside the
reframe section (`Inspector.tsx:228`). Not a Director suggestion: nothing
tells the app that a clip is a screen recording (a transcript does not say
so; a detector was not researched), and the card makes no claim, so the
third pass has nothing to ground.

**Its spec.** `GraphicData` `{ template: 'screen-card'; clipId: string; move:
'tilt-in' | 'pull-back' }` (§6.1); `clipId` is the recording's clip. Its
`GRAPHIC_TEMPLATES` row is §6.2's (no fields, `appFields` `clipId` and
`move`, `threeD` true; seconds 1 / 10 / 600, the recording clip's length),
one beat, the landing.

**The move.** `SCREEN_CARD_MOVE_S = 1.0` (proposal), on the style's curve.
**Tilt in**: the card's plane from tilt 22°, yaw −10°, dolly −0.15 and
opacity 0 (to 1 over the first 0.25 s) to flat. **Pull back** (the research's
§1.2 row 23, "start with the screen filling the frame"): the card's transform
scale from 1.35 about its centre to 1, with a tilt from 6° to 0. Both land
flat on the card's box at frame `L` = `round(SCREEN_CARD_MOVE_S × fps)`,
the landing frame, **counted from the card's own first frame** (card
frames, as every graphic's frames are; never a timeline frame).

**The card's box** is where the render already shows the recording: the
whole source mapped through `sourceToFrame(project, clip, asset, canvas,
frame, { x: 0, y: 0, width: 1, height: 1 })` (`frameMap.ts:86-132`), which
is the fitted picture inside the clip's box (`clipBox`, `plan.ts:456-482`;
contain pads with `black@0`, `plan.ts:262`, so the bars are transparent and
the card floats over whatever is beneath). The card never changes the
recording's transform; a user who wants margins scales the clip first.

**The recording's frames** come from the moments' footage pre-pass, the
same pull a bridge over footage uses (`momentCanvas.ts:109-137`,
`window.forge.momentFrames`, preload `index.ts:259`): a `FootageRequest`
(`moment.ts:296-325`) for the card's moving frames, built by a pure
`screenCardFootage(project, spec, cardStart, frames, fps)` from the clip
exactly as `momentTextures` builds one (`momentTextures.ts:41-85`:
`texturePlanFor`, `footageWindow`, `followedFootage`, `FOOTAGE_MAX_EDGE`), so
the pulled frames are the render's own frames, crop and retime included
(EFFECTS §36). The draw function needs each frame's file and the card's box,
which a pure function of the spec cannot know, so this phase adds
`GraphicTargets.screen` (§6.3's type): `{ box: Rect; file: string | null }`.
The pure `graphicTargetsAt` gives the box; `screenTargetsAt` in
`graphicCanvas.ts` (§6.3) fills `file` per frame from the pull, through
`footageFrameIndex` (`moment.ts:336-340`), `null` after `L`, and the bake
decodes each file into painter A's `images` (§6.3) before the frame is
painted.

**What it draws** (`drawScreenCard`, one plane at `z` 0 plus the
screen-space dim):

| frames | items |
|---|---|
| up to `L` | the recording's frame as an `image` item filling the card's box; a bezel, a `stroke` round the box, square-joined (`join: 'miter'`), its width `max(M19's minimum, round(0.004 × the short side))` px (proposal), in the style's `palette.panel`; a full-frame `dim` (no hole) at the style's `palette.dimOpacity`, fading in with the move, whatever the style's `dim` says (D4 names "a dim" for a screen recording, §16.57) |
| `L + 1` on (held by `tpad`) | the bezel and the dim **with its hole on the card's box** (radius 0); no image |

Square corners in v1: the recording beneath is a sharp rectangle, and a
rounded bezel would leave its corners showing; rounded cards wait for a
rounded mask on the recording itself (§17).

**The hand-off.** During the move the flat recording beneath must not show
round the tilted card, so the card hides it: the store writes two opacity
keys on the recording clip, `[{ frame: cardStart − clip.start, value: 0,
ease: 'hold' }, { frame: cardStart − clip.start + L + 1, value: 1 }]`
(`Keyframe`, `render/keyframes.ts:64-69`; a key's frame counts from the
recording clip's own start, `L` from the card's, `cardStart` and
`clip.start` are timeline frames, and the card spans the recording, so
`cardStart − clip.start` is 0 today), computed by a pure
`screenCardKeys(card, recording, fps)`. A held key lands on its own frame in the preview and the
export alike since EFFECTS §45, and keyed opacity already renders with a
hold (`tests/integration/keyframes.int.test.ts:122-125`). At `L` the card
draws the recording's frame `L` flat on its box, opaque, so the recording at
opacity 0 beneath is unseen; from `L + 1` the bezel's hole shows the
recording itself. Outside the box the dim is the same on both sides of `L`.
The card's flat frame `L` is the pulled frame drawn by `drawImage` into its
box, as `Composed` draws a footage frame (`momentCanvas.ts:163-184`), whose
bridges measured 1.1 and 1.2/255 mean against the render's frames (EFFECTS
§36): the hand-off is measured with M20 and must be within 2/255 mean
(proposal) on both machines.

**The store.** `addScreenCard(clipId, move)` adds the graphic through
`addGraphicClip` (§6.3) spanning the recording clip exactly (no exit fade:
the card ends as the recording ends) and writes the two keys in the same
history step. `rebakeGenerated` (`store.ts:2050-2223`) realigns a card whose
recording was moved, trimmed, retimed or changed frame rate: the card's
start and length follow the recording's, and its two keys are rewritten.
**The card is your edit, not a run's**: it is made by your dock action, so
it carries no `generatedBy` rule. Drop removes the card and exactly the two
keys `screenCardKeys` gives (a key of your own is kept); neither Clear
graphics (`'clips.graphic'`) nor Direct's Clear (`DIRECTOR_RULES`) takes
it, since §16.10 settles which graphics each Clear removes and both are
about the graphics a run makes. Deleting the recording deletes its card. A
split of the recording keeps the card with the left half, which keeps the
clip's id; the card itself is not split (§6.3).

**The export.** A card whose bake fails or returns null is dropped from the
export with its note, as §6.3 drops a graphic; **its two keys are struck
from the export's copy of the recording clip in the same step**, or the
recording would play hidden for the move's length. Written into §6.3's
branch in `exportBake.ts`; the rule is this phase's.

**Refused, with the reason in the dock**: a recording that is steadied (the
pre-pass does not run the stabiliser, EFFECTS §36, `momentTextures.ts:48`);
rotated, or with keyed zoom or rotation (`sourceToFrame` models neither,
`frameMap.ts:31-35`); with opacity keys of its own; with a colour
adjustment, or under a look (the card's moving frames are above the look,
ungraded, §16.7, so the landing would show the grade arrive; §16.7 is not
reopened, this is why the dock greys it); an image clip. One card per
recording clip.

**The budget.** The screen card is outside §6.9's budget, and its dim is the
only dim while it is on screen (§6.9). A `callout` over a recording has no
face to point at, so rule 9 drops it, as it would without the card.

**Without WebGL** the camera is ignored: Tilt in is the card fading in on
its box, Pull back its flat scale; the hand-off is unchanged.

#### The edge sweep

The research's §1.2 row 21 (a short highlight running round a card's
border; Magic UI's `BorderBeam`, a 6 s loop, linear, [18]). In step 3 it
belongs to **the screen card only**, drawn when the resolved style carries
`glow` (§6.5: `neon` and `energetic`, proposal): a `stroke` on the bezel's
rectangle with `from` and `to` both advancing linearly, a span of 0.12 of the
perimeter (proposal), **one loop of `EDGE_SWEEP_S` = 6 s from the landing,
then gone**, two stroke items while the span crosses the path's start, and
a `GlowRequest` on it. One card per recording clip makes "once per clip"
true by construction.

**Bounded, and narrowed** (both 2026-10-21, by the review):

- **One loop, not the hold.** A card spans its recording, up to 600 s, and
  the research warned against baking a screen card frame by frame over its
  hold (its §4.4, §4.8). So `graphicMovingFrames` (§6.3) returns `min(total,
  L + 1 + round(EDGE_SWEEP_S × fps))` for a glowing card, 211 frames at 30
  fps with the default move, under M1's 300-frame whole-hold budget; after
  the loop the settled bezel holds through `tpad`. M20 times it.
- **On the screen card's bezel, not a graphic's panel.** The research puts
  the sweep round "a card's rounded rectangle", the hero graphic's. In step
  3 the hero's highlight is its glow (above), and the sweep stays on the
  screen card, where the border is the subject; a sweep round a counter's
  panel waits for the look rating (§6.10).

Without WebGL the sweep draws without its glow, through painter A.

#### The harness

Phase 0 ran M6's Indic and colour parts against raw three.js (§6.15). This
phase opens with M7, `'unreal'` and `'quad'` on the compositor's glow seam
(moved from phase 0, §6.15), then runs M6 again **through
`paintDrawList3d` itself** (M6 whole, each 2.5D variant's settled frame
against its flat twin, 0 by route one), plus M12's readbacks and M20's
screen card with its hand-off and its one-loop sweep, all through §6.11's
options table; M13 runs on a 2.5D `counter` and a screen card. Every result goes to EFFECTS §61 with its
command, machine and date.

#### Tests (each mutation-checked; §6.11 indexes them)

- **`tests/graphicCompositor.test.ts`**, its pure parts: `planesOf`
  ascending (far to near, drawn back to front), list order kept inside a
  plane; `isFlat` sends a flat list, and every variant's settled frame, to
  route one; `cameraFor`'s flat camera maps one texel to one pixel, `dolly`
  0 is flat, and the corners of a `z` 0 plane and of a compensated `z` 0.05
  plane land on the frame's corners (1e-9); a `dim` never on a camera
  plane; the disposal list holds every texture, material, geometry and
  render target a build makes and each is disposed exactly once, on
  rebuild, supersede, bake end and clip removal (a counting stand-in for
  three); `createCompositor` null when the renderer throws (`threeShared`
  mocked), and the caller then paints with painter A, leaving out `depth`,
  `camera` and `glow`, and records `WEBGL_MISSING_NOTE` once. Mutations:
  planes sorted descending; route one skipped at rest (the settled frame
  through the textured path); the compensation dropped; a texture left off
  the disposal list; a compositor returned, or a throw, when WebGL is
  missing.
- **`tests/graphicDrawList.test.ts`**, two cases added: for `counter` and
  `ring` with each `depth`, every frame's text items (text and look) equal
  the flat variant's; at and after the last beat every camera field and
  focus blur is exactly 0; at most `MAX_PLANES` distinct `z`. Mutations: a
  variant that rounds the value's string; a tilt left at 0.5° at rest.
- **`tests/graphicFrame.test.ts`**, three cases added: a screen card's
  image item present up to `L` and absent after, its dim drawn whatever the
  style's `dim`, with its hole only after `L`; its moving frames `L + 1`
  plus the settle, and under a glowing style `L + 1 + round(EDGE_SWEEP_S ×
  fps)`, never `total`, for a 60 s card; `screenCardKeys` for a card whose
  start is not the recording's start puts the second key at `cardStart −
  clip.start + L + 1`. Mutations: the image drawn on the held frame; the
  sweep looping over the whole hold (a 60 s card bakes 1,800 frames); `L`
  taken as a timeline frame (the second key lands before the first).
- **`tests/graphicBudget.test.ts`**, a phase-3 case (it drives
  `applyGraphics` over fixture candidates): the first kept `counter` or
  `ring` of each footage clip gets `depth: 'tilt'` and `hero`, and, under
  `neon`, a `GlowRequest` on its `value` or `arc`; no other graphic does;
  a second clip has its own hero; a graphic whose depth you set keeps
  yours. Mutations: every counter made a hero; one hero per project instead
  of per clip; a glow on a non-hero.
- **`tests/renderer/graphicStore.test.ts`**, cases added: `addScreenCard`
  writes exactly `screenCardKeys`' two keys; Drop removes the card and
  exactly those keys (a key of yours stays); Clear graphics and Direct's
  Clear leave the card and its keys; a moved or trimmed recording realigns
  the card and its keys; each refusal above, with its reason. Mutations:
  Drop leaving the keys; the realign skipped; the card given
  `CLIPS_GRAPHIC_RULE` (Clear graphics takes it).
- `graphic.int`'s phase-3 case, the hand-off through the real plan, is
  §6.11's.

The exit is §6.12's phase 3. §14 carries the degraded rows (WebGL
unavailable; the recording's frames missing).

#### Days

| item | days |
|---|---|
| the compositor: routes, planes, camera and compensation, upload, disposal, WebGL missing | 1.5 |
| glow (the two-pass route; M7's alternative behind the same seam) and focus | 0.5 |
| the 2.5D `counter` and `ring` (the 2 days moved from step 6, less what the compositor now carries), and the hero rule in `applyGraphics` | 1 |
| the screen card: pull, `screenTargetsAt` and the bitmaps, draw, keys, store, export drop, refusals | 1.25 |
| the edge sweep, one loop | 0.25 |
| the harness's phase-3 options, the tests, `graphic.int`'s case, M6/M7/M12/M13/M20 on both machines | 0.5 |
| **phase 3** | **5** |

### 6.17 The hand spike and its gate

**1.5 days, unconditional, run during phase 2's weeks; mostly your runs.**
§16.56 (D3), answered as recommended on 2026-10-21: "Yes, during phase 2,
1.5 days counted in the unconditional 30.5 (it is mostly the user's run, on
the user's machines and footage); pointing only; the 6-day build only if
the gate passes; off per clip by default; every pointed graphic a proposal
the user keeps. It needs clips with marked points, hennaed hands, a
low-light reception and a blurred fast point among them."

**What it answers.** Whether MediaPipe's hand landmarker, already in the AI
helper's 0.10.35 wheel (the research, §5.1), finds a speaker's point on your
footage well enough to build on. The model's card puts hands with henna,
jewellery or a held object out of scope, and says it was not tested in low
light or motion blur (the research, §5.3): for a wedding-first product those
are the ordinary case, and only measurement can size them. Nothing in the
spike is shown to you in the app.

#### The spike's code

Each piece is the first version of what phase 4 hardens; nothing here is UI.

- **The worker** (`sidecar/forge_sidecar/workers/mp_faces.py`). `parse_spec`
  (`:155-213`, which accepts only `detect` and `import` today) gains
  `mode: 'hands'`: `path`, `ffmpeg`, `width`, `height` (upright), `fps`
  (1-30), `edge`, `startMs`, `endMs?`, `durationMs?`, `model`, `track`,
  `partial`, `minDetection`, `minPresence`, `minTracking` (each 0-1; 0.5,
  MediaPipe's defaults, the research [172]), `numHands` (1-2; 2), `bench`
  (boolean), `detector` (`'landmarker'` or `'gesture'`), and `faces?: {
  model, track, partial, minScore }` to run the face detector on the same
  decode (H12). `load` (`:500-533`) builds the `HandLandmarker` (VIDEO mode,
  CPU delegate, the model as bytes, as `_blaze_face` does, `:352-379`). A
  pure `hands_of(result, width, height)` normalises the 21 points to the
  upright analysed frame, clamps, rounds to 4 dp, takes each hand's box from
  its points, keeps at most two, largest box first, as `boxes_of` does for
  faces (`:237-269`). A `HandsWriter` streams `HandsRaw` (§6.18's types) to
  `partial` and renames it into place when whole, as `TrackWriter` does
  (`:283-320`). `bench: true` adds each sample's detect time as `detectMs`
  (never read by `pointEvents`). The `'gesture'` detector (the Gesture
  Recognizer, for H2 and H6 only) stores the canned `label`; **it is removed
  when the spike ends, whatever the gate says** (its licence is unstated and
  it is not the pointing detector, the research's §7.5). A stand-in,
  `FORGE_HANDS_WORKER_FAKE=colour` (as `FORGE_FACES_WORKER_FAKE`,
  `workers/mp_faces.py:68-73`), never imports mediapipe: a cyan blob is the
  index tip, a magenta blob the wrist, and it reports a fixed pointing hand
  between them (presence 0.9). Every spawn keeps `CREATE_NO_WINDOW`
  (`media.py:51`).
- **The test's driver.** `tests/integration/hands.int.test.ts` starts the
  worker directly with the argv `capabilities/faces.py`'s `worker_command`
  gives (`:321-331`), fetched through the helper's interpreter as
  `oldestFfmpeg.test.ts` fetches the helper's ffmpeg argv, on the helper's
  venv or an installed pack (`FORGE_HELPER_PACK`), as `faces.int` does
  (`tests/integration/faces.int.test.ts:1-60`). The stand-in suite runs
  where `faces.int`'s runs. The real suite runs only as
  `FORGE_HANDS_REAL=<clip> npx vitest run tests/integration/hands.int.test.ts`
  and writes its tables to `tests/output/hands/real/README.txt`.
- **The models** are yours to fetch for the spike (H13's command), into the
  folder `faces.int` seeds the face model from
  (`sidecar/.venv-faces/models/`, `faces.int.test.ts:51-52`); no test
  downloads.
- **`src/shared/hands/`**: `types.ts` (§6.18's shapes), `events.ts`
  (`pointEvents` with §6.18's rules), `oneEuro.ts` (`oneEuroFilter`,
  `smoothTip`), `anchor.ts` (`tipOnFrame` only), with
  `tests/handsEvents.test.ts`, `tests/handsSmooth.test.ts` and
  `tests/handsAnchor.test.ts` covering what H5, H7, H8 and H9 lean on, and
  `tests/sidecar/test_hands.py` for the worker's pure parts. §6.18 specifies
  all five tests; **the spike writes these cases of them** (listed
  2026-10-21 by the review, so the spike lane knows what to leave), each
  with its §6.18 mutations:
  - `handsEvents`: the enter, exit, bridge and minimum rules; the finger
    rule; an event cut at its shot's end and the first sample after a cut
    discarded; `dir` in pixels; ids stable. Not `mergeHands` or
    `pointingState` (phase 4).
  - `handsSmooth`: every case.
  - `handsAnchor`: `tipOnFrame` only (through a followed crop; null off
    screen; the zero-size box). Not `pointPlacement`, rule 11 or
    `anchorProposals` (phase 4).
  - `test_hands.py`: `parse_spec`'s `hands` mode with its ranges and the
    refusals of an unknown mode and `fps` 0; `hands_of`'s clamp, 4 dp and
    order; the writer's rename. Not the shared-decode refusals or
    `HANDS_RAW_VERSION` (phase 4 adds both to `faces.py`).
  - `hands.int`: the worker driven directly (its argv from `worker_command`),
    the stand-in suite (samples in source ms, monotone, versioned, keyed by
    `size:mtime`, upright), and the gated real suite with H7's `findShots`
    and H9's project case (§6.15's notes). Not the run through
    `vision.faces` with `hands`, the byte-for-byte face track or the cancel
    (phase 4's RPC).

The finger rule lives in `events.ts` only, never in the worker: the raw
track keeps all 21 points, so the rules can be re-derived from the cache
without running the model again (the research, §5.5), and one copy cannot
drift from another. So `test_hands.py` does not test the rule;
`handsEvents.test.ts` does, beside the only copy.

#### The clips (your part)

Kept beside the face fixture under `references/recordings/` (gitignored;
never committed, §16.5's rule), each with a marks file beside it,
`<clip>.marks.json`: `{ condition: 'bare' | 'henna' | 'low-light' | 'blur' |
'held' | 'rear'; points: { ms: number; tip?: { x: number; y: number } }[];
none?: [number, number][]; hands?: { ms: number; box: UnitRect }[] }` (the
test's own type: the source ms of each point's onset, the fingertip in
upright 0..1 where marked, the stretches with no point, and hand boxes for
H3). Wanted: at least ten marked points in each of bare hands in daylight,
hennaed hands with bangles and rings, and low light or motion blur (a
low-light reception and a fast point among them); a held microphone, phone
or bouquet; three minutes or more of natural gesturing with no point in
each of the first three conditions; unmirrored rear-camera or DSLR clips;
one 16:9 talking-head clip. Two clips per condition are kept back, unseen by
the spike, for phase 4's held-out exit. The hours are in §2's "Your part".

#### Running the H rows

The rows, what the spike runs for each, and what each decides are §6.15's
(H1-H10, H12 and H13 in the spike; H11 in phase 4). Results go to EFFECTS
§62 with their commands, machines and dates.

#### The gate

The gate, its three conditions and its three outcomes are §6.12's.

**After a fail or a stop** (chosen 2026-10-21): the spike's code stays in
the repo behind no UI. The worker's `hands` mode is never asked by main; the
real suite is gated and costs CI nothing; the pure parts' tests keep it from
rotting; and a later model, or new footage, can run the gate again in an
hour. `bench` ships with the worker (it is the gate's own instrument, and
harmless unasked); the `'gesture'` branch does not, whatever the gate says.
The gate's result and the outcome are recorded here, dated, as a Built note.

#### Days

| item | days |
|---|---|
| the worker's `hands` mode, bench, the stand-in, `faces` on the same decode, the gesture branch | 0.5 |
| `src/shared/hands/` first versions and their three tests | 0.4 |
| `hands.int` (both suites, the README tables), `test_hands.py` | 0.3 |
| the runs on both machines (the clips and their marks are "Your part" hours, §2) | 0.3 |
| **the spike** | **1.5** |

### 6.18 Phase 4 — The hand build, only if the gate passes

**6 days, built only on the gate's pass, or on a partial with your yes
(§6.12); in no total until then.** D3 (§16.56): pointing only; off per clip
by default; every pointed graphic a proposal you keep. What it adds: the
speaker points, and a callout's arrow ends on the fingertip, on clips you
turned it on for, as proposals.

#### The worker: hands on a shared decode

`run` (`mp_faces.py:536-586`) gains the hands detector on the same frames:
one `media.iter_frames` decode at the hands' rate, the face detector run
only on the samples on the faces' grid. `frame_args` takes each sample as
the frame on screen at `start + i × 1000 / fps` (`media.py:246-270`,
`fps=…:round=up`), so at ten a second the even samples are the very frames a
five-a-second pass reads, and **the face track is byte for byte the one a
faces-only pass writes** (tested). Two conditions make that hold, and the
helper refuses anything else with a `ValueError`: the hands' `fps` is a whole
multiple of the faces' (10 on 5 by default; H2 and H8 may move it to 15), and
the hands' `edge` equals the faces' (640, `faces.py:93`). If H2 shows the hand
model needs a larger frame than 640, the shared decode is struck and hands
run as their own pass at their own edge (H12 prices it), so the face track
never changes because pointing was turned on. A pass with the face track
already cached runs hands alone, and the other way round; a cancel removes
both partials. `done` gains a third count, the samples with a hand. The
worker's `TRACK_VERSION` copy (`mp_faces.py:123`) is joined by
`HANDS_RAW_VERSION = 1`, the version of the raw cache file, held equal to
the helper's by `test_hands.py`. (Named 2026-10-21 apart from the project's
`HAND_EVENTS_VERSION`, §6.18's `hands/types.ts`: the contract had
`HANDS_TRACK_VERSION` and `HAND_TRACK_VERSION`, two values one letter
apart, the trap §6.1 cites for `GraphicSpec` and `GraphicsSpec`.)

#### The AI helper — `capabilities/faces.py`

- **Constants** beside `MODEL_URL` (`:67-82`): `HAND_MODEL_URL`, the
  versioned `float16/1` path of `hand_landmarker.task` under
  `storage.googleapis.com/mediapipe-models/` (the face model's own path
  shape, `:67-70`; H13 fixes it before it is pinned); `HAND_MODEL_SHA256`
  (H13); `HAND_MODEL_BYTES = 7_819_105`; `HAND_MODEL_LABEL = "the hand
  finder"`; `HANDS_RAW_VERSION = 1`. The model card states Apache 2.0 (the
  research, [176]).
- **`vision.handsModel`** (ModelParams → ModelStatus), the press and the
  registration, written as `faces_model` is (`:189-193`, with `model_path`
  at `:169`): on disk or not,
  `fetch_url` against the pinned sha256 only on `download: true`, labelled
  byte progress, cancellable. Registered in `register` (`:673-682`) beside
  the two face methods, behind the same `find_spec("mediapipe")`. There is
  no `vision.hands` method (chosen 2026-10-21: one decode, H12).
- **`vision.faces` gains `hands?: HandsParams`**, `HandsParams` = `{ fps:
  number; edge: number }`. `settings` (`:212-250`) checks it (the two
  conditions above); the raw track's path is `media.cache_dir("hands")`'s
  `<key>-<hash>.json`, the hash over the version, the detector (a stand-in
  included), the model's sha256, the key, the upright size, the window, the
  rate, the edge and the thresholds, as `track_path` hashes the faces'
  (`:265-287`). Hands asked with the hand model absent answer
  `Unavailable`; main never asks so (below). `FacesResult.hands` = `{
  track: string; detector: string }`. `run_worker` (`:501-622`) is
  unchanged: one worker, one spawn with `media._NO_WINDOW`
  (`media.py:50-51`), one cancel.

#### Protocol, the self-test and the pack

- `src/shared/sidecar/protocol.ts`: `SIDECAR_METHODS.handsModel =
  'vision.handsModel'` beside `facesModel` (`:189`); the method in
  `OPTIONAL_METHODS` (`:217-230`); `HandsParams`, `FacesParams.hands?`
  (`:321-348`), `FacesResult.hands?` (`:351-373`); `HANDS_RAW_VERSION`
  beside `FACES_TRACK_VERSION` (`:384`).
- `sidecar/forge_sidecar/capabilities/__init__.py:40`: the faces row lists
  `vision.handsModel` too, so `system.hello` answers it as a capability or
  degraded, never absent (`sidecar.int`'s "every optional method" case).
- `src/shared/sidecar/selftest.ts:32`: `SELFTEST_GROUPS.faces` gains
  `SIDECAR_METHODS.handsModel` (chosen 2026-10-21). The faces group's child
  already loads `libmediapipe` (the worker's import-only run,
  `mp_faces.py:326-349`; `selftest.py:85`, `:129-132`), which the hand
  landmarker uses too, so a failed faces group greys both finders, and
  `selftest.py`'s `GROUPS` (`:106`) is unchanged.
- `src/shared/sidecar/packManifest.ts`: `'vision.handsModel'` in both
  platforms' `expects` (`:314-324`, `:628-638`); the Settings row's count
  becomes ten (`helperFeatureCount`, `selftest.ts:119-130`).
  `tests/helperPackManifest.test.ts:340-344` already holds `expects` inside
  `OPTIONAL_METHODS`, and `helperPack.int`'s installed-pack case
  (`:558-561`) checks the pack's helper registers it.

#### Main — the analysis and the press

- `src/shared/reframe/job.ts`: `ReframeAnalyseRequest` (`:65-82`) gains
  `hands?: true`; `ReframeCollected` (`:111-120`) gains `hands?: HandTrack`;
  `REFRAME_CHANNELS` (`:45-54`) gains `handModel` and `handModelProgress`
  (`tests/renderer/bridgeMethods.test.ts` holds each to its preload
  method). A
  pointing ask carries `clipIds: []`, so nothing is made to follow; its job
  row reads "Finding where they point · <name>".
- `src/main/reframe/analyse.ts`: the cached early return (`:330-344`) holds
  only when the hands asked for are cached too; a hands ask checks
  `vision.handsModel` beside the face gate (`:354-355`) and fails
  `model-missing` before any work; a hands ask's faces call (`:375-385`)
  carries `hands: { fps: 10, edge: 640 }` (H2, H8 revise); after the
  reduction (`:405-408`), `pointEvents(raw, DEFAULT_POINT_RULES,
  track.shots)` makes the `HandTrack` the collect returns. Its stage label
  becomes "finding faces and where they point" while hands run.
  `handModel(payload)` mirrors `faceModel` (`:523-539`): only exactly
  `download: true` fetches, one fetch at a time.
- `src/main/ipc.ts` beside `:1285` and `:291`; `src/preload/index.ts` beside
  `:436-443`; the harness bridge's stand-in beside the face finder's
  (`harness/bridge.ts:273`). Every `execFile` stays `windowsHide: true`;
  nothing new is spawned from main.

#### `src/shared/hands/`

- **`types.ts`**: `HandsRaw` (the AI helper's cache file, versioned like the
  face worker's `track_path`, keyed by `size:mtime`) = `{ version: number;
  samples: { ms: number; detectMs?: number; hands: { presence: number;
  handedness: string; score: number; box: UnitRect; points: [number,
  number][]; label?: string }[] }[] }` (`detectMs` the bench's only; `label`
  the spike's gesture detector's); `PointRules` = `{ enterSamples: number;
  exitSamples: number; enterPresence: number; exitPresence: number;
  bridgeMs: number; minMs: number }`; `DEFAULT_POINT_RULES` = 3, 2, 0.5, 0.4,
  200, 400 (the research's §5.4 starting values, proposals until H7 and H8);
  `PointEvent` = `{ id: string; shot: number; startMs: number; endMs: number;
  dir: 'left' | 'right' | 'up' | 'down'; score: number; tip: { ms: number; x:
  number; y: number }[]; hand: UnitRect }` (source ms; upright-frame units);
  `HandTrack` = `{ key: string; version: number; width: number; height:
  number; fps: number; detector: string; events: PointEvent[] }`;
  `OneEuroParams` = `{ minCutoff: number; beta: number; dCutoff: number }`
  (1, 0, 1 to start); `HAND_EVENTS_VERSION = 1` (the version of a project's
  `HandTrack`, apart from the raw cache's `HANDS_RAW_VERSION`, above; each
  tested where it is read); `POINTING_SWITCH = 'Callouts
  follow a point'` (the switch's label; proposal); `HAND_HOLD_MS = 300` and
  `DEAD_ZONE = 0.02` (the research's §5.6 starting values).
- **`events.ts`**: `pointEvents(raw: HandsRaw, rules: PointRules, shots:
  readonly Shot[]): PointEvent[]`, pure. Per sample, a hand points when, in
  pixels (x times the upright width, y times the height, because the points
  are normalised per axis, the research's §5.4): the angle at the index PIP
  between MCP→PIP (5→6) and PIP→TIP (6→8) is at most 30° (proposal); the
  middle, ring and little tips (12, 16, 20) are nearer the wrist (0) than
  their PIPs (10, 14, 18); the thumb is ignored. The sample right after each
  cut is discarded (the tracker's crop is stale there). Per shot, with
  `DEFAULT_POINT_RULES` (3 samples to enter at presence ≥ 0.5; 2 to leave, or
  presence under 0.4; gaps of 200 ms or less bridged; at least 400 ms long):
  an event starts at its first qualifying sample (backdated) and ends at its
  last, never past its shot. `dir` is the dominant axis of the mean MCP→TIP
  vector in pixels; `score` the mean presence times the mean curl margin
  (proposal); `hand` the union box; `tip` the fingertip through `smoothTip`,
  then the dead zone (a smoothed move under `DEAD_ZONE` of the short side is
  not drawn), at 4 dp; `id` = `p<shot>-<startMs>`, the same every time the
  same rules meet the same raw track. Also `mergeHands(old, fresh,
  anchored: Set<string>): HandTrack` (below) and `pointingState(project,
  clip, helper, model)` (the switch's states).
- **`oneEuro.ts`**: `oneEuroFilter(samples, params: OneEuroParams, scale:
  number)`, causal, in palm-size units (wrist to middle MCP, the card's
  definition, the research's §5.4); `smoothTip(samples, params, palm:
  number)` runs it forward, then backward over the result, to cancel the
  lag; state never carried across events.
- **`anchor.ts`**: `tipOnFrame(project: Project, clip: Clip, asset:
  MediaAsset, canvas: { width: number; height: number }, event: PointEvent,
  frame: number): Point | null` (chosen 2026-10-21 to take the asset and the
  canvas, as `sourceToFrame` does): the clip frame's source ms through
  `sourceMsAt` (`frameMap.ts:210-232`); null outside the event; the tip
  interpolated linearly between its two samples; a 0.001-wide box round it,
  because `usable` refuses a box with no size (`frameMap.ts:45-47`);
  `sourceToFrame` (`:86-132`), null off screen; the box's centre in output
  pixels. `pointPlacement(project, clip, asset, canvas, event, startFrame,
  frames, template): GraphicSpec['place'] | null` (null: not offered): the
  caption's third excluded as
  §6.9 excludes it, the face boxes (`subjectBoxesAt`, `:275-291`) and the
  event's hand box (through `sourceToFrame`) as obstacles; for a left or
  right point the free third nearest the tip's height at onset, for up the
  nearest above it, for down below; null when none is free. Also
  `anchorValid(project, spec): boolean` (rule 11) and
  `anchorProposals(project, clipId): GraphicProposal[]`, below.

#### The project

- `Project.hands?: Record<string, HandTrack>` in `src/shared/timeline.ts`
  beside `subjects` (`:974`): a fact about the file, as the subject track is;
  Clear leaves it; optional, so every older project opens unchanged; source
  ms, so a frame-rate change touches nothing.
- `Clip.pointing?: true` on `Clip` (`:355` on): absent is off (D3).
- **A re-analysis never moves a placed graphic.** The collect lands a fresh
  `HandTrack` through `mergeHands`: every event an `anchor` names (a placed
  graphic's or a proposal's) is kept exactly as stored, tip samples and all,
  even when the fresh list has an event with the same id; the rest is the
  fresh list. A different machine, model or rule set may find other points;
  they arrive only as new proposals. The track's `detector` names the model
  and its sha256.

#### The anchored callout

- **Rule 11** (§6.7 lists it by number; its text is this): a `callout` keeps
  its `anchor` only when `Project.hands[anchor.assetId]` is of
  `HAND_EVENTS_VERSION` and measured on the asset's own size; it holds an
  event whose `id` is `anchor.event`; the callout's `subject.clipId` clip
  shows that asset; the event's shot is the one the callout's first beat
  falls in; and the event's span intersects the callout's on-screen span in
  source ms (first beat − `LEAD_S` to last beat + `TAIL_S`). Otherwise the
  anchor is removed, the callout falls back to rule 9's subject box (or is
  dropped if it has none), with the note "the point this callout followed is
  gone". `anchorValid` is the check; the validator and the store's rebake
  both call it.
- **The model never sees the points, in v1.** `anchor` is not in
  `graphics@1`'s schema (§6.6), and the menu is not shown the events. This
  departs from the research, whose §5.7 showed the model the clip's events
  and let deictic words ("this", "here", "look") strengthen a bind; not in
  v1 because the eval's fixtures carry no hand tracks, so an effect on the
  model could not be measured, and the app binds an event to a callout by
  time alone (rule 11). A later eval line could add both.
- **Proposals you keep.** `anchorProposals` runs when hands land and after a
  graphics pass, on clips with `pointing` on: for each **placed** callout on
  such a clip, the first event that passes rule 11, whose tip is on screen at
  the callout's first beat (`tipOnFrame` not null) and for which
  `pointPlacement` finds a third, gives one `GraphicProposal` (§6.1): the
  callout's spec with `anchor`, `shape: 'arrow'`, the new `place`, and
  `proposal: { reason: 'pointed' }`; its rule is the callout's own
  (`GRAPHIC_RULE` or `CLIPS_GRAPHIC_RULE`), its note "follows the point at
  0:42, pointing left". One event anchors one callout at most, and a point
  whose tip is off screen at onset is not offered (H9 says how often). Keep
  replaces the callout's spec; Drop leaves the callout pointing at the face.
  The Transcript tile's Graphics list (§6.6) shows them beside "check the
  number". Turning `pointing` off removes the clip's `'pointed'` proposals;
  anchored callouts already kept stay, as your edit.
- **Drawing** (a branch in `templates/callout.ts`, §6.2's file, written by
  this phase's lane): the body sits in its third on the pointed side (dir
  read from the event) and never moves; a leader line draws on from the body
  to `targets.tip` over 0.35 s from the beat (§6.13), its end following the
  tip on every frame with the riding arrowhead (§6.3's stroke); with no tip,
  no line. `graphicTargetsAt` (§6.3; this branch is this phase's) gives
  `tip` from `tipOnFrame`, or the last on-screen tip within `HAND_HOLD_MS`
  before, or null; so the line holds 300 ms after the hand leaves the frame,
  then is gone (an animated retract waits for your rating). The tip moves on
  every frame, so `graphicMovingFrames` returns `total` for an anchored
  callout (≤ 3 s, `callout`'s maximum).

#### The switch — `src/renderer/src/components/tools/PointingToggle.tsx`

Mounted beside the reframe section (`Inspector.tsx:228`), for a video clip:
the clip's other face-finder control. Smart placement is a project switch in
the OUTPUT strip; pointing is per clip (D3), so it sits in the dock. Its
states follow `smartPlacementState`'s (`captions/smart.ts:79-85`), through
`pointingState`:

| state | shows |
|---|---|
| the helper missing, or the faces self-test failed | greyed, "needs the AI helper", the pointer to Settings (`HelperPointer`, `SettingsPanel.tsx:104`) |
| the helper starting | greyed, "the AI helper is starting" |
| the hand finder not on disk | the switch greyed "needs the hand finder", and the press **"Get the hand finder · 7.8 MB"**, or "Get the hand and face finders · 8.9 MB" when the face finder is absent too (the analysis needs both; every download is named with its size before the press, §0) |
| off | `POINTING_SWITCH`, off (the default) |
| on, no hand track yet | the analysis starts (the job row); "finding where they point" |
| on, with a track | "N points found in this clip", or "no points found in this clip"; after a partial gate, the measured note |

The label's size is decimal megabytes at one place, ReframePanel's
`modelMegabytes` (`ReframePanel.tsx:69-71`): 7,819,105 B is "7.8".
`formatBytes` (`assets/pack.ts:443-448`, the speech model's) would say "7
MB". The store: `setPointing(clipId, on)` and `getHandModel()`, with
`ensureHandModel` and `landHands` written as `ensureFaceModel` and the
collect are (`store.ts:5779-5805`, `:5955-5980`); the `reframe` slice gains
the hand model's status and its fetch.

The degraded modes are §14's rows (the AI helper or a failed faces
self-test; the hand finder not on disk; a hand track of another version or
size; a point off screen at onset, or no free third).

#### Tests (each mutation-checked; §6.11 indexes them)

- **`tests/handsEvents.test.ts`**: enter on 3 qualifying samples at ten a
  second, exit on 2 failing or presence under 0.4, dropouts of 200 ms or less
  bridged, events under 400 ms dropped (`DEFAULT_POINT_RULES`, on synthetic
  tracks); the finger rule on fixed 21-point hands (a sideways point and an
  index-up point are points; a fist and an open palm are not); an event ends
  at its shot's end, and the first sample after a cut is discarded and does
  not continue it; `dir` from MCP to TIP in pixels; ids stable; **a
  re-derived event list never moves a placed graphic** (`mergeHands` keeps
  every anchored event, and every placed graphic's `anchor` and place are
  unchanged, a proposal offered instead); `pointingState`'s table.
  Mutations: an event across a cut (the shot boundary ignored); the first
  sample after a cut kept; enter after one sample; exit on one failing
  sample; no bridging; the ring finger's curl read from the middle finger's
  joints; the direction in normalised units (a 16:9 diagonal point turns
  from left to up); `mergeHands` overwriting an anchored event.
- **`tests/handsSmooth.test.ts`** (H5's script): at rest the filtered tip's
  jitter, in palm-size units, is below the raw; with `beta` above 0 the
  cutoff rises with speed; values are divided by the palm's size before
  filtering (the same track at twice the size gives the same result in palm
  units); forward-backward has no net lag on a symmetric ramp and less lag
  on a fast point than the causal pass; state reset per event. Mutations: no
  palm-size scaling; the backward pass dropped; the derivative cutoff used
  for the signal; state carried across events.
- **`tests/handsAnchor.test.ts`**: `tipOnFrame` through a followed 9:16 crop
  of a 16:9 clip (a tip at source x 0.7 lands where `sourceToFrame` puts a
  small box there), null when the tip leaves the output frame;
  `pointPlacement` per direction, places the body once, at onset, in the
  free third on the pointed side with the hand's box as an obstacle;
  rule 11 (`anchorValid`), each clause; `anchorProposals` one per event,
  none off screen, none on a clip with `pointing` off; a hand track of
  another version or size ignored for new proposals while kept anchors keep
  their events. Mutations: the crop skipped (fit only), or the tip unmapped;
  the tip passed as a zero-size box (null on every frame); the body
  re-placed per frame; a hold beyond `HAND_HOLD_MS`.
- **`tests/graphicPlace.test.ts`**, phase 4's case: the hand's box an
  obstacle beside the face's. Mutation: the hand's box ignored.
- **`tests/sidecar/test_hands.py`**: `parse_spec` accepts `{"mode":
  "hands"}` with its ranges and still refuses an unknown mode, a rate that
  is not a whole multiple of the faces' and an unequal edge; `hands_of`'s
  clamp, 4 dp, two largest first; the writer's rename; `HANDS_RAW_VERSION`
  held equal to the helper's. It runs inside
  `tests/integration/sidecarMedia.int.test.ts:65-88`'s `unittest discover`,
  which requires each file to run tests of its own and lets only "numpy is
  not installed" skip, so it imports neither mediapipe nor numpy at module
  level (CI's bare interpreter has neither). Mutations: `parse_spec`
  refusing `hands`; the clamp removed; the order reversed; `fps` 0 accepted.
- **`tests/integration/hands.int.test.ts`**: with `FORGE_HANDS_WORKER_FAKE`
  the raw track's samples are in source ms, monotone, versioned and keyed by
  `size:mtime`, in the upright frame of a turned clip; through the helper's
  `vision.faces` with `hands`, **the face track with hands on is equal byte
  for byte to the faces-only track**; a cancel leaves no worker, no ffmpeg
  and neither partial; `vision.handsModel` answers without fetching; with
  `FORGE_HANDS_REAL=<clip>` it writes `tests/output/hands/real/README.txt`
  (the spike's tables). Mutations: samples by analysed-frame index instead of
  ms; the cache key without mtime; the face detector run on every hands
  sample (the face track differs).
- **`tests/renderer/pointingToggle.test.tsx`** (added 2026-10-21): the
  switch's states as the table above; 7,819,105 B reads "Get the hand finder
  · 7.8 MB". Mutation: `formatBytes` ("7 MB").
- **Existing**: `tests/helperPackManifest.test.ts`,
  `tests/integration/sidecar.int.test.ts` (the optional methods; the groups
  held equal), `tests/integration/reframeJob.int.test.ts` (a hands ask
  fails `model-missing` without the model; H12 by the stage clock),
  `tests/renderer/bridgeMethods.test.ts`, `tests/uiCensus.test.ts` with
  `tests/fixtures/ui-census.json`. Mutation: `vision.handsModel` left out of
  `OPTIONAL_METHODS` or `capabilities/__init__.py:40`.
- `graphic.int`'s phase-4 case, the hand render check, is §6.11's.

**Measurements.** **H11** (the raw cache and the reduced event list, `wc
-c`, per minute of footage, node), and **H12 again** through the job's own
stage clock (`FORGE_REFRAME_REAL=<file> npx vitest run
tests/integration/reframeJob.int.test.ts`); both to EFFECTS §62. If H8 found
the onset more than 3 frames off at ten a second, the rate goes to 15 (H2
prices it); a dense re-pass round each onset is not planned.

The exit is §6.12's phase 4.

#### Days

| item | days |
|---|---|
| the worker's hands on a shared decode, the raw writer, the version | 1.25 |
| the AI helper's `vision.handsModel`, constants, cache path; protocol, self-test, `expects`, `__init__` | 0.75 |
| main: the analysis's hands ask, the reduction, the collect, the press, IPC, preload | 0.75 |
| `src/shared/hands/` hardened: rules, merge, smoothing, `tipOnFrame`, `pointPlacement`, `graphicTargetsAt`'s branch | 1 |
| the anchored callout: rule 11, proposals, the callout's branch, moving frames | 1 |
| the switch, the press, the store, census, degraded modes, `graphic.int`'s case, H11, H12, the held-out exit | 1.25 |
| **phase 4** | **6** |

### 6.19 The build order, the phases and the days

Each phase is built as step 2 was: lanes that can run in parallel, then
verifiers, then a fix phase, all inside the phase's days. Days are effort,
not calendar. Every lane's work lands as its own commits, each green
(typecheck and the full suite, written to a file, `$?` checked) before the
next lane depends on it. The lanes split each section's days as its own
piece table does (§6.3's, §6.16's, §6.17's, §6.18's).

| phase | lane | builds (§) | days | needs first |
|---|---|---|---|---|
| 0 | one | 0.1 M4's case; 0.2 `graphicCheck.ts`'s measuring half with `encodeFrames`; 0.3 the libass reference and M21's case; 0.4 the runs and the record (§6.15) | 2 | — |
| 1 | head, serial | the §16.8 rename as its own commit (0.25 of §6.1); then all of §6.1's types in one commit (`template.ts`'s types, the `timeline.ts` fields, `GraphicsSettings`, `GraphicProposal`, `MediaAsset.speaker`, `Clip.forGraphic`, the (box) field, and the seam's `GraphicCandidate`, §6.7, and `KeptGraphic`, §6.6, declared in `template.ts`), so `Clip.graphic` exists before anything reads it (the other 0.25 of §6.1); then `SELF_DRAWN_FIELDS`, the five list sites and `graphicGuards`' head half, the behaviour over the constant and the regex, with the membership rewrites of `paper.test` and `moment.test` (0.75 of §6.4) | 0.25 + 0.25 + 0.75 | phase 0's exit |
| 1 | outside the days, serial | §6.20's two halves, each its own commit: D8's (`shapedScript` and the captions' fix) and D10's (the Noto files, `INDIC_FONTS`, the scan, the renderer's font sites, the CI check) | (§6.20's 1) | the head |
| 1 | A | `motion.ts` with `graphicMotion` (§6.13); `stroke.ts` with `graphicStroke` (0.5 of §6.3); `style.ts`'s first half with `graphicStyle` (§6.5) | 1 + 0.5 + 0.5 | the head |
| 1 | B | `drawList.ts`, `items.ts` (`DrawOut`, `unitFor`, `CLUSTER_SCRIPTS`, the drawer seam), `templates/index.ts` with `graphicDrawList` (1 of §6.3); `paint.ts` with its `PaintOptions` and `graphicPaint` (0.75); `frame.ts` and `targets.ts` with `graphicFrame`'s first half (0.25) | 2 | the head; §6.20's two halves (`unitFor` reads `shapedScript`; shaped text items name `INDIC_FONTS`); M3 for `CLUSTER_SCRIPTS`; A's `stroke.ts` before `paint.ts` |
| 1 | C | `graphicCanvas.ts` (preview, bake, frames; the worker back-end only if M2 asks) (0.75 of §6.3); the export branch with its own catch line, `Bakers.graphic` and every literal of §6.11, `exportBakers.ts`, the store's `addGraphicClip`, `setGraphic`, `rebakeGraphic`, the trim and split rules, Preview's branch and sweep, (box) `identityPlaced`, with `graphicStore` (0.5); the three store arms (`rebakeGenerated`, `placeCopies`, `rebakeFollowed`) and `graphicGuards`' wiring half (0.25 of §6.4) | 1.5 | B's draw list and painter; M1 and M2 |
| 1 | D | the harness's `primitives` and Indic halves (0.25 of §6.3); `pathLength`, `strokes` widths, `graphic.int`'s phase-1 cases, `SHAPES`' graphic overlay (§6.11's half) | 0.25 + 0.5 | C; §6.20's D10 half |
| 2 | T3, first | the typed stub of `applyGraphics` (`KeptGraphic`, the signature, §6.6), committed before T2's wiring starts | inside T3's 3 | phase 1's exit |
| 2 | T1 | `GRAPHIC_TEMPLATES`' values first (the others read the field modes), then the layout, the eight draw files, `numbers.ts`, `tree.ts`, with `graphicFrame`'s second half, `graphicHolds`, `graphicTree` (§6.2); the style's second half (§6.5) | 4 + 0.5 | phase 1's exit; M21 before the counter |
| 2 | T2a | `claims.ts`, then `validateGraphics.ts` with `checkGraphicData`, `claims` and the property test (§6.7) | 3 | T1's values |
| 2 | T2b | `schemaGraphics.ts`, `promptGraphics.ts`, the ask's fix with `directorAsk`, `run.ts`'s `graphicsMenuFor`, `settleGraphics` and `decisionForGraphics`, Direct's and the tile's wiring (Clip it's is step 4's), `TranscriptGraphics.tsx`, `GraphicPanel.tsx`, the store's actions but `setGraphicSounds`, with `directorGraphics`, `transcriptGraphics`, `graphicPanel` (§6.6) | 2 | T2a's validator; T3's stub |
| 2 | T3 | `beats.ts` with `graphicBeats` (§6.8); `place.ts` (with `freeSpace.ts`'s `samplesOver`) and `budget.ts` with `graphicPlace`, `graphicBudget` (§6.9); `sound.ts` (`GRAPHIC_SOUND_FILES`), `graphics/apply.ts` (`applyGraphics`, `lowerThirdFor`, `clearGraphics`), `director/apply.ts`'s constants, sweep and return, the store's follow-on edits (`removeClip`, `moveClip`, `moveSelectionTo`, `pasteClipboard`), `setGraphicSounds` and the switch, with `graphicSound` and `graphicStore`'s phase-2 cases (§6.14) | 0.5 + 1 + 1.5 | T1's values |
| 2 | T4 | the baseline and the eval block, the fixtures read, M14's and the look rating's runs (§6.10); the harness's `templates`, `curves`, `look` and per-template Indic options, `graphic.int`'s phase-2 cases, the property test's wiring (§6.11's half) | 1.5 + 0.5 | T1-T3 |
| spike | H | §6.17's pieces: the worker's `hands` mode, `hands/types.ts`, `events.ts`, `oneEuro.ts`, `anchor.ts`'s `tipOnFrame`, the cases §6.17 lists; your runs | 1.5 | your footage; runs during phase 2 (nothing of phases 1-2 is needed: `sourceToFrame` through the reframe exists) |
| 3 | depth | §6.16, split as its day table writes; M7 first, on the glow seam | 5 | phase 2's exit; M6's phase-0 parts |
| 4 | depth | §6.18, only if the gate passed | 6 | the gate (§6.12) |

The sums: phase 1, 1.25 + 2 + 2 + 1.5 + 0.75 = 7.5; phase 2, 4.5 + 3 + 2 +
3 + 2 = 14.5. (Revised 2026-10-21 by the review: the first table put
`Clip.graphic`'s types in lane B after the head had used them, and
`graphicGuards`' wiring cases in the head before lane C wrote the wiring;
neither could commit green.)

**What the measurements gate.** Lane B's `unitFor` waits on M3; lane C's
bake region and pool on M1 and M2; §6.5's entrance list on M5; phase 3's
colour setup on M6 (phase 0) and its glow on M7 (phase 3's first day);
phase 2's counter on M21. M22 gates phase 1's text work as §6.15's M22 row
says. M4 gates nothing in step 3: nothing probed is emitted.

**Where §6.20 falls.** Outside step 3's days, inside phase 1's run:

- **D8's half** (the captions' per-word fallback, and `shapedScript` in
  `render/textAnimation.ts`): first after the head, before lane B, because
  `unitFor` reads `shapedScript`. Its own commit, so a revert of either
  leaves the other.
- **D10's half** (the two Noto fonts, `INDIC_FONTS` and the rest of §6.20's
  font work): also before lane B, because lane B's shaped text items name
  `INDIC_FONTS` and lane C's bake awaits them; so it lands long before lane
  D's Indic render check, which needs the files. In phase 0 instead if M22
  finds a font cause (§6.15).

**The days.** Step 3 is 30.5: phase 0's 2, phase 1's 7.5, phase 2's 14.5,
the spike's 1.5, phase 3's 5; that is §6's 14.5, 2 moved from step 6, and 14
new (9.5 in phases 0-2, the spike's 1.5, 3 in phase 3). Phase 4's 6 are in
no total until the gate passes (36.5 with it). §6.20's 1 day is counted in
§2 beside the steps. Days that read tight, figures kept: §6.2's 4 for nine
draw files and their layout; §6.6's 2 (less tight now that Clip it's
wiring is step 4's); the screen card's 1.25 in phase 3; §6.20's D10 half,
which may run to 0.75 with the `.gitignore` change, the pack-root listing,
the catalogue's version, the CI check and the renderer's font sites.

### 6.20 Outside step 3's days: the captions' per-word fallback (D8) and the Indic fonts (D10)

**1 day, counted outside step 3, in §2 beside the steps; §6.19 places both
halves inside phase 1's run.**

**D8's fix · 0.5 day.** D8, §16.61: "Per word by default everywhere; per
cluster only for scripts M3 clears. And a separate small fix, outside step
3, so the captions' `bounce` and `wave` fall back to per-word animation for
Indic scripts, mutation-checked."

- **The defect.** `bounce` and `wave` have `scope: 'char'`
  (`textAnimation.ts:125-142`), and `piecesOf` splits that scope with
  `Array.from` (`:242-246`), so each code point is drawn on its own by
  `paintAnimated` (`textPaint.ts:459`, the split at `:472`): a Devanagari
  conjunct's consonants are painted apart, with its virama, and an i-matra
  away from the consonant it precedes. The same split counts the pieces that
  time the movement (`textCanvas.ts:132-136`, `captions/bake.ts:67-73`), so
  the fix in `piecesOf` reaches every caller.
- **`shapedScript(text: string): boolean`** in `render/textAnimation.ts`:
  true when the text holds a code point of a script whose letters join or
  reorder, by Unicode script property: the ten Indic scripts (Devanagari,
  Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam,
  Sinhala), and Arabic, Syriac, Thai, Lao, Tibetan, Myanmar and Khmer
  (proposal; the tests pin membership, not the list). **The seven
  non-Indic scripts extend D8**, which named Indic scripts: they join or
  reorder their letters too, so splitting them by code point breaks them
  the same way; recorded here for you to narrow if you want D8 as worded.
  Graphics read it too (§6.3's `unitFor`): one script rule for the
  captions' fix and the engine.
- **The fix.** `piecesOf(text, 'char')` returns the word pieces when
  `shapedScript(text)`, and `Array.from(text)` otherwise; a mixed line falls
  back whole. The accent mapping (`textPaint.ts:491-510`) needs no change:
  under `char` scope it counts words by the gaps between pieces (`:505`),
  which holds when the pieces are words.
- **Tests.** `tests/textAnimation.test.ts`: a Hindi and a Telugu line under
  `'char'` give the same pieces as under `'word'`; `'ab c'` still gives
  `['a', 'b', ' ', 'c']` (the case at `:164`); `shapedScript` is true for
  Devanagari, Telugu and a mixed line, false for Latin and Cyrillic.
  `tests/textPaint.test.ts`, with its fake context (`:24-46`): a Hindi line
  under `bounce` at a mid frame draws only whole words (each `fillText`
  string one of the line's words), and an accent on word 1 lands on the
  second word's call. Mutations: `Array.from` restored for shaped text (both
  files fail); `shapedScript` returning false for Telugu.

**D10's fonts · 0.5 day.** D10, §16.63: "Decide `BETA.md` R14, bundling Noto
Sans Devanagari and Noto Sans Telugu (both OFL), before phase 1's Indic
render check." `BETA.md` R14 recommended bundling them "and
have a Hindi or Telugu transcript's captions name them, so both platforms
draw the same letters", half a day with a render check on both builds; that
half day is R14's own, pulled forward and counted once, here.

- **Where the files live (chosen 2026-10-21): committed, under
  `assets/fonts/`.** Two fonts, `NotoSansDevanagari-Regular.ttf` and
  `NotoSansTelugu-Regular.ttf`, each with its OFL text beside it,
  `OFL-NotoSansDevanagari.txt` and `OFL-NotoSansTelugu.txt`: four tracked
  files, one licence file per family, as `BETA.md` R6's test asks ("a
  licence file beside every family"). The copies Tor Browser bundles, read on this
  Mac 2026-10-21, are 244,284 B and 235,176 B; the build fetches the files
  from the Noto project's own release and records their sizes and sha256 in
  EFFECTS §61. Committing them is what lets CI's libass and the harness see
  the same faces as a user's machine: `/assets` is gitignored
  (`.gitignore:28`), so CI has drawn every Indic caption in a system
  fallback, and the Windows runner has never said which. They must sit in
  `assets/fonts/` itself, because libass takes one `fontsdir`
  (`plan.ts:1930`, from `fontsDir()`, `src/main/captions.ts:28-35`, which is
  the app's own `assets/fonts` in development and in a packaged app, even
  when an asset pack is installed). So `.gitignore`'s `/assets` becomes
  `/assets/*`, `!/assets/fonts/`, `/assets/fonts/*`, and four negations for
  the four files; the local library keeps its 88 files untracked, and the
  installer packs the folder as today (`electron-builder.yml:59-63`). The
  asset pack keeping them instead would leave the repo smaller by about half
  a megabyte and CI blind, which is the reason for the change. Measured in
  the commit: `git ls-files assets` lists exactly the four files, and `git
  check-ignore` still ignores `assets/fonts/Anton-Regular.ttf`.
- **The symlink, checked first.** The comment above the rule
  (`.gitignore:25-27`) says `/assets` is "currently a symlink" to the
  library. On this Mac it is a real directory (`ls -la`, 2026-10-21), but
  git cannot track a path beyond a symbolic link, so a checkout where
  `assets` is a link would refuse the commit or the pull. Before the commit,
  `assets` is checked on the Surface's checkout too (`dir assets` shows
  `<SYMLINKD>` or `<JUNCTION>` for a link); if either machine has a link,
  it is replaced by a real folder, a copy of the library, before the
  commit. The comment is rewritten to say what is true, and the check is
  recorded in the commit message.
- **Found whichever folder the catalogue scans.** The canvas loads a face
  from the catalogue (`ensureFont`, `renderer/src/catalog.ts:140-193`), and
  the catalogue scans `assetsRoot()`, which is the pack root under
  `userData` once a pack is installed (`src/main/assets/scan.ts:163-169`,
  `packs.ts:39-41`), not the app's own folder. So main's scan also lists the
  two font files from `fontsDir()`'s folder when that folder is not the
  scanned root's `fonts/`, as absolute paths, which `assets:fontData`
  (`src/main/ipc.ts:675-682`) already reads: its `resolveAssetFile` takes an
  absolute path as it is (`scan.ts:406-414`). Without it, every machine with
  a pack installed, the beta's case, would draw Hindi and Telugu graphics in
  the system's face while libass drew Noto.
  - **`fontsDir()` moves** out of `src/main/captions.ts:28-35`, where it is
    private, into `src/main/fontsDir.ts`, exported unchanged
    (`FORGE_FONTS_DIR` first, then the packaged or the development
    `assets/fonts`) and reading Electron's `app` only inside the call;
    `captions.ts` and `scan.ts` import it. The tests' electron stub has
    `isPackaged` and `getPath` only (`tests/stubs/electron.ts:5-15`, no
    `getAppPath`), so the test sets `FORGE_FONTS_DIR`, as
    `m0Exit.int.test.ts:872` does.
  - **The catalogue's version is bumped** (`CATALOG_VERSION`,
    `assets/catalog.ts:158`, 2 to 3) in the same commit: the scan reuses a
    cached catalogue while the version and the root are unchanged
    (`scan.ts:386`), so a machine scanned before this change would keep a
    catalogue without the Noto entries and record "not in the catalog".
  - **Tested** in `tests/integration/assetscan.int.test.ts`: `scanAssets`
    on a temporary pack root holding no Noto files, with `FORGE_FONTS_DIR`
    set to a temporary folder holding the two names, lists both families;
    a cached catalogue of version 2 for the same root is scanned again and
    lists them. The existing case's `entriesOfKind(catalog,
    'font')).toHaveLength(3)` (`:39`) becomes membership (the three fonts
    in, `notafont.txt` out), since the extra listing makes the count 5.
    Mutations: the extra listing removed; the version bump reverted (the
    cached case fails).
- **Regular only.** The font loader registers one `FontFace` per family,
  from the first catalogue entry for it, with no weight descriptor
  (`renderer/src/catalog.ts:160`, `:173`), so a Bold file beside it would
  not be read; heavier weights are synthesised by Chromium, as for every
  one-file family in the library. M22's frames record how they look.
  Registering weights is outside this step.
- **The canvas route.** `INDIC_FONTS = ['Noto Sans Devanagari', 'Noto Sans
  Telugu']` in `render/textPaint.ts`, placed in `fontString`'s chain
  (`:286-291`) after the clip's own faces and before `sans-serif`, so a
  caption or a text clip falls back to them on both systems instead of
  whatever each resolves. Graphics name them directly for shaped items
  (§6.3). A family in the chain resolves only once its `FontFace` is
  registered, which `ensureFont` does (`renderer/src/catalog.ts:140-193`),
  and the two are not installed on macOS or Windows by default. So
  `indicFontsFor(text: string): string[]` (pure, `textPaint.ts`: the
  `INDIC_FONTS` faces whose script the text holds) is called, and each face
  it returns is ensured and counted in the readiness check, at every site
  that ensures a text face today:
  - `textCanvas.ts`: the bake's `ensureFont(spec.font)` (`:39`, `:174`),
    and the preview's readiness check and its warm-up (`:113-116`);
  - `captionBake.ts:111`, beside the caption families;
  - `Preview.tsx`: the caption font effect (`:446-449`), over the caption
    track's words, and the text-clip font effect (`:471-485`), over each
    text clip's content;
  - graphics: `bakeGraphicSequence` and `graphicPreviewCanvas` (§6.3).

  `tests/textPaint.test.ts` holds `indicFontsFor`'s membership (Hindi
  gives Devanagari's face, Telugu Telugu's, Latin none); mutation: a site
  left without it is caught by the harness's Indic frames, drawn through a
  text clip and a caption as well as a graphic (§6.11's `indic` option).
- **The libass route.** In `captions/ass.ts`'s per-word blocks (`:202-210`),
  a word whose text holds Devanagari or Telugu carries `\fn` naming its
  script's face, and every other word of the same event carries `\fn` naming
  the style's own face, so the override never leaks to the next word.
  Poppins' and Teko's partial Devanagari (`BETA.md` R14) stays as it is
  for Latin-faced captions that name them.
- **The render check, on both builds.**
  `tests/integration/captions.int.test.ts`'s Indic case (EFFECTS §51; it
  already passes `assets/fonts` as `fontsdir`, `:226-227`) keeps its bar,
  the app's frames equal to the complex shaper's, and now prints, as a
  notice readable without signing in (as `captionsFree.int`'s are), whether
  complex differs from simple on the Windows runner, with Noto Sans present
  there: that line is the first answer to whether the 2018 build's libass
  has HarfBuzz (EFFECTS §51 left it open). `tests/captions.test.ts` holds
  the `\fn` tags (a Hindi word names Noto Sans Devanagari, the Latin word
  after it names the style's face). The canvas half is the harness's (M22
  and phase 1's Indic render check, §6.11), since painting needs a DOM
  canvas. `tests/textPaint.test.ts` gains the font-chain case, `INDIC_FONTS`
  in `fontString`'s output before `sans-serif`. Mutations: the chain without
  `INDIC_FONTS` (the font-chain case fails, and the harness's Indic frames
  fall back to the system face and differ from the named ones); the `\fn`
  dropped from the Latin word after a Hindi one (`captions.test` fails); the
  files removed from the folder (the Windows notice and the Mac frames
  change).
- **A risk to read on the first push.** With Noto Sans Devanagari in the
  `fontsdir` on CI, libass may pick it, by glyph coverage, as the fallback
  for Latin captions whose face is absent there (Anton on CI), where the
  system's face was picked before. The libass render checks were written to
  tolerate any fallback face (EFFECTS §60), so they should hold; the first
  run's `captionsFree.int` and `captions.int` notices are read before
  anything else lands on top.
- **CI's warning about an empty library would go silent.** The step "Say
  whether the asset library is in this build" (`.github/workflows/ci.yml:380-387`,
  its reason in the comment at `:374-379`)
  calls any non-empty `assets/` "Asset library present", so four tracked
  files under `assets/fonts` would silence the `::warning::` that exists to
  say the installer ships with no SFX, transitions, titles or props. In
  the same commit the check looks for the library itself, `assets/sfxx`
  (where the Director's sounds live, §6.14), and the warning's text says
  the installer carries only the two Noto faces. The CI-built installer
  carries `assets/fonts` with those four files where it had none.
- **A gap found, outside this step.** libass's `fontsDir()` names the app's
  own `assets/fonts` whether or not a pack is installed, so on a
  pack-installed machine libass never sees the pack's faces; a `BETA.md`
  row for it is proposed, not written by this revision.

### 6.21 What this revision edits elsewhere

The re-plan of 2026-10-21 changed these places outside §6, in the same
edit, so the file agrees with itself:

- **The status note at the top**: a paragraph saying step 3 was re-planned,
  30.5 days in five phases plus a gated 6, nothing of it built.
- **§2, the order and the days**: step 3's row (what the research changed;
  30.5, was 14.5) and step 6's (5, was 7); the total paragraph (89.5 in the
  steps, 90.5 with §6.20's day, 100-103.5 with Step P, 106-109.5 with phase
  4); a second delta table for the re-plan; a third row of the days table,
  "after 2026-10-21", and its check line; the milestones M2 (~30.5) and M5
  (~12.5) and their sum (89.5); step 4's start, 16 days later; "Steps 5-7
  (about 23.5 days now)"; and "Your part": step 3's measurement and spike
  rows, the graphics fixtures' hours (§6.10), and the total hours.
- **§3a's day count**: the line that put §2's total at 85-88.5 notes the
  re-plan's 100-103.5.
- **§8.4**: the social quote card's files are `templates/quote.ts`'s
  `social` branch and `components/GraphicPanel.tsx`, where §8.4 said
  `graphics/paint.ts` and `tools/GraphicPanel.tsx`.
- **§9**: the heading (5 days) and the 3D half (2 days: `timeline`,
  `before-after` and `versus` on the draw list; the 2.5D `counter` and
  `ring` built here in phase 3).
- **§13**: step 3's rows (nothing new emitted; the M4 probes listed
  "probed, not emitted"; the measurement-only shapes).
- **§14**: the WebGL row reworded for phase 3; new rows for no subject
  track, no sound for a graphic, an Indic font missing, a screen card's
  recording frames, the hand finder, and a hand track of another version;
  the AI helper's row names the dim and pointing; the unbakeable graphic's
  row names the screen card's keys.
- **§15**: rows 9 and 20 point to M1, M2 and M6; rows 39-73 by pointer to
  §6.15.
- **§16**: decisions 54-65, D1-D12 of the research, each answered as
  recommended on 2026-10-21.
- **§18**: step 3's phase exits and the spike's gate.
- **`BETA.md` R14**: its days (2.5 to 4.5) and its fonts sentence (decided,
  built and counted in §6.20).

**The review of the same day** (three reviewers: the repo, fidelity to the
research and the answers, and buildability) changed, outside §6: §2's M2
line (2.5D on each clip's hero, a proposal of the plan's) and "Your part"
(M7 off phase 0's row; the look rating beside M14, 2 h; the total 38-43);
§9's `kinetic-type` lines; §14's degraded-pack row ("N of 9", 10 with phase
4); §15's pointer (M7 in phase 3); §16.65's answer line (the two readings of
D12); and `BETA.md` R14 (four files, one licence per family).

Not re-pointed: every reference to §6.1-§6.12 elsewhere in this file, since
those numbers keep their topics. Not edited by this revision, and left for
the commits that build them: `PLAN.md:1172-1180` (pointed to §6.4 by the
commit that lands `SELF_DRAWN_FIELDS`), `EFFECTS.md` §61 and §62 (opened by
phase 0 and the spike), `WHERE-THINGS-ARE.md` and the census (each phase's
exit), `LLM.md` §Built (phase 2's exit), and `.github/workflows/ci.yml`'s
asset-library check and `.gitignore`'s `/assets` rule and comment (changed
by §6.20's fonts commit).

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
`social` branch of `graphics/templates/quote.ts`'s draw function (§6.2;
the 2026-10-05 text said `graphics/paint.ts`, which is now the painter that
draws every list, §6.3); `components/GraphicPanel.tsx`'s fields for the kind
(§6.6), with **Surprise me**; **Add a social quote** in the
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

## 9. Step 6 — Retrieved-fact cards and the 3D templates · 5 days (Brave's 1 out; the 2.5D counter and ring moved to step 3, §16.55)

> **Revised 2026-10-21 (D2, §16.55).** The 3D half falls from 4 days to 2.
> Step 3's phase 3 (§6.16) builds the compositor (painter B on the shared
> renderer), its disposal, the WebGL-missing path, the flat-colour and edge
> measurements (M6), and the 2.5D `counter` and `ring`. What stays here is
> three templates on that same draw list. The retrieved-fact cards below are
> unchanged.

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

**The 3D templates** (2 days, was 4): `timeline`, `before-after` and
`versus`, each a draw function in
`src/shared/graphics/templates/{timeline,beforeAfter,versus}.ts`, built only
from §6.3's item kinds and §6.13's motion, as phase 2's templates are:

- **Flat by default**, through painter A. `TemplateDef.threeD` is true for
  all three, so the dock's Depth choice offers §6.16's four variants
  (`tilt`, `parallax`, `dolly`, `focus`) through painter B, set by you only,
  settling flat on the last beat.
- **Fields and pairs** as §6.1 types them; §6.7 rule 6 binds each pair as it
  binds a `bars` item (`before` and `after`; `left` and `right`; each
  `timeline` item's `when` and `label`), in spoken order, as rule 6 already
  says of them ("later `before-after`, `versus`, `timeline`"). The menu, the
  schema, the fixtures (English, Hindi and Telugu, yours) and the eval take
  them as §6.6-§6.10 take the nine shapes; the baseline does not.
- **`before-after`'s reveal** is the "after" panel's box growing over the
  "before" (a `shape` item's box on §6.13's curve), so no mask kind is
  needed.
- **Type is drawn with `drawTextOnto` into a `CanvasTexture`**, unchanged:
  painter B's planes are painter A's canvases (§6.16). Measured, as before:
  three 0.186.0's `TTFLoader` imports opentype.js from `cdn.jsdelivr.net` at
  runtime, and `TextGeometry` needs typeface JSON fonts the catalogue does
  not have. **`three-text`** (MIT, 0.6.5, HarfBuzz through `harfbuzzjs`,
  self-described alpha) is watched, not used: its README names no Indic
  script, and it is tried on the EFFECTS §51 clusters before it is ever
  trusted (the research, §4.7). Meshes that are not planes (ribbons,
  extruded shapes) are not in step 6.
- **Disposal and the one renderer** are §6.16's (`sized()` before every
  render, disposal on rebuild, supersede, bake end and clip removal, never
  as the carousel's undisposed scenes, `carouselCanvas.ts:128-141`, §17):
  nothing in this step makes a scene of its own.
- **The `kinetic-type` stub stays a stub.** It is still drawn as a depth
  push (`moment.ts:30`, `:35`, `:227-228`; `momentCanvas.ts:401`) and still
  refused by the Director (`director/apply2.ts:393-396`); `MomentKind` keeps
  it (`timeline.ts:290`, `director/recipes/types.ts:24`). Kinetic type in
  short-form clips is step 3's `keyword` and the captions' own entrances. A
  headline the camera passes (`PLAN.md:1209`) would be word planes with a
  dolly on the same compositor, costed when `PLAN.md`'s gate for it opens
  (`PLAN.md:1420`), not in these 2 days. (§9 as written said the 3D
  templates replace the stub, and so did the research, its §4.7; this
  paragraph's reasons are why it departs from both.)

**Measure in the harness:** step 3 measured the flat colour and the
semi-transparent edge through three.js (M6, phases 0 and 3, EFFECTS §61).
This step runs `await window.__forgeGraphicCheck({ parity: true, templates:
['timeline', 'before-after', 'versus'] })` over its own three, flat and with
each depth.

The tests and render checks are §6.11's, extended per template.

**Exit:** each of `timeline`, `before-after` and `versus` passes step 3's
phase-2 bar (§6.12: the property test over its text items, the render check
frame-exact at both shapes on both builds, preview equal to export within
1/255) flat, and its phase-3 bar with each depth variant (its settled frame
equal to its flat frame, its text items unchanged by depth, flat with the
note when WebGL is missing); the answer card never ships a sentence that is
not a verbatim run of one fetched text (property test); no fetched number
lands on a spoken beat (a test over every template's placement).

| item | days |
|---|---|
| the retrieved-fact cards (above) | 3 |
| the three draw functions, their pairs, menu, schema and fixtures | 1.5 |
| their depth variants and the harness run | 0.5 |
| **step 6** | **5** (was 7; the 3D half 2, was 4) |

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
nothing. **Step P's build is complete (2026-10-14/16, §3a):** the pack is
166 MB to download on the Mac and 201 MB on Windows, pressed from Settings;
each Python control is greyed by its own method, and every "needs the AI
helper" points at that one Install. §3a.9's exit runs remain.

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
appear in `degraded` there (§4.9). The pack's version is CPython 3.14.8
(§16.36, §3a.1). mediapipe 0.10.35's two wheels are `py3-none`, with no
Requires-Python, so its tags say nothing about the Python version (this
text first said "supports 3.12–3.14 by wheel tags"; corrected 2026-10-16,
§3a.10); 0.10.35 **ran on 3.14.6** on the user's Mac (§4.1), and its
library loads on the pack's 3.14.8 (the self-test's faces group, every
install since 2026-10-14); 1.0.1 is unmeasured.

**A Windows-only gap.** Capability integration tests gate on
`.venv/bin/python` and so have never run on Windows (`vision.int.test.ts:22-24`).
§4.9's `venv.ts` fixes that; Windows still needs a venv on the Surface
(`CLAUDE.md`'s fresh-checkout table: `FORGE_PYTHON`, the Store alias trap).
**Since slice C (2026-10-16)** CI installs the pack on its Windows runner
and runs `sidecar.int`, `sidecarMedia.int`, `vision.int`, `beats.int`,
`faces.int` and `reframeJob.int` from inside it through `FORGE_HELPER_PACK`
(§3a.6); the first such run is the next push.

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
| ASS per-event `{\anN}` and `MarginV` via `subtitles` (as built, `buildRenderPlan`'s `ass=…:shaping=complex` burn) | step 2 (`buildAss`, built 2026-10-16) | core ASS / libass | **built**; measured on the Mac, by a bare `ass=` and through `buildRenderPlan`'s burn (`EFFECTS.md` §60): Pop moved to the top or the bottom renders on exactly the rows of Pop placed there, `\an5` ignores MarginV, and a cue is first drawn on ceil(its centisecond time × fps / 1000) at 24, 25, 30 and 60 fps. **Dated** for Windows: rendered there in run 38986994729, which failed on an unmoved line's reading under the runners' fallback face (`0c08569`); `captions.int` and `captionsFree.int` read moved lines from the run on `fb65a18`'s push |
| `overlay` of a PNG sequence at the clip's place (`x` and `y` from `clipBox`, `plan.ts:456-482`, written at `:1921`), `format=yuva420p` (`:1484`), `tpad=stop_mode=clone` (`holdFilter`, `:906-909`), `-start_number 0 -framerate` (`:1096`) | step 3: every graphic, from either painter, the 2.5D variants and the screen card's moving frames | 2010 / Oct 2018 | in CI (moments, captions). **Nothing new is emitted by step 3** (2026-10-21): a box bake, if M1 picks it, lands through the same overlay `x` and `y`, the plan reading `MediaAsset.frames.box` for a clip placed at the identity (§6.3); the screen card's hold is the recording's own clip under two opacity keys; graphic sounds are audio clips on the existing mix with `adelay` in samples. A graphic's PNG sequence joins `SHAPES` in `tests/oldestFfmpeg.test.ts` all the same |
| opacity keys (`geq` on alpha) | step 3 exits, and the screen card's hand-off | 2014 | in CI |
| `tmix`; `overlay`'s `alpha=premultiplied`; `perspective` | **not emitted.** Later options only: `tmix` for motion blur if phase 2's ratings ask for it; `alpha=premultiplied` for a raw RGBA path only if M1-M2 fall short (M11); `perspective` as the screen card's ffmpeg alternative | `tmix` listed under 4.1 (released 2018-11-06); `alpha=premultiplied` committed 2017-12-16; `perspective` 2.1 (the research, §6.3) | **probed, not emitted**: M4's case prints each one's `-h filter=` on both runners (§6.15). On the Mac's 4.4 (2026-10-21) all three are present and `overlay` lists `alpha` with `straight` and `premultiplied`; the Windows build's answer is M4's. One used later goes into `SHAPES` and the `TOO_NEW` scan first; one missing on Windows is struck, not worked around |
| `ebur128` (M18); `-f rawvideo -pix_fmt rgba … -i pipe:0` (M11) | measurements only | — | not emitted in a render |
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
| the Python helper | Follow the subject, Reframe and Smart placement greyed with "needs the AI helper"; crops as they were; captions at the style's place; Best clips over YouTube captions only; graphics over caption tracks only, no `callout`, no dim around the speaker, and no pointing (§6.18); every B-roll picture that may show a person asks | `reframe.int` with the helper refused; `bestClips` without asr; census rows for each greyed control. **The reframe's, as built (slice B):** `reframeJob.int`'s no-helper case (a missing interpreter, and a bare one: `no-helper` before any scene pass, in CI too); `reframePanel` and the census's `reframe-no-helper` rows for Follow the subject and Reframe to 9:16; a followed clip keeps following. **Smart placement's, as built (step 2, §5's note):** greyed with the pointer, or "the AI helper is starting", in `renderer/smartPlacement` and the census (its "needs the AI helper" row under needs `none`); with no subject track every line keeps the style's third on all three routes (`captionPlacement`); a project saved with it on can still turn it off |
| a model not on disk | its Get button with its size; nothing downloads until it is pressed | census rows; a store test that no toggle or phrase starts a download. **The face finder's, as built (slice B):** no Get button of its own — Follow the subject names it, "gets the face finder, 1.1 MB, first time" (its census row), and the press fetches, then analyses; `reframeJob.int`: a job asked without it fails `model-missing` with nothing fetched and no scene pass; `reframeStore`: a phrase is refused before any job |
| the face detector (degraded) | salient, then centre, per shot, with a note. **As built (slice B):** the helper counts as missing (`reframeHelperFrom`), so Follow the subject is greyed "needs the AI helper"; and a shot with no face centres with a note, salient never called (§16.35) | path test "no faces"; `reframeContract` (`reframeHelperFrom`); `reframeJob.int`'s bare interpreter, where `vision.faces` is degraded |
| two people, one of them lost for much of the shot | no two-up: the larger face, with a note | path test "a lost face gives larger" |
| Florence-2 (not downloaded, or over its gate) | the phrase field greyed with its reason; salient covers no-face shots. **As built (slice B):** 1g is not built, so Follow: is always greyed, "following something named is not built yet", and a no-face shot centres (§16.35) | path test "ground absent"; `reframePanel`; the census row |
| no shots found (a single take) | one shot; the path still pans | path test |
| a rotated file whose size disagrees | the track is refused; centred crop; "the file's orientation changed — reframe again" | `faces.int` rotated case |
| a retimed clip | the followed crop is recompiled from the track at read time, so its cuts move with the speed; graphics refuse with a note | `reframeKeys` after `withClipSpeed`, a ramp, `convertFrameRate`, a trim, a split; graphics test |
| no model | graphics from the baseline; Best clips from signals; no B-roll suggestions | each pass's settle test with the fake provider refusing |
| a prose or truncated answer | that pass only falls back; the clip stands | settle tests |
| a graphic that cannot be baked | dropped from the export with a note; the export succeeds (a dropped screen card also strikes its two opacity keys from the recording, §6.16) | `graphic.int` |
| no subject track (no AI helper, Follow the subject not run, or a track of another version) | `callout` not offered (and dropped with rule 9's note, "no subject found to point at", if an answer names one); placement takes the style's third (§6.9); a graphic's dim is drawn with no hole (§6.2, §6.9) | `graphicPlace.test.ts`; `graphic.int`'s no-track case |
| no sound for a graphic (the library pack not installed, or no file for a role) | the graphic is placed silent, with one note: "no sound library is installed — graphics land silent" (§6.14) | `graphicSound.test.ts`' empty-library case |
| an Indic font missing (before §6.20 lands, or where its files are absent) | Hindi and Telugu draw with the system's fallback, the one M22 recorded per machine on the canvas, CoreText's through libass on the Mac, and the 2018 build's unmeasured one on Windows; the graphic is kept, with the note "Hindi and Telugu are drawn in this computer's own font" (§6.3) | `tests/textPaint.test.ts`' font-chain case (§6.20) |
| the recording's frames for a screen card (a steadied clip, the file gone, a pull that fails) | a steadied clip is not offered the card; a pull that fails drops the card from the export with its note and strikes its two keys, so the recording plays from its first frame (§6.16) | `graphic.int`'s phase-3 case |
| the hand finder (phase 4) | without the AI helper, or with a failed faces self-test, the pointing switch is greyed "needs the AI helper" with the pointer to Settings, and anchored callouts already kept still draw from `Project.hands`; with the helper and no model, the switch is greyed "needs the hand finder" beside the press "Get the hand finder · 7.8 MB", and nothing downloads until it is pressed (§0); a pointing ask without the model fails `model-missing` before any work (§6.18) | `reframeJob.int`'s hands case; `pointingToggle.test.tsx`; census rows |
| a hand track of another version or size, or a point off screen at onset, or no free third (phase 4) | the track is ignored for new proposals and the switch says "find the points again", kept anchors keeping their stored events; a point off screen, or with no free third, is not offered (§6.18) | `handsAnchor.test.ts` |
| WebGL unavailable | a graphic that asks for depth, a camera move or a glow (phase 3's 2.5D `counter` and `ring`, the glow, the edge sweep) is drawn flat by the canvas painter, with the note "drawn flat: 3D needs WebGL, which did not start on this computer"; a screen card lands flat with no tilt; step 6's 3D templates likewise draw flat (§9); 2D graphics are unchanged; the export succeeds (§6.16) | `graphicCompositor.test.ts`' WebGL-missing case |
| no Pexels key | the source greyed: "add a key in Settings" | panel test |
| offline | each source's search says so; nothing half-written (staging then rename); Get transcript says so and the start and end fields stay | `webFetch` test; `ingestPanel` component test |
| a number from a YouTube track | the graphic is a proposal, "check the number", until Keep | `directorGraphics` test |
| a link with no captions and no Python | M0: "This video has no captions", the start and end fields as today, Listen to it greyed with "needs the AI helper"; Best clips adds "Best clips needs the AI helper to listen to it" | `ingestPanel` component test (§3b.8); panel test |
| the AI helper's pack, on an installed app (Step P, §3a) | nothing spawned at any caller; a grey "Not installed" with the sized Install; every Python control greyed "needs the AI helper", each a pointer to Settings; the local voice says why; stems split by mid/side | `sidecarService` (spawn never called); the harness check; census rows |
| a pack install stopped part-way (cancel, quit, offline) | verified downloads kept, no receipt, the folder ignored by the order and swept at launch; the next press says "· N MB left" and fetches only that | `helperPackJob`; `fetchFile` |
| a module degraded inside the pack (most likely the Visual C++ runtime) | the pack kept; its controls greyed by method; the row grey, "N of 9 helper features" (the count is `expects.length`, `selftest.ts:119-130`: 9 since pack 2, 10 with phase 4's hand finder, §6.18), naming what is missing, with Check again | `helperPackJob`; `test_selftest`; §15 row 30's run |
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
   - the 2018 build: CI's reframe.int on the push. *(It first ran there in
     run 38919769393, 2026-10-16, on `c7a2a86`: the annotations name two
     failing rows, both slowed VFR rows that lost their last frame to the
     2018 `setpts`' EOF, fixed by `RETIME_TAIL`, `EFFECTS.md` §59. The
     annotations name only failures and the log needs a sign-in, so which
     rows passed and which skipped is the next run's to show.)*
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
   **Re-planned 2026-10-21 as M1 and M2, rows 39 and 40 (§6.15)**, phase 0's
   first runs.
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
    behind the same proxy (§3a.5). **Measured 2026-10-16, Electron's half**
    (`EFFECTS.md` §59): `net.fetch` rejects a `'manual'` redirect and
    leaves `response.url` empty after `'follow'`, so the pack's fetch
    inside the app is `net.request` (`chromiumFetch.ts`, `2664a63`), and a
    dead proxy is named as the proxy. Open: a real proxy, the two model
    presses behind it, and the app's first Install on it (§3a.8).
20. three.js flat colour and edge alpha against the 2D painter (§9).
    **Re-planned 2026-10-21 as M6, row 44 (§6.15)**: its Indic and colour
    parts in phase 0, the whole of it at step 3's phase-3 exit, where the
    2.5D counter and ring moved (§16.55).
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
    EOF the same), and the two-up rows run it in CI on the push. *(They
    were in run 38919769393, 2026-10-16, whose annotations name no two-up
    row among the failures; row 6's note says why that is not yet a
    pass.)*
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
- **Row 27: the Mac's half measured 2026-10-14** (§3a.8, `EFFECTS.md` §58):
  the first real install took 57.2 s (download 6.0 s, unpack and compile
  2.8 s, pip 11.4 s, check 37.0 s), which set the bar to 45 / 5 / 15 / 35;
  `--no-compile` is not worth its 0.29 s at every start. Open: the Surface.
- **Rows 28 and 29: the Mac's figures from that install** (§58):
  675,763,387 B on disk, longest path 161 and directory 107; the first
  hello 11.3–14.4 s. Open: CI's install (28), the Surface's cold hello
  after an install and after a reboot (29).
- **Row 33: measured 2026-10-14** (§58): both hosts serve byte ranges (206);
  github.com's redirect lasts 40 minutes. Not built.
- **Row 34: measured 2026-10-14** (§58): pip 26.2.1 writes the dist-info
  folders one package at a time, so the bar's count works.
- **Row 35: depth's half measured 2026-10-14** (§58): depth's download
  passes without hf-xet. Open: asr's half, with the speech model's press.
- **Row 35: asr's half measured 2026-10-16** (§3a.8, `EFFECTS.md` §59): the
  pinned speech model, 486,212,372 B, fetched in 14.7 s without hf-xet,
  and transcribed with no host. Closed: hf-xet left the lock (pack 2).
- **Row 28: pack 2 on the Mac, 2026-10-16** (§59): 667,495,529 and
  667,609,685 B on disk over two installs, longest path 161 and directory
  107. Open: CI's install, both platforms (the next push).
- **Row 37: the first push's CI measured 2026-10-16** (§3a.8, §59):
  `c7a2a86`'s Windows run 38919769393, red in 9 min 13 s on six tests new
  to Windows, one of them a real loss of a slowed clip's last frame on the
  2018 build; each fixed in slice C. Open: the first run of the pack's own
  CI steps, its minutes and its cache.

**Rows 39–73 are step 3's** (2026-10-21), written in full in §6.15 with the
phase each runs in and what each outcome does: M1–M22 are rows 39–60 (M1 =
39 … M22 = 60) and land in `EFFECTS.md` §61, "Graphics: the forks
measured"; H1–H13 are rows 61–73 (H1 = 61 … H13 = 73) and land in §62,
"Hands: the spike measured". Phase 0 runs M1–M5, M6's Indic and colour
parts and M22, and M21 before phase 2's counter; M8, M9, M13 and M19 run
in phase 1; M10 and M14–M18 in phase 2; M7 first, then M6 whole, M12, M20
and M13 again in phase 3 (M7 moved from phase 0 on 2026-10-21, §6.15); M11 only if M1–M2 fall short; H1–H10, H12 and H13 in the spike;
H11, and H12 again, in phase 4.

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

    **Built 2026-10-16** (§3a.4's note): (a), the hosts sentence under
    Install, Update and a damaged or failed pack's Repair (`be3ae1b`,
    `0537c12`); (d)'s sentence under any running helper (`016f470`). The
    tester guide's half is `BETA.md` R10's.
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

    **Built 2026-10-16** (§3a.4's and §3a.6's notes): Repair names what it
    still has to fetch (`e43d967`); Remove asks with both sizes, the box
    off by default (`dca719c`); the uninstaller's macro under
    `${ifNot} ${isUpdated}` (`aa377f9`), not yet compiled by `makensis` nor
    run through an update.
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

    **Built 2026-10-16** (`739fa55`, `93c6bde`, `ae2be28`, `27aa661`;
    §3a.4's note, `EFFECTS.md` §59): `Systran/faster-whisper-small` pinned
    at `536b0662742c02347bc0e980a01041f333bce120`, its four files
    486,212,372 B, "Get the speech model · 464 MB" in Settings, over the
    pool and in the Transcript tile beside a greyed Transcribe; the load by
    path with `local_files_only=True`; `asr.transcribe` never downloads. One
    difference: the press forwards its progress and has an X, as the face
    finder's does, and is not a row in EXPORT's list ("through the job
    list" contradicted that precedent). Whether it should also be one is
    yours.
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
51. **A pack whose check finds a `sys.path` entry outside it, or a Python
    other than the manifest's** (slice B, §3a.3 "Open, for the user"). Today
    the install reads Done and the problem sits only in the receipt's
    `problems`.
    - (a) **keep the pack, mark the receipt, and the row shows the warning**
      ("the AI helper's Python path reaches outside its folder: …"), with
      Repair offered; the helper runs. The leak is the app's launch or the
      archive, nothing the user can mend, and failing would leave that
      machine with no helper at all;
    - (b) fail the job and remove the pack, as for a helper that does not
      start.

    **Recommended: (a).** `PackCheck.problems` splits into the degraded
    `expects` methods (kept as today) and these integrity problems, so the
    row can name them apart (P-C).

    **Answer (2026-10-16):** as recommended ("go ahead").

    **Built 2026-10-16** (`a3958bf`; the row in `be3ae1b`). `check.ts`
    returns `integrity` beside `problems`. `integrity` holds four
    sentences: "The AI helper's interpreter is outside its folder: <path>",
    "… Python prefix is outside its folder: <path>", "… Python path reaches
    outside its folder: <entry>" and "The AI helper runs Python <x>, not
    <the manifest's>"; `problems` keeps "<method> is not available: …" and
    "The AI helper's self-test did not answer for <group>". The pack is
    kept; the receipt gains `integrity` (and `problems`), each only when not
    empty; the log names every finding ("[helper] check: …") and the job's
    last speed text is "installed with a warning · <the first>" (the queue
    clears it on done, so the receipt is the lasting record). Check again
    replaces both lists. Every ready status from the pack carries the
    receipt's `integrity` (`receiptIntegrity`, read defensively), and the
    row reads it grey, "Running · N of 9 helper features · <the first
    problem>", with Repair, Remove and each problem listed. Eight
    mutations, each seen to fail (integrity merged back into problems
    alone failed 7 `packCheck` cases); a verifier's string-prefix
    `isInside` failed 3.
52. **numba's cache inside the installed pack.** The first real beats pass
    writes 38 cache files (1,190,255 B) into the pack's librosa folders
    (measured, §3a.8 row 27), so the tree drifts from the receipt's
    `bytesOnDisk`.
    - (a) **`NUMBA_CACHE_DIR` set to `helper-cache/numba` in the pack rung's
      environment**, so the pack stays as installed and Repair's `rm` and
      the receipt's size stay true; the cache is the helper's own folder,
      evicted with the rest;
    - (b) accept the drift and say so in the row's size.

    **Recommended: (a).**

    **Answer (2026-10-16):** as recommended ("go ahead").

    **Built 2026-10-16** (`c996f80`; CI's half `3e90349`; `EFFECTS.md`
    §59). `NUMBA_CACHE_DIR` is `<cacheDir>/numba` (`numbaCacheDir`, joined
    through `assetPath`, so `…\helper-cache\numba` on win32) on every rung
    the app gives its cache folder: the pack, a packaged `FORGE_PYTHON`, and
    the development rungs (`plainHelperEnv` now sets seven app keys). A rung
    with no cache folder leaves numba to the parent's environment, as with
    `FORGE_CACHE_DIR`. Measured on pack 1: before, 38 cache files
    (1,190,255 B) in the pack; after a beats pass with the cache folder
    given, 0 in the pack and 38 (1,190,271 B) in `helper-cache/numba`. The
    integration suites passed no cache folder, so under `FORGE_HELPER_PACK`
    they still wrote the 38 into the pack, and CI would have cached that
    drifted pack; `packLaunch` now gives `<userData>/helper-cache`, and
    `helperPack.int` asserts no `.nbi` or `.nbc` in the version folder in
    both its modes.
53. **The last window the lock does not cover** (slice B, V2's finding):
    another window can start the helper from the pack in the milliseconds
    between Repair's or Remove's last in-use read and its stop, and two
    windows that find one stale lock in the same instant can both take it.
    - (a) **every helper start from a pack consults the lock first** in
      `getSidecar()`: while another live instance holds it, the start is
      refused ("the AI helper is being repaired by another Forge window")
      and the status says so; the takeover of a stale lock re-reads the
      file after writing and yields if another pid got there;
    - (b) §16.50 (b), `requestSingleInstanceLock`, as its own decision.

    **Recommended: (a)** in P-C; (b) stays its own question.

    **Answer (2026-10-16):** as recommended ("go ahead").

    **Built 2026-10-16** (`a1aaf0e`; the row in `be3ae1b`).
    - Every start from a pack asks `lock.ts` `lockedElsewhere(root, {pid,
      isAlive})` first, synchronously: in `getSidecar()`, in
      `startCurrent()`, and, through the client's new `mayStart`, before
      every spawn, a crash restart's included (beyond the text: without it
      the restart path left the race open). Another live pid's lock
      refuses: `getSidecar()` throws "The AI helper is being repaired by
      another Forge window" and builds nothing, and the status is
      `{state: 'failed', error: <that>, source}`, which the row shows grey
      with no presses. A young torn lock counts as another's, an unreadable
      one as held; this window's own pid refuses nothing. The status ask
      reads the lock again when the last status was this refusal and, once
      the lock is gone, starts the helper: the one case where an ask starts
      something.
    - A stale lock is unlinked through `PackFs.rm`; a taker that took over
      waits `TAKEOVER_SETTLE_MS` (100 ms) after its create and reads the
      file again, and if it finds another pid's lock, or none, it gives up
      without touching the file.
    - Repair and Remove read the in-use records once more after the hold and
      before the stop, and refuse with the pack as it was if a live pid has
      appeared.
    - Eight mutations, each seen to fail (the takeover's re-read dropped
      failed 2 `helperLock` cases; the client built without `mayStart`, the
      crash-restart case).
    - **Still open:** a taker paused longer than 100 ms between its read of
      the stale lock and its unlink; a plain create clobbered by such a
      laggard (three windows at once); and the lock records no job, so
      another window's launch sweep or Check again (which holds the lock
      through its whole check, about 2 s warm to 37 s cold) also refuses a
      start, worded "being repaired". The window asks the status once, at
      mount, and nothing polls.

**Added 2026-10-21, from the step 3 research (docs/research/graphics-motion-research-2026-10-17.md §7.6); all twelve answered the same day as recommended.**

54. **Step 3's scope** (D1 of the research's §7.6). §6 as written (14.5
    days, rated 4 of 10 against your bar) or the research's phases 0–2 (24
    days, 25.5 with the hand spike; rated 5.5)?

    **Recommended: phases 0–2.** "The extra 9.5 days buy the motion
    system, the stroke primitive, three templates that fire without
    numbers, the dim and the sound: 1.5 of the 2.5 points between §6 and
    the full plan, three fifths of the distance (computed from ratings that
    are inference, §0)." (The research's §0.)

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6 is re-planned in phases (§6's note, §6.19).
55. **2.5D now, or with step 6** (D2)?

    **Recommended: phase 3 directly after phase 2.** "It is the three.js
    engine the request is about, and step 6 then shrinks by 2 days. Step 4
    (Best clips) moves 5 days later."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). Built in §6.16; §9 falls to 5 days (§2).
56. **Run the hand track's spike** (D3)?

    **Recommended: yes, during phase 2**, "1.5 days counted in the
    unconditional 30.5 (it is mostly the user's run, on the user's machines
    and footage); pointing only; the 6-day build only if the gate passes;
    off per clip by default; every pointed graphic a proposal the user
    keeps. It needs clips with marked points, hennaed hands, a low-light
    reception and a blurred fast point among them."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). The spike is §6.17, its gate §6.12, the build
    §6.18; the footage is in §2's "Your part".
57. **The click-zoom family for screen recordings** (D4): in scope?

    **Recommended: not in step 3.** "A screen recording gets the 2.5D card,
    a dim and graphics. Revisit with a one-day cursor-from-pixels spike only
    if users bring screen recordings; a recorder of our own is a separate
    project."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6's "What waits and what is out"; the card is
    §6.16's.
58. **The default style: restrained, or energetic** (D5)?

    **Recommended: restrained by default** ("clean; the direction the
    reveal sources and the drift away from the 2021 look point"), "with an
    energetic style as an option that keeps the `pop` entrance and
    `out-back`."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). Seven presets, `clean` the default (§6.5).
59. **Sound with graphics** (D6)?

    **Recommended: yes**, "from the library's own sounds, capped per clip,
    off per project if wanted; levels from M18. Each sound carries its
    graphic's Clear rule, not the Director's `SOUND_RULE`, so each Clear
    removes exactly its own graphics' sounds (§4.5): an addition to §6 that
    keeps §16.10." (§4.5 there is the research's.)

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6.14; the sound Clear test is its
    `graphicSound`.
60. **The stroke look** (D7)?

    **Recommended: clean vector by default**; "a marker look through
    perfect-freehand as a style option once M10 passes; rough.js not now."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6.5; M10's perfect-freehand half runs in
    phase 2 (§6.15).
61. **Indic kinetic type** (D8)?

    **Recommended: per word by default everywhere**; "per cluster only for
    scripts M3 clears. And a separate small fix, outside step 3, so the
    captions' `bounce` and `wave` fall back to per-word animation for Indic
    scripts, mutation-checked."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). The units are §6.3's; the captions' fix is
    §6.20, outside step 3's days.
62. **Where the curves live** (D9)?

    **Recommended: one module, `graphics/motion.ts`, above the graphic
    style**, "read by graphics first; captions and zoom punches migrate
    after phase 2's ratings."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6.13; the migration is its own later change.
63. **Indic fonts for graphics** (D10)?

    **Recommended: decide `BETA.md` R14, bundling Noto Sans Devanagari and
    Noto Sans Telugu** (both OFL), "before phase 1's Indic render check, the
    exit bar §7.3 names for the §51 clusters, which phase 2's exit extends
    to every template's Hindi and Telugu fixture. Until then the same
    graphic draws with whatever fallback each OS resolves, which M22
    records; if M22 finds the canvas does not shape a cluster, bundling is
    no longer optional." (§7.3 there is the research's; here the bars are
    §6.12's.)

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). Built in §6.20 (the two files committed under
    `assets/fonts/`), its half day counted there once; `BETA.md` R14 says
    so.
64. **Emoji or hand stickers, Lottie accents** (D11)?

    **Recommended: not in step 3.** "Vendor sources call emoji pops the
    cheap look [60], and the CC BY attribution question is open." (`[60]`
    is a source in the research's §8.)

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). §6's "What waits and what is out".
65. **How dense** (D12)?

    **Recommended: keep §6.7's spacing for every graphic**, "and set an
    overall per-minute cap from M17's count of clips the user calls pro."

    **Answer (2026-10-21):** as recommended ("ive read you 12 recomondations
    as well wil go with it"). The budget is §6.9's; `GRAPHICS_PER_MINUTE` is
    null until M17 (§6.15). Two readings of it are recorded in §6.9 for you
    to overturn: the screen card is outside the spacing (read against D4,
    which gives a recording "a dim and graphics"), and the lower third keeps
    the 6 s gap but is outside the per-20 s count (read against D1, since
    counted it would take the only slot of every clip under 40 s with a
    Speaker).

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
- Step 3's phase exits met in turn (§6.12); the hand spike's gate decided
  with its numbers in `EFFECTS.md` §62 and its outcome recorded in §6.17;
  phase 4 built only if the gate passed. Every M and H row of §6.15 in
  `EFFECTS.md` §61 or §62, or the plan changed where it disagreed.
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
