/**
 * The exported search index.
 *
 * There is no component, so the generated client route tree drops this file and neither the index
 * nor the content it is built from reaches the browser bundle. `vite.config.ts` lists `/api/search`
 * among the prerendered pages, and because the response is JSON rather than HTML the build writes
 * it to `api/search` in the client output — a static file the browser fetches once.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async () => {
        const { searchAPI } = await import('../../lib/search-server.ts')
        return await searchAPI.staticGET()
      },
    },
  },
})
