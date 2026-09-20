/**
 * What the shell says about the registry without being asked.
 */

import type { ReactNode } from 'react'
import { useMfeRuntime } from '@company/mfe-react'
import { devtools } from '@company/mfe-devtools'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { TriangleAlertIcon } from 'lucide-react'

import { notices } from './workspace.ts'

/**
 * The strip under the header, and the only thing the shell still renders about
 * the registry itself.
 *
 * The view moved into `@company/mfe-devtools`; this did not, and the split is
 * the point. The panel is opt-in — a developer turns it on — but an active
 * override has to be visible to somebody who never did, because an override
 * nobody can see is the phantom bug the whole mechanism exists to prevent. So
 * the strip is unconditional and its buttons turn the tools on.
 *
 * It is a line, not an alarm. A rejected entry is a fact about the registry,
 * and the shell around it is working; shouting about it on every page teaches
 * the developer to stop reading the strip, which is the one place the override
 * warning also lives.
 */
export function RegistryNotice(): ReactNode {
  const { quarantined } = useMfeRuntime('the shell notices').registry
  const { overrides, registryError } = notices
  if (overrides.size === 0 && quarantined.length === 0 && registryError === null) return null

  const rejected = quarantined.length + (registryError === null ? 0 : 1)

  /*
   * Everything here wraps. A strip that is one non-breaking row is fine at
   * 1440px and truncates its own link off the right edge of a phone — which
   * takes the only route to the explanation with it.
   */
  return (
    <div className="flex shrink-0 flex-col gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center">
      {overrides.size > 0 ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-warning-surface-foreground">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="font-medium">
            {overrides.size === 1
              ? 'A developer override is'
              : `${String(overrides.size)} developer overrides are`}{' '}
            active:
          </span>
          {[...overrides].map(([id, url]) => (
            <Badge key={id} variant="warning" appearance="outline" size="default">
              {id} → {url}
            </Badge>
          ))}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onPress={() => {
              devtools.open('overrides')
            }}
          >
            Manage
          </Button>
        </span>
      ) : null}

      {rejected > 0 ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-muted-foreground">
            {rejected} registry {rejected === 1 ? 'entry was' : 'entries were'} rejected — the rest
            of the page is unaffected.
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onPress={() => {
              devtools.open('registry')
            }}
          >
            See why
          </Button>
        </span>
      ) : null}
    </div>
  )
}
