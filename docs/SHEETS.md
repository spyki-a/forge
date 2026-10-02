# The notebooks — 18 sheets, then 11 more

A transcription of the hand-drawn planning sheets, kept here so the plan
survives independently of any one conversation. The first notebook (sheets 1 to
18, September 2026) planned the editor that exists; the second (sheets 19 to 29,
drawn 2026-10-02 while looking at the running harness) plans the new layout and
the next tools. The second part begins at "The second notebook" below.

**This is a transcription, not the images.** For the first notebook the
drawings live only in the notebook and in the photographs; what follows is what
is written and drawn on each, close enough to work from. Where a phrase is the
author's own it is quoted. If one of those sheets needs to be looked at again —
a layout judgement, something ambiguous in a sketch — the photograph has to be
re-sent. The second notebook's photographs ARE kept, under
`docs/sheets/2026-10-02/`, one JPEG per sheet, so those can be opened.

Sheets are listed in the order they were photographed. Several carry their own
circled number in the notebook, which is given where it exists; some are
unnumbered. Status is against the working tree and is updated as things land.

---

## 1 — Sheet ⑩ · Reference style

> "when they uses ... so first we take split the preview side by side of the
> video and edit same. On the UI but in the backend we will send that wide for
> analyse so the depth analyse it Librosa and take also the music analyse it beat
> drop at the scene change and do the same for the user input media"

A reference video goes in; the app edits the user's footage the same way. The
preview splits side by side so the two can be compared. The backend analyses the
reference for depth, for music (beat, drop) and for scene changes, then applies
the same treatment.

Tools named in a box: **TransNetV2** (scene detection), **RVM** (Robust Video
Matting).

**Status — half built.** The split preview exists (source / split / out, with a
draggable divider). Beat analysis and depth analysis are real sidecar
capabilities. There is no reference-video ingest and no matching pipeline, and
neither TransNetV2 nor RVM is in the codebase.

---

## 2 — Sheet ⑪ · Paper animated

A frame containing a box labelled "Your Text" with loose vertical strokes around
it. Annotated:

> "Option II ⇒ Paper Animated (Reference: Paper Animated websites)"

**Status — not started.** Nothing in the code. The nearest thing is the text
style library, which has no paper or hand-drawn treatment among its looks. Worth
seeing the reference sites before building: "paper animated" covers several very
different looks.

---

## 3 — Sheet ⑨ · Library and search

A panel with tabs across the top: **Media | Library | Text | Auto**. Under
Library:

- Fonts, SFX, stickers, 3D props, memes, meme stickers, transitions
- A search box
- "Categories: Telugu, Hindi, trending …etc"
- A grid of nine tiles

Arrow to a note:

> "They both same but sticker has already done so it is nothing to user"

**Status — built, bar the font tiles.** Tabs and search were already there.
What this sheet asked for and did not have is now in:

**Meme stickers are a kind**, as `StickerMeta`'s second form. An emoji sticker
is one SVG named by codepoint; a meme sticker is a keyed video cut-out — colour
and matte, recombined with `alphamerge` — because H.264 4:2:0 cannot carry an
alpha channel. 636 of them ship, with sound. See `docs/STICKERS.md`.

**Categories exist**, and they are also the unit of download: ten packs, one per
category, so somebody editing Telugu content never fetches SpongeBob. The chip
row above the grid is built from what is INSTALLED rather than from the
manifest, appears only once there is more than one category to choose between,
and clears itself when you leave the Stickers tab.

The sheet's note — *"They both same but sticker has already done so it is
nothing to user"* — turned out to be the whole design. The keying, cropping,
loop decision and thumbnail all happen once when the pack is built; the user
drags a cut-out onto the timeline and has never been asked a question about any
of it.

**Still missing: the font tiles are inert.** Every other kind is draggable and
fonts have no handler.

---

## 4 — Sheet ⑦ · Narration video

A source bar across the top: **url | mp4 | mp3 | mp3/instrumental | Narration
video**. The narration panel:

