import { createFileRoute } from '@tanstack/react-router'
import { mfeRoute } from '@company/mfe-react'

/**
 * A child App delegated at a splat route, so the boundary is visible in the
 * filename rather than derived implicitly from the active route. Because this
 * is an ordinary route, the child loads through native route-level code
 * splitting and preloads on intent with no extra work.
 *
 * Per-instance data reaches the child through its own URL contract, never
 * through inputs: Apps take URLs, Widgets take props.
 */
export const Route = createFileRoute('/reports/$')(mfeRoute({ appId: 'reports' }))
