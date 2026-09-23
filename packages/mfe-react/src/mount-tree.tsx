/**
 * Everything one React mount renders, whoever hosts it: the runtime and the mount, the mount's own
 * Query client, the style root its container's build attached, and then the App's router or the
 * validated Widget. The root a host opens renders this, and so do the in-tree testing helpers, so
 * what a test renders is what ships. No scope root is rendered here: the runtime creates it, and
 * this tree renders inside it.
 */

import type { MfeError } from '@company/mfe-core'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { AppMount } from './app-mount.tsx'
import type { AppDefinition, WidgetDefinition } from './definition.ts'
import { MfeMountProvider } from './mount-context.tsx'
import { MfeProvider } from './runtime-context.tsx'
import type { MfeMount } from './runtime.ts'
import { styleRootOf, type MfeStyleRoot } from './style-root.ts'
import { WidgetMount } from './widget-mount.tsx'

export interface AppMountTreeProps {
  readonly definition: AppDefinition
  readonly mount: MfeMount
}

export interface WidgetMountTreeProps {
  readonly definition: WidgetDefinition
  readonly mount: MfeMount
  readonly inputs: Readonly<Record<string, unknown>>
  /** Called with a payload the Widget's own event schema accepted. */
  readonly emit: (event: string, payload: unknown) => void
  readonly onInputRejected?: ((error: MfeError) => void) | undefined
}

export type MountTreeProps = AppMountTreeProps | WidgetMountTreeProps

function isWidgetTree(props: MountTreeProps): props is WidgetMountTreeProps {
  return props.definition.kind === 'widget'
}

/**
 * The style root arrives as a prop, never looked up here, so it is a component the tree was
 * given rather than one it made; it renders inside the scope root, around the definition.
 */
function Styled({
  styleRoot: StyleRoot,
  overlayContainer,
  children,
}: {
  readonly styleRoot: MfeStyleRoot | undefined
  readonly overlayContainer: HTMLElement
  readonly children: ReactNode
}): ReactNode {
  if (StyleRoot === undefined) return children
  return <StyleRoot overlayContainer={overlayContainer}>{children}</StyleRoot>
}

export function MountTree(props: MountTreeProps): ReactNode {
  const { definition, mount } = props

  const body = isWidgetTree(props) ? (
    <WidgetMount
      definition={props.definition}
      mount={mount}
      inputs={props.inputs}
      emit={props.emit}
      onInputRejected={props.onInputRejected}
    />
  ) : (
    <AppMount definition={props.definition} mount={mount} />
  )

  return (
    <MfeProvider runtime={mount.runtime}>
      <MfeMountProvider mount={mount}>
        <QueryClientProvider client={mount.queryClient}>
          <Styled styleRoot={styleRootOf(definition)} overlayContainer={mount.overlayRoot}>
            {body}
          </Styled>
        </QueryClientProvider>
      </MfeMountProvider>
    </MfeProvider>
  )
}
