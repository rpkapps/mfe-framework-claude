/**
 * Boot facts the chrome shows and the runtime does not carry.
 *
 * They live here rather than in `boot.tsx` so that a component module never has
 * to import the entry. React Refresh replaces a module by re-running it and the
 * modules that depend on it; an import edge pointing back at the entry drags
 * `createRoot` and the runtime construction into that set, and the update is
 * refused into a full page reload instead.
 */

/** The workspace the shell represents. A shell fact, not a registry one. */
export const workspace = { code: 'DSG', name: 'Discovery' } as const

/**
 * Decided once, before anything is registered, so they are module state rather
 * than a store: nothing here changes after boot.
 */
export const notices: { overrides: ReadonlyMap<string, string>; registryError: Error | null } = {
  overrides: new Map(),
  registryError: null,
}
