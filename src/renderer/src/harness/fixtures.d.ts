/*
 * The UI census rows, imported as text.
 *
 * `tests/fixtures` is outside the renderer's tsconfig, and a composite project
 * may not pull in a file it does not list — so the census reads the fixture
 * through Vite's `?raw` and parses it itself. One pattern, for that one file,
 * rather than every `?raw` in the renderer going untyped.
 */
declare module '*/ui-census.json?raw' {
  const text: string
  export default text
}

/* The graphics drawing fixtures, the same way: the graphics check's `templates` option draws them (graphicCheck.ts). */
declare module '*/specs.json?raw' {
  const text: string
  export default text
}
