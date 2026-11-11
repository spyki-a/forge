import { languageLine } from './prompt'
import type { GraphicsMenu } from './run'
import type { GraphicTemplateId } from '../graphics/template'

/**
 * What the model is told for `graphics@1` (docs/CLIPS.md §6.6).
 *
 * The system prompt is one constant playbook, the same for every talk, so a
 * server caches it once. The user prompt is this menu: the SENTENCES table,
 * then the TEMPLATES table (only the templates this menu offers), then the
 * language line, LAST: that line is what took Telugu and Hindi copy from 0/24
 * to 24/24 in the target script (`prompt.ts`' `SCRIPTS`, docs/EVAL.md).
 */

export const GRAPHICS_SYSTEM = `You mark the moments in a talk where a simple graphic would help a viewer: a number, a comparison, steps, a line worth quoting, a thing on screen worth pointing at, a share of a whole, or a few words worth seeing. You are given the talk's SENTENCES (an id, when it is said, and its words) and the TEMPLATES you may use (an id, when to use it, and its fields). You answer with one JSON object and nothing else.

RULES
- You copy words. Every word you write into a field is copied from the sentence you cite, exactly as it is written there, in its own script.
- You never invent a number or a name. If the sentence does not say it, it is not in the graphic.
- You never choose a look, a motion, a sound, a connector or a name: the app does.
- sentence: the id of the sentence the words come from. template: one id from TEMPLATES, only when its "when" fits.
- Fill only the fields the template lists. Leave every other text field empty (""), items an empty list and lit 0.
- At most four graphics. Most sentences need none.
- When nothing qualifies, answer with an empty list of graphics.
- why: a few words on why a graphic helps there.
- reasoning comes first: one or two sentences on what the talk says.`

/** One TEMPLATES row: §6.6's "when" (the prompt's words) and the fields the model fills. */
export const GRAPHIC_TEMPLATE_ROWS: Readonly<Partial<Record<GraphicTemplateId, { when: string; fields: string }>>> = Object.freeze({
  counter: { when: 'one number, said with what it counts', fields: 'value, label' },
  bars: { when: 'two to five numbers said as a comparison, in one unit', fields: 'title, items' },
  steps: { when: 'two to six steps or reasons said in order', fields: 'title, items[].label' },
  quote: { when: 'a line worth quoting, copied word for word from clause to clause', fields: 'quote' },
  callout: { when: 'a thing on screen the speaker names', fields: 'label' },
  ring: { when: 'a share of a whole, said as a percentage', fields: 'value, label' },
  keyword: { when: 'one to four words the speaker stresses, copied exactly; lit is which of them to light, counting from 0', fields: 'words, lit' }
})

/** A time in a talk as the SENTENCES table shows it: m:ss from the source's start. */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The language's name, from a transcript's code ('te', 'hi-IN') or a name
 * already ('Telugu'): the English display name `Intl` gives a two- or
 * three-letter code, else the text as given.
 */
export function languageName(lang: string): string {
  const text = lang.trim()
  const code = /^([a-z]{2,3})(?:[-_].*)?$/iu.exec(text)?.[1]
  if (!code) return text
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.toLowerCase())
    return name && name.toLowerCase() !== code.toLowerCase() ? name : text
  } catch {
    return text
  }
}

/**
 * The prompt's last line: `prompt.ts`' `languageLine` (the measured line, its
 * script and an example for Telugu and Hindi), or for English, which that
 * line leaves out, the same sentence without a script.
 */
export function graphicsLanguageLine(lang: string): string {
  const name = languageName(lang) || 'English'
  return languageLine(name) ?? `Write all copy in ${name}.`
}

/** The two prompts for one graphics menu. */
export function graphicsPrompt(menu: GraphicsMenu, lang: string): { system: string; user: string } {
  const lines: string[] = []
  lines.push('SENTENCES (id, when it is said, the words)')
  for (const s of menu.sentences) lines.push(`${s.id}  ${clockOf(s.startMs)}  "${s.text}"`)

  lines.push('')
  lines.push('TEMPLATES (id — when to use it — its fields)')
  for (const id of menu.templates) {
    const row = GRAPHIC_TEMPLATE_ROWS[id]
    if (row) lines.push(`${id} — ${row.when} — ${row.fields}`)
  }

  lines.push('')
  lines.push(graphicsLanguageLine(lang))
  return { system: GRAPHICS_SYSTEM, user: lines.join('\n') }
}
