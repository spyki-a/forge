# Effects — grading, keyframes, mattes, adjustment layers

What the renderer can and cannot do, and how each was established. Everything
here was measured against the bundled binary rather than inferred from
documentation, because several of these filters advertise a capability they do
not have.

---

## 1. What ffmpeg can actually animate

The single most expensive thing to rediscover. Each row was tested by rendering
frames and reading the pixels back.

| Property | Filter | Works? | Notes |
|---|---|---|---|
| Position | `overlay` `x`/`y` | **Yes** | Expressions in `t`. The motion path has always used this. |
| Rotation | `rotate=a='…'` | **Yes** | Expression in `t`. |
| Opacity | `geq` on the alpha plane | **Yes** | The only filter here that exposes time to a per-pixel expression. Expensive. |
| Zoom | `zoompan` `z` | **Yes** | Counts output frames in `on`, not seconds. |
| **Size** | `scale` with `eval=frame` | **NO** | Re-evaluates and does **not** follow its expression. Asked for 192px→495px, got a constant 138px. |
| **Crop w/h** | `crop` | **NO** | Resolves `w`/`h` once at configuration. Same trap. |
| **Volume** | `volume` with `eval=frame` | **Yes** | Genuinely follows its expression, unlike `scale` above. Measured on a 4s tone with `if(lt(t,2),1,0.25)`: second half came back **12.0 dB** down, which is 0.25× to within rounding. This is what the drawn volume envelope compiles to. |

`eval=frame` is therefore **not** a property of the build — it is a property of
each filter. `scale` accepts it and ignores it; `volume` accepts it and honours
it. Neither can be inferred from the other, so each one has to be measured.

The envelope's `t` is **clip-relative**, because `adelay` sits after `volume` in
the audio chain: at that point the stream starts at zero whatever the clip's
position on the timeline. A test whose clip started at frame 0 could not tell
that apart from timeline time and passed against a deliberately wrong time
base — the test now starts a clip a second in.

So animated *size* does not exist. A punch-in is expressed as a zoom into the
picture, which is what it wants to be anyway — and the UI says "Zoom", not
"Size", so it does not promise something that cannot export.

### Two traps inside the working ones

**`geq` calls time `T`, not `t`.** With a lowercase `t` the parser reports
`Unknown function in 't,2.0000)...` — it reads `t(` as a call to an undefined
function, and the entire graph refuses to build.

**Everything before `setpts` sees clip-relative time.** `rotate`, `geq` and
`zoompan` all run earlier in the chain than `setpts=PTS-STARTPTS+offset`, so
their frames still carry source timestamps starting at zero. Writing a curve
against the clip's *timeline* position works perfectly for the first clip on a
timeline and freezes every clip after it. Only a clip that starts late catches
this, so there is a test for exactly that.

---

## 2. Grading

`ColorAdjust` existed on every clip from the first commit and was read by
nothing — no `eq`, no preview filter. It is now real.

The three sliders were chosen to **be** ffmpeg's `eq` parameters, so there is no
conversion to get wrong: brightness is an offset around 0, contrast and
saturation are multipliers around 1. The neutral state is therefore also the
identity, and an ungraded clip costs no filter at all.

### LUTs

`.cube` is what every grading tool exports and what ffmpeg reads directly.

**`lut3d` has no mix or intensity option** — checked against the binary, not
assumed. Anything short of full strength needs the graded and ungraded pictures
blended, and a blend takes two inputs, which makes it a sub-graph rather than
another link in a chain.

Alpha is held at full through that blend (`c3_opacity=1`). Without it a
half-strength look would also make a sticker half-transparent. Measured on a
40%-alpha source, the alpha comes out `0x66` either way.

**`blend`'s opacity weights its FIRST input** — measured: red first, blue
second, `all_mode=normal` at 0.8 gives `rgb(202, 0, 47)`, at 0.2
`rgb(49, 0, 202)`. The first input is the ungraded copy (it has to be: a
`blend` disabled by `enable` passes its first input through, which is how an
adjustment layer stops outside its span), so its opacity is `1 − intensity`.
Until 24 Sept 2026 it was `intensity`, and every partial look exported
inverted — 0.8 came out at 0.2, and the preview, which mixes the right way
round, disagreed with every export. **Every render check used 0.5**, the one
value at which a mix and its inverse are the same picture. Found by the
`spine@2` render check, whose recipe look is 0.75. Test partial strengths at
an asymmetric value.

Seven looks ship generated rather than licensed — lift/gamma/gain, an S-curve,
split-toning — written out as ordinary `.cube` files. There is therefore one
kind of LUT in the product: a file with a path. A look the user loads goes down
the identical path, and nothing has to know which is which.

### The preview has to run the same maths

Canvas 2D cannot do a 3D LUT, and its `filter` property cannot express `eq` —
CSS `brightness` is a multiplier where ffmpeg's is an offset. Approximating with
CSS filters would put a different picture on screen from the one that exports,
which is worse than showing nothing. So the preview runs the actual formulas on
the GPU: RGB→YUV, `eq`, YUV→RGB, then a 3D LUT texture.

**CORS is not optional for this.** WebGL refuses a texture from an element that
was not fetched with CORS approval. `forge-media://` needed `corsEnabled: true`
in `registerSchemesAsPrivileged` *and* `crossOrigin` on the elements — with only
the second, every image failed to load at all and the preview went black while
the audio kept playing. The elements now fall back to a plain load if the CORS
one ever fails: a preview that cannot show a grade is a small problem, a black
preview is not.

---

## 3. Mattes — text as a window

The trailer look: block letters with footage moving inside them.

`alphamerge`, the same filter the mask transitions use, with the shape coming
from a clip on the timeline rather than a file in the library — so the word can
be retyped and the fill follows it.

A clip marked `matteOnly` is never composited; it becomes a greyscale mask at
canvas size and another clip's `matte` points at it. The shape stays an ordinary
clip: visible, selectable, editable.

**The trap:** the overlay chain hands its output along and the *last* composited
clip must produce `[vmix]`. Skipping a matte shape means "last" is no longer the
last index, and getting that wrong silently drops every clip after the skip.
There is a test for a timeline whose final clip is a shape.

---

## 4. Adjustment layers

Resolve's shape, and the elegant part is that one object carries two meanings on
two axes: **track position decides which layers are included, horizontal
duration decides when.**

It falls out of the compositing order almost for free. At the point an
adjustment layer is reached, `current` already holds every lower track
composited together — so the layer is simply a filter on that stream, gated with
`enable='between(t,start,end)'`. Both `eq` and `lut3d` support the timeline
`enable` option; a disabled `blend` passes its first input through untouched,
which is the ungraded copy.

The layer is backed by a transparent card so it is an ordinary clip — draggable,
trimmable, selectable — rather than a special case the timeline has to know
about.

In the preview they are flushed **in track order, interleaved with the layers**,
not applied to the finished frame. Grading at the end would wrongly catch a title
sitting above the adjustment layer, which is exactly where titles usually sit.

---

## 5. Text rasterisation moved to the renderer

Text used to be an SVG through sharp, which uses librsvg, which resolves fonts
through fontconfig.

**It has one face and ignores the family entirely.** `font-family="Anton"`,
`"sans-serif"` and a deliberately bogus name produced byte-identical output —
the same ink count to the pixel — at every setting of `FONTCONFIG_FILE` and
`FONTCONFIG_PATH`. Choosing a font could never have worked through that path.

So text is drawn in the renderer, where the catalogue's fonts are already loaded
as `FontFace` objects built from bytes, and only the finished pixels go to the
main process to be written. Placement lives in one shared `layoutText` used by
the baked PNG, the SVG and the on-picture editing box, so the box you drag cannot
sit somewhere the export does not.

---

## 6. Generated artwork and the canvas size

Text, colour cards and titles are authored **at** the canvas size. Auto-reframing
them is therefore always wrong: solving a crop for a PNG that is still the old
aspect takes a sub-rectangle of the words, cutting them off and shoving them out
of frame.

They are excluded from auto-reframe and re-baked at the new size when the aspect
changes.

---

## 7. Masks — a shape, and a verb

The research question was "what belongs in a Photoshop-style toolbox?", and the
answer both Resolve and CapCut give is: not a paint toolbox. Resolve calls it a
**Power Window**, CapCut calls it a **Mask**, and neither lets you push pixels
around frame by frame. What people actually want is to *confine* something —
blur this face, darken that corner, warm only the sky — for the length of a shot.

So a mask here is a region plus a verb, never a brush stroke:

| Mode | What it does |
| --- | --- |
| `reveal` | show the clip only inside the shape |
| `blur` | blur inside the shape — invert it and the background goes soft |
| `grade` | the clip's own colour applies only inside the shape |

Shapes are `rectangle`, `ellipse` and `linear` (a half-plane, for a horizon),
each with position, size, rotation, feather and invert.

### The shape is sized off the stream, not the canvas

`maskExpression` writes every length against geq's own `W` and `H` rather than
baking in a pixel count. Two separate reasons, both measured:

1. **Subsampling.** geq runs once per plane and a subsampled format's chroma
   planes are half size, so an expression in absolute pixels draws a half-scale
   shape in the corner of those planes. A centred circle came back as a
   washed-out smear — the luma said "inside" where the chroma said "outside".
2. **Picture-in-picture.** By the time the mask is applied the clip has been
   fitted to its **box**, which equals the canvas only when the clip fills the
   frame. A canvas-sized mask is wrong for every PiP. Sizing off the stream makes
   the mask a property of the clip, so it travels with a PiP that is moved.

The shape stream itself is a `split` of the clip's own stream rather than a
generated `color` source, so it is always exactly the size of the thing it masks.

### Three routes were measured; two are wrong

Confining an effect to a region means combining two pictures by a per-pixel mask.

- **`overlay` straight onto the original — WRONG.** With a half-transparent
  source, the region under the overlay came back **fully opaque**. A sticker with
  a blurred patch would have grown a solid rectangle nobody asked for.
- **`maskedmerge` — WRONG on subsampled input.** It merges plane by plane, so a
  grey mask becomes neutral chroma (128) and blends the colour 50/50 everywhere:
  red over blue came back magenta.
- **Strip the alpha, merge opaque copies, put the alpha back — EXACT.** Both
  sides of a feathered edge matched to the byte.

That last one is what ships:

```
[in]split[keep][work]
[keep]format=yuva420p,alphaextract[alpha]
[work]format=yuv420p,split[plain][affect]
[affect]<gblur | eq,curves | lut3d>[done]
[done][shape]alphamerge[cut]
[plain]format=yuva420p[base]
[base][cut]overlay=0:0:format=auto,format=yuv420p[merged]
[merged][alpha]alphamerge[out]
```

### One alphamerge, never two

`alphamerge` **replaces** alpha rather than multiplying into it, so a second one
silently discards the first. A matted clip that was also revealed by a luma wipe
lost its matte, despite a comment promising the two "multiply". Every shape —
the matte clip's luma, a reveal mask, a wipe — is now multiplied into one stencil
and applied once.

For the same reason, opacity and a transition's fade move **after** the mask on a
masked clip: they write alpha, and the shape landing on top would erase them.

### Preview and export agree

Canvas blurs alpha along with colour, so a text card grew a soft halo out past
its own edges while ffmpeg — which blurs the colour planes and restores the
clip's own alpha — would not have. Caught in the harness at a large radius. The
preview now multiplies the blurred copy back by the source's alpha. For opaque
media, which is what this tool is for, both are a plain blur.

---

## 8. Live text, and what an always-on draw loop was hiding

Typing used to cost a full-canvas PNG encode, an IPC transfer, a disk write and a
re-decode on every pause, and **adding** a text clip additionally spawned
`ffprobe` to ask the finished file how big it was — a question whose answer was
already known, because a text card is exactly the size of the canvas.

Text, colour cards and titles are now drawn **live** in the preview from their
spec, through the same shared `layoutText`. The PNGs are written once, on the way
to an export, where they are the only place they have ever been needed.

The preview draw loop also called `draw()` on **every** animation frame
regardless of whether anything had changed — sixty full composites a second, for
ever, while the app sat on a still frame. It now repaints only when the picture
could have changed, or while playing.

That loop was covering for missing wiring, and removing it exposed three things
that had never been connected:

- an `<img>` or `<video>` finishing its decode — React does not re-render for it
- `seeked` on a paused video — scrubbing changes the picture with no state change
- a font arriving after first paint, now that text is drawn live

All three now mark the canvas dirty. `repaint()` sets that flag **itself** rather
than relying on a re-render: `draw` is memoised over the project, the playhead
and the view settings, and none of those move when a LUT finishes loading.

---

## 9. Speed — slow motion and fast motion

The biggest single gap for short-form. A held beat in slow motion and a whip
through the boring part are the two edits that most reliably separate a reel
that plays from one that gets scrolled past.

The model is the one every editor uses: **the source range stays put and the
clip's length changes.** Half speed makes a two-second clip four seconds long
and shows exactly the same footage.

```
source frames consumed = duration × speed
timeline frames occupied = duration
```

That is why changing speed rewrites `duration` rather than `inPoint`, and why
the input is trimmed with `-t duration × speed` — asking for the full timeline
length would both waste a decode and run past the end of the shot.

### Speed is a self-contained prefix

`setpts=PTS/S,fps=N`, at the very front of the clip's chain.

`setpts` re-times without changing the frame count, so on its own a slowed clip
is the same frames spread thinner — a stream claiming 30fps while delivering 7.
The `fps` filter immediately after restores the count, and **everything
downstream then sees a perfectly ordinary clip of exactly `duration` frames**.
That matters: motion, rotation, opacity keyframes and the transitions all read
clip-relative time, and any of them seeing a half-rate stream would have drifted.

At speed 1 nothing is emitted at all, so every existing project produces a
byte-identical graph.

### atempo has a floor, measured

`[0.5 - 100]`. A tempo of 0.4 is refused outright — *"Value 0.400000 for
parameter 'tempo' out of range"* — so quarter speed is **two halvings chained**,
not one filter. `atempoChain` keeps every link inside the range and multiplies
back to the speed asked for, which is a property the tests check across the
whole range rather than at a few points.

Tempo runs **before** `adelay`: the stretch belongs to the clip, the delay places
the stretched result on the timeline. The other order would scale the offset too
and slide every slowed clip out of sync.

### Smooth slow motion costs 41×

`minterpolate` invents the in-between frames instead of repeating them. Measured
at 1080x1920, eight seconds of output:

| | time |
| --- | --- |
| plain `setpts` | **0.67s** |
| `minterpolate` | **27.46s** |

So it is opt-in, never the default, and only offered below 1× — speeding up
discards frames and has nothing to interpolate.

### A photograph has no rate

Stills are excluded everywhere: no filter, no panel. "Speeding up" a still is
just a trim wearing a different name, and offering it would be a lie about what
it does.

### The ripple

Changing speed pushes whatever follows on the same track, so a clip that doubles
in length does not grow straight through its neighbour. Clips on other tracks,
and clips that start *before* this one ends — a deliberate overlap — are left
alone. The rule is a pure function in `render/speed.ts` rather than in the
store, so it is tested rather than looked at.

One known limit: durations are whole frames, so round-tripping through several
extreme speeds can shed a frame or two to rounding and to the clamp against the
available footage. Measured at three frames lost over four consecutive extreme
changes.

### What the harness could not see, and now can

The browser harness could only ever produce **images**, so half the editor was
invisible to it — playback rate, seeking, drift, trimming, and now speed. It
records a real canvas to a webm with `MediaRecorder` instead.

The first version of that recorder drew `seconds × fps` frames one per animation
frame, which on a 60Hz display recorded 180 frames in three seconds and produced
a three-second file the harness then announced as six. It now paces on the wall
clock and **measures the result back off the file**, because a harness that
misreports a duration sends you hunting a trimming bug that does not exist.

It immediately earned its keep: at quarter speed the 2× button was dead, because
the panel greyed out fast presets when it judged there was "not enough footage
left". That was simply wrong — speeding up never runs out of anything, it just
makes the clip shorter — and it left no way out of slow motion but the reset.

---

## 10. Text styles — the trending caption looks

The packs people buy are **not fonts**. Look closely at any of them and the same
small vocabulary is doing all the work:

- a gradient or **metallic** fill
- a coloured **outer glow**
- an **outline**
- a soft **shadow**
- and, over and over, a **second line treated completely differently** — heavy
  metallic caps with a light script underneath

"SUGAR" in metal with "Daddy" in green script is two paints and two faces, not
one exotic typeface.

### Style and font are two axes, on purpose

A style is a **recipe**; a font is a **face**. Keeping them independent is what
turns two dozen recipes across fifty faces into **twelve hundred looks** instead
of twelve hundred presets nobody could name or maintain.

No style names a font family it cannot guarantee is installed — a test enforces
that — so a style varies weight, slant, size and tracking, and the letters stay
whichever ones the user picked.

### How twenty-four styles are shown without drowning anyone

Not as a catalogue of somebody else's words. Every tile is **your** text in
**your** font, drawn by `drawTextOnto` — the very function that draws the real
thing and bakes the export. Change the font and all two dozen tiles change with
it. A tile that merely resembled the style would be worse than no tile: it would
be a promise the export does not keep.

### Why the first version showed "very few"

All twenty-four went into a short scrolling box **inside the inspector, which
already scrolls**. About five were visible and nothing indicated there were
nineteen more — reported, accurately, as *"why do I see very few?"*. A nested
scrollbar is close to invisible, and a library you cannot see the shape of may
as well not exist.

Now the inspector keeps six tiles for reaching a favourite quickly (always
including whichever one is currently on, or picking from the gallery and then
finding it nowhere in the panel is disorienting), and **Browse all 24** opens a
proper gallery: blurred backdrop, searchable, a three-column grid at a size
where the looks can be judged — and a **large hero preview over the actual
frame** that follows the pointer as it moves across the grid.

The hero matters more than it sounds. A thumbnail answers "what is this style";
it cannot answer "does this look right on MY shot", which is the only question
being asked. If the frame cannot be copied the card stays dark rather than
inventing a backdrop, since a fake background would flatter some styles and
sabotage others.

### Paint order is the whole trick

Glow, then shadow, then outline, then fill — each as its **own pass**. Canvas
applies a shadow to everything drawn in that pass, so setting a shadow and
stroking in one go grows a smeared copy of the outline, which is precisely what
makes a hand-rolled version of these looks read as cheap.

The glow is **several blurred passes, not one**: a single canvas shadow at a
large radius spreads its energy too thin to read as a glow. Redrawing the
blurred shape accumulates it, the way a compositor builds one.

A gradient is built around **that line's** measured box — its width and its cap
height — or a two-line style ramps across the wrong distance and the second line
comes out a flat slab of the end colour.

### Nothing leaves the frame

Long text **wraps** at the title-safe margin; it does not shrink away. The first
version scaled the whole block down until it fitted, which made a long headline
into a small headline — and worse, the on-picture editing box is HTML and wraps
by itself, so the editor showed something different from the render. Two answers
to one question is the bug, whichever is prettier.

Shrinking survives only as the fallback for a **single unbreakable word**, since
there is nowhere for that word to go and clipping it would hide what was written.
Measured on a 640x360 canvas with a safe box of 32..608:

| | ink | lines |
| --- | --- | --- |
| long text, no style | 41..599 | 2, wrapped |
| long text, styled | 38..600 | 2, wrapped |
| one 34-letter word | 31..608 | 1, shrunk to fit |
| short text | 259..382 | 1, centred |

### Subtitles got the same boundary

Two separate faults, found while adding it:

- The caption **preview** centred the line and applied **no horizontal margin at
  all**, so a long subtitle ran straight off both edges.
- The **export** declared a 6% margin and then set `WrapStyle: 2`, which tells
  libass *not to wrap* — so the margin it had just been given was ignored.

Both now use one shared `CAPTION_MARGIN`, the preview packs words into lines
that fit it, and the export asks libass for smart wrapping (`WrapStyle: 0`).

### What captions cannot inherit

Gradients, metallic fills and glows are **not expressible in `.ass`**, which is
how captions are burned in. Auto-captions can have the colour, weight, outline
and shadow parts of a style, and nothing more, until caption rendering moves onto
the same canvas path the text clips use.

## 11. Animated text — the frames that move, and only those

A trending caption is a still frame of something moving: words arriving one at a
time, a line springing up on the beat. A static style cannot imitate it, however
well drawn.

### The model

An animation is a very small pure function — `src/shared/render/textAnimation.ts`:

```
(progress, index, count) -> { dx, dy, scale, alpha }
```

Offsets are fractions of the font size, so an animation is independent of the
size, the face and the style. That is deliberate: **nine animations multiply the
library rather than adding to it**. Any animation works with any of the 42 styles
on any font.

`scope` says what a piece is — a `word`, a `char`, or the whole `block`.
`stagger` says how far apart consecutive pieces start, as a fraction of the
duration, which is the dial that turns one animation into a family of them.

### Why it stays cheap: bake the movement, hold the rest

The naive approach bakes a PNG per frame of the clip: **ninety files for a
three-second caption**, and ninety full-canvas encodes behind a feature the user
expects to be instant.

Only the frames that *move* are written. `animationFrames` decides how many, and
the last one is held for the rest of the clip by `tpad`. Measured in the app:

| animation | pieces | clip | frames baked |
| --- | --- | --- | --- |
| Pop | 3 words | 90 | **16** |
| Typewriter | 3 words | 90 | **4** |

Two facts make that safe, and both are tested rather than assumed:

- **Every animation settles exactly on `STILL`** by its last baked frame — for
  every piece, at every count. An animation that did not would be frozen
  mid-flight for the whole caption, and no test of the curves would have noticed.
- **`tpad=stop_mode=clone` preserves alpha.** Measured against the bundled
  binary: four frames at 30fps with `stop_duration=2`, trimmed, gave exactly 60
  frames of 2.000s with rgba `7f` still `7f`. Text is nothing but alpha, so a
  filter that flattened it would have been useless here.

### The export path

The baked frames land in `<clipId>.seq/%05d.png` and reach the render plan on the
asset as `frames: { pattern, count }`. `path` still points at the settled still,
so anything wanting one picture of the clip — a thumbnail, an older project —
finds one.

```
-start_number 0 -framerate <fps> -i <clipId>.seq/%05d.png
...
tpad=stop_mode=clone:stop_duration=<clip>,trim=duration=<clip>,setpts=PTS-STARTPTS
```

`-start_number 0` because the frames count from zero and **image2 looks for 1 by
default**. This build happens to find them anyway; a build that did not would
silently drop the first frame of every animation — the one that matters most.

The hold runs **before everything else** in the chain. Speed, motion, the fit,
rotation, opacity keyframes and every transition read clip-relative time and
assume a stream of exactly `duration` frames; a short one would have drifted them
all.

A matte shape gets the hold too. Footage seen through animated words is a shape
that is itself a sequence, and a shape that ran out part-way would leave the
footage with **no alpha at all** for the rest of the clip.

### Turning it off has to clean up

A clip whose animation is switched back to None must have its folder deleted and
`frames` dropped from the asset, or the export keeps replaying a move the editor
no longer shows. Verified in the harness: `frames` cleared, sequence gone.

### What the preview does

The same canvas painter, with a clock of `playhead - clip.start`. The cache
signature includes the frame **only while the movement lasts** — after that it
collapses to `settled` and the canvas is never redrawn again, so holding a still
caption costs nothing.

Measured in the harness, Pop on a 90-frame clip: lit pixels 0 → 196 → 381 → 615
over frames 0..8, then frames 20 and 45 hash **identically** — settled, exactly as
`tpad` will hold it.

## 12. Captions join the library

The 42 styles and 9 animations were reachable from a text clip and from nowhere
else. Captions — the most-seen type in a short video, and the thing the trending
reference packs are actually made of — could have none of them.

### Why: there were two painters

Captions were drawn twice, by two different pieces of code:

| | drew captions | drew text clips |
| --- | --- | --- |
| preview | `captionPreview.ts`, its own layout and wrapping | `drawTextOnto` |
| export | libass, from a generated `.ass` | `drawTextOnto` |

Every look would therefore have had to be built twice — so in practice it was
built once, for text clips, and captions went without. That is the whole
explanation, and it is not a caption problem; it is a **second painter** problem.

So there is now one painter and one description of a caption:

```
captionSpec(style, words, activeIndex) -> TextSpec     shared/captions/line.ts
drawTextOnto(ctx, spec, w, h, clock?)                  shared/render/textPaint.ts
```

The preview calls both. The export calls both. Neither knows anything else about
captions, which is the only arrangement under which they cannot drift apart.
`textPaint.ts` moved out of the renderer into `shared` for exactly this reason —
it is pure canvas work with no store and no window, and it now has three callers
in two processes.

### The one thing a text clip never needed

`TextSpec.highlight` — the word being spoken:

```ts
highlight?: { word: number; color?: string; scale?: number }
```

Deliberately not a style. The index changes every few frames, and it rides ON TOP
of whatever style the line already has: a chrome caption keeps its chrome, and
only the active word turns colour and grows. Measured in the app on a chrome
caption — 761 pixels of highlight yellow against 749 of chrome white, in the same
line.

It is resolved after wrapping, like the existing word accents, because which ROW
a word is in is not known until the rows exist. For a character-scope animation
the word index is expanded to every letter of that word, or a highlight on word
two lands on the second letter of word one.

### Which path an export takes

ASS is genuinely cheaper — libass runs inside the normal encode and costs nothing
extra — so it stays the answer for anything it can express. `captionNeedsCanvas`
decides, and it is a property of *these* captions rather than of the feature:

```ts
style.animated || style.textStyleId !== undefined || style.animationId !== undefined
```

Choosing a look or an animation moves captions to the Chromium frame server,
which is a second pass and slower. The panel now says so — it previously warned
only for the two presets marked `animated`.

### The tier-2 caption layer

One layer per **line**, not per word. The previous build emitted a layer per word
and placed each one by assuming a word is 2.2 font sizes wide — untrue of any real
font, so every caption was slightly mis-spaced in a way no style work could fix.
A line is one layer carrying a `TextSpec`, and the page measures it properly.

What genuinely varies per word survives as `wordFrames`: the frame each word
becomes the spoken one. The page resolves the active word per frame and hands the
painter a spec with `highlight` filled in.

Fonts reach that window as base64 data URLs inside the spec. It has no preload and
no store, so it cannot ask the app for a face the way the editor does; bytes in
the spec also avoid a fetch and a protocol handler. A face that will not load
falls back rather than failing the render — a caption in the wrong font is
recoverable, a black export is not.

### Verified in the browser, both paths

The graphics page was driven directly with a real spec, at 640x360:

| frame | ink | highlight |
| --- | --- | --- |
| 0 | 0 | — |
| 2 | 1218 | — |
| 6 | 4198 | 1088 (word 1) |
| 12 | 4778 | 979 — the pop overshoot |
| 20 | 4665 | 406 (word 2, a shorter word) |
| 45 | 4665 | 990 (word 3) |

The line arrives, overshoots, settles, and the highlight walks along it — and the
finished frame is centred to within **1 pixel** of the canvas centre, inside the
caption margin, in the lower third. The preview, measured the same way, shows the
same curve.

## 13. Styled captions stopped costing a second render

Captions that libass cannot burn in have to be drawn. The first version drew them
the expensive way, and it showed.

### What it used to do

1. Render the **whole video** to a temporary file — a full encode.
2. For every frame: `executeJavaScript` into an offscreen Chromium window, wait a
   **double `requestAnimationFrame`**, then `capturePage()` and `toBitmap()`.
3. **Decode that video again** and re-encode it with the frames overlaid.

Two encodes, one decode, and a browser screenshot per frame. The double rAF alone
is ~33ms, so a sixty-second video spent a minute waiting before any pixels were
compressed.

### What replaced it

Captions are painted on a canvas now, so none of that is needed. They are baked
in the renderer — where the fonts already live — and handed to the **existing
single-pass graph** as one more input:

```
-f concat -safe 0 -i captions.txt
[N:v]fps=FPS,format=rgba[cap];[vmix][cap]overlay=0:<band>:shortest=1[vcap]
```

Two observations do the work:

**A caption is mostly still.** Between one word lighting up and the next, every
frame is the same picture. The concat demuxer's `duration` holds one file for as
long as it is on screen, so 598 frames of a 60-word timeline bake **61 pictures**
— one per word, plus one blank that every gap reuses.

**A caption occupies a band.** Everything above it never changes, and compositing
is the single biggest cost in the render.

### Measured, at 1080×1920

Overlay cost, per ten seconds of video:

| | render |
| --- | --- |
| no captions at all | 1.75s |
| **band overlay, single pass** | **2.61s** |
| full-frame overlay, single pass | 5.15s |
| the old second pass *alone* | 4.44s |

And the band pays twice, because a PNG of it is cheaper to encode too: **13.8ms
full-frame against 3.8ms**.

The band is measured rather than guessed. The settled line is painted once and
its ink found — only a real paint knows how many rows the text wrapped into and
how far a glow spreads — then grown by exactly how far *this* animation throws a
word. `animationBounds` samples the curve rather than reading its endpoints,
because every good arrival overshoots past both. Checked against every baked
picture of a per-letter bounce: ink 892–1506, band 858–1628, nothing clipped.

### The bake, pipelined

Drawing a picture costs 0.13ms; turning it into a PNG costs 16ms, off-thread. So
awaiting each one leaves the encoder idle while the next is drawn. Four canvases
in flight:

| | 60 pictures |
| --- | --- |
| one at a time | 1000ms |
| two at a time | 502ms |
| **four at a time** | **264ms** |
| eight at a time | 250ms |

WebP was measured and rejected: 21ms lossless (and four times the bytes) or 91ms
lossy, against 16ms for PNG. Narrowing the band horizontally was measured and
rejected too — 16.2ms against 16.5ms, because the cost is the gradient's entropy,
not the pixel count.

### End to end, on twenty seconds of 1080×1920

| captions | old path | now |
| --- | --- | --- |
| a styled look | ~32s | **~6s** |
| plus a word-by-word pop | ~32s | **~8s** |
| plus a per-letter bounce | ~32s | **~9s** |

### A note on measuring

The pipelining appeared to do nothing on first measurement — 8584ms before and
after. It was a **stale module**: a dynamic `import()` of a path already imported
returns the cached copy, so the new code was never running. Cache-busting the
import showed the real figures above. A harness that reports confidently and
wrongly is worse than no harness, which is the third time that lesson has come up
in this codebase.

### What this leaves behind

`startTier2Render`, the frame server and the graphics page still exist and still
work — they are where a future graphics layer that genuinely needs a DOM would
go. Nothing routes to them: `needsFrameServer` returns false, and captions decide
between libass and the bake with `captionsNeedBaking`. The "check graphics
engine" button was removed from the captions panel, since it probed a subsystem
the feature beside it had stopped using.

## 14. Split screen and picture in picture

Two layouts that the transform could always express and that nobody could reach,
because there was no button for them.

### Neither one needed anything new in the renderer

