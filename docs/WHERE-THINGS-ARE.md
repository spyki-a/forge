# Where things are

A map of the app. Written because features that exist but cannot be found are
the same as features that do not exist — which is literally what happened twice:
"Put behind the subject" and the whole transition panel were both built, both
working, and both effectively invisible. Both are in the Trimmer dock now, on
any selected clip: **Put behind the subject** below the colour controls, and
**Transition in** as the dock's last section.

This is the window as rebuilt by `docs/WINDOW.md` (steps 0–12, 2026-10-02 to
10-03; step 13 is this map). Every control placed below was checked against
the component that renders it; where you would have to open the code to learn
more, the file is named. `docs/WINDOW.md` §6 has what was measured at each
step.

**Two names.** The user calls the left panel the "sidecar"; the code calls it
the **Shelf** (`components/shelf/`), because `sidecar` in the code is the Python
process — which the screen calls **the AI helper**.

---

## The window at a glance

```
┌───────────────────────────────────────────────────────────────────────────┐
│ header             project name • path              build stamp   ⚙ •     │
├─────────────────────────┬─────────────────────────────────────────────────┤
│ SHELF                   │ canvas bar: 16:9 · 9:16 · 1:1   Source|Split|Out│
│  home: 19 tool tiles,   ├──┬──────────────────────────────────────────────┤
│  or an icon strip over  │t │                                              │
│  the open tool's panel  │o │                   Preview                    │
├─────────────────────────┤o │                                              │
│ TRIMMER DOCK            │l │                                              │
│  only while a clip is   ├──┴──────────────────────────────────────────┬───┤
│  selected, or a Library │ Transport                                   │ K │
│  sound is auditioned    │ legend · Mark in · Mark out                 │ e │
├─────────────────────────┤ Tracks │ ruler and lanes                    │ y │
│ ▸ OUTPUT  30 fps · -14… │        │                                    │ s │
│ ▸ EXPORT       [Export] │        │                         Curve tray │   │
└─────────────────────────┴────────┴────────────────────────────────────┴───┘
```

Two columns. The **left column** runs the full height: the Shelf, the Trimmer
dock under it when there is something to trim, and the OUTPUT and EXPORT strips
at its foot. It opens at about 240 px on the default 1400 px window and drags
wider to 30 % (`App.tsx`). The **right column** is the picture over the
timeline, 64 / 36, with the divider between them draggable. There is no
right-hand column any more: the clip editor that lived there is the Trimmer
dock.

**Full screen** is View → Toggle Full Screen. The way out is an **Exit full
screen** button across the top of the window, or **Esc** when nothing else — a
menu, a picker, a text edit, the Settings panel — is using it.

---

## The header

The project's name in the middle, a blue dot beside it while there are unsaved
changes, and the file's path after it. On the right, the **build stamp** — a
time of day, whose tooltip says the running app is stale if that time is old —
and the **gear**, which opens the Settings panel (below). The small dot on the
gear is the AI helper's: green running, grey starting, red not running.

Above the header, only when there is something to recover: a banner offering
an autosave newer than its file, with **Recover** and **Discard**. It is
offered once and gone either way.

The **shortcuts sheet** is Help → Keyboard Shortcuts, or ⌘/ (`Shortcuts.tsx`).
**File → New Project…** (⌘N; Ctrl+N on Windows) opens the New project screen:
name, shape, frame rate, **Start** or **Cancel**. Nothing else opens it.

---

## The left column

### The Shelf, home

With no tool open the Shelf is a grid of nineteen tiles, in the order the user
drew them (sheet 20; `shelf/tools.ts` is the list), four to a row on the
sketch:

| sketch row | tiles |
|---|---|
| 1 | Upload · URL · Narration · Library |
| 2 | Transcript · Director · Depth / Parallax · Beat sync / Cut to words |
| 3 | Transitions · One photo · Grid split · Strip flashes |
| 4 | Film strip · 3D props · Text · Colour cards |
| 5 | Grade · Newspaper clipping · Card ring |

On screen it is three to a row in the 240 px column (Upload, URL, Narration,
then Library, Transcript, Director…) and four from about 290 px; it is the same
order either way, read row by row. Each tile's tooltip says what the tool is
for. Narration's tile says **soon**. A tile whose tool has a run under way
wears a small spinning badge — a transcription (Upload, Transcript), a download
(URL), the Director directing, a depth bake (Depth / Parallax), a reel (Beat
sync and One photo, which share one), a grid, the strip flashes — so a reel
started in Beat sync can still be seen from anywhere else.

### The Shelf, with a tool open

Pressing a tile opens its tool, and the grid folds into a **strip** at the top
of the Shelf: a house tile ("All the tools") and then all nineteen tools again
as small icons, two rows of ten. The open tool's icon is **pressed** — a pale
blue fill and a blue icon. Click another icon to switch tools; click the house,
or the pressed icon again, to go back to the grid. The icons carry no words;
the tooltip names each one. The Director and the automation tools open on a
header of their own; the other panels open straight onto their controls, and
the pressed icon is what says which tool is open.

The panel takes everything below the strip, and scrolls. Each panel runs inside
its own error boundary: a crash in one tool replaces that panel with the crash
message, not the whole window, and opening another tool starts clean.

### Upload a file, and "Uses:"

Every tool that works on media you bring starts with the same small block
(`tools/SourceLine.tsx`): an **Upload a file** button — the same pick-then-import
as the Upload tile — and a **Uses:** line that says what the tool will take,
read from the project by the same rule its build applies.

