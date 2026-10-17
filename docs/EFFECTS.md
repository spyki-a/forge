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
*(2026-10-16: on the 2018 Windows build a slowed clip lost its last source
frame here, because that `setpts` passes its EOF on un-retimed and `fps`
drops the frame it holds; a slowing retime now starts with
`tpad=stop_mode=clone:stop=1`, `RETIME_TAIL`, §59.)*
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
  CPU path), mediapipe 1.0.1 (the test ran 0.10.35), and recall and false
  boxes against hand marks on footage with known faces. The worker's import
  and start-up time is measured since (0.14–0.23 s, §54), and so is the
  sandbox's −6 at `create_from_options` through the worker.

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
  two-up rows run it in CI with step 1.
- **Measured since, in `buildRenderPlan`'s own chain (§55): not as above.**
  There the chain's trailing `fps=` drops the clip's LAST frame after
  `vstack` (59 of 60 at 30 and 29.97 fps, the black canvas showing through),
  and the stack equals the one crop only as `vstack,tpad=stop_mode=clone:stop=1`
  — then 60 of 60, bit for bit, at 30, 29.97 and 60 fps.

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

## 50. The helper's decodes, and the floor beyond the render plan (2026-10-08)

For `docs/CLIPS.md` §3.5 and §3.6. Development Mac, the bundled ffmpeg (4.4),
through `sidecar/forge_sidecar/media.py` itself, on the helper's venv
(CPython 3.14.6).

**Streaming frames.** A 20 s 640×360 30 fps clip decoded whole through
`capture_output` (what `_decode_rgb` did with whatever it was handed) is
**414,720,000 bytes** in memory, 0.38 s. `media.iter_frames` reads one
frame of exactly w×h×3 bytes at a time from a `Popen` pipe, checks the
request's cancellation before each, and kills ffmpeg in `finally`: 50 frames
then stop, **0.089 s**, the process killed and reaped (non-zero return code).
At `fps=5`, 480×270, 20 s of 1080p: 100 frames in 0.26 s. ffmpeg's errors go
to a temporary file, not a pipe nobody reads. `media.decode_rgb` with `-ss`
before `-i` on a 1080p clip whose keyframes are 250 frames apart: 48–67 ms a
seek at 1, 7, 15 and 19 s. Moving `depth.py` and `vision.py` onto the module
changed nothing they return: for sixteen stills (the vision check's thirteen,
two JPEGs and a PNG) the size, two decodes' bytes and every measure were
byte-identical before and after (`cmp` of the captured JSON).

**`scdet` on the floor.** The Mac build has it (`scdet=threshold=10` on a red
→ blue cut: `lavfi.scd.score: 15.625`); it merged 2020-05-14 and first
shipped in 4.3 (its Changelog, read at `n4.3`), so it is on `TOO_NEW`. And `graphOf` scans only `buildRenderPlan`, so
`tests/oldestFfmpeg.test.ts` gains `ANALYSIS_SHAPES`: the chroma-key probe,
the nine encoder probes, five shapes of a moment's footage pre-pass (crop,
half speed, `minterpolate`, a ramp, a freeze), a steady clip's
`vidstabdetect` pass as main runs it, a voice-over's conversion, the
Converter's presets, and the helper's `media.frame_args` and
`media.decode_args` — asked of the helper's own interpreter, so the Python
half's ffmpeg is scanned by the same blocklist. Mutations: `scdet` in the
chroma-key probe's filter, and in the helper's frame stream — each fails its
shape. `sceneArgs` (§4.2) is an `it.todo` until `shots.ts` exists.

## 51. M0's exit on the user's ten links — what the app's own path met (2026-10-13)

For `docs/CLIPS.md` §3b.9, its first bullet: the user's ten links (ids
`O35KGzkS4VA`, `eK71EN3P78U`, `lqOH-zxtCDE`, `3pG8Hgq3Z8M`, `bvz_zK5ZxpM`,
`j4aoo1qbGoE`, `xON4Vot8j8g`, `zEqLXGE_re4`, `F7Lg2yHtqRA`, `jze_5hvaVV8`)
through `tests/integration/m0Exit.int.test.ts`, and by hand with the app's
own argv. yt-dlp 2026.08.19 with deno on PATH; the bundled ffmpeg (4.4);
`XDG_CACHE_HOME` in a temp folder; every request through the sandbox's
proxy. Ids only: no caption text, title or word of these videos is written
here.

**A dubbed video's `<l>` is a translation of a dub, and it can fail the
whole fetch.** With the app's caption argv (`--write-subs --write-auto-subs
--sub-langs en,en-orig`), on `O35KGzkS4VA` and `3pG8Hgq3Z8M`, yt-dlp exited
1 with `ERROR: Unable to download video subtitles for 'en': HTTP Error 429:
Too Many Requests` — in every full run of the exit check (four) and by hand
on 2026-10-13 — and wrote NOTHING: it writes the keys in `--sub-langs`
order and stops at the first that fails, so `en-orig` was never fetched and
Get transcript said `failed`. `requested_subtitles`' URLs say why it is
those two: their `en` is `lang=de-DE&tlang=en` and `lang=uk&tlang=en` — an
automatic translation of a dub's ASR (the `asr` translations of every audio
track share the key; yt-dlp takes the last), while `en-orig` is `lang=en`.
On the other six caption links both keys are `lang=<l>` with no `tlang`.
`lqOH-zxtCDE`'s `hi` was `lang=bn&tlang=hi` in one earlier run and `lang=hi`
on 2026-10-13: which candidate the key resolves to varies between requests.
So §40's "`<l>` comes back a byte copy of `<l>-orig`" holds only on a video
with no dubs. Two changes (`buildCaptionArgs`, `parseRequestedSubtitles`):

- `--ignore-errors`: the same two links then exit **0**, `en-orig` written
  (1,188,877 and 411,587 bytes), a `WARNING:` in place of the `ERROR:`, and
  `en` in the dict with no `filepath`. A failed extraction still exits 1
  with its `ERROR:` line (an unreachable link, with and without the flag);
  an unavailable YouTube id exits 0 with `NA` either way, because of
  `--ignore-no-formats-error`, as before. The flag's flip side, found in
  review: with every key refused the run also exits 0 and writes nothing,
  which `runCaptions` read as a video with no captions. Now a run that read
  no track while the dict lists one of the video's own without a `filepath`
  (`unwrittenSubtitles`) fails with the warning's reason; a refused
  translation alone still means no captions (both on the fake).
- an entry whose URL carries `tlang` is left out even when it downloaded: a
  translation's words are never the words spoken. Without this, a translated
  `<l>` that `json3Kind` read as `lines` would be merged as the uploader's
  text (§16.12) over the ASR's timing.

**About one sectioned download in ten fails at once, and passes when run
again.** Across four full runs of the exit check, 6 of about 58 sectioned
downloads failed with a bare `ffmpeg exited with code 1` (1 exact, 5 fast);
a verifier's run, 1 of 11; and on 2026-10-13 by hand, the app's fast-cut
argv on `bvz_zK5ZxpM` eight times: 7 passed in 18–23 s, the eighth failed in
**1 s**. Every failure passed on another run. Why it was bare: `--print`
makes yt-dlp quiet, and FFmpegFD then runs ffmpeg at `-loglevel quiet`.
With `--downloader-args 'ffmpeg:-loglevel error'` the failed run said
`<the stream's googlevideo URL>: Server returned 403 Forbidden (access
denied)` before the ERROR line — a stream URL refused, which yt-dlp's
`--retries` does not cover (it is FFmpegFD's request, not yt-dlp's). The
same section with and without the downloader args is **byte-identical**
(`cmp`; a fast cut of 3,608,792 bytes and an exact one of 654,133), and
the framemd5 of both pairs equal. So: a section always carries those
downloader args; `humanError` gives "ffmpeg exited with code N" the line
before it, its URLs cut out; and `downloadMedia` runs a sectioned download
that failed that way again (a fresh run fetches fresh stream URLs), and any
other failure not at all. One more run was the first fix, and the ten-link
exit run then had 2 of its 36 cuts refused on BOTH runs (`eK71EN3P78U` and
`3pG8Hgq3Z8M`, each a fast cut, each saying `Server returned 403
Forbidden`). The rate moves with the hour: the same `eK71EN3P78U` fast cut
by hand, ten times in a row, was refused on runs 1, 4, 7 and 10 (each in
1–2 s; each passed when run again at once, in 16 s), and seven runs later
not once. Every format came from the same player client (the stream URLs'
`c=VISIONOS`), so it is not one client's URLs failing. A cut now gets
`CUT_TRIES` = 3 runs. All of it through the sandbox's proxy: whether the
proxy adds to the rate is not known.

**Hindi and Telugu captions were burnt unshaped.** `plan.ts` burnt the
.ass with `subtitles=filename=…`. In ffmpeg 4.1's `vf_subtitles.c` (read at
`n4.1`) the `shaping` option belongs to the `ass` filter alone (`-1` auto,
`simple`, `complex`), and the shared init calls `ass_set_shaper(renderer,
shaping)` whenever it is not -1 — so under `subtitles`, whose context never
sets it, the field is 0 and libass runs its **simple** shaper. Measured on
the six exit-check exports (`eK71EN3P78U`, `lqOH-zxtCDE`, `bvz_zK5ZxpM`,
`j4aoo1qbGoE`, `xON4Vot8j8g`, `jze_5hvaVV8`), the framemd5 of `subtitles=`
equals `ass=…:shaping=simple` on every one, Latin included; `ass` with no
`shaping` equals `shaping=complex`. On a self-authored line of letter
clusters (Devanagari क्ष त्र ज्ञ श्र कि, Telugu క్ష త్ర శ్రీ కి స్త), simple
draws each conjunct as its consonants with a visible virama and the i-matra
after its consonant; complex joins them and puts the i-matra first —
through CoreText's fallback (no Indic font is bundled). A verifier counted
a conjunct in 32.4 % of the Telugu track's words, a conjunct (16.5 %) or the
pre-base i-matra (12.9 %) in the Hindi one's, and a conjunct in 4 of the 20
words in `eK71EN3P78U`'s first clip — the exit check's wider rule (any
virama or pre-base vowel sign, below) counts 12 of those 20. The plan
now burns with `ass=filename=…:fontsdir=…:shaping=complex`: same escaping
(a path with `' , [ ] = ; :` and a space opened through both filters, the
same frames as before). English moves a little too, as HarfBuzz kerns:
over `bvz_zK5ZxpM`'s 110 export frames at 1280×720, 50,409 pixels differ
by more than 40 levels between the two shapers (about 460 a frame, against
3,000–6,000 a caption), 98,985 over `xON4Vot8j8g`'s 117. `ass` and its option are in `n4.1`, older than the
2018-12-17 Windows build; whether that build's libass has HarfBuzz is not
measured here — without it `ass_set_shaper` does nothing and the captions
come out as before. `tests/integration/captions.int.test.ts` renders the
app's plan and the plan with its caption step swapped for `ass` at each
level: the app's frames equal complex's, bit for bit (all 120), and on the
Mac complex differs from simple on all 54 Devanagari and all 54 Telugu
frames; the test prints that count on every platform, so Windows CI says
whether it shapes.

