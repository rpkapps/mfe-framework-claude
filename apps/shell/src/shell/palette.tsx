/**
 * The command palette.
 *
 * Applications come from the registry; everything else is registered by a live
 * mount and reaches here through `runtime.commands`, decision included. A
 * denied command stays listed with the reason its owner gave and cannot be run
 * — hiding it would leave the user guessing. `evaluateAll()` runs only when the
 * palette opens, because updating one command must not re-evaluate the rest.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMfeRuntime } from '@company/mfe-react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@tecton/react/components/command'
import {
  AppWindowIcon,
  BanIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MoonIcon,
  SunIcon,
  TerminalIcon,
} from 'lucide-react'

import { useApps, useTheme } from './hooks.ts'

export function CommandPalette({
  open,
  onOpenChange,
  onOpenRegistry,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onOpenRegistry: () => void
}) {
  const runtime = useMfeRuntime('the shell command palette')
  const navigate = useNavigate()
  const apps = useApps()
  const theme = useTheme()
  const commands = useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )

  useEffect(() => {
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search or jump to…"
      description="Switch application, or run a command the mounted application registered."
    >
      <Command>
        <CommandInput placeholder="Search applications and commands…" />
        <CommandList renderEmptyState={() => <CommandEmpty>No results found.</CommandEmpty>}>
          <CommandGroup heading="Shell pages">
            <CommandItem
              id="shell:dashboard"
              textValue="Widget dashboard"
              onAction={() => {
                onOpenChange(false)
                void navigate({ to: '/' })
              }}
            >
              <LayoutDashboardIcon />
              <span>Widget dashboard</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Applications">
            {apps.map(app => (
              <CommandItem
                key={app.id}
                id={app.id}
                textValue={`${app.title ?? app.id} ${app.id}`}
                onAction={() => {
                  onOpenChange(false)
                  void navigate({ to: '/$appId', params: { appId: app.id } })
                }}
              >
                <AppWindowIcon />
                <span>{app.title ?? app.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Shell">
            <CommandItem
              id="shell:registry"
              textValue="Open the registry"
              onAction={() => {
                onOpenChange(false)
                onOpenRegistry()
              }}
            >
              <LayersIcon />
              <span>Open the registry</span>
            </CommandItem>
            <CommandItem
              id="shell:theme"
              textValue="Switch theme"
              onAction={() => {
                onOpenChange(false)
                runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
              }}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
            </CommandItem>
          </CommandGroup>

          {commands.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="From the mounted application">
                {commands.map(entry => (
                  <CommandItem
                    key={entry.id}
                    id={entry.id}
                    textValue={`${entry.label} ${entry.definitionId}`}
                    isDisabled={!entry.decision.allowed}
                    onAction={() => {
                      if (!entry.decision.allowed) return
                      onOpenChange(false)
                      void runtime.commands.execute(entry.id)
                    }}
                  >
                    {entry.decision.allowed ? <TerminalIcon /> : <BanIcon />}
                    <span>{entry.label}</span>
                    <CommandShortcut>
                      {entry.decision.allowed ? entry.definitionId : entry.decision.reason}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
