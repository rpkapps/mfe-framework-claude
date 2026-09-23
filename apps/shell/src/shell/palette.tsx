/**
 * Applications and their capability pages come from the registry, so the palette gains a
 * destination when a container is deployed and the shell is not rebuilt. The shell registers its
 * own commands exactly as a mounted application does, and both arrive through one snapshot (§26),
 * each with the shortcut the runtime will run it for.
 */

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  defaultInputsFor,
  describeWidgetInputs,
  HOST_SCOPE,
  needsInputPrompt,
  useApps,
  useCapabilityPages,
  useMfeRuntime,
  useTheme,
  useWidgets,
  type MfeRuntime,
  type RegistryEntry,
} from '@company/mfe-react'
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
import { ShortcutKeys } from '@tecton/react/tecton/shortcuts'
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

import { addTile, tileKey, type DashboardLayout } from './dashboard/layout-store.ts'
import { useDashboardLayout } from './hooks.ts'
import type { ShellTheme } from './preferences.ts'

type CommandEntry = ReturnType<MfeRuntime['commands']['getSnapshot']>[number]

/** What a shell command's row reads at the moment it is drawn. */
interface Live {
  readonly theme: ShellTheme
  readonly layout: DashboardLayout
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

/**
 * How a shell command is drawn, by the name `shell-commands.ts` registers it under; what it does
 * is registered there, so a key and a row run the same thing.
 */
type HostFace = (live: Live) => Pick<Row, 'icon' | 'text' | 'hint'>

const HOST_FACES: Readonly<Record<string, HostFace>> = {
  registry: () => ({ icon: <LayersIcon />, text: 'loaded rejected entries' }),
  settings: () => ({ icon: <SettingsIcon />, text: 'theme dashboard overrides' }),
  help: () => ({ icon: <CircleHelpIcon />, text: 'keyboard shortcuts' }),
  releases: () => ({ icon: <SparklesIcon />, text: 'what is new release notes' }),
  bug: () => ({ icon: <BugIcon />, text: 'diagnostics report' }),
  theme: live => ({
    icon: live.theme === 'dark' ? <SunIcon /> : <MoonIcon />,
    text: 'switch light dark',
  }),
  'copy-url': () => ({ icon: <LinkIcon />, text: 'copy link share' }),
  'copy-diagnostics': () => ({ icon: <ClipboardCopyIcon />, text: 'copy support' }),
  'clear-dashboard': live => ({
    icon: <Trash2Icon />,
    hint: `${String(live.layout.tiles.length)} tiles`,
    text: 'remove every widget canvas',
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
  // The same snapshot the help sheet lists and the key listener reads (§26).
  const commands = useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )

  useEffect(() => {
    if (open) runtime.commands.evaluateAll()
  }, [open, runtime])

  const live: Live = { theme, layout }

  const close = (): void => {
    onOpenChange(false)
  }

  /** A shortcut the runtime refused draws no caps, rather than caps for a key that is dead. */
  const keysFor = (id: string): string | undefined =>
    commands.find(entry => entry.id === id)?.shortcut

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

  const commandRow = (entry: CommandEntry): Row => {
    const { allowed } = entry.decision
    const face = entry.definitionId === HOST_SCOPE ? HOST_FACES[entry.name]?.(live) : undefined
    return {
      text: entry.definitionId,
      icon: allowed ? <TerminalIcon /> : <BanIcon />,
      label: entry.label,
      ...face,
      // The trailing column shows the keys when there are any; otherwise a mount command's names
      // its owner, and a shell command's says what its face says.
      ...(entry.shortcut === undefined
        ? { hint: face === undefined ? entry.definitionId : face.hint }
        : { keys: entry.shortcut, hint: undefined }),
      // A denied row spends that column on the reason instead, which is the whole point of
      // listing it rather than hiding it.
      ...(allowed ? {} : { hint: entry.decision.reason, keys: undefined }),
      id: entry.id,
      isDisabled: !allowed,
      run: () => void runtime.commands.execute(entry.id),
    }
  }

  const listed = commands.filter(entry => entry.placements.includes('command-palette'))
  const host = listed.filter(entry => entry.definitionId === HOST_SCOPE).map(commandRow)
  const mounted = listed.filter(entry => entry.definitionId !== HOST_SCOPE).map(commandRow)

  const destinations: readonly Row[] = [
    {
      id: 'shell:dashboard',
      text: 'home widgets',
      icon: <LayoutDashboardIcon />,
      label: 'Widget dashboard',
      keys: keysFor(`${HOST_SCOPE}:dashboard`),
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
