/**
 * The shell's diagnostics surface.
 *
 * A quarantined registry entry is not a crash and not a console message: the
 * rest of the registry keeps working and the entry is reported here, with the
 * reason it was rejected and the repair its error carries. The same surface
 * shows a registry that could not be fetched at all, and the overrides in
 * force.
 */

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tecton/react/components/dialog'
import { Badge } from '@tecton/react/components/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@tecton/react/components/empty'

import { useAppEntries, useQuarantinedEntries } from './registry-view.ts'
import { useShellChrome } from './shell-context.tsx'

/**
 * A framework error carries a stable code alongside its message. The message
 * already spells out what was expected, what arrived and how to repair it, so
 * it is shown verbatim rather than re-worded here.
 */
function codeOf(error: Error): string | null {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export interface DiagnosticsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function DiagnosticsDialog({ open, onOpenChange }: DiagnosticsDialogProps) {
  const quarantined = useQuarantinedEntries()
  const apps = useAppEntries()
  const { activeOverrides, registryError } = useShellChrome()

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Shell diagnostics</DialogTitle>
        <DialogDescription>
          What the shell registry accepted at boot, and what it rejected.
        </DialogDescription>
      </DialogHeader>

      <div className="grid max-h-[60svh] gap-4 overflow-y-auto text-sm">
        <section className="grid gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Registry
          </h3>
          {registryError ? (
            <p className="rounded-md bg-destructive-surface px-3 py-2 text-destructive-surface-foreground">
              registry.json could not be read: {registryError.message}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {apps.length} application{apps.length === 1 ? '' : 's'} registered,{' '}
              {quarantined.length} entr{quarantined.length === 1 ? 'y' : 'ies'} quarantined.
            </p>
          )}
        </section>

        {activeOverrides.size > 0 ? (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Active developer overrides
            </h3>
            <ul className="grid gap-1">
              {[...activeOverrides].map(([id, url]) => (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning" size="md">
                    {id}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{url}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="grid gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Quarantined entries
          </h3>
          {quarantined.length === 0 ? (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyTitle>Every entry validated</EmptyTitle>
                <EmptyDescription>
                  Nothing in registry.json was rejected.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="grid gap-2">
              {quarantined.map(entry => {
                const code = codeOf(entry.error)
                return (
                  <li
                    key={entry.id}
                    className="grid gap-1 rounded-md border border-border-subtle bg-surface-alt px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="destructive" size="md">
                        {entry.id}
                      </Badge>
                      <span className="text-muted-foreground">{entry.reason}</span>
                      {code ? (
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                          {code}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs">{entry.error.message}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  )
}
