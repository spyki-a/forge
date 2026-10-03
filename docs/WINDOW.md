# The new window

> Written 2026-10-02 from the second notebook (docs/SHEETS.md sheets 19–29) and a read of every control in the current UI by five Opus readers and a planner (573 controls, each opened at its file:line against `bd58eb5`). **Status: a plan awaiting the user's answers to §7; nothing in it is built.** Mark each step DONE here as it lands, with its commit, as PLAN.md does.


Draft, 2026-10-02. Read-only planning pass. Sources: the eleven photos in
`docs/sheets/2026-10-02/`, the user's eleven answers (relayed verbatim), the
transcription in `docs/SHEETS.md` sheets 19–29 (uncommitted in the working
tree), `docs/WHERE-THINGS-ARE.md`, and five inventories of the current UI.
Every file:line below was opened and spot-checked against the tree at `bd58eb5`
plus the uncommitted docs.

The rule this plan is written against is the one `WHERE-THINGS-ARE.md` opens
with: **a feature that exists but cannot be found is the same as one that does
not exist.** So every control the app has today gets a home below, or is listed
under "Decisions the user has to make".

---

## 1. Names

| thing | internal name | what the user sees | why |
|---|---|---|---|
| The user's "side car" (left panel: tile home + open tool) | **Shelf** — `components/shelf/Shelf.tsx`, `shelf/tools.ts`, store `shelfTool` | no title on the home; an open tool shows "← Tools · Beat sync" | `sidecar` is the Python helper (`src/main/sidecar/`, `docs/SIDECAR.md`, store `sidecarReady`/`sidecarError`, tooltip "AI sidecar running"). `shelf` appears nowhere in `src/` (grep: 0 files) and only as "off the shelf" in docs. |
| The small sidebar on the timeline for graphs and keyframes | **Curve tray** — `components/CurveTray.tsx`, store `trayOpen`, `trayTab` | rail label "Keys & curves" | `tray` is unused in `src/` and `docs/`; `rail` is already a rendering-path word (`docs/EFFECTS.md:2565`, `docs/PLAN.md:1141` "another rail"), `drawer` is a Library word, `bar` collides with SourceBar and progress bars. |
| The bottom-of-shelf area that appears on selection | **Trimmer dock** — `components/TrimmerDock.tsx` | "Trimmer" header, then the clip's controls | the user's own word |
| OUTPUT / EXPORT | `components/OutputStrip.tsx`, `components/ExportStrip.tsx`; store `outputOpen`, `exportOpen` | OUTPUT ▲ / EXPORT ▲ | store fields deliberately avoid a `strip…` prefix: `stripLayout`, `stripCount`, `stripPerHit`, `stripLook`, `stripBeatsPerHit`, `stripBursts`, `stripsBuilding` already mean Strip flashes |
| Canvas shape + view switch above the preview | `components/CanvasBar.tsx` | 16:9 Landscape · 9:16 Vertical · 1:1 Square | — |
| Settings, top right | `components/SettingsPanel.tsx`, store `settingsOpen` | ⚙ with a status dot | replaces the "AI" dot at `App.tsx:84-94` |

And one user-facing rename that follows from the first row: the Python helper's
on-screen name becomes **"AI helper"** (`App.tsx:86` "AI sidecar running/starting",
`MediaPool.tsx:236-239` "The AI sidecar is not running"). Otherwise the screen says
"sidecar" for one thing while the user means another. Code names stay.

`Inspector.tsx` keeps its file name and becomes the clip editor inside the dock.
That is deliberate: six tests pin per-clip JSX to that path (camera 165-169, steady
112-115, chromaKey 219-228, audioSurface 780-783), and keeping the path keeps them
honest without re-pointing. The component's title on screen becomes "Clip".

---

## 2. The new window

```
┌──────────────────────────────────────────────────────────────── ⚙• ┐  header (drag region; gear is no-drag)
│ SHELF (left column, full height)  │ [16:9][9:16][1:1]  [Src|Split|Out] ⚠ │  CanvasBar
│ ┌───────────────────────────────┐ │ ┌──┬────────────────────────────────┐│
│ │ home: 19 tiles, sketch order  │ │ │T │                                ││
│ │  — or an open tool's panel    │ │ │o │        Preview (flat)          ││
│ │  "← Tools · Grid split"       │ │ │o │                                ││
│ ├───────────────────────────────┤ │ │l │                                ││
│ │ TRIMMER DOCK (only when a     │ │ └──┴────────────────────────────────┘│
│ │ clip — or a Library sound —   │ ├──────────────────────────────────────┤
│ │ is selected): waveform, then  │ │ Transport                       │K │
│ │ the clip editor (Inspector)   │ │ Timeline (flat)                 │e │ ← Curve tray: a 28 px rail,
│ ├───────────────────────────────┤ │                                 │y │   closed by default; opens
│ │ OUTPUT ▲  30 fps · -14 · capt │ │                                 │s │   to ~320 px
│ │ EXPORT ▲  [Export]  ▬▬▬ 42%   │ │                                 │  │
│ └───────────────────────────────┘ │                                 │  │
└────────────────────────────────────┴──────────────────────────────────┘
```

**Width.** Read as: the Shelf and today's Output space *together* become about
35–40 % of what the two side panels take today (left 22 % + inspector 21 % =
43 % of the window, `App.tsx:502, 516`), i.e. about 16–17 % of the window:
~230 px at the default 1400 px window. Recommended Panel props:
`defaultSize="17" minSize={240} maxSize="30"` (strings are percent, numbers
are pixels in react-resizable-panels 4.12.4,
`node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts:198-201,
293-295`). 240 px is the floor because the fixed chrome of a `Slider` row is
116 px (`Slider.tsx:40,50`), a `Keyframes` row ~146 px, the Camera direction
rows ~160 px, and `ColourCurve` is a 150 px square (`ColourCurve.tsx:26`, which
moves to the tray anyway). **This reading is Question 1** — the other reading
(35–40 % of the *window*) gives the preview no more room than today.

**Geometry.** The left column runs full height and the timeline sits under the
preview only (it does not run under the Shelf). The sketch draws an L (timeline
under the sidecar, preview down to EXPORT at bottom right), but the user's
answer moved OUTPUT and EXPORT to the left with the sidecar, and stacking
four things in a column that is only the top 62 % tall does not fit at the
680 px minimum window height (`src/main/index.ts:86-87`). **Question 2.**

What the preview gains, at 1400×900: today 60 % − 36 px toolbox ≈ 804 px wide
(`App.tsx:506-513`, `Toolbox.tsx:208` `w-9`); after, ≈ 1400 − 240 − 36 ≈ 1124 px.
The timeline also gets wider (≈1160 px against ≈1008 px today), because the
curve panel's 28 % (`App.tsx:539`) collapses to a 28 px rail.

**Height budget at the minimum window (1100×680).** Header 36 px; the source
row (`App.tsx:497`) is gone. Left column ≈ 644 px: two collapsed strip headers
56 px, leaving ≈ 588 px for Shelf + dock. Dock default 55 % ≈ 323 px (waveform
112 px, `LeftPanel.tsx:137` `h-28`, + ≈ 211 px of clip editor, scrolling). Shelf
≈ 265 px: the 19 tiles at three per row in a 240 px column are seven rows; the
home grid scrolls when the dock is open. Shelf and dock share a vertical
react-resizable-panels Group so the split can be dragged.