- "Ask for the topic?" — a text field
- Duration: 1 min / 2 min / 3 min
- "Image? 1, 2, 3, 4"
- Music: a pool (track 1, track 2, track 3) plus upload

Then:

> "Backend LLM will create the narration and give the key word, searches to the
> related topic to the Pixel stock footage. and also LLM will tell which photo is
> first, 2nd, 3rd and edit direction."

**Status — not started.** The tab exists and is labelled "soon". Its own
description in the code reads: "Topic and length in, narration and a cut out. The
only part of the app that needs paid services." No LLM, no text-to-speech, no
stock-footage API.

---

## 5 — Sheet ⑥ · YouTube ingest

"Youtube Url / Upload mp4 bar" branching into **mp4** and **mp3**.

- mp3 → "Download mp3 and use Demucs to remove vocals" with options: vocals only
  / instrumental / beats only
- mp4 → "Download mp4 if youtube link is pasted, ask for the quality available":
  4K, 1080p, 720p, 480p
- "Download only mp3 of the link 'NO'. From youtube mp4 = Download, MP3 = 'YES'"
- Boxed at the bottom: **"Download using YT-DLP"**

**Status — built.** The line that used to be here —
"neither yt-dlp nor Demucs appears anywhere" — was wrong about Demucs for some
time: `audio.stems` has been wired end to end in the sidecar, with a mid/side
fallback in `src/main/stems.ts`. Planning from that sentence would have rebuilt
it. The download half is now real too: `src/shared/ingest/` (links, formats,
progress, range clipping — pure, tested), `src/main/ingest/` (yt-dlp fetched on
first use and checksum-verified, downloads as queue jobs with the same bar and
cancel as exports), the IPC, and the panel itself. Paste a link and press Get:
two clicks to a clip on the timeline, with the four choices this sheet draws —
video, audio, instrumental, vocal — as one row rather than as four tabs leading
to the same screen. "beats only" is the one option here not offered: beat
detection already exists as its own capability and belongs on a clip, not as a
download format. See `docs/INGEST.md`.

---

## 6 — Sheet ⑤ · Timeline

Four lanes — **V, V, A, A** — each with an eye toggle; the audio lanes drawn with
waveforms, one of them showing a marked region. Two notes:

> "Controlling music. slow fade on slow On starting/ending"
>
> "+ Adding music on top of each other"

**Status — small gaps.** Multitrack, waveforms and per-clip volume are built.
Ducking is real — music drops under speech via `sidechaincompress`. Layering
works, and adding a second sound now stacks onto another track rather than
queueing after the first.

**"Controlling music" is now two separate things, and both are wanted.**
Ducking is the automatic one. The other is a **drawn volume envelope** on the
clip — the Ableton shape: grab the line, drag a point, quiet it *here* because
you say so. That is built: `volume` keyframes, drawn on the clip in the
timeline, compiled to `volume=…:eval=frame` (measured, EFFECTS.md §1). It is
also what makes the app interesting to DJs, who drop a clip into a set and
reach for the line rather than a menu.

**The sheet's waveform lanes are now real on the timeline too.** They were only
ever in the trimmer, so the envelope above was aimed at something invisible.
Full height on a sound file, the lower half on a video clip — see
WHERE-THINGS-ARE.md for the mapping, which is the whole of the difficulty: the
clip shows a *window* of the file, and getting that wrong draws a perfectly
convincing picture of the wrong moment.

**Fades are built too**, as a third control alongside the envelope and
ducking: grips at the clip's top corners, `afade` at render, multiplied with
the envelope rather than replacing it. The curve is `qsin` rather than linear
and the reason is measured — EFFECTS.md §26, which also records why the filter
sits between `volume` and `adelay` and nowhere else.

**Crossfades are built.** They were written up here as blocked — *"overlap on
one track is a ripple-insert problem the timeline cannot express yet"* — and
that was simply wrong, stated without looking. `anchorTransition` has always
overlapped its two clips; the model expressed overlap all along. Worse, that
overlap was going out **3 dB hot**, because two clips sharing frames both
played at full: every video dissolve, since dissolves existed.

