import type { ReactNode } from 'react'
import type { Clip, MediaAsset, Project } from '@shared/timeline'
import type { Problem } from '@shared/director/conforms'
// The module's own export, called through the namespace: the one `validateGraphics`
// calls per graphic (§6.7), so the dock and the validator cannot check differently,
// and tests/renderer/graphicPanel.test.tsx spies on this very binding.
import * as validator from '@shared/director/validateGraphics'
import { drawnText, quoteSpeakerOf } from '@shared/graphics/apply'
import { graphicSeconds } from '@shared/graphics/beats'
import { placeGraphic } from '@shared/graphics/place'
import { footageOf } from '@shared/graphics/sound'
import { GRAPHIC_TEMPLATES, type FieldMode, type GraphicData, type GraphicSpec, type TemplateDef } from '@shared/graphics/template'
import { useEditor } from '../store'

/**
 * The dock's panel for a clip that draws a graphic (docs/CLIPS.md §6.6, "The
 * dock's panel"), mounted beside PaperPanel and CarouselPanel in the Inspector
 * (the Trimmer dock's clip editor). It shows the template's fields by MODE
 * (`TemplateDef.fields`, a social quote's `kindFields`):
 *
 * - **grounded, verbatim and index** fields are re-checked on every edit by
 *   `checkGraphicData` (the export `validateGraphics` itself calls), run
 *   against the graphic's grounding stretch, with the asset's said-quote
 *   speaker as `speakers` (`quoteSpeakerOf`, the name `settleGraphics` passes,
 *   §6.6 piece 2). The check runs on what is stored, and every edit is stored
 *   before the panel draws again, so each edit is checked. Each problem is a
 *   warning under its field and never a block: the field stays editable and the
 *   edit is saved through `setGraphic` whatever the check says. No answer or
 *   menu is built for one edited graphic.
 * - **user** fields (a lower third's Role, a social card's) are never checked:
 *   a template whose fields are all `user` or `speaker` is not checked at all.
 * - **speaker** fields show the asset's Speaker (`MediaAsset.speaker`, the
 *   grounding's asset, else the footage clip's), and editing one calls
 *   `setSpeaker`, which redraws every graphic of that asset that drew the old name.
 * - **app** fields are choices, only on the templates that have them: the
 *   steps' connector (none, line, tree) and the callout's shape (arrow, circle).
 * - the **seconds** within the template's bounds; the **place**, an auto third
 *   or a box you dragged, with a way back to auto.
 *
 * No Depth choice (phase 3). A graphic whose transcript is not in the project
 * shows its fields unchecked with one note; one with no grounding at all, with
 * its own. Under Seconds, a warning (never a block) when the length is under
 * §6.2's reading hold for its beats and what it draws (`graphicSeconds`).
 *
 * No hook but the store's, so a test can call it as a function (as
 * TranscriptGraphics): every text field is uncontrolled, saved on leaving it
 * (Enter leaves it), one undo step per edit, and keyed on the stored value so
 * a change made elsewhere shows.
 */

export const GRAPHIC_PANEL_HEADING = 'Graphic'
export const SPEAKER_FIELD = 'Speaker'
export const ROLE = 'Role'
/** Not the plan's words. */
export const SECONDS = 'Seconds'
export const PLACE = 'Place'
export const BACK_TO_AUTO = 'Back to auto'
export const DRAGGED_BOX = 'A box you dragged'
export const CONNECTOR = 'Connector'
export const SHAPE = 'Shape'
/** The one note for a graphic whose words cannot be checked (not the plan's words). */
export const UNCHECKED_NOTE = 'Its transcript is not in the project, so these words are not checked'
/** The one note for a graphic with checked fields and no grounding at all: it is tied to no words (not the plan's words). */
export const NO_GROUNDING_NOTE = 'It is not tied to anything said, so these words are not checked'
/** Back to auto, greyed: §6.9 finds no free third (not the plan's words). */
export const NO_FREE_THIRD_TITLE = 'No third is free of the captions here'
/** Back to auto, greyed: no footage clip under the graphic to place it over (not the plan's words). */
export const NO_FOOTAGE_TITLE = 'No footage is under it to place it over'