**A link with no caption track at all asked for a language first.** On
`zEqLXGE_re4` and `F7Lg2yHtqRA` (a concert, a vlog with nobody talking) the
metadata has no `language`, so Get transcript showed "Choose the language",
and only after a pick "This video has no captions" — while there was
nothing to find in any language. The metadata run now also prints
`%(subtitles&1|0)s%(automatic_captions&1|0)s` (yt-dlp prints `&`'s
replacement for a non-empty field and `|`'s default for an empty one):
measured `00` on both of those, `01` on `eK71EN3P78U` (ASR only), `11` on
`jze_5hvaVV8` (an uploader track too), in the same 1.4–1.8 s run. `00`
makes the store go straight to "no captions", with the From and To fields
and Listen to it, and no language offered.

**The last full run** (2026-10-13, 693 s, all 42 tests green). Eight
caption links: Get transcript 4.6–7.7 s each; `O35KGzkS4VA` and
`3pG8Hgq3Z8M` now keep `en-orig` alone (their `en` was `de-DE→en` and
`uk→en` again). 18 exact clips — the run at 40 % (2877 s on
`lqOH-zxtCDE`), a second through Add another clip on `O35KGzkS4VA` and
`eK71EN3P78U`, and a run with no pause on either side on every link — and
their 18 fast cuts: 34 downloads in one yt-dlp run, 2 in two (a refused
cut, landed on its retry). Every clip's sound starts at 0 and lasts the
range to the millisecond; the placed clip is the range +0 to +2 frames;
each collected word's start and end are the run's less the range's start.
The original audio, read off the file: the original track's own section
against the clip's first 500 ms, correlation 0.9836–0.9999 at 0 ms lag;
a dub's section 0.0903–0.2996. The exact clip's first frame, against where
its own first frame's time puts it in the padded fast cut: −31 to +10 ms
(one source frame is 33.4–41.7 ms; `eK71EN3P78U`'s first run ambiguous at
an 8.4 % margin); its first 500 ms of sound at 0.00 ms every time. The
exports, through `startRender` at 1920×1080: 9 to 40 Dialogues, one per
word of the run(s), and every onset read off the picture on the exact
frame libass's truncated clock says it should first draw that Dialogue —
none a frame off, none left over (held frames moved at most 223 of the
caption's pixels; onsets at least 3,113). Shaping-sensitive words (a
virama or a pre-base vowel sign): 12, 6 and 4 in `eK71EN3P78U`'s three
runs, 0 and 6 in `lqOH-zxtCDE`'s two. The level either side of the cuts,
for the ear: `eK71EN3P78U`'s second run −2.3 dB in the 40 ms before its
head and its three tails −6 to −18 dB; `O35KGzkS4VA`'s first run −8 dB on
both sides of its head; the rest, cut by cut, in each link's README.

**The ten links, read again** with `yt-dlp -J` on 2026-10-13 (the same
yt-dlp, no app code), beside what the last full run kept. "ASR `-orig`" is
the automatic tracks that transcribe an audio track rather than translate
one; the count in brackets is every automatic key, translations included.

| # | id | length | `language` | uploader tracks | ASR `-orig` (automatic keys) | audio languages | chapters | the app kept | words / rows | Get transcript (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `O35KGzkS4VA` | 63:22 | `en-US` | — | `en-orig` + 1 dub's (159) | 8 | 14 | `en-orig` asr | 10,408 / 1,226 | 5,497 |
| 2 | `eK71EN3P78U` | 87:13 | `te` | — | `te-orig` (157) | 1 | 24 | `te`, `te-orig` asr | 11,012 / 1,162 | 4,608 |
| 3 | `lqOH-zxtCDE` | 53:05 | `hi` | — | `hi-orig` + 2 dubs' (159) | 3 | 22 | `hi`, `hi-orig` asr | 8,924 / 1,000 | 5,320 |
| 4 | `3pG8Hgq3Z8M` | 24:53 | `en-US` | — | `en-orig` + 19 dubs' (181) | 20 | 0 | `en-orig` asr | 4,705 / 440 | 7,697 |
| 5 | `bvz_zK5ZxpM` | 5:47 | `en-US` | — | `en-orig` (157) | 9 | 6 | `en`, `en-orig` asr | 1,407 / 99 | 4,797 |
| 6 | `j4aoo1qbGoE` | 10:14 | `en-US` | — | `en-orig` (157) | 21 | 9 | `en`, `en-orig` asr | 1,783 / 158 | 6,427 |
| 7 | `xON4Vot8j8g` | 30:59 | `en-US` | — | `en-orig` (157) | 13 | 0 | `en`, `en-orig` asr | 4,979 / 988 | 5,354 |
| 8 | `zEqLXGE_re4` | 5:04 | none | — | none (0) | 1 | 0 | — | — | 3,167 |
| 9 | `F7Lg2yHtqRA` | 11:01 | none | — | none (0) | 1 | 0 | — | — | 2,844 |
| 10 | `jze_5hvaVV8` | 6:58 | `en` | `en-US` | `en-orig` (158) | 1 | 0 | `en`, `en-orig` asr | 744 / 133 | 4,565 |

Three things in it the app depends on:

- **A dubbed audio track can carry its own ASR, keyed by its language.**
  `3pG8Hgq3Z8M` has 20 audio languages and 20 `-orig` keys; its
  `hi-orig`, `ta-orig`, `ml-orig`, `pa-orig` and the rest are each
  `lang=<the dub's>` with no `tlang` — a dub's words, timed to a sound the
  download does not carry (it carries the original, below). Not every dub
  has one: `O35KGzkS4VA` has 8 audio languages and 2 `-orig` keys,
  `bvz_zK5ZxpM` 9 and 1, `j4aoo1qbGoE` 21 and 1. The app asks `<l>-orig`
  for the language the details name, the original's; a dub's is reachable
  only through a language picked by hand, which the tile offers only when
  the details name none or the asked one found nothing.
- **`<l>` is a list of candidates, and yt-dlp takes the last.** Today
  `O35KGzkS4VA`'s `en` lists the native ASR and then `de-DE→en`;
  `3pG8Hgq3Z8M`'s lists 19 dubs' translations with the native one fourth,
  ending on `uk→en`; `lqOH-zxtCDE`'s `hi` lists `bn→hi`, `en→hi` and then
  the native `hi`. What the last run's `requested_subtitles` resolved —
  `de-DE→en`, `uk→en`, `hi` — is the last of each, so the order YouTube
  lists them decides it, and the order moves (`lqOH-zxtCDE`'s `hi` was
  `bn→hi` in an earlier run). The `tlang` rule above keeps a translation
  out whatever the order.
- **Three English ASR tracks are `variant=gemini`** (`3pG8Hgq3Z8M`'s
  `en-orig`, `j4aoo1qbGoE`'s `en` and `en-orig`), the rest plain or
  `timing-optimized`. Parsed by the same code; nothing in their readings
  below sets them apart.

**The runs**, by a rule, not by hand (`tests/fixtures/m0Exit.ts`): the
first row, as the URL tile shows rows, starting at or after 40 % of the
video, extended by the next rows while the run is under 8 words, cut to 20
from its first word — on `lqOH-zxtCDE`,
whose link carried `&t=2877s`, at 2877 s instead. A second run at 70 %,
through Add another clip, on `O35KGzkS4VA` (the user's choice for it) and
`eK71EN3P78U`. And on every caption link a mid-row run near 55 % whose first
word starts where the word before it ends and whose last ends where the next
starts: no pause either side, where a neighbour's sound would show. Each
through the real store — Get transcript, `setUrlRun`, `clipItFromLink`
(exact, the default), `collectIngest`, `addAnotherClip` — behind main's own
handlers and the real yt-dlp; then exported through `startRender` at the
export strip's default 1920×1080, the "pop" style through libass. The same
range's padded fast cut, through the app's fast path, is the reference.

**How it was read.** The picture: the exact clip's first frame at 160×90
grey against each frame of the fast cut within ±500 ms of where the head
(10 s) plus the exact file's own first-frame time puts it, by mean absolute
difference; the margin is the best's lead over the runner-up, and under
20 % the match is called ambiguous (a still talking head). The sound: the
exact clip's first 500 ms at 16 kHz against the fast cut's within ±1 s of the
head, by FFT correlation; the level either side of each cut is the RMS of
the 40 ms before and after the head and the tail, on the fast cut. The audio
track, off the file: the picked format's own section fetched by format id,
and a dub's beside it, each correlated with the clip's first 500 ms. The
exports: each captioned frame against a captionless export of the same
edit; a pixel is the caption's when it differs by more than 40 levels; an
onset is a captioned frame after a blank one, or one where the caption's own
pixels in the captioned picture move by 15 % of a captioned frame's median
ink (and at least 300); onsets matched to the run's words one to one.

**The 18 clips** — the last full run's files in `tests/output/m0-exit/`
(the words are in its READMEs, none here). Pause before and after: the gap
from the word before the run and to the word after it, in the transcript.
Clip − range: the placed clip's frames past the range's, at the project's
30 fps.

| clip | words | range (ms) | pause before / after (ms) | exact cut, ms (yt-dlp runs) | file: frames @ fps | clip − range | audio picked (audio languages) | sound vs the picked format's / a dub's section (corr) | video |
|---|---|---|---|---|---|---|---|---|---|
| `O35KGzkS4VA` first | 20 | 6,320 | 0 / 80 | 6,854 (1) | 152 @ 23.98 | +0 | `140-7` en-US, pref 10 (8) | 0.9935 / 0.1346 (de-DE) | `137` 1080p |
| `O35KGzkS4VA` second | 9 | 2,240 | 0 / 0 | 5,896 (1) | 54 @ 23.98 | +2 | `140-7` en-US, pref 10 (8) | 0.9998 | `137` 1080p |
| `O35KGzkS4VA` mid | 8 | 4,240 | 0 / 0 | 5,474 (1) | 102 @ 23.98 | +2 | `140-7` en-US, pref 10 (8) | 0.9984 | `137` 1080p |
| `eK71EN3P78U` first | 20 | 5,999 | 760 / 161 | 6,966 (1) | 150 @ 25 | +0 | `140` te, pref −1 (1) | — | `137` 1080p |
| `eK71EN3P78U` second | 20 | 9,240 | 760 / 80 | 10,513 (1) | 231 @ 25 | +0 | `140` te, pref −1 (1) | — | `137` 1080p |
| `eK71EN3P78U` mid | 10 | 4,240 | 0 / 0 | 8,364 (1) | 106 @ 25 | +0 | `140` te, pref −1 (1) | — | `137` 1080p |
| `lqOH-zxtCDE` first | 9 | 4,560 | 561 / 1,359 | 7,248 (1) | 114 @ 25 | +0 | `140-2` hi, pref 10 (3) | 0.9999 / 0.2942 (en-US) | `137` 1080p |
| `lqOH-zxtCDE` mid | 16 | 5,120 | 0 / 0 | 6,926 (1) | 128 @ 25 | +0 | `140-2` hi, pref 10 (3) | 0.9990 | `137` 1080p |
| `3pG8Hgq3Z8M` first | 13 | 6,160 | 1,080 / 0 | 7,892 (1) | 148 @ 23.98 | +1 | `140-19` en-US, pref 10 (20) | 0.9998 / 0.2484 (ar) | `137` 1080p |
| `3pG8Hgq3Z8M` mid | 8 | 4,320 | 0 / 0 | 6,329 (1) | 104 @ 23.98 | +1 | `140-19` en-US, pref 10 (20) | 0.9966 | `137` 1080p |
| `bvz_zK5ZxpM` first | 19 | 3,640 | 160 / 720 | 6,140 (1) | 88 @ 23.98 | +1 | `140-8` en-US, pref 10 (9) | 0.9995 / 0.1405 (es-US) | `137` 1080p |
| `bvz_zK5ZxpM` mid | 8 | 2,360 | 0 / 0 | 5,482 (1) | 57 @ 23.98 | +2 | `140-8` en-US, pref 10 (9) | 0.9917 | `137` 1080p |
| `j4aoo1qbGoE` first | 20 | 6,359 | 760 / 41 | 8,563 (1) | 153 @ 23.98 | +2 | `140-20` en-US, pref 10 (21) | 0.9998 / 0.2996 (ar) | `137` 1080p |
| `j4aoo1qbGoE` mid | 8 | 2,200 | 0 / 0 | 4,181 (1) | 53 @ 23.98 | +0 | `140-20` en-US, pref 10 (21) | 0.9836 | `137` 1080p |
| `xON4Vot8j8g` first | 12 | 3,840 | 1,160 / 640 | 7,034 (1) | 116 @ 29.97 | +2 | `140-12` en-US, pref 10 (13) | 0.9994 / 0.0903 (de-DE) | `137` 1080p |
| `xON4Vot8j8g` mid | 8 | 2,640 | 0 / 0 | 7,099 (1) | 80 @ 29.97 | +1 | `140-12` en-US, pref 10 (13) | 0.9990 | `137` 1080p |
| `jze_5hvaVV8` first | 8 | 3,120 | 6,000 / 1,600 | 7,508 (1) | 94 @ 30 | +0 | `140` en, pref −1 (1) | — | `298` 720p |
| `jze_5hvaVV8` mid | 8 | 1,601 | 0 / 0 | 6,966 (1) | 49 @ 30 | +1 | `140` en, pref −1 (1) | — | `298` 720p |

On every clip the sound stream starts at 0 and lasts the range to the
millisecond, and the collected words are exactly the run's, each word's
start and end the run's less the range's start. `jze_5hvaVV8` lists nothing
above 720p; the selector took its 720p H.264 (`298`, avc1, 30 fps). A `140`
at preference −1 is on a video with one audio language, so there is no dub
to tell it from.

**The exact cut against the fast one** — §41's question again, now with a
run's word times as the cut points and the same range's padded fast cut as
the reference. "Picture" is how far the exact clip's first frame shows its
source ahead of (+) or behind (−) its own sound.

| clip | picture, ms (margin) | exact file's first video pts (ms) | sound lag, ms (corr) | dB before \| after the head | dB before \| after the tail | fast cut, ms (yt-dlp runs) |
|---|---|---|---|---|---|---|
| `O35KGzkS4VA` first | +10 (85.0 %) | 0 | 0 (0.9935) | −8.2 \| −8.0 | −14.7 \| −14.2 | 18,372 (1) |
| `O35KGzkS4VA` second | −31 (44.0 %) | 41 | 0 (0.9998) | −21.4 \| −17.5 | −18.8 \| −12.2 | 18,755 (1) |
| `O35KGzkS4VA` mid | −31 (89.9 %) | 41 | 0 (0.9984) | −12.4 \| −15.5 | −10.5 \| −18.5 | 15,443 (1) |
| `eK71EN3P78U` first | 0 (8.4 %, ambiguous) | 0 | 0 (1.0000) | −53.3 \| −53.1 | −14.1 \| −17.6 | 16,152 (1) |
| `eK71EN3P78U` second | 0 (95.7 %) | 0 | 0 (0.9991) | −2.3 \| −7.7 | −11.6 \| −11.2 | 22,835 (1) |
| `eK71EN3P78U` mid | 0 (82.6 %) | 0 | 0 (0.9992) | −14.0 \| −9.3 | −6.2 \| −7.4 | 19,150 (1) |
| `lqOH-zxtCDE` first | 0 (85.7 %) | 0 | 0 (0.9999) | −55.1 \| −37.5 | −35.1 \| −37.2 | 12,660 (1) |
| `lqOH-zxtCDE` mid | 0 (64.1 %) | 0 | 0 (0.9990) | −29.4 \| −38.9 | −43.5 \| −28.1 | 18,131 (1) |
| `3pG8Hgq3Z8M` first | −31 (74.8 %) | 41 | 0 (0.9998) | −68.9 \| −74.2 | −20.9 \| −39.0 | 19,629 (1) |
| `3pG8Hgq3Z8M` mid | −31 (76.1 %) | 41 | 0 (0.9966) | −19.0 \| −19.2 | −16.3 \| −16.3 | 19,829 (2) |
| `bvz_zK5ZxpM` first | +10 (58.4 %) | 0 | 0 (0.9995) | −36.1 \| −27.4 | −51.1 \| −52.2 | 18,265 (2) |
| `bvz_zK5ZxpM` mid | −31 (93.3 %) | 41 | 0 (0.9917) | −20.7 \| −18.7 | −32.6 \| −39.0 | 17,708 (1) |
| `j4aoo1qbGoE` first | −31 (95.5 %) | 41 | 0 (0.9998) | −31.0 \| −33.4 | −19.9 \| −24.4 | 18,813 (1) |
| `j4aoo1qbGoE` mid | +10 (85.3 %) | 0 | 0 (0.9836) | −19.2 \| −11.3 | −16.1 \| −15.5 | 16,578 (1) |
| `xON4Vot8j8g` first | −23 (89.7 %) | 33 | 0 (0.9994) | −33.9 \| −34.2 | −23.0 \| −24.9 | 18,787 (1) |
| `xON4Vot8j8g` mid | −23.4 (96.5 %) | 0 | 0 (0.9990) | −14.7 \| −18.3 | −12.4 \| −25.6 | 15,164 (1) |
| `jze_5hvaVV8` first | 0 (95.1 %) | 0 | 0 (0.9986) | −35.3 \| −38.7 | −44.6 \| −42.2 | 18,423 (1) |
| `jze_5hvaVV8` mid | 0 (93.0 %) | 0 | 0 (0.9948) | −45.4 \| −50.9 | −52.5 \| −46.1 | 21,048 (1) |

So on the 25 and 30 fps sources the exact clip's first frame is the
source's frame at the head; on the 23.976 and 29.97 fps sources its picture
runs from 10 ms ahead to 31 ms behind its sound, inside one source frame
(41.7 and 33.4 ms) — wider than the half frame (2.7–16.3 ms) §41 measured
for starts between frames against a full download, read here against the
padded fast cut at 160×90. The sound is at 0 every time. The two refused
fast cuts landed on their second run (`3pG8Hgq3Z8M` mid, `bvz_zK5ZxpM`
first).

**The exports** (1920×1080 through `startRender`; "both clips" is the
project after Add another clip):

| export | frames | Dialogues / run words | Dialogue start, at most ms before its word | onsets on libass's frame / words, extra | blank frames' most ink | captioned frames' least ink | held frames' most change | onsets' least change | the mask XOR's held most | shaping-sensitive words |
|---|---|---|---|---|---|---|---|---|---|---|
| `O35KGzkS4VA` first | 190 | 20 / 20 | 9 | 20 / 20, 0 | 0 | 3,120 | 72 | 3,117 | 973 | 0 |
| `O35KGzkS4VA` both clips | 259 | 29 / 29 | 9 | 29 / 29, 0 | 0 | 3,121 | 72 | 3,113 | 973 | 0 |
| `eK71EN3P78U` first | 180 | 20 / 20 | 9 | 20 / 20, 0 | 1 | 11,955 | 27 | 8,112 | 908 | 12 |
| `eK71EN3P78U` both clips | 457 | 40 / 40 | 9 | 40 / 40, 0 | 3 | 5,183 | 137 | 5,202 | 3,200 | 18 |
| `lqOH-zxtCDE` first | 137 | 9 / 9 | 9 | 9 / 9, 0 | 0 | 8,521 | 223 | 7,494 | 1,176 | 0 |
| `3pG8Hgq3Z8M` first | 186 | 13 / 13 | 0 | 13 / 13, 0 | 1 | 4,586 | 82 | 6,433 | 2,208 | 0 |
| `bvz_zK5ZxpM` first | 110 | 19 / 19 | 9 | 19 / 19, 0 | — (none blank) | 1,233 | 68 | 5,550 | 4,281 | 0 |
| `j4aoo1qbGoE` first | 193 | 20 / 20 | 9 | 20 / 20, 0 | 0 | 5,151 | 221 | 5,002 | 1,522 | 0 |
| `xON4Vot8j8g` first | 117 | 12 / 12 | 9 | 12 / 12, 0 | 0 | 6,825 | 20 | 7,835 | 629 | 0 |
| `jze_5hvaVV8` first | 94 | 8 / 8 | 9 | 8 / 8, 0 | 0 | 6,347 | 37 | 11,584 | 1,021 | 0 |

The last column but one is why onsets are read off the caption's own
pixels: the mask XOR of a held line over a shot change moved 4,281 pixels
on `bvz_zK5ZxpM`, against its least onset of 5,550 there and 3,113
elsewhere, and an earlier run measured the two overlapping (1,953 held,
1,554 at an onset). libass is handed `(long long)(pts × (1/fps) × 1000)`,
so a Dialogue starting exactly on a frame boundary is drawn a frame later
(13,800 ms is frame 414 at 30 fps, handed as 13,799, first drawn on 415),
and `toAssTime` floors starts to the centisecond, 0–9 ms early. Both stay
inside a frame; the check predicts each onset on that clock, and every one
landed on it.

**Glyphs.** Latin is Anton, the "pop" style's bundled font. Anton has no
Devanagari and no Telugu; of the 88 fonts in `assets/fonts` (the folder
`fontsdir` hands libass), Poppins Black and ExtraBold (94 of the Devanagari
block's 128 code points) and Teko Bold (93) carry Devanagari, and none
carries Telugu (read from each file's `cmap`, 2026-10-13). On the Mac,
libass falls back through CoreText: a verifier's `-loglevel verbose` run
logged `Glyph 0x915 not found` → Kohinoor Devanagari, `0xC2A` → Kohinoor
Telugu. The last run's onset frames, burnt with `shaping=complex`, have no
boxes; the Telugu one draws its cluster with the consonant's subscript form,
not a loose virama, and the Devanagari one its nukta and candra forms. No
native reader has looked. By the check's rule (a word holding a virama or a
pre-base vowel sign; a word-final virama counts too, so it is an upper
bound), 4,853 of `eK71EN3P78U`'s 11,012 words and 2,336 of `lqOH-zxtCDE`'s
8,924 need complex shaping.

**The no-caption links.** `zEqLXGE_re4` (5:04) and `F7Lg2yHtqRA` (11:01):
no `language`, no uploader or automatic key at all, one audio language. Through
the store, `getTranscript()` goes to `none` at once without fetching
captions (the track flags `00`), and `getTranscript('en')` asks `en` and
`en-orig` and gets no track: `none` again. The URL tile rendered from that
state shows "This video has no captions", Listen to it greyed with "needs
the AI helper", and "Just a part of it" with the From and To fields behind
it; no language is offered. No media was fetched from either.

**The audio track.** The selector (`-f 'bv*[vcodec!*=av01]+ba/b[vcodec!*=av01]'
-S 'res:1080,vcodec:h264,acodec:m4a'`, `src/shared/ingest/format.ts`) took
the original on all six links that carry dubs: the format whose
`format_note` says "original (default)", `language_preference` 10, in the
video's own language — `140-7`, `140-2`, `140-19`, `140-8`, `140-20` and
`140-12`, among 3 to 21 audio languages. Read off the file as well as off
yt-dlp's choice: the clip's sound correlates 0.9836–0.9999 at 0 ms with that
format's own section and 0.0903–0.2996 with a dub's. The file's language
tag says nothing: `eng` on the Telugu `eK71EN3P78U` and on `xON4Vot8j8g`,
`und` on the rest and on every export.

**An uploader's regional track** (`jze_5hvaVV8`). The app asks `<l>` and
`<l>-orig` from the primary subtag (`captionKeys`), so an uploader track
keyed `en-US` on a video whose `language` is `en` is never fetched. Fetched
apart through main's `runCaptions` in the last run: 47 words and 1 sentence
end, against the ASR's 744 and 114; merged as §16.12 merges them it would be
732 words, approximate, 130 rows instead of 133. A regional pattern in the
one fetch is not safe: beside `--write-auto-subs`, `pt-[A-Z]{2}` on
`3pG8Hgq3Z8M` requests `pt-PT`, which is `lang=uk&tlang=pt-PT` (a
translation of a dub), and `pt-BR`, which is `lang=pt-BR` (the Portuguese
dub's own ASR) — measured 2026-10-12 and again 2026-10-13 with
`requested_subtitles` under `--simulate`. An uploader-only fetch
(`--write-subs` without `--write-auto-subs`) reaches neither, measured
2026-10-13: `--sub-langs 'en-[A-Za-z]+'` wrote `en-US` on `jze_5hvaVV8` in 1.7 s, and the same shape
wrote nothing on `3pG8Hgq3Z8M` (`pt-`, `de-`, `en-`), `O35KGzkS4VA`,
`lqOH-zxtCDE` (`hi-`), `eK71EN3P78U` (`te-`) or `bvz_zK5ZxpM`, each in
1.7–2.5 s. **`--sub-langs` splits on commas**, so `'en-[A-Za-z]{2,4}'` is
two patterns, `en-[A-Za-z]{2` and `4}`, and found nothing on
`jze_5hvaVV8`; `{2}` and `+` found `en-US`. The metadata's first track flag
says before any fetch whether one could find anything: `11` on
`jze_5hvaVV8`, `01` on `eK71EN3P78U`, and `-J` lists no uploader track on
the other eight. Whether to add it is `CLIPS.md` §16.32.

**Smaller, recorded.** Loudness on these 3–6 s clips (a verifier's ebur128
on an earlier run's exports): `jze_5hvaVV8` −41.0 LUFS downloaded, −14.5
exported (a 26.5 dB lift); `eK71EN3P78U` −15.7 → −13.1 — 0.5–0.9 LU off the
−14 target, where `loudness.ts` says single-pass loudnorm lands within
0.04 LU; gating on short clips, not changed. And an exact clip's video
stream can end up to a source frame past the range while its sound ends on
it, so an export's last 0–2 frames can be silent (`j4aoo1qbGoE`: 6.362 s of
sound under 6.433 s of picture, in that earlier run).

**Not measured here.** Windows: the exit check runs on the Mac only and
skips under CI; CI's ingest tests run the fake yt-dlp, and `exactCut.int`
the real one against a localhost server, never YouTube — so the real-link
path, the refused-cut rate and the selector's pick are Mac numbers, through
the sandbox's proxy. Whether the 2018 Windows ffmpeg's libass has HarfBuzz,
and which font it falls back to for Devanagari and Telugu without CoreText,
waits on the next push's `captions.int` line and on a font decision
(`BETA.md` R14). The job queue and its IPC are not on the check's path (it
calls main's handlers and `startRender` directly), nor is any card's bake
(the projects have none). And what only the ear can say — that the
words heard are the run's, whole at both ends — is listed link by link in
`CLIPS.md` §3b.9.

## 52. The scene pass's shape, a window, stderr in pieces, and where crop's x lands (2026-10-13)

For `docs/CLIPS.md` §4.2 (1b: `src/shared/reframe/shots.ts`,
`src/main/ffmpeg/shots.ts`) and the followed crop §4.6–4.7 will key. The
builder found the first two; the review re-measured them and added the
rest; each was run again for this section unless a number is credited to
one of them. Development Mac, the bundled
ffmpeg (4.1.5 package, reporting 4.4); the 2018 build read in its source at
`f22fcd4`. The fixture is `tests/integration/shots.int.test.ts`'s
`five-cuts.mp4` (five colours, two seconds each, lossless 640×360 at 30 fps,
cuts at 2/4/6/8 s); the long clip is 60 s of 1080p30 `testsrc2` with its hue
turned every 10 s (five cuts, H.264 `veryfast`).

**`-progress` reports the OUTPUT's time, so a pass that drops frames
starves it.** With `select` on the output path, as §4.2's planned shape had
it, `out_time` stops at the last frame picked: **4.033 s of 10 s** on the
fixture at T 0.5 (cuts at 2 and 4 s picked), **50.03 s of 60 s** on the long
clip at T 0.3; the builder's 60 s clip cut only at 40 s gave no report at
all for its first 40 s. A progress bar sits there, and a cancel waiting on a report
never fires. The fix is `split`: one branch scored and printed into
`nullsink`, the other on to `-f null`, whose time is the progress — 10.000 s
and 60.000 s. **Same cost**: the long clip in 2.86 / 2.86 / 3.03 s split,
3.04 / 2.86 / 3.06 s on the output path, the same five cuts. Any analysis
that prints only its hits (a detector, `thumbnail`) and wants progress needs
the same split.

**An output's `-t` trims after the graph; an input's trims before it.**
`-ss 3 -i five-cuts.mp4 -t 4` at T 0.1 printed `pts_time` 1, 3 **and 5** —
source 8 s, a second past the window — because the scored branch ends in its
sink and never meets the output's trim. With `-ss 3 -t 4 -i`, only 1 and 3
(source 4 and 6 s). At `f22fcd4`, `configure_input_video_filter` inserts a
`trim` on the input from its `recording_time` (`ffmpeg_filter.c:846`), and
the output's is inserted after the graph (`:529`, `:658`). So a window over a
graph with a sink puts `-t` before `-i`.

**A window rests on input seeking, which MPEG-TS breaks.** An MPEG-TS copy of
the fixture (its start 1.400 s, as the muxer wrote it): `-ss 3 -t 4 -i
five.ts` decoded 60 frames, `pts_time` 5 to 6.967, all one grey, and printed
no cut; the whole file printed all four. MP4 is exact. Not measured on a
camera's AVCHD `.MTS`. `findShots` therefore says a clip's shots come from
the whole-file pass, sliced, never from a window. **The window's own
head-skip and 500 ms merge also drop real cuts at its edges.** Through
`findShots` on the fixture at T 0.3 (the critic's re-run): [1867, 3867]
lists the cut at **2000.008** ms in `cuts` (133 ms in, frame 4, so not
head-skipped; the seek's rounding moves it 8 µs) and returns the one shot
[1867, 3867], the 133 ms shot before it merged away; [1900, 3900] lists it at
2000 (frame 3 of the window, head-skipped) and returns [1900, 3900]; [0, 2034]
lists it and returns [0, 2034], the 34 ms tail merged. The whole file keeps
it: [0, 2000], [2000, 4000], [4000, 6000], [6000, 10000].

**stderr arrives in pieces that are not lines.** Through a pipe, read with
Node's `spawn` as `runFfmpeg` reads it, the scene pass over the long clip
with every frame printed (T 0.001) came in 356–359 chunks, of which **3, 1
and 0** in three runs ended mid-line — each at `[Parsed_metadata_4 @ 0x…] `,
av_log's prefix written before its message; on the fixture, 1 of 8, in the
banner. A parser fed per chunk would see a frame line without its time.
Hence `lineSplitter` in `run.ts`: `\n`, `\r\n` and a lone `\r` each end a
line, a `\r` that ends a chunk waits for the next, and `end()` at `close`
hands over a last line with no ending. Through a pipe, `Last message
repeated N times` ends in `\n` (a damaged H.264 stream's
`non-existing PPS 0 referenced`), and the stats line `frame= … speed=…`
ends in a lone `\r` (without `-nostats`; every analysis passes it).

**The scores do not depend on the SIMD path.** With `-cpuflags 0` the
fixture decodes through `scale=320:-2,format=rgb24` to 252,0,0 / 0,0,253 /
98 / 138 / 118 — as with NEON — and its four cuts score 1.000, 1.000, 0.400,
0.200 either way. The 2018 build's x86 paths are CI's: the committed score
table runs there.

**crop's x is `lrint(x) & ~1` on 4:2:0.** At `f22fcd4`, `vf_crop.c`
evaluates x for every frame, rounds it with `lrint` (`normalize_double`,
:130), and without `exact` clears the low bit by the chroma subsampling
(:280). Measured on a yuv420p ramp whose column c carries luma c − 300,
cropping 16 px: x **405 → column 404**, 404.5 → 404, 404.6 → 404, 405.5 →
406, 406.5 → 406, 404.16 → 404, 425.92 → 426, 435.84 → 436, 333 → 332; with
`exact=1`, 405 → 405 and 333 → 333. `Math.round(x) & ~1` gives every one
(round-half-up and lrint's half-to-even differ only on a half, and the mask
erases the difference); `Math.round(x / 2) * 2`, nearest even, gives 406
for 405. So a preview of an eased frame takes `Math.round(x) & ~1`. The crop
path's own positions are even already, where the two agree.

**The flat sum at the reframe's scale.** §48's shape, run: one crop x of 299
held steps `Δ*gte(t,(f−0.5)/fps)` and 299 smoothstep pans
`40*(p)*(p)*(3-2*(p))`, p = `min(1,max(0,(t-t0)/span))` — 599 terms, 45,184
characters — through `-filter_complex_script` over 3,000 frames of a 640×360
`testsrc2` at 30 fps. **Every frame** is framemd5-identical to a static crop
at `Math.round(x) & ~1` of the same sum evaluated in JS at `n/30`: twelve
distinct x, 1,196 frames on a fractional x mid-pan, the cut frames and the
frames before them among them (the review had sampled eleven the same way).
0.61 s against 0.33 s for a static crop. Not run on the 2018 build, whose
`eval.c` reads `+` in the same loop (§48).

## 53. The shot finder on the bundled builds — the five-cut fixture's scores, the line shapes, and the runner's log level (2026-10-13)

For `docs/CLIPS.md` §4.2 (1b), as built at `128765d` with the review's
fixes. This section holds the numbers a run on another build is compared
against. §52 holds the shape's two corrections, the window and where crop's
x lands; this one holds what the built pass prints and scores. Development
Mac, the bundled ffmpeg (4.1.5 package, reporting 4.4); each number re-run
for this section on 2026-10-13 unless it is credited. **The 2018 build is not run here**: the
score table below is asserted in Windows CI, and was green there in run
38408749271 on `d8e3259` (2026-10-13), so both builds score the four cuts
within 0.01 of the table. Every clip is
a lavfi source made on the spot; no third-party media.

**The fixture.** Five `color` sources, `0xFF0000`, `0x0000FF`, `0x646464`,
`0x8C8C8C` and `0x787878`, two seconds each at 640×360 and 30 fps, joined
with `concat` and encoded lossless (`libx264 -qp 0`, yuv420p): 10,778 bytes.
`shots.int.test.ts` makes it; only its table is committed
(`tests/fixtures/reframe/scene-scores.json`). Five sources make **four**
cuts, at frames 60, 120, 180 and 240. The clip is H.264 4:2:0, as a phone's
footage is, and not an RGB `ffv1`: an RGB-stored clip scores the same with
or without `format=rgb24` (the builder's measurement), so it could not catch
that format being dropped.

**The argv the runner spawns** (`SHOTS_GLOBALS`, then `sceneArgs`, then
`runFfmpeg`'s appended progress flags):

```
ffmpeg -nostdin -loglevel info -hide_banner -nostats -i five.mp4 -an
       -vf "scale=320:-2,format=rgb24,split[scored];[scored]select='gt(scene,0.1)',metadata=print,nullsink"
       -f null - -progress pipe:1 -nostats
```

**What it writes to stderr.** At T 0.1 it writes 34 lines. First comes the
24-line banner (`Input #0`, `Stream mapping`, `Output #0, null`). Then come
two lines per picked frame, verbatim:

```
[Parsed_metadata_4 @ 0x15713abb0] frame:0    pts:30720   pts_time:2
[Parsed_metadata_4 @ 0x15713abb0] lavfi.scene_score=1.000000
[Parsed_metadata_4 @ 0x15713abb0] frame:1    pts:61440   pts_time:4
[Parsed_metadata_4 @ 0x15713abb0] lavfi.scene_score=1.000000
[Parsed_metadata_4 @ 0x15713abb0] frame:2    pts:92160   pts_time:6
[Parsed_metadata_4 @ 0x15713abb0] lavfi.scene_score=0.400000
[Parsed_metadata_4 @ 0x15713abb0] frame:3    pts:122880  pts_time:8
[Parsed_metadata_4 @ 0x15713abb0] lavfi.scene_score=0.200000
```

Last come two closing lines. One is the final report, which `-nostats` does
not suppress (`frame=  300 fps=0.0 q=-0.0 Lsize=N/A time=00:00:10.00
bitrate=N/A speed=65.4x`); the other is `video:157kB audio:0kB …`. Every
line, the report's too, ended in `\n`. What the shape says:

- **Both lines carry the filter instance's prefix**, `Parsed_metadata_4`,
  the fifth filter of the graph (scale, format, split, select, metadata).
  Without `format=rgb24` it is `_3`. `sceneLogReader` pairs a score with
  its time by that prefix, not by adjacency.
- **`frame:` counts the picked frames** (0, 1, 2, 3), not the source's, so
  the time comes from `pts_time`. `pts:` is in the stream's time base,
  1/15360 here (30720 = 2 s). Its `%-7s` pads but never truncates, so a long
  timestamp prints `pts:18993151 pts_time:1236.53` with one space between
  them. `parseSceneLog` reads that line as 1,236,530 ms (checked with a
  one-off case; there is no committed test for it).
- **`pts_time` is six significant digits** (`%.6g`). Measured by shifting
  the timestamps inside the graph (`setpts=PTS+1234.5333/TB` before the
  split): the cut at 2 s printed **1236.53**, and with 12345.5333 it printed
  **12347.5**. So from 1,000 s it is printed to 10 ms, an error of at most
  5 ms, which is half a frame at 100 fps. From 10,000 s it is printed to
  100 ms, an error of up to 50 ms, more than half a frame at any common
  rate. The integer `pts:` is exact throughout.
- **At 29.97 fps** (red for 61 frames, blue for 46, green for 60, at
  30000/1001), the cuts on frames 61 and 107 print `pts:61061
  pts_time:2.03537` and `pts:107107  pts_time:3.57023` (time base 1/30000).
  `round(ms × 30000/1001 / 1000)` gives 61 and 107.
- **After a seek, `pts_time` counts from the seek.** `-ss 3.5` before `-i`
  printed 0.5, 2.5 and 4.5 (source 4, 6 and 8 s) over 195 frames. `-ss 3 -t
  4`, both before `-i`, printed 1 and 3 over 120 frames. With the `-t` after
  `-i` it printed 1, 3 **and 5**. The output still counted 120 frames, but
  at 36.8× against 62.2×, because the scored branch kept reading (§52).

**The scores.** The fixture at T 0.1, through the built pass and through the
same graph without `format=rgb24`. The last column is each source's pixel
through `scale=320:-2,format=rgb24`, the frame `select` scored
(`shots.int.test.ts`' note):

| cut | frame | rgb24, built | without `format=rgb24` (the Mac's Y path) | decoded rgb24 |
|---|---|---|---|---|
| red → blue | 60 | **1.000000** | 0.400000 | 252,0,0 → 0,0,253 |
| blue → grey 100 | 120 | **1.000000** | 0.610000 | 0,0,253 → 98,98,98 |
| grey 100 → grey 140 | 180 | **0.400000** | 0.340000 | 98 → 138 |
| grey 140 → grey 120 | 240 | **0.200000** | 0.170000 | 138 → 118 |

- **The grey cuts are |ΔA|/100 of the DECODED levels** (40 and 20) on
  rgb24. The H.264 round trip moved 100/140/120 to 98/138/118 and kept the
  steps.
- **The first column is the committed table**, held within 0.01.
- **The second column is the Mac's alone.** The 2018 build's `select`
  accepts only RGB24/BGR24 for scene detection (`f_select.c` at `f22fcd4`,
  read, not run), so it scores rgb24 with or without the format, while the
  Mac without it scores Y. Before the format was forced, one T meant two
  thresholds: at T 0.5 the red→blue cut is found on rgb24 and missed on Y.
- **Through `findShots`**: T 0.3 (today's default) finds frames 60, 120 and
  180; T 0.5 finds 60 and 120; T 0.1 finds all four at the table's scores.
  These come from the integration note, three runs today.

**Time.** The built argv, timed by wall clock from the shell, three runs
each:

| clip | runs | realtime |
|---|---|---|
| the fixture, 10 s at 640×360 | 0.25 / 0.18 / 0.18 s (the first cold) | ~55× |
| 60 s of 1080p30, `testsrc2` with its hue turned 72° every 10 s, H.264 `veryfast` (39.7 MB) | 3.64 / 3.48 / 3.52 s | ~17× |
| 20 s of flat grey 4K, `ultrafast` (84 kB, the cancel's clip) | 2.58 / 2.52 / 2.54 s | ~8× |

- **The long clip's five cuts** scored 0.970533 / 0.656766 / 0.831839 /
  0.693913 / 0.982717 at 10/20/30/40/50 s, and nothing else scored over 0.3.
- **Other runs were faster.** The builder's 60 s clip (`testsrc2`, then
  `mandelbrot` from 40 s) ran in 2.80–2.85 s, and §52's hue clip in
  2.86–3.06 s. Today's machine was slower or busier.
- **The order of cost holds** at about 3–3.6 s a minute of 1080p. So the
  shots pass over a 10-minute 1080p clip is about 30–36 s of `CLIPS.md`
  §4.10's 90 s
  analysis budget (extrapolated, not run).
- **The 4K clip's time is all scaling**: a tiny file that takes seconds.

**The log level, re-confirmed on the built shape.** The same argv at
`-loglevel error` exits 0 and writes **zero** lines of stderr: no cut and
no error, nothing to say anything went wrong. `metadata=print` logs at INFO
(`CLIPS.md` §4.2's table, 2026-10-05; `f_metadata.c:174` at `f22fcd4`). `runFfmpeg`'s
own globals are `-hide_banner -nostdin -loglevel error -y` (`run.ts:130`),
so the shot finder passes `complete: true` with its own `-nostdin -loglevel
info`. With `error` put back in `SHOTS_GLOBALS`, **five** integration tests
fail, each with zero cuts: the T 0.3 frames, the default threshold, red→blue
at 0.5, the table and the window (the critic's re-run; the builder's and the
review's runs failed four, before the default-threshold case was added).

**Progress and the cancel.**

- **Progress reaches the end.** On the fixture, `-progress` sent two
  reports, `out_time` 0.033333 and then 10.000000, followed by
  `progress=end`. Every frame reaches the output, so the bar reaches the end
  (§52 has what `select` on the output path did).
- **The cancel lands at the first report.** The cancel test runs
  `findShots` over the 20 s 4K clip and aborts at the first report mid-run,
  **0.002** of the clip. `killProcess` SIGKILLs ffmpeg on POSIX, and
  `findShots` rejects with `CancelledError` only at the child's `close`.
- **It settled after 39 / 39 / 36 ms** in three runs today (the builder's
  runs: 34–80 ms; the review's: 37 ms). The child is gone
  (`process.kill(pid, 0)` throws) and its exit code is not 0.
- **Why the test asserts the exit code.** A cancel that only set its flag
  still rejected, but only after ffmpeg had read the whole clip: 2.3 s and
  8.0 s in two measured runs.
- **A signal that is already aborted spawns nothing.**

**Not measured here.**

- **The 2018 build, by hand.** The table, the `split` graph inside `-vf`,
  and the cancel through `taskkill /f /t` (exit code 1) ran in Windows CI
  on the push: run 38408749271 on `d8e3259` (2026-10-13) was green, so all
  three hold on the 2018 build; the per-row scores there are not printed
  anywhere readable without a sign-in, only held within 0.01.
- **How an off row would show.** A row off the table fails `scores every cut
  as the committed table says` with every off row named, as dropping
  `format=rgb24` showed (`red to blue: 0.4, the table 1`, …). The run's
  annotations show that without a sign-in. The integration note with the
  decoded pixels is written on the runner but not uploaded.
- **Real footage with hand-marked cuts, and so T and the minimum shot**, are
  1a's (`CLIPS.md` §4.1).

## 54. The face finder's child process and the salient box — the install, the stubs, the abort without Metal, and the costs (2026-10-13)

For `docs/CLIPS.md` §4.3 (1c: `b8a54cb`, `8052585`, `1d30f84`) and §4.4 (1d: `8a587e7`),
and the fix phase after their review (`ad4942b` … `7cb25c4`). Development
Mac (M1 Pro, 17.2 GB, 8 CPUs), inside the dev sandbox, which has **no Metal
device** (§37). The helper's venv `sidecar/.venv`: CPython 3.14.6,
onnxruntime 1.30.0, numpy 2.5.3, scipy 1.18.1, huggingface_hub 1.31.0, and
mediapipe 0.10.35 since this slice. CI's stand-in is a bare Homebrew 3.12.13
venv made `--without-pip`. `ps` and `pgrep` are blocked in the sandbox, so
process trees and resident sets were read through libproc
(`proc_listchildpids`, `proc_pidinfo` with `PROC_PIDTASKINFO`) or psutil.
Each number names who measured it: the builders, the 1c, 1d and helper-rules
verifiers, or the fix phase. **The detection itself needs Metal, so it is
the user's run** (`FORGE_FACES_REAL=1 npx vitest run
tests/integration/faces.int.test.ts`, which writes to
`tests/output/faces/real/README.txt`), **run 2026-10-13 15:13 on the user's
M1 Pro from the app's Terminal tab**, outside the sandbox, with the model
seeded from `sidecar/.venv-faces/models/`:

| clip | samples | with a face | time | note |
|---|---|---|---|---|
| the face fixture, 3840×2160 HEVC, 26.6 s, 5 fps, 640 edge, minScore 0.5 | 133 | **101** (76 %) | 37.8 s | 1.4× realtime; the 4K decode is the cost (the stand-in detector took 10.8–14.7 s on the same decode); track 10,046 B |
| the same, ten seconds at 640×360, plain | 50 | 26 in both copies | — | the bar for the pair |
| the phone-shaped copy of that (transposed, re-encoded, `rotate=90`) | 50 | 26 in both copies | — | the first faces within **0.0306** of the plain copy's on an edge; overlap (IoU) at least **0.875** |

The worker there started and imported mediapipe in 0.687 s (0.81 s wall;
the sandbox's 0.07–0.13 s import was a warm cache). The pair's first bar,
edges within 0.02, **failed** at 0.0306: BlazeFace's box on two lossy
encodes of one picture moves by about 3 % of the frame, which is the
detector's own jitter, while a box in the wrong frame (the coded sides, or
the clip not turned) lands elsewhere entirely; the test now holds the
overlap to at least 0.5 instead (`overlap()`, its mutation below). The
detector's own RSS is still not recorded by that run.

**The install** (the 1c builder; pip 26.2.1 into `sidecar/.venv`):

| run | time | installed | wheel |
|---|---|---|---|
| `pip install -r requirements-faces.txt` | 0.74 s | absl-py 2.5.0; sounddevice 0.5.6 (flatbuffers, certifi, cffi and pycparser already there) | 137,410 B; 1,009,647 B (universal2) |
| `pip install --no-deps -r requirements-faces-nodeps.txt` | 1.28 s | mediapipe 0.10.35 | 17,782,605 B Mac arm64 (win_amd64: 10,905,503 B); **54.5 MB on disk** |

- In the sandbox pip needed `--use-deprecated=legacy-certs` (the macOS trust
  store unreachable, OSStatus −26276): the sandbox's, not the install's.
- `pip check` afterwards names only `opencv-contrib-python` and
  `matplotlib` as missing (the helper-rules verifier): the stub route, as
  intended.

**The stubs.**

- `import mediapipe` with no stubs: `ModuleNotFoundError: No module named
  'cv2'` at `drawing_utils.py:20`. The worker then exits **69** with `error
  import ModuleNotFoundError: No module named 'cv2'`, which the helper
  answers as "the face detector could not start: …". With
  `forge_sidecar/stubs` first on the worker's `PYTHONPATH`, 0.10.35 imports.
- The helper never loads them: `python -X importtime -m forge_sidecar`
  across `system.hello`, a `vision.faces` call (the worker died −6) and
  `vision.facesModel` printed 601 import lines, none of them `mediapipe`,
  `cv2`, `matplotlib` or `forge_sidecar.workers` (the 1c verifier). Started
  as main starts it (`runpy.run_module('forge_sidecar')`, `sidecarEnv`'s
  environment, cwd `sidecar/`), its `sys.path` holds no stub entry (the
  helper-rules verifier; a test since `10e28a0`, which fails with the stubs
  put in either `sidecarEnv` or `__main__.main`, where the earlier
  `python -c` check passed both).

**The worker's start, and the abort without Metal.**

- Start and `import mediapipe`: **0.14–0.23 s wall, the import 0.07–0.13 s**
  (the 1c builder: three runs, and 226 ms in `faces.int`'s import test).
  The import mode alone (`{"mode":"import"}`): `ready 0.10.35 0.126` in
  0.19 s, 49.7 MB peak RSS (the helper-rules verifier).
- With the real model it dies at `create_from_options`, returncode **−6**,
  0.3–1.3 s in (the builder) — 0.23 s and 92.2 MB at the abort in the
  helper-rules verifier's run. Its log: `gl_context_nsgl.cc failed to create
  pixel format`, then `graph_service.h:139] Check failed: service_ Service
  is unavailable.`, with `DrishtiMetalHelper` in the stack. The same death
  §37 measured in-process, now in a child.
- Through the helper: −32001 "the face detector stopped (code -6): F0000 …
  graph_service.h:139] Check failed: service_ Service is unavailable." in
  **0.598 s** (the 1c verifier; 191 ms in `faces.int`). Children seen during
  the call: ffprobe (the upright check) and the worker, **no ffmpeg** — the
  abort comes before `iter_frames`. Afterwards: no children, the helper
  alive, `system.ping` answered, the faces cache empty.
- **A −6 that was not the detector.** The worker's stdin watcher, a daemon
  thread blocked in `sys.stdin.buffer.read`, held the BufferedReader's lock,
  and the interpreter's shutdown aborted (`Fatal Python error:
  _enter_buffered_busy`), −6, after a pass that had written its whole track
  and printed `done` — on 3.14.6 and on the bare 3.12 alike (the 1c
  builder). The watcher reads the raw descriptor now.
- **Windows: unmeasured.** `os.abort()` there is expected as 3 or
  `0xC0000409` (3221226505); both abort tests accept either on win32
  (`7e95fc0`) until the Surface names it — CI's bare 3.12 has no venv, so
  the abort tests skip there (run 38453960372 on `d7244ce`, green).

**Stopping it** (the 1c verifier's driver on the real helper, the stand-in
detector `colour:80`, a 20 s 640×360 clip):

| what | the worker and its ffmpeg | the `.part` | the helper |
|---|---|---|---|
| a cancel, after the first mid-pass progress (0.1, at 1.54 s) | tree helper → worker → ffmpeg; −32800 at 0.222 s, both pids gone by then | removed | answers `ping` |
| the helper SIGKILLed mid-pass | ffmpeg gone in 0.090 s, the worker in 0.103 s | **left for good** before `ad4942b`; with the worker removing its own (the verifier's trial of that fix), gone in 0.072 / 0.14 s and an empty cache, and `faces.int` holds it since | — |
| `client.stop()` as it was: stdin closed | still alive at 1.5 s (`serve_forever` drains in-flight work for up to 300 s), then SIGKILL: ffmpeg 0.050 s, worker 0.073 s | left | killed |
| `client.stop()` since `114e63c`: a cancel per request in flight, then stdin closed | gone | none | **exits by itself, code 0, 302 ms after the stop** (the fix phase, `faces.int`) |

A worker that ignores the cancel is killed after `STOP_GRACE_S` 3 s. The
stand-in workers in the unit tests exit 99 after 15 s (`09cd96a`), so a
helper that never stops them fails by name: the file ran in 30.4 s under
that mutation instead of hanging.

**Source ms through a window** (the 1c verifier, the stand-in on a clip
cut at 2000 ms): startMs 1000 / endMs 3000 gave ms 1000 … 2800; 1900–2900
gave 1900, then 2100 … 2700; the whole file 0 … 3800. Every sample's scene
matched its ms. A test since `2e88dba`.

**Which frame a sample is: `fps=5` showed one 66.7 ms past its label;
`fps=5:round=up` shows the one on screen at it** (slice B's verifiers, then
the fix phase, 2026-10-14, on the bundled 4.4). A 2 s 30 fps clip whose
frame n is grey 16 + 3n (`geq=lum='16+3*N'`, libx264 `-qp 0`), read at
`fps=5` through `media.frame_args`' own chain:

| filter | source frames, whole file | from a 500 ms seek |
|---|---|---|
| `fps=5` (rounds to nearest) | 2, 8, 14 … 56 (6k + 2) | 17, 23, 29, 35, 41 |
| `fps=5:round=up` | 0, 6, 12 … 54 (6k) | 15, 21, 27, 33, 39 |

`fps=` puts an input frame at t on slot round(t·5) and gives slot k the
last frame put there or before; rounding up, that is the last frame with
t ≤ k/5 — the one on screen at the label `start_ms + k·200`. Rounding to
nearest, a sample labelled within 100 ms before a cut carried the next
shot's face, and the reframe assigns samples to shots by their ms
(`reduce.ts`). `round` and its `up` are in `vf_fps.c`'s option table at
`f22fcd4` (:81, :85; read). The helper's face track is **version 2** since
(`faces.TRACK_VERSION`, the worker's copy, protocol.ts
`FACES_TRACK_VERSION`): the helper's cache key changes with it, and main's
subject track records it (`facesVersion`), so a track reduced from
version 1 is analysed again rather than handed back from
`userData/subjects`. Tests: `test_media.py` (on CI's bare interpreter and
the 2018 build too), the floor scan, and reframeJob.int's stand-in pass,
every sample its label's own frame (offset 0; it was +2).

**The face pass on 4K HEVC** (the user's face fixture, 26.6 s of
3840×2160 HEVC at 30 fps; the stand-in detector, so this is decode and
plumbing):

| run | samples | wall |
|---|---|---|
| through the helper and the worker, 5 fps, edge 640 | 133 | 14.68 s (the 1c verifier); 10.84 s (the helper-rules verifier) |
| the same at 2 fps | 53 | 13.84 s |
| `media.iter_frames` alone, 5 fps | — | 13.43 s |
| the bundled ffmpeg alone, the same arguments, the same session | — | 8.3–14.4 s (a noisy machine) |

- **Decode-bound**: 5 fps → 2 fps saved 6 %, and the stand-in's detection
  was 0.41 s of the 14.68 s. §4.10's "drop to 3 fps" does not rescue a 4K
  budget; `-skip_frame nokey` and hardware decode are unmeasured.
- 15 progress messages for 133 frames ("finding faces": 0, every 10
  frames capped at 0.99, then 1). The track: 3,359 B for 133 samples
  (the 1c verifier); 3,139 B for 20 samples of two faces each (the builder).
- RSS during that pass: the helper 102.5 MB, the worker 45.0 MB, its
  ffmpeg **455.0 MB**, the tree 597.9 MB (the helper-rules verifier). The
  helper at `system.hello`: about 97 MB.

**The gates** (the face finder's with `storage.googleapis.com` reachable:
curl fetched the model without `allowed_domains`):

- `vision.faces` with an empty models folder: −32001 "the face finder is
  not downloaded yet (1,083,786 bytes from storage.googleapis.com);
  vision.facesModel with download: true fetches it" in 0.352 s, ffprobe
  included; no child, nothing written. With every proxy variable at
  127.0.0.1:9, 0.376 s (the 1c verifier).
- `vision.facesModel` with `{}`, `{download: false}` and `{download:
  'true'}`: `present: false` in under 1 ms, nothing written. The press with
  dead proxies: −32603 `<urlopen error [Errno 1] Operation not permitted>` in
  0.35 s, `files/` empty.
- `vision.salient` without its model: −32001 "the subject finder is not
  downloaded yet (115 MB from huggingface.co)"; both gated tests in 478 ms
  (the 1d verifier). With the gate removed the helper spent 23.3 s on the
  Hub and answered −32603 "An error happened while trying to locate the
  file on the Hub".
- `register_all`: 0.32 s on the venv, every method a capability; 0.07 s on
  the bare 3.12, both rows degraded (the 1d verifier). The reasons (the
  helper-rules verifier): on the bare 3.12, "faces unavailable: mediapipe
  is not installed (pip install -r sidecar/requirements-faces.txt, then …)"
  and "salient unavailable: subject finder dependencies are not installed:
  No module named 'numpy'"; on the system `python3` 3.14.6, which has numpy
  but not onnxruntime, salient's names `onnxruntime`.

**The face finder's file.** sha256
`3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b`,
1,083,786 B: the `.venv-faces` seed, and both
`…/blaze_face_full_range/float16/1/` and `…/float16/latest/` on 2026-10-13
(curl; the same md5). The versioned URL is pinned. One fetch through
`vision.facesModel` with certifi's bundle: 0.13 s, three progress messages
(the 1c builder).

**Downloads.**

- **The python.org 3.14 on the dev Mac verifies nothing by default.** Its
  `etc/openssl` is empty until its "Install Certificates" step runs, so
  `urlopen`'s default context failed the face finder's fetch with
  `CERTIFICATE_VERIFY_FAILED` (0.10 s, fix phase; the 1c builder first).
  `media.fetch_url` now adds certifi's bundle to the default context
  (`3544833`). Hugging Face's downloads were never affected:
  huggingface_hub has its own client.
- **A body cut short reads as whole to `http.client`.** `read(amt)` returns
  `b''` at an early end instead of raising (CPython's choice, for
  compatibility). Through the dev sandbox's proxy, `fetch_url`'s loop got
  1,063,248–1,073,176 of 1,083,786 B on 5 of 5 fetches (fix phase) and 4 of
  5 before (the 1c verifier, 979,176–1,063,248), silently; read sizes of
  16 KiB, 64 KiB and 1 MiB were each cut short 3 times in 4; a whole
  `r.read()` raised `IncompleteRead` 3 of 5 (871,384 / 1,013,130 /
  1,064,434 B) and curl got the whole file 3 of 3 (the verifier). The pin
  refused every short body, but called it a sha256 mismatch; it now says
  "cut short (N of M bytes); try again" (`8991694`). The proxy is the
  sandbox's: how often this happens on a user's network is unmeasured.
- **Hugging Face's bytes are on `*.hf.co`.** By headers only, as the client
  fetches (Xet off): the subject finder's resolve URL on `huggingface.co`
  answers 307 to the renamed repo `onnx-community/BiRefNet_lite-ONNX` (the
  pinned commit still served, 114,538,221 B), and that answers 302 to
  `us.aws.cdn.hf.co/xet-bridge-us/…`. `storage.googleapis.com` serves the
  face finder itself (200, 1,083,786 B). `docs/SIDECAR.md` has what this
  means for restricted networks and for `depth.MATTE_REPO`.
- **The subject finder's fetch on the real Hub** (the 1d builder, Xet off):
  the first progress 5.79 s after the press; one message per 10 MiB chunk
  (huggingface_hub 1.31's `DOWNLOAD_CHUNK_SIZE`), so a cancel landed at 9 %,
  6.3 s in, leaving only `.locks/…lock` and `CACHEDIR.TAG` — no blob, no
  snapshot, `present` still false. The second press fetched all
  114,538,221 B in 2.4 s in 12 messages, sha256 `d39b897c…`, the blob's
  own name.

**The salient box, per item** (BiRefNet_lite fp16 on the CPU provider; the
ONNX input fixed at `[1,3,1024,1024]`, one output `[1,1,1024,1024]`):

| step | time |
|---|---|
| the decode at 1024², 640×360 H.264 | 30–74 ms (the 1d builder) |
| the decode, the 4K HEVC face fixture | 247–550 ms a seek (the 1d builder) |
| the session's build, once | 1.8–2.5 s (the builder); 1.95–1.97 s (the 1d verifier) |
| **the matte** | **7.9–9.3 s** in calls, 5.2–9.0 s standalone, 4 and 8 threads alike (the builder); 5.9–8.4 s warm (the 1d verifier); 8.80 and 8.87 s a call (the fix phase) |
| the cut, the clean and the box | 35–49 ms; 284 ms the first time (the scipy import) |
| six items, the build included | 34.2 s (the builder); 37.3 s, progress at 10.4 / 19.9 / 28.7 / 37.2 s (the 1d verifier) |
| two items of the turned clip, the build included | 16.1 s; 17.2 s |
| one good item and four failing ones, the build included | 8.1 s (the 1d verifier) |
| `salient.int.test.ts`, 9 tests | 69 s; 75.3 s |

Where the boxes land (synthetic clips made in the test; the builder, and
the 1d verifier by hand):

| case | answered | drawn, or found by hand |
|---|---|---|
| a disc of radius 60, centre y 150, x = 120 + 160 px a second, on 640×360 | x 0.2197 / 0.4697 / 0.7197, y 0.252, width 0.1865–0.1875, height 0.332, coverage 0.0492 | x 0.21875 / 0.46875 / 0.71875, y 0.25, width 0.1875, height 0.3333; π·60² of the frame 0.0491 |
| a flat grey frame | coverage 0, box null | — |
| the `rotate=90` remux (probes as turned 270°), sent as 360×640, at 500 ms | {0.252, 0.5928, 0.333, 0.1875}, coverage 0.0492 | drawn upright {0.25, 0.59375, 0.3333, 0.1875}; from the decoder's own 360×640 frame, luma > 128, {0.25, 0.5922, 0.3361, 0.1891} |
| the same clip sent as 640×360 | that item: "is 360×640 upright (turned 270°), but 640×360 was sent"; the rest answered | — |
| one still (1280×720) through salient and through `depth.layers`' `subjectBox` | {0.2588, 0.293, 0.2646, 0.4707} | {0.2594, 0.2931, 0.2641, 0.4708}: within 0.0006 |
| the 4K face fixture | on the person, coverage 0.17–0.58 over 4 frames; at 5000 ms {0.0391, 0.2061, 0.4561, 0.792}, 0.1785 (the helper-rules verifier) | — |

**The subject finder's memory — over the floor machine's budget.** The
helper's resident set while `vision.salient` ran one item through depth's
session, the model from the app's store:

| run | ORT CPU arena | peak a matte (MB) | after the call (MB) |
|---|---|---|---|
| the 1d verifier, three mattes | on (default) | 8,638 / 9,325 / 6,846 | 8,638 / 6,845 / 6,222 |
| the 1d verifier | off | 6,573–9,707 | 1,146–1,397 |
| the helper-rules verifier, the 640×360 disc, two runs | on | 8,044.6 / 8,699.4 | 8,699.4 1.5 s after the answer |
| the helper-rules verifier, the 4K face fixture at 5000 ms | on | 8,648.1 | 8,638.7 1.5 s after the answer |
| the fix phase, two calls on a 640×360 clip | on | 7,701 / 8,578 | 7,095 / 4,958; 4,931 1.5 s later |

- **Peaks of 6.6–9.7 GB**, 7.7–8.7 GB for a session's first matte,
  whatever the arena; the arena decides only what stays. `ru_maxrss`
  8,703 MB (arena on) and 9,812 MB (off), the 1d verifier. The session
  alone, after its build: 396–421 MB; the helper after import: 56 MB.
- Dropping `matte:fp16` from `depth._sessions` under
  `depth._session_lock` took the helper to **294 MB** (the 1d verifier,
  from 8,643) and **155 MB** (the fix phase, from 4,931).
- The decoder beside it: ffmpeg 24.0–30.8 MB on the disc, 389.7 MB on one
  4K HEVC frame; ffprobe 0.3–10.8 MB (the helper-rules verifier).
- On the 8 GB Surface, with Electron at 1–2 GB, one no-face shot would page.
  The gate is a decision in `CLIPS.md` §12.1; nothing calls `vision.salient`
  in a job yet (that is 1f).
- The session is depth's, shared with parallax bakes (one build of
  `model_fp16.onnx` across two salient calls, a bake and two more calls,
  counted by wrapping `InferenceSession`; the 1d verifier). Its lock covers
  the build, not `session.run`, so a bake during an analysis is two of
  these at once.

## 55. The followed crop — the flat sum inside the plan's chain, fps= against the half-frame keys on 29.97/60/VFR, and the two-up stack in the graph (2026-10-13)

For `docs/CLIPS.md` §4.7 (1f's render half: `src/shared/reframe/expression.ts`
and `keys.ts`; `render/plan.ts`, `crop.ts`, `momentFrames.ts`) and its render
check §4.9 (`tests/integration/reframe.int.test.ts`). §4.7 left three
questions open, and the slice's measure phase answered them before the build:
whether a flat sum of a podcast's keys is frame-exact inside
`buildRenderPlan`'s own chain (§52 ran it on a bare crop); whether the
half-frame keys (§45) agree with `fps=`'s rounding on 29.97, 60 and VFR
sources at speed 1 (§4.7 had measured 30 fps alone); and whether §38's
two-up stack is still bit-identical inside the chain. Then come what the
build, its two verifiers and the fix phase found on top, each credited, and
the render check as built. Development Mac, the bundled ffmpeg (4.1.5
package, reporting 4.4) and `@ffprobe-installer`'s ffprobe; the 2018 build
read in its source at `f22fcd4`, not run. The measure phase's scripts and
their outputs are in the session's scratchpad (`m55/`), not committed; the
render check is committed and writes `tests/output/reframe/README.txt`.
Every picture is synthetic.

**The measure phase's media** (`gen.mjs`: raw yuv420p written by node, luma
16/235, chroma flat 128):

```
node gen.mjs <out.mp4> <frames> <rate> <cutsCsv|-> [vf]
  → ffmpeg -f rawvideo -pix_fmt yuv420p -s 1920x1080 -r <rate> -i pipe:0
           -f lavfi -i sine=frequency=440:sample_rate=48000 [-vf <vf> -vsync vfr]
           -map 0:v -map 1:a -shortest -c:v libx264 -preset ultrafast -qp 0
           -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k <out.mp4>
```

| rows | what they carry |
|---|---|
| 0–111 | each source column's 16 px band: its index in a 7-bit Gray code, one bit per 16-row block row |
| 128–287 | each column's 2 px unit: its index in a 10-bit Gray code, the same way |
| 320–703 | the frame's own index (its order in the stream), in a 12-bit Gray code, in 32-row bands across the full width |
| 704–1079 | the shot's identity grey, 40 / 100 / 160 / 220 by shot, mod 4 |

| file | frames | rate | cuts |
|---|---|---|---|
| `src30.mp4` | 3,000 | 30 | 150, at 20s + 10 |
| `p2-30` | 1,100 | 30 | 44, at 13 + 25i |
| `p2-2997` | 1,100 | 30000/1001 | the same 44, at fractions 0.013–0.988 of a 30 fps slot |
| `p2-2997t` | 1,100 | 30000/1001 | 43: 488 and 513 replaced by **500**, whose t·30 is exactly 500.5 |
| `p2-60` | 1,200 | 60 | 39, at 30i + 15 + (i mod 2): 20 of them odd, so exact ties at 30 |
| `p2-60t` | 1,200 | 60 | 45, at 11 + 26i: all odd, residues 1/3/5 mod 6 |
| `p2-vfr` | 1,100 | `-r 120`, vf `setpts=4*N+round(1.2*sin(1.7*N))` | the 44; no frame on a half slot |
| `p2-vfrt` | 1,100 | `-r 120`, vf `setpts=4*N+if(N\,floor(1.5+1.49*sin(1.7*N))\,0)` | the 44, **17** of them exactly on a half output frame; 801 of 1,099 output frames distinct |

The VFR files have a time base of 1/15360. The two-up sources are
`ffmpeg -f lavfi -i testsrc2=s=1920x1080:r=<30|60|30000/1001>:d=2.2 -f lavfi
-i sine=frequency=440:sample_rate=48000:duration=2.2 -c:v libx264 -preset
ultrafast -qp 0 -pix_fmt yuv420p -c:a aac -shortest p3-src<r>.mp4`. The
probes are `ffprobe -v error -select_streams v:0 -show_entries
frame=best_effort_timestamp -of csv=p=0 <f>` and `… stream=time_base`. The
first probe prints an empty line after frame 0, a blank from the filter, so
its count is checked against `-count_frames`' `nb_read_frames`. *(That
blank is the Mac's ffprobe; the win32 package prints frame 0 as `0,`,
§59, so per-frame reads use `-of json`.)* **The first
frame must be at pts 0**: otherwise the mp4's edit list, written in ms,
shifts every pts by −5/15360.

**How a crop's x is read.** Each script is bundled and run as
`node_modules/.bin/esbuild <x>.ts --bundle --platform=node --format=esm
--alias:@shared=./src/shared --outfile=<x>.mjs && node <x>.mjs > <x>.txt
2>&1`. The graph is `filterGraphOf(buildRenderPlan(…).args)`. A tap splits
off right after the clip's crop,
`<crop>,split=2[cm0][tp0];[tp0]crop=64:576:0:128[tapout];[cm0]scale=…`, and
is mapped `-map [tapout] -c:v rawvideo -f rawvideo p1-tap.raw` beside the
plan's own output, through `withGraphFile` (`-filter_complex_script`). The
tap stays in the crop's own yuv420p. Its columns 0 and 1 carry the 2 px code
of the crop's first column, which is the exact x. The lossy export is decoded
with `ffmpeg -i out.mp4 -map 0:v:0 -vsync passthrough -f rawvideo -pix_fmt
gray pipe:1` and read at block centres.

**1. The flat sum is frame-exact inside the plan's chain** (the measure
phase, `part1`). The test is one clip of `src30.mp4`, `buildRenderPlan` at
1080×1920 and 30 fps, crop {656 → 240, 0, 608, 1080}. The clip crop's text
occurs once in the graph (counted). Its `min(240,in_w-out_w)` was replaced by
a flat sum, and nothing else changed. At speed 1 there is no retime, so the
crop is the chain's first filter:

```
[0:v]crop=w='min(608,in_w)':h='min(1080,in_h)':x='max(0,min(<sum>,in_w-out_w))':y='max(0,min(0,in_h-out_h))',
     scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuva420p,
     setpts=PTS-STARTPTS+floor(0.000000/TB+0.5)[v0]
```

The sum has 300 terms and a base:

- 150 held steps `Δ*gte(t,((f−0.5)/30).toFixed(6))`, one on each cut frame f;
- 150 smoothstep pans `Δ*(p)*(p)*(3-2*(p))`, p = `min(1,max(0,(t-t0)/span))`,
  each running from cut + 4 to cut + 14.

Its x is 22,086 characters and the graph is 22,708 bytes. It was read back
three ways:

- **(a) The tap.** On **3,000 of 3,000** frames, x equals `Math.round(x) & ~1`
  of the same sum evaluated in JS at t = n·512/15360. 1,346 of those frames
  sit on a fractional x, and there are 476 distinct x. The frame index equals
  n on all 3,000.
- **(b) The plan's own lossy output** (H.264 CRF 20 medium; the cover scale
  ×1920/1080 makes the 608 columns 1,081 before the fit's crop):
  - the source index equals n on 3,000 of 3,000 frames;
  - the 2 px code read at output column 2 equals the model on 3,000 of 3,000,
    so a lossy export does not blur the 2 px bits at block centres;
  - the 16 px band fit is within ±1 px on every frame. Its parity cannot be
    resolved from the bands, and ±8 is §4.9's bar;
  - the identity grey is on its own shot on every frame. The levels 40, 100,
    160 and 220 read 30, 100, 170 and 240 after the gray decode's range
    expansion.
- **(c) The tap does not perturb the picture.** The same plan with no tap
  decodes framemd5-identical on 3,000 of 3,000 frames.

At cut − 1, the cut and cut + 1, for 20 cuts (3, 10, …, 136), the tap, the
output's fit and the model agree on all 60 frames. Examples: @70 916 | 704 |
704; @210 640 | 286 | 286; @1050 640 | 1058 | 1058; @2730 640 | 962 | 962.
The pans, raw → read, came out the same from the tap and from the output:

| shot | frames | move | x on each frame |
|---|---|---|---|
| 11 | 214–224 | 286 by −134 | 286, 282.25→282, 272.06→272, 257.06→256, 238.83→238, 219.00→218, 199.17→198, 180.94→180, 165.94→166, 155.75→156, 152 |
| 76 | 1514–1524 | 856 by +84 | 856, 858.35→858, 864.74→864, 874.14→874, 885.57→886, 898.00→898, 910.43→910, 921.86→922, 931.26→930, 937.65→938, 940 |
| 141 | 2814–2824 | 606 by −214 | 606, 600.01→600, 583.74→584, 559.78→560, 530.67→530, 499.00→498, 467.33→466, 438.22→438, 414.26→414, 397.99→398, 392 |

Where `lrint(x)` is odd, the crop cuts at `lrint − 1` (219.00 → 218), which
is §52's `lrint(x) & ~1`. The cost over 3,000 frames, two runs each
(`part1b`):

| crop x | graph file | render | frame-exact |
|---|---|---|---|
| static | 571 B | 15.4 / 14.0 s | — |
| 298 terms (x 21,930 characters) | 22,498 B | 14.9 / 14.8 s | 3,000 / 3,000 |
| 1,198 terms (88,147) | 88,715 B | 16.1 / 16.5 s | 3,000 / 3,000 |
| 2,998 terms (220,580) | 221,148 B | 17.9 / 18.1 s | 3,000 / 3,000 |

**crop snaps x to even only on a subsampled format** (`part1g`). The first
tap ended in `format=gray`. `split`, `crop` and the other common-format
filters share one format list, so the crop itself became gray. x then landed
on `lrint(x)` with no snap on 3,000 of 3,000 frames, and 671 of them were
odd. In the plan, the fit's `scale` breaks the list and the crop keeps the
decoder's yuv420p. So a test that reads a crop must not force a format on
it. y snaps the same way on 4:2:0. A 4:4:4 or RGB source has no snap
(`vf_crop.c`'s hsub; not run on one).

**keyframeExpression cannot be a crop's x** (`nested.ts`). Its nested
`if(lt(t,…))` was placed as the x inside `max(0,min(…,in_w-out_w))` in the
plan's graph, on a 300-frame clip with keys 3 frames apart alternating
300/900, `keyframeExpression(keys, {durationFrames: 300, fps: 30,
startSeconds: 0, fallback: 656, precision: 0})`, bisected over 60–120 keys:

- held keys render at 96 (2,212 characters) and are refused at 97 (2,235);
- smooth keys render at 91 (12,582) and are refused at 92 (12,721).

The error is `[Parsed_crop_2] [Eval] Missing ')' or too many args in
'if(lt(t,9.483333),300,if(…'`. That is one key fewer than §48's opacity
track (97/98 and 92/93), because of the wrapper.

**The built code, re-measured** (the second verifier, on the measure's
`src30.mp4` with its tap; the keys from `followKeys`, the graphs from
`buildRenderPlan`, with the followed clock ahead of the crop):

- 150 held steps: the tap's x equals `cropAt(project, clip, src, n).crop.x` on
  3,000 of 3,000 frames, and the index is n on 3,000 in both the tap and the
  lossy export.
- 49 terms (24 held, 25 pans, 428 distinct x): 3,000 of 3,000 on both.
- `flatSumExpression` at 2,998 terms (x 208,851 characters, graph file
  209,382 B, no `if(`): the tap's x equals `exportPixel(flatSumAt)` on
  3,000 of 3,000 frames, 2,997 of them on a fractional x, in 16.0 s.

**Flat in parentheses is not flat on the stack** (the second verifier, then
the fix phase). The parser's guard of 100 levels never sees a flat sum, but
the tree it builds for `a+b+c…` is a left-nested chain as long as the sum
(`eval.c`'s parse_subexpr loop, :586–598, the same at `f22fcd4`).
Evaluating, verifying and freeing that tree each recurse to its length
(`eval_expr` :303–304, `verify_expr` :640–675, `av_expr_free`). Measured
under `ulimit -s` on the Mac build:

- **The verifier**: SIGSEGV (exit 139) past 7,156–7,210 terms at a 1 MB
  stack, and past 58,125–58,183 at the default 8 MB, about 144 B a term on
  arm64.
- **The fix phase**: at 1 MB, 7,000 flat terms render and 7,300 die; at 8 MB,
  60,000 die. Written as `base+(t1…t1000)+(t1001…)+…`, 60,000 render at
  1 MB.
- **In the plan's chain with the tap**: 9,595 terms in ten groups at a 1 MB
  stack, exact on 3,000 of 3,000 frames (1,594 on a fractional x), where the
  same sum written flat died. At 8 MB both are exact, 20.4 s grouped against
  20.2 s flat.

Hence `FLAT_GROUP`, 1,000 terms. A sum of that length or shorter is
byte-identical to the measured flat shape, and `flatSumAt` adds each group
first, as the tree does. A Windows main thread's stack is 1 MB (MSVC's
default) or 2 MB (MinGW's); the 2018 exe's reserve has not been read.

**2. At speed 1 the crop needs `fps=` ahead of it** (the measure phase,
`part2.mjs <src>`; the plan's §3.4 remedy). With no retime, the crop runs on
each SOURCE frame's own time, pts × tb, and every plain row matched that
source-time model on every frame. The chain's `fps=` then shows on output
slot n the last source frame whose `round_near(t·30)` ≤ n. It rounds
NEAR_INF, `vf_fps.c:81` at `f22fcd4`. So a held step is frame-exact only if
its boundary falls between the frames that `fps=` shows. Each source was
rendered at 1920×1080 → 1080×1920 with a flat sum of held steps plus a
7-frame pan per shot, and the index and the 2 px code were read on every
output frame. There were two chains: **plain** (the plan as it was) and
**`fps=30,` immediately before the crop**. There were three rules for a
cut's key:

- **floor**: `timelineFrameAt` as built, on the shot finder's ms
  (`pts_time` printed `%.6g`, through `msOf`);
- **round**: `Math.round(ms·30/1000)`;
- **exact**: `fps=`'s own slot, `floor((2·pts·30 + den)/(2·den))`, from the
  integer pts.

Cuts are given as on / early / late, plain | `fps=` first; a single number
means every cut was on. "Off the grid" counts the frames whose export x
differs from the grid model (the keys' value at n), under the exact rule:

| source | cuts (ties) | floor | round | exact | off the grid, plain → `fps=` first |
|---|---|---|---|---|---|
| 30 | 44 (0) | 29/15/0 \| 29/15/0 | 44 \| 44 | 44 \| 44 | 0 → 0 |
| 29.97 | 44 (0) | 24/20/0 \| 24/20/0 | 44 \| 44 | 44 \| 44 | 215 (209 mid-pan), up to 12 px → **0** |
| 29.97t | 43 (1) | 24/19/0 \| 23/20/0 | 43 \| 42/1/0 | 43 \| 43 | 205 (199 mid-pan), up to 12 px → **0** |
| 29.97t, in-point 7 | 43 (1) | 24/19/0 \| 23/20/0 | 43 \| 42/1/0 | 43 \| 43 | 205 → **0** |
| 60 | 39 (20) | 19/20/0 \| 19/20/0 | 39 \| 39 | 39 \| 39 | 0 → 0 |
| 60t | 45 (45) | 0/45/0 \| 0/45/0 | 30/15/0 \| 30/15/0 | 45 \| 45 | 0 → 0 |
| VFR | 44 (0) | 23/21/0 \| 23/21/0 | 44 \| 44 | 44 \| 44 | 176 (all mid-pan), up to 8 px → **0** |
| VFRt | 44 (17) | 35/9/0 \| 21/23/0 | 41/2/1 \| 38/6/0 | **43/0/1** \| 44 | 175 (149 mid-pan) → **0** |
| VFRt, in-point 7 | 44 (17) | 35/9/0 \| 21/23/0 | 42/0/2 \| 38/6/0 | **42/0/2** \| 44 | 176 (149 mid-pan) → **0** |

- **The plain chain's late cut on VFRt** is k588, at t·30 = 588.5. Its
  boundary written to 6 dp is 19.616667, which is above the frame's own
  time, so that frame shows the old crop. At in-point 7 the late cuts are
  k163 (at 156.5) and k688 (at 681.5), both boundaries rounding up.
  - The pattern: a half-frame boundary written to 6 dp rounds ABOVE a frame
    time when (2m+1) mod 6 = 1.
- **The round rule misses exact ties.**
  - 29.97t with `fps=` first misses k500: slot 501, key 500.
  - 60t misses 15 of 45. k11, for example, prints 0.183333, giving key 5
    where the slot is 6.
- **Time over about 1,100 frames.**
  - At 30, 29.97 and VFR, the two chains are within ±2 % of each other
    (5.17–5.32 s).
  - At 60, `fps=` first is faster: 3.9–4.2 s plain against 3.2–3.3 s.

**A static crop is unchanged by `fps=` first** (`static.mjs`: the plan as it
was against `fps=30,` before its crop, each `-map [vout] -map [aout] -c:v
rawvideo -c:a pcm_s16le -f framemd5`):

| source | video frames identical | audio packets identical | time, plain / `fps=` first |
|---|---|---|---|
| 30 | 1,098 / 1,098 | 1,716 / 1,716 | 9.6 / 9.7 s |
| 29.97 | 1,100 / 1,100 | 1,719 / 1,719 | 9.6 / 9.7 s |
| 60 | 599 / 599 | 936 / 936 | 6.3 / **5.4** s |
| VFR | 1,099 / 1,099 | 1,718 / 1,718 | 9.7 / 9.6 s |
| VFRt | 1,099 / 1,099 | 1,718 / 1,718 | 9.6 / 9.6 s |

**At other speeds** (`part2s.mjs <src> <2|0.5>`). The retime already puts
`setpts=PTS/s,fps=30` ahead of the crop, so only the plain chain was run.
The rules here are floor; tl-exact, which is `timelineFrameAt` on the exact
ms; and exact, `floor((2·trunc(pts/s)·30 + den)/(2·den))`:

| source | ×2 floor | ×2 tl-exact | ×2 exact | ×0.5 floor | ×0.5 tl-exact | ×0.5 exact |
|---|---|---|---|---|---|---|
| 30 | 36/8/0 | 44 | 44 | 0/44/0, by 1 | 0/44/0, by 1 | 44 |
| 29.97t | 43 | 43 | 43 | 0/43/0, by 1 | 0/43/0, by 1 | 43 |
| 60t | void | void | void | 0/45/0, by 2 | 0/45/0, by 2 | 45 |
| VFRt | 41/3/0 | 44 | 44 | 0/44/0, by 1–3 | 0/44/0, by 1–3 | 44 |

- **60t at 2× is void.** Its shots of 6.5 output frames are shorter than the
  pans, so every rule reads 1/22/22.
- **0.5×: `timelineFrameAt` is early on every cut, even on exact ms.** The
  export shows source floor(n/2), while `sourceFrameAt` rounds n·0.5 half up.
- **`setpts` truncates.** `ffmpeg -t 0.2 -i p2-2997.mp4 -vf
  setpts=PTS/2,showinfo -f null -` prints pts 0, 500, 1001 and 1501: 1001/2 →
  500 and 3003/2 → 1501 (`setpts.c:144`'s D2TS at `f22fcd4`).
- **Ramps were not measured** in this phase (below, from the verifier).

**The shot finder's print.** `ffmpeg -i p2-2997t.mp4 -vf
"select='eq(n\,500)+eq(n\,499)+eq(n\,13)',metadata=mode=add:key=k:value=v,metadata=print"
-an -f null -` prints:

| frame | printed | what it means |
|---|---|---|
| 499 | `pts:499499 pts_time:16.65` | true 16.649967 s, slot 499; Math.round of the printed ms gives 500 |
| 500 | `pts:500500 pts_time:16.6833` | slot 501; Math.round gives 500 |
| 13 | `pts:13013 pts_time:0.433767` | — |

On the 60 fps fixture, frame 11 prints `pts:2816 pts_time:0.183333`: slot 6,
and Math.round gives 5. The integer `pts:` is exact; `pts_time` is not.

**Where the printed pts count from: the file's first timestamp, not the
container's zero** (measured 2026-10-13 on the Mac's 4.4, for slice B's fix
phase; the comments in `shared/reframe/shots.ts`, `types.ts` and
`main/ffmpeg/shots.ts` had said "the container's start"). A 4 s 640×360
clip, red then blue, cut at 2 s (libx264 `-qp 0`, 30 fps), copied two ways
and run through the scene pass's filter
(`-vf "scale=w=320:h=-2,format=rgb24,select='gt(scene,0.3)',metadata=print"`):

| file | `start_time` (ffprobe) | the cut frame (index 60) in the container | printed |
|---|---|---|---|
| the mp4, 1/15360 | 0 | 30720 = 2.000000 s | `pts:30720 pts_time:2` |
| `-c copy` to MPEG-TS, 1/90000 | 1.400000 | 306000 = 3.400000 s | `pts:180000 pts_time:2` |
| the mp4 `-c copy -output_ts_offset 600` | 600.000000 | 9246720 = 602.000000 s | `pts:30720 pts_time:2` |

The verifier's own MPEG-TS copy started at 1.466667 and printed the same
`pts:180000`. Without `-copyts` ffmpeg subtracts the input's `start_time`
before the filters, which is the clock the export's input `-ss` counts on —
so `Shot.startPts` handed to `exportFrameAt` is right as it is on a `.ts`
or `.MTS` file, and nothing downstream may subtract `start_time` a second
time. This answers, for the whole-file pass, part of CLIPS §13's "a camera's
`.MTS` is unmeasured" (a window's seek on MPEG-TS is still §52's problem).

**The arithmetic** (`arith.mjs`, re-run for this section, exit 0). Every
frame of a 30-minute file is taken as a cut. The table counts how often the
key from the finder's ms (`%.6g`, then µs) misses `fps=`'s exact slot on a
30 fps project. Bands are [0, 10), [10, 100), [100, 1000) and [1000, 1800) s:

| source | frames per band | `Math.round(ms·30/1000)` wrong | floor wrong | snapped with the asset's 2-dp rate, wrong |
|---|---|---|---|---|
| 23.976 | 239 / 2,158 / 21,579 / 19,180 | 0 / 2 / 171 / 1,591 | 120 / 1,080 / 10,702 / 8,651 | 0 / 0 / **20,961** / **19,180** |
| 24 | 239 / 2,160 / 21,600 / 19,200 | 20 / 180 / 1,800 / 1,600 (1 in 12) | 140 / 1,260 / 12,600 / 11,200 | 0 |
| 25 | 249 / 2,250 / 22,500 / 20,000 | 0 | 100 / 900 / 9,000 / 8,000 | 0 |
| 29.97 | 299 / 2,698 / 26,973 / 23,976 | 0 / 2 / 222 / 1,999 | 0 / 1,498 / 13,348 / 10,795 | 0 |
| 30 | 299 / 2,700 / 27,000 / 24,000 | 0 | 100 / 900 / 9,000 / 8,000 | 0 |
| 59.94 | 599 / 5,395 / 53,946 / 47,952 | 0 / 4 / 443 / 3,985 | 300 / 2,695 / 26,713 / 21,595 | 0 |
| 60 | 599 / 5,400 / 54,000 / 48,000 | 100 / 900 / 9,000 / 8,000 (1 in 6) | 400 / 3,600 / 36,000 / 32,000 | 0 |

Builder K's `TIE_SLACK` in `keys.ts` takes a printed time that is within its
own print precision of a tie as the tie. It was checked by arithmetic only,
at in-point 0: 24, 25, 30 and 60 fps projects at 1×, 2× and 0.5×; sources at
23.976–60 fps; and an iPhone-style VFR on 1/600. The share of frames keyed
wrong, against plain `Math.floor(x + 0.5)`:

| file length | with the slack | plain rounding |
|---|---|---|
| under 10 s | 0 % | 1.39 % |
| 10–100 s | 0.068 % | 1.43 % |
| 100–1000 s | 0.73 % | 1.86 % |
| past 1000 s | the same as plain rounding | — |

**The built rule, checked against ffmpeg** (the first verifier). Every
source frame of the barcode sources was taken as a cut, run through the
plan's own `-ss`/`-t` seek and `retimeFilter`, and compared with
`exportFrameAt`.

- **The exact-pts path was off on 0 frames in every row:**
  - 29.97 at 2× and in-point 7: 997 cuts;
  - 29.97 at 0.5×: 299 cuts;
  - 29.97t, 60, 60t, VFR and VFRt at 1× and in-point 7: about 1,000 cuts
    each;
  - 30, 60t and VFRt at 2×.
- **The printed-ms path was off on 0 or 1 cut a row.** The misses are the
  near-ties: 29.97 frame 499, and k999 at 2×.
  - k999 by hand: the print 33.3333 s puts its position at 496.4995 and the
    slack adds 0.00306 frames, giving 497. The export shows 496.
- **Without the slack, plain rounding of the printed ms was off on:**
  - 166 of 998 cuts at 60 → 30;
  - 166 or 167 of 998 at 2× on 30;
  - 130 of 998 on VFRt.

  The slack brought all of these to 0, at the cost of k999.

**The verdict per rate** (the measure phase's; the next part says what the
build changed):

| rate | `fps=` ahead of the crop at speed 1 | the cut's key |
|---|---|---|
| 30 | changes nothing measurable: a static crop is bit-identical (video and audio), the times are equal, and the cuts are 44 of 44 under round or exact in both chains. Kept for one shape | exact (round agrees) |
| 29.97, and NTSC rates generally | **required**. Without it, pans drift up to 12 px off the frame grid on 209 of 1,100 frames, and the plain chain's per-source clock disagrees with the moments' pull, which already ran `fps=` ahead of its crop | exact: round is early on the tie (k500) with `fps=` first |
| 60 | both chains are frame-exact on the exact slot. 14–18 % faster with it (599 frames: 3.9 → 3.2 s; static 6.3 → 5.4 s) | exact: round is early on 15 of 45 odd cuts, floor on 45 of 45 |
| VFR | **required**. With half-stamped frames, the plain chain is late on 1 cut of 44 (2 with an in-point), because a 6-dp boundary rounds above the frame's time. Pans drift up to 8 px. With `fps=` first and the exact slot: 44 of 44 on every VFR row | exact |
| speed ≠ 1 | the retime already ends in `fps=` | `floor((2·trunc(pts_rel/s)·fps + den)/(2·den))`; `timelineFrameAt` is early on every cut at 0.5× (1 frame; 2 at 60 fps) |

**3. What the build changed, each measured.**

**`fps=` starts at the slot the first frame rounds to; `start_time=0`
starts it at 0** (the second verifier, then the fix phase). At `f22fcd4`,
`fps=` sets its first output pts from its first frame (`vf_fps.c:220–222`).
So after a seek that lands more than half a slot before the first frame,
the output starts at slot 1. That happens on:

- VFR at in-point 1 (t·30 = 0.5);
- 24 fps footage at three in-points of five;
- 25 fps footage at three of six;
- 29.97 footage at in-points 500–1000 and from 1501.

The clip's `setpts=PTS-STARTPTS` then made clip frame k slot k + 1, with its
crop running at t = (k+1)/30, while every model of the clip read frame k at
k/30. `cropAt` was off the export on 26 of 150 frames, by 960 px on each cut
frame (VFR at in-point 1, and 29.97 at in-point 600; the control, VFR at
in-point 6, was off on 0). The export itself stayed self-consistent: its
keys and its picture were both on t.

`fps=30:start_time=0` (`vf_fps.c:80`, with its offsets set in config_props
at :159–172) outputs slot 0 from the first frame, which makes clip frame k
slot k. So the clock is `fps=${fps}:start_time=0`, ahead of every followed
crop at every speed. At speed 1 it stands in for `fps=`; at other speeds it
comes after the retime's own `fps=`. reframe.int's rows at VFR in-point 1,
at 1× and at 0.5×, are within 1 px of the model on every frame. With
`start_time` dropped they read "frame 29: 1136, model 176".

With this clock ahead of the crop, `n` counts slots from 0 and n/fps is t,
so keying on `n` renders the same.

**The seek is rounded into the time base too** (the first verifier). ffmpeg
holds `-ss` in µs and rescales it into the stream's time base, rounding to
nearest. At a 25 fps project on a 1/15360 file, an in-point is 614.4 ticks a
frame. At two in-points of five it rounds up, and an exact tie (a 30 or 60
fps source's frame k ≡ 3 mod 6) then goes DOWN a slot, where the printed
path's slack sends it up.

- **Counted against ffmpeg, the printed path:**
  - in-points 72 and 22: 159 of 958 cuts a frame late;
  - in-point 31, whose seek rounds down: 0;
  - 2× at in-point 28: 80 of 958;
  - a 60 fps source at in-point 72: 85 of 1,024.
  - A random-clip property test agreed: 48 of 3,386 cuts on 30 fps sources
    were wrong, every one at a 25 fps project.
- **Re-measured by the fix phase:** after `-ss 2.88` (in-point 72),
  `fps=25:start_time=0` first shows source frame 231 (pts 118272) on slot
  120. The exact path says 120 and the printed path says 121.

24, 30 and 60 fps projects seek exactly on 1/15360, 1/30000, 1/600 and
1/90000 files. The exact path rounds the seek as ffmpeg does, so 1b's
`Shot.startPts` with the track's time base is **required** for 25 and 50 fps
projects.

**A ramp's `T-STARTT` counts from the first frame kept, not the in-point**
(the first verifier, then the fix phase). `rampVideoFilter` measures source
time from STARTT, which is up to a source frame past the seek when the seek
falls between frames. The test took every source frame as a cut, through
the followed chain's head:

| source, in-point 7 | ramp | cuts off the in-point's clock |
|---|---|---|
| VFR | 1 → 0.5 | 721 of 721 |
| VFR | 0.5 → 2 | 869 of 972 |
| VFR | 2 → 1 | 846 of 1,008 |
| VFR | 0.25 → 4 | 662 of 1,012 |
| 29.97 | the four ramps | 5–10 of about 1,000 |

The VFR misses were by up to 5 frames.

By hand, 29.97 with a ramp of 1 → 0.5 at in-point 7, duration 1000, k43:

- the first kept frame is k7, 7 ticks past the seek;
- from the in-point, T = 1.201433 s gives 36.5009 frames, slot 37;
- ffmpeg's T − STARTT = 1.201200 gives 36.4937, slot 36, which is what was
  measured.

Written with `T`, which is seek-relative after `-ss`, every row was 0 off,
on 30 and 60 fps sources too and at in-point 0. A followed clip's ramp is
written that way (`followedRetime`); an unfollowed one keeps speed.ts' own
form.

**The pull's command line.** The moments' pull put the whole clip's sums in
its `-vf`, which `execFile` spawns with no graph file. For a 20-minute clip
with a cut every 4 s and a pan in each shot, that was 46,001 characters (the
second verifier counted 45,989, and 37,062 for a 10-minute two-up). Windows
refuses anything past 32,767 (§47). `windowSum` keeps only the terms that
change a pulled frame. The `-vf` is then under 2,000 characters at any
length, the quoted argv under 4,000, and every pulled frame's value is the
whole sum's to the last bit.

**4. The two-up stack in the graph loses the clip's last frame** (the
measure phase, `part3.mjs`). The plan's own crop was replaced by
`split=2[r0a][r0b];[r0a]crop=w='min(608,in_w)':h='min(540,in_h)':x=…:y=…[r0t];[r0b]crop=…[r0u];[r0t][r0u]vstack`.
The plan's own `scale…increase,crop=1080:1920,fps=30,setsar=1,format=yuva420p,setpts`
and overlay followed it. Each run rendered 60 frames at 1080×1920 from the
testsrc2 sources at 30, 29.97 and 60 fps with `-map [vout] -map [aout] -t
2.000000 -c:v rawvideo -c:a pcm_s16le -f framemd5`, compared over dts, pts,
duration, size and hash.

There were four variants:

- the single crop, 608×1080 at 656;
- the halves at (656, 0) and (656, 540);
- a static two-up, top (400, 100) and bottom (1000, 300);
- keyed: each half's x and y held by `gte(t,0.983333)` steps, from the
  halves of the single crop to the static two-up at frame 30.

Each variant was run plain, with an `ass` caption (`subtitlesPath`,
shaping=complex, one Dialogue over 0–2 s), with the baked band
(`captionOverlay`: an ffconcat of a 1080×200 RGBA PNG at y 1500), and with
`fps=30,` first. The keyed chain:

```
[0:v]split=2[r0a][r0b];
[r0a]crop=w='min(608,in_w)':h='min(540,in_h)':x='max(0,min(656-256*gte(t,0.983333),in_w-out_w))':y='max(0,min(0+100*gte(t,0.983333),in_h-out_h))'[r0t];
[r0b]crop=w='min(608,in_w)':h='min(540,in_h)':x='max(0,min(656+344*gte(t,0.983333),in_w-out_w))':y='max(0,min(540-240*gte(t,0.983333),in_h-out_h))'[r0u];
[r0t][r0u]vstack[,tpad=stop_mode=clone:stop=1],scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuva420p,setpts=…[v0]
```

| source | runs | the halves equal the single crop, as §4.7 specified it | with `,tpad=stop_mode=clone:stop=1` |
|---|---|---|---|
| 30 | plain, +ass, +baked band, +`fps=` first | **59 / 60** (frame 59 differs) | 60 / 60 |
| 29.97 | the same four | **59 / 60** | 60 / 60 |
| 60 | plain, +ass, +baked band | 60 / 60 | 60 / 60 |
| 60 | +`fps=` first | **59 / 60** | 60 / 60 |

- **The keys and the control held in every row**, with the tail and without:
  - keyed frames 0–29 equal the single crop, 30/30;
  - keyed frames 30–59 equal the static two-up, 30/30;
  - the static two-up equals the single crop on 0 of 60 frames (the control).
- **Without the tail, frame 59 is the bare black canvas.** Its md5 is
  `9b2c4088acb2c896d5d79adbe4b893ac`, the same as `ffmpeg -f lavfi -i
  color=c=black:s=1080x1920:r=30:d=0.034,format=yuv420p -frames:v 1 -c:v
  rawvideo -f framemd5 -`. The clip vanishes on its last frame.
- **Isolated** (`ffmpeg -ss 0 -t 2.000000 -i p3-src30.mp4 -filter_complex
  "[0:v]<g>,showinfo[o]" -map "[o]" -f null -`):

  | g | frames | last pts |
  |---|---|---|
  | `split=2[a][b];[a]crop=608:540:656:0[t];[b]crop=608:540:656:540[u];[t][u]vstack,fps=30` | 59 | 1.93333 |
  | the same without `fps=30` | 60 | — |
  | `crop=608:1080:656:0,fps=30` | 60 | 1.96667 |
  | the stack with `,tpad=stop_mode=clone:stop=1` before `fps=30` | 60 | — |

- **The mechanism** (measured on the Mac; read at `f22fcd4`, where the code
  is the same): vstack's framesync signals EOF with AV_NOPTS_VALUE
  (`framesync.c:98`). `fps=` then drops the frame it was holding, because
  that status pts is not past its next (`vf_fps.c:239–240`). After the crop,
  the fit and the two caption paths make no difference; the trailing `fps=`
  does.
- **The pull** (`prepass.mjs`: `momentFrameArgs`' `-vf` with the crop moved
  after its `fps=30`):

  ```
  fps=30,split=2[r0a][r0b];[r0a]crop=…[r0t];[r0b]crop=…[r0u];[r0t][r0u]vstack,
  tpad=stop_mode=clone:stop_duration=0.333333,trim=start_frame=25:end_frame=35,setpts=PTS-STARTPTS,
  scale=w='trunc(iw*min(1,2160/max(iw,ih))/2)*2':h='trunc(ih*min(1,2160/max(iw,ih))/2)*2':flags=bicubic,format=rgba
  ```

  A 10-frame window from frame 25, across the switch, read 10 of 10 at 30,
  29.97 and 60: the halves equal the single crop, and the keyed frames equal
  the single crop before 30 and the two-up from 30. A 5-frame window from
  frame 55, with the clip's last frame, read 5 of 5. The pull's own tpad
  keeps the last frame.
- **Cost** (`cost2up.mjs`, 3,000 frames to H.264): the single crop 13.0 /
  13.6 s, the two-up with the tpad 13.7 / 14.0 s (+3–6 %).
- **Formats.** A yuv420p10le source (`ffmpeg -f lavfi -i
  testsrc2=s=1920x1080:r=30:d=0.5 -pix_fmt yuv420p10le -c:v ffv1 src10.mkv`)
  stays yuv420p10le through split, crop, vstack and tpad (`showinfo`). At
  `f22fcd4`, tpad's formats come from `ff_draw_supported_pixel_formats`,
  whose `ff_draw_init` accepts depths 8–16 (`drawutils.c:198`, read).
- **Builder R's new finding:** the render check's VFR source keeps the
  two-up's last frame even without the tpad; 30, 29.97 and 60 lose it. So
  the tpad stays.
- **The built code, re-measured** (the second verifier: `followKeys` and
  `buildRenderPlan` on the testsrc2 sources, with a four-shot track whose
  shot 4 is two-up):
  - before the two-up cut, the frames are bit-identical to the same clip
    with no two-up: 40/40, 40/40 and 41/41;
  - the last frame is a picture;
  - with `vstack,tpad=…,` replaced by `vstack,` in the graph, the last frame
    is the black canvas at all three rates, and 59 of 60 frames equal the
    built output;
  - a freeze on a two-up frame (`hold`, so static halves, the clock and the
    split) renders 30 frames, one picture, none black.

**5. The render check, as built** (`tests/integration/reframe.int.test.ts`
→ `tests/output/reframe/`: 34 tests, 83 s on the Mac when re-run at
`0fbf9cc` for this section, all passed).

The media (`tests/fixtures/reframe/media.ts`):

- 1920×1080 frames written raw by node, stored with `-c:v libx264 -preset
  ultrafast -qp 0 -pix_fmt yuv420p -g 30`, with a 440 Hz tone as AAC in MP4.
- The column code (16 px bands, 7-bit Gray, one bit per 16-row block row)
  runs in strips of 112 rows every 270 rows.
- The row code is the same, turned, in strips of 112 columns every 256
  columns, so a 608×540 half reads its own x and y.
- Luma codes are 48/200 on a 124 field, so no pixel clips through the pull's
  RGBA.
- Each shot has its own chroma (U, V): 112/112, 144/112, 112/144 and
  144/144.
- The VFR source is `-r 120 -vf setpts='4*N+if(N,floor(1.5+1.49*sin(1.7*N)),0)'
  -vsync vfr`.

The track is hand-built (`track.ts`):

- shot 1: one face at x 0.25;
- shot 2: one face at x 0.75;
- shot 3: a face drifting 0.3 → 0.6, a pan of 948 ms;
- shot 4: one face at x 0.5, or for the two-up, faces at x 0.2 (y 0.35) and
  x 0.8 (y 0.55).

The clip sits at timeline frame 15 with in-point 6, 210 frames, in a 30 fps
project. The path is `followKeys` → `buildRenderPlan` → `withGraphFile` →
the bundled ffmpeg. Every frame is decoded in order and read: x and y are
fitted to the codes, and the shot comes from the chroma. The tolerance is
±2 px on the Mac and ±8 elsewhere.

| source | frames, time base | cuts (source frames) | 9:16 and 1:1 cut frames (clip) | 2× cut frames | worst \|read − model\|: 9:16 / 1:1 / 2× / two-up |
|---|---|---|---|---|---|
| 30 | 225, 1/15360 | 29, 61, 165 | 23, 55, 159 | 12, 28, 80 | 1 / 0 / 1 / 1 px |
| 29.97 | 225, 1/30000 | 30, 60, 165 | 24, 54, 159 | 12, 27, 80 | 1 / 0 / 1 / 1 |
| 60 | 450, 1/15360 | 61, 120, 331 (61 and 331 are exact ties at 30; `fps=` rounds them up) | 25, 54, 160 | 12, 27, 80 | 1 / 0 / 1 / 1 |
| VFR | 225, 1/15360 | 30, 62, 169 (30 and the frame after it on half slots after the seek) | 25, 56, 163 | 12, 28, 82 | 1 / 0 / 1 / 1 |

- **The ties are asserted from the probed pts**, not only stated in
  comments. A test checks them in integers, with a non-tie control (30 fps
  cut 29).
- **Every cut on every source:** cut − 1 shows the old shot's chroma at the
  old crop, and the cut frame shows the new shot's at the new crop:
  - 9:16: 176 | 1136, 1136 | 272, 848 | 656;
  - 1:1: 0 | 840, 840 | 36, 612 | 420.
- **The pans.**
  - At 9:16 on 30 fps, 272 → 848 over clip frames 114–143, as read: 272,
    274, 281, 290, 305, 321, 341, 362, 387, 413, 440, 469, 498, 528, 560,
    590, 621, 650, 680, 708, 734, 759, 780, 798, 816, 831, 840, 846, 848.
  - At 1:1, 36 → 612: 36, 40, 56, 78, 108, 144, 184, 230, 276, 324, 372,
    418, 462, 502, 538, 568, 592, 606, 612, the same on all four sources.
  - At 2×, the pan is checked frame by frame too (`checkPan` since the fix
    phase).
- **The two-up at its cut, all four sources:** the top half reads (81, 162)
  on the left face and the bottom half (1232, 378) on the right face, against
  the path's (80, 162) and (1232, 378), both in shot 4's chroma.
  - On cut − 1 the single crop holds: (848, 0) and (848, 540).
  - Shot 2 inside the two-up clip against the same frames of a clip with no
    two-up: **0.000** levels on frames 30–49. The bar is exactly 0 on the
    Mac and ≤ 1 elsewhere.
  - The last frame (209) has mean luma 115.5 / 130.0 and is shot 4: kept.
- **The sound:** 360,448 samples. The worst second difference is 0.0053, at
  sample 24,000, the clip's start; the unreframed export's own is the same
  0.0053. The A/V start is 0.00 ms in both.
- **The moments across a cut**, pulled through main's `extractMomentFrames`
  on every source: the pulled x equals the rendered x within 1 px, and the
  shot is the same on 10 of 10 frames a row. The mean difference from the
  render's frame beneath:
  - 9:16: 0.38 levels before the cut, 0.62–0.63 after;
  - the two-up's one stacked pull: 0.59–0.60 before, 0.52–0.53 after.
- **The fix phase's rows:**
  - **VFR at in-point 1**, where the first frame is half a slot past the seek
    so `fps=` alone starts on slot 1. At 1×: cuts on clip frames 30, 61 and
    168. At 0.5×: 59, 122 and 336. Within 1 px on 210 and 420 frames.
  - **A ramp, VFR at in-point 1, 1 → 0.5.** The first kept frame is 256 ticks
    past the seek. The cuts read on clip frames 31, 66 and 215, which is the
    `T` clock; `T−STARTT` would put them on 30, 65 and 214. Within 1 px over
    291 frames, with a moment across a cut.
  - **Many cuts:** 113 shots of 2 frames give 109 held keys, and the graph
    is 2,768 characters through its file: 109 jumps read, 0 frames off.
  - **A grouped sum:** 1,103 terms in 2 groups (x 23,377 characters), 210
    frames, worst 1 px.
- **An independent re-read** (the first verifier, by a different method: SAD
  template matching against its own re-synthesis of the source luma, the
  median chroma, and its own frame model from the probed pts):
  - 0 shot mismatches on 3,000 clip frames;
  - 0 px from the grid model on every frame, pans and both halves' x and y
    included;
  - every export x even;
  - template residual ≤ 1.50 levels;
  - all 80 pulled PNGs the same shot and position as the render's frame
    beneath.
  - The README's odd readings (81, 273, 849, 1137, 657) are the test
    reader's ±1, not the crop's.
- **The mutations that changed the picture, and what the check read**
  (builder R and the fix phase):

  | mutation | what the check read |
  |---|---|
  | §3.2's boundary reverted | 30 fps clip frame 23 shows shot 2 at the old x 176 |
  | the keys compiled from the clip's start | 128 frames off |
  | keyed on `n`, with `fps=` first also removed | the 60 fps keys at half time, 183 frames off |
  | the pull's crop left after its trim | 176 pulled against 1136 rendered |
  | the bottom crop given the top's keys | the bottom half reads the left face's (81, 162) |
  | `keyframeExpression` in place of the sum | the 110-key export refused, "Missing ')' or too many args" |
  | the stack dropped | about 200 frames off |
  | `fps=` ahead of the crop removed | VFR's half-stamped cut shows the old crop; pans up to 30 px off |
  | the tpad removed | frame 209 black (luma 16.0) at 30, 29.97 and 60 |
  | `start_time` dropped | "frame 29: read x 1136, model 176" |
  | a ramp on STARTT | "frame 30: shot 2 shown at x 177, its path is 1136" |
  | a group missing its last term | the grouped row fails |

**6. The floor.** Read at `f22fcd4`, not run:

| what | where |
|---|---|
| `max`, `min`, `gte` | `eval.c` :440, :441, :443, evaluated at :309, :310, :313 |
| `crop`, `fps`, `setpts`, `split`, `tpad`, `trim`, `vstack` | `allfilters.c` :176, :223, :336, :351, :372, :376, :391 |
| `split` / `vstack` | `split.c:123`; `vf_stack.c:368` |
| `fps`'s `start_time` / `round` (NEAR_INF) | `vf_fps.c:80` (offsets :159–172) / `:81` |
| `tpad`'s `stop` / `clone` / `stop_mode` | `vf_tpad.c` :54 / :57 / :58 |
| crop's per-frame x and y, `lrint`, the clamp, the low bit cleared | `vf_crop.c` :130, :263–281 |
| framesync's EOF with no pts; `fps=`'s drop on status | `framesync.c:98`; `vf_fps.c:239–240` |
| `setpts`' truncating D2TS | `setpts.c:144` |
| `-filter_complex_script`, which every render's graph goes through (§47) | `fftools/ffmpeg_opt.c` :3109, :3478 |

The 2018 code was diffed against n4.4, which the Mac reports. tpad is the
same apart from `av_cold`, and fps differs by one `*again = 1` scheduling
line. framesync's EOF is the same; its time base differs only for inputs
whose time bases differ (both halves here are on one). crop's per-frame
evaluation, clamp and snap are the same.

`sgn` first ships in 4.3 (absent from `eval.c` at `f22fcd4` and n4.2), and
the Mac's build accepts it. `randomi` first ships in 7.0, and the Mac's
build refuses it. Both are on the floor scan's blocklist. Nothing else in
`eval.c`'s function table is newer than `f22fcd4` (names diffed against
n7.1). xstack and `clip()` are both present at `f22fcd4`.

**Dated, not run, on the 2018 build: everything above.** Windows CI's
reframe.int is the run. It covers the four sources at 9:16, 1:1, 2× and the
two-up; the flat sum's `gte`, `min` and `max` in a crop's x on the 2018
parser; `fps=…:start_time=0` and its slots on media written by the 2018
muxer; speed 2's truncating `setpts`; the two-up's tpad keeping the last
frame; the slot-1 rows; a followed ramp; 110 held keys and a 1,103-term
grouped sum through the graph file; and the pulls' labelled split/vstack
inside `-vf`. It does not reach sums past about 1,100 terms (2,998 flat and
9,595 grouped are the Mac's alone), the stack depth, the pull's length on a
real long clip, smooth slow motion or 10-bit sources.

## 56. The subject analysis as a job, and the followed crop on a playing element (2026-10-13/14)

For `docs/CLIPS.md` §4.7's slice B (the job, `src/main/reframe/analyse.ts`;
the preview's frame rule, `src/shared/reframe/playback.ts`) and §4.9's
harness check (`src/renderer/src/harness/reframeCheck.ts`). Development Mac,
inside the sandbox, which has no Metal device (§37, §54): the helper's worker
ran its stand-in detector (`FORGE_FACES_WORKER_FAKE=colour`, which boxes
saturated colours), so everything here is the real shot finder, the real
helper, its worker and its ffmpeg, and not the face finder's own cost. That
is the user's run (CLIPS §4.10). Each number names who measured it: the job's
builder, the three verifiers, the fix phase, or the recorder re-running both
checks at `d8baa57` on 2026-10-14. No new filter shape: the face pass's
`fps=5:round=up` is §54's, the pts' origin §55's.

**The real detector, on the user's Mac** (2026-10-14, 06:42 and 06:46,
from the app's Terminal tab, outside the sandbox, `FORGE_REFRAME_REAL=<file>
npx vitest run tests/integration/reframeJob.int.test.ts`; the helper on
`sidecar/.venv` with mediapipe 0.10.35, the face finder seeded from
`sidecar/.venv-faces/models/`; the job's own stage clock):

| clip | probe | shots | faces | reduce | total | shots found | samples (2/s) | with a face | two | track |
|---|---|---|---|---|---|---|---|---|---|---|
| `j4aoo1qbGoE` from the ten-link set, downloaded whole: 1920×1080 H.264, 23.98 fps, 613.8 s, time base 1/24000 | 0.02 s | 23.19 s | 20.48 s | 0.01 s | **43.71 s** | 162 | 1,228 | 893 | 153 | 114,160 B |
| the face fixture: 3840×2160 HEVC, 30 fps, 26.6 s, time base 1/600 | 0.01 s | 8.86 s | 9.29 s | 0.00 s | **18.16 s** | 1 | 54 | 40 | 0 | 4,380 B |

So a 10-minute 1080p clip is analysed in 44 s on the M1 Pro, 14× realtime,
against CLIPS §4.10's 90 s bar; 4K HEVC runs at about 0.7× realtime, the
scene pass and the face pass each decoding the whole file once (the 4K
decode is the cost, as §37 and §54 measured: here 8.9 s for the scene pass's
320-wide rgb24 scan and 9.3 s for the face pass's 640-wide stream at 5 fps,
of 26.6 s of footage). Not measured: the helper's peak RSS in these runs,
and the Surface.

**The job on a synthetic clip** (`tests/integration/reframeJob.int.test.ts`,
which writes `tests/output/reframe-job/README.txt`). The clip is made in the
test: 6 s of 640×360 at 30 fps (mp4, 1/15360), lossless 4:4:4 (libx264
`-pix_fmt yuv444p -qp 0`, each square through `overlay=…:format=yuv444`, so
the colours stay saturated), three shots cut at 2 and 4 s on their
backgrounds, a 64 px red square moving through each and a 96 px blue one
beside it in the third. The job's own timing (`jobs.timing`):

| run | probe | gate | shots | faces | reduce and write | total |
|---|---|---|---|---|---|---|
| the builder, 2026-10-13 | 8 ms | 1 ms | 181 ms | 178 ms | 2 ms | 370 ms |
| the fix phase, 2026-10-14 (a busy machine) | 13 ms | 1 ms | 459 ms | 982 ms | 12 ms | 1,469 ms |
| the recorder, `d8baa57` | 8 ms | 1 ms | 177 ms | 175 ms | 1 ms | 361 ms |
| the critic, `f73416e` | 7 ms | 0 ms | 180 ms | 173 ms | 1 ms | 362 ms |

- On 6 s of 640×360 the scene pass and the face pass cost about the same, and
  the probe, the gate, the reduction and the write are noise. Nothing here
  says what a 10-minute 1080p file costs: the scene pass was 2.86–3.06 s for
  60 s of 1080p (§52), and the face pass on 4K HEVC is decode-bound (§54).
- The track: 3 shots at pts 0, 30720 and 61440 on 1/15360 (each ffprobe's
  `best_effort_timestamp` for its frame); 12 samples at 0, 400, 1000, 1400 …
  5400 ms, each box one source frame's within 1 px, each the frame on screen
  at its label (offset 0; +2 frames before `round=up`, §54); 1,776 B at
  `11670-<mtime>-v1.json` (1,755 B in the builder's run, before the fix phase).
- **From disk**: the same file again answers `cached: true` in 8 ms (27 ms in
  the fix phase's run, 9 ms in the critic's), with no scene pass and no worker. A track on disk cut
  at another threshold or another shortest shot, or reduced from another
  face-track version or one with no version, is analysed again, with exactly
  one scene pass.
- **The gate first**: without the face finder on disk the job fails
  `model-missing` with no scene pass, no worker and nothing fetched (a dead
  proxy set, the models folder still empty after); with no helper — an
  interpreter that is not there, or a bare venv where `vision.faces` is
  degraded — `no-helper` before any scene pass.
- **The methods asked** (a stand-in helper client recording them): a whole
  job asks `vision.facesModel` and `vision.faces` and nothing else — no
  salient, no ground (§16.35).
- **Progress** stays inside each stage's range, never goes back, and never
  reads 1 while running. The stages seen are "finding the shots", then
  "finding faces": the queue drops a report within 150 ms of the last, and
  the reduction's 1–12 ms never shows.

**Cancelling it:**

| where | who | the bar at the press | cancelled after | what was left |
|---|---|---|---|---|
| mid-faces, the real helper | the builder; the fix phase; the recorder; the critic | 0.228 | 27 ms; 28 ms; 26 ms; 26 ms | the worker and its ffmpeg gone (`process.kill(pid, 0)`; `ps` is blocked here), nothing written, no part file in the helper's cache, `ping` answered; a job queued behind it cancelled without running |
| mid-shots, 120 s of 720p, a stand-in client | the job's verifier | 0.021 | 5 ms | the scene pass's ffmpeg ended by SIGKILL; collect answers `failed`/`cancelled` |
| mid-shots, a 20 s 4K clip, a stand-in client | the fix phase (two runs); the recorder; the critic | 0.033, 0.014; 0.033; 0.033 | 27 ms, 26 ms; 26 ms; 26 ms | the scene pass's ffmpeg exited non-zero |

Without the abort signal handed to `findShots` the job read cancelled only
when the scene pass ended on its own: 3,086 ms on the verifier's 120 s clip,
1,758 ms in the fix phase's test against its 1 s bar. Without it on the faces
request, 3.97 s against that test's 1 s bar (the builder's mutation). Both are
pinned.

**The followed crop on a playing element** (§4.9's harness check, the harness
page on :5199, a fronted Chromium tab, 1510×1017 at dpr 1). The video is one
the check records in the page with MediaRecorder: 6 s of 640×360 at 30 fps,
webm, 16 px columns 9° of hue apart, so a crop that moved sideways reads as
moved. Each frame the element presents is read through
`requestVideoFrameCallback` once the preview has painted: its `mediaTime`
through `exportFrameAt` is the element's clip frame, the store's playhead is
the other, and near each cut the Output is compared with the source frame
drawn through each frame's crop (mean |difference| over RGB, 0..255). The
preview re-seeks an element more than 0.18 s from the playhead
(`Preview.tsx` `DRIFT_TOLERANCE`).

| run | as it plays: frames, drift (playhead − element) | nudged ±3 frames through the cuts: frames, drift | near-cut frames whose two crops differ | drawn at the element's frame |
|---|---|---|---|---|
| the builder, 2026-10-13 | 177, 0 on every frame | 174, −3..+5 | 7 | 7 (0.79–1.01 against 73.8–107.0) |
| the UI verifier, three runs | 176–177; 0..+1 (mean 0.51), −1..0, 0..0 | 175–177, −3..+5 | 1 as it played (element 119, playhead 120); 6 and 4 nudged | all (0.81 against 74.7; 0.79–0.92 against 74.2–107.0) |
| the fix phase, after `e0472d9` | 0..+1 | −3..+6 | — | all |
| the recorder, `d8baa57` | 177, 0 on every frame | 177, −3..+5 (mean −0.56) | 4 | 4 (0.65–0.68 against 74.4–107.0) |
| the critic, `f73416e` (1482×870) | 175, 0..+1 (mean 0.78) | 175, −3..+5 (mean 1.47) | 2 as it played, 8 nudged | all (0.34–0.40 against 74.0–106.9) |

- In the harness the element and the playhead keep step to within a frame,
  so playing alone the two rules almost never disagree; the nudge is what
  makes them. A fixed +0.1 s nudge was lost (a play can start with the
  element already 4 frames ahead), so the check sets a target drift instead.
- Where they disagree, the picture is the element's frame and so must the
  crop be: reading it from the playhead would put the new shot's crop on the
  old shot's last frames, or the reverse, for as many frames as the drift.
  Under a real decoder's load the drift may be larger (up to the 0.18 s
  re-seek); the rule does not depend on its size.
- **Scrub on, a clip with no sound**: stopping playback left the element
  playing to the end of its file behind the stopped playhead (`stillPlaying`
  true on every pass before `e0472d9`; one compare failed by 3.4/255 until the
  check paused the element itself). Only a sounding element got the scrub
  burst that pauses it; `scrub.ts` `leftToScrubBurst` now leaves only those
  to it, and `stillPlaying` is false on both passes.
- **Paused at 0.5×, not measured on screen** (arithmetic, pinned in
  `tests/reframePlayback.test.ts`): the cut's key is on clip frame 58 (2 ×
  source 29); paused at 57 the crop is the old shot's (x 176) while
  `sourceFrameFor` seeks the element to source 29, the new shot's first. One
  frame per cut shows the new picture through the old crop. Open (CLIPS
  §4.7's slice B Left).

**An export at another canvas** (the store's builder, on `buildRenderPlan`'s
text). A 16:9 project with a followed 1920×1080 clip, exported at 1080×1920:
before `followCanvas`, `crop=w='min(1920,in_w)'…` (the 16:9 project has
nothing to follow) and then `scale…decrease,pad`, letterboxed; after,
`fps=30:start_time=0,crop=w='min(608,in_w)'…` with the 9:16 keys
(`+960*gte(t,0.750000)`), the text the 9:16 project's own chain has; at
720×1280 the same crop. No new shape: §55's, at the export's canvas.

## 57. The AI helper's pack — the pinned archives read (row 26), the lock and its completeness check, one helper process, and the protocol's encoding under -E (row 38) (2026-10-14)

For `docs/CLIPS.md` §3a.1 and §3a.2, Step P's slice A (`f39a47a` …
`4dae71d`, not pushed). Development Mac (M1 Pro, macOS 26.5.2), inside the
dev sandbox: no Metal (§37, §54), and the macOS trust store unreachable
from pip (OSStatus −26276). No filter shape is added: nothing
here reaches a render. Each number names who measured it: the sources'
builder (row 26 and the lock), the helper's builder (row 38, the client,
the worker), three verifiers (the pins and the lock; the order and the one
process; the slice against the plan), the fix phase, or the recorder (the
test counts at `4dae71d`). The plan's own numbers, from PyPI's JSON, byte
ranges and its reviewers, are in CLIPS §3a.1; this section is what a
download, a run or a test measured.

### Row 26: the pinned interpreter archives, read

**The download** (the sources' builder; both re-hashed by a verifier):

    curl -L --fail -sS -o row26/<mac|win>.tar.gz \
      -w '%{url_effective} %{http_code} %{num_redirects} %{size_download} %{time_total}' \
      https://github.com/astral-sh/python-build-standalone/releases/download/20261001/<asset, + as %2B>

| archive | answered | bytes | time | `shasum -a 256` |
|---|---|---|---|---|
| Mac, `…aarch64-apple-darwin-install_only_stripped.tar.gz` | 200 after one redirect to `release-assets.githubusercontent.com/github-production-release-asset/162334160/f66ebd77-…` | 26,680,498 | 1.12 s (23.7 MB/s) | `69e48cd7f54261df5b6abbd374f69fe6e496fa781d271592aeef49cd5ffbea6c`, the pin |
| Windows, `…x86_64-pc-windows-msvc-install_only_stripped.tar.gz` | 200 after one redirect to `…/162334160/e346795a-…` | 23,227,899 | 1.18 s (19.7 MB/s) | `b7ff8b700995379e425b39abce9b087d84a45aa265ea465c0069c2747ea5b2ea`, the pin |

- `objects.githubusercontent.com` was never contacted.
- `xattr -l` on both: `com.apple.provenance` only, no `com.apple.quarantine`
  (a curl download; a browser's is row 31's).
- GitHub's release API, read by a verifier through `pack_lock.py`'s own
  `check_github()`: `20261001`, published 2026-10-01T22:37:31Z, both assets
  equal to the pins by size, `digest` and `browser_download_url`.

**The tar streams.** `python3 -I census.py <archive>` walks the gunzipped
stream's 512-byte headers itself and cross-checks with `tarfile` (the
builder; a verifier's own walk gave every number again):

| | Mac | Windows |
|---|---|---|
| tar stream (= the gzip trailer's ISIZE) | 69,373,952 B | 63,301,120 B |
| the plan's reading, the `20261013` build | 69,430,272 B (this build 56,320 B less) | 63,299,584 B (this build 1,536 B more) |
| members | 1,698: 1,689 regular files, 9 symlinks | 2,190, all regular files |
| sum of the members' sizes | 68,060,050 B | 61,643,159 B |
| names over 100 characters | 9, all through the ustar prefix field: eight `pip-26.2.1.dist-info` licence files and `pip/_vendor/urllib3/contrib/emscripten/emscripten_fetch_worker.js` | 6, all through the prefix field: pip `.pyc` |
| longest member | 106: `python/lib/python3.14/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/cachecontrol/LICENSE.txt` | 105: `python/Lib/site-packages/pip/_internal/resolution/resolvelib/__pycache__/found_candidates.cpython-314.pyc` |
| longest directory | 97 | 86 |
| modes | 1,670 × 0664, 19 × 0775 | 2,176 × 0666, 14 × 0777 |

- Both are POSIX ustar (`ustar\0` `00`) ending in two zero blocks, with **no
  PAX** `x` or `g` record, **no GNU** `L` or `K` record, **no hard link**
  and **no directory entry**.
- Owner 0:0 (root); every member's mtime 1704067200 (2024-01-01T00:00:00Z).
- No name illegal on Windows, no two names differing only by case, no
  duplicate.
- The Mac's 9 symlinks are all relative and resolve inside `python/`, each
  target in the archive: `bin/python` and `bin/python3` → `python3.14`,
  `bin/idle3` → `idle3.14`, `bin/pydoc3` → `pydoc3.14`, `bin/python3-config`
  → `python3.14-config`, `lib/pkgconfig/python3.pc` → `python-3.14.pc`,
  `lib/pkgconfig/python3-embed.pc` → `python-3.14-embed.pc`, and
  `share/man/man1/python.1` and `python3.1` → `python3.14.1`.

**The Mac's tree, unpacked** (`tar -xzf` into a scratch folder; every run
from `$TMPDIR`):

- `python/bin/python3.14` is a regular file, 18,952,864 B, mode 0775;
  `python3` and `python` are relative links to it. `python/lib/libpython3.14.dylib`
  (18,952,736 B) is there and the executable does not link it.
- `python3.14 -I -c …`: `sys.version` `'3.14.8 (main, Oct 1 2026,
  20:50:07) [Clang 22.1.3 ]'`; `sys.executable` and `sys.prefix` the tree;
  `sys.path` `lib/python314.zip` (absent on disk), `lib/python3.14`,
  `lib/python3.14/lib-dynload`, `lib/python3.14/site-packages`; flags
  isolated 1, ignore_environment 1, no_user_site 1, dont_write_bytecode 0,
  safe_path True. With `-E -s -B`: `''` first, then the same four, and
  safe_path False. Through the `python3` link, `sys.executable` is
  `…/bin/python3` with the same prefix.
- `python3.14 -I -m pip --version`: "pip 26.2.1 from
  …/python/lib/python3.14/site-packages/pip (python 3.14)". `python/bin`
  also holds `pip`, `pip3` and `pip3.14`, 234 B `/bin/sh` trampolines that
  exec the `python3.14` beside them (pip's RECORD, 886 lines, lists
  `../../../bin/pip` at 208 B), and `idle3.14`, `pydoc3.14`,
  `python3.14-config`. `find … -name 'EXTERNALLY-MANAGED*'`: nothing.
- `python3.14 -I -B -c "import ssl; …"`: OpenSSL 3.5.9 29 Sep 2026;
  `get_default_verify_paths()` names cafile `/private/etc/ssl/cert.pem`
  (333,483 B on this Mac) and capath `/private/etc/ssl/certs`;
  `create_default_context()` loads 128 CA certificates. `_ssl`, `_hashlib`,
  `_sqlite3` and zlib are **built into the executable** (101 built-in
  modules); `lib-dynload` holds only `_dbm` and `_tkinter`. `import _ssl,
  sqlite3, zlib, lzma, bz2, ctypes, _decimal, _ctypes, hashlib` works:
  sqlite 3.53.1, zlib 1.2.12 (the system's), tk 9.0.
- `codesign -dv --verbose=2` on `python3.14` and on the dylib:
  `Identifier=-`, `flags=0x20002(adhoc,linker-signed)`, `Signature=adhoc`,
  TeamIdentifier not set; `codesign --verify --strict`: "valid on disk",
  "satisfies its Designated Requirement". `xattr -l`: `com.apple.provenance`
  only.
- `otool -L python3.14`: CoreFoundation, SystemConfiguration and
  `/usr/lib`'s `libSystem.B`, `libz.1` (1.2.12), `libedit.3`,
  `libncurses.5.4` and `libpanel.5.4`, so only `/System` and `/usr/lib`;
  `otool -l`: `LC_RPATH @executable_path/../lib`, minos 11.0.
- `du -sk` of a copy nothing was run in: 70,320 KiB (apparent 67,017); 1,689
  files, 9 symlinks, 160 directories.
- CPython's licence is `python/lib/python3.14/LICENSE.txt`, 13,804 B. There
  is no `python/LICENSE.txt`, no `PYTHON.json` and no `licenses/` folder.

**The Windows tree** (unpacked on the Mac and read as data with a PE reader,
`pe.py`; never run):

| beside `python/python.exe` | bytes | what |
|---|---|---|
| `python.exe` | 91,648 | x64, console subsystem, FileVersion 3.14.8150.1013, unsigned |
| `pythonw.exe` | 90,112 | GUI subsystem |
| `python314.dll` | 6,592,512 | unsigned |
| `python3.dll` | 59,392 | |
| `vcruntime140.dll` | 124,544 | 14.44.35211.0, Authenticode-signed (20,608 B) |
| `vcruntime140_1.dll` | 49,792 | 14.44.35211.0, Authenticode-signed (20,608 B) |
| `LICENSE.txt` | 23,601 | CPython's licence |

| in `python/DLLs/` | bytes | FileVersion |
|---|---|---|
| `_ssl.pyd` | 178,688 | — |
| `_sqlite3.pyd` | 120,320 | — |
| `libcrypto-3-x64.dll` | 7,856,640 | 3.5.9.0 |
| `libssl-3-x64.dll` | 1,571,840 | 3.5.9.0 |
| `sqlite3.dll` | 1,607,680 | 3.53.1.0 |
| `zlib1.dll` | 102,912 | 1.3.2.0 |
| `libffi-8.dll` | 28,160 | — |
| `libtommath.dll` | 81,408 | — |
| `tcl90.dll` | 3,369,299 | 9.0.2.4, which is Tcl 9.0.4 final |
| `tcl9tk90.dll` | 2,138,360 | — |

- `DLLs/` holds 34 `.pyd`, the `_test*` modules among them. `python/tcl`
  holds `dde1.4`, `registry1.3` and `tk9.0`; `Lib/venv` is there, with
  `venvlauncher.exe` and `venvwlauncher.exe`.
- **No `._pth` and no `.pth` anywhere**, so nothing restricts `sys.path`.
- `Scripts/` holds only a 0 B `.empty`: no `pip.exe`, though pip's RECORD
  still lists `pip.exe`, `pip3.exe` and `pip3.14.exe` at 108,393 B each.
  pip 26.2.1; no `EXTERNALLY-MANAGED`.
- **The C runtime.** No `msvcp140`, `vcomp` or `concrt` DLL is in the tree,
  and none of its 58 PE files imports one: 46 import `VCRUNTIME140`, 1
  imports `VCRUNTIME140_1`, and the rest of the C runtime comes through
  `api-ms-win-crt-*`, the Universal CRT that ships with Windows.
- **Signatures.** Only the two `vcruntime` DLLs carry one; `python.exe`,
  `python314.dll` and every other PE file are unsigned (row 32's question).
- `du -sk` on APFS: 65,044 KiB (apparent 60,876); 2,190 files, 227
  directories.

**The `.pyc`: none usable on either platform.** Counted from each archive's
own member list (`pyc_count.py`) and their headers read (`pyc_headers.py`).
The builder's first runs with `-I` and no `-B` wrote 236 `.pyc` into its
working copy, so no count comes from a tree that was run.

| | Mac | Windows |
|---|---|---|
| the standard library's `.py` | 655 | 655 |
| its `.pyc` shipped | 3 (`encodings/__init__`, `aliases`, `utf_8`) in 1 `__pycache__` | 168 in 26 `__pycache__` |
| pip's `.py` / `.pyc` shipped | 404 / 0 | 404 / 404 in 52 `__pycache__` |
| the source mtime each `.pyc` records | 1790887887 (2026-10-01T20:51:27Z) | 1790790909 (2026-09-30T17:55:09Z) for the 168, 1790888533 (2026-10-01T21:02:13Z) for pip's |
| the member's own mtime | 1704067200 | 1704067200 |

Every one is timestamp-based, and so every one is stale once unpacked:
`python3.14 -E -s -B -v -c pass` prints "bytecode is stale" for each of the
Mac's three. Under `-B` that means the whole standard library is compiled
in memory at every start.

**Compiling once** (each on a fresh copy):

| | Mac | Windows (its tree, compiled on the Mac) |
|---|---|---|
| command | `python3.14 -I -m compileall -q -j 1 python/lib/python3.14` | the pinned `python3.14 -I -B -m compileall -q -j 1 -d 'C:\Users\abcdefghij\AppData\Roaming\Forge\python\1\python\Lib' <copy>/python/Lib` |
| time | 2.22 s real, 1.47 s user; exit 0 | 2.03 s real, 1.48 s user, 0.36 s sys |
| `.pyc` it leaves | 1,059 (655 + 404) in 104 `__pycache__`, 19,043,394 B | 1,059, 18,891,318 B |
| the stale ones it replaced | 3, 22,152 B | 572, 10,219,185 B |
| the tree, apparent bytes | 68,060,050 → **87,081,292 B** | 61,643,159 → **70,315,292 B** |
| `du -sk`, files, longest path / directory | 70,320 → 91,028 KiB; 2,745 files; 116 / 97 | — |

- `-j 0` failed in the sandbox with `PermissionError` on
  `os.sysconf("SC_SEM_NSEMS_MAX")`: it needs multiprocessing's semaphores.
  Outside the sandbox it is unmeasured.
- A `.pyc` is CPython-version-specific, not platform-specific; `-d` gives
  Windows' copies a Windows-length `co_filename`, the one thing that
  differs.
- **What it buys**, `/usr/bin/time -p python3.14 -E -s -B -c "import json,
  asyncio, ssl, subprocess, concurrent.futures, logging, urllib.request,
  email.parser, http.client, hashlib, sqlite3, ctypes, importlib.metadata,
  tempfile, zipfile, shutil, argparse, dataclasses, typing"`, seven runs
  each: **0.67 s first, then 0.34–0.37 s** on the tree as unpacked; **0.07 s
  every run** once compiled. `-c pass` is 0.01–0.02 s either way.
- `--invalidation-mode unchecked-hash` would free the `.pyc` from the
  unpacked mtimes: an option, unmeasured.

**What the manifest's `bytesOnDisk` carries before CI** (the fix phase,
`4dae71d`, regenerated with the dev venv's python; the locks,
`resolved.json` and `history.json` byte-identical, so still pack 1):

| | Mac | Windows |
|---|---|---|
| the interpreter as it will sit on disk (above) | 87,081,292 B | 70,315,292 B |
| the first generation added instead | 69,430,272 B (the `20261013` tar, no compile) | 63,299,584 B (likewise) |
| `bytesOnDisk` was | 657,373,331 B | 721,471,263 B |
| `bytesOnDisk` now | **675,024,351 B** | **728,486,971 B** |
| `formatBytes` (binary GiB) | "0.6 GB" | "0.7 GB" |

CI's install (CLIPS §3a.8 row 28) replaces both. For the packages the Mac's
figure is the dev venv's; the builder's own count of it today was
587,943,059 B in 10,728 files, longest path 161, longest directory 107.

**Electron's two version numbers.** A throwaway main script under Electron
44.3.0 on this Mac (`sw_vers` 25F84): `process.getSystemVersion()` `'26.5.2'`,
`os.release()` `'25.5.0'`, `app.runningUnderARM64Translation` `false`; under
`ELECTRON_RUN_AS_NODE`, `process.getSystemVersion` is `undefined`. So a
caller passing the Darwin number would read macOS 13 (Darwin 22) as 22 ≥
14, and `packPlatform` refuses a major of 17 to 25 as unreadable. Whether
macOS 26 reports `16.0` to a binary built against an older SDK is
unmeasured, which is why 16 is left alone.

**What row 26 settles:**

1. **The standard library is compiled once at install, on both
   platforms** (CLIPS §3a.3's stage 2), with `-j 1`.
2. **`EXTERNALLY-MANAGED` is absent from both**: pip needs no
   `--break-system-packages`, and nothing is removed at install.
3. **The interpreter's names are the manifest's `python` fields**,
   `python/bin/python3.14` and `python/python.exe`; `pack_lock.py` did not
   change.
4. **The tar reader:** nothing in either archive is a type it refuses
   (regular files, and relative symlinks inside the root), so `tar` 7.5.x is
   not needed as a fallback. It must read the **ustar prefix**, which
   carries every long name (no PAX record exists to carry one), **create
   parent folders itself** (no directory entries), and keep the mode's
   executable bit.
5. **The interpreter needs no Visual C++ redistributable on Windows**: the
   question of CLIPS §16.45 and row 30 is the wheels' alone.
6. **The path budget:** the interpreter's own longest (106 / 97 on the Mac,
   116 once compiled; 105 / 86 on Windows) sits well under the
   site-packages paths the manifest already budgets (161 / 107 and 150 / 96).

**Open, the Surface's half:** `sys.winver`, and `sys.path` with a planted
HKCU `SOFTWARE\Python\PythonCore\<winver>\PythonPath` subkey, with and
without `-E`.

### The lock and its completeness check

**The generator** (`sidecar/.venv/bin/python -I scripts/pack_lock.py`,
reaching only pypi.org and files.pythonhosted.org for metadata; exit 0):

| target | lines | wheel bytes | with the interpreter | the button | the lock's sha256 |
|---|---|---|---|---|---|
| darwin-arm64 | 47 | 151,510,094 | 178,190,592 | "170 MB" | `9932ef367815154f64b4ac4a23a00d0b5f676933727db07f87f74e1bf8ce12d7` |
| win32-x64 | 48 | 191,876,652 | 215,104,551 | "205 MB" | `6ec443867588fb032a51a52db199506013b4b79c92d2455ba0540b42b61c931f` |

- It printed every requirement met on both targets but mediapipe's two
  (allowlisted), and win32-x64 beyond darwin-arm64 as colorama only.
- The locks are ASCII and LF only (a verifier: no non-printable byte), and
  `git show HEAD:<lock> | shasum -a 256` gives the same two hashes. Their
  first generation carried "§" in the header and hashed `008c3ac4…` /
  `1575ca29…`; pip reads a requirements file without a BOM in the Windows
  code page, so the script now refuses a non-ASCII lock.

**Independently** (a verifier, against the committed files):

- **pip's own pick.** `sidecar/.venv/bin/python -I -m pip install --dry-run
  --ignore-installed --no-deps --only-binary=:all: --platform
  <macosx_14_0_arm64 | win_amd64> --python-version 3.14 --implementation cp
  --abi cp314 --report …`, with
  `--use-deprecated=legacy-certs --cert <certifi>` (truststore fails in the
  sandbox, OSStatus −26276): exit 0 for both. For all 47 and 48 wheels the
  pick has the manifest's filename, URL and sha256; PyPI's JSON for all 48
  distributions gives the same sha256, size and URL, none yanked;
  `resolved.json`'s file entries are identical; every host is
  files.pythonhosted.org; no `cp314t` anywhere.

  | sampled | picked | over |
  |---|---|---|
  | onnxruntime, Mac | `cp314-cp314-macosx_14_0_arm64`, 21,545,313 B | nothing: the release has no universal2 or x86_64 Mac wheel |
  | av, Mac | `cp311-abi3-macosx_14_0_arm64`, 18,217,603 B | its `cp314t` twin |
  | scipy, Mac | `macosx_14_0_arm64`, 20,466,839 B | `macosx_12_0_arm64`, 28,725,221 B |
  | scipy, Windows | `cp314-cp314-win_amd64`, 37,362,755 B | `cp314t`, 37,416,961 B |
  | hf-xet, both | `cp38-abi3`, 3,876,287 / 4,033,128 B | `cp314t` |
  | colorama, Windows | `py2.py3-none-any`, 25,335 B | — |

- **The pinned interpreter's own pip** (the untouched tree, `-I -B`;
  `platform.mac_ver()` 26.5.2, sysconfig `macosx-11.0-arm64`, 1,412
  `sys_tags`) accepts the tags of all 47 Mac wheels and rejects
  `cp314t-cp314t-macosx_14_0_arm64`.
- **Completeness from the wheels' own METADATA.** The 67 picked wheels'
  PEP 658 METADATA, fetched with curl and evaluated with a marker
  environment of the verifier's own (`platform_release` and
  `platform_version` filled in): 0 unmet on darwin-arm64 (47 lines) and on
  win32-x64 (48) beyond mediapipe's `matplotlib` and `opencv-contrib-python`;
  tqdm requires colorama on win32 and nothing on darwin; the dependency
  names per target equal `resolved.json`'s `targets[t].requires` for all 95
  entries. A scratch Windows lock without colorama, numpy or
  typing-extensions fails, naming it; so does the script's own
  `completeness()`, fed the real METADATA: `tqdm -> colorama ("colorama;
  platform_system == "Windows"") is not in the win32-x64 lock`; and numpy
  pinned to 1.0.0 fails on librosa's and numba's specifiers.
- **Reproducible.** The script copied into a scratch tree with its inputs
  and re-run (pack_lock.py has no `--out`): `diff -r` against a copy taken
  before the run reports them identical.
- **pip's parse of the locks.** `pip install --dry-run --require-hashes
  --no-deps --no-index --only-binary=:all: --ignore-installed -r <lock>` from
  an empty folder exits 1 on both with "No matching distribution found for
  absl-py==2.5.0", no parse error. A syntax error appended at the end is
  reported first ("Invalid requirement", "no such option: --bogus"), so pip
  reads the whole file before it resolves; but a `--hash=sha256:XYZ`, or an
  unhashed line, appended is not reported before resolution. So the run
  proves the syntax only; the hash form is held by the manifest test's
  count of every `--hash=`.

**The check CI runs** (`tests/packLock.test.ts`, from `af61545`): over
`resolved.json`, each evaluated requirement's specifier is read from the
distribution's raw `requiresDist`, the one line naming it without an extra
marker; all 143 in pack 1 have exactly one. The locked version must satisfy
it by a PEP 440 subset (`==`, `!=`, `<`, `<=`, `>`, `>=`, `~=`, `==N.*`,
a/b/rc, `.post`, `.dev`, with a `.devN` before its pre-releases, which
llvmlite's `>=0.49.0dev0` needs). A scratch copy with numpy at 1.0.0 in both
the lock and `resolved.json` fails on both targets with "librosa ->
numpy>=2.1.0, but the lock has numpy==1.0.0", the script's own wording.

### One helper process

**Before** (CLIPS §3a, a reviewer, with `client.ts` and a fake helper that
answers hello after 1.5 s): `start()`, then `start()` 300 ms later, answered
from two pids, 7087 and 7099.

**After** (a verifier's scratch tests against the built `client.ts` and
`tests/fixtures/fake-helper.mjs`, `ps -p` after each, deleted after):

| case | what happened |
|---|---|
| 5 `start()` and 3 `request()` calls during a 400 ms hello | exactly 1 spawn |
| SIGKILL of the helper during its hello | both waiters rejected "stopped" within 3 s; the restarts spawned one at a time; no pid alive after `stop()` |
| a hello timeout with `maxRestarts: 2` | 3 spawns, at most 1 alive at any 20 ms sample, all dead after |
| `stop()` during a hello that never answers, the helper ignoring stdin's end | `start()` and `request()` rejected "shutting down"; `stop()` and `idle()` resolved; the pid gone |
| `stop()` during a hello, the helper honouring stdin's end | resolved in under 1.4 s |
| a request after `gaveUp` | one new helper spawned |

- **A missing interpreter** (Node 24.18.1, the shell's; Electron 44.3.0
  carries 24.20.0): `spawn` emits `'error'` (ENOENT) and then `'close'` (−2,
  null), and **no `'exit'`**. So the client reads a child's end from
  `'close'` too: with `'exit'` alone, `stop()` on a child that never
  started hung past its test's timeout.
- **The Windows stop** is measured here only through a stand-in `taskkill`
  that kills the pid and exits 300 ms later: `stop()` and a timed-out start
  resolve only after it has exited (three mutations each fail "taskkill had
  exited when stop() resolved"); a `taskkill` that cannot start costs a
  SIGKILL, and the stop ends well inside the grace plus 1.5 s; with that
  error path not resolving, the stop was held 11.5 s, to
  `TREE_KILL_WAIT_MS` (10 s) after the grace. The real `taskkill /f /t` and
  a worker's death under it: CI's Windows job and the Surface.
- The sandbox prints "ERROR: failed to copy trust settings of system
  certificate-25291" for each Node child it spawns: noise, not a failure.

**The order and the launch** (the same verifier, 12 scratch cases against
CLIPS §16.42 (b), deleted after). Development FORGE_PYTHON → venv → dev
pack → `python` on win32 / `python3` on darwin; packaged pack → FORGE_PYTHON
→ absent, an empty FORGE_PYTHON read as absent; damaged (unparseable,
`null`, `{}`, the interpreter gone) beats FORGE_PYTHON when packaged and not
the venv in development; an unsupported platform skips the pack, damaged
included; a receipt for another platform, lock or interpreter falls through
even with its interpreter gone. The pack's argv is exactly `['-E', '-s',
'-u', '-B', '-m', 'forge_sidecar']` in both modes and no rung has `-I`; on
win32 `PythonPath`, `pythonhome`, `Hf_Token`, `HF_ENDPOINT`, `PYTHONPATH`,
`Forge_Models_Dir` and `hf_hub_disable_xet` are all gone and the app's four
keys are present, one spelling each. **The development rungs' environment
is byte-identical to the old `sidecarEnv`** (`git show 0875608:src/main/sidecar/client.ts`,
lines 39-53) by `JSON.stringify`, key order included, on win32 and darwin.

**`sidecar.int` on two interpreters** (a verifier): 18 of 18 on the venv;
18 of 18 with `FORGE_PYTHON` a bare 3.14 venv made by `/opt/homebrew/bin/python3
-m venv --without-pip` (numpy will not import), which starts as `-m
forge_sidecar` with `plainHelperEnv`, the PATH rung's shape. CI sets no
`FORGE_PYTHON` and makes no venv, so its Windows job resolves to `python -m
forge_sidecar`.

**The pack's launch by hand, on the venv** (a verifier): `printf
'<hello>\n<ping>\n' | env -u PYTHONPATH -u PYTHONIOENCODING -u
PYTHONUNBUFFERED LC_ALL=<C | en_IE.ISO8859-1> .venv/bin/python -E -s -u -B
-m forge_sidecar` from `sidecar/`: exit 0 in both locales; hello carries
`executable`, `prefix` and a `path` of 5 entries, `sidecar/` first; the
ping's echo of "Bräutigam ಕನ್ನಡ.mp4" came back as its own UTF-8 bytes,
`4272c3a4…e0b2a12e6d7034`, in both.

### Row 38: the protocol's encoding under `-E`

**The probe** (the helper's builder, the venv's CPython 3.14.6):

    ROW38_MODE=<decode|encode> LC_ALL=<locale> LANG= node row38.mjs sidecar/.venv/bin/python "<label>" <flags…>

It spawns `python <flags> -c <probe>` with cwd `sidecar/` and every `PYTHON*`
variable removed. The probe registers an `atexit` hook that reports
`sys.stdin`, `sys.stdout` and `sys.stderr`'s `.encoding` and `.errors` and
`sys.flags.utf8_mode`, then runs `runpy.run_module("forge_sidecar",
run_name="__main__")`; the driver sends `system.hello`, then `system.ping`
echoing "Bräutigam 5:30pm ಕನ್ನಡ.mp4". **Two modes, because a plain echo is
blind under Latin-1**: every byte maps both ways, so it round-trips even
when both directions are wrong. `decode` sends raw UTF-8 and forces the
replies to `ensure_ascii`, so what Python read shows; `encode` sends a
pure-ASCII request with `\u` escapes, so only what Python wrote is tested.
A "—" is a value the run did not record.

| launch | locale | stdin, stdout | stderr | `utf8_mode` | read (decode) | written (encode) |
|---|---|---|---|---|---|---|
| `-E -s -u -B` | `C` | utf-8 / surrogateescape | — | 1 | right | right |
| `-E -s -u -B` | `en_IE.ISO8859-1` | **iso8859-1 / strict** | iso8859-1 / backslashreplace | 0 | **`'Br\xc3\xa4utigam 5:30pm \xe0\xb2\x95\xe0\xb2\xa8\xe0\xb3\x8d\xe0\xb2\xa8\xe0\xb2\xa1.mp4'`** | **an error reply: "'latin-1' codec can't encode characters in position 59-63: ordinal not in range(256)"** |
| `-X utf8 -E -s -u -B` | `C`, `en_IE.ISO8859-1`, `en_US.UTF-8` | utf-8 / surrogateescape | — | 1 | right | right |
| today's dev launch: no flags, `PYTHONIOENCODING=utf-8` | — | utf-8 / strict | utf-8 / backslashreplace | — | right | right |
| `-E -s -u -B` with `__main__.utf8_stdio()` (`2700e2c`) | `C`, `en_IE.ISO8859-1`, `en_US.UTF-8` | utf-8 / strict | utf-8 / backslashreplace | — | right | right |

Where right, the reply's bytes for the path are its own UTF-8:
`4272c3a475746967616d20353a3330706d20e0b295e0b2a8e0b38de0b2a8e0b2a12e6d7034`.

- **`LC_ALL=C` cannot show the fault**: Python turns UTF-8 mode on by
  itself in the C locale. The fault needs a real 8-bit locale.
- **Decided: the reconfigure.** `utf8_stdio()` runs first in `main()` and
  gives exactly what `PYTHONIOENCODING=utf-8` gave, strict on the protocol's
  two streams and `backslashreplace` on the log, as the same code on every
  rung. `-X utf8` round-trips too, but gives stdin and stdout
  `surrogateescape`, changes every `open()`'s default encoding, and would be
  a flag on one rung only.
- The face worker sets its own stdout and stderr the same way
  (`mp_faces._utf8_stdio`); its spec arrives as bytes on fd 0, written by
  the helper as `json.dumps(…).encode('utf-8')` with `ensure_ascii`, so pure
  ASCII, and the helper decodes the worker's lines as UTF-8 with `replace`.
  `test_faces.py`'s "error input" line naming 'ಕನ್ನಡ Bräutigam' reaches the
  helper as UTF-8 under Latin-1.
- **Open: Windows.** A pipe there takes the ANSI code page (cp1252 on most
  machines, read in CPython's behaviour, not measured here). `sidecar.int`'s
  two row-38 tests set no locale on win32, so CI's Windows job runs them on
  that code page first; then the Surface.

### The face worker through its bootstrap

`<sys.executable> -E -s -B -c <bootstrap>`, the bootstrap putting
`forge_sidecar/stubs` first and the package's folder second on `sys.path`
and running `forge_sidecar.workers.mp_faces` with `runpy` (from
`tests/output/faces/README.txt`, faces.int's import test):

| worker | result |
|---|---|
| through the bootstrap, the stubs first | `ready 0.10.35 0.076`, 143 ms wall (§54's start was 0.14–0.23 s) |
| the stubs taken off the bootstrap's path | exit 69, `error import ModuleNotFoundError: No module named 'cv2'` |
| the real detector, in the sandbox | −6 after a clean import (no Metal, §54) |
| a stop mid-pass | the helper exited by itself 281 ms later, no worker left |

`-E` on the worker keeps a planted `PYTHONPATH` holding a `cv2` of its own
off the worker's path (`test_faces.py`, 42 tests, `OK` on the venv under
`unittest`; three mutations of the bootstrap each fail it). With the
shell's `FORGE_FACES_WORKER_FAKE=colour`, faces.int read 2 failed and 11
passed before `c232b4a` (the import test's half predates slice A: at
`0875608` it failed the same way); now 13 passed and 2 skipped either way.

### The suites at `4dae71d`

Run by the recorder to a file, exit 0: `helperPython` 23, `helperLaunch`
16, `helperPackManifest` 45, `packLock` 11, `sidecarClient` 12,
`sidecarService` 28, `sidecarFolders` 5, `reframeContract` 13 and
`sidecar.int` 18: 171 passed in nine files. Typecheck green on both
configs before every commit of the slice.

### Still unmeasured, and whose

- **The Surface:** row 26's `sys.winver` and the planted HKCU `PythonPath`
  with and without `-E`; row 38 on Windows pipes; row 29's cold hello from
  the pack after an install and after a reboot, which sets the pack's hello
  ceiling (`PACK_HELLO_TIMEOUT_MS` is a 90 s placeholder, against 30 s on
  the development rungs); the real tree kill, and SmartScreen or Defender
  on the unsigned `python.exe` (row 32).
- **CI's install** (row 28): `bytesOnDisk`, the longest path and directory
  per platform, which replace the pre-CI numbers above.
- **Outside the sandbox:** `compileall -j 0`; whether macOS 26 reports
  `16.0` to a binary built against an older SDK.
- **Not tried:** `compileall --invalidation-mode unchecked-hash`.

## 58. The AI helper's install job — the real install on the dev Mac (row 27), range support on both hosts (row 33), pip's output and the dist-info clock (row 34), depth's download without hf-xet (row 35), and the offline and proxy paths (§3a.5) (2026-10-14)

For `docs/CLIPS.md` §3a.3 and §3a.5, Step P's slice B (`0453abb` …
`08984ee`, nineteen commits, not pushed, so CI has not run them).
Development Mac (M1 Pro, macOS 26.5.2), inside the dev sandbox: no Metal,
no port to bind, the network through a filtering proxy. No filter shape is
added: P runs pip and the helper, never ffmpeg. Each number names who
measured it: the fetcher's builder (the census, the unpack, the compile),
the self-test's builder (the groups, the model, mediapipe's load), the
job's builder (the lock, the bar's property test), the integrator (the
real install and rows 27, 33, 34 and 35, the offline runs), three
verifiers, the fix phase, or the recorder (the test counts at `08984ee`).

### The real install (row 27, the Mac's half)

**The command** (the integrator), the app's own job
(`createHelperPackJobs`) on `installDeps.ts`' real workers, the real
`HELPER_PACK` and the real hosts, into `mkdtemp(tmpdir)/Forge
Bräutigam/userData`:

    FORGE_PACK_REAL=1 NODE_USE_ENV_PROXY=1 FORGE_PACK_KEEP=1 \
      FORGE_PACK_DOWNLOADS=$TMPDIR/forge-pack-downloads \
      npx vitest run tests/integration/helperPack.int.test.ts

The test writes `tests/output/helper-pack/README.txt` and overwrites it on
every run; the first run's figures were copied from it before a seeded run
replaced it. `FORGE_PACK_DOWNLOADS` keeps the verified files, or seeds them
as hard links, so a rerun fetches only what is missing.

| stage | first run, every file fetched (exit 0, 10 passed) | the fix phase's run, 45 of 48 seeded (exit 0, 11 passed) |
|---|---|---|
| Checking | 2 ms | 4 ms |
| Downloading | 6,032 ms: 178,190,592 B, **28.17 MiB/s** through the sandbox's proxy; the interpreter through github.com's 302 to release-assets | 1,306 ms: 3 files, 26,698,907 B (the README's "130.12 MiB/s" divides all 178,190,592 B by that time; ignore it) |
| Unpacking | 2,760 ms: unpack 467 ms (1,689 files, 68,060,050 B, longest 106 / 97), stdlib compile 2,293 ms | 2,679 ms: unpack 470 ms, compile 2,209 ms |
| Installing the libraries | 11,396 ms | 11,353 ms |
| Checking the AI helper | 36,992 ms | 36,582 ms |
| **the job** | **57,183 ms** | **51,927 ms** |

Two seeded reruns between them (the integrator): pip 11,044 and 11,115 ms;
the check 39,075 and 35,749 ms.

**The check is cold.** The test starts the new pack once before
`checkPack`, to time its first hello on its own; the stage total is the
app's, whose own check would meet that cold start.

| | first run | fix phase | reruns |
|---|---|---|---|
| the first hello | 11,348 ms | 11,848 ms | 14,446 and 12,213 ms |
| asr | 209 | 209 | — |
| beats | 21,096 | 20,230 | 20,295 and 19,045 |
| onnx | 108 | 105 | — |
| vision | 285 | 281 | — |
| sklearn | 1,768 | 1,768 | — |
| faces | 1,460 | 1,455 | — |

Every group exited 0 in every run; the faces group passes without Metal.

- **Warm**, on the kept pack (`node scratchpad/measure/hello.mjs <pack
  python> sidecar <userData>`, three times): hello 271, 274 and 277 ms.
  `… selftest`: 2,310 ms, asr 208, beats 900, onnx 108, vision 248, sklearn
  660, faces 183. A verifier, through `helperLaunch`'s pack rung and
  `SidecarClient`: hello 275 ms, `python` 3.14.8, executable, prefix and all
  5 `sys.path` entries inside the version folder or `sidecar/`; the
  self-test 2,282 ms (asr 213, beats 899, onnx 108, vision 247, sklearn
  631, faces 179).
- **Why the first start is cold.** `cp -R` of a freshly installed pack,
  then `<copy python> -E -s -B -X importtime -m forge_sidecar </dev/null`
  under `/usr/bin/time -p`: **14.09 s real, 1.06 s user, 0.18 s sys**; av's
  import is 10.78 s of it (`av._core` 3.31 s self, about 150–200 ms per
  Cython module). The second run: 0.91 s real. So the cold start is wall
  time on the first load of each new native file, not CPU. What that wait
  is spent on is not established.
- **The ceilings.** The pack's hello ceiling (`PACK_HELLO_TIMEOUT_MS`,
  90 s) has about 6× margin on this Mac; the self-test's 60 s per group
  about 3× over a cold beats group. The Surface, with Defender, is row
  29's and row 30's.

**The receipt and the disk** (the first run):

| | |
|---|---|
| `bytesOnDisk`, apparent (lstat sizes over the version folder) | **675,763,387 B**; the manifest's PRE-CI figure is 675,024,351 B (+0.11 %) |
| `du -sk` of the version folder | 706,039,808 B |
| longest relative path / longest directory | 161 / 107, the manifest's pre-CI figures exactly |
| files, folders | 13,525, 1,446 |
| the walk and the receipt | about 0.37 s (progress at 49,187 → 49,559 ms in the third run) |
| peak use | the downloads (178,190,592 B; `du` 174,984 KiB) plus the pack, about 884 MB, under `spaceNeeded`'s 938,536,438 B = ceil((178,190,592 + 675,024,351) × 1.1) |

**Free space.** `statfsSync(userData)`: `bavail` = `bfree` = 6,883,127 ×
4,096 = 28,193,288,192 B on the first run. On a seeded run 6,011,035 ×
4,096 = 24,621,199,360 B, and `df -k`'s Avail, read right after, was
24,621,199,360 B, equal to the byte; the fix phase's run, 6,170,097 ×
4,096 = 25,272,717,312 B, equal to `df` again. So `bavail × bsize` is
`df`'s figure on APFS. (`bavail` and `bfree` are equal here; `bfree` also
counts blocks only root may write, so the job reads `bavail`.)

**pip check** inside the pack (exit 1): "mediapipe 0.10.35 requires
matplotlib, which is not installed." and "… opencv-contrib-python, which is
not installed.", the allowlist's two and nothing else.

**numba's cache.** `find <pack> -name '*.nbi' -o -name '*.nbc'`: **none**
after the job's own self-test. After `beats.int` ran through the pack: **38
files, 1,190,255 B**, in `librosa/__pycache__` (18), `librosa/core` (6) and
`librosa/util` (14). So numba writes into an installed pack on its first
real use, and the tree drifts from the receipt's `bytesOnDisk`; the
self-test's one `librosa.stft` writes nothing. (On the dev venv the beats
group alone took 1,010 ms and left the 38 cache files already there at
38: that venv had them from earlier helper use.)

**The bar.** The placeholders (70 / 5 / 20 / 5) held the bar at 95 % for 37
of the first install's 57 s. `863f4f6` makes it 45 / 5 / 15 / 35, from this
install at the plan's 4.2 MB/s example line (a 40 s download of about
92 s), and the check now reports its progress: `CHECK_HELLO_SHARE` (0.35)
after the hello and the ping, then each group's start, mapped onto 0–0.9 of
stage 4. On a seeded run stage 4 went 65 % at the check's start, 76.0 %
after the hello, then 79.4, 82.9, 86.3, 89.7, 93.1 and 96.5 % group by
group, and 98.25 % at the receipt. The longest stands left are about 12 s
at 65 % (the cold hello) and about 19 s at 79 % (beats).

**Through the pack** (the integrator, with `FORGE_HELPER_PACK=<the kept
version folder>`), each exit 0: `sidecar.int` 20; `sidecarMedia.int` 1,
its `unittest.txt` naming the pack's `python3.14` and reading "Ran 132 tests
in 15.462s OK" with no skip allowed; `vision.int` 7; `beats.int` 13;
`faces.int` 13 and 2 skipped; `reframeJob.int` 13 and 1 skipped (the same
opt-in skips as on the venv). `FORGE_HELPER_PACK=/nowhere npx vitest run
tests/integration/vision.int.test.ts` exits 1, the suite failing with its
reason rather than skipping.

**The pack mutations** (the integrator), each a whole install from the
seeded downloads through `FORGE_PACK_MUTATION`, each exit 1:

| mutation | failed | what the receipt or the test said |
|---|---|---|
| without librosa (a scratch lock and manifest) | 3 | problems: "audio.beats is not available: beats unavailable: librosa is not installed: No module named 'librosa'"; the expects check; the beats group exit 1, ModuleNotFoundError |
| without mediapipe | 3 | `vision.faces` and `vision.facesModel` degraded ("mediapipe is not installed …"); the faces group exit 69 |
| without idna (for the `pip check` assertion, which none of the plan's three reached) | 3 | `pip check`: "requests 2.34.2 requires idna, which …"; depth and salient degraded |
| `-s` dropped, `HOME` and `APPDATA` with a planted user site | 2 | problems: "The AI helper's Python path reaches outside its folder: /tmp/claude-501/forge-pack-mcTfEM/home/.local/lib/python3.14/site-packages"; the test's own `path.relative` check |

The first mediapipe run also failed the `pip check` test, because "No
broken requirements found." did not match: that assertion broke when the
pack was right, and became membership plus the exit code before the commit.

### `--no-compile` (row 27)

The integrator, with `scratchpad/measure/pipcompare.sh compiled ''` and
`… nocompile '--no-compile'`: each a fresh `tar -xzf` of the pinned
archive, `python -I -m compileall -q -j 1 lib/python3.14`, then pip with
`runPip`'s exact argv (plus the flag).

| | pip | site-packages `du` | `.pyc` in site-packages | version folder `du` |
|---|---|---|---|---|
| compiled | 11.41 s | 611,488 KiB | 4,762 | 689,336 KiB |
| `--no-compile` | 2.14 s | 504,724 KiB | 404 (pip's own, from the stdlib compile) | 582,572 KiB |

- `--no-compile` saves 106,764 KiB (109.3 MB) and 9.3 s, once.
- The first hello (`hello.mjs` four times each): 13,660 against 13,634 ms,
  both cold.
- Every later start: **549–551 ms with `--no-compile` against 261–266 ms
  compiled**, +0.29 s. Under `-B` nothing is ever written, so every helper
  start, self-test child and face worker pays it.

**Decided: pip compiles.** 109 MB is not worth 0.29 s on every start.

### Range requests (row 33)

The integrator:

    curl -sI -L -r 0-1023 <the interpreter's URL>
    curl -sI -r 0-1023 <cffi's wheel URL>

| host | answered |
|---|---|
| github.com | 302 to release-assets |
| release-assets.githubusercontent.com | `HTTP/2 206`, `accept-ranges: bytes`, `content-range: bytes 0-1023/26680498` |
| files.pythonhosted.org | `HTTP/2 206`, `content-range: bytes 0-1023/184962` |

- GETs of `-r 26000000-26000999` (the interpreter) and `-r 1000-1999` (the
  wheel) both returned 206 with 1,000 B, byte-equal (`cmp`) to the
  verified files.
- github.com's redirect is signed with `se=` 40 minutes after it is issued
  (`Date` 17:22:15 GMT, `se=18:02:17Z`), so a byte-range resume after that
  must ask github.com again.

**What it settles:** resume inside a file can be built on both hosts. P
keeps file-level resume (the largest file is 42,986,588 B); the Surface's
download says whether more is worth it.

### pip 26.2.1 over the lock, and the dist-info clock (row 34)

The integrator captured the job's pip to `$TMPDIR/forge-pip-compiled.stdout`:
**50 lines on stdout, nothing on stderr**.

- `Looking in links: <downloads>`
- 47 lines `Processing <downloads>/absl_py-2.5.0-py3-none-any.whl (from -r
  <lock> (line 4))`, all within 0.25 s (4,305 → 4,565 ms in the fix
  phase's run)
- `Installing collected packages: mediapipe, flatbuffers, urllib3, …, av,
  anyio, absl-py`
- `Successfully installed absl-py-2.5.0 anyio-4.15.1 av-18.1.0 …`

The dist-info folders appear one package at a time, in that order. The
count at each 500 ms tick of the job's own poll:

| run | ms: folders |
|---|---|
| the integrator's | 9296:0 9796:4 10298:11 10799:11 11300:11 11800:11 12302:11 12803:12 13304:12 13804:12 14306:15 14806:20 15307:21 15808:21 16309:21 16810:22 17310:22 17812:22 18313:23 18812:28 19313:32 19813:45 20191:47 |
| the fix phase's | 4492:0 4993:3 5494:11 5995:11 6496:11 6998:11 7499:11 8000:12 8501:12 9002:12 9503:16 10005:20 10506:21 11008:21 11509:21 12010:22 12511:22 13012:22 13513:23 14014:28 14515:32 15016:45 15345:47 |

`runPip` reported 0 until "Installing collected packages" (9,269 ms in the
integrator's run), and the last 47 came at the exit, after "Successfully
installed" (20,132 ms). **What it settles:** the bar's dist-info count
works; it moves in about 12 steps over 11 s, its longest stand about 2.5 s
at 11 of 47 in both runs. pip's lines carry no progress worth showing, so
the speed column keeps its count.

### Depth's download without hf-xet (row 35, depth's half)

The integrator: `cp -R <installed pack> $TMPDIR/forge-hfxet/1`, then `<copy
python> -E -s -m pip uninstall -y hf-xet` (`find_spec('hf_xet')` then
None), then

    node scratchpad/measure/hello.mjs <copy python> sidecar $TMPDIR/forge-hfxet \
      request '{"method":"depth.layers","params":{"path":".../photo.jpg", …,"layers":3,"subject":false}}'

on a 640×480 `testsrc2` photo, with `HF_HUB_DISABLE_XET=1` as the app sets
it and `huggingface.co`, `*.hf.co`, `cdn-lfs.hf.co`, `cdn-lfs-us-1.hf.co`
and `cdn-lfs.huggingface.co` allowed (`subject: false`, so only the depth
model is fetched, not BiRefNet's).

- It passed: the model blob is 27,258,801 B; the "downloading the depth
  model" messages ran from 18,581 to 19,367 ms (about 0.8 s); the request
  took 9,891 ms in all and returned 3 layers.
- Hello on the copy: 12,489 ms, cold again (a `cp -R` is new files).

**What it settles:** hf-xet is not needed for depth. asr's half waits for
the speech model's press; until it passes, hf-xet stays in the lock.

### Offline and proxies (§3a.5)

The integrator, with a temporary test (deleted, never committed) running
the job on the real workers, Node's fetch and a retry of `{attempts: 2,
firstDelayMs: 100, budgetMs: 5000, …}`:

| run | environment | result |
|---|---|---|
| A | `NODE_USE_ENV_PROXY` unset, the direct path refused by the sandbox | failed after 204 ms: "cpython-3.14.8+…tar.gz could not be downloaded: github.com could not be reached: fetch failed (getaddrinfo ENOTFOUND github.com) — gave up after 2 tries over 0s. If this machine cannot reach github.com and files.pythonhosted.org, point FORGE_PYTHON at a Python with the helper's requirements."; the retry line "the connection to github.com failed (ENOTFOUND), trying again in 1s (2 of 2)" |
| B | `HTTPS_PROXY=http://127.0.0.1:9`, no `NODE_USE_ENV_PROXY` | identical to A: Node's fetch ignores `HTTPS_PROXY` (CLIPS §8.2 confirmed) |
| C | `NODE_USE_ENV_PROXY=1` with that proxy | failed after 103 ms, no retry: "github.com could not be reached: fetch failed (connect EPERM 127.0.0.1:9 - Local (0.0.0.0:0))" |

- In the sandbox a dead proxy gives `EPERM`, not `ECONNREFUSED`. In C the
  proxy appears only as the address inside the raw cause; the sentence
  blames github.com.
- The real install needed `NODE_USE_ENV_PROXY=1` here: `node probefetch.mjs`
  gave `ENOTFOUND` without it and 200 with it. The app does not set it, so
  **Install fails behind a proxy** until row 19.
- `secs()` rounds a sub-second wait up, so a 100 ms test wait reads "trying
  again in 1s". Cosmetic: real waits are 8 s and more.

**What the hosts send** (the fix phase, before refusing `text/html`): `curl
-sI -L -r 0-15 <the interpreter's URL>`, `curl -sI -r 0-15 <absl_py's wheel
URL>`, and the wheel again with `-H 'Accept-Encoding: gzip, deflate, br'`.
github.com's 302 is `text/html` (a hop, never read as the file);
release-assets answers 206 `application/octet-stream`;
files.pythonhosted.org answers `application/octet-stream` with no
`Content-Encoding` even when gzip is asked for (`content-length` 137410
for absl_py). So refusing `text/html` before the body refuses nothing real.

**Node's manual redirect** (a verifier): Node 24.18.1's fetch with
`redirect: 'manual'` against the interpreter's URL (`NODE_USE_ENV_PROXY=1`,
github.com allowed) gave status 302, type `basic`, and `Location` on
release-assets.githubusercontent.com. undici returns the real response for
`'manual'`, not an opaque redirect ("Not compliant on purpose",
`node_modules/undici/lib/web/fetch/index.js:1190-1196`, read by the
fetcher's builder). That is what following redirects by hand, to name each
hop's host, relies on. Electron's `net.fetch` with `'manual'` is unmeasured
(row 19).

**The log line on success** (the fix phase's real run): "cpython-3.14.8+20261001-aarch64-apple-darwin-install_only_stripped.tar.gz
came from release-assets.githubusercontent.com: 26680498 B, its sha256
verified"; decorator (10,365 B) and lazy_loader (8,044 B) from
files.pythonhosted.org.

### The unpacker on the real archives

**The census** (the fetcher's builder, a stdlib Node walker, `node
census.mjs row26/<mac|win>.tar.gz`): all 1,698 Mac and 2,190 Windows headers
carry POSIX magic `ustar\0` `00`; no duplicate names, none `safeMemberPath`
refuses; names joined through the prefix 9 and 6. The Mac: 1,689 files,
68,060,050 B, longest 106, folder 97, modes 1,670 × 0664 and 19 × 0775, tar
69,373,952 B; Windows: 2,190 files, 61,643,159 B, longest 105, folder 86,
2,176 × 0666 and 14 × 0777, tar 63,301,120 B. These agree with §57.

**`unpackTarGz`**, `npx vitest run tests/unpack.test.ts --reporter=verbose
--silent=false` (the builder, twice):

| | Mac | Windows (unpacked on the Mac as data, never run) |
|---|---|---|
| result | 1,689 files, 68,060,050 B, 9 links, 160 folders, longest 106 / 97 | 2,190 files, 61,643,159 B, longest 105 / 86 |
| time | 503 ms, then 423 ms | 438 ms |
| against tar's tree | 1,858 paths equal: types, sizes, link targets and the 19 x bits | equal path for path and size for size |
| after the fix phase (`-t real`) | 421 ms | 467 ms |

- The interpreter it wrote answers `-I -c "import sys, ssl;
  print(sys.version)"` with "3.14.8 (main, Oct 1 2026, 20:50:07) [Clang
  22.1.3 ]", which answers slice A's open question of whether the tree runs
  when the app writes it. A verifier diffed its own `find`/`stat` listing
  of the unpack against tar's (1,859 lines with the root, `diff` exit 0)
  and ran `import ssl, sqlite3` from it; and Windows' 2,190 size-and-name
  lines against `tar -tzvf`'s, `diff` exit 0.
- **The compile on that tree** (`-I -m compileall -q -j 1`): 1,811 ms, then
  1,726 ms, 1,059 `.pyc`, **18,965,516 B**, 77,878 B less than §57's
  19,043,394 B (`find row26/mac-compiled/python -name '*.pyc' | xargs stat
  -f %z`). The `.pyc` carry their source's absolute path (`co_filename`):
  §57's tree sat under a 114-character root (`echo -n "$PWD/mac-compiled" |
  wc -c`), this one under 40, about **1,052 B per character of root**. So a
  user's `bytesOnDisk` moves by about 100 KB per 100 characters of their
  userData path.

**An unpack outside the root** (a verifier, then the fix phase, `4b9073d`).
An archive of three members, `X -> .`, `x/y/L -> ../..` and
`x/y/l/evil.txt`, was accepted by `TarStream` and `unpackTarGz`, and on
this Mac `readdir('<tmp>/root/python')` returned `['1', 'evil.txt']`: the
file landed in the version folder's parent. `L` is inside on paper (two
levels up from `x/y`), but APFS (and NTFS) fold case, so `x/y/l` went
through it, and the check "no member at or under an earlier link" compared
names exactly. The case that needs the fold is a link one level shallower
than its name (`a/X -> ../c`, then `a/x/y/L -> ../../../other`), which a
rule against links to an ancestor alone does not stop. Three layers now:
names folded (NFC, then case) when judging "under a link"; no link to its
own folder or above; and `realpath` of each folder's deepest existing part
checked inside the root before it is made. The archive's sha256 pin had
limited it to a bad manifest.

**Renames on Windows**: `graceful-fs` 4.2.11
(`node_modules/graceful-fs/polyfills.js:90-123`) retries `EACCES`, `EPERM`
and `EBUSY` on win32 for up to 60 s, its backoff growing 10 ms at a time to
100 ms, and only while the destination stats `ENOENT`; its comment names
antivirus holding files for up to a minute. `renameWithRetry` takes 10
tries, 50 ms doubling to a 2 s cap, 9.15 s in all, and does not copy the
`ENOENT` rule, since the receipt's rename may replace a file. Unmeasured on
the Surface (row 27).

### The self-test

**`identity.onnx`** (the self-test's builder): 80 B, sha256
`5ec65a9b7e916737db9913eed0db9909cc08c833526715129d88e42cc14e4104`, IR 7,
opset 13, producer "forge", one Identity node, `x` float [1, 1] → `y` float
[1, 1]. Written by a stdlib protobuf encoder (`sidecar/.venv/bin/python -I
make_identity_onnx.py <out>`): the onnx package could not be fetched, pip's
TLS failing through the sandbox's proxy (`SSLCertVerificationError('OSStatus
-26276')`, as in §57). onnxruntime 1.30.0 (CPU) reports `x` [1, 1]
`tensor(float)` and `y` [1, 1], and returns [[0.5]] for [[0.5]]; a
verifier's [[0.25]] came back [[0.25]].

**mediapipe's library** (mediapipe 0.10.35 on the dev venv, no Metal; the
bootstrap's path, the three imports, then the load, `.venv/bin/python -E
-s -B -c …` from `sidecar/`): after the imports (0.119 s)
`mediapipe_c_bindings._shared_lib` is None; `load_raw_library()` then took
**0.068 s** and returned `CDLL '…/mediapipe/tasks/c/libmediapipe.dylib'`.
With the load in the worker's `_mediapipe()`, `faces.int`'s ready line reads
"ready 0.10.35 0.106", 177 ms wall (slice A: 143 ms, a 0.076 s import).

**The groups on the dev venv** (CPython 3.14.6; `PYTHONPATH=sidecar
sidecar/.venv/bin/python -B -c "from forge_sidecar import selftest;
selftest.selftest()"`, ms, every group exit 0):

| run | asr | beats | onnx | vision | sklearn | faces | total |
|---|---|---|---|---|---|---|---|
| 1 | 245 | 1,242 | 107 | 317 | 748 | 181 | 2.84 s |
| 2 | 248 | 942 | 104 | 312 | 730 | 182 | 2.52 s |
| 3 | 251 | 949 | 102 | 311 | 716 | 172 | 2.50 s |

A verifier, driving the real helper by hand (`.venv/bin/python -E -s -u -B
-m forge_sidecar`, hello then `system.selftest`): Python 3.14.6, 12
capabilities, six progress lines "checking <g> · i of 6" and a final 1.0
with no words; asr 292, beats 980, onnx 108, vision 315, sklearn 733, faces
179 ms; the keys exactly `SELFTEST_GROUPS`' in order. With
`subprocess.Popen` wrapped and each plain source ending in a pid print and
`sys.exit(7)`: 6 calls, 6 distinct pids, each a child of the helper, and
each plain group answered exit 7 with its own line.

**What each group's child has loaded** (each group's own command with a
probe appended):

| group | `sklearn` in `sys.modules` | soxr | numba's `_typeconv` | modules |
|---|---|---|---|---|
| asr | no | no | no | 398 |
| beats | no | yes | yes | 1,318 |
| onnx | no | no | no | 189 |
| vision | no | no | no | 556 |
| sklearn | yes | no | no | 1,116 |
| faces (the worker's `_mediapipe()`) | no | — | — | 340, in 0.102 s |

So no group but sklearn's imports scikit-learn, whose Windows wheel
preloads its `msvcp140.dll` on import, and beats' `stft` is what loads soxr
and `_typeconv` (CLIPS §3a.3's reason for it).

- `-m site` under `-E -s -B` puts the absolute cwd first on `sys.path`;
  `-c` puts `''`. The base interpreter's `python314.zip` is on `sys.path`
  and not on disk, so the check resolves a missing path through its longest
  existing ancestor.

### Races the tests and the verifiers found

- **The lock, in one tick** (the job's builder, mutation J26): the
  in-process registry was set only after `createExclusive` resolved, so a
  sweep started in the same tick as a job made its own create, read the
  job's lock as a stale one with its own pid, and took it over. The key is
  now reserved before the first await.
- **Repair's idle and stop** (a verifier, the real service's
  `helperControl`, a real job and the fake helper as `FORGE_PYTHON`, a
  caller looping `await getSidecar().request('fake.wait', {ms: 150})` three
  times during a Repair): `["ok0", "err1: The AI helper is shutting down",
  "err2: The AI helper is being repaired"]`, on 4 runs of 4. A sequential
  caller's next request went out between `whenIdle`'s resolution and the
  hold, and the stop cut it off. Fixed in `bcfc515` by looping
  idle → in-use → `busy()` with the hold and the stop in the same tick.
- **A window starting from the pack during Repair's download** (the same
  verifier): with the download gated and `in-use/200 = {pack: 1}` written
  for a live pid, the job ended Done with `["hold", "stop", "unlink
  receipt:1", "rm:1"]`. The in-use records are now read again after the
  download.
- **A guard that certified nothing**: deleting `sweepPlan`'s `if
  (v.receipt === 'unparseable') continue` passed every committed test (64
  passed and 1 failed in the verifier's run, the failure its own scratch
  case), because every fixture put the torn receipt above the current number,
  where the older-number rule cannot reach it. Both test files now put one
  below.

### Test times

The job's property test (bar never down, over 12 seeds) took 23,443 ms
with chunks down to 1 byte (about 100,000 `appendFileSync` and
`setImmediate` calls an install) and 225 ms with a 200-byte floor; the file
now runs in about 0.85 s. `tests/sidecar/test_selftest.py` runs 25 in
11.4 s, `pipStage` about 2.3 s, `packCheck` about 3.2 s; `sidecar.int`'s
self-test case about 3.0 s on the venv. The sandbox's temp folder had
26.3 GB free (`statfsSync`); `helperIpc`'s test runs the real `statfs`
against the real `HELPER_PACK`, so it needs about 0.9 GB free.

### The suites at `08984ee`

Run by the recorder to a file (`--reporter=json`), exit 0: `fetchFile` 20,
`tarStream` 20, `unpack` 20 (the real-archive cases ran), `pathBudget` 7,
`pipStage` 12, `packCheck` 18, `helperPackJob` 40, `helperLock` 12,
`installStages` 18, `sidecarService` 36, `helperIpc` 4, `installDeps` 5,
`renderer/helperJobRow` 3, `helperPython` 28, `ytdlpBinary` 19,
`sidecar.int` 20, `sidecarMedia.int` 1 ("Ran 132 tests", OK) and
`helperPack.int` 11 skipped (no `FORGE_PACK_REAL`): 283 passed, 11
skipped, 18 files. `PYTHONPATH=sidecar sidecar/.venv/bin/python -m
unittest discover -s tests/sidecar -p test_selftest.py`: "Ran 25 tests in
11.367s", OK. The sandbox prints "ERROR: failed to copy trust settings of
system certificate-25291" for every Node child, onnxruntime 1.30 warns
"Failed to persist telemetry device ID", and CFNetwork warns about
`~/Library/Caches/python3.14/Cache.db` during the depth download: noise,
not the pack.

### What this settles

1. **The bar is 45 / 5 / 15 / 35**, and the check moves it.
2. **pip compiles** (`--no-compile` costs 0.29 s at every start for
   109 MB).
3. **The dist-info count is the bar's measure for pip** (row 34).
4. **File-level resume stays**; range resume is possible on both hosts
   (row 33).
5. **hf-xet is not needed for depth** (row 35's first half).
6. **`bavail × bsize` is `df`'s Avail** on APFS.
7. **The manifest's pre-CI Mac figures hold** within 0.11 % for bytes and
   exactly for the paths, until CI's install replaces them.
8. **The 90 s hello and 60 s group ceilings hold on the Mac** with about 6×
   and 3× margin.
9. **Install fails behind a proxy on Node's fetch**: row 19 is needed
   before testers on proxies.

### Still unmeasured, and whose

- **The Surface:** row 27 (Defender's share, the rename retries against
  9.15 s, the stage weights), row 29 (the cold hello after an install and
  after a reboot), row 30 (the faces group's ctypes line on a machine
  without the runtime; its wording is from CPython's `callproc.c`), row 32
  (`taskkill /f /t` on pip and the compile, Mark of the Web, SmartScreen),
  the 8.3-name `realpath`, and the receipt's walk there (13,525 files and
  about 0.37 s with the receipt on the Mac).
- **CI:** row 28 (`bytesOnDisk` and the paths on both platforms), row 37,
  and every test of this slice on Windows (nothing is pushed). *(This
  slice's tests first ran on Windows on 2026-10-16, red on four test
  shapes; §59.)*
- **Row 19:** `net.fetch`, its `'manual'` redirect, and a proxy's own
  sentence. *(Electron's half probed 2026-10-16, §59: `net.fetch` cannot
  carry the hand-followed redirects, so the pack's fetch is `net.request`.)*
- **Row 35's other half:** asr's download without hf-xet. *(Passed
  2026-10-16, §59; hf-xet left the lock as pack 2.)*
- **Not established:** what the first load of a new native file waits on.
- **A decision, not a measurement:** numba's cache in the installed pack
  (`NUMBA_CACHE_DIR`, or the drift accepted). *(Decided as
  `NUMBA_CACHE_DIR`, CLIPS §16.52, and measured, §59.)*

## 59. The AI helper's last slice — the speech model's pin and its download without hf-xet (row 35), Electron's fetcher probed (row 19), numba's cache moved (§16.52), hf-xet out of the lock, the harness and census, and the first Windows CI run after slices A and B (row 37; the pack's own CI steps first run on the push after this one) (2026-10-16)

For `docs/CLIPS.md` §3a.4–§3a.7 and §3a.8 rows 19, 35 and 37, Step P's
slice C: thirty-one code commits after `c7a2a86`, `aa377f9` … `1a043c9`,
then the record's own (`69f8758`, `6d456a2` and this correction), pushed
together on 2026-10-16. `c7a2a86`, which carries slices A and B, was
pushed the same day, and its Windows CI run is the last part of this
section. Development Mac (M1 Pro, macOS 26.5.2), inside the dev sandbox: no
Metal, no port to bind, the network through a filtering proxy that lets a
command reach only the hosts it names. The one exception is row 19's probe,
run as an Electron main-process script in the user's own Terminal, outside
the sandbox. Each number names who measured it: the speech-model lane (the
pin, row 35's asr half, pack 2), the packaging and CI lane (row 19, the URL
probe, the PE listing, the installs in clean copies), the main-process lane
(numba's cache, libuv's codes), the window lane and the harness lane (the
row on screen, the harness check, the census), the CI reader, three
verifiers, the fix phase, or the recorder (the suites at `1a043c9`).

### The speech model's pin

The speech-model lane, with `huggingface.co` allowed:

    curl https://huggingface.co/api/models/Systran/faster-whisper-small?blobs=true

`sha` **`536b0662742c02347bc0e980a01041f333bce120`**, `lastModified`
2023-11-23T10:57:09Z. The same commit, with the same sizes, was already in
the app's `userData/models` on the dev Mac, where Transcribe had fetched it
at `main`. Every file:

| file | bytes | fetched by the press |
|---|---|---|
| `.gitattributes` | 1,477 | no |
| `README.md` | 1,998 | no |
| `config.json` | 2,370 (blob `e5047537…`) | yes |
| `model.bin` | 483,546,902 (LFS sha256 `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`) | yes |
| `tokenizer.json` | 2,203,239 (blob `7818adb6…`) | yes |
| `vocabulary.txt` | 459,861 (blob `c9074644…`) | yes |

- **What the load needs is 486,212,372 B**, the four files WhisperModel
  reads. `formatBytes` writes it "464 MB", the plan's figure, so the press
  reads "Get the speech model · 464 MB". The helper's own progress
  messages use `media._megabytes`, which is decimal (486 MB), so the window
  shows the fraction and its own label, never the message's size.
- faster-whisper 1.2.1's `allow_patterns` also list
  `preprocessor_config.json`; this repository has none.
- The resolve URLs (`curl -D -` with a `0-0` range): `config.json` answers
  307 to `/api/resolve-cache/…` on `huggingface.co` itself; `model.bin`
  answers 302 to `us.aws.cdn.hf.co/xet-bridge-us/…` with `X-Linked-Size:
  483546902`. So the speech model needs `*.hf.co` as BiRefNet does
  (`SIDECAR.md`).
- A verifier fetched the API again: the same sha and the same four sizes,
  summing to `asr.py`'s `MODEL_FILES` exactly.

### Row 35, asr's half: the download without hf-xet

The speech-model lane, on a copy of the installed pack 1:

1. `cp -Rp <pack 1> $TMPDIR/forge-hfxet-asr/1` (689,492 KiB by `du`) took
   7.5 s.
2. `<copy>/python/bin/python3.14 -E -s -m pip uninstall -y hf-xet` printed
   "Successfully uninstalled hf-xet-1.6.0" (`hf_xet` was 7,672 KiB and its
   dist-info 316 KiB by `du`); `find_spec('hf_xet')` then returned None.
3. `node scratchpad/measure/requests.mjs <copy python> sidecar <userData>
   '<requests JSON>'`, a driver new for this (from `hello.mjs`) that sends
   several requests to one helper. It starts the pack rung's `-E -s -u -B
   -m forge_sidecar` from `sidecar/`, with `PYTHON*` and `HF_*` dropped,
   `FORGE_MODELS_DIR` and `FORGE_CACHE_DIR` under a temp userData,
   `HF_HUB_DISABLE_XET=1` and `HF_HUB_DISABLE_TELEMETRY=1`. Allowed:
   `huggingface.co`, `*.hf.co`, `cdn-lfs.hf.co`, `cdn-lfs-us-1.hf.co` and
   `cdn-lfs.huggingface.co`.

The hello took 12,970 ms, cold (a copy is new files, §58), and listed
`asr.model` and `asr.transcribe`. Then, in one session:

| request | answer | time |
|---|---|---|
| `asr.model {}` | present false, bytes 486,212,372, label "the speech model", host `huggingface.co` | 1 ms |
| `asr.transcribe` | −32001 "The speech model is not downloaded yet" | 0 ms |
| `asr.model {download: true}` | present true, after 54 progress notifications | 14,681 ms |
| `asr.model {}` | present true | 2 ms |
| `asr.transcribe` on the speech file | 22 words, language `en` at probability 1, `durationMs` 7297 | 2,127 ms |

- **The download**: "downloading the speech model (under 1 MB, first run
  only)" at 13,172 ms, "(2.2 MB, …)" at 13,326 ms, and "(484 MB, …)" from
  14,013 to 27,648 ms. So `model.bin` took about 13.6 s (about
  33.8 MiB/s), and the whole 486,212,372 B 14.68 s (about 31.6 MiB/s),
  from `huggingface.co` and `us.aws.cdn.hf.co`. No sandbox violation was
  reported; stderr held only huggingface_hub's "You are sending
  unauthenticated requests to the HF Hub".
- **The transcription**: "loading small", then "analysing audio" 740 ms
  later; the words "And so, my fellow Americans, ask not what your country
  can do for you, ask what you can do for your country."
- **On disk**: four blobs, 486,212,372 B (486,212,563 B with
  `CACHEDIR.TAG`), 483,892 KiB by `du`; the snapshot folder holds 4
  symlinks.
- **A fresh session with NO host allowed**: hello 319 ms, `asr.model`
  present true, the transcription 1,555 ms and the same 22 words. So a
  session's first load asks no host (`local_files_only=True` on the
  snapshot's path).
- **The fixture**: `espeak-ng -v en-us -s 150 -w speech.wav "<the
  sentence>"`, 7.297 s at 22,050 Hz mono, converted to 16 kHz FLAC by the
  bundled ffmpeg for `asr.int` (`$TMPDIR/asr-check/jfk.flac`).
  `tests/fixtures` has no `jfk.flac`, and macOS `say` writes empty 4,096 B
  files in the sandbox.
- The copy is deleted.

**A verifier on pack 2, by hand** (its own `python3.14`, `-E -s -u -B -m
forge_sidecar`, `HF_HUB_DISABLE_XET=1`, no host allowed): on an empty
models folder `asr.model {}` gave present false and 486,212,372 B,
`asr.transcribe` −32001 in 0 ms, and `{download: false}` and `{download:
'true'}` fetched nothing and made no models folder. With the lane's seeded
models: hello 275 ms, present true, `jfk.flac` transcribed in 2,439 ms to
the same 22 words, and `model: 'tiny'` refused.

**What it settles:** neither of the pack's Hugging Face downloads needs
hf-xet (depth's passed on 2026-10-14, §58), so it leaves the lock.

### hf-xet out of the lock: pack 2

**Its share**, measured the two ways the PRE-CI figures were (the
speech-model lane):
- the Mac: hf-xet's 9 RECORD files in the dev venv, `stat()`ed,
  **8,152,766 B**. The 47 distributions still summed to 587,943,059 B in
  10,728 files that day; the 46 sum to 579,790,293 B in 10,719;
- Windows: `curl -r -65536` of `hf_xet-1.6.0-cp38-abi3-win_amd64.whl`
  (4,033,128 B) and its central directory parsed: 7 entries,
  **9,805,289 B** uncompressed (`hf_xet.pyd` 9,499,136 B), of which `.py`
  107 B. `pack_lock.py` takes the index bytes out, and the `.py` bytes out
  of the sum it scales by the dev venv's `.pyc` ratio (105,047,119 /
  79,995,354), so about 140 B more.

**The bump** (`sidecar/.venv/bin/python -I scripts/pack_lock.py --bump
--check-github`, with `pypi.org`, `files.pythonhosted.org` and
`api.github.com` allowed). The completeness check passed on both targets
(46 and 47 lock lines; allowlisted: huggingface-hub → hf-xet and mediapipe's
two; colorama still Windows' only extra), and both interpreter pins matched
GitHub's release `20261001` (26,680,498 B, `69e48cd7…`; 23,227,899 B,
`b7ff8b70…`).

| | darwin-arm64 | win32-x64 |
|---|---|---|
| wheels | 46, 147,633,807 B | 47, 187,843,524 B |
| with the interpreter (the button) | 174,314,305 B, **"166 MB"** | 211,071,423 B, **"201 MB"** |
| lock sha256 | `ed220aedbf65b240650da4c7904f8ef955ff9a2c6f8d6f008a08ce1280a2abb2` | `ecbbec7b85fbcf89f866e34140510e1e60e52db903c6f4aae62db9d03d07e3ec` |
| lock file | 49 lines (3 of header) | 50 |
| `bytesOnDisk`, PRE-CI | 666,871,585 B | 718,681,542 B |
| what `formatBytes` writes for it | **"636 MB"** | **"685 MB"** |

Pack 1's hashes (`9932ef36…`, `6ec44386…`) stay in `history.json`.
`resolved.json` gains `"excluded": ["hf-xet"]`; `expects` gains `asr.model`,
so the row counts 9 features.

- **`formatBytes` writes GB only from 1 GiB**, so neither platform's pack
  reads in GB on screen: 666,871,585 B is "636 MB", not the "0.6 GB" the
  lane's note gave. (§3a.1's slice-A note said pack 1's 675,024,351 B
  would print "0.6 GB"; it prints "644 MB". Corrected there.)
- **The guards.** Before `--bump` the run exited 1, "the lock or
  interpreter of ['darwin-arm64', 'win32-x64'] changed under pack 1; run
  again with --bump to make it pack 2", and the five generated files'
  sha256 were unchanged. A second `--bump` exited 1, "--bump, but nothing
  changed since pack 2". A rerun without `--bump` reproduced every file
  byte for byte. In a scratch copy with the allowlist entry deleted, the
  run exited 1: "darwin-arm64 needs hf-xet (huggingface-hub: "hf-xet<2.0.0,
  >=1.5.2; platform_machine == …"), which EXCLUDE leaves out of the pack".
- A verifier, in a clean copy with `sidecar/.venv` linked: HEAD's history
  and no `--bump` exited 0 and reproduced all five files; pack 1's
  `history.json` (from `1a5051c^`) and no `--bump` exited 1 with the
  sentence above, the other four files unchanged.

### Pack 2 installed on the Mac (rows 27 and 28 again)

**The speech-model lane's install** into a fresh userData under "Forge
Bräutigam" (`FORGE_PACK_REAL=1 NODE_USE_ENV_PROXY=1 FORGE_PACK_KEEP=1 npx
vitest run tests/integration/helperPack.int.test.ts`, with `github.com`,
`release-assets.githubusercontent.com`, `objects.githubusercontent.com` and
`files.pythonhosted.org` allowed), and **the packaging lane's four** in
clean copies, into `$TMPDIR/laneC-pack é/userData`:

| | speech-model lane | packaging lane (a), fresh | (c), stale receipt | (d), with `2664a63`'s fetchFile |
|---|---|---|---|---|
| the job | **58,312 ms** | **52,997 ms** | 54,000 ms | 50,460 ms |
| Checking | 4 ms | 1 ms | | |
| Downloading | 5,366 ms, 174,314,305 B at 30.98 MiB/s, 47 of 47 files | 6,317 ms at 26.32 MiB/s | 5,284 ms (31.46 MiB/s) | 5,101 ms (32.59 MiB/s) |
| Unpacking | 3,498 ms (unpack 948, compile 2,550) | 2,668 ms (unpack 482: 1,689 files, 68,060,050 B, longest 106 / 97; compile 2,186) | | |
| Installing the libraries | 12,893 ms | 11,504 ms | | |
| Checking the AI helper | 36,549 ms | 32,505 ms | | |
| the first hello | 11,357 ms | 11,089 ms | 11,060 ms | |
| asr / beats / onnx / vision / sklearn / faces | 252 / 20,314 / 108 / 288 / 2,045 / 1,406 | 211 / 17,414 / 108 / 284 / 1,770 / 937 | beats 19,779 | |

Every group exited 0. (c) is the receipt's `lockSha256` zeroed, which the
test removes and installs fresh; (d) ran in vitest, where `packFetch`
keeps Node's fetch, so it proves the changed `fetchFile.ts`, not
Chromium's stack. Both (c) and (d) passed 11 of 11; (a) passed 10 of 11,
the progress case failing on the check's new per-group texts (`a1aaf0e`),
which would have failed CI's first push and was fixed in `446f99b`.

**The receipt and the disk:**

| | speech-model lane | packaging lane (a) |
|---|---|---|
| `bytesOnDisk`, apparent | 667,609,685 B (+0.11 % on the PRE-CI 666,871,585) | 667,495,529 B |
| `du` | 697,860,096 B | 697,757,696 B (`du -sk`) |
| longest path / directory | 161 / 107 | 161 / 107 |
| files, folders | 13,515, 1,441 | 13,515, 1,441 |
| `spaceNeeded` | 925,304,480 B | 925,304,480 B |

Pack 1's first install was 675,763,387 B in 13,525 files and 1,446 folders
(§58): pack 2 is 8.2 MB, 10 files and 5 folders less, hf-xet's share. On
the packaging lane's run `statfs` `bavail × bsize` equalled `df`'s Avail
again (23,880,040,448 B). 46 dist-infos; `asr.model` among hello's
capabilities.

**pip check** in pack 2 exits 1 with exactly three lines:
"huggingface-hub 1.31.0 requires hf-xet, which is not installed.",
"mediapipe 0.10.35 requires matplotlib, which is not installed." and
"mediapipe 0.10.35 requires opencv-contrib-python, which is not
installed." `venv.ts` `pipCheckProblems` allows the first only while the
lock pins no `hf_xet` wheel.

**The cached mode** (`helperPack.int` with `FORGE_PACK_USERDATA` over a pack
this build accepts, which runs the job's Check again and every assertion):
the packaging lane's run took 2,907 ms (hello 294 ms; asr 211, beats 873,
onnx 108, vision 247, sklearn 630, faces 179 ms; the helper's calls
`['restart']`), 11 of 11 in 4.2 s. A verifier on its own copy of pack 2
under `$TMPDIR/verC2-cached é/userData`: 11 of 11, 0 of 47 files fetched,
the check 36.2 s (a copy is cold). The fix phase's, after `3e90349`: Check
again 2,982 ms, 12 of 12.

**Through the pack** (the packaging lane, `FORGE_HELPER_PACK=<that
userData>`): `packPipCheck.int` 1 of 1; `sidecarMedia.int` 1 of 1, "Ran 148
tests in 15.5 s" on `…/python/2/python/bin/python3.14`, 0 skipped. With
`FORGE_HELPER_PACK="$TMPDIR/no pack here"` both fail, "names no AI helper
pack that runs here". The speech-model lane: `asr.int` and `sidecar.int`
from inside pack 2 with no host allowed, 28 passed. The scratch userData
(0.9 GB) and the clean copies are deleted; pack 2's kept folder is
`$TMPDIR/forge-pack-RdsNTS/Forge Bräutigam/userData/python/2`, and pack 1's
is gone.

### numba's cache, moved (§16.52)

**The main-process lane**, on the kept pack 1
(`$TMPDIR/forge-pack-mhKz4Q/Forge Bräutigam/userData/python/1`):

1. `find <pack> \( -name '*.nbi' -o -name '*.nbc' \)`: 38 files,
   1,190,255 B (`stat -f %z` summed), in `librosa/__pycache__` (18),
   `librosa/core` (6) and `librosa/util` (14), as §58 found them.
2. Those files alone deleted (`find …/site-packages/librosa \( -name '*.nbi'
   -o -name '*.nbc' \) -delete`): 0 left.
3. `FORGE_HELPER_PACK=<userData> npx vitest run
   tests/integration/beatsNumbaMeasure.tmp.int.test.ts`, a temporary copy
   of `beats.int` whose one change passed `cacheDir` and `modelsDir` under
   that userData (deleted afterwards): exit 0, 13 passed, 10.24 s.
4. **After: 0 cache files in the pack; 38 in
   `<userData>/helper-cache/numba`, 1,190,271 B**, in three folders
   (`librosa_83e5b18f…`, `core_18491b81…`, `util_03d837dd…`). 16 B more than
   in the pack: the index files carry the source's path.
5. `beats.int` as committed: 13 passed, and **38 files, 1,190,239 B, in the
   pack again**. Its launch (`venv.ts` `launchFor`) passed `cacheDir: ''`,
   so `NUMBA_CACHE_DIR` was never set.

A verifier reproduced step 5 on its own copy of pack 2 (38 files,
1,186,879 B; 0 before, and `helperPack.int`'s cached mode wrote none), and
saw that CI's step 4 would then save the drifted pack into its cache. **The
fix phase** (`3e90349`): `venv.ts` `packCacheDir` gives `packLaunch`
`<userData>/helper-cache` beside `python/<n>` (or a folder in the OS temp
dir). On pack 2: `beats.int` 13 of 13, 0 files in the pack, 38 in
`helper-cache`. With the old `''` put back: 38 files, 1,190,223 B, in the
pack, and the cached `helperPack.int` failed exactly its new case ("no
.nbi or .nbc in the version folder"), 11 of 12; restored, 12 of 12.

The four byte counts (1,190,255, 1,190,239, 1,190,223, 1,186,879) are 38
files each time; the main-process lane reads the differences as the index
files carrying their source's path, which moves with the userData path's
length (not measured further).

### Row 19: Electron's fetcher, probed

**The packaging lane**, `npx electron scripts/probe-netfetch.mjs
<out.json>`, run twice in the user's Terminal on the dev Mac (its tabs
closed afterwards): Electron 44.3.0, Chrome 152.0.7977.78, Node 24.20.0,
darwin-arm64, `net.isOnline()` true, no proxy variables, and
`session.resolveProxy` "DIRECT" for `github.com`,
`release-assets.githubusercontent.com` and `files.pythonhosted.org`. The
probe's raw output went to the session's scratchpad (`netfetch.json`,
`netfetch2.json`), which does not outlive the session, so the table below
is the record; the raw files held GitHub's signed redirect URL, expired at
16:37Z.

| call | what came back |
|---|---|
| `net.fetch(<interpreter URL>, {redirect: 'manual'})` | **rejects**: `Error` "Redirect was cancelled" (399 and 306 ms). No 302, no `Location`, not an opaque redirect |
| `net.fetch(…, {redirect: 'follow'})`, `Range: bytes=0-1023` | 206, type `default`, **`response.url` "" (empty)**, `redirected` false; `content-range` "bytes 0-1023/26680498", `content-length` 1024, `application/octet-stream`, no `content-encoding`, `server` Windows-Azure-Blob/1.0; 1,024 B read |
| the same, no range | 200, `content-length` 26680498; the first 4 MiB in 88 chunks of 1 to 80 KiB, the first at 0 ms, the last at 144 ms |
| the smallest wheel (lazy_loader, 8,044 B), `'manual'` | 200 directly (no redirect), 2 chunks, sha256 the pin's, `binary/octet-stream` |
| `net.request({redirect: 'manual'})` | emits `'redirect'` (302, GET, the release-assets URL, 15 header names, `location` among them) at 34 ms; the abort is clean |
| `net.request` to that hop | `Range: 0-1023`: 206, `bytes 0-1023/26680498`, 1 chunk of 1,024 B; unranged: 200, 4 MiB in 83 chunks; `followRedirect()` by hand: 206 `bytes 0-15/26680498` |
| a session's `webRequest` around `session.fetch` | `onBeforeRedirect` fires (`github.com` → release-assets, 302), `onCompleted` on release-assets (206) |

**Errors**, every one a plain `Error` whose message is the code, with no
`code` property and no `cause`, the same through `net.fetch` and
`net.request`:

| | |
|---|---|
| a name that does not resolve | `net::ERR_NAME_NOT_RESOLVED` (109 ms) |
| port 9 | `net::ERR_UNSAFE_PORT`: Chromium blocks the port, so it says nothing about a refused connection |
| closed port 59999 | `net::ERR_CONNECTION_REFUSED` |
| dead proxies `http://127.0.0.1:9` and `:59998` | `net::ERR_PROXY_CONNECTION_FAILED` (`resolveProxy` "PROXY 127.0.0.1:9") |
| a proxy whose name does not resolve (`forge-probe-proxy.invalid:3128`) | `net::ERR_PROXY_CONNECTION_FAILED` (183 ms) |
| a cancel before the answer | `DOMException` AbortError "This operation was aborted" (code 20) |
| a cancel in the body | AbortError, code `ABORT_ERR`, cause `ERR_STREAM_PREMATURE_CLOSE` |

**What it settles:** `net.fetch` cannot carry the hand-followed redirects
that name each host (`'manual'` rejects; `'follow'` leaves the URL empty),
so the app's pack fetch is `src/main/net/chromiumFetch.ts` over
`net.request` in its `'manual'` mode, which hands the 3xx back with its
`Location` as undici does (§58), every request `cache: 'no-store'`.
`installDeps.ts` `packFetch()` picks it inside a ready Electron; vitest and
CI keep Node's fetch. `fetchFile.ts` reads Chromium's `net::ERR_` network
codes as network failures (retried; not a certificate, a cancel, an unsafe
port or a policy block), and a failing proxy is now a `ProxyError` that
names it: "the proxy 127.0.0.1:59998 (this computer's proxy settings)
could not be reached: net::ERR_PROXY_CONNECTION_FAILED" on Chromium (the
address from `session.resolveProxy`), and "the proxy 127.0.0.1:9
(HTTPS_PROXY) could not be reached: fetch failed (connect EPERM 127.0.0.1:9
…)" on Node under `NODE_USE_ENV_PROXY=1` (`NO_PROXY` honoured). The retry
line names the proxy too. Without `NODE_USE_ENV_PROXY` Node's failure stays
the host's (§58's runs A and B).

**Not measured:** a real system proxy (none was available), one Hugging
Face press and one `fetch_url` press behind it (row 19's widened half),
and the app itself running Install on `chromiumFetch` (the sandbox cannot
start Electron). The clean Mac (§3a.9) is that Install's first run.

### The URL probe and the native-import listing

**The URL probe** (the packaging lane, `NODE_USE_ENV_PROXY=1 node
scripts/probe-pack-urls.mjs`, with `github.com`,
`release-assets.githubusercontent.com`, `objects.githubusercontent.com` and
`files.pythonhosted.org` allowed): on pack 1's manifest, 69 URLs for 97
pinned files, every one answering, in 0.6 s; on pack 2's, **67 URLs for 95
files**, every one answering, in 0.6 s. Every answer was 206 with a
`Content-Range` total equal to the pin; both interpreters landed on
`release-assets.githubusercontent.com` (26,680,498 and 23,227,899 B) and
every wheel on `files.pythonhosted.org`. The manifest is read through Node
24.18.1's own type stripping (`tsx` is not in `node_modules`), which prints
`MODULE_TYPELESS_PACKAGE_JSON` to stderr, cosmetic. A verifier: exit 0, 67
URLs in 0.8 s.

**The PE listing** (the packaging lane, `python3 -I scripts/pe-imports.py
<scratchpad>/row26/win`, the Windows interpreter's tree as row 26 unpacked
it): 48 `.pyd`/`.dll` files, 45 entries. `VCRUNTIME140.dll` resolves in
`python.exe`'s folder for 42 and beside the file for 2; `VCRUNTIME140_1.dll`
in `python.exe`'s folder for 1; none is "not in the pack", none unreadable.
Every import, unfiltered (`--raw`): system DLLs and `api-ms-win-crt-*`,
plus `python314.dll`, `libcrypto-3-x64`, `libssl-3-x64`, `libffi-8`,
`sqlite3`, `tcl90`, `tcl9tk90`, `libtommath` and `zlib1`. This agrees with
§57. That list is the committed bootstrap
(`tests/fixtures/pack-native-imports-win32.json`, `"recorded": false`), with
which the CI step lists and compares nothing; the full pack's list comes
from CI's first Windows run with the pack.

### libuv's codes for a refused spawn (the Group Policy sentence)

The main-process lane: `ELECTRON_RUN_AS_NODE=1
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -p
process.versions` gives Electron 44.3.0, Node 24.20.0, **uv 1.52.1**.
libuv's `src/win/error.c` at `v1.52.1`
(`raw.githubusercontent.com/libuv/libuv`):

| Windows error | libuv | Node's `code` |
|---|---|---|
| `ERROR_ACCESS_DENIED` | `UV_EPERM` | `EPERM` |
| `ERROR_ELEVATION_REQUIRED` | `UV_EACCES` | `EACCES` |
| `ERROR_BAD_EXE_FORMAT` | `UV_EFTYPE` | `EFTYPE` |
| `ERROR_ACCESS_DISABLED_BY_POLICY` (1260) | no case: `default: return UV_UNKNOWN` | **`UNKNOWN`**, errno −4094 |

So a Group Policy block (uv #6584's os error 1260) reaches Node as
`UNKNOWN`, and `client.ts` `startFailure` matches `EACCES`, `EPERM`,
`UNKNOWN` and errno 1260 for a spawn of the pack rung on win32. On this Mac
(Node 24.18.1, uv 1.52.1) a spawn of a missing file gives `{code: 'ENOENT',
errno: -2, syscall: 'spawn <file>'}` and of a 0644 file `{code: 'EACCES',
errno: -13}`. Other unmapped `CreateProcess` failures (WDAC's 4551,
`ERROR_VIRUS_INFECTED` 225) would also arrive as `UNKNOWN` and read as the
policy sentence: unmeasured, the Surface or a managed machine's.

### The row on screen, the harness check and the census

**The harness check** (`window.__forgeHelperPackCheck()`, the harness lane,
the preview on :5199 with the pane shown and the tab fronted; the page
1100×785 px): it passed in 5.27–5.30 s, then 5,654 and 5,758 ms after the
fix phase. What each step read on screen (the Mac, pack 2, the stub at
150 ms a step for the first install and 40 ms after):

| step | on screen |
|---|---|
| absent | the store absent and the reframe's helper missing; the offer 174,314,305 B, equal to `THIS_PACK.bytes` and `packBytes(manifest)` |
| the pointer | Follow the subject disabled, one pointer "needs the AI helper" titled "install it in Settings"; its press asked Settings for the row (`settingsFocus` [null, "helper", null]), the row's top at 484.1 px in a scroll box of 79–768 |
| Not installed | grey, "Install the AI helper · 166 MB", and under it "Uses about 636 MB on disk. Downloads from github.com (and the host it redirects to, today release-assets.githubusercontent.com) and files.pythonhosted.org. Its own Python; any Python on this machine is left alone." |
| installing | EXPORT "Installing the AI helper", running, "downloading · 26 of 166 MB · 56.7 MB/s" (the stub's clock, not a network); the row "Installing · downloading · 26 of 166 MB · 56.7 MB/s", no presses, "Its bar and its X are in EXPORT." |
| the X | 3 files verified, `bytesLeft` 147,364,318 B: "Install the AI helper · 141 MB left"; EXPORT cancelled |
| the second press | 61 speed texts by a MutationObserver, folded in order: checking space, downloading (from "26 of 166 MB", what the X kept), unpacking Python, installing libraries (0 … 46 of 46), "checking the AI helper · starting (the first start is slow)", "checking the AI helper", then "· asr", "· beats", "· onnx", "· vision", "· sklearn", "· faces"; then green "Running · Python 3.14.8 · pack 2 · 636 MB" with [Repair · 166 MB] [Remove], the gear's dot green, and "Follow the subject · gets the face finder, 1.1 MB, first time" pressable |
| Repair beside the running pack | EXPORT "Repairing the AI helper"; the row "Repairing · downloading · 0 of 166 MB", Repair and Remove disabled with the title "Repairing the AI helper — its bar and its X are in EXPORT"; Follow still pressable. After the fix phase it waits for 2 files, and after the X reads "Repair · 141 MB" (147,496,397 B left of 174,314,305) |
| the speech model | Transcribe greyed "needs the speech model"; the bar "Transcribe needs the speech model" with "Get the speech model · 464 MB" (486,212,372 B); after the press Transcribe live, Settings "Speech model · 464 MB · on this machine", the bridge given `{download: true}` |
| a failed beats group | grey "Running · 8 of 9 helper features · beats needs Microsoft's Visual C++ runtime", [Check again] [Repair · 166 MB] [Remove], the whole sentence under them with https://aka.ms/vs/17/release/vc_redist.x64.exe as a link; Check again turned the row green |
| Remove | "Remove the AI helper? It frees about 636 MB." with the box "also remove the downloaded models" off ("· 464 MB" beside it since `dca719c`); "Remove it" sent `{models: false}`; back to "Not installed" with "Install the AI helper · 166 MB", the speech model kept |
| damaged | red "Not running · Python is missing from the AI helper's folder (removed by antivirus?)", [Repair · 166 MB] [Remove], the hosts sentence |
| update | grey "Needs an update", [Update the AI helper · 166 MB], "The AI helper on this computer is from an older version of the app, and is not used until it is updated." and the hosts sentence |
| policy | red "Not running · Windows' policy on this computer blocks programs in your user folder; ask whoever manages it, or point FORGE_PYTHON at an allowed Python", [Repair · 166 MB] [Remove] (the hosts sentence under them since `0537c12`) |
| unsupported | grey "Not available on this computer · The AI helper needs macOS 14 or later", no button |

- **The check's mutations** (the harness lane, each anchor counted at one
  match, each file restored and compared): M1–M11 and M3b each failed it.
  M3b (Settings opened without the focus ask) **survived** the first
  version: in a 785 px window the row is in view whether or not anything
  scrolled, so the check now watches the store's focus go [null, "helper",
  null]. A verifier re-ran M2 and M6 and dropped the hosts sentence; each
  failed it. The fix phase's two (Repair back on the whole bytes: "offers
  ["Repair · 166 MB","Remove"], not ["Repair · 141 MB","Remove"]"; the
  models' size never drawn) failed it too.
- **The page's own status** stays `{state: 'failed', error: 'harness: no
  sidecar'}` with no source, which reads "Not running · harness: no
  sidecar" with no presses: the census's settings rows and the reframe and
  clip-it checks are written against it. The check moves the stub to
  absent itself and resets it.
- **What the checks need**: the Browser pane SHOWN as well as the tab
  fronted (hidden, `requestAnimationFrame` stops and every check throws
  "the harness tab is in the background"), and a viewport about 785 px
  tall: `__forgeClipItCheck()` failed in an 800×388 pane with "Cut to these
  words (bottom 305) is below the tile's visible bottom (213.2)" and
  passed at 1100×785.
- **The console** gains repeating triplets of `forge-media://local/`
  errors (a CORS block, `ERR_FAILED`, `ERR_UNKNOWN_URL_SCHEME`) from the
  offline video asset the check places, as the clip-it check's does: a
  verifier saw 60 error entries after one check and a drive through the
  stub's states, not the two per run the harness lane counted.

**The window lane's first reading** (before pack 2 was in its tree, with a
status set by hand to pack 1's 178,190,592 B, `bytesLeft` 125,829,120 and
`bytesOnDisk` 675,763,387): "Install the AI helper · 120 MB left" and
"Uses about 644 MB on disk"; `openSettingsAt('helper')` put the row's top
at 484 px in a 768 px viewport. "Remove it" against the harness bridge got
its refusal shown in red without Electron's "Error invoking remote method
'<channel>': Error: " prefix, the confirm left open. That prefix's shape was
taken from `electron.d.ts:8997`, not measured.

**A verifier's own row cases** (a scratch test, deleted): 20 states with
odd byte counts (123,456,789, 765,432,109, 55,555,555), so no hand-written
size could pass, 20 of 20; and the stub driven through absent, ready,
ready-short, update, damaged, unsupported, policy and the harness's own,
the gear's dot matching the row's in each.

**The census** (`await __forgeCensus()`, the fronted tab):

| when | rows | checked | skipped | missing | time |
|---|---|---|---|---|---|
| `83373de` plus the bridge's two speech stubs | 827 | 819 | 8 | 1: "The AI helper (Python) is not running" [upload/video-clip] | 50.1 s |
| `e3221d3` (the harness lane) | 860 | 852 | 8 | 0 | 55.5 s |
| `1a043c9` (the fix phase) | **883** | **875** | 8 | 0 | 54.7 s |

The harness lane's 20-needs subset with `trace`: 84 checked, 14.0 s, every
new row's count less its base equal to the row's count ("left" counts 2
under helper-partial: the Install's "· N MB left" and the hosts line's "is
left alone"; "Check again" 2 under helper-short). Labels with a number use
the existing `part` kind. The fix phase's 15 new or changed needs plus
`video-clip`: 49 checked, 0 missing.

### The first Windows CI run of slices A and B (row 37, its first half)

**The CI reader**, without signing in (`curl` on `api.github.com`; about 14
of the 60 unauthenticated requests an hour):

- `…/actions/runs?head_sha=c7a2a86525310850fbbe10fc9aa8342921516434`: one
  run, **38919769393**,
  https://github.com/spyki-a/forge/actions/runs/38919769393, push on main,
  completed, **failure**, 14:55:52Z to 15:05:05Z, 9 min 13 s. The
  **short** sha gives `total_count` 0: the full 40 characters are needed.
- The job `windows-latest` (117036361563) failed: checkout, setup-node,
  setup-python, `npm ci` (24 s), `npm run typecheck` (20 s) and the yt-dlp
  cache green; **`npm test` red after 7 min 55 s** (14:57:04 to 15:04:59);
  `npm run build` skipped. The installer job (117040671611) was skipped
  with no steps, since it needs the test job. No macOS job: at `c7a2a86`
  the push matrix was Windows alone.
- **Annotations** (`…/check-runs/<job id>/annotations`): 7, every one of
  level failure, the six tests and the exit, under GitHub's 10 a step, so
  the list is whole. **The job's log answers 403** ("Must have admin rights
  to Repository."), so the suite's own totals cannot be read anonymously.
- The last green run was `d7244ce` (38453960372, 2026-10-13); `c7a2a86` is
  the first red one since `242c6d71a6` (2026-10-07). **All six failing
  tests are new since `d7244ce`**: each was running on Windows for the
  first time.

| test | CI's words | cause | fix |
|---|---|---|---|
| `reframe.int` "a followed ramp … VFR at in-point 1, ramp 1 → 0.5" | "frames off the crop they should have: … frame 289: unreadable …, mean luma 16.0", frame 290 the same | **a product bug**, below: the 2018 `setpts`' EOF | `16af45d` |
| `reframe.int` "the followed clock starts at slot 0 … VFR at in-point 1 at half speed" | frames 418 and 419, mean luma 16.0 | the same | `16af45d` |
| `shots.int` "carries each cut's exact pts …" | "every frame of the clip: expected 299 to be 300" | test-only: the win32 ffprobe's csv, below | `b046c08` |
| `shots.int` "counts those pts from the file's first timestamp … MPEG-TS" | the same, at line 187 | the same | `b046c08` |
| `unpack.test` "writes every member with its folders made …" | "The AI helper's archive holds a symbolic link (python/bin/python3 -> python3.14), which is not made on Windows" | test-only: the case unpacked the Mac's archive, link included, on a win32 host, where `unpackTarGz` refuses a link by design | `cbce56a`: one archive per platform, the win32 half run on the Mac too |
| `pipStage.test` "a cancel whose kill did not take still settles …" | `EPERM … syscall: 'rm'` in `afterEach`, after its assertions passed | test-only: on Windows `process.kill(pid, 0)` reads an exit code that `TerminateProcess` sets before the process lets go of its cwd, and a live cwd cannot be removed there | `cec5ac1`: each fake pip ended through its `'exit'`, `afterEach` failing on a pip left running, `rm` retried 10 × 100 ms |

**A slowed clip lost its last frame on the 2018 build.** `speedVideoFilter`
is `setpts=PTS/<speed>,fps=<fps>` (since `e536186`, 2026-09-16) and the ramp
also ends in `fps=`. `setpts.c` at `f22fcd4` has no `activate` callback (0
matches; 3 at `n4.4.1`, which arrived in `2a546fb7d5`, 2019-10-02, "Also
properly handle EOF timestamps. Fixes #6833"). So the 2018 build forwards
the EOF through `avfilter.c`'s default (`guess_status_pts`) with the pts it
came in with: the source's time, not the re-timed one. `vf_fps.c` (the
same at both builds) drops its last buffered frame once `status_pts <=
next_pts`, and on a slowed clip that EOF comes early, so the last source
frame's slots, about 1/speed of them, showed the canvas: 2 black frames at
0.5×. `plan.ts:1917` had recorded the same EOF for the caption overlay.
`speed.int`'s 0.35 s length tolerance let it through. **The fix**
(`16af45d`, `RETIME_TAIL`): `tpad=stop_mode=clone:stop=1` ahead of a retime
that slows (an average rate under 1) and ends in `fps=`, on the source's
clock, so its clone of the last frame sits at the EOF's own pts and
`setpts` re-times it as a frame; the last real frame then fills every slot
on both builds. Speed-ups and smooth slow motion (`minterpolate`, no `fps=`)
are unchanged. Emulated on the Mac with `setpts='if(isnan(POS),PTS,
<retime>)'`, which passes the EOF on un-retimed as the 2018 build does:
without the clone the canvas fell on clip frames [418, 419] and [289, 290],
CI's own; with it, `framemd5` equals the plain render, and the clone in the
plain render equals it too. `reframe.int` 36 of 36 on the Mac; the
mutation `stop=0` gave [418, 419] and [289, 290] again (the fix phase).
The next Windows run is the proof on the 2018 build itself.

**The two ffprobes write a frame with side data differently in csv.**
x264 puts an SEI on frame 0, which ffprobe nests as a `side_data_list`.
With `-show_entries frame=best_effort_timestamp -of csv=p=0`, `n4.4.1` (the
Mac's `@ffprobe-installer/darwin-arm64` 5.0.1) ends the frame's line and
prints a blank one (`0`, ``, `512`), as §55 noted; the win32 package
(`@ffprobe-installer/win32-x64` 5.1.0, a 2023-02-13 master build,
`2296078`) writes the item separator before the nested section, so the
line is **`0,`**. `compact_print_section_header` in `fftools/ffprobe.c`,
read at `n4.4.1` (`printf("\n")`) and `n6.0` (`writer_w8(wctx,
compact->item_sep)`). The test's `/^\d+$/` filter dropped frame 0 there:
299 of 300. ffmpeg was never short a frame, and no app code parses
ffprobe's csv (`probe.ts`, `media.py` and `facetest.py` read JSON). `b046c08`
reads JSON (`framePts`), failing by index on a frame without the field.
**Anything read per frame or per packet through `csv=p=0` has the same
exposure on Windows**; the other csv reads in the suite (exactCut's
`packet=pts_time,flags`, m0Exit, `speed.int`'s `format=duration`, shots'
`stream=start_time`) passed on this run.

**Not yet run in CI:** the pack's own steps (`446f99b`: `macos-14` in the
push matrix, the URL probe, the install or its cached Check again, the
suites from the pack, `pip check`, the PE listing). They are in the
unpushed commits, so the next push is their first run, on both runners.
Row 37's minutes on a cache miss, the cache's size and what the capability
suites find on Windows are its to read; `ci.yml`'s header gives the minutes
as an estimate (Windows about 9–14 and macOS about 6–10 a push).

### The suites at `1a043c9`

Run by the recorder to a file (`--reporter=json`), exit 0: 62 files, 817
tests, **812 passed and 5 skipped** (`asr.int`'s 3 transcription cases
without the seeded model, `helperPack.int` and `packPipCheck.int` without
their variables). Among them: `helperRow` 32, `helperCan` 7,
`reframeContract` 16, `settingsPanel` 15, `renderer/settingsPanel` 19,
`renderer/mediaPool` 9, `renderer/transcriptPanel` 16,
`renderer/fallbackBridge` 3, `renderer/ingestPanel` 23,
`renderer/reframePanel` 26, `renderer/helperJobRow` 4, `uiCensus` 9,
`packCheck` 20, `helperPackJob` 45, `helperLock` 15, `sidecarService` 40,
`sidecarClient` 19, `helperLaunch` 20, `helperPython` 28, `packLock` 14,
`helperPackManifest` 47, `packaging` 17, `probePackUrls` 14, `peImports` 6,
`fetchFile` 35, `installDeps` 5, `helperPackCi` 13, `speechModelIpc` 12,
`unpack` 21, `pipStage` 12, `sidecar.int` 20 and `asr.int` 5. `npm run
typecheck` exit 0. `PYTHONPATH=sidecar sidecar/.venv/bin/python -m unittest
discover -s tests/sidecar -p test_asr.py`: "Ran 16 tests", OK. The
speech-model lane's whole Python discovery: 148 ran, OK, 24 skipped on the
venv (no `FORGE_TEST_FFMPEG`) and 34 on a bare 3.12 (those and 10 for
numpy). The fix phase's last run over 49 files: 665 passed.

### What this settles

1. **The speech model is pinned** (`536b066…`, 486,212,372 B, "464 MB") and
   loads by path with no host.
2. **hf-xet leaves the lock**: pack 2, "166 MB" and "201 MB", 9 features.
3. **The pack's sizes on screen are MB**: 636 MB and 685 MB, until CI's
   install (row 28) replaces the PRE-CI figures.
4. **The pack's fetch inside the app is `net.request`**, not `net.fetch`.
5. **numba's cache lives in `helper-cache/numba`**, in the app and in CI's
   pack runs.
6. **A Group Policy block reaches Node as `UNKNOWN`**, by libuv's source.
7. **A slowed clip on the 2018 build needs `RETIME_TAIL`**, and **per-frame
   reads use ffprobe's JSON**.

### Still unmeasured, and whose

- **CI's first run of the pack** (row 28 on both platforms, row 37's
  minutes and cache, the capability suites on Windows, the PE list's first
  recording, `actions/cache` on a path with a space and an `é` on Windows).
  The next push.
- **Row 19's widened half**: a real system proxy, a Hugging Face press and
  a `fetch_url` press behind it; the app's first Install on `chromiumFetch`
  (the clean Mac).
- **The Surface**: rows 26's half, 27, 29, 30, 32 and 36; a real SRP or
  AppLocker block's code; the NSIS uninstaller's `isUpdated` guard (an
  update, then an uninstall); `makensis` has never compiled
  `build/installer.nsh`.
- **The 2018 build's run of `RETIME_TAIL`** and of the three Windows test
  fixes: the next Windows CI run.

## 60. Captions in the free third — the subject on the output frame, the chooser, per-event \an and MarginV on both routes (2026-10-16)

For `docs/CLIPS.md` §5 (step 2, caption free space): ten commits,
`11a07c2` … `a0837ea`, made on 2026-10-16 among other agents' (CLIPS §5's
note lists them). Development Mac, inside the dev sandbox (no Metal), the
bundled ffmpeg (the 4.1.5 darwin-arm64 package, reporting 4.4); nothing
here was run on the Windows 2018 build. Each number names who measured it:
lane A (the pure half, `frameMap.ts` and `freeSpace.ts`), lane B (the three
routes, the toggle, `captions.int`'s case), lane C (the render check,
`captionsFree.int`), the two verifiers, the fix phase, or the recorder. The
lanes' probe scripts (`probePlacement.ts`, `probe_libass_size.py`, the
mutation drivers) lived in the session's scratchpad and are not kept: the
tables here are the record. The render check is committed and writes
`tests/output/captions-free/README.txt`. §5.3 (Florence-2's OCR) is not
built, so nothing of it is measured.

### The subject on the output frame (`frameMap.ts`)

Worked by hand by lane A and pinned in `tests/frameMap.test.ts`:

- **A plain crop**, 960×1080 at x 480 of a 1920×1080 file, on a 1080×1920
  canvas. Contain: scale 1.125, the picture 1080×1215, letterboxed from y
  352.5; the source box (600, 100, 120×120) lands at x 0.125, y 465/1920,
  w 0.125, h 135/1920. Cover: scale 16/9, the picture from x −313.3; a box
  at source x 500–600, inside the crop, is cut away (null) under cover and
  shown under contain.
- **A followed crop**, 608×1080: within 1 % of 9:16 (off by 0.0008, under
  `NEAR_SHAPE`), so it fills, cover at 1.7778. A face centred in its shot
  lands centred at x 0.5 (to 2 dp) at clip frames 40 and 150, and the other
  shot's face is null on each. At project frame start + 94 the later shot's
  face is null; at start + 95, the cut, it is shown.
- **The two-up**, faces at x 384 and 1536 on frame 150: the top half's face
  centres at y 0.2 and the bottom half's at y 0.7 (`path.ts` `twoUpFaceY`,
  0.4 of each 540 px half), both at x 0.5.
- **The mouth case**, an identity mapping (a 1080×1920 file on a 1080×1920
  canvas): a face at y 0.5, 1/6 tall, ends exactly at 2/3, its lower-third
  overlap under 1e-9; extended by half its height it ends at 0.75 and
  covers 0.05 of the lower third.
- **The clock**: `exportFrameAt(sourceMsAt(k)) === k` for every k in 0..119
  at in-point 7, at speeds 1, 2 and 0.5 and on the ramps 1→0.5, 0.25→4 and
  4→0.25.

A verifier, on fixtures of its own (a scratch test, deleted):

- A followed 1920×1080 clip on a 1080×1920 canvas, cut at 3 s: `cropAt`
  gave {x 56, w 608, h 1080} at clip frame 40 and {x 1156, …} at 140;
  `sourceToFrame` matched the hand-worked cover arithmetic to 5 dp, and the
  other shot's face was null on each frame.
- A two-up with faces at x 150 and 1650: halves {0, 264, 608×540} and
  {1312, 264, 608×540}; each face at its hand-worked place in the stack,
  the top one ending at y ≤ 0.5 and the bottom one starting at y ≥ 0.5.
- 16:9, contain, a 540×960 crop at (690, 60): the box (744, 156, 108×192)
  maps to x 717/1920, y 108/1080, w 121.5/1920, h 216/1080. Cover, a
  1600×902 crop (0.22 % off 16:9): a box at the crop's corner maps to {0, 0,
  240/1920, 118.8/1080}, cut at the box. A box outside the crop is null
  under both.

### The chooser (`freeSpace.ts`)

Lane A's numbers, pinned in `tests/freeSpace.test.ts`:

- **Overlap.** One box 0.5 wide over y 0.5–0.8 covers 0.25 of the middle
  third and 0.2 of the bottom. Two boxes, (0.1, 0.7, 0.4×0.2) and (0.3,
  0.8, 0.4×0.15): their union is 0.12 of the frame, 0.36 of the lower
  third, where a sum gives 0.42. A box hanging off the frame, clipped: 0.06.
- **The rules, end to end.** A lower-third overlap of 0.04 keeps the
  bottom; 0.06 moves it to the middle. Hysteresis: bottom 0.06 against top
  0.04 (middle 0.056) stays at the bottom; against top 0.02 (middle 0.076)
  it moves to the top.
- **One choice per shot.** Ten samples over 5 s, the face's extended box
  over 0.2025 of the lower third, one sample raised into the middle (0.2025
  of it): [{30, 180, middle}], the same with the gesture and without. With
  the maximum in place of the percentile it flips to the top.
- **A cut** at 3000 ms (clip frame 90, project frame 120): [{30, 120,
  middle}, {120, 210, bottom}]; a line on frames 100–140 takes the middle.
- **A followed clip**, cut at 3166.67 ms, in-point 15: the keys put the cut
  on clip frame 80, and the spans are [{30, 110, top}, {110, 180, bottom}],
  equal to `keys.shots`.

A verifier's own: the limit is strict (0.05 stays, 0.0501 moves) and the
margin inclusive (0.1 against 0.2 moves, 0.1001 stays); a line spanning a
cut takes its start shot ([30, 120, middle], [120, 210, bottom];
`thirdAt(110)` is middle); a clip with no track gives [{30, 210, bottom}].

**Short shots.** The same verifier: Pop at the bottom, a calm face in the
upper third, and one sample, at 1000 ms, leaning into the lower third (its
extended box over 0.45 of it). `captionThirds` gave the first shot:

| shot | samples | third |
|---|---|---|
| 2 s | 4 | middle |
| 3 s | 6 | middle |
| 4 s | 8 | middle |
| 4.5 s | 9 | middle |
| 5 s | 10 | bottom |

By nearest rank, ceil(0.9n) is n for every n from 1 to 9: the 90th
percentile of fewer than ten samples is the highest, so one gesture moved
the caption in every shot under 5 s, and lane A's stability case sat at
exactly ten samples, the smallest count at which the rule held. The fix
phase (`0d7dd0b`): from `MIN_SAMPLES_TO_DISCOUNT` = 3 samples the index is
min(ceil(0.9n), n − 1) − 1, zero-based, so one sample cannot decide a shot
of 3 to 9 samples and two can; with one or two the higher stands. Its test,
a lean over 0.2025 of the lower third in shots of 1.5, 2, 3, 4 and 4.5 s:
one lean stays at the bottom, two move it to the middle. On the unfixed
code it failed, "3 samples, one raised: expected 0.2 to be 0".

**Cost** (lane B; node on the Mac, a temporary vitest probe): a 10-minute
1920×1080 clip on a 1080×1920 canvas, 1,200 samples of two faces each, 60
shots. The thirds took 4.1–9.3 ms unfollowed and 58–70 ms followed; 2,572
lookups, 0.2–1.0 ms. `Preview.tsx` recomputes the thirds on each edit while
Smart placement is on; otherwise `smartPlacement` returns before any work.

### Per-event `\an` and MarginV on the bundled libass

Lane B's probe: `buildAss` output for "Forge burns captions." at 0–1800 ms,
burned with

    ffmpeg -f lavfi -i color=c=black:s=<W>x<H>:r=10:d=1 \
      -vf ass=filename=<ass>:fontsdir=assets/fonts \
      -ss 0.5 -frames:v 1 -f rawvideo -pix_fmt gray pipe:1

A text row is a row with any pixel above 128; the first event is the one
shown. Pop's 220 reference px are MarginV 73 at 640×360 and 130 at 360×640.

| style | moved to | rows at 640×360 | rows at 360×640 |
|---|---|---|---|
| Pop (bottom) | — | 264–280 | 469–498 |
| Pop | top: `{\an8}`, MarginV 73 / 130 | 83–99 | 148–177 |
| Pop | middle: `{\an5}`, MarginV 0 | 174–189 | 309–338 |
| Pop | bottom, its own: no tag, MarginV 0 | 264–280 | 469–498 |
| Pop at the top | — | 83–99 | 148–177 |
| Pop at the top | middle: `{\an5}` | 174–189 | 309–338 |
| Pop at the top | bottom: `{\an2}`, MarginV 73 / 130 | 264–280 | 469–498 |
| Bold centre (marginV 0) | — | 171–190 | 303–338 |
| Bold centre | top: `{\an8}`, MarginV 73 / 130 | 87–106 | 154–189 |
| Bold centre | bottom: `{\an2}`, MarginV 73 / 130 | 254–274 | 453–488 |
| Bold centre | bottom, the MarginV field forced to 0 | 327–347 | 583–618 |
| Bold centre | bottom, the `{\an2}` tag removed | 171–190 | 303–338 |

- A Pop line moved to the top renders on exactly the rows of Pop placed at
  the top, and Pop at the top moved down on exactly Pop's own bottom rows.
- `\an5` centres on PlayResY / 2 and ignores MarginV.
- An event MarginV of 0 means "the style's", which for a centred style is
  0: without the field, Bold centre moved down sits 13 px from the bottom
  at 360 tall. Hence `CENTRE_MOVED_MARGIN_V` (CLIPS §5's note).
- The tag alone moves the line; MarginV alone does not.

**Through `buildRenderPlan`** (lane B; committed as `captions.int`'s "puts
Smart placement's lines in their third on the bundled libass"): a flat
#202830 file, 360×640, 6 s at 30 fps, captioned on a 360×640 canvas with a
cut at 3 s, frames taken with `-ss`. The recorder's run at `a0837ea`
printed the same rows:

| case | face top, shot 1 → 2 | smart | placement absent |
|---|---|---|---|
| Pop, lines at 1.0, 3.25 (over the cut) and 4.0 s | y 0.7 → 0.1 | 309–338, 309–338, 470–498: middle, middle, bottom | 469–498, 470–498, 470–498 |
| Bold centre, lines at 1.0 and 4.0 s | y 0.4 → 0.75 | 444–488, 295–338: bottom, middle | 295–338, 295–338 |

The moved Bold centre line ends 151 rows above the edge, within 10 rows of
where Pop's own bottom line ends (498).

**The canvas route's offsets** (`captionSpec` with a third; margin =
marginV / 1080): top, offsetY = margin − `TITLE_SAFE`; middle, 0; bottom,
`TITLE_SAFE` − margin. For Pop that is ±(0.2037 − 0.05), the top value
exactly the bottom's negation.

**Placement absent changes nothing.** Lane B loaded the HEAD `ass.ts` and
`line.ts` (`git show HEAD:`) beside the new ones and compared `buildAss`
with no `thirdAt` and `captionSpec` with no placement: every preset, Pop at
the top and Clean at 2 words a line, on 1080×1920, 1920×1080 and 640×360,
with no offset, `offsetMs` 800, a `rangeMs`, and a negative offset with a
range: 90 of 90 byte-identical. A verifier then dumped 360 outputs
(`buildTimelineCaptions`, `buildGraphicsSpec`, `planBakeOf`, `buildAss`
with offset and range, `captionSpec`) with placement absent, `'style'` and
`'bogus'`, Pop, Pop at the top, Pop with gradient-sunset and Clean,
followed and not, on the same three canvases, over a fixture whose subject
track Smart placement would act on, at `0436d83` (before step 2) and at
`04b25ab`: two 901,292-byte JSON files, `cmp` identical, none null.

### The frame libass first draws a cue on

The fix phase, through `buildRenderPlan`'s `ass=` burn: a black 640×360
timeline at 24, 25, 30 and 60 fps, one filled box per cue
(`{\p1\pos(x,100)}`), every cue ending at 5.50 s; every frame decoded in
order (`-vsync passthrough -f rawvideo -pix_fmt gray`), and the first frame
whose box centre is above 128 taken. **80 cues, each first drawn on
ceil(T × fps / 1000)**, where T is the cue's start as written, whole
centiseconds (`floor(round(ms) / 10) × 10`), and on no other frame. A cue
exactly on a frame's time shows on that frame (3.00 s and 4.00 s at every
rate). As {timeline ms: first frame}:

| fps | cues |
|---|---|
| 30 | 2950:89, 2960:89, 2966:89, 2967:89, 2970:90, 2980:90, 2990:90, 3000:90, 3010:91, 3030:91, 3033:91, 3034:91, 3040:92, 3060:92, 3066:92, 3067:92, 3070:93, 3330:100, 3333:100, 3334:100, 3340:101, 4000:120, 4010:121 |
| 24 | 2950:71, 2960:72, 2970:72, 2980:72, 2990:72, 3000:72, 3010:73, 3020:73, 3030:73, 3040:73, 3050:74, 3060:74, 3330:80, 3340:81, 3350:81, 4000:96, 4010:97, 4160:100, 4170:101 |
| 25 | 2950:74, 2960:74, 2970:75, 2980:75, 2990:75, 3000:75, 3010:76, 3020:76, 3030:76, 3040:76, 3050:77, 3060:77, 3330:84, 3340:84, 3350:84, 4000:100, 4010:101, 4160:104, 4170:105 |
| 60 | 2950:177, 2960:178, 2970:179, 2980:179, 2990:180, 3000:180, 3010:181, 3020:182, 3030:182, 3040:183, 3050:183, 3060:184, 3330:200, 3340:201, 3350:201, 4000:240, 4010:241, 4160:250, 4170:251 |

The table is pinned as `LIBASS_FIRST_FRAME` in
`tests/captionPlacement.test.ts`. The canvas bake shows the same line from
round(ms × fps / 1000), so a line starting between half a frame and a frame
before a cut is first drawn after the cut on libass and before it on the
bake. Rendered (`captions.int`, "places a line libass first draws on a
cut's frame by the shot it is drawn in"): 360×640 at 30 fps, a cut at 3 s,
shot 1's face top at y 0.7 (its third the middle), shot 2's at y 0.40
(extended to 0.58, inside the middle third, so Pop stays at the bottom);
"Late start." at 2975 ms, written as cue 0:00:02.97. With `libassLineFrame`
it is on screen on frames 90–107, rows 470–498 to frame 98 and 469–498
after (the recorder's run), the lower third, off the face's rows 256–371.
Asked at the rounded frame, as first built: rows 309–338 on every one of
its 18 frames, on the face. Not measured on the 2018 build: the case renders
it there on the next push, where the line must first show on frame 90.

### The render check (`captionsFree.int`)

The source (lane C, committed):

    ffmpeg -hide_banner -loglevel error -y -filter_complex \
      "color=c=0x203040:s=1280x720:r=30:d=3,drawbox=x=384:y=500:w=192:h=140:color=white:t=fill[s0];
       color=c=0x402818:s=1280x720:r=30:d=3,drawbox=x=704:y=64:w=192:h=156:color=white:t=fill[s1];
       [s0][s1]concat=n=2:v=1:a=0[v]" \
      -map [v] -c:v libx264 -qp 0 -preset ultrafast -pix_fmt yuv420p faces.mp4

(one line in the test). The cut is at source frame 90, 3.000 s. The
subject track is written by hand at `SUBJECT_TRACK_VERSION`: shots [0,
3000) and [3000, 6000) ms, 12 samples every 500 ms, each holding its shot's
box as shares of the frame to 4 dp. Each box edge is at least 2 % of the
output frame clear of a third's boundary at both aspects.

- **The clip** sits at timeline frame 12, in-point 6, 174 frames: shot 1 is
  timeline 12–96, shot 2 96–186. 9:16 at 360×640 follows its subject
  (`follow`, the track in `Project.subjects`, the stored crop `followKeys`
  gives): a 404×720 crop, its x stepping 278 → 598 at t = 2.783333 s
  (clip frame 84). 16:9 at 640×360 has a static crop, 1152×648 at (64, 36).
- **The lines**: seven, of two words or one, 200 ms a word, starting at
  300, 1100, 1900, 2760, 3060, 4000 and 4800 ms; timeline frames 15–27,
  39–51, 63–75, 89–95, 98–110, 126–138 and 150–162. The fourth and fifth
  sit 1 to 7 frames either side of the cut; no time falls on half a frame;
  none spans the cut. Pop with yellow words and highlight, at its own
  bottom and moved to the top (`overrides.position: 'top'`).
- **The routes**: libass through main's `prepareCaptions` (with
  `FORGE_FONTS_DIR` at `assets/fonts` and `FORGE_TEST_USERDATA` a folder
  per case), the export given `subtitlesPath`; the canvas bake with
  `textStyleId: 'gradient-sunset'` (so `captionNeedsCanvas` holds) through
  `buildGraphicsSpec`, `planBakeOf`, stand-in pictures, main's
  `writeCaptionFrame` and `writeCaptionList`, and `captionOverlay`. Each
  case asserts the route the app picks.
- **The reading**: every frame decoded in order, `-vsync passthrough -f
  rawvideo -pix_fmt yuv420p`, so frame n is timeline frame n (186 a
  render), each pixel with its chroma sample. Yellow is Y > 150 and U < 80
  (the yellow reads Y 210–219, U 16); white is Y > 200 with U and V within
  18 of 128. A caption row has at least 3 yellow pixels; a box row at least
  20 white ones, read from the bare render of the same aspect, since a
  caption over the box hides some of its rows. A line is judged on its
  frames less one at each end, its third by the centre of its rows.
  Chroma subsampling marks the white box row just above an overlapping
  yellow block as yellow (450 against the block's 451): only the controls
  overlap.

**The box**, from the bare renders, within 2 px of `sourceToFrame` of the
unextended face on frames from + 2, the middle and to − 2 of each shot:
9:16 shot 1 rows 446–569, shot 2 57–195; 16:9 shot 1 258–334, shot 2 16–101.

**The rows**, with Anton (lane C, then the recorder's run at `a0837ea`, the
same):

| route | aspect | top | middle | bottom |
|---|---|---|---|---|
| libass | 9:16 (360×640) | 148–177 | 309–337 | 470–498 |
| libass | 16:9 (640×360) | 84–99 | 174–189 | 264–279 |
| canvas stand-in | 9:16 | 130–188 | 291–349 | 451–509 |
| canvas stand-in | 16:9 | 73–105 | 163–195 | 254–286 |

The hand-derived thirds (`EXPECTED`, which `captionThirds` must also
give): Pop at the bottom takes the middle in shot 1 (the bottom third's
overlap 0.42 at 9:16 and 0.14 at 16:9, the middle and the top both 0, the
tie to the nearer) and its own bottom in shot 2; Pop at the top keeps the
top in shot 1 and takes the bottom in shot 2 (the top third's overlap 0.35
and 0.15, the bottom 0). Every smart render read so, on every line.

**The nearest any caption row came to the box**, in rows, and in brackets
the canvas cases with the block raised by the real paint's overhang (below):

| aspect | route | Pop at the bottom | Pop at the top |
|---|---|---|---|
| 9:16 | libass | 108 | 268 |
| 9:16 | canvas | 96 (96) | 255 (238) |
| 16:9 | libass | 68 | 158 |
| 16:9 | canvas | 62 (62) | 152 (142) |

No smart render put a caption row on the box on any frame. The eight
controls (placement absent) sit in the style's own third and on the box on
42 frames (Pop at the bottom, lines 1–4) or 36 (at the top, lines 5–7).
Each render and its decode took 0.3–0.8 s; the file ran in 10–12 s for
lane C and in 9.3 s in the recorder's run, 19 of 19.

**Against CLIPS §5.4's table** (640×360, PlayResY 360, a style with MarginV
20, measured by the plan: bottom 306–332, `\an8` 26–52, `\an5` 167–191,
per-event MarginV 90 236–262): `\an5` centres on PlayResY / 2 = 180 in
both, the plan's rows on 179 and Pop's on 181.5. Under `\an8` the plan's
first row is 6 below its MarginV of 20, Pop's 11 below its 73. At the
bottom both end 8 rows above MarginV from the edge (332 = 360 − 20 − 8;
279 = 360 − 73 − 8).

### The stand-in against the real painter, and the band

The canvas route's glyphs are stood in: each line is the opaque yellow
block `layoutText` gives it, since `drawTextOnto` needs a DOM canvas and
the check runs in node. Lane C measured the real paint in the harness:
`drawTextOnto` on a canvas, Anton from `assets/fonts`, word 0 lit as the
band's measure paints it, ink where alpha > 4, the same specs:

| canvas | paint | top | middle | bottom |
|---|---|---|---|---|
| 360×640 (fontPx 50) | plain Pop | 115–177 | 276–338 | 436–498 |
| 360×640 | gradient-sunset | 114–183 | 275–344 | 435–504 |
| 360×640 | the blocks | 130–188 | 291–349 | 451–509 |
| 640×360 (fontPx 28) | plain Pop | 65–99 | 155–189 | 246–280 |
| 640×360 | gradient-sunset | 64–102 | 154–192 | 245–283 |
| 640×360 | the blocks | 73–105 | 163–195 | 254–286 |

So the real ink begins 15–16 rows (8–9 at 28 px), about 0.32 of the font
size, above the block's top, and ends 3–11 rows inside its bottom. The test
does not re-run this. Lane C dropped a canvas-only "real-paint clearance"
assertion it had written: with 142 or more rows of headroom in this
fixture it could fail only at an absurd overhang, so the figure is
reported (the brackets above) instead of asserted.

**The band.** As first built, the check carried its own copy of
`measureBand`'s arithmetic; the fix phase (`a0837ea`) moved it to
`captions/bake.ts` `captionBand`, which the renderer calls with the ink it
paints and the check with its blocks. The bands are the copy's: 9:16 Pop at
the bottom, smart, y 290 h 220; at the top, smart, y 130 h 380; 16:9 y 162
h 126 and y 72 h 216; the controls y 450 h 60, y 130 h 60, y 254 h 34 and
y 72 h 34. The harness's real `bakeCaptions` (360×640, Pop with
gradient-sunset, lines at 0.3 s and 3.06 s, a cut at 3 s): smart with Pop
at the top, y 122 h 224; at the bottom, y 284 h 222; the style's own, h 62
(y 122 at the top, y 444 at the bottom). A smart band spans every third
its lines use, where §13 measured a band overlay at 2.61 s and a full
frame at 5.15 s per 10 s at 1080×1920 (1.75 s with no captions); a
1080×1920 export with Smart placement on is unmeasured.

### No Anton on CI

`/assets` is gitignored, so neither runner has the bundled fonts and
libass draws a fallback face. In run 38986994729 lane B's three-word Pop
line, 470–498 of 640 here, ran to rows 409–498 on both windows-latest and
macos-14, across the 426.7 boundary, and the case read it as "across" where
it expected "bottom": an unmoved line, Pop at its own bottom (`0c08569`
reads a line's third by the centre of its rows since). 90 rows is a
height `captionsFree.int`'s header reads as the line wrapped into two.
Lane C's rehearsal here, the fonts folder emptied, this Mac's fallback
face: 19 of 19 passed; at 9:16 bottom 462–498/499, middle 302–338, top
141–177, the face 36–37 rows tall against Anton's 29; at 16:9 260–280,
170–189, 79–99. Hence two-word lines in the render check. The runners'
fallback faces, and how they wrap, stay unmeasured until a run of
`captionsFree.int` is read: its one notice, "captionsFree: caption rows",
carries every case's rows.

### libass draws Anton at about 0.57× the canvas painter's size

Lane C, bare glyphs ("WE GO UP" in Anton, no outline, shadow or highlight):

| | libass | the canvas (`drawTextOnto`) |
|---|---|---|
| Fontsize / fontPx 50 at 360×640 | 25 rows (311–335) × 100 px | 44 rows (288–331) × 174 px |
| Fontsize / fontPx 28 at 640×360 | 14 rows × 56 px | 25 rows × 98 px |

0.57 on both axes. ASS's Fontsize is not the canvas's em size, so for the
same Pop style a plain-style export, which libass burns, draws its
captions at about half the height the preview shows. Unrelated to Smart
placement and not fixed here: `ass.ts` would scale Fontsize by the font's
own ratio, or the canvas match libass. A step of its own.

### The mutations

Every anchor was counted at one match before it was changed, and every
file restored byte for byte and checked (one verifier worked in a clean
`git archive` copy instead).

- **Lane A** (`freeSpace.test`, `frameMap.test`): no hysteresis, 1 failed
  ("rule 2's hysteresis"); no downward extension, 4; the percentile as
  `Math.max`, 2; the union as a sum, 1 ("two boxes that overlap count their
  union, once": 0.42 for 0.36); the two-up's halves as one crop, 1 (the
  right face null, the left at y 0.37 for 0.2); the nearest sample across
  the cut, 1 (frame 86 took shot 1's sample at 3000 ms); the canvas
  ignored, 1; always contain, 1; the project frame read as the clip frame,
  1.
- **Lane B, the routes** (`captionLine`, `captions`, `captionPlacement`,
  `project`): the override ignored in `line.ts`, 4; the tag dropped, 4;
  MarginV left 0, 1; `placement` ignored by `buildAss` (`const ask =
  undefined`), 5, and after the agreement test was split per route only
  the libass test and "all ask at the same frame" fail, the canvas and
  preview tests passing; the canvas route ignoring the lookup, the canvas
  test alone; the libass lookup on the wrong clock, the libass test and the
  same-frame test; a line asked by its last word, 2; absent read as smart,
  2; a centred style keeping marginV 0, 2; a bad value kept on load, 1;
  the preview's draw losing the lookup from its dependencies, 1; the canvas
  route asking at the line's last frame, the canvas test.
- **Lane B, the render** (`captions.int`): the tag dropped, failed (every
  Pop line at the bottom rows); `buildAss` ignoring placement, failed.
  MarginV left 0 **passed at first**: Pop moves to `\an5`, where MarginV is
  ignored. The Bold centre case was added for it, and it fails ("the moved
  centred line is clear of the edge: expected 21 to be greater than 100").
- **Lane B, the toggle and the census**: the pointer as plain text, 2; the
  switch enabled with no helper, 3; the no-track tooltip lost, 1; the store
  writing `'style'` always, 2; starting read as missing, 2; a greyed switch
  that cannot be turned off, 1; "Smart placement" renamed, "reframe a clip
  first" renamed, and a recipe removed, each failing `uiCensus`.
- **Lane C** (`captionsFree.int`, twice, the same results): `buildAss`
  ignoring placement, exactly the four libass smart cases (9:16 Pop at the
  bottom: rows 470–498 inside the box's 446–569 from frame 15, on 42
  frames; at the top, 148–177 inside 57–195 from frame 98; at 16:9, 264–279
  inside 258–334 and 84–99 inside 16–101), the canvas cases and the
  controls passing; the canvas route's third dropped, exactly the four
  canvas smart cases (9:16 rows 450–509 inside 446–569 from frame 15);
  main not passing the lookup, the four libass cases (which `captions.int`
  cannot see: it calls `buildTimelineCaptions` itself); the libass lookup
  on `round(ms × fps / 1000)`, the four libass cases (line 1 asked at frame
  9, before the clip, so at the style's third, on the box; line 5, two
  frames after the cut, at shot 1's); absent read as smart, all eight
  controls ("L1 at the style's bottom: … L1 309-337 [middle]").
- **A verifier**: lane A's first three again (1, 4, 2); the tag dropped, 4;
  MarginV 0, 1; the switch enabled with no helper, 3; `buildAss` ignoring
  placement and the canvas route's third, each exactly its own route's four
  smart cases. **The other verifier**, in a clean `git archive` copy: no
  hysteresis 1, no extension 3, `buildAss` ignoring placement 4 failed and
  15 passed.
- **The fix phase**: plain nearest rank put back; the discount from two
  samples; the end-to-end half alone; libass asking at the rounded frame
  (both unit cases and the `captions.int` render); round for ceil; the
  centiseconds dropped; the preview ignoring the route; the preview always
  'canvas'; `assTimeMs` rounding the centiseconds; `toAssTime` rounding on
  its own; the faces-only gate (2); the band from the first line only (the
  four canvas smart cases, shot 2's lines missing, the controls passing).
  Each failed.

**Two invalid passes, both caught.** Lane A and the fix phase each first
ran their mutations with the test files in one zsh variable, `$T`: zsh does
not split an unquoted variable, so vitest got one filter, found no test
files and exited 1 on every mutation, which reads as a kill. Both caught it
(no summary line) and re-ran with the paths as separate arguments; the
results above are from those runs. And one of lane C's runs overlapped a
parallel run of the same file, which cleared `tests/output/captions-free`
and the bake's folder mid-render: two false failures. Each case now has its
own userData folder; the output folder is still shared, so the file must
not run beside itself.

### The suites at `a0837ea`

Run by the recorder to a file (`--reporter=json`), exit 0: 11 files, 190
tests, all passed. `frameMap` 14, `freeSpace` 14, `captionPlacement` 21,
`captionLine` 33, `captions` 27, `captionBake` 21, `project` 18, `uiCensus`
9, `renderer/smartPlacement` 6, `captions.int` 8 and `captionsFree.int`
19. Lane B's census run in the harness: 288 rows, none missing. The whole
suite and CI are the orchestrator's.

### What this settles

1. **A face on the output frame is the export's own arithmetic**: the
   crop through `cropAt` (both halves of a two-up), the fit through
   `fitFor`, the sample from the shot the export shows.
2. **One choice per shot holds in short shots too**: from three samples
   one gesture never decides a shot.
3. **Per-event `\an` and MarginV move a libass line to each third** on the
   bundled build, with the field written so a centred style moved to an
   edge keeps off it.
4. **libass first draws a cue on the frame its centisecond time rounds UP
   to**, so each route asks about a line at its own first frame.
5. **With placement absent every caption output is byte for byte as
   before.**

### Still unmeasured, and whose

- **Windows CI, read since**: `captionsFree.int`'s first run, the push of
  `fb65a18` (run 38988978219), passed 19 of 19 on both runners with Anton
  absent. The Windows notice's rows, the 2018 build drawing a MOVED line
  through per-event `\an` and MarginV for the first time: 9:16 libass Pop
  at the bottom 300–337 (shot 1, moved to the middle) then 461–498 (shot 2);
  Pop at the top 140–177 then 461–498; 16:9 libass 169–189 then 260–280;
  the canvas cases 291–349 / 451–509 and 163–195 / 254–286; the box rows
  446–569 and 57–195 (9:16), 258–334 and 16–101 (16:9); every control on
  the style's rows. macOS 14's fallback face read 302–338 / 462–498 and
  170–189 / 260–280. Still to read: the late-line case and the shared band
  (the push after `d0f92d0`).
- **The ten clips** (CLIPS §5's exit): zero sampled caption lines on a
  face. No reader exists for it yet. The user's.
- **A 1080×1920 export with Smart placement on**: the band across thirds,
  and the preview's recompute on a long followed clip while editing.
- **Burned-in text** (§5.3): after 1g.
