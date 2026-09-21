/** Shared by the route loader and the component, so the two hit one cache entry rather than two. */

import { queryOptions } from '@tanstack/react-query'
import { fetch } from '#mfe/fetch'
import { z } from 'zod'

const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['operational', 'degraded', 'offline']),
})

export type Asset = z.infer<typeof assetSchema>

export function assetsQueryOptions(siteId: string) {
  return queryOptions({
    // Every variable that determines the response is in the key.
    queryKey: ['operations', 'assets', { siteId }],
    queryFn: async ({ signal }): Promise<Asset[]> => {
      const response = await fetch(`assets?site=${encodeURIComponent(siteId)}`, { signal })

      if (!response.ok) {
        throw new Error(
          `Loading assets for site ${siteId} failed with ${response.status} ${response.statusText}.`,
        )
      }

      return z.array(assetSchema).parse(await response.json())
    },
    staleTime: 30_000,
  })
}
