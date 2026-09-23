/** The list is short because a setting every container must agree on is derived, not declared. */

import type { ContainerOptions } from '@company/mfe-build'

export interface MfeAngularOptions extends ContainerOptions {
  /**
   * The directory holding the container's `package.json` and `src/mfe.ts`. `withMfe()` defaults
   * it to the root of the Nx project being built.
   */
  readonly containerRoot?: string
}

/** How an author points the integration at a container, for the repair when that is wrong. */
export const CONTAINER_ROOT_OPTION = 'withMfe({ containerRoot })'

/** Where an author adds a share, for the repair when an addition is refused. */
export const SHARED_OPTION = 'withMfe({ shared })'
