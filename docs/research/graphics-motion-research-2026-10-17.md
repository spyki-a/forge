# Motion graphics for 3dit: what the pro reveals and tutorials do, and how the three.js rail renders it

*Research, 2026-10-17, written against `docs/CLIPS.md` §6 (step 3, the
graphics engine and the Director's third pass, lines 7586-8268) and §9
(step 6's 3D templates, lines 9102-9181). It answers the user's request: before
the three.js graphics engine is planned, research how raw talking-head and
screen footage can come out looking professionally motion-designed, as the
modern SaaS reveals and tutorials do, with hand gestures, pop-ups, moving
lines, tree-like arrows and the rest of that motion, and how it fits 3dit's
existing three.js rail.*

*Who wrote it. A research workflow: seven agents each researched one angle
(the SaaS reveal films; tutorials and screen recordings; how creators make
these graphics; three.js for deterministic 2D and 2.5D; hand gestures
through MediaPipe; the AI editors; what the repo already has). A
fact-checker per angle re-opened every cited page and confirmed, corrected
or struck each claim. A writer merged the seven into this document and a
critic read it; a fixer then applied the critic's findings, re-reading
every source a fix needed. Where a fact-checker corrected a claim, the
corrected fact is the one used here. No code was written, nothing was
installed, nothing was committed. The only things run were read-only:
`ffmpeg -h filter=overlay` on the bundled macOS binary, HTTP HEAD requests
(headers only) for MediaPipe model sizes, a read of the installed
MediaPipe wheel's source in `sidecar/.venv-faces`, and, for the fix, the
hand model card's PDF read through WebFetch with its text extracted by a
standard-library Python script. The web search budget ran out during the
fix, so the motions it added to §1.2 (rows 33-40) rest only on sources
already gathered, and their timings are unsourced.*

**How to read the citations.**

- `[n]` is a source in §8, with its title, URL and date (published or last
  updated; "accessed 2026-10-17" where only that is known).
- `file:line` is the repo at HEAD `7964d8a` (2026-10-16), read 2026-10-17.
- **(computed)**: arithmetic done here from a cited formula or default.
- **(inference)**: our reading, not any source's statement.
- **(proposal)**: a design value to measure, not a finding.
- **(unverified)**: no page opened could confirm it; kept only where the gap
  itself matters.
- **No launch film, tutorial or competitor's output was watched**: this
  workflow has no video access. Every description of a named film or
  product is second-hand, from its maker, a studio, a vendor or a reviewer.
  No number here is a frame count taken from a real video.

---

## 0. The verdict

The bar, in the user's words: raw footage "will completely modify and look
like pro", as the modern SaaS reveals and tutorials do, automatically.

| plan | what it adds | rating against the bar (inference) | days |
|---|---|---|---|
| CLIPS §6 as written | six canvas 2D templates (counter, bars, steps, quote, callout, ring), the graphic style, `graphics@1`, the validator | **4 / 10** | 14.5 |
| §7's phases 0-2 | one motion system; one stroke primitive (arrows, underlines, connectors, trees); a keyword card and a lower third that fire on clips with no numbers; `steps` with a connector or a tree; a dim; sound on the beats | **5.5 / 10** | 24, plus the 1.5-day hand spike run during phase 2: 25.5 |
| + phase 3 | the three.js compositor: 2.5D variants, the screen-recording card, glow and the edge sweep | **6 / 10** | +5: 30.5 in all |
| + phase 4's hand build, only if the spike passes its gate | the presenter points, and a callout anchors there | **6.5 / 10** | +6 |
| an automatic pipeline over this footage, at best | — | about **7.5 / 10** | — |

Every rating here is our judgement against the user's bar, not a
measurement (inference); the first measurement of the look is phase 2's
blind rating (§7.3).

**Why §6 as written is a 4.** Its architecture is the right one, and the
research supports it more than it replaces it. The model fills typed fields
of templates the app drew; a validator drops any number or name that was not
said; the beats come from word timings; placement comes from step 2's
free-space map; the preview equals the export. No AI editor read for this
research auto-generates a graphic derived from a number the speaker said and
checked against the transcript (§3), and five of the six templates are among
the transcript-driven patterns both the reveal and the tutorial rankings put
near the top (§1.3). It is a 4 because of coverage, not design. First, it
fires only where a number, an ordinal list, a quotable line or a face to
point at is said, and its own spacing rule (graphics at least 6 s apart and
at most one per 20 s, CLIPS.md:8051) caps it at three a minute: a wedding
talk with no numbers in it gets little or nothing, and the rest of the clip
is captions over reframed footage, as today. Second, of the things the user
named, it covers pop-ups only as data cards, moving lines and tree-like
arrows only as the callout's one arrow, and hand gestures, tutorial moves and
2.5D not at all (three.js waits for step 6). Third, its motion menu
(`out-cubic`, `out-back`, `linear`, CLIPS.md:7808) lacks the front-loaded
expo-out the reveal films and design systems use, and its `out-back`
overshoots by 10% (computed), between 2.6 and 67 times what the one codified
launch-film spec allows for any element (computed from [20][25]). Fourth, no
sound is tied to a graphic, though the reference films carry sound [7][9].
Fifth, its quality ceiling is the design of six templates nobody has drawn
yet, and no third-party review measures graphic quality for any product
(§3.4).

**Why phases 0-2 are a 5.5.** They keep every settled decision (§16.7-11)
and the whole Director and validator spine, and add what the research found
missing and cheap: one motion system (named curves, a closed-form spring, a
duration table) under every graphic; a draw-on stroke primitive that makes
lines, arrows, underlines, connectors and trees one motion; a keyword card
and a lower third, which fire on clips that say no numbers; a dim behind a
graphic, for daylight footage; and sound on the graphic's beats from the
library's own sounds. With them every pattern ranked 1 to 11 in §1.3 is
covered, and the user's "moving lines" and "tree like arrows" exist. They
are 1.5 above §6 mainly because a clip with no numbers in it gets graphics
at all. They are not higher because a screen recording gets only what a
talking head gets, and nothing has depth.

**Phase 3 adds half a point (6).** One engine whose draw list a canvas 2D
painter and a three.js compositor both read, so 2.5D now and step 6's 3D
later are the same path; a screen recording gets a 2.5D card, and the hero
graphic a glow or an edge sweep. That is the three.js engine the request is
about, but on talking heads it is an accent, not the bulk of the look.

**Phase 4 adds half a point (6.5), and only if its gate passes.** "Point,
and a callout appears there", which no shipping editor found does. The hand
track is unproven on this user's footage: the hand model's card puts henna,
jewellery and held objects out of scope and says it was not tested in low
light or motion blur [176], and a sideways point often leaves a 9:16 crop
(§5.6).

**Why the full plan stops at 6.5, and nothing automatic gets past about
7.5.** The tutorial signature moves (auto-zoom on
clicks, cursor smoothing, click ripples, keystrokes) run on input recorded
at capture [36][39][44], which 3dit's imported footage does not carry. The
core of a SaaS reveal is a product's interface rebuilt by a designer [1][4];
nothing in a creator's footage supplies it. And the look is our own
templates' design, unmeasured until the blind ratings in phase 2. Without
cursor data or bespoke design, an automatic pipeline over footage like this
tops out at about 7.5 (inference).

The cost is stated plainly: 30.5 days unconditionally (phases 0-3 and the
hand spike), against §6's 14.5 plus 2 moved from step 6, and 6 more for the
hand build if the spike passes its gate.

---

## 1. The catalogue

### 1.1 Three families, told apart by what fires them

The patterns come from three families that differ less in how they look than
in what drives them. That trigger, not the look, decides what 3dit has to
know about the footage.

**Launch and reveal films are authored.** They are short, product-led and
mostly silent. Lago, which took Linear's launch films as its reference,
describes them as having no voiceover, no stock footage and no abstract 3D
shapes, the camera moving through the real product "one action at a time"
[1]. A studio's review gives "Introducing Linear for Agents" as 0:33 with no
voiceover and ambient sound, "Introducing Cursor 2.0" as 1:04 with no
voiceover, and Notion 3.0 "Agents" as 1:30 of music, product and on-screen
text [2]. Its talking-head counter-case is in its Shopify integration entry:
"A presenter on camera with polished UI animation gets the best of both" [2].
a16z's speedrun article describes single launches, not a survey: a 23 s
Claude x Blender demo by Siddharth Ahuja, a two-minute Shortcut video by
Nico Christie with a founder intro of about 15 s and more than half its
runtime on the product, and FLORA's "brutal left hook" [3]. Cutscene sells a
6-10 s teaser, a 10-20 s feature clip and a 30-60 s launch film, "Silent-first,
so it works with the sound off", the UI rebuilt as vectors, each 9:16 cut
"re-composed for its frame, not cropped", one message and one call to action,
type and colour locked in style frames before animating [4]. A 2026 ranking
puts a social cut at 15-60 s, with the problem and promise landing "inside
one second, before the scroll" [5].

**Screen-recording tools run on input captured at record time.** Screen
Studio records "precise mouse movement data and synchronizes it with the
recorded video", and adds the cursor back in the final video [36]. Tella
offers no auto zoom on Chrome-extension recordings of a window or the whole
screen, which carry no cursor data, nor on camera-only clips [39]. Cap's
keyboard track shows keypress overlays only "(when captured)" [44]. 3dit
imports finished footage and records nothing, so this family has no input
to run on.

**Talking-head editors run on the transcript.** Submagic syncs its zooms "to
your spoken audio" [62]; the caption looks its imitators sell are timed per
word [58][59]. 3dit has the words (Whisper, or a link's own captions) and,
since step 1, a face track.

The hand-built explainer is the bar all three are measured against: a
Kurzgesagt video of about nine minutes "can reach 1200 hours" of production,
with illustration and animation taking 8-12 weeks each, in Illustrator,
After Effects and Cinema 4D (2020) [57]. None of that is automatic. What can
be automated is its vocabulary: the arrow drawing on, the leader line, the
tree growing node by node, fired from the words and the face track instead
of an animator's hand.

### 1.2 The patterns

Timings are given where a source gives a number. Vendors mostly publish
named presets; §1.4 collects the numbers that exist. "Needs" is what 3dit
would have to know about the footage: **words** (word timings, which 3dit
has), **face** (step 1's track, which it has), **hand** (which it does not
have), **cursor** (clicks and cursor path recorded at capture, which it does
not have), **rebuilt UI** (a designer's rebuild of a product's interface,
which footage never carries), or **nothing**.

| # | pattern | what it is | timing / easing | fires on | needs | example |
|---|---|---|---|---|---|---|
| 1 | Blur-rise type | Words enter from 6-20 px below, from 6-10 px blur and opacity 0, to sharp | Magic UI `blurInUp`: y and blur over 0.3 s, opacity over 0.4 s. `BlurFade` defaults: 0.4 s, 6 px blur, 6 px offset, ease-out, delay 0.04 s. The default stagger spreads the duration over the segments, with per-segment offsets of 0.05 s a word, 0.03 s a character, 0.06 s a line [14][15] | a headline, a feature name, the call to action | words | Magic UI [14][15] |
| 2 | Word-staggered rise | Words rise 50 px from opacity 0 | After Effects range selector by words, shape Ramp Up, Ease Low 100%, offset −100% to 100%; motion blur on every layer [110] | a line starting | words | a TomsProject tutorial retold by a vendor [110] |
| 3 | Word-synced emphasis | Two to four words in capitals, the spoken one yellow, each popping in with a small bounce; or a phrase at a time beside the speaker, key words yellow on a desaturated picture | per word. A vendor's 2025 article describes a calmer trend it labels "Hormozi 2.0", with "smooth fades instead of jarring pops" [60] | every word | words (face, to sit beside it) | the Hormozi and Ali Abdaal looks, as vendors selling imitations describe them [58][59][60] |
| 4 | Content swap | A line or value replaced in place: the old exits short and early, the new springs in | exit 0.12 s; entry a critically damped spring at 26 rad/s with a 10 px blur and a 16 px rise falling away; 90% at 0.150 s, 99% at 0.255 s (computed) [20] | a value that changes, before becoming after | words | product-launch-motion [20] |
| 5 | Counter, stat reveal | A number counts up and settles; or digit slots roll like an odometer | Magic UI's ticker: a spring at stiffness 100, damping 60, mass 1, formatted `en-US`; 50% at 0.42 s, 90% at 1.36 s, 99% at 2.70 s (computed) [16] | the word that says the number | words | [16]; the odometer in [20] |
| 6 | Items assembling one per item | Bars, rows or cards land one after another; bento grids | the stagger set by speech, not a constant; logos "one per beat" [19][20] | each spoken item | words | bento grids in the Linear look [6]; [19] |
| 7 | Pop-up card | A notification, chip or screenshot slides or springs in, holds, leaves | Jitter's free iOS notification template: 3 s in all, "a realistic slide-in motion" [55] | a mention, a number, a name | words (face, to pick the free side) | Jitter [55] |
| 8 | Card pop with ripples | Scale from 0 to a larger value; duplicated rings at 5-15% opacity scaling out behind it | Easy Ease; ripples offset for a stagger [110] | a scene starting | nothing | [110] |
| 9 | Punch-in on the word | A hard cut to a tighter crop and back; one step tighter per listed item; a slow push for a thesis line | it "reads as intentional only when it lands exactly on the word's onset" [42]; scale to 110 or 115% [61]; 10-20% punch-ins and a cut every 1-3 s in the Hormozi look [58]; six unnamed styles, "progressive or fast", synced to speech [62] | emphasised words | words, face (to keep the crop on it) | Tella [42], Submagic [62] |
| 10 | The product as the set | A virtual camera zooms into one action, whip-pans to the next screen, holds on the payoff | camera x, y and log-zoom on springs at damping ratio 1; a target that must arrive at T is issued about 0.3 s early [20] | the body of a launch film | rebuilt UI | Linear's films, per Lago [1]; [20] |
| 11 | Click-led auto zoom | The frame zooms toward a click, glides with the cursor, zooms back out | Screen Studio's screen presets Focused and Smooth [38]; Cap: amount, focus, glide, edge snap [44]; Tella: Adaptive, Subtle, Moderate, Intense, a range of at least 1 s, a playhead zoom up to 5 s [39]; Cursorful: two or more clicks within 3 s, a rule meant to avoid motion sickness [43]; Reframed: Hermite keys from click clusters and dwell [48] | a recorded click. Where no click occurred, Screen Studio's auto zoom "will not zoom to any area" [37] | cursor | Screen Studio [36][37], Tella [39], Cap [44] |
| 12 | Cursor smoothing, enlarging, motion blur | A shaky cursor path redrawn as a glide; the cursor enlarged and blurred on fast moves | Screen Studio's cursor styles Smooth, Medium, Rapid, None, and one motion-blur slider with separate control for cursor, zoom and panning [38]; Cap's cursor presets Slow, Smooth, Mellow, Fast, Custom [44]; Reframed records the cursor at 120 Hz apart from the frame rate [48] | continuous | cursor | [38][44][48] |
| 13 | Cursor as actor | A drawn cursor drives each change: it dips on press, ripples, trails | press to 0.84 scale with a 45 ms Gaussian width (derived), a 0.4 s ripple ring, a trail up to 198 ms (derived) [20]; in After Effects, a curved Easy Ease path, the button shrinking and its exposure dipping [110] | each click in a rebuilt UI | rebuilt UI | [20][110] |
| 14 | Click ripple and rings | A ring or ripple expands from the click | Camtasia: rings, ripple, four bursts, warp, scaling, target, Click Zoom, Scope, an optional sound [49]; Screen Studio: "a quiet circle or ripple" [36]; no durations published | a click | cursor | [36][49] |
| 15 | Keystroke overlay | The keys pressed appear in a pill, low in the frame | KeyCastr shows command keys only, modified keys or every key, defaults to bottom left, and hides input where the app treats password entry as secure [51]; Carnac does the same on Windows, dormant since its 2.3.13 of 2020 [52]; Cap's keyboard track only when captured [44]; Camtasia's keystroke callouts are set by hand [50] | a key press | keys captured at record time | [44][50][51][52] |
| 16 | Dim and spotlight | Everything darkens except one region | Tella: one intensity control, a hard cut by default, "Smooth" fades it in and out [40]; Camtasia's cursor spotlight [49]; IBM Carbon gives background dimming its longest token, 700 ms [26] | a callout taking focus; a step being explained | face, or a region (the cursor on screens) | [26][40][49] |
| 17 | Draw-on arrow, circle, underline | A stroke revealed along its length, clean or marker-drawn | After Effects' Beam effect with Time keyed 0 to 50% [54]; Camtasia's Sketch Motion callouts set their own draw time, and annotations default to 5 s on screen [50] | the word naming the thing | words, face or a subject box | [50][54] |
| 18 | Callout with a leader line | A dot appears on the target, a line draws out of it, a label wipes on at the line's end | in this order: the dot scales up from 0 with a second "radar blip" copy; the line draws; the label's background wipes on (X scale 0 to 100) with the text matted to it; the dot pinned to a single-point track [54] | the noun pointed at | words, a tracked point | PremiumBeat, 2018 [54] |
| 19 | Connector lines, the travelling beam | Hairlines with dots run between chips and logos; a gradient pulse travels along a curve between two elements | the beam: a quadratic Bézier with its control at the midpoint's x, a gradient segment travelling in a 5 s loop, eased `cubic-bezier(0.16, 1, 0.3, 1)` [17]. "Lines with dots" appear in Whop, AuthKit, Gitness and Particl [6] | "X connects to Y", integrations, a feature tree | words | [6][17] |
| 20 | Tree or mind map, built step by step | Nodes and connectors appear in order, so the diagram grows as the speaker talks | excalidraw-animate: 500 ms per element by default, in creation order or an explicit Order; a group shares 5 s [56] | each item as it is said | words | [56] |
| 21 | Light sweep on an edge | A short highlight runs around a card's border | Magic UI `BorderBeam`: a 6 s loop, linear easing, a 1 px border [18] | the hero card | nothing | [6][18] |
| 22 | Dark ground, glow, glass | Light on dark; blurred colour spills; frosted glass `blur(6px)`; faint gradient headings; one sans-serif | static, or a slow drift | throughout | nothing | "The Linear Look" [6] |
| 23 | 2.5D screen or device, pull-back | Start with the screen filling the frame and "slowly zoom out" to reveal the device; labels that follow it or face the camera; layers in front and behind on alpha | no numbers given [10] | an opener | the recording's frames | Rotato [10] |
| 24 | Continuous transitions, match cuts | One shape carried across a cut; motion continuing through it on the same easing | "an empty frame is a bug" [19]; consistent easing either side [110] | between scenes | nothing | [19][110] |
| 25 | Camera layouts | Screen full with the speaker in a corner, split, or camera full; the camera "steps aside" when the speaker stops talking | five layouts in one recording [36] | a sentence, a silence | words, face | Screen Studio [36] |
| 26 | Lower third | Name and role low in the frame | read at least twice at 200 words a minute [34], about 0.6 s a word (computed); adult reading up to 20 characters a second [33]; Camtasia uses callouts as lower thirds [50] | the speaker's first appearance | the name, from the user | [33][34][50] |
| 27 | Text behind the subject | Type between the background and a cut-out of the person | CapCut: duplicate the clip, text between the copies, "Auto removal" on the top one [85] | the editor's choice | a person matte | [85] |
| 28 | Emoji or sticker pop | An animated emoji beside the caption word, sometimes with a sound | on a keyword [62] | a keyword | words | Submagic [62] |
| 29 | Gesture reaction | A held hand shape sets off an effect around the person | Apple: hold the gesture until the effect appears [189]; a review: "Wait for a couple of seconds", then effects play behind, in front of or around the person [191]; Zoom: hold for about four seconds, with a timer ring [192] | a held hand shape | hand | Apple [189][190], Zoom [192] |
| 30 | The presenter points; a graphic appears there | The fingertip at the moment of the point anchors a card or an arrow | no shipping editor found. A live research system places visuals where an index finger points, triggered by spoken nouns, 1.47 s from utterance to visual, with no thresholds published [188] | a held point, with the word | hand, words | RealityTalk (UIST 2022) [188] |
| 31 | End card | One call to action | not quantified [4] | the last seconds | nothing | Cutscene [4] |
| 32 | Grade and grain | A warm grade [8]; a teal-orange grade [9]; analog grain read as a reaction against AI-generated sameness [11] | static | the whole film | nothing (3dit's look) | [8][9][11] |
| 33 | Particle or confetti burst | Small pieces burst out and fall around the person | Apple's reactions include Balloons (V), Confetti (both V) and Fireworks (both thumbs up), each fired by a held hand shape [189]; no timing published | a held gesture, live | hand | Apple [189] |
| 34 | Animated icon, check tick | A small icon or a tick animates beside an item | Agent Opus lists "automated shape and icon animations" [68]; Animated Noto Emoji ships as Lottie [114]; no timing read | each item, a keyword | words | [68][114] |
| 35 | Line chart drawing on | A series' line draws along its length | no source read describes or times it; Agent Opus's "animated infographics" is the nearest claim [68] | several said values, in order | words | — |
| 36 | Typewriter or code reveal | Text appears a unit at a time; in a tutorial, code typed into a terminal | 3dit's caption `typewriter` is per word, a hard cut each, because "anything softer stops looking like typing" (`textAnimation.ts:116-123`); a code-terminal reveal was not researched | a line starting; code on screen | words (a terminal needs the code's text, which the transcript does not carry) | 3dit |
| 37 | Magnifier lens | A region of a screen enlarged in a lens | among Camtasia's cursor effects, so it follows the cursor [49]; no timing published | the cursor | cursor | Camtasia [49] |
| 38 | Shape morph | One shape becomes another | Motion Design School sells an After Effects script named Super Morphings [100]; no timing or automatic route read | — | an animator | [100] |
| 39 | Masked or wipe reveal, marker sweep | Text slides out of a mask or is uncovered by a wipe; a highlight sweeps behind a word | Jitter's presets include mask [101]; no source timed any of them (§6.4) | a keyword | words | [101] |
| 40 | B-roll or a picture over the speaker | Footage or a picture covers the speaker, or sits beside them | Submagic's Magic B-rolls adds B-roll, zooms and transitions in one press [62]; Screen Studio's layouts put the speaker in a corner (row 25) [36] | a sentence | words | Submagic [62], Screen Studio [36] |

Rows 33-40 were added after the critic's read, from sources already
gathered; where each one is placed, or why it waits, is in §7.4 and §7.5.

Three rows the brief implies found no source: the timing of a before/after
wipe, of a lower third's hold beyond reading time, and of a progress bar or
step counter (the one argument for a progress bar, that a numbered framework
gives the viewer a "mental progress bar", comes from a page that now returns
HTTP 410; unverified).

### 1.3 Ranked for a 9:16 clip of a person talking

The target is not a launch film. It is a 1080×1920 clip of a person talking
(sometimes a screen recording), watched on a phone, often muted (asserted by
a 2026 trends piece with no statistic [11]), where the face fills a third of
the frame and speech is the timeline. The ranking merges the reveal and the
tutorial angles: how much each pattern changes the look, how often a talking
head gives it a reason to fire, whether 3dit has its input, and the risk of
misplacing it.

| rank | pattern (§1.2 row) | why it ranks here | needs | 3dit today, or in §6 |
|---|---|---|---|---|
| 1 | Word-synced emphasis and type entrances (1, 3) | fires in every clip; with the sound off, type carries the message | words | the captions: 42 looks, nine entrances (`textAnimation.ts:87-170`: fade, rise, pop, typewriter, bounce, wave, zoom-out, slide, drop); none blurs |
| 2 | Punch-in on the word (9) | the talking head's virtual camera; cheap and constant | words, face | the recipes' zoom punch, Zoom keys, the reframe track |
| 3 | Counter, ring, bars landing on the word (5, 6) | the most "SaaS" moment a talking head has; the validator makes it safe | words | §6: `counter`, `ring`, `bars` |
| 4 | Keyword or pop-up card in the free third (7) | fires on clips that say no numbers; text bound verbatim from the said words is the cheapest graphic to ground (inference) | words, face | not in §6 |
| 5 | Steps assembling as said (6) | "three reasons" clips are common | words | §6: `steps` |
| 6 | Draw-on arrow, circle, underline; callout with a leader line (17, 18) | the most designed-looking stroke, and one primitive serves all of them | words, face | §6: `callout` (an arrow or a ring to the face box) |
| 7 | Connector lines and trees (19, 20) | the user's "moving lines" and "tree like arrows" | words | not in §6 |
| 8 | Sound on the graphic's beats (§1.4) | the reference films have it; a graphic that lands silently reads cheaper (inference) | nothing | not in §6; the Director's sound lane exists, its clips under `SOUND_RULE` (`director/apply.ts:45-46`), but a graphic's sound must carry its graphic's own rule (§4.5) |
| 9 | Dim behind the graphic (16) | daylight footage is not a dark ground; light type over a face needs a dim or a panel | face | only `panel` and `panelOpacity` in the style (CLIPS.md:7806) |
| 10 | Lower third (26) | standard and low-risk on interviews | the name | not in §6 (only `quote`'s speaker field) |
| 11 | Content swap (4) | "old price, new price" said in one breath | words | not a template |
| 12 | Screen recording as a 2.5D card (23) | the screen-footage half of the brief | the recording's frames | the moments rail; step 6 |
| 13 | The presenter points (30) | the strongest effect and the riskiest | hand, words | nothing |
| 14 | Click zoom, cursor, ripples, keys (11-15) | top value for tutorials, but no input | cursor | nothing |
| 15 | Edge sweep, glow (21, 22) | the cheapest "premium" cue and the easiest to overuse | nothing | nothing |
| 16 | Text behind the subject (27) | a strong cue that needs a full-clip person matte | a matte | nothing |
| 17 | Emoji pops, gesture reactions (28, 29) | read as cheap or as a video-call gimmick in the sources (§3.3) | words, hand | keyword-fired props and stickers exist (`automation/keywords.ts`) |

**Every pattern ranked 1 to 11 needs only the words, or the words and the
face track, and 3dit has both.** The hand enters at rank 13 and the cursor at
14. Step 3 as planned covers ranks 3, 5 and part of 6; the recommendation in
§7 covers 1 to 12, with the content swap (11) as a motion any template may
use rather than a template of its own. Rank 13 is phase 4; ranks 14 to 17,
and the §1.2 rows the ranking leaves out, are each placed or deferred in
§7.4 and §7.5.

### 1.4 What reads as pro, and why

**A closed system, before any effect.** Every source points at the same
foundation: real material and one set of tokens. Lago takes colours, type,
radii, shadows and SVG paths from its design-system package, and durations,
easings, springs and blur amounts from motion tokens; "inventing UI is
forbidden by construction"; the animatic must be "understandable on mute"
[1]. Figma's brand team started the Config 2024 opener by "sharing our motion
library" with the studio making it [7]. Cutscene locks type and colour in
style frames before animating [4]. A 2026 editing guide gives a series one
small motion kit (title, lower third, callout, transition), the same easing
for every title, and "2-3 easing curves" reused [28]. The consistency is what
reads as designed; no single effect does. For 3dit the "product" is the
speaker and what they say, which the validator already guards.

**Front-loaded, decelerating entrances; shorter exits; little or no
overshoot.** Progress at a fraction of the duration, computed from each
cited definition:

| curve | definition | at 10% | 20% | 30% | 50% | source |
|---|---|---|---|---|---|---|
| expo-out (Bézier) | `cubic-bezier(0.16, 1, 0.3, 1)` | 0.49 | 0.75 | 0.88 | 0.97 | [17] (computed) |
| expo-out (exact) | 1 − 2^(−10x) | 0.50 | 0.75 | 0.875 | 0.969 | [25] (computed) |
| Material 3 emphasized decelerate | `Cubic(0.05, 0.7, 0.1, 1.0)` | 0.62 | 0.78 | 0.87 | 0.95 | [23] (computed) |
| out-cubic, 3dit's caption `easeOut` (`textAnimation.ts:62`) | 1 − (1 − x)³ | 0.27 | 0.49 | 0.66 | 0.875 | (computed) |

The expo family covers three quarters of the distance in the first fifth of
the time and then glides; out-cubic, one of step 3's three eases, is visibly
softer (inference from the table). On overshoot:

| motion | overshoot | source |
|---|---|---|
| easings.net `easeOutBack`, c1 = 1.70158; 3dit's `backOut` uses amount 1.7 (`textAnimation.ts:72`), the same | 10.0% at 58% of the duration (computed) | [25] |
| Remotion's `spring()` defaults: mass 1, damping 10, stiffness 100, `overshootClamping` false | damping ratio 0.5, about 16% (computed) | [29] |
| the codified launch films' springs, damping ratio 0.72 to 0.9, "for a tiny overshoot" | 3.84% to 0.15% (computed) | [20] |
| the same spec for camera and text, damping ratio 1.0 | none | [20] |

Apple's guidance says the same in other words: a bounce of 0 is "the most
versatile", 0.15 "doesn't feel very bouncy yet", 0.3 is noticeably bouncy,
and above about 0.4 "may feel too exaggerated" for a UI element [21]. So step
3's `out-back` suits a deliberate "pop" entrance, not text or numbers.

**Durations by job.** Interface systems keep interaction short; film
entrances sit at their expressive end:

| system | what it gives | source |
|---|---|---|
| IBM Carbon (updated 2026-08-12) | One duration scale: 70, 110, 150, 240, 400, 700 ms. The 70-240 ms tokens are described for micro-interactions, small expansion, a toast; 700 ms is "Background dimming". Productive and expressive are easing styles, not duration sets: productive entrance `(0, 0, 0.38, 0.9)`, exit `(0.2, 0, 1, 0.9)`, standard `(0.2, 0, 0.38, 0.9)`; expressive entrance `(0, 0, 0.3, 1)`, exit `(0.4, 0.14, 1, 1)`, standard `(0.4, 0.14, 0.3, 1)`. "Reserve expressive motion for occasional, important moments". Durations that scale with distance are described as an upcoming feature, so today there are six static tokens | [26] |
| Material 3 | Sixteen durations, 50 ms to 1000 ms (50 ms steps to 600, 100 ms steps above); emphasized decelerate `(0.05, 0.7, 0.1, 1.0)` for entering, emphasized accelerate `(0.3, 0, 0.8, 0.15)` for leaving, standard `(0.2, 0, 0, 1)` | [23][24] |
| Jitter's help centre | Decelerate ("Slow down") for an element entering, accelerate for one leaving, smooth for a move within the frame, linear only for things that never stop, because "linear motion tends to read as artificial" | [27] |
| the launch-film references | entrances 0.3-0.4 s [14][15]; exits 0.12 s [20]; a swap settled in about a quarter second (computed) [20]; a spring counter's 90% at 1.36 s (computed) [16]; ambient loops of 5-6 s, linear because they never arrive [17][18] | as cited |

**Arrival on the word, to the frame.** Tella's rule for talking-head zooms is
that a hard-cut zoom "reads as intentional only when it lands exactly on the
word's onset" [42]. Tella gives no tolerance in frames; that "exactly" means
within a frame is our inference. Apple separates a spring's perceived
duration from its settling duration, which "can be a bit unpredictable", and
says "you shouldn't wait for the settling duration for user-facing changes"
[21]. The codified films issue a spring's target about 0.3 s before the frame
it must arrive on [20]. For step 3, whose counter must arrive on its word
(CLIPS.md:8077-8080), this settles a choice: Magic UI's ticker reaches 90% at
1.36 s and 99% only at 2.70 s (computed) [16], so its arrival is a smear, not
a frame. **A fixed-duration curve that ends exactly on the beat is the
deterministic choice; a spring only in closed form, with its target issued
early.**

**Restraint.** Apple's guidance is to "add motion purposefully, supporting
the experience without overshadowing it" [22]. The studio review reads Cursor
2.0 this way: "The restraint itself signals confidence and craft, which
matters more to this audience than energy" [2]. A design brief of Cursor's
site: "Motion is reserved for the IDE preview itself; the surrounding chrome
stays still" [12]. Cutscene sells "one message, your real product, one call
to action" [4]. The 2026 editing guide says to "Limit heavy effects to hero
moments instead of every cut" [28]. On talking heads, only a vendor blog
says that the 2021 short-form look (huge word-by-word captions, emojis, a
sound on every move) now reads as "Marketing Guru" content, while advising
creators to keep its subtle sound design [60]; treat it as the direction of
taste, not a measurement. The practical consequence is a budget: the
Director pass needs a cap on graphics per clip, not only a list of what it
may place.

**Sound tied to motion.** The films are silent-first [4] but not silent when
finished: every video Figma's brand team made for Config had custom sound
[7]; the Raycast teaser (a freelance spec piece, not an official film) pairs
an audio cue with each shortcut [9]. A 2026 sound guide gives the rules most
useful to automation: the loudest or brightest point of a whoosh "follows the
fastest perceived movement, closest pass, or cut center"; a landing gets an
impact, click or pop "only when the object visibly stops, attaches, or
appears"; speech stays intelligible; the biggest cue goes to the biggest
move; the same envelope should not repeat across edits; and the motion should
be compared against no whoosh at all [35]. It classifies a move by family
(pass-by, reveal, camera, transition) before a sound is chosen [35]. The one
codified mix puts music at 0.5 and effects at 0.62, about −15 LUFS, true peak
below −0.5 dBTP [20]; that is a music-led film, not a talking head.

**Reading time sets the hold.** Netflix allows adult subtitles up to 20
characters a second [33], so a settled label needs at least its length
divided by 20, in seconds. A stricter rule: on-screen text should be readable
at least twice at 200 words a minute [34], about 0.6 s a word (computed).
§6.2's minimum seconds per template (CLIPS.md:7676-7683) can be checked
against both, in English, Hindi and Telugu (a measurement in §4.10).

**Legibility on daylight footage.** The "Linear look" is light on a dark
ground [6]. The user's footage is daylight weddings and talking heads, so
light type over a face needs a panel, a dim or a shadow; Carbon's longest
token is background dimming [26]. This is a style property to decide per
style, not a template's.

### 1.5 The user's words, mapped

| the user said | what it is in the catalogue | needs |
|---|---|---|
| "modern SaaS reveals" | blur-rise and word-staggered type (1, 2), content swap (4), counters (5), items assembling (6), the virtual camera (10), edge sweep and glow (21, 22), 2.5D pull-back (23), and above all one system of tokens (§1.4) | words; the camera move through a product needs a rebuilt UI |
| "tutorials" | click zoom, cursor, ripples, keys (11-15), spotlight (16), draw-on callouts (17, 18), steps (6), lower third (26), camera layouts (25) | the screen moves need the cursor; the rest need words and the face |
| "hand gestures" | in the reveal genre, the cursor as actor (13); in live AR, gesture reactions (29); the presenter pointing (30) | rebuilt UI, or a hand track |
| "pop ups" | type entrances (1), content swap (4), counters (5), cards (7, 8), assembling items (6), emoji pops (28) | words |
| "moving lines" | connector lines and the travelling beam (19), the leader line (18), draw-on strokes (17), marching dashes along a connector (§4.4) | words, the face for a target |
| "tree like arrows" | a tree built step by step (20), connectors (19), arrows drawn on with a head riding the tip (17, §4.4) | words |
| "all sorts of motions" | punch-ins (9), dim (16), transitions (24), grade (32), and sound tied to all of it (§1.4) | words, face |

---

## 2. How it is made today

### 2.1 Four routes

"Pro" graphics reach a short-form video by one of four routes, which differ
in who decides what moves:

1. **A designer's template with typed slots.** An After Effects composition
   published as a Motion Graphics template (.mogrt) [96], or a CapCut
   template with marked placeholders [86]. The designer fixes the motion,
   easing and layout; the user fills text, colours, a dropdown, a media
   slot.
2. **An editor that motion-designs from a recorded event log.** Screen
   Studio "looks at what you did while recording, like where you clicked"
   [36]; Cursorful fires on two clicks within three seconds [43]; Tella's
   "Auto Zoom needs cursor data, which the desktop apps capture for any
   recording and the extension captures for browser tabs" [41]. For Cap and
   FocuSee the sources do not say what drives the zoom.
3. **Bespoke work.** After Effects or Jitter by hand [101][110], or code
   (Motion Canvas, Remotion, Manim; §2.5). The one SaaS motion-graphics
   tutorial read builds its card UI directly in After Effects, with Figma
   optional [110]; no source read supports the claim that launch films start
   from the product's own Figma frames.
4. **An AI editor with a small fixed vocabulary** (§3): punch-in zooms timed
   to the transcript, emoji in captions, stock B-roll, sound effects, layout
   presets.

Routes 1 and 3 get their look from a human's design fixed in advance; route
2 from data captured at record time. 3dit's step 3 is route 1 driven by the
data of route 4: designer-made templates whose fields the Director fills from
the transcript. Its quality ceiling is therefore the quality of the
templates (inference).

### 2.2 The template model, and why it is §6's model

Leirpoll's 2024 guide on Frame.io lists what a .mogrt exposes through the
Essential Graphics panel [96]: source text (with font, style and size once
"Edit Properties" is ticked); colour, checkbox, slider and dropdown; a point
control, which the guide advises against; media replacement; groups; and
CSV or TSV data files that drive text, values and colours. Checkboxes and
dropdowns work through `if/else` expressions, so one dropdown can recolour
several layers [96]. Two features matter here:

- **Responsive Design – Time** marks protected regions, usually the in and
  out animations: "the protected regions will have the same speed, while the
  rest of the animation will be time-stretched" [96].
- **Responsive position** is written as expressions such as
  `thisComp.width/2`, so one template serves several frame sizes [96].

Its limits are stated as plainly: a MOGRT "cannot interact with other layers
in the Premiere Pro timeline", the whole MOGRT takes one blend mode, audio
drifts when the duration changes, and in Premiere a broken expression
reverts to its earlier value "with no warning" [96]. An Adobe engineer wrote
in 2023 that "One control can only be one value once we're in Premiere Pro",
so a template's keyframes cannot be animated there [97].

That is the shape of CLIPS §6's `GraphicSpec`: typed fields, motion fixed by
the template, an in and an out that keep their timing, and a hold that
stretches (the `tpad` hold and the 0.3 s opacity exit, CLIPS.md:7731-7740).
The recommendation in §7 keeps that model and names the protected regions in
the template contract: entrance and exit at fixed speed, only the hold
stretches.

### 2.3 Marketplaces and asset licences

The terms that decide what 3dit may ship (prices are in Appendix A):
an Envato Elements download is "an ongoing license for a single, specific
project", and items may not be re-distributed "without adding value" [98];
CapCut's materials may be edited "only on the Platform" and may not be
extracted from your content (Materials License, 2026-01-22) [87];
LottieFiles' free animations may be used commercially and in products, but
not redistributed as standalone files, resold, or compiled "to create a
competing service" (2026-01-16) [106]. Motion Design School sells courses
and After Effects scripts, not template packs [100].

Our reading: shipping marketplace templates, CapCut materials or a curated
set of LottieFiles animations inside an editor as built-in graphics is the
redistribution these terms forbid (the full Envato and Motion Array licence
pages returned 403 and were not read). **The templates show the patterns,
not a library 3dit can ship: every template a fully automatic 3dit uses has
to be drawn by us, or carry a licence that allows shipping it.**

### 2.4 Authoring tools

- **Jitter** imports Figma frames, animates them with move, fade, scale,
  mask and blur presets and easing presets ("Slow down, Accelerate, Elastic,
  Bounce, Overshoot, and more") with an intensity control, ships more than
  300 free templates, and exports MP4, MOV, WebM, GIF, Lottie and
  transparent ProRes 4444 or WebM, frame by frame, up to 4K and 120 fps
  [101]. Prices are in Appendix A.
- **Rive** exports a `.riv` file with state machines. Since 2025-10-20
  "exports now move to paid plans", the editor stays free, there is "No
  runtime fee", and the runtimes stay MIT [103]; exporting for a runtime
  needs a paid seat (prices in Appendix A) [103][104]. The web
  runtime advances an artboard by an elapsed time we choose; a linear
  animation has a settable `time`, a state machine does not, so a state
  machine must be replayed from 0 in fixed steps to draw frame n [105].
- **Lottie** is After Effects' export path. Lottie's own supported-features
  table, for the web renderers: Fill, Stroke, Tint and Tritone supported on
  SVG, Canvas and HTML; Levels on Canvas and HTML only; Drop Shadow and
  Gaussian Blur marked unknown; Text and Expressions supported [107].
  `lottie-web` seeks with `goToAndStop(n, true)` and its canvas renderer
  takes only a 2D context [139]. `dotlottie-web` runs ThorVG in Rust/WASM
  with Canvas2D, WebGL2 and experimental WebGPU backends and a worker
  variant [140]; its README names no exact-frame setter, but its source
  declares `setFrame(frame)`, "Seeks to a specific frame in the animation and
  renders it" [140]. Whether text inside a Lottie or Rive file shapes Hindi
  or Telugu was not established by any source.
- **Spline**: video export, code export and "Export GLTF with color &
  texture" start at its Pro plan (prices in Appendix A) [108]. Its code-export docs list
  a three.js export through `@splinetool/loader` and say "Animations and
  events are only enabled when exporting to Vanilla js and React" [109], so
  a Spline scene brought into three.js arrives without its motion, which
  would be re-authored on our side.

### 2.5 Code-driven motion

| name | licence | latest release | maintenance | what it is | for 3dit | source |
|---|---|---|---|---|---|---|
| Motion Canvas | MIT | 3.17.2, 2024-12-14 (3.18.0-alpha.0, 2025-02-16) | no code commit since 2025-02-16; one docs-domain commit on 2026-07-02 | TypeScript generators and an editor; renders from the editor's RENDER button; no headless path documented | its `Curve` vocabulary only (§4.4) | [141][142][143] |
| Remotion | source-available Remotion License | 4.0.536, 2026-10-16 | very active | React compositions rendered to video | out (licence; a second renderer) | [120][144][145] |
| Theatre.js | `@theatre/core` Apache-2.0; `@theatre/studio` AGPL-3.0-only | 0.7.2, 2024-05-19 | README: development "temporarily moved" to a private repo; last push 2024-08-14 | keyframe sequencer and studio for three.js scenes | out | [120][147] |
| Revideo | MIT | `@revideo/core` 0.11.0, 2026-07-10 | repo pushed 2026-07-15 | a Motion Canvas fork that renders through a headless browser | out: 3dit is already the browser | [146] |
| Manim (Community) | MIT | 0.22.0, 2026-10-08 | active | Python mathematical animation | reference only | [148] |

Remotion's licence is free for individuals, for-profit organisations of up
to three employees, non-profits and evaluation; others need a company
licence, and "In Remotion 5.0, the license will slightly change" [144]. Its
FAQ puts "organizations building video editors, prompt-to-video tools,
automated video pipelines" on the Automators plan, which "costs $0.01 per
render, with a minimum spend of $100/month"; previews in the Studio or
Player do not count as renders; letting users submit any Remotion project for
rendering is not acceptable [145]. One accepted use case is "Allowing users
to create and render their own personalized video based on your Remotion
template" [145], which is `drawGraphicOnto(spec, t)` under another name. In
all of these, someone writes each scene; automation is a parametrised
composition.

### 2.6 Screen recorders with built-in motion

Eleven recorders were read: Screen Studio, Cursorful, Tella, FocuSee, Cap,
Loom, OpenScreen, Recordly, Reframed, Kap and Camtasia. Appendix A gives
each one's automatic features, platform, price and licence. Every tool with
auto zoom runs it, and its cursor polish, on input captured at record time:
Screen Studio on "what you did while recording" [36], Cursorful on two or
more clicks within 3 s [43], Tella on cursor data [41], Cap on zoom segments
"auto-generated from clicks" [44]; Loom has "no automatic zooms" [41]. For
footage it did not record, Camtasia asks the user to draw the cursor path
[49]. 3dit would need its own recorder (a separate project) or a cursor
finder over pixels (unresearched and unmeasured) to join this family. Of
their code, OpenScreen and Reframed are MIT [46][48]; Cap and Recordly are
AGPL (Cap's capture crates MIT) and are not for copying [45][47].

### 2.7 Pointing hands: how they are done

| route | how | automatic | source |
|---|---|---|---|
| Stock hand packs | FX_Monster's "Hand Gestures Pack for Premiere Pro": nine flat gestures (thumbs up, okay, thumbs down, middle finger, peace, rock and roll, pointing, call me, crossed fingers), 3 s each, resizable, no plugin, 7.94 MB. ProductionCrate's 50-gesture After Effects extension is marked "no longer supported" (posted 2019-01-09). Free green-screen finger clips "for personal and commercial use" | no: an editor places and times the hand by eye | [111][112][113] |
| Emoji as the hand | Animated Noto Emoji, CC BY 4.0, as SVG, Lottie JSON, WebP and GIF; its animated index holds the pointing hands U+1F446 to U+1F449, U+261D and U+1FAF5, with skin tones. Microsoft Fluent Emoji, MIT: 1,538 emoji in SVG, PNG and JPG, with Clippy, flags and some trademarked glyphs withheld | on a keyword, in caption tools [62] | [114][115] |
| A tracked hand, by an editor | Mocha AE: draw around the planar area, track, export a transform or a corner pin; one shot at a time. CapCut's desktop camera tracking can follow "face, hand, and body movements", or a custom area, once the user sets it up | no | [84][116] |
| A tracked hand, live | Lens Studio 5's Hand Joints: 25 2D screen points per hand; objects parented to a joint or pinned. Effect House's Hand Tracker: the anchor switched from Hand Center to Index Finger Tip, with a Z-rotation option; "The object will only follow one hand"; its Hand Info node gives a rectangle, a centre, a rotation, 2D keypoints and a left-hand probability | yes, live AR | [117][194][195][196] |
| A gesture fires an effect | Apple Reactions: eight hand shapes, among them both-hands heart (Hearts), thumbs up, V (Balloons), both V (Confetti), both thumbs down (Rain), both index and little fingers (Laser), both thumbs up (Fireworks); hold "until you see the effect". Zoom: raised hand and thumbs up, held about four seconds. Effect House: 31 named gestures including "Index Pointing", with Begin, Stay, End and None events. The BytePlus (ByteDance) Effects SDK, which its page says TikTok users use: 22 hand keypoints, static gestures and swipes | yes, live, a fixed effect | [189][190][192][193][197] |
| The presenter in front of the graphic | CapCut duplicates the clip, puts the text between the copies and runs "Auto removal" on the top one; manual mask tracing for low-light footage | partly | [85] |
| A 3D hand | no CC0 rigged pointing hand found; a free three-finger cartoon rig needs CC-BY credit and ships unanimated; a Superhive pack with a pointing pose is $28.99, "royalty free", its licence page not read | no | [118][119] |
| A pointing hand anchors a visual | RealityTalk (UIST 2022): MediaPipe Hands; an index finger up with the others curled sets where an element appears; spoken nouns trigger it; its techniques came from 177 video-edited augmented presentations; live, not an editor of recorded footage | yes, research | [188] |

**In edited short-form footage, the pointing hand is a sticker or a stock
clip placed by eye. The automatic form exists live, in AR tools, and in one
research system; no editor of recorded footage was found that places a
graphic where the speaker points.** That is an opening, and a warning that
no tuned precedent exists for the thresholds. How edited reels and tutorials
tie pop-ups to a speaker's hand (a card emerging from a palm, text flicked by
a hand, counting on fingers into a list) was not covered by this research.

---

## 3. What the AI editors auto-generate, and the gap above them

### 3.1 The catalogue

Prices and plans are in Appendix A.

| tool | what it adds automatically | what the user supplies | source |
|---|---|---|---|
| Opus Clip | clips from a long video (ClipAnything, "our newest model"); animated captions, "Auto emoji and keyword highlights" and auto hook on every plan; a title generator from Starter; AI image B-roll and stock B-roll from Starter; AI video B-roll from Pro | an upload or a link; one click, or a sentence chosen for a generated B-roll | [66][67] |
| Agent Opus | kinetic typography, shape and icon animations, animated infographics, zooms, pans, voice-over timing synced; "Use bold text overlays for key stats" is one of its example prompts | "your promo brief, script, outline, or blog URL"; raw footage is not mentioned | [68] |
| Submagic | captions with animated emojis and GIFs; auto zooms in "6 unique zoom styles" (unnamed), "progressive or fast", synced "to your spoken audio"; Magic B-rolls adds zooms, B-roll and transitions in one press; sound effects; music | an upload | [62][63] |
| Captions (NOCAP, Inc. d/b/a Captions) | AI Edit applies a style (its style guide lists seven themes of four styles each [71]; its feature page names about twenty-one [72]) adding B-roll, transitions, music, zooms, sound design and decorative graphics: a chart arrow and a cash stack in the Impact II thumbnail, a hand-drawn circle in Sketch, collage cut-outs in Zine; eye-contact correction; clips from long video | a style. At launch, "a vertical video of a person talking, with only one person in the frame" (2024-06-26) | [71][72][75] |
| Descript (Underlord) | by prompt, not by default. Example prompts: "Add zooms to moments of emphasis", "Add zoom cuts every 3 to 6 seconds", "Apply animated callouts to important words in the scene". B-roll from the script, generated B-roll; templates for social clips and ads that ask about "assets, goals, and style preferences" (2025-08-21) | a typed request; credits per prompt | [76][77][78][79] |
| Vizard | its comparison table lists AI B-rolls, AI emojis, AI highlight keywords, auto reframe, brand templates | an upload | [80] |
| CapCut | Auto Cut to speech pauses, a script or the music's beats ("every beat or only strong beats" on desktop), with transitions at the cuts; effects are added by hand; not on CapCut Web. Text and stickers can follow an object once the user boxes it | a song, a template or a script | [81][83] |
| Klap | about 5 clips a minute of source; reframe layouts; captions; a virality score; no emoji, B-roll or zoom mentioned | an upload | [89] |
| Gling | bad takes, silences and fillers removed; "auto zoom (auto framing)"; captions; titles and chapters; export to Final Cut, Resolve, Premiere | an upload | [90] |
| invideo (agent) | adds sound to an existing motion graphic or UI animation "to match movements, transitions, and reveals"; does not make the graphic | the animation | [93] |
| Hera (YC Summer 2025) | motion graphics from a plain-English prompt, editable on a canvas, with a brand kit; footage not mentioned | a prompt | [95] |
| VEED | subtitle styles that "depend on your plan"; a "Magic Cut" feature was claimed in a draft but no page read confirms it (unverified) | an upload | [91] |

Pictory makes video from a script or a blog over stock; its 2026 review's
own verdict is that "the results are hit-or-miss", and it quotes Wyzowl's
review for "very generic and stock clippy" and for a greeting once paired
with a Christmas animation [94].

The core set (word-by-word captions with a highlighted keyword, emoji pops,
emphasis punch-ins, stock or generated B-roll, a hook title) is carried by
the clippers: Opus Clip, Submagic, Vizard and, by style, Captions. It is not
universal: Klap mentions no emoji, B-roll or zoom [89]; Gling has zoom,
captions and titles but no B-roll or emoji [90]; CapCut's Auto Cut adds cuts
and transitions only [81]; Descript adds these only when asked [76].

### 3.2 What none of them claims

- **A graphic derived from what was said, and checked.** Agent Opus starts
  from a brief or a script [68]. TechCrunch's launch report says Captions'
  AI Edit adds "custom graphics, zooms, music, sound effects, transitions and
  motion backgrounds based on the content" without saying whether that means
  the speech or the picture [75], and its style guide's chart arrow (seen in
  a thumbnail) reads as decoration (our reading) [71]. Descript's callouts emphasise words, by prompt [76]. A
  counter arriving on the word that says "40%", with a validator that drops a
  figure nobody said, appears in no competitor material read. That is CLIPS
  §6.2 and §6.7 as planned.
- **A graphic anchored to something in the frame.** CapCut pins text to an
  object the user boxes [83]; Screen Studio's zoom follows clicks it
  recorded itself [36]. Apple's reactions are fired by hand shapes in
  shipping software, but they play a fixed effect around the person rather
  than anchoring a label to a fingertip [189][190]. Step 3's `callout` (a
  line to the face box) is the first rung; a fingertip is the second (§5).
- **A connector or a tree built from an enumeration in speech.** Captions'
  Sketch style draws a hand-drawn circle [71]; nothing found draws a flow or
  a tree between items the speaker listed.
- **A shared motion system.** No vendor page publishes its curves, durations
  or type scale. Captions' Minimal theme is the only one that speaks of
  restraint: "every element earns its place" [71].

The tools not checked, and so not claimed either way, are listed in §6.4.

### 3.3 Hindi, Telugu and the Indian market

- Opus Clip's help centre says "OpusClip does not support Hindi at this
  time"; the page is undated and may be stale, and the home page's language
  list omits Hindi [69].
- Submagic added Telugu, Tamil, Kannada, Malayalam, Gujarati and Panjabi on
  its "lightweight 'nano' model" (updated 2026-09-30); Hindi is not in that
  article's list, and whether it was supported before was not checked [64].
- Klap lists Hindi among its languages [89].
- No source says how any of them shapes Devanagari or Telugu conjuncts in an
  animated caption, and none was tried. Whether Captions, Vizard, CapCut or
  Descript handle Hindi or Telugu was not checked.
- CapCut was banned in India in 2020 along with TikTok, and Wikipedia records
  no later unbanning [88] (a fact-checker's note; the article was not re-read
  for this document). As a reference competitor it may not reach the user's
  own audience.

Correctly shaped Hindi and Telugu is therefore a condition on every
graphic, not a feature, and a visible advantage in this market (inference).
That 3dit's canvas painter delivers it is itself an inference until M22
measures it (§4.2).

### 3.4 Quality, by review

Third-party evidence on the quality of these graphics is nearly absent. The
most concrete Opus Clip review ran one 15-minute speech (Steve Jobs's 2005
Stanford address) into 21 clips, recorded virality scores from 98 down to 82,
judged the hook titles usable, and did not test B-roll or reframing [70].
The Submagic review restates vendor claims with no method [65]. The CapCut
reviewer did not buy Pro, so the Pro text templates were not judged [82].
Reviews measure clip selection and caption accuracy; none measures whether
an auto-added graphic was right, well timed or looked designed. **3dit's
eval has to supply its own bar**, as CLIPS §6.10's blind template-fit rating
already starts to.

### 3.5 Where the gap lies

Between a clipper's output and a motion designer's reveal, the difference is
not mainly which elements appear: zooms, text, callouts and sound are in
both. It is in properties that design systems write down and clippers do not
publish (§1.4): easing assigned by job, durations by job, one system shared
by every effect, restraint, sound placed on the motion (invideo sells adding
sound "to match movements, transitions, and reveals" [93], but none
publishes how it times it), and a type scale. What 3dit can claim that no
competitor found does: graphics grounded in the speech, callouts anchored to
the face (and later the hand), connector trees from enumerations, one motion
system, and correctly shaped Hindi and Telugu (once M22 shows the canvas
painter shapes them). What step 3 should leave out:
stock or generated B-roll (reviewed as generic [94]; step 5 plans B-roll on
its own terms), emoji pops and meme stickers (the look vendor sources now
call cheap [60]), and hook-title boilerplate (every clipper has it [66][63]).

---

## 4. The integration architecture for 3dit

### 4.1 The rail as it exists

Read from the repo at `7964d8a`. Every path is under `src/` unless it says
otherwise.

| piece | where | what it does | measured |
|---|---|---|---|
| one renderer, three loaded lazily | `renderer/src/threeShared.ts:14-23` (`import('three')` on first draw, so "129 KB gzipped" stays out of the main bundle); `:28-31` (a browser keeps "around sixteen" live contexts: a comment, not a measurement); `:42-43` (`WebGLRenderer({ alpha: true, antialias: true })`, clear colour at alpha 0) | every three.js drawer shares one context and re-sizes it before each render | — |
| a second context | `renderer/src/grade.ts:195` (raw `webgl2`, `premultipliedAlpha: false`) | the preview grade | — |
| moments, pure half | `shared/render/moment.ts` (`movingFrames`, `momentT`, `seeded()` at `:101`, `momentParams` at `:176-228`, `DRAWN_MOMENTS` at `:22`) | the timing, with no three.js import | — |
| moments, drawer | `renderer/src/momentCanvas.ts`: `OrthographicCamera(-1, 1, 1, -1, 0, 1)` at `:363-365`; full-frame quads with GLSL (zoom punch, whip, light burn, depth push) at `:187-317`; raw textures (`NoColorSpace`, `flipY` false, `premultiplyAlpha` false, no mipmaps) at `:321-335`; pictures decoded by `createImageBitmap` with orientation, colour conversion and premultiplication all `'none'`, in a 512 MB LRU, at `:41-95`; a premultiplied "over" blend only for a depth push with two or more planes (`:414`), `NoBlending` otherwise (`:386`, `:456`) | composes each shot's picture onto a 2D canvas per frame, uploads it, shades it | first and last frames equal the pictures beneath at 0.000/255 mean, at 270×480 (EFFECTS.md:2574-2583) |
| preview | `momentPreviewCanvas`, `momentCanvas.ts:509-553`: builds async, draws sync, copies the WebGL canvas into a 2D canvas (`:550`), stamps `dataset.forgeRev` | the same `draw(frame)` as the bake | — |
| bake | `bakeMomentSequence`, `momentCanvas.ts:571-614`: the moving frames only, `toBlob('image/png')` one frame at a time (`:599-608`), under the bake guard, written by `writeTitleFrame` into `cacheDir()/<clipId>.seq/%05d.png` (`main/titles.ts:143-159`) | numbered PNGs with alpha | draw 130-690 fps at 1080×1920; PNG encode 20-60 ms a frame (60 ms for the light burn, whose grain does not compress); real photo frames were 0.45-2.25 MB, their encode time not recorded; not measured on the Surface (EFFECTS.md:2585-2602) |
| export | `shared/render/exportBake.ts:35-170` (`Bakers.moment`, a redraw at the export's stills size under `<clip>-export`, a moment that cannot draw dropped); `renderer/src/exportBakers.ts:13-26` | — | — |
| into ffmpeg | `shared/render/plan.ts:1096` (`-start_number 0 -framerate <fps> -i <pattern>`); `:906` (`holdFilter`: `tpad=stop_mode=clone`, `trim`, `setpts`, measured to keep alpha); `:1484` (`format=yuva420p`; rgba measured 59.1 s against 29.5 s on 8 clips); `:1921-1922` (`overlay=…:format=yuv420:eof_action=pass:repeatlast=0:enable=…`) | nothing new reached ffmpeg for moments | in CI on both builds |
| text | `shared/render/textPaint.ts:44` (`drawTextOnto`, pure, paints text clips, tiles, bakes and captions); 42 `TEXT_STYLES` (`textStyle.ts:164`); nine `TEXT_ANIMATIONS` (`textAnimation.ts:87-170`); the font shorthand ends at `sans-serif` (`textPaint.ts:285-290`), so Indic glyphs come from the OS | canvas text is shaped by Chromium (inference, M22); libass needs `ass=…:shaping=complex` (`plan.ts:1944`; EFFECTS §51) | libass only: with `shaping=complex`, Hindi and Telugu clusters drawn joined, the i-matra first, on the Mac through CoreText's fallback (EFFECTS.md:4718-4730; `captions.int`). **The canvas painter's Indic shaping has never been measured in this repo** (no `docs/*.md` records it); no Indic font is bundled |
| caption bake | `renderer/src/captionBake.ts:119-129` (an encode pool, `DEPTH = 4`); `shared/captions/bake.ts:178` (`captionBand`); `plan.ts:1959-1983` (one overlay at the band's y) | paints only the rows the ink touches | 60 pictures: 1000 ms serial, 502 ms two at a time, 264 ms four, 250 ms eight; draw ~0.2 ms, encode ~16 ms each; a full-frame overlay 3.4 s against 0.86 s for the band, on 10 s at 1080×1920 |
| placement | `shared/reframe/frameMap.ts:86` (`sourceToFrame`: through `cropAt`, `clipBox`, `fitFor` and a two-up's halves, null when off screen; rotation, animated transforms and camera moves not modelled, `:31-35`); `:275-291` (`subjectBoxesAt`: through `nearestSample`, `:233-244`, the nearest of the two samples a second within 500 ms, same shot, never interpolated, so the box steps every 0.5 s; extended down by half for the chin); `freeSpace.ts:199` (`captionThirds`), `:227` (`thirdAt`); `captions/smart.ts:48` | a source box onto the output frame, per frame | thirds only, in v1 |
| subject track | `shared/reframe/types.ts:14-89` (`SubjectTrack`: up to two faces a sample, 0..1 to 4 dp, source ms); `shared/reframe/job.ts:200` (`REDUCE`: two samples a second kept, picked, not averaged); the AI helper samples five a second (`sidecar/forge_sidecar/capabilities/faces.py:92`) | the face boxes | — |
| the old graphics spec | `shared/graphics/spec.ts` (`GraphicsSpec`: text, image and caption layers, `Transform2D` keyframes, five easings `linear … backOut`, `popIn` at `:193`); `fromTimeline.ts:29-41` (`needsFrameServer()` returns false) | only the caption layer is live | — |
| static SVG titles | `main/titles.ts:73-101`: `sharp` (`package.json:29`) fills a catalogue SVG and rasterises it in main | librsvg resolves one face and ignores the family (EFFECTS.md:154-165) | — |
| motion the app already has | six grid reveal orders (`render/grid.ts:577`); eight transitions (`transitions/registry.ts:296-352`); clip keyframes and Ken Burns; reveal masks (`render/mask.ts`); keyword-fired props and stickers with cooldowns (`automation/keywords.ts`); `kinetic-type`, a stub drawn as a depth push, not in `DRAWN_MOMENTS` and refused by the Director (`moment.ts:22`, `director/apply2.ts:393-395`) | — | ffmpeg's `perspective` measured animating per frame in the bundled build, five frames, five hashes; not built (SHEETS.md:452-458) |

Three facts shape everything below. **Three is the only drawing or animation
library in the renderer** (`sharp` is a static rasteriser in main).
**Drawing runs on the renderer's main thread; the PNG encode does not.** No
`OffscreenCanvas` or `Worker` is used anywhere in `src/` (searched), but
`toBlob`'s encode "happens off the main thread", per `captionBake.ts:122-124`,
which is why its pool of four measured 1000 ms down to 264 ms for 60
pictures (the caption-bake row above). **The bake's cost is the PNG encode,
not the drawing** (EFFECTS §34).

### 4.2 Where three.js earns its place, by the evidence

**For drawing graphics through three.js:** one rail for step 3, 2.5D and
step 6's 3D templates; shaders make glow, blur and grain cheap and exact at
both ends, as the moments proved (0.000/255); the renderer is already loaded
and shared. And one objection from the first draft of this research has gone:
`UnrealBloomPass` no longer forces alpha to 1 on output. Two commits on
2025-12-09 ("Fix alpha handling", "Use premultiplied alpha and additive
blending") made it composite `vec4(bloom, bloomAlpha)` additively onto the
input, so pixels without bloom keep their alpha [130]. It is a candidate to
measure, not ruled out.

**Against drawing flat graphics through three.js:**

- **Text has to be canvas 2D anyway, if M22 holds.** troika-three-text, the usual three.js
  text library, has an open issue, "Indic scripts have complex shaping rules
  which are not yet implemented", since 2024-01-30 [131]; drei's `<Text>`
  imports troika [133]; troika lays text out in a worker, "by definition
  asynchronous", and its `sync()` callback "will not execute if the text is
  already fully synced" [132], which breaks a pure frame function unless
  every text is settled before frame 0. three 0.186.0's `TTFLoader` imports
  opentype.js from `cdn.jsdelivr.net` at runtime (CLIPS.md:9160-9163).
  That canvas text is shaped rests on one weak source: Blink's HarfBuzz
  shaper, a 2015 change that benchmarked Hindi line layout [157]. **That
  `drawTextOnto` draws Hindi and Telugu correctly is an inference, never
  measured in this repo.** EFFECTS §51 (EFFECTS.md:4718-4730) measured
  libass, the burnt-caption route, with `shaping=complex` against
  `shaping=simple`, not the canvas painter, and this research's survey of
  the repo only inferred the canvas case. M22 (§4.10) measures it on both machines, and
  every claim below that the canvas route is the Indic-safe one waits on it.
- **Lines are native in canvas 2D.** `setLineDash` with a float
  `lineDashOffset` is the classic draw-on, with a marching-ants example on its
  page [153]; `Path2D` takes SVG path data [152]. In three.js,
  `LineMaterial.linewidth` is in CSS pixels unless `worldUnits` is true [123],
  and the r186 shader scales it by `resolution.y` [124], so a 270×480 preview
  and a 1080×1920 export draw different relative widths; a draw-on through
  `Line2` needs a dash trick (`dashSize = p·L`, `gapSize ≥ L`, supported by
  the r186 shader beside a `// todo - FIX` comment) or a limit on the
  instance count (`instanceCount` [125]), which steps by whole segments; and
  **a dashed `Line2` discards its end caps** in r186 [124].
- **WebGL adds conversions a flat overlay never has.** The renderer defaults
  to `premultipliedAlpha: true` and `preserveDrawingBuffer: false` [126];
  since r152 hex colours are converted from sRGB to linear and colour
  textures must be tagged by hand [127]. The moments sidestep this with raw
  textures and identity shaders at the ends; a template mixing brand colours
  and painted textures could drift from the 2D preview (M6).
- **Pixels differ per machine.** Canvas and WebGL output is reported to differ
  by GPU, driver and OS enough to fingerprint browsers [162] (the paper's text
  could not be extracted; unverified wording). Preview equals export on one
  machine; golden images need a per-platform tolerance (M13).
- **No speed is bought.** The encode dominates (§4.1).

**Reading of the evidence: paint every layer with canvas 2D; use three.js
as the compositor for the graphics that ask for depth, a camera move or a
glow, taking the painted layers as textures.** That is the moments engine's
own pattern: compose on a 2D canvas, upload, shade.

### 4.3 The proposal: one engine, one draw list, two painters

All names below are proposals. The draw list is named so that it cannot be
confused with `CaptionLayersSpec` (the anchor-trap rule in `CLAUDE.md`).

- **A pure function returns plain data.** `drawListAt(spec, style, frame,
  fps, size, measure)` in `src/shared/graphics/`, node-tested with `measure`
  injected (it replaces §6.3's `layout` and `graphicParams`; §7.2), returns a
  `DrawList`:
  - `stroke`: a path in frame units (SVG path data), the visible span as
    fractions of its length (`from`, `to`), width in frame units, cap and
    join, an optional dash pattern and offset, arrowheads at either visible
    end;
  - `text`: a string, a text style id (one of the 42), a box, the unit it
    animates by (line or word), and its entrance state;
  - `shape`: a rectangle, rounded rectangle, circle, or ring arc with a sweep
    fraction; fill and stroke;
  - `image`: a picture and its box;
  - `dim`: a darkened region with an optional hole;
  - `group`: children under one transform.

  Every item carries opacity, a 2D transform and an optional `z`. The list
  may carry a `camera` (tilt, yaw, dolly) and glow requests.
- **Animation is computed, not stored.** Each property is a function of the
  frame's time relative to its beat (`ease(t − beat, duration)`,
  `spring(t − beat)`), so a beat the user moves moves the animation with no
  re-authoring, and the model never sees motion: it fills `GraphicData`
  only, as §6 says.
- **Painter A, canvas 2D**, `paintDrawList2d(ctx, list)`: every template's
  default. Every word goes through `drawTextOnto`, so the 42 looks apply,
  and so does Chromium's shaping (M22).
- **Painter B, three.js**, `paintDrawList3d(list)` on the shared renderer:
  the items of each `z` are painted by painter A onto a plane-sized canvas,
  uploaded as a texture the way `momentCanvas.ts` uploads (raw colour,
  `flipY` false, mipmaps off), and drawn as planes: under an orthographic
  camera sized to the frame when flat (one texel to one pixel), under a
  perspective camera for a tilt, dolly or parallax; glow as a quad shader
  writing premultiplied colour, as the light burn does, or `UnrealBloomPass`
  after M7. Disposed on rebuild, supersede, bake end and clip removal, as
  `momentCanvas.ts` does and the carousel does not (CLIPS.md:9153-9159).
- **The list decides the painter.** No `z`, no camera and no glow means
  painter A alone. `TemplateDef.threeD` (CLIPS.md:7665) stays as the seam,
  read as "this template may ask for depth".
- **Everything else is §6.3 as written**: the same function for preview,
  bake and export; moving frames only; `tpad` holds the last; the exit is
  opacity keys over the last 0.3 s; `Bakers.graphic`, dropped from the export
  on failure; app-minted clip ids.

### 4.4 How each pattern is rendered

| pattern | painter | how | notes |
|---|---|---|---|
| Draw-on stroke: arrow, circle, underline, connector, tree edge | A | a `Path2D` from SVG path data [152]; `setLineDash([L, L])` with `lineDashOffset` running from L to 0 [153]. Canvas has no length query [152], so L and the tip come from an off-DOM `SVGPathElement`'s `getTotalLength()` and `getPointAtLength()`, or our own flattening (M8) | widths in frame units, never preview pixels; round caps; at least 2 px at 1080 wide to survive 4:2:0 chroma (proposal, M19) |
| Arrowhead riding the tip | A | placed at the visible tip, turned by the sampled tangent, scaling in over its first 0.1 s (proposal); Motion Canvas's `Curve` draws `endArrow` "at the end of the visible curve" [142], the vocabulary to copy | the head travels with the line instead of waiting at the path's end |
| Marching dashes, travelling beam | A | `lineDashOffset` advancing linearly [153]; a short gradient span moving along the path, as Magic UI's beam does [17]: the stroke item's `from` and `to` both advancing, so the primitive needs nothing new | every held frame moves, so it bakes the whole hold (§4.8): once per clip at most (proposal) |
| Tree, one branch per spoken item | A | a fixed one-root layout written here, or `d3-hierarchy`'s tidy tree; edges as `d3.link(curveBumpX)`, which issues path calls straight onto a canvas context [150], or our own cubic; children appear level by level on their beats | more than about six nodes will not read at 9:16 (inference; measure) |
| Pop-up card, keyword card, lower third | A | a rounded panel and text; entrance scale from 0.92 with a rise and fade on expo-out, or a critically damped spring; `out-back` for the `pop` entrance only | 0.92 is a proposal |
| Counter, ring, bars | A | the value interpolated on a fixed-duration curve that ends on the beat; in-between numbers in the value's own format (CLIPS.md:7689-7695) | Magic UI formats `en-US` [16]: what §6.2's rule rightly refuses |
| Content swap | A | the old exits in 0.12 s, the new enters on a critically damped spring [20] | — |
| Dim and spotlight | A | a `dim` item: a dark full-frame rectangle with an even-odd hole around the subject box from `subjectBoxesAt`, fading over 0.3-0.7 s (Carbon's background dim is 700 ms [26]) | **`subjectBoxesAt` does not interpolate**: it takes the nearest of the project track's two samples a second (`frameMap.ts:233-244`, `:275-291`; `REDUCE`, `shared/reframe/job.ts:200`), so a hole that "follows the face" would jump every 0.5 s, and would also make every frame a moving frame. So: the hole fixed at onset (proposal, and the cheaper one). A hole that moves needs a pure interpolating box function for graphics only, measured against the AI helper's 5-a-second raw track, not the reduced one |
| Kinetic type | A | per word (rise, blur-rise with `ctx.filter = 'blur(…)'`, cost M5, pop); per grapheme cluster only for scripts M3 clears; never per code point | §4.6 |
| Punch-in on the word | the clip beneath | the recipes' zoom punch and Zoom keys, the reframe keeping the face in the crop | a rule: no graphic over a punch; onset error M15 |
| 2.5D tilt, parallax, dolly, focus | B | painter A's planes under a perspective camera; parallax by `z`; focus by blurring a far plane's texture in its own shader, so no composer is needed | text resampled under a tilt softens: a look to judge |
| Screen recording as a 2.5D card | B for the move | the card tilts in or pulls back over its moving frames only, the recording's frames supplied by the moments' footage pre-pass (`momentCanvas.ts:109-137`); then it lands flat, and the hold is the ordinary clip transform over a baked bezel and shadow, so a 10 s recording is not baked frame by frame (proposal) | alternative: ffmpeg's `perspective` in the single-pass graph (SHEETS.md:452-458), unprobed on Windows and with no preview twin |
| Glow, edge sweep | B (or A for the sweep) | a quad shader writing premultiplied colour, or `UnrealBloomPass` (M7) | pmndrs `postprocessing` only after an alpha check; its peer range stops below three 0.187 [120] |
| Motion blur on fast moves | A or B | four subframes averaged per output frame before the encode (four times the draw), or ffmpeg's `tmix` (§6.3) | later, only if the blind ratings ask for it |
| Text behind the subject | — | needs a full-clip person matte from the AI helper; none exists | later |
| Lottie accents (a tick, a sparkle) | A | `lottie-web`'s `goToAndStop(n, true)` [139] or `dotlottie-web`'s `setFrame(n)` [140] onto a canvas; text-free only | later, behind the asset-licence decision (§6.4) |

### 4.5 Typed fields, the Director and the validator

§6.6 and §6.7 stay as written: `graphics@1` with its flat schema, the binding
validator in `claims.ts`, the field modes, the negators, the spacing, the
proposals that wait for Keep, the baseline and the eval. The broadened
vocabulary's string fields use the modes §6.1 already defines
(`'verbatim' | 'grounded' | 'fixed' | 'speaker' | 'user'`, CLIPS.md:7656).
**Its index fields do not**: `keyword.lit`, `steps.parent` and
`callout.anchor` are numbers that point at other things, and none of §6.1's
modes covers them. How each is typed and checked:

| template | fields (mode) | beats | validator | why |
|---|---|---|---|---|
| `keyword` (new) | `words`: `verbatim`, one to four words, a contiguous run of the said words; `lit`: an index into them, in a new mode `index` | one, on the first word | `quote`'s verbatim rule, shorter; `lit` checked for range only (0 ≤ lit < the word count) | fires on clips with no numbers; the tutorial ranking's rank 4 (§1.3) |
| `lower-third` (new) | `name`: `speaker` (the asset's speaker as the user set it); `role`: `user` | one, on the speaker's first word | the name is never generated by the model | §1.2 row 26 |
| `steps` with a connector | §6.2's `steps`, plus `connector`: none, line or tree (`fixed`: chosen by the app or the style); for a tree, each item's `parent`, **computed by the app**, not filled by the model | one per item | items grounded as now; the app's parents each point to an earlier item, with one root | §1.2 rows 19-20 |
| `callout` anchored to a hand (phase 4) | §6.2's `callout`, plus `anchor`: a pointing event, **chosen by the app** (the event that overlaps the graphic's beat) | one, on the event's onset | the event must exist and overlap the graphic | §5 |

So:

- **`lit` adds one mode, `index`, to §6.1's list: an extension of §6.1, said
  plainly.** It marks emphasis, not a claim, so a wrong index misstates
  nothing the speaker said (inference); the range check is all the
  validator can do for it.
- **`parent` is app-computed in v1** (proposal): one root (the steps'
  title, or the first item when there is none) and every item its child, in
  spoken order; a deeper tree only where the enumeration says so in words
  the app can parse ("the first has two parts"). The validator can only check that a
  parent points backwards, never that the speech supports the structure, so
  a model-filled `parent` is a structure the model inferred (the tutorials
  angle ranked it with "needs an item structure the model must extract").
  If a later version lets the model fill it, that too extends §6.1, and it
  needs its own eval line first. Phase 2 adds one: a fixture set where
  speakers enumerate nested items, with the expected tree, scored as exact
  match of the parent list; plus a property test that every computed parent
  points backwards and there is exactly one root.
- **`anchor` is app-computed**: the model may only say "anchor this callout
  to the point", and the app binds the event; the validator's existence and
  overlap rule stays as a guard.

**The model never picks a curve, a duration or a sound.** The template and
the style carry them. **The budget** keeps §6.7's spacing (graphics at least
6 s apart, at most one per 20 s, CLIPS.md:8051) and adds three rules in code:
one graphic on screen at a time; none over a zoom punch; sounds under a
per-clip cap like the recipes' `maxHits` (PLAN.md:582). An overall cap per
minute waits for M17's count.

**A graphic's sound carries its graphic's Clear rule, not `SOUND_RULE`.**
The Director's sound lane holds clips under `SOUND_RULE 'director.sound'`,
and `clearDirector` removes every one of them and the sound files they
brought (`director/apply.ts:45-46`; `clearDirector` at `:112`). §6.6 gives Direct's
graphics `GRAPHIC_RULE 'director.graphic'` in `DIRECTOR_RULES`, and Clip
it's and the Transcript tile's `'clips.graphic'` with their own **Clear
graphics** (CLIPS.md:7912-7917; decision §16.10). A graphic sound under
`SOUND_RULE` would break that: Direct's Clear would delete the sound of a
Clip-it graphic and leave the graphic, and Clip it's Clear would leave the
sound behind. So each sound clip carries its graphic's rule, and the sound
file it brings is marked with the same rule (`broughtBy`), which means
`clearDirector`'s asset sweep, today keyed on `SOUND_RULE` alone
(`apply.ts:125`), learns `GRAPHIC_RULE` too, and Clear graphics removes
`'clips.graphic'` sounds and their files. A Clip-it graphic's sound goes on
an ordinary audio track, not the Director's lane (proposal). This is an
addition to §6 (§6.6 names only the graphics); §16.10 itself is unchanged.

### 4.6 Beats, motion and placement

**Beats** are §6.8's: the grounded word's `startMs` through the captions'
offset, a 0.5 s lead, the clip to the last beat plus 0.8 s, beats at least
160 ms apart, retimed clips refused. The moving frames end at the last beat
plus 0.5 s (CLIPS.md:7709) and the clip at the last beat plus 0.8 s
(:8078); the 0.3 s between them is the opacity exit (:7738). Keep it.

**Motion** becomes one module, `src/shared/graphics/motion.ts` (proposal),
read by every template and, later, by captions and zoom punches. The curves:

| name | definition | use |
|---|---|---|
| `expo-out` | 1 − 2^(−10x), or `cubic-bezier(0.16, 1, 0.3, 1)` [17][25] | the default entrance; a counter's arrival |
| `decelerate` | Material emphasized decelerate `(0.05, 0.7, 0.1, 1.0)` [23] | an alternative entrance |
| `accelerate` | Material emphasized accelerate `(0.3, 0, 0.8, 0.15)` [23] | exits |
| `standard` | `(0.2, 0, 0, 1)` [23] | moves within the frame |
| `out-cubic` | 1 − (1 − x)³ | kept; it is the captions' `easeOut` |
| `out-back` | c1 = 1.70158 [25] | the `pop` entrance only |
| `linear` | x | loops only: beams, marching dashes, sweeps [27] |
| `spring(ζ, ω)` | closed form for the under-, critically and over-damped cases, as Motion's generator evaluates position and velocity at any t [32]; Motion's own `spring()` is sampled with `next(t)`, physics options override a duration, and "Springs with damping: 0 will run forever" [31] | settles that need velocity continuity; ζ = 1 for text and camera [20]; the target issued early |

Starting durations (proposal, from §1.4): entrances 0.3-0.4 s; exits shorter,
about 0.12-0.3 s; a dim 0.3-0.7 s; a draw-on stroke 0.35-0.6 s; ambient loops
5-6 s, linear. `GraphicStyle.motion.ease` (CLIPS.md:7808) gains the new
names; §16.7-11 does not touch that list. A cubic-bezier solver is about
twenty lines and the spring about thirty, written here rather than taken as
dependencies. **Every spring is a pure function of t**: closed form, or
replayed from frame 0 as Remotion does (its loop runs to the frame and is
memoised [30]); never stateful integration.

**Indic text decides the unit of animation.** Per word is always safe. Below
a word:

- never by code point. Magic UI's per-character mode splits with
  `split("")`, into UTF-16 units, detaching matras and viramas [14]. **3dit's
  own caption entrances `bounce` and `wave` do the same class of thing**:
  `piecesOf` splits their `char` scope with `Array.from` (`textAnimation.ts:242-246`;
  the two entrances at `:126-142`), and each piece is drawn on its own
  (`textPaint.ts:505` onward, read by a fact-checker, not rendered). That is a
  defect outside step 3, recorded in §7.5;
- per grapheme cluster only after M3. Unicode 15.1's rule GB9c keeps a
  consonant, virama and consonant in one extended grapheme cluster: स्कूल is
  three clusters before 15.1 and two after [168]. `InCB=Linker` includes the
  Devanagari virama U+094D and the Telugu virama U+0C4D; the Kannada and
  Tamil viramas are not Linkers [170]. The current rule is in UAX #29
  revision 49 (Unicode 18.0.0, 2026-09-01) [169]. Segmentation depends on the
  Unicode version the toolchain carries [168], so Electron 44's ICU must be
  measured, and an orthographic syllable can still be longer than a grapheme
  cluster [167]; drawing cluster by cluster can still change shaping across
  clusters (a reph, a pre-base matra), so M3 diffs against the word drawn
  whole. The repo already counts graphemes with `Intl.Segmenter`
  (`ingest/captions.ts:49-64`, `director/compose.ts:32-35`).

**Placement** is §6.9's: the thirds from step 2's map excluding the
caption's third; `steps` and `bars` prefer the middle; `callout` through
`frameMap.ts`; lanes above the look and every card (§16.7). Added: a dim's
hole and a connector's target from `subjectBoxesAt`, **taken once, at the
graphic's onset**: that function steps between the track's two samples a
second without interpolating (`frameMap.ts:233-244`, `:275-291`), so a hole
or target that followed the face would jump every 0.5 s (§4.4's dim row);
in phase 4, the hand's box as a second obstacle. Where Instagram, TikTok
and Shorts lay their interface over a 9:16 frame was not looked up (§6.4),
and it decides which third is truly free.

### 4.7 Step 6 on the same path

Step 6's `timeline`, `before-after` and `versus` become draw lists; its 3D
`counter` and `ring` become phase 3's 2.5D variants; type stays
`drawTextOnto` into a `CanvasTexture` (CLIPS.md:9160-9163), and the
`kinetic-type` stub is replaced (CLIPS.md:9171-9173). Meshes that are not
planes (3D ribbons, extruded shapes) are items painter B draws directly.
Two three.js pieces already fit a pure frame function:
`SVGLoader.pointsToStroke` builds stroke geometry whose u coordinate runs
along the path, a ready draw-on parameter for a shader (its `createShapes` is
deprecated since r185) [128]; and `AnimationMixer.setTime(t)` sets a mixer to
an absolute time, where `update(delta)` accumulates [129], so imported
keyframed meshes can be drawn at frame n without replaying from 0.
`three-text` (MIT, 0.6.5, 2026-07-04) is the only three-native text library
found that shapes with HarfBuzz, through `harfbuzzjs` ^0.4.15; it calls
itself alpha, with an API that "may break rapidly", and its README claims CJK
and RTL scripts and names no Indic script [134]. Watch it for step 6's 3D
type, and test it on the EFFECTS §51 clusters before trusting it. Step 6's
own bars stay: flat colour within 2/255, WebGL missing means 3D dropped with
a note and 2D drawn (CLIPS.md:9175-9178, :9393).

### 4.8 Bake cost and the road to ffmpeg

A graphic is mostly transparent, and the encode cost of such a frame is
unmeasured (§6.3 already names it). An estimate from the measured opaque
figures, **not a measurement**: a 60 s clip carries at most three graphics
under the spacing rule (one per 20 s, which §4.5 keeps for every template),
each with 1-3 s of moving frames at 30 fps, so 90-270 frames; at 20-60 ms
each, serially, 1.8-16 s; with a four-deep pool scaling as the caption
bake's did (1000 ms to 264 ms for 60 pictures, about 3.8 times), about
0.5-4 s (computed). A dim whose hole follows the face, a marching connector
or a screen card baked frame by frame would multiply that by the length of
its hold.

The exits, in the order to try them:

1. **Bake the graphic's box, not the canvas.** Overlay it at its x and y, as
   the caption band is; for captions this measured 0.86 s against 3.4 s for
   the full frame. The box is the union over the moving frames.
2. **An encode pool of four**, as `captionBake.ts` measured: its `toBlob`
   encodes already run off the main thread (§4.1).
3. **Encode in workers**: only if `OffscreenCanvas.convertToBlob` in 1, 2
   and 4 workers beats that four-deep `toBlob` pool (M2).
4. **Raw RGBA on ffmpeg's stdin**, only if 1-3 fall short: 8,294,400 bytes a
   frame, about 249 MB/s at 30 fps through the renderer-to-main IPC and the
   pipe (computed). Bytes read straight from WebGL are premultiplied, so this
   path needs `overlay`'s `alpha=premultiplied`, committed to FFmpeg on
   2017-12-16 [160], in the 4.1 documentation [159] and present in the
   bundled macOS build [161]; the Windows build is to be probed (M4). three.js
   recommends `readRenderTargetPixelsAsync` as its non-blocking readback
   [126]; a pixel-pack-buffer readback was reported about three times faster
   than direct `readPixels`, on WebKit only [156].

Today's path is straight alpha end to end: a 2D canvas's `toBlob` writes PNG,
which "does not use premultiplied alpha" [154], and `overlay`'s default is
straight [159][161]. Out of reach: Electron's offscreen GPU shared textures,
which need a native module [155]; WebCodecs encoding with alpha, which no
source established.

### 4.9 Libraries

This is the one list of libraries and their verdicts; other sections point
here. Versions, publish dates and licences are from each package's deps.dev
version entry [120]; push dates and open-issue counts from the GitHub API
[121]; sizes, minified and gzipped, from Bundlephobia [122]; each package's
own URL is listed under those numbers in §8, all read 2026-10-17, unless
another source is cited.

| name | licence | latest release, date | maintenance | use | size | verdict |
|---|---|---|---|---|---|---|
| three | MIT | 0.186.1, 2026-09-24 | active | already the dependency (`^0.186.0`) | 129 KB, loaded lazily (`threeShared.ts:14-23`) | **keep** |
| d3-hierarchy | ISC | 3.1.2, 2022-04-02 | finished; no release since 2022 | tidy-tree layout | 5.7 KB | **try** in phase 2, only if the tree needs more than a fixed one-to-n layout |
| d3-shape | ISC | 3.2.0, 2022-12-20 | finished | `link(curveBumpX)` drawn straight onto a canvas context [150] | 5.7 KB | **try**, same condition |
| perfect-freehand | MIT; the README asks commercial users to consider sponsoring, with no condition [164] | 1.2.3, 2026-02-01 | active; last push 2026-04-13 | a marker-pen stroke with pressure and taper, filled as a `Path2D`; `getSvgPathFromStroke` is README code to copy, not an export | not measured | **try** in phase 2 as a style's stroke look, after M10 |
| rough.js | MIT [163] | 4.6.6, 2023-11-20 | no release in nearly three years; last push 2024-07-28 | sketchy arrows and circles; its `seed` option is an integer LCG through `Math.imul`, which falls back to `Math.random()` when the seed is 0 or unset, so a non-zero seed must always be passed [163] | "<9 kB" (README) | **hold** until M10's cross-platform pixel check |
| @dagrejs/dagre | MIT | 3.1.1, 2026-08-08 | active; "only the one in the DagreJs org is receiving updates" [149] | general directed graphs | 15.8 KB | not needed |
| elkjs | EPL-2.0 OR GPL-3.0-or-later (LICENSE.md is EPL-2.0, GPL as a Secondary License) [151] | 0.12.0, 2026-07-17 | active | orthogonal routing and ports | 433 KB | **reject**: size, licence, not needed |
| bezier-easing | MIT | 3.2.0, 2026-10-07 | active | cubic-bezier curves | not measured | not needed: a 20-line solver here |
| motion-dom (Motion) | MIT | 14.3.0, 2026-10-15 | active | its closed-form spring [32] | not measured | **reference**: copy the math with its notice; no dependency |
| 1eurofilter | BSD-3-Clause [166] | 1.3.0, 2026-02-15 | maintained by the filter's author | fingertip smoothing (§5) | not measured | **reference**: a 30-line filter in `src/shared` |
| UnrealBloomPass (three's examples) | MIT, part of three | r186 | alpha handling fixed 2025-12-09 [130] | glow on an alpha overlay | part of three | **try** in phase 3 (M7) |
| postprocessing (pmndrs) | Zlib | 6.39.5, 2026-09-09 | active; peer three ≥ 0.168.0 and < 0.187.0 | Bloom, depth of field | 112.6 KB (whole package) | **hold**: its README says nothing about alpha [136], and its peer range would pin three below 0.187 |
| troika-three-text | MIT | 0.52.5, 2026-07-24 | active; 93 open issues | SDF text in three | 44.6 KB | **reject**: no Indic shaping [131], asynchronous layout [132] |
| three-text | MIT | 0.6.5, 2026-07-04 | alpha | HarfBuzz-shaped text as geometry [134] | not measured | **watch** for step 6's 3D type |
| harfbuzzjs | MIT [135] | 1.6.3, 2026-10-06 | active | shaping outside canvas | not measured | not needed: canvas shapes |
| meshline (pmndrs) | MIT | 3.3.1, 2024-06-03 | quiet | 3D ribbons | 3.7 KB | later, step 6, if ribbons are wanted |
| three.meshline | MIT | 2.0.0, 2026-10-13 | active; days old | 3D ribbons | not measured | later, same |
| @lottiefiles/dotlottie-web | MIT | 0.81.0, 2026-10-06 | active, pre-1.0 | text-free accents; ThorVG in WASM; `setFrame(n)` [140] | not measured | later, preferred over lottie-web if accents are wanted; determinism and seek-equals-play to measure |
| lottie-web | MIT | 5.13.0, 2025-05-21 (before it 5.12.2, 2023-06-13) | slow; 858 open issues; last push 2025-09-01 | the same, `goToAndStop(n, true)` [139] | 76.8 KB | later, fallback |
| @rive-app/canvas | MIT runtime; `.riv` export needs a paid seat [103][104] | 2.44.2, 2026-10-10 | active | accents with state machines | not measured | **reject** unless the user buys Rive |
| gsap | GSAP Standard "No Charge" License (Webflow), not OSI; commercial use covered and every plugin free [137][138] | 3.15.0, 2026-04-13 | active | tweens | 27.4 KB | **reject**: Prohibited Uses cover use in tools "that allow users to build visual animations without code" competing with "Webflow's visual animation building capabilities", and the licence may be terminated on non-compliance [137] |
| @theatre/core, @theatre/studio | Apache-2.0; AGPL-3.0-only | 0.7.2, 2024-05-19 | dormant; last push 2024-08-14 | keyframe editor | 31.4 KB (core) | **reject** |
| @motion-canvas/core | MIT | 3.17.2, 2024-12-14 | no code commit since 2025-02-16 | — | not measured | **reject** as a dependency; borrow the `Curve` vocabulary [142] |
| @revideo/core | MIT | 0.11.0, 2026-07-10 | repo pushed 2026-07-15 | headless-browser rendering | — | **reject** |
| remotion | Remotion License | 4.0.536, 2026-10-16 | very active | — | — | **reject** (§2.5) |
| Magic UI | MIT [13] | no releases or tags; latest commit 2026-10-11 | active copy-paste registry | React and DOM motion components | — | **reference only**: its values are useful; its `split("")` and `en-US` are what not to copy |
| product-launch-motion | MIT for SKILL.md, `references/`, `legacy/` and the README prose; Cheerful's sample films excluded; the legacy v1 scripts use GSAP [19] | v2.0.0, 2026-10-12; latest commit 2026-10-15, references edited after the release | active | launch-film motion written as numbers | — | **reference only** |
| excalidraw-animate | MIT (2020, Daishi Kato) | 0.7.2, 2026-04-24 | maintained; last push 2026-09-10 | an embeddable library that animates SVG, on `@excalidraw/excalidraw` 0.18.1 [56] | — | **reference only**: it animates SVG, not canvas frames |
| hand_landmarker.task (MediaPipe) | Apache 2.0, per its model card [176] | file Last-Modified 2023-04-26; 7,819,105 B [179] | a static model; the Tasks API maintained | the hand track (§5) | 7.8 MB download, on a press | **adopt** in phase 4, if its gate passes |
| gesture_recognizer.task | not stated on the classifier's model card [177] | 2023-04-26; 8,373,440 B [179] | static | canned gesture labels | 8.4 MB | **reject**: no sideways point; licence unstated |
| pose_landmarker_lite / _full / _heavy.task | Apache 2.0, per the BlazePose GHUM 3D card [178] | Last-Modified 2023-04-27/28; 5,777,746 / 9,398,198 / 30,664,242 B [179] | static | four points per hand (§5.1) | 5.8 / 9.4 / 30.7 MB | **fallback only**, for hands too small to detect; not a pointing detector |
| MediaPipe Model Maker | Apache 2.0 | 0.2.1.4, 2024-04-22; its PyPI classifiers list Python 3.8-3.10 and it declares no `requires_python` [175] | "no longer actively maintained" [175] | custom gesture classifiers | — | **reject**, because it is unmaintained; whether it would install on the 3.14 pack was not tested (inference from its classifiers that it may not) |
| Animated Noto Emoji | CC BY 4.0 [114] | no release date shown | Google Fonts | pointing hands and reactions as Lottie, WebP, GIF | — | later, behind an attribution decision |
| Microsoft Fluent Emoji | MIT [115] | no releases; 37 commits | low activity | static hand and emoji art | — | later |

The recorders' code is covered in §2.6: reference at most, and the AGPL ones
not for copying.

### 4.10 Measurements before relying on any of it

Electron does not start in the development sandbox and the macOS MediaPipe
wheel aborts there without Metal (CLIPS.md:166-170), so every measurement in
Electron or MediaPipe below is the user's run on the Mac and the Surface,
through the harness, unless it says CI or node.

**The command shapes are proposals**: the hook, its options and the test
files do not exist yet. They follow the project's own shapes:
`await window.__forgeMomentCheck()` in `harness/momentCheck.ts`, run in the
harness (`npm run harness`), and EFFECTS §54's `FORGE_FACES_REAL=1 npx
vitest run tests/integration/faces.int.test.ts`. One hook,
`window.__forgeGraphicCheck(options)` in a new
`src/renderer/src/harness/graphicCheck.ts`, carries every harness
measurement; it returns its numbers and the frames it drew. **Every result
lands in a new EFFECTS §61, "Graphics: the forks measured"** (the next free
number after §60), with its command, machine and date, as §54 and §56 record
theirs; the hand measurements of §5.10 land in §62. One caution: the
harness "serves the renderer as an ordinary web page", with no Electron
(`vite.harness.config.ts:7-13`), so its results belong to whichever browser
opened it. M3 and M22 depend on the Chromium, ICU and HarfBuzz that
Electron 44 ships, so they run in the app's own renderer (a development
build's console), or the browser's version is recorded beside the result.

| # | measurement | command shape | where | decides |
|---|---|---|---|---|
| M1 | PNG encode of a mostly transparent 1080×1920 graphic frame | `await window.__forgeGraphicCheck({ encode: { frames: 120, region: ['canvas', 'box'], pool: [1, 2, 4] } })`: 120 frames of a synthetic template, full canvas against its box, an encode pool of 1, 2 and 4 (the `captionBake.ts` pattern); ms per frame at p50 and p95, and bytes per frame | Mac, Surface | the bake region and pool depth |
| M2 | encode in workers, against the existing pool | `await window.__forgeGraphicCheck({ encode: { frames: 120, workers: [1, 2, 4] } })`: `OffscreenCanvas.convertToBlob({ type: 'image/png' })` in 1, 2 and 4 workers, against the four-deep `toBlob` pool whose encodes already run off the main thread (§4.1), on the same frames; ms per frame at p50 and p95 | Mac, Surface | whether workers beat the `toBlob` pool |
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
| M16 | reading holds | `npx vitest run tests/graphicHolds.test.ts`: each template's longest label at 20 characters a second [33] and twice at 200 words a minute [34], in English, Hindi and Telugu, against its seconds (CLIPS.md:7676-7683) | node | the templates' seconds |
| M17 | density | graphics, zooms and sounds per minute, counted frame by frame by the user in five clips they call pro and five from a clipper | the user | the overall cap |
| M18 | sound levels | `"$FFMPEG" -i mix.wav -af ebur128 -f null -` for a tick, a pop and a whoosh under speech on the user's clips; intelligibility judged by the user's ear | Mac | sound levels |
| M19 | 4:2:0 fringing | `await window.__forgeGraphicCheck({ strokes: { widths: [1, 2, 3] } })` writes the PNGs; each is overlaid through the plan's `format=yuva420p` overlay, and its chroma bleed is measured against the PNG | Mac | the minimum stroke width |
| M20 | screen card | `await window.__forgeGraphicCheck({ screenCard: '<a 1080p screen recording>' })`: a tilted 2.5D card at 9:16; legibility at rest judged by the user, and the bake cost of its moving frames | Mac, Surface | the screen card's scope |
| M21 | Hindi numbers | `FORGE_MODELS_DIR=<models> npx vitest run tests/integration/asr.int.test.ts`, extended with the user's Hindi clips: how the installed faster-whisper writes numbers said in Hindi (Devanagari digits, ASCII digits or words) | the user's clips | sizes how many Hindi counters survive §16.11's drop of number words in v1; decides the counter's digit format |
| M22 | Indic shaping in the canvas painter | `await window.__forgeGraphicCheck({ indic: true })`: the EFFECTS §51 clusters (क्ष त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త) painted by `drawTextOnto` whole, and again one code point at a time (`Array.from`, standing in for libass's `shaping=simple`). Per cluster: the two frames must differ, as `captions.int` requires complex ≠ simple on all 54 frames of each script (EFFECTS.md:4737-4742), and each conjunct's `measureText` advance must be narrower than the sum of its code points'. Then the whole-drawn frames are set beside `captions.int`'s `shaping=complex` and `shaping=simple` frames of the same clusters and judged by eye (two renderers, so no pixel equality is expected), so a loose virama or an i-matra after its consonant is seen. Which fallback font resolved is recorded by comparing each cluster's width against the same cluster drawn in each candidate system font named explicitly | Mac, Surface | whether "text has to be canvas 2D" holds (§4.2); phase 1's and phase 2's Indic exit bars (§7.3); D10 |

§6's own open measurements stay as planned: LM Studio's strict
`json_schema` with `minItems: 0` under Gemma 4 E2B, and the Telugu negative
endings (CLIPS §15, rows 10 and 11).

---

## 5. Hand gestures through the AI helper

The question: can 3dit make "the speaker points, and a graphic appears where
they point" happen automatically, through the AI helper that already ships
MediaPipe 0.10.35? Nothing was run; every inference cost below is someone
else's measurement on someone else's hardware, and ours are §5.10.

### 5.1 The model, and what is already installed

**Hand Landmarker.** Its bundle holds a palm detector, run on the whole
image, and a landmark model, run on the hand's crop, which returns 21 points
[172]. In VIDEO mode the next frame's crop comes from the current frame's
landmarks, and the palm detector runs again only when the hand-presence score
falls below `min_hand_presence_confidence`, or when tracking fails: the
box's IoU between the current and the last frame falls below
`min_tracking_confidence` [172]. `num_hands` defaults to 1
and the three confidences to 0.5 [172]. Each hand comes back with a
handedness label, 21 image landmarks (x and y normalised to 0..1, z relative
to the wrist) and 21 world landmarks in metres [172][173][180].

**Gesture Recognizer.** A superset bundle: the same two models, a gesture
embedder and a small classifier [171]. Its canned classes are `Closed_Fist`,
`Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`, `Victory` and
`ILoveYou`, plus `None` for a hand with no known gesture (the page's numbered
list calls class 0 "Unknown"; store whatever string the API returns) [171].
Its model card says the classifier "does not directly process any images",
reading only the landmarks and handedness; it puts two-handed gestures (a
heart), gestures defined by motion (waving goodbye) and sign language out of
scope; it reports a weighted F1 of 95.5% (94.3-97.8%) across perceived Monk
skin tones [177]. **`Pointing_Up` covers one static pose, the index finger
pointing up. What it returns for a finger pointing sideways, the pose a
talking head uses, is not documented** (H6).

**Pose Landmarker** gives 33 points, only four per hand (wrist 15/16, pinky
17/18, index 19/20, thumb 21/22), with no latency published [174]; its model
card states Apache 2.0 [178]. It cannot tell an extended index from an open
palm. A robotics study measured MediaPipe's index-finger direction at 26.1°
±12.2° yaw and 17.3° ±16.0° pitch error against 3D targets, with skeleton
baselines from about 16° to 47° [186]. Pose is a fallback for hands too small
to detect, not a pointing detector.

**Model Maker**, which trains a replacement classifier, "is still available,
but is no longer actively maintained" (2026-06-05); its last release is
0.2.1.4 (2024-04-22) [175]. That alone rules it out. Its PyPI classifiers
list Python 3.8 to 3.10 and it declares no `requires_python` [175]; that it
would not install into the AI helper's 3.14 pack is our inference from that
metadata, not tested.

**What the AI helper already holds.** No new wheel is needed. The installed
0.10.35 wheel in `sidecar/.venv-faces` already ships `hand_landmarker.py`,
`gesture_recognizer.py`, `pose_landmarker.py` and `holistic_landmarker.py`
under `mediapipe/tasks/python/vision/`; in `hand_landmarker.py` the
`HandLandmark` enum gives `WRIST = 0`, `INDEX_FINGER_MCP = 5`, `PIP = 6`,
`DIP = 7`, `TIP = 8`, and `detect_for_video` wants timestamps "monotonically
increasing for adjacent calls" (read 2026-10-17). The word "smooth" does not
occur in that file. The Windows wheel's contents were not checked. No hand,
pose or gesture model, track or plan exists anywhere in `sidecar/`, `src/`,
`tests/` or `docs/` (searched).

**Smoothing is ours to write.** The developer assigned to a 2025 MediaPipe
issue wrote that the Tasks landmarker's tracking "is just to skip re-running
the palm detector, not to smooth landmarks" [184]. The legacy graphs had a
smoothing calculator: a One Euro filter (frequency 30, `min_cutoff` 1.0,
`beta` 0.0, `derivate_cutoff` 1.0) or a velocity filter, dividing values by
the object's size, the largest side of its box, before filtering [183].

**No reason to wait for an upgrade.** Upstream is at 1.1.1 (2026-10-14);
0.10.35 was 2026-04-27 [185]. Since 0.10.35 the hand-related release notes
are a wrist-connection fix in `HAND_PALM_CONNECTIONS`, two Holistic fixes,
and a drift fix in the legacy smoothing calculator, which the Tasks API does
not expose [185].

**The Metal abort carries over.** The macOS wheel needs a GL or Metal
context even on the CPU delegate and aborts with −6 without one, which is why
the face finder runs in a child worker; the Surface is still unmeasured
(EFFECTS §37, §54). The hand landmarker is the same Tasks runtime, so the
same holds until measured.

| model | file | bytes (HEAD, 2026-10-17) | Last-Modified | inputs | published cost | licence | source |
|---|---|---|---|---|---|---|---|
| Hand Landmarker | `hand_landmarker.task` (`float16/1`, same md5 as `latest`) | 7,819,105 | 2023-04-26 | palm 192×192, landmarks 224×224 | 17.12 ms CPU, 12.27 ms GPU, Pixel 6 | Apache 2.0 (model card) | [172][176][179] |
| Gesture Recognizer | `gesture_recognizer.task` (`float16/1` = `latest`) | 8,373,440 | 2023-04-26 | as above, plus the embedder and classifier on landmarks | 16.76 ms CPU, 20.87 ms GPU, Pixel 6 | not stated on the classifier's card | [171][177][179] |
| Pose Landmarker lite / full / heavy | `pose_landmarker_*.task` (`float16/1`) | 5,777,746 / 9,398,198 / 30,664,242 | 2023-04-27/28 | detector 224, landmarks 256 | none published | Apache 2.0 (BlazePose GHUM 3D card) | [174][178][179] |
| Holistic Landmarker | `holistic_landmarker.task` (`latest`) | 13,683,609 | 2023-12-21 | — | none read | partly unverified: its page links the BlazePose and Hand Tracking cards (Apache 2.0) and a FaceMesh V2 card not read | [179] |

The gesture bundle contains the hand landmarker, so a feature needs one of
the first two files, not both; the geometric rule in §5.4 needs only the
smaller, Apache 2.0 one.

### 5.2 The cost

**Download**: one file, 7,819,105 bytes, fetched once by pinned URL and
sha256 through the same `fetch_url` path that pins the face model
(`MODEL_URL`, `MODEL_SHA256`, `MODEL_BYTES = 1_083_786` in
`capabilities/faces.py:67-85`). The versioned `float16/1` path and `latest`
had the same md5 on 2026-10-17 [179]; pin the versioned one, as faces.py
does.

**Compute.** The only published figures are phones': 17.12 ms on CPU and
12.27 ms on GPU per frame on a Pixel 6 [172]; the paper gives the landmark
model alone at 6.6, 16.1 and 36.9 ms (light, full, heavy) on a Pixel 3,
through the TensorFlow Lite GPU backend [181]. No laptop CPU timing of the
Python Tasks API was found; a clinical validation run on an i7-9750H laptop
repeats Google's phone figures instead of timing it [187]. Our face finder
runs at about 5.0 ms a frame on the user's M1 Pro at 360×778 (EFFECTS §37).

The face pass's cost on the user's M1 Pro, two readings:

| reading | clip | faces | of realtime (computed) |
|---|---|---|---|
| EFFECTS §54 (2026-10-13; `FORGE_FACES_REAL=1 npx vitest run tests/integration/faces.int.test.ts`; EFFECTS.md:5314) | the 26.6 s 4K HEVC fixture, five samples a second, 133 samples | 37.8 s | 1.4× |
| EFFECTS §56 (2026-10-14; `FORGE_REFRAME_REAL=<file> npx vitest run tests/integration/reframeJob.int.test.ts`, the job's own stage clock; EFFECTS.md:6300-6311) | the same fixture | 9.29 s | 0.35× |
| the same | `j4aoo1qbGoE`, 613.8 s of 1920×1080 H.264 | 20.48 s | about 1/30 |

§56 is the later reading, and it times the very stage a hand pass would
join; why §54's figure on the same fixture is about four times larger is
not explained in EFFECTS (unverified). On §56's numbers the 4K decode is
the cost (EFFECTS.md:6313-6317), and a 1080p talking head's faces stage
runs at about a thirtieth of realtime. **So a hand pass
should share that decode, in the same worker on the same frames, rather
than decode again**: a second decode would roughly double a 4K stage
(inference), and on 1080p the shared pass's cost becomes the hand model's
own, which no laptop figure yet bounds (H2, H12).

**Sample rate.** The face pass samples five a second and keeps two
(`faces.py:92`; `main/reframe/analyse.ts:381`, `:405`). At five, a pointing
onset is known to 200 ms (six frames at 30 fps), and VIDEO-mode tracking,
which assumes little movement between samples, loses hands more often [172].
Proposal: ten a second, with a dense re-pass about ±300 ms around each onset
if H8 says ten is coarse.

### 5.3 The limits that matter for this user

- **The fingertip is the least accurate point on the hand.** The hand
  model's card reports per-joint error "smallest at the base of each finger"
  and growing toward the tip, "larger for blurry or occluded joints"; the
  full model's mean error, normalised by palm size, is 10.09% ±1.73% (6.10 to
  13.00%) across 14 regions; the card merges Southern and Western Asia into
  Central Asia, at 9.55% [176]. By skin type 1 to 6 the full model's error is
  5.76, 4.67, 4.60, 4.69, 4.53 and 6.21% [176]; the card's own conclusion
  is "We didn't find any error pattern with regard to the skin tone types"
  [176], though the darkest type's figure is the highest and the lightest's
  the next (our reading of its table). The tip is exactly the point an
  anchored arrow would follow.
- **An experimental model, untested in low light or motion blur.** The card
  says the model "has been trained on limited datasets and is meant for
  experimental usage", and that it has not been tested in "in-the-wild"
  smartphone conditions, naming low-end devices, low light and motion blur
  as conditions that can affect performance; trained with varied light,
  noise and motion, "its quality can degrade in extreme conditions" [176].
  **Wedding receptions are often low-light footage, and a fast point is a
  blurred hand** (inference), so both join henna on the list only
  measurement can size (H4).
- **Mehndi, jewellery and held objects are out of scope.** The card lists
  as "not appropriate": hands with gloves or occlusions, a hand holding
  objects, and a hand with "decoration … including jewelry, tattoo and
  henna" [176]. **For a wedding-first product, a bride's hennaed hands,
  bangles and a held microphone or bouquet are the documented failure case,
  not an edge case: the largest single risk here, and only measurement can
  size it** (H4).
- **Small hands.** The palm detector sees the whole frame at 192×192 [176],
  over a hand-size span of about 20 times [181]. A hand a tenth of the
  frame's width reaches it about 19 px wide (computed). Analysing at a higher
  resolution does not help detection, only the landmark crop once found.
- **Handedness.** The legacy docs say the labels assume mirrored, selfie
  input: "please swap the handedness output in the application" otherwise
  [180]; the Tasks pages say nothing [173]. Creator footage from a rear camera
  or a DSLR is not mirrored, so handedness may tell two hands apart but never
  decide which side a graphic goes.
- **Direction is coarse.** With a 26° yaw error [186], the MCP-to-tip ray
  is good for one of four sides and for turning an arrow, not for casting a
  ray to "what they point at".

### 5.4 From 21 points to a pointing event

**A geometric rule, not the canned class.** Google's own first gesture
recogniser labelled each finger bent or straight from its accumulated joint
angles, then mapped the set of states to a gesture [182]. Pointing is then,
all in pixel space:

- the index finger straight: MCP (5), PIP (6) and TIP (8) close to
  collinear;
- the middle, ring and little fingers curled: each tip (12, 16, 20) nearer
  the wrist (0) than its PIP (10, 14, 18);
- the thumb ignored;
- the direction the unit vector MCP to TIP, taken after multiplying x by the
  frame's width and y by its height, because the coordinates are normalised
  separately on each axis [173]; on a 16:9 frame an angle in normalised
  units is wrong by up to the aspect ratio (computed).

The canned label can be stored beside the rule and compared on our footage
(H6); nothing should depend on it.

**Events, not frames.** Effect House's gesture node fires Begin, Stay, End
and None [193], the right shape. Live products wait before firing: Zoom runs
a timer of about four seconds [192], and Apple says to hold the gesture until
the effect appears [189]; the wait defends against false positives, since
"regular body language" triggers Apple's reactions, which cannot be disabled
within video apps [192]. An editor knows the future: it can demand a dwell and
still start the graphic on the frame the gesture began. Every value here is a
starting point:

| rule | starting value (proposal) | why | idea from |
|---|---|---|---|
| shape test | the finger states above | the canned class covers "up" only | [171][182] |
| enter | presence ≥ 0.5 and the shape test on 3 consecutive samples at ten a second (a 300 ms dwell) | dwell instead of a live timer | [172][189][192] |
| exit | the shape test fails on 2 consecutive samples, or presence < 0.4 (hysteresis below entry) | a flicker must not end the event | [193] |
| gap bridging | dropouts of 200 ms or less inside an event interpolated | blur and occlusion drop joints | [176][187] |
| start frame | the first qualifying sample, backdated; refined by the dense re-pass if needed | offline knows the onset | — |
| never across a cut | an event ends at its shot's end; tracking reset per shot, or the first sample after a cut discarded | the crop carried over is stale | [172] |
| minimum length | 400 ms on screen | shorter reads as noise | — |

**Smoothing.** The 1€ filter is a low-pass filter whose cutoff rises with
speed: heavy smoothing at rest, light in motion [165]. Its authors' tuning:
set `beta` to 0 and `min_cutoff` near 1 Hz, lower `min_cutoff` until a still
hand stops jittering, then raise `beta` until fast moves stop lagging [165].
MediaPipe's calculator uses the same defaults and divides by the hand's size
first [183]; do the same, in palm-size units (wrist to middle-finger MCP,
the card's definition [176]). Run forward and then backward over the known
track to cancel the lag (proposal; no source). The reference implementations
are BSD or MIT [165]; npm `1eurofilter` is BSD-3-Clause, 1.3.0, 2026-02-15
[166]. A pure function of about thirty lines in `src/shared` beside
`freeSpace.ts` avoids the dependency and keeps preview and export on one
arithmetic.

### 5.5 The HandTrack, beside the SubjectTrack

A plan sketch by analogy with step 1, not code to commit.

**Raw, in the AI helper's cache**, versioned like the face worker's
`track_path` and keyed by `size:mtime`: per sample, its ms and up to two
hands, each with presence, handedness and score, a box, the 21 (x, y) points
at 4 dp in upright-frame units, and the canned label only if that bundle is
used. About 2.6 KB of JSON per second per hand at ten a second (an estimate):
too large for the project file.

**Reduced, in the project**, as `Project.hands[assetId]`, a fact about the
file like `Project.subjects`, which Clear leaves alone:

| field | holds |
|---|---|
| `key`, `version`, `width`, `height`, `fps`, `detector` | as `SubjectTrack` (`reframe/types.ts:14-89`); `detector` names the model and its sha256 |
| `events` | the `PointEvent` list |
| `PointEvent.startMs`, `endMs` | source ms; never across a shot |
| `PointEvent.dir` | left, right, up or down, from MCP to TIP in pixels |
| `PointEvent.score` | mean presence times the shape test's margin (proposal) |
| `PointEvent.tip` | the smoothed tip, `{ ms, x, y }` samples in upright-frame units |
| `PointEvent.hand` | the union box, an obstacle for placement |

**Derived, never stored**, as pure functions in `src/shared/hands/`:
`pointEvents(raw, rules)`, so the rules can be tuned and re-derived from the
cache without re-running the model; `tipOnFrame(project, clip, event, frame)`,
which wraps `sourceToFrame` and returns null off screen; `pointPlacement(…)`,
which extends `freeSpace.ts` with the hand's box.

**Re-analysis must not move an edit.** The reduced events live in the
project, so preview and export never re-run the model. A re-analysis on
another machine or with another model version may find different events
(XNNPACK on one, a Metal context on the other); it arrives as a proposal, not
as a silent change to graphics already placed (proposal).

### 5.6 Anchoring through the reframe crop

Step 2 solved the hard half. `sourceToFrame` maps a source-normalised box
onto the output frame on a given project frame, through the reframe's crop,
a two-up's halves and the clip's fit, and returns null when nothing of the
box is on screen (`frameMap.ts:78-132`). Its `usable()` guard rejects a box
with no width or height (a fact-checker's reading), so a fingertip needs a
small non-zero box or a point variant. Because the crop moves with the face,
the anchor is mapped on every output frame, never once per event.

**The geometry is the first risk.** A full-height 9:16 crop of a 16:9
source is 1080 × 9/16 = 607.5 px of 1920: 31.6% of the frame (computed). The
reframe centres that strip on the face, so an arm extended sideways often
puts the fingertip outside the output frame. Null is an ordinary case, not an
error; the share of real points that stay inside is H9.

Stability rules (proposals):

1. **The body does not ride the finger.** It is placed once, at onset, in
   the free third on the pointed side, with the hand's box as a second
   obstacle. Only the leader line's or arrow's tip follows the smoothed
   fingertip. (In After Effects a track drives a null that the graphic hangs
   off; this rests on search listings only, unverified.) Text that moves with
   a hand cannot be read.
2. **A dead zone**: smoothed tip moves under about 2% of the short side are
   not drawn.
3. **The hand leaves**: hold the last on-screen anchor up to 300 ms, then
   retract the line; the body keeps its own duration; never chase the hand
   back, never start a second graphic from one event.
4. **The tip is off screen at onset**: place the body on the pointed side
   with an arrow toward the edge, or do not offer the event.
5. **Determinism**: the drawn path is a pure function of the stored track,
   the rules and the clip, baked like any graphic; preview equals export.

### 5.7 The Director and the switch

`graphics@1` is shown the clip's events (times, side, score) and may bind a
callout's `anchor` to one (§4.5). A deictic word near the onset ("this",
"here", "look", and Hindi and Telugu equivalents to list with the user)
strengthens it; RealityTalk lets spoken nouns trigger visuals whose position
the pointing finger sets [188], the closest precedent found, and it publishes
no angle, dwell or smoothing thresholds. How gesture strokes align in time
with deictic words in speech was not researched, so the backdating rule
stands on the editor's knowledge of the future, not on a source. The
validator refuses an anchor to an event that does not exist or does not
overlap the graphic. This adds a `GraphicSpec` field and touches nothing in
§16.7-11.

**The switch** follows Smart placement: off per clip by default, greyed
"needs the AI helper" until the hands method is registered and its self-test,
in a child worker because of the Metal abort, passes; a model press with its
size; a self-test group entry; the pack's `expects` (`packManifest.ts:314-324`);
`CREATE_NO_WINDOW` on the spawn, as the face worker has. **A graphic placed
by a point is a proposal the user keeps**, as §6.6's unsure numbers are.

### 5.8 Gestures beyond pointing

| gesture | the graphic it suggests | shape from |
|---|---|---|
| a point, any direction | a callout or arrow toward the pointed side; §6's `callout` | geometry [182] |
| index up | "one", the first of a list; `counter` or `steps` | `Pointing_Up` [171], or geometry |
| one to five fingers counted | `steps`, item n | finger states [182] |
| thumb up or down | a tick or cross badge | canned [171]; Apple and Zoom fire on it [189][192] |
| open palm to the camera | a reveal | canned [171]; Effect House's hand gesture template [195] |
| two-hand shapes, swipes | out of the canned classifier's scope [177] | — |

### 5.9 Risks

The hand track's risks are rows of §6.1's one risk table, marked "phase 4"
there, in order of weight: henna, jewellery and held objects; low light and
motion blur; sideways points leaving the crop; false positives; fingertip
jitter; the Windows path; the gesture classifier's licence; and Model
Maker's state. What this research did not cover about hands is in §6.4.

### 5.10 Measurements

All but H11 are the user's runs: MediaPipe needs Metal on the Mac, and H13
downloads the model, which the sandbox runs here do not. **The command
shapes are proposals.** The face worker reads one JSON spec line on stdin
(`parse_spec`; `"mode": "detect"` today, `capabilities/faces.py:334-346`)
and is started as `<python> -E -s -B -c <bootstrap>` (`workers/mp_faces.py:1-8`),
so a hand pass is a new spec mode, `{"mode": "hands", "bench": true, "fps":
10, "edge": 640, …}`, driven like the face pass by a new gated test,
`FORGE_HANDS_REAL=<clip> npx vitest run tests/integration/hands.int.test.ts`,
which writes its table to `tests/output/hands/real/README.txt`, as
`faces.int` does (EFFECTS §54). Every result lands in a new EFFECTS §62,
"Hands: the spike measured", with its command, machine and date.

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

---

## 6. Risks, licences and costs in one place

### 6.1 Risks

This is the one risk table; other sections point here.

| risk | where it bites | evidence | mitigation |
|---|---|---|---|
| the canvas painter's Indic shaping never measured | every graphic with Hindi or Telugu; the case for painting text in canvas 2D | EFFECTS §51 measured libass, not `drawTextOnto` (§4.2); the only canvas evidence is a 2015 Chromium review [157] | M22 in phase 0; the Indic exit bars of phases 1 and 2 (§7.3) |
| Indic text split below a cluster | kinetic type; the captions' `bounce` and `wave` today | [14]; `textAnimation.ts:242-246`, `:126-142` | per word by default; M3; fix the captions (§7.5, D8) |
| no Indic font bundled; Mac and Windows fall back differently | every graphic with Hindi or Telugu | the font shorthand ends at `sans-serif` (`textPaint.ts:285-290`); libass on the Mac falls back through CoreText (EFFECTS.md:4724); the library has no Telugu font, and only Poppins Black and ExtraBold and Teko Bold carry Devanagari (BETA.md:356-372); M22 records which fallback the canvas resolves | decide BETA R14, bundling Noto Sans Devanagari and Noto Sans Telugu, both OFL (BETA.md:367-368), before phase 1's Indic exit bar (D10) |
| transparent-frame encode cost unknown | every bake | CLIPS.md:7761-7763; §4.8 | M1; box bake; pool of four |
| graphics that move on every held frame | a dim following the face, marching dashes, a tracked callout, a screen card | §4.8 | fixed holes, once per clip, tilt-in only |
| 4:2:0 chroma on thin coloured strokes | lines, arrows, small type | every overlaid clip is `yuva420p` (`plan.ts:1484`) | M19; strokes of 2 px or more (proposal) |
| per-GPU pixel differences | golden images; the Mac against the Surface | [162] (wording unverified) | M13's tolerance |
| one shared WebGL context | 2.5D, step 6 | `threeShared.ts:28-31`; the carousel's undisposed scenes (CLIPS.md:9153-9159) | dispose as `momentCanvas.ts` does |
| springs smear the arrival | counters, rings | [16][21] | a fixed-duration curve ending on the beat |
| clips that read as busy | all of it | §1.4 | the budget in §4.5; M17 |
| a graphic's sound left behind, or taken, by the wrong Clear | phase 2's sound | `clearDirector` removes every `SOUND_RULE` clip (`director/apply.ts:45-46`, `:112`); §16.10 gives Clip it's graphics their own Clear | each sound carries its graphic's rule (§4.5); phase 2's mutation-checked test |
| phase 4: henna, jewellery and held objects | wedding footage, the first niche | documented out of scope [176] | H4; the gate measured separately on hennaed hands; off by default on wedding footage if they fail |
| phase 4: low light and motion blur | receptions; any fast point | the card: an experimental model, not tested in low light or motion blur [176] | H4 includes a low-light reception and a blurred point; so does the gate |
| phase 4: sideways points leaving the crop | 16:9 sources reframed to 9:16 | a 31.6%-wide crop (computed, §5.6) | §5.6's rules; H9 |
| phase 4: false positives from ordinary gesturing | every clip with the switch on | Apple's reactions fire on "regular body language" [192] | dwell, minimum length, the shot boundary, a speech co-signal; H7 |
| phase 4: fingertip jitter | an arrow's tip | the tip is the model's least accurate point [176] | the 1€ filter, forward and backward; H5 |
| phase 4: the Windows path | the Surface, CI | no source says whether the Tasks hand landmarker runs on the win_amd64 wheel's CPU path | H1 on the Surface and CI |
| phase 4: the gesture classifier's licence | the canned labels | unstated on its card [177] | the geometric rule on the Apache 2.0 hand model [176] |
| phase 4: Model Maker unmaintained | new gestures | [175] | new gestures are rules, not trained classifiers |
| shipping assets we may not ship | templates, stickers | [87][98][106][114] | draw our own |
| a filter newer than the Windows floor | any new filter | `CLAUDE.md`; §6.3 | probe; `tests/oldestFfmpeg.test.ts` |
| a face missing on CI | render checks | `/assets` is gitignored and CI draws a fallback face; libass draws Anton at about 0.57 of the canvas painter's size (EFFECTS.md:8361) | graphics are canvas-only, so libass's mismatch does not reach them; render checks must not assume a face |

### 6.2 Licences

- **Settled and not reopened**: three, MediaPipe and the rest of the AI
  helper's pack.
- **Proposed** (all permissive): d3-hierarchy and d3-shape (ISC);
  perfect-freehand, rough.js (MIT); the hand model (Apache 2.0, model card
  [176]); the pose model if ever used (Apache 2.0 [178]); Noto Sans
  Devanagari and Noto Sans Telugu (OFL, BETA.md:367-368). Code copied from
  Motion's spring (MIT [32]) or the 1€ reference (BSD or MIT [165]) keeps
  its notice.
- **Rejected on licence**: the verdicts and their reasons are §4.9's; Cap
  and Recordly (AGPL) are §2.6's.
- **Assets**: marketplace templates are licensed per project [98]; CapCut's
  materials may not be extracted [87]; LottieFiles' free animations may not
  be compiled into a competing service [106]; Animated Noto Emoji are CC BY
  4.0, so attribution would need a place, an open question for commercial
  apps [114]; Fluent Emoji are MIT [115]. The Noto static emoji art's
  licence was cited in a draft without a source and is not claimed here.
- **Unverified**: the gesture classifier's licence [177]; the Holistic
  bundle's FaceMesh card; Superhive's royalty-free terms [118].

### 6.3 Costs

**Bundle.** three is 129 KB gzipped and loaded lazily
(`threeShared.ts:14-23`); every other size is in §4.9's size column. The
proposed additions together come to under 21 KB gzipped where measured
(d3-hierarchy and d3-shape at 5.7 KB each, rough.js under 9 kB by its
README; computed), with perfect-freehand not measured.

**Install.** No new Python wheel (§5.1). One model file on a press:
7,819,105 bytes for the hand landmarker [179], beside the face model's
1,083,786 (`faces.py:67-85`).

**Disk.** PNG frames per graphic under `<clipId>.seq`; a transparent frame's
size is unmeasured (M1).

**Days.** §7.3: 30.5 unconditionally (phases 0-3 and the 1.5-day hand
spike), and 6 for the hand build if the spike passes its gate, against §6's
14.5.

**The Windows ffmpeg floor** (a filter is safe only if merged before
2018-12-17, `CLAUDE.md`):

| filter or option | use here | merged or released | evidence | status |
|---|---|---|---|---|
| `overlay` of a PNG sequence, `format=yuva420p`, `tpad`, opacity keys by `geq` | the rail | `tpad` merged October 2018 (`CLAUDE.md`); the rest older | CLIPS.md:9364-9365 | in CI |
| `overlay` with `alpha=premultiplied` | the raw RGBA path only | committed 2017-12-16 [160] | in the 4.1 docs [159]; present on the Mac build [161] | before the floor; probe the Windows build all the same (M4) |
| `tmix` | motion blur, only if wanted | listed under "version 4.1" in FFmpeg's Changelog; 4.1 released 2018-11-06 [158] | — | before the floor; probe both builds (M4) |
| `perspective` | an ffmpeg alternative for the screen card | listed under "version 2.1" in FFmpeg's Changelog, "ported from libmpcodecs" [158]; 2.1's release date not read, but it precedes 4.1 | measured animating per frame in the bundled build (SHEETS.md:452-458) | before the floor; probe the Windows build (M4) |
| `rawvideo` on `pipe:0` | the raw RGBA path | date not read | the measure scripts already pipe rawvideo into the bundled Mac ffmpeg (EFFECTS §55) | probe on Windows |
| `ebur128` | measuring sound levels only | date not read | — | not emitted in renders |

No filter named in this document was found to postdate the 2018-12-17
floor; the probes stay, as the project's practice is to probe rather than
trust a date.

### 6.4 What this research did not cover

Said plainly so nobody plans on it:

- **Real videos, frame by frame.** No launch film, tutorial, creator video or
  competitor's demo was watched or counted. Every timing is a vendor preset,
  a design token, a tutorial's setting or our arithmetic.
- **Indian creators.** No first-hand production source was found for Dhruv
  Rathee, Think School, any Telugu creator, Fireship (its 2020 workflow
  video was found by its title only, and not read) or ByteByteGo.
  The Hormozi and Ali Abdaal specifics come from vendors selling imitations
  [58][59][60].
- **Platform safe zones at 9:16** (Instagram, TikTok, Shorts): not looked
  up.
- **Timings with no source**: a lower third's hold beyond reading time, a
  before/after wipe, a progress bar; graphics density per minute.
- **Fonts for Indic graphics** beyond Noto Sans Devanagari and Noto Sans
  Telugu (OFL, BETA.md:367-368); **sound assets** beyond
  PLAN.md's decision (the library's own 23 sounds cover hits, sub-drops,
  whooshes and ticks; open packs fill gaps, PLAN.md:1402-1406).
- **How competitors render** (Remotion, Lottie, WebGL); AI motion
  generators that output editable animation (Jitter's AI, LottieFiles,
  HeyGen, Canva, Adobe Express, Premiere's and After Effects' AI features);
  script-to-explainer tools that draw arrows and lines (Vyond, Animaker,
  whiteboard and doodle tools); Wisecut, Clipchamp and Sendshort; Indic
  support in Captions, Vizard, CapCut and Descript, and Submagic's Hindi.
- **Motions with no timing source** (§1.2 rows 33-40): confetti bursts,
  animated icons, a line chart drawing on, a code-terminal reveal, a
  magnifier lens, shape morphs, masked reveals and B-roll placement. The
  web search budget ran out during the fix, so none was searched for.
- **AR platforms** beyond Effect House and Lens Studio.
- **Text in Lottie or Rive files** with Indic scripts; Indic in `three-text`.
- **Rendering platform details**: Chromium's WebGL on Windows through ANGLE
  and Direct3D 11 against Metal on macOS, and their effect on premultiplied
  alpha, MSAA edges and the Mac-against-Surface tolerance; WebGL context loss
  and restore on the one shared renderer; WebGL in an `OffscreenCanvas`
  worker for the bake.
- **Masked reveals** (§1.2 row 39): canvas `clip()` and compositing can
  draw them (inference), but no source timed them.
- **Text behind the subject**: matte quality and cost from the AI helper.
- **Screen footage without cursor data**: whether a cursor can be found from
  pixels.
- **Hands**: how edited (not live) short-form videos use hands; an
  alternative hand-keypoint model, for example an ONNX hand-pose model on
  the ONNX Runtime already in the pack, if henna defeats MediaPipe, with its
  licence and maintenance; the Windows path; graphics passing behind the
  hand (occlusion needs a matte); and the timing of gestures against
  deictic words.

---

## 7. The recommendation

### 7.1 What stays exactly as settled

- **The Director contract.** "The LLM never writes code: it fills fields of
  a type the app defined" (CLIPS.md:7601). A pass is validated whole and
  fails alone; grounding is checked over what the painter actually draws
  (§6.11's property test).
- **§16.7**: graphics above the look, ungraded. **§16.8**: `GraphicSpec`,
  and the old `GraphicsSpec` renamed `CaptionLayersSpec` (the plan says 36
  sites; `grep -w` at HEAD finds 23 `GraphicsSpec` and 56 `buildGraphicsSpec`
  occurrences in `src/` and `tests/`; typecheck guards the rename whichever
  count was meant). **§16.9**: one `SELF_DRAWN_FIELDS` constant, done first.
  **§16.10**: Direct's graphics join `DIRECTOR_RULES`; Clip it's and the
  Transcript tile's have their own Clear. **§16.11**: the validator's
  strictness as written.
- **§6.2's painter's contract, §6.6-6.10, and §6.12's exit bars**, extended
  to the new templates.
- **Before phase 1, re-census §6.3's and §6.4's file:line references.** They
  date from 2026-10-05 and have drifted, for example: `holdFilter`
  `plan.ts:683-686` → `:906`; the image input `:839-851` → `:1083-1101`;
  Preview's removed-clip sweep `:665-667` → `:701-703`; the frame-rate rebake
  `store.ts:1355-1357` → `:1992`; `stackOverlay` `:295` → `:449`;
  `placeCopies` `:4577` → `:5256`; `fillAssetPath` `:1735` → `:2394`;
  `setCaptionStyle` `:4234` → `:4899`; `laneFor` `apply2.ts:513-546` →
  `:538` and `:558`. §6.3 also quotes the moment frames at "20-61 ms" where
  EFFECTS §34's table tops out at 60.

### 7.2 What changes

1. **One engine from the first commit**: the draw list and its two painters
   (§4.3), so 2D, 2.5D and step 6's 3D are one path. It replaces §6.3's
   named plan (CLIPS.md:7708-7718) as follows:
   - `graphics/frame.ts`'s `graphicParams(spec, frame, fps)` and
     `layout(spec, w, h, style)` fold into `drawListAt(spec, style, frame,
     fps, size, measure)`, in a new `graphics/drawList.ts`, with `measure`
     injected as §6.3's `drawGraphicOnto` takes it; `graphicMovingFrames`
     stays in `frame.ts` as written;
   - `graphics/paint.ts`'s `drawGraphicOnto(ctx, spec, style, w, h, {frame,
     fps}, measure)` becomes `paintDrawList2d(ctx, list)` in the same file,
     drawing each text item through `drawTextOnto` verbatim, so it can no
     longer format anything;
   - `strokeAt` (the visible span, the tip and its tangent) is new, in
     `graphics/stroke.ts`;
   - `renderer/src/graphicCanvas.ts` keeps its name and its three jobs.

   **§6.11's property test then reads the `DrawList`'s text items**, the
   strings that will be drawn, in node, with no fake context; one further
   test pins that `paintDrawList2d`'s `fillText` list equals the text
   items, so a painter that reformats a number still fails. That keeps
   §6.11's "grounding runs over what the painter draws" and makes it
   node-pure.
2. **One motion module** (§4.6) in place of the three-ease menu: expo-out by
   default, Material's decelerate and accelerate, standard, out-cubic,
   out-back for the pop only, linear for loops, a closed-form spring.
3. **One stroke primitive** with a riding arrowhead (§4.4), serving the
   callout's arrow and ring, the steps connector, underlines and trees.
4. **Three more template shapes**: `keyword`, `lower-third`, and `steps`
   with a connector or a tree (§4.5).
5. **A dim, sound on the beats under its graphic's Clear rule, and the
   budget** (§4.5).
6. **The three.js compositor, the 2.5D variants and the screen card**,
   pulled forward from step 6 (§4.7).
7. **The hand track**, behind a measured gate (§5).
8. **An Indic render check in the exit bars**, which §6.12
   (CLIPS.md:8256-8266) does not have (§7.3, phases 1 and 2).

### 7.3 The phases

CLIPS does not itemise its 14.5 days; the split of them below is this
document's estimate.

| phase | what | days | of which | exit (summary) |
|---|---|---|---|---|
| 0 | measure the forks | 2 | 0.5 is §6.3's own measurement; 1.5 new | every number in EFFECTS §61 with its command; M22 run; the bake region, pool depth and Indic animation unit chosen |
| 1 | the engine and the motion system | 7.5 | about 5 of §6; 2.5 new | primitives preview = export ≤ 1/255; the Indic render check of the §51 clusters; render check frame-exact on both builds |
| 2 | the templates, the third pass, the validator, sound | 14.5 | about 9 of §6; 5.5 new | §6.12 for nine templates; the Indic render check on every template's fixtures; the sound Clear test; the blind curve rating run; sound levels measured; budget rules tested |
| spike | the hand spike, run during phase 2 (D3) | 1.5 | new; mostly the user's runs | H1-H10, H12 and H13 in EFFECTS §62; the gate passed or failed |
| 3 | the three.js compositor and 2.5D | 5 | 2 moved from step 6's 3D templates; 3 new | flat colour within 2/255; Indic on a texture at 0.000; preview = export; WebGL-missing path tested |
| **unconditional total** | | **30.5** | §6's 14.5 + 2 from step 6 + 14 new | — |
| 4 | the hand build, only if the spike passes its gate | 6 | new | the gate's figures on held-out clips; the line's tip on the marked fingertip |

So step 3 becomes 25.5 days (phases 0-2, with the spike inside phase 2's
weeks) instead of 14.5, phase 3 adds 5 days after it, and step 6's 3D half
falls from 4 days to 2. The plan's total (CLIPS.md:189) grows by 14 days
unconditionally, and by 6 more if the spike passes its gate (computed).

**Phase 0 — measure the forks (2 days; mostly the user's runs).** The
measuring half of `harness/graphicCheck.ts` is written here; then M1, M2,
M3, M5, M22, the Indic and colour parts of M6, and M7 in the harness on the
Mac and the Surface; M4 in CI on both runners. **Exit:** every number in
EFFECTS §61 with its command and machine; recorded in CLIPS §6: the bake
region (canvas or box) and the pool depth, whether any Indic entrance may go
below a word, whether blur-rise is offered, and M22's verdict on the canvas
painter's Indic shaping, with the fallback font each machine resolved. If
M22 finds a cluster unshaped, its cause is found before phase 1 starts: a
fallback font that lacks the script would be cured by D10's bundled fonts;
a shaper that does not run would reopen §4.2's choice of painter
(inference). A filter M4 finds missing on the Windows build is struck, not
worked around.

**Phase 1 — the engine and the motion system (7.5 days).**

- 3a's planned first commits: the §16.8 rename; `SELF_DRAWN_FIELDS` with
  every guard of §6.4, re-censused; `tests/graphicGuards.test.ts` asserting
  membership, its anchors counted with `matchAll`, each site
  mutation-checked.
- `graphics/motion.ts` and the closed-form spring, node-tested (M9).
- `drawListAt`, `paintDrawList2d`, `strokeAt` with the riding arrowhead
  (M8), the `dim` item, per-word text units.
- `renderer/src/graphicCanvas.ts`: preview, bake and export as §6.3, on the
  draw list, with phase 0's bake region and pool.
- `harness/graphicCheck.ts` gains the primitives' checks and the Indic
  render check.

**Exit:** preview equals the baked PNG within 1/255 for a stroke at p = 0,
0.5 and 1, a text entrance and a dim; the last moving frame equals the held
end (mean difference 0) and alpha is 0 outside the box; a fake-context test
shows that no Hindi or Telugu string is drawn in pieces smaller than a word
(or a cluster, if M3 allowed it), mutation-checked by splitting with
`Array.from`; the closed-form spring within M9's tolerance of a frame-stepped
reference; the render check (`tests/integration/graphic.int.test.ts`, the
moment check's pattern) frame-exact on both builds. **And the Indic render
check**, an addition to §6.12, which has none: the EFFECTS §51 clusters (क्ष
त्र ज्ञ श्र कि, క్ష త్ర శ్రీ కి స్త) drawn through `drawTextOnto` and through the
draw list's text item by `paintDrawList2d`, through `graphicCheck.ts` in
the app's own renderer on the Mac and the Surface (§4.10's caution; the
painting needs a DOM canvas, so CI's render checks stand the glyphs in, as
EFFECTS §60 records). Each conjunct is joined: its
advance narrower than the sum of its code points', and its frame different
from the same cluster drawn one code point at a time. The i-matra of कि is
placed first: the per-code-point drawing puts it after its consonant, so
the frames must differ, and the user's eye confirms the whole-drawn frame
against `captions.int`'s `shaping=complex` frame. Mutation-checked: a
painter made to draw per code point must fail it.

**Phase 2 — the templates, the third pass, the validator, sound (14.5
days).**

- §6.2's six templates on the draw list, plus `keyword`, `lower-third`, and
  `steps` with a connector or a tree (§4.5), the tree's parents computed by
  the app; a connector may carry a travelling beam (the stroke's span
  moving, §4.4), once per clip at most, if M1's bake cost allows.
- The graphic style gains the motion names, a stroke look (clean by
  default; a marker through perfect-freehand if M10 passes) and the dim.
- §6.6-6.10 as written, with the new templates in the schema, the menu, the
  baseline and the fixtures, plus `lit`'s `index` mode (§4.5) and the
  nested-enumeration fixtures for the tree.
- Sound on the graphic's beats: the app, never the model, places a pop, a
  tick or a whoosh from the library's own sounds (PLAN.md:1402-1406), under
  a per-clip cap. **Each sound clip and the file it brings carry the
  graphic's own rule, `'director.graphic'` or `'clips.graphic'`, never
  `SOUND_RULE`** (§4.5), so each Clear removes exactly the sounds of the
  graphics it removes; a Clip-it graphic's sound goes on an ordinary audio
  track. This is an addition to §6; §16.10 is unchanged. Placement follows
  [35]: a whoosh peaks on the fastest movement, a landing sound only when
  something visibly stops or appears.
- The budget rules (§4.5).

**Exit:** §6.12's exit unchanged and extended to all nine templates: the
property test over the painter's output (read as the `DrawList`'s text
items, with the painter pinned to them, §7.2) with the adversarial generators
(zero ungrounded, mispaired or de-negated graphics), a truth hit on at least
6 of 10 fixtures, fit of 3/5 or more on at least 8 of 10 blind, the render
check frame-exact at both shapes on both builds, preview equal to export
within 1/255. Plus: M14's blind curve rating run on the user's clips and its
winner made the default; M18's levels recorded, with speech intelligible to
the user under every graphic sound; a test, mutation-checked, that no two
graphics overlap in time and none sits over a zoom punch in any fixture;
M16's reading holds met by every template's longest fixture label. **And
three additions to §6.12:**

- **The Indic render check of phase 1, over every template's Hindi and
  Telugu fixture**, on the Mac and the Surface, mutation-checked the same
  way (a per-code-point painter must fail it).
- **The sound Clear test**, mutation-checked: Direct's Clear leaves a
  Clip-it graphic's sound and its file; Clip it's Clear graphics removes
  them; Direct's Clear removes a Direct graphic's sound and its file. With
  graphic sounds tagged `SOUND_RULE`, the first case fails.
- **The tree**: on the nested-enumeration fixtures, the computed parent
  lists match the expected ones exactly; a property test that every
  computed parent points backwards and there is one root, mutation-checked
  by allowing a forward parent.

**Phase 3 — the three.js compositor and 2.5D (5 days, 2 of them moved from
step 6).**

- `paintDrawList3d` on the shared renderer (§4.3); the 2.5D variants of
  `counter` and `ring` (step 6's 3D ones); tilt, parallax, dolly and focus;
  glow by M7's winner, and the edge sweep (§1.2 row 21) as a stroke span
  running round a card's rounded rectangle, once per clip at most, since it
  bakes its hold.
- The screen-recording card: a tilt-in over its moving frames, then the flat
  clip transform (§4.4).
- `graphicCheck.ts` gains step 6's flat-colour and edge checks (M6) and the
  readback timings (M12).

**Exit:** flat colour through three.js within 2/255 of the 2D painter (CLIPS
§9's bar); the EFFECTS §51 clusters through a `CanvasTexture` at 1:1 at
0.000; preview equals export within 1/255; the same spec baked twice
`framemd5`-equal; the Mac-against-Surface tolerance recorded (M13); with
WebGL missing, 3D dropped with a note and 2D drawn (CLIPS.md:9393), tested;
the screen card legible at 9:16 by the user's eye, its bake cost in EFFECTS
(M20).

**The hand spike (1.5 days, unconditional, run during phase 2; D3).**
H1-H10 and H12-H13 on the user's M1 Pro and the Surface, on the user's
footage, hennaed hands, a low-light reception and a blurred fast point
included; results in EFFECTS §62. **The gate (proposal)**: the landmarker
runs in the worker on both machines; with §5.4's rule and dwell, at least 8
of 10 marked points found and at most one false event a minute on natural
gesturing, measured separately on bare hands in daylight, on hennaed hands,
and on low-light or motion-blurred footage; H9's share recorded. If hennaed
hands or low light fail, pointing ships off by default on wedding footage
with a note, or the work stops at the spike.

**Phase 4 — the hand build (6 days, only if the spike passes its gate).**

- **The build**: a hands mode in the face worker on a
  shared decode (H12); the model press (pinned URL, sha256, 7,819,105
  bytes); a self-test group entry and the pack's `expects`; the raw cache
  track; `src/shared/hands/` (events, the 1€ filter, `tipOnFrame`,
  `pointPlacement`); `Project.hands`; the callout's `anchor` and its validator
  rule; the switch; proposals the user keeps.

**Exit:** the gate's figures on held-out clips; a render check whose
callout line ends on the marked fingertip on its frame; mutation-checked
tests that an event never crosses a shot and that a re-analysis never moves
a placed graphic.

### 7.4 What waits, and for what

Every §1.2 row that no phase builds is here or in §7.5.

| pattern (§1.2 row) | waits for |
|---|---|
| click zoom, cursor smoothing, click ripples, keystrokes, a magnifier lens (11-15, 37) | cursor and click data: a 3dit recorder (its own project) or a cursor finder over pixels (unresearched). No phase planned (D4) |
| the product as the set, the cursor as actor (10, 13) | a designer's rebuild of a product's interface [1][4], which a creator's footage never carries. Not planned |
| grade and grain (32) | nothing: 3dit's looks already carry it (`LOOK_RULE`, `director/apply.ts:42`), and graphics sit above the look, ungraded (§16.7) |
| motion blur on fast moves | phase 2's blind ratings asking for it; then `tmix` (M4) or canvas subframes |
| text behind the subject (27) | a full-clip person matte from the AI helper, with its edge quality measured |
| emoji or hand stickers, Lottie accents, animated icons (28, 34) | an attribution decision for CC BY 4.0 [114], and a determinism check of the player (D11). A check tick drawn on beside a `steps` item needs neither: it is the stroke primitive, a style option after phase 2's ratings |
| per-letter Indic kinetic type, a per-character typewriter (36) | M3. 3dit's own caption typewriter is already per word (`textAnimation.ts:116-123`) |
| a code-terminal reveal (36) | a source of the code's text, which a transcript does not carry; not researched |
| card pop with ripple rings (8) | the energetic style (D5), after phase 2's blind ratings: the rings are the draw list's ring shapes scaling out at low opacity [110], no new item |
| an image or screenshot pop-up card (7) | pictures to put in it: step 5's candidates and cards (CLIPS §8, CLIPS.md:8626) or the user's own. The draw list's `image` item is ready for it; phase 2's `keyword` card is the text pop-up |
| frosted glass behind a card (22) | M5's blur cost, since `ctx.filter` blur over footage is the same cost; the dark ground and panel are style properties in phase 2, and the glow phase 3's |
| masked or wipe text reveals, a marker sweep behind a word (39) | a source that times them (none found, §6.4), then phase 2's ratings: canvas `clip()` draws them (inference) |
| B-roll or a picture over the speaker (40) | step 5, B-roll (CLIPS §8), which places credited cutaways the user clicks |
| camera layouts: the speaker in a corner over a screen, a split, the camera stepping aside in silence (25) | a project of two sources, a screen and a camera, which is a layout of the reframe's kind (step 1's two-up halves, `frameMap.ts:86`) rather than a graphic; not planned, and how 3dit would know a silence for the step-aside was not researched |
| continuous transitions and match cuts (24) | the existing eight transitions (`transitions/registry.ts:296-352`) and the moments' whip and light burn serve the cut; a shape carried across a cut has no automatic source found, so it is not planned |
| an end card with a call to action (31) | for Direct's ad recipes it exists: the Director's end card (`ENDING_RULE`, `director/apply.ts:39-40`). For a talking-head clip, a `user`-mode field (§6.1) for the call to action, not planned in step 3 |
| a line chart drawing on (35) | a template whose validator binds a series of said values in spoken order, as `bars` does; it is the stroke primitive over those values. With step 6's `timeline` (CLIPS §9), not before; no source timed it |
| progress bar or step counter | a timing source (none found, §1.2) and a trigger beyond `steps`; a "2/5" counter could ride on `steps` later |
| before/after wipe | step 6's `before-after` (CLIPS §9), on the same draw list (§4.7) |
| shape morphs (38) | an animator's tool [100]; no automatic route found; not planned |
| confetti or particle bursts (33) | the energetic style (D5), seeded so a burst is deterministic (`seeded()`, `moment.ts:101`); fired by a word, not a gesture |
| two-hand gestures, swipes; counted fingers into `steps`, a thumbs-up or thumbs-down badge, an open-palm reveal (§5.8) | rules on the hand track, after phase 4 passes; two-hand gestures and swipes are outside the canned classifier [177] |
| curves shared with captions and zoom punches | phase 2's ratings, then a migration of the captions' easings as its own change (D9) |

### 7.5 Recommended against

- **Drawing flat graphics through three.js, or making three.js the only
  painter.** Text goes through canvas 2D, the only route in the renderer
  expected to shape Hindi and Telugu (an inference until M22), lines are
  native there, WebGL adds alpha and colour conversions, a dashed `Line2`
  loses its caps, and the encode, not the draw, sets the cost (§4.2).
- **The libraries §4.9 marks reject or hold**, for the reasons given there:
  troika-three-text and drei's `<Text>` (no Indic shaping), GSAP, Remotion,
  Theatre.js, Motion Canvas and Revideo as dependencies, elkjs, Rive, and
  pmndrs postprocessing until its alpha is measured. Whether MSDF or BMFont
  text pipelines could shape Indic was not established either way.
- **Splitting animated text by code point or UTF-16 unit** for Indic scripts,
  including the captions' `bounce` and `wave` as they are today (§4.6, D8).
- **Gesture reactions** (§1.2 row 29): a held hand shape setting off a fixed
  effect is a video-call feature, which "regular body language" sets off
  unasked [192]; for an edited clip the word, not a held pose, is the
  trigger.
- **A spring as the clock for an arrival on a word**, and stateful springs
  anywhere (§1.4, §4.6).
- **The canned Gesture Recognizer as the pointing detector**, and Model
  Maker for new gestures (§5.1).
- **Marketplace templates, CapCut materials or LottieFiles free animations
  shipped as built-in graphics** (§2.3).
- **Stock B-roll, emoji pops and hook-title boilerplate in step 3** (§3.5).
- **A 3dit screen recorder inside step 3**: it is its own project (D4).

### 7.6 The decisions for the user

| # | decision | recommendation |
|---|---|---|
| D1 | Step 3's scope: §6 as written (14.5 days, rated 4) or phases 0-2 (24 days, 25.5 with the hand spike; rated 5.5)? | **Phases 0-2.** The extra 9.5 days buy the motion system, the stroke primitive, three templates that fire without numbers, the dim and the sound: 1.5 of the 2.5 points between §6 and the full plan, three fifths of the distance (computed from ratings that are inference, §0) |
| D2 | 2.5D now, or with step 6? | **Phase 3 directly after phase 2.** It is the three.js engine the request is about, and step 6 then shrinks by 2 days. Step 4 (Best clips) moves 5 days later |
| D3 | Run the hand track's spike? | **Yes, during phase 2**, 1.5 days counted in the unconditional 30.5 (it is mostly the user's run, on the user's machines and footage); pointing only; the 6-day build only if the gate passes; off per clip by default; every pointed graphic a proposal the user keeps. It needs clips with marked points, hennaed hands, a low-light reception and a blurred fast point among them |
| D4 | Is the click-zoom family (screen recordings) in scope? | **Not in step 3.** A screen recording gets the 2.5D card, a dim and graphics. Revisit with a one-day cursor-from-pixels spike only if users bring screen recordings; a recorder of our own is a separate project |
| D5 | The default style: restrained, or energetic? | **Restrained by default** (clean; the direction the reveal sources and the drift away from the 2021 look point), with an energetic style as an option that keeps the `pop` entrance and `out-back` |
| D6 | Sound with graphics? | **Yes**, from the library's own sounds, capped per clip, off per project if wanted; levels from M18. Each sound carries its graphic's Clear rule, not the Director's `SOUND_RULE`, so each Clear removes exactly its own graphics' sounds (§4.5): an addition to §6 that keeps §16.10 |
| D7 | The stroke look? | **Clean vector by default**; a marker look through perfect-freehand as a style option once M10 passes; rough.js not now |
| D8 | Indic kinetic type? | **Per word by default everywhere**; per cluster only for scripts M3 clears. And a separate small fix, outside step 3, so the captions' `bounce` and `wave` fall back to per-word animation for Indic scripts, mutation-checked |
| D9 | Where do the curves live? | **One module, `graphics/motion.ts`, above the graphic style**, read by graphics first; captions and zoom punches migrate after phase 2's ratings |
| D10 | Indic fonts for graphics? | **Decide BETA R14, bundling Noto Sans Devanagari and Noto Sans Telugu (both OFL, BETA.md:367-368), before phase 1's Indic render check**, the exit bar §7.3 names for the §51 clusters, which phase 2's exit extends to every template's Hindi and Telugu fixture. Until then the same graphic draws with whatever fallback each OS resolves, which M22 records; if M22 finds the canvas does not shape a cluster, bundling is no longer optional |
| D11 | Emoji or hand stickers, Lottie accents? | **Not in step 3.** Vendor sources call emoji pops the cheap look [60], and the CC BY attribution question is open |
| D12 | How dense? | **Keep §6.7's spacing for every graphic**, and set an overall per-minute cap from M17's count of clips the user calls pro |

---

## Appendix A. Prices, plans and the recorders, as read

Reference material moved out of §2 and §3: it bears on none of D1-D12.
Prices are as each page showed them when read (2026-10-17 unless the source
is dated).

### A.1 Marketplaces

The licence terms that matter are in §2.3; this is what the plans cost.

| source | prices | source |
|---|---|---|
| Envato Elements | Core $16.50/mo billed annually or $39 monthly; Plus $39/$59; Ultimate $168/$259. The pricing page does not mention .mogrt | [98] |
| Motion Array | Video Templates $15.99/mo annual ($23.99 monthly), Everything $24.99/mo annual ($39.99 monthly), per a third-party review dated 2026-07-30; the official page returned 403 | [99] |
| Motion Design School | courses and After Effects scripts (Super Lines, Motion Tools Pro, Swiss Knife, Super Morphings); prices not read | [100] |

### A.2 Authoring tools

| tool | prices | source |
|---|---|---|
| Jitter | Free (720p, watermarked), Pro $10, Max $21 and Ultra $48 a month, billed annually, per a third-party comparison; Jitter's own page lists no prices | [102] |
| Rive | the blog gives Cadet at $9 a month annual or $17 monthly; the docs list Cadet at $17 per seat a month or $108 per seat a year, with "Exports for runtime" | [103][104] |
| Spline | Free; Hobby $12 a month yearly or $15 monthly; Pro $25/$30; Max $60/$70 per seat | [108] |

### A.3 Screen recorders

| tool | what is automatic | what drives it | platform | price (as read) | licence, release | source |
|---|---|---|---|---|---|---|
| Screen Studio 4.0 | zoom on clicks, cursor smoothing, motion blur, five camera layouts, a click "circle or ripple", a Reel mode that shows "how Instagram's or TikTok's interface would sit on top of your video" | what was done while recording. It can also "Bring in a video from elsewhere and edit it like a recording"; whether auto zoom works on an import is not stated (it needs click data, by inference) | macOS only ("Ventura 13.1 or higher is recommended"); "no near-future plans to add Windows support" | $9/mo yearly, $29/mo monthly | proprietary | [36][37][38] |
| Cursorful | auto zoom and follow-cursor zoom; captions; mic denoise | two or more clicks within 3 s; follow continues while clicks continue | extension for Chrome, Edge and Brave on macOS, Windows and Linux; Mac and Windows desktop | free for non-commercial use; Pro $79 one-time (launch price, listed $119) | proprietary | [43] |
| Tella | auto zoom (Adaptive, Subtle, Moderate, Intense; the tool "was called Zoom until September 2026" and is now Effect), animated cursor, blur and highlight | cursor data | Mac, Windows, web | from $13 a user a month, annual (its own comparison, 2026-09-14) | proprietary | [39][40][41] |
| FocuSee | auto zoom, cursor effects | not stated | Mac, Windows | $49.99/yr or $199.99 lifetime per [41]; third-party listings disagree | proprietary | [41] |
| Cap | Studio Mode: record locally, then backgrounds, zoom segments "auto-generated from clicks", captions; keyboard overlay when captured | clicks, keys | Mac, Windows | from $29/yr, with a free tier [41] | AGPLv3, except the `cap-camera*` and `scap-*` crates under MIT; cap-v0.6.0, 2026-09-15 | [44][45] |
| Loom | "no zoom effects, no automatic zooms" | n/a | Mac, Windows | $18 a user a month | proprietary | [41] |
| OpenScreen | auto zoom, cursor smoothing (Electron and PixiJS) | recorded input | desktop | free | MIT; v1.5.0, 2026-06-06; last push 2026-06-17. Its README says it is archived and no longer maintained and points to a community spin-off; GitHub does not mark it archived | [46] |
| Recordly | zoom suggestions, cursor smoothing, click bounce, motion blur (a fork of OpenScreen) | recorded input | desktop | free | AGPL-3.0 (keeps OpenScreen's MIT notice); v1.4.0, 2026-09-08 | [47] |
| Reframed | auto zoom from click clusters and dwell, Hermite keys, spring smoothing, 120 Hz cursor sampling, 30 click sounds | recorded input | macOS (Swift) | free | MIT; v0.14.7, 2026-04-16 | [48] |
| Kap | a plain recorder; no auto zoom found | none | macOS | free | MIT; 3.6.0 released 2022-10-27, dormant | [53] |
| Camtasia | cursor effects (highlight, magnify, spotlight, smoothing, a kinetic cursor, glow, motion blur and more) and click effects; a Cursor Path Creator for "a video not recorded in Camtasia Editor" | its own recordings; a hand-drawn path otherwise | Mac, Windows | not read | proprietary | [49][50] |

### A.4 The AI editors' prices

| tool | price (as read) | source |
|---|---|---|
| Opus Clip | Free $0, Starter $15/mo, Pro $29/mo, Business custom; stock B-roll 3 clips a month from Starter; Premiere and Resolve export from Pro | [66][67] |
| Agent Opus | not stated | [68] |
| Submagic | Starter $19 ($12 annual), Pro $39 ($23), Business $69 ($41). The pricing page shows auto zooms on a Pro card while the feature page's FAQ says zoom in one click is free, and it contradicts itself on hook titles and templates | [62][63] |
| Captions | Max $24.99/mo (iOS prices) with the AI Edit styles and generated B-roll, music and SFX; Frontier $69.99/mo; an AI Edit costs 10-40 credits | [73][74] |
| Descript | Hobbyist $16/$24, Creator $24/$35 a month (which figure is annual is not stated) | [76][77][78][79] |
| Vizard | Free: 60 credits, 720p; paid prices showed as "$0" placeholders | [80] |
| CapCut | most text templates carry a Pro badge; Pro £21.99/mo or £199.99/yr in the UK, 550 AI credits | [81][82][83] |
| Klap | Pro $29/mo | [89] |
| Gling | not shown | [90] |
| invideo (agent) | credits | [93] |
| Hera | not shown | [95] |
| VEED | Free; Creator EUR 11/22; Pro EUR 23 annual or 47 monthly; Studio EUR 37/76 (as shown to a French visitor) | [91][92] |

---

## 8. Sources

Numbered across all seven research angles. "Accessed" dates are 2026-10-17
unless stated. Repository facts are cited by `file:line` in the text and are
not repeated here.

**Launch films and the people who make them**

- [1] Anh-Tho Chuong, "We killed our motion design job", Lago blog. https://getlago.com/blog/we-killed-our-motion-design-job (2026-07-21)
- [2] Hound Studio, "22 Best Product Launch Videos (2026 Examples + Formulas)". https://hound-studio.com/blog/22-best-product-launch-videos-2026-examples-formulas (undated; view counts "as of October 2026"; accessed)
- [3] a16z speedrun, "How to Make a Viral Launch Video". https://speedrun.substack.com/p/how-to-make-a-viral-launch-video (2025-08-19)
- [4] Cutscene, "Your launch deserves a film". https://cutscene.studio/en (undated, © 2026; accessed)
- [5] Forkoff, "Best Product Launch Videos: Real Examples, Ranked (2026)". https://forkoff.xyz/radar/best-product-launch-videos (published 2026-07-02, updated 2026-09-24)
- [6] Frontend Horse, "The Linear Look". https://frontend.horse/articles/the-linear-look/ (undated, written after February 2024; accessed)
- [7] Jessica Svendsen and Chad Colby, "Crafting the Visual Identity for Config 2024", Figma blog. https://www.figma.com/blog/config-2024-branding/ (2024-07-11)
- [8] Basement Studio, "Behind the Ship". https://basement.studio/post/behind-the-ship (2025-06-04)
- [9] Steve Lemuel, "Kinetic Product Motion for Raycast", Contra (a spec edit, not an official Raycast film). https://contra.com/p/llNMeeMX-kinetic-product-motion-for-raycast-making-a-ui-feel-alive (2026-05-07)
- [10] Rotato, "14 video mockup ideas and examples". https://rotato.app/blog/mockup-video-examples (updated 2021-11-26)
- [11] Keston Collins, "Motion Graphics Trends 2026: The Styles Actually Winning", AutoAE. https://autoae.online/blog/motion-graphics-trends-2026 (2026-06-23)
- [12] ai2.design, "Cursor". https://ai2.design/inspiration/cursor (added 2026-05-16)

**Reference code**

- [13] Magic UI: repository, LICENSE.md, commit list. https://github.com/magicuidesign/magicui ; https://raw.githubusercontent.com/magicuidesign/magicui/main/LICENSE.md ; https://github.com/magicuidesign/magicui/commits/main (latest commit 2026-10-11; no releases or tags; accessed)
- [14] Magic UI, `text-animate.tsx`. https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/text-animate.tsx (accessed)
- [15] Magic UI, `blur-fade.tsx`. https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/blur-fade.tsx (accessed)
- [16] Magic UI, `number-ticker.tsx`. https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/number-ticker.tsx (accessed)
- [17] Magic UI, `animated-beam.tsx`. https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/animated-beam.tsx (accessed)
- [18] Magic UI, `border-beam.tsx`. https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/border-beam.tsx (accessed)
- [19] AbubakrChan, product-launch-motion: repository, NOTICE, releases. https://github.com/AbubakrChan/product-launch-motion ; https://raw.githubusercontent.com/AbubakrChan/product-launch-motion/main/NOTICE ; https://github.com/AbubakrChan/product-launch-motion/releases (v2.0.0 dated 12 Oct, 2026 by its LICENSE; latest commit 2026-10-15; accessed)
- [20] product-launch-motion, `references/technique.md` (main, edited after v2.0.0). https://raw.githubusercontent.com/AbubakrChan/product-launch-motion/main/references/technique.md (accessed)

**Motion systems, easing, reading time, sound**

- [21] Apple, WWDC23, "Animate with springs". https://developer.apple.com/videos/play/wwdc2023/10158/ (June 2023)
- [22] Apple, Human Interface Guidelines, "Motion" (read through its JSON). https://developer.apple.com/design/human-interface-guidelines/motion ; https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json (change log latest 2025-09-09)
- [23] Flutter, `packages/flutter/lib/src/material/motion.dart` (Material 3 durations and easing). https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/motion.dart (master; accessed)
- [24] AndroidX, Compose Material 3 `MotionTokens.kt` (VERSION v0_103). https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt (accessed)
- [25] easings.net source, `easingsFunctions.ts`. https://raw.githubusercontent.com/ai/easings.net/master/src/easings/easingsFunctions.ts (accessed)
- [26] IBM Carbon Design System, "Motion overview". https://carbondesignsystem.com/elements/motion/overview/ (updated 2026-08-12)
- [27] Jitter Help, "Fix robotic animations with the right easing curve". https://help.jitter.video/en/articles/16072578-fix-robotic-animations-with-the-right-easing-curve (2026-07-31)
- [28] Bartek, "Best YouTube Editing Styles 2026", Olaf Motion. https://olafmotion.com/trends-inspiration/best-youtube-editing-styles-2026/ (2026-02-17)
- [29] Remotion docs, `spring()`. https://www.remotion.dev/docs/spring (accessed)
- [30] Remotion, `packages/core/src/spring/spring-utils.ts`. https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/core/src/spring/spring-utils.ts (accessed)
- [31] Motion docs, "spring". https://motion.dev/docs/spring (accessed)
- [32] Motion source, `packages/motion-dom/src/animation/generators/spring.ts`. https://raw.githubusercontent.com/motiondivision/motion/main/packages/motion-dom/src/animation/generators/spring.ts (accessed)
- [33] Netflix, "English (USA) Timed Text Style Guide". https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide (change log latest 2025-12-19)
- [34] SSW Rules, "Do you give enough time to read texts in your videos?". https://www.ssw.com.au/rules/post-production-do-you-give-enough-time-to-read-texts-in-your-videos (last updated 2026-10-16)
- [35] Sonilo Editorial Team, "Whoosh sound effect guide". https://sonilo.com/ai-music/whoosh-sound-effect-guide (2026-08-21)

**Screen recorders and tutorial tools**

- [36] Screen Studio, home page. https://screen.studio/ (undated, © 2026, "Screen Studio 4.0"; accessed)
- [37] Screen Studio guide, "Auto zoom". https://screen.studio/guide/auto-zoom (undated; accessed)
- [38] Screen Studio guide, "Animations". https://www.screen.studio/guide/animations (undated; accessed)
- [39] Tella Help, "Add a zoom". https://www.tella.com/help/editing/add-a-zoom.md (undated; mentions a September 2026 rename; accessed)
- [40] Tella Help, "Blurring and highlighting". https://www.tella.com/help/editing/blurring-and-highlighting.md (undated; accessed)
- [41] Tella, "Best Screen Recorders With Automatic Zooms and Hosted Sharing (2026)" (the vendor's own comparison). https://www.tella.com/blog/best-screen-recorders-with-automatic-zooms-and-hosted-sharing (2026-09-14)
- [42] Tella, "Add zooms" skill. https://www.tella.com/skills/add-zooms (undated, © 2026; accessed)
- [43] Cursorful, home page. https://cursorful.com/ (accessed)
- [44] Cap documentation, `llms-full.txt` (desktop 0.5.3). https://cap.so/llms-full.txt (undated; accessed)
- [45] CapSoftware/Cap: repository and LICENSE. https://github.com/CapSoftware/Cap ; https://raw.githubusercontent.com/CapSoftware/Cap/main/LICENSE (cap-v0.6.0, 2026-09-15; accessed)
- [46] OpenScreen: repository and API metadata. https://github.com/siddharthvaddem/openscreen ; https://api.github.com/repos/siddharthvaddem/openscreen (v1.5.0, 2026-06-06; last push 2026-06-17; accessed)
- [47] Recordly, LICENSE.md. https://raw.githubusercontent.com/webadderall/Recordly/main/LICENSE.md (v1.4.0, 2026-09-08; accessed)
- [48] Reframed, repository. https://github.com/jkuri/reframed (v0.14.7, 2026-04-16; accessed)
- [49] TechSmith, Camtasia, "Cursor effects". https://www.techsmith.com/learn/tutorials/camtasia/cursor-effects/ (undated; accessed)
- [50] TechSmith, Camtasia, "Add arrows, shapes & callouts". https://www.techsmith.com/learn/tutorials/camtasia/annotations/ (undated; accessed)
- [51] KeyCastr, repository. https://github.com/keycastr/keycastr (v0.11.1, 2026-09-07; accessed)
- [52] Carnac, GitHub API metadata. https://api.github.com/repos/Code52/carnac (MS-PL; 2.3.13, 2020-06-20; last push 2023-02-17; accessed)
- [53] Versio.io, Kap release lifecycle. https://www.versio.io/en/product-release-end-of-life-eol-wulkano-kap.html (page updated 2026-10-15; Kap 3.6.0 released 2022-10-27)
- [54] Jason Boone, "Create a callout graphic in After Effects", PremiumBeat. https://www.premiumbeat.com/blog/create-callout-graphic-after-effects/ (2018-12-20)
- [55] Jitter, "Simple Notification [iOS]" template. https://jitter.video/template/simple-notification-ios/ (undated; accessed)
- [56] excalidraw-animate: repository and library types. https://github.com/dai-shi/excalidraw-animate ; https://unpkg.com/excalidraw-animate@0.7.2/dist/library.d.ts (0.7.2, 2026-04-24; accessed)
- [57] GIGAZINE, on how Kurzgesagt makes a video. https://gigazine.net/gsc_news/en/20200217-science-animation-making/ (2020-02-17)

**Talking-head looks and the AI editors**

- [58] Choppity, "Re-create the Alex Hormozi video editing style". https://www.choppity.com/tools/recreate-video-editing-style/alex-hormozi/ (undated; accessed)
- [59] Choppity, "Re-create the Ali Abdaal video editing style". https://www.choppity.com/tools/recreate-video-editing-style/ali-abdaal/ (undated; accessed)
- [60] Joyspace, "Alex Hormozi Video Editing Style: Does It Still Work in 2026?" (a vendor blog). https://joyspace.ai/hormozi-editing-style-2026-analysis (2025-12-10)
- [61] FireCut, "How to Zoom In on Premiere Pro: A Step-by-Step Guide for Beginners". https://firecut.ai/blog/how-to-zoom-in-on-premiere-pro-a-step-by-step-guide-for-beginners/ (2026-05-06)
- [62] Submagic, "Auto zooms". https://submagic.co/features/auto-zooms (undated, © 2026; accessed)
- [63] Submagic, "Pricing". https://www.submagic.co/pricing (undated; accessed)
- [64] Submagic Help, "New 52 languages support". https://care.submagic.co/en/article/new-52-languages-support-1qo3r75 (updated 2026-09-30)
- [65] Alex Morgan, "Submagic Review 2026", UCStrategies. https://ucstrategies.com/news/submagic-review-2026-pricing-features-is-it-worth-it-for-creators/ (2026-03-27)
- [66] OpusClip, "Pricing". https://www.opus.pro/pricing (undated; accessed)
- [67] OpusClip, "AI B-Roll generator". https://www.opus.pro/ai-b-roll (undated; accessed)
- [68] OpusClip, "AI Motion Graphics Generator" (Agent Opus). https://www.opus.pro/agent/workflows/ai-motion-graphics-generator (undated; accessed)
- [69] OpusClip Help, "Does OpusClip support Hindi?"; OpusClip home page (its language list). https://help.opus.pro/docs/article/does-opusclip-support-hindi ; https://www.opus.pro/ (both undated; accessed)
- [70] Marc Andrews, "Opus Clip Review 2026: AI Video Shorts Tool Tested". https://marcandrews.com/opus-clip-review-2026-ai-video-shorts-tool-tested/ (published 2026-04-24; the page says both "updated 2026-08-05" and "Updated October 2026")
- [71] Captions, "Find your video style with AI Edit". https://captions.ai/blog-post/introducing-ai-edit (published 2025-12-23, updated 2026-06-08)
- [72] Captions, "Edit with AI". https://captions.ai/features/edit-with-ai (undated, © 2026 NOCAP, Inc. d/b/a Captions; accessed)
- [73] Captions, "Pricing" (iOS plans). https://www.captions.ai/pricing (undated; accessed)
- [74] Captions Help, AI usage and credits. https://captions.ai/help/docs/ai-usage (accessed)
- [75] Ivan Mehta, launch report on Captions' AI Edit, TechCrunch. https://techcrunch.com/?p=2801370 (2024-06-26)
- [76] Descript Help, "Underlord (beta): Your AI co-editor in Descript". https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript (undated; accessed)
- [77] Ashley Hamer Pritchard, "Underlord AI can watch videos", Descript. https://www.descript.com/blog/article/underlord-ai-can-watch-videos (updated 2026-07-29)
- [78] Descript changelog, "Release roundup—August 21st, 2025". https://feedback.descript.com/changelog/release-roundupaugust-21st-2025 (2025-08-21)
- [79] Descript, "Underlord". https://descript.com/underlord (accessed)
- [80] Vizard, "Pricing". https://vizard.ai/pricing (undated; accessed)
- [81] CapCut Help, "What Is Auto Cut in CapCut?". https://www.capcut.com/help/auto-cut-in-capcut (2026-02-03)
- [82] Marc Andrews, "CapCut AI Features Review 2026". https://marcandrews.com/?p=3178 (published 2026-05-05; the page says both "updated 2026-07-20" and "Updated October 2026")
- [83] Miracamp, "Motion Tracking in CapCut: Complete Guide for Creators". https://www.miracamp.com/learn/capcut/motion-tracking (undated, © 2025; accessed)
- [84] CapCut, "Camera Tracking from Beginner to Pro". https://www.capcut.com/resource/motion-camera-tracking (2026-08-27)
- [85] CapCut, "How to Put Text Behind a Person Using CapCut for Free in 2026". https://www.capcut.com/resource/how-to-put-text-behind-a-person-in-capcut (2026-09-17)
- [86] CapCut, "How to Make a CapCut Template" and "Why can't I find the AI effects/templates I used before?". https://www.capcut.com/resource/how-to-make-a-capcut-template ; https://www.capcut.com/help/ai-templates-and-effects (template page 2026-10-10; help page accessed)
- [87] CapCut, Materials License Agreement. https://www.capcut.com/clause/material-license-agreement (last updated 2026-01-22)
- [88] Wikipedia, "CapCut". https://en.wikipedia.org/wiki/CapCut (accessed 2026-10-17 by a fact-checker; not re-read for this document)
- [89] Klap, home page. https://klap.app/ (undated; accessed)
- [90] Gling, home page. https://www.gling.ai/ (undated, © 2026; accessed)
- [91] VEED, "Pricing". https://www.veed.io/pricing (undated, © 2026; accessed)
- [92] Dupple, "Veed pricing". https://dupple.com/pricing/veed (updated 2026-10-14)
- [93] invideo, "Can AI add sound design to motion graphics and UI animations?". https://invideo.io/faq/can-ai-add-sound-design-to-motion-graphics-and-ui-animations/ (updated 2026-09-25)
- [94] Tom Langridge, "Pictory AI Review 2026", Fast.io (quoting Wyzowl's review). https://www.fast.io/resources/pictory-ai-review-2026.md (last reviewed 2026-06-29)
- [95] Y Combinator, Hera: company page and launch. https://www.ycombinator.com/companies/hera-video ; https://www.ycombinator.com/launches/Nwh-hera-your-ai-motion-designer (Summer 2025 batch; accessed)

**Templates, authoring tools and assets**

- [96] Jarle Leirpoll, "The Complete MOGRT Guide for After Effects 2024", Frame.io Insider. https://blog.frame.io/2024/08/12/mogrt-guide-after-effects-2024-motion-graphics-workflow/ (2024-08-12)
- [97] Adobe Community, "Add the ability to keyframe an imported After Effects mogrt" (reply by Dacia Saenz, AE and PR engineering). https://community.adobe.com/t5/premiere-pro-ideas/add-the-ability-to-keyframe-an-imported-after-effects-mogrt/m-p/13967772 (2023-07-27)
- [98] Envato Elements, "Pricing". https://elements.envato.com/pricing (accessed)
- [99] Photutorial, "Motion Array pricing". https://photutorial.com/motion-array-pricing (2026-07-30)
- [100] Motion Design School, home page. https://motiondesign.school/ (accessed)
- [101] Jitter, product page. https://jitter.video/product/ (accessed)
- [102] LottieFiles, "Best Motion Design Tools in 2026: Ranked by Use Case". https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case (2026-07-01)
- [103] Rive, "Rive's new $9/mo plan". https://rive.app/blog/rive-s-new-9-mo-plan (2025-10-20)
- [104] Rive docs, "Pricing". https://rive.app/docs/account-admin/pricing (undated; accessed)
- [105] Rive docs, web low-level API; rive-wasm, `rive_advanced.mjs.d.ts`. https://rive.app/docs/runtimes/web/low-level-api-usage ; https://raw.githubusercontent.com/rive-app/rive-wasm/master/js/src/rive_advanced.mjs.d.ts (accessed)
- [106] LottieFiles Help, "Animation licensing basics". https://help.lottiefiles.com/animation-licensing-basics- (2026-01-16)
- [107] airbnb/lottie, `supported-features.md`. https://raw.githubusercontent.com/airbnb/lottie/master/supported-features.md (accessed)
- [108] Spline, "Pricing". https://spline.design/pricing (accessed)
- [109] Spline docs, "Exporting as code". https://docs.spline.design/exporting-your-scene/web/exporting-as-code (accessed)
- [110] Harsh Kapoor, "Master SaaS Motion Graphics in 30 Minutes — 2026 Guide", DEmotion (a vendor blog retelling a TomsProject tutorial). https://trydemotion.com/blog/master-saas-motion-graphics (2026-04-26)
- [111] Envato Elements, "Hand Gestures Pack for Premiere Pro" (FX_Monster). https://elements.envato.com/hand-gestures-pack-for-premiere-pro-T43DDKU (accessed)
- [112] ProductionCrate, "Animated Hand Gestures – Extension for After Effects". https://news.productioncrate.com/animated-hand-gestures-extension-for-after-effects/ (2019-01-09)
- [113] FreeVisuals, "Free Gacha Green Screen Overlay Index Finger". https://www.freevisuals.net/item/free-gacha-green-screen-overlay-index-finger (accessed)
- [114] Google Fonts, Noto Emoji files and the animated set's index. https://googlefonts.github.io/noto-emoji-files/ ; https://googlefonts.github.io/noto-emoji-animation/data/api.json (accessed)
- [115] microsoft/fluentui-emoji, repository; I Programmer, "Microsoft Opens Up Its Emojis". https://github.com/microsoft/fluentui-emoji ; https://www.i-programmer.info/news/136-open-source/15643-microsoft-opens-up-it-emojis.html (article 2022-08-12; repository accessed)
- [116] Boris FX, Mocha quick start guide. https://borisfx.com/documentation/mocha/quick-start-guide (undated; accessed)
- [117] Snap, Lens Studio 5, "Hand Joints". https://developers.snap.com/lens-studio/features/ar-tracking/hand/hand-tracking-templates/hand-joints (accessed)
- [118] Superhive Market, "Rigged 3D Hand Pack – 10 Expressive Poses". https://superhivemarket.com/products/rigged-3d-hand-pack--10-expressive-poses--game-ready-high-quality-human-hand-model (accessed)
- [119] BlenderNation, "Cartoon hand rig free download". https://www.blendernation.com/2022/09/01/carrtoon-hand-rig-free-download/ (2022-09-01)

**Libraries and the web platform**

- [120] deps.dev version entries, one per package: the version, its `publishedAt`, `isDefault` (true for every one: each is the package's current default version) and `licenses`; all read 2026-10-17. The base is https://api.deps.dev/v3/systems/npm/packages/ followed by the path given:
  - `three/versions/0.186.1`: 2026-09-24, MIT
  - `d3-hierarchy/versions/3.1.2`: 2022-04-02, ISC
  - `d3-shape/versions/3.2.0`: 2022-12-20, ISC
  - `perfect-freehand/versions/1.2.3`: 2026-02-01, MIT
  - `roughjs/versions/4.6.6`: 2023-11-20, MIT
  - `%40dagrejs%2Fdagre/versions/3.1.1`: 2026-08-08, MIT
  - `elkjs/versions/0.12.0`: 2026-07-17, EPL-2.0 OR GPL-3.0-or-later
  - `bezier-easing/versions/3.2.0`: 2026-10-07, MIT
  - `motion-dom/versions/14.3.0`: 2026-10-15, MIT
  - `1eurofilter/versions/1.3.0`: 2026-02-15, BSD-3-Clause
  - `postprocessing/versions/6.39.5`: 2026-09-09, Zlib; its peer range, `three` `>= 0.168.0 < 0.187.0`, from https://registry.npmjs.org/postprocessing/6.39.5
  - `troika-three-text/versions/0.52.5`: 2026-07-24, MIT
  - `three-text/versions/0.6.5`: 2026-07-04, MIT
  - `harfbuzzjs/versions/1.6.3`: 2026-10-06, MIT
  - `meshline/versions/3.3.1`: 2024-06-03, MIT
  - `three.meshline/versions/2.0.0`: 2026-10-13, MIT
  - `%40lottiefiles%2Fdotlottie-web/versions/0.81.0`: 2026-10-06, MIT
  - `lottie-web/versions/5.13.0`: 2025-05-21, MIT
  - `%40rive-app%2Fcanvas/versions/2.44.2`: 2026-10-10, MIT
  - `gsap/versions/3.15.0`: 2026-04-13, "non-standard" (the licence is [137])
  - `%40theatre%2Fcore/versions/0.7.2`: 2024-05-19, Apache-2.0
  - `%40theatre%2Fstudio/versions/0.7.2`: 2024-05-19, AGPL-3.0-only
  - `%40motion-canvas%2Fcore/versions/3.17.2`: 2024-12-14, MIT
  - `%40revideo%2Fcore/versions/0.11.0`: 2026-07-10, MIT
  - `remotion/versions/4.0.536`: 2026-10-16, "non-standard" (the licence is [144])
  - `excalidraw-animate/versions/0.7.2`: 2026-04-24, no licence listed (its MIT is from the repository, [56])
- [121] GitHub REST API repository entries: `pushed_at` and `open_issues_count` (which counts open pull requests too), all read 2026-10-17. The base is https://api.github.com/repos/ followed by:
  - `steveruizok/perfect-freehand`: last push 2026-04-13; MIT
  - `rough-stuff/rough`: last push 2024-07-28; MIT
  - `airbnb/lottie-web`: last push 2025-09-01; 858 open; MIT
  - `protectwise/troika`: last push 2026-07-24; 93 open; MIT
  - `theatre-js/theatre`: last push 2024-08-14; Apache-2.0 (the repository's licence; the studio package is AGPL, [120])
- [122] Bundlephobia size API, minified and gzipped, one entry per package, all read 2026-10-17. The base is https://bundlephobia.com/api/size?package= followed by:
  - `d3-hierarchy@3.1.2`: 5,651 B
  - `d3-shape@3.2.0`: 5,657 B
  - `@dagrejs/dagre@3.1.1`: 15,755 B
  - `elkjs@0.12.0`: 433,378 B
  - `postprocessing@6.39.5`: 112,609 B
  - `troika-three-text@0.52.5`: 44,594 B
  - `meshline@3.3.1`: 3,722 B
  - `lottie-web@5.13.0`: 76,789 B
  - `gsap@3.15.0`: 27,350 B
  - `@theatre/core@0.7.2`: 31,428 B
- [123] three.js docs, LineMaterial. https://threejs.org/docs/pages/LineMaterial.html (accessed)
- [124] three.js r186, `examples/jsm/lines/LineMaterial.js`. https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/lines/LineMaterial.js (r186)
- [125] three.js docs, InstancedBufferGeometry. https://threejs.org/docs/pages/InstancedBufferGeometry.html (accessed)
- [126] three.js docs, WebGLRenderer. https://threejs.org/docs/pages/WebGLRenderer.html (accessed)
- [127] Don McCurdy, "Updates to Color Management in three.js r152". https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791 (2023-04-24)
- [128] three.js docs, SVGLoader. https://threejs.org/docs/pages/SVGLoader.html (accessed)
- [129] three.js docs, AnimationMixer. https://threejs.org/docs/pages/AnimationMixer.html (accessed)
- [130] three.js r186, `examples/jsm/postprocessing/UnrealBloomPass.js`, and its commits "UnrealBloomPass: Fix alpha handling. (#32517)" and "UnrealBloomPass: Use premultiplied alpha and additive blending (#32521)". https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/postprocessing/UnrealBloomPass.js ; https://api.github.com/repos/mrdoob/three.js/commits?path=examples/jsm/postprocessing/UnrealBloomPass.js (commits 2025-12-09)
- [131] protectwise/troika issues: #303 "Indic shaping" (opened 2024-01-30, open), #91 HarfBuzz wasm (2020-12-04, open), #283 glyph decomposition (2023-10-11, open). https://github.com/protectwise/troika/issues/303 (accessed)
- [132] troika-three-text documentation. https://protectwise.github.io/troika/troika-three-text/ (accessed)
- [133] pmndrs/drei, `src/core/Text.tsx`. https://raw.githubusercontent.com/pmndrs/drei/master/src/core/Text.tsx (accessed)
- [134] three-text: README and registry entry. https://github.com/countertype/three-text ; https://registry.npmjs.org/three-text/0.6.5 (0.6.5, 2026-07-04)
- [135] harfbuzzjs, LICENSE. https://raw.githubusercontent.com/harfbuzz/harfbuzzjs/main/LICENSE (1.6.3, 2026-10-06; accessed)
- [136] pmndrs/postprocessing, README. https://github.com/pmndrs/postprocessing (accessed)
- [137] GSAP, Standard "No Charge" License. https://gsap.com/community/standard-license/ (effective 2025-04-30; last modified 2025-05-30)
- [138] GSAP, "Pricing". https://gsap.com/pricing/ (accessed)
- [139] airbnb/lottie-web, README. https://github.com/airbnb/lottie-web (accessed)
- [140] LottieFiles/dotlottie-web: README and `packages/web/src/dotlottie.ts`. https://github.com/LottieFiles/dotlottie-web ; https://raw.githubusercontent.com/LottieFiles/dotlottie-web/main/packages/web/src/dotlottie.ts (0.81.0, 2026-10-06; accessed)
- [141] motion-canvas/motion-canvas: releases and commits. https://github.com/motion-canvas/motion-canvas/releases ; https://api.github.com/repos/motion-canvas/motion-canvas/commits?per_page=5 (accessed)
- [142] Motion Canvas API, "Line". https://motion-canvas.io/api/2d/components/Line (accessed)
- [143] Motion Canvas docs, "Rendering". https://motion-canvas.io/docs/rendering (accessed)
- [144] Remotion, LICENSE.md. https://github.com/remotion-dev/remotion/blob/main/LICENSE.md (accessed)
- [145] Remotion, "License FAQ". https://www.remotion.dev/docs/license/faq (accessed)
- [146] Revideo: `@revideo/core` on deps.dev; midrender/revideo. https://api.deps.dev/v3/systems/npm/packages/%40revideo%2Fcore ; https://github.com/midrender/revideo (0.11.0, 2026-07-10)
- [147] theatre-js/theatre: repository and LICENSE. https://github.com/theatre-js/theatre ; https://raw.githubusercontent.com/theatre-js/theatre/main/LICENSE (accessed)
- [148] PyPI, manim. https://pypi.org/project/manim/ (0.22.0, 2026-10-08)
- [149] dagrejs/dagre, README. https://github.com/dagrejs/dagre (accessed)
- [150] d3-shape, "Links". https://d3js.org/d3-shape/link (accessed)
- [151] kieler/elkjs, LICENSE.md. https://raw.githubusercontent.com/kieler/elkjs/master/LICENSE.md (accessed)
- [152] MDN, Path2D. https://developer.mozilla.org/en-US/docs/Web/API/Path2D (last modified 2026-08-12)
- [153] MDN, `CanvasRenderingContext2D.lineDashOffset`. https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineDashOffset (last modified 2026-08-12)
- [154] W3C, Portable Network Graphics (PNG) Specification, Third Edition, §6.2. https://www.w3.org/TR/png-3/ (2025-06-24)
- [155] Electron, "Offscreen Rendering". https://electronjs.org/docs/latest/tutorial/offscreen-rendering (accessed)
- [156] WebKit bug 235002, "readPixels directly to ArrayBuffer has very high CPU usage". https://bugs.webkit.org/show_bug.cgi?id=235002 (2022-01-08)
- [157] Chromium code review 957473003, "Optimize complex text shaping". https://codereview.chromium.org/957473003/ (2015-03-04)
- [158] FFmpeg, Changelog on `release/4.1`. https://raw.githubusercontent.com/FFmpeg/FFmpeg/release/4.1/Changelog (FFmpeg 4.1 released 2018-11-06, per ffmpeg.org's news)
- [159] FFmpeg 4.1 filter documentation, "overlay" (mirror). https://ayosec.github.io/ffmpeg-filters-docs/4.1/Filters/Video/overlay.html (accessed)
- [160] FFmpeg commit d29f784a54, "avfilter/vf_overlay: add premultiplied alpha mode". https://api.github.com/repos/FFmpeg/FFmpeg/commits?path=libavfilter/vf_overlay.c&since=2017-11-25T00:00:00Z&until=2018-02-28T00:00:00Z (authored 2017-08-01, committed 2017-12-16)
- [161] Local probe of the bundled macOS ffmpeg: `node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg -hide_banner -h filter=overlay` (run 2026-10-17)
- [162] Keaton Mowery and Hovav Shacham, "Pixel Perfect: Fingerprinting Canvas in HTML5", W2SP 2012. https://www.ieee-security.org/TC/W2SP/2012/papers/w2sp12-final4.pdf (2012; its text could not be extracted)
- [163] rough.js: repository, registry, and the 4.6.6 package's `bin/math.js`. https://github.com/rough-stuff/rough ; https://registry.npmjs.org/roughjs ; https://unpkg.com/roughjs@4.6.6/bin/math.js (4.6.6, 2023-11-20)
- [164] perfect-freehand: repository and registry. https://github.com/steveruizok/perfect-freehand ; https://registry.npmjs.org/perfect-freehand (1.2.3, 2026-02-01)
- [165] Géry Casiez, Nicolas Roussel and Daniel Vogel, "1€ Filter" project page. https://gery.casiez.net/1euro/ (undated; accessed)
- [166] npm registry, 1eurofilter. https://registry.npmjs.org/1eurofilter (1.3.0, 2026-02-15)

**Unicode and Indic text**

- [167] W3C, Devanagari Layout Requirements. https://w3c.github.io/iip/devanagari/ (undated; accessed)
- [168] W3C public-i18n-archive, grapheme clusters before and after Unicode 15.1. https://lists.w3.org/Archives/Public/public-i18n-archive/2025JanMar/0197.html (2025-02-03)
- [169] Unicode, UAX #29 "Unicode Text Segmentation", revision 49 (Unicode 18.0.0). https://www.unicode.org/reports/tr29/ (2026-09-01)
- [170] Unicode Character Database, `DerivedCoreProperties.txt` (Indic_Conjunct_Break). https://www.unicode.org/Public/UCD/latest/ucd/DerivedCoreProperties.txt (accessed)

**MediaPipe and hand tracking**

- [171] Google AI Edge, "Gesture recognition task guide". https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer (last updated 2026-10-01)
- [172] Google AI Edge, "Hand landmarks detection guide". https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker (last updated 2026-10-01)
- [173] Google AI Edge, "Gesture recognition guide for Python". https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/python (last updated 2026-10-09)
- [174] Google AI Edge, "Pose landmark detection guide". https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker (last updated 2026-10-09)
- [175] Google AI Edge, "Hand gesture recognition model customization guide" (Model Maker); PyPI, mediapipe-model-maker. https://developers.google.com/edge/mediapipe/solutions/customization/gesture_recognizer ; https://pypi.org/pypi/mediapipe-model-maker/json (guide updated 2026-06-05; 0.2.1.4, 2024-04-22)
- [176] Model Card: Hand Tracking (Lite/Full) with Fairness. https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf (October 2021)
- [177] Model Card: Hand Gesture Classification with Fairness. https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf (PDF created 2022-11-07)
- [178] Model Card: BlazePose GHUM 3D. https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf (accessed)
- [179] HTTP HEAD responses (Content-Length, Last-Modified, x-goog-hash) for the hand_landmarker, gesture_recognizer, pose_landmarker and holistic_landmarker files under https://storage.googleapis.com/mediapipe-models/ (read 2026-10-17)
- [180] MediaPipe Hands, legacy solution docs. https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md (legacy since 2023-03-01; accessed)
- [181] Zhang et al., "MediaPipe Hands: On-device Real-time Hand Tracking", arXiv:2006.10214. https://arxiv.org/abs/2006.10214 (2020-06-18)
- [182] Valentin Bazarevsky and Fan Zhang, "On-Device, Real-Time Hand Tracking with MediaPipe", Google Research blog. https://research.google/blog/on-device-real-time-hand-tracking-with-mediapipe/ (2019-08-19)
- [183] google-ai-edge/mediapipe, `landmarks_smoothing_calculator.proto`. https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/landmarks_smoothing_calculator.proto (accessed)
- [184] google-ai-edge/mediapipe issue #6107, "Mediapipe Hand Model Detection (Filter/non filter)". https://github.com/google-ai-edge/mediapipe/issues/6107 (the reply quoted, 2025-10-01)
- [185] google-ai-edge/mediapipe release v1.1.0; mediapipe on PyPI. https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.0 ; https://pypi.org/project/mediapipe/ (v1.1.0 on GitHub 2026-10-07; 1.1.1 on PyPI 2026-10-14; 0.10.35 on PyPI 2026-04-27)
- [186] Bamani et al., "Real-time Human Finger Pointing Recognition and Estimation for Robot Directives Using a Single Web-Camera", arXiv:2307.02949v2. https://arxiv.org/html/2307.02949v2 (v2 2025-10-09)
- [187] Amprimo et al., "Hand tracking for clinical applications: validation of the Google MediaPipe Hand (GMH) and the depth-enhanced GMH-D frameworks", arXiv:2308.01088. https://arxiv.org/abs/2308.01088 (2023-08-02)
- [188] Jian Liao, Adnan Karim, Shivesh Jadon, Rubaiat Habib Kazi and Ryo Suzuki, "RealityTalk", UIST 2022, arXiv:2208.06350. https://arxiv.org/html/2208.06350 (2022-08-12)

**Gesture-triggered effects in shipping products**

- [189] Apple Support 105117, video effects and reactions in video calls on Mac. https://support.apple.com/105117 (published 2025-12-12)
- [190] Apple, Mac User Guide, "Use video conferencing features". https://support.apple.com/guide/mac-help/mchlff01c919 (undated, macOS 27 guide; accessed)
- [191] Dennis Sellers, "How to use gesture reactions in video calls in macOS Sonoma", OWC Rocket Yard. https://eshop.macsales.com/blog/87441-how-to-use-gesture-reactions-in-video-calls-in-macos-sonoma/ (2024-06-24)
- [192] Cornell IT, "Gesture Recognition in Zoom". https://it.cornell.edu/zoom/gesture-recognition-zoom (undated; screenshots January 2024; accessed)
- [193] TikTok Effect House, "Gesture Detection" node. https://effecthouse.tiktok.com/learn/guides/editor-panels/visual-scripting/nodes/hand/gesture-detection (undated; accessed)
- [194] TikTok Effect House, "Hand Tracker". https://effecthouse.tiktok.com/learn/guides/workspace/objects/ar-tracking/hand-tracker (undated; accessed)
- [195] TikTok Effect House, "Hand Gesture" template tutorial. https://effecthouse.tiktok.com/learn/guides/tutorials/template-tutorials/hand-gesture (undated; accessed)
- [196] TikTok Effect House, "Hand Info" node. https://effecthouse.tiktok.com/learn/guides/visual-scripting/nodes/hand/hand-info (undated; accessed)
- [197] BytePlus Effects, "Gesture detection". https://docs.byteplus.com/effects/docs/gesture-detection (last updated 2024-03-18)
