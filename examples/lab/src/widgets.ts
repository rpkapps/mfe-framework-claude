/**
 * Lazy Widget components are created at module scope so their identity is
 * stable. Creating one during render would remount the Widget on every parent
 * render and throw its state away each time.
 *
 * The contract is imported from the provider's independently versioned
 * contracts entry, so inputs and event payloads are typed and the consumer
 * validates events as well as the provider. A consumer may instead declare its
 * own tolerant contract naming only the fields it uses; neither requires a
 * coordinated build.
 */

import { lazyWidget } from '@company/mfe-react'

import { events, inputs } from '@example/alert-panel/contracts'

export const AlertPanel = lazyWidget('alert-panel', { contract: { inputs, events } })

/**
 * The same Widget consumed without a contract, which is what a host composing
 * whatever the registry advertises has to do. Inputs are unknown to the type
 * system here; the provider still validates every one of them.
 */
export const UntypedAlertPanel = lazyWidget('alert-panel')

/** A Widget id that is not in the registry, so the failure path is reachable. */
export const MissingWidget = lazyWidget('not-registered')