A clip's transform already says how wide its box is (`scale`), how tall
(`scaleY`), where it sits (`x`, `y`, in half-canvas units) and whether it fills
that box or letterboxes inside it (`fit`). Those four went in for the film strip.
A split screen is the same idea with the panels stacked instead of side by side,
so `render/layout.ts` is arithmetic and nothing else — the clips carry the
numbers, and the preview and the export both already knew what to do with them.

The offset is the only part worth writing down. A box of 1/N the frame sits
centred by default and has to move to `slot/N` of the way down; in half-canvas
units that difference is:

```
(2·slot + 1)/N − 1
```

−0.5 and +0.5 for a two-way split, and ±2/3 with a zero in the middle for a
three-way — so a three-panel layout costs nothing extra. `cover` is not optional:
without it a landscape shot in a half-height panel becomes a thin band floating
in black, which is the exact failure the film strip hit.

A picture in picture is the same arithmetic with a gap from the edge. One
conversion matters: `scaleY` is measured against the HEIGHT, so 0.3 of the width
and 0.3 of the height are the same number and very different boxes in a 9:16
frame. A square inset has to convert through the aspect or it comes out tall.

### Rounded corners, which did need something new

Rounded corners are most of what separates an inset that looks placed from one
that looks pasted on, and the mask had only hard rectangles and ellipses. The
rectangle now takes an optional `radius` and switches to the standard rounded-box
distance:

```
clip(((r) - hypot(max(|x| − (rx − r), 0), max(|y| − (ry − r), 0))) / feather, 0, 1)
```

Pull the radius in from both half-extents, measure how far outside that inner box
the point sits on each axis, take the length of the pair. Near a flat edge one
term is zero and the sides stay straight; only at a corner do both contribute,
and there the result is the arc.

That depends on **`max` being available inside `geq`**, which is documented
nowhere obvious. Measured against the bundled binary before the code was written:
it is. The radius is a fraction of the SHORTER half-extent, so corners stay
circular instead of stretching into ovals on a box that is not square.

Because a mask is sized against the clip's own stream rather than the canvas — a
decision made back when masks first met PiP — the frame travels with the inset
when the inset is moved, which is what anyone would expect of it.

### Verified in the app, not just in tests

The circle and the rounded rectangle were both checked by differencing the
preview against the unmasked version, which isolates exactly what the mask cut:

| | pixels changed vs a square box | geometry predicts |
| --- | --- | --- |
| radius 0.35 | 130 | ~123 |
| circle | 999 | ~1005 |

The circle's cut region came back with a square bounding box, corners removed and
edge midpoints untouched — an inscribed circle, and not something a rounded
rectangle could be mistaken for.

One measurement error is worth recording, because it nearly sent me after a bug
that did not exist: the first attempt tested "is the corner cut?" against the
bounding box of the cut pixels themselves, which is circular — if little is cut,
the box shrinks to fit whatever was, and the corner test passes trivially. The
fix was to difference against a known-square render instead.

### What is deliberately not here

No split-screen *mode*. Both layouts write a box into an ordinary clip and stop,
so the escape hatch is to drag the clip, resize it, or press **Full frame** —
there is no state to leave and nothing hidden. Sheet 16's drop targets and
sheet 17's stock-image API are still open.

## 15. Four bugs from one editing session

A user playing with music and text animations hit an export crash and three
things that behaved unlike an editor. All four turned out to be separate.

### The crash

```
Invalid too big or non positive size for width '3210' or height '1808'
```

`crop` is the one filter whose arguments are checked against the real stream,
and it **refuses rather than clamps**. Two things were wrong:

**The arithmetic.** Crop dimensions were rounded to the NEAREST even number, and
rounding an odd number to the nearest even one rounds it UP — so a 3209-wide
source was asked for 3210 pixels. Both numbers in the error are exactly
`even()` of an odd dimension. Swept over every realistic source size crossed
with the three aspect ratios: **7566 of 15113 pairs — half — produced a crop
reaching outside the frame.**

**The belief.** Rounding down fixes the arithmetic but not the several ways the
app's idea of a source's size can be wrong: the probe reads `width`/`height`
from ffprobe and never looks at `side_data_list`, so a phone video's rotation is
dropped; a parallax clip arrives as a plane composite that has already been
scaled; a file re-exported at a different resolution under the same path keeps
the dimensions the project recorded.

So the crop is emitted as **expressions**, evaluated against what actually
arrives:

```
crop=w='min(1080,in_w)':h='min(606,in_h)':x='max(0,min(420,in_w-out_w))':y='…'
```

Measured: asking for 3210x1808 of a 1280x720 stream yields 1280x720 instead of
killing the export, and it survives inside a `filter_complex` with filters either
side — which is where the commas in those expressions could have gone wrong and
do not.

One correction worth recording: the first version of `safeCrop` pinned the
corner and took whatever width was left, which turned a 400x400 crop at x=1800
into a **120x80 sliver** — a different shape from the one the user framed. The
size is their choice; only the position may move.

### Overlays stacked sideways

> "when i try to add two layers like text on text or try to add image in the
> timeline, its add on the side of it of the same track, but the actual layers
> work different, its on top of each other be it any N layers"

`findFreeSlot` slides a colliding clip LATER until it fits. That is right for a
cut — two clips on one track are a sequence, which is what a track is — and
wrong for anything meant to sit ON something. `stackedSlot` climbs instead: the
asked-for track, then each track above it, then a new one. **The time never
moves**, because the moment is the whole point of the gesture.

Applied to text cards, stickers, props, titles, colour cards, adjustment layers
and sounds. Not to cuts, and not to dragging an existing clip.

It also generalised for free: sounds stack the same way, which is what sheet ⑤
meant by "adding music on top of each other".

One prerequisite fell out of it — `addTrack` built ids from a bare millisecond
timestamp, fine while the only way to make a track was clicking `+ Video`, and
a collision waiting to happen now that overlays add them in a loop.

### Captions vanishing from the preview but not the file

The preview took the **topmost** layer at the playhead as the caption source;
the export built from the **bottom** video track. So putting a text card over the
picture made captions disappear on screen while they still burned into the
export — a caption missing only where you can see it. Both sides now ask one
shared `captionSourceClip`.

Known limit, unchanged: a transcript belonging to a clip on an upper track is
still never read.

### Three things called Text

> "there are 3 slots we gave in our pipeline just for the captions… two options
> one for captions and one for the text cards they both same"

Five producers, not three — text cards, captions, title templates, library fonts,
and the transcript. The confusion was earned:

- The left-panel tab labelled **Text** was the **transcript**. Renamed.
- Captions and text cards genuinely share a painter, a style library and an
  animation library — `captionSpec` returns a `TextSpec`. They *are* the same
  thing rendered; what differs is where the words come from. Both panels now say
  so in one line.
- The caption panel exposed 6 of 16 style fields and could not be moved at all,
  while a text card had 10 and dragged anywhere — which is why text cards looked
  like the better captions. Position, margin and the base colour are now
  reachable; all three were already honoured end to end and simply had no
  control.
- Two "Size" sliders: points against a 1080 reference in one panel, per cent in
  the other. Both are per cent now, through the same shared component.
- `CaptionStyle.animated` predated the animation library and nothing read it, so
  the Kinetic preset advertised per-word motion with a badge and rendered
  perfectly still.
- "None" in either picker wrote `undefined` under the override key rather than
  removing it, leaving Reset permanently lit.
- Picking a caption preset wiped the chosen style and animation; picking a text
  preset kept them. They agree now — a preset resets the typography and keeps
  the look, which is the separation the style library is built on.

## 16. The rest of the sweep

The remaining findings from the same investigation, each verified against the
code before being acted on.

### Captions were timed against a timeline that did not exist

Both caption builders walked a cursor of accumulated durations —
`timelineCursorMs += clipDurationMs` — and never read `clip.start`. Those are the
same number only while every clip is packed against its neighbour from zero.
Leave a gap, or drag one clip later, and every caption after it drifts by the
size of the gap.

A test had encoded the bug and passed: it set `start: 30`, described the setup
correctly as "lands at 1s of timeline", and then asserted the cue began at
`0:00:00.00`.

Measured after the fix, on a clip sitting at frame 60 of a 30fps timeline: the
export's first cue is `0:00:02.00` and the preview shows captions across exactly
that span. Before, the export said zero while the preview said two seconds.

### Captions ignored a transcribed clip that had moved

`captionTrack` was "the lowest visible video track", full stop. That was a safe
assumption until overlays started stacking — which is now what happens whenever
two things are added at the same moment. A clip that had been transcribed and
then moved up a track produced no captions at all.

It now prefers the lowest track that actually HAS something transcribed on it,
falling back to the lowest. Two tracks captioning at once would be two people
talking over each other, so it still picks exactly one.

### Opening a project forgot which shape it was

`aspect` is a slice of its own, initialised to 16:9, and `loadProject` never
touched it — while every reframe decision reads `ASPECTS[aspect]` rather than
`project.settings`. So a saved 9:16 project reopened into a fresh session looked
correct, and the next clip dropped onto it was cropped to a horizontal rectangle
inside a vertical frame, with nothing on screen to explain why.

`aspectOf` matches on the ratio rather than exact pixels, so a project saved at
another resolution of the same shape still opens as that shape. The table moved
to `shared/render/aspect.ts` on the way, which is where it belonged: it is a
property of the project, not of the window looking at it.

### Generated cards kept stale dimensions

