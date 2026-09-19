/**
 * The checked-in configuration schema and environment mapping.
 *
 * It contains no deployment values and no secrets: the deployed
 * runtime-config.json carries values only, and the build generates the loader,
 * the JSON Schema and the .env.example from this file.
 *
 * Values marked `{ api: true }` declare API origins and populate the auth
 * allowlist, so the bearer token reaches those origins and nowhere else.
 */

import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  telemetryEnabled: env('TELEMETRY_ENABLED', z.coerce.boolean().default(true)),
}