/** Under Seconds, never a block: shorter than §6.2's reading hold, its last beat plus TAIL_S and the time to read it (not the plan's words). */
export function tooShortNote(need: number | null, max: number): string {
  return need === null
    ? `It needs more than ${max} s for its beats and to be read`
    : `It needs ${Math.ceil(need * 10 - 1e-6) / 10} s for its beats and to be read`
}

/** The on-screen name of each field the panel shows (not the plan's words but Speaker and Role). */
export const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  value: 'Value',
  label: 'Label',
  title: 'Title',
  text: 'Quote',
  words: 'Words',
  lit: 'Lit word',
  role: ROLE,
  name: 'Name',
  handle: 'Handle',
  date: 'Date',
  link: 'Link'
})

/** The app's choices (§6.6 "App fields are choices"), by template; the rest of the app fields are not shown. */
export const GRAPHIC_CHOICES: Readonly<Record<string, { field: string; label: string; options: readonly { value: string; label: string }[] }>> = Object.freeze({
  steps: {
    field: 'connector',
    label: CONNECTOR,
    options: [
      { value: 'none', label: 'None' },
      { value: 'line', label: 'Line' },
      { value: 'tree', label: 'Tree' }
    ]
  },
  callout: {
    field: 'shape',
    label: SHAPE,
    options: [
      { value: 'arrow', label: 'Arrow' },
      { value: 'circle', label: 'Circle' }
    ]
  }
})

/** The modes a re-check covers (§6.6). */
const CHECKED: readonly FieldMode[] = ['grounded', 'verbatim', 'index']

/** One field as the panel shows it: its path into the data (`value`, `items[1].label`) and its mode. */
interface Field {
  path: string
  mode: FieldMode
  label: string
}

/**
 * The template's fields as modes: a kind's own (§6.1's `kindFields`, a social
 * quote's) in place of the template's, since that kind's data holds only
 * those (a social card has no `speaker`).
 */
export function modesOf(data: GraphicData, def: TemplateDef): Record<string, FieldMode> {
  const kind = 'kind' in data && typeof data.kind === 'string' ? data.kind : undefined
  return (kind && def.kindFields?.[kind]) || def.fields
}

/** Every field shown, in the template's order; an item field once per item. App fields that are not a Speaker are not here. */
function fieldsOf(data: GraphicData, def: TemplateDef): Field[] {
  const modes = modesOf(data, def)
  const items = 'items' in data && Array.isArray(data.items) ? data.items : []
  const out: Field[] = []
  for (const [key, mode] of Object.entries(modes)) {
    if (mode === 'fixed') continue
    if (def.appFields?.includes(key) && mode !== 'speaker') continue
    if (!key.startsWith('items.')) {
      out.push({ path: key, mode, label: mode === 'speaker' ? SPEAKER_FIELD : FIELD_LABELS[key] ?? key })
      continue
    }
    const sub = key.slice('items.'.length)
    items.forEach((_, j) => out.push({ path: `items[${j}].${sub}`, mode, label: `Row ${j + 1} ${(FIELD_LABELS[sub] ?? sub).toLowerCase()}` }))
  }
  return out
}

const ITEM = /^items\[(\d+)\]\.(\w+)$/u

/** The field's stored value. */
function valueAt(data: GraphicData, path: string): string | number {
  const record = data as unknown as Record<string, unknown>
  const m = ITEM.exec(path)
  const v = m ? (record.items as Record<string, unknown>[] | undefined)?.[Number(m[1])]?.[m[2]] : record[path]
  return typeof v === 'number' ? v : typeof v === 'string' ? v : ''
}

/** The data with one field set; the input is never edited. */
export function withField(data: GraphicData, path: string, value: string | number): GraphicData {
  const m = ITEM.exec(path)
  if (!m) return { ...data, [path]: value } as GraphicData
  const record = data as unknown as { items: Record<string, unknown>[] }
  const items = record.items.map((it, j) => (j === Number(m[1]) ? { ...it, [m[2]]: value } : it))
  return { ...data, items } as unknown as GraphicData
}

/** The asset a graphic's Speaker is: its grounding's, else its footage clip's (as `withSpeaker` finds its graphics). */
function ownerOf(project: Project, clip: Clip, spec: GraphicSpec): MediaAsset | undefined {
  const id = spec.grounding?.assetId ?? project.clips.find((c) => c.id === footageOf(project, clip, spec))?.assetId
  return id === undefined ? undefined : project.assets.find((a) => a.id === id)
}

