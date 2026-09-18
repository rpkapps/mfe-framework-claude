/**
 * The shell command palette.
 *
 * Two kinds of entry share it. Shell commands (switch application, toggle the
 * theme) belong to the chrome. Everything else is registered by a live mount
 * and reaches the palette through `runtime.commands`, decision included: a
 * denied command is listed with the reason its owner gave and cannot be run
 * from here. `evaluateAll()` runs once when the palette opens, which is the
 * only moment every registration is re-checked.
 */

import { useEffect } from 'react'
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
import { AppWindowIcon, BanIcon, MoonIcon, SunIcon, TerminalIcon } from 'lucide-react'

import { useAppEntries } from './registry-view.ts'
import { useCommandEntries, useShellTheme } from './store-hooks.ts'
import { codeFor } from './workspace.ts'

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const runtime = useMfeRuntime('the shell command palette')
  const navigate = useNavigate()
  const apps = useAppEntries()
  const entries = useCommandEntries()
  const theme = useShellTheme()

  useEffect(() => {
    // Re-check every registration, but only here: updating one command must not
    // re-evaluate the rest, so nothing else in the shell calls this.
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  const close = (): void => onOpenChange(false)

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search or jump to…"
      description="Switch application, or run a command registered by the mounted application."
    >
      <Command className="rounded-none bg-transparent">
        <CommandInput placeholder="Search applications and commands…" />
        <CommandList
          className="max-h-[60svh]"
          renderEmptyState={() => <CommandEmpty>No results found.</CommandEmpty>}
        >
          <CommandGroup heading="Applications">
            {apps.map(app => (
              <CommandItem
                key={app.id}
                id={`app-${app.id}`}
                textValue={`${app.title ?? app.id} ${app.id}`}
                onAction={() => {
                  close()
                  void navigate({ to: '/$appId', params: { appId: app.id } })
                }}
              >
                <AppWindowIcon />
                <span>{app.title ?? app.id}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {codeFor(app.id, app.icon)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Shell">
            <CommandItem
              id="shell-theme"
              textValue="Toggle theme"
              onAction={() => {
                close()
                runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
              }}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
            </CommandItem>
          </CommandGroup>

          {entries.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="From the mounted application">
                {entries.map(entry => {
                  const denied = !entry.decision.allowed
                  return (
                    <CommandItem
                      key={entry.id}
                      id={entry.id}
                      textValue={`${entry.label} ${entry.definitionId}`}
                      // A denied command stays visible with its reason, and is
                      // not runnable: hiding it would leave the user guessing.
                      isDisabled={denied}
                      onAction={() => {
                        if (denied) return
                        close()
                        void runtime.commands.execute(entry.id)
                      }}
                    >
                      {denied ? <BanIcon /> : <TerminalIcon />}
                      <span>{entry.label}</span>
                      <CommandShortcut>
                        {entry.decision.allowed ? entry.definitionId : entry.decision.reason}
                      </CommandShortcut>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