| tool | Uses: |
|---|---|
| Beat sync, Film strip | all N photos in Upload |
| Card ring | the first 12 of the N photos in Upload (all of them, when 12 or fewer) |
| One photo, Grid split | *name* — the selected photo, or the first one; or *name* — chosen below |
| Strip flashes | *name* — the shot under the playhead (or the longest shot, when none is) |
| Director | your pictures below, in order |

The three tools that keep time to music — Beat sync, One photo, Grid split — add
a **Music:** line: the first song on an audio track and which track, or "no
music yet — upload a song, then drag it onto an audio track".

**Choose from media** is in One photo and Grid split only, because only their
builds take a photo to build from: the pool's photos with a thumbnail each,
the one the build will use ticked. Pressing the chosen one again goes back to
"the selected photo, or the first one". The choice belongs to the panel and is
forgotten when the tool closes.

A "photo" here is a picture you imported. The text cards, colour cards,
clippings and rings the editor draws are images too, and none of the tools
count them (`shared/edit/photos.ts`).

**Not yet:** placing a chosen song (Beat sync's **Add music** and Upload a file
both only import — the song still has to be dragged onto an audio track);
choosing several photos for the reel or the film strip; leaving a picture out
of the Director's list; and choosing from a selection made in Upload.

---

## What each tile holds

### Upload

An **Upload** button at the top — the same file dialog as every tool's **Upload
a file** and Beat sync's **Add music**, all of which import into this pool —
then the **media pool**: your imported files as a grid of thumbnails, not a list of
names. A camera gives you IMG_4821 and DSC_0037, so the picture is the only
thing that identifies a shot and the name is a caption over it. Video shows a
frame from 0.5 s in, because the first frame of a clip is very often black.
Each tile has its kind in the top-left corner and, for video and sound, its
length in the top right. Files dropped from the desktop anywhere on the panel
are imported ("Drop to upload").

**Drag a tile onto the timeline** to say which track and when; double-click to
append it to the first track of the right kind. Drag one onto the **picture**
and a chip offers what it should become — see the preview below.

On a video or sound tile, a **captions** button in the bottom-right corner
(shown on hover) transcribes it; it is green once a transcript exists, and
greyed with "The AI helper (Python) is not running" when it cannot. While a
transcription runs, a percent chip takes its place, and clicking the chip
cancels it.

When files have gone missing, a red bar above the grid says how many, with one
**Relink…** for all of them. A missing file's tile says Offline.

**AVIF and HEIC** are converted to a PNG in the app's own cache on import (the
bundled ffmpeg cannot read either), and the pool shows the file under its own
name. The project remembers the file you chose, not the copy: move the project,
relink to a folder, or open it on the other machine and the AVIF is found and
converted again there. A HEIC from a phone will not convert on this build (no
HEVC decoder) — save it as JPEG or PNG first, as the message says.

**Not yet:** selecting a pool item does nothing. Trimming a file before it goes
on the timeline — the Trimmer as a source monitor, sheet 21 — and the pool
grouped by kind (sheet 21), image presets (sheet 23) and per-item audio trim
(sheet 24) are all to come.

### URL

Paste a link and press **Get** (`IngestPanel.tsx`; `docs/INGEST.md`). Under the
link: **Video / Audio / Instrumental / Vocal**, then the quality for video (4K,
1080p, 720p, 480p) or the format for sound (m4a, which copies what the site
stores, or mp3). **Just a part of it** opens **From** and **To** — typed, not
dragged, because the video's length is unknown until it is fetched — with
**Fast cut** or **Exact cut — slower**. While downloads run, a line says how
many and that the progress is under EXPORT, at the bottom left. The first
download fetches yt-dlp (about 30 MB) and says so beforehand.

**Not yet:** chapters, several ranges in one job, a transcript from the link,
and Best clips (sheets 25 and 27).

### Narration

Not built. The panel says what it will do — topic and length in, narration and
a cut out — and that the keys it will use, a hosted voice and Pexels, are in
Settings (sheet 28).

### Library

The shipped assets (`Library.tsx`). Search across the top, with the count, the
**package** button and **Rescan**. Under it the drawers, each with its count:
**Fonts, Props, Stickers, Transitions, Titles, SFX**. It opens on Stickers;
once more than one sticker category is installed, a row of category chips
appears above the grid.

Drag anything onto the timeline, or onto the picture. Transitions are dropped
on a clip's incoming edge. A title template lands as a clip whose words are
edited in the dock (Title text). The font drawer is a specimen book: fonts are
chosen in the font pickers, and a font tile cannot be dragged.

A **sound effect** is a row, not a tile: clicking it plays it and opens it in
the **Trimmer dock**, where its handles choose the part you want and **Add at
playhead** places it. Leaving the Library ends the audition.

The **package button** opens the **asset packs** — the downloads that put
things in here in the first place. It opens on its own the first time the
library is empty, which in an installed build is the first launch: an installer
ships no assets at all, so "Nothing here." is where most people start and the
offer has to be in it. An empty drawer in a library that is not empty offers
**Get stickers →** (or whichever drawer it is). See `docs/ASSETS.md`. Nothing
in the editor needs a pack; they add choices.

### Transitions

The same Library, opened on its Transitions drawer. A transition is applied by
dragging it onto a clip; its family, its length and the tag filter are in the
dock's **Transition in** once that clip is selected, and on the timeline a
transition is a striped chip across the cut — click it to edit, double-click to
remove.

### Transcript

