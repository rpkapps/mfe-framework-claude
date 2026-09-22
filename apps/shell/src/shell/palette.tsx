/**
 * Applications and their capability pages come from the registry, so the palette gains a
 * destination when a container is deployed and the shell is not rebuilt. The shell registers its
 * own commands exactly as a mounted application does, and both arrive through one snapshot (§26).
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
  useTheme,
  useWidgets,
  type Decision,
  type MfeRuntime,
  type RegistryEntry,
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
import { ShortcutKeys, useShortcuts } from '@tecton/react/tecton/shortcuts'
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
import type { ShellTheme } from './preferences.ts'
import { shellUi } from './ui-store.ts'

type CommandEntry = ReturnType<MfeRuntime['commands']['getSnapshot']>[number]

/** What a shell command reads at the moment it is drawn, or run. */
interface Live {
  readonly runtime: MfeRuntime
  readonly theme: ShellTheme
  readonly layout: DashboardLayout
  readonly setLayout: StoredStateSetter<DashboardLayout>
}

/**
 * One row of the palette, whatever produced it. `text` is extra search words. The trailing column
 * is one of two things and never both: `keys` is a shortcut, drawn as key caps; `hint` is a word
 * — a version, a path, a Widget id, a tile count, the reason a command is denied.
 */
interface Row {
  readonly id: string
  readonly text: string
  readonly icon: ReactNode
  readonly label: string
  /** Registry syntax, as the shortcut itself is written: `g r`, `mod+j`. */
  readonly keys?: string | undefined
  readonly hint?: string | undefined
  readonly isDisabled?: boolean
  readonly run: () => void
}

/** A shell command: from what it can read now, to the row it draws. */
type HostCommand = (live: Live) => Omit<Row, 'id' | 'isDisabled' | 'keys'> & {
  canExecute?: () => Decision
  /**
   * The id of the shortcut whose keys this row shows, looked up in the live registry rather than
   * typed out here, so the palette and the header cannot disagree about a key (§26).
   */
  shortcut?: string
}

const HOST_COMMANDS: Readonly<Record<string, HostCommand>> = {
  registry: () => ({
    label: 'Open the registry',
    icon: <LayersIcon />,
    shortcut: 'shell.registry',
    text: 'loaded rejected entries',
    run: () => devtools.open('registry'),
  }),
  settings: () => ({
    label: 'Open settings',
    icon: <SettingsIcon />,
    shortcut: 'shell.settings',
    text: 'theme dashboard overrides',
    run: () => shellUi.show('settings'),
  }),
  help: () => ({
    label: 'Help and keyboard shortcuts',
    icon: <CircleHelpIcon />,
    shortcut: 'shell.help',
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
    shortcut: 'shell.theme',
    text: 'switch light dark',
    run: () => live.runtime.shellState.apply({ theme: live.theme === 'dark' ? 'light' : 'dark' }),
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
    // Listed and denied rather than hidden: a control that disappears reads as a lost feature.
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
  const theme = useTheme()
  const [layout, setLayout] = useDashboardLayout()
  // The same registry the header registers into and the help sheet lists (§26).
  const shortcuts = useShortcuts()
  const commands = useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )

  useEffect(() => {
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  const current: Live = { runtime, theme, layout, setLayout }
  const live = useRef(current)
  useEffect(() => {
    live.current = current
  })

  // Registered once for as long as this runtime lives, so what changes is read through the ref
  // when the command runs.
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

  /** A shortcut nothing has registered draws no caps, rather than caps for a key that is dead. */
  const keysFor = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : shortcuts.find(shortcut => shortcut.id === id)?.keys

  const add = (entry: RegistryEntry): void => {
    // The canvas prompts for a Widget's inputs; the palette cannot, it is closing.
    const needsInputs = needsInputPrompt(entry.contract)
    const inputs = defaultInputsFor(describeWidgetInputs(entry.contract))
    // No canvas is measured from here, so the tile is placed against a nominal one and the
    // canvas refits it to its real width on the way in.
    setLayout(value => addTile(value, { key: tileKey(entry.id), widgetId: entry.id, inputs }))
    void navigate({ to: '/' })
    toast.success(`${entry.title ?? entry.id} added to the dashboard`, {
      description: needsInputs
        ? 'It needs inputs — open its tile to set them.'
        : 'Mounted with the inputs its schema declares.',
    })
  }

  // Drawn from the table rather than the snapshot, because a registration is not remade when the
  // theme flips.
  const commandRow = (entry: CommandEntry): Row => {
    const { allowed } = entry.decision
    const command = HOST_COMMANDS[entry.name]?.(current)
    return {
      text: entry.definitionId,
      icon: allowed ? <TerminalIcon /> : <BanIcon />,
      label: entry.label,
      // A mount command's trailing column names its owner; one of the shell's shows its keys.
      hint: command === undefined ? entry.definitionId : undefined,
      ...command,
      keys: keysFor(command?.shortcut),
      // A denied row spends that column on the reason instead, which is the whole point of
      // listing it rather than hiding it.
      ...(allowed ? {} : { hint: entry.decision.reason, keys: undefined }),
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
      keys: keysFor('shell.dashboard'),
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
              {/* `tracking-widest` is for a word in this slot; it would space out the key caps. */}
              {row.keys === undefined ? null : (
                <CommandShortcut className="tracking-normal">
                  <ShortcutKeys keys={row.keys} />
                </CommandShortcut>
              )}
              {row.hint === undefined ? null : <CommandShortcut>{row.hint}</CommandShortcut>}
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
