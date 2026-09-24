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
  loader: env('SHELL_LOADER', z.enum(['drill-bit', 'well-log']).default('drill-bit')),
}
