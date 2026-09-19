/**
 * Subscribing to a Widget's events without having been compiled against it.
 *
 * The registry publishes the event names, so a host can build the `onX` props
 * for a Widget it has never imported. That is the half of the contract a
 * catalogue would otherwise lose: knowing what a Widget takes is not much use
 * if nothing it emits can be heard.
 */

export function handlerPropsFor(
  events: readonly string[],
  onEvent: (event: string, payload: unknown) => void,
): Record<string, (payload: unknown) => void> {
  return Object.fromEntries(
    events.map(event => [
      `on${event.charAt(0).toUpperCase()}${event.slice(1)}`,
      (payload: unknown) => {
        onEvent(event, payload)
      },
    ]),
  )
}
