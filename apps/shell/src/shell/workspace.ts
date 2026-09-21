/** Boot facts the chrome shows, kept out of `boot.tsx` so no component module imports the entry (§18). */

export const workspace = { code: 'DSG', name: 'Discovery' } as const

export const notices: { overrides: ReadonlyMap<string, string>; registryError: Error | null } = {
  overrides: new Map(),
  registryError: null,
}
