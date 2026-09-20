/**
 * The command palette.
 *
 * Applications and their capability pages come from the registry, so the
 * palette gains a destination when a container is deployed and the shell is not
 * rebuilt. Everything else is a command: the shell registers its own exactly as
 * a mounted application does, and both arrive through one snapshot. They stay
 * two groups because that is a grouping, not a second code path.
 */

import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  allow,
  defaultInputsFor,
  deny,
  describeWidgetInputs,
  HOST_SCOPE,
  needsInputPrompt,
  useApps,
  useCapabilityPages,
  useMfeRuntime,
  useStoredState,
  useWidgets,
  type Decision,
  type MfeRuntime,
  type NeutralRegistryEntry,
  type StoredStateSetter,
} from '@company/mfe-react'
import { devtools } from '@company/mfe-devtools'
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
import { addTile, EMPTY_LAYOUT, tileKey, type DashboardLayout } from './dashboard/layout-store.ts'
import { useDashboardLayout } from './hooks.ts'
import { BOOT_THEME, ThemeSchema, type ShellTheme } from './preferences.ts'
import { shellUi } from './ui-store.ts'

type CommandEntry = ReturnType<MfeRuntime['commands']['getSnapshot']>[number]

/** What a shell command reads at the moment it is drawn, or run. */
interface Live {
  readonly runtime: MfeRuntime
  readonly theme: ShellTheme
  readonly setTheme: StoredStateSetter<ShellTheme>
  readonly layout: DashboardLayout
  readonly setLayout: StoredStateSetter<DashboardLayout>
}

/** One row of the palette, whatever produced it. `text` is extra search words. */
interface Row {
  readonly id: string
  readonly text: string
  readonly icon: ReactNode
  readonly label: string
  readonly hint?: string
  readonly isDisabled?: boolean
  readonly run: () => void
}

/** A shell command: from what it can read now, to the row it draws. */
type HostCommand = (live: Live) => Omit<Row, 'id' | 'isDisabled'> & { canExecute?: () => Decision }

