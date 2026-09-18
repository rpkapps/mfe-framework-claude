/**
 * Lazy Widget components are created at module scope so their identity is
 * stable. Creating one during render would remount the Widget on every parent
 * render and throw its state away each time.
 *
 * The contract is imported from the provider's independently versioned
 * contracts package. A consumer may instead declare its own tolerant contract
 * naming only the fields it uses; neither requires a coordinated build.
 */

import { lazyWidget } from '@company/mfe-react'

import { alertPanelContract } from '@example/alert-panel/contracts'

export const AlertPanel = lazyWidget('alert-panel', { contract: alertPanelContract })
