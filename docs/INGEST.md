# Ingest — getting media in from a link

Sheets ⑥ and ⑫, built as one thing: paste a link, pick what you want, get a clip
on the timeline. `SHEETS.md` called this "the largest single hole, and upstream
of everything that already works" — the lyric chain, beat sync and the grid all
need music *in*, and until this there was no way to get it in.

**Status:** built end to end — pure layer, main process, IPC and the panel.
Paste a link and press Get: two clicks to a clip on the timeline.

---

## Where things are

| layer | file | what |
|---|---|---|
| shared | `ingest/url.ts` | every YouTube link shape → canonical URL + a **safe key** |
| shared | `ingest/format.ts` | the quality ladder → a yt-dlp selector, **AV1 excluded** |
| shared | `ingest/section.ts` | the range picker → `--download-sections`, exact or fast |
| shared | `ingest/progress.ts` | our `--progress-template`, folded into one monotonic bar |
| shared | `ingest/args.ts` | the whole argv, and how to read the two marked lines back |
| shared | `ingest/release.ts` | which yt-dlp asset per platform, checksum parsing |
| main | `ingest/binary.ts` | find or fetch yt-dlp, verified |
| main | `ingest/download.ts` | spawn, parse, kill the tree, clean up, hand back the file |
| main | `ingest/start.ts` | `ingest:start`'s payload re-validated: the request, and a Clip it job's words and credit, checked |
| shared | `ingest/captions.ts` | a caption track (json3) → a `Transcript`; moving it onto a ranged download |
| main | `ingest/meta.ts` | a link's metadata and caption tracks, no media — see below |
| shared | `ingest/wordRun.ts` | a run of words picked from the rows, and the range it downloads |
| shared | `ingest/linkClip.ts` | what a Clip it job carries to main and back: the run's words, the credit |
| shared | `ingest/collect.ts` | `collectDownload`, `ingest:collect`'s body: the file, once — then `{ alreadyCollected: true }` (`wasCollected`) |
| main | `ipc.ts` | a second `JobQueue`, `ingest:status` / `start` / `collect`; `ingest:meta` / `captions` / `captionTrack` |
| renderer | `components/IngestPanel.tsx` | the panel: link, what to take, the marks |
| renderer | `components/tools/LinkTranscript.tsx`, `TranscriptRows.tsx` | Get transcript, the rows, the handles, the chips, Clip it |
| renderer | `store.ts` | `startIngest`, the `urlSource` slice, and collecting a finished job into a clip |

Everything with a decision in it is in `shared/`, where it runs in a unit test
with no binary, no network and no electron — 39 tests over the pure layer, and
the download path itself is exercised end to end against a fake yt-dlp
(`tests/fixtures/fake-yt-dlp.mjs`) that speaks the same lines, on both CI
platforms.

---

## Decisions, and why

**yt-dlp is fetched on first use, not bundled.** It rots — YouTube changes
something every few weeks and a pinned copy stops working until the next app
release, for a tool whose whole job is keeping up. The current release is
fetched into `<userData>/tools/`, verified against the `SHA2-256SUMS` yt-dlp
publishes, and can be refreshed without shipping anything. Same precedent as
the depth model and Kokoro's voice files. Order of preference: `FORGE_YTDLP`,
our managed copy, then a copy already on PATH.

