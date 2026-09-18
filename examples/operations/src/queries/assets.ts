/**
 * Reusable typed query options, shared by the route loader and the component so
 * they hit one cache entry rather than two.
 *
 * The query function goes through the generated authenticated fetch, passes
 * Query's cancellation signal, and throws a useful error for an unsuccessful
 * response. Supplying a client does not authenticate arbitrary query functions:
 * the request boundary is what does.
 */

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