So the rule now is that overlap on a track *means* crossfade, derived at
render. `crossfadeAt` makes the overlap by sliding the incoming clip back —
never by lengthening the outgoing one, which would need source past its out
point and would cross-fade into silence on any clip trimmed to the end of its
file. EFFECTS.md §27 has the measurements, including why `acrossfade` is not
used.

**Loudness normalisation is built**, so that is closed too: every export
measured to a target in LUFS, `-14` by default on a new project and off on
anything saved before it existed. EFFECTS.md §28 has the measurements,
including the two things `loudnorm` does behind your back — it emits 192 kHz
whatever went in, and a bare `aresample` after it kills the render.

Sheet ⑤ is now fully built. What is left on this sheet is refinement rather
than absence: two-pass loudness if drawn-envelope material ever sounds
squashed, and crossfades at a cut you can drag rather than press.

---

## 7 — Sheet ④ · Section: "Auto"

A numbered list, boxed:

1. Beat Sync Reel + Add music — ticked, "100%"
2. Motion — "100%"
3. Depth Parallax
4. Transitions — "100%"
5. 3D Props
6. Film strip — "(I'm confused because you are working on)"
7. Build from photo — boxed
8. *(blank)*
9. *(blank)*

**Status — built.** All seven named are built, each as a rule that writes
ordinary visible clips. The film strip note can be struck: it is built, and has
been for a while — it lays several photos side by side as full-height panels and
pans the row as one.

Slots 8 and 9 are filled: split screen (sheet 16) and the **grid split** (sheet
18), one photograph diced into pieces that arrive on the beat.
**Silence-removal auto-cut** is the strongest remaining candidate for a tenth.

---

## 8 — Sheet ③ · Transition library

> "transition effects, card slide, 3D moment parallax. Library"

A panel of six tiles, each showing "Aa" with a different motion arc, plus a
seventh labelled **"custom draw"** containing an S-curve.

> "(where we can use the preset here)"

**Status — small gaps.** Larger than the sheet: 8 hand-written transitions plus
**412 derived from the catalog's mask images**, auto-tagged by what they do,
grouped into families with a tag filter. The custom curve editor exists but
drives motion paths and colour, not transition easing — wiring it to transitions
is a small job, not a new system.

---

## 9 — Sheet ② · Caption styles and fonts

"Captions Styles ▽ [On/Off]". Then "Fonts:" and a grid of tiles — "Aa", "The Aa",
"THE Aa". Below:

- "Choose: size, opacity, position R/L/T/B"
- "Smart: Custom 5 ▽ | Custom 10 | Custom 20" with "font +" / "font −" steppers
  and "+ more"
- "(Random every 5, plus customisable)"
- "Remove toggle"

**Status — small gaps.** On/off, 45 styles, 9 animations, font picker, size,
words per line, position, margin and both colours are built, and the spoken word
lights up and grows. Still missing: **opacity**, the **Smart sets** (rotate
between 5 / 10 / 20 styles), **random every N**, and the **font +/− stepper**.

---

## 10 — Unnumbered · "Tools missing"

1. multitrack
2. smooth scrolling
3. drag trimming
4. splitting
5. snapping
6. audio controls
7. text overlays
8. transitions
9. undo/redo

**Status — built, all nine.** Undo is transactional, so a pointer drag or a burst
of typing is one step. This sheet is closed.

---

## 11 — Unnumbered · "hard"

> "hard: transitions for a photo syncing with music/video, photo syncing with the
> music, beat. Object tracking for text."

**Status — half.** The beat half is done: beats are analysed by the sidecar and
the reel rule plans cuts against them, deliberately not on every beat. **Object
tracking is not started** — nothing in the code tracks anything across frames.
The hardest item on all seventeen sheets; its own project.

---

## 12 — Unnumbered · Clip before download

"Video / youtube url" field, a **duration** range bar with two handles, and a
play preview box. To the right:

