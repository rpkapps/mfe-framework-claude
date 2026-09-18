/**
 * The active-override indicator.
 *
 * A developer override silently pointing an App at a dev server that is no
 * longer running is the phantom bug the whole override mechanism has to be
 * defended against, so this is deliberately loud: a full-width strip directly
 * under the header, naming every overridden id and the URL it now resolves to,
 * with the exact snippet that clears it.
 *
 * It renders nothing at all when no override is active, so in the normal case
 * the mounted App still owns every pixel below the header.
 */

import { Badge } from '@tecton/react/components/badge'
import { FlaskConicalIcon } from 'lucide-react'

/** The key `createMfeRuntime` reads. Repeated here only to print it. */
const OVERRIDES_KEY = 'company:mfe:overrides'

export interface OverrideBannerProps {
  readonly activeOverrides: ReadonlyMap<string, string>
}

export function OverrideBanner({ activeOverrides }: OverrideBannerProps) {
  if (activeOverrides.size === 0) return null

  const ids = [...activeOverrides.keys()]

  return (
    <div
      data-slot="shell-override-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning-surface px-3 py-1.5 text-xs text-warning-surface-foreground"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <FlaskConicalIcon className="size-3.5" />
        {ids.length === 1
          ? '1 application is loading from a developer override'
          : `${String(ids.length)} applications are loading from developer overrides`}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        {[...activeOverrides].map(([id, url]) => (
          <Badge key={id} variant="warning" appearance="outline" size="md">
            <span className="font-medium">{id}</span>
            <span className="opacity-80">→ {url}</span>
          </Badge>
        ))}
      </span>

      {/* The repair, spelled out: nobody should have to look it up. */}
      <code className="ml-auto rounded-sm bg-warning/15 px-1.5 py-0.5 font-mono text-[11px]">
        localStorage.removeItem(&apos;{OVERRIDES_KEY}&apos;)
      </code>
    </div>
  )
}
