/**
 * The shell's runtime configuration, declared as a container's is. Declarations only: the values
 * are in the deployment's runtime-config.json, which the generated runtime-config.sh writes from
 * these environment variables when the image starts. The shell reads it through a `#mfe/config`
 * that validates without Zod, so these schemas only ever run at build time (§36, §37).
 */

import { env } from '@company/mfe-rspack'
import { z } from 'zod'

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
  // The loading screen drawn while sign-in and boot run: one per script in src/loaders/, named as
  // its file is. index.html reads it itself, before any script, and draws the default when the
  // runtime configuration cannot be read.
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
      ])
      .default('drill-bit'),
  ),
  // How long each loader stays on screen once drawn, in milliseconds, however soon the shell is
  // ready, so a fast boot does not flash it; a loader left out goes at once. It names every loader
  // above (the build reads this file without running it, so each schema is written out), and
  // setting it replaces the whole map, for example {"drill-bit":1500}.
  loaderMinDuration: env(
    'SHELL_LOADER_MIN_DURATION',
    z
      .object({
        'drill-bit': z.number().int().min(0).max(10000).optional(),
        'well-log': z.number().int().min(0).max(10000).optional(),
        bounce: z.number().int().min(0).max(10000).optional(),
        'pipeline-bore': z.number().int().min(0).max(10000).optional(),
        'seismic-section': z.number().int().min(0).max(10000).optional(),
        'pdc-drill-bit': z.number().int().min(0).max(10000).optional(),
        'wellhead-pressure': z.number().int().min(0).max(10000).optional(),
        'benzene-ring': z.number().int().min(0).max(10000).optional(),
        'reservoir-anticline': z.number().int().min(0).max(10000).optional(),
        'crude-level': z.number().int().min(0).max(10000).optional(),
        'survey-sweep': z.number().int().min(0).max(10000).optional(),
        'manifold-flow': z.number().int().min(0).max(10000).optional(),
        'drilling-log': z.number().int().min(0).max(10000).optional(),
        'offshore-platform': z.number().int().min(0).max(10000).optional(),
        'cryogenic-sphere': z.number().int().min(0).max(10000).optional(),
        'seabed-lidar': z.number().int().min(0).max(10000).optional(),
        'carbon-injection': z.number().int().min(0).max(10000).optional(),
        'pore-network': z.number().int().min(0).max(10000).optional(),
        'smart-pig-scan': z.number().int().min(0).max(10000).optional(),
        'core-hologram': z.number().int().min(0).max(10000).optional(),
        'methane-plume': z.number().int().min(0).max(10000).optional(),
        'tanker-routes': z.number().int().min(0).max(10000).optional(),
        'horizontal-well': z.number().int().min(0).max(10000).optional(),
        'form-morph': z.number().int().min(0).max(10000).optional(),
        'compressor-stage': z.number().int().min(0).max(10000).optional(),
        'crude-emulsion': z.number().int().min(0).max(10000).optional(),
        'shot-gather': z.number().int().min(0).max(10000).optional(),
        'structure-map': z.number().int().min(0).max(10000).optional(),
        'wellhead-stack': z.number().int().min(0).max(10000).optional(),
        'saturation-voxels': z.number().int().min(0).max(10000).optional(),
        'gyro-survey': z.number().int().min(0).max(10000).optional(),
        'gas-chromatograph': z.number().int().min(0).max(10000).optional(),
        'pumpjack-rig': z.number().int().min(0).max(10000).optional(),
        'derrick-and-bore': z.number().int().min(0).max(10000).optional(),
        'tank-farm': z.number().int().min(0).max(10000).optional(),
        'pipe-rack': z.number().int().min(0).max(10000).optional(),
        'tri-cone-bit': z.number().int().min(0).max(10000).optional(),
        drip: z.number().int().min(0).max(10000).optional(),
        'flare-sprite': z.number().int().min(0).max(10000).optional(),
        'rov-scout': z.number().int().min(0).max(10000).optional(),
        'methane-pal': z.number().int().min(0).max(10000).optional(),
        'nodding-donkey': z.number().int().min(0).max(10000).optional(),
      })
      .default({ 'drill-bit': 1000 }),
  ),
}
