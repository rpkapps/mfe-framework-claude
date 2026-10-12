/**
 * The devtools mount ships in every build and is gated at runtime, because `DEV` would delete the
 * feature on exactly the deployed page where repointing a container matters (§22).
 */

import { Component, Suspense, use, useSyncExternalStore, type ReactNode } from 'react'
import { toMfeError } from '@company/mfe-core'
import { useMfeRuntime, type MfeRuntime } from '@company/mfe-react'

import { devtools, initDevtools } from './devtools-store.ts'
import { loadPanel } from './load-panel.ts'

export function MfeDevtools(): ReactNode {
  // Not as `useSyncExternalStore`'s third argument: that one is the hydration snapshot, never called in a browser.
  initDevtools()
  const { on } = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot)

  if (!on) return null

  return <Panel />
}

function Panel(): ReactNode {
  const { diagnostics } = useMfeRuntime('the developer tools')
  return (
    <PanelBoundary diagnostics={diagnostics}>
      <Suspense fallback={null}>
        <PanelChunk />
      </Suspense>
    </PanelBoundary>
  )
}

interface PanelBoundaryState {
  readonly failed: boolean
}

interface PanelBoundaryProps {
  readonly diagnostics: MfeRuntime['diagnostics']
  readonly children: ReactNode
}

/**
 * A panel chunk that did not arrive, or a panel that threw, is reported and leaves the host page as
 * it was rather than broken: the developer tools are absent until they are turned off and on
 * again, which mounts this anew and fetches again.
 */
class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { failed: false }

  static getDerivedStateFromError(): PanelBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    this.props.diagnostics.report(
      toMfeError(error, {
        code: 'mount/failure',
        id: '@company/mfe-devtools',
        operation: 'load and render the developer tools panel',
        repair:
          'The page is unaffected. Check the network for the panel chunk, or fix the error the cause names, then turn the developer tools off and on again.',
      }),
    )
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

function PanelChunk(): ReactNode {
  const { DevtoolsPanel } = use(loadPanel())
  return <DevtoolsPanel />
}