> "clip download ⇒ Mp4 ⇒ quality / MP3 = Download / Vocal only = Download /
> Instruments = Download"

**Status — built.** Adds something sheet 5
does not: **clipping a range before the download**, which saves pulling an
hour-long video for eight seconds of it. It went into the args layer from the
start rather than being bolted on: `src/shared/ingest/section.ts` offers both
cuts, because they are genuinely different — *exact* re-encodes at the marks
and is slow on 4K; *fast* copies streams and lands early by up to a keyframe,
so it pads outward and the ends are placed precisely on the timeline instead.
The two marks are typed rather than dragged: the video's length is unknown
until it is fetched, so a slider has no scale to be drawn against — the first
attempt rescaled under the pointer and a seven-pixel drag added four minutes.
The preview box beside them is still to draw.

---

## 13 — Unnumbered · Smart caption placement

"Captions → placement":

- **(A) Options:** sliders — ↑ ↓ ← →
- **(B) Option:** Smart placement

> "How smart placement work? so we are doing depth and matting and find the
> object so the caption ... even subject gets for the caption placement. Dead
> space = 'yes' / 'no'"

Then "Smart caption =" with three grids drawn: **set 3**, **set 5**, **set 10 /
set = all**, with "+ = Add" and "− = Remove".

**Status — not started.** Captions have top / middle / bottom and a margin, and
text cards drag freely. The depth bake the sheet points at genuinely exists —
that reasoning is right — but it is **stills-only** today and would need
extending to video first. No subject-aware placement, no dead-space detection.

---

## 14 — Unnumbered · Auto flip

> "By auto flip: when they uses / when the user has a landscape video we use it
> if ... Now we need to Add the Our biggest Assets ever LLM ⇒"

**Status — not started.** The mechanical half is built: changing aspect re-solves
every clip's reframe, there is a crop solver, and the rectangle can be dragged in
the preview. The deciding half is missing — nothing works out *where* the
interesting part of the frame is, so the crop is geometric rather than aware of
the subject. An LLM is one route; subject detection is cheaper and needs no
per-use cost.

---

## 15 — Sheet ① · The main layout

The full wireframe.

- Source bar: **YT URL / upload | Mp4 | mp3 | mp3/Instrumental | Narration video**
- Left column: tabs **Medi | Lib | Txt | Auto**, and a row **text | colour |
  grade**, then "+ media"
- A vertical **Tool Box** strip
- **Preview** in the centre, with **source | split | out** beneath it
- Timeline: **V / V / A / A** with eye and lock toggles, transport controls and a
  timecode
- Right column: **Aspect ratio** 9:16 / 16:9 / 1:1 · **Caption** on/off with a
  Styles dropdown · **transition** · **Export**
- Below that: **LUT — Graph** with a curve drawn in it
- Marginal note with an arrow: "Thick Border"

**Status — built.** The app is this sheet. Every region is where it was drawn,
LUT graph included. Only the two source-bar tabs marked "soon" are outstanding.

---

## 16 — Sheet ⑩ · Split screen and reaction

"Split screen", under **Section: Auto**:

- **(A)** Split screen
- **(B)** Reaction (PiP) videos

> "when select this in the Preview it should split to P/top → different"
>
> "Users can drag top/bottom if they clips and we will blend with FFmpeg"

Two boxes drawn side by side, labelled "different" and "different".

**Status — built.** Stacked and side-by-side splits, any number of panels, each
filling its half rather than letterboxing. Written into the clip's ordinary
transform, so the result stays draggable. **Still open:** the drag-a-clip-into-a-
half drop targets — the split is applied from the Inspector, not by dropping.

---

## 17 — Sheet ⑨ · Picture in picture

> "Add PiP or upload Image. so when added user can add the PiP in that shot and
> also it has all emphasising custom drag and drop like sticker and other
> options: brightness, opacity, sizes, rotation and also how it show appears on
> the templates. Some like wider neat edges so it won't look amateur. And when we
> add Pixels API we can also provide them as well for the PiP images"

