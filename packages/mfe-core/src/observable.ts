/** The shape a subscription-based store publishes; `@company/mfe-runtime` holds the implementations. */

export type Unsubscribe = () => void
export type Listener = () => void

/** The shape React's `useSyncExternalStore` needs, and non-React hosts can poll. */
export interface Subscribable<T> {
  getSnapshot(): T
  subscribe(listener: Listener): Unsubscribe
}
