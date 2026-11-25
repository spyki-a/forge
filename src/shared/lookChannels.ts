/**
 * The two channels main registers for a look's file (src/main/ipc.ts) and the
 * preload's two calls (docs/CLIPS.md §10, shared/look.ts). Their own module so
 * the preload's bundle does not carry the style libraries look.ts reads.
 */
export const LOOK_CHANNELS = { export: 'look:export', import: 'look:import' } as const