/** A problem's field: '$.items[1].value' → 'items[1].value'; '$' → '' (the graphic as a whole). */
const pathOf = (p: Problem): string => p.path.replace(/^\$\.?/u, '')

/** Keys that belong to the field: kept from the shortcut layer, Enter leaves it. */
function fieldKeys(e: { key: string; stopPropagation: () => void; target: unknown }): void {
  e.stopPropagation()
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
}

const inputClass =
  'min-w-0 flex-1 rounded bg-ink-850 px-2 py-1 text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:ring-1 focus:ring-ink-600'
const choiceClass = (on: boolean): string =>
  `rounded px-1.5 py-0.5 text-[10px] transition-colors ${on ? 'bg-accent-500 text-ink-950' : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'}`

export function GraphicPanel({ clip }: { clip: Clip }): ReactNode {
  const project = useEditor((s) => s.project)
  const setGraphic = useEditor((s) => s.setGraphic)
  const setSpeaker = useEditor((s) => s.setSpeaker)
  const spec = clip.graphic
  if (!spec) return null
  const data = spec.data
  const def = GRAPHIC_TEMPLATES[data.template]
  const name = data.template.replace(/-/g, ' ')
  const heading = (
    <div className="flex items-baseline justify-between">
      <span className="text-[10.5px] text-ink-400">{GRAPHIC_PANEL_HEADING}</span>
      <span className="text-[10px] text-ink-600">{name}</span>
    </div>
  )
  if (!def) return <div className="space-y-2 border-t border-ink-850 pt-2">{heading}</div>

  const fields = fieldsOf(data, def)
  const owner = ownerOf(project, clip, spec)
  const checks = fields.some((f) => CHECKED.includes(f.mode))
  const transcript = spec.grounding ? project.transcripts[spec.grounding.assetId] : undefined
  const speaker = owner ? quoteSpeakerOf(owner) : ''
  // §6.6: re-checked on every edit, never a block. Only a template with a grounded, verbatim or index field.
  const problems: Problem[] =
    checks && transcript ? validator.checkGraphicData(data, def, spec.grounding, transcript, speaker === '' ? [] : [speaker]) : []
  const unchecked = checks && spec.grounding !== undefined && !transcript
  const ungrounded = checks && spec.grounding === undefined
  const shown = new Set(fields.map((f) => f.path))
  const general = problems.filter((p) => !shown.has(pathOf(p)))
  const save = (next: GraphicData): void => void setGraphic(clip.id, { data: next })

  const fieldRow = (f: Field): ReactNode => {
    const id = `forge-graphic-${f.path.replace(/[^\w]/gu, '-')}`
    const warnings = problems.filter((p) => pathOf(p) === f.path)
    let input: ReactNode
    if (f.mode === 'speaker' && owner) {
      // The asset's Speaker, not the drawn copy: editing it is setSpeaker (§6.6).
      const stored = owner.speaker ?? ''
      input = (
        <input
          id={id}
          key={`${owner.id}:${stored}`}
          defaultValue={stored}
          // A link's channel, which a said quote draws when the asset has no Speaker (quoteSpeakerOf).
          placeholder={stored.trim() === '' && speaker !== '' ? speaker : undefined}
          onBlur={(e) => {
            if (e.target.value.trim() !== stored.trim()) setSpeaker(owner.id, e.target.value)
          }}
          onKeyDown={fieldKeys}
          className={inputClass}
        />
      )
    } else if (f.mode === 'index') {
      const stored = valueAt(data, f.path)
      input = (
        <input
          id={id}
          type="number"
          step={1}
          key={`${clip.id}:${f.path}:${stored}`}
          defaultValue={String(stored)}
          onBlur={(e) => {
            const n = Number(e.target.value)
            // A cleared field reads NaN, which is no index; anything else is saved, in range or not (a warning, never a block).
            if (e.target.value.trim() === '' || !Number.isFinite(n)) return
            const next = Math.trunc(n)
            if (next !== stored) save(withField(data, f.path, next))
          }}
          onKeyDown={fieldKeys}
          className={inputClass}
        />
      )
    } else {
      const stored = String(valueAt(data, f.path))
      input = (
        <input
          id={id}
          key={`${clip.id}:${f.path}:${stored}`}
          defaultValue={stored}
          onBlur={(e) => {
            if (e.target.value !== stored) save(withField(data, f.path, e.target.value))
          }}
          onKeyDown={fieldKeys}
          className={inputClass}
        />
      )
    }
    return (
      <div key={f.path} data-graphic-field={f.path} data-mode={f.mode} className="space-y-0.5">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="w-16 shrink-0 text-[10px] text-ink-500">
            {f.label}
          </label>
          {input}
        </div>
        {warnings.map((w, i) => (
          <p key={i} data-warning-for={f.path} className="text-[10px] leading-snug text-amber-400">
            {w.message}
          </p>
        ))}
      </div>
    )
  }

  const choice = GRAPHIC_CHOICES[data.template]
  const chosen = choice ? valueAt(data, choice.field) : null
  const { min, max } = def.seconds
  // §6.2's reading hold over what is drawn now: a warning under Seconds when shorter, never a block.
  const need = graphicSeconds(def, spec.beats, drawnText(data))
  const tooShort = need === null || spec.seconds < need - 1e-6 ? tooShortNote(need, max) : null
  const footageId = footageOf(project, clip, spec)
  const auto =
    spec.place.auto || footageId === null
      ? null
      : placeGraphic(project, footageId, clip.start, clip.duration, data.template, { width: project.settings.width, height: project.settings.height })

  return (
    <div data-graphic-panel="" className="space-y-2 border-t border-ink-850 pt-2">
      {heading}
      {unchecked && <p className="text-[10px] leading-snug text-ink-500">{UNCHECKED_NOTE}</p>}
      {ungrounded && <p className="text-[10px] leading-snug text-ink-500">{NO_GROUNDING_NOTE}</p>}
      {general.map((w, i) => (
        <p key={i} data-warning-for="" className="text-[10px] leading-snug text-amber-400">
          {w.message}
        </p>
      ))}

      {fields.map(fieldRow)}

      {choice && (
        <div data-graphic-choice={choice.field} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] text-ink-500">{choice.label}</span>
          {choice.options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={chosen === o.value}
              onClick={() => {
                if (chosen !== o.value) save(withField(data, choice.field, o.value))
              }}
              className={choiceClass(chosen === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label htmlFor="forge-graphic-seconds" className="w-16 shrink-0 text-[10px] text-ink-500">
          {SECONDS}
        </label>
        <input
          id="forge-graphic-seconds"
          type="number"
          min={min}
          max={max}
          step={0.1}
          key={`${clip.id}:seconds:${spec.seconds}`}
          defaultValue={String(spec.seconds)}
          onBlur={(e) => {
            const n = Number(e.target.value)
            if (e.target.value.trim() === '' || !Number.isFinite(n)) return
            // Within the template's bounds (§6.6), at a tenth of a second.
            const seconds = Math.round(Math.min(max, Math.max(min, n)) * 10) / 10
            if (seconds !== spec.seconds) void setGraphic(clip.id, { seconds })
          }}
          onKeyDown={fieldKeys}
          className={inputClass}
        />
        <span className="shrink-0 text-[10px] text-ink-600">
          {min}–{max} s
        </span>
      </div>
      {tooShort && (
        <p data-warning-for="seconds" className="text-[10px] leading-snug text-amber-400">
          {tooShort}
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] text-ink-500">{PLACE}</span>
        {spec.place.auto ? (
          <span data-graphic-place="auto" className="text-[10.5px] text-ink-300">
            {`Auto · the ${spec.place.third} third`}
          </span>
        ) : (
          <>
            <span data-graphic-place="box" className="min-w-0 flex-1 text-[10.5px] text-ink-300">
              {DRAGGED_BOX}
            </span>
            <button
              type="button"
              disabled={auto === null}
              title={footageId === null ? NO_FOOTAGE_TITLE : auto === null ? NO_FREE_THIRD_TITLE : undefined}
              onClick={() => {
                if (auto) void setGraphic(clip.id, { place: auto })
              }}
              className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-40"
            >
              {BACK_TO_AUTO}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