Three small shapes drawn — a circle, a square, a rectangle.

**Status — built, minus the API.** Four shapes (same-as-video, square, circle,
tall), five positions, rounded and circular edges via the mask, and every control
listed — drag, brightness, opacity, size, rotation. **Still open:** the stock
image API, which needs a key.

---

## 18 — Sheet ① (the second one) · Custom grid per photo

> "Upon Selected Image: 1, 2, 3, ……N / On each photo We ask the User for Custom
> Grid where user can select his Pixels Sizes something like if user selects 2"

Two diagrams: a box split down the middle (R | L), and the same box split across
the middle (T / B). Then a 4×5 grid drawn out. Below:

> "So, Just like with 3, 4, 5, 6…N and Some options on Grid: square, Circle,
> …… if possible Waves. and also rotating options (as we already have
> Everyth… So, we good,"

**This is one photograph cut into N pieces, not N photographs laid in a grid.**
Worth stating, because the two are easy to confuse and only one of them is on
this sheet. (Laying several pictures out together is sheet 16, the split screen.)

**Status — built.** `shared/render/grid.ts` and `shared/automation/grid.ts`. A
piece count becomes rows and columns by factor pair, chosen so the cells come
out squarest for the canvas — so two pieces stack in a vertical frame and sit
side by side in a horizontal one, exactly as drawn, without either being an
option anyone has to pick. Square, circle and wave cells; a gutter; a scattered
tilt; six reveal orders; three landings. The pieces arrive one per beat, or on
an even cadence when there is no music. See docs/EFFECTS.md §17.

**One correction to the sheet.** "rotating options (as we already have
everything)" is half right. Flat rotation exists and now works properly — it was
cutting the corners off every turned clip in the app, which is fixed. But the
X-tilt / Y-spin / Z-roll in the reference recordings is a PERSPECTIVE warp, a
different operation. `perspective` is in the bundled ffmpeg, does a real quad
warp, and animates on `on` — measured, five frames, five distinct hashes — so it
is reachable in the single-pass graph. It is not built.

---

## Where the gaps cluster

**Getting media in.** Both unfinished source-bar tabs plus the range-clip idea.
The largest single hole, and upstream of everything that already works.

**Models not yet added.** Scene detection, matting, object tracking, and the
deciding half of auto-flip. The sidecar already hosts three models (speech,
beats, depth), so each is an addition rather than a new system — and none needs a
paid service.

**Caption behaviour, as opposed to caption looks.** Smart placement, style
rotation, random-every-N, opacity. The looks are finished; how captions decide
things for themselves is not.

**Small finishing.** The inert font tiles. Transcript-to-text-card conversion.
Copy/paste/duplicate and multi-select on the timeline. *(Audio fades and
loudness were here and are done — fades, crossfades and LUFS normalisation all
land in EFFECTS.md §26–28.)*

**Content without a pipeline.** `prop` is an `AssetKind`, the keyword rule that
fires props is built and tested — and **no prop pack ships**. Sheet ④'s "3D
Props" is therefore a hole in the ASSETS, not in the code, which is a very
different size of job from how it reads. The sticker pipeline
(`scripts/build-stickers.mjs`) is the shape the answer would take.

---
---

# The second notebook — 2026-10-02 — 11 sheets

Drawn over four days with the harness (`npm run harness`, port 5199) open
beside the notebook, so every page is a change to a screen that exists rather
than a screen imagined. Photographed and kept under `docs/sheets/2026-10-02/`
as `01-layout.jpg` … `11-caption-styles.jpg`; the numbers below are the file
numbers. The author's answers to the questions the transcription raised (same
day, in conversation) are folded into each sheet as **Decided**.

The visual style for all of it: **neumorphism** — "Soft Extrusion & Tactile
Controls" — for the tiles and the big buttons; the timeline, waveform and
preview stay flat and high-contrast. Base colour a grey-blue, "dark grey blue
… make it a little light"; the 3dit icon's blue as the single accent.

