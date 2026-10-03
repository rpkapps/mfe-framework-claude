/** Every value Operations stores, declared once. */

import { storedKey } from '@company/mfe-react'
import { z } from 'zod'

/**
 * A display density belongs to the browser rather than to a person, so everyone here shares it,
 * as they share every browser-stored value (§56).
 */
export const tableDensity = storedKey(
  'table-density',
  z.enum(['comfortable', 'compact']).default('comfortable'),
)
