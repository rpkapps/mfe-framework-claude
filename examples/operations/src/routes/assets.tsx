import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { assetsQueryOptions } from '../queries/assets.ts'

export const Route = createFileRoute('/assets')({
  staticData: { breadcrumb: 'Assets' },
  // Native search validation. A parent that needs to pass data to this App uses
  // documented search parameters rather than a hidden input channel.
  validateSearch: z.object({ site: z.string().default('north') }),
  loaderDeps: ({ search }) => ({ site: search.site }),
  loader: ({ context, deps }) => {
    context.mfe.telemetry.debug('Loading assets', { site: deps.site })
    // The loader and the component use the same options, so they share one
    // cache entry instead of fetching twice.
    return context.queryClient.ensureQueryData(assetsQueryOptions(deps.site))
  },
  component: Assets,
})

function Assets() {
  const { site } = Route.useSearch()
  const { data } = useSuspenseQuery(assetsQueryOptions(site))

  return (
    <table className="w-full text-sm">
      <caption className="pb-2 text-left text-muted-foreground">Assets at site {site}</caption>
      <tbody>
        {data.map(asset => (
          <tr key={asset.id} className="border-b border-border">
            <td className="py-2">{asset.name}</td>
            <td className="py-2 text-muted-foreground">{asset.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
