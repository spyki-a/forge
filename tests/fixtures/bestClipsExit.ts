import { parseLink, linkCacheKey } from '@shared/ingest/url'
import type { BestClipsResult } from '@shared/bestclips/run'
import { cardRange, cardWords, SCORED_BY_LABEL } from '@shared/bestclips/session'

/**
 * The ten-links recorder's pure parts (docs/CLIPS.md §7.8's first bullet;
 * tests/integration/bestClipsExit.int.test.ts runs them on the owner's
 * machine): the owner's links file read, a Windows-safe file name from a
 * video's title, a link to a moment of the video, and the ONE page the owner
 * opens to rate the cards. Pure and node-tested (tests/bestClipsExit.test.ts):
 * no file, no network, no clock.
 *
 * Nothing here is anyone's speech: the page is built from what the recorder
 * fetched on the owner's machine, written under tests/output/ (gitignored),
 * and every word of it is escaped as text.
 */

/** Where the owner writes the links, under tests/output/_session-keep/ (gitignored). */
export const EXIT_LINKS_FILE = 'bestclips-exit-links.txt'

/** The lengths sheet 27 offers, in minutes. */
const MINUTES = new Set([1, 2, 3, 4])

export interface ExitLink {
  /** The file's line, from 1. */
  line: number
  /** The link as yt-dlp is handed it (`parseLink`'s canonical URL). */
  url: string
  /** `linkCacheKey`: the link's own key, as the app's caches have it. */
  key: string
  /** 60_000, 120_000, 180_000 or 240_000. */
  targetMs: number
  /** The captions' language when the owner names one (`hi`, `te`, `en-US`); else the video's own. */
  language: string | null
}

/**
 * The owner's links file: ONE LINK A LINE, then the length in minutes (1, 2,
 * 3 or 4, written `2` or `2min` or `2 min`), then, optionally, the captions'
 * language when the video does not name its own:
 *
 *     # talks and podcasts; two in Hindi or Telugu
 *     https://www.youtube.com/watch?v=XXXXXXXXXXX 2
 *     https://youtu.be/YYYYYYYYYYY 1 min hi
 *
 * Blank lines and lines starting with `#` are skipped. Every problem is
 * returned with its line, so the recorder can refuse to start before anything
 * is fetched; a link given twice at one length is a problem (the same cards
 * twice would count twice towards "7 of 10").
 */
export function parseExitLinks(text: string): { links: ExitLink[]; problems: string[] } {
  const links: ExitLink[] = []
  const problems: string[] = []
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  lines.forEach((raw, i) => {
    const line = i + 1
    const body = raw.trim()
    if (body === '' || body.startsWith('#')) return
    const words = body.replace(/(\d)\s+min\b/giu, '$1min').split(/\s+/u)
    const link = parseLink(words[0])
    if (!link) return void problems.push(`line ${line}: "${words[0]}" is not a link yt-dlp can read`)
    const length = /^([0-9]+)(?:min)?$/iu.exec(words[1] ?? '')
    if (!length) return void problems.push(`line ${line}: no length after the link (1, 2, 3 or 4, in minutes)`)
    const minutes = Number(length[1])
    if (!MINUTES.has(minutes)) return void problems.push(`line ${line}: ${minutes} min is not a length Best clips offers (1, 2, 3 or 4)`)
    const language = words[2] ?? null
    if (language !== null && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)) {
      return void problems.push(`line ${line}: "${language}" is not a language code (like en, hi, te)`)
    }
    if (words.length > 3) return void problems.push(`line ${line}: more than a link, a length and a language`)
    const key = linkCacheKey(link)
    const targetMs = minutes * 60_000
    const twice = links.find((l) => l.key === key && l.targetMs === targetMs)
    if (twice) return void problems.push(`line ${line}: the same link at the same length as line ${twice.line}`)
    links.push({ line, url: link.url, key, targetMs, language })
  })
  if (links.length === 0 && problems.length === 0) problems.push('the file names no link')
  return { links, problems }
}

/** Graphemes, as the app counts them (Intl.Segmenter; code points where it is missing). */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
  return Segmenter ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment) : [...text]
}

/**
 * A file name from a video's title, safe on Windows and macOS (CLAUDE.md's
 * rules): `< > : " / \ | ? *` and control characters become `-`, runs of
 * space become one, no leading or trailing dot or space, at most `max`
 * graphemes (never half a grapheme: a Devanagari or Telugu title, or an
 * emoji, is cut between graphemes), and a reserved device name (CON, NUL,
 * COM1…) gets a `_` in front, extension or not. Empty after all that: the
 * `fallback`. `Bride 5:30pm.jpg` → `Bride 5-30pm.jpg`.
 */