`rebakeGenerated` redraws text, colour and title PNGs at the current canvas size
after an aspect change, and updated only `path`. The asset kept whatever
dimensions it was created with — so the file was 1080x1920 while the project
still believed 1920x1080, and everything that measures against an asset's size
(the crop solver, the camera move's pre-scale) worked from the wrong number for
the rest of the session.

### Props landed on top of each other

`applyPropRule` consulted nothing at all — no `findFreeSlot`, no `overlapsOn`.
Every prop went onto the single overlay track at the frame its keyword hit, so
two keywords close together put two clips in the same place and only the later
one was ever visible. They stack now, threading a working project through the
fold so each prop sees the ones already placed.

### The crop handles showed numbers the export disagreed with

`CropOverlay` clamped in floating point and rounded afterwards, so a rectangle
dragged to the very edge could round back out past it. It runs its result
through the same `safeCrop` the render plan uses, so what the overlay draws is
what gets cut.

### Still open

Three findings were left deliberately:

- **The font library is inert.** Every other asset kind spreads drag handlers
  onto its tile; the font branch returns early with none, so the specimens
  cannot be dragged or clicked.
- **Nothing converts between the transcript and a text card.** Clicking a
  transcript line only moves the playhead; the spoken words still have to be
  retyped by hand.
- **Dragging a clip over an occupied region teleports it** past the blocker
  rather than stopping against it, because `moveClip` walks `findFreeSlot` on
  every pointer move.

---

## 17. The grid split — one photograph, cut into pieces

Sheet ① of the notebook, and the one sheet I had read backwards. I had assumed
it meant several photographs laid out in a grid; it says the opposite. One
picture, diced into 2, 3, 4, 5 … N pieces, each piece arriving on its own beat
until the photograph is whole.

That is a much better effect than the one I had imagined, and a cheaper one.

### Where it lives

`shared/render/grid.ts` is the geometry and `shared/automation/grid.ts` is the
timing. Between them they produce ordinary clips — a crop, a box, sometimes a
mask — and the renderer needed nothing new at all.

### Why crops and not masks

A piece could just as easily be the whole photograph with a rectangle masked out
of it. The pieces would then register perfectly with no arithmetic: every stream
is the full canvas, so a shape at 25% across means the same thing in all twenty.

It would also be twenty full-frame `geq` passes on every frame of the render.
`geq` is a per-pixel expression evaluated once per plane; a 4×5 grid at 1080x1920
would evaluate it about forty million times a frame. Cropping first means each
piece is a twentieth of the canvas, so the twenty shapes between them cost one
canvas — and a plain square piece needs no shape at all and emits no filter.

### Cutting on every beat, which everything else avoids

`cutPlan.ts` opens by saying never to cut on every beat, and this rule ignores
it. Both are right, because they are about different things.

The rule against beat-for-beat cutting is about SHOTS. A new shot every beat at
128 BPM is 128 shots a minute; nothing is on screen long enough to be read. A
grid piece is not a shot — the frame does not change, it fills in. There is
nothing to re-read, so the pulse is felt rather than chased. Twenty pieces at
128 BPM is nine seconds of a picture arriving in time with the music.

So this rule reads the beats directly rather than going through the planner.

### A count becomes a rectangle

The sheet asks for "2, 3, 4, 5, 6 … N", so a number has to become rows and
columns. Only a factor pair will do — one picture is being divided and every
piece must be used, so 5 cannot be a 2×3 with a hole in it. Among the factor
pairs, the one whose CELLS come out squarest wins, which is why the canvas
aspect is an input: in a 9:16 frame two pieces stack, in 16:9 the same two sit
side by side. Both are drawn on the sheet and neither needed to be an option.

Primes give strips. Five horizontal bands across a tall frame is a real effect,
and a five-piece grid is not a thing.

### Waves

"Some options on Grid: square, Circle, …… if possible Waves."

Possible, and it took three goes to get right.

**It has to be displacement, not width modulation.** Widening a piece by `sin`
moves its two edges in opposite directions, so the piece next door — widening by
the same amount at the same height — either overlaps it or leaves a gap. Sliding
both edges the same way instead makes one piece's right edge and its neighbour's
left edge literally the same curve.

**Each edge needs its own amplitude.** An `abs` about the centre can only
describe two edges that move together, which is right in the middle of a grid
and wrong at its border, where the outer edge has to stay straight — a wave
there carves notches out of the frame and shows the black behind it.

**The piece has to be cropped wider than its slot.** A cell can only draw inside
its own stream, so an edge that bulges outward has nowhere to land: the picture
stops at the box and every crest is shaved flat. The stream is widened by the
wave's reach and the crop widened to match. Without this the effect half-works,
which is worse than not working — the troughs interlock and the crests gap.

**And the phase comes from the canvas, not from the row.** Dividing the cycle
count by the number of rows is correct only while every stream is the same size,
and they are not: a piece in the middle of the grid is widened on both sides
while one at the border is widened on one. Counting in rows put a slightly
different frequency on the middle row — invisible inside a piece, and a visible
jog in the seam every time it crossed a row boundary.

Measured before any of it was written: `sin` and `PI` are both available to
`geq`, and a probe at 0.4W ± a 0.1W wave of two cycles put its edges at 40/360,
80/400 and 0/320 on the rows where the sine reads 0, +1 and −1. Predicted to the
pixel.

### Two bugs found on the way

**A turned clip was losing its corners.** `rotate` keeps the input's dimensions
unless told otherwise, and the diagonal of a rectangle is longer than its side —
so a square turned by any angle at all lost four triangles, 29% of its area at
45°. The preview never had this problem, because a canvas rotation carries the
whole rectangle with it, so the two had always disagreed about what a turned
clip looks like. `rotate` now grows its output to `rotw`/`roth` and the overlay
starts half the growth earlier to leave the picture where it was. This is not a
grid fix — every rotated prop and sticker in the app was being clipped.

Keyframed rotation has to be sized for its widest angle rather than its first,
because `rotate` fixes its output size when the graph is configured and never
revisits it: an expression there is evaluated once and quietly describes the
wrong frame for the rest of the clip.

**A 1.6px black line down the middle of the frame.** `clipBox` rounds a clip's
box to an even number of pixels and its position to a whole one. Working in
exact fractions and letting it round afterwards put the box up to a pixel from
where the shape inside it had been measured — which does not matter for a
sticker and matters a great deal here, where the shape's edge IS the join. The
rounding now happens once, in the grid, and everything downstream is told about
it. Pieces grow rather than shrink where the division is not exact, so
neighbours overlap by a pixel instead of parting by one.

### A test that lied about the answer

The first "is the cut wavy?" test looked for the colour boundary in the finished
grid and reported a dead straight line. The cut was fine. A wavy piece is
cropped WIDER than its slot — that headroom is the whole point — so each piece
carries a strip of its neighbour's content under the mask, and the detector was
finding the photograph's own edge sitting exactly where the picture put it.

Rendering ONE piece against the empty canvas makes the last lit pixel in a row
unambiguously the cut. Eight integration tests now render real frames: the
quadrants land where they came from, the seam holds, twenty pieces fill the
frame, the wave interlocks and genuinely moves, circles leave the corners empty,
and a turned clip keeps its corners and stays centred.

The canvas preview was checked against the same numbers rather than by eye: its
cut comes back at 89..125px where ffmpeg's comes back at 89..127. Preview and
export agree.

---

## 18. Speed ramps are one filter, not a stack of clips

Measured before building anything, because the answer decides the design.

Every editor I know of implements a speed ramp by cutting the clip into segments
and giving each one a constant rate — five or six steps, smoothed by eye. That
would have worked here and it would have been ugly: five clips on the timeline
where the user put one, and five places for a rounding error to show.

It is not necessary. `setpts` takes an expression in `T`, and a ramp is just a
time remap: if the rate goes from `s0` to `s1` linearly over `D` seconds of
source, the output time is the integral of `1/speed`, which comes out as

    output(T) = D/(s1 - s0) · ln( speed(T) / s0 )

`log` is available to `setpts`. Probed on 2s of 30fps source ramping 1× → 0.25×:

  - **Duration:** predicted 3.697s, ffmpeg returned **3.70s**.
  - **The mapping, frame by frame.** A source whose every frame is a flat grey of
    `N*4` makes "which frame is this?" readable as a number. At output 1s, 2s
    and 3s the ramp showed luma 100, 168 and 217 — source frames 25, 42 and 54,
    against a prediction of 25, 43 and 54. A constant stretch over the same
    duration would have shown 16, 32 and 49.

So the ramp is genuinely accelerating, one filter, one pass, no extra clips.

**Built 2026-09-26** as `Clip.ramp: { from, to }` (render/speed.ts). The
filter is `setpts='(D/(to−from))*log((from+(to−from)*(T−STARTT)/D)/from)/TB',fps=30`,
with D the footage the ramp plays (`duration × rampRate`, the log-mean of the
two ends). The render check (tests/integration/ramp.int.test.ts) reproduces
these numbers from the app's own plan: a 1× → 0.25× clip of 110 frames read
source frames **25, 42 and 54** at 1, 2 and 3 s, and the preview's
`sourceFrameAt` seeks to the same three. Two things the build had to add:
every decode window is sized by `sourceFramesFor`, so the ramp is a branch
there (a ramp decoding its OUTPUT length as source runs past T = D, where the
log goes negative); and a ramped clip's own sound is left out — `atempo`
cannot follow a curve.

---

## 19. What the adversarial pass found in §17

Sixteen confirmed defects in the grid split and the rotation change, from five
reviewers and twelve verifiers, every finding reproduced against the bundled
binary before it was accepted. One was dismissed as unreachable dead code.

Most of them were mine, and three are worth writing down properly.

### The shipped default did not work at all

`Landing: Pop in` is the default, and a pop-in attaches zoom keyframes. That
fires `zoomKeyframeFilter`, which sized zoompan from the WHOLE photograph — but
it runs after the crop has already cut the stream down to one cell. zoompan is
handed a fixed output size and stretches whatever arrives to fill it, so each
piece was squashed into the file's aspect and then centre-cropped by `cover`:
about 40% of itself at nearly two and a half times the right size, on every
frame, not merely during the animation.

Every one of my integration tests built with `'cut'`, which emits no zoom at
all. The one arrival the app ships as its default was the one nothing rendered.

The fix is one variable: size it from the post-crop stream. The same hole exists
in `motionFilter`, which already had an `overrideSize` parameter for parallax
planes and now gets the crop too.

### A test that passed against the bug

Rebuilding the pop-in test was a second lesson. The first version compared a
'pop' render against a 'cut' render pixel by pixel — and passed with the bug
deliberately put back. The fixture is four flat colours, and a squashed,
centre-cropped rectangle of solid red is still solid red.

The test now uses a striped picture and counts stripe edges, where a wrong
magnification is not a matter of opinion. Reintroducing the bug gives 4 stripes
where there should be 8, which is what a regression test is for.

### Growing the rotation broke every shape in the renderer

§17's rotation fix grew the frame so a turned clip keeps its corners. Every
stencil in this renderer is sized against the clip's BOX — a mask's `geq` reads
the stream's own `W` and `H`, a luma wipe is scaled to the box, a track matte is
canvas-sized and cropped to it — and `alphamerge` refuses two streams of
different sizes. So the growth broke masks, wipes and mattes on any rotated
clip, and where it did not fail outright it drew the shape at the wrong size in
the wrong place.

Two reviewers arrived at the same one-line answer independently: rotate AFTER
the shape is applied, not before. The stream still ends up grown and still lands
in the same place; only the moment it grows changes. It also gets the picture
right — the shape now turns with the photograph, which is what the preview's
canvas rotation always did.

The same growth displaced the `zoom-in` transition, which was written in canvas
pixels. It is now written against `iw`/`ih`, which fixes a second, older bug:
a picture-in-picture zoomed on used to be blown up to full frame.

### The grid was not on the beat

`arrivalFrames` subtracted the first beat so the grid would "start at zero". The
caller then adds the music clip's position — which the analysis is already
measured from. Every piece slid earlier by however far the first downbeat sits
into the track. The spacing stayed perfect and the grid looked completely fine;
it simply landed on nothing. On a song with a 900ms intro, every piece was 27
frames early.

`planCuts` has always emitted window-absolute times. This now does too.

### The rest

- **Dragging a piece threw it past the whole grid.** `moveClip` resolves a drag
  with `findFreeSlot`, which walks forward past everything it collides with.
  Grid pieces all overlap and all end on the same frame, so one frame's nudge in
  either direction sent a piece to the end of the assembly, where it played
  alone over black. `moveClip` now asks whether a clip is already stacked where
  it sits — if it is, it is a layer, not a link in a queue, and the asked-for
  position is honoured. The filmstrip had the same hazard and gets the same fix.
- **The grid and the reel fought over one lane.** Both anchored at the music,
  both on the first unlocked video track, and the reel's `findFreeSlot` walked
  past the entire grid — displacing every shot several seconds late, off the
  music it had just been cut to. The grid takes the topmost lane now, and
  neither Build button is live while the other rule is running.
- **A project swap mid-analysis wrote orphaned clips.** Analysing goes to the
  sidecar and takes seconds; opening another project in that window left twenty
  clips stamped with an asset the new project has never heard of. Saving is
  silent when the file already has a path, and re-opening a project whose clips
  name a missing asset throws rather than offering to relink — so this was a
  quiet way to lose a file. The photograph and the lane are re-checked after the
  await.
- **"All at once" was not.** It asked for N arrivals and then collapsed them,
  which put every piece on one frame but stretched the grid's length over N
  beats of nothing happening.
- **A dark hairline along every seam.** `maskExpression` runs its softness
  INWARD from the edge it is given, so two cells meeting at a join are both
  transparent along it, and `over` of two zeros is a zero. Half a feather of
  bias is not enough either — `over` of two half-covered edges comes to three
  quarters, a grey line rather than a black one. Each cell's shape is now grown
  by a full feather with the feather fraction shrunk to match, so coverage is 1
  at the cell's own edge and falls to 0 inside the neighbour's solid area. The
  cells that do not tile — a plain square, a circle — are deliberately left
  alone.
- **Odd crops lost a pixel.** The export runs every rectangle through
  `safeCrop`, which rounds a dimension DOWN to even. An odd crop therefore lost
  a source pixel the box still expected, and `cover` amplified the difference by
  the cell's aspect — a grid of narrow strips came out as a staircase, each
  strip at a slightly different magnification. Crops are now grown outward to
  whole even rectangles, the same "grow, never shrink" rule the boxes use.

---

## 20. What the reference reel measures at

A screen recording of a CapCut template by `cpttmplate`, sent as "this is what I
was imagining". 19.76s, 1180x2556, 59.94fps, with the template's music on it.
Everything below is measured off that file rather than described.

### The track

112.3 BPM. Autocorrelating the onset envelope gives periods at 1.057s, 0.534s
and 0.267s — a bar, a beat and an eighth. A sixteenth is 134ms, which at 30fps
is exactly four frames.

### Two phases, one primitive

**0 to 7.6s — the assembly.** One photograph diced into a **4x4 grid**, pieces
arriving in scattered order until the picture is whole. This is sheet ① exactly,
and it is the thing already built.

**7.6 to 19.8s — strips.** Continuous footage with vertical strips, horizontal
bands and diagonal wedges of a BRIGHTENED treatment flashing in and out. Not
shot cuts: the underlying footage runs on, and what changes is which strips are
showing the alternate grade. Sampling that section every 133ms — one sixteenth —
shows the strips moving one notch per frame sampled.

Both phases are the same primitive with different settings: a masked cell landing
on a beat. What differs is whether the cell accumulates or is momentary, whether
it is a grid cell or a full-height strip, and whether it shows the photograph or
a treated copy of it.

### How tightly it is actually synced

56 visual changes detected in the preview area, against 55 onsets in the audio.
After removing a constant +70ms screen-recording lag:

| grid | within one video frame (33ms) | median error |
|---|---|---|
| quarter note (534ms) | 23% | 114 ms |
| eighth note (267ms) | 45% | 42 ms |
| **sixteenth note (134ms)** | **73%** | **20 ms** |

20ms is one frame at 60fps. The remaining 27% are mostly camera movement inside
a shot rather than a change, plus a stretch where the recording caught an
Instagram advert scrolling past.

Brightness flashes were measured separately: 10 of them, **9 on the sixteenth
grid**, and they arrive in bursts — three on consecutive sixteenths, then a gap.
A triple-flash stutter, not an even pulse.

### Cut density

| | changes | rate |
|---|---|---|
| assembly, 0-7.6s | 14 | 1.8/s |
| strips, 7.6-19.8s | 42 | 3.5/s |

Gaps between changes, in sixteenths: during the assembly mostly **2** (an eighth)
with some 3s and 4s; during the strips mostly **1** (a sixteenth) then 2.

So it roughly doubles in rate once the picture is whole, and it never holds
still for longer than half a bar.

### What this proved wrong

**The cadence control could not express it.** `beatsPerCell` ran from 1 to 8
BEATS. The reference lands pieces on EIGHTHS, so the fastest setting the app had
was half the speed of the thing it was modelled on. Beats are now subdivided as
well as skipped — 0.25, 0.5, 1, 2 and 4 beats — and the default is twice a beat.

Subdivisions are interpolated between the detected beats rather than derived
from the tempo, so they follow the performance: a bar that drags takes its
eighths with it, where a rigid tempo grid would come loose exactly where the
music is most expressive.

**"Never cut on every beat" needed splitting in two.** The finding in
`cutPlan.ts` is about SHOTS and it stands — a new shot every beat is frantic.
But this template changes something four times a beat and does not read as
frantic at all, because what changes is a treatment over continuous footage, not
the shot. Those are different rules and the codebase was applying one of them to
both.

### Still not built

The strips phase. Momentary cells rather than accumulating ones, full-height
strips and diagonal wedges as cell shapes, a brightened duplicate as the cell's
content, and flash bursts on consecutive sixteenths. All of it sits on the grid
machinery that exists; none of it is reachable from the panel today.

---

## 21. Strips — the reference's second half

Built from the measurements in §20 rather than from an impression of them.

`shared/render/strips.ts` is the geometry and `shared/automation/strips.ts` is
the timing, and the first is deliberately thin: a strip IS a grid cell —
`gridCells` with one row, or one column — so columns and bands cost nothing new.
Everything that makes the two effects look different is a setting.

| | the grid | the strips |
|---|---|---|
| lifetime | accumulates | one subdivision, then gone |
| content | the photograph | a brightened copy of the shot |
| cadence | eighths | sixteenths |
| lands on | its own layer, alone | a layer above footage that keeps running |

### Why this may fire four times a beat

`cutPlan.ts` spends its whole preamble arguing against cutting even once a beat,
and this rule ignores that four times over. They do not conflict. The finding
there is about SHOTS — a new shot every beat is frantic because nothing is on
screen long enough to read. Nothing here changes the shot. The footage runs on
underneath and what changes is which slices of it are wearing a different grade,
so there is nothing to re-read and the rate is felt as rhythm.

Two different rules; the codebase had been applying one of them to both.

### The diagonal

Columns and bands are crops and boxes. A band at an angle is not a rectangle of
the source, so it is the whole frame with a turned rectangle masked out of it —
a per-pixel expression, affordable only because a flash is four frames long.

The part worth writing down is how a band moves sideways. `maskExpression`
rotates about the shape's centre, so sliding a band across the frame means
moving that centre along the band's own PERPENDICULAR: for a band at angle t, an
offset of p pixels is `(-p·sin t, p·cos t)`. Offsetting x alone slides the band
along its own length, which looks like nothing happening at all.

The rectangle is also made far longer than the frame, so its ends are never in
shot at any angle — a band whose end wanders into view reads as a floating box
rather than a sweep.

Four rendered tests cover it: the band comes back at the angle it was asked for
(checked at 30° and 62°, so the measurement tracks the parameter rather than
agreeing with one number), one of five bands covers between a tenth and a third
of the frame, five together leave less than 2.5% of it dark, and two
neighbouring bands overlap on under 8% of what they cover.

### What it does not do

The flashes take the shot's own asset, so what lights up is a treated copy of
the same picture — the effect depends on the viewer recognising it. They are
silent, they sit on the track above, and deleting every one of them leaves the
shot exactly as it was.

---

## 22. Cutting to the lyric

Beats are the metre. They are not where the expression is. A singer pushes
ahead of the beat or lays back behind it, and that displacement IS the
performance — so an edit placed on the beat during a vocal line reads as
mechanical, and the same edit placed on the sung syllable reads as though
someone was listening. This is the second source.

### Pulling the song apart, with the ffmpeg we already ship

`src/main/stems.ts`. Mid/side, and the two halves are not equally good, which
is worth saying rather than calling both of them "separation":

| | what it is | measured |
|---|---|---|
| **instrumental** | the side signal, L−R | centred tone **−29 dB**, panned tones untouched |
| **voice** | mid, high-passed at 200, low-passed at 8k, levelled | voice kept at full level, bass **−13 dB**, hard-panned content only **−3 dB** |

So the instrumental is a real cancellation — that is sheet ⑥'s "instrumental
only", done, with no new dependency. The voice is an EMPHASIS and the result
says so in a `quality` field, because speech recognition needs the words
legible rather than the stem pristine, and calling it "the vocals" would be a
lie the rest of the code would then believe.

Both halves come out of ONE ffmpeg invocation. Decoding a five-minute song twice
to write two files from the same input is the kind of waste that only shows up
later as "why is this slow".

A mono source has no side signal at all, so the chain forces stereo first —
otherwise a mono song comes back with a silent "instrumental" and no error. That
case has its own test.

**Demucs** is the real separation and lives in the sidecar as
`capabilities/stems.py`, optional because it brings torch — several hundred
megabytes for one feature. It is not in `requirements.txt`; there is a
`requirements-stems.txt` for people who want it. Absent, the sidecar reports the
capability degraded and the app falls back without being asked.

### Where the punch is

`shared/automation/lyrics.ts`. The granularity ladder, and where it stops:

| level | source | status |
|---|---|---|
| beat, bar, drop | librosa | built |
| **word** | Whisper word timestamps, on the voice track | built |
| **syllable** | the word's own spelling and span | built |
| phoneme | a forced aligner | **deliberately not** |

Phonemes are left out on the numbers rather than on effort. At 30fps one frame
is 33ms and phonemes sit 50–80ms apart, so the entire range of the thing is one
or two frames. It earns its keep for lip-sync. It does not pay for itself in a
music edit, where syllables are already finer than the eye resolves.

What DOES pay is which sound a word opens on. A plosive — p, b, t, d, k, g —
begins with the vocal tract sealed and then releases it, so it has a genuine
transient in it, the same shape as a drum hit. A word opening on a vowel has no
edge to cut on at all. That difference is worth more than any amount of extra
timing precision and it costs a lookup table, read off the spelling — which
sounds like a compromise and mostly is not, since the first sound of the written
word and of the sung one are the same sound.

### The hybrid, which is the whole point

Not a choice between beats and lyrics. `planCuts` now takes a third source:

- **structural moments first** — a drop is a bigger event than a word.
- **then lyrics**, at their own times.
- **then the grid** fills what is left.

Order is the entire mechanism. `push` refuses anything within 120ms of a cut
already placed, so whichever source goes first owns the moment. A lyric inserted
after the grid would lose to a grid cut two frames away and be silently replaced
by the mechanical version of itself — which is precisely the thing cutting to
the lyric exists to avoid.

The snap window is **16ms**, half a frame, and deliberately tiny. A vocal 30ms
off the beat is a performance and is left alone; one 8ms off is the same moment
and may as well be tidied. `offGridShare` reports how much of the vocal survived
un-quantised — if it comes back near zero the window is too wide and the edit has
been quantised into the thing it was supposed to be an alternative to.

**A lyric cut never gets a transition**, even when the caller asks for
transitions on everything. The reason to put an edit on a plosive is the
hardness of it; dissolving through that moment spends it.

---

## 23. The chain, end to end — and two bugs it exposed

"Cut to the words" in the reel panel. One toggle, four steps:

    split the song   ->  voice + instrumental (mid/side, §22)
    read the vocal   ->  words with their own timings
    weigh the words  ->  a plosive is an attack, a vowel is not
    plan             ->  a third source beside the grid and the structure

Nothing about it is required. A track with no words, a model that is not
installed, a transcription that comes back empty — each of those means the reel
is built on beats alone, which is what it did before any of this existed. The
toast says so and the build carries on.

Every shot is labelled with what it landed on, so the timeline reads back
against the song:

    section change
    on "Break"
    on "tonight"
    on "dance"
    on the drop
    on "gone"
    on the beat
    on the beat

"away", "and" and "over" are missing from that list, and should be: all three
open on a vowel and have no edge to cut on.

### The reel had been drifting off the beat all along

Driving the chain in the harness showed the lyric cuts landing near the words
rather than on them — and then showed something worse. The planner was exact;
the timeline was not:

| planned frame | 0 | 61 | 121 | 180 | 240 | 301 | 360 | 420 |
|---|---|---|---|---|---|---|---|---|
| **landed on** | 0 | 61 | 121 | 181 | 234 | 295 | 347 | 400 |

Cumulative, and worse the further in it went. `addTransition` closes the
timeline up around the overlap — the incoming clip slides back to meet the
outgoing one and **everything after it follows**. That is correct for a
hand-cut edit, where a transition consumes time and the rest closes up behind
it. For anything cut to music it is silently destructive: every start was
computed against a beat, and each transition drags all the later ones off it.

Note the two clips at 295 and 400 that have no transition of their own. They
were displaced by somebody else's.

At the default rate — a majority of cuts carrying a treatment, seven frames each
— a thirty-shot reel finishes close to **four seconds adrift** of the track it
was cut to. Nothing reported it, because every individual transition was doing
exactly what it said.

`anchorTransition` takes the overlap out of the OUTGOING clip's tail instead:
the previous clip plays a few frames longer and the incoming one stays where the
music put it. The renderer sees no difference — the incoming clip's first N
frames overlap the outgoing one either way — so the transition simply begins on
the beat rather than finishing near it. `addTransition` keeps its rippling for
the timeline UI, where it belongs.

### And a frame of slop underneath that

With the ripple gone, one frame of drift remained from the fourth shot on.
Shot lengths were measured from the millisecond gap between cuts while their
positions came from frames, and the two round independently — so a shot could
come out a frame too long, overlap the next, and send `findFreeSlot` off to
nudge that one a frame later. Measuring between the cuts' own FRAMES makes the
shots tile exactly, with nothing to resolve.

Both rules had it. Both are fixed, and the reel tiles exactly at 117 BPM, which
is a tempo whose beat divides into nothing.

### Where it lands now

| shot | error |
|---|---|
| on "Break" | −7 ms |
| on "tonight" | +3 ms |
| on "dance" | −15 ms |
| on "gone" | +8 ms |

Every one inside half a frame, which at 30fps is the floor. There is nothing
left to take out.

---

## 24. Speech, as a provider rather than an engine

Sheet ⑦ wants a narration video, and the voice is the part of it with a real
choice behind it: a model on this machine, or somebody's API. That choice is not
ours to make — a photographer on a plane wants the local one, someone who wants
a particular hosted voice wants theirs, and either should be able to change
their mind without the rest of the app noticing.

So speech is a PROVIDER. `shared/voice/provider.ts` is the contract and all the
decisions; it has no network, no filesystem and no ONNX in it, so what happens
is testable without any of them installed.

### Two behind one door

| | where | cost | key |
|---|---|---|---|
| **kokoro** | sidecar, ONNX Runtime | none per use | none |
| **hosted** | any OpenAI-shaped `/v1/audio/speech` | theirs | theirs |

Kokoro-82M was picked for the local slot on two grounds: it synthesises faster
than real time on a laptop CPU, and it has an ONNX build — so it runs on the
runtime the depth model already brought. Every other TTS worth using wants
torch. This costs a model file rather than a stack.

The hosted shape is worth singling out because **it is not only OpenAI's**.
Kokoro-FastAPI serves the same model over the same endpoint, so "ours or theirs"
is not even a fork in the road: the same voice can arrive either way and the
setting is really about where the compute happens. Point `baseUrl` at
`http://localhost:8880/v1` and the hosted provider is a local one.

Both return a wav on disk, so everything upstream imports an ordinary asset and
never learns which answered.

### The rules that matter

**`auto` prefers local.** Not because it is better — it is a small model and a
hosted voice may well beat it — but because a default that quietly starts
spending someone's credits is a bad default however good it sounds.

**An explicit choice is never substituted.** Someone who picked a specific
hosted voice and silently got the local model has been handed a different
performance without being told, which is worse than an error because it renders.
`auto` is the only setting allowed to fall back.

**When neither works, both reasons are reported.** "Kokoro is not installed" on
its own sends someone off to install a model when they had meant to use their
own API and simply had not pasted the key in yet.

**The key never leaves the main process, and never reaches a message.** A 4xx
body is worth showing — it is where "that model does not exist" and "you are out
of quota" live — so the body is shown with the key taken out of it, rather than
swallowed whole to be safe. `redactKey` is pure and tested for it.

**Speech is cached on what changes the audio**, which includes the provider that
actually ran but not the provider that was *chosen* — so switching from `auto`
to `kokoro` does not invalidate a cache that was already Kokoro's.

**Long text is split on sentences.** Every engine degrades on long input, and
hosted ones tend to return an error rather than a shorter take. Sentence
boundaries are where a voice would draw breath anyway, so the joins land where
the ear expects a pause.

### A note on what nearly shipped

Two source files ended up with a literal NUL byte in them — the separator
`speechKey` joins on, written by a script as a raw byte rather than an escape.
It compiled, it passed, and it was invisible in review. Both are escapes now,
and a sweep confirms nothing else in `src/` or `tests/` carries one.

---

## 25. The two ffmpegs

The first CI run on Windows found three problems in a row, and only the third
was interesting. The first two were packaging: a stray file named
`sidecar/:memory:.ses`, whose colon is illegal on Windows and made `git
checkout` fail outright with exit 128 — the code never ran at all — and a bare
`assets` line in `.gitignore`, which matches at every level and had silently
swallowed three real source files.

The third is a standing constraint and belongs here.

### `@ffmpeg-installer` ships a different ffmpeg per platform

| platform | package | `ffmpeg` field | what it actually is |
|---|---|---|---|
| macOS arm64 | 4.1.5 | `92718-g092cb17983` | reports itself as **4.4** |
| win32-x64 | 4.1.0 | `20181217-f22fcd4` | **master, 17 Dec 2018** |

That is not a guess about Windows: every render there died with

    [Parsed_anullsrc] Option 'd' not found

and `anullsrc` gained its duration option in ffmpeg **4.2**. So the floor is
below that.

**But "4.1" is the wrong way to think about it, and thinking that way costs
time.** The Windows binary is not the 4.1 *release* — the package's own `ffmpeg`
field says `20181217-f22fcd4`, a static nightly of ffmpeg **master** taken a
week after the 4.1 branch point. So the floor is a DATE: whatever had been
merged to master by **2018-12-17**.

`tpad` is the proof that the distinction matters. It first appears in the 4.2
release, so "added in 4.2" says it cannot be used here — and `holdFilter` has
emitted it since the beginning. It was merged on **30 October 2018**, before the
snapshot, so it is in the Windows build, and Windows CI renders with it happily.
An audit that judged by release number alone would have sent us rewriting code
that works.

The three that genuinely bite all landed in master *after* that December date,
which is why they are absent even though they are "only" 4.2 features. The rule
to apply: **an option is safe if it was MERGED before 2018-12-17**, whatever
release first carried it — and the release number is only a first approximation
of that.

The immediate fix was small — the option was never needed, because the output
already carries `-t`, which is what actually bounds the stream. Measured both
ways on the same graph: 4.00s with it and 4.00s without.

`adelay`'s `all` option went the same way, and that one had a trap in it.
Dropping `all=1` and leaving `adelay=500` would have been *worse than the error
it replaced*: a bare delay applies to the FIRST CHANNEL ONLY, so every clip with
a timeline offset would have played its left channel late and its right on time
— a desync that renders happily and sounds wrong. Measured on a stereo tone:

| form | left | right |
|---|---|---|
| `adelay=500:all=1` | delayed | delayed |
| `adelay=500\|500` | delayed | delayed |
| `adelay=500` | delayed | **still playing at −24dB** |

So the delay is repeated once per channel, eight times — enough for 5.1, and
harmless on stereo where the extras are ignored.

**The standing rule it leaves behind: anything reached for in a filter graph has
to exist in the OLDEST bundled build, not the newest.** Developing on 4.4 and
shipping 4.1 means a filter added in between works perfectly for months and then
fails for every Windows user, with an error nobody on the team can reproduce.

### Two escaping bugs that could only happen there

A path inside a filtergraph crosses TWO parsers, and they want different amounts
of escaping. Measured by creating a real file at a path containing each
character and seeing which form actually opened it:

| character | backslashes |
|---|---|
| `,` `[` `]` `;` | 1 — graph-level separators |
| `:` `=` | 2 — the graph parser eats one on the way past |
| `'` | 3 — a quote at both levels |
| space | 0 |

One backslash on a colon — the form every example shows, and the form this
codebase used — silently drops everything before it. On macOS nothing precedes
the first colon. On Windows it is the drive letter, so `C:/Users/…/captions.ass`
reached ffmpeg as `/Users/…/captions.ass` and every export touching a subtitle
file, a LUT or a look failed.

The concat demuxer has its own, different rule: backslash is an escape character
there, inside quotes as much as out, so `file 'C:\Users\…'` names a file with a
tab in it. Forward slashes throughout, and `'\''` for a literal quote.

An existing test asserted the broken escaping and had passed for months. That is
the third test in this project found encoding the bug it was meant to guard.

### `amix`'s `normalize`, and why the standard workaround is wrong

The third one, and the first that could not be fixed by deleting the option.

`amix` divides by its input count unless told otherwise: two clips and each is
halved, three and each is a third. `normalize=0` switches that off, and arrived
in **4.2**. It only appeared once a project had two audio streams, which is why
one test failed — *concatenates two trimmed clips* — while every single-clip
render passed.

Every forum gives the same pre-4.2 workaround: `dropout_transition=0` plus a
compensating `volume`. **It is wrong.** Measured, mixing a 3s tone with a 1s one
and reading the mean level in each second:

| form | 0–1s | 1–2s | 2–3s |
|---|---|---|---|
| `normalize=0` | −21.1 | −24.1 | −24.1 dB |
| `dropout_transition=0`, `volume=2` | −21.1 | **−18.1** | **−18.1** dB |
| neither | −27.1 | −28.8 | −25.8 dB |

The long tone alone measures −24.1 dB, so the middle row is **6 dB hotter than
its own source**. The moment the short input ends, amix renormalises to one
active stream — and the compensating `volume` then doubles something already
correct. The bottom row is worse still, and *ramps*, because the 2s dropout
transition is audible as a swell.

The fix is to remove the premise: pad every input to the full timeline first, so
nothing ever drops out, the divisor stays at N for the whole render, and
multiplying by N undoes it exactly.

    [dia]apad,atrim=end=3.000000[aoutp0];
    [oth]apad,atrim=end=3.000000[aoutp1];
    [aoutp0][aoutp1]amix=inputs=2:duration=longest:dropout_transition=0,volume=2[aout]

Summed against the `normalize=0` output with one inverted, the residual is
**−91.0 dB** — the 16-bit quantisation floor. The same samples. `apad`, `atrim`
and `volume` all predate 4.0 by years, so there is no version branch to keep in
step.

And, for the fourth time in this project, an existing test asserted the broken
form — `toContain('amix=inputs=2:duration=longest:normalize=0[aout]')`. It did
not merely miss the bug; it required it. It now asserts that both streams reach
the output and neither is halved, which is the behaviour, not the spelling.

### What makes this class catchable now

macOS allows a colon in a filename. So
`tests/integration/filterPath.int.test.ts` reproduces the drive-letter case
locally: it writes a real LUT at a path containing each awkward character and
checks ffmpeg opens it. Reverting the fix fails 5 of its 7 cases on a Mac.

Windows does *not* allow a colon, which is the joke at the centre of that file:
the two cases that build a directory named `x:y` cannot run on the one platform
that cannot avoid colons. They are skipped there and lose nothing, because every
path on a Windows runner is already `C:\…`. A `runIf` test asserts that drive
letter is present rather than assuming it.

The version floor used to have no local check — there is only one ffmpeg on this
machine. `tests/oldestFfmpeg.test.ts` is the substitute: it builds the graphs for
four project shapes and fails if any of them contains an option newer than 4.1,
naming the version and the pre-4.2 alternative. It is a blocklist, so it cannot
catch something nobody has thought of, but all three bugs above are in it and it
runs in 200ms on a Mac rather than four minutes on a Windows runner. It is
verified by mutation: putting `normalize=0` back fails three of its cases.

If ffmpeg is ever unified across platforms, delete that file rather than
maintaining it — the whole class goes with it.

### The same filter, a different answer: `chromakey`

The blocklist catches a filter or option that is MISSING on the old build. It
cannot catch one that is present on both and computes something different —
and `chromakey` does. The 2018 snapshot measures a key's distance as
`sqrt(du² + dv²) / 255`; the newer build divides by a further √2. At the same
Similarity the Windows export kept pixels the Mac export keyed out. Nothing
failed to run; five of CI's render checks failed on the numbers, and the √2
predicts every one of them exactly (#00b140 over pure green: the newer
formula 53, √2 gives 234, Windows gave 234).

A version check would have to know when the formula changed; a measurement
does not. The app keys one patch on the binary it has and reads the alpha
back (`keyScaleFromProbe`, `main/render/keyScale.ts`), then scales Similarity
and Soften — both distances — so either build keys what the model, and the
preview's shader, say. The render tests take the same probe
(`integration/output.ts keyScale()`).

The lesson is the one CI keeps teaching: a filter that EXISTS on both builds
has not been shown to AGREE on both. Anything the preview has to match
(`chromakey`, `eq`, `colorchannelmixer`, `despill`) needs its render check to
run on the Windows runner, not only on this Mac — and the runner's results
need reading. These went red for a day before anyone looked.

### 26. What a full platform audit found afterwards

Five independent lenses over the codebase, each finding adversarially refuted by
a second reader. **Four of eight claims survived.** The four that died are worth
as much as the four that lived, because each was plausible:

- **`tpad` is 4.2, so it breaks Windows** — refuted by the build-date fact
  above. The most expensive wrong answer available.
- **`minterpolate`'s `scd_threshold` defaults to 5.0 on the Windows build and
  10.0 on 4.4, so slow motion judders there** — the version facts were correct
  and the failure still did not reproduce. Rendering the real chain at both
  thresholds gave *byte-identical* output for a whip pan, mandelbrot pans at
  three speeds, testsrc2, per-frame noise, and a static-then-whip-pan at seven
  speeds. The 5–10 band means an average luma change of 13–26 levels, which
  ordinary motion never reaches.
- **The sidecar's `python3` fallback breaks on Windows** — `service.ts` already
  branches on win32, and nothing shipping reaches the fallback.
- **The `.venv/bin/python` test gate skips the sidecar suites on Windows** —
  true, but nothing creates that venv on *any* platform, so both runners skip
  identically.

What survived was smaller and duller than any of them, which is usually how it
goes:

| where | what |
|---|---|
| `maskTags.ts`, `stems.ts` | missing `windowsHide` — every other spawn in `src/main` has it. 412 console windows on a cold transition library |
| `maskTags.ts` | seven `.svg` masks have no decoder; the failure was never cached, so they re-spawned ffmpeg **every launch, on both platforms** |
| `Library.tsx`, `media.ts` | the renderer has no `node:path` and joined with a literal `/`, so a renderer-built path never string-equalled a `path.join` one on Windows and the audition dedup silently did nothing |

The last one is the interesting shape: both spellings *open the same file*, so
nothing broke — only the comparisons between them. `src/shared/assetPath.ts` now
does that join, and its test asserts agreement with `path.win32.join` rather
than asserting a literal, so the two sides of the IPC cannot drift apart.

One lens — every regex that parses ffmpeg's stderr, where CRLF was the obvious
suspect — read 46 files and found **nothing**. Worth recording, so nobody pays
for that search twice.

---

## 26. Audio fades — `afade`, and which curve is old enough

Fades were the last obvious hole in the audio path: no `afade` anywhere, and
the only way to soften an entry was to place four points on the drawn volume
envelope by hand.

**`afade` itself is not the risk.** The filter is from 2013, comfortably older
than the 2018-12-17 Windows snapshot (§25), and `t` / `st` / `d` are all
original options. What needed checking was the **curve**.

`-h filter=afade` lists nineteen of them in one flat list, and nothing about
`losi` announces that it is years newer than `tri`. But the list is an
**append-only enum**, so the index is the age ordering:

```
nofade -1   tri 0   qsin 1   esin 2   hsin 3   log 4   ipar 5   qua 6
cub 7   squ 8   cbr 9   par 10   exp 11   iqsin 12   ihsin 13
dese 14   desi 15   losi 16   sinc 17   isinc 18
```

`tri` and `qsin` are 0 and 1 — the filter's first commit. Everything with a
high index is a later addition, and the four at the top of the list
(`losi`, `nofade`, `sinc`, `isinc`) are now in `tests/oldestFfmpeg.test.ts`'s
blocklist. That is an argument from the binary's own output rather than from a
release note, which is the distinction §25 was written about.

**Which curve, measured.** A 4s 440Hz tone faded out over its last two
seconds, sampled in quarter-second windows against a flat control at −21.1 dB:

| curve | 10% in | 50% in | 85% in |
|---|---|---|---|
| `tri` | −1.9 dB | −7.8 dB | −17.6 dB |
| `qsin` | −0.4 dB | −4.6 dB | −13.7 dB |

Linear amplitude drops away early and then crawls, which is why a `tri`
fade-out on music sounds like someone pulling the plug halfway through. `qsin`
holds the level and then goes. It is the default here.

The full `qsin` fade-out shape, on a 6s tone fading over its last two, is
worth having written down so nobody has to re-measure to pick a test
threshold:

```
control −21.1   4.5s −22.5   5.0s −25.7   5.4s −30.2   5.7s −38.5   5.85s −44.5
```

**Where it goes in the chain, and why that is the whole correctness.**

```
aformat → aresample → atempo → volume → afade → adelay
```

*After* `volume` so a fade **multiplies** whatever the envelope drew rather
than replacing it — they are separate controls and both apply, as in any DAW.
*Before* `adelay` because `afade` is handed an absolute time, and until the
delay runs the clip's stream still begins at zero however far along the
timeline the clip sits. A fade written after the delay would need every time
offset by the clip's position, and getting that wrong pushes a fade-out's
start past the end of the stream, where **it silently does nothing**. That is
the same units trap the volume envelope hit, from the same cause.

**`afade=t=out` is told where the fade BEGINS**, not where it ends. A two
second fade on a six second clip is `st=4:d=2`. The mirror-image bug renders a
clip already silent for its last four seconds, which reads as the fade length
being ignored rather than as an off-by-a-start-time.

**Overlapping fades are made to meet, not rejected.** Trim a clip down under
fades that were already set and the two walk through each other; `afade=out`
would then start before `afade=in` finished and the clip would go quiet in the
middle and stay there. `clipFades` reduces both in proportion until they sum
to the clip exactly.

Six mutations checked, including both halves of the chain order. The
integration test measures decibels out of a rendered file rather than
asserting the filter string — §1 is the reason — and it runs on Windows CI,
which is what finally settles `qsin` on the 2018 build.

---

## 27. Crossfades — overlap IS the crossfade, and `acrossfade` is not needed

Two findings, and the second one deleted most of the work the first implied.

**Overlapping clips were 3 dB hot.** `anchorTransition` genuinely overlaps its
two clips — that overlap *is* the video dissolve — so for the length of every
dissolve both soundtracks played at once, at full. Rendered through the real
plan with 440Hz against 1170Hz and measured inside one file:

```
before overlap  -24.1     in overlap  -21.1     after  -24.1      jump +3.0 dB
```

Exactly what two uncorrelated signals summing gives, because that is what it
was. Nothing wrote a fade because nothing knew to.

*(The −24.1 against a raw file's −21.1 is not a second bug. It is the mono →
stereo upmix in `aformat=channel_layouts=stereo`, which is power-preserving
and therefore −3 dB per channel. The `mixFilters` pad-and-scale formula was
checked in isolation and is unity: A alone, A mixed with silence, and
`normalize=0` all measure −21.1.)*

**`acrossfade` is unnecessary.** An equal-power crossfade is just an overlap
with `afade=out` on one side and `afade=in` on the other — and `qsin` against
`qsin` sums flat. Measured over a two-second overlap:

| | 2.0s | 4.2s | 5.0s | 5.8s | 7.0s |
|---|---|---|---|---|---|
| source, no fade | −21.1 | −21.1 | −21.1 | −21.1 | — |
| overlap + `qsin`/`qsin` | −21.1 | −21.1 | −21.1 | −21.1 | −21.1 |
| **`acrossfade=c1=qsin:c2=qsin`** | −21.1 | −21.1 | −21.1 | −21.1 | −21.1 |
| overlap + `tri`/`tri` | −21.1 | −22.7 | **−23.9** | −21.5 | −21.1 |

The overlap-plus-fades row and ffmpeg's own `acrossfade` row are the same
numbers. So `acrossfade` buys nothing — and it would cost a great deal: it is
a **two-input filter that consumes both streams and emits one**, which would
force the audio graph from "delay each clip and mix them all" into "build a
concatenation chain per track". Every clip in this project is an independent
padded input into one `amix` (§25), and that structure is load-bearing for the
2018 Windows build.

The `tri` row is why the curve matters here rather than being taste: a linear
crossfade has a **2.8 dB hole** in the middle of every join.

**So the rule is: overlap on a track means crossfade**, derived at render in
`fadesWithNeighbours` rather than stored. It is true of every overlap however
it arose — a dropped transition, the crossfade action, a reel the automation
built — without any of them having to remember. An explicit fade always wins,
tested with `fadeIn: 0` specifically, since "no fade here despite the overlap"
is a real answer and the falsy one.

Neighbours are read **per track**. Two tracks overlapping is the whole point
of having two; treating that as an edit point would duck the music every time
a sound effect landed on it.

---

## 28. Loudness — `loudnorm`, and the two things it does behind your back

Without normalisation, how loud an export comes out is whatever the source
happened to be. Every platform measures the same way now — integrated LUFS,
ITU BS.1770 — so the fix is to hit a number instead of eyeballing a meter.

`loudnorm` merged in **3.1 (June 2016)**, comfortably inside the 2018-12-17
floor (§25). It is on the Windows build and the integration test runs there.

**Single pass is enough here.** Measured on this build, three sources spanning
twenty-six decibels, normalised in one pass and re-measured:

| source | before | after |
|---|---|---|
| quiet sine | −41.75 LUFS | **−14.04** |
| loud sine | −15.75 LUFS | **−14.04** |
| pink noise | −20.72 LUFS | **−14.01** |

Within 0.04 LU of target. The two-pass form — measure, then apply one static
gain with `linear=true` — is more transparent on dynamic material, but it
needs an analysis run over the whole timeline before the render can start, and
0.04 LU is far inside both what anyone can hear and what the platforms
re-normalise away. Two-pass is the refinement to reach for if drawn-envelope
material ever sounds squashed, not before.

Pink noise also came back at a true peak of **exactly −1.00 dBFS**, the `TP`
target, so the ceiling is honoured rather than approximated.

### The two traps

**It emits 192 kHz.** Every time, whatever went in. Nothing about the sound
reveals it — the file is simply four times the samples, disagreeing with
`settings.sampleRate` everywhere else in the app that reads it, and four times
the work for the AAC encoder. The rate has to be pinned back explicitly.

**A bare `aresample` after it fails.** Not a warning — the render dies:

```
[Parsed_aresample_1] Cannot select channel layout for the link between
                     filters Parsed_aresample_1 and format_out_0_0
Error reinitializing filters!
```

Nothing downstream can work out what came out of `loudnorm`, so the layout has
to be stated in the same breath. The fix is one filter:

```
loudnorm=I=-14:TP=-1:LRA=11,
aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo
```

*(A related failure cost ten minutes and is worth recording so nobody repeats
it: `loudnorm` on a MONO input, with or without a resample, fails with
"Failed to inject frame into filter network: Invalid argument". It looked at
first like short clips failing — a 0.8s file died — but a 0.8s STEREO file is
fine and an 8s mono one is not. Length was never the variable. Every clip is
forced to stereo before the mix here, so it cannot arise in this graph, and
the explicit `channel_layouts=stereo` makes sure of it.)*

### Where it goes, and where it must not

Last, on the finished mix. Normalising a clip before the music joins it would
target a number that stops being true the moment anything else is added.

**Never on the silence branch.** A project with no audio takes the `anullsrc`
path, and `loudnorm` measures silence at **−inf LUFS** — asking it for a
finite target is a request to amplify nothing by an unbounded amount.

### On by default, for new projects only

`DEFAULT_SETTINGS` carries −14 and a missing `loudness` means off. That
asymmetry is deliberate: two exports landing at different levels is the thing
being fixed, so the default has to be on — but switching it on for a project
someone has already finished would change how it sounds with nothing on screen
to say why.

The change broke six existing tests in `render.test.ts`, all of which assert
the MIXER's output label. They now build their fixture with normalisation off,
because each is about whether two streams reach the mixer or a muted clip is
dropped before it — not about what is appended afterwards.

## 29. The export's shape — codecs, bitrates, and a stretch nobody saw

B2 (docs/FIX.md). Everything here was measured on the bundled macOS binary;
the Windows one cannot be measured from a Mac, so the app probes itself there.

### Listed is not working

`h264_videotoolbox` is in `ffmpeg -encoders` on the bundled macOS build and
then fails to open a compression session (`-12908`), even with `-allow_sw 1` —
at least inside the development sandbox, which may be the cause and may not.
So nothing is offered on the strength of the list: `main/render/encoders.ts`
encodes ten real frames with each listed candidate, using `encoderArgs` itself
— the arguments the export will run — and offers only what succeeded. Cached
for the process.

`libx264`, `libx265` and `prores_ks` all encode with the arguments in
`render/encode.ts`, bitrate mode included. ProRes lands as `apch`
`yuv422p10le` in QuickTime. The container is named with `-f`, never left to the
extension: an MP4 cannot hold ProRes, and a name typed as `.mp4` before
switching codec must not be what decides.

### AAC at 320k writes less than at 256k

ffmpeg's native AAC encoder, on stereo white noise (the hardest thing to
compress, so a target is actually spent):

| asked | written |
|---|---|
| 192k | 195 kb/s |
| 256k | 260 kb/s |
| 320k | **248 kb/s** |

Pink noise at 320k: 244. So 320 is not offered — a setting labelled higher that
comes out lower is worse than no setting — and a stored 320 maps to 256
(`audioKbpsFor`). A sine at any setting writes ~74 kb/s, which is why a pure
tone cannot test this.

### A bitrate test needs a picture that costs something

A clean `testsrc2` at 320×240 needs about 0.6 Mbps even at CRF 14, so a 2 Mbps
cap never binds and a "bitrate is respected" test passes for the wrong reason.
Moving noise at 720p (`testsrc2` + `noise=alls=40:allf=t`) spends whatever it
is given.

### The camera move stretched tall photos

`kenBurnsFilter` runs its move at a working size capped for speed — and the cap
was `min(2560, w)` × `min(1440, h)`, each side on its own. That assumes a
landscape picture. A 3024×4032 phone photo in a 1080×1920 reel wants a working
height of ~1738 (canvas fit × zoom headroom); the height was cut to 1440 and the
width was not, so the photo went into `zoompan` at 1304×1440 — 0.906 instead of
0.75, **21 % too wide** — and came out stretched. Every Ken Burns on a tall
photo in a vertical reel, which is the wedding reel. The preview never went
through this path, so it looked right on screen.

Measured with a white square on black (`integration/motionAspect.int.test.ts`):
20.6 % out of square at 9:16, 137 % at 4K, and the landscape control fine. The
cap was never what bounded the cost anyway — `factor` already limits the working
picture to the canvas plus the headroom the deepest zoom needs — so it is gone,
and one factor scales both sides.

### White balance is `colorchannelmixer`, and it keeps alpha

B3. `colortemperature` merged in 2021 and is on the floor blocklist, so white
balance is per-channel gains on `colorchannelmixer` (2013). Measured on the
bundled binary, a `0x808080` grey at 50 % alpha in `yuva420p` through
`rr=1.208:gg=0.966:bb=0.725`: out comes `98 7a 5b 7f` — 152, 122, 91, alpha
kept. The grey decodes as 126 on the way in, and 126 × the gains is 152.2,
121.7, 91.4: the gains are applied exactly. `-filters` lists it `TSC`, so it
takes `enable` — an adjustment layer needs that — and `eq` is `T.C`.

