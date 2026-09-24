/**
 * Takes the loading screen away once React has committed the shell's first frame, so the chrome
 * fades in whole rather than being built in front of the user.
 */

import { useEffect, type ReactNode } from 'react'

import { revealShell } from '../loader.ts'

export function ShellReady(): ReactNode {
  useEffect(() => {
    revealShell()
  }, [])
  return null
}
