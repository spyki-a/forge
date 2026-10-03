import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Check, Clapperboard, Grid3x3, Play, Repeat, Upload, Download, Loader } from 'lucide-react'
import { BigButton, Tile } from '../components/ui/Tile'
import { KIND_STYLES } from '@shared/edit/clipKind'

/**
 * The theme, on one sheet, before any tile exists in the app.
 *
 * docs/WINDOW.md §6 Step 3: the window turns light (cream page, paper grain,
 * blue accent) and gains its first raised primitives, but nothing in the app
 * uses a Tile until step 9. So this draws them — a tile row with pressed ones,
 * the big buttons, every text grey on every surface with its contrast measured
 * from the COMPUTED colours (so a token that did not build shows up as a wrong
 * number, not as a guess), the accent chips, and the clip colours on a strip of
 * timeline.
 *
 * Harness only (installed from harness/main.tsx; the app's main.tsx never
 * imports it). While it is on, #root is hidden — not unmounted, so the
 * Preview's clock keeps its state — and the sheet itself paints no background,
 * so the "page" samples sit on the real body grain.
 *
 *   __forgeSwatch(true)   // show
 *   __forgeSwatch(false)  // put the app back
 */

let host: HTMLDivElement | null = null
let root: Root | null = null

const SURFACES = [
  { name: 'page (body, grain)', className: '' },
  { name: 'ink-900 panel', className: 'bg-ink-900' },
  { name: 'ink-850 sub-panel', className: 'bg-ink-850' },
  { name: 'ink-800 control', className: 'bg-ink-800' },
  { name: 'ink-700 hover', className: 'bg-ink-700' }
] as const

const TEXTS = [
  { name: 'ink-100 emphasis', className: 'text-ink-100' },
  { name: 'ink-200 primary', className: 'text-ink-200' },
  { name: 'ink-300 control', className: 'text-ink-300' },
  { name: 'ink-400 secondary', className: 'text-ink-400' },
  { name: 'ink-500 label', className: 'text-ink-500' },
  { name: 'ink-600 tertiary', className: 'text-ink-600' },
  { name: 'accent-400 link', className: 'text-accent-400' },
  { name: 'accent-300 on', className: 'text-accent-300' }
] as const

const CHIPS = [
  { name: 'accent-500 fill', className: 'bg-accent-500 text-ink-950' },
  { name: 'accent-400 hover fill', className: 'bg-accent-400 text-ink-950' },
  { name: 'accent-300 deepest', className: 'bg-accent-300 text-ink-950' },
  { name: 'accent-900 pressed tint', className: 'bg-accent-900 text-ink-200' },
  { name: 'accent-500/15 wash', className: 'bg-accent-500/15 text-ink-200' },
  { name: 'stage (video black)', className: 'bg-stage text-white' }
] as const

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` / `color(srgb r g b / a)` → [r, g, b, a] in 0..1. */
function parse(css: string): [number, number, number, number] | null {
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/.exec(css)
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, rgb[4] === undefined ? 1 : Number(rgb[4])]
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(css)
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3]), srgb[4] === undefined ? 1 : Number(srgb[4])]
  return null
}

const luminance = ([r, g, b]: number[]): number => {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** The background actually behind an element: its own, composited over its ancestors', down to the body. */
function backdropOf(el: Element): number[] {
  const layers: [number, number, number, number][] = []
  for (let at: Element | null = el; at; at = at.parentElement) {
    if (at === document.documentElement) break
    const bg = parse(getComputedStyle(at).backgroundColor)
    if (bg && bg[3] > 0) layers.push(bg)
    if (bg && bg[3] >= 1) break
    if (at === document.body) break
  }
  let out = [1, 1, 1]
  for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]
  return out
}

function Ratio({ of }: { of: RefObject<HTMLElement | null> }): ReactNode {
  const [text, setText] = useState('…')
  useEffect(() => {
    const el = of.current
    if (!el) return
    const fg = parse(getComputedStyle(el).color)
    if (!fg) return setText('?')
    const back = backdropOf(el)
    const front = [0, 1, 2].map((i) => fg[i] * fg[3] + back[i] * (1 - fg[3]))
    const [a, b] = [luminance(front), luminance(back)]
    setText(`${((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)}:1`)
  }, [of])
  return <span className="tabular-nums opacity-80">{text}</span>
}

function Sample({ name, className }: { name: string; className: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-swatch-text={name} className={`flex justify-between gap-3 text-[11.5px] ${className}`}>
      <span>{name}</span>
      <Ratio of={ref} />
    </div>
  )
}

function Chip({ name, className }: { name: string; className: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-swatch-chip={name} className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium ${className}`}>
      <span>{name}</span>
      <Ratio of={ref} />
    </div>
  )
}

