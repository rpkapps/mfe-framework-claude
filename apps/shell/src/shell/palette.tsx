/**
 * The command palette.
 *
 * Three kinds of thing are listed, and the difference matters. Applications and
 * their capability pages come from the registry, so the palette gains a
 * destination when a container is deployed and the shell is not rebuilt. The
 * shell's own commands are the shell's. And everything under "from the mounted
 * application" was registered by a live mount and reaches here through
 * `runtime.commands`, decision included — a denied command stays listed with
 * the reason its owner gave and cannot be run, because hiding it would leave
 * the user guessing.
 *
 * `evaluateAll()` runs only when the palette opens: updating one command must
 * not re-evaluate the rest.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
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
import { toast } from 'sonner'
import {
  AppWindowIcon,
  BanIcon,
  BoxIcon,
  BugIcon,
  CircleHelpIcon,
  ClipboardCopyIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LinkIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { addTile, setTiles, tileKey } from './dashboard/layout-store.ts'
import { initialValues, readInputFields, toInputs } from './dashboard/input-schema.ts'
import { useApps, useCapabilityPages, useDashboardLayout, useTheme, useWidgets } from './hooks.ts'
import { shellUi } from './ui-store.ts'

export function CommandPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const runtime = useMfeRuntime('the shell command palette')
  const navigate = useNavigate()
  const apps = useApps()
  const widgets = useWidgets()
  const pages = useCapabilityPages()
  const theme = useTheme()
  const layout = useDashboardLayout()
  const commands = useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )

  useEffect(() => {
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  const close = (): void => {
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search or jump to…"
      description="Switch application, open a shell surface, or run a command the mounted application registered."
    >
      <Command>
        <CommandInput placeholder="Search applications, pages and commands…" />
        <CommandList renderEmptyState={() => <CommandEmpty>No results found.</CommandEmpty>}>
          <CommandGroup heading="Go to">
            <CommandItem
              id="shell:dashboard"
              textValue="Widget dashboard home"
              onAction={() => {
                close()
                void navigate({ to: '/' })
              }}
            >
              <LayoutDashboardIcon />
              <span>Widget dashboard</span>
              <CommandShortcut>G D</CommandShortcut>
            </CommandItem>
            {apps.map(app => (
              <CommandItem
                key={app.id}
                id={app.id}
                textValue={`${app.title ?? app.id} ${app.id} application`}
                onAction={() => {
                  close()
                  void navigate({ to: '/$appId', params: { appId: app.id } })
                }}
              >
                <AppWindowIcon />
                <span>{app.title ?? app.id}</span>
                <CommandShortcut>{app.version ?? 'app'}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          {pages.length === 0 ? null : (
            <>
              <CommandSeparator />
              <CommandGroup heading="Application pages">
                {pages.map(page => (
                  <CommandItem
                    key={`${page.app.id}:${page.name}`}
                    id={`${page.app.id}:${page.name}`}
                    textValue={`${page.label} ${page.app.title ?? page.app.id} ${page.name}`}
                    onAction={() => {
                      close()
                      void navigate({
                        to: '/$appId/$',
                        params: { appId: page.app.id, _splat: page.path.replace(/^\//, '') },
                      })
                    }}
                  >
                    <SettingsIcon />
                    <span>{page.label}</span>
                    <CommandShortcut>
                      /{page.app.id}
                      {page.path}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {widgets.length === 0 ? null : (
            <>
              <CommandSeparator />
              <CommandGroup heading="Add to the dashboard">
                {widgets.map(entry => (
                  <CommandItem
                    key={`add:${entry.id}`}
                    id={`add:${entry.id}`}
                    textValue={`Add ${entry.title ?? entry.id} widget to dashboard`}
                    onAction={() => {
                      close()
                      const fields = readInputFields(entry.contract)
                      addTile({
                        key: tileKey(entry.id),
                        widgetId: entry.id,
                        inputs: toInputs(fields, initialValues(fields, {})),
                        span: 6,
                      })
                      void navigate({ to: '/' })
                      toast.success(`${entry.title ?? entry.id} added to the dashboard`, {
                        description:
                          fields?.some(field => field.required) === true
                            ? 'It needs inputs — open its tile to set them.'
                            : 'Mounted with the inputs its schema declares.',
                      })
                    }}
                  >
                    <BoxIcon />
                    <span>Add {entry.title ?? entry.id}</span>
                    <CommandShortcut>{entry.id}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="Shell">
            <CommandItem
              id="shell:registry"
              textValue="Open the registry loaded rejected entries"
              onAction={() => {
                shellUi.show('registry')
              }}
            >
              <LayersIcon />
              <span>Open the registry</span>
              <CommandShortcut>G R</CommandShortcut>
            </CommandItem>
            <CommandItem
              id="shell:settings"
              textValue="Open settings theme dashboard overrides"
              onAction={() => {
                shellUi.show('settings')
              }}
            >
              <SettingsIcon />
              <span>Open settings</span>
              <CommandShortcut>G S</CommandShortcut>
            </CommandItem>
            <CommandItem
              id="shell:help"
              textValue="Help keyboard shortcuts"
              onAction={() => {
                shellUi.show('help')
              }}
            >
              <CircleHelpIcon />
              <span>Help and keyboard shortcuts</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
            <CommandItem
              id="shell:releases"
              textValue="What is new release notes"
              onAction={() => {
                shellUi.show('releases')
              }}
            >
              <SparklesIcon />
              <span>What’s new</span>
            </CommandItem>
            <CommandItem
              id="shell:bug"
              textValue="Report a bug diagnostics"
              onAction={() => {
                shellUi.show('bug')
              }}
            >
              <BugIcon />
              <span>Report a bug</span>
            </CommandItem>
            <CommandItem
              id="shell:theme"
              textValue="Switch theme light dark"
              onAction={() => {
                close()
                runtime.shellState.apply({ theme: theme === 'dark' ? 'light' : 'dark' })
              }}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
              <CommandShortcut>⌘J</CommandShortcut>
            </CommandItem>
            <CommandItem
              id="shell:copy-url"
              textValue="Copy a link to this page"
              onAction={() => {
                close()
                void copyToClipboard(window.location.href, 'Link copied to the clipboard.')
              }}
            >
              <LinkIcon />
              <span>Copy a link to this page</span>
            </CommandItem>
            <CommandItem
              id="shell:copy-diagnostics"
              textValue="Copy diagnostics support"
              onAction={() => {
                close()
                void copyToClipboard(
                  formatReport(
                    'Shell diagnostics',
                    'Copied from the command palette.',
                    collectDiagnostics(runtime),
                  ),
                  'Diagnostics copied to the clipboard.',
                )
              }}
            >
              <ClipboardCopyIcon />
              <span>Copy diagnostics</span>
            </CommandItem>
            {layout.tiles.length === 0 ? null : (
              <CommandItem
                id="shell:clear-dashboard"
                textValue="Clear the dashboard canvas"
                onAction={() => {
                  close()
                  setTiles([])
                  toast.success('The dashboard canvas was cleared.')
                }}
              >
                <Trash2Icon />
                <span>Clear the dashboard canvas</span>
                <CommandShortcut>{layout.tiles.length} tiles</CommandShortcut>
              </CommandItem>
            )}
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
                      close()
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

async function copyToClipboard(value: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(success)
  } catch {
    toast.error('This browser would not give the page the clipboard.')
  }
}