**When GitHub has a bad minute, the fetch tries again.** On 2026-10-07 Windows
CI run 37655072539 went red with no readable reason, and the same code re-run as
37655616322 was green, in an hour GitHub was answering pushes with "Internal
Server Error" — most likely this fetch, though the red run's log could not be
read. The fetch tried once, and `exactCut` and `ytdlpFormat` fail
rather than skip under CI when they cannot get yt-dlp. Each network step — the
checksums, then the binary — is now tried up to four times, 8, 16 and 32 s
apart (`FETCH_RETRY` in `binary.ts`), on a dropped, refused, unresolved or
stalled connection (no answer within 60 s for the checksums, 300 s for the
binary, or a body that sends nothing for 60 s) or a 5xx, 429 or 408, and never
on a 404 or a checksum mismatch, which are real; the verification runs once,
outside the retry, on what the last try brought. The fetch has 360 s — the old
60 s and 300 s added up — **for trying**: no wait starts that would end past
it, and no try waits for an answer past it. It does not stop a body that is
still arriving. That is a choice, and the user's to change: one version of
this capped the whole transfer at 360 s, which made a first download on a link
under about 0.85 Mbit/s (yt-dlp_macos measured 37,146,048 bytes, yt-dlp.exe
17,840,399) fail every time where the old code finished slowly, so it was
reverted to the old rule — a body is limited by silence, not by total time.
The cost is that a body still moving has no ceiling; on a runner's link that
never matters, and the integration hooks' arithmetic (45 s locating + 360 s +
60 s of silence + 15 s to run = 480 s, inside 600 s) is held by a unit test.
The silence limit was undici's own 300 s; it is 60 s now, because 300 s would
leave a stall no time inside the 360 s for the try it should buy. A failure
names the last try's own reason and how many tries it took, where a network
error used to say only "fetch failed". A job that is not refreshing now stops
waiting on its own cancel while the shared fetch carries on for anyone else;
before, its signal was dropped, and with retries an offline cancel would have
sat through a minute of waits. And CI keeps the managed copy between runs:
`actions/cache`, keyed on the OS, the architecture, the ISO week and a hash of
`binary.ts` and `release.ts`, caching only `tools/` under the userData the two
tests put in `FORGE_TEST_YTDLP_CACHE` — so a miss runs the app's own verified
fetch, a hit is the copy it verified, and a push that changes the fetch's code
runs the real fetch on that push rather than the next week. No restore-keys,
because a restored older copy would be found, nothing would fetch, and the
cache would never refresh. The real fetch then runs about once a week per OS
instead of on every push — every push until a green run of the week saves the
cache, since a red one saves nothing. `tests/ytdlpBinary.test.ts` holds the
retry against a fake GitHub and the default policy to ranges, each case
mutation-checked. Measured here (the sandbox's proxy, `NODE_USE_ENV_PROXY=1`):
the first version of the retry, which still read bodies with `arrayBuffer()`,
fetched the real binary into the cache folder's managed path, `yt-dlp_macos` at
the published `0f192b7e…`; and with a managed copy already there and Node's
network off, both tests used it (`exactCut`'s note: `yt-dlp 2026.07.04
(managed)`). The body is now read chunk by chunk, for the silence timer; that
read was measured on the real `SHA2-256SUMS` (two chunks, decoded and parsed,
`yt-dlp_macos` listed) with the binary's request answered 404 locally, so the
37 MB binary through the new read has not been fetched here — the first CI
miss fetches it. A connection reset's exact shape could not be measured — the
sandbox will not listen on a socket — so its fake follows the measured
ENOTFOUND one and undici's source.

**Downloads have their own queue.** The render queue runs one job at a time
because exports are CPU-bound. A download is network-bound; behind an export it
would wait for nothing, in front of one it would hold it up for nothing. Two
queues, one merged list — the export list's existing bar, speed column and
cancel button (in the Inspector then; the EXPORT strip's **Exports** list now,
`ExportStrip.tsx`) worked for downloads with **no renderer changes at all**.

**The file is named from the video id, never the title.** Titles routinely
contain `| ? " :`, every one illegal on Windows and needing escapes in a
filtergraph. The title becomes the asset's display name, where it can say
anything. The on-disk stem is `<key>.<kind>-<quality>[.r<start>-<end>]`, so
two asks for the same thing are one file and a second paste costs nothing.

**AV1 is excluded from every format branch.** Our Windows ffmpeg is a master
snapshot from 2018-12-17 and can neither mux nor decode it, while YouTube offers
`av01` at every size. The last-resort branch was missing the exclusion and a test
caught it: a single pre-muxed stream needs no merging, so it dodges the muxing
problem — and then cannot be decoded at all.

**The range picker offers both cuts.** *Exact* passes
`--force-keyframes-at-cuts`, which re-encodes and is slow on 4K. *Fast* copies
streams and lands early by up to a keyframe interval, so it pads outward by ten
seconds and the ends are placed exactly on the timeline afterwards — which this
app happens to be. Neither is right for every case; the UI should say which is
which.

**Progress is one bar, not two.** Above 720p YouTube stores video and audio
separately, so yt-dlp downloads twice and each reports its own 0–100%. Summing
bytes stops the visible reset; clamping stops the figure dropping when the
audio's size becomes known. Slightly optimistic in the middle, exact at the ends.

**A cancelled download leaves nothing behind.** yt-dlp writes `.part`, `.ytdl`
and `.f137.mp4` fragments. They are removed *before* the promise settles — the
rule `ffmpeg/run.ts` arrived at the hard way — and the match is precise, so
cancelling `abc.video-1080p` never touches `abc.video-1080p.r60000-90000.mp4`,
which is a different finished download of the same video.

**Cancel kills the process GROUP.** yt-dlp spawns its own ffmpeg to cut a
section or merge streams. `child.kill()` signals one pid, so that grandchild
survived — and because it inherits yt-dlp's stdout, our pipe stayed open and the
`close` event, where the job rejects and the partials are removed, did not fire
until ffmpeg finished work nobody wanted. Measured: 3.0s to close instead of
0.13s. The child is now spawned `detached` on POSIX and `killProcess` signals
`-pid`; Windows keeps `taskkill /f /t`, which already did this.

---

## Things measured against the real binary

yt-dlp 2026.08.19 on the development Mac. The network is blocked here, so
these are the checks that do not need it.

- **Every flag we emit parses.** The full argv, run with a bogus URL, gets past
  the option parser and fails at the extractor stage — which is the failure it
  should have. `--progress-template`, `--print after_move:…`, `-P` with `-o`,
  `--download-sections *50.000-100.000`, `--progress-delta` are all accepted.
- **`--print` implies `--quiet`, and quiet drops the progress lines.**
  `--progress` overrides it; drop that one flag and the bar sits at 0% until the
  end. Pinned in `tests/ingestArgs.test.ts`, mutation-checked.
- **`--print` can also imply `--simulate`.** `--no-simulate` is passed
  explicitly even though a later-stage print disables it, because a download
  that quietly simulates is the worst kind of success.
- **A wrong `--ffmpeg-location` only warns.** "ffmpeg-location … does not
  exist! Continuing without ffmpeg". So a bad path would not fail — it would
  yield an unmerged download. The path is `FFMPEG_PATH`, which
  `assertBinaries()` already checks at startup.
- **`libmp3lame` is present**, so the mp3 option is a real re-encode.
- **`mkv` and `webm` are accepted extensions**, so a merge that lands in either
  still probes.

## What a review of this code then found

Eight agents over four lenses, each finding attacked by an independent reader.
Deduplicated, sixteen real defects. The ones worth remembering:

**4K silently returned 1080p.** yt-dlp's `/` is fallback-only: the first branch
that matches anything wins and the rest are never consulted. YouTube publishes
no avc1 above 1080p, so the H.264-first selector was *satisfied* by the 1080p
stream on a 2160p request — and cached it under the 4K name, so a retry served
it straight back. Verified against the real binary with a YouTube-shaped
`--load-info-json`: `313+140 2160 vp09` now, `137+140 1080 avc1` before.

**Then every vertical video turned out to be unreachable** — and this one was
found by a user, not by a review, which is the whole point of writing it down.

`[height<=?1080]` is FALSE for a 1080p reel, because a 1080p reel is 1080 wide
and **1920 tall**. No branch matched, so yt-dlp answered *"Requested format is
not available"*. Measured against the real binary with shaped format tables: a
landscape 1080p video downloaded fine, while a YouTube Short and an Instagram
reel both failed outright. **In an app whose entire subject is short-form
vertical video, every Short and every reel was refused** — and the failure
looked like the site being unsupported rather than like our arithmetic.

Both bugs have the same cause: **choosing a format with filters and fallback
branches**. The fix is to stop doing that.

    -f  bv*[vcodec!*=av01]+ba/b[vcodec!*=av01]     what is PERMITTED
    -S  res:N,vcodec:h264,acodec:m4a               which of those is BEST

`res` in a yt-dlp sort is the **lower of height and width**, which is exactly
what "1080p" means for a vertical clip. A sort also has no branches to be
trapped in, so the 4K case cannot come back. Codec becomes a preference rather
than a filter — H.264 and AAC rank first where they exist, and a site with
neither still downloads.

AV1 stays a hard filter and is the one thing that may still refuse, because the
2018 Windows ffmpeg cannot decode it: better a clear failure now than an import
that plays nowhere later.

Verified across a vertical ladder (360/720/1080/2160 each return their own
rung), a single pre-muxed Instagram-shaped stream, the 4K case, a VP9-only
video, and an AV1-only one. `tests/integration/ytdlpFormat.int.test.ts` runs all
of it against the real yt-dlp with no network, and every assertion was
mutation-checked by restoring the height filter.

**A TikTok video link was refused as a playlist.** `@[^/]+` sat in the
collection list for `youtube.com/@channel` and was quietly applied to every
site that puts a handle in a path, so `tiktok.com/@user/video/123` was told
"That is a playlist, channel or feed." Depth separates them: a profile and its
tabs are one or two segments, a video is three.

**A playlist or channel URL downloaded the whole collection.** `--no-playlist`
does not save you: yt-dlp's `_yes_playlist` returns `not video_id` *before* it
reads that flag, so a URL with no video id extracts everything. Against one
output template that means entry 1's bytes under entry N's title. Collection
shapes are refused in `parseLink` now, with `--playlist-items 1` as the belt for
the thousand sites whose shapes we cannot recognise.

**Two jobs for one video corrupted each other.** The queue runs two at a time
and both wrote to the same `.part`; yt-dlp resumes by default, so the second
appended from wherever the first had reached, one rename won and the other
failed — and cancelling either removed the shared partials. A second job for a
stem already in flight now waits and takes the cache path.

**Exact and fast cuts shared a filename.** Tick "exact" after a fast download
and the fast file came back from cache, instantly and wrongly. The cut kind is
part of the stem now.

**Windows-only, and CI would have caught only one of them.** The integration
test loaded its fake via `await import(<absolute path>)`, which Node's ESM
loader rejects on Windows — four tests failed there and nowhere else. And
yt-dlp pipes stdout in the ANSI code page unless told otherwise, so a non-ASCII
userData path came back mangled, failed to `stat`, and the finished download was
deleted as "missing". `--encoding utf-8` fixes the second; the first was a bug
in the test, not the code, which is its own lesson.

**`--ignore-config` was missing**, so a user's own yt-dlp config merged into a
command line where every flag is chosen for a reason.

Six of these are pinned by mutation-checked tests. One — the cleanup regex for
hyphenated format ids like `251-drc` — was *fixed but not covered*, and only a
mutation check revealed that; the sibling test now carries those cases.

## Not yet measured, and how to

The format selector is now verified for *selection* — a synthetic
YouTube-shaped `--load-info-json` proves which streams it picks, with no
network. What is still unverified is that real YouTube offers the shapes that
table assumes. On any machine with a network, this checks it without
downloading anything:

    yt-dlp --simulate --print "%(format_id)s %(vcodec)s %(acodec)s %(height)s %(ext)s" \
      -f "<the 2160p selector from format.ts>" "<a 4K URL>"

If it prints `vp9`/`opus` or `avc1`/`mp4a` and never `av01`, the selector is
right. `yt-dlp --version` on the Surface, after the first fetch, is the other
one: that is where a missing Visual C++ runtime would show, and a clean machine
is the only place it can.

The CI cache of yt-dlp ("When GitHub has a bad minute") has not run yet. That
it should work is from reading actions/cache v6's code (it turns `/` into `\`
on Windows, and posts only on success), not from a run. The first green push of
a week should show `Cache saved with key: yt-dlp-Windows-X64-<week>-<hash>` in
"Post Run actions/cache"; the next push, `Cache restored from key: …`, and
exactCut's note should then say `(managed)`. A push that touches `binary.ts` or
`release.ts` should miss.

## Still to build

- The tab body: URL field, the four rungs with "All formats" behind a
  disclosure (only formats we can decode; the rest greyed **with the reason**),
  video / audio / mp3, the two range handles and the preview box, exact/fast.
- Nothing cleans `<userData>/downloads/`. It is the first cache in the app big
  enough for that to matter.
- The first download on a packaged app fetches yt-dlp (~30MB). That step is
  untested on a clean Windows machine — see `docs/PACKAGING.md`.

## Metadata and captions, without the media

`docs/CLIPS.md` §3b.1 (M0's "Get transcript"), measured in `EFFECTS.md` §40.
Two plain invokes, **not jobs**: a job with presetId `'ingest'` is collected
by the renderer and placed as media, and neither of these is media.

- **`ingest:meta`** → `runMeta`: `--simulate` and one marked print,
  `@forgemeta@%(.{id,title,duration,language,chapters,heatmap,channel,uploader,webpage_url})j`.
  A field the video lacks is omitted by yt-dlp; `parseMeta` makes it `null`
  (or `[]` for chapters).
- **`ingest:captions`** → `runCaptions`: `--skip-download --no-simulate
  --write-subs --write-auto-subs --sub-langs <l>,<l>-orig --sub-format json3`
  and `@forgesubs@%(requested_subtitles)j` at `after_video` — the whole dict,
  parsed in TS, because a hyphenated key in a template is subtraction. The
  renderer sends a language; main makes the keys (the primary subtag), never
  a regex.
- **Where the files land**: `userData/url/<linkKey>/<linkKey>.captions.<lang>.json3`,
  kept as the reload cache for the clip collected later. `linkKey` is the
  link's key plus a digest of its URL (`linkCacheKey`), so two YouTube ids
  that differ only in case — two videos — are two folders on a disk that
  ignores case. yt-dlp never writes there directly: each fetch gets a staging
  folder of its own inside it (`.fetch-XXXXXX`, `-P` points at it), and on
  success the json3 tracks are renamed into the cache, replacing an earlier
  copy of the same track, and the staging folder is removed with anything
  else in it (a fallback format the parser does not read). A staging folder
  over ten minutes old is a quit's leftover and is swept by the next fetch.
- **Their own spawn**, not `downloadMedia` (whose success path falls back to
  any media file of the stem), with the same `windowsHide`, process group and
  kill. One run per link key and kind: a second ask aborts the first and
  waits for it to close and clean up before starting. Each run is bounded —
  60 s for the metadata, 120 s for the captions, against 1.5–3.5 s measured —
  and rejects with `LinkTimeoutError`, not `CancelledError`, after the same
  cleanup; finding or fetching yt-dlp itself is outside the bound. A quit
  aborts every run (`abortLinkRuns` in `before-quit`): yt-dlp's process
  group would otherwise outlive the app.
- **The cleanup rule.** A cancel, a failure or a timeout removes the run's
  staging folder — every caption file THIS run wrote, any language — before
  the promise settles, and touches nothing else: the cached tracks of an
  earlier fetch stay, because a placed clip may re-read them. (The first
  version ran `removePartials` on the link's stem, which deleted the cache
  too.) `removePartials` itself, which downloads still use, now matches
  `<stem>.<lang>.<subext>[.part]` deliberately; before, it deleted
  `.fr.json3` only because `fr` starts with `f` (the format-id group took it
  for `f137`) and left `.en.json3` and `.en-orig.json3` behind, so the rule in
  "A cancelled download leaves nothing behind" above did not hold for
  captions. The format-id group may no longer end on a caption extension.

The json3 is parsed in `shared/ingest/captions.ts`: word starts from
`tStartMs + tOffsetMs`, word ends estimated (80 ms a grapheme, at most
600 ms — json3 has none, and without them an unpunctuated track can be one
segment for the whole video; one of four measured was), confidence `null`,
segments capped at 30 words or 15 s, and the ASR's timing with the uploader's
words where both tracks exist, the uploader's clock first aligned to the
ASR's (it was 12 s off on one video). ASR words the uploader's lines do not
cover are kept as the ASR has them.

The tracks' paths go back to the renderer in `CaptionFetch.tracks`; the
renderer keeps only their keys. **The re-parse at collect is built**
(CLIPS.md §3b.4, 2026-10-06): a Clip it job's run, range and track keys go to
main with `ingest:start` (`clip`, checked field by field by `checkLinkClip`)
and come back from `ingest:collect`, so a reload mid-download keeps them; the
renderer then reads each track again with **`ingest:captionTrack({linkKey,
key})`**, which checks the link key against the shape `linkCacheKey` makes
and the track key with `isCaptionKey` — the patterns the fetch wrote the file
under — and builds `userData/url/<linkKey>/<linkKey>.captions.<key>.json3`
itself. No path the renderer names is ever read. The tracks are merged again
exactly as the fetch merged them, so the run's word indices mean the same
words; a transcript that no longer matches the run's word count and first
and last words (a later fetch replaced the files) lands the words that start
inside the range instead.

## Instrumental and vocal are inside the job

The sketch's four buttons are the request's four `kind`s: `video`, `audio`,
`instrumental`, `vocal`. The last two are an audio download **followed by the
stem split, inside the same job** — the queue says *done* when the file the
user asked for exists, not when the download half of it does. The download is
the first 80% of the bar, the split the last 20%; the speed column says which
backend is running.

The song is fetched once: instrumental and vocal share the plain audio
download's stem, and the split is cached separately by `stems.ts`. Asking for
a song and then its instrumental does not download it twice.

The policy — ask the sidecar for Demucs, fall back to mid/side — moved out of
the `audio:stems` handler into `src/main/separate.ts`, shared by both callers,
and fixed on the way: the inline version's `catch` swallowed **every** sidecar
error including the user cancelling, so cancelling a five-minute Demucs split
did not stop it — it quietly produced the mid/side version and reported
success. Cancellation is checked on the signal first now, and never falls back.
`tests/separate.test.ts` pins it with both dependencies faked.

The asset's name says what it is — `Song (instrumental)` when Demucs answered,
`Song (instrumental, mid/side)` when it did not — because "emphasised" must not
be allowed to read as a clean stem in the media pool.


---

## The renderer half

**The marks are typed, not dragged, and that was not the first design.** Two
range sliders were the obvious control and the wrong one: the video's length is
unknown until it has been fetched, so a slider has no scale to be drawn against.
The first version derived the end slider's `max` from its own value, which made
the track rescale under the pointer on every move — **a seven-pixel drag added
four and a half minutes to the range**, measured in the browser by someone
dragging it. Worse, the two sliders ran on different scales, so the start thumb
drew to the right of the end thumb for any start past halfway.

Typed marks have no scale to get wrong and reach an hour in as many keystrokes
as a minute. `parseMark` reads `90`, `1:30`, `1:30.5` and `01:02:03`, and
**refuses** what it cannot read rather than quietly becoming zero — `Number('1:30')`
is `NaN`, and NaN milliseconds reaching `--download-sections` is how a range
stops meaning anything.

**Collection is keyed on the job, not on the window.** A finished download is
turned into a clip when its job reaches `done`. Gating that on renderer state
meant a reload — Cmd+R, which the app allows — silently orphaned a download
that was still running. `presetId === 'ingest'` comes from main and survives
anything the renderer does.

**A job is collected once, and main is what remembers it.** Main keeps a
finished download in its list until *Clear finished*, and the renderer pulls
every `done` ingest job it sees. Its record of what it had pulled —
`collecting`, module memory — went with a reload, so after Cmd+R the same job
was pulled again and its clip landed a second time, in whatever project was
open, for a plain Get and Clip it alike (found 2026-10-06 by a reviewer of
CLIPS.md §3b; `tests/renderer/ingestReload.test.ts` went from one clip to two
on the code before). Now `ingest:collect` (`collectDownload`,
`shared/ingest/collect.ts`) marks the job's entry `collected` once it has
probed the file and built the answer — after, never before, so a probe that
fails leaves the job collectable — and answers every later collect of that job
`{ alreadyCollected: true }` without probing again. The renderer
(`wasCollected`, the same file) then touches nothing — not the project, not
the undo stack, not `pendingIngests` — and keeps its claim, so the next
`jobs:changed` does not ask again. What a reload does now: one cheap invoke
per finished download still in the list, and nothing already handed back
lands again; a job that finished during the reload and was never collected
lands once, as it should. The jobs list is as it was: `jobs:changed` and
*Clear finished* are unchanged, and clearing drops the entry, mark and all.
The mark lives in main's map rather than on the job row because the row is
shared with every export and the map is where main already keeps what only a
download has.

What it leaves, because main marks a job when it **answers**, not when the
clip has landed:

- A clip that landed but was not saved before the reload is not landed again.
  The file is in the downloads folder.
- **A reload after main has read the file but before the clip has landed loses
  the clip, and nothing says so.** Main's answer goes to the old page and is
  dropped; the reloaded window is told `alreadyCollected`, lands nothing, and
  shows no notice; the file stays in the downloads folder. The window is Clip
  it's words being re-read (`ingest:captionTrack`, which the renderer awaits
  after main has answered), or a probe that was running at the reload
  finishing before the reloaded window asks. Measured 2026-10-06 in a scratch
  store test: 0 clips, no notice, in both. If the reloaded window asks while
  that probe is still running, both collects read the file and both are
  answered — the mark is checked before the read and set after it — and the
  reloaded window lands it once.
- A failure placing a clip after main answered is reported once, not retried.

Closing the silent case would take two phases: main records the job as handed
when it answers, the renderer confirms with a one-way `ingest:collected` right
after `commit()` (or after the different-project notice), and only a confirmed
job answers `alreadyCollected` — a handed, unconfirmed one is handed back
again. Landing is synchronous, so the confirm follows it closely. Not built: it
replaces this section's "mark at answer", and that is a decision still to take.

**A download remembers which project it belongs to.** A 4K fetch is minutes;
opening another project meanwhile used to append the asset, the clip and the
trim to *that* one, mark it dirty and move its playhead. Now it says where the
file was saved and leaves the wrong project alone.

**One press of Get is one undo step.** The asset, the placement and the trim
were three, so a single Cmd+Z left the untrimmed padded clip behind — which
reads as the trim having failed rather than as undo working.

**The trim arithmetic lives in `shared/`, not in the store.** This project has
no renderer tests, so anything with a decision in it belongs where it can be
checked. Moving it found a real bug on the way: an unclamped in-point pointed
past the end of a download shorter than the pad, placing a clip that shows
nothing.

### The honest limit of a fast cut

`trimToRequestedRange` removes the padding the fast path added, so the clip that
lands matches the marks. But the downloaded file begins at the nearest keyframe
*at or before* the padded mark, and how much earlier that is cannot be known
from the renderer. `PAD_MS` is a lower bound on the head, so a fast cut can
still carry a little unmarked pre-roll. That is the trade the fast path exists
to make — and why the exact option, which re-encodes at the marks, is offered
beside it rather than instead of it.