**A naming note for the code.** The author calls the left panel the "side car".
In this codebase `sidecar` already means the Python helper process
(`src/main/sidecar/`, `docs/SIDECAR.md`), so the panel needs another internal
name; the conversation uses the author's word, the code must not.

**Agreed order.** (1) The layout and the panel's home screen — moving what
exists, building nothing new. (2) The small additions: the Trimmer, chapters,
the pool grouped by kind, the caption grid, the image presets. (3) The three
real features: cutting from the transcript, Narration's script, Best clips.
Sheets 25, 27 and 28 each say "biggest" and the author agrees they come last,
with more to be drawn for them ("we will discuss it when the time comes after
all the small things are done").

---

## 19 — 01 · The new window

Top right: "Settings → ⚙". Four regions:

- **Sidecar** — the whole left column, tall.
- **Canvas / Preview** — top right, with two arrows: "16:9 ↔ Landscape" and
  "9:16 ↕ Vertical". The canvas itself switches shape.
- **OUTPUT** — a short strip at the bottom of the sidecar's column, with a
  collapse triangle.
- **Play head / Timeline** — the bottom, under sidecar and output.
- **EXPORT** — bottom right under the canvas, with a collapse triangle.

There is no right-hand inspector.

**Decided.** The sidecar and today's Output space together take "about 35 or
40 % of current", both on the LEFT, stacked. The full-height inspector goes.
Its per-clip controls go to the Trimmer dock (sheet 21), which shows only when a
clip is selected. "For the graph and keyframes we will add a small side bar on
the timeline only, the user uses it when needed" — so curves and keyframes live
in a sidebar of the timeline that is closed by default. The point of all of it:
"bigger room to edit for both landscape and vertical".

**Status — not started.** Today the window is four areas with a full-height
inspector on the right (`docs/WHERE-THINGS-ARE.md`); the aspect ratio is chosen
in the inspector's Output block, not on the canvas. Everything on this sheet is
a move of things that exist.

---

## 20 — 02 · The sidecar's home: tiles

A grid of rounded tiles, "small tiles, switches kind of", one per tool:

| row | tiles |
|---|---|
| 1 | **Upload** · **URL** · **Narration** · **Library** |
| 2 | **Transcript** · **Director** · **Depth / Parallax** · **Beat Sync / Cut to words** |
| 3 | **Transitions** · **One photo** · **Grid Split** · **Strip flashes** |
| 4 | **Film strip** · **3D props** · **Text** · **Color Cards** |
| 5 | **Grade** · **Newspaper Clipping** · **Card ring** |

Across the bottom, a wide dock: **Trimmer**.

**Decided.** Every tool that exists keeps its own panel inside its tile — "film
strip has its own, one photo shot has its own, flashes has its own, everything
goes inside of it". And the common first step of every tool that takes media:
**upload a file, or choose from the media** — "that way we can differentiate
user needs while choosing some options like music sync or the Director's, all
of them the same".

**Status — not started as a home; every tile's tool exists.** Upload, URL and
Narration are the source bar's three modes (`SourceBar.tsx`; Narration is still
"soon", sheet 4). Library and Transcript are left-panel tabs. Director, Beat
sync (the reel) and Cut to words (the lyric cut), One photo, Grid split, Strip
flashes, Film strip, 3D props (the keyword rule; no prop pack ships), Newspaper
clipping (the paper panel) and Card ring (the carousel) are the Auto tab. Text,
Colour cards and Grade are the three buttons above the media grid. Depth /
Parallax is today a toggle on a selected clip. Transitions are a library
section. Twenty tiles want grouping on screen — by what they do, or by what
they take — which the sheet leaves to the build.

---

## 21 — 03 · Upload: the pool by kind, and the Trimmer

Top row: **Upload ▽ · [choose file] · upload ⇧**. Note top right, starred:
"**Upload and Import are same**."

Under it, **Preview**, in three groups:

1. "if Images" — a grid of thumbnails, each with a small bar beneath.
2. "if Videos" — wide tiles.
3. "if audio" — a tile with a waveform.

