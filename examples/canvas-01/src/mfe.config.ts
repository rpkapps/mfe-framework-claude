import { env } from '@company/mfe-rspack'
import { z } from 'zod'

// The schema and the environment mapping, with no deployment values and no
// secrets. Values marked { api: true } declare API origins, which is what lets
// the authenticated fetch attach a token to them and to nothing else.
export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  webSocketUrl: env('WEB_SOCKET_URL', z.string().url(), { api: true }),
}