function Swatch(): ReactNode {
  return (
    <div className="mx-auto max-w-5xl space-y-6 text-ink-200">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[15px] font-semibold text-ink-100">Theme swatch · WINDOW.md step 3</h1>
        <span className="text-[11px] text-ink-600">__forgeSwatch(false) puts the app back · ratios are measured from computed colours</span>
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Tiles on the page (padding 14 px, gap 12 px)</h2>
        <div data-swatch-tiles className="grid w-[320px] grid-cols-4 gap-3 p-3.5">
          <Tile icon={Upload} label="Upload" title="idle" />
          <Tile icon={Grid3x3} pressedIcon={Check} label="Grid split" pressed title="pressed, with pressedIcon" />
          <Tile icon={Clapperboard} label="Director" pressed title="pressed, no pressedIcon (heavier glyph + dot)" />
          <Tile icon={Repeat} label="Disabled" disabled title="disabled" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Big buttons</h2>
        <div data-swatch-buttons className="flex flex-wrap gap-4 p-3.5">
          <BigButton icon={Download}>Export</BigButton>
          <BigButton icon={Download} pressedIcon={Loader} busy>
            Exporting…
          </BigButton>
          <BigButton icon={Play} variant="secondary">
            Preview
          </BigButton>
          <BigButton icon={Repeat} variant="secondary" pressed={true}>
            Loop
          </BigButton>
          <BigButton icon={Download} disabled>
            Disabled
          </BigButton>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Text on every surface</h2>
        <div className="grid grid-cols-5 gap-2">
          {SURFACES.map((surface) => (
            <div key={surface.name} data-swatch-surface={surface.name} className={`space-y-1 rounded-md border border-ink-800 p-2.5 ${surface.className}`}>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">{surface.name}</div>
              {TEXTS.map((text) => (
                <Sample key={text.name} name={text.name} className={text.className} />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Accent and stage</h2>
        <div className="grid grid-cols-3 gap-2 rounded-md bg-ink-900 p-2.5">
          {CHIPS.map((chip) => (
            <Chip key={chip.name} name={chip.name} className={chip.className} />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Clip kinds on the timeline (idle, then selected)</h2>
        <div className="space-y-1.5 rounded-md bg-ink-900 p-2.5">
          {(['idle', 'selected'] as const).map((state) => (
            <div key={state} className="flex gap-1.5">
              {Object.values(KIND_STYLES).map((kind) => (
                <div key={kind.kind} className={`h-11 flex-1 overflow-hidden rounded-md border text-[11px] ${kind[state]}`}>
                  <div className="truncate px-2 pt-1 text-ink-200">{kind.label}</div>
                  <div className="px-2 text-[10px] text-ink-400">00:00:04</div>
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-3 pt-1 text-[10px] text-ink-400">
            {Object.values(KIND_STYLES).map((kind) => (
              <span key={kind.kind} className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${kind.dot}`} />
                {kind.label}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1">
              <span className="h-3 w-0.5 bg-accent-500" /> playhead
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}

function swatch(on: boolean): { on: boolean } {
  const app = document.getElementById('root')
  if (on && !host) {
    host = document.createElement('div')
    host.setAttribute('data-forge-swatch', '1')
    host.className = 'fixed inset-0 z-[1000] overflow-auto p-6'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<Swatch />)
    if (app) app.style.visibility = 'hidden'
  } else if (!on && host) {
    root?.unmount()
    host.remove()
    host = null
    root = null
    if (app) app.style.visibility = ''
  }
  return { on: host !== null }
}

export function installSwatch(): void {
  ;(window as unknown as { __forgeSwatch: typeof swatch }).__forgeSwatch = swatch
}