export function exitFileName(title: string, fallback: string, max = 60): string {
  const strip = (s: string): string => s.replace(/^[. ]+|[. ]+$/gu, '')
  const cleaned = strip(
    title
      .normalize('NFC')
      .replace(/\s+/gu, ' ')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '-')
  )
  const cut = strip(graphemes(cleaned).slice(0, max).join(''))
  if (!cut) return fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu.test(cut) ? `_${cut}` : cut
}

/** A link to `ms` into the video: YouTube's `&t=<s>s`; any other link with a `#t=` media fragment. */
export function timeLink(url: string, ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const link = parseLink(url)
  if (link?.kind === 'youtube' && link.videoId) return `https://www.youtube.com/watch?v=${link.videoId}&t=${s}s`
  return `${(link?.url ?? url).replace(/#.*$/u, '')}#t=${s}`
}

/** One side of a link's cards, as the page shows them. */
export interface ExitSide {
  cards: BestClipsResult['cards']
  note: string | null
  modelNote: string | null
}

export function sideOf(result: Pick<BestClipsResult, 'cards' | 'note' | 'modelNote'>): ExitSide {
  return { cards: result.cards, note: result.note, modelNote: result.modelNote }
}

/** One link, as the recorder found it. */
export interface ExitRecord {
  /** The links file's order, from 1. */
  n: number
  url: string
  key: string
  targetMs: number
  /** The video's title (escaped on the page; never committed). */
  title: string | null
  language: string | null
  /** What happened: the cards, no captions, or the fetch failed (with the reason, the owner's own machine's). */
  status: 'cards' | 'no-captions' | 'no-language' | 'failed'
  problem: string | null
  signals: ExitSide | null
  /** The model's side, once its answers are saved and scored (the second pass). */
  model: ExitSide | null
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Text as HTML text or an attribute's value: nothing fetched can become markup. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, (c) => ESCAPES[c])

/** An href only for an http(s) link; anything else is no link at all. */
const safeHref = (url: string): string | null => (/^https?:\/\//iu.test(url) ? escapeHtml(url) : null)

function cardHtml(record: ExitRecord, side: 'signals' | 'model', card: BestClipsResult['cards'][number], i: number): string {
  const name = `${side}-${record.n}-${i + 1}`
  const href = safeHref(timeLink(record.url, card.startMs))
  const range = escapeHtml(cardRange(card))
  return [
    `<li class="card" data-card="${name}">`,
    `<p class="title">${escapeHtml(card.title)}</p>`,
    `<p class="why">${escapeHtml(card.why)}</p>`,
    `<p class="meta">${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${range}</a>` : range} · ${escapeHtml(cardWords(card))} · ${escapeHtml(SCORED_BY_LABEL[card.scoredBy])}</p>`,
    card.note ? `<p class="note">${escapeHtml(card.note)}</p>` : '',
    `<fieldset class="rate" data-side="${side}" data-link="${record.n}"><legend>Would you post this?</legend>`,
    `<label><input type="radio" name="${name}" value="yes"> yes</label> <label><input type="radio" name="${name}" value="no"> no</label></fieldset>`,
    '</li>'
  ].join('')
}

function sideHtml(record: ExitRecord, side: 'signals' | 'model', cards: ExitSide | null, label: string): string {
  if (!cards) return `<div class="side"><h3>${escapeHtml(label)}</h3><p class="empty">Not asked yet.</p></div>`
  return [
    `<div class="side"><h3>${escapeHtml(label)}</h3>`,
    cards.cards.length > 0 ? `<ol class="cards">${cards.cards.map((c, i) => cardHtml(record, side, c, i)).join('')}</ol>` : '<p class="empty">No cards.</p>',
    cards.note ? `<p class="note">${escapeHtml(cards.note)}</p>` : '',
    cards.modelNote ? `<p class="note">${escapeHtml(cards.modelNote)}</p>` : '',
    '</div>'
  ].join('')
}

/** What the page says it is: when it was made, by which yt-dlp, and with which model's answers (or none yet). */
export interface ExitPageInfo {
  ranAt: string
  ytdlp: string
  /** The model whose answers are on the page, or null before the second pass. */
  model: string | null
}

/**
 * The ONE page the owner opens (§7.8): per link, its title and length, then
 * the signals' cards and, once the model's answers are saved and scored, the
 * model's beside them, each card with its title, why, range (a link to that
 * moment of the video), word count, who picked it, and "Would you post
 * this? yes / no". The two sides are rated separately, as §7.8 asks; the
 * tally at the top counts, per side, the links with at least one "yes"
 * against the bar (7 of 10). The ratings stay in the page (the browser's own
 * storage, per file) and "Copy the ratings" puts them on the clipboard as
 * JSON for the record. No network, no script from elsewhere.
 */
export function exitPage(records: readonly ExitRecord[], info: ExitPageInfo): string {
  const sections = records.map((r) => {
    const href = safeHref(r.url)
    const head = `<h2>${r.n}. ${escapeHtml(r.title ?? r.url)}</h2><p class="meta">${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a>` : escapeHtml(r.url)} · ${r.targetMs / 60_000} min${r.language ? ` · ${escapeHtml(r.language)}` : ''}</p>`
    if (r.status !== 'cards') {
      const why = r.status === 'no-captions' ? 'This video has no captions in that language.' : r.status === 'no-language' ? 'The video names no language: add one after the length.' : 'The fetch failed.'
      return `<section class="link" data-link="${r.n}" data-status="${r.status}">${head}<p class="empty">${escapeHtml(why)}${r.problem ? ` ${escapeHtml(r.problem)}` : ''}</p></section>`
    }
    return `<section class="link" data-link="${r.n}" data-status="cards">${head}<div class="sides">${sideHtml(r, 'signals', r.signals, 'From the talk’s own signals (no model)')}${info.model ? sideHtml(r, 'model', r.model, `With the model (${info.model})`) : ''}</div></section>`
  })
  const rated = records.filter((r) => r.status === 'cards').length
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Best clips exit</title>
<style>
:root{--bg:#f2efe7;--ink:#1d1b17;--muted:#6a655b;--line:#d9d3c5;--accent:#2663e9}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a17;--ink:#eee9dd;--muted:#a49d8e;--line:#3a372f;--accent:#6b97f5}}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 2px;overflow-wrap:anywhere}
h3{font-size:13px;margin:0 0 6px;color:var(--muted);font-weight:600}
.link{border-top:1px solid var(--line);padding:14px 0}.sides{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:8px}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:8px}.card{border:1px solid var(--line);border-radius:6px;padding:8px}
.title{font-weight:600;margin:0;overflow-wrap:anywhere}.why{margin:2px 0;overflow-wrap:anywhere}.meta,.note,.empty{color:var(--muted);font-size:13px;margin:2px 0;overflow-wrap:anywhere}
a{color:var(--accent)}fieldset{border:0;padding:0;margin:4px 0 0;font-size:13px}legend{float:left;margin-right:8px;padding:0}
#tally{font-size:14px;margin:8px 0}textarea{width:100%;min-height:80px;box-sizing:border-box}
</style></head><body><main>
<h1>Best clips: would you post these?</h1>
<p class="meta">${escapeHtml(`Made ${info.ranAt} with yt-dlp ${info.ytdlp}; ${records.length} links, ${rated} with cards. ${info.model ? `The model's cards are ${info.model}'s.` : 'The model’s cards are not here yet: save its answers and run the second pass.'}`)}</p>
<p id="tally" aria-live="polite"></p>
<p><button type="button" id="copy">Copy the ratings</button></p><textarea id="out" readonly hidden></textarea>
${sections.join('\n')}
</main>
<script>
(function(){
  var KEY='bestclips-exit:'+${JSON.stringify(info.ranAt)};
  var saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(e){saved={}}
  var inputs=[].slice.call(document.querySelectorAll('input[type=radio]'));
  inputs.forEach(function(i){if(saved[i.name]===i.value)i.checked=true});
  function ratings(){var r={};inputs.forEach(function(i){if(i.checked)r[i.name]=i.value});return r}
  function tally(){
    var r=ratings(),out=[];
    ['signals','model'].forEach(function(side){
      var links={},yes={};
      Object.keys(r).forEach(function(n){var p=n.split('-');if(p[0]!==side)return;links[p[1]]=true;if(r[n]==='yes')yes[p[1]]=true});
      var rated=Object.keys(links).length;if(rated===0&&side==='model'&&!document.querySelector('[data-side=model]'))return;
      out.push((side==='signals'?'Signals alone':'With the model')+': '+Object.keys(yes).length+' of '+rated+' links rated have a card you would post (the bar: 7 of 10)');
    });
    document.getElementById('tally').textContent=out.join(' · ');
  }
  inputs.forEach(function(i){i.addEventListener('change',function(){try{localStorage.setItem(KEY,JSON.stringify(ratings()))}catch(e){}tally()})});
  document.getElementById('copy').addEventListener('click',function(){
    var t=document.getElementById('out');t.hidden=false;t.value=JSON.stringify(ratings(),null,1);t.select();
    try{navigator.clipboard.writeText(t.value)}catch(e){}
  });
  tally();
})();
</script></body></html>
`
}
