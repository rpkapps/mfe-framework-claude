/** Every loading screen the shell can draw, one page each, in the colours the shell draws them in. */

import { createApp, type AppRouterOptions } from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'
import { LoaderIcon } from 'lucide-react'

import { routeTree } from './routeTree.gen'

function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree,
    basepath: basePath,
    history,
    context: { ...context },
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}

export default createApp({
  id: 'loaders',
  version: '0.1.0',
  title: 'Loaders',
  description: 'Every loading screen the shell can draw, to preview and choose from.',
  tags: ['loaders', 'design'],
  icon: LoaderIcon,
  router: makeRouter,
})
