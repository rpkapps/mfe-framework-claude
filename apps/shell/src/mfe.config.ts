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
  loader: env('SHELL_LOADER', z.enum(['drill-bit', 'well-log', 'bounce']).default('drill-bit')),
  // How long each loader stays on screen once drawn, in milliseconds, however soon the shell is
  // ready, so a fast boot does not flash it; a loader left out goes at once. It names every loader
  // above, and setting it replaces the whole map, for example {"drill-bit":1500}.
  loaderMinDuration: env(
    'SHELL_LOADER_MIN_DURATION',
    z
      .object({
        'drill-bit': z.number().int().min(0).max(10000).optional(),
        'well-log': z.number().int().min(0).max(10000).optional(),
        bounce: z.number().int().min(0).max(10000).optional(),
      })
      .default({ 'drill-bit': 1000 }),
  ),
}
