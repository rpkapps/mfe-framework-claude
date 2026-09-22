import {
  createApp,
  createWidget,
  type AppRouterOptions,
  type MfeStaticData,
} from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'
import { BoxIcon, MapIcon } from 'lucide-react'
import { z } from 'zod'

import { SubsurfaceWell3dWidget } from './components/well-3d-widget.tsx'
import { routeTree } from './routeTree.gen'

// Called once per mount, not once per module. Pass basePath, history and
// context straight through; the framework validates that at mount.
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

  // The framework reads four fields off a route's staticData: the capability
  // pages the shell opens, and the breadcrumb label. Typing TanStack's own slot
  // with them makes a misspelt capability a compile error rather than a page
  // the shell never finds. An augmentation that adds no field of its own is how
  // one declared type is merged into another's slot; respelling MfeStaticData's
  // fields here is exactly the drift it avoids.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  interface StaticDataRouteOption extends MfeStaticData {}
}

export const subsurfaceCanvas = createApp({
  id: 'subsurface-canvas',
  version: '0.1.0',
  title: 'Subsurface Canvas',
  description: 'An interactive subsurface interpretation canvas.',
  tags: ['canvas', 'geoscience'],
  icon: MapIcon,
  router: makeRouter,
})

export const subsurfaceWell3dContract = {
  inputs: z.object({}),
  events: {},
}

export const subsurfaceWell3d = createWidget({
  id: 'subsurface-well-3d',
  version: '0.1.0',
  title: '3D well and surfaces',
  description: 'Explore a native WebGL well trajectory through interpreted subsurface horizons.',
  tags: ['subsurface', 'well', 'geoscience', '3d'],
  icon: BoxIcon,
  ...subsurfaceWell3dContract,
  render: SubsurfaceWell3dWidget,
})