### A mask used to throw away the clip's own alpha

Found while planning B3's chroma key, which has the same shape of problem.
Every alpha shape — sticker matte, clip matte, reveal mask, luma wipe — was
multiplied into one stencil and put on with `alphamerge`, which REPLACES alpha.
The clip's own transparency was never one of the shapes. Measured: a 4:3 blue
clip fitted into 16:9 over a red track, reveal mask covering the frame — the
fit's see-through side bars came out 0,0,0 where they should have shown the
red; without the mask they did. A half-transparent PNG went opaque the same
way. The clip's own alpha (`split`, `alphaextract`) is now the first shape and
everything multiplies into it (`integration/maskOwnAlpha.int.test.ts`).

### Chroma key — ffmpeg's arithmetic, written down so the preview can copy it

B3. `chromakey` (2015) and `despill` (2017), both older than the Windows
build. `render/chromaKey.ts` holds the model; the preview's shader and the
export's filters both take their numbers from it. Measured on the bundled
binary with patches of known colour (`integration/chromaKey.int.test.ts`):

- **A pixel's chroma is the stream's own U and V** — for a picture that
  arrived as RGB, swscale's BT.601 limited range: pure green is (54, 34).
- **The KEY colour is converted differently**: the full-range JPEG formula in
  10-bit fixed point (`RGB_TO_U`/`RGB_TO_V`, colorspace.h), so pure green keys
  at (44, 21). Copy the pixel formula for the key and every key is off.
  A consequence: a key picked off the screen itself sits about 0.03 of
  `similarity` from that screen, not 0. The default 0.12 covers it.
- **Distance** is `sqrt((du² + dv²) / (255² · 2))`, averaged over the 3×3
  neighbourhood; **alpha** is `clip((d − similarity) / blend, 0, 1) · 255`,
  TRUNCATED — or a hard cut at `similarity` when blend is 0. The model
  predicts every one of 18 patches × 5 keys within 4 levels.
- **`chromakey` REPLACES alpha**, like `alphamerge`. So the export keys a
  copy, keeps only its alpha, and multiplies it into the clip's own —
  straight after the fit, before the grade (a key measured on graded greens
  moves). It was first built as one of the late stencil shapes; a keyed clip
  that was then turned failed the whole export, because `finish` (the turn)
  runs before those shapes when there is no mask, and the box-sized key met a
  grown picture.
- **Despill**: `spill = max(g − (r·mix + b·(1−mix)), 0)`, and `green=−amount`
  takes that much out (200 → 90 at full, 145 at half); alpha kept.

**Preview parity, measured in the harness** (patch PNG over a black track,
alpha read back as displayed ÷ source): across 6 keys × 18 patches, soft
edges included, the WebGL shader is within 6/255 of the model; despill on
kept patches is exact. The shader's chroma coefficients are interpolated from
`PIXEL_U`/`PIXEL_V` rather than typed out a second time. Footage encoded
BT.709 keys on its own chroma in ffmpeg while the browser hands the shader
RGB, so on such a file the soft edge can sit a few percent differently — the
export is the one to trust.

The pick reads the preview canvas while it draws the clip RAW (no key, no
grade, no mask, nothing over it, full opacity) and averages a 7×7 square.

### `eq` drops the alpha plane — every graded clip lost its transparency

Found while testing the key. `eq` takes no pixel format with alpha, so ffmpeg
auto-inserts a conversion in front of it. Measured, a fully transparent pixel
through `format=yuva420p,eq=brightness=0.1,format=yuva420p`: alpha 0 in, 255
out. The same pixel through `colorchannelmixer`, `curves`, `lut3d`, `hue`,
`lutyuv` and `despill`: alpha 0 — only `eq` drops it. So brightness, contrast
or saturation on any clip with see-through parts made them solid: the bars a
fit leaves round a 4:3 picture came out black over the track below, a PNG
sticker became its rectangle. The preview never did this, so it looked right
on screen. `eq` is now wrapped — `split`, `alphaextract` before, `alphamerge`
after — so its colour is byte-for-byte what it was and only the alpha
changes. Cost, measured at 1080×1920: 0.59 s → 0.77 s for six seconds through
`eq` + encode alone, about 0.03 s per second of graded footage, paid only by
clips whose sliders are set (`integration/gradeAlpha.int.test.ts`).

### A keyframed opacity wrote over the alpha

`geq … a='<expression>'` REPLACED the clip's alpha with the opacity, so a
keyframed fade on a letterboxed clip had black bars for its whole length
(measured: 5,0,0 where the red track should show). Now
`a='alpha(X,Y)*(<expression>)/255'`. geq's `alpha()` is from 2013.

### A Grade layer with a look could not export

An adjustment layer's grade runs on the composited tracks below it. But the
clip chain also built its look on the layer's own never-drawn picture and left
it unconnected — `Filter lut3d has an unconnected output`, whole graph
refused, at any intensity. The graph test only ever read the string. Neither
the look nor the new `eq` wrap is built on an adjustment layer's own picture
now, and `integration/adjustment.int.test.ts` renders one.

### A moving mask — curves of `T` in `geq`, worked out once per row

B3. A mask's centre and size are keyframe tracks; the export writes each as a
`keyframeExpression` of `T` into the mask's `geq`. Measured on the bundled
binary:

- **`T` is the clip's own seconds** where the mask is drawn — on the clip's
  chain, before `setpts` moves it to its place — 0, 0.1, 0.2… at 10 fps, as
  the opacity keyframes already rely on.
- **`st(n, e)` / `ld(n)` work inside a quoted `filter_complex` argument, and so
  does `;`**: `st(0,32);if(lt(X,ld(0)),200,0)` is 200 to x=31, 0 from x=32.
  (A first probe looked wrong: `od` collapses repeated lines into `*`. Read
  with `od -v`.)
- **geq has no per-frame stage**, so a curve written in at every use is
  evaluated a dozen times per pixel. geq walks each row from x=0 and the
  variables persist between pixels, so the curves are stored at `X` = 0 and
  read back. 3 s at 1080×1920, four tracks of six keys:

  | | time |
  |---|---|
  | still mask | 11.4 s |
  | curves at every pixel | 26.8 s |
  | curves once per row | 13.4 s |

  The per-row picture is byte-identical to the per-pixel one over 180 frames.
- The still number is itself the finding: **a `geq` mask runs about 3.7×
  slower than real time at 1080×1920.** Not changed yet (FIX.md B3).

Rendered (`integration/maskKeyframes.int.test.ts`): a window keyed from a
quarter to three quarters across lands within a pixel of prediction on every
frame. A pixel-reading trap on the way: `-ss` returns the first frame AT OR
AFTER the time, so the middle of a clip's last frame is past it and reads as
the track below — sample a quarter-frame before the frame instead.

### RGB filters lose two levels on the packed route — run them planar

Every RGB-only filter the export uses — `colorchannelmixer` (white balance, and
the static opacity control), `curves`, `lut3d`, `despill` — is handed a
yuva420p stream, and ffmpeg converts for it. It picks PACKED `rgba`, and the
yuva420p ↔ rgba route loses levels. A mid grey from lavfi, read back as rgb24,
on the macOS build:

| route | grey |
|---|---|
| no filter | 126 |
| mixer 1,1,1, curves identity, lut3d identity, despill, opacity 0.5 — auto (rgba) | 124 |
| the same, each after an explicit `format=gbrap` and before `format=yuva420p` | 126 |

