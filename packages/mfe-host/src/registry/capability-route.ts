/**
 * Where an App says one of its capability pages lives.
 *
 * A capability is a neutral fact about an entry, so resolving one to a route is
 * a read of the registry record and nothing more. It lives here rather than in
 * the removable legacy adapter, where the only resolver used to sit mixed in
 * with that adapter's compatibility fallback — a registry field read in two
 * places is a registry field read two ways.
 */

import type { CapabilityName, NeutralRegistryEntry } from '@company/mfe-core'

/**
 * The App-relative path the entry advertises for `name`, or `undefined` when it
 * advertises none — including for every Widget, which cannot have capabilities.
 * What "it does not own that page" means is the caller's: one surface hides the
 * action, another falls back to something it serves itself.
 */
export function capabilityRoute(
  entry: NeutralRegistryEntry,
  name: CapabilityName,
): string | undefined {
  return entry.capabilities?.find(capability => capability.name === name)?.path
}
