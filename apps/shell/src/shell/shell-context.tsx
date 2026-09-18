/**
 * Boot facts the chrome needs and the runtime does not carry.
 *
 * `activeOverrides` is decided once, before anything is registered, so it is a
 * boot fact rather than live state; it is passed down instead of re-read.
 */

import { createContext, useContext, type ReactNode } from 'react'

export interface ShellChrome {
  /** Definition id → the manifest URL a developer override redirected it to. */
  readonly activeOverrides: ReadonlyMap<string, string>
  /** Set when `registry.json` itself could not be fetched or parsed. */
  readonly registryError: Error | null
}

const ChromeContext = createContext<ShellChrome | null>(null)

export function ShellChromeProvider({
  value,
  children,
}: {
  readonly value: ShellChrome
  readonly children: ReactNode
}): ReactNode {
  return <ChromeContext value={value}>{children}</ChromeContext>
}

export function useShellChrome(): ShellChrome {
  const value = useContext(ChromeContext)
  if (!value) throw new Error('useShellChrome must be used inside <ShellChromeProvider>')
  return value
}