The **selected timeline clip's** words, sentence by sentence; click one to jump
there (`TranscriptPanel.tsx`). With no clip selected it says to select one.
**Edit** turns every word into something to click and correct — Enter keeps
it, Esc leaves it, an empty word is taken out — and the captions follow at
once. A word the transcriber was unsure of is underlined. At the bottom,
**Listen for** takes names and words (the couple, the venue, a brand) for the
transcriber to expect, and **Transcribe again with these words** runs it again
— which replaces any corrections. With no transcript yet, the same button says
**Transcribe**.

**Not yet:** selecting rows and cutting the clip to them (sheet 26).

### Director

An ad from your pictures, your music and a line about the product
(`Director.tsx`; `docs/LLM.md`). Only **Product** is required. Under it,
**Recipe** — Auto (the model chooses) or one of Wedding highlight, Product
reveal, Energy, Trailer and Fashion / perfume, with the chosen one's one-line
description beneath. **More** folds away the refinements — Benefit, Audience,
Tone, Call to action, Length, Language — and says how many are set. **Length**
defaults to the recipe's — sixty seconds for a wedding teaser, thirty otherwise
— or the music, if shorter.

Then the source block (**Upload a file**, "Uses: your pictures below, in
order") and **Your pictures, in order**: the pool in order, each with a field
for what is in it. Under the list, a line saying which model would answer now,
and a gear that opens the **Settings panel**, where the model servers are.

**Direct** asks the model for a plan, checks it, and the recipe times it to the
beat: shots on V1 with the black and the end card after them, the recipe's
grade as an adjustment layer on the lane above, headline cards above that, and
the music trimmed to the ad — as ONE undo. A square or landscape picture in a
tall ad is shown whole over a blurred, darkened copy of itself: the copy sits
on a lane the Director adds UNDER V1 (the same thing the Blurred background
drop makes, so it edits like your own), and goes when the ad is cleared;
nothing else — a double-clicked photo, a reel — is ever built onto that lane.
A blend into or out of such a shot is a cut, and the result box says so.

The recipe's sounds — a riser and a sub into the hero, hits on the drops, a
whoosh under a whip — land as ordinary audio clips on lanes named **Sound
design** under the audio tracks, each from the asset library (its meme and UI
sounds are never used); the music goes silent for the black and returns on the
end card, drawn as the music clip's own volume envelope. All of it clears with
the ad. With no library installed the ad has no sound design and the result
box says so.

The recipe's **moments** — a zoom punch, a whip blur or a light burn over a
cut, a depth push over a whole shot — land as clips of their own on the lane
just above the shots (under the grade, so they are graded with the pictures
they are drawn from; the headline cards go on a lane above both). A bridge
spans its cut by its kind's own length, 0.4 s for a punch or a whip and 0.55 s
for a burn; a depth push covers the shot it lands on, easing in over two
seconds and holding. Where each lands is the recipe's: the hero reveal, a drop,
a section, the climax. They are drawn by the app's own three.js from the two
shots' pictures, live in the preview and baked to frames for the export, and
their first and last frames ARE the two shots' pictures — with the shots' own
moves and depth planes — so nothing pops at the hand-off. A bridge over footage
draws from the footage's own frames, pulled once through the clip's speed or
ramp and kept in the app's cache; a depth push is a photograph's move, so into
a clip the shot cuts with a note in the result box, and so does a whip between
a picture shown whole and one that fills the frame. They clear with the ad,
lanes and all.

The result box names the recipe and the picture the ad was built around. When
the model's plan cannot be used you get the standard cut of the recipe and a
note saying why. **Direct again** replaces it; **Clear** takes exactly its own
work back, music included.

### Beat sync / Cut to words

The beat-synced reel: many photos cut to music (`tools/BeatSync.tsx`). The
source block, then the music: once a song is on an audio track, its waveform
with two handles — drag them to use a section rather than the whole track,
**Use all** to go back — and before that, an **Add music** button, which only
imports. **Motion**, **Depth parallax** (cuts each photo into depth planes the
first time; the same switch as the Depth / Parallax tile's), **Cut to the
words** (splits the song, reads the vocal, and cuts on the words that land
hardest; instrumental tracks fall back to beats), **Transitions**, then
**Analyse & build** (**Rebuild** once there is a reel), **Stop** while it runs
and **Clear** after.

### One photo

One picture, one song, one caption (`tools/OnePhoto.tsx`). The source block
with **Choose from media**, then the caption — one line per card. It turns the
photograph into several shots by reframing it, wide to close, and splits your
caption into cards sized to the tempo, each landing on a downbeat. It bakes the
subject cut-out first, so a close-up lands on a face. **Motion** and
**Transitions** here are Beat sync's own two sliders, mirrored — one setting,
used by both — and so are its progress and **Stop**, because it runs on the
reel's machinery. **Build from one photo**, then **Rebuild** and **Clear**.

### Grid split

One photo cut into pieces that arrive one per beat until the picture is whole
(`tools/GridSplit.tsx`; sheet 18). The source block with **Choose from media**,
then **Pieces** (the rows × columns it makes are shown before you build),
**Square / Circle / Waves**, **Order**, **Landing**, **Cadence**, **Gutter**,
**Tilt**, and **Build grid**. Without music on the timeline the pieces arrive
on an even cadence, and the panel says so.

### Strip flashes

Slices of a brightened copy flashing over the shot that is already there
(`tools/StripFlashes.tsx`). The source block names the shot. **Columns / Bands /
Diagonal**, **Slices**, **At once**, **Rate**, **Look** (Blown out, Bleached,
Crushed), **Stutters**, then **Add flashes**. The flashes go on the track above
the shot; delete them all and the shot is exactly as it was.

### Film strip

Your photos as full-height panels in one long row, panning across frame, at
the playhead (`tools/FilmStrip.tsx`). **Panels** (how many across), **Length**,
**Build strip**, **Clear**.

### 3D props

Props that pop up when a matching word is spoken — fire on "flame", a rocket on
"launch" (`tools/Props3d.tsx`). **On / Off**; with it on, **Frequency** (per
minute) and **Place props**, which needs a transcript and says so. Once props
are placed the button reads **Regenerate**, with **Clear** beside it, and **Why
these fired** lists the reasons. The props themselves come from the Library's
Props drawer; with none installed, Place props says so.

### Depth / Parallax

A pointer, not a tool of its own yet (`tools/DepthParallax.tsx`). It holds the
reel's **Depth parallax** switch (ticking it here ticks it in Beat sync), shows
a depth bake while one runs, and says where depth comes from: Beat sync bakes
each photo the first time it builds with the switch on, and One photo always
bakes its photo. For one clip, select a baked photo and choose **Camera →
Depth** in the dock.

**Not yet:** baking one chosen photo from here.

### Text, Colour cards, Grade, Newspaper clipping, Card ring

The one-click tools (`shelf/panels.tsx`). Each panel is one big button and a
line about what it makes; the clip lands at the playhead on the top video track
and the dock opens on it, which is where it is edited.

| tile | button | what it makes |
|---|---|---|
| Text | `+ Text` | A card of your own words over the picture. Its words, font and style are in the dock; title templates are in the Library, under Titles. |
| Colour cards | `+ Colour` | A flat card of colour — something for text to sit on, or a wash between shots. |
| Grade | `+ Grade` | An adjustment layer. Grades every track **below** it, for as long as it runs. |
| Newspaper clipping | `+ Newspaper clippings` | A word highlighted across a run of torn newspaper clippings, over your footage. |
| Card ring | `+ Card ring` | Your photographs on a rotating ring, in 3D. Its panel starts with the source block: the first twelve photos. |

The clippings and the ring draw themselves: both bake to numbered PNG sequences
with alpha and land as ordinary clips, so nothing in the export knows about
either. See `docs/PAPER.md` and `docs/CAROUSEL.md` — and note the rule both of
them cost bugs to learn: **a clip drawn at the canvas size belongs on three
lists** (the preview's readiness gate, `setAspect`'s no-auto-reframe skip, and
`rebakeGenerated`).

Every automation above writes **ordinary clips**, labelled with why they fired.
Clear a rule and exactly its own output goes. Nothing is hidden, and nothing an
automation makes is harder to change than something you made yourself.

---

## The Trimmer dock — everything about the selected clip

The dock appears under the Shelf **only while there is something to trim**: a
clip selected on the timeline, or a Library sound being auditioned (a selected
clip wins). With nothing selected it is not there, and the Shelf has the whole
column. The split between the Shelf and the dock can be dragged.

Its header says **Trimmer** and the clip's name; the tooltip says whether that
is the selected clip or a Library sound not yet on the timeline. The **X**
closes it by letting go of both the selection and the audition.

Under the header, the **waveform** with its in and out handles
(`Waveform.tsx`). For a clip it shows the whole source file, the clip's part of
it between the handles and its source timecodes above; dragging a handle trims
in SOURCE time — the clip keeps its place on the timeline and only the part of
the file it shows changes. A picture says it has no audio track. For an
auditioned sound, the handles choose what will be placed, and **Add at
playhead** places it.

Below that, the clip editor (`Inspector.tsx`, which kept its file name). One
scroller for both, so a short dock scrolls the editor up past the waveform.
Top to bottom — a section appears only on the clips it applies to:

**Clip** — the name, start, end, a **Duration** slider (0.2 to 15 s), the
source in-point, and the reframe when there is one.

**Size, Opacity, X, Y, Rotate** — the same values the preview handles change.

**Speed** (video and sound only) — 0.25×, 0.5×, 1×, 1.5×, 2×, 4× as presets,
plus a **Rate** slider. The clip keeps its footage and changes how long it sits
on the timeline, and anything after it on that track moves along with it. Below
1× a **Smooth slow motion** toggle appears, which invents the in-between frames
instead of repeating them — worth it for a hero shot, and roughly forty times
slower to export, so not for a whole reel. Stills have no speed control: a
photograph has no rate to change.

**Steady** (footage, under Speed) — smooths out a handheld shake in the export.
The export analyses the clip's motion first (the start of its progress bar);
the preview shows the clip as it was shot.

**Camera** (photos) — a move across the still: **Move** is a push in, a pull
out or a pan, chosen from the In / Out / Pan rows, with **Amount**; **Shake** is
a hit that settles, with **Rate** and **Settle** (and **Hold** subject-still
when the photo has a depth cut-out); **Depth** runs the move on the photo's
depth planes when they exist. A move and Zoom keyframes both scale the picture,
so choosing one takes the other off and says so. A split keeps one move across
both halves, and the panel says which half this is.

**Clippings** (a newspaper clipping) — the highlighted word, Clipping or
Cut-out letters, the page shape, Typewriter, the look, **Pages** and **Each
page**, and **Customise** for the rest.

**Card ring** (a ring) — Cards, Radius, Card size, Visible arc, Spin, Tilt,
Roll, and whether the cards face the camera.

**Sound** (anything with sound) — **Mute**, and a **Level** fader in dB up to
+6. When a volume line is drawn on the clip, a note says the line sets the
level and the fader does nothing until it is cleared. **Crossfade with the clip
before** is here too — see the timeline below for why it is a button.

**Mask** — **Add** puts a shape on the picture. Then which shape (ellipse,
rectangle, or a line with everything on one side of it), what happens inside it (**Blur** / **Colour** /
**Show**), blur amount, feather, width, height, angle, and **Invert**. **Edit on
picture** toggles the handles in the preview; **Remove** takes the mask off.
**Animate** makes it move: it puts a key where the shape is, and from then on
moving or resizing the shape — on the picture or with the sliders — at another
moment keys that moment, and the mask glides between. The arrows jump to the
previous and next key; the curves are the Mask X / Y / W / H tabs in the Curve
tray. Turning Animate off keeps the shape as it is at the playhead. It sits
directly above Colour on purpose — in *Colour* mode those sliders apply only
inside the shape, and the Colour heading says so while that is true.

**Key** (footage and photos) — take a green or blue screen out so the track
below shows through. **Add** puts a key on and goes straight to picking: the
preview shows the clip as it arrived, with a *Click the screen colour* banner,
and a click takes the colour under it (Esc cancels; **Pick from picture** picks
again). Then **Range** (how far from that colour still counts as screen),
**Soften** (the edge) and **Despill** (the screen's colour pulled off hair and
edges). It sits above Colour because it happens first: the key is measured on
the ungraded picture.

**Colour** — **Temp** and **Tint** first (white balance: warm a blue cloudy
ceremony, cool an orange tungsten reception), then **Bright**, **Contrast**,
**Saturate**, then **Looks**: seven one-click grades (Warm Film, Golden Hour,
Teal & Orange, Cool Cine, Faded, Bleach Bypass, Noir) with an **Intensity**
slider once one is on. `or load your own .cube…` takes a LUT from any grading
tool. **Reset** appears once anything is changed. The tone curve is not here:
it is the Curve tray's Curves tab, under Colour, and there is no link to it
from this section yet.

**Text card** (text clips only) — the words, then five layout presets (Title,
Lower third, Impact, Quote, Sticker), then the **Style** library: 42 looks —
gradient, metallic, chrome, neon, glow, two-tone, stacked 3D, highlight block,
struck through, glitch split, hollow, and a handful that style one WORD of the
line differently from the rest. Each tile shows your own words in your own
font. Style and font are separate axes, so any style works with any face. Six
are shown inline; **Browse all 42** opens a full gallery — blurred backdrop,
search, and a big preview over your actual frame that follows the pointer.

Then **Animation** — how the words arrive: Fade, Rise, Pop, Typewriter, Bounce,
Wave, Zoom out, Slide, Drop, or None. A strip above the chips plays the one you
are hovering, in your own font, style and words, so you can try all nine
without choosing any. A third independent axis: any animation works with any
style on any face.

Then the font (**Change** opens the full-window picker), top / centre / lower
third, left / centre / right, **Size**, **Tracking**, **Weight**, **Shadow**,
the colour and **CAPS**, and **Outline** with its edge colour.

Long text wraps inside the title-safe margin rather than running off the edge;
subtitles wrap to the same margin in both the preview and the export.

**Colour card** — its colour and opacity.

**Fill with the picture below** — the trailer look. The clip stops being drawn
and the picture on the track underneath shows only inside its shape. Retype the
word and the fill follows, and if the text is animated the footage arrives with
it — the letters carry the picture they are cut from.

**Put behind the subject** — splits the photo underneath into background and
subject, with this clip between them. On the cut-out it makes, the button reads
"put the photo back together".

**Layout** — **Stacked** and **Side by side** split this clip with the one on
the track below: each takes half the frame and fills it, rather than
letterboxing inside it. Then four picture-in-picture shapes — same shape as the
video, square, circle, tall — which shrink the clip into a corner over whatever
is underneath, with rounded or circular edges so it looks placed rather than
pasted on. A corner grid appears once a clip is inset, and **Full frame** puts
it back. Neither is a mode. Both write a box into the clip's ordinary
transform, so the result stays draggable and resizable in the preview like
anything else.

**Keys and curves are in the tray beside the timeline** — one line, and an
**Open keys** button that opens the Curve tray on this clip's keyframes.

**Reset to full frame** — once the clip has been moved, scaled, turned or faded.

**Title text** (a title template) — one field per line of the template. The
template keeps its own typography; editing the words re-renders it.

**Transition in** — how this clip arrives, on every clip. It says first what it
blends in FROM: the clip before it on the same track, **a layer below it**, or
nothing — which is a fade in from black. The second case is how a grid reveal
is built, and the panel says so when that is what it is doing. Then the count
of transitions (and "library did not load" if it did not), **Cut** and the
families, the tag chips that filter the masks by what they DO (grid, blinds,
radial…) rather than by name, the transition itself, and its **Length**.

**Not yet:** the dock as a source monitor — selecting a pool item and trimming
it before it reaches the timeline (sheet 21). The six voice presets are on the
clip's right-click menu only, not in the Sound section.

---

## OUTPUT — what the file will be

The first strip at the foot of the left column (`OutputStrip.tsx`). Click its
triangle or its name to open it. **Closed, it still says what the file will be**
in one line: "30 fps · -14 LUFS · captions on".

Open, top to bottom:

**Frame rate** — 24 / 25 / 30 / 50 / 60. Changing it with work in the project
converts every clip, and no cut moves by more than half a frame.

**Loudness** — Off / Social −14 / Podcast −16 / Broadcast −23. Here and not in a
clip's Sound section because it is a property of the export rather than of a
clip: every track and the music measured together after the mix. On by default
at −14 for new projects and off for anything saved before it existed.
EFFECTS.md §28 has the two things `loudnorm` does behind your back, both of
which are load-bearing.

**Captions** — **On / Off** and **Reset edits**, then four presets (Pop,
Kinetic, Clean, Bold centre), then the *same* **Style** and **Animation**
libraries the text clips use: all 42 looks and all 9 animations, previewed on
tiles showing a real caption with a word highlighted. Then the **Font**,
**Size**, **Words** per line, **Place** (top / middle / bottom) with a
**Margin** off the edge, and two colours — the words, and the word being
spoken.

The word being spoken is lit and slightly larger, and the highlight rides on
top of whatever style is chosen — a chrome caption keeps its chrome and only
the spoken word changes colour.

A plain caption is burned in during the normal encode and costs nothing extra.
A styled or animated one is painted first — only the pictures that actually
differ, over only the band of the frame it occupies — and composited in the
same pass, and the strip says so while that is the case. On twenty seconds of
1080×1920 that is about six seconds against the thirty-two the old two-pass
path took. With nothing transcribed, the strip says the captions will be
skipped.

## EXPORT — making the file

The second strip (`ExportStrip.tsx`). **The Export button is in its header**,
so it is there with the strip closed. Beside it, the header says what the
exports are doing: a bar while one runs (or waits), and once nothing is
running, how the last one ended — **Done**, which shows the file in its folder
when clicked, or **Failed**, which opens the strip on the list with the error.
**File → Export…** (⌘E) works whether the strip is open or not.

Open, top to bottom (`ExportSettings.tsx` first):
**Size** 720p / 1080p / 4K on the canvas's shape, with the pixel size beside
it; **Codec**, listing only the encoders this machine test-encoded with at
launch; **Quality** as High / Standard / Small or a fixed **Bitrate** in Mbps,
with an encode-speed row (Fastest, Fast, Balanced, Smallest) for the software
encoders; **Audio** AAC 128 / 192 / 256k; **File** .mp4 or .mov (ProRes forces
.mov); and, when the timeline has in/out marks, **Only between the marks**.

**Saved settings** — each is an export in one click, not a load: it opens the
save dialog and exports with its own shape, size, codec, quality, loudness and
captions, for that file only (the panel, the canvas and the project's own
settings stay as they were), and puts its suffix in the filename so a reel and
a wide cut of the same edit do not overwrite each other. Its tooltip lists what
it carries. Three are built in — **Reel / TikTok (9:16)**, **Feed square
(1:1)** and **YouTube (16:9)** (`render/presets.ts`) — and **+ Save current**
names and keeps what the panel shows now; the X that appears on hover beside
one of your own forgets it.

**Exports** — the list, downloads from the URL tile included. Each row has its
bar, its status, its speed and, after its first few seconds, the time left; a
cancel while it runs and **Show in folder** when it is done. **Clear** takes the
finished ones off.

---

## The canvas bar

Over the picture (`CanvasBar.tsx`). The shape — **16:9 Landscape**, **9:16
Vertical**, and a smaller **1:1 Square**, each drawn as well as named. Changing
it re-solves every clip's reframe; drag the rectangle in the preview to correct
one. When most photos in the pool are the other way round from the canvas, a
chip beside the shape says so — "Most photos are portrait" — with **Switch to
9:16** (or 16:9) on it, and its tooltip says why; the rule is
`shared/edit/orientation.ts`. In a narrow window the shape words step aside for
the chip and the glyphs and tooltips carry them.

At the right end, the view: **Source / Split / Output**. Drag the divider in
the picture to compare; double-click it for an even split. The reframe
rectangle is drawn on the source, so pressing **Reframe** in the Output view
opens the split.

---

## Preview — direct manipulation

Select a clip and you can work on it where you can see it.

- **Any clip**: a box with handles. Drag inside to move, the stalk above to
  rotate (hold shift for 15° steps). **Resizing is free-form**: the four corner
  handles move both axes independently and the four edge handles move one —
  drag a side for width, the top for height. Hold shift on a corner to keep the
  proportions.
- **A text clip**: click the words to edit them, drag to move, the corner dot to
  size the type. Enter commits, shift+enter is a new line, escape cancels.
- **A mask**: pick **Mask** or **Blur** in the tool strip and a shape appears on
  the picture. Drag inside it to move, the edge dots to resize along its own
  axes, the dot above to rotate (it snaps to the straight angles). Everything
  outside the shape is dimmed so the region reads at a glance, and the outline
  is drawn feathered, so softness is something you see rather than a number you
  imagine. Pressing the same tool again takes the mask off.

Anything you add — a sticker, a prop, a colour card, text, a title — lands
**under the playhead**, so the thing you just added is the thing on screen with
handles around it. If you later select a clip that sits at a different moment,
the preview says so and offers one click to go to it: a clip is only drawn
while the playhead is over it, and handles can only exist over a frame being
drawn.

**The tool strip** runs down the left of the picture (`Toolbox.tsx`): Select,
Reframe, Thirds, Safe areas, **Text**, Mask, Blur — and, under a rule, Paint,
which is greyed because painting pixels frame by frame is a long way off and
worth being honest about. Reframe, Mask and Blur need a selected clip and say
so when there is none.

**Text** here means words ON this picture: the card lands over whatever is
under the playhead. `+ Text` in the Shelf's Text tile adds a text clip to the
timeline. Both make the same kind of clip; where you reach for it is what says
which you meant.

**Dropping onto the picture.** The canvas takes a drag from the pool or the
library. It lands on the top video track at the playhead, filled to the frame,
and a chip at the top offers the other two readings: a corner **Picture in
picture**, or a **Blurred background** — which is sent underneath everything,
since a blurred copy drawn on top hides the shot it was meant to sit behind.
**Fill the frame** goes back. Each choice writes ordinary transform and mask
values, so none of them is a mode and the result stays draggable. A sound
dropped here is refused: it has no appearance.

An empty project says what to do on the picture itself — drop pictures or a
clip here, or open Director and press Direct.

---

## Timeline

Under the picture: the **transport** first (`Transport.tsx`) — start, play,
end, **Loop**, **Scrub** (hearing the sound while you drag the playhead), split
at the playhead, remove the selected clip, the master meter, the timecode, and
zoom out / in. ⇧Z fits the whole project.

Video tracks are listed **highest first**, like every other editor: the track
at the top of the list draws on top of the picture. Audio sits below.

Clips are **coloured by kind** — video violet, photos teal, text yellow,
graphics (paper clippings, colour cards, the photo ring) green, stickers pink,
music emerald, sound effects amber, voice lime, adjustment layers red. The
legend above the tracks lists only the kinds on this timeline, and clicking one
**dims** that kind on the timeline so the rest are easier to find — they stay in
the export. A selected clip is outlined in its own colour. At the right of the
same row, **Mark in** and **Mark out** (or I and O) set a range at the
playhead, drawn on the ruler; the range's length is a button that clears it.

`+V` and `+A` add tracks. On each track header: the **eye** hides a video
track, picture and sound, from the preview and the export; the **speaker**
mutes a track (on a video track only its own sound — the picture still plays);
**S** solos it. An audio track also has the red **record** button, which
records a voice-over onto it while the edit plays, and **VO**, which marks it
as speech so music ducks under it. Then the track's own meter, and on hover a
bin that removes it (the last video track cannot go).

**Selecting.** Click a clip; shift-click takes in everything between it and the
first selected clip on the same track, ⌘-click (Ctrl-click) adds or takes away
one, and a drag on an empty lane draws a marquee. Click a
gap to select it — Delete then closes it. Dragging one of several selected
clips moves them all.

**Editing.** Copy, cut, paste (at the playhead, keeping the arrangement) and
duplicate (each copy straight after its original) are on ⌘C, ⌘X, ⌘V and ⌘D and
on the clip's **right-click menu**, which also holds **Speed**, **Voice** (six
presets: Chipmunk, Bright, Deep, Monster, Phone call, Radio), **Look** (the
seven grades), **Split here**, **Detach audio** (and **Restore its own sound**),
**Select all**, **Delete** and **Ripple delete** (`ClipMenu.tsx`). Delete leaves
the gap and shift-Delete closes it; alt-arrows nudge the selection a frame, ten
with shift. The shortcuts sheet (⌘/) has the rest.

**A clip moves in both axes.** Drag it sideways in time and up or down through
the layers in one gesture, onto a lane of the same kind. This did not exist
until recently — the drag only read `clientX`, so a clip could never leave the
track it was born on. That is why picture-in-picture felt pointless: there was
no way to get a second video above a first one for it to be in front OF.

**The waveform is drawn on the clip.** Any clip whose asset has sound shows it:
full height on a sound file, the **lower half** on a video clip, which is what
Premiere and Resolve both do and leaves the top for the name now and
thumbnails later. It stays on video clips because speech lives there — a
one-camera wedding's vows are V1's audio, not a separate track, and "cut just
before he says it" is the cut you would otherwise scrub blind for.

`ClipWaveform.tsx` draws it; `@shared/render/waveBars.ts` decides *what* to
draw and is where the hard part lives. A clip shows a **window** of its source
— trimmed at both ends, and consuming `duration × speed` frames of file per
frame of timeline — while the peaks array spans the whole file. Three things
that are easy to get wrong and impossible to see afterwards, because a waveform
of the wrong part of the sound looks exactly as convincing as the right one:

- index by the peaks' **own** `durationMs`, not the asset's `durationFrames` —
  a video whose container claims ten seconds can carry eight of sound
- **aggregate** buckets per column rather than sampling one, or a snare
  disappears and reappears as you zoom
- ask for buckets **proportional to the source** (`bucketsForSource`, 20/s,
  clamped 200–4000) — a fixed 600 over a ten-minute podcast is one a second, so
  a two-second answer cut out of it gets two bars

The canvas is capped at two pixels per available bucket and stretched with CSS,
so a ten-minute clip at maximum zoom is a few thousand pixels of canvas rather
than two hundred thousand — which a canvas cannot allocate at all.

**The volume line is drawn over it.** Click the line to add a point, drag a
point in time *and* level, double-click one to remove it. They are ordinary
`volume` keyframes — the same ones the Volume curve in the Curve tray shows —
compiled at render into `volume=…:eval=frame`, which is measured to work
(EFFECTS.md §1).

This is the **drawn** kind, the Ableton kind: *quiet here, because I say so*.
It is not ducking, which is automatic and lives on an audio track's `duck`
flag. Both should exist; they answer different questions.

**Fades are the third thing, and also separate.** Grips at the top corners of
any clip with sound: drag inwards to fade up or down, double-click to remove.
The shaded ramp is always drawn so a fade is visible without hunting; the
grips only appear on hover or when the clip is selected, because an
always-live target eleven pixels into the trim strip would quietly take a
slice of trimming away from every clip nobody is fading. The two fades cannot
pass each other — they meet and stop.

A fade **multiplies** the envelope rather than replacing it, which is what a
DAW does and why they are separate controls: softening an entry should not
mean redrawing a curve you already shaped. `audioFade.ts` has the `qsin`
measurement and EFFECTS.md §26 has the chain-order reasoning, which is the
whole correctness of it.

**Overlap on a track means crossfade**, and that is derived rather than
stored — so it is true of a dropped video transition as much as of a
deliberate crossfade. Until this existed, every dissolve played both
soundtracks at full and measured 3 dB hot. Explicit fades still win.

The one audio control that is *not* on the clip is **Crossfade with the clip
before**, in the dock's Sound section, because it has to CREATE the overlap it
fades across and the drag that would do it is already taken: dragging a clip
onto its neighbour sequences it clear, which is load-bearing for stacked layers
like grids and filmstrips (see `moveClip`'s `stacked` check). So the button
makes the overlap — sliding the incoming clip back and closing the track up
behind it — and the grips on the clip shape it afterwards.

**What an overlay on a clip may take.** The envelope first shipped as a
full-bleed `absolute inset-0 z-10` div with `onPointerDown` on it, which is the
obvious way to make a line clickable — and it made **every clip with sound in
it immovable**: no dragging, no cross-track drag, no trimming, no selecting.
Clicking a clip added a volume point instead of picking it up. So: the
container is `pointer-events-none`, the line takes pointers back through a
transparent fat stroke (`pointerEvents: 'stroke'`), the dots opt in
individually, the trim handles sit at `z-20` above it all, and the waveform
never takes a pointer at all. `tests/clipOverlays.test.ts` guards each of
those against the source — jsdom implements neither stacking contexts nor
hit testing, so a mounted-component test would have certified the bug.

**Missing here, in the order you would notice:** no markers; and no lock on a
track (the model has one, `Track.locked`, and nothing on screen sets it).

---

## The Curve tray — keys and curves

At the right end of the timeline (`CurveTray.tsx`), **closed by default** to a
28 px rail: a **Keys** button, a **Curves** button and the words "Keys &
curves". A dot on Keys says the selected clip has keys (its mask's included)
or a motion path. Nothing opens it but you — not selecting a clip, not keying one; the
dock's **Open keys** button does, on Keys. Open, it is about 320 px and has the
two tabs and a chevron that closes it. Drag its edge to make it wider; drag it
shut and it closes.

**Keys** — the selected clip's keyframe rows (`Keyframes.tsx`): **Zoom**,
**Rotate**, **Opacity**, and **Volume** on a clip with sound. The diamond adds a
key at the playhead and lights up when you are sitting on one; moving a slider
between keys writes a new one there. Each key eases `linear`, `smooth` or
`hold`. One key is a value, two or more animate. Under the rows, the **Motion
path** (`MotionPathPanel.tsx`): presets (In from left, Across →, Out to right,
Drift up…), **Add point at playhead**, and **Clear**, which clears the path.
Position only.

**Curves** — the graph (`CurvePanel.tsx`), with its own two tabs. **Motion** is
the selected clip's keyframes as a curve: pick **Zoom**, **Rotate**, **Opacity**
or **Volume** on the row under the tabs, click to add a point, drag one,
double-click to remove it, or press **Draw** and sketch the whole shape. Time
runs from *clip start* to *clip end*; the range between them under the graph is
what its height spans. A clip with a mask also gets **Mask X**, **Mask Y**,
**Mask W** and **Mask H**. Zoom, rotation and the mask show a window fitted
round their keys, so a small move fills the graph — drag a point past the top
and the window grows when you let go. Opacity and volume always show their
whole range (volume matches the fader). **Colour** is the tone curve.

---

## Settings

The gear at the top right (`SettingsPanel.tsx`). A card under the header; Esc,
its X, or a press anywhere else closes it. The Director's own gear opens the
same card.

**Model servers** — the ones the Director plans with: **Auto**, **Ollama**, or
an OpenAI-shaped server (the button reads **LM Studio** for one on this
machine, **Hosted** otherwise). Each has its **Server** and **Model**; the
OpenAI-shaped one has a **Key** that is write-only — **Save** sends it, **Clear**
forgets it, and the field only ever says it is saved. **Check again** asks the
servers afresh, and a line under each says why it is not ready when it is not.

**AI helper (Python)** — Running, Starting or Not running, with the reason when
it failed, and what it does on this machine: transcription, beat finding,
depth, stem splitting, the local voice and the Director's look at your photos.
The editor works without it.

**Hosted voice** and **Pexels** — listed, and marked "coming with Narration".

---

## Two things worth knowing

**Restart after a main-process change.** The renderer hot-reloads; the main
process and the AI helper (the Python sidecar, `src/main/sidecar/`) do not.

**`npm run harness`** serves the interface as a web page on port 5199, with the
app services stubbed. It exists so the UI can be looked at and clicked without
launching the app. It cannot export, bake depth, or decode real media — those
calls throw with a message saying so rather than pretending. From its console:
`forgeStore` is the editor's store and `forgeCatalog` the asset catalog, to
read and to drive; `forgeMenu('new')` and `forgeFullScreen(true)` stand in for
the menu. **`await __forgeCensus()`** walks every control in
`tests/fixtures/ui-census.json` — each in its own place and the state it needs —
and reports `{ missing, checked, skipped, scenario, ms }` (plus `trace`, every
row's count, when asked for with `{ trace: true }`). `missing` must be `[]`;
each entry in it says why — absent, not rendered, or **ambiguous**, meaning
something else on screen wears the same label, so the control could go
unnoticed. It takes thirty to forty-five seconds and must run in the fronted tab
(`harness/census.ts` says why). A control added anywhere in the window gets a
row there, or this map and the census drift apart.
