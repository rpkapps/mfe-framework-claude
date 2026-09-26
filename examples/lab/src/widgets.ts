/** Built at module scope because one built during render remounts the Widget every pass (§15). */

import { lazyWidget } from '@company/mfe-react'

import { inputSchema, outputSchema } from '@example/alert-panel/contracts'

export const AlertPanel = lazyWidget('alert-panel', { contract: { inputSchema, outputSchema } })

/** Contract-free, as a host composing at runtime must be; the provider validates inputs anyway (§15). */
export const UntypedAlertPanel = lazyWidget('alert-panel')

export const MissingWidget = lazyWidget('not-registered')
