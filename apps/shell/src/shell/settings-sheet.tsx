/**
 * Only what the shell actually owns; an application's settings are the application's, so the
 * list at the bottom links to the settings pages the registry says each one published.
 */

import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApps, useCapabilityPages, useMfeRuntime, useTheme } from '@company/mfe-react'
import { devtools } from '@company/mfe-devtools'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@tecton/react/components/item'
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@tecton/react/components/sheet'
import { ToggleGroup, ToggleGroupItem } from '@tecton/react/components/toggle-group'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import {
  ExternalLinkIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MoonIcon,
  SunIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { EMPTY_LAYOUT } from './dashboard/layout-store.ts'
import { useDashboardLayout } from './hooks.ts'
import { DataList, DataRow, Mono } from './readout.tsx'
import { shellUi } from './ui-store.ts'
import { workspace } from './workspace.ts'

export function SettingsSheet({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const runtime = useMfeRuntime('the shell settings')
  const navigate = useNavigate()
  const apps = useApps()
  const theme = useTheme()
  const [layout, setLayout] = useDashboardLayout()

  // Only the settings pages: flattening every capability put each application's help and release
  // notes under the same heading (§26).
  const capabilities = useCapabilityPages('settings')

  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} side="right" className="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Settings</SheetTitle>
        <SheetDescription>
          What the shell owns for this page. Everything else belongs to the application that is
          mounted in it.
        </SheetDescription>
      </SheetHeader>

      {/* Scrolls between the sheet's fixed header and footer, at the padding they use. */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-6 pb-2">
          <Section title="Appearance" hint="Shared with every mounted application">
            <Item variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>Theme</ItemTitle>
                <ItemDescription className="whitespace-normal">
                  Applied to the document, and published to every mount through the shell state.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ToggleGroup
                  aria-label="Theme"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[theme]}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  onSelectionChange={keys => {
                    const next = [...keys][0]
                    if (next !== 'light' && next !== 'dark') return
                    runtime.shellState.apply({ theme: next })
                  }}
                >
                  <ToggleGroupItem id="light" aria-label="Light theme">
                    <SunIcon /> Light
                  </ToggleGroupItem>
                  <ToggleGroupItem id="dark" aria-label="Dark theme">
                    <MoonIcon /> Dark
                  </ToggleGroupItem>
                </ToggleGroup>
              </ItemActions>
            </Item>
          </Section>

          <Section title="Widget dashboard" hint={`${String(layout.tiles.length)} tiles saved`}>
            <p className="text-sm text-muted-foreground">
              The canvas on the shell’s own page. It is kept in this browser under the shell’s own
              key, not under any Widget’s.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  shellUi.close()
                  void navigate({ to: '/' })
                }}
              >
                <LayoutDashboardIcon /> Open the dashboard
              </Button>
              <Button
                variant="outline"
                size="sm"
                isDisabled={layout.tiles.length === 0}
                onPress={() => {
                  setLayout(EMPTY_LAYOUT)
                  toast.success('The dashboard canvas was cleared.')
                }}
              >
                <Trash2Icon /> Clear the canvas
              </Button>
            </div>
          </Section>

          {capabilities.length === 0 ? null : (
            <Section title="Application settings" hint="Published by each container">
              <p className="text-sm text-muted-foreground">
                A settings page is an ordinary route that its application marked as a capability.
                The shell reads the mark from the registry and decides where it opens; it does not
                know what is on the page.
              </p>
              <ItemGroup className="gap-1">
                {capabilities.map(({ app, capability }) => (
                  <Item
                    key={`${app.id}:${capability.name}`}
                    variant="muted"
                    size="sm"
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => {
                      shellUi.close()
                      void navigate({
                        to: '/$appId/$',
                        params: { appId: app.id, _splat: capability.path.replace(/^\//, '') },
                      })
                    }}
                  >
                    <ItemMedia variant="icon">
                      <ExternalLinkIcon aria-hidden className="text-muted-foreground" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="font-normal">{capability.label}</ItemTitle>
                      <ItemDescription className="font-mono">
                        /{app.id}
                        {capability.path}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </Section>
          )}

          <Section title="This page" hint="For a bug report or a support call">
            <DataList>
              <DataRow label="Workspace">{workspace.name}</DataRow>
              <DataRow label="Applications">{apps.length}</DataRow>
              <DataRow label="Registry">
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="success" appearance="outline">
                    {runtime.registry.entries.size} loaded
                  </Badge>
                  {runtime.registry.rejected.length === 0 ? null : (
                    <Badge variant="destructive" appearance="outline">
                      {runtime.registry.rejected.length} rejected
                    </Badge>
                  )}
                </span>
              </DataRow>
              <DataRow label="Signed in">
                <span className="flex min-w-0 flex-col">
                  <span>{runtime.shellState.getUser()?.name ?? 'nobody'}</span>
                  <Mono className="text-muted-foreground">
                    {runtime.shellState.getUser()?.email ?? '—'}
                  </Mono>
                </span>
              </DataRow>
            </DataList>
          </Section>
        </div>
      </div>

      <SheetFooter className="flex-row flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            devtools.open('registry')
          }}
        >
          <LayersIcon /> Registry and overrides
        </Button>
        <CopyButton
          variant="outline"
          size="sm"
          value={formatReport(
            'Shell diagnostics',
            'Copied from settings.',
            collectDiagnostics(runtime),
          )}
          onCopied={() => {
            toast.success('Diagnostics copied to the clipboard.')
          }}
        >
          Copy diagnostics
        </CopyButton>
      </SheetFooter>
    </Sheet>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string
  readonly hint?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}
