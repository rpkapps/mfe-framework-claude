/** Built at module scope because one built during render remounts the Widget every pass (§15). */

import { lazyWidget } from '@company/mfe-react'

import { events, inputs } from '@example/alert-panel/contracts'

export const AlertPanel = lazyWidget('alert-panel', { contract: { inputs, events } })
