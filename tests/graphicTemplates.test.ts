import { describe, it, expect } from 'vitest'
import { GRAPHIC_TEMPLATES, type GraphicTemplateId, type TemplateDef } from '@shared/graphics/template'

/*
 * GRAPHIC_TEMPLATES' values (docs/CLIPS.md §6.2's table, the seconds from its
 * nine shapes' table). Each row is checked field by field against the plan's
 * words, by membership where a later step may rightly add to a list.
 */

const DRAWN: GraphicTemplateId[] = [
  'counter',
  'bars',
  'steps',
  'quote',
  'callout',
  'ring',
  'keyword',
  'lower-third',
  'screen-card',
  // step 6 (docs/CLIPS.md §9), piece 1
  'timeline',
  'before-after',
  'versus'
]

function row(id: GraphicTemplateId): TemplateDef {
  const def = GRAPHIC_TEMPLATES[id]
  if (!def) throw new Error(`no GRAPHIC_TEMPLATES row for ${id}`)
  return def
}

describe('GRAPHIC_TEMPLATES (§6.2)', () => {
  it('has a row for each drawn id, each naming its own id', () => {
    for (const id of DRAWN) expect(row(id).id).toBe(id)
  })

  it('has no row for the source card (after the beta, §16.75: step 5’s fetcher and step 6’s cards write it)', () => {
    expect(GRAPHIC_TEMPLATES.source).toBeUndefined()
  })

  it('takes each template’s seconds from the nine shapes’ table', () => {
    const table: [GraphicTemplateId, number, number, number][] = [
      ['counter', 2, 3, 4],
      ['bars', 3, 5, 6],
      ['steps', 3, 6, 8],
      ['quote', 2, 4, 6],
      ['callout', 1.5, 2.5, 3],
      ['ring', 2, 3, 4],
      ['keyword', 1.5, 2.5, 3.5],
      ['lower-third', 2.5, 3.5, 5],
      ['screen-card', 1, 10, 600],
      // step 6 (§9): this piece's proposals beside §6.2's rows (template.ts says why)
      ['timeline', 3, 6, 8],
      ['before-after', 2.5, 4, 6],
      ['versus', 2.5, 4, 6]
    ]
    for (const [id, min, def, max] of table) expect(row(id).seconds).toEqual({ min, default: def, max })
  })

  it('gives each drawn field the mode the table names', () => {
    const modes: [GraphicTemplateId, string, string][] = [
      ['counter', 'value', 'grounded'],
      ['counter', 'label', 'grounded'],
      ['bars', 'title', 'grounded'],
      ['bars', 'items.label', 'grounded'],
      ['bars', 'items.value', 'grounded'],
      ['steps', 'title', 'grounded'],
      ['steps', 'items.label', 'grounded'],
      ['quote', 'text', 'verbatim'],
      ['quote', 'speaker', 'speaker'],
      ['callout', 'label', 'grounded'],
      ['ring', 'value', 'grounded'],
      ['ring', 'label', 'grounded'],
      ['keyword', 'words', 'verbatim'],
      ['keyword', 'lit', 'index'],
      ['lower-third', 'name', 'speaker'],
      ['lower-third', 'role', 'user'],
      // step 6 (§9): every drawn string grounded, no title (the app writes no headline)
      ['timeline', 'items.when', 'grounded'],
      ['timeline', 'items.label', 'grounded'],
      ['before-after', 'before.label', 'grounded'],
      ['before-after', 'before.value', 'grounded'],
      ['before-after', 'after.label', 'grounded'],
      ['before-after', 'after.value', 'grounded'],
      ['versus', 'left.label', 'grounded'],
      ['versus', 'left.value', 'grounded'],
      ['versus', 'right.label', 'grounded'],
      ['versus', 'right.value', 'grounded']
    ]
    for (const [id, field, mode] of modes) expect(row(id).fields[field], `${id}.${field}`).toBe(mode)
    // the table gives each row's fields exactly: no stray mode-bearing field (T2's validator checks each)
    for (const id of DRAWN) {
      const listed = modes.filter(([m]) => m === id).map(([, f]) => f)
      expect(new Set(Object.keys(row(id).fields)), id).toEqual(new Set(listed))
    }
    expect(row('screen-card').fields).toEqual({})
  })

  it('makes every field of the social quote user-typed', () => {
    const social = row('quote').kindFields?.social
    for (const f of ['text', 'name', 'handle', 'date', 'link']) expect(social?.[f], f).toBe('user')
  })

  it('lists the fixed titles, pairs and item counts', () => {
    expect(row('bars').fixedTitles).toEqual(expect.arrayContaining(['By the numbers', 'Compared']))
    expect(row('steps').fixedTitles).toEqual(expect.arrayContaining(['Step by step']))
    expect(row('counter').pairs).toContainEqual(['label', 'value'])
    expect(row('ring').pairs).toContainEqual(['label', 'value'])
    expect(row('bars').pairs).toContainEqual(['items.label', 'items.value'])
    for (const id of ['steps', 'quote', 'callout', 'keyword', 'lower-third', 'screen-card'] as const) {
      expect(row(id).pairs, id).toBeUndefined() // the table's "—"
    }
    expect(row('bars').maxItems).toBe(5)
    expect(row('steps').maxItems).toBe(6)
    expect(row('bars').minItems).toBe(2)
    expect(row('steps').minItems).toBe(2)
    // step 6 (§6.7 rule 6: "later before-after, versus, timeline"): each pair a label with its value; a timeline item's when is its value
    expect(row('timeline').pairs).toContainEqual(['items.label', 'items.when'])
    expect(row('before-after').pairs).toContainEqual(['before.label', 'before.value'])
    expect(row('before-after').pairs).toContainEqual(['after.label', 'after.value'])
    expect(row('versus').pairs).toContainEqual(['left.label', 'left.value'])
    expect(row('versus').pairs).toContainEqual(['right.label', 'right.value'])
    expect(row('timeline').maxItems).toBe(5)
    expect(row('timeline').minItems).toBe(2)
    // no title of any kind, and so no fixed title: the app never writes a headline (§9)
    for (const id of ['timeline', 'before-after', 'versus'] as const) {
      expect(row(id).fixedTitles, id).toBeUndefined()
      expect(row(id).fields.title, id).toBeUndefined()
      expect(row(id).appFields, id).toBeUndefined()
    }
  })

  it('names every app-set field §6.1 lists, and gives steps’ parent and connector no mode', () => {
    const app: [GraphicTemplateId, string][] = [
      ['steps', 'parent'],
      ['steps', 'connector'],
      ['callout', 'shape'],
      ['quote', 'speaker'],
      ['lower-third', 'name'],
      ['screen-card', 'clipId'],
      ['screen-card', 'move']
    ]
    for (const [id, field] of app) expect(row(id).appFields, `${id}.${field}`).toContain(field)
    for (const f of ['parent', 'connector', 'items.parent']) expect(row('steps').fields[f]).toBeUndefined()
    expect(row('callout').fields.shape).toBeUndefined()
  })

  it('asks for a subject only for the callout, and allows depth only for the counter, the ring, the screen card and step 6’s three', () => {
    const DEPTH = new Set<GraphicTemplateId>(['counter', 'ring', 'screen-card', 'timeline', 'before-after', 'versus'])
    for (const id of DRAWN) {
      expect(row(id).needsSubject === true, id).toBe(id === 'callout')
      expect(row(id).threeD, id).toBe(DEPTH.has(id))
    }
  })

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(GRAPHIC_TEMPLATES)).toBe(true)
    for (const id of DRAWN) {
      const def = row(id)
      expect(Object.isFrozen(def), id).toBe(true)
      expect(Object.isFrozen(def.fields), id).toBe(true)
      expect(Object.isFrozen(def.seconds), id).toBe(true)
      if (def.appFields) expect(Object.isFrozen(def.appFields), id).toBe(true)
      for (const pair of def.pairs ?? []) expect(Object.isFrozen(pair), id).toBe(true)
    }
    expect(Object.isFrozen(row('quote').kindFields!.social)).toBe(true)
    expect(Object.isFrozen(row('counter').pairs![0])).toBe(true)
    expect(() => {
      ;(row('counter').fields as Record<string, string>).value = 'verbatim'
    }).toThrow()
  })
})