The warm balance on the auto route came out 150,120,89 against gains of
152.2,121.8,91.3; on gbrap 153,122,91. On the Windows build the auto route was
3–4 levels low in every channel of every balance (CI #79); a one-off probe on
the runner (CI #80) had a unity mixer turn 128 into 125 on the auto route, and
the warm balance land at 154,122,92 on gbrap against 154.6,123.7,92.7 — and,
unlike the Mac, an EXPLICIT `format=rgba` was exact there too, so it is the
format ffmpeg negotiates for itself that loses the levels. The keyframed
opacity's `geq` already runs planar and was exact. The preview loses nothing,
so the file was quietly darker than the screen, and white balance's own
5-level tolerance was too loose to notice two. `inRgb` in plan.ts wraps each
run of RGB filters in `format=gbrap … format=yuva420p` (`gbrp`/`yuv420p` on the
composite an adjustment layer grades), and `integration/rgbRoute.int.test.ts`
holds invisible settings to 1 level.

### Steady — vidstab on both builds, measured against deshake

B3. A 720×420 noise texture with a white marker, cropped to 640×360 at an
offset driven by a few low and high frequency sines — a hand-held wobble with a
known size — and the marker's centre found in every frame (`integration/steady`):

| | spread across | spread down | time, 4 s at 720p |
|---|---|---|---|
| as shot | 7.6 px | 6.0 px | — |
| `deshake` (defaults) | 4.1 | 4.1 | 1.5 s |
| `deshake` rx/ry 32 | worse: 7.3 / 13.3 on a grid texture | | |
| `vidstab` default | 1.4 | 2.4 | 0.8 s (+ analysis) |
| `vidstab` smoothing 30 | 0.5 | 0.6 | 0.7 s (+ analysis) |

A periodic texture (a grid) fools deshake's block matching — test on noise.
The 2018 Windows build lists `vidstabdetect` and `vidstabtransform` and runs
both (CI #83). The analysis must see the frames the render decodes, so it runs
with the plan's own `-ss/-t` input (`videoInputArgs`), and vidstabtransform goes
first in the chain, before `setpts`. `deshake` drops the alpha plane like `eq`
does (0 in, 255 out) — harmless where it sits, on decoded footage before any
padding exists.

---

## 30. Every clip on its own frames — `setpts` truncates, and six decimals is not a frame

Found on 2026-09-26 while building the freeze, and older than anything in this
file that places a clip: **a clip whose start was not an exact decimal landed
a frame out in every export.** Measured on a numbered source (each frame a
flat grey of N×4, lossless), one clip at a time, at 30 fps:

| start | seconds | written | what the export showed on the start frame |
|---|---|---|---|
| 5 | 0.1666667 | 0.166667 | **black** — the start rounded UP past the frame's own time |
| 10 | 0.3333333 | 0.333333 | **source frame 1**, the whole clip a frame early |
| 20 | 0.6666667 | 0.666667 | **black** |
| 25 | 0.8333333 | 0.833333 | **source frame 1** |
| 30 | 1.0 | 1.000000 | frame 0 — right, and only because it is exact |

Two faults, one on each side of the rounding:

- **The drawing window.** Each clip is overlaid with `enable='between(t,S,E)'`,
  S and E written to six places. 20 frames is 0.6666667 s; written 0.666667
  it is a hair LATER than frame 20's own time, so frame 20 is outside its
  clip's window and nothing is drawn there.
- **The placement.** `setpts=PTS-STARTPTS+S/TB` puts the clip in time, and
  setpts converts the result to a timestamp by TRUNCATION (`D2TS`). 10 frames is
  0.333333 s, which is 9.99999 ticks — truncated to 9: the clip starts a frame
  early, and the window then hides that frame, so its first visible frame is
  the clip's second.

The fix, in `render/plan.ts`: the window opens and closes **half a frame**
before the clip's first frame and its end — far past any rounding, short of
the next frame — and the placement is `floor(S/TB+0.5)`, the nearest tick
(`floor` is as old as ffmpeg's expression evaluator). Checked by
`tests/integration/placement.int.test.ts` — back-to-back clips at 0, 5, 11,
20 and 25, every output frame against the source frame it must show, and a
60 fps clip at frame 20 of a 30 fps edit — and both faults, put back, fail it.

Why no render check saw it in two years of them: they sample the MIDDLE of a
shot, where a frame's shift is invisible, and most tests start clips at 0 or
on whole seconds. A check of an edit has to read the frames AT its cuts.

## 31. AVIF and HEIC — neither bundled ffmpeg opens them; sharp does

Found on 2026-09-26, the first time real product photos went through the
Director: four listing images saved from a shop page were AVIF, and every one
failed to import. `IMAGE_EXT` had listed `avif` and `heic` from the start, so
the open dialog offered them and `ffprobe` then refused — the macOS 4.4 build
with `moov atom not found` (it reads the ISOBMFF box and has no AV1-in-HEIF
demuxer), and the Windows build is from December 2018, before either format
had a decoder anywhere. `tests/integration/importAvif.int.test.ts` probes an
AVIF with ffmpeg alone each run and writes the refusal to its note, so the day
a build reads them is the day the note says so.

sharp 0.35.4's libvips (8.18.6, libheif 1.23.2) decodes AVIF on every platform
sharp ships prebuilt. HEIC needs an HEVC decoder sharp does not ship; sharp's
own words for one are "bad seek" and "unable to write to target", so the
import says instead that HEIC needs a decoder this build lacks. So
`src/main/imports.ts` converts a still of either kind to a PNG under
`userData/converted/` on import — keyed by the file's size and mtime like the
other caches, with the colon replaced because Windows forbids it in a name,
and the original's name cut to 48 characters because a 241-character name
made a 258-character one that could not be opened for writing (Windows'
MAX_PATH is 260). The copy is written under a name of its own and moved into
place whole, and a cached copy that will not open is made again — a quit
mid-write once left a fragment `ffprobe` accepted at 640×640.

**The asset stands for the file, and reads the copy.** `path` is the PNG;
`source` is the AVIF. Everything that moves a project follows `source`
(`relink.ts` `fileOf`): the relative path is to the AVIF, a folder relink
matches the AVIF's name and size, "already imported" compares the AVIF, and
on open (`locateAsset`) the AVIF is found wherever it now is and the copy
remade if the cache lost it. A relink to an AVIF converts it before answering.
`rotate()` with no argument bakes the EXIF orientation in, which a phone's
HEIC nearly always carries and ffmpeg would never see. Nothing prunes the
cache yet: every converted still, and every earlier version of a re-saved
source, stays (a 6000×6000 AVIF of noise became a 103 MB PNG).

## 32. A blur over the whole picture needs no shape — `geq` is ten times the blur

The Director's backdrop (a square photo in a 9:16 ad, shown whole over a
blurred copy of itself) is the editor's "Blurred background" drop: a blur
mask whose rectangle covers the whole frame. The mask route draws the shape
with `geq` over every pixel of every frame, then splits, merges and overlays.
Measured 2026-09-26 on a 540×960 still, 90 frames, the bundled macOS build:

| chain | time |
|---|---|
| the mask route — `geq` shape, split, `gblur`, alphamerge, overlay | 3.86 s |
| `gblur` alone on the opaque planes, alpha off and back on | 0.36 s |
| `geq` alone | 0.03 s (it is the shape-and-merge chain per frame, not geq by itself) |

CI #98 timed out on four of them on the 2018 Windows build. So `plan.ts`
takes a blur mask whose shape `isWholeFrameShape` (an upright, hard-edged,
uninverted rectangle reaching every edge, not animated) without the shape:
alpha out, `gblur` on the colour, alpha back — the same picture, and a
picture that does not fill its box keeps its see-through bars exactly as the
shaped route keeps them. A feathered, turned, inverted or smaller shape goes
the old way. `tests/integration/mask.int.test.ts` checks both, and the
backdrop render check asserts the graph has no `geq`.

## 33. Sound design — what the audio side measured (2026-09-26)

Three facts the C3 render check ran into, each of which changed a number:

- **`sine` generates at an eighth of full scale.** `sine=frequency=220`
  followed by `volume=0.1` measured −38 dBFS peak, not −20: the source's own
  output is −18 dB. A test bed meant to sit at −20 dBFS wants `volume=0.8`.
- **A clip's gain is clamped to +6 dB in the render** (`audibility.ts`
  `MAX_GAIN`, the fader's ceiling — `clampGain` in `plan.ts`). A level
  written on a clip above it is silently not heard: the sound design's
  levels normalise each file by its measured peak and cap at the same
  constant, so the library's quietest swell (−16.9 dB) lands 3 dB shy of
  its table level rather than asking for a gain the file would never get.
- **AAC overshoots a limited peak.** Through `loudnorm` at TP −1 the mix's
  decoded sample peak read −0.8 to −1.2 dBFS across runs: the encoder's own
  reconstruction, a few tenths of a dB. A check of "under the ceiling" on
  the encoded file draws its line half a dB above the ceiling.

And the measurement the sounds are placed by: every library file's loudest
10 ms window, found by decoding to floats with the bundled ffmpeg
(`scripts/measure-sfx.mjs`). The peaks agree with the librosa measurement of
2026-09-23 to within 10 ms; the levels, which that measurement did not
record, span 17 dB across the library (−2.5 to −19.9 dB), which is why the
table carries `peakDb` and the placement normalises by it.

Two more from the C3 review, both measured:

- **The stereo bus plays a mono file 3 dB down.** `aformat=…:channel_layouts=
  stereo` — the front of every audio chain in `plan.ts` — upmixes at 0.707:
  a −20 dBFS mono tone reads −23.0 in each channel. So a level measured on a
  mono downmix (`-ac 1`) is 3 dB hotter than the render will ever play a mono
  file, and every .wav in the library is mono. The measurement now goes
  through the render's own front of chain and reads both channels, so the
  table is the bus, not the file.
- **`volumedetect` cannot see clipping.** It takes only s16, so ffmpeg clamps
  a float decode first: a mix at +6 dBFS read `max_volume: 0.0 dB`. `astats`
  reads floats — `Peak level dB: 6.02` on the same file — and is what a check
  of "nothing clips" has to use (`tests/integration/output.ts` `peakLevelDb`).

## 34. Moments — three.js frames over a cut (2026-09-27)

The four moments (docs/PLAN.md §7) draw with three.js into the same rail the
card ring uses: numbered PNGs with alpha, `-start_number 0`, held by `tpad`,
overlaid with `format=yuva420p`. Nothing new reaches ffmpeg; what was
measured is the drawing, and one thing about measuring renders.

**Exact at both ends.** The harness check (`window.__forgeMomentCheck`,
`src/renderer/src/harness/momentCheck.ts`) draws each kind over two
synthetic pictures at 270×480 and compares pixels. Every bridge's first
frame equals the outgoing picture and its last the incoming one with a mean
difference of **0.000/255** — not "within 2/255": the textures are sampled
raw (`NoColorSpace`, `flipY` off, the picture's own rectangle from
`textureWindow`) and the shaders' blur, offset and glow are exactly zero at
t = 0 and t = 1. A depth push's first frame equals the photo (0.000), and
its last MOVING frame equals its final held frame (`movingFrames`), which is
what stops the shot popping back when the push ends.

| kind | moving frames (30 fps) | frames differ, first/mid/last (mean /255) | draw, 1080×1920 | PNG encode per 1080×1920 frame |
|---|---|---|---|---|
| zoom-punch | 12 | 19 / 77 / 79 | ~130 fps (the first, cold call) | 21 ms |
| whip-blur | 12 | 61 / 65 / 79 | ~460 fps | 20 ms |
| light-burn | 17 | 86 / 34 / 79 | ~520 fps | 60 ms |
| depth-push | 60 of the shot | 2.3 / 2.4 / 4.5 | ~690 fps | 20 ms |

The drawing includes composing each shot's picture onto a frame-sized 2D
canvas per frame and uploading it (a shot that does not move composes once);
the first call also compiles the shader. So a bake
is the PNG encode, not the drawing: a 12-frame zoom punch at 1080×1920 is a
quarter of a second, a two-second depth push about 1.4 s, and the light burn
three times the others because grain does not compress. These are the
synthetic pictures' figures (gradients with a square); a photograph's frames
are bigger PNGs and encode slower — the serum ad's punch frames were 0.45 to
2.25 MB each. The ring's bake is the same shape and the same cost per frame;
a bridge writes 12–17 frames against a three-second ring's 90, a depth push
60. Not yet measured on the Surface.

On the real serum ad (`tests/output/eval/real-serum-e2b-moments2`), whose
two shots both carry a Ken Burns push-in, the rendered frame before the zoom
punch and its first frame differ by **1.1/255** mean, its last frame and the
frame after by **2.0/255** — H.264's own noise — against 124/255 across the
cut itself and 11/255 between the moment's first two frames. So the moment's
picture follows the shots' moves to the frame, through the export.

The pictures the shaders sample are composed per frame on a 2D canvas from
the full-size photograph (`momentCanvas.ts` `Composed`), so there is no
texture cap to starve a 4K export; the photograph is decoded once with
`createImageBitmap(..., { imageOrientation: 'none', colorSpaceConversion:
'none' })`, as the bundled ffmpeg reads it — a `<img>` decode would turn an
EXIF-tagged phone JPEG upright and convert a Display P3 one to sRGB, and the
moment's ends would then differ from the shots beneath them in the export.

**`-ss` hands back the frame AT OR AFTER the seek point.** The render check
(`tests/integration/moment.int.test.ts`) samples one frame per timeline
frame, and every sample landed one frame late when asked for the MIDDLE of a
frame (`(f + 0.5) / fps`): accurate seek drops frames before the point and
returns the first at or past it, which is frame `f + 1`. Ask for a hair
before the frame's own timestamp (`(f − 0.25) / fps`) and it is frame `f`.
`pixelAt` in the other render checks samples the middle of a clip, where a
frame either way is the same picture, so it never showed.

## 35. A parallax shot's crop is in the photograph's pixels, its planes are not (2026-09-27)

Found by the C4 review and measured in `tests/integration/parallaxCrop.int.test.ts`
(`tests/output/parallaxCrop/`): a 1200×900 photo baked to 600×450 planes,
cropped to the photo's middle 600×900 for a frame half that size.

- **The crop was handed to the plane composite unscaled.** `clip.crop` is
  stored in the photograph's pixels (`solveCrop`, the on-picture handles);
  the planes are the bake's working size. `crop=w='min(600,in_w)'…` on a
  600-wide composite took the whole bake slid to x = 0, and the export showed
  the shot letterboxed at the photo's own shape — red at the left edge, green
  at the right, black above — while the preview, which scales the crop into
  plane space before it draws the planes, filled the frame. The crop is now
  scaled into the bake's pixels (`crop.ts` `scaleCrop`) and applied to EACH
  PLANE before its move, as a flat clip is cropped before its move; the frame
  reads blue to every edge.
- **Each plane's move pre-scaled to a working size of its own.** `motionFilter`
  chooses its working size from the canvas and the move's headroom, and the
  headroom was that plane's own share of the amount: a back plane at 0.032
  came out 324 wide and the front plane at 0.096 came out 346, and
  `overlay=0:0` stacked them as they were — the subject drawn 7 % too big and
  off its ground. Every plane's size is now chosen for the clip's full amount
  (`sizeAmount`), so they stack aligned; the white subject at the bake's
  centre lands within a pixel of the frame's centre (measured 76.0, 113.0
  against 75, 112.5).

Neither showed in `tests/integration/parallax.int.test.ts`, whose bake is the
photo's own size and whose canvas is nearly the bake's. The moments engine
(`render/moment.ts` `shotPicture`) composes a parallax shot the preview's way
— the crop in photo pixels, each plane's rectangle in 0..1 of itself — and now
agrees with the export.

## 36. The footage pre-pass — a moment's frames are the render's frames (2026-09-27)

A bridge over footage composes the shot's own frames (docs/PLAN.md §7.2), so
what the pre-pass pulls has to be what the render plays under the moment.
Measured in `tests/integration/momentFrames.int.test.ts` (`tests/output/
momentFrames/`) against the render itself: a 64×36 clip whose frame N is
luma 8·N, encoded lossless (`-qp 0`), so every frame names itself, a step of
9.3 levels apart; the pull and the render agree within 5 levels or the check
fails, and a frame off is 9.

- **Through the clip's own retime, the frames match.** At speed 1 from an
  in-point of 10, the window 5–10 pulled levels 121, 130, 140, 149, 158, 168
  — the source's frames 15–20 — and each equals the render's frame at the
  same clip frame (the largest difference seen was 3). At half speed the
  render's `setpts`+`fps` pair repeats each source frame twice, and so do the
  pulled frames; at 1.5× it drops every third, and so does the pull (121,
  130, 149, 158, 177). Through a ramp from 1× to 0.4× the pulled frames
  30–33 read 205, 214, 214, 224 and match the render — ONLY once the request
  carries the clip's whole length: the ramp's `setpts` curve runs across the
  clip, and a curve built over the window alone was four source frames off
  (measured, then fixed).
- **Every case decodes from the in-point; a seek to the window lands off
  the render's phase.** The first pull seeked straight to the window's place
  in the file (`inPoint + first × speed`). At half speed with an odd first
  frame (in-point 20, first 39: 20 + 39 × 0.5 = 39.5) the seek returned
  source frame 40 where the render's `fps` filter, counting from the
  in-point, was still repeating frame 39 — the moment's first frame was one
  source frame ahead of the shot beneath it, measured on the footage demo
  (4.7/255 against the plain render's frame 39, 1.2 against its frame 40).
  The check's half-speed case had let it through because its first frame
  was even and its per-frame step, three levels, sat inside a seven-level
  tolerance; it now starts on an odd frame. And at speed 1 the seek skipped
  the render's `fps` step altogether, so 24p and 60p footage in a 30 fps
  project — the ordinary wedding case — pulled the file's own consecutive
  frames: 60p played at half speed under the moment, 24p ran ahead, and a
  24p window of nine frames came back short and the moment was dropped
  (found by the review, measured). Every case but a hold now decodes from
  the in-point through the render's own retime — `fps=<project>` at speed 1
  — and trims the window out; the check pulls 24p and 60p sources against
  the render.
- **Smooth slow-motion looks ahead, and the 2018 build does not flush.**
  `minterpolate` emits a frame only once it holds the two after it, so a
  window with one frame of slack came back five of six at both ends of a
  clip and the moment was dropped. Every pull is now given the render's
  whole input window (`sourceFramesFor`, exactly `videoInputArgs`'s `-t`),
  and smooth slow-motion eight source frames more: on CI the Windows
  build's `minterpolate` closed its stream without flushing — a window on a
  smooth clip's last six frames came back **three**, and a `tpad` placed
  after it padded nothing (the macOS build flushes and holds). With the
  lookahead the interpolator emits the whole window on either build; past
  the clip's end those frames continue the motion where the macOS render
  holds its last, a difference over the last three frames of a smooth clip
  only, which the check compares for presence alone. The render on that
  build is short by those frames too — a smooth clip's tail is a
  pre-existing Windows difference, not the pull's.
- **A seek lands on the frame, not before it.** `-ss` at the in-point's
  time with the bundled build decodes from the keyframe and drops what comes
  before the point (accurate seek), so `-ss 0.4` on a 30 fps file returns
  frame 12, not 9. The first draft of the check said otherwise and was
  wrong: it compared RGB with luma.
- **The file's luma is limited-range.** `geq=lum='8*N'` writes Y; the RGB
  the render and the pull both show is `1.164 × (Y − 16)`: Y 96 (frame 12)
  is level 93, Y 120 (frame 15) is level 121, and frames 0 and 1 are black.
  A test that expects the luma it wrote will find a value a fifth lower.
- **The cap is measured on the frame that arrives.** The probe records a
  phone clip's coded size and ffmpeg decodes it turned, so a cap sized from
  the probe squeezed a portrait clip into a landscape box at half its
  resolution (a 64×36 clip tagged `rotate=90` pulled 20×36). The cap is an
  expression on `iw`/`ih` now.
- **Not followed: a steadied clip.** Its frames are the stabiliser's
  (vidstab's transforms, deshake), which the pull does not run; a bridge
  over a steadied clip is not drawn, and the export leaves it out.

The pull itself is one ffmpeg run per shot per moment — twelve to seventeen
PNGs, a fraction of a second on the Mac for 1080-tall crops — kept under a
name that changes with the file, its window, its retime, its crop and the
pull's own version, so the preview, the bake and the next export read the
same frames, and a folder an older pull left is never reused. Two callers
asking for the same frames at once (the store's bake and the preview, right
after Direct) share one pull; a pull that fails takes its temporary folder
with it; the cache is kept under 2 GB, oldest first.

Through the GPU, on footage: a whip blur between two moving test pictures
(`testsrc2` at half speed from frame 20, `testsrc` at speed 1) drawn by the
harness from pulled frames and overlaid by the render, against the same
project rendered without the moment — the frame before the moment 0.5/255,
the moment's first frame 1.1, its last 1.2, the frame after 0.3; the cut
frame itself 138. The moment's picture is the footage's, to the frame.

## 37. MediaPipe face detection on a real Mac — it runs, and the full-range model detects where the short-range one does not (2026-10-05)

Measured by the user on their own Mac with the planning measurer's venv
`/tmp/claude-501/mpvenv` (CPython 3.14.6 by its `pyvenv.cfg`; mediapipe
0.10.35 installed `--no-deps`, per the planning journal; the output itself
prints neither version) on an Apple M1 Pro (the renderer line), with three
empty stub files first on `PYTHONPATH` (`cv2/__init__.py`,
`matplotlib/__init__.py`, `matplotlib/pyplot.py`; the venv holds no real
cv2, opencv or matplotlib) and the measurer's script
`/tmp/claude-501/facetest.py`: 80 frames of
`references/recordings/capcut-grid-template.mp4` at 8–16 s, decoded by the
bundled ffmpeg at 10 fps, scaled from 1180×2556 to 360×778, rgb24, through
the Tasks `FaceDetector` in VIDEO mode on the CPU delegate,
`min_detection_confidence` 0.5, timestamps i × 100 ms. "Frames with a
detection" counts frames with at least one detection at that threshold; the
boxes are each frame's first detection, and the script prints every ninth
(7 of the 57 for full range).

| model | frames with a detection | ms a frame | the printed boxes (analysed frame, px) |
|---|---|---|---|
| `blaze_face_short_range.tflite` (229,746 B) | 1 of 80 | 1.7 | one, 94×94 at score 0.63, on the face |
| `blaze_face_full_range.tflite` (1,083,786 B) | 57 of 80 | 5.0 | 7 printed of 57: six on the face, 40–50 px square, scores 0.66–0.88; one, at 8.0 s (38×38, 0.58), on a bridge pillar, while that frame's real face (~15 px) is missed |

Where the printed boxes sit was checked by re-decoding the same window with
the same ffmpeg arguments (frames byte-identical to the script's input) and
drawing the boxes on the frames.

- **It ran on a Mac with Metal.** The dev sandbox on this same M1 Pro, where
  `MTLCreateSystemDefaultDevice()` returns NULL, had aborted the whole
  process with SIGABRT, exit 134, even on the CPU delegate
  (`gl_context_nsgl.cc failed to create pixel format`, then a C++ `Check
  failed: service_`). With Metal visible the log reads `GL version: 2.1 (2.1
  Metal - 90.5), renderer: Apple M1 Pro` and `Created TensorFlow Lite
  XNNPACK delegate for CPU`, and both models ran to the end. So the macOS
  wheel needs a GL/Metal context even for CPU inference, and, by the sandbox
  result, a process that cannot get one dies rather than raising an
  exception (no VM or CI runner was run): run it in a child process
  (`docs/CLIPS.md` §4.3). A Python parent sees that death as returncode −6;
  a shell prints 134 (measured here with `os.abort()`).
- **The Tasks `FaceDetector` accepts the full-range model.** MediaPipe's
  Face Detector page lists it beside the short-range one (read 2026-10-05);
  the plan's earlier "short range only" was the planner's reading, not the
  page. On this footage the short-range model detects on 1 frame of 80 and
  the full-range one on 57. Those are frames with a detection at score
  ≥ 0.5, **neither recall nor precision**: at least one printed box is not
  a face, and nobody has marked the footage, so how many of the 23 misses
  hold a face is unknown.
- **5 ms a frame, at 360×778 only.** BlazeFace's input is a fixed square, so
  the cost should depend little on the analysed size beyond the copy and the
  resize, but only one size was run; the plan's 640 px edge is unmeasured
  (run the script at w=640 and w=1080). At 5 ms, a 10-minute clip at 5 fps
  (3,000 frames) is about 15 s of detection on this Mac; decoding the same
  ten minutes of 1080p30 is about 20–30 s by `docs/CLIPS.md` §4.2's synthetic
  decode measurement (1.97 s a minute), not timed in this run.
- **The stubs are enough for detection, not only for the import**: the
  planning measurement had shown `import mediapipe` passing with the empty
  stubs; this run shows detection working the same way, so the ~65 MB of
  `opencv-contrib-python` and matplotlib need not be installed, and no real
  `cv2` lands in the venv. The stubs must include `matplotlib/pyplot.py`:
  `drawing_utils.py:20-21` imports both `cv2` and `matplotlib.pyplot`. pip
  rejects `--no-deps` inside a requirements file (pip 26.1.2), so the
  install is two pip runs (`docs/CLIPS.md` §4.3).
- **The decode is the cost on phone footage.** Measured in the sandbox with
  the bundled ffmpeg on the user's face fixture
  (`references/recordings/face-fixture-2026-10-05.mov`, 26.6 s of 3840×2160
  HEVC at 30 fps): `-vf fps=1,scale=640:360 -f rawvideo` took **7.94 s**,
  about 3.3× realtime, because `fps=` decodes every source frame whatever
  it keeps. A 10-minute 4K HEVC clip is then about 3 minutes of decode on
  this Mac before any detection, against ~15 s of detection at 5 fps; the
  1080p30 H.264 number above (1.97 s a minute) is six times lighter. The
  analysis budget in `docs/CLIPS.md` §4.10 is written for 1080p; 4K phone
  clips need the decode measured on the Surface before that bar is trusted
  there. Not measured: whether `-skip_frame nokey` or a lower `-threads`
  setting changes it, or hardware decode (`videotoolbox`), which the
  sandbox cannot reach.
- **Unmeasured still:** the Surface (no Metal; the Windows wheel on its own
  CPU path), mediapipe 1.0.1 (the test ran 0.10.35), the worker's import and
  start-up time, and recall and false boxes against hand marks on footage
  with known faces.

## 38. The stacked two-up — two half crops stacked are the one crop, bit for bit (2026-10-05)

Measured on the Mac's bundled ffmpeg (4.4, darwin-arm64) for
`docs/CLIPS.md` §4.7, by the plan's review and again by its fixer. The
source: `testsrc2=s=1920x1080:r=30`, 60 frames, stored as yuv420p FFV1.
Outputs compared frame by frame with `-f framemd5` over **rawvideo**
(`-c:v rawvideo`).

| graph | against | result |
|---|---|---|
| `split=2[a][b];[a]crop=608:540:656:0[t];[b]crop=608:540:656:540[u];[t][u]vstack` | `crop=608:1080:656:0` | all 60 frames identical |
| the same graph with each crop's `x` and `y` held as `if(lt(t,0.983333),<single>,<two-up>)` (frame 30's half-frame boundary at 30 fps, `docs/CLIPS.md` §3.2) | the single crop, and a static two-up at the second positions | frames 0–29 equal the single crop, 30–59 the static two-up; the first differing frame is 30 |
| the keyed graph inside `-vf` (one input, one output, labels inside) | the same graph in `-filter_complex` | all 60 frames identical |

- **So one graph serves both layouts**: every single shot of a two-up clip
  keys the top half at (x, 0) and the bottom at (x, 540), which reassembles
  the one crop exactly, and a cut switches layouts on its frame with the
  same held keys. The two crops' sizes are literal, so the stack's output
  size is fixed.
- **Compare over rawvideo, not FFV1 packets.** Hashed as FFV1 output
  instead, frames 30–35 of the keyed run differ from the static two-up's,
  though the decoded pictures are the same: FFV1 carries its coding state
  across its default 12-frame GOP, so the frames after the switch inside
  the GOP that began with single-crop frames (24–35) encode differently.
  The review found they match with `-g 1` as well.
- **Windows 2018 build: dated, not run.** `crop`, `split` and `vstack` all
  merged long before 2018-12-17 (crop 2010s, split about 2011, vstack
  2015, as known, not re-read in the 2018 source). `docs/CLIPS.md` §4.9's
  two-up rows run it in CI with step 1. Other frame rates (29.97, 60, VFR)
  and the shape inside `buildRenderPlan`'s own chain are unmeasured.

## 39. adelay in samples — the split click, measured and fixed (2026-10-05)

Measured on the Mac's bundled ffmpeg (4.4, darwin-arm64) for
`docs/CLIPS.md` §3.3, through the real `buildRenderPlan`, by
`tests/integration/audioSplit.int.test.ts` (artefacts, graphs and the numbers
as JSON in `tests/output/audio-split/`). The source: a 440 Hz tone, 5 s,
`-f lavfi -i sine=frequency=440:duration=5:sample_rate=48000 -af volume=4
-c:a pcm_s16le` (half scale, peak 0.49988), as an audio clip on A1 under a
grey picture, project 48 kHz, loudness off. Split with the editor's own
`splitClip`; rendered with the plan's own arguments (AAC in mp4); decoded
with `-map 0:a:0 -f f32le -c:a pcm_f32le pipe:1`. Two measurements per
channel at each cut: the largest second difference |x[n+1] − 2x[n] + x[n−1]|
within ±50 ms (±2400 samples), and the shift (searched over ±40 samples)
that best lines up the 10–60 ms after the cut with the same tone rendered
unsplit.

The first version of the check cut at frames 47 and 95, at 30 and 29.97 fps:

| fps | cut, frame (sample) | `adelay` in whole ms (before) | `adelay=<n>S` (after) | unsplit |
|---|---|---|---|---|
| 30 | 47 (75200) | **0.172**, shift +16 (`1567` ms = 75216) | 0.00128, shift 0 | 0.00128 |
| 30 | 95 (152000) | 0.00128, shift +16 | 0.00129, shift 0 | 0.00129 |
| 29.97 | 47 (75275.2 → 75275) | **0.028**, shift −11 (`1568` ms = 75264, overlapping the left half) | 0.00128, shift 0 | 0.00128 |
| 29.97 | 95 (152152) | **0.179**, shift +8 (`3170` ms = 152160, 19 samples after the middle half ends) | 0.00129, shift 0 | 0.00129 |

Both channels gave the same numbers in every row. After the fix the split
render differs from the unsplit one by at most 1.65 × 10⁻⁵ anywhere in the
file (about −96 dBFS), at both rates: the three-input `amix` and its
`volume=3` against the single-source path, through the same AAC encoder.

The review found that those cuts could not tell `Math.round` from
`Math.floor` (.2 and .0 both round down), and that the 29.97 row passed by
luck (below). The check now cuts at 30 fps only, at frames 47, 62 and 73,
each chosen for a different wrong delay. Same method, both channels equal
in every cell:

| cut, frame (sample) | why this frame | fixed: round | whole ms | `Math.floor` | `Math.ceil` |
|---|---|---|---|---|---|
| 47 (75200) | 1566.667 ms | 0.00128, 0 | **0.172**, +16 | 0.00128, 0 | 0.00128, 0 |
| 62 (99200) | 99200.00000000001 in float | 0.00130, 0 | 0.00129, +16 | 0.00130, 0 | **0.322**, +1 |
| 73 (116800) | 116799.99999999999 in float | 0.00129, 0 | **0.165**, −16 | **0.319**, −1 | **0.314**, 0 |

Each cell is the spike and the shift; unsplit is 0.00128, 0.00130 and
0.00129. Whole ms is `1567`/`2067`/`2433` ms: 47 and 62 both 16 late (a
gap at 47, meeting at 62), 73 on 2433 = 16 early, so the 62–73 half
overlaps the last by 32. Under ceil the 62–73 half starts one late and
overlaps the last by one, hence 0.314 at 73 with that half's shift 0.

- **Why 30 fps clicked only at 47 in the first check.** Frame 95 is
  3166.667 ms, also rounded up by 0.333 ms, so the middle and last halves
  were both 16 samples late and met each other exactly; only the cut after
  the unmoved first half had a gap. At 29.97 the two roundings go opposite
  ways and both cuts click.
- **The fix**: `adelay=${n}S|…` (eight entries, as before) with
  `n = Math.round(start / fps × sampleRate)` at `project.settings.sampleRate`
  (`src/shared/render/plan.ts`, the audio chain). The chain resamples to that
  rate before the delay (`aresample` second in the chain; the voice effect's
  pitch shift ends on its own `aresample`).
- **Exact only while a frame is a whole number of samples.** Then the delay,
  the input's `-ss` and its `-t` (both `toFixed(6)` seconds) all fall on
  whole samples, and the halves meet. Every rate in `FRAME_RATES` is, at
  48 kHz: 2000, 1920, 1600, 960, 800 samples a frame, and `sampleRate` is
  always the default 48000 (`timeline.ts`, the only place it is set).
  `tests/render.test.ts` fails if either stops being true. A clip moved off
  its own position (start 4, inPoint 0, split at 11) at 30 fps measured
  exact: 0.00126 against 0.00126 unsplit, shift 0.
- **Rounded, not floored or ceiled — and at offered rates.** `start / fps ×
  rate` is floating point and lands a hair either side of the whole sample
  at 25, 30, 50 and 60 fps: counted over frames 0–9,999, 745/678/745/678
  come out just under (floor would put them a sample early) and 750/684/750/
  684 just over (ceil, a sample late); 24 fps has none. The second table
  is that measurement: floor clicks at 73, ceil at 62, round at neither.
  Where ffmpeg starts `-ss` was not read; that the nearest sample matches it
  is what that table shows, at whole-sample frames.
- **Not exact at a frame that is not a whole number of samples** (known,
  measured, unreachable today). The delay, `-ss` and `-t` are each rounded
  separately, and at some cuts disagree by one:
  - 29.97 fps (1601.6 samples), the tone split at **47 and 96** with this
    fix in: a one-sample hole at 153753, spike **0.210** against 0.00129,
    shift 0 after the cut. The middle half's `-t 1.634967` is 78478.4 →
    78478 samples, but `round(153753.6) − round(75275.2)` is 78479. At 47
    and 95, and at 48 and 96, the roundings agree and the split equals the
    unsplit tone — which is how the first check's 29.97 row passed.
  - 29.97, a clip at start 4, inPoint 0, split at 11: **0.365** against
    0.00127, shift +1 (`round(17617.6)` = 17618, but the left half's `-t`
    gives 11211 samples after 6406).
  - 24 fps at 44.1 kHz (1837.5 samples), a 44.1 kHz tone split at 47
    (86362.5): `Math.round` gives 86363, but `-ss 1.958333` is 86362.485,
    and the right half came out one late, as if started at 86362: **0.438**
    against 0.0015, shift +1.

  None is reachable from the UI: the picker offers only `FRAME_RATES`, and
  nothing sets a rate other than 48 kHz. But `isFrameRate` exists and
  nothing calls it, so a hand-edited or imported project with fps 29.97
  loads, and clicks at some cuts. The second and
  third were the review's, and re-ran here through the plan to the same
  three figures; the first is new. If such rates are ever wanted, every clip's
  sound has to span exactly R(start) to R(start + duration), with R the one
  rounding — the delay from R(start), the length from the difference, the
  source start anchored on the input's own rounded `-ss` — not three
  roundings that usually agree. Render-check it with a moved clip.
- **44.1 kHz, measured (Mac only).** A 48 kHz tone in a 44.1 kHz project at
  30 fps (1470 samples a frame), split at 47, 62 and 69: spikes 0.00188,
  0.00191, 0.00151 against 0.00150 unsplit, shift 0 at every cut, at most
  8.5 × 10⁻⁴ from the unsplit render anywhere (each half is resampled on
  its own). No click; under the check's bar. The review measured the same
  at 47/95 (0.00187, 0.00193) and a sub-sample residual after a 29.97 cut.
- **The click is the size of the step**, so the absolute 0.01 bar depends
  on the level. At lavfi's own 1/8 amplitude the 30 fps frame-47 click
  measured 0.0429 against 0.00032 unsplit, and the 29.97 frame-47 overlap
  only **0.0070, under the bar**, though 22× the unsplit tone. Hence the
  half-scale fixture, and the check also holds each split under twice the
  unsplit value plus 0.001. The plan's 0.149 against 0.0012 came from a
  fixture it did not record; the unsplit values agree, and this click is
  about 15% larger.
- **And on the tone's phase at the cut.** The floor-sensitive cut was first
  frame 69 (110399.99999999999). 2.3 s is exactly 1012 cycles of 440 Hz, so
  the tone crosses zero there and a step at the cut is a step of almost
  nothing: floor's one-sample overlap measured only **0.0106**, a hair over
  the bar, and whole ms's 16-sample overlap 0.016 — though the shift test
  caught floor plainly (−1). At frame 73 (1070.67 cycles, the tone at
  −0.87 of its peak) the same floor error is 0.319. Cuts belong away from
  the tone's zero crossings; the shift test does not depend on it.
- **Mutations** (each run, each restored byte-identical against a saved
  copy, every anchor counted to one match). On the first check: whole ms
  back, all four rows fail as above; a moved clip one sample late, spike
  0.323 and shift 1 (a single zero sample steps down and back up on adjacent
  samples, so its second difference is about twice the waveform's value
  there, where the edge of a longer gap gives it once); only the first
  entry in samples and the other seven in ms, channel 1 fails with 0.172
  and shift 16 — so adelay takes a mixed list, and the right channel reads
  its own entry. Every clip one sample late, the one at zero included,
  passes, correctly: the unsplit render moves with it and nothing is split.
  On the current check: whole ms, floor and ceil each fail both tests, with
  the numbers in the table. On the unit tests (`tests/render.test.ts`,
  `tests/oldestFfmpeg.test.ts`): floor fails at start 73 (`116799S`), ceil
  at 62 (`99201S`), a literal `48000` for the project rate at 44.1 kHz
  (`75200S` for `69090S`), lowercase `s` in every shape that delays, 29.97
  added to `FRAME_RATES` and a 44.1 kHz default both fail the whole-samples
  test, and audio-track clips alone left in ms fail only in the new shape
  with two clips off zero.
- **The 2018 build: dated, not run.** Read from GitHub for this section:
  - The `S` suffix is `b5314333de`, 2016-08-11, "avfilter/af_adelay: make
    it possible to delay channels by exact number of samples". The plan
    (`docs/CLIPS.md` §3.3) cited `7748f395de`, committed 2018-11-11; that is
    "avfilter/vf_select: use common scene sad functions", which touches only
    `configure` and `f_select.c`. Reading `af_adelay.c` in its tree was
    valid; the commit named is not adelay's.
  - At the Windows build's own commit, `f22fcd4483` (committed 2018-12-17
    06:41 UTC), each entry is read by
    `ret = av_sscanf(arg, "%d%c", &d->delay, &type);` and is samples when
    `ret == 2 && type == 'S'` (`av_sscanf` is `0c7fb6e4a0`, 2018-11-18;
    the plan's quote said `sscanf`). Otherwise
    `av_sscanf(arg, "%f", &delay); d->delay = delay * inlink->sample_rate /
    1000.0;`. The floor holds by more than two years.
  - **Lowercase `s` (seconds) is after the floor**: `35a8179149`,
    2019-01-01. On the 2018 build `2s` scans as 2 and `'s'`, fails the
    `'S'` test, falls to `%f`, and is **2 ms**, with no error. The
    case-sensitive `/^\d+S$/` over every delay in
    `tests/oldestFfmpeg.test.ts` is the guard.
  - Why samples rather than fractional ms, derived, not measured: `delay`
    is a `float`, and `delay * inlink->sample_rate` is a float product
    before the `/ 1000.0`. A float near an hour's 3,600,000.333 ms has a
    0.25 ms step, so it is up to 0.125 ms off, about 6 samples at 48 kHz;
    the product (1.728 × 10¹¹, step 16384) adds up to about 8 more after
    the division, and the truncation to `int` up to one.
  - **The ceiling.** `ChanDelay.delay` is an `int` read with `%d`, so `n`
    past 2³¹ − 1 (about 12.4 h at 48 kHz, 13.5 h at 44.1 kHz) overflows.
    Measured on the Mac's 4.4 build, whose source (`n4.4`) is still `int`
    and `%d` there — the review's "int64 on 4.4" is not what it does —
    with a 440 Hz tone and `-t 0.05`: `2147483647S` is silence, as it
    should be; `2147483648S` and `3000000000S` fail the graph with "Delay
    must be non negative number"; `4294967396S` (2³² + 100) wraps, with no
    error, to a 100-sample delay (first non-zero sample at 101). The 2018
    source is the same `int` and `%d`; not run there.
  - **An hour-long delay costs no memory there.** Equal delays on every
    channel become `s->padding` (int64), each `d->delay -= padding` leaves
    0, no `av_malloc_array` buffer is made, and the silence goes out in
    2048-sample frames. Read at `f22fcd4`, not run.
- **The 2018 build, measured in CI**: the push of this fix (`9a85d9f`) ran
  the render check on Windows, run 37410645171, green — the `S` form is
  read and every cut measures equal to unsplit there too.
- **Unmeasured**: a clip with speed or a voice effect before its delay (the
  order was read, not rendered here); and a delay an hour long, rendered
  (n = 172,800,000 at 48 kHz, inside `%d`).

## 40. A link's captions — yt-dlp's metadata, json3, and what segments an unpunctuated track (2026-10-05)

Measured for `docs/CLIPS.md` §3b.1 (§7.1, §7.2; §15 rows 13 and 15) with
**yt-dlp 2026.08.19** — the copy on the development Mac's PATH, which is what
`ensureYtDlp` finds there (`FORGE_YTDLP` unset, no managed copy) — against
public YouTube videos, **named by id only**. The caption tracks were read in
a temp folder for these numbers and nothing else: no caption text is written
in this file, the code, the tests or the fixtures (the tests build their
json3 from made-up words). The sandbox could not write yt-dlp's cache
(`~/.cache/yt-dlp`), so `XDG_CACHE_HOME` pointed at a temp folder; every run
also warned that no JS challenge solver (deno) and no impersonation target
was installed, and none of that stopped a metadata or caption fetch. The
parser numbers come from running `src/shared/ingest/captions.ts` itself over
the tracks (bundled with esbuild), and the runner numbers from
`src/main/ingest/meta.ts` against the real binary. In review (2026-10-06) the
twelve videos' tracks were fetched again with the same yt-dlp and the json3,
punctuation and merge figures below recounted by a script that prints numbers
only; where a figure was corrected, the recount is what stands.

**The metadata subset** (`buildMetaArgs`; §15 row 15), on eight videos:
`dQw4w9WgXcQ`, `bMXY4uRuKH4`, `NCe4xZxczz4`, `KNF_Azd5SWs`, `5MuIMqhT8DM`,
`RcGyVTAoXEU`, `JqwfZdW4WvI`, `4XOms-HzmMY`.

- `channel`, `uploader` and `webpage_url` **printed on all eight**;
  `webpage_url` is the canonical `watch?v=` URL.
- **A field the video lacks is omitted from the dict, not printed null**: no
  `chapters` key on 3 of 8, no `heatmap` key on 4 of 8 (100 buckets where
  present). `parseMeta` makes them `[]` and `null`.
- `language`: `en` on five, `en-US`, `te`, `hi`. The `en-US` video's ASR
  track was keyed `en-orig`, so the primary subtag is the key.
- 1.46–1.75 s a video through `runMeta` (the very first command-line run,
  with a cold cache, 6.9 s).
- `--ignore-no-formats-error` (so the metadata comes back when no format can
  be downloaded) printed byte-identical output with and without it on
  `RcGyVTAoXEU` (one sha256).

**Captions only** (`buildCaptionArgs`, exactly as built):

- Under `--skip-download`, `after_video` prints the `requested_subtitles` dict
  **with each entry's `filepath`** (an absolute path, as `-P` gave it).
  Files: `<key>.captions.<lang>.json3`.
- **No track in the requested languages: `@forgesubs@NA`**, exit 0, nothing
  written (`xq,xq-orig` on `dQw4w9WgXcQ`).
- A second fetch **re-downloads and overwrites** (both mtimes moved) and
  prints the paths again: yt-dlp keeps no stale copy for us.
- **Which track is which.** With an uploader track, `<l>` is the uploader's
  (named "English", its URL without `kind=asr`) and `<l>-orig` the ASR
  ("English (Original)", `kind=asr`). With none, `<l>` and `<l>-orig` came
  back **byte-identical** — on all ten videos without one (three Hindi, three
  Telugu, four English; compared byte for byte in the recount). So the key
  cannot say which is which, and `json3Kind` reads the contents.
- Through `runCaptions`: 1.3–3.5 s a video; a cancel 1.5 s in rejected with
  `CancelledError` and left the folder empty.

**json3, as the parser depends on it** (six ASR tracks: `bMXY4uRuKH4`,
`NCe4xZxczz4`, `KNF_Azd5SWs`, `5MuIMqhT8DM`, `JqwfZdW4WvI`, `RcGyVTAoXEU`):

- A window event first (whole-video `dDurationMs`, no segs); word events
  `{tStartMs, dDurationMs, wWinId, segs}`, one word a seg, the first seg
  WITHOUT `tOffsetMs`, `acAsrConf` 0 on every word; `aAppend` events whose
  only seg is "\n" (some with no `dDurationMs`). Every word event had a
  `dDurationMs`. An uploader track is one seg per event.
- **Word starts never went backwards**: 0 of 5,720 word events (and 0 on the
  other six tracks recounted).
- **Roll-up**: consecutive word events overlapping (one ends after the next
  begins; an event holding only a bracket tag left out) 738 of 742,
  1,200/1,219, 819/821, 431/450, 2,091/2,122, 350/360. An event's end is a
  display end.
- Gaps of 700 ms or more between consecutive word events — where the
  event-gap rule breaks — 1, 11, 0, 9, 9 and 3 a track. (`NCe4xZxczz4` has 12
  if an event holding only a bracket tag counts as one; an earlier draft of
  this section gave that 12.)
- Bracket segs (`[Music]` and the like): 0–7 a track. The Hindi danda was
  never a seg of its own (0); the parser still glues a lone one to the word
  before.

**Punctuation** (raw tokens; share ending in `. ! ? … ।`):

| id | lang | tokens | sentence-final |
|---|---|---|---|
| `bMXY4uRuKH4` | en | 5,342 | 0 |
| `NCe4xZxczz4` | en | 9,027 | 4 |
| `4XOms-HzmMY` | en | 1,579 | 0 |
| `Bipu2DyN4oo` | en | 1,626 | 1 |
| `RcGyVTAoXEU` | en | 1,999 (ASR) / 2,012 (uploader) | 2 / 140 |
| `5MuIMqhT8DM` | en | 2,651 (ASR) / 2,641 (uploader) | 178 (6.7%) / 143 |
| `KNF_Azd5SWs` | te | 4,029 | 69 (67 `.`, 2 `?`) |
| `EaWN5iFtPfc` | te | 2,208 | 25 |
| `4AFWIYQ84-Q` | te | 1,787 | 65 |
| `JqwfZdW4WvI` | hi | 13,872 | 1,056 (909 `।`, 147 `?`) |
| `hxbm_arTxjY` | hi | 12,416 | 646 (595 `।`) |
| `dObA5P5jv4s` | hi | 11,852 | 600 (566 `।`) |

Every row reproduced exactly in the recount. English ASR on these uploads is
unpunctuated but for one; Telugu nearly so;
**Hindi ends its sentences with the danda and never with `.`** — hence `।`
and `॥` in `SENTENCE_END`.

**The three-track measurement** (§7.2, §15 row 13). Three unpunctuated
tracks — `bMXY4uRuKH4` (en), `NCe4xZxczz4` (en), `KNF_Azd5SWs` (te) — and
one punctuated, `5MuIMqhT8DM` (en); with `JqwfZdW4WvI` (hi, the danda) and
`RcGyVTAoXEU` (en, unpunctuated, with an uploader track). Segments are
count, then words p50/p95/max, then ms p50/p95/max.

| track | words | ends at the next start, pause + punct | the same + event gaps + cap | 80 ms estimate, pause + punct | parser (+ event gaps + cap) |
|---|---|---|---|---|---|
| `bMXY4uRuKH4` en | 5,342 | **1** · 5,342 · 1,872,960 ms | 258 · 21/21/21 · 7,200/10,081/12,199 | 195 · 18/79/247 · 5,639/27,200/80,641 | 362 · 15/29/30 · 4,279/9,400/11,920 |
| `NCe4xZxczz4` en | 9,020 | 5 · 195/4,744/4,744 | 497 · 17/26/27 · 5,680/9,480/14,800 | 245 · 15/153/272 · 4,960/42,560/80,880 | 684 · 12/29/30 · 3,320/8,520/12,520 |
| `KNF_Azd5SWs` te | 4,029 | 70 · 34/161/382 | 208 · 20/29/30 · 8,801/13,679/14,479 | 390 · 7/33/64 · 2,721/12,080/23,840 | 428 · 8/25/30 · 2,880/9,199/13,120 |
| `5MuIMqhT8DM` en, punct. | 2,651 | 177 · 14/33/58 | 188 | 207 · 11/29/46 · 3,720/10,400/20,480 | 217 · 11/26/30 · 4,160/8,999/12,240 |
| `JqwfZdW4WvI` hi | 13,872 | 1,057 · 8/33/350 | 1,245 | 1,800 · 6/21/79 · 1,600/6,001/25,600 | 1,853 · 6/20/30 · 1,600/5,761/11,279 |
| `RcGyVTAoXEU` en | 1,995 | 3 · 600/962/962 | 87 | 130 · 11/41/95 · 3,999/13,361/28,159 | 154 · 12/27/30 · 3,999/9,039/12,559 |

- **Without the estimate an unpunctuated track can be one segment for the
  whole talk**: `bMXY4uRuKH4` was (5,342 words, 31 minutes) — the failure
  §7.2 predicted, measured. The other three unpunctuated tracks came to 5
  (`NCe4…`), 3 (`RcGy…`) and 70 (`KNF_…`), still segments of hundreds or
  thousands of words. The cap alone then cuts at arbitrary even points.
- With the estimate, before the cap, segments still ran over 15 s (over 30
  words): `bMXY…` 34 (59), `NCe4…` 64 (87), `RcGy…` 5 (11), the Telugu
  `KNF_…` 11 (22) — up to 272 words and 81 s: **the cap is needed too**.
  After it, none over 30 words or 15 s (the parser's longest on the six:
  30 words, 13.1 s).
- **The event-gap rule added no break the pause rule had not already made**,
  on all six tracks at every estimate from 40 to 160 ms. Derived: every word
  ends by its event's end and the next event's first word starts at that
  event's start, so the word gap across two events is never smaller than the
  event gap. Its use is as the backstop: with ends at the next start it is
  the only break between events (`NCe4xZxczz4` 5 → 16 segments, `RcGy…` 3 →
  6, the Hindi 1,057 → 1,063). Kept. With the parser's ends it is the only
  break in one case: a word that starts past its event's end (a `tOffsetMs`
  beyond `dDurationMs`, never seen in a measured track), whose end clamps to
  its start. A test builds exactly that (below).
- **The danda's share**: the Hindi track with the cap gives 1,853 segments
  (p50 6 words) with `।` and 1,313 (p50 8) with it stripped.
- Start-to-start between consecutive words (all), p50/p90/p95/p99 ms:
  en 240/761/1,000/1,201, 240/681/960/1,199, 241/880/1,280/2,240,
  280/880/1,241/2,320; te 399/880/1,120/1,600; hi 319/720/1,040/1,919.
  Gaps of 2 s or more: 11, 35, 33, 44; 16; 124.
- The gap the parser sees (next start − estimated end) at 80 ms, p50/p95/max:
  en 0/641/8,839, 0/559/10,080, 0/800/9,521, 0/760/4,399; te 160/880/3,280;
  hi 81/879/12,161.

**`GRAPHEME_MS`: 80 confirmed, not changed.** Start to start inside one
event, per grapheme of the earlier word, p25/p50/p75 ms:

| | tracks | per grapheme | graphemes a word, p50 |
|---|---|---|---|
| en | `bMXY…`, `NCe4…`, `RcGy…`, `5MuI…` | 50/70/107, 43/64/100, 53/67/80, 53/70/96 | 4 |
| hi | `JqwfZ…`, `hxbm_…`, `dObA5…` | 81/134/200, 107/159/187, 120/160/200 | 2 |
| te | `KNF_…`, `EaWN…`, `4AFW…` | 120/160/200, 80/120/160, 107/140/187 | 2 |

Pauses of 700 ms or more found, by the estimate:

| ms a grapheme | 40 | 60 | 80 | 100 | 120 | 160 |
|---|---|---|---|---|---|---|
| `bMXY4uRuKH4` en | 398 | 325 | 194 | 173 | 136 | 68 |
| `NCe4xZxczz4` en | 482 | 367 | 240 | 215 | 161 | 96 |
| `5MuIMqhT8DM` en | 203 | 166 | 144 | 135 | 130 | 126 |
| `RcGyVTAoXEU` en | 182 | 149 | 129 | 107 | 101 | 96 |
| `KNF_Azd5SWs` te | 428 | 369 | 331 | 276 | 231 | 188 |
| `JqwfZdW4WvI` hi | 1,121 | 1,000 | 952 | 833 | 773 | 687 |

80 sits at English's p55–p75 per grapheme, so a fluent word's estimate mostly
reaches the next word's start (gap p50 0), and on the English tracks the
count flattens between 80 and 100 and climbs fast below 60. **A Hindi or
Telugu grapheme is about a syllable and runs about twice as long** (p50
120–160 on six tracks): at 80 those tracks find 39–76% more pauses than at
160 (`JqwfZ…` 952 against 687, `KNF_…` 331 against 188; `hxbm_…` 469/316,
`dObA5…` 459/290, `EaWN…` 124/79, `4AFW…` 124/78), and make 8–26% more
segments (parser segments at 80/120/160: `KNF_…` 428/
364/340, `EaWN…` 193/174/169, `4AFW…` 185/160/151, `JqwfZ…` 1,853/1,738/
1,685, `hxbm_…` 1,148/1,080/1,061, `dObA5…` 1,143/1,079/1,056; English
362/353/343, 684/656/634, 154/141/137, 217/213/211). Nobody listened, so
which of those extra pauses are real is not known; a per-script value is
left open rather than guessed.

**Which track wins (§16.12): `-orig` timing, the uploader's text.**

- `5MuIMqhT8DM`: **the uploader's lines sit about 12.0 s before the same
  words in the ASR**, for the whole video — ASR start minus line start,
  p10/p50/p90 11,849/11,971/12,026 ms over the 269 of 327 lines whose first
  three words occur exactly once, in a row, in the ASR (the candidates
  `alignCues` takes) — while 2,572 of the uploader's 2,636 words (97.6%,
  normalised, as a multiset) are the ASR's. Matched line by line on the
  uploader's clock, 231 of its 2,641 tokens (8.7%) found their ASR word. With
  each line moved by the median offset of the unique-trigram matches within
  8 lines (`alignCues`), **2,479 (93.9%)**. Five of those 2,641 tokens are
  punctuation alone; since the merge glues them to the word before (below),
  the same 2,479 are of 2,636 words: 94.0%.
- `RcGyVTAoXEU`: offsets −137/12/200 ms (215 of 284 lines); 1,872 of 2,012
  (93.0%) matched before the alignment, 1,862 (92.5%) after it; with the
  review's merge, 1,864 of 2,012 (92.6%), two of them kept ASR words.
- Merged segments: 211 (p50 11, max 30 words) and 185 (p50 10, max 28). The
  uploader track alone, spread over its lines: 171 and 151.
- **Speech the uploader did not caption** (review, 2026-10-06). The merge
  emitted only the uploader's words, so ASR words outside every line — an
  intro, an outro, a section left out — vanished with nothing to say so. Now
  an ASR word that starts 700 ms or more outside every aligned line is kept,
  with its ASR text and times, as a stretch of its own. On `5MuI…` that is
  none (first and last merged starts equal the ASR's); on `RcGy…` two words —
  a two-word phrase the ASR has twice, 4 s apart, whose first occurrence the
  uploader's line matched — 2,010 uploader words plus 2 kept, one segment
  more. A partially captioned video is unmeasured.
- **A lone punctuation token in a line** (a danda set off by a space) is
  glued to the word before it in the merge, as `parseJson3` already did for a
  lone track: unglued it normalised to nothing, never matched, and marked the
  whole merge approximate. Five such tokens on `5MuI…`, two on `RcGy…`; no
  Hindi video measured had an uploader track.
- **Overlapping lines.** A lone uploader track's line is now spread no
  further than the next line's start, so two lines on screen together cannot
  interleave word by word. Consecutive lines overlapping: 0 of 326 and 0 of
  283, so on the two measured tracks the parse is unchanged (word for word,
  start for start).
- An uploader track with no ASR beside it has only its own clock, and on one
  video in two that clock was 12 s off. Nothing can tell; how often it
  happens is unmeasured.

**The cleanup** (`removePartials`, the regex at `download.ts` before this),
run in node against `<stem>.<lang>.json3` for eight languages: it deleted
`fr`, `fi` and `fa` (their language starts with `f`, which the format-id
group read as `f137`) and LEFT `en`, `en-orig`, `pt-BR`, `hi` and `te`.
CLIPS.md §7.1 had measured the same with `.fi.vtt` and `.fa.vtt`. Fixed with
a caption case for every language, and the format-id group barred from
ending on a caption extension.

**Mutations** (each run with the file-based exit check, each restored
byte-identical against a saved copy, every anchor counted to one match;
14 changed files hashed before and after: identical). `tests/ingestCaptions.test.ts`:
confidence 0 in the parser (the "null, never 0" case fails) and in the merge
(the merge and the end-to-end cases); word ends at the next start (the 1 s
pauses inside one event, the end rules, the spread line); the cap not asked
for (the 80 words); the cap ignored by `segmentIntoSentences` (the 80 words,
the middle split); `।` out of `SENTENCE_END` (both danda cases); the run
filter widened to the range (both run cases); the cap on by default (the
Director's 100 words, both `capSegments` cases); `capSegments` writing back
(the frozen-input case); equal gaps split at the front; ends ignoring the
next start (the roll-up case); bracket tags kept; the clock alignment
removed (the 12 s merge); `-orig` not preferred. **The event-gap rule removed
on its own survived every test at first, as derived above** (removed together
with ends at the next start, "breaks between events" failed). Review added
the fixture where it is the only break — a word starting past its event's
end — and the rule's removal now fails it, both in `captions.ts` and in
`segmentIntoSentences`.
`tests/ingestArgs.test.ts` and the integration tests: `after_move` for
`after_video`; a regex key accepted; the metadata run not simulating;
`channel` dropped; the link key the bare id (the case-only pair collides);
the old cleanup regex (fails at `en`; `fr` passes, by accident, as
measured); the caption case removed (fails at `fr`: the format-id group can
no longer take it); the language's hyphenated part removed (fails at
`en-orig`); a cancel without cleanup; a second fetch not waiting for the
first (the supersede case's order check — the first version of that test,
asserting only on the files left, passed with this mutation and was
tightened).

Review's mutations (2026-10-06; same procedure, 26 in all, every one failing
its own case, all five source files hashed identical afterwards): the
event-gap rule removed (in the parser, and `breakAfter` ignored by
`segmentIntoSentences`); the merge's lone-punctuation glue removed; uncovered
ASR words assigned to the nearest line as before, or kept but not emitted;
each of the merge's three breaks removed (the uploader's line gap, a line
against an uncaptioned stretch, the ASR's own segment ends inside one); the
merge's `approximate` never set; `shiftTranscript` dropping `approximate`;
the no-line merge returning the ASR un-keyed; a lone track's line spread past
the next line; equal gaps split at the front (now asserted as bars: every
piece 10–30 words, every word once — a correct balanced split passes); the
merge's confidence 0 and the clock alignment removed, again; `channel`
dropped from the subset (the template is now asserted by shape and
membership, and `view_count` added to it correctly passes); the caption
fetch's staging folder kept on success, not removed on a cancel or a failure,
stale ones not swept or live ones swept; no time bound, or a timeout reported
as a cancel; `abortAll` a no-op; a second ask not waiting; the old
`removePartials` regex (the `ingestDownload` case still fails at `en`); and
the whole of `meta.ts` as it was before review, against the new reload-cache
case — a failed or cancelled fetch deleted the cached tracks.

**Unmeasured**:

- YouTube's ASR word timing against faster-whisper (§15 row 13's first half):
  no Whisper here.
- Whether the estimated pauses are real pauses; a per-script grapheme time.
- Track keys for a `zh-Hans` or `pt-BR` video (only `en`, `en-US`, `hi` and
  `te` were measured); a video whose `language` is null (none of the eight).
- A caption `.part` on disk (the cleanup handles one; none was seen).
- The Windows yt-dlp with these flags. CI runs the fake.
- yt-dlp's fallback to another subtitle format when a site has no json3 (read
  from its source, not run): whatever it writes lands in the run's staging
  folder and goes with it, so nothing unreadable is kept either way.
- The time bounds (60 s for the metadata, 120 s for the captions) are wide
  margins over the measured 1.5–3.5 s runs; no real stall was observed.
- A partially captioned video, for the merge's kept stretches.
- The heatmap on low-view videos: 4 of 8 had none, view counts not recorded.

## 41. The exact cut — does its first frame equal the source's? (2026-10-06)

Measured for `docs/CLIPS.md` §16.13 (§7.1, §15 row 14; M0's exit, §3b.9)
on the development Mac with **yt-dlp 2026.08.19** (pip, Python 3.14.6 — the
copy on PATH, which `ensureYtDlp` finds here: `FORGE_YTDLP` unset, no managed
copy) and **our bundled ffmpeg** (`@ffmpeg-installer/darwin-arm64` 4.1.5,
build `92718-g092cb17983`, reporting 4.4; yt-dlp's `-v` calls it
`ffmpeg 4.4 (setts)`), against public YouTube videos, **named by id only**;
nothing downloaded is kept or committed. Every yt-dlp command line came from
the app's own builder — `buildYtDlpArgs` and `outputStem`, bundled with
esbuild into a driver — for the request Clip it sends, `{kind: 'video',
quality: '1080p', range, exact}`. `XDG_CACHE_HOME` pointed at a temp folder
(the sandbox cannot write yt-dlp's cache). **The 2018 Windows build was not
run here**; the test ran it in CI the next day (below: green, run
37571739663).

**The formats measured**, as the app's selector picks them. The runs did not
log them (only `dQw4w9WgXcQ`'s `-v` run printed `137+140`), so they were
re-read on 2026-10-07 with the same builder's argv plus `--simulate --print
%(format_id)s…`: `dQw4w9WgXcQ` **137+140** (avc1.640028, 1080p25),
`aqz-KE-bpKQ` **299+140** (avc1.64002A, 1080p60), `JGwWNGJdvx8` **137+140**
(1080p; YouTube lists 24 fps, the file is 23.976), `RcGyVTAoXEU`
**248-sr+140** (VP9 1080p25 — YouTube's `-sr` "super resolution" stream),
`NCe4xZxczz4` **136+140** (avc1.4D401F, 720p; listed 30, the file 29.97);
140 is the mp4a.40.2 AAC. **yt-dlp ran without a JavaScript challenge
solver**: every `dQw4w9WgXcQ` run (13 of them, and again on 2026-10-07)
warned `Signature solving failed` and `n challenge solving failed: Some
formats may be missing` (yt-dlp's EJS wiki); the other four videos' runs
wrote nothing to stderr. So a re-measurement — another yt-dlp, a solver
installed, another day — can land on other formats: compare the itags first.

**The command lines.** yt-dlp's, as its own `-v` printed it (that one run
appended `-v`; its file was byte-identical to the plain run's, one sha256):
`--ignore-config <url> --no-playlist --playlist-items 1 --encoding utf-8
--ffmpeg-location <bundled ffmpeg> --newline --progress --progress-template …
--progress-delta 0.2 --print @forgetitle@%(title)s --print
after_move:@forgefile@%(filepath)s --no-simulate -P <dir> -o <stem>.%(ext)s
-f bv*[vcodec!*=av01]+ba/b[vcodec!*=av01] --retries 5 --socket-timeout 30
-S res:1080,vcodec:h264,acodec:m4a --merge-output-format mp4
--download-sections *60.000-66.000 --force-keyframes-at-cuts`. The ffmpeg it
ran, URLs and headers elided:

- exact: `<bundled ffmpeg> -y -loglevel quiet -headers … -ss 60 -t 6 -i
  <video> -headers … -ss 60 -t 6 -i <audio> -map 0:0 -map 1:0 -f mp4
  file:<stem>.mp4.part`;
- fast (`*50.000-76.000`): the same with `-ss 50 -t 26`, and **`-c copy`**.

So an exact cut is an input seek (`-ss` before `-i`, ffmpeg's accurate seek)
and a **re-encode of the whole section with ffmpeg's defaults** — there is no
`-c` at all: libx264 (core 161, crf 23, preset medium, keyint 250) and the
native AAC encoder (~130 kb/s). Not a re-encode "around the marks". The 6 s
exact cut of `dQw4w9WgXcQ` was 2.89 MB (3.72 Mb/s against the source
stream's 3.04); its padded fast cut 10.7 MB.

`-loglevel quiet`, because the app's argv `--print`s and `--print` implies
`--quiet`: **a failed cut reports only `ffmpeg exited with code 1`**, ffmpeg's
own reason never reaching the job's error (seen once in this work, below).

**How it was read.** The reference is each video's full download through the
same builder with no range (a `-c copy` merge, both streams `start_time
0.000`), decoded from 0 s with no seek. Reference and cut were decoded alike
by the bundled ffmpeg: video to 160×90 grey (`scale=…:flags=area`),
`-vsync passthrough`, each frame labelled with `showinfo`'s pts — edit lists
honoured, as the app's renders read a file; audio to mono f32 at its own
44.1 kHz. A cut's frame is matched by Pearson correlation over the 14,400
pixels against every reference frame from 6 s before the start to 12 s after
it, and then the cut's first second, frame for frame, against every
alignment. A cut's sound: 400 ms from file t = 0 (and for a fast cut from
t = 10 s) against every lag of the reference within ±1.5 s, by FFT; the second
peak given is the best more than 2 ms from the first.

**The exact cut** (`--force-keyframes-at-cuts`). None of these starts is a
keyframe (the nearest: 57.04 and 61.88 s on `dQw4w9WgXcQ`, 59.10, 60.47 and
62.20 s on `aqz-KE-bpKQ`), and only 60.000 is a whole second.

| video | fps, codec | asked (s) | first frame is source (s) | at file t (s) | corr; the runner-up's | first second aligned; one frame off | sound at file 0 is source (corr; 2nd peak) |
|---|---|---|---|---|---|---|---|
| `dQw4w9WgXcQ` | 25, H.264 | 60.000 | **60.000** | 0.000 | 0.999988; 0.989312 | 0.999972; 0.9787 | **60.00000** (0.9886; 0.34) |
| `dQw4w9WgXcQ` | 25 | 61.400 | **61.400** | 0.000 | 0.999948; 0.991610 | 0.999931; 0.9556 | **61.40000** (0.9935; 0.38) |
| `dQw4w9WgXcQ` | 25 | 61.370 | 61.400 | 0.040 (belongs at 0.030) | 0.999948; 0.991610 | 0.999931; 0.9556 | **61.37000** (0.9958; 0.38) |
| `dQw4w9WgXcQ` | 25 | 61.390 | 61.400 | 0.000 (belongs at 0.010) | 0.999948; 0.991610 | 0.999931; 0.9556 | **61.39000** (0.9965; 0.38) |
| `aqz-KE-bpKQ` | 60, H.264 | 60.000 | **60.000** | 0.000 | 0.999965; 0.995602 | 0.999952; 0.9776 | **60.00000** (0.9995; 0.86) |
| `aqz-KE-bpKQ` | 60 | 61.370 | 61.3833 | 0.0160 (belongs at 0.0133) | 0.999907; 0.994185 | 0.999905; 0.9883 | **61.37000** (0.9987; 0.55) |
| `JGwWNGJdvx8` | 23.976, H.264 | 61.370 | 61.3947 | 0.041 (belongs at 0.0247) | 0.999992; 0.956609 (61.6449, six frames on: both neighbours scored lower) | 0.999950; 0.7801 | **61.37000** (0.9983; 0.61) |
| `RcGyVTAoXEU` | 25, **VP9** | 60.000 | **60.000** | 0.000 | 0.999957; 0.999414 | 0.999947; 0.9992 | **60.00000** (0.9991; 0.47) |
| `NCe4xZxczz4` | 29.97, H.264 720p | 61.370 | not pinned: a still slide, every frame within ±0.5 s at corr 1.000 | 0.033 | — | — | **61.37000** (0.9999; 0.50) |

- **A start on the source's frame grid: the exact cut's first frame IS the
  source's frame at that instant** — on three videos (`dQw4w9WgXcQ` at 60.0
  and 61.4 s, `aqz-KE-bpKQ`, `RcGyVTAoXEU`; 25 and 60 fps, H.264 and VP9) —
  and unambiguously: 0.99995–0.99999 against 0.9893–0.9994 for the runner-up,
  a neighbouring frame on all four cuts (the one before on `dQw4w9WgXcQ` at
  60.0 and on `RcGyVTAoXEU`, the one after on the other two), the first
  second aligned at 0.99993–0.99997 against 0.9556–0.9992 one frame off. The
  re-encode costs 0.00001–0.00005 of correlation; one frame off costs
  0.0006–0.011. The fourth video, `JGwWNGJdvx8` (23.976 fps), was cut only
  between frames (next bullet).
- **A start between frames: the first frame is the next source frame** (the
  first at or after the start — the accurate seek drops what is before it).
  The encoder rounds its time to the nearer tick of a frame clock that starts
  at the requested instant, and **the muxer writes that offset as an EMPTY
  EDIT in the movie's 1 ms timescale**, rounded down: 10 ms late at 61.37 s
  and 10 ms early at 61.39 s (25 fps: a 40 ms tick, so an edit of 40 ms or
  none), 2.7 ms late at 60 fps (0.0160156 s — an edit of 16 ms, not 1/60),
  16.3 ms late at 23.976 fps (0.041, not 0.0417) — always inside half a frame
  of where it belongs against the sound, **but only through the edit list**.
  Dumped (`elst`, by box) on the fixture's 12.41 s exact cut (the test,
  below): video `[33 ms empty; 2000 ms from media time 1024/15360]`, audio
  `[2000 ms from media time 1024/48000]` — first frame 0.0330078 s, the 33 ms
  edit, not 1/30.
- **Every exact cut carries small edit lists**, on the grid too: the video's
  media time is x264's two-frame composition delay (1024/15360 at 30 fps,
  512/15360 at 60, on the fixture's cuts), the audio's the AAC encoder's
  1024-sample priming. A reader that ignores edit lists — the Mac ffmpeg with
  `-ignore_editlist 1`, on the fixture's 12.4 and 12.41 s exact cuts — shows
  the first frame at 0.0667 s on both (the delay, and the empty edit lost)
  and the sound 1024 samples late (1024 more samples decoded, the content
  shifted by exactly 1024: 21.3 ms at 48 kHz). So picture and sound depend
  on the reader honouring `elst` at the scale of milliseconds, not seconds.
- **The sound starts at the requested instant, to the sample**, on all nine:
  0.00 ms at 44.1 kHz (22.7 µs a sample); the AAC encoder's priming is hidden
  by the edit list ffmpeg writes. So on the frame grid sound and picture begin
  at the same instant; between frames the picture is off by the rounding above
  and by nothing else — as read by a demuxer that honours both edit lists.
- A VP9 source comes out H.264 (it is re-encoded); the fast cut keeps VP9 in
  mp4.

**The fast cut** (`PAD_MS` either side, `-c copy`):

| video | asked (s) | first packet (pre-roll) | first frame SHOWN is source (s) | file t = 10.000 s is source (s) | sound at file 0; at 10 s |
|---|---|---|---|---|---|
| `dQw4w9WgXcQ` 25 fps | 60 | −1.200 s (key 48.80) | **50.000** | **60.000** (corr 1.000000; the first second 1.000000 against 0.9787) | 50.00000; **60.00000** |
| `dQw4w9WgXcQ` | 61.4 | −0.280 s (51.12) | **51.400** | **61.400** | 51.40000; **61.40000** |
| `dQw4w9WgXcQ` | 61.39 | −0.280 s | 51.400, at 0 (10 ms early) | 61.400 | 51.39000; **61.39000** |
| `dQw4w9WgXcQ` | 61.37 | −0.280 s | 51.400, at 0 (30 ms early) | 61.400 | 51.37000; **61.37000** |
| `aqz-KE-bpKQ` 60 fps | 60 | −1.933 s (48.0667) | **50.000** | **60.000** | 50.00000; **60.00000** |
| `RcGyVTAoXEU` 25 fps VP9 | 60 | −3.960 s | **50.000** | **60.000** | 50.00000; **60.00000** |
| `JGwWNGJdvx8` 23.976 fps | 61.37 | −2.461 s | 51.3847, at 0 (14.7 ms early) | 61.3947, at 10.010 | 51.37000; **61.37000** |
| `NCe4xZxczz4` 29.97 fps | 61.37 | −3.337 s | (a still) | (a still) | 51.37000; **61.37000** |

- **The `PAD_MS` head holds on four videos** (23.976, 25 and 60 fps; H.264
  and VP9): the requested start is at file t = 10.000 s, frame for frame
  (corr 1.000000) on the three cut on the frame grid (`dQw4w9WgXcQ`,
  `aqz-KE-bpKQ`, `RcGyVTAoXEU`), and within a frame on the fourth
  (`JGwWNGJdvx8`, cut only at 61.37 s: its next frame, 61.3947, at 10.010 s);
  sample for sample on all four — what `offsetIntoDownload` assumes, and
  what §7.1 had measured on one.
- The file carries the GOP before the padded start — 0.28 to 3.96 s of it
  here — as packets before t = 0 that only the **edit list** hides; ffmpeg
  honours it (these are ffmpeg's decodes). The first frame shown is the first
  at or after the padded start, put at t = 0: **up to a frame early** against
  the sound when the start falls between frames (30 ms of 40 at 61.37 s on a
  25 fps source), never late.
- The frames are the source's own bits (corr 1.000000). The sound at t = 0
  decodes a little differently from the source (corr 0.955–0.9998: AAC
  packets copied from mid-stream) and is the source's from the next packet on
  (1.000000 at 10 s).

**Without `--force-keyframes-at-cuts`** — the exact argv with that one flag
filtered out, so `*60.000-66.000` unpadded and `-c copy` — on `dQw4w9WgXcQ`:
60–66 s, first packet −2.96 s (the keyframe at 57.04), **first frame shown
60.000** (corr 1.000000), sound 60.00000 (corr 1.0), 3.50 MB in 7.2 s against
the re-encode's 2.89 MB in 7.5 s; 61.37 s, first packet −4.36 s, first frame
shown 61.400 at t = 0 (30 ms early), sound 61.37000. **So on our Mac ffmpeg
the flag is not what makes the first frame right — the edit list does that
for a copy too.** What it buys: a file whose first packet is a keyframe at
t = 0, with no SECONDS of pre-roll (3–4 s otherwise, which any player that
ignores edit lists shows); and a start between frames placed within half a
frame, not up to a whole one early. What it does NOT buy is a file free of
edit lists: the exact cut still carries small ones (above — the two-frame
composition delay, the 1024-sample priming, and between frames an empty edit
in whole milliseconds), so how the 2018 demuxer and Chromium treat `elst`
still matters, at the scale of milliseconds rather than seconds. What it
costs: one generation at crf 23. The test pins the first two, and reads the
second through the bundled ffmpeg — on Windows, the 2018 demuxer's reading
of that empty edit.

**Time**, one run each, network-bound (this Mac and connection; not a
benchmark): an exact 6 s cut 4.9–31.8 s (1080p25 7.5–9.6 s over six runs;
1080p60 30.3 and 4.9 s; 1080p23.976 31.8 s; 720p29.97 16.3 s), a padded fast
one 14.9–21.8 s.

**A link to a plain video file cannot be downloaded with the app's argv**
(found building the test; not changed here). yt-dlp's generic extractor gives
a direct link one format with **no vcodec** — measured on a `file://` URL with
`--enable-file-urls`, which takes the same Content-Type branch as http — and
the app's `-f bv*[vcodec!*=av01]+ba/b[vcodec!*=av01]` drops a format whose
vcodec is unknown: `Requested format is not available`. With
`[vcodec!*=?av01]` (the `?` lets an unknown through) the same link selects its
format. An html5 page whose `<source>` names its codecs is no better: yt-dlp
overwrites the parsed vcodec with None (`_parse_html5_media_entries`,
`f.update(formats[0])`), measured as the same error. `format.ts` keeps AV1 out
on purpose (the 2018 build cannot decode it, and an unknown codec could be
AV1), so whether to let an unknown through is a decision, not a fix. The test
therefore hands yt-dlp a format table.

**The test**, `tests/integration/exactCut.int.test.ts` (CLIPS.md §7.7), into
`tests/output/exact-cut/`:

- The fixture is made in the test: 384×64, twelve bars of 32 px, bar b white
  when bit b of the frame's index is set, lossless (libx264 `-qp 0`), 30 s at
  30 and at 60 fps, keyframes every 2 s and nowhere else (`-keyint_min`,
  `-sc_threshold 0`: without them x264 put keyframes at frames 48, 96, 128 …
  at 30 fps and 64, 128, 192 … at 60, measured by the mutations below); and
  an AAC m4a, a 2 kHz-a-second chirp
  restarting every second from a base of 200–600 Hz that names the second
  (five-second cycle), found in the source by FFT correlation within ±2.45 s.
- The download is `downloadMedia` — the app's argv, `--ffmpeg-location` the
  bundled binary — with `--load-info-json` in front: a video-only and an
  audio-only format, as YouTube's extractor gives them, so FFmpegFD runs the
  same two-input `-ss … -i … -ss … -i …` (the link in the argv is ignored with
  a warning). Two legs: the streams as `file:<path>` URLs (a bare path is
  refused: yt-dlp asks urllib for its cookies, "unknown url type"; a
  `file://` URL reaches ffmpeg %-encoded, and on a path with a space — this
  checkout's — failed `ffmpeg exited with code 1`), and the same streams over
  node:http on 127.0.0.1, port 0, with Range.
- Each leg: exact 12.4 s → the first frame is 372 and the first 60 run on
  from it, the sound at file 0 is source 12.4 s within 1 ms, the first video
  packet is at t ≥ 0 and a keyframe; fast 12.4 s → the first frame is
  372 − `offsetIntoDownload`·fps, the clip's in-point by
  `trimToRequestedRange` shows 372, the sound there is 12.4 s; exact 12.41 s →
  373, within half a frame of its place, the sound 12.41 s; exact at 60 fps →
  744. And the fixture itself, both sources: every frame reads back its
  index, and the keyframes are every two seconds (60 frames at 30 fps, 120 at
  60) — the cut checks pass whether or not 12.4 s is a keyframe, so only this
  check sees it.
- **Which binary reads what.** The bundled ffmpeg — the 2018 build on
  Windows — makes the fixture and every cut, and reads back the frame
  indices, the 12.41 s cut's first-frame time (`showinfo`'s pts_time with
  `-copyts`: the demuxer's own reading of the empty edit) and the sound (so
  the audio's priming edit too: ignored, it would be 21.3 ms late against a
  1 ms tolerance). Only the first video packet (t ≥ 0, a keyframe) goes
  through `@ffprobe-installer`'s ffprobe, which is another build everywhere —
  n4.4.1 on this Mac (package 5.0.1), package 5.1.0 on win32-x64 — so in CI
  that one check is a newer demuxer's reading, not the 2018 one's. The
  README names both binaries by their `-version` line. (Until 2026-10-07 the
  first-frame time was ffprobe's too; on the Mac the two agree, 0.0330078
  and 0.033008.)
- **On the Mac** (file leg; the http leg skipped, listen EPERM): exact 12.4 →
  372 … 431, sound 12.40000 s (corr 0.9915), first packet 0 s, a keyframe;
  fast (`*2.400-24.400`) → first frame 72, first packet −0.4 s, in-point 300
  → 372, sound at 10 s 12.40000 (corr 1.0000); exact 12.41 → 373 at file
  0.0330078 s, the 33 ms empty edit (belongs at 0.0233: 9.7 ms late, as on
  YouTube), sound 12.41000; 60 fps → 744, sound 12.40000.
- **How it decides.** yt-dlp is `ensureYtDlp()` with a temp userData
  (FORGE_YTDLP, a managed copy, PATH, or fetched from GitHub against its
  published checksums); the http leg needs the port. Without either, the leg
  is skipped and says why on stderr — **except under CI (`CI` set), where it
  fails with the reason**: this file is the 2018 build's only measurement
  under a section cut. The setup hook allows 600 s, above `ensureYtDlp`'s
  worst case (about 420 s: three 15 s `--version` checks while locating,
  then 60 s for the checksums, 300 s for the binary and 15 s to run it), so a
  slow fetch reaches `need()`'s reason rather than a bare "Hook timed out".
- **Mutations**, in a copy of the tree (`section.ts` restored and `cmp`
  identical after each; each anchor counted to one match): the exact section
  a second late (`stamp(start + 1000)`) — all three exact cases fail, on the
  index (402, 403, 804) and on the sound (13.4 s); the fast section a second
  late — the fast case (102, in-point 402, sound 13.4 s);
  `--force-keyframes-at-cuts` dropped — the first packet at −0.4 s fails, and
  12.41 s lands at file 0 s, 23.3 ms early, past half a frame (the first frame
  is still 372: the edit list, as on YouTube); `offsetIntoDownload` a second
  short — in-point 270 shows 342, sound 11.4 s; scene-cut keyframes let back
  into the fixture — the keyframe check. **Re-run 2026-10-07**, after the
  first-frame time moved to the bundled ffmpeg and the fixture check to both
  sources (same copy-of-the-tree method, every anchor one match, restored
  and `cmp`-identical): the exact section a second late — 402, 403, 804,
  sound 13.4 and 13.41 s; the flag dropped — first packet −0.4 s, and
  `showinfo` puts 12.41 s's first frame at 0 s, 23.3 ms from its place
  against a limit of 17.7; scene-cut keyframes in the 30 fps source alone —
  its check fails (0, 48, 96, 128 …), the other five pass; in the 60 fps
  source alone — its check fails (0, 64, 128, 192 …), the other five pass.
  **The first version of the sound
  check used a chirp the same every second, and it PASSED "a second late"**:
  it found 12.4 s in 13.4 s's identical second. The base frequency now names
  the second.
- **A second suite run on the same checkout breaks the first**: its
  `outputDir` empties `tests/output/exact-cut/`, media included, under a run
  in progress, which then fails with `ffmpeg exited with code 1` (`-loglevel
  quiet`, above). Seen once, with another session's suite in the same minute;
  rerun alone, it passed.

**Unmeasured**:

- **The 2018 Windows build — now measured, 2026-10-07.** CI run
  37571739663 on `d458cb0` ran `exactCut.int.test.ts` on the 2018 build
  (`win32-x64` 4.1.0, `20181217-f22fcd4`), both legs, since under CI it
  fails rather than skips: green. The exact and the fast cut hold there as
  they do on the Mac, and so does §16.13 on Windows. (Listed here because it
  was unmeasured when the section was written; it is the first 2018-build
  run of a yt-dlp section cut.)
- The http leg: the sandbox will not bind a port. Its transport (ffmpeg
  reading over Range) is what YouTube's cuts did above, over https.
- **Whether that leg's ffmpeg sends a Range past byte 0 at all.** The
  fixture's seeks are short — `video30.mp4` is 46,801 bytes with its 12 s
  keyframe at byte 21,731 (within the file's first 32 KB), `video60.mp4`
  89,893 at 41,170, `audio.m4a` 271,910 with 12.39 s at 115,293 — and whether
  ffmpeg's http reader crosses a short gap by reading on or by a new ranged
  request is its short-seek threshold, which could not be measured here. So
  the README records the count of ranged requests and nothing asserts it: a
  server that ignored Range could still pass the leg. CI's first run says
  which; assert it only once that number is known on each platform.
- The Windows yt-dlp (whichever release `ensureYtDlp` fetches in CI) and the
  `file:D:/…` form of the file leg.
- The app's preview — Chromium's `<video>` — on a fast cut's edit list and
  pre-roll, or on an exact cut's small ones (the composition delay, the
  priming, an empty edit).
- A real player that ignores edit lists, on the exact cut. Measured only as
  ffmpeg's `-ignore_editlist 1` on the fixture (above: the first frame at
  0.0667 s, the sound 1024 samples late).
- A VFR source; streams that start at different times in the source; HLS or
  segmented DASH formats (all five videos were plain https streams).
- The exact cut's time at 4K and over long ranges.
- The 29.97 fps talk's picture (a still slide at the start).

## 42. The caption bake's timing — a 40 ms grid, and an export cut at the last caption (2026-10-07)

Found by `tests/integration/clipIt.int.test.ts` (CLIPS.md §3b.8), on the
development Mac with the bundled ffmpeg (4.1.5 package, reporting 4.4). The
test exports a Clip it clip through both caption routes and reads every frame:
the picture names its own source frame, and the bake's pictures are stand-ins
that spell which word is lit, so each caption change is located to the frame.
The bake's plan, list and overlay are the app's (`buildGraphicsSpec` →
`planCaptionBake` → `concatList`, main's `writeCaptionFrame` /
`writeCaptionList`, `captionOverlay` in `buildRenderPlan`); only the canvas
painter is stood in for.

**The bake's pictures start on a 40 ms grid, not on frames.** The concat
input's stream is the first PNG's, read by image2 at its default 25 fps: `25
fps, 25 tbr, 25 tbn` (`-f concat -safe 0 -i captions.txt`, the exact cut's
list). So every picture's start is rounded to the nearest 1/25 s, whatever
`duration` the list gives it; the list's six-decimal durations (`0.033333`)
sum a little short, so a start that falls half-way lands early. `showinfo` on
that list: the starts 0, 0.0333, 0.0667, 0.1 … 0.5 s arrive at ticks 0, 1, 2,
2, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 12 (0.5 s → 0.48), 2.3 s → 2.28. After
the overlay's `fps=30`, two of ten words lit a frame EARLY on both cuts — w32
at export frame 14 for 15, w35 at 68 for 69 — the other eight on their frame;
libass, timed by the frame's own pts, put all ten on their frame. Derived, not
measured: a start moves at most 20 ms, so at most one frame early or late at
30 or 60 fps and none at 24 or 25. And an animated look's one-frame pictures
(the kinetic preset's pop) share ticks — three pairs in the first sixteen
above — so one of each pair never reaches the export: the arrival animation
plays resampled to 25 pictures a second. Not fixed here; the test allows the
one frame it is told to allow.

**The bake ends the export at its last caption.** `bakeCaptions` plans the
pictures up to `buildGraphicsSpec`'s `durationFrames` — the last caption
line's end, not the edit's — and the overlay is `shortest=1`, which ends the
OUTPUT when the caption input ends (plan.ts's comment says a short bake can
"neither extend the video nor truncate it"; it truncates it). A 30-frame clip
whose one caption covers frames 0–7 exported 8 frames through the bake (seven
planned, plus the list's repeated last entry); the same plan with
`eof_action=pass` in place of `shortest=1` exported 30. A Clip it run ends on
its last word, so it shows only when a run under a second is stretched to
`MIN_RANGE_MS` — but any edit whose talking stops before its picture does
loses the rest with a styled caption look. The render check's one-word leg
reads libass only until this is fixed (an `it.todo` marks it).

**Unmeasured**: the 2018 Windows build on either (image2's 25 fps default
and the overlay's `shortest` both predate it, so the same is expected; the
test's exact and fast bake legs run there in CI).

## 43. The caption bake covers the edit — §42's truncation, fixed and measured (2026-10-07)

The fix for the second half of §42, chosen by measuring both candidates on the
render. Development Mac, the bundled ffmpeg (4.1.5 package, reporting 4.4).
The render check is `tests/integration/captionBakeLength.int.test.ts`. It uses
the app's path around one stand-in (`buildGraphicsSpec` → `planBakeOf`, the
step `bakeCaptions` takes, which plans `spec.durationFrames` → `concatList`,
main's `writeCaptionFrame` / `writeCaptionList`, `captionOverlay` through
`buildRenderPlan`). Its fixture is a 30-frame clip of flat grey (320×240,
30 fps) captioned in "kinetic", with one word at 0–250 ms, so the caption
covers timeline frames 0–7. The pictures are stand-ins: the band is
transparent except for a white block. Each export is decoded whole
(`-vsync 0`) and read at the block: white means the caption, grey the
picture, black the base canvas where the clip went missing.

**Today's code, reproduced.** The plain case exported **10 of 30** frames,
with the block on frames 0–9: the caption's 8 planned frames, plus the 2 frames
the list's repeated last entry holds. That entry keeps its picture for one
1/25 s tick of its own (`showinfo`: an entry listed at 0.266667 s starts at
0.28 s, and `fps=30` emits two frames from it), which lands on 1 or 2 output
frames at 30 fps depending on where the tick falls. Measured, one caption
`[0, N)` baked over N frames (the old length) under the 30-frame clip, through
the render: N = 5 → 6 frames, 6 → 7, 7 → 8, **8 → 10**, 9 → 10, 10 → 11,
11 → 12. The same single run plus its repeat, through `fps=30` alone with no
overlay: 6, 7, 8, 10, 11, 11, 12 (N = 9 differs, 11 against 10). So §42's 8 of
30 fits a caption of seven planned frames plus one, and this check's 10 of 30
is eight plus two. That §42's clip had seven is derived from this table, not
re-run (its check is another file's). A marked
range of 4–20 exported **6 of 16**. A range of 10–30, which starts after the
last caption, made ffmpeg **exit 0** and write a 0.67 s file that is **audio
only, with no video stream at all**. A range of 2–6 is unaffected, because it
ends inside the caption.

**The two options, each measured on the render** (frames exported / export
frames showing the caption; the plan's `durationFrames` in brackets):

| case | today | (a) bake to the edit's end | (b) `eof_action=pass` |
| --- | --- | --- | --- |
| caption 0–7, clip 30 [30] | 10 / 0–9 | **30 / 0–7** | 30 / 0–9 |
| a 60-frame bake over the 30 [30] | 30 / 0–7 | 30 / 0–7 | 30 / 0–7 |
| range 2–6, ends before the caption does [4] | 4 / 0–3 | 4 / 0–3 | 4 / 0–3 |
| range 4–20, ends after it [16] | 6 / 0–5 | **16 / 0–3** | 16 / 0–5 |
| range 10–30, starts after it [20] | no video stream | **20 / none** | 20 / none |
| no captions [30] | 30 | 30 | 30 |
| 24 fps, caption 0–5, clip 24 [24] | 7 / 0–6 | **24 / 0–5** | 24 / 0–6 |
| 25 fps, caption 0–5, clip 25 [25] | 7 / 0–6 | **25 / 0–5** | 25 / 0–6 |

Option (b) puts `eof_action=pass` in place of `shortest=1` (one match,
asserted before the swap) and leaves the plan as it is.

- **Both give the plan's length in every case.** Only (a) also gives the
  caption's own frames. Under (b) the repeated last entry's tick shows on
  frames that should be bare: the caption stays up **2 frames past its end at
  30 fps and 1 frame at 24 or 25 fps**. Under `shortest=1` that tail had been
  the last frames of a truncated export. Under `eof_action=pass` it falls on
  the picture. Under (a) the closing run is the blank (or a run that reaches
  the edit's end), so the tail falls after the video, where `shortest=1`
  drops it.
- **A longer bake does not extend the video under `shortest=1` or
  `eof_action=pass`**, and `-t` is not what holds it there. With the output
  `-t` raised to 10 s, a 60-frame bake over the 30-frame video still gave 30
  frames with either. That is those two settings, not the overlay in general:
  with NEITHER (the default, `eof_action=repeat`) the same render gave **61 of
  30** frames under `-t 10`, the caption still on 0–7, because the overlay ran
  on to the bake's end. With the plan's own `-t` (1 s) it gave 30, so without
  `shortest=1` only the output `-t` would hold the length. Keep `shortest=1`.
  (Removing `-t` entirely is not a test. A project with no audio has an
  endless `anullsrc`, and the render never stops.)
- **(a) is the smaller change and leaves the graph as it was.** It is one
  expression: `buildGraphicsSpec`'s `durationFrames` is now
  `max(projectDuration(project), every line's end)` instead of the last
  line's end. `bakeCaptions` passes `spec.durationFrames` as before. Nothing
  more is drawn, because the frames after the last line are the blank, which
  is always picture 0. The list gains one run.

**Chosen: (a)**, in `buildGraphicsSpec` rather than in `bakeCaptions`, for
three reasons. A render check can run it, while `bakeCaptions` needs a DOM
canvas. The tier-2 compositor (not routed, kept for a future DOM layer)
composites `durationFrames` frames with `shortest=1` too, so it had the same
truncation and gets the same fix. Measured: `compositeGraphics` with
`durationFrames` 8 over a 1 s, 30-frame grey video wrote **8** frames, and
with 30 it wrote 30. And `tests/tier2.test.ts` had a test,
"runs to the last word, not the whole timeline", that pinned the bug; it now
asserts the edit's end, including a music outro on an audio track. It is the
fifth test found in this project asserting the behaviour it should have
caught.

**The step from spec to plan is shared, so the check runs the app's.** As
first written, the check copied `bakeCaptions`' call,
`planCaptionBake(layers, fps, spec.durationFrames)`, into its own `bake()`.
`bakeCaptions` is the one routed caller and no test runs it (it needs a DOM
canvas, and `stripsRender.test` mocks it to null). So a review mutant that
planned to the last line's end in `bakeCaptions` itself passed every test.
The step is now `planBakeOf(spec)` in `src/shared/captions/bake.ts`: the
caption lines, and their plan over `spec.durationFrames` at `spec.fps`.
`bakeCaptions` and the check both call it. `tests/captionBake.test.ts` tests
it, and also reads `captionBake.ts` to check that its one `planBakeOf` call
takes the `spec` as built and that it calls `planCaptionBake` nowhere.
`clipIt.int` still has its own copy (another agent's file at the time; it can
adopt `planBakeOf`).

**A marked range.** `ExportStrip` bakes the whole `exported` project, and
`buildRenderPlan` runs its graph from 0 to `range.end` on the edit's own clock
and trims the front last. The bake is planned to `projectDuration` (the
`fullFrames` the plan starts from, and never less than `range.end`), so it
always reaches the graph's end, and its frames are the graph's frames. That is
measured, not only argued: range 4–20 shows the caption on export frames 0–3,
which are timeline 4–7. A bake sized to the EXPORT (`range.end -
range.start`) would be right only when no range is marked. Run as a mutant in
the check, it exported 3 of 4, 13 of 16 and 12 of 20.

**An edit that ends off a tick.** Every 30 fps case above ends on a 1/25 s
tick (30 frames is 1.000 s), and so does captionOverlay.int (40 frames at
10 fps is 4.0 s). The check has one case that does not: the same word over a
61-frame clip at 60 fps, 1.0167 s, the caption on frames 0–14. `showinfo` on
its list: the repeated last entry starts at **1.00 s**, rounded DOWN from the
durations' sum. So the bake reaches the video's last frame only because that
entry holds its own 40 ms tick. On this build the export was **61 of 61**
frames, with the block on 0–13. The blank's start of 0.25 s landed on the
0.24 s tick, one frame early, which is inside the check's slack. Under the old
length the case exported 17 of 61.

**Mutations**, each run to a file and restored byte-identical (`cmp`). They
were re-run after `planBakeOf` and the off-tick case went in:
- The old length back in `buildGraphicsSpec`: 5 failures (10 of 30, 6 of 16,
  0 of 20, 17 of 61, and the unit test's 99 for 120).
- `planBakeOf` planning to the last line's end: 6 failures (10 of 30, 6 of 16,
  0 of 20, 17 of 61, the longer bake's 8 not more than 30, and the unit test's
  60 for 120).
- `bakeCaptions` planning for itself with `planCaptionBake(layers, fps,
  <last line's end>)` (the review's mutant), or calling
  `planBakeOf({ ...spec, durationFrames: <last line's end> })`: the source
  check failed on each, and the render checks passed, as expected for a
  function no test runs.
- The bake sized to the export rather than the edit, at the check's `bake()`
  call: there is no range in the bake's own code to mutate. All three range
  cases failed (3 of 4, 13 of 16, 12 of 20), and the un-ranged cases passed.
- Option (b) in place of (a), i.e. the old length plus `eof_action=pass`: the
  lengths passed. The caption showed after its end on timeline frame 9 in the
  plain case and in range 4–20, and on frame 16 at 60 fps.

**Windows (dated, not run).** No new filter or option. The graph is the one
Windows CI already runs (captionOverlay.int: a 40-frame bake over 40 frames),
and `shortest` predates the 2018-12-17 floor. Under (a) the caption input
never ends before the video does. Its repeated last entry starts within 20 ms
of the edit's end, rounded to the nearest 1/25 s, and holds a 40 ms tick, so
on this build it ends at least 20 ms after the video. The EOF that ends the
overlay is therefore the main input's. Three things are dated, not run: what
the 2018 build does at the caption input's own EOF (a short bake under
`shortest=1`, or `eof_action=pass`, which merged in 2016); whether it rounds
and holds that last entry the same way; and whether its `fps` filter flushes
the same frames at EOF. The render check runs in Windows CI on the next push,
including the off-tick 60 fps case, so CI measures the case that depends on
that last tick and not only the tick-aligned ones.

**Still open: §42's 40 ms grid.** Thirty one-frame pictures alternating at
30 fps came out as 31 frames, with frames 2, 8, 14, 20 and 26 wrong: two
entries share a tick and one is dropped, one in six. This fix does not touch
the grid. The check allows one frame at each edge of the caption for it. On
this build the 30 fps caption landed exactly, and the 60 fps one ended one
frame early.

## 44. The caption bake's 40 ms grid — the list on its own clock, scaled in the overlay (2026-10-07)

The fix for the first half of §42, chosen by measuring every candidate on the
render. Development Mac, the bundled ffmpeg (4.1.5 package, reporting 4.4).
The render check is `tests/integration/captionBakeTiming.int.test.ts`. It uses
the app's path around two stand-ins (`buildGraphicsSpec` → `planBakeOf` →
`concatList`, main's `writeCaptionFrame` / `writeCaptionList`,
`captionOverlay` through `buildRenderPlan`). The first stand-in is the spec's
lines: the one real "kinetic" line `buildGraphicsSpec` builds, copied onto the
frames each fixture needs. The second is the painting: each picture is a
band-sized PNG whose white blocks spell its line's number in eight bits, so
every frame of the export says which picture it shows. There are two fixtures.
**one-frame** is a kinetic line per frame for one second, to the edit's last
frame, so bit 0 alternates on every frame. **held** is two seconds of still
lines (the copy without its animation) held 1–7 frames, some abutting and some
with blank gaps, then 7 blank frames. What each frame should show is worked
out from the lines, not from the plan under test. Each export is decoded whole
(`-vsync passthrough`).

**Today's code, reproduced** (frames showing another frame's picture; every
export had the plan's length):

| fixture | 24 | 25 | 29.97 | 30 | 50 | 60 |
| --- | --- | --- | --- | --- | --- | --- |
| one-frame | 0 of 24 | 0 of 25 | 5 of 30 | **5 of 30** | 25 of 50 | 35 of 60 |
| held | 0 of 55 | 0 of 57 | 6 of 67 | 6 of 67 | 27 of 107 | 34 of 127 |

At 30 fps the one-frame wrong frames are 2, 8, 14, 20 and 26, each showing the
NEXT frame's picture, and that frame's own picture never appears. That is
§42's "one in six". At 29.97 it is 3, 9, 15, 21 and 27, each showing the
PREVIOUS frame's picture. At 50 every other picture never appears, and at 60
35 of 60 are wrong. (§42 counted 31 frames for thirty such pictures; through
the render after §43, every export here has the plan's length.) Ten-second
held edits, run through the scratch harness below, gave 0 of 247 wrong at 24
fps, 15 of 307 at 29.97 and 167 of 607 at 60.

**Why, read in the source.** `libavformat/concatdec.c` at the Windows build's
commit (f22fcd4, 2018-12-17) has three relevant lines, and 4.4 has the same
three. Every file is opened with no options:
`avformat_open_input(&cat->avf, file->url, NULL, NULL)`. The stream's time
base is copied from the first file (`copy_stream_props`). Each entry's start
is rescaled into the CURRENT file's time base with `av_rescale_q`, which rounds
to the nearest tick (`delta = av_rescale_q(start_time - file_inpoint,
AV_TIME_BASE_Q, <file's time base>)`). A PNG is read by image2's pipe
demuxer, whose `framerate` defaults to "25" (img2dec.c at f22fcd4). So every
start is rounded to 1/25 s, and nothing the list or the command line says can
reach the PNG reader on the 2018 build. The per-file `option` directive that
could reach it is 0210c8fee2 (2021-08-22), after both builds.

**The candidates, each on both fixtures at every rate** (frames wrong, and
the export's length where it was short). They were measured with a scratch
harness that runs the same path and fixtures, with each candidate patched onto
the argv `buildRenderPlan` built or onto the list. Its "today" row agrees with
the committed check frame for frame, and so does its row for the app's own
fixed path, which is all zeros. 50 fps joined the check afterwards (the table
above).

| candidate | one-frame 24 / 25 / 29.97 / 30 / 60 | held 24 / 25 / 29.97 / 30 / 60 |
| --- | --- | --- |
| today: list in project seconds, `fps=` | 0 / 0 / 5 / 5 / 35 | 0 / 0 / 6 / 6 / 34 |
| (a) `-framerate <fps>` before `-f concat` | ffmpeg exits: "Option framerate not found." | same |
| (a) `-r <fps>` before `-f concat` | 0 / 0 / 0 / 0 / 0 | **26 of 55 / 26 of 57 / 31 of 67 / 31 of 67 / 56 of 127 frames**, 52 / 54 / 64 / 64 / 122 wrong |
| (b) `settb=1/<fps>` before `fps` | 0 / 0 / 5 / 5 / 35 | 0 / 0 / 6 / 6 / 34 |
| (b) `settb=AVTB,setpts=PTS-STARTPTS` before `fps` | 0 / 0 / 5 / 5 / 35 | 0 / 0 / 6 / 6 / 34 |
| (c) `duration 1/30` | concat exits: "Line 2: invalid duration '1/30'" | same |
| (c) nine decimals, `0.033333333` | 0 / 0 / 5 / 5 / 35 | 0 / 0 / 6 / 6 / 34 |
| (d) list on the 1/25 s clock, `-itsscale 25/<fps>` | 11 / 0 / 15 / 15 / 45 | 11 / 0 / 15 / 15 / 49 |
| (d) list on the 1/25 s clock, `setpts=PTS*25/<fps>` | 11 / 0 / 15 / 15 / 45 | 11 / 0 / 15 / 15 / 49 |
| **(d) list on the 1/25 s clock, `settb=AVTB,setpts=PTS*25/<fps>`** | **0 / 0 / 0 / 0 / 0** | **0 / 0 / 0 / 0 / 0** |
| (d) list on the 1/25 s clock, `fps=25,settb=AVTB,setpts=N/(<fps>*TB)` | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |

- **(a) `-framerate` is fatal.** ffmpeg hands it only to a demuxer with its own
  `framerate` option, and concat has none.
- **(a) `-r` makes every decoded picture ONE frame**, stamped at the next
  1/fps whatever its duration. That is right only when every run is one frame.
  A held caption collapses to one frame, and `shortest=1` then cuts the export
  short (26 of 55 frames).
- **(b) cannot undo the rounding.** By the time any filter sees the pictures,
  two entries already share a tick, and nothing downstream can tell them
  apart.
- **(c) the list cannot say it.** `duration` is `av_parse_time` (concatdec.c
  line 422 at f22fcd4), which takes no fractions. More decimals change
  nothing, because the rounding is to 1/25 s, not to the microsecond.
- **(d) the bake's own clock.** The list gives each FRAME of the bake one 1/25 s
  tick: `duration` is `run.frames / 25`, a multiple of 0.04 that six decimals
  write exactly. So frame N of the bake starts at tick N with nothing to
  round. `showinfo` on a 60-frame list read entries at pts 0, 1, 2 … 60
  (1/25 time base, the 61st the repeated last entry). The overlay scales that
  clock to the project's: `setpts=PTS*25/<fps>` puts frame N at N/fps. It needs
  `settb=AVTB` first. Without it `setpts` computes in 1/25 s units and
  truncates (`D2TS` is an `(int64_t)` cast), which is the "15 of 30" row above.
  `-itsscale` truncates the same way, in ffmpeg.c. After the chain the
  60-frame list gave 61 frames at 30 fps, the 61st (the repeat) at 2.000 s.

**Chosen: (d) with `settb=AVTB,setpts=PTS*25/<fps>`**, the smaller of the two
exact chains. The `N/(fps*TB)` one also needs an `fps=25` first. The change is
one constant (`CONCAT_RATE = 25` in `src/shared/captions/bake.ts`) read by both
sides. `concatList(plan, fileFor)` writes `run.frames / CONCAT_RATE` and no
longer takes a rate, because the list is the same at every rate. The overlay's
chain in `buildRenderPlan` is now
`[N:v]settb=AVTB,setpts=PTS*25/<fps>,fps=<fps>,format=rgba[cap]`. The renderer
paints exactly what it painted before, so the preview, which draws from the
same spec, is untouched. The libass route is untouched.

**Measured after the fix:** the check above at 24, 25, 29.97, 30, 50 and 60
fps, both fixtures: **every frame its own picture, every export the plan's
length**. Ten-second held edits at 24, 29.97 and 60 fps: 0 of 247, 0 of 307,
0 of 607. `clipIt.int`'s bake legs went from w32 and w35 a frame early to
**+0 for all ten words on both the exact and the fast cut**, and the one-word
leg is +0 too. So the bake is now held to its word's own frame there. libass,
which measured +0 as well, keeps its one frame, because its reading is a glyph
threshold. `captionBakeLength.int` keeps every length (30 of 30, 30, 4, 16, 20,
61 of 61, 30). Its 60 fps caption now ends on its frame, with the block on 0–14
(it was 0–13), and its one frame of slack at each edge is gone. That slack
hid a whole-frame shift: with every picture one frame late (mutant below),
the old slack passed 8 of 8 tests.

**The tail.** The repeated last entry now starts at tick T, the edit's end on
the bake's clock, and holds its own one tick. On this build (the Mac's) the
overlay turns that tick into one frame, so the tail lands exactly one frame
past the video's last frame at every rate: measured at 24, 25, 29.97, 30, 50
and 60 fps, at pts T/fps each time. It no longer depends on where a 40 ms tick
happens to fall (§43's off-tick case, 61 frames at 60 fps, used to reach the
end only by that 40 ms). On the 2018 build the tail can be no frames or
several. That is read in the source, not run; see the floor paragraph below.
Either way it falls past the edit, and `shortest=1` drops it, as before.

**The 2018 floor.** Everything in the chain merged long before 2018-12-17, and
all of it is in the f22fcd4 source:
- `settb` is 214c0d420b, 2010-10-11, with `AVTB` in that first commit.
- `setpts` is a532bb390f, 2010-11-02, with `PTS`, `N` and `TB` in it.
- `fps` is 54c5dd89e3, 2012-05-18.
- The list uses only `file` and `duration`, from the keywords concatdec.c
  parses at f22fcd4: duration, exact_stream_id, ffconcat, file,
  file_packet_metadata, inpoint, outpoint and stream.

One behaviour differs between the builds, read in the source and not run:
- **`setpts` and `settb` became `activate` filters after the floor**:
  2a546fb7d5 (2019-10-02) and 7df808ea84 (2019-10-23). On the 2018 build both
  are `filter_frame` filters. The end-of-stream time on their output is
  `guess_status_pts`: the input link's last timestamp, rescaled by time base
  only. So on Windows `setpts` passes the END on unscaled, at (T+1)/25 s rather
  than (T+1)/fps. At 24 fps that is before the last picture once T > 24. The
  4.4 build runs the EOF time through the expression too.
- **Why that cannot move a frame of the edit.** `vf_fps.c` at f22fcd4 reads the
  input's status only while it holds fewer than two frames
  (`if (s->frames_count < 2) { ... ff_inlink_acknowledge_status ... }`). It
  holds the last run and the repeat until it has written the last run out to
  the repeat's time, T. So frames 0 to T−1 are written before the EOF time is
  seen. That time decides only how many copies of the repeat follow, past the
  edit. `fps` converts it to output frames with its default rounding, to the
  nearest (`update_eof_pts`, `round=near`, `eof_action=round`), and writes
  copies while its next frame is before it. That gives round((T+1)·fps/25) − T
  copies, or none when that is not positive. So the count is none at 24 fps
  once T ≥ 12 (and one copy below that; the EOF is before the repeat's own
  start only once T > 24, but the rounding drops the copy sooner). It is one
  at 25 fps, as on this build, and more than one at 30 and 60 (about T/5 + 1
  and 1.4T + 2). The overlay never reads that time
  anyway: `framesync_inject_status` (framesync.c at f22fcd4) replaces it with
  the last frame's time plus one tick.
- **Emulated here.** The caption stream was cut to exactly the edit's frames
  (`trim=end_frame=T` after `fps`), which is what the 2018 build's `fps` emits
  at 24 fps once T ≥ 12 (every edit here is longer). Result: 0 wrong frames and the plan's length at every rate, on
  both fixtures, and on the ten-second edits.

**Dated, not run:** the 2018 build itself. `captionBakeTiming.int`
(including 24 fps, where that EOF arrives earliest), the tightened
`captionBakeLength.int` (with its off-tick 60 fps case) and `clipIt.int`'s bake
at +0 all run in Windows CI on the next push.
`tests/oldestFfmpeg.test.ts` has the bake as a shape. At its one site it
asserts the filters and their order, with the expressions left out: a `settb=`
step, then exactly one `setpts=` step, then `fps=30`. It also asserts the
overlay's `shortest=1`, and that nothing comes before `-f concat`. Its first
version pinned `settb=AVTB,setpts=PTS*25/30`. That form would have rejected the
other exact chain in the table, and it failed a harmless one-microsecond
mutant (below). Whether a chain puts each picture on its frame is left to
`captionBakeTiming.int`, which caught every real mutant on its own.

**Mutations**, each run to a file and restored byte-identical (`cmp`, all ten
changed files). Every run below used the ten-case timing check from before 50
fps joined it, except the fix-reverted re-run, the first with all twelve
cases. The counts are of that check, and the shape test is as first written,
with its expressions pinned. Its relaxed form was mutation-checked afterwards
(after this list).
- **The fix reverted** (bake.ts and plan.ts as HEAD, the tests' calls back to
  the old signature): 11 failures, run before 50 fps joined the check. They
  are the six 29.97/30/60 timing cases (30 fps: frames 2, 8, 14, 20, 26), the
  off-tick 60 fps edge (frame 14 grey), `clipIt.int` exact and fast (w32 at 14
  for 15, w35 at 68 for 69, now outside the bake's 0), the list unit test (25
  ticks for a 30-frame run) and the shape's order check. Re-run on the timing
  check once 50 fps was in it: 8 failures, the two 50 fps cases among them.
- **`settb=AVTB` removed**: 15 failures, including 24 fps (11 of 24 wrong) and
  captionBakeLength's 30 fps cases (frame 7 grey, and 60 of 61 frames at 60).
- **The scale removed** (list on ticks, chain back to `fps=` only): 15
  failures, with every caption held past its end.
- **`CONCAT_RATE` 30** (both sides move together): 15 failures. The list unit
  test fails, because it checks against the demuxer's 25 rather than the
  constant. So do all ten timing cases of the time, 24 and 25 fps included.
- **The list in seconds at 30 fps** under the new chain (scaled twice): 19
  failures, with exports cut short (26 of 30, 107 of 127).
- **Every picture one frame late** (`+1/(fps*TB)` on the setpts): 17
  failures. A first try, `(PTS+1)`, moved each picture by one MICROSECOND
  after `settb=AVTB`. It passed every render check, as it should. Only the
  shape's order check failed, in its pinned form. That is why the check was
  relaxed.

**The relaxed shape check, mutation-checked** (`oldestFfmpeg.test.ts` alone,
each run to a file, then restored byte-identical with `cmp`):
- These fail it, and each is a real bug:
  - the fix reverted, which leaves no `setpts`;
  - `settb=AVTB` removed;
  - the scale removed (`fps=` only);
  - `setpts` before `settb`, failed on order. On the render this is
    `captionBakeTiming.int`'s 10 of 13 failing, at every rate but 25, where
    the scale is 1;
  - the scale applied twice, as a second `setpts=PTS*25/<fps>`. This one
    fails `captionBakeTiming.int` too, 10 of 13. The "once" would also reject
    a harmless no-op `setpts=PTS` added beside the scale. That is the one
    place the check is stricter than the render.
- These pass it:
  - the other exact chain, `fps=25,settb=AVTB,setpts=N/(<fps>*TB)`.
    `captionBakeTiming.int` passes it too, 13 of 13, so the committed check
    agrees with the harness's row above;
  - the one-microsecond `(PTS+1)*25/<fps>`;
  - `CONCAT_RATE` 30. The shape check no longer catches this one, but the
    list unit test still does (1 of 21 failing). So did all ten timing
    cases, in the `CONCAT_RATE` 30 run in the list above.

**Still open:** CLIPS.md (§3b, near line 1111) still describes the bake's
w32 and w35 as −1. That is another agent's file, so it is left for them.

## 45. A held key lands on its own frame — the half-frame boundary (2026-10-07)

Measured for `docs/CLIPS.md` §3.2 on the development Mac's bundled ffmpeg
(the 4.1.5 package, reporting 4.4), through the real `buildRenderPlan`. The
render check is the new block in `tests/integration/keyframes.int.test.ts`
(artefacts and every frame's mean in `tests/output/held-keys/`): a white
64×48 still over the black canvas, opacity keyed `[{0, 0, hold}, {K, 1}]`,
12 frames, decoded whole (`-vsync passthrough`, grey).

**Today's code, reproduced.** Each boundary was `lt(t, (frame/fps).toFixed(4))`.
The first lit frame of each export:

| fps | key 4 | key 5 | key 8 |
|---|---|---|---|
| 24 | **5** | 5 | 8 |
| 25 | 4 | 5 | 8 |
| 30 | 4 | **6** | **9** |

The rounding is UP that makes a key late, so which frames it hits depends on
the rate, counted over frames 1 to fps: at 30 fps every frame ≡ 2 (mod 3)
(5/30 = 0.16666… written 0.1667), at 24 and 60 fps every frame ≡ 1 (mod 3)
(4/24 is the same 0.16666…), at 25 and 50 none. The plan named only the
30 fps family; the 24 fps row at frame 4 is new, and is in the check.

**The fix.** A picture's segment ends half a frame before its key,
`lt(t, (start + (frame − 0.5)/fps).toFixed(6))`, in `keyframeExpression`
(`src/shared/render/keyframes.ts`), the opening boundary included. Frame
f − 1 is half a frame under it and frame f half a frame over, at any rate.
After it, all nine rows light on their key, and the frame before stays at 0
(mean 0.0 before, 253.0 at the key, at every rate).

- **The eased control.** The same check renders a linear 0 → 0.5 → 1 rise
  over frames 0–8 and a smooth fall to 0 at 11, at 30 fps, and holds every
  frame to `valueAt` within 0.05. Means before the fix: 0, 24, 50, 76, 100,
  126, 168, 210, **252**, 187, 65, 0; after: the same but **253** at frame 8.
  Frame 8 is the key on a frame ≡ 2 (mod 3): the old boundary (0.2667) still
  put it in the 5 → 8 segment, whose start is written 0.1667, so p was
  0.99967 and alpha 254.96 rather than 255. Every other frame is unchanged,
  as the plan said: where a segment does not hold, both sides give the key's
  own value at the key.
- **Still in four places: a segment's start and span.** Inside a segment, `p`
  divides by `span.toFixed(4)` from `t0.toFixed(4)`. At 60 fps the frame
  at a key at 8 (start 0.1333 for 0.13333…) evaluates 0.99933 for 1, a
  fifth of one alpha level. Left; `tests/keyframes.test.ts` holds the
  preview and the expression to 0.005 at every frame and says why.
- **The sound keeps the key's own instant.** The volume envelope compiles
  through the same function, but `volume`'s `t` runs between video frames:
  it evaluates once per audio frame, at that frame's start. Measured with a
  scratch render through the plan (a 440 Hz tone at half scale under a grey
  still, the envelope held 0 → 1, first decoded sample over 0.05), at 24, 25,
  30 and 60 fps with keys at 4, 5, 8 and 20: every step lands on a multiple
  of 2048 samples, the first at or after the key, 2.0 to 37.3 ms after it
  (30 fps key 4: key at sample 6400, sound at 8192). On the half frame,
  three of the sixteen came in BEFORE their key: 30 fps keys 4 and 8 at
  −5.33 and −10.67 ms, 60 fps key 8 at −5.33 ms. So `ExpressionOptions`
  gained `boundary: 'frame' | 'instant'`; the envelope passes `'instant'`,
  which writes exactly the old `time(frame).toFixed(4)`, and its sixteen
  measurements came back identical to today's, expressions included.
  That scratch measurement was deleted, and review found the choice guarded
  only by a unit test reading the expression: dropping `'instant'` passed
  every rendered volume check (audioSurface, split, audioFade,
  volumeEnvelope). So `tests/integration/volumeEnvelope.int.test.ts` now
  renders it — a tone on a1, held 0 → 1 at 30 fps keys 4 and 8, decoded as
  48 kHz mono, the first sample over a quarter of peak at or after the key
  and under 2048 samples past it: key 4 at sample 8192 for 6400
  (+37.33 ms), key 8 at 14336 for 12800 (+32.00 ms). The loudest sample
  before the step is 7% of peak (AAC's pre-echo). The 2048 is the wav
  demuxer's packet, 4096 bytes of 16-bit mono: `MAX_SIZE` in
  `libavformat/wavdec.c` at f22fcd4 (:622, :700), the `max_size` option's
  default at n4.4 — read at both, run on the Mac; Windows CI runs the check.
- **The text pins.** `tests/keyframes.test.ts` asserted
  `toContain('2.0000)')` for "the last segment ends at t=2"; that anchor also
  matched the last key's VALUE, `,2.0000)`, and still passed with the fix in.
  It is now a step check: for a held key on every frame from 1 to 2 × fps at
  24, 25, 30, 50 and 60 fps, the frame before evaluates the old value and the
  frame at it the new, with `t` formed as ffmpeg forms it (`n × (1/fps)`).
  "Agrees with valueAt" sampled every third frame from 0 — at 30 fps exactly
  the frames ≡ 0 (mod 3), never the late ones; it now takes every frame at
  24, 25, 30 and 60 fps, with keys at 4, 5 and 8 among them.
  `tests/maskKeyframes.test.ts` pinned `if(lt(T,0.0000)`; it now asserts `T`
  is the variable, and the clip's own time is left to
  `maskKeyframes.int`'s rendered "runs on the clip's own time".
- **Mutations** (each run to a file, restored byte-identical with `cmp`, each
  anchor counted to one match):
  - the boundary back to `(frame/fps).toFixed(4)`: 7 failures — the render
    check's 30 fps key 5 (first lit **6**), key 8 (**9**) and 24 fps key 4
    (**5**); the step check (24 fps, frame 1), "agrees with valueAt" (24 fps
    frame 4), the instant test's picture half, and the plan test's opacity;
  - the envelope's `boundary: 'instant'` dropped: the plan test fails (the
    envelope a quarter frame before its key reads 1, not 0), and so do both
    held-volume renders in `volumeEnvelope.int` — key 4 in at 6144
    (−5.33 ms), key 8 at 12288 (−10.67 ms), before their keys.
- **The 2018 build.** Nothing new is emitted: `lt`, `if` and decimal
  constants, the same eval as before. The render check runs in Windows CI on
  the next push.

## 46. Zoom keys on footage — zoompan meets one frame per frame, at the project rate (2026-10-07)

Measured for `docs/CLIPS.md` §3.4 on the development Mac's bundled ffmpeg
(4.1.5 package, reporting 4.4), through the real `buildRenderPlan`. The render
check is `tests/integration/zoomVideo.int.test.ts` (artefacts, frames 0 / mid
/ last of each export as PNGs and a README in `tests/output/zoom-video/`).
Fixtures: 320×180, each frame's own index drawn as ten 16 px bars across the
middle half (`geq` on `N`), grey round them. **60 fps for 3 s** and **29.97
fps (30000/1001) for 20 s**, each H.264 with a 440 Hz AAC track, and a
moment's drawn frames (numbered PNGs from 0, 30 fps, 2 s, `MediaAsset.frames`).
A 30 fps project, the clip from 0 for the whole source, zoom keyed
1 → 1.5 linearly over the clip. Each export is held to the same clip exported
WITHOUT keys: frame count, the streams' start and duration (@ffprobe-installer's
ffprobe), the source index each frame shows (read through the zoom), and
frames 0 / mid / last against the unzoomed frame put through zoompan's own
window (below).

**Today's code, reproduced** (`d=${clip.duration}`): every export had the
plan's length and the unzoomed clip's stream times, and every one showed
source frame **0** from its first frame to its last — 60 fps frame 1 showed 0
for 2, 29.97 frame 1 showed 0 for 1, and the moment's frames froze the same
way (it is the same filter, and the Keys tab offers Zoom on any clip with an
asset). Frames mid / last against the unzoomed: 127.5 / 127.5 mean levels
(60 fps), 127.4 / 127.5 (29.97), in the check's first version (a centred
window; the modelled one is below).

**What zoompan does, read at the Windows build's commit** (`f22fcd4483`,
`libavfilter/vf_zoompan.c`, fetched from GitHub; the plan's line numbers
agree): the output time base is `av_inv_q(s->framerate)` (:133); each frame
it writes is stamped `pts = s->frame_count` and the count incremented
(:158, :225–226), whatever the input's time; `on` is
`outlink->frame_count_in` (:170, :278); `d` is evaluated once per input
frame into `nb_frames` (:300), the frames written from it; and at the end
`ff_outlink_set_status(outlink, status, pts)` (:310) forwards the input's EOF
pts in the INPUT's time base. The chain alone on the fixtures (`-vf`, no
plan), frames and seconds out:

| chain | 60 fps, 3 s (180 frames) | 29.97 fps, 20 s (600 frames, 20.02 s) |
|---|---|---|
| `zoompan=…:d=1:…:fps=30` | 180 over 6.000 s — **half speed** | 600 over 20.000 s |
| `fps=30,zoompan=…` | 90 over 3.000 s | 601 over 20.033 s |
| `zoompan=…,fps=30` (the plan's trailing `fps=`) | **46,080 over 1,536 s** | **600,600 over 20,020 s** |
| `fps=30,zoompan=…,fps=30` | 90 over 3.000 s | 601 over 20.033 s |

The third row is the EOF pts: 3 s in the mp4's 1/15360 time base is 46,080,
read as 1/30 s, and the trailing `fps=` fills to it (the plan's 30,720 over
1,024 s is the same 512× for a 2 s source). In the export none of these
lengths survives: the clip's stream is gated by the overlay
(`enable=between(t,…)`, `eof_action=pass`) and the canvas decides the length,
so frame counts and stream times match the unzoomed export under every form
below. What the forms change is WHICH source frame is on screen.

**The fix.** For an input that brings its own frames (`asset.kind ===
'video'`, or `asset.frames`), `zoomKeyframeFilter` emits
`fps=${fps},zoompan=…:d=1:…:fps=${fps}`; a photograph keeps `d=<length>`
(`src/shared/render/plan.ts`, the new `moving` argument at the one call site).
After it, all three exports: every frame shows the unzoomed export's source
frame (60 fps: 2k at frame k; 29.97: k, then k − 1 from frame 500, where
`fps=` repeats 499), the plan's length, video and audio from 0 for 3 / 20 s
as unzoomed, and frames 0 / mid / last against the unzoomed through zoompan's
window: 0.01 / 0.49 / 0.40 (60 fps), 0.07 / 0.55 / 0.27 (29.97), 0.05 / 0.27
/ 0.30 (moment), in mean levels; one bar of another index is 22 at 1× and 33
at 1.5×, so the check's bar is 3.

- **zoompan's window is not the centred one.** `w = in->width * (1.0 /
  zoom)` truncates, x is clipped and truncated, then `x &= ~((1 <<
  log2_chroma_w) - 1)` (:176, :183, the same for y at :189) rounds it DOWN to
  the chroma grid. On yuv420p footage at 1.5× that is x = 52 for a centred
  53.3, and the bars landed 2–3 px right of a centred model (first check's
  last frame: 18.3 levels off; edges at 42 … 283 for a predicted 40 … 280).
  Modelled, it is 0.40. The moment's PNGs arrive as RGB, and zoompan's format
  list (the same at f22fcd4 and n4.4) has planar RGB with no grid: there the
  centred x fitted (0.30, against 7.87 with the grid). Which format a build
  negotiates is not read, so the check takes whichever grid fits and the
  README says which.
- **A freeze frame** (`Clip.hold`) with zoom keys on the 60 fps fixture,
  scratch render through the plan: 60 frames, the first bar edge moving
  80 → 48 over 50 frames as the zoom predicts. The hold's `tpad` runs at the
  source rate; the leading `fps=` brings it to 30.
- **Mutations** (each run to a file, restored byte-identical with `cmp`,
  each anchor counted to one):
  - `d` back to the clip's length for footage: 4 failures — all three
    exports frozen on source frame 0 from frame 1, and the floor test's
    `d=1`;
  - the leading `fps=` dropped (`d=1` alone): 3 failures — 60 fps frame 1
    shows 1 for 2 (**half speed**), 29.97 frame **500** shows 500 for 499
    (ahead of its sound from there), and the floor test's order; the
    moment's 30 fps frames PASS, which is why a same-rate fixture is never
    the only one;
  - the predicate back to `asset.kind === 'video'`: the moment fails alone
    (frozen, 0 for 1).
- **The floor.** `tests/oldestFfmpeg.test.ts` has the shape ("zoom keys on a
  video clip, at speed 1") in `SHAPES`, scanned by the blocklist, and asserts
  at its one zoompan an `fps=30` before it and `d=1` on it — membership and
  order, not the expression. zoompan merged in 2013 and fps in 2012; the
  restamping above is the f22fcd4 source. **Dated, not run:** the render check
  runs in Windows CI on the next push, and is the 2018 measurement.
- **Not covered.** A clip at another speed already had `setpts,fps=` in front
  of the zoom; the leading `fps=` is then a second one at the same rate.
  `motionFilter`'s camera moves still use `d=<length>`, and are offered on
  photographs only (`canMoveCamera`).

## 47. The graph goes in a file — `-filter_complex_script`, and the limit a timeline of cuts meets today (2026-10-07)

For `docs/CLIPS.md` §3.7. Development Mac, the bundled ffmpeg (4.1.5 package,
reporting 4.4); the 2018 build read in its source and left to Windows CI.

**The limit.** Windows' `CreateProcess` takes a command line of at most
32,767 characters, and `buildRenderPlan` put the whole filtergraph in one
argument. Lengths through the real plan, a 1080×1920 30 fps export of one
talk (`C:\Users\someone\Videos\Podcast episode 41 (full).mp4`), counted as
Windows would build the line (each argument plus a space, quotes round any
with a space, the installed `ffmpeg.exe` path first;
`tests/fixtures/longGraph.ts`). Each piece is 75 frames; how far apart the
pieces start in the source changes the `-ss` digits on the inputs, so the
lines depend on it a little (the graph does not):

| pieces of the talk on V1 | source frames apart | graph | command line today | with the graph in a file |
|---|---|---|---|---|
| 54 | 750 | 27,450 | 32,453 | 5,066 |
| **55** | 750 | 27,962 | **33,052** | 5,153 |
| 72 | 750 | 36,666 | 43,235 | 6,632 |
| 360 | 150 | 188,930 | 220,378 | 31,511 |
| **380** | 142 | 199,530 | 232,703 | **33,236** |

The first three are the unit test's spacing (`tests/graphFile.test.ts`, 25 s
apart); 360 and 380 are spread evenly over the 30-minute talk (54,000 ÷
pieces, rounded down), since 750 apart would run past its end. At 750, 360
pieces are 220,555 / 31,688 and 380 are 232,895 / 33,428; spread evenly,
the first count past the limit is 375 (32,805). Re-measured in review.

Each piece is an input and a chain: about 512 characters of graph and 87 of
inputs (`-ss … -t … -i <path>`) at this path. So **an export of 55 pieces
of one talk cannot start on Windows today** — not only the plan's followed
clip: any timeline of cuts, as transcript cutting and Clip it make. On the
Mac (ARG_MAX about a megabyte) every row runs. **Measured in Windows CI the
same day** (run 37668502747): the 72-cut command line was refused with
`spawn ENAMETOOLONG`, errno -4064, thrown by `spawn` itself before any
promise exists — which is why the first version of the check, catching only
a rejection, went red there — while the script route rendered. With the graph in a file the
ceiling moves to about 370 pieces at this path length, where the inputs
alone reach the limit; one input per asset rather than per clip would lift
that, and is not built.

**The plan's 360-cut followed clip cannot render at all, on either build** —
measured in §48. Its graph would be long, but it is refused by ffmpeg's
expression parser long before its length matters, so the render check here
is a timeline of cuts, the graph that reaches the limit today.

**The option.** `-filter_complex_script <file>` is ffmpeg 2.0 (2013,
Changelog). At the Windows build's commit `f22fcd4483`
(`fftools/ffmpeg_opt.c`, fetched from GitHub): the option table has it
(:3478), and `opt_filter_complex_script` (:3109) reads the file whole with
`read_file` (:1569: `avio_open`, a NUL appended) into the same `graph_desc`
that `opt_filter_complex` fills from its argument (`av_strdup`), with the
same `input_stream_potentially_available = 1`. So the graph is parsed exactly
as the argument was. The path is an option value opened by `avio_open`,
whose protocol lookup treats a drive letter as a file path, not text inside
the graph, so neither the drive-letter colon nor the escaping table applies.
Measured on the Mac: a script under a folder named `Jürgen's tmp; [x]=y`
(non-ASCII, a quote and every graph metacharacter) renders; a trailing
newline in the script renders; a missing script fails before any input
opens, "Error opening file …". The newer spelling of the same thing,
`-/filter_complex <file>`, is 7.0 (2024) and is never emitted.

**The fix.** `src/shared/render/graphFile.ts`: `withGraphFile(args, file)`
swaps the one `-filter_complex <graph>` pair for `-filter_complex_script
<file>`, counted with `filter` (it throws on none or two), keeping every
other argument in order; `filterGraphOf(args)` returns the graph;
`commandLine(binary, args, platform)` quotes an argv for pasting.
`buildRenderPlan` is unchanged and still emits `-filter_complex`, so the test
files that read it need nothing: at HEAD 19 files under `tests/` name
`-filter_complex` (the plan said 22; counted, not assumed), 14 of them in the
exact `args.indexOf('-filter_complex')` form, and the two this change edits
(`maskKeyframes.test.ts` for §45, `oldestFfmpeg.test.ts` for §46 and here)
are not edited at the read. `src/main/render/renderJob.ts` writes
the graph (UTF-8, `graph-<uuid>.txt`, synchronously, because the queue needs
its handle at once) to `RenderOptions.tempDir` — `userData/tmp`, beside the
captions' `.ass`, set in `ipc.ts`; the system temp folder otherwise — and
spawns the swapped argv. A finished or cancelled export removes the script.
**A failed one keeps it** and logs the pasteable command, with the script's
path where the graph was (`console.error`, `[forge] export failed — its
graph is in …`); before this nothing reported the command at all, though
`run.ts` says the argv is complete so that it can be pasted.

- **A failed export keeps its captions too.** Review found the kept command
  could not run as logged: for an export with libass captions the graph
  names `captions-<uuid>.ass` in `subtitles=`, and the queue listener in
  `ipc.ts` removed that file on every finish, failed included. It now asks
  `releasesTemporaries(status)` (`renderJob.ts`): done or cancelled, the
  `.ass` goes; failed, it stays beside the script. And what failed exports
  keep no longer piles up: `registerIpc` starts `sweepTemporaries` on
  `userData/tmp` at launch, which removes `graph-<uuid>.txt` and
  `captions-<uuid>.ass` older than a week and nothing else (the folder is
  shared with `graphics/tier2.ts`'s base pass). The baked-caption route's
  concat list lives in `caption-bake/` and is replaced by the next bake;
  that is unchanged. Tested in `tests/graphFile.test.ts`; the one line in
  `ipc.ts` that calls the predicate is not (nothing here drives
  `registerIpc`).

**Measured after it.** `tests/integration/longGraph.int.test.ts` (into
`tests/output/long-graph/`): a 30 s source whose frames carry their index as
ten bars, cut into 72 pieces of 3 frames, 12 source frames apart, with AAC.
The plan's graph is **35,107** characters and its line **41,894** here. Run
through `startRender` itself (the export job, its temporaries in the check's
folder): 216 frames, every one the source frame its piece should show, and no
script left behind. The same plan spawned with the graph on the line: on the
Mac it renders, and **all 216 decoded frames are identical** to the script
route's (the md5 of each frame's luma plane, decoded to grey — not the
files); on Windows the check asserts it is refused (the Windows run is the
measurement; the error it records is not known here). Rendered in 2.2 s.

- **Today's code against the new checks.** With `renderJob.ts` as at HEAD:
  the export-job unit tests fail (the graph on the command line, no script
  kept on failure). `longGraph.int` as first written PASSED on the Mac — its
  "no script left behind" is empty whether a script was removed or never
  written. Review added a read of the folder the moment `startRender` hands
  back the job (the script is written synchronously, before the spawn):
  exactly one `graph-<uuid>.txt`, holding the plan's graph. Against HEAD's
  `renderJob.ts` that now fails on the Mac ("expected [] to have a length
  of 1"). It still cannot see the spawn itself — the swap skipped, or the
  spawn handed `plan.args`, both still write the file and render here — so
  that half remains Windows CI's to measure.
- **Mutations** (each run to a file, restored byte-identical with `cmp`, each
  anchor counted to one):
  - the swap skipped (`withGraphFile` returns the argv): 5 unit failures —
    the pair test, the 72-cut test (43,235 not under 30,000), all three
    export-job tests — and the floor test's spawned-argv scan;
  - the spawn given `plan.args` (the file still written): the three export-job
    tests;
  - the script removed on failure too: "keeps the script when the export
    fails";
  - the count replaced by `indexOf`: "refuses an argv with no graph, or with
    two";
  - the option spelled `-/filter_complex`: the floor test, at its count of
    `-filter_complex_script` (0), one line BEFORE its "no `-/` option"
    check — so that check had never failed on its own. Review ran it alone:
    the script pair kept and a `-/filter_complex` added beside it fails the
    floor test at exactly that line ("-/option is ffmpeg 7.0: expected
    [ '-/filter_complex' ] to deeply equal []"), 1 failure;
  - `releasesTemporaries` true for `failed`: its test fails; the sweep
    without its age check, or without its name check: the sweep test fails
    (four removed for two).
  `longGraph.int` passes the first two on the Mac (the file is still
  written), and under them it fails on Windows, which is why it runs there.
- **The floor.** `tests/oldestFfmpeg.test.ts` now spawns every shape through
  `withGraphFile`: one `-filter_complex_script`, no `-filter_complex`, no
  `-/` option, and the script's text is the graph the blocklist scanned.
  **Dated, not run:** the 2018 build reading the script, which
  `longGraph.int` measures in Windows CI on the next push.

## 48. A keyed track of about 93 keys is refused — ffmpeg's expression parser stops at 100 levels (2026-10-07)

Found by §47's first render check, which put the plan's 360-cut followed clip
(360 held keys and 180 eased, as zoom keys on one clip) through the script
route: ffmpeg refused the graph, "Missing ')' or too many args in 'if(lt(…'",
"Failed to configure output pad on Parsed_zoompan". The same on the command
line.

**Why, read at both builds** (`libavutil/eval.c`, f22fcd4 and n4.4, fetched
from GitHub): `av_expr_parse` starts the parser with `p.stack_index=100`
(:700 at f22fcd4, :706 at n4.4), and `parse_expr` refuses when it reaches 0
(`//protect against stack overflows`, :614–616). `keyframeExpression`
compiles a track as nested `if(lt(t,…),segment,if(…))`, so every key is one
more level; and since `parse_primary` ignores what the nested `parse_expr`
returns for any function's second and third arguments (:410, :414), the
refusal surfaces as "Missing ')'". Same code at both, so the same on Windows
(read, not run).

**Measured through the plan**, a 64×36 still, keys one frame apart,
alternating values, bisected:

| track | held keys | eased (`smooth`) keys |
|---|---|---|
| zoom | renders with 97, refused at 98 | 92 / 93 |
| rotation | 98 / 99 | 93 / 94 |
| opacity | 97 / 98 | 92 / 93 |

So **today an export fails outright when one keyed track has more than about
92 keys**, and the plan's followed crop (`CLIPS.md` §4.6–4.7: a crop
`keyframeExpression` of 180 keys for ten minutes, 540 for a 30-minute talk)
cannot render on either build in that shape, whatever its length.

**A shape that parses, measured (not built):** a flat sum of steps.
`parse_subexpr` reads `+` and `-` in a loop, not by recursion, so depth does
not grow with terms. A zoom of 540 held cuts written as
`1+(0.50000)*gte(on,2)+(-0.25000)*gte(on,4)+…` (12,205 characters, through
`-filter_complex_script`, on the Mac) rendered 1080 frames with the edge of a
still at 40 / 21 / 30 px exactly where zoom 1 / 1.5 / 1.25 put it, frame 0
to 1079. An eased segment is the same kind of term, `Δ × shape(clamp((t −
t₀)/span, 0, 1))`, which is 0 before its segment and Δ after it; not run.
This is the reframe's prerequisite, and a fix for today's >92-key tracks.

## 49. Portrait phone media — the decoder turns a clip by its matrix, never a JPEG by its EXIF (2026-10-08)

For `docs/CLIPS.md` §3.1 (`BETA.md` R5). Development Mac, the bundled ffmpeg
(4.1.5 package, reporting 4.4) and `@ffprobe-installer`'s ffprobe (n4.4.1,
package 5.0.1); the 2018 Windows build read in its source at `f22fcd4483`
(fetched from GitHub) and left to Windows CI, whose ffprobe is another build
again (package 5.1.0, `20230213-2296078`).

**A clip with a display matrix.** A 640×360 H.264 clip remuxed with
`-c copy -metadata:s:v:0 rotate=90` probes `width=640, height=360`, its
`side_data_list` a Display Matrix with `rotation: 90`, its tag `rotate: 270`.
The bundled ffmpeg decodes it **360×640**: `scale=320:-2` came out 320×568,
and the decoded frame is the coded one through `transpose=cclock` exactly
(mean |difference| 0.0 on grey; 132.5 against `transpose=clock`). A 3840×2160
clip remuxed with `rotate=270` decodes 2160×3840. So the decoder turns the
picture, and the asset — which carried the coded size — disagreed with every
frame a render, a moment's pre-pass or a detector is handed.

- **Only the matrix turns it.** At `f22fcd4`, `get_rotation`
  (`fftools/cmdutils.c:2175-2192`) reads the stream's `AV_PKT_DATA_DISPLAYMATRIX`
  and nothing else, negates `av_display_rotation_get`, folds it into
  [0, 360); `configure_input_video_filter` (`fftools/ffmpeg_filter.c:801-819`)
  inserts `transpose=clock` within a degree of 90, `hflip,vflip` at 180,
  `transpose=cclock` at 270, and `rotate` (size unchanged) for any other
  angle — on every filtergraph input, so the export's `-filter_complex` inputs
  too. The `rotate` tag is the demuxer's copy of the matrix (`mov.c:4522`); a
  file with the tag and no matrix is not turned. So the probe reads the matrix
  only (`displayRotation`, `src/shared/media.ts`; the helper's
  `media.display_rotation` is the same arithmetic). The tag is *written* by the
  2018 muxer the same way (`movenc.c:2849-2863`, behind
  `FF_API_OLD_ROTATE_API`), so the check's fixtures are the same files there.
- **The round trip is not symmetric**: writing `rotate=90` reads back as a
  270° clockwise turn (side data 90, tag 270). Hence `rotation ∈ {90, 270}` in
  the tests, never one number: what matters is the swap, and the direction is
  checked on pixels.

**A JPEG with an EXIF orientation.** sharp wrote the same 640×360 picture as
JPEGs tagged 1, 3, 6 and 8. ffprobe prints no side data and 640×360 for every
one, and ffmpeg decodes every one 640×360 **unturned** — the 4.4 build ignores
EXIF orientation entirely. At `f22fcd4`, `mjpegdec.c:1928-1952` decodes the
EXIF block into the frame's metadata dictionary (`:2729`) and nothing turns a
frame by its metadata, so the 2018 build ignores it too (read, not run). The
preview's `<img>` honours it, so a portrait phone photo showed upright and
exported on its side. sharp's `rotate()` (no argument) turns it.

- **The copy is a JPEG.** A synthetic 12-megapixel photograph (4032×3024,
  noise over a fractal, 2.1 MB tagged 6): turned to PNG, **27,995,665 bytes
  in 635 ms**; to JPEG quality 95, 4:2:0, 2,525,905 bytes in 122 ms at
  41.3 dB from the PNG; to JPEG quality 95, **4:4:4, 3,521,680 bytes in
  193 ms at 47.2 dB**. ffmpeg's own decode of the untouched original, turned
  with `transpose=clock`, is 40.0 dB from sharp's — the two decoders already
  differ by more than the re-encode loses. A wedding set of 200 portrait
  photos is about 5.6 GB of PNG and 0.7 GB of JPEG. So a JPEG's turned copy is
  a 4:4:4 quality-95 JPEG; anything else tagged (a PNG with `eXIf`) becomes a
  PNG, as AVIF does (§31). Reading the tag is the header alone: 1.0 ms.
- **`-ss` before a JPEG decodes nothing.** Found writing the check: `-ss 0`,
  `-ss 0.000`, `-ss 0.001` and `-ss 0.02` before `-i photo.jpg` (the image2
  demuxer) each give "Output file is empty, nothing was encoded"; a PNG
  (`png_pipe`) gave its frame at 0, 0.000 and 0.001 and nothing at 0.02.
  The render never seeks a still (`-loop 1 -t`, `plan.ts:851`, `:879`);
  the helper's `media.decode_rgb` now never seeks when `at_ms` is 0 or
  absent, which a face pass over a photograph would otherwise have met.

**The fix.** `probeFile` (`src/main/ffmpeg/probe.ts`) takes `uprightSize`: the
sides swapped for 90 and 270, `MediaInfo.rotation` the clockwise turn, and
`MediaAsset.rotation` recorded when it is not 0 (a record of the file; nothing
in the render applies it, because ffmpeg turns the frames itself). The
import (`src/main/imports.ts`) turns any still whose EXIF orientation is 2–8
into the converted cache — `needsReadableCopy`, used by `readableStill` and
`relinkable` — so `path` is the upright copy and `source` the photo, as for
AVIF. The render's fit was never wrong (`force_original_aspect_ratio` reads
the frame that arrives); what read the coded size was the reframe:
`solveCrop`, which every dropped clip and every Director shot gets, cut a
202×360 "9:16" out of a picture it thought was landscape, from a frame that
was already 9:16.

**Measured after it** (`tests/integration/rotation.int.test.ts`, into
`tests/output/rotation/`): the probe's size equals the decoded frame's for
the untagged clip (640×360, no `rotation` on the asset), the 90° remux
(360×640) and the 4K clip tagged 270 (2160×3840); JPEGs tagged 3, 6 and 8
import as copies 640×360, 360×640 and 360×640 whose pixels are the source
through `hflip,vflip`, `transpose=clock` and `transpose=cclock` (0.19–0.20
mean levels), and the one tagged 1 is read where it is. A 540×960 export of
each portrait asset, reframed as a dropped clip is, against the upright
picture scaled to the frame:

| asset | before: crop, mean \|difference\| | after |
|---|---|---|
| the 90° clip | 202×360 at x 219, **83.73** | no crop, 0.39 |
| the 4K clip tagged 270 | 1214×2160 at x 1313, **80.27** | no crop, 0.30 |
| the EXIF-6 photo | 202×360 at x 219, **99.38** | no crop, 0.48 |

Before, the clip exported as a 202×360 band of its own upright frame blown
up to fill (the crop filter's expressions clamp it inside the 360×640 that
arrives), and the photo as a slice of itself on its side.

- **Mutations** (each run to a file, restored byte-identical with `cmp`,
  each anchor counted to one): the probe ignores the matrix (`width:
  video?.width`) — 4 failures: both probe tests ("expected { width: 640,
  height: 360 } to deeply equal { width: 360, height: 640 }") and both clip
  exports; the import ignores EXIF (`needsReadableCopy` is
  `needsConversion` alone) — 3 failures, the import, the relink and the
  photo's export; the relink alone ignores it (`relinkable` back to
  `needsConversion(file)`) — 1 failure, the relink case, which also has
  `locateAsset` remake a lost copy turned;
  `tests/integration/importAvif.int.test.ts` passes under all three. In
  `tests/mediaRotation.test.ts`: the tag read as a turn, a half turn
  swapping the sides, and the angle not negated each fail it.
- **Not measured.** The preview's `<video>` in Electron: Electron exits with
  SIGTRAP in the development sandbox, so `videoWidth` and `drawImage` of a
  rotated clip were not read here. The preview draws the element into the
  asset's size (`Preview.tsx:1356`), so a Chromium that turns the frame —
  which the plan and `BETA.md` R5 take as given — now gets the box it fills;
  R12's smoke test is where to look. Assets imported before this change keep
  their coded size until re-imported; a relink of such a tagged photo would
  now hand ffmpeg the turned copy under the old size (not handled).
  **Dated, not run:** the 2018 build's autorotate on the export's inputs and
  its muxer's `rotate` tag, which `rotation.int` measures in Windows CI.
