/** The shortcut list is the live action snapshot rather than a table written here, so it gains and loses rows as you navigate (§26). */

import { useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HOST_SCOPE, useApps, useMfeRuntime, type MfeRuntime } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@tecton/react/components/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@tecton/react/components/item'
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@tecton/react/components/sheet'
import { ShortcutKeys } from '@tecton/react/tecton/shortcuts'
import {
  AppWindowIcon,
  BoxIcon,
  BugIcon,
  LayersIcon,
  SparklesIcon,
  TerminalIcon,
} from 'lucide-react'

import { shellUi } from './ui-store.ts'

type ActionEntry = ReturnType<MfeRuntime['actions']['getSnapshot']>[number]

const CONCEPTS: readonly {
  readonly icon: typeof AppWindowIcon
  readonly title: string
  readonly body: string
}[] = [
  {
    icon: AppWindowIcon,
    title: 'Applications take URLs',
    body: 'Each one is deployed on its own and owns a prefix of the address bar. Switch between them from the workspace menu at the top left, or from the command palette.',
  },
  {
    icon: BoxIcon,
    title: 'Widgets take props',
    body: 'A Widget is embedded rather than routed. The dashboard on the shell’s own page mounts them from the registry, passing the inputs their published schema declares.',
  },
  {
    icon: LayersIcon,
    title: 'The registry decides what exists',
    body: 'Everything on the page was read from it at boot. If a surface is missing, the registry view says whether it was never registered or was rejected, and why.',
  },
  {
    icon: TerminalIcon,
    title: 'Actions come from the mount that owns them',
    body: 'The palette lists them and runs them; the application that registered an action decides whether it may run, and a denied one stays listed with its reason.',
  },
]

export function HelpSheet({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const runtime = useMfeRuntime('the shell help sheet')
  const actions = useSyncExternalStore(
    runtime.actions.subscribe,
    runtime.actions.getSnapshot,
    runtime.actions.getSnapshot,
  )
  const apps = useApps()
  const navigate = useNavigate()

  // Only the keys that can fire: the runtime leaves a refused shortcut off its entry.
  const shortcuts = actions.filter(entry => entry.shortcut !== undefined)
  const groups = new Map<string, ActionEntry[]>()
  for (const entry of shortcuts) {
    const group =
      entry.definitionId === HOST_SCOPE
        ? 'Shell'
        : (runtime.registry.entries.get(entry.definitionId)?.title ?? entry.definitionId)
    groups.set(group, [...(groups.get(group) ?? []), entry])
  }

  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} side="right" className="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Help</SheetTitle>
        <SheetDescription>
          What the pieces of this page are, and every key that currently does something.
        </SheetDescription>
      </SheetHeader>

      {/* Scrolls between the sheet's fixed header and footer, at the padding they use. */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-6 pb-2">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">How this page works</h3>
            <div className="flex flex-col gap-2">
              {CONCEPTS.map(concept => (
                <Card key={concept.title} size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <concept.icon aria-hidden className="size-4 text-muted-foreground" />
                      {concept.title}
                    </CardTitle>
                    <CardDescription>{concept.body}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Keyboard</h3>
              <span className="text-xs text-muted-foreground">
                {shortcuts.length} registered right now
              </span>
            </div>
            {[...groups].map(([group, entries]) => (
              <div key={group} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{group}</span>
                <ItemGroup className="gap-1">
                  {entries.map(entry => (
                    <Item key={entry.id} variant="muted" size="xs">
                      <ItemContent>
                        <ItemTitle className="font-normal">{entry.label}</ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <ShortcutKeys keys={entry.shortcut ?? ''} />
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Where to go next</h3>
            <div className="flex flex-wrap gap-2">
              {apps.map(app => (
                <Button
                  key={app.id}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    shellUi.close()
                    void navigate({ to: '/$appId', params: { appId: app.id } })
                  }}
                >
                  {app.title ?? app.id}
                  {app.version === undefined ? null : (
                    <Badge variant="secondary">{app.version}</Badge>
                  )}
                </Button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <SheetFooter className="flex-row flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            shellUi.show('releases')
          }}
        >
          <SparklesIcon /> What’s new
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            shellUi.show('bug')
          }}
        >
          <BugIcon /> Report a bug
        </Button>
      </SheetFooter>
    </Sheet>
  )
}