Across the bottom: "**Trimmer**: will work to trim anything before playhead
trim (videos, audio)".

**Decided.** The Trimmer appears only when a clip or pool item is selected,
never as a permanent dock. It trims a clip BEFORE it reaches the timeline — the
source monitor every other editor has (COMPARISON.md: "in / out points, range
✗") — and, once the inspector goes, it is also where the per-clip controls
live.

**Status — pool exists, grouping and Trimmer do not.** The Media tab is one
thumbnail grid of every kind (`MediaPool.tsx`); import is the source bar's
Upload. The reel's music-range picker (`MusicRange.tsx`) is the nearest thing to
a trimmer and would fold into it.

---

## 22 — 04 · Videos in the pool: preview and transcribe

"Upload → preview → if videos". Each video is a **small preview** with a Play
triangle (①, ②, ③ … "same"). Beside each: **Transcribe (faster-whisper)** with a
hatched **progress bar — 100 %**.

**Decided.** "For this we will install Python then I guess" — transcription
needs the sidecar, so the installed app will set Python up rather than hope it
is there (the full route of BETA.md R4). Until then the button has to say
"Python is not installed" rather than spin.

**Status — closer than it looks.** A pool item already has a Transcribe button
and a percent chip while it runs (`MediaPool.tsx`, the chip is also the cancel);
the Transcript tab reads the selected timeline clip. What the sheet adds is the
small Play preview per video and a bar rather than a chip. The sidecar runs
faster-whisper.

---

## 23 — 05 · Images in the pool: effects

"Upload → preview → if images". Three stacked image tiles (①②③). To the right:
**effects** — **Warm · Black & white · Shades** — "same" for each.

**Decided.** Keep as drawn: three preset chips per image.

**Status — not started.** Grades today are an adjustment layer (`+ Grade`) or a
clip's own colour values. The presets should become ordinary per-clip colour
values when the clip is made, so they stay editable and do not stack on the
Director's look.

---

## 24 — 06 · Audio in the pool: trim, speed, voice

"Upload → preview → if audio". Three waveform tiles, each with **trim handles
at both ends** (①②③). To the right: **effects** — **Speed**, **Voice change**,
**Voice change effect**.

**Decided.** The handles are the Trimmer (sheet 21). **Speed stays** — "we
already have it". **Voice change is "coming soon"**: shown, disabled, built
later; the filter for it must first be measured on the 2018 Windows ffmpeg.

**Status — speed exists (`SpeedPanel.tsx`, the atempo chain in the render), and
so do six voice presets** — Chipmunk, Bright, Deep, Monster, Phone call, Radio
(`shared/render/voice.ts`, in the clip's right-click menu, rendered and
exported). What "coming soon" covers is a NEW voice effect beyond those; the
presets stay. Trim handles on a pool item do not exist.

---

## 25 — 07 · The URL panel

Top: **URL → [field] · Get Meta data**. Then **Preview** "if youtube".

A long bar with marks: "**Chapter downloads** ① ② ③ ④ ⑤ ⑥".

A second bar with bracket pairs and arrows: "**Clip downloads** ① ← ② → ← ③ →"
— several in/out ranges in one job.

Buttons below: **Get transcript ▽ · Best clips · MP4 · Instrumental · Vocal ·
MP3**.

**Decided.** "URL panel is the biggest one, yes, because it has best clips —
it's a whole different concept." Best clips (sheet 27) comes in order (3);
chapters, several ranges and Get transcript are small additions in order (2).

**Status — half built.** YouTube ingest exists (`IngestPanel.tsx`,
`docs/INGEST.md`): quality, MP4 / m4a / MP3, instrumental and vocal inside the
job, and ONE range before download (sheet 12). Chapters, several ranges, a
transcript from the link and Best clips are not built. Chapters are in the
downloader's own metadata, and YouTube's timed captions can be fetched without
transcribing, so neither needs a model.

---

## 26 — 08 · Transcript to clip

Top: **Get transcript ▽ · URL transcript**. A panel of rows — **"time"** |
**text** — "00 | …", "… | …". Beside it a vertical bracket: **cut ↕**, and a
button **clip it**.

Select a run of rows; Clip it cuts the download, or the clip, to those words.

**Decided.** "That's the most important feature, we can say — we are already
cutting the download size, and now with this it can be more powerful than
blindly cutting from the duration bar." Order (3), but first among the three.

**Status — not started.** The Transcript tab jumps to a word and corrects
words (`TranscriptPanel.tsx`); it never cuts. The word timings exist, so this
is a selection and one cut.

---

## 27 — 09 · Best clips

**Best Clip** · **duration: 1 min, 2 min, 3 min, 4 min** · **Analyse**. Three
tall (9:16) cards side by side, each with a few lines of text beneath.

**Decided.** The largest single item. More to come when it is reached: "add 3D
toggle, B-roll images (its own settings again — number of images, how they
appear, top or bottom, the shapes we already have for the B-roll effects),
transitions — we will discuss it when the time comes after all the small things
are done."

**Status — not started.** It needs a transcript (have), a model pass to score
segments (the Director's model plumbing, `shared/director/ask.ts`, serves), and
a 9:16 reframe that follows the speaker (new; the sidecar's subject box is a
start). Depends on a local model being set up, as the Director does.

---

## 28 — 10 · Narration

**Narration :—** · **topic : [field]** · **Images / videos count: 1, 2, 3, 4, 5,
custom** · **choose voice: male / female ▽** with a list (①②③) · **Genre :—
Energetic, Comedy, Facts** · **transitions :— Beat Sync** · **Music upload**
→ **upload mp3 ⇧** and a waveform with a playhead · **Duration: 1 min, 2 min, 3
min** · **Captions: Add +** (→ sheet 29).

**Decided.** "Narration is also the biggest part, because we need to integrate
the Pexels images API in the settings panel — and all the API integrations in
the settings panel at the top right, in the place of AI." So: one settings
panel, top right, holds every key and server — the model servers (today the
Director's gear), the hosted voice, Pexels. Order (3).

**Status — not started, pieces exist.** Sheet 4 is this sheet's first draft
and still reads "soon" in `SourceBar.tsx`. The voice provider exists
(`src/main/voice.ts`: Kokoro through the sidecar, or a hosted endpoint with a
write-only key); the Director does pictures + music + brief; caption styles
exist. Missing: the script writer (topic + genre → narration), the Pexels
fetch, and the settings panel.

---

## 29 — 11 · Caption styles

**Captions · styles, fonts**. A **3 × 3 grid** of style cards. Below: **Create
video** and a **progress bar**.

**Decided.** This is Narration's last step ("Add +" on sheet 28): pick a caption
look, then Create video.

**Status — the looks exist, the grid does not.** Caption styles are a dropdown
in the inspector's Output block and a style picker (`TextStylePicker.tsx`,
sheet 9). A visual grid is a presentation change over them.

---

## Where this leaves things

**Order (1) is a move, not a build**: every tile's tool exists; the work is a
new frame (sheet 19), a home screen (sheet 20), the per-clip controls into a
dock that appears on selection, curves and keyframes into a timeline sidebar,
Output and Export into two collapsible strips, and the Director's gear into a
settings panel. Nothing the app can do today may be lost in the move —
`WHERE-THINGS-ARE.md` exists because it happened twice.

**Order (2)** is five small things, each hours to a day: the Trimmer, chapters
and several ranges, the pool by kind, the caption grid, the three image presets.

**Order (3)** is three features that each need their own sheets: transcript
cutting first, then Narration (script, Pexels, settings panel), then Best clips
(with the B-roll, 3D and transition settings still to be drawn).

**Python.** Transcribe-from-the-pool, Narration's voice, depth and beats all
need the sidecar, so the installed app sets Python up itself (R4's full route)
rather than the TypeScript beat tracker alone; the beta plan's R4 changes
accordingly when it is reached.