const HOST_COMMANDS: Readonly<Record<string, HostCommand>> = {
  registry: () => ({
    label: 'Open the registry',
    icon: <LayersIcon />,
    hint: 'G R',
    text: 'loaded rejected entries',
    run: () => devtools.open('registry'),
  }),
  settings: () => ({
    label: 'Open settings',
    icon: <SettingsIcon />,
    hint: 'G S',
    text: 'theme dashboard overrides',
    run: () => shellUi.show('settings'),
  }),
  help: () => ({
    label: 'Help and keyboard shortcuts',
    icon: <CircleHelpIcon />,
    hint: '?',
    text: 'keyboard shortcuts',
    run: () => shellUi.show('help'),
  }),
  releases: () => ({
    label: 'What’s new',
    icon: <SparklesIcon />,
    text: 'what is new release notes',
    run: () => shellUi.show('releases'),
  }),
  bug: () => ({
    label: 'Report a bug',
    icon: <BugIcon />,
    text: 'diagnostics report',
    run: () => shellUi.show('bug'),
  }),
  theme: live => ({
    label: live.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    icon: live.theme === 'dark' ? <SunIcon /> : <MoonIcon />,
    hint: '⌘J',
    text: 'switch light dark',
    run: () => live.setTheme(live.theme === 'dark' ? 'light' : 'dark'),
  }),
  'copy-url': () => ({
    label: 'Copy a link to this page',
    icon: <LinkIcon />,
    text: 'copy link share',
    run: () => void copyToClipboard(window.location.href, 'Link copied to the clipboard.'),
  }),
  'copy-diagnostics': live => ({
    label: 'Copy diagnostics',
    icon: <ClipboardCopyIcon />,
    text: 'copy support',
    run: () => {
      const detail = 'Copied from the command palette.'
      const report = formatReport('Shell diagnostics', detail, collectDiagnostics(live.runtime))
      void copyToClipboard(report, 'Diagnostics copied to the clipboard.')
    },
  }),
  'clear-dashboard': live => ({
    label: 'Clear the dashboard canvas',
    icon: <Trash2Icon />,
    hint: `${String(live.layout.tiles.length)} tiles`,
    text: 'remove every widget canvas',
    // Listed and denied rather than hidden: a control that disappears reads as
    // a shell that has lost the feature.
    canExecute: () =>
      live.layout.tiles.length === 0 ? deny('The dashboard canvas is already empty.') : allow(),
    run: () => {
      live.setLayout(EMPTY_LAYOUT)
      toast.success('The dashboard canvas was cleared.')
    },
  }),
}

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
  const [theme, setTheme] = useStoredState('theme', ThemeSchema, {
    defaultValue: BOOT_THEME,
    retention: 'browser',
  })
  const [layout, setLayout] = useDashboardLayout()
  const commands = useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )

  useEffect(() => {
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  const current: Live = { runtime, theme, setTheme, layout, setLayout }
  const live = useRef(current)
  useEffect(() => {
    live.current = current
  })

  // Registered once for as long as this runtime lives: what changes — the
  // theme, the tile count — is read through the ref when the command runs.
  useEffect(() => {
    const handles = Object.entries(HOST_COMMANDS).map(([name, command]) =>
      runtime.commands.registerHost({
        name,
        label: command(live.current).label,
        canExecute: () => command(live.current).canExecute?.() ?? allow(),
        execute: () => command(live.current).run(),
      }),
    )
    return () => {
      for (const handle of handles) handle.remove()
    }
  }, [runtime])

  const close = (): void => {
    onOpenChange(false)
  }

  const add = (entry: NeutralRegistryEntry): void => {
    // The canvas prompts for a Widget's inputs; the palette cannot, it is closing.
    const needsInputs = needsInputPrompt(entry.contract)
    const inputs = defaultInputsFor(describeWidgetInputs(entry.contract))
    const tile = { key: tileKey(entry.id), widgetId: entry.id, inputs, span: 6 } as const
    setLayout(value => addTile(value, tile))
    void navigate({ to: '/' })
    toast.success(`${entry.title ?? entry.id} added to the dashboard`, {
      description: needsInputs
        ? 'It needs inputs — open its tile to set them.'
        : 'Mounted with the inputs its schema declares.',
    })
  }

  // The shell's own are drawn from the table rather than from the snapshot,
  // because a registration is not remade when the theme flips.
  const commandRow = (entry: CommandEntry): Row => {
    const { allowed } = entry.decision
    const command = HOST_COMMANDS[entry.name]?.(current)
    return {
      text: entry.definitionId,
      icon: allowed ? <TerminalIcon /> : <BanIcon />,
      label: entry.label,
      // A mount command's shortcut column names its owner; one of the shell's
      // shows the keys it has, and an empty column when it has none.
      hint: command === undefined ? entry.definitionId : '',
      ...command,
      ...(allowed ? {} : { hint: entry.decision.reason }),
      id: entry.id,
      isDisabled: !allowed,
      run: () => void runtime.commands.execute(entry.id),
    }
  }

  const host = commands.filter(entry => entry.definitionId === HOST_SCOPE).map(commandRow)
  const mounted = commands.filter(entry => entry.definitionId !== HOST_SCOPE).map(commandRow)

  const destinations: readonly Row[] = [
    {
      id: 'shell:dashboard',
      text: 'home widgets',
      icon: <LayoutDashboardIcon />,
      label: 'Widget dashboard',
      hint: 'G W',
      run: () => void navigate({ to: '/' }),
    },
    ...apps.map(app => ({
      id: app.id,
      text: `${app.id} application`,
      icon: <AppWindowIcon />,
      label: app.title ?? app.id,
      hint: app.version ?? 'app',
      run: () => void navigate({ to: '/$appId', params: { appId: app.id } }),
    })),
  ]

  const capabilityPages: readonly Row[] = pages.map(({ app, capability }) => ({
    id: `${app.id}:${capability.name}`,
    text: `${app.title ?? app.id} ${capability.name}`,
    icon: <SettingsIcon />,
    label: capability.label,
    hint: `/${app.id}${capability.path}`,
    run: () => {
      const params = { appId: app.id, _splat: capability.path.replace(/^\//, '') }
      void navigate({ to: '/$appId/$', params })
    },
  }))

  const catalogue: readonly Row[] = widgets.map(entry => ({
    id: `add:${entry.id}`,
    text: `${entry.id} widget dashboard`,
    icon: <BoxIcon />,
    label: `Add ${entry.title ?? entry.id}`,
    hint: entry.id,
    run: () => add(entry),
  }))

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
          <Groups
            groups={[
              ['Go to', destinations],
              ['Application pages', capabilityPages],
              ['Add to the dashboard', catalogue],
              ['Shell', host],
              ['From the mounted application', mounted],
            ]}
            dismiss={close}
          />
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

/** Every group that has rows, separated. A row dismisses before it acts. */
function Groups({
  groups,
  dismiss,
}: {
  readonly groups: readonly (readonly [string, readonly Row[]])[]
  readonly dismiss: () => void
}): ReactNode {
  return groups
    .filter(([, rows]) => rows.length > 0)
    .map(([heading, rows], index) => (
      <Fragment key={heading}>
        {index === 0 ? null : <CommandSeparator />}
        <CommandGroup heading={heading}>
          {rows.map(row => (
            <CommandItem
              key={row.id}
              id={row.id}
              textValue={`${row.label} ${row.text}`}
              isDisabled={row.isDisabled === true}
              onAction={() => {
                dismiss()
                row.run()
              }}
            >
              {row.icon}
              <span>{row.label}</span>
              <CommandShortcut>{row.hint}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </Fragment>
    ))
}

async function copyToClipboard(value: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(success)
  } catch {
    toast.error('This browser would not give the page the clipboard.')
  }
}
