import { createFileRoute } from '@tanstack/react-router'
import { mfeRoute } from '@company/mfe-react'

/** A child App takes per-instance data through its own URL, never through inputs (Widgets take props). */
export const Route = createFileRoute('/reports/$')(mfeRoute({ appId: 'reports' }))
