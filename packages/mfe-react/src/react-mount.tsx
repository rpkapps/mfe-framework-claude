/**
 * A React definition mounting itself, for a host built on another framework: the same
 * `WidgetMount` and `AppMount` a React host renders, in a React root of its own inside the
 * element that host provides. Validation therefore splits exactly as it does in a React host.
 */

import { toMfeError, type MfeError } from '@company/mfe-core'
import type {
  AppMountTarget,
  MountContext,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from '@company/mfe-host'
import { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { AppMount } from './app-mount.tsx'
import type { AppDefinition, WidgetDefinition } from './definition.ts'
import { MfeProvider } from './runtime-context.tsx'
import type { MfeMount } from './runtime.ts'
import { WidgetMount } from './widget-mount.tsx'

interface OwnedRoot {
  /** Commits before it returns, and throws whatever failed that first commit. */
  readonly renderFirst: (ui: ReactNode) => void
  readonly render: (ui: ReactNode) => void
  /** Empties the element first, so nothing rendered can observe the cleared cache. */
  readonly dispose: () => Promise<void>
}

/**
 * The first render is synchronous so the host's promise settles on its outcome: a failure there
 * rejects the mount, as a React host shows it in place of the definition. A later failure has no
 * promise left to reject, so it reaches the runtime's diagnostics instead of the console.
 */
function openRoot(element: HTMLElement, mount: MfeMount, operation: string): OwnedRoot {
  const failure = (error: unknown): MfeError =>
    toMfeError(error, {
      code: 'mount/failure',
      id: mount.definitionId,
      ...(mount.definitionVersion === undefined
        ? {}
        : { definitionVersion: mount.definitionVersion }),
      operation,
      repair: 'Fix the error the definition threw while rendering, then mount it again.',
    })

  // A holder rather than a variable, because it is written from React's callback.
  const first: { committed: boolean; failure: MfeError | null } = {
    committed: false,
    failure: null,
  }

  const root = createRoot(element, {
    onUncaughtError: error => {
      if (first.committed) mount.runtime.diagnostics.report(failure(error))
      else first.failure = failure(error)
    },
  })

  const dispose = async (): Promise<void> => {
    root.unmount()
    // Signalled, not waited on: teardown must not block on in-flight requests.
    void mount.queryClient.cancelQueries()
    mount.queryClient.clear()
    await Promise.resolve()
  }

  return {
    renderFirst: ui => {
      flushSync(() => {
        root.render(ui)
      })
      first.committed = true

      if (first.failure !== null) {
        void dispose()
        throw first.failure
      }
    },
    render: ui => {
      root.render(ui)
    },
    dispose,
  }
}

/** One Query client per mount, as a React host gives every mount its own. */
function withQueryClient(context: MountContext): MfeMount {
  return { ...context, queryClient: new QueryClient() }
}

export function mountWidget(
  definition: WidgetDefinition,
  target: WidgetMountTarget,
): MountedWidget {
  const mount = withQueryClient(target.context)

  // Built once, so a re-render never hands the Widget a new channel; the provider's own
  // validation runs in `WidgetMount` before any of these is called.
  const handlers = Object.fromEntries(
    Object.keys(definition.contract.events).map(event => [
      event,
      (payload: unknown) => {
        target.emit(event, payload)
      },
    ]),
  )
  const onInputRejected = (error: MfeError): void => {
    target.onInputRejected?.(error)
  }

  const render = (inputs: Readonly<Record<string, unknown>>): ReactNode => (
    <MfeProvider runtime={mount.runtime}>
      <WidgetMount
        definition={definition}
        mount={mount}
        inputs={inputs}
        handlers={handlers}
        onInputRejected={onInputRejected}
      />
    </MfeProvider>
  )

  const root = openRoot(target.element, mount, 'mount Widget')
  root.renderFirst(render(target.inputs))

  return {
    // `WidgetMount` compares, validates and keeps the last valid inputs, as it does in a React host.
    update: inputs => {
      root.render(render(inputs))
    },
    dispose: root.dispose,
  }
}

export function mountApp(definition: AppDefinition, target: AppMountTarget): MountedApp {
  const mount = withQueryClient(target.context)

  const root = openRoot(target.element, mount, 'mount App')
  root.renderFirst(
    <MfeProvider runtime={mount.runtime}>
      <AppMount definition={definition} mount={mount} bridge={mount.runtime.navigator} />
    </MfeProvider>,
  )

  return { dispose: root.dispose }
}
