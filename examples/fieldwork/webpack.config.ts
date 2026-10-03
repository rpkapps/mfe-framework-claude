/**
 * The customWebpackConfig of this project's build target. Everything else about the build is an
 * ordinary Angular webpack build, configured in project.json. `withMfe()` is what makes it a
 * container: it reads the container's sources before every compile and regenerates `.mfe/`,
 * replaces the application entry with the generated stub, adds the Module Federation remote
 * (remoteEntry.js and mf-manifest.json, with Angular shared in its version's scope), the `#mfe/*` aliases,
 * `publicPath: 'auto'` and the container stylesheet scoped to this container's mount roots. None
 * of that is configurable per project: a page only works when every container agrees.
 */

import { withMfe } from '@company/mfe-nx/webpack'

export default withMfe()