**Style.** Neumorphism (soft raised / pressed box-shadows) for the tiles and the
big buttons only; timeline, waveform, preview stay flat. **Base: a LIGHT cream,
with a faint paper-like texture** (the user, 2026-10-02, answering §7: "remove
the orange and make the background light cream like texture") — so the app
leaves its dark `ink` palette for a light one, which is also where neumorphism
reads best. **The orange (`flame`) accent goes; the accent is the 3dit blue** (the
tokens are `accent-*` since step 3). Video clips wore blue (`src/shared/edit/clipKind.ts`) and
`tests/voiceAndKinds.test.ts` forbids a clip kind wearing the accent, so in step 3 video moved to
violet and graphics to green (sky was tried first: its -700 border is 0.105 from accent-400 in
OKLab). The pressed state changes colour and
icon as well as shadow, never shadow alone (user-working-preferences /
forge-ui-relayout memory). The texture is one small tiled noise image on the
page background only, never on controls, so it costs nothing to paint. No `transform`, `filter`
or `backdrop-filter` on any ancestor of the three `fixed inset-0` overlays
(`Inspector.tsx:631, 1245`, `TextStylePicker.tsx:90`): any of those would become
their containing block and trap the font picker inside a strip.

---

## 3. Every control's new home

Legend for **how**: *move* = same component, new parent; *restyle* = same
behaviour, new look or new container; *build* = new code; *drop* = removed (nothing
is lost by it); *coming-soon* = shown, disabled, labelled.

### 3.1 Header and app shell

| control | today | new home | how | note |
|---|---|---|---|---|
| Project name, unsaved dot, path | `App.tsx:64` | unchanged | — | |
| Build stamp | `App.tsx:78` | unchanged | — | already `no-drag` |
| "AI" sidecar status dot | `App.tsx:84` | settings panel (dot on the ⚙ gear + "AI helper (Python)" row inside) | move | the gear MUST carry `no-drag` (header is `.drag-region`, `App.tsx:72`, `styles.css:67-72`); the dot today does not |
| Recovery banner, Recover / Discard | `App.tsx:432` | unchanged | — | |
| Exit full screen button | `App.tsx:473` | unchanged | — | pinned, `tests/fullScreen.test.ts:58-63` |
| Escape leaves full screen | `App.tsx:119` | unchanged | — | new overlays must mark their Escape handled |
| Shortcuts sheet | `App.tsx:466`, `Shortcuts.tsx:82` | unchanged | — | |
| New Project dialog (name, shape, rate, start) | `App.tsx:485`, `NewProject.tsx:35, 56, 96, 118` | unchanged | — | |
| Toasts | `App.tsx:33` | unchanged | — | |
| Keyboard map | `App.tsx:326` | unchanged | — | |
| Menu router (export, zoomFit…) | `App.tsx:276` | unchanged | — | `export` still lands on the listener, which moves to ExportStrip |
| Panel layout | `App.tsx:499-544` | rebuilt: left column \| (CanvasBar + Toolbox/Preview) over (Transport/Timeline \| Curve tray) | restyle | |
| Divider | `App.tsx:21` | unchanged | — | |
| Source row (Upload / YouTube / Narration) | `App.tsx:497`, `SourceBar.tsx:68` | Shelf tiles Upload / URL / Narration | move | the row goes; its MODES copy goes to the tile registry |
| Crash screen | `ErrorBoundary.tsx:41` | unchanged, plus one boundary per tool panel inside the Shelf | restyle | today one throw in any of ~19 panels replaces the whole window (`main.tsx:67`) |

### 3.2 Sidecar (Shelf) home

| control | today | new home | how | note |
|---|---|---|---|---|
| Left-panel tab strip Media / Library / Transcript / Create | `LeftPanel.tsx:58` (tabs `11-34`) | Shelf home: tile grid | restyle | 19 tiles in the sketch's order (user: "order yes") |
| Media tab | `LeftPanel.tsx:12` | Shelf tile Upload | move | |
| Library tab | `LeftPanel.tsx:13` | Shelf tile Library | move | |
| Transcript tab | `LeftPanel.tsx:24` | Shelf tile Transcript | move | |
| Create tab ("auto") | `LeftPanel.tsx:33` | Shelf tiles Director … 3D props | move | the three names (Create / Automation / Auto) all go |
| Automation column header | `Automation.tsx:186` | — | drop | each tool has its own header |
| Tile busy badges | none | Shelf home | build | from `reelBuilding`, `gridBuilding`, `stripsBuilding`, `directing`, `baking`, `transcribing`, `pendingIngests` — a run started in a tile stays visible from Home |

### 3.3 Upload tile ("Upload and Import are same")

| control | today | new home | how | note |
|---|---|---|---|---|
| Upload mode | `SourceBar.tsx:26` | Shelf tile Upload | move | |
| Add files (orange) | `SourceBar.tsx:91` | Shelf tile Upload — one **Upload** big button | move | merged with Import below |
| + Import | `MediaPool.tsx:146` | Shelf tile Upload — the same Upload button | move | both call `pickMedia` → `importAssets` |
| Drop zone + "Drop to import" overlay | `MediaPool.tsx:129`, overlay `261-267` | Shelf tile Upload | move | existing bug: a pool-tile drag raises the overlay (no `isAssetDrag` check, `131-141`) — fix with the grouped view in phase 2 |
| Offline bar + Relink… | `MediaPool.tsx:160` | Shelf tile Upload | move | |
| Empty state | `MediaPool.tsx:176` | Shelf tile Upload | move | |
| Pool tile (drag source) | `MediaPool.tsx:190` | Shelf tile Upload | move | keep `poolPayload` (`21-29`) and `DRAG_MIME` (`shared/dragPayload.ts:10`) |
| Pool tile double-click → timeline | `MediaPool.tsx:194` | Shelf tile Upload | move | |
| Thumbnail | `MediaPool.tsx:39` | Shelf tile Upload | move | |
| Name / kind icon / duration / tooltip | `MediaPool.tsx:208` | Shelf tile Upload | move | |
| Transcribe progress / cancel chip | `MediaPool.tsx:222` | Shelf tile Upload | move | already a % chip: SHEETS.md sheet 22's "no progress bar" status is wrong |
| Transcribe button (pool) | `MediaPool.tsx:233` | Shelf tile Upload | move | tooltip → "The AI helper (Python) is not running"; already exists for pool items (sheet 22's status line says it does not) |
| Pool grouped by kind (images / videos / audio) | none (sheet 03) | Shelf tile Upload | build | phase 2 |
| Image presets Warm / B&W / Shades | none (sheet 05) | Shelf tile Upload (image rows) | build | phase 2; nearest today: Looks `Inspector.tsx:1124` |
| Audio row Speed / Voice change | none (sheet 06) | Shelf tile Upload (audio rows) | build / coming-soon | phase 2; see Decision 4 on Voice |

### 3.4 URL tile

| control | today | new home | how | note |
|---|---|---|---|---|
| YouTube mode | `SourceBar.tsx:33` | Shelf tile URL | move | label "URL"; store id `'youtube'` (`store.ts:207`) goes with `sourceMode` |
| Link input | `IngestPanel.tsx:132` | Shelf tile URL | move | |
| Get | `IngestPanel.tsx:143` | Shelf tile URL | move | |
| Link-problem message | `IngestPanel.tsx:165` | Shelf tile URL | move | |
| Video / Audio / Instrumental / Vocal | `IngestPanel.tsx:173` | Shelf tile URL | move | sheet 07's MP4/MP3/Vocal/Instrumental already exist here |
| Quality 4K/1080p/720p/480p | `IngestPanel.tsx:191` | Shelf tile URL | move | |
| m4a / mp3 + split note | `IngestPanel.tsx:208` | Shelf tile URL | move | |
| Just a part of it | `IngestPanel.tsx:236` | Shelf tile URL | move | |
| From / To fields + length | `IngestPanel.tsx:250, 263, 271` | Shelf tile URL | move | keep `MIN_RANGE_MS` (`36`) for any multi-range UI |
| Fast cut / Exact cut | `IngestPanel.tsx:276` | Shelf tile URL | move | |
| "N downloads running — progress is in the panel on the right" | `IngestPanel.tsx:302` | Shelf tile URL | restyle | reword: "progress is under EXPORT, on the left" at step 7, "bottom left" once step 8 puts the strips at the foot of the column (Decision 7) |
| First-download yt-dlp note | `IngestPanel.tsx:309` | Shelf tile URL | move | |
| Get metadata, chapters, several ranges, Get transcript | none (sheet 07) | Shelf tile URL | build | phase 2 |
| Best clips | none (sheet 09) | Shelf tile URL | build | phase 3 |

### 3.5 Narration tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Narration mode ("soon") + not-built-yet + soon sentence | `SourceBar.tsx:38`, `84, 100, 107-111` | Shelf tile Narration | coming-soon | reword `SourceBar.tsx:43` "the only part … that needs paid services" — it will not be once keys live in Settings |

### 3.6 Library tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Search + count | `Library.tsx:141` | Shelf tile Library | move | |
| Asset packs button | `Library.tsx:150` | Shelf tile Library | move | keep the auto-open when the catalog is empty (`65-70`, WHERE-THINGS-ARE 42-47) |
| Rescan | `Library.tsx:159` | Shelf tile Library | move | |
| Kind chips Fonts/Props/Stickers/Transitions/Titles/SFX | `Library.tsx:168` | Shelf tile Library | move | opens on Fonts (`37`) where nothing can be clicked — Decision 9 |
| Sticker category chips | `Library.tsx:185` | Shelf tile Library | move | |
| Embedded PackList | `Library.tsx:231` | Shelf tile Library | move | progress only updates while mounted (`PackList.tsx:31`) |
| Nothing here / Get {kind} → | `Library.tsx:237` | Shelf tile Library | move | |
| Font tile | `Library.tsx:357` | Shelf tile Library | move | |
| SFX row (audition / drag) | `Library.tsx:399` | Shelf tile Library | move | its trimmer is the dock (3.17) |
| Prop / sticker / title / transition tile | `Library.tsx:427` | Shelf tile Library | move | also reached from Text (titles), 3D props (props), Transitions (transitions) |
| Infinite-scroll sentinel | `Library.tsx:285` | Shelf tile Library | move | |
| PackList: Check for newer | `PackList.tsx:41` | Shelf tile Library | move | |
| PackList: status messages | `PackList.tsx:50` | Shelf tile Library | move | |
| PackList: Install / Cancel / Remove | `PackList.tsx:139` | Shelf tile Library | move | |
| PackList: progress bar | `PackList.tsx:159` | Shelf tile Library | move | |

### 3.7 Transcript tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Select-a-clip empty state | `TranscriptPanel.tsx:49` | Shelf tile Transcript | move | still bound to the selected timeline clip; asset-keyed transcript is phase 3 |
| Language · N words | `TranscriptPanel.tsx:63` | Shelf tile Transcript | move | |
| Edit / Done | `TranscriptPanel.tsx:66` | Shelf tile Transcript | move | |
| Segment row (seek) | `TranscriptPanel.tsx:99` | Shelf tile Transcript | move | |
| Editable word | `TranscriptPanel.tsx:166` | Shelf tile Transcript | move | |
| Word correction input | `TranscriptPanel.tsx:183` | Shelf tile Transcript | move | |
| No transcript yet | `TranscriptPanel.tsx:121` | Shelf tile Transcript | restyle | its text points at "the caption button in Media" → "in Upload" |
| Listen for (vocabulary) | `TranscriptPanel.tsx:220` | Shelf tile Transcript | move | |
| Transcribe / again with these words | `TranscriptPanel.tsx:230` | Shelf tile Transcript | move | |
| Row selection + Clip it | none (sheet 08) | Shelf tile Transcript | build | phase 3, first of the three |

### 3.8 Director tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Director section | `Director.tsx:152`, mounted `Automation.tsx:191` | Shelf tile Director | move | |
| Product | `Director.tsx:168` | Shelf tile Director | move | |
| Recipe + intent line | `Director.tsx:180` | Shelf tile Director | move | |
| More · N set | `Director.tsx:206` | Shelf tile Director | move | |
| Benefit / Audience / Tone / CTA / Length / Language | `Director.tsx:219, 227, 235, 248, 256, 270` | Shelf tile Director | move | Field label `w-16` (`35`) is fine at 240 px |
| Your pictures, in order + notes | `Director.tsx:282, 289` | Shelf tile Director | move | the Director's source picker; it cannot leave an item out (phase 2) |
| Model status row | `Director.tsx:311` | Shelf tile Director | move | stays, so Direct is never pressed blind |
| Model settings gear | `Director.tsx:326` | Shelf tile Director (opens the settings panel) | restyle | |
| Direct / Direct again | `Director.tsx:402` | Shelf tile Director | move | |
| Clear | `Director.tsx:410` | Shelf tile Director | move | |
| Result box + notes | `Director.tsx:417` | Shelf tile Director | move | |
| N clips placed | `Director.tsx:448` | Shelf tile Director | move | |

### 3.9 Settings panel (top right)

| control | today | new home | how | note |
|---|---|---|---|---|
| Provider Auto / Ollama / LM Studio-or-Hosted | `Director.tsx:334` | settings panel | move | `modelPicker` (`115-149`) moves with it |
| Ollama Server + Model | `Director.tsx:348` | settings panel | move | |
| OpenAI-shaped Server + Model | `Director.tsx:361` | settings panel | move | |
| Key (write-only) + Save + Clear | `Director.tsx:370` | settings panel | move | keep write-only: only `hasKey` is read back (`375`) |
| Check again | `Director.tsx:395` | settings panel | move | the panel calls `refreshDirector` on open; Director keeps its mount call (`66-68`) |
| AI helper (Python) status | `App.tsx:84` (`sidecarReady`/`sidecarError`) | settings panel | move | |
| Hosted voice (base URL, model, voice, key) | settings file only (`src/main/store.ts:25`), no UI | settings panel | coming-soon | phase 3 (Narration): needs a write-only IPC like the Director's |
| Pexels key | none | settings panel | coming-soon | phase 3 |

### 3.10 Beat sync / Cut to words tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Beat-synced reel header + photo count | `Automation.tsx:194` | Shelf tile Beat sync | move | |
| Music: MusicRange or Add music | `Automation.tsx:207` | Shelf tile Beat sync | move | Add music only imports (`174-182`); placing it is the phase-2 source picker |
| MusicRange name + readout | `MusicRange.tsx:175` | Shelf tile Beat sync | move | |
| MusicRange handles | `MusicRange.tsx:194` | Shelf tile Beat sync | move | keep the callback-ref observer (`49-60`) |
| MusicRange Use all | `MusicRange.tsx:219` | Shelf tile Beat sync | move | |
| Motion slider | `Automation.tsx:220` | Shelf tile Beat sync | move | also read by One photo (`store.ts:2171`) |
| Depth parallax checkbox | `Automation.tsx:236` | Shelf tile Beat sync (mirrored in Depth/Parallax) | move | same store field `reelParallax` in both |
| Cut to the words | `Automation.tsx:256` | Shelf tile Beat sync | move | |
| Transitions slider | `Automation.tsx:278` | Shelf tile Beat sync | move | also read by One photo |
| Analyse & build / Rebuild | `Automation.tsx:295` | Shelf tile Beat sync | move | guard copied verbatim: `reelBuilding \|\| gridBuilding \|\| images === 0 \|\| !musicClip` (`297`) |
| Stop | `Automation.tsx:303` | Shelf tile Beat sync | move | |
| Clear | `Automation.tsx:311` | Shelf tile Beat sync | move | |
| Progress block | `Automation.tsx:321` | Shelf tile Beat sync | move | |
| Orientation mismatch banner + Switch | `Automation.tsx:342` | canvas | move | see 3.15 |
| Notes (import photos / N placed) | `Automation.tsx:358` | Shelf tile Beat sync | move | |

### 3.11 One photo tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Caption textarea | `Automation.tsx:387` | Shelf tile One photo | move | |
| Build from one photo | `Automation.tsx:400` | Shelf tile One photo | move | guard verbatim (`402`) |
| Clear | `Automation.tsx:408` | Shelf tile One photo | move | |
| "Uses the selected photo, or the first one" | `Automation.tsx:418` | Shelf tile One photo | restyle | becomes the "Uses:" line; `buildOnePhotoReel(assetId?)` (`store.ts:528`) already takes an id |
| Motion + Transitions (shared with Beat sync) | `Automation.tsx:220, 278` | Shelf tile One photo (mirror) | move | One photo reads both and has no control of its own; without a mirror it loses two options |
| Progress + Stop (shared reel state) | `Automation.tsx:303, 321` | Shelf tile One photo (mirror) | move | shares `reelBuilding`/`reelStage`/`reelCancelled` (`store.ts:2207, 2328`) |

### 3.12 Grid split tile

| control | today | new home | how | note |
|---|---|---|---|---|
| Pieces (rows × cols) | `Automation.tsx:441` | Shelf tile Grid split | move | |
| Square / Circle / Waves | `Automation.tsx:457` | Shelf tile Grid split | move | |
| Order | `Automation.tsx:474` | Shelf tile Grid split | move | |
| Landing | `Automation.tsx:489` | Shelf tile Grid split | move | |
| Cadence | `Automation.tsx:505` | Shelf tile Grid split | move | |
| Gutter | `Automation.tsx:520` | Shelf tile Grid split | move | |
| Tilt | `Automation.tsx:536` | Shelf tile Grid split | move | |
| Build grid | `Automation.tsx:553` | Shelf tile Grid split | move | guard verbatim (`558`); `buildGrid(assetId?)` (`store.ts:697`) |
| Clear | `Automation.tsx:568` | Shelf tile Grid split | move | |
| Music vs even cadence note | `Automation.tsx:578` | Shelf tile Grid split | move | |

### 3.13 Strip flashes / Film strip / 3D props tiles

| control | today | new home | how | note |
|---|---|---|---|---|
| Strips layout Columns/Bands/Diagonal | `Automation.tsx:602` | Shelf tile Strip flashes | move | |
| Slices | `Automation.tsx:619` | Shelf tile Strip flashes | move | |
| At once | `Automation.tsx:635` | Shelf tile Strip flashes | move | |
| Rate | `Automation.tsx:651` | Shelf tile Strip flashes | move | |
| Look | `Automation.tsx:666` | Shelf tile Strip flashes | move | |
| Stutters | `Automation.tsx:682` | Shelf tile Strip flashes | move | |
| Add flashes | `Automation.tsx:699` | Shelf tile Strip flashes | move | guard verbatim (`701`); its input is a timeline shot, not a pool item |
| Clear | `Automation.tsx:707` | Shelf tile Strip flashes | move | |
| "Uses the shot under the playhead" | `Automation.tsx:717` | Shelf tile Strip flashes | restyle | the "Uses:" line |
| Filmstrip Panels | `Automation.tsx:737` | Shelf tile Film strip | move | |
| Filmstrip Length | `Automation.tsx:753` | Shelf tile Film strip | move | UI 1–12 s vs store 1–15 s (`store.ts:3535`) — leave as is |
| Build strip | `Automation.tsx:770` | Shelf tile Film strip | move | |
| Clear | `Automation.tsx:778` | Shelf tile Film strip | move | |
| Props On/Off | `Automation.tsx:798` | Shelf tile 3D props | move | |
| Frequency | `Automation.tsx:815` | Shelf tile 3D props | move | |
| Place props | `Automation.tsx:832` | Shelf tile 3D props | move | gate is "any transcript" but the rule reads video-track transcripts only (`shared/automation/apply.ts:52-57`) — note, not fixed in phase 1 |
| Clear | `Automation.tsx:840` | Shelf tile 3D props | move | |
| Warnings | `Automation.tsx:850` | Shelf tile 3D props | move | |
| Why these fired | `Automation.tsx:865` | Shelf tile 3D props | move | |

### 3.14 One-click tools: Text, Colour cards, Grade, Newspaper clipping, Card ring, Transitions, Depth/Parallax

| control | today | new home | how | note |
|---|---|---|---|---|
| + Text | `LeftPanel.tsx:82` | Shelf tile Text | move | panel: + Text card, "title templates → Library · Titles", count on timeline; its editor is in the dock |
| + Colour | `LeftPanel.tsx:88` | Shelf tile Colour cards | move | editor (colour + opacity, `Inspector.tsx:1379`) in the dock |
| + Grade | `LeftPanel.tsx:95` | Shelf tile Grade | move | panel says: Colour, Looks, .cube are in the dock; the tone curve is in the Curve tray |
| + Newspaper clippings | `LeftPanel.tsx:109` | Shelf tile Newspaper clipping | move | PaperPanel in the dock |
| + Card ring | `LeftPanel.tsx:116` | Shelf tile Card ring | move | uses the first 12 pool photos (`store.ts:2638-2648`) — said in the "Uses:" line |
| Transitions (library drawer) | `Library.tsx:168` (kind `transition`, `KINDS 13-20`) | Shelf tile Transitions | move | the tile opens Library on Transitions; Library keeps the chip too |
| Depth/Parallax tile | none (reel checkbox `Automation.tsx:236`; Camera Depth `CameraPanel.tsx:64`) | Shelf tile Depth/Parallax | build | phase 1: a pointer panel that mirrors the reel toggle and says where Depth lives; "bake this photo" on `bakeParallax` (`store.ts:4683`) is phase 2 — Decision 5 |
| Text on the picture (Toolbox) | `Toolbox.tsx:149` | canvas (unchanged) | — | |

### 3.15 Canvas

| control | today | new home | how | note |
|---|---|---|---|---|
| Aspect 16:9 / 9:16 / 1:1 | `Inspector.tsx:391` | canvas (CanvasBar) | move | 1:1 kept as the third, smaller option — Decision 1 |
| "Changing this re-solves every clip's reframe" | `Inspector.tsx:409` | canvas (tooltip) | restyle | |
| Preview Source / Split / Output | `Inspector.tsx:497` | canvas (CanvasBar) | move | view state (`splitRatio`), never the dead `previewMode` |
| "Drag the divider…" hint | `Inspector.tsx:518` | canvas (tooltip) | restyle | |
| Orientation mismatch + Switch | `Automation.tsx:342` (computed `148-158`) | canvas (chip beside the shape switch) | move | computed by a pure function so it is testable; serves every photo tool, not just the reel |
| Select / Reframe / Thirds / Safe / Text / Mask / Blur / Paint | `Toolbox.tsx:114, 122, 133, 141, 149, 173, 184, 195` | canvas (unchanged) | — | |
| Drop onto the picture | `Preview.tsx:1004, 1953` | canvas (unchanged) | — | |
| Drop chip Fill / PiP / blurred | `Preview.tsx:2047` | canvas (unchanged) | — | |
| Reframe rectangle | `Preview.tsx:1986` | canvas (unchanged) | — | reader-flagged misplacement at split 0 (`1327-1337`, `1753-1759`) is pre-existing; check it in the harness at step 4 |
| Text, transform, mask, key-pick overlays | `Preview.tsx:1991, 2000, 2013, 2023` | canvas (unchanged) | — | |
| "Not at this moment — go to it" | `Preview.tsx:2076` | canvas (unchanged) | — | |
| Split divider + labels | `Preview.tsx:2086, 2090` | canvas (unchanged) | — | |
| No clip under the playhead | `Preview.tsx:2107` | canvas (unchanged) | — | |
| Empty-canvas text "or open Create and press Direct" | `Preview.tsx:1704`, text `1715` | canvas | restyle | → "or open Director and press Direct" |
| Live captions | `Preview.tsx:1723` | canvas (unchanged) | — | its font ensure moves to the app shell (3.19) |
| Playback / mixer loop | `Preview.tsx:1785` | canvas (unchanged) | — | the Preview must never remount on a shape switch |

### 3.16 Output strip

| control | today | new home | how | note |
|---|---|---|---|---|
| Frame rate 24/25/30/50/60 | `Inspector.tsx:420` | output strip | move | re-point `tests/frameRate.test.ts:160-161` |
| Loudness Off / -14 / -16 / -23 | `Inspector.tsx:452` | output strip | move | keep two columns (`454-459`) |
| Captions On/Off | `Inspector.tsx:540` | output strip | move | |
| Captions Reset edits | `Inspector.tsx:533` | output strip | move | |
| Caption presets | `Inspector.tsx:567` | output strip | move | |
| Caption Style picker | `Inspector.tsx:604` | output strip | move | `captionSample` (`166-180`) moves with it |
| Caption Animation picker | `Inspector.tsx:609` | output strip | move | |
| Caption Font + FontPicker overlay | `Inspector.tsx:615, 628` | output strip | move | overlay stays `fixed inset-0`; strip must not use transform |
| Caption Size / Words | `Inspector.tsx:659, 669` | output strip | move | |
| Caption Place / Margin | `Inspector.tsx:687, 706` | output strip | move | |
| Caption Colour (words · spoken) | `Inspector.tsx:719` | output strip | move | |
| Drawn-captions notice | `Inspector.tsx:741` | output strip | move | |
| Nothing transcribed yet | `Inspector.tsx:759` | output strip | move | |
| Collapsed summary ("30 fps · -14 LUFS · captions on") | none | output strip | build | so a closed strip still tells you what the file will be; the ASCII minus, as the Loudness buttons write the number (`shared/project/outputSummary.ts`) |
| 3×3 caption style grid | none (sheet 11) | Shelf tile Narration | build | phase 2/3 |

### 3.17 Export strip

| control | today | new home | how | note |
|---|---|---|---|---|
| Inspector 'Output' title | `Inspector.tsx:377` | — | drop | the strips have their own headers |
| Export settings (Size, Codec, Quality, Mbps, Speed, Audio, File) | `Inspector.tsx:767`, `ExportSettings.tsx:82, 101, 124, 146, 170, 189, 203` | export strip | move | check the `grid-cols-4` rows (`124, 170`) at 240 px |
| Only between the marks | `ExportSettings.tsx:219` | export strip | move | `useRange` state moves with onExport |
| Export button | `Inspector.tsx:770` | export strip (in the header, visible when collapsed) | move | |
| + Save current | `Inspector.tsx:793` | export strip | move | |
| Saved preset rows | `Inspector.tsx:818` | export strip | move | |
| Preset remove X | `Inspector.tsx:833` | export strip | move | |
| Exports job list | `Inspector.tsx:1712` | export strip (running job's bar also in the collapsed header) | move | shows downloads too — Decision 7 |
| onExport flow | `Inspector.tsx:218` | export strip | move | moved verbatim; re-point `tests/exportB2.test.ts:296-341` |
| File > Export listener | `Inspector.tsx:367` | export strip (component always mounted) | move | collapse hides the body by class, never by unmount |

### 3.18 Trimmer dock (shown only when a clip — or a Library sound — is selected)

| control | today | new home | how | note |
|---|---|---|---|---|
| Waveform dock (always on) | `LeftPanel.tsx:137` | trimmer dock | move | the "always visible" comment (`134-136`) goes; shows on selection only |
| Waveform empty states | `Waveform.tsx:252` | trimmer dock | move | |
| Audition header / handles / Add at playhead | `Waveform.tsx:264, 284, 305` | trimmer dock | move | dock shows for `audition` too, or the only trim-before-the-timeline is lost; nothing ever calls `setAudition(null)` today — the dock's X and the Library tile closing do |
| Clip header / source timecode | `Waveform.tsx:324` | trimmer dock | move | |
| Clip in/out handles | `Waveform.tsx:345` | trimmer dock | move | |
| Waveform canvas | `Waveform.tsx:121` | trimmer dock | move | |
| 'Clip' header | `Inspector.tsx:848` | trimmer dock | move | |
| Name / Start / End | `Inspector.tsx:854` | trimmer dock | move | |
| Duration slider | `Inspector.tsx:859` | trimmer dock | move | 0.2–15 s only; overlaps the Trimmer later |
| Source in / Reframe | `Inspector.tsx:874` | trimmer dock | move | |
| Size / Opacity / X / Y / Rotate | `Inspector.tsx:886` | trimmer dock | move | |
| Speed panel | `Inspector.tsx:937`; `SpeedPanel.tsx:30, 39, 58, 74, 84, 103` | trimmer dock | move | |
| Steady | `Inspector.tsx:940`; `SteadyToggle.tsx:19` | trimmer dock | move | stays in `Inspector.tsx` — `tests/steady.test.ts:112-115` |
| Camera (None/Move/Shake/Depth, rows, Amount, Rate/Settle, Hold, notes) | `Inspector.tsx:943`; `CameraPanel.tsx:64, 78, 95, 115, 128, 145, 165` | trimmer dock | move | stays in `Inspector.tsx` — `tests/camera.test.ts:165-169` |
| Paper (word, mode, shape, typewriter, looks, pages, customise) | `Inspector.tsx:946`; `PaperPanel.tsx:49, 63, 87, 109, 125, 145, 171` | trimmer dock | move | |
| Card ring (count, geometry, spin, tilt/roll, facing) | `Inspector.tsx:949`; `CarouselPanel.tsx:25, 32, 74, 88, 105` | trimmer dock | move | |
| Sound: Mute | `Inspector.tsx:964` | trimmer dock | move | |
| Sound: Level fader | `Inspector.tsx:983` | trimmer dock | move | |
| Envelope-overrides-fader note | `Inspector.tsx:998` | trimmer dock | move | stays beside the fader — `tests/audioSurface.test.ts:780-783` |
| Crossfade with the clip before | `Inspector.tsx:1015` | trimmer dock | move | |
| Mask (Add, Edit on picture, Remove, Animate, prev/next, shape, mode, sliders) | `Inspector.tsx:1030`; `MaskPanel.tsx:62, 88, 119, 168, 186, 203` | trimmer dock | move | modal with the preview: the dock stays open while a clip is selected |
| Key (Add, Remove, swatch, Pick, Range/Soften/Despill) | `Inspector.tsx:1033`; `KeyPanel.tsx:30, 53, 90` | trimmer dock | move | order Mask < Key < Colour Reset pinned — `tests/chromaKey.test.ts:219-228` |
| Colour Reset | `Inspector.tsx:1043` | trimmer dock | move | |
| Temp / Tint / Bright / Contrast / Saturate | `Inspector.tsx:1057` | trimmer dock | move | plus a "Tone curve…" link that opens the Curve tray on Colour |
| LUT name + Remove + Intensity | `Inspector.tsx:1098` | trimmer dock | move | |
| Looks grid (7) | `Inspector.tsx:1124` | trimmer dock | move | list comes from the hoisted loader |
| or load your own .cube… | `Inspector.tsx:1147` | trimmer dock | move | |
| Text card textarea | `Inspector.tsx:1166` | trimmer dock | move | |
| Text layout presets | `Inspector.tsx:1181` | trimmer dock | move | |
| Text Style picker | `Inspector.tsx:1210` | trimmer dock | move | |
| Text Animation picker | `Inspector.tsx:1223` | trimmer dock | move | |
| Text font + FontPicker overlay | `Inspector.tsx:1234, 1244` | trimmer dock | move | |
| Text position / align | `Inspector.tsx:1261, 1277` | trimmer dock | move | |
| Text Size / Tracking / Weight / Shadow | `Inspector.tsx:1292` | trimmer dock | move | |
| Text Colour + CAPS | `Inspector.tsx:1326` | trimmer dock | move | |
| Text Outline + edge colour | `Inspector.tsx:1354` | trimmer dock | move | |
| Colour card colour + opacity | `Inspector.tsx:1379` | trimmer dock | move | |
| Fill with the picture below / put it back | `Inspector.tsx:1414` | trimmer dock | move | |
| Put behind the subject / put back together | `Inspector.tsx:1431` | trimmer dock | move | the first of the two "built but invisible" features — keep it on screen |
| Layout (Full frame, Stacked/Side by side, PiP shapes, corners) | `Inspector.tsx:1456`; `LayoutPanel.tsx:73, 85, 102, 115` | trimmer dock | move | |
| Reset to full frame | `Inspector.tsx:1511` | trimmer dock | move | |
| No clip selected | `Inspector.tsx:1528` | — | drop | the dock is hidden then |
| Title text lines | `Inspector.tsx:1532` | trimmer dock | move | |
| Transition in header + blends-from line | `Inspector.tsx:1554` | trimmer dock | move | the second "built but invisible" feature |
| Transition 'Select a clip' | `Inspector.tsx:1558` | — | drop | dock hidden |
| Transition count + library-did-not-load | `Inspector.tsx:1586` | trimmer dock | move | depends on the hoisted `loadTransitions` |
| Cut + family buttons | `Inspector.tsx:1597` | trimmer dock | move | |
| Tag filter chips | `Inspector.tsx:1635` | trimmer dock | move | |
| Transition select | `Inspector.tsx:1661` | trimmer dock | move | |
| Transition Length | `Inspector.tsx:1683` | trimmer dock | move | |
| FontPicker (search, rows) | `FontPicker.tsx:69, 106` | trimmer dock + output strip (hosts) | move | |
| TextStylePicker (Browse, None, tiles, gallery, Hero) | `TextStylePicker.tsx:58, 64, 75, 88, 170, 214` | trimmer dock + output strip (hosts) | move | Hero reads `canvas[data-forge-preview="1"]` (`237`, `Preview.tsx:1983`) — keep exactly one |
| TextAnimationPicker | `TextAnimationPicker.tsx:125` | trimmer dock + output strip (hosts) | move | |
| Voice presets (Chipmunk … Radio) | `ClipMenu.tsx:226` | unchanged (right-click) | — | built and exported; Decision 4 |
| Pool item selected → Trimmer as a source monitor | none (sheets 03, 21) | trimmer dock | build | phase 2 |

### 3.19 Curve tray (timeline sidebar, closed by default)

| control | today | new home | how | note |
|---|---|---|---|---|
| CurvePanel slot beside the timeline | `App.tsx:539` | timeline sidebar | restyle | a collapsible Panel: `collapsedSize` 28 px rail, opens to ~320 px |
| Motion / Colour tabs | `CurvePanel.tsx:61` | timeline sidebar | move | `CurvePanel.tsx` keeps its file and header class `flex h-7 shrink-0` |
| Property tabs (+ mask tracks) | `CurvePanel.tsx:81` | timeline sidebar | move | |
| Tone curve | `CurvePanel.tsx:116`; `ColourCurve.tsx:105, 136` | timeline sidebar | move | Decision 3 |
| Keyframe graph | `CurvePanel.tsx:122`; `CurveEditor.tsx:236, 264, 333` | timeline sidebar | move | |
| Keyframes rows (diamonds, sliders, key chips, ease, clear) | `Inspector.tsx:1458`; `Keyframes.tsx:44, 74, 95, 125` | timeline sidebar | move | `Keyframes.tsx` keeps its file — `tests/audioSurface.test.ts:762` |
| Motion path presets | `Inspector.tsx:1476` | timeline sidebar | move | extracted to `MotionPathPanel.tsx` |
| Add point at playhead / Clear path | `Inspector.tsx:1487` | timeline sidebar | move | |
| Rail dot "this clip is animated" | none | timeline sidebar | build | the tray never opens by itself |

### 3.20 App shell, no UI (must stay mounted)

| control | today | new home | how | note |
|---|---|---|---|---|
| Built-in looks fetch | `Inspector.tsx:113` | app shell (catalog store `looks`, loaded once from `App.tsx`) | move | add `builtInLooks` to the fallback bridge (`main.tsx:12-61`) since it becomes a startup call |
| Transition library load | `Inspector.tsx:135` | app shell (`App.tsx` effect) | move | Preview wipes (`Preview.tsx:412`) and Timeline labels (`Timeline.tsx:83, 921`) depend on it |
| Asset catalog load | `Inspector.tsx:182` | app shell (`App.tsx` effect) | move | `ensureFont` marks a family failed for good without it (`catalog.ts:109-114`) |
| Caption font ensure | `Inspector.tsx:186` | app shell (`App.tsx` effect) | move | the preview's live captions need it whether or not the strip is open |

### 3.21 Timeline, transport, clip menu — unchanged

Transport: start `Transport.tsx:48`, play `51`, end `54`, Loop `60`, Scrub audio `83`,
split `112`, delete `116`, master meter `126`, timecode `128`, zoom `133`.
Timeline: legend `Timeline.tsx:498`, mark in/out `516/523`, range `530`, +V/+A `547`,
eye `591`, mute `606`, solo `621`, record voice-over `640`, VO `675`, track meter `695`,
remove track `702`, ruler `755`, empty lane/marquee `814`, lane drop `851`, transition
chip `914`, clip body `971`, right-click `979`, waveform `1017`, envelope `1046`, trim
handles `1059`, fades `1084`, playhead `1120`, Shift+Z `424`, follow `403`.
On-clip parts: `VolumeEnvelope.tsx:170`, `FadeHandles.tsx:123`, `ClipWaveform.tsx:26`,
`Meter.tsx:69`. ClipMenu: clipboard `180`, Speed `195`, Voice `226`, Look `256`,
split/detach/select `283`, delete/ripple `305`.
`tests/clipOverlays.test.ts` pins Timeline.tsx class strings and counts
`cursor-[we]-resize` = 2: **the Curve tray must not be built inside Timeline.tsx.**

### 3.22 Store state touched by the move

| state | today | becomes | note |
|---|---|---|---|
| `sourceMode` / `SourceMode` | `store.ts:207, 371-372, 982-983` | replaced by `shelfTool: ShelfToolId \| null` (null = home) | `SourceBar.tsx` was its only reader; the "Only upload is built" comment is stale |
| `previewMode` / `setPreviewMode` | `store.ts:354, 902, 975, 4532` | dropped | dead: no reader in `src` or `tests` |
| `aspect` | `store.ts:352, 1288-1289` | unchanged, but undo/redo resync it | `undo`/`redo` (`1091-1111`) restore `project` and not `aspect`; a one-tap canvas switch makes that common |
| `selectedClipId(s)` | `store.ts:341-342` | unchanged; drives the dock | `revealClip` (`4510-4514`) sets only `selectedClipId`; `loadProject` (`4815`) does not clear `selectedClipIds`/`selectedGap`/marks, `newProject` (`4788-4812`) does |
| `audition` | `store.ts:435, 1521-1526` | unchanged; also drives the dock | |
| `exportRequests` | `store.ts:815, 4198` | unchanged | listener moves to ExportStrip |
| new: `outputOpen`, `exportOpen`, `trayOpen`, `trayTab`, `settingsOpen`, `shelfTool` | — | view state | not reset by newProject/loadProject; no localStorage (none in `src/renderer` today) |

---

## 4. Decisions the user has to make (no home in the sketches)

1. **Square 1:1.** `ASPECTS` has three shapes (`shared/render/aspect.ts:9-13`) and both
   the Output block (`Inspector.tsx:394`) and New Project (`NewProject.tsx:56`) offer
   1:1. The sketch's canvas switch shows only 16:9 and 9:16. Recommendation: a third,
   smaller "1:1" on the canvas switch.
2. **Preview Source / Split / Output** (`Inspector.tsx:497`) — not drawn anywhere.
   Recommendation: on the canvas bar beside the shape switch.
3. **The tone curve** (`CurvePanel.tsx:115-119`) is grading, not keyframes. Recommendation:
   it stays in the Curve tray's Colour tab (the user asked for "graphs" there) with a
   "Tone curve…" link in the dock's Colour section.
4. **Voice change.** Six presets already apply and export (`ClipMenu.tsx:226-254`,
   `shared/render/voice.ts:49-67`, `setVoice` `store.ts:3897`). Sheet 06 and the user's
   answer say "coming soon". Recommendation: keep the presets (right-click, and mirror
   them in the dock's Sound section); show "coming soon" only for the new effect the
   user means. SHEETS.md sheet 24's status "voice change do not [exist]" should be corrected.
5. **Depth / Parallax tile content.** No standalone control exists: depth is baked only by
   the reel's checkbox (`Automation.tsx:236`, `store.ts:2073-2083`) and by One photo
   (`store.ts:2222`); the Camera panel's Depth appears only once planes exist
   (`CameraPanel.tsx:64-66`). Recommendation: phase 1 pointer panel; phase 2 a
   "Bake depth for this photo" button on `bakeParallax` (`store.ts:4683-4714`).
6. **Orientation mismatch banner** (`Automation.tsx:342-356`) applies to every photo tool,
   not only the reel. Recommendation: a chip on the canvas bar.
7. **Download progress.** The Exports list shows downloads too, and IngestPanel points to
   "the panel on the right" (`IngestPanel.tsx:302-307`). Recommendation: export strip for
   now, reword; a per-tile download list in the URL tile in phase 2.
8. **Title templates** (Library 'title' kind) — sheet 02 has a Text tile but no Titles.
   Recommendation: Library keeps them; the Text tile links to Library · Titles.
9. **Library opens on Fonts** (`Library.tsx:37`), the one drawer where nothing can be
   clicked or dragged (`357-397`). As a tile that will read as broken. Recommendation:
   open on Stickers.
10. **Transport bar and tool strip** are not drawn on any sheet. Recommendation:
    unchanged (transport above the timeline, tool strip left of the picture).
11. **Asset packs** have no tile. Recommendation: stay inside Library (it auto-opens there
    when the catalog is empty, which an installed build always is at first launch).

---

## 5. What must keep working at every step

**Always mounted** (today they live in the Inspector, which is always mounted):
the export flow and the File > Export listener (`Inspector.tsx:218-373`); the transition
load; the catalog load and caption font; the looks list — all four moved to `App.tsx` and
`catalog.ts` in step 1 (the Inspector line numbers this plan quotes elsewhere are from `bd58eb5`
and have shifted up by about eighteen since).
**Never remounted**: the Preview (its rAF loop is the playback clock and the mixer,
`Preview.tsx:1785-1868`); exactly one `canvas[data-forge-preview="1"]`.
**Harness hooks**: `window.forgeStore`, `window.forgeCatalog` (`harness/main.tsx:36, 48`),
`__forgeEvalRelay`, `__forgeEvalCards`, `__forgeEvalMoments` and their progress globals
(`harness/evalRelay.ts:60, 122, 163, 200-202`), `__forgeMomentCheck`
(`harness/momentCheck.ts:170`), served by `vite.harness.config.ts` on 5199 with the eval
relay plugin. None of these reads the DOM; renaming store fields breaks ad-hoc scripts.
Any new startup `window.forge` call must exist in `harness/bridge.ts` and in the fallback
bridge (`main.tsx:12-61`).

**Tests that pin the structure, and what happens to each**

| test | pins | phase-1 action |
|---|---|---|
| `tests/camera.test.ts:165-169` | CameraPanel line in `Inspector.tsx`, exactly one | none — Inspector.tsx keeps it |
| `tests/steady.test.ts:112-115` | SteadyToggle line in `Inspector.tsx` | none |
| `tests/chromaKey.test.ts:219-228` | Mask < Key < Colour Reset order in `Inspector.tsx` | tighten first: assert the `<MaskPanel clip={clip} />` anchor exists (a −1 there passes vacuously) |
| `tests/audioSurface.test.ts:780-783` | envelope note regex in `Inspector.tsx` | none |
| `tests/audioSurface.test.ts:754-765, 774-778` | `CurveEditor.tsx`, `Keyframes.tsx` expressions | none — files kept |
| `tests/audioSurface.test.ts:785-797`, `tests/fullScreen.test.ts:58-63` | App.tsx strings | keep byte-identical through every App.tsx edit |
| `tests/fullScreen.test.ts:65-70` | Escape shape in ClipMenu, Shortcuts | add `SettingsPanel.tsx` to the list |
| `tests/frameRate.test.ts:160-161` | `onClick={() => setFrameRate(rate)}` in Inspector.tsx | re-point to `OutputStrip.tsx` |
| `tests/exportB2.test.ts:296-341` | onExport slice + negatives in Inspector.tsx | re-point to `ExportStrip.tsx`; negatives (`327-334`) pass vacuously otherwise |
| `tests/keyframeGraph.test.ts:86-99` | CurvePanel header slice from `flex h-7 shrink-0` | tighten first: assert both anchors exist |
| `tests/maskKeyframes.test.ts:230-247` | CurvePanel / CurveEditor / MaskPanel strings | none — files kept |
| `tests/clipOverlays.test.ts:29-99` | Timeline.tsx classes and counts | none — Timeline.tsx untouched |
| `tests/moment.test.ts:604-621` | store.ts `setAspect` (2500-char window), `rebakeGenerated` | do not add code inside those windows; the undo fix sits before them (`1091-1111`) |
| `tests/tailwindSources.test.ts:39-47` | classes only under `src/renderer` or `@source` | tile registry lives in `src/renderer` |
| `tests/voiceAndKinds.test.ts:144-249` | no clip kind wears the accent | step 3: forbids `blue` and `accent` by name, and every shade a kind's classes use (-300 body, -400 border, -700 selected border, -500 dot) ≥ 0.12 from accent-500, -400 and -300 in OKLab (indigo is a different name for nearly the same colour, and a sky -700 border passed a -500-only check) |

---

## 6. Phase 1 build plan — the layout and the Shelf home

Each step is its own commit and push, and leaves the app working and every control
reachable. Every step ends the same way:

```
npm run typecheck
npm test > "$TMPDIR/test.txt" 2>&1; echo "exit=$?"     # read the file; never pipe into grep
npm run build
git commit … && git push                                 # then read CI at github.com/spyki-a/forge/actions (Windows)
```

and the harness check, in the Browser pane (`preview_start` name `harness`, or
`npm run harness`; http://localhost:5199):

```js
// every step
[typeof forgeStore?.getState, typeof forgeCatalog?.getState, typeof __forgeEvalRelay,
 typeof __forgeEvalCards, typeof __forgeEvalMoments, typeof __forgeMomentCheck]   // all 'function'
(await __forgeCensus()).missing  // [] — nothing lost (step 0 adds it; ~30 s, fronted tab only)
// + read_console_messages onlyErrors: none; screenshots at 1400×900 and 1100×680
```

Every new regression test is mutation-checked: put the bug back, watch it fail, restore.
Anchors are counted with `matchAll` before being trusted.

### Step 0 — Guards and a census before anything moves · DONE 2026-10-02, `91971df`
- **Files:** `tests/keyframeGraph.test.ts` (both slice anchors asserted `> -1` first; the old
  test passed on an empty slice) and `tests/chromaKey.test.ts` (the MaskPanel, KeyPanel, Colour
  Reset, key and white-balance anchors asserted; `graphOf` asserts exactly one `-filter_complex`
  — without it the negatives matched `args[0]`); new `tests/fixtures/ui-census.json` — 592 rows,
  one per control: `label`, `match` (text / title / aria-label / placeholder), `home`, `needs`
  (87 states, each a recipe), `file:line`, `newHome`, and where a label is the static half of a
  longer text `part: true`, where several controls share it a measured `count`; new
  `src/renderer/src/harness/census.ts` installing `window.__forgeCensus()`; harness `bridge.ts`
  keeps the menu and full-screen listeners and adds `window.forgeMenu(cmd)` /
  `window.forgeFullScreen(on)` so File › New and Exit full screen are reachable; new
  `tests/uiCensus.test.ts`.
- **How the census counts** (the first version searched `innerText` for a substring, and a
  verifier hid fifty controls one at a time without it noticing — "Key" was found in "Keyframes",
  "Direct" in "Director"): for every `needs` it starts from a fresh project, builds that state
  through the store, opens the home, and counts carriers INSIDE the home's own elements — a text
  node whose whole text is the label, or an attribute whose whole value is. What is counted is how
  many carriers the state ADDS over an empty project, and it must equal `count`: fewer is
  `missing`, more is `ambiguous` (something else wears the label, so the control could go
  unnoticed). A scenario that cannot be built THROWS; so does a layout the home finders do not
  recognise. The result is `{ missing, ambiguous, checked, skipped, ms, scenario }`; ~30 s,
  fronted tab only. Rows the harness cannot show (the recovery banner, the crash screen, two
  canvas texts) carry `harnessOnly: false` and are pinned to their file by the node test instead.
- **The node test** matches labels against string literals, template pieces and JSX text from a
  TypeScript parse (entities decoded), never comments or identifiers; whole literal, or a
  word-bounded part when the row says so. It cannot tell two literals with the same words apart
  (121 rows such as Cut, Clear, Key survive deleting one site); the harness census is the guard
  for those.
- **Mutations done:** header class → keyframeGraph fails (the old test passed); each chromaKey
  anchor broken in turn → fails; `-filter_complex` renamed → the unkeyed-clip negative fails (the
  old one passed); "Put behind the subject" renamed → uiCensus fails and the harness census
  reports it absent; three more labels from three areas; an empty, a short, a duplicate and an
  unknown-needs row each trip their own rule; in the harness: hiding controls by CSS, a no-op
  menu, a missing drag region, unscoped roots — each reported.
- **Check:** `(await __forgeCensus()).missing` is `[]` on today's layout (584 checked, 8
  skipped); baseline rects of `canvas[data-forge-preview="1"]` and screenshots at 1400×900 and
  1100×680, 16:9 and 9:16, in the scratchpad (`step0-baseline.json`): at 1400×900 the canvas is
  778×512 px, the 16:9 frame 778×438, the 9:16 frame 288×512 — the numbers step 8 must beat.

### Step 1 — Hoist the Inspector's startup loads into the app shell
- **Files:** `src/renderer/src/catalog.ts` (add `looks` + `loadLooks()` calling `builtInLooks` once);
  `App.tsx` (effects: `loadTransitions()`, catalog `load()`, `loadLooks()`, and `ensureFont` of the
  resolved caption style); `Inspector.tsx` (drop `113-115`, `135-137`, `182-188`; read `looks` from the
  catalog); `main.tsx` fallback bridge (`builtInLooks: async () => []`).
- **Tests:** new `tests/startupLoads.test.ts` (App.tsx contains each loader call; Inspector.tsx no longer
  contains `window.forge.builtInLooks(`). Mutation: remove `loadTransitions()` from App.tsx → fails.
  App.tsx pinned strings untouched.
- **Check:** with the Inspector still mounted nothing visible changes; `forgeCatalog.getState().catalog`
  is non-null with Library never opened; Looks grid still shows 7 buttons on a selected photo.
- **DONE 2026-10-02.** As planned, plus one bug the move uncovered: `ensureFont` recorded a family
  as "not in the catalog" FOR GOOD whenever it was asked before the catalog had loaded — and the
  default caption face (Anton, the `pop` style) was always asked that early, because `Preview.tsx`
  runs its caption-font effect before App's effects and before the Inspector's used to. So the
  caption font was never registered at launch, in the old code too. Fix: `ensureFont` returns
  false without caching while `catalog === null`, and App's effect asks again once the catalog
  lands (`catalog.ts`, pinned by `tests/startupLoads.test.ts`). The caption face is resolved with
  `activeCaptionStyle(project)`, the same function Preview draws with. Startup loads are counted
  as real call expressions over a TypeScript parse, so a loader in a comment or a string does not
  count. Verified in the harness: catalog non-null before Library is opened, Looks grid intact,
  census clean. Known soft spot, recorded by the verifier: the placement check accepts a loader
  call nested anywhere under the effect callback (a call in the cleanup or behind `if (false)`
  passes); the harness check is the guard for that. `ClipMenu.tsx` still fetches `builtInLooks`
  itself and could read the catalog's `looks`; left for step 9.

### Step 2 — Layout state, and three store fixes the new layout will lean on
- **Files:** `store.ts` — add `shelfTool`, `outputOpen`, `exportOpen`, `trayOpen`, `trayTab`,
  `settingsOpen` and setters; delete dead `previewMode`/`setPreviewMode` (`354, 902, 975, 4532`);
  `revealClip` also sets `selectedClipIds: [clipId]`; `loadProject` also clears `selectedClipIds`,
  `selectedGap`, `rangeIn`, `rangeOut` (as `newProject` does); `undo`/`redo` also set
  `aspect: aspectOf(project.settings)`. Keep `sourceMode` until step 9.
- **Tests:** new `tests/renderer/layoutState.test.ts` (setAspect 9:16 → undo → aspect 16:9 → redo 9:16;
  revealClip → selectedClipIds equals [id]; loadProject clears the selection). Each mutation-checked.
  `tests/moment.test.ts:604-621` must still pass (nothing added inside the setAspect/rebakeGenerated
  windows).
- **Check:** in the harness, Output → 9:16 then Cmd+Z: the picture goes back to landscape (today it
  stays portrait while the settings say 1920×1080).
- **DONE 2026-10-02.** As planned, plus a fourth fix a verifier measured: `revealClip` left a
  selected GAP selected beside the new clip (every add calls it), so a gap, then an add, then Delete
  closed the gap and kept the clip; it now clears `selectedGap` like `select()` does, with a test
  that fails on the old code. `ShelfToolId` (the 19 tile ids) and `TrayTab` are exported from the
  store beside `SourceMode`. Verified in the harness: 9:16 → undo → 16:9 with the settings and the
  picture following; redo → 9:16; `previewMode` gone; census clean. Noted, not fixed: a shape
  switch over text, cards, paper or moments makes N+1 history entries (one per repoint), so it
  takes N+1 undos to come back — a later step can wrap `setAspect`'s repoints in one begin/commit.

### Step 3 — Theme: light cream base, blue accent, every token defined, the tile primitives · DONE 2026-10-02
- **Decided (§7, 2026-10-02):** light cream background with a faint texture; the orange goes; the
  accent is the 3dit blue; video clips re-hued so no clip kind wears the accent.
- **Files:** `styles.css` (`@theme`: the `ink` scale becomes a LIGHT scale — the same token names, so
  the ~1,150 class sites keep working. **Correction:** this line first said "ink-950 the darkest text
  and ink-50 the cream page", which is backwards — it would have meant swapping ~1,000 class sites.
  Every ink step is used as a ROLE pair (surfaces 950 > 900 > 850 > 800 > 700, text 200 / 400 / 600 on
  them, text-ink-950 on the accent), so the scale is inverted in LIGHTNESS and keeps its names:
  ink-950 is the cream page and ink-50 the darkest ink; define ink-50/100/300/500/750, which those
  sites already use and which render today by inheritance; the `flame` tokens are renamed to
  `accent-*` across `src/renderer` and `src/shared` by a 1:1 codemod and the values re-hue them —
  accent-400/300 are DEEPER than 500 on cream, the higher-contrast variants, as the lighter
  flame-400/300 were on the dark page; shadow tokens for
  raised / pressed on cream; `box-shadow` added to the button transition list `186-191`; a tiled noise
  `background-image` on `body` only; rewrite the palette comment `15-30`, which records the opposite
  decision); `src/shared/clipKind.ts:59` video clips to a non-accent hue; new `components/ui/Tile.tsx`
  (`Tile`, `BigButton`: `aria-pressed`, pressed = colour + icon + inset shadow, no transform/filter);
  `src/main/index.ts:90` `backgroundColor` to the cream, so the window never flashes dark.
- **Tests:** new `tests/themeTokens.test.ts` — every `(text|bg|border|…)-(ink|accent)-NNN` used under
  `src/renderer` and `src/shared` (collected with `matchAll`) has a `--color-…` entry in `@theme`, and
  no `flame-` class remains. Mutation: delete `--color-ink-300` → fails. `tailwindSources` and
  `voiceAndKinds` stay green (the latter now against the blue accent).
- **Check:** before/after screenshots of every panel on the cream; zoom on tertiary text for contrast
  (text on cream needs ≥ 4.5:1 — measure the three greys); open a FontPicker → it still covers the
  whole window; the Preview's own black letterbox and the timeline stay flat and readable on cream.
- **Verified in the harness:** every panel screenshotted on the cream (empty app, each left tab,
  a photo and a text clip selected, the clip menu); an OKLCH scan of every element's computed
  colours found no orange left; 374 text elements measured, minimum 4.75:1 (tertiary on the
  hover surface); both full-window pickers cover the viewport exactly; census 584 checked, 0
  missing; console clean between markers. The selected text clip's border is yellow-700, an
  ochre, and the SFX kind's is amber-700 — yellows, not the orange, left for the user to judge.
- **As built (2026-10-02):** tokens per the role table in the `styles.css`
  palette comment (page #f6f2ea, primary #24211d, accent-500 #2563eb — the icon's #3b82f6 carries no
  text on cream either way, 3.29:1 / 4.36:1 — plus accent-900 #dce8ff for pressed, `stage` #0b0d10,
  and `shadow-raised`, `-raised-sm`, `-pressed`); 192 `-flame-NNN` strings renamed (28 classes +
  `var(--color-flame-500)` + the 3 tokens), 15 orange literals re-pointed by hand (canvas, SVG and
  the overlays drawn on the video), 40 status texts moved to their -800 steps (red-400 is 2.46:1 on
  cream), cream-on-accent opacity modifiers dropped, `text-ink-700` text moved to ink-600 (700 is a
  border tone now). The grain only shows because the page roots stopped painting: App's root and the
  header, SourceBar, LeftPanel, MediaPool, Library, Automation, Inspector and Toolbox roots are
  transparent; timeline, transport, curve tray, preview, waveform, sheets and controls stay opaque.
  Clip kinds share one light recipe (`-300/50` body, `-700` selected border); graphics are green,
  not sky, after the harness check. Also from that check: the style tiles in `TextStylePicker`
  draw white captions on a cleared canvas, so they sit on `bg-stage` like the animation strip;
  and the two full-window pickers that live in `space-y` columns carry `m-0`, because the
  column's margin reaches a fixed child too and left the text-card font picker 6 px short of the
  window's bottom (`tests/fixedOverlays.test.ts`). The focus ring's
  4 px rounding moved into `@layer base`, because unlayered it beat every `rounded-*` utility and
  would have squared a focused tile. `window.__forgeSwatch(true)` in the harness draws the tiles,
  buttons, every grey on every surface with measured ratios, the accent chips and the clip colours.
  Tests: `tests/themeTokens.test.ts`, `tests/renderer/tile.test.ts`, `tests/voiceAndKinds.test.ts`,
  `tests/fixedOverlays.test.ts`.

### Step 4 — Canvas bar: shape switch, preview split, orientation chip · DONE 2026-10-02
- **Files:** new `components/CanvasBar.tsx` (16:9 Landscape / 9:16 Vertical / 1:1, Source/Split/Output,
  mismatch chip with its Switch); new pure `src/shared/edit/orientation.ts` (`orientationMismatch(assets,
  settings)` lifted from `Automation.tsx:148-158`); `App.tsx` (bar above the Toolbox+Preview row, inside
  the centre Panel); `Inspector.tsx` (remove `391-413`, `497-521`); `Automation.tsx` (remove `342-356`).
- **Tests:** new `tests/orientation.test.ts` (portrait majority on a landscape canvas → '9:16', and back;
  no photos → null). Mutation: flip the comparison → fails.
- **Check:** click 9:16 → the preview's output frame is portrait and the Preview did not remount
  (playhead and playing state survive); Split shows the divider; three portrait photos in a 16:9 project
  → chip appears; Cmd+Z restores the shape (step 2); check the Reframe rectangle position at split 0.
- **As built (2026-10-02).** `CanvasBar.tsx` is a flat bar in the centre panel above the picture
  row (the Preview is not moved in the tree: measured in the harness, the playhead kept advancing
  and `playing` stayed true across a click on 9:16). Shape group 16:9 Landscape / 9:16 Vertical /
  1:1 Square with `aria-pressed`, the solid accent on the pressed one; view group Source / Split /
  Output. The orientation chip reads "Most photos are portrait" (or landscape) with a **Switch to
  9:16** button, its tooltip the chip's words then the reason; `shared/edit/orientation.ts` is the
  reel's rule lifted unchanged (image assets only, strict majority, a tie or no photos → null, a
  1:1 canvas counts as landscape — all pinned in `tests/orientation.test.ts`). The bar is a Tailwind
  `@container`: the shape WORDS hide below 48rem while the chip is up and below 32rem otherwise, so
  at the 1100 px minimum the chip is whole (the first container queries in the project). The
  Inspector's Output block lost its aspect and Preview rows; Automation lost its banner. **Reframe
  at split 0, the pre-existing misplacement §3.15 flagged, is fixed:** the rectangle was drawn in
  raw source pixels because the source fit defaulted to scale 1; the fit now starts as null and the
  rectangle is drawn only once there is a fit; pressing Reframe in the Output view opens Split
  (`Toolbox.tsx`), and choosing Output while reframing hides the rectangle rather than drawing it
  wrong (`tests/crop.test.ts`, source-level; the draw loop cannot run in jsdom). Census: a new
  `canvasbar` home found from structure (centre panel = [bar, picture row], picture row =
  [toolbox, preview], exactly one preview canvas) and two recipes for the chip, portrait and
  landscape; 592 → 603 rows, none dropped; 595 checked, 0 missing. Verified on the cream in the
  harness at 1400×900 and 1276×706; the Windows font stack is unmeasured for the breakpoints
  (20 px of slack).

### Step 5 — The Curve tray on the timeline · DONE 2026-10-03
- **Files:** new `components/CurveTray.tsx` (28 px rail with Keys / Curves buttons and an
  "animated" dot; expanded: Keys tab = `<Keyframes clip={clip} />` + Motion path, Curves tab =
  `<CurvePanel />` unchanged); new `components/MotionPathPanel.tsx` (`Inspector.tsx:1460-1509` moved
  verbatim); `App.tsx` (bottom-row Panel → `collapsible`, `collapsedSize={28}`, `minSize={240}`,
  `defaultSize={28}`, `panelRef`; `onResize` writes `trayOpen`); `Inspector.tsx` (remove `<Keyframes …>`
  at `1458` and Motion path).
- **Tests:** keyframeGraph / maskKeyframes / audioSurface unchanged and green (files kept). New source
  test: `Inspector.tsx` has 0 matches of `/<Keyframes\b/` (not `<Keyframes ` with a space, which
  a mount written over several lines slips past) and `CurveTray.tsx` has exactly 1 of
  `<Keyframes clip={clip} />` and 1 of `<CurvePanel`. Mutation: leave Keyframes in both → fails.
- **Check:** the tray is a rail on load; select a clip, open Keys, key Zoom at the playhead; Curves shows
  the point; Colour shows the tone curve; drag the tray wider; at 1100×680 the closed tray costs the
  timeline 28 px of width and no height. (First written as "four tracks still show", which this step
  cannot give: measured at 1100×680 the lower row is 230 px, so V2 and V1 show and A1/A2 are reached by
  scrolling the track list, 152 of 276 px. That height is the vertical split's (62/38, `App.tsx` outer
  Group), which this step does not touch, and Step 9's removal of the source row hands the lower row
  only its 38 % share of what it frees. Four tracks at once at the minimum window needs ≈124 px more
  there, and no step plans it yet.)
- **As built (2026-10-03).** `CurveTray.tsx` closed is a 28 px rail (`data-curve-tray="rail"`) with
  Keys and Curves icon buttons, a vertical "Keys & curves" label and an accent dot when the
  selected clip has keys, a motion path or mask tracks (`shared/curveTray.ts` `hasKeysOrPath`,
  pinned); open (`"keys"` / `"curves"`) it shows the two tabs and a close chevron, Keys = the
  Keyframes rows plus `MotionPathPanel.tsx` (the Inspector's block moved verbatim, its Clear button
  gaining the tooltip "Clear path — …"), Curves = `CurvePanel` unchanged; both tab bodies stay
  mounted while open so CurvePanel keeps its choice. The Panel is `collapsible collapsedSize={28}
  minSize={240} maxSize="45" defaultSize={28}` with `groupResizeBehavior="preserve-pixel-size"`;
  the store is followed with `useEditor.subscribe` (a selector in App would re-render the window
  on every toggle), `panel.resize(lastOpenWidth)` opens (4.12.4's `expand()` only reopens to a
  width an imperative `collapse()` recorded), `onResize` writes `trayOpen` back at the (28+240)/2
  line so dragging it shut closes it (measured: drag to ~46 px snaps to 28 and the store says
  false; the last open width is remembered). The tray never opens by itself — select, keying,
  setPath, undo and redo leave it closed (`tests/renderer/curveTrayStore.test.ts`). The
  Inspector shows "Keys and curves are in the tray beside the timeline" with an **Open keys**
  button. Census: homes `rail`, `keys` and `curve` on the same Panel, told apart by
  `data-curve-tray` and a width wait (an open tray squeezed into the rail would still give every
  text node a box); 603 → 620 rows, none dropped; 612 checked, 0 missing. The timeline gained the
  old panel's 28 %: 1118 px against ~825 at 1147 wide. Known: on Curves two 28 px headers stack
  (the tray's and CurvePanel's own), so the tone curve scrolls in the short lower row — CurvePanel's
  header is pinned by tests and is for a later step.

### Step 6 — Settings panel top right · DONE 2026-10-03
- **Files:** new `components/SettingsPanel.tsx` (fixed overlay anchored top right; Escape handler in the
  pinned shape `if (e.key === 'Escape') { // … \n e.preventDefault() \n onClose()`; Model servers block
  moved from `Director.tsx:326-399` with `modelPicker` `115-149`; AI helper status row; Hosted voice and
  Pexels rows disabled "coming with Narration"); `App.tsx` Header (gear replaces `84-94`, `no-drag`, dot
  from `sidecarReady`/`sidecarError`); `Director.tsx` (status row kept; its gear sets `settingsOpen`);
  `MediaPool.tsx:236-239` tooltip wording.
- **Tests:** `tests/fullScreen.test.ts:67` add `SettingsPanel.tsx` to the Escape list (mutation: drop
  `e.preventDefault()` → fails). New: `Director.tsx` no longer contains `setDirectorProvider`;
  `SettingsPanel.tsx` reads `hasKey` and never renders an `apiKey` value back.
- **Check:** gear opens the panel; changing the Ollama URL updates `forgeStore.getState().directorConfig`;
  Esc closes; the Director tile's status line still resolves (refresh on open). In the real app once
  (`npm run dev` on the Mac): the gear is clickable inside the drag region.
- **As built (2026-10-03).** `SettingsPanel.tsx`, a fixed card under the header's right end, opened
  by a `no-drag` gear in the header (carrying the AI helper's status dot) and by the Director's own
  gear ("Model servers — open Settings"): Model servers (the Director's block moved verbatim — provider,
  servers, models, the write-only Key with Save and Clear, Check again, the status line; it refreshes
  on open), **AI helper (Python)** with the plain-words state, **Hosted voice** and **Pexels** as
  disabled "coming with Narration" rows. Escape closes it in the pinned shape (`fullScreen.test.ts`
  lists it). No on-screen string says "sidecar" any more, in the renderer OR in the messages the main
  process sends up (`sidecar/client.ts`, `sidecar/service.ts`, `voice.ts`; CLAUDE.md's 9009 row
  updated). Measured in the harness: a typed key, once saved, is in neither the DOM nor the store
  nor any title; Escape closed the panel without touching full screen.
  **Two pre-existing security holes found by the verifier and closed here**, both outside the
  step's files: (1) `settings:get` and `settings:set` returned the WHOLE of `settings.json` to the
  renderer — hosted keys included — on every launch (`loadPresets`) and every preset save, so "the
  renderer only ever learns `hasKey`" was not true. `main/store.ts` is now the one owner of the
  file, in two halves: the main process's `Settings` (keys among them) and the renderer's rest
  (export presets, the export choice); the window reads and writes only its half, is refused a
  main-process field by name, and both halves are written together atomically (temp + rename, with
  an in-place fallback for a Windows scanner holding the file). That also fixes a data-loss bug:
  a Director save used to rewrite the file through `sanitize`, deleting every saved export preset.
  (2) `redactKey` cut an error body to 400 characters BEFORE redacting, so a key that straddled the
  cut survived as a prefix in the status reason and the toast; it redacts first now, and
  `setDirectorSettings` is pinned to answer a save with `hasKey` only (`tests/settingsStore.test.ts`,
  `tests/voiceProvider.test.ts`, `tests/directorMain.test.ts`; a 27-character probe key passed the
  old code by coincidence of the 25-character prefix, so the test uses a longer one). Census: a
  `settings` overlay home found as the one fixed element opening adds; 620 → 628 rows, none
  dropped; 620 checked, 0 missing. Known, for later: the Director's status reasons in
  `main/director.ts` still say "in the Director settings"; the card at `top-10` covers the gear
  while the one-time recovery banner pushes the header down (Escape still closes it).

### Step 7 — OUTPUT and EXPORT strips in the left column · DONE 2026-10-03
- **Files:** new `components/OutputStrip.tsx` (`Inspector.tsx:415-764` moved: frame rate, loudness,
  captions with `captionSample` and the caption FontPicker host); new `components/ExportStrip.tsx`
  (`Inspector.tsx:189-195, 218-373` onExport and the listener moved verbatim, `767-845`, jobs
  `1712-1781`; collapsed header = Export button + running job's bar; body hidden by class);
  `App.tsx` (left column = LeftPanel over the two strips; `<ExportStrip />` rendered unconditionally);
  `Inspector.tsx` (removed blocks); `IngestPanel.tsx:302-307` wording.
- **Tests:** `tests/frameRate.test.ts:160` → `OutputStrip.tsx`; `tests/exportB2.test.ts:297` →
  `ExportStrip.tsx` (every slice and negative), plus `Inspector.tsx` has 0 matches of
  `const onExport`. New: App.tsx has exactly one `<ExportStrip` and none behind `&&`; ExportStrip.tsx
  contains `exportRequests`. Mutations: wrap it in `{exportOpen && …}` → fails; point exportB2 back at
  Inspector.tsx → fails (proves the re-point bites).
- **Check:** with both strips collapsed, `forgeStore.getState().requestExport()` on a timeline with a clip
  produces the harness's "cannot export" notice — the listener is alive while collapsed; with an empty
  timeline, "Add something to the timeline first". Caption Style gallery opens full-window from the strip.
- **How it got here.** The builder's version squeezed the left panel under its waveform when a
  strip opened (tab content 6.7 px at 1100×680), hid a finished export's result while EXPORT was
  closed, and spent 80 px on the two closed headers; the fixer that addressed those was cut off
  mid-run, a finisher completed and measured them, and three last gaps a verifier left as nits were
  closed by hand with mutation-checked assertions: an `if (!open) return` at the top of the export
  flow (which would silently kill File › Export with the strip shut) now fails a test, so do a
  swapped Done/Failed header click and a header row or small button that grows past 28 px.
- **As built (2026-10-03).** `ui/Strip.tsx` is the frame both strips share: a
  `<section data-strip data-open>` with a 28 px header (`h-7`: the triangle and the name, which toggle
  it, then `aside`) over a body that closing HIDES BY CLASS and never unmounts (`data-strip-body`,
  `hidden` / `min-h-0 flex-1 overflow-y-auto`); flat, and no transform, filter or backdrop-filter
  anywhere in it (the triangle is two drawn paths, not a rotated glyph). Open, a strip is `flex-1`,
  so two open strips split what is left. `OutputStrip.tsx` is the Inspector's Output block moved
  unchanged (frame rate, loudness, captions with `captionSample`, the Style / Animation pickers, the
  FontPicker host); closed, its header says `outputSummary(project)` — "30 fps · -14 LUFS · captions
  on" (`shared/project/outputSummary.ts`, ASCII minus as the Loudness buttons write it, an older
  file's null loudness read as off). `ExportStrip.tsx` is the Inspector's export block, `onExport`
  and the File › Export listener moved verbatim, ExportSettings, Saved settings and the Exports list;
  the header carries the **Export** BigButton at a new `size="sm"` (`ui/Tile.tsx`, 20 px tall, so
  the header stays 28 px — it was 47 at the default size) and **what the jobs are doing**
  (`shared/render/exportHeadline.ts`): the running job's bar, else the first waiting one's ("Waiting:
  … it starts when the one before it ends"); with nothing under way, how the last RENDER ended —
  **Done** (one click reveals the file: "Done: … — Show in folder") or **Failed** (its tooltip
  carries the error; a click opens the strip on the list). A last export that was cancelled says
  nothing; a download's ending is not counted (it lands in the pool, or toasts). Before this, both
  strips starting closed meant a finished or failed export showed nowhere — failures are reported
  nowhere else at all. `App.tsx`'s left column is a holder over the two strips, both rendered
  unconditionally; the holder is clipped and has the floor `min(max(60%,16.5rem),100%_-_3.5rem)`:
  three fifths of the column, never under 264 px (the 31.5 px tab row, 120 px of tab content and the
  112 px waveform), and never so much that the two closed headers do not fit. `LeftPanel.tsx`'s
  tab-content box clips too, so a tab squeezed below its own fixed rows is cut at its edge instead of
  drawn over the waveform — which the first build did at every window size (tab content 6.7 px at
  1100×680, 26.8 at 1429×761, 61 at 1400×900, all of it over the 112 px dock). The Inspector lost 753
  lines and its 'Output' title; the URL panel says "progress is under EXPORT, on the left" ("bottom
  left" from step 8).
  **Measured in the harness** (tab content = the box between the tab row and the waveform; nothing
  overlapped the waveform in any state — its box's bottom ≤ the waveform's top, and
  `elementFromPoint` at three points just inside the waveform's top edge hit the waveform):

  | window | left column | both closed: tab content / pool list | one strip open: tab content / pool list / open body | both open: each body |
  |---|---|---|---|---|
  | 1511×761 (the pane) | 425.6 | 226.1 / 115.1 | 120.5 / 9.5 / 105.6 | 52.8 |
  | 1400×900 | 511.8 | 312.3 / 201.3 | 163.6 / 52.6 / 148.7 | 74.4 |
  | 1100×680 | 375.4 | 175.9 / 49.2 | 120.5 / 0 / 55.4 | 27.7 |

  Collapsed headers 28 + 28 = 56 px at every size (the budget in §2), the Export button 20 px inside
  its header, and the header fits at the 234 px column with Done or a bar beside the button. At
  1100×680 a strip open leaves the Media tab its two add rows and the Import row (the button whole,
  2.8 px to spare) and the pool's list 0 px — it comes back at 49 px when the strip closes; the room
  for both is the full-height column of steps 8–9, not this step's. The Check's "cannot export"
  notice is not what the harness shows: its `chooseExportPath` answers `null`, so the flow stops at
  the save dialog silently. Measured instead: with EXPORT closed, `requestExport()` bumped
  `exportRequests` 0 → 1 and the listener called `chooseExportPath("Untitled-16x9.mp4")`; with that
  shimmed to return a path, the render was started and the harness refused it ("Exporting needs the
  real app — the harness has no exporting"), and no job was made, so the header showed no headline —
  correct, as the refusal is a toast. The job states a real export goes through, fed to the store as
  the main process does (`setJobs`), with EXPORT closed: queued → the "Waiting:" bar, running 42 % →
  "Running: … — 42%", done → **Done**, whose click called `revealPath('/tmp/s7f-export.mp4')`,
  failed → **Failed**, whose click opened the strip on the list with the error in it; opened, the
  list row's "Show in folder" is in view and reveals the same path; cancelled → nothing. With an
  empty timeline: "Add something to the timeline first". The caption Style gallery ("Browse all")
  and the Font picker, opened from OUTPUT at 1100×680, each covered exactly the viewport (0, 0,
  1100, 680), and Escape closed each. (The Export button's busy face is not seen in the harness: the
  refused flow ends inside one render.)
  **Census:** homes `output` / `outputbar` and `export` / `exportbar` — each strip in two faces, as
  the tray is, put in its face through the store and confirmed by `data-open` AND the body's own
  box; new scenarios `export-done`, `export-failed`, `export-waiting` (renders, `presetId: 'render'`)
  for the header's new rows (Done, its "Show in folder", Failed, "Open EXPORT for the details.",
  "Waiting:"). 628 → 649 rows: 63 moved from the Inspector (35 to `output`, 28 to `export`), the
  Inspector's 'Output' title dropped as planned (§3.17), 22 added; 641 checked, 8 skipped, 0 missing.
  **Tests:** `tests/windowStrips.test.ts` (20) and `tests/renderer/stripsRender.test.ts` (10, the
  strips rendered closed and open, the header's states); `frameRate.test.ts` and `exportB2.test.ts`
  re-pointed with anchor counts (exportB2's every slice asserts its anchors first: a negative passes
  on an empty slice). The first test of the listener ("reacts whether the strip is open or not")
  could not fail — its slice held no `open` to find — and is replaced by one read from the tree: the
  one effect that depends on `exportRequests` is a statement of ExportStrip's own body, with no
  return before it, calls `onExport()`, and names nothing `open`. Mutation-checked, each failing:
  no listener; `if (!open) return` in it; the listener moved into a child rendered `{open && …}`
  (only the new test catches this one — the old text match passes it); `{exportOpen && <ExportStrip />}`
  in App; `{open && children}` in the frame (4 tests); the floor at 15rem, uncapped, or the first
  build's `min-h-[40%]`; LeftPanel's tab box unclipped; the header button at its natural size;
  exportHeadline counting downloads, going by list order, skipping cancelled, or putting waiting
  before running; the header without Done, without Failed, or with a bar only while running; exportB2
  pointed back at the Inspector (7 tests). Renaming the header's "Done" passes `uiCensus.test.ts`
  ("Done" is written elsewhere in the source, which that half cannot tell apart) and is caught by the
  harness census ("absent").

### Step 8 — The Trimmer dock; the right column goes · DONE 2026-10-03
- **Files:** new `components/TrimmerDock.tsx` (header with name and X; `<Waveform />`; `<Inspector />`
  below, one scroller); new pure `src/renderer/src/dock.ts` `dockSubject(project, selectedClipId,
  audition)` → `'clip' | 'audition' | null` (a stale id resolves to null); `App.tsx` (remove the right
  Panel `516-518` and its Divider; left Panel `defaultSize="17" minSize={240} maxSize="30"`; inside it a
  vertical Group LeftPanel | TrimmerDock (only when a subject) over the strips); `LeftPanel.tsx` (remove
  `134-139`); `Inspector.tsx` (root becomes the clip editor only: Clip, Title text, Transition in);
  `Library.tsx` (clear `audition` on unmount); the dock's X calls `select(null)` and `setAudition(null)`.
- **Tests:** camera, steady, chromaKey, audioSurface:781 unchanged and green (still `Inspector.tsx`). New
  `tests/dock.test.ts` (clip → 'clip'; stale id → null; audition only → 'audition'; both → 'clip').
  Mutation: drop the audition branch → fails. New source test: App.tsx no longer renders `<Inspector`;
  TrimmerDock.tsx renders `<Inspector` and `<Waveform` once each; LeftPanel.tsx has no `<Waveform`.
- **Check:** nothing selected → no dock, the tabs fill the column; select a photo → Camera; a text clip →
  Text card; a Library SFX → audition with Add at playhead; X closes it; Mask "Edit on picture" works;
  the text FontPicker covers the window; census `[]`; preview canvas rect at 1400×900 ≥ 1.35× baseline
  width in 16:9 and taller in 9:16.
- **As built (2026-10-03).** The window is now the §2 diagram. `TrimmerDock.tsx` (header "Trimmer ·
  <name>" with its tooltip "— the selected clip" / "— a Library sound, not on the timeline yet", an X
  "Close the trimmer" that drops the selection AND the audition, then the Waveform and the Inspector
  in one scroller) renders only while `dock.ts` `dockSubject(project, selectedClipId, audition)` is
  not null — a clip wins over an audition, a stale id is null; `Library.tsx` clears the audition on
  unmount, which nothing did before. The right-hand Panel and its Divider are gone; `Inspector.tsx`
  keeps its name and its pinned strings and is the clip editor only (`if (!clip) return null`).
  **The left column runs full height** (the user's §7.2 answer, built here because the verifier
  measured the tabs and the dock not fitting their floors inside the old 62 % row): the outermost
  Group is horizontal [left column | right column] and the right column is a vertical Group,
  picture 64 % over timeline 36 %, so the source row (Upload / YouTube / Narration) now sits at the
  top of the left column too, wrapped to two rows at 240 px, until step 9 replaces it with tiles.
  Inside the column a vertical Group `LeftSplit` holds the tabs Panel (floor 152 px) over the dock
  Panel (floor 260 px: header 28 + waveform 112 + 120 of editor), with ids so the library never
  mis-applies a layout when the dock mounts and unmounts; the holder's min-height follows the dock
  (`holderFloor`); the strips stay under it. **One library lesson:** react-resizable-panels 4.12.4
  takes a string size as percent but writes it to `flex-basis` RAW on the first frame, so
  `defaultSize="17"` is invalid CSS, the panels take their content width, and the clamp against
  `minSize={240}` landed at the 30 % max — the column opened at 420 px. Every string size now
  carries an explicit `%`, and `tests/trimmerDock.test.ts` fails on a unitless one. Measured at
  1400×900: left column 240 px; canvas 1123×520 against the step-0 778×512 (1.44× wide); 16:9 frame
  925×520 (1.19×); 9:16 frame 293×520 against 288×512 — only 1.6 % taller, because the height a 9:16
  frame gets is the picture row's, and the canvas bar (step 4) took 32 px of it since the baseline.
  More vertical room would have to come from the timeline (already short at the minimum window,
  step 5's note) or the bar; a room test pins the timeline at ≥ 230 px at 1100×680. The column keeps
  the library's preserve-relative-size: opened at 1100 it is 240 px and grows to ~305 at 1400; the
  default window opens at 240. Census: homes `inspector` and `waveform` became `dock` (191 rows;
  found as the second Panel of the left split, `data-dock`, present only with a subject); three
  rows whose text can no longer appear — "No clip selected", "Select a clip", "Select a clip, or
  pick a sound in the Library, to see its waveform" — were dropped for a successor, `noDock()`, a
  self-check `fresh()` runs before every scenario that throws unless nothing is selected, nothing is
  auditioned and no `[data-dock]` is on the page; 652 rows, 644 checked, 0 missing. Known: in
  YouTube mode the inline ingest form makes the source row 273 px tall and squeezes the tabs and
  dock below their floors at 1100×680 until step 9; an audition takes the dock's full 260 px floor
  although it has no editor.

### Step 9 — The Shelf frame and the source tiles · DONE 2026-10-03
- **Files:** new `components/shelf/Shelf.tsx` (home grid in the sketch's order, `auto-fill` columns; an
  open tool gets "← Tools · Name" and its own `<ErrorBoundary>`); new `components/shelf/tools.ts` (19
  entries: id, label, icon, panel, `takesMedia`, `soon`, busy selector); `store.ts` (`shelfTool`
  replaces `SourceMode`/`sourceMode` `207, 371-372, 982-983`); `App.tsx` (Shelf replaces LeftPanel;
  `<SourceBar />` at `497` removed); `LeftPanel.tsx` and `SourceBar.tsx` deleted; tiles Upload
  (`MediaPool` with one Upload button), URL (`IngestPanel`), Narration (coming-soon text reworded),
  Library (`Library`, opening on Stickers if Decision 9 agrees), Transcript (`TranscriptPanel`, empty-text
  reword).
- **Tests:** new `tests/shelfRegistry.test.ts` — the registry contains each of the 19 ids (membership)
  and in the sketch's order. Mutation: drop 'card-ring' → fails. tailwindSources green.
- **Check:** 19 tiles at 240 px, three per row, screenshot; each source tile opens without the boundary;
  Upload uses the harness's synthetic `pickMedia`; Back returns home; census `[]`.
- **As built (2026-10-03).** `shelf/tools.ts` is the registry (19 entries in the sketch's order: id,
  label, icon, hint, panel, takesMedia, soon, busy selector), `shelf/Shelf.tsx` the frame: HOME is the
  tile grid (`Tile` size `sm`, 63×63 at the 240 px column, three per row, seven rows, 511 px — it
  fits without scrolling at 1400×900 and at 1100×680, and scrolls under the dock; at ~305 px the
  grid reflows to four per row and reads exactly as the sketch), an open tool shows "← Tools ·
  <label>" over the panel inside its own `ErrorBoundary` keyed by tool id; `data-shelf-tool` is
  "home" or the id. `shelf/panels.tsx` holds what each tile opens: Upload = MediaPool with ONE
  Upload BigButton (Add files and + Import merged, busy while the picker runs); URL = IngestPanel
  (its own border and background dropped); Narration = the soon text, reworded without "paid
  services"; Library = Library on Stickers (`initialKind`); Transcript = TranscriptPanel ("in
  Upload"); Transitions = Library on the Transitions drawer; the five one-click tiles each hold
  their Add button moved from LeftPanel and one line on what it makes (planned for step 11, done
  here so nothing was lost); the eight automation tiles all open the WHOLE Automation panel until
  step 10 splits it. `shelfTool` replaced `sourceMode`; LeftPanel.tsx and SourceBar.tsx are deleted;
  `TABS_FLOOR` became `SHELF_FLOOR`; the empty-canvas text says "or open Director and press Direct"
  (step 10's line, done early because the Create tab it named is gone). Busy badges: a tile shows a
  spinner from its tool's flags (URL only for a running or queued download, never for a failed one
  left in `pendingIngests`). Census: the homes source / media / library / transcript / create
  became 19 tool homes (names derived from the ids with digit-led words dropped — `props` for
  `props-3d` — by `tests/renderer/censusHomes.test.ts`, after a hand-written table let a swapped
  pair pass) plus `shelf` for the grid; `openHome` sets `shelfTool` through the store from the home
  grid each time so local state resets; 652 → 687 rows, four labels replaced with successors
  (Create, Import, Add files, YouTube); 679 checked, 0 missing. Verified in the harness: every tile
  clicked by ref opens its panel without the boundary, Upload imports 4 then 8 assets, each Add
  lands a clip under the playhead and the dock appears, Narration shows no "paid services". Known,
  for step 10/11: three texts still say "Import" (Director.tsx "Import pictures or clips…",
  Automation.tsx "Import some photos…", ExportStrip "Use Relink in the media pool"); navigation
  tiles carry `aria-pressed="false"` and no `aria-busy`; the one-click panels' adder wiring and
  Upload → `importAssets` are checked only in the harness (step 11's check covers them); a row filed
  under the wrong automation home cannot be noticed until step 10 splits the panel. The
  `shelfRegistry` order test pins the sketch's order as a whole list — a 20th tile will fail it on
  purpose, and the test says so.

### Step 10 — Automation becomes one panel per tool · DONE 2026-10-03
- **Files:** new `components/tools/BeatSync.tsx` (`Automation.tsx:193-368`), `OnePhoto.tsx` (`370-422`
  + mirrored Motion/Transitions sliders and progress/Stop), `GridSplit.tsx` (`424-583`), `StripFlashes.tsx`
  (`585-722`), `FilmStrip.tsx` (`724-790`), `Props3d.tsx` (`792-878`), `tools/shared.ts` (`useMusicClip`
  from `131-138`, bake message `162-163`); Director tile mounts `Director`; `Automation.tsx` deleted;
  `Preview.tsx:1715` text → "or open Director and press Direct" (already done in step 9). Also
  from step 9's known list: the three "Import" texts (Director, Automation, ExportStrip) become
  "Upload"; each tool home's rows are re-filed under the tile that now shows them.
- **Tests:** new `tests/toolInterlocks.test.ts` — each tool file's build button keeps its guard
  (`reelBuilding || gridBuilding` in BeatSync and OnePhoto, `gridBuilding || reelBuilding` in GridSplit,
  `stripsBuilding || reelBuilding || gridBuilding` in StripFlashes). Mutation each: drop one flag → fails.
- **Check:** each tile opens; build a grid on a harness photo; start a reel, go Home, the Beat sync tile
  shows busy; One photo shows the same Motion value as Beat sync; census `[]`.
- **As built (2026-10-03).** `tools/BeatSync.tsx`, `OnePhoto.tsx`, `GridSplit.tsx`, `StripFlashes.tsx`,
  `FilmStrip.tsx`, `Props3d.tsx` — each its Automation section moved verbatim (GridSplit, StripFlashes,
  FilmStrip and Props3d byte-identical to their sections at 422801b, dedented), `tools/shared.ts`
  (`useMusicClip`, `useBakeStatus`), and `tools/DepthParallax.tsx` built now (step 11's pointer
  panel: mirrors the reel's `reelParallax` box, a bake-status line, where depth is baked and where
  Camera → Depth lives; no buttons — baking a chosen photo is phase 2). OnePhoto gained the mirrored
  Motion and Transitions sliders, Stop and progress, all bound to the reel's own store fields, with
  a line saying they are one setting. The Director tile mounts Director. `Automation.tsx` is deleted.
  The four build-button interlocks are pinned word-for-word on the button whose click builds, and
  as store reads (a local `const gridBuilding = false` fails), by `tests/toolInterlocks.test.ts`;
  `tests/toolPanels.test.ts` pins eight distinct panels and OnePhoto's mirrors. Wording: "Upload
  pictures or clips…", "Upload some photos…", "Use Relink in Upload." Census: the merged "Clear" (7)
  and "Rebuild" (2) rows became one per tool home; the "Automation" header row's successors are the
  tools' own headers; a `depth-baking` recipe; 687 → 704 rows, none dropped without a successor;
  696 checked, 0 missing. Verified in the harness: each tile opens only its own section; Build grid
  made 4 clips and Clear took them; One photo's Motion follows Beat sync's; with `gridBuilding` set,
  the reel's, One photo's and the strips' buttons disable; with `reelBuilding`, the Beat sync tile
  shows busy; the Depth / Parallax box and the reel's box follow each other. Guards that are not
  interlocks (Film strip `images === 0`, Props `running || !transcribed`) are pinned as anchors too.

### Step 11 — One-click tools and pointer panels, and the folding strip · DONE 2026-10-03
- **Files:** `components/tools/Text.tsx`, `ColourCards.tsx`, `Grade.tsx`, `Newspaper.tsx`, `CardRing.tsx`
  (each: its Add big button from `LeftPanel.tsx:82-122`, one line on what it makes, "N on the timeline"
  with click-to-select, "edit it in the dock"); `Transitions.tsx` (Library on Transitions + note on
  Transition in); `DepthParallax.tsx` (mirrors `reelParallax`, says where Camera → Depth lives); tile
  busy badges in `Shelf.tsx`; `Library.tsx` takes an optional initial kind.
- **Tests:** census rows for the five Add labels now route to their tiles; registry test unchanged.
- **Check:** each Add lands a clip under the playhead and opens the dock on it; Card ring with no photos
  shows its notice; census `[]`.
- **Added 2026-10-03, the user's suggestion while watching step 9 land ("why not use our full space
  and make the selected button appear below … in a light shady blue"), agreed in this form:** with a
  tool open, the home grid FOLDS into a compact strip at the top of the Shelf — all nineteen tools as
  small icon-only tiles, two rows, about 70 px, the name as the tooltip — the selected one PRESSED
  (step 3's pressed look: the pale accent-900 fill, the accent-400 icon, the inset shadow; no
  rainbow — one accent is what makes "pressed" read), and the tool's panel takes everything below.
  Switching tools is one click; the "← Tools · name" header goes (Home is reached by pressing the
  selected tile again, or a Home icon first in the strip). Home itself stays the full grid. The
  tiles are now genuine toggles, so `aria-pressed` is right on them (the step 9 nit). Census: the
  tile rows become two faces — text labels on the home grid, titles in the strip — with counts per
  face; the "← Tools" row gets a successor note. Measure: the strip's height at 240 px and at the
  ~305 px column; the panel's remaining height at 1400×900 and 1100×680 with and without the dock.
- Also from step 9's known list: the one-click panels' adder wiring and Upload → `importAssets`
  get a source test each (J1/J2/K4 in that note); "Import" wording left anywhere on screen →
  "Upload".
- **As built (2026-10-03).** The one-click panels, Transitions, Depth / Parallax, the busy badges
  and Library's `initialKind` had landed in steps 9 and 10; this step built the user's strip. With a
  tool open the Shelf is exactly [`data-shelf-strip`, `data-shelf-panel`]: the strip is a Home tile
  ("All the tools") then the nineteen tools from the registry as icon-only `Tile size="xs"` (ten to
  a row, two rows, 3 px gaps, `max-w-6`: 20.1 px tiles and a 65 px strip at the 240 px column, 24 px
  tiles and 73 px from a 279 px column), each named by its tooltip and `aria-label`, the open tool's
  tile PRESSED (measured: fill `accent-900` #dce8ff, icon `accent-400` #1b4cd5 at stroke 2.25, the
  inset `shadow-pressed` and no raised shadow; `aria-pressed="true"` on it alone), the others
  `aria-pressed="false"`; a click switches tools, the pressed tile or Home goes home; busy badges
  stay on strip tiles. The "← Tools · name" header is gone; Home itself is the step 9 grid, whose
  tiles now carry no `aria-pressed` (Tile leaves it off when `pressed` is not given — the step 9
  nit). A third shadow token, `shadow-raised-xs`, at a third of the reach so tiles 3 px apart do not
  drown in each other's shade. `SHELF_FLOOR` rose from 152 to 194 so the Shelf still keeps ~120 px
  of panel under a 73 px strip at its floor; the cost, measured at 1100×680 with the dock showing,
  is 42 px of an open OUTPUT strip's body (133 against ~175). Measured: at 1400×900 the panel below
  the strip is 743 px with no dock and 290 with a photo selected; at 1100×680, 523 and 199, every
  tool's own header visible at the top. `tests/oneClickWiring.test.ts` pins each one-click panel to
  ITS adder and Upload to pick-then-import (swapped adders and a non-importing Upload fail);
  `tests/shelf.test.ts` and `tests/renderer/shelfRender.test.ts` pin the strip (none pressed, two
  pressed, no Home, the header left in, home tiles with `aria-pressed` — each fails). Census: the
  `shelf` home has two faces, the grid's labels and the strip's titles; "Tools" and "Back to all the
  tools" → successors "All the tools" and the pressed tile; "Drop to import" → "Drop to upload";
  704 → 723 rows; 715 checked, 0 missing. Known: five panels show no tool name at the top now that
  the header is gone (URL, Narration, Library, Transitions, Transcript — the name is only the
  pressed tile's tooltip, and Library and Transitions look identical at the top); the pressed dot
  overlaps the glyph's corner by ~3 px at the 240 px column; the 23 px horizontal pitch at 240 px is
  just under WCAG 2.5.8's 24 px target (fine from a ~250 px column); going home drops keyboard
  focus to the body; the strip's Narration tile does not say "soon"; the store's six "Import a …
  first" notices keep the verb. For the user to decide: a one-line tool name under the strip for
  the panels without a header.

### Step 12 — "Uses:" — the first half of the common source picker · DONE 2026-10-03
- **Files:** new `components/tools/SourceLine.tsx` — every media tool's panel starts with **Upload a
  file** (`pickMedia` → `importAssets`) and what the tool will use. Where the store already takes an id
  (`buildOnePhotoReel(assetId?)` `store.ts:528`, `buildGrid(assetId?)` `store.ts:697`) a **Choose from
  media** list sets it; elsewhere the rule is stated read-only (Beat sync / Filmstrip: "all N photos";
  Card ring: "the first 12 photos"; Strip flashes: "the shot under the playhead"; Director: "your
  pictures below"; music: "<song> on A1 — or Add music"). Placing chosen music, `assetIds` for the reel
  and filmstrip, and pool-item selection are phase 2.
- **Tests:** new store test: `buildGrid('b')` uses asset b even with another photo selected
  (`tests/renderer/`), mutation-checked by ignoring the argument.
- **Check:** with two photos, choose the second in One photo → the reel is built from it.
- **As built (2026-10-03).** `tools/SourceLine.tsx` sits first under the tool's header in Beat sync,
  One photo, Grid split, Strip flashes and Film strip, first in the headerless Card ring panel, and
  straight above "Your pictures, in order" in the Director: an **Upload a file** button (pick, then
  import — the same pair as the Upload tile; busy while the picker runs) and a **Uses:** line read
  from the project with the store's own rules — "all N photos in Upload" (Beat sync, Film strip),
  "the first 12 of the N photos in Upload" (Card ring, `addCarouselClip`'s slice), "<shot> — the shot
  under the playhead" or "— the longest shot, as none is under the playhead" (Strip flashes,
  `buildStrips`' order), "your pictures below, in order" (Director); the music line "<song> on A1"
  with a tooltip, or "no music yet — upload a song, then drag it onto an audio track" — the plan's
  "or Add music" was dropped on purpose: it would only import, which is what Upload a file does, and
  placing a song is phase 2 (Beat sync keeps its own Add music below). One photo and Grid split get
  **Choose from media**: the pool's photos with thumbnails, the chosen one marked ("The photo it
  builds from") and sent to `buildOnePhotoReel(chosen)` / `buildGrid(chosen)`; nothing chosen means
  "the selected photo, or the first one", the rule those builds had; the choice is panel-local and
  resets when the tool closes. Measured in the harness: choose sample 2 in One photo → 9 reel clips
  all from sample 2 with a different photo selected on the timeline; choose sample 3 in Grid split →
  4 pieces of sample 3; nothing chosen → the selected photo. **A pre-existing bug the line made
  visible, fixed in the store:** every `kind: 'image'` asset counted as a photo — the text cards,
  colour cards, clippings, rings and the Director's cards the editor draws — so after one "+ Text"
  Beat sync said "all 4 photos" and a reel would have cut the card in as a photo; `shared/edit/
  photos.ts` `isPhoto` (an image with a size) now filters `buildReel`, `buildOnePhotoReel`,
  `addCarouselClip`, `buildFilmstrip`, `buildGrid` and the four counts (`orientation.ts` still
  counts drawn stills, as its comment says it means to). Tests: `tests/renderer/sourceChoice.test.ts`
  holds the line's `usesOf` to the builds' own choice, order and photo rule (22 cases; a selector
  passing `undefined` for the choice fails); `tests/sourceLine.test.ts` pins the mount in each of the
  seven, first under the header, the Choose list only in the two, the pressed row and the
  pick-then-import. Census: 723 → 766 rows (three "Uses the …" texts replaced with two successors
  each); a `source-chosen` recipe clicks the second choice; 758 checked, 0 missing. Depth / Parallax
  is `takesMedia: false` now — it is a pointer panel with no media controls. Known: Beat sync shows
  two import-only buttons (Upload a file, its own Add music) until phase 2 places a song;
  `SourceLine.tsx` exports helpers beside the component, so Vite cannot fast-refresh it (dev only).

### Step 13 — The map, the sheets, and a last census
- **Files:** `docs/WHERE-THINGS-ARE.md` rewritten for the new window (it is already stale: "four tabs"
  then five, a "Text" tab, "Auto"; "no copy/paste/multi-select/fades" at 370 — all exist);
  `docs/SHEETS.md` statuses for sheets 19–20 and corrections to 22 (pool Transcribe and its % chip exist)
  and 24 (voice presets exist); the store comment "Only upload is built".
- **Check:** full census `[]`; screenshots at 1400×900 and 1100×680, 16:9 and 9:16, sent to the user.

---

## 7. Questions for the user — answered 2026-10-02

1. **Width — the §2 reading.** The Shelf + Output together take about 35–40 % of what the two
   side panels take today (≈ 240 px on a 1400 px window); the preview gains about 40 %.
2. **Frame — the §2 diagram.** The left column runs full height; the timeline sits under the
   preview only.
3. **Voice change — keep the six presets**; "coming soon" marks only a new effect.
4. **Square 1:1 — kept**, as the third, smaller option on the canvas switch.
5. **Accent and base — "remove the orange and make the background light cream like texture."**
   A light theme on cream with a faint texture; the 3dit blue is the accent; video clips re-hued.
   Step 3 carries it.
6. **Library — opens on Stickers for now.** Later, its families become their own tiles or
   sections: stickers, transitions, effects, cards, 3D props (the user's list) — order (2) or (3),
   to be drawn.
7. **Source picker — the "Uses:" line plus Choose-from-media for One photo and Grid split** is
   order (1); music placement and several photos are order (2).
8. **Burned-in captions stay in OUTPUT**, separate from Narration's grid.

Unasked and taken as the plan's recommendation: the paper, ring, text and colour-card editors
live in the dock only (one home); the Python helper is "AI helper" on screen; the tone curve
stays in the Curve tray's Colour tab; the orientation chip goes on the canvas bar; download
progress shows under EXPORT for now; title templates stay in Library with a link from Text;
asset packs stay inside Library; transport and tool strip unchanged.
