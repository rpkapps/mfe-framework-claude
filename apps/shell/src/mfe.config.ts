/**
 * The shell's runtime configuration, declared as a container's is. Declarations only: the values
 * are in the deployment's runtime-config.json, which the generated runtime-config.sh writes from
 * these environment variables when the image starts. The shell reads it through a `#mfe/config`
 * that validates without Zod, so these schemas only ever run at build time (§36, §37).
 */

import { env } from '@company/mfe-rspack'
import { z } from 'zod'

/**
 * The loading screen drawn while sign-in and boot run: one of the names SHELL_LOADER lists below,
 * or 'cycle' for the next of them on each page load. Built into the page; a deployment can still
 * choose another with SHELL_LOADER.
 */
export const loader = 'drill-bit'

/**
 * How long the loading screen stays up at least once its drawing appears, in milliseconds, so a
 * fast boot does not flash it. Built into the page.
 */
export const loaderMinDuration = 1000

export default {
  oidcAuthority: env('OIDC_AUTHORITY', z.string().trim().url().optional()),
  oidcClientId: env('OIDC_CLIENT_ID', z.string().trim().min(1).optional()),
  // `offline_access` asks for a refresh token, so renewal never needs a round trip through the page.
  oidcScope: env(
    'OIDC_SCOPE',
    z.string().trim().min(1).default('openid profile email offline_access'),
  ),
  oidcGroupsClaim: env('OIDC_GROUPS_CLAIM', z.string().trim().min(1).default('groups')),
  oidcDisabled: env('OIDC_DISABLED', z.boolean().optional()),
  // A deployment's own choice of loading screen, over `loader` above: one per script in
  // src/loaders/, named as its file is, or 'cycle'. index.html reads it itself, before any script.
  // It has no default, so a development copy of the configuration never pins one.
  loader: env(
    'SHELL_LOADER',
    z
      .enum([
        'drill-bit',
        'well-log',
        'bounce',
        'pipeline-bore',
        'seismic-section',
        'pdc-drill-bit',
        'wellhead-pressure',
        'benzene-ring',
        'reservoir-anticline',
        'crude-level',
        'survey-sweep',
        'manifold-flow',
        'drilling-log',
        'offshore-platform',
        'cryogenic-sphere',
        'seabed-lidar',
        'carbon-injection',
        'pore-network',
        'smart-pig-scan',
        'core-hologram',
        'methane-plume',
        'tanker-routes',
        'horizontal-well',
        'form-morph',
        'compressor-stage',
        'crude-emulsion',
        'shot-gather',
        'structure-map',
        'wellhead-stack',
        'saturation-voxels',
        'gyro-survey',
        'gas-chromatograph',
        'pumpjack-rig',
        'derrick-and-bore',
        'tank-farm',
        'pipe-rack',
        'tri-cone-bit',
        'drip',
        'flare-sprite',
        'rov-scout',
        'methane-pal',
        'nodding-donkey',
        'pumpjack-3d',
        'subsea-tree-3d',
        'pipeline-3d',
        'offshore-3d',
        'rock-core-3d',
        'cycle',
      ])
      .optional(),
  ),
}
