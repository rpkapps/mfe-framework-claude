/**
 * A React definition mounting itself into the element its host provides, whichever framework the
 * host is written in, React included: one React root per mount, rendering the same `MountTree`
 * the testing helpers render. The runtime owns the scope root around the element and the overlay
 * root on the context, so this renders neither.
 */

import { toMfeError, withoutUndefined, type MfeError } from '@company/mfe-core'
import type {
  AppMountTarget,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from '@company/mfe-runtime'
import { StrictMode, useEffect, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import type { AppDefinition, WidgetDefinition } from './definition.ts'
import { DEV } from './dev.ts'
import { MountTree } from './mount-tree.tsx'
import { withQueryClient, type MfeMount } from './runtime.ts'

interface OwnedRoot {
  /** Commits before it returns, and throws whatever failed that first commit. */
  readonly renderFirst: (ui: ReactNode) => void
  readonly render: (ui: ReactNode) => void
  /** Empties the element; the Query client goes when the context aborts, after this. */
  readonly dispose: () => Promise<void>
  /** Resolves once the latest render has committed and its effects have run. */
  readonly whenStable: () => Promise<void>
}

/**
 * Rendered after the whole tree, so its passive effect runs after every effect of the render that
 * carried `render`: React runs them child first and sibling by sibling.
 */
function CommitMarker({
  render,
  onCommit,
}: {
  readonly render: number
  readonly onCommit: (render: number) => void
}): null {
  useEffect(() => {
    onCommit(render)
  }, [render, onCommit])
  return null
}

/**
 * `useId` values are unique per root, so two roots on one page would hand out the same ids, and a
 * label in one would point at an input in another. The mount token is unique per page.
 */
function identifierPrefixOf(mountToken: string): string {
  return `mfe-${mountToken.replace(/[^A-Za-z0-9_-]/g, '-')}-`
}

/** What reaches the runtime's hub, and what a failed first commit rejects the mount with. */
function renderFailure(mount: MfeMount, operation: string, error: unknown): MfeError {
  return toMfeError(error, {
    code: 'mount/failure',
    id: mount.definitionId,
    ...withoutUndefined({ definitionVersion: mount.definitionVersion }),
    operation,
    repair: 'Fix the error the definition threw while rendering, then use the retry action.',
  })
}

/** StrictMode is a development rehearsal, so a production root skips its double renders. */
function inDevelopmentStrictMode(ui: ReactNode): ReactNode {
  return DEV ? <StrictMode>{ui}</StrictMode> : ui
}

/**
 * The first render is synchronous so the host's promise settles on its outcome: a failure there
 * rejects the mount. A later failure has no promise left to reject, so it goes to `onFailure`,
 * which moves the mount to its error state where the host offers a retry rather than leaving a
 * blank area. `mountDefinition` always provides it.
 */
function openRoot(
  element: HTMLElement,
  mount: MfeMount,
  operation: string,
  onFailure: (error: unknown) => void,
): OwnedRoot {
  const { diagnostics } = mount.runtime

  // A holder rather than a variable, because it is written from React's callback.
  const first: { committed: boolean; failure: MfeError | null } = {
    committed: false,
    failure: null,
  }

  // Each render is numbered, and `whenStable` waits for the marker to report the latest one.
  let requested = 0
  let committed = 0
  let waiting: (() => void)[] = []
  const settle = (render: number): void => {
    committed = render
    if (committed !== requested) return
    const settled = waiting
    waiting = []
    for (const resolve of settled) resolve()
  }
  const marked = (ui: ReactNode): ReactNode => {
    requested += 1
    return inDevelopmentStrictMode(
      <>
        {ui}
        <CommitMarker render={requested} onCommit={settle} />
      </>,
    )
  }

  const root = createRoot(element, {
    identifierPrefix: identifierPrefixOf(mount.mountToken),
    onUncaughtError: error => {
      const failure = renderFailure(mount, operation, error)
      if (!first.committed) first.failure = failure
      else onFailure(failure)
      // React unmounted the tree, so nothing is left to render and nobody should keep waiting.
      settle(requested)
    },
    // React recovered on its own, so this is worth knowing about rather than acting on.
    onRecoverableError: error => {
      diagnostics.report(renderFailure(mount, operation, error), { severity: 'warning' })
    },
  })

  const dispose = async (): Promise<void> => {
    root.unmount()
    settle(requested)
    await Promise.resolve()
  }

  return {
    renderFirst: ui => {
      flushSync(() => {
        root.render(marked(ui))
      })
      first.committed = true

      if (first.failure !== null) {
        root.unmount()
        throw first.failure
      }
    },
    render: ui => {
      root.render(marked(ui))
    },
    dispose,
    whenStable: () =>
      committed === requested
        ? Promise.resolve()
        : new Promise(resolve => {
            waiting.push(resolve)
          }),
  }
}

export function mountWidget(
  definition: WidgetDefinition,
  target: WidgetMountTarget,
): MountedWidget {
  const mount = withQueryClient(target.context)

  // Built once, so a re-render never hands the Widget a new channel; the provider's own
  // validation runs in `WidgetMount` before either is called.
  const emit = (output: string, payload: unknown): void => {
    target.emit(output, payload)
  }
  const onInputRejected = (error: MfeError): void => {
    target.onInputRejected?.(error)
  }

  const render = (inputs: Readonly<Record<string, unknown>>): ReactNode => (
    <MountTree
      definition={definition}
      mount={mount}
      inputs={inputs}
      emit={emit}
      onInputRejected={onInputRejected}
    />
  )

  const root = openRoot(target.element, mount, 'mount Widget', target.onFailure)
  root.renderFirst(render(target.inputs))

  return {
    // `WidgetMount` validates and keeps the last valid inputs.
    update: inputs => {
      root.render(render(inputs))
    },
    dispose: root.dispose,
    whenStable: root.whenStable,
  }
}

export function mountApp(definition: AppDefinition, target: AppMountTarget): MountedApp {
  const mount = withQueryClient(target.context)

  const root = openRoot(target.element, mount, 'mount App', target.onFailure)
  root.renderFirst(<MountTree definition={definition} mount={mount} />)

  return { dispose: root.dispose, whenStable: root.whenStable }
}
