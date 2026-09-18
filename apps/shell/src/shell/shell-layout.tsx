/**
 * What the shell puts on the screen.
 *
 * Three rows: the header, the override strip when one is active, and the
 * region the mounted App fills. The App's region gets no padding, no
 * background of its own and no page header — the shell deliberately stops at
 * the boundary.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMatches } from '@tanstack/react-router'
import { useMfeRuntime, type BreadcrumbItem } from '@company/mfe-react'
import { AppShell, AppShellBody, AppShellMain } from '@tecton/react/tecton/app-shell'
import { ShortcutsProvider } from '@tecton/react/tecton/shortcuts'
import { Toaster } from '@tecton/react/components/sonner'

import { CommandPalette } from './command-palette.tsx'
import { DiagnosticsDialog } from './diagnostics-dialog.tsx'
import { OverrideBanner } from './override-banner.tsx'
import { ShellHeader } from './header.tsx'
import { useAppEntries, useQuarantinedEntries } from './registry-view.ts'
import { useShellChrome } from './shell-context.tsx'
import { useShellBreadcrumbContribution, useShellTheme } from './store-hooks.ts'
import { workspace } from './workspace.ts'

export function ShellLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  const { activeOverrides, registryError } = useShellChrome()
  const quarantined = useQuarantinedEntries()

  useThemeClass()
  useShellBreadcrumbContribution(useShellTrail())

  const diagnosticCount = quarantined.length + (registryError ? 1 : 0)

  return (
    // One registry for the whole page: the shell registers ⌘K against it and a
    // mounted App registers its own shortcuts into the same one.
    <ShortcutsProvider>
      <AppShell>
        <ShellHeader
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
          diagnosticCount={diagnosticCount}
        />
        <OverrideBanner activeOverrides={activeOverrides} />
        <AppShellBody>
          <AppShellMain className="flex">{children}</AppShellMain>
        </AppShellBody>
      </AppShell>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <DiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
      <Toaster position="bottom-right" />
    </ShortcutsProvider>
  )
}

/**
 * The shell's own contribution to the trail: the workspace root, and the App
 * the registry says is mounted at the active boundary. A mounted App appends
 * its route-derived items after these, and the store composes the two.
 */
function useShellTrail(): readonly BreadcrumbItem[] {
  const matches = useMatches()
  const apps = useAppEntries()

  const appId = matches
    .map(match => (match.params as { appId?: string }).appId)
    .find(id => typeof id === 'string' && id !== '')

  return useMemo(() => {
    const items: BreadcrumbItem[] = [
      { key: 'workspace', label: workspace.name, href: '/' },
    ]

    const entry = apps.find(app => app.id === appId)
    if (entry) {
      items.push({
        key: `app:${entry.id}`,
        label: entry.title ?? entry.id,
        href: `/${entry.id}`,
      })
    }

    return items
  }, [apps, appId])
}

/**
 * Mirrors the shell theme onto the document, which is what the design system's
 * `dark` variant keys off. The MFEs read the same value through `useTheme()`,
 * so the toggle is observable on both sides of the boundary.
 */
function useThemeClass(): void {
  const runtime = useMfeRuntime('the shell theme')
  const theme = useShellTheme()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme, runtime])
}
