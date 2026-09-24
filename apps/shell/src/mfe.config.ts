/**
 * The shell's runtime configuration, declared as a container's is. Declarations only: the values
 * are in the deployment's runtime-config.json, which the generated runtime-config.sh writes from
 * these environment variables when the image starts. The shell reads it through a `#mfe/config`
 * that validates without Zod, so these schemas only ever run at build time (§36, §37).
 */

import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  oidcAuthority: env('OIDC_AUTHORITY', z.string().url().optional()),
  oidcClientId: env('OIDC_CLIENT_ID', z.string().min(1).optional()),
  oidcScope: env('OIDC_SCOPE', z.string().default('openid profile email offline_access')),
  oidcGroupsClaim: env('OIDC_GROUPS_CLAIM', z.string().default('groups')),
  oidcDisabled: env('OIDC_DISABLED', z.boolean().optional()),
}
